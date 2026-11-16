/**
 * ============================================================================
 * FILE: app.e2e-spec.ts
 * LOCATION: backend/test/app.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove diagnostic greeting, health, and not-ready chat without a database.
 *
 * ROLE IN PROJECT:
 *    Routine e2e check that boots AppModule in diagnostic mode so it cannot
 *    open a developer database or call a provider during default CI.
 *
 * KEY COMPONENTS:
 *    - Diagnostic AppService: Persistence and fetch ports fail closed.
 *    - Ready/session assertions: Generation is not ready; secrets stay absent.
 * ============================================================================
 */

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AppService } from '../src/app.service.js';
import { configureApplication } from '../src/main.js';
import { loadBootstrapConfig } from '../src/platform/config/bootstrap-config.js';
import { AURVIN_CONFIG } from '../src/platform/tokens.js';

describe('AppController (e2e)', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const calls: string[] = [];
    const config = loadBootstrapConfig({});
    const service = await AppService.create(config, {
      writeLog: () => undefined,
      fetcher: async (url) => { calls.push(String(url)); throw new Error('diagnostic e2e called a provider'); },
      open: async () => { throw new Error('diagnostic e2e opened persistence'); },
    });
    const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(AURVIN_CONFIG).useValue(config)
        .overrideProvider(AppService).useValue(service).compile();
      app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
    } finally {
      if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.NODE_ENV;
      if (previous.FRONTEND_ORIGIN === undefined) delete process.env.FRONTEND_ORIGIN;
      else process.env.FRONTEND_ORIGIN = previous.FRONTEND_ORIGIN;
    }
    configureApplication(app);
    await app.init();
    expect(calls).toEqual([]);
  });

  it('/api (GET)', () => request(app.getHttpServer()).get('/api').expect(503));

  it('/api/health (GET)', () => request(app.getHttpServer()).get('/api/health').expect(503));

  it('diagnostic readiness is not generation readiness and does not call a provider', async () => {
    const ready = await request(app.getHttpServer()).get('/api/operations/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.error?.code ?? ready.body.code).toBe('NOT_READY');
    expect(JSON.stringify(ready.body)).not.toMatch(/fixture-key|mongodb:\/\//u);
    await request(app.getHttpServer()).post('/api/sessions')
      .send({ sessionId: null, content: 'diagnostic', idempotencyKey: 'diagnostic-request' })
      .expect(403);
  });

  afterEach(() => app.close());
});
