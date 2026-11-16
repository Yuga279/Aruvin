/**
 * ============================================================================
 * FILE: voice-shutdown.spec.ts
 * LOCATION: backend/test/operations/voice-shutdown.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify voice drain ordering, persistence protection, and metrics snapshot.
 *
 * ROLE IN PROJECT:
 *    Ensures OperationsService stops admission synchronously, starts voice and
 *    runtime drains under one deadline, and closes persistence only once after
 *    every required drain succeeds.
 *
 * KEY COMPONENTS:
 *    - synchronous stop, concurrent drain start, and persistence-close ordering
 * ============================================================================
 */

import { OperationsService } from '../../src/operations/operations.service.js';
import { options } from './fixtures.js';
import { deferred } from '../http/fixtures.js';

it('stops voice admission synchronously and starts voice drain while runtime is pending', async () => {
  vi.useFakeTimers();
  const { o, runtime } = options();
  const order: string[] = [];
  const gate = deferred<{ drained: boolean; active: number; unresolvedWrites: number }>();
  o.stopVoice = vi.fn(() => { order.push('voice-stop'); });
  o.drainVoice = vi.fn(async () => { order.push('voice-drain'); return { drained: true, active: 0 }; });
  const drain = vi.spyOn(runtime, 'drain').mockImplementation(() => gate.promise);
  try {
    const closing = new OperationsService(o).shutdown();
    expect(order).toEqual(['voice-stop']);
    await Promise.resolve(); await Promise.resolve();
    expect(order).toContain('voice-drain');
    expect(o.closePersistence).not.toHaveBeenCalled();
    gate.resolve({ drained: true, active: 0, unresolvedWrites: 0 });
    expect(await closing).toEqual({ safe: true });
    expect(drain).toHaveBeenCalledTimes(1);
    expect(o.closePersistence).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it('starts both drains once after stopping admission and closes persistence last', async () => {
  const { o, runtime } = options();
  const order: string[] = [];
  o.stopVoice = vi.fn(() => { order.push('voice-stop'); });
  vi.spyOn(runtime, 'stopAccepting').mockImplementation(() => { order.push('stop'); });
  const drain = vi.spyOn(runtime, 'drain').mockImplementation(async () => {
    order.push('runtime'); return { drained: true, active: 0, unresolvedWrites: 0 };
  });
  o.drainVoice = vi.fn(async () => { order.push('voice'); return { drained: true, active: 0 }; });
  o.closePersistence = vi.fn(async () => { order.push('close'); });
  const ops = new OperationsService(o);
  expect(await ops.shutdown()).toEqual({ safe: true });
  expect(order.slice(0, 2)).toEqual(['voice-stop', 'stop']);
  expect(order).toEqual(expect.arrayContaining(['runtime', 'voice', 'close']));
  expect(order.at(-1)).toBe('close');
  expect(o.drainVoice).toHaveBeenCalledTimes(1);
  expect(drain).toHaveBeenCalledTimes(1);
});

it('does not close persistence while voice drain is active, hung, or rejected', async () => {
  const active = options();
  active.o.drainVoice = async () => ({ drained: false, active: 1 });
  expect(await new OperationsService(active.o).shutdown()).toEqual({ safe: false });
  expect(active.o.closePersistence).not.toHaveBeenCalled();
  const hung = options();
  vi.useFakeTimers();
  try {
    hung.o.drainVoice = () => new Promise(() => undefined);
    const pending = new OperationsService(hung.o).shutdown();
    await vi.advanceTimersByTimeAsync(hung.o.config.budgets.shutdownDrainMs);
    expect(await pending).toEqual({ safe: false });
    expect(hung.o.closePersistence).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it('includes only the injected voice snapshot and no transcript', () => {
  const { o } = options();
  o.voiceSnapshot = () => ({ active: 1, sessions: 1, reconnects: 0, failures: 0, rejected: 0,
    sttAudioMs: 1, ttsAudioMs: 0, ttsCharacters: 0, audioComplete: true, charactersComplete: true,
    promptTokens: 0, completionTokens: 0, estimatedSpendUsd: null, spendStatus: 'unknown',
    latency: { stt: { count: 0, p50: null, p95: null }, turn: { count: 0, p50: null, p95: null },
      llm: { count: 0, p50: null, p95: null }, tool: { count: 0, p50: null, p95: null },
      tts: { count: 0, p50: null, p95: null }, transport: { count: 0, p50: null, p95: null },
      playback: { count: 0, p50: null, p95: null } } });
  const body = JSON.stringify(new OperationsService(o).metrics());
  expect(JSON.parse(body).voice.spendStatus).toBe('unknown');
  expect(body).not.toContain('transcript');
  expect(body).not.toContain('fixture-secret');
});
