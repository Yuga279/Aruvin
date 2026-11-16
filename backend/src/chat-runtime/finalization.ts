/**
 * ============================================================================
 * FILE: finalization.ts
 * LOCATION: backend/src/chat-runtime/finalization.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Publish a sealed graph result through idempotent application finalization.
 *
 * ROLE IN PROJECT:
 *    Confirms checkpoint-complete answers, writes archive/accounting/manifest
 *    alignment, and never claims completion from provider end or pending writes.
 *
 * KEY COMPONENTS:
 *    - checkedResult: Strict linkage of saved result to accepted input.
 *    - publishResult: One storage-only publication-stage, receipt put, combined-finish skip.
 *    - transition/graphConfig: Guarded lifecycle CAS and sync graph config.
 *    - transitionConfirmed: Receipt scoped attempt CAS for the live path.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import type { PersistenceBundle } from '../persistence/persistence.js';
import type { ExecutionLease, ExecutionOwnership, MessageRepository, MetadataRepository } from '../contracts/repositories.js';
import type { AttemptRecord, AttemptStatus } from '../contracts/attempt.js';
import type { TurnGraph } from '../agent/turn-graph.js';
import { boundaryFor, resultSchema, type SavedResult } from '../agent/state.js';
import { graphThreadId } from '../persistence/index.js';
import { hashPayload } from '../platform/crypto/hash-payload.js';
import { AppError } from '../platform/errors/app-error.js';
import { buildReferenceManifest } from '../context/index.js';
import { outputId, eventIdFor } from './identity.js';
import type { Work } from './work.js';
import type { ConfirmedRecord } from '../persistence/confirmed-record.js';
import type { AcceptanceRecord } from '../persistence/ownership.js';
import type { AgentMemoryManifest } from '../contracts/agent-memory.js';
import type { MessageRecord } from '../contracts/message.js';
import type { AccountingRecord } from '../contracts/metadata.js';
import type { VoiceDeliveryRecord } from '../contracts/voice.js';
import { emptyTiming } from '../contracts/usage-evidence.js';
import { key } from '../persistence/records.js';

/** The pinned graph state a live turn already loaded before it publishes. */
export type GraphSnapshot = {
  values: {
    sealed?: boolean;
    result?: { input?: { attempt?: { attemptId?: string } } } | null;
    boundary?: unknown;
  };
  next: readonly unknown[];
  tasks: readonly { error?: unknown; interrupts?: readonly unknown[] }[];
};

/**
 * The durable evidence a live turn already holds when it publishes its answer.
 *
 * Recovery omits this parameter and keeps the strict `checkedResult` path, so
 * a replay never trusts evidence that was not observed by the same attempt.
 */
export type LivePublicationEvidence = {
  /** The accepted user input confirmed during admission. */
  acceptedInput: MessageRecord;
  /** The acceptance marker confirmed during admission. */
  acceptance: AcceptanceRecord;
  /** The manifest that was current when the turn was admitted. */
  baseManifest: AgentMemoryManifest;
  /**
   * Store-bound receipt for `baseManifest` when the live path already holds it.
   * Omitted evidence keeps the strict reread/`put` path.
   */
  baseManifestReceipt?: ConfirmedRecord<AgentMemoryManifest>;
  /** The retained messages the base manifest references. */
  sourceRecords: readonly MessageRecord[];
  /** The pinned post-invoke graph snapshot; it is never re-read. */
  confirmedSnapshot: GraphSnapshot;
  /** The confirmed attempt receipt that owns this turn. */
  attemptReceipt: ConfirmedRecord<AttemptRecord> | null;
  /** The confirmed accounting receipt to supersede. */
  accountingReceipt: ConfirmedRecord<AccountingRecord> | null;
  /** Latest confirmed voice delivery record when live voice already holds it. */
  voiceDelivery?: VoiceDeliveryRecord | null;
  /** Receives every newly confirmed attempt receipt. */
  onAttemptConfirmed?: (receipt: ConfirmedRecord<AttemptRecord>) => void;
  /** Receives the confirmed receipt for the published target manifest. */
  onManifestConfirmed?: (receipt: ConfirmedRecord<AgentMemoryManifest>) => void;
  /** Receives the confirmed checkpoint id after graph boundary seal. */
  onBoundaryConfirmed?: (checkpointId: string) => void;
  /**
   * Caller commitment that `finishAttempt` will own session activity.
   * W1 sets `true` only for non-voice live text with finishAttempt, attempt
   * receipt, and compareAttemptConfirmed. Omitted recovery/voice/fallback keep
   * the early touch. Presence of `onAttemptConfirmed` is not this commitment.
   */
  activityUpdatedByFinish?: true;
};

export const graphConfig = (u: string, s: string) => ({ configurable: { thread_id: graphThreadId(u, s), checkpoint_ns: '' }, durability: 'sync' as const });
export const terminal = (s: AttemptStatus) => ['completed', 'truncated', 'failed', 'cancelled', 'interrupted'].includes(s);
export async function transition(p: PersistenceBundle, lease: ExecutionLease, work: Work,
  a: AttemptRecord, status: AttemptStatus, errorCode: AttemptRecord['errorCode'] = null): Promise<AttemptRecord> {
  const next = { ...a, status, errorCode, truncated: status === 'truncated', updatedAt: new Date().toISOString() };
  const ok = await work.wait(p.owner.run(lease, () => p.metadata.compareAttempt(next, a.status)), p.metadata.budgets.persistenceTimeoutMs);
  if (!ok) throw new AppError('CONFLICT_ACTIVE_TURN', 'Turn state changed.');
  return next;
}

/**
 * Advances an attempt from a confirmed receipt.
 *
 * The receipt pins the exact stored revision, so a stale holder can never
 * turn a conflict into a confirmed terminal state.
 */
export async function transitionConfirmed(p: PersistenceBundle, lease: ExecutionLease, work: Work,
  expected: ConfirmedRecord<AttemptRecord>, status: AttemptStatus,
  errorCode: AttemptRecord['errorCode'] = null, patch: Partial<AttemptRecord> = {}): Promise<ConfirmedRecord<AttemptRecord>> {
  const compare = (p.metadata as MetadataRepository).compareAttemptConfirmed;
  if (!compare) throw new AppError('NOT_READY', 'Confirmed attempt evidence is unavailable.');
  const next = { ...expected.record, ...patch, status, errorCode, truncated: status === 'truncated', updatedAt: new Date().toISOString() };
  return work.wait(p.owner.run(lease, async () => {
    const result = await compare.call(p.metadata, expected, next);
    if (result.outcome !== 'confirmed') throw new AppError('CONFLICT_ACTIVE_TURN', 'Turn state changed.');
    return result.receipt;
  }), p.metadata.budgets.persistenceTimeoutMs);
}

/**
 * Advances an attempt with a confirmed receipt when the store supports it and
 * keeps the status scoped CAS everywhere else.
 */
export async function advanceAttempt(p: PersistenceBundle, lease: ExecutionLease, work: Work,
  a: AttemptRecord, receipt: ConfirmedRecord<AttemptRecord> | null, status: AttemptStatus,
  errorCode: AttemptRecord['errorCode'] = null, patch: Partial<AttemptRecord> = {}): Promise<{ attempt: AttemptRecord; receipt: ConfirmedRecord<AttemptRecord> | null }> {
  if (receipt && (p.metadata as MetadataRepository).compareAttemptConfirmed) {
    const next = await transitionConfirmed(p, lease, work, receipt, status, errorCode, patch);
    return { attempt: next.record, receipt: next };
  }
  return { attempt: await transition(p, lease, work, { ...a, ...patch }, status, errorCode), receipt: null };
}

export async function checkedResult(p: PersistenceBundle, a: AttemptRecord, raw: SavedResult,
  evidence?: LivePublicationEvidence): Promise<SavedResult> {
  const r = resultSchema.parse(raw); const saved = r.input.attempt;
  const strip = (v: AttemptRecord) => { const { status, updatedAt, generationId, truncated, errorCode, ...rest } = v;
    void status; void updatedAt; void generationId; void truncated; void errorCode; return rest; };
  const input = evidence ? evidence.acceptedInput
    : await p.messages.get(a.userId, a.sessionId, a.causal.userMessageId);
  const marker = evidence ? evidence.acceptance
    : await p.metadata.getAcceptance(a.userId, a.sessionId, a.attemptId);
  if (!input || !marker || !isDeepStrictEqual(strip(saved), strip(a)) || input.role !== 'user' ||
    input.turnId !== a.turnId || hashPayload(input.content) !== a.payloadHash || marker.payloadHash !== a.payloadHash ||
    marker.userMessageId !== input.messageId || marker.turnId !== a.turnId ||
    r.assistant.role !== 'assistant' || r.assistant.messageId !== outputId(a) ||
    r.assistant.eventId !== eventIdFor(a.userId, a.sessionId, outputId(a)) ||
    r.assistant.userId !== a.userId || r.assistant.sessionId !== a.sessionId ||
    r.assistant.turnId !== a.turnId || r.assistant.attemptId !== a.attemptId ||
    r.assistant.sequence !== r.input.assistantSequence || r.assistant.completionStatus !== 'streaming' || r.assistant.truncated ||
    r.accounting.userId !== a.userId || r.accounting.sessionId !== a.sessionId || r.accounting.turnId !== a.turnId ||
    r.accounting.attemptId !== a.attemptId || r.accounting.requestedModel !== a.modelId ||
    r.accounting.generationId !== a.generationId ||
    r.target.userId !== a.userId || r.target.sessionId !== a.sessionId ||
    r.target.contextVersion !== r.base.contextVersion + 1 || r.base.contextVersion !== a.contextVersion ||
    r.target.instructionVersion !== a.instructionVersion || r.target.knowledgeContentHash !== a.knowledgeContentHash ||
    r.target.graphSchemaVersion !== a.graphSchemaVersion || r.target.activeSummaryRef !== null ||
    (input.visibility === 'internal' && input.mode === 'live'
      ? r.assistant.visibility !== 'internal' || r.assistant.mode !== 'live'
      : r.assistant.visibility === 'internal' || r.assistant.mode === 'live'))
    throw new AppError('NOT_READY', 'The saved answer needs recovery.');
  if (input.visibility === 'internal' && input.mode === 'live') {
    const delivery = evidence?.voiceDelivery !== undefined
      ? evidence.voiceDelivery
      : await p.metadata.getVoiceDelivery(a.userId, a.sessionId, a.attemptId);
    const expectedResponseId = key('voice-response', a.userId, a.sessionId, a.attemptId);
    if (delivery) {
      if (delivery.userId !== a.userId || delivery.sessionId !== a.sessionId ||
        delivery.turnId !== a.turnId || delivery.attemptId !== a.attemptId ||
        delivery.voiceSessionId !== input.voiceSessionId || delivery.responseId !== expectedResponseId)
        throw new AppError('NOT_READY', 'Saved voice delivery linkage disagrees.');
      const journalArtifacts = delivery.canvasArtifacts ?? [];
      const assistantArtifacts = r.assistant.canvasArtifacts ?? [];
      if (!isDeepStrictEqual(journalArtifacts, assistantArtifacts))
        throw new AppError('NOT_READY', 'Saved visual projections disagree with voice delivery.');
    } else if (r.assistant.canvasArtifacts?.length) {
      throw new AppError('NOT_READY', 'Missing voice delivery journal for canvas artifacts.');
    }
  }
  const current: AgentMemoryManifest | null = evidence ? evidence.baseManifest : await p.memory.get(a.userId, a.sessionId);
  if (!current) throw new AppError('NOT_READY', 'Chat context needs recovery.');
  const history = evidence ? evidence.sourceRecords
    : await p.messages.getReferences(a.userId, a.sessionId, current.messageRefs);
  const prior = history.filter(m => m.messageId !== input.messageId && m.messageId !== r.assistant.messageId);
  const expected = buildReferenceManifest(a.userId, a.sessionId, r.target.contextVersion,
    [...prior, input, { ...r.assistant, completionStatus: r.outcome, truncated: r.outcome === 'truncated' }],
    { instructions: '', knowledge: '', instructionVersion: a.instructionVersion,
      knowledgeContentHash: a.knowledgeContentHash, graphSchemaVersion: a.graphSchemaVersion }, p.memory.budgets);
  if (!isDeepStrictEqual(expected, r.target)) throw new AppError('NOT_READY', 'Saved context references disagree.');
  return r;
}
export async function publishResult(p: PersistenceBundle, lease: ExecutionLease, work: Work,
  graph: TurnGraph, a: AttemptRecord, raw: SavedResult, evidence?: LivePublicationEvidence): Promise<AttemptRecord> {
  const r = await checkedResult(p, a, raw, evidence); const cfg = graphConfig(a.userId, a.sessionId);
  const snapshot = evidence ? evidence.confirmedSnapshot : await graph.getState(cfg);
  if (!snapshot.values.sealed || snapshot.next.length || snapshot.tasks.some(t => t.error || t.interrupts?.length) ||
    snapshot.values.result?.input?.attempt?.attemptId !== a.attemptId)
    throw new AppError('NOT_READY', 'The saved graph result is not complete.');
  if (evidence?.baseManifestReceipt
    && !isDeepStrictEqual(evidence.baseManifestReceipt.record, evidence.baseManifest))
    throw new AppError('NOT_READY', 'Chat context needs recovery.');
  const manifest = evidence ? evidence.baseManifest : await p.memory.get(a.userId, a.sessionId);
  const target = boundaryFor(r.target);
  if (!manifest || (!isDeepStrictEqual(boundaryFor(manifest), r.base) && !isDeepStrictEqual(boundaryFor(manifest), target)))
    throw new AppError('NOT_READY', 'Chat context needs recovery.');
  const timeout = p.metadata.budgets.persistenceTimeoutMs;
  const messages = p.messages as MessageRepository;
  const combinedFinish = Boolean(
    evidence?.activityUpdatedByFinish === true
    && typeof (p.owner as ExecutionOwnership).finishAttempt === 'function'
    && evidence.attemptReceipt
    && (p.metadata as MetadataRepository).compareAttemptConfirmed
    && (terminal(a.status) || evidence.onAttemptConfirmed),
  );
  // The provisional assistant append and the authoritative accounting are
  // independent writes, so they are staged together instead of one after the other.
  const append = async (): Promise<ConfirmedRecord<MessageRecord> | null> => {
    if (evidence && messages.appendConfirmed) return messages.appendConfirmed.call(p.messages, r.assistant);
    const existing = await p.messages.get(a.userId, a.sessionId, r.assistant.messageId);
    if (existing) {
      const normalized = { ...existing, completionStatus: 'streaming', truncated: false };
      if (!isDeepStrictEqual(normalized, r.assistant) || !['streaming', r.outcome].includes(existing.completionStatus))
        throw new AppError('NOT_READY', 'Saved answer evidence disagrees.');
      return null;
    }
    await p.messages.append(r.assistant);
    return null;
  };
  const accounting = async (): Promise<null> => {
    const current = evidence
      ? evidence.accountingReceipt?.record ?? r.accounting
      : await p.metadata.getAccounting(a.userId, a.sessionId, a.attemptId);
    const value = { ...(current ?? r.accounting), outcome: r.outcome };
    value.timing = value.timing ?? emptyTiming();
    const put = (p.metadata as MetadataRepository).putAccountingConfirmed;
    if (evidence && put) await put.call(p.metadata, value, evidence.accountingReceipt ?? undefined);
    else await p.metadata.putAccounting(value);
    return null;
  };
  const stage = async (insidePhase: boolean): Promise<ConfirmedRecord<MessageRecord> | null> => {
    const appended = insidePhase ? p.owner.run(lease, append) : append();
    const accounted = insidePhase ? p.owner.run(lease, accounting) : accounting();
    const staged = await Promise.allSettled([appended, accounted]);
    const failure = staged.find(result => result.status === 'rejected');
    if (failure && failure.status === 'rejected') throw failure.reason;
    if (staged[0].status !== 'fulfilled') throw new AppError('PERSISTENCE_ERROR', 'The saved answer could not be published.');
    return staged[0].value;
  };
  const putManifest = async (): Promise<void> => {
    const receipt = evidence?.baseManifestReceipt;
    const putConfirmed = p.memory.putConfirmed;
    if (receipt && putConfirmed) {
      try {
        const next = await putConfirmed.call(p.memory, r.target, receipt);
        evidence?.onManifestConfirmed?.(next);
        return;
      } catch (error) {
        if (error instanceof AppError && error.code === 'CONFLICT_ACTIVE_TURN') {
          const current = await p.memory.get(a.userId, a.sessionId);
          if (current && isDeepStrictEqual(current, r.target)) return;
        }
        throw error;
      }
    }
    if (putConfirmed) {
      const next = await putConfirmed.call(p.memory, r.target);
      evidence?.onManifestConfirmed?.(next);
      return;
    }
    await p.memory.put(r.target);
  };
  const sealBoundary = async (): Promise<void> => {
    await graph.updateState(cfg, { boundary: target }, 'seal');
    const confirmed = await graph.getState(cfg);
    if (confirmed.next.length || !isDeepStrictEqual(confirmed.values.boundary, target))
      throw new AppError('PERSISTENCE_ERROR', 'Chat context save could not be confirmed.');
    const checkpointId = (confirmed as { configurable?: { checkpoint_id?: unknown }; config?: { configurable?: { checkpoint_id?: unknown } } }).configurable?.checkpoint_id
      ?? (confirmed as { config?: { configurable?: { checkpoint_id?: unknown } } }).config?.configurable?.checkpoint_id;
    if (typeof checkpointId === 'string' && checkpointId) evidence?.onBoundaryConfirmed?.(checkpointId);
  };
  const completeAssistant = async (assistantReceipt: ConfirmedRecord<MessageRecord> | null): Promise<void> => {
    const complete = messages.updateCompletionConfirmed;
    if (assistantReceipt && complete) await complete.call(messages, assistantReceipt, r.outcome, r.outcome === 'truncated');
    else await p.messages.updateCompletion(a.userId, a.sessionId, r.assistant.messageId, r.outcome, r.outcome === 'truncated');
  };
  const finishPublication = async (assistantReceipt: ConfirmedRecord<MessageRecord> | null): Promise<void> => {
    const guarded = <T>(action: () => Promise<T>): Promise<T> =>
      work.wait(p.owner.run(lease, action), timeout);
    await guarded(putManifest);
    await work.wait(sealBoundary(), timeout);
    await guarded(() => completeAssistant(assistantReceipt));
    if (!combinedFinish) await guarded(() => p.sessions.touchActivity(a.userId, a.sessionId, r.assistant.createdAt));
    let attemptReceipt = evidence?.attemptReceipt ?? null;
    if (!terminal(a.status)) {
      const advanced = await advanceAttempt(p, lease, work, a, attemptReceipt, r.outcome);
      a = advanced.attempt; attemptReceipt = advanced.receipt;
      if (attemptReceipt) evidence?.onAttemptConfirmed?.(attemptReceipt);
    }
  };
  const runPhase = (p.owner as ExecutionOwnership).runPhase;
  const phaseOptions = {
    name: 'publication-stage' as const,
    deadlineAt: Math.min(Date.now() + timeout, Date.parse(lease.leaseExpiresAt) - 1000),
    maxOperations: 8,
  };
  if (runPhase) {
    await work.wait(p.owner.runPhase(lease, phaseOptions, async () => {
      await finishPublication(await stage(true));
    }), timeout);
  } else {
    await finishPublication(await work.wait(p.owner.run(lease, async () => stage(false)), timeout));
  }
  if (a.status !== r.outcome) throw new AppError('NOT_READY', 'Turn outcome disagrees with its saved answer.');
  return a;
}
