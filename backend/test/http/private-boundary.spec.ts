/**
 * ============================================================================
 * FILE: private-boundary.spec.ts
 * LOCATION: backend/test/http/private-boundary.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify cookie admission closes private HTTP before handler work.
 *
 * ROLE IN PROJECT:
 *    Proves public liveness stays open, private routes require a full current
 *    account, and exact-origin mutation policy is enforced without parsers.
 *
 * KEY COMPONENTS:
 *    - Admission tests: Live, 401, onboarding 403, origin, cache headers.
 * ============================================================================
 */

import express from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configurePrivateHttp } from '../../src/http/configure-private-http.js';
import { RequestIdentityStore } from '../../src/platform/identity/request-identity-store.js';
import { AuthFault } from '../../src/auth/errors.js';
import { principal } from '../assembly/auth-principal-fixture.js';
import { account, authFixture } from '../auth/fixtures.js';

it('closes admission before private handlers and preserves public liveness and exact origin', async () => {
  const app = express(), store = new RequestIdentityStore();
  const authenticate = vi.fn(async (cookie: string | null) => {
    if (!cookie) throw new AuthFault('UNAUTHENTICATED');
    return { principal: principal(cookie, cookie === 'admin' ? 'super-admin' : 'user', cookie === 'pending') };
  });
  configurePrivateHttp({ use: app.use.bind(app) } as NestExpressApplication, {
    auth: { authenticate }, identities: store, frontendOrigin: 'http://127.0.0.1:5173', secureCookie: false,
  });
  const privateHandler = vi.fn((_req: ExpressRequest, res: ExpressResponse) => res.json(store.resolve()));
  app.get('/api/sessions', privateHandler);
  app.post('/api/sessions', privateHandler);
  app.get('/api/operations/live', (_req, res) => res.json({ live: true }));
  await request(app).get('/api/operations/live').expect(200);
  expect(authenticate).not.toHaveBeenCalled();
  await request(app).get('/api/sessions').expect(401);
  expect(privateHandler).not.toHaveBeenCalled();
  await request(app).get('/api/sessions').set('Cookie', 'aurvin_wos_session=pending').expect(403);
  await request(app).post('/api/sessions').set('Cookie', 'aurvin_wos_session=u1')
    .set('Origin', 'https://evil.example').expect(403);
  await request(app).post('/api/sessions').set('Cookie', 'aurvin_wos_session=u1').expect(403);
  const ok = await request(app).get('/api/sessions').set('Cookie', 'aurvin_wos_session=u2').expect(200);
  expect(ok.body.userId).toBe('u2');
  expect(ok.headers['cache-control']).toBe('no-store');
});

it.each(['unknown', 'inactive', 'stale', 'pending'] as const)('rejects %s cookie admission before handler work', async mode => {
  const f = await authFixture(account({ passwordChangeRequired: mode === 'pending',
    status: mode === 'inactive' ? 'inactive' : 'active',
    currentWorkosSessionId: mode === 'stale' ? null : 'sid_1' }));
  if (mode === 'unknown') f.provider.read.mockResolvedValue({ workosUserId: 'unknown_subject', sessionId: 'sid_1' });
  const app = express(), identities = new RequestIdentityStore(), hit = vi.fn();
  configurePrivateHttp({ use: app.use.bind(app) }, { auth: f.service, identities,
    frontendOrigin: 'http://127.0.0.1:5173', secureCookie: false });
  app.get('/api/sessions', (_req, res) => { hit(); res.json({}); });
  await request(app).get('/api/sessions').set('Cookie', 'aurvin_wos_session=sealed_1')
    .expect(mode === 'pending' ? 403 : 401);
  expect(hit).not.toHaveBeenCalled();
});

it('preserves sealed cookies on retryable refresh failures and denies User config reads', async () => {
  const f = await authFixture(account({ passwordChangeRequired: false, currentWorkosSessionId: 'sid_1' }));
  const app = express(), identities = new RequestIdentityStore();
  configurePrivateHttp({ use: app.use.bind(app) }, { auth: f.service, identities,
    frontendOrigin: 'http://127.0.0.1:5173', secureCookie: false });
  app.get('/api/admin/config', (_req, res) => res.json({ secret: 'must-not-be-read' }));
  app.get('/api/sessions', (_req, res) => res.json({}));
  const denied = await request(app).get('/api/admin/config').set('Cookie', 'aurvin_wos_session=sealed_1').expect(403);
  expect(JSON.stringify(denied.body)).not.toContain('must-not-be-read');
  f.provider.read.mockRejectedValueOnce(new AuthFault('AUTH_PROVIDER_UNAVAILABLE'));
  const retry = await request(app).get('/api/sessions').set('Cookie', 'aurvin_wos_session=sealed_1').expect(503);
  expect(retry.headers['set-cookie']).toBeUndefined();
});

it('does not treat auth-evil prefixes as public and rejects malformed cookies', async () => {
  const app = express(), store = new RequestIdentityStore(), hit = vi.fn();
  const authenticate = vi.fn(async (cookie: string | null) => {
    if (!cookie) throw new AuthFault('UNAUTHENTICATED');
    return { principal: principal(cookie) };
  });
  configurePrivateHttp({ use: app.use.bind(app) }, {
    auth: { authenticate }, identities: store, frontendOrigin: 'http://127.0.0.1:5173', secureCookie: false,
  });
  app.get('/api/auth-evil', (_req, res) => { hit(); res.json({ ok: true }); });
  app.head('/api/sessions', (_req, res) => { hit(); res.status(200).end(); });
  await request(app).get('/api/auth-evil').expect(401);
  expect(hit).not.toHaveBeenCalled();
  await request(app).get('/api/sessions').set('Cookie', 'aurvin_wos_session=a; aurvin_wos_session=b').expect(401);
  await request(app).post('/api/sessions').set('Cookie', 'aurvin_wos_session=u1')
    .set('Origin', 'http://127.0.0.1:5173, https://evil.example').expect(403);
  const head = await request(app).head('/api/sessions').set('Cookie', 'aurvin_wos_session=u1').expect(200);
  expect(head.headers['cache-control']).toBe('no-store');
});
