# Live Voice WebRTC Transport Contracts, Configuration & Dependencies (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the shared WebRTC/LiveKit admission, media, and control contracts, validate server-only LiveKit environment/bootstrap configuration without disabling text or dictation, pin the minimal LiveKit SDK dependencies, redact participant JWTs, and provide deterministic fixtures for downstream plans P2, P3, P4, and P6.

**Architecture:** Extend the existing portable voice wire contract (`backend/src/contracts/voice-wire.ts` and `frontend/src/api/voice-protocol.ts`) with a room/session/epoch-bound `livekit` transport descriptor on `CreateVoiceSessionResponse` for `live` mode while preserving `/api/voice` WebSocket semantics for `dictation` and keeping the existing `VoiceClientEvent` / `VoiceServerEvent` control envelopes over LiveKit reliable data packets (`aurvin.voice.control`). Validate `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` strictly in server bootstrap/environment config (`bootstrap-config.ts`, `voice-config.ts`, `manageable-config.ts`, `config-runtime.ts`) so missing LiveKit config only disables `live` capability while partial or malformed config fails closed.

**Tech Stack:** TypeScript 6 (ESM NodeNext), Vitest 4, Zod 3, `livekit-server-sdk@^2.19.2`, `@livekit/rtc-node@^1.2.1`, `livekit-client@^2.23.0`.

---

## Interfaces Handed to Downstream Plans (P2 / P3 / P4 / P6)

Downstream planners and workers can rely on these exact exported names and shapes without reading the full plan:

### 1. Portable Wire Contracts (`backend/src/contracts/voice-wire.ts` & `frontend/src/api/voice-protocol.ts`)
```typescript
export const LIVEKIT_CONTROL_TOPIC = 'aurvin.voice.control' as const;
export const LIVEKIT_ROOM_PREFIX = 'aurvin-live-' as const;
export const LIVEKIT_AGENT_PREFIX = 'aurvin-agent:' as const;
export const LIVEKIT_TOKEN_MAX_TTL_MS = 30000 as const;
export const LIVEKIT_TEARDOWN_TIMEOUT_MS = 2000 as const;

export const LIVE_WEBRTC_AUDIO: Readonly<{
  browserPublishCodec: 'opus';
  browserClockHz: 48000;
  sttSampleRateHz: 16000;
  sttChannels: 1;
  sttFrameMs: 80;
  sttFrameSamples: 1280;
  sttFrameBytes: 2560;
  ttsSampleRateHz: 24000;
  ttsChannels: 1;
  ttsMaxChunkMs: 200;
  ttsMaxChunkSamples: 4800;
  ttsMaxChunkBytes: 9600;
  quietPeakThreshold: 600;
  quietHangoverMs: 5000;
  quietFrameWindowMs: 20;
  quietPreRollFrames: 4;
}>;

export type VoiceLiveKitTransport = {
  url: string;
  roomName: string;
  participantIdentity: string;
  participantToken: string;
};

export type CreateVoiceSessionResponse = {
  protocolVersion: 1;
  sessionId: string;
  conversationId: string | null;
  mode: VoiceMode;
  connectionEpoch: number;
  websocketUrl: '/api/voice';
  livekit?: VoiceLiveKitTransport;
  expiresAt: string;
  effectiveAudioSettings: { input: InputAudioSettings; output: OutputAudioSettings | null };
  limits: VoiceLimits;
};

export function livekitRoomName(sessionId: string): string;
export function livekitParticipantIdentity(
  userId: string,
  sessionId: string,
  connectionEpoch: number,
): string;
export function livekitAgentIdentity(sessionId: string): string;
export function isLiveKitSignalingUrl(value: unknown): value is string;
export function isCompactJwt(value: unknown): value is string;
export function isVoiceLiveKitTransport(
  value: unknown,
  sessionId?: string,
  connectionEpoch?: number,
): value is VoiceLiveKitTransport;
export function isLiveKitVoiceSessionResponse(
  value: unknown,
): value is CreateVoiceSessionResponse & { mode: 'live'; livekit: VoiceLiveKitTransport };
```

### 2. Backend Config & Admission Ports (`backend/src/contracts/config-runtime.ts`, `backend/src/contracts/voice.ts`, `backend/src/platform/config/*`)
```typescript
// backend/src/contracts/config-runtime.ts
export type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
};
// Added to VoiceConfig:
// livekit?: LiveKitConfig | null;

// backend/src/platform/config/bootstrap-config.ts
export const LIVEKIT_BOOTSTRAP_ENV_NAMES = [
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'LIVEKIT_URL',
] as const;
// Added to BootstrapConfig:
// livekit?: LiveKitConfig | null;

// backend/src/platform/config/voice-config.ts
export function parseLiveKitConfig(
  env: Record<string, string | undefined>,
  nodeEnv?: 'development' | 'test' | 'production',
): LiveKitConfig | null;
export function isLiveKitConfigured(
  livekit: LiveKitConfig | null | undefined,
): livekit is LiveKitConfig;
export function effectiveVoiceModes(
  config: VoiceConfig,
): { dictation: boolean; live: boolean };

// backend/src/contracts/voice.ts
export type LiveKitParticipantGrant = {
  roomCreate: boolean;
  roomJoin: true;
  room: string;
  canPublish: true;
  canSubscribe: true;
  canPublishData: true;
  canPublishSources?: readonly ['microphone'];
  roomAdmin: false;
  roomList: false;
  roomRecord: false;
};
export type LiveKitAdmissionTicket = {
  transport: VoiceLiveKitTransport;
  agentIdentity: string;
  agentToken: string;
  expiresAtMs: number;
  ttlSeconds: number;
};
export interface LiveKitAdmissionPort {
  issue(command: {
    config: LiveKitConfig;
    userId: string;
    sessionId: string;
    connectionEpoch: number;
    connectMs: number;
    nowMs?: number;
  }): Promise<LiveKitAdmissionTicket>;
  teardownRoom(command: {
    config: LiveKitConfig;
    roomName: string;
    timeoutMs?: number;
  }): Promise<void>;
  evictParticipant?(command: {
    config: LiveKitConfig;
    roomName: string;
    participantIdentity: string;
    timeoutMs?: number;
  }): Promise<void>;
}
```

### 3. Shared Test Fixtures (`backend/src/contracts/testing/voice-fixtures.ts`)
```typescript
export function livekitTransportFixture(
  sessionId?: string,
  connectionEpoch?: number,
  userId?: string,
): VoiceLiveKitTransport;
export function createSessionResponseFixture(
  mode: VoiceMode,
  overrides?: Partial<CreateVoiceSessionResponse>,
): CreateVoiceSessionResponse;
export function livekitConfigFixture(): LiveKitConfig;
```

---

## Frozen Lifecycle, Ordering, Audio, Budget & Failure Semantics

1. **Scoped Room, Participant & Token Rules (for P2):**
   - Room name is strictly `livekitRoomName(sessionId)` (`aurvin-live-${sessionId}`).
   - Browser participant identity is strictly `livekitParticipantIdentity(userId, sessionId, connectionEpoch)` (`${userId}:${sessionId}:${connectionEpoch}`).
   - Backend bridge participant identity is `livekitAgentIdentity(sessionId)` (`aurvin-agent:${sessionId}`).
   - Browser `participantToken` TTL is `Math.max(1, Math.ceil(Math.min(LIVEKIT_TOKEN_MAX_TTL_MS, limits.connectMs) / 1000))` seconds (`<= 30s`), with `roomJoin: true`, `room: 'aurvin-live-' + sessionId`, `canPublish: true`, `canSubscribe: true`, `canPublishData: true`, `canPublishSources: ['microphone']`, and `roomCreate: false`, `roomAdmin: false`, `roomList: false`, `roomRecord: false`.
   - Because LiveKit JWT expiry only gates initial join, session termination (`DELETE /api/voice/sessions/:id`, `stop`, unrecoverable disconnect, expiry sweep, or `drain`) must actively disconnect the backend bridge and call `RoomServiceClient.deleteRoom` bounded by `LIVEKIT_TEARDOWN_TIMEOUT_MS` (`2000 ms`).
   - Reconnect within `limits.reconnectMs` (`10000 ms`) increments `connectionEpoch` and issues a fresh `participantIdentity` and `participantToken` bound to the new epoch.

2. **Control Ordering & Envelope Rules (for P3, P4, P6):**
   - Live mode exchanges existing `VoiceClientEvent` and `VoiceServerEvent` JSON strings validated by `parseVoiceControl(json, direction, 'live')` over LiveKit reliable data packets (`DataPacket_Kind.RELIABLE`) on topic `LIVEKIT_CONTROL_TOPIC` (`'aurvin.voice.control'`).
   - Handshake order: `POST /api/voice/sessions` (`mode: 'live'`) -> browser connects `Room(livekit.url, livekit.participantToken)` and publishes mic track -> browser sends `session.start` (`sequence: 0` or monotonic, matching `connectionEpoch`) -> backend bridge opens `LiveFlow` and sends `session.ready` followed by `voice.state` (`input: 'listening'`).
   - Dictation mode remains on `websocketUrl: '/api/voice'` with the 16-byte LE binary PCM header (`encodeVoiceAudio` / `decodeVoiceAudio`) and never receives a `livekit` descriptor.

3. **Audio Rates, Conversion, Quiet Gate & Playout Proof (for P3, P4, P6):**
   - Browser publishes one mono Opus microphone track (`48000 Hz` WebRTC clock with echo cancellation, noise suppression, auto gain control).
   - Backend bridge subscribes via `@livekit/rtc-node` `AudioStream` at `16000 Hz`, `1` channel, `80 ms` (`1280` samples = `2560` bytes `pcm16`), accumulating exact `2560`-byte chunks before passing to the 5-second quiet gate (`quietPeakThreshold: 600`, `quietHangoverMs: 5000`) and `LiveFlow.input(pcm)`.
   - Deepgram Flux TTS emits `24000 Hz`, `1` channel `pcm16` chunks (up to `200 ms` / `4800` samples / `9600` bytes). Backend bridge copies unaligned buffers into an aligned `Int16Array` and queues frames into `AudioSource(24000, 1, limits.outputQueueMs)`.
   - On barge-in/interruption (`StartOfTurn` or `response.interrupt`), `sink.invalidate({ turnId, responseId })` synchronously calls `audioSource.clearQueue()` and sends `response.cancelled`.
   - Track publication (`captureFrame`) is **not** playback confirmation: `LiveFlow.completePlayback` and `VoiceDelivery.settle` mark a turn `completed` only after both provider `speech-completed` and browser `playback.progress` (`playedSamples === generatedSamples`).

4. **Failure Code Mapping:**
   - Reuses existing `VOICE_ERROR_CODES` without wire additions:
     - Room join / ICE / signaling connect timeout -> `VOICE_CONNECT_TIMEOUT`
     - Reconnect window expired -> `VOICE_RECONNECT_TIMEOUT`
     - Stale epoch / superseded participant -> `STALE_CONNECTION_EPOCH`
     - Cross-session / identity / room mismatch -> `VOICE_BINDING_MISMATCH`
     - Unconfigured live mode or missing LiveKit/Deepgram config -> `VOICE_DISABLED`
     - STT / TTS provider fault -> `STT_UNAVAILABLE` / `TTS_UNAVAILABLE`

---

## File Map & Ownership Check

All created/modified files in this plan belong exclusively to P1 (`docs/live-voice-webrtc/state.md:140,241`):

- `backend/package.json` & `backend/package-lock.json` — add `@livekit/rtc-node@^1.2.1` and `livekit-server-sdk@^2.19.2`
- `frontend/package.json` & `frontend/package-lock.json` — add `livekit-client@^2.23.0`
- `backend/src/platform/voice-dependencies.spec.ts` — verify LiveKit SDK declarations, lockfile entries, and forbidden-package exclusions
- `backend/src/contracts/voice-wire.ts` — add LiveKit constants, `VoiceLiveKitTransport`, `CreateVoiceSessionResponse.livekit`, identity/room helpers, and runtime guards
- `frontend/src/api/voice-protocol.ts` — exact portable mirror of `backend/src/contracts/voice-wire.ts`
- `backend/src/contracts/voice.ts` — add `LiveKitParticipantGrant`, `LiveKitAdmissionTicket`, and `LiveKitAdmissionPort`
- `backend/src/contracts/voice.spec.ts` — unit tests for LiveKit transport guards, cross-mode rejection, room/epoch binding, and frontend/backend mirror parity
- `frontend/src/api/voice-protocol.test.ts` — unit tests for frontend LiveKit session response validation and dictation isolation
- `backend/src/contracts/config-runtime.ts` — add `LiveKitConfig` and `VoiceConfig.livekit`
- `backend/src/contracts/config-runtime.spec.ts` — verify `LiveKitConfig` snapshot isolation
- `backend/src/platform/config/voice-config.ts` — add `parseLiveKitConfig`, `isLiveKitConfigured`, `effectiveVoiceModes`, and `publicVoiceConfig` live-mode gating
- `backend/src/platform/config/bootstrap-config.ts` — add `LIVEKIT_BOOTSTRAP_ENV_NAMES` and `BootstrapConfig.livekit` validation
- `backend/src/platform/config/manageable-config.ts` — project frozen `bootstrap.livekit` onto `RuntimeConfigSnapshot.voice.livekit`
- `backend/src/platform/config/voice-config.spec.ts` — test LiveKit env validation, fail-closed partial/malformed config, and public redaction
- `backend/src/platform/config/bootstrap-config.spec.ts` — test `LIVEKIT_*` bootstrap parsing, source-map disjointness, and fail-closed errors
- `backend/src/platform/config/manageable-config.spec.ts` — test `snapshot.voice.livekit` projection and freezing
- `backend/src/platform/security/redact.ts` & `backend/src/platform/security/redact.spec.ts` — redact `participantToken`, `accessToken`, and compact JWTs (`eyJ...`)
- `backend/src/contracts/testing/voice-fixtures.ts` & `backend/src/contracts/testing/voice-fixtures.spec.ts` — add `livekitTransportFixture`, `createSessionResponseFixture`, `livekitConfigFixture`, and `enabledVoiceEnvironment` LiveKit entries

No files outside P1 ownership are modified.

---

### Task 1: Pin LiveKit SDK Dependencies and Update Dependency Contract Guard

**Files:**
- Modify: `backend/package.json:31-46`
- Modify: `frontend/package.json:17-21`
- Modify: `backend/package-lock.json`
- Modify: `frontend/package-lock.json`
- Modify: `backend/src/platform/voice-dependencies.spec.ts:1-59`

- [ ] **Step 1: Write the failing dependency guard test in `backend/src/platform/voice-dependencies.spec.ts`**

Replace `backend/src/platform/voice-dependencies.spec.ts` with:

```typescript
/**
 * ============================================================================
 * FILE: voice-dependencies.spec.ts
 * LOCATION: backend/src/platform/voice-dependencies.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify package manifests, lockfile versions, and execution scripts for voice support.
 *
 * ROLE IN PROJECT:
 *    Ensures that Nest WebSocket platform packages, ws library, and LiveKit WebRTC SDKs
 *    match required version ranges, avoid forbidden SDK bloat, and maintain build scripts.
 *
 * KEY COMPONENTS:
 *    - Direct dependency and lockfile alignment tests
 *    - SDK exclusion tests (@deepgram/sdk, @livekit/agents, @livekit/components-react)
 *    - Build and test script integrity tests
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const backend = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const frontend = JSON.parse(readFileSync(new URL('../../../frontend/package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
const frontendLock = JSON.parse(readFileSync(new URL('../../../frontend/package-lock.json', import.meta.url), 'utf8'));

describe('voice dependency contract', () => {
  it('declares matching Nest ws transport, direct ws, and pinned LiveKit SDKs without bloat', () => {
    expect(backend.dependencies['@nestjs/websockets']).toBe(backend.dependencies['@nestjs/common']);
    expect(backend.dependencies['@nestjs/platform-ws']).toBe(backend.dependencies['@nestjs/common']);
    expect(backend.dependencies.ws).toBe('^8.18.0');
    expect(backend.dependencies['@livekit/rtc-node']).toBe('^1.2.1');
    expect(backend.dependencies['livekit-server-sdk']).toBe('^2.19.2');
    expect(backend.devDependencies['@types/ws']).toBe('^8.5.14');
    for (const name of ['@nestjs/websockets', '@nestjs/platform-ws', 'ws', '@livekit/rtc-node', 'livekit-server-sdk']) {
      expect(lock.packages[''].dependencies[name]).toBe(backend.dependencies[name]);
      expect(lock.packages[`node_modules/${name}`]?.version).toBeTruthy();
    }
    expect(lock.packages[''].devDependencies['@types/ws']).toBe('^8.5.14');
    expect(lock.packages['node_modules/@types/ws'].version).toBeTruthy();
    for (const forbidden of ['@deepgram/sdk', '@livekit/agents', 'livekit-client']) {
      expect(backend.dependencies[forbidden]).toBeUndefined();
      expect(backend.devDependencies[forbidden]).toBeUndefined();
    }
    expect(frontend.dependencies).toEqual({
      '@ozymandiasthegreat/vad': '2.0.7',
      'livekit-client': '^2.23.0',
      react: '^19.2.8',
      'react-dom': '^19.2.8',
    });
    expect(frontendLock.packages[''].dependencies['@ozymandiasthegreat/vad']).toBe('2.0.7');
    expect(frontendLock.packages['node_modules/@ozymandiasthegreat/vad'].version).toBe('2.0.7');
    expect(frontendLock.packages[''].dependencies['livekit-client']).toBe('^2.23.0');
    expect(frontendLock.packages['node_modules/livekit-client']?.version).toBeTruthy();
    const allFrontend = { ...frontend.dependencies, ...frontend.devDependencies };
    for (const name of [
      'ws',
      '@types/ws',
      '@deepgram/sdk',
      '@nestjs/websockets',
      '@nestjs/platform-ws',
      '@livekit/agents',
      '@livekit/components-react',
      '@livekit/rtc-node',
      'livekit-server-sdk',
    ]) {
      expect(allFrontend[name]).toBeUndefined();
    }
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

- [ ] **Step 2: Run the test to verify it fails**

Run in `backend/`:
```powershell
npm test -- src/platform/voice-dependencies.spec.ts
```
Expected: FAIL with `expected undefined to be '^1.2.1'`.

- [ ] **Step 3: Add the pinned LiveKit dependencies to `backend/package.json` and `frontend/package.json` and install**

In `backend/package.json`, update `dependencies` (lines 31–46):
```json
  "dependencies": {
    "@langchain/core": "^1.2.16",
    "@langchain/langgraph": "^1.4.19",
    "@langchain/langgraph-checkpoint-mongodb": "^1.4.1",
    "@langchain/openrouter": "^0.4.17",
    "@livekit/rtc-node": "^1.2.1",
    "@nestjs/common": "^12.0.1",
    "@nestjs/core": "^12.0.1",
    "@nestjs/platform-express": "^12.0.1",
    "@nestjs/platform-ws": "^12.0.1",
    "@nestjs/websockets": "^12.0.1",
    "livekit-server-sdk": "^2.19.2",
    "mongodb": "^6.21.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "ws": "^8.18.0",
    "zod": "^3.25.32"
  },
```

In `frontend/package.json`, update `dependencies` (lines 17–21):
```json
  "dependencies": {
    "@ozymandiasthegreat/vad": "2.0.7",
    "livekit-client": "^2.23.0",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
```

Then run `npm install` in `backend/` and `frontend/` to update `package-lock.json` and install the prebuilt packages:
```powershell
cd backend; npm install; cd ../frontend; npm install; cd ..
```

- [ ] **Step 4: Run the dependency contract test to verify it passes**

Run in `backend/`:
```powershell
npm test -- src/platform/voice-dependencies.spec.ts
```
Expected: PASS (2 passed).

- [ ] **Step 5: Commit Task 1**

```powershell
git add backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json backend/src/platform/voice-dependencies.spec.ts
git commit -m "build(voice): pin livekit server, rtc-node, and browser client SDKs"
```

---

### Task 2: Extend Portable Voice Wire Contracts & Guards (`voice-wire.ts` & `voice-protocol.ts`)

**Files:**
- Modify: `backend/src/contracts/voice-wire.ts:51-147,218-226`
- Modify: `frontend/src/api/voice-protocol.ts:51-147,218-226`
- Modify: `backend/src/contracts/voice.spec.ts:27-68,224-230`
- Modify: `frontend/src/api/voice-protocol.test.ts:23-70`

- [ ] **Step 1: Write failing contract tests in `backend/src/contracts/voice.spec.ts` and `frontend/src/api/voice-protocol.test.ts`**

In `backend/src/contracts/voice.spec.ts`, update imports at lines 27–32 to include the new exports and add a `describe('livekit transport descriptor and audio boundaries')` test block before the final `it('mirrors the entire portable voice contract')` test:

```typescript
import {
  DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO, isVoiceClientEvent,
  isVoiceServerEvent, isCreateVoiceSessionRequest, isCreateVoiceSessionResponse,
  isVoiceLiveKitTransport, isLiveKitVoiceSessionResponse, livekitRoomName,
  livekitParticipantIdentity, livekitAgentIdentity, LIVEKIT_CONTROL_TOPIC,
  LIVEKIT_TOKEN_MAX_TTL_MS, LIVEKIT_TEARDOWN_TIMEOUT_MS, LIVE_WEBRTC_AUDIO,
  parseVoiceControl, CANVAS_ARTIFACT_LIMITS, isCanvasArtifactId,
  isCanvasArtifactSource, isCanvasArtifactProjection, isCanvasArtifactProjectionList,
} from './voice-wire.js';
```

Add the following test in `backend/src/contracts/voice.spec.ts` right before `it('mirrors the entire portable voice contract')`:

```typescript
  it('validates scoped LiveKit transport descriptors for live mode and rejects cross-mode or malformed descriptors', () => {
    expect(LIVEKIT_CONTROL_TOPIC).toBe('aurvin.voice.control');
    expect(LIVEKIT_TOKEN_MAX_TTL_MS).toBe(30000);
    expect(LIVEKIT_TEARDOWN_TIMEOUT_MS).toBe(2000);
    expect(LIVE_WEBRTC_AUDIO).toEqual({
      browserPublishCodec: 'opus',
      browserClockHz: 48000,
      sttSampleRateHz: 16000,
      sttChannels: 1,
      sttFrameMs: 80,
      sttFrameSamples: 1280,
      sttFrameBytes: 2560,
      ttsSampleRateHz: 24000,
      ttsChannels: 1,
      ttsMaxChunkMs: 200,
      ttsMaxChunkSamples: 4800,
      ttsMaxChunkBytes: 9600,
      quietPeakThreshold: 600,
      quietHangoverMs: 5000,
      quietFrameWindowMs: 20,
      quietPreRollFrames: 4,
    });
    expect(livekitRoomName('voice-1')).toBe('aurvin-live-voice-1');
    expect(livekitParticipantIdentity('aurvin-dev-user', 'voice-1', 2)).toBe('aurvin-dev-user:voice-1:2');
    expect(livekitAgentIdentity('voice-1')).toBe('aurvin-agent:voice-1');

    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJlMTIzNDU2';
    const livekit = {
      url: 'wss://livekit.example.com',
      roomName: 'aurvin-live-voice-1',
      participantIdentity: 'aurvin-dev-user:voice-1:1',
      participantToken: jwt,
    };
    expect(isVoiceLiveKitTransport(livekit, 'voice-1', 1)).toBe(true);
    expect(isVoiceLiveKitTransport({ ...livekit, url: 'ws://127.0.0.1:7880' }, 'voice-1', 1)).toBe(true);

    const baseResponse = {
      protocolVersion: 1 as const,
      sessionId: 'voice-1',
      conversationId: null,
      mode: 'live' as const,
      connectionEpoch: 1,
      websocketUrl: '/api/voice' as const,
      expiresAt: '2026-11-05T12:00:00.000Z',
      effectiveAudioSettings: { input: INPUT_AUDIO, output: OUTPUT_AUDIO },
      limits: DEFAULT_VOICE_LIMITS,
    };
    const liveWithWebRtc = { ...baseResponse, livekit };
    expect(isCreateVoiceSessionResponse(liveWithWebRtc)).toBe(true);
    expect(isLiveKitVoiceSessionResponse(liveWithWebRtc)).toBe(true);
    expect(isCreateVoiceSessionResponse(baseResponse)).toBe(true);
    expect(isLiveKitVoiceSessionResponse(baseResponse)).toBe(false);

    const dictationResponse = {
      ...baseResponse,
      mode: 'dictation' as const,
      effectiveAudioSettings: { input: INPUT_AUDIO, output: null },
    };
    expect(isCreateVoiceSessionResponse(dictationResponse)).toBe(true);
    expect(isCreateVoiceSessionResponse({ ...dictationResponse, livekit })).toBe(false);

    for (const invalidLiveKit of [
      undefined,
      null,
      {},
      { ...livekit, url: 'https://livekit.example.com' },
      { ...livekit, url: 'wss://user:secret@livekit.example.com' },
      { ...livekit, url: 'wss://livekit.example.com/rtc' },
      { ...livekit, url: 'wss://livekit.example.com?token=1' },
      { ...livekit, url: 'wss://livekit.example.com/' },
      { ...livekit, roomName: 'aurvin-live-other-session' },
      { ...livekit, participantIdentity: 'aurvin-dev-user:voice-1:0' },
      { ...livekit, participantIdentity: 'aurvin-dev-user:other:1' },
      { ...livekit, participantIdentity: ':voice-1:1' },
      { ...livekit, participantIdentity: 'bad:user:voice-1:1' },
      { ...livekit, participantToken: 'not-a-jwt' },
      { ...livekit, apiSecret: 'leaked' },
    ]) {
      expect(isCreateVoiceSessionResponse({ ...baseResponse, livekit: invalidLiveKit })).toBe(false);
      expect(isLiveKitVoiceSessionResponse({ ...baseResponse, livekit: invalidLiveKit })).toBe(false);
    }
  });
```

In `frontend/src/api/voice-protocol.test.ts`, update imports at lines 23–26 and extend the `it('accepts safe public/session config without keys, URLs or model selection')` test (lines 56–69):

```typescript
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO, VOICE_ROUTES,
  LIVEKIT_CONTROL_TOPIC, LIVE_WEBRTC_AUDIO, isCreateVoiceSessionResponse,
  isLiveKitVoiceSessionResponse, isVoiceLiveKitTransport, isPublicVoiceConfig,
  livekitRoomName, livekitParticipantIdentity, parseVoiceControl,
  CANVAS_ARTIFACT_LIMITS, isCanvasArtifactId, isCanvasArtifactSource,
  isCanvasArtifactProjection, isCanvasArtifactProjectionList } from './voice-protocol'
```

And in `it('accepts safe public/session config without keys, URLs or model selection')` in `frontend/src/api/voice-protocol.test.ts`:

```typescript
  it('accepts safe public/session config without keys, URLs or model selection', () => {
    expect(LIVEKIT_CONTROL_TOPIC).toBe('aurvin.voice.control')
    expect(LIVE_WEBRTC_AUDIO.sttFrameBytes).toBe(2560)
    const pub = { protocolVersion: 1, enabledModes: { dictation: false, live: false },
      supportedLocales: ['en-US'], limits: DEFAULT_VOICE_LIMITS,
      inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO }
    expect(isPublicVoiceConfig(pub)).toBe(true)
    expect(isPublicVoiceConfig({ ...pub, apiKey: 'key' })).toBe(false)
    expect(isPublicVoiceConfig({ ...pub, livekitUrl: 'wss://livekit.example.com' })).toBe(false)
    const livekit = {
      url: 'ws://127.0.0.1:7880',
      roomName: livekitRoomName('voice-1'),
      participantIdentity: livekitParticipantIdentity('aurvin-dev-user', 'voice-1', 1),
      participantToken: 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJlMTIzNDU2',
    }
    expect(isVoiceLiveKitTransport(livekit, 'voice-1', 1)).toBe(true)
    const created = { protocolVersion: 1, sessionId: 'voice-1', conversationId: null,
      mode: 'live', connectionEpoch: 1, websocketUrl: '/api/voice',
      expiresAt: '2026-10-08T00:20:00Z', limits: DEFAULT_VOICE_LIMITS,
      effectiveAudioSettings: { input: INPUT_AUDIO, output: OUTPUT_AUDIO } }
    expect(isCreateVoiceSessionResponse(created)).toBe(true)
    expect(isLiveKitVoiceSessionResponse(created)).toBe(false)
    expect(isCreateVoiceSessionResponse({ ...created, livekit })).toBe(true)
    expect(isLiveKitVoiceSessionResponse({ ...created, livekit })).toBe(true)
    expect(isCreateVoiceSessionResponse({ ...created, websocketUrl: 'wss://provider/?key=secret' })).toBe(false)
    expect(isCreateVoiceSessionResponse({ ...created, mode: 'dictation' })).toBe(false)
    expect(isCreateVoiceSessionResponse({
      ...created,
      mode: 'dictation',
      effectiveAudioSettings: { input: INPUT_AUDIO, output: null },
      livekit,
    })).toBe(false)
  })
```

- [ ] **Step 2: Run the backend and frontend protocol tests to verify they fail**

Run in `backend/`:
```powershell
npm test -- src/contracts/voice.spec.ts
```
Run in `frontend/`:
```powershell
npm test -- src/api/voice-protocol.test.ts
```
Expected: FAIL because `LIVEKIT_CONTROL_TOPIC`, `LIVE_WEBRTC_AUDIO`, `isVoiceLiveKitTransport`, and `isLiveKitVoiceSessionResponse` are not yet defined.

- [ ] **Step 3: Implement the portable LiveKit contract and guards in `backend/src/contracts/voice-wire.ts` and `frontend/src/api/voice-protocol.ts`**

In **both** `backend/src/contracts/voice-wire.ts` and `frontend/src/api/voice-protocol.ts` (keeping the body from `export const VOICE_PROTOCOL_VERSION` to the end of the file byte-for-byte identical):

1. Right after `export const MAX_VOICE_CONTROL_BYTES = 131072;` (line 51), add:
```typescript
export const LIVEKIT_CONTROL_TOPIC = 'aurvin.voice.control' as const;
export const LIVEKIT_ROOM_PREFIX = 'aurvin-live-' as const;
export const LIVEKIT_AGENT_PREFIX = 'aurvin-agent:' as const;
export const LIVEKIT_TOKEN_MAX_TTL_MS = 30000 as const;
export const LIVEKIT_TEARDOWN_TIMEOUT_MS = 2000 as const;
export const LIVE_WEBRTC_AUDIO = Object.freeze({
  browserPublishCodec: 'opus',
  browserClockHz: 48000,
  sttSampleRateHz: 16000,
  sttChannels: 1,
  sttFrameMs: 80,
  sttFrameSamples: 1280,
  sttFrameBytes: 2560,
  ttsSampleRateHz: 24000,
  ttsChannels: 1,
  ttsMaxChunkMs: 200,
  ttsMaxChunkSamples: 4800,
  ttsMaxChunkBytes: 9600,
  quietPeakThreshold: 600,
  quietHangoverMs: 5000,
  quietFrameWindowMs: 20,
  quietPreRollFrames: 4,
} as const);
```

2. Update `CreateVoiceSessionResponse` (lines 94–98) to add `VoiceLiveKitTransport` and `livekit?: VoiceLiveKitTransport`:
```typescript
export type VoiceLiveKitTransport = {
  url: string;
  roomName: string;
  participantIdentity: string;
  participantToken: string;
};
export type CreateVoiceSessionResponse = { protocolVersion: 1; sessionId: string;
  conversationId: string | null; mode: VoiceMode; connectionEpoch: number;
  websocketUrl: '/api/voice'; livekit?: VoiceLiveKitTransport; expiresAt: string;
  effectiveAudioSettings: { input: InputAudioSettings; output: OutputAudioSettings | null };
  limits: VoiceLimits };
```

3. Replace `isCreateVoiceSessionResponse` (lines 218–225) with the LiveKit helper functions and updated guards:
```typescript
export function livekitRoomName(sessionId: string): string {
  return `${LIVEKIT_ROOM_PREFIX}${sessionId}`;
}
export function livekitParticipantIdentity(
  userId: string,
  sessionId: string,
  connectionEpoch: number,
): string {
  return `${userId}:${sessionId}:${connectionEpoch}`;
}
export function livekitAgentIdentity(sessionId: string): string {
  return `${LIVEKIT_AGENT_PREFIX}${sessionId}`;
}
export function isLiveKitSignalingUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 ||
      value !== value.trim() || /[\u0000-\u0020\u007f]/u.test(value) || value.endsWith('/')) {
    return false;
  }
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  return (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') &&
    parsed.username === '' && parsed.password === '' &&
    parsed.pathname === '/' && parsed.search === '' && parsed.hash === '' &&
    parsed.hostname.length > 0;
}
export function isCompactJwt(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 4096 &&
    /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}$/.test(value);
}
export function isVoiceLiveKitTransport(
  value: unknown,
  sessionId?: string,
  connectionEpoch?: number,
): value is VoiceLiveKitTransport {
  if (!exact(value, {
    url: isLiveKitSignalingUrl,
    roomName: v => id(v) && (v as string).startsWith(LIVEKIT_ROOM_PREFIX) &&
      (v as string).length > LIVEKIT_ROOM_PREFIX.length,
    participantIdentity: id,
    participantToken: isCompactJwt,
  })) return false;
  const v = value as VoiceLiveKitTransport;
  const parts = v.participantIdentity.split(':');
  if (parts.length !== 3) return false;
  const [userPart, sessionPart, epochPart] = parts;
  if (!userPart || userPart.length > 128 || /[\u0000-\u0020\u007f]/u.test(userPart)) return false;
  if (!sessionPart || !/^(?:0|[1-9]\d*)$/.test(epochPart)) return false;
  const parsedEpoch = Number(epochPart);
  if (!uint(parsedEpoch)) return false;
  if (v.roomName !== livekitRoomName(sessionPart)) return false;
  if (sessionId !== undefined && sessionPart !== sessionId) return false;
  if (connectionEpoch !== undefined && parsedEpoch !== connectionEpoch) return false;
  return true;
}
export function isCreateVoiceSessionResponse(value: unknown): value is CreateVoiceSessionResponse {
  if (!record(value)) return false;
  const hasLivekit = Object.hasOwn(value, 'livekit');
  const baseShape: Shape = {
    protocolVersion: oneOf(1), sessionId: id, conversationId: nullable(id),
    mode: oneOf('dictation', 'live'), connectionEpoch: uint, websocketUrl: oneOf('/api/voice'),
    expiresAt: v => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)),
    effectiveAudioSettings: audio, limits: isVoiceLimits,
    ...(hasLivekit ? { livekit: () => true } : {}),
  };
  if (!exact(value, baseShape)) return false;
  const v = value as CreateVoiceSessionResponse;
  if (v.mode === 'dictation') {
    return !hasLivekit && v.effectiveAudioSettings.output === null;
  }
  if (!output(v.effectiveAudioSettings.output)) return false;
  return !hasLivekit || isVoiceLiveKitTransport(v.livekit, v.sessionId, v.connectionEpoch);
}
export function isLiveKitVoiceSessionResponse(
  value: unknown,
): value is CreateVoiceSessionResponse & { mode: 'live'; livekit: VoiceLiveKitTransport } {
  return isCreateVoiceSessionResponse(value) && value.mode === 'live' &&
    isVoiceLiveKitTransport(value.livekit, value.sessionId, value.connectionEpoch);
}
```

- [ ] **Step 4: Run the backend and frontend protocol tests to verify they pass**

Run in `backend/`:
```powershell
npm test -- src/contracts/voice.spec.ts
```
Run in `frontend/`:
```powershell
npm test -- src/api/voice-protocol.test.ts src/api/testing/voice-fixtures.test.ts
```
Expected: PASS in both packages (including the byte-for-byte mirror parity checks).

- [ ] **Step 5: Commit Task 2**

```powershell
git add backend/src/contracts/voice-wire.ts frontend/src/api/voice-protocol.ts backend/src/contracts/voice.spec.ts frontend/src/api/voice-protocol.test.ts
git commit -m "feat(contracts): add LiveKit transport descriptor and wire guards"
```

---

### Task 3: Add Backend LiveKit Admission Ports, Config Runtime Types & Shared Fixtures

**Files:**
- Modify: `backend/src/contracts/config-runtime.ts:38-46`
- Modify: `backend/src/contracts/config-runtime.spec.ts:21-54`
- Modify: `backend/src/contracts/voice.ts:27-30,117-126`
- Modify: `backend/src/contracts/testing/voice-fixtures.ts:22-90`
- Modify: `backend/src/contracts/testing/voice-fixtures.spec.ts:21-48`

- [ ] **Step 1: Write failing tests in `backend/src/contracts/config-runtime.spec.ts` and `backend/src/contracts/testing/voice-fixtures.spec.ts`**

In `backend/src/contracts/testing/voice-fixtures.spec.ts`, update imports and assertions:
```typescript
import { describe, expect, it } from 'vitest';
import { decodeVoiceAudio, encodeVoiceAudio } from '../voice-audio.js';
import {
  isCreateVoiceSessionResponse,
  isLiveKitVoiceSessionResponse,
  parseVoiceControl,
} from '../voice-wire.js';
import { loadConfig } from '../../platform/config/load-config.js';
import { voiceDeliveryRecordSchema } from '../voice.js';
import {
  goldenInputFrame,
  goldenOutputFrame,
  clientControls,
  serverControls,
  disabledVoiceEnvironment,
  enabledVoiceEnvironment,
  deliveryFixture,
  createSessionFixture,
  createSessionResponseFixture,
  livekitTransportFixture,
  livekitConfigFixture,
} from './voice-fixtures.js';

describe('shared voice fixtures', () => {
  it('uses independent golden frame bytes and returns fresh buffers', () => {
    const first = goldenInputFrame();
    expect(encodeVoiceAudio(decodeVoiceAudio(first))).toEqual(first);
    expect(decodeVoiceAudio(goldenOutputFrame()).pcm).toEqual(new Uint8Array([255, 127]));
    first[0] = 0;
    expect(goldenInputFrame()[0]).toBe(175);
  });
  it('provides every control event, both session response modes, and LiveKit fixtures', () => {
    for (const row of clientControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'client', row.mode)).toEqual(row.event);
    for (const row of serverControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'server', row.mode)).toEqual(row.event);
    expect(new Set(clientControls().map(row => row.event.type)).size).toBe(9);
    expect(new Set(serverControls().map(row => row.event.type)).size).toBe(12);
    expect(createSessionFixture('dictation').conversationId).toBeNull();
    const dictationRes = createSessionResponseFixture('dictation');
    expect(isCreateVoiceSessionResponse(dictationRes)).toBe(true);
    expect(dictationRes.livekit).toBeUndefined();
    const liveRes = createSessionResponseFixture('live');
    expect(isLiveKitVoiceSessionResponse(liveRes)).toBe(true);
    expect(liveRes.livekit).toEqual(livekitTransportFixture('voice-1', 1));
    expect(livekitConfigFixture().url).toBe('ws://127.0.0.1:7880');
    expect(loadConfig(disabledVoiceEnvironment()).voice.enabledModes.live).toBe(false);
    expect(loadConfig(enabledVoiceEnvironment()).voice.enabledModes).toEqual({ dictation: true, live: true });
    expect(voiceDeliveryRecordSchema.parse(deliveryFixture()).status).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run the fixture test to verify it fails**

Run in `backend/`:
```powershell
npm test -- src/contracts/testing/voice-fixtures.spec.ts
```
Expected: FAIL with `createSessionResponseFixture is not a function` (or missing export).

- [ ] **Step 3: Implement `LiveKitConfig`, `LiveKitAdmissionPort`, and shared LiveKit fixtures**

In `backend/src/contracts/config-runtime.ts` (lines 38–46), add `LiveKitConfig` and `livekit?: LiveKitConfig | null` to `VoiceConfig`:
```typescript
export type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
};

export type VoiceConfig = {
  enabledModes: { dictation: boolean; live: boolean }; limits: VoiceLimits;
  deepgram: { apiKey: string; apiBase: string; dictationModel: 'nova-3';
    liveModel: 'flux-general-en'; ttsModel: 'flux-haley-en' | 'flux-alexis-en' | 'flux-priya-en';
    endpointingMs: number; spokenPunctuation: boolean; keyterms: string[];
    eotThreshold: number; eotTimeoutMs: number };
  livekit?: LiveKitConfig | null;
  quotas: ManageableSettings['voice']['quotas']; rates: ManageableSettings['deepgram']['rates'];
};
```

In `backend/src/contracts/voice.ts`, update imports at lines 27–29 and append the LiveKit admission contracts at the end of the file:
```typescript
import type { VoiceMode, InputAudioSettings, OutputAudioSettings, VoiceErrorCode,
  VoiceRecovery, VoiceLiveKitTransport } from './voice-wire.js';
import type { LiveKitConfig } from './config-runtime.js';
```
Append after `ExecutionReservationPort` (line 126) in `backend/src/contracts/voice.ts`:
```typescript
export type LiveKitParticipantGrant = {
  roomCreate: boolean;
  roomJoin: true;
  room: string;
  canPublish: true;
  canSubscribe: true;
  canPublishData: true;
  canPublishSources?: readonly ['microphone'];
  roomAdmin: false;
  roomList: false;
  roomRecord: false;
};
export type LiveKitAdmissionTicket = {
  transport: VoiceLiveKitTransport;
  agentIdentity: string;
  agentToken: string;
  expiresAtMs: number;
  ttlSeconds: number;
};
export interface LiveKitAdmissionPort {
  issue(command: {
    config: LiveKitConfig;
    userId: string;
    sessionId: string;
    connectionEpoch: number;
    connectMs: number;
    nowMs?: number;
  }): Promise<LiveKitAdmissionTicket>;
  teardownRoom(command: {
    config: LiveKitConfig;
    roomName: string;
    timeoutMs?: number;
  }): Promise<void>;
  evictParticipant?(command: {
    config: LiveKitConfig;
    roomName: string;
    participantIdentity: string;
    timeoutMs?: number;
  }): Promise<void>;
}
```

In `backend/src/contracts/testing/voice-fixtures.ts`, update imports at lines 22–24 and add the new fixture helpers:
```typescript
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO,
  livekitRoomName, livekitParticipantIdentity,
  type VoiceMode, type VoiceClientEvent, type VoiceServerEvent,
  type CreateVoiceSessionRequest, type CreateVoiceSessionResponse,
  type VoiceLiveKitTransport } from '../voice-wire.js';
import type { LiveKitConfig } from '../config-runtime.js';
```
Right after `createSessionFixture` (line 34), add:
```typescript
const FIXTURE_COMPACT_JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJlMTIzNDU2';
export function livekitTransportFixture(
  sessionId = 'voice-1',
  connectionEpoch = 1,
  userId = 'aurvin-dev-user',
): VoiceLiveKitTransport {
  return {
    url: 'ws://127.0.0.1:7880',
    roomName: livekitRoomName(sessionId),
    participantIdentity: livekitParticipantIdentity(userId, sessionId, connectionEpoch),
    participantToken: FIXTURE_COMPACT_JWT,
  };
}
export function createSessionResponseFixture(
  mode: VoiceMode,
  overrides: Partial<CreateVoiceSessionResponse> = {},
): CreateVoiceSessionResponse {
  const sessionId = overrides.sessionId ?? 'voice-1';
  const connectionEpoch = overrides.connectionEpoch ?? 1;
  const base: CreateVoiceSessionResponse = {
    protocolVersion: 1,
    sessionId,
    conversationId: null,
    mode,
    connectionEpoch,
    websocketUrl: '/api/voice',
    ...(mode === 'live' ? { livekit: livekitTransportFixture(sessionId, connectionEpoch) } : {}),
    expiresAt: '2026-11-05T12:00:00.000Z',
    effectiveAudioSettings: {
      input: { ...INPUT_AUDIO },
      output: mode === 'live' ? { ...OUTPUT_AUDIO } : null,
    },
    limits: { ...DEFAULT_VOICE_LIMITS },
  };
  return { ...base, ...overrides };
}
```
And in the server-only section at the bottom of `backend/src/contracts/testing/voice-fixtures.ts` (lines 78–84), update `enabledVoiceEnvironment` and add `livekitConfigFixture`:
```typescript
export const livekitConfigFixture = (): LiveKitConfig => ({
  url: 'ws://127.0.0.1:7880',
  apiKey: 'devkey',
  apiSecret: 'offline-fixture-livekit-secret-not-real',
});
export const disabledVoiceEnvironment = (): Record<string, string> => ({
  ENABLE_DICTATION_MODE: 'false', ENABLE_LIVE_VOICE_MODE: 'false', DEEPGRAM_API_KEY: '',
});
export const enabledVoiceEnvironment = (): Record<string, string> => ({
  ENABLE_DICTATION_MODE: 'true',
  ENABLE_LIVE_VOICE_MODE: 'true',
  DEEPGRAM_API_KEY: 'offline-fixture-not-a-key',
  LIVEKIT_URL: 'ws://127.0.0.1:7880',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'offline-fixture-livekit-secret-not-real',
});
```

- [ ] **Step 4: Run the contract and fixture tests to verify they pass**

Run in `backend/`:
```powershell
npm test -- src/contracts/testing/voice-fixtures.spec.ts src/contracts/config-runtime.spec.ts src/contracts/voice.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add backend/src/contracts/config-runtime.ts backend/src/contracts/voice.ts backend/src/contracts/testing/voice-fixtures.ts backend/src/contracts/testing/voice-fixtures.spec.ts
git commit -m "feat(contracts): add LiveKit admission port, config type, and test fixtures"
```

---

### Task 4: Validate LiveKit Server Settings in Bootstrap, Voice, and Manageable Config

**Files:**
- Modify: `backend/src/platform/config/voice-config.ts:23-101`
- Modify: `backend/src/platform/config/bootstrap-config.ts:38-60,120-129,215-275`
- Modify: `backend/src/platform/config/manageable-config.ts:216-236`
- Modify: `backend/src/platform/config/voice-config.spec.ts:25-81`
- Modify: `backend/src/platform/config/bootstrap-config.spec.ts:22-30,135-284`
- Modify: `backend/src/platform/config/manageable-config.spec.ts:58-81,185-200`

- [ ] **Step 1: Write failing tests in `voice-config.spec.ts`, `bootstrap-config.spec.ts`, and `manageable-config.spec.ts`**

In `backend/src/platform/config/voice-config.spec.ts`, update imports at line 25 to include `effectiveVoiceModes, isLiveKitConfigured, parseLiveKitConfig` and add test cases for LiveKit config validation, fail-closed partial/malformed config, and public capability gating:

```typescript
import {
  effectiveVoiceModes,
  isLiveKitConfigured,
  loadVoiceConfig,
  parseLiveKitConfig,
  publicVoiceConfig,
  voiceReadinessIssues,
} from './voice-config.js';
```

Add the following test inside `describe('voice config')` in `backend/src/platform/config/voice-config.spec.ts`:
```typescript
  it('validates LiveKit env settings, fails closed on partial/malformed values, and gates public live capability without disabling dictation', () => {
    const unconfigured = loadVoiceConfig({
      ENABLE_DICTATION_MODE: 'true',
      ENABLE_LIVE_VOICE_MODE: 'true',
      DEEPGRAM_API_KEY: 'fixture-deepgram',
    });
    expect(unconfigured.livekit).toBeNull();
    expect(isLiveKitConfigured(unconfigured.livekit)).toBe(false);
    expect(effectiveVoiceModes(unconfigured)).toEqual({ dictation: true, live: false });
    expect(publicVoiceConfig(unconfigured).enabledModes).toEqual({ dictation: true, live: false });

    const configured = loadVoiceConfig({
      ENABLE_DICTATION_MODE: 'true',
      ENABLE_LIVE_VOICE_MODE: 'true',
      DEEPGRAM_API_KEY: 'fixture-deepgram',
      LIVEKIT_URL: 'wss://livekit.example.com',
      LIVEKIT_API_KEY: 'APIKey123',
      LIVEKIT_API_SECRET: 'secret-value-123456',
    });
    expect(configured.livekit).toEqual({
      url: 'wss://livekit.example.com',
      apiKey: 'APIKey123',
      apiSecret: 'secret-value-123456',
    });
    expect(isLiveKitConfigured(configured.livekit)).toBe(true);
    expect(effectiveVoiceModes(configured)).toEqual({ dictation: true, live: true });
    const pub = publicVoiceConfig(configured);
    expect(pub.enabledModes).toEqual({ dictation: true, live: true });
    const serialized = JSON.stringify(pub);
    for (const secret of ['livekit.example.com', 'APIKey123', 'secret-value-123456']) {
      expect(serialized).not.toContain(secret);
    }

    for (const badEnv of [
      { LIVEKIT_URL: 'wss://livekit.example.com' },
      { LIVEKIT_API_KEY: 'APIKey123', LIVEKIT_API_SECRET: 'secret-value-123456' },
      { LIVEKIT_URL: 'wss://livekit.example.com', LIVEKIT_API_KEY: 'APIKey123' },
      {
        LIVEKIT_URL: 'https://livekit.example.com',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        LIVEKIT_URL: 'ws://livekit.example.com',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        NODE_ENV: 'production',
        LIVEKIT_URL: 'ws://127.0.0.1:7880',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        LIVEKIT_URL: 'wss://user:pass@livekit.example.com',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        LIVEKIT_URL: 'wss://livekit.example.com/path',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        LIVEKIT_URL: 'wss://livekit.example.com/',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        LIVEKIT_URL: 'ws://127.0.0.1:7880',
        LIVEKIT_API_KEY: 'ab',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        LIVEKIT_URL: 'ws://127.0.0.1:7880',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'short',
      },
      {
        LIVEKIT_URL: 'ws://127.0.0.1:7880',
        LIVEKIT_API_KEY: ' APIKey123 ',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
    ]) {
      expect(() => loadVoiceConfig(badEnv)).toThrow('Invalid voice configuration.');
    }
    expect(parseLiveKitConfig({
      LIVEKIT_URL: 'ws://127.0.0.1:7880',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'secret-value-123456',
    }, 'development')?.url).toBe('ws://127.0.0.1:7880');
  });
```

In `backend/src/platform/config/bootstrap-config.spec.ts`:
1. Update imports at lines 22–28 to include `LIVEKIT_BOOTSTRAP_ENV_NAMES`:
```typescript
import {
  BOOTSTRAP_ENV_NAMES,
  LEGACY_MANAGEABLE_ENV_NAMES,
  LIVEKIT_BOOTSTRAP_ENV_NAMES,
  loadBootstrapConfig,
  legacyConfigWarning,
  obsoleteManageableNames,
} from './bootstrap-config.js';
```
2. In `it('parses all 18 infrastructure fields and explicit local recovery')` (line 179), assert `expect(b.livekit).toBeNull();` and add a check for valid and invalid LiveKit bootstrap env settings right after line 227:
```typescript
  it('parses LiveKit bootstrap settings when complete and fails closed on partial or insecure values', () => {
    const b = loadBootstrapConfig({
      LIVEKIT_URL: 'ws://127.0.0.1:7880',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'fixture-livekit-secret',
    });
    expect(b.livekit).toEqual({
      url: 'ws://127.0.0.1:7880',
      apiKey: 'devkey',
      apiSecret: 'fixture-livekit-secret',
    });
    for (const bad of [
      { LIVEKIT_URL: 'ws://127.0.0.1:7880' },
      { LIVEKIT_URL: 'ws://remote.example:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'fixture-livekit-secret' },
      { NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://aurvin.example', LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'fixture-livekit-secret' },
    ]) {
      expect(() => loadBootstrapConfig(bad)).toThrow('Invalid application configuration.');
    }
  });
```
3. In `describe('configuration source map')` (lines 246–255), update the length check to include `LIVEKIT_BOOTSTRAP_ENV_NAMES.length`:
```typescript
    expect(BOOTSTRAP_ENV_NAMES).toHaveLength(
      18 + CALENDAR_BOOTSTRAP_ENV_NAMES.length + LIVEKIT_BOOTSTRAP_ENV_NAMES.length,
    );
    for (const name of bootstrap) expect(manageable.has(name)).toBe(false);
    for (const name of [...CALENDAR_BOOTSTRAP_ENV_NAMES, ...LIVEKIT_BOOTSTRAP_ENV_NAMES]) {
      expect(bootstrap.has(name)).toBe(true);
      expect(manageable.has(name)).toBe(false);
    }
```

In `backend/src/platform/config/manageable-config.spec.ts`, add a test inside `describe('validateManageableSettings')` verifying `buildRuntimeSnapshot` projects and freezes `bootstrap.livekit` without leaking it into `snap.settings`:
```typescript
  it('projects frozen LiveKit bootstrap config onto snapshot.voice without exposing it in manageable settings', () => {
    const b = loadBootstrapConfig({
      LIVEKIT_URL: 'ws://127.0.0.1:7880',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'fixture-livekit-secret',
    });
    const settings = defaultManageableSettings();
    settings.voice.enabledModes = { dictation: true, live: true };
    const snap = buildRuntimeSnapshot(b, {
      revision: 2,
      settings,
      credentials: { openrouter: null, deepgram: 'fixture-deepgram' },
    }, null);
    expect(snap.voice.livekit).toEqual({
      url: 'ws://127.0.0.1:7880',
      apiKey: 'devkey',
      apiSecret: 'fixture-livekit-secret',
    });
    expect(Object.isFrozen(snap.voice.livekit)).toBe(true);
    expect(JSON.stringify(snap.settings)).not.toContain('fixture-livekit-secret');
    expect(JSON.stringify(snap.settings)).not.toContain('devkey');
  });
```

- [ ] **Step 2: Run the config tests to verify they fail**

Run in `backend/`:
```powershell
npm test -- src/platform/config/voice-config.spec.ts src/platform/config/bootstrap-config.spec.ts src/platform/config/manageable-config.spec.ts
```
Expected: FAIL because `parseLiveKitConfig`, `LIVEKIT_BOOTSTRAP_ENV_NAMES`, and `snap.voice.livekit` are not yet implemented.

- [ ] **Step 3: Implement LiveKit config validation in `voice-config.ts`, `bootstrap-config.ts`, and `manageable-config.ts`**

1. In `backend/src/platform/config/voice-config.ts`:
Update imports (lines 22–28) and add `parseLiveKitConfig`, `isLiveKitConfigured`, `effectiveVoiceModes`, and update `loadVoiceConfig` and `publicVoiceConfig`:
```typescript
import { z } from 'zod';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO, isVoiceLimits,
  isLiveKitSignalingUrl, type VoiceLimits, type PublicVoiceConfig } from '../../contracts/voice-wire.js';
import type { LiveKitConfig, VoiceConfig } from '../../contracts/config-runtime.js';

export type { LiveKitConfig, VoiceConfig };

const DEV_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function parseLiveKitConfig(
  env: Record<string, string | undefined>,
  nodeEnv: 'development' | 'test' | 'production' = 'development',
): LiveKitConfig | null {
  const url = env.LIVEKIT_URL ?? '';
  const apiKey = env.LIVEKIT_API_KEY ?? '';
  const apiSecret = env.LIVEKIT_API_SECRET ?? '';
  if (url === '' && apiKey === '' && apiSecret === '') return null;
  if (url === '' || apiKey === '' || apiSecret === '') {
    throw new Error('partial_livekit_config');
  }
  if (!isLiveKitSignalingUrl(url)) {
    throw new Error('invalid_livekit_url');
  }
  const parsed = new URL(url);
  if (
    parsed.protocol === 'ws:' &&
    (nodeEnv === 'production' || !DEV_LOOPBACK_HOSTS.has(parsed.hostname))
  ) {
    throw new Error('insecure_livekit_url');
  }
  if (
    apiKey !== apiKey.trim() ||
    apiKey.length < 3 ||
    apiKey.length > 128 ||
    /[\u0000-\u0020\u007f]/u.test(apiKey)
  ) {
    throw new Error('invalid_livekit_key');
  }
  if (
    apiSecret !== apiSecret.trim() ||
    apiSecret.length < 8 ||
    apiSecret.length > 256 ||
    /[\u0000-\u0020\u007f]/u.test(apiSecret)
  ) {
    throw new Error('invalid_livekit_secret');
  }
  return { url, apiKey, apiSecret };
}

export function isLiveKitConfigured(
  livekit: LiveKitConfig | null | undefined,
): livekit is LiveKitConfig {
  return Boolean(livekit?.url && livekit.apiKey && livekit.apiSecret);
}

export function effectiveVoiceModes(config: VoiceConfig): {
  dictation: boolean;
  live: boolean;
} {
  const hasDeepgram = Boolean(config.deepgram.apiKey);
  const hasLiveKit = config.livekit === undefined ? true : isLiveKitConfigured(config.livekit);
  return {
    dictation: Boolean(config.enabledModes.dictation && hasDeepgram),
    live: Boolean(config.enabledModes.live && hasDeepgram && hasLiveKit),
  };
}
```
In `envSchema` in `backend/src/platform/config/voice-config.ts`, add optional `NODE_ENV`:
```typescript
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
```
In `loadVoiceConfig(env)` in `backend/src/platform/config/voice-config.ts`, compute `const livekit = parseLiveKitConfig(env, e.NODE_ENV);` and include `livekit` in the returned object:
```typescript
    const livekit = parseLiveKitConfig(env, e.NODE_ENV);
    return { enabledModes: { dictation: e.ENABLE_DICTATION_MODE, live: e.ENABLE_LIVE_VOICE_MODE }, limits,
      deepgram: { apiKey: e.DEEPGRAM_API_KEY, apiBase: e.DEEPGRAM_API_BASE,
        dictationModel: e.DEEPGRAM_DICTATION_MODEL, liveModel: e.DEEPGRAM_LIVE_MODEL,
        ttsModel: e.DEEPGRAM_TTS_MODEL, endpointingMs: e.DEEPGRAM_DICTATION_ENDPOINTING_MS,
        spokenPunctuation: e.DEEPGRAM_SPOKEN_PUNCTUATION, keyterms,
        eotThreshold: e.DEEPGRAM_FLUX_EOT_THRESHOLD, eotTimeoutMs: e.DEEPGRAM_FLUX_EOT_TIMEOUT_MS },
      livekit,
      quotas: { identityConcurrent: e.VOICE_IDENTITY_CONCURRENT, globalConcurrent: e.VOICE_GLOBAL_CONCURRENT,
        identityDailyMinutes: e.VOICE_IDENTITY_DAILY_MINUTES, globalDailyMinutes: e.VOICE_GLOBAL_DAILY_MINUTES,
        dailySpendUsd: e.VOICE_DAILY_SPEND_USD }, rates };
```
And in `publicVoiceConfig(config: VoiceConfig)` in `backend/src/platform/config/voice-config.ts`:
```typescript
export function publicVoiceConfig(config: VoiceConfig): PublicVoiceConfig {
  const liveReady = config.livekit === undefined ? true : isLiveKitConfigured(config.livekit);
  return {
    protocolVersion: 1,
    enabledModes: {
      dictation: config.enabledModes.dictation,
      live: Boolean(config.enabledModes.live && liveReady),
    },
    supportedLocales: ['en-US'],
    limits: { ...config.limits },
    inputAudio: { ...INPUT_AUDIO },
    outputAudio: { ...OUTPUT_AUDIO },
  };
}
```

2. In `backend/src/platform/config/bootstrap-config.ts`:
Import `parseLiveKitConfig, type LiveKitConfig` from `./voice-config.js`:
```typescript
import { parseLiveKitConfig, type LiveKitConfig } from './voice-config.js';
```
Export `LIVEKIT_BOOTSTRAP_ENV_NAMES` and spread into `BOOTSTRAP_ENV_NAMES`:
```typescript
export const LIVEKIT_BOOTSTRAP_ENV_NAMES = [
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'LIVEKIT_URL',
] as const;

export const BOOTSTRAP_ENV_NAMES = [
  'AURVIN_CONFIG_ENCRYPTION_KEY',
  'AURVIN_EXECUTOR_TOPOLOGY',
  'AURVIN_LOCAL_CRASH_RECOVERY',
  'AURVIN_USER_ID',
  'CONNECT_TIMEOUT_MS',
  'DEFAULT_PAGE_SIZE',
  'FRONTEND_ORIGIN',
  'MAX_DOCUMENT_BYTES',
  'MAX_MANIFEST_BYTES',
  'MAX_MESSAGE_BYTES',
  'MAX_PAGE_SIZE',
  'MONGODB_DB_NAME',
  'MONGODB_URI',
  'NODE_ENV',
  'PERSISTENCE_PROFILE',
  'PERSISTENCE_TIMEOUT_MS',
  'PORT',
  'SHUTDOWN_DRAIN_MS',
  ...CALENDAR_BOOTSTRAP_ENV_NAMES,
  ...LIVEKIT_BOOTSTRAP_ENV_NAMES,
] as const;
```
Add `livekit?: LiveKitConfig | null;` to `BootstrapConfig` (line 127) and include `livekit: parseLiveKitConfig(env, nodeEnv)` in the return object of `loadBootstrapConfig` (line 269):
```typescript
      encryption: parseEncryptionKey(data.AURVIN_CONFIG_ENCRYPTION_KEY),
      calendar: loadCalendarBootstrap(env, frontendOrigin, data.PORT),
      livekit: parseLiveKitConfig(env, nodeEnv),
```

3. In `backend/src/platform/config/manageable-config.ts`:
In `buildRuntimeSnapshot` (lines 216–234), include `livekit: bootstrap.livekit ? { ...bootstrap.livekit } : null` inside `const voice = freezeDeep({ ... })`:
```typescript
    deepgram: {
      apiKey: candidate.credentials.deepgram ?? '',
      apiBase: DEEPGRAM_API_BASE[clonedSettings.deepgram.region],
      dictationModel: clonedSettings.deepgram.dictationModel,
      liveModel: clonedSettings.deepgram.liveModel,
      ttsModel: clonedSettings.deepgram.ttsModel,
      endpointingMs: clonedSettings.deepgram.endpointingMs,
      spokenPunctuation: clonedSettings.deepgram.spokenPunctuation,
      keyterms: [...clonedSettings.deepgram.keyterms],
      eotThreshold: clonedSettings.deepgram.eotThreshold,
      eotTimeoutMs: clonedSettings.deepgram.eotTimeoutMs,
    },
    livekit: bootstrap.livekit ? { ...bootstrap.livekit } : null,
    quotas: { ...clonedSettings.voice.quotas },
    rates: { ...clonedSettings.deepgram.rates },
```

- [ ] **Step 4: Run the config tests to verify they pass**

Run in `backend/`:
```powershell
npm test -- src/platform/config/voice-config.spec.ts src/platform/config/bootstrap-config.spec.ts src/platform/config/manageable-config.spec.ts src/platform/config/load-config.spec.ts src/platform/config/legacy-config-import.spec.ts
```
Expected: PASS across all config test suites.

- [ ] **Step 5: Commit Task 4**

```powershell
git add backend/src/platform/config/voice-config.ts backend/src/platform/config/bootstrap-config.ts backend/src/platform/config/manageable-config.ts backend/src/platform/config/voice-config.spec.ts backend/src/platform/config/bootstrap-config.spec.ts backend/src/platform/config/manageable-config.spec.ts
git commit -m "feat(config): validate LiveKit bootstrap env settings and gate public live mode"
```

---

### Task 5: Redact LiveKit Participant Tokens and Compact JWTs (`redact.ts`)

**Files:**
- Modify: `backend/src/platform/security/redact.ts:20-24`
- Modify: `backend/src/platform/security/redact.spec.ts:22-42`

- [ ] **Step 1: Write failing redaction tests in `backend/src/platform/security/redact.spec.ts`**

Update `backend/src/platform/security/redact.spec.ts`:
```typescript
/**
 * ============================================================================
 * FILE: redact.spec.ts
 * LOCATION: backend/src/platform/security/redact.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify known secret-bearing values are redacted from objects and strings.
 *
 * ROLE IN PROJECT:
 *    Provides safe logging support without altering ordinary non-secret
 *    application text.
 *
 * KEY COMPONENTS:
 *    - Key-based tests: Redact credential, token, and connection fields.
 *    - Value-based tests: Redact embedded tokens, compact JWTs, and database URIs.
 * ============================================================================
 */

import { redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it('redacts API keys, LiveKit secrets, participant tokens, bearer tokens, and Mongo URIs', () => {
    const redacted = redactSecrets({
      OPENROUTER_API_KEY: 'sk-or-v1-secret',
      LIVEKIT_API_KEY: 'APIKey123',
      LIVEKIT_API_SECRET: 'livekit-secret-value',
      participantToken: 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJlMTIzNDU2',
      accessToken: 'raw-access-token',
      authorization: 'Bearer abc',
      MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/aurvin',
      roomName: 'aurvin-live-voice-1',
      participantIdentity: 'aurvin-dev-user:voice-1:1',
      message: 'hello',
    }) as Record<string, unknown>;
    expect(redacted.OPENROUTER_API_KEY).toBe('[redacted]');
    expect(redacted.LIVEKIT_API_KEY).toBe('[redacted]');
    expect(redacted.LIVEKIT_API_SECRET).toBe('[redacted]');
    expect(redacted.participantToken).toBe('[redacted]');
    expect(redacted.accessToken).toBe('[redacted]');
    expect(redacted.authorization).toBe('[redacted]');
    expect(redacted.MONGODB_URI).toBe('[redacted]');
    expect(redacted.roomName).toBe('aurvin-live-voice-1');
    expect(redacted.participantIdentity).toBe('aurvin-dev-user:voice-1:1');
    expect(redacted.message).toBe('hello');
  });

  it('redacts secrets and compact JWTs embedded in strings', () => {
    expect(String(redactSecrets('mongodb://u:p@localhost:27017'))).toContain(
      '[redacted]',
    );
    expect(String(redactSecrets('sk-or-v1-abcdef'))).toBe('[redacted]');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJlMTIzNDU2';
    expect(String(redactSecrets(`LiveKit join token=${jwt} failed`))).toBe(
      'LiveKit join token=[redacted] failed',
    );
  });
});
```

- [ ] **Step 2: Run the redaction test to verify it fails**

Run in `backend/`:
```powershell
npm test -- src/platform/security/redact.spec.ts
```
Expected: FAIL because `participantToken`, `accessToken`, and compact JWT strings are not yet matched by `SECRET_KEY` / `SECRET_VALUE`.

- [ ] **Step 3: Update `SECRET_KEY` and `SECRET_VALUE` in `backend/src/platform/security/redact.ts`**

In `backend/src/platform/security/redact.ts` (lines 20–24), update the regular expressions:
```typescript
const SECRET_KEY =
  /api[_-]?key|authorization|password|secret|mongo(?:db)?_?uri|connectionstring|(?:participant|access)[_-]?token/i;
const SECRET_VALUE =
  /(?:(?<![a-zA-Z])sk-[a-zA-Z0-9-]+)|(?:Bearer\s+[A-Za-z0-9._-]+)|(?:mongodb(?:\+srv)?:\/\/[^\s]+)|(?:\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b)/gi;
```

- [ ] **Step 4: Run the redaction test to verify it passes**

Run in `backend/`:
```powershell
npm test -- src/platform/security/redact.spec.ts
```
Expected: PASS (2 passed).

- [ ] **Step 5: Commit Task 5**

```powershell
git add backend/src/platform/security/redact.ts backend/src/platform/security/redact.spec.ts
git commit -m "feat(security): redact LiveKit participant tokens and compact JWTs"
```

---

## Final Verification for P1 Worker

After completing Tasks 1–5, run the full P1 verification suite across `backend/` and `frontend/` to confirm build, lint, and test health before reporting completion:

- [ ] **Step 1: Backend focused & full routine test suite**
```powershell
cd backend
npm test -- src/platform/voice-dependencies.spec.ts src/contracts/voice.spec.ts src/contracts/config-runtime.spec.ts src/contracts/testing/voice-fixtures.spec.ts src/platform/config/voice-config.spec.ts src/platform/config/bootstrap-config.spec.ts src/platform/config/manageable-config.spec.ts src/platform/security/redact.spec.ts
npm test
npm run build
npm run lint
```
Expected: All tests pass, `nest build` exits 0, `oxlint --type-aware src/ test/` exits 0.

- [ ] **Step 2: Frontend focused & full routine test suite**
```powershell
cd ../frontend
npm test -- src/api/voice-protocol.test.ts src/api/testing/voice-fixtures.test.ts
npm test
npm run build
npm run lint
```
Expected: All tests pass, `tsc -b && vite build` exits 0, `oxlint` exits 0.

- [ ] **Step 3: Git hygiene and diff check**
```powershell
cd ..
git diff --check
git status --short
```
Expected: `git diff --check` produces no output; no untracked secrets or cross-owner edits exist.
