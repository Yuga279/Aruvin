/**
 * ============================================================================
 * FILE: text-critical-path.spec.ts
 * LOCATION: backend/test/performance/text-critical-path.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Check reuse of acknowledged accounting receipts on the live text path.
 * ROLE IN PROJECT:
 *    Exercises real runtime, ownership and repositories over the offline fake.
 * KEY COMPONENTS:
 *    - Sequential observation test: Prevents rereading known accounting revisions.
 * ============================================================================
 */
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { DependencyProbe } from './dependency-probe.js';
import { createLatencyFixture } from './latency-runtime-fixture.js';

it('forwards each confirmed accounting receipt to the next live observation', async () => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'text', probe, readMs: 67, writeMs: 449 });
  const save = vi.spyOn(MongoMetadata.prototype, 'putAccountingConfirmed');
  try {
    const ids = await probe.drive(() => fx.submit('Receipt reuse'), 67, 449);
    await probe.drive(() => fx.execute(ids), 67, 449);
    expect(save.mock.calls.length).toBeGreaterThan(2);
    for (let i = 1; i < save.mock.calls.length; i++) {
      const previous = await save.mock.results[i - 1].value;
      expect(save.mock.calls[i][1]).toBe(previous);
    }
    expect(fx.rawRuntime.snapshot().active).toBe(0);
  } finally {
    save.mockRestore();
    await fx.close();
  }
});
