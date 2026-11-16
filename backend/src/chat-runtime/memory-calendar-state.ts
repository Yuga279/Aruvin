/**
 * ============================================================================
 * FILE: memory-calendar-state.ts
 * LOCATION: backend/src/chat-runtime/memory-calendar-state.ts
 * ============================================================================
 * PURPOSE: Bound native decision/result evidence before publication or promotion.
 * ROLE IN PROJECT: Data-only shared text/voice memory evidence; grants no authority.
 * KEY COMPONENTS: Schema, complete native pairs, immutable staging and byte ceiling.
 * ============================================================================
 */
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { resumableSkillDecisionSchema, rejectedDecisionV2Schema, completeToolGroupV2Schema,
  type ResumableSkillDecision, type CalendarRejectedDecisionV2 } from '../contracts/calendar-model.js';
import { localSkillResultRecordSchema, type LocalSkillResultRecord } from '../contracts/calendar-sources.js';
import { turnBudgetRecordSchema, modelDispatchV2Schema, modelAggregateSchema } from '../contracts/calendar-accounting.js';
import { skillGroup } from './calendar-skills.js';
import { AppError } from '../platform/errors/app-error.js';
import { idSchema } from '../contracts/identifiers.js';

export const memoryCalendarStateSchema = z.object({
  storage: z.literal('volatile'), budget: turnBudgetRecordSchema,
  dispatches: z.array(modelDispatchV2Schema).max(8), aggregate: modelAggregateSchema.nullable(),
  decisions: z.array(resumableSkillDecisionSchema).max(8),
  rejected: z.array(rejectedDecisionV2Schema).max(8),
  results: z.array(localSkillResultRecordSchema).max(8),
}).strict().superRefine((state, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Native memory evidence is incomplete.' });
  const budget = state.budget;
  if (state.dispatches.length > budget.modelDispatches ||
      new Set(state.dispatches.map(d => d.dispatchId)).size !== state.dispatches.length ||
      new Set(state.decisions.map(d => d.decisionId)).size !== state.decisions.length ||
      new Set(state.results.map(r => r.toolCallId)).size !== state.results.length ||
      new Set(state.results.map(r => r.sequence)).size !== state.results.length) fail();
  for (const [index, dispatch] of state.dispatches.entries()) {
    if (dispatch.userId !== budget.userId || dispatch.sessionId !== budget.sessionId || dispatch.turnId !== budget.turnId ||
        dispatch.dispatchIndex !== budget.modelDispatches - state.dispatches.length + index + 1 ||
        (index > 0 && dispatch.attemptId !== state.dispatches[0]!.attemptId)) fail();
  }
  for (const decision of state.decisions) {
    const dispatch = state.dispatches.find(d => d.dispatchId === decision.dispatchId);
    if (!dispatch || dispatch.decisionId !== decision.decisionId || dispatch.attemptId !== decision.attemptId ||
        dispatch.userId !== decision.userId || dispatch.sessionId !== decision.sessionId || dispatch.turnId !== decision.turnId ||
        decision.sources.length || decision.operationId || decision.intentId || decision.proposalId) fail();
  }
  for (const result of state.results) {
    const decision = state.decisions.find(d => d.decisionId === result.decisionId);
    const native = decision?.decision;
    if (!decision || !native || native.kind === 'text' || native.nativeCall.id !== result.toolCallId ||
        decision.userId !== result.userId || decision.sessionId !== result.sessionId || decision.turnId !== result.turnId ||
        decision.attemptId !== result.attemptId) { fail(); continue; }
    if (!completeToolGroupV2Schema.safeParse(skillGroup(native, result.resultRef.content)).success) fail();
  }
  for (const rejection of state.rejected) {
    const dispatch = state.dispatches.find(d => d.dispatchId === rejection.dispatchId);
    if (!dispatch || dispatch.decisionId !== rejection.decisionId || dispatch.attemptId !== rejection.attemptId ||
        dispatch.userId !== rejection.userId || dispatch.sessionId !== rejection.sessionId || dispatch.turnId !== rejection.turnId) fail();
  }
  if (state.aggregate && (!isDeepStrictEqual(state.aggregate.dispatchIds, state.dispatches.map(d => d.dispatchId)) ||
      state.aggregate.userId !== budget.userId || state.aggregate.sessionId !== budget.sessionId || state.aggregate.turnId !== budget.turnId ||
      state.aggregate.attemptId !== state.dispatches[0]?.attemptId)) fail();
});
export type MemoryCalendarState = z.infer<typeof memoryCalendarStateSchema>;

/** Version visibility is checked by the reader against the session publication. */
export const memoryCalendarRecordSchema = z.object({ schemaVersion: z.literal(1),
  kind: z.literal('memory-calendar-native'), userId: idSchema, sessionId: idSchema,
  turnId: idSchema, attemptId: idSchema, epoch: idSchema,
  version: z.number().int().positive().safe(), fence: z.number().int().nonnegative().safe(),
  state: memoryCalendarStateSchema,
}).strict().refine(record => record.state.budget.userId === record.userId &&
  record.state.budget.sessionId === record.sessionId && record.state.budget.turnId === record.turnId &&
  record.state.dispatches.every(dispatch => dispatch.attemptId === record.attemptId && dispatch.status === 'terminal') &&
  record.state.decisions.every(decision => !decision.decision || decision.decision.kind === 'text' ||
    record.state.results.some(result => result.decisionId === decision.decisionId)));

export class MemoryCalendarStage {
  private readonly decisions = new Map<string, ResumableSkillDecision>();
  private readonly results = new Map<string, LocalSkillResultRecord>();
  private readonly rejected = new Map<string, CalendarRejectedDecisionV2>();
  constructor(private readonly maxBytes: number, private readonly maxRecords: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 8)
      throw new Error('Invalid native memory bounds.');
  }
  private put<T>(map: Map<string, T>, id: string, value: T): void {
    const old = map.get(id);
    if (old && !isDeepStrictEqual(old, value)) throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Native decision identity changed.');
    if (old) return;
    if (map.size >= this.maxRecords || Buffer.byteLength(JSON.stringify(this.records()), 'utf8') +
        Buffer.byteLength(JSON.stringify(value), 'utf8') > this.maxBytes)
      throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The native memory budget is exhausted.', false);
    map.set(id, structuredClone(value));
  }
  putDecision(record: ResumableSkillDecision) {
    const parsed = resumableSkillDecisionSchema.parse(record); this.put(this.decisions, parsed.decisionId, parsed);
  }
  putResult(record: LocalSkillResultRecord) {
    const parsed = localSkillResultRecordSchema.parse(record); this.put(this.results, parsed.toolCallId, parsed);
  }
  putRejected(record: CalendarRejectedDecisionV2) {
    const parsed = rejectedDecisionV2Schema.parse(record); this.put(this.rejected, parsed.decisionId, parsed);
  }
  getDecision(id: string) { return structuredClone(this.decisions.get(id) ?? null); }
  records() {
    return structuredClone({ decisions: [...this.decisions.values()], results: [...this.results.values()], rejected: [...this.rejected.values()] });
  }
}
