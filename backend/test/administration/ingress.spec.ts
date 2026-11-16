/**
 * ============================================================================
 * FILE: ingress.spec.ts
 * LOCATION: backend/test/administration/ingress.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Administration credential ingress and no-cache boundaries.
 *
 * ROLE IN PROJECT:
 *    Exercises only loopback HTTP with deterministic provider stubs.
 *    Keeps browser trust and parsing tests outside business logic.
 *
 * KEY COMPONENTS:
 *    - Origin/transport, parser limits and body deadline assertions.
 * ============================================================================
 */
import http from 'node:http';
import request from 'supertest';
import { expect, it } from 'vitest';
import { administrationHttpFixture } from './http-fixture.js';
const input = { email: 'new@example.com', temporaryPassword: 'password-sentinel', role: 'user' };

it('rejects cross-origin, cross-site and absent/null mutation origins before credential calls', async () => {
  const f = await administrationHttpFixture();
  try {
    for (const origin of ['https://evil.example', '', 'null']) {
      let req = request(f.app.getHttpServer()).post('/api/admin/users').set('Host', 'localhost:3000');
      if (origin) req = req.set('Origin', origin);
      await req.send(input).expect(403);
    }
    await request(f.app.getHttpServer()).post('/api/admin/users').set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173').set('Sec-Fetch-Site', 'cross-site').send(input).expect(403);
    await request(f.app.getHttpServer()).get('/api/admin/users').set('Host', 'localhost:3000')
      .set('Origin', 'https://evil.example').expect(403);
    expect(f.provider.createUser).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
it('rejects remote plaintext Host despite forged forwarding headers and supports only trusted HTTPS ingress', async () => {
  const f = await administrationHttpFixture();
  try {
    await request(f.app.getHttpServer()).post('/api/admin/users').set('Host', 'remote.example')
      .set('X-Forwarded-Proto', 'https').set('Origin', 'http://localhost:5173').send(input).expect(403);
    expect(f.provider.createUser).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
  const blocked = await administrationHttpFixture({ frontendOrigin: 'https://aurvin.example', trustedHttpsIngress: () => false });
  try {
    await request(blocked.app.getHttpServer()).get('/api/admin/users').set('Host', 'aurvin.example').expect(403);
  } finally { await blocked.app.close(); }
  const trusted = await administrationHttpFixture({ frontendOrigin: 'https://aurvin.example', trustedHttpsIngress: () => true });
  try {
    await request(trusted.app.getHttpServer()).post('/api/admin/users').set('Host', 'aurvin.example')
      .set('Origin', 'https://aurvin.example').send(input).expect(201);
  } finally { await trusted.app.close(); }
});
it('rejects oversized, compressed, non-JSON and malformed bodies with safe errors before provider work', async () => {
  const f = await administrationHttpFixture();
  try {
    const server = f.app.getHttpServer();
    await request(server).post('/api/admin/users').set('Host', 'localhost:3000').set('Origin', 'http://localhost:5173')
      .send({ ...input, temporaryPassword: 'x'.repeat(5000) }).expect(413);
    await request(server).post('/api/admin/users').set('Host', 'localhost:3000').set('Origin', 'http://localhost:5173')
      .set('Content-Encoding', 'gzip').send(input).expect(400);
    await request(server).post('/api/admin/users').set('Host', 'localhost:3000').set('Origin', 'http://localhost:5173')
      .set('Content-Type', 'text/plain').send('password=password-sentinel').expect(400);
    const malformed = await request(server).post('/api/admin/users').set('Host', 'localhost:3000').set('Origin', 'http://localhost:5173')
      .set('Content-Type', 'application/json').send('{"temporaryPassword":').expect(400);
    expect(malformed.body).toEqual({ error: { code: 'INVALID_REQUEST', retryable: false } });
    expect(f.provider.createUser).not.toHaveBeenCalled();
  } finally { await f.app.close(); }
});
it('sets no-store/nosniff and suppresses ETags on successful and failed pages', async () => {
  const f = await administrationHttpFixture();
  try {
    const server = f.app.getHttpServer();
    const page = await request(server).get('/api/admin/users').set('Host', 'localhost:3000').expect(200)
      .expect('Cache-Control', 'no-store').expect('X-Content-Type-Options', 'nosniff');
    expect(page.headers.etag).toBeUndefined();
    await request(server).get('/api/admin/users').set('Host', 'localhost:3000')
      .set('If-None-Match', '*').expect(200);
    f.as(f.regular);
    await request(server).get('/api/admin/users').set('Host', 'localhost:3000').expect(403)
      .expect('Cache-Control', 'no-store').expect('X-Content-Type-Options', 'nosniff');
  } finally { await f.app.close(); }
});
it('rejects chunked over-limit bodies and stops slow body collection at five seconds', async () => {
  const f = await administrationHttpFixture(); let upload: http.ClientRequest | undefined;
  try {
    await f.app.listen(0, '127.0.0.1'); const address = f.app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const send = (chunk: string, finish: boolean) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      upload = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/admin/users',
        headers: { Host: `localhost:${port}`, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' } }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', part => { body += part; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      upload.on('error', reject); upload.write(chunk); if (finish) upload.end();
    });
    const oversized = await send('x'.repeat(4097), true); expect(oversized.status).toBe(413);
    const slow = await send('{', false); expect(slow.status).toBe(408);
    expect(JSON.parse(slow.body)).toEqual({ error: { code: 'INVALID_REQUEST', retryable: false } });
    expect(f.provider.createUser).not.toHaveBeenCalled();
  } finally { upload?.destroy(); await f.app.close(); }
}, 8000);
