/**
 * ============================================================================
 * FILE: calendar-voice-latency.spec.ts
 * LOCATION: backend/test/performance/calendar-voice-latency.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Compare Calendar dependency paths with the P1 reference and hostile visuals.
 * ROLE IN PROJECT:
 *    Uses the existing offline storage-wave probe and actual Calendar runtime.
 *    Measures dependencies, not real network latency or absolute zero CPU cost.
 * KEY COMPONENTS:
 *    - Historical comparison: Identical confirmation workload and boundaries.
 *    - Sink ablation: Same requests/durability with blocked or failed visuals.
 * ============================================================================
 */
import { afterEach, expect, it, vi } from 'vitest';
import { DependencyProbe } from './dependency-probe.js';
import { createLatencyFixture } from './latency-runtime-fixture.js';
import type { TurnMeasurement } from './latency-runtime-fixture.js';
import { createWire, textWire } from '../runtime/calendar-runtime.fixture.js';
import { callWire, loadWire } from '../assembly/skill-fixture.js';
import { event } from '../runtime/calendar-multi-fixture.js';
import { calendarLiveFixture } from '../runtime/calendar-live.fixture.js';
import { loadWire as loadWireForRuntime, skillWire as skillWireForRuntime }
  from '../runtime/calendar-runtime.fixture.js';
import type { CalendarView } from '../../src/contracts/calendar-view.js';
import type { CalendarCompatibleEnvelope } from '../../src/chat-runtime/ports.js';
import type { VoiceDeliveryRecord } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { VoiceDelivery } from '../../src/voice/agent/voice-delivery.js';
import { key } from '../../src/persistence/records.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const P1_REFERENCE = [
  { earlierTurns: 0, referenced: false, reads: 158, writes: 45, waves: 199, elapsedMs: 30523, receiptMs: 21108 },
  { earlierTurns: 0, referenced: true, reads: 155, writes: 45, waves: 196, elapsedMs: 30322, receiptMs: 20907 },
  { earlierTurns: 8, referenced: false, reads: 182, writes: 45, waves: 223, elapsedMs: 32131, receiptMs: 22716 },
  { earlierTurns: 8, referenced: true, reads: 171, writes: 45, waves: 212, elapsedMs: 31394, receiptMs: 21979 },
] as const;

it.each([0, 8])('compares P1 confirmation after %s earlier turns', async earlierTurns => {
  const measurements = [];
  for (const baseline of P1_REFERENCE.filter(row => row.earlierTurns === earlierTurns)) {
    const probe = new DependencyProbe();
    const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
    try {
      let sessionId: string | null = null;
      for (let turn = 0; turn < earlierTurns; turn++) {
        fx.calendar!.modelWires.push(textWire('Noted.'));
        const ids = await fx.run(() => fx.submit(`Note ${turn}`, sessionId));
        sessionId = ids.sessionId;
        await fx.run(() => fx.execute(ids));
      }
      fx.calendar!.modelWires.push(loadWire(['calendar_create_event'], 'confirm-load'),
        createWire(event()));
      const first = await fx.run(() => fx.submit('create the event', sessionId));
      await fx.run(() => fx.execute(first));
      const proposal = await fx.run(() => fx.calendar!.currentProposal(first.sessionId));
      if (!proposal) throw new Error('Reference workload did not create a proposal');
      let receiptMs: number | null = null;
      const push = fx.frames.push.bind(fx.frames);
      const frames = vi.spyOn(fx.frames, 'push').mockImplementation((...items) => {
        for (const item of items) {
          const frame = item as { event?: { type: string; operation?: { state: string } } };
          if (receiptMs === null && frame.event?.type === 'calendar-operation'
            && frame.event.operation?.state === 'succeeded') receiptMs = probe.elapsedMs;
        }
        return push(...items);
      });
      const measured = await fx.measure(async () => {
        const ids = await fx.submit('yes', first.sessionId, baseline.referenced ? {
          calendarReplyTo: { proposalId: proposal.proposalId, revision: proposal.revision },
        } : undefined);
        await fx.execute(ids);
        return ids;
      });
      console.log('CALENDAR_P3_CONFIRM_COMPARISON', JSON.stringify({ baseline,
        after: measured.metrics, receiptMs, modelCalls: fx.modelCalls.length,
        requestKinds: fx.calendar!.requestKinds, effects: fx.googleEffects.map(e => e.kind) }));
      expect(fx.modelCalls).toHaveLength(earlierTurns + 2);
      expect(fx.googleEffects.filter(e => e.kind === 'create')).toHaveLength(1);
      expect(fx.calendar!.modelWires).toHaveLength(0);
      expect(measured.metrics.wireWrites).toBe(baseline.writes);
      expect(measured.metrics.wireReads).toBeLessThanOrEqual(baseline.reads);
      expect(measured.metrics.waves).toBeLessThanOrEqual(baseline.waves);
      expect(measured.metrics.elapsedMs).toBeLessThanOrEqual(baseline.elapsedMs);
      expect(receiptMs).not.toBeNull();
      expect(receiptMs!).toBeLessThanOrEqual(baseline.receiptMs);
      expect(fx.rawRuntime.snapshot().active).toBe(0);
      measurements.push({ referenced: baseline.referenced, receiptMs });
    } finally { await fx.close(); }
  }
  expect(measurements).toHaveLength(2);
}, 30000);

it('profiles a real lookup with the same storage constants', async () => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
  try {
    fx.calendar!.modelWires.push(loadWire(['calendar_list_events'], 'lookup-load'),
      callWire('calendar_list_events', {
        timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20,
      }, 'lookup-call'), textWire('No events in that range.'));
    const measured = await fx.measure(async () => {
      const ids = await fx.submit('List my calendar for November 3.');
      await fx.execute(ids);
      return ids;
    });
    expect(fx.modelCalls).toHaveLength(3);
    expect(fx.googleEffects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(fx.googleEffects.filter(e => e.kind === 'create')).toHaveLength(0);
    const completed = fx.frames.find(raw => (raw as { event: { type: string } }).event.type === 'completed');
    expect(completed).toBeDefined();
    const view = (completed as unknown as { event: { calendarView?: { kind: string } } }).event.calendarView;
    expect(view).toMatchObject({ kind: 'agenda' });
    expect(Buffer.byteLength(JSON.stringify(view), 'utf8')).toBeLessThanOrEqual(14336);
    console.log('CALENDAR_P3_LOOKUP_PROFILE', JSON.stringify({ metrics: measured.metrics,
      modelCalls: fx.modelCalls.length, requestKinds: fx.calendar!.requestKinds,
      effects: fx.googleEffects.map(e => e.kind), frameCount: fx.frames.length }));
    expect(fx.rawRuntime.snapshot().active).toBe(0);
  } finally { await fx.close(); }
}, 30000);

const SINK_BEHAVIORS = (['record', 'throws', 'pending', 'rejected'] as const);
const SINK_CASES = (['memory', 'durable'] as const).flatMap(mode =>
  SINK_BEHAVIORS.map(behavior => ({ mode, behavior })));

it.each(SINK_CASES)('$mode completes lookup while the visual sink is $behavior', async ({ mode, behavior }) => {
  const f = await calendarLiveFixture(mode);
  let resolve!: () => void;
  const pending = new Promise<void>(r => { resolve = r; });
  const visual = vi.fn((_frame: CalendarCompatibleEnvelope): Promise<void> => {
    if (behavior === 'throws') throw new Error('offline visual failure');
    if (behavior === 'pending') return pending;
    if (behavior === 'rejected') {
      const rejected = Promise.reject<void>(new Error('offline async visual failure'));
      void rejected.catch(() => {});
      return rejected;
    }
    return Promise.resolve();
  });
  try {
    f.h.modelWires.push(loadWireForRuntime('calendar_list_events'),
      skillWireForRuntime('call_tool', { plugin: 'google-calendar', tool: 'calendar_list_events',
        arguments: { timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z',
          maxResults: 20 } }, 'sink-list'), textWire('No events in that range.'));
    const ids = await f.submit('List my calendar for November 3.');
    await f.execute(ids, visual);
    expect(visual).toHaveBeenCalled();
    expect(f.spoken.join('')).toBe('No events in that range.');
    expect(f.finish).toHaveBeenCalledTimes(1);
    expect(f.h.modelBodies).toHaveLength(3);
    expect(f.h.effects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(f.h.runtime.snapshot().active).toBe(0);
  } finally { resolve(); await f.dispose(); }
}, 1500);

type SinkBehavior = typeof SINK_BEHAVIORS[number];
type SinkMeasurement = {
  metrics: TurnMeasurement; modelCalls: number; requestKinds: string[];
  providerRequests: { method: string; path: string }[];
  firstSpeechMs: number | null; outcome: CalendarView | null;
};
async function measureVoiceSink(behavior: SinkBehavior): Promise<SinkMeasurement> {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
  const sessionId = 'voice-calendar-probe', voiceSessionId = 'voice-calendar-probe-session';
  const providerRequests: SinkMeasurement['providerRequests'] = [];
  const fetch = fx.fetcher.getMockImplementation()!;
  fx.fetcher.mockImplementation((url, init) => {
    const parsed = new URL(String(url));
    providerRequests.push({ method: String(init?.method ?? 'GET').toUpperCase(),
      path: parsed.pathname.replace(/(\/events\/)[^/]+$/, '$1fixture-event') });
    return fetch(url, init);
  });
  let resolveVisual!: () => void;
  const pending = new Promise<void>(resolve => { resolveVisual = resolve; });
  let latest!: VoiceDeliveryRecord, delivery!: VoiceDelivery;
  let firstSpeechMs: number | null = null, spoken = '';
  const flush = vi.fn(async () => undefined);
  const visual = vi.fn((_frame: CalendarCompatibleEnvelope): Promise<void> => {
    if (behavior === 'throws') throw new Error('offline visual failure');
    if (behavior === 'pending') return pending;
    if (behavior === 'rejected') {
      const rejected = Promise.reject<void>(new Error('offline async visual failure'));
      void rejected.catch(() => {});
      return rejected;
    }
    return Promise.resolve();
  });
  const reservation = await fx.run(() => fx.rawRuntime.reservations.acquire({ identity: fx.identity,
    conversationId: sessionId, owner: { kind: 'live', voiceSessionId } }));
  try {
    fx.calendar!.modelWires.push(loadWire(['calendar_list_events'], 'voice-lookup-load'),
      callWire('calendar_list_events', { timeMin: '2026-11-03T00:00:00Z',
        timeMax: '2026-11-04T00:00:00Z', maxResults: 20 }, 'voice-lookup-call'),
      textWire('No events in that range.'));
    const measured = await fx.measure(async () => {
      const ids = await fx.rawRuntime.submitLiveTurn({ identity: fx.identity, sessionId,
        content: 'List my calendar for November 3.', idempotencyKey: 'voice-calendar-probe-input',
        reservation, configSnapshot: fx.calendar!.currentConfig.current()!,
        voice: { voiceSessionId, socketEpoch: 1, providerTurnId: 'voice-calendar-probe-stt' } });
      await fx.runtime.executeTurn({ userId: fx.identity.userId, ...ids,
        signal: new AbortController().signal, emit: async () => undefined, emitCalendar: visual,
        live: {
          reservation,
          start: async (attempt, write) => {
            const seed: VoiceDeliveryRecord = { ...deliveryFixture(), userId: attempt.userId,
              sessionId: attempt.sessionId, turnId: attempt.turnId, attemptId: attempt.attemptId,
              voiceSessionId, responseId: key('voice-response', attempt.userId, attempt.sessionId, attempt.attemptId),
              status: 'pending', textGenerated: '', textSpoken: null, textRemaining: null,
              audioDurationMs: null, audioPlayedMs: null, playedSamples: null,
              createdAt: attempt.createdAt, updatedAt: attempt.createdAt };
            delivery = new VoiceDelivery(seed, 0, async (record, sequence) => {
              await write(record, sequence); latest = structuredClone(record);
            }, { flush, speak: async command => {
              if (firstSpeechMs === null) firstSpeechMs = probe.elapsedMs;
              spoken += command.text;
            } }, 2000);
            await delivery.start();
          },
          delta: text => delivery.delta(text), finish: () => delivery.finish(),
          settle: async text => {
            await delivery.event({ type: 'speech-completed', turnId: latest.turnId,
              responseId: latest.responseId, speechId: 'voice-calendar-probe-tts',
              audioDurationMs: 100, audioSamples: 2400, usage: { providerRequestId: null,
                model: 'fixture', modelVersion: null, audioMs: 100, billableCharacters: text.length } });
            await delivery.playback(2400);
            await delivery.settle(text);
          },
        },
      });
      return ids;
    });
    expect(visual).toHaveBeenCalled();
    expect(spoken).toBe('No events in that range.');
    expect(firstSpeechMs).not.toBeNull();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(fx.modelCalls).toHaveLength(3);
    expect(fx.googleEffects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(fx.rawRuntime.snapshot().active).toBe(0);
    const history = await fx.run(() => fx.persistence.messages.list(fx.identity.userId,
      measured.result.sessionId, { cursor: null, limit: 20 }));
    const outcome = history.items.find(m => m.role === 'assistant'
      && m.turnId === measured.result.turnId)?.calendarView ?? null;
    expect(outcome).toMatchObject({ kind: 'agenda', entries: [] });
    return { metrics: measured.metrics, modelCalls: fx.modelCalls.length,
      requestKinds: [...fx.calendar!.requestKinds], providerRequests,
      firstSpeechMs, outcome };
  } finally {
    resolveVisual();
    await fx.run(() => fx.rawRuntime.reservations.release({ identity: fx.identity,
      reservationId: reservation.reservationId }));
    await fx.close();
  }
}

it.each(['throws', 'pending', 'rejected'] as const)('preserves probe dependencies with %s visuals', async behavior => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-11-11T10:00:00Z');
  const recorded = await measureVoiceSink('record');
  const hostile = await measureVoiceSink(behavior);
  expect(hostile.modelCalls).toBe(recorded.modelCalls);
  expect(hostile.requestKinds).toEqual(recorded.requestKinds);
  expect(hostile.providerRequests).toEqual(recorded.providerRequests);
  expect(hostile.metrics.logicalReads).toBe(recorded.metrics.logicalReads);
  expect(hostile.metrics.logicalWrites).toBe(recorded.metrics.logicalWrites);
  expect(hostile.metrics.wireReads).toBe(recorded.metrics.wireReads);
  expect(hostile.metrics.wireWrites).toBe(recorded.metrics.wireWrites);
  expect(hostile.metrics.wireCommands).toEqual(recorded.metrics.wireCommands);
  expect(hostile.metrics.waves).toBe(recorded.metrics.waves);
  expect(hostile.metrics.elapsedMs).toBe(recorded.metrics.elapsedMs);
  expect(hostile.firstSpeechMs).toBe(recorded.firstSpeechMs);
  expect(hostile.outcome).toEqual(recorded.outcome);
  console.log('CALENDAR_P3_SINK_ABLATION', JSON.stringify({ behavior, recorded, hostile }));
}, 5000);
