/**
 * ============================================================================
 * FILE: config-snapshot.ts
 * LOCATION: backend/test/model/config-snapshot.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide deterministic in-memory RuntimeConfigSnapshot fixtures for testing.
 *
 * ROLE IN PROJECT:
 *    Shared fixture generator across P3 tests (model, context, runtime, HTTP).
 *    Constructs P1 snapshots without environment reads or network operations.
 *
 * KEY COMPONENTS:
 *    - textSnapshot: Builds a deep-frozen RuntimeConfigSnapshot with specified options.
 * ============================================================================
 */

import type { ChatLimits } from '../../src/contracts/admin-config-wire.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { buildRuntimeSnapshot, defaultManageableSettings }
  from '../../src/platform/config/manageable-config.js';

export function textSnapshot(revision = 1, chat: Partial<ChatLimits> = {},
  modelId = 'fixture/model', apiKey = 'fixture-key', userId = 'aurvin-dev-user') {
  const bootstrap = loadBootstrapConfig({ AURVIN_USER_ID: userId });
  const settings = defaultManageableSettings();
  settings.openRouter.modelId = modelId;
  Object.assign(settings.chat, chat);
  return buildRuntimeSnapshot(bootstrap, { revision, settings,
    credentials: { openrouter: apiKey || null, deepgram: null } },
    apiKey && modelId ? { modelId, contextTokens: 32768, outputTokens: 4096,
      supportsMaxTokens: true, source: 'fixture' } : null);
}
