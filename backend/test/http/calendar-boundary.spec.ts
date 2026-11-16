import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { configureCalendarChatBoundary } from '../../src/http/calendar-boundary.js';
import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { fixtureOptions, submission } from './fixtures.js';

const FRONTEND = 'http://127.0.0.1:5173';
const BACKEND = 'http://127.0.0.1:3000';

async function boundApp() {
  const module = await Test.createTestingModule({ controllers: [] }).compile();
  const app = module.createNestApplication<NestExpressApplication>({
    bodyParser: false, logger: false,
  });
  app.setGlobalPrefix('api');
  configureCalendarChatBoundary(app, { frontendOrigin: FRONTEND, backendOrigin: BACKEND });
  app.use((req, res) => {
    res.status(204).end();
  });
  await app.listen(0, '127.0.0.1');
  return app;
}

it('rejects hostile Host, Origin, forms and forged Fetch Metadata before acceptance', async () => {
  const app = await boundApp();
  try {
    const agent = request(app.getHttpServer());
    await agent.post('/api/sessions')
      .set('Host', 'evil.invalid').set('Origin', FRONTEND)
      .set('Content-Type', 'application/json').send({}).expect(403);
    await agent.post('/api/sessions')
      .set('Host', '127.0.0.1:3000').set('Origin', 'https://evil.invalid')
      .set('Content-Type', 'application/json').send({}).expect(403);
    await agent.post('/api/sessions')
      .set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:9999')
      .set('Content-Type', 'application/json').send({}).expect(403);
    await agent.post('/api/sessions')
      .set('Host', '127.0.0.1:3000')
      .set('Content-Type', 'application/json').send({}).expect(403);
    await agent.post('/api/sessions')
      .set('Host', '127.0.0.1:3000').set('Origin', FRONTEND)
      .set('Content-Type', 'application/x-www-form-urlencoded').send('a=1').expect(403);
    await agent.get('/api/sessions/s1/turns/t1/stream')
      .set('Host', '127.0.0.1:3000').set('Origin', 'https://evil.invalid')
      .set('Sec-Fetch-Site', 'same-origin').set('Sec-Fetch-Mode', 'cors')
      .set('Sec-Fetch-Dest', 'empty').expect(403);
    await agent.get('/api/sessions/s1/turns/t1/stream')
      .set('Host', '127.0.0.1:3000').expect(403);
    const ok = await agent.get('/api/sessions')
      .set('Host', '127.0.0.1:3000').set('Origin', FRONTEND).expect(204);
    expect(JSON.stringify(ok.body)).not.toMatch(/evil|9999|Host/i);
  } finally {
    await app.close();
  }
});

it('admits exact Origin mutations and same-origin fetch GETs', async () => {
  const app = await boundApp();
  try {
    const agent = request(app.getHttpServer());
    await agent.post('/api/sessions')
      .set('Host', '127.0.0.1:3000').set('Origin', FRONTEND)
      .set('Content-Type', 'application/json').send({}).expect(204);
    await agent.get('/api/sessions/s1/turns/t1/stream')
      .set('Host', '127.0.0.1:3000')
      .set('Sec-Fetch-Site', 'same-origin').set('Sec-Fetch-Mode', 'cors')
      .set('Sec-Fetch-Dest', 'empty').expect(204);
    await agent.options('/api/sessions')
      .set('Host', '127.0.0.1:3000').set('Origin', FRONTEND).expect(204);
  } finally {
    await app.close();
  }
});

it('requires calendarProtocol 2 only while Calendar tools are enabled', async () => {
  const o = fixtureOptions();
  o.currentConfig = { current: () => ({ calendar: { enabled: true } } as never) };
  const service = new ChatHttpService(o);
  await expect(service.submit(null, submission)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(o.runtime.submitTurn).not.toHaveBeenCalled();
  await expect(service.submit(null, { ...submission, calendarProtocol: 2 })).resolves.toMatchObject({ sessionId: 's1' });
  await expect(service.retry('s1', 't1', { idempotencyKey: 'retry-0001' }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(o.runtime.retryTurn).not.toHaveBeenCalled();
  await expect(service.retry('s1', 't1', { idempotencyKey: 'retry-0001', calendarProtocol: 2 }))
    .resolves.toMatchObject({ attemptId: 'a2' });
  o.currentConfig = { current: () => ({ calendar: { enabled: false } } as never) };
  await expect(service.submit(null, submission)).resolves.toMatchObject({ sessionId: 's1' });
});
