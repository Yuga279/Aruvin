# Voice Sessions and Validated Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement P5's identity-bound REST sessions, native WebSocket transport, dictation finalization, and transcript-free live speech bridging without creating another agent runtime.

**Architecture:** Keep one process-local session registry and one native `ws` connection per voice session. A short-lived, single-use HttpOnly cookie carries the connection ticket without changing P1/P4 wire schemas or putting credentials in URLs. Session-owned flow objects consume P3 ports; P6 supplies finalized-turn/cancellation/delivery callbacks and P9 supplies admission/usage/drain policy, while P10 wires the existing composition.

**Tech Stack:** TypeScript NodeNext, NestJS 12, `@nestjs/platform-ws`, native `ws`, existing P1 voice guards/codecs, existing P3 speech ports, Vitest and Nest testing utilities. No new dependencies.

---

## Execution boundaries and facts checked

- Read [goal.md](goal.md), [research.md](research.md), and [state.md](state.md). Scoped integration decisions override the reproduced PRD's authentication/tool assumptions. Review is **skipped**, not passed.
- Upstream workers are implemented: P1 `952b605..a2860f7`, P2 `3c9d638..f9d13f8`, P3 `9bac624..d43eabf`, P4 `ac707b7..2e2e9e4`. Reconfirm these ranges and `git status --short` before implementation. Do not stage existing user changes.
- P1 already implements `isCreateVoiceSessionRequest`, `parseVoiceControl`, `encodeVoiceAudio`, and `decodeVoiceAudio`. Reuse them; do not introduce class-validator DTOs, a second binary parser, or another public voice contract.
- Existing `CreateVoiceSessionResponse` and `session.start` **cannot contain a ticket property**: exact-key guards would reject it. Use `Set-Cookie: aurvin_voice_ticket=...; HttpOnly; SameSite=Strict; Path=/api/voice; Max-Age=10` (effective connect deadline, at most 30 seconds), adding `Secure` in protected HTTPS staging. Same-origin browser WebSockets automatically send this cookie. Neither this ticket nor Origin validation is authentication. This cookie design supports the scoped same-origin `/api` proxy, not arbitrary cross-origin API deployments.
- The response's `expiresAt` is the ticket/connection-establishment deadline, not permission to keep a socket alive indefinitely. P9 enforces recording/session/idle budgets; P5 additionally bounds connect, finalization, reconnect, frames, and queues.
- HTTP controllers use `@Controller('voice')`; the existing global `/api` prefix is P10-owned. WebSocket paths do **not** inherit that prefix: use `@WebSocketGateway({ path: '/api/voice', ... })`.
- Nest's ordinary `WsAdapter` message dispatch expects `{event,data}` and parses JSON. The P1 protocol uses `{type,...}` plus binary. Install **one raw `message` listener in `handleConnection`**, with no `@SubscribeMessage` handlers; use `isBinary`, not `typeof data`, to distinguish `ws` text buffers from PCM. No adapter subclass is needed. Nest's empty handler subscription harmlessly ignores messages it cannot dispatch; the raw listener is authoritative.
- Official Nest documentation was checked through Context7 (`/nestjs/docs.nestjs.com`, WebSocket adapters/gateways/global prefix), plus installed `backend/node_modules/@nestjs/platform-ws/adapters/ws-adapter.js` for Nest 12 behavior. P10 must register the gateway in providers and install `new WsAdapter(app)`; P5 must not edit bootstrap or central modules.
- Conversation lookup uses `SessionRepository.get(identity.userId, conversationId)`; opening either mode with `null` does not create an empty conversation. Only P6 may durably accept a live turn and subsequently bind its conversation.
- Live sessions acquire P1 `ExecutionReservationPort`; dictation does not acquire agent execution. P6 implements the shared reservation/text guard. Never supply a second local reservation implementation in production.
- Paid Deepgram, Azure/MongoDB, device, latency, and deployment checks are not authorized by this plan. Deterministic fakes certify behavior, not provider performance or hardware.

## File map

All paths below are P5-owned. Add the repository-required code-file header when **implementing** each code file; headers are intentionally absent from this Markdown plan's snippets.

| Exact path | Responsibility |
| --- | --- |
| `backend/src/voice/session/voice-session.options.ts` | Narrow dependency/callback types for P6/P9/P10, flow and transport lifecycle |
| `backend/src/voice/session/voice-session.service.ts` | Creation/idempotency, ticket claim, identity/binding, reservation, epoch, expiry and disposal |
| `backend/src/voice/session/voice-session.controller.ts` | Strict DTO/body/query/Origin admission and safe HTTP cookie/status handling |
| `backend/src/voice/session/dictation-flow.ts` | Nova event forwarding, Stop drain, Cancel fencing, timeout-tail outcome |
| `backend/src/voice/session/live-flow.ts` | Flux input/output, response fencing, playback validation and P6 callbacks |
| `backend/src/voice/transport/voice-connection.ts` | Ordered JSON/binary transport, queue bounds, handshake and output framing |
| `backend/src/voice/transport/voice.gateway.ts` | Nest raw socket ownership and disconnect/error cleanup |
| `backend/test/voice/session/fixtures.ts` | Typed fake dependency ports and controlled async speech-event queues |
| `backend/test/voice/session/controller.spec.ts` | REST/DTO/admission/ticket checks |
| `backend/test/voice/session/dictation.spec.ts` | Stop/Cancel/finalization checks |
| `backend/test/voice/session/live.spec.ts` | Final-only input, audio ordering, mute/interruption/progress checks |
| `backend/test/voice/transport/fixtures.ts` | Fake socket and microtask-settle helper |
| `backend/test/voice/transport/gateway.spec.ts` | Deterministic connection/frame/epoch tests |
| `backend/test/voice/transport/gateway.integration.spec.ts` | Actual Nest + WsAdapter + local ws handshake/cleanup, with fake speech |

Do not modify providers, P1 shared schemas/manifests, P2 repositories/context, P4 browser client, P6 runtime/HTTP, P9 usage, or P10 composition. No `VoiceModule` with a second persistence/runtime owner.

## Shared implementation vocabulary (introduced by Task 1)

The following is complete source for `backend/src/voice/session/voice-session.options.ts`. Local flow callbacks are P5's subsystem boundary, not a replacement for P1 speech/reservation contracts.

```typescript
import type { IdentityResolver, ResolvedIdentity } from '../../contracts/identity.js';
import type { SessionRepository } from '../../contracts/repositories.js';
import type { ExecutionReservation, ExecutionReservationPort, SpeechUsage,
  TtsEvent, SpeechToTextPort, SpeechSynthesisPort } from '../../contracts/voice.js';
import type { CreateVoiceSessionResponse, VoiceClientEvent,
  VoiceServerPayload, VoiceErrorCode, VoiceRecovery } from '../../contracts/voice-wire.js';
import type { VoiceConfig } from '../../platform/config/voice-config.js';

export const VOICE_SESSION_OPTIONS = Symbol('VOICE_SESSION_OPTIONS');
export type VoiceFlow = {
  start(): void;
  input(pcm: Uint8Array): Promise<void>;
  control(event: VoiceClientEvent): Promise<void>;
  close(): Promise<void>;
};
export type VoiceSink = {
  outputSamples(): number;
  event(payload: VoiceServerPayload): void;
  audio(ref: { turnId: string; responseId: string }, pcm: Uint8Array): void;
  invalidate(ref: { turnId: string; responseId: string }): void;
  finish(reason: 'completed' | 'cancelled' | 'error'): void;
};
export type SessionContext = {
  identity: ResolvedIdentity;
  response: CreateVoiceSessionResponse;
  reservation: ExecutionReservation | null;
};
export type LiveHooks = {
  finalized(context: SessionContext, input: { providerSocketEpoch: number;
    providerTurnId: string; text: string }, signal: AbortSignal): Promise<void>;
  interrupt(context: SessionContext, ref: { turnId: string; responseId: string }): Promise<void>;
  delivery(context: SessionContext, event: Exclude<TtsEvent, { type: 'audio' } | { type: 'error' }>): Promise<void>;
  playback(context: SessionContext, ref: { turnId: string; responseId: string }, playedSamples: number): Promise<void>;
  disconnected(context: SessionContext): Promise<void>;
};
export type VoiceSessionOptions = {
  config: VoiceConfig;
  identity: IdentityResolver;
  sessions: Pick<SessionRepository, 'get'>;
  reservations: ExecutionReservationPort;
  frontendOrigin: string;
  secureCookie: boolean;
  admission(context: SessionContext): Promise<{ release(): Promise<void> }>;
  usage(context: SessionContext, usage: SpeechUsage): Promise<void>;
  disconnected(context: SessionContext): Promise<void>;
  open(context: SessionContext, sink: VoiceSink, signal: AbortSignal): Promise<VoiceFlow>;
};
export type CreateResult = { response: CreateVoiceSessionResponse; cookie: string };
export type FlowDependencies = {
  stt: SpeechToTextPort; tts: SpeechSynthesisPort; hooks: LiveHooks;
  usage(context: SessionContext, usage: SpeechUsage): Promise<void>;
};
export class VoiceSessionError extends Error {
  constructor(readonly code: VoiceErrorCode, readonly recovery: VoiceRecovery = 'return_to_chat') {
    super(code);
  }
}
export function fault(code: VoiceErrorCode): never { throw new VoiceSessionError(code); }
export function assertOrigin(options: Pick<VoiceSessionOptions, 'frontendOrigin'>,
  origin: string | undefined, required = true): void {
  if ((!origin && required) || (origin && origin !== options.frontendOrigin)) fault('INVALID_ORIGIN');
}
```

`open` is required, not a default no-op. Tasks 1–2 inject a deterministic fake flow; Tasks 3–4 provide real P3-backed flows. `admission` is P9 policy; session-level `disconnected` is P9's reconnect/lifecycle notification after the flow closes. `LiveHooks.disconnected` is the single P6 durable-reconciliation callback inside live-flow cleanup. P10 must not wire both callbacks to the same P6 cleanup operation or enable live voice without the required P6/P9 dependencies.

### Task 1: Voice Session REST Controller & DTO Validation

**Files:** Create the options, service, controller and `backend/test/voice/session/fixtures.ts`, `backend/test/voice/session/controller.spec.ts`.

#### 1A — Strict requests, safe config, Origin and identity binding

- [ ] **Write this failing fixture/test.** `backend/test/voice/session/fixtures.ts` initially contains:

```typescript
import { vi } from 'vitest';
import { loadVoiceConfig } from '../../../src/platform/config/voice-config.js';
import { ServerIdentityResolver } from '../../../src/platform/identity/server-identity-resolver.js';
import type { VoiceSessionOptions } from '../../../src/voice/session/voice-session.options.js';
export const origin = 'http://127.0.0.1:5173';
export const request = { protocolVersion: 1 as const, mode: 'dictation' as const,
  conversationId: null, locale: 'en-US' as const, idempotencyKey: 'request-0001' };
export function options(): VoiceSessionOptions {
  return {
    config: loadVoiceConfig({ ENABLE_DICTATION_MODE: 'true', ENABLE_LIVE_VOICE_MODE: 'true',
      DEEPGRAM_API_KEY: 'fixture-secret' }),
    frontendOrigin: origin, secureCookie: false,
    identity: new ServerIdentityResolver({ identity: { userId: 'server-user' } }),
    sessions: { get: vi.fn(async () => null) },
    reservations: {
      acquire: vi.fn(async c => ({ reservationId: 'reservation-1', userId: c.identity.userId,
        conversationId: c.conversationId, owner: c.owner })),
      bindConversation: vi.fn(async c => ({ reservationId: c.reservationId,
        userId: c.identity.userId, conversationId: c.conversationId,
        owner: { kind: 'live' as const, voiceSessionId: 'voice-1' } })),
      release: vi.fn(async () => undefined),
    },
    admission: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
    usage: vi.fn(async () => undefined), disconnected: vi.fn(async () => undefined),
    open: vi.fn(async () => ({ start: vi.fn(), input: vi.fn(async () => undefined),
      control: vi.fn(async () => undefined), close: vi.fn(async () => undefined) })),
  };
}
```

`backend/test/voice/session/controller.spec.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { options, origin, request } from './fixtures.js';
const services: VoiceSessionService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.drain())); vi.useRealTimers(); });
function fixture() { const o = options(); const s = new VoiceSessionService(o); services.push(s); return { o, s }; }
describe('voice REST admission', () => {
  it('projects config without provider settings', () => {
    const { s } = fixture();
    expect(s.config()).toMatchObject({ protocolVersion: 1, supportedLocales: ['en-US'] });
    expect(JSON.stringify(s.config())).not.toContain('fixture-secret');
  });
  it.each([{ ...request, userId: 'attacker' }, { ...request, model: 'other' },
    { ...request, protocolVersion: 2 }, { ...request, locale: 'hi-IN' },
    { ...request, conversationId: '' }])('rejects malformed DTO before allocation: %j', async body => {
    const { s, o } = fixture();
    await expect(s.create(body, origin)).rejects.toMatchObject({ code: 'INVALID_VOICE_REQUEST' });
    expect(o.admission).not.toHaveBeenCalled(); expect(o.open).not.toHaveBeenCalled();
  });
  it('rejects missing/wrong Origin and disabled mode before admission', async () => {
    const { s, o } = fixture();
    await expect(s.create(request, undefined)).rejects.toMatchObject({ code: 'INVALID_ORIGIN' });
    await expect(s.create(request, 'https://evil.example')).rejects.toMatchObject({ code: 'INVALID_ORIGIN' });
    o.config.enabledModes.dictation = false;
    await expect(s.create(request, origin)).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
    expect(o.admission).not.toHaveBeenCalled();
  });
  it('checks the resolved identity; New Chat stays unsaved', async () => {
    const { s, o } = fixture();
    await expect(s.create({ ...request, conversationId: 'foreign' }, origin))
      .rejects.toMatchObject({ code: 'VOICE_BINDING_MISMATCH' });
    expect(o.sessions.get).toHaveBeenCalledWith('server-user', 'foreign');
    const created = await s.create(request, origin);
    expect(created.response.conversationId).toBeNull();
    expect(o.reservations.acquire).not.toHaveBeenCalled(); expect(o.open).not.toHaveBeenCalled();
  });
});
```

- [ ] **Run RED** (working directory `backend`): `npm test -- test/voice/session/controller.spec.ts`. Expected: missing P5 service import; after adding source, every malformed request must fail before admission/providers.
- [ ] **Implement the service admission core below.** Do not call `assertNoClientOverrides` here, which would expose unrelated chat error codes; P1's exact guard rejects all extra fields as `INVALID_VOICE_REQUEST`. Identity is always resolved server-side.

`backend/src/voice/session/voice-session.service.ts`:

```typescript
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { isCreateVoiceSessionRequest, INPUT_AUDIO, OUTPUT_AUDIO,
  type CreateVoiceSessionRequest } from '../../contracts/voice-wire.js';
import { publicVoiceConfig } from '../../platform/config/voice-config.js';
import { VOICE_SESSION_OPTIONS, assertOrigin, fault, type CreateResult,
  type SessionContext, type VoiceSessionOptions } from './voice-session.options.js';

export type VoiceBinding = SessionContext & {
  request: CreateVoiceSessionRequest;
  state: 'created' | 'active' | 'reconnecting' | 'ended';
  token: string | null; tokenHash: string | null; deadline: number;
  admission: { release(): Promise<void> };
  timer?: ReturnType<typeof setTimeout>;
  cleanup?: () => Promise<void>;
  stopping?: Promise<void>;
  creating?: Promise<void>;
};
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
@Injectable()
export class VoiceSessionService {
  private readonly entries = new Map<string, VoiceBinding>();
  private readonly pending = new Map<string, Promise<CreateResult>>();
  private accepting = true;
  constructor(@Inject(VOICE_SESSION_OPTIONS) readonly options: VoiceSessionOptions) {}
  config() { return publicVoiceConfig(this.options.config); }
  private key(identity: string, key: string) { return JSON.stringify([identity, key]); }
  private response(entry: VoiceBinding): CreateResult {
    // Duplicate active POST is idempotent, but cannot mint another socket ticket.
    if (!entry.token) return { response: { ...entry.response }, cookie: '' };
    const maxAge = Math.max(1, Math.ceil((entry.deadline - Date.now()) / 1000));
    return { response: { ...entry.response }, cookie: `aurvin_voice_ticket=${entry.token}; HttpOnly; SameSite=Strict; Path=/api/voice; Max-Age=${maxAge}${this.options.secureCookie ? '; Secure' : ''}` };
  }
  private issue(entry: VoiceBinding) {
    entry.token = randomBytes(32).toString('base64url'); entry.tokenHash = digest(entry.token);
    entry.deadline = Math.min(entry.state === 'reconnecting' ? entry.deadline : Infinity,
      Date.now() + Math.min(30000, this.options.config.limits.connectMs));
    entry.response.expiresAt = new Date(entry.deadline).toISOString();
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { void this.end(entry.response.sessionId).catch(() => undefined); },
      Math.max(0, entry.deadline - Date.now()));
  }
  async create(body: unknown, origin: string | undefined): Promise<CreateResult> {
    assertOrigin(this.options, origin);
    if (!isCreateVoiceSessionRequest(body)) fault('INVALID_VOICE_REQUEST');
    if (!this.accepting || !this.options.config.enabledModes[body.mode]) fault('VOICE_DISABLED');
    const identity = this.options.identity.resolve();
    const key = this.key(identity.userId, body.idempotencyKey);
    const inFlight = this.pending.get(key);
    if (inFlight) {
      const result = await inFlight;
      const entry = this.entries.get(result.response.sessionId);
      if (!entry || !this.matches(entry, body)) fault('VOICE_BINDING_MISMATCH');
      return this.response(entry);
    }
    const operation = this.createOnce(body, identity);
    this.pending.set(key, operation);
    try { return await operation; } finally { if (this.pending.get(key) === operation) this.pending.delete(key); }
  }
  private matches(e: VoiceBinding, r: CreateVoiceSessionRequest) {
    return e.request.mode === r.mode && e.request.locale === r.locale &&
      (e.request.conversationId === r.conversationId || e.response.conversationId === r.conversationId);
  }
  private async createOnce(body: CreateVoiceSessionRequest, identity: SessionContext['identity']): Promise<CreateResult> {
    const old = [...this.entries.values()].find(e => e.identity.userId === identity.userId &&
      e.request.idempotencyKey === body.idempotencyKey);
    if (old) {
      if (!this.matches(old, body)) fault('VOICE_BINDING_MISMATCH');
      if (old.state === 'ended') fault('VOICE_SESSION_ENDED');
      if (old.state === 'active') return this.response(old);
      if (old.deadline <= Date.now()) { await this.end(old.response.sessionId); fault('VOICE_CONNECT_TIMEOUT'); }
      if (old.state === 'reconnecting') {
        await old.stopping;
        if (this.entries.get(old.response.sessionId)?.state === 'ended' || old.deadline <= Date.now()) fault('VOICE_RECONNECT_TIMEOUT');
        // A repeated HTTP request reuses the already-issued ticket/epoch until it is consumed.
        if (!old.token) { if (old.response.connectionEpoch === 0xffffffff) fault('VOICE_SEQUENCE_ERROR');
          old.response.connectionEpoch++; this.issue(old); }
      }
      return this.response(old);
    }
    if (body.conversationId !== null && !await this.options.sessions.get(identity.userId, body.conversationId))
      fault('VOICE_BINDING_MISMATCH');
    const response: SessionContext['response'] = { protocolVersion: 1, sessionId: randomUUID(),
      conversationId: body.conversationId, mode: body.mode, connectionEpoch: 0,
      websocketUrl: '/api/voice', expiresAt: new Date().toISOString(),
      effectiveAudioSettings: { input: INPUT_AUDIO, output: body.mode === 'live' ? OUTPUT_AUDIO : null },
      limits: { ...this.options.config.limits } };
    const context: SessionContext = { identity, response, reservation: null };
    const admission = await this.options.admission(context);
    try {
      // Recheck after the asynchronous policy: reserve registry capacity synchronously.
      if (!this.accepting || !this.options.config.enabledModes[body.mode]) fault('VOICE_DISABLED');
      const active = [...this.entries.values()].filter(e => e.state !== 'ended');
      if (active.length >= this.options.config.quotas.globalConcurrent ||
        active.filter(e => e.identity.userId === identity.userId).length >= this.options.config.quotas.identityConcurrent)
        fault('VOICE_QUOTA_EXHAUSTED');
      // ponytail: at most 1024 ten-second tombstones; reject rather than evict live idempotency evidence.
      if (this.entries.size >= 1024) fault('VOICE_QUOTA_EXHAUSTED');
      const entry: VoiceBinding = { ...context, request: { ...body }, state: 'created',
        token: null, tokenHash: null, deadline: 0, admission };
      this.entries.set(response.sessionId, entry);
      try {
        if (body.mode === 'live') entry.reservation = await this.options.reservations.acquire({
          identity, conversationId: body.conversationId, owner: { kind: 'live', voiceSessionId: response.sessionId } });
        if (!this.accepting || entry.state === 'ended') fault('VOICE_DISABLED');
        this.issue(entry); return this.response(entry);
      } catch (error) {
        this.entries.delete(response.sessionId);
        if (entry.reservation) await this.options.reservations.release({ identity, reservationId: entry.reservation.reservationId });
        throw error;
      }
    } catch (error) { await admission.release(); throw error; }
  }
  claim(cookie: string | undefined, origin: string | undefined): VoiceBinding {
    assertOrigin(this.options, origin);
    if (!this.accepting) fault('VOICE_DISABLED');
    const parts = (cookie ?? '').split(';').map(p => p.trim()).filter(p => p.startsWith('aurvin_voice_ticket='));
    if (parts.length !== 1) fault('VOICE_BINDING_MISMATCH');
    const token = parts[0].slice('aurvin_voice_ticket='.length);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fault('VOICE_BINDING_MISMATCH');
    const hash = digest(token), identity = this.options.identity.resolve();
    const entry = [...this.entries.values()].find(e => e.tokenHash === hash);
    if (!entry || entry.identity.userId !== identity.userId) fault('VOICE_BINDING_MISMATCH');
    if (entry.state === 'ended') fault('VOICE_SESSION_ENDED');
    if (!this.options.config.enabledModes[entry.response.mode]) fault('VOICE_DISABLED');
    if (entry.deadline <= Date.now()) fault('VOICE_CONNECT_TIMEOUT');
    if (!['created', 'reconnecting'].includes(entry.state)) fault('VOICE_INVALID_STATE');
    // Consume synchronously before any provider/socket work; a second claim cannot race this one.
    entry.token = null; entry.tokenHash = null; clearTimeout(entry.timer); entry.state = 'active';
    return entry;
  }
  async end(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.identity.userId !== this.options.identity.resolve().userId) fault('VOICE_BINDING_MISMATCH');
    if (entry.state === 'ended') { await entry.stopping; return; }
    entry.state = 'ended'; entry.token = null; entry.tokenHash = null; clearTimeout(entry.timer);
    entry.stopping = (async () => {
      try { await entry.cleanup?.(); }
      finally {
        try { if (entry.reservation) await this.options.reservations.release({
          identity: entry.identity, reservationId: entry.reservation.reservationId }); }
        finally { await entry.admission.release(); }
      }
    })();
    try { await entry.stopping; } finally {
      entry.timer = setTimeout(() => this.entries.delete(id), 10000);
      entry.timer.unref?.();
    }
  }
  async disconnected(entry: VoiceBinding, recover: boolean): Promise<void> {
    if (entry.state === 'ended') return;
    if (!recover || entry.response.mode === 'dictation' || !this.accepting) { await this.end(entry.response.sessionId); return; }
    if (entry.state === 'reconnecting') { await entry.stopping; return; }
    entry.state = 'reconnecting'; entry.token = null; entry.tokenHash = null;
    entry.deadline = Date.now() + this.options.config.limits.reconnectMs;
    entry.stopping = (async () => { await entry.cleanup?.(); await this.options.disconnected(entry); })();
    entry.timer = setTimeout(() => { void this.end(entry.response.sessionId).catch(() => undefined); },
      this.options.config.limits.reconnectMs);
    try { await entry.stopping; } catch (error) { await this.end(entry.response.sessionId); throw error; }
  }
  async bindConversation(id: string, conversationId: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || entry.state !== 'active' || entry.response.mode !== 'live' || !entry.reservation)
      fault('VOICE_INVALID_STATE');
    if (entry.response.conversationId !== null && entry.response.conversationId !== conversationId)
      fault('VOICE_BINDING_MISMATCH');
    entry.reservation = await this.options.reservations.bindConversation({ identity: entry.identity,
      reservationId: entry.reservation.reservationId, conversationId });
    entry.response.conversationId = conversationId;
  }
  stopAccepting() { this.accepting = false; }
  snapshot() { return { accepting: this.accepting,
    active: [...this.entries.values()].filter(e => e.state !== 'ended').length }; }
  async drain() {
    this.stopAccepting();
    await Promise.allSettled([...this.pending.values()]);
    const results = await Promise.allSettled([...this.entries.keys()].map(id => this.end(id)));
    for (const e of this.entries.values()) clearTimeout(e.timer);
    this.entries.clear();
    if (results.some(r => r.status === 'rejected')) fault('VOICE_DELIVERY_UNKNOWN');
  }
}
```

Before committing Task 1, apply the creation cleanup barrier in 1B. It prevents DELETE/drain from releasing a still-pending reservation or releasing admission twice.

- [ ] **Implement `backend/src/voice/session/voice-session.controller.ts`:**

```typescript
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query,
  Req, Res, Catch, UseFilters, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { VoiceSessionService } from './voice-session.service.js';
import { assertOrigin, fault, VoiceSessionError } from './voice-session.options.js';
const noQuery = (q: unknown) => { if (!q || typeof q !== 'object' || Object.keys(q).length) fault('INVALID_VOICE_REQUEST'); };
@Catch()
export class VoiceHttpFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const code = error instanceof VoiceSessionError ? error.code : 'VOICE_DELIVERY_UNKNOWN';
    const status = code === 'INVALID_ORIGIN' || code === 'VOICE_BINDING_MISMATCH' ? 403
      : code === 'VOICE_DISABLED' ? 503 : code === 'VOICE_QUOTA_EXHAUSTED' ? 429
      : code === 'CONFLICT_ACTIVE_TURN' || code === 'VOICE_INVALID_STATE' ? 409
      : code === 'VOICE_SESSION_ENDED' ? 410 : code === 'INVALID_VOICE_REQUEST' ? 400 : 503;
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({ error: { code, message: 'Voice is unavailable.', retryable: status >= 500 || status === 429 } });
  }
}
@Controller('voice')
@UseFilters(VoiceHttpFilter)
export class VoiceSessionController {
  constructor(@Inject(VoiceSessionService) private readonly sessions: VoiceSessionService) {}
  @Get('config') config(@Query() q: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    noQuery(q); assertOrigin(this.sessions.options, req.headers.origin, false);
    res.setHeader('Cache-Control', 'no-store'); return this.sessions.config();
  }
  @Post('sessions') @HttpCode(201)
  async create(@Body() body: unknown, @Query() q: unknown, @Req() req: Request,
    @Res({ passthrough: true }) res: Response) {
    noQuery(q); const result = await this.sessions.create(body, req.headers.origin);
    res.setHeader('Cache-Control', 'no-store'); if (result.cookie) res.setHeader('Set-Cookie', result.cookie);
    return result.response;
  }
  @Delete('sessions/:id') @HttpCode(204)
  async end(@Param('id') id: string, @Query() q: unknown, @Req() req: Request,
    @Res({ passthrough: true }) res: Response) {
    noQuery(q); assertOrigin(this.sessions.options, req.headers.origin);
    if (!id || id.length > 128) fault('INVALID_VOICE_REQUEST');
    await this.sessions.end(id); res.setHeader('Cache-Control', 'no-store');
    // Do not clear the origin-wide cookie here: it may belong to another newly created session.
  }
}
```

P1 reservation implementations may throw a typed conflict other than `VoiceSessionError`. Normalize only the known `CONFLICT_ACTIVE_TURN` code at the reservation acquisition boundary into `fault('CONFLICT_ACTIVE_TURN')`; never serialize arbitrary thrown messages/provider payloads.

- [ ] **Run GREEN:** `npm test -- test/voice/session/controller.spec.ts` → all admission cases pass with zero provider allocations for rejected requests.

#### 1B — Ticket, idempotency, timeouts, release races

- [ ] **Append exact regression tests** inside the same file (reuse `fixture()`):

```typescript
it('single-use cookie ticket has no URL/body secret and a replay cannot allocate', async () => {
  const { s, o } = fixture(); const result = await s.create(request, origin);
  expect(result.cookie).toContain('HttpOnly; SameSite=Strict; Path=/api/voice');
  expect(result.response.websocketUrl).toBe('/api/voice');
  expect(Object.keys(result.response)).not.toContain('ticket');
  const cookie = result.cookie.split(';')[0]; const binding = s.claim(cookie, origin);
  expect(binding.identity.userId).toBe('server-user');
  expect(() => s.claim(cookie, origin)).toThrow('VOICE_BINDING_MISMATCH');
  expect(o.open).not.toHaveBeenCalled();
});
it('coalesces concurrent creation and rejects a key reused with different mode', async () => {
  const { s, o } = fixture();
  const [a, b] = await Promise.all([s.create(request, origin), s.create(request, origin)]);
  expect(a).toEqual(b); expect(o.admission).toHaveBeenCalledTimes(1);
  await expect(s.create({ ...request, mode: 'live' }, origin)).rejects.toMatchObject({ code: 'VOICE_BINDING_MISMATCH' });
});
it('expires unconnected sessions and DELETE releases each owner once', async () => {
  vi.useFakeTimers(); const { s, o } = fixture();
  const created = await s.create({ ...request, mode: 'live' }, origin);
  await vi.advanceTimersByTimeAsync(o.config.limits.connectMs);
  await s.end(created.response.sessionId); await s.end(created.response.sessionId);
  expect(o.reservations.release).toHaveBeenCalledTimes(1); expect(s.snapshot().active).toBe(0);
});
it('drain waits for admission and reservation creation without double release', async () => {
  const { s, o } = fixture();
  let resolve!: (value: Awaited<ReturnType<typeof o.reservations.acquire>>) => void;
  const held = new Promise<Awaited<ReturnType<typeof o.reservations.acquire>>>(r => { resolve = r; });
  const release = vi.fn(async () => undefined);
  o.admission = vi.fn(async () => ({ release }));
  o.reservations.acquire = vi.fn(() => held);
  const creation = s.create({ ...request, mode: 'live' }, origin);
  const rejected = expect(creation).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
  await Promise.resolve(); await Promise.resolve();
  const draining = s.drain();
  resolve({ reservationId: 'r1', userId: 'server-user', conversationId: null,
    owner: { kind: 'live', voiceSessionId: 'v1' } });
  await rejected; await draining;
  expect(o.reservations.release).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1);
});
```

- [ ] **Run RED:** `npm test -- test/voice/session/controller.spec.ts -t "drain waits"`. Expected failure if creation cleanup and end cleanup can both release. This test must pass after the refinement; do not commit an intermediate race.
- [ ] **Apply this creation barrier:** an entry reserves registry capacity synchronously, but end/drain wait for reservation acquisition before releasing it.

```typescript
// Immediately after constructing entry, before this.entries.set:
let creationDone!: () => void;
entry.creating = new Promise<void>(resolve => { creationDone = resolve; });
// Replace the nested reservation try/catch with:
try {
  if (body.mode === 'live') entry.reservation = await this.options.reservations.acquire({
    identity, conversationId: body.conversationId,
    owner: { kind: 'live', voiceSessionId: response.sessionId } });
  if (!this.accepting) fault('VOICE_DISABLED');
  this.issue(entry); return this.response(entry);
} catch (error) {
  creationDone();
  await this.end(response.sessionId);
  if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'CONFLICT_ACTIVE_TURN')
    fault('CONFLICT_ACTIVE_TURN');
  throw error;
} finally { creationDone(); }
// Replace the outer `catch { await admission.release(); ... }` with:
// This exact branch is outside the nested entry block, so use registry lookup.
// Add `let registered = false` immediately after admission is obtained;
// set `registered = true` immediately after entries.set.
// The enclosing catch becomes:
catch (error) { if (!registered) await admission.release(); throw error; }
// In end(), after ownership validation and BEFORE checking/changing state:
await entry.creating;
```

`drain()` already awaits `pending` creations after `stopAccepting()`, so it does not deadlock with the barrier. `claim()` cannot find an issued ticket until creation finishes. Normalize reservation conflict as shown without losing cleanup.

- [ ] **Verify:** `npm test -- test/voice/session/controller.spec.ts` and `npm run build`. Expected: all tests discovered/pass; compilation succeeds.
- [ ] **Commit:** `git add backend/src/voice/session/voice-session.options.ts backend/src/voice/session/voice-session.service.ts backend/src/voice/session/voice-session.controller.ts backend/test/voice/session/fixtures.ts backend/test/voice/session/controller.spec.ts` then `git commit -m "feat(voice): validate identity-bound REST sessions and tickets"`.

### Task 2: Native NestJS WebSocket Voice Gateway

**Files:** Create `backend/src/voice/transport/voice-connection.ts`, `backend/src/voice/transport/voice.gateway.ts`, `backend/test/voice/transport/fixtures.ts`, `backend/test/voice/transport/gateway.spec.ts`.

#### 2A — Ordered handshake and framed input

- [ ] **Write fake socket source** in `backend/test/voice/transport/fixtures.ts`:

```typescript
import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
export class FakeSocket extends EventEmitter {
  readyState = 1; bufferedAmount = 0;
  send = vi.fn((_data: string | Uint8Array) => undefined);
  close = vi.fn((_code?: number) => { this.readyState = 3; this.emit('close'); });
  terminate = vi.fn(() => { this.readyState = 3; this.emit('close'); });
  text(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
  binary(bytes: Uint8Array) { this.emit('message', Buffer.from(bytes), true); }
  events() { return this.send.mock.calls.flatMap(([d]) => typeof d === 'string' ? [JSON.parse(d)] : []); }
}
export async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
```

`backend/test/voice/transport/gateway.spec.ts`:

```typescript
import { afterEach, expect, it, vi } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { INPUT_AUDIO } from '../../../src/contracts/voice-wire.js';
import { encodeVoiceAudio } from '../../../src/contracts/voice-audio.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { VoiceGateway } from '../../../src/voice/transport/voice.gateway.js';
import { options, origin, request } from '../session/fixtures.js';
import { FakeSocket, settle } from './fixtures.js';
const services: VoiceSessionService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.drain())); });
async function fixture(mode: 'dictation' | 'live' = 'dictation') {
  const o = options(), s = new VoiceSessionService(o); services.push(s);
  const result = await s.create({ ...request, mode }, origin);
  const socket = new FakeSocket(), gateway = new VoiceGateway(s);
  gateway.handleConnection(socket, { url: '/api/voice', headers: {
    origin, cookie: result.cookie.split(';')[0] } } as IncomingMessage);
  const event = (type: 'session.start' | 'dictation.stop', sequence = 0) => ({
    protocolVersion: 1, sessionId: result.response.sessionId,
    connectionEpoch: result.response.connectionEpoch, eventId: `event-${sequence}`, sequence,
    ...(type === 'session.start' ? { type, mode, audioSettings: INPUT_AUDIO } : { type }) });
  return { o, s, result, socket, gateway, event };
}
it('uses native JSON start, binds the ticket, emits ready before accepting PCM', async () => {
  const f = await fixture(); f.socket.text(f.event('session.start')); await settle();
  expect(f.socket.events().map(e => e.type)).toEqual(['session.ready']);
  expect(f.o.open).toHaveBeenCalledTimes(1);
  f.socket.binary(encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(2560) }));
  await settle();
  const opened = await vi.mocked(f.o.open).mock.results[0].value;
  expect(opened.input).toHaveBeenCalledWith(new Uint8Array(2560));
});
it.each(['bad-epoch', 'bad-binding', 'bad-kind', 'bad-length', 'gap', 'before-start'])
  ('rejects %s without forwarding invalid audio', async kind => {
    const f = await fixture();
    if (kind !== 'before-start') {
      const start = f.event('session.start');
      if (kind === 'bad-epoch') start.connectionEpoch++;
      if (kind === 'bad-binding') start.sessionId = 'foreign';
      f.socket.text(start); await settle();
    }
    if (!['bad-epoch', 'bad-binding'].includes(kind)) {
      const bytes = encodeVoiceAudio({ kind: kind === 'bad-kind' ? 2 : 1, flags: 0,
        sequence: kind === 'gap' ? 1 : 0, offsetMs: 0, pcm: new Uint8Array(2560) });
      if (kind === 'bad-length') bytes[12] = 1;
      f.socket.binary(bytes); await settle();
    }
    expect(f.socket.close).toHaveBeenCalled();
  });
```

- [ ] **Run RED:** `npm test -- test/voice/transport/gateway.spec.ts`. Expected: missing gateway/connection imports.
- [ ] **Implement `voice-connection.ts`:**

```typescript
import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { decodeVoiceAudio, encodeVoiceAudio } from '../../contracts/voice-audio.js';
import { parseVoiceControl, MAX_VOICE_CONTROL_BYTES, type VoiceServerPayload } from '../../contracts/voice-wire.js';
import { VoiceSessionError, fault, type VoiceFlow, type VoiceSink } from '../session/voice-session.options.js';
import { VoiceSessionService, type VoiceBinding } from '../session/voice-session.service.js';
export type VoiceSocket = {
  readyState: number; bufferedAmount: number;
  send(data: string | Uint8Array): unknown;
  close(code?: number): unknown; terminate(): unknown;
};
export class VoiceConnection implements VoiceSink {
  private flow?: VoiceFlow;
  private abort = new AbortController();
  private ready = false; private closed = false; private failing = false; private rx = -1; private tx = 0;
  private inputSequence = 0; private inputSamples = 0; private inputEnded = false;
  private outputSequence = 0; private outputCursor = 0;
  private pendingBytes = 0; private pendingMessages = 0;
  private chain = Promise.resolve(); private closePromise?: Promise<void>;
  private eventIds = new Set<string>();
  private active?: { turnId: string; responseId: string; last: number | null };
  private starting?: Promise<VoiceFlow>;
  private timer: ReturnType<typeof setTimeout>;
  constructor(private readonly sessions: VoiceSessionService, readonly binding: VoiceBinding,
    private readonly socket: VoiceSocket) {
    binding.cleanup = () => this.dispose();
    this.timer = setTimeout(() => this.fail('VOICE_CONNECT_TIMEOUT'), binding.response.limits.connectMs);
  }
  receive(bytes: Uint8Array, binary: boolean) {
    if (this.closed) return;
    const limit = binary ? 2576 : MAX_VOICE_CONTROL_BYTES;
    if (bytes.byteLength > limit) { this.fail(binary ? 'INVALID_AUDIO_FRAME' : 'INVALID_VOICE_CONTROL'); return; }
    const budget = this.binding.response.limits.inputQueueMs * 32 + 16 * Math.ceil(this.binding.response.limits.inputQueueMs / 80);
    if ((binary && this.pendingBytes + bytes.byteLength > budget) || this.pendingMessages >= 64) {
      this.fail('AUDIO_BUFFER_OVERFLOW'); return;
    }
    this.pendingMessages++; if (binary) this.pendingBytes += bytes.byteLength;
    // Copy only admitted bytes; no references to arbitrarily large RawData buffers.
    const data = Uint8Array.from(bytes);
    this.chain = this.chain.then(async () => {
      if (this.closed) return;
      if (!this.sessions.options.config.enabledModes[this.binding.response.mode]) fault('VOICE_DISABLED');
      if (binary) {
        if (!this.ready || this.inputEnded) fault('VOICE_INVALID_STATE');
        const frame = decodeVoiceAudio(data);
        if (frame.kind !== 1 || (frame.flags === 0 && frame.pcm.byteLength !== 2560)) fault('INVALID_AUDIO_FRAME');
        if (frame.sequence < this.inputSequence) return;
        if (frame.sequence !== this.inputSequence || frame.offsetMs !== Math.floor(this.inputSamples / 16)) fault('VOICE_SEQUENCE_ERROR');
        this.inputSequence++; this.inputSamples += frame.pcm.byteLength / 2;
        if (frame.flags === 1) this.inputEnded = true;
        // A live residual END frame is discarded, never ForceEndTurn/submitted; Flux only accepts 80ms.
        if (frame.pcm.byteLength && !(this.binding.response.mode === 'live' && frame.flags === 1 && frame.pcm.byteLength < 2560))
          await this.flow!.input(frame.pcm);
        return;
      }
      let json: string;
      try { json = new TextDecoder('utf-8', { fatal: true }).decode(data); }
      catch { fault('INVALID_VOICE_CONTROL'); }
      const e = parseVoiceControl(json!, 'client', this.binding.response.mode);
      if (e.sessionId !== this.binding.response.sessionId) fault('VOICE_BINDING_MISMATCH');
      if (e.connectionEpoch !== this.binding.response.connectionEpoch) fault('STALE_CONNECTION_EPOCH');
      if (e.sequence <= this.rx) return;
      if (e.sequence !== this.rx + 1 || this.eventIds.has(e.eventId)) fault('VOICE_SEQUENCE_ERROR');
      // ponytail: 4096 controls per epoch; fail closed, then reconnect with a fresh epoch.
      if (this.eventIds.size >= 4096) fault('VOICE_SEQUENCE_ERROR');
      this.eventIds.add(e.eventId); this.rx = e.sequence;
      if (!this.ready) {
        if (e.type !== 'session.start') fault('VOICE_INVALID_STATE');
        this.starting = this.sessions.options.open(this.binding, this, this.abort.signal);
        const flow = await this.starting;
        if (this.closed) return;
        this.flow = flow; this.ready = true; clearTimeout(this.timer);
        this.event({ type: 'session.ready', limits: this.binding.response.limits,
          effectiveAudioSettings: this.binding.response.effectiveAudioSettings });
        flow.start();
        return;
      }
      if (e.type === 'session.start') fault('VOICE_INVALID_STATE');
      if (e.type === 'session.end') { this.finish('completed'); return; }
      if (e.type === 'dictation.stop' || e.type === 'dictation.cancel') this.inputEnded = true;
      // Stop starts finalization but must not block a later Cancel; flow owns its bounded drain.
      await this.flow!.control(e);
    }).catch(error => this.fail(error instanceof Error ? error.message : 'VOICE_DELIVERY_UNKNOWN'))
      .finally(() => { this.pendingMessages--; if (binary) this.pendingBytes -= data.byteLength; });
  }
  event(payload: VoiceServerPayload) {
    if (this.closed) return;
    if (payload.type === 'audio.start') {
      if (this.active) fault('VOICE_INVALID_STATE');
      // Start each response on an exact millisecond header origin; monotonic, never rebase on interrupt.
      this.outputCursor = Math.ceil(this.outputCursor / 24) * 24;
      this.active = { turnId: payload.turnId, responseId: payload.responseId, last: null };
      payload = { ...payload, firstAudioSequence: this.outputSequence };
    }
    if (payload.type === 'audio.end') {
      if (!this.active || this.active.responseId !== payload.responseId || this.active.turnId !== payload.turnId)
        fault('VOICE_BINDING_MISMATCH');
      payload = { ...payload, lastAudioSequence: this.active.last }; this.active = undefined;
    }
    if (this.tx > 0xffffffff) fault('VOICE_SEQUENCE_ERROR');
    const value = { protocolVersion: 1, sessionId: this.binding.response.sessionId,
      connectionEpoch: this.binding.response.connectionEpoch, eventId: randomUUID(), sequence: this.tx++, ...payload };
    const json = JSON.stringify(value);
    parseVoiceControl(json, 'server', this.binding.response.mode);
    this.send(json);
  }
  audio(ref: { turnId: string; responseId: string }, pcm: Uint8Array) {
    if (this.closed || !this.active || this.active.turnId !== ref.turnId || this.active.responseId !== ref.responseId) return;
    if (!pcm.byteLength || pcm.byteLength % 2) fault('INVALID_AUDIO_FRAME');
    for (let offset = 0; offset < pcm.byteLength; offset += 9600) {
      const part = pcm.subarray(offset, offset + 9600), sequence = this.outputSequence++;
      this.send(encodeVoiceAudio({ kind: 2, flags: 0, sequence,
        offsetMs: Math.floor(this.outputCursor / 24), pcm: part }));
      this.outputCursor += part.byteLength / 2; this.active.last = sequence;
    }
  }
  outputSamples() { return Math.ceil(this.outputCursor / 24) * 24; }
  invalidate(ref: { turnId: string; responseId: string }) {
    if (!this.active || this.active.turnId !== ref.turnId || this.active.responseId !== ref.responseId) return;
    const last = this.active.last; this.active = undefined;
    this.event({ type: 'response.cancelled', ...ref, lastAudioSequence: last });
  }
  private send(data: string | Uint8Array) {
    try {
      if (this.socket.readyState !== 1) fault('VOICE_INVALID_STATE');
      const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
      const budget = typeof data === 'string' ? MAX_VOICE_CONTROL_BYTES
        : this.binding.response.limits.outputQueueMs * 48 + 16 * Math.ceil(this.binding.response.limits.outputQueueMs / 200);
      if (this.socket.bufferedAmount + bytes > budget) fault('AUDIO_BUFFER_OVERFLOW');
      this.socket.send(data);
    } catch (error) { this.fail(error instanceof Error ? error.message : 'VOICE_DELIVERY_UNKNOWN'); throw error; }
  }
  finish(reason: 'completed' | 'cancelled' | 'error') {
    if (this.closed) return;
    this.event({ type: 'session.ended', reason });
    void this.sessions.end(this.binding.response.sessionId).catch(() => undefined);
  }
  fail(code: string) {
    if (this.closed || this.failing) return;
    this.failing = true;
    const allowed = ['VOICE_DISABLED', 'INVALID_AUDIO_FRAME', 'INVALID_VOICE_CONTROL',
      'VOICE_BINDING_MISMATCH', 'STALE_CONNECTION_EPOCH', 'VOICE_SEQUENCE_ERROR',
      'VOICE_INVALID_STATE', 'AUDIO_BUFFER_OVERFLOW', 'VOICE_CONNECT_TIMEOUT'];
    const safe = allowed.includes(code) ? code : 'VOICE_DELIVERY_UNKNOWN';
    try { this.event({ type: 'session.error', code: safe as VoiceSessionError['code'],
      recovery: 'return_to_chat', recoverable: false }); } catch { /* No payload logging. */ }
    void this.sessions.disconnected(this.binding, false).catch(() => undefined);
  }
  async lost() { await this.sessions.disconnected(this.binding, true); }
  dispose(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true; this.abort.abort(); clearTimeout(this.timer);
    this.closePromise = (async () => {
      try { const flow = this.flow ?? await this.starting?.catch(() => undefined); await flow?.close(); }
      finally { this.socket.close(1000); }
    })();
    return this.closePromise;
  }
}
```

Task 4 also bounds sent-but-unplayed PCM independently of socket buffered bytes. No second output array/queue is added.

`backend/src/voice/transport/voice.gateway.ts`:

```typescript
import { Inject } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { RawData } from 'ws';
import { VoiceSessionService } from '../session/voice-session.service.js';
import { VoiceConnection, type VoiceSocket } from './voice-connection.js';
type GatewaySocket = VoiceSocket & {
  on(event: 'message', listener: (data: RawData, binary: boolean) => void): unknown;
  on(event: 'close' | 'error', listener: () => void): unknown;
  off(event: 'message', listener: (data: RawData, binary: boolean) => void): unknown;
  off(event: 'close' | 'error', listener: () => void): unknown;
};
@WebSocketGateway({ path: '/api/voice', maxPayload: 131072, perMessageDeflate: false })
export class VoiceGateway {
  constructor(@Inject(VoiceSessionService) private readonly sessions: VoiceSessionService) {}
  handleConnection(socket: GatewaySocket, request: IncomingMessage) {
    let connection: VoiceConnection;
    try {
      if (request.url !== '/api/voice') throw new Error('INVALID_VOICE_REQUEST');
      const binding = this.sessions.claim(request.headers.cookie, request.headers.origin);
      connection = new VoiceConnection(this.sessions, binding, socket);
    } catch { socket.close(1008); return; }
    const message = (data: RawData, binary: boolean) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data)
        : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      connection.receive(bytes, binary);
    };
    const closed = () => {
      socket.off('message', message); socket.off('close', closed); socket.off('error', errored);
      void connection.lost().catch(() => undefined);
    };
    const errored = () => { connection.fail('VOICE_INVALID_STATE'); };
    socket.on('message', message); socket.on('close', closed); socket.on('error', errored);
  }
}
```

These overloads accept both `ws.WebSocket` and `FakeSocket` without unsafe casts. The service checks Origin before consuming a ticket and before opening speech connections; unauthorized upgrades are closed with policy code 1008, not described as authenticated connections.

- [ ] **Run GREEN:** `npm test -- test/voice/transport/gateway.spec.ts`; verify no wrong binding, epoch or malformed frame reaches the fake flow.

#### 2B — Reconnect and cleanup fencing

- [ ] **Append these failing tests** to `gateway.spec.ts`:

```typescript
it('disposes once and reconnects live with a fresh epoch, never the old cookie', async () => {
  const f = await fixture('live'); f.socket.text(f.event('session.start')); await settle();
  const flow = await vi.mocked(f.o.open).mock.results[0].value;
  f.socket.emit('close'); await settle();
  expect(flow.close).toHaveBeenCalledTimes(1);
  const next = await f.s.create({ ...request, mode: 'live' }, origin);
  expect(next.response.sessionId).toBe(f.result.response.sessionId);
  expect(next.response.connectionEpoch).toBe(1);
  expect(() => f.s.claim(f.result.cookie.split(';')[0], origin)).toThrow('VOICE_BINDING_MISMATCH');
  expect(f.o.disconnected).toHaveBeenCalledTimes(1);
  expect(f.o.reservations.acquire).toHaveBeenCalledTimes(1);
});
it('rejects bad Origin and cookie replay before opening a provider', async () => {
  const f = await fixture(); const replay = new FakeSocket();
  f.gateway.handleConnection(replay, { url: '/api/voice', headers: {
    origin: 'https://evil.example', cookie: f.result.cookie.split(';')[0] } } as IncomingMessage);
  expect(replay.close).toHaveBeenCalledWith(1008);
  const twice = new FakeSocket();
  f.gateway.handleConnection(twice, { url: '/api/voice', headers: {
    origin, cookie: f.result.cookie.split(';')[0] } } as IncomingMessage);
  expect(twice.close).toHaveBeenCalledWith(1008); expect(f.o.open).not.toHaveBeenCalled();
});
```

- [ ] **Run RED:** `npm test -- test/voice/transport/gateway.spec.ts -t "disposes once"`. If already green, keep this regression and continue; do not weaken it to manufacture a failure.
- [ ] **Refine lifetime code to avoid await/reentrancy loops:** before `dispose` calls `socket.close`, the entry is already `ended` or `reconnecting`; `disconnected` must return immediately for `reconnecting`, not await `entry.stopping` from a close callback invoked by that same cleanup. The exact one-line replacement is:

```typescript
if (entry.state === 'reconnecting') return;
```

Keep the original deadline across reconnect HTTP retries; an HTTP retry is not a new ten-second budget. On every reattachment, create a **new** `VoiceConnection` and AbortController, reset transport sequences, close old STT/TTS before opening new ones, and keep the live reservation until terminal cleanup. Dictation loss ends immediately; it is never reauthorized/resumed silently.

- [ ] **Verify:** `npm test -- test/voice/session/controller.spec.ts test/voice/transport/gateway.spec.ts`, `npm run build`, `npm run lint`.
- [ ] **Commit** (repository root):

```powershell
git add backend/src/voice/transport/voice-connection.ts backend/src/voice/transport/voice.gateway.ts backend/test/voice/transport/fixtures.ts backend/test/voice/transport/gateway.spec.ts backend/src/voice/session/voice-session.service.ts
git commit -m "feat(voice): add validated native WebSocket gateway"
```

### Task 3: Voice Session Service & Dictation Flow

**Files:** Create `backend/src/voice/session/dictation-flow.ts`, `backend/test/voice/session/dictation.spec.ts`; extend only `backend/test/voice/session/fixtures.ts`.

#### 3A — Provider fake, partial/final routing and no agent execution

- [ ] **Append these typed deterministic speech fixtures:**

```typescript
import type { SpeechInputConnection, SpeechOutputConnection, SttEvent, TtsEvent } from '../../../src/contracts/voice.js';
export class EventQueue<T> implements AsyncIterable<T> {
  private values: T[] = []; private done = false;
  private waiter?: (value: IteratorResult<T>) => void;
  push(value: T) { if (this.done) return; if (this.waiter) { const w = this.waiter; this.waiter = undefined; w({ value, done: false }); } else this.values.push(value); }
  end() { this.done = true; this.waiter?.({ value: undefined, done: true }); this.waiter = undefined; }
  [Symbol.asyncIterator](): AsyncIterator<T> { return { next: () => {
    if (this.values.length) return Promise.resolve({ value: this.values.shift()!, done: false });
    if (this.done) return Promise.resolve({ value: undefined, done: true });
    return new Promise(resolve => { this.waiter = resolve; });
  } }; }
}
export function fakeStt() {
  const events = new EventQueue<SttEvent>();
  const connection: SpeechInputConnection = { events, writeAudio: vi.fn(async () => undefined),
    finalize: vi.fn(async () => undefined), close: vi.fn(async () => { events.end(); }) };
  return { events, connection, port: { connect: vi.fn(async () => connection) } };
}
export function fakeTts() {
  const events = new EventQueue<TtsEvent>();
  const connection: SpeechOutputConnection = { events, providerSocketId: 'provider-socket-1',
    speak: vi.fn(async () => undefined), flush: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined), close: vi.fn(async () => { events.end(); }) };
  return { events, connection, port: { connect: vi.fn(async () => connection) } };
}
```

The fake queue is controlled and only used by one consumer per fixture; it is **not** a production unbounded queue. P3 already owns production bounded queues.

`backend/test/voice/session/dictation.spec.ts`:

```typescript
import { afterEach, expect, it, vi } from 'vitest';
import { DictationFlow } from '../../../src/voice/session/dictation-flow.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import type { VoiceSink } from '../../../src/voice/session/voice-session.options.js';
import type { VoiceClientEvent } from '../../../src/contracts/voice-wire.js';
import { options, origin, request, fakeStt } from './fixtures.js';
import { settle } from '../transport/fixtures.js';
const services: VoiceSessionService[] = [], flows: DictationFlow[] = [];
afterEach(async () => { await Promise.all(flows.splice(0).map(f => f.close()));
  await Promise.all(services.splice(0).map(s => s.drain())); vi.useRealTimers(); });
async function fixture() {
  const o = options(), s = new VoiceSessionService(o); services.push(s);
  const created = await s.create(request, origin), context = s.claim(created.cookie.split(';')[0], origin);
  const stt = fakeStt(), sink: VoiceSink = { outputSamples: () => 0, event: vi.fn(), audio: vi.fn(), invalidate: vi.fn(), finish: vi.fn() };
  const flow = await DictationFlow.open(context, sink, new AbortController().signal, stt.port, o.usage);
  flow.start();
  flows.push(flow);
  const control = (type: 'dictation.stop' | 'dictation.cancel'): VoiceClientEvent => ({ protocolVersion: 1,
    sessionId: context.response.sessionId, connectionEpoch: 0, eventId: type, sequence: 1, type });
  return { o, context, stt, sink, flow, control };
}
it('revises partials, commits finals once, and a pause never submits a turn', async () => {
  const f = await fixture(); await f.flow.input(new Uint8Array(2560));
  f.stt.events.push({ type: 'partial', segmentId: 'seg1', text: 'hello' });
  f.stt.events.push({ type: 'partial', segmentId: 'seg1', text: 'hello Aurvin' });
  f.stt.events.push({ type: 'final', segmentId: 'seg1', text: 'Hello Aurvin.' });
  f.stt.events.push({ type: 'final', segmentId: 'seg1', text: 'Hello Aurvin.' });
  await settle();
  expect(vi.mocked(f.sink.event).mock.calls.map(([e]) => e.type)).toEqual([
    'dictation.partial', 'dictation.partial', 'dictation.final']);
  expect(f.stt.connection.finalize).not.toHaveBeenCalled();
  expect(f.o.reservations.acquire).not.toHaveBeenCalled(); expect(f.sink.finish).not.toHaveBeenCalled();
});
it('Stop accepts remaining finals then completes, never by finalize promise alone', async () => {
  const f = await fixture(); await f.flow.control(f.control('dictation.stop'));
  await settle(); expect(f.sink.finish).not.toHaveBeenCalled();
  f.stt.events.push({ type: 'final', segmentId: 'tail', text: 'Not Friday.' });
  f.stt.events.push({ type: 'finalized', unfinalizedTail: false }); await settle();
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false });
  expect(f.sink.finish).toHaveBeenCalledWith('completed');
});
it('Cancel during finalization closes once and fences late results', async () => {
  const f = await fixture(); await f.flow.control(f.control('dictation.stop'));
  await f.flow.control(f.control('dictation.cancel')); await f.flow.close();
  f.stt.events.push({ type: 'final', segmentId: 'late', text: 'must not insert' }); await settle();
  expect(f.stt.connection.close).toHaveBeenCalledTimes(1);
  expect(f.sink.event).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'dictation.final' }));
  expect(f.sink.finish).toHaveBeenCalledWith('cancelled');
});
it('two-second timeout preserves finals and signals an unfinalized tail', async () => {
  vi.useFakeTimers(); const f = await fixture();
  f.stt.events.push({ type: 'final', segmentId: 'one', text: 'Keep this.' });
  f.stt.events.push({ type: 'partial', segmentId: 'two', text: 'uncertain' }); await settle();
  await f.flow.control(f.control('dictation.stop')); await vi.advanceTimersByTimeAsync(2000);
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'dictation.complete', finalization: 'timeout', unfinalizedTail: true });
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'dictation.final', segmentId: 'one', text: 'Keep this.' });
});
```

- [ ] **Run RED:** `npm test -- test/voice/session/dictation.spec.ts`. Expected missing `DictationFlow` import.
- [ ] **Implement the minimal flow:**

```typescript
import type { SpeechToTextPort, SpeechInputConnection, SttEvent, SpeechUsage } from '../../contracts/voice.js';
import { INPUT_AUDIO, type VoiceClientEvent } from '../../contracts/voice-wire.js';
import { fault, type SessionContext, type VoiceFlow, type VoiceSink } from './voice-session.options.js';
export class DictationFlow implements VoiceFlow {
  private state: 'recording' | 'finalizing' | 'closed' = 'recording';
  private finals = new Set<string>(); private interim = false; private audioBytes = 0;
  private timer?: ReturnType<typeof setTimeout>; private closing?: Promise<void>;
  private task?: Promise<void>;
  private constructor(private readonly context: SessionContext, private readonly sink: VoiceSink,
    private readonly stt: SpeechInputConnection,
    private readonly usage: (c: SessionContext, u: SpeechUsage) => Promise<void>) {}
  static async open(context: SessionContext, sink: VoiceSink, signal: AbortSignal,
    port: SpeechToTextPort, usage: (c: SessionContext, u: SpeechUsage) => Promise<void>) {
    if (context.response.mode !== 'dictation') fault('VOICE_INVALID_STATE');
    const stt = await port.connect({ mode: 'dictation', locale: 'en-US', audio: INPUT_AUDIO, abortSignal: signal });
    const flow = new DictationFlow(context, sink, stt, usage);
    return flow;
  }
  start() { if (!this.task) this.task = this.consume(); }
  async input(pcm: Uint8Array) {
    if (this.state !== 'recording') fault('VOICE_INVALID_STATE');
    this.audioBytes += pcm.byteLength; await this.stt.writeAudio(pcm);
  }
  async control(event: VoiceClientEvent) {
    if (event.type === 'dictation.cancel') {
      if (this.state === 'closed') return;
      await this.close(); this.sink.finish('cancelled'); return;
    }
    if (event.type !== 'dictation.stop') fault('VOICE_INVALID_STATE');
    if (this.state !== 'recording') return;
    this.state = 'finalizing';
    this.timer = setTimeout(() => { void this.complete(true); }, Math.min(2000, this.context.response.limits.finalizationMs));
    // Non-blocking: a later Cancel must not wait behind provider finalization.
    void this.stt.finalize().catch(() => this.providerError());
  }
  private async consume() {
    try {
      for await (const e of this.stt.events) {
        if (e.type === 'usage') { await this.usage(this.context, e.usage); continue; }
        if (this.state === 'closed') continue;
        await this.handle(e);
      }
      if (this.state !== 'closed') await this.providerError();
    } catch { if (this.state !== 'closed') await this.providerError(); }
  }
  private async handle(e: SttEvent) {
    if (e.type === 'partial' && !this.finals.has(e.segmentId)) {
      this.interim = Boolean(e.text); this.sink.event({ type: 'dictation.partial', segmentId: e.segmentId, text: e.text });
    } else if (e.type === 'final' && !this.finals.has(e.segmentId)) {
      if (this.finals.size >= 4096) fault('VOICE_SEQUENCE_ERROR');
      this.finals.add(e.segmentId); this.interim = false;
      this.sink.event({ type: 'dictation.final', segmentId: e.segmentId, text: e.text });
    } else if (e.type === 'finalized' && this.state === 'finalizing') {
      await this.complete(e.unfinalizedTail);
    } else if (e.type === 'error') {
      if (e.fault.code === 'DICTATION_FINALIZATION_TIMEOUT' && this.state === 'finalizing') return;
      await this.providerError();
    }
  }
  private async complete(timeout: boolean) {
    if (this.state === 'closed') return;
    this.state = 'closed'; clearTimeout(this.timer);
    if (timeout) this.sink.event({ type: 'session.warning', code: 'DICTATION_FINALIZATION_TIMEOUT',
      recovery: 'retry_dictation', recoverable: true });
    this.sink.event({ type: 'dictation.complete', finalization: timeout ? 'timeout' : this.finals.size ? 'complete' : 'empty',
      unfinalizedTail: timeout && (this.interim || this.audioBytes > 0) });
    await this.close(); this.sink.finish('completed');
  }
  private async providerError() {
    if (this.state === 'closed') return;
    this.sink.event({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'retry_dictation', recoverable: true });
    await this.close(); this.sink.finish('error');
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.state = 'closed'; clearTimeout(this.timer);
    // Never await the consumer from inside its own event callback.
    this.closing = this.stt.close(); return this.closing;
  }
}
```

#### 3B — Correct empty/tail semantics and shutdown usage

- [ ] **Append this failing edge case:**

```typescript
it('a provider timeout after all speech finalized does not invent a lost tail', async () => {
  const f = await fixture(); await f.flow.input(new Uint8Array(2560));
  f.stt.events.push({ type: 'final', segmentId: 'one', text: 'Complete.' }); await settle();
  await f.flow.control(f.control('dictation.stop'));
  f.stt.events.push({ type: 'finalized', unfinalizedTail: false }); await settle();
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false });
});
```

- [ ] **Run:** `npm test -- test/voice/session/dictation.spec.ts -t "does not invent"`. This may already pass for explicit finalized events. The service watchdog has no segment timestamps, so **unknown** tail on a missing terminal provider event must remain conservative; it must not synthesize partial text into a final. Preserve P3's `unfinalizedTail` exactly when the provider does produce `finalized`.
- [ ] **Apply exact change** to `complete`: rename its parameter to `unfinalizedTail`, derive `timeout` from a second parameter defaulting to `unfinalizedTail`, and replace the last expression `timeout && (this.interim || this.audioBytes > 0)` with `unfinalizedTail`. Change the watchdog call to `this.complete(this.interim || this.audioBytes > 0, true)`. Now a terminal provider event with `false` is authoritative; the watchdog still reports missing terminal evidence as timeout, even for empty input. `finalization: 'empty'` is reserved for clean empty finalization.

```typescript
private async complete(unfinalizedTail: boolean, timeout = unfinalizedTail) {
  if (this.state === 'closed') return;
  this.state = 'closed'; clearTimeout(this.timer);
  if (timeout) this.sink.event({ type: 'session.warning', code: 'DICTATION_FINALIZATION_TIMEOUT',
    recovery: 'retry_dictation', recoverable: true });
  this.sink.event({ type: 'dictation.complete', finalization: timeout ? 'timeout' : this.finals.size ? 'complete' : 'empty', unfinalizedTail });
  await this.close(); this.sink.finish('completed');
}
```

Task 1/P9 usage hook receives provider usage even after closing; do not stop iteration before a queued P3 usage event. Keep no transcript persistence, agent method, or TTS dependency in `DictationFlow`.

- [ ] **Verify:** `npm test -- test/voice/session/dictation.spec.ts test/voice/providers`, `npm run build`, `npm run lint`. P3 adapter owns literal Nova options/Finalize protocol; do not duplicate those settings in P5.
- [ ] **Commit** (repository root):

```powershell
git add backend/src/voice/session/dictation-flow.ts backend/test/voice/session/dictation.spec.ts backend/test/voice/session/fixtures.ts
git commit -m "feat(voice): stream dictation with bounded stop and cancel"
```

### Task 4: Voice Session Service & Live Audio Gateway Bridging

**Files:** Create `backend/src/voice/session/live-flow.ts`, `backend/test/voice/session/live.spec.ts`. Refine output queue handling in `backend/src/voice/transport/voice-connection.ts` only if its transport budget test requires it.

#### 4A — Final-only turn routing and transcript-free audio

- [ ] **Write failing tests** in `backend/test/voice/session/live.spec.ts`:

```typescript
import { afterEach, expect, it, vi } from 'vitest';
import { LiveFlow } from '../../../src/voice/session/live-flow.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import type { LiveHooks, VoiceSink } from '../../../src/voice/session/voice-session.options.js';
import type { VoiceClientEvent, VoiceClientPayload } from '../../../src/contracts/voice-wire.js';
import { options, origin, request, fakeStt, fakeTts } from './fixtures.js';
import { settle } from '../transport/fixtures.js';
const services: VoiceSessionService[] = [], flows: LiveFlow[] = [];
afterEach(async () => { await Promise.all(flows.splice(0).map(f => f.close()));
  await Promise.all(services.splice(0).map(s => s.drain())); });
async function fixture() {
  const o = options(), s = new VoiceSessionService(o); services.push(s);
  const result = await s.create({ ...request, mode: 'live' }, origin);
  const context = s.claim(result.cookie.split(';')[0], origin), stt = fakeStt(), tts = fakeTts();
  let outputSamples = 0;
  const sink: VoiceSink = { outputSamples: () => outputSamples, event: vi.fn(),
    audio: vi.fn((_ref, pcm) => { outputSamples += pcm.byteLength / 2; }), invalidate: vi.fn(), finish: vi.fn() };
  const hooks: LiveHooks = { finalized: vi.fn(async () => undefined), interrupt: vi.fn(async () => undefined),
    delivery: vi.fn(async () => undefined), playback: vi.fn(async () => undefined), disconnected: vi.fn(async () => undefined) };
  const flow = await LiveFlow.open(context, sink, new AbortController().signal,
    { stt: stt.port, tts: tts.port, hooks, usage: o.usage }); flows.push(flow);
  flow.start();
  const control = (payload: VoiceClientPayload): VoiceClientEvent => ({ protocolVersion: 1,
    sessionId: result.response.sessionId, connectionEpoch: 0, eventId: 'control-1', sequence: 1, ...payload });
  return { o, s, context, stt, tts, sink, hooks, flow, control };
}
const ref = { turnId: 'turn-1', responseId: 'response-1' };
const usage = { providerRequestId: null, model: 'fixture', modelVersion: null, audioMs: 100, billableCharacters: 5 };
it('only submits nonempty EndOfTurn once and never sends transcript events', async () => {
  const f = await fixture();
  f.stt.events.push({ type: 'partial', segmentId: 'p1', text: 'private draft' });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p1', text: '   ' });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p2', text: 'Where is Paris?' });
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p2', text: 'Where is Paris?' }); await settle();
  expect(f.hooks.finalized).toHaveBeenCalledTimes(1);
  expect(f.hooks.finalized).toHaveBeenCalledWith(f.context,
    { providerSocketEpoch: 0, providerTurnId: 'p2', text: 'Where is Paris?' }, expect.any(AbortSignal));
  expect(JSON.stringify(vi.mocked(f.sink.event).mock.calls)).not.toMatch(/private draft|Where is Paris/);
});
it('streams PCM between audio.start and audio.end without assistant text', async () => {
  const f = await fixture(); await f.flow.speak({ ...ref, text: 'Private answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) }); await settle();
  await f.flow.flush(ref);
  f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage }); await settle();
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
  expect(f.sink.audio).toHaveBeenCalledWith(ref, new Uint8Array(4800));
  expect(vi.mocked(f.sink.event).mock.calls.map(([e]) => e.type)).toEqual(['audio.start', 'audio.end', 'voice.state']);
  expect(JSON.stringify(vi.mocked(f.sink.event).mock.calls)).not.toContain('Private answer.');
  expect(f.hooks.delivery).toHaveBeenCalledWith(f.context, expect.objectContaining({ type: 'speech-completed' }));
});
it('mute discards samples, unmute uses only fresh 80ms input', async () => {
  const f = await fixture(), fresh = fakeStt();
  vi.mocked(f.stt.port.connect).mockImplementationOnce(async () => fresh.connection);
  await f.flow.control(f.control({ type: 'input.mute' }));
  await f.flow.input(new Uint8Array(2560)); expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  await f.flow.control(f.control({ type: 'input.unmute' })); await f.flow.input(new Uint8Array(2560));
  expect(fresh.connection.writeAudio).toHaveBeenCalledTimes(1);
  expect(f.stt.connection.close).toHaveBeenCalledTimes(1);
  await expect(f.flow.input(new Uint8Array(2))).rejects.toMatchObject({ code: 'INVALID_AUDIO_FRAME' });
});
it('rejects played-not-sent, regressing or mismatched response progress', async () => {
  const f = await fixture(); await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) }); await settle();
  const progress = (samples: number, responseId = ref.responseId) => f.control({ type: 'playback.progress',
    turnId: ref.turnId, responseId, playedSamples: samples, playedMs: Math.floor(samples / 24) });
  await expect(f.flow.control(progress(2401))).rejects.toMatchObject({ code: 'INVALID_VOICE_CONTROL' });
  await f.flow.control(progress(1200));
  await expect(f.flow.control(progress(1199))).rejects.toMatchObject({ code: 'INVALID_VOICE_CONTROL' });
  await expect(f.flow.control(progress(1200, 'wrong'))).rejects.toMatchObject({ code: 'VOICE_BINDING_MISMATCH' });
});
```

- [ ] **Run RED:** `npm test -- test/voice/session/live.spec.ts`. Expected missing `LiveFlow`.
- [ ] **Implement live flow with P6 callbacks, not inference:**

```typescript
import type { SpeechInputConnection, SpeechOutputConnection } from '../../contracts/voice.js';
import { INPUT_AUDIO, OUTPUT_AUDIO, type VoiceClientEvent } from '../../contracts/voice-wire.js';
import { fault, VoiceSessionError, type FlowDependencies, type SessionContext, type VoiceSink, type VoiceFlow } from './voice-session.options.js';
type Response = { turnId: string; responseId: string; invalid: boolean; started: boolean;
  sent: number; base: number; wireBase: number; completed: boolean; interrupt?: Promise<void> };
export class LiveFlow implements VoiceFlow {
  private muted = false; private closed = false; private agent: 'idle' | 'thinking' | 'speaking' = 'idle';
  private responses = new Map<string, Response>(); private current?: Response;
  private providerBase = 0; private played = 0; private wirePlayed = 0; private lastInterrupt = -1;
  private turns = new Set<string>(); private closing?: Promise<void>;
  private finalChain = Promise.resolve(); private started = false;
  private sttTask?: Promise<void>; private ttsTask?: Promise<void>;
  private sttGeneration = 0; private sttTasks = new Set<Promise<void>>();
  private openingStt?: Promise<SpeechInputConnection>;
  private constructor(private readonly context: SessionContext, private readonly sink: VoiceSink,
    private readonly signal: AbortSignal, private stt: SpeechInputConnection,
    private readonly tts: SpeechOutputConnection, private readonly deps: FlowDependencies) {}
  static async open(context: SessionContext, sink: VoiceSink, signal: AbortSignal, deps: FlowDependencies) {
    if (context.response.mode !== 'live' || !context.reservation) fault('VOICE_INVALID_STATE');
    const stt = await deps.stt.connect({ mode: 'live', locale: 'en-US', audio: INPUT_AUDIO, abortSignal: signal });
    let tts: SpeechOutputConnection;
    try { tts = await deps.tts.connect({ audio: OUTPUT_AUDIO, abortSignal: signal }); }
    catch (error) { await stt.close(); throw error; }
    const flow = new LiveFlow(context, sink, signal, stt, tts, deps);
    return flow;
  }
  get providerSocketId() { return this.tts.providerSocketId; }
  start() { if (this.started || this.closed) return; this.started = true;
    this.startInputReader(); this.ttsTask = this.readTts(); }
  private startInputReader() {
    const task = this.readStt(this.stt, this.sttGeneration);
    this.sttTask = task; this.sttTasks.add(task);
    void task.finally(() => this.sttTasks.delete(task));
  }
  async input(pcm: Uint8Array) {
    if (this.closed) fault('VOICE_INVALID_STATE');
    if (pcm.byteLength !== 2560) fault('INVALID_AUDIO_FRAME');
    if (!this.muted) await this.stt.writeAudio(pcm);
  }
  private state() { this.sink.event({ type: 'voice.state', input: this.muted ? 'muted' : 'listening',
    agent: this.agent, connection: 'connected' }); }
  async control(e: VoiceClientEvent) {
    if (this.closed) fault('VOICE_INVALID_STATE');
    if (e.type === 'input.mute') {
      if (this.muted) return;
      this.muted = true; this.sttGeneration++; this.state(); await this.stt.close(); return;
    }
    if (e.type === 'input.unmute') {
      if (!this.muted) return;
      // Restart recognition to discard the incomplete pre-mute turn and all its late callbacks.
      this.openingStt = this.deps.stt.connect({ mode: 'live', locale: 'en-US', audio: INPUT_AUDIO, abortSignal: this.signal });
      try {
        const stt = await this.openingStt;
        if (this.closed) fault('VOICE_INVALID_STATE');
        this.stt = stt; this.muted = false; this.startInputReader(); this.state();
      } finally { this.openingStt = undefined; }
      return;
    }
    if (e.type === 'playback.progress') {
      const r = this.progress(e, e.playedMs); await this.deps.hooks.playback(this.context, r, this.played);
      this.completePlayback(r);
      return;
    }
    if (e.type === 'response.interrupt') {
      const r = this.progress(e, e.playbackPositionMs);
      await this.interrupt(r, Math.floor(this.played / 24)); return;
    }
    fault('VOICE_INVALID_STATE');
  }
  private progress(e: Extract<VoiceClientEvent, { type: 'playback.progress' | 'response.interrupt' }>, ms: number) {
    const r = this.responses.get(e.responseId);
    if (!r || r.turnId !== e.turnId) fault('VOICE_BINDING_MISMATCH');
    if (e.playedSamples < this.wirePlayed || e.playedSamples > r.wireBase + r.sent || e.playedSamples < r.wireBase ||
      ms !== Math.floor(e.playedSamples / 24)) fault('INVALID_VOICE_CONTROL');
    this.wirePlayed = e.playedSamples;
    // Transport cursor includes discarded frames; provider cursor does not. Never send the wire cursor to Flux.
    this.played = r.base + e.playedSamples - r.wireBase; return r;
  }
  private completePlayback(r: Response) {
    // V1 headers quantize the cursor by <24 samples (<1ms); never promote that rounding to durable heard text.
    if (!r.invalid && r.completed && r.wireBase + r.sent - this.wirePlayed < 24 && this.current === r) {
      this.sink.event({ type: 'audio.end', turnId: r.turnId, responseId: r.responseId, lastAudioSequence: null });
      this.current = undefined; this.agent = 'idle'; this.state();
    }
  }
  async speak(command: { turnId: string; responseId: string; text: string }) {
    if (this.closed) fault('VOICE_INVALID_STATE');
    if (!command.text) return;
    let r = this.responses.get(command.responseId);
    if (!r) {
      if (this.current || this.responses.size >= 4096) fault('VOICE_INVALID_STATE');
      r = { turnId: command.turnId, responseId: command.responseId, invalid: false,
        started: false, sent: 0, base: this.providerBase, wireBase: this.sink.outputSamples(), completed: false };
      this.responses.set(command.responseId, r); this.current = r;
    }
    if (r.turnId !== command.turnId || r.invalid || r.completed) fault('VOICE_INVALID_STATE');
    await this.tts.speak(command);
  }
  async flush(ref: { turnId: string; responseId: string }) {
    const r = this.responses.get(ref.responseId);
    if (!r || r.invalid || r.turnId !== ref.turnId || this.closed) fault('VOICE_INVALID_STATE');
    await this.tts.flush(ref);
  }
  private async interrupt(r: Response, ms: number) {
    if (r.interrupt) { await r.interrupt; return; }
    if (r.invalid) return;
    r.invalid = true; this.sink.invalidate(r); this.agent = 'idle'; this.state();
    r.interrupt = (async () => {
      // Invalidation occurs before either asynchronous operation; provider cancellation is best-effort.
      const abort = (async () => { await this.deps.hooks.playback(this.context, r, this.played);
        await this.deps.hooks.interrupt(this.context, r); })();
      if (r.completed) { await abort; if (this.current === r) this.current = undefined; return; }
      if (ms <= this.lastInterrupt) {
        await abort; await this.error('VOICE_DELIVERY_UNKNOWN'); return;
      }
      this.lastInterrupt = ms;
      try { await this.tts.interrupt({ turnId: r.turnId, responseId: r.responseId,
        providerSocketId: this.tts.providerSocketId, playbackPositionMs: ms }); }
      finally { await abort; }
    })();
    await r.interrupt;
  }
  private async readStt(connection = this.stt, generation = this.sttGeneration) {
    try {
      for await (const e of connection.events) {
        if (e.type === 'usage') { await this.deps.usage(this.context, e.usage); continue; }
        if (this.closed || generation !== this.sttGeneration) continue;
        if (e.type === 'start-of-turn' && !this.muted && this.current) {
          void this.interrupt(this.current, Math.floor(this.played / 24))
            .catch(() => this.error('VOICE_DELIVERY_UNKNOWN'));
        } else if (e.type === 'end-of-turn' && !this.muted && e.text.trim() && !this.turns.has(e.providerTurnId)) {
          if (this.turns.size >= 4096) fault('VOICE_SEQUENCE_ERROR');
          this.turns.add(e.providerTurnId); this.agent = 'thinking'; this.state();
          // One bounded pending completed input; never spawn unbounded agent promises.
          this.finalChain = this.finalChain.then(async () => {
            if (!this.closed) await this.deps.hooks.finalized(this.context, {
              providerSocketEpoch: this.context.response.connectionEpoch,
              providerTurnId: e.providerTurnId, text: e.text }, this.signal);
          }).catch(() => this.error('VOICE_AGENT_FAILED'));
        } else if (e.type === 'error') this.error(e.fault.code);
      }
      if (!this.closed && generation === this.sttGeneration) this.error('STT_UNAVAILABLE');
    } catch (error) { if (!this.closed && generation === this.sttGeneration)
      this.error(error instanceof VoiceSessionError ? error.code : 'STT_UNAVAILABLE'); }
  }
  private async readTts() {
    try {
      for await (const e of this.tts.events) {
        if (e.type === 'error') { if (!this.closed) this.error(e.fault.code); continue; }
        // Reconciliation evidence must reach P6 even after the UI/transport is closed.
        if (e.type !== 'audio') await this.deps.hooks.delivery(this.context, e);
        if (e.type === 'speech-completed' || e.type === 'speech-interrupted') await this.deps.usage(this.context, e.usage);
        if (this.closed) continue;
        const r = this.responses.get(e.responseId);
        if (!r || r.turnId !== e.turnId) continue;
        if (e.type === 'speech-interrupted') {
          if (e.audioPlayedMs === null) { this.error('VOICE_DELIVERY_UNKNOWN'); continue; }
          this.providerBase = r.base + e.audioPlayedMs * 24;
          if (this.current === r) this.current = undefined; continue;
        }
        if (r.invalid) continue;
        if (e.type === 'speech-started') {
          if (r.started) continue; r.started = true;
          this.sink.event({ type: 'audio.start', turnId: r.turnId, responseId: r.responseId,
            sampleRate: 24000, firstAudioSequence: 0 });
        } else if (e.type === 'audio') {
          if (!r.started || !e.pcm.byteLength || e.pcm.byteLength % 2) fault('INVALID_AUDIO_FRAME');
          if (r.wireBase + r.sent + e.pcm.byteLength / 2 - Math.max(this.wirePlayed, r.wireBase) > this.context.response.limits.outputQueueMs * 24)
            fault('AUDIO_BUFFER_OVERFLOW');
          this.sink.audio({ turnId: r.turnId, responseId: r.responseId }, e.pcm); r.sent += e.pcm.byteLength / 2;
        } else if (e.type === 'speech-completed') {
          if (!r.started) fault('VOICE_INVALID_STATE');
          r.completed = true; this.providerBase = r.base + e.audioDurationMs * 24;
          // Keep audio response open until final playback.progress: barge-in must still cancel queued playback.
          // Progress may already have arrived before provider completion; do not require a second acknowledgment.
          this.completePlayback(r);
        }
      }
      if (!this.closed) this.error('TTS_UNAVAILABLE');
    } catch (error) { if (!this.closed)
      this.error(error instanceof VoiceSessionError ? error.code : 'VOICE_DELIVERY_UNKNOWN'); }
  }
  private error(code: import('../../contracts/voice-wire.js').VoiceErrorCode) {
    if (this.closed) return;
    this.sink.event({ type: 'session.error', code, recovery: 'return_to_chat', recoverable: false });
    this.sink.finish('error');
    void this.close().catch(() => undefined);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; if (this.current) { this.current.invalid = true; this.sink.invalidate(this.current); }
    const opening = this.openingStt;
    this.closing = (async () => {
      const result = await Promise.allSettled([this.stt.close(), this.tts.close()]);
      const late = await opening?.catch(() => undefined); if (late && late !== this.stt) await late.close();
      // Allocation may be disposed before ready/start; still drain terminal accounting/evidence.
      this.sttTask ??= this.readStt(); this.ttsTask ??= this.readTts();
      await Promise.all([...this.sttTasks, this.sttTask, this.ttsTask]);
      await this.deps.hooks.disconnected(this.context);
      if (result.some(r => r.status === 'rejected')) fault('VOICE_DELIVERY_UNKNOWN');
    })();
    return this.closing;
  }
}
```

#### 4B — Barge-in responsiveness, bounded finalized inputs, synthesis/playback separation

The initial source deliberately leaves the following refinements as independent short TDD edits. Apply them before committing; they are required behavior, not optional optimizations.

- [ ] **Append failing interruption and queue tests:**

```typescript
it('StartOfTurn invalidates before cancellation and drops late audio', async () => {
  const f = await fixture(); await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) }); await settle();
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 1200, playedMs: 50 }));
  f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'p2' }); await settle();
  expect(f.sink.invalidate).toHaveBeenCalledWith(expect.objectContaining(ref));
  expect(f.tts.connection.interrupt).toHaveBeenCalledWith({ ...ref, providerSocketId: 'provider-socket-1', playbackPositionMs: 50 });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) }); await settle();
  expect(f.sink.audio).toHaveBeenCalledTimes(1);
});
it('bounds the completed-input backlog instead of queuing another inference', async () => {
  const f = await fixture(); let finish!: () => void;
  f.hooks.finalized = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p1', text: 'one' }); await settle();
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p2', text: 'two' }); await settle();
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'p3', text: 'three' }); await settle();
  expect(f.sink.event).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.error', code: 'CONFLICT_ACTIVE_TURN' }));
  finish(); await settle(); expect(f.hooks.finalized).toHaveBeenCalledTimes(1);
});
it('synthesis completion does not claim listening before the last played sample', async () => {
  const f = await fixture(); await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) }); await settle();
  f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage }); await settle();
  expect(f.sink.event).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'voice.state', agent: 'idle' }));
  await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' });
});
it('translates monotonic wire playback past discarded audio into the provider cursor', async () => {
  const f = await fixture(); await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) }); await settle();
  await f.flow.control(f.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 }));
  f.tts.events.push({ type: 'speech-interrupted', ...ref, speechId: 'speech-1', audioPlayedMs: 50,
    textSpoken: 'An', textRemaining: 'swer.', usage }); await settle();
  const next = { turnId: 'turn-2', responseId: 'response-2' };
  await f.flow.speak({ ...next, text: 'Next.' });
  f.tts.events.push({ type: 'speech-started', ...next, speechId: 'speech-2' });
  f.tts.events.push({ type: 'audio', ...next, pcm: new Uint8Array(4800) }); await settle();
  await f.flow.control(f.control({ type: 'response.interrupt', ...next, playedSamples: 3600, playbackPositionMs: 150 }));
  expect(f.tts.connection.interrupt).toHaveBeenLastCalledWith({ ...next,
    providerSocketId: 'provider-socket-1', playbackPositionMs: 100 });
});
```

- [ ] **Run RED:** `npm test -- test/voice/session/live.spec.ts -t "bounds the completed-input"`. Expected: the unbounded `finalChain` initially queues third input.
- [ ] **Implement the exact bounded edit:** add `private pendingTurns = 0;` and before `turns.add` use `if (this.pendingTurns >= 2) fault('CONFLICT_ACTIVE_TURN'); this.pendingTurns++;`. Append `.finally(() => { this.pendingTurns--; })` after the final-chain catch. If `closed`, skip queued input without invoking P6. This permits one running + one pending finalized input, never an unlimited transcript queue. P6 still owns durable acceptance and waiting for cancelled execution/delivery reconciliation; a hook promise resolves only when that turn is reconciled, not when inference is merely launched.
- [ ] **Check STT remains listening during asynchronous interruption:** the source starts interruption without awaiting it in the STT reader. Invalidation is synchronous; a blocked P6 cancellation cannot stop the next `EndOfTurn`. Do not launch the next P6 hook until `finalChain`/P6 reconciliation permits it.
- [ ] **Emit speaking state at speech start:** after `r.started = true`, set `this.agent = 'speaking'; this.state();`. Update 4A's event-order expectation to `['voice.state', 'audio.start', 'audio.end', 'voice.state']`. Playback completion emits idle; TTS completion alone does not.
- [ ] **Verify provider/transport cursor separation:** `wireBase` includes all emitted bytes, including discarded playback; `base` is the provider socket cursor. `playback.progress` validates the wire cursor then translates into provider samples for P6 and interruption. Never send the wire cursor directly to Flux. Unknown interrupted delivery closes rather than guessing a base; a repeated provider interrupt offset is also unknown/fail-closed. New provider sockets alone reset the provider origin.
- [ ] **Retain cancellation until playback completes:** P4 clears its response mapping on `audio.end`, so P5 emits that event only after both synthesis completion and final playback acknowledgment (in either arrival order). While completed synthesis is still queued locally, keep the transport response active so `StartOfTurn` can emit `response.cancelled`. P8 must continue periodic `playback.progress` while a response is active, even if its queue just drained; this is not replay or another public contract. P6 distinguishes generated completion from delivered/interrupted/unknown evidence, including interruption after synthesis finished.
- [ ] **Normalize callback failures without a second agent:** `finalized` failures use `VOICE_AGENT_FAILED`; failed delivery/playback reconciliation uses `VOICE_DELIVERY_UNKNOWN`. Forward only P6-filtered user-facing speech through `speak`; P5 never rewrites text and never calls the runtime directly.
- [ ] **Verify:** `npm test -- test/voice/session/live.spec.ts test/voice/transport/gateway.spec.ts test/voice/providers`, `npm run build`, `npm run lint`.
- [ ] **Commit** (repository root):

```powershell
git add backend/src/voice/session/live-flow.ts backend/test/voice/session/live.spec.ts backend/src/voice/transport/voice-connection.ts
git commit -m "feat(voice): bridge live Flux audio and playback controls"
```

### Task 5: Voice Session Transport & Gateway Integration Tests

**Files:** Create `backend/test/voice/transport/gateway.integration.spec.ts`; extend P5-owned session/transport tests only for failures detected here. Test suffix `.integration.spec.ts` is intentional: existing routine Vitest discovery includes it; `.e2e-spec.ts` would require the separate configuration.

#### 5A — Deterministic full gateway flow with fake speech

- [ ] **Write a failing real Nest/native-ws fixture:**

```typescript
import 'reflect-metadata';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import type { INestApplication } from '@nestjs/common';
import WebSocket from 'ws';
import supertest from 'supertest';
import { INPUT_AUDIO, type VoiceClientPayload } from '../../../src/contracts/voice-wire.js';
import { encodeVoiceAudio, decodeVoiceAudio } from '../../../src/contracts/voice-audio.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { VoiceSessionController } from '../../../src/voice/session/voice-session.controller.js';
import { VOICE_SESSION_OPTIONS, type LiveHooks } from '../../../src/voice/session/voice-session.options.js';
import { DictationFlow } from '../../../src/voice/session/dictation-flow.js';
import { LiveFlow } from '../../../src/voice/session/live-flow.js';
import { VoiceGateway } from '../../../src/voice/transport/voice.gateway.js';
import { options, origin, request, fakeStt, fakeTts, EventQueue } from '../session/fixtures.js';
import { settle } from './fixtures.js';
let app: INestApplication, sessions: VoiceSessionService;
let base: string, o: ReturnType<typeof options>;
let stt: ReturnType<typeof fakeStt>, tts: ReturnType<typeof fakeTts>;
const sockets: WebSocket[] = [];
let hooks: LiveHooks;
beforeEach(async () => {
  o = options(); stt = fakeStt(); tts = fakeTts();
  hooks = { finalized: vi.fn(async () => undefined), interrupt: vi.fn(async () => undefined),
    delivery: vi.fn(async () => undefined), playback: vi.fn(async () => undefined), disconnected: vi.fn(async () => undefined) };
  o.open = async (context, sink, signal) => context.response.mode === 'dictation'
    ? DictationFlow.open(context, sink, signal, stt.port, o.usage)
    : LiveFlow.open(context, sink, signal, { stt: stt.port, tts: tts.port, hooks, usage: o.usage });
  const module = await Test.createTestingModule({ controllers: [VoiceSessionController], providers: [
    { provide: VOICE_SESSION_OPTIONS, useValue: o }, VoiceSessionService, VoiceGateway] }).compile();
  app = module.createNestApplication(); app.setGlobalPrefix('api'); app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0, '127.0.0.1'); base = await app.getUrl(); sessions = app.get(VoiceSessionService);
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await sessions.drain(); await app.close();
});
async function connect(mode: 'dictation' | 'live' = 'dictation') {
  const created = await supertest(base).post('/api/voice/sessions').set('Origin', origin).send({ ...request, mode }).expect(201);
  const cookie = String(created.headers['set-cookie'][0]).split(';')[0];
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/voice', { headers: { Origin: origin, Cookie: cookie } });
  sockets.push(socket);
  const messages = new EventQueue<{ data: Buffer; binary: boolean }>();
  socket.on('message', (data, binary) => messages.push({ data: Buffer.from(data as Buffer), binary }));
  await once(socket, 'open');
  let sequence = 0;
  const control = (payload: VoiceClientPayload) => socket.send(JSON.stringify({ protocolVersion: 1,
    sessionId: created.body.sessionId, connectionEpoch: created.body.connectionEpoch,
    eventId: `client-${sequence}`, sequence: sequence++, ...payload }));
  control({ type: 'session.start', mode, audioSettings: INPUT_AUDIO });
  const reader = messages[Symbol.asyncIterator]();
  const next = async () => (await reader.next()).value!;
  expect(JSON.parse((await next()).data.toString()).type).toBe('session.ready');
  return { socket, next, control, created, cookie };
}
it('serves exact REST routes and rejects unknown DTO/query keys without allocation', async () => {
  const config = await supertest(base).get('/api/voice/config').expect(200);
  expect(config.body.enabledModes).toEqual({ dictation: true, live: true });
  expect(JSON.stringify(config.body)).not.toContain('fixture-secret');
  await supertest(base).get('/api/voice/config?userId=attacker').expect(400);
  await supertest(base).post('/api/voice/sessions').set('Origin', origin)
    .send({ ...request, userId: 'attacker' }).expect(400);
  await supertest(base).post('/api/voice/sessions').set('Origin', 'https://evil.example').send(request).expect(403);
  o.config.enabledModes.dictation = false;
  await supertest(base).post('/api/voice/sessions').set('Origin', origin).send(request).expect(503);
  expect(stt.port.connect).not.toHaveBeenCalled(); expect(o.admission).not.toHaveBeenCalled();
});
it('dictation round-trips PCM, finalization and idempotent DELETE without inference', async () => {
  const f = await connect();
  f.socket.send(encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(2560) }));
  stt.events.push({ type: 'partial', segmentId: 's1', text: 'private dictation' });
  expect(JSON.parse((await f.next()).data.toString()).type).toBe('dictation.partial');
  f.control({ type: 'dictation.stop' });
  // Wait on the provider operation instead of using a wall-clock sleep.
  await vi.waitFor(() => expect(stt.connection.finalize).toHaveBeenCalledTimes(1));
  stt.events.push({ type: 'final', segmentId: 's1', text: 'Private dictation.' });
  stt.events.push({ type: 'finalized', unfinalizedTail: false });
  expect(JSON.parse((await f.next()).data.toString()).type).toBe('dictation.final');
  expect(JSON.parse((await f.next()).data.toString()).type).toBe('dictation.complete');
  expect(JSON.parse((await f.next()).data.toString()).type).toBe('session.ended');
  await supertest(base).delete(`/api/voice/sessions/${f.created.body.sessionId}`).set('Origin', origin).expect(204);
  await supertest(base).delete(`/api/voice/sessions/${f.created.body.sessionId}`).set('Origin', origin).expect(204);
  expect(hooks.finalized).not.toHaveBeenCalled(); expect(stt.connection.close).toHaveBeenCalledTimes(1);
});
it('invalid Origin and replayed ticket close before a speech connection is allocated', async () => {
  const created = await supertest(base).post('/api/voice/sessions').set('Origin', origin).send(request).expect(201);
  const cookie = String(created.headers['set-cookie'][0]).split(';')[0];
  const bad = new WebSocket(base.replace('http:', 'ws:') + '/api/voice', { headers: { Origin: 'https://evil.example', Cookie: cookie } });
  sockets.push(bad); const [code] = await once(bad, 'close'); expect(code).toBe(1008);
  expect(stt.port.connect).not.toHaveBeenCalled();
  const valid = new WebSocket(base.replace('http:', 'ws:') + '/api/voice', { headers: { Origin: origin, Cookie: cookie } });
  sockets.push(valid); await once(valid, 'open');
  const replay = new WebSocket(base.replace('http:', 'ws:') + '/api/voice', { headers: { Origin: origin, Cookie: cookie } });
  sockets.push(replay); const [replayCode] = await once(replay, 'close'); expect(replayCode).toBe(1008);
  expect(stt.port.connect).not.toHaveBeenCalled();
});
it('a live reconnect opens fresh providers and never replays incomplete input', async () => {
  const f = await connect('live');
  stt.events.push({ type: 'partial', segmentId: 'lost', text: 'incomplete command' }); await settle();
  f.socket.terminate();
  await vi.waitFor(() => expect(stt.connection.close).toHaveBeenCalledTimes(1));
  const oldStt = stt, oldTts = tts;
  stt = fakeStt(); tts = fakeTts(); const reconnected = await connect('live');
  expect(reconnected.created.body.sessionId).toBe(f.created.body.sessionId);
  expect(reconnected.created.body.connectionEpoch).toBe(1);
  expect(hooks.finalized).not.toHaveBeenCalled(); expect(stt.connection.writeAudio).not.toHaveBeenCalled();
  expect(oldTts.connection.close).toHaveBeenCalledTimes(1); expect(oldStt.connection.close).toHaveBeenCalledTimes(1);
  expect(o.reservations.acquire).toHaveBeenCalledTimes(1);
});
```

- [ ] **Run RED:** `npm test -- test/voice/transport/gateway.integration.spec.ts`. It must actually discover all three tests. Failures here are P5 defects unless traced to a P1/P3 prerequisite; do not change provider ownership or mask failures.
- [ ] **Verify explicit reader readiness:** the source already implements `VoiceFlow.start()`: open allocates, the gateway emits `session.ready`, then starts event readers. No queued provider event may precede ready, and no microtask-count workaround is allowed. Direct-flow fixtures call `start()` explicitly. Remove unused imports reported by lint.

#### 5B — Abuse, ordering, timeouts and terminal cleanup

- [ ] **Append exact regressions** to `gateway.spec.ts` (import `vi` from Vitest):

```typescript
it('drops duplicate controls and audio without a second provider write', async () => {
  const f = await fixture(); const start = f.event('session.start');
  f.socket.text(start); f.socket.text(start); await settle();
  const bytes = encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(2560) });
  f.socket.binary(bytes); f.socket.binary(bytes); await settle();
  const flow = await vi.mocked(f.o.open).mock.results[0].value;
  expect(f.o.open).toHaveBeenCalledTimes(1); expect(flow.input).toHaveBeenCalledTimes(1);
});
it('input backpressure rejects instead of buffering unlimited audio', async () => {
  const f = await fixture(); f.socket.text(f.event('session.start')); await settle();
  const flow = await vi.mocked(f.o.open).mock.results[0].value;
  let finish!: () => void;
  flow.input = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  for (let i = 0; i < 14; i++) f.socket.binary(encodeVoiceAudio({ kind: 1, flags: 0,
    sequence: i, offsetMs: i * 80, pcm: new Uint8Array(2560) }));
  await settle(); finish?.(); await settle();
  expect(f.socket.events()).toContainEqual(expect.objectContaining({ type: 'session.error', code: 'AUDIO_BUFFER_OVERFLOW' }));
  expect(f.socket.close).toHaveBeenCalled();
});
it('disconnect during provider opening aborts and disposes the late connection', async () => {
  const f = await fixture(); let resolve!: (value: Awaited<ReturnType<typeof f.o.open>>) => void;
  const late = { start: vi.fn(), input: vi.fn(async () => undefined), control: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
  f.o.open = vi.fn<typeof f.o.open>((_c, _sink, signal) => {
    expect(signal.aborted).toBe(false);
    return new Promise(r => { resolve = r; });
  });
  f.socket.text(f.event('session.start')); await settle(); f.socket.emit('close');
  resolve(late); await settle();
  expect(late.close).toHaveBeenCalledTimes(1); expect(late.start).not.toHaveBeenCalled();
  expect(f.socket.events().some(e => e.type === 'session.ready')).toBe(false);
});
it('reconnect deadline does not extend with repeated REST attempts', async () => {
  vi.useFakeTimers(); const f = await fixture('live');
  f.socket.text(f.event('session.start')); await settle(); f.socket.emit('close'); await settle();
  await vi.advanceTimersByTimeAsync(5000); await f.s.create({ ...request, mode: 'live' }, origin);
  await vi.advanceTimersByTimeAsync(5001);
  expect(f.s.snapshot().active).toBe(0); expect(f.o.reservations.release).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
```

- [ ] **Run:** `npm test -- test/voice/transport/gateway.spec.ts -t "late connection"`. Expected PASS with exactly one close; changing the source to close from both the open continuation and disposal must make it fail.
- [ ] **Verify minimal late-allocation implementation:** `if (this.closed) return` in the open continuation leaves `dispose` as the sole late-flow cleanup owner, awaiting `starting`. The AbortSignal must stop actual P3 allocation, not merely prevent ready. Keep this shared cleanup boundary rather than guards in every socket callback.
- [ ] **Append output sequence/ref regression to the integration file:**

```typescript
it('multiplexes output with epoch-wide monotonic sequences and response refs', async () => {
  const f = await connect('live');
  // Capture the P5 LiveFlow from the composition callback, not through production internals.
  const flows: LiveFlow[] = [];
  const original = o.open;
  await sessions.end(f.created.body.sessionId);
  o.open = async (c, sink, signal) => { const flow = await original(c, sink, signal); flows.push(flow as LiveFlow); return flow; };
  const created = await supertest(base).post('/api/voice/sessions').set('Origin', origin)
    .send({ ...request, mode: 'live', idempotencyKey: 'second-session' }).expect(201);
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/voice', {
    headers: { Origin: origin, Cookie: String(created.headers['set-cookie'][0]).split(';')[0] } });
  sockets.push(socket);
  const frames: Array<{ data: Buffer; binary: boolean }> = [];
  socket.on('message', (data, binary) => frames.push({ data: Buffer.from(data as Buffer), binary }));
  await once(socket, 'open'); socket.send(JSON.stringify({ protocolVersion: 1,
    sessionId: created.body.sessionId, connectionEpoch: 0, eventId: 'start', sequence: 0,
    type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }));
  await vi.waitFor(() => expect(flows.length).toBe(1));
  const ref = { turnId: 't1', responseId: 'r1' };
  await flows[0].speak({ ...ref, text: 'hidden answer' });
  tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(12000) });
  await vi.waitFor(() => expect(frames.filter(f => f.binary).length).toBe(2));
  const audio = frames.filter(f => f.binary).map(f => decodeVoiceAudio(f.data));
  expect(audio.map(f => [f.kind, f.sequence, f.offsetMs, f.pcm.length])).toEqual([
    [2, 0, 0, 9600], [2, 1, 200, 2400]]);
  const controls = frames.filter(f => !f.binary).map(f => JSON.parse(f.data.toString()));
  expect(controls).toContainEqual(expect.objectContaining({ type: 'audio.start', ...ref, firstAudioSequence: 0 }));
  expect(JSON.stringify(controls)).not.toContain('hidden answer');
});
```

Use **fresh** `fakeStt()`/`fakeTts()` before opening the second session in this test; the first session's closed queues must not be reused. Add `stt = fakeStt(); tts = fakeTts();` immediately after the first `sessions.end`.

- [ ] **Run GREEN and remove unused imports:** `npm test -- test/voice/session test/voice/transport`. Then `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`. All deterministic P5 tests must be discovered and pass. Existing native suites may skip without operator-supplied isolated MongoDB settings; report skip counts separately. Never treat empty discovery as success.
- [ ] **Check serialization boundaries:** public live events must validate through P1 `parseVoiceControl(..., 'server', 'live')`; no provider transcript, `textGenerated`, `textSpoken`, transcript-bearing error message, or assistant token is in client events. Audio links to the active response via `audio.start` and epoch-wide binary sequence, not an invented response field in the 16-byte header.
- [ ] **Commit** (repository root; these are the named P5 files exercised/refined above):

```powershell
git add backend/test/voice/transport/gateway.integration.spec.ts backend/test/voice/transport/gateway.spec.ts backend/src/voice/session/voice-session.options.ts backend/src/voice/session/voice-session.service.ts backend/src/voice/session/dictation-flow.ts backend/src/voice/session/live-flow.ts backend/src/voice/transport/voice-connection.ts backend/test/voice/session/fixtures.ts backend/test/voice/session/dictation.spec.ts backend/test/voice/session/live.spec.ts
git commit -m "test(voice): verify gateway handshake recovery and disposal"
```

## Completion checklist and handoff

- [ ] Config/create/delete routes cover correct prefix/status, safe config, unknown body/query keys, required Origin on mutations, disabled flags, current identity, existing conversation lookup, null New Chat, idempotency, timeout and cleanup.
- [ ] Ticket cookie is secret, HttpOnly, SameSite=Strict, short-lived, single-use, identity/session/origin/epoch-bound, absent from URLs and JSON; wrong Origin cannot consume a valid ticket. Same-origin protected staging must forward Origin/Cookie/Set-Cookie and prohibit caching/request-header logging. `secureCookie` comes from known deployment policy, not attacker-supplied Host/X-Forwarded-Proto.
- [ ] Gateway consumes the cookie before provider allocation, validates `session.start`, state/mode/binding/epoch/control IDs/sequences, validates versioned LE headers through P1, bounds both directions, and removes listeners/disposes providers on all exits.
- [ ] Dictation finalizes at most once, allows Cancel while Stop is pending, commits finals once, reports missing tail without inventing text, and never submits/persists a turn.
- [ ] Live inputs use 80ms PCM16 only. Partials never reach P6 or browser; EndOfTurn is nonempty/deduped/bounded; StartOfTurn invalidates immediately and does not block listening. Muted samples and partial residual live END frames never replay or ForceEndTurn.
- [ ] Audio start/end/cancel references and sequences match P4; late invalidated audio drops. Sent versus played samples stay separate. Provider-socket offsets reset only with a fresh socket; unknown reconciliation stays unknown. Synthesis completion is not proof of heard speech.
- [ ] Reconnect preserves the same voice ID and live reservation, increments epoch, reissues cookie by POST with the same idempotency key, closes old providers, resets socket-local offsets, expires within the original ten-second window, and never replays input/inference. A backend restart has no process-local session recovery; P6 reconciles durable conversation results before an explicitly created new voice session.
- [ ] `bindConversation` is P6's first-accepted-turn handoff: bind the existing reservation, then emit `conversation.bound` through the current sink. Never mint a separate conversation/runtime inside P5. If binding races termination, P6 must reconcile durable acceptance; do not infer completion from an already-closed transport.
- [ ] Expose `stopAccepting`, `snapshot`, `drain`, required admission/usage/disconnect hooks to P9. Its bounded operational drain wraps these calls; no worker may claim indefinite provider cleanup is bounded merely because an AbortSignal exists.
- [ ] P6 receives `LiveFlow.speak/flush`, finalized-turn callbacks including provider socket epoch, interruption and non-audio TTS evidence. P6 owns durable delivery, final response completion, runtime cancellation/reconciliation, and shared text exclusion. P9 owns daily minutes/spend/idle/duration policy. P10 supplies one identity/persistence/reservation composition and mounts the controllers/gateway with WsAdapter. No feature is enabled by a P5 commit alone.
- [ ] Report actual worker commit hashes, exact test commands/counts, skips/failures, any owner follow-up, and remaining P6/P9/P10/provider/hardware evidence gates. Review remains skipped. Do not edit workflow state as the P5 worker/planner unless the orchestrator assigns that documentation ownership.

## Planner verification (documentation, not implemented evidence)

This plan's five tasks cover P5's scoped A5/A6/A11/A12/A14/A16/A17 transport responsibilities. A7/A9 require P6/P8 integration; authentication and tools remain deferred. Check all local document links, the five task headings, fenced blocks, owned paths, and placeholder patterns before committing this artifact. No application, native database, provider, or device test result is asserted by the existence of the plan.

Planner check on 8 October 2026: assembled the fourteen proposed source/test files in an **in-memory** TypeScript compiler host, including the specified follow-up edits, against current upstream imports and backend strict NodeNext options: zero planned-file diagnostics. No implementation files were written and no runtime/provider/database/device suite was run. This is a plan type-consistency check, not worker verification or a unified review.
