/**
 * ============================================================================
 * FILE: recovery.spec.ts
 * LOCATION: backend/test/operations/recovery.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove operator recovery is quiescent, paged, and never infers.
 *
 * ROLE IN PROJECT:
 *    Keeps handoff and reconciliation as maintenance helpers without HTTP
 *    admin routes, lease-expiry proof, or execute/submit during repair.
 *
 * KEY COMPONENTS:
 *    - reconcilePage: Bounded original sessions, refusing active/accepting work.
 *    - handoffVerifiedStopped: Requires operator-verified stopped-process proof.
 * ============================================================================
 */

import { reconcilePage,handoffVerifiedStopped } from '../../src/operations/recovery.js';
import { options } from './fixtures.js';
import { session } from '../persistence/fixtures.js';
it('reconciles bounded original sessions without execute/submit or unbounded scanning', async () => {
  const { runtime }=options();
  vi.spyOn(runtime,'snapshot').mockReturnValue({ accepting:false,active:0,unresolvedWrites:0,degraded:false });
  const list=vi.fn(async () => ({
    items:[session('u','s1')],nextCursor:'next' }));
  const result=await reconcilePage(runtime,{ listForRecovery:list },'u',null,10);
  expect(result).toEqual({ processed:1,nextCursor:'next' });
  expect(runtime.reconcileSession).toHaveBeenCalledWith('u','s1');
  expect(runtime.executeTurn).not.toHaveBeenCalled(); expect(runtime.submitTurn).not.toHaveBeenCalled();
  expect(list).toHaveBeenCalledWith('u',{ cursor:null,limit:10 });
});
it('refuses reconciliation while active or unresolved work exists', async () => {
  const { runtime }=options(); vi.spyOn(runtime,'snapshot').mockReturnValue({ accepting:false,
    active:0,unresolvedWrites:1,degraded:true });
  await expect(reconcilePage(runtime,{ listForRecovery:async () => ({ items:[],nextCursor:null }) },'u',null,10))
    .rejects.toMatchObject({ code:'NOT_READY' });
});
it('requires stopped acceptance for administrative paging, not merely a momentarily idle runtime', async () => {
  const { runtime }=options();
  await expect(reconcilePage(runtime,{ listForRecovery:async () => ({ items:[],nextCursor:null }) },'u',null,10))
    .rejects.toMatchObject({ code:'NOT_READY' });
});
it('does not accept expiry or false stopped-process proof as handoff authorization', async () => {
  const { runtime }=options(); const owner={ handoffStoppedExecutor:vi.fn(async () => undefined) };
  await expect(handoffVerifiedStopped(owner,runtime,'old-owner',{
    oldProcessStopped:false,inFlightIoSettled:true,operatorAuthorized:true,
  })).rejects.toMatchObject({ code:'NOT_READY' });
  expect(owner.handoffStoppedExecutor).not.toHaveBeenCalled();
  expect(runtime.allowStoppedOwner).not.toHaveBeenCalled();
  await handoffVerifiedStopped(owner,runtime,'old-owner',{
    oldProcessStopped:true,inFlightIoSettled:true,operatorAuthorized:true,
  });
  expect(owner.handoffStoppedExecutor).toHaveBeenCalledWith('old-owner');
  expect(runtime.allowStoppedOwner).toHaveBeenCalledWith('old-owner');
});
