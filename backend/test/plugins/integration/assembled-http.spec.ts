import { expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import request from 'supertest';
import { calendarCompatibleEnvelopeSchema } from '../../../src/contracts/calendar-wire.js';
import { createWire, loadWire, textWire } from '../../runtime/calendar-runtime.fixture.js';
import { APPROVED_CREATE, VISIT, malformedCreateWire } from './wires.js';
import { SESSION_COOKIE } from '../../auth/fixtures.js';
import {
  BACKEND_HOST,
  FRONTEND_ORIGIN,
  openAssembledCalendar,
  openBlankAssembledCalendar,
} from './assembled.js';

function streamUrl(path: string): string {
  if (path.startsWith('/api/')) return path;
  return path.startsWith('/') ? `/api${path}` : `/api/${path}`;
}

it('assembled repair create keeps one ordered stream and one server user', async () => {
  const h = await openAssembledCalendar();
  try {
    h.modelWires.push(malformedCreateWire(), loadWire('calendar_create_event'),
      createWire(VISIT, 'create-one'), textWire('Created.'));
    const accepted = await request(h.app.getHttpServer())
      .post('/api/sessions')
      .set('Host', BACKEND_HOST).set('Origin', FRONTEND_ORIGIN).set('Cookie', SESSION_COOKIE)
      .set('Content-Type', 'application/json')
      .send({
        sessionId: null,
        content: APPROVED_CREATE,
        idempotencyKey: 'p9-assembled-repair',
        calendarProtocol: 2,
      });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(202);
    const port = h.port();
    const stream = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const incoming = httpRequest({
        hostname: '127.0.0.1', port, method: 'GET',
        path: streamUrl(String(accepted.body.streamPath)),
        headers: { Host: BACKEND_HOST, Origin: FRONTEND_ORIGIN, Cookie: SESSION_COOKIE, Accept: 'text/event-stream' },
      }, response => {
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of response) chunks.push(Buffer.from(chunk));
          resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') });
        })().catch(reject);
      });
      incoming.once('error', reject);
      incoming.end();
    });
    expect(stream.status, stream.text.slice(0, 500)).toBe(200);
    const frames = stream.text.split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => calendarCompatibleEnvelopeSchema.parse(JSON.parse(line.slice(5).trim())));
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.map((frame) => frame.sequence)).toEqual(frames.map((_, index) => index));
    expect(frames.some((frame) => frame.event.type === 'calendar-progress'
      && 'phase' in frame.event && frame.event.phase === 'repairing')).toBe(true);
    expect(frames.some((frame) => frame.event.type === 'calendar-operation'
      && 'operation' in frame.event && frame.event.operation.state === 'succeeded')).toBe(true);
    expect(frames.at(-1)?.event.type).toBe('completed');
    // The assembled application builds its own Calendar execution port, so the
    // durable effect is the single Google write on the shared fixture fetcher.
    expect(h.googleWrites()).toBe(1);
    const serverUser = h.modelBodies[0]?.user;
    expect(typeof serverUser).toBe('string');
    expect(String(serverUser).length).toBeGreaterThan(0);
    expect(h.modelBodies.every((body) => body.user === serverUser)).toBe(true);
    expect(JSON.stringify(h.modelBodies)).not.toMatch(/fixture-access-token|refresh_token|client_secret/i);
  } finally {
    await h.dispose();
  }
}, 20_000);

it('rejects a client identity override and a hostile setup origin before an effect', async () => {
  const h = await openAssembledCalendar();
  try {
    const status = await request(h.app.getHttpServer())
      .get('/api/plugins/google-calendar/status')
      .set('Host', BACKEND_HOST).set('Origin', FRONTEND_ORIGIN).set('Cookie', SESSION_COOKIE);
    expect(status.status).not.toBe(404);
    expect(status.status).toBe(200);
    const override = await request(h.app.getHttpServer())
      .post('/api/sessions')
      .set('Host', BACKEND_HOST).set('Origin', FRONTEND_ORIGIN).set('Cookie', SESSION_COOKIE)
      .set('Content-Type', 'application/json')
      .send({
        sessionId: null,
        content: APPROVED_CREATE,
        idempotencyKey: 'p9-identity-override',
        calendarProtocol: 2,
        userId: 'browser-user',
      });
    expect(override.status).toBeGreaterThanOrEqual(400);
    expect(override.status).not.toBe(404);
    const hostile = await request(h.app.getHttpServer())
      .patch('/api/plugins/google-calendar/settings')
      .set('Host', BACKEND_HOST).set('Origin', 'https://evil.example')
      .set('X-Aurvin-Calendar-CSRF', '1')
      .set('Content-Type', 'application/json')
      .send({ enabled: true });
    expect(hostile.status).toBe(403);
    expect(h.effects).toEqual([]);
    expect(h.modelBodies).toEqual([]);
  } finally {
    await h.dispose();
  }
}, 20_000);

it('refuses a Calendar setup mutation without the CSRF header', async () => {
  const h = await openAssembledCalendar();
  try {
    const missing = await request(h.app.getHttpServer())
      .patch('/api/plugins/google-calendar/settings')
      .set('Host', BACKEND_HOST).set('Origin', FRONTEND_ORIGIN).set('Cookie', SESSION_COOKIE)
      .set('Content-Type', 'application/json')
      .send({ enabled: true });
    expect(missing.status).toBe(403);
    const wrongHost = await request(h.app.getHttpServer())
      .get('/api/plugins/google-calendar/status')
      .set('Host', 'evil.example').set('Origin', FRONTEND_ORIGIN).set('Cookie', SESSION_COOKIE);
    expect(wrongHost.status).toBe(403);
    expect(h.effects).toEqual([]);
  } finally {
    await h.dispose();
  }
}, 20_000);

it('reports a default-off Calendar status and live diagnostics without a configured plugin', async () => {
  const h = await openBlankAssembledCalendar();
  try {
    const status = await request(h.app.getHttpServer())
      .get('/api/plugins/google-calendar/status')
      .set('Host', h.backendHost).set('Origin', h.frontendOrigin).set('Cookie', SESSION_COOKIE);
    expect(status.status).toBe(200);
    // The v2 status envelope is the whole body: it carries the connection
    // revision, the saved default, the discovered primary and the missing
    // scopes, and it never carries the pinned target of the legacy protocol.
    expect(status.body).toEqual({
      protocolVersion: 2,
      state: 'disabled',
      enabled: false,
      accountEmail: null,
      processingDisclosure: null,
      connectionRevision: null,
      defaultSetting: null,
      primaryCalendarId: null,
      discovery: null,
      missingScopes: [],
    });
    expect(JSON.stringify(status.body)).not.toMatch(/access_token|refresh_token|client_secret/i);
    const live = await request(h.app.getHttpServer())
      .get('/api/operations/live')
      .set('Host', h.backendHost);
    expect(live.status).toBe(200);
  } finally {
    await h.dispose();
  }
}, 20_000);
