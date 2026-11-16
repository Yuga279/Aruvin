/**
 * ============================================================================
 * FILE: calendar-multi-http.spec.ts
 * LOCATION: backend/test/assembly/calendar-multi-http.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify multi-calendar routes on the full application and local security boundary.
 *
 * ROLE IN PROJECT:
 *    Runs Nest with one injected AppService and deterministic storage/provider fixtures.
 *    Protects cached reads, explicit refresh, default-only saves, and no-target Connect.
 *
 * KEY COMPONENTS:
 *    - boot: Existing AppModule and configureApplication composition.
 *    - HTTP checks: Authorized routes and rejected Host/Origin/CSRF requests.
 * ============================================================================
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { AppService } from '../../src/app.service.js';
import { configureApplication } from '../../src/main.js';
import { AURVIN_CONFIG } from '../../src/platform/tokens.js';
import { calendarStatusV2ResponseSchema } from '../../src/contracts/calendar-wire.js';
import { CALENDAR_SCOPES } from '../../src/contracts/calendar-policy.js';
import { SESSION_COOKIE } from '../auth/fixtures.js';
import { assembledCalendarApp } from './calendar-fixture.js';

const FRONTEND = 'http://127.0.0.1:5173';
const HOST = '127.0.0.1:3000';
const ROOT = '/api/plugins/google-calendar';

async function boot(connected = true) {
  const h = await assembledCalendarApp({ connected });
  const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
  process.env.NODE_ENV = 'development';
  process.env.FRONTEND_ORIGIN = FRONTEND;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(h.bootstrap)
      .overrideProvider(AppService).useValue(h.service).compile();
    const app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    return { ...h, app, disposeHttp: async () => { await app.close(); await h.dispose(); } };
  } catch (error) {
    await h.dispose();
    throw error;
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.FRONTEND_ORIGIN === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = previous.FRONTEND_ORIGIN;
  }
}

it('serves cached calendar pages without provider calls through the full application', async () => {
  const h = await boot();
  try {
    const current = await h.cal.p.calendarConnectionsV2.get('aurvin-dev-user');
    if (!current || current.schemaVersion !== 2 || !current.discovery) throw new Error('Missing discovery.');
    const primary = current.discovery.entries[0]!;
    await h.cal.setDiscovery({ entries: [primary, ...Array.from({ length: 20 }, (_, index) => ({
      ...primary, calendarId: `secondary-${index}@example.test`, label: `Secondary ${index}`, primary: false,
    }))] });
    h.fetcher.mockClear();
    const first = await request(h.app.getHttpServer()).get(`${ROOT}/calendars`)
      .set('Host', HOST).set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE).expect(200);
    expect(first.body.page.calendars).toHaveLength(20);
    expect(first.body.page.nextPageToken).toEqual(expect.any(String));
    const second = await request(h.app.getHttpServer()).get(`${ROOT}/calendars`)
      .query({ pageToken: first.body.page.nextPageToken })
      .set('Host', HOST).set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE).expect(200);
    expect(second.body.page.calendars).toHaveLength(1);
    expect(second.body.page.nextPageToken).toBeNull();
    for (const reply of [first, second]) {
      expect(reply.headers['cache-control']).toBe('no-store');
      expect(reply.headers.etag).toBeUndefined();
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
    }
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.disposeHttp(); }
});

it('starts no-target Connect locally without contacting Google or enabling Calendar', async () => {
  const h = await boot(false);
  try {
    expect(h.bootstrap.calendar?.setup.oauth?.targetCalendarId).toBeUndefined();
    const start = await request(h.app.getHttpServer()).post(`${ROOT}/oauth/start`)
      .set('Host', HOST).set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE).set('X-Aurvin-Calendar-CSRF', '1')
      .send({}).expect(200);
    const url = new URL(start.body.authorizationUrl);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(new Set(url.searchParams.get('scope')!.split(' '))).toEqual(new Set(CALENDAR_SCOPES));
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.service.configFor('aurvin-dev-user')!.calendar!.enabled).toBe(false);
  } finally { await h.disposeHttp(); }
});

it('saves and resets only the default and explicitly refreshes with current account revision', async () => {
  const h = await boot();
  try {
    const initial = calendarStatusV2ResponseSchema.parse((await request(h.app.getHttpServer())
      .get(`${ROOT}/status`).set('Host', HOST).set('Cookie', SESSION_COOKIE).expect(200)).body);
    if (!initial.defaultSetting || initial.connectionRevision === null) throw new Error('Missing settings.');
    const saved = await request(h.app.getHttpServer()).patch(`${ROOT}/settings`)
      .set('Host', HOST).set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE).set('X-Aurvin-Calendar-CSRF', '1')
      .send({ defaultSetting: { calendarId: 'team@example.test',
        expectedRevision: initial.defaultSetting.defaultSettingRevision,
        expectedConnectionRevision: initial.connectionRevision } }).expect(200);
    const selected = calendarStatusV2ResponseSchema.parse(saved.body);
    expect(selected.enabled).toBe(initial.enabled);
    expect(selected.connectionRevision).toBe(initial.connectionRevision);
    expect(selected.defaultSetting?.defaultCalendarId).toBe('team@example.test');
    await request(h.app.getHttpServer()).patch(`${ROOT}/settings`)
      .set('Host', HOST).set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE).set('X-Aurvin-Calendar-CSRF', '1')
      .send({ defaultSetting: { calendarId: null,
        expectedRevision: initial.defaultSetting.defaultSettingRevision,
        expectedConnectionRevision: initial.connectionRevision } }).expect(409);
    const reset = await request(h.app.getHttpServer()).patch(`${ROOT}/settings`)
      .set('Host', HOST).set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE).set('X-Aurvin-Calendar-CSRF', '1')
      .send({ defaultSetting: { calendarId: null,
        expectedRevision: selected.defaultSetting!.defaultSettingRevision,
        expectedConnectionRevision: selected.connectionRevision } }).expect(200);
    expect(reset.body.defaultSetting.defaultCalendarId).toBeNull();
    const refreshed = await request(h.app.getHttpServer()).post(`${ROOT}/calendars/refresh`)
      .set('Host', HOST).set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE).set('X-Aurvin-Calendar-CSRF', '1')
      .send({ expectedConnectionRevision: selected.connectionRevision }).expect(200);
    expect(refreshed.body.protocolVersion).toBe(2);
    expect(h.fetcher.mock.calls.some(([url]) => String(url).includes('/users/me/calendarList'))).toBe(true);
    expect(h.fetcher.mock.calls.some(([url]) => String(url).includes('/chat/completions'))).toBe(false);
  } finally { await h.disposeHttp(); }
});

it('rejects hostile Host Origin and missing CSRF before new route service work', async () => {
  const h = await boot();
  const connections = h.service.calendarFor('aurvin-dev-user').connections;
  const calendars = vi.spyOn(connections, 'calendars');
  const refresh = vi.spyOn(connections, 'refreshCalendars');
  const settings = vi.spyOn(connections, 'settings');
  try {
    const agent = request(h.app.getHttpServer());
    await agent.get(`${ROOT}/calendars`).set('Host', 'evil.invalid')
      .set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE).expect(403);
    await agent.get(`${ROOT}/calendars`).set('Host', HOST)
      .set('Origin', 'https://evil.invalid').set('Cookie', SESSION_COOKIE).expect(403);
    await agent.post(`${ROOT}/calendars/refresh`).set('Host', HOST)
      .set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE).send({ expectedConnectionRevision: 1 }).expect(403);
    await agent.patch(`${ROOT}/settings`).set('Host', HOST)
      .set('Origin', 'https://evil.invalid').set('Cookie', SESSION_COOKIE).set('X-Aurvin-Calendar-CSRF', '1')
      .send({ defaultSetting: { calendarId: null, expectedRevision: 1,
        expectedConnectionRevision: 1 } }).expect(403);
    expect(calendars).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(settings).not.toHaveBeenCalled();
    expect(h.fetcher).not.toHaveBeenCalled();
    const allowed = await agent.options(`${ROOT}/calendars/refresh`)
      .set('Host', HOST).set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE).expect(204);
    expect(allowed.headers['access-control-allow-headers']).toContain('X-Aurvin-Calendar-CSRF');
    for (const path of [`${ROOT}/status?unknown=1`, `${ROOT}/calendars?unknown=1`,
      `${ROOT}/calendars?pageToken=a&pageToken=b`]) {
      await agent.get(path).set('Host', HOST).set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE).expect(400);
    }
  } finally {
    calendars.mockRestore(); refresh.mockRestore(); settings.mockRestore();
    await h.disposeHttp();
  }
});
