/**
 * ============================================================================
 * FILE: connection-fixtures.ts
 * LOCATION: backend/test/plugins/google-calendar/connection-fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Test harness and in-memory stores for Google Calendar connection tests.
 *
 * ROLE IN PROJECT:
 *    Provides deterministic in-memory v1 and v2 stores, mock OAuth clients,
 *    and grant installation fixtures for connection and refresh testing.
 *
 * KEY COMPONENTS:
 *    - MemoryCalendarStore: In-memory store supporting v1 and v2 CAS operations
 *    - connectionFixture: Complete fixture for connection lifecycle tests
 *    - refreshFixture: Specialized harness for coalesced token refresh tests
 * ============================================================================
 */

import {
  connectionRecordSchema,
  oauthStateSchema,
  type CalendarConnectionCas,
  type CalendarConnectionRecord,
  type CalendarConnectionStore,
  type CalendarOAuthState,
  type CalendarTargetPort,
} from '../../../src/contracts/calendar-connections.js';
import {
  calendarConnectionV2Schema,
  type CalendarConnectionRecordV2,
  type CalendarConnectionStoreV2,
} from '../../../src/contracts/calendar-discovery.js';

import { CalendarSecretCipher } from '../../../src/platform/crypto/calendar-secret-cipher.js';
import { CALENDAR_SCOPES } from '../../../src/contracts/calendar-policy.js';
import {
  GoogleCalendarConnections,
  type ConnectionDependencies,
} from '../../../src/plugins/google-calendar/connection.js';
import {
  parseCalendarSetupOptions,
  type CalendarSetupOptions,
} from '../../../src/plugins/google-calendar/options.js';

export type StoreCall = { method: string; userId: string };
export type Invalidation = {
  binding: { userId: string; connectionId: string; connectionRevision: number;
    googleSubjectId: string; calendarId: string; targetRevision: number };
  reason: 'disconnect' | 'replacement' | 'disabled' | 'reconnect-required';
};

export type ConnectionFixtureInit = {
  configured?: boolean;
  enabled?: boolean;
  evidence?: 'google' | 'fixture';
  encryption?: boolean;
  policy?: boolean;
  targetCalendarId?: string;
  frontendOrigin?: string;
  backendOrigin?: string;
  redirectUri?: string;
};

const POLICY_ID = 'fixture-policy';
const OWNED_TARGET = 'owned-a';
const FRONTEND = 'http://127.0.0.1:5173';
const BACKEND = 'http://127.0.0.1:3000';
const REDIRECT = `${BACKEND}/api/plugins/google-calendar/oauth/callback`;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class MemoryCalendarStore implements CalendarConnectionStore {
  record: CalendarConnectionRecord | CalendarConnectionRecordV2 | null = null;
  readonly states = new Map<string, CalendarOAuthState>();
  readonly calls: StoreCall[] = [];
  nextCas: 'conflict' | 'uncertain' | null = null;
  consumeAck: 'ok' | 'null' | 'throw' | 'uncertain' = 'ok';
  failPut = false;

  readonly v2: CalendarConnectionStoreV2 = {
    get: async (userId: string) => {
      this.calls.push({ method: 'get', userId });
      return this.record?.userId === userId ? clone(this.record) : null;
    },
    create: async (record: CalendarConnectionRecordV2) => {
      this.calls.push({ method: 'create', userId: record.userId });
      if (this.nextCas) {
        const outcome = this.nextCas;
        this.nextCas = null;
        if (outcome === 'conflict') {
          return {
            outcome,
            currentRevision: this.record?.revision ?? 0,
            currentDefaultSettingRevision: this.record && 'defaultSetting' in this.record ? this.record.defaultSetting.defaultSettingRevision : 1,
          };
        }
        return { outcome };
      }
      if (this.record) {
        return {
          outcome: 'conflict',
          currentRevision: this.record.revision,
          currentDefaultSettingRevision: 'defaultSetting' in this.record ? this.record.defaultSetting.defaultSettingRevision : 1,
        };
      }
      this.record = clone(record);
      return { outcome: 'confirmed', record: clone(this.record) };
    },
    compareAndSwap: async (input) => {
      this.calls.push({ method: 'compareAndSwap', userId: input.userId });
      if (this.nextCas) {
        const outcome = this.nextCas;
        this.nextCas = null;
        if (outcome === 'conflict') {
          return {
            outcome,
            currentRevision: this.record?.revision ?? 0,
            currentDefaultSettingRevision: this.record && 'defaultSetting' in this.record ? this.record.defaultSetting.defaultSettingRevision : 1,
          };
        }
        return { outcome };
      }
      if (!this.record || this.record.userId !== input.userId || this.record.revision !== input.expectedRevision) {
        return {
          outcome: 'conflict',
          currentRevision: this.record?.revision ?? 0,
          currentDefaultSettingRevision: this.record && 'defaultSetting' in this.record ? this.record.defaultSetting.defaultSettingRevision : 1,
        };
      }
      this.record = clone(input.next);
      return { outcome: 'confirmed', record: clone(this.record) };
    },
  };

  async get(userId: string): Promise<CalendarConnectionRecord | null> {
    this.calls.push({ method: 'get', userId });
    return this.record?.userId === userId ? clone(this.record) : null;
  }

  async create(record: CalendarConnectionRecord): Promise<CalendarConnectionCas> {
    this.calls.push({ method: 'create', userId: record.userId });
    if (this.nextCas) {
      const outcome = this.nextCas;
      this.nextCas = null;
      if (outcome === 'conflict') {
        return { outcome, currentRevision: this.record?.revision ?? 0 };
      }
      return { outcome };
    }
    if (this.record) {
      return { outcome: 'conflict', currentRevision: this.record.revision };
    }
    this.record = clone(record);
    return { outcome: 'confirmed', record: clone(this.record) };
  }

  async compareAndSwap(
    userId: string,
    expectedRevision: number,
    next: CalendarConnectionRecord,
  ): Promise<CalendarConnectionCas> {
    this.calls.push({ method: 'compareAndSwap', userId });
    if (this.nextCas) {
      const outcome = this.nextCas;
      this.nextCas = null;
      if (outcome === 'conflict') {
        return { outcome, currentRevision: this.record?.revision ?? 0 };
      }
      return { outcome };
    }
    if (!this.record || this.record.userId !== userId || this.record.revision !== expectedRevision) {
      return { outcome: 'conflict', currentRevision: this.record?.revision ?? 0 };
    }
    this.record = clone(next);
    return { outcome: 'confirmed', record: clone(this.record) };
  }

  async putState(record: CalendarOAuthState): Promise<void> {
    this.calls.push({ method: 'putState', userId: record.userId });
    if (this.failPut) {
      this.failPut = false;
      throw new Error('putState failed');
    }
    this.states.set(`${record.userId}:${record.stateHash}`, clone(record));
  }

  async consumeState(input: {
    userId: string; stateHash: string; browserHash: string; now: string;
  }): Promise<CalendarOAuthState | null> {
    this.calls.push({ method: 'consumeState', userId: input.userId });
    if (this.consumeAck === 'throw') {
      this.consumeAck = 'ok';
      throw new Error('consume ACK lost');
    }
    if (this.consumeAck === 'null') {
      this.consumeAck = 'ok';
      return null;
    }
    if (this.consumeAck === 'uncertain') {
      this.consumeAck = 'ok';
      throw Object.assign(new Error('uncertain'), { code: 'PERSISTENCE_ERROR' });
    }
    const key = `${input.userId}:${input.stateHash}`;
    const state = this.states.get(key);
    if (!state || state.browserHash !== input.browserHash || state.consumedAt !== null) {
      return null;
    }
    const nowMs = Date.parse(input.now);
    if (!(Date.parse(state.createdAt) <= nowMs && nowMs < Date.parse(state.expiresAt))) {
      return null;
    }
    this.states.delete(key);
    return clone(oauthStateSchema.parse(state));
  }
}

export function fixtureSetupOptions(init: ConnectionFixtureInit = {}): CalendarSetupOptions {
  const configured = init.configured === true;
  const enabled = init.enabled === true;
  const policy = init.policy ?? configured;
  const oauth = configured
    ? {
        clientId: 'fixture-client-id',
        clientSecret: 'fixture-client-secret',
        redirectUri: init.redirectUri ?? REDIRECT,
        targetCalendarId: init.targetCalendarId ?? OWNED_TARGET,
      }
    : null;
  return parseCalendarSetupOptions({
    initial: {
      enabled,
      processingPolicyId: policy ? POLICY_ID : null,
    },
    oauth,
    frontendOrigin: init.frontendOrigin ?? FRONTEND,
    backendOrigin: init.backendOrigin ?? BACKEND,
    evidence: init.evidence ?? 'fixture',
    realDataPolicyApproved: policy,
  });
}

export function connectionFixture(init: ConnectionFixtureInit = {}) {
  const clock = (() => {
    let current = Date.parse('2026-10-21T10:00:00.000Z');
    return {
      now: () => current,
      advance: (ms: number) => { current += ms; },
    };
  })();
  const store = new MemoryCalendarStore();
  const encryption = init.encryption !== false;
  const cipher = new CalendarSecretCipher(
    encryption
      ? { status: 'ready', key: Buffer.alloc(32, 7) }
      : { status: 'missing' },
  );
  const network = vi.fn(async () => {
    throw new Error('unscripted Google request');
  });
  const invalidations: Invalidation[] = [];
  const client = {
    exchange: vi.fn(),
    refresh: vi.fn(),
    revoke: vi.fn(),
  };
  const target: CalendarTargetPort = {
    verifyOwnedTarget: vi.fn(async (input) => ({
      calendarId: input.calendarId,
      googleSubjectId: input.googleSubjectId,
      verifiedAt: new Date(clock.now()).toISOString(),
      proofRevision: 'google-calendar.events-owned.v1',
    })),
  };
  const options = fixtureSetupOptions(init);
  const dependencies: ConnectionDependencies = {
    store,
    storeV2: store.v2,
    cipher,
    options,
    userId: 'u1',
    client,
    target,
    now: () => clock.now(),
    onInvalidated: async (binding, reason) => {
      invalidations.push({ binding: { ...binding }, reason });
    },
  };
  const service = new GoogleCalendarConnections(dependencies);
  return {
    service,
    store,
    cipher,
    network,
    clock,
    client,
    revoke: client.revoke,
    target,
    options,
    storeCalls: store.calls,
    invalidations,
    readRecord: () => {
      if (!store.record) return null;
      const rec = clone(store.record);
      if (rec.schemaVersion === 2 && !('calendarId' in rec)) {
        Object.defineProperty(rec, 'calendarId', {
          get: () => rec.defaultSetting?.defaultCalendarId ?? options.oauth?.targetCalendarId ?? 'primary',
          enumerable: false,
        });
      }
      return rec as CalendarConnectionRecord;
    },
    seedRecord: (input: unknown) => {
      let raw = input;
      if (isRecord(raw) && raw.schemaVersion === 2 && 'calendarId' in raw) {
        const { calendarId: _, ...rest } = raw;
        raw = rest;
      }
      const parsed = isRecord(raw) && raw.schemaVersion === 2
        ? calendarConnectionV2Schema.parse(raw)
        : connectionRecordSchema.parse(raw);
      store.record = clone(parsed);
    },
    failNextCas: (outcome: 'conflict' | 'uncertain') => {
      store.nextCas = outcome;
    },
    replaceService: (patch: Partial<ConnectionDependencies> = {}) =>
      new GoogleCalendarConnections({ ...dependencies, ...patch, now: () => clock.now() }),
    installFixtureGrant: async (input: {
      subject: string; targetCalendarId?: string; accessToken: string; refreshToken: string;
    }) => {
      if (target && input.targetCalendarId) {
        const verified = await target.verifyOwnedTarget({
          calendarId: input.targetCalendarId,
          googleSubjectId: input.subject,
          accessToken: input.accessToken,
          signal: new AbortController().signal,
          deadlineAt: new Date(clock.now() + 20_000).toISOString(),
          consumeBudget: async () => undefined,
        });
        if (verified.calendarId !== input.targetCalendarId || verified.googleSubjectId !== input.subject) {
          throw Object.assign(new Error('target verification mismatch'), {
            failure: { category: 'policy', code: 'CALENDAR_TARGET_NOT_OWNED', retry: 'none' },
          });
        }
      }
      const current = await store.v2.get('u1');
      const isReplacement = current && current.googleSubjectId !== input.subject;
      if (current?.status === 'connected' && !isReplacement) {
        await service.beginConsent(new AbortController().signal);
      }
      const rawSnapshot = await service.captureSetupSnapshot();
      const snapshot: SetupSnapshot = isReplacement
        ? { ...rawSnapshot, expectedGoogleSubjectId: null, connectionId: null }
        : rawSnapshot;
      await service.installGrant({
        snapshot,
        grant: {
          accessToken: input.accessToken,
          refreshToken: input.refreshToken,
          idToken: 'fixture-id-token',
          expiresAt: new Date(clock.now() + 3_600_000).toISOString(),
          scopes: [...CALENDAR_SCOPES],
        },
        account: { subject: input.subject, email: 'fixture@example.invalid' },
        signal: new AbortController().signal,
        deadlineAt: new Date(clock.now() + 20_000).toISOString(),
        isCurrentFlow: () => true,
      });
    },
  };
}

export function refreshFixture() {
  const base = connectionFixture({ configured: true, enabled: true });
  let resolveRefresh: ((grant: {
    accessToken: string; refreshToken: string | null; expiresAt: string; scopes: string[] | null;
  }) => void) | undefined;
  const refresh = vi.fn(() => new Promise<{
    accessToken: string; refreshToken: string | null; expiresAt: string; scopes: string[] | null;
  }>((resolve) => { resolveRefresh = resolve; }));
  base.client.refresh = refresh;
  const service = base.replaceService({ client: base.client });
  const refreshBudget = vi.fn(async () => undefined);
  let casConfirmed = false;
  let actionBeforeConfirmedCas = false;
  const originalCas = base.store.compareAndSwap.bind(base.store);
  base.store.compareAndSwap = async (userId, expected, next) => {
    const result = await originalCas(userId, expected, next);
    if (result.outcome === 'confirmed') casConfirmed = true;
    return result;
  };
  const originalCasV2 = base.store.v2.compareAndSwap.bind(base.store.v2);
  base.store.v2.compareAndSwap = async (input) => {
    const result = await originalCasV2(input);
    if (result.outcome === 'confirmed') casConfirmed = true;
    return result;
  };
  return {
    ...base,
    service,
    refresh,
    refreshBudget,
    get actionBeforeConfirmedCas() { return actionBeforeConfirmedCas; },
    seedExpiredGrant: async () => {
      await base.installFixtureGrant({
        subject: 'fixture-sub', targetCalendarId: 'owned-a',
        accessToken: 'fixture-access', refreshToken: 'fixture-refresh',
      });
      const record = base.readRecord()!;
      base.seedRecord({ ...record, tokenExpiresAt: new Date(base.clock.now() - 1).toISOString() });
      casConfirmed = false;
      actionBeforeConfirmedCas = false;
    },
    binding: async () => service.currentBinding(),
    releaseRefresh: (grant: {
      accessToken: string; refreshToken: string | null; expiresAt: string; scopes: string[] | null;
    }) => { resolveRefresh?.(grant); },
    useToken: async () => {
      const account = await service.currentAccount();
      return service.withAccessToken({
        account,
        signal: new AbortController().signal,
        deadlineAt: new Date(base.clock.now() + 20_000).toISOString(),
        consumeRefreshRequest: refreshBudget,
      }, async (token) => {
        if (!casConfirmed) actionBeforeConfirmedCas = true;
        return token;
      });
    },
  };
}
