/**
 * ============================================================================
 * FILE: finalization-publication-amplification.spec.ts
 * LOCATION: backend/test/performance/finalization-publication-amplification.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove live text publication uses one ownership fence and confirmed
 *    manifest evidence instead of repeated two-read fences and rereads.
 *
 * ROLE IN PROJECT:
 *    Focused W2 regression for persistence/finalization command amplification
 *    on a BSON fixture store. Not native RTT, p95, or provider latency.
 *
 * KEY COMPONENTS:
 *    - One publication-stage fence pair for consecutive storage-only work.
 *    - putConfirmed(expected) skips the preliminary agent-memory read.
 *    - Combined-finish live path skips the early session activity touch.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import type { AttemptRecord } from '../../src/contracts/attempt.js';
import type { AccountingRecord } from '../../src/contracts/metadata.js';
import type { MessageRecord } from '../../src/contracts/message.js';
import type { PersistenceBundle } from '../../src/persistence/persistence.js';
import { MongoMemory } from '../../src/persistence/memory.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { hashPayload } from '../../src/platform/crypto/hash-payload.js';
import { boundaryFor, type SavedResult } from '../../src/agent/state.js';
import { buildReferenceManifest } from '../../src/context/index.js';
import { eventIdFor, outputId } from '../../src/chat-runtime/identity.js';
import { publishResult, type GraphSnapshot, type LivePublicationEvidence } from '../../src/chat-runtime/finalization.js';
import { Work } from '../../src/chat-runtime/work.js';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { session } from '../persistence/fixtures.js';
import { key } from '../../src/persistence/records.js';

const at = '2026-10-21T09:00:00.000Z';
const instructionVersion = 'fixture-v1';
const knowledgeContentHash = 'b'.repeat(64);
const graphSchemaVersion = 'fixture-v1';
const assets = {
  instructions: '', knowledge: '', instructionVersion, knowledgeContentHash, graphSchemaVersion,
};

async function openLivePublication() {
  const mem = calendarMemory();
  const owner = new MongoOwnership(mem.store, 'test-executor');
  const sessions = new MongoSessions(mem.store, DEFAULT_BUDGETS);
  const messages = new MongoMessages(mem.store, DEFAULT_BUDGETS);
  const metadata = new MongoMetadata(mem.store, DEFAULT_BUDGETS);
  const memory = new MongoMemory(mem.store, DEFAULT_BUDGETS);
  await owner.claimExecutor();
  await sessions.createIfAbsent(session('u1', 's1'));
  const acquired = await owner.acquire({
    userId: 'u1', sessionId: 's1', ownerId: 'test-executor', leaseMs: 30_000,
  });
  if (!acquired.ok) throw new Error('Failed to acquire lease');
  const lease = acquired.lease;

  const attempt = {
    schemaVersion: 1, kind: 'attempt', userId: 'u1', sessionId: 's1', turnId: 't1',
    attemptId: 'a1', idempotencyKey: 'request-0001', payloadHash: hashPayload('Hello'),
    status: 'finalizing', sequence: 1, createdAt: at, updatedAt: at, instructionVersion,
    knowledgeContentHash, graphSchemaVersion, contextVersion: 0, modelId: 'fixture-model',
    openRouterUser: 'u1', generationId: null, truncated: false, errorCode: null,
    causal: { userMessageId: 'm0', previousAttemptId: null },
  } satisfies AttemptRecord;
  const user: MessageRecord = {
    schemaVersion: 1, userId: 'u1', sessionId: 's1', turnId: 't1', messageId: 'm0',
    eventId: 'e0', sequence: 0, role: 'user', content: 'Hello', createdAt: at,
    completionStatus: 'accepted', attemptId: null, truncated: false,
  };
  const assistantId = outputId(attempt);
  const assistant: MessageRecord = {
    schemaVersion: 1, userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1',
    messageId: assistantId, eventId: eventIdFor('u1', 's1', assistantId), sequence: 1,
    role: 'assistant', content: 'Hi', createdAt: at, completionStatus: 'streaming', truncated: false,
  };
  const baseManifest = buildReferenceManifest('u1', 's1', 0, [], assets, DEFAULT_BUDGETS);
  const target = buildReferenceManifest(
    'u1', 's1', 1,
    [user, { ...assistant, completionStatus: 'completed', truncated: false }],
    assets, DEFAULT_BUDGETS,
  );
  const accounting: AccountingRecord = {
    schemaVersion: 1, kind: 'accounting', userId: 'u1', sessionId: 's1', turnId: 't1',
    attemptId: 'a1', generationId: null, requestedModel: 'fixture-model', reportedModel: null,
    reportedProvider: null, promptTokens: null, completionTokens: null, cost: null,
    accountingStatus: 'pending', outcome: 'generating', startedAt: at, endedAt: null,
  };

  const userReceipt = await messages.appendConfirmed(user);
  const attemptReceipt = await metadata.putAttemptConfirmed!(attempt);
  await owner.reserveAttempt(lease, 'a1');
  await owner.confirmAcceptance(lease, 'a1', { input: userReceipt, attempt: attemptReceipt });
  const baseManifestReceipt = await memory.putConfirmed(baseManifest);
  const accountingReceipt = await metadata.putAccountingConfirmed!(accounting);
  const acceptance = (await metadata.getAcceptance('u1', 's1', 'a1'))!;

  const snapshot: GraphSnapshot & { values: GraphSnapshot['values'] & { boundary?: unknown } } = {
    values: {
      sealed: true,
      result: { input: { attempt: { attemptId: 'a1' } } },
      boundary: boundaryFor(baseManifest),
    },
    next: [],
    tasks: [],
  };
  const graph = {
    async getState() { return snapshot; },
    async updateState(_cfg: unknown, patch: { boundary?: unknown }) {
      if (patch.boundary !== undefined) snapshot.values.boundary = patch.boundary;
    },
  };

  const saved: SavedResult = {
    input: { attempt: { ...attempt, status: 'accepted' }, assistantSequence: 1 },
    assistant,
    accounting: { ...accounting, outcome: 'completed' },
    base: boundaryFor(baseManifest),
    target,
    outcome: 'completed',
  };
  const evidence: LivePublicationEvidence = {
    acceptedInput: user,
    acceptance,
    baseManifest,
    sourceRecords: [user],
    confirmedSnapshot: snapshot,
    attemptReceipt,
    accountingReceipt,
    baseManifestReceipt,
    onAttemptConfirmed: () => undefined,
    activityUpdatedByFinish: true,
  };
  const p = { owner, sessions, messages, memory, metadata } as unknown as PersistenceBundle;
  return { mem, owner, sessions, messages, memory, metadata, lease, p, graph, saved, evidence, attempt, target };
}

it('publishes live text through one storage phase without a manifest reread or early activity touch', async () => {
  const fx = await openLivePublication();
  const work = new Work(new AbortController().signal, 10_000, () => undefined, () => undefined);
  const phase = vi.spyOn(fx.owner, 'runPhase');
  const fence = vi.spyOn(fx.owner, 'fenceSession');
  const touch = vi.spyOn(fx.sessions, 'touchActivity');
  const getConfirmed = vi.spyOn(fx.memory, 'getConfirmed');
  let phaseSessionDuringPut: ReturnType<MongoOwnership['currentPhaseSession']> | 'unset' = 'unset';
  const putConfirmed = fx.memory.putConfirmed.bind(fx.memory);
  fx.memory.putConfirmed = async (manifest, expected) => {
    phaseSessionDuringPut = fx.owner.currentPhaseSession();
    return putConfirmed(manifest, expected);
  };
  fx.mem.calls.length = 0;
  fence.mockClear();
  phase.mockClear();
  getConfirmed.mockClear();
  try {
    const published = await publishResult(
      fx.p, fx.lease, work, fx.graph as never, fx.attempt, fx.saved, fx.evidence,
    );
    const memoryRereads = fx.mem.calls.filter(c => c.method === 'findOne' && c.collection === 'agent-memory'
      && c.filter._id === key('memory', 'u1', 's1'));
    expect(published.status).toBe('completed');
    expect(phase).toHaveBeenCalledTimes(1);
    expect(phase.mock.calls[0]?.[1]).toMatchObject({ name: 'publication-stage', maxOperations: 8 });
    expect(phase.mock.calls[0]?.[1].deadlineAt)
      .toBeLessThanOrEqual(Date.parse(fx.lease.leaseExpiresAt) - 1000);
    expect(fence).toHaveBeenCalledTimes(1);
    expect(getConfirmed).not.toHaveBeenCalled();
    expect(memoryRereads).toHaveLength(0);
    expect(touch).not.toHaveBeenCalled();
    expect(phaseSessionDuringPut).not.toBe('unset');
    expect(phaseSessionDuringPut).not.toBeNull();
    expect((await fx.memory.get('u1', 's1'))?.contextVersion).toBe(1);
    expect((await fx.messages.get('u1', 's1', outputId(fx.attempt)))?.completionStatus).toBe('completed');
  } finally {
    await work.settled();
    work.close();
  }
});
