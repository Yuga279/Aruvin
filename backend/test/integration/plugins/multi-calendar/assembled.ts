/**
 * ============================================================================
 * FILE: assembled.ts
 * LOCATION: backend/test/integration/plugins/multi-calendar/assembled.ts
 * ============================================================================
 * PURPOSE:
 *    Adapt P8's single Calendar assembly to bounded local integration requests.
 * ROLE IN PROJECT:
 *    Installs production Nest middleware and retains the same AppService/store.
 *    External HTTP remains P8's injected scripted fetch, never global fetch.
 * KEY COMPONENTS:
 *    - openApp: HTTP boot, submission, SSE collection and deterministic disposal.
 *    - Ledger restoration: Measure production accounting, not fixture replacement.
 * ============================================================================
 */
import 'reflect-metadata';
import { request as httpRequest } from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { expect, vi } from 'vitest';
import { AppModule } from '../../../../src/app.module.js';
import { AppService } from '../../../../src/app.service.js';
import { configureApplication } from '../../../../src/main.js';
import { AURVIN_CONFIG } from '../../../../src/platform/tokens.js';
import { CalendarTurnLedger } from '../../../../src/chat-runtime/calendar-budget.js';
import { submitTurnResponseSchema, type SubmitTurnResponse } from '../../../../src/contracts/api.js';
import type { CalendarReplyReference } from '../../../../src/contracts/calendar-authority.js';
import { calendarCompatibleEnvelopeSchema } from '../../../../src/contracts/calendar-wire.js';
import { SESSION_COOKIE } from '../../../auth/fixtures.js';
import { assembledCalendarApp } from '../../../assembly/calendar-fixture.js';

const origin = 'http://127.0.0.1:5173';
const host = '127.0.0.1:3000';

export async function openApp() {
  const h = await assembledCalendarApp();
  const ledger = CalendarTurnLedger.prototype.chargeCalendarRequest;
  if (vi.isMockFunction(ledger)) ledger.mockRestore();
  expect(vi.isMockFunction(CalendarTurnLedger.prototype.chargeCalendarRequest)).toBe(false);
  let app: NestExpressApplication | undefined;
  let serial = 0;
  const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
  try {
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_ORIGIN = origin;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(h.bootstrap)
      .overrideProvider(AppService).useValue(h.service).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  } catch (error) {
    try { await app?.close(); } finally { await h.dispose(); }
    throw error;
  } finally {
    for (const key of ['NODE_ENV', 'FRONTEND_ORIGIN'] as const) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  const running = app;
  const address = running.getHttpServer().address();
  if (!address || typeof address === 'string') {
    try { await running.close(); } finally { await h.dispose(); }
    throw new Error('Expected a loopback fixture port.');
  }
  function accept(content: string, sessionId: string | null = null,
    key = `multi-calendar-${++serial}`, calendarReplyTo?: CalendarReplyReference) {
    const path = sessionId ? `/api/sessions/${sessionId}/turns` : '/api/sessions';
    return request(running.getHttpServer()).post(path)
      .set('Host', host).set('Origin', origin).set('Cookie', SESSION_COOKIE).send({ sessionId, content,
        idempotencyKey: key, calendarProtocol: 2,
        ...(calendarReplyTo ? { calendarReplyTo } : {}) });
  }
  async function submit(content: string, sessionId: string | null = null,
    calendarReplyTo?: CalendarReplyReference): Promise<SubmitTurnResponse> {
    const response = await accept(content, sessionId, undefined, calendarReplyTo);
    expect(response.status).toBe(202);
    return submitTurnResponseSchema.parse(response.body);
  }
  return {
    ...h, app: running, accept, submit,
    plugin(method: 'get' | 'post' | 'patch', path: string, body?: object) {
      const call = request(running.getHttpServer())[method](`/api/plugins/google-calendar/${path}`)
        .set('Host', host).set('Origin', origin).set('Cookie', SESSION_COOKIE);
      return method === 'get' ? call : call.set('X-Aurvin-Calendar-CSRF', '1').send(body ?? {});
    },
    async stream(ids: SubmitTurnResponse) {
      const path = ids.streamPath.startsWith('/api/') ? ids.streamPath : `/api${ids.streamPath}`;
      const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
        const incoming = httpRequest({
          hostname: '127.0.0.1', port: address.port, method: 'GET', path,
          headers: { Host: host, Origin: origin, Cookie: SESSION_COOKIE, Accept: 'text/event-stream' },
        }, incomingResponse => {
          void (async () => {
            const chunks: Buffer[] = [];
            for await (const chunk of incomingResponse) chunks.push(Buffer.from(chunk));
            resolve({ status: incomingResponse.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') });
          })().catch(reject);
        });
        incoming.once('error', reject);
        incoming.end();
      });
      expect(response.status).toBe(200);
      const frames = response.text.split('\n').filter(line => line.startsWith('data:'))
        .map(line => calendarCompatibleEnvelopeSchema.parse(JSON.parse(line.slice(5).trim())));
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.map(frame => frame.sequence)).toEqual(frames.map((_, index) => index));
      return frames;
    },
    async dispose() {
      try { await running.close(); } finally { await h.dispose(); }
    },
  };
}
