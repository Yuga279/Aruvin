/**
 * ============================================================================
 * FILE: calendar-graph.spec.ts
 * LOCATION: backend/test/runtime/calendar-graph.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the Calendar graph keeps reference-only state and restores saved boundaries safely.
 *
 * ROLE IN PROJECT:
 *    Proves Task 8 invariants: the graph routes from the saved cursor instead of a fresh
 *    decision, refuses legacy pending work, and never re-derives a boundary that no
 *    longer matches the committed manifest.
 *
 * KEY COMPONENTS:
 *    - Cursor routing tests: v2 next-state routing and legacy cursor refusal.
 *    - Seal tests: attempt scoping, boundary restore, reference-only narration.
 *    - Runtime test: the persisted calendar checkpoint holds references only.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';
import { buildTurnGraph } from '../../src/agent/turn-graph.js';
import {
  boundaryFor, calendarCursorSchema, calendarCursorV1Schema, calendarCursorV2Schema, calendarSealV2Schema,
  type CalendarCursor, type CalendarSeal,
} from '../../src/agent/state.js';
import { attemptRecordSchema } from '../../src/contracts/attempt.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { buildReferenceManifest } from '../../src/context/index.js';
import {
  calendarCheckpointRefsV2Schema, compatibleCalendarCheckpointRefsSchema,
  compatibleSkillCheckpointRefsSchema,
} from '../../src/persistence/calendar-checkpoints.js';
import { graphThreadId } from '../../src/persistence/index.js';
import { assets } from '../context/fixtures.js';
import { calendarFixture, loadWire, nativeWire, textWire } from './calendar-runtime.fixture.js';

const attempt = attemptRecordSchema.parse({
  schemaVersion: 1, kind: 'attempt', userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a1',
  idempotencyKey: 'request-0001', payloadHash: 'a'.repeat(64), status: 'generating', sequence: 0,
  createdAt: '2026-10-21T09:00:00.000Z', updatedAt: '2026-10-21T09:00:00.000Z',
  instructionVersion: 'fixture-v1', knowledgeContentHash: 'b'.repeat(64), graphSchemaVersion: 'fixture-v1',
  contextVersion: 0, modelId: 'fixture-model', openRouterUser: 'u', generationId: null, truncated: false,
  errorCode: null, causal: { userMessageId: 'm1', previousAttemptId: null },
});
const input = { attempt, assistantSequence: 2 };
const manifest = buildReferenceManifest('u', 's', 0, [], assets, DEFAULT_BUDGETS);

const v2Cursor: CalendarCursor = calendarCursorV2Schema.parse({
  version: 2, schemaRevision: 'google-calendar.v2', configRevision: 1, connectionId: 'c',
  connectionRevision: 1, accountSubjectId: 'sub', deadlineAt: '2026-10-21T09:05:00.000Z',
  trustedNow: '2026-10-21T09:00:00.000Z', trustedTimeZone: 'Etc/UTC', limits: CALENDAR_LIMITS,
  next: 'execute', pendingDecisionId: 'd1', pendingToolCallId: 'call-1', pendingOperationId: null,
  pendingIntentId: null, pendingProposalId: null, repair: null,
});
const v1Cursor: CalendarCursor = calendarCursorV1Schema.parse({
  version: 1, configRevision: 1, connectionId: 'c', connectionRevision: 1, targetRevision: 1,
  trustedNow: '2026-10-21T09:00:00.000Z', trustedTimeZone: 'Etc/UTC', limits: CALENDAR_LIMITS,
  next: 'execute', pendingDecisionId: 'd1', repair: null,
});
const seal: CalendarSeal = calendarSealV2Schema.parse({
  version: 2, input, base: boundaryFor(manifest), target: manifest,
  narrationRef: { kind: 'proposal-message', proposalId: 'p1', proposalRevision: 1 },
  dispatchIds: ['d1'], operationId: null, outcome: 'completed', assistantCreatedAt: '2026-10-21T09:00:01.000Z',
});

const cfg = (thread: string) => ({
  configurable: { thread_id: thread, checkpoint_ns: '' }, durability: 'sync' as const,
});
const payload = { input, result: null, sealed: false, rebase: null };

it('routes a supplied v2 cursor to its saved next state instead of a fresh decision', async () => {
  const decide = vi.fn(async () => ({ calendarCursor: v2Cursor }));
  const execute = vi.fn(async () => ({ calendarCursor: { ...v2Cursor, next: 'seal' as const }, calendarSeal: seal }));
  const graph = buildTurnGraph(new MemorySaver(), {
    prepare: async () => ({ calendarCursor: v2Cursor }),
    generate: async () => { throw new Error('must not infer'); }, decide, execute,
  });
  const conf = cfg('v2-route');
  await graph.invoke(payload, conf);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(decide).not.toHaveBeenCalled();
  expect((await graph.getState(conf)).values.sealed).toBe(true);
});

it('refuses a legacy pending tool instead of converting it into a v2 call', async () => {
  const decide = vi.fn(async () => ({ calendarCursor: v2Cursor }));
  const execute = vi.fn(async () => ({ calendarCursor: v2Cursor }));
  const graph = buildTurnGraph(new MemorySaver(), {
    prepare: async () => ({ calendarCursor: v1Cursor }),
    generate: async () => { throw new Error('must not infer'); }, decide, execute,
  });
  const conf = cfg('legacy-cursor');
  await expect(graph.invoke(payload, conf)).rejects.toThrow('Calendar work needs a fresh request.');
  expect(execute).not.toHaveBeenCalled();
  expect(decide).not.toHaveBeenCalled();
});

it('does not inherit calendar state that belongs to another turn', async () => {
  const decide = vi.fn(async () => ({ calendarCursor: v2Cursor }));
  const generate = vi.fn(async () => { throw new Error('must not infer'); });
  const graph = buildTurnGraph(new MemorySaver(), { prepare: async () => undefined, generate, decide });
  const conf = cfg('stale-calendar-state');
  await graph.updateState(conf, { ...payload, calendarCursor: v1Cursor,
    calendarSeal: calendarSealV2Schema.parse({ ...seal, input: { attempt: { ...attempt, attemptId: 'a2' }, assistantSequence: 2 } }),
    calendarRefs: null }, 'seal');
  await expect(graph.invoke(payload, conf)).rejects.toThrow('must not infer');
  expect(decide).not.toHaveBeenCalled();
});

it('publishes a restored seal that matches the accepted attempt without a fresh decision', async () => {
  const decide = vi.fn(async () => ({ calendarCursor: v2Cursor }));
  const generate = vi.fn(async () => { throw new Error('must not infer'); });
  const graph = buildTurnGraph(new MemorySaver(), { prepare: async () => undefined, generate, decide });
  const conf = cfg('restored-seal');
  await graph.updateState(conf, { ...payload, calendarSeal: seal, calendarCursor: null, calendarRefs: null }, 'seal');
  await graph.invoke(payload, conf);
  expect(decide).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
  expect((await graph.getState(conf)).values.sealed).toBe(true);
});

it('refuses a restored seal that belongs to another attempt', async () => {
  const other = calendarSealV2Schema.parse({
    ...seal, input: { attempt: { ...attempt, attemptId: 'a2' }, assistantSequence: 2 },
  });
  const graph = buildTurnGraph(new MemorySaver(), {
    prepare: async () => ({ calendarCursor: { ...v2Cursor, next: 'seal' as const }, calendarSeal: other }),
    generate: async () => { throw new Error('must not infer'); },
  });
  const conf = cfg('seal-attempt');
  await expect(graph.invoke(payload, conf)).rejects.toThrow('The saved answer could not be confirmed.');
});

it('refuses a seal whose base boundary no longer matches the committed manifest', async () => {
  const graph = buildTurnGraph(new MemorySaver(), {
    prepare: async () => ({ calendarCursor: { ...v2Cursor, next: 'seal' as const } }),
    generate: async () => { throw new Error('must not infer'); },
  });
  const conf = cfg('seal-boundary');
  await graph.updateState(conf, { ...payload, calendarSeal: seal, calendarCursor: null, calendarRefs: null,
    boundary: { contextVersion: 0, manifestHash: 'c'.repeat(64) } }, 'seal');
  await expect(graph.invoke(payload, conf)).rejects.toThrow('Chat context needs recovery.');
});

it('keeps a clarification reference instead of a copy of the user sentence', async () => {
  const graph = buildTurnGraph(new MemorySaver(), {
    prepare: async () => ({ calendarCursor: { ...v2Cursor, next: 'seal' as const }, calendarSeal: seal }),
    generate: async () => { throw new Error('must not infer'); },
  });
  const conf = cfg('seal-narration');
  await graph.invoke(payload, conf);
  const values = (await graph.getState(conf)).values;
  expect(values.calendarSeal).toEqual(seal);
  expect(JSON.stringify(values)).not.toContain('Schedule Planning');
  expect(calendarSealV2Schema.safeParse({ ...seal, narration: 'Schedule Planning on 2026-11-03' }).success).toBe(false);
});

it('bounds the saved calendar references', () => {
  const refs = { version: 2 as const, userId: 'u', sessionId: 's', turnId: 't', decisionIds: [],
    toolCallIds: [], operationId: null, intentId: null, proposalId: null, connectionId: 'c',
    connectionRevision: 1, schemaRevision: 'google-calendar.v2' as const };
  expect(calendarCheckpointRefsV2Schema.safeParse({ ...refs, decisionIds: Array.from({ length: 9 }, (_, i) => `d${i}`) }).success).toBe(false);
  expect(calendarCheckpointRefsV2Schema.safeParse({ ...refs, toolCallIds: Array.from({ length: 7 }, (_, i) => `c${i}`) }).success).toBe(false);
  expect(compatibleCalendarCheckpointRefsSchema.safeParse({ ...refs, decisionIds: Array.from({ length: 8 }, (_, i) => `d${i}`) }).success).toBe(true);
});

it('keeps a persisted calendar turn reference-only', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'),
      nativeWire('{"eventId":'), nativeWire('{"eventId":"abcde"}'), textWire('Found it.'));
    await h.execute(ids);
    const tuple = await h.saver.getTuple({ configurable: {
      thread_id: graphThreadId(h.identity.userId, ids.sessionId), checkpoint_ns: '',
    } });
    const values = (tuple?.checkpoint.channel_values ?? {}) as Record<string, unknown>;
    const seal = calendarSealV2Schema.parse(values.calendarSeal);
    // The bounded presentation view is the one allowed content-bearing field;
    // tool payloads, prose, and credentials remain reference-only.
    expect(seal.view).toMatchObject({ kind: 'agenda', entries: [{ eventId: 'abcde' }] });
    const withoutView = JSON.parse(JSON.stringify(values)) as Record<string, { view?: unknown }>;
    if (withoutView.calendarSeal) delete withoutView.calendarSeal.view;
    const json = JSON.stringify(withoutView);
    expect(json).not.toContain('Planning');
    expect(json).not.toContain('Found it.');
    expect(json).not.toContain('tool_calls');
    expect(json).not.toContain('Bearer');
    expect(compatibleSkillCheckpointRefsSchema.safeParse(values.calendarRefs).success).toBe(true);
    expect(calendarCursorSchema.safeParse(values.calendarCursor).success).toBe(true);
  } finally { await h.dispose(); }
});
