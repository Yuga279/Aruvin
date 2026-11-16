/**
 * ============================================================================
 * FILE: voice-delivery.spec.ts
 * LOCATION: backend/test/voice/agent/voice-delivery.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for VoiceDelivery lease-bound generated-versus-heard tracker.
 *
 * ROLE IN PROJECT:
 *    Verifies monotonic sample tracking, generated/played text separation,
 *    barge-in interruption evidence settlement, and timeout fallback to unknown.
 *
 * KEY COMPONENTS:
 *    - VoiceDelivery: Delivery record tracker and settlement engine.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { VoiceDelivery } from '../../../src/voice/agent/voice-delivery.js';
import { deliveryFixture } from '../../../src/contracts/testing/voice-fixtures.js';
import type { VoiceDeliveryRecord } from '../../../src/contracts/voice.js';
import type { DeliveryWrite } from '../../../src/chat-runtime/ports.js';
import type { CanvasArtifactProjection } from '../../../src/contracts/voice-wire.js';

afterEach(() => vi.useRealTimers());

const usage = { providerRequestId: null, model: 'fixture', modelVersion: null, audioMs: 100, billableCharacters: 12 };
const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(baseSamples = 0) {
  const seed = { ...deliveryFixture(), status: 'pending' as const, textGenerated: '', textSpoken: null,
    textRemaining: null, audioDurationMs: null, audioPlayedMs: null, playedSamples: null };
  const writes: VoiceDeliveryRecord[] = [];
  const write: DeliveryWrite = vi.fn(async (record, expected) => {
    if (expected !== undefined) expect(expected).toBe(writes.at(-1)?.sequence);
    writes.push(structuredClone(record));
  });
  const speak = vi.fn(async (_command: { turnId: string; responseId: string; text: string }) => undefined);
  const flush = vi.fn(async (_ref: { turnId: string; responseId: string }) => undefined);
  return { seed, writes, write, speak, flush, delivery: new VoiceDelivery(seed, baseSamples, write, { speak, flush }, 2000) };
}

it('persists prose before Speak and waits for played samples, not synthesis completion', async () => {
  const f = fixture(2400);
  await f.delivery.start();
  await f.delivery.delta('Hello world.');
  await f.delivery.finish();
  expect(f.writes.at(-1)?.textGenerated).toBe('Hello world.');
  await f.delivery.event({ type: 'speech-completed', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-1', audioDurationMs: 100, usage });
  expect(f.writes.at(-1)?.status).toBe('pending');
  await f.delivery.playback(3600);
  expect(f.writes.at(-1)?.playedSamples).toBe(1200);
  await f.delivery.playback(4800);
  await f.delivery.settle('Hello world.');
  expect(f.writes.at(-1)).toMatchObject({ status: 'completed', textSpoken: 'Hello world.', textRemaining: '',
    audioPlayedMs: 100, audioDurationMs: 100, playedSamples: 2400 });
});

it('accepts interrupted evidence before generation settles and freezes the final generated prefix', async () => {
  const f = fixture(2400);
  await f.delivery.start();
  await f.delivery.delta('Hello world.');
  await microtasks();
  f.delivery.invalidate();
  await f.delivery.event({ type: 'speech-interrupted', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-1', audioPlayedMs: 50, textSpoken: 'Hello', textRemaining: ' world.', usage });
  expect(f.writes.at(-1)?.status).toBe('pending');
  await f.delivery.delta(' Late tokens.');
  expect(f.speak).toHaveBeenCalledTimes(1);
  await f.delivery.settle('Hello world. Unsent prefix.');
  expect(f.writes.at(-1)).toMatchObject({ status: 'interrupted', textGenerated: 'Hello world. Unsent prefix.',
    textSpoken: 'Hello', textRemaining: ' world. Unsent prefix.', audioPlayedMs: 50 });
});

it('rejects regressing playback and wrong-response callbacks without corrupting evidence', async () => {
  const f = fixture();
  await f.delivery.start();
  await f.delivery.delta('Hello.');
  await f.delivery.playback(1200);
  await expect(f.delivery.playback(1199)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.delivery.event({ type: 'speech-started', turnId: f.seed.turnId, responseId: 'wrong', speechId: 'speech-1' }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.writes.at(-1)?.playedSamples).toBe(1200);
});

it('times out to unknown instead of inventing a spoken substring or replaying audio', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.delivery.start();
  await f.delivery.delta('Hello world.');
  await microtasks();
  f.delivery.invalidate();
  const done = f.delivery.settle('Hello world.');
  await vi.advanceTimersByTimeAsync(2000);
  await done;
  expect(f.writes.at(-1)).toMatchObject({ status: 'unknown', textSpoken: null, textRemaining: null });
  expect(f.speak).toHaveBeenCalledTimes(1);
});

it('cannot treat malformed provider split text or submillisecond short playback as complete', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.delivery.start();
  await f.delivery.delta('Hello world.');
  await f.delivery.event({ type: 'speech-completed', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-1', audioDurationMs: 100, usage });
  await f.delivery.playback(2399);
  const done = f.delivery.settle('Hello world.');
  await vi.advanceTimersByTimeAsync(2000);
  await done;
  expect(f.writes.at(-1)?.status).toBe('unknown');
  const g = fixture();
  await g.delivery.start();
  await g.delivery.delta('Hello world.');
  await microtasks();
  g.delivery.invalidate();
  await g.delivery.event({ type: 'speech-interrupted', turnId: g.seed.turnId, responseId: g.seed.responseId,
    speechId: 'speech-1', audioPlayedMs: 50, textSpoken: 'Different', textRemaining: ' world.', usage });
  await g.delivery.settle('Hello world.');
  expect(g.writes.at(-1)?.status).toBe('unknown');
});

it('allows active speech beyond terminal cleanup while progress advances, then persists exact PCM proof', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const delivery = new VoiceDelivery(f.seed, 0, f.write, f, 2000, { activeMs: 20000, stallMs: 5000 });
  await delivery.start(); await delivery.delta('Long answer.');
  const done = delivery.settle('Long answer.');
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.writes.at(-1)?.status).toBe('pending');
  await delivery.playback(25);
  await vi.advanceTimersByTimeAsync(3000);
  await delivery.event({ type: 'speech-completed', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-1', audioDurationMs: 2, audioSamples: 50, usage });
  await delivery.playback(50); await done;
  expect(f.writes.at(-1)).toMatchObject({ status: 'completed', playedSamples: 50 });
});

it('recovers the evidence queue after a rejected action without blessing invalid playback', async () => {
  const f = fixture();
  await f.delivery.start(); await f.delivery.delta('Hello.');
  await f.delivery.playback(1200);
  await expect(f.delivery.playback(1199)).rejects.toBeDefined();
  await f.delivery.event({ type: 'speech-completed', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-1', audioDurationMs: 100, usage });
  await f.delivery.playback(2400); await f.delivery.settle('Hello.');
  expect(f.writes.at(-1)?.status).toBe('completed');
});

it('coalesces progress during a slow evidence write and drains the final authoritative cursor', async () => {
  const f = fixture(); let release!: () => void;
  await f.delivery.start(); await f.delivery.delta('Hello.');
  await f.delivery.finish();
  vi.mocked(f.write).mockImplementationOnce(async record => {
    await new Promise<void>(resolve => { release = resolve; }); f.writes.push(structuredClone(record));
  });
  f.delivery.observePlayback(1); await Promise.resolve();
  for (let i = 2; i <= 2400; i++) f.delivery.observePlayback(i);
  expect(f.writes.at(-1)?.playedSamples).toBeNull();
  release();
  await f.delivery.event({ type: 'speech-completed', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-1', audioDurationMs: 100, audioSamples: 2400, usage });
  await f.delivery.settle('Hello.');
  expect(f.writes.filter(r => r.playedSamples !== null && r.status === 'pending')).toHaveLength(3);
  expect(f.writes.at(-1)).toMatchObject({ status: 'completed', playedSamples: 2400 });
});

it('bounds stalled speech and cancellation independently of the active speech budget', async () => {
  vi.useFakeTimers();
  for (const cancelled of [false, true]) {
    const f = fixture(), abort = new AbortController();
    const delivery = new VoiceDelivery(f.seed, 0, f.write, f, 2000, { activeMs: 20000, stallMs: 5000 });
    await delivery.start(); await delivery.delta('Hello.');
    await microtasks();
    const done = delivery.settle('Hello.', abort.signal);
    if (cancelled) abort.abort();
    await vi.advanceTimersByTimeAsync(cancelled ? 2000 : 5000); await done;
    expect(f.writes.at(-1)?.status).toBe('unknown');
  }
});

it('starts the speech stall allowance at actual Speak, not at the beginning of model thinking', async () => {
  vi.useFakeTimers(); const f = fixture();
  const delivery = new VoiceDelivery(f.seed, 0, f.write, f, 2000, { activeMs: 60000, stallMs: 5000 });
  await delivery.start(); await vi.advanceTimersByTimeAsync(10000);
  await delivery.delta('Hello.'); await microtasks(); const done = delivery.settle('Hello.');
  await vi.advanceTimersByTimeAsync(1000); expect(f.writes.at(-1)?.status).toBe('pending');
  await delivery.event({ type: 'speech-completed', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-1', audioDurationMs: 100, usage });
  await delivery.playback(2400); await done;
  expect(f.writes.at(-1)?.status).toBe('completed');
});

it('does not claim generated text was heard when synthesis produced zero PCM', async () => {
  const f = fixture(); await f.delivery.start(); await f.delivery.delta('Hello.');
  await f.delivery.event({ type: 'speech-completed', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-1', audioDurationMs: 0, audioSamples: 0, usage });
  await f.delivery.settle('Hello.');
  expect(f.writes.at(-1)).toMatchObject({ status: 'failed', textSpoken: null });
});

it('dispatches Speak immediately while coalescing later journal writes for 100ms', async () => {
  vi.useFakeTimers();
  const f = fixture(), spoken: string[] = [];
  f.speak.mockImplementation(async command => {
    spoken.push(command.text);
  });
  await f.delivery.start();
  await f.delivery.delta('First safe clause.'); await microtasks();
  expect(spoken.join('')).toBe('First safe clause.');
  expect(f.writes).toHaveLength(2); // Initial record, immediate first batch.
  for (const text of [' Next', ' safe', ' clause.']) await f.delivery.delta(text);
  expect(spoken.join('')).toBe('First safe clause. Next safe clause.');
  await vi.advanceTimersByTimeAsync(99);
  expect(f.writes).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.writes).toHaveLength(3);
  expect(f.writes.at(-1)?.textGenerated).toBe('First safe clause. Next safe clause.');
  expect(f.flush).not.toHaveBeenCalled();
  await f.delivery.finish();
  expect(f.flush).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('dispatches Speak without blocking on a slow in-flight journal write and drains at finish', async () => {
  vi.useFakeTimers();
  const f = fixture(), blocked = deferred(), entered = deferred();
  await f.delivery.start();
  vi.mocked(f.write).mockImplementationOnce(async record => {
    entered.resolve(); await blocked.promise; f.writes.push(structuredClone(record));
  });
  await f.delivery.delta('A'.repeat(24)); await entered.promise;
  await f.delivery.delta('B'.repeat(487));
  await f.delivery.delta('CD');
  expect(f.speak.mock.calls.map(([c]) => c.text).join(''))
    .toBe('A'.repeat(24) + 'B'.repeat(487) + 'CD');
  expect(f.writes.at(-1)?.textGenerated).toBe('');
  blocked.resolve(); await vi.advanceTimersByTimeAsync(100); await f.delivery.finish();
  expect(f.writes.at(-1)?.textGenerated.length).toBe(513);
  expect(f.flush).toHaveBeenCalledTimes(1);
});

it('requests a full 512-character batch without waiting for its 100ms timer', async () => {
  vi.useFakeTimers(); const f = fixture();
  await f.delivery.start(); await f.delivery.delta('First.'); await microtasks();
  const before = f.writes.length, at = Date.now();
  await f.delivery.delta('x'.repeat(512));
  expect(Date.now()).toBe(at);
  expect(f.writes).toHaveLength(before + 1);
  expect(f.speak.mock.calls.map(([c]) => c.text).join('')).toBe('First.' + 'x'.repeat(512));
  await f.delivery.finish();
});

it('does not turn sustained tiny tokens into a per-token evidence write storm', async () => {
  vi.useFakeTimers(); const f = fixture();
  await f.delivery.start(); await f.delivery.delta('First.'); await microtasks();
  for (let i = 0; i < 20; i++) {
    await f.delivery.delta(' x');
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(f.writes).toHaveLength(4); // Seed, first batch, 100ms batch, 200ms batch.
  await f.delivery.finish();
  expect(f.speak.mock.calls.map(([c]) => c.text).join('')).toBe('First.' + ' x'.repeat(20));
});

it('keeps recording generated text when Speak fails mid-answer', async () => {
  const f = fixture();
  let calls = 0;
  f.speak.mockImplementation(async () => {
    calls += 1;
    if (calls > 1) throw new Error('VOICE_DELIVERY_UNKNOWN');
  });
  await f.delivery.start();
  await f.delivery.delta('First clause. ');
  await microtasks();
  await f.delivery.delta('Second clause must be saved.');
  await microtasks();
  await f.delivery.finish();
  expect(f.writes.at(-1)?.textGenerated).toBe('First clause. Second clause must be saved.');
});

it('keeps speaking unsent text after unknown interrupt evidence', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.delivery.start();
  await f.delivery.delta('First clause. ');
  await microtasks();
  await f.delivery.event({ type: 'speech-interrupted', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-1', audioPlayedMs: null, textSpoken: null, textRemaining: null, usage });
  await f.delivery.event({ type: 'speech-started', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-2' });
  await f.delivery.delta('Second clause.');
  await vi.advanceTimersByTimeAsync(100);
  await f.delivery.finish();
  expect(f.writes.at(-1)?.textGenerated).toBe('First clause. Second clause.');
  expect(f.speak.mock.calls.map(([command]) => command.text)).toEqual([
    'First clause. ',
    'Second clause.',
  ]);
  expect(f.flush).toHaveBeenCalledTimes(1);
});

it('speaks only the unsent suffix if Speak starts succeeding after a mid-answer failure', async () => {
  vi.useFakeTimers();
  const f = fixture();
  let failNext = false;
  f.speak.mockImplementation(async () => {
    if (failNext) throw new Error('VOICE_DELIVERY_UNKNOWN');
  });
  await f.delivery.start();
  await f.delivery.delta('First clause. ');
  await microtasks();
  failNext = true;
  await f.delivery.delta('Second clause. ');
  await vi.advanceTimersByTimeAsync(100);
  failNext = false;
  await f.delivery.delta('Third clause.');
  await vi.advanceTimersByTimeAsync(100);
  await f.delivery.finish();
  expect(f.writes.at(-1)?.textGenerated).toBe('First clause. Second clause. Third clause.');
  expect(f.speak.mock.calls.map(([command]) => command.text)).toEqual([
    'First clause. ',
    'Second clause. ',
    'Second clause. Third clause.',
  ]);
  expect(f.flush).toHaveBeenCalledTimes(1);
});

it('drains the last clause before one final Flush even when finish is repeated', async () => {
  vi.useFakeTimers(); const f = fixture();
  await f.delivery.start(); await f.delivery.delta('First.'); await microtasks();
  await f.delivery.delta(' Last clause.');
  f.flush.mockImplementation(async () => {
    expect(f.writes.at(-1)?.textGenerated).toBe('First. Last clause.');
    expect(f.speak.mock.calls.map(([c]) => c.text).join('')).toBe('First. Last clause.');
  });
  await Promise.all([f.delivery.finish(), f.delivery.finish()]);
  expect(f.flush).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('persists a cancelled dirty suffix without flushing old speech and fences post-invalidate deltas', async () => {
  vi.useFakeTimers(); const f = fixture();
  await f.delivery.start(); await f.delivery.delta('Hello world.'); await microtasks();
  await f.delivery.delta(' Unheard dirty suffix.');
  f.delivery.invalidate();
  await f.delivery.delta(' Ignored after invalidate.');
  await f.delivery.event({ type: 'speech-interrupted', turnId: f.seed.turnId,
    responseId: f.seed.responseId, speechId: 'speech-1', audioPlayedMs: 50,
    textSpoken: 'Hello', textRemaining: ' world. Unheard dirty suffix.', usage });
  await f.delivery.finish(); await f.delivery.settle('Hello world. Unheard dirty suffix.');
  expect(f.speak.mock.calls.map(([c]) => c.text).join('')).toBe('Hello world. Unheard dirty suffix.');
  expect(f.flush).not.toHaveBeenCalled();
  expect(f.writes.at(-1)).toMatchObject({ status: 'interrupted', textSpoken: 'Hello',
    textRemaining: ' world. Unheard dirty suffix.' });
  expect(vi.getTimerCount()).toBe(0);
});

it('fences every later Speak after a timer-driven evidence failure and exposes the failure at settle', async () => {
  vi.useFakeTimers(); const f = fixture(), failure = new Error('fixture evidence failure');
  await f.delivery.start(); await f.delivery.delta('First.'); await microtasks();
  vi.mocked(f.write).mockRejectedValueOnce(failure);
  await f.delivery.delta(' Unsaved.');
  await vi.advanceTimersByTimeAsync(100);
  await expect(f.delivery.delta(' Never speak.')).rejects.toBe(failure);
  await expect(f.delivery.finish()).rejects.toBe(failure);
  await expect(f.delivery.settle('First. Unsaved.')).rejects.toBe(failure);
  expect(f.speak.mock.calls.map(([c]) => c.text).join('')).toBe('First. Unsaved.');
  expect(f.flush).not.toHaveBeenCalled();
  expect(f.writes.at(-1)?.status).toBe('pending'); // Reconciliation must not see false completion.
  expect(vi.getTimerCount()).toBe(0);
});

it('does not synthesize twice when settle follows a drained Unicode batch', async () => {
  const f = fixture(), text = 'x'.repeat(511) + '🌍 tail';
  await f.delivery.start(); await f.delivery.delta(text); await f.delivery.finish();
  await f.delivery.event({ type: 'speech-completed', turnId: f.seed.turnId,
    responseId: f.seed.responseId, speechId: 'speech-1', audioDurationMs: 100,
    audioSamples: 2400, usage });
  await f.delivery.playback(2400); await f.delivery.settle(text);
  expect(f.speak.mock.calls.map(([c]) => c.text).join('')).toBe(text);
  expect(f.speak.mock.calls.every(([c]) => !/[\uD800-\uDBFF]$/u.test(c.text))).toBe(true);
  expect(f.writes.at(-1)).toMatchObject({ status: 'completed', textSpoken: text });
  expect(f.flush).toHaveBeenCalledTimes(1);
});

it('journals artifacts without mixing generated or heard speech and keeps them after invalidate', async () => {
  const f = fixture();
  const artifact: CanvasArtifactProjection = {
    responseId: f.seed.responseId,
    ordinal: 0,
    kind: 'mermaid',
    subType: 'Flowchart',
    title: 'Approval path',
    rawSource: 'flowchart TD\nA --> B',
  };
  await f.delivery.start();
  await f.delivery.delta('Clean explanation.');
  expect(await f.delivery.artifact(artifact)).toBe(true);
  const count = f.writes.length;
  expect(await f.delivery.artifact(artifact)).toBe(true);
  expect(f.writes).toHaveLength(count);
  f.delivery.invalidate();
  expect(await f.delivery.artifact({ ...artifact, ordinal: 1 })).toBe(false);
  await f.delivery.settle('Clean explanation.', AbortSignal.abort());
  expect(f.writes.at(-1)?.canvasArtifacts).toEqual([artifact]);
  expect(f.writes.at(-1)?.textGenerated).toBe('Clean explanation.');
  expect(f.speak.mock.calls.map(([command]) => command.text).join('')).not.toContain('flowchart');
});

it('rejects wrong response, conflicting ordinal, and invalid artifacts', async () => {
  const f = fixture();
  const artifact: CanvasArtifactProjection = {
    responseId: f.seed.responseId,
    ordinal: 0,
    kind: 'mermaid',
    subType: 'Flowchart',
    title: 'Approval path',
    rawSource: 'flowchart TD\nA --> B',
  };
  await f.delivery.start();
  await expect(f.delivery.artifact({ ...artifact, responseId: 'wrong-res' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(await f.delivery.artifact(artifact)).toBe(true);
  await expect(f.delivery.artifact({ ...artifact, title: 'Conflicting title' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('allows artifacts after speech finish and preserves durability across blocked invalidate', async () => {
  const f = fixture();
  const artifact: CanvasArtifactProjection = {
    responseId: f.seed.responseId,
    ordinal: 0,
    kind: 'mermaid',
    subType: 'Flowchart',
    title: 'Approval path',
    rawSource: 'flowchart TD\nA --> B',
  };
  await f.delivery.start();
  await f.delivery.delta('Intro.');
  await f.delivery.finish(); // Speech finish alone allows artifacts!

  const gate = deferred();
  let writeCalled = false;
  vi.mocked(f.write).mockImplementation(async (rec, exp) => {
    if (exp !== undefined) expect(exp).toBe(f.writes.at(-1)?.sequence);
    f.writes.push(structuredClone(rec));
    if (rec.canvasArtifacts?.length) {
      writeCalled = true;
      await gate.promise;
    }
  });

  const artifactPromise = f.delivery.artifact(artifact);
  await microtasks();
  expect(writeCalled).toBe(true);

  // Invalidate while artifact CAS write is in-flight
  f.delivery.invalidate();
  gate.resolve();

  expect(await artifactPromise).toBe(true);
  expect(f.writes.at(-1)?.canvasArtifacts).toEqual([artifact]);
});
