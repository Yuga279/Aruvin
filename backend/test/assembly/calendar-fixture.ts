/**
 * ============================================================================
 * FILE: calendar-fixture.ts
 * LOCATION: backend/test/assembly/calendar-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compose offline Calendar assembly tests over one shared v2 connection store.
 *
 * ROLE IN PROJECT:
 *    Uses scripted provider responses and the existing real runtime/MCP path.
 *    Makes bootstrap HTTP configuration match the AppService Calendar configuration.
 *
 * KEY COMPONENTS:
 *    - assembledCalendarApp: Shared-store, no-target assembly and bounded disposal.
 * ============================================================================
 */
import { vi } from 'vitest';
import { AppService, type AssemblyPorts } from '../../src/app.service.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import type { RuntimeDependencies } from '../../src/chat-runtime/ports.js';
import { CalendarSecretCipher } from '../../src/platform/crypto/calendar-secret-cipher.js';
import { tokenAad } from '../../src/plugins/google-calendar/connection.js';
import { parseCalendarSetupOptions } from '../../src/plugins/google-calendar/options.js';
import { CALENDAR_SCOPES } from '../../src/contracts/calendar-policy.js';
import { calendarConnectionV2Schema } from '../../src/contracts/calendar-discovery.js';
import { loadFixedAssets } from '../../src/instructions/fixed-assets.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { defaultManageableSettings } from '../../src/platform/config/manageable-config.js';
import { CredentialService } from '../../src/admin-config/credential-service.js';
import { CredentialValidator } from '../../src/admin-config/credential-validation.js';
import { document, at, secret } from '../admin-config/fixtures.js';
import { calendarLimits } from '../model/calendar-fixtures.js';
import { calendarFixture as runtimeCalendarFixture } from '../runtime/calendar-runtime.fixture.js';
import { admittedAccount, authFixture } from '../auth/fixtures.js';
import { assemblyFixture } from './admin-config-fixture.js';

const FRONTEND = 'http://127.0.0.1:5173';
const BACKEND = 'http://127.0.0.1:3000';
const TARGET = 'owned';
const USER = 'aurvin-dev-user';
const KEY = Buffer.alloc(32, 7);

export type AssembledCalendarInit = {
  /** Model limits loader; the default returns the fixture Calendar limits. */
  limits?: AssemblyPorts['limits'];
  /** Frozen Calendar capability evidence lookup for the configured model. */
  calendarEvidence?: AssemblyPorts['calendarEvidence'];
  /** Install a configured Calendar plugin (default true). */
  configured?: boolean;
  /** Seed a connected Google account record (default true). */
  connected?: boolean;
  /** Load checkout system.md and product_knowledge.md instead of synthetic assets. */
  realAssets?: boolean;
  /** Use emitted dist AppService and DurableChatRuntime together. */
  compiled?: boolean;
  writeLog?: AssemblyPorts['writeLog'];
};

export async function assembledCalendarApp(init: AssembledCalendarInit = {}) {
  const cal = runtimeCalendarFixture();
  const seeded = document(1);
  seeded.settings = defaultManageableSettings();
  seeded.settings.openRouter.modelId = 'fixture/model';
  if (init.realAssets) {
    // ponytail: fixture context 16384 is a byte-estimate ceiling; real checkout
    // assets plus native tool schemas exceed it. Stay within calendarLimits.contextTokens.
    seeded.settings.chat.maxContextTokens = calendarLimits.contextTokens;
  }
  const bootstrap = loadBootstrapConfig({
    NODE_ENV: 'development',
    FRONTEND_ORIGIN: FRONTEND,
    PERSISTENCE_PROFILE: 'native-mongodb',
    MONGODB_URI: 'fixture-injected-only',
    MONGODB_DB_NAME: 'aurvin_fixture',
    AURVIN_USER_ID: USER,
    AURVIN_CONFIG_ENCRYPTION_KEY: KEY.toString('base64'),
  });
  const credentials = new CredentialService(
    bootstrap.encryption, new CredentialValidator(vi.fn(async () => {
      throw new Error('fixture fetch is not stubbed for this URL');
    })),
  );
  seeded.credentials.openrouter = {
    envelope: credentials.seal('openrouter', secret), validatedAt: at,
  };
  const f = assemblyFixture(seeded);
  const close = vi.fn(async () => undefined);
  const Service = init.compiled
    ? (await import('../../dist/app.service.js')).AppService as unknown as typeof AppService : AppService;
  const Runtime = init.compiled
    ? (await import('../../dist/chat-runtime/durable-chat-runtime.js')).DurableChatRuntime as unknown as typeof DurableChatRuntime
    : DurableChatRuntime;
  const auth = await authFixture(admittedAccount({ userId: USER }));
  f.ports.authProvider = () => auth.provider;
  f.ports.open = vi.fn(async () => ({ ...cal.p, users: auth.users, ping: async () => true, close })) as never;
  // This hybrid fixture exercises the existing durable Calendar composition.
  // Native memory-first AppService composition is covered by memory-text-archive.spec.ts.
  f.ports.memoryFirstPolicy = null;
  f.ports.fetcher = cal.fetcher;
  f.ports.runtime = vi.fn((d: RuntimeDependencies) => new Runtime({ ...d, now: cal.clock }));
  f.ports.limits = init.limits ?? (vi.fn(async () => calendarLimits) as never);
  f.ports.calendarEvidence = init.calendarEvidence;
  if (init.configured !== false) {
    f.ports.calendarConfig = {
      setup: parseCalendarSetupOptions({
        initial: { enabled: true, processingPolicyId: 'fixture-policy' },
        oauth: {
          clientId: 'fixture-client-id',
          clientSecret: 'fixture-client-secret',
          redirectUri: `${BACKEND}/api/plugins/google-calendar/oauth/callback`,
        },
        frontendOrigin: FRONTEND,
        backendOrigin: BACKEND,
        evidence: 'fixture',
        realDataPolicyApproved: true,
      }),
      permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
      policyDeadlines: [Date.parse('2099-01-01T00:00:00.000Z')],
      trustedTimeZone: 'Etc/UTC',
    };
  }
  bootstrap.calendar = f.ports.calendarConfig ?? null;
  const cipher = new CalendarSecretCipher(bootstrap.encryption);
  const durable = await cal.p.calendarConnectionsV2.get(USER);
  if (!durable || durable.schemaVersion !== 2 || !durable.discovery) {
    throw new Error('The assembly fixture requires its seeded v2 connection.');
  }
  const aad = { userId: USER, connectionId: durable.connectionId,
    credentialVersion: durable.credentialVersion + 1, googleSubjectId: durable.googleSubjectId };
  const now = Date.now();
  const connected = init.connected !== false;
  const next = calendarConnectionV2Schema.parse({
    ...durable,
    revision: durable.revision + 1,
    connectionRevision: durable.connectionRevision + Number(!connected),
    credentialVersion: durable.credentialVersion + 1,
    enabled: connected,
    status: connected ? 'connected' : 'disconnected',
    credentials: connected ? {
      access: cipher.sealToken(tokenAad(aad, 'access'), 'fixture-access-token'),
      refresh: cipher.sealToken(tokenAad(aad, 'refresh'), 'fixture-refresh-token'),
    } : null,
    tokenExpiresAt: connected ? '2099-01-01T00:00:00.000Z' : null,
    grantedScopes: [...CALENDAR_SCOPES],
    updatedAt: new Date(now).toISOString(),
    discovery: connected ? {
      ...durable.discovery,
      discoveryRevision: durable.revision + 1,
      entries: durable.discovery.entries.map(entry => entry.primary
        ? { ...entry, calendarId: TARGET, label: 'Owned' } : entry),
      fetchedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 300000).toISOString(),
      retentionExpiresAt: new Date(now + 300000).toISOString(),
    } : null,
  });
  const seededConnection = await cal.p.calendarConnectionsV2.compareAndSwap({
    userId: USER,
    expectedRevision: durable.revision,
    expectedConnectionRevision: durable.connectionRevision,
    expectedDefaultSettingRevision: durable.defaultSetting.defaultSettingRevision,
    next,
  });
  if (seededConnection.outcome !== 'confirmed') {
    throw new Error('The assembly fixture connection was not confirmed.');
  }
  if (init.writeLog) f.ports.writeLog = init.writeLog;
  if (init.realAssets) f.ports.assets = () => loadFixedAssets({
    instructions: 'src/instructions/system.md', knowledge: '../product_knowledge.md',
  });
  const service = await Service.create(bootstrap, f.ports);
  await service.calendarFor(USER).connections.statusV2();
  return {
    bootstrap, f, service, cal, close, fetcher: cal.fetcher,
    dispose: async () => {
      await service.operations.shutdown();
      await cal.dispose();
    },
  };
}
