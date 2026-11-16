/**
 * ============================================================================
 * FILE: routes.e2e-spec.ts
 * LOCATION: backend/test/http/routes.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Assert exact P7 chat routes, parser errors, and no-leak HTTP statuses.
 *
 * ROLE IN PROJECT:
 *    Exercises the exported Nest module against fake ports so resource paths,
 *    identity rejection, and early stream JSON failures stay contract-stable.
 *
 * KEY COMPONENTS:
 *    - Route tests: Sessions, turns, cancel, retry, and SSE completion.
 *    - Parser tests: Privileged fields, bounds, malformed JSON, forged headers.
 *    - Mapping tests: P5 conflicts and pre-header stream failures.
 * ============================================================================
 */

import request from 'supertest';
import { Test } from '@nestjs/testing';
import { ChatHttpModule,ChatHttpService } from '../../src/http/index.js';
import { httpHarness } from './http-harness.js';
import { fixtureOptions,submission,ids } from './fixtures.js';
import { AppError } from '../../src/platform/errors/app-error.js';
it('serves exact P7 routes and never persists a chat merely from navigation', async () => {
  const o = fixtureOptions(); const h = await httpHarness(o);
  try {
    const api = request(h.app.getHttpServer());
    await api.get('/api/sessions').expect(200,{ items:[],nextCursor:null });
    await api.get('/api/sessions/s1').expect(200);
    await api.get('/api/sessions/s1/messages?limit=2').expect(200);
    await api.patch('/api/sessions/s1').send({ title: 'Renamed', pinned: true }).expect(200);
    expect(o.sessions.update).toHaveBeenCalledWith('server-user', 's1', { title: 'Renamed', pinned: true });
    await api.patch('/api/sessions/s1').send({ pinned: 'yes' }).expect(400);
    await api.delete('/api/sessions/s1').expect(204);
    expect(o.sessions.delete).toHaveBeenCalledWith('server-user', 's1');
    expect(o.runtime.submitTurn).not.toHaveBeenCalled(); expect(o.sessions.createIfAbsent).not.toHaveBeenCalled();
    await api.post('/api/sessions').send(submission).expect(202,ids);
    await api.post('/api/sessions/s1/turns').send({ ...submission,sessionId:'s1' }).expect(202,ids);
    await api.get('/api/sessions/s1/turns/t1').expect(200);
    await api.post('/api/sessions/s1/turns/t1/retry').send({ idempotencyKey:'retry-0001' }).expect(202);
    await api.post('/api/sessions/s1/turns/t1/cancel').send({ attemptId:'a1' }).expect(204);
    const stream = await fetch(`${h.url}/api${ids.streamPath}`,{ headers:{ Accept:'text/event-stream' } });
    expect(stream.status).toBe(200); expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const text = await stream.text(); expect(text).toContain('"protocolVersion":1'); expect(text).toContain('"type":"completed"');
    expect(text).not.toMatch(/graphThread|checkpoint|openRouterUser|apiKey/);
  } finally { await h.close(); }
});
it('returns stable parser/validation errors and ignores forged identity headers', async () => {
  const o = fixtureOptions(); const h = await httpHarness(o);
  try {
    const api = request(h.app.getHttpServer());
    for (const [field,code] of [['userId','IDENTITY_OVERRIDE_REJECTED'], ['modelId','MODEL_OVERRIDE_REJECTED'],
      ['role','UNKNOWN_FIELD'], ['tools','UNKNOWN_FIELD']] as const) {
      const res = await api.post('/api/sessions').send({ ...submission,[field]:'sk-private' }).expect(400);
      expect(res.body.code).toBe(code); expect(JSON.stringify(res.body)).not.toContain('sk-private');
    }
    await api.post('/api/sessions').send({}).expect(400);
    await api.post('/api/sessions').send({ ...submission,sessionId:'s1' }).expect(400);
    await api.post('/api/sessions/s1/turns').send({ ...submission,sessionId:'other' }).expect(400);
    for (const query of ['limit=0','limit=51','limit=2&limit=3','cursor=','cursor[x]=y','userId=other'])
      await api.get(`/api/sessions?${query}`).expect(400);
    const malformed = await api.post('/api/sessions').set('Content-Type','application/json').send('{"apiKey":').expect(400);
    expect(malformed.body.code).toBe('INVALID_REQUEST'); expect(malformed.body).not.toHaveProperty('stack');
    await api.post('/api/sessions').send({ ...submission,content:'x'.repeat(32001) }).expect(413);
    const giant = await api.post('/api/sessions').set('Content-Type','application/json').send(JSON.stringify({ content:'x'.repeat(270000) })).expect(413);
    expect(giant.body.code).toBe('INPUT_TOO_LARGE');
    await api.post('/api/sessions').set('X-User-Id','attacker').send(submission).expect(202);
    expect(o.runtime.submitTurn).toHaveBeenCalledWith(expect.objectContaining({ identity:o.identity.resolve() }));
  } finally { await h.close(); }
});
it('maps P5 conflicts and early stream failures to JSON without leaking exceptions', async () => {
  const o = fixtureOptions(); const h = await httpHarness(o);
  try {
    const api = request(h.app.getHttpServer());
    for (const code of ['IDEMPOTENCY_PAYLOAD_MISMATCH','CONFLICT_ACTIVE_TURN'] as const) {
      vi.mocked(o.runtime.submitTurn).mockRejectedValueOnce(new AppError(code,'private prompt sk-private'));
      const res = await api.post('/api/sessions').send(submission).expect(409);
      expect(res.body.code).toBe(code); expect(res.body.message).not.toMatch(/private/);
    }
    vi.mocked(o.runtime.executeTurn).mockRejectedValueOnce(new AppError('NOT_READY','raw checkpoint'));
    const early = await api.get('/api/sessions/s1/turns/t1/stream').expect(503);
    expect(early.body.code).toBe('NOT_READY'); expect(early.headers['content-type']).toContain('application/json');
    vi.mocked(o.sessions.get).mockResolvedValueOnce(null);
    await api.get('/api/sessions/foreign/messages').expect(404);
    vi.mocked(o.runtime.getTurnStatus).mockRejectedValueOnce(new AppError('NOT_FOUND','private ids'));
    await api.get('/api/sessions/s1/turns/foreign/stream').expect(404);
  } finally { await h.close(); }
});
it('rejects unknown stream/query fields, returns terminal error reattachments honestly, and never exposes internals',async () => {
  const o = fixtureOptions(); const h = await httpHarness(o);
  try {
    const api = request(h.app.getHttpServer());
    await api.get('/api/sessions/s1/turns/t1/stream?checkpoint=private').expect(400);
    await api.post('/api/sessions/s1/turns/t1/cancel').send({ attemptId:'a1',user:'other' }).expect(400);
    vi.mocked(o.runtime.executeTurn).mockImplementationOnce(async c => {
      await c.emit({ protocolVersion:1,sessionId:c.sessionId,turnId:c.turnId,attemptId:c.attemptId,sequence:0,
        event:{ type:'status',status:'failed',truncated:false } });
    });
    vi.mocked(o.runtime.getTurnStatus).mockResolvedValueOnce({ sessionId:'s1',turnId:'t1',attemptId:'a1',status:'failed',truncated:false,
      error:{ code:'PROVIDER_ERROR',message:'sk-private stack graph prompt',retryable:false } });
    const response = await fetch(`${h.url}/api/sessions/s1/turns/t1/stream`); const text = await response.text();
    expect(text).toContain('"type":"error"'); expect(text).not.toMatch(/sk-private|graph prompt|"type":"completed"/);
    vi.mocked(o.runtime.getTurnStatus).mockRejectedValueOnce(new Error('raw mongo dump private instructions'));
    const failure = await api.get('/api/sessions/s1/turns/t1').expect(503);
    expect(Object.keys(failure.body).sort()).toEqual(['code','message','retryable']);
    expect(JSON.stringify(failure.body)).not.toMatch(/mongo|instructions|stack|cause/);
  } finally { await h.close(); }
});
it('supports async P9 composition without manufacturing another runtime', async () => {
  const options = fixtureOptions();
  const module = await Test.createTestingModule({ imports:[ChatHttpModule.registerAsync({
    useFactory:async () => options,
  })] }).compile();
  try { expect(module.get(ChatHttpService).o.runtime).toBe(options.runtime); }
  finally { await module.close(); }
});

it('admits requests and initializes stream writer when currentConfig is injected', async () => {
  const o = fixtureOptions();
  const snap = {
    budgets: { ...o.budgets, idleStreamTimeoutMs: 15000, maxMessageBytes: 32000, maxConcurrentGenerationsPerProcess: 5 },
    openRouter: { apiKey: 'fixture-key', modelId: 'fixture-model', dataCollection: 'deny' as const },
    modelLimits: { modelId: 'fixture-model', contextTokens: 4096, maxOutputTokens: 1024, maxInputTokens: 2048, titleMaxChars: 50 },
  };
  o.currentConfig = { current: () => snap };
  o.runtime.attemptStreamBudgets = vi.fn(() => ({
    idleStreamTimeoutMs: 15000,
    maxMessageBytes: 32000,
  }));
  const h = await httpHarness(o);
  try {
    const api = request(h.app.getHttpServer());
    await api.post('/api/sessions').send(submission).expect(202, ids);
    const stream = await fetch(`${h.url}/api${ids.streamPath}`, { headers: { Accept: 'text/event-stream' } });
    expect(stream.status).toBe(200);
    expect(o.runtime.attemptStreamBudgets).toHaveBeenCalledWith('server-user', 's1', 'a1');
  } finally {
    await h.close();
  }
});

