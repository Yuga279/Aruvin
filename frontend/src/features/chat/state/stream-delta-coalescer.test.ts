/**
 * ============================================================================
 * FILE: stream-delta-coalescer.test.ts
 * LOCATION: frontend/src/features/chat/state/stream-delta-coalescer.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for StreamDeltaCoalescer buffering, resets, and scheduler.
 *
 * ROLE IN PROJECT:
 *    Validates Opportunity O4 isolation, background tab bounded delay,
 *    frame-rate batching, and reset flag preservation in isolation.
 *
 * KEY COMPONENTS:
 *    - Coalescer buffer tests
 *    - Reset semantics and pre-reset text discarding tests
 *    - Scheduler timeout fallback tests
 *    - Turn context isolation tests
 * ============================================================================
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultStreamScheduler,
  StreamDeltaCoalescer,
  type StreamDeltaPayload,
  type StreamScheduler,
} from './stream-delta-coalescer.ts';

describe('StreamDeltaCoalescer unit tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('buffers multiple deltas and flushes once when scheduler triggers', () => {
    const flushed: StreamDeltaPayload[] = [];
    const coalescer = new StreamDeltaCoalescer({
      onFlush: (p) => flushed.push(p),
    });

    coalescer.bufferDelta('Hello ');
    coalescer.bufferDelta('brave ');
    coalescer.bufferDelta('new world!');

    expect(flushed).toHaveLength(0);
    expect(coalescer.hasPending()).toBe(true);

    vi.advanceTimersByTime(16);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual({ text: 'Hello brave new world!' });
    expect(coalescer.hasPending()).toBe(false);
  });

  it('preserves reset flag and overwrites un-flushed previous text in batch', () => {
    const flushed: StreamDeltaPayload[] = [];
    const coalescer = new StreamDeltaCoalescer({
      onFlush: (p) => flushed.push(p),
    });

    coalescer.bufferDelta('Un-flushed pre-reset text');
    coalescer.bufferDelta('New beginning: ', true);
    coalescer.bufferDelta('cont');

    vi.advanceTimersByTime(16);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual({ text: 'New beginning: cont', reset: true });
  });

  it('preserves reset flag even when text after reset is empty', () => {
    const flushed: StreamDeltaPayload[] = [];
    const coalescer = new StreamDeltaCoalescer({
      onFlush: (p) => flushed.push(p),
    });

    coalescer.bufferDelta('', true);
    expect(coalescer.hasPending()).toBe(true);

    vi.advanceTimersByTime(16);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual({ text: '', reset: true });
  });

  it('flush() synchronously outputs pending text and cancels pending timer', () => {
    const flushed: StreamDeltaPayload[] = [];
    const coalescer = new StreamDeltaCoalescer({
      onFlush: (p) => flushed.push(p),
    });

    coalescer.bufferDelta('Immediate flush text');
    expect(flushed).toHaveLength(0);

    coalescer.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual({ text: 'Immediate flush text' });

    // Ensure timer advancing does not trigger a duplicate flush
    vi.advanceTimersByTime(50);
    expect(flushed).toHaveLength(1);
  });

  it('cancel() discards pending buffer and aborts future timer callbacks', () => {
    const flushed: StreamDeltaPayload[] = [];
    const coalescer = new StreamDeltaCoalescer({
      onFlush: (p) => flushed.push(p),
    });

    coalescer.bufferDelta('Discarded text');
    expect(coalescer.hasPending()).toBe(true);

    coalescer.cancel();
    expect(coalescer.hasPending()).toBe(false);

    vi.advanceTimersByTime(50);
    expect(flushed).toHaveLength(0);
  });

  it('enforces turn context isolation and rejects mismatched envelope deltas', () => {
    const flushed: StreamDeltaPayload[] = [];
    const coalescer = new StreamDeltaCoalescer({
      onFlush: (p) => flushed.push(p),
    });

    coalescer.attachTurn({ sessionId: 'sess_1', turnId: 'turn_1', attemptId: 'att_1' });

    // Correct turn
    coalescer.bufferDelta('Turn 1 text', false, {
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
    });

    // Mismatched turn
    coalescer.bufferDelta('Stale turn text', false, {
      sessionId: 'sess_1',
      turnId: 'old_turn',
      attemptId: 'att_1',
    });

    vi.advanceTimersByTime(16);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual({ text: 'Turn 1 text' });
  });

  it('supports custom injected scheduler', () => {
    let triggeredCallback: (() => void) | null = null;
    const customScheduler: StreamScheduler = {
      schedule(cb) {
        triggeredCallback = cb;
        return () => {
          triggeredCallback = null;
        };
      },
    };

    const flushed: StreamDeltaPayload[] = [];
    const coalescer = new StreamDeltaCoalescer({
      onFlush: (p) => flushed.push(p),
      scheduler: customScheduler,
    });

    coalescer.bufferDelta('Manual tick text');
    expect(flushed).toHaveLength(0);
    expect(triggeredCallback).not.toBeNull();

    // Trigger manually
    triggeredCallback!();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual({ text: 'Manual tick text' });
  });

  it('bounds background-tab throttling via timeout fallback when rAF does not fire', () => {
    // Simulate browser with requestAnimationFrame that stalls (e.g. background tab)
    const mockRaf = vi.fn((_cb: FrameRequestCallback) => 123);
    const mockCancelRaf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', mockRaf);
    vi.stubGlobal('cancelAnimationFrame', mockCancelRaf);

    const flushed: StreamDeltaPayload[] = [];
    const scheduler = createDefaultStreamScheduler({ maxDelayMs: 32 });
    const coalescer = new StreamDeltaCoalescer({
      onFlush: (p) => flushed.push(p),
      scheduler,
    });

    coalescer.bufferDelta('Background tab text');
    expect(mockRaf).toHaveBeenCalled();
    // rAF callback is never called (simulating frozen background tab)

    // Advance past maxDelayMs fallback
    vi.advanceTimersByTime(32);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual({ text: 'Background tab text' });
    expect(mockCancelRaf).toHaveBeenCalledWith(123);

    vi.unstubAllGlobals();
  });
});
