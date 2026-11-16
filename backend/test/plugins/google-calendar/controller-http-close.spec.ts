/**
 * ============================================================================
 * FILE: controller-http-close.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/controller-http-close.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove the Calendar setup boundary delivers its fault while the rejected
 *    body is still uploading instead of resetting the connection.
 *
 * ROLE IN PROJECT:
 *    Guards the socket teardown order of the plugin HTTP boundary so a client
 *    that is still streaming an oversized body receives the promised 413
 *    response instead of ECONNRESET.
 *
 * KEY COMPONENTS:
 *    - Raw upload client: Writes the rejected body in 4 KiB chunks.
 *    - Deterministic rejection: The boundary rejects on the declared length.
 * ============================================================================
 */

import http from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureGoogleCalendarHttp } from '../../../src/plugins/google-calendar/controller-http.js';

const FRONTEND_ORIGIN = 'http://127.0.0.1:5173';
const BACKEND_ORIGIN = 'http://127.0.0.1:3000';
const BACKEND_HOST = '127.0.0.1:3000';
const BODY_CAP = 16 * 1024;

async function boot(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({}).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  app.setGlobalPrefix('api');
  configureGoogleCalendarHttp(app, {
    frontendOrigin: FRONTEND_ORIGIN,
    backendOrigin: BACKEND_ORIGIN,
    redirectUri: `${BACKEND_ORIGIN}/api/plugins/google-calendar/oauth/callback`,
  });
  await app.init();
  await app.listen(0, '127.0.0.1');
  return app;
}

describe('calendar setup HTTP teardown', () => {
  it('delivers the 413 fault while the rejected body is still uploading', async () => {
    const app = await boot();
    try {
      const address = app.getHttpServer().address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const payload = Buffer.from(JSON.stringify({ enabled: true, pad: 'x'.repeat(BODY_CAP + 1024) }));
      const reply = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const upload = http.request({
          host: '127.0.0.1', port, method: 'PATCH', path: '/api/plugins/google-calendar/settings',
          headers: {
            Host: BACKEND_HOST,
            Origin: FRONTEND_ORIGIN,
            'X-Aurvin-Calendar-CSRF': '1',
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
            await new Promise(done => setTimeout(done, 1));
          }
          upload.end();
        })();
      });
      expect(reply.status).toBe(413);
      expect(JSON.parse(reply.body)).toMatchObject({ code: 'INPUT_TOO_LARGE' });
    } finally { await app.close(); }
  });
});
