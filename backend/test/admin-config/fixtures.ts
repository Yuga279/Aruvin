/**
 * ============================================================================
 * FILE: fixtures.ts
 * LOCATION: backend/test/admin-config/fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide deterministic offline factories for admin configuration tests.
 *
 * ROLE IN PROJECT:
 *    Lets service and API specs compose P2 owners without MongoDB, live
 *    providers, or private environment files.
 *
 * KEY COMPONENTS:
 *    - bootstrap/actor/document: Fixed development identity and stored shape.
 *    - serviceFixture: In-memory repository, activation, and injected fetch.
 * ============================================================================
 */

import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { defaultManageableSettings, buildRuntimeSnapshot } from '../../src/platform/config/manageable-config.js';
import type { StoredConfigDocument } from '../../src/contracts/admin-config.js';
import type { AdminConfigActor, ConfigCasResult, ConfigRepository, RuntimeConfigSnapshot } from '../../src/contracts/config-runtime.js';
import { CredentialService } from '../../src/admin-config/credential-service.js';
import { CredentialValidator } from '../../src/admin-config/credential-validation.js';
import { AdminConfigService } from '../../src/admin-config/admin-config.service.js';
import { vi } from 'vitest';

export const at = '2026-10-13T12:00:00.000Z';
export const secret = 'fixture-key-never-send-live';
export const bootstrap = loadBootstrapConfig({
  NODE_ENV: 'development', FRONTEND_ORIGIN: 'http://localhost:5173',
  AURVIN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});
export const actor: AdminConfigActor = {
  identity: { userId: 'aurvin-dev-user', openRouterUser: 'aurvin-dev-user', source: 'authenticated-session' },
  assumption: { role: 'super-admin', authentication: 'session', source: 'local-account' },
};
export function document(revision = 1): StoredConfigDocument {
  return {
    _id: 'aurvin', schemaVersion: 1, revision, settings: defaultManageableSettings(),
    credentials: { openrouter: null, deepgram: null }, updatedAt: at, updatedBy: actor.identity.userId,
  };
}
export function serviceFixture(
  initial: StoredConfigDocument | null = document(),
  now: () => number = () => Date.parse(at),
) {
  let stored = initial === null ? null : structuredClone(initial);
  let active: RuntimeConfigSnapshot | null = null;
  const repository: ConfigRepository = {
    read: vi.fn(async () => stored === null ? null : structuredClone(stored)),
    createIfAbsent: vi.fn(async next => {
      if (stored) return { outcome: 'conflict', currentRevision: stored.revision } as ConfigCasResult;
      stored = structuredClone(next); return { outcome: 'confirmed', document: structuredClone(next) };
    }),
    compareAndSwap: vi.fn(async (expected, next) => {
      if (stored?.revision !== expected) return { outcome: 'conflict', currentRevision: stored?.revision ?? 0 } as ConfigCasResult;
      stored = structuredClone(next); return { outcome: 'confirmed', document: structuredClone(next) };
    }),
  };
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ data: { label: 'discard-me', limit: null, usage: 0, is_free_tier: true } }));
  const credentials = new CredentialService(bootstrap.encryption, new CredentialValidator(fetchImpl));
  const activation = {
    prepare: vi.fn(async candidate => buildRuntimeSnapshot(bootstrap, candidate, null)),
    publish: vi.fn((snapshot: RuntimeConfigSnapshot) => { active = snapshot; }),
  };
  const assertWritable = vi.fn(async () => undefined);
  const service = new AdminConfigService({
    bootstrap, repository, credentials, activation,
    current: { current: () => active }, assertWritable, now,
  });
  return {
    service, repository, credentials, activation, assertWritable, fetchImpl,
    stored: () => stored, active: () => active,
  };
}
