# Speech Provider Adapters (P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement deterministic, bounded Nova-3 dictation, Flux conversational recognition, and Flux synthesis adapters behind the already-committed P1 ports.

**Architecture:** Direct server-side `ws` connections translate Deepgram messages into `SttEvent`/`TtsEvent` async iterables. One small provider-local connection helper owns cancellation, bounded buffering, send deadlines, and sanitized failures; adapters own only their respective protocols. No agent execution, browser transport, persistence, or application wiring belongs in P3.

**Tech Stack:** Existing TypeScript NodeNext, Node.js, `ws`, Zod 3, and Vitest 4; no additional dependencies.

---

## Execution boundaries and reading order

- Read [goal.md](goal.md), [research.md](research.md), [state.md](state.md), `backend/src/contracts/voice.ts`, `backend/src/contracts/voice-wire.ts`, and `backend/src/platform/config/voice-config.ts` before implementation. P1 worker prerequisites are recorded as complete (`952b605..a2860f7`). Preserve intervening user work; recheck Git before starting.
- Use the locally available `executing-plans` and `test-driven-development` skills. The header's `superpowers:` names describe the upstream workflow; do not assume those literal skill IDs exist here. No further agent dispatch is necessary for this assigned subsystem. Unified review is **skipped**, not passed.
- Write only under `backend/src/voice/providers/**`, `backend/test/voice/providers/**`, and `backend/test/fixtures/deepgram/**`. P1 alone changes contracts/config/manifests; P5 owns session admission/gateway/reconnect; P6 owns agent cancellation and durable delivery; P9 owns quotas; P10 owns construction/wiring.
- Every new implementation/test TypeScript file must receive the root `AGENTS.md` code header **when written**. Code headers are deliberately absent from this Markdown plan, as requested. JSON fixtures remain strict JSON.
- Commands below run from `backend`, except explicit Git commands, which run from the repository root. Steps are individual 2–5-minute actions; split each file-sized code block into its named class/function actions without changing the API. Red tests precede their corresponding implementation blocks. Commit only named owner files, with the orchestrator's serialized commit slot.
- No API keys are read from disk; no real provider calls, recordings, deployment, or paid checks are authorized. Tests inject a fake socket. Provider readiness here is not application readiness or measured latency/fidelity certification.

## Verified protocol corrections (8 October 2026)

Current official documentation was consulted through Context7 and the primary references below. Apply these more precise findings rather than mechanically copying research examples:

1. Nova `Finalize` may not return `from_finalize` for empty/small buffers. End the bounded drain at 2,000 ms regardless; only flag an unfinalized tail when audio/transcript remains unconfirmed. An ordinary `speech_final` pause never closes capture or triggers inference.
2. Flux `/v2/listen` supports `encoding`, `sample_rate`, model, and EOT parameters; **omit the Nova-only `channels`, `language`, `endpointing`, formatting, and interim options**. English is selected by `flux-general-en`. Use exactly 2,560-byte, 80-ms, little-endian mono PCM16 input frames. Reject malformed frames rather than padding or resampling them here.
3. Flux `CloseStream` may produce only trailing `Update`, not `EndOfTurn`. Ending a session discards that incomplete turn; do not promote it into an agent submission. `finalize()` is the explicit live `ForceEndTurn` operation, not socket cleanup.
4. TTS completion is `SpeechMetadata`, **not `Flushed`**; synthesis completion does not prove browser playback. Only one application response is admitted at a time, avoiding provider pending-turn ambiguity.
5. TTS `SpeechInterrupted.audio_played_ms` is **socket-wide**. Normalize to response-relative `TtsEvent.audioPlayedMs` before P2/P6 persistence, because delivery records compare played duration with that response's generated duration. Carry the exact socket ID with interrupt commands.
6. Repeated interrupts must advance past the last provider offset. Never invent a millisecond or claim unheard text was heard. A duplicate interrupt for an invalidated response is a no-op. A *new* response interrupted with a non-advancing offset is locally invalidated, produces unknown-delivery evidence, and closes the socket; the next authorized connection gets a new origin.
7. Missing split text, an interrupt warning, timeout, or bad reconciliation means explicit unknown delivery (`textSpoken`, `textRemaining`, and `audioPlayedMs` all `null`), never generated-equals-heard.
8. Flux TTS socket Ping/Pong sustains inactivity; Nova needs its JSON `KeepAlive`. These are different controls. Do not assume Flux STT supports Nova `KeepAlive`.

Primary references:
- https://developers.deepgram.com/reference/speech-to-text/listen-streaming
- https://developers.deepgram.com/docs/finalize
- https://developers.deepgram.com/reference/speech-to-text/listen-flux
- https://developers.deepgram.com/docs/flux/close-stream
- https://developers.deepgram.com/reference/text-to-speech/speak-flux
- https://developers.deepgram.com/docs/flux-tts/server-messages
- https://developers.deepgram.com/docs/flux-tts/interrupt-handling

EU endpoint capability, live model/version availability, privacy/account policy, voice audition, billing rates, and actual device/provider performance remain authorized P11/operator checks, not offline passes. P1 currently has no explicit provider model-improvement opt-out setting: report that configuration gap to P1/P9 rather than editing their files or asserting zero retention.

## File map and public handoff

| Exact path | Responsibility |
| --- | --- |
| `backend/src/voice/providers/provider-link.ts` | Socket factory, sanitized fault, bounded single-consumer event queue, connection/send/cleanup lifetimes |
| `backend/src/voice/providers/nova-stt.ts` | `NovaSttAdapter implements SpeechToTextPort`; dictation segments and Stop drain |
| `backend/src/voice/providers/flux-stt.ts` | `FluxSttAdapter implements SpeechToTextPort`; completed live turns |
| `backend/src/voice/providers/flux-tts.ts` | `FluxTtsAdapter implements SpeechSynthesisPort`; response fencing, raw audio, delivered-text reconciliation |
| `backend/src/voice/providers/connect-backoff.ts` | Caller-invoked fresh live connection retry; no established-stream replay |
| `backend/test/fixtures/deepgram/socket.ts` | In-memory `ws`-compatible mock and protocol fixture helpers |
| `backend/test/fixtures/deepgram/nova-results.json` | Synthetic partial revision/final/pause/finalize sequence |
| `backend/test/fixtures/deepgram/flux-turns.json` | Synthetic start/update/end sequence |
| `backend/test/fixtures/deepgram/flux-speech.json` | Synthetic TTS metadata and interruption messages |
| `backend/test/fixtures/deepgram/README.md` | Provenance, replay, authorized capture and sanitization policy |
| `backend/test/voice/providers/nova-stt.spec.ts` | Dictation protocol regressions |
| `backend/test/voice/providers/flux-stt.spec.ts` | Conversational recognition regressions |
| `backend/test/voice/providers/flux-tts.spec.ts` | Synthesis and interruption regressions |
| `backend/test/voice/providers/resilience.spec.ts` | Fault, cancellation, queue, deadline, heartbeat, retry regressions |

Constructors take `(config: VoiceConfig, factory?: SocketFactory)`; default factory uses `ws`, while every routine test passes the mock factory. P10 constructs these once as provider factories, not as a second runtime. `connect()` creates one socket per connection; `providerSocketId` is new per TTS connection. The iterable has one consumer; P5/P6 multiplex downstream events. All transcript/text-bearing events are backend-internal; the adapters never emit browser envelopes.

## Task 1: Nova-3 Dictation STT Adapter

**Files:** Create `backend/src/voice/providers/provider-link.ts`, `backend/src/voice/providers/nova-stt.ts`, `backend/test/fixtures/deepgram/socket.ts`, `backend/test/voice/providers/nova-stt.spec.ts`.

### 1A. Mock seam and segment normalization

- [ ] **Step 1: Write the deterministic fixture helper.** Create `backend/test/fixtures/deepgram/socket.ts` with this complete content. This is test infrastructure, not a green substitute for adapter implementation.

```typescript
import { EventEmitter } from 'node:events';
import { loadVoiceConfig } from '../../../src/platform/config/voice-config.js';
import { INPUT_AUDIO, OUTPUT_AUDIO } from '../../../src/contracts/voice-wire.js';
import type { SocketFactory } from '../../../src/voice/providers/provider-link.js';

export class FakeSocket extends EventEmitter {
  readyState = 0;
  bufferedAmount = 0;
  sent: (string | Uint8Array)[] = [];
  holdSends = false;
  callbacks: ((error?: Error) => void)[] = [];
  terminated = false;
  pings = 0;
  open() { this.readyState = 1; this.emit('open'); }
  json(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
  binary(bytes: Uint8Array) { this.emit('message', Buffer.from(bytes), true); }
  send(data: string | Uint8Array, callback: (error?: Error) => void) {
    this.sent.push(typeof data === 'string' ? data : Uint8Array.from(data));
    if (this.holdSends) this.callbacks.push(callback); else callback();
  }
  ping() { this.pings++; this.emit('pong'); }
  close() { this.readyState = 3; this.emit('close', 1000); }
  terminate() { this.terminated = true; this.close(); }
  controls() { return this.sent.filter((s): s is string => typeof s === 'string').map(s => JSON.parse(s) as unknown); }
}
export function harness(connected: Record<string, unknown> | null = null) {
  const sockets: FakeSocket[] = [];
  const requests: { url: URL; headers: Record<string, string> }[] = [];
  const factory: SocketFactory = (url, headers) => {
    const socket = new FakeSocket();
    sockets.push(socket); requests.push({ url, headers });
    queueMicrotask(() => { socket.open(); if (connected) socket.json(connected); });
    return socket;
  };
  return { sockets, requests, factory };
}
export const config = () => loadVoiceConfig({ DEEPGRAM_API_KEY: 'test-secret-not-real' });
export const input = (mode: 'dictation' | 'live', signal = new AbortController().signal) =>
  ({ mode, locale: 'en-US' as const, audio: INPUT_AUDIO, abortSignal: signal });
export const output = (signal = new AbortController().signal) => ({ audio: OUTPUT_AUDIO, abortSignal: signal });
export async function collect<T>(events: AsyncIterable<T>, target: T[]) {
  for await (const event of events) target.push(event);
}
export const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
export const novaResult = (text: string, final: boolean, start = 0, done = false) => ({
  type: 'Results', start, duration: 0.8, channel_index: [0, 1],
  is_final: final, speech_final: final, from_finalize: done,
  channel: { alternatives: [{ transcript: text, confidence: 0.99, words: [] }] },
});
export const turn = (event: string, sequence: number, text = '', index = 0) => ({
  type: 'TurnInfo', request_id: 'fixture-request', sequence_id: sequence,
  event, turn_index: index, transcript: text, audio_window_start: 0,
  audio_window_end: 0.8, words: [], end_of_turn_confidence: 0.9,
  ...(event === 'EndOfTurn' ? { trigger: 'model' } : {}),
});
export const connected = { type: 'Connected', request_id: 'fixture-request', sequence_id: 0,
  model_name: 'flux-haley-en', model_version: 'fixture-2026-10-08', model_uuids: [] };
export const metadata = (speech = 'dg_sp_000000000001', duration = 100, chars = 12) => ({
  speech_id: speech, audio_duration_ms: duration, input_character_count: chars,
  billable_character_count: chars,
  controls_applied: { pronunciations_applied: 0, breaks_applied: 0, pronunciation_warnings: 0 },
});
```

- [ ] **Step 2: Write the failing adapter tests.** Create `backend/test/voice/providers/nova-stt.spec.ts`:

```typescript
import { afterEach, expect, it, vi } from 'vitest';
import { NovaSttAdapter } from '../../../src/voice/providers/nova-stt.js';
import type { SttEvent } from '../../../src/contracts/voice.js';
import { config, input, harness, collect, tick, novaResult } from '../../fixtures/deepgram/socket.js';
afterEach(() => vi.useRealTimers());

it('replaces partials, emits each final once, and keeps speech_final recording', async () => {
  const h = harness(); const cfg = config(); cfg.deepgram.keyterms = ['Aurvin', 'Demo ID'];
  const c = await new NovaSttAdapter(cfg, h.factory).connect(input('dictation'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  const s = h.sockets[0];
  s.json(novaResult('Demo', false)); s.json(novaResult('Demo 42', false));
  s.json(novaResult('Demo 42.', true)); s.json(novaResult('Demo 42.', true));
  await c.writeAudio(new Uint8Array(2560)); await tick();
  expect(events.flatMap(e => e.type === 'partial' ? [e.text] : [])).toEqual(['Demo', 'Demo 42']);
  expect(events.filter(e => e.type === 'final')).toEqual([
    { type: 'final', segmentId: '0:0:0.8', text: 'Demo 42.' },
  ]);
  expect(events.some(e => e.type === 'end-of-turn' || e.type === 'finalized')).toBe(false);
  expect(s.readyState).toBe(1);
  const { url, headers } = h.requests[0];
  expect(url.origin + url.pathname).toBe('wss://api.deepgram.com/v1/listen');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ model: 'nova-3', language: 'en-US',
    encoding: 'linear16', sample_rate: '16000', channels: '1', interim_results: 'true',
    smart_format: 'true', punctuate: 'true', endpointing: '300' });
  expect(url.searchParams.getAll('keyterm')).toEqual(['Aurvin', 'Demo ID']);
  expect(url.searchParams.has('dictation')).toBe(false);
  expect(headers).toEqual({ Authorization: 'Token test-secret-not-real' });
  expect(url.href).not.toContain('test-secret');
  await c.close(); await done;
});

it('drains late finals on Stop and emits finalized only once', async () => {
  const h = harness(); const c = await new NovaSttAdapter(config(), h.factory).connect(input('dictation'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  await c.writeAudio(new Uint8Array(2560));
  const stop = c.finalize(); const again = c.finalize(); await tick();
  expect(h.sockets[0].controls()).toContainEqual({ type: 'Finalize' });
  await expect(c.writeAudio(new Uint8Array(2560))).rejects.toMatchObject({ fault: { code: 'VOICE_INVALID_STATE' } });
  h.sockets[0].json(novaResult('Keep this tail.', true, 0, true));
  await Promise.all([stop, again]); await done;
  expect(events.filter(e => e.type === 'finalized')).toEqual([{ type: 'finalized', unfinalizedTail: false }]);
  expect(events.flatMap(e => e.type === 'final' ? [e.text] : [])).toEqual(['Keep this tail.']);
});

it('bounds Finalize at 2s and preserves committed text with an uncertain tail', async () => {
  vi.useFakeTimers(); const h = harness();
  const pending = new NovaSttAdapter(config(), h.factory).connect(input('dictation'));
  await vi.advanceTimersByTimeAsync(0); const c = await pending;
  const events: SttEvent[] = []; const done = collect(c.events, events);
  h.sockets[0].json(novaResult('Committed.', true));
  await c.writeAudio(new Uint8Array(2560)); h.sockets[0].json(novaResult('uncertain', false, 0.8));
  const stop = c.finalize(); await vi.advanceTimersByTimeAsync(1999);
  expect(events.some(e => e.type === 'finalized')).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await stop; await done;
  expect(events).toContainEqual({ type: 'final', segmentId: '0:0:0.8', text: 'Committed.' });
  expect(events).toContainEqual({ type: 'finalized', unfinalizedTail: true });
  expect(events).toContainEqual({ type: 'error', fault: { code: 'DICTATION_FINALIZATION_TIMEOUT',
    recoverable: true, recovery: 'retry_dictation' } });
});

it('handles empty Finalize without a provider acknowledgement and ignores cancelled callbacks', async () => {
  vi.useFakeTimers(); const h = harness();
  const pending = new NovaSttAdapter(config(), h.factory).connect(input('dictation'));
  await vi.advanceTimersByTimeAsync(0); const c = await pending;
  const events: SttEvent[] = []; const done = collect(c.events, events);
  const stop = c.finalize(); await vi.advanceTimersByTimeAsync(2000); await stop; await done;
  expect(events).toEqual([{ type: 'finalized', unfinalizedTail: false }]);
  const h2 = harness(); const pending2 = new NovaSttAdapter(config(), h2.factory).connect(input('dictation'));
  await vi.advanceTimersByTimeAsync(0); const c2 = await pending2;
  const late: SttEvent[] = []; const done2 = collect(c2.events, late);
  await c2.close(); h2.sockets[0].json(novaResult('Must not insert.', true)); await done2;
  expect(late).toEqual([]);
});
```

- [ ] **Step 3: Run RED.** `npm test -- test/voice/providers/nova-stt.spec.ts` — expect missing `nova-stt.js` / `provider-link.js` import failure, not a skipped suite. Subsequent red cycles target each `-t` name above.

- [ ] **Step 4: Implement only the shared seam required by Nova.** Create `backend/src/voice/providers/provider-link.ts`. Write `ProviderFault`, then `EventQueue`, then `ProviderLink` in separate small actions:

```typescript
import { EventEmitter } from 'node:events';
import WebSocket, { type RawData } from 'ws';
import { z } from 'zod';
import type { VoiceFault } from '../../contracts/voice.js';
import type { VoiceErrorCode, VoiceRecovery } from '../../contracts/voice-wire.js';
import type { VoiceConfig } from '../../platform/config/voice-config.js';

export interface ProviderSocket extends EventEmitter {
  readyState: number; bufferedAmount: number;
  send(data: string | Uint8Array, callback: (error?: Error) => void): void;
  close(): void; terminate(): void; ping(): void;
}
export type SocketFactory = (url: URL, headers: Record<string, string>) => ProviderSocket;
export const socketFactory: SocketFactory = (url, headers) => new WebSocket(url, {
  headers, maxPayload: 131072, perMessageDeflate: false, followRedirects: false,
});
export class ProviderFault extends Error {
  readonly fault: VoiceFault;
  constructor(code: VoiceErrorCode, recovery: VoiceRecovery = 'return_to_chat', recoverable = true) {
    super(code); this.fault = { code, recovery, recoverable };
  }
}
export const uint = z.number().int().nonnegative().max(0xffffffff);
export const providerId = z.string().min(1).max(128);
export const providerText = z.string().max(32000);
export function sameAudio(value: object, expected: object): boolean {
  const entries = Object.entries(expected);
  return Object.keys(value).length === entries.length && entries.every(([key, v]) =>
    Object.hasOwn(value, key) && (value as Record<string, unknown>)[key] === v);
}
export function providerUrl(config: VoiceConfig, path: string, params: Record<string, string>): URL {
  const url = new URL(path, config.deepgram.apiBase);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}
export class EventQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private wake: (() => void) | undefined;
  private ended = false;
  private claimed = false;
  constructor(private readonly maxBytes: number, private readonly bytes: (event: T) => number) {}
  push(event: T): boolean {
    if (this.ended) return false;
    if (this.values.length >= 256 || this.values.reduce((n, v) => n + this.bytes(v), 0) + this.bytes(event) > this.maxBytes)
      return false;
    this.values.push(event); this.wake?.(); return true;
  }
  discard(predicate: (event: T) => boolean) { this.values = this.values.filter(v => !predicate(v)); }
  retainTerminalEvidence(event: T) {
    if (!this.ended && this.values.length < 257) { this.values.push(event); this.wake?.(); }
  }
  end(terminal?: T) {
    if (this.ended) return;
    // ponytail: <=256 normal events plus one delivery-evidence and one terminal fault; upgrade to a deque if this ceiling grows.
    if (terminal !== undefined) this.values.push(terminal);
    this.ended = true; this.wake?.();
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    if (this.claimed) throw new ProviderFault('VOICE_INVALID_STATE');
    this.claimed = true;
    while (true) {
      if (this.values.length) { yield this.values.shift()!; continue; }
      if (this.ended) return;
      await new Promise<void>(resolve => { this.wake = resolve; }); this.wake = undefined;
    }
  }
}
export class ProviderLink<T extends { type: string }> {
  readonly queue: EventQueue<T>;
  socket!: ProviderSocket;
  active = true;
  private pendingBytes = 0;
  private pending = new Set<(error: ProviderFault) => void>();
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: ProviderFault) => void) | undefined;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private abort = () => this.fail(new ProviderFault('VOICE_SESSION_ENDED', 'none', false));
  constructor(private readonly cfg: VoiceConfig, private readonly signal: AbortSignal,
    private readonly unavailable: 'STT_UNAVAILABLE' | 'TTS_UNAVAILABLE',
    readonly recovery: VoiceRecovery, maxEventBytes: number, eventBytes: (event: T) => number,
    private readonly errorEvent: (fault: VoiceFault) => T,
    private readonly onMessage: (message: Record<string, unknown> | Uint8Array) => void,
    private readonly factory: SocketFactory = socketFactory) {
    this.queue = new EventQueue(maxEventBytes, eventBytes);
  }
  deadline(ms: number, action: () => void) {
    const timer = setTimeout(() => { this.timers.delete(timer); action(); }, ms);
    this.timers.add(timer);
    return () => { clearTimeout(timer); this.timers.delete(timer); };
  }
  emit(event: T) {
    if (this.active && !this.queue.push(event)) this.fail(new ProviderFault('AUDIO_BUFFER_OVERFLOW', this.recovery));
  }
  async start(url: URL, waitConnected = false): Promise<void> {
    if (this.signal.aborted) throw new ProviderFault('VOICE_SESSION_ENDED', 'none', false);
    if (!this.cfg.deepgram.apiKey) throw new ProviderFault(this.unavailable, this.recovery);
    const ready = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    const cancel = this.deadline(this.cfg.limits.connectMs, () => this.fail(new ProviderFault('VOICE_CONNECT_TIMEOUT', this.recovery)));
    this.signal.addEventListener('abort', this.abort, { once: true });
    try {
      this.socket = this.factory(url, { Authorization: `Token ${this.cfg.deepgram.apiKey}` });
      this.socket.on('open', () => { if (!waitConnected) this.readyResolve?.(); });
      this.socket.on('message', (data: RawData, binary: boolean) => {
        if (!this.active) return;
        try {
          const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
          if (bytes.byteLength > 131072) throw new ProviderFault('AUDIO_BUFFER_OVERFLOW', this.recovery);
          if (binary) { this.onMessage(bytes); return; }
          const m = z.record(z.unknown()).parse(JSON.parse(bytes.toString('utf8')));
          if (m.type === 'Error') { this.fail(new ProviderFault(this.unavailable, this.recovery)); return; }
          this.onMessage(m);
          if (m.type === 'Connected') this.readyResolve?.();
        } catch { this.fail(new ProviderFault(this.unavailable, this.recovery)); }
      });
      this.socket.on('error', () => this.fail(new ProviderFault(this.unavailable, this.recovery)));
      this.socket.on('close', () => { if (this.active) this.fail(new ProviderFault(this.unavailable, this.recovery)); });
      this.socket.on('unexpected-response', (_request: unknown, response: { statusCode?: number; resume(): void }) => {
        response.resume();
        this.fail(new ProviderFault(response.statusCode === 429 ? 'VOICE_PROVIDER_RATE_LIMITED' : this.unavailable, this.recovery));
      });
      await ready;
    } catch (error) {
      const fault = error instanceof ProviderFault ? error : new ProviderFault(this.unavailable, this.recovery);
      this.fail(fault); await ready.catch(() => {}); throw fault;
    } finally { cancel(); this.readyResolve = undefined; this.readyReject = undefined; }
  }
  send(data: string | Uint8Array, byteLimit = 131072): Promise<void> {
    if (!this.active || this.socket.readyState !== 1) return Promise.reject(new ProviderFault('VOICE_INVALID_STATE', this.recovery));
    const size = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    if (this.pending.size >= 256 || this.pendingBytes + this.socket.bufferedAmount + size > byteLimit) {
      const error = new ProviderFault('AUDIO_BUFFER_OVERFLOW', this.recovery); this.fail(error); return Promise.reject(error);
    }
    return new Promise<void>((resolve, reject) => {
      this.pendingBytes += size;
      let finished = false;
      const finish = (error?: ProviderFault) => {
        if (finished) return; finished = true; cancel(); this.pending.delete(finish); this.pendingBytes -= size;
        if (error) reject(error); else resolve();
      };
      const cancel = this.deadline(this.cfg.limits.inputQueueMs, () => this.fail(new ProviderFault(this.unavailable, this.recovery)));
      this.pending.add(finish);
      try { this.socket.send(data, error => {
        if (error) this.fail(new ProviderFault(this.unavailable, this.recovery)); else finish();
      }); } catch { this.fail(new ProviderFault(this.unavailable, this.recovery)); }
    });
  }
  json(value: unknown) { return this.send(JSON.stringify(value)); }
  fail(error: ProviderFault) {
    if (!this.active) return;
    this.readyReject?.(error); this.queue.end(this.errorEvent(error.fault)); this.dispose(true, error);
  }
  finish() { if (this.active) { this.queue.end(); this.dispose(false); } }
  private dispose(force: boolean, error = new ProviderFault('VOICE_SESSION_ENDED', 'none', false)) {
    this.active = false; this.signal.removeEventListener('abort', this.abort);
    for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
    for (const reject of this.pending) reject(error);
    if (!this.socket) return;
    if (force) this.socket.terminate(); else {
      const timer = setTimeout(() => this.socket.terminate(), 250); timer.unref();
      this.socket.once('close', () => clearTimeout(timer)); this.socket.close();
    }
  }
}
```

Note: `ws` delivers text as `Buffer` with `isBinary=false`; never infer message kind from `typeof data`. Unknown extra provider fields are tolerated, but consumed fields are bounded and validated. No provider descriptions, raw exceptions, headers, URLs, audio, or text are logged or included in a fault.

- [ ] **Step 5: Implement Nova options and segment mapping.** Create `backend/src/voice/providers/nova-stt.ts`:

```typescript
import { z } from 'zod';
import type { SpeechToTextPort, SpeechInputConnection, SttConnectRequest, SttEvent } from '../../contracts/voice.js';
import { INPUT_AUDIO } from '../../contracts/voice-wire.js';
import type { VoiceConfig } from '../../platform/config/voice-config.js';
import { ProviderLink, ProviderFault, providerUrl, providerText, sameAudio, socketFactory, type SocketFactory } from './provider-link.js';

const resultSchema = z.object({ type: z.literal('Results'), start: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(), channel_index: z.array(z.number().int().nonnegative()).min(1).max(2),
  is_final: z.boolean(), speech_final: z.boolean(), from_finalize: z.boolean().optional(),
  channel: z.object({ alternatives: z.array(z.object({ transcript: providerText })).min(1).max(10) }),
});
export class NovaSttAdapter implements SpeechToTextPort {
  constructor(private readonly cfg: VoiceConfig, private readonly factory: SocketFactory = socketFactory) {}
  async connect(request: SttConnectRequest): Promise<SpeechInputConnection> {
    if (request.mode !== 'dictation' || request.locale !== 'en-US' || !sameAudio(request.audio, INPUT_AUDIO))
      throw new ProviderFault('INVALID_VOICE_REQUEST', 'retry_dictation', false);
    let stopping = false; let stopPromise: Promise<void> | undefined;
    let resolveStop: (() => void) | undefined;
    let cancelDeadline: (() => void) | undefined;
    let audioEnd = 0; let finalEnd = 0; let interim = '';
    let finalStart = -1; let finalId = '';
    const finish = (uncertain: boolean) => {
      if (!link.active) return;
      cancelDeadline?.();
      if (uncertain) link.emit({ type: 'error', fault: { code: 'DICTATION_FINALIZATION_TIMEOUT', recovery: 'retry_dictation', recoverable: true } });
      link.emit({ type: 'finalized', unfinalizedTail: uncertain }); link.finish(); resolveStop?.();
    };
    const link = new ProviderLink<SttEvent>(this.cfg, request.abortSignal, 'STT_UNAVAILABLE', 'retry_dictation',
      131072, event => event.type === 'partial' || event.type === 'final' ? Buffer.byteLength(event.text) : 0,
      fault => ({ type: 'error', fault }), message => {
        if (message instanceof Uint8Array) throw new Error('Unexpected STT audio');
        if (message.type !== 'Results') return;
        const r = resultSchema.parse(message); const text = r.channel.alternatives[0].transcript;
        const segmentId = `${r.channel_index[0]}:${r.start}:${r.duration}`;
        if (r.is_final) {
          if (r.start >= finalStart && segmentId !== finalId) {
            finalStart = r.start; finalId = segmentId;
            finalEnd = Math.max(finalEnd, r.start + r.duration); interim = '';
            if (text) link.emit({ type: 'final', segmentId, text });
          }
        } else if (r.start >= finalEnd) { interim = text; link.emit({ type: 'partial', segmentId, text }); }
        if (stopping && r.from_finalize) finish(false);
      }, this.factory);
    const url = providerUrl(this.cfg, '/v1/listen', { model: this.cfg.deepgram.dictationModel,
      language: request.locale, encoding: 'linear16', sample_rate: '16000', channels: '1',
      interim_results: 'true', punctuate: 'true', smart_format: 'true', endpointing: String(this.cfg.deepgram.endpointingMs) });
    for (const term of this.cfg.deepgram.keyterms) url.searchParams.append('keyterm', term);
    if (this.cfg.deepgram.spokenPunctuation) url.searchParams.set('dictation', 'true');
    await link.start(url);
    return {
      events: link.queue,
      writeAudio: pcm => {
        if (stopping) return Promise.reject(new ProviderFault('VOICE_INVALID_STATE', 'retry_dictation'));
        if (!pcm.byteLength || pcm.byteLength % 2 || pcm.byteLength > 2560)
          return Promise.reject(new ProviderFault('INVALID_AUDIO_FRAME', 'retry_dictation', false));
        audioEnd += pcm.byteLength / 32000;
        return link.send(pcm, this.cfg.limits.inputQueueMs * 32);
      },
      finalize: () => {
        if (stopPromise) return stopPromise;
        if (!link.active) return Promise.reject(new ProviderFault('VOICE_INVALID_STATE', 'retry_dictation'));
        stopping = true;
        stopPromise = new Promise<void>((resolve, reject) => {
          resolveStop = resolve;
          cancelDeadline = link.deadline(Math.min(2000, this.cfg.limits.finalizationMs), () => finish(Boolean(interim) || audioEnd > finalEnd));
          // ws preserves the order of earlier audio sends and this Finalize control.
          void link.json({ type: 'Finalize' }).catch(reject);
        });
        return stopPromise;
      },
      close: async () => { cancelDeadline?.(); link.finish(); resolveStop?.(); },
    };
  }
}
```

- [ ] **Step 6: Run GREEN.** `npm test -- test/voice/providers/nova-stt.spec.ts` — all four tests pass, with no real socket. Then `npm run build` and `npm run lint`; repair only P3 files. Task 4 strengthens drain failure settlement and keepalive before P3 is complete.
- [ ] **Step 7: Commit the completed slice (root).**

```powershell
git add backend/src/voice/providers/provider-link.ts backend/src/voice/providers/nova-stt.ts backend/test/fixtures/deepgram/socket.ts backend/test/voice/providers/nova-stt.spec.ts
git commit -m "feat(voice): add Nova dictation provider and bounded drain"
```

## Task 2: Flux Conversational STT Adapter

**Files:** Create `backend/src/voice/providers/flux-stt.ts`, `backend/test/voice/providers/flux-stt.spec.ts`. Reuse Task 1's socket helper and link; do not implement another connection queue.

- [ ] **Step 1: Write exact failing tests.** Create `backend/test/voice/providers/flux-stt.spec.ts`:

```typescript
import { expect, it } from 'vitest';
import { FluxSttAdapter } from '../../../src/voice/providers/flux-stt.js';
import type { SttEvent } from '../../../src/contracts/voice.js';
import { config, input, harness, collect, tick, connected, turn } from '../../fixtures/deepgram/socket.js';

it('sends exact 80ms PCM16 frames and only completed turns can trigger the bridge', async () => {
  const h = harness(connected); const c = await new FluxSttAdapter(config(), h.factory).connect(input('live'));
  const events: SttEvent[] = []; const done = collect(c.events, events); const s = h.sockets[0];
  const pcm = new Uint8Array(2560); pcm[0] = 0x34; pcm[1] = 0x12; await c.writeAudio(pcm);
  expect(s.sent[0]).toEqual(pcm);
  for (const bytes of [0, 1, 2558, 2562])
    await expect(c.writeAudio(new Uint8Array(bytes))).rejects.toMatchObject({ fault: { code: 'INVALID_AUDIO_FRAME' } });
  s.json(turn('StartOfTurn', 1)); s.json(turn('Update', 2, 'what is'));
  s.json(turn('EagerEndOfTurn', 3, 'what is')); s.json(turn('TurnResumed', 4, 'what is next'));
  await tick(); expect(events.filter(e => e.type === 'end-of-turn')).toEqual([]);
  s.json(turn('EndOfTurn', 5, 'What is next?')); s.json(turn('EndOfTurn', 5, 'What is next?'));
  s.json(turn('EndOfTurn', 6, 'What is next?')); await tick();
  expect(events.filter(e => e.type === 'start-of-turn')).toEqual([{ type: 'start-of-turn', providerTurnId: 'fixture-request:0' }]);
  expect(events.filter(e => e.type === 'end-of-turn')).toEqual([{ type: 'end-of-turn', providerTurnId: 'fixture-request:0', text: 'What is next?' }]);
  const u = h.requests[0].url;
  expect(u.pathname).toBe('/v2/listen');
  expect(Object.fromEntries(u.searchParams)).toEqual({ model: 'flux-general-en', encoding: 'linear16', sample_rate: '16000', eot_threshold: '0.8', eot_timeout_ms: '5000' });
  await c.close(); await done;
});

it('ForceEndTurn is explicit; CloseStream never promotes trailing Update', async () => {
  const h = harness(connected); const c = await new FluxSttAdapter(config(), h.factory).connect(input('live'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  await c.finalize(); expect(h.sockets[0].controls()).toContainEqual({ type: 'ForceEndTurn' });
  h.sockets[0].json(turn('EndOfTurn', 1, '')); await c.close();
  expect(h.sockets[0].controls()).toContainEqual({ type: 'CloseStream' });
  h.sockets[0].json(turn('Update', 2, 'incomplete tail')); await done;
  expect(events.some(e => e.type === 'end-of-turn')).toBe(false);
});
```

- [ ] **Step 2: Run RED.** `npm test -- test/voice/providers/flux-stt.spec.ts` — missing adapter import. Then use each test's full name with `-t` for focused red/green cycles.
- [ ] **Step 3: Implement options and ordered turn translation.** Create `backend/src/voice/providers/flux-stt.ts`:

```typescript
import { z } from 'zod';
import type { SpeechToTextPort, SpeechInputConnection, SttConnectRequest, SttEvent } from '../../contracts/voice.js';
import { INPUT_AUDIO } from '../../contracts/voice-wire.js';
import type { VoiceConfig } from '../../platform/config/voice-config.js';
import { ProviderLink, ProviderFault, providerUrl, providerText, providerId, uint, sameAudio, socketFactory, type SocketFactory } from './provider-link.js';

const turnSchema = z.object({ type: z.literal('TurnInfo'), request_id: providerId,
  sequence_id: uint, turn_index: uint, event: z.string().max(64), transcript: providerText,
  audio_window_end: z.number().finite().nonnegative() });
export class FluxSttAdapter implements SpeechToTextPort {
  constructor(private readonly cfg: VoiceConfig, private readonly factory: SocketFactory = socketFactory) {}
  async connect(request: SttConnectRequest): Promise<SpeechInputConnection> {
    if (request.mode !== 'live' || request.locale !== 'en-US' || !sameAudio(request.audio, INPUT_AUDIO))
      throw new ProviderFault('INVALID_VOICE_REQUEST', 'repeat_turn', false);
    let sequence = -1; let endedTurn = -1; let startedTurn = -1; let closing = false;
    const link = new ProviderLink<SttEvent>(this.cfg, request.abortSignal, 'STT_UNAVAILABLE', 'repeat_turn',
      131072, e => e.type === 'partial' || e.type === 'final' || e.type === 'end-of-turn' ? Buffer.byteLength(e.text) : 0,
      fault => ({ type: 'error', fault }), message => {
        if (message instanceof Uint8Array) throw new Error('Unexpected STT audio');
        if (message.sequence_id !== undefined) {
          const next = uint.parse(message.sequence_id); if (next <= sequence) return; sequence = next;
        }
        if (message.type !== 'TurnInfo' || closing) return;
        const r = turnSchema.parse(message);
        if (r.turn_index <= endedTurn) return;
        const providerTurnId = `${r.request_id}:${r.turn_index}`;
        if (r.event === 'StartOfTurn' && r.turn_index > startedTurn) {
          startedTurn = r.turn_index; link.emit({ type: 'start-of-turn', providerTurnId });
        } else if (r.event === 'Update') {
          link.emit({ type: 'partial', segmentId: providerTurnId, text: r.transcript });
        } else if (r.event === 'EndOfTurn') {
          endedTurn = r.turn_index;
          if (r.transcript.trim()) link.emit({ type: 'end-of-turn', providerTurnId, text: r.transcript });
        }
        // EagerEndOfTurn and TurnResumed never authorize execution in this baseline.
      }, this.factory);
    await link.start(providerUrl(this.cfg, '/v2/listen', { model: this.cfg.deepgram.liveModel,
      encoding: 'linear16', sample_rate: '16000', eot_threshold: String(this.cfg.deepgram.eotThreshold),
      eot_timeout_ms: String(this.cfg.deepgram.eotTimeoutMs) }), true);
    return { events: link.queue,
      writeAudio: pcm => {
        if (closing || pcm.byteLength !== 2560) return Promise.reject(new ProviderFault('INVALID_AUDIO_FRAME', 'repeat_turn', false));
        return link.send(pcm, this.cfg.limits.inputQueueMs * 32);
      },
      finalize: () => link.json({ type: 'ForceEndTurn' }),
      close: async () => { if (!link.active || closing) return; closing = true;
        try { await link.json({ type: 'CloseStream' }); } finally { link.finish(); } },
    };
  }
}
```

- [ ] **Step 4: Run GREEN and verification.** `npm test -- test/voice/providers/flux-stt.spec.ts`, then `npm test -- test/voice/providers/nova-stt.spec.ts`, then `npm run build` and `npm run lint`. Both Flux tests must be discovered and pass.
- [ ] **Step 5: Commit (root).**

```powershell
git add backend/src/voice/providers/flux-stt.ts backend/test/voice/providers/flux-stt.spec.ts
git commit -m "feat(voice): add Flux conversational recognition adapter"
```

## Task 3: Flux Conversational TTS Adapter

**Files:** Create `backend/src/voice/providers/flux-tts.ts`, `backend/test/voice/providers/flux-tts.spec.ts`.

### 3A. Speak, Flush, audio and completion

- [ ] **Step 1: Write the failing tests.** Create `backend/test/voice/providers/flux-tts.spec.ts`:

```typescript
import { afterEach, expect, it, vi } from 'vitest';
import { FluxTtsAdapter } from '../../../src/voice/providers/flux-tts.js';
import type { TtsEvent } from '../../../src/contracts/voice.js';
import { config, output, harness, collect, tick, connected, metadata } from '../../fixtures/deepgram/socket.js';
afterEach(() => vi.useRealTimers());
const response = { turnId: 'turn-1', responseId: 'response-1' };

it.each(['flux-haley-en', 'flux-alexis-en', 'flux-priya-en'] as const)(
  'streams %s raw PCM24k, preserves whitespace and waits for SpeechMetadata', async model => {
    const h = harness({ ...connected, model_name: model }); const cfg = config(); cfg.deepgram.ttsModel = model;
    const c = await new FluxTtsAdapter(cfg, h.factory).connect(output());
    const events: TtsEvent[] = []; const done = collect(c.events, events); const s = h.sockets[0];
    await c.speak({ ...response, text: 'Hello' }); await c.speak({ ...response, text: ' world.' });
    expect(s.controls()).toEqual([{ type: 'Speak', text: 'Hello' }, { type: 'Speak', text: ' world.' }]);
    s.json({ type: 'SpeechStarted', speech_id: metadata().speech_id }); s.binary(new Uint8Array(4800));
    await c.flush(response); s.json({ type: 'Flushed', speech_id: metadata().speech_id }); await tick();
    expect(events.some(e => e.type === 'speech-completed')).toBe(false);
    await expect(c.speak({ turnId: 'turn-2', responseId: 'response-2', text: 'Too early' })).rejects.toMatchObject({ fault: { code: 'VOICE_INVALID_STATE' } });
    s.json({ type: 'SpeechMetadata', ...metadata() }); await tick();
    expect(events.filter(e => e.type === 'audio')).toEqual([{ type: 'audio', ...response, pcm: new Uint8Array(4800) }]);
    expect(events.filter(e => e.type === 'speech-completed')).toMatchObject([{ ...response, audioDurationMs: 100,
      usage: { model, modelVersion: 'fixture-2026-10-08', billableCharacters: 12 } }]);
    expect(h.requests[0].url.pathname).toBe('/v2/speak');
    expect(Object.fromEntries(h.requests[0].url.searchParams)).toEqual({ model, encoding: 'linear16', sample_rate: '24000' });
    await c.close(); await done;
  });

it('invalidates queued and late audio and reconciles socket offset to response duration', async () => {
  const h = harness(connected); const c = await new FluxTtsAdapter(config(), h.factory).connect(output()); const s = h.sockets[0];
  await c.speak({ ...response, text: 'First.' }); s.json({ type: 'SpeechStarted', speech_id: 'dg_sp_000000000001' });
  s.binary(new Uint8Array(4800)); await c.flush(response); s.json({ type: 'SpeechMetadata', ...metadata('dg_sp_000000000001', 100, 6) });
  const second = { turnId: 'turn-2', responseId: 'response-2' };
  await c.speak({ ...second, text: 'Hello world.' }); s.json({ type: 'SpeechStarted', speech_id: 'dg_sp_000000000002' });
  s.binary(new Uint8Array(4800));
  await expect(c.interrupt({ ...second, providerSocketId: 'wrong-socket', playbackPositionMs: 150 })).rejects.toMatchObject({ fault: { code: 'VOICE_BINDING_MISMATCH' } });
  await c.interrupt({ ...second, providerSocketId: c.providerSocketId, playbackPositionMs: 150 });
  await c.interrupt({ ...second, providerSocketId: c.providerSocketId, playbackPositionMs: 150 });
  s.binary(new Uint8Array(480));
  s.json({ type: 'SpeechInterrupted', audio_played_ms: 150, text_spoken: 'Hello', text_remaining: ' world.', metadata: metadata('dg_sp_000000000002', 50) });
  const events: TtsEvent[] = []; const done = collect(c.events, events); await tick(); await c.close(); await done;
  expect(s.controls().filter((m: unknown) => (m as { type: string }).type === 'Interrupt')).toEqual([
    { type: 'Interrupt', playback_offset: { type: 'time_ms', value: 150 } },
  ]);
  expect(events.filter(e => e.type === 'audio').map(e => e.responseId)).toEqual(['response-1']);
  expect(events.filter(e => e.type === 'speech-interrupted')).toMatchObject([{ ...second,
    audioPlayedMs: 50, textSpoken: 'Hello', textRemaining: ' world.' }]);
});

it('never fabricates an advancing offset; missing reconciliation remains unknown', async () => {
  const h = harness(connected); const c = await new FluxTtsAdapter(config(), h.factory).connect(output()); const s = h.sockets[0];
  const events: TtsEvent[] = []; const done = collect(c.events, events);
  await c.speak({ ...response, text: 'Hello world.' }); s.json({ type: 'SpeechStarted', speech_id: metadata().speech_id }); s.binary(new Uint8Array(4800));
  await c.interrupt({ ...response, providerSocketId: c.providerSocketId, playbackPositionMs: 50 });
  s.json({ type: 'SpeechInterrupted', audio_played_ms: 50, metadata: metadata() }); await tick();
  expect(events.filter(e => e.type === 'speech-interrupted')).toMatchObject([{ audioPlayedMs: null, textSpoken: null, textRemaining: null }]);
  const next = { turnId: 'turn-2', responseId: 'response-2' };
  await c.speak({ ...next, text: 'Unheard.' }); s.json({ type: 'SpeechStarted', speech_id: 'dg_sp_000000000002' });
  await c.interrupt({ ...next, providerSocketId: c.providerSocketId, playbackPositionMs: 50 }); await done;
  expect(s.controls().filter((m: unknown) => (m as { type: string }).type === 'Interrupt')).toHaveLength(1);
  expect(events).toContainEqual({ type: 'error', fault: { code: 'VOICE_DELIVERY_UNKNOWN', recovery: 'return_to_chat', recoverable: true } });
  const h2 = harness(connected); const fresh = await new FluxTtsAdapter(config(), h2.factory).connect(output());
  expect(fresh.providerSocketId).not.toBe(c.providerSocketId);
  await fresh.speak({ ...response, text: 'Fresh.' }); h2.sockets[0].json({ type: 'SpeechStarted', speech_id: metadata().speech_id }); h2.sockets[0].binary(new Uint8Array(4800));
  await fresh.interrupt({ ...response, providerSocketId: fresh.providerSocketId, playbackPositionMs: 25 });
  expect(h2.sockets[0].controls()).toContainEqual({ type: 'Interrupt', playback_offset: { type: 'time_ms', value: 25 } });
  await fresh.close();
});

it('interrupt timeout invalidates speech before acknowledgement without assuming delivery', async () => {
  vi.useFakeTimers(); const h = harness(connected);
  const pending = new FluxTtsAdapter(config(), h.factory).connect(output()); await vi.advanceTimersByTimeAsync(0); const c = await pending;
  const events: TtsEvent[] = []; const done = collect(c.events, events);
  await c.speak({ ...response, text: 'Hello world.' }); h.sockets[0].json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  h.sockets[0].binary(new Uint8Array(4800)); await c.interrupt({ ...response, providerSocketId: c.providerSocketId, playbackPositionMs: 50 });
  h.sockets[0].binary(new Uint8Array(480)); await vi.advanceTimersByTimeAsync(2000); await done;
  expect(events.filter(e => e.type === 'speech-interrupted')).toMatchObject([{ audioPlayedMs: null, textSpoken: null, textRemaining: null }]);
  expect(events.filter(e => e.type === 'audio')).toHaveLength(0);
});
```

- [ ] **Step 2: Run RED.** `npm test -- test/voice/providers/flux-tts.spec.ts` — missing adapter import. Run individual tests with `-t` before implementing their branches.

- [ ] **Step 3: Implement response state and schemas.** Create `backend/src/voice/providers/flux-tts.ts` with the following complete baseline. Write schemas/state, message translation, and returned commands as separate small actions:

```typescript
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SpeechSynthesisPort, SpeechOutputConnection, TtsEvent, SpeechUsage } from '../../contracts/voice.js';
import { OUTPUT_AUDIO } from '../../contracts/voice-wire.js';
import type { VoiceConfig } from '../../platform/config/voice-config.js';
import { ProviderLink, ProviderFault, providerUrl, providerText, providerId, uint, sameAudio, socketFactory, type SocketFactory } from './provider-link.js';

const metaSchema = z.object({ speech_id: providerId, audio_duration_ms: uint, billable_character_count: uint });
type Active = { turnId: string; responseId: string; text: string; speechId: string | null;
  baseMs: number; bytes: number; flushed: boolean; interrupted: boolean; offset: number | null };
export class FluxTtsAdapter implements SpeechSynthesisPort {
  constructor(private readonly cfg: VoiceConfig, private readonly factory: SocketFactory = socketFactory) {}
  async connect(request: Parameters<SpeechSynthesisPort['connect']>[0]): Promise<SpeechOutputConnection> {
    if (!sameAudio(request.audio, OUTPUT_AUDIO)) throw new ProviderFault('INVALID_VOICE_REQUEST', 'return_to_chat', false);
    const providerSocketId = randomUUID();
    let active: Active | undefined; let completedMs = 0; let lastInterrupt = -1;
    let lastInvalidated: string | undefined; let lastCompleted: string | undefined;
    let cancelInterrupt: (() => void) | undefined;
    let cancelCompletion: (() => void) | undefined;
    let requestId: string | null = null; let version: string | null = null;
    const usage = (duration: number | null = null, chars: number | null = null): SpeechUsage => ({
      providerRequestId: requestId, model: this.cfg.deepgram.ttsModel, modelVersion: version,
      audioMs: duration, billableCharacters: chars,
    });
    const unknown = () => {
      if (active) {
        link.queue.discard(e => e.type === 'audio' && e.responseId === active!.responseId);
        link.emit({ type: 'speech-interrupted', turnId: active.turnId, responseId: active.responseId,
          speechId: active.speechId, audioPlayedMs: null, textSpoken: null, textRemaining: null, usage: usage() });
        lastInvalidated = active.responseId; active = undefined;
      }
      link.fail(new ProviderFault('VOICE_DELIVERY_UNKNOWN'));
    };
    const requireResponse = (command: { turnId: string; responseId: string }) => {
      if (!link.active || !active || active.turnId !== command.turnId || active.responseId !== command.responseId)
        throw new ProviderFault('VOICE_INVALID_STATE');
      return active;
    };
    const link = new ProviderLink<TtsEvent>(this.cfg, request.abortSignal, 'TTS_UNAVAILABLE', 'return_to_chat',
      this.cfg.limits.outputQueueMs * 48, e => e.type === 'audio' ? e.pcm.byteLength : 0,
      fault => ({ type: 'error', fault }), message => {
        if (message instanceof Uint8Array) {
          if (!active || active.interrupted) return;
          if (!active.speechId || !message.byteLength || message.byteLength % 2) throw new Error('Invalid PCM ordering');
          active.bytes += message.byteLength;
          link.emit({ type: 'audio', turnId: active.turnId, responseId: active.responseId, pcm: Uint8Array.from(message) }); return;
        }
        if (message.type === 'Connected') {
          requestId = providerId.parse(message.request_id); version = providerId.parse(message.model_version);
          if (message.model_name !== this.cfg.deepgram.ttsModel) throw new Error('Wrong model'); return;
        }
        if (!active) return;
        if (message.type === 'SpeechStarted') {
          const id = providerId.parse(message.speech_id);
          if (active.speechId === id) return;
          if (active.speechId) throw new Error('Overlapping speech');
          active.speechId = id;
          if (!active.interrupted) link.emit({ type: 'speech-started', turnId: active.turnId, responseId: active.responseId, speechId: id });
        } else if (message.type === 'SpeechMetadata') {
          const m = metaSchema.parse(message);
          if (m.speech_id !== active.speechId || active.interrupted) return;
          if (!active.flushed) throw new Error('Premature completion');
          cancelCompletion?.();
          link.emit({ type: 'speech-completed', turnId: active.turnId, responseId: active.responseId,
            speechId: m.speech_id, audioDurationMs: m.audio_duration_ms,
            usage: usage(m.audio_duration_ms, m.billable_character_count) });
          completedMs = active.baseMs + m.audio_duration_ms; lastCompleted = active.responseId; active = undefined;
        } else if (message.type === 'SpeechInterrupted') {
          if (!active.interrupted) return;
          const m = metaSchema.parse(message.metadata);
          if (active.speechId !== null && m.speech_id !== active.speechId) return;
          cancelInterrupt?.(); cancelCompletion?.();
          const offset = uint.parse(message.audio_played_ms);
          const spoken = providerText.safeParse(message.text_spoken); const remaining = providerText.safeParse(message.text_remaining);
          const valid = active.offset === offset && spoken.success && remaining.success &&
            spoken.data + remaining.data === active.text && active.text.startsWith(spoken.data) &&
            offset >= active.baseMs && offset - active.baseMs <= Math.ceil(active.bytes / 48);
          link.emit({ type: 'speech-interrupted', turnId: active.turnId, responseId: active.responseId,
            speechId: m.speech_id, audioPlayedMs: valid ? offset - active.baseMs : null,
            textSpoken: valid ? spoken.data : null, textRemaining: valid ? remaining.data : null,
            usage: usage(m.audio_duration_ms, m.billable_character_count) });
          // The provider rebases cumulative audio at an interrupt; discarded generated audio is not counted.
          completedMs = offset; lastInterrupt = Math.max(lastInterrupt, offset);
          lastInvalidated = active.responseId; active = undefined;
        } else if (message.type === 'Warning' && active.interrupted &&
          ['INVALID_INTERRUPT_OFFSET', 'NO_AUDIO_GENERATED', 'INTERRUPT_IN_PROGRESS'].includes(String(message.code))) unknown();
        // Flushed and non-fatal informational warnings do not mean completion.
      }, this.factory);
    await link.start(providerUrl(this.cfg, '/v2/speak', { model: this.cfg.deepgram.ttsModel,
      encoding: 'linear16', sample_rate: '24000' }), true);
    return { providerSocketId, events: link.queue,
      speak: async command => {
        providerId.parse(command.turnId); providerId.parse(command.responseId); providerText.parse(command.text);
        if (!link.active || command.responseId === lastInvalidated || command.responseId === lastCompleted) throw new ProviderFault('VOICE_INVALID_STATE');
        if (!command.text) return;
        if (!active) active = { turnId: command.turnId, responseId: command.responseId, text: '', speechId: null,
          baseMs: completedMs, bytes: 0, flushed: false, interrupted: false, offset: null };
        const r = requireResponse(command);
        if (r.flushed || r.interrupted || r.text.length + command.text.length > 32000) throw new ProviderFault('VOICE_INVALID_STATE');
        r.text += command.text;
        // Preserve chunks verbatim: adding spaces here would corrupt token splits such as "Al" + "fred".
        await link.json({ type: 'Speak', text: command.text });
      },
      flush: async command => {
        const r = requireResponse(command); if (r.flushed || r.interrupted) return; r.flushed = true;
        cancelCompletion = link.deadline(30000, unknown);
        await link.json({ type: 'Flush' });
      },
      interrupt: async command => {
        if (command.providerSocketId !== providerSocketId) throw new ProviderFault('VOICE_BINDING_MISMATCH');
        if (command.responseId === lastInvalidated) return;
        const r = requireResponse(command); if (r.interrupted) return;
        const offset = uint.safeParse(command.playbackPositionMs);
        if (!offset.success || offset.data < r.baseMs || offset.data > r.baseMs + Math.ceil(r.bytes / 48))
          throw new ProviderFault('INVALID_VOICE_CONTROL', 'return_to_chat', false);
        r.interrupted = true; lastInvalidated = r.responseId;
        link.queue.discard(e => e.type === 'audio' && e.responseId === r.responseId);
        cancelCompletion?.();
        if (offset.data <= lastInterrupt) { unknown(); return; }
        r.offset = offset.data; lastInterrupt = offset.data;
        cancelInterrupt = link.deadline(Math.min(2000, this.cfg.limits.finalizationMs), unknown);
        await link.json({ type: 'Interrupt', playback_offset: { type: 'time_ms', value: offset.data } });
      },
      close: async () => {
        if (!link.active) return;
        cancelInterrupt?.(); cancelCompletion?.();
        if (active) { unknown(); return; }
        try { await link.json({ type: 'Close' }); } finally { link.finish(); }
      },
    };
  }
}
```

The two bounds are different: received audio limits plausibility of a playback report; **only** browser/P4 consumed samples authorize the report. P5 validates session/epoch/response and P6 passes the socket-wide coordinate. This adapter never equates received samples, synthesis completion, or provider generated totals with heard content. P4/P6 must account for completed responses and for rebasing after an interrupt; the socket offset is not wall-clock time or accumulated discarded audio.

- [ ] **Step 4: Run GREEN.** `npm test -- test/voice/providers/flux-tts.spec.ts` — six discovered cases (three voices plus three interruption cases) pass. Run `npm test -- test/voice/providers`, `npm run build`, and `npm run lint`. Task 4 adds first-output/dead-socket settlement before release.
- [ ] **Step 5: Commit (root).**

```powershell
git add backend/src/voice/providers/flux-tts.ts backend/test/voice/providers/flux-tts.spec.ts
git commit -m "feat(voice): add Flux speech synthesis and interruption reconciliation"
```

## Task 4: Speech Provider Resilience & Mock Fixtures

**Files:** Modify the four existing P3 source files; create `backend/src/voice/providers/connect-backoff.ts`, `backend/test/voice/providers/resilience.spec.ts`, and the three JSON fixtures plus fixture README from the file map. No shared manifest edits.

### 4A. Failure settlement, heartbeat and finite queues

- [ ] **Step 1: Write the exact failing regressions.** Create `backend/test/voice/providers/resilience.spec.ts`:

```typescript
import { afterEach, expect, it, vi } from 'vitest';
import { NovaSttAdapter } from '../../../src/voice/providers/nova-stt.js';
import { FluxSttAdapter } from '../../../src/voice/providers/flux-stt.js';
import { FluxTtsAdapter } from '../../../src/voice/providers/flux-tts.js';
import { connectWithBackoff } from '../../../src/voice/providers/connect-backoff.js';
import type { SttEvent, TtsEvent } from '../../../src/contracts/voice.js';
import { ProviderFault } from '../../../src/voice/providers/provider-link.js';
import { config, input, output, harness, collect, connected, metadata, novaResult, tick } from '../../fixtures/deepgram/socket.js';
afterEach(() => vi.useRealTimers());
const r = { turnId: 'turn-1', responseId: 'response-1' };

it('rejects a pending Nova finalization on a dead socket without losing finals', async () => {
  const h = harness(); const c = await new NovaSttAdapter(config(), h.factory).connect(input('dictation'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  h.sockets[0].json(novaResult('Keep.', true));
  const stopping = c.finalize(); const rejection = expect(stopping).rejects.toMatchObject({ fault: { code: 'STT_UNAVAILABLE' } });
  await tick(); h.sockets[0].emit('error', new Error('private provider description test-secret-not-real'));
  await rejection; await done;
  expect(events.filter(e => e.type === 'final')).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain('private provider');
  expect(JSON.stringify(events)).not.toContain('test-secret');
});

it('settles blocked writes within the input queue deadline and sends no replay', async () => {
  vi.useFakeTimers(); const h = harness(connected);
  const pending = new FluxSttAdapter(config(), h.factory).connect(input('live')); await vi.advanceTimersByTimeAsync(0); const c = await pending;
  h.sockets[0].holdSends = true; const write = c.writeAudio(new Uint8Array(2560));
  const rejection = expect(write).rejects.toMatchObject({ fault: { code: 'STT_UNAVAILABLE' } });
  await vi.advanceTimersByTimeAsync(1000); await rejection;
  expect(h.sockets).toHaveLength(1); expect(h.sockets[0].terminated).toBe(true);
  h.sockets[0].callbacks[0](); await c.close();
});

it('rejects a >1s input queue and a >2s output queue rather than dropping commands', async () => {
  const h = harness(connected); const c = await new FluxSttAdapter(config(), h.factory).connect(input('live'));
  h.sockets[0].bufferedAmount = 32000;
  await expect(c.writeAudio(new Uint8Array(2560))).rejects.toMatchObject({ fault: { code: 'AUDIO_BUFFER_OVERFLOW' } });
  const h2 = harness(connected); const tts = await new FluxTtsAdapter(config(), h2.factory).connect(output());
  await tts.speak({ ...r, text: 'Hello.' }); h2.sockets[0].json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  h2.sockets[0].binary(new Uint8Array(96000)); h2.sockets[0].binary(new Uint8Array(2));
  const events: TtsEvent[] = []; await collect(tts.events, events);
  expect(events).toContainEqual({ type: 'error', fault: { code: 'AUDIO_BUFFER_OVERFLOW', recovery: 'return_to_chat', recoverable: true } });
  expect(h2.sockets[0].terminated).toBe(true);
});

it('aborts connection immediately and cannot leave timers or orphan sockets', async () => {
  vi.useFakeTimers(); const abort = new AbortController(); const h = harness();
  const cPromise = new FluxSttAdapter(config(), h.factory).connect(input('live', abort.signal));
  const rejection = expect(cPromise).rejects.toMatchObject({ fault: { code: 'VOICE_SESSION_ENDED' } });
  abort.abort(); await rejection; await vi.advanceTimersByTimeAsync(0);
  expect(h.sockets[0].terminated).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

it('bounds a missing Connected handshake and redacts HTTP rate-limit failures', async () => {
  vi.useFakeTimers(); const h = harness();
  const p = new FluxTtsAdapter(config(), h.factory).connect(output());
  const rejected = expect(p).rejects.toMatchObject({ fault: { code: 'VOICE_CONNECT_TIMEOUT' } });
  await vi.advanceTimersByTimeAsync(10000); await rejected; expect(vi.getTimerCount()).toBe(0);
  const h2 = harness(); const p2 = new NovaSttAdapter(config(), h2.factory).connect(input('dictation'));
  const rejected2 = expect(p2).rejects.toMatchObject({ fault: { code: 'VOICE_PROVIDER_RATE_LIMITED' } });
  h2.sockets[0].emit('unexpected-response', {}, { statusCode: 429, resume() {} }); await rejected2;
});

it('keeps Nova alive with JSON but Flux TTS with ping, and detects dead pong', async () => {
  vi.useFakeTimers(); const h = harness(); const p = new NovaSttAdapter(config(), h.factory).connect(input('dictation'));
  await vi.advanceTimersByTimeAsync(0); const nova = await p;
  await vi.advanceTimersByTimeAsync(4000); expect(h.sockets[0].controls()).toContainEqual({ type: 'KeepAlive' }); await nova.close();
  const h2 = harness(connected); const p2 = new FluxTtsAdapter(config(), h2.factory).connect(output());
  await vi.advanceTimersByTimeAsync(0); const tts = await p2;
  h2.sockets[0].ping = () => { h2.sockets[0].pings++; };
  await vi.advanceTimersByTimeAsync(20000); expect(h2.sockets[0].pings).toBe(1);
  await vi.advanceTimersByTimeAsync(5000); expect(h2.sockets[0].terminated).toBe(true);
  expect(vi.getTimerCount()).toBe(0); await tts.close();
});

it('reports unknown delivery when an established TTS socket dies', async () => {
  const h = harness(connected); const c = await new FluxTtsAdapter(config(), h.factory).connect(output());
  const events: TtsEvent[] = []; const done = collect(c.events, events);
  await c.speak({ ...r, text: 'Hello.' }); h.sockets[0].json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  h.sockets[0].emit('error', new Error('secret')); await done;
  expect(events.filter(e => e.type === 'speech-interrupted')).toMatchObject([{ ...r, audioPlayedMs: null, textSpoken: null, textRemaining: null }]);
  expect(h.sockets).toHaveLength(1);
});

it('bounds first synthesis audio after Speak even without Flush', async () => {
  vi.useFakeTimers(); const h = harness(connected); const p = new FluxTtsAdapter(config(), h.factory).connect(output());
  await vi.advanceTimersByTimeAsync(0); const c = await p;
  const events: TtsEvent[] = []; const done = collect(c.events, events);
  await c.speak({ ...r, text: 'Hello.' }); await vi.advanceTimersByTimeAsync(30000); await done;
  expect(events.filter(e => e.type === 'speech-interrupted')).toHaveLength(1); expect(h.sockets[0].terminated).toBe(true);
});

it('fresh live connects back off with jitter, terminate at 10s, and never retry fatal rejection', async () => {
  vi.useFakeTimers(); const controller = new AbortController();
  const operation = vi.fn().mockRejectedValueOnce(new ProviderFault('STT_UNAVAILABLE', 'repeat_turn')).mockResolvedValue('fresh');
  const p = connectWithBackoff(operation, { signal: controller.signal, deadlineMs: 10000, random: () => 0 });
  await vi.advanceTimersByTimeAsync(249); expect(operation).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(await p).toBe('fresh');
  const fatal = vi.fn().mockRejectedValue(new ProviderFault('INVALID_VOICE_REQUEST', 'none', false));
  await expect(connectWithBackoff(fatal, { signal: controller.signal, deadlineMs: 10000 })).rejects.toMatchObject({ fault: { code: 'INVALID_VOICE_REQUEST' } });
  expect(fatal).toHaveBeenCalledTimes(1);
  const never = connectWithBackoff(() => new Promise<string>(() => {}), { signal: controller.signal, deadlineMs: 10000 });
  const rejected = expect(never).rejects.toMatchObject({ fault: { code: 'VOICE_RECONNECT_TIMEOUT' } });
  await vi.advanceTimersByTimeAsync(10000); await rejected; expect(vi.getTimerCount()).toBe(0);
});

it('keeps a successful backoff socket alive until parent cancellation', async () => {
  const controller = new AbortController(); const h = harness(connected);
  const c = await connectWithBackoff(signal => new FluxSttAdapter(config(), h.factory).connect(input('live', signal)),
    { signal: controller.signal, deadlineMs: 10000 });
  expect(h.sockets[0].readyState).toBe(1);
  const events: SttEvent[] = []; const done = collect(c.events, events);
  controller.abort(); await done; expect(h.sockets[0].terminated).toBe(true);
});
```

- [ ] **Step 2: Run RED.** `npm test -- test/voice/providers/resilience.spec.ts` initially fails the missing `connect-backoff.js` import. Add the retry helper in 4B, then run each name with `-t` to prove the dead-finalize, heartbeat, dead-TTS and first-audio failures before the corresponding patches.

- [ ] **Step 3: Add terminal hooks to `ProviderLink`.** In `backend/src/voice/providers/provider-link.ts`, add these fields immediately after `active = true`:

```typescript
  onFailure: ((error: ProviderFault) => void) | undefined;
  onFinish: (() => void) | undefined;
```

Replace `fail()` and `finish()` completely with:

```typescript
  fail(error: ProviderFault) {
    if (!this.active) return;
    this.onFailure?.(error);
    this.readyReject?.(error); this.queue.end(this.errorEvent(error.fault)); this.dispose(true, error);
  }
  finish() {
    if (this.active) { this.onFinish?.(); this.queue.end(); this.dispose(false); }
  }
```

Add this method before `send()`:

```typescript
  heartbeat(kind: 'nova' | 'ping') {
    let waitingPong = false;
    let cancelPong: (() => void) | undefined;
    this.socket.on('pong', () => { waitingPong = false; cancelPong?.(); });
    const pulse = () => {
      if (!this.active) return;
      if (kind === 'nova') {
        void this.json({ type: 'KeepAlive' }).catch(() => {});
      } else {
        waitingPong = true;
        cancelPong = this.deadline(5000, () => {
          if (waitingPong) this.fail(new ProviderFault(this.unavailable, this.recovery));
        });
        try { this.socket.ping(); } catch { this.fail(new ProviderFault(this.unavailable, this.recovery)); }
      }
      if (this.active) this.deadline(kind === 'nova' ? 4000 : 20000, pulse);
    };
    this.deadline(kind === 'nova' ? 4000 : 20000, pulse);
  }
```

Install the heartbeat **after** successful `start()` in each adapter: `link.heartbeat('nova')` for Nova; `link.heartbeat('ping')` for both Flux adapters. All heartbeat/pong timers share link disposal. Stopping Nova suppresses further heartbeat by finishing the link; no muted audio is synthesized or transmitted by the heartbeat.

- [ ] **Step 4: Settle Nova Stop on asynchronous failure.** In `backend/src/voice/providers/nova-stt.ts`, add `let rejectStop: ((error: ProviderFault) => void) | undefined;` next to `resolveStop`. Inside the `new Promise<void>((resolve, reject) => ...)` finalization executor, after `resolveStop = resolve`, add `rejectStop = reject`. Before `await link.start(url)`, add:

```typescript
    link.onFailure = error => { cancelDeadline?.(); rejectStop?.(error); };
    link.onFinish = () => { cancelDeadline?.(); resolveStop?.(); };
```

This fixes the shared terminal path once; no per-error polling, no dangling finalize promise after failure/abort. Keep the four Task 1 tests green.

- [ ] **Step 5: Make TTS failure evidence explicit and bound first output.** In `backend/src/voice/providers/flux-tts.ts`, add `let cancelFirstAudio: (() => void) | undefined;` beside the other deadline cancellations. Extract the body that publishes unknown evidence from `unknown()` into a helper; replace `unknown()` with these exact definitions:

```typescript
    const publishUnknown = () => {
      cancelFirstAudio?.(); cancelCompletion?.(); cancelInterrupt?.();
      if (!active) return;
      const r = active;
      link.queue.discard(e => e.type === 'audio' && e.responseId === r.responseId);
      // A terminal fault must retain evidence even when the normal queue is full.
      const event: TtsEvent = { type: 'speech-interrupted', turnId: r.turnId, responseId: r.responseId,
        speechId: r.speechId, audioPlayedMs: null, textSpoken: null, textRemaining: null, usage: usage() };
      lastInvalidated = r.responseId; active = undefined;
      link.queue.discard(e => e.type === 'speech-started' && e.responseId === r.responseId);
      link.queue.retainTerminalEvidence(event);
    };
    const unknown = () => { publishUnknown(); link.fail(new ProviderFault('VOICE_DELIVERY_UNKNOWN')); };
```

Before the `await link.start(...)` expression add `link.onFailure = publishUnknown`. In the binary message branch, immediately before `active.bytes += message.byteLength`, add `cancelFirstAudio?.()`. In both successful `SpeechMetadata` and `SpeechInterrupted` branches, cancel `cancelFirstAudio` as well as the existing deadline. In `speak()`, replace the single-line `if (!active) active = ...` assignment with:

```typescript
        if (!active) {
          active = { turnId: command.turnId, responseId: command.responseId, text: '', speechId: null,
            baseMs: completedMs, bytes: 0, flushed: false, interrupted: false, offset: null };
          cancelFirstAudio = link.deadline(30000, unknown);
        }
```

Keep text and audio retry out of the link. A fatal event settles the iterable, invalidates the response, and tells P6 delivery is unknown; only the gateway/user policy can authorize another connection. Synthesis request retry is not inference replay, but it can still bill twice and is not automatic here.

- [ ] **Step 6: Run focused GREEN.** `npm test -- test/voice/providers/resilience.spec.ts -t "rejects a pending Nova finalization"`, `npm test -- test/voice/providers/resilience.spec.ts -t "keeps Nova alive"`, `npm test -- test/voice/providers/resilience.spec.ts -t "reports unknown delivery"`, and `npm test -- test/voice/providers/resilience.spec.ts -t "bounds first synthesis audio"` must pass their respective regressions. Then rerun `npm test -- test/voice/providers` after 4B supplies the missing helper. No missing or empty suite is accepted.

### 4B. Bounded fresh-connection backoff (not stream reconnection)

- [ ] **Step 1: Implement the retry helper against the last failing resilience test.** Create `backend/src/voice/providers/connect-backoff.ts`:

```typescript
import { setTimeout as delay } from 'node:timers/promises';
import { ProviderFault } from './provider-link.js';

export async function connectWithBackoff<T>(operation: (signal: AbortSignal) => Promise<T>,
  options: { signal: AbortSignal; deadlineMs: number; random?: () => number }): Promise<T> {
  const controller = new AbortController();
  const ended = new ProviderFault('VOICE_RECONNECT_TIMEOUT', 'return_to_chat');
  const cancelled = new ProviderFault('VOICE_SESSION_ENDED', 'none', false);
  let timedOut = false;
  let connected = false;
  const abort = () => controller.abort();
  if (options.signal.aborted) throw cancelled;
  options.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(10000, options.deadlineMs));
  let stopReject: ((error: ProviderFault) => void) | undefined;
  const stopped = new Promise<never>((_, reject) => { stopReject = reject; });
  const onStop = () => stopReject?.(timedOut ? ended : cancelled);
  controller.signal.addEventListener('abort', onStop, { once: true });
  try {
    return await Promise.race([stopped, (async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (controller.signal.aborted) throw timedOut ? ended : cancelled;
        try { const connection = await operation(controller.signal); connected = true; return connection; }
        catch (error) {
          if (controller.signal.aborted) throw timedOut ? ended : cancelled;
          if (!(error instanceof ProviderFault) || !error.fault.recoverable ||
            !['STT_UNAVAILABLE', 'TTS_UNAVAILABLE', 'VOICE_CONNECT_TIMEOUT', 'VOICE_PROVIDER_RATE_LIMITED'].includes(error.fault.code)) throw error;
          if (attempt === 4) throw ended;
          const random = Math.max(0, Math.min(1, (options.random ?? Math.random)()));
          const backoff = Math.min(2000, 250 * 2 ** attempt);
          await delay(Math.floor(backoff * (1 + random)), undefined, { signal: controller.signal });
        }
      }
      throw ended;
    })()]);
  } finally {
    clearTimeout(timer);
    if (!connected) { controller.abort(); options.signal.removeEventListener('abort', abort); }
    controller.signal.removeEventListener('abort', onStop);
  }
}
```

Only P5's **explicitly authorized fresh live connect** calls this function, forwarding its signal into `adapter.connect({ ...request, abortSignal: signal })`. It attempts at most five fresh handshakes with 250/500/1000/2000-ms base delays plus bounded jitter, subject to a hard ≤10-second deadline. Dictation does not call it; established sockets never call it; there is no audio/text/event replay and no hidden restart. An operation must honor the supplied abort signal (all three adapters do). On success the helper clears the handshake deadline without aborting the returned socket; the parent session-abort listener remains until the owning P5 session is aborted (once), preserving lifetime cancellation. P5 still owns fresh epoch admission and explicit resume/repeat-turn UX.

- [ ] **Step 2: Run GREEN.** `npm test -- test/voice/providers/resilience.spec.ts -t "fresh live connects"`, then `npm test -- test/voice/providers/resilience.spec.ts -t "keeps a successful backoff socket"`, then `npm test -- test/voice/providers/resilience.spec.ts`. Expect ten passing cases at this point, with fake timers restored and no real provider sockets.

### 4C. Protocol fixtures, boundary validation and replay checks

- [ ] **Step 1: Write the three exact JSON fixtures.** These are **synthetic protocol fixtures**, not captured audio or evidence of service compatibility. Create `backend/test/fixtures/deepgram/nova-results.json`:

```json
[
  {"type":"Results","start":0,"duration":0.8,"channel_index":[0,1],"is_final":false,"speech_final":false,"channel":{"alternatives":[{"transcript":"Demo"}]}},
  {"type":"Results","start":0,"duration":0.8,"channel_index":[0,1],"is_final":false,"speech_final":false,"channel":{"alternatives":[{"transcript":"Demo 42"}]}},
  {"type":"Results","start":0,"duration":0.8,"channel_index":[0,1],"is_final":true,"speech_final":true,"channel":{"alternatives":[{"transcript":"Demo 42."}]}},
  {"type":"Results","start":0,"duration":0.8,"channel_index":[0,1],"is_final":true,"speech_final":true,"channel":{"alternatives":[{"transcript":"Demo 42."}]}},
  {"type":"Results","start":0.8,"duration":0.08,"channel_index":[0,1],"is_final":true,"speech_final":true,"from_finalize":true,"channel":{"alternatives":[{"transcript":"Final tail."}]}}
]
```

Create `backend/test/fixtures/deepgram/flux-turns.json`:

```json
[
  {"type":"Connected","request_id":"fixture-request","sequence_id":0},
  {"type":"TurnInfo","request_id":"fixture-request","sequence_id":1,"event":"StartOfTurn","turn_index":0,"transcript":"","audio_window_start":0,"audio_window_end":0,"words":[],"end_of_turn_confidence":0},
  {"type":"TurnInfo","request_id":"fixture-request","sequence_id":2,"event":"Update","turn_index":0,"transcript":"What is next","audio_window_start":0,"audio_window_end":0.8,"words":[],"end_of_turn_confidence":0.1},
  {"type":"TurnInfo","request_id":"fixture-request","sequence_id":3,"event":"EndOfTurn","turn_index":0,"transcript":"What is next?","audio_window_start":0,"audio_window_end":0.8,"words":[],"end_of_turn_confidence":0.9,"trigger":"model"}
]
```

Create `backend/test/fixtures/deepgram/flux-speech.json`:

```json
{
  "connected":{"type":"Connected","request_id":"fixture-request","model_name":"flux-haley-en","model_version":"fixture-2026-10-08","model_uuids":[]},
  "started":{"type":"SpeechStarted","speech_id":"dg_sp_000000000001"},
  "flushed":{"type":"Flushed","speech_id":"dg_sp_000000000001"},
  "completed":{"type":"SpeechMetadata","speech_id":"dg_sp_000000000001","audio_duration_ms":100,"input_character_count":12,"billable_character_count":12,"controls_applied":{"pronunciations_applied":0,"breaks_applied":0,"pronunciation_warnings":0}},
  "interrupted":{"type":"SpeechInterrupted","audio_played_ms":50,"text_spoken":"Hello","text_remaining":" world.","metadata":{"speech_id":"dg_sp_000000000001","audio_duration_ms":50,"input_character_count":12,"billable_character_count":12,"controls_applied":{"pronunciations_applied":0,"breaks_applied":0,"pronunciation_warnings":0}}}
}
```

- [ ] **Step 2: Append the exact replay/validation tests to `resilience.spec.ts`.** Add these imports:

```typescript
import novaMessages from '../../fixtures/deepgram/nova-results.json' with { type: 'json' };
import fluxMessages from '../../fixtures/deepgram/flux-turns.json' with { type: 'json' };
import speechMessages from '../../fixtures/deepgram/flux-speech.json' with { type: 'json' };
```

Append:

```typescript
it('replays the documented fixture families through their actual adapter message paths', async () => {
  const n = harness(); const nc = await new NovaSttAdapter(config(), n.factory).connect(input('dictation'));
  const ne: SttEvent[] = []; const nd = collect(nc.events, ne);
  for (const m of novaMessages.slice(0, 4)) n.sockets[0].json(m);
  const stop = nc.finalize(); await tick(); n.sockets[0].json(novaMessages[4]); await stop; await nd;
  expect(ne.flatMap(e => e.type === 'final' ? [e.text] : [])).toEqual(['Demo 42.', 'Final tail.']);
  const f = harness(fluxMessages[0]); const fc = await new FluxSttAdapter(config(), f.factory).connect(input('live'));
  const fe: SttEvent[] = []; const fd = collect(fc.events, fe);
  for (const m of fluxMessages.slice(1)) f.sockets[0].json(m); await tick(); await fc.close(); await fd;
  expect(fe.filter(e => e.type === 'end-of-turn').map(e => e.text)).toEqual(['What is next?']);
  const t = harness(speechMessages.connected); const tc = await new FluxTtsAdapter(config(), t.factory).connect(output());
  const te: TtsEvent[] = []; const td = collect(tc.events, te);
  await tc.speak({ ...r, text: 'Hello world.' }); t.sockets[0].json(speechMessages.started); t.sockets[0].binary(new Uint8Array(4800));
  await tc.interrupt({ ...r, providerSocketId: tc.providerSocketId, playbackPositionMs: 50 });
  t.sockets[0].json(speechMessages.interrupted); await tick(); await tc.close(); await td;
  expect(te.filter(e => e.type === 'speech-interrupted')).toMatchObject([{ textSpoken: 'Hello', textRemaining: ' world.', audioPlayedMs: 50 }]);
});

it('rejects invalid consumed provider fields without leaking provider payloads', async () => {
  const h = harness(); const c = await new NovaSttAdapter(config(), h.factory).connect(input('dictation'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  h.sockets[0].json({ ...novaResult('secret', true), start: -1 }); await done;
  expect(events).toEqual([{ type: 'error', fault: { code: 'STT_UNAVAILABLE', recovery: 'retry_dictation', recoverable: true } }]);
  const h2 = harness(connected); const c2 = await new FluxTtsAdapter(config(), h2.factory).connect(output());
  await c2.speak({ ...r, text: 'Hello.' }); h2.sockets[0].json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  const e2: TtsEvent[] = []; const d2 = collect(c2.events, e2); h2.sockets[0].binary(new Uint8Array(3)); await d2;
  expect(e2.some(e => e.type === 'error')).toBe(true);
});

it('drops old Flux turns and stale TTS metadata without corrupting a current response', async () => {
  const h = harness(connected); const c = await new FluxTtsAdapter(config(), h.factory).connect(output());
  const events: TtsEvent[] = []; const done = collect(c.events, events);
  await c.speak({ ...r, text: 'Hello world.' }); h.sockets[0].json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  h.sockets[0].binary(new Uint8Array(4800)); await c.flush(r);
  h.sockets[0].json({ type: 'SpeechMetadata', ...metadata('dg_sp_old000000000') }); await tick();
  expect(events.some(e => e.type === 'speech-completed')).toBe(false);
  h.sockets[0].json({ type: 'SpeechMetadata', ...metadata() }); await tick(); await c.close(); await done;
  expect(events.filter(e => e.type === 'speech-completed')).toHaveLength(1);
});
```

- [ ] **Step 3: Add an exact usage regression before terminal accounting code.** Append to `backend/test/voice/providers/resilience.spec.ts`:

```typescript
it('reports STT input duration with unknown provider version rather than inventing billing', async () => {
  const h = harness(connected); const c = await new FluxSttAdapter(config(), h.factory).connect(input('live'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  await c.writeAudio(new Uint8Array(2560)); await c.close(); await done;
  expect(events).toContainEqual({ type: 'usage', usage: { providerRequestId: 'fixture-request',
    model: 'flux-general-en', modelVersion: null, audioMs: 80, billableCharacters: null } });
});
```

Run RED: `npm test -- test/voice/providers/resilience.spec.ts -t "reports STT input duration"` — no `usage` event before the following code changes.

In `backend/src/voice/providers/flux-stt.ts`, add these fields before constructing `link`:

```typescript
    let inputMs = 0; let providerRequestId: string | null = null;
```

At the beginning of the nonbinary message handler, add:

```typescript
        if (message.type === 'Connected') providerRequestId = providerId.parse(message.request_id);
```

Immediately before `return link.send(pcm, ...)` add `inputMs += 80`. Immediately before `await link.start(...)` add:

```typescript
    const reportUsage = () => { link.queue.push({ type: 'usage', usage: {
      providerRequestId, model: this.cfg.deepgram.liveModel, modelVersion: null,
      audioMs: inputMs, billableCharacters: null,
    } }); };
    link.onFailure = reportUsage; link.onFinish = reportUsage;
```

For `backend/src/voice/providers/nova-stt.ts`, add `let providerRequestId: string | null = null` beside `audioEnd`. Import `providerId` from `provider-link.js`. At the beginning of the nonbinary message handler, before ignoring non-Results messages, add:

```typescript
        if (message.type === 'Metadata' && message.request_id !== undefined)
          providerRequestId = providerId.parse(message.request_id);
```

Replace the terminal hooks added in 4A with:

```typescript
    const reportUsage = () => { link.queue.push({ type: 'usage', usage: {
      providerRequestId, model: this.cfg.deepgram.dictationModel, modelVersion: null,
      audioMs: Math.round(audioEnd * 1000), billableCharacters: null,
    } }); };
    link.onFailure = error => { reportUsage(); cancelDeadline?.(); rejectStop?.(error); };
    link.onFinish = () => { reportUsage(); cancelDeadline?.(); resolveStop?.(); };
```

Update Task 1's empty/cancel assertions to ignore the newly expected terminal usage event: replace `expect(events).toEqual(...)` in the empty test with `expect(events.filter(e => e.type !== 'usage')).toEqual(...)`, and replace `expect(late).toEqual([])` with `expect(late.filter(e => e.type !== 'usage')).toEqual([])`. These are exact terminal evidence additions, not transcript callbacks after cancellation. In the invalid-provider-fields test, likewise assert `events.filter(e => e.type !== 'usage')` equals the stable fault. Run GREEN with the usage command and all provider suites.

`audioMs` here measures PCM submitted at this boundary, not provider open-stream/silence billing. Unknown STT model versions remain `null`; P11 records actual reported versions when available. A full terminal queue may omit the optional usage snapshot but never the fault; P9 must treat absent usage as unknown. The current P1 `TtsEvent` cannot independently carry final cumulative `SessionMetadata` (which can rebase downward after interruption): request a P1 follow-up before P9 treats per-turn sums as authoritative session billing; do not change the port or fabricate totals in P3.

- [ ] **Step 4: Verify provenance and queue ceilings.** Create `backend/test/fixtures/deepgram/README.md` with this exact Markdown:

```markdown
# Deepgram protocol fixtures

All committed JSON messages are synthetic, derived from official Deepgram
message schemas consulted on 8 October 2026. They are not live captures and do
not certify voice quality, service availability, actual model versions, billing,
or latency. Binary PCM in tests is generated silence, not recorded speech.

Replay: from backend, run `npm test -- test/voice/providers/resilience.spec.ts
-t "replays the documented fixture families"` on one line.

Provider captures require separate explicit operator approval, consenting test
content, credentials supplied only to the test process, bounded spend and session
duration. Capture only sanitized JSON messages and reported API/model/version
metadata. Remove keys, headers, upgrade URLs, real request IDs and personal text;
replace them consistently with deterministic fixture IDs and consenting synthetic
phrases. Do not commit raw microphone audio, account configuration, or provider
error descriptions. Record source URL, capture date, model/version, consent,
sanitization and authorization references before claiming a fixture is captured.

Routine tests use only FakeSocket; no test reads DEEPGRAM_API_KEY from the
environment or creates a real provider WebSocket. Current fixtures therefore
remain synthetic until authorized evidence is collected by P11.

Ceilings: 131072-byte provider messages, 256 pending event/send records, 32000
characters per transcript/response, default 32000-byte pending input audio and
96000-byte pending output audio. Queue overflow fails rather than silently losing
speech. Nova Stop is capped at 2000 ms; send stalls at the input queue budget;
fresh-connect recovery is capped at 10000 ms and five attempts. TTS first output
and post-Flush completion each have a 30000-ms safety deadline. These deadlines
are failure bounds, not measured latency promises.
```

- [ ] **Step 5: Run verification commands.**

```powershell
npm test -- test/voice/providers
npm run build
npm run lint
npm test
```

Expected: all new provider suites are discovered and pass, builds/lint are clean, and routine backend regression suites pass. Report unrelated/pre-existing failures separately with exact commands; do not overwrite user work to fix them. No database, Azure, real-provider or hardware prerequisite is needed for these provider tests. Broader native/e2e verification belongs to P11 and must report actual skips separately.

- [ ] **Step 6: Commit only P3 changes (root, serialized slot).**

```powershell
git add backend/src/voice/providers/provider-link.ts backend/src/voice/providers/nova-stt.ts backend/src/voice/providers/flux-stt.ts backend/src/voice/providers/flux-tts.ts backend/src/voice/providers/connect-backoff.ts backend/test/voice/providers/resilience.spec.ts backend/test/fixtures/deepgram/nova-results.json backend/test/fixtures/deepgram/flux-turns.json backend/test/fixtures/deepgram/flux-speech.json backend/test/fixtures/deepgram/README.md
git commit -m "fix(voice): bound provider recovery and retain unknown delivery evidence"
```

## Completion evidence and downstream handoff

- [ ] Report the actual implementation commit range and exact discovered/passed/failed/skipped test counts. This document is a plan, not implementation or passing-test evidence.
- [ ] P5 receives `NovaSttAdapter`/`FluxSttAdapter`, finalization/tail signals, failure recovery codes, fresh live `connectWithBackoff`, and idempotent close/cancel. The gateway validates identity, mode, epoch and controls **before** provider allocation; it never sends live `partial`/`end-of-turn` text to the browser.
- [ ] P6 receives `FluxTtsAdapter`, socket ID, per-response normalized interruption duration, exact split text or explicit null/unknown, provider usage, and response fencing. It clears browser playback/invalidates the response first, aborts the existing agent best-effort, reconciles durable outcomes, and never automatically repeats inference.
- [ ] P9 receives only sanitized fault codes and bounded usage/model/version signals. Rates remain unknown when unavailable; cancellation does not guarantee billing prevention. Request a P1 follow-up for explicit privacy opt-out settings and any additional configurable provider deadlines; do not silently expand shared configuration.
- [ ] P10 receives constructor/factory signatures and owns all central registration. No Nest gateway decorators or `AppService` changes are made in this plan.
- [ ] P11 receives synthetic fixture provenance and the remaining live/device gates: verified US/EU API availability, provider model/version, authorized privacy/billing configuration, Haley/Alexis/Priya audition, actual 100-utterance/30-task fidelity, latency, noise/echo, and real browser/device evidence. Offline green tests do not pass those gates.

Acceptance covered here: D1/D4/D7/D8 and adapter portions of A3/A5/A6/A9/A14; V2–V5 event, synthesis and delivery semantics. Draft selection/Send, local audio clearing, hidden UI, durable context, quotas, and transport/session isolation remain with their existing DAG owners. Authentication, live tools, Aura, eager turn execution, captions, and multilingual release remain out of scope.

## Planner self-check evidence

The final TypeScript blocks and Task 4 edits were assembled in an isolated temporary directory, using the existing installed packages and copied P1 contracts/configuration. On Node.js `v24.18.0`, Vitest `v4.1.11` discovered **four suites / 26 cases, all passing**; TypeScript `--noEmit --incremental false` passed for those excerpts and their dependencies. This validates the runnable plan examples only: no implementation files were created in the repository, no application integration/build/regression evidence was collected, and no paid/live/provider/hardware tests ran. Scope/ownership, P1 method and event signatures, official protocol corrections, local links, and absence of unfinished code placeholders were checked. Review remains **skipped**.
