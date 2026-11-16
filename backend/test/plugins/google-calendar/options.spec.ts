/**
 * ============================================================================
 * FILE: options.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/options.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for Google Calendar options parsing and v2 public status projection.
 *
 * ROLE IN PROJECT:
 *    Validates no-target OAuth setup, legacy target compatibility, and network-free
 *    versioned status reporting.
 *
 * KEY COMPONENTS:
 *    - Options parsing: Verifies targetCalendarId omission and compatibility
 *    - StatusV2 assertions: Verifies schema-exact, network-free status projection
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { parseCalendarSetupOptions } from '../../../src/plugins/google-calendar/options.js';
import { calendarStatusV2ResponseSchema } from '../../../src/contracts/calendar-wire.js';
import { connectionFixture, fixtureSetupOptions } from './connection-fixtures.js';

it('accepts no target and treats an old pin as inert compatibility configuration', async () => {
  const old = fixtureSetupOptions({ configured: true, enabled: true });
  const { targetCalendarId: _pin, ...oauth } = old.oauth!;
  const parsed = parseCalendarSetupOptions({ ...old, oauth });
  expect(parsed.oauth).not.toBeNull();
  expect(parsed.oauth?.targetCalendarId).toBeUndefined();
  expect(parseCalendarSetupOptions({ ...old, oauth: { ...oauth, targetCalendarId: 'primary' } })
    .oauth?.targetCalendarId).toBe('primary');
  const f = connectionFixture();
  const status = calendarStatusV2ResponseSchema.parse(await f.service.statusV2());
  expect(status).toMatchObject({ protocolVersion: 2, enabled: false, state: 'disabled',
    connectionRevision: null, defaultSetting: null, primaryCalendarId: null,
    discovery: null, missingScopes: [] });
  expect(JSON.stringify(status)).not.toMatch(/targetCalendarId|credentials|clientSecret|googleSubjectId/);
  expect(f.network).not.toHaveBeenCalled();
});
