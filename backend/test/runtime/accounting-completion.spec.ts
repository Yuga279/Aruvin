/**
 * ============================================================================
 * FILE: accounting-completion.spec.ts
 * LOCATION: backend/test/runtime/accounting-completion.spec.ts
 * PURPOSE: Verify completion telemetry and legacy checkpoint finalization replay.
 * ROLE IN PROJECT: Uses existing MemorySaver/runtime fixtures without inference on recovery.
 * KEY COMPONENTS: Post-durability timing, optional-write faults, saved result replay.
 * ============================================================================
 */
import { textConfigFixture } from './text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { graphConfig, publishResult } from '../../src/chat-runtime/finalization.js';
import { buildTurnGraph } from '../../src/agent/turn-graph.js';
import { Work } from '../../src/chat-runtime/work.js';

it('records durable completion only after terminal application state, and replay keeps its first observation', async () => {
  const h = textConfigFixture(textSnapshot(1));
  try {
    const ids = await h.submit(); await h.execute(ids);
    const first = await h.p.metadata.getAccounting(h.identity.userId, ids.sessionId, ids.attemptId);
    // The completion timing is telemetry, not a second accounting write.
    expect(first?.timing?.durableCompletedAt).toBeNull();
    expect(first?.timing?.providerEndedAt).toMatch(/Z$/);
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    expect(await h.p.metadata.getAccounting(h.identity.userId, ids.sessionId, ids.attemptId)).toEqual(first);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  } finally { await h.dispose(); }
});
it('keeps durable success when the optional completion-timing observation fails', async () => {
  const h = textConfigFixture(textSnapshot(1));
  const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
  const save = h.p.metadata.putAccounting.bind(h.p.metadata);
  h.p.metadata.putAccounting = async record => {
    if (record.timing?.durableCompletedAt) throw new Error('private optional telemetry failure');
    await save(record);
  };
  try {
    const ids = await h.submit(); await h.execute(ids);
    expect((await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status).toBe('completed');
    expect(h.runtime.snapshot().active).toBe(0);
    // No completion-timing write is attempted, so no optional write can fail.
    expect(warn).not.toHaveBeenCalled();
  } finally { warn.mockRestore(); await h.dispose(); }
});
it('finalizes a legacy JSON saved result repeatedly without generating or fabricating provider elapsed time', async () => {
  const h = textConfigFixture(textSnapshot(1));
  const work = new Work(new AbortController().signal, 10000, () => {}, () => {});
  try {
    const ids = await h.submit(); await h.execute(ids);
    const cfg = graphConfig(h.identity.userId, ids.sessionId);
    const graph = buildTurnGraph(h.saver, { prepare: async () => { throw new Error('No inference'); },
      generate: async () => { throw new Error('No inference'); } });
    const snapshot = await graph.getState(cfg);
    const legacy = JSON.parse(JSON.stringify(snapshot.values.result!));
    delete legacy.accounting.money; delete legacy.accounting.timing;
    delete legacy.accounting.cachedPromptTokens; delete legacy.accounting.cacheWriteTokens; delete legacy.accounting.reasoningOutputTokens;
    // Existing historical records must remain accepted by strict saved-result validation.
    await graph.updateState(cfg, { result: legacy }, 'seal');
    await h.p.metadata.putAccounting(legacy.accounting);
    const current = await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId);
    const lease = await h.p.owner.recoverStoppedSession(h.identity.userId, ids.sessionId, null, 180000);
    await publishResult(h.p, lease, work, graph, current!, legacy);
    await publishResult(h.p, lease, work, graph, current!, legacy);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect((await h.p.metadata.getAccounting(h.identity.userId, ids.sessionId, ids.attemptId))?.timing)
      .toMatchObject({ providerDurationMs: null, firstOutputLatencyMs: null, dispatchedAt: null });
    await h.p.owner.release(lease);
  } finally { await work.settled(); work.close(); await h.dispose(); }
});
it('recovers an actually unfinished sealed legacy result through the runtime without another inference', async () => {
  const h = textConfigFixture(textSnapshot(1));
  const putManifest = h.p.memory.put.bind(h.p.memory);
  try {
    const ids = await h.submit();
    h.p.memory.put = async value => { if (value.contextVersion === 1) throw new Error('Fixture publication interruption'); await putManifest(value); };
    await expect(h.execute(ids)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
    expect((await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status).toBe('finalizing');
    const graph = buildTurnGraph(h.saver, { prepare: async () => { throw new Error('No replay'); },
      generate: async () => { throw new Error('No replay'); } });
    const cfg = graphConfig(h.identity.userId, ids.sessionId);
    const snapshot = await graph.getState(cfg);
    expect(typeof snapshot.values.result!.accounting.money!.reportedAmount).toBe('string');
    const legacy = JSON.parse(JSON.stringify(snapshot.values.result!));
    for (const field of ['money', 'timing', 'cachedPromptTokens', 'cacheWriteTokens', 'reasoningOutputTokens']) delete legacy.accounting[field];
    await graph.updateState(cfg, { result: legacy }, 'seal');
    await h.p.metadata.putAccounting(legacy.accounting);
    h.p.memory.put = putManifest;
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect((await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status).toBe('completed');
    const history = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(history.items.filter(m => m.role === 'user')).toHaveLength(1);
    expect(history.items.filter(m => m.role === 'assistant')).toHaveLength(1);
    expect((await h.p.metadata.getAccounting(h.identity.userId, ids.sessionId, ids.attemptId))?.timing)
      .toMatchObject({ dispatchedAt: null, providerDurationMs: null, firstOutputLatencyMs: null });
  } finally { h.p.memory.put = putManifest; await h.dispose(); }
});
