/**
 * ============================================================================
 * FILE: authorization.spec.ts
 * LOCATION: backend/test/admin-config/authorization.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify config reads and writes require a session Super Admin.
 *
 * ROLE IN PROJECT:
 *    Ensures ordinary Users cannot read shared configuration before repository
 *    access, while an authenticated Super Admin receives the session assumption.
 *
 * KEY COMPONENTS:
 *    - Authorization test: User denial and Super Admin session projection.
 * ============================================================================
 */

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { AdminConfigModule } from '../../src/admin-config/admin-config.module.js';
import { configureAdminHttp } from '../../src/admin-config/configure-admin-http.js';
import { defaultManageableSettings } from '../../src/platform/config/manageable-config.js';
import { serviceFixture, actor, bootstrap, secret } from './fixtures.js';

it('denies User config reads before repository access and accepts a session Super Admin', async () => {
  const f = serviceFixture();
  const user = { ...actor, assumption: { role: 'user' as const,
    authentication: 'session' as const, source: 'local-account' as const } };
  await expect(f.service.read(user)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(f.repository.read).not.toHaveBeenCalled();
  expect((await f.service.read(actor)).roleAssumption).toEqual({
    role: 'super-admin', authentication: 'session', source: 'local-account',
  });
});

async function appFor(actorFactory: () => typeof actor, service = serviceFixture().service) {
  const moduleRef = await Test.createTestingModule({
    imports: [AdminConfigModule.register({ service, actor: actorFactory })],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  app.setGlobalPrefix('api');
  configureAdminHttp(app, { bootstrap, actor: actorFactory, trustedHttpsIngress: () => false });
  await app.init();
  return app;
}

it('denies User GET/PUT/credential POST without leaking secrets and allows a session Super Admin', async () => {
  const user = { ...actor, assumption: { role: 'user' as const,
    authentication: 'session' as const, source: 'local-account' as const } };
  const deniedApp = await appFor(() => user);
  try {
    const origin = bootstrap.frontendOrigin;
    const deniedGet = await request(deniedApp.getHttpServer()).get('/api/admin/config').expect(403);
    expect(JSON.stringify(deniedGet.body)).not.toContain(secret);
    const deniedPut = await request(deniedApp.getHttpServer()).put('/api/admin/config')
      .set('Origin', origin).send({ protocolVersion: 1, expectedRevision: 1, settings: defaultManageableSettings() })
      .expect(403);
    expect(JSON.stringify(deniedPut.body)).not.toContain('must-not-be-read');
    const deniedPost = await request(deniedApp.getHttpServer())
      .post('/api/admin/config/credentials/openrouter')
      .set('Origin', origin)
      .send({ protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: secret })
      .expect(403);
    expect(JSON.stringify(deniedPost.body)).not.toContain(secret);
  } finally { await deniedApp.close(); }
  const allowed = await appFor(() => actor, serviceFixture().service);
  try {
    const origin = bootstrap.frontendOrigin;
    await request(allowed.getHttpServer()).get('/api/admin/config').expect(200);
    await request(allowed.getHttpServer()).put('/api/admin/config')
      .set('Origin', origin).send({ protocolVersion: 1, expectedRevision: 1, settings: defaultManageableSettings() })
      .expect(200);
  } finally { await allowed.close(); }
  const credentialApp = await appFor(() => actor, serviceFixture().service);
  try {
    await request(credentialApp.getHttpServer()).post('/api/admin/config/credentials/openrouter')
      .set('Origin', bootstrap.frontendOrigin)
      .send({ protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: secret })
      .expect(200);
  } finally { await credentialApp.close(); }
});
