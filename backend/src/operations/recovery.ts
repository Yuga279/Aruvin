/**
 * ============================================================================
 * FILE: recovery.ts
 * LOCATION: backend/src/operations/recovery.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Gate operator-only stopped-owner handoff and bounded reconciliation pages.
 *
 * ROLE IN PROJECT:
 *    Reuses P2 ownership and P5 reconcileSession without inference, HTTP admin
 *    routes, or treating lease expiry as stopped-process proof.
 *
 * KEY COMPONENTS:
 *    - handoffVerifiedStopped: Operator boolean proof, then sentinel handoff.
 *    - reconcilePage: Quiescent, paged listForRecovery without execute/submit.
 * ============================================================================
 */

import type { ChatRuntime } from '../chat-runtime/index.js';
import type { PersistenceBundle } from '../persistence/persistence.js';
import type { MongoOwnership } from '../persistence/ownership.js';
import { AppError } from '../platform/errors/app-error.js';
export async function handoffVerifiedStopped(owner:Pick<MongoOwnership,'handoffStoppedExecutor'>,runtime:ChatRuntime,
  previousOwnerId:string,proof:{ oldProcessStopped:boolean; inFlightIoSettled:boolean; operatorAuthorized:boolean }) {
  // These booleans are an operator boundary, not machine-derived proof or HTTP input.
  // No route may accept them. Record control-plane evidence before calling this helper.
  if (!proof.oldProcessStopped || !proof.inFlightIoSettled || !proof.operatorAuthorized)
    throw new AppError('NOT_READY','Stopped executor has not been verified.');
  const state=runtime.snapshot();
  if (state.active || state.unresolvedWrites) throw new AppError('NOT_READY','Recovery is not quiescent.');
  await owner.handoffStoppedExecutor(previousOwnerId); runtime.allowStoppedOwner(previousOwnerId);
}
export async function reconcilePage(runtime:ChatRuntime,
  sessions:Pick<PersistenceBundle['sessions'],'listForRecovery'>,userId:string,cursor:string | null,limit:number) {
  const state=runtime.snapshot();
  if (state.accepting || state.active || state.unresolvedWrites || !Number.isSafeInteger(limit) || limit<1 || limit>50)
    throw new AppError('NOT_READY','Recovery is not quiescent or page exceeds limits.');
  const page=await sessions.listForRecovery(userId,{ cursor,limit });
  for (const row of page.items) await runtime.reconcileSession(userId,row.sessionId);
  return { processed:page.items.length,nextCursor:page.nextCursor };
}
