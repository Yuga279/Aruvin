/**
 * ============================================================================
 * FILE: admin-config-api.spec.ts
 * LOCATION: backend/test/admin-config/admin-config-api.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify origin, transport, body, cache, and route security of the admin API.
 *
 * ROLE IN PROJECT:
 *    Boots an isolated Nest/Express app with P2 middleware so credential bodies
 *    never reach a global parser or leak through errors.
 *
 * KEY COMPONENTS:
 *    - Origin/transport tests: Reject before JSON collection.
 *    - Body/rate tests: Bounded JSON, no-store, closed faults.
 * ============================================================================
 */

import 'reflect-metadata';
import { Controller, Get, Put, Post, Param, HttpCode } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { defaultManageableSettings } from '../../src/platform/config/manageable-config.js';
import { configureAdminHttp, type AdminHttpOptions } from '../../src/admin-config/configure-admin-http.js';
import { AdminConfigModule } from '../../src/admin-config/admin-config.module.js';
import { isAdminConfigError, isPublicAdminConfig } from '../../src/contracts/admin-config-wire.js';
import { actor, bootstrap, secret, serviceFixture } from './fixtures.js';
import { json as expressJson } from 'express';
import type { BootstrapConfig } from '../../src/platform/config/bootstrap-config.js';

@Controller('admin/config')
class StubAdminController {
  @Get() get() {
    return {
      protocolVersion: 1, schemaVersion: 1, revision: 0, activeRevision: null,
      state: 'missing', activation: 'unconfigured',
      roleAssumption: { role: 'super-admin', authentication: 'session', source: 'local-account' },
      settings: defaultManageableSettings(),
      credentials: {
        openrouter: { configured: false, validatedAt: null },
        deepgram: { configured: false, validatedAt: null },
      },
    };
  }
  @Put() put() { return this.get(); }
  @Post('credentials/:provider') @HttpCode(200) post(@Param('provider') _provider: string) { return this.get(); }
}

async function testApp(overrides: Partial<AdminHttpOptions> = {}) {
  const moduleRef = await Test.createTestingModule({
    controllers: [StubAdminController],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  app.setGlobalPrefix('api');
  configureAdminHttp(app, {
    bootstrap,
    actor: () => ({
      identity: { userId: 'aurvin-dev-user', openRouterUser: 'aurvin-dev-user', source: 'authenticated-session' },
      assumption: { role: 'super-admin', authentication: 'session', source: 'local-account' },
    }),
    trustedHttpsIngress: () => false,
    ...overrides,
  });
  await app.init();
  return app;
}

describe('admin config HTTP', () => {
  it('rejects origin before body', async () => {
    const app = await testApp();
    try {
      await request(app.getHttpServer())
        .put('/api/admin/config')
        .set('Origin', 'https://evil.example')
        .set('Host', 'localhost:3000')
        .send({ protocolVersion: 1, expectedRevision: 1, candidate: 'should-not-parse', padding: 'x'.repeat(1000) })
        .expect(403)
        .expect('Cache-Control', 'no-store')
        .expect('X-Content-Type-Options', 'nosniff')
        .expect((res) => {
          expect(res.body).toMatchObject({
            protocolVersion: 1,
            error: { code: 'INVALID_ADMIN_ORIGIN', retryable: false },
          });
          expect(JSON.stringify(res.body)).not.toContain('should-not-parse');
        });
    } finally {
      await app.close();
    }
  });

  it('sets no-store on success and unknown providers', async () => {
    const app = await testApp();
    try {
      await request(app.getHttpServer())
        .get('/api/admin/config')
        .set('Host', 'localhost:3000')
        .expect(200)
        .expect('Cache-Control', 'no-store')
        .expect((res) => {
          expect(res.headers.etag).toBeUndefined();
        });
      await request(app.getHttpServer())
        .post('/api/admin/config/credentials/unknown')
        .set('Origin', bootstrap.frontendOrigin)
        .set('Host', 'localhost:3000')
        .send({ protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: 'fixture-key-never-send-live' })
        .expect(200)
        .expect('Cache-Control', 'no-store');
    } finally {
      await app.close();
    }
  });

  it('rejects form, text, compressed, and oversize bodies without echoing candidates', async () => {
    const app = await testApp();
    try {
      await request(app.getHttpServer())
        .put('/api/admin/config')
        .set('Origin', bootstrap.frontendOrigin)
        .set('Host', 'localhost:3000')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('candidate=fixture-key-never-send-live')
        .expect(400)
        .expect((res) => {
          expect(res.body.error.code).toBe('INVALID_CONFIG_REQUEST');
          expect(JSON.stringify(res.body)).not.toContain('fixture-key-never-send-live');
        });
      await request(app.getHttpServer())
        .put('/api/admin/config')
        .set('Origin', bootstrap.frontendOrigin)
        .set('Host', 'localhost:3000')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .send('{}')
        .expect(400);
      await request(app.getHttpServer())
        .put('/api/admin/config')
        .set('Origin', bootstrap.frontendOrigin)
        .set('Host', 'localhost:3000')
        .set('Content-Type', 'application/json')
        .set('Content-Length', '16385')
        .send('x'.repeat(100))
        .expect(413)
        .expect((res) => {
          expect(res.body.error.code).toBe('INVALID_CONFIG_REQUEST');
        });
    } finally {
      await app.close();
    }
  });

  it('rejects a chunked body over 16384 bytes', async () => {
    const app = await testApp();
    try {
      await request(app.getHttpServer())
        .put('/api/admin/config')
        .set('Origin', bootstrap.frontendOrigin)
        .set('Host', 'localhost:3000')
        .set('Content-Type', 'application/json')
        .send(`{"padding":"${'x'.repeat(16_385)}"}`)
        .expect(413)
        .expect('Cache-Control', 'no-store');
    } finally {
      await app.close();
    }
  });

  it('requires trusted HTTPS ingress outside the development loopback exception', async () => {
    const httpsBootstrap = {
      ...bootstrap,
      frontendOrigin: 'https://aurvin.example',
      nodeEnv: 'production',
    } as BootstrapConfig;
    const trusted = vi.fn(() => false);
    const app = await testApp({ bootstrap: httpsBootstrap, trustedHttpsIngress: trusted });
    try {
      await request(app.getHttpServer())
        .put('/api/admin/config')
        .set('Origin', 'https://aurvin.example')
        .set('Host', 'aurvin.example')
        .set('X-Forwarded-Proto', 'https')
        .send({ protocolVersion: 1, expectedRevision: 1, settings: defaultManageableSettings() })
        .expect(403)
        .expect((res) => {
          expect(res.body.error.code).toBe('ADMIN_TRANSPORT_REQUIRED');
        });
    } finally {
      await app.close();
    }
    const allowed = await testApp({
      bootstrap: httpsBootstrap,
      trustedHttpsIngress: () => true,
    });
    try {
      await request(allowed.getHttpServer())
        .put('/api/admin/config')
        .set('Origin', 'https://aurvin.example')
        .set('Host', 'aurvin.example')
        .send({ protocolVersion: 1, expectedRevision: 1, settings: defaultManageableSettings() })
        .expect(200);
    } finally {
      await allowed.close();
    }
  });

  it('keeps the admin body bounded when a global parser is installed after it', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StubAdminController],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    app.setGlobalPrefix('api');
    configureAdminHttp(app, {
      bootstrap,
      actor: () => actor,
      trustedHttpsIngress: () => false,
    });
    app.use(expressJson({ limit: '1mb' }));
    await app.init();
    try {
      await request(app.getHttpServer())
        .post('/api/admin/config/credentials/openrouter')
        .set('Origin', bootstrap.frontendOrigin)
        .set('Host', 'localhost:3000')
        .set('Content-Type', 'application/json')
        .set('Content-Length', '16385')
        .send('x'.repeat(100))
        .expect(413)
        .expect((res) => {
          expect(res.body.error.code).toBe('INVALID_CONFIG_REQUEST');
        });
    } finally {
      await app.close();
    }
  });
});

async function realApp(service = serviceFixture().service) {
  const moduleRef = await Test.createTestingModule({
    imports: [AdminConfigModule.register({ service, actor: () => actor })],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  app.setGlobalPrefix('api');
  configureAdminHttp(app, { bootstrap, actor: () => actor, trustedHttpsIngress: () => false });
  await app.init();
  return app;
}

describe('admin config credential API', () => {
  it('accepts a credential API replace without leaking the candidate', async () => {
    const f = serviceFixture();
    const app = await realApp(f.service);
    try {
      await request(app.getHttpServer()).post('/api/admin/config/credentials/openrouter')
        .set('Origin', bootstrap.frontendOrigin).set('Host', 'localhost:3000')
        .send({ protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: secret })
        .expect(200).expect('Cache-Control', 'no-store')
        .expect((res) => {
          expect(isPublicAdminConfig(res.body)).toBe(true);
          expect(JSON.stringify(res.body)).not.toContain(secret);
        });
    } finally {
      await app.close();
    }
  });

  it('serves GET missing config and PUT settings', async () => {
    const missing = serviceFixture(null);
    const app = await realApp(missing.service);
    try {
      await request(app.getHttpServer())
        .get('/api/admin/config')
        .set('Host', 'localhost:3000')
        .expect(200)
        .expect((res) => {
          expect(isPublicAdminConfig(res.body)).toBe(true);
          expect(res.body.revision).toBe(0);
        });
      await request(app.getHttpServer())
        .put('/api/admin/config')
        .set('Origin', bootstrap.frontendOrigin)
        .set('Host', 'localhost:3000')
        .send({ protocolVersion: 1, expectedRevision: 0, settings: defaultManageableSettings() })
        .expect(200)
        .expect((res) => {
          expect(isPublicAdminConfig(res.body)).toBe(true);
          expect(res.body.revision).toBe(1);
        });
    } finally {
      await app.close();
    }
  });

  it('rejects unknown providers, queries, and stale revisions with closed errors', async () => {
    const f = serviceFixture();
    const app = await realApp(f.service);
    try {
      await request(app.getHttpServer())
        .post('/api/admin/config/credentials/other')
        .set('Origin', bootstrap.frontendOrigin)
        .set('Host', 'localhost:3000')
        .send({ protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: secret })
        .expect(400)
        .expect((res) => {
          expect(isAdminConfigError(res.body)).toBe(true);
          expect(res.body.error.code).toBe('INVALID_CONFIG_REQUEST');
          expect(JSON.stringify(res.body)).not.toContain(secret);
        });
      await request(app.getHttpServer())
        .get('/api/admin/config?x=1')
        .set('Host', 'localhost:3000')
        .expect(400);
      await request(app.getHttpServer())
        .put('/api/admin/config')
        .set('Origin', bootstrap.frontendOrigin)
        .set('Host', 'localhost:3000')
        .send({ protocolVersion: 1, expectedRevision: 9, settings: defaultManageableSettings() })
        .expect(409)
        .expect((res) => {
          expect(res.body.error.code).toBe('CONFIG_CONFLICT');
        });
    } finally {
      await app.close();
    }
  });

  it('maps provider and storage faults without leaking secrets', async () => {
    const f = serviceFixture();
    f.fetchImpl.mockResolvedValueOnce(new Response('nope', { status: 429 }));
    const app = await realApp(f.service);
    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(String(args)); });
    const error = vi.spyOn(console, 'error').mockImplementation((...args) => { logs.push(String(args)); });
    try {
      await request(app.getHttpServer())
        .post('/api/admin/config/credentials/openrouter')
        .set('Origin', bootstrap.frontendOrigin)
        .set('Host', 'localhost:3000')
        .send({ protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: secret })
        .expect(429)
        .expect((res) => {
          expect(res.body.error.code).toBe('CREDENTIAL_PROVIDER_RATE_LIMITED');
          expect(JSON.stringify(res.body)).not.toContain(secret);
        });
      expect(logs.join('\n')).not.toContain(secret);
    } finally {
      log.mockRestore();
      error.mockRestore();
      await app.close();
    }
  });
});
