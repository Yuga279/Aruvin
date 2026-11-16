/**
 * ============================================================================
 * FILE: investigation.spec.ts
 * LOCATION: backend/test/voice/investigation.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Guard idle and interruption behavior without provider calls.
 * ROLE IN PROJECT:
 *    Positive regressions using the real live flow and policy clock.
 * KEY COMPONENTS:
 *    - Real LiveFlow with in-memory STT/TTS and deterministic usage clocks.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { LiveFlow } from '../../src/voice/session/live-flow.js';
import { fakeStt, fakeTts } from './session/fixtures.js';
import { context, harness } from './usage/fixtures.js';
import { settle } from './transport/fixtures.js';
import type { VoiceSink } from '../../src/voice/session/voice-session.options.js';

async function fixture() {
  const h = harness();
  const c = context(h.config);
  c.reservation = { reservationId: 'offline', userId: c.identity.userId, conversationId: null,
    owner: { kind: 'live', voiceSessionId: c.response.sessionId } };
  const admission = await h.service.admission(c);
  const stt = fakeStt(), tts = fakeTts();
  const hooks = { finalized: vi.fn(async () => {}), delivery: vi.fn(async () => {}),
    playback: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), disconnected: vi.fn(async () => {}) };
  const sink: VoiceSink = { outputSamples: () => 0, event: vi.fn(), audio: vi.fn(), invalidate: vi.fn(), finish: vi.fn() };
  const flow = await LiveFlow.open(c, sink, new AbortController().signal, { stt: stt.port, tts: tts.port,
    hooks, activity: (ctx, busy) => h.service.noteActivity(ctx.response.sessionId, busy),
    usage: (ctx, usage) => h.service.usage(ctx, usage) });
  flow.start();
  return { h, flow, sink, hooks, stt, tts, close: async () => { await flow.close(); await admission.release(); } };
}

it('keeps ongoing recognized speech active beyond the idle grace', async () => {
  const f = await fixture();
  try {
    f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'turn-1' });
    for (let i = 0; i < 91; i++) {
      await f.flow.input(new Uint8Array(2560));
      f.stt.events.push({ type: 'partial', segmentId: 'turn-1', text: 'Still speaking' });
      await settle();
      f.h.time.advance(1000);
    }
    expect(f.h.stops).not.toContainEqual({ sessionId: 'voice-session-1', reason: 'idle' });
  } finally { await f.close(); }
});

it('keeps quiet and generating calls open beyond the old idle grace', async () => {
  const silent = await fixture();
  try {
    for (let i = 0; i < 91; i++) { await silent.flow.input(new Uint8Array(2560)); silent.h.time.advance(1000); }
    expect(silent.h.stops).not.toContainEqual({ sessionId: 'voice-session-1', reason: 'idle' });
  } finally { await silent.close(); }
  const busy = await fixture(); let release!: () => void;
  busy.hooks.finalized.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  try {
    busy.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p1', text: 'Question' }); await settle();
    busy.h.time.advance(100000); expect(busy.h.stops).toEqual([]);
    release(); await settle(); busy.h.time.advance(90001);
    expect(busy.h.stops).not.toContainEqual({ sessionId: 'voice-session-1', reason: 'idle' });
  } finally { release?.(); await busy.close(); }
});

it('interrupts a prepared thinking response without issuing a provider Interrupt', async () => {
  const f = await fixture();
  try {
    f.hooks.finalized.mockImplementation(async () => {
      f.flow.prepareResponse({ turnId: 't1', responseId: 'r1' });
    });
    f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'turn-1', text: 'First question' });
    await settle();
    f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'turn-2' });
    await settle();
    expect(f.hooks.finalized).toHaveBeenCalledOnce();
    expect(f.hooks.interrupt).toHaveBeenCalledOnce();
    expect(f.tts.connection.interrupt).not.toHaveBeenCalled();
  } finally { await f.close(); }
});
