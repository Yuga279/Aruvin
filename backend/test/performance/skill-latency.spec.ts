/**
 * ============================================================================
 * FILE: skill-latency.spec.ts
 * LOCATION: backend/test/performance/skill-latency.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Record modeled cold and warm skill task latency through the stock runtime.
 *
 * ROLE IN PROJECT:
 *    Reuses the existing DependencyProbe/BSON-fake latency fixture over real
 *    repositories and the stock saver; assumptions are explicit and provider
 *    latency remains unavailable.
 *
 * KEY COMPONENTS:
 *    - Cold activation plus execution and warm execution-only measurements.
 *    - Stock-saver write and zero-plugin-effect assertions.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { DependencyProbe } from './dependency-probe.js';
import { createLatencyFixture } from './latency-runtime-fixture.js';
import { loadWire, callWire, textWire } from '../assembly/skill-fixture.js';

it('records cold and warm task latency through stock repositories and saver', async () => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
  try {
    fx.calendar!.modelWires.push(loadWire(['calendar_list_calendars'], 'latency-load'),
      callWire('calendar_list_calendars', {}, 'latency-cold'), textWire('Listed.'));
    const cold = await fx.measure(async () => {
      const ids = await fx.submit('List calendars.');
      await fx.execute(ids);
      return ids;
    });
    expect(fx.modelCalls).toHaveLength(3);
    const offset = fx.modelCalls.length;
    fx.calendar!.modelWires.push(callWire('calendar_list_calendars', {}, 'latency-warm'), textWire('Listed again.'));
    const warm = await fx.measure(async () => {
      const ids = await fx.submit('List them again.', cold.result.sessionId);
      await fx.execute(ids);
      return ids;
    });
    expect(fx.modelCalls.length - offset).toBe(2);
    for (const row of [cold, warm]) {
      expect(await fx.run(() => fx.persistence.metadata.getAttempt(fx.identity.userId,
        row.result.sessionId, row.result.attemptId))).toMatchObject({ status: 'completed' });
      expect(row.metrics.wireFailed).toBe(0);
      expect(row.metrics.saverWrites).toBeGreaterThan(0);
      expect(row.metrics.elapsedMs).toBeGreaterThan(0);
    }
    expect(fx.googleEffects).toHaveLength(0);
    console.log('SKILL_STORAGE_LATENCY', JSON.stringify({ assumptions: { readMs: 67, writeMs: 449,
      modelDelayMs: 0, pluginDelayMs: 0 }, cold: cold.metrics, warm: warm.metrics,
      providerLatencyMs: null, nativeMongoLatencyMs: null }));
  } finally { await fx.close(); }
});
