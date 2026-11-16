/**
 * ============================================================================
 * FILE: connection-settings.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/connection-settings.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for versioned settings and default calendar preferences.
 *
 * ROLE IN PROJECT:
 *    Verifies independent setting revisions, optimistic concurrency conflicts,
 *    and preference updates without accidental enablement or lifecycle fencing.
 *
 * KEY COMPONENTS:
 *    - Preference save: Updating default calendar with revision increment
 *    - Reset to automatic: Clearing default to null without enabling disabled plugin
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { multiConnectionFixture } from './connection-multi-fixtures.js';

it('saves a preference without toggling enablement or fencing a pinned operation', async () => {
  const f = await multiConnectionFixture();
  const before = (await f.read())!;
  await f.service.settings({ defaultSetting: { calendarId: 'shared-team', expectedRevision: 1,
    expectedConnectionRevision: before.connectionRevision } }, new AbortController().signal);
  const saved = (await f.read())!;
  expect(saved.enabled).toBe(before.enabled);
  expect(saved.connectionId).toBe(before.connectionId);
  expect(saved.connectionRevision).toBe(before.connectionRevision);
  expect(saved.credentialVersion).toBe(before.credentialVersion);
  expect(saved.defaultSetting).toEqual({ defaultCalendarId: 'shared-team', defaultSettingRevision: 2 });
  expect(f.invalidated).not.toHaveBeenCalled();
  expect((await f.restart().statusV2()).defaultSetting).toEqual(saved.defaultSetting);
  await expect(f.service.settings({ defaultSetting: { calendarId: null, expectedRevision: 1,
    expectedConnectionRevision: saved.connectionRevision } }, new AbortController().signal))
    .rejects.toMatchObject({ failure: { code: 'CALENDAR_SETTINGS_CONFLICT' } });
  expect((await f.read())!.defaultSetting).toEqual(saved.defaultSetting);
});

it('resets to automatic primary without writing the primary alias or enabling a disabled plugin', async () => {
  const f = await multiConnectionFixture({ enabled: false, defaultCalendarId: 'shared-team' });
  const before = (await f.read())!;
  await f.service.settings({ defaultSetting: { calendarId: null, expectedRevision: 1,
    expectedConnectionRevision: before.connectionRevision } }, new AbortController().signal);
  const saved = (await f.read())!;
  expect(saved.enabled).toBe(false);
  expect(saved.defaultSetting).toEqual({ defaultCalendarId: null, defaultSettingRevision: 2 });
  expect(saved.connectionRevision).toBe(before.connectionRevision);
  expect(f.discover).not.toHaveBeenCalled();
});
