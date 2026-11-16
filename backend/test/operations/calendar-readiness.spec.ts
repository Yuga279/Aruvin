import { OperationsService } from '../../src/operations/operations.service.js';
import { Readiness } from '../../src/operations/readiness.js';
import { observedRuntime } from '../../src/operations/observed-runtime.js';
import { Telemetry } from '../../src/operations/telemetry.js';
import { options } from './fixtures.js';

it('reports independent Calendar health without probing models or Google', async () => {
  const { o } = options();
  const modelProbe = vi.fn();
  const calendarProbe = vi.fn();
  o.calendarSnapshot = () => ({ state: 'degraded', enabled: true });
  const ops = new OperationsService(o);
  const state = await ops.readiness.read();
  expect(state).toMatchObject({ live: true, acceptReady: true,
    calendar: { state: 'degraded', enabled: true } });
  expect(modelProbe).not.toHaveBeenCalled();
  expect(calendarProbe).not.toHaveBeenCalled();
});

it.each([
  ['disabled', { state: 'disabled' as const, enabled: false }],
  ['setup-required', { state: 'setup-required' as const, enabled: true }],
  ['connected', { state: 'connected' as const, enabled: true }],
  ['reconnect-required', { state: 'reconnect-required' as const, enabled: true }],
  ['degraded', { state: 'degraded' as const, enabled: true }],
])('projects Calendar %s without changing text admission', async (_name, snapshot) => {
  const { o } = options();
  o.calendarSnapshot = () => snapshot;
  const state = await new Readiness(o).read();
  expect(state.calendar).toEqual(snapshot);
  expect(state.acceptReady).toBe(true);
  expect(state.live).toBe(true);
});

it('does not treat Calendar stream errors as OpenRouter provider failures', async () => {
  const { o, runtime } = options();
  const ready = new Readiness(o);
  vi.spyOn(runtime, 'executeTurn').mockImplementation(async c => {
    await c.emitCalendar?.({
      protocolVersion: 2, sessionId: 's1', turnId: 't1', attemptId: 'a1', sequence: 0,
      event: { type: 'error', code: 'NOT_READY', message: 'Calendar policy is unavailable.', retryable: false },
    });
  });
  const r = observedRuntime(o.runtime, new Telemetry(() => undefined), ready);
  await r.executeTurn({
    userId: 'server-user', sessionId: 's1', turnId: 't1', attemptId: 'a1',
    signal: new AbortController().signal,
    emit: async () => undefined,
    emitCalendar: async () => undefined,
  });
  expect(await ready.read()).toMatchObject({ live: true, acceptReady: true, provider: 'unknown' });
  expect(runtime.stopAccepting).not.toHaveBeenCalled();
});
