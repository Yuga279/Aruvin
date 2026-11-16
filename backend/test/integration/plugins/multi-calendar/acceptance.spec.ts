/**
 * ============================================================================
 * FILE: acceptance.spec.ts
 * LOCATION: backend/test/integration/plugins/multi-calendar/acceptance.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify multi-calendar acceptance through the assembled local HTTP boundary.
 * ROLE IN PROJECT:
 *    Reuses P8 assembly and scripted external responses without another owner.
 *    Checks settings and effects without claiming live Google acceptance.
 * KEY COMPONENTS:
 *    - Assembly truth: No target configuration and one shared composition.
 *    - Acceptance: Cached routes, target precedence and permission denials.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import request from 'supertest';
import { createWire, textWire } from '../../../runtime/calendar-runtime.fixture.js';
import { event } from '../../../runtime/calendar-multi-fixture.js';
import { loadWire } from '../../../assembly/skill-fixture.js';
import { SESSION_COOKIE } from '../../../auth/fixtures.js';
import { openApp } from './assembled.js';

it('boots without a configured target over one shared assembly', async () => {
  const h = await openApp();
  try {
    expect(h.bootstrap.calendar?.setup.oauth?.targetCalendarId).toBeUndefined();
    expect(h.f.ports.open).toHaveBeenCalledTimes(1);
    expect(h.f.ports.runtime).toHaveBeenCalledTimes(1);
    const saved = await h.cal.p.calendarConnectionsV2.get('aurvin-dev-user');
    const status = await h.plugin('get', 'status');
    expect(status.status).toBe(200);
    expect(status.body.connectionRevision).toBe(saved?.connectionRevision);
    expect(status.body.primaryCalendarId).toBe('owned');
    const before = h.fetcher.mock.calls.length;
    await h.plugin('get', 'status');
    await h.service.operations.readiness.read();
    expect(h.fetcher.mock.calls.length).toBe(before);
  } finally { await h.dispose(); }
});

it('pages cached discovery and saves or resets only the default without restart', async () => {
  const h = await openApp();
  try {
    const raw = await h.cal.p.calendarConnectionsV2.get('aurvin-dev-user');
    if (!raw || raw.schemaVersion !== 2 || !raw.discovery) throw new Error('Missing v2 fixture account.');
    await h.cal.setDiscovery({ entries: Array.from({ length: 21 }, (_, i) => ({
      ...raw.discovery!.entries[0], calendarId: i === 0 ? 'owned' : `shared-${i}`,
      label: `Calendar ${i}`, primary: i === 0,
    })) });
    h.fetcher.mockClear();
    const first = await h.plugin('get', 'calendars');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toContain('no-store');
    expect(first.body.page.calendars).toHaveLength(20);
    expect(typeof first.body.page.nextPageToken).toBe('string');
    const next = await h.plugin('get', `calendars?pageToken=${encodeURIComponent(first.body.page.nextPageToken)}`);
    expect(next.status).toBe(200);
    expect(next.body.page.calendars).toHaveLength(1);
    expect(next.body.page.nextPageToken).toBeNull();
    expect(h.fetcher).not.toHaveBeenCalled();
    const status = await h.plugin('get', 'status');
    const setting = { calendarId: 'shared-1', expectedRevision: status.body.defaultSetting.defaultSettingRevision,
      expectedConnectionRevision: status.body.connectionRevision };
    const saved = await h.plugin('patch', 'settings', { defaultSetting: setting });
    expect(saved.status).toBe(200);
    expect(saved.body.enabled).toBe(status.body.enabled);
    expect(saved.body.connectionRevision).toBe(status.body.connectionRevision);
    expect(saved.body.defaultSetting).toEqual({ defaultCalendarId: 'shared-1',
      defaultSettingRevision: setting.expectedRevision + 1 });
    expect((await h.plugin('patch', 'settings', { defaultSetting: setting })).status).toBe(409);
    const reset = await h.plugin('patch', 'settings', { defaultSetting: { ...setting,
      calendarId: null, expectedRevision: saved.body.defaultSetting.defaultSettingRevision } });
    expect(reset.status).toBe(200);
    expect(reset.body.defaultSetting.defaultCalendarId).toBeNull();
    expect(h.f.ports.open).toHaveBeenCalledTimes(1);
    expect(h.f.ports.runtime).toHaveBeenCalledTimes(1);
  } finally { await h.dispose(); }
}, 20000);

it('rejects hostile Host Origin CSRF and unknown cached-route query fields', async () => {
  const h = await openApp();
  try {
    h.fetcher.mockClear();
    expect((await request(h.app.getHttpServer()).get('/api/plugins/google-calendar/calendars')
      .set('Host', 'hostile.example').set('Origin', 'http://127.0.0.1:5173')
      .set('Cookie', SESSION_COOKIE)).status).toBe(403);
    expect((await request(h.app.getHttpServer()).post('/api/plugins/google-calendar/calendars/refresh')
      .set('Host', '127.0.0.1:3000').set('Origin', 'https://hostile.example')
      .set('Cookie', SESSION_COOKIE)
      .set('X-Aurvin-Calendar-CSRF', '1').send({ expectedConnectionRevision: 1 })).status).toBe(403);
    expect((await request(h.app.getHttpServer()).patch('/api/plugins/google-calendar/settings')
      .set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:5173')
      .set('Cookie', SESSION_COOKIE)
      .send({ enabled: false })).status).toBe(403);
    expect((await h.plugin('get', 'calendars?userId=forged')).status).toBe(400);
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.dispose(); }
}, 20000);

it.each([
  [null, '', 'owned'],
  ['team@example.test', '', 'team@example.test'],
  ['owned', ' in my   work   calendar', 'team@example.test'],
] as const)('resolves default %s and wording %s to %s without JSON echo', async (saved, suffix, calendarId) => {
  const h = await openApp();
  try {
    if (saved !== null) await h.cal.setDefault(saved);
    h.cal.modelWires.push(loadWire(['calendar_create_event'], 'acceptance-load'),
      createWire(event()), textWire('Created.'));
    const ids = await h.submit(`Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC${suffix}.`);
    const frames = await h.stream(ids);
    expect(await h.cal.operationFor(ids)).toMatchObject({ state: 'succeeded', calendarId });
    expect(frames.some(frame => frame.event.type === 'calendar-clarification')).toBe(false);
    const posts = h.fetcher.mock.calls.filter(([url, init]) => String(url).includes('/events') && init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(decodeURIComponent(new URL(String(posts[0][0])).pathname)).toBe(`/calendar/v3/calendars/${calendarId}/events`);
    expect(h.cal.modelBodies).toHaveLength(2);
  } finally { await h.dispose(); }
}, 20000);

it.each(['unknown-explicit', 'lost-default', 'reader', 'freeBusyReader'] as const)
('never substitutes primary for %s', async condition => {
  const h = await openApp();
  try {
    let suffix = ' in my Work calendar';
    if (condition === 'unknown-explicit') suffix = ' in my Missing calendar';
    else if (condition === 'lost-default') {
      suffix = '';
      await h.cal.setDefault('missing-calendar');
    } else await h.cal.setRole('team@example.test', condition);
    h.cal.modelWires.push(loadWire(['calendar_create_event'], 'denial-load'), createWire(event()));
    const ids = await h.submit(`Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC${suffix}.`);
    await h.stream(ids);
    expect(await h.cal.operationFor(ids)).toBeNull();
    expect(h.fetcher.mock.calls.filter(([url, init]) => String(url).includes('/events') && init?.method === 'POST'))
      .toHaveLength(0);
  } finally { await h.dispose(); }
}, 20000);
