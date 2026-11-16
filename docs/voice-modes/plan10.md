# Application Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this harness load `executing-plans` and `test-driven-development`. Do not dispatch further agents without orchestrator authorization.

**Goal:** Wire the existing voice services into Aurvin's single runtime and persistence owner, proxy the native voice WebSocket through `/api`, mount the live-voice entry from the application shell, and document default-off local and protected-staging use.

**Architecture:** `AppService` remains the only composition owner. It builds one `VoiceUsageService` and one `VoiceSessionService`, opens one `AgentVoiceAdapter` per live connection against the existing `DurableChatRuntime`, and exposes that same session object to Nest. `configureApplication` installs one `WsAdapter`. The React shell registers `useLiveVoice().start` into the existing `ChatProvider` callback without a second provider or a microphone opened from the registration effect. Feature flags stay server-side. Credentials never enter `VITE_*` settings, URLs, or logs.

**Tech Stack:** Existing NestJS 12, `@nestjs/platform-ws`, `ws`, React 19, Vite 8, Vitest. No new dependency, no lockfile change, no second runtime.

---

## Execution boundaries

- Scope sources: [goal.md](goal.md) decisions 1, 7, 8, and 9; [research.md](research.md) sections 4.1–4.2 and the P10 row; [state.md](state.md) P10 ownership and exit gate. P8's assembly contract and P9's wiring recipe are binding. Review is **skipped**, not passed.
- Re-read the owned files before editing. Preserve unrelated user edits. Do not stage `.openchamber/`, `.env`, lockfiles, or another worker's files. Do not edit `state.md`.
- Do not edit P1–P9 source. That includes contracts, providers, session/gateway/flow files, agent bridge, usage service, operations policy, chat reducer, `ChatView.tsx`, and `docs/voice-modes/operations.md`. P9 already wrote the runbook. This plan links it from the root README; it does not rewrite it.
- Do not create `backend/test/voice/integration/**` or frontend `integration-tests/**`. Those are P11. P10 tests live at the paths below.
- `bindVoiceConversation` is not on `useChatActions` today. Do not add it. The shell forwards the method when present and returns `false` when absent, so a bound live conversation fails closed instead of inventing a local binder. Report that P7 gap in the handoff.
- P5 has no `activity` hook and `VoiceConnection.finish` cannot emit `duration` / `idle` / `shutdown`. `warn` stays a no-op. `stop` is `sessions.end`. Do not enable the live flag in any deployment until that P5 follow-up is committed. Dictation duration does not depend on it, and both flags still ship default-off.
- `observedRuntime` does not forward `submitLiveTurn` or `reservations`. Pass the raw runtime object to `AgentVoiceAdapter` and to HTTP `executionReservations`. Do not construct a second `DurableChatRuntime`, persistence bundle, model client, or close owner.
- Do not point speech failures at `Readiness.providerFailure`, `stopAccepting`, or `process.exitCode`.
- Add the repository file header when creating a code or test file, and update an existing header when the edit exceeds about 30% of the file. Snippets below intentionally omit headers.
- Every npm command runs in the package named in that step. Git commands run at the repository root, one at a time, after the orchestrator grants the shared index. Stage exact paths only.
- No paid Deepgram call, no `npm install`, no flag enablement, no Azure or public rollout. A fixture socket is not device or provider evidence.

## File map

| Exact path | Responsibility |
| --- | --- |
| Modify `backend/src/app.service.ts` | One usage service, one session service, lazy reservations from the existing runtime, per-connection adapter and flows |
| Modify `backend/src/app.module.ts` | Register the existing session instance, gateway, and voice controller. No second owner |
| Modify `backend/src/main.ts` | Install `WsAdapter` before listen |
| Create `backend/test/assembly/voice-bootstrap.e2e-spec.ts` | Diagnostic boot, gateway upgrade, fixture dictation and live submission, speech degradation |
| Modify `frontend/vite.config.ts` | Same-origin `/api` proxy upgrades WebSocket |
| Modify `frontend/src/App.tsx` | One chat provider, one live hook, ref registration, fail-closed bind forwarder |
| Create `frontend/src/App.assembly.test.ts` | Registration, fail-closed bind, no client flag or secret |
| Create `frontend/src/vite-proxy.test.ts` | Proxy `ws: true` and unchanged target |
| Create `backend/test/assembly/readme.spec.ts` | README mentions flags, key, proxy, runbook, and unrun device spike |
| Modify `README.md` | Local and protected-staging voice instructions |
| Do not modify `frontend/src/App.css`, `frontend/src/main.tsx`, `frontend/src/features/chat/ChatView.tsx` | Root CSS and entry stay as they are. P8 already accepts `liveVoice` |

`ChatView` mounting is passing `liveVoice` from the shell. If that prop is missing when the worker starts, stop and request a serialized P8 follow-up. Do not reimplement the panel.

## Shared names introduced by Task 1

Later tasks must use these names. Do not rename them.

```typescript
speechSockets?: SocketFactory
readonly voiceSessions: VoiceSessionService
readonly voiceUsage: VoiceUsageService
```

`AssemblyPorts.speechSockets` is optional. Production uses `socketFactory` from `backend/src/voice/providers/provider-link.ts`. Tests pass a fake and must never fall through to a network socket.

---

### Task 1: Backend central wiring and WebSocket bootstrap

**Files:**
- Modify: `backend/src/app.service.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/main.ts`
- Test: `backend/test/assembly/voice-bootstrap.e2e-spec.ts`

- [ ] **Step 1: Write the failing bootstrap test**

Create `backend/test/assembly/voice-bootstrap.e2e-spec.ts`. Add the repository header above this snippet.

```typescript
import 'reflect-metadata';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import WebSocket from 'ws';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { AppService } from '../../src/app.service.js';
import { configureApplication } from '../../src/main.js';
import { loadConfig } from '../../src/platform/config/load-config.js';
import { AURVIN_CONFIG } from '../../src/platform/tokens.js';
import { VoiceGateway } from '../../src/voice/transport/voice.gateway.js';
import { VoiceSessionService } from '../../src/voice/session/voice-session.service.js';
import type { SocketFactory } from '../../src/voice/providers/provider-link.js';

const secret = 'fixture-deepgram-secret';
const sockets: URL[] = [];
const speechSockets: SocketFactory = (url) => {
  sockets.push(url);
  throw new Error('speech socket');
};

async function boot(env: Record<string, string | undefined> = {}) {
  const config = loadConfig(env);
  const service = await AppService.create(config, {
    writeLog: () => undefined,
    fetcher: async () => { throw new Error('diagnostic assembly called a provider'); },
    open: async () => { throw new Error('diagnostic assembly opened persistence'); },
    speechSockets,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AURVIN_CONFIG).useValue(config)
    .overrideProvider(AppService).useValue(service)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  return { app, service, base: await app.getUrl() };
}

let app: NestExpressApplication;

afterEach(async () => {
  if (!app) return;
  await app.close();
});

it('boots diagnostic voice wiring without a provider socket or a second session owner', async () => {
  const started = await boot();
  app = started.app;
  expect(app.get(VoiceSessionService)).toBe(started.service.voiceSessions);
  expect(app.get(VoiceGateway)).toBeInstanceOf(VoiceGateway);
  const config = await request(started.base).get('/api/voice/config').expect(200);
  expect(config.body.enabledModes).toEqual({ dictation: false, live: false });
  expect(JSON.stringify(config.body).includes(secret)).toBe(false);
  const ready = await request(started.base).get('/api/operations/ready');
  expect(ready.status).toBe(503);
  expect(ready.body.acceptReady).toBe(false);
  expect(ready.body.speech).toBe('off');
  expect(JSON.stringify(ready.body).includes(secret)).toBe(false);
  await request(started.base).get('/api/operations/live').expect(200);
  await request(started.base).post('/api/voice/sessions')
    .set('Origin', 'http://localhost:5173')
    .send({ protocolVersion: 1, mode: 'dictation', conversationId: null, locale: 'en-US', idempotencyKey: 'request-0001' })
    .expect(503);
  expect(sockets).toEqual([]);
  const socket = new WebSocket(started.base.replace('http:', 'ws:') + '/api/voice');
  const closed = once(socket, 'close');
  const [code] = await closed;
  expect(code).toBe(1008);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend`:

```powershell
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
```

Expected: FAIL. Nest cannot find `VoiceSessionService` or `VoiceGateway`, or `GET /api/voice/config` is 404. It must not be a pass, a skip, or a real Deepgram connection.

- [ ] **Step 3: Wire the single owner and the WebSocket adapter**

In `backend/src/main.ts`, import `WsAdapter` from `@nestjs/platform-ws`. Call this as the first statement of `configureApplication`, before `app.get(AppService)` is used for CORS:

```typescript
app.useWebSocketAdapter(new WsAdapter(app));
```

Do not add `DELETE` to CORS. Browser voice HTTP and the upgrade travel through the same-origin `/api` proxy. CORS is not authentication.

In `backend/src/app.module.ts`, import `VoiceGateway` and `VoiceSessionController` / `VoiceSessionService`. Keep `AssemblyModule` as the only `AppService` factory. Register the voice types on `AppModule`, not in a new module:

```typescript
controllers: [AppController, VoiceSessionController],
providers: [
  { provide: VoiceSessionService, inject: [AppService],
    useFactory: (service: AppService) => service.voiceSessions },
  VoiceGateway,
],
```

Do not add `VoiceSessionService` as a class provider beside that factory. Nest would construct a second registry.

In `backend/src/app.service.ts`, preserve the existing constructor checks, asset paths, telemetry, and `initialize`. Add the voice fields and build them in the constructor before `OperationsService`, so the operations lambdas close over the same objects. Update the existing header's purpose, role, and key components to mention this single-owner voice wiring.

Add `speechSockets` to `AssemblyPorts`:

```typescript
speechSockets?: SocketFactory;
```

Imports to add, using `.js` specifiers:

```typescript
import { ServerIdentityResolver } from './platform/identity/server-identity-resolver.js';
import type { ExecutionReservationPort, SpeechUsage } from './contracts/voice.js';
import { ProviderFault, socketFactory, type SocketFactory } from './voice/providers/provider-link.js';
import { NovaSttAdapter } from './voice/providers/nova-stt.js';
import { FluxSttAdapter } from './voice/providers/flux-stt.js';
import { FluxTtsAdapter } from './voice/providers/flux-tts.js';
import { VoiceSessionService } from './voice/session/voice-session.service.js';
import { VoiceSessionError, type SessionContext, type VoiceFlow, type VoiceSink } from './voice/session/voice-session.options.js';
import { DictationFlow } from './voice/session/dictation-flow.js';
import { LiveFlow } from './voice/session/live-flow.js';
import { AgentVoiceAdapter, type VoiceBridgeRuntime } from './voice/agent/agent-voice-adapter.js';
import { VoiceUsageService } from './voice/usage/index.js';
```

Fields and constructor body to add. `sessions` below is the existing repository delegate, not the voice registry.

```typescript
readonly voiceUsage: VoiceUsageService;
readonly voiceSessions: VoiceSessionService;
private voiceSessionsAssigned = false;

// Inside the constructor, after this.ports is assigned and before OperationsService:
this.voiceUsage = new VoiceUsageService({
  config: config.voice,
  now: Date.now,
  admissionPerMinute: config.budgets.maxRequestsPerMinutePerUser,
  schedule: (ms, run) => {
    const timer = setTimeout(run, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
  stop: (sessionId) => this.voiceSessions.end(sessionId),
  warn: () => undefined,
  writeLog: (line) => { this.ports.writeLog(line); },
});
this.voiceSessions = new VoiceSessionService({
  config: config.voice,
  identity: new ServerIdentityResolver(config),
  sessions: this.sessions,
  reservations: this.reservations(),
  frontendOrigin: config.frontendOrigin,
  secureCookie: new URL(config.frontendOrigin).protocol === 'https:',
  admission: (context) => this.voiceUsage.admission(context),
  usage: (context, usage) => this.voiceUsage.usage(context, usage),
  disconnected: (context) => this.voiceUsage.disconnected(context),
  open: (context, sink, signal) => this.openVoice(context, sink, signal),
});
this.voiceSessionsAssigned = true;
```

`stop` reads `this.voiceSessions` only after a quota timer fires. The assignment above completes before admission can run. `warn` is intentionally empty until P5 can emit a validated warning frame. Do not log the session id from `warn`.

Pass these three lambdas in the existing `OperationsService` options object:

```typescript
speechDegraded: () => this.voiceUsage.speechStatus().degraded,
drainVoice: () => this.voiceUsage.drain(),
voiceSnapshot: () => this.voiceUsage.snapshot(),
```

`drainVoice` ignores the millisecond argument. `OperationsService.shutdown` already wraps the call in `boundedResult`. Do not add a second drain deadline here.

Add these methods. `reservations()` returns the raw runtime's object or refuses. It is not a second coordinator.

```typescript
private voiceRuntime(): (VoiceBridgeRuntime & { reservations: ExecutionReservationPort }) | null {
  const runtime = this.rawRuntime;
  if (!runtime || !('reservations' in runtime) || !('submitLiveTurn' in runtime)) return null;
  return runtime as VoiceBridgeRuntime & { reservations: ExecutionReservationPort };
}

private reservations(): ExecutionReservationPort {
  const runtime = this.voiceRuntime();
  if (runtime) return runtime.reservations;
  // ponytail: no ready runtime means there is no reservation object to share. Refuse. Do not allocate a local map.
  const unavailable = async () => { throw new VoiceSessionError('VOICE_DISABLED'); };
  return { acquire: unavailable, bindConversation: unavailable, release: async () => undefined };
}

private speechSockets(): SocketFactory {
  return this.ports.speechSockets ?? socketFactory;
}

private async openVoice(context: SessionContext, sink: VoiceSink, signal: AbortSignal): Promise<VoiceFlow> {
  const sockets = this.speechSockets();
  const usage = (current: SessionContext, speech: SpeechUsage) => this.voiceUsage.usage(current, speech);
  try {
    if (context.response.mode === 'dictation') {
      return await DictationFlow.open(context, sink, signal, new NovaSttAdapter(this.config.voice, sockets), usage);
    }
    const runtime = this.voiceRuntime();
    if (!runtime?.executeTurn || !runtime.cancelLiveTurn || !runtime.reconcileSession
      || !runtime.getLiveTurnStatus || !runtime.findLiveSubmission || !runtime.getLiveDelivery) {
      throw new VoiceSessionError('VOICE_DISABLED');
    }
    const bridge = new AgentVoiceAdapter(runtime, (id, conversationId) =>
      this.voiceSessions.bindConversation(id, conversationId));
    const flow = await LiveFlow.open(context, sink, signal, {
      stt: new FluxSttAdapter(this.config.voice, sockets),
      tts: new FluxTtsAdapter(this.config.voice, sockets),
      hooks: bridge.hooks,
      usage,
    });
    bridge.attach(context, flow, sink);
    return flow;
  } catch (error) {
    if (error instanceof ProviderFault) this.voiceUsage.degrade();
    throw error;
  }
}
```

Replace `httpOptions` so text admission and voice admission share one reservation object when the runtime exists:

```typescript
httpOptions(identity: ServerIdentityResolver): ChatHttpOptions {
  const voice = this.voiceRuntime();
  return {
    runtime: this.operations.runtime,
    sessions: this.sessions,
    messages: this.messages,
    identity,
    budgets: this.config.budgets,
    ...(voice ? { executionReservations: voice.reservations } : {}),
  };
}
```

Do not call `voiceUsage.degrade()` for `VoiceSessionError`. Do not call `noteActivity`, `noteLatency`, or `noteModelUsage` from this file. Those signals are not delivered to P10 until the P5 follow-up exists. Do not delete `voiceSessionsAssigned` if the compiler reports it unused; prefix the field with an underscore or omit it. The assignment order is the invariant, not the flag.

- [ ] **Step 4: Run the bootstrap test and the existing diagnostic e2e**

Run from `backend`, one command at a time:

```powershell
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
npm run test:e2e -- test/app.e2e-spec.ts
```

Expected: both PASS. `sockets` stays empty. Ready speech is `off`. No provider URL is printed.

- [ ] **Step 5: Commit**

```powershell
git add backend/src/app.service.ts backend/src/app.module.ts backend/src/main.ts backend/test/assembly/voice-bootstrap.e2e-spec.ts
git commit -m "feat(voice): wire the gateway into the single application owner"
```

---

### Task 2: Frontend Vite proxy and top-level mounting

**Files:**
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/vite-proxy.test.ts`
- Test: `frontend/src/App.assembly.test.ts`
- Do not modify: `frontend/src/main.tsx`, `frontend/src/App.css`, `frontend/src/features/chat/ChatView.tsx`

- [ ] **Step 1: Write the failing proxy and shell tests**

Create `frontend/src/vite-proxy.test.ts` with a repository header, then:

```typescript
import { expect, it } from 'vitest'
import config from '../vite.config.ts'

it('upgrades the same-origin /api proxy and does not change its target', () => {
  const proxy = config.server?.proxy?.['/api']
  if (!proxy || typeof proxy === 'string') throw new Error('missing /api proxy')
  expect(proxy.ws).toBe(true)
  expect(proxy.changeOrigin).toBe(true)
  expect(proxy.target).toBe(process.env.BACKEND_PROXY_TARGET ?? 'http://localhost:3000')
})
```

Create `frontend/src/App.assembly.test.ts` with a repository header, then:

```typescript
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { bindLiveConversation, registerVoiceStart } from './App.tsx'
import { initialLiveVoice } from './features/voice/state/live-voice-reducer.ts'

const seen: Array<{ conversationId: string | null; draft: string; bindings: {
  refreshSessions: () => void
  bindVoiceConversation: (token: string, conversationId: string) => boolean
} }> = []

vi.mock('./features/voice/dictation/useDictation.ts', () => ({
  useDictation: () => ({ config: null, locked: false, phase: 'idle', status: '', notice: null,
    start: () => undefined, stop: () => undefined, cancel: () => undefined }),
}))
vi.mock('./features/voice/state/useLiveVoice.ts', () => ({
  useLiveVoice: (options: (typeof seen)[number]) => {
    seen.push(options)
    return { view: initialLiveVoice, start: () => undefined, toggleMute: () => undefined,
      interrupt: () => undefined, exit: () => undefined, resume: () => undefined }
  },
}))

it('registers and clears only the current live start callback', () => {
  const ref: { current: (() => void) | null } = { current: null }
  const start = vi.fn()
  const stop = registerVoiceStart(ref, start)
  ref.current?.()
  expect(start).toHaveBeenCalledOnce()
  stop()
  ref.current?.()
  expect(start).toHaveBeenCalledOnce()
})

it('forwards a P7 bind action and fails closed when that action is absent', () => {
  expect(bindLiveConversation({}, 'lease-1', 'chat-1')).toBe(false)
  const bind = vi.fn(() => true)
  expect(bindLiveConversation({ bindVoiceConversation: bind }, 'lease-1', 'chat-1')).toBe(true)
  expect(bind).toHaveBeenCalledWith('lease-1', 'chat-1')
})

it('mounts one text shell and does not put voice flags or secrets in the client entry', async () => {
  const { default: App } = await import('./App.tsx')
  const html = renderToStaticMarkup(createElement(App))
  expect(html).toContain('Message composer')
  expect(html).not.toContain('Live voice conversation')
  expect(seen[0]?.conversationId).toBeNull()
  expect(seen[0]?.bindings.bindVoiceConversation('lease-1', 'chat-1')).toBe(false)
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
  expect(app).not.toMatch(/VITE_/)
  expect(main).toContain('<App />')
  expect(main).not.toMatch(/VITE_(?!API_BASE)/)
  expect(app + main).not.toMatch(/DEEPGRAM|ENABLE_LIVE_VOICE|ENABLE_DICTATION/)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `frontend`, one command at a time:

```powershell
npm test -- src/vite-proxy.test.ts
npm test -- src/App.assembly.test.ts
```

Expected: FAIL. The proxy test fails because `ws` is undefined. The assembly test fails because `bindLiveConversation` and `registerVoiceStart` are not exported. It must not open a microphone or a WebSocket.

- [ ] **Step 3: Add the proxy flag and the shell**

In `frontend/vite.config.ts`, add `ws: true` to the existing `/api` proxy. Leave `target` and `changeOrigin` as they are:

```typescript
'/api': {
  target: process.env.BACKEND_PROXY_TARGET ?? 'http://localhost:3000',
  changeOrigin: true,
  ws: true,
},
```

Replace the body of `frontend/src/App.tsx` below its imports. Keep the CSS import. Update the existing header because this file grows past a small edit. Do not create a second `ChatProvider`.

```typescript
import { useCallback, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import { ChatProvider, ChatView, type ApiClient } from './features/chat/index.ts'
import { useChat } from './features/chat/state/chat-context.tsx'
import { useLiveVoice } from './features/voice/state/useLiveVoice.ts'
import './App.css'

export function bindLiveConversation(actions: {
  bindVoiceConversation?: (token: string, conversationId: string) => boolean
}, token: string, conversationId: string) {
  return actions.bindVoiceConversation?.(token, conversationId) ?? false
}

export function registerVoiceStart(ref: { current: (() => void) | null }, start: () => void) {
  ref.current = start
  return () => { if (ref.current === start) ref.current = null }
}

function VoiceChatShell({ startRef }: { startRef: MutableRefObject<(() => void) | null> }) {
  const { state, actions } = useChat()
  const voice = useLiveVoice({
    conversationId: state.activeSessionId,
    draft: state.draftInput,
    bindings: {
      claimVoiceInput: (mode, onClose) => actions.claimVoiceInput(mode, onClose),
      writeVoiceDraft: (token, text) => actions.writeVoiceDraft(token, text),
      releaseVoiceInput: (token) => actions.releaseVoiceInput(token),
      bindVoiceConversation: (token, id) => bindLiveConversation(actions, token, id),
      refreshSessions: () => { void actions.loadSessions() },
    },
  })
  useLayoutEffect(() => registerVoiceStart(startRef, voice.start), [startRef, voice.start])
  return <ChatView liveVoice={voice} />
}

function App({ client }: { client?: ApiClient } = {}) {
  const startRef = useRef<(() => void) | null>(null)
  const startVoiceConversation = useCallback(() => { startRef.current?.() }, [])
  return (
    <ChatProvider client={client} startVoiceConversation={startVoiceConversation}>
      <VoiceChatShell startRef={startRef} />
    </ChatProvider>
  )
}

export default App
```

`useLiveVoice` already refuses to start unless the server config enables live mode. Do not add a `VITE_` flag. Do not call `voice.start` from the layout effect. Registration must not call `getUserMedia`.

Leave `main.tsx` and `App.css` unchanged. Leave `ChatView.tsx` unchanged. It already hides the composer when `showsLiveVoice` is true.

- [ ] **Step 4: Run the frontend assembly tests**

Run from `frontend`, one command at a time:

```powershell
npm test -- src/vite-proxy.test.ts
npm test -- src/App.assembly.test.ts
```

Expected: PASS. The rendered markup contains the composer and does not contain `Live voice conversation`.

- [ ] **Step 5: Commit**

```powershell
git add frontend/vite.config.ts frontend/src/App.tsx frontend/src/vite-proxy.test.ts frontend/src/App.assembly.test.ts
git commit -m "feat(voice): proxy and mount the voice shell"
```

---

### Task 3: Central application and startup integration tests

**Files:**
- Modify: `backend/test/assembly/voice-bootstrap.e2e-spec.ts`
- Modify: `backend/src/app.service.ts` only if the degrade assertion fails
- Test: the same e2e file

- [ ] **Step 1: Add the failing startup and fixture round-trip tests**

Append these tests to `backend/test/assembly/voice-bootstrap.e2e-spec.ts`. Keep the Task 1 helpers. Extend the socket fake so an enabled boot can complete a handshake without a network call. Add a repository header only if the file still lacks one.

Add this fake beside the existing `speechSockets` throwing factory. The enabled tests pass this factory instead.

```typescript
import { EventEmitter } from 'node:events';
import { INPUT_AUDIO, type VoiceClientPayload } from '../../src/contracts/voice-wire.js';
import type { ExecutionReservation, ExecutionReservationPort } from '../../src/contracts/voice.js';
import type { ProviderSocket } from '../../src/voice/providers/provider-link.js';

class FakeProviderSocket extends EventEmitter implements ProviderSocket {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: Array<string | Uint8Array> = [];
  constructor(readonly url: URL, readonly headers: Record<string, string>) {
    super();
    queueMicrotask(() => {
      this.emit('open');
      if (url.pathname.startsWith('/v2/')) this.emit('message', Buffer.from(JSON.stringify({
        type: 'Connected', request_id: 'req-fixture', model_version: 'fixture',
      })), false);
    });
  }
  send(data: string | Uint8Array, callback: (error?: Error) => void) { this.sent.push(data); callback(); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
  ping() { this.emit('pong'); }
  serverText(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
}

function recordingSockets() {
  const opened: FakeProviderSocket[] = [];
  const factory: SocketFactory = (url, headers) => {
    const socket = new FakeProviderSocket(url, headers);
    opened.push(socket);
    return socket;
  };
  return { opened, factory };
}
```

The enabled boot must not use the throwing `speechSockets` from Task 1. Copy `boot`, but pass `recordingSockets().factory` and a runtime stub. Do not open a real MongoDB client. `observePersistence` only reads `sessions`, `messages`, `memory`, `metadata`, and `checkpoints.create` during construction.

```typescript
const enabledEnv = {
  FRONTEND_ORIGIN: 'http://127.0.0.1:5173',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/aurvin_assembly_fixture',
  PERSISTENCE_PROFILE: 'native-mongodb',
  OPENROUTER_API_KEY: 'fixture-openrouter',
  OPENROUTER_MODEL: 'fixture-model',
  OPENROUTER_DATA_COLLECTION: 'deny',
  OPENROUTER_DISABLE_TRANSFORMS: 'true',
  ENABLE_DICTATION_MODE: 'true',
  ENABLE_LIVE_VOICE_MODE: 'true',
  DEEPGRAM_API_KEY: secret,
};

function runtimeStub() {
  const calls = { submit: 0, execute: 0 };
  const held = new Map<string, ExecutionReservation>();
  const reservations: ExecutionReservationPort = {
    acquire: async (command) => {
      const reservation = { reservationId: `reservation-${held.size + 1}`, userId: command.identity.userId,
        conversationId: command.conversationId, owner: command.owner };
      held.set(reservation.reservationId, reservation);
      return reservation;
    },
    bindConversation: async (command) => {
      const current = held.get(command.reservationId);
      if (!current || current.owner.kind !== 'live') throw new Error('missing reservation');
      const next = { ...current, conversationId: command.conversationId };
      held.set(command.reservationId, next);
      return next;
    },
    release: async (command) => { held.delete(command.reservationId); },
  };
  return {
    reservations,
    calls,
    submitLiveTurn: async () => {
      calls.submit += 1;
      return { sessionId: 'chat-1', turnId: 'turn-1', attemptId: 'attempt-1' };
    },
    findLiveSubmission: async () => false,
    getLiveTurnStatus: async () => ({ status: 'completed' }),
    reconcileSession: async () => undefined,
    executeTurn: async () => { calls.execute += 1; },
    cancelLiveTurn: async () => undefined,
    getLiveDelivery: async () => null,
  };
}
```

Add this enabled boot. Do not change Task 1's `boot`. It must keep throwing if persistence or a speech socket is opened. Cast the stub so type-aware lint accepts it. `ModelLimits` is `{ modelId, contextTokens, outputTokens, supportsMaxTokens, source }`. Do not call the catalogue.

```typescript
import type { AssemblyPorts } from '../../src/app.service.js';

async function bootEnabled(factory: SocketFactory, runtime: ReturnType<typeof runtimeStub>) {
  const config = loadConfig(enabledEnv);
  const service = await AppService.create(config, {
    writeLog: () => undefined,
    fetcher: async () => { throw new Error('enabled assembly called a provider'); },
    speechSockets: factory,
    limits: (async () => ({ modelId: 'fixture-model', contextTokens: 8192, outputTokens: 1024,
      supportsMaxTokens: true, source: 'fixture' as const })) as AssemblyPorts['limits'],
    runtime: (() => runtime) as AssemblyPorts['runtime'],
    open: (async () => ({
      ping: async () => true,
      close: async () => undefined,
      sessions: {},
      messages: {},
      memory: {},
      metadata: {},
      owner: { assertExecutor: async () => undefined },
      checkpoints: { create: async () => ({ setup: async () => undefined, bind: () => ({}) }) },
    })) as AssemblyPorts['open'],
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AURVIN_CONFIG).useValue(config)
    .overrideProvider(AppService).useValue(service)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  return { app, service, base: await app.getUrl(), runtime };
}

async function until(assert: () => void) {
  const deadline = Date.now() + 2000;
  let last: unknown;
  while (Date.now() < deadline) {
    try { assert(); return; } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw last;
}
```

Add this client helper:

```typescript
async function connect(base: string, mode: 'dictation' | 'live') {
  const created = await request(base).post('/api/voice/sessions').set('Origin', 'http://127.0.0.1:5173')
    .send({ protocolVersion: 1, mode, conversationId: null, locale: 'en-US', idempotencyKey: `${mode}-0001` })
    .expect(201);
  expect(JSON.stringify(created.body).includes(secret)).toBe(false);
  expect(JSON.stringify(created.headers).includes(secret)).toBe(false);
  const cookie = String(created.headers['set-cookie'][0]).split(';')[0];
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/voice', {
    headers: { Origin: 'http://127.0.0.1:5173', Cookie: cookie },
  });
  const messages: Array<{ data: Buffer; binary: boolean }> = [];
  socket.on('message', (data, binary) => messages.push({ data: Buffer.from(data as Buffer), binary }));
  await once(socket, 'open');
  let sequence = 0;
  const control = (payload: VoiceClientPayload) => socket.send(JSON.stringify({
    protocolVersion: 1, sessionId: created.body.sessionId, connectionEpoch: created.body.connectionEpoch,
    eventId: `client-${sequence}`, sequence: sequence++, ...payload,
  }));
  control({ type: 'session.start', mode, audioSettings: INPUT_AUDIO });
  const next = async () => {
    while (messages.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    return messages.shift()!;
  };
  expect(JSON.parse((await next()).data.toString()).type).toBe('session.ready');
  return { socket, next, created };
}
```

Tests to append:

```typescript
it('reports unconfigured speech without a socket or a text restart', async () => {
  const started = await boot({ ENABLE_DICTATION_MODE: 'true' });
  app = started.app;
  const ready = await request(started.base).get('/api/operations/ready');
  expect(ready.body.speech).toBe('unconfigured');
  expect(ready.body.acceptReady).toBe(false);
  expect(JSON.stringify(ready.body).includes('DEEPGRAM_API_KEY is missing')).toBe(false);
  await request(started.base).get('/api/operations/live').expect(200);
  expect(sockets).toEqual([]);
});

it('dictation partials travel through the assembled Nova adapter and do not submit a turn', async () => {
  const recorded = recordingSockets();
  const runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime);
  app = started.app;
  const connection = await connect(started.base, 'dictation');
  const nova = recorded.opened.find((socket) => socket.url.pathname === '/v1/listen');
  if (!nova) throw new Error('Nova socket was not opened');
  expect(nova.headers.Authorization).toBe(`Token ${secret}`);
  expect(recorded.opened.some((socket) => socket.url.pathname === '/v2/listen')).toBe(false);
  nova.serverText({ type: 'Results', channel_index: [0, 1], duration: 0.4, start: 0,
    is_final: false, speech_final: false, channel: { alternatives: [{ transcript: 'hello aurvin' }] } });
  const partial = JSON.parse((await connection.next()).data.toString());
  expect(partial.type).toBe('dictation.partial');
  expect(partial.text).toBe('hello aurvin');
  expect(runtime.calls.submit).toBe(0);
  expect(runtime.calls.execute).toBe(0);
  connection.socket.close();
});

it('a finalized live turn submits once on the injected runtime and does not execute inference', async () => {
  const recorded = recordingSockets();
  const runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime);
  app = started.app;
  const connection = await connect(started.base, 'live');
  const stt = recorded.opened.find((socket) => socket.url.pathname === '/v2/listen');
  const tts = recorded.opened.find((socket) => socket.url.pathname === '/v2/speak');
  if (!stt || !tts) throw new Error('Flux sockets were not both opened');
  stt.serverText({ type: 'TurnInfo', request_id: 'req-fixture', sequence_id: 1, turn_index: 0,
    event: 'EndOfTurn', transcript: 'hello aurvin', audio_window_end: 0.8 });
  await until(() => { expect(runtime.calls.submit).toBe(1); });
  expect(runtime.calls.execute).toBe(0);
  expect(started.service.voiceSessions).toBe(app.get(VoiceSessionService));
  connection.socket.close();
});

it('a speech socket error degrades speech and does not block text liveness', async () => {
  const recorded = recordingSockets();
  const started = await bootEnabled(recorded.factory, runtimeStub());
  app = started.app;
  await connect(started.base, 'dictation');
  const nova = recorded.opened.find((socket) => socket.url.pathname === '/v1/listen');
  if (!nova) throw new Error('Nova socket was not opened');
  nova.emit('error', new Error('fixture speech down'));
  const ready = await request(started.base).get('/api/operations/ready');
  expect(ready.body.speech).toBe('degraded');
  expect(ready.body.provider).not.toBe('blocked');
  await request(started.base).get('/api/operations/live').expect(200);
  expect(JSON.stringify(ready.body).includes(secret)).toBe(false);
});
```

Replace the Task 1 `afterEach` with this drain. A second `afterEach` is not allowed. Provider timers keep the process alive if sessions are only closed:

```typescript
afterEach(async () => {
  if (!app) return;
  await app.get(AppService).voiceSessions.drain().catch(() => undefined);
  await app.close();
});
```

- [ ] **Step 2: Run the new tests to verify the degrade case fails**

Run from `backend`:

```powershell
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
```

Expected: the Task 1 diagnostic test still PASS. The dictation and live cases PASS if Task 1 attached the real adapters to `speechSockets`. If either fails, fix only `openVoice` in `app.service.ts`. Do not edit provider, session, or agent files. The socket-error test FAIL with `speech` still `ready` is the required red result. A hang, a DNS lookup, or a call to `api.deepgram.com` is a defect: the fake factory was not used.

- [ ] **Step 3: Degrade speech on the composed socket error**

In `speechSockets()`, wrap the selected factory. One error increments degradation once. Do not also call `degrade()` from `openVoice` for the same socket error.

```typescript
private speechSockets(): SocketFactory {
  const factory = this.ports.speechSockets ?? socketFactory;
  return (url, headers) => {
    const socket = factory(url, headers);
    socket.on('error', () => this.voiceUsage.degrade());
    return socket;
  };
}
```

Keep the `ProviderFault` catch in `openVoice` for failures that happen before a socket exists, such as a missing key during connect. Do not call `this.operations.readiness.providerFailure`.

- [ ] **Step 4: Run the assembly e2e file**

Run from `backend`:

```powershell
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
```

Expected: PASS, including the Task 1 diagnostic case. No test skips. No credential appears in an assertion message. `executeTurn` remains 0.

- [ ] **Step 5: Commit**

```powershell
git add backend/test/assembly/voice-bootstrap.e2e-spec.ts backend/src/app.service.ts
git commit -m "test(voice): assemble fixture voice startup round trips"
```

If `app.service.ts` has no remaining uncommitted change because the wrapper was already present, stage only the test file. Do not amend the Task 1 commit.

---

### Task 4: Root README and operations documentation

**Files:**
- Modify: `README.md`
- Test: `backend/test/assembly/readme.spec.ts`
- Do not modify: `docs/voice-modes/operations.md`, `deployment/staging/**`

- [ ] **Step 1: Write the failing README contract test**

Create `backend/test/assembly/readme.spec.ts` with a repository header, then:

```typescript
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const readme = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../README.md'), 'utf8');

it('documents default-off voice flags, the server key, and the same-origin socket proxy', () => {
  expect(readme).toContain('ENABLE_DICTATION_MODE');
  expect(readme).toContain('ENABLE_LIVE_VOICE_MODE');
  expect(readme).toContain('DEEPGRAM_API_KEY');
  expect(readme).toContain('ws: true');
  expect(readme).toContain('docs/voice-modes/operations.md');
  expect(readme).toContain('Do not enable the live flag');
  expect(readme).toContain('primary desktop and mobile capture/playback spike is unrun');
  expect(readme).not.toMatch(/VITE_DEEPGRAM|VITE_ENABLE_LIVE|VITE_ENABLE_DICTATION/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend`:

```powershell
npm test -- test/assembly/readme.spec.ts
```

Expected: FAIL because those sentences are absent. Do not weaken the assertions.

- [ ] **Step 3: Document local and protected use in the root README**

Edit `README.md` only. Keep the existing Phase 1 instructions. Apply these exact text changes.

In the opening paragraph, after the sentence that says no model picker or application authentication is enabled, add:

```markdown
Dictation and live voice are implemented behind independent server flags that default off. Text chat remains available when either flag is off. Voice does not add authentication, live tools, or a browser-configured model.
```

In the Install section, after the sentence that forbids MongoDB credentials, an OpenRouter key, user identity, or a model override in `VITE_*` settings, add:

```markdown
Never add `DEEPGRAM_API_KEY`, `ENABLE_DICTATION_MODE`, `ENABLE_LIVE_VOICE_MODE`, or a voice model id as a `VITE_*` setting. The browser learns enabled modes only from `GET /api/voice/config`.
```

Replace the Run locally sentence that says changing the backend port requires a P1-owned proxy configuration change with:

```markdown
Open http://localhost:5173. The Vite development proxy forwards `/api` HTTP and WebSocket upgrades to `BACKEND_PROXY_TARGET`, or `http://localhost:3000` when that variable is unset. `ws: true` is required. `run.bat` already sets the target to `http://127.0.0.1:8001`. A backend-port change must update both `PORT` and `BACKEND_PROXY_TARGET`. A New Chat does not save an empty session: the first accepted text message creates it. Opening voice on an unsaved chat also does not create an empty transcript; only an accepted live turn creates the conversation.
```

Add this section after the existing readiness commands and before "Build and start the backend release":

```markdown
## Voice modes

Voice is optional, server-configured, and off unless an operator sets exactly `true`. `false` is the shipped default. Blank external settings still start diagnostic text mode: `/api/operations/live` works, `/api/operations/ready` is 503, and `speech` is `off`.

| Setting | Meaning |
| --- | --- |
| `ENABLE_DICTATION_MODE=false` | Nova-3 composer dictation. Dictation never submits a turn. |
| `ENABLE_LIVE_VOICE_MODE=false` | Flux live conversation. Keep this false until the P5 warning-frame follow-up in `docs/voice-modes/plan9.md` is committed. Until then, quota stops end the session without a validated `session.warning`. |
| `DEEPGRAM_API_KEY` | Server-only. A flag set to `true` with an empty key reports `speech: unconfigured` and does not call Deepgram during readiness. |
| `DEEPGRAM_API_BASE` | `wss://api.deepgram.com` or `wss://api.eu.deepgram.com`. |
| `DEEPGRAM_TTS_MODEL` | `flux-haley-en`, `flux-alexis-en`, or `flux-priya-en`. |

The full quota, endpointing, and rate names are in [backend/.env.example](backend/.env.example). Leave rate variables blank until the operator copies them from the actual account. Missing rates stay unknown. Do not invent `$0`. Do not put the key in a URL, a log, or a frontend environment file.

Local voice traffic uses the same Vite `/api` proxy as text chat. The browser connects to `/api/voice`, not to Deepgram. Protected staging uses the existing basic-auth gateway. The exact socket location is `location = /api/voice` in [deployment/staging/nginx.conf](deployment/staging/nginx.conf). REST voice routes remain under `/api/`. Copying that file does not start NGINX, install a certificate, or enable a flag. Policy, drain order, and the speech readiness field are in [docs/voice-modes/operations.md](docs/voice-modes/operations.md).

A speech outage must not restart the process or take text chat down. Cancellation and quota stops do not guarantee charge prevention. The primary desktop and mobile capture/playback spike is unrun. Fixture tests do not certify latency, fidelity, echo, or a real provider.
```

In "Protected staging and shutdown", after the sentence that says no infrastructure has been provisioned, add:

```markdown
Voice session routes and the `/api/voice` upgrade must stay inside that same access-controlled boundary. Do not publish a separate voice port. Do not enable either voice flag from this README.
```

In "Evidence and remaining gates", add:

```markdown
Voice fixture assembly is not a device, browser, or Deepgram certification. The primary desktop and mobile capture/playback spike is unrun and blocks the corresponding release gate. Do not enable the live flag until the P5 warning follow-up lands. Unified review remains skipped, not passed.
```

- [ ] **Step 4: Run the README contract test**

Run from `backend`:

```powershell
npm test -- test/assembly/readme.spec.ts
```

Expected: PASS. Then confirm the linked paths exist. Do not run a paid check or `nginx -t` as evidence.

- [ ] **Step 5: Commit**

```powershell
git add README.md backend/test/assembly/readme.spec.ts
git commit -m "docs(voice): document default-off voice flags and local proxy"
```

---

## Worker verification before handoff

Run these from the named directory, one command at a time. Record actual exit status. A skipped suite is not a pass.

From `backend`:

```powershell
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
npm run test:e2e -- test/app.e2e-spec.ts
npm test -- test/assembly/readme.spec.ts
npm run build
npm run lint
```

From `frontend`:

```powershell
npm test -- src/vite-proxy.test.ts
npm test -- src/App.assembly.test.ts
npm run build
npm run lint
npm test
```

Do not run `npm run test:azure`, a live Deepgram call, or a browser device matrix. Report those as not run.

## Worker handoff

Return to the orchestrator:

- Exact implementation commit list. Do not edit `state.md`.
- Red and green counts for the commands above, plus any pre-existing failure that is outside these files.
- Confirm one `AppService`, one `VoiceSessionService`, one raw runtime reservation object, and one `WsAdapter`.
- Confirm `bindVoiceConversation` is still absent from chat actions, so bound live conversations fail closed until a serialized P7 follow-up.
- Confirm the live flag must stay off until the P5 warning-frame follow-up. `warn` is a no-op. `stop` ends the session.
- The primary desktop and mobile capture/playback spike is unrun. Fixture round trips are not latency, fidelity, echo, or provider evidence. Review is skipped, not passed.

## Planner self-check

- P10 exit gate: single-owner wiring, `WsAdapter`, Vite `ws: true`, shell mount, disabled and unconfigured boot, fixture dictation partial, fixture live submit-once, no credential in client responses, README flags and staging pointer. Device spike is explicitly unrun.
- A1 remains the existing text shell and diagnostic e2e. This plan does not recertify the full text suite.
- No `TBD`, no second runtime, no `VITE_` voice secret, no edit to P9's runbook, no P11 integration directory.
- Names used in later tasks match Task 1: `speechSockets`, `voiceSessions`, `voiceUsage`, `openVoice`. Frontend names match Task 2: `bindLiveConversation`, `registerVoiceStart`, `VoiceChatShell`.
- Authentication, tools, Aura, eager turns, captions, and public deployment stay out of scope.
