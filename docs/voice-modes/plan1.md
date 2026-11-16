# P1 Shared Voice Contracts, Configuration, and Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish validated, versioned, browser-safe voice contracts, server-only configuration, compatible dependencies, and reusable offline fixtures for P2–P11.

**Architecture:** Keep portable wire types/guards and PCM framing separate from server-only Zod records and provider/reservation ports. Extend the existing platform loader without changing text readiness or constructing another runtime; mirror only portable code into the separate frontend package. Sessions opened on New Chat remain ephemeral until a first accepted live turn creates the durable conversation.

**Tech Stack:** TypeScript/NodeNext, existing Zod 3 and Vitest, NestJS 12, native browser WebSocket/DataView, backend `ws`.

---

## Execution boundaries and prerequisites

- This is the assigned **P1 planner's** artifact, not an orchestrator implementation. Research prerequisite: `c1bd4da`. Approved scope: [goal.md](goal.md); graph/ownership: [state.md](state.md); decisions: [research.md](research.md).
- Use the repository's `executing-plans` and `test-driven-development` skills for execution. The `superpowers:` names above are the required writing-plans header; load the locally available equivalents. Execute with the assigned worker; no additional agents are needed. Unified review is **skipped**, not passed.
- Before editing, run `git status --short` and `git diff -- backend/src/contracts/session.ts backend/src/contracts/api.ts frontend/src/api/protocol.ts`. Reconcile overlapping user work with the orchestrator **before worker execution**. Preserve `pinned?: boolean` and all session-action changes. Do not stage pre-existing edits just because a path is P1-owned.
- All commands below name their working directory. There is no root npm workspace. Node must satisfy `^22.22.3 || ^24.15.0 || >=26.0.0`. Do not run provider calls, provision services, inspect private `.env`, or enable flags.
- New code/test files require the repository's code-file header before their first implementation write. Headers are intentionally not reproduced in this Markdown plan. Keep existing headers; update them if a changed file crosses the 30% threshold. Do not add comments to strict JSON.
- The actual env template is `backend/.env.example`, not a nonexistent root `.env.example`. Leave `frontend/.env.example` unchanged (`VITE_API_BASE=/api` only).
- Implementation snippets below are complete new-file bodies or explicitly identified additive/replacement sections. Keep unrelated existing code. Never use `git add .`. For overlapping tracked files, stage only P1 hunks with `git add -p`; if hunks cannot safely be separated, stop for ownership reconciliation rather than committing user work.
- P1 does **not** implement persistence/filtering, context correction, provider sockets, audio capture/playback, gateways, quota enforcement, UI, central wiring, or Vite proxy changes. Types and validation are not evidence those downstream behaviors work.

## File map

| Path | Responsibility | Change |
| --- | --- | --- |
| `backend/src/contracts/voice-wire.ts` | Portable HTTP/control types, runtime guards, defaults, errors | Create |
| `backend/src/contracts/voice-audio.ts` | Pure 16-byte frame encoder/decoder | Create |
| `backend/src/contracts/voice.ts` | Server session/delivery schemas and provider/reservation ports | Create |
| `backend/src/contracts/voice.spec.ts` | Server contracts and PCM red/green tests | Create |
| `backend/src/contracts/message.ts` | Optional internal/visible message classification | Modify |
| `backend/src/contracts/index.ts` | Export production voice contracts | Modify |
| `backend/src/platform/config/voice-config.ts` | Server speech settings and explicit public projection | Create |
| `backend/src/platform/config/voice-config.spec.ts` | Defaults/validation/redaction/text-readiness checks | Create |
| `backend/src/platform/config/load-config.ts` | Include voice settings without changing text behavior | Modify |
| `backend/src/platform/index.ts` | Export voice config APIs | Modify |
| `backend/.env.example` | Default-off, server-only voice options | Modify |
| `frontend/src/api/voice-protocol.ts` | Mirror portable wire types/guards, not server records | Create |
| `frontend/src/api/voice-audio.ts` | Mirror portable binary codec | Create |
| `frontend/src/api/voice-protocol.test.ts` | Native frontend protocol checks | Create |
| `backend/src/platform/voice-dependencies.spec.ts` | Manifest/lock/script compatibility check | Create |
| `backend/package.json`, `backend/package-lock.json` | Four backend dependency additions | Modify |
| `backend/src/contracts/testing/voice-fixtures.ts` | Reusable deterministic fixtures, explicit opt-in import | Create |
| `backend/src/contracts/testing/voice-fixtures.spec.ts` | Fixture integrity | Create |
| `frontend/src/api/testing/voice-fixtures.ts` | Browser fixture mirror, without backend imports | Create |
| `frontend/src/api/testing/voice-fixtures.test.ts` | Frontend fixture integrity and portable-source parity | Create |

`frontend/src/api/protocol.ts`, `backend/src/contracts/session.ts`, `frontend/package.json`, and `frontend/package-lock.json` are inspected/preserved, not rewritten. No new frontend dependency or test configuration is necessary: existing discovery covers all planned `.spec.ts`/`src/**/*.test.ts` files. Additional integration/evaluation/browser scripts are future serialized P1 requests, not speculative additions now.

## Locked interface decisions

1. `sessionId` in a voice HTTP/control envelope is the **ephemeral voice session ID**. `conversationId` is an existing durable text-chat session ID, or `null` on New Chat. Delivery/message records keep existing `sessionId` = **durable conversation ID** and add `voiceSessionId`. Never use a voice session ID as a LangGraph thread ID.
2. Create voice with `{ protocolVersion: 1, mode, conversationId, locale: 'en-US', idempotencyKey }`. Dictation can bind an existing conversation but never creates/persists a chat or transcript. Live voice on `conversationId: null` persists no empty chat at open; a server-only `conversation.bound` event supplies the durable ID after first acceptance. This event exposes IDs, not text. Unsent composer drafts are never in this contract.
3. Audio is PCM16 **little-endian**, mono, 16 kHz input/24 kHz output. Input frames contain 1–1,280 samples (normally 80 ms; a short final drain is allowed). Output frames contain at most 4,800 samples (200 ms); P3/P5 split larger provider chunks. Queue limits are separate duration budgets, not frame sizes.
4. Binary header is exactly research's `AF 01`, kind (1=input/2=output), flags (0=normal/1=stream-end), uint32 LE sequence, uint32 LE offset-ms, uint32 LE payload-length. End flag may have an empty payload; ordinary frames may not. Unknown flags, odd/oversized PCM, malformed lengths, non-integer/overflow fields, and uint32 wrap are rejected. Reconnect before sequence/offset exhaustion; never wrap.
5. The 16-byte header **cannot carry string IDs or an epoch**. Each socket is immutably bound to voice session + connection epoch. Frame sequence is increasing per direction within that epoch and is not the JSON-control sequence. `audio.start.firstAudioSequence` binds output to `turnId`/`responseId`; `audio.end.lastAudioSequence` and `response.cancelled.lastAudioSequence` close that binding. Server assigns sequences at enqueue time and serializes starts/audio/end/cancel barriers. A cancelled response's late frames retain their old range; new responses start strictly beyond its last assigned sequence. No concurrent/interleaved output responses on one socket. P4/P5 implement these fences and reject frames before start, after terminal fences, from stale sockets, or for invalidated ranges. P1 validates structure only; it does not pretend a header alone authenticates or proves ordering.
6. Flat JSON `{ type, protocolVersion, sessionId, connectionEpoch, eventId, sequence, ...payload }` is the app contract. Nest's default `WsAdapter` expects `{ event, data }`: P5 must explicitly handle raw JSON/binary messages or configure an appropriate parser; do not assume default `@SubscribeMessage` routing understands these frames. Bootstrap/proxy changes remain P10.
7. Operational `voice.state` uses independent input/agent/connection dimensions. No tool or confirmation states. Response-related controls/events include both `turnId` and `responseId`; dictation finals use stable `segmentId` for dedupe. Live events never contain transcripts/generated/spoken text; recovery instructions are fixed enums, not raw provider messages.
8. Existing text messages without `visibility` remain legacy-visible. Add optional `visibility: 'visible' | 'internal'` and `mode: 'text' | 'live'`; do not add defaults that rewrite old parsed records or change text DTOs. P2/P6 must implement all archive/preview/status/stream filtering; leaving text DTOs unchanged is not a leak-prevention implementation.
9. Delivery distinguishes generated text, reported played samples, provider-confirmed spoken text, and `unknown` delivery. Offsets belong to a `providerSocketId`, never received/queued samples. Null means unknown, not zero. Socket offsets reset only on a new provider socket; an interrupt must advance past a preceding provider interrupt (P3 enforcement). Client progress is bounded evidence, not proof the person heard the audio.
10. Keep voice-specific errors out of the existing `AppErrorCode`/SSE error vocabulary. P5/P9 use `VoiceFault` or map to existing `CONFLICT_ACTIVE_TURN`, `INVALID_REQUEST`, `NOT_READY`, etc. This avoids breaking text clients' exhaustive error guards. No raw provider diagnostics go on the wire.

### Task 1: Shared Voice Contracts & Types

**Files:** Create `backend/src/contracts/voice-wire.ts`, `voice-audio.ts`, `voice.ts`, `voice.spec.ts`; modify `backend/src/contracts/message.ts:41–56` and append exports to `backend/src/contracts/index.ts`. Preserve user-modified session/API/repository contracts.

- [ ] **1.1 Write the failing contract and framing tests** in `backend/src/contracts/voice.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { messageRecordSchema } from './message.js';
import { sessionRecordSchema } from './session.js';
import { encodeVoiceAudio, decodeVoiceAudio } from './voice-audio.js';
import {
  DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO, isVoiceClientEvent,
  isVoiceServerEvent, isCreateVoiceSessionRequest,
} from './voice-wire.js';
import { voiceDeliveryRecordSchema, voiceSessionRecordSchema } from './voice.js';

const envelope = {
  protocolVersion: 1, sessionId: 'voice-1', connectionEpoch: 1,
  eventId: 'event-1', sequence: 0,
};
describe('voice contracts', () => {
  it('accepts draft-only/new-chat starts and rejects overrides', () => {
    const request = { protocolVersion: 1, mode: 'dictation', conversationId: null,
      locale: 'en-US', idempotencyKey: 'voice-key-1' };
    expect(isCreateVoiceSessionRequest(request)).toBe(true);
    expect(isCreateVoiceSessionRequest({ ...request, mode: 'live' })).toBe(true);
    for (const field of ['userId', 'tenantId', 'model', 'apiKey', 'draft', 'voice']) {
      expect(isCreateVoiceSessionRequest({ ...request, [field]: 'override' })).toBe(false);
    }
    expect(isCreateVoiceSessionRequest({ ...request, locale: 'hi-IN' })).toBe(false);
    expect(isVoiceClientEvent({ ...envelope, type: 'session.start', mode: 'live',
      audioSettings: INPUT_AUDIO })).toBe(true);
    expect(isVoiceClientEvent({ ...envelope, type: 'session.start', mode: 'live',
      audioSettings: { ...INPUT_AUDIO, sampleRate: 48000 } })).toBe(false);
    expect(isVoiceClientEvent({ ...envelope, type: 'session.end', connectionEpoch: -1 })).toBe(false);
    expect(isVoiceClientEvent({ ...envelope, type: 'session.end', sequence: 2 ** 32 })).toBe(false);
  });
  it('keeps independent state and prevents live text payloads', () => {
    const state = { ...envelope, type: 'voice.state',
      input: 'listening', agent: 'speaking', connection: 'connected' };
    expect(isVoiceServerEvent(state, 'live')).toBe(true);
    expect(isVoiceServerEvent({ ...state, text: 'hidden' }, 'live')).toBe(false);
    expect(isVoiceServerEvent({ ...envelope, type: 'dictation.final',
      segmentId: 'segment-1', text: 'draft' }, 'live')).toBe(false);
    expect(isVoiceServerEvent({ ...envelope, type: 'dictation.final',
      segmentId: 'segment-1', text: 'draft' }, 'dictation')).toBe(true);
    expect(isVoiceServerEvent({ ...envelope, type: 'session.ready',
      limits: DEFAULT_VOICE_LIMITS, effectiveAudioSettings: { input: INPUT_AUDIO, output: OUTPUT_AUDIO } }, 'live')).toBe(true);
  });
  it('encodes the exact LE header independently of native typed-array endianness', () => {
    const frame = encodeVoiceAudio({ kind: 1, flags: 0, sequence: 7, offsetMs: 80,
      pcm: new Uint8Array([0, 128, 255, 127]) });
    expect([...frame.slice(0, 16)]).toEqual([
      175, 1, 1, 0, 7, 0, 0, 0, 80, 0, 0, 0, 4, 0, 0, 0,
    ]);
    expect(decodeVoiceAudio(frame)).toEqual({ kind: 1, flags: 0, sequence: 7,
      offsetMs: 80, pcm: new Uint8Array([0, 128, 255, 127]) });
    const padded = new Uint8Array(frame.length + 6);
    padded.set(frame, 3);
    expect(decodeVoiceAudio(padded.subarray(3, -3)).sequence).toBe(7);
  });
  it('rejects malformed, oversized and wrapping audio without silent truncation', () => {
    const valid = encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0, offsetMs: 0,
      pcm: new Uint8Array(2560) });
    for (const [index, value] of [[0, 0], [1, 2], [2, 3], [3, 2], [12, 1]]) {
      const corrupt = valid.slice(); corrupt[index] = value;
      expect(() => decodeVoiceAudio(corrupt)).toThrow('INVALID_AUDIO_FRAME');
    }
    expect(() => decodeVoiceAudio(valid.slice(0, 15))).toThrow();
    expect(() => encodeVoiceAudio({ kind: 1, flags: 0, sequence: 2 ** 32,
      offsetMs: 0, pcm: new Uint8Array(2) })).toThrow();
    expect(() => encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0,
      offsetMs: 0, pcm: new Uint8Array(2562) })).toThrow();
    expect(() => encodeVoiceAudio({ kind: 2, flags: 0, sequence: 0,
      offsetMs: 0, pcm: new Uint8Array(9602) })).toThrow();
    expect(() => encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0,
      offsetMs: 0, pcm: new Uint8Array(1) })).toThrow();
    expect(() => encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0,
      offsetMs: 0, pcm: new Uint8Array(0) })).toThrow();
    expect(decodeVoiceAudio(encodeVoiceAudio({ kind: 1, flags: 1, sequence: 1,
      offsetMs: 80, pcm: new Uint8Array(0) })).flags).toBe(1);
  });
  it('keeps legacy messages readable and permits bounded internal records', () => {
    const message = { schemaVersion: 1, userId: 'user-1', sessionId: 'chat-1',
      turnId: 'turn-1', messageId: 'message-1', eventId: 'event-1', sequence: 1,
      role: 'user', content: 'hello', createdAt: '2026-10-08T00:00:00Z',
      completionStatus: 'accepted', attemptId: null, truncated: false };
    expect(messageRecordSchema.parse(message)).toEqual(message);
    expect(messageRecordSchema.parse({ ...message, visibility: 'internal', mode: 'live' }).visibility).toBe('internal');
    expect(messageRecordSchema.safeParse({ ...message, visibility: 'secret' }).success).toBe(false);
    expect(sessionRecordSchema.shape.pinned).toBeDefined();
  });
  it('records unknown delivery and separate voice/conversation identity', () => {
    const delivery = { schemaVersion: 1, kind: 'voice-delivery', userId: 'user-1',
      sessionId: 'chat-1', voiceSessionId: 'voice-1', turnId: 'turn-1',
      attemptId: 'attempt-1', responseId: 'response-1', eventId: 'event-2', sequence: 2,
      speechId: null, providerSocketId: 'socket-1', status: 'unknown',
      audioDurationMs: null, audioPlayedMs: null, playedSamples: null,
      textGenerated: 'Paris is the capital.', textSpoken: null, textRemaining: null,
      createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' };
    expect(voiceDeliveryRecordSchema.parse(delivery)).toEqual(delivery);
    expect(voiceDeliveryRecordSchema.safeParse({ ...delivery, audioDurationMs: 100,
      audioPlayedMs: 101 }).success).toBe(false);
    expect(voiceDeliveryRecordSchema.safeParse({ ...delivery, textGenerated: 'x'.repeat(32001) }).success).toBe(false);
    expect(voiceDeliveryRecordSchema.safeParse({ ...delivery, rawAudio: [] }).success).toBe(false);
    expect(voiceSessionRecordSchema.parse({ schemaVersion: 1, voiceSessionId: 'voice-1',
      userId: 'user-1', conversationId: null, mode: 'dictation', locale: 'en-US',
      connectionEpoch: 0, status: 'created', createdAt: delivery.createdAt,
      expiresAt: '2026-10-08T00:05:00Z' }).conversationId).toBeNull();
  });
});
```

- [ ] **1.2 Run red** from `backend`: `npm test -- src/contracts/voice.spec.ts`. Expected: import-resolution failure for the missing voice modules; existing suites must not be used as a substitute for these assertions.

- [ ] **1.3 Create portable wire types/defaults** in `backend/src/contracts/voice-wire.ts`:

```typescript
export const VOICE_PROTOCOL_VERSION = 1 as const;
export const MAX_VOICE_CONTROL_BYTES = 131072;
export const VOICE_ROUTES = {
  config: '/voice/config', sessions: '/voice/sessions',
  session: (id: string) => `/voice/sessions/${encodeURIComponent(id)}`,
  websocket: '/api/voice',
} as const;
export type VoiceMode = 'dictation' | 'live';
export type VoiceSessionStatus = 'created' | 'connecting' | 'active' | 'reconnecting' | 'ending' | 'ended';
export const INPUT_AUDIO = { encoding: 'pcm16', sampleRate: 16000, channels: 1,
  endian: 'little', frameMs: 80 } as const;
export const OUTPUT_AUDIO = { encoding: 'pcm16', sampleRate: 24000, channels: 1,
  endian: 'little' } as const;
export type InputAudioSettings = typeof INPUT_AUDIO;
export type OutputAudioSettings = typeof OUTPUT_AUDIO;
export type VoiceLimits = {
  dictationMaxMs: number; liveMaxMs: number; liveWarningMs: number;
  idleWarningMs: number; idleExitAfterWarningMs: number;
  finalizationMs: number; reconnectMs: number; connectMs: number;
  inputQueueMs: number; outputQueueMs: number;
};
export const DEFAULT_VOICE_LIMITS: Readonly<VoiceLimits> = Object.freeze({
  dictationMaxMs: 300000, liveMaxMs: 1200000, liveWarningMs: 1080000,
  idleWarningMs: 60000, idleExitAfterWarningMs: 30000, finalizationMs: 2000,
  reconnectMs: 10000, connectMs: 10000, inputQueueMs: 1000, outputQueueMs: 2000,
});
export const VOICE_ERROR_CODES = [
  'VOICE_DISABLED', 'INVALID_VOICE_REQUEST', 'INVALID_VOICE_CONTROL',
  'INVALID_AUDIO_FRAME', 'INVALID_ORIGIN', 'VOICE_SESSION_NOT_FOUND',
  'VOICE_SESSION_ENDED', 'VOICE_BINDING_MISMATCH', 'STALE_CONNECTION_EPOCH',
  'VOICE_SEQUENCE_ERROR', 'VOICE_INVALID_STATE', 'CONFLICT_ACTIVE_TURN',
  'AUDIO_BUFFER_OVERFLOW', 'VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT',
  'VOICE_IDLE_TIMEOUT', 'DICTATION_FINALIZATION_TIMEOUT', 'VOICE_RECONNECT_TIMEOUT',
  'VOICE_CONNECT_TIMEOUT', 'STT_UNAVAILABLE', 'TTS_UNAVAILABLE', 'VOICE_PROVIDER_RATE_LIMITED',
  'VOICE_AGENT_FAILED', 'VOICE_DELIVERY_UNKNOWN',
] as const;
export type VoiceErrorCode = typeof VOICE_ERROR_CODES[number];
export type VoiceRecovery = 'none' | 'retry_dictation' | 'resume_gesture' | 'repeat_turn' | 'return_to_chat';
export type CreateVoiceSessionRequest = { protocolVersion: 1; mode: VoiceMode;
  conversationId: string | null; locale: 'en-US'; idempotencyKey: string };
export type PublicVoiceConfig = { protocolVersion: 1;
  enabledModes: { dictation: boolean; live: boolean }; supportedLocales: ['en-US'];
  limits: VoiceLimits; inputAudio: InputAudioSettings; outputAudio: OutputAudioSettings };
export type CreateVoiceSessionResponse = { protocolVersion: 1; sessionId: string;
  conversationId: string | null; mode: VoiceMode; connectionEpoch: number;
  websocketUrl: '/api/voice'; expiresAt: string;
  effectiveAudioSettings: { input: InputAudioSettings; output: OutputAudioSettings | null };
  limits: VoiceLimits };
export type VoiceEnvelope = { protocolVersion: 1; sessionId: string;
  connectionEpoch: number; eventId: string; sequence: number };
export type VoiceResponseRef = { turnId: string; responseId: string };
export type VoiceClientPayload =
  | { type: 'session.start'; mode: VoiceMode; audioSettings: InputAudioSettings }
  | { type: 'dictation.stop' | 'dictation.cancel' | 'input.mute' | 'input.unmute' | 'session.end' }
  | ({ type: 'response.interrupt'; playbackPositionMs: number; playedSamples: number } & VoiceResponseRef)
  | ({ type: 'playback.progress'; playedMs: number; playedSamples: number } & VoiceResponseRef);
export type VoiceClientEvent = VoiceEnvelope & VoiceClientPayload;
export type VoiceServerPayload =
  | { type: 'session.ready'; limits: VoiceLimits;
      effectiveAudioSettings: { input: InputAudioSettings; output: OutputAudioSettings | null } }
  | { type: 'session.ended'; reason: 'completed' | 'cancelled' | 'disconnected' | 'duration' | 'idle' | 'error' | 'shutdown' }
  | { type: 'conversation.bound'; conversationId: string }
  | { type: 'dictation.partial' | 'dictation.final'; segmentId: string; text: string }
  | { type: 'dictation.complete'; finalization: 'complete' | 'timeout' | 'empty'; unfinalizedTail: boolean }
  | { type: 'voice.state'; input: 'listening' | 'muted'; agent: 'idle' | 'thinking' | 'speaking';
      connection: 'connected' | 'reconnecting' }
  | ({ type: 'audio.start'; sampleRate: 24000; firstAudioSequence: number } & VoiceResponseRef)
  | ({ type: 'audio.end' | 'response.cancelled'; lastAudioSequence: number | null } & VoiceResponseRef)
  | { type: 'session.warning' | 'session.error'; code: VoiceErrorCode; recovery: VoiceRecovery; recoverable: boolean };
export type VoiceServerEvent = VoiceEnvelope & VoiceServerPayload;

type Guard = (value: unknown) => boolean;
type Shape = Record<string, Guard>;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const id: Guard = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const uint: Guard = value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const safeUint: Guard = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive: Guard = value => uint(value) && (value as number) > 0;
const bool: Guard = value => typeof value === 'boolean';
const text: Guard = value => typeof value === 'string' && value.length <= 32000;
const oneOf = (...values: readonly unknown[]): Guard => value => values.includes(value);
const nullable = (guard: Guard): Guard => value => value === null || guard(value);
const exact = (value: unknown, shape: Shape): boolean => record(value) &&
  Object.keys(value).length === Object.keys(shape).length &&
  Object.entries(shape).every(([key, guard]) => Object.hasOwn(value, key) && guard(value[key]));
const input: Guard = value => exact(value, { encoding: oneOf('pcm16'), sampleRate: oneOf(16000),
  channels: oneOf(1), endian: oneOf('little'), frameMs: oneOf(80) });
const output: Guard = value => exact(value, { encoding: oneOf('pcm16'), sampleRate: oneOf(24000),
  channels: oneOf(1), endian: oneOf('little') });
const audio: Guard = value => exact(value, { input, output: nullable(output) });
export function isVoiceLimits(value: unknown): value is VoiceLimits {
  const shape = Object.fromEntries(Object.keys(DEFAULT_VOICE_LIMITS).map(key => [key, positive]));
  if (!exact(value, shape)) return false;
  const v = value as VoiceLimits;
  return v.liveWarningMs < v.liveMaxMs && v.finalizationMs <= v.dictationMaxMs &&
    v.inputQueueMs <= v.dictationMaxMs && v.outputQueueMs <= v.liveMaxMs &&
    v.idleWarningMs + v.idleExitAfterWarningMs <= v.liveMaxMs;
}
export function isCreateVoiceSessionRequest(value: unknown): value is CreateVoiceSessionRequest {
  return exact(value, { protocolVersion: oneOf(1), mode: oneOf('dictation', 'live'),
    conversationId: nullable(id), locale: oneOf('en-US'),
    idempotencyKey: v => id(v) && (v as string).length >= 8 });
}
export function isPublicVoiceConfig(value: unknown): value is PublicVoiceConfig {
  return exact(value, { protocolVersion: oneOf(1),
    enabledModes: v => exact(v, { dictation: bool, live: bool }),
    supportedLocales: v => Array.isArray(v) && v.length === 1 && v[0] === 'en-US',
    limits: isVoiceLimits, inputAudio: input, outputAudio: output });
}
export function isCreateVoiceSessionResponse(value: unknown): value is CreateVoiceSessionResponse {
  if (!exact(value, { protocolVersion: oneOf(1), sessionId: id, conversationId: nullable(id),
    mode: oneOf('dictation', 'live'), connectionEpoch: uint, websocketUrl: oneOf('/api/voice'),
    expiresAt: v => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)),
    effectiveAudioSettings: audio, limits: isVoiceLimits })) return false;
  const v = value as CreateVoiceSessionResponse;
  return v.mode === 'dictation' ? v.effectiveAudioSettings.output === null : output(v.effectiveAudioSettings.output);
}
const envelope: Shape = { protocolVersion: oneOf(1), sessionId: id,
  connectionEpoch: uint, eventId: id, sequence: uint };
const response: Shape = { turnId: id, responseId: id };
const clientShapes: Record<string, Shape> = {
  'session.start': { mode: oneOf('dictation', 'live'), audioSettings: input },
  'dictation.stop': {}, 'dictation.cancel': {}, 'input.mute': {}, 'input.unmute': {}, 'session.end': {},
  'response.interrupt': { ...response, playbackPositionMs: uint, playedSamples: safeUint },
  'playback.progress': { ...response, playedMs: uint, playedSamples: safeUint },
};
const serverShapes: Record<string, Shape> = {
  'session.ready': { limits: isVoiceLimits, effectiveAudioSettings: audio },
  'session.ended': { reason: oneOf('completed', 'cancelled', 'disconnected', 'duration', 'idle', 'error', 'shutdown') },
  'conversation.bound': { conversationId: id },
  'dictation.partial': { segmentId: id, text }, 'dictation.final': { segmentId: id, text },
  'dictation.complete': { finalization: oneOf('complete', 'timeout', 'empty'), unfinalizedTail: bool },
  'voice.state': { input: oneOf('listening', 'muted'), agent: oneOf('idle', 'thinking', 'speaking'),
    connection: oneOf('connected', 'reconnecting') },
  'audio.start': { ...response, sampleRate: oneOf(24000), firstAudioSequence: uint },
  'audio.end': { ...response, lastAudioSequence: nullable(uint) },
  'response.cancelled': { ...response, lastAudioSequence: nullable(uint) },
  'session.warning': { code: oneOf(...VOICE_ERROR_CODES), recovery: oneOf('none', 'retry_dictation', 'resume_gesture', 'repeat_turn', 'return_to_chat'), recoverable: bool },
  'session.error': { code: oneOf(...VOICE_ERROR_CODES), recovery: oneOf('none', 'retry_dictation', 'resume_gesture', 'repeat_turn', 'return_to_chat'), recoverable: bool },
};
function isEvent(value: unknown, shapes: Record<string, Shape>): boolean {
  if (!record(value) || typeof value.type !== 'string' || !Object.hasOwn(shapes, value.type)) return false;
  return exact(value, { ...envelope, type: oneOf(value.type), ...shapes[value.type] });
}
export function isVoiceClientEvent(value: unknown): value is VoiceClientEvent {
  return isEvent(value, clientShapes);
}
export function isVoiceServerEvent(value: unknown, mode: VoiceMode): value is VoiceServerEvent {
  if (!isEvent(value, serverShapes)) return false;
  const v = value as VoiceServerEvent;
  if (mode === 'live' && v.type.startsWith('dictation.')) return false;
  if (mode === 'dictation' && ['voice.state', 'audio.start', 'audio.end', 'response.cancelled', 'conversation.bound'].includes(v.type)) return false;
  if (v.type === 'session.ready') return mode === 'dictation'
    ? v.effectiveAudioSettings.output === null : output(v.effectiveAudioSettings.output);
  return true;
}
export function parseVoiceControl(json: string, direction: 'client', mode: VoiceMode): VoiceClientEvent;
export function parseVoiceControl(json: string, direction: 'server', mode: VoiceMode): VoiceServerEvent;
export function parseVoiceControl(json: string, direction: 'client' | 'server', mode: VoiceMode): VoiceClientEvent | VoiceServerEvent {
  if (json.length > MAX_VOICE_CONTROL_BYTES || new TextEncoder().encode(json).byteLength > MAX_VOICE_CONTROL_BYTES) throw new Error('INVALID_VOICE_CONTROL');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('INVALID_VOICE_CONTROL'); }
  if (direction === 'client' && isVoiceClientEvent(value)) {
    if (value.type === 'session.start' && value.mode !== mode) throw new Error('INVALID_VOICE_CONTROL');
    if (mode === 'live' && value.type.startsWith('dictation.')) throw new Error('INVALID_VOICE_CONTROL');
    if (mode === 'dictation' && ['input.mute', 'input.unmute', 'response.interrupt', 'playback.progress'].includes(value.type)) throw new Error('INVALID_VOICE_CONTROL');
    return value;
  }
  if (direction === 'server' && isVoiceServerEvent(value, mode)) return value;
  throw new Error('INVALID_VOICE_CONTROL');
}
```

HTTP paths are relative to the existing `/api` base, except the returned WebSocket path, which is absolute and credential-free. P4 resolves its `ws:`/`wss:` origin from the application origin. Session binding goes in the first `session.start` control, not an identity/key URL parameter. P5 validates it before provider allocation. Structural guards do not replace P5's lifecycle/ownership checks.

- [ ] **1.4 Create the pure codec** in `backend/src/contracts/voice-audio.ts`:

```typescript
export const VOICE_AUDIO_HEADER_BYTES = 16;
export type VoiceAudioFrame = { kind: 1 | 2; flags: 0 | 1;
  sequence: number; offsetMs: number; pcm: Uint8Array };
const uint32 = (n: number) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
function valid(frame: VoiceAudioFrame): boolean {
  return (frame.kind === 1 || frame.kind === 2) && (frame.flags === 0 || frame.flags === 1) &&
    uint32(frame.sequence) && uint32(frame.offsetMs) && frame.pcm instanceof Uint8Array &&
    frame.pcm.byteLength % 2 === 0 && (frame.pcm.byteLength > 0 || frame.flags === 1) &&
    frame.pcm.byteLength <= (frame.kind === 1 ? 2560 : 9600);
}
export function encodeVoiceAudio(frame: VoiceAudioFrame): Uint8Array {
  if (!valid(frame)) throw new Error('INVALID_AUDIO_FRAME');
  const bytes = new Uint8Array(VOICE_AUDIO_HEADER_BYTES + frame.pcm.byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set([0xaf, 1, frame.kind, frame.flags]);
  view.setUint32(4, frame.sequence, true);
  view.setUint32(8, frame.offsetMs, true);
  view.setUint32(12, frame.pcm.byteLength, true);
  bytes.set(frame.pcm, VOICE_AUDIO_HEADER_BYTES);
  return bytes;
}
export function decodeVoiceAudio(bytes: Uint8Array): VoiceAudioFrame {
  if (bytes.byteLength < VOICE_AUDIO_HEADER_BYTES || bytes[0] !== 0xaf || bytes[1] !== 1)
    throw new Error('INVALID_AUDIO_FRAME');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12, true) !== bytes.byteLength - VOICE_AUDIO_HEADER_BYTES)
    throw new Error('INVALID_AUDIO_FRAME');
  const frame: VoiceAudioFrame = { kind: bytes[2] as 1 | 2, flags: bytes[3] as 0 | 1,
    sequence: view.getUint32(4, true), offsetMs: view.getUint32(8, true),
    pcm: bytes.subarray(VOICE_AUDIO_HEADER_BYTES) };
  if (!valid(frame)) throw new Error('INVALID_AUDIO_FRAME');
  return frame;
}
```

The decoder returns a view, not a retained archive. P3/P4/P5 own transient-buffer lifetimes. It does not convert host-endian `Int16Array`; callers explicitly quantize/read PCM with little-endian `DataView`.

- [ ] **1.5 Create server schemas and ports** in `backend/src/contracts/voice.ts`:

```typescript
import { z } from 'zod';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { DEFAULT_BUDGETS } from './budgets.js';
import type { ResolvedIdentity } from './identity.js';
import type { VoiceMode, InputAudioSettings, OutputAudioSettings, VoiceErrorCode,
  VoiceRecovery } from './voice-wire.js';

const uint = z.number().int().nonnegative().max(0xffffffff);
const chars = z.string().max(DEFAULT_BUDGETS.maxInputChars);
export const voiceSessionRecordSchema = z.object({
  schemaVersion: z.literal(1), voiceSessionId: idSchema, userId: idSchema,
  conversationId: idSchema.nullable(), mode: z.enum(['dictation', 'live']),
  locale: z.literal('en-US'), connectionEpoch: uint,
  status: z.enum(['created', 'connecting', 'active', 'reconnecting', 'ending', 'ended']),
  createdAt: isoDateSchema, expiresAt: isoDateSchema,
}).strict();
export type VoiceSessionRecord = z.infer<typeof voiceSessionRecordSchema>;
export const voiceDeliveryRecordSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('voice-delivery'),
  userId: idSchema, sessionId: idSchema, voiceSessionId: idSchema,
  turnId: idSchema, attemptId: idSchema, responseId: idSchema,
  eventId: idSchema, sequence: sequenceSchema,
  speechId: idSchema.nullable(), providerSocketId: idSchema,
  status: z.enum(['pending', 'completed', 'interrupted', 'cancelled', 'failed', 'unknown']),
  audioDurationMs: uint.nullable(), audioPlayedMs: uint.nullable(),
  playedSamples: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  textGenerated: chars, textSpoken: chars.nullable(), textRemaining: chars.nullable(),
  createdAt: isoDateSchema, updatedAt: isoDateSchema,
}).strict().superRefine((v, ctx) => {
  if (v.audioDurationMs !== null && v.audioPlayedMs !== null && v.audioPlayedMs > v.audioDurationMs)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['audioPlayedMs'], message: 'played exceeds generated' });
  if (v.textSpoken !== null && !v.textGenerated.startsWith(v.textSpoken))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['textSpoken'], message: 'spoken must be a generated prefix' });
  if (v.textSpoken !== null && v.textRemaining !== null && v.textSpoken + v.textRemaining !== v.textGenerated)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['textRemaining'], message: 'delivery text must reconcile' });
});
export type VoiceDeliveryRecord = z.infer<typeof voiceDeliveryRecordSchema>;
export type VoiceFault = { code: VoiceErrorCode; recovery: VoiceRecovery; recoverable: boolean };
export type SpeechUsage = { providerRequestId: string | null; model: string;
  modelVersion: string | null; audioMs: number | null; billableCharacters: number | null };
export type SttEvent =
  | { type: 'partial' | 'final'; segmentId: string; text: string }
  | { type: 'start-of-turn'; providerTurnId: string }
  | { type: 'end-of-turn'; providerTurnId: string; text: string }
  | { type: 'finalized'; unfinalizedTail: boolean }
  | { type: 'usage'; usage: SpeechUsage }
  | { type: 'error'; fault: VoiceFault };
export type SttConnectRequest = { mode: VoiceMode; locale: 'en-US';
  audio: InputAudioSettings; abortSignal: AbortSignal };
export interface SpeechInputConnection {
  readonly events: AsyncIterable<SttEvent>;
  writeAudio(pcm: Uint8Array): Promise<void>;
  finalize(): Promise<void>;
  close(): Promise<void>;
}
export interface SpeechToTextPort {
  connect(request: SttConnectRequest): Promise<SpeechInputConnection>;
}
export type TtsEvent =
  | { type: 'audio'; turnId: string; responseId: string; pcm: Uint8Array }
  | { type: 'speech-started'; turnId: string; responseId: string; speechId: string }
  | { type: 'speech-completed'; turnId: string; responseId: string; speechId: string;
      audioDurationMs: number; usage: SpeechUsage }
  | { type: 'speech-interrupted'; turnId: string; responseId: string; speechId: string | null;
      audioPlayedMs: number | null; textSpoken: string | null; textRemaining: string | null;
      usage: SpeechUsage }
  | { type: 'error'; fault: VoiceFault };
export interface SpeechOutputConnection {
  readonly providerSocketId: string;
  readonly events: AsyncIterable<TtsEvent>;
  speak(command: { turnId: string; responseId: string; text: string }): Promise<void>;
  flush(command: { turnId: string; responseId: string }): Promise<void>;
  interrupt(command: { turnId: string; responseId: string; providerSocketId: string;
    playbackPositionMs: number }): Promise<void>;
  close(): Promise<void>;
}
export interface SpeechSynthesisPort {
  connect(request: { audio: OutputAudioSettings; abortSignal: AbortSignal }): Promise<SpeechOutputConnection>;
}
export type ExecutionReservation = { reservationId: string; userId: string;
  conversationId: string | null; owner: { kind: 'text'; attemptId: string } |
  { kind: 'live'; voiceSessionId: string } };
export interface ExecutionReservationPort {
  acquire(command: { identity: ResolvedIdentity; conversationId: string | null;
    owner: ExecutionReservation['owner'] }): Promise<ExecutionReservation>;
  bindConversation(command: { reservationId: string; identity: ResolvedIdentity;
    conversationId: string }): Promise<ExecutionReservation>;
  release(command: { reservationId: string; identity: ResolvedIdentity }): Promise<void>;
}
```

Ports are interfaces only. Provider configuration is injected server-side into P3 implementations, never into browser request shapes. Reservation `acquire` must fail with existing `CONFLICT_ACTIVE_TURN` when another owner holds the conversation; same-owner acquisition/release are idempotent. P5 acquires a live reservation, P6 integrates it into text submit/retry. A new-chat reservation is voice-session-scoped until P6 binds its first durably accepted conversation atomically; dictation never uses this port. These are handoff obligations, not P1 implementations.

- [ ] **1.6 Add message fields**, directly after `truncated` in `backend/src/contracts/message.ts`:

```typescript
    visibility: z.enum(['visible', 'internal']).optional(),
    mode: z.enum(['text', 'live']).optional(),
```

Append production exports to `backend/src/contracts/index.ts` (do not export testing fixtures):

```typescript
export * from './voice-wire.js';
export * from './voice-audio.js';
export * from './voice.js';
```

- [ ] **1.7 Verify green** from `backend`: `npm test -- src/contracts/voice.spec.ts`; then `npm test -- src/contracts`; then `npm run build`. Expected: all new assertions executed/passed, existing contract suites preserved, no new compile failures. Record actual test count; missing or skipped tests are not green.
- [ ] **1.8 Commit** from repository root; request the orchestrator's serialized commit slot first:

```powershell
git add backend/src/contracts/voice-wire.ts backend/src/contracts/voice-audio.ts backend/src/contracts/voice.ts backend/src/contracts/voice.spec.ts
git add -p backend/src/contracts/message.ts backend/src/contracts/index.ts
git diff --cached --check
git commit -m "feat(voice): define shared wire audio and delivery contracts"
```

### Task 2: Platform Configuration & Environment Schema

**Files:** Create `backend/src/platform/config/voice-config.ts`, `voice-config.spec.ts`; modify `backend/src/platform/config/load-config.ts:82–101,158–191`, `backend/src/platform/index.ts`, `backend/.env.example`.

**Config choices:** Required duration/queue defaults come from the goal. Additional finite accounting defaults are conservative P1 choices (not measured/product-approved account rates): one concurrent session per configured identity, four globally, 60 identity-minutes/120 global-minutes per UTC day; optional daily spend cap requires all three account rates. P9 enforces these against the shared identity, not authenticated tenants. Unknown prices remain `null`, never zero. Custom caps can be lowered by operators; never enable modes via the template.

- [ ] **2.1 Write red tests** in `backend/src/platform/config/voice-config.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE_LIMITS, isPublicVoiceConfig } from '../../contracts/voice-wire.js';
import { loadConfig, readinessIssues } from './load-config.js';
import { loadVoiceConfig, publicVoiceConfig, voiceReadinessIssues } from './voice-config.js';

describe('voice config', () => {
  it('defaults off with explicit finite budgets and unknown rates', () => {
    const v = loadVoiceConfig({});
    expect(v.enabledModes).toEqual({ dictation: false, live: false });
    expect(v.limits).toEqual(DEFAULT_VOICE_LIMITS);
    expect(v.quotas).toEqual({ identityConcurrent: 1, globalConcurrent: 4,
      identityDailyMinutes: 60, globalDailyMinutes: 120, dailySpendUsd: null });
    expect(v.rates).toEqual({ novaPerMinuteUsd: null, fluxSttPerMinuteUsd: null,
      fluxTtsPerThousandCharsUsd: null });
    expect(v.deepgram.dictationModel).toBe('nova-3');
    expect(v.deepgram.liveModel).toBe('flux-general-en');
    expect(v.deepgram.ttsModel).toBe('flux-haley-en');
    expect(v.deepgram.spokenPunctuation).toBe(false);
  });
  it('strictly parses flags, overrides and cross-field limits', () => {
    expect(loadVoiceConfig({ ENABLE_DICTATION_MODE: 'true', VOICE_DICTATION_MAX_MS: '10000' }).limits.dictationMaxMs).toBe(10000);
    expect(loadVoiceConfig({ ENABLE_LIVE_VOICE_MODE: 'true', DEEPGRAM_TTS_MODEL: 'flux-priya-en' }).enabledModes.live).toBe(true);
    for (const env of [
      { ENABLE_DICTATION_MODE: 'yes' }, { ENABLE_LIVE_VOICE_MODE: '1' },
      { VOICE_INPUT_QUEUE_MS: '0' }, { VOICE_OUTPUT_QUEUE_MS: 'Infinity' },
      { VOICE_RECONNECT_MS: '-1' }, { VOICE_FINALIZATION_MS: '1.5' },
      { VOICE_LIVE_MAX_MS: '1080000' }, { VOICE_DICTATION_MAX_MS: '1000' },
      { DEEPGRAM_API_BASE: 'http://api.deepgram.com' },
      { DEEPGRAM_API_BASE: 'wss://user:secret@api.deepgram.com' },
      { DEEPGRAM_API_BASE: 'wss://example.com' }, { DEEPGRAM_LIVE_MODEL: 'flux-general-multi' },
      { DEEPGRAM_TTS_MODEL: 'aura-2-thalia-en' }, { DEEPGRAM_DICTATION_ENDPOINTING_MS: '501' },
      { VOICE_IDENTITY_CONCURRENT: '5', VOICE_GLOBAL_CONCURRENT: '4' },
      { VOICE_DAILY_SPEND_USD: '1' },
    ]) expect(() => loadVoiceConfig(env)).toThrow('Invalid voice configuration.');
    expect(loadVoiceConfig({ VOICE_DAILY_SPEND_USD: '1', DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.01',
      DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.01', DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.01' }).quotas.dailySpendUsd).toBe(1);
  });
  it('projects only safe public settings and does not degrade text readiness', () => {
    const config = loadConfig({ OPENROUTER_API_KEY: 'fixture-openrouter',
      OPENROUTER_MODEL: 'fixture-model', MONGODB_URI: 'mongodb://localhost:27017',
      DEEPGRAM_API_KEY: 'fixture-deepgram', ENABLE_DICTATION_MODE: 'true' });
    const pub = publicVoiceConfig(config.voice);
    expect(isPublicVoiceConfig(pub)).toBe(true);
    expect(Object.keys(pub).sort()).toEqual(['enabledModes', 'inputAudio', 'limits',
      'outputAudio', 'protocolVersion', 'supportedLocales']);
    const serialized = JSON.stringify(pub);
    for (const privateValue of ['fixture-deepgram', 'fixture-openrouter', 'aurvin-dev-user',
      'nova-3', 'flux-general-en', 'api.deepgram.com', 'rates', 'quotas']) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(readinessIssues(config)).toEqual([]);
    expect(voiceReadinessIssues(loadVoiceConfig({}))).toEqual([]);
    expect(voiceReadinessIssues(loadVoiceConfig({ ENABLE_LIVE_VOICE_MODE: 'true' })))
      .toEqual(['DEEPGRAM_API_KEY is missing']);
  });
  it('sanitizes configuration failures without echoing credentials', () => {
    expect(() => loadConfig({ DEEPGRAM_API_KEY: 'fixture-secret', ENABLE_LIVE_VOICE_MODE: 'oops' }))
      .toThrow('Invalid application configuration.');
  });
});
```

- [ ] **2.2 Run red** from `backend`: `npm test -- src/platform/config/voice-config.spec.ts`. Expected: missing module/export/`config.voice` failure.
- [ ] **2.3 Implement server configuration** in `backend/src/platform/config/voice-config.ts`:

```typescript
import { z } from 'zod';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO, isVoiceLimits,
  type VoiceLimits, type PublicVoiceConfig } from '../../contracts/voice-wire.js';

const positive = z.coerce.number().int().positive().max(0xffffffff);
const flag = z.enum(['true', 'false']).default('false').transform(v => v === 'true');
const rate = z.preprocess(v => v === '' || v === undefined ? null : v,
  z.coerce.number().finite().nonnegative().nullable());
const spend = z.preprocess(v => v === '' || v === undefined ? null : v,
  z.coerce.number().finite().positive().nullable());
const envSchema = z.object({
  DEEPGRAM_API_KEY: z.string().max(4096).default(''),
  ENABLE_DICTATION_MODE: flag, ENABLE_LIVE_VOICE_MODE: flag,
  DEEPGRAM_API_BASE: z.enum(['wss://api.deepgram.com', 'wss://api.eu.deepgram.com']).default('wss://api.deepgram.com'),
  DEEPGRAM_DICTATION_MODEL: z.literal('nova-3').default('nova-3'),
  DEEPGRAM_LIVE_MODEL: z.literal('flux-general-en').default('flux-general-en'),
  DEEPGRAM_TTS_MODEL: z.enum(['flux-haley-en', 'flux-alexis-en', 'flux-priya-en']).default('flux-haley-en'),
  DEEPGRAM_DICTATION_ENDPOINTING_MS: positive.min(300).max(500).default(300),
  DEEPGRAM_SPOKEN_PUNCTUATION: flag,
  DEEPGRAM_KEYTERMS: z.string().max(3300).default(''),
  DEEPGRAM_FLUX_EOT_THRESHOLD: z.coerce.number().min(0.5).max(1).default(0.8),
  DEEPGRAM_FLUX_EOT_TIMEOUT_MS: positive.default(5000),
  VOICE_DICTATION_MAX_MS: positive.default(DEFAULT_VOICE_LIMITS.dictationMaxMs),
  VOICE_LIVE_MAX_MS: positive.default(DEFAULT_VOICE_LIMITS.liveMaxMs),
  VOICE_LIVE_WARNING_MS: positive.default(DEFAULT_VOICE_LIMITS.liveWarningMs),
  VOICE_IDLE_WARNING_MS: positive.default(DEFAULT_VOICE_LIMITS.idleWarningMs),
  VOICE_IDLE_EXIT_AFTER_WARNING_MS: positive.default(DEFAULT_VOICE_LIMITS.idleExitAfterWarningMs),
  VOICE_FINALIZATION_MS: positive.default(DEFAULT_VOICE_LIMITS.finalizationMs),
  VOICE_RECONNECT_MS: positive.default(DEFAULT_VOICE_LIMITS.reconnectMs),
  VOICE_CONNECT_MS: positive.default(DEFAULT_VOICE_LIMITS.connectMs),
  VOICE_INPUT_QUEUE_MS: positive.default(DEFAULT_VOICE_LIMITS.inputQueueMs),
  VOICE_OUTPUT_QUEUE_MS: positive.default(DEFAULT_VOICE_LIMITS.outputQueueMs),
  VOICE_IDENTITY_CONCURRENT: positive.default(1), VOICE_GLOBAL_CONCURRENT: positive.default(4),
  VOICE_IDENTITY_DAILY_MINUTES: positive.default(60), VOICE_GLOBAL_DAILY_MINUTES: positive.default(120),
  VOICE_DAILY_SPEND_USD: spend,
  DEEPGRAM_NOVA_RATE_PER_MIN_USD: rate, DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: rate,
  DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: rate,
}).passthrough();
export type VoiceConfig = {
  enabledModes: { dictation: boolean; live: boolean }; limits: VoiceLimits;
  deepgram: { apiKey: string; apiBase: string; dictationModel: 'nova-3';
    liveModel: 'flux-general-en'; ttsModel: 'flux-haley-en' | 'flux-alexis-en' | 'flux-priya-en';
    endpointingMs: number; spokenPunctuation: boolean; keyterms: string[];
    eotThreshold: number; eotTimeoutMs: number };
  quotas: { identityConcurrent: number; globalConcurrent: number;
    identityDailyMinutes: number; globalDailyMinutes: number; dailySpendUsd: number | null };
  rates: { novaPerMinuteUsd: number | null; fluxSttPerMinuteUsd: number | null;
    fluxTtsPerThousandCharsUsd: number | null };
};
export function loadVoiceConfig(env: Record<string, string | undefined>): VoiceConfig {
  try {
    const e = envSchema.parse(env);
    const limits: VoiceLimits = {
      dictationMaxMs: e.VOICE_DICTATION_MAX_MS, liveMaxMs: e.VOICE_LIVE_MAX_MS,
      liveWarningMs: e.VOICE_LIVE_WARNING_MS, idleWarningMs: e.VOICE_IDLE_WARNING_MS,
      idleExitAfterWarningMs: e.VOICE_IDLE_EXIT_AFTER_WARNING_MS,
      finalizationMs: e.VOICE_FINALIZATION_MS, reconnectMs: e.VOICE_RECONNECT_MS,
      connectMs: e.VOICE_CONNECT_MS, inputQueueMs: e.VOICE_INPUT_QUEUE_MS,
      outputQueueMs: e.VOICE_OUTPUT_QUEUE_MS,
    };
    const keyterms = e.DEEPGRAM_KEYTERMS.split(',').map(v => v.trim()).filter(Boolean);
    if (!isVoiceLimits(limits) || keyterms.length > 50 || keyterms.some(v => v.length > 64) ||
      e.VOICE_IDENTITY_CONCURRENT > e.VOICE_GLOBAL_CONCURRENT ||
      e.VOICE_IDENTITY_DAILY_MINUTES > e.VOICE_GLOBAL_DAILY_MINUTES) throw new Error('bounds');
    const rates = { novaPerMinuteUsd: e.DEEPGRAM_NOVA_RATE_PER_MIN_USD,
      fluxSttPerMinuteUsd: e.DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD,
      fluxTtsPerThousandCharsUsd: e.DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD };
    if (e.VOICE_DAILY_SPEND_USD !== null && Object.values(rates).some(v => v === null))
      throw new Error('spend_requires_rates');
    return { enabledModes: { dictation: e.ENABLE_DICTATION_MODE, live: e.ENABLE_LIVE_VOICE_MODE }, limits,
      deepgram: { apiKey: e.DEEPGRAM_API_KEY, apiBase: e.DEEPGRAM_API_BASE,
        dictationModel: e.DEEPGRAM_DICTATION_MODEL, liveModel: e.DEEPGRAM_LIVE_MODEL,
        ttsModel: e.DEEPGRAM_TTS_MODEL, endpointingMs: e.DEEPGRAM_DICTATION_ENDPOINTING_MS,
        spokenPunctuation: e.DEEPGRAM_SPOKEN_PUNCTUATION, keyterms,
        eotThreshold: e.DEEPGRAM_FLUX_EOT_THRESHOLD, eotTimeoutMs: e.DEEPGRAM_FLUX_EOT_TIMEOUT_MS },
      quotas: { identityConcurrent: e.VOICE_IDENTITY_CONCURRENT, globalConcurrent: e.VOICE_GLOBAL_CONCURRENT,
        identityDailyMinutes: e.VOICE_IDENTITY_DAILY_MINUTES, globalDailyMinutes: e.VOICE_GLOBAL_DAILY_MINUTES,
        dailySpendUsd: e.VOICE_DAILY_SPEND_USD }, rates };
  } catch { throw new Error('Invalid voice configuration.'); }
}
export function publicVoiceConfig(config: VoiceConfig): PublicVoiceConfig {
  return { protocolVersion: 1, enabledModes: { ...config.enabledModes }, supportedLocales: ['en-US'],
    limits: { ...config.limits }, inputAudio: { ...INPUT_AUDIO }, outputAudio: { ...OUTPUT_AUDIO } };
}
export function voiceReadinessIssues(config: VoiceConfig): string[] {
  return (config.enabledModes.dictation || config.enabledModes.live) && !config.deepgram.apiKey
    ? ['DEEPGRAM_API_KEY is missing'] : [];
}
```

Provider host allowlist prevents credential-forwarding to an arbitrary configured URL. EU host is an operator-selected region, not proof Flux support/account admission there; P3/P11 verify the chosen endpoint with official docs and authorized tests. Never auto-fallback to another region/model. Account privacy/opt-out API options require a verified provider-compatible P1 follow-up before enabling a deployment; no unverified provider option is fabricated here.

- [ ] **2.4 Integrate the loader additively**. In `backend/src/platform/config/load-config.ts`, add:

```typescript
import { loadVoiceConfig, type VoiceConfig } from './voice-config.js';
```

Add to `AurvinConfig` after `budgets`:

```typescript
  voice?: VoiceConfig;
```

Change only `loadConfig`'s return annotation:

```typescript
): AurvinConfig & { voice: VoiceConfig } {
```

Inside its existing `try`, before `const budgets`, add:

```typescript
    const voice = loadVoiceConfig(env);
```

Add `voice,` to the returned object next to `budgets`. Do **not** add speech failures to `readinessIssues`; P9 owns per-mode degradation. Optional `AurvinConfig.voice` preserves existing manually constructed text config fixtures; `loadConfig` always returns validated voice config. P10 must use the loaded object (or explicitly default with `loadVoiceConfig({})` in fixture composition), not silently enable a missing property.

Append to `backend/src/platform/index.ts`:

```typescript
export { loadVoiceConfig, publicVoiceConfig, voiceReadinessIssues,
  type VoiceConfig } from './config/voice-config.js';
```

- [ ] **2.5 Append the exact nonsecret template section** to `backend/.env.example`:

```dotenv

# Voice is server-only, independently default-off; no VITE_* voice settings.
DEEPGRAM_API_KEY=
ENABLE_DICTATION_MODE=false
ENABLE_LIVE_VOICE_MODE=false
DEEPGRAM_API_BASE=wss://api.deepgram.com
DEEPGRAM_DICTATION_MODEL=nova-3
DEEPGRAM_LIVE_MODEL=flux-general-en
DEEPGRAM_TTS_MODEL=flux-haley-en
DEEPGRAM_DICTATION_ENDPOINTING_MS=300
DEEPGRAM_SPOKEN_PUNCTUATION=false
DEEPGRAM_KEYTERMS=
DEEPGRAM_FLUX_EOT_THRESHOLD=0.8
DEEPGRAM_FLUX_EOT_TIMEOUT_MS=5000
VOICE_DICTATION_MAX_MS=300000
VOICE_LIVE_MAX_MS=1200000
VOICE_LIVE_WARNING_MS=1080000
VOICE_IDLE_WARNING_MS=60000
VOICE_IDLE_EXIT_AFTER_WARNING_MS=30000
VOICE_FINALIZATION_MS=2000
VOICE_RECONNECT_MS=10000
VOICE_CONNECT_MS=10000
VOICE_INPUT_QUEUE_MS=1000
VOICE_OUTPUT_QUEUE_MS=2000
# Shared development-identity budgets; P9 supplies enforcement, not authentication.
VOICE_IDENTITY_CONCURRENT=1
VOICE_GLOBAL_CONCURRENT=4
VOICE_IDENTITY_DAILY_MINUTES=60
VOICE_GLOBAL_DAILY_MINUTES=120
# Unknown account rates stay blank/null. Spend cap requires all actual rates.
VOICE_DAILY_SPEND_USD=
DEEPGRAM_NOVA_RATE_PER_MIN_USD=
DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD=
DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD=
```

- [ ] **2.6 Verify green**, from `backend`, as separate commands: `npm test -- src/platform/config/voice-config.spec.ts`; `npm test -- src/platform`; `npm run build`; `npm run lint`. Expected: actual new tests pass, existing platform fixtures compile, text readiness unchanged. Config errors must not expose values.
- [ ] **2.7 Commit**, from repository root, in the serialized slot:

```powershell
git add backend/src/platform/config/voice-config.ts backend/src/platform/config/voice-config.spec.ts
git add -p backend/src/platform/config/load-config.ts backend/src/platform/index.ts backend/.env.example
git diff --cached --check
git commit -m "feat(voice): validate server flags speech settings and finite limits"
```

### Task 3: Frontend Voice Protocol & Types

**Files:** Create `frontend/src/api/voice-protocol.ts`, `frontend/src/api/voice-audio.ts`, `frontend/src/api/voice-protocol.test.ts`. Inspect and preserve `frontend/src/api/protocol.ts`, including `SessionSummary.pinned`; no modifications to its text/SSE contracts.

- [ ] **3.1 Write the failing frontend tests** in `frontend/src/api/voice-protocol.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import type { SessionSummary } from './protocol'
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO, VOICE_ROUTES,
  isCreateVoiceSessionResponse, isPublicVoiceConfig, parseVoiceControl } from './voice-protocol'
import { encodeVoiceAudio, decodeVoiceAudio } from './voice-audio'

const base = { protocolVersion: 1, sessionId: 'voice-1', connectionEpoch: 1,
  eventId: 'event-1', sequence: 0 }
describe('frontend voice protocol', () => {
  it('mirrors routes, frame bytes and preserves existing pinned type', () => {
    const summary: Pick<SessionSummary, 'pinned'> = { pinned: true }
    expect(summary.pinned).toBe(true)
    expect(VOICE_ROUTES.config).toBe('/voice/config')
    expect(VOICE_ROUTES.websocket).toBe('/api/voice')
    const bytes = encodeVoiceAudio({ kind: 2, flags: 0, sequence: 3, offsetMs: 200,
      pcm: new Uint8Array([255, 127]) })
    expect([...bytes]).toEqual([175, 1, 2, 0, 3, 0, 0, 0, 200, 0, 0, 0, 2, 0, 0, 0, 255, 127])
    expect(decodeVoiceAudio(bytes).kind).toBe(2)
  })
  it('validates control events and rejects hidden text, bad JSON and overrides', () => {
    const event = { ...base, type: 'audio.start', turnId: 'turn-1', responseId: 'response-1',
      sampleRate: 24000, firstAudioSequence: 0 }
    expect(parseVoiceControl(JSON.stringify(event), 'server', 'live')).toEqual(event)
    for (const invalid of [ { ...event, text: 'hidden' }, { ...event, userId: 'browser' },
      { ...event, sampleRate: 16000 }, { ...event, protocolVersion: 2 },
      { ...event, responseId: '' }, { ...event, type: 'unknown' } ]) {
      expect(() => parseVoiceControl(JSON.stringify(invalid), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')
    }
    expect(() => parseVoiceControl('{', 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')
    expect(() => parseVoiceControl(' '.repeat(131073), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')
    expect(() => parseVoiceControl(JSON.stringify({ ...base, type: 'dictation.stop' }), 'client', 'live')).toThrow()
    expect(() => parseVoiceControl(JSON.stringify({ ...base, type: 'input.mute' }), 'client', 'dictation')).toThrow()
  })
  it('accepts safe public/session config without keys, URLs or model selection', () => {
    const pub = { protocolVersion: 1, enabledModes: { dictation: false, live: false },
      supportedLocales: ['en-US'], limits: DEFAULT_VOICE_LIMITS,
      inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO }
    expect(isPublicVoiceConfig(pub)).toBe(true)
    expect(isPublicVoiceConfig({ ...pub, apiKey: 'key' })).toBe(false)
    const created = { protocolVersion: 1, sessionId: 'voice-1', conversationId: null,
      mode: 'live', connectionEpoch: 1, websocketUrl: '/api/voice',
      expiresAt: '2026-10-08T00:20:00Z', limits: DEFAULT_VOICE_LIMITS,
      effectiveAudioSettings: { input: INPUT_AUDIO, output: OUTPUT_AUDIO } }
    expect(isCreateVoiceSessionResponse(created)).toBe(true)
    expect(isCreateVoiceSessionResponse({ ...created, websocketUrl: 'wss://provider/?key=secret' })).toBe(false)
    expect(isCreateVoiceSessionResponse({ ...created, mode: 'dictation' })).toBe(false)
  })
})
```

- [ ] **3.2 Run red**, from `frontend`: `npm test -- src/api/voice-protocol.test.ts`. Expected: missing portable modules.
- [ ] **3.3 Implement by copying only the fully specified portable bodies from Task 1**. From root:

```powershell
node --input-type=module -e "import {readFileSync,writeFileSync} from 'node:fs'; import {basename} from 'node:path'; for (const [source,target] of [['backend/src/contracts/voice-wire.ts','frontend/src/api/voice-protocol.ts'],['backend/src/contracts/voice-audio.ts','frontend/src/api/voice-audio.ts']]) { const s=readFileSync(source,'utf8'); const end=s.indexOf('*/')+2; const header=s.slice(0,end).replace(source,target).replace(basename(source),basename(target)); writeFileSync(target,header+s.slice(end)); }"
```

This preserves the mandatory header on first write with the correct frontend filename/location; retain the executable body byte-for-byte. The portable-purpose header remains valid in either package. `voice-wire.ts` and `voice-audio.ts` have zero backend imports, Zod, provider keys, or storage types. Do not copy `voice.ts`/`voice-config.ts` and do not make frontend build depend on an out-of-package backend source import. Task 5 installs the source-parity check so subsequent serialized P1 changes update both mirrors together.

- [ ] **3.4 Verify green**, from `frontend`, as separate commands: `npm test -- src/api/voice-protocol.test.ts`; `npm test -- src/api/client.test.ts`; `npm run build`; `npm run lint`. Expected: both new protocol and existing client tests pass, including user-pinned/session-action behavior; no new dependencies. Root: `git diff -- frontend/src/api/protocol.ts` must show only pre-existing user work.
- [ ] **3.5 Commit**, from repository root, in the serialized slot:

```powershell
git add frontend/src/api/voice-protocol.ts frontend/src/api/voice-audio.ts frontend/src/api/voice-protocol.test.ts
git diff --cached --check
git commit -m "feat(voice): mirror browser-safe control and audio contracts"
```

### Task 4: Backend Dependency Manifests & Script Verification

**Files:** Create `backend/src/platform/voice-dependencies.spec.ts`; modify `backend/package.json`, `backend/package-lock.json`. Preserve existing scripts/engine/overrides and all frontend manifest/lockfile content.

- [ ] **4.1 Write red manifest checks** in `backend/src/platform/voice-dependencies.spec.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const backend = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const frontend = JSON.parse(readFileSync(new URL('../../../frontend/package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));

describe('voice dependency contract', () => {
  it('declares matching Nest ws transport and direct ws without an SDK', () => {
    expect(backend.dependencies['@nestjs/websockets']).toBe(backend.dependencies['@nestjs/common']);
    expect(backend.dependencies['@nestjs/platform-ws']).toBe(backend.dependencies['@nestjs/common']);
    expect(backend.dependencies.ws).toBe('^8.18.0');
    expect(backend.devDependencies['@types/ws']).toBe('^8.5.14');
    for (const name of ['@nestjs/websockets', '@nestjs/platform-ws', 'ws']) {
      expect(lock.packages[''].dependencies[name]).toBe(backend.dependencies[name]);
      expect(lock.packages[`node_modules/${name}`].version).toBeTruthy();
    }
    expect(lock.packages[''].devDependencies['@types/ws']).toBe('^8.5.14');
    expect(lock.packages['node_modules/@types/ws'].version).toBeTruthy();
    expect(backend.dependencies['@deepgram/sdk']).toBeUndefined();
    expect(frontend.dependencies).toEqual({ react: '^19.2.8', 'react-dom': '^19.2.8' });
    const allFrontend = { ...frontend.dependencies, ...frontend.devDependencies };
    for (const name of ['ws', '@types/ws', '@deepgram/sdk', '@nestjs/websockets', '@nestjs/platform-ws'])
      expect(allFrontend[name]).toBeUndefined();
  });
  it('retains runnable existing build and verification scripts', () => {
    expect(backend.scripts.build).toBe('nest build');
    expect(backend.scripts.test).toBe('vitest run');
    expect(backend.scripts.lint).toBe('oxlint --type-aware src/ test/');
    expect(backend.scripts['test:e2e']).toBe('vitest run --config ./vitest.config.e2e.ts');
    expect(frontend.scripts.build).toBe('tsc -b && vite build');
    expect(frontend.scripts.test).toBe('vitest run');
    expect(frontend.scripts.lint).toBe('oxlint');
  });
});
```

- [ ] **4.2 Run red**, from `backend`: `npm test -- src/platform/voice-dependencies.spec.ts`. Expected: missing direct dependency assertions fail even if `ws` is already transitive.
- [ ] **4.3 Minimal manifest edit**: insert these entries into the existing objects in `backend/package.json`, preserving every other entry:

```json
{
  "dependencies": {
    "@nestjs/platform-ws": "^12.0.1",
    "@nestjs/websockets": "^12.0.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.14"
  }
}
```

This block shows additions, **not a replacement package manifest**. Match the installed Nest 12 minor/major range; do not downgrade core/common or install Socket.IO. From `backend`, run separately:

```powershell
npm install --package-lock-only
npm ci
npm ls @nestjs/common @nestjs/core @nestjs/websockets @nestjs/platform-ws ws @types/ws
```

Expected: manifest/lock agreement and no invalid peer dependency tree. Registry resolution may choose newer compatible patched releases inside the ranges; record actual versions. Inspect the lock diff for unrelated upgrades. Do not override audit/peer errors or silently upgrade Node/framework versions to make installation work. If no registry access, report blocked rather than hand-editing a lockfile.

- [ ] **4.4 Verify real script execution**. From `backend`, run each command separately: `npm test -- src/platform/voice-dependencies.spec.ts`; `npm run build`; `npm run lint`; `npm test`; `npm run test:e2e`. From `frontend`, run each separately: `npm run build`; `npm run lint`; `npm test`. Expected: discovered fixture-backed suites pass. Isolated native suites may skip without operator-provided `AURVIN_TEST_MONGODB_URI` + `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; report skips separately. Do not set production/application URIs or run Azure/paid tests. An e2e zero exit containing skips is not full integration evidence. Preserve frontend lockfile; `git diff -- frontend/package.json frontend/package-lock.json` must remain unchanged relative to the pre-task worktree snapshot.
- [ ] **4.5 Commit**, from repository root, in the serialized slot:

```powershell
git add backend/src/platform/voice-dependencies.spec.ts backend/package.json backend/package-lock.json
git diff --cached --check
git commit -m "build(voice): add native Nest websocket transport dependencies"
```

### Task 5: Shared Test Contract Fixtures

**Files:** Create `backend/src/contracts/testing/voice-fixtures.ts`, `backend/src/contracts/testing/voice-fixtures.spec.ts`, `frontend/src/api/testing/voice-fixtures.ts`, `frontend/src/api/testing/voice-fixtures.test.ts`. No P3 Deepgram protocol fixture files, P5 gateway implementation, or test-config changes.

- [ ] **5.1 Write failing backend fixture tests** in `backend/src/contracts/testing/voice-fixtures.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { decodeVoiceAudio, encodeVoiceAudio } from '../voice-audio.js';
import { parseVoiceControl } from '../voice-wire.js';
import { loadConfig } from '../../platform/config/load-config.js';
import { voiceDeliveryRecordSchema } from '../voice.js';
import { goldenInputFrame, goldenOutputFrame, clientControls, serverControls,
  disabledVoiceEnvironment, enabledVoiceEnvironment, deliveryFixture,
  createSessionFixture } from './voice-fixtures.js';

describe('shared voice fixtures', () => {
  it('uses independent golden frame bytes and returns fresh buffers', () => {
    const first = goldenInputFrame();
    expect(encodeVoiceAudio(decodeVoiceAudio(first))).toEqual(first);
    expect(decodeVoiceAudio(goldenOutputFrame()).pcm).toEqual(new Uint8Array([255, 127]));
    first[0] = 0;
    expect(goldenInputFrame()[0]).toBe(175);
  });
  it('provides every control event and both modes', () => {
    for (const row of clientControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'client', row.mode)).toEqual(row.event);
    for (const row of serverControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'server', row.mode)).toEqual(row.event);
    expect(new Set(clientControls().map(row => row.event.type)).size).toBe(8);
    expect(new Set(serverControls().map(row => row.event.type)).size).toBe(12);
    expect(createSessionFixture('dictation').conversationId).toBeNull();
    expect(loadConfig(disabledVoiceEnvironment()).voice.enabledModes.live).toBe(false);
    expect(loadConfig(enabledVoiceEnvironment()).voice.enabledModes).toEqual({ dictation: true, live: true });
    expect(voiceDeliveryRecordSchema.parse(deliveryFixture()).status).toBe('unknown');
  });
});
```

- [ ] **5.2 Write failing frontend fixture/parity checks** in `frontend/src/api/testing/voice-fixtures.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeVoiceAudio, encodeVoiceAudio } from '../voice-audio'
import { parseVoiceControl } from '../voice-protocol'
import { goldenInputFrame, goldenOutputFrame, clientControls, serverControls } from './voice-fixtures'

describe('frontend shared voice fixtures', () => {
  it('validates independent golden frames and every portable event', () => {
    expect(encodeVoiceAudio(decodeVoiceAudio(goldenInputFrame()))).toEqual(goldenInputFrame())
    expect(decodeVoiceAudio(goldenOutputFrame()).kind).toBe(2)
    for (const row of clientControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'client', row.mode)).toEqual(row.event)
    for (const row of serverControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'server', row.mode)).toEqual(row.event)
  })
  it('keeps portable production sources in exact parity excluding file headers', () => {
    const body = (url: URL) => readFileSync(url, 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').replace(/\r\n/g, '\n').trim()
    expect(body(new URL('../voice-protocol.ts', import.meta.url))).toBe(
      body(new URL('../../../../backend/src/contracts/voice-wire.ts', import.meta.url)))
    expect(body(new URL('../voice-audio.ts', import.meta.url))).toBe(
      body(new URL('../../../../backend/src/contracts/voice-audio.ts', import.meta.url)))
  })
})
```

These Node-only test filesystem reads do not go into the browser bundle. Frontend production modules never import backend files.

- [ ] **5.3 Run red**, separately: from `backend`, `npm test -- src/contracts/testing/voice-fixtures.spec.ts`; from `frontend`, `npm test -- src/api/testing/voice-fixtures.test.ts`. Expected: missing fixture modules.
- [ ] **5.4 Create backend portable fixture section** in `backend/src/contracts/testing/voice-fixtures.ts`:

```typescript
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO,
  type VoiceMode, type VoiceClientEvent, type VoiceServerEvent,
  type CreateVoiceSessionRequest } from '../voice-wire.js';

export const goldenInputFrame = () => new Uint8Array([
  175, 1, 1, 0, 7, 0, 0, 0, 80, 0, 0, 0, 4, 0, 0, 0, 0, 128, 255, 127,
]);
export const goldenOutputFrame = () => new Uint8Array([
  175, 1, 2, 0, 3, 0, 0, 0, 200, 0, 0, 0, 2, 0, 0, 0, 255, 127,
]);
export function createSessionFixture(mode: VoiceMode): CreateVoiceSessionRequest {
  return { protocolVersion: 1, mode, conversationId: null, locale: 'en-US', idempotencyKey: 'voice-fixture-1' };
}
const envelope = (sequence: number) => ({ protocolVersion: 1 as const, sessionId: 'voice-1',
  connectionEpoch: 1, eventId: `event-${sequence}`, sequence });
const response = () => ({ turnId: 'turn-1', responseId: 'response-1' });
export function clientControls(): { mode: VoiceMode; event: VoiceClientEvent }[] {
  return [
    { mode: 'live', event: { ...envelope(0), type: 'session.start', mode: 'live', audioSettings: { ...INPUT_AUDIO } } },
    { mode: 'dictation', event: { ...envelope(0), type: 'session.start', mode: 'dictation', audioSettings: { ...INPUT_AUDIO } } },
    { mode: 'dictation', event: { ...envelope(1), type: 'dictation.stop' } },
    { mode: 'dictation', event: { ...envelope(2), type: 'dictation.cancel' } },
    { mode: 'live', event: { ...envelope(1), type: 'input.mute' } },
    { mode: 'live', event: { ...envelope(2), type: 'input.unmute' } },
    { mode: 'live', event: { ...envelope(3), ...response(), type: 'response.interrupt', playbackPositionMs: 200, playedSamples: 4800 } },
    { mode: 'live', event: { ...envelope(4), ...response(), type: 'playback.progress', playedMs: 200, playedSamples: 4800 } },
    { mode: 'live', event: { ...envelope(5), type: 'session.end' } },
  ];
}
export function serverControls(): { mode: VoiceMode; event: VoiceServerEvent }[] {
  return [
    { mode: 'live', event: { ...envelope(0), type: 'session.ready', limits: { ...DEFAULT_VOICE_LIMITS },
      effectiveAudioSettings: { input: { ...INPUT_AUDIO }, output: { ...OUTPUT_AUDIO } } } },
    { mode: 'dictation', event: { ...envelope(0), type: 'session.ready', limits: { ...DEFAULT_VOICE_LIMITS },
      effectiveAudioSettings: { input: { ...INPUT_AUDIO }, output: null } } },
    { mode: 'live', event: { ...envelope(1), type: 'conversation.bound', conversationId: 'chat-1' } },
    { mode: 'dictation', event: { ...envelope(1), type: 'dictation.partial', segmentId: 'segment-1', text: 'hello' } },
    { mode: 'dictation', event: { ...envelope(2), type: 'dictation.final', segmentId: 'segment-1', text: 'hello' } },
    { mode: 'dictation', event: { ...envelope(3), type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false } },
    { mode: 'live', event: { ...envelope(2), type: 'voice.state', input: 'listening', agent: 'speaking', connection: 'connected' } },
    { mode: 'live', event: { ...envelope(3), ...response(), type: 'audio.start', sampleRate: 24000, firstAudioSequence: 0 } },
    { mode: 'live', event: { ...envelope(4), ...response(), type: 'audio.end', lastAudioSequence: 2 } },
    { mode: 'live', event: { ...envelope(5), ...response(), type: 'response.cancelled', lastAudioSequence: 2 } },
    { mode: 'live', event: { ...envelope(6), type: 'session.warning', code: 'VOICE_DURATION_LIMIT', recovery: 'none', recoverable: true } },
    { mode: 'live', event: { ...envelope(7), type: 'session.error', code: 'VOICE_DELIVERY_UNKNOWN', recovery: 'return_to_chat', recoverable: false } },
    { mode: 'live', event: { ...envelope(8), type: 'session.ended', reason: 'completed' } },
  ];
}

// Server-only fixtures below this marker; never mirror into frontend.
export const disabledVoiceEnvironment = (): Record<string, string> => ({
  ENABLE_DICTATION_MODE: 'false', ENABLE_LIVE_VOICE_MODE: 'false', DEEPGRAM_API_KEY: '',
});
export const enabledVoiceEnvironment = (): Record<string, string> => ({
  ENABLE_DICTATION_MODE: 'true', ENABLE_LIVE_VOICE_MODE: 'true', DEEPGRAM_API_KEY: 'offline-fixture-not-a-key',
});
export const deliveryFixture = () => ({ schemaVersion: 1 as const, kind: 'voice-delivery' as const,
  userId: 'user-1', sessionId: 'chat-1', voiceSessionId: 'voice-1', turnId: 'turn-1',
  attemptId: 'attempt-1', responseId: 'response-1', eventId: 'delivery-1', sequence: 1,
  speechId: null, providerSocketId: 'provider-socket-1', status: 'unknown' as const,
  audioDurationMs: null, audioPlayedMs: null, playedSamples: null,
  textGenerated: 'Hello.', textSpoken: null, textRemaining: null,
  createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' });
```

Factories return fresh mutable objects/buffers so downstream tests cannot contaminate one another. Arrays are event catalogs, **not an executable valid session trace** (stop/cancel/end/cancelled alternatives intentionally coexist). Downstream lifecycle tests select/order events appropriate to their scenario.

- [ ] **5.5 Create the frontend fixture mirror**. From root, copy only the portable section and change its sole import; this is the exact executable generation step, not an unspecified implementation:

```powershell
node --input-type=module -e "import {readFileSync,writeFileSync} from 'node:fs'; const s=readFileSync('backend/src/contracts/testing/voice-fixtures.ts','utf8').split('// Server-only fixtures below this marker; never mirror into frontend.')[0]; writeFileSync('frontend/src/api/testing/voice-fixtures.ts',s.replace('backend/src/contracts/testing/voice-fixtures.ts','frontend/src/api/testing/voice-fixtures.ts').replace('../voice-wire.js','../voice-protocol'));"
```

Ensure `frontend/src/api/testing/` exists when writing its test in Step 5.2. The generation preserves the required header and correct frontend location on first write; no server env/delivery fixtures appear in this file. These fixtures do not depend on binary encoders to generate expected bytes, so a codec bug cannot generate its own expected answer.

- [ ] **5.6 Verify green**. From `backend`: `npm test -- src/contracts/testing/voice-fixtures.spec.ts`; `npm run build`; `npm run lint`; `npm test`. From `frontend`: `npm test -- src/api/testing/voice-fixtures.test.ts`; `npm run build`; `npm run lint`; `npm test`. Expected: frontend/server guards agree on every fixture, golden frame bytes round-trip, source mirrors agree, and all routine suites genuinely execute. No hardware/browser/provider certification is claimed.
- [ ] **5.7 Commit**, from repository root, in the serialized slot:

```powershell
git add backend/src/contracts/testing/voice-fixtures.ts backend/src/contracts/testing/voice-fixtures.spec.ts frontend/src/api/testing/voice-fixtures.ts frontend/src/api/testing/voice-fixtures.test.ts
git diff --cached --check
git commit -m "test(voice): add reusable control audio and configuration fixtures"
```

## P1 exit verification and handoff

- [ ] Re-run `npm run test:e2e` from `backend` on the final five-task commit set. Record actual passes/skips/failures and isolated-database prerequisites. Do not conflate native skips with verification success.
- [ ] Confirm all changed code paths are P1-owned, all production mirrors pass parity, `.env.example` flags remain false, and frontend has no secret/model/account configuration or new dependencies.
- [ ] Run root `git diff --check` on P1 commits and `git status --short`; distinguish pre-existing user work from any P1 residue. No unrelated changes are reverted or adopted.
- [ ] Report exact worker commit hashes, test counts/commands, Node/npm versions, resolved dependency versions, and blockers to the orchestrator. Only the orchestrator updates `state.md`; this worker does not edit workflow status.
- [ ] Provide P2/P3/P4 planners this stable interface summary: durable `sessionId` versus ephemeral `voiceSessionId`/wire `sessionId`; optional internal message fields; bounded delivery schema with unknowns/socket origin; STT/TTS/reservation ports; flat JSON protocol and serialized binary response fences; portable source mirrors; default-off config and public projection; shared fixture import paths.
- [ ] Mark P1 implemented/tested only after its required compile/unit/lint checks pass or explicitly document any pre-existing blocker. Provider/hardware/latency/fidelity/A15/authentication/tool/public-rollout evidence is not P1's exit gate. Review remains skipped. Downstream workers still need their own committed plans and cleared ownership gates.

## Planner self-check (documentation evidence, not implementation evidence)

- P1 coverage: task 1 covers versioned HTTP/control/binary contracts, mode/state/IDs/internal visibility/delivery/ports; task 2 covers secret settings, flags, finite defaults, public projection and legacy config compatibility; task 3 covers browser mirroring and user-edit preservation; task 4 covers the four backend additions and existing scripts; task 5 covers reusable independent binary/control/mock-config fixtures.
- There is no downstream implementation in this plan. Frame/session ordering, identity/Origin validation, filtering, durability, reservations, provider behavior, budgets, audio/UI and composition remain assigned to their existing owners.
- Documentation links and exact paths must be checked before this plan's documentation commit. The code snippets are **planned** red/green checks; none are reported executed by the planner.
- Framework documentation consulted through Context7 on 8 October 2026: [Nest ws adapter](https://docs.nestjs.com/websockets/adapter) (native browser compatibility and default `{ event, data }` parsing), [Nest gateways](https://docs.nestjs.com/websockets/gateways), [Zod 3](https://v3.zod.dev/) (strict objects, optional fields, transforms and refinements). Installed manifests, not generic latest documentation, determine package ranges.

**Planner validation performed, 8 October 2026 (Node v24.18.0):** Five-task structure, no-placeholder scan, and local document links passed. A read-only Node/TypeScript check assembled the full planned file bodies and additive edits in an in-memory compiler host: zero diagnostics on planned source in either package. In-memory checks also passed for all control-fixture guards, independent golden-frame round trip, 12 distinct server-event types, default configuration/public projection, invalid-flag rejection, and the unknown-delivery fixture. No implementation files were written, dependencies installed, application suites run, or provider/hardware evidence collected. These are plan-consistency checks, not P1 worker completion.
