/**
 * ============================================================================
 * FILE: nova-stt.spec.ts
 * LOCATION: backend/test/voice/providers/nova-stt.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit and regression tests for Nova-3 dictation STT adapter.
 *
 * ROLE IN PROJECT:
 *    Verifies partial/final transcript translation, deduplication, URL construction,
 *    bounded Stop finalization drain, and error handling for Nova STT.
 *
 * KEY COMPONENTS:
 *    - Segment deduplication and partial replacement tests
 *    - Finalize drain and 2s timeout bounds tests
 *    - Cancellation and empty buffer tests
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { NovaSttAdapter } from '../../../src/voice/providers/nova-stt.js';
import type { SttEvent } from '../../../src/contracts/voice.js';
import { config, input, harness, collect, tick, novaResult } from '../../fixtures/deepgram/socket.js';
afterEach(() => vi.useRealTimers());

it('keeps segment identity stable when interim and final durations change', async () => {
  const h = harness();
  const c = await new NovaSttAdapter(config(), h.factory, h.accounting).connect(input('dictation'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  try {
    const s = h.sockets[0];
    s.json({ ...novaResult('Hello', false), duration: 1.1 });
    s.json({ ...novaResult('Hello Aurvin', false), duration: 2.1 });
    s.json({ ...novaResult('Hello Aurvin.', true), duration: 1.8 });
    s.json({ ...novaResult('Hello Aurvin.', true), duration: 2 });
    s.json({ ...novaResult('obsolete', false), duration: 2.2 });
    // The same spoken words in a later segment are real repetition, not a duplicate.
    s.json({ ...novaResult('Hello Aurvin', false, 1.8), duration: 1.1 });
    s.json({ ...novaResult('Hello Aurvin.', true, 1.8), duration: 1.5 });
    await tick();
    expect(events.filter(e => e.type === 'partial' || e.type === 'final')).toEqual([
      { type: 'partial', segmentId: '0:0', text: 'Hello' },
      { type: 'partial', segmentId: '0:0', text: 'Hello Aurvin' },
      { type: 'final', segmentId: '0:0', text: 'Hello Aurvin.' },
      { type: 'partial', segmentId: '0:1.8', text: 'Hello Aurvin' },
      { type: 'final', segmentId: '0:1.8', text: 'Hello Aurvin.' },
    ]);
  } finally { await c.close(); await done; }
});

it('admits newer interims even when timestamps temporally overlap the previous final segment duration', async () => {
  const h = harness();
  const c = await new NovaSttAdapter(config(), h.factory, h.accounting).connect(input('dictation'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  try {
    const s = h.sockets[0];
    // Final segment 0:0 extends through 2.0s
    s.json({ ...novaResult('First sentence.', true, 0), duration: 2.0 });
    // Obsolete interim for segment 0:0 arrives after final
    s.json({ ...novaResult('obsolete late interim', false, 0), duration: 2.1 });
    // Next segment starts at 1.8s (temporal overlap with 2.0s finalEnd)
    s.json({ ...novaResult('Second', false, 1.8), duration: 0.5 });
    s.json({ ...novaResult('Second sentence.', true, 1.8), duration: 1.2 });
    await tick();
    expect(events.filter(e => e.type === 'partial' || e.type === 'final')).toEqual([
      { type: 'final', segmentId: '0:0', text: 'First sentence.' },
      { type: 'partial', segmentId: '0:1.8', text: 'Second' },
      { type: 'final', segmentId: '0:1.8', text: 'Second sentence.' },
    ]);
  } finally { await c.close(); await done; }
});

it('replaces partials, emits each final once, and keeps speech_final recording', async () => {
  const h = harness(); const cfg = config(); cfg.deepgram.keyterms = ['Aurvin', 'Demo ID'];
  const c = await new NovaSttAdapter(cfg, h.factory, h.accounting).connect(input('dictation'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  const s = h.sockets[0];
  s.json(novaResult('Demo', false)); s.json(novaResult('Demo 42', false));
  s.json(novaResult('Demo 42.', true)); s.json(novaResult('Demo 42.', true));
  await c.writeAudio(new Uint8Array(2560)); await tick();
  expect(events.flatMap(e => e.type === 'partial' ? [e.text] : [])).toEqual(['Demo', 'Demo 42']);
  expect(events.filter(e => e.type === 'final')).toEqual([
    { type: 'final', segmentId: '0:0', text: 'Demo 42.' },
  ]);
  expect(events.some(e => e.type === 'end-of-turn' || e.type === 'finalized')).toBe(false);
  expect(s.readyState).toBe(1);
  const { url, headers } = h.requests[0];
  expect(url.origin + url.pathname).toBe('wss://api.deepgram.com/v1/listen');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ model: 'nova-3', language: 'en-US',
    encoding: 'linear16', sample_rate: '16000', channels: '1', interim_results: 'true',
    smart_format: 'true', punctuate: 'true', endpointing: '300' });
  expect(url.searchParams.getAll('keyterm')).toEqual(['Aurvin', 'Demo ID']);
  expect(url.searchParams.has('dictation')).toBe(false);
  expect(headers).toEqual({ Authorization: 'Token test-secret-not-real' });
  expect(url.href).not.toContain('test-secret');
  await c.close(); await done;
});

it('drains late finals on Stop and emits finalized only once', async () => {
  const h = harness(); const c = await new NovaSttAdapter(config(), h.factory, h.accounting).connect(input('dictation'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  await c.writeAudio(new Uint8Array(2560));
  const stop = c.finalize(); const again = c.finalize(); await tick();
  expect(h.sockets[0].controls()).toContainEqual({ type: 'Finalize' });
  await expect(c.writeAudio(new Uint8Array(2560))).rejects.toMatchObject({ fault: { code: 'VOICE_INVALID_STATE' } });
  h.sockets[0].json(novaResult('Keep this tail.', true, 0, true));
  await Promise.all([stop, again]); await done;
  expect(events.filter(e => e.type === 'finalized')).toEqual([{ type: 'finalized', unfinalizedTail: false }]);
  expect(events.flatMap(e => e.type === 'final' ? [e.text] : [])).toEqual(['Keep this tail.']);
});

it('bounds Finalize at 2s and preserves committed text with an uncertain tail', async () => {
  vi.useFakeTimers(); const h = harness();
  const pending = new NovaSttAdapter(config(), h.factory, h.accounting).connect(input('dictation'));
  await vi.advanceTimersByTimeAsync(0); const c = await pending;
  const events: SttEvent[] = []; const done = collect(c.events, events);
  h.sockets[0].json(novaResult('Committed.', true));
  await c.writeAudio(new Uint8Array(2560)); h.sockets[0].json(novaResult('uncertain', false, 0.8));
  const stop = c.finalize(); await vi.advanceTimersByTimeAsync(1999);
  expect(events.some(e => e.type === 'finalized')).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await stop; await done;
  expect(events).toContainEqual({ type: 'final', segmentId: '0:0', text: 'Committed.' });
  expect(events).toContainEqual({ type: 'finalized', unfinalizedTail: true });
  expect(events).toContainEqual({ type: 'error', fault: { code: 'DICTATION_FINALIZATION_TIMEOUT',
    recoverable: true, recovery: 'retry_dictation' } });
});

it('handles empty Finalize without a provider acknowledgement and ignores cancelled callbacks', async () => {
  vi.useFakeTimers(); const h = harness();
  const pending = new NovaSttAdapter(config(), h.factory, h.accounting).connect(input('dictation'));
  await vi.advanceTimersByTimeAsync(0); const c = await pending;
  const events: SttEvent[] = []; const done = collect(c.events, events);
  const stop = c.finalize(); await vi.advanceTimersByTimeAsync(2000); await stop; await done;
  expect(events.filter(e => e.type !== 'usage')).toEqual([{ type: 'finalized', unfinalizedTail: false }]);
  const h2 = harness(); const pending2 = new NovaSttAdapter(config(), h2.factory, h2.accounting).connect(input('dictation'));
  await vi.advanceTimersByTimeAsync(0); const c2 = await pending2;
  const late: SttEvent[] = []; const done2 = collect(c2.events, late);
  await c2.close(); h2.sockets[0].json(novaResult('Must not insert.', true)); await done2;
  expect(late.filter(e => e.type !== 'usage')).toEqual([]);
});
