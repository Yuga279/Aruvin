/**
 * ============================================================================
 * FILE: admin-config-fixture.ts
 * LOCATION: backend/test/assembly/admin-config-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Supply one offline assembly fixture for central config behavior tests.
 *
 * ROLE IN PROJECT:
 *    Lets P6 specs drive AppService preparation, publication, drain, and the
 *    explicit import command without MongoDB, live providers, or .env files.
 *
 * KEY COMPONENTS:
 *    - assemblyFixture: Native-profile bootstrap plus in-memory config store.
 *    - deferred: Controllable promises for in-flight write and drain tests.
 * ============================================================================
 */

import { vi } from 'vitest';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import type { StoredConfigDocument } from '../../src/contracts/admin-config.js';
import type {
  ConfigCasResult,
  ConfigRepository,
  RuntimeConfigSnapshot,
} from '../../src/contracts/config-runtime.js';
import { CredentialService } from '../../src/admin-config/credential-service.js';
import { CredentialValidator } from '../../src/admin-config/credential-validation.js';
import type { AssemblyPorts } from '../../src/app.service.js';
import type { OpenedPersistence } from '../../src/app.service.js';
import { fixtureOptions } from '../http/fixtures.js';
import { providerFixture } from '../auth/fixtures.js';
import { assets } from '../context/fixtures.js';
import { connectionFixture } from '../plugins/google-calendar/connection-fixtures.js';

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export type AssemblyFixture = ReturnType<typeof assemblyFixture>;

export function assemblyFixture(initial: StoredConfigDocument | null = null) {
  const bootstrap = loadBootstrapConfig({
    NODE_ENV: 'development',
    FRONTEND_ORIGIN: 'http://localhost:5173',
    PERSISTENCE_PROFILE: 'native-mongodb',
    MONGODB_URI: 'fixture-injected-only',
    MONGODB_DB_NAME: 'aurvin_fixture',
    AURVIN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
  let stored: StoredConfigDocument | null =
    initial === null ? null : structuredClone(initial);
  const logs: string[] = [];
  const http = fixtureOptions();
  const raw = http.runtime;

  const repository: ConfigRepository = {
    read: vi.fn(async () => (stored === null ? null : structuredClone(stored))),
    createIfAbsent: vi.fn(async (document: StoredConfigDocument): Promise<ConfigCasResult> => {
      if (stored) return { outcome: 'conflict', currentRevision: stored.revision };
      stored = structuredClone(document);
      return { outcome: 'confirmed', document: structuredClone(document) };
    }),
    compareAndSwap: vi.fn(
      async (expected: number, document: StoredConfigDocument): Promise<ConfigCasResult> => {
        if (stored?.revision !== expected)
          return { outcome: 'conflict', currentRevision: stored?.revision ?? 0 };
        stored = structuredClone(document);
        return { outcome: 'confirmed', document: structuredClone(document) };
      },
    ),
  };

  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error('fixture fetch is not stubbed for this URL');
  });
  const credentials = new CredentialService(
    bootstrap.encryption,
    new CredentialValidator(fetcher),
  );
  const close = vi.fn(async () => undefined);
  const unused = () => {
    throw new Error('Unused fixture port');
  };
  const fakeCollection = { findOne: vi.fn(async () => null) };
  const storeCollection = vi.fn((_name: string) => fakeCollection);
  const controlCollection = vi.fn((_name: string): never => {
    throw new Error('controlStore must not back config data');
  });
  const owner = {
    store: { db: { collection: storeCollection }, options: () => ({}), timeoutMs: 1000 } as never,
    controlStore: { db: { collection: controlCollection } } as never,
    assertExecutor: vi.fn(async () => undefined),
    observedExecutor: vi.fn(async () => ({ record: {} })),
    drain: vi.fn(async () => ({ drained: true, active: 0 })),
  };
  const calendarConnections = connectionFixture().store;
  const bundle = {
    sessions: http.sessions,
    messages: http.messages,
    memory: { get: unused, put: unused },
    metadata: {
      putAttempt: unused,
      getAttempt: unused,
      getAttemptByIdempotency: unused,
      putAccounting: unused,
      putVoiceAccounting: unused,
    },
    checkpoints: { create: unused },
    calendarConnections,
    calendarConnectionsV2: calendarConnections.v2,
    owner,
    ping: vi.fn(async () => true),
    close,
  };
  const open = vi.fn(async () => bundle);
  const limits = vi.fn(async (c: { openRouter: { modelId: string } }) => ({
    modelId: c.openRouter.modelId,
    contextTokens: 32768,
    outputTokens: 4096,
    supportsMaxTokens: true as const,
    source: 'fixture' as const,
  }));
  const runtime = vi.fn((_dependencies: unknown) => raw as never);

  const ports: AssemblyPorts = {
    open: open as never,
    assets: vi.fn(async () => assets) as AssemblyPorts['assets'],
    limits: limits as never,
    runtime: runtime as never,
    fetcher: fetcher as never,
    writeLog: (line: string) => {
      logs.push(line);
    },
    configRepository: (_opened: OpenedPersistence) => repository,
    authProvider: () => providerFixture(),
  };

  return {
    bootstrap,
    ports,
    repository,
    credentials,
    stored: () => (stored === null ? null : structuredClone(stored)),
    seed: (document: StoredConfigDocument | null) => {
      stored = document === null ? null : structuredClone(document);
    },
    open,
    limits,
    runtime,
    close,
    raw,
    logs,
    assets,
    fetcher,
    owner,
    bundle,
    storeCollection,
    controlCollection,
    fakeCollection,
  };
}

export type { RuntimeConfigSnapshot };
