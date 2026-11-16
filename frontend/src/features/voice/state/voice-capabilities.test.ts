/**
 * ============================================================================
 * FILE: voice-capabilities.test.ts
 * LOCATION: frontend/src/features/voice/state/voice-capabilities.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove shared public voice capabilities refresh without mutating snapshots.
 *
 * ROLE IN PROJECT:
 *    Guards P4/P5 so admin saves can refresh safe config independently of
 *    active session controllers.
 *
 * KEY COMPONENTS:
 *    - createVoiceCapabilitiesStore: In-memory latest-response store.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import type { PublicVoiceConfig } from '../../../api/voice-protocol.ts';
import { liveVoiceFixture } from './testing/live-voice-fixture.ts';
import { createVoiceCapabilitiesStore } from './voice-capabilities.ts';

it('publishes refreshed capabilities without mutating an earlier safe snapshot', async () => {
  const a = liveVoiceFixture().config;
  const b = { ...a, enabledModes: { dictation: false, live: true },
    limits: { ...a.limits, inputQueueMs: 800 } };
  const load = vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b);
  const store = createVoiceCapabilitiesStore(load);
  const changed = vi.fn(); const unsubscribe = store.subscribe(changed);
  expect(store.getSnapshot()).toBeNull(); expect(load).not.toHaveBeenCalled();
  await store.ensureLoaded(); const admitted = store.getSnapshot()!;
  await store.refresh();
  expect(store.getSnapshot()).toEqual(b);
  expect(store.getSnapshot()).toBe(store.getSnapshot());
  expect(admitted.enabledModes.dictation).toBe(true);
  expect(admitted.limits.inputQueueMs).toBe(a.limits.inputQueueMs);
  unsubscribe(); await store.refresh(); expect(changed).toHaveBeenCalledTimes(2);
});

it('coalesces two ensureLoaded subscribers into one load', async () => {
  let resolve!: (value: PublicVoiceConfig) => void;
  const load = vi.fn(() => new Promise<PublicVoiceConfig>(r => { resolve = r; }));
  const store = createVoiceCapabilitiesStore(load);
  const first = store.ensureLoaded();
  const second = store.ensureLoaded();
  expect(load).toHaveBeenCalledTimes(1);
  resolve(liveVoiceFixture().config);
  expect(await first).toBe(true);
  expect(await second).toBe(true);
});

it('ignores a slow older success after a newer refresh', async () => {
  const a = liveVoiceFixture().config;
  const b = { ...a, limits: { ...a.limits, inputQueueMs: 800 } };
  let finishOld!: (value: PublicVoiceConfig) => void;
  const load = vi.fn()
    .mockImplementationOnce(() => new Promise<PublicVoiceConfig>(r => { finishOld = r; }))
    .mockResolvedValueOnce(b);
  const store = createVoiceCapabilitiesStore(load);
  const first = store.refresh();
  const second = store.refresh();
  finishOld(a);
  expect(await first).toBe(false);
  expect(await second).toBe(true);
  expect(store.getSnapshot()).toEqual(b);
});

it('passes an abort signal to the superseded request', async () => {
  const signals: AbortSignal[] = [];
  const a = liveVoiceFixture().config;
  const load = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return Promise.resolve(a);
  });
  const store = createVoiceCapabilitiesStore(load);
  void store.refresh();
  await store.refresh();
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
});

it('refresh failure publishes null and returns false without rejecting', async () => {
  const load = vi.fn().mockRejectedValue(new Error('offline'));
  const store = createVoiceCapabilitiesStore(load);
  await expect(store.refresh()).resolves.toBe(false);
  expect(store.getSnapshot()).toBeNull();
});

it('late old failure does not clear newer success', async () => {
  const a = liveVoiceFixture().config;
  let failOld!: (error: Error) => void;
  const load = vi.fn()
    .mockImplementationOnce(() => new Promise<PublicVoiceConfig>((_, reject) => { failOld = reject; }))
    .mockResolvedValueOnce(a);
  const store = createVoiceCapabilitiesStore(load);
  const first = store.refresh();
  const second = store.refresh();
  failOld(new Error('stale'));
  expect(await first).toBe(false);
  expect(await second).toBe(true);
  expect(store.getSnapshot()).toEqual(a);
});
