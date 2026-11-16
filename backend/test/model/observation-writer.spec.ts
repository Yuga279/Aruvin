/**
 * ============================================================================
 * FILE: observation-writer.spec.ts
 * LOCATION: backend/test/model/observation-writer.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for the supervised bounded observation writer.
 *
 * ROLE IN PROJECT:
 *    Verifies queue bounds (1 in-flight + 1 queued latest), synchronous merge
 *    conflicts, error latching, supervisor failure signaling, raw promise tracking,
 *    and drain-to-fixed-point semantics.
 *
 * KEY COMPONENTS:
 *    - createObservationWriter test cases:
 *      * queue bounds and coalescing
 *      * synchronous merge conflict before second save
 *      * first-write error latching and supervisor fail
 *      * second-write error latching
 *      * enqueue during flush
 *      * close during active save and no work after closed
 *      * no unhandled rejection
 *      * delayed write past visible timeout and raw promise retention
 * ============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { createObservationWriter } from '../../src/model/observation-writer.js';

describe('ObservationWriter', () => {
  it('keeps one pending latest snapshot and drains the raw write', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const saved: number[] = [];
    const pending = new Set<Promise<unknown>>();
    const writer = createObservationWriter<number>({
      initial: 0,
      merge: (a, b) => { if (b < a) throw new Error('regression'); return b; },
      persist: async n => { if (!saved.length) await gate; saved.push(n); },
      track: promise => {
        pending.add(promise);
        void promise.then(() => pending.delete(promise), () => pending.delete(promise));
        return promise;
      },
      fail: () => {},
    });
    writer.enqueue(1);
    for (let n = 2; n <= 100; n++) writer.enqueue(n);
    expect(writer.snapshot()).toMatchObject({ inFlight: 1, queued: 1 });
    expect(pending.size).toBe(1);
    release();
    await writer.close();
    expect(saved).toEqual([1, 100]);
    expect(pending.size).toBe(0);
  });

  it('rejects synchronously on merge conflict before a second save', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const saved: number[] = [];
    const writer = createObservationWriter<number>({
      initial: 0,
      merge: (a, b) => {
        if (b < a) throw new Error(`regression: ${b} < ${a}`);
        return b;
      },
      persist: async n => {
        if (n === 10) await gate;
        saved.push(n);
      },
      track: p => p,
      fail: () => {},
    });

    writer.enqueue(10);
    expect(() => writer.enqueue(5)).toThrow('regression: 5 < 10');
    expect(writer.snapshot()).toMatchObject({ inFlight: 1, queued: 0 });

    release();
    await writer.close();
    expect(saved).toEqual([10]);
  });

  it('latches first-write error, aborts supervisor via fail(), and rejects flush/close', async () => {
    const failedErrors: unknown[] = [];
    const writer = createObservationWriter<number>({
      initial: 0,
      merge: (_a, b) => b,
      persist: async () => {
        throw new Error('first-write DB failure');
      },
      track: p => p,
      fail: err => failedErrors.push(err),
    });

    writer.enqueue(1);
    await expect(writer.flush()).rejects.toThrow('first-write DB failure');
    expect(failedErrors.length).toBe(1);
    expect((failedErrors[0] as Error).message).toBe('first-write DB failure');
    expect(() => writer.check()).toThrow('first-write DB failure');
    expect(() => writer.enqueue(2)).toThrow('first-write DB failure');
    await expect(writer.close()).rejects.toThrow('first-write DB failure');
  });

  it('latches second-write error and preserves raw tracking', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const failedErrors: unknown[] = [];
    const pending = new Set<Promise<unknown>>();

    const writer = createObservationWriter<number>({
      initial: 0,
      merge: (_a, b) => b,
      persist: async n => {
        if (n === 1) await firstGate;
        if (n === 2) throw new Error('second-write DB failure');
      },
      track: promise => {
        pending.add(promise);
        void promise.then(() => pending.delete(promise), () => pending.delete(promise));
        return promise;
      },
      fail: err => failedErrors.push(err),
    });

    writer.enqueue(1);
    writer.enqueue(2);
    expect(pending.size).toBe(1);

    releaseFirst();
    await expect(writer.flush()).rejects.toThrow('second-write DB failure');
    expect(failedErrors.length).toBe(1);
    expect(pending.size).toBe(0);
    expect(() => writer.check()).toThrow('second-write DB failure');
  });

  it('drains to a fixed point when enqueue happens during flush', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const saved: number[] = [];

    const writer = createObservationWriter<number>({
      initial: 0,
      merge: (_a, b) => b,
      persist: async n => {
        if (n === 1) await firstGate;
        saved.push(n);
      },
      track: p => p,
      fail: () => {},
    });

    writer.enqueue(1);
    const flushPromise = writer.flush();
    // While flush is waiting for write 1, enqueue write 2
    writer.enqueue(2);

    releaseFirst();
    await flushPromise;

    // Both 1 and 2 must have completed
    expect(saved).toEqual([1, 2]);
    expect(writer.snapshot()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it('closes during active save and rejects subsequent enqueues', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const saved: number[] = [];

    const writer = createObservationWriter<number>({
      initial: 0,
      merge: (_a, b) => b,
      persist: async n => {
        await gate;
        saved.push(n);
      },
      track: p => p,
      fail: () => {},
    });

    writer.enqueue(1);
    const closePromise = writer.close();
    expect(writer.snapshot().closed).toBe(true);

    expect(() => writer.enqueue(2)).toThrow('ObservationWriter is closed');

    release();
    await closePromise;
    expect(saved).toEqual([1]);

    // Repeated close is idempotent
    await expect(writer.close()).resolves.toBeUndefined();
  });

  it('does not produce unhandled rejections on asynchronous persist failure', async () => {
    const unhandledRejections: unknown[] = [];
    const handler = (event: PromiseRejectionEvent) => {
      unhandledRejections.push(event.reason);
    };
    if (typeof process !== 'undefined') {
      process.on('unhandledRejection', (reason) => unhandledRejections.push(reason));
    }

    const writer = createObservationWriter<number>({
      initial: 0,
      merge: (_a, b) => b,
      persist: async () => {
        throw new Error('unhandled test error');
      },
      track: p => p,
      fail: () => {},
    });

    writer.enqueue(1);
    // Yield microtasks so persist rejection settles
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(() => writer.check()).toThrow('unhandled test error');
    await expect(writer.flush()).rejects.toThrow('unhandled test error');
    expect(unhandledRejections.length).toBe(0);
  });

  it('retains raw promise in track past visible timeout', async () => {
    let releaseRaw!: () => void;
    const rawGate = new Promise<void>(resolve => { releaseRaw = resolve; });
    const pending = new Set<Promise<unknown>>();

    const writer = createObservationWriter<number>({
      initial: 0,
      merge: (_a, b) => b,
      persist: async () => {
        await rawGate;
      },
      track: promise => {
        pending.add(promise);
        void promise.then(() => pending.delete(promise), () => pending.delete(promise));
        return promise;
      },
      fail: () => {},
    });

    writer.enqueue(1);
    expect(pending.size).toBe(1);

    // Simulate visible timeout expiring before raw write finishes
    const visibleTimeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 10));
    const result = await Promise.race([writer.flush(), visibleTimeout]);
    expect(result).toBe('timeout');

    // Raw promise is STILL tracked in pending
    expect(pending.size).toBe(1);

    // Settle raw promise
    releaseRaw();
    await writer.flush();
    expect(pending.size).toBe(0);
  });
});
