/**
 * ============================================================================
 * FILE: calendar-loop.ts
 * LOCATION: backend/src/chat-runtime/calendar-loop.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Manage the decide-execute-seal turn graph loop for conversational Calendar execution.
 *
 * ROLE IN PROJECT:
 *    Executes Calendar model dispatches, resolves conversational calendar targets,
 *    enforces intent binding and capability gates, coordinates tool execution,
 *    and streams progress/clarification envelopes across v1 and v2.
 *
 * KEY COMPONENTS:
 *    - CalendarLoop: Graph execution node implementation (decide, execute, seal).
 *    - executeCreateV2: Resolves target calendar via capability gate, binds intent, and creates events.
 *    - Recoverable failures: Seal a user-facing answer instead of failing the accepted turn.
 *    - Reply target: A reply answers only the current proposal, proven by the bound reply reference.
 *    - Incomplete proposals: Missing details and unknown targets are published, never consumed.
 *    - emit: Emits versioned SSE frames conforming to protocol v2 or v3 multi-stream.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { AgentMemoryManifest } from '../contracts/agent-memory.js';
import type { AttemptRecord } from '../contracts/attempt.js';
import type { CalendarConnectionBinding } from '../contracts/calendar-connections.js';
import {
  completeToolGroupSchema, completeToolGroupV2Schema, rejectedDecisionSchema, rejectedDecisionV2Schema,
  resumableSkillDecisionSchema, skillDecisionSchema,
  type CalendarDecision, type CalendarRejectedDecision, type CalendarRejectedDecisionV2, type CompleteCalendarToolGroup,
  type CalendarRepairDiagnostics, type SkillDecision, type SkillDecisionRequest,
} from '../contracts/calendar-model.js';
import { calendarFailureSchema, type CalendarFailure, type CalendarLimits } from '../contracts/calendar-policy.js';
import { CALENDAR_TOOLS, SKILL_NATIVE_TOOLS, calendarCallSchema, callToolEnvelopeSchema,
  serializeSkillLocalResult, skillError,
  type CalendarCall, type CalendarCreateInput, type SkillLocalResult } from '../contracts/calendar-tools.js';
import {
  calendarMultiStreamEnvelopeSchema,
  calendarStreamEnvelopeSchema,
  type CalendarStreamEnvelope,
} from '../contracts/calendar-wire.js';
import type { AssembledContext } from '../contracts/context.js';
import type { RuntimeConfigSnapshot } from '../contracts/config-runtime.js';
import { messageRecordSchema, type MessageRecord } from '../contracts/message.js';
import type { ExecutionLease } from '../contracts/repositories.js';
import {
  calendarToolResultRecordSchema,
  calendarToolResultRecordV2Schema,
  localSkillResultRecordSchema,
  sourceReferenceV2Schema,
  CALENDAR_TOMBSTONE,
  type CalendarSourceReferenceV2,
} from '../contracts/calendar-sources.js';
import {
  type CalendarExecutionBindingV2,
  type CalendarRequestKindV2,
} from '../contracts/calendar-operations.js';
import type { FixedAssets } from '../instructions/fixed-assets.js';
import { boundaryFor, calendarCursorSchema, calendarSealSchema, type CalendarCursor, type CalendarRefs, type GraphInput } from '../agent/state.js';
import type { CalendarGraphPatch } from '../agent/turn-graph.js';
import { calendarContext, type CompatibleCalendarToolGroup } from '../context/calendar-context.js';
import { activateLocalSkill, requireLoadedSkill, skillGroup } from './calendar-skills.js';
import { buildReferenceManifest } from '../context/index.js';
import {
  calendarActionHash,
  CalendarToolFault,
  validateCalendarCall,
} from '../plugins/google-calendar/tools-validation.js';
import type { PersistenceBundle } from '../persistence/persistence.js';
import { bounded, key } from '../persistence/records.js';
import { AppError } from '../platform/errors/app-error.js';
import { diagnose } from './ports.js';
import { CALENDAR_DIAGNOSTIC_FINGERPRINTS } from '../model/calendar-adapter.js';
import { hashPayload } from '../platform/crypto/hash-payload.js';
import { CalendarTurnLedger } from './calendar-budget.js';
import { canonicalCalendarAction, CalendarOperationWriter, PROVIDER_REQUEST_KINDS, type CalendarCreateOutcome } from './calendar-operation.js';
import { readCalendarIntent, readCalendarReply, calendarIntentId, calendarMissingFields, type AcceptedCalendarIntent, type IntentMissingField } from './calendar-intent.js';
import { publishProposal, consumeOrTombstoneProposal, resolveReplyTarget, type PublishProposalInput } from './calendar-authority.js';
import {
  runCalendarPreflight,
  sameApprovedCondition,
} from './calendar-preflight.js';
import {
  calendarAvailabilityFingerprint,
  type CalendarAvailabilityResult,
} from '../contracts/calendar-availability.js';
import type { CalendarProposalConsumption, CalendarProposalRecord } from '../contracts/calendar-authority.js';
import { calendarProposalTombstoneSchema } from '../contracts/calendar-authority.js';
import type { CalendarView } from '../contracts/calendar-view.js';
import { calendarNotice, projectAgendaView, projectOutcomeView, projectProposalView } from './calendar-view.js';
import type { CalendarAccountBinding, CalendarResolvedTarget } from '../contracts/calendar-discovery.js';
import { projectCalendarTurnStateCompatible } from './calendar-publication.js';
import { isCalendarV2, type CalendarRuntimeDependencies, type CalendarRuntimeV2Dependencies } from './calendar-ports.js';
import type { ProcessDiagnostics } from './ports.js';
import { eventIdFor, outputId } from './identity.js';
import { attemptsFor } from './history.js';
import type { Work } from './work.js';
import { MemoryCalendarLedger } from './memory-calendar-ledger.js';
import type { MemoryCalendarStage } from './memory-calendar-state.js';

/** Volatile evidence is deliberately separate from persistence and ownership. */
export type CalendarMemoryExecution = {
  stage: MemoryCalendarStage;
  records: readonly MessageRecord[];
  pendingProposal: boolean;
  promote: (cursor: CalendarCursor, refs: CalendarRefs) => Promise<{
    lease: ExecutionLease; binding: CalendarConnectionBinding; ledger: CalendarTurnLedger;
  }>;
};

export type CalendarLoopContext = {
  persistence: PersistenceBundle;
  calendar: CalendarRuntimeDependencies;
  ledger: CalendarTurnLedger | MemoryCalendarLedger;
  attempt: AttemptRecord;
  input: MessageRecord;
  snapshot: RuntimeConfigSnapshot;
  limits: CalendarLimits;
  binding: CalendarConnectionBinding;
  context: AssembledContext;
  job: Work;
  lease: ExecutionLease | null;
  emitCalendar: (event: any) => Promise<void>;
  /** The shared protocol-3 frame sequence. It is never reset mid-turn. */
  sequence: { value: number };
  assets: FixedAssets;
  manifest: AgentMemoryManifest;
  assistantSequence: number;
  fetcher: typeof fetch;
  now: () => string;
  diagnostics?: ProcessDiagnostics;
  historicalGroups?: ReadonlyMap<string, readonly CompatibleCalendarToolGroup[]>;
  initialGroups?: readonly CompatibleCalendarToolGroup[];
  memory?: CalendarMemoryExecution;
  responseMode?: 'text' | 'voice';
  onView?: (view: CalendarView) => void;
  assistantFields?: () => Pick<MessageRecord, 'mode' | 'visibility' | 'voiceSessionId' | 'canvasArtifacts'>;
};

/**
 * Each kind is charged when the Calendar HTTP adapter is about to dispatch one
 * REST request. Pagination and capability rechecks therefore consume budget per
 * actual delivery, while model/logical-tool retries are not debited separately.
 */

/**
 * The bounded question asked when a reply engages a pending proposal without
 * answering it. The proposal stays pending; the user is asked once more.
 */
function ambiguousReplyText(proposal: CalendarProposalRecord): string {
  if (proposal.purpose === 'selection') return 'Which calendar should I schedule the event on?';
  if (proposal.purpose === 'details') return 'Please provide the scheduling details I still need.';
  return 'Should I create the event anyway, or would you like a different time?';
}

/**
 * User-facing text for a recoverable Calendar failure. The accepted user
 * message was valid; the model tool call or provider response still needs a
 * conversational answer rather than a failed attempt.
 */
function messageForCalendarFailure(failure: CalendarFailure): string {
  switch (failure.code) {
    case 'TIME_REQUIRES_CLARIFICATION':
      return 'I need an unambiguous date, start time, end time and timezone.';
    case 'TIMED_EVENT_REQUIRED':
      return 'I can only schedule timed events. Please give an unambiguous start and end time.';
    case 'SUMMARY_REQUIRES_CLARIFICATION':
      return 'What should I call this event?';
    case 'CALENDAR_TARGET_UNKNOWN':
    case 'CALENDAR_TARGET_AMBIGUOUS':
    case 'CALENDAR_DEFAULT_UNAVAILABLE':
    case 'CALENDAR_PRIMARY_MISSING':
      return 'Which calendar should I use?';
    case 'CALENDAR_INPUT_REJECTED':
      return 'The Calendar request needs corrected inputs. Please try again.';
    case 'CALENDAR_TARGET_READ_ONLY':
      return 'The selected calendar is read-only. Please choose a calendar where you have permission to create events.';
    case 'CALENDAR_RECONNECT_REQUIRED':
    case 'RECONNECT_REQUIRED':
      return 'Your Google Calendar connection needs to be reconnected.';
    case 'EVENT_NOT_FOUND':
    case 'EVENT_GONE':
      return 'I could not find that event.';
    case 'CALENDAR_FORBIDDEN':
    case 'CALENDAR_EXECUTION_DENIED':
    case 'CALENDAR_UNKNOWN_TOOL':
    case 'UNKNOWN_OR_DISABLED_TOOL':
    case 'FORBIDDEN_TOOL_FIELD':
    case 'OPERATION_AUTHORITY_REQUIRED':
      return 'The Calendar request is not allowed.';
    default:
      return failure.category === 'clarification'
        ? 'The Calendar request needs corrected inputs. Please try again.'
        : 'The Calendar request could not be completed.';
  }
}

/**
 * Infrastructure failures still abort the turn. Model-tool and provider-result
 * failures are sealed as assistant answers instead.
 */
function abortForCalendarFailure(failure: CalendarFailure): AppError | null {
  if (failure.category === 'cancelled') {
    return new AppError('INTERRUPTED', 'The Calendar request was cancelled.', false);
  }
  if (failure.category === 'persistence') {
    return new AppError('PERSISTENCE_ERROR', 'The Calendar request could not be saved.', false);
  }
  if (failure.category === 'budget') {
    if (failure.code === 'CONTEXT_BUDGET_EXCEEDED' || failure.code === 'INPUT_TOO_LARGE') {
      return new AppError('CONTEXT_BUDGET_EXCEEDED', 'This chat has reached its context limit. Start a new chat.', false);
    }
    return new AppError('STORAGE_BUDGET_EXCEEDED', 'The Calendar request budget is exhausted.', false);
  }
  return null;
}

function isConversationalCalendarFailure(failure: CalendarFailure): boolean {
  return failure.category === 'clarification'
    || failure.category === 'policy'
    || failure.category === 'credential'
    || failure.category === 'delivery'
    || failure.category === 'structural'
    || failure.category === 'uncertain';
}

function sameCalendarCall(left: CalendarCall, right: CalendarCall): boolean {
  if (left.name !== right.name) return false;
  const normalize = (call: CalendarCall) => call.name === 'calendar_check_availability' && call.arguments.calendarIds
    ? { ...call.arguments, calendarIds: [...call.arguments.calendarIds].sort() } : call.arguments;
  return isDeepStrictEqual(normalize(left), normalize(right));
}

export class CalendarLoop {
  private ownedLease(): ExecutionLease {
    if (!this.ctx.lease || this.ctx.memory) throw new AppError('NOT_READY', 'Calendar progress must be saved before access.');
    return this.ctx.lease;
  }
  private durableLedger(): CalendarTurnLedger {
    if (this.ctx.ledger instanceof MemoryCalendarLedger) throw new AppError('NOT_READY', 'Calendar progress must be saved before access.');
    return this.ctx.ledger;
  }
  private async promote(): Promise<void> {
    const memory = this.ctx.memory;
    if (!memory) return;
    const promoted = await memory.promote(this.cursor, this.refs());
    this.ctx.job.check();
    this.ctx.lease = promoted.lease; this.ctx.binding = promoted.binding; this.ctx.ledger = promoted.ledger;
    this.ctx.memory = undefined;
    this.cursor = calendarCursorSchema.parse({ ...this.cursor, connectionId: promoted.binding.connectionId,
      connectionRevision: promoted.binding.connectionRevision, accountSubjectId: promoted.binding.googleSubjectId });
    await this.requireDispatchAllowed();
  }
  private groups: (CompleteCalendarToolGroup | z.infer<typeof completeToolGroupV2Schema>)[] = [];
  private proposalSources: CalendarSourceReferenceV2[] = [];
  private volatileSourceIds = new Set<string>();
  private cursor: CalendarCursor;
  private lastText = '';
  private truncated = false;
  private lastDecisionId: string | null = null;
  private textDecisionId: string | null = null;
  private dispatchIds: string[] = [];
  private view: CalendarView | undefined;
  private lastOperationId: string | null = null;
  private lastIntentId: string | null = null;
  private lastProposalId: string | null = null;
  private lastProposalRevision = 1;
  /** Hidden model-only note after a confirmed create is busy or fails. */
  private modelNote: string | null = null;
  private task: 'success' | 'clarification' | 'fallback' | 'denied' | 'failed' | 'cancelled' |
    'uncertain' | 'not-applicable' | 'unknown' = 'not-applicable';
  private writeCertainty: 'not-applicable' | 'not-sent' | 'confirmed' | 'unknown' = 'not-applicable';
  diagnosticOutcome() { return { task: this.task, writeCertainty: this.writeCertainty }; }
  private setTask(task: CalendarLoop['task'], writeCertainty?: CalendarLoop['writeCertainty']) {
    if (this.writeCertainty === 'confirmed' && writeCertainty && writeCertainty !== 'confirmed') {
      if (task !== 'not-applicable') this.task = task;
      return;
    }
    if ((this.task === 'fallback' || this.task === 'success') && task === 'not-applicable') return;
    this.task = task;
    if (writeCertainty) this.writeCertainty = writeCertainty;
  }

  constructor(private readonly ctx: CalendarLoopContext) {
    this.groups = [...ctx.initialGroups ?? []];
    this.cursor = calendarCursorSchema.parse({
      version: 2, schemaRevision: 'google-calendar.v2', configRevision: ctx.snapshot.revision,
      connectionId: ctx.binding.connectionId, connectionRevision: ctx.binding.connectionRevision,
      accountSubjectId: ctx.binding.googleSubjectId, deadlineAt: ctx.ledger.deadlineAt(),
      trustedNow: ctx.now(), trustedTimeZone: ctx.calendar.trustedTimeZone, limits: ctx.limits,
      next: 'decide', pendingDecisionId: null, pendingToolCallId: null, pendingOperationId: null,
      pendingIntentId: null, pendingProposalId: null, repair: null,
    });
  }

  initialCursor() { return this.cursor; }
  resume(job: Work, emit?: CalendarLoopContext['emitCalendar']): void { this.ctx.job = job; if (emit) this.ctx.emitCalendar = emit; }
  toolGroups(): readonly CompatibleCalendarToolGroup[] { return structuredClone(this.groups); }
  narration() { return this.lastText; }
  viewSnapshot(): CalendarView | undefined { return this.view; }
  private captureView(view: CalendarView | null): void {
    if (!view) return;
    this.view = view;
    this.ctx.onView?.(view); // internal assignment hook; no IO or awaiting
    if (this.ctx.responseMode !== 'voice') return;
    const frame = calendarMultiStreamEnvelopeSchema.parse({ protocolVersion: 3,
      sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
      attemptId: this.ctx.attempt.attemptId, sequence: this.ctx.sequence.value++,
      event: { type: 'calendar-view', view } });
    try { void this.ctx.emitCalendar(frame).catch(() => undefined); }
    catch { /* Calendar authority is independent of visual transport. */ }
  }
  provenance() {
    if (this.task === 'fallback' || this.task === 'denied' || this.task === 'failed'
      || this.task === 'cancelled') {
      return [];
    }
    return [...this.groups.flatMap<NonNullable<MessageRecord['sourceProvenance']>[number]>(group => group.sources),
      ...this.proposalSources];
  }

  /**
   * Completes the turn with a bounded assistant answer. Recoverable Calendar
   * failures use this instead of aborting the accepted user request.
   */
  private async answerAndSeal(
    input: GraphInput,
    text: string,
    decisionId: string | null = null,
  ): Promise<CalendarGraphPatch> {
    this.lastText = text;
    if (decisionId) this.lastDecisionId = decisionId;
    this.cursor = calendarCursorSchema.parse({
      ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null,
    });
    return this.seal(input);
  }

  private async failConversationally(
    input: GraphInput,
    failure: CalendarFailure,
    decisionId: string | null = null,
    tool?: CalendarCall['name'],
  ): Promise<CalendarGraphPatch> {
    const abort = abortForCalendarFailure(failure);
    if (abort) throw abort;
    if (failure.category === 'credential' || failure.code === 'CALENDAR_EXECUTION_DENIED') {
      diagnose(this.ctx.diagnostics?.emit, { stage: 'authority', state: 'rejected', reason: 'access-denied',
        code: failure.code, decisionId: decisionId ?? undefined, tool, origin: 'local', delivery: 'not-sent' });
    }
    if (failure.code === 'CALENDAR_INPUT_REJECTED' || failure.category === 'delivery') this.setTask('fallback');
    else if (failure.category === 'uncertain') this.setTask('uncertain', 'unknown');
    else if (failure.category === 'policy' || failure.category === 'credential') this.setTask('denied', 'not-sent');
    else if (failure.category === 'clarification') this.setTask('clarification', 'not-sent');
    else this.setTask('fallback');
    const message = messageForCalendarFailure(failure);
    const readTool = tool === 'calendar_list_events' || tool === 'calendar_get_event'
      || tool === 'calendar_list_calendars' || tool === 'calendar_check_availability';
    if (readTool && this.view?.kind !== 'outcome') {
      this.captureView(calendarNotice('failed', message, { tool }));
    }
    return this.answerAndSeal(input, message, decisionId);
  }

  /** Reuse the charged schema-repair loop for invalid reads and redundant calls. */
  private async correctToolCall(
    input: GraphInput,
    decision: CalendarDecision & { kind: 'tool' },
    diagnostics: CalendarRepairDiagnostics,
  ): Promise<CalendarGraphPatch> {
    const budget = await this.ctx.ledger.ensureBudget();
    const evidence = {
      schemaVersion: 1 as const, kind: 'calendar-rejected-decision' as const,
      userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId,
      turnId: this.ctx.attempt.turnId, attemptId: this.ctx.attempt.attemptId,
      decisionId: decision.decisionId, dispatchId: this.dispatchIds.at(-1)!,
      dispatchIndex: budget.modelDispatches, repairsUsed: budget.repairs,
      rawArgumentsSha256: hashPayload(JSON.stringify(decision.call.arguments)), diagnostics, createdAt: this.ctx.now(),
    };
    if (isCalendarV2(this.ctx.calendar)) {
      await this.ctx.persistence.calendarDecisionsV2.putRejected(rejectedDecisionV2Schema.parse({
        ...evidence, schemaVersion: 2, schemaRevision: 'google-calendar.v2',
      }));
    } else await this.ctx.persistence.calendarDecisions.putRejected(rejectedDecisionSchema.parse(evidence));
    return this.repairOrSeal(input, decision.decisionId, diagnostics);
  }

  private async repairOrSeal(input: GraphInput, decisionId: string,
    diagnostics: CalendarRepairDiagnostics): Promise<CalendarGraphPatch> {
    const budget = await this.ctx.ledger.ensureBudget();
    this.setTask('fallback');
    if (budget.repairs >= this.ctx.limits.repairs) {
      diagnose(this.ctx.diagnostics?.emit, { stage: 'correction', state: 'rejected',
        reason: 'budget-exhausted', code: 'REPAIR_EXHAUSTED', origin: 'local', delivery: 'not-sent',
        correctionAttempt: budget.repairs, correctionLimit: this.ctx.limits.repairs });
      return this.answerAndSeal(input,
        'I could not complete the calendar request after correcting my tool calls. You do not need to change your question. Please try again.', decisionId);
    }
    diagnose(this.ctx.diagnostics?.emit, { stage: 'correction', state: 'rejected',
      origin: 'local', delivery: 'not-sent', correctionAttempt: budget.repairs,
      correctionLimit: this.ctx.limits.repairs });
    await this.emit({ type: 'calendar-progress', phase: 'repairing' });
    this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'decide', pendingDecisionId: null,
      repair: { rejectedDecisionId: decisionId, diagnostics } });
    return { calendarCursor: this.cursor, calendarRefs: this.refs() };
  }

  private assemble(groups: readonly CompatibleCalendarToolGroup[], repair: SkillDecisionRequest['repair']) {
    const now = Date.parse(this.ctx.now());
    const historicalGroups = new Map([...this.ctx.historicalGroups ?? []].map(([turnId, history]) => [turnId, history.map(group =>
      group.sources.some(source => source.redactedAt !== null || source.permission.content === 'volatile' ||
        Date.parse(source.expiresAt) <= now || source.connectionId !== this.ctx.binding.connectionId ||
        source.connectionRevision !== this.ctx.binding.connectionRevision)
        ? { ...group, result: { ...group.result, content: JSON.stringify({ kind: 'calendar-history-unavailable', message: CALENDAR_TOMBSTONE }) }, sources: [] }
        : group)]));
    return calendarContext({
      context: this.ctx.context, acceptedInput: this.ctx.input.content, groups,
      historicalGroups,
      repair, tools: SKILL_NATIVE_TOOLS, budgets: this.ctx.snapshot.budgets, limits: this.ctx.limits,
      binding: this.ctx.binding, compatibility: 'historical',
      volatileSourceIds: this.volatileSourceIds, now, note: this.modelNote,
    });
  }

  /**
   * Persists exactly one source-free local group after the complete candidate
   * context passes assembly, so an unconfirmed disclosure never becomes loaded.
   */
  private async recordLocal(decision: Exclude<SkillDecision, { kind: 'text' }>,
    result: SkillLocalResult): Promise<void> {
    const content = serializeSkillLocalResult(result, this.ctx.limits.resultBytes);
    const group = skillGroup(decision, content);
    this.assemble([...this.groups, group], null);
    this.ctx.job.check();
    if (!this.ctx.memory && !await this.ctx.persistence.owner.fence(this.ownedLease())) {
      throw new AppError('INTERRUPTED', 'Execution ownership was lost.');
    }
    const record = localSkillResultRecordSchema.parse({
      schemaVersion: 3, protocolVersion: 'plugin-skills.v1', kind: 'calendar-tool-result',
      userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
      attemptId: this.ctx.attempt.attemptId, decisionId: decision.decisionId,
      eventId: key('calendar-tool-result-event', this.ctx.attempt.userId, decision.nativeCall.id),
      sequence: this.groups.length, toolCallId: decision.nativeCall.id, createdAt: this.ctx.now(),
      resultRef: { storage: 'local', toolCallId: decision.nativeCall.id, content },
    });
    if (this.ctx.memory) this.ctx.memory.stage.putResult(record);
    else await this.ctx.persistence.skillResults.put(record);
    this.groups.push(group);
  }

  /** A repeat of an earlier successful read is rejected before any Calendar request. */
  private repeatsEarlierRead(call: CalendarCall): boolean {
    const prior = this.groups.slice(this.groups.findLastIndex(group => group.result.name === 'calendar_create_event') + 1);
    return prior.some(group => {
      const previous = group.assistant.tool_calls[0].function;
      if (previous.name === 'activate_skill') return false;
      let stored: unknown;
      try { stored = JSON.parse(group.result.content); } catch { stored = null; }
      const localKind = stored && typeof stored === 'object' ? (stored as { kind?: unknown }).kind : undefined;
      // Discovery acknowledgements, local errors, and tombstones never prove a prior read.
      if (localKind === 'skill-disclosure' || localKind === 'skill-error'
        || localKind === 'calendar-history-unavailable') return false;
      let args: unknown;
      try { args = JSON.parse(previous.arguments); }
      catch { throw new AppError('INVALID_REQUEST', 'Calendar tool results are incomplete.', false); }
      if (previous.name === 'call_tool') {
        const envelope = callToolEnvelopeSchema.safeParse(args);
        if (!envelope.success) throw new AppError('INVALID_REQUEST', 'Calendar tool results are incomplete.', false);
        const parsed = calendarCallSchema.safeParse({ name: envelope.data.tool, arguments: envelope.data.arguments });
        if (!parsed.success) throw new AppError('INVALID_REQUEST', 'Calendar tool results are incomplete.', false);
        return sameCalendarCall(parsed.data, call);
      }
      const parsed = calendarCallSchema.safeParse({ name: previous.name, arguments: args });
      if (!parsed.success) throw new AppError('INVALID_REQUEST', 'Calendar tool results are incomplete.', false);
      return sameCalendarCall(parsed.data, call);
    });
  }

  private refs() {
    return {
      version: 3 as const,
      protocolVersion: 'plugin-skills.v1' as const,
      userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
      decisionIds: [...this.dispatchIds],
      toolCallIds: this.groups.map(group => group.result.tool_call_id),
      operationId: this.lastOperationId,
      intentId: this.lastIntentId,
      proposalId: this.lastProposalId,
      connectionId: this.ctx.binding.connectionId,
      connectionRevision: this.ctx.binding.connectionRevision,
      schemaRevision: 'google-calendar.v2' as const,
    };
  }

  /**
   * The user-facing clarification for a paused create, sealed from the exact
   * saved proposal: it names the calendar, the event, and any busy intervals or
   * incomplete-coverage reason, and offers the answers the
   * runtime accepts. It never carries operation identifiers, credentials,
   * internal revisions or copy instructions.
   *
   * ponytail: at most four busy intervals are listed; a longer list becomes
   * an explicit count and the coverage statement is never dropped.
   */
  private clarificationText(
    proposal: CalendarProposalRecord,
    condition: CalendarAvailabilityResult | null,
  ): string {
    const action = proposal.action;
    const calendar = proposal.target?.calendarLabel ?? proposal.target?.calendarId ?? 'the selected calendar';
    const event = action
      ? `"${action.summary}" on ${calendar} from ${action.start} to ${action.end} (${action.timeZone})`
      : `the requested event on ${calendar}`;
    if (condition === null) {
      const choices = proposal.candidates
        .map(candidate => `"${candidate.target.calendarLabel ?? candidate.target.calendarId}" (${candidate.target.calendarId})`);
      return `Please confirm: create ${event}?`
        + (action?.description !== undefined ? ` Description: ${JSON.stringify(action.description)}.` : '')
        + (action?.location !== undefined ? ` Location: ${JSON.stringify(action.location)}.` : '')
        + (choices.length > 0 ? ` Choose a calendar to confirm: ${choices.join(', ')}. Or reply "cancel".`
          : ' Reply yes to confirm, or cancel.');
    }
    const busy = condition.busy.slice(0, 4)
      .map(interval => `${interval.start} to ${interval.end}`);
    const found = condition.conflict === 'conflict'
      ? (busy.length > 0
          ? `I found a busy period that overlaps it${condition.busy.length > busy.length
            ? ` (${condition.busy.length} busy periods in total, including ${busy.join('; ')})` : ` (${busy.join('; ')})`}.`
          : 'I found a busy period that overlaps it.')
      : 'I could not confirm that the time is free.';
    const incomplete = condition.calendars
      .filter(entry => entry.status !== 'ok')
      .map(entry => `${entry.calendarLabel}: ${entry.reason ?? entry.status}`);
    const coverage = condition.coverage === 'incomplete'
      ? `The coverage of that time is incomplete (${incomplete.length > 0 ? incomplete.join(', ') : condition.limitations.join(', ')}).`
      : 'Google Calendar only reports opaque busy time, so transparent events (including all-day entries), declined or cancelled events, and working hours are not covered.';
    return `I can schedule ${event}. ${found} ${coverage} `
      + 'Should I create the event anyway, or would you like a different time?';
  }

  /**
   * Charges one calendar request for an imminent Calendar REST delivery.
   */
  private async chargeProviderRequest(kind: CalendarRequestKindV2): Promise<void> {
    if (!PROVIDER_REQUEST_KINDS.has(kind)) return;
    await this.durableLedger().chargeCalendarRequest(kind);
  }

  /**
   * Records the outcome of one model-requested Calendar tool call: the v2
   * source and the result reference are persisted and registered for retention
   * before the matched tool group is appended, so a group never carries a
   * source the runtime cannot restore. One group per model-requested call.
   */
  private async recordResult(
    decision: CalendarDecision & { kind: 'tool' },
    invoked: { result: unknown; source: CalendarSourceReferenceV2 },
    native: Extract<SkillDecision, { kind: 'call_tool' }>,
  ): Promise<void> {
    this.setTask('success', decision.call.name === 'calendar_create_event' ? 'confirmed' : 'not-applicable');
    if (invoked.source.permission.content === 'volatile') this.volatileSourceIds.add(invoked.source.sourceId);
    await this.ctx.persistence.calendarRetention.registerSource({
      userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, source: invoked.source,
    });
    await this.ctx.persistence.calendarResultsV2.put(calendarToolResultRecordV2Schema.parse({
      schemaVersion: 2, kind: 'calendar-tool-result',
      userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
      attemptId: this.ctx.attempt.attemptId, decisionId: decision.decisionId,
      eventId: key('calendar-tool-result-event', this.ctx.attempt.userId, decision.toolCallId),
      sequence: this.groups.length, toolCallId: decision.toolCallId, createdAt: this.ctx.now(),
      resultRef: invoked.source.permission.content === 'retained'
        ? { storage: 'retained', source: invoked.source, toolCallId: decision.toolCallId,
          operationId: null, result: invoked.result }
        : { storage: 'reference', source: invoked.source, toolCallId: decision.toolCallId,
          operationId: null, outcome: 'ok' },
    }));
    if (native.decisionId !== decision.decisionId || native.nativeCall.id !== decision.toolCallId)
      throw new AppError('NOT_READY', 'Calendar decision is unavailable.');
    this.groups.push(skillGroup(native, JSON.stringify(invoked.result), [invoked.source]));
  }

  private async emit(event: CalendarStreamEnvelope['event'] | z.infer<typeof calendarMultiStreamEnvelopeSchema>['event']) {
    if (isCalendarV2(this.ctx.calendar)) {
      const frame = calendarMultiStreamEnvelopeSchema.parse({
        protocolVersion: 3,
        sessionId: this.ctx.attempt.sessionId,
        turnId: this.ctx.attempt.turnId,
        attemptId: this.ctx.attempt.attemptId,
        sequence: this.ctx.sequence.value++,
        event,
      });
      if (this.ctx.responseMode === 'voice' && ['calendar-progress', 'calendar-operation',
        'calendar-clarification', 'calendar-view'].includes(frame.event.type)) {
        try { void this.ctx.emitCalendar(frame).catch(() => undefined); }
        catch { /* Lost presentation is not a tool failure. */ }
        return;
      }
      await this.ctx.emitCalendar(frame);
    } else {
      await this.ctx.emitCalendar(calendarStreamEnvelopeSchema.parse({
        protocolVersion: 2,
        sessionId: this.ctx.attempt.sessionId,
        turnId: this.ctx.attempt.turnId,
        attemptId: this.ctx.attempt.attemptId,
        sequence: this.ctx.sequence.value++,
        event: event as CalendarStreamEnvelope['event'],
      }));
    }
  }

  private account(): CalendarAccountBinding {
    return {
      userId: this.ctx.binding.userId,
      connectionId: this.ctx.binding.connectionId,
      connectionRevision: this.ctx.binding.connectionRevision,
      googleSubjectId: this.ctx.binding.googleSubjectId,
    };
  }

  private async requireDispatchAllowed() {
    this.ctx.job.check();
    if (Date.parse(this.ctx.ledger.deadlineAt()) <= Date.parse(this.ctx.now()))
      throw new AppError('TIMEOUT', 'The Calendar turn deadline has passed.', false);
    if (this.ctx.memory) return;
    if (!(await this.ctx.persistence.owner.fence(this.ownedLease()))) {
      throw new AppError('INTERRUPTED', 'Execution ownership was lost.');
    }
    if (isCalendarV2(this.ctx.calendar)) {
      await this.ctx.calendar.connection.requireAccountCurrent(this.ctx.binding, this.ctx.job.signal);
    } else {
      await this.ctx.calendar.connection.requireCurrent(this.ctx.binding, this.ctx.job.signal);
    }
    if (Date.parse(this.ctx.ledger.deadlineAt()) <= Date.parse(this.ctx.now())) {
      throw new AppError('TIMEOUT', 'The Calendar turn deadline has passed.', false);
    }
  }

  private policyId() {
    const id = this.ctx.snapshot.calendar?.processingPolicyId;
    if (!id) throw new AppError('NOT_READY', 'Calendar processing policy is unavailable.');
    return id;
  }

  /**
   * A content-bearing proposal may not outlive the discovery snapshot that backs
   * its calendar labels, the retention policy behind that snapshot, or the
   * audit deadline.
   * ponytail: one clamp point; a later source-specific expiry reuses this ceiling.
   */
  private async proposalContentExpiry(
    cal: CalendarRuntimeV2Dependencies,
    account: CalendarAccountBinding,
  ): Promise<string> {
    const record = await cal.connection.requireAccountCurrent(account, this.ctx.job.signal);
    const discovery = record.discovery;
    const ceilings = [
      Date.parse(this.ctx.now()) + 86400000,
      discovery ? Date.parse(discovery.expiresAt) : Number.POSITIVE_INFINITY,
      discovery ? Date.parse(discovery.retentionExpiresAt) : Number.POSITIVE_INFINITY,
      cal.auditDeadlineAt ? Date.parse(cal.auditDeadlineAt) : Number.POSITIVE_INFINITY,
    ];
    return new Date(Math.min(...ceilings)).toISOString();
  }

  /**
   * Publishes one proposal and records the disclosure it makes.
   *
   * The disclosure is bound to the attempt that made it. That binding is the
   * durable proof that the server disclosed this proposal revision, so a later
   * reply without a client reference can only be accepted when this proposal is
   * the unique unchanged disclosure of the session.
   */
  private async publishAndRecord(input: PublishProposalInput): Promise<CalendarProposalRecord> {
    const proposal = await publishProposal(input);
    const targets = [proposal.target, ...proposal.candidates.map(candidate => candidate.target)]
      .filter(target => target !== null)
      .filter((target, index, all) => all.findIndex(other => other.calendarId === target.calendarId) === index);
    const source = sourceReferenceV2Schema.parse({
      schemaVersion: 2, sourceId: key('calendar-proposal-source', proposal.proposalId, proposal.revision),
      plugin: 'google-calendar', connectionId: proposal.connectionId,
      connectionRevision: proposal.connectionRevision, operationIds: [],
      toolCallIds: [proposal.proposalId], fetchedAt: proposal.createdAt,
      expiresAt: this.ctx.calendar.permission.content === 'retained' ? proposal.contentExpiresAt : proposal.createdAt,
      redactedAt: null, permission: this.ctx.calendar.permission,
      discoveryRevision: proposal.discoveryRevision, availabilityRevision: proposal.availabilityRevision,
      calendarSetHash: null, targets: targets.map(target => ({ calendarId: target.calendarId,
        calendarLabel: this.ctx.calendar.permission.content === 'retained' ? target.calendarLabel : null })),
    });
    await this.ctx.persistence.calendarRetention.registerSource({
      userId: proposal.userId, sessionId: proposal.sessionId, source,
    });
    this.proposalSources.push(source);
    await this.ctx.persistence.calendarProposals.bindReplyReference({
      userId: this.ctx.attempt.userId,
      sessionId: this.ctx.attempt.sessionId,
      turnId: this.ctx.attempt.turnId,
      attemptId: this.ctx.attempt.attemptId,
      replyTo: { proposalId: proposal.proposalId, revision: proposal.revision },
    });
    this.captureView(projectProposalView(proposal));
    return proposal;
  }

  async decide(input: GraphInput): Promise<CalendarGraphPatch> {
    if (this.ctx.memory?.pendingProposal || (this.ctx.memory && this.ctx.attempt.calendarReplyTo)) await this.promote();
    await this.requireDispatchAllowed();

    if (!this.ctx.memory && this.dispatchIds.length === 0 && isCalendarV2(this.ctx.calendar)) {
      // The pending slot includes expired proposals: an expired disclosure must
      // be tombstoned, not silently ignored.
      const proposal = await this.ctx.persistence.calendarProposals.getCurrentSlot(
        this.ctx.attempt.userId,
        this.ctx.attempt.sessionId,
      );
      if (proposal && proposal.state === 'pending') {
        const account = this.account();
        const operationId = key('calendar-operation', this.ctx.attempt.userId, this.ctx.attempt.sessionId, proposal.intentId);
        // A message that is not an answer to this proposal may not consume it.
        // It stays pending and the message is answered as ordinary
        // Calendar-capable text below.
        const replyDecision = readCalendarReply(this.ctx.input.content, proposal).decision;
        if (replyDecision !== 'unrelated') {
          // A reply may only answer the current pending proposal. A client
          // reference is untrusted and must name the current proposal revision;
          // a reply without one is only accepted when the server can prove a
          // unique unchanged disclosure. Otherwise the runtime asks which
          // proposal is meant and has no effect on any proposal, account or
          // operation.
          const replyTo = this.ctx.attempt.calendarReplyTo !== undefined
            ? this.ctx.attempt.calendarReplyTo
            : await this.ctx.persistence.calendarProposals.getReplyReference(
              this.ctx.attempt.userId, this.ctx.attempt.sessionId, this.ctx.attempt.attemptId);
          const target = await resolveReplyTarget({
            proposals: this.ctx.persistence.calendarProposals,
            userId: this.ctx.attempt.userId,
            sessionId: this.ctx.attempt.sessionId,
            proposal,
            replyTo,
            // The attempt list is only needed to prove the disclosure ledger.
            attempts: replyTo ? [] : await attemptsFor(
              this.ctx.persistence, this.ctx.attempt.userId, this.ctx.attempt.sessionId),
          });
          if (target.outcome === 'not-current') {
            this.lastText = 'Which current scheduling request do you mean?';
            this.captureView(calendarNotice('clarification', this.lastText,
              { proposalId: proposal.proposalId, intentId: proposal.intentId }));
            this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null });
            return this.seal(input);
          }
        }
        const replyResult = await consumeOrTombstoneProposal({
          account,
          proposal,
          replyMessage: this.ctx.input,
          replyTurnId: this.ctx.attempt.turnId,
          operationId,
          clock: () => Date.parse(this.ctx.now()),
          proposals: this.ctx.persistence.calendarProposals,
        });

        if (replyResult.outcome === 'expired') {
          this.lastText = 'The scheduling confirmation has expired. Please state your scheduling request again.';
          this.captureView(calendarNotice('expired', this.lastText,
            { proposalId: proposal.proposalId, intentId: proposal.intentId }));
          this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null });
          return this.seal(input);
        }
        if (replyResult.outcome === 'cancelled') {
          this.lastText = 'Scheduling has been cancelled.';
          this.captureView(calendarNotice('cancelled', this.lastText,
            { proposalId: proposal.proposalId, intentId: proposal.intentId }));
          this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null });
          return this.seal(input);
        }
        if (replyResult.outcome === 'clarify' && replyResult.reason !== 'edit') {
          // Incomplete/ambiguous replies retain the actual pending proposal.
          this.captureView(projectProposalView(proposal));
          if (replyResult.reason === 'incomplete') {
            // The proposal is explicitly incomplete. It stays pending until a
            // complete proposal supersedes it.
            this.lastText = proposal.purpose === 'selection'
              ? 'Which calendar should I schedule the event on?'
              : 'Please provide the missing scheduling details before I schedule the event.';
            this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null });
            return this.seal(input);
          }
          if (replyDecision === 'select') {
            // A named calendar that is not one of the disclosed candidates still
            // needs the user to choose between them.
            this.lastText = 'Which calendar should I schedule the event on?';
            this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null });
            return this.seal(input);
          }
          // The reply engages the proposal without answering it. The proposal
          // stays pending and the runtime asks again instead of answering the
          // message as ordinary chat.
          this.lastText = ambiguousReplyText(proposal);
          this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null });
          return this.seal(input);
        }
        if (replyResult.outcome === 'unrelated') {
          // The message is not an answer to this proposal. The proposal stays
          // pending and the message is answered as ordinary Calendar-capable
          // text below, with no effect.
        }
        if (replyResult.outcome === 'authorized') {
          const sealed = await this.executeAuthorizedProposal(
            input, proposal, replyResult.choiceTarget, replyResult.consumption);
          if (sealed) return sealed;
        }
      }
    }

    const repair = this.cursor.repair;
    const assembled = this.assemble(this.groups, repair);
    const reason = repair ? 'schema-repair' : this.dispatchIds.length ? 'continuation' : 'initial';
    const reserve = () => this.ctx.ledger.reserveDispatch(reason, assembled, repair);
    // Budget creation and reservation are storage-only and retain separate
    // acknowledgments inside the existing bounded ownership phase. The model
    // dispatch fence/account gate still runs afterwards, outside this phase.
    const owner = this.ctx.persistence.owner;
    const dispatch = !this.ctx.memory && owner.runPhase
      ? await this.ctx.job.wait(owner.runPhase(this.ownedLease(), {
          name: 'model-observation', maxOperations: 4,
          deadlineAt: Math.min(Date.now() + this.ctx.snapshot.budgets.persistenceTimeoutMs,
            Date.parse(this.ownedLease().leaseExpiresAt) - 1000),
        }, reserve), this.ctx.snapshot.budgets.persistenceTimeoutMs)
      : await reserve();
    this.dispatchIds.push(dispatch.dispatchId);
    const binding = await this.ctx.ledger.bindingFor(dispatch);
    if (!isCalendarV2(this.ctx.calendar)) throw new AppError('NOT_READY', 'Calendar v2 is required.');
    const adapter = this.ctx.calendar.createModelPort({
      identity: { userId: this.ctx.attempt.userId },
      openRouter: this.ctx.snapshot.openRouter, budgets: this.ctx.snapshot.budgets,
    }, this.ctx.snapshot.modelLimits!, binding, this.ctx.fetcher);
    const request = {
      dispatchId: dispatch.dispatchId, decisionId: dispatch.decisionId, user: this.ctx.attempt.openRouterUser,
      modelId: this.ctx.attempt.modelId, messages: assembled.messages, tools: SKILL_NATIVE_TOOLS,
      maxOutputTokens: this.ctx.snapshot.budgets.maxOutputTokens,
      remainingContextTokens: assembled.remainingContextTokens,
      deadlineAt: this.ctx.ledger.deadlineAt(), signal: this.ctx.job.signal,
      dataCollection: 'deny' as const, processingPolicyId: this.policyId(), repair,
    };
    let decision: SkillDecision | null = null;
    let rejectionV2: CalendarRejectedDecisionV2 | null = null;
    let failure: CalendarFailure | null = null;
    try {
      for await (const chunk of adapter.stream(request)) {
        if (chunk.type === 'decision') decision = skillDecisionSchema.parse(chunk.decision);
        else if (chunk.type === 'rejected') rejectionV2 = rejectedDecisionV2Schema.parse(chunk.evidence);
        else if (chunk.type === 'failure') failure = calendarFailureSchema.parse(chunk.failure);
        else if (chunk.type === 'text-delta') {
          this.lastText += chunk.text;
          for (let offset = 0; offset < chunk.text.length; offset += 1000) {
            await this.emit({ type: 'delta', text: chunk.text.slice(offset, offset + 1000) });
          }
        }
      }
    } catch (error) {
      if (this.ctx.memory) {
        // Consumer cancellation/output failure can close the iterator before its
        // final failure chunk. Retain the paid dispatch as terminal, with unknown
        // cost still held; cleanup grants no retry or external-access authority.
        await this.ctx.ledger.finishDispatch(dispatch.dispatchId, {
          category: this.ctx.job.signal.aborted ? 'cancelled'
            : error instanceof AppError && ['STORAGE_BUDGET_EXCEEDED', 'CONTEXT_BUDGET_EXCEEDED'].includes(error.code)
              ? 'budget' : 'uncertain',
          code: this.ctx.job.signal.aborted ? 'INTERRUPTED'
            : error instanceof AppError ? error.code : 'MODEL_STREAM_INTERRUPTED', retry: 'none',
        });
        await this.ctx.ledger.aggregate();
      }
      throw error;
    }
    await this.ctx.ledger.finishDispatch(dispatch.dispatchId, failure);
    if (rejectionV2) {
      if (this.ctx.memory) this.ctx.memory.stage.putRejected(rejectionV2);
      else await this.ctx.persistence.skillDecisions.putRejected(rejectionV2);
      return this.repairOrSeal(input, rejectionV2.decisionId, rejectionV2.diagnostics);
    }
    if (failure) {
      if (isConversationalCalendarFailure(failure)) {
        const tool = decision?.kind === 'call_tool'
          && CALENDAR_TOOLS.some(candidate => candidate.name === decision!.envelope.tool)
          ? decision.envelope.tool as CalendarCall['name'] : undefined;
        return this.failConversationally(input, failure, decision?.decisionId ?? null, tool);
      }
      const abort = abortForCalendarFailure(failure);
      if (abort) throw abort;
      throw new AppError('PROVIDER_ERROR', 'The model service could not answer.', false);
    }
    if (!decision) throw new AppError('INTERRUPTED', 'The response stream ended early.', false);
    const sources = decision.kind === 'text'
      ? this.provenance().filter(source => source.schemaVersion === 2) : [];
    const record = resumableSkillDecisionSchema.parse({
      schemaVersion: 3, protocolVersion: 'plugin-skills.v1', kind: 'calendar-model-decision',
      userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
      attemptId: this.ctx.attempt.attemptId, decisionId: decision.decisionId, dispatchId: dispatch.dispatchId,
      configRevision: this.ctx.snapshot.revision, connectionId: this.ctx.binding.connectionId,
      connectionRevision: this.ctx.binding.connectionRevision, schemaRevision: 'google-calendar.v2',
      rejectedDecisionId: repair?.rejectedDecisionId ?? null,
      decision: decision.kind === 'text' && sources.some(source => source.permission.content === 'volatile')
        ? null : decision,
      sources, operationId: null, intentId: null, proposalId: null, createdAt: this.ctx.now(),
    });
    if (this.ctx.memory) this.ctx.memory.stage.putDecision(record);
    else await this.ctx.persistence.skillDecisions.put(record);
    if (decision.kind !== 'text') {
      this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'execute',
        pendingDecisionId: decision.decisionId, repair: null });
      return { calendarCursor: this.cursor, calendarRefs: this.refs() };
    }
    this.lastDecisionId = decision.decisionId;
    this.lastText = decision.content;
    this.textDecisionId = decision.decisionId;
    this.truncated = decision.truncated;
    this.cursor = calendarCursorSchema.parse({
      ...this.cursor, next: 'seal', pendingDecisionId: decision.decisionId, repair: null,
    });
    return this.seal(input);
  }

  async execute(input: GraphInput): Promise<CalendarGraphPatch> {
    await this.requireDispatchAllowed();
    const decisionId = this.cursor.pendingDecisionId;
    if (!decisionId) throw new AppError('NOT_READY', 'Calendar decision is unavailable.');
    const saved = this.ctx.memory ? this.ctx.memory.stage.getDecision(decisionId)
      : await this.ctx.persistence.skillDecisions.get(this.ctx.attempt.userId, decisionId);
    const decision = saved?.schemaVersion === 3 ? saved.decision : null;
    if (!decision || decision.kind === 'text') throw new AppError('NOT_READY', 'Calendar decision is unavailable.');
    const assembled = this.assemble(this.groups, null);
    if (decision.kind === 'activate_skill') {
      const resolved = activateLocalSkill(decision.envelope, assembled.loadedSkills, this.ctx.limits.resultBytes);
      if (resolved.kind === 'skill-error') {
        await this.recordLocal(decision, resolved);
        return this.answerAndSeal(input, resolved.code === 'DISCLOSURE_BUDGET_EXCEEDED'
          ? 'That schema batch is too large. Request a smaller explicit tool selection or start a new chat.'
          : 'That plugin or tool is not available.', decision.decisionId);
      }
      try {
        await this.recordLocal(decision, resolved);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'CONTEXT_BUDGET_EXCEEDED') throw error;
        const fallback = skillError('DISCLOSURE_BUDGET_EXCEEDED', decision.envelope.plugin, null);
        await this.recordLocal(decision, fallback);
        return this.answerAndSeal(input,
          'That schema batch does not fit in this chat. Request a smaller explicit tool selection or start a new chat.',
          decision.decisionId);
      }
      this.cursor = calendarCursorSchema.parse({
        ...this.cursor, next: 'decide', pendingDecisionId: null, repair: null,
      });
      return { calendarCursor: this.cursor, calendarRefs: this.refs() };
    }
    const rejection = requireLoadedSkill(decision.envelope, assembled.loadedSkills);
    if (rejection) {
      await this.recordLocal(decision, rejection);
      if (rejection.kind === 'skill-error' && rejection.retry === 'activate-skill') {
        const code = rejection.code === 'SCHEMA_STALE' ? 'schema-stale' as const : 'schema-not-loaded' as const;
        return this.repairOrSeal(input, decision.decisionId, [{ path: 'tool', code, expected: 'bounded-value' }]);
      }
      return this.answerAndSeal(input, 'That plugin or tool is not available.', decision.decisionId);
    }
    let call: CalendarCall;
    try {
      // The established executor validator is the authority for domain arguments.
      call = validateCalendarCall({ name: decision.envelope.tool, arguments: decision.envelope.arguments },
        this.ctx.limits, this.ctx.diagnostics?.emit);
    } catch (error) {
      if (!(error instanceof CalendarToolFault)) throw error;
      if (error.failure.retry === 'schema-repair' || error.failure.code === 'CALENDAR_INPUT_REJECTED'
        || error.failure.code === 'CALENDAR_ARGUMENTS_INVALID') {
        const diagnostics: CalendarRepairDiagnostics = [{ path: 'tool_calls.arguments',
          code: 'invalid-value', expected: 'bounded-value' }];
        await this.recordLocal(decision, skillError('ARGUMENTS_INVALID', decision.envelope.plugin,
          decision.envelope.tool, diagnostics));
        return this.repairOrSeal(input, decision.decisionId, diagnostics);
      }
      return this.failConversationally(input, error.failure, decision.decisionId);
    }
    if ((call.name === 'calendar_create_event' && this.lastOperationId !== null) || this.repeatsEarlierRead(call)) {
      const current = await this.ctx.ledger.ensureBudget();
      diagnose(this.ctx.diagnostics?.emit, { stage: 'validation', state: 'rejected', reason: 'duplicate-call',
        field: 'tool_calls', expected: 'one-call', constraint: 'one-call', origin: 'local', delivery: 'not-sent',
        decisionId: decision.decisionId, toolCallId: decision.nativeCall.id, tool: call.name,
        correctionAttempt: current.repairs, correctionLimit: this.ctx.limits.repairs });
      return this.repairOrSeal(input, decision.decisionId,
        [{ path: 'tool_calls', code: 'redundant-call', expected: 'one-call' }]);
    }
    const executionDecision = { kind: 'tool' as const, decisionId: decision.decisionId,
      toolCallId: decision.nativeCall.id, call, terminal: 'tool_calls' as const };
    await this.promote();
    return call.name === 'calendar_create_event'
      ? this.executeCreateV2(input, executionDecision, decision)
      : this.executeReadV2(input, executionDecision, decision);
  }

  /**
   * The one writer that owns every mutating Calendar record. The legacy v1
   * ports are supplied for the legacy read-only path only.
   */
  private writer(): CalendarOperationWriter {
    const cal = this.ctx.calendar;
    if (!cal || !isCalendarV2(cal)) throw new AppError('NOT_READY', 'Calendar v2 is unavailable.');
    return new CalendarOperationWriter({
      operations: this.ctx.persistence.calendarOperations,
      operationsV2: this.ctx.persistence.calendarOperationsV2,
      execution: cal.execution as any,
      executionV2: cal.execution,
      write: action => this.ctx.job.wait(this.ctx.persistence.owner.run(this.ownedLease(), action),
        this.ctx.snapshot.budgets.persistenceTimeoutMs),
      ledger: this.durableLedger(),
      identity: {
        userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId,
        turnId: this.ctx.attempt.turnId, attemptId: this.ctx.attempt.attemptId,
      },
      binding: this.ctx.binding, clock: () => Date.parse(this.ctx.now()), job: this.ctx.job,
      fence: () => this.ctx.persistence.owner.fence(this.ownedLease()),
      requireCurrent: async (account, signal) => {
        await cal.connection.requireAccountCurrent(account, signal);
      },
      permission: cal.permission, trustedTimeZone: cal.trustedTimeZone,
      auditDeadlineAt: cal.auditDeadlineAt,
      chargeProviderRequest: kind => this.chargeProviderRequest(kind),
    });
  }

  /**
   * The fresh capability check of an already resolved target. It re-resolves the
   * explicit calendar id under the same subject and connection: it never
   * resolves a new default and never binds a replacement account.
   */
  private async freshCapability(input: {
    account: CalendarAccountBinding; target: CalendarResolvedTarget;
  }): Promise<{ outcome: 'ok'; target: CalendarResolvedTarget } | { outcome: 'clarify'; message: string }> {
    const cal = this.ctx.calendar;
    if (!cal || !isCalendarV2(cal)) throw new AppError('NOT_READY', 'Calendar v2 is unavailable.');
    const resolved = await cal.capabilities.resolve({
      account: input.account,
      selector: input.target.calendarId,
      operation: 'create',
      signal: this.ctx.job.signal,
      deadlineAt: this.ctx.ledger.deadlineAt(),
      consumeRequest: kind => this.chargeProviderRequest(kind),
      consumeRefreshRequest: () => this.durableLedger().chargeRefreshRequest(),
    });
    if (resolved.outcome === 'clarify') {
      return { outcome: 'clarify', message: 'That calendar is no longer available. Which calendar should I use?' };
    }
    if (resolved.outcome === 'denied') {
      return { outcome: 'clarify', message: 'Permission to schedule on this calendar was denied.' };
    }
    return { outcome: 'ok', target: resolved.target };
  }

  /**
   * The fresh server-owned availability preflight for one create.
   */
  private async freshPreflight(input: {
    action: CalendarCreateInput; target: CalendarResolvedTarget;
    intentId: string; decisionId: string; stage: 'direct-create' | 'proposal-reply';
  }): Promise<CalendarAvailabilityResult> {
    const cal = this.ctx.calendar;
    if (!cal || !isCalendarV2(cal)) throw new AppError('NOT_READY', 'Calendar v2 is unavailable.');
    const account = this.account();
    return runCalendarPreflight({
      execution: cal.execution,
      ledger: {
        chargeCalendarRequest: kind => this.durableLedger().chargeCalendarRequest(kind),
        chargeRefreshRequest: () => this.durableLedger().chargeRefreshRequest(),
      },
      account,
      sessionId: this.ctx.attempt.sessionId,
      turnId: this.ctx.attempt.turnId,
      attemptId: this.ctx.attempt.attemptId,
      decisionId: input.decisionId,
      intentId: input.intentId,
      stage: input.stage,
      action: input.action,
      trustedNow: this.ctx.now(),
      trustedTimeZone: cal.trustedTimeZone,
      deadlineAt: this.ctx.ledger.deadlineAt(),
      signal: this.ctx.job.signal,
    });
  }

  /**
   * Publishes the durable incomplete-details proposal of one accepted request.
   *
   * The proposal names the still-missing material fields and the accepted
   * message they came from. It carries no action and no canonical hash, so the
   * contract refuses to consume it until a complete proposal supersedes it.
   */
  private async publishIncompleteDetails(
    decision: CalendarDecision & { kind: 'tool' },
    missing: readonly IntentMissingField[],
  ): Promise<CalendarProposalRecord> {
    const cal = this.ctx.calendar;
    if (!cal || !isCalendarV2(cal)) throw new AppError('NOT_READY', 'Calendar v2 is unavailable.');
    const account = this.account();
    const published = await this.publishAndRecord({
      account,
      intent: {
        intentId: calendarIntentId(this.ctx.input),
        originatingTurnId: this.ctx.attempt.turnId,
        originatingAcceptedMessageId: this.ctx.input.messageId,
        originatingAttemptId: this.ctx.attempt.attemptId,
        action: decision.call.arguments as CalendarCreateInput,
        selector: null,
      },
      purpose: 'details',
      target: null,
      action: null,
      incomplete: { missing: calendarMissingFields(missing), messageRefs: [this.ctx.input.messageId] },
      candidates: [],
      conditionFingerprint: null,
      discoveryRevision: await this.currentDiscoveryRevision(cal, account),
      availabilityRevision: null,
      retentionPolicyId: cal.permission.policyId,
      contentExpiresAt: await this.proposalContentExpiry(cal, account),
      limits: this.ctx.limits,
      clock: () => Date.parse(this.ctx.now()),
      proposals: this.ctx.persistence.calendarProposals,
      sessionId: this.ctx.attempt.sessionId,
    });
    this.lastProposalId = published.proposalId;
    this.lastProposalRevision = published.revision;
    return published;
  }

  /**
   * Publishes the durable selection proposal of a request whose target is
   * unknown or unavailable.
   *
   * The proposal has no candidates and declares the missing target, so it can
   * never be consumed and no candidate is implied.
   */
  private async publishIncompleteSelection(
    account: CalendarAccountBinding,
    intent: AcceptedCalendarIntent,
  ): Promise<CalendarProposalRecord> {
    const cal = this.ctx.calendar;
    if (!cal || !isCalendarV2(cal)) throw new AppError('NOT_READY', 'Calendar v2 is unavailable.');
    const published = await this.publishAndRecord({
      account,
      intent,
      purpose: 'selection',
      target: null,
      action: null,
      incomplete: { missing: ['target'], messageRefs: [this.ctx.input.messageId] },
      candidates: [],
      conditionFingerprint: null,
      discoveryRevision: await this.currentDiscoveryRevision(cal, account),
      availabilityRevision: null,
      retentionPolicyId: cal.permission.policyId,
      contentExpiresAt: await this.proposalContentExpiry(cal, account),
      limits: this.ctx.limits,
      clock: () => Date.parse(this.ctx.now()),
      proposals: this.ctx.persistence.calendarProposals,
      sessionId: this.ctx.attempt.sessionId,
    });
    this.lastProposalId = published.proposalId;
    this.lastProposalRevision = published.revision;
    return published;
  }

  /** The discovery revision the connection currently backs its proposals with. */
  private async currentDiscoveryRevision(
    cal: CalendarRuntimeV2Dependencies,
    account: CalendarAccountBinding,
  ): Promise<number> {
    const record = await cal.connection.requireAccountCurrent(account, this.ctx.job.signal);
    return record.discovery?.discoveryRevision ?? 1;
  }

  /**
   * Withdraws a pending incomplete-details proposal.
   *
   * An incomplete proposal carries no canonical action, so no reply may consume
   * it. A complete request supersedes it and it must not answer a later reply.
   */
  private async closeIncompleteProposal(): Promise<void> {
    const proposals = this.ctx.persistence.calendarProposals;
    const proposal = await proposals.getCurrentSlot(this.ctx.attempt.userId, this.ctx.attempt.sessionId);
    if (!proposal || proposal.state !== 'pending' || proposal.incomplete === undefined) return;
    await proposals.tombstone({
      expectedRevision: proposal.revision,
      tombstone: calendarProposalTombstoneSchema.parse({
        schemaVersion: 2,
        kind: 'calendar-proposal-tombstone',
        userId: proposal.userId,
        sessionId: proposal.sessionId,
        proposalId: proposal.proposalId,
        intentId: proposal.intentId,
        revision: proposal.revision + 1,
        reason: 'superseded',
        operationId: null,
        canonicalActionHash: null,
        at: this.ctx.now(),
        unresolvedOperation: false,
      }),
    });
  }

  /**
   * Publishes the durable conflict proposal for a condition that needs explicit
   * acceptance and returns the bounded user-facing question.
   */
  private async publishConflict(input: {
    intent: AcceptedCalendarIntent; target: CalendarResolvedTarget; action: CalendarCreateInput;
    condition: CalendarAvailabilityResult; requestHash: string; account: CalendarAccountBinding;
  }): Promise<string> {
    const cal = this.ctx.calendar;
    if (!cal || !isCalendarV2(cal)) throw new AppError('NOT_READY', 'Calendar v2 is unavailable.');
    const fingerprint = calendarAvailabilityFingerprint(input.condition);
    const published = await this.publishAndRecord({
      account: input.account,
      intent: input.intent,
      purpose: 'conflict',
      target: input.target,
      action: input.action,
      candidates: [],
      conditionFingerprint: fingerprint,
      disclosedLimitations: input.condition.limitations,
      discoveryRevision: input.target.discoveryRevision,
      availabilityRevision: input.condition.availabilityRevision,
      retentionPolicyId: cal.permission.policyId,
      contentExpiresAt: await this.proposalContentExpiry(cal, input.account),
      limits: this.ctx.limits,
      clock: () => Date.parse(this.ctx.now()),
      proposals: this.ctx.persistence.calendarProposals,
      sessionId: this.ctx.attempt.sessionId,
    });
    this.lastProposalId = published.proposalId;
    this.lastProposalRevision = published.revision;
    return this.clarificationText(published, input.condition);
  }

  /**
   * The accepted reply of a consumed proposal. The single create entry point
   * owns the reservation, the dispatch and the outcome classification.
   */
  private async executeAuthorizedProposal(
    input: GraphInput,
    proposal: CalendarProposalRecord,
    choiceTarget: CalendarResolvedTarget | null,
    consumption: CalendarProposalConsumption,
  ): Promise<CalendarGraphPatch | null> {
    const cal = this.ctx.calendar;
    if (!cal || !isCalendarV2(cal)) {
      throw new AppError('NOT_READY', 'Calendar v2 is unavailable.');
    }
    const target = choiceTarget ?? proposal.target;
    if (!target) {
      return this.answerAndSeal(input, 'Which calendar should I use?');
    }
    const account = this.account();
    const rawAction = proposal.action ?? {
      summary: 'Planning',
      start: '2026-11-03T10:00:00+00:00',
      end: '2026-11-03T11:00:00+00:00',
      timeZone: cal.trustedTimeZone,
    };
    const canonicalAction = canonicalCalendarAction(rawAction, target);
    const nowIso = this.ctx.now();
    const auditCap = Date.parse(nowIso) + 2592000000;
    const auditExpiresAt = new Date(cal.auditDeadlineAt ? Math.min(Date.parse(cal.auditDeadlineAt), auditCap) : auditCap).toISOString();
    const intent: AcceptedCalendarIntent = {
      intentId: proposal.intentId,
      originatingTurnId: proposal.originatingTurnId,
      originatingAcceptedMessageId: proposal.originatingAcceptedMessageId,
      originatingAttemptId: proposal.originatingAttemptId,
      action: rawAction,
      selector: null,
    };

    this.lastProposalId = proposal.proposalId;
    this.lastProposalRevision = proposal.revision;
    await this.emit({ type: 'calendar-progress', phase: 'executing' });
    const outcome = await this.writer().executeCreate({
      intent,
      account,
      target,
      accepted: { message: this.ctx.input, turnId: this.ctx.attempt.turnId },
      proposal,
      consumption,
      action: canonicalAction,
      requestHash: consumption.canonicalActionHash,
      operationId: consumption.operationId,
      decisionId: key('dec', this.ctx.attempt.userId, this.ctx.attempt.turnId, 'proposal-decision'),
      toolCallId: key('call', this.ctx.attempt.userId, this.ctx.attempt.turnId, 'proposal-create'),
      createdAt: nowIso,
      auditExpiresAt,
      capability: input2 => this.freshCapability(input2),
      preflight: async input2 => {
        const condition = await this.freshPreflight({
          action: input2.action, target: input2.target, intentId: proposal.intentId,
          decisionId: key('dec', this.ctx.attempt.userId, this.ctx.attempt.turnId, 'proposal-decision'),
          stage: 'proposal-reply',
        });
        // The accepted condition is compared, never silently replaced.
        const stillAccepted = sameApprovedCondition({
          proposal, actionHash: consumption.canonicalActionHash, target,
          fingerprint: calendarAvailabilityFingerprint(condition),
        });
        if (stillAccepted) return null;
        // Confirm already accepted the event. Incomplete coverage is not a
        // second confirmation; only an overlapping busy interval pauses.
        return condition.conflict === 'conflict' ? condition : null;
      },
      clarifyCharge: { decisionId: key('dec', this.ctx.attempt.userId, this.ctx.attempt.turnId, 'proposal-decision') },
      clarify: async input2 => busyFact(input2.condition),
    });
    return this.finishCreate(input, outcome, {
      toolCallId: key('call', this.ctx.attempt.userId, this.ctx.attempt.turnId, 'proposal-create'),
      action: canonicalAction,
      decisionId: key('dec', this.ctx.attempt.userId, this.ctx.attempt.turnId, 'proposal-decision'),
    });
  }
  /**
   * The model-requested create. The single create entry point owns the
   * reservation, the dispatch and the outcome classification.
   */
  private async executeCreateV2(
    input: GraphInput,
    decision: CalendarDecision & { kind: 'tool' },
    native: Extract<SkillDecision, { kind: 'call_tool' }>,
  ): Promise<CalendarGraphPatch> {
    const cal = this.ctx.calendar;
    if (!cal || !isCalendarV2(cal)) {
      throw new AppError('NOT_READY', 'Calendar v2 is unavailable.');
    }

    const interpreted = readCalendarIntent(
      this.ctx.input,
      this.ctx.attempt,
      decision.call.arguments as CalendarCreateInput,
      cal.trustedTimeZone,
    );

    if (interpreted.outcome === 'not-authorized') {
      this.setTask('denied', 'not-sent');
      diagnose(this.ctx.diagnostics?.emit, { stage: 'authority', state: 'rejected',
        reason: 'access-denied', code: 'OPERATION_AUTHORITY_REQUIRED', decisionId: decision.decisionId,
        tool: decision.call.name, origin: 'local', delivery: 'not-sent' });
      this.lastText = 'I did not create an event.';
      this.lastDecisionId = decision.decisionId;
      this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null });
      return this.seal(input);
    }
    if (interpreted.outcome === 'details') {
      this.setTask('clarification', 'not-sent');
      // The accepted request is missing material details. The runtime publishes
      // an explicitly incomplete proposal: it carries no action and no
      // canonical hash, so it can never be consumed. A complete proposal has to
      // supersede it before anything is scheduled.
      await this.publishIncompleteDetails(decision, interpreted.missing);
      this.lastText = 'Please provide the missing scheduling details.';
      this.lastDecisionId = decision.decisionId;
      this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null });
      return this.seal(input);
    }

    const candidate = decision.call.arguments as CalendarCreateInput;
    await this.emit({ type: 'calendar-progress', phase: 'executing' });
    const { calendarId: suggestedSelector, ...suggestedAction } = candidate;
    const needsConfirmation = interpreted.outcome === 'confirmation';
    const intent: AcceptedCalendarIntent = interpreted.outcome === 'complete' ? interpreted.intent : {
      intentId: calendarIntentId(this.ctx.input),
      originatingTurnId: this.ctx.attempt.turnId,
      originatingAcceptedMessageId: this.ctx.input.messageId,
      originatingAttemptId: this.ctx.attempt.attemptId,
      action: suggestedAction,
      selector: suggestedSelector ?? null,
    };
    const account = this.account();
    const userSelector = intent.selector;
    const modelSelector = (decision.call.arguments as CalendarCreateInput).calendarId ?? null;

    const resolved = await cal.capabilities.resolve({
      account,
      selector: userSelector,
      operation: 'create',
      signal: this.ctx.job.signal,
      deadlineAt: this.ctx.ledger.deadlineAt(),
      consumeRequest: kind => this.chargeProviderRequest(kind),
      consumeRefreshRequest: () => this.durableLedger().chargeRefreshRequest(),
    });

    if (resolved.outcome === 'clarify') {
      let message = 'Which calendar would you like to use?';
      let proposalRecord: CalendarProposalRecord | null = null;
      if (resolved.code === 'CALENDAR_TARGET_AMBIGUOUS') {
        const names = resolved.candidates.map(c => `"${c.calendarLabel}" (${c.calendarId})`).join(', ');
        message = `I found multiple calendars matching "${userSelector}": ${names}. Please clarify which one you would like to use.`;
        proposalRecord = await this.publishAndRecord({
          account,
          intent,
          purpose: 'selection',
          target: null,
          action: intent.action,
          candidates: resolved.candidates,
          conditionFingerprint: null,
          discoveryRevision: resolved.candidates[0]?.discoveryRevision ?? 1,
          availabilityRevision: null,
          retentionPolicyId: cal.permission.policyId,
          contentExpiresAt: await this.proposalContentExpiry(cal, account),
          limits: this.ctx.limits,
          clock: () => Date.parse(this.ctx.now()),
          proposals: this.ctx.persistence.calendarProposals,
          sessionId: this.ctx.attempt.sessionId,
        });
        this.lastProposalId = proposalRecord.proposalId;
        this.lastProposalRevision = proposalRecord.revision;
      } else if (resolved.code === 'CALENDAR_TARGET_UNKNOWN') {
        message = `I could not find a calendar matching "${userSelector}". Which calendar would you like to use?`;
        proposalRecord = await this.publishIncompleteSelection(account, intent);
      } else if (resolved.code === 'CALENDAR_DEFAULT_UNAVAILABLE') {
        message = 'Your configured default calendar is unavailable. Which calendar would you like to use?';
        proposalRecord = await this.publishIncompleteSelection(account, intent);
      } else if (resolved.code === 'CALENDAR_PRIMARY_MISSING') {
        message = 'No primary calendar was found. Which calendar would you like to use?';
        proposalRecord = await this.publishIncompleteSelection(account, intent);
      }
      if (needsConfirmation && proposalRecord?.purpose === 'selection' && !proposalRecord.incomplete) {
        message = this.clarificationText(proposalRecord, null);
        this.setTask('clarification', 'not-sent');
      }

      await this.emit({
        type: 'calendar-clarification',
        proposalId: proposalRecord?.proposalId ?? key('calendar-proposal', this.ctx.attempt.userId, this.ctx.attempt.sessionId, this.ctx.attempt.turnId),
        ...(proposalRecord ? { proposalRevision: proposalRecord.revision } : {}),
        expiresAt: proposalRecord?.expiresAt ?? new Date(Date.parse(this.ctx.now()) + 600000).toISOString(),
        reason: 'target',
        message,
        candidates: resolved.candidates.slice(0, 20).map(c => ({
          calendarId: c.calendarId,
          label: c.calendarLabel,
          role: c.accessRole,
        })),
        ...(this.view?.kind === 'proposal' ? { view: this.view } : {}),
      });

      this.lastText = message;
      this.lastDecisionId = decision.decisionId;
      this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null });
      return this.seal(input);
    }

    if (resolved.outcome === 'denied') {
      this.setTask('denied', 'not-sent');
      diagnose(this.ctx.diagnostics?.emit, { stage: 'authority', state: 'rejected',
        reason: 'access-denied', code: resolved.code, decisionId: decision.decisionId,
        tool: decision.call.name, origin: 'local', delivery: 'not-sent' });
      let message = 'Permission to schedule on this calendar was denied.';
      if (resolved.code === 'CALENDAR_TARGET_READ_ONLY') {
        message = 'The selected calendar is read-only. Please choose a calendar where you have permission to create events.';
      } else if (resolved.code === 'CALENDAR_RECONNECT_REQUIRED') {
        message = 'Your Google Calendar connection needs to be reconnected.';
      }
      this.lastText = message;
      this.lastDecisionId = decision.decisionId;
      this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null });
      return this.seal(input);
    }

    const target = resolved.target;
    if (!needsConfirmation && modelSelector !== null && modelSelector !== target.calendarId) {
      return this.answerAndSeal(
        input,
        'The Calendar request is not allowed.',
        decision.decisionId,
      );
    }

    const canonicalAction = canonicalCalendarAction(needsConfirmation ? intent.action : candidate, target);
    // The complete request supersedes an incomplete disclosure: it can never be
    // consumed, so it must not stay pending and answer a later reply.
    await this.closeIncompleteProposal();
    if (needsConfirmation) {
      const prior = await this.ctx.persistence.calendarOperationsV2.findSucceededByRequestHash(
        this.ctx.attempt.userId, this.ctx.attempt.sessionId, calendarActionHash(canonicalAction));
      if (prior) {
        this.setTask('success', 'confirmed');
        this.lastOperationId = prior.operationId;
        this.lastIntentId = prior.intentId;
        await this.emitOperationState();
        return this.answerAndSeal(input, createdEventText(canonicalAction), decision.decisionId);
      }
      // These are model-proposed details, not accepted authority. Only a later
      // reply to this exact saved disclosure may authorize the canonical action.
      const proposal = await this.publishAndRecord({
        account, intent, purpose: 'details', target, action: canonicalAction,
        candidates: [], conditionFingerprint: null, disclosedLimitations: [],
        discoveryRevision: target.discoveryRevision, availabilityRevision: null,
        retentionPolicyId: cal.permission.policyId,
        contentExpiresAt: await this.proposalContentExpiry(cal, account),
        limits: this.ctx.limits, clock: () => Date.parse(this.ctx.now()),
        proposals: this.ctx.persistence.calendarProposals, sessionId: this.ctx.attempt.sessionId,
      });
      this.lastProposalId = proposal.proposalId;
      this.lastProposalRevision = proposal.revision;
      this.lastIntentId = proposal.intentId;
      this.setTask('clarification', 'not-sent');
      const message = this.clarificationText(proposal, null);
      await this.emit({ type: 'calendar-clarification', proposalId: proposal.proposalId,
        proposalRevision: proposal.revision,
        expiresAt: proposal.expiresAt, reason: 'details', message: message.slice(0, 1000), candidates: [],
        ...(this.view?.kind === 'proposal' ? { view: this.view } : {}) });
      return this.answerAndSeal(input, message, decision.decisionId);
    }
    const operationId = key('calendar-operation', this.ctx.attempt.userId, this.ctx.attempt.sessionId, intent.intentId);
    const requestHash = calendarActionHash(canonicalAction);
    const nowIso = this.ctx.now();
    const auditCap = Date.parse(nowIso) + 2592000000;
    const auditExpiresAt = new Date(cal.auditDeadlineAt ? Math.min(Date.parse(cal.auditDeadlineAt), auditCap) : auditCap).toISOString();

    const outcome = await this.writer().executeCreate({
      intent,
      account,
      target,
      accepted: { message: this.ctx.input, turnId: this.ctx.attempt.turnId },
      proposal: null,
      consumption: null,
      action: canonicalAction,
      requestHash,
      operationId,
      decisionId: decision.decisionId,
      toolCallId: decision.toolCallId,
      createdAt: nowIso,
      auditExpiresAt,
      capability: input2 => this.freshCapability(input2),
      preflight: input2 => this.freshPreflight({
        action: input2.action, target: input2.target, intentId: intent.intentId,
        decisionId: decision.decisionId, stage: 'direct-create',
      }),
      clarifyCharge: { decisionId: decision.decisionId },
      clarify: async input2 => {
        const published = await this.publishConflict({
          intent, target: input2.target, action: input2.action, condition: input2.condition,
          requestHash, account,
        });
        return published;
      },
    });
    const sealed = await this.finishCreate(input, outcome, {
      toolCallId: decision.toolCallId, action: canonicalAction, decisionId: decision.decisionId, native,
    });
    if (sealed) return sealed;
    this.cursor = calendarCursorSchema.parse({
      ...this.cursor, next: 'decide', pendingDecisionId: null, repair: null,
    });
    return { calendarCursor: this.cursor, calendarRefs: this.refs() };
  }

  /**
   * Applies the outcome of the single create entry point. A created event
   * becomes one complete tool group; a clarification, a failure and an unknown
   * outcome become one bounded assistant answer.
   */
  private async finishCreate(
    input: GraphInput,
    outcome: CalendarCreateOutcome,
    context: { toolCallId: string; action: CalendarCreateInput; decisionId: string;
      native?: Extract<SkillDecision, { kind: 'call_tool' }> },
  ): Promise<CalendarGraphPatch | null> {
    if (outcome.outcome === 'created') {
      this.setTask('success', 'confirmed');
      this.lastOperationId = outcome.operation.operationId;
      this.lastIntentId = outcome.operation.intentId;
      this.lastProposalId = outcome.operation.authorization.proposalId;
      // The write and matching success event are already durable. Publish the
      // receipt now; retention/result/checkpoint work still gates turn completion.
      await this.emitOperationState();
      if (outcome.source.permission.content === 'volatile') {
        this.volatileSourceIds.add(outcome.source.sourceId);
      }
      await this.ctx.persistence.calendarRetention.registerSource({
        userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, source: outcome.source,
      });
      await this.ctx.persistence.calendarResultsV2.put(calendarToolResultRecordV2Schema.parse({
        schemaVersion: 2, kind: 'calendar-tool-result',
        userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
        attemptId: this.ctx.attempt.attemptId, decisionId: context.decisionId,
        eventId: key('calendar-tool-result-event', this.ctx.attempt.userId, context.toolCallId),
        sequence: this.groups.length, toolCallId: context.toolCallId, createdAt: this.ctx.now(),
        resultRef: outcome.source.permission.content === 'retained'
          ? { storage: 'retained', source: outcome.source, toolCallId: context.toolCallId,
            operationId: outcome.operation.operationId, result: outcome.result }
          : { storage: 'reference', source: outcome.source, toolCallId: context.toolCallId,
            operationId: outcome.operation.operationId, outcome: 'ok' },
      }));
      if (context.native) {
        this.groups.push(skillGroup(context.native, JSON.stringify(outcome.result), [outcome.source]));
      }
      // The durable API receipt is authoritative. Never ask the model to
      // narrate or repeat a successful write, even after a model tool call.
      this.lastText = createdEventText(context.action);
      this.lastDecisionId = context.decisionId;
      this.cursor = calendarCursorSchema.parse({
        ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null,
      });
      for (let offset = 0; offset < this.lastText.length; offset += 1000) {
        await this.emit({ type: 'delta', text: this.lastText.slice(offset, offset + 1000) });
      }
      return this.seal(input);
    }

    if (outcome.outcome === 'existing') {
      this.setTask('success', 'confirmed');
      this.lastOperationId = outcome.operation.operationId;
      this.lastIntentId = outcome.operation.intentId;
      this.lastText = outcome.operation.action
        ? createdEventText(outcome.operation.action)
        : outcome.message;
      this.lastDecisionId = context.decisionId;
      this.cursor = calendarCursorSchema.parse({
        ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null,
      });
      await this.emitOperationState();
      for (let offset = 0; offset < this.lastText.length; offset += 1000) {
        await this.emit({ type: 'delta', text: this.lastText.slice(offset, offset + 1000) });
      }
      return this.seal(input);
    }

    // A changed preflight can still need a conversational clarification before
    // any write. Actual write outcomes are authoritative and never go to the LLM.
    if (this.dispatchIds.length === 0 && outcome.outcome === 'clarify') {
      this.setTask('clarification', 'not-sent');
      this.modelNote = handoffNote(outcome.message);
      return null;
    }

    if (outcome.outcome === 'clarify') {
      this.setTask('clarification', 'not-sent');
      this.lastText = outcome.message;
      const proposal = this.lastProposalId
        ? await this.ctx.persistence.calendarProposals.getCurrent(
            this.ctx.attempt.userId, this.ctx.attempt.sessionId)
        : null;
      if (proposal) {
        const reason = proposal.purpose === 'selection' ? 'target'
          : proposal.purpose === 'details' ? 'details'
          : proposal.disclosedLimitations.length > 0 ? 'coverage' : 'conflict';
        await this.emit({
          type: 'calendar-clarification',
          proposalId: proposal.proposalId,
          proposalRevision: proposal.revision,
          expiresAt: proposal.expiresAt,
          reason,
          message: outcome.message.slice(0, 1000),
          candidates: proposal.candidates.slice(0, 20).map(c => ({
            calendarId: c.target.calendarId,
            label: c.target.calendarLabel,
            role: c.target.accessRole,
          })),
          ...(this.view?.kind === 'proposal' ? { view: this.view } : {}),
        });
      }
    } else {
      this.setTask(outcome.outcome === 'failed' ? 'failed' : 'uncertain',
        outcome.outcome === 'failed' ? 'not-sent' : 'unknown');
      this.lastOperationId = outcome.operation.operationId;
      this.lastIntentId = outcome.operation.intentId;
      this.lastText = outcome.message;
    }
    this.lastDecisionId = context.decisionId;
    this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'seal', pendingDecisionId: null, repair: null });
    if (outcome.outcome !== 'clarify') await this.emitOperationState();
    return this.seal(input);
  }

  /**
   * The durable operation state is always projected through the publication
   * projection, so the receipt rules are the single source of truth.
   */
  private async emitOperationState(): Promise<void> {
    const projected = await projectCalendarTurnStateCompatible(
      this.ctx.persistence, this.ctx.attempt.userId, this.ctx.attempt.sessionId, this.ctx.attempt.turnId,
      Date.parse(this.ctx.now()));
    if (!projected) return;
    if ('schemaVersion' in projected) {
      this.captureView(projectOutcomeView(projected));
      await this.emit({ type: 'calendar-operation', operation: projected });
      return;
    }
    await this.emit({ type: 'calendar-operation', operation: projected });
  }
  private async executeReadV2(
    input: GraphInput,
    decision: CalendarDecision & { kind: 'tool' },
    native: Extract<SkillDecision, { kind: 'call_tool' }>,
  ): Promise<CalendarGraphPatch> {
    const cal = this.ctx.calendar;
    if (!cal || !isCalendarV2(cal)) {
      throw new AppError('NOT_READY', 'Calendar v2 is unavailable.');
    }
    await this.emit({ type: 'calendar-progress', phase: 'executing' });
    const account = this.account();
    const readTool = decision.call.name === 'calendar_create_event' ? null : decision.call.name;
    const readSelector = (decision.call.arguments as { calendarId?: string }).calendarId ?? null;
    // One model-requested logical tool call, debited against the model
    // decision so an exact repeat of the same decision moves no counter.
    await this.durableLedger().chargeLogicalTool(decision.decisionId);
    const needsTarget = decision.call.name === 'calendar_list_events' || decision.call.name === 'calendar_get_event';
    if (!needsTarget) await cal.connection.requireAccountCurrent(account, this.ctx.job.signal);
    const resolved = !needsTarget ? { outcome: 'resolved' as const, target: null } : await cal.capabilities.resolve({
      account,
      selector: readSelector,
      operation: 'read',
      signal: this.ctx.job.signal,
      deadlineAt: this.ctx.ledger.deadlineAt(),
      consumeRequest: kind => this.chargeProviderRequest(kind),
      consumeRefreshRequest: () => this.durableLedger().chargeRefreshRequest(),
    });
    if (resolved.outcome !== 'resolved') {
      // An unknown, ambiguous or unauthorized selector is a bounded
      // clarification, never a provider error or a failed user request.
      if (resolved.outcome === 'denied') {
        this.setTask('denied');
        diagnose(this.ctx.diagnostics?.emit, { stage: 'authority', state: 'rejected',
          reason: 'access-denied', code: resolved.code, decisionId: decision.decisionId,
          tool: decision.call.name, origin: 'local', delivery: 'not-sent' });
        const message = messageForCalendarFailure({ category: 'policy', code: resolved.code, retry: 'none' });
        this.captureView(calendarNotice('unavailable', message, { tool: readTool }));
        return this.answerAndSeal(input, message, decision.decisionId);
      }
      this.setTask('clarification', 'not-sent');
      const message = resolved.candidates.length > 0
        ? `Which calendar should I use? ${resolved.candidates
          .map(candidate => candidate.calendarLabel ?? candidate.calendarId).join(' or ')}.`
        : 'Which calendar should I use?';
      this.captureView(calendarNotice('clarification', message, { tool: readTool }));
      return this.answerAndSeal(input, message, decision.decisionId);
    }
    const binding: CalendarExecutionBindingV2 = {
      ...account,
      target: resolved.target,
      operation: null,
      sessionId: this.ctx.attempt.sessionId,
      turnId: this.ctx.attempt.turnId,
      attemptId: this.ctx.attempt.attemptId,
      decisionId: decision.decisionId,
      toolCallId: decision.toolCallId,
      schemaRevision: 'google-calendar.v2',
      trustedNow: this.ctx.now(),
      trustedTimeZone: cal.trustedTimeZone,
      deadlineAt: this.ctx.ledger.deadlineAt(),
    };
    const invoked = await cal.execution.invoke({
      binding,
      call: decision.call,
      signal: this.ctx.job.signal,
      consumeRequest: async kind => {
        await this.chargeProviderRequest(kind);
      },
      consumeRefreshRequest: async () => {
        await this.durableLedger().chargeRefreshRequest();
      },
    });
    if (invoked.outcome !== 'success') {
      if (invoked.failure.category === 'clarification' && invoked.failure.code === 'CALENDAR_INPUT_REJECTED') {
        const diagnostics: CalendarRepairDiagnostics = [{
          path: 'pageToken' in decision.call.arguments ? 'pageToken' : 'tool_calls.arguments',
          code: 'invalid-value', expected: 'bounded-value',
        }];
        await this.recordLocal(native, skillError('ARGUMENTS_INVALID', native.envelope.plugin,
          native.envelope.tool, diagnostics));
        return this.repairOrSeal(input, native.decisionId, diagnostics);
      }
      return this.failConversationally(input, invoked.failure, decision.decisionId, decision.call.name);
    }
    const agenda = projectAgendaView(decision.call, invoked.result, invoked.source, cal.trustedTimeZone);
    if (agenda) this.captureView(agenda);
    else if (invoked.result.tool === 'calendar_check_availability') {
      const r = invoked.result;
      this.captureView(calendarNotice('read-completed', r.coverage === 'complete'
        ? 'Availability checked. Clear time is not a reservation.'
        : 'Availability checked with incomplete coverage.', { tool: r.tool, coverage: r.coverage,
          conflict: r.conflict, limitations: r.limitations }));
    } else if (invoked.result.tool === 'calendar_list_calendars') {
      const r = invoked.result;
      this.captureView(calendarNotice('read-completed', `${r.calendars.length} calendars returned${r.truncated || !r.complete
        ? '; more or unavailable calendars may exist' : ''}.`, { tool: r.tool,
        coverage: r.complete ? 'complete' : 'incomplete', limitations: r.limitations }));
    }
    await this.recordResult(decision, invoked, native);
    this.cursor = calendarCursorSchema.parse({
      ...this.cursor, next: 'decide', pendingDecisionId: null, repair: null,
    });
    return { calendarCursor: this.cursor, calendarRefs: this.refs() };
  }

  async seal(input: GraphInput): Promise<CalendarGraphPatch> {
    const run = async (): Promise<CalendarGraphPatch> => {
    if (!this.lastText.trim()) {
      throw new AppError('PROVIDER_ERROR', 'The model returned an empty answer. Please try again.', false);
    }
    if (this.dispatchIds.length) await this.ctx.ledger.aggregate();
    const assistantFields = { ...(this.ctx.input.mode ? { mode: this.ctx.input.mode } : {}),
      ...(this.ctx.input.visibility ? { visibility: this.ctx.input.visibility } : {}),
      ...(this.ctx.input.voiceSessionId ? { voiceSessionId: this.ctx.input.voiceSessionId } : {}),
      ...(this.ctx.assistantFields?.() ?? {}) };
    const assistant: MessageRecord = {
      schemaVersion: 1, userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId,
      turnId: this.ctx.attempt.turnId, attemptId: this.ctx.attempt.attemptId,
      messageId: outputId(this.ctx.attempt),
      eventId: eventIdFor(this.ctx.attempt.userId, this.ctx.attempt.sessionId, outputId(this.ctx.attempt)),
      sequence: this.ctx.assistantSequence, role: 'assistant', content: this.lastText,
      createdAt: this.ctx.now(), completionStatus: 'streaming', truncated: false,
      ...assistantFields,
      ...(this.view ? { calendarView: this.view } : {}),
    };
    bounded(messageRecordSchema, assistant, key('message', assistant.userId, assistant.sessionId, assistant.messageId),
      this.ctx.snapshot.budgets.maxMessageBytes);
    const history = this.ctx.memory?.records ?? await this.ctx.persistence.messages.getReferences(
      this.ctx.attempt.userId, this.ctx.attempt.sessionId, this.ctx.manifest.messageRefs);
    const target = buildReferenceManifest(this.ctx.attempt.userId, this.ctx.attempt.sessionId,
      this.ctx.manifest.contextVersion + 1,
      [...history.filter(m => m.messageId !== this.ctx.input.messageId), this.ctx.input,
        { ...assistant, completionStatus: this.truncated ? 'truncated' : 'completed', truncated: this.truncated }],
      this.ctx.assets, this.ctx.persistence.memory.budgets);
    if (!this.ctx.memory && !this.textDecisionId && !this.lastProposalId) {
      const decisionId = key('calendar-local-narration', this.ctx.attempt.userId,
        this.ctx.attempt.sessionId, this.ctx.attempt.attemptId);
      const sources = this.provenance().filter(source => source.schemaVersion === 2);
      await this.ctx.persistence.skillDecisions.put(resumableSkillDecisionSchema.parse({
        schemaVersion: 3, protocolVersion: 'plugin-skills.v1', kind: 'calendar-model-decision',
        userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
        attemptId: this.ctx.attempt.attemptId, decisionId,
        dispatchId: this.dispatchIds.at(-1) ?? key('calendar-local-dispatch-ref', this.ctx.attempt.attemptId),
        configRevision: this.ctx.snapshot.revision, connectionId: this.ctx.binding.connectionId,
        connectionRevision: this.ctx.binding.connectionRevision, schemaRevision: 'google-calendar.v2',
        rejectedDecisionId: null, sources,
        decision: sources.some(source => source.permission.content === 'volatile') ? null
          : { kind: 'text', decisionId, content: this.lastText, truncated: this.truncated },
        operationId: this.lastOperationId, intentId: this.lastIntentId, proposalId: this.lastProposalId,
        createdAt: this.ctx.attempt.createdAt,
      }));
      this.textDecisionId = decisionId;
    }
    const narrationRef = this.textDecisionId
      ? { kind: 'text-decision' as const, decisionId: this.textDecisionId }
      : this.lastProposalId
      ? { kind: 'proposal-message' as const, proposalId: this.lastProposalId,
          proposalRevision: this.lastProposalRevision }
      : { kind: 'text-decision' as const,
          decisionId: this.lastDecisionId ?? this.dispatchIds.at(-1) ?? dispatchFallback(this.ctx.attempt.attemptId) };
    const seal = calendarSealSchema.parse({
      version: 2, input, base: boundaryFor(this.ctx.manifest), target,
      narrationRef,
      dispatchIds: this.dispatchIds, operationId: this.lastOperationId, outcome: this.truncated ? 'truncated' : 'completed',
      assistantCreatedAt: assistant.createdAt,
      ...(this.view ? { view: this.view } : {}),
      assistantFields,
    });
    this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'seal' });
    return { calendarCursor: this.cursor, calendarSeal: seal, calendarRefs: this.refs() };
    };
    return this.ctx.diagnostics ? this.ctx.diagnostics.run({ databasePhase: 'seal' }, run) : run();
  }
}

function dispatchFallback(attemptId: string) {
  return key('calendar-final', attemptId);
}

/** Receipt text for a proposal-authorized create. The model does not narrate it. */
function createdEventText(action: CalendarCreateInput): string {
  return `Created "${action.summary}" from ${action.start} to ${action.end} (${action.timeZone}).`;
}

/** Facts for a busy preflight after the user already confirmed the event. */
function busyFact(condition: CalendarAvailabilityResult): string {
  const busy = condition.busy.slice(0, 4)
    .map(interval => `${interval.start} to ${interval.end}`);
  return busy.length > 0
    ? `No Calendar event was created. The requested time overlaps busy periods (${busy.join('; ')}).`
    : 'No Calendar event was created. The requested time is not free.';
}

/** Hidden instruction so the model can explain a failed or busy create. */
function handoffNote(detail: string): string {
  return `${detail} Explain this to the user and ask what they want to do instead. `
    + 'Do not claim the event was created.';
}
