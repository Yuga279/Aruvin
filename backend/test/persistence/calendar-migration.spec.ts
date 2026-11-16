/**
 * ============================================================================
 * FILE: calendar-migration.spec.ts
 * LOCATION: backend/test/persistence/calendar-migration.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Tests for explicit legacy calendar connection migration, token AAD preservation,
 *    and fail-closed rollback assessment.
 *
 * ROLE IN PROJECT:
 *    Ensures legacy v1 connections project to v2 with default calendar overrides,
 *    token encryption AAD remains intact, and rollback preconditions fail closed.
 *
 * KEY COMPONENTS:
 *    - projectLegacyCalendarConnection: Projection from v1 to v2 connection record.
 *    - assessCalendarRollback: Safe rollback precondition assessment.
 *    - migrateLegacy: Explicit connection migration on MongoCalendarConnections.
 *    - recordLegacyDisposition: Legacy effect quarantine on MongoCalendarOperations.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { projectLegacyCalendarConnection, assessCalendarRollback }
  from '../../src/persistence/calendar-migration.js';
import { compatibleCalendarConnectionSchema, legacyOperationDisposition }
  from '../../src/contracts/calendar-compatibility.js';
import { connection } from './calendar-fixtures.js';
import { operationV1, receiptV1, at } from '../contracts/calendar-multi-fixtures.js';
import { CalendarSecretCipher } from '../../src/platform/crypto/calendar-secret-cipher.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoCalendarConnections } from '../../src/persistence/calendar-connections.js';
import { MongoCalendarOperations } from '../../src/persistence/calendar-operations.js';
import { calendarMemory } from './calendar-multi-memory.js';
import { connectionV2 } from './calendar-multi-fixtures.js';

it('migrates only an explicit legacy pin and quarantines unknown legacy effects', () => {
  const old = connection(); const migrated = projectLegacyCalendarConnection(old, at);
  expect(migrated).toMatchObject({ schemaVersion: 2, revision: old.revision + 1,
    connectionRevision: old.connectionRevision + 1, credentialVersion: old.credentialVersion,
    status: 'reconnect-required', discovery: null,
    defaultSetting: { defaultCalendarId: old.calendarId, defaultSettingRevision: 1 } });
  expect(migrated.credentials).toEqual(old.credentials);
  expect(migrated.grantedScopes).toEqual(old.grantedScopes);
  expect(compatibleCalendarConnectionSchema.parse(old)).toEqual(old);
  expect(legacyOperationDisposition({ ...operationV1, state: 'unknown' }, at))
    .toMatchObject({ state: 'cancelled', externalOutcome: 'unknown', reconcileOriginal: true });
  expect(legacyOperationDisposition({ ...operationV1, state: 'succeeded', receipt: receiptV1 }, at)).toBeNull();
  expect(assessCalendarRollback({ admissionStopped: false, executorDrained: true,
    pageComplete: true, v2Records: 0, unresolvedEffects: 0 }).outcome).toBe('blocked');
  expect(assessCalendarRollback({ admissionStopped: true, executorDrained: true,
    pageComplete: true, v2Records: 1, unresolvedEffects: 0 }).outcome).toBe('preserve-v2-read-only');
});

it('keeps the original token AAD decryptable after explicit schema migration', () => {
  const cipher = new CalendarSecretCipher({ status: 'ready', key: Buffer.alloc(32, 7) });
  const old = connection();
  const aad = { version: 1 as const, userId: old.userId, provider: old.provider,
    connectionId: old.connectionId, credentialVersion: old.credentialVersion,
    googleSubjectId: old.googleSubjectId, tokenKind: 'refresh' as const };
  const encrypted = cipher.sealToken(aad, 'fixture-refresh-token');
  const migrated = projectLegacyCalendarConnection({ ...old,
    credentials: { access: null, refresh: encrypted } }, at);
  expect(cipher.openToken({ ...aad, credentialVersion: migrated.credentialVersion },
    migrated.credentials!.refresh)).toBe('fixture-refresh-token');
  expect(migrated.credentials!.refresh).toEqual(encrypted);
  expect(() => cipher.openToken({ ...aad, googleSubjectId: 'replacement-account' }, encrypted)).toThrow();
});

it('migrates legacy connection via store and rejects bad revisions or unstopped admission', async () => {
  const f = calendarMemory();
  const connStore = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  const old = connection();
  await connStore.create(old);

  expect(await connStore.v2.get(old.userId)).toMatchObject({ schemaVersion: 1 });

  // v2.create should conflict
  const v2Conn = { ...connectionV2(), userId: old.userId };
  expect((await connStore.v2.create(v2Conn)).outcome).toBe('conflict');

  // migrateLegacy requires admissionStopped and executorDrained
  await expect(connStore.migrateLegacy({
    userId: old.userId,
    expectedRevision: old.revision,
    expectedConnectionRevision: old.connectionRevision,
    legacy: old,
    now: at,
    admissionStopped: false,
    executorDrained: true,
  })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  // migrateLegacy wrong revision conflicts
  expect((await connStore.migrateLegacy({
    userId: old.userId,
    expectedRevision: 99,
    expectedConnectionRevision: old.connectionRevision,
    legacy: { ...old, revision: 99 },
    now: at,
    admissionStopped: true,
    executorDrained: true,
  })).outcome).toBe('conflict');

  // migrateLegacy success
  const res = await connStore.migrateLegacy({
    userId: old.userId,
    expectedRevision: old.revision,
    expectedConnectionRevision: old.connectionRevision,
    legacy: old,
    now: at,
    admissionStopped: true,
    executorDrained: true,
  });
  expect(res.outcome).toBe('confirmed');
  if (res.outcome === 'confirmed') {
    expect(res.record.schemaVersion).toBe(2);
    expect(res.record.defaultSetting.defaultCalendarId).toBe(old.calendarId);
  }

  // Idempotent retry confirms same projection
  const retry = await connStore.migrateLegacy({
    userId: old.userId,
    expectedRevision: old.revision,
    expectedConnectionRevision: old.connectionRevision,
    legacy: old,
    now: at,
    admissionStopped: true,
    executorDrained: true,
  });
  expect(retry.outcome).toBe('confirmed');
});

it('records legacy dispositions idempotently on operation store', async () => {
  const f = calendarMemory();
  const opStore = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS);
  const disp = legacyOperationDisposition({ ...operationV1, state: 'unknown' }, at);
  expect(disp).not.toBeNull();
  if (!disp) return;

  await opStore.recordLegacyDisposition(disp);
  // Idempotent retry
  await opStore.recordLegacyDisposition(disp);

  // Mismatch throws
  await expect(opStore.recordLegacyDisposition({
    ...disp,
    externalOutcome: 'not-dispatched',
  })).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
});

