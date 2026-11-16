/**
 * ============================================================================
 * FILE: calendar-history.ts
 * LOCATION: backend/src/chat-runtime/calendar-history.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Reconstruct ordered complete Calendar tool groups from existing dispatch,
 *    decision, and result metadata for accepted history turns.
 *
 * ROLE IN PROJECT:
 *    Read-only join behind stable protocol replay. It never redispatchs inference
 *    or resurrects redacted evidence; local results remain source-free bytes.
 *
 * KEY COMPONENTS:
 *    - calendarHistory: scoped per-turn join with strict identity checks.
 * ============================================================================
 */

import { CALENDAR_TOMBSTONE, type CalendarSourceReference, type CalendarSourceReferenceV2 }
  from '../contracts/calendar-sources.js';
import { completeToolGroupSchema, completeToolGroupV2Schema }
  from '../contracts/calendar-model.js';
import type { MessageRecord } from '../contracts/message.js';
import type { CompatibleCalendarToolGroup } from '../context/calendar-context.js';
import { AppError } from '../platform/errors/app-error.js';
import type { PersistenceBundle } from '../persistence/persistence.js';
import { skillGroup } from './calendar-skills.js';
import { readMemoryCalendarStates } from '../persistence/memory-calendar-reader.js';

export async function calendarHistory(p: PersistenceBundle, userId: string, sessionId: string,
  records: readonly MessageRecord[]): Promise<Map<string, CompatibleCalendarToolGroup[]>> {
  const history = new Map<string, CompatibleCalendarToolGroup[]>();
  const seen = new Set<string>();
  let native: Awaited<ReturnType<typeof readMemoryCalendarStates>> | undefined;
  for (const turnId of [...new Set(records.filter(record => record.role === 'user').map(record => record.turnId))]) {
    const dispatches = await p.calendarAccountingV2.listDispatches(userId, turnId);
    if (dispatches.length > 8) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Calendar history needs recovery.');
    if (!dispatches.length) {
      if (!native) {
        const session = await p.sessions.get(userId, sessionId);
        const attempts = [];
        let cursor: string | null = null;
        if (session?.memoryPublication) {
          do {
            const page = await p.metadata.listAttempts(userId, sessionId, { cursor, limit: Math.min(50, p.metadata.budgets.maxPageSize) });
            attempts.push(...page.items); cursor = page.nextCursor;
            if (attempts.length > 250 || cursor && attempts.length >= 250)
              throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Calendar history needs recovery.');
          } while (cursor);
          native = await readMemoryCalendarStates(p, session, records, 250, attempts);
        } else native = [];
      }
      const local = native.filter(state => state.budget.turnId === turnId).flatMap(state =>
        [...state.results].sort((a, b) => a.sequence - b.sequence).map(result => {
          const decision = state.decisions.find(d => d.decisionId === result.decisionId)?.decision;
          if (!decision || decision.kind === 'text' || seen.has(result.toolCallId))
            throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
          seen.add(result.toolCallId);
          return skillGroup(decision, result.resultRef.content);
        }));
      if (local.length) history.set(turnId, local);
      continue;
    }
    const groups: { attemptId: string; sequence: number; group: CompatibleCalendarToolGroup }[] = [];
    for (const dispatch of [...dispatches].sort((a, b) => a.dispatchIndex - b.dispatchIndex)) {
      if (dispatch.userId !== userId || dispatch.sessionId !== sessionId || dispatch.turnId !== turnId)
        throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
      const saved = await p.skillDecisions.get(userId, dispatch.decisionId);
      if (!saved) continue; // Structurally rejected/unknown inference has no accepted native call.
      if (saved.userId !== userId || saved.sessionId !== sessionId || saved.turnId !== turnId
        || saved.attemptId !== dispatch.attemptId || saved.dispatchId !== dispatch.dispatchId)
        throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
      const decision = saved.decision;
      if (!decision) {
        // Never resurrect a redacted decision from raw collection data or guess its arguments.
        throw new AppError('NOT_READY', 'Calendar history is no longer available. Start a new chat.');
      }
      if (decision.kind === 'text') continue;
      const callId = decision.kind === 'tool' ? decision.toolCallId : decision.nativeCall.id;
      const result = await p.skillResults.get(userId, sessionId, callId);
      if (!result) continue; // A terminal clarification/denial may have no model-visible result.
      if (result.userId !== userId || result.sessionId !== sessionId
        || result.turnId !== turnId || result.attemptId !== saved.attemptId
        || result.decisionId !== saved.decisionId || result.toolCallId !== callId || seen.has(callId))
        throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
      seen.add(callId);
      let content: string;
      let sources: (CalendarSourceReference | CalendarSourceReferenceV2)[];
      if (result.schemaVersion === 3) {
        if (decision.kind === 'tool') throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
        content = result.resultRef.content;
        sources = [];
      } else if (result.resultRef.storage === 'retained') {
        content = JSON.stringify(result.resultRef.result);
        sources = [result.resultRef.source];
      } else {
        content = JSON.stringify({ kind: 'calendar-history-unavailable', message: CALENDAR_TOMBSTONE });
        sources = []; // Explicit unavailable pair, never an API-success payload or schema authority.
      }
      const legacyGroupSchema = sources.some(source => source.schemaVersion === 1)
        ? completeToolGroupSchema : completeToolGroupV2Schema;
      const group = decision.kind === 'tool'
        ? legacyGroupSchema.parse({ assistant: { role: 'assistant', content: null,
            tool_calls: [{ id: callId, type: 'function', function: { name: decision.call.name,
              arguments: JSON.stringify(decision.call.arguments) } }] },
          result: { role: 'tool', name: decision.call.name, tool_call_id: callId, content }, sources })
        : skillGroup(decision, content, sources.filter(
          (source): source is CalendarSourceReferenceV2 => source.schemaVersion === 2));
      groups.push({ attemptId: result.attemptId, sequence: result.sequence, group });
    }
    if (new Set(groups.map(item => JSON.stringify([item.attemptId, item.sequence]))).size !== groups.length)
      throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
    // Dispatch index orders the logical turn; a deliberate retry may restart its per-attempt result sequence.
    const lastSequence = new Map<string, number>();
    for (const item of groups) {
      if (item.sequence <= (lastSequence.get(item.attemptId) ?? -1))
        throw new AppError('INVALID_REQUEST', 'Calendar history is incomplete.');
      lastSequence.set(item.attemptId, item.sequence);
    }
    history.set(turnId, groups.map(item => item.group));
  }
  return history;
}
