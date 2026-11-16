/**
 * ============================================================================
 * FILE: calendar-publication.spec.ts
 * LOCATION: backend/test/runtime/calendar-publication.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Proves the durable Calendar turn state is projected truthfully for a v2
 *    operation: a confirmed receipt survives failed finalization, a later
 *    default-calendar change and an unconfirmed operation event.
 *
 * ROLE IN PROJECT:
 *    Runtime coverage for the read model that the Calendar turn-state port
 *    serves. The projection must branch on the stored operation schema and
 *    must never infer the outcome from assistant prose or the latest default.
 *
 * KEY COMPONENTS:
 *    - confirmed receipt after failed finalization and a default change.
 *    - no receipt while the succeeded operation event is unconfirmed.
 *    - unchanged legacy v1 projection.
 *    - expired source hides the label and link but keeps the event id.
 *    - reconnect retry when the account was replaced before resolution.
 *    - idempotent republication of a saved seal with a monotonic sequence.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import {
  projectCalendarTurnState,
  projectCalendarTurnStateCompatible,
  publishCalendarTurn,
} from '../../src/chat-runtime/calendar-publication.js';
import { Work } from '../../src/chat-runtime/work.js';
import { outputId } from '../../src/chat-runtime/identity.js';
import { calendarSealSchema } from '../../src/agent/state.js';
import { graphThreadId } from '../../src/persistence/index.js';
import { brokenTextWire, calendarFixture, createWire, loadWire, nativeWire, textWire } from './calendar-runtime.fixture.js';
import { event } from './calendar-multi-fixture.js';

const workRequest =
  'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.';

it('retains the original durable calendar receipt when finalization fails and the default changes', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(workRequest);
    h.failOnce('result-save-v2');
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'), brokenTextWire());
    await expect(h.execute(ids)).rejects.toBeDefined();
    await h.setDefault('personal@example.test');
    const state = await projectCalendarTurnStateCompatible(
      h.p, h.identity.userId, ids.sessionId, ids.turnId);
    expect(state).toMatchObject({
      schemaVersion: 2,
      state: 'succeeded',
      narration: 'failed',
      receipt: { durable: true, calendarLabel: 'Work' },
      retryAction: 'none',
    });
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('reports no receipt while the succeeded operation event is unconfirmed', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(workRequest);
    h.failOperationEvent('succeeded');
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'), brokenTextWire());
    await expect(h.execute(ids)).rejects.toBeDefined();
    const state = await projectCalendarTurnStateCompatible(
      h.p, h.identity.userId, ids.sessionId, ids.turnId);
    expect(state).toMatchObject({ schemaVersion: 2, state: 'dispatching', receipt: null });
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('keeps the legacy v1 receipt projection unchanged', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(workRequest);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'), brokenTextWire());
    await h.execute(ids);
    // The legacy projection reads the v1 turn-keyed operation and stays blind to
    // the v2 intent-keyed operation.
    expect(await projectCalendarTurnState(h.p, h.identity.userId, ids.sessionId, ids.turnId))
      .toBeNull();
  } finally { await h.dispose(); }
});

it('keeps the durable event id but hides the expired label and link', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(workRequest);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'), brokenTextWire());
    await h.execute(ids);
    const operation = await h.operationFor(ids);
    h.advance(25 * 60 * 60 * 1000);
    const state = await projectCalendarTurnStateCompatible(
      h.p, h.identity.userId, ids.sessionId, ids.turnId, h.clock());
    expect(state).toMatchObject({
      schemaVersion: 2,
      state: 'succeeded',
      receipt: { durable: true, eventId: operation?.googleEventId, htmlLink: null, calendarLabel: null },
    });
  } finally { await h.dispose(); }
});

it('asks for a reconnect when the account was replaced before the operation resolved', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(workRequest);
    h.failOnce('operation-dispatch');
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'), brokenTextWire());
    await expect(h.execute(ids)).rejects.toBeDefined();
    const current = await h.p.calendarConnectionsV2.get(h.identity.userId);
    if (!current || current.schemaVersion !== 2) throw new Error('expected a v2 connection');
    await h.p.calendarConnectionsV2.compareAndSwap({
      userId: h.identity.userId,
      expectedRevision: current.revision,
      expectedConnectionRevision: current.connectionRevision,
      expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
      next: {
        ...current,
        revision: current.revision + 1,
        connectionRevision: current.connectionRevision + 1,
        status: 'reconnect-required',
        discovery: null,
      },
    });
    const state = await projectCalendarTurnStateCompatible(
      h.p, h.identity.userId, ids.sessionId, ids.turnId, h.clock());
    expect(state).toMatchObject({ schemaVersion: 2, retryAction: 'reconnect' });
    expect(state?.receipt).toBeNull();
  } finally { await h.dispose(); }
});

it('republishes a saved seal idempotently with a monotonic protocol-3 sequence', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(workRequest);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'), textWire('Created the event.'));
    await h.execute(ids);

    const attempt = await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId);
    if (!attempt) throw new Error('missing attempt');
    const tuple = await h.saver.getTuple({
      configurable: { thread_id: graphThreadId(h.identity.userId, ids.sessionId), checkpoint_ns: '' },
    });
    const values = (tuple?.checkpoint?.channel_values ?? {}) as { calendarSeal?: unknown };
    const seal = calendarSealSchema.parse(values.calendarSeal);
    const published = await h.p.messages.get(h.identity.userId, ids.sessionId, outputId(attempt));
    const narration = published?.content ?? null;
    if (narration === null) throw new Error('expected a published assistant message');

    const acquired = await h.p.owner.acquire({
      userId: h.identity.userId, sessionId: ids.sessionId,
      ownerId: h.p.owner.executorId, leaseMs: 60_000,
    });
    if (!acquired.ok) throw new Error('expected the session lease');
    const work = new Work(new AbortController().signal, 60_000, () => {}, () => {});
    const frames: number[] = [];
    const events: { type?: string; calendarView?: unknown }[] = [];
    const sequence = { value: 7 };
    const result = await publishCalendarTurn({
      persistence: h.p, work, lease: acquired.lease, attempt, seal, narration,
      assistantSequence: 1, persistenceTimeoutMs: 15_000,
      emit: async envelope => { frames.push(envelope.sequence); events.push(envelope.event); },
      sequence,
    });
    expect(result.status).toBe('completed');
    expect(result.assistantMessageId).toBe(published?.messageId ?? null);
    const savedView = seal.version === 2 ? seal.view : undefined;
    expect(published?.calendarView).toEqual(savedView);
    if (savedView) expect(events.find(event => event.type === 'completed')).toMatchObject({ calendarView: savedView });
    // The exact saved assistant message is reused, never appended twice.
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 20 });
    expect(messages.items.filter(m => m.role === 'assistant')).toHaveLength(1);
    expect(frames).toEqual([7, 8, 9]);
    await h.p.owner.release(acquired.lease);
    work.close();
  } finally { await h.dispose(); }
});

it('writes the saved view with narration and reuses it on recovery without another inference', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'),
      nativeWire('{"eventId":"abcde"}'), textWire('Found it.'));
    h.failOnce('manifest-save');
    await expect(h.execute(ids)).rejects.toBeDefined();
    const attempt = (await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))!;
    const before = await h.p.messages.get(h.identity.userId, ids.sessionId, outputId(attempt));
    expect(before?.calendarView).toMatchObject({ kind: 'agenda', entries: [{ eventId: 'abcde' }] });
    const requests = h.modelBodies.length;
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    const after = await h.p.messages.get(h.identity.userId, ids.sessionId, outputId(attempt));
    expect(after?.calendarView).toEqual(before?.calendarView);
    expect(h.modelBodies).toHaveLength(requests);
    expect((await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 20 })).items
      .filter(m => m.role === 'assistant')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('hands the terminal attempt and its acknowledged receipt to the cleanup callback before the terminal frame', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(workRequest);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'), textWire('Created the event.'));
    await h.execute(ids);

    const attempt = await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId);
    if (!attempt) throw new Error('missing attempt');
    const tuple = await h.saver.getTuple({
      configurable: { thread_id: graphThreadId(h.identity.userId, ids.sessionId), checkpoint_ns: '' },
    });
    const values = (tuple?.checkpoint?.channel_values ?? {}) as { calendarSeal?: unknown };
    const seal = calendarSealSchema.parse(values.calendarSeal);
    const published = await h.p.messages.get(h.identity.userId, ids.sessionId, outputId(attempt));
    if (!published) throw new Error('expected a published assistant message');

    const acquired = await h.p.owner.acquire({
      userId: h.identity.userId, sessionId: ids.sessionId,
      ownerId: h.p.owner.executorId, leaseMs: 60_000,
    });
    if (!acquired.ok) throw new Error('expected the session lease');
    const work = new Work(new AbortController().signal, 60_000, () => {}, () => {});
    const completions: { attempt: { status: string }; receipt: unknown; activityAt: string | null }[] = [];
    const frames: number[] = [];
    await publishCalendarTurn({
      persistence: h.p, work, lease: acquired.lease, attempt, seal, narration: published.content,
      assistantSequence: 1, persistenceTimeoutMs: 15_000,
      beforeTerminal: async completion => { completions.push(completion); },
      emit: async envelope => { frames.push(envelope.sequence); },
      sequence: { value: 1 },
    });
    // Strict recovery reads a missing receipt; it never claims one.
    expect(completions).toHaveLength(1);
    expect(completions[0].attempt.status).toBe('completed');
    expect(completions[0].receipt).toBeNull();
    expect(completions[0].activityAt).toBe(published.createdAt);
    expect(frames).toEqual([1, 2, 3]);
    await h.p.owner.release(acquired.lease);
    work.close();
  } finally { await h.dispose(); }
});
