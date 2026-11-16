/**
 * ============================================================================
 * FILE: readiness.spec.ts
 * LOCATION: backend/test/operations/readiness.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove live/read/accept separation, cache, and fail-closed dependency probes.
 *
 * ROLE IN PROJECT:
 *    Locks provider cooldown to admission only and keeps archive/status paths
 *    available while configuration, assets, and database gates fail closed.
 *
 * KEY COMPONENTS:
 *    - Cached probe: One DB/ownership call per five seconds, shared hang.
 *    - Provider outage: Degrades admission without stopAccepting or paid probes.
 * ============================================================================
 */

import { Readiness } from '../../src/operations/readiness.js';
import { options } from './fixtures.js';
it('separates live/read/accept readiness and caches one DB/ownership probe for five seconds', async () => {
  const { o } = options(); let now = 100; o.now = () => now;
  const r = new Readiness(o);
  const results = await Promise.all([r.read(),r.read(),r.read()]);
  expect(results[0]).toMatchObject({ live:true,readReady:true,acceptReady:true,provider:'unknown' });
  expect(o.ping).toHaveBeenCalledTimes(1); expect(o.assertExecutor).toHaveBeenCalledTimes(1);
  now += 4999; await r.read(); expect(o.ping).toHaveBeenCalledTimes(1);
  now += 1; await r.read(); expect(o.ping).toHaveBeenCalledTimes(2);
});
it('a provider outage keeps liveness/readiness for reads, invokes no provider and cools admission only', async () => {
  const { o, runtime } = options(); let now = 0; o.now = () => now;
  const r = new Readiness(o); r.providerFailure('PROVIDER_ERROR');
  expect(await r.read()).toMatchObject({ live:true,readReady:true,acceptReady:false,provider:'degraded' });
  expect(runtime.stopAccepting).not.toHaveBeenCalled();
  now = 30001; expect(await r.read()).toMatchObject({ acceptReady:true,provider:'unknown' });
  r.providerFailure('PROVIDER_AUTH'); now += 600000;
  expect(await r.read()).toMatchObject({ acceptReady:false,provider:'blocked' });
});
it('missing assets/model/runtime, unverified DB and DB failure fail closed, not live', async () => {
  const { o } = options(); o.assetsReady = () => false; o.modelLimitsReady = () => false; o.runtime = () => null;
  o.config.persistence.mongoUri = '';
  const r = new Readiness(o);
  expect(await r.read()).toMatchObject({ live:true,acceptReady:false });
  expect(o.ping).not.toHaveBeenCalled();
  const good = options(); vi.mocked(good.o.ping).mockResolvedValue(false);
  expect(await new Readiness(good.o).read()).toMatchObject({ live:true,readReady:false,acceptReady:false });
});
it('missing provider configuration does not pretend the working archive database is down', async () => {
  const { o }=options(); o.config.openRouter.apiKey='';
  expect(await new Readiness(o).read()).toMatchObject({ live:true,readReady:true,acceptReady:false });
});
it('bounds hung readiness while retaining one outstanding dependency probe', async () => {
  vi.useFakeTimers();
  try {
    const { o } = options(); vi.mocked(o.ping).mockReturnValue(new Promise(() => undefined));
    const r = new Readiness(o); const first = r.read();
    await vi.advanceTimersByTimeAsync(1000); expect(await first).toMatchObject({ acceptReady:false });
    const second = r.read(); await vi.advanceTimersByTimeAsync(1000); await second;
    expect(o.ping).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
