/**
 * ============================================================================
 * FILE: fixtures.ts
 * LOCATION: backend/test/operations/fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Supply typed local operations dependencies for deterministic P8 tests.
 *
 * ROLE IN PROJECT:
 *    Reuses existing HTTP runtime fakes so operations tests never construct a
 *    provider, database, or extra executor while remaining type-aligned.
 *
 * KEY COMPONENTS:
 *    - options: Configured OperationsOptions with a fake runtime and log sink.
 * ============================================================================
 */

import type { OperationsOptions } from '../../src/operations/options.js';
import { loadConfig } from '../../src/platform/config/load-config.js';
import { fixtureOptions } from '../http/fixtures.js';
export function options() {
  const runtime = fixtureOptions().runtime;
  const lines: string[] = [];
  const o: OperationsOptions = {
    config: loadConfig({ PERSISTENCE_PROFILE:'native-mongodb', MONGODB_URI:'mongodb://fixture',
      OPENROUTER_API_KEY:'sk-fixture', OPENROUTER_MODEL:'fixture/model' }),
    runtime: () => runtime, assetsReady: () => true, modelLimitsReady: () => true,
    ping: vi.fn(async () => true), assertExecutor: vi.fn(async () => undefined),
    closePersistence: vi.fn(async () => undefined),
    transportSnapshot: () => ({ active:0, backpressured:0 }), writeLog: line => { lines.push(line); },
  };
  return { o, runtime, lines };
}
