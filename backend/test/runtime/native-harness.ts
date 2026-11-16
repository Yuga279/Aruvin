/**
 * ============================================================================
 * FILE: native-harness.ts
 * LOCATION: backend/test/runtime/native-harness.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compose an isolated native MongoDB runtime with fixture OpenRouter fetch.
 *
 * ROLE IN PROJECT:
 *    Supplies P5 native e2e tests with a generated database, real P2 bundle,
 *    P3 assembler, and fake P4 fetch without reading application .env files.
 *
 * KEY COMPONENTS:
 *    - nativeHarness: Isolated DB, persistence, assembler, identity, fetcher.
 * ============================================================================
 */

import { nativeDatabase } from '../persistence/native.js';
import { createPersistenceBundle } from '../../src/persistence/index.js';
import { loadConfig } from '../../src/platform/config/load-config.js';
import { createContextAssembler } from '../../src/context/index.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';
import { textSnapshot } from '../model/config-snapshot.js';
export async function nativeHarness(text: string = FRAMES.normal) {
  const db = await nativeDatabase();
  const config = loadConfig({ AURVIN_USER_ID: 'aurvin-dev-user', OPENROUTER_API_KEY: 'fixture-key',
    OPENROUTER_MODEL: 'fixture/model', PERSISTENCE_PROFILE: 'native-mongodb' });
  const persistence = await createPersistenceBundle(db.client, db.name, config.budgets, 'p5-executor');
  const context = await createContextAssembler({ memory: persistence.memory, messages: persistence.messages,
    budgets: config.budgets, paths: { instructions: new URL('../../src/instructions/system.md', import.meta.url),
      knowledge: new URL('../../../product_knowledge.md', import.meta.url) } });
  let generation = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
    generation += 1;
    return new Response(text.replaceAll('gen_fixture', `gen_fixture_${generation}`),
      { headers: { 'content-type': 'text/event-stream' } });
  });
  const snapshot = textSnapshot(1, {}, 'fixture/model', 'fixture-key', config.identity.userId);
  const currentConfig = { current: () => snapshot };
  const deps = { config, persistence, ...context, limits: snapshot.modelLimits ?? { modelId: 'fixture/model', contextTokens: 32768,
    outputTokens: 4096, supportsMaxTokens: true, source: 'fixture' as const }, currentConfig, fetcher };
  const identity = { userId: config.identity.userId, openRouterUser: config.identity.userId, source: 'authenticated-session' as const };
  return { db, deps, persistence, fetcher, identity, currentConfig, close: () => db.close() };
}
