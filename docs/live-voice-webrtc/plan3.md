# Backend Bidirectional Media Bridge and Live Lifecycle (P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded LiveKit media/control adapter in front of Aurvin's existing LiveFlow, retaining its one turn owner, provider attribution, cancellation and durable generated-versus-heard evidence.

**Architecture:** An admitted backend participant publishes one 24 kHz assistant track and drains one trusted browser microphone through a 16 kHz/80 ms framer and a five-second upload gate. Reliable data packets carry the existing voice envelopes; the bridge delegates provider opening and every accepted turn to the existing application composition. Media, controls and persistence remain separate asynchronous lanes so a slow provider or evidence write cannot block an interruption.

**Tech Stack:** TypeScript ESM/NodeNext, existing Vitest 4 fixtures, P1-installed `@livekit/rtc-node@^1.2.1`, existing Flux adapters, LiveFlow, AgentVoiceAdapter and VoiceDelivery. No Agents SDK, packages, servers, paid calls or second runtime.

---

## Start conditions, ownership and important source corrections

- Execute only after this plan is committed and P1 implementation is complete. Use `executing-plans` and `test-driven-development`; use `systematic-debugging` for unexpected failures. Obtain the orchestrator's permission before staging/committing each task. Commands below are future worker commands, not actions performed by the planner.
- P3 owns only the files enumerated below. Do not edit `voice-session.options.ts`, `voice-session.service.ts`, `voice-session.controller.ts` or admission code (P2), `app.service.ts`, `app.module.ts`, `voice.gateway.ts`, `voice-connection.ts` or readiness (P5), contracts/manifests (P1), frontend (P4), or `backend/test/voice/integration/` (P8).
- Research line references are historical. Actual `VoiceSink` methods are `outputSamples`, `event`, `audio`, `invalidate`, `finish`, optional `pause`; not `send`/`close`. Its `audio` method is synchronous. Do not change this shared interface to make `captureFrame` awaitable.
- Actual `LiveFlow.suspendInput()` is private and accepts no argument. Task 1 exposes the tiny integration hook. Actual progress fields are `playedSamples`, `playedMs` and `playbackPositionMs`; actual reconnect limit is `limits.reconnectMs` (10 s), not `reconnectGraceMs`/15 s.
- Installed SDK types use `DataPacketKind.KIND_RELIABLE`, `TrackKind.KIND_AUDIO`, `TrackSource.SOURCE_MICROPHONE`, and publish option `destination_identities`. Do not copy the research's illustrative enum spelling into code.
- Providers `backend/src/voice/providers/flux-stt.ts`, `flux-tts.ts`, `nova-stt.ts` and `dictation-flow.ts` require **zero edits**. AgentVoiceAdapter, VoiceDelivery and usage services already contain the needed semantics; prefer extra integration assertions over modifying them.
- New code/test files get the repository's mandatory FILE/LOCATION/PURPOSE/ROLE/KEY COMPONENTS header before imports. Keep `.js` local import specifiers. Reuse `fakeStt`, `fakeTts`, `EventQueue` and `settle` rather than introducing another fixture framework.

### Blocking contract handoffs discovered during planning

These are requests to the upstream owners, **not authorization for P3 to edit or redefine contracts**:

1. **Playback watermark (P1/P4/P6, completion gate):** the frozen `VoiceServerPayload` has `audio.start.firstAudioSample` but no current/final generated-sample watermark. WebRTC carries no application binary headers. `audio.end` is currently emitted only *after* the final progress ACK. A browser cannot clamp exact progress or release a 2 s output window from this schema; elapsed time alone can over-ACK silence/jitter and is not proof. Ask P1 to freeze a response-bound queued/final sample announcement in the existing JSON-envelope protocol, with P4/P6 consumers. P3 must not overload sequence numbers, acknowledge from `AudioSource`, or guess a last sample. Tasks 1–6 can proceed independently; Task 7's WebRTC completion acceptance stays blocked until that contract is committed and this plan's consumer is reconciled.
2. **Reliable-packet size (P1/P4/P6, canvas gate):** LiveKit reliable packets have a practical 15 KiB application payload limit, while `MAX_VOICE_CONTROL_BYTES` is 128 KiB and a legal canvas artifact can exceed 15 KiB. Request a shared, bounded decision from P1: a supported transport framing/reassembly contract or compatible payload bound. Do not add a P3-only fragmentation protocol, silently truncate/drop artifacts, or switch to a second control socket. Task 4 safely rejects over-budget packets; this is not full canvas compatibility. Final P3/P5 acceptance remains blocked until the owner resolves and tests the legal large-envelope path.
3. **P2 lifecycle callback agreement (assembly handoff, not a new worker dependency):** P3 accepts the already trusted `SessionContext` and `LiveKitAdmissionTicket`. P5 maps the bridge's callbacks below to P2's session owner. P3 does not mint tokens, release reservations, delete rooms or perform another HTTP admission. P2/P5 must install cleanup before returning browser credentials and await old-epoch cleanup before constructing a replacement.

Primary-source check performed for this plan: [LiveKit reliable data packet limits](https://docs.livekit.io/transport/data/packets/) specify 15 KiB application payloads (16 KiB including protocol headers). SDK operations were checked against the installed `backend/node_modules/@livekit/rtc-node/dist/{audio_stream,audio_source,room,participant,track,track_publication}.d.ts` and SDK source: `captureFrame` issues its FFI request before awaiting its callback; AudioStream has no public capacity option. These are planning inputs, not real-media verification.

Do not report these gates as implemented or passed merely because deterministic small-packet tests pass. Send these findings to the orchestrator immediately when the worker starts.

## Exact consumed and exported integration interfaces

### Consume from P1

- `backend/src/contracts/voice-wire.ts`: `LIVEKIT_CONTROL_TOPIC`, `LIVE_WEBRTC_AUDIO`, `LIVEKIT_TEARDOWN_TIMEOUT_MS`, `MAX_VOICE_CONTROL_BYTES`, `VoiceClientEvent`, `VoiceServerPayload`, `VoiceServerEvent`, `VoiceResponseRef`, `VoiceErrorCode`, `parseVoiceControl`, `livekitRoomName`, `livekitAgentIdentity`, `livekitParticipantIdentity`, `isLiveKitVoiceSessionResponse`.
- `backend/src/contracts/voice.ts`: `LiveKitAdmissionTicket` (`transport`, `agentIdentity`, **server-only** `agentToken`, expiry), existing speech connections/events. P3 never serializes the ticket.
- `backend/src/contracts/testing/voice-fixtures.ts`: `createSessionResponseFixture('live')`, `livekitTransportFixture`, `livekitConfigFixture` and `deliveryFixture`.
- Keep P1's concrete sample/frame/gate constants. No resampler, codec, wire type, identity policy or configuration parser is added by P3.

### Consume from P2 through P5

The existing `SessionContext` holds server identity, response/epoch, reservation, captured configuration and `assertPaidWork`. P5 supplies these exact integration-local callbacks (defined in `livekit-media.ts`, **not** shared contracts):

```typescript
export type LiveKitFlow = Pick<LiveFlow,
  'start' | 'input' | 'control' | 'close' | 'suspendInput' | 'resumeCapture'>;
export type LiveKitMediaOptions = {
  context: SessionContext;
  ticket: LiveKitAdmissionTicket;
  open(context: SessionContext, sink: VoiceSink, signal: AbortSignal): Promise<LiveKitFlow>;
  ended(reason: 'completed' | 'cancelled' | 'error'): Promise<void>;
  disconnected(recoverable: boolean): Promise<void>;
  observe?(observation: VoiceObservation): void;
};
```

### Hand to P5

```typescript
// backend/src/voice/transport/livekit-media.ts
export class LiveKitMediaBridge implements VoiceSink {
  static connect(options: LiveKitMediaOptions): Promise<LiveKitMediaBridge>;
  outputSamples(): number;
  event(payload: VoiceServerPayload): void;
  audio(ref: VoiceResponseRef, pcm: Uint8Array): void;
  invalidate(ref: VoiceResponseRef): void;
  finish(reason: 'completed' | 'cancelled' | 'error'): void;
  pause(code: VoiceErrorCode, recoverable?: boolean): void;
  dispose(): Promise<void>;
}
```

- `connect` connects/publishes the backend participant, registers handlers and starts the finite handshake timer. It opens **no speech/model provider** until one valid `session.start` from the expected browser participant. `session.ready` precedes initial listening state.
- `dispose` is idempotent local teardown, including flow/provider/evidence drain, and **never calls** `ended`/`disconnected` itself. This avoids a P2 cleanup recursion/deadlock. Room-loss handlers initiate local fencing/disposal and then call `disconnected(true)` once; binding violations call `disconnected(false)` once. Explicit `session.end` calls `ended('completed')`, not a fabricated completed assistant turn.
- P5 sets P2 binding cleanup to `bridge.dispose`, forwards session warning/terminal/pause callbacks to `event`/`pause`, and maps `ended`/`disconnected` to P2's session methods. P2 alone owns lease release and active room revocation.
- P5 injects its existing live `openVoice` composition. Its current return annotation is `Promise<VoiceFlow>`; narrow the live result to the exported `LiveKitFlow` using the actual LiveFlow branch, not a second constructor/composition.
- Bridge failure never closes global MongoDB, runtime, text controllers, other rooms or the process. Do not call RTC process-global `dispose()` for one room.

## File map and bounded-state decisions

Create:

- `backend/src/voice/transport/livekit-input.ts`: exact PCM accumulator, quiet/pre-roll gate and finite STT-forward queue. No STT provider or turn inference logic.
- `backend/src/voice/transport/livekit-output.ts`: aligned PCM conversion, response cursor, bounded capture queue and generation fencing. No played/heard accounting.
- `backend/src/voice/transport/livekit-control.ts`: reliable packet/envelope FIFO with existing validation and bounded pending messages. No new wire protocol.
- `backend/src/voice/transport/livekit-media.ts`: SDK room/track lifetime and the existing live flow's transport-facing handshake/pause lifecycle.
- `backend/test/voice/transport/livekit-input.spec.ts`, `livekit-output.spec.ts`, `livekit-control.spec.ts`, `livekit-media.spec.ts`, `livekit-fixture.ts`: deterministic integration-local checks/mocks.
- `backend/test/voice/agent/livekit-pipeline.spec.ts`, `livekit-pipeline-fixture.ts`: real LiveFlow/AgentVoiceAdapter/VoiceDelivery with fake RTC and in-memory runtime ports; outside P8's integration directory.

Modify:

- `backend/src/voice/session/live-flow.ts`: expose quiet suspension/resumption only; correct a transport-failure cancellation hazard if the new regression demonstrates it.
- `backend/test/voice/session/live.spec.ts`: small direct hook/failure-order tests using its existing local fixture.

Do not create a new usage adapter; transport time/Opus packets are not provider billable audio. Existing provider accounting still measures the exact PCM actually written to STT and TTS's provider terminal events.

Bounds: one 2,560-byte partial accumulator; at most four pre-roll frames; aggregate application-held complete inbound frames (including the one in flight) at most `floor(inputQueueMs / 80)`; native output `AudioSource(24000, 1, outputQueueMs)` plus application capture queue at most `outputQueueMs * 48` bytes including the in-flight frame; at most 64 pending RX/TX controls and at most `MAX_VOICE_CONTROL_BYTES` aggregate bytes in each lane. Reserve one TX control slot/15 KiB for cancellation/error. Reject overflow, do not silently discard speech or replay a backlog after reconnect.

The installed AudioStream is a push-backed ReadableStream without a capacity option. Keep its reader draining without awaiting STT or durable writes; cancel the reader immediately on application overflow. Test this property. Do **not** claim a hard bound on undocumented native/SDK-internal backlog during a blocked Node event loop; record this SDK ceiling for P8. No private SDK monkey-patching or dependency fork.

---

### Task 1: Expose the existing quiet-input hooks, preserving turn ownership

**Files:** Modify `backend/src/voice/session/live-flow.ts` (existing `suspendInput`, adjacent resume helper); test `backend/test/voice/session/live.spec.ts`.

- [ ] **1. Write these failing tests** in the existing live spec, reusing its `fixture`, `settle` and `ref`:

```typescript
it('backend quiet hooks suspend once and resume after settlement without another turn owner', async () => {
  const f = await fixture();
  let finalized!: () => void;
  vi.mocked(f.stt.connection.finalize).mockImplementationOnce(() =>
    new Promise<void>(resolve => { finalized = resolve; }));
  f.flow.suspendInput('quiet');
  f.flow.suspendInput('quiet');
  f.flow.resumeCapture();
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  expect(f.stt.connection.finalize).toHaveBeenCalledTimes(1);
  finalized(); await settle();
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).toHaveBeenCalledTimes(1);
  expect(f.hooks.finalized).not.toHaveBeenCalled();
  expect(f.hooks.interrupt).not.toHaveBeenCalled();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.tts.port.connect).toHaveBeenCalledTimes(1);
});

it('backend speech onset cannot unmute a manually muted flow', async () => {
  const f = await fixture();
  await f.flow.control(f.control({ type: 'input.mute' }));
  f.flow.resumeCapture();
  await f.flow.input(new Uint8Array(2560));
  expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
  expect(f.stt.port.connect).toHaveBeenCalledTimes(1);
  expect(f.hooks.finalized).not.toHaveBeenCalled();
});
```

- [ ] **2. Run red**, working directory `backend/`:

```powershell
npm test -- test/voice/session/live.spec.ts -t "backend"
```

Expected: missing `resumeCapture` (and type checking reports private suspension/signature).

- [ ] **3. Minimal implementation:** change only the declaration `private suspendInput()` to the following, preserving its existing body. Add this public method immediately before private `resumeInput`. The reason is an integration-local literal, not another wire event or VAD policy:

```typescript
suspendInput(_reason: 'quiet' = 'quiet') {
```

```typescript
resumeCapture() {
  if (this.closed || this.muted) return;
  this.resumeRequested = true;
  this.resumeInput();
}
```

Leave the existing `input.suspend`/`input.unmute` callers operational. Do not create a synthetic client envelope for backend silence. The gate never calls `hooks.finalized`.

- [ ] **4. Run green and direct regressions**, directory `backend/`:

```powershell
npm test -- test/voice/session/live.spec.ts
```

Expected: new hook tests plus all existing mute/quiet-settlement/deduplicated-EndOfTurn tests pass; no provider sockets used.

- [ ] **5. Request serialized commit**, repository root:

```powershell
git add backend/src/voice/session/live-flow.ts backend/test/voice/session/live.spec.ts
git commit -m "feat(voice): expose existing live quiet capture hooks"
```

### Task 2: Exact input framing, five-second quiet gate and bounded forwarding

**Files:** Create `backend/src/voice/transport/livekit-input.ts` and `backend/test/voice/transport/livekit-input.spec.ts`.

- [ ] **1. Write the failing test file** with the mandatory header and these imports/tests. Frames use structural SDK values; no native Room is created:

```typescript
import { expect, it, vi } from 'vitest';
import { LiveKitInput } from '../../../src/voice/transport/livekit-input.js';
import { settle } from './fixtures.js';

const frame = (n: number, value = 1000) => ({
  data: new Int16Array(n).fill(value), sampleRate: 16000,
  channels: 1, samplesPerChannel: n,
});
function inputFixture(inputQueueMs = 1000) {
  const write = vi.fn(async (_pcm: Uint8Array) => undefined);
  const suspend = vi.fn(), resume = vi.fn(), fail = vi.fn();
  const input = new LiveKitInput(inputQueueMs, write, suspend, resume, fail);
  return { input, write, suspend, resume, fail };
}

it('assembles irregular native frames in exact little-endian sample order', async () => {
  const f = inputFixture();
  f.input.push(frame(160, 0x1234));
  f.input.push(frame(480, -32768));
  f.input.push(frame(640, 32767));
  f.input.push(frame(1279));
  await settle();
  expect(f.write).toHaveBeenCalledTimes(1);
  const bytes = f.write.mock.calls[0][0];
  expect(bytes).toHaveLength(2560);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([view.getInt16(0, true), view.getInt16(320, true), view.getInt16(1280, true)])
    .toEqual([0x1234, -32768, 32767]);
  f.input.close(); // 1279-sample tail must not be padded or submitted.
  expect(f.write).toHaveBeenCalledTimes(1);
});

it('suspends at five seconds, bounds pre-roll and waits for listening before onset upload', async () => {
  const f = inputFixture();
  for (let i = 0; i < 62; i++) { f.input.push(frame(1280, 0)); await settle(); }
  expect(f.suspend).not.toHaveBeenCalled();
  f.input.push(frame(1280, 0)); await settle();
  expect(f.suspend).toHaveBeenCalledTimes(1);
  const before = f.write.mock.calls.length;
  for (let i = 0; i < 100; i++) f.input.push(frame(1280, 0));
  expect(f.input.bufferedFrames).toBe(4);
  f.input.push(frame(1280, 600)); await settle();
  expect(f.resume).toHaveBeenCalledTimes(1);
  expect(f.write).toHaveBeenCalledTimes(before);
  f.input.setUploading(true); await settle();
  expect(f.write).toHaveBeenCalledTimes(before + 4);
  expect(f.fail).not.toHaveBeenCalled();
});

it('rejects format mismatch and overflows a blocked STT lane without unbounded promises', async () => {
  const f = inputFixture(160);
  let release!: () => void;
  f.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  f.input.push(frame(1280)); await settle();
  f.input.push(frame(1280));
  expect(f.input.bufferedFrames).toBe(2);
  f.input.push(frame(1280));
  expect(f.fail).toHaveBeenCalledExactlyOnceWith('AUDIO_BUFFER_OVERFLOW');
  release(); await settle();
  expect(f.write).toHaveBeenCalledTimes(1);
  const g = inputFixture();
  g.input.push({ ...frame(1280), sampleRate: 48000 });
  expect(g.fail).toHaveBeenCalledExactlyOnceWith('INVALID_AUDIO_FRAME');
  expect(g.write).not.toHaveBeenCalled();
});
```

- [ ] **2. Run red**, directory `backend/`:

```powershell
npm test -- test/voice/transport/livekit-input.spec.ts
```

Expected: missing module/export.

- [ ] **3. Implement the following integration-local class**, with the required file header before imports:

```typescript
import { LIVE_WEBRTC_AUDIO as A, type VoiceErrorCode } from '../../contracts/voice-wire.js';
type DecodedFrame = { data: Int16Array; sampleRate: number; channels: number; samplesPerChannel: number };

export class LiveKitInput {
  private partial = new Uint8Array(A.sttFrameBytes);
  private used = 0;
  private quietMs = 0;
  private suspended = false;
  private waking = false;
  private uploading = true;
  private enabled = true;
  private closed = false;
  private preRoll: Uint8Array[] = [];
  private queue: Uint8Array[] = [];
  private running = false;
  private inFlight = false;
  private readonly maxFrames: number;
  constructor(inputQueueMs: number,
    private readonly write: (pcm: Uint8Array) => Promise<void>,
    private readonly suspend: () => void,
    private readonly resume: () => void,
    private readonly fail: (code: VoiceErrorCode) => void) {
    this.maxFrames = Math.floor(inputQueueMs / A.sttFrameMs);
  }
  get bufferedFrames() { return this.preRoll.length + this.queue.length + Number(this.inFlight); }
  private failure(code: VoiceErrorCode) { if (!this.closed) { this.close(); this.fail(code); } }
  push(frame: DecodedFrame) {
    if (this.closed || !this.enabled) return;
    if (frame.sampleRate !== A.sttSampleRateHz || frame.channels !== A.sttChannels ||
      frame.samplesPerChannel !== frame.data.length || !frame.data.length ||
      frame.data.byteLength > this.maxFrames * A.sttFrameBytes) {
      this.failure('INVALID_AUDIO_FRAME'); return;
    }
    for (const sample of frame.data) {
      if (this.closed) break;
      this.partial[this.used++] = sample & 255;
      this.partial[this.used++] = (sample >> 8) & 255;
      if (this.used === A.sttFrameBytes) {
        const pcm = this.partial;
        this.partial = new Uint8Array(A.sttFrameBytes); this.used = 0;
        this.accept(pcm);
      }
    }
  }
  private accept(pcm: Uint8Array) {
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let speech = false;
    for (let window = 0; window < 4; window++) {
      let active = false;
      for (let i = window * 320; i < (window + 1) * 320; i++)
        if (Math.abs(view.getInt16(i * 2, true)) >= A.quietPeakThreshold) active = true;
      speech ||= active;
      this.quietMs = active ? 0 : this.quietMs + A.quietFrameWindowMs;
    }
    if (!this.suspended && this.quietMs >= A.quietHangoverMs) {
      this.suspended = true; this.uploading = false; this.waking = false;
      this.queue = []; this.preRoll = []; this.remember(pcm); this.suspend(); return;
    }
    if (this.suspended && !this.waking) {
      this.remember(pcm);
      if (!speech) return;
      this.waking = true;
      const onset = this.preRoll; this.preRoll = [];
      for (const part of onset) this.enqueue(part);
      if (!this.closed) this.resume();
      return;
    }
    this.enqueue(pcm);
  }
  private remember(pcm: Uint8Array) {
    this.preRoll.push(pcm);
    while (this.preRoll.length && (this.preRoll.length > A.quietPreRollFrames ||
      this.bufferedFrames > this.maxFrames)) this.preRoll.shift();
  }
  private enqueue(pcm: Uint8Array) {
    if (this.closed) return;
    if (this.bufferedFrames >= this.maxFrames) { this.failure('AUDIO_BUFFER_OVERFLOW'); return; }
    this.queue.push(pcm); this.drain();
  }
  private drain() {
    if (this.running || !this.uploading || !this.enabled || this.closed) return;
    this.running = true;
    void (async () => {
      try {
        while (this.queue.length && this.uploading && this.enabled && !this.closed) {
          const pcm = this.queue.shift()!;
          this.inFlight = true;
          try { await this.write(pcm); } finally { this.inFlight = false; }
        }
      } catch { this.failure('STT_UNAVAILABLE'); }
      finally { this.running = false; if (this.queue.length) this.drain(); }
    })();
  }
  setUploading(enabled: boolean) {
    if (this.closed || this.uploading === enabled) return;
    this.uploading = enabled;
    if (enabled) { this.suspended = false; this.waking = false; this.quietMs = 0; this.preRoll = []; this.drain(); }
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled; this.reset();
  }
  private reset() {
    this.used = 0; this.partial = new Uint8Array(A.sttFrameBytes);
    this.queue = []; this.preRoll = []; this.quietMs = 0;
    this.suspended = false; this.waking = false; this.uploading = true;
  }
  close() { this.closed = true; this.enabled = false; this.reset(); }
}
```

Queue clearing plus the existing one-in-flight STT write is sufficient; no old pending audio is forwarded after reset. Add this reset-race test. An already-issued provider write cannot be recalled or unbilled:

```typescript
it('discards partial and queued frames on mute before forwarding fresh input', async () => {
  const f = inputFixture(); let release!: () => void;
  f.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  f.input.push(frame(1280, 1000)); await settle();
  f.input.push(frame(1280, 2000)); f.input.push(frame(100, 3000));
  f.input.setEnabled(false); f.input.setEnabled(true);
  f.input.push(frame(1280, 4000)); release(); await settle();
  expect(f.write).toHaveBeenCalledTimes(2);
  const fresh = f.write.mock.calls[1][0];
  expect(new DataView(fresh.buffer, fresh.byteOffset).getInt16(0, true)).toBe(4000);
  f.input.close();
});
```

Keep the source failure code when `write` rejects with a `VoiceSessionError` (notably quota exhaustion): replace the catch with the existing helper rather than masking it as STT failure:

```typescript
import { voiceError } from '../session/voice-session.options.js';
// In drain:
} catch (error) { this.failure(voiceError(error, 'STT_UNAVAILABLE').code); }
```

- [ ] **4. Run green**, directory `backend/`:

```powershell
npm test -- test/voice/transport/livekit-input.spec.ts test/voice/session/live.spec.ts
```

Expected: exact frame/order/threshold/overflow/reset checks pass. Silence is scored by decoded audio duration, not delayed wall-clock packet arrival. An incomplete tail is discarded, never padded, ForceEndTurn'ed or submitted as an accepted turn.

- [ ] **5. Request serialized commit**, root:

```powershell
git add backend/src/voice/transport/livekit-input.ts backend/test/voice/transport/livekit-input.spec.ts
git commit -m "feat(voice): frame and bound LiveKit input with quiet gating"
```

### Task 3: Bounded 24 kHz output with synchronous invalidation and capture fencing

**Files:** Create `backend/src/voice/transport/livekit-output.ts`, `backend/test/voice/transport/livekit-output.spec.ts`.

- [ ] **1. Write failing tests** (prepend mandatory header). `AudioFrame` construction alone does not join a room:

```typescript
import { expect, it, vi } from 'vitest';
import { LiveKitOutput } from '../../../src/voice/transport/livekit-output.js';
import { settle } from './fixtures.js';
const ref = { turnId: 't1', responseId: 'r1' };
function fixture() {
  const frames: Int16Array[] = [];
  const source = {
    captureFrame: vi.fn(async (f: { data: Int16Array; sampleRate: number; channels: number }) => {
      expect([f.sampleRate, f.channels]).toEqual([24000, 1]); frames.push(f.data.slice());
    }),
    clearQueue: vi.fn(),
  };
  const send = vi.fn(), fail = vi.fn();
  return { source, send, fail, frames, output: new LiveKitOutput(source, 2000, send, fail) };
}
it('copies unaligned PCM and maintains exact monotonic response origins', async () => {
  const f = fixture();
  f.output.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
  const raw = new Uint8Array([99, 0, 128, 255, 127]);
  f.output.audio(ref, raw.subarray(1)); raw.fill(0); await settle();
  expect([...f.frames[0]]).toEqual([-32768, 32767]);
  expect(f.output.outputSamples()).toBe(24);
  f.output.invalidate(ref);
  f.output.event({ type: 'audio.start', turnId: 't2', responseId: 'r2', sampleRate: 24000, firstAudioSequence: 0 });
  expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ firstAudioSample: 24 }));
});
it('clears immediately and never captures queued old-generation audio after a delayed capture', async () => {
  const f = fixture(); let release!: () => void;
  f.source.captureFrame.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  f.output.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
  f.output.audio(ref, new Uint8Array(9600));
  f.output.audio(ref, new Uint8Array(9600));
  await settle();
  f.output.invalidate(ref);
  expect(f.source.clearQueue).toHaveBeenCalledTimes(1);
  f.output.audio(ref, new Uint8Array(9600));
  const next = { turnId: 't2', responseId: 'r2' };
  f.output.event({ type: 'audio.start', ...next, sampleRate: 24000, firstAudioSequence: 0 });
  f.output.audio(next, new Uint8Array([1, 0]));
  release(); await settle();
  expect(f.source.captureFrame).toHaveBeenCalledTimes(2);
  expect(f.source.clearQueue).toHaveBeenCalledTimes(2);
  expect([...f.frames[0]]).toEqual([1]);
  expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'response.cancelled', ...ref }));
});
it('bounds retained output bytes and never interprets capture as played progress', async () => {
  const f = fixture();
  f.source.captureFrame.mockImplementation(() => new Promise<void>(() => {}));
  f.output.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
  for (let i = 0; i < 11; i++) f.output.audio(ref, new Uint8Array(9600));
  expect(f.fail).toHaveBeenCalledExactlyOnceWith('AUDIO_BUFFER_OVERFLOW');
  expect(f.send.mock.calls.some(([e]) => e.type === 'playback.progress' || e.type === 'audio.end')).toBe(false);
});
```

- [ ] **2. Run red**, directory `backend/`:

```powershell
npm test -- test/voice/transport/livekit-output.spec.ts
```

Expected: missing module/export.

- [ ] **3. Implement this class** with the mandatory header:

```typescript
import { AudioFrame } from '@livekit/rtc-node';
import { LIVE_WEBRTC_AUDIO as A, type VoiceResponseRef as Ref,
  type VoiceServerPayload, type VoiceErrorCode } from '../../contracts/voice-wire.js';
import { fault } from '../session/voice-session.options.js';
type Source = { captureFrame(frame: AudioFrame): Promise<void>; clearQueue(): void };
type Part = { generation: number; frame: AudioFrame; bytes: number };
export class LiveKitOutput {
  private active?: Ref & { last: number | null };
  private cursor = 0;
  private sequence = 0;
  private generation = 0;
  private queue: Part[] = [];
  private held = 0;
  private running = false;
  private closed = false;
  private failed = false;
  constructor(private readonly source: Source, private readonly queueMs: number,
    private readonly send: (payload: VoiceServerPayload) => void,
    private readonly fail: (code: VoiceErrorCode) => void) {}
  outputSamples() { return Math.ceil(this.cursor / 24) * 24; }
  event(payload: VoiceServerPayload) {
    if (this.closed) return;
    if (payload.type === 'audio.start') {
      if (this.active) fault('VOICE_INVALID_STATE');
      this.failed = false;
      this.cursor = this.outputSamples();
      this.active = { turnId: payload.turnId, responseId: payload.responseId, last: null };
      payload = { ...payload, firstAudioSample: this.cursor, firstAudioSequence: this.sequence };
    } else if (payload.type === 'audio.end') {
      if (!this.matches(payload)) fault('VOICE_BINDING_MISMATCH');
      payload = { ...payload, lastAudioSequence: this.active!.last }; this.active = undefined;
    }
    this.send(payload);
  }
  private matches(ref: Ref) {
    return this.active?.turnId === ref.turnId && this.active.responseId === ref.responseId;
  }
  audio(ref: Ref, pcm: Uint8Array) {
    if (this.closed || this.failed || !this.matches(ref)) return;
    if (!pcm.byteLength || pcm.byteLength % 2 || pcm.byteLength > A.ttsMaxChunkBytes)
      fault('INVALID_AUDIO_FRAME');
    if (this.held + pcm.byteLength > this.queueMs * 48) {
      this.failure('AUDIO_BUFFER_OVERFLOW'); return;
    }
    const samples = new Int16Array(pcm.byteLength / 2);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true);
    this.queue.push({ generation: this.generation, bytes: pcm.byteLength,
      frame: new AudioFrame(samples, A.ttsSampleRateHz, A.ttsChannels, samples.length) });
    this.held += pcm.byteLength;
    this.cursor += samples.length; this.active!.last = this.sequence++;
    this.drain();
  }
  private drain() {
    if (this.running || this.closed) return;
    this.running = true;
    void (async () => {
      try {
        while (this.queue.length && !this.closed) {
          const part = this.queue.shift()!;
          try { await this.source.captureFrame(part.frame); }
          finally { this.held -= part.bytes; }
          // ponytail: one capture in flight; clear its late native residue before any newer generation.
          if (part.generation !== this.generation) this.source.clearQueue();
        }
      } catch { this.failure('VOICE_DELIVERY_UNKNOWN'); }
      finally { this.running = false; }
    })();
  }
  private failure(code: VoiceErrorCode) {
    if (this.closed || this.failed) return;
    this.failed = true;
    try { this.clear(); } catch { /* Native source may already be gone. */ }
    this.fail(code);
  }
  clear() {
    this.generation++;
    this.held -= this.queue.reduce((sum, part) => sum + part.bytes, 0);
    this.queue = [];
    this.source.clearQueue();
  }
  invalidate(ref: Ref) {
    if (!this.matches(ref)) return;
    const last = this.active!.last; this.active = undefined;
    this.clear();
    this.send({ type: 'response.cancelled', ...ref, lastAudioSequence: last });
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.active = undefined; this.clear();
  }
}
```

`clearQueue` can itself throw after a media fault. Ensure the media owner catches it in cleanup without skipping flow/provider cancellation. Add a rejecting-capture test and an invalidation-after-close test; both must produce no unhandled rejection. No `waitForPlayout` result becomes durable playback proof.

- [ ] **4. Run green**, directory `backend/`:

```powershell
npm test -- test/voice/transport/livekit-output.spec.ts
```

Expected: aligned copy, stale ref drop, late capture fencing, monotonic discarded-sample cursor and finite overflow pass.

- [ ] **5. Request serialized commit**, root:

```powershell
git add backend/src/voice/transport/livekit-output.ts backend/test/voice/transport/livekit-output.spec.ts
git commit -m "feat(voice): publish bounded generation-fenced LiveKit audio"
```

### Task 4: Existing envelopes over bounded reliable data packets

**Files:** Create `backend/src/voice/transport/livekit-control.ts`, `backend/test/voice/transport/livekit-control.spec.ts`.

- [ ] **1. Write red tests** with mandatory header:

```typescript
import { expect, it, vi } from 'vitest';
import { LiveKitControls } from '../../../src/voice/transport/livekit-control.js';
import { INPUT_AUDIO, LIVEKIT_CONTROL_TOPIC, parseVoiceControl, type VoiceClientEvent } from '../../../src/contracts/voice-wire.js';
import { createSessionResponseFixture } from '../../../src/contracts/testing/voice-fixtures.js';
import { settle } from './fixtures.js';
function fixture() {
  const response = createSessionResponseFixture('live');
  const receive = vi.fn(async (_event: VoiceClientEvent) => undefined);
  const publish = vi.fn(async (_bytes: Uint8Array) => undefined), fail = vi.fn();
  const controls = new LiveKitControls(response, publish, receive, fail);
  const event = (sequence = 0) => ({ protocolVersion: 1, sessionId: response.sessionId,
    connectionEpoch: response.connectionEpoch, sequence, eventId: `c${sequence}`,
    type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO });
  const push = (e: object, identity = response.livekit!.participantIdentity) =>
    controls.receive(new TextEncoder().encode(JSON.stringify(e)), identity, true, LIVEKIT_CONTROL_TOPIC);
  return { response, receive, publish, fail, controls, event, push };
}
it('validates identity/session/epoch and fences ordered replays before opening a flow', async () => {
  const f = fixture(); f.push(f.event()); f.push(f.event()); await settle();
  expect(f.receive).toHaveBeenCalledTimes(1);
  f.push({ ...f.event(1), connectionEpoch: 999 }); await settle();
  expect(f.fail).toHaveBeenLastCalledWith('STALE_CONNECTION_EPOCH');
  const g = fixture(); g.push(g.event(), 'untrusted'); await settle();
  expect(g.fail).toHaveBeenCalledWith('VOICE_BINDING_MISMATCH');
  expect(g.receive).not.toHaveBeenCalled();
});
it('serializes valid server envelopes without forwarding backend tokens or payload logs', async () => {
  const f = fixture();
  f.controls.send({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' });
  f.controls.send({ type: 'session.ended', reason: 'disconnected', terminal: false }); await settle();
  const events = f.publish.mock.calls.map(([bytes]) => parseVoiceControl(new TextDecoder().decode(bytes), 'server', 'live'));
  expect(events.map(e => e.sequence)).toEqual([0, 1]);
  expect(JSON.stringify(events)).not.toContain(f.response.livekit!.participantToken);
});
it('rejects malformed UTF8, sequence gaps and oversized reliable packets before dispatch', async () => {
  const f = fixture(); f.push(f.event(1)); await settle();
  expect(f.fail).toHaveBeenCalledWith('VOICE_SEQUENCE_ERROR');
  const g = fixture();
  g.controls.receive(new Uint8Array([255]), g.response.livekit!.participantIdentity, true, LIVEKIT_CONTROL_TOPIC);
  await settle(); expect(g.fail).toHaveBeenCalledWith('INVALID_VOICE_CONTROL');
  const h = fixture();
  h.controls.receive(new Uint8Array(15361), h.response.livekit!.participantIdentity, true, LIVEKIT_CONTROL_TOPIC);
  expect(h.fail).toHaveBeenCalledWith('INVALID_VOICE_CONTROL');
  expect(h.receive).not.toHaveBeenCalled();
});
```

- [ ] **2. Run red**, directory `backend/`:

```powershell
npm test -- test/voice/transport/livekit-control.spec.ts
```

Expected: missing module. Annotate the test `publish` and `receive` spies with the actual function parameter types when creating the file (Vitest otherwise infers no arguments).

- [ ] **3. Implement the control FIFO** with the mandatory header. This is transport framing only; JSON schemas remain P1-owned:

```typescript
import { randomUUID } from 'node:crypto';
import { LIVEKIT_CONTROL_TOPIC, MAX_VOICE_CONTROL_BYTES, parseVoiceControl,
  type CreateVoiceSessionResponse, type VoiceClientEvent, type VoiceServerPayload,
  type VoiceErrorCode } from '../../contracts/voice-wire.js';
import { fault, voiceError } from '../session/voice-session.options.js';
const PACKET_BYTES = 15 * 1024;
export class LiveKitControls {
  private rx = -1;
  private tx = 0;
  private ids = new Set<string>();
  private rxCount = 0;
  private rxBytes = 0;
  private txCount = 0;
  private txBytes = 0;
  private incoming = Promise.resolve();
  private outgoing = Promise.resolve();
  private closed = false;
  constructor(private readonly response: CreateVoiceSessionResponse,
    private readonly publish: (bytes: Uint8Array) => Promise<void>,
    private readonly dispatch: (event: VoiceClientEvent) => Promise<void>,
    private readonly fail: (code: VoiceErrorCode) => void) {}
  receive(bytes: Uint8Array, identity: string | undefined, reliable: boolean, topic?: string) {
    if (this.closed || topic !== LIVEKIT_CONTROL_TOPIC) return;
    if (identity !== this.response.livekit!.participantIdentity) { this.fail('VOICE_BINDING_MISMATCH'); return; }
    if (!reliable || bytes.byteLength > PACKET_BYTES) { this.fail('INVALID_VOICE_CONTROL'); return; }
    if (this.rxCount >= 64 || this.rxBytes + bytes.byteLength > MAX_VOICE_CONTROL_BYTES) {
      this.fail('AUDIO_BUFFER_OVERFLOW'); return;
    }
    const copy = Uint8Array.from(bytes); this.rxCount++; this.rxBytes += copy.byteLength;
    this.incoming = this.incoming.then(async () => {
      if (this.closed) return;
      let json: string;
      try { json = new TextDecoder('utf-8', { fatal: true }).decode(copy); }
      catch { fault('INVALID_VOICE_CONTROL'); }
      const e = parseVoiceControl(json!, 'client', 'live');
      if (e.sessionId !== this.response.sessionId) fault('VOICE_BINDING_MISMATCH');
      if (e.connectionEpoch !== this.response.connectionEpoch) fault('STALE_CONNECTION_EPOCH');
      if (e.sequence <= this.rx) return;
      if (e.sequence !== this.rx + 1 || this.ids.has(e.eventId)) fault('VOICE_SEQUENCE_ERROR');
      if (this.ids.size === 4096) this.ids.delete(this.ids.values().next().value!);
      this.ids.add(e.eventId); this.rx = e.sequence;
      await this.dispatch(e);
    }).catch(error => this.fail(voiceError(error, 'VOICE_DELIVERY_UNKNOWN').code))
      .finally(() => { this.rxCount--; this.rxBytes -= copy.byteLength; });
  }
  send(payload: VoiceServerPayload) {
    if (this.closed) return;
    if (this.tx > 0xffffffff) fault('VOICE_SEQUENCE_ERROR');
    const json = JSON.stringify({ protocolVersion: 1, sessionId: this.response.sessionId,
      connectionEpoch: this.response.connectionEpoch, eventId: randomUUID(), sequence: this.tx++, ...payload });
    parseVoiceControl(json, 'server', 'live');
    const bytes = new TextEncoder().encode(json);
    if (bytes.byteLength > PACKET_BYTES) { this.fail('INVALID_VOICE_CONTROL'); return; }
    const priority = ['response.cancelled', 'session.error', 'session.ended'].includes(payload.type);
    if (this.txCount >= (priority ? 64 : 63) ||
      this.txBytes + bytes.byteLength > MAX_VOICE_CONTROL_BYTES + (priority ? PACKET_BYTES : 0)) {
      this.fail('AUDIO_BUFFER_OVERFLOW'); return;
    }
    this.txCount++; this.txBytes += bytes.byteLength;
    this.outgoing = this.outgoing.then(async () => { if (!this.closed) await this.publish(bytes); })
      .catch(() => this.fail('VOICE_DELIVERY_UNKNOWN'))
      .finally(() => { this.txCount--; this.txBytes -= bytes.byteLength; });
  }
  close() { this.closed = true; this.ids.clear(); }
}
```

Add exact assertions for wrong topic/lossy packets, mismatched session, duplicate eventId at a new sequence, 65 queued controls while dispatch is blocked, and publish rejection. Use the same `fixture`; hold `receive`/`publish` with one deferred Promise, release it in `finally`. Ensure terminal failure is latched by the media owner so a publish failure cannot recursively enqueue errors forever. Packet-size behavior must be reconciled with P1's large-envelope solution before final acceptance; do not label the current rejection a compatible canvas implementation.

- [ ] **4. Run green**, directory `backend/`:

```powershell
npm test -- test/voice/transport/livekit-control.spec.ts
```

- [ ] **5. Request serialized commit**, root:

```powershell
git add backend/src/voice/transport/livekit-control.ts backend/test/voice/transport/livekit-control.spec.ts
git commit -m "feat(voice): carry ordered voice envelopes over reliable LiveKit data"
```

### Task 5: Join one admitted room and attach existing LiveFlow only after session.start

**Files:** Create `backend/src/voice/transport/livekit-media.ts`, `backend/test/voice/transport/livekit-fixture.ts`, `backend/test/voice/transport/livekit-media.spec.ts`.

- [ ] **1. Create a deterministic SDK fake**, each new file with the mandatory header. Use `vi.hoisted` plus `vi.mock('@livekit/rtc-node', ...)` in `livekit-fixture.ts`; re-export production enums and AudioFrame via `vi.importActual`, replace **only** Room/AudioStream/AudioSource/LocalAudioTrack. Room is `EventEmitter`, `connect`/`disconnect` are spies, `localParticipant.publishData` captures decoded envelopes, `publishTrack` resolves `{ sid: 'assistant-track' }`, `name` and local participant identity are set by the fake connect. AudioStream is a `ReadableStream` with a saved controller and spy on cancellation. AudioSource records construction arguments, copies captured frames, exposes deferred/rejectable `captureFrame`, `clearQueue` and `close`. LocalAudioTrack's factory returns a track with a close spy. Export `rtcFixture()` that resets shared arrays and returns `rooms`, `sources`, `streams`, `events`, `pushFrame` and `emitControl`. It must not import production media before the mock is registered.

Use the following exact event injector and fake decoded stream body; no socket/network fixture is necessary:

```typescript
emitControl(payload: VoiceClientPayload, sequence: number, identity = browserIdentity) {
  room.emit('dataReceived', new TextEncoder().encode(JSON.stringify({
    protocolVersion: 1, sessionId: response.sessionId, connectionEpoch: response.connectionEpoch,
    sequence, eventId: `control-${sequence}`, ...payload,
  })), { identity }, DataPacketKind.KIND_RELIABLE, LIVEKIT_CONTROL_TOPIC);
}
```

```typescript
new ReadableStream({
  start(controller) { streams.push({ controller, track, options }); },
  cancel() { cancelled(); },
});
```

The media spec's local fixture creates the trusted context and fake flow as follows (import the named types/constants/fixtures from their mapped paths):

```typescript
const response = createSessionResponseFixture('live');
const expiresAtMs = Date.now() + response.limits.connectMs;
response.expiresAt = new Date(expiresAtMs).toISOString();
const voice = loadVoiceConfig(enabledVoiceEnvironment());
const context: SessionContext = {
  identity: { userId: 'aurvin-dev-user', source: 'server-configured', openRouterUser: 'aurvin-dev-user' },
  response,
  reservation: { reservationId: 'reservation-1', userId: 'aurvin-dev-user', conversationId: null,
    owner: { kind: 'live', voiceSessionId: response.sessionId } },
  voiceConfig: { ...voice, dictationWarningMs: 270000 }, configSnapshot: null,
  assertPaidWork: vi.fn(),
};
const ticket: LiveKitAdmissionTicket = {
  transport: response.livekit!, agentIdentity: livekitAgentIdentity(response.sessionId),
  agentToken: 'offline-server-token', expiresAtMs,
  ttlSeconds: Math.ceil(response.limits.connectMs / 1000),
};
const flow = {
  start: vi.fn(), input: vi.fn(async (_pcm: Uint8Array) => undefined),
  control: vi.fn(async (_event: VoiceClientEvent) => undefined),
  close: vi.fn(async () => undefined), suspendInput: vi.fn(), resumeCapture: vi.fn(),
};
const open = vi.fn(async (_context: SessionContext, _sink: VoiceSink, _signal: AbortSignal): Promise<LiveKitFlow> => flow);
const ended = vi.fn(async (_reason: 'completed' | 'cancelled' | 'error') => undefined);
const disconnected = vi.fn(async (_recoverable: boolean) => undefined);
const bridge = await LiveKitMediaBridge.connect({ context, ticket, open, ended, disconnected });
```

No `VoiceSessionService.create/claim` is needed, so this test does not depend on P2's changing cookie implementation.

Write these initially failing assertions in `livekit-media.spec.ts`:

```typescript
it('joins and publishes without provider work, then starts exactly once on a valid control', async () => {
  const f = await fixture();
  expect(f.open).not.toHaveBeenCalled();
  expect(f.rtc.sources[0].args).toEqual([24000, 1, 2000]);
  expect(f.rtc.rooms[0].connect).toHaveBeenCalledWith(f.ticket.transport.url, f.ticket.agentToken,
    expect.objectContaining({ autoSubscribe: false }));
  f.emitControl({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }, 0);
  f.emitControl({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }, 0);
  await settle();
  expect(f.open).toHaveBeenCalledTimes(1);
  expect(f.flow.start).toHaveBeenCalledTimes(1);
  expect(f.events().map(e => e.type)).toEqual(['session.ready', 'voice.state']);
  await f.bridge.dispose();
});

it('accepts only the expected participant microphone and drains reads while STT is blocked', async () => {
  const f = await fixture(); await f.start();
  f.subscribe('intruder', TrackSource.SOURCE_MICROPHONE);
  expect(f.rtc.streams).toHaveLength(0);
  f.subscribe(f.browserIdentity, TrackSource.SOURCE_MICROPHONE);
  expect(f.rtc.streams[0].options).toEqual({ sampleRate: 16000, numChannels: 1, frameSizeMs: 80 });
  let release!: () => void;
  f.flow.input.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  for (let i = 0; i < 13; i++) { f.pushFrame(new Int16Array(1280).fill(1000)); await settle(); }
  expect(f.flow.input).toHaveBeenCalledTimes(1);
  expect(f.rtc.streams[0].cancelled).toHaveBeenCalledTimes(1);
  expect(f.events()).toContainEqual(expect.objectContaining({ code: 'AUDIO_BUFFER_OVERFLOW' }));
  release(); await f.bridge.dispose();
});
```

Define `fixture`, `start`, `subscribe`, `pushFrame`, `events` and `emitControl` exactly as described here in the test helper; these are integration-local fixture methods, not proposed application APIs. `subscribe` emits `trackPublished` with a fake publication whose `setSubscribed` spy is checked, then emits `trackSubscribed` for that same publication. Assert camera/unknown sources and another microphone publication do not create another stream.

- [ ] **2. Run red**, directory `backend/`:

```powershell
npm test -- test/voice/transport/livekit-media.spec.ts
```

Expected: missing bridge export. Add the imports for types/constants/enums named above; use the installed declarations, not `any` casts that conceal SDK API mismatches.

- [ ] **3. Implement the media owner** with the exported interfaces above and these concrete SDK operations:

```typescript
const room = new Room();
const source = new AudioSource(24000, 1, context.response.limits.outputQueueMs);
const track = LocalAudioTrack.createAudioTrack('aurvin-assistant', source);
const controls = new LiveKitControls(context.response,
  bytes => room.localParticipant!.publishData(bytes, {
    reliable: true, topic: LIVEKIT_CONTROL_TOPIC,
    destination_identities: [ticket.transport.participantIdentity],
  }), event => this.control(event), code => this.fail(code));
const output = new LiveKitOutput(source, context.response.limits.outputQueueMs,
  payload => controls.send(payload), code => this.pause(code));
```

Validate the **once-per-bridge** trusted descriptor: live mode, descriptor/room/agent/browser identity bound to context.sessionId/userId/epoch, ticket transport equal to context.response.livekit. A mismatch throws `VOICE_BINDING_MISMATCH` before joining, allocating a source or opening providers. Do not parse browser user metadata or arbitrary client identity.

Register named handlers **before** connecting. Connect within `limits.connectMs`; set `autoSubscribe: false`, `dynacast: false`, and data-stream payload ceiling `MAX_VOICE_CONTROL_BYTES` in `RoomOptions`. Publish the one local audio track using `new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE })`. Assert actual room name and agent identity after join; reject mismatch. Set the `session.start` deadline to the original admission expiry/connect budget, not a fresh unbounded window. On late connection success after disposal, disconnect immediately.

For remote tracks, use explicit subscription rather than subscribing to all participants:

```typescript
if (participant.identity === ticket.transport.participantIdentity &&
    publication.kind === TrackKind.KIND_AUDIO &&
    publication.source === TrackSource.SOURCE_MICROPHONE && !this.microphoneSid) {
  this.microphoneSid = publication.sid;
  publication.setSubscribed(true);
}
```

Inspect already published tracks after join using the same handler. For a matching `trackSubscribed`, reject duplicate track ownership, create precisely one `AudioStream(track, { sampleRate: 16000, numChannels: 1, frameSizeMs: 80 })`, acquire its reader, and continuously `await reader.read()`/synchronously `input.push(value)` without awaiting `flow.input`. Before ready/while paused discard input, do not accumulate startup/reconnect audio. Catch stream rejection; expected reader cancellation during disposal is not an error.

The `session.start` handler sets `starting` synchronously before awaiting `options.open`, calls `context.assertPaidWork`, opens once with the existing abort signal, rechecks admission/closed/paused after await, closes any late flow, constructs `LiveKitInput` callbacks into that flow, and sends ready before starting it:

```typescript
this.input = new LiveKitInput(context.response.limits.inputQueueMs,
  pcm => flow.input(pcm), () => flow.suspendInput('quiet'),
  () => flow.resumeCapture(), code => this.pause(code));
this.flow = flow;
this.controls.send({ type: 'session.ready', limits: context.response.limits,
  effectiveAudioSettings: context.response.effectiveAudioSettings });
this.ready = true;
flow.start();
this.event({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' });
```

Existing LiveFlow.start does not emit initial state. A replayed envelope is ignored by controls; a *new* second `session.start` is `VOICE_INVALID_STATE`, not another provider open. All other controls require ready or paused state; `session.end` calls `finish('completed')`. `input.mute` synchronously disables/resets input before awaiting the real flow control; `input.unmute` resets input and enables it only after successful provider/control completion. Interruption/progress delegate unchanged to `flow.control` and never await the STT-forward lane.

`event` observes actual input-state **transitions** to call `input.setUploading`; do not reset the quiet clock every time thinking/speaking state emits `listening`. Delegate payloads to output, which delegates controls. `audio`/`invalidate`/`outputSamples` delegate to output. The `audio.start` transport cursor is logical generated audio including discarded samples, not Opus RTP sequence or wall clock.

- [ ] **4. Run green**, directory `backend/`:

```powershell
npm test -- test/voice/transport/livekit-input.spec.ts test/voice/transport/livekit-output.spec.ts test/voice/transport/livekit-control.spec.ts test/voice/transport/livekit-media.spec.ts
```

Verify the fake publish options include reliable/topic/destination and no token appears in captured controls. Do not start a LiveKit server for this task.

- [ ] **5. Request serialized commit**, root:

```powershell
git add backend/src/voice/transport/livekit-media.ts backend/test/voice/transport/livekit-fixture.ts backend/test/voice/transport/livekit-media.spec.ts
git commit -m "feat(voice): attach admitted LiveKit media to the existing live flow"
```

### Task 6: Pause, disconnect, reconnect fencing and failure cleanup

**Files:** Modify `backend/src/voice/transport/livekit-media.ts`, `backend/test/voice/transport/livekit-media.spec.ts`; if the sink-throw regression fails, modify `backend/src/voice/session/live-flow.ts` and its existing spec.

- [ ] **1. Add these failing media lifecycle tests** using Task 5's fixture:

```typescript
it('distinguishes explicit end from disconnect and disposes local resources once', async () => {
  const f = await fixture(); await f.start();
  f.emitControl({ type: 'session.end' }, 1); await settle();
  expect(f.ended).toHaveBeenCalledExactlyOnceWith('completed');
  expect(f.disconnected).not.toHaveBeenCalled();
  await Promise.all([f.bridge.dispose(), f.bridge.dispose()]);
  expect(f.flow.close).toHaveBeenCalledTimes(1);
  expect(f.rtc.sources[0].close).toHaveBeenCalledTimes(1);
  expect(f.rtc.rooms[0].disconnect).toHaveBeenCalledTimes(1);
  const g = await fixture(); await g.start();
  g.rtc.rooms[0].emit('reconnecting');
  g.rtc.rooms[0].emit('disconnected'); await settle();
  expect(g.disconnected).toHaveBeenCalledExactlyOnceWith(true);
  expect(g.ended).not.toHaveBeenCalled();
  expect(g.signal().aborted).toBe(true);
  await g.bridge.dispose();
});

it('stops paid work on pause and never reopens after quota denial', async () => {
  const f = await fixture(); await f.start();
  f.bridge.pause('VOICE_QUOTA_EXHAUSTED', false); await settle();
  f.assertPaidWork.mockImplementation(() => { throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED'); });
  f.emitControl({ type: 'input.unmute' }, 1); await settle();
  expect(f.flow.close).toHaveBeenCalledTimes(1);
  expect(f.open).toHaveBeenCalledTimes(1);
  expect(f.events()).toContainEqual(expect.objectContaining({ type: 'session.error',
    code: 'VOICE_QUOTA_EXHAUSTED', recovery: 'none', terminal: false }));
  await f.bridge.dispose();
});

it('closes a late provider open, clears queued media and ignores callbacks from a retired epoch', async () => {
  const f = await fixture(); let resolve!: (flow: LiveKitFlow) => void;
  f.open.mockImplementationOnce(() => new Promise<LiveKitFlow>(done => { resolve = done; }));
  f.emitControl({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }, 0);
  await settle(); const disposing = f.bridge.dispose();
  resolve(f.flow); await disposing;
  f.emitControl({ type: 'input.unmute' }, 1); await settle();
  expect(f.flow.close).toHaveBeenCalledTimes(1);
  expect(f.flow.start).not.toHaveBeenCalled();
  expect(f.events().some(e => e.type === 'session.ready')).toBe(false);
  expect(f.rtc.sources[0].clearQueue).toHaveBeenCalled();
  expect(f.open).toHaveBeenCalledTimes(1);
});
```

Also write the table-driven `it.each(['connect', 'publishTrack', 'captureFrame', 'publishData', 'read'])` test: inject one rejection at the named fake operation; assert a sanitized existing error code, all acquired resources closed, no unhandled rejection, and no call on a sentinel `textRuntimeClose = vi.fn()`. Startup connect/publication errors reject `connect()` after local cleanup with **zero** lifecycle callbacks (P2's admission error path releases its admission); failures after a successful bridge return invoke the appropriate lifecycle callback **once** or enter paid pause as specified below. Construct a second independent bridge and verify it still starts after the first fails. Add fake-timer tests for connect/start expiry, no timers after disposal, recoverable pause/unmute opening **one** fresh LiveFlow after the old close resolves, and refusal to resume if old evidence drain rejects.

- [ ] **2. Run red**, directory `backend/`:

```powershell
npm test -- test/voice/transport/livekit-media.spec.ts
```

Expected: lifecycle methods/late-open behavior not yet implemented. If an assertion already passes because Task 5 handled it, retain it as regression evidence; do not break correct code to manufacture red.

- [ ] **3. Minimal lifecycle implementation:** add one latched disposal promise, one opening promise, one pausing promise, a local abort controller, and a one-shot terminal/error latch to the bridge. Keep paid pause separate from terminal transport disposal. Use the following control structure, with callbacks from the options interface above:

```typescript
pause(code: VoiceErrorCode, recoverable = ![
  'VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT', 'VOICE_DISABLED',
  'VOICE_SESSION_ENDED', 'VOICE_RECONNECT_TIMEOUT',
].includes(code)) {
  if (this.closed || this.paused) return;
  this.paused = true;
  clearTimeout(this.timer);
  this.input?.close();
  try { this.output.clear(); } catch { /* Still stop providers and reconcile. */ }
  this.controls.send({ type: 'session.error', code,
    recovery: recoverable ? 'resume_call' : 'none', recoverable, terminal: false });
  this.pausing = (async () => {
    const flow = this.flow ?? await this.starting?.catch(() => undefined);
    await flow?.close();
    if (this.flow === flow) this.flow = undefined;
  })().catch(() => { this.pauseDrainFailed = true; });
}
```

For a real media-output failure, clear the queue before beginning drain and prevent further `audio` publication while paused. Recoverable pause keeps only the room/control lane; reader media is discarded. On explicit `input.unmute`, await the old pausing promise, refuse if drain failed, recheck `context.assertPaidWork`, then open a fresh LiveFlow through the same injected callback and original reservation/configuration. Recreate only the input gate; output cursor must not reset while the epoch is unchanged. A new P2 connection epoch gets a **new bridge** after old disposal, never automatic SDK reconnection replay. Do not perform new admission/quota release inside P3.

Disposal fences synchronously before its first await:

```typescript
dispose(): Promise<void> {
  if (this.closing) return this.closing;
  this.closed = true; this.abort.abort(); clearTimeout(this.timer);
  this.input?.close();
  try { this.output.close(); } catch { /* Preserve provider cleanup. */ }
  this.controls.close();
  this.removeRoomHandlers();
  this.closing = (async () => {
    const cleanup = await Promise.allSettled([
      this.reader?.cancel(), this.source.close(), this.track.close(false), this.room.disconnect(),
    ]);
    await this.pausing;
    const flow = this.flow ?? await this.starting?.catch(() => undefined);
    await flow?.close();
    if (cleanup.some(result => result.status === 'rejected'))
      throw new VoiceSessionError('VOICE_DELIVERY_UNKNOWN');
  })();
  return this.closing;
}
```

Define `removeRoomHandlers` by unregistering the exact named handlers registered by this instance; do not remove another owner's listeners. Prevent calling the same flow.close twice when `pausing` already drained it (clear `starting` after assignment, retain a closed-flow reference or move close into one local helper). Preserve bounded operation deadlines: connect/start use the original finite budget; native disconnect/source close use `LIVEKIT_TEARDOWN_TIMEOUT_MS`, clear their timers in finally and attach rejection handlers even to late results. Durable `flow.close()` remains awaited; do not release P2's reservation before reconciliation or turn an evidence timeout into a success. Report cleanup uncertainty to P2/P5.

`fail` emits one sanitized terminal error if publishing is still usable, calls local disposal, then `options.disconnected(false)`; the SDK room reconnecting/disconnected/matching-browser-disconnected handlers use `true`. The lifecycle callback still runs when disposal rejects, carrying cleanup uncertainty into the session owner's error path; it must not be skipped by a rejected `.then`. Handle their promises with explicit catch, never leave EventEmitter async rejections unobserved. A room-transport `publishData` failure terminates the epoch rather than repeatedly attempting to publish an error on the failed lane. All `fail` callbacks passed to input/output/control catch internally and never throw back into their asynchronous drains. `finish` emits `session.ended` once and invokes `options.ended(reason)`; disposal remains the callback owner's responsibility. No global process/runtime/persistence shutdown.

**Protect shared cancellation if sink invalidation throws:** add this test to the existing live spec:

```typescript
it('a failed media invalidation cannot suppress runtime interruption or provider cleanup', async () => {
  const f = await fixture();
  await f.flow.speak({ ...ref, text: 'Answer.' });
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) }); await settle();
  vi.mocked(f.sink.invalidate).mockImplementation(() => { throw new Error('media failed'); });
  f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'new' }); await settle();
  expect(f.hooks.interrupt).toHaveBeenCalledWith(f.context, expect.objectContaining(ref));
  await f.flow.close();
  expect(f.stt.connection.close).toHaveBeenCalled();
  expect(f.tts.connection.close).toHaveBeenCalled();
});
```

Run it red, then guard the shared invalidation and immediate state notification in `LiveFlow.interrupt` without allowing either to skip the existing abort block:

```typescript
try { if (r.started) this.sink.invalidate(this.ref(r)); }
catch { /* Failed media must not prevent durable cancellation. */ }
this.agent = 'idle';
try { this.state(); }
catch { /* Cancellation below remains authoritative after transport loss. */ }
```

Keep the existing TTS interrupt/reset and `hooks.interrupt` logic after this block. Test the ordinary path's order explicitly with a `const order: string[]`: sink invalidation pushes `clear`, TTS interrupt pushes `tts`, hooks interrupt pushes `runtime`; require `clear` precedes both others. AgentVoiceAdapter already calls `runtime.cancelLiveTurn`; do not add a second call from the media bridge.

- [ ] **4. Run green**, directory `backend/`:

```powershell
npm test -- test/voice/transport/livekit-media.spec.ts test/voice/session/live.spec.ts
```

- [ ] **5. Request serialized commit**, root:

```powershell
git add backend/src/voice/transport/livekit-media.ts backend/src/voice/session/live-flow.ts backend/test/voice/transport/livekit-media.spec.ts backend/test/voice/session/live.spec.ts
git commit -m "fix(voice): fence LiveKit lifecycle and preserve cancellation on media faults"
```

### Task 7: Prove the real live pipeline, durable terminals and unchanged attribution

**Files:** Create `backend/test/voice/agent/livekit-pipeline-fixture.ts`, `backend/test/voice/agent/livekit-pipeline.spec.ts`; modify only P3-owned bridge consumer code if an assertion reveals a P3 defect. Do not modify AgentVoiceAdapter/VoiceDelivery/usage source merely to produce a transport-specific branch.

**Prerequisite:** resolve the P1/P4 queued/final sample announcement and large-control gates above. Read only their final exported interface summary, reconcile consumer calls here, and have the orchestrator record the handoff. If they remain unresolved, run the independent tests and report P3 completion **blocked**, not complete.

- [ ] **1. Create the pipeline fixture** using the actual in-memory runtime pattern from `backend/test/voice/agent/pipeline.spec.ts:39-125`. Do not edit that fixture or import its unexported function. Reuse `attempt`, `fakeStt`, `fakeTts`, the new RTC fixture and its directly built trusted SessionContext. Bind conversation by mutating that context's response/reservation exactly as the existing session owner does; this is a test callback, not another application admission path.

Provide these complete runtime behaviors in the fixture (same stable result IDs as the existing tests):

```typescript
const records = new Map<string, VoiceDeliveryRecord>();
let status: 'accepted' | 'completed' | 'cancelled' = 'accepted';
const runtime: VoiceBridgeRuntime = {
  submitLiveTurn: vi.fn(async c => ({ sessionId: c.sessionId, turnId: 't1', attemptId: 'a1',
    userMessageId: 'm1', streamPath: `/sessions/${c.sessionId}/turns/t1/stream` })),
  findLiveSubmission: vi.fn(async () => null),
  getLiveTurnStatus: vi.fn(async (_u, sessionId, turnId) => ({ sessionId, turnId,
    attemptId: 'a1', status, truncated: false, error: null })),
  getLiveDelivery: vi.fn(async () => records.get('a1') ?? null),
  cancelLiveTurn: vi.fn(async () => { status = 'cancelled'; }),
  reconcileSession: vi.fn(async () => {
    expect([...records.values()].some(r => r.status === 'pending')).toBe(false);
  }),
  executeTurn: vi.fn(async (command: ExecuteTurn) => {
    const live = command.live!;
    await live.start({ ...attempt(), userId: command.userId, sessionId: command.sessionId,
      turnId: command.turnId, attemptId: command.attemptId }, async (record, expected) => {
        if (expected !== undefined) expect(records.get('a1')?.sequence).toBe(expected);
        records.set('a1', structuredClone(record));
      });
    try {
      await live.delta('Hello world.'); await live.finish();
      await live.settle('Hello world.', command.signal);
      if (!command.signal.aborted) status = 'completed';
    } finally { if (command.signal.aborted) status = 'cancelled'; }
  }),
};
```

The fixture's injected `open` constructs exactly one `AgentVoiceAdapter(runtime, bindConversation)`, opens the real LiveFlow with fake providers and its hooks, then calls `agent.attach(context, flow, sink)`. Export its `begin()` that pushes duplicate identical EndOfTurn events and waits with the existing `settle`/bounded predicate loop until `currentResponse` and the pending delivery record exist. Export `control`, `events`, `source`, `records`, `context`, `runtime`, `stt`, `tts`, `close`, `usage` spy and `ref()`.

- [ ] **2. Write these acceptance tests** with the required header/imports:

```typescript
it('one EndOfTurn has one acceptance/inference owner and capture does not complete durable speech', async () => {
  vi.useFakeTimers(); const f = await pipeline();
  try {
    const ref = await f.begin();
    f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage });
    await settle();
    expect(f.source.captureFrame).toHaveBeenCalledTimes(1);
    expect(f.records.get('a1')?.status).toBe('pending');
    expect(f.runtime.submitLiveTurn).toHaveBeenCalledTimes(1);
    expect(f.runtime.executeTurn).toHaveBeenCalledTimes(1);
    await f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 });
    await until(() => f.records.get('a1')?.status === 'completed');
    expect(f.records.get('a1')).toMatchObject({ playedSamples: 2400,
      audioSamples: 2400, textGenerated: 'Hello world.', textSpoken: 'Hello world.' });
  } finally { await f.close(); vi.useRealTimers(); }
});

it('keeps disconnect unknown without inventing heard text and drains late provider usage', async () => {
  vi.useFakeTimers(); const f = await pipeline();
  try {
    const ref = await f.begin();
    f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) }); await settle();
    const closing = f.close();
    await vi.advanceTimersByTimeAsync(2000); await closing;
    expect(f.records.get('a1')).toMatchObject({ status: 'unknown', textSpoken: null });
    expect(f.runtime.cancelLiveTurn).not.toHaveBeenCalled(); // disconnect is not explicit barge-in.
    expect(f.runtime.reconcileSession).toHaveBeenCalled();
    expect(f.source.clearQueue).toHaveBeenCalled();
  } finally { await f.close(); vi.useRealTimers(); }
});
```

Define `usage` exactly as existing tests (`providerRequestId: null`, `model: 'fixture'`, `modelVersion: null`, `audioMs: 100`, `billableCharacters: 12`), `until` as at most 40 calls to `settle` followed by `expect(predicate()).toBe(true)`, and `afterEach(() => vi.useRealTimers())`. A test transport's P2 callbacks must invoke/await bridge.dispose but must not recursively re-enter their own disposal promise.

Add these narrowly scoped assertions with the same fixture:

- Explicit interruption after 1,200 played samples produces one `runtime.cancelLiveTurn` with `identity === context.identity` and original reservation, source clear before cancellation, one provider Interrupt at 50 ms, no late capture, and durable `interrupted` after a valid provider split (`'Hello'`/`' world.'`). A duplicate client event causes no second cancel.
- Late progress from a retired epoch is rejected; old response progress cannot credit the new response; same-epoch output origins include discarded samples and remain millisecond-aligned.
- Progress before provider `speech-completed` remains pending; completion before progress remains pending; malformed/regressing/over-sent progress is rejected. Block the terminal delivery write with one deferred Promise and assert neither inference completion nor final completion evidence is announced until it resolves.
- STT usage events after closure and TTS terminal usage are passed once to the original `usage(context, value)` callback; context identity/config snapshot/voice session ID are unchanged. Opus duration, room duration, silence dropped by the gate and `source.captureFrame` do not add usage. Use the real provider accounting suites below to verify provider tags and request IDs rather than synthesizing another ledger in this fixture.
- Quota denial before startup/resume opens zero new providers and accepts no turn. A microphone track replacement resets partial/pre-roll/queued PCM; no reconnect backlog is replayed. P2's new epoch may change a voice request idempotency key, but a duplicated event in the same epoch never creates another accepted turn.

For the resolved watermark contract, add the P1-valid event assertion at each actual queue acceptance and final-synthesis boundary, use the declared exact 24 kHz sample cursor, and test that the final watermark is available **before** the final progress ACK. Do not emit durable completion there. Assert large legal canvas artifacts survive the upstream-approved transport framing using P1's golden fixture. If either event cannot be represented by `parseVoiceControl`, stop and return it to P1; do not weaken guards.

- [ ] **3. Run red/green**, directory `backend/`:

```powershell
npm test -- test/voice/agent/livekit-pipeline.spec.ts
```

The new pipeline initially fails if any bridge handoff is missing; many existing delivery invariants should pass without source changes. Correct only the demonstrated P3 defect, preserving the single existing AgentVoiceAdapter/VoiceDelivery. Provider/contract/runtime defects go to their owners with this reproduction, not cross-owner edits.

- [ ] **4. Run attribution/delivery regressions**, directory `backend/`:

```powershell
npm test -- test/voice/agent/livekit-pipeline.spec.ts test/voice/agent/submission.spec.ts test/voice/agent/voice-delivery.spec.ts test/voice/providers/accounting.spec.ts test/voice/usage/attribution.spec.ts test/voice/usage/quota.spec.ts test/voice/usage/config-snapshots.spec.ts
```

Expected: one accepted input/inference; acceptance precedes execute; no fabricated spoken prefix; separate cancellation/disconnect evidence; original identity/provider tags, immutable prices, quotas and usage identities retained. This fake runtime test is **not** native database certification or OpenRouter billing proof.

- [ ] **5. Request serialized commit**, root (name additional corrected P3 files explicitly if applicable):

```powershell
git add backend/test/voice/agent/livekit-pipeline-fixture.ts backend/test/voice/agent/livekit-pipeline.spec.ts
git commit -m "test(voice): prove LiveKit durable delivery and attribution invariants"
```

---

## Final P3 verification and P5 handoff

- [ ] Run all focused checks from **`backend/`**, recording actual command/outcome/counts, including failed/blocked prerequisites:

```powershell
npm test -- test/voice/transport/livekit-input.spec.ts test/voice/transport/livekit-output.spec.ts test/voice/transport/livekit-control.spec.ts test/voice/transport/livekit-media.spec.ts test/voice/agent/livekit-pipeline.spec.ts
npm test -- test/voice/session/live.spec.ts test/voice/session/dictation.spec.ts test/voice/agent/submission.spec.ts test/voice/agent/voice-delivery.spec.ts test/voice/agent/pipeline.spec.ts
npm test -- test/voice/providers/flux-stt.spec.ts test/voice/providers/flux-tts.spec.ts test/voice/providers/nova-stt.spec.ts test/voice/providers/resilience.spec.ts test/voice/providers/accounting.spec.ts
npm test -- test/voice/usage/
npm run build
npm run lint
```

- [ ] Run the complete routine `npm test` in `backend/` after focused checks. Record pre-existing baseline failures from state.md separately, including P2's LiveKit-config fixture handoff. Do not alter P1 live gating or existing WebSocket tests owned by P5 to make P3 look green. If P5 has already cut over concurrently, obsolete live-WebSocket tests must be reconciled by their owner; do not remove dictation regressions.
- [ ] No provider access/network provisioning is needed. Native/e2e suites requiring MongoDB are not silently counted as passed; actual text/dictation assembly and native persistence evidence belong to P5/P8. Do not run paid benchmarks, create rooms on a real service or start/deploy infrastructure under this plan.
- [ ] Report exact P3 files/commits and tests, P1 watermark/large-packet resolution status, the exported callback signatures, source cursor semantics, and that `dispose` does not release a reservation or delete a room. Confirm provider adapters, contracts, manifests, dictation, text composition and P2/P5 files are unchanged.
- [ ] P5 must verify one composition owner, callbacks installed before admission response, room name/participant binding, old-epoch cleanup before replacement, active room revocation on terminal state, and warning/quota/drain forwarding. P4 must mute/reset stale browser playout immediately on local interrupt or `response.cancelled`; server `clearQueue` cannot recall audio already in SFU/browser buffers.
- [ ] P8 must verify actual browser playback, SDK/native behavior, interruption timing and network impairment. A fake capture success is not audible output; a progress ACK remains client-reported evidence, not independently attested hearing. Do not claim lower latency without matched measurements.
- [ ] Unified review remains **skipped by user instruction**, not passed. Do not dispatch a reviewer. P3 is ready for P5 only when its independent checks and blocking interface gates have actual passing evidence.

## Exit-gate self-check

- Exact frames/rates/order: Tasks 2/3/5; irregular subframes, explicit LE encoding and unaligned output copy.
- Superseded audio: Tasks 3/6/7; synchronous source clear, one capture in flight, generation guard, old epoch detached, browser flush handed to P4.
- One accepted turn/inference owner: Tasks 1/5/7; no gate-based inference, one start/open, existing EndOfTurn/idempotency/runtime path.
- Durable terminals: Task 7 plus existing delivery tests; no completion at publication/synthesis, final ACK plus synthesis plus durable write required.
- Finite buffering/work: Tasks 2/3/4/6; queue budgets, continuous SDK read, finite handshake/pause/cleanup, documented SDK-internal ceiling.
- Cancellation/disconnect/error distinctions: Tasks 6/7; explicit cancel reaches runtime once, disconnect aborts/reconciles, failure stops local paid resources without affecting text.
- Unchanged attribution: Task 7 and provider/usage suites; same trusted context/reservation/config/rates, no second ledger or provider implementation.
- No hidden gate: exact sample-watermark and legal-large-envelope compatibility must be resolved by P1/P4/P6, never inferred from source presence.
