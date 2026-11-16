/**
 * ============================================================================
 * FILE: connection-multi-fixtures.ts
 * LOCATION: backend/test/plugins/google-calendar/connection-multi-fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Multi-calendar connection test fixtures using real P2 storage in memory.
 *
 * ROLE IN PROJECT:
 *    Sets up in-memory MongoCalendarConnections adapter, cipher, and discovery mocks
 *    for multi-calendar v2 lifecycle, rotation, and capability tests.
 *
 * KEY COMPONENTS:
 *    - multiConnectionFixture: Factory creating GoogleCalendarConnections with v2 memory store
 * ============================================================================
 */

import { vi } from 'vitest';
import { DEFAULT_BUDGETS } from '../../../src/contracts/budgets.js';
import { CALENDAR_SCOPES } from '../../../src/contracts/calendar-policy.js';
import {
  calendarConnectionV2Schema,
  calendarDiscoverySnapshotSchema,
  type CalendarConnectionRecordV2,
  type CalendarDiscoveryPort,
} from '../../../src/contracts/calendar-discovery.js';
import { MongoCalendarConnections } from '../../../src/persistence/calendar-connections.js';
import { CalendarSecretCipher } from '../../../src/platform/crypto/calendar-secret-cipher.js';
import { GoogleCalendarConnections, tokenAad } from '../../../src/plugins/google-calendar/connection.js';
import { calendarMemory } from '../../persistence/calendar-multi-memory.js';
import { connectionV2 } from '../../persistence/calendar-multi-fixtures.js';
import { connectionFixture, fixtureSetupOptions } from './connection-fixtures.js';

export async function multiConnectionFixture(input: {
  empty?: boolean;
  enabled?: boolean;
  scopes?: readonly string[];
  defaultCalendarId?: string | null;
  expiredToken?: boolean;
} = {}) {
  let now = Date.parse('2026-10-22T10:00:00.000Z');
  const memory = calendarMemory();
  const adapter = new MongoCalendarConnections(memory.store, DEFAULT_BUDGETS);
  const base = connectionFixture({ configured: true, enabled: true });
  const cipher = new CalendarSecretCipher({ status: 'ready', key: Buffer.alloc(32, 7) });
  const { targetCalendarId: _pin, ...oauth } = fixtureSetupOptions({ configured: true }).oauth!;
  const options = { ...base.options, oauth, evidence: 'google' as const };
  const initial = connectionV2();
  const entries = [
    { ...initial.discovery!.entries[0]!, calendarId: 'canonical-primary', label: 'Primary', primary: true },
    { ...initial.discovery!.entries[0]!, calendarId: 'shared-team', label: 'Team', primary: false },
  ];
  const scopes = [...(input.scopes ?? CALENDAR_SCOPES)];
  const record = calendarConnectionV2Schema.parse({
    ...initial,
    userId: 'u1',
    googleSubjectId: 'fixture-sub',
    enabled: input.enabled ?? true,
    status: CALENDAR_SCOPES.every((s) => scopes.includes(s)) ? 'connected' : 'reconnect-required',
    grantedScopes: scopes,
    defaultSetting: {
      defaultCalendarId: input.defaultCalendarId ?? null,
      defaultSettingRevision: 1,
    },
    credentials: {
      access: cipher.sealToken(tokenAad({ ...initial, userId: 'u1', googleSubjectId: 'fixture-sub' }, 'access'), 'fixture-access'),
      refresh: cipher.sealToken(tokenAad({ ...initial, userId: 'u1', googleSubjectId: 'fixture-sub' }, 'refresh'), 'fixture-refresh'),
    },
    tokenExpiresAt: new Date(now + (input.expiredToken ? -1 : 3600000)).toISOString(),
    discovery: CALENDAR_SCOPES.every((s) => scopes.includes(s))
      ? { ...initial.discovery!, entries }
      : null,
  });
  if (!input.empty) await adapter.v2.create(record);
  const discover = vi.fn<CalendarDiscoveryPort['discover']>(async (request) => {
    await request.consumeRequest('discovery');
    return calendarDiscoverySnapshotSchema.parse({
      ...initial.discovery!,
      connectionId: request.account.connectionId,
      connectionRevision: request.account.connectionRevision,
      discoveryRevision: request.discoveryRevision,
      entries,
      fetchedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 300000).toISOString(),
      retentionExpiresAt: new Date(now + 300000).toISOString(),
    });
  });
  const invalidated = vi.fn(async () => undefined);
  const dependencies = {
    store: base.store,
    storeV2: adapter.v2,
    cipher,
    options,
    userId: 'u1',
    client: base.client,
    discovery: { discover },
    now: () => now,
    retentionPolicy: () => ({ policyId: 'fixture-policy', expiresAt: new Date(now + 300000).toISOString() }),
    onInvalidated: async () => undefined,
    onAccountInvalidated: invalidated,
  };
  const service = new GoogleCalendarConnections(dependencies);
  const read = async () => {
    const value = await adapter.v2.get('u1');
    return value?.schemaVersion === 2 ? value : null;
  };
  const patch = async (changes: Partial<CalendarConnectionRecordV2>) => {
    const current = (await read())!;
    const next = calendarConnectionV2Schema.parse({ ...current, revision: current.revision + 1, ...changes });
    return adapter.v2.compareAndSwap({
      userId: 'u1',
      expectedRevision: current.revision,
      expectedConnectionRevision: current.connectionRevision,
      expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
      next,
    });
  };
  const request = async (operation: 'read' | 'create' | 'availability' = 'read', selector: string | null = null) => ({
    account: await service.currentAccount(),
    operation,
    selector,
    signal: new AbortController().signal,
    deadlineAt: new Date(now + 20000).toISOString(),
    consumeRequest: vi.fn(async () => undefined),
    consumeRefreshRequest: vi.fn(async () => undefined),
  });
  return {
    service,
    adapter,
    memory,
    cipher,
    options,
    client: base.client,
    discover,
    invalidated,
    entries,
    read,
    patch,
    request,
    now: () => now,
    advance: (ms: number) => { now += ms; },
    restart: () => new GoogleCalendarConnections(dependencies),
  };
}
