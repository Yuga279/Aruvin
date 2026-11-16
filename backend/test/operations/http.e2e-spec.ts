/**
 * ============================================================================
 * FILE: http.e2e-spec.ts
 * LOCATION: backend/test/operations/http.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Exercise real Nest middleware, health routes, and admission against fakes.
 *
 * ROLE IN PROJECT:
 *    Proves P8 HTTP wiring without P9 entry points: live vs ready, control-path
 *    preservation, rate limits, no-store headers, and async module factory.
 *
 * KEY COMPONENTS:
 *    - Isolated harness: OperationsModule plus ChatHttpModule on /api.
 *    - Path-alias and factory regressions: Admission before command dispatch.
 * ============================================================================
 */

import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { OperationsModule,OperationsService,configureOperations } from '../../src/operations/index.js';
import { ChatHttpModule,configureChatHttp } from '../../src/http/index.js';
import { fixtureOptions } from '../http/fixtures.js';
import { options } from './fixtures.js';
let app:NestExpressApplication;
afterEach(async () => { if (app) await app.close(); });
async function boot() {
  const { o }=options(); o.config.budgets.maxRequestsPerMinutePerUser=2;
  const ops=new OperationsService(o); const chat=fixtureOptions(); chat.runtime=ops.runtime;
  @Module({ imports:[OperationsModule.register({ service:ops }),ChatHttpModule.register(chat)] })
  class Harness {}
  app=await NestFactory.create<NestExpressApplication>(Harness,{ bodyParser:false,logger:false });
  app.setGlobalPrefix('api'); configureOperations(app,ops); configureChatHttp(app,o.config.budgets);
  await app.init(); return { ops,o,chat };
}
it('returns live vs not-ready during provider outage and preserves read/cancel control paths', async () => {
  const { ops }=await boot(); ops.readiness.providerFailure('PROVIDER_ERROR');
  await request(app.getHttpServer()).get('/api/operations/live').expect(200);
  await request(app.getHttpServer()).get('/api/operations/ready').expect(503);
  await request(app.getHttpServer()).get('/api/sessions').expect(200);
  // Explicit retries and their streams bypass only the transient cooldown so a
  // failed turn can add an attempt; new-submission cooling is covered in
  // retry-cooldown.spec.ts with headroom above this harness rate cap.
  await request(app.getHttpServer()).post('/api/sessions/s1/turns/t1/retry').send({ idempotencyKey:'request-retry-0001' }).expect(202);
  await request(app.getHttpServer()).get('/api/sessions/s1/turns/t1/stream').expect(200);
  await request(app.getHttpServer()).post('/api/sessions/s1/turns/t1/cancel').send({ attemptId:'a1' }).expect(204);
});
it('rates stream starts as admission and returns safe early errors and server request IDs', async () => {
  await boot(); const agent=request(app.getHttpServer());
  const input={ sessionId:null,content:'Hello',idempotencyKey:'request-0001' };
  await agent.post('/api/sessions').send(input).expect(202);
  await agent.post('/api/sessions').send(input).expect(202);
  const rejected=await agent.get('/api/sessions/s1/turns/t1/stream').set('X-Request-ID','private prompt').expect(429);
  expect(rejected.headers['retry-after']).toBe('60');
  expect(rejected.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
  expect(rejected.body).toMatchObject({ code:'RATE_LIMITED' });
  expect(JSON.stringify(rejected.body)).not.toContain('private prompt');
  await agent.get('/api/sessions').expect(200);
});
it('keeps all health/metric/error responses no-store and strips dependency secrets', async () => {
  const { ops }=await boot(); ops.readiness.providerFailure('PROVIDER_AUTH');
  for (const path of ['/api/operations/ready','/api/operations/metrics']) {
    const response=await request(app.getHttpServer()).get(path);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(response.body)).not.toMatch(/sk-fixture|mongodb:\/\/fixture|fixture\/model/);
  }
  for (const path of ['/api/sessions/','/API/sessions']) {
    const response=await request(app.getHttpServer()).post(path).send({}).expect(503);
    expect(response.headers['cache-control']).toContain('no-store');
  }
});
it('blocks before P6 command dispatch and supports the asynchronous module factory', async () => {
  const { o }=options(); o.config.budgets.maxRequestsPerMinutePerUser=1;
  const ops=new OperationsService(o); const chat=fixtureOptions(); chat.runtime=ops.runtime;
  @Module({ imports:[OperationsModule.registerAsync({ useFactory:async () => ({ service:ops }) }),
    ChatHttpModule.register(chat)] })
  class AsyncHarness {}
  app=await NestFactory.create<NestExpressApplication>(AsyncHarness,{ bodyParser:false,logger:false });
  app.setGlobalPrefix('api'); configureOperations(app,ops); configureChatHttp(app,o.config.budgets); await app.init();
  const input={ sessionId:null,content:'Hello',idempotencyKey:'request-0001' };
  await request(app.getHttpServer()).post('/api/sessions').send(input).expect(202);
  await request(app.getHttpServer()).post('/api/sessions').send(input).expect(429);
  expect(o.runtime()?.submitTurn).toHaveBeenCalledTimes(1);
});
