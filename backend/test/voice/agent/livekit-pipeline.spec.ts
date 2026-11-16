/**
 * ============================================================================
 * FILE: livekit-pipeline.spec.ts
 * LOCATION: backend/test/voice/agent/livekit-pipeline.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Offline acceptance checks for the assembled LiveKit voice pipeline.
 *
 * ROLE IN PROJECT:
 *    Proves one accepted-turn owner, generated-versus-heard settlement, honest
 *    disconnect evidence and unchanged provider attribution through real flows.
 *
 * KEY COMPONENTS:
 *    - Delivery completion and watermark tests.
 *    - Disconnect/interrupt honesty tests.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
// Import the pipeline fixture first so the RTC SDK mock is registered.
import { pipeline, usage } from './livekit-pipeline-fixture.js';
import { settle } from '../transport/fixtures.js';

afterEach(() => vi.useRealTimers());

it('one EndOfTurn has one acceptance/inference owner and capture does not complete durable speech', async () => {
  vi.useFakeTimers();
  const f = await pipeline();
  try {
    const ref = await f.begin();
    f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    f.tts.events.push({
      type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage,
    });
    await f.until(() => f.events().some(event => event.type === 'audio.watermark' && event.final));
    expect(f.source.captureFrame).toHaveBeenCalledTimes(1);
    expect(f.records.get('a1')?.status).toBe('pending');
    expect(f.runtime.submitLiveTurn).toHaveBeenCalledTimes(1);
    expect(f.runtime.executeTurn).toHaveBeenCalledTimes(1);
    expect(f.events()).toContainEqual(expect.objectContaining({
      type: 'audio.watermark', ...ref,
      firstAudioSample: 0, queuedSamples: 2400, lastAudioSample: 2400, final: true,
    }));
    await f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 });
    await f.until(() => f.records.get('a1')?.status === 'completed');
    expect(f.records.get('a1')).toMatchObject({
      playedSamples: 2400,
      audioSamples: 2400,
      textGenerated: 'Hello world.',
      textSpoken: 'Hello world.',
    });
    expect(f.usage).toHaveBeenCalledTimes(1);
    expect(f.usage).toHaveBeenCalledWith(f.context, expect.objectContaining({
      audioMs: 100, billableCharacters: 12,
    }));
  } finally {
    await f.close();
  }
});

it('keeps an unproven final watermark out of durable playback and settles delivery as unknown', async () => {
  vi.useFakeTimers();
  const f = await pipeline();
  try {
    const ref = await f.begin();
    f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    f.tts.events.push({
      type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage,
    });
    await f.until(() => f.events().some(event => event.type === 'audio.watermark' && event.final));

    await f.control({
      type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100, proof: 'unproven',
    });
    await settle();
    expect(f.records.get('a1')).toMatchObject({ status: 'pending', playedSamples: null });
    expect(f.events().some(event => event.type === 'audio.end')).toBe(false);

    await vi.advanceTimersByTimeAsync(30_001);
    await f.until(() => f.records.get('a1')?.status === 'unknown');
    expect(f.records.get('a1')).toMatchObject({
      status: 'unknown', playedSamples: null, textSpoken: null, textRemaining: null,
    });
    expect(f.runtime.executeTurn).toHaveBeenCalledTimes(1);
  } finally {
    await f.close();
  }
});

it('keeps disconnect unknown without inventing heard text and drains late provider usage', async () => {
  vi.useFakeTimers();
  const f = await pipeline();
  try {
    const ref = await f.begin();
    f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    await settle();
    const closing = f.close();
    await vi.advanceTimersByTimeAsync(2500);
    await closing;
    expect(f.records.get('a1')).toMatchObject({ status: 'unknown', textSpoken: null });
    expect(f.runtime.cancelLiveTurn).not.toHaveBeenCalled();
    expect(f.runtime.reconcileSession).toHaveBeenCalled();
    expect(f.source.clearQueue).toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it('cancels once with the trusted identity and settles interrupted only from a valid split', async () => {
  vi.useFakeTimers();
  const f = await pipeline();
  try {
    const ref = await f.begin();
    f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    await f.until(() => f.events().some(event => event.type === 'audio.watermark' && !event.final));
    const order: string[] = [];
    f.source.clearQueue.mockImplementation(() => { order.push('clear'); });
    vi.mocked(f.runtime.cancelLiveTurn!).mockImplementationOnce(async () => {
      order.push('cancel');
      expect(order[0]).toBe('clear');
    });
    await f.control({ type: 'playback.progress', ...ref, playedSamples: 1200, playedMs: 50 });
    await f.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 });
    await f.until(() => vi.mocked(f.runtime.cancelLiveTurn!).mock.calls.length === 1);
    expect(f.runtime.cancelLiveTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: f.context.identity, turnId: ref.turnId, attemptId: 'a1',
      }),
      f.context.reservation,
    );
    expect(f.tts.connection.interrupt).toHaveBeenCalledWith(expect.objectContaining({
      playbackPositionMs: 50,
    }));
    f.tts.events.push({
      type: 'speech-interrupted', ...ref, speechId: 'speech-1', audioPlayedMs: 50,
      textSpoken: 'Hello', textRemaining: ' world.', usage,
    });
    await f.until(() => f.records.get('a1')?.status === 'interrupted');
    expect(f.records.get('a1')).toMatchObject({
      status: 'interrupted', textSpoken: 'Hello', textRemaining: ' world.', playedSamples: 1200,
    });
    const captured = vi.mocked(f.source.captureFrame).mock.calls.length;
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    await settle();
    expect(f.source.captureFrame).toHaveBeenCalledTimes(captured);
    await f.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 });
    expect(f.runtime.cancelLiveTurn).toHaveBeenCalledTimes(1);
  } finally {
    await f.close();
  }
});

it('passes provider usage once with the unchanged trusted identity', async () => {
  const f = await pipeline();
  try {
    f.stt.events.push({
      type: 'usage',
      usage: {
        providerRequestId: 'request-1', model: 'flux-general-en', modelVersion: null,
        audioMs: 1000, billableCharacters: null,
      },
    });
    await settle();
    expect(f.usage).toHaveBeenCalledTimes(1);
    expect(f.usage).toHaveBeenCalledWith(f.context, expect.objectContaining({
      providerRequestId: 'request-1', model: 'flux-general-en', audioMs: 1000,
    }));
    expect(f.context.identity).toMatchObject({
      userId: 'aurvin-dev-user', source: 'authenticated-session',
    });
    expect(f.context.response.sessionId).toBe(f.response.sessionId);
  } finally {
    await f.close();
  }
});
