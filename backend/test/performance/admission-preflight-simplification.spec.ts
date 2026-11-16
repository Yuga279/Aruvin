/**
 * ============================================================================
 * FILE: admission-preflight-simplification.spec.ts
 * LOCATION: backend/test/performance/admission-preflight-simplification.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove healthy follow-up admission/execute keep only essential storage.
 *
 * ROLE IN PROJECT:
 *    Failing regressions for the drastic pre-dispatch simplification. Uses the
 *    existing offline latency fixture; never opens a native database or provider.
 *
 * KEY COMPONENTS:
 *    - Admission: no archive/attempt reconstruction; one acceptance phase.
 *    - Execute: attach CAS carries evidence; no extra attempt/checkpoint reads.
 *    - Text graph: no checkpoint write before the first provider fetch.
 * ============================================================================
 */
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import { AdmissionReceiptStore } from '../../src/chat-runtime/admission-receipt.js';
import { DependencyProbe } from './dependency-probe.js';
import { createLatencyFixture } from './latency-runtime-fixture.js';

function receiptStore(runtime: DurableChatRuntime): AdmissionReceiptStore {
  return (runtime as unknown as { receipts: AdmissionReceiptStore }).receipts;
}

async function followUpFixture() {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'text', probe, readMs: 67, writeMs: 449 });
  const first = await probe.drive(() => fx.submit('Hello'), 67, 449);
  await probe.drive(() => fx.execute(first), 67, 449);
  return { probe, fx, sessionId: first.sessionId };
}

it('does not reconstruct archive or attempts when admitting a healthy follow-up', async () => {
  const { probe, fx, sessionId } = await followUpFixture();
  const list = vi.spyOn(fx.persistence.messages, 'listForContext');
  const attempts = vi.spyOn(fx.persistence.metadata, 'listAttempts');
  try {
    await probe.drive(() => fx.submit('Follow up', sessionId), 67, 449);
    expect(list).not.toHaveBeenCalled();
    expect(attempts).not.toHaveBeenCalled();
  } finally {
    list.mockRestore();
    attempts.mockRestore();
    await fx.close();
  }
});

it('confirms acceptance inside the single admission stage instead of a second phase', async () => {
  const { probe, fx, sessionId } = await followUpFixture();
  const phase = vi.spyOn(fx.persistence.owner, 'runPhase');
  try {
    await probe.drive(() => fx.submit('One phase', sessionId), 67, 449);
    const names = phase.mock.calls.map(call => call[1].name);
    expect(names.filter(name => name === 'acceptance-stage')).toHaveLength(1);
    expect(names.filter(name => name === 'acceptance-publish')).toHaveLength(0);
    expect(phase.mock.calls.find(call => call[1].name === 'acceptance-stage')![1].maxOperations).toBeGreaterThanOrEqual(5);
  } finally {
    phase.mockRestore();
    await fx.close();
  }
});

it('attaches from the in-process receipt without rereading attempt, input, or checkpoint', async () => {
  const { probe, fx, sessionId } = await followUpFixture();
  const follow = await probe.drive(() => fx.submit('Attach once', sessionId), 67, 449);
  fx.fetcher.mockClear();
  const latest = vi.spyOn(fx.persistence.metadata, 'latestAttempt');
  const input = vi.spyOn(fx.persistence.messages, 'get');
  const confirmed = vi.spyOn(fx.persistence.memory, 'getConfirmed');
  try {
    await probe.drive(() => fx.execute(follow), 67, 449);
    expect(latest).not.toHaveBeenCalled();
    expect(input.mock.invocationCallOrder.filter(order => order < Math.min(...fx.fetcher.mock.invocationCallOrder))).toEqual([]);
    expect(confirmed).not.toHaveBeenCalled();
  } finally {
    latest.mockRestore();
    input.mockRestore();
    confirmed.mockRestore();
    await fx.close();
  }
});

it('does not checkpoint the text prepare node before the first provider fetch', async () => {
  const { probe, fx, sessionId } = await followUpFixture();
  const follow = await probe.drive(() => fx.submit('No pre-dispatch seal', sessionId), 67, 449);
  fx.fetcher.mockClear();
  const put = vi.spyOn(MongoDBSaver.prototype, 'put');
  try {
    await probe.drive(() => fx.execute(follow), 67, 449);
    const fetchOrder = Math.min(...fx.fetcher.mock.invocationCallOrder);
    expect(fetchOrder).toBeGreaterThan(0);
    const before = put.mock.calls.filter((_, i) => put.mock.invocationCallOrder[i] < fetchOrder)
      .map(call => (call[1] as { channel_values?: { sealed?: unknown; result?: unknown } }).channel_values);
    // LangGraph may write the parent/input checkpoint before the first node.
    // Text generate runs inside prepare, so there must be no extra unsealed
    // empty prepare checkpoint before paid inference.
    expect(before.filter(values => values?.sealed === false && !values?.result)).toHaveLength(1);
  } finally {
    put.mockRestore();
    await fx.close();
  }
});

it('answers stream status from the admission receipt without a storage round-trip', async () => {
  const { probe, fx, sessionId } = await followUpFixture();
  const ids = await probe.drive(() => fx.submit('Stream receipt', sessionId), 67, 449);
  expect(fx.rawRuntime.getStreamAttempt).toEqual(expect.any(Function));
  const latest = vi.spyOn(fx.persistence.metadata, 'latestAttempt');
  const sessions = vi.spyOn(fx.persistence.sessions, 'get');
  const messages = vi.spyOn(fx.persistence.messages, 'get');
  try {
    const status = await fx.rawRuntime.getStreamAttempt!(fx.identity.userId, ids.sessionId, ids.turnId);
    expect(status).toMatchObject({ sessionId: ids.sessionId, turnId: ids.turnId, attemptId: ids.attemptId, status: 'accepted' });
    expect(latest).not.toHaveBeenCalled();
    expect(sessions).not.toHaveBeenCalled();
    expect(messages).not.toHaveBeenCalled();
    expect(receiptStore(fx.rawRuntime).get(fx.identity.userId, ids.sessionId, ids.attemptId)).not.toBeNull();
  } finally {
    latest.mockRestore();
    sessions.mockRestore();
    messages.mockRestore();
    await fx.close();
  }
});

it('refuses a live/internal hot receipt on the public stream attempt path without storage', async () => {
  const { probe, fx, sessionId } = await followUpFixture();
  const ids = await probe.drive(() => fx.submit('Voice-shaped receipt', sessionId), 67, 449);
  const store = receiptStore(fx.rawRuntime);
  const receipt = store.get(fx.identity.userId, ids.sessionId, ids.attemptId);
  expect(receipt).not.toBeNull();
  store.put({
    ...receipt!,
    responseMode: 'voice',
    input: {
      ...receipt!.input,
      record: { ...receipt!.input.record, visibility: 'internal', mode: 'live' },
    },
  });
  const latest = vi.spyOn(fx.persistence.metadata, 'latestAttempt');
  const sessions = vi.spyOn(fx.persistence.sessions, 'get');
  const messages = vi.spyOn(fx.persistence.messages, 'get');
  try {
    await expect(fx.rawRuntime.getStreamAttempt!(fx.identity.userId, ids.sessionId, ids.turnId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(latest).not.toHaveBeenCalled();
    expect(sessions).not.toHaveBeenCalled();
    expect(messages).not.toHaveBeenCalled();
  } finally {
    latest.mockRestore();
    sessions.mockRestore();
    messages.mockRestore();
    await fx.close();
  }
});

it('does not invent public stream status from storage when the receipt is missing', async () => {
  const { probe, fx, sessionId } = await followUpFixture();
  const ids = await probe.drive(() => fx.submit('No receipt', sessionId), 67, 449);
  receiptStore(fx.rawRuntime).delete(fx.identity.userId, ids.sessionId, ids.attemptId);
  const latest = vi.spyOn(fx.persistence.metadata, 'latestAttempt');
  try {
    expect(await fx.rawRuntime.getStreamAttempt!(fx.identity.userId, ids.sessionId, ids.turnId)).toBeNull();
    expect(latest).not.toHaveBeenCalled();
  } finally {
    latest.mockRestore();
    await fx.close();
  }
});

it('still refuses inference when the durable manifest changes after attach', async () => {
  const { probe, fx, sessionId } = await followUpFixture();
  const ids = await probe.drive(() => fx.submit('Mutate manifest', sessionId), 67, 449);
  fx.fetcher.mockClear();
  const attach = fx.persistence.owner.attachAccepted!.bind(fx.persistence.owner);
  vi.spyOn(fx.persistence.owner, 'attachAccepted').mockImplementation(async input => {
    const attached = await attach(input);
    const current = await fx.persistence.memory.get(fx.identity.userId, ids.sessionId);
    if (current) await fx.persistence.memory.put({ ...current, contextVersion: current.contextVersion + 1 });
    return attached;
  });
  try {
    await expect(probe.drive(() => fx.execute(ids), 67, 449)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(fx.fetcher).not.toHaveBeenCalled();
  } finally {
    await fx.close();
  }
});
