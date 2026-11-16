/**
 * ============================================================================
 * FILE: finalization-publication-safety.spec.ts
 * LOCATION: backend/test/runtime/finalization-publication-safety.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Keep recovery, fallback activity, receipt validation, and uncertain-write
 *    confirmation intact after publication fence elision.
 *
 * ROLE IN PROJECT:
 *    Focused W2 fault checks for finalization. Fixture BSON only; no native
 *    database, provider, or package-wide suite.
 *
 * KEY COMPONENTS:
 *    - Omitted evidence still owns activity and rereads the manifest.
 *    - Combined-finish skip does not apply without finishAttempt.
 *    - Forged/mismatched receipts refuse before a context replace.
 *    - Ambiguous writes still confirm; pre-write timeouts do not complete.
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

const at = '2026-10-21T09:00:00.000Z';
const instructionVersion = 'fixture-v1';
const knowledgeContentHash = 'b'.repeat(64);
const graphSchemaVersion = 'fixture-v1';
const assets = {
  instructions: '', knowledge: '', instructionVersion, knowledgeContentHash, graphSchemaVersion,
};

async function openPublication() {
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
  };
  const p = { owner, sessions, messages, memory, metadata } as unknown as PersistenceBundle;
  return {
    mem, owner, sessions, messages, memory, metadata, lease, p, graph, saved, evidence,
    attempt, target, baseManifest, work: () => new Work(new AbortController().signal, 10_000, () => undefined, () => undefined),
  };
}

async function publish(fx: Awaited<ReturnType<typeof openPublication>>, evidence?: LivePublicationEvidence) {
  const work = fx.work();
  try {
    return await publishResult(fx.p, fx.lease, work, fx.graph as never, fx.attempt, fx.saved, evidence);
  } finally {
    await work.settled();
    work.close();
  }
}

it('recovery without live evidence still updates activity and rereads the manifest', async () => {
  const fx = await openPublication();
  const touch = vi.spyOn(fx.sessions, 'touchActivity');
  const getConfirmed = vi.spyOn(fx.memory, 'getConfirmed');
  const published = await publish(fx);
  expect(published.status).toBe('completed');
  expect(touch).toHaveBeenCalledTimes(1);
  expect(getConfirmed).toHaveBeenCalled();
});

it('touches activity when combined-finish capabilities exist but activityUpdatedByFinish is omitted', async () => {
  const fx = await openPublication();
  const touch = vi.spyOn(fx.sessions, 'touchActivity');
  await publish(fx, { ...fx.evidence, onAttemptConfirmed: () => undefined });
  expect(touch).toHaveBeenCalledTimes(1);
});

it('skips the early activity touch when activityUpdatedByFinish is true and combined finish is supported', async () => {
  const fx = await openPublication();
  const touch = vi.spyOn(fx.sessions, 'touchActivity');
  await publish(fx, {
    ...fx.evidence,
    onAttemptConfirmed: () => undefined,
    activityUpdatedByFinish: true,
  });
  expect(touch).not.toHaveBeenCalled();
});

it('touches activity when activityUpdatedByFinish is true but finishAttempt is missing', async () => {
  const fx = await openPublication();
  Object.defineProperty(fx.owner, 'finishAttempt', { value: undefined });
  const touch = vi.spyOn(fx.sessions, 'touchActivity');
  await publish(fx, {
    ...fx.evidence,
    onAttemptConfirmed: () => undefined,
    activityUpdatedByFinish: true,
  });
  expect(touch).toHaveBeenCalledTimes(1);
});

it('touches activity when activityUpdatedByFinish is true but the attempt receipt is missing', async () => {
  const fx = await openPublication();
  const touch = vi.spyOn(fx.sessions, 'touchActivity');
  await publish(fx, {
    ...fx.evidence,
    attemptReceipt: null,
    onAttemptConfirmed: () => undefined,
    activityUpdatedByFinish: true,
  });
  expect(touch).toHaveBeenCalledTimes(1);
});

it('touches activity on a voice live path that omits activityUpdatedByFinish', async () => {
  const fx = await openPublication();
  const live = { visibility: 'internal' as const, mode: 'live' as const, voiceSessionId: 'vs1' };
  const user = { ...fx.evidence.acceptedInput, ...live };
  const assistant = { ...fx.saved.assistant, ...live };
  const target = buildReferenceManifest(
    'u1', 's1', 1,
    [user, { ...assistant, completionStatus: 'completed' as const, truncated: false }],
    assets, DEFAULT_BUDGETS,
  );
  const saved = {
    ...fx.saved,
    assistant,
    target,
    base: fx.saved.base,
  };
  const snapshot = {
    values: {
      sealed: true,
      result: { input: { attempt: { attemptId: 'a1' } } },
      boundary: fx.evidence.confirmedSnapshot.values.boundary,
    },
    next: [] as unknown[],
    tasks: [] as { error?: unknown; interrupts?: readonly unknown[] }[],
  };
  const graph = {
    async getState() { return snapshot; },
    async updateState(_cfg: unknown, patch: { boundary?: unknown }) {
      if (patch.boundary !== undefined) snapshot.values.boundary = patch.boundary;
    },
  };
  const work = fx.work();
  const touch = vi.spyOn(fx.sessions, 'touchActivity');
  try {
    await publishResult(fx.p, fx.lease, work, graph as never, fx.attempt, saved, {
      ...fx.evidence,
      acceptedInput: user,
      sourceRecords: [user],
      confirmedSnapshot: snapshot,
      onAttemptConfirmed: () => undefined,
    });
    expect(touch).toHaveBeenCalledTimes(1);
  } finally {
    await work.settled();
    work.close();
  }
});

it('keeps an explicit activity owner when the terminal receipt cannot be delivered', async () => {
  const fx = await openPublication();
  const touch = vi.spyOn(fx.sessions, 'touchActivity');
  const { onAttemptConfirmed: _ignored, ...evidence } = fx.evidence;
  await publish(fx, evidence);
  expect(touch).toHaveBeenCalledTimes(1);
});

it('keeps an explicit activity owner when finishAttempt is unavailable', async () => {
  const fx = await openPublication();
  Object.defineProperty(fx.owner, 'finishAttempt', { value: undefined });
  const touch = vi.spyOn(fx.sessions, 'touchActivity');
  await publish(fx, fx.evidence);
  expect(touch).toHaveBeenCalledTimes(1);
});

it('refuses a forged or wrong-store manifest receipt before replacing context', async () => {
  const fx = await openPublication();
  const other = calendarMemory();
  const foreign = new MongoMemory(other.store, DEFAULT_BUDGETS);
  const foreignReceipt = await foreign.putConfirmed(fx.evidence.baseManifest);
  const replace = vi.spyOn(fx.mem.store.collection('agent-memory'), 'replaceOne');
  await expect(publish(fx, { ...fx.evidence, baseManifestReceipt: foreignReceipt }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(replace).not.toHaveBeenCalled();
  await expect(publish(fx, { ...fx.evidence, baseManifestReceipt: { record: fx.evidence.baseManifest } as never }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect((await fx.memory.get('u1', 's1'))?.contextVersion).toBe(0);
});

it('refuses a store-bound receipt that does not match the claimed base manifest', async () => {
  const fx = await openPublication();
  await expect(publish(fx, { ...fx.evidence, baseManifest: fx.target }))
    .rejects.toMatchObject({ code: 'NOT_READY' });
  expect((await fx.memory.get('u1', 's1'))?.contextVersion).toBe(0);
});

it('confirms an ambiguous manifest write and does not complete a pre-write timeout', async () => {
  const fx = await openPublication();
  fx.mem.failNext('after-write', { collection: 'agent-memory', method: 'replaceOne' });
  expect((await publish(fx, fx.evidence)).status).toBe('completed');
  expect((await fx.memory.get('u1', 's1'))?.contextVersion).toBe(1);

  const again = await openPublication();
  again.mem.failNext('before-write', { collection: 'agent-memory', method: 'replaceOne' });
  await expect(publish(again, again.evidence)).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  expect((await again.memory.get('u1', 's1'))?.contextVersion).toBe(0);
  expect((await again.metadata.getAttempt('u1', 's1', 'a1'))?.status).toBe('finalizing');
});

it('reuses a saved manifest when a live receipt races an already-written target', async () => {
  const fx = await openPublication();
  await fx.memory.putConfirmed(fx.target, fx.evidence.baseManifestReceipt);
  expect((await publish(fx, fx.evidence)).status).toBe('completed');
  expect((await fx.memory.get('u1', 's1'))?.contextVersion).toBe(1);
});

it('republishes omitted-evidence recovery without repeating inference', async () => {
  const fx = await openPublication();
  expect((await publish(fx, fx.evidence)).status).toBe('completed');
  const stored = (await fx.metadata.getAttempt('u1', 's1', 'a1'))!;
  expect(stored.status).toBe('completed');
  const work = fx.work();
  try {
    expect((await publishResult(fx.p, fx.lease, work, fx.graph as never, stored, fx.saved)).status)
      .toBe('completed');
  } finally {
    await work.settled();
    work.close();
  }
});

it('keeps publication-stage bounded and does not nest phases', async () => {
  const fx = await openPublication();
  const phase = vi.spyOn(fx.owner, 'runPhase');
  await publish(fx, fx.evidence);
  expect(phase).toHaveBeenCalledTimes(1);
  expect(phase.mock.calls[0]?.[1]).toMatchObject({ name: 'publication-stage', maxOperations: 8 });
  expect(phase.mock.calls[0]?.[1].deadlineAt)
    .toBeLessThanOrEqual(Date.parse(fx.lease.leaseExpiresAt) - 1000);
});

it('still publishes omitted-receipt live evidence through memory.put', async () => {
  const fx = await openPublication();
  const { baseManifestReceipt: _omitted, ...withoutReceipt } = fx.evidence;
  const getConfirmed = vi.spyOn(fx.memory, 'getConfirmed');
  expect((await publish(fx, withoutReceipt)).status).toBe('completed');
  expect(getConfirmed).toHaveBeenCalled();
});
