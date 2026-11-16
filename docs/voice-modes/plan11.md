# Integrated Verification and Pilot Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this harness load `executing-plans` and `test-driven-development`; do not dispatch children without the orchestrator's authorization.

**Goal:** Produce executable integrated checks and honest, commit-attributed evidence for both voice modes, preserving the text agent and separating offline simulations from actual provider, browser, and pilot release gates.

**Architecture:** Reuse the existing native database/runtime, speech event/socket fixtures, HTTP module, voice gateway, browser audio fakes, and controllers. P11 adds tests, small test-only measurement helpers, and evidence documents, not another runtime, provider adapter, browser framework, or production feature. Deterministic checks cover the real application boundaries with injected speech; real acoustic/browser/provider measurements remain separately authorized and cannot be certified by fixture results.

**Tech Stack:** Existing TypeScript/NodeNext, NestJS, native `ws`, MongoDB/LangGraph, React server rendering, browser Web Audio ports, Vitest 4.1.2, and Node standard library. No new dependencies or package/configuration edits.

---

## Execution gates and scope

- Read [goal.md](goal.md), [research.md](research.md), [state.md](state.md), and [operations.md](operations.md). The goal's scope corrections override the embedded PRD. Authentication, live tools, mutations/confirmations, captions, multilingual release, Aura fallback, and eager processing are deferred.
- Planning may proceed against P10's committed plan. **Worker execution requires P10's verified implementation commits**, not merely `plan10.md`. Recheck the actual source/handoff before execution; do not ingest or stage another worker's uncommitted changes.
- Review is **skipped**, not passed. Test failures still require root-cause investigation and owner correction. P1 owns manifests/config/contracts; P2 persistence/context; P3 providers; P4 audio/client; P5 session/gateway; P6 runtime/bridge/serializers; P7 composer/draft; P8 live UI; P9 operations; P10 composition. Retain a failing regression and report it to the orchestrator; do not fix production source here.
- P10's planning handoff records a missing frontend conversation binder and missing session activity/warning/termination hooks. Its assembly now uses a lazy reservation delegate; verify that committed delegate resolves the shared runtime after initialization rather than permanently capturing an unavailable port. Verify all handoff gaps with assembled tests; a fixture-composed gateway must not disguise a broken application composition. No mode is release-eligible while its applicable binding, caps, idle, or shutdown evidence fails.
- Stage named P11 files only, one commit at a time after checking the shared index. Do not edit workflow state or `final_report.md`; those belong to the orchestrator/V.
- No infrastructure provisioning, public deployment, flag enablement, paid calls, private `.env` reads, account-rate guesses, or raw audio persistence. The operator must separately authorize provider/model spend, consent/data use, and hardware/protected-staging access.
- Every new **code** file needs the repository's language-valid file header before its imports. Code snippets here omit that repetitive header; this Markdown document has no code-file header.
- Steps are individual 2–5-minute actions. Within each test block, add/run one `it` at a time; within each helper block, add one function at a time. Commit only after the complete task and applicable regressions pass.
- TDD in a verification-only plan distinguishes **missing harness/evidence red** from **behavioral red**. Tasks 1/3/4/5 initially fail on missing local helpers/artifacts. New Task 2 behavior tests may already pass against upstream code: record that honestly, never introduce a defect to manufacture red. A missing database, missing import, or skipped suite is not a behavioral failure or successful acceptance evidence.

## File map (all new, inside P11 ownership)

| Exact file | Single responsibility |
| --- | --- |
| `backend/test/voice/integration/multi-mode.spec.ts` | Text/dictation/live alternation, backend collisions, session isolation, admission/privacy checks |
| `backend/test/voice/integration/integrated-fixture.ts` | Real Nest HTTP/native WebSocket + native runtime composition with deterministic speech ports |
| `backend/test/voice/integration/fault-recovery.spec.ts` | Fault/reconnect/barge-in and sealed-result recovery assertions |
| `frontend/src/features/voice/integration-tests/voice-matrix.test.ts` | Integrated controllers/audio lifecycle, keyboard, draft, SSR isolation checks in Node |
| `frontend/src/features/voice/integration-tests/matrix-fixture.ts` | Inject real capture service with existing fake Web Audio into the existing live fixture |
| `backend/test/evaluations/voice/latency-eval.spec.ts` | Metrics calibration, fixture STT normalization, safe prose, authorized pilot-artifact validation |
| `backend/test/evaluations/voice/evaluation.ts` | Small bounded evaluation math and pilot-artifact schema |
| `backend/test/evaluations/voice/evidence-docs.spec.ts` | Evidence documents, scoped IDs, browser rows, and no false certification |
| `docs/voice-modes/verification.md` | Acceptance-to-check traceability, actual automated execution records, owner blockers |
| `docs/voice-modes/staging-evidence.md` | Real-browser/proxy/operations procedures and actual/unrun evidence |
| `docs/voice-modes/pilot-evaluation.md` | Dataset protocol, metrics, auditions, consent/budget and independent release gates |

Read-only reuse: `backend/test/runtime/voice-runtime-harness.ts`, `backend/test/persistence/native.ts`, `backend/test/voice/session/fixtures.ts`, `backend/test/fixtures/deepgram/socket.ts`, existing P3/P4/P6/P7/P8/P9 suites, and P10's assembly tests. Do not export private test helpers from other owners' spec files or copy their entire implementations.

## Commands and evidence discipline

Backend routine discovery includes `**/*.spec.ts`, so the requested two integration files and evaluation files are discovered by `npm test`; frontend includes `src/**/*.test.ts` in **Node**, not a DOM browser. No P1 script change is necessary. Existing `*.native.e2e-spec.ts` remains under `npm run test:e2e`.

Before any native run, from `backend`, use this credential-safe preflight:

```powershell
if (-not $env:AURVIN_TEST_MONGODB_URI -or $env:AURVIN_TEST_DB_PREFIX -ne 'aurvin_p2_test_') { throw 'Operator-supplied isolated native configuration required; no native evidence collected.' }
```

Do not set a guessed URI, print it, read application credentials, or create a fixture against application data. Existing `nativeDatabase()` generates/drops only `aurvin_p2_test_<uuid>`. A configured but unavailable/non-admitted service **fails**; it must not be converted into a skip. Validate admitted replica-set topology through the existing persistence suite. In routine unconfigured runs, the explicit `describe.skipIf` below records native skips. Report their count and gate separately.

For each check record: UTC date, `git rev-parse HEAD`, `git status --short` (exclude private filenames from published output), OS/Node/npm versions, command/workdir, suite/test/pass/fail/skip counts, duration, evidence class, fixture/model versions, prerequisite failure, and artifact location. Do not call HTTP receipt of binary audio “first audible reply.”

---

### Task 1: Integrated End-to-End Multi-Mode Suites

**Files:** Create `backend/test/voice/integration/multi-mode.spec.ts` and `backend/test/voice/integration/integrated-fixture.ts`. Task 3 supplies the browser-composer draft portion; a backend does not own an unsent draft.

- [ ] **Step 1: Write the first failing integrated test, then add each following case separately.**

`backend/test/voice/integration/multi-mode.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { integratedFixture, nativeConfigured, origin } from './integrated-fixture.js';

describe.skipIf(!nativeConfigured)('native multi-mode integration', () => {
  it('alternates text, draft-only dictation, live, and text with one shared history', async () => {
    const f = await integratedFixture();
    try {
      const first = await f.text(null, 'Remember ID ABC-42.', 'text-first-0001');
      const s = first.sessionId;
      const d = await f.connect('dictation', s, 'dictation-first-0001');
      const dictation = f.latest();
      d.pcm();
      dictation.stt.events.push({ type: 'partial', segmentId: 'one', text: 'not ABC' });
      dictation.stt.events.push({ type: 'partial', segmentId: 'one', text: 'not ABC-43' });
      dictation.stt.events.push({ type: 'final', segmentId: 'one', text: 'Not ABC-43.' });
      dictation.stt.events.push({ type: 'final', segmentId: 'one', text: 'Not ABC-43.' });
      await d.wait('dictation.final');
      expect(f.fetcher).toHaveBeenCalledTimes(1); // Pauses/finals do not infer.
      d.control({ type: 'dictation.stop' });
      await vi.waitFor(() => expect(dictation.stt.connection.finalize).toHaveBeenCalledOnce());
      dictation.stt.events.push({ type: 'finalized', unfinalizedTail: false });
      await d.wait('dictation.complete');
      await d.wait('session.ended');
      expect(d.events.filter(e => e.type === 'dictation.final')).toHaveLength(1);
      await f.text(s, 'Not ABC-43.', 'dictated-send-0001'); // Explicit Send only.

      const live = await f.connect('live', s, 'live-first-0001');
      const ref = await f.startReply(live, 'Which ID did I ask you to remember?');
      await f.finishReply(live, ref);
      const livePrompt = JSON.parse(String(f.fetcher.mock.calls[2]?.[1]?.body));
      expect(livePrompt.user).toBe(f.identity.userId);
      expect(livePrompt.messages.filter((m: { content: string }) => m.content === 'Remember ID ABC-42.')).toHaveLength(1);
      expect(livePrompt.messages.filter((m: { content: string }) => m.content === 'Which ID did I ask you to remember?')).toHaveLength(1);
      await f.end(live);
      await f.text(s, 'Continue in text.', 'text-last-0001');
      const prompt = JSON.parse(String(f.fetcher.mock.calls[3]?.[1]?.body));
      expect(prompt.messages.some((m: { content: string }) => m.content === 'Which ID did I ask you to remember?')).toBe(true);
      const visible = await request(f.url).get(`/api/sessions/${s}/messages`).expect(200);
      const nav = await request(f.url).get('/api/sessions').expect(200);
      expect(JSON.stringify([visible.body, nav.body, live.events])).not.toContain('Which ID did I ask you to remember?');
      expect(visible.body.items.filter((m: { role: string }) => m.role === 'user')).toHaveLength(3);
      expect(f.fetcher).toHaveBeenCalledTimes(4);
    } finally { await f.close(); }
  }, 30_000);

  it('rejects across-tab submit/retry/live collisions with 409 CONFLICT_ACTIVE_TURN', async () => {
    const f = await integratedFixture();
    try {
      const first = await f.text(null, 'Text baseline.', 'text-baseline-0001');
      const s = first.sessionId;
      const live = await f.connect('live', s, 'live-lock-0001');
      const results = await Promise.all(['tab-a', 'tab-b'].map(tab => request(f.url)
        .post(`/api/sessions/${s}/turns`).send({ sessionId: s, content: tab, idempotencyKey: `${tab}-request-0001` })));
      for (const result of results) {
        expect(result.status).toBe(409);
        expect(result.body.error.code).toBe('CONFLICT_ACTIVE_TURN');
      }
      const retry = await request(f.url).post(`/api/sessions/${s}/turns/${first.turnId}/retry`)
        .send({ idempotencyKey: 'text-retry-0001' }).expect(409);
      expect(retry.body.error.code).toBe('CONFLICT_ACTIVE_TURN');
      const secondLive = await request(f.url).post('/api/voice/sessions').set('Origin', origin)
        .send({ protocolVersion: 1, mode: 'live', conversationId: s, locale: 'en-US', idempotencyKey: 'other-live-0001' }).expect(409);
      expect(secondLive.body.error.code).toBe('CONFLICT_ACTIVE_TURN');
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      await f.end(live);
      const accepted = await request(f.url).post(`/api/sessions/${s}/turns`)
        .send({ sessionId: s, content: 'Accepted, not yet executed.', idempotencyKey: 'text-held-0001' }).expect(202);
      const reverse = await request(f.url).post('/api/voice/sessions').set('Origin', origin)
        .send({ protocolVersion: 1, mode: 'live', conversationId: s, locale: 'en-US', idempotencyKey: 'reverse-live-0001' }).expect(409);
      expect(reverse.body.error.code).toBe('CONFLICT_ACTIVE_TURN');
      await f.runtime.reconcileSession(f.identity.userId, accepted.body.sessionId);
      expect(f.fetcher).toHaveBeenCalledTimes(1);
    } finally { await f.close(); }
  }, 30_000);

  it('switches conversation binding without contaminating another session or reopening old audio', async () => {
    const f = await integratedFixture();
    try {
      const a = await f.text(null, 'PRIVATE_A marker.', 'session-a-0001');
      const b = await f.text(null, 'PRIVATE_B marker.', 'session-b-0001');
      const old = await f.connect('live', a.sessionId, 'live-a-0001');
      await f.end(old);
      const current = await f.connect('live', b.sessionId, 'live-b-0001');
      const ref = await f.startReply(current, 'Follow up in B.');
      await f.finishReply(current, ref);
      const body = JSON.parse(String(f.fetcher.mock.calls[2]?.[1]?.body));
      expect(JSON.stringify(body.messages)).toContain('PRIVATE_B marker.');
      expect(JSON.stringify(body.messages)).not.toContain('PRIVATE_A marker.');
      expect(current.response.conversationId).toBe(b.sessionId);
      expect(current.events.some(e => e.type.startsWith('dictation.'))).toBe(false);
      await f.end(current);
    } finally { await f.close(); }
  }, 30_000);

  it('rejects invalid Origin and client identity before allocating speech', async () => {
    const f = await integratedFixture();
    try {
      const body = { protocolVersion: 1, mode: 'live', conversationId: null, locale: 'en-US', idempotencyKey: 'invalid-0001' };
      await request(f.url).post('/api/voice/sessions').set('Origin', 'https://invalid.example').send(body).expect(403);
      await request(f.url).post('/api/voice/sessions').set('Origin', origin).send({ ...body, userId: 'attacker' }).expect(400);
      await request(f.url).post('/api/voice/sessions').set('Origin', origin).send({ ...body, conversationId: 'unknown' }).expect(403);
      expect(f.connections).toHaveLength(0);
      expect(f.fetcher).not.toHaveBeenCalled();
    } finally { await f.close(); }
  }, 30_000);
});
```

- [ ] **Step 2: Run the first test red (with native prerequisites).** From `backend`:

```powershell
npm test -- test/voice/integration/multi-mode.spec.ts -t "alternates text"
```

Expected initially: FAIL to resolve `./integrated-fixture.js`. After the helper exists, each case must assert application behavior, not stubbed HTTP results. If configuration is absent, record `native suite skipped; acceptance unrun`, not PASS.

- [ ] **Step 3: Implement the minimal test composition.** Create `backend/test/voice/integration/integrated-fixture.ts`:

```typescript
import 'reflect-metadata';
import { once } from 'node:events';
import { expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import type { NestExpressApplication } from '@nestjs/platform-express';
import WebSocket from 'ws';
import request from 'supertest';
import { voiceRuntimeHarness } from '../../runtime/voice-runtime-harness.js';
import { options, origin, fakeStt, fakeTts } from '../session/fixtures.js';
import { ChatHttpModule, configureChatHttp } from '../../../src/http/index.js';
import { ServerIdentityResolver } from '../../../src/platform/identity/server-identity-resolver.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { VoiceSessionController } from '../../../src/voice/session/voice-session.controller.js';
import { VoiceGateway } from '../../../src/voice/transport/voice.gateway.js';
import { VOICE_SESSION_OPTIONS, type SessionContext } from '../../../src/voice/session/voice-session.options.js';
import { DictationFlow } from '../../../src/voice/session/dictation-flow.js';
import { LiveFlow } from '../../../src/voice/session/live-flow.js';
import { AgentVoiceAdapter } from '../../../src/voice/agent/agent-voice-adapter.js';
import { INPUT_AUDIO, type CreateVoiceSessionResponse, type VoiceClientPayload,
  type VoiceServerEvent } from '../../../src/contracts/voice-wire.js';
import { encodeVoiceAudio } from '../../../src/contracts/voice-audio.js';
import { chunk, usage, done } from '../../fixtures/openrouter/frames.js';

export { origin };
export const nativeConfigured = Boolean(process.env.AURVIN_TEST_MONGODB_URI);
// If a URI is supplied with an invalid prefix, nativeDatabase fails closed;
// only an absent URI skips this suite.
type Ref = { turnId: string; responseId: string };
type Connection = { context: SessionContext; stt: ReturnType<typeof fakeStt>;
  tts: ReturnType<typeof fakeTts>; flow: DictationFlow | LiveFlow; bridge: AgentVoiceAdapter | null };
export type Peer = { response: CreateVoiceSessionResponse; socket: WebSocket; events: VoiceServerEvent[];
  audio: Buffer[]; control(payload: VoiceClientPayload): void; pcm(): void;
  wait(type: VoiceServerEvent['type']): Promise<VoiceServerEvent> };
export const speechUsage = { providerRequestId: 'fixture-tts', model: 'fixture', modelVersion: 'fixture-v1',
  audioMs: 100, billableCharacters: 12 };

export async function integratedFixture() {
  const h = await voiceRuntimeHarness(chunk('Hello world. ') + chunk('', 'stop') + usage + done);
  const o = options();
  const identityResolver = new ServerIdentityResolver(h.deps.config);
  o.identity = identityResolver;
  o.sessions = h.persistence.sessions; o.reservations = h.runtime.reservations;
  // Isolate execution exclusion from the separate identity-concurrency quota gate.
  o.config.quotas.identityConcurrent = 4; o.config.quotas.globalConcurrent = 4;
  const connections: Connection[] = [], peers: Peer[] = [];
  let sessions!: VoiceSessionService;
  o.open = async (context, sink, signal) => {
    const stt = fakeStt(), tts = fakeTts();
    if (context.response.mode === 'dictation') {
      const flow = await DictationFlow.open(context, sink, signal, stt.port, o.usage);
      connections.push({ context, stt, tts, flow, bridge: null }); return flow;
    }
    const bridge = new AgentVoiceAdapter(h.runtime, (v, s) => sessions.bindConversation(v, s));
    const flow = await LiveFlow.open(context, sink, signal, { stt: stt.port, tts: tts.port,
      hooks: bridge.hooks, usage: o.usage });
    bridge.attach(context, flow, sink);
    connections.push({ context, stt, tts, flow, bridge }); return flow;
  };
  let app: NestExpressApplication;
  try {
  const module = await Test.createTestingModule({
    imports: [ChatHttpModule.register({ identity: identityResolver, sessions: h.persistence.sessions,
      messages: h.persistence.messages, runtime: h.runtime, budgets: h.deps.config.budgets,
      executionReservations: h.runtime.reservations })],
    controllers: [VoiceSessionController], providers: [
      { provide: VOICE_SESSION_OPTIONS, useValue: o }, VoiceSessionService, VoiceGateway ],
  }).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  app.setGlobalPrefix('api'); configureChatHttp(app, h.deps.config.budgets);
  app.useWebSocketAdapter(new WsAdapter(app)); sessions = app.get(VoiceSessionService);
  await app.listen(0, '127.0.0.1');
  } catch (error) {
    try { await sessions?.drain(); await app!?.close(); } finally { await h.close(); }
    throw error;
  }
  const url = await app.getUrl();
  const latest = () => { const c = connections.at(-1); if (!c) throw new Error('No voice connection'); return c; };
  const connect = async (mode: 'dictation' | 'live', conversationId: string | null, idempotencyKey: string) => {
    const created = await request(url).post('/api/voice/sessions').set('Origin', origin)
      .send({ protocolVersion: 1, mode, conversationId, locale: 'en-US', idempotencyKey }).expect(201);
    const response = created.body as CreateVoiceSessionResponse;
    const cookie = String(created.headers['set-cookie'][0]).split(';')[0];
    const socket = new WebSocket(url.replace('http:', 'ws:') + '/api/voice', { headers: { Origin: origin, Cookie: cookie } });
    const events: VoiceServerEvent[] = [], audio: Buffer[] = [];
    socket.on('message', (data, binary) => binary ? audio.push(Buffer.from(data as Buffer))
      : events.push(JSON.parse(data.toString()) as VoiceServerEvent));
    let sequence = 0, audioSequence = 0;
    const peer: Peer = { response, socket, events, audio,
      control: payload => { const n = sequence++; socket.send(JSON.stringify({ protocolVersion: 1,
        sessionId: response.sessionId, connectionEpoch: response.connectionEpoch,
        eventId: `client-${n}`, sequence: n, ...payload })); },
      pcm: () => { const n = audioSequence++; socket.send(encodeVoiceAudio({ kind: 1, flags: 0,
        sequence: n, offsetMs: n * 80, pcm: new Uint8Array(2560) })); },
      wait: async type => { await vi.waitFor(() => expect(events.some(e => e.type === type)).toBe(true), { timeout: 5000 });
        return events.find(e => e.type === type)!; },
    };
    peers.push(peer);
    await once(socket, 'open'); peer.control({ type: 'session.start', mode, audioSettings: INPUT_AUDIO });
    await peer.wait('session.ready'); return peer;
  };
  const text = async (sessionId: string | null, content: string, idempotencyKey: string) => {
    const path = sessionId === null ? '/api/sessions' : `/api/sessions/${sessionId}/turns`;
    const accepted = await request(url).post(path).send({ sessionId, content, idempotencyKey }).expect(202);
    await h.runtime.executeTurn({ userId: h.identity.userId, ...accepted.body,
      signal: new AbortController().signal, emit: async () => undefined });
    expect((await request(url).get(`/api/sessions/${accepted.body.sessionId}/turns/${accepted.body.turnId}`).expect(200)).body.status).toBe('completed');
    return accepted.body as { sessionId: string; turnId: string; attemptId: string };
  };
  const startReply = async (peer: Peer, input: string, providerTurnId = 'provider:0'): Promise<Ref> => {
    const c = latest(); c.stt.events.push({ type: 'end-of-turn', providerTurnId, text: input });
    await vi.waitFor(() => expect(c.tts.connection.speak).toHaveBeenCalled(), { timeout: 5000 });
    const ref = c.bridge?.currentResponse(); if (!ref) throw new Error('Expected active response');
    c.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
    c.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    await peer.wait('audio.start'); await vi.waitFor(() => expect(peer.audio.length).toBeGreaterThan(0));
    await vi.waitFor(async () => expect((await h.runtime.getLiveTurnStatus(h.identity.userId,
      c.context.response.conversationId!, ref.turnId, c.context.reservation!)).status).toBe('completed'), { timeout: 5000 });
    return ref;
  };
  const finishReply = async (peer: Peer, ref: Ref) => {
    const c = latest();
    c.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage: speechUsage });
    peer.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 });
    await vi.waitFor(() => expect(c.bridge?.currentResponse()).toBeNull(), { timeout: 5000 });
  };
  const end = async (peer: Peer) => {
    await request(url).delete(`/api/voice/sessions/${peer.response.sessionId}`).set('Origin', origin).expect(204);
    peer.socket.terminate();
  };
  return { ...h, app, url, sessions, connections, latest, connect, text, startReply, finishReply, end,
    close: async () => {
      try { for (const p of peers) p.socket.terminate(); await sessions.drain(); }
      finally { try { await app.close(); } finally { await h.close(); } }
    } };
}
```

This is subsystem end-to-end evidence (wire → service → bridge → shared runtime → native records), not physical audio or central-composition certification. Reuse P10's separate assembled suite for that boundary. The fixture closes initialized resources on construction failure; do not leave an executor running. Do not replace the real runtime/repositories/reservations with spies to satisfy an assertion.

- [ ] **Step 4: Verify each case, then the complete suite and adjacent discovery.** From `backend`:

```powershell
npm test -- test/voice/integration/multi-mode.spec.ts
npm test -- test/voice/transport/gateway.integration.spec.ts
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
npm run lint
```

Expected: four executed native cases PASS, existing transport/assembled checks PASS, lint PASS. Missing DB is separately blocked. Also run `npm run test:e2e -- test/voice/agent/bridge.native.e2e-spec.ts` for hidden status/stream/cancel and repeated-final checks not duplicated above. Record actual counts.

- [ ] **Step 5: Commit after shared-index permission.** From repository root:

```powershell
git add backend/test/voice/integration/multi-mode.spec.ts backend/test/voice/integration/integrated-fixture.ts
git commit -m "test(voice): verify integrated multi-mode exclusion and history"
```

---

### Task 2: Fault Injection and Recovery Suites

**Files:** Create `backend/test/voice/integration/fault-recovery.spec.ts`. Reuse Task 1's fixture; no provider/runtime source edits.

- [ ] **Step 1: Add one failing/regression test at a time.**

`backend/test/voice/integration/fault-recovery.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { integratedFixture, nativeConfigured, speechUsage } from './integrated-fixture.js';
import { voiceRuntimeHarness } from '../../runtime/voice-runtime-harness.js';
import { DurableChatRuntime } from '../../../src/chat-runtime/durable-chat-runtime.js';
import { attemptsFor, archiveRecords } from '../../../src/chat-runtime/history.js';
import { deliveryFixture } from '../../../src/contracts/testing/voice-fixtures.js';
import { voiceDeliveryRecordSchema } from '../../../src/contracts/voice.js';

describe.skipIf(!nativeConfigured)('native voice fault recovery', () => {
  it('preserves generated results when the TTS provider drops mid-turn without reinference', async () => {
    const f = await integratedFixture();
    try {
      const p = await f.connect('live', null, 'tts-drop-0001');
      await f.startReply(p, 'PRIVATE network-drop input.');
      const c = f.latest(), s = c.context.response.conversationId!;
      c.tts.events.push({ type: 'error', fault: { code: 'TTS_UNAVAILABLE', recoverable: true, recovery: 'return_to_chat' } });
      await p.wait('session.error');
      await vi.waitFor(() => expect(c.bridge?.currentResponse()).toBeNull(), { timeout: 5000 });
      await f.runtime.reconcileSession(f.identity.userId, s);
      await f.runtime.reconcileSession(f.identity.userId, s);
      const a = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
      expect(a.status).toBe('completed');
      expect(await f.persistence.metadata.getVoiceDelivery(f.identity.userId, s, a.attemptId))
        .toMatchObject({ status: 'unknown', textGenerated: 'Hello world.', textSpoken: null });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(p.events)).not.toMatch(/PRIVATE|Hello world/);
    } finally { await f.close(); }
  }, 30_000);

  it('reconciles mid-speech barge-in and excludes unheard text from the next prompt', async () => {
    const f = await integratedFixture();
    try {
      const p = await f.connect('live', null, 'barge-in-0001');
      const ref = await f.startReply(p, 'First voice question.');
      const c = f.latest(), s = c.context.response.conversationId!;
      p.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 });
      await p.wait('response.cancelled');
      c.tts.events.push({ type: 'speech-interrupted', ...ref, speechId: 'speech-1', audioPlayedMs: 50,
        textSpoken: 'Hello', textRemaining: ' world.', usage: speechUsage });
      c.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
      await vi.waitFor(() => expect(c.bridge?.currentResponse()).toBeNull(), { timeout: 5000 });
      expect(c.tts.connection.interrupt).toHaveBeenCalledOnce();
      expect(p.audio).toHaveLength(1);
      const a = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
      expect(await f.persistence.metadata.getVoiceDelivery(f.identity.userId, s, a.attemptId))
        .toMatchObject({ status: 'interrupted', textGenerated: 'Hello world.', textSpoken: 'Hello', textRemaining: ' world.' });
      c.stt.events.push({ type: 'end-of-turn', providerTurnId: 'provider:1', text: 'Continue from what I heard.' });
      await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2), { timeout: 5000 });
      const body = JSON.parse(String(f.fetcher.mock.calls[1]?.[1]?.body));
      expect(body.messages.filter((m: { role: string }) => m.role === 'assistant'))
        .toEqual([{ role: 'assistant', content: 'Hello' }]);
      expect(body.messages.filter((m: { content: string }) => m.content === 'Continue from what I heard.')).toHaveLength(1);
    } finally { await f.close(); }
  }, 30_000);

  it('reconnects with a fresh epoch and no old audio, partial input, or automatic inference replay', async () => {
    const f = await integratedFixture();
    try {
      const p = await f.connect('live', null, 'reconnect-0001');
      const ref = await f.startReply(p, 'Durable input.');
      await f.finishReply(p, ref);
      const old = f.latest(), s = old.context.response.conversationId!;
      p.pcm();
      await vi.waitFor(() => expect(old.stt.connection.writeAudio).toHaveBeenCalledOnce());
      old.stt.events.push({ type: 'partial', segmentId: 'lost', text: 'incomplete input' });
      p.socket.terminate();
      await vi.waitFor(() => expect(old.stt.connection.close).toHaveBeenCalledOnce(), { timeout: 5000 });
      const fresh = await f.connect('live', s, 'reconnect-0001');
      expect(fresh.response.sessionId).toBe(p.response.sessionId);
      expect(fresh.response.connectionEpoch).toBe(p.response.connectionEpoch + 1);
      const current = f.latest();
      expect(current.stt.connection.writeAudio).not.toHaveBeenCalled();
      expect(current.tts.connection.speak).not.toHaveBeenCalled();
      expect(current.tts.connection.interrupt).not.toHaveBeenCalled();
      expect(fresh.audio).toEqual([]);
      await f.runtime.reconcileSession(f.identity.userId, s);
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(await attemptsFor(f.persistence, f.identity.userId, s)).toHaveLength(1);
      // Explicit new audio is permitted, but nothing buffered from the old socket is sent.
      fresh.pcm();
      await vi.waitFor(() => expect(current.stt.connection.writeAudio).toHaveBeenCalledOnce());
      await f.end(fresh);
    } finally { await f.close(); }
  }, 30_000);

  it('recovers a sealed result after executor publication failure without provider or audio replay', async () => {
    const h = await voiceRuntimeHarness();
    try {
      const reservation = await h.runtime.reservations.acquire({ identity: h.identity, conversationId: 'crash-chat',
        owner: { kind: 'live', voiceSessionId: 'crash-voice' } });
      const ids = await h.runtime.submitLiveTurn({ identity: h.identity, sessionId: 'crash-chat',
        content: 'PRIVATE accepted crash input.', idempotencyKey: 'crash-turn-0001', reservation });
      const append = h.persistence.messages.append.bind(h.persistence.messages);
      const failure = vi.spyOn(h.persistence.messages, 'append').mockImplementation(async m => {
        if (m.role === 'assistant') throw new Error('injected archive failure'); return append(m);
      });
      try {
        await expect(h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
          signal: new AbortController().signal, emit: async () => undefined, live: { reservation,
            start: async (a, write) => { await write(voiceDeliveryRecordSchema.parse({ ...deliveryFixture(),
              userId: a.userId, sessionId: a.sessionId, turnId: a.turnId, attemptId: a.attemptId,
              voiceSessionId: 'crash-voice', textGenerated: '', status: 'pending', textSpoken: null,
              textRemaining: null, audioDurationMs: null, audioPlayedMs: null, playedSamples: null })); },
            delta: async () => undefined, finish: async () => undefined,
            settle: async () => { throw new Error('injected executor stop before settlement'); },
          } })).rejects.toThrow();
      } finally { failure.mockRestore(); }
      // Execution has settled. This sequential object reconstruction is fault injection,
      // not a real process death or a stale-sentinel takeover.
      const restarted = new DurableChatRuntime(h.deps);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      const rows = await archiveRecords(h.persistence, h.identity.userId, ids.sessionId);
      expect(rows.map(m => [m.role, m.visibility])).toEqual([['user', 'internal'], ['assistant', 'internal']]);
      expect((await attemptsFor(h.persistence, h.identity.userId, ids.sessionId))[0]?.status).toBe('completed');
      expect(await h.persistence.metadata.getVoiceDelivery(h.identity.userId, ids.sessionId, ids.attemptId))
        .toMatchObject({ status: 'unknown', textGenerated: rows[1]!.content, textSpoken: null });
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await h.close(); }
  }, 30_000);
});
```

- [ ] **Step 2: Run each regression immediately.** From `backend`:

```powershell
npm test -- test/voice/integration/fault-recovery.spec.ts -t "preserves generated results"
```

Expected: either a genuine behavior FAIL routed to P3/P5/P6/P2, or PASS on an already-correct upstream implementation. Verify the model reached generated/durable state before injecting TTS failure; an accepted/generating abort has a different explicit terminal outcome. Do not weaken an assertion to accept every status.

- [ ] **Step 3: Minimal implementation is the owned fault driver above, not a product fix.** Use the existing event queues' error event, native archive spy, actual interruption controls, and existing recovery method. All implementations are already given in Step 1 and Task 1's fixture. Add no fake `recover()` returning a canned success. If a failure exposes an upstream defect, preserve the regression, send its name/stack/code/owner to the orchestrator, wait for that owner's verified commit, and rerun.

The minimal TTS fault implementation is this statement at the injection point inside the first test (already included in Step 1; do not insert it twice):

```typescript
c.tts.events.push({ type: 'error', fault: {
  code: 'TTS_UNAVAILABLE', recoverable: true, recovery: 'return_to_chat',
} });
```

Further fault windows already have exact runnable checks; run them rather than copying them:

```powershell
npm run test:e2e -- test/runtime/voice-recovery.native.e2e-spec.ts
npm run test:e2e -- test/runtime/recovery.native.e2e-spec.ts
npm test -- test/voice/providers/resilience.spec.ts
npm test -- test/voice/transport/gateway.spec.ts
npm test -- test/voice/agent/voice-delivery.spec.ts
```

These cover unknown/malformed/missing interruption evidence, non-advancing offsets, persistence publication windows, no-result interruption, protocol/queue abuse, and provider cancellation. Existing P3 offset-reset checks remain mandatory; a new fake provider object's constant ID is not socket-offset evidence.

- [ ] **Step 4: Verify the combined suites.** From `backend`:

```powershell
npm test -- test/voice/integration
npm run lint
```

Expected: eight executed native integrated cases PASS and lint PASS, plus separately reported existing regression results. Actual hard-process crash, sentinel recovery, proxy interruption, and hardware disconnect remain staging drills, not certified by reconstructing `DurableChatRuntime`.

- [ ] **Step 5: Commit.** From root:

```powershell
git add backend/test/voice/integration/fault-recovery.spec.ts
git commit -m "test(voice): cover injected faults delivery and replay-safe recovery"
```

---

### Task 3: Frontend Integrated Voice Matrix Tests

**Files:** Create `frontend/src/features/voice/integration-tests/voice-matrix.test.ts` and `frontend/src/features/voice/integration-tests/matrix-fixture.ts`.

- [ ] **Step 1: Write the failing matrix tests incrementally.**

`frontend/src/features/voice/integration-tests/voice-matrix.test.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { matrixFixture } from './matrix-fixture.ts';
import { dictationFixture, settle } from '../dictation/testing/dictation-fixture.ts';
import { LiveVoicePanel } from '../live/LiveVoicePanel.tsx';
import { handleLiveVoiceKey, attachLiveVoiceLifecycle } from '../live/live-voice-lifecycle.ts';

vi.mock('../audio/audio-capture-processor.ts?worker&url', () => ({ default: '/capture-worklet.js' }));

it('denied permission allocates no session and keeps the original editable draft', async () => {
  const f = matrixFixture('denied');
  expect(f.getUserMedia).not.toHaveBeenCalled();
  try {
    await f.controller.start({ text: 'Unsent original', start: 7, end: 15, direction: 'backward' }, null, f.config);
    await settle();
    expect(f.getUserMedia).toHaveBeenCalledOnce();
    expect(f.http.create).not.toHaveBeenCalled();
    expect(f.draft()).toBe('Unsent original');
    expect(f.controller.getSnapshot().phase).toBe('idle');
    expect(f.controller.getSnapshot().notice).toContain('denied');
  } finally { f.controller.exit(); await settle(); }
});

it('granted permission loads the worklet, never replays mute buffers, and closes resources once', async () => {
  const f = matrixFixture('granted');
  try {
    await f.begin();
    expect(f.captureContext.audioWorklet.addModule).toHaveBeenCalledWith('/capture-worklet.js');
    f.frame(); expect(f.client.sendInput).toHaveBeenCalledOnce();
    await f.controller.toggleMute(); f.frame();
    expect(f.client.sendInput).toHaveBeenCalledOnce();
    await f.controller.toggleMute();
    expect(f.client.sendInput).toHaveBeenCalledOnce(); // Unmute does not replay.
    f.frame(); expect(f.client.sendInput).toHaveBeenCalledTimes(2);
    f.controller.exit(); f.controller.exit(); await settle();
    expect(f.media.track.stop).toHaveBeenCalledOnce();
    expect(f.node.port.close).toHaveBeenCalledOnce();
    expect(f.captureContext.close).toHaveBeenCalledOnce();
    expect(f.http.end).toHaveBeenCalledOnce();
  } finally { f.controller.exit(); await settle(); }
});

it('dictation edits only its selection and live exit restores that unsent draft without submitting it', async () => {
  const d = dictationFixture();
  await d.begin();
  d.event({ type: 'dictation.partial', segmentId: 'one', text: 'Not 12' });
  d.event({ type: 'dictation.partial', segmentId: 'one', text: 'Not 13' });
  d.event({ type: 'dictation.final', segmentId: 'one', text: 'Not 13.' });
  d.event({ type: 'dictation.final', segmentId: 'one', text: 'Not 13.' });
  expect(d.text()).toBe('Before Not 13. after');
  await d.controller.stop();
  expect(d.controller.getSnapshot().phase).toBe('finalizing');
  d.event({ type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false });
  expect(d.controller.getSnapshot().phase).toBe('draft_ready');
  const f = matrixFixture('granted');
  const draft = d.text();
  try {
    await f.controller.start({ text: draft, start: 7, end: 14, direction: 'backward' }, 'chat-1', f.config);
    f.event({ type: 'session.ready', limits: f.response.limits, effectiveAudioSettings: f.response.effectiveAudioSettings });
    await settle();
    expect(f.http.create).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'chat-1', mode: 'live' }), expect.any(AbortSignal));
    expect(JSON.stringify(f.http.create.mock.calls)).not.toContain(draft);
    f.close(); // Simulates the existing chat lease's session-navigation callback.
    await settle();
    expect(f.draft()).toBe(draft);
    expect(f.http.end).toHaveBeenCalledOnce();
    expect(f.client.dispose).toHaveBeenCalledOnce();
  } finally { d.controller.cancel(); f.controller.exit(); await settle(); }
});

it('keyboard shortcuts use real live actions and text-input/IME events stay isolated', async () => {
  const f = matrixFixture('granted');
  try {
    await f.begin();
    f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
    f.audio(); f.context.currentTime = 0.05;
    const key = (name: string, altKey = false, isComposing = false) => ({ key: name, altKey, isComposing,
      ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, defaultPrevented: false,
      target: null, preventDefault: vi.fn() });
    const actions = { onMute: () => { void f.controller.toggleMute(); },
      onInterrupt: () => f.controller.interrupt(), onExit: () => f.controller.exit() };
    const textKey = { ...key('x', true), target: {
      closest: () => ({}),
    } as unknown as EventTarget };
    handleLiveVoiceKey(textKey, f.controller.getSnapshot(), actions);
    expect(f.controller.getSnapshot().phase).toBe('active');
    handleLiveVoiceKey(key('Escape', false, true), f.controller.getSnapshot(), actions);
    expect(f.client.invalidate).not.toHaveBeenCalled();
    handleLiveVoiceKey(key('Escape'), f.controller.getSnapshot(), actions);
    expect(f.context.sources[0].stop).toHaveBeenCalledOnce();
    expect(f.client.invalidate).toHaveBeenCalledWith('r1');
    handleLiveVoiceKey(key('m', true), f.controller.getSnapshot(), actions); await settle();
    expect(f.controller.getSnapshot().input).toBe('muted');
    handleLiveVoiceKey(key('x', true), f.controller.getSnapshot(), actions); await settle();
    expect(f.controller.getSnapshot().phase).toBe('idle');
  } finally { f.controller.exit(); await settle(); }
});

it('renders operational state without transcript or draft and supplies a reduced-motion alternative', async () => {
  const f = matrixFixture('granted');
  try {
    await f.begin();
    const html = renderToStaticMarkup(createElement(LiveVoicePanel, { voice: {
      view: f.controller.getSnapshot(), start: vi.fn(), toggleMute: vi.fn(), interrupt: vi.fn(), exit: vi.fn(), resume: vi.fn(),
    } }));
    expect(html).toContain('aria-label="Live voice conversation"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/textarea|contenteditable|Unsent original|PRIVATE voice transcript/);
    const css = readFileSync('src/features/voice/live/live-voice.css', 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation: none');
    expect(css).toContain(':focus-visible');
  } finally { f.controller.exit(); await settle(); }
});

it('backgrounding silences audio and capture and foregrounding requires an explicit gesture', async () => {
  const f = matrixFixture('granted');
  const page = Object.assign(new EventTarget(), { hidden: false }), browser = new EventTarget();
  const detach = attachLiveVoiceLifecycle(f.controller, page, browser);
  try {
    await f.begin(); page.hidden = true; page.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(f.media.track.stop).toHaveBeenCalledOnce();
    expect(f.controller.getSnapshot().resumeRequired).toBe(true);
    page.hidden = false; page.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(f.getUserMedia).toHaveBeenCalledOnce(); // Merely visible does not resume.
    expect(f.controller.getSnapshot().phase).toBe('suspended');
    browser.dispatchEvent(new Event('pagehide')); await settle();
    expect(f.client.dispose).toHaveBeenCalledOnce();
  } finally { detach(); await settle(); }
});
```

- [ ] **Step 2: Run red.** From `frontend`:

```powershell
npm test -- src/features/voice/integration-tests/voice-matrix.test.ts -t "denied permission"
```

Expected: missing `matrix-fixture.ts`, then actual controller/audio assertions. This is a Node test, not a browser permission prompt test.

- [ ] **Step 3: Minimal fixture implementation.** Create `frontend/src/features/voice/integration-tests/matrix-fixture.ts`:

```typescript
import { vi } from 'vitest';
import { liveVoiceFixture } from '../state/testing/live-voice-fixture.ts';
import { AudioCaptureService } from '../audio/audio-capture-service.ts';
import { FakeContext, FakeNode, fakeStream } from '../audio/testing/audio-fakes.ts';

export function matrixFixture(permission: 'granted' | 'denied') {
  const media = fakeStream(), node = new FakeNode(), captureContext = new FakeContext();
  const getUserMedia = vi.fn(async () => {
    if (permission === 'denied') throw new DOMException('fixture denial', 'NotAllowedError');
    return media.stream;
  });
  const f = liveVoiceFixture({ capture: options => new AudioCaptureService({ ...options, getUserMedia,
    context: () => captureContext.asContext(), node: () => node as unknown as AudioWorkletNode }) });
  return { ...f, media, node, captureContext, getUserMedia,
    frame: () => {
      const revision = node.port.postMessage.mock.calls.at(-1)?.[0].revision;
      node.port.emit({ type: 'frame', revision, flags: 0, pcm: new ArrayBuffer(2560) });
    } };
}
```

No browser-brand loop around these fakes: six identical Node runs are not six tested browsers. Native keyboard default activation, focus, actual media-query rendering, DOM/accessibility-tree secrecy, actual microphone/Worklet scheduling and acoustic playback remain Task 5's real-device procedures.

- [ ] **Step 4: Verify integrated and existing frontend regression checks.** From `frontend`:

```powershell
npm test -- src/features/voice/integration-tests/voice-matrix.test.ts
npm test -- src/features/voice/dictation/composer-events.test.ts
npm test -- src/features/chat/state/voice-draft-lock.test.ts
npm test -- src/features/voice/dictation/dictation-controller.test.ts
npm test -- src/features/voice/live/live-voice-lifecycle.test.ts
npm test -- src/features/voice/state/live-voice-controller.test.ts
npm test -- src/features/voice/transport/audio-transport-pipeline.test.ts
npm run build
npm run lint
```

Expected: six integrated cases and discovered existing cases PASS; build/lint PASS. The existing composer test exercises Enter, Shift+Enter, IME, Escape, button/Enter races in centered/docked variants. Existing transport/audio checks cover stale epochs, response invalidation, resampling and queue bounds. Real browser matrix remains **unrun** until separately observed.

- [ ] **Step 5: Commit.** From root:

```powershell
git add frontend/src/features/voice/integration-tests/voice-matrix.test.ts frontend/src/features/voice/integration-tests/matrix-fixture.ts
git commit -m "test(voice): integrate permission audio draft and accessibility contracts"
```

---

### Task 4: Voice Evaluation Harness & Latency Benchmarks

**Files:** Create `backend/test/evaluations/voice/latency-eval.spec.ts` and `backend/test/evaluations/voice/evaluation.ts`.

**Boundaries:** Simulated timing calibrates percentile arithmetic only. Fixture provider JSON verifies transcript handling, not STT accuracy. Only a consented, operator-attributed **hardware-pilot** artifact containing actual played-sample timestamps and recorded provider outputs can evaluate pilot gates. The offline command below never contacts Deepgram/OpenRouter.

- [ ] **Step 1: Write exact failing calibration/fixture tests.**

`backend/test/evaluations/voice/latency-eval.spec.ts`:

```typescript
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { evaluate, pilotSchema, percentile, wordErrorRate } from './evaluation.js';
import { SpeechProse } from '../../../src/voice/agent/speech-prose.js';
import { NovaSttAdapter } from '../../../src/voice/providers/nova-stt.js';
import { config, input, harness, collect, tick, novaResult } from '../../fixtures/deepgram/socket.js';
import type { SttEvent } from '../../../src/contracts/voice.js';

it('calibrates p50/p95 using played audio and includes turn-detection time', () => {
  const samples = Array.from({ length: 100 }, (_, i) => ({ speechEndMs: 1000,
    endOfTurnMs: 1200, firstPlayedMs: 2000 + i * 10, cold: false }));
  const result = evaluate({ evidence: 'simulated', samples,
    utterances: [{ reference: 'Do not change ABC-42.', hypothesis: 'Do not change ABC-42.', critical: ['not', 'ABC-42'] }],
    tasks: Array.from({ length: 30 }, (_, i) => ({ id: `simulated-task-${i}`,
      textSuccess: true, voiceSuccess: i !== 29 })),
    starts: 100, ready: 99, earlyCutoffs: 0, labeledTurns: 100,
    invalidAcceptances: 0, duplicateExecutions: 0,
    versions: { stt: 'fixture', tts: 'fixture', llm: 'fixture' },
    provenance: { commit: '0'.repeat(40), runId: 'simulation', consentRef: 'synthetic', authorizationRef: 'offline' } });
  expect(result.firstAudio).toEqual({ p50: 1490, p95: 1940 });
  expect(result.matchedTasks).toBe(30);
  expect(result.taskGapPercentagePoints).toBeCloseTo(100 / 30);
  expect(result.certifiable).toBe(false);
  expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
  expect(() => percentile([], 0.5)).toThrow();
});

it('computes substitutions deletions insertions and detects critical negation/value loss', () => {
  expect(wordErrorRate('do not change ABC-42', 'do change ABC-43')).toBe(0.5);
  expect(wordErrorRate('a b', 'a x b')).toBe(0.5);
  expect(() => wordErrorRate('', 'invented')).toThrow();
  const base = { evidence: 'simulated', samples: [{ speechEndMs: 0, endOfTurnMs: 100, firstPlayedMs: 500, cold: false }],
    utterances: [{ reference: 'Do not change ABC-42.', hypothesis: 'Do change ABC-43.', critical: ['not', 'ABC-42'] }],
    tasks: [{ id: 'one', textSuccess: true, voiceSuccess: false }], starts: 1, ready: 1,
    earlyCutoffs: 0, labeledTurns: 1, invalidAcceptances: 0, duplicateExecutions: 0,
    versions: { stt: 'fixture', tts: 'fixture', llm: 'fixture' },
    provenance: { commit: '0'.repeat(40), runId: 'simulation', consentRef: 'synthetic', authorizationRef: 'offline' } };
  expect(evaluate(base).criticalAccuracy).toBe(0);
  expect(evaluate(base).taskGapPercentagePoints).toBe(100);
  expect(() => evaluate({ ...base, samples: [{ speechEndMs: 100, endOfTurnMs: 150, firstPlayedMs: 90, cold: false }] })).toThrow();
});

it('passes 100 synthetic utterance transcripts through the actual Nova adapter without duplicated finals', async () => {
  const h = harness(), c = await new NovaSttAdapter(config(), h.factory).connect(input('dictation'));
  const events: SttEvent[] = [], reading = collect(c.events, events);
  const references = Array.from({ length: 100 }, (_, i) =>
    `Do not change ID ABC-${i + 100} for Priya on 2026-10-09. Repeat repeat ${i + 1}.`);
  try {
    for (const [i, reference] of references.entries()) {
      h.sockets[0].json(novaResult(reference, false, i));
      h.sockets[0].json(novaResult(reference, true, i));
      h.sockets[0].json(novaResult(reference, true, i));
    }
    await tick();
    await vi.waitFor(() => expect(events.filter(e => e.type === 'final')).toHaveLength(100));
    const finals = events.flatMap(e => e.type === 'final' ? [e.text] : []);
    expect(finals).toEqual(references);
    expect(finals.map((s, i) => wordErrorRate(references[i], s))).toEqual(Array(100).fill(0));
  } finally { await c.close(); await reading; }
});

it('filters prose at every stream split without altering dates identifiers amounts or negations', () => {
  const source = '<think>PRIVATE reasoning.</think>\n**Do not** change ABC-42.\n' +
    '```json\n{"secret":true}\n```\nPrice is 12.50 on 2026-10-09. Repeat repeat.';
  const expected = 'Do not change ABC-42. Price is 12.50 on 2026-10-09. Repeat repeat.';
  for (let cut = 0; cut <= source.length; cut++) {
    const prose = new SpeechProse();
    expect(prose.push(source.slice(0, cut)) + prose.push(source.slice(cut)) + prose.finish()).toBe(expected);
  }
});

describe.skipIf(!process.env.AURVIN_VOICE_PILOT_EVIDENCE)('operator-supplied hardware pilot artifact', () => {
  it('evaluates at least 100 utterances and 30 matched no-tool tasks without claiming synthetic certification', () => {
    const path = process.env.AURVIN_VOICE_PILOT_EVIDENCE!;
    if (statSync(path).size > 2_000_000) throw new Error('Pilot artifact exceeds its bound');
    const raw = readFileSync(path, 'utf8');
    if (Buffer.byteLength(raw) > 2_000_000) throw new Error('Pilot artifact exceeds its bound');
    const pilot = pilotSchema.parse(JSON.parse(raw));
    expect(pilot.evidence).toBe('hardware-pilot');
    expect(pilot.utterances.length).toBeGreaterThanOrEqual(100);
    expect(pilot.tasks.length).toBeGreaterThanOrEqual(30);
    expect(pilot.samples.length).toBeGreaterThanOrEqual(30);
    expect(pilot.versions.stt).not.toMatch(/fixture|synthetic|unknown/);
    expect(pilot.versions.tts).not.toMatch(/fixture|synthetic|unknown/);
    expect(pilot.versions.llm).not.toMatch(/fixture|synthetic|unknown/);
    const result = evaluate(pilot);
    expect(result.certifiable).toBe(true); // Eligible dataset, not approval of provenance or every release gate.
    expect(result.firstAudio.p50).toBeLessThanOrEqual(1500);
    expect(result.firstAudio.p95).toBeLessThanOrEqual(2500);
    expect(result.wer).toBeLessThanOrEqual(0.10);
    expect(result.criticalAccuracy).toBeGreaterThanOrEqual(0.98);
    expect(result.establishmentRate).toBeGreaterThanOrEqual(0.98);
    expect(result.earlyCutoffRate).toBeLessThan(0.05);
    expect(result.taskGapPercentagePoints).toBeLessThanOrEqual(5);
    expect(pilot.invalidAcceptances).toBe(0);
    expect(pilot.duplicateExecutions).toBe(0);
    // Never log the artifact's reference/hypothesis text or credentials.
    console.info(JSON.stringify({ runId: pilot.provenance.runId, evidence: pilot.evidence, ...result }));
  });
});
```

- [ ] **Step 2: Run red.** From `backend`:

```powershell
npm test -- test/evaluations/voice/latency-eval.spec.ts -t "calibrates p50"
```

Expected: FAIL resolving `evaluation.js`. No network calls; no pilot environment setting required for calibration.

- [ ] **Step 3: Implement the bounded math/schema helper.** Create `backend/test/evaluations/voice/evaluation.ts`:

```typescript
import { z } from 'zod';
const count = z.number().int().nonnegative().max(10_000);
const ms = z.number().finite().nonnegative().max(86_400_000);
const text = z.string().min(1).max(32_000);
const sample = z.object({ speechEndMs: ms, endOfTurnMs: ms, firstPlayedMs: ms,
  cold: z.boolean() }).strict().refine(v => v.speechEndMs <= v.endOfTurnMs && v.endOfTurnMs <= v.firstPlayedMs,
  'Timing must be monotonic in one aligned clock');
export const pilotSchema = z.object({
  evidence: z.enum(['simulated', 'provider-fixture', 'hardware-pilot']),
  samples: z.array(sample).min(1).max(10_000),
  utterances: z.array(z.object({ reference: text, hypothesis: z.string().max(32_000),
    critical: z.array(text).min(1).max(32) }).strict()).min(1).max(1000),
  tasks: z.array(z.object({ id: z.string().min(1).max(128), textSuccess: z.boolean(), voiceSuccess: z.boolean() }).strict()).min(1).max(1000),
  starts: count.min(1), ready: count, earlyCutoffs: count, labeledTurns: count.min(1),
  invalidAcceptances: count, duplicateExecutions: count,
  versions: z.object({ stt: text, tts: text, llm: text }).strict(),
  provenance: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), runId: text,
    consentRef: text, authorizationRef: text }).strict(),
}).strict().superRefine((v, ctx) => {
  if (v.ready > v.starts || v.earlyCutoffs > v.labeledTurns)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid denominators' });
  if (new Set(v.tasks.map(t => t.id)).size !== v.tasks.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate matched task IDs' });
});

export function percentile(values: number[], fraction: number) {
  if (!values.length || fraction <= 0 || fraction > 1 ||
    values.some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid percentile sample');
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil(ordered.length * fraction) - 1];
}
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}_-]+(?:\.[\p{N}]+)?/gu) ?? [];
function edits(reference: string, hypothesis: string) {
  const a = words(reference), b = words(hypothesis);
  if (!a.length) throw new Error('Reference needs labeled words');
  // ponytail: O(n*m) edit-distance time, O(m) memory; cap tokens for this offline
  // corpus harness. Use a banded algorithm if longer utterances are admitted.
  if (a.length > 2000 || b.length > 2000) throw new Error('Utterance token budget exceeded');
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(
      next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return { distance: row[b.length], referenceWords: a.length };
}
export function wordErrorRate(reference: string, hypothesis: string) {
  const v = edits(reference, hypothesis); return v.distance / v.referenceWords;
}
export function evaluate(input: unknown) {
  const p = pilotSchema.parse(input), pairs = p.utterances.map(u => edits(u.reference, u.hypothesis));
  const warm = p.samples.filter(s => !s.cold).map(s => s.firstPlayedMs - s.speechEndMs);
  const cold = p.samples.filter(s => s.cold).map(s => s.firstPlayedMs - s.speechEndMs);
  const critical = p.utterances.flatMap(u => u.critical.map(value => {
    const expected = words(value).join(' '), hypothesis = ` ${words(u.hypothesis).join(' ')} `;
    return Number(hypothesis.includes(` ${expected} `));
  }));
  const textSuccess = p.tasks.filter(t => t.textSuccess).length / p.tasks.length;
  const voiceSuccess = p.tasks.filter(t => t.voiceSuccess).length / p.tasks.length;
  return {
    firstAudio: { p50: percentile(warm, 0.5), p95: percentile(warm, 0.95) },
    coldFirstAudio: cold.length ? { p50: percentile(cold, 0.5), p95: percentile(cold, 0.95) } : null,
    wer: pairs.reduce((n, v) => n + v.distance, 0) / pairs.reduce((n, v) => n + v.referenceWords, 0),
    criticalAccuracy: critical.reduce((n, v) => n + v, 0) / critical.length,
    establishmentRate: p.ready / p.starts, earlyCutoffRate: p.earlyCutoffs / p.labeledTurns,
    taskGapPercentagePoints: Math.max(0, (textSuccess - voiceSuccess) * 100),
    utterances: p.utterances.length, matchedTasks: p.tasks.length,
    certifiable: p.evidence === 'hardware-pilot' && p.utterances.length >= 100 && p.tasks.length >= 30 && warm.length >= 30,
  };
}
```

The helper's nearest-rank percentiles and corpus-weighted WER are deliberate. Critical-value matching is a **fixture pre-screen**, not semantic grading: spoken-number formatting, dates, accent, word order, wrong substitutions elsewhere, and negation attachment require the independent labels below. The pilot artifact's `critical` values must be the canonical graded spans, and `hypothesis` their adjudicated canonical representation. Keep raw transcript and adjudication provenance in the approved restricted dataset, never routine logs. An artifact's self-declared evidence/provenance does not prove it is real; the operator must verify it against the run/dataset ledger before release. No fixture can turn itself into hardware evidence by changing one string.

- [ ] **Step 4: Verify calibration and provider-fixture evaluations.** From `backend`:

```powershell
npm test -- test/evaluations/voice/latency-eval.spec.ts
npm test -- test/voice/agent/speech-prose.spec.ts
npm test -- test/voice/providers/nova-stt.spec.ts
npm test -- test/voice/providers/flux-tts.spec.ts
npm run lint
```

Expected offline: four tests PASS, one hardware-artifact test explicitly SKIPPED. Record simulation p50/p95 **1490/1940 ms as arithmetic calibration**, and 100 fixture finals/zero fixture WER **only as normalization fidelity**. Neither satisfies actual pilot latency/fidelity. If an authorized artifact exists, rerun the same command with operator-supplied `AURVIN_VOICE_PILOT_EVIDENCE`; validate the data ledger first, record all metrics/counts even on gate failure, and do not copy transcript content into the evidence document.

- [ ] **Step 5: Run the simulated matched-agent check, not a fabricated “30 successful tasks.”** Reuse Task 1's real `f.text`, `f.connect`, `f.startReply`, `f.finishReply`, and `f.end` to exercise repeated multi-mode transport in the native suite; its existing test is the deterministic integration evidence. **Do not multiply the same `Hello world.` fixture into 30 claimed task completions.** The exact 30-task comparison execution is the consented pilot protocol in Task 5, scored independently against the same configured no-tool text agent. Record it unrun until actual matched sessions are collected. The harness validates/calculates that matched artifact; it does not invent STT or task-success labels.

- [ ] **Step 6: Commit.** From root:

```powershell
git add backend/test/evaluations/voice/latency-eval.spec.ts backend/test/evaluations/voice/evaluation.ts
git commit -m "test(voice): calibrate latency fidelity and scoped pilot evaluation"
```

---

### Task 5: Verification & Staging Documentation Artifacts

**Files:** Create `backend/test/evaluations/voice/evidence-docs.spec.ts`, `docs/voice-modes/verification.md`, `docs/voice-modes/staging-evidence.md`, `docs/voice-modes/pilot-evaluation.md`.

- [ ] **Step 1: Write the failing evidence consistency test.**

`backend/test/evaluations/voice/evidence-docs.spec.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const doc = (name: string) => readFileSync(new URL(`../../../../docs/voice-modes/${name}`, import.meta.url), 'utf8');
it('maps all scoped acceptance IDs without treating fixtures or deferred features as release passes', () => {
  const v = doc('verification.md'), s = doc('staging-evidence.md'), p = doc('pilot-evaluation.md');
  for (let i = 1; i <= 18; i++) expect(v).toMatch(new RegExp(`\\| A${i} \\|`));
  expect(v).toMatch(/\| A10 \|[^\n]*deferred/i);
  expect(v).toContain('Review: skipped');
  expect(v).toContain('CONFLICT_ACTIVE_TURN');
  expect(v).toContain('AURVIN_TEST_DB_PREFIX=aurvin_p2_test_');
  for (const browser of ['Chrome', 'Edge', 'Firefox', 'Safari', 'iOS Safari', 'Android Chrome']) expect(s).toContain(`| ${browser} |`);
  for (const target of ['100 utterances', '30 matched', '250 ms', '98%', 'false-interrupt tolerance', 'Haley', 'Alexis', 'Priya']) expect(p).toContain(target);
  expect(p).toContain('No paid calls authorized by this plan');
  expect(s).toMatch(/No real-device results recorded|## Recorded device results/);
  expect(v + s + p).not.toMatch(/review passed|production certified|fixtures certify hardware/i);
});
```

- [ ] **Step 2: Run red.** From `backend`:

```powershell
npm test -- test/evaluations/voice/evidence-docs.spec.ts
```

Expected: ENOENT for the first missing evidence document. This is a documentation-integrity test, not a passing acceptance test.

- [ ] **Step 3: Implement the three initial documents with the exact content below.** They begin conservatively; update results only after running checks. Markdown files do not receive code-file headers.

Create `docs/voice-modes/verification.md`:

```markdown
# Voice Modes Verification

Scope: [goal](goal.md), [state](state.md), [P11 plan](plan11.md).
Review: skipped. No reviewer verdict is inferred.
Gate: verification pending; both server modes remain default-off.

## Evidence levels and environment

Statuses: unrun, blocked, fail, fixture-pass, native-pass, device-pass, deferred.
Fixture/native passes apply only to the listed behavior and environment, not a release gate.
Tested commit, UTC timestamp, Node/npm/OS, package, command, counts, duration,
fixture/provider versions and clean/dirty owner paths are recorded per execution below.
No execution result is supplied by the existence of this document.
Native prerequisites: operator-supplied AURVIN_TEST_MONGODB_URI and
AURVIN_TEST_DB_PREFIX=aurvin_p2_test_; generated isolated databases only.
Do not log URIs, credentials, raw audio, transcripts or unsent drafts.

## Acceptance matrix

| ID | Applicable assertion / evidence | Initial status |
| --- | --- | --- |
| A1 | Existing text build/lint/unit/e2e; multi-mode text before/after; no auth/tool regression claim | unrun |
| A2 | voice-matrix permission denial/activation + all real browser permission rows | unrun |
| A3 | multi-mode final dedupe; frontend interim replacement; Nova fixture normalization | unrun |
| A4 | voice-matrix selection replacement + P7 cancel/selection tests | unrun |
| A5 | multi-mode pauses/finals cause no inference; dictation-controller recording remains active | unrun |
| A6 | P7 composer-events Enter/click finalization races + real stop-to-editable p95 | unrun |
| A7 | live wire JSON has no hidden text; voice-matrix SSR; real DOM/accessibility inspection and actual audible reply | unrun |
| A8 | multi-mode prompt membership/session isolation; P6/P2 restored-checkpoint heard-context tests | unrun |
| A9 | fault-recovery interruption prefix/late frames; frontend local clear; real p95 stop <=250 ms | unrun |
| A10 | Mutation confirmation, actions, tools: deferred, outside scoped agent | deferred |
| A11 | fault-recovery sealed agent outcomes, reconnect and idempotency; mutation duplication portion deferred | unrun |
| A12 | voice-matrix mute drops/no replay + gateway mute epoch tests; real muted input observation | unrun |
| A13 | draft restore, resource close, archive/status/stream/sidebar filtering; real exit navigation | unrun |
| A14 | injected TTS/STT/network/device faults, P3 resilience, P6 recovery; actual provider/proxy/device drills | unrun |
| A15 | Hardware speaker echo/noise with product-approved false-interrupt tolerance | blocked |
| A16 | Origin, binding, identity override, stale epoch/control rejection before speech; authenticated cross-user isolation deferred | unrun |
| A17 | lifecycle hidden/pagehide/route/session-switch checks; real background/freeze/resume microphone indicator | unrun |
| A18 | Node keyboard/SSR/CSS contracts + six-browser real keyboard, focus, reduced motion and audio matrix | unrun |

Collision contract: HTTP 409 CONFLICT_ACTIVE_TURN for live-versus-text submit/retry,
competing live reservations, and reverse text-versus-live admission across tabs.
Quota exhaustion is separately 429, not proof of correct execution exclusion.

## Execution records

No commands/results recorded yet. Each result row requires:
UTC | tested commit | workdir/command | evidence class | tests/pass/fail/skip |
duration | redacted artifact | limitation | owner/blocker.
Store command output outside tracked source; publish redacted aggregates only.
At worker completion replace this statement with the actual records and commit IDs.

## Required automated coverage

Backend: build, lint, npm test, npm run test:e2e; requested integration and evaluation
files must be discovered. Frontend: build, lint, npm test; voice-matrix must be discovered.
Also run existing P2 context/persistence/visibility/deletion, P3 provider/offset,
P4 PCM/queue/client, P5 malformed/state/ticket/epoch, P6 bridge/recovery/serializer,
P7 composer, P8 lifecycle, P9 quota/usage/drain/flag, and P10 assembly suites.
Configured unavailable native services fail. Unconfigured native tests and the
absent pilot-artifact test are skips, separately blocked evidence, never passes.
Azure certification is outside this admitted native topology.

## Defects and independent mode gates

At the P10 handoff verify the conversation binder, lazy shared reservations,
activity/idle/duration warnings, stop reasons and shutdown/drain wiring. Record an
actual failing check and owner before requesting a correction; no P11 source fix.
Dictation and live eligibility are independent and require their applicable
native/privacy/resource/browser and measured pilot evidence. Nothing here enables
flags, deploys, authorizes provider spending, or certifies public/multi-user use.
External checks: [staging evidence](staging-evidence.md), [pilot evaluation](pilot-evaluation.md).
Final integrated commit verification and final_report.md belong to V.
```

Create `docs/voice-modes/staging-evidence.md`:

```markdown
# Voice Modes Staging Evidence

Policy: [operations](operations.md). Acceptance: [verification](verification.md).
Status: unrun. No real-device results recorded.
Environment: loopback or separately authorized access-controlled staging only.
No public deployment, feature enablement, provisioning, or provider call is authorized here.

## Browser and device matrix

Record actual browser/OS/device/version, input/output device, sample rate,
secure context, gesture, provider/model versions and tested commit for every row.
Node audio fakes/SSR are not browser/device evidence; desktop emulation is not iOS/Android evidence.

| Browser | Permission/Worklet/playback | Keyboard/reduced motion/privacy | Mute/interrupt/lifecycle | Status |
| --- | --- | --- | --- | --- |
| Chrome | no measurement | no measurement | no measurement | unrun |
| Edge | no measurement | no measurement | no measurement | unrun |
| Firefox | no measurement | no measurement | no measurement | unrun |
| Safari | no measurement | no measurement | no measurement | unrun |
| iOS Safari | no measurement | no measurement | no measurement | unrun |
| Android Chrome | no measurement | no measurement | no measurement | unrun |

## Exact per-row procedure

1. Open the actual approved build on HTTPS or loopback. Record commit and device.
   Before activation confirm no microphone prompt/indicator or capture/provider socket.
2. Activate Dictate message by keyboard. Deny permission; text input/Send still work.
   Clear site permission, activate again and grant; verify the real AudioWorklet
   loads, recording label, hardware sample rate and actual 16 kHz PCM resampling.
3. Draft "Before OLD after", select OLD backward, dictate two revised phrases.
   Verify prefix/suffix, no duplicate finals, no auto-Send after a pause, read-only
   recording, Stop/Enter gating, final editable text and Cancel selection restore.
4. Preserve an unsent draft and enter live mode by explicit gesture. Inspect actual
   DOM, accessibility tree/live regions, wire JSON and sidebar/history after exit:
   no user/assistant live transcript, token animation, unsent draft or private reasoning.
   Hear streamed audio and prove listening remains active while speaking.
5. Tab/Shift+Tab, Enter/Space activate labeled native controls; visible focus remains.
   Alt+M mute, Escape stop, Alt+X exit; IME/repeat/text-input shortcuts must not trigger.
   Enable OS reduced motion: inspect computed animation and labels, not source CSS alone.
6. Mute while speaking: capture transmission/buffers stop, playback may continue.
   Unmute by gesture; no old samples replay. Interrupt mid-sentence; record detected
   event and actual silence time, drop old response frames, and ask a heard-content follow-up.
7. Hide/freeze tab, return, navigate, switch sessions, disconnect microphone and
   repeatedly enter/exit. Verify tracks/worklet/sources/sockets close; visible return
   never resumes audio without explicit gesture; the right draft/session remains.
8. Disconnect network during partial input and after durable generated completion.
   Restore within the configured recovery deadline: new epoch, no replayed old
   audio/incomplete turn/inference. Beyond deadline: restore text and committed draft.
9. Repeat with speakers/headphones and approved realistic noise; attach pilot run ID.

## Protected proxy and operations drills

All unrun until separately authorized. Verify both REST/control and WebSocket
upgrade share the same access-controlled boundary; Origin/tickets are not authentication.
Use only synthetic text/consented audio and isolated databases.
Verify /api native upgrade through actual Vite and staging proxy, timeout/session
duration, disconnect/backpressure limits, TLS/Origin enforcement, and no credential URLs.
Disable each flag independently; text remains usable and the other mode follows policy.
Exhaust configured quota, 5/20-minute caps, 60+30-second idle, shutdown/drain;
observe warning and stop reasons, no paid readiness probes and no restart loops.
Check redacted logs, no raw audio persistence, internal-record retention/deletion,
backup/restore, rollback and migration against operations.md; do not rewrite policy.
For an actual crash drill stop the sole isolated executor with bounded synthetic work,
prove it and its in-flight work are stopped, then follow the established handoff/
reconciliation procedure. Never expire/delete a sentinel to force admission. Verify
sealed-result recovery/no reinference and no-result interrupted/unknown outcomes.
Sequential runtime reconstruction in a test is not a passed hard-crash drill.

## Execution ledger

No staging drills recorded. Each row needs UTC, commit, environment, device/proxy,
authorization/consent references, procedure/check, measured result, redacted artifact,
pass/fail/block, limits and operator. Leave unavailable rows unrun or blocked.
```

Create `docs/voice-modes/pilot-evaluation.md`:

```markdown
# Voice Modes Pilot Evaluation

Status: unrun; release gates blocked on actual measurements and approvals.
No paid calls authorized by this plan. Review is skipped, not passed.
Offline simulations and provider fixtures cannot certify hardware/provider quality.

## Authorization and dataset

Require written operator authorization identifying speech and OpenRouter account,
time/session/request/minute/spend limits, data-use/consent scope and stop owner.
Account prices/privacy/model-improvement settings are operator inputs; unknown rates
remain unknown. Enforce server quotas and keep both mode flags default-off until authorized.
Dataset minimum: 100 utterances and 30 matched no-tool multi-turn task sessions.
Include English/Indian English, names/IDs, numbers/currency/dates, attached negations,
intentional repetition, domain terms, long pauses, silence, headphones/speakers and noise.
Use consented fixtures in approved restricted storage, not production collections or
Git. Record stable IDs, reference transcripts, critical spans, accent/noise strata,
audio hashes/source rights, timing labels and adjudication; no raw audio application persistence.

## Collection and scoring procedure

1. Freeze tested commit, config, server model, provider-reported versions, keyterms,
   effective rates, topology, device/browser/region and dataset IDs. No model rewrite.
2. For each labeled utterance collect actual provider output through the React/Nest
   path. Independent grading computes corpus-weighted WER and critical-value accuracy;
   preserve repetitions/negation and evaluate formatting equivalence with documented
   canonical labels. Do not mistake exact fixture JSON echo for acoustic accuracy.
3. Timestamp recognizable speech -> visible dictation partial and Stop -> editable
   final draft. For live: last user speech sample -> first actually played output
   sample, INCLUDING turn detection; provider receipt/gateway audio is not audible playback.
   Align monotonic clocks or explicitly record clock alignment/error; report browser
   output latency/acoustic confirmation and exclude permission prompts. Cold starts
   separate. Report p50/p95 and counts per mode/browser/accent/noise stratum.
4. Capture STT, turn detection, LLM, TTS, transport/playback segments separately;
   record accepted interruption -> local silence (actual hardware), duration and idle.
   Include eligible failures in session establishment denominators; report missing,
   censored, failed and incomplete timings instead of silently discarding them.
5. Run the same 30 matched conversational task scripts with voice and text, the same
   no-tool LLM/config/context and equivalent starting sessions. Randomize order;
   independent rubric graders label final success, clarification counts, and early
   cutoffs. Compare paired success rates within 5 percentage points. Do not score
   mutation/tool tasks or infer completion from an unchanged canned fixture response.
6. Count invalid transport/session acceptance and duplicate agent executions across
   repeat/reconnect/cancel scenarios; required count zero. Authenticated tenant/tool
   authorization metrics remain deferred. Retain generated/heard/unknown distinctions.
7. Audition Haley, Alexis, Priya using identical authorized prose tasks/devices;
   record intelligibility, names/numbers/Indian English, comfort, interruptions and
   preference votes. Do not substitute an untested voice or change default silently.
8. Obtain product approval for a numeric false-interrupt tolerance and denominator
   before A15 certification; presently unspecified, blocked. Label echo/noise false
   interruptions separately from valid barge-ins and early turn cutoff (<5%).
9. Reconcile actual STT open-stream/silence minutes, TTS billing units including
   cancellations, OpenRouter usage and infrastructure with actual account invoices.
   Publish aggregate cost/session/minute, uncertainty and quota behavior; never assume
   exactly-once billing or cancellation charge prevention.

## Metrics and initial evidence

| Metric | Gate | Evidence status |
| --- | --- | --- |
| Dictation partial | p50 <=500 ms; p95 <=1000 ms | unrun |
| Dictation finalization | p95 <=2000 ms | unrun |
| First audible reply, no tools | p50 <=1500 ms; p95 <=2500 ms | unrun |
| Interruption stop | p95 <=250 ms (250 ms target) | unrun |
| Eligible granted starts ready | >=98% | unrun |
| Acoustic dictation WER | <=10% | unrun |
| Critical values | >=98% | unrun |
| Early cutoff | <5% labeled turns | unrun |
| Matched agent success | within 5 percentage points of text | unrun |
| Invalid accepts/duplicate executions | zero scoped cases | unrun |
| Echo/noise false interrupts | product-approved false-interrupt tolerance | blocked |
| Voice audition/cost/privacy/operator ownership | approved actual account/device evidence | unrun |

## Harness artifact contract and limitations

backend/test/evaluations/voice/evaluation.ts defines the bounded pilotSchema:
evidence, samples(speechEndMs/endOfTurnMs/firstPlayedMs/cold), utterances(reference/
hypothesis/critical), matched tasks(id/textSuccess/voiceSuccess), starts/ready,
earlyCutoffs/labeledTurns, invalidAcceptances/duplicateExecutions, versions(stt/tts/llm),
provenance(commit/runId/consentRef/authorizationRef). Use milliseconds in one aligned
clock, one distinct task ID per matched session, and canonical independently graded
critical spans. At least 30 warm timing samples are required; cold rows stay separate.
AURVIN_VOICE_PILOT_EVIDENCE points to the approved external JSON artifact; the offline
test validates/calculates it without making provider calls. Schema validity and a
self-declared hardware-pilot label do not authenticate provenance or certify A15,
device matrix, partial/finalization/stop timing, costs, voice auditions or privacy.
The restricted measurement ledger supplies those additional gates independently.
Record simulated arithmetic and provider-fixture normalization results separately;
neither counts toward the 100 utterances/30 actual matched-task release minimum.

## Decision and evidence ledger

No pilot results recorded. Record run ID, tested commit, UTC, verified dataset hashes,
consent/budget refs, actual model versions, n/failed/missing, p50/p95, grading/cost,
redacted artifact locations, approver and mode-specific decision. Unavailable metrics
remain blocked/unrun. Dictation and live gates are independent; no broad or public
rollout is authorized. Final verification/report remains V's responsibility.
```

- [ ] **Step 4: Run documentation checks green, then collect actual local evidence.** From `backend`:

```powershell
npm test -- test/evaluations/voice/evidence-docs.spec.ts
npm run build
npm run lint
npm test
npm run test:e2e
```

From `frontend`, separately:

```powershell
npm run build
npm run lint
npm test
```

Expected: documentation test PASS; package checks pass where their prerequisites permit. Record full discovery/test/skipped counts. `test:azure`/`test:behavior` may have empty discovery; if run, report empty/unrun, not passing acceptance. No real browser/provider check is automatically run by these commands.

- [ ] **Step 5: Attribute and update actual records without fabricated values.** From root, run individually:

```powershell
git rev-parse HEAD
git status --short
node --version
npm --version
```

In `verification.md`, replace the no-execution statement and matrix's initial statuses **only** with actual observed records: fixture/native results never promote hardware requirements. A criterion with both offline and external parts stays blocked/partial until the external part has evidence. Retain `initial status` or rename to `current evidence/status` consistently. Preserve A10 deferred and the deferred portions of A1/A11/A16/A17.

For reproducible saved machine results, run each package's focused suites with the installed Vitest JSON reporter (use an approved external path, not a tracked output directory):

```powershell
npm test -- test/voice/integration --reporter=json --outputFile=C:/Users/Peter/AppData/Local/Temp/opencode/voice-p11-native.json
npm test -- test/evaluations/voice --reporter=json --outputFile=C:/Users/Peter/AppData/Local/Temp/opencode/voice-p11-evaluation.json
```

From `frontend`:

```powershell
npm test -- src/features/voice/integration-tests/voice-matrix.test.ts --reporter=json --outputFile=C:/Users/Peter/AppData/Local/Temp/opencode/voice-p11-frontend.json
```

Inspect/redact failure output before linking it; JSON assertions can include synthetic payloads. Publish no private dataset contents. Record test commit before documentation commits and distinguish the later documentation-only hash. V reruns on the final assembled commit set.

- [ ] **Step 6: Perform authorized browser/staging/pilot checks or record blocked prerequisites.** Follow the exact artifact procedures. Use OpenChamber browser actions for an actual running app when the client supports driving; open/snapshot/click/inspect/capture can establish the inspected UI, not hardware acoustic success. Do not start servers that may auto-connect to paid providers from private `.env`. A missing device, actual provider budget/data-use consent, product noise tolerance, approved protected boundary, or account version/rate blocks the affected row. Keep flags default-off. No fabricated pilot-artifact JSON is admitted as hardware evidence.

- [ ] **Step 7: Recheck docs/link/ownership consistency.** From `backend` run the evidence-doc test again. From root:

```powershell
git diff --check -- docs/voice-modes/verification.md docs/voice-modes/staging-evidence.md docs/voice-modes/pilot-evaluation.md backend/test/evaluations/voice/evidence-docs.spec.ts
```

Confirm local links resolve (all four source documents exist; `final_report.md` is a future filename, not a broken Markdown link), all A1–A18 rows exist, each measured claim has its exact commit/run evidence, and skipped review/deferred tools/auth are never relabeled passed. This plan adds no DAG edges: P10 worker → P11 worker → V remains unchanged. This self-check is not a dispatched unified review.

- [ ] **Step 8: Commit after index permission.** From root:

```powershell
git add backend/test/evaluations/voice/evidence-docs.spec.ts docs/voice-modes/verification.md docs/voice-modes/staging-evidence.md docs/voice-modes/pilot-evaluation.md
git commit -m "docs(voice): record scoped verification staging and pilot evidence"
```

## P11 handoff checklist

- [ ] Report all P11 implementation commits, exact checks/counts/skips, tested environment and evidence paths.
- [ ] Report production defects to owners with their retained failing regression; do not relax thresholds or claim fixture composition fixes P10.
- [ ] Summarize applicable A1–A18 evidence; A10 deferred, A11 mutation and A16 authenticated cross-user portions deferred.
- [ ] Report each independent mode's gate, unrun paid/hardware/native checks, unresolved A15 tolerance, actual dataset/voice-version/rate gaps.
- [ ] Keep review skipped and no public deployment/flag authorization. If required external evidence is blocked, hand off **implemented verification with blocked release evidence**, not workflow complete. V owns final integrated checks/report/state.

## Planner self-check

The five requested tasks own only P11 paths. Exact tests and minimal test/helper/document content are included; NodeNext backend imports use `.js`, frontend imports use `.ts`/`.tsx`. Native integration is explicitly isolated/gated; missing prerequisites/skipped discovery cannot pass. Task 1 covers shared context, mode exclusion and session binding; Task 3 covers browser-owned drafts. Task 2 distinguishes simulation from process crash and checks no replay/heard context. Task 4 separates arithmetic/transcript fixtures from a real 100-utterance/30-task pilot. Task 5 maps every A ID and all six actual browser targets, measurements, authorization limits and deferred scope. No new dependency, production source edit, provider call, review dispatch or code-doc header in this Markdown plan is planned.
