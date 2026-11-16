/**
 * ============================================================================
 * FILE: latency-storage.spec.ts
 * LOCATION: backend/test/performance/latency-storage.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify bounded scoped bulk reads and acknowledged/uncertain immutable saves.
 * ROLE IN PROJECT:
 *    Exercises production adapters over deterministic collection fixtures.
 *    Never connects to a database or an external provider.
 * KEY COMPONENTS:
 *    - Bulk reference ordering/linkage/isolation and constant query counts.
 *    - Immutable insert acknowledgement, mismatch and ambiguous confirmation.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { messageRecordSchema } from '../../src/contracts/message.js';
import { acceptanceSchema, key } from '../../src/persistence/records.js';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { record } from '../context/fixtures.js';
import { attemptRecordSchema } from '../../src/contracts/attempt.js';

it('uses one scoped reference query, restores order and refuses missing or mismatched linkage', async () => {
  const m = calendarMemory();
  const messages = new MongoMessages(m.store, { ...DEFAULT_BUDGETS, maxMessagesInContext: 500 });
  for (let i = 0; i < 100; i++) await messages.append(record({ messageId: `m${i}`, eventId: `e${i}`, sequence: i }));
  await messages.append(record({ userId: 'other', messageId: 'secret', eventId: 'foreign' }));
  for (const count of [1, 20, 100]) {
    m.calls.length = 0;
    const refs = Array.from({ length: count }, (_, i) => ({ messageId: `m${count - 1 - i}`,
      eventId: `e${count - 1 - i}`, sequence: count - 1 - i }));
    expect((await messages.getReferences('u1', 's1', refs)).map(r => r.messageId)).toEqual(refs.map(r => r.messageId));
    expect(m.calls.map(c => c.method)).toEqual(['find']);
  }
  await expect(messages.getReferences('u1', 's1', [{ messageId: 'm0', eventId: 'wrong', sequence: 0 }]))
    .rejects.toMatchObject({ code: 'NOT_READY' });
  await expect(messages.getReferences('u1', 's1', [{ messageId: 'secret', eventId: 'foreign', sequence: 0 }]))
    .rejects.toMatchObject({ code: 'NOT_READY' });
  await expect(messages.getReferences('u1', 'other', [{ messageId: 'm0', eventId: 'e0', sequence: 0 }]))
    .rejects.toMatchObject({ code: 'NOT_READY' });
});

it('bulk acceptance is scoped, bounded and latest-turn lookup makes one ordered query', async () => {
  const m = calendarMemory(); const metadata = new MongoMetadata(m.store, DEFAULT_BUDGETS);
  const marker = { schemaVersion: 1 as const, kind: 'acceptance' as const, userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a1', userMessageId: 'm1', payloadHash: 'a'.repeat(64) };
  // Use the actual record schema rather than bypassing adapter scope decoding.
  await m.store.insert('metadata', acceptanceSchema, marker, key('acceptance', 'u1', 's1', 'a1'), DEFAULT_BUDGETS.maxDocumentBytes);
  m.calls.length = 0;
  expect(await metadata.getAcceptances('u1', 's1', ['a1', 'missing'])).toHaveLength(1);
  expect(m.calls.map(c => c.method)).toEqual(['find']);
  expect(await metadata.getAcceptances('other', 's1', ['a1'])).toEqual([]);
  await expect(metadata.getAcceptances('u1', 's1', Array<string>(501).fill('a1'))).rejects.toMatchObject({ code: 'STORAGE_BUDGET_EXCEEDED' });
  m.calls.length = 0;
  expect(await metadata.latestAttempt('u1', 's1', 'missing')).toBeNull();
  expect(m.calls).toEqual([{ collection: 'metadata', method: 'find', filter: {
    userId: 'u1', sessionId: 's1', turnId: 'missing', kind: 'attempt' } }]);
  const attempt = attemptRecordSchema.parse({ schemaVersion: 1, kind: 'attempt', userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a1', idempotencyKey: 'request-0001', payloadHash: 'a'.repeat(64), status: 'failed', sequence: 1,
    createdAt: '2026-10-21T09:00:00.000Z', updatedAt: '2026-10-21T09:00:00.000Z', instructionVersion: 'fixture-v1',
    knowledgeContentHash: 'b'.repeat(64), graphSchemaVersion: 'fixture-v1', contextVersion: 0, modelId: 'fixture-model',
    openRouterUser: 'u1', generationId: null, truncated: false, errorCode: 'INTERRUPTED',
    causal: { userMessageId: 'm1', previousAttemptId: null } });
  await metadata.putAttempt(attempt);
  await metadata.putAttempt({ ...attempt, attemptId: 'a2', idempotencyKey: 'request-0002', sequence: 2 });
  await metadata.putAttempt({ ...attempt, turnId: 'other', attemptId: 'a3', idempotencyKey: 'request-0003', sequence: 3 });
  expect(await metadata.latestAttempt('u1', 's1', 't1')).toMatchObject({ attemptId: 'a2' });
  expect(await metadata.latestAttempt('other', 's1', 't1')).toBeNull();
});

it('skips confirmation only for acknowledged inserts and still confirms uncertain writes and duplicate payloads', async () => {
  const m = calendarMemory(); const value = record(); const id = key('message', 'u1', 's1', 'm1');
  const insert = (v = value) => m.store.insert('messages', messageRecordSchema, v, id, DEFAULT_BUDGETS.maxMessageBytes);
  await insert();
  expect(m.calls.map(c => c.method)).toEqual(['updateOne']);
  m.calls.length = 0; await insert();
  expect(m.calls.map(c => c.method)).toEqual(['updateOne', 'findOne']);
  await expect(insert({ ...value, content: 'different' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  const ambiguous = calendarMemory(); ambiguous.failNext('after-write');
  await expect(ambiguous.store.insert('messages', messageRecordSchema, value, id, DEFAULT_BUDGETS.maxMessageBytes)).resolves.toEqual(value);
  expect(ambiguous.calls.map(c => c.method)).toEqual(['updateOne', 'findOne']);
});

it('does not issue a replacement receipt without an explicit acknowledgement or exact readback', async () => {
  const m = calendarMemory();
  const messages = new MongoMessages(m.store, DEFAULT_BUDGETS);
  const receipt = await messages.appendConfirmed!(record({ role: 'assistant', completionStatus: 'streaming' }));
  const collection = m.store.collection.bind(m.store);
  vi.spyOn(m.store, 'collection').mockImplementation(name => {
    const original = collection(name);
    return new Proxy(original, {
      get(target, prop, receiver) {
        return prop === 'replaceOne'
          ? async () => ({ matchedCount: 1 })
          : Reflect.get(target, prop, receiver);
      },
    });
  });
  await expect(messages.updateCompletionConfirmed!(receipt, 'completed', false))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
});

it('reuses confirmed receipts for messages, attempts, accounting, and memory without preliminary rereads and rejects forged or wrong-scope receipts before DB dispatch', async () => {
  const { MongoMemory } = await import('../../src/persistence/memory.js');
  const { accountingRecordSchema } = await import('../../src/contracts/metadata.js');
  const { agentMemoryManifestSchema } = await import('../../src/contracts/agent-memory.js');

  const m = calendarMemory();
  const otherMem = calendarMemory();
  const messages = new MongoMessages(m.store, DEFAULT_BUDGETS);
  const metadata = new MongoMetadata(m.store, DEFAULT_BUDGETS);
  const memory = new MongoMemory(m.store, DEFAULT_BUDGETS);

  // 1. Messages: appendConfirmed -> updateCompletionConfirmed with zero preliminary findOne
  const msg = record({ messageId: 'm-fast', eventId: 'e-fast', sequence: 2, role: 'assistant', completionStatus: 'streaming' });
  const msgReceipt = await messages.appendConfirmed!(msg);
  expect(Object.isFrozen(msgReceipt)).toBe(true);
  expect(Object.isFrozen(msgReceipt.record)).toBe(true);
  m.calls.length = 0;
  const completedMsgReceipt = await messages.updateCompletionConfirmed!(msgReceipt, 'completed', false);
  expect(completedMsgReceipt.record).toMatchObject({ completionStatus: 'completed', truncated: false });
  expect(m.calls.map(c => c.method)).toEqual(['replaceOne']);

  // Stale receipt cannot turn a conflict into success
  const staleMsg = await messages.appendConfirmed!(
    record({ messageId: 'm-stale', eventId: 'e-stale', sequence: 3, role: 'assistant', completionStatus: 'streaming' }),
  );
  await messages.updateCompletion('u1', 's1', 'm-stale', 'truncated', true);
  await expect(messages.updateCompletionConfirmed!(staleMsg, 'completed', false))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });

  // Forged or wrong-store receipt is rejected before any DB call
  const otherMessages = new MongoMessages(otherMem.store, DEFAULT_BUDGETS);
  const foreignReceipt = await otherMessages.appendConfirmed!(
    record({ messageId: 'm-foreign', eventId: 'e-foreign', sequence: 4, role: 'assistant', completionStatus: 'streaming' }),
  );
  m.calls.length = 0;
  await expect(messages.updateCompletionConfirmed!(foreignReceipt, 'completed', false))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(messages.updateCompletionConfirmed!({ record: msg } as never, 'completed', false))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(m.calls).toHaveLength(0);

  // 2. Attempt: putAttemptConfirmed -> compareAttemptConfirmed without preliminary findOne
  const baseAttempt = attemptRecordSchema.parse({
    schemaVersion: 1, kind: 'attempt', userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a-fast', idempotencyKey: 'req-fast-1', payloadHash: 'a'.repeat(64),
    status: 'accepted', sequence: 1, createdAt: '2026-10-21T09:00:00.000Z', updatedAt: '2026-10-21T09:00:00.000Z',
    instructionVersion: 'fixture-v1', knowledgeContentHash: 'b'.repeat(64), graphSchemaVersion: 'fixture-v1',
    contextVersion: 0, modelId: 'fixture-model', openRouterUser: 'u1', generationId: null, truncated: false,
    errorCode: null, causal: { userMessageId: 'm1', previousAttemptId: null },
  });
  const attReceipt1 = await metadata.putAttemptConfirmed!(baseAttempt);
  m.calls.length = 0;
  const genTransition = await metadata.compareAttemptConfirmed!(attReceipt1, {
    ...baseAttempt, status: 'generating', generationId: 'gen-fast-1', updatedAt: '2026-10-21T09:00:01.000Z',
  });
  expect(genTransition.outcome).toBe('confirmed');
  if (genTransition.outcome !== 'confirmed') throw new Error('expected confirmed');
  expect(m.calls.map(c => c.method)).toEqual(['replaceOne']);

  // Stale attempt receipt returns conflict
  const staleTransition = await metadata.compareAttemptConfirmed!(attReceipt1, {
    ...baseAttempt, status: 'cancelled', errorCode: 'CANCELLED',
  });
  expect(staleTransition.outcome).toBe('conflict');

  // Changed immutable attempt identity throws IDEMPOTENCY_PAYLOAD_MISMATCH before DB dispatch
  m.calls.length = 0;
  await expect(metadata.compareAttemptConfirmed!(genTransition.receipt, {
    ...genTransition.receipt.record, modelId: 'tampered-model',
  })).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  expect(m.calls).toHaveLength(0);

  // Ambiguous attempt CAS with exact later readback confirms
  m.failNext('after-write', { collection: 'metadata', method: 'replaceOne' });
  const finTransition = await metadata.compareAttemptConfirmed!(genTransition.receipt, {
    ...genTransition.receipt.record, status: 'finalizing', updatedAt: '2026-10-21T09:00:02.000Z',
  });
  expect(finTransition.outcome).toBe('confirmed');

  // 3. Accounting: putAccountingConfirmed with expected receipt avoids preliminary accounting reread
  const baseAccounting = accountingRecordSchema.parse({
    schemaVersion: 1, kind: 'accounting', userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a-fast', generationId: 'gen-fast-1',
    requestedModel: 'fixture-model', reportedModel: null, reportedProvider: null,
    promptTokens: null, completionTokens: null, cost: null,
    accountingStatus: 'pending', outcome: 'generating',
    startedAt: '2026-10-21T09:00:00.000Z', endedAt: null,
  });
  const accReceipt1 = await metadata.putAccountingConfirmed!(baseAccounting);
  m.calls.length = 0;
  const accReceipt2 = await metadata.putAccountingConfirmed!({
    ...baseAccounting,
    reportedModel: 'fixture-model',
    promptTokens: 12,
    completionTokens: 8,
    cost: 0.0015,
    accountingStatus: 'known',
    outcome: 'completed',
    endedAt: '2026-10-21T09:00:03.000Z',
  }, accReceipt1);
  expect(accReceipt2.record.accountingStatus).toBe('known');
  // No preliminary findOne on the accounting document itself (only attempt linkage + generation claim + replaceOne)
  expect(m.calls.filter(c => c.method === 'findOne' && c.filter._id === key('accounting', 'u1', 's1', 'a-fast'))).toHaveLength(0);

  // 4. Memory: putConfirmed with expected receipt avoids preliminary manifest reread
  const manifest0 = agentMemoryManifestSchema.parse({
    schemaVersion: 1, userId: 'u1', sessionId: 's1', contextVersion: 0,
    instructionVersion: 'fixture-v1', knowledgeContentHash: 'b'.repeat(64), graphSchemaVersion: 'fixture-v1',
    activeSummaryRef: null, messageRefs: [], sourceRanges: [],
  });
  const memReceipt0 = await memory.putConfirmed!(manifest0);
  m.calls.length = 0;
  const manifest1 = {
    ...manifest0,
    contextVersion: 1,
    messageRefs: [{ messageId: 'm-fast', eventId: 'e-fast', sequence: 2 }],
    sourceRanges: [{ fromSequence: 2, toSequence: 2, fromEventId: 'e-fast', toEventId: 'e-fast' }],
  };
  const memReceipt1 = await memory.putConfirmed!(manifest1, memReceipt0);
  expect(memReceipt1.record.contextVersion).toBe(1);
  expect(m.calls.map(c => c.method)).toEqual(['replaceOne']);
});

it('handles timeout with late success and timeout without write during CAS confirmation without fabricating receipts', async () => {
  const m = calendarMemory();
  const metadata = new MongoMetadata(m.store, DEFAULT_BUDGETS);
  const baseAttempt = attemptRecordSchema.parse({
    schemaVersion: 1, kind: 'attempt', userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a-timeout', idempotencyKey: 'req-timeout-1', payloadHash: 'a'.repeat(64),
    status: 'accepted', sequence: 1, createdAt: '2026-10-21T09:00:00.000Z', updatedAt: '2026-10-21T09:00:00.000Z',
    instructionVersion: 'fixture-v1', knowledgeContentHash: 'b'.repeat(64), graphSchemaVersion: 'fixture-v1',
    contextVersion: 0, modelId: 'fixture-model', openRouterUser: 'u1', generationId: null, truncated: false,
    errorCode: null, causal: { userMessageId: 'm1', previousAttemptId: null },
  });
  const attReceipt = await metadata.putAttemptConfirmed!(baseAttempt);

  // 1. Timeout with late success: replaceOne throws after writing
  m.failNext('after-write', { collection: 'metadata', method: 'replaceOne' });
  const lateSuccess = await metadata.compareAttemptConfirmed!(attReceipt, {
    ...baseAttempt, status: 'generating', generationId: 'gen-timeout-1', updatedAt: '2026-10-21T09:00:01.000Z',
  });
  expect(lateSuccess.outcome).toBe('confirmed');
  if (lateSuccess.outcome !== 'confirmed') throw new Error('expected confirmed');
  expect(lateSuccess.receipt.record.status).toBe('generating');

  // 2. Timeout before write: replaceOne throws before write
  m.failNext('before-write', { collection: 'metadata', method: 'replaceOne' });
  const timeoutWithoutWrite = await metadata.compareAttemptConfirmed!(lateSuccess.receipt, {
    ...lateSuccess.receipt.record, status: 'finalizing', updatedAt: '2026-10-21T09:00:02.000Z',
  });
  expect(timeoutWithoutWrite.outcome).toBe('uncertain');

  // 3. Document was not modified by the failed attempt, so another write can succeed
  const retry = await metadata.compareAttemptConfirmed!(lateSuccess.receipt, {
    ...lateSuccess.receipt.record, status: 'finalizing', updatedAt: '2026-10-21T09:00:02.000Z',
  });
  expect(retry.outcome).toBe('confirmed');
});

