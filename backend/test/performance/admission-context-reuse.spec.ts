/**
 * ============================================================================
 * FILE: admission-context-reuse.spec.ts
 * LOCATION: backend/test/performance/admission-context-reuse.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove healthy same-process attachment skips full archive/attempt reconstruction.
 *
 * ROLE IN PROJECT:
 *    Focused Worker 1 regression for admission receipts. Uses the existing
 *    offline latency fixture; never opens a native database or provider.
 *
 * KEY COMPONENTS:
 *    - Proven attach: no listForContext/listAttempts during execute.
 *    - Fallback: synthetic checkpoint, stale manifest, missing receipt.
 * ============================================================================
 */
import { ReferencedContextAssembler } from '../../src/context/referenced-context-assembler.js';
import { AdmissionReceiptStore } from '../../src/chat-runtime/admission-receipt.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { textConfigFixture } from '../runtime/text-config-fixture.js';
import { DependencyProbe } from './dependency-probe.js';
import { createLatencyFixture } from './latency-runtime-fixture.js';

function receiptStore(runtime: DurableChatRuntime): AdmissionReceiptStore {
  return (runtime as unknown as { receipts: AdmissionReceiptStore }).receipts;
}

async function textFixture() {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'text', probe, readMs: 67, writeMs: 449 });
  return { probe, fx };
}

it('does not reread graph state after acknowledged empty-boundary updateState', async () => {
  const h = textConfigFixture(textSnapshot(1));
  const getTuple = vi.spyOn(h.saver, 'getTuple');
  const put = vi.spyOn(h.saver, 'put');
  try {
    await h.submit('Empty boundary checkpoint');
    expect(put).toHaveBeenCalled();
    const firstPut = Math.min(...put.mock.invocationCallOrder);
    expect(getTuple.mock.invocationCallOrder.filter(order => order > firstPut)).toEqual([]);
  } finally {
    getTuple.mockRestore();
    put.mockRestore();
    await h.dispose();
  }
});

it('does not reread a confirmed manifest after admission detach', async () => {
  const { probe, fx } = await textFixture();
  const getConfirmed = vi.spyOn(fx.persistence.memory, 'getConfirmed');
  const detach = vi.spyOn(fx.persistence.owner, 'detachAccepted');
  try {
    const ids = await probe.drive(() => fx.submit('No admission manifest reread'), 67, 449);
    expect(detach).toHaveBeenCalled();
    const firstDetach = Math.min(...detach.mock.invocationCallOrder);
    expect(getConfirmed.mock.invocationCallOrder.filter(order => order > firstDetach)).toEqual([]);
    const receipt = receiptStore(fx.rawRuntime).get(fx.identity.userId, ids.sessionId, ids.attemptId);
    expect(receipt).not.toBeNull();
    expect(receipt!.checkpointId).not.toBe(`${ids.sessionId}-0`);
  } finally {
    getConfirmed.mockRestore();
    detach.mockRestore();
    await fx.close();
  }
});

it('pins a real checkpoint id instead of a synthetic sessionId-0 token', async () => {
  const { probe, fx } = await textFixture();
  try {
    const ids = await probe.drive(() => fx.submit('Pin checkpoint'), 67, 449);
    const receipt = receiptStore(fx.rawRuntime).get(fx.identity.userId, ids.sessionId, ids.attemptId);
    expect(receipt).not.toBeNull();
    expect(receipt!.checkpointId.length).toBeGreaterThan(0);
    expect(receipt!.checkpointId).not.toBe(`${ids.sessionId}-0`);
    expect(receipt!.configRevision).toBeGreaterThanOrEqual(1);
  } finally {
    await fx.close();
  }
});

it('does not rescan the archive or attempts on a proven same-process attachment', async () => {
  const { probe, fx } = await textFixture();
  try {
    const first = await probe.drive(() => fx.submit('Hello'), 67, 449);
    await probe.drive(() => fx.execute(first), 67, 449);
    const follow = await probe.drive(() => fx.submit('Follow up', first.sessionId), 67, 449);
    const list = vi.spyOn(fx.persistence.messages, 'listForContext');
    const attempts = vi.spyOn(fx.persistence.metadata, 'listAttempts');
    const assemble = vi.spyOn(ReferencedContextAssembler.prototype, 'assemble');
    try {
      await probe.drive(() => fx.execute(follow), 67, 449);
      expect(list).not.toHaveBeenCalled();
      expect(attempts).not.toHaveBeenCalled();
      expect(assemble).toHaveBeenCalledTimes(1);
    } finally {
      list.mockRestore();
      attempts.mockRestore();
      assemble.mockRestore();
    }
    expect(fx.rawRuntime.snapshot().active).toBe(0);
  } finally {
    await fx.close();
  }
});

it('falls back to full reconstruction when the receipt checkpoint id is synthetic', async () => {
  const { probe, fx } = await textFixture();
  try {
    const ids = await probe.drive(() => fx.submit('Synthetic fallback'), 67, 449);
    const store = receiptStore(fx.rawRuntime);
    const receipt = store.get(fx.identity.userId, ids.sessionId, ids.attemptId);
    expect(receipt).not.toBeNull();
    store.put({ ...receipt!, checkpointId: `${ids.sessionId}-0` });
    const list = vi.spyOn(fx.persistence.messages, 'listForContext');
    try {
      await probe.drive(() => fx.execute(ids), 67, 449);
      expect(list).toHaveBeenCalled();
    } finally {
      list.mockRestore();
    }
  } finally {
    await fx.close();
  }
});

it('falls back to reconstruction when the receipt manifest no longer matches accepted assets', async () => {
  const { probe, fx } = await textFixture();
  try {
    const ids = await probe.drive(() => fx.submit('Stale receipt manifest'), 67, 449);
    const store = receiptStore(fx.rawRuntime);
    const receipt = store.get(fx.identity.userId, ids.sessionId, ids.attemptId);
    expect(receipt).not.toBeNull();
    store.put({
      ...receipt!,
      manifest: { ...receipt!.manifest, instructionVersion: 'tampered-instruction-version' },
    });
    const list = vi.spyOn(fx.persistence.messages, 'listForContext');
    try {
      await probe.drive(() => fx.execute(ids), 67, 449);
      expect(list).toHaveBeenCalled();
    } finally {
      list.mockRestore();
    }
  } finally {
    await fx.close();
  }
});

it('reconstructs from storage when the in-process receipt is missing', async () => {
  const { probe, fx } = await textFixture();
  try {
    const ids = await probe.drive(() => fx.submit('Missing receipt'), 67, 449);
    receiptStore(fx.rawRuntime).delete(fx.identity.userId, ids.sessionId, ids.attemptId);
    const list = vi.spyOn(fx.persistence.messages, 'listForContext');
    try {
      await probe.drive(() => fx.execute(ids), 67, 449);
      expect(list).toHaveBeenCalled();
    } finally {
      list.mockRestore();
    }
    expect(fx.rawRuntime.snapshot().active).toBe(0);
  } finally {
    await fx.close();
  }
});

it('falls back when the receipt response mode does not match this execute', async () => {
  const { probe, fx } = await textFixture();
  try {
    const ids = await probe.drive(() => fx.submit('Wrong mode'), 67, 449);
    const store = receiptStore(fx.rawRuntime);
    const receipt = store.get(fx.identity.userId, ids.sessionId, ids.attemptId);
    expect(receipt).not.toBeNull();
    store.put({ ...receipt!, responseMode: 'voice' });
    const list = vi.spyOn(fx.persistence.messages, 'listForContext');
    try {
      await probe.drive(() => fx.execute(ids), 67, 449);
      expect(list).toHaveBeenCalled();
    } finally {
      list.mockRestore();
    }
  } finally {
    await fx.close();
  }
});

it('does not rescan the archive on a proven retry attachment', async () => {
  const { probe, fx } = await textFixture();
  try {
    const accepted = await probe.drive(() => fx.submit('Retry reuse'), 67, 449);
    await probe.drive(() => fx.runtime.cancelTurn({
      identity: fx.identity,
      sessionId: accepted.sessionId,
      turnId: accepted.turnId,
      attemptId: accepted.attemptId,
    }), 67, 449);
    const retried = await probe.drive(() => fx.retry(accepted.sessionId, accepted.turnId), 67, 449);
    const list = vi.spyOn(fx.persistence.messages, 'listForContext');
    const attempts = vi.spyOn(fx.persistence.metadata, 'listAttempts');
    try {
      await probe.drive(() => fx.execute(retried), 67, 449);
      expect(list).not.toHaveBeenCalled();
      expect(attempts).not.toHaveBeenCalled();
    } finally {
      list.mockRestore();
      attempts.mockRestore();
    }
    expect(fx.rawRuntime.snapshot().active).toBe(0);
  } finally {
    await fx.close();
  }
});

it('drops cached admission evidence on stream quiescence', async () => {
  const { probe, fx } = await textFixture();
  try {
    const ids = await probe.drive(() => fx.submit('Quiesce receipts'), 67, 449);
    const store = receiptStore(fx.rawRuntime);
    expect(store.get(fx.identity.userId, ids.sessionId, ids.attemptId)).not.toBeNull();
    await fx.rawRuntime.quiesceStreams(1_000);
    expect(store.get(fx.identity.userId, ids.sessionId, ids.attemptId)).toBeNull();
    fx.rawRuntime.releaseStreamFence();
  } finally {
    await fx.close();
  }
});
