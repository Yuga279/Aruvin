# Live Voice WebRTC Playback Boundary/Watermark and Control-Packet Limits (P1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the portable voice wire contract with response-bound 24 kHz sample watermarks, explicit playout proof status (`proven` vs `unproven`), and bounded 15 KiB LiveKit reliable control-packet chunking/reassembly so P3, P4, and P6 can prove WebRTC playback progress and transport large Canvas artifacts without fabricating completion or truncating payloads.

**Architecture:** Keep the single portable contract in `backend/src/contracts/voice-wire.ts` and its byte-for-byte mirror `frontend/src/api/voice-protocol.ts` without touching dictation's WebSocket framing or introducing a second control socket. Add `audio.watermark` (plus optional boundary fields on `audio.end` / `response.cancelled` and optional `proof?: 'proven' | 'unproven'` on `playback.progress` / `response.interrupt`) to map server-queued 24 kHz TTS samples onto browser playout, and add `encodeVoiceControlPackets` + `VoiceControlReassembler` with a single-frame fast path (`<= 15360` bytes) and bounded multi-packet reassembly (`15361..131072` bytes).

**Tech Stack:** TypeScript 6 (ESM NodeNext), Vitest 4, Web Standard `TextEncoder` / `TextDecoder` (zero external dependencies in portable wire modules).

---

## 1. What the Browser Can and Cannot Prove on a Continuous WebRTC Audio Track

### What the Browser CANNOT Prove
1. **No per-chunk PCM headers on RTP media:** Unlike the legacy WebSocket binary framing (`encodeVoiceAudio` / `decodeVoiceAudio` with a 16-byte header carrying `sequence`, `offsetMs`, and `pcm`), a LiveKit `RemoteAudioTrack` is a continuous 48 kHz Opus RTP stream. The browser cannot read Aurvin `turnId`, `responseId`, or per-frame sample counts from RTP packets.
2. **WebRTC receiver statistics are not per-response playout proof:** `RemoteAudioTrack.getReceiverStats()` (`totalSamplesReceived`, `totalSamplesDuration`, `concealedSamples`) measures cumulative RTP receiver decode since track subscription—including idle silence between turns, jitter-buffer queuing, and packet-loss concealment (PLC)—not acoustic playout of a specific Aurvin response.
3. **Unclamped wall-clock time after `audio.start` is not proof:** `audio.start` is emitted when TTS synthesis begins (`speech-started`), before the first PCM chunk is queued into `@livekit/rtc-node` `AudioSource` and before RTP packets traverse the SFU and browser jitter buffer. Advancing a timer from `audio.start` without server sample bounds would falsely count TTS startup latency, mid-response synthesis stalls, or muted/paused element time as heard speech.
4. **Hardware speaker emission is outside browser software attestation:** Browser APIs can verify that audio output is unlocked, unmuted, and actively draining a live media track, not physical acoustic output at OS/hardware speakers.

### What the Server and Browser CAN Prove Together (Recommended Honest Model)
1. **Server-supplied 24 kHz sample watermarks (`audio.start`, `audio.watermark`, `audio.end`, `response.cancelled`):**
   - The backend media bridge (`LiveKitOutput` + `LiveFlow`) knows the exact 24 kHz sample origin `firstAudioSample` (`firstAudioSample % 24 === 0`, monotonically increasing across the `connectionEpoch` including any discarded frames from prior interrupted responses) and the exact cumulative 24 kHz samples `queuedSamples` accepted for `(turnId, responseId)`.
   - On `audio.start`, the server announces `firstAudioSample`.
   - On each accepted TTS PCM chunk (`sink.audio`) and on provider synthesis completion (`speech-completed`, *before* waiting for the final `playback.progress` ACK), the server emits `audio.watermark`:
     - `firstAudioSample`: 24 kHz session sample origin of this response (`firstAudioSample % 24 === 0`).
     - `queuedSamples`: cumulative 24 kHz samples queued for this response (`>= 0`).
     - `lastAudioSample`: `firstAudioSample + queuedSamples` (the current upper bound of samples that exist for this response).
     - `final`: `false` while TTS is still streaming chunks; `true` when provider `speech-completed` arrives (`queuedSamples` equals the total generated samples for the response).
2. **Browser watermark-clamped active playout cursor (`clampPlayedSamplesToWatermark`):**
   - Upon `audio.start`, the browser sets its response cursor to `firstAudioSample` and `watermarkLastAudioSample = firstAudioSample`.
   - The browser cursor **never advances** while `watermarkLastAudioSample === firstAudioSample` (before the first non-empty `audio.watermark` arrives) or while output is paused, muted, locked by autoplay (`canPlaybackAudio === false`), or detached.
   - While output is unlocked, unmuted, attached to a live `RemoteAudioTrack`, and `cursor < watermarkLastAudioSample`, the browser advances `cursor` by the active playout clock delta (`activeDeltaSamples = Math.floor(activeElapsedSeconds * 24000)`, retaining fractional sample remainder across polls), clamped via `clampPlayedSamplesToWatermark(firstAudioSample, cursor, activeDeltaSamples, watermarkLastAudioSample)` so `playedSamples` never exceeds `watermarkLastAudioSample`.
   - If TTS stalls mid-response, `cursor` stops at the latest `watermarkLastAudioSample` and does not accumulate credit during the stall.
3. **Explicit `proof?: 'proven' | 'unproven'` when playout cannot be proven:**
   - Both `playback.progress` and `response.interrupt` carry optional `proof?: 'proven' | 'unproven'` (defaulting to `'proven'` when omitted for backward compatibility with existing WebSocket/unit tests).
   - If the browser cannot verify active playout (e.g., output clock/element observation is unavailable, autoplay/gesture is blocked, or the audio element stalls/errors while `cursor < watermarkLastAudioSample`), it must **never** fabricate `playedSamples = watermarkLastAudioSample` with `proof: 'proven'`. Instead, it freezes `playedSamples` at the last verified sample coordinate and reports `proof: 'unproven'`.

### Completion Rule for Live WebRTC Delivery
- **Track publication is NEVER completion:** Calling `audioSource.captureFrame(frame)` or emitting `audio.watermark { final: true }` never marks a turn `completed` or emits `audio.end`.
- **Delivered (`status: 'completed'`):** Requires all four conditions:
  1. The response was not invalidated (`!r.invalid`),
  2. Provider TTS emitted `speech-completed` (`r.completed === true`, `synthesized === true`, total generated samples `r.sent > 0`),
  3. Browser reported `playback.progress` for `(turnId, responseId)` with `proof !== 'unproven'` (`'proven'` or omitted) and `playedSamples === r.wireBase + r.sent` (`lastAudioSample` of the `final: true` watermark),
  4. Durable `VoiceDeliveryRecord` write succeeded (`status: 'completed'`, `textSpoken: textGenerated`, `textRemaining: ''`, `playedSamples: r.sent`).
- **Interrupted / Cancelled (`status: 'interrupted' | 'cancelled'`):**
  - On user barge-in (`StartOfTurn` or `response.interrupt` with `proof !== 'unproven'`) before completion: if no text was sent to TTS (`!this.sent`), settles as `'cancelled'`; if TTS returns a valid `speech-interrupted` prefix split consistent with `playedSamples`, settles as `'interrupted'` with bounded `textSpoken` and `textRemaining`.
- **Unproven (`status: 'unknown'`):**
  - If the browser reports `playback.progress` or `response.interrupt` with `proof: 'unproven'`, or if the WebRTC room disconnects / `VoiceDelivery.settle` times out before `playedSamples === r.wireBase + r.sent` with `proof !== 'unproven'`, `LiveFlow` must **not** call `completePlayback(r)` and `VoiceDelivery.settle` records `status: 'unknown'` (`textSpoken: null`, `textRemaining: null`) honestly.

---

## 2. Exact Interface Handoffs for P3, P4, and P6

### Exported Types, Constants & Helpers (`backend/src/contracts/voice-wire.ts` & `frontend/src/api/voice-protocol.ts`)
```typescript
export const VOICE_PLAYBACK_PROOFS = ['proven', 'unproven'] as const;
export type VoicePlaybackProof = typeof VOICE_PLAYBACK_PROOFS[number];

export const LIVEKIT_MAX_CONTROL_PACKET_BYTES = 15360 as const;
export const LIVEKIT_CONTROL_LIMITS: Readonly<{
  maxPacketBytes: 15360;
  maxMessageBytes: 131072;
  maxChunkBytes: 14336;
  maxChunksPerMessage: 16;
  maxInflightReassemblies: 2;
  reassemblyTimeoutMs: 5000;
}>;

export type VoiceAudioWatermarkPayload = {
  type: 'audio.watermark';
  firstAudioSample: number;
  queuedSamples: number;
  lastAudioSample: number;
  final: boolean;
} & VoiceResponseRef;

// Extended client payloads:
// | ({ type: 'response.interrupt'; playbackPositionMs: number; playedSamples: number; proof?: VoicePlaybackProof } & VoiceResponseRef)
// | ({ type: 'playback.progress'; playedMs: number; playedSamples: number; proof?: VoicePlaybackProof } & VoiceResponseRef)

// Extended server payloads:
// | ({ type: 'audio.start'; sampleRate: 24000; firstAudioSequence: number; firstAudioSample?: number } & VoiceResponseRef)
// | VoiceAudioWatermarkPayload
// | ({ type: 'audio.end' | 'response.cancelled'; lastAudioSequence: number | null;
//     firstAudioSample?: number; lastAudioSample?: number; totalAudioSamples?: number } & VoiceResponseRef)

export type VoiceControlChunkPacket = {
  protocolVersion: 1;
  type: 'control.chunk';
  sessionId: string;
  connectionEpoch: number;
  sequence: number;
  eventId: string;
  turnId?: string;
  responseId?: string;
  chunkIndex: number;
  chunkCount: number;
  totalBytes: number;
  payload: string;
};

export type VoiceControlReassemblyResult<E extends VoiceClientEvent | VoiceServerEvent> =
  | { status: 'complete'; event: E; chunked: boolean; chunkCount: number; totalBytes: number }
  | {
      status: 'partial';
      eventId: string;
      sequence: number;
      turnId?: string;
      responseId?: string;
      chunkIndex: number;
      chunkCount: number;
      receivedBytes: number;
      totalBytes: number;
    };

export function clampPlayedSamplesToWatermark(
  firstAudioSample: number,
  currentPlayedSamples: number,
  activeDeltaSamples: number,
  watermarkLastAudioSample: number,
): number;

export function isVoiceControlChunkPacket(value: unknown): value is VoiceControlChunkPacket;

export function encodeVoiceControlPackets(
  eventOrJson: VoiceClientEvent | VoiceServerEvent | string,
  direction: 'client' | 'server',
  mode: VoiceMode,
): Uint8Array[];

export class VoiceControlReassembler<D extends 'client' | 'server' = 'server'> {
  constructor(
    direction: D,
    mode: VoiceMode,
    binding?: { sessionId: string; connectionEpoch: number },
  );
  readonly pendingAssemblies: number;
  readonly pendingBytes: number;
  clear(): void;
  sweep(nowMs?: number): void;
  push(
    packetBytes: Uint8Array,
    nowMs?: number,
  ): VoiceControlReassemblyResult<D extends 'client' ? VoiceClientEvent : VoiceServerEvent>;
}
```

### Shared Fixture Additions (`backend/src/contracts/testing/voice-fixtures.ts` & `frontend/src/api/testing/voice-fixtures.ts`)
```typescript
export function largeCanvasArtifactFixture(
  overrides?: Partial<VoiceServerEvent & CanvasArtifactPayload>,
): VoiceServerEvent & CanvasArtifactPayload;
```

### Handoff to P3 (Backend Media Bridge & LiveFlow)
1. **`LiveKitOutput` (`backend/src/voice/transport/livekit-output.ts`):**
   - On `event({ type: 'audio.start', ... })`: align `this.cursor = this.outputSamples()` (`% 24 === 0`), record `active = { turnId, responseId, firstAudioSample: this.cursor, queuedSamples: 0, last: null }`, and send `audio.start` with `firstAudioSample: this.cursor`.
   - On `audio(ref, pcm)`: after queuing the `AudioFrame` and advancing `this.cursor += samples.length` (`this.active.queuedSamples += samples.length`), emit `audio.watermark` with `{ type: 'audio.watermark', turnId: ref.turnId, responseId: ref.responseId, firstAudioSample: this.active.firstAudioSample, queuedSamples: this.active.queuedSamples, lastAudioSample: this.cursor, final: false }`.
   - On synthesis completion (`speech-completed` in `LiveFlow.readTts`, *before* `this.completePlayback(r)`): emit `audio.watermark` with `final: true` (`firstAudioSample: r.wireBase, queuedSamples: r.sent, lastAudioSample: r.wireBase + r.sent, final: true`) so the browser learns the final sample ceiling before sending the final `playback.progress` ACK. (Gate emitting `audio.watermark` from `LiveFlow` on `Boolean(this.context.response.livekit)` or an optional `sink.watermark` hook so legacy WebSocket `live.spec.ts` `sink.event` call-list assertions stay unchanged.)
   - On `audio.end` and `invalidate` (`response.cancelled`): include `firstAudioSample`, `lastAudioSample`, and `totalAudioSamples` alongside `lastAudioSequence`.
2. **`LiveFlow` (`backend/src/voice/session/live-flow.ts`):**
   - When `playback.progress` has `proof === 'unproven'`, update `this.wirePlayed` / `this.played` only up to the reported proven prefix and call `hooks.playback`, but **do not** call `this.completePlayback(r)` (even if `e.playedSamples === r.wireBase + r.sent`), ensuring an unproven report never emits `audio.end` or settles as `'completed'`.
   - When `response.interrupt` has `proof === 'unproven'`, invalidate output (`sink.invalidate`) and cancel the turn (`hooks.interrupt`), and force unknown delivery evidence (`resetOutput(r)` / `status: 'unknown'`) rather than sending an unproven `playbackPositionMs` to provider prefix reconciliation.
3. **`LiveKitControls` (`backend/src/voice/transport/livekit-control.ts`):**
   - Outbound `send(payload)` calls `encodeVoiceControlPackets(event, 'server', 'live')` and publishes the returned `1..16` packet `Uint8Array`s in order on `LIVEKIT_CONTROL_TOPIC`.
   - Inbound `receive(...)` feeds each packet through `new VoiceControlReassembler('client', 'live', { sessionId: response.sessionId, connectionEpoch: response.connectionEpoch }).push(bytes)`:
     - Rejects any single packet `> 15360` bytes with `INVALID_VOICE_CONTROL`.
     - Ignores `{ status: 'partial' }` until the final chunk arrives, then applies sequence/eventId fencing to `result.event`.

### Handoff to P4 (Browser Live WebRTC Client & Playback)
1. **`LiveKitVoiceClient` (`frontend/src/api/livekit-voice-client.ts`):**
   - Inbound `RoomEvent.DataReceived`: pass bytes from `livekitAgentIdentity(sessionId)` on `LIVEKIT_CONTROL_TOPIC` into `new VoiceControlReassembler('server', 'live', { sessionId: session.sessionId, connectionEpoch: session.connectionEpoch }).push(bytes)`. When `status === 'complete'`, enforce monotonic `event.sequence` and dispatch `event` (`audio.start`, `audio.watermark`, `audio.end`, `response.cancelled`, `canvas.artifact`, etc.).
   - Outbound `control(payload)`: encode via `encodeVoiceControlPackets(event, 'client', 'live')` and publish each `Uint8Array` via `room.localParticipant.publishData`.
2. **`LiveTrackPlayback` (`frontend/src/features/voice/audio/live-track-playback.ts`):**
   - On `audio.start`: initialize `firstAudioSample = event.firstAudioSample ?? this.cursor`, `cursor = firstAudioSample`, `watermarkLastSample = firstAudioSample`, `finalWatermark = false`, `proof = 'proven'`.
   - On `audio.watermark`: verify matching `(turnId, responseId, firstAudioSample)` and monotonic `lastAudioSample >= watermarkLastSample`; set `watermarkLastSample = event.lastAudioSample` and `finalWatermark = finalWatermark || event.final`.
   - On `progress()`:
     - Advance `cursor` only by active playout duration measured while `room.canPlaybackAudio !== false`, `element.muted === false`, `element.paused === false`, and `track.mediaStreamTrack.readyState === 'live'`, using `clampPlayedSamplesToWatermark(firstAudioSample, cursor, activeDeltaSamples, watermarkLastSample)`.
     - Never advance `cursor` from subscription, `session.ready`, `audio.start`, `audio.end`, or wall time when `watermarkLastSample === firstAudioSample` or output is paused/muted.
     - If output observation is unavailable or the audio element stalls/errors unrecoverably while `watermarkLastSample > cursor`, freeze `cursor` and set `proof = 'unproven'`.
     - `isDrained()` returns `finalWatermark && proof === 'proven' && cursor === watermarkLastSample`.

---

## 3. File Map & Ownership Check

All modified files belong exclusively to P1/P1b (`docs/live-voice-webrtc/state.md:80,128,144`):

- `backend/src/contracts/voice-wire.ts` — add playback proof types, `audio.watermark`, optional sample boundary fields on `audio.end`/`response.cancelled`, `clampPlayedSamplesToWatermark`, `LIVEKIT_MAX_CONTROL_PACKET_BYTES`, `LIVEKIT_CONTROL_LIMITS`, `VoiceControlChunkPacket`, `isVoiceControlChunkPacket`, `encodeVoiceControlPackets`, and `VoiceControlReassembler`.
- `frontend/src/api/voice-protocol.ts` — exact portable mirror of `backend/src/contracts/voice-wire.ts`.
- `backend/src/contracts/voice.spec.ts` — unit tests for watermark validation, sample boundary invariants, clamping helper, proof status, and control packet chunking/reassembly.
- `frontend/src/api/voice-protocol.test.ts` — frontend unit tests for watermark events, proof status, and control packet chunking/reassembly.
- `backend/src/contracts/testing/voice-fixtures.ts` & `backend/src/contracts/testing/voice-fixtures.spec.ts` — add `audio.watermark`, `proof` client controls, sample-bounded `audio.end`/`response.cancelled`, and `largeCanvasArtifactFixture`.
- `frontend/src/api/testing/voice-fixtures.ts` & `frontend/src/api/testing/voice-fixtures.test.ts` — mirror portable control fixtures and `largeCanvasArtifactFixture` so frontend fixture parity tests pass.

No files owned by P2–P8 are modified.

---

### Task 1: Add WebRTC Playback Boundary/Watermark Events, Proof Status & Clamping Helper

**Files:**
- Modify: `backend/src/contracts/voice-wire.ts:130-156,325-381`
- Modify: `frontend/src/api/voice-protocol.ts:130-156,325-381`
- Modify: `backend/src/contracts/voice.spec.ts:27-36,308-315`
- Modify: `frontend/src/api/voice-protocol.test.ts:23-30,108-115`

- [ ] **Step 1: Write the failing watermark, proof, and clamping tests in `backend/src/contracts/voice.spec.ts` and `frontend/src/api/voice-protocol.test.ts`**

In `backend/src/contracts/voice.spec.ts`, update the imports from `./voice-wire.js` (lines 27–35) to include `VOICE_PLAYBACK_PROOFS` and `clampPlayedSamplesToWatermark`:

```typescript
import {
  DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO, isVoiceClientEvent,
  isVoiceServerEvent, isCreateVoiceSessionRequest, isCreateVoiceSessionResponse,
  isVoiceLiveKitTransport, isLiveKitVoiceSessionResponse, livekitRoomName,
  livekitParticipantIdentity, livekitAgentIdentity, LIVEKIT_CONTROL_TOPIC,
  LIVEKIT_TOKEN_MAX_TTL_MS, LIVEKIT_TEARDOWN_TIMEOUT_MS, LIVE_WEBRTC_AUDIO,
  VOICE_PLAYBACK_PROOFS, clampPlayedSamplesToWatermark,
  parseVoiceControl, CANVAS_ARTIFACT_LIMITS, isCanvasArtifactId,
  isCanvasArtifactSource, isCanvasArtifactProjection, isCanvasArtifactProjectionList,
} from './voice-wire.js';
```

And add the following test right before `it('mirrors the entire portable voice contract')` in `backend/src/contracts/voice.spec.ts`:

```typescript
  it('validates 24 kHz playback watermarks, terminal sample bounds, proof status, and watermark clamping', () => {
    expect(VOICE_PLAYBACK_PROOFS).toEqual(['proven', 'unproven']);

    const watermark = {
      ...envelope,
      type: 'audio.watermark' as const,
      turnId: 'turn-1',
      responseId: 'response-1',
      firstAudioSample: 2400,
      queuedSamples: 4800,
      lastAudioSample: 7200,
      final: false,
    };
    expect(parseVoiceControl(JSON.stringify(watermark), 'server', 'live')).toEqual(watermark);
    expect(parseVoiceControl(JSON.stringify({ ...watermark, final: true }), 'server', 'live')).toEqual({
      ...watermark,
      final: true,
    });
    expect(() => parseVoiceControl(JSON.stringify(watermark), 'server', 'dictation')).toThrow('INVALID_VOICE_CONTROL');
    expect(() => parseVoiceControl(JSON.stringify(watermark), 'client', 'live')).toThrow('INVALID_VOICE_CONTROL');

    for (const invalidWatermark of [
      { ...watermark, firstAudioSample: 2401, lastAudioSample: 7201 },
      { ...watermark, firstAudioSample: -24, lastAudioSample: 4776 },
      { ...watermark, queuedSamples: -1, lastAudioSample: 2399 },
      { ...watermark, lastAudioSample: 7201 },
      { ...watermark, lastAudioSample: 7199 },
      { ...watermark, final: 'true' },
      { ...watermark, extra: 1 },
    ]) {
      expect(() => parseVoiceControl(JSON.stringify(invalidWatermark), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
    }

    const startAligned = {
      ...envelope,
      type: 'audio.start' as const,
      turnId: 'turn-1',
      responseId: 'response-1',
      sampleRate: 24000 as const,
      firstAudioSequence: 0,
      firstAudioSample: 480,
    };
    expect(parseVoiceControl(JSON.stringify(startAligned), 'server', 'live')).toEqual(startAligned);
    expect(() =>
      parseVoiceControl(JSON.stringify({ ...startAligned, firstAudioSample: 481 }), 'server', 'live'),
    ).toThrow('INVALID_VOICE_CONTROL');

    for (const terminalType of ['audio.end', 'response.cancelled'] as const) {
      const bounded = {
        ...envelope,
        type: terminalType,
        turnId: 'turn-1',
        responseId: 'response-1',
        lastAudioSequence: 2,
        firstAudioSample: 2400,
        lastAudioSample: 7200,
        totalAudioSamples: 4800,
      };
      expect(parseVoiceControl(JSON.stringify(bounded), 'server', 'live')).toEqual(bounded);
      for (const badTerminal of [
        { ...bounded, firstAudioSample: 2401, lastAudioSample: 7201 },
        { ...bounded, lastAudioSample: 7199 },
        { ...bounded, totalAudioSamples: 4799 },
        { ...bounded, firstAudioSample: 7200, lastAudioSample: 2400, totalAudioSamples: 0 },
      ]) {
        expect(() => parseVoiceControl(JSON.stringify(badTerminal), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
      }
    }

    const progress = {
      ...envelope,
      type: 'playback.progress' as const,
      turnId: 'turn-1',
      responseId: 'response-1',
      playedMs: 150,
      playedSamples: 3600,
    };
    expect(parseVoiceControl(JSON.stringify(progress), 'client', 'live')).toEqual(progress);
    expect(parseVoiceControl(JSON.stringify({ ...progress, proof: 'proven' }), 'client', 'live')).toEqual({
      ...progress,
      proof: 'proven',
    });
    expect(parseVoiceControl(JSON.stringify({ ...progress, proof: 'unproven' }), 'client', 'live')).toEqual({
      ...progress,
      proof: 'unproven',
    });
    expect(() => parseVoiceControl(JSON.stringify({ ...progress, proof: 'guessed' }), 'client', 'live')).toThrow(
      'INVALID_VOICE_CONTROL',
    );

    const interrupt = {
      ...envelope,
      type: 'response.interrupt' as const,
      turnId: 'turn-1',
      responseId: 'response-1',
      playbackPositionMs: 150,
      playedSamples: 3600,
      proof: 'unproven' as const,
    };
    expect(parseVoiceControl(JSON.stringify(interrupt), 'client', 'live')).toEqual(interrupt);
    expect(() => parseVoiceControl(JSON.stringify({ ...interrupt, proof: null }), 'client', 'live')).toThrow(
      'INVALID_VOICE_CONTROL',
    );

    // Clamping helper invariants
    expect(clampPlayedSamplesToWatermark(2400, 2400, 1200, 2400)).toBe(2400);
    expect(clampPlayedSamplesToWatermark(2400, 2400, 1200, 7200)).toBe(3600);
    expect(clampPlayedSamplesToWatermark(2400, 6000, 2400, 7200)).toBe(7200);
    expect(clampPlayedSamplesToWatermark(2400, 3600, 0, 7200)).toBe(3600);
    expect(() => clampPlayedSamplesToWatermark(2401, 2401, 0, 2401)).toThrow('INVALID_VOICE_CONTROL');
    expect(() => clampPlayedSamplesToWatermark(2400, 2399, 0, 2400)).toThrow('INVALID_VOICE_CONTROL');
    expect(() => clampPlayedSamplesToWatermark(2400, 2400, 0, 2399)).toThrow('INVALID_VOICE_CONTROL');
  });
```

In `frontend/src/api/voice-protocol.test.ts`, update the imports from `./voice-protocol` (lines 23–28) to include `VOICE_PLAYBACK_PROOFS` and `clampPlayedSamplesToWatermark`, and add assertions at the end of `it('parses suspended input and nonterminal call failures without relaxing exact shapes')` (around line 108):

```typescript
    expect(VOICE_PLAYBACK_PROOFS).toEqual(['proven', 'unproven'])
    const watermark = { ...base, type: 'audio.watermark', turnId: 'turn-1', responseId: 'response-1',
      firstAudioSample: 0, queuedSamples: 2400, lastAudioSample: 2400, final: true }
    expect(parseVoiceControl(JSON.stringify(watermark), 'server', 'live')).toEqual(watermark)
    expect(() => parseVoiceControl(JSON.stringify(watermark), 'server', 'dictation')).toThrow()
    const unprovenProgress = { ...base, type: 'playback.progress', turnId: 'turn-1', responseId: 'response-1',
      playedMs: 50, playedSamples: 1200, proof: 'unproven' }
    expect(parseVoiceControl(JSON.stringify(unprovenProgress), 'client', 'live')).toEqual(unprovenProgress)
    expect(clampPlayedSamplesToWatermark(0, 1200, 2400, 2400)).toBe(2400)
```

- [ ] **Step 2: Run the backend and frontend protocol tests to verify they fail**

Run in `backend/`:
```powershell
npm test -- src/contracts/voice.spec.ts -t "watermark"
```
Run in `frontend/`:
```powershell
npm test -- src/api/voice-protocol.test.ts -t "parses suspended input"
```
Expected: FAIL because `VOICE_PLAYBACK_PROOFS`, `audio.watermark`, and `clampPlayedSamplesToWatermark` are not yet defined.

- [ ] **Step 3: Implement the watermark, proof, and clamping contract in `backend/src/contracts/voice-wire.ts` and `frontend/src/api/voice-protocol.ts`**

In **both** `backend/src/contracts/voice-wire.ts` and `frontend/src/api/voice-protocol.ts` (keeping both files byte-for-byte identical from `export const VOICE_PROTOCOL_VERSION` to the end of the file):

1. Update `VoiceResponseRef`, `VoiceClientPayload`, and `VoiceServerPayload` (lines 130–155):
```typescript
export type VoiceResponseRef = { turnId: string; responseId: string };
export const VOICE_PLAYBACK_PROOFS = ['proven', 'unproven'] as const;
export type VoicePlaybackProof = typeof VOICE_PLAYBACK_PROOFS[number];
export type VoiceAudioWatermarkPayload = {
  type: 'audio.watermark';
  firstAudioSample: number;
  queuedSamples: number;
  lastAudioSample: number;
  final: boolean;
} & VoiceResponseRef;
export type VoiceClientPayload =
  | { type: 'session.start'; mode: VoiceMode; audioSettings: InputAudioSettings }
  | { type: 'dictation.stop' | 'dictation.cancel' | 'input.mute' | 'input.unmute' |
      'input.suspend' | 'session.end' }
  | ({ type: 'response.interrupt'; playbackPositionMs: number; playedSamples: number;
      proof?: VoicePlaybackProof } & VoiceResponseRef)
  | ({ type: 'playback.progress'; playedMs: number; playedSamples: number;
      proof?: VoicePlaybackProof } & VoiceResponseRef);
export type VoiceClientEvent = VoiceEnvelope & VoiceClientPayload;
export type VoiceServerPayload =
  | { type: 'session.ready'; limits: VoiceLimits;
      effectiveAudioSettings: { input: InputAudioSettings; output: OutputAudioSettings | null } }
   | { type: 'session.ended'; reason: 'completed' | 'cancelled' | 'disconnected' |
      'duration' | 'idle' | 'quota' | 'error' | 'shutdown'; terminal: boolean }
  | { type: 'conversation.bound'; conversationId: string }
  | { type: 'dictation.partial' | 'dictation.final'; segmentId: string; text: string }
  | { type: 'dictation.complete'; finalization: 'complete' | 'timeout' | 'empty'; unfinalizedTail: boolean }
  | { type: 'voice.state'; input: 'listening' | 'suspended' | 'muted';
      agent: 'idle' | 'thinking' | 'speaking'; connection: 'connected' | 'reconnecting' }
   | ({ type: 'audio.start'; sampleRate: 24000; firstAudioSequence: number; firstAudioSample?: number } & VoiceResponseRef)
  | VoiceAudioWatermarkPayload
  | ({ type: 'audio.end' | 'response.cancelled'; lastAudioSequence: number | null;
      firstAudioSample?: number; lastAudioSample?: number; totalAudioSamples?: number } & VoiceResponseRef)
  | { type: 'session.warning'; code: VoiceErrorCode; recovery: VoiceRecovery; recoverable: boolean }
  | { type: 'session.error'; code: VoiceErrorCode; recovery: VoiceRecovery;
      recoverable: boolean; terminal: boolean }
  | CanvasArtifactPayload;
export type VoiceServerEvent = VoiceEnvelope & VoiceServerPayload;
```

2. Right after `const safeUint: Guard = ...` (line 162), add `alignedSample`:
```typescript
const alignedSample: Guard = value => safeUint(value) && (value as number) % 24 === 0;
```

3. Update `serverShapes`, `isEvent`, `isVoiceServerEvent`, and add `clampPlayedSamplesToWatermark` (lines 335–381):
```typescript
const serverShapes: Record<string, Shape> = {
  'session.ready': { limits: isVoiceLimits, effectiveAudioSettings: audio },
  'session.ended': { reason: oneOf('completed', 'cancelled', 'disconnected',
    'duration', 'idle', 'quota', 'error', 'shutdown'), terminal: bool },
  'conversation.bound': { conversationId: id },
  'dictation.partial': { segmentId: id, text }, 'dictation.final': { segmentId: id, text },
  'dictation.complete': { finalization: oneOf('complete', 'timeout', 'empty'), unfinalizedTail: bool },
  'voice.state': { input: oneOf('listening', 'suspended', 'muted'),
    agent: oneOf('idle', 'thinking', 'speaking'), connection: oneOf('connected', 'reconnecting') },
  'audio.start': { ...response, sampleRate: oneOf(24000), firstAudioSequence: uint },
  'audio.watermark': {
    ...response,
    firstAudioSample: alignedSample,
    queuedSamples: safeUint,
    lastAudioSample: safeUint,
    final: bool,
  },
  'audio.end': { ...response, lastAudioSequence: nullable(uint) },
  'response.cancelled': { ...response, lastAudioSequence: nullable(uint) },
  'session.warning': { code: oneOf(...VOICE_ERROR_CODES), recovery: oneOf('none',
    'retry_dictation', 'resume_gesture', 'repeat_turn', 'return_to_chat', 'resume_call'), recoverable: bool },
  'session.error': { code: oneOf(...VOICE_ERROR_CODES), recovery: oneOf('none',
    'retry_dictation', 'resume_gesture', 'repeat_turn', 'return_to_chat', 'resume_call'),
    recoverable: bool, terminal: bool },
  'canvas.artifact': {
    turnId: isCanvasArtifactId,
    responseId: isCanvasArtifactId,
    ordinal: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < CANVAS_ARTIFACT_LIMITS.maxArtifactsPerResponse,
    kind: oneOf('mermaid', 'chart', 'svg', 'calendar'),
    subType: canvasSubtype,
    title: canvasTitle,
    rawSource: canvasSource,
  },
};
const optionalEventFields: Record<string, Shape> = {
  'response.interrupt': { proof: oneOf(...VOICE_PLAYBACK_PROOFS) },
  'playback.progress': { proof: oneOf(...VOICE_PLAYBACK_PROOFS) },
  'audio.start': { firstAudioSample: alignedSample },
  'audio.end': {
    firstAudioSample: alignedSample,
    lastAudioSample: safeUint,
    totalAudioSamples: safeUint,
  },
  'response.cancelled': {
    firstAudioSample: alignedSample,
    lastAudioSample: safeUint,
    totalAudioSamples: safeUint,
  },
};
function hasValidSampleBounds(value: Record<string, unknown>): boolean {
  if (value.type === 'audio.watermark') {
    const first = value.firstAudioSample as number;
    const queued = value.queuedSamples as number;
    const last = value.lastAudioSample as number;
    return Number.isSafeInteger(first + queued) && last === first + queued;
  }
  if (value.type === 'audio.end' || value.type === 'response.cancelled') {
    const hasFirst = Object.hasOwn(value, 'firstAudioSample');
    const hasLast = Object.hasOwn(value, 'lastAudioSample');
    const hasTotal = Object.hasOwn(value, 'totalAudioSamples');
    if (!hasFirst && !hasLast && !hasTotal) return true;
    const first = hasFirst ? (value.firstAudioSample as number) : undefined;
    const last = hasLast ? (value.lastAudioSample as number) : undefined;
    const total = hasTotal ? (value.totalAudioSamples as number) : undefined;
    if (first !== undefined && last !== undefined && last < first) return false;
    if (first !== undefined && total !== undefined && !Number.isSafeInteger(first + total)) return false;
    if (first !== undefined && last !== undefined && total !== undefined && last !== first + total) return false;
    if (first === undefined && last !== undefined && total !== undefined) {
      if (last < total || (last - total) % 24 !== 0) return false;
    }
  }
  return true;
}
function isEvent(value: unknown, shapes: Record<string, Shape>): boolean {
  if (!record(value) || typeof value.type !== 'string' || !Object.hasOwn(shapes, value.type)) return false;
  const opt = optionalEventFields[value.type];
  const extra: Shape = {};
  if (opt) {
    for (const [key, guard] of Object.entries(opt)) {
      if (Object.hasOwn(value, key)) extra[key] = guard;
    }
  }
  return exact(value, { ...envelope, type: oneOf(value.type), ...shapes[value.type], ...extra }) &&
    hasValidSampleBounds(value);
}
export function clampPlayedSamplesToWatermark(
  firstAudioSample: number,
  currentPlayedSamples: number,
  activeDeltaSamples: number,
  watermarkLastAudioSample: number,
): number {
  if (!alignedSample(firstAudioSample) || !safeUint(currentPlayedSamples) ||
      !safeUint(activeDeltaSamples) || !safeUint(watermarkLastAudioSample) ||
      watermarkLastAudioSample < firstAudioSample || currentPlayedSamples < firstAudioSample) {
    throw new Error('INVALID_VOICE_CONTROL');
  }
  const clampedCurrent = Math.min(currentPlayedSamples, watermarkLastAudioSample);
  if (watermarkLastAudioSample === firstAudioSample || activeDeltaSamples === 0) {
    return clampedCurrent;
  }
  return Math.min(watermarkLastAudioSample, clampedCurrent + activeDeltaSamples);
}
export function isVoiceClientEvent(value: unknown): value is VoiceClientEvent {
  return isEvent(value, clientShapes);
}
export function isVoiceServerEvent(value: unknown, mode: VoiceMode): value is VoiceServerEvent {
  if (!isEvent(value, serverShapes)) return false;
  const v = value as VoiceServerEvent;
  if (mode === 'live' && v.type.startsWith('dictation.')) return false;
  if (mode === 'dictation' && ['voice.state', 'audio.start', 'audio.watermark', 'audio.end', 'response.cancelled', 'conversation.bound', 'canvas.artifact'].includes(v.type)) return false;
  if (v.type === 'canvas.artifact') {
    if (!isCanvasArtifactId(v.sessionId) || !isCanvasArtifactId(v.eventId)) return false;
  }
  if (v.type === 'session.ready') return mode === 'dictation'
    ? v.effectiveAudioSettings.output === null : output(v.effectiveAudioSettings.output);
  return true;
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
Expected: PASS in both packages (including the mirror parity check).

- [ ] **Step 5: Commit Task 1**

```powershell
git add backend/src/contracts/voice-wire.ts frontend/src/api/voice-protocol.ts backend/src/contracts/voice.spec.ts frontend/src/api/voice-protocol.test.ts
git commit -m "feat(contracts): add WebRTC audio watermark, sample bounds, and playout proof"
```

---

### Task 2: Add LiveKit Reliable Control Packet Limits, Chunk Packet Schema, Packetizer & Bounded Reassembler

**Files:**
- Modify: `backend/src/contracts/voice-wire.ts:51-57,390-460`
- Modify: `frontend/src/api/voice-protocol.ts:51-57,390-460`
- Modify: `backend/src/contracts/voice.spec.ts:27-37,380-470`
- Modify: `frontend/src/api/voice-protocol.test.ts:23-31,150-190`

- [ ] **Step 1: Write the failing control-packet chunking and reassembly tests in `backend/src/contracts/voice.spec.ts` and `frontend/src/api/voice-protocol.test.ts`**

In `backend/src/contracts/voice.spec.ts`, add `LIVEKIT_MAX_CONTROL_PACKET_BYTES`, `LIVEKIT_CONTROL_LIMITS`, `isVoiceControlChunkPacket`, `encodeVoiceControlPackets`, and `VoiceControlReassembler` to the imports from `./voice-wire.js`, and add the following test right before `it('mirrors the entire portable voice contract')`:

```typescript
  it('keeps small live controls single-frame and chunks/reassembles large control envelopes within 15 KiB bounds', () => {
    expect(LIVEKIT_MAX_CONTROL_PACKET_BYTES).toBe(15360);
    expect(LIVEKIT_CONTROL_LIMITS).toEqual({
      maxPacketBytes: 15360,
      maxMessageBytes: 131072,
      maxChunkBytes: 14336,
      maxChunksPerMessage: 16,
      maxInflightReassemblies: 2,
      reassemblyTimeoutMs: 5000,
    });

    // 1. Single-frame fast path (<= 15360 bytes)
    const smallEvent = {
      ...envelope,
      type: 'voice.state' as const,
      input: 'listening' as const,
      agent: 'speaking' as const,
      connection: 'connected' as const,
    };
    const smallPackets = encodeVoiceControlPackets(smallEvent, 'server', 'live');
    expect(smallPackets).toHaveLength(1);
    expect(JSON.parse(new TextDecoder().decode(smallPackets[0]))).toEqual(smallEvent);

    const rx = new VoiceControlReassembler('server', 'live', {
      sessionId: 'voice-1',
      connectionEpoch: 1,
    });
    expect(rx.push(smallPackets[0], 1000)).toEqual({
      status: 'complete',
      event: smallEvent,
      chunked: false,
      chunkCount: 1,
      totalBytes: smallPackets[0].byteLength,
    });

    // 2. Multi-packet chunking & reassembly for a legal > 15 KiB canvas.artifact with multibyte UTF-8
    const largeSource = `flowchart TD\nA["${'界'.repeat(5200)}"] --> B["End"]`;
    const largeCanvas = {
      ...envelope,
      sequence: 7,
      eventId: 'canvas-large-1',
      type: 'canvas.artifact' as const,
      turnId: 'turn-1',
      responseId: 'response-1',
      ordinal: 0,
      kind: 'mermaid' as const,
      subType: 'Flowchart',
      title: 'Large multibyte diagram',
      rawSource: largeSource,
    };
    const chunks = encodeVoiceControlPackets(largeCanvas, 'server', 'live');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.length).toBeLessThanOrEqual(LIVEKIT_CONTROL_LIMITS.maxChunksPerMessage);
    for (const [index, packetBytes] of chunks.entries()) {
      expect(packetBytes.byteLength).toBeLessThanOrEqual(LIVEKIT_MAX_CONTROL_PACKET_BYTES);
      const parsedChunk = JSON.parse(new TextDecoder().decode(packetBytes));
      expect(isVoiceControlChunkPacket(parsedChunk)).toBe(true);
      expect(parsedChunk).toMatchObject({
        protocolVersion: 1,
        type: 'control.chunk',
        sessionId: 'voice-1',
        connectionEpoch: 1,
        sequence: 7,
        eventId: 'canvas-large-1',
        turnId: 'turn-1',
        responseId: 'response-1',
        chunkIndex: index,
        chunkCount: chunks.length,
      });
    }

    const firstStep = rx.push(chunks[0], 2000);
    expect(firstStep).toMatchObject({
      status: 'partial',
      eventId: 'canvas-large-1',
      sequence: 7,
      turnId: 'turn-1',
      responseId: 'response-1',
      chunkIndex: 0,
      chunkCount: chunks.length,
    });
    // Idempotent duplicate of chunk 0 is ignored safely
    expect(rx.push(chunks[0], 2010)).toEqual(firstStep);

    let finalStep = firstStep;
    for (let i = 1; i < chunks.length; i++) {
      finalStep = rx.push(chunks[i], 2000 + i * 10);
    }
    expect(finalStep).toEqual({
      status: 'complete',
      event: largeCanvas,
      chunked: true,
      chunkCount: chunks.length,
      totalBytes: new TextEncoder().encode(JSON.stringify(largeCanvas)).byteLength,
    });
    expect(rx.pendingAssemblies).toBe(0);
    expect(rx.pendingBytes).toBe(0);

    // 3. Rejection rules: oversized single packet, out-of-order chunk, timeout, overflow, and correlation spoofing
    expect(() => rx.push(new Uint8Array(LIVEKIT_MAX_CONTROL_PACKET_BYTES + 1), 3000)).toThrow('INVALID_VOICE_CONTROL');
    expect(() => rx.push(chunks[1], 3000)).toThrow('VOICE_SEQUENCE_ERROR');

    // Timeout after 5000ms
    rx.push(chunks[0], 4000);
    expect(() => rx.push(chunks[1], 9001)).toThrow('INVALID_VOICE_CONTROL');
    expect(rx.pendingAssemblies).toBe(0);

    // Max 2 in-flight reassemblies
    const makeChunk0 = (eventId: string, seq: number) =>
      new TextEncoder().encode(
        JSON.stringify({
          ...(JSON.parse(new TextDecoder().decode(chunks[0])) as Record<string, unknown>),
          eventId,
          sequence: seq,
        }),
      );
    rx.push(makeChunk0('inflight-1', 10), 10000);
    rx.push(makeChunk0('inflight-2', 11), 10000);
    expect(() => rx.push(makeChunk0('inflight-3', 12), 10000)).toThrow('AUDIO_BUFFER_OVERFLOW');
    rx.clear();

    // Header-to-payload correlation spoofing must be rejected on final chunk
    const spoofedChunks = chunks.map((b) => {
      const c = JSON.parse(new TextDecoder().decode(b)) as Record<string, unknown>;
      return new TextEncoder().encode(JSON.stringify({ ...c, sequence: 999 }));
    });
    for (let i = 0; i < spoofedChunks.length - 1; i++) {
      rx.push(spoofedChunks[i], 11000);
    }
    expect(() => rx.push(spoofedChunks[spoofedChunks.length - 1], 11000)).toThrow('INVALID_VOICE_CONTROL');
  });
```

In `frontend/src/api/voice-protocol.test.ts`, import `LIVEKIT_MAX_CONTROL_PACKET_BYTES`, `LIVEKIT_CONTROL_LIMITS`, `encodeVoiceControlPackets`, and `VoiceControlReassembler` from `./voice-protocol` and add at the end of `describe('frontend voice protocol')`:

```typescript
  it('reassembles chunked live canvas artifacts and rejects oversized or timed-out packets', () => {
    expect(LIVEKIT_MAX_CONTROL_PACKET_BYTES).toBe(15360)
    expect(LIVEKIT_CONTROL_LIMITS.maxChunksPerMessage).toBe(16)
    const event = {
      ...base,
      sequence: 4,
      eventId: 'canvas-big',
      type: 'canvas.artifact' as const,
      turnId: 'turn-1',
      responseId: 'response-1',
      ordinal: 0,
      kind: 'mermaid' as const,
      subType: 'Flowchart',
      title: 'Chunked artifact',
      rawSource: `flowchart TD\nA["${'界'.repeat(5200)}"] --> B`,
    }
    const packets = encodeVoiceControlPackets(event, 'server', 'live')
    expect(packets.length).toBe(2)
    const reassembler = new VoiceControlReassembler('server', 'live', {
      sessionId: 'voice-1',
      connectionEpoch: 1,
    })
    expect(reassembler.push(packets[0], 100).status).toBe('partial')
    const done = reassembler.push(packets[1], 150)
    expect(done).toMatchObject({ status: 'complete', event, chunked: true, chunkCount: 2 })
  })
```

- [ ] **Step 2: Run the backend and frontend tests to verify they fail**

Run in `backend/`:
```powershell
npm test -- src/contracts/voice.spec.ts -t "chunks/reassembles"
```
Run in `frontend/`:
```powershell
npm test -- src/api/voice-protocol.test.ts -t "reassembles chunked"
```
Expected: FAIL because `LIVEKIT_MAX_CONTROL_PACKET_BYTES`, `LIVEKIT_CONTROL_LIMITS`, `encodeVoiceControlPackets`, and `VoiceControlReassembler` are not yet defined.

- [ ] **Step 3: Implement `LIVEKIT_CONTROL_LIMITS`, `isVoiceControlChunkPacket`, `encodeVoiceControlPackets`, and `VoiceControlReassembler` in `backend/src/contracts/voice-wire.ts` and `frontend/src/api/voice-protocol.ts`**

In **both** `backend/src/contracts/voice-wire.ts` and `frontend/src/api/voice-protocol.ts`:

1. Right after `export const MAX_VOICE_CONTROL_BYTES = 131072;` (line 51), add:
```typescript
export const LIVEKIT_MAX_CONTROL_PACKET_BYTES = 15360 as const;
export const LIVEKIT_CONTROL_LIMITS = Object.freeze({
  maxPacketBytes: LIVEKIT_MAX_CONTROL_PACKET_BYTES,
  maxMessageBytes: MAX_VOICE_CONTROL_BYTES,
  maxChunkBytes: 14336,
  maxChunksPerMessage: 16,
  maxInflightReassemblies: 2,
  reassemblyTimeoutMs: 5000,
} as const);
```

2. At the bottom of `backend/src/contracts/voice-wire.ts` and `frontend/src/api/voice-protocol.ts` (after `parseVoiceControl`), add:
```typescript
export type VoiceControlChunkPacket = {
  protocolVersion: 1;
  type: 'control.chunk';
  sessionId: string;
  connectionEpoch: number;
  sequence: number;
  eventId: string;
  turnId?: string;
  responseId?: string;
  chunkIndex: number;
  chunkCount: number;
  totalBytes: number;
  payload: string;
};
export type VoiceControlReassemblyResult<E extends VoiceClientEvent | VoiceServerEvent> =
  | { status: 'complete'; event: E; chunked: boolean; chunkCount: number; totalBytes: number }
  | {
      status: 'partial';
      eventId: string;
      sequence: number;
      turnId?: string;
      responseId?: string;
      chunkIndex: number;
      chunkCount: number;
      receivedBytes: number;
      totalBytes: number;
    };
export function isVoiceControlChunkPacket(value: unknown): value is VoiceControlChunkPacket {
  if (!record(value)) return false;
  const hasTurnId = Object.hasOwn(value, 'turnId');
  const hasResponseId = Object.hasOwn(value, 'responseId');
  if (hasTurnId !== hasResponseId) return false;
  const shape: Shape = {
    protocolVersion: oneOf(1),
    type: oneOf('control.chunk'),
    sessionId: id,
    connectionEpoch: uint,
    sequence: uint,
    eventId: id,
    ...(hasTurnId ? { turnId: id, responseId: id } : {}),
    chunkIndex: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 &&
      v < LIVEKIT_CONTROL_LIMITS.maxChunksPerMessage,
    chunkCount: v => typeof v === 'number' && Number.isInteger(v) && v >= 2 &&
      v <= LIVEKIT_CONTROL_LIMITS.maxChunksPerMessage,
    totalBytes: v => typeof v === 'number' && Number.isInteger(v) &&
      v > LIVEKIT_CONTROL_LIMITS.maxPacketBytes && v <= LIVEKIT_CONTROL_LIMITS.maxMessageBytes,
    payload: v => typeof v === 'string' && v.length > 0 && wellFormed(v) &&
      utf8(v) <= LIVEKIT_CONTROL_LIMITS.maxChunkBytes,
  };
  if (!exact(value, shape)) return false;
  const v = value as VoiceControlChunkPacket;
  return v.chunkIndex < v.chunkCount && utf8(v.payload) <= v.totalBytes;
}
export function encodeVoiceControlPackets(
  eventOrJson: VoiceClientEvent | VoiceServerEvent | string,
  direction: 'client' | 'server',
  mode: VoiceMode,
): Uint8Array[] {
  const json = typeof eventOrJson === 'string' ? eventOrJson : JSON.stringify(eventOrJson);
  const parsed = direction === 'client'
    ? parseVoiceControl(json, 'client', mode)
    : parseVoiceControl(json, 'server', mode);
  const rawBytes = new TextEncoder().encode(json);
  const totalBytes = rawBytes.byteLength;
  if (totalBytes <= LIVEKIT_CONTROL_LIMITS.maxPacketBytes) {
    return [rawBytes];
  }
  if (mode !== 'live') throw new Error('INVALID_VOICE_CONTROL');
  const ref = 'turnId' in parsed && 'responseId' in parsed &&
    typeof parsed.turnId === 'string' && typeof parsed.responseId === 'string'
    ? { turnId: parsed.turnId, responseId: parsed.responseId }
    : {};
  const slices: string[] = [];
  let current = '';
  let currentUtf8 = 0;
  let currentEscapedUtf8 = 0;
  for (const ch of json) {
    const chUtf8 = utf8(ch);
    const chEscapedUtf8 = utf8(JSON.stringify(ch)) - 2;
    if (
      current.length > 0 &&
      (currentUtf8 + chUtf8 > LIVEKIT_CONTROL_LIMITS.maxChunkBytes ||
        currentEscapedUtf8 + chEscapedUtf8 > LIVEKIT_CONTROL_LIMITS.maxChunkBytes)
    ) {
      slices.push(current);
      current = ch;
      currentUtf8 = chUtf8;
      currentEscapedUtf8 = chEscapedUtf8;
    } else {
      current += ch;
      currentUtf8 += chUtf8;
      currentEscapedUtf8 += chEscapedUtf8;
    }
  }
  if (current.length > 0) slices.push(current);
  const chunkCount = slices.length;
  if (chunkCount < 2 || chunkCount > LIVEKIT_CONTROL_LIMITS.maxChunksPerMessage) {
    throw new Error('INVALID_VOICE_CONTROL');
  }
  return slices.map((payload, chunkIndex) => {
    const packet: VoiceControlChunkPacket = {
      protocolVersion: 1,
      type: 'control.chunk',
      sessionId: parsed.sessionId,
      connectionEpoch: parsed.connectionEpoch,
      sequence: parsed.sequence,
      eventId: parsed.eventId,
      ...ref,
      chunkIndex,
      chunkCount,
      totalBytes,
      payload,
    };
    if (!isVoiceControlChunkPacket(packet)) throw new Error('INVALID_VOICE_CONTROL');
    const encoded = new TextEncoder().encode(JSON.stringify(packet));
    if (encoded.byteLength > LIVEKIT_CONTROL_LIMITS.maxPacketBytes) {
      throw new Error('INVALID_VOICE_CONTROL');
    }
    return encoded;
  });
}
type InflightControlReassembly = {
  sessionId: string;
  connectionEpoch: number;
  sequence: number;
  eventId: string;
  turnId?: string;
  responseId?: string;
  chunkCount: number;
  totalBytes: number;
  receivedBytes: number;
  nextChunkIndex: number;
  startedAtMs: number;
  parts: string[];
};
export class VoiceControlReassembler<D extends 'client' | 'server' = 'server'> {
  private readonly inflight = new Map<string, InflightControlReassembly>();
  private bufferedBytes = 0;

  constructor(
    private readonly direction: D,
    private readonly mode: VoiceMode,
    private readonly binding?: { sessionId: string; connectionEpoch: number },
  ) {}

  get pendingAssemblies(): number {
    return this.inflight.size;
  }

  get pendingBytes(): number {
    return this.bufferedBytes;
  }

  clear(): void {
    this.inflight.clear();
    this.bufferedBytes = 0;
  }

  sweep(nowMs = Date.now()): void {
    for (const [eventId, entry] of this.inflight) {
      if (nowMs - entry.startedAtMs > LIVEKIT_CONTROL_LIMITS.reassemblyTimeoutMs) {
        this.bufferedBytes -= entry.receivedBytes;
        this.inflight.delete(eventId);
        throw new Error('INVALID_VOICE_CONTROL');
      }
    }
  }

  push(
    packetBytes: Uint8Array,
    nowMs = Date.now(),
  ): VoiceControlReassemblyResult<D extends 'client' ? VoiceClientEvent : VoiceServerEvent> {
    this.sweep(nowMs);
    if (
      !(packetBytes instanceof Uint8Array) ||
      packetBytes.byteLength === 0 ||
      packetBytes.byteLength > LIVEKIT_CONTROL_LIMITS.maxPacketBytes
    ) {
      throw new Error('INVALID_VOICE_CONTROL');
    }
    let textDecoded: string;
    try {
      textDecoded = new TextDecoder('utf-8', { fatal: true }).decode(packetBytes);
    } catch {
      throw new Error('INVALID_VOICE_CONTROL');
    }
    let rawValue: unknown;
    try {
      rawValue = JSON.parse(textDecoded);
    } catch {
      throw new Error('INVALID_VOICE_CONTROL');
    }
    if (!record(rawValue)) throw new Error('INVALID_VOICE_CONTROL');

    if (rawValue.type !== 'control.chunk') {
      const event = (this.direction === 'client'
        ? parseVoiceControl(textDecoded, 'client', this.mode)
        : parseVoiceControl(textDecoded, 'server', this.mode)) as D extends 'client'
        ? VoiceClientEvent
        : VoiceServerEvent;
      if (this.binding) {
        if (event.sessionId !== this.binding.sessionId) throw new Error('VOICE_BINDING_MISMATCH');
        if (event.connectionEpoch !== this.binding.connectionEpoch) throw new Error('STALE_CONNECTION_EPOCH');
      }
      return {
        status: 'complete',
        event,
        chunked: false,
        chunkCount: 1,
        totalBytes: packetBytes.byteLength,
      };
    }

    if (this.mode !== 'live' || !isVoiceControlChunkPacket(rawValue)) {
      throw new Error('INVALID_VOICE_CONTROL');
    }
    if (this.binding) {
      if (rawValue.sessionId !== this.binding.sessionId) throw new Error('VOICE_BINDING_MISMATCH');
      if (rawValue.connectionEpoch !== this.binding.connectionEpoch) throw new Error('STALE_CONNECTION_EPOCH');
    }

    const partBytes = utf8(rawValue.payload);
    let entry = this.inflight.get(rawValue.eventId);
    if (!entry) {
      if (rawValue.chunkIndex !== 0) throw new Error('VOICE_SEQUENCE_ERROR');
      if (
        this.inflight.size >= LIVEKIT_CONTROL_LIMITS.maxInflightReassemblies ||
        this.bufferedBytes + partBytes > LIVEKIT_CONTROL_LIMITS.maxMessageBytes
      ) {
        throw new Error('AUDIO_BUFFER_OVERFLOW');
      }
      entry = {
        sessionId: rawValue.sessionId,
        connectionEpoch: rawValue.connectionEpoch,
        sequence: rawValue.sequence,
        eventId: rawValue.eventId,
        ...(rawValue.turnId !== undefined ? { turnId: rawValue.turnId, responseId: rawValue.responseId } : {}),
        chunkCount: rawValue.chunkCount,
        totalBytes: rawValue.totalBytes,
        receivedBytes: 0,
        nextChunkIndex: 0,
        startedAtMs: nowMs,
        parts: [],
      };
      this.inflight.set(rawValue.eventId, entry);
    } else {
      if (
        entry.sessionId !== rawValue.sessionId ||
        entry.connectionEpoch !== rawValue.connectionEpoch ||
        entry.sequence !== rawValue.sequence ||
        entry.turnId !== rawValue.turnId ||
        entry.responseId !== rawValue.responseId ||
        entry.chunkCount !== rawValue.chunkCount ||
        entry.totalBytes !== rawValue.totalBytes
      ) {
        this.bufferedBytes -= entry.receivedBytes;
        this.inflight.delete(rawValue.eventId);
        throw new Error('INVALID_VOICE_CONTROL');
      }
      if (rawValue.chunkIndex < entry.nextChunkIndex) {
        if (entry.parts[rawValue.chunkIndex] === rawValue.payload) {
          return {
            status: 'partial',
            eventId: entry.eventId,
            sequence: entry.sequence,
            ...(entry.turnId !== undefined ? { turnId: entry.turnId, responseId: entry.responseId } : {}),
            chunkIndex: rawValue.chunkIndex,
            chunkCount: entry.chunkCount,
            receivedBytes: entry.receivedBytes,
            totalBytes: entry.totalBytes,
          };
        }
        this.bufferedBytes -= entry.receivedBytes;
        this.inflight.delete(rawValue.eventId);
        throw new Error('VOICE_SEQUENCE_ERROR');
      }
      if (rawValue.chunkIndex !== entry.nextChunkIndex) {
        this.bufferedBytes -= entry.receivedBytes;
        this.inflight.delete(rawValue.eventId);
        throw new Error('VOICE_SEQUENCE_ERROR');
      }
      if (this.bufferedBytes + partBytes > LIVEKIT_CONTROL_LIMITS.maxMessageBytes) {
        this.bufferedBytes -= entry.receivedBytes;
        this.inflight.delete(rawValue.eventId);
        throw new Error('AUDIO_BUFFER_OVERFLOW');
      }
    }

    const nextReceivedBytes = entry.receivedBytes + partBytes;
    const isFinalChunk = rawValue.chunkIndex === entry.chunkCount - 1;
    if (
      nextReceivedBytes > entry.totalBytes ||
      (isFinalChunk && nextReceivedBytes !== entry.totalBytes) ||
      (!isFinalChunk && nextReceivedBytes >= entry.totalBytes)
    ) {
      this.bufferedBytes -= entry.receivedBytes;
      this.inflight.delete(rawValue.eventId);
      throw new Error('INVALID_VOICE_CONTROL');
    }

    entry.parts.push(rawValue.payload);
    entry.receivedBytes = nextReceivedBytes;
    entry.nextChunkIndex++;
    this.bufferedBytes += partBytes;

    if (!isFinalChunk) {
      return {
        status: 'partial',
        eventId: entry.eventId,
        sequence: entry.sequence,
        ...(entry.turnId !== undefined ? { turnId: entry.turnId, responseId: entry.responseId } : {}),
        chunkIndex: rawValue.chunkIndex,
        chunkCount: entry.chunkCount,
        receivedBytes: entry.receivedBytes,
        totalBytes: entry.totalBytes,
      };
    }

    this.bufferedBytes -= entry.receivedBytes;
    this.inflight.delete(rawValue.eventId);
    const reassembledJson = entry.parts.join('');
    const event = (this.direction === 'client'
      ? parseVoiceControl(reassembledJson, 'client', this.mode)
      : parseVoiceControl(reassembledJson, 'server', this.mode)) as D extends 'client'
      ? VoiceClientEvent
      : VoiceServerEvent;

    const eventTurnId = 'turnId' in event && typeof event.turnId === 'string' ? event.turnId : undefined;
    const eventResponseId = 'responseId' in event && typeof event.responseId === 'string' ? event.responseId : undefined;
    if (
      event.sessionId !== entry.sessionId ||
      event.connectionEpoch !== entry.connectionEpoch ||
      event.sequence !== entry.sequence ||
      event.eventId !== entry.eventId ||
      eventTurnId !== entry.turnId ||
      eventResponseId !== entry.responseId
    ) {
      throw new Error('INVALID_VOICE_CONTROL');
    }

    return {
      status: 'complete',
      event,
      chunked: true,
      chunkCount: entry.chunkCount,
      totalBytes: entry.totalBytes,
    };
  }
}
```

- [ ] **Step 4: Run the backend and frontend tests to verify they pass**

Run in `backend/`:
```powershell
npm test -- src/contracts/voice.spec.ts
```
Run in `frontend/`:
```powershell
npm test -- src/api/voice-protocol.test.ts src/api/testing/voice-fixtures.test.ts
```
Expected: PASS in both packages.

- [ ] **Step 5: Commit Task 2**

```powershell
git add backend/src/contracts/voice-wire.ts frontend/src/api/voice-protocol.ts backend/src/contracts/voice.spec.ts frontend/src/api/voice-protocol.test.ts
git commit -m "feat(contracts): add bounded 15 KiB LiveKit control packet chunking and reassembler"
```

---

### Task 3: Extend Shared Backend & Frontend Voice Fixtures with Watermark, Proof & Large Canvas Artifact Catalogs

**Files:**
- Modify: `backend/src/contracts/testing/voice-fixtures.ts:22-116`
- Modify: `backend/src/contracts/testing/voice-fixtures.spec.ts:22-70`
- Modify: `frontend/src/api/testing/voice-fixtures.ts:22-75`
- Modify: `frontend/src/api/testing/voice-fixtures.test.ts:20-40`

- [ ] **Step 1: Write failing fixture tests in `backend/src/contracts/testing/voice-fixtures.spec.ts` and `frontend/src/api/testing/voice-fixtures.test.ts`**

In `backend/src/contracts/testing/voice-fixtures.spec.ts`, update imports and assertions:
```typescript
import { describe, expect, it } from 'vitest';
import { decodeVoiceAudio, encodeVoiceAudio } from '../voice-audio.js';
import {
  LIVEKIT_MAX_CONTROL_PACKET_BYTES,
  VoiceControlReassembler,
  encodeVoiceControlPackets,
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
  largeCanvasArtifactFixture,
} from './voice-fixtures.js';

describe('shared voice fixtures', () => {
  it('uses independent golden frame bytes and returns fresh buffers', () => {
    const first = goldenInputFrame();
    expect(encodeVoiceAudio(decodeVoiceAudio(first))).toEqual(first);
    expect(decodeVoiceAudio(goldenOutputFrame()).pcm).toEqual(new Uint8Array([255, 127]));
    first[0] = 0;
    expect(goldenInputFrame()[0]).toBe(175);
  });
  it('provides every control event, watermark/proof variants, large canvas fixture, and LiveKit fixtures', () => {
    for (const row of clientControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'client', row.mode)).toEqual(row.event);
    for (const row of serverControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'server', row.mode)).toEqual(row.event);
    expect(new Set(clientControls().map(row => row.event.type)).size).toBe(9);
    expect(new Set(serverControls().map(row => row.event.type)).size).toBe(13);
    const largeArtifact = largeCanvasArtifactFixture();
    const packets = encodeVoiceControlPackets(largeArtifact, 'server', 'live');
    expect(packets.length).toBe(2);
    expect(packets.every(p => p.byteLength <= LIVEKIT_MAX_CONTROL_PACKET_BYTES)).toBe(true);
    const reassembler = new VoiceControlReassembler('server', 'live', {
      sessionId: largeArtifact.sessionId,
      connectionEpoch: largeArtifact.connectionEpoch,
    });
    expect(reassembler.push(packets[0], 10).status).toBe('partial');
    expect(reassembler.push(packets[1], 20)).toMatchObject({ status: 'complete', event: largeArtifact, chunked: true });
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

In `frontend/src/api/testing/voice-fixtures.test.ts`, update imports and `it('validates independent golden frames and every portable event')`:
```typescript
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeVoiceAudio, encodeVoiceAudio } from '../voice-audio'
import { VoiceControlReassembler, encodeVoiceControlPackets, parseVoiceControl } from '../voice-protocol'
import { goldenInputFrame, goldenOutputFrame, clientControls, serverControls, largeCanvasArtifactFixture } from './voice-fixtures'

describe('frontend shared voice fixtures', () => {
  it('validates independent golden frames and every portable event', () => {
    expect(encodeVoiceAudio(decodeVoiceAudio(goldenInputFrame()))).toEqual(goldenInputFrame())
    expect(decodeVoiceAudio(goldenOutputFrame()).kind).toBe(2)
    for (const row of clientControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'client', row.mode)).toEqual(row.event)
    for (const row of serverControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'server', row.mode)).toEqual(row.event)
    const large = largeCanvasArtifactFixture()
    const packets = encodeVoiceControlPackets(large, 'server', 'live')
    expect(packets.length).toBe(2)
    const rx = new VoiceControlReassembler('server', 'live', { sessionId: large.sessionId, connectionEpoch: large.connectionEpoch })
    expect(rx.push(packets[0], 0).status).toBe('partial')
    expect(rx.push(packets[1], 10)).toMatchObject({ status: 'complete', event: large, chunked: true })
  })
```

- [ ] **Step 2: Run the backend and frontend fixture tests to verify they fail**

Run in `backend/`:
```powershell
npm test -- src/contracts/testing/voice-fixtures.spec.ts
```
Run in `frontend/`:
```powershell
npm test -- src/api/testing/voice-fixtures.test.ts
```
Expected: FAIL with `largeCanvasArtifactFixture is not a function`.

- [ ] **Step 3: Implement the updated control catalogs and `largeCanvasArtifactFixture` in `backend/src/contracts/testing/voice-fixtures.ts` and `frontend/src/api/testing/voice-fixtures.ts`**

In `backend/src/contracts/testing/voice-fixtures.ts`, import `type CanvasArtifactPayload` from `../voice-wire.js`, update `clientControls()` and `serverControls()`, and add `largeCanvasArtifactFixture`:

```typescript
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
    { mode: 'live', event: { ...envelope(6), type: 'input.suspend' } },
    { mode: 'live', event: { ...envelope(7), ...response(), type: 'playback.progress', playedMs: 100, playedSamples: 2400, proof: 'proven' } },
    { mode: 'live', event: { ...envelope(8), ...response(), type: 'playback.progress', playedMs: 100, playedSamples: 2400, proof: 'unproven' } },
    { mode: 'live', event: { ...envelope(9), ...response(), type: 'response.interrupt', playbackPositionMs: 100, playedSamples: 2400, proof: 'unproven' } },
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
    { mode: 'live', event: { ...envelope(3), ...response(), type: 'audio.start', sampleRate: 24000, firstAudioSequence: 0, firstAudioSample: 0 } },
    { mode: 'live', event: { ...envelope(4), ...response(), type: 'audio.watermark', firstAudioSample: 0, queuedSamples: 2400, lastAudioSample: 2400, final: false } },
    { mode: 'live', event: { ...envelope(5), ...response(), type: 'audio.watermark', firstAudioSample: 0, queuedSamples: 4800, lastAudioSample: 4800, final: true } },
    { mode: 'live', event: { ...envelope(6), ...response(), type: 'audio.end', lastAudioSequence: 2, firstAudioSample: 0, lastAudioSample: 4800, totalAudioSamples: 4800 } },
    { mode: 'live', event: { ...envelope(7), ...response(), type: 'response.cancelled', lastAudioSequence: 2, firstAudioSample: 0, lastAudioSample: 2400, totalAudioSamples: 2400 } },
    { mode: 'live', event: { ...envelope(8), type: 'session.warning', code: 'VOICE_DURATION_LIMIT', recovery: 'none', recoverable: true } },
    { mode: 'live', event: { ...envelope(9), type: 'session.error', code: 'VOICE_DELIVERY_UNKNOWN', recovery: 'return_to_chat', recoverable: false, terminal: true } },
    { mode: 'live', event: { ...envelope(10), type: 'session.ended', reason: 'completed', terminal: true } },
    { mode: 'live', event: { ...envelope(11), type: 'voice.state', input: 'suspended',
      agent: 'speaking', connection: 'connected' } },
    { mode: 'live', event: { ...envelope(12), type: 'session.error', code: 'MEDIA_GATE_UNAVAILABLE',
      recovery: 'resume_call', recoverable: true, terminal: false } },
    { mode: 'live', event: { ...envelope(13), type: 'session.ended', reason: 'quota', terminal: false } },
  ];
}
export function largeCanvasArtifactFixture(
  overrides: Partial<VoiceServerEvent & CanvasArtifactPayload> = {},
): VoiceServerEvent & CanvasArtifactPayload {
  return {
    ...envelope(14),
    eventId: 'event-canvas-large-1',
    type: 'canvas.artifact',
    ...response(),
    ordinal: 0,
    kind: 'mermaid',
    subType: 'Flowchart',
    title: 'Large WebRTC control artifact',
    rawSource: `flowchart TD\nA["${'界'.repeat(5200)}"] --> B["Complete"]`,
    ...overrides,
  };
}
```

Apply the same `clientControls()`, `serverControls()`, and `largeCanvasArtifactFixture()` updates to `frontend/src/api/testing/voice-fixtures.ts` (importing `type CanvasArtifactPayload` from `../voice-protocol`).

- [ ] **Step 4: Run the backend and frontend fixture tests to verify they pass**

Run in `backend/`:
```powershell
npm test -- src/contracts/testing/voice-fixtures.spec.ts
```
Run in `frontend/`:
```powershell
npm test -- src/api/testing/voice-fixtures.test.ts
```
Expected: PASS in both packages.

- [ ] **Step 5: Commit Task 3**

```powershell
git add backend/src/contracts/testing/voice-fixtures.ts backend/src/contracts/testing/voice-fixtures.spec.ts frontend/src/api/testing/voice-fixtures.ts frontend/src/api/testing/voice-fixtures.test.ts
git commit -m "test(contracts): add watermark, proof, and large canvas control fixtures"
```

---

## 4. Final Verification Commands & Exit Gate

Run the following verification commands from their respective package directories before reporting P1b complete:

### Focused Contract & Fixture Suites
In `backend/`:
```powershell
npm test -- src/contracts/voice.spec.ts src/contracts/testing/voice-fixtures.spec.ts src/platform/voice-dependencies.spec.ts
```
In `frontend/`:
```powershell
npm test -- src/api/voice-protocol.test.ts src/api/testing/voice-fixtures.test.ts
```
Expected: All focused tests pass, including byte-for-byte mirror parity between `backend/src/contracts/voice-wire.ts` and `frontend/src/api/voice-protocol.ts`.

### Package Build & Lint Checks
In `backend/`:
```powershell
npm run build
npm run lint
```
In `frontend/`:
```powershell
npm run build
npm run lint
```
Expected: Both packages compile and lint cleanly with zero errors.
