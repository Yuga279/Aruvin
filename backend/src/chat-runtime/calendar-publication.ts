/**
 * ============================================================================
 * FILE: calendar-publication.ts
 * LOCATION: backend/src/chat-runtime/calendar-publication.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Project the durable Calendar turn state and publish one saved Calendar seal.
 *
 * ROLE IN PROJECT:
 *    Owns the truthful read model of a Calendar turn and the Calendar-specific
 *    durable publication of a saved seal. The projection branches on the schema
 *    of the operation that is actually stored, so a receipt is never inferred
 *    from assistant prose, from the latest default calendar, or from the
 *    current account gate.
 *
 * KEY COMPONENTS:
 *    - projectCalendarTurnState: Legacy v1 receipt projection (unchanged).
 *    - projectCalendarTurnStateCompatible: v1/v2 branch on the stored operation.
 *    - publishCalendarTurn: Durable publication of one saved v2 seal.
 * ============================================================================
 */

import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import {
  calendarCompatibleTurnStateSchema,
  calendarMultiStreamEnvelopeSchema,
  calendarTurnStateSchema,
  calendarTurnStateV2Schema,
  safeCalendarLinkSchema,
  type CalendarTurnState,
} from '../contracts/calendar-wire.js';
import type { CalendarOperationV2 } from '../contracts/calendar-operations.js';
import type { PersistenceBundle } from '../persistence/persistence.js';
import type { AttemptRecord } from '../contracts/attempt.js';
import type { ExecutionLease, MessageRepository } from '../contracts/repositories.js';
import type { MessageRecord } from '../contracts/message.js';
import type { AgentMemoryManifest } from '../contracts/agent-memory.js';
import type { ConfirmedRecord } from '../persistence/confirmed-record.js';
import type { AcceptanceRecord } from '../persistence/ownership.js';
import type { CalendarSeal } from '../agent/state.js';
import { AppError } from '../platform/errors/app-error.js';
import { latestAttempt } from './history.js';
import { eventIdFor, outputId } from './identity.js';
import { advanceAttempt, terminal, type GraphSnapshot } from './finalization.js';
import type { Work } from './work.js';
import { redactCalendarMessage } from '../persistence/calendar-records.js';

export type CalendarTurnStateV2 = z.infer<typeof calendarTurnStateV2Schema>;
export type CalendarCompatibleTurnState = z.infer<typeof calendarCompatibleTurnStateSchema>;
export type CalendarMultiStreamEvent = z.infer<typeof calendarMultiStreamEnvelopeSchema>['event'];

export async function projectCalendarTurnState(
  persistence: PersistenceBundle,
  userId: string,
  sessionId: string,
  turnId: string,
  now = Date.now(),
): Promise<CalendarTurnState | null> {
  const operation = await persistence.calendarOperations?.getByTurn(userId, sessionId, turnId);
  if (!operation) return null;
  const attempt = await latestAttempt(persistence, userId, sessionId, turnId);
  const narration = attempt.status === 'completed' || attempt.status === 'truncated' ? 'completed'
    : attempt.status === 'failed' ? 'failed'
    : attempt.status === 'interrupted' || attempt.status === 'cancelled' ? 'interrupted'
    : 'pending';
  const events = await persistence.calendarOperations.listEvents({
    userId, operationId: operation.operationId, cursor: null, limit: 20,
  });
  const confirmed = operation.state !== 'succeeded'
    || events.items.some(item => item.state === 'succeeded' && item.sequence === operation.sequence);
  if (operation.state === 'succeeded' && !confirmed) {
    return calendarTurnStateSchema.parse({
      operationId: operation.operationId, state: 'dispatching', narration,
      retryAction: 'none', receipt: null,
    });
  }
  let receipt: CalendarTurnState['receipt'] = null;
  if (operation.state === 'succeeded' && operation.receipt) {
    const source = operation.receipt.source;
    const contentUsable = source.permission.content === 'retained' && source.redactedAt === null
      && Date.parse(source.expiresAt) > now;
    const link = contentUsable ? safeCalendarLinkSchema.safeParse(operation.receipt.htmlLink) : null;
    receipt = {
      durable: true, eventId: operation.googleEventId,
      htmlLink: link?.success ? link.data : null,
      expiresAt: contentUsable ? source.expiresAt : null,
    };
  }
  const retryAction = operation.state === 'unknown' ? 'resume-reconciliation'
    : operation.state === 'evidence-expired' ? 'blocked-expired'
    : 'none';
  return calendarTurnStateSchema.parse({
    operationId: operation.operationId, state: operation.state, narration, retryAction, receipt,
  });
}

/**
 * Projects one Calendar turn from the durable operation that actually exists.
 *
 * The legacy v1 projection is reused unchanged for a v1 operation. A v2
 * operation is projected from its own operation record, its own durable event
 * history, the attempt that produced it and the retained source evidence, so a
 * confirmed receipt survives a failed narration, an interrupted turn, a later
 * default-calendar change and an expired source.
 */
export async function projectCalendarTurnStateCompatible(
  persistence: PersistenceBundle,
  userId: string,
  sessionId: string,
  turnId: string,
  now = Date.now(),
): Promise<CalendarCompatibleTurnState | null> {
  const store = persistence.calendarOperationsV2;
  if (!store) return projectCalendarTurnState(persistence, userId, sessionId, turnId, now);
  const operation = await store.getByTurn(userId, sessionId, turnId);
  if (!operation) return null;
  if (operation.schemaVersion === 1) {
    return projectCalendarTurnState(persistence, userId, sessionId, turnId, now);
  }
  return projectCalendarTurnStateV2(persistence, operation, now);
}

async function projectCalendarTurnStateV2(
  persistence: PersistenceBundle,
  operation: CalendarOperationV2,
  now: number,
): Promise<CalendarTurnStateV2> {
  const attempt = await attemptOf(persistence, operation.userId, operation.sessionId, operation.turnId);
  const confirmed = operation.state !== 'succeeded' || await succeededEventDurable(persistence, operation);
  const state = operation.state === 'succeeded' && !confirmed ? 'dispatching' : operation.state;
  let receipt: CalendarTurnStateV2['receipt'] = null;
  if (state === 'succeeded' && operation.receipt) {
    const source = operation.receipt.source;
    const contentUsable = source.permission.content === 'retained' && source.redactedAt === null
      && Date.parse(source.expiresAt) > now;
    const link = contentUsable ? safeCalendarLinkSchema.safeParse(operation.receipt.htmlLink) : null;
    // The label is exposed only while the label-specific expiry permits it and
    // the source that carries it is still retained, unredacted and unexpired.
    const labelUsable = contentUsable
      && operation.receipt.calendarLabel !== null && operation.receipt.labelExpiresAt !== null
      && Date.parse(operation.receipt.labelExpiresAt) > now
      && Date.parse(operation.receipt.labelExpiresAt) <= Date.parse(source.expiresAt);
    receipt = {
      durable: true,
      eventId: operation.googleEventId,
      htmlLink: link?.success ? link.data : null,
      expiresAt: labelUsable ? operation.receipt.labelExpiresAt!
        : contentUsable ? source.expiresAt : null,
      calendarLabel: labelUsable ? operation.receipt.calendarLabel : null,
    };
  }
  const narration = narrationOf(attempt, operation);
  const retryAction = await retryActionOf(persistence, operation, state);
  return calendarTurnStateV2Schema.parse({
    schemaVersion: 2,
    operationId: operation.operationId,
    proposalId: operation.authorization.proposalId,
    intentId: operation.intentId,
    state,
    narration,
    retryAction,
    receipt,
  });
}

/**
 * The narration describes the assistant narration of the Calendar outcome.
 * A published answer is `completed`. A turn that is still running is
 * `pending`. A turn that ended with a durable operation outcome but without a
 * published answer is a `failed` narration: the effect survived and the
 * narration did not. A turn that ended before any outcome existed is
 * `interrupted`.
 */
function narrationOf(
  attempt: AttemptRecord | null,
  operation: CalendarOperationV2,
): 'pending' | 'completed' | 'failed' | 'interrupted' {
  if (!attempt) return 'pending';
  if (attempt.status === 'completed' || attempt.status === 'truncated') return 'completed';
  if (attempt.status === 'accepted' || attempt.status === 'generating' || attempt.status === 'finalizing') {
    return 'pending';
  }
  if (attempt.status === 'cancelled') return 'interrupted';
  if (operation.state !== 'planned' && operation.state !== 'dispatching') return 'failed';
  return 'interrupted';
}

async function retryActionOf(
  persistence: PersistenceBundle,
  operation: CalendarOperationV2,
  state: string,
): Promise<'none' | 'resume-reconciliation' | 'reconnect' | 'clarify' | 'blocked-expired'> {
  if (state === 'succeeded') return 'none';
  if (operation.state === 'evidence-expired') return 'blocked-expired';
  if (operation.state === 'unknown' || state === 'dispatching') return 'resume-reconciliation';
  const proposal = await persistence.calendarProposals?.getCurrent(operation.userId, operation.sessionId);
  if (proposal && proposal.state === 'pending' && proposal.intentId === operation.intentId) return 'clarify';
  const connection = await persistence.calendarConnectionsV2?.get(operation.userId);
  // The current account gate, not the operation, decides whether the user has
  // to reconnect before the turn can continue.
  if (!connection
    || connection.status === 'reconnect-required' || connection.status === 'disconnected'
    || connection.connectionId !== operation.connectionId
    || connection.connectionRevision !== operation.connectionRevision) {
    return 'reconnect';
  }
  return 'none';
}

/**
 * A succeeded operation is only reported as succeeded when its own durable
 * event confirms the transition.
 */
async function succeededEventDurable(
  persistence: PersistenceBundle,
  operation: CalendarOperationV2,
): Promise<boolean> {
  const events = await persistence.calendarOperationsV2.listEventsV2({
    userId: operation.userId, sessionId: operation.sessionId, operationId: operation.operationId,
  });
  return events.some(event => event.state === 'succeeded'
    && event.sequence === operation.sequence && event.revision === operation.revision);
}

async function attemptOf(
  persistence: PersistenceBundle,
  userId: string,
  sessionId: string,
  turnId: string,
): Promise<AttemptRecord | null> {
  try {
    return await latestAttempt(persistence, userId, sessionId, turnId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

export type CalendarTurnPublication = {
  persistence: PersistenceBundle;
  work: Work;
  lease: ExecutionLease;
  attempt: AttemptRecord;
  /** The saved seal. Its target manifest and narration reference are authoritative. */
  seal: CalendarSeal;
  /** The exact retained narration, or null when the narration evidence is missing or expired. */
  narration: string | null;
  sources?: MessageRecord['sourceProvenance'];
  assistantFields?: Pick<MessageRecord, 'mode' | 'visibility' | 'voiceSessionId' | 'canvasArtifacts'>;
  now?: () => number;
  assistantSequence: number;
  persistenceTimeoutMs: number;
  /** Publishes the graph boundary that must follow the committed manifest. */
  commitBoundary?: () => Promise<void>;
  /**
   * The live-only evidence the current owned execution already holds.
   *
   * Recovery omits it and keeps the strict source reads and status CAS.
   */
  liveEvidence?: {
    attemptReceipt: ConfirmedRecord<AttemptRecord> | null;
    confirmedSnapshot: GraphSnapshot;
    baseManifest: AgentMemoryManifest;
    acceptedInput: MessageRecord;
    acceptance: AcceptanceRecord;
  };
  /**
   * Runs after the terminal attempt state is durable and before the terminal
   * frame is emitted. Zero-argument legacy callbacks remain valid.
   */
  beforeTerminal?: (completion: {
    attempt: AttemptRecord;
    receipt: ConfirmedRecord<AttemptRecord> | null;
    activityAt: string | null;
  }) => Promise<void>;
  /** Emits one protocol-3 frame. The sequence stays monotonic for the emitter. */
  emit?: (envelope: z.infer<typeof calendarMultiStreamEnvelopeSchema>) => Promise<void>;
  /** The shared frame sequence of the emitter; it is never reset mid-turn. */
  sequence?: { value: number };
};

/**
 * Publishes one saved Calendar seal.
 *
 * The durable order is the one already used by the runtime: the assistant
 * message, its completion, the committed manifest, the graph boundary that
 * follows it, and only then the terminal attempt state. A saved assistant
 * message with the exact content is reused instead of appended twice, and a
 * missing or expired narration leaves the narration incomplete while the
 * durable receipt stays intact.
 */
export async function publishCalendarTurn(input: CalendarTurnPublication): Promise<{
  assistantMessageId: string | null;
  status: AttemptRecord['status'];
}> {
  const { persistence: p, work, lease, attempt: a, seal, narration, assistantSequence } = input;
  const timeout = input.persistenceTimeoutMs;
  const messageId = outputId(a);
  const messages = p.messages as MessageRepository;
  const archive = async (): Promise<MessageRecord | null> => {
    let assistant: MessageRecord | null = null;
    if (narration !== null) {
      if (!narration.trim()) throw new AppError('PROVIDER_ERROR', 'The saved Calendar answer is empty.', false);
      // Live publication already owns this attempt. Insert confirmation handles
      // duplicate/ambiguous appends; its opaque receipt pins completion's CAS.
      // Recovery keeps the original strict content read and replay path.
      const confirmed = input.liveEvidence && typeof messages.appendConfirmed === 'function'
        && typeof messages.updateCompletionConfirmed === 'function';
      const existing = confirmed ? null : await p.messages.get(a.userId, a.sessionId, messageId);
      let assistantReceipt: ConfirmedRecord<MessageRecord> | null = null;
      if (existing) {
        if (existing.content !== narration) {
          throw new AppError('PERSISTENCE_ERROR', 'The saved narration does not match the published answer.', false);
        }
        if (seal.version === 2 && seal.view && existing.calendarView
          && !isDeepStrictEqual(existing.calendarView, seal.view)) {
          throw new AppError('PERSISTENCE_ERROR', 'The saved Calendar view does not match the published answer.', false);
        }
        assistant = existing;
      } else {
        assistant = {
          schemaVersion: 1, userId: a.userId, sessionId: a.sessionId, turnId: a.turnId, attemptId: a.attemptId,
          messageId, eventId: eventIdFor(a.userId, a.sessionId, messageId), sequence: assistantSequence,
          role: 'assistant', content: narration, createdAt: seal.assistantCreatedAt,
          completionStatus: 'streaming', truncated: false,
          ...(seal.version === 2 ? seal.assistantFields : {}),
          ...input.assistantFields,
          ...(seal.version === 2 && seal.view ? { calendarView: seal.view } : {}),
          ...(input.sources?.length ? { sourceProvenance: input.sources } : {}),
        };
        await work.wait(p.owner.run(lease, async () => {
          const record = redactCalendarMessage(assistant!, input.now?.() ?? Date.now());
          if (confirmed) assistantReceipt = await p.messages.appendConfirmed!(record);
          else await p.messages.append(record);
        }), timeout);
      }
      await work.wait(p.owner.run(lease, async () => {
        if (assistantReceipt && p.messages.updateCompletionConfirmed) {
          await p.messages.updateCompletionConfirmed(assistantReceipt, seal.outcome, seal.outcome === 'truncated');
        } else await p.messages.updateCompletion(
          a.userId, a.sessionId, messageId, seal.outcome, seal.outcome === 'truncated');
      }), timeout);
      await work.wait(p.owner.run(lease, () => p.sessions.touchActivity(
        a.userId, a.sessionId, assistant!.createdAt)), timeout);
    }
    await work.wait(p.owner.run(lease, () => p.memory.put(seal.target)), timeout);
    return assistant;
  };
  const phase = input.liveEvidence && typeof p.owner.runPhase === 'function';
  const assistant = phase ? await work.wait(p.owner.runPhase(lease, {
    name: 'publication-stage', maxOperations: 4,
    deadlineAt: Math.min(Date.now() + timeout, Date.parse(lease.leaseExpiresAt) - 1000),
  }, archive), timeout) : await archive();
  if (input.commitBoundary) await input.commitBoundary();
  const status: AttemptRecord['status'] = narration === null
    ? 'interrupted'
    : seal.outcome === 'truncated' ? 'truncated' : 'completed';
  // A terminal attempt is never regressed: republishing a saved seal keeps the
  // state it already reached and only confirms the durable message again.
  let current = a;
  let attemptReceipt = input.liveEvidence?.attemptReceipt ?? null;
  const complete = async () => {
    if (!terminal(a.status)) {
      const finalizing = await advanceAttempt(p, lease, work, current, attemptReceipt, 'finalizing');
      current = finalizing.attempt; attemptReceipt = finalizing.receipt;
      const completed = await advanceAttempt(p, lease, work, current, attemptReceipt, status);
      current = completed.attempt; attemptReceipt = completed.receipt;
    }
  };
  if (phase) await work.wait(p.owner.runPhase(lease, {
    name: 'publication-commit', maxOperations: 2,
    deadlineAt: Math.min(Date.now() + timeout, Date.parse(lease.leaseExpiresAt) - 1000),
  }, complete), timeout);
  else await complete();
  const sequence = input.sequence;
  if (input.beforeTerminal) await input.beforeTerminal({
    attempt: current, receipt: attemptReceipt, activityAt: assistant?.createdAt ?? null,
  });
  if (input.emit) {
    const emit = async (event: CalendarMultiStreamEvent) => {
      await input.emit!(calendarMultiStreamEnvelopeSchema.parse({
        protocolVersion: 3,
        sessionId: a.sessionId,
        turnId: a.turnId,
        attemptId: a.attemptId,
        sequence: sequence ? sequence.value++ : 0,
        event,
      }));
    };
    try {
      await emit({ type: 'status', status: current.status, truncated: current.truncated });
      if (assistant) {
        // Replace provisional model preambles with the exact durable answer.
        // Small chunks keep escaped text below the protocol-3 byte cap.
        for (let offset = 0; offset < assistant.content.length; offset += 1000) {
          await emit({ type: 'delta', text: assistant.content.slice(offset, offset + 1000),
            ...(offset === 0 ? { reset: true as const } : {}) });
        }
        await emit({
          type: 'completed', assistantMessageId: assistant.messageId,
          outcome: seal.outcome,
          ...(assistant.calendarView ? { calendarView: assistant.calendarView } : {}),
        });
      }
    } catch { /* Stored status is authoritative on reconnect. */ }
  }
  return { assistantMessageId: assistant?.messageId ?? null, status: current.status };
}
