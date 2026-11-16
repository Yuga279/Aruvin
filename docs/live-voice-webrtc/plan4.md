# Browser Live WebRTC Transport and Playback (P4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move browser live voice to one LiveKit Room carrying one microphone track, assistant media, and reliable Aurvin controls, without changing dictation or weakening delivery proof.

**Architecture:** Keep `LiveVoiceController`, its reducer, draft/lease bindings, Canvas handling, and existing live UI. Replace its PCM capture/playback/WebSocket composition with a thin live-only `LiveKitVoiceClient` and a live-only playback helper; leave `VoiceClient`, `AudioCaptureService`, and `AudioPlaybackService` serving existing dictation/legacy regression fixtures. Reuse admission HTTP, P1 parsing/envelopes, notices, lifecycle listeners, and finite admission limits.

**Tech Stack:** Existing React/TypeScript/Vitest (Node environment), `livekit-client@^2.23.0`, native browser media. No added dependency, application authentication system, infrastructure, or paid calls.

---

## Readiness: one mandatory upstream design gate

**This plan is written, not executed. P4 is not ready to claim its complete exit gate.** Before executing Tasks 5–8, the orchestrator must resolve the following with **P1 and P3**, then have this plan reconciled to their committed contract. Tasks 1–4 and 6's transport-only tests can be implemented independently, but do not wire an unproved playback implementation into the application.

The current frozen P1 wire contract has `audio.start { firstAudioSample? }` and `audio.end { lastAudioSequence }`. It does **not** provide the final generated sample count, intermediate generated-sample bounds, or a mapping from a response's sample range to a continuous remote track's playout clock. `lastAudioSequence` cannot supply a sample count: TTS chunks have variable lengths. P1's parser is exact-shape, so P4 cannot append private wire fields/events.

There are two related hazards:

1. A Room's remote track may emit silence while the response is idle. Starting `Date.now()`, `performance.now()`, an `AudioContext.currentTime` counter, or an element clock on receipt of `audio.start` would count idle/jitter-buffer time as spoken samples. `totalSamplesDuration`/packet receipt measures reception, not output; subscription and `playing` alone are also not proof.
2. Muting a continuous remote track on cancellation is immediate local silence, but simply unmuting it on the next reliable `audio.start` can release old RTP/jitter-buffer audio. Reliable SCTP control order does not fence the independent RTP stream.

**Required handoff, not a P4 wire redesign:** P1/P3 must agree and commit a supported, bounded means to identify media belonging to each response/generation, bound generated samples during streaming and at end, and establish a fresh playout boundary after invalidation. A response-scoped remote publication plus explicit sample bounds is one possible approach; it is **not selected or silently required by this plan**. If that changes the one-persistent-output-track research assumption, record the decision upstream. Keep one Room and one mic regardless.

P4 must then select and document a **real browser output observation** supported on the admitted browsers, including output-latency treatment, stalls, intentionally silent speech, concealment, and conversion to the 24 kHz application reference. A helper supplied with invented sample evidence by a unit test is not that implementation. Browser acoustic delivery is never guaranteed by software counters; P8 still measures actual audible behavior.

Also confirm the largest permitted Aurvin/Canvas control envelope fits the admitted LiveKit reliable packet limit. `MAX_VOICE_CONTROL_BYTES` is an application bound, not a promise that the SDK/SFU accepts a single packet that large. The SDK enforces negotiated message size. If a legal event does not fit, return the bounded framing/transport decision to P1/P3; do not silently truncate Canvas, accept partial JSON, or invent private P4 fragmentation.

If no supported observation can meet the requirement, report **blocked** to the orchestrator. Do not replace actual played-sample evidence with a timer, track receipt, a zero-progress deadlock, or a fabricated completion. Do not change `voice-protocol.ts`, manifests, P1's plan, or P3 files from P4.

## Inputs read and source facts

- Read `AGENTS.md`, `goal.md`, `research.md`, `state.md`, and P1's interface/lifecycle sections. P1 implementation is recorded complete in `state.md`; P4 worker still needs this plan committed.
- Current `live-voice-controller.ts` has independent media-generation and input-listening fences, paused-call/draft preservation, Canvas response fences, and 100 ms progress polling. Preserve those semantics, not its obsolete PCM mechanism.
- Current `useLiveVoice.ts` constructs `AudioCaptureService`, `AudioPlaybackService`, and `VoiceClient`. This is the live-only cutover point.
- Current `voice-capabilities.ts` is a public-config store, **not** a browser AudioWorklet/WebSocket capability detector. Research line references describing such detection are stale. Do not rewrite the shared store to fix an absent check.
- Current `DictationController` constructs the old capture and `VoiceClient` ports and must remain unchanged.
- `frontend/vitest.config.ts` discovers `src/**/*.test.ts` with `environment: 'node'`; no browser DOM, audio output, permission, or ICE behavior is established by a green Node suite.
- Read installed `livekit-client` declarations, in particular `Room.d.ts`, `RemoteAudioTrack.d.ts`, `LocalAudioTrack.d.ts`, `options.d.ts`, and `stats.d.ts`. `RemoteAudioTrack.getReceiverStats()` exposes reception/concealment statistics, not a played-sample cursor. Avoid its experimental/internal `setWebAudioPlugins` and `setAudioContext` APIs.
- Documentation lookup: Context7 `/livekit/client-sdk-js`, Room `startAudio`, `publishData`, remote-track attachment, 5 November 2026. `startAudio()` must be invoked from a user gesture; `publishData` is asynchronous. Installed declarations, not an unversioned example, settle exact signatures.

## Ownership and file map

Create only these integration-specific units:

- `frontend/src/api/livekit-voice-client.ts`: live Room, native mic, reliable control, ordering/binding fences, bounded reconnect, resource ownership. No PCM input API.
- `frontend/src/api/livekit-voice-client.test.ts`: deterministic SDK/admission/control/resource tests.
- `frontend/src/api/testing/livekit-fakes.ts`: focused SDK/media doubles and valid live session fixture, not a new testing framework.
- `frontend/src/features/voice/audio/live-track-playback.ts`: remote attachment, immediate local silence, response/generation isolation, proven played-sample cursor. The production proof source is gated above.
- `frontend/src/features/voice/audio/live-track-playback.test.ts`: deterministic playback/proof acceptance tests.

Modify only:

- `frontend/src/features/voice/state/live-voice-controller.ts`: port and media lifecycle adaptation; retain business/UI/Canvas behavior.
- `frontend/src/features/voice/state/live-voice-controller.test.ts`: migrate PCM-specific live assertions and retain behavior coverage.
- `frontend/src/features/voice/state/testing/live-voice-fixture.ts`: native-track/live-client fixture, preserving exports needed by other owners until coordinated migration.
- `frontend/src/features/voice/state/useLiveVoice.ts`: instantiate the live-only client; no media during render/effects.
- `frontend/src/features/voice/live/live-voice-composition.test.ts`: replace old live WebSocket composition with real live client plus SDK doubles; keep lease/Canvas coverage.
- `frontend/src/features/voice/live/live-voice-surface.test.ts`: source/composition guards only if its existing assertions name old capture classes.

No change to `frontend/src/api/voice-client.ts` is necessary: reusing `VoiceHttpClient` by import is smaller and safer than editing dictation's transport. No change to shared PCM helpers or the shared capability store is planned. Do not edit `frontend/src/features/voice/integration-tests/**`; report required fixture migration to P8. No package installation is required in P4.

Every new code/test file gets the mandatory repository header before its first import. Update the controller/hook/fixture headers when their responsibilities change. Use existing semicolon/import styles locally. Task code below shows the executable assertions and critical implementation bodies; retain existing unrelated code rather than replacing whole files.

## Interfaces consumed from P1

Import from `frontend/src/api/voice-protocol.ts`, never copy/redeclare:

- `CreateVoiceSessionRequest`, `CreateVoiceSessionResponse`, `PublicVoiceConfig`, `VoiceLiveKitTransport`, `VoiceResponseRef`, `VoiceClientPayload`, `VoiceServerEvent`.
- `isLiveKitVoiceSessionResponse`, `isCreateVoiceSessionResponse`, `parseVoiceControl`, `livekitAgentIdentity`, `LIVEKIT_CONTROL_TOPIC`, `MAX_VOICE_CONTROL_BYTES`, `INPUT_AUDIO`, `LIVE_WEBRTC_AUDIO`, `DEFAULT_VOICE_LIMITS`.
- Existing `session.start`, `session.ready`, `input.mute`, `input.unmute`, `input.suspend`, `response.interrupt`, `playback.progress`, `audio.start`, `audio.end`, `response.cancelled`, `conversation.bound`, Canvas, error/end envelopes.
- `playedSamples` uses the existing **absolute session output sample coordinate**, as in the old playback helper. `playedMs = floor(playedSamples / 24)`, and interruption uses `playbackPositionMs`, not `playedMs`. Do not reset this coordinate per turn; reset it only for a fresh admitted connection epoch.
- Admission limits: `connectMs`, `reconnectMs` (currently 10 seconds, not research's older 15-second name), and `inputQueueMs`/`outputQueueMs`. Adopt POST snapshot limits; later capability refresh must not reconfigure an active call.

`websocketUrl` still appears on P1's live response for transitional compatibility. Its presence does **not** authorize a live WebSocket fallback. A live response lacking a valid `livekit` descriptor is refused with a sanitized `VOICE_DISABLED` notice and best-effort HTTP end. Dictation uses `VoiceClient` exactly as before.

## Local P4 API and ownership

Export `LiveKitVoiceClientOptions` and the class from `frontend/src/api/livekit-voice-client.ts`. Reuse callback meanings from `VoiceClientOptions` by type selection, not by adding an `audio` PCM callback:

```typescript
export type LiveKitVoiceClientOptions = Pick<VoiceClientOptions,
  'event' | 'lost' | 'recovered' | 'error' | 'ended' | 'reauthorize' | 'id' | 'random'> & {
  room?: () => Room;
  microphone?: () => Promise<LocalAudioTrack>;
  element?: () => HTMLAudioElement;
  microphoneLost?: () => void;
  connectMs?: number;
};
```

The three injectable constructors are test seams for real SDK/native resources, not an alternate transport framework. Production defaults use `Room`, `createLocalAudioTrack`, and `document.createElement('audio')`.

Public methods (all defined by tasks below):

```typescript
prepare(): Promise<void>; // gesture: Room startAudio + one disabled native mic
connect(session: CreateVoiceSessionResponse): Promise<void>; // joins/publishes/start, not ready proof
control(payload: Exclude<VoiceClientPayload, { type: 'session.start' }>): boolean;
setInputEnabled(enabled: boolean): Promise<void>; // local source gate; false acts synchronously
stopInput(): void; // stops owned mic; Room/output remain for recoverable mic loss
unlock(): Promise<void>; // same Room startAudio; never reacquires mic
invalidate(responseId: string): void; // immediate local output silence
progress(): { playedSamples: number; playedMs: number };
isDrained(): boolean; // only verified end boundary consumed, never audio.end receipt alone
dispose(): Promise<void>; // shared close promise; repeated calls release once
```

`prepare()` after `stopInput()` reacquires one mic only on an explicit allowed gesture. Ordinary mute/unmute reuses the live mic and does not call `getUserMedia` again. `connect()` never captures its own second mic. One class owns Room/mic/listeners/retry timers; one playback helper owns its element/output observation. The controller owns HTTP end and its input lease. Do not make both SDK disconnect and application cleanup independently stop the same local track: stop it in P4, then `room.disconnect(false)`.

## Implementation workflow

Use `executing-plans` and TDD. No worker-created subagents are needed. Each red/green unit below is a small step; split multi-case tables into individual 2–5 minute red/green cycles. Commit only after orchestrator permission; commands below are **future worker commands**, not permission to contend for the shared index. No reviewer is dispatched; review remains skipped.

All `npm` commands below run with working directory `frontend/`. Commit commands run at repository root, one at a time, after explicit permission.

### Task 1: Establish real-SDK test seams and fail-closed live routing

**Files:** create `frontend/src/api/testing/livekit-fakes.ts`, `frontend/src/api/livekit-voice-client.ts`, `frontend/src/api/livekit-voice-client.test.ts`.

- [ ] **1. Add the focused fake module and first failing tests.** Put this body after its mandatory header. Import old wire fixtures read-only; do not change their legacy live default because dictation/transport tests still use it.

```typescript
import { vi } from 'vitest';
import type { LocalAudioTrack, Room } from 'livekit-client';
import { RoomEvent } from 'livekit-client';
import { session, control } from '../../features/voice/transport/testing/voice-fakes.ts';
import { livekitRoomName, livekitParticipantIdentity, LIVEKIT_CONTROL_TOPIC,
  type VoiceServerPayload } from '../voice-protocol.ts';

export function liveSession(epoch = 1) {
  return { ...session(epoch), livekit: {
    url: 'ws://127.0.0.1:7880', roomName: livekitRoomName('v1'),
    participantIdentity: livekitParticipantIdentity('aurvin-dev-user', 'v1', epoch),
    participantToken: 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJlMTIzNDU2',
  } };
}

export function rtcFixture() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const mediaTrack = Object.assign(new EventTarget(), { enabled: false, readyState: 'live' });
  const mic = { mediaStreamTrack: mediaTrack, mute: vi.fn(async () => mic),
    unmute: vi.fn(async () => mic), stop: vi.fn(() => { mediaTrack.readyState = 'ended'; }) };
  const audio = Object.assign(new EventTarget(), {
    muted: true, autoplay: false, currentTime: 0, paused: true, srcObject: null,
    play: vi.fn(async () => { audio.paused = false; }),
    pause: vi.fn(() => { audio.paused = true; }), remove: vi.fn(),
  });
  const participant = {
    publishTrack: vi.fn(async () => undefined), unpublishTrack: vi.fn(async () => undefined),
    publishData: vi.fn(async (_data: Uint8Array, _options: unknown) => undefined),
  };
  const room = {
    localParticipant: participant, canPlaybackAudio: true,
    connect: vi.fn(async (_url: string, _token: string, _options?: unknown) => undefined),
    disconnect: vi.fn(async (_stopTracks?: boolean) => undefined),
    startAudio: vi.fn(async () => undefined),
    on: vi.fn((name: string, fn: (...args: unknown[]) => void) => {
      const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); return room;
    }),
    off: vi.fn((name: string, fn: (...args: unknown[]) => void) => {
      listeners.get(name)?.delete(fn); return room;
    }),
  };
  const emit = (name: string, ...args: unknown[]) => {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(...args);
  };
  const microphone = vi.fn(async () => mic as unknown as LocalAudioTrack);
  const options = { room: () => room as unknown as Room, microphone,
    element: () => audio as unknown as HTMLAudioElement };
  const event = (payload: VoiceServerPayload, sequence: number, epoch = 1,
    identity = 'aurvin-agent:v1', topic = LIVEKIT_CONTROL_TOPIC) => {
    emit(RoomEvent.DataReceived, new TextEncoder().encode(control(payload, sequence, epoch)),
      { identity }, 0, topic);
  };
  const ready = (epoch = 1) => event({ type: 'session.ready', limits: liveSession(epoch).limits,
    effectiveAudioSettings: liveSession(epoch).effectiveAudioSettings }, 0, epoch);
  const packets = () => participant.publishData.mock.calls.map(([bytes]) =>
    JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>);
  return { room, mic, mediaTrack, audio, microphone, options, emit, event, ready, packets, listeners };
}
```

In the test file import `LiveKitVoiceClient`, `rtcFixture`, `liveSession`, `session`, and Vitest `afterEach, expect, it, vi`; use `afterEach(() => vi.useRealTimers())`.

```typescript
it('requires an admitted live descriptor and never falls back to PCM WebSocket', async () => {
  const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  await expect(client.connect(session())).rejects.toThrow('VOICE_DISABLED');
  await expect(client.connect(session(1, 'dictation'))).rejects.toThrow('VOICE_DISABLED');
  expect(f.room.connect).not.toHaveBeenCalled();
  expect(f.microphone).not.toHaveBeenCalled();
  expect('sendInput' in client).toBe(false);
  await client.dispose();
});

it('joins the admitted Room and sends only reliable bounded control to its agent', async () => {
  const f = rtcFixture(); const client = new LiveKitVoiceClient(f.options);
  await client.prepare(); await client.connect(liveSession());
  expect(f.room.connect).toHaveBeenCalledWith(liveSession().livekit.url,
    liveSession().livekit.participantToken, expect.objectContaining({ autoSubscribe: false }));
  expect(f.packets()[0]).toMatchObject({ type: 'session.start', mode: 'live',
    sessionId: 'v1', connectionEpoch: 1, sequence: 0 });
  expect(f.room.localParticipant.publishData).toHaveBeenCalledWith(expect.any(Uint8Array),
    { reliable: true, topic: 'aurvin.voice.control', destinationIdentities: ['aurvin-agent:v1'] });
  await client.dispose();
});
```

- [ ] **2. Red command:** `npm test -- src/api/livekit-voice-client.test.ts -t "requires an admitted"`. Expected FAIL: missing live client export/module, then descriptor rejection until implemented. Fixture-only syntax/type errors are setup errors, not accepted red evidence.
- [ ] **3. Implement the smallest class shell and join/start path.** Import the P1 guards. Validate mode/descriptor/expiry before joining. Build one Room lazily from gesture `prepare()`, with `publishDefaults: { stopMicTrackOnMute: false }`; configure a no-retry SDK reconnect policy (`nextRetryDelayInMs: () => null`) because Task 6 owns the application epoch rejoin. Call `connect` with `autoSubscribe: false`, subscribe only the admitted agent's audio publication, publish the prepared disabled mic with `source: Track.Source.Microphone`, then send `session.start`.

The admission check is:

```typescript
if (!isLiveKitVoiceSessionResponse(session)) throw new Error('VOICE_DISABLED');
if (Date.parse(session.expiresAt) <= Date.now()) throw new Error('VOICE_CONNECT_TIMEOUT');
```

Do not log the descriptor or underlying SDK exception. The `control` implementation is completed in Task 2, not a permanently stubbed sender.

- [ ] **4. Green:** run `npm test -- src/api/livekit-voice-client.test.ts` and `npm test -- src/features/voice/transport/voice-client.test.ts src/features/voice/dictation`. Expected: new tests plus unchanged old transport/dictation tests pass; no network traffic.
- [ ] **5. Commit:**

```powershell
git add frontend/src/api/livekit-voice-client.ts frontend/src/api/livekit-voice-client.test.ts frontend/src/api/testing/livekit-fakes.ts
git commit -m "feat(voice): add admitted LiveKit browser transport"
```

### Task 2: Preserve Aurvin control ordering and bound asynchronous sends

**Files:** modify the two `frontend/src/api/livekit-voice-client*` files; extend `frontend/src/api/testing/livekit-fakes.ts` only for a needed controlled promise.

- [ ] **1. Add these failing tests, one at a time.**

```typescript
it('ignores other participants/topics and old epochs but rejects current sequence gaps', async () => {
  const f = rtcFixture(); const event = vi.fn(), error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, event, error });
  await client.prepare(); await client.connect(liveSession());
  const state = { type: 'voice.state' as const, input: 'listening' as const,
    agent: 'idle' as const, connection: 'connected' as const };
  f.event(state, 99, 1, 'unrelated');
  f.event(state, 99, 1, 'aurvin-agent:v1', 'other.topic');
  f.event(state, 99, 0);
  expect(event).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  f.ready(); f.event(state, 1); f.event(state, 1);
  expect(event).toHaveBeenCalledTimes(2);
  f.event(state, 3);
  expect(error).toHaveBeenCalledExactlyOnceWith('VOICE_SEQUENCE_ERROR');
  await client.dispose();
});

it('fails a rejected async publish without advancing into a successful call', async () => {
  const f = rtcFixture(); const error = vi.fn();
  const client = new LiveKitVoiceClient({ ...f.options, error });
  await client.prepare(); await client.connect(liveSession()); f.ready();
  f.room.localParticipant.publishData.mockRejectedValueOnce(new Error('PRIVATE_JWT_OR_PROVIDER_TEXT'));
  expect(client.control({ type: 'input.mute' })).toBe(true);
  await Promise.resolve(); await Promise.resolve();
  expect(error).toHaveBeenCalledWith('VOICE_CONNECT_TIMEOUT');
  expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE');
  await client.dispose();
});
```

- [ ] **2. Red:** `npm test -- src/api/livekit-voice-client.test.ts -t "ignores other participants"`. Expected missing sender/sequence enforcement assertion fails.
- [ ] **3. Implement receive and serial send at the boundary.** Check topic and exact `livekitAgentIdentity(sessionId)` before decoding. Bound bytes by `MAX_VOICE_CONTROL_BYTES`, use fatal UTF-8 decoding, then `parseVoiceControl(json, 'server', 'live')`. Apply same-session/epoch checks, drop old epochs and duplicate sequences, reject future epochs or gaps, and require ready before ordinary events. Compare ready settings/limits to admission as `VoiceClient` already does; bind conversation once and reject a conflicting binding. Preserve nonterminal error/end events as controller-visible policy, not transport closure.

Use one small bounded send chain because `publishData` returns a promise. The boolean from `control()` means **accepted into the bounded local send path**, not remotely acknowledged. Reserve/validate envelope and sequence before enqueue; fail closed on overflow or rejection. Do not attach an async rejection to a synchronous `try/catch` and call that handled.

```typescript
const bytes = new TextEncoder().encode(JSON.stringify(event));
parseVoiceControl(new TextDecoder().decode(bytes), 'client', 'live');
if (bytes.length > MAX_VOICE_CONTROL_BYTES || this.pendingPackets >= 32) {
  this.fail('AUDIO_BUFFER_OVERFLOW'); return false;
}
const generation = this.generation;
this.pendingPackets++;
this.sending = this.sending.then(async () => {
  if (generation !== this.generation || this.closed) return;
  await room.localParticipant.publishData(bytes, { reliable: true,
    topic: LIVEKIT_CONTROL_TOPIC, destinationIdentities: [livekitAgentIdentity(session.sessionId)] });
}).catch(() => {
  if (generation === this.generation && !this.closed) this.fail('VOICE_CONNECT_TIMEOUT');
}).finally(() => { this.pendingPackets--; });
```

Define `sending = Promise.resolve()`, `pendingPackets = 0`, `generation = 0`, and `closed = false` fields in this class. Use a per-generation send-state object on rejoin so an old unresolved publish cannot block a new Room or decrement its counter. Add a `ponytail:` comment: at most 32 queued controls; overflow closes the transport rather than accumulating promises indefinitely. Individual sends and connection teardown are bounded by the session deadline. No per-frame persistence/config calls.

- [ ] **4. Add/green negative cases:** wrong session, future epoch, malformed UTF-8, oversize, pre-ready state, mismatched ready limits, conflicting conversation binding, duplicate ready, sequence overflow, queue full while publish is unresolved, and terminal callback exactly once. Run `npm test -- src/api/livekit-voice-client.test.ts`. Expected all assertions pass, rejected promises are observed, no timers survive disposal.
- [ ] **5. Commit:**

```powershell
git add frontend/src/api/livekit-voice-client.ts frontend/src/api/livekit-voice-client.test.ts
git commit -m "feat(voice): fence reliable LiveKit control generations"
```

### Task 3: Capture one microphone, preserve gesture unlock, and isolate mic failures

**Files:** modify `frontend/src/api/livekit-voice-client.ts`, its test, and `frontend/src/api/testing/livekit-fakes.ts`.

- [ ] **1. Add failing tests.**

```typescript
it('captures once in the gesture, publishes once, and reuses the mic on mute', async () => {
  const f = rtcFixture(); const client = new LiveKitVoiceClient(f.options);
  const preparing = client.prepare();
  expect(f.room.startAudio).toHaveBeenCalledTimes(1);
  expect(f.microphone).toHaveBeenCalledTimes(1);
  await preparing; await client.connect(liveSession()); f.ready();
  expect(f.room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
  expect(f.mediaTrack.enabled).toBe(false);
  await client.setInputEnabled(true);
  const muting = client.setInputEnabled(false);
  expect(f.mediaTrack.enabled).toBe(false);
  await muting; await client.setInputEnabled(true);
  expect(f.microphone).toHaveBeenCalledTimes(1);
  expect(f.room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
  await client.dispose();
});

it('maps denied access without leaking SDK text and stops a late permission result', async () => {
  const denied = rtcFixture();
  denied.microphone.mockRejectedValueOnce(new DOMException('PRIVATE_DEVICE', 'NotAllowedError'));
  const first = new LiveKitVoiceClient(denied.options);
  await expect(first.prepare()).rejects.toThrow('MICROPHONE_DENIED');
  await first.dispose();
  const f = rtcFixture(); let grant!: (track: Awaited<ReturnType<typeof f.microphone>>) => void;
  f.microphone.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
  const client = new LiveKitVoiceClient(f.options);
  const preparing = client.prepare(); await client.dispose();
  grant(f.mic as unknown as Awaited<ReturnType<typeof f.microphone>>);
  await expect(preparing).rejects.toThrow('CAPTURE_CANCELLED');
  expect(f.mic.stop).toHaveBeenCalledTimes(1);
  expect(f.room.localParticipant.publishTrack).not.toHaveBeenCalled();
});
```

- [ ] **2. Red:** `npm test -- src/api/livekit-voice-client.test.ts -t "captures once"`. Expected prepare/input lifecycle assertions fail.
- [ ] **3. Implement native capture only.** Default microphone constructor:

```typescript
() => createLocalAudioTrack({ channelCount: 1, echoCancellation: true,
  noiseSuppression: true, autoGainControl: true })
```

In `prepare()`, invoke `room.startAudio()` and the microphone promise **before the first await**. Deduplicate pending capture with one promise. Attach both error handlers immediately (or use `Promise.allSettled`) so one rejection does not orphan another promise. Disable `mediaStreamTrack.enabled` before publication. Bound capture wait by `options.connectMs ?? DEFAULT_VOICE_LIMITS.connectMs`; the controller supplies its initial/public limit, then uses the admitted snapshot on Resume. A permission prompt is not abortable, so invalidate its generation on timeout and stop any late track.

In `setInputEnabled(false)`, disable the native track synchronously before awaiting SDK mute; in enable, only unmute the current track after controller's same-generation listening acknowledgement. Mute is not a Room disconnect or output cancellation. Use public `publishDefaults.stopMicTrackOnMute: false`, not the SDK's internal `stopOnMute` field; no mic recreation during mute.

Listen to the owned native track's `ended` event only. On device loss, call `microphoneLost`, disable/retire the mic, and keep output/Room active. Remove that listener before intentional stop. Map `NotAllowedError`/`SecurityError` to `MICROPHONE_DENIED`, `NotFoundError`/`NotReadableError`/`OverconstrainedError` to `MICROPHONE_UNAVAILABLE`, and unknown errors to `UNSUPPORTED_AUDIO`; never surface device labels or exception messages. Map rejected audio unlock or `canPlaybackAudio === false` to `PLAYBACK_BLOCKED`.

- [ ] **4. Green:** `npm test -- src/api/livekit-voice-client.test.ts`. Add controlled promise cases for concurrent `prepare`, capture timeout plus late grant, autoplay rejection, ended event, mute during pending unmute, and recapture only after explicit prepare following stop. Verify one mic and no PCM source/worklet are ever constructed.
- [ ] **5. Commit:**

```powershell
git add frontend/src/api/livekit-voice-client.ts frontend/src/api/livekit-voice-client.test.ts frontend/src/api/testing/livekit-fakes.ts
git commit -m "feat(voice): own one native live microphone track"
```

### Task 4: Stop local output promptly and make all teardown idempotent

**Files:** create `frontend/src/features/voice/audio/live-track-playback.ts` and `.test.ts`; modify live client/test. Playback here establishes attachment/silence/resource safety, **not** completed delivery proof.

- [ ] **1. Add attachment and cleanup red tests.** The helper constructor accepts the element factory and owns at most one attached remote track. Its `attach(track)` method accepts a real `RemoteAudioTrack` and starts **muted**; enabling a response is gated by Task 5's real media boundary. Use a structural remote-track fake only inside this test:

```typescript
it('silences and detaches output synchronously before asynchronous transport cleanup', () => {
  const f = rtcFixture();
  const track = { attach: vi.fn(), detach: vi.fn(), setVolume: vi.fn() };
  const playback = new LiveTrackPlayback(f.options.element);
  playback.attach(track as unknown as RemoteAudioTrack);
  f.audio.muted = false;
  playback.interrupt();
  expect(f.audio.muted).toBe(true);
  expect(f.audio.pause).toHaveBeenCalledTimes(1);
  expect(track.detach).toHaveBeenCalledTimes(1);
  expect(f.audio.srcObject).toBeNull();
  playback.dispose(); playback.dispose();
  expect(track.detach).toHaveBeenCalledTimes(1);
});

it('releases Room and local tracks once without waiting for permission or network', async () => {
  const f = rtcFixture(); const client = new LiveKitVoiceClient(f.options);
  await client.prepare(); await client.connect(liveSession());
  const first = client.dispose(); const second = client.dispose();
  expect(f.mediaTrack.enabled).toBe(false);
  expect(f.mic.stop).toHaveBeenCalledTimes(1);
  await Promise.all([first, second]);
  expect(f.room.disconnect).toHaveBeenCalledExactlyOnceWith(false);
  expect([...f.listeners.values()].every(set => set.size === 0)).toBe(true);
});
```

Import `RemoteAudioTrack` as a type and `LiveTrackPlayback` in the playback test. Keep client cleanup test in the client test file.

- [ ] **2. Red:** `npm test -- src/features/voice/audio/live-track-playback.test.ts src/api/livekit-voice-client.test.ts -t "silences|releases Room"`. Expected missing helper/cleanup behavior.
- [ ] **3. Implement immediate silence as the first action.** Core release body:

```typescript
const element = this.element, track = this.track;
this.element = undefined; this.track = undefined;
if (element) {
  element.muted = true;
  element.pause();
  if (track) track.detach(element);
  element.srcObject = null;
  element.remove();
}
```

Define `element?: HTMLAudioElement` and `track?: RemoteAudioTrack` on the helper. Freeze progress **before** clearing proof state, and return that snapshot from interruption. Detach observation/event listeners too. Do not call `MediaStreamTrack.stop()` on an SDK-owned remote track and assume that recreates a fresh server generation. Reject old publication callbacks using the Room generation and future Task 5 response binding.

Client disposal increments its generation first, disables/stops mic immediately, interrupts playback, clears all connect/retry/deadline timers, aborts reauthorization, removes registered SDK listeners, and calls `room.disconnect(false)` exactly once. Store and return one `closing` promise. Bound SDK disconnect by the smaller remaining admission budget and 2 seconds; attach a rejection handler to the underlying operation even after the bound expires. No HTTP end in this class: the controller already owns it.

- [ ] **4. Green:** run the command above without `-t`. Add disposal while room connect is pending, late connect resolution, late `TrackSubscribed`, track replacement, late `play()` resolve/reject, repeated local/server cancellation, and rejected disconnect. Every late publication stays inaudible; every rejection is observed; zero timers/listeners after completion. Unknown/video/unrelated participant publications must not attach.
- [ ] **5. Commit:**

```powershell
git add frontend/src/features/voice/audio/live-track-playback.ts frontend/src/features/voice/audio/live-track-playback.test.ts frontend/src/api/livekit-voice-client.ts frontend/src/api/livekit-voice-client.test.ts
git commit -m "feat(voice): stop stale live media and release resources once"
```

### Task 5: Verify real playout proof and fresh response-media boundaries

**Files:** `frontend/src/features/voice/audio/live-track-playback.ts`, `.test.ts`, `frontend/src/api/livekit-voice-client.ts`, `.test.ts`. Any required new browser observer file must be live-only under `features/voice/audio/` and named in the reconciled plan before writing it.

**Entry gate:** upstream playback/media decision at the top is committed and this task is updated with its **exact exported contract names, production browser observation code, and corresponding event tests**. Do not execute a guessed implementation of this task. This explicit blocked entry is intentional: current P1 contract cannot express the required proof, and inventing it inside P4 would violate ownership and correctness.

- [ ] **1. Add a red regression forbidding synthetic progress.** This assertion is valid against the existing P1 contract and can be added before upstream resolution:

```typescript
it('does not infer samples from subscription, ready, start, end, or advancing wall time', async () => {
  vi.useFakeTimers(); const f = rtcFixture();
  const client = new LiveKitVoiceClient(f.options);
  await client.prepare(); await client.connect(liveSession()); f.ready();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 }, 1);
  await vi.advanceTimersByTimeAsync(1500);
  expect(client.progress().playedSamples).toBe(0);
  f.event({ type: 'audio.end', turnId: 't1', responseId: 'r1', lastAudioSequence: 0 }, 2);
  expect(client.isDrained()).toBe(false);
  await client.dispose();
});
```

- [ ] **2. Red:** `npm test -- src/api/livekit-voice-client.test.ts -t "does not infer samples"`. If it already passes, keep it as a guard; the required red is the first test feeding **genuine output-observation evidence** added after the entry gate is resolved, not an arbitrary timer change.
- [ ] **3. Implement only the agreed played-sample observation.** Required invariants, each covered by a focused red/green test in the reconciled task:
  - Subscription, received bytes, decoded-only counters, and track attachment leave played samples unchanged.
  - A controlled output-consumed observation of 960 samples at 48 kHz advances the 24 kHz reference by exactly 480; 44.1 kHz conversion retains fractional remainder across observations rather than rounding each quantum upward.
  - Include deliberate silent samples actually played within the response; exclude idle track silence, stopped output, output not yet played, and stale response/Room generations. Do not use a peak threshold as speech-delivery proof.
  - Absolute cursor is monotonic within one epoch, never exceeds proven generated bounds, and includes `firstAudioSample` without treating skipped/cancelled ranges as heard text.
  - `audio.end` is producer completion, not playout completion. `isDrained` becomes true only when the actual output cursor reaches the committed final bound.
  - A local interrupt first freezes the last real sample snapshot and removes audio output, then emits `response.interrupt` with that snapshot. Server cancellation removes audio immediately without echoing a second user interruption.
  - Old buffered media cannot become audible when response B starts after A was cancelled. Changing an application response ID while unmuting the same unflushed receiver is not a solution.
  - Media before its control/binding, control before media, late cancellation of A during B, two cancellations, and interruption before first audible sample all have explicit tests.

The production observer and mapping are not supplied here because none is established by P1/research. **Do not implement these bullets with an injected evidence function that production never drives.** Request plan reconciliation instead. Preserve the blocked status until real code and its deterministic browser-API fakes exist.

- [ ] **4. Green:** `npm test -- src/features/voice/audio/live-track-playback.test.ts src/api/livekit-voice-client.test.ts`. Also record the actual browser API/clock boundary for P8; a unit fake proves arithmetic/fencing only. If the real observer is unavailable in an admitted browser, show a usable unsupported/resume state, not fabricated durable completion.
- [ ] **5. Commit only after the entry gate closes and tests pass:**

```powershell
git add frontend/src/features/voice/audio/live-track-playback.ts frontend/src/features/voice/audio/live-track-playback.test.ts frontend/src/api/livekit-voice-client.ts frontend/src/api/livekit-voice-client.test.ts
git commit -m "feat(voice): report proven live playout sample progress"
```

Name any approved additional observer source/test files explicitly in that staging command. Never stage the entire audio directory.

### Task 6: Rejoin within one finite deadline and fence old Room generations

**Files:** modify `frontend/src/api/livekit-voice-client.ts`, `.test.ts`; add a second fake Room through a second `rtcFixture()`, not a second fake SDK framework.

- [ ] **1. Add the failing reconnect test.** Import `RoomEvent` and existing `settle()` (or await the controlled promises directly).

```typescript
it('reauthorizes a new epoch but never captures or replays during recovery', async () => {
  vi.useFakeTimers(); const a = rtcFixture(), b = rtcFixture();
  const reauthorize = vi.fn(async () => liveSession(2));
  const recovered = vi.fn(), lost = vi.fn();
  const rooms = [a.options.room(), b.options.room()];
  const client = new LiveKitVoiceClient({ ...a.options, room: () => rooms.shift()!,
    reauthorize, recovered, lost, random: () => 0.5 });
  await client.prepare(); await client.connect(liveSession()); a.ready();
  a.emit(RoomEvent.Disconnected);
  expect(a.mediaTrack.enabled).toBe(false);
  expect(a.mic.stop).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(250);
  expect(reauthorize).toHaveBeenCalledWith(expect.objectContaining({ connectionEpoch: 1 }), expect.any(AbortSignal));
  b.ready(2);
  expect(recovered).toHaveBeenCalledWith(expect.objectContaining({ connectionEpoch: 2 }));
  a.ready(); a.emit(RoomEvent.TrackSubscribed, {}, {}, { identity: 'aurvin-agent:v1' });
  expect(a.microphone).toHaveBeenCalledTimes(1);
  expect(b.room.localParticipant.publishTrack).not.toHaveBeenCalled();
  expect(client.progress().playedSamples).toBe(0);
  await client.dispose(); expect(vi.getTimerCount()).toBe(0);
});
```

Recovery connects and sends session.start while mic is absent/disabled; only explicit controller Resume reacquires/publishes. Callback `recovered(next)` must run **before** forwarding the new epoch's `session.ready`, allowing the controller to update its session fence. Do not require a microphone to rejoin control-only while paused.

- [ ] **2. Red:** `npm test -- src/api/livekit-voice-client.test.ts -t "reauthorizes a new epoch"`. Expected old callbacks/new-epoch capture assertions fail.
- [ ] **3. Implement one recovery state machine.** Reuse the existing `VoiceClient` retry algorithm by copying only the small live-only reconnect logic; do not extract a generic superclass or modify dictation. First loss immediately silences output and retires mic, invokes lost once, and sets one deadline `Date.now() + limits.reconnectMs`. Delays are `min(remaining, min(2000, 250 * 2 ** min(attempt, 4)) * (0.8 + 0.4 * random))`.

Reauthorize through the controller's existing `VoiceHttpClient.create(request, signal, previous)`, preserving idempotency key and bound conversation. Require same session/mode, a strictly newer epoch, same bound conversation, unexpired valid LiveKit descriptor. A new Room and fresh per-generation send state are created only after prior ownership has been retired. Abort reauth and stop late joins on exit/deadline. No SDK automatic reconnection plus separate application retry loop; no overlapping active Rooms. If an old SDK disconnect cannot be confirmed, require P2's new-epoch admission to confirm eviction before allowing a replacement to transmit; a timeout alone is not proof the old participant left. New ready cancels recovery deadline, calls recovered, then forwards ready. Never replay cached controls, PCM, responses, or progress.

- [ ] **4. Green:** `npm test -- src/api/livekit-voice-client.test.ts`. Add deadline despite hung HTTP/join, nonretryable admission error, stale/future/mismatched reauth, old connect resolution after a new generation, old publish rejection, disposal during reauth, no timer leaks, and reconnect timeout code `VOICE_RECONNECT_TIMEOUT`. Initial join timeout remains `VOICE_CONNECT_TIMEOUT`.
- [ ] **5. Commit:**

```powershell
git add frontend/src/api/livekit-voice-client.ts frontend/src/api/livekit-voice-client.test.ts
git commit -m "feat(voice): isolate bounded LiveKit reconnect epochs"
```

### Task 7: Adapt the existing live controller without changing live UX or dictation

**Files:** modify `frontend/src/features/voice/state/live-voice-controller.ts`, `.test.ts`, `testing/live-voice-fixture.ts`, `useLiveVoice.ts`.

**Entry:** Tasks 1–6 complete, including the Task 5 evidence gate. Do not ship an interim fake playback implementation to make controller tests green. Pass `connectMs: run.initialLimits.connectMs` alongside callbacks when creating the client; keep the admitted session limits for subsequent operations.

- [ ] **1. Migrate the fixture and add red routing/interrupt tests.** Keep `liveVoiceFixture`, `settle`, draft/lease/Canvas helpers and all behavior assertions. Replace the fixture's real PCM scheduler with one fake live client matching the public API above. Expose `captureCount`, `inputEnabled`, `silenced`, and a controllable **output-consumed sample** observation. Preserve `frame`/`audio`/`gate` compatibility helpers only where P8-owned callers currently import them; mark them legacy and tell P8 what to migrate. Do not have those helpers pretend a production WebRTC sample observation occurred.

New focused assertions after fixture migration:

```typescript
it('keeps one live client, waits for listening, and stops locally before interrupt control', async () => {
  const f = liveVoiceFixture();
  const starting = f.controller.start({ text: 'Unsent original', start: 7, end: 15,
    direction: 'backward' }, null, f.config);
  expect(f.client.prepare).toHaveBeenCalledTimes(1);
  await starting;
  expect(f.client.connect).toHaveBeenCalledWith(expect.objectContaining({ mode: 'live', livekit: expect.any(Object) }));
  f.event({ type: 'session.ready', limits: f.response.limits, effectiveAudioSettings: f.response.effectiveAudioSettings });
  await settle();
  expect(f.client.setInputEnabled).not.toHaveBeenCalledWith(true);
  f.listening(); await settle();
  expect(f.client.setInputEnabled).toHaveBeenCalledWith(true);
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 });
  f.client.progress.mockReturnValue({ playedSamples: 1200, playedMs: 50 });
  f.client.control.mockImplementation(payload => {
    if (payload.type === 'response.interrupt') expect(f.client.invalidate).toHaveBeenCalledWith('r1');
    return true;
  });
  f.controller.interrupt();
  expect(f.client.control).toHaveBeenCalledWith({ type: 'response.interrupt', turnId: 't1', responseId: 'r1',
    playbackPositionMs: 50, playedSamples: 1200 });
  f.controller.exit(); await settle();
  expect(f.http.end).toHaveBeenCalledTimes(1);
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1);
});
```

The updated fixture defines `client.prepare`, `connect`, `control`, `setInputEnabled`, `stopInput`, `unlock`, `invalidate`, `progress`, `isDrained`, and `dispose` as `vi.fn` methods; callbacks use `LiveKitVoiceClientOptions`. `response` comes from `liveSession()`. `begin()` emits ready then listening, exactly as the existing fixture does. Keep the exported fixture fully typed against `LiveVoicePorts` so missing methods fail the build.

- [ ] **2. Red:** `npm test -- src/features/voice/state/live-voice-controller.test.ts -t "keeps one live client"`. Expected old capture/client port behavior fails.
- [ ] **3. Make the minimum controller changes.** Replace `LiveVoicePorts.capture/playback/client` with one `client(options)` returning the public live-client method selection. Keep `http`/`bindings`. Construct the client during start/activate, not render. `prepare()` executes before the first awaited HTTP call, preserving gesture unlock and permission behavior. `connect()` gets only a valid live descriptor; missing descriptor pauses, stops resources and ends the accidental admission once, never opens a WebSocket.

Remove only live's PCM-specific frame/gate/queue plumbing: `sendInput`, `enqueue`, local `CaptureGate`, 16 kHz RMS scanning, and the PCM audio callback. Do not delete shared PCM files. Keep `inputGeneration`, waiting/listening acknowledgement timeout, policy blocks, draft restoration, stopped-source/late-grant fences, and Canvas response maps. Backend quiet-state events now set UI `input: 'suspended'/'listening'` when not manually muted or waiting for an explicit acknowledgement; they do not trigger a client VAD/control feedback loop. Change the quiet notice to `Call is quiet. Audio uploads are paused automatically.` rather than claiming local speech detection.

Use these controller orderings:

```typescript
// Local source must stop before transport work on mute, pause, loss, hide, or exit.
const stopping = run.client?.setInputEnabled(false);
const sent = run.client?.control({ type: 'input.mute' });
await stopping;
if (sent === false && run.ready) this.fail(run, 'VOICE_CONNECT_TIMEOUT');
```

```typescript
// Interruption snapshots actual output before invalidation freezes it.
const progress = run.client!.progress();
run.client!.invalidate(ref.responseId);
run.response = null;
if (notify && run.ready) run.client!.control({ type: 'response.interrupt', ...ref,
  playbackPositionMs: progress.playedMs, playedSamples: progress.playedSamples });
```

`poll()` retains the 100 ms interval, queries actual live progress only for its active response, sends `playback.progress`, and dispatches `DRAINED` only after client proof. Do not gate progress forever on the removed PCM callback's `responseHasAudio`; the playback helper's active/proven state replaces it. Interruption before audio or while thinking sends a valid response-ref cancellation when the existing control contract permits it, without inventing consumed samples.

Device loss mutes input and shows the existing useful notice while assistant output continues. Resume calls Room audio unlock synchronously from the gesture, then waits for prior mic cleanup before `prepare()` reacquisition; preserve user's manual-muted state and matching listening generation. Do not reacquire from a visibility event or on reconnect. If cleanup wait loses browser activation, keep `PLAYBACK_BLOCKED` and an actionable Resume, never silently resume.

Preserve `getVolume()` surface: until a native-track meter is demonstrably needed, return zero instead of adding a second microphone capture or VAD. Record this visible live-only simplification for P8; do not claim a measured mic amplitude. A supported SDK-native meter using the **same** mic track may be added only with a focused test and no audio-path delay.

Hook construction change:

```typescript
import { VoiceHttpClient } from '../../../api/voice-client.ts';
import { LiveKitVoiceClient } from '../../../api/livekit-voice-client.ts';
// Inside the existing lazy controller initializer, retain all binding delegates:
client: callbacks => new LiveKitVoiceClient(callbacks),
```

Remove the hook's old PCM imports/factories. Do not add `Room.connect`, `getUserMedia`, or `startAudio` to an effect. Add a live-only support check at activation (`isSecureContext`, `navigator.mediaDevices?.getUserMedia`, `RTCPeerConnection`, plus the agreed Task 5 observer requirements). Public live enablement plus support plus admission descriptor are all required. WebSocket/AudioWorklet are not required merely for native mic capture; any output-observer requirement must be justified in the resolved Task 5 design.

- [ ] **4. Green:** `npm test -- src/features/voice/state/live-voice-controller.test.ts src/features/voice/state/live-voice-reducer.test.ts src/features/voice/state/voice-capabilities.test.ts`. Retain coverage for UTF-16 drafts, navigation/unmount/pagehide, late admission cleanup, quota/duration blocks, nonterminal provider resume, muted resume, manual mute winning over stale listening, Canvas early/late/cancelled events, active config snapshot, device loss without stopping output, and end exactly once. Replace obsolete local detector assertions with server quiet-state events, not deletion of quiet-mode coverage.
- [ ] **5. Commit:**

```powershell
git add frontend/src/features/voice/state/live-voice-controller.ts frontend/src/features/voice/state/live-voice-controller.test.ts frontend/src/features/voice/state/testing/live-voice-fixture.ts frontend/src/features/voice/state/useLiveVoice.ts
git commit -m "feat(voice): route live controller through one WebRTC client"
```

### Task 8: Focused assembled regressions and downstream handoff

**Files:** modify `frontend/src/features/voice/live/live-voice-composition.test.ts`; change `live-voice-surface.test.ts` only if needed for live composition assertions. No P8 integration-test edits.

- [ ] **1. Add a failing composition guard and real-client fixture test.** Keep existing ChatProvider/draft/Canvas composition coverage, but inject the actual `LiveKitVoiceClient` with `rtcFixture` resources, not `VoiceClient` with `FakeSocket`.

```typescript
it('composes live without constructing the dictation PCM path', () => {
  const source = readFileSync(new URL('../state/useLiveVoice.ts', import.meta.url), 'utf8');
  expect(source).toContain('new LiveKitVoiceClient(');
  expect(source).not.toContain('new VoiceClient(');
  expect(source).not.toContain('new AudioCaptureService(');
  expect(source).not.toContain('new AudioPlaybackService(');
});
```

Import `readFileSync` from `node:fs`. This is an additional static guard, **not** the routing proof. The behavioral composition test starts the controller through real admission/client wiring, verifies one Room connect and one native publication, feeds ready/listening/Canvas controls through `DataReceived`, drives the Task 5 fake real-output observer, interrupts, and verifies output removed before reliable interrupt publication. Keep mute and Canvas continuity assertions; auto-opening/dismissing Canvas must not reconnect Room, recapture mic, or stop output.

- [ ] **2. Red:** `npm test -- src/features/voice/live/live-voice-composition.test.ts -t "composes live"`. Expected old hook composition fails if Task 7 has not landed; otherwise use the behavioral composition case as the required red before its fixture rewrite.
- [ ] **3. Implement only the focused test migration.** Replace WebSocket `output()` deliveries with the agreed media/boundary fake observations and reliable controls; retain all prior scenario intent. Add an independent old-client dictation assertion by running the existing dictation composition suites unchanged. Do not adjust `VoiceClient` or dictation to accommodate live tests.
- [ ] **4. Green and handoff:** run all final commands below; report counts and actual skips. If P8-owned tests import changed fixture ports and fail, provide their exact file names and API migration to P8, not cross-owner edits or a false green report. Build failure from those callers is still an assembled blocking result until P8 corrects them.
- [ ] **5. Commit:**

```powershell
git add frontend/src/features/voice/live/live-voice-composition.test.ts
git commit -m "test(voice): prove native live routing and dictation isolation"
```

Stage `live-voice-surface.test.ts` separately by its exact path only if it was changed.

## Final verification: exact commands, required outcomes, and limitations

Run these separately in `frontend/` with deterministic SDK/media fakes only:

```powershell
npm test -- src/api/livekit-voice-client.test.ts src/features/voice/audio/live-track-playback.test.ts
```

```powershell
npm test -- src/features/voice/state/live-voice-controller.test.ts src/features/voice/state/live-voice-reducer.test.ts src/features/voice/live
```

```powershell
npm test -- src/features/voice/transport src/features/voice/dictation src/features/voice/audio src/features/voice/state/voice-capabilities.test.ts src/api/voice-protocol.test.ts
```

```powershell
npm run build
```

```powershell
npm run lint
```

```powershell
npm test
```

Expected: focused tests discover nonzero cases and pass, build/typecheck and lint pass, unchanged dictation/transport/PCM suites pass, no provider/SFU connection, no credentials in output, no leaked timers/tracks/listeners. Full suite failures in another owner's integration fixtures are reported explicitly and remain blocking for assembled verification; do not change Vitest discovery, use `allowEmpty`, or remove failing tests. No backend application tests are necessary for this frontend-owned implementation; P5/P8 own assembled regressions.

Record source/commit identity through the orchestrator, Node/Windows/installed SDK versions, red/green commands and counts, build/lint outcomes, and limitations in the worker summary. Do not label planning as implementation or unit counters as device evidence. This planning-only delivery requires document/ownership/link consistency checks, not execution of the future tests above.

## Exit assertions and handoff to P5 / P8

**P5 consumes:** `LiveKitVoiceClient` exported API/options; unchanged `VoiceHttpClient` HTTP methods; the live-only hook/controller cutover; exact P1 start/ready/mute/progress/interrupt/end controls over `LIVEKIT_CONTROL_TOPIC`; one mic and one Room owner; no live `/api/voice` WebSocket connection or binary PCM input. P5 can reject legacy live upgrades without removing dictation's transport. P4 errors are sanitized local codes; P5 supplies valid live descriptors and server epoch behavior. P4 does not issue or persist room tokens.

**P3 consumes:** the mandatory media/proof-boundary request above; local mute is immediate while backend input gate remains authoritative; interruption reports the actual absolute sample prefix; old media cannot be re-enabled by a new control ID. P4 does not create a second client VAD or endpointing policy.

**P8 consumes:** focused SDK/media fixtures and all exposed controller fixture changes; the committed production output-observer boundary and its limitations; transport/format/epoch assumptions; commands/results; affected integration-test names; and the following **unrun browser-only checks**:

- Real HTTPS/loopback permissions, denied/revoked permissions, absent/busy mic, unplug/replug; one actual capture indicator/device stream, mute preserving assistant audio.
- Chrome/Edge/Firefox and any admitted Safari/iOS audio unlock, output devices, autoplay rejection, Resume after hidden/frozen tabs, and actual sound after a gesture. SDK/browser versions and devices must be recorded.
- Real remote-audio sample observation: output timestamp/latency calibration, stalls, silence, packet concealment, 44.1/48 kHz output, generated-bound mapping, and final durable completion. A fake observed sample count is not a browser result.
- Actual interruption-to-audible-stop timing, late buffered RTP after cancellation, rapid A→B response supersession, server barge-in and local interrupt. Muting a fake element does not prove a jitter buffer was flushed.
- Startup/ICE/TURN/rejoin, network drop, jitter/loss, deadline/epoch behavior, no overlapping old/new media, and explicit Resume without paid automatic turn replay. Network/media connects directly to LiveKit, not just the HTTP proxy.
- Existing text/dictation workflow and draft/Canvas continuity in an assembled browser. Legacy fixture compatibility does not establish real dictation behavior.
- Absolute/percentage benchmark comparisons only for matched boundaries and separate renewed authorization. No claim of latency improvement from this plan or from Node tests.

No LiveKit provisioning, paid provider calls, public deployment, or new authentication is authorized. No baseline output is overwritten. Review is **skipped**, not passed. P4 completes only when the production proof/media gate and every owned focused assertion are satisfied; P8's real-browser evidence remains separately required for full goal verification.
