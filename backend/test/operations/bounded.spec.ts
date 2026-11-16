/**
 * ============================================================================
 * FILE: bounded.spec.ts
 * LOCATION: backend/test/operations/bounded.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove hung-job deadlines fail closed and success clears timers.
 *
 * ROLE IN PROJECT:
 *    Guards the shared wait helper used by readiness, drain, and persistence
 *    close so timeout never claims cancellation of underlying work.
 *
 * KEY COMPONENTS:
 *    - Hung promise: Returns { ok:false } at the deadline.
 *    - Resolved promise: Returns the value and leaves no leftover timers.
 * ============================================================================
 */

import { boundedResult } from '../../src/operations/bounded.js';
it('bounds a hung promise without claiming it stopped and clears success timers', async () => {
  vi.useFakeTimers();
  try {
    const result = boundedResult(new Promise<never>(() => undefined), 25);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toEqual({ ok:false });
    expect(await boundedResult(Promise.resolve('yes'), 25)).toEqual({ ok:true, value:'yes' });
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
