# P4 Voice Assembly and Integrated Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this harness these skills are named `subagent-driven-development` and `executing-plans`; the assigned P4 worker executes its own tasks, without creating additional children unless the orchestrator authorizes capacity.

**Goal:** Verify and integrate the approved voice cost/flow changes across assembly, browser transport, media gating, playback and operations without weakening safety or claiming unperformed acoustic/billing acceptance.

**Architecture:** Reuse AppService's single runtime/session/usage composition and existing deterministic provider, socket, capture and playback fixtures. P4 adds boundary regressions and corrects integration fixtures; P1–P3 retain their source and direct tests. Non-P4 source defects are blocking owner handoffs, not permission for a general cleanup or unified review.

**Tech Stack:** Existing TypeScript/ESM, NestJS, React, Vite, Vitest, Web Audio and `ws`; pinned embedded WebRTC VAD from P2. No new dependencies, paid calls, real microphone, application database, infrastructure or deployment.

---

## Steps

- [x] Task 1: Establish the offline baseline and reconcile the dependency assembly fixture.
- [x] Task 2: Reproduce the initial listening handshake at the backend integration boundary; obtain P1 correction.
- [x] Task 3: Verify non-terminal control continuity and mounted-call policy through the real browser client; obtain the transport-owner correction.
- [x] Task 4: Connect speech gating, exact pre-roll and mute to the real wire client.
- [x] Task 5: Reconcile browser matrix fixtures and playback-origin integration expectations.
- [x] Task 6: Exercise AppService's assembled provider/policy/observation path and slow durable output.
- [x] Task 7: Write operational and separately gated device/provider evaluation procedures.
- [x] Task 8: Execute final verification and record the tested commits, results and limitations.

## Authority, prerequisites and file map

Read [goal.md](goal.md) and [state.md](state.md). Baseline for this plan is `dcb1a6a` on `codex/voice-cost-and-flow`; P1, P2 and P3 workers are committed. Review is **skipped**, never passed. This is execution planning, not a review request.

Only the following files are P4 write targets:

| File | Responsibility / action |
| --- | --- |
| `backend/src/app.service.ts` | Existing central dependency wiring only; change only if an assembly regression proves a missing/incorrect callback. Current `activity`, `observe`, `usage`, `stop`, `warn` and drain closures already exist; do not rewrite them for cosmetic reasons. |
| `backend/src/platform/voice-dependencies.spec.ts` | Cross-package dependency assembly contract, not a provider/session direct test. |
| `backend/test/voice/agent/pipeline.spec.ts` | Existing real bridge/flow/transport integration and durable evidence barriers. |
| `backend/test/assembly/voice-bootstrap.e2e-spec.ts` | Offline AppService/Nest/socket/provider assembly, including bounded test reads. |
| `backend/test/operations/bootstrap.spec.ts` | Existing network-disabled compiled startup regression; no change unless a repeatable fixture failure is diagnosed. |
| `frontend/src/features/voice/integration-tests/pipeline.test.ts` | Real VoiceClient/controller/playback integration; mandatory wire fields and lifecycle expectations. |
| `frontend/src/features/voice/integration-tests/cost-flow.test.ts` | New deterministic CaptureGate/controller/real-client boundary suite. |
| `frontend/src/features/voice/integration-tests/matrix-fixture.ts` | Fake worklet readiness protocol for the real capture service. |
| `frontend/src/features/voice/integration-tests/voice-matrix.test.ts` | Real capture/privacy/lifecycle/dictation/accessibility integration. |
| `frontend/src/features/voice/integration-tests/investigation.test.ts` | Exact playback-origin and cancellation regression clocks, if assertions need reconciliation. |
| `docs/voice-cost-and-flow/operations.md` | Feature-specific operations, privacy, accounting and rollback guidance. |
| `docs/voice-cost-and-flow/evaluation.md` | AC8 consent/cost gate and A/B measurement procedure. |
| `docs/voice-cost-and-flow/verification.md` | Actual commands, environments, evidence and acceptance mapping. |
| `docs/voice-cost-and-flow/final_report.md` | Final implemented/tested/unverified outcome and commit inventory. |

Do **not** edit `state.md` or other plans: report commits and gate status to the orchestrator. Tick only this plan's steps when implementing. Stage named files and serialize commits with the orchestrator. Existing code headers remain; new code files must use the full repository header style before imports. No new framework or fixture hierarchy.

### Required defect routes (not ownership transfers)

1. **P1:** `backend/src/voice/session/live-flow.ts` silently returns from initial `input.unmute` while already unmuted and emits no `voice.state input:listening`; P2 deliberately waits for that acknowledgement. Task 2 is P4's reproducer. P1 supplies the source/direct-test commit. Never bypass the acknowledgement in P2 or manufacture it in AppService.
2. **Transport owner via orchestrator:** `frontend/src/api/voice-client.ts:270–272` disposes/fails on every server end/error, ignoring `terminal:false`. Although an earlier state handoff mentions P4 for this file, the current assignment limits P4 source writes to `app.service.ts`; request an authorized transport-owner correction, not an implicit ownership expansion. Task 3 supplies exact regressions and the minimal required behavior. P4 may proceed on independent tasks while waiting, but cannot report completion without this correction.
3. **P2:** Direct controller/lifecycle tests remain P2-owned. Initial permission failure now retains `phase:'suspended'`, begin/unmute/resume requires listening ACK, real capture needs `gate-ready`. P2 also updates its own interrupt/drain assertions for P3's 100 ms origin (50 ms heard at context time 150 ms, and a 100 ms packet drains at 200 ms). P4 edits only its integration fixtures/assertions.
4. **P3:** Any genuine prose/evidence/scheduler defect stays with P3. Do not remove the reserve, generated-before-Speak barrier, one-Flush rule, filtering or output bounds to make integration tests green.

For every route send the orchestrator: failing command, test name, sanitized actual/expected behavior, owned source path, and required invariant. Wait for a committed fix; record its hash and rerun the unchanged P4 regression. This is implementation defect correction, not a review-triggered fixer dispatch. Do not commit red regressions as a completed task.

### Planner observations, not final verification

On 16 October 2026 at the stated baseline, these offline commands ran:

- Backend `npm test -- src/platform/voice-dependencies.spec.ts test/operations/bootstrap.spec.ts`: **1 failed, 9 passed**; only failure is the old React-only dependency expectation. All eight startup/bootstrap cases passed. Do not assume the earlier bootstrap failure still exists or change its timeouts speculatively.
- Backend `npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts`: **6 passed** using injected persistence/providers and loopback sockets, not a native MongoDB or service certification.

Rerun during implementation; these are not proof of the final commit set.

## Task 1: Offline baseline and approved dependency assembly

**Files:** Modify `backend/src/platform/voice-dependencies.spec.ts`; inspect both package manifests/lockfiles without changing them.

- [x] **Step 1: Establish isolation and reproduce the existing red assertion.**

Run from repository root:

```powershell
git status --short --branch
git rev-parse HEAD
node --version
npm --version
```

Run from `backend`:

```powershell
npm test -- src/platform/voice-dependencies.spec.ts test/operations/bootstrap.spec.ts
```

Expected at the baseline: dependency assertion fails because `@ozymandiasthegreat/vad: '2.0.7'` is present; bootstrap passes. Keep user configuration untouched. Do not print environment values, keys or URIs. Builds and bootstrap tests both write `dist`; never run these concurrently.

- [x] **Step 2: Replace only the stale frontend dependency assertion and strengthen lock alignment.**

Add alongside the existing lock reader:

```typescript
const frontendLock = JSON.parse(readFileSync(new URL('../../../frontend/package-lock.json', import.meta.url), 'utf8'));
```

Replace the exact React-only assertion with:

```typescript
expect(frontend.dependencies).toEqual({
  '@ozymandiasthegreat/vad': '2.0.7', react: '^19.2.8', 'react-dom': '^19.2.8',
});
expect(frontendLock.packages[''].dependencies['@ozymandiasthegreat/vad']).toBe('2.0.7');
expect(frontendLock.packages['node_modules/@ozymandiasthegreat/vad'].version).toBe('2.0.7');
```

Keep SDK/backend-package exclusions. This is an assembly-fixture correction to an explicitly approved dependency, not a new dependency request. If a manifest differs from the approved pin, route to P2 instead of relaxing this test.

- [x] **Step 3: Verify green and commit.**

Run the Step 1 backend command again; expect **10 passed** at the current suite size. No bootstrap implementation change is expected.

```powershell
git add backend/src/platform/voice-dependencies.spec.ts
git commit -m "test(voice): reconcile approved detector dependency assembly"
```

## Task 2: Initial listening acknowledgement across the actual backend pipeline

**File:** Modify `backend/test/voice/agent/pipeline.spec.ts`. P1 owns the source fix.

- [x] **Step 1: Add this failing test using the existing `pipeline` helper.**

```typescript
it('acknowledges initial listening without reopening providers or creating a turn', async () => {
  const f = await pipeline();
  try {
    await f.control({ type: 'input.unmute' });
    expect(f.socket.events()).toContainEqual(expect.objectContaining({
      type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected',
    }));
    expect(f.stt.port.connect).toHaveBeenCalledOnce();
    expect(f.tts.port.connect).toHaveBeenCalledOnce();
    expect(f.runtime.submitLiveTurn).not.toHaveBeenCalled();
    expect(f.runtime.executeTurn).not.toHaveBeenCalled();
    expect(f.records.size).toBe(0);
  } finally { await f.close(); }
});
```

- [x] **Step 2: Run red and route the implementation defect.**

From `backend`:

```powershell
npm test -- test/voice/agent/pipeline.spec.ts -t "acknowledges initial listening"
```

Expected at baseline: no matching listening event. Give P1 this reproducer and require an idempotent initial listening acknowledgement without a new STT/TTS connection, turn or conversation. P1 must preserve suspended-settlement ordering, manual-mute discard and paid-work checks. Do not change source outside P4 ownership or make the test fake the missing acknowledgement.

- [x] **Step 3: After P1's committed correction, run the whole integration file and commit only the P4 test.**

```powershell
npm test -- test/voice/agent/pipeline.spec.ts
```

Expected: all tests pass; repeated initial ACK must not invent work. Record P1's hash in verification evidence.

```powershell
git add backend/test/voice/agent/pipeline.spec.ts
git commit -m "test(voice): verify initial listening through real backend pipeline"
```

## Task 3: Non-terminal control continuity and honest mounted-call policy

**File:** Modify `frontend/src/features/voice/integration-tests/pipeline.test.ts`. Read but do not edit `frontend/src/api/voice-client.ts`.

- [x] **Step 1: Fix the pre-existing typed fixture and add explicit initial ACKs.**

The shutdown fixture must be:

```typescript
second.receive(control({ type: 'session.ended', reason: 'shutdown', terminal: true }, 2, 2));
```

In the burst test, immediately after initial `ready()` and `settle()`, send listening with sequence 1, await `settle()`, and start the later server sequence at 2:

```typescript
socket.receive(control({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' }, 1));
await settle();
```

For the reconnect test add the same initial ACK on `first`. Following `await f.controller.resume()` on epoch 2, send listening sequence 1 on `second`, await `settle()`, then call `f.frame()`. Shutdown is sequence 2 on epoch 2. Replace the old automatic-end expectation with:

```typescript
expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: false });
expect(f.http.create).toHaveBeenCalledTimes(2);
expect(f.http.end).not.toHaveBeenCalled();
f.controller.exit(); await settle();
expect(f.http.end).toHaveBeenCalledOnce();
```

- [x] **Step 2: Add these actual-client boundary regressions.**

Add the type import and `session` fixture import:

```typescript
import type { VoiceServerPayload } from '../../../api/voice-protocol.ts';
import { session } from '../transport/testing/voice-fakes.ts';
```

Append:

```typescript
it.each<VoiceServerPayload>([
  { type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'resume_call', recoverable: true, terminal: false },
  { type: 'session.ended', reason: 'duration', terminal: false },
])('retains the live control socket for non-terminal $type', payload => {
  const socket = new FakeSocket();
  const event = vi.fn(), error = vi.fn(), ended = vi.fn(), lost = vi.fn();
  const client = new VoiceClient({ socket: () => socket.asSocket(), pageUrl: 'http://localhost',
    event, error, ended, lost });
  try {
    client.connect(session()); socket.open(); socket.receive(ready());
    socket.receive(control(payload, 1));
    expect(event).toHaveBeenLastCalledWith(expect.objectContaining(payload));
    expect(socket.close).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled(); expect(ended).not.toHaveBeenCalled();
    expect(lost).not.toHaveBeenCalled();
    expect(client.control({ type: 'input.unmute' })).toBe(true);
    const last = socket.sent.filter((v): v is string => typeof v === 'string').at(-1)!;
    expect(JSON.parse(last)).toMatchObject({ type: 'input.unmute', sessionId: 'v1', connectionEpoch: 1 });
  } finally { client.dispose(); }
});

it('resumes a recoverable provider pause on the same call only after listening ACK', async () => {
  vi.useFakeTimers(); const socket = new FakeSocket();
  const f = liveVoiceFixture({ client: options => new VoiceClient({ ...options,
    socket: () => socket.asSocket(), pageUrl: 'http://localhost' }) });
  try {
    await f.controller.start({ text: 'Unsent original', start: 0, end: 0, direction: 'none' }, null, f.config);
    socket.open(); socket.receive(ready()); await settle();
    socket.receive(control({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' }, 1));
    socket.receive(control({ type: 'conversation.bound', conversationId: 'saved-chat' }, 2));
    socket.receive(control({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'resume_call',
      recoverable: true, terminal: false }, 3)); await settle();
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: true });
    expect(f.http.end).not.toHaveBeenCalled(); expect(socket.close).not.toHaveBeenCalled();
    await f.controller.resume(); f.frame();
    expect(socket.sent.filter(v => v instanceof Uint8Array)).toHaveLength(0);
    socket.receive(control({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' }, 4));
    await settle(); f.frame();
    expect(socket.sent.filter(v => v instanceof Uint8Array)).toHaveLength(1);
    expect(f.controller.getSnapshot().phase).toBe('active');
    expect(f.http.create).toHaveBeenCalledOnce();
    expect(f.bindings.bindVoiceConversation).toHaveBeenCalledWith('lease-1', 'saved-chat');
    expect(f.draft()).toBe('Unsent original');
  } finally { f.controller.exit(); await settle(); }
});

it.each<VoiceServerPayload>([
  { type: 'session.ended', reason: 'duration', terminal: false },
  { type: 'session.ended', reason: 'quota', terminal: false },
  { type: 'session.error', code: 'VOICE_RECONNECT_TIMEOUT', recovery: 'none', recoverable: false, terminal: true },
  { type: 'session.error', code: 'VOICE_DISABLED', recovery: 'none', recoverable: false, terminal: true },
])('keeps a blocked $type mounted and Resume cannot allocate around policy', async payload => {
  vi.useFakeTimers(); const socket = new FakeSocket();
  const f = liveVoiceFixture({ client: options => new VoiceClient({ ...options,
    socket: () => socket.asSocket(), pageUrl: 'http://localhost' }) });
  try {
    await f.controller.start({ text: 'Unsent original', start: 0, end: 0, direction: 'none' }, null, f.config);
    socket.open(); socket.receive(ready()); await settle();
    socket.receive(control({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' }, 1));
    socket.receive(control(payload, 2)); await settle();
    const mediaCount = socket.sent.filter(v => v instanceof Uint8Array).length;
    await vi.advanceTimersByTimeAsync(120000);
    await f.controller.resume(); f.frame();
    expect(socket.sent.filter(v => v instanceof Uint8Array)).toHaveLength(mediaCount);
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: false });
    expect(f.http.create).toHaveBeenCalledOnce(); expect(f.http.end).not.toHaveBeenCalled();
    expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled();
  } finally { f.controller.exit(); await settle(); }
  expect(f.http.end).toHaveBeenCalledOnce();
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledOnce();
});
```

- [x] **Step 3: Run red, obtain the source-owner correction, and rerun green.**

From `frontend`:

```powershell
npm test -- src/features/voice/integration-tests/pipeline.test.ts
```

Expected red: non-terminal close and recoverable pause becomes blocked because `fail()` invokes `error/lost`. Required owner change is to keep delivering the validated event, but call the terminal callbacks only for `event.terminal === true` (or dictation, preserving its existing termination). Keep malformed event, binding, epoch, sequence, overflow and true terminal paths fail-closed. Do not synthesize a reconnect, clear sequence counters, reset policy or send audio merely because the socket survives. The controller owns paid-media pause and the listening gate.

Have the transport owner run their direct `voice-client.test.ts`, plus dictation tests. P2 owns any controller-policy correction exposed by these regressions. P4 reruns the full integration file after committed corrections.

- [x] **Step 4: Commit the green P4 regressions.**

```powershell
git add frontend/src/features/voice/integration-tests/pipeline.test.ts
git commit -m "test(voice): enforce persistent calls across non-terminal wire events"
```

## Task 4: Five-second media gating and ordered same-call onset on the wire

**File:** Create `frontend/src/features/voice/integration-tests/cost-flow.test.ts` with the full repository file header. This test uses real `CaptureGate`, controller, protocol encoder and VoiceClient; detector decisions and browser capture are deterministic injected inputs. It is not a physical detector/acoustic evaluation.

- [x] **Step 1: Write this integration test below the mandatory header.**

```typescript
/**
 * ============================================================================
 * FILE: cost-flow.test.ts
 * LOCATION: frontend/src/features/voice/integration-tests/cost-flow.test.ts
 * ============================================================================
 * PURPOSE:
 *    Verify bounded quiet media and same-call onset through the real wire client.
 * ROLE IN PROJECT:
 *    Integrates the speech upload gate and controller with deterministic capture
 *    decisions, preserving listening acknowledgement and absolute mute privacy.
 * KEY COMPONENTS:
 *    - CaptureGate, LiveVoiceController and VoiceClient boundary regression.
 * ============================================================================
 */
import { afterEach, expect, it, vi } from 'vitest';
import { VoiceClient } from '../../../api/voice-client.ts';
import { decodeVoiceAudio } from '../../../api/voice-audio.ts';
import { CaptureGate } from '../audio/audio-capture-gate.ts';
import type { LiveVoicePorts } from '../state/live-voice-controller.ts';
import { liveVoiceFixture, settle } from '../state/testing/live-voice-fixture.ts';
import { FakeSocket, ready, control } from '../transport/testing/voice-fakes.ts';

afterEach(() => vi.useRealTimers());

it('stops quiet PCM by 5080ms and releases bounded ordered onset once on the same call', async () => {
  vi.useFakeTimers();
  const socket = new FakeSocket(), gate = new CaptureGate(1000);
  let capture!: Parameters<LiveVoicePorts['capture']>[0];
  let muted = true;
  const f = liveVoiceFixture({
    capture: options => {
      capture = options;
      return { start: async () => {}, stop: async () => { muted = true; gate.reset(false, 1000); },
        setMuted: async value => { muted = value; gate.reset(false, 1000); },
        setUploading: enabled => {
          for (const pcm of gate.setUploading(enabled)) options.frame(pcm, 0);
        } };
    },
    client: options => new VoiceClient({ ...options, socket: () => socket.asSocket(), pageUrl: 'http://localhost' }),
  });
  const media = () => socket.sent.filter((v): v is Uint8Array => v instanceof Uint8Array).map(decodeVoiceAudio);
  const feed = (id: number, decisions = [false, false, false, false]) => {
    if (muted) return undefined;
    const pcm = new Uint8Array(2560); new DataView(pcm.buffer).setUint16(0, id, true);
    const result = gate.push(pcm, decisions);
    if (result.signal) capture.speechGate?.(result.signal);
    for (const frame of result.frames) capture.frame(frame, 0);
    return result;
  };
  try {
    await f.controller.start({ text: 'Unsent original', start: 0, end: 0, direction: 'none' }, null, f.config);
    socket.open(); socket.receive(ready()); await settle();
    socket.receive(control({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' }, 1));
    await settle();
    let suspendedAt = 0;
    for (let n = 1; n <= 1600; n++) {
      const result = feed(n);
      if (result?.signal === 'suspended') suspendedAt = n * 80;
      await vi.advanceTimersByTimeAsync(80);
    }
    expect(suspendedAt).toBeGreaterThanOrEqual(5000);
    expect(suspendedAt).toBeLessThanOrEqual(5080);
    expect(media()).toHaveLength(62);
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', input: 'suspended' });
    expect(f.http.end).not.toHaveBeenCalled();
    const decision = feed(1601, [false, true, false, false]);
    expect(decision?.decisionOffsetMs).toBe(20);
    expect(gate.bufferedFrames).toBe(4);
    expect(media()).toHaveLength(62); // No onset upload before server acknowledgement.
    socket.receive(control({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' }, 2));
    await settle();
    const onset = media().slice(62);
    expect(onset.map(v => new DataView(v.pcm.buffer, v.pcm.byteOffset).getUint16(0, true)))
      .toEqual([1598, 1599, 1600, 1601]);
    expect(onset.map(v => v.sequence)).toEqual([62, 63, 64, 65]);
    expect(onset.map(v => v.offsetMs)).toEqual([4960, 5040, 5120, 5200]);
    expect(gate.bufferedFrames).toBe(0);
    const released = media().length;
    socket.receive(control({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' }, 3));
    expect(media()).toHaveLength(released);
    const events = socket.sent.filter((v): v is string => typeof v === 'string').map(v => JSON.parse(v));
    expect(events.filter(v => v.type === 'input.suspend')).toHaveLength(1);
    expect(events.filter(v => v.type === 'response.interrupt')).toHaveLength(0);
    expect(f.http.create).toHaveBeenCalledOnce(); expect(f.draft()).toBe('Unsent original');
    await f.controller.toggleMute(); feed(1602, [true, true, true, true]);
    expect(media()).toHaveLength(released);
    expect(gate.bufferedFrames).toBe(0);
  } finally { f.controller.exit(); await settle(); }
  expect(socket.close).toHaveBeenCalledOnce();
  expect(f.http.end).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
```

- [x] **Step 2: Run the test before repairing integration; preserve real contracts.**

From `frontend`:

```powershell
npm test -- src/features/voice/integration-tests/cost-flow.test.ts
```

This is a new regression over implemented P1/P2 code, so it may already pass. Do not intentionally break source to obtain red. If it fails, reproduce the boundary invariant and route any capture/controller defect to P2; only correct this new harness if its ACK/reset order differs from the actual service. Expected deterministic values: 5,040 ms suspension, 62 uploaded media frames, 128,000 ms quiet-input fixture (past the old 60+30-second expiry), 320 ms pre-roll, 20 ms within-frame decision offset, zero additional release latency after the synchronous listening ACK in this harness. These are fixture measurements, not model/network/device latency.

- [x] **Step 3: Verify alongside direct input and dictation suites, then commit.**

```powershell
npm test -- src/features/voice/integration-tests/cost-flow.test.ts src/features/voice/audio/audio-capture-gate.test.ts src/features/voice/audio/audio-capture-processor.test.ts src/features/voice/audio/audio-capture-service.test.ts src/features/voice/dictation
```

Expected: all discovered tests pass. Existing detector tests establish actual detector-fixture behavior; this injected-decision path proves no local trigger creates an agent interrupt. Do not claim arbitrary background speech is addressed to Aurvin or detector accuracy is certified.

```powershell
git add frontend/src/features/voice/integration-tests/cost-flow.test.ts
git commit -m "test(voice): integrate quiet media gate and exact same-call pre-roll"
```

## Task 5: Worklet readiness, privacy, lifecycle and playback-origin integration

**Files:** Modify `frontend/src/features/voice/integration-tests/matrix-fixture.ts`, `voice-matrix.test.ts` and `pipeline.test.ts`; inspect `investigation.test.ts`. Do not edit P2/P3 direct tests or the shared audio/state fakes.

- [x] **Step 1: Reproduce existing integration failures.**

From `frontend`:

```powershell
npm test -- src/features/voice/integration-tests
```

Baseline problems include the matrix's missing gate-ready, old permission-denial idle expectation, and an unmute assertion before listening ACK. In P2's direct test suite separately report stale 0.05/0.1 second playback clocks; P2 corrects those to 0.15/0.2 where the test intends 50/100 ms heard, keeping P3 source unchanged.

- [x] **Step 2: Teach only the matrix's fake worklet the actual readiness contract.**

Immediately after constructing the matrix's `node`, install:

```typescript
node.port.postMessage.mockImplementation(data => {
  if (data.type === 'initialize') queueMicrotask(() => node.port.emit({ type: 'gate-ready', revision: data.revision }));
  if (data.type === 'reset') node.port.emit({ type: 'reset', revision: data.revision });
  if (data.type === 'drain') node.port.emit({ type: 'frame', revision: data.revision, flags: 1, pcm: new ArrayBuffer(0) });
});
```

Do not emit real detector readiness from production or from a shared fake used by dictation. The matrix is modeling a successful detector; direct P2 tests retain failure/timeout coverage.

Change the denied-permission expectation to:

```typescript
expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: true, resumeRequired: true });
expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled();
```

For matrix unmute, replace the second toggle/next-frame sequence with:

```typescript
await f.controller.toggleMute();
f.frame(); expect(f.client.sendInput).toHaveBeenCalledOnce();
f.listening(); await settle();
f.frame(); expect(f.client.sendInput).toHaveBeenCalledTimes(2);
```

Keep the first mute assertions. `liveVoiceFixture.begin()` already emits initial listening after ready; do not override or edit that P2 fixture.

- [x] **Step 3: Add exact startup/contiguity/interruption assertions to the real-client pipeline.**

Append to `pipeline.test.ts`:

```typescript
it('uses one 100ms origin, contiguous packets and a zero-heard pre-start interruption', async () => {
  vi.useFakeTimers(); const socket = new FakeSocket();
  const f = liveVoiceFixture({ client: options => new VoiceClient({ ...options,
    socket: () => socket.asSocket(), pageUrl: 'http://localhost' }) });
  try {
    await f.controller.start({ text: 'Unsent original', start: 0, end: 0, direction: 'none' }, null, f.config);
    socket.open(); socket.receive(ready()); await settle();
    socket.receive(control({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' }, 1));
    socket.receive(control({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
      firstAudioSequence: 0, firstAudioSample: 0 }, 2));
    const pcm = (sequence: number) => socket.receive(Uint8Array.from(encodeVoiceAudio({
      kind: 2, flags: 0, sequence, offsetMs: sequence * 100, pcm: new Uint8Array(4800),
    })).buffer);
    pcm(0); f.context.currentTime = 0.06; pcm(1);
    expect(f.context.sources[0].start).toHaveBeenCalledWith(0.1);
    expect(f.context.sources[1].start).toHaveBeenCalledWith(0.2);
    expect(f.playback.observations()).toMatchObject({ startupReserveMs: 100, underruns: 0 });
    f.controller.interrupt();
    expect(f.context.sources.every(s => s.stop.mock.calls.length === 1)).toBe(true);
    const event = socket.sent.filter((v): v is string => typeof v === 'string')
      .map(v => JSON.parse(v)).find(v => v.type === 'response.interrupt');
    expect(event).toMatchObject({ playedSamples: 0, playbackPositionMs: 0 });
    pcm(2); expect(f.context.sources).toHaveLength(2); // Invalidated late audio is discarded.
    expect(f.playback.progress().consumedSamples).toBe(0);
  } finally { f.controller.exit(); await settle(); }
});
```

Keep the existing three-reply test's immediate idle assertion after `audio.end`: its preceding `currentTime += 3` already drains all packets including the reserve. The new test covers pre-start interruption explicitly. Preserve exact cumulative sample assertions; do not round PCM lengths or blindly add 100 ms at every packet/turn assertion.

- [x] **Step 4: Verify green and route only genuine defects.**

```powershell
npm test -- src/features/voice/integration-tests src/features/voice/dictation
npm test -- src/features/voice/live src/features/voice/state/live-voice-controller.test.ts
```

First command must pass; second includes P2's own corrected lifecycle/controller tests. Keep background/freeze on mounted suspended UI, visibility without automatic resume, pagehide/unmount teardown, Alt+X hang-up, Escape interrupt-only, exact unsent draft, and dictation selection/finalization checks. A test expectation cannot replace the required resource stop.

```powershell
git add frontend/src/features/voice/integration-tests/matrix-fixture.ts frontend/src/features/voice/integration-tests/voice-matrix.test.ts frontend/src/features/voice/integration-tests/pipeline.test.ts
git commit -m "test(voice): align integrated readiness privacy and playback clocks"
```

Only stage `investigation.test.ts` too if a necessary, explained integration-clock change was actually made.

## Task 6: Assembled policy/provider path and slow durable output

**Files:** Modify `backend/test/assembly/voice-bootstrap.e2e-spec.ts` and `backend/test/voice/agent/pipeline.spec.ts`. `backend/src/app.service.ts` remains unchanged unless these tests prove an actual wiring omission.

- [x] **Step 1: Bound the existing assembly socket reader and expose its real control sender.**

Replace `next` and the connection return value inside `connect` with:

```typescript
const next = async () => {
  const deadline = Date.now() + 2000;
  while (messages.length === 0 && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 5));
  const message = messages.shift();
  if (!message) throw new Error('Assembly voice event exceeded its two-second bound.');
  return message;
};
expect(JSON.parse((await next()).data.toString()).type).toBe('session.ready');
const nextEvent = async (type: string, expected: Record<string, unknown> = {}) => {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const message = await next();
    if (message.binary) throw new Error('Unexpected assembly audio event.');
    const event = JSON.parse(message.data.toString());
    if (event.type === type && Object.entries(expected).every(([key, value]) => event[key] === value)) return event;
  }
  throw new Error('Expected assembly control event was not received.');
};
return { socket, next, nextEvent, created, control };
```

This prevents a missing ACK from hanging the suite. Existing dictation remains unaffected; backend sends no unsolicited initial state in dictation.

- [x] **Step 2: Add this real assembly quiet/resume test.**

Import `encodeVoiceAudio` from `../../src/contracts/voice-audio.js`, then append:

```typescript
it('assembles acknowledged quiet/resume on one live call without empty turns or provider recreation', async () => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const activity = vi.spyOn(started.service.voiceUsage, 'noteActivity');
  const connection = await connect(started.base, 'live');
  const stt = recorded.opened.find(s => s.url.pathname === '/v2/listen')!;
  const binary = () => stt.sent.filter(v => v instanceof Uint8Array);
  connection.control({ type: 'input.unmute' });
  expect(await connection.nextEvent('voice.state')).toMatchObject({
    type: 'voice.state', input: 'listening', connection: 'connected',
  });
  const send = (sequence: number) => connection.socket.send(encodeVoiceAudio({ kind: 1, flags: 0,
    sequence, offsetMs: sequence * 80, pcm: new Uint8Array(2560) }));
  send(0); await until(() => { expect(binary()).toHaveLength(1); });
  connection.control({ type: 'input.suspend' });
  expect(await connection.nextEvent('voice.state', { input: 'suspended' })).toMatchObject({ type: 'voice.state', input: 'suspended' });
  await until(() => { expect(stt.sent).toContain(JSON.stringify({ type: 'ForceEndTurn' })); });
  send(1);
  connection.control({ type: 'input.unmute' });
  stt.serverText({ type: 'Warning', code: 'FORCE_END_TURN_NO_ACTIVE_TURN' });
  expect(await connection.nextEvent('voice.state', { input: 'listening' })).toMatchObject({ type: 'voice.state', input: 'listening' });
  expect(binary()).toHaveLength(1);
  send(2); await until(() => { expect(binary()).toHaveLength(2); });
  expect(recorded.opened).toHaveLength(2);
  expect(runtime.calls).toEqual({ submit: 0, execute: 0 });
  expect(activity).toHaveBeenCalledWith(connection.created.body.sessionId, false);
  expect(started.service.voiceUsage.snapshot()).toMatchObject({ sessions: 1, active: 1,
    estimatedSpendUsd: null, spendStatus: 'unknown' });
  expect(connection.socket.readyState).toBe(WebSocket.OPEN);
  connection.socket.close();
});
```

Run from `backend`:

```powershell
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
```

Before P1 correction expect the bounded initial-ACK test to fail; after correction expect the new test and all six existing assembly cases to pass. Do not insert provider responses into production or assume `ForceEndTurn` flushes TTS. A documented no-active-turn warning settles input without inventing a turn.

- [x] **Step 3: Add assembled hard-policy tests.**

Append to the same file:

```typescript
it.each(['duration', 'quota'] as const)('retains the control channel but blocks paid work after %s', async reason => {
  const recorded = recordingSockets(), runtime = runtimeStub();
  const started = await bootEnabled(recorded.factory, runtime); app = started.app;
  const connection = await connect(started.base, 'live');
  await started.service.voiceSessions.stop(connection.created.body.sessionId, reason);
  expect(await connection.nextEvent('session.error')).toMatchObject({ type: 'session.error', terminal: false,
    recoverable: false, code: reason === 'quota' ? 'VOICE_QUOTA_EXHAUSTED' : 'VOICE_DURATION_LIMIT' });
  expect(await connection.nextEvent('session.ended')).toMatchObject({ type: 'session.ended', reason, terminal: false });
  expect(connection.socket.readyState).toBe(WebSocket.OPEN);
  const count = recorded.opened.length;
  connection.control({ type: 'input.unmute' });
  connection.control({ type: 'session.end' });
  expect(await connection.nextEvent('session.ended')).toMatchObject({ type: 'session.ended', terminal: true });
  expect(recorded.opened).toHaveLength(count);
  expect(runtime.calls).toEqual({ submit: 0, execute: 0 });
  connection.socket.close();
});
```

Assert the control socket is still OPEN immediately after the non-terminal end (before sending `input.unmute`/`session.end`). `nextEvent` skips an initial listening state if P1 emits it during start. A blocked repeated unmute need not emit a duplicate error; the subsequent terminal end proves control processing has passed the attempted resume without allocating a provider. Keep bounded reads and assert both required terminal flags and no new socket. Never weaken to accepting any failure.

- [x] **Step 4: Add the slow-write/suspend/output integration case using the existing backend pipeline helper.**

Append to `backend/test/voice/agent/pipeline.spec.ts`:

```typescript
it('suspends input without cancelling output and keeps drain behind durable heard evidence', async () => {
  vi.useFakeTimers(); const f = await pipeline(); let release!: () => void;
  try {
    const ref = await f.begin(1);
    f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'quiet-output' });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) }); await settle();
    await f.control({ type: 'input.suspend' });
    f.input(); await settle();
    expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
    expect(f.runtime.cancelLiveTurn).not.toHaveBeenCalled();
    expect(f.tts.connection.interrupt).not.toHaveBeenCalled();
    expect(f.audioSamples()).toBe(2400);
    const pending = new Promise<void>(resolve => { release = resolve; }); f.block(() => pending);
    await f.control({ type: 'playback.progress', ...ref, playedSamples: 1200, playedMs: 50 });
    let closed = false;
    const drain = f.connection.dispose().then(() => { closed = true; });
    await vi.advanceTimersByTimeAsync(2000); expect(closed).toBe(false);
    f.block(); release(); await vi.advanceTimersByTimeAsync(2000); await drain;
    expect(f.records.get('a1')?.status).not.toBe('pending');
    expect(f.tts.connection.flush).toHaveBeenCalledOnce();
    expect(f.runtime.executeTurn).toHaveBeenCalledOnce();
  } finally { release?.(); await f.close(); }
});
```

Run from `backend`:

```powershell
npm test -- test/voice/agent/pipeline.spec.ts test/assembly/voice-context.spec.ts test/runtime/voice-output.spec.ts test/runtime/voice-history.spec.ts
npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts
```

Expected: all pass. P3's existing slow/split-token and slow-generated-write tests must also pass in final checks; this case adds their missing input-suspension/durable-drain composition, not replacement coverage.

- [x] **Step 5: Verify the existing wiring rather than adding a second owner.**

AppService currently passes `activity: (c,busy) => voiceUsage.noteActivity(c.response.sessionId,busy)` and `observe: (c,event) => voiceUsage.observe(c,event)` into LiveFlow; session options also forward `observe`, usage, admission and disconnection. Preserve these exact closures. If a regression proves one is absent in the execution checkout, restore that closure in `app.service.ts` only; otherwise make no source edit. Keep accounting failure preventing safe persistence close, diagnostic boot no-provider behavior, and a single runtime/session owner.

```powershell
git add backend/test/assembly/voice-bootstrap.e2e-spec.ts backend/test/voice/agent/pipeline.spec.ts
git commit -m "test(voice): verify assembled pause policy and durable output drain"
```

If and only if a proven central wiring correction was made, stage `backend/src/app.service.ts` by name and use `fix(voice): connect assembled voice policy observations` in a separate focused commit with its reproducer.

## Task 7: Operations and authorized A/B evaluation procedure

**Files:** Create `docs/voice-cost-and-flow/operations.md` and `docs/voice-cost-and-flow/evaluation.md`. Documentation does not need application TDD; check requirements and links before and after writing.

- [x] **Step 1: Confirm these documents are absent, then write operations.md with this content.**

```markdown
# Voice Cost and Flow Operations

## Authority and topology

This feature is authorized for offline verification only. No paid provider request,
real microphone, application-database access, provisioning or deployment is authorized.
Use the existing single-process executor and server-only credentials. Text readiness
and diagnostic liveness are not speech health or an acoustic certification.

## Input and call lifetime

The foreground call remains mounted during quiet, transport recovery and policy stops.
After 5,000 ms confirmed non-speech (one 80 ms frame tolerance), stop PCM upload; never
send replacement silent PCM. Up to 320 ms local pre-roll is bounded, transient and
released once only after the same session acknowledges listening. Local speech/noise
does not directly execute an agent turn or interrupt output; Flux turn events remain
authoritative. Quiet input suspension does not stop Aurvin's ongoing output.

Mute discards pending media and disables capture; auto-resume cannot undo it. Hidden
or frozen pages stop capture and clear transient audio while keeping the call screen.
Returning may require Resume voice. Permission loss and detector/WASM failure pause
visibly; there is no unlimited-streaming fallback. Hang up and Alt+X release resources;
pagehide, unmount and navigation also clean up. Escape interrupts, not hangs up.

## Safety and recovery

Recoverable provider pauses may Resume on the same session after listening ACK.
Duration/quota/configuration stops and exhausted reconnects leave the call blocked;
Resume cannot reset ceilings or allocate a replacement session to bypass policy.
Non-terminal error/end events preserve the control socket, not permission to upload.
True terminal wire events close transport but do not navigate out of the mounted call.
Do not automatically replay inference, accepted input or old response audio.

## Output and diagnostics

Safe prose release starts at 24 characters on whitespace with existing hidden-content
filters. Generated evidence remains durable before Speak; dirty evidence is bounded
at 100 ms or 512 characters and drained on finish/cancel/settle. There is one synthesis
response and one final Flush, not a Flush per sentence. Playback adds one 100 ms origin
reserve per response, not per packet/sentence. Late invalidated audio is discarded.

Distinguish model-first-output, safe-text release, evidence-write delay, Speak dispatch,
provider first audio, transport receipt and playback scheduling. Browser observations
report startupReserveMs, underruns and underrunMs. Existing server pipeline logs are
redacted stage/correlation data, not raw audio/text/keys. No new payload logging or raw
audio persistence is permitted. Fixtures identify application starvation/queue behavior;
they do not establish the acoustic cause of audible gaps in provider recordings.

## Accounting

Report observed STT upload ms/bytes separately from elapsed call duration, provider
socket duration, TTS characters/audio and LLM attempts/tokens. Unknown/in-flight usage
and provider charges stay unknown. An estimated spend is not an invoice. Process-local
quota counters are not restart-durable; cancellation cannot guarantee zero charges.

## Change and rollback

Keep model/voice/rates identical for comparisons. There is no new feature toggle or
storage migration. A deployment or rollback requires separate operator authorization,
a drained executor and the established persistence handoff procedure; never run old
and new executors together. Do not roll back only one wire-contract participant.
Consult the Phase 1 operations procedure and feature verification record before
claiming readiness.

- [Phase 1 operations](../aurvin-phase-1/operations.md)
- [Acceptance goal](goal.md)
- [Verification](verification.md)
- [Listening evaluation and consent gate](evaluation.md)
```

- [x] **Step 2: Write evaluation.md with this content.**

```markdown
# Voice A/B Listening and Usage Evaluation

Status: **not authorized, unrun; acoustic quality and real billing savings unverified**.
Offline fixture results are not AC8 acceptance. No microphone or provider call may be
started until the user separately consents to the device, data and bounded cost scope.

## Authorization gate

Record the consenting operator, date, approved device/browser/OS, baseline and changed
commits, server model/voice/config revisions, test identity/database, exact provider
accounts, maximum attempts/minutes/USD and data handling. Agree a hard stop, cancellation
owner and usage-inspection permission before any trial. Never use an application
database as a test substitute. Audio may be processed live only within this consent;
do not persist raw audio or enable message/audio payload logs.

## Controlled paired trials

Use identical model, voice, locale, rates, device gain and network conditions across
baseline and changed builds. Alternate A/B order. Include cold starts separately and
keep failed/cancelled trials in denominators. Stop if the consented attempt/time/cost
ceiling is reached; do not silently extend a trial to obtain a nicer percentile.

Include long silence beyond five seconds and beyond the prior 60+30-second expiry;
speech following quiet; yes/no, negations and identifiers; normal within-turn pauses;
quiet and accented speech with consenting speakers; laptop speakers and headphones;
background noise and output echo; an intentional Flux-confirmed barge-in; manual mute;
hidden/foreground transitions; detector failure; and separately bounded quota/provider
failure simulation. Background speech is not proof of address to Aurvin.

Compare initial noiseSuppression:false with the baseline configuration as a recorded
variable; keep echo cancellation enabled. Report quiet/short/accented misses and
false detections rather than assuming suppression off or an aggressive detector wins.

## Measurements

For each paired trial record scenario, success/failure/cancellation, detector onset,
decision and release delay, server listening ACK, upload frame count/bytes, elapsed
call and socket time, accepted turn/attempt identities, provider request/generation
identities, time from completed user turn to first audible playback, startup reserve,
underrun count/duration and perceived inter-sentence flow. Separate evidence-write,
LLM/safe-prose, provider and browser scheduling stalls; retain intentional provider
prosody/silence instead of trimming PCM or accelerating speech.

Report p50/p95 first audible response with sample counts and failure denominators;
pilot goals remain p50 <=1,500 ms and p95 <=2,500 ms, not fixture-established promises.
Separate cold and warm starts. Report false interruptions, missed/late short or quiet
speech, onset clipping and wake latency per device/speaker/headphone condition.

Compare observed upload savings as 1 - changed_uploaded_ms / baseline_uploaded_ms for
paired equal-duration traces with a nonzero baseline. Separately obtain actual provider
usage/billing within authorized scope, preserving request identity and unknown charges.
Do not infer invoice savings from zero-upload intervals or treat socket-open as free.

## Decision record

Until a consented run exists, result is UNRUN, not pass. A completed report must list
actual tested commits/configuration, authorized limits, attempts and failures, measured
latencies/usage, consent/data disposition, observed regressions and remaining limits.
Acoustic/billing acceptance cannot be promoted from synthetic tests or source inspection.

- [Goal and AC8](goal.md)
- [Operations](operations.md)
- [Offline verification](verification.md)
```

- [x] **Step 3: Check the docs against goal AC1–AC8 and commit.**

Check all linked files exist once Task 8 creates verification.md; no dependency on review.md. No unsupported native/Azure/production claims. Do not provision or execute the evaluation.

```powershell
git add docs/voice-cost-and-flow/operations.md docs/voice-cost-and-flow/evaluation.md
git commit -m "docs(voice): document quiet-call operations and gated listening evaluation"
```

## Task 8: Full verification and actual evidence report

**Files:** Create `docs/voice-cost-and-flow/verification.md` and `docs/voice-cost-and-flow/final_report.md`; update only this plan's checkboxes. The orchestrator owns state transitions.

- [x] **Step 1: Record environment, current commit set and credential-safe native prerequisites.**

From root:

```powershell
git status --short --branch
git rev-parse HEAD
git log --oneline 4569119..HEAD
node --version
npm --version
```

Only record whether native test variables are available, never their values. This task does not authorize native databases; force them absent for the following e2e invocation so operator environment cannot accidentally enable database tests. Never read `.env` to discover usable credentials. Preserve the user's checkout/environment files.

- [x] **Step 2: Run all required package checks, sequentially within backend.**

From `backend`, run as separate commands and preserve exit code, discovered/pass/fail/skip counts and duration:

```powershell
npm run build
npm run lint
npm test
```

Then in one PowerShell invocation (these assignments affect that tool process only):

```powershell
$env:AURVIN_TEST_MONGODB_URI = ''
$env:AURVIN_TEST_DB_PREFIX = ''
npm run test:e2e
```

Expected: offline suites pass; native suites skip their genuine absent prerequisites. Record every skipped suite/test separately and do not call this MongoDB certification. If any suite attempts real access despite absent prerequisites, stop it and route its fixture defect rather than supplying an application URI. Azure/behavior suites are not acceptance evidence merely because an empty discovery exits zero; report them not run/not certified, unless separately running demonstrably offline discovered tests is within authorization.

From `frontend`:

```powershell
npm run build
npm run lint
npm test
```

Expected: zero failures. In particular the TypeScript build must no longer report missing `terminal`, Vite must bundle the existing embedded VAD without an external model fetch, direct P2 controller tests must reflect the reserve and ACK protocol, and text/dictation/history suites remain green. No live app/browser/microphone invocation is needed for Node-based tests.

- [ ] **Step 3: Resolve failures through owners, then rerun impacted and complete checks.**

Do not label expected test failures as limitations. Keep an exact command and sanitized reproducer for each owner. Await their committed corrections, then repeat all commands of Step 2 on the final assembled source set. No unified reviewer or review-triggered fixer is dispatched. Genuine environment blocks must have the prerequisite, affected acceptance criterion and unperformed check recorded; they are not passes.

- [x] **Step 4: Write verification.md from actual output with these required sections.**

Use the title `# Voice Cost and Flow Verification`, followed by:

1. `## Tested commit set and environment`: baseline `4569119`, tested HEAD, P1/P2/P3/P4 and owner-correction hashes, Node/npm/Windows versions, test ports and mocked services. Record documentation-only report commits separately so a report commit is not misrepresented as a source-tested hash.
2. `## Commands and results`: actual per-command working directory, exit code, pass/fail/skip/discovery counts, time, warnings and reruns. Include planner observations only as historical baseline, not final evidence. No URI/credential/payload output.
3. `## Acceptance evidence`: one row for every AC1–AC8, concrete test path/name, actual observation and remaining limit. Map AC1/AC2 to cost-flow and capture tests; AC3 to real-client blocked/recoverable, assembled policy and lifecycle tests; AC4 to P2 detector fixtures plus no-local-interrupt assertions; AC5/AC6 to P3 slow/split-write/token/jitter/safe-filter tests plus P4 pipeline/reserve/drain; AC7 to package/e2e commands; AC8 **unrun, not authorized**.
4. `## Timing and usage interpretation`: real fixture values for 5,040 ms media suspension, zero later quiet PCM, bounded 320 ms pre-roll, synthetic decision/release delay, 100 ms one-time reserve, underrun scenarios and exact consumed/played samples. Include only values actually asserted/passed. Separate observed upload from provider charges and call/socket time.
5. `## Skipped, blocked and unverified`: each native/service check's actual prerequisites; no native replica-set/Azure certification; no consented devices/providers, acoustic diagnosis or real billing savings. Process-local quota ceiling and unknown in-flight spend remain explicit.
6. `## Review`: **Skipped by user instruction; not passed.**

Do not add an empty-results acceptance label, a generic `all tests passed` without counts, or an invented listening metric. If a required offline test remains red, report the workflow blocked and the owner handoff instead of completed.

- [x] **Step 5: Write final_report.md with actual outcome and evidence links.**

Use title `# Voice Cost and Flow Final Report`, then `## Outcome`, `## Implementation and commits`, `## Verification`, `## Limitations and authorization`, and `## Artifacts`. State exactly what is implemented and verified offline; keep acoustic/billing acceptance unverified. Include actual check totals, owner-correction commits, skipped review and native/live status. Link goal, state, plan1–plan4, operations, evaluation and verification with relative links. Do not create review.md or imply skipped review passed.

- [x] **Step 6: Check docs, commit named files, and return evidence to the orchestrator.**

From root:

```powershell
git diff --check
git add docs/voice-cost-and-flow/verification.md docs/voice-cost-and-flow/final_report.md docs/voice-cost-and-flow/plan4.md
git commit -m "docs(voice): record integrated verification and unverified live acceptance"
git status --short --branch
```

Return actual source/test/report commit hashes, command outcomes, native skips and AC8 unrun status. The orchestrator updates state.md and decides the offline completion gate. No other plan may be edited.

## Final plan self-check

- All AC1–AC8 have owners and concrete integrated evidence or an explicit authorization gate.
- Initial listening ACK, non-terminal client continuity, mandatory terminal fields, matrix gate-ready and suspended policy, P3 playback-origin clocks, dependency fixture and actual bootstrap rerun are covered.
- Source ownership is not broadened; AppService's existing wiring is reused without a fabricated refactor.
- No new paid/service/microphone action, raw-audio persistence, dependency, reset budget, per-sentence Flush, or removed durability/filter safeguard.
- Review remains skipped; meaningful tests and final verification remain mandatory.
