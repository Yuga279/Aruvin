/**
 * ============================================================================
 * FILE: runtime.native.e2e-spec.ts
 * LOCATION: backend/test/http/runtime.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove real P2/P5 chat HTTP lifecycle, disconnect, and recovery behavior.
 *
 * ROLE IN PROJECT:
 *    Uses the native Mongo harness, actual runtime, and Nest listener so
 *    duplicate/retry/cancel/EOF/finalization outcomes are durable evidence.
 *
 * KEY COMPONENTS:
 *    - Acceptance tests: Duplicate 202, payload conflict, durable completion.
 *    - Outcome tests: Truncated, failed, interrupted, and cancel/retry.
 *    - Disconnect tests: Abort before seal and saved-result recovery.
 * ============================================================================
 */

import request from 'supertest';
import { nativeHarness } from '../runtime/native-harness.js';
import { httpHarness } from './http-harness.js';
import { createChatRuntime } from '../../src/chat-runtime/index.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { parseSseDataLine } from '../../src/contracts/stream.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';
import { deferred } from './fixtures.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';
// The native database is acquired lazily inside each test body, never at import time.
async function nativeHttp(text:string = FRAMES.normal) {
  const h = await nativeHarness(text); const runtime = createChatRuntime(h.deps);
  try {
    const http = await httpHarness({ runtime,sessions:h.persistence.sessions,messages:h.persistence.messages,
      identity:new ServerIdentityResolver(h.deps.config),budgets:h.deps.config.budgets });
    return { ...h,http,runtime,close:async () => { await http.close(); await h.close(); } };
  } catch (error) { await h.close(); throw error; }
}
const command = { sessionId:null,content:'Hello',idempotencyKey:'request-0001' };
function frames(text:string) { return text.split('\n').filter(line => line.startsWith('data:')).map(parseSseDataLine); }

describe.skipIf(!configured)('HTTP runtime native lifecycle', () => {
  it('accepts once before inference, returns duplicates, rejects conflicts, then streams durable completion', async () => {
    const h = await nativeHttp();
    try {
      const api = request(h.http.app.getHttpServer());
      const [one,two] = await Promise.all([api.post('/api/sessions').send(command),api.post('/api/sessions').send(command)]);
      expect(one.status).toBe(202); expect(two.status).toBe(202); expect(one.body).toEqual(two.body);
      const ids = one.body as { sessionId:string;turnId:string;attemptId:string;streamPath:string };
      expect(h.fetcher).not.toHaveBeenCalled();
      expect(await h.persistence.metadata.getAcceptance(h.identity.userId,ids.sessionId,ids.attemptId)).not.toBeNull();
      await api.post('/api/sessions').send({ ...command,content:'Changed' }).expect(409);
      await api.post(`/api/sessions/${ids.sessionId}/turns`).send({ ...command,sessionId:ids.sessionId,idempotencyKey:'request-0002' }).expect(409);
      const response = await fetch(`${h.http.url}/api${ids.streamPath}`); const events = frames(await response.text());
      expect(events.map(e => e.sequence)).toEqual(events.map((_,i) => i));
      expect(events.at(-1)?.event).toMatchObject({ type:'completed',outcome:'completed' });
      expect(events.some(e => e.event.type === 'usage')).toBe(true);
      expect(h.fetcher).toHaveBeenCalledTimes(1);
      const outgoing = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body)) as { user:string;model:string };
      expect(outgoing.user).toBe(h.identity.userId); expect(outgoing.model).toBe(h.deps.config.openRouter.modelId);
      const status = await api.get(`/api/sessions/${ids.sessionId}/turns/${ids.turnId}`).expect(200);
      expect(status.body.status).toBe('completed');
      const archive = await api.get(`/api/sessions/${ids.sessionId}/messages`).expect(200);
      expect(archive.body.items.map((m:{ role:string }) => m.role)).toEqual(['user','assistant']);
      const reattach = await fetch(`${h.http.url}/api${ids.streamPath}`);
      expect(frames(await reattach.text()).some(e => e.event.type === 'delta')).toBe(false);
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await h.close(); }
  },30000);
  it.each([['length','truncated'],['errorBefore','failed'],['errorAfter','failed'],['eof','interrupted']] as const)
  ('reports %s honestly and never treats a provider EOF/error as saved success',async (fixture,outcome) => {
    const h = await nativeHttp(FRAMES[fixture]);
    try {
      const api = request(h.http.app.getHttpServer()); const accepted = await api.post('/api/sessions').send(command).expect(202);
      const ids = accepted.body as { sessionId:string;turnId:string;streamPath:string };
      const stream = await fetch(`${h.http.url}/api${ids.streamPath}`); const events = frames(await stream.text());
      const status = await h.runtime.getTurnStatus(h.identity.userId,ids.sessionId,ids.turnId);
      expect(status.status).toBe(outcome);
      expect(events.some(e => e.event.type === 'completed' && e.event.outcome === 'completed')).toBe(false);
      if (fixture === 'length') expect(events.at(-1)?.event).toMatchObject({ type:'completed',outcome:'truncated' });
    } finally { await h.close(); }
  },30000);
  it('cancel before attachment and explicit retry keep one original user input',async () => {
    const h = await nativeHttp();
    try {
      const api = request(h.http.app.getHttpServer()); const accepted = await api.post('/api/sessions').send(command).expect(202);
      const ids = accepted.body as { sessionId:string;turnId:string;attemptId:string;userMessageId:string };
      const path = `/api/sessions/${ids.sessionId}/turns/${ids.turnId}`;
      await api.post(`${path}/cancel`).send({ attemptId:ids.attemptId }).expect(204);
      expect((await api.get(path).expect(200)).body.status).toBe('cancelled');
      const retried = await api.post(`${path}/retry`).send({ idempotencyKey:'retry-0001' }).expect(202);
      await api.post(`${path}/retry`).send({ idempotencyKey:'retry-0001' }).expect(202,retried.body);
      expect(retried.body.userMessageId).toBe(ids.userMessageId); expect(retried.body.attemptId).not.toBe(ids.attemptId);
      await api.post(`${path}/cancel`).send({ attemptId:ids.attemptId }).expect(409);
      const stream = await fetch(`${h.http.url}/api${retried.body.streamPath}`); await stream.text();
      const archive = await api.get(`/api/sessions/${ids.sessionId}/messages`).expect(200);
      expect(archive.body.items.filter((m:{ role:string }) => m.role === 'user')).toHaveLength(1);
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await h.close(); }
  },30000);
  it('disconnect after a delta interrupts one run, keeps partials incomplete, and leaves status readable',async () => {
    const h = await nativeHttp(); const release = deferred<void>(); const stopped = deferred<void>();
    const providerAborted = deferred<void>();
    try {
      const api = request(h.http.app.getHttpServer());
      h.fetcher.mockImplementation(async (_url,init) => {
        const signal = init?.signal;
        if (signal?.aborted) providerAborted.resolve();
        else signal?.addEventListener('abort',() => providerAborted.resolve(),{ once:true });
        return new Response(new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              controller.enqueue(new TextEncoder().encode('data: {"id":"gen_disconnect","choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n'));
              await release.promise;
              controller.enqueue(new TextEncoder().encode('data: {"id":"gen_disconnect","choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
              controller.close();
            } catch { controller.error(new Error('fixture source closed')); }
            finally { stopped.resolve(); }
          },
        }),{ headers:{ 'content-type':'text/event-stream' } });
      });
      const accepted = await api.post('/api/sessions').send(command).expect(202);
      const ids = accepted.body as { sessionId:string;turnId:string;streamPath:string };
      const abort = new AbortController(); const response = await fetch(`${h.http.url}/api${ids.streamPath}`,{ signal:abort.signal });
      const reader = response.body!.getReader(); let text = '';
      while (!text.includes('"type":"delta"')) { const value = await reader.read(); if (value.done) throw new Error('no delta'); text += new TextDecoder().decode(value.value); }
      abort.abort(); await reader.cancel().catch(() => undefined);
      await providerAborted.promise; release.resolve(); await stopped.promise;
      // Runtime owns asynchronous interruption persistence; wait boundedly, never resubmit.
      let status = await h.runtime.getTurnStatus(h.identity.userId,ids.sessionId,ids.turnId);
      for (let n=0;n<100 && ['accepted','generating','finalizing'].includes(status.status);n++) {
        await new Promise(resolve => setTimeout(resolve,10)); status = await h.runtime.getTurnStatus(h.identity.userId,ids.sessionId,ids.turnId);
      }
      expect(status.status).toBe('interrupted'); expect(h.fetcher).toHaveBeenCalledTimes(1);
      const archive = await api.get(`/api/sessions/${ids.sessionId}/messages`).expect(200);
      expect(archive.body.items.find((m:{ role:string }) => m.role === 'assistant')?.completionStatus).toBe('interrupted');
      expect(text).not.toContain('"type":"completed"');
    } finally { release.resolve(); await h.close(); }
  },30000);
  it('does not emit completion when finalization fails; recovery reuses the saved result without a new POST',async () => {
    const h = await nativeHttp();
    try {
      const api = request(h.http.app.getHttpServer()); const accepted = await api.post('/api/sessions').send(command).expect(202);
      const ids = accepted.body as { sessionId:string;turnId:string;streamPath:string };
      const append = h.persistence.messages.append.bind(h.persistence.messages);
      const fault = vi.spyOn(h.persistence.messages,'append').mockImplementation(async record => {
        if (record.role === 'assistant') throw new Error('fixture archive failure sk-private'); return append(record);
      });
      let text:string;
      try { const response = await fetch(`${h.http.url}/api${ids.streamPath}`); text = await response.text(); }
      finally { fault.mockRestore(); }
      expect(text).not.toContain('"type":"completed"'); expect(text).not.toContain('sk-private');
      expect((await h.runtime.getTurnStatus(h.identity.userId,ids.sessionId,ids.turnId)).status).toBe('finalizing');
      const recovered = createChatRuntime(h.deps); // P8 would orchestrate quiescent recovery, never an HTTP repair route.
      await recovered.reconcileSession(h.identity.userId,ids.sessionId);
      await recovered.reconcileSession(h.identity.userId,ids.sessionId);
      expect((await api.get(`/api/sessions/${ids.sessionId}/turns/${ids.turnId}`).expect(200)).body.status).toBe('completed');
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await h.close(); }
  },30000);
  it('blocks a second stream and completion until application finalization is released',async () => {
    const h = await nativeHttp(); const entered = deferred<void>(); const release = deferred<void>();
    try {
      const api = request(h.http.app.getHttpServer()); const accepted = await api.post('/api/sessions').send(command).expect(202);
      const ids = accepted.body as { sessionId:string;turnId:string;attemptId:string;streamPath:string };
      const append = h.persistence.messages.append.bind(h.persistence.messages);
      const barrier = vi.spyOn(h.persistence.messages,'append').mockImplementation(async record => {
        if (record.role === 'assistant') { entered.resolve(); await release.promise; } return append(record);
      });
      const response = await fetch(`${h.http.url}/api${ids.streamPath}`); const reader = response.body!.getReader();
      let partial = '';
      try {
        await entered.promise;
        await api.get(`/api${ids.streamPath}`).expect(409);
        await api.post(`/api/sessions/${ids.sessionId}/turns/${ids.turnId}/cancel`).send({ attemptId:ids.attemptId }).expect(204);
        expect((await h.runtime.getTurnStatus(h.identity.userId,ids.sessionId,ids.turnId)).status).toBe('finalizing');
        // Read until finalizing; no successful terminal event may precede the held durable archive write.
        while (!partial.includes('"status":"finalizing"')) {
          const chunk = await reader.read(); if (chunk.done) throw new Error('early EOF'); partial += new TextDecoder().decode(chunk.value);
        }
        expect(partial).not.toContain('"type":"completed"'); release.resolve();
        for (;;) { const chunk = await reader.read(); if (chunk.done) break; partial += new TextDecoder().decode(chunk.value); }
        expect(frames(partial).at(-1)?.event).toMatchObject({ type:'completed',outcome:'completed' });
        const assistant = (await h.persistence.messages.list(h.identity.userId,ids.sessionId,{ cursor:null,limit:50 })).items.find(m => m.role === 'assistant');
        expect(assistant?.completionStatus).toBe('completed');
        expect((await h.persistence.sessions.get(h.identity.userId,ids.sessionId))?.execution.activeAttemptId).toBeNull();
        expect(h.fetcher).toHaveBeenCalledTimes(1);
      } finally { release.resolve(); barrier.mockRestore(); reader.releaseLock(); }
    } finally { release.resolve(); await h.close(); }
  },30000);
});
