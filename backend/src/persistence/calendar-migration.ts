/**
 * ============================================================================
 * FILE: calendar-migration.ts
 * LOCATION: backend/src/persistence/calendar-migration.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Explicit legacy Google Calendar connection migration and rollback assessment.
 *
 * ROLE IN PROJECT:
 *    Projects v1 connection pins into v2 records with explicit default settings,
 *    preserving token encryption AAD and providing pure rollback preconditions.
 *
 * KEY COMPONENTS:
 *    - projectLegacyCalendarConnection: Deterministic projection of v1 connection.
 *    - assessCalendarRollback: Safe rollback assessment gating v2 decommission.
 * ============================================================================
 */

import { connectionRecordSchema, type CalendarConnectionRecord } from '../contracts/calendar-connections.js';
import { calendarConnectionV2Schema, type CalendarConnectionRecordV2 } from '../contracts/calendar-discovery.js';
import { AppError } from '../platform/errors/app-error.js';

export function projectLegacyCalendarConnection(old: CalendarConnectionRecord, now: string): CalendarConnectionRecordV2 {
  const p = connectionRecordSchema.parse(old);
  const { calendarId, targetRevision, ...rest } = p;
  void targetRevision;
  if (calendarId === 'primary' || Date.parse(now) < Date.parse(p.updatedAt)) {
    throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
  }
  return calendarConnectionV2Schema.parse({
    ...rest,
    schemaVersion: 2,
    revision: p.revision + 1,
    connectionRevision: p.connectionRevision + 1,
    status: p.status === 'disconnected' ? 'disconnected' : 'reconnect-required',
    updatedAt: now,
    defaultSetting: { defaultCalendarId: calendarId, defaultSettingRevision: 1 },
    discovery: null,
  });
}

export function assessCalendarRollback(input: {
  admissionStopped: boolean;
  executorDrained: boolean;
  pageComplete: boolean;
  v2Records: number;
  unresolvedEffects: number;
}): { outcome: 'blocked' | 'preserve-v2-read-only' | 'legacy-compatible' } {
  if (
    !input.admissionStopped
    || !input.executorDrained
    || !input.pageComplete
    || input.unresolvedEffects > 0
    || !Number.isInteger(input.v2Records)
    || input.v2Records < 0
    || !Number.isInteger(input.unresolvedEffects)
  ) {
    return { outcome: 'blocked' as const };
  }
  return { outcome: input.v2Records > 0 ? 'preserve-v2-read-only' as const : 'legacy-compatible' as const };
}
