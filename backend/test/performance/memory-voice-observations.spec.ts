/**
 * ============================================================================
 * FILE: memory-voice-observations.spec.ts
 * LOCATION: backend/test/performance/memory-voice-observations.spec.ts
 * PURPOSE: Verify voice accounting shares bounded application save ownership.
 * ROLE IN PROJECT: Offline admission, terminal-only saving, identity and drain tests.
 * KEY COMPONENTS: VoiceAccounting, foundation capacity and blocked raw saves.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { MemoryFirstFoundation } from '../../src/chat-runtime/memory-first-foundation.js';
import { PROPOSED_MEMORY_TEXT_POLICY } from '../../src/chat-runtime/memory-text.js';
import { VoiceAccounting } from '../../src/voice/usage/voice-accounting.js';
import { config } from '../fixtures/deepgram/socket.js';

it('admits accounting in memory and drains raw terminal-only saves under the shared writer limit', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saveVoiceObservation = vi.fn(async () => { await gate; return 'saved' as const; });
  const foundation = new MemoryFirstFoundation({ userId: 'user-one', epoch: 'epoch-one',
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxConcurrentSaves: 1, shutdownDrainMs: 20 },
    save: async () => ({ kind: 'unknown', retryable: false }), saveVoiceObservation });
  const accounting = new VoiceAccounting({ userId: 'user-one', voiceSessionId: 'voice-one',
    conversationId: () => null, config: config(), write: async record => { foundation.observeVoice(record); } });
  const first = await accounting.start('socket-one', 'flux-haley-en');
  const second = await accounting.start('socket-two', 'flux-haley-en');
  expect(saveVoiceObservation).not.toHaveBeenCalled();
  const usage = { providerRequestId: null, model: 'flux-haley-en', modelVersion: null, audioMs: 1, billableCharacters: 10 };
  await first.finish(usage, 'completed'); await second.finish(usage, 'completed');
  await vi.waitFor(() => expect(saveVoiceObservation).toHaveBeenCalledOnce());
  expect(await foundation.drain()).toMatchObject({ drained: false, pending: 2, unresolvedWrites: 1 });
  release();
  await vi.waitFor(() => expect(foundation.snapshot().pending).toBe(0));
  expect(await foundation.drain()).toMatchObject({ drained: true });
  expect(saveVoiceObservation.mock.calls.map(c => c[0].status)).toEqual(['completed', 'completed']);
});

it('reserves voice observation capacity before paid socket work and retains unknown saves without resetting retries', async () => {
  const saveVoiceObservation = vi.fn(async () => 'unknown' as const);
  const foundation = new MemoryFirstFoundation({ userId: 'user-one', epoch: 'epoch-one',
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxEnvelopes: 1, maxAttempts: 1, shutdownDrainMs: 10 },
    save: async () => ({ kind: 'unknown', retryable: false }), saveVoiceObservation });
  const accounting = new VoiceAccounting({ userId: 'user-one', voiceSessionId: 'voice-one',
    conversationId: () => null, config: config(), write: async record => { foundation.observeVoice(record); } });
  const first = await accounting.start('socket-one', 'flux-haley-en');
  await expect(accounting.start('socket-two', 'flux-haley-en')).rejects.toThrow();
  await first.finish({ providerRequestId: null, model: 'flux-haley-en', modelVersion: null, audioMs: null, billableCharacters: null }, 'closed');
  expect(await foundation.drain()).toMatchObject({ drained: false, pending: 1 });
  expect(saveVoiceObservation).toHaveBeenCalledOnce();
});

it('accepts >128 clean socket observations without restart while pinning dirty/unknown observations under pressure', async () => {
  let clock = 1_000_000;
  let mode: 'saved' | 'unknown' = 'saved';
  const saveVoiceObservation = vi.fn(async () => mode);
  const foundation = new MemoryFirstFoundation({ userId: 'user-one', epoch: 'epoch-one',
    now: () => clock,
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxRequestsPerSession: 128, maxEnvelopes: 160,
      maxBacklogBytes: 160 * PROPOSED_MEMORY_TEXT_POLICY.maxEnvelopeBytes, maxAttempts: 1, shutdownDrainMs: 20 },
    save: async () => ({ kind: 'unknown', retryable: false }), saveVoiceObservation });
  const makeAccounting = (voiceSessionId: string) => new VoiceAccounting({ userId: 'user-one', voiceSessionId,
    conversationId: () => null, config: config(), write: async record => { foundation.observeVoice(record); } });
  const usage = { providerRequestId: null, model: 'flux-haley-en', modelVersion: null, audioMs: 50, billableCharacters: 12 };

  for (let i = 1; i <= 140; i++) {
    const accounting = makeAccounting(`voice-clean-${i}`);
    const handle = await accounting.start(`clean-socket-${i}`, 'flux-haley-en');
    await handle.finish(usage, 'completed');
    while (foundation.snapshot().pending > 0) await setImmediate();
  }
  expect(saveVoiceObservation).toHaveBeenCalledTimes(140);
  expect(foundation.snapshot().reservedMemoryBytes).toBeLessThanOrEqual(PROPOSED_MEMORY_TEXT_POLICY.maxMemoryBytes);

  clock += PROPOSED_MEMORY_TEXT_POLICY.requestRetentionMs + 1;
  expect(foundation.evictCleanObservations()).toBeGreaterThan(0);
  expect(foundation.snapshot().reservedMemoryBytes).toBe(0);

  mode = 'unknown';
  for (let i = 1; i <= 128; i++) {
    const accounting = makeAccounting(`voice-dirty-${i}`);
    const handle = await accounting.start(`dirty-socket-${i}`, 'flux-haley-en');
    await handle.finish(usage, 'closed');
  }
  while (foundation.snapshot().unresolvedWrites > 0) await setImmediate();
  expect(foundation.snapshot().pending).toBe(128);
  clock += PROPOSED_MEMORY_TEXT_POLICY.requestRetentionMs + 10;
  expect(foundation.evictCleanObservations()).toBe(0);
  await expect(makeAccounting('voice-dirty-129').start('dirty-socket-129', 'flux-haley-en')).rejects.toThrow(/capacity/i);
  expect(foundation.snapshot().pending).toBe(128);
});
