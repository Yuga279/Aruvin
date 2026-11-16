/**
 * ============================================================================
 * FILE: bounded.ts
 * LOCATION: backend/src/operations/bounded.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bound a promise by a deadline without claiming the work was cancelled.
 *
 * ROLE IN PROJECT:
 *    Gives readiness, drain, and close hooks a finite wait that fails closed
 *    after timeout while leaving the original job running to completion.
 *
 * KEY COMPONENTS:
 *    - boundedResult: Timer-cleaned race that never aborts underlying work.
 * ============================================================================
 */

export async function boundedResult<T>(job: Promise<T>, ms: number): Promise<
  { ok:true; value:T } | { ok:false }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      job.then(value => ({ ok:true as const, value }), () => ({ ok:false as const })),
      new Promise<{ ok:false }>(resolve => { timer = setTimeout(() => resolve({ ok:false }), ms); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
