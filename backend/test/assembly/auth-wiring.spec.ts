/**
 * ============================================================================
 * FILE: auth-wiring.spec.ts
 * LOCATION: backend/test/assembly/auth-wiring.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify one assembled AppService owns auth, administration, and identity.
 *
 * ROLE IN PROJECT:
 *    Guards P3 composition so production injects one store/resolver pair,
 *    one AuthService, and never manufactures a diagnostic Super Admin.
 *
 * KEY COMPONENTS:
 *    - Shared persistence/runtime: one open and one runtime factory call.
 *    - adminActor: UNAUTHENTICATED outside ALS; session Super Admin inside.
 *    - Assembled REST: exact-origin credentials, cookie admission, public live.
 * ============================================================================
 */

import 'reflect-metadata';
import { expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { AppService } from '../../src/app.service.js';
import { configureApplication } from '../../src/main.js';
import { AURVIN_CONFIG } from '../../src/platform/tokens.js';
import { RequestIdentityStore } from '../../src/platform/identity/request-identity-store.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { assemblyFixture } from './admin-config-fixture.js';
import { account, authFixture } from '../auth/fixtures.js';
import { principal } from './auth-principal-fixture.js';

it('shares one persistence/runtime and never manufactures a diagnostic Super Admin', async () => {
  const f = assemblyFixture(), auth = await authFixture();
  Object.assign(f.bundle, { users: auth.users });
  const identities = new RequestIdentityStore();
  const identity = new ServerIdentityResolver(identities);
  const service = await AppService.create(f.bootstrap, { ...f.ports, identities, identity, authProvider: () => null });
  try {
    expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.runtime).toHaveBeenCalledTimes(1);
    expect(() => service.adminActor()).toThrow('UNAUTHENTICATED');
    const actor = identities.run(principal('admin', 'super-admin'), () => service.adminActor());
    expect(actor.assumption.authentication).toBe('session');
    await expect(service.auth.authenticate(null)).rejects.toMatchObject({ code: 'NOT_READY' });
  } finally { await service.operations.shutdown(); }
  expect(f.close).toHaveBeenCalledTimes(1);
});

async function wiredApp() {
  const f = assemblyFixture();
  const auth = await authFixture(account({
    passwordChangeRequired: false, currentWorkosSessionId: 'sid_1',
  }));
  await auth.users.insert(account({
    userId: 'u2', workosUserId: 'workos_u2', emailNormalized: 'u2@example.com',
    passwordChangeRequired: false, currentWorkosSessionId: 'sid_u2',
  }));
  await auth.users.insert(account({
    userId: 'admin', workosUserId: 'workos_admin', emailNormalized: 'admin@example.com',
    role: 'super-admin', passwordChangeRequired: false, currentWorkosSessionId: 'sid_admin',
  }));
  auth.provider.read.mockImplementation(async sealed => {
    if (sealed === 'sealed_u2') return { workosUserId: 'workos_u2', sessionId: 'sid_u2' };
    if (sealed === 'sealed_admin')
      return { workosUserId: 'workos_admin', sessionId: 'sid_admin', sealedSession: 'refreshed_admin' };
    return { workosUserId: 'user_fixture_1', sessionId: 'sid_1', sealedSession: 'refreshed_u1' };
  });
  Object.assign(f.bundle, { users: auth.users });
  const identities = new RequestIdentityStore();
  const identity = new ServerIdentityResolver(identities);
  const service = await AppService.create(f.bootstrap, {
    ...f.ports, identities, identity, authProvider: () => auth.provider,
  });
  const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
  process.env.NODE_ENV = 'development';
  process.env.FRONTEND_ORIGIN = f.bootstrap.frontendOrigin;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(f.bootstrap)
      .overrideProvider(AppService).useValue(service).compile();
    const app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApplication(app);
    await app.init();
    return { f, service, app, origin: f.bootstrap.frontendOrigin };
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.FRONTEND_ORIGIN === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = previous.FRONTEND_ORIGIN;
  }
}

it('keeps liveness public without WorkOS and closes private routes', async () => {
  const f = assemblyFixture();
  const identities = new RequestIdentityStore();
  const identity = new ServerIdentityResolver(identities);
  const service = await AppService.create(f.bootstrap, {
    ...f.ports, identities, identity, authProvider: () => null,
  });
  const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
  process.env.NODE_ENV = 'development';
  process.env.FRONTEND_ORIGIN = f.bootstrap.frontendOrigin;
  let app: NestExpressApplication | undefined;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(f.bootstrap)
      .overrideProvider(AppService).useValue(service).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApplication(app);
    await app.init();
    const agent = request(app.getHttpServer());
    await agent.get('/api/operations/live').expect(200);
    const ready = await agent.get('/api/operations/ready').expect(503);
    expect(ready.body.error?.code ?? ready.body.code).toBe('NOT_READY');
    await agent.get('/api/sessions').expect(503);
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.FRONTEND_ORIGIN === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = previous.FRONTEND_ORIGIN;
    if (app) await app.close();
    else await service.operations.shutdown();
  }
});

it('admits Super Admin and two Users with exact-origin credentials', async () => {
  const started = await wiredApp();
  try {
    const agent = request(started.app.getHttpServer());
    const preflight = await agent.options('/api/sessions')
      .set('Origin', started.origin).set('Access-Control-Request-Method', 'POST').expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(started.origin);
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    await agent.get('/api/operations/ready').expect(401);
    await agent.post('/api/sessions').set('Cookie', 'aurvin_wos_session=sealed_1')
      .set('Origin', 'https://evil.example').expect(403);
    const user = await agent.get('/api/sessions').set('Cookie', 'aurvin_wos_session=sealed_1').expect(200);
    expect(user.headers['set-cookie']?.some(value => value.includes('aurvin_wos_session=refreshed_u1'))).toBe(true);
    expect(user.headers['set-cookie']?.some(value => /aurvin_gcal_oauth=|aurvin_voice=/.test(value))).toBe(false);
    await agent.get('/api/sessions').set('Cookie', 'aurvin_wos_session=sealed_u2').expect(200);
    await agent.get('/api/admin/config').set('Cookie', 'aurvin_wos_session=sealed_1').expect(403);
    const admin = await agent.get('/api/admin/config').set('Cookie', 'aurvin_wos_session=sealed_admin').expect(200);
    expect(admin.headers['set-cookie']?.some(value => value.includes('aurvin_wos_session=refreshed_admin'))).toBe(true);
    expect(admin.body.activation).toBe('unconfigured');
  } finally { await started.app.close(); }
});
