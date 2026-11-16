/**
 * ============================================================================
 * FILE: conversation-latency.spec.ts
 * LOCATION: backend/test/performance/conversation-latency.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Measure conversation read amplification and Calendar overhead offline.
 *
 * ROLE IN PROJECT:
 *    Latency regression assertions using existing deterministic fixtures.
 *    No environment files, database connections, or live providers are used.
 *
 * KEY COMPONENTS:
 *    - Follow-up profile: Counts point reads before inference and at completion.
 *    - Calendar profile: Counts accounting storage commands and model requests.
 *    - Capability profile: Measures repeated real connection-service discovery.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { setImmediate as yieldTurn, setTimeout as delay } from 'node:timers/promises';
import { MongoCalendarAccounting } from '../../src/persistence/calendar-accounting.js';
import { calendarExecutionBindingV2Schema } from '../../src/contracts/calendar-operations.js';
import { CalendarApi } from '../../src/plugins/google-calendar/calendar-api.js';
import { CalendarToolFault } from '../../src/plugins/google-calendar/tools-validation.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { textConfigFixture } from '../runtime/text-config-fixture.js';
import { calendarFixture, createWire, nativeWire, textWire } from '../runtime/calendar-runtime.fixture.js';
import { event } from '../runtime/calendar-multi-fixture.js';
import { multiConnectionFixture } from '../plugins/google-calendar/connection-multi-fixtures.js';
import { nativeFrame } from '../model/calendar-fixtures.js';

afterEach(() => vi.restoreAllMocks());

it('profiles historical point reads on increasingly long text conversations', async () => {
  const h = textConfigFixture(textSnapshot(1, { maxMessagesInContext: 500 }));
  h.p.messages.budgets.maxMessagesInContext = 500;
  const messages = vi.spyOn(h.p.messages, 'get');
  const acceptance = vi.spyOn(h.p.metadata, 'getAcceptance');
  const references = vi.spyOn(h.p.messages, 'getReferences');
  const markers = vi.spyOn(h.p.metadata, 'getAcceptances');
  const originalFetch = h.fetcher.getMockImplementation()!;
  let atModel = { messageReads: 0, acceptanceReads: 0, referenceQueries: 0, acceptanceQueries: 0 };
  h.fetcher.mockImplementation((...args) => {
    atModel = { messageReads: messages.mock.calls.length, acceptanceReads: acceptance.mock.calls.length,
      referenceQueries: references.mock.calls.length, acceptanceQueries: markers.mock.calls.length };
    return originalFetch(...args);
  });
  let sessionId: string | null = null;
  let previousTurns = 0;
  const rows = [];
  try {
    for (const target of [0, 5, 20, 50]) {
      while (previousTurns < target) {
        const ids = await h.submit('Hello', sessionId);
        await h.execute(ids);
        sessionId = ids.sessionId;
        previousTurns++;
      }
      messages.mockClear();
      acceptance.mockClear();
      references.mockClear(); markers.mockClear();
      const started = performance.now();
      const ids = await h.submit('A short follow-up', sessionId);
      await h.execute(ids);
      expect(atModel.messageReads + atModel.acceptanceReads).toBeLessThanOrEqual(5);
      expect(messages.mock.calls.length + acceptance.mock.calls.length).toBeLessThanOrEqual(8);
      expect(atModel.referenceQueries).toBeLessThanOrEqual(1);
      expect(references.mock.calls.length).toBeLessThanOrEqual(2);
      expect(markers.mock.calls.length).toBeLessThanOrEqual(2);
      rows.push({ previousTurns, beforeModel: { ...atModel },
        total: { messageReads: messages.mock.calls.length, acceptanceReads: acceptance.mock.calls.length,
          referenceQueries: references.mock.calls.length, acceptanceQueries: markers.mock.calls.length },
        fixtureElapsedMs: Math.round(performance.now() - started) });
      expect(await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId)).toMatchObject({ status: 'completed' });
      sessionId = ids.sessionId;
      previousTurns++;
    }
    console.log('LATENCY_TEXT_PROFILE', JSON.stringify(rows));
  } finally { await h.dispose(); }
}, 30000);

it('profiles Calendar-enabled ordinary text, one read, and one create', async () => {
  const rows = [];
  for (const scenario of ['ordinary-text', 'get-event', 'create-event'] as const) {
    const h = calendarFixture();
    await yieldTurn(); // Exclude the fixture's asynchronous connection seed.
    const accounting = h.p.calendarAccounting as MongoCalendarAccounting;
    const store = accounting.store;
    const originalCollection = store.collection.bind(store);
    const counts: Record<string, number> = {};
    vi.spyOn(store, 'collection').mockImplementation(name => {
      const collection = originalCollection(name);
      return new Proxy(collection, { get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const key = `${name}.${String(property)}`;
          counts[key] = (counts[key] ?? 0) + 1;
          return Reflect.apply(value, target, args);
        };
      } });
    });
    try {
      h.clearAvailability();
      const ids = await h.submit(scenario === 'create-event'
        ? 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.' : 'Hello');
      if (scenario === 'get-event') h.modelWires.push(nativeWire('{"eventId":"abcde"}'));
      if (scenario === 'create-event') h.modelWires.push(createWire(event()));
      h.modelWires.push(textWire('Done.'));
      await h.execute(ids);
      const commands = Object.values(counts).reduce((sum, n) => sum + n, 0);
      expect(commands).toBeLessThanOrEqual({ 'ordinary-text': 27, 'get-event': 67, 'create-event': 105 }[scenario]);
      rows.push({ scenario, modelRequests: h.modelBodies.length, calendarStorageCommands: { ...counts },
        providerRequestsInFixture: [...h.requestKinds],
        toolSchemaBytes: Buffer.byteLength(JSON.stringify(h.modelBodies[0]?.tools ?? [])),
        budget: await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId) });
      expect(await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId)).toMatchObject({ status: 'completed' });
    } finally { await h.dispose(); vi.restoreAllMocks(); }
  }
  // IDs and fake deadlines are omitted; only counts describe the fixture.
  console.log('LATENCY_CALENDAR_PROFILE', JSON.stringify(rows.map(({ budget, ...row }) => ({ ...row,
    budget: budget && { modelDispatches: budget.modelDispatches, repairs: budget.repairs,
      logicalTools: budget.logicalTools, calendarRequests: budget.calendarRequests } }))));
});

it('profiles capability refreshes even when the catalogue is already fresh', async () => {
  const h = await multiConnectionFixture();
  try {
    const request = await h.request('create');
    const resolved = await h.service.resolveTarget(request);
    expect(resolved.outcome).toBe('resolved');
    if (resolved.outcome !== 'resolved') throw new Error('Fixture target resolution failed');
    const afterResolve = h.discover.mock.calls.length;
    await h.service.resolveTarget({ ...request, selector: resolved.target.calendarId });
    const afterWriterCapability = h.discover.mock.calls.length;
    await h.service.requireTargetCurrent({ ...request, target: resolved.target });
    expect(afterResolve).toBe(0);
    expect(afterWriterCapability).toBe(0);
    expect(h.discover).toHaveBeenCalledTimes(1);
    console.log('LATENCY_CAPABILITY_PROFILE', JSON.stringify({
      afterResolve, afterWriterCapability, afterToolGate: h.discover.mock.calls.length,
      storageCommands: h.memory.calls.length,
    }));
  } finally { await h.service.close(); }
});

it('profiles accounting callbacks for a fragmented Calendar model response', async () => {
  const h = calendarFixture();
  const observe = vi.spyOn(h.p.calendarAccountingV2, 'putDispatch');
  try {
    const ids = await h.submit('Hello');
    h.modelWires.push(Array.from({ length: 100 }, (_, i) => nativeFrame({
      ...(i === 0 ? { role: 'assistant' } : {}), content: 'word ',
    })).join('') + nativeFrame({}, 'stop') + 'data: [DONE]\n\n');
    await h.execute(ids);
    console.log('LATENCY_STREAM_PROFILE', JSON.stringify({
      textFrames: 100, accountingDispatchSaves: observe.mock.calls.length,
      modelRequests: h.modelBodies.length,
    }));
    expect(observe.mock.calls.length).toBeLessThanOrEqual(6);
    expect(await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId)).toMatchObject({ status: 'completed' });
  } finally { await h.dispose(); }
});

it('defers Calendar budget creation until paid dispatch or debit while preserving retry deadlines', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Hello');
    expect(await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId)).toBeNull();
    h.modelWires.push(textWire('Hello.'));
    await h.execute(ids);
    const created = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(created).not.toBeNull();
  } finally { await h.dispose(); }
});

it('measures a follow-up with five milliseconds of simulated point-read latency', async () => {
  const h = textConfigFixture(textSnapshot());
  let sessionId: string | null = null;
  try {
    for (let i = 0; i < 20; i++) {
      const ids = await h.submit('Hello', sessionId);
      await h.execute(ids);
      sessionId = ids.sessionId;
    }
    let pointReads = 0;
    const getMessage = h.p.messages.get.bind(h.p.messages);
    vi.spyOn(h.p.messages, 'get').mockImplementation(async (...args) => {
      pointReads++;
      await delay(5);
      return getMessage(...args);
    });
    const getAcceptance = h.p.metadata.getAcceptance.bind(h.p.metadata);
    vi.spyOn(h.p.metadata, 'getAcceptance').mockImplementation(async (...args) => {
      pointReads++;
      await delay(5);
      return getAcceptance(...args);
    });
    const started = performance.now();
    let beforeModelMs = 0;
    const fetcher = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation((...args) => {
      beforeModelMs = performance.now() - started;
      return fetcher(...args);
    });
    const ids = await h.submit('Short follow-up', sessionId);
    await h.execute(ids);
    expect(pointReads).toBeLessThanOrEqual(8);
    console.log('LATENCY_SIMULATED_RTT_PROFILE', JSON.stringify({
      previousTurns: 20, simulatedPointReadMs: 5, pointReads,
      beforeModelMs: Math.round(beforeModelMs), totalMs: Math.round(performance.now() - started),
    }));
    expect(await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId)).toMatchObject({ status: 'completed' });
  } finally { await h.dispose(); }
}, 15000);

it('profiles Calendar completion notification relative to execution-slot release', async () => {
  const h = calendarFixture();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const clear = h.p.owner.clearAttempt.bind(h.p.owner);
  vi.spyOn(h.p.owner, 'clearAttempt').mockImplementation(async (...args) => {
    entered();
    await gate;
    return clear(...args);
  });
  let execution: Promise<void> | undefined;
  try {
    const ids = await h.submit('Hello');
    h.modelWires.push(textWire('Hello.'));
    execution = h.execute(ids);
    await started;
    expect(h.frames.some(frame => frame.event.type === 'completed')).toBe(false);
    console.log('LATENCY_COMPLETION_PROFILE', JSON.stringify({
      completedAlreadyEmitted: h.frames.some(frame => frame.event.type === 'completed'),
      activeJobsBeforeClearAttempt: h.runtime.snapshot().active,
    }));
  } finally {
    release();
    await execution;
    expect(h.runtime.snapshot().active).toBe(0);
    await h.dispose();
  }
});

it('profiles event continuation after the normal target refresh sequence', async () => {
  const h = await multiConnectionFixture();
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
    timeZone: 'Etc/UTC', items: [], nextPageToken: 'fixture-google-page-two',
  }), { headers: { 'content-type': 'application/json' } }));
  const api = new CalendarApi({ fetcher, now: h.now });
  try {
    const request = await h.request('read');
    const resolve = async () => {
      const result = await h.service.resolveTarget(request);
      if (result.outcome !== 'resolved') throw new Error('Fixture target resolution failed');
      await h.service.requireTargetCurrent({ ...request, target: result.target });
      return result.target;
    };
    const target = await resolve();
    const binding = calendarExecutionBindingV2Schema.parse({
      ...request.account, target, sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd',
      toolCallId: 'tc', schemaRevision: 'google-calendar.v2', operation: null,
      trustedNow: new Date(h.now()).toISOString(), trustedTimeZone: 'Etc/UTC', deadlineAt: request.deadlineAt,
    });
    const context = { binding, target, accessToken: 'fixture-only', signal: request.signal,
      deadlineAt: request.deadlineAt, consumeRequest: async () => {} };
    const args = { timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20 };
    const first = await api.list(context, args);
    const next = await resolve();
    expect(first.result.nextPageToken).toEqual(expect.any(String));
    const outcome = await api.list({ ...context, target: next, binding: { ...binding, target: next } },
      { ...args, pageToken: first.result.nextPageToken! }).then(() => 'ok', (error: unknown) =>
        error instanceof CalendarToolFault ? error.failure.code : 'unexpected-error');
    console.log('LATENCY_CONTINUATION_PROFILE', JSON.stringify({
      firstDiscoveryRevision: target.discoveryRevision, nextDiscoveryRevision: next.discoveryRevision,
      discoveryRequests: h.discover.mock.calls.length, eventPageRequests: fetcher.mock.calls.length, outcome,
    }));
    expect(outcome).toBe('ok');
    expect(next.discoveryRevision).toBe(target.discoveryRevision);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { await h.service.close(); }
});

it('accepts and executes a Calendar follow-up inside the completed callback', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Hello');
    h.modelWires.push(textWire('Hello.'), textWire('Follow-up.'));
    let followed = false;
    await h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async () => {}, emitCalendar: async envelope => {
        if (envelope.event.type !== 'completed') return;
        expect(h.runtime.snapshot().active).toBe(0);
        const next = await h.submit('Next', ids.sessionId);
        await h.execute(next);
        followed = true;
      } });
    expect(followed).toBe(true);
    expect(h.runtime.snapshot().active).toBe(0);
  } finally { await h.dispose(); }
});

it('accepts and executes a text follow-up inside the completed callback', async () => {
  const h = textConfigFixture(textSnapshot());
  try {
    const ids = await h.submit('Hello');
    let followed = false;
    await h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async envelope => {
        if (envelope.event.type !== 'completed') return;
        expect(h.runtime.snapshot().active).toBe(0);
        await h.execute(await h.submit('Next', ids.sessionId));
        followed = true;
      } });
    expect(followed).toBe(true);
  } finally { await h.dispose(); }
});

it('releases failed text work before its error callback permits another turn', async () => {
  const h = textConfigFixture(textSnapshot());
  try {
    const ids = await h.submit('Hello');
    h.fetcher.mockRejectedValueOnce(new Error('fixture provider failure'));
    let followed = false;
    await expect(h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async envelope => {
        if (envelope.event.type !== 'error') return;
        expect(h.runtime.snapshot().active).toBe(0);
        await h.execute(await h.submit('Next', ids.sessionId));
        followed = true;
      } })).rejects.toMatchObject({ code: 'INTERRUPTED' });
    expect(followed).toBe(true);
    expect(h.runtime.snapshot().active).toBe(0);
  } finally { await h.dispose(); }
});
