/**
 * ============================================================================
 * FILE: admin-http.spec.ts
 * LOCATION: backend/test/assembly/admin-http.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify guarded admin HTTP works while chat stays unconfigured.
 *
 * ROLE IN PROJECT:
 *    Covers admin module registration, CORS preflight, exact-origin and
 *    loopback-HTTPS ingress, bounded body defenses, and parser ordering
 *    without live providers or real databases.
 *
 * KEY COMPONENTS:
 *    - Unconfigured service: admin readable/savable while ready stays 503.
 *    - Ingress matrix: origin, transport, body, and header defenses.
 * ============================================================================
 */

import 'reflect-metadata';
import http from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { AppService } from '../../src/app.service.js';
import { AdminConfigService } from '../../src/admin-config/index.js';
import { configureApplication, trustedAdminHttpsIngress } from '../../src/main.js';
import { AURVIN_CONFIG } from '../../src/platform/tokens.js';
import { defaultManageableSettings } from '../../src/platform/config/manageable-config.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { account, authFixture } from '../auth/fixtures.js';
import { assemblyFixture } from './admin-config-fixture.js';

const SESSION = 'aurvin_wos_session=sealed_1';

async function boot(bootstrap = loadBootstrapConfig({
  NODE_ENV: 'development', FRONTEND_ORIGIN: 'http://localhost:5173',
  PERSISTENCE_PROFILE: 'native-mongodb', MONGODB_URI: 'fixture-injected-only',
  AURVIN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
})) {
  const f = assemblyFixture();
  const auth = await authFixture(account({
    userId: 'admin', role: 'super-admin', passwordChangeRequired: false,
    currentWorkosSessionId: 'sid_1', emailNormalized: 'admin@example.com',
  }));
  Object.assign(f.bundle, { users: auth.users });
  const service = await AppService.create(bootstrap, {
    ...f.ports, authProvider: () => auth.provider,
  });
  const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
  process.env.NODE_ENV = bootstrap.nodeEnv;
  process.env.FRONTEND_ORIGIN = bootstrap.frontendOrigin;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(bootstrap)
      .overrideProvider(AppService).useValue(service).compile();
    const app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false, logger: false,
    });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    return { f, service, app, origin: bootstrap.frontendOrigin };
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.FRONTEND_ORIGIN === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = previous.FRONTEND_ORIGIN;
  }
}

describe('admin HTTP', () => {
  it('serves admin while chat is unconfigured', async () => {
    const started = await boot();
    const { f, service, app } = started;
    try {
      const module = app.get(AppModule, { strict: false });
      expect(module).toBeDefined();
      expect(app.get(AdminConfigService)).toBe(service.adminConfig);
      const agent = request(app.getHttpServer());
      await agent.get('/api/operations/ready').set('Cookie', SESSION).expect(503);
      const result = await agent.get('/api/admin/config').set('Cookie', SESSION).expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body).toMatchObject({ revision: 0, activation: 'unconfigured' });
      const saved = await agent.put('/api/admin/config')
        .set('Cookie', SESSION)
        .set('Origin', f.bootstrap.frontendOrigin)
        .send({ protocolVersion: 1, expectedRevision: 0, settings: defaultManageableSettings() })
        .expect(200);
      expect(saved.body.revision).toBe(1);
    } finally { await app.close(); }
  });

  it('answers exact-origin preflight with PUT allowed and no-store', async () => {
    const started = await boot();
    try {
      const agent = request(started.app.getHttpServer());
      const preflight = await agent.options('/api/admin/config')
        .set('Origin', started.f.bootstrap.frontendOrigin)
        .set('Access-Control-Request-Method', 'PUT')
        .expect(204);
      expect(String(preflight.headers['access-control-allow-methods'])).toContain('PUT');
      expect(preflight.headers['cache-control']).toBe('no-store');
    } finally { await started.app.close(); }
  });

  it('rejects other, null, and missing mutation origins', async () => {
    const started = await boot();
    try {
      const agent = request(started.app.getHttpServer());
      const body = { protocolVersion: 1, expectedRevision: 0, settings: defaultManageableSettings() };
      for (const origin of ['https://other.invalid', 'null']) {
        const denied = await agent.put('/api/admin/config')
          .set('Cookie', SESSION).set('Origin', origin).send(body).expect(403);
        expect(denied.body.error.code).toBe('FORBIDDEN');
      }
      const missing = await agent.put('/api/admin/config').set('Cookie', SESSION).send(body).expect(403);
      expect(missing.body.error.code).toBe('FORBIDDEN');
      expect(started.f.repository.createIfAbsent).not.toHaveBeenCalled();
    } finally { await started.app.close(); }
  });

  it('rejects form, oversized, compressed, query, and unknown-field input', async () => {
    const started = await boot();
    try {
      const agent = request(started.app.getHttpServer());
      const origin = started.f.bootstrap.frontendOrigin;
      const settings = defaultManageableSettings();
      await agent.put('/api/admin/config').set('Cookie', SESSION).set('Origin', origin)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('protocolVersion=1').expect(400);
      await agent.put('/api/admin/config').set('Cookie', SESSION).set('Origin', origin)
        .set('Content-Encoding', 'gzip')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ protocolVersion: 1, expectedRevision: 0, settings }))
        .expect(400);
      const big = { protocolVersion: 1, expectedRevision: 0, settings, pad: 'x'.repeat(20_000) };
      await agent.put('/api/admin/config').set('Cookie', SESSION).set('Origin', origin).send(big).expect(413);
      await agent.get('/api/admin/config?revision=0').set('Cookie', SESSION).expect(400);
      const unknown = await agent.put('/api/admin/config').set('Cookie', SESSION).set('Origin', origin)
        .send({ protocolVersion: 1, expectedRevision: 0, settings, extra: true }).expect(400);
      expect(unknown.body.error.code).toBe('INVALID_CONFIG_REQUEST');
      const malformed = await agent.put('/api/admin/config').set('Cookie', SESSION).set('Origin', origin)
        .set('Content-Type', 'application/json').send('{broken').expect(400);
      expect(malformed.body.error.code).toBe('INVALID_CONFIG_REQUEST');
      expect(started.f.repository.createIfAbsent).not.toHaveBeenCalled();
    } finally { await started.app.close(); }
  });

  it('delivers the 413 fault while the rejected body is still uploading', async () => {
    const started = await boot();
    try {
      const address = started.app.getHttpServer().address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const payload = Buffer.from(JSON.stringify({
        protocolVersion: 1, expectedRevision: 0, settings: defaultManageableSettings(), pad: 'x'.repeat(20_000),
      }));
      const reply = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const upload = http.request({
          host: '127.0.0.1', port, method: 'PUT', path: '/api/admin/config',
          headers: {
            Host: `127.0.0.1:${port}`,
            Origin: started.f.bootstrap.frontendOrigin,
            Cookie: SESSION,
            'Content-Type': 'application/json',
            'Content-Length': String(payload.length),
          },
        }, res => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        upload.on('error', reject);
        // The body is still in flight when the server rejects it.
        void (async () => {
          for (let offset = 0; offset < payload.length; offset += 4096) {
            upload.write(payload.subarray(offset, offset + 4096));
            await new Promise(resolve2 => setTimeout(resolve2, 1));
          }
          upload.end();
        })();
      });
      expect(reply.status).toBe(413);
      expect(JSON.parse(reply.body)).toMatchObject({ error: { code: 'INVALID_CONFIG_REQUEST' } });
      expect(started.f.repository.createIfAbsent).not.toHaveBeenCalled();
    } finally { await started.app.close(); }
  });

  it('keeps success, error, and preflight replies free of secrets and etags', async () => {
    const started = await boot();
    try {
      const agent = request(started.app.getHttpServer());
      const origin = started.f.bootstrap.frontendOrigin;
      const saved = await agent.put('/api/admin/config').set('Cookie', SESSION).set('Origin', origin)
        .send({ protocolVersion: 1, expectedRevision: 0, settings: defaultManageableSettings() })
        .expect(200);
      for (const response of [saved]) {
        expect(response.headers.etag).toBeUndefined();
        expect(response.headers['cache-control']).toBe('no-store');
        expect(JSON.stringify(response.body)).not.toContain('envelope');
        expect(JSON.stringify(response.body)).not.toContain('ciphertext');
      }
      const denied = await agent.put('/api/admin/config')
        .set('Origin', 'https://other.invalid')
        .send({ protocolVersion: 1, expectedRevision: 1, settings: defaultManageableSettings() })
        .expect(403);
      expect(denied.headers.etag).toBeUndefined();
      expect(denied.headers['cache-control']).toBe('no-store');
    } finally { await started.app.close(); }
  });

  it('requires trusted loopback https ingress outside localhost development', async () => {
    expect(trustedAdminHttpsIngress({
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-proto': 'https' },
    } as never)).toBe(true);
    expect(trustedAdminHttpsIngress({
      socket: { remoteAddress: '203.0.113.7' },
      headers: { 'x-forwarded-proto': 'https' },
    } as never)).toBe(false);
    expect(trustedAdminHttpsIngress({
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    } as never)).toBe(false);
    expect(trustedAdminHttpsIngress({
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-proto': 'http' },
    } as never)).toBe(false);
    expect(trustedAdminHttpsIngress({
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-proto': ['https', 'https'] },
    } as never)).toBe(false);

    const started = await boot(loadBootstrapConfig({
      NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://admin.invalid',
      PERSISTENCE_PROFILE: 'native-mongodb', MONGODB_URI: 'fixture-injected-only',
      AURVIN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    }));
    try {
      const agent = request(started.app.getHttpServer());
      const plain = await agent.put('/api/admin/config').set('Cookie', SESSION)
        .set('Origin', 'https://admin.invalid')
        .send({ protocolVersion: 1, expectedRevision: 0, settings: defaultManageableSettings() })
        .expect(403);
      expect(plain.body.error.code).toBe('ADMIN_TRANSPORT_REQUIRED');
      const gateway = await agent.put('/api/admin/config').set('Cookie', SESSION)
        .set('Origin', 'https://admin.invalid')
        .set('X-Forwarded-Proto', 'https')
        .send({ protocolVersion: 1, expectedRevision: 0, settings: defaultManageableSettings() })
        .expect(200);
      expect(gateway.body.revision).toBe(1);
    } finally { await started.app.close(); }
  });
});
