/**
 * ============================================================================
 * FILE: http.spec.ts
 * LOCATION: backend/test/auth/http.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify isolated auth Nest endpoints, cookies, and ingress protections.
 *
 * ROLE IN PROJECT:
 *    Boots an AuthModule-only Nest app so login, me, logout, password, and
 *    recovery stay origin-bounded and never leak sealed sessions.
 *
 * KEY COMPONENTS:
 *    - testApp: AuthModule.register plus configureAuthHttp, never AppModule.
 *    - Cookie/origin/body tests: HttpOnly session and closed faults.
 * ============================================================================
 */

import 'reflect-metadata';
import http from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { AuthModule } from '../../src/auth/auth.module.js';
import { configureAuthHttp } from '../../src/auth/configure-auth-http.js';
import { AuthFault } from '../../src/auth/errors.js';
import { authFixture } from './fixtures.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
async function testApp() {
  const f = await authFixture();
  const moduleRef = await Test.createTestingModule({ imports: [AuthModule.register({ service: f.service, secureCookie: false })] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  app.setGlobalPrefix('api');
  configureAuthHttp(app, { bootstrap: loadBootstrapConfig({}), trustedHttpsIngress: () => false });
  await app.init(); return { ...f, app };
}
it('exposes only safe auth JSON and an HttpOnly session cookie', async () => {
  const f = await testApp();
  try {
    const login = await request(f.app.getHttpServer()).post('/api/auth/login')
      .set('Origin', 'http://localhost:5173').set('Host', 'localhost:3000')
      .send({ email: 'a@example.com', password: 'temporary' }).expect(200).expect('Cache-Control', 'no-store');
    expect(login.body).toEqual({ user: { userId: 'u1', email: 'a@example.com', role: 'user', passwordChangeRequired: true } });
    expect(JSON.stringify(login.body)).not.toContain('sealed_1');
    const cookies = login.headers['set-cookie'] as unknown as string[];
    expect(cookies[0]).toContain('HttpOnly; SameSite=Strict; Path=/api');
    await request(f.app.getHttpServer()).get('/api/auth/me').set('Host', 'localhost:3000')
      .set('Cookie', cookies[0]!.split(';')[0]!).expect(200);
    await request(f.app.getHttpServer()).post('/api/auth/logout').set('Origin', 'http://localhost:5173')
      .set('Host', 'localhost:3000').set('Cookie', cookies[0]!.split(';')[0]!).send({}).expect(204);
  } finally { await f.app.close(); }
});
it('rejects cross-origin and oversize credential bodies before provider calls', async () => {
  const f = await testApp();
  try {
    await request(f.app.getHttpServer()).post('/api/auth/login').set('Host', 'localhost:3000')
      .set('Origin', 'https://evil.example').send({ email: 'a@example.com', password: 'temporary' }).expect(403);
    await request(f.app.getHttpServer()).post('/api/auth/login').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').send({ email: 'a@example.com', password: 'x'.repeat(5000) }).expect(413);
    expect(f.provider.login).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
it.each([
  { path: '/api/auth/register', origin: 'http://localhost:5173', fetchSite: 'same-origin', status: 400 },
  { path: '/api/auth/login?userId=victim', origin: 'http://localhost:5173', fetchSite: 'same-origin', status: 400 },
  { path: '/api/auth/login', origin: '', fetchSite: 'same-origin', status: 403 },
  { path: '/api/auth/login', origin: 'null', fetchSite: 'same-origin', status: 403 },
  { path: '/api/auth/login', origin: 'http://localhost:5173', fetchSite: 'cross-site', status: 403 },
])('rejects unsupported or untrusted auth ingress %j', async c => {
  const f = await testApp();
  try {
    let req = request(f.app.getHttpServer()).post(c.path).set('Host', 'localhost:3000').set('Sec-Fetch-Site', c.fetchSite);
    if (c.origin) req = req.set('Origin', c.origin);
    const res = await req.send({ email: 'a@example.com', password: 'raw-password-sentinel' }).expect(c.status);
    expect(JSON.stringify(res.body)).not.toContain('raw-password-sentinel');
    expect(f.provider.login).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
it('rejects malformed JSON and remote Host despite forged forwarding headers', async () => {
  const f = await testApp();
  try {
    await request(f.app.getHttpServer()).post('/api/auth/login').set('Origin', 'http://localhost:5173')
      .set('Host', 'localhost:3000').set('Content-Type', 'application/json').send('{"password":').expect(400);
    await request(f.app.getHttpServer()).post('/api/auth/login').set('Origin', 'http://localhost:5173')
      .set('Host', 'remote.example').set('X-Forwarded-Proto', 'https').send({}).expect(403);
    expect(f.provider.login).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
it('clears terminal invalid cookies but preserves retryable refresh cookies', async () => {
  const f = await testApp();
  try {
    f.provider.read.mockRejectedValueOnce(new AuthFault('UNAUTHENTICATED'));
    const invalid = await request(f.app.getHttpServer()).get('/api/auth/me').set('Host', 'localhost:3000')
      .set('Cookie', 'aurvin_wos_session=bad').expect(401);
    expect(String(invalid.headers['set-cookie'])).toContain('Max-Age=0');
    f.provider.read.mockRejectedValueOnce(new AuthFault('AUTH_PROVIDER_UNAVAILABLE'));
    const retryable = await request(f.app.getHttpServer()).get('/api/auth/me').set('Host', 'localhost:3000')
      .set('Cookie', 'aurvin_wos_session=retryable').expect(503);
    expect(retryable.headers['set-cookie']).toBeUndefined();
  } finally { await f.app.close(); }
});
it('keeps forgotten/reset/password results credential-free across the six-route flow', async () => {
  const f = await testApp();
  try {
    const server = f.app.getHttpServer();
    const login = await request(server).post('/api/auth/login').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').send({ email: 'a@example.com', password: 'temporary' }).expect(200);
    const cookie = String((login.headers['set-cookie'] as unknown as string[])[0]).split(';')[0]!;
    const changed = await request(server).post('/api/auth/password').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').set('Cookie', cookie)
      .send({ currentPassword: 'temporary', newPassword: 'private-password' }).expect(200);
    expect(changed.body.user.passwordChangeRequired).toBe(false);
    const forgot = await request(server).post('/api/auth/forgot-password').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').send({ email: 'a@example.com' }).expect(200);
    const reset = await request(server).post('/api/auth/reset-password').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').send({ token: 'raw-reset-token', newPassword: 'private-password' }).expect(200);
    expect(forgot.body).toEqual({ ok: true }); expect(reset.body).toEqual({ ok: true });
    const visible = JSON.stringify([login.body, changed.body, forgot.body, reset.body]);
    for (const secret of ['temporary', 'private-password', 'raw-reset-token', 'sealed_1', 'sid_1', 'sessionEpoch']) expect(visible).not.toContain(secret);
  } finally { await f.app.close(); }
});
it('returns 408 when body collection exceeds the deadline', async () => {
  const f = await testApp();
  let upload: http.ClientRequest | undefined;
  try {
    await f.app.listen(0, '127.0.0.1');
    const address = f.app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const reply = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      upload = http.request({
        host: '127.0.0.1', port, method: 'POST', path: '/api/auth/login',
        headers: {
          Host: `localhost:${port}`,
          Origin: 'http://localhost:5173',
          'Content-Type': 'application/json',
          'Content-Length': '32',
        },
      }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      upload.on('error', reject);
      upload.write('{');
    });
    expect(reply.status).toBe(408);
    expect(JSON.parse(reply.body)).toEqual({ error: { code: 'INVALID_REQUEST', retryable: false } });
    expect(JSON.stringify(reply.body)).not.toContain('temporary');
    expect(f.provider.login).not.toHaveBeenCalled();
  } finally {
    upload?.destroy();
    await f.app.close();
  }
}, 8000);
it('rejects chunked over-limit, compressed, and non-JSON bodies before provider admission', async () => {
  const f = await testApp();
  let upload: http.ClientRequest | undefined;
  try {
    await f.app.listen(0, '127.0.0.1');
    const address = f.app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const oversized = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      upload = http.request({
        host: '127.0.0.1', port, method: 'POST', path: '/api/auth/login',
        headers: {
          Host: `localhost:${port}`,
          Origin: 'http://localhost:5173',
          'Content-Type': 'application/json',
        },
      }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      upload.on('error', reject);
      upload.write('x'.repeat(4097));
      upload.end();
    });
    expect(oversized.status).toBe(413);
    expect(JSON.parse(oversized.body)).toEqual({ error: { code: 'INVALID_REQUEST', retryable: false } });
    const server = f.app.getHttpServer();
    const compressed = await request(server).post('/api/auth/login').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip').send('{}').expect(400);
    const nonJson = await request(server).post('/api/auth/login').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').set('Content-Type', 'text/plain').send('password=temporary').expect(400);
    expect(JSON.stringify([oversized.body, compressed.body, nonJson.body])).not.toContain('temporary');
    expect(f.provider.login).not.toHaveBeenCalled();
  } finally {
    upload?.destroy();
    await f.app.close();
  }
});
