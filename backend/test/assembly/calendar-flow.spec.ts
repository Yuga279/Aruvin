import http from 'node:http';
import { createHash } from 'node:crypto';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { AppService } from '../../src/app.service.js';
import { configureApplication } from '../../src/main.js';
import { calendarCompatibleEnvelopeSchema } from '../../src/contracts/calendar-wire.js';
import { calendarInputSchemas } from '../../src/contracts/calendar-tools.js';
import { AURVIN_CONFIG } from '../../src/platform/tokens.js';
import { nativeFrame } from '../model/calendar-fixtures.js';
import { createWire, textWire } from '../runtime/calendar-runtime.fixture.js';
import { loadWire } from './skill-fixture.js';
import { CalendarApiTools } from '../../src/plugins/google-calendar/tools.js';
import { SESSION_COOKIE } from '../auth/fixtures.js';
import { assembledCalendarApp } from './calendar-fixture.js';

const FRONTEND = 'http://127.0.0.1:5173';
const action = calendarInputSchemas.calendar_create_event.parse({
  summary: 'Planning', start: '2026-10-22T10:00:00+00:00',
  end: '2026-10-22T11:00:00+00:00', timeZone: 'Etc/UTC',
});
const content = 'Schedule Planning on 2026-10-22 from 10:00 to 11:00 Etc/UTC.';
const diagnosticHash = (value: string) => `h:${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;

function malformedCreateWire(): string {
  return nativeFrame({
    role: 'assistant',
    tool_calls: [{
      index: 0, id: 'call_bad', type: 'function',
      function: { name: 'call_tool', arguments: '{"plugin":"google-calendar","tool":"calendar_create_event","arguments":{"summary":' },
    }],
  }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
}

async function boot(writeLog?: (line: string) => void) {
  const assembled = await assembledCalendarApp(writeLog ? { writeLog } : {});
  const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
  process.env.NODE_ENV = 'development';
  process.env.FRONTEND_ORIGIN = FRONTEND;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(assembled.bootstrap)
      .overrideProvider(AppService).useValue(assembled.service).compile();
    const app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false, logger: false,
    });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    return { ...assembled, app };
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.FRONTEND_ORIGIN === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = previous.FRONTEND_ORIGIN;
  }
}

it('plugin-only outage keeps ordinary text admission healthy', async () => {
  const started = await assembledCalendarApp();
  try {
    const ready = await started.service.operations.readiness.read();
    expect(ready.live).toBe(true);
    expect(ready.calendar?.state).toBe('connected');
    expect(started.fetcher.mock.calls.some(call => String(call[0]).includes('googleapis'))).toBe(false);
  } finally {
    await started.dispose();
  }
});

it('assembled Calendar repair and receipt', async () => {
  const logLines: string[] = [];
  const started = await boot(line => { logLines.push(line); });
  const invoke = vi.spyOn(CalendarApiTools.prototype, 'invoke');
  try {
    started.cal.modelWires.push(malformedCreateWire(), loadWire(['calendar_create_event'], 'flow-load'),
      createWire(action, 'create-one'), textWire('Created.'));
    const accepted = await request(started.app.getHttpServer())
      .post('/api/sessions')
      .set('Host', '127.0.0.1:3000').set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE)
      .set('Content-Type', 'application/json')
      .send({ sessionId: null, content, idempotencyKey: 'cal-flow-0001', calendarProtocol: 2 })
      .expect(202);
    const saved = await started.service.sessions.get('aurvin-dev-user', accepted.body.sessionId);
    expect(saved, JSON.stringify(accepted.body)).toMatchObject({ lifecycle: 'active' });
    const address = started.app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const { streamStatus, streamText, streamRequestId } = await new Promise<{
      streamStatus: number; streamText: string; streamRequestId: string;
    }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/api${accepted.body.streamPath}`, {
        headers: { Host: '127.0.0.1:3000', Origin: FRONTEND, Cookie: SESSION_COOKIE, Accept: 'text/event-stream' },
      }, res => {
        let text = '';
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ streamStatus: res.statusCode ?? 0, streamText: text,
          streamRequestId: String(res.headers['x-request-id'] ?? '') }));
      });
      req.on('error', reject);
    });
    expect(streamStatus, streamText.slice(0, 500)).toBe(200);
    const frames = streamText.split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => calendarCompatibleEnvelopeSchema.parse(JSON.parse(line.slice(5).trim())));
    const modelBodies = started.cal.modelBodies;
    const calendarCreates = started.cal.fetcher.mock.calls.filter(call =>
      String(call[0]).includes('/calendar/v3/calendars/') && String(call[1]?.method ?? 'GET') === 'POST');
    expect(modelBodies).toHaveLength(3);
    expect(calendarCreates).toHaveLength(1);
    expect(modelBodies.every(body => body.user === 'aurvin-dev-user')).toBe(true);
    expect(frames.map(frame => frame.sequence)).toEqual(frames.map((_, index) => index));
    expect(frames.some(frame => frame.event.type === 'calendar-progress'
      && frame.event.phase === 'repairing')).toBe(true);
    expect(frames.some(frame => frame.event.type === 'calendar-operation'
      && frame.event.operation.state === 'succeeded')).toBe(true);
    expect(frames.at(-1)?.event.type).toBe('completed');
    expect(invoke).toHaveBeenCalled();
    const attemptId = diagnosticHash(accepted.body.attemptId);
    const submitRequestId = String(accepted.headers['x-request-id'] ?? '');
    const records = logLines.map(line => JSON.parse(line) as Record<string, unknown>);
    const admission = records.find(record => record.kind === 'process' && record.stage === 'admission'
      && record.state === 'ok' && record.attemptId === attemptId);
    const dispatch = records.find(record => record.kind === 'process' && record.stage === 'model-dispatch'
      && record.attemptId === attemptId);
    const terminal = records.find(record => record.kind === 'process' && record.stage === 'terminal'
      && record.attemptId === attemptId);
    expect(submitRequestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(streamRequestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(streamRequestId).not.toBe(submitRequestId);
    expect(admission).toMatchObject({ requestId: submitRequestId, attemptId });
    expect(dispatch).toMatchObject({ requestId: streamRequestId, attemptId });
    expect(terminal).toMatchObject({ requestId: streamRequestId, attemptId, chat: 'completed' });
  } finally {
    invoke.mockRestore();
    await started.app.close();
    await started.dispose();
  }
});
