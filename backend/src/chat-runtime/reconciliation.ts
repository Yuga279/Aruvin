/**
 * ============================================================================
 * FILE: reconciliation.ts
 * LOCATION: backend/src/chat-runtime/reconciliation.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Recover sealed results or interrupt incomplete work without model replay.
 *
 * ROLE IN PROJECT:
 *    Quiescent P5 repair uses saved graph results, confirms delayed acceptance,
 *    and finishes version rebase intent without invoking prepare or generate.
 *
 * KEY COMPONENTS:
 *    - interruptAttempt: No-result fallback, partial archive, cleared boundary.
 *    - finishRebase: Idempotent asset-version rebase from typed graph intent.
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PersistenceBundle } from '../persistence/persistence.js';
import type { ExecutionLease } from '../contracts/repositories.js';
import type { AttemptRecord } from '../contracts/attempt.js';
import type { AgentMemoryManifest } from '../contracts/agent-memory.js';
import type { FixedAssets } from '../instructions/fixed-assets.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import type { TurnGraph } from '../agent/turn-graph.js';
import type { CanvasArtifactProjection } from '../contracts/voice-wire.js';
import type { MessageRecord } from '../contracts/message.js';
import { key } from '../persistence/records.js';
import { voiceDeliveryRecordSchema } from '../contracts/voice.js';
import { buildReferenceManifest } from '../context/index.js';
import { boundaryFor, type Boundary } from '../agent/state.js';
import { AppError } from '../platform/errors/app-error.js';
import { hashPayload } from '../platform/crypto/hash-payload.js';
import { outputId, eventIdFor } from './identity.js';
import { acceptedHistory, attemptsFor } from './history.js';
import { graphConfig, terminal, transition } from './finalization.js';
import type { Work } from './work.js';
export async function interruptAttempt(options: { p: PersistenceBundle; lease: ExecutionLease; job: Work;
  graph: TurnGraph; attempt: AttemptRecord; partial: string; error: unknown; assets: FixedAssets; budgets: BudgetConfig;
  canvasArtifacts?: CanvasArtifactProjection[]; assistantSequence?: number;
  calendarView?: MessageRecord['calendarView'] }) {
  const { p, lease, job, graph, partial, budgets } = options; let a = options.attempt;
  if (terminal(a.status)) return a;
  const input = await p.messages.get(a.userId, a.sessionId, a.causal.userMessageId);
  let marker = await p.metadata.getAcceptance(a.userId, a.sessionId, a.attemptId);
  if (!marker && input && input.role === 'user' && input.turnId === a.turnId && hashPayload(input.content) === a.payloadHash) {
    await job.wait(p.owner.confirmAcceptance(lease, a.attemptId), budgets.persistenceTimeoutMs);
    marker = await p.metadata.getAcceptance(a.userId, a.sessionId, a.attemptId);
  }
  const fault = options.error instanceof AppError ? options.error : new AppError('PERSISTENCE_ERROR', 'The chat could not be saved.', false);
  const status: 'cancelled' | 'interrupted' | 'failed' = fault.code === 'CANCELLED' ? 'cancelled' : ['INTERRUPTED', 'TIMEOUT', 'NOT_READY'].includes(fault.code) ? 'interrupted' : 'failed';
  const assistantSequence = options.assistantSequence ??
    (await p.owner.allocateSequences(lease, a.attemptId, a.causal.previousAttemptId === null ? 3 : 2)).start +
      (a.causal.previousAttemptId === null ? 2 : 1);
  const isInternalLive = input?.visibility === 'internal' && input.mode === 'live';
  const delivery = isInternalLive ? await p.metadata.getVoiceDelivery(a.userId, a.sessionId, a.attemptId) : null;
  const expectedResponseId = isInternalLive ? key('voice-response', a.userId, a.sessionId, a.attemptId) : null;
  if (isInternalLive && delivery) {
    if (delivery.userId !== a.userId || delivery.sessionId !== a.sessionId ||
      delivery.turnId !== a.turnId || delivery.attemptId !== a.attemptId ||
      delivery.voiceSessionId !== input.voiceSessionId || delivery.responseId !== expectedResponseId)
      throw new AppError('NOT_READY', 'Voice delivery linkage disagrees.');
    if (options.canvasArtifacts?.length) {
      const persistedArtifacts = delivery.canvasArtifacts ?? [];
      if (options.canvasArtifacts.length > persistedArtifacts.length)
        throw new AppError('NOT_READY', 'In-memory artifacts exceed confirmed journal.');
      for (let i = 0; i < options.canvasArtifacts.length; i++) {
        if (JSON.stringify(options.canvasArtifacts[i]) !== JSON.stringify(persistedArtifacts[i]))
          throw new AppError('NOT_READY', 'In-memory artifacts disagree with confirmed journal.');
      }
    }
  }
  const existing = await p.messages.get(a.userId, a.sessionId, outputId(a));
  const artifacts = delivery?.canvasArtifacts;
  const generated = partial || delivery?.textGenerated || '';
  if (delivery && !generated.startsWith(delivery.textGenerated))
    throw new AppError('NOT_READY', 'Voice result and delivery disagree.');
  const assistantEnvelope = {
    schemaVersion: 1 as const,
    userId: a.userId,
    sessionId: a.sessionId,
    turnId: a.turnId,
    attemptId: a.attemptId,
    messageId: outputId(a),
    eventId: eventIdFor(a.userId, a.sessionId, outputId(a)),
    sequence: assistantSequence,
    role: 'assistant' as const,
    createdAt: a.updatedAt,
    completionStatus: status,
    truncated: false,
    ...(isInternalLive ? {
      visibility: 'internal' as const,
      mode: 'live' as const,
      ...(input.voiceSessionId ? { voiceSessionId: input.voiceSessionId } : {}) } : {}),
  };
  if ((generated || artifacts?.length || options.calendarView) && !existing) {
    await job.wait(p.owner.run(lease, () => p.messages.append({
      ...assistantEnvelope,
      content: generated,
      ...(artifacts?.length ? { canvasArtifacts: artifacts } : {}),
      ...(options.calendarView ? { calendarView: options.calendarView } : {}),
    })), budgets.persistenceTimeoutMs);
  } else if (existing) {
    if (existing.userId !== a.userId || existing.sessionId !== a.sessionId ||
      existing.turnId !== a.turnId || existing.attemptId !== a.attemptId ||
      existing.content !== (generated || existing.content) ||
      !isDeepStrictEqual(existing.canvasArtifacts ?? [], artifacts ?? [])) {
      throw new AppError('NOT_READY', 'Existing assistant message disagrees.');
    }
  }







  // Never overwrite an already-durable incomplete message after a crash.
  const current = await p.memory.get(a.userId, a.sessionId);
  const history = await acceptedHistory(p, a.userId, a.sessionId);
  const targetRecords = marker && input && !history.some(m => m.messageId === input.messageId) ? [...history, input] : history;
  const livePartial = input?.visibility === 'internal' && input.mode === 'live'
    ? await p.messages.get(a.userId, a.sessionId, outputId(a)) : null;
  if (livePartial && !targetRecords.some(m => m.messageId === livePartial.messageId)) targetRecords.push(livePartial);
  const assets = { ...options.assets, instructionVersion: a.instructionVersion,
    knowledgeContentHash: a.knowledgeContentHash, graphSchemaVersion: a.graphSchemaVersion };
  const candidate = buildReferenceManifest(a.userId, a.sessionId, current?.contextVersion ?? 0, targetRecords, assets, budgets);
  const next = current && JSON.stringify(current) !== JSON.stringify(candidate)
    ? { ...candidate, contextVersion: current.contextVersion + 1 } : candidate;
  await job.wait(p.owner.run(lease, () => p.memory.put(next)), budgets.persistenceTimeoutMs);
  await job.wait(graph.updateState(graphConfig(a.userId, a.sessionId), { boundary: boundaryFor(next),
    input: null, result: null, sealed: false }, 'seal'), budgets.persistenceTimeoutMs);
  const accounting = await p.metadata.getAccounting(a.userId, a.sessionId, a.attemptId);
  await job.wait(p.owner.run(lease, () => p.metadata.putAccounting({ ...(accounting ?? {
    schemaVersion: 1 as const, kind: 'accounting' as const, userId: a.userId, sessionId: a.sessionId, turnId: a.turnId,
    attemptId: a.attemptId, generationId: a.generationId, requestedModel: a.modelId, reportedModel: null, reportedProvider: null,
    promptTokens: null, completionTokens: null, cost: null, accountingStatus: a.generationId ? 'pending' as const : 'unknown' as const,
    startedAt: a.createdAt, endedAt: a.updatedAt }), outcome: status })), budgets.persistenceTimeoutMs);
  a = await transition(p, lease, job, a, status, fault.code);
  await job.wait(p.owner.clearAttempt(lease, a.attemptId), budgets.persistenceTimeoutMs);
  return a;
}
export async function finishRebase(p: PersistenceBundle, lease: ExecutionLease, job: Work, graph: TurnGraph,
  intent: { base: Boundary; target: AgentMemoryManifest }) {
  const current = await p.memory.get(lease.userId, lease.sessionId);
  const target = boundaryFor(intent.target);
  if (!current || (![intent.base, target].some(b => JSON.stringify(b) === JSON.stringify(boundaryFor(current)))))
    throw new AppError('NOT_READY', 'Version rebase evidence disagrees.');
  const snapshot = await graph.getState(graphConfig(lease.userId, lease.sessionId));
  if (snapshot.next.length || ![intent.base, target].some(b => JSON.stringify(b) === JSON.stringify(snapshot.values.boundary)))
    throw new AppError('NOT_READY', 'Version rebase graph evidence disagrees.');
  const history = await acceptedHistory(p, lease.userId, lease.sessionId);
  const verified = buildReferenceManifest(lease.userId, lease.sessionId, intent.target.contextVersion, history,
    { instructions: '', knowledge: '', instructionVersion: intent.target.instructionVersion,
      knowledgeContentHash: intent.target.knowledgeContentHash, graphSchemaVersion: intent.target.graphSchemaVersion }, p.memory.budgets);
  if (JSON.stringify(verified) !== JSON.stringify(intent.target) || current.graphSchemaVersion !== intent.target.graphSchemaVersion ||
    intent.target.contextVersion !== intent.base.contextVersion + 1)
    throw new AppError('NOT_READY', 'Version rebase history evidence disagrees.');
  await job.wait(p.owner.run(lease, () => p.memory.put(intent.target)), p.metadata.budgets.persistenceTimeoutMs);
  await job.wait(graph.updateState(graphConfig(lease.userId, lease.sessionId), { boundary: target, rebase: null }, 'seal'), p.metadata.budgets.persistenceTimeoutMs);
}
export async function hasPendingVoiceDelivery(p: PersistenceBundle, u: string, s: string) {
  // ponytail: <=100 pages x 50 attempts, one scoped read each; add a filtered metadata query if the conversation ceiling grows.
  for (const a of await attemptsFor(p, u, s)) {
    const delivery = await p.metadata.getVoiceDelivery(u, s, a.attemptId);
    if (delivery?.status === 'pending') return true;
  }
  return false;
}
export async function reconcileVoiceDeliveries(p: PersistenceBundle, lease: ExecutionLease, job: Work) {
  for (const a of await attemptsFor(p, lease.userId, lease.sessionId)) {
    const input = await p.messages.get(a.userId, a.sessionId, a.causal.userMessageId);
    if (input?.visibility !== 'internal' || input.mode !== 'live') continue;
    const assistant = await p.messages.get(a.userId, a.sessionId, outputId(a));
    const old = await p.metadata.getVoiceDelivery(a.userId, a.sessionId, a.attemptId);
    if (!old) {
      if (assistant) throw new AppError('NOT_READY', 'Voice delivery evidence is unavailable.');
      continue; // Acceptance crashed before inference/delivery start: no assistant/audio exists.
    }
    if (old.status !== 'pending') continue;
    if (!terminal(a.status)) throw new AppError('NOT_READY', 'Voice generation needs reconciliation first.');
    if (assistant && !isDeepStrictEqual(assistant.canvasArtifacts ?? [], old.canvasArtifacts ?? []))
      throw new AppError('NOT_READY', 'Assistant visual descriptors disagree with delivery journal.');
    const generated = assistant?.content ?? old.textGenerated;
    if (!generated.startsWith(old.textGenerated)) throw new AppError('NOT_READY', 'Voice result and delivery disagree.');
    const recovered = voiceDeliveryRecordSchema.parse({ ...old, textGenerated: generated, status: 'unknown',
      eventId: randomUUID(), sequence: old.sequence + 1, updatedAt: new Date().toISOString(),
      textSpoken: old.textSpoken, textRemaining: old.textSpoken === null ? null : generated.slice(old.textSpoken.length) });
    if (!await job.wait(p.owner.run(lease, () => p.metadata.compareVoiceDelivery(recovered, old.sequence)),
      p.metadata.budgets.persistenceTimeoutMs)) throw new AppError('CONFLICT_ACTIVE_TURN', 'Voice recovery evidence changed.');
  }
}
