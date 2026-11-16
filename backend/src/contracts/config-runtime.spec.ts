/**
 * ============================================================================
 * FILE: config-runtime.spec.ts
 * LOCATION: backend/src/contracts/config-runtime.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compile and check snapshot ports without implying retry or reconnect behavior.
 *
 * ROLE IN PROJECT:
 *    Demonstrates that captured snapshots stay isolated after the current
 *    configuration pointer advances to a newer revision.
 *
 * KEY COMPONENTS:
 *    - Fake CurrentConfigPort / ConfigActivationPort examples.
 *    - Actor assumption compile-time shape check.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import type {
  AdminConfigActor,
  ConfigActivationPort,
  ConfigRepository,
  CurrentConfigPort,
  RuntimeConfigSnapshot,
} from './config-runtime.js';
import { storedConfigDocumentSchema } from './admin-config.js';
import { loadBootstrapConfig } from '../platform/config/bootstrap-config.js';
import {
  buildRuntimeSnapshot,
  defaultManageableSettings,
} from '../platform/config/manageable-config.js';

function snapshotAt(revision: number): RuntimeConfigSnapshot {
  const settings = defaultManageableSettings();
  settings.openRouter.modelId = 'fixture/model';
  return buildRuntimeSnapshot(
    loadBootstrapConfig({}),
    {
      revision,
      settings,
      credentials: { openrouter: 'fixture-A', deepgram: null },
    },
    {
      modelId: 'fixture/model',
      contextTokens: 32768,
      outputTokens: 4096,
      supportsMaxTokens: true,
      source: 'fixture',
    },
  );
}

describe('config runtime ports', () => {
  it('keeps a captured snapshot after the current pointer advances', async () => {
    const revision3 = snapshotAt(3);
    const revision4 = snapshotAt(4);
    let current: RuntimeConfigSnapshot | null = revision3;
    const port: CurrentConfigPort = { current: () => current };
    const activation: ConfigActivationPort = {
      prepare: async (candidate) => snapshotAt(candidate.revision),
      publish: (snapshot) => {
        current = snapshot;
      },
    };
    const captured = port.current();
    const prepared = await activation.prepare({
      revision: 4,
      settings: defaultManageableSettings(),
      credentials: { openrouter: null, deepgram: null },
    });
    expect(prepared.revision).toBe(4);
    activation.publish(revision4);
    expect(captured?.revision).toBe(3);
    expect(port.current()?.revision).toBe(4);
  });

  it('stamps a server-side admin actor without a client role assertion', () => {
    const actor: AdminConfigActor = {
      identity: {
        userId: 'aurvin-dev-user',
        source: 'server-configured',
        openRouterUser: 'aurvin-dev-user',
      },
      assumption: {
        role: 'super-admin',
        authentication: 'disabled',
        source: 'server-configured-development',
      },
    };
    expect(actor.assumption.authentication).toBe('disabled');
    expect(actor.identity.source).toBe('server-configured');
  });

  it('records CAS outcomes without guessing a revision', async () => {
    const document = storedConfigDocumentSchema.parse({
      _id: 'aurvin', schemaVersion: 1, revision: 2, settings: defaultManageableSettings(),
      credentials: { openrouter: null, deepgram: null },
      updatedAt: '2026-10-13T00:00:00.000Z', updatedBy: 'aurvin-dev-user',
    });
    const repo: ConfigRepository = {
      read: async () => document,
      createIfAbsent: async () => ({ outcome: 'conflict', currentRevision: document.revision }),
      compareAndSwap: async (expected) => expected === document.revision
        ? { outcome: 'confirmed', document }
        : { outcome: 'uncertain' },
    };
    expect((await repo.createIfAbsent(document)).outcome).toBe('conflict');
    expect((await repo.compareAndSwap(1, document)).outcome).toBe('uncertain');
    expect((await repo.compareAndSwap(2, document)).outcome).toBe('confirmed');
  });
});
