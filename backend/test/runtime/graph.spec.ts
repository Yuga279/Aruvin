/**
 * ============================================================================
 * FILE: graph.spec.ts
 * LOCATION: backend/test/runtime/graph.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify bounded reference graph state and the prepare/generate/seal graph.
 *
 * ROLE IN PROJECT:
 *    Proves P5 graph channels stay reference-only, reject private result data,
 *    and that real LangGraph sync invocation never stores a transcript.
 *
 * KEY COMPONENTS:
 *    - Schema tests: Boundary identity and strict saved-result validation.
 *    - Graph tests: Missing input, seal-attributed repair, no messages channel.
 * ============================================================================
 */

import { MemorySaver } from '@langchain/langgraph';
import { emptyBoundary, boundaryFor, resultSchema } from '../../src/agent/state.js';
import { buildTurnGraph } from '../../src/agent/turn-graph.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { buildReferenceManifest } from '../../src/context/index.js';
import { assets } from '../context/fixtures.js';
it('identifies exact reference/version state and refuses fabricated/private result data', () => {
  const m = buildReferenceManifest('u', 's', 0, [], assets, DEFAULT_BUDGETS);
  expect(emptyBoundary(m)).toEqual(boundaryFor(m));
  expect(boundaryFor({ ...m, contextVersion: 1 })).not.toEqual(boundaryFor(m));
  expect(resultSchema.safeParse({ reasoning: 'private', text: 'not a linked result' }).success).toBe(false);
});
it('awaits sync terminal persistence and never appends model messages into graph state', async () => {
  const saver = new MemorySaver();
  const prepare = vi.fn(async () => undefined);
  const generate = vi.fn(async () => { throw new Error('fixture generate fails'); });
  const graph = buildTurnGraph(saver, { prepare, generate });
  const cfg = { configurable: { thread_id: 'fixture', checkpoint_ns: '' }, durability: 'sync' as const };
  await graph.updateState(cfg, { input: null, result: null, boundary: null, sealed: false }, 'seal');
  await expect(graph.invoke({ input: null, result: null, sealed: false }, cfg)).rejects.toThrow('Chat input is unavailable.');
  expect(generate).not.toHaveBeenCalled();
  expect((await graph.getState(cfg)).values).not.toHaveProperty('messages');
});
it('manual boundary update uses seal and leaves no model node scheduled', async () => {
  const generate = vi.fn(async () => { throw new Error('must not infer'); });
  const graph = buildTurnGraph(new MemorySaver(), { prepare: async () => undefined, generate });
  const cfg = { configurable: { thread_id: 'repair', checkpoint_ns: '' } };
  await graph.updateState(cfg, { input: null, result: null, sealed: false,
    boundary: { contextVersion: 0, manifestHash: 'a'.repeat(64) } }, 'seal');
  expect((await graph.getState(cfg)).next).toEqual([]);
  expect(generate).not.toHaveBeenCalled();
});
it('a later invoke replaces prior input rather than appending transcript channels', async () => {
  const graph = buildTurnGraph(new MemorySaver(), {
    prepare: async () => undefined,
    generate: async () => { throw new Error('must not infer'); },
  });
  const cfg = { configurable: { thread_id: 'replace', checkpoint_ns: '' }, durability: 'sync' as const };
  await graph.updateState(cfg, { input: null, result: null, sealed: false, rebase: null,
    boundary: { contextVersion: 0, manifestHash: 'b'.repeat(64) } }, 'seal');
  await graph.updateState(cfg, { input: null, result: null, sealed: true,
    boundary: { contextVersion: 1, manifestHash: 'c'.repeat(64) } }, 'seal');
  const state = await graph.getState(cfg);
  expect(state.values.boundary?.contextVersion).toBe(1);
  expect(state.values).not.toHaveProperty('messages');
  expect(state.next).toEqual([]);
});

it('LangGraph state snapshot never contains apiKey, configSnapshot, or credentials', async () => {
  const saver = new MemorySaver();
  const graph = buildTurnGraph(saver, {
    prepare: async () => undefined,
    generate: async () => undefined,
  });
  const cfg = { configurable: { thread_id: 'secret-free', checkpoint_ns: '' }, durability: 'sync' as const };
  await graph.updateState(cfg, { input: null, result: null, sealed: true, boundary: { contextVersion: 1, manifestHash: 'c'.repeat(64) } }, 'seal');
  const state = await graph.getState(cfg);
  const json = JSON.stringify(state.values);
  expect(json).not.toContain('apiKey');
  expect(json).not.toContain('configSnapshot');
  expect(json).not.toContain('Bearer');
  expect(json).not.toContain('credential');
  expect(state.values).not.toHaveProperty('apiKey');
  expect(state.values).not.toHaveProperty('configSnapshot');
});

it('Calendar seal terminates without scheduling generate and keeps reference-only refs', async () => {
  const generate = vi.fn(async () => { throw new Error('must not infer'); });
  const graph = buildTurnGraph(new MemorySaver(), {
    prepare: async () => undefined, generate,
  });
  const cfg = { configurable: { thread_id: 'calendar-seal', checkpoint_ns: '' }, durability: 'sync' as const };
  const calendarRefs = { version: 1 as const, userId: 'u', sessionId: 's', turnId: 't',
    decisionIds: ['d1'], toolCallIds: ['c1'], operationId: null };
  await graph.updateState(cfg, {
    input: null, result: null, sealed: true, calendarSeal: null, calendarCursor: null,
    calendarRefs, boundary: { contextVersion: 0, manifestHash: 'a'.repeat(64) },
  }, 'seal');
  const state = await graph.getState(cfg);
  expect(state.next).toEqual([]);
  expect(generate).not.toHaveBeenCalled();
  expect(JSON.stringify(state.values)).not.toContain('tool_calls');
  expect(state.values.calendarRefs).toEqual(calendarRefs);
});

