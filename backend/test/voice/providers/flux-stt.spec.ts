/**
 * ============================================================================
 * FILE: flux-stt.spec.ts
 * LOCATION: backend/test/voice/providers/flux-stt.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit and regression tests for Deepgram Flux conversational STT adapter.
 *
 * ROLE IN PROJECT:
 *    Verifies 80ms PCM16 frame validation, ordered turn lifecycle events
 *    (StartOfTurn, Update, EndOfTurn), ForceEndTurn, and CloseStream behavior.
 *
 * KEY COMPONENTS:
 *    - 80ms PCM16 frame size validation tests
 *    - Turn sequence ordering and model trigger checks
 *    - ForceEndTurn and CloseStream behavior tests
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { FluxSttAdapter } from '../../../src/voice/providers/flux-stt.js';
import type { SttEvent } from '../../../src/contracts/voice.js';
import { config, input, harness, collect, tick, connected, turn } from '../../fixtures/deepgram/socket.js';

it('sends exact 80ms PCM16 frames and only completed turns can trigger the bridge', async () => {
  const h = harness(connected); const c = await new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live'));
  const events: SttEvent[] = []; const done = collect(c.events, events); const s = h.sockets[0];
  const pcm = new Uint8Array(2560); pcm[0] = 0x34; pcm[1] = 0x12; await c.writeAudio(pcm);
  expect(s.sent[0]).toEqual(pcm);
  for (const bytes of [0, 1, 2558, 2562])
    await expect(c.writeAudio(new Uint8Array(bytes))).rejects.toMatchObject({ fault: { code: 'INVALID_AUDIO_FRAME' } });
  s.json(turn('StartOfTurn', 1)); s.json(turn('Update', 2, 'what is'));
  s.json(turn('EagerEndOfTurn', 3, 'what is')); s.json(turn('TurnResumed', 4, 'what is next'));
  await tick(); expect(events.filter(e => e.type === 'end-of-turn')).toEqual([]);
  s.json(turn('EndOfTurn', 5, 'What is next?')); s.json(turn('EndOfTurn', 5, 'What is next?'));
  s.json(turn('EndOfTurn', 6, 'What is next?')); await tick();
  expect(events.filter(e => e.type === 'start-of-turn')).toEqual([{ type: 'start-of-turn', providerTurnId: 'fixture-request:0' }]);
  expect(events.filter(e => e.type === 'end-of-turn')).toEqual([{ type: 'end-of-turn', providerTurnId: 'fixture-request:0', text: 'What is next?' }]);
  const u = h.requests[0].url;
  expect(u.pathname).toBe('/v2/listen');
  expect(Object.fromEntries(u.searchParams)).toEqual({ tag: h.accounting.tag, model: 'flux-general-en', encoding: 'linear16', sample_rate: '16000', eot_threshold: '0.8', eot_timeout_ms: '5000' });
  await c.close(); await done;
});

it('ForceEndTurn is explicit; CloseStream never promotes trailing Update', async () => {
  const h = harness(connected);
  const c = await new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  const pending = c.finalize();
  expect(h.sockets[0].controls()).toContainEqual({ type: 'ForceEndTurn' });
  h.sockets[0].json({ ...turn('EndOfTurn', 1, ''), trigger: 'manual' });
  await pending;
  await c.close();
  expect(h.sockets[0].controls()).toContainEqual({ type: 'CloseStream' });
  h.sockets[0].json(turn('Update', 2, 'incomplete tail'));
  await done;
  expect(events.some(e => e.type === 'end-of-turn')).toBe(false);
});

it('settles one ForceEndTurn only on EndOfTurn and reuses a completed turn', async () => {
  const h = harness(connected);
  const c = await new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live'));
  const events: SttEvent[] = []; const done = collect(c.events, events); const s = h.sockets[0];
  await c.writeAudio(new Uint8Array(2560));
  s.json(turn('StartOfTurn', 1));
  s.json(turn('Update', 2, 'Keep the final word'));
  const a = c.finalize(); const b = c.finalize();
  const resolved = vi.fn();
  void a.then(resolved);
  await tick();
  expect(resolved).not.toHaveBeenCalled();
  expect(a).toBe(b);
  expect(s.controls().filter(m => (m as { type: string }).type === 'ForceEndTurn')).toHaveLength(1);
  s.json({ ...turn('EndOfTurn', 3, 'Keep the final word.'), trigger: 'manual' });
  await Promise.all([a, b]); await tick();
  await c.finalize();
  expect(events.filter(e => e.type === 'end-of-turn')).toHaveLength(1);
  expect(events.filter(e => e.type === 'finalized')).toEqual([{ type: 'finalized', unfinalizedTail: false }]);
  expect(s.controls().filter(m => (m as { type: string }).type === 'ForceEndTurn')).toHaveLength(1);
  await c.writeAudio(new Uint8Array(2560));
  const next = c.finalize();
  s.json({ type: 'Warning', code: 'FORCE_END_TURN_NO_ACTIVE_TURN' });
  await next; await c.close(); await done;
  expect(events.filter(e => e.type === 'error')).toEqual([]);
  expect(events.filter(e => e.type === 'end-of-turn')).toHaveLength(1);
});

it('treats no-active-turn as success and rejects outstanding finalization on close', async () => {
  const h = harness(connected);
  const c = await new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live'));
  const events: SttEvent[] = []; const done = collect(c.events, events); const s = h.sockets[0];
  const idle = c.finalize();
  s.json({ type: 'Warning', code: 'FORCE_END_TURN_NO_ACTIVE_TURN' });
  await idle; await tick();
  expect(events.filter(e => e.type === 'finalized')).toHaveLength(1);
  expect(events.some(e => e.type === 'end-of-turn' || e.type === 'error')).toBe(false);
  await c.writeAudio(new Uint8Array(2560));
  const pending = c.finalize();
  const rejected = expect(pending).rejects.toMatchObject({ fault: { code: 'STT_UNAVAILABLE' } });
  await c.close(); await rejected; await done;
});
