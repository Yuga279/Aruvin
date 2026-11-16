import { OperationsService } from '../../src/operations/operations.service.js';
import { options } from './fixtures.js';

it('stops Calendar admission before text drain and closes persistence once', async () => {
  const { o, runtime } = options();
  const order: string[] = [];
  o.stopCalendar = () => { order.push('calendar-stop'); };
  o.drainCalendar = async () => {
    order.push('calendar-drain');
    return { drained: true, active: 0, unresolvedWrites: 0 };
  };
  vi.spyOn(runtime, 'stopAccepting').mockImplementation(() => { order.push('text-stop'); });
  vi.spyOn(runtime, 'drain').mockImplementation(async () => {
    order.push('text-drain');
    return { drained: true, active: 0, unresolvedWrites: 0 };
  });
  o.closePersistence = vi.fn(async () => { order.push('persistence-close'); });
  const ops = new OperationsService(o);
  await expect(ops.shutdown()).resolves.toEqual({ safe: true });
  await ops.shutdown();
  expect(order.indexOf('calendar-stop')).toBeLessThan(order.indexOf('text-drain'));
  expect(order.indexOf('calendar-drain')).toBeLessThan(order.indexOf('persistence-close'));
  expect(o.closePersistence).toHaveBeenCalledTimes(1);
});

it('does not close persistence while Calendar drain is still active', async () => {
  const { o, runtime } = options();
  vi.spyOn(runtime, 'drain').mockResolvedValue({ drained: true, active: 0, unresolvedWrites: 0 });
  o.drainCalendar = async () => ({ drained: false, active: 1, unresolvedWrites: 0 });
  o.closePersistence = vi.fn(async () => undefined);
  const ops = new OperationsService(o);
  await expect(ops.shutdown()).resolves.toEqual({ safe: false });
  expect(o.closePersistence).not.toHaveBeenCalled();
});
