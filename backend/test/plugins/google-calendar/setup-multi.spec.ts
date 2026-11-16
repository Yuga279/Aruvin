/**
 * ============================================================================
 * FILE: setup-multi.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/setup-multi.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Direct and standalone controller/module tests for multi-calendar routes.
 *
 * ROLE IN PROJECT:
 *    Validates GoogleCalendarController v2 status, cached calendars pagination,
 *    calendar refresh route, and strict query parameter handling.
 *
 * KEY COMPONENTS:
 *    - Controller routes: status v2, calendars GET, and calendars/refresh POST
 *    - Strict query validation: Rejection of malformed/unknown query params
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { GoogleCalendarController } from '../../../src/plugins/google-calendar/controller.js';
import { configureGoogleCalendarHttp } from '../../../src/plugins/google-calendar/controller-http.js';
import { GoogleCalendarOAuthService } from '../../../src/plugins/google-calendar/oauth.js';
import { GoogleCalendarModule } from '../../../src/plugins/google-calendar/module.js';
import { multiConnectionFixture } from './connection-multi-fixtures.js';
import { principal } from '../../assembly/auth-principal-fixture.js';

it('serves v2 status and strict cache-only calendars through the existing controller', async () => {
  const f = await multiConnectionFixture();
  const oauth = new GoogleCalendarOAuthService({
    connections: f.service,
    store: f.adapter,
    cipher: f.cipher,
    options: f.options,
    client: f.client as never,
    googleIdentity: { verify: vi.fn() },
    now: f.now,
  });
  const controller = new GoogleCalendarController(
    () => f.service, () => oauth, () => principal('u1'));
  expect(await controller.status()).toHaveProperty('protocolVersion', 2);
  const req = { url: '/api/plugins/google-calendar/calendars', on: vi.fn() } as unknown as Request;
  expect(await controller.calendars(req)).toHaveProperty('page.calendars');
  expect(f.discover).not.toHaveBeenCalled();
  for (const query of ['pageToken=a&pageToken=b', 'refresh=true', 'userId=forged']) {
    await expect(controller.calendars({ ...req, url: `${req.url}?${query}` } as Request))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  }
});

it('admits only bounded cached calendar GET pages through the local HTTP boundary', async () => {
  const f = await multiConnectionFixture();
  const current = await f.read();
  if (!current?.discovery) throw new Error('Missing discovery.');
  const primary = current.discovery.entries.find((entry) => entry.primary);
  if (!primary) throw new Error('Missing primary calendar.');
  await f.patch({ discovery: {
    ...current.discovery,
    discoveryRevision: current.revision + 1,
    entries: [primary, ...Array.from({ length: 20 }, (_, index) => ({
      ...primary, calendarId: `secondary-${index}@example.test`, label: `Secondary ${index}`, primary: false,
    }))],
  } });

  const oauth = new GoogleCalendarOAuthService({
    connections: f.service,
    store: f.adapter,
    cipher: f.cipher,
    options: f.options,
    client: f.client as never,
    googleIdentity: { verify: vi.fn() },
    now: f.now,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [GoogleCalendarModule.register({
      connections: () => f.service, oauth: () => oauth,
      principal: () => principal('u1'), frontendOrigin: f.options.frontendOrigin,
    })],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  app.setGlobalPrefix('api');
  configureGoogleCalendarHttp(app, {
    frontendOrigin: f.options.frontendOrigin,
    backendOrigin: f.options.backendOrigin,
    redirectUri: f.options.oauth?.redirectUri
      ?? `${f.options.backendOrigin}/api/plugins/google-calendar/oauth/callback`,
    now: f.now,
  });
  await app.init();

  const root = '/api/plugins/google-calendar';
  const host = new URL(f.options.backendOrigin).host;
  const calendars = vi.spyOn(f.service, 'calendars');
  const refresh = vi.spyOn(f.service, 'refreshCalendars');
  try {
    const first = await request(app.getHttpServer()).get(`${root}/calendars`)
      .set('Host', host).set('Origin', f.options.frontendOrigin).expect(200);
    expect(first.body.page.calendars).toHaveLength(20);
    expect(first.body.page.nextPageToken).toEqual(expect.any(String));

    const second = await request(app.getHttpServer()).get(`${root}/calendars`)
      .query({ pageToken: first.body.page.nextPageToken })
      .set('Host', host).set('Origin', f.options.frontendOrigin).expect(200);
    expect(second.body.page.calendars).toHaveLength(1);
    expect(second.body.page.nextPageToken).toBeNull();
    expect(f.discover).not.toHaveBeenCalled();

    await request(app.getHttpServer()).get(`${root}/calendars?refresh=true`)
      .set('Host', host).set('Origin', f.options.frontendOrigin).expect(400);
    await request(app.getHttpServer()).get(`${root}/calendars?pageToken=a&pageToken=b`)
      .set('Host', host).set('Origin', f.options.frontendOrigin).expect(400);
    await request(app.getHttpServer()).get(`${root}/calendars`)
      .query({ pageToken: 'x'.repeat(2049) })
      .set('Host', host).set('Origin', f.options.frontendOrigin).expect(400);
    await request(app.getHttpServer()).get(`${root}/calendars`)
      .set('Host', host).set('Origin', 'https://evil.invalid').expect(403);
    await request(app.getHttpServer()).get(`${root}/calendars`).set('Host', host).expect(403);
    await request(app.getHttpServer()).get(`${root}/calendars`).set('Host', host).set('Sec-Fetch-Site', 'cross-site').expect(403);
    await request(app.getHttpServer()).get(`${root}/calendars`).set('Host', host).set('Sec-Fetch-Site', 'same-origin').expect(200);
    await request(app.getHttpServer()).get(`${root}/calendars`)
      .set('Host', 'evil.invalid').set('Origin', f.options.frontendOrigin).expect(403);
    await request(app.getHttpServer()).post(`${root}/calendars/refresh`)
      .set('Host', host).set('Origin', f.options.frontendOrigin)
      .send({ expectedConnectionRevision: current.connectionRevision }).expect(403);
    await request(app.getHttpServer()).get(`${root}/status`).set('Host', host).expect(200);
    await request(app.getHttpServer()).get(`${root}/status?unknown=1`)
      .set('Host', host).set('Origin', f.options.frontendOrigin).expect(400);
    expect(calendars).toHaveBeenCalledTimes(3);
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    calendars.mockRestore(); refresh.mockRestore();
    await app.close();
  }
});

it('controller/module fixture without P8 boundary exercises status, GET pages, PATCH settings, and POST refresh', async () => {
  const f = await multiConnectionFixture();
  const oauth = new GoogleCalendarOAuthService({
    connections: f.service,
    store: f.adapter,
    cipher: f.cipher,
    options: f.options,
    client: f.client as never,
    googleIdentity: { verify: vi.fn() },
    now: f.now,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [GoogleCalendarModule.register({
      connections: () => f.service, oauth: () => oauth,
      principal: () => principal('u1'), frontendOrigin: f.options.frontendOrigin,
    })],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: true, logger: false });
  app.setGlobalPrefix('api');
  await app.init();

  try {
    // 1. GET status
    const statusRes = await request(app.getHttpServer())
      .get('/api/plugins/google-calendar/status')
      .expect(200);
    expect(statusRes.body).toHaveProperty('protocolVersion', 2);
    expect(statusRes.body.state).toBe('connected');

    // 2. GET calendars
    const calRes = await request(app.getHttpServer())
      .get('/api/plugins/google-calendar/calendars')
      .expect(200);
    expect(calRes.body).toHaveProperty('protocolVersion', 2);
    expect(calRes.body.page.calendars).toHaveLength(2);

    // 3. Reject invalid query
    await request(app.getHttpServer())
      .get('/api/plugins/google-calendar/calendars?refresh=true')
      .expect(400);

    // 4. PATCH settings - update default calendar
    const current = (await f.read())!;
    const patchRes = await request(app.getHttpServer())
      .patch('/api/plugins/google-calendar/settings')
      .send({
        defaultSetting: {
          calendarId: 'shared-team',
          expectedRevision: current.defaultSetting.defaultSettingRevision,
          expectedConnectionRevision: current.connectionRevision,
        },
      })
      .expect(200);
    expect(patchRes.body.defaultSetting).toEqual({
      defaultCalendarId: 'shared-team',
      defaultSettingRevision: 2,
    });

    // 5. PATCH settings with stale expected revision -> 409
    await request(app.getHttpServer())
      .patch('/api/plugins/google-calendar/settings')
      .send({
        defaultSetting: {
          calendarId: null,
          expectedRevision: 1, // stale
          expectedConnectionRevision: current.connectionRevision,
        },
      })
      .expect(409);

    // 6. POST calendars/refresh
    const refreshRes = await request(app.getHttpServer())
      .post('/api/plugins/google-calendar/calendars/refresh')
      .send({ expectedConnectionRevision: current.connectionRevision })
      .expect(200);
    expect(refreshRes.body).toHaveProperty('protocolVersion', 2);
    expect(refreshRes.body.page.calendars).toHaveLength(2);
  } finally {
    await app.close();
  }
});
