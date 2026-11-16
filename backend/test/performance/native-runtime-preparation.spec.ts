/**
 * ============================================================================
 * FILE: native-runtime-preparation.spec.ts
 * LOCATION: backend/test/performance/native-runtime-preparation.spec.ts
 * PURPOSE: Exercise native harness assembly using BSON fakes, never a connection.
 * ROLE IN PROJECT: Checks measurement boundary plumbing, not native performance.
 * KEY COMPONENTS: Mocked database opener; real runtime and fake command source.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import type { MongoClient } from 'mongodb';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { textWire } from '../runtime/calendar-runtime.fixture.js';
import { openNativePerformanceDatabase } from './native-database.js';
import { nativeLatencyFixture } from './native-runtime.js';

vi.mock('./native-database.js', () => ({ openNativePerformanceDatabase: vi.fn() }));

it.each(['text', 'calendar'] as const)('prepares %s boundary plumbing entirely offline', async path => {
  const name = 'offline-native-preparation';
  const memory = calendarMemory(undefined, { databaseName: name });
  Object.assign(memory.store.db, { command: async () => ({ ok: 1 }) });
  const client = Object.assign(memory.commandSource, {
    appendMetadata: () => undefined, db: () => memory.store.db,
  }) as unknown as MongoClient;
  let cleaned = false;
  vi.mocked(openNativePerformanceDatabase).mockResolvedValue({
    client, db: memory.store.db, name,
    provenance: { revision: 'a'.repeat(40), label: 'current', samples: 1 },
    close: async () => { cleaned = true; },
  });
  const fx = await nativeLatencyFixture(path);
  try {
    if (fx.calendar) fx.calendar.modelWires.push(textWire('Offline only.'));
    const { metrics } = await fx.measure(async () => {
      const ids = await fx.fixture.submit('Offline preparation');
      await fx.execute(ids);
      return ids;
    });
    for (const name of ['dispatch', 'firstAnswer', 'seal', 'release', 'terminal', 'settled']) {
      expect(metrics.milestones[name], name).toBeGreaterThanOrEqual(0);
    }
    expect(metrics).toMatchObject({ pending: 0, unmatched: 0, failed: 0 });
    expect(fx.fixture.runtime.snapshot()).toMatchObject({ active: 0, unresolvedWrites: 0, degraded: false });
    expect((await fx.readyAfterCleanup()).acceptReady).toBe(true);
  } finally { await fx.close(); }
  expect(cleaned).toBe(true);
});
