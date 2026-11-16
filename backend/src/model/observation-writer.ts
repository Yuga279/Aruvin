/**
 * ============================================================================
 * FILE: observation-writer.ts
 * LOCATION: backend/src/model/observation-writer.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bounded asynchronous observation and accounting writer with synchronous
 *    identity barriers and supervised work tracking.
 *
 * ROLE IN PROJECT:
 *    Coalesces rapid streaming updates into at most one in-flight and at most
 *    one queued latest snapshot, latches persistence failures to abort
 *    dispatches, and guarantees drains to a fixed point.
 *
 * KEY COMPONENTS:
 *    - ObservationWriterOptions: Queue bounds, merge, persist, and supervision hooks.
 *    - ObservationWriter: Enqueue, flush, check, close, and queue snapshot interface.
 *    - createObservationWriter: Factory for supervised observation writers.
 * ============================================================================
 */

import { AppError } from '../platform/errors/app-error.js';

export type ObservationWriterOptions<T> = {
  initial: T;
  merge: (previous: T, next: T) => T;
  persist: (snapshot: T) => Promise<void>;
  track: <R>(promise: Promise<R>) => Promise<R>;
  fail: (error: unknown) => void;
};

export interface ObservationWriter<T> {
  enqueue(snapshot: T): number;
  flush(): Promise<void>;
  check(): void;
  close(): Promise<void>;
  snapshot(): Readonly<{ inFlight: number; queued: number; closed: boolean }>;
}

export function createObservationWriter<T>(options: ObservationWriterOptions<T>): ObservationWriter<T> {
  let closed = false;
  let latchedError: unknown = null;
  let hasLatchedError = false;

  let inFlightPromise: Promise<void> | null = null;
  let queuedSnapshot: T | null = null;
  let hasQueued = false;
  let latestTarget: T = options.initial;
  let version = 0;

  const drainWaiters: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];

  function notifyDrainWaiters(): void {
    if (!inFlightPromise && !hasQueued) {
      const waiters = drainWaiters.splice(0);
      for (const waiter of waiters) {
        if (hasLatchedError) {
          waiter.reject(latchedError);
        } else {
          waiter.resolve();
        }
      }
    }
  }

  function startPersist(target: T): void {
    const rawPromise = options.persist(target);
    const trackedPromise = options.track(rawPromise);

    inFlightPromise = trackedPromise.then(
      () => {
        inFlightPromise = null;
        if (hasQueued) {
          const next = queuedSnapshot as T;
          queuedSnapshot = null;
          hasQueued = false;
          startPersist(next);
        } else {
          notifyDrainWaiters();
        }
      },
      (error: unknown) => {
        if (!hasLatchedError) {
          hasLatchedError = true;
          latchedError = error;
          try {
            options.fail(error);
          } catch {
            // Prevent supervisor handler errors from interfering with writer latching
          }
        }
        inFlightPromise = null;
        queuedSnapshot = null;
        hasQueued = false;
        notifyDrainWaiters();
      },
    );
  }

  return {
    enqueue(snapshot: T): number {
      if (hasLatchedError) throw latchedError;
      if (closed) throw new AppError('NOT_READY', 'ObservationWriter is closed.', false);

      if (!inFlightPromise) {
        const merged = options.merge(latestTarget, snapshot);
        latestTarget = merged;
        version++;
        startPersist(merged);
      } else {
        const base = hasQueued ? (queuedSnapshot as T) : latestTarget;
        const merged = options.merge(base, snapshot);
        queuedSnapshot = merged;
        hasQueued = true;
        latestTarget = merged;
        version++;
      }
      return version;
    },

    flush(): Promise<void> {
      if (hasLatchedError) return Promise.reject(latchedError);
      if (!inFlightPromise && !hasQueued) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        drainWaiters.push({ resolve, reject });
      });
    },

    check(): void {
      if (hasLatchedError) throw latchedError;
    },

    async close(): Promise<void> {
      closed = true;
      await this.flush();
    },

    snapshot(): Readonly<{ inFlight: number; queued: number; closed: boolean }> {
      return {
        inFlight: inFlightPromise ? 1 : 0,
        queued: hasQueued ? 1 : 0,
        closed,
      };
    },
  };
}
