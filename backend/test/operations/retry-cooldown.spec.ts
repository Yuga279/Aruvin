/**
 * ============================================================================
 * FILE: retry-cooldown.spec.ts
 * LOCATION: backend/test/operations/retry-cooldown.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove explicit retries proceed during transient provider cooldown.
 *
 * ROLE IN PROJECT:
 *    P8 regression for P10 AC08/AC14: retry POST and its stream must not be
 *    rejected as NOT_READY while new submissions stay cooled and auth blocks
 *    still fail closed.
 *
 * KEY COMPONENTS:
 *    - Transient cooldown: retry 202 + stream 200, new submit 503, ready 503.
 *    - Auth block: retry and stream stay 503 until operator repair.
 * ============================================================================
 */

import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { OperationsModule, OperationsService, configureOperations } from '../../src/operations/index.js';
import { ChatHttpModule, configureChatHttp } from '../../src/http/index.js';
import { fixtureOptions } from '../http/fixtures.js';
import { options } from './fixtures.js';

let app: NestExpressApplication | null = null;
afterEach(async () => {
  if (app) await app.close();
  app = null;
});

async function boot() {
  const { o } = options();
  o.config.budgets.maxRequestsPerMinutePerUser = 100;
  const ops = new OperationsService(o);
  const chat = fixtureOptions();
  chat.runtime = ops.runtime;
  @Module({ imports: [OperationsModule.register({ service: ops }), ChatHttpModule.register(chat)] })
  class Harness {}
  app = await NestFactory.create<NestExpressApplication>(Harness, { bodyParser: false, logger: false });
  app.setGlobalPrefix('api');
  configureOperations(app, ops);
  configureChatHttp(app, o.config.budgets);
  await app.init();
  return { ops };
}

it('retry POST bypasses transient cooldown while new submissions stay cooled', async () => {
  const { ops } = await boot();
  ops.readiness.providerFailure('PROVIDER_ERROR');
  const agent = request(app!.getHttpServer());
  // Explicit retry of the failed turn proceeds as a new attempt.
  await agent.post('/api/sessions/s1/turns/t1/retry').send({ idempotencyKey: 'retry-key-001' }).expect(202);
  // New work stays cooled during the 30s window.
  await agent.post('/api/sessions').send({ sessionId: null, content: 'New', idempotencyKey: 'new-key-0001' }).expect(503);
  // Readiness still reports degraded for supervisors.
  await agent.get('/api/operations/ready').expect(503);
});

it('retry stream bypasses transient cooldown but auth blocks stay closed', async () => {
  const { ops } = await boot();
  ops.readiness.providerFailure('PROVIDER_ERROR');
  const agent = request(app!.getHttpServer());
  await agent.get('/api/sessions/s1/turns/t1/stream').expect(200);
  ops.readiness.providerFailure('PROVIDER_AUTH');
  await agent.post('/api/sessions/s1/turns/t1/retry').send({ idempotencyKey: 'retry-key-002' }).expect(503);
  await agent.get('/api/sessions/s1/turns/t1/stream').expect(503);
});

it('readForRetry ignores only transient degraded, never blocked or hard gates', async () => {
  const { o } = options();
  let now = 0;
  o.now = () => now;
  const ops = new OperationsService(o);
  ops.readiness.providerFailure('PROVIDER_ERROR');
  expect(await ops.readiness.read()).toMatchObject({ acceptReady: false, provider: 'degraded' });
  expect(await ops.readiness.readForRetry()).toMatchObject({ acceptReady: true, provider: 'degraded' });
  ops.readiness.providerFailure('PROVIDER_AUTH');
  expect(await ops.readiness.readForRetry()).toMatchObject({ acceptReady: false, provider: 'blocked' });
  const closed = options();
  closed.o.assetsReady = () => false;
  expect(await new OperationsService(closed.o).readiness.readForRetry()).toMatchObject({ acceptReady: false });
  now = 30001;
  expect(await ops.readiness.readForRetry()).toMatchObject({ acceptReady: false, provider: 'blocked' });
});

it('acceptForRetry still enforces the single-process concurrency cap', async () => {
  const { o, runtime } = options();
  const ops = new OperationsService(o);
  ops.readiness.providerFailure('PROVIDER_ERROR');
  vi.spyOn(runtime, 'snapshot').mockReturnValue({ accepting: true, active: 8, unresolvedWrites: 0, degraded: false });
  await expect(ops.acceptForRetry()).rejects.toMatchObject({ code: 'CONCURRENCY_LIMIT' });
  vi.mocked(runtime.snapshot).mockReturnValue({ accepting: true, active: 0, unresolvedWrites: 0, degraded: false });
  await expect(ops.acceptForRetry()).resolves.toBeUndefined();
});
