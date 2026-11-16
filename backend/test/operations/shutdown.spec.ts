/**
 * ============================================================================
 * FILE: shutdown.spec.ts
 * LOCATION: backend/test/operations/shutdown.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove stop-before-drain, retained sentinel, and repeat-safe shutdown.
 *
 * ROLE IN PROJECT:
 *    Locks the operations hook so false drain, hung drain, transport ownership,
 *    or failed close never release persistence or claim a clean exit.
 *
 * KEY COMPONENTS:
 *    - Order: stopAccepting, drain, then close only after true quiescence.
 *    - Deadlines: Hung drain skips close; diagnostic-only processes still close.
 * ============================================================================
 */

import { OperationsService } from '../../src/operations/operations.service.js';
import { options } from './fixtures.js';
it('stops before draining, closes only after true quiescence, and repeats once', async () => {
  const { o,runtime }=options(); const order:string[]=[];
  vi.spyOn(runtime,'stopAccepting').mockImplementation(() => { order.push('stop'); });
  vi.spyOn(runtime,'drain').mockImplementation(async () => {
    order.push('drain'); return { drained:true,active:0,unresolvedWrites:0 };
  });
  o.closePersistence=vi.fn(async () => { order.push('close'); });
  const ops=new OperationsService(o);
  expect(await ops.shutdown()).toEqual({ safe:true }); await ops.shutdown();
  expect(order).toEqual(['stop','drain','close']);
  expect(await ops.readiness.read()).toMatchObject({ acceptReady:false });
});
it('retains sentinel on unresolved work, failed close, or hung drain', async () => {
  const { o,runtime }=options();
  vi.spyOn(runtime,'drain').mockResolvedValue({ drained:false,active:1,unresolvedWrites:1 });
  expect(await new OperationsService(o).shutdown()).toEqual({ safe:false });
  expect(o.closePersistence).not.toHaveBeenCalled();
  vi.spyOn(runtime,'drain').mockResolvedValue({ drained:true,active:0,unresolvedWrites:0 });
  vi.mocked(o.closePersistence).mockRejectedValue(new Error('secret'));
  expect(await new OperationsService(o).shutdown()).toEqual({ safe:false });
});
it('returns unsafe after the exact drain deadline even if original promise never settles', async () => {
  vi.useFakeTimers();
  try {
    const { o,runtime }=options();
    vi.spyOn(runtime,'drain').mockReturnValue(new Promise(() => undefined));
    const result=new OperationsService(o).shutdown();
    await vi.advanceTimersByTimeAsync(o.config.budgets.shutdownDrainMs);
    expect(await result).toEqual({ safe:false }); expect(o.closePersistence).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
it('does not close persistence while the HTTP transport still owns an attachment', async () => {
  const { o }=options(); o.transportSnapshot=() => ({ active:1,backpressured:1 });
  expect(await new OperationsService(o).shutdown()).toEqual({ safe:false });
  expect(o.closePersistence).not.toHaveBeenCalled();
});
it('shuts down a diagnostic-only process with no fabricated graph', async () => {
  const { o }=options(); o.runtime=() => null;
  expect(await new OperationsService(o).shutdown()).toEqual({ safe:true });
  expect(o.closePersistence).toHaveBeenCalledTimes(1);
});
