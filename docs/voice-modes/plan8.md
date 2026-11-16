# Live Voice Surface and Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this harness load `executing-plans`, `test-driven-development`, and `frontend-design`; the assigned worker does not dispatch further agents without orchestrator authorization.

**Goal:** Add a transcript-free live voice surface with independent operational dimensions, accessible controls, preserved text drafts, immediate local interruption, and safe foreground/recovery lifecycle behavior.

**Architecture:** Reuse P4's capture, playback, and validated native WebSocket client and P7's synchronous voice-input lease. A small reducer and controller own operational state and resources; `useLiveVoice` binds them to React without opening a microphone in an effect. `ChatView` accepts the resulting surface model, unmounts conversation/composer content during live voice, and retains existing sidebar/navigation behavior; P10 wires the existing composer entry callback.

**Tech Stack:** Existing React 19, TypeScript 6, Vite 8, Node-environment Vitest 4, `react-dom/server`, browser-native audio and events, existing P4 fakes; zero new packages or test configuration.

---

## Execution gates, scope, and handoffs

- Scope sources: [goal.md](goal.md), authoritative integration decisions, live journey/controls, V4/V10/V11, A7/A9/A12/A13/A14/A17/A18; [research.md](research.md), frontend responsibilities; [state.md](state.md), P8 ownership/dependencies. Read P6/P7 handoffs and **actual prerequisite implementations** when dispatched. Research's illustrative events are not the current wire schema.
- P4 is complete (`ac707b7..2e2e9e4`); P5 is complete (`479a758..d20b7ea`). At planning time P6/P7 workers are running; their plans are `566225e` and `cd3232e`. **P8 implementation waits for verified P6/P7 worker completion, upstream seam reconciliation, and clearance of shared CSS user changes.** Plan commits alone do not satisfy these gates.
- This planning turn writes/stages only `docs/voice-modes/plan8.md`. Do not update orchestrator-owned `state.md`, change application source, adopt sidebar/pinning/logo/session-action work, or stage another worker's changes.
- P8 does not implement providers, HTTP/WebSocket parsing, resampling, playback scheduling, backend quotas, persistence/serialization, authentication, tools/confirmations, captions, a model picker, or a second runtime. It consumes only operational events/audio. Existing hidden-message filtering remains a P2/P6 boundary, not a CSS trick.
- P1 owns package/protocol changes; P4 owns audio/client fixes; P7 owns draft/actions/composer/entry controls; P10 owns `App.tsx`/application mounting. Request serialized owner follow-ups rather than editing these paths here. Retain existing headers; eventual new code/test/CSS files require repository headers. This Markdown document and its code listings intentionally contain no code documentation headers.
- Review is **skipped**, not passed. TDD, checks, defects, and final verification remain required. This document is a plan, not passing implementation or browser/device/provider evidence.
- Every npm command below runs in `frontend`; every git command runs at repository root, individually, after the orchestrator grants the shared-index commit slot. Stage exact named paths only. Existing dependencies and the Node Vitest environment are sufficient for deterministic controller/SSR/handler checks, not real Tab traversal or microphone certification.
- React's current [external-store reference](https://react.dev/reference/react/useSyncExternalStore) was checked through Context7: stable subscriptions, cached immutable snapshots, and cleanup are required. Keep permission/playback initialization in activation handlers, not render/effects; StrictMode cleanup must not permanently disable a controller before a later user gesture.

### Required P7 binding seam (serialized owner follow-up before Task 4)

P7 already supplies `claimVoiceInput(mode, onClose)`, `writeVoiceDraft(token, text)`, `releaseVoiceInput(token)`, and `isVoiceInputLocked()`, plus optional `ChatProvider.startVoiceConversation`. P8 needs one additional narrow action:

```typescript
bindVoiceConversation(token: string, conversationId: string): boolean;
```

Its owner contract: accept only the current **live** token; bind an unsaved New Chat to the server's accepted `conversation.bound` ID; retain the same token and unchanged draft/messages; use the neutral title `Voice Conversation`; allow a repeat of the same ID, reject a different already-bound ID or stale token. It must not dispatch ordinary `SELECT_SESSION`, call `selectSession`, submit text, or invoke the navigation cleanup callback. P7 must leave a reducer/action regression test for this action and preserve pinned/session-action work. Ordinary New Chat/session selection/active deletion still invokes `onClose` synchronously **before** navigation.

Why this is a prerequisite: ordinary selection terminates the lease. Keeping a bound ID only inside the voice controller leaves text follow-ups on the wrong conversation and lets deletion of the actual live conversation bypass active-session cleanup. Do not quietly replace this action with navigation. The plan defines its consumer type below, not P7-owned implementation code.

### P10 assembly contract (no `App.tsx` edits by P8)

1. Inside the existing `ChatProvider`, call `useLiveVoice({ conversationId: state.activeSessionId, draft: state.draftInput, bindings: actions })` exactly once and pass its result as `<ChatView liveVoice={voice} />`.
2. Supply `voice.start` to the existing `ChatProvider.startVoiceConversation` entry seam using a committed-effect registration/ref bridge in P10's composition. An outer stable callback may call that ref; register/unregister the inner hook's start callback in a layout effect. Never open a microphone from that registration. Do not mount a second ChatProvider or voice controller. Until assembly exists, an unregistered live entry stays disabled as P7 specifies.
3. P8's hook and controls recheck default-off server config and the lease. Composer's local enabled control is not backend admission or authentication.
4. After a bound conversation ends, reload existing session navigation metadata through `bindings.refreshSessions`; no client-side transcript/title inference or voice message insertion. This refresh callback is `() => { void actions.loadSessions(); }` in P10. Binding itself remains the token-fenced P7 action above.

### Fixed lifecycle decisions

- State dimensions: input `listening | muted`, agent `idle | thinking | speaking`, connection `connecting | connected | reconnecting`; lifecycle `idle | requesting_permission | connecting | active | suspended | ending`. Listening and speaking coexist. No tools/confirmation dimensions.
- Opening live voice locks the existing draft synchronously, snapshots its UTF-16 selection, and never sends that draft to the agent. New Chat request uses `conversationId: null`; only the server's accepted first voice turn binds it.
- Capture starts muted; transmission stays gated until `session.ready` **and** worklet unmute acknowledgment. Mute gates frames synchronously and calls source `setMuted(true)`, discarding partial buffers; playback continues. Unmute sends its control first and waits for the source reset acknowledgment before allowing fresh samples. Rapid toggles are serialized with a busy flag.
- Manual Stop speaking uses the active `audio.start` turn/response IDs; clear playback and invalidate locally before network work, include actual socket-wide played samples/milliseconds, and remain in live voice. Do not fabricate response IDs. With the current P1 protocol no response reference exists during pre-audio thinking, so this control is disabled until a response is identifiable; backend speech-start interruption remains P5/P6-owned. Do not claim pre-audio generation cancellation or guaranteed billing prevention.
- `audio.end` closes synthesis/transport, not the browser queue. Poll actual playback progress every 100 ms while active; return agent to idle only after `isDrained()`. P5 can emit `audio.end` after final progress, so send progress while the response is open even when its queued samples are already consumed; do not wait for `audio.end` to report progress.
- Connection loss immediately gates/stops capture, clears playback, and discards incomplete audio. P4 alone owns bounded backoff/jitter/deadline. Reauthorize by repeating HTTP create with the **same live-session idempotency key** and the current bound conversation ID, not a new key/session. Recovery requires a fresh epoch and a Resume voice gesture before local audio restarts; ask the user to repeat lost speech, never replay/reinfer it.
- Page hidden/freeze suspends local capture/playback, mutes the server input, and retains finalized conversation/session state and the draft lease. Merely becoming visible does not resume audio. Pagehide, unmount, New Chat, selection, active deletion, device change/loss, permission denial, unrecoverable errors, and recovery timeout end voice locally and return usable text chat. Explicit Resume voice initializes playback and fresh capture from its gesture.
- Reset playback's cursor origin only after P4 reports a recovered fresh epoch (P5 creates a new provider socket for that epoch), never on mute, interruption, or a normal turn. Keep generated/delivered evidence server-side.
- Local release is immediate and callbacks are fenced before cleanup. Remote end uses P4's bounded HTTP request. Keep `ending` until cleanup settles, show text chat rather than a stuck panel, and explain an unconfirmed remote close without implying that server reservation/billing has already ended.
- All notices/announcements are fixed application-owned operational strings. Never render `Error.message`, provider payloads, transcript text, assistant text, or arbitrary server strings, including in hidden nodes, attributes, titles, live regions, or tooltips.

## File map

| Action / exact path | Responsibility |
| --- | --- |
| Create `frontend/src/features/voice/state/live-voice-reducer.ts` | Typed independent operational dimensions, lifecycle, draft restoration request |
| Create `frontend/src/features/voice/state/live-voice-reducer.test.ts` | Duplex dimensions, playback drain and lifecycle reducer checks |
| Create `frontend/src/features/voice/state/live-voice-controller.ts` | Lease, P4 resource composition, run/capture fencing, controls, cleanup/recovery |
| Create `frontend/src/features/voice/state/live-voice-controller.test.ts` | Gesture boundary, mute/interrupt/drain/late-event/recovery tests |
| Create `frontend/src/features/voice/state/testing/live-voice-fixture.ts` | Small injected port fixture reusing real P4 playback/socket fakes |
| Create `frontend/src/features/voice/state/useLiveVoice.ts` | Thin React external-store hook, server config, explicit activation and lifecycle listeners |
| Create `frontend/src/features/voice/live/LiveVoiceBubble.tsx` | Decorative operational bubble/waveform, no transcript props |
| Create `frontend/src/features/voice/live/LiveVoicePanel.tsx` | Named voice region, state pills/announcement and recovery action |
| Create `frontend/src/features/voice/live/live-voice.css` | Scoped responsive bubble/control styles, focus, reduced motion |
| Create `frontend/src/features/voice/live/live-voice-surface.test.ts` | SSR state/announcement/no-hidden-text and CSS contract checks |
| Create `frontend/src/features/voice/live/LiveVoiceControls.tsx` | Native mute/unmute, Stop speaking and Exit voice buttons/tooltips |
| Create `frontend/src/features/voice/live/live-voice-controls.test.ts` | Labels, disabled policy and actual handlers/shortcuts |
| Create `frontend/src/features/voice/live/live-voice-lifecycle.ts` | Small listener/key/focus helpers used by the hook/panel/ChatView |
| Create `frontend/src/features/voice/live/live-voice-lifecycle.test.ts` | Actual lifecycle listeners, keyboard/focus and idempotent detach |
| Create `frontend/src/features/voice/live/live-voice-composition.test.ts` | Real P4 client/playback/controller plus P7 chat lease/navigation composition |
| Create `frontend/src/features/voice/index.ts` | Public surface/hook/types only, no eager browser initialization |
| Modify `frontend/src/features/chat/ChatView.tsx` | Live-versus-text conditional rendering and draft focus restoration; retain sidebar logic |
| Create `frontend/src/features/chat/ChatView.voice.test.ts` | Actual ChatView SSR branches with hook/context fixtures |
| Modify `frontend/src/styles/chat.css` only if needed | One scoped live-layout selector; preserve all existing user styling |

No P11-owned `frontend/src/features/voice/integration-tests/**` files are created. P8's composition tests live under `live/` and P11 consumes them as local evidence.

## Task 1: Live Voice State Machine & Hook

**Files:** Create the six `state/` files and `state/testing/live-voice-fixture.ts` in the file map. Work one test/function at a time; each checkbox is a 2–5 minute action, not a monolithic feature step.

### 1A — Independent operational reducer

- [ ] **1.1 Write `frontend/src/features/voice/state/live-voice-reducer.test.ts`.**

```typescript
import { expect, it } from 'vitest';
import { initialLiveVoice, liveVoiceReducer, type LiveVoiceState } from './live-voice-reducer.ts';

it('keeps input listening while thinking and speaking; mute does not end playback', () => {
  let state = liveVoiceReducer(initialLiveVoice, { type: 'START' });
  state = liveVoiceReducer(state, { type: 'CONNECTING' });
  state = liveVoiceReducer(state, { type: 'READY', resumeRequired: false });
  state = liveVoiceReducer(state, { type: 'AGENT', agent: 'thinking' });
  expect(state).toMatchObject({ phase: 'active', input: 'listening', agent: 'thinking', connection: 'connected' });
  state = liveVoiceReducer(state, { type: 'AUDIO_START', ref: { turnId: 't1', responseId: 'r1' } });
  expect(state).toMatchObject({ input: 'listening', agent: 'speaking' });
  state = liveVoiceReducer(state, { type: 'INPUT', input: 'muted' });
  expect(state).toMatchObject({ input: 'muted', agent: 'speaking' });
});

it('does not mistake server idle or another response drain for local playback completion', () => {
  let state: LiveVoiceState = { ...initialLiveVoice, phase: 'active', connection: 'connected' };
  state = liveVoiceReducer(state, { type: 'AUDIO_START', ref: { turnId: 't1', responseId: 'r1' } });
  expect(liveVoiceReducer(state, { type: 'AGENT', agent: 'idle' }).agent).toBe('speaking');
  expect(liveVoiceReducer(state, { type: 'DRAINED', responseId: 'old' })).toBe(state);
  expect(liveVoiceReducer(state, { type: 'DRAINED', responseId: 'r1' }))
    .toMatchObject({ agent: 'idle', response: null, input: 'listening' });
});

it('reconnect and suspend require a gesture without collapsing the independent dimensions', () => {
  const active = { ...initialLiveVoice, phase: 'active' as const, connection: 'connected' as const, input: 'muted' as const };
  const lost = liveVoiceReducer(active, { type: 'LOST' });
  expect(lost).toMatchObject({ phase: 'suspended', connection: 'reconnecting', input: 'muted', resumeRequired: true });
  const recovered = liveVoiceReducer(lost, { type: 'READY', resumeRequired: true });
  expect(recovered).toMatchObject({ phase: 'suspended', connection: 'connected', resumeRequired: true });
  expect(liveVoiceReducer(recovered, { type: 'RESUMED' }))
    .toMatchObject({ phase: 'active', input: 'muted', resumeRequired: false });
});
```

- [ ] **1.2 Run RED:** `npm test -- src/features/voice/state/live-voice-reducer.test.ts`. Expected: missing module/export, not empty discovery.
- [ ] **1.3 Add `frontend/src/features/voice/state/live-voice-reducer.ts`.**

```typescript
import type { VoiceResponseRef } from '../../../api/voice-protocol.ts';

export type LiveDraft = { text: string; start: number; end: number;
  direction: 'forward' | 'backward' | 'none' };
export type LiveVoiceState = {
  phase: 'idle' | 'requesting_permission' | 'connecting' | 'active' | 'suspended' | 'ending';
  input: 'listening' | 'muted'; agent: 'idle' | 'thinking' | 'speaking';
  connection: 'connecting' | 'connected' | 'reconnecting';
  response: VoiceResponseRef | null; resumeRequired: boolean; inputBusy: boolean;
  notice: string | null; restoreDraft: LiveDraft | null;
};
export const initialLiveVoice: LiveVoiceState = {
  phase: 'idle', input: 'listening', agent: 'idle', connection: 'connecting',
  response: null, resumeRequired: false, inputBusy: false, notice: null, restoreDraft: null,
};
export type LiveVoiceAction =
  | { type: 'START' | 'CONNECTING' | 'LOST' | 'RESUMED' | 'INTERRUPT' }
  | { type: 'READY'; resumeRequired: boolean }
  | { type: 'INPUT'; input: LiveVoiceState['input'] }
  | { type: 'INPUT_BUSY'; value: boolean }
  | { type: 'AGENT'; agent: LiveVoiceState['agent'] }
  | { type: 'AUDIO_START'; ref: VoiceResponseRef }
  | { type: 'DRAINED'; responseId: string }
  | { type: 'SUSPEND' | 'NOTICE'; notice: string }
  | { type: 'ENDING'; notice: string | null; restoreDraft: LiveDraft | null }
  | { type: 'EXIT'; notice: string | null };

export function liveVoiceReducer(state: LiveVoiceState, action: LiveVoiceAction): LiveVoiceState {
  switch (action.type) {
    case 'START': return { ...initialLiveVoice, phase: 'requesting_permission' };
    case 'CONNECTING': return { ...state, phase: 'connecting', connection: 'connecting' };
    case 'READY': return { ...state, connection: 'connected', resumeRequired: action.resumeRequired,
      phase: action.resumeRequired ? 'suspended' : 'active' };
    case 'INPUT': return { ...state, input: action.input };
    case 'INPUT_BUSY': return { ...state, inputBusy: action.value };
    case 'AGENT': return state.response && action.agent === 'idle' ? state
      : { ...state, agent: action.agent === 'speaking' && !state.response ? 'thinking' : action.agent };
    case 'AUDIO_START': return { ...state, agent: 'speaking', response: action.ref };
    case 'DRAINED': return state.response?.responseId === action.responseId
      ? { ...state, agent: 'idle', response: null } : state;
    case 'INTERRUPT': return { ...state, agent: 'idle', response: null };
    case 'LOST': return { ...state, phase: 'suspended', connection: 'reconnecting',
      resumeRequired: true, agent: 'idle', response: null, inputBusy: false,
      notice: 'Connection lost. Reconnecting; you may need to repeat your last turn.' };
    case 'SUSPEND': return { ...state, phase: 'suspended', resumeRequired: true,
      agent: 'idle', response: null, inputBusy: false, notice: action.notice };
    case 'RESUMED': return { ...state, phase: 'active', resumeRequired: false, notice: null };
    case 'NOTICE': return { ...state, notice: action.notice };
    case 'ENDING': return { ...state, phase: 'ending', response: null, agent: 'idle',
      resumeRequired: false, inputBusy: false, notice: action.notice, restoreDraft: action.restoreDraft };
    case 'EXIT': return { ...initialLiveVoice, notice: action.notice, restoreDraft: state.restoreDraft };
  }
}

export const showsLiveVoice = (state: LiveVoiceState) =>
  state.phase !== 'idle' && state.phase !== 'ending';
```

- [ ] **1.4 Run GREEN:** same command, expected three discovered cases pass. Add no transcript field to this state.

### 1B — Controller tests and injected P4 composition

- [ ] **1.5 Add `frontend/src/features/voice/state/testing/live-voice-fixture.ts`.** This fixture uses production playback, not a fabricated received-audio cursor. Types are defined in the controller listing below.

```typescript
import { vi } from 'vitest';
import { AudioPlaybackService } from '../../audio/audio-playback-service.ts';
import { FakeContext } from '../../audio/testing/audio-fakes.ts';
import { session } from '../../transport/testing/voice-fakes.ts';
import { INPUT_AUDIO, OUTPUT_AUDIO, DEFAULT_VOICE_LIMITS,
  type PublicVoiceConfig, type VoiceServerPayload } from '../../../../api/voice-protocol.ts';
import { LiveVoiceController, type LiveVoicePorts } from '../live-voice-controller.ts';

export async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
export function liveVoiceFixture(overrides: Partial<LiveVoicePorts> = {}) {
  const context = new FakeContext();
  const playback = new AudioPlaybackService(() => context.asContext());
  const response = session();
  const config: PublicVoiceConfig = { protocolVersion: 1,
    enabledModes: { dictation: true, live: true }, supportedLocales: ['en-US'],
    limits: { ...DEFAULT_VOICE_LIMITS }, inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO };
  let callbacks!: Parameters<LiveVoicePorts['client']>[0];
  let captureCallbacks!: Parameters<LiveVoicePorts['capture']>[0];
  let sequence = 0, draft = 'Unsent original', owner: string | null = null;
  let close: (() => void) | undefined;
  const capture = { start: vi.fn(async () => {}), setMuted: vi.fn(async (_muted: boolean) => {}),
    stop: vi.fn(async (_drain = false) => {}) };
  const client = { connect: vi.fn(), control: vi.fn(() => true), sendInput: vi.fn(() => true),
    invalidate: vi.fn(), dispose: vi.fn() };
  const http = { create: vi.fn(async (_request: Parameters<LiveVoicePorts['http']['create']>[0],
    _signal?: AbortSignal) => ({ ...response })), end: vi.fn(async (_id: string) => {}) };
  const bindings = {
    claimVoiceInput: vi.fn((_mode: 'live', onClose: () => void): string | null => {
      if (owner) return null; owner = 'lease-1'; close = onClose; return owner;
    }),
    writeVoiceDraft: vi.fn((token: string, text: string) => {
      if (owner !== token) return false; draft = text; return true;
    }),
    releaseVoiceInput: vi.fn((token: string) => { if (owner === token) owner = null; }),
    bindVoiceConversation: vi.fn((token: string, _id: string) => owner === token),
    refreshSessions: vi.fn(),
  };
  const controller = new LiveVoiceController({ http, bindings, playback: () => playback,
    capture: options => { captureCallbacks = options; return capture; },
    client: options => { callbacks = options; return client; }, ...overrides });
  const event = (payload: VoiceServerPayload, epoch = response.connectionEpoch) => {
    callbacks.event?.({ protocolVersion: 1, sessionId: response.sessionId, connectionEpoch: epoch,
      eventId: `event-${sequence}`, sequence: sequence++, ...payload });
  };
  const begin = async () => {
    await controller.start({ text: draft, start: 7, end: 15, direction: 'backward' }, null, config);
    event({ type: 'session.ready', limits: response.limits, effectiveAudioSettings: response.effectiveAudioSettings });
    await settle();
  };
  return { controller, config, response, context, playback, capture, client, http, bindings, begin,
    event, callbacks: () => callbacks, draft: () => draft, close: () => close?.(),
    frame: () => captureCallbacks.frame(new Uint8Array(2560), 0),
    deviceLost: () => captureCallbacks.error('MICROPHONE_LOST'),
    audio: (id = 'r1', seq = 0, offsetMs = 0) => callbacks.audio?.(
      { kind: 2, flags: 0, sequence: seq, offsetMs, pcm: new Uint8Array(4800) },
      { turnId: 't1', responseId: id }) };
}
```

- [ ] **1.6 Write `frontend/src/features/voice/state/live-voice-controller.test.ts`.**

```typescript
import { afterEach, expect, it, vi } from 'vitest';
import { liveVoiceFixture, settle } from './testing/live-voice-fixture.ts';
afterEach(() => vi.useRealTimers());

it('allocates nothing before activation or when disabled/leased; starts audio inside the gesture', async () => {
  const f = liveVoiceFixture();
  expect(f.capture.start).not.toHaveBeenCalled(); expect(f.context.resume).not.toHaveBeenCalled();
  f.config.enabledModes.live = false;
  await f.controller.start({ text: 'Unsent original', start: 0, end: 0, direction: 'none' }, null, f.config);
  expect(f.bindings.claimVoiceInput).not.toHaveBeenCalled();
  f.config.enabledModes.live = true; f.bindings.claimVoiceInput.mockReturnValueOnce(null);
  await f.controller.start({ text: 'Unsent original', start: 0, end: 0, direction: 'none' }, null, f.config);
  expect(f.http.create).not.toHaveBeenCalled(); expect(f.capture.start).not.toHaveBeenCalled();
  const starting = f.controller.start({ text: 'Unsent original', start: 7, end: 15, direction: 'backward' }, null, f.config);
  expect(f.capture.start).toHaveBeenCalledTimes(1); expect(f.context.resume).toHaveBeenCalledTimes(1);
  f.frame(); expect(f.client.sendInput).not.toHaveBeenCalled();
  await starting;
  expect(f.http.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'live', conversationId: null }), expect.any(AbortSignal));
  f.event({ type: 'session.ready', limits: f.response.limits, effectiveAudioSettings: f.response.effectiveAudioSettings });
  await settle(); f.frame(); expect(f.client.sendInput).toHaveBeenCalledTimes(1);
  expect(f.draft()).toBe('Unsent original'); f.controller.exit(); await settle();
});

it('mutes input synchronously without interrupting output and resumes only fresh samples', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.audio();
  const muting = f.controller.toggleMute(); f.frame();
  expect(f.client.sendInput).not.toHaveBeenCalled(); await muting;
  expect(f.capture.setMuted).toHaveBeenLastCalledWith(true);
  expect(f.controller.getSnapshot()).toMatchObject({ input: 'muted', agent: 'speaking', phase: 'active' });
  expect(f.context.sources[0].stop).not.toHaveBeenCalled();
  await f.controller.toggleMute(); f.frame();
  expect(f.capture.setMuted).toHaveBeenLastCalledWith(false);
  expect(f.client.sendInput).toHaveBeenCalledTimes(1);
  expect(f.client.control).toHaveBeenCalledWith({ type: 'input.unmute' });
  f.controller.exit(); await settle();
});

it('clears audio before sending interruption and reports played rather than received samples', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.audio(); f.context.currentTime = 0.05;
  f.client.control.mockImplementation(() => {
    expect(f.context.sources[0].stop).toHaveBeenCalled(); return true;
  });
  f.controller.interrupt();
  expect(f.client.invalidate).toHaveBeenCalledWith('r1');
  expect(f.client.control).toHaveBeenCalledWith({ type: 'response.interrupt', turnId: 't1', responseId: 'r1',
    playbackPositionMs: 50, playedSamples: 1200 });
  f.audio(); expect(f.context.sources).toHaveLength(1);
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', agent: 'idle', input: 'listening' });
  f.controller.exit(); await settle();
});

it('does not return to idle on audio.end until the actual output queue drains', async () => {
  vi.useFakeTimers(); const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.audio(); f.event({ type: 'audio.end', turnId: 't1', responseId: 'r1', lastAudioSequence: 0 });
  expect(f.controller.getSnapshot().agent).toBe('speaking');
  f.context.currentTime = 0.1; await vi.advanceTimersByTimeAsync(100);
  expect(f.controller.getSnapshot().agent).toBe('idle');
  expect(f.client.control).toHaveBeenCalledWith(expect.objectContaining({ type: 'playback.progress', playedSamples: 2400 }));
  f.controller.exit(); await settle(); expect(vi.getTimerCount()).toBe(0);
});

it('restores draft/releases resources once and fences late callbacks on exit/navigation', async () => {
  const f = liveVoiceFixture(); await f.begin(); const old = f.callbacks();
  f.event({ type: 'conversation.bound', conversationId: 'chat-voice-1' });
  expect(f.bindings.bindVoiceConversation).toHaveBeenCalledWith('lease-1', 'chat-voice-1');
  f.close(); f.close(); await settle();
  expect(f.draft()).toBe('Unsent original'); expect(f.http.end).toHaveBeenCalledTimes(1);
  expect(f.client.dispose).toHaveBeenCalledTimes(1); expect(f.capture.stop).toHaveBeenCalledWith(false);
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1);
  expect(f.controller.getSnapshot().restoreDraft).toBeNull();
  old.error?.('STT_UNAVAILABLE'); old.audio?.({ kind: 2, flags: 0, sequence: 9, offsetMs: 0, pcm: new Uint8Array(4800) },
    { turnId: 't1', responseId: 'r1' });
  expect(f.context.sources).toHaveLength(0);
});
```

- [ ] **1.7 Run RED:** `npm test -- src/features/voice/state/live-voice-controller.test.ts`. Expected: missing controller, then missing behavior as each test is activated.
- [ ] **1.8 Add the controller's types, cached snapshot and resource entry helpers to `frontend/src/features/voice/state/live-voice-controller.ts`.**

```typescript
import type { VoiceClient, VoiceClientOptions, VoiceHttpClient } from '../../../api/voice-client.ts';
import type { CreateVoiceSessionRequest, CreateVoiceSessionResponse, PublicVoiceConfig,
  VoiceServerEvent, VoiceResponseRef } from '../../../api/voice-protocol.ts';
import type { AudioCaptureService } from '../audio/audio-capture-service.ts';
import type { AudioPlaybackService } from '../audio/audio-playback-service.ts';
import { initialLiveVoice, liveVoiceReducer, type LiveDraft, type LiveVoiceAction } from './live-voice-reducer.ts';

export type LiveVoiceBindings = {
  claimVoiceInput: (mode: 'live', onClose: () => void) => string | null;
  writeVoiceDraft: (token: string, text: string) => boolean;
  releaseVoiceInput: (token: string) => void;
  bindVoiceConversation: (token: string, conversationId: string) => boolean;
  refreshSessions: () => void;
};
export type LiveVoicePorts = {
  http: Pick<VoiceHttpClient, 'create' | 'end'>; bindings: LiveVoiceBindings;
  capture: (options: ConstructorParameters<typeof AudioCaptureService>[0]) =>
    Pick<AudioCaptureService, 'start' | 'setMuted' | 'stop'>;
  playback: (maxQueueMs: number) => Pick<AudioPlaybackService,
    'unlock' | 'begin' | 'enqueue' | 'end' | 'progress' | 'isDrained' | 'interrupt' | 'resetOrigin' | 'dispose'>;
  client: (options: VoiceClientOptions) => Pick<VoiceClient,
    'connect' | 'control' | 'sendInput' | 'invalidate' | 'dispose'>;
};
type Run = {
  token: string; draft: LiveDraft; abort: AbortController; request: CreateVoiceSessionRequest;
  session?: CreateVoiceSessionResponse; client?: ReturnType<LiveVoicePorts['client']>;
  capture?: ReturnType<LiveVoicePorts['capture']>; playback: ReturnType<LiveVoicePorts['playback']>;
  captureGeneration: number; ready: boolean; transmitting: boolean; muted: boolean;
  needsGesture: boolean; response: VoiceResponseRef | null;
  timer?: ReturnType<typeof setInterval>; endRequested: boolean;
};
export type LiveExitReason = 'user' | 'navigation' | 'unmount' | 'pagehide' | 'error';

export function liveVoiceNotice(code: string) {
  if (code === 'MICROPHONE_DENIED') return 'Microphone access was denied. You can still type your message.';
  if (['MICROPHONE_LOST', 'MICROPHONE_UNAVAILABLE'].includes(code)) return 'Microphone unavailable. Return to text or start voice again.';
  if (code === 'UNSUPPORTED_AUDIO') return 'Voice is unavailable in this browser. Text chat is still available.';
  if (code === 'PLAYBACK_BLOCKED') return 'Audio is paused. Select Resume voice to enable playback.';
  if (code === 'VOICE_RECONNECT_TIMEOUT') return 'Voice could not reconnect. Your draft is unchanged; you can still type.';
  if (code === 'VOICE_QUOTA_EXHAUSTED') return 'The voice limit was reached. You can continue in text chat.';
  if (code === 'VOICE_DURATION_LIMIT') return 'The voice session time limit was reached.';
  if (code === 'VOICE_IDLE_TIMEOUT') return 'Voice ended after inactivity.';
  if (code === 'VOICE_DELIVERY_UNKNOWN') return 'Some audio may not have been heard. Continue in text without repeating a completed request.';
  if (code === 'REMOTE_END_UNCONFIRMED') return 'Voice stopped locally. Its connection is still closing; wait before starting again.';
  return 'Voice ended unexpectedly. Your draft is unchanged; you can still type.';
}

export class LiveVoiceController {
  private run: Run | null = null;
  private view = initialLiveVoice;
  private listeners = new Set<() => void>();
  private readonly ports: LiveVoicePorts;
  constructor(ports: LiveVoicePorts) { this.ports = ports; }
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private dispatch(action: LiveVoiceAction) {
    const next = liveVoiceReducer(this.view, action);
    if (next !== this.view) { this.view = next; this.listeners.forEach(listener => listener()); }
  }
  private current(run: Run) { return this.run === run && !run.abort.signal.aborted; }
  private fail(run: Run, code: string) { if (this.current(run)) this.exit('error', liveVoiceNotice(code)); }
  private capture(run: Run, maxPendingMs: number) {
    const generation = ++run.captureGeneration;
    const capture = this.ports.capture({ maxPendingMs,
      frame: (pcm, flags) => {
        if (!this.current(run) || generation !== run.captureGeneration || !run.transmitting || flags !== 0) return;
        if (!run.client?.sendInput(pcm, flags)) this.fail(run, 'VOICE_CONNECT_TIMEOUT');
      }, error: code => { if (generation === run.captureGeneration) this.fail(run, code); } });
    run.capture = capture; return capture;
  }
  private stopCapture(run: Run) {
    run.transmitting = false; run.captureGeneration++;
    const capture = run.capture; run.capture = undefined;
    return capture?.stop(false) ?? Promise.resolve();
  }
  private stopTimer(run: Run) { clearInterval(run.timer); run.timer = undefined; }
  private startTimer(run: Run) {
    this.stopTimer(run);
    run.timer = setInterval(() => { if (this.current(run)) this.poll(run); }, 100);
  }
  private endSession(run: Run) {
    if (!run.session || run.endRequested) return Promise.resolve();
    run.endRequested = true; return this.ports.http.end(run.session.sessionId);
  }
```

- [ ] **1.9 Add `start`, `ready`, and validated operational event handling inside that class.** No browser implementation is constructed in the controller module.

```typescript
  async start(draft: LiveDraft, conversationId: string | null, config: PublicVoiceConfig) {
    if (this.run || this.view.phase === 'ending' || !config.enabledModes.live || draft.text.length > 32_000) return;
    const token = this.ports.bindings.claimVoiceInput('live', () => this.exit('navigation'));
    if (!token) return;
    const run: Run = { token, draft: { ...draft }, abort: new AbortController(),
      request: { protocolVersion: 1, mode: 'live', conversationId, locale: 'en-US', idempotencyKey: crypto.randomUUID() },
      playback: this.ports.playback(config.limits.outputQueueMs), captureGeneration: 0,
      ready: false, transmitting: false, muted: false, needsGesture: false, response: null, endRequested: false };
    this.run = run; this.dispatch({ type: 'START' });
    try {
      const capture = this.capture(run, config.limits.inputQueueMs);
      // Both methods run before the first await, retaining the activation gesture.
      await Promise.all([run.playback.unlock(), capture.start()]);
      if (!this.current(run)) return;
      this.dispatch({ type: 'CONNECTING' });
      run.session = await this.ports.http.create(run.request, run.abort.signal);
      if (!this.current(run)) { void this.endSession(run).catch(() => {}); return; }
      run.client = this.ports.client({
        event: event => this.event(run, event),
        audio: (frame, ref) => {
          if (!this.current(run) || run.needsGesture || this.view.phase !== 'active' ||
            ref.responseId !== run.response?.responseId) return;
          try { run.playback.enqueue(ref.responseId, frame); }
          catch (error) {
            if (error instanceof Error && error.message === 'PLAYBACK_BLOCKED') this.suspend(liveVoiceNotice('PLAYBACK_BLOCKED'));
            else this.fail(run, 'VOICE_DELIVERY_UNKNOWN');
          }
        },
        lost: () => this.lost(run),
        recovered: session => {
          if (!this.current(run)) return;
          run.session = session; run.playback.resetOrigin();
          run.needsGesture = true;
        },
        error: code => this.fail(run, code), ended: () => {
          if (this.current(run)) this.exit('error', 'Voice ended. Your draft is unchanged.');
        },
        reauthorize: (previous, signal) => this.ports.http.create(
          { ...run.request, conversationId: previous.conversationId }, signal),
      });
      run.client.connect(run.session);
    } catch (error) {
      this.fail(run, error instanceof Error ? error.message : 'VOICE_CONNECT_TIMEOUT');
    }
  }
  private async ready(run: Run) {
    if (!this.current(run)) return;
    run.ready = true;
    if (run.needsGesture) {
      if (!run.client!.control({ type: 'input.mute' })) { this.fail(run, 'VOICE_RECONNECT_TIMEOUT'); return; }
      this.dispatch({ type: 'READY', resumeRequired: true });
      this.dispatch({ type: 'NOTICE', notice: 'Voice paused. Select Resume voice; repeat any speech lost during the interruption.' });
      return;
    }
    const capture = run.capture;
    const generation = run.captureGeneration;
    try {
      if (!run.client!.control({ type: 'input.unmute' })) throw new Error('VOICE_CONNECT_TIMEOUT');
      await capture!.setMuted(false);
      if (!this.current(run) || run.needsGesture || generation !== run.captureGeneration) return;
      run.transmitting = true;
      this.dispatch({ type: 'READY', resumeRequired: false }); this.startTimer(run);
    } catch (error) {
      if (generation === run.captureGeneration) this.fail(run, error instanceof Error ? error.message : 'UNSUPPORTED_AUDIO');
    }
  }
  private event(run: Run, event: VoiceServerEvent) {
    if (!this.current(run) || event.sessionId !== run.session?.sessionId ||
      event.connectionEpoch !== run.session.connectionEpoch) return;
    try {
      switch (event.type) {
        case 'session.ready': void this.ready(run); break;
        case 'conversation.bound':
          if (!this.ports.bindings.bindVoiceConversation(run.token, event.conversationId)) {
            this.fail(run, 'VOICE_BINDING_MISMATCH'); break;
          }
          run.session = { ...run.session, conversationId: event.conversationId }; break;
        case 'voice.state':
          if (!run.needsGesture) this.dispatch({ type: 'AGENT', agent: event.agent });
          // Local input intent owns the immediate mute indicator; an old server state cannot unmute it.
          break;
        case 'audio.start':
          run.response = { turnId: event.turnId, responseId: event.responseId };
          run.playback.begin(event.turnId, event.responseId);
          if (run.needsGesture) this.interrupt();
          else this.dispatch({ type: 'AUDIO_START', ref: run.response });
          break;
        case 'audio.end':
          if (run.response?.responseId === event.responseId) { run.playback.end(event.responseId); this.poll(run); }
          break;
        case 'response.cancelled':
          if (run.response?.responseId === event.responseId) this.interrupt(false);
          break;
        case 'session.warning':
          if (event.recovery === 'resume_gesture') this.suspend(liveVoiceNotice('PLAYBACK_BLOCKED'));
          else if (event.recovery === 'return_to_chat') this.fail(run, event.code);
          else this.dispatch({ type: 'NOTICE', notice: event.code === 'VOICE_DURATION_LIMIT'
            ? 'Voice will end soon. You can return to text at any time.'
            : event.code === 'VOICE_IDLE_TIMEOUT' ? 'Are you still there? Speak to keep voice active.'
            : liveVoiceNotice(event.code) });
          break;
        case 'session.error': this.fail(run, event.code); break;
        case 'session.ended': this.exit('error', 'Voice ended. Your draft is unchanged.'); break;
      }
    } catch { this.fail(run, 'VOICE_DELIVERY_UNKNOWN'); }
  }
```

- [ ] **1.10 Add output progress, mute, interruption, suspend/recovery/resume methods inside the class.**

```typescript
  private poll(run: Run) {
    if (!this.current(run) || !run.ready || run.needsGesture || !run.response) return;
    const ref = run.response;
    const progress = run.playback.progress();
    if (!run.client!.control({ type: 'playback.progress', ...ref,
      playedMs: progress.playedMs, playedSamples: progress.playedSamples })) {
      this.fail(run, 'VOICE_RECONNECT_TIMEOUT'); return;
    }
    if (run.playback.isDrained() && run.response === ref) {
      run.response = null; this.dispatch({ type: 'DRAINED', responseId: ref.responseId });
    }
  }
  async toggleMute() {
    const run = this.run;
    if (!run || this.view.phase !== 'active' || this.view.connection !== 'connected' || this.view.inputBusy) return;
    run.transmitting = false; run.muted = !run.muted;
    this.dispatch({ type: 'INPUT', input: run.muted ? 'muted' : 'listening' });
    this.dispatch({ type: 'INPUT_BUSY', value: true });
    const capture = run.capture!;
    const generation = run.captureGeneration;
    try {
      // Source reset starts synchronously on mute; never await the network before discarding buffers.
      if (run.muted) {
        const resetting = capture.setMuted(true);
        if (!run.client!.control({ type: 'input.mute' })) throw new Error('VOICE_CONNECT_TIMEOUT');
        await resetting;
      } else {
        if (!run.client!.control({ type: 'input.unmute' })) throw new Error('VOICE_CONNECT_TIMEOUT');
        await capture.setMuted(false);
      }
      if (this.current(run) && !run.needsGesture && generation === run.captureGeneration) run.transmitting = !run.muted;
    } catch (error) {
      if (generation === run.captureGeneration) this.fail(run, error instanceof Error ? error.message : 'UNSUPPORTED_AUDIO');
    } finally {
      if (this.current(run) && generation === run.captureGeneration) this.dispatch({ type: 'INPUT_BUSY', value: false });
    }
  }
  interrupt(notify = true) {
    const run = this.run, ref = run?.response;
    if (!run || !ref) return;
    const progress = run.playback.interrupt(); // Immediate local silence before any transport call.
    run.client?.invalidate(ref.responseId); run.response = null;
    this.dispatch({ type: 'INTERRUPT' });
    if (notify && run.ready && !run.client?.control({ type: 'response.interrupt', ...ref,
      playbackPositionMs: progress.playedMs, playedSamples: progress.playedSamples })) this.fail(run, 'VOICE_RECONNECT_TIMEOUT');
  }
  suspend(notice = 'Voice paused while the page was hidden. Select Resume voice to continue.') {
    const run = this.run;
    if (!run || (run.needsGesture && !run.capture && !run.response)) return;
    run.needsGesture = true; run.transmitting = false;
    this.interrupt(); this.stopTimer(run);
    void this.stopCapture(run).catch(() => this.fail(run, 'UNSUPPORTED_AUDIO'));
    if (!this.current(run)) return;
    if (run.ready && !run.client?.control({ type: 'input.mute' })) { this.fail(run, 'VOICE_RECONNECT_TIMEOUT'); return; }
    this.dispatch({ type: 'SUSPEND', notice });
  }
  private lost(run: Run) {
    if (!this.current(run)) return;
    run.ready = false; run.needsGesture = true; run.transmitting = false;
    run.playback.interrupt(); run.response = null;
    this.stopTimer(run); void this.stopCapture(run).catch(() => {});
    this.dispatch({ type: 'LOST' });
  }
  async resume() {
    const run = this.run;
    if (!run || !run.ready || this.view.phase !== 'suspended' || this.view.inputBusy) return;
    this.dispatch({ type: 'INPUT_BUSY', value: true });
    const capture = this.capture(run, run.session!.limits.inputQueueMs);
    const generation = run.captureGeneration;
    try {
      await Promise.all([run.playback.unlock(), capture.start()]);
      if (!this.current(run) || !run.ready || generation !== run.captureGeneration) return;
      if (!run.muted && !run.client!.control({ type: 'input.unmute' })) throw new Error('VOICE_RECONNECT_TIMEOUT');
      await capture.setMuted(run.muted);
      if (!this.current(run) || !run.ready || generation !== run.captureGeneration) return;
      run.needsGesture = false; run.transmitting = !run.muted;
      this.dispatch({ type: 'RESUMED' }); this.startTimer(run);
    } catch (error) {
      if (generation !== run.captureGeneration || !this.current(run)) return;
      if (error instanceof Error && error.message === 'PLAYBACK_BLOCKED' && this.current(run)) {
        void this.stopCapture(run).catch(() => {});
        this.dispatch({ type: 'NOTICE', notice: liveVoiceNotice('PLAYBACK_BLOCKED') });
      } else this.fail(run, error instanceof Error ? error.message : 'UNSUPPORTED_AUDIO');
    } finally {
      if (this.current(run) && (generation === run.captureGeneration || !run.capture)) this.dispatch({ type: 'INPUT_BUSY', value: false });
    }
  }
```

- [ ] **1.11 Add the exit path and close the class.** Frame/run fences occur before side effects, and restore only while owning the token. Navigation/unmount cleanup never requests focus restoration.

```typescript
  exit(reason: LiveExitReason = 'user', notice: string | null = null) {
    const run = this.run;
    if (!run) return;
    this.run = null; run.abort.abort(); run.transmitting = false;
    this.stopTimer(run); run.playback.interrupt();
    const stopping = this.stopCapture(run);
    try { run.client?.control({ type: 'session.end' }); } catch { /* Local teardown still runs. */ }
    run.client?.dispose();
    const written = this.ports.bindings.writeVoiceDraft(run.token, run.draft.text);
    this.ports.bindings.releaseVoiceInput(run.token);
    this.dispatch({ type: 'ENDING', notice,
      restoreDraft: written && (reason === 'user' || reason === 'error') ? run.draft : null });
    void Promise.allSettled([stopping, run.playback.dispose(), this.endSession(run)]).then(results => {
      const endedNotice = results.some(result => result.status === 'rejected')
        ? liveVoiceNotice('REMOTE_END_UNCONFIRMED') : notice;
      this.dispatch({ type: 'EXIT', notice: endedNotice });
      this.ports.bindings.refreshSessions();
    });
  }
}
```

The reusable controller has no permanent disposed flag. `ending` blocks a new start until the bounded cleanup completes; release restores text immediately. Unknown remote allocation after an aborted HTTP response is handled by P5's connect expiry, not by guessing a session ID. Do not interpret HTTP cleanup success as proof of no provider charge.

- [ ] **1.12 Run GREEN:** `npm test -- src/features/voice/state/live-voice-controller.test.ts src/features/voice/state/live-voice-reducer.test.ts`. Expected: all discovered initial cases pass. If P4/P7 interfaces differ, stop for a serialized owner handoff; do not patch upstream source to satisfy this listing.

### 1C — Thin hook (lifecycle listener refinements in Task 5)

- [ ] **1.13 Append this failing helper test to `live-voice-controller.test.ts`; import `snapshotLiveDraft` from `./useLiveVoice.ts`.**

```typescript
it('snapshots exact UTF-16 draft/selection without passing it into session creation', () => {
  expect(snapshotLiveDraft({ value: '🙂 Before OLD after', selectionStart: 10, selectionEnd: 13,
    selectionDirection: 'backward' } as HTMLTextAreaElement, 'stale render'))
    .toEqual({ text: '🙂 Before OLD after', start: 10, end: 13, direction: 'backward' });
  expect(snapshotLiveDraft(null, 'Unsent')).toEqual({ text: 'Unsent', start: 6, end: 6, direction: 'none' });
});
```

- [ ] **1.14 Run RED:** `npm test -- src/features/voice/state/live-voice-controller.test.ts -t "snapshots exact"`. Expected: missing helper/hook. If importing the native worklet URL requires a mock, use `vi.mock('../audio/audio-capture-processor.ts?worker&url', () => ({ default: '/capture-worklet.js' }))` at test top level; do not mock the controller's logic.
- [ ] **1.15 Add `frontend/src/features/voice/state/useLiveVoice.ts`.**

```typescript
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { VoiceClient, VoiceHttpClient } from '../../../api/voice-client.ts';
import type { PublicVoiceConfig } from '../../../api/voice-protocol.ts';
import { AudioCaptureService } from '../audio/audio-capture-service.ts';
import { AudioPlaybackService } from '../audio/audio-playback-service.ts';
import { LiveVoiceController, type LiveVoiceBindings } from './live-voice-controller.ts';
import type { LiveDraft } from './live-voice-reducer.ts';

export function snapshotLiveDraft(element: HTMLTextAreaElement | null, fallback: string): LiveDraft {
  const text = element?.value ?? fallback;
  return { text, start: element?.selectionStart ?? text.length, end: element?.selectionEnd ?? text.length,
    direction: element?.selectionDirection ?? 'none' };
}
export function useLiveVoice(options: {
  conversationId: string | null; draft: string; bindings: LiveVoiceBindings;
}) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; }, [options]);
  const [http] = useState(() => new VoiceHttpClient());
  const [config, setConfig] = useState<PublicVoiceConfig | null>(null);
  const [controller] = useState(() => new LiveVoiceController({ http,
    capture: callbacks => new AudioCaptureService(callbacks),
    playback: max => new AudioPlaybackService(undefined, max),
    client: callbacks => new VoiceClient(callbacks),
    bindings: {
      claimVoiceInput: (mode, onClose) => latest.current.bindings.claimVoiceInput(mode, onClose),
      writeVoiceDraft: (token, text) => latest.current.bindings.writeVoiceDraft(token, text),
      releaseVoiceInput: token => latest.current.bindings.releaseVoiceInput(token),
      bindVoiceConversation: (token, id) => latest.current.bindings.bindVoiceConversation(token, id),
      refreshSessions: () => latest.current.bindings.refreshSessions(),
    } }));
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    const abort = new AbortController();
    void http.config(abort.signal).then(value => { if (!abort.signal.aborted) setConfig(value); })
      .catch(() => { if (!abort.signal.aborted) setConfig(null); });
    return () => abort.abort();
  }, [http]);
  useEffect(() => () => controller.exit('unmount'), [controller]);
  const start = () => {
    if (!config?.enabledModes.live || document.hidden) return;
    const current = latest.current;
    const draft = snapshotLiveDraft(document.querySelector<HTMLTextAreaElement>('.aurvin-textarea'), current.draft);
    void controller.start(draft, current.conversationId, config);
  };
  return { view, start, toggleMute: () => { void controller.toggleMute(); },
    interrupt: () => controller.interrupt(), exit: () => controller.exit(),
    resume: () => { if (!document.hidden) void controller.resume(); } };
}
export type LiveVoiceSurface = ReturnType<typeof useLiveVoice>;
```

`useState` constructs objects without opening media or sockets. The hook has no conversation-ID navigation effect: a valid server binding changes the selected ID without ending voice. P7's synchronous lease callback handles actual navigation; Task 5 handles page/device/unmount cleanup. Existing Composer config fetching can stay P7-owned; no new global config cache abstraction.

- [ ] **1.16 Run GREEN:** `npm test -- src/features/voice/state`; then `npm run build` and `npm run lint`. Expected: discovered reducer/controller/helper cases pass and both checks succeed. Build/lint may expose the P7 binding seam gate; do not bypass it with casts or optional no-op binding.
- [ ] **1.17 Commit exact files, serialized:**

```powershell
git add frontend/src/features/voice/state/live-voice-reducer.ts frontend/src/features/voice/state/live-voice-reducer.test.ts frontend/src/features/voice/state/live-voice-controller.ts frontend/src/features/voice/state/live-voice-controller.test.ts frontend/src/features/voice/state/testing/live-voice-fixture.ts frontend/src/features/voice/state/useLiveVoice.ts
git commit -m "feat(voice): model duplex live state and compose existing audio lifecycle"
```

## Task 2: Live Voice Bubble / Waveform UI

**Files:** Create `frontend/src/features/voice/live/LiveVoiceBubble.tsx`, `LiveVoicePanel.tsx`, `live-voice.css`, and `live-voice-surface.test.ts`. Task 3 adds the controls to the panel; Task 2's Resume voice button is the gesture-unlock action.

- [ ] **2.1 Write `frontend/src/features/voice/live/live-voice-surface.test.ts`.**

```typescript
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { LiveVoicePanel } from './LiveVoicePanel.tsx';
import { initialLiveVoice } from '../state/live-voice-reducer.ts';
import type { LiveVoiceSurface } from '../state/useLiveVoice.ts';

const render = (patch: Partial<LiveVoiceSurface['view']> = {}) => renderToStaticMarkup(createElement(LiveVoicePanel, {
  voice: { view: { ...initialLiveVoice, phase: 'active', connection: 'connected', ...patch },
    start: vi.fn(), toggleMute: vi.fn(), interrupt: vi.fn(), exit: vi.fn(), resume: vi.fn() },
}));
it('announces operational dimensions and uses only a decorative waveform', () => {
  const html = render({ agent: 'speaking', response: { turnId: 't1', responseId: 'r1' } });
  expect(html).toContain('aria-label="Live voice conversation"');
  expect(html).toContain('Listening'); expect(html).toContain('Speaking'); expect(html).toContain('Connected');
  expect(html).toContain('role="status"'); expect(html).toContain('aria-live="polite"');
  expect(html).toContain('aria-atomic="true"'); expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain('textarea'); expect(html).not.toContain('contenteditable');
  expect(html).not.toContain('t1'); expect(html).not.toContain('r1');
});
it('renders permission/connection/recovery states and a native resume gesture', () => {
  expect(render({ phase: 'requesting_permission', connection: 'connecting' })).toContain('Requesting microphone permission');
  expect(render({ phase: 'connecting', connection: 'connecting' })).toContain('Connecting');
  const paused = render({ phase: 'suspended', connection: 'reconnecting', resumeRequired: true });
  expect(paused).toContain('Reconnecting'); expect(paused).toContain('Voice paused');
  expect(paused).toMatch(/<button[^>]*aria-label="Resume voice"[^>]*disabled=""/);
  expect(render({ phase: 'suspended', resumeRequired: true })).toMatch(/aria-label="Resume voice"(?![^>]*disabled)/);
});
it('provides reduced motion and visible focus without dropping state labels', () => {
  const css = readFileSync('src/features/voice/live/live-voice.css', 'utf8');
  expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  expect(css).toContain('animation: none'); expect(css).toContain(':focus-visible');
  expect(render({ input: 'muted', agent: 'thinking' })).toContain('Microphone muted');
  expect(render({ input: 'muted', agent: 'thinking' })).toContain('Thinking');
});
```

- [ ] **2.2 Run RED:** `npm test -- src/features/voice/live/live-voice-surface.test.ts`. Expected: missing panel/styles.
- [ ] **2.3 Add `frontend/src/features/voice/live/LiveVoiceBubble.tsx`.** Use a visual metaphor, not simulated speech amplitude. Reuse Aurvin's existing palette and restrained motion. No analyser, animation frame loop, audio meter, or decorative dependency is needed.

```tsx
import type { LiveVoiceState } from '../state/live-voice-reducer.ts';

export function LiveVoiceBubble({ view }: { view: LiveVoiceState }) {
  return <div className="aurvin-live-bubble" aria-hidden="true"
    data-agent={view.agent} data-input={view.input} data-connection={view.connection}
    data-paused={view.resumeRequired || view.phase !== 'active'}>
    <svg viewBox="0 0 120 120" focusable="false">
      <circle cx="60" cy="60" r="49" />
      <path d="M32 51v18M46 40v40M60 28v64M74 40v40M88 51v18" />
    </svg>
  </div>;
}
```

- [ ] **2.4 Add `frontend/src/features/voice/live/LiveVoicePanel.tsx`.**

```tsx
import { useLayoutEffect, useRef } from 'react';
import type { LiveVoiceSurface } from '../state/useLiveVoice.ts';
import { LiveVoiceBubble } from './LiveVoiceBubble.tsx';
import './live-voice.css';

export function liveVoiceLabels(view: LiveVoiceSurface['view']) {
  const connection = { connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting' }[view.connection];
  const input = view.resumeRequired ? 'Voice paused' : view.inputBusy ? 'Updating microphone'
    : view.input === 'muted' ? 'Microphone muted'
    : view.phase === 'active' ? 'Listening' : 'Microphone starting';
  const agent = { idle: 'Ready', thinking: 'Thinking', speaking: 'Speaking' }[view.agent];
  const phase = view.phase === 'requesting_permission' ? 'Requesting microphone permission'
    : view.phase === 'connecting' ? 'Connecting voice' : 'Live voice';
  return { phase, connection, input, agent };
}
export function LiveVoicePanel({ voice }: { voice: LiveVoiceSurface }) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const labels = liveVoiceLabels(voice.view);
  return <section className="aurvin-live-panel" aria-label="Live voice conversation">
    <h1 ref={heading} tabIndex={-1}>Voice conversation</h1>
    <p className="aurvin-live-description">Audio is processed for this conversation. You can return to text at any time.</p>
    <LiveVoiceBubble view={voice.view} />
    <div className="aurvin-live-pills" aria-hidden="true">
      <span>{labels.connection}</span><span>{labels.input}</span><span>{labels.agent}</span>
    </div>
    <p className="aurvin-live-status" role="status" aria-live="polite" aria-atomic="true">
      {labels.phase}. {labels.connection}. {labels.input}. {labels.agent}.
      {voice.view.notice ? ` ${voice.view.notice}` : ''}
    </p>
    {voice.view.resumeRequired ? <button type="button" className="aurvin-live-button"
      aria-label="Resume voice" disabled={voice.view.connection !== 'connected' || voice.view.inputBusy}
      onClick={voice.resume}>Resume voice</button> : null}
  </section>;
}
```

This is a page region, not a modal: retain sidebar access and do not trap focus. The heading receives focus once on entry, not every playback state change. The operational live region has no conversation input. Playback progress does not dispatch UI state on every poll, so it does not generate repeated announcements.

- [ ] **2.5 Add `frontend/src/features/voice/live/live-voice.css`.**

```css
.aurvin-live-panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 24px 16px;
  text-align: center;
}
.aurvin-live-panel h1 { margin: 0; font-size: 22px; font-weight: 500; }
.aurvin-live-description, .aurvin-live-status { max-width: 40ch; margin: 0; color: var(--aurvin-text-secondary); }
.aurvin-live-bubble {
  width: clamp(140px, 32vw, 260px);
  aspect-ratio: 1;
  border-radius: 50%;
  color: var(--aurvin-text-primary);
  background: var(--aurvin-hover);
  animation: aurvin-live-breathe 3s ease-in-out infinite;
}
.aurvin-live-bubble svg { width: 100%; height: 100%; fill: none; stroke: currentColor; }
.aurvin-live-bubble circle { opacity: 0.3; stroke-width: 1; }
.aurvin-live-bubble path { stroke-width: 5; stroke-linecap: round; }
.aurvin-live-bubble[data-agent='thinking'] { animation-duration: 2s; }
.aurvin-live-bubble[data-agent='speaking'] path { animation: aurvin-live-wave 0.8s ease-in-out infinite alternate; transform-origin: center; }
.aurvin-live-bubble[data-input='muted'] circle { stroke-dasharray: 4 4; }
.aurvin-live-bubble[data-paused='true'] { animation: none; }
.aurvin-live-bubble[data-paused='true'] path { animation: none; }
.aurvin-live-pills, .aurvin-live-controls { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; max-width: 100%; }
.aurvin-live-pills span { padding: 5px 10px; border: 1px solid var(--aurvin-border); border-radius: 16px; font-size: 12px; }
.aurvin-live-button {
  min-width: 44px;
  min-height: 44px;
  padding: 9px 14px;
  border: 1px solid var(--aurvin-border);
  border-radius: 22px;
  color: var(--aurvin-text-primary);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.aurvin-live-button:disabled { opacity: 0.5; cursor: default; }
.aurvin-live-button:focus-visible, .aurvin-live-panel h1:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.aurvin-live-control { position: relative; }
.aurvin-live-tooltip { display: none; position: absolute; bottom: calc(100% + 6px); left: 0; width: max-content; max-width: 180px; padding: 6px; border-radius: 6px; background: var(--aurvin-bg); border: 1px solid var(--aurvin-border); font-size: 12px; z-index: 1; }
.aurvin-live-control:hover .aurvin-live-tooltip, .aurvin-live-control:focus-within .aurvin-live-tooltip { display: block; }
.aurvin-live-shortcuts { font-size: 12px; color: var(--aurvin-text-secondary); margin: 0; }
.aurvin-live-chat-notice { margin: 8px 16px; color: var(--aurvin-text-secondary); }
@keyframes aurvin-live-breathe { 50% { transform: scale(1.035); } }
@keyframes aurvin-live-wave { to { transform: scaleY(0.75); } }
@media (max-height: 540px) { .aurvin-live-panel { justify-content: flex-start; gap: 12px; } .aurvin-live-bubble { width: 140px; } }
@media (prefers-reduced-motion: reduce) {
  .aurvin-live-panel *, .aurvin-live-bubble { animation: none; transition: none; }
}
```

Use labels and the dashed muted outline as non-color cues; reduced motion still has all pills and announcements. Existing narrow-layout wrapping supports 200% zoom; do not rename or replace existing chat CSS variables.

- [ ] **2.6 Run GREEN:** `npm test -- src/features/voice/live/live-voice-surface.test.ts`; `npm run build`; `npm run lint`. Expected: three discovered tests pass, compilation/lint succeed.
- [ ] **2.7 Commit, serialized:**

```powershell
git add frontend/src/features/voice/live/LiveVoiceBubble.tsx frontend/src/features/voice/live/LiveVoicePanel.tsx frontend/src/features/voice/live/live-voice.css frontend/src/features/voice/live/live-voice-surface.test.ts
git commit -m "feat(voice): add transcript-free operational waveform surface"
```

## Task 3: Live Voice Controls Bar

**Files:** Create `frontend/src/features/voice/live/LiveVoiceControls.tsx` and `live-voice-controls.test.ts`; modify `LiveVoicePanel.tsx`. Styles already exist in the dedicated stylesheet.

- [ ] **3.1 Write `frontend/src/features/voice/live/live-voice-controls.test.ts`.** Direct handler invocation below exercises production buttons without claiming Node has a browser DOM.

```typescript
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { LiveVoiceControls, type LiveVoiceControlsProps } from './LiveVoiceControls.tsx';
import { initialLiveVoice } from '../state/live-voice-reducer.ts';

const props = (): LiveVoiceControlsProps => ({ view: { ...initialLiveVoice, phase: 'active', connection: 'connected',
  agent: 'speaking', response: { turnId: 't1', responseId: 'r1' } }, onMute: vi.fn(), onInterrupt: vi.fn(), onExit: vi.fn() });
function buttons(node: ReactElement): ReactElement<{ onClick: () => void; disabled?: boolean }>[] {
  const result: ReactElement<{ onClick: () => void; disabled?: boolean }>[] = [];
  const visit = (child: unknown) => {
    if (Array.isArray(child)) { child.forEach(visit); return; }
    if (!child || typeof child !== 'object' || !('type' in child) || !('props' in child)) return;
    const element = child as ReactElement<{ children?: unknown }>;
    if (element.type === 'button') result.push(element as ReactElement<{ onClick: () => void; disabled?: boolean }>);
    const hint = element.props as { children?: unknown };
    if (typeof element.type === 'function' && typeof hint.children === 'function') {
      visit((hint.children as (id: string) => ReactElement)('test-tooltip-id'));
    } else visit(hint.children);
  };
  visit(node); return result;
}
it('exposes pressed mute state, Stop speaking and Exit with native controls and focusable tooltips', () => {
  const p = props(); const html = renderToStaticMarkup(createElement(LiveVoiceControls, p));
  expect(html.match(/type="button"/g)).toHaveLength(3);
  expect(html).toContain('aria-label="Mute microphone"'); expect(html).toContain('aria-pressed="false"');
  expect(html).toContain('aria-label="Stop speaking"'); expect(html).toContain('aria-label="Exit voice"');
  expect(html).toContain('role="tooltip"'); expect(html).toContain('aria-describedby=');
  expect(html).not.toContain('tabindex=');
  const muted = renderToStaticMarkup(createElement(LiveVoiceControls, { ...p, view: { ...p.view, input: 'muted' } }));
  expect(muted).toContain('aria-label="Unmute microphone"'); expect(muted).toContain('aria-pressed="true"');
});
it('wires each enabled button to its real action and leaves Exit usable during connection/recovery', () => {
  const p = props(); buttons(LiveVoiceControls(p)).forEach(button => button.props.onClick());
  expect(p.onMute).toHaveBeenCalledTimes(1); expect(p.onInterrupt).toHaveBeenCalledTimes(1); expect(p.onExit).toHaveBeenCalledTimes(1);
  for (const phase of ['requesting_permission', 'connecting', 'suspended'] as const) {
    const controls = buttons(LiveVoiceControls({ ...p, view: { ...p.view, phase, response: null, connection: 'reconnecting' } }));
    expect(controls[0].props.disabled).toBe(true); expect(controls[1].props.disabled).toBe(true);
    expect(controls[2].props.disabled).not.toBe(true);
  }
});
it('disables Stop without a known response and serializes microphone toggles', () => {
  const p = props();
  expect(buttons(LiveVoiceControls({ ...p, view: { ...p.view, agent: 'thinking', response: null } }))[1].props.disabled).toBe(true);
  expect(buttons(LiveVoiceControls({ ...p, view: { ...p.view, inputBusy: true } }))[0].props.disabled).toBe(true);
});
```

- [ ] **3.2 Run RED:** `npm test -- src/features/voice/live/live-voice-controls.test.ts`. Expected: missing controls/export.
- [ ] **3.3 Add `frontend/src/features/voice/live/LiveVoiceControls.tsx`.** Tooltip IDs use React `useId` in a tiny wrapper component; direct tests call only the hook-free bar, not hook internals.

```tsx
import { useId, type ReactNode } from 'react';
import type { LiveVoiceState } from '../state/live-voice-reducer.ts';

function Hint({ hint, children }: { hint: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return <span className="aurvin-live-control">{children(id)}
    <span id={id} role="tooltip" className="aurvin-live-tooltip">{hint}</span></span>;
}
export type LiveVoiceControlsProps = { view: LiveVoiceState;
  onMute: () => void; onInterrupt: () => void; onExit: () => void };
export function LiveVoiceControls(props: LiveVoiceControlsProps) {
  const { view } = props;
  const usable = view.phase === 'active' && view.connection === 'connected' && !view.resumeRequired;
  const muteLabel = view.input === 'muted' ? 'Unmute microphone' : 'Mute microphone';
  return <div className="aurvin-live-controls" role="group" aria-label="Live voice controls">
    <Hint hint="Mute stops microphone input; Aurvin may continue speaking.">{id =>
      <button type="button" className="aurvin-live-button" aria-label={muteLabel} aria-describedby={id}
        aria-pressed={view.input === 'muted'} disabled={!usable || view.inputBusy} onClick={props.onMute}>{muteLabel}</button>}
    </Hint>
    <Hint hint="Stop the current reply and remain in voice.">{id =>
      <button type="button" className="aurvin-live-button" aria-label="Stop speaking" aria-describedby={id}
        disabled={!usable || !view.response} onClick={props.onInterrupt}>Stop speaking</button>}
    </Hint>
    <Hint hint="Release microphone and playback and return to text chat.">{id =>
      <button type="button" className="aurvin-live-button" aria-label="Exit voice" aria-describedby={id}
        onClick={props.onExit}>Exit voice</button>}
    </Hint>
  </div>;
}
```

The direct handler traversal expands Hint's render-prop children without calling its `useId` hook outside React. It verifies button callbacks, not DOM focus or native keyboard traversal.

- [ ] **3.4 Import `LiveVoiceControls` in `LiveVoicePanel.tsx` and append it after the optional Resume button, inside the section:**

```tsx
<LiveVoiceControls view={voice.view} onMute={voice.toggleMute} onInterrupt={voice.interrupt} onExit={voice.exit} />
```

- [ ] **3.5 Run GREEN:** `npm test -- src/features/voice/live/live-voice-controls.test.ts src/features/voice/live/live-voice-surface.test.ts`; then `npm run build`, `npm run lint`. Expected: all cases pass with three native controls, operational-only hints, and no changed text composer.
- [ ] **3.6 Commit, serialized:**

```powershell
git add frontend/src/features/voice/live/LiveVoiceControls.tsx frontend/src/features/voice/live/live-voice-controls.test.ts frontend/src/features/voice/live/LiveVoicePanel.tsx
git commit -m "feat(voice): add accessible mute interruption and exit controls"
```

## Task 4: ChatView & Navigation Integration

**Files:** Modify `frontend/src/features/chat/ChatView.tsx`; create `frontend/src/features/chat/ChatView.voice.test.ts` and `frontend/src/features/voice/index.ts`. Preserve existing New Chat/greeting/sidebar/session-action code. Shared `chat.css` should remain unchanged unless the current flex layout requires the single scoped rule below after ownership clearance.

- [ ] **4.1 Write `frontend/src/features/chat/ChatView.voice.test.ts`.** Its fake context deliberately includes sensitive existing chat text. Test the actual ChatView branch; mocking the whole ChatView would prove nothing.

```typescript
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatView } from './ChatView.tsx';
import { initialLiveVoice } from '../voice/state/live-voice-reducer.ts';
import type { LiveVoiceSurface } from '../voice/state/useLiveVoice.ts';
import { initialChatState } from './state/chat-reducer.ts';

const context = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), actions: {
  startNewChat: vi.fn(), selectSession: vi.fn(), loadOlderMessages: vi.fn(), loadMoreSessions: vi.fn(),
  setDraft: vi.fn(), submitMessage: vi.fn(), cancelCurrentTurn: vi.fn(), retryTurn: vi.fn(),
  isVoiceInputLocked: vi.fn(() => false), renameSession: vi.fn(), pinSession: vi.fn(), deleteSession: vi.fn(),
} }));
vi.mock('./state/chat-context.tsx', () => ({ useChat: () => context }));
vi.mock('../voice/dictation/useDictation.ts', () => ({ useDictation: () => ({ config: null,
  locked: false, phase: 'idle', status: '', notice: null, start: vi.fn(), stop: vi.fn(), cancel: vi.fn() }) }));

beforeEach(() => { context.state = { ...initialChatState, draftInput: 'UNSENT_SECRET_DRAFT',
  activeSessionId: 'chat-1', messages: [{ messageId: 'm1', turnId: 't1', eventId: 'e1', sequence: 0,
    role: 'user', content: 'EXISTING_SECRET_TRANSCRIPT', createdAt: '2026-10-08T00:00:00Z', completionStatus: 'completed', truncated: false }] }; });
const voice = (phase: LiveVoiceSurface['view']['phase']): LiveVoiceSurface => ({
  view: { ...initialLiveVoice, phase, connection: 'connected',
    notice: phase === 'idle' ? 'Voice ended. Your draft is unchanged.' : null },
  start: vi.fn(), toggleMute: vi.fn(), interrupt: vi.fn(), exit: vi.fn(), resume: vi.fn(),
});
it.each(['requesting_permission', 'connecting', 'active', 'suspended'] as const)
  ('unmounts composer/transcript and all their accessibility text during %s', phase => {
    const html = renderToStaticMarkup(createElement(ChatView, { liveVoice: voice(phase) }));
    expect(html).toContain('Live voice conversation'); expect(html).toContain('New chat');
    expect(html).not.toContain('<textarea'); expect(html).not.toContain('aurvin-transcript');
    expect(html).not.toContain('UNSENT_SECRET_DRAFT'); expect(html).not.toContain('EXISTING_SECRET_TRANSCRIPT');
  });
it('returns to text on exit/ending, restores the unchanged draft, and shows only an operational notice', () => {
  for (const phase of ['idle', 'ending'] as const) {
    const html = renderToStaticMarkup(createElement(ChatView, { liveVoice: voice(phase) }));
    expect(html).toContain('<textarea'); expect(html).toContain('UNSENT_SECRET_DRAFT');
    expect(html).toContain('EXISTING_SECRET_TRANSCRIPT'); expect(html).not.toContain('Live voice conversation');
  }
  const html = renderToStaticMarkup(createElement(ChatView, { liveVoice: voice('idle') }));
  expect(html).toContain('Voice ended. Your draft is unchanged.');
});
it('preserves the original text-only empty chat behavior without live assembly', () => {
  context.state = { ...initialChatState, draftInput: 'draft' };
  const html = renderToStaticMarkup(createElement(ChatView));
  expect(html).toContain('aurvin-composer-centered'); expect(html).not.toContain('Live voice conversation');
});
```

If current Sidebar invokes an additional existing action in its render, extend this action fixture with that action only; do not mock Sidebar out or rewrite production navigation. Existing text test suites remain authoritative for its handlers.

- [ ] **4.2 Run RED:** `npm test -- src/features/chat/ChatView.voice.test.ts`. Expected: live prop ignored, composer/secret text still rendered.
- [ ] **4.3 Add `frontend/src/features/voice/index.ts` with only these exports:**

```typescript
export { useLiveVoice, type LiveVoiceSurface } from './state/useLiveVoice.ts';
export { LiveVoicePanel } from './live/LiveVoicePanel.tsx';
export { showsLiveVoice, type LiveVoiceState } from './state/live-voice-reducer.ts';
```

- [ ] **4.4 Patch `ChatView.tsx`, retaining all unrelated lines.** Add imports:

```tsx
import { LiveVoicePanel } from '../voice/live/LiveVoicePanel.tsx';
import { showsLiveVoice } from '../voice/state/live-voice-reducer.ts';
import type { LiveVoiceSurface } from '../voice/state/useLiveVoice.ts';
```

Replace only its declaration and add `liveActive` below `isEmpty`:

```tsx
export function ChatView({ liveVoice }: { liveVoice?: LiveVoiceSurface }) {
```

```tsx
const liveActive = liveVoice ? showsLiveVoice(liveVoice.view) : false;
```

Replace only the transcript/empty/composer JSX block:

```tsx
{liveActive && liveVoice ? <LiveVoicePanel voice={liveVoice} /> : <>
  {isEmpty ? <div className="aurvin-empty">
    <EmptyState key={greetingKey} />
    <Composer variant="centered" />
  </div> : <Transcript />}
  {isEmpty ? null : <Composer variant="docked" />}
  {liveVoice?.view.notice ? <p className="aurvin-live-chat-notice" role="status"
    aria-live="polite" aria-atomic="true">{liveVoice.view.notice}</p> : null}
</>}
```

Do **not** render both branches with `display:none`, `hidden`, or `aria-hidden`: conversation nodes must not exist in the live subtree or its accessibility announcements. Preserve the existing disclaimer and header/sidebar. `ending` restores text immediately while remote cleanup is bounded. In Task 5, restore the composer caret only once after its controlled value commits.

If a rendering check shows the existing main flex layout shrinks the live panel incorrectly, append this exact scoped rule to `frontend/src/styles/chat.css` after the orchestrator clears its current user diff; otherwise the dedicated stylesheet is sufficient and this file is not staged:

```css
.aurvin-main > .aurvin-live-panel { flex: 1 1 auto; min-height: 0; }
```

- [ ] **4.5 Run GREEN:** `npm test -- src/features/chat/ChatView.voice.test.ts src/features/chat/integration-tests/welcome-and-safe-render.test.ts src/features/chat/state/voice-draft-lock.test.ts`; then `npm run build`, `npm run lint`. Expected: live branches omit text entirely, existing empty/text/lease/navigation checks remain green. P7 must report its new binding tests separately before accepting the bound-conversation handoff.
- [ ] **4.6 Commit, serialized:**

```powershell
git add frontend/src/features/chat/ChatView.tsx frontend/src/features/chat/ChatView.voice.test.ts frontend/src/features/voice/index.ts
git commit -m "feat(voice): replace chat content with live surface without losing drafts"
```

Only include `frontend/src/styles/chat.css` if the scoped rule was actually required and only P8's cleared patch is staged; do not accidentally commit the user's existing stylesheet changes.

## Task 5: Live Voice Surface Component & Integration Tests

**Files:** Create `frontend/src/features/voice/live/live-voice-lifecycle.ts`, `live-voice-lifecycle.test.ts`, `live-voice-composition.test.ts`; modify `useLiveVoice.ts`, `LiveVoicePanel.tsx`, `LiveVoiceControls.tsx`, `ChatView.tsx`, and controller tests/source for the specific activation race below. This task supplies genuine new RED/implementation steps for listeners/shortcuts/focus/races, followed by real-P4 composition verification. No DOM package, browser environment change, production provider call, or P11-owned test directory.

### 5A — Actual lifecycle listeners, shortcuts and focus helpers

- [ ] **5.1 Write `frontend/src/features/voice/live/live-voice-lifecycle.test.ts`.**

```typescript
import { expect, it, vi } from 'vitest';
import { attachLiveVoiceLifecycle, handleLiveVoiceKey, focusVoiceSurface,
  restoreLiveDraftFocus } from './live-voice-lifecycle.ts';
import { initialLiveVoice } from '../state/live-voice-reducer.ts';

it('hidden/freeze suspend; visible does not auto-resume; pagehide/device loss exit; detach is idempotent', () => {
  const page = Object.assign(new EventTarget(), { hidden: false });
  const browser = new EventTarget(), devices = new EventTarget();
  const suspend = vi.fn(), exit = vi.fn();
  const detach = attachLiveVoiceLifecycle({ suspend, exit }, page, browser, devices);
  page.hidden = true; page.dispatchEvent(new Event('visibilitychange'));
  expect(suspend).toHaveBeenCalledTimes(1);
  page.hidden = false; page.dispatchEvent(new Event('visibilitychange'));
  expect(suspend).toHaveBeenCalledTimes(1);
  page.dispatchEvent(new Event('freeze')); expect(suspend).toHaveBeenCalledTimes(2);
  browser.dispatchEvent(new Event('pagehide')); expect(exit).toHaveBeenCalledWith('pagehide');
  devices.dispatchEvent(new Event('devicechange')); expect(exit).toHaveBeenCalledWith('error', 'Microphone unavailable. Return to text or start voice again.');
  detach(); detach(); page.hidden = true; page.dispatchEvent(new Event('visibilitychange'));
  browser.dispatchEvent(new Event('pagehide')); devices.dispatchEvent(new Event('devicechange'));
  expect(suspend).toHaveBeenCalledTimes(2); expect(exit).toHaveBeenCalledWith('unmount');
  expect(exit.mock.calls.filter(([reason]) => reason === 'unmount')).toHaveLength(1);
});
it('focuses the surface and restores the exact committed draft/selection once, never a changed draft', () => {
  const focus = vi.fn(), setSelectionRange = vi.fn();
  focusVoiceSurface({ focus } as unknown as HTMLElement); expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  const draft = { text: '🙂 keep me', start: 3, end: 7, direction: 'backward' as const };
  const applied = { current: null as typeof draft | null };
  const textarea = { value: 'not committed', focus, setSelectionRange } as unknown as HTMLTextAreaElement;
  restoreLiveDraftFocus(textarea, draft, applied); expect(setSelectionRange).not.toHaveBeenCalled();
  textarea.value = draft.text; restoreLiveDraftFocus(textarea, draft, applied);
  expect(setSelectionRange).toHaveBeenCalledExactlyOnceWith(3, 7, 'backward');
  restoreLiveDraftFocus(textarea, draft, applied); expect(setSelectionRange).toHaveBeenCalledTimes(1);
});
it('shortcuts are panel-scoped, ignore editors/IME/repeats, and obey the actual button policy', () => {
  const actions = { onMute: vi.fn(), onInterrupt: vi.fn(), onExit: vi.fn() };
  const view = { ...initialLiveVoice, phase: 'active' as const, connection: 'connected' as const,
    response: { turnId: 't1', responseId: 'r1' } };
  const event = { key: 'Escape', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    repeat: false, defaultPrevented: false, isComposing: false, target: null, preventDefault: vi.fn() };
  handleLiveVoiceKey(event, view, actions); expect(actions.onInterrupt).toHaveBeenCalledTimes(1);
  handleLiveVoiceKey({ ...event, key: 'm', altKey: true }, view, actions); expect(actions.onMute).toHaveBeenCalledTimes(1);
  handleLiveVoiceKey({ ...event, key: 'x', altKey: true }, view, actions); expect(actions.onExit).toHaveBeenCalledTimes(1);
  for (const patch of [{ repeat: true }, { isComposing: true }, { ctrlKey: true },
    { target: { closest: () => ({}) } as unknown as EventTarget }]) {
    handleLiveVoiceKey({ ...event, ...patch }, view, actions);
  }
  handleLiveVoiceKey(event, { ...view, response: null }, actions);
  handleLiveVoiceKey({ ...event, key: 'm', altKey: true }, { ...view, inputBusy: true }, actions);
  expect(actions.onInterrupt).toHaveBeenCalledTimes(1); expect(actions.onMute).toHaveBeenCalledTimes(1);
});
```

- [ ] **5.2 Run RED:** `npm test -- src/features/voice/live/live-voice-lifecycle.test.ts`. Expected: missing lifecycle helper exports.
- [ ] **5.3 Add `frontend/src/features/voice/live/live-voice-lifecycle.ts`.** These functions are actual production seams for Node listener/handler checks, not an invented framework.

```typescript
import { liveVoiceNotice, type LiveExitReason } from '../state/live-voice-controller.ts';
import type { LiveDraft, LiveVoiceState } from '../state/live-voice-reducer.ts';

type Lifecycle = { suspend: () => void; exit: (reason: LiveExitReason, notice?: string) => void };
export function attachLiveVoiceLifecycle(controller: Lifecycle,
  page: EventTarget & { hidden: boolean }, browser: EventTarget, devices?: EventTarget) {
  const hidden = () => { if (page.hidden) controller.suspend(); };
  const freeze = () => controller.suspend();
  const leave = () => controller.exit('pagehide');
  // ponytail: any device change ends voice; device-specific continuity can be added after hardware evidence.
  const lost = () => controller.exit('error', liveVoiceNotice('MICROPHONE_LOST'));
  page.addEventListener('visibilitychange', hidden); page.addEventListener('freeze', freeze);
  browser.addEventListener('pagehide', leave); devices?.addEventListener('devicechange', lost);
  let detached = false;
  return () => {
    if (detached) return; detached = true;
    page.removeEventListener('visibilitychange', hidden); page.removeEventListener('freeze', freeze);
    browser.removeEventListener('pagehide', leave); devices?.removeEventListener('devicechange', lost);
    controller.exit('unmount');
  };
}
type VoiceKey = { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean;
  repeat: boolean; defaultPrevented: boolean; isComposing: boolean; target: EventTarget | null;
  preventDefault: () => void };
type KeyActions = { onMute: () => void; onInterrupt: () => void; onExit: () => void };
export function handleLiveVoiceKey(event: VoiceKey, view: LiveVoiceState, actions: KeyActions) {
  const target = event.target as Element | null;
  if (event.repeat || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.shiftKey ||
    target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  const usable = view.phase === 'active' && view.connection === 'connected' && !view.resumeRequired;
  let action: (() => void) | undefined;
  if (event.key === 'Escape' && !event.altKey && usable && view.response) action = actions.onInterrupt;
  if (event.altKey && event.key.toLowerCase() === 'm' && usable && !view.inputBusy) action = actions.onMute;
  if (event.altKey && event.key.toLowerCase() === 'x') action = actions.onExit;
  if (action) { event.preventDefault(); action(); }
}
export function focusVoiceSurface(element: HTMLElement | null) { element?.focus({ preventScroll: true }); }
export function restoreLiveDraftFocus(element: HTMLTextAreaElement | null, draft: LiveDraft | null,
  applied: { current: LiveDraft | null }) {
  if (!element || !draft || element.value !== draft.text || applied.current === draft) return;
  element.focus({ preventScroll: true });
  element.setSelectionRange(draft.start, draft.end, draft.direction); applied.current = draft;
}
```

- [ ] **5.4 Wire the helper into the actual hook.** Import `attachLiveVoiceLifecycle` into `useLiveVoice.ts`, and replace its unmount-only effect with:

```typescript
useEffect(() => attachLiveVoiceLifecycle(controller, document, window, navigator.mediaDevices), [controller]);
```

- [ ] **5.5 Wire focus and shortcuts into the actual panel.** Import `focusVoiceSurface` and `handleLiveVoiceKey`. Replace the heading effect's body with `focusVoiceSurface(heading.current)`. Add `onKeyDown` to the **section**, not window/document, and add the visible shortcut hint after controls:

```tsx
onKeyDown={event => handleLiveVoiceKey({ key: event.key, altKey: event.altKey, ctrlKey: event.ctrlKey,
  metaKey: event.metaKey, shiftKey: event.shiftKey, repeat: event.repeat,
  defaultPrevented: event.defaultPrevented, isComposing: event.nativeEvent.isComposing,
  target: event.target, preventDefault: () => event.preventDefault() }, voice.view,
  { onMute: voice.toggleMute, onInterrupt: voice.interrupt, onExit: voice.exit })}
```

```tsx
<p className="aurvin-live-shortcuts">Alt+M: microphone · Escape: stop speaking · Alt+X: exit voice</p>
```

Add `aria-keyshortcuts="Alt+M"`, `aria-keyshortcuts="Escape"`, and `aria-keyshortcuts="Alt+X"` to the corresponding buttons in `LiveVoiceControls.tsx`. Native Tab/Enter/Space continue working; no positive tabindex, keydown global listener, or keyboard trap. Disabled buttons and shortcut guards use the same policy.

- [ ] **5.6 Restore focus after the actual ChatView text branch commits.** Extend the existing React import in `ChatView.tsx` to include `useLayoutEffect`/`useRef`; import `restoreLiveDraftFocus` and `type LiveDraft`. Add below `liveActive`:

```tsx
const mainRef = useRef<HTMLElement | null>(null);
const restored = useRef<LiveDraft | null>(null);
useLayoutEffect(() => {
  if (!liveActive) restoreLiveDraftFocus(mainRef.current?.querySelector<HTMLTextAreaElement>('.aurvin-textarea') ?? null,
    liveVoice?.view.restoreDraft ?? null, restored);
}, [liveActive, liveVoice?.view.restoreDraft, state.draftInput]);
```

Add `ref={mainRef}` to the existing `<main>`. Restore the existing controlled draft selection once; wait for the matching value rather than moving focus during navigation or on later edits. No changes to P7's textarea ownership/ref are needed.

- [ ] **5.7 Run GREEN:** `npm test -- src/features/voice/live/live-voice-lifecycle.test.ts src/features/voice/live/live-voice-controls.test.ts src/features/chat/ChatView.voice.test.ts`; then `npm run build` and `npm run lint`. Expected: listener/shortcut/focus assertions pass. SSR verifies structure, helper tests verify calls, and P11 still owns real keyboard/assistive-technology evidence.

### 5B — Recovery, late activation and error regression tests

- [ ] **5.8 Append the following tests to `frontend/src/features/voice/state/live-voice-controller.test.ts`.** These expose a real race in Task 1: hiding the page while permission/session creation is pending can continue connecting after the suspend request. Add the assertions before its minimal fix.

```typescript
it('hiding during permission acquisition cannot continue creating a voice session from a late result', async () => {
  const f = liveVoiceFixture(); let grant!: () => void;
  f.capture.start.mockImplementationOnce(() => new Promise<void>(resolve => { grant = resolve; }));
  const start = f.controller.start({ text: 'Unsent original', start: 0, end: 0, direction: 'none' }, null, f.config);
  f.controller.suspend(); grant(); await start; await settle();
  expect(f.http.create).not.toHaveBeenCalled(); expect(f.capture.stop).toHaveBeenCalledWith(false);
  expect(f.controller.getSnapshot().phase).toBe('idle'); expect(f.draft()).toBe('Unsent original');
});
it('loss clears playback/input; a fresh epoch does not replay audio and requires an explicit resume', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 }); f.audio();
  f.callbacks().lost?.(); f.frame(); expect(f.client.sendInput).not.toHaveBeenCalled();
  expect(f.context.sources[0].stop).toHaveBeenCalled(); expect(f.capture.stop).toHaveBeenCalledWith(false);
  const next = { ...f.response, connectionEpoch: 2 };
  f.callbacks().recovered?.(next);
  f.event({ type: 'session.ready', limits: next.limits, effectiveAudioSettings: next.effectiveAudioSettings }, 2);
  await settle(); expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', connection: 'connected', resumeRequired: true });
  expect(f.capture.start).toHaveBeenCalledTimes(1);
  await f.controller.resume(); f.frame(); expect(f.capture.start).toHaveBeenCalledTimes(2);
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', resumeRequired: false });
  expect(f.playback.progress().playedSamples).toBe(0);
  f.controller.exit(); await settle();
});
it('permission/device/provider/recovery errors leave usable text and do not display arbitrary error payloads', async () => {
  for (const code of ['MICROPHONE_DENIED', 'MICROPHONE_LOST', 'STT_UNAVAILABLE', 'TTS_UNAVAILABLE', 'VOICE_RECONNECT_TIMEOUT']) {
    const f = liveVoiceFixture(); await f.begin(); f.callbacks().error?.(code); await settle();
    expect(f.controller.getSnapshot().phase).toBe('idle'); expect(f.draft()).toBe('Unsent original');
    expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1);
  }
  const f = liveVoiceFixture(); f.capture.start.mockRejectedValueOnce(new Error('HIDDEN_SPEECH_OR_SECRET'));
  await f.controller.start({ text: 'Unsent original', start: 0, end: 0, direction: 'none' }, null, f.config); await settle();
  expect(JSON.stringify(f.controller.getSnapshot())).not.toContain('HIDDEN_SPEECH_OR_SECRET');
  expect(f.controller.getSnapshot().phase).toBe('idle');
});
it('suspends blocked playback until a user gesture; visible state alone never restarts capture', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.context.state = 'suspended'; f.audio(); await settle();
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', resumeRequired: true });
  expect(f.capture.start).toHaveBeenCalledTimes(1);
  await f.controller.resume(); expect(f.context.resume).toHaveBeenCalledTimes(2);
  expect(f.controller.getSnapshot().phase).toBe('active'); f.controller.exit(); await settle();
});
it('hiding during an explicit resume fences the pending fresh capture and cannot unmute it later', async () => {
  const f = liveVoiceFixture(); await f.begin(); f.controller.suspend(); await settle();
  let granted!: () => void;
  f.capture.start.mockImplementationOnce(() => new Promise<void>(resolve => { granted = resolve; }));
  const resuming = f.controller.resume(); f.controller.suspend(); granted(); await resuming; await settle();
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', resumeRequired: true, inputBusy: false });
  f.frame(); expect(f.client.sendInput).not.toHaveBeenCalled();
  expect(f.capture.stop).toHaveBeenCalledTimes(2); f.controller.exit(); await settle();
});
it('early duration/idle warnings are operational warnings rather than false terminal outcomes', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'session.warning', code: 'VOICE_DURATION_LIMIT', recovery: 'none', recoverable: true });
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', notice: 'Voice will end soon. You can return to text at any time.' });
  f.event({ type: 'session.warning', code: 'VOICE_IDLE_TIMEOUT', recovery: 'none', recoverable: true });
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', notice: 'Are you still there? Speak to keep voice active.' });
  f.controller.exit(); await settle();
});
it('late successful session creation after exit is ended once and cannot reopen capture or the panel', async () => {
  const f = liveVoiceFixture(); let created!: (value: typeof f.response) => void;
  f.http.create.mockImplementationOnce(() => new Promise(resolve => { created = resolve; }));
  const starting = f.controller.start({ text: 'Unsent original', start: 0, end: 0, direction: 'none' }, null, f.config);
  await settle(); f.controller.exit(); created(f.response); await starting; await settle();
  expect(f.http.end).toHaveBeenCalledExactlyOnceWith(f.response.sessionId);
  expect(f.client.connect).not.toHaveBeenCalled(); expect(f.controller.getSnapshot().phase).toBe('idle');
});
it('an unconfirmed remote end is operational feedback, not a claim of confirmed server cleanup', async () => {
  const f = liveVoiceFixture(); await f.begin(); f.http.end.mockRejectedValueOnce(new Error('private provider details'));
  f.controller.exit(); await settle();
  expect(f.controller.getSnapshot().phase).toBe('idle');
  expect(f.controller.getSnapshot().notice).toContain('stopped locally');
  expect(f.controller.getSnapshot().notice).not.toContain('private provider details');
});
```

- [ ] **5.9 Run RED:** `npm test -- src/features/voice/state/live-voice-controller.test.ts -t "hiding during permission"`. Expected: Task 1 proceeds to `http.create` (or ends incorrectly); the other recovery tests check already-required behavior.
- [ ] **5.10 Fix that activation race at its shared lifecycle boundary.** At the start of `suspend`, immediately after obtaining `run`, insert this guard **before** setting `needsGesture`:

```typescript
if (run && (this.view.phase === 'requesting_permission' || this.view.phase === 'connecting')) {
  this.exit('error', 'Voice startup was paused. Your draft is unchanged; start voice again when ready.');
  return;
}
```

This fences late permission/HTTP callbacks, releases the lease, and returns usable text; an unestablished session is not pretend-resumable. Keep `start`'s late successful create/end branch and P4's late permission track-release behavior.

Also attach a rejection handler to the pending mute acknowledgment **before** any synchronous control failure can throw, so a capture timeout cannot produce an unhandled rejection after exit. Replace Task 1's muted branch with:

```typescript
await Promise.all([
  capture.setMuted(true),
  Promise.resolve().then(() => {
    if (this.current(run) && !run.client!.control({ type: 'input.mute' })) throw new Error('VOICE_CONNECT_TIMEOUT');
  }),
]);
```

The source reset still starts first. Never send buffered muted audio. Add this exact regression to the same test file and run it RED before replacing that branch:

```typescript
it('a failed mute control still awaits the source reset rejection and ends without leaving a live lease', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.capture.setMuted.mockRejectedValueOnce(new Error('CAPTURE_TIMEOUT')); f.client.control.mockReturnValueOnce(false);
  await expect(f.controller.toggleMute()).resolves.toBeUndefined(); await settle();
  expect(f.controller.getSnapshot().phase).toBe('idle');
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1);
});
```

- [ ] **5.11 Run GREEN:** `npm test -- src/features/voice/state src/features/voice/live/live-voice-lifecycle.test.ts`. Expected: actual discovered tests pass, no unhandled rejection or leftover timers. Do not hide failures with a global unhandled-rejection handler.

### 5C — Real P4 transport/playback + P7 lease/navigation composition

- [ ] **5.12 Add `frontend/src/features/voice/live/live-voice-composition.test.ts`.** P4's real client owns event sequence/epoch/cancellation and bounded reconnect; real playback owns the cursor. P7's actual action/dispatch lease, not a pretend submit spy, proves navigation cleanup. No WebSocket/provider/database traffic leaves the fixture.

```typescript
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../api/client.ts';
import { VoiceClient } from '../../../api/voice-client.ts';
import { ChatProvider, useChat } from '../../chat/state/chat-context.tsx';
import { FakeSocket, control, ready, session, output } from '../transport/testing/voice-fakes.ts';
import { liveVoiceFixture, settle } from '../state/testing/live-voice-fixture.ts';
afterEach(() => vi.useRealTimers());

it('real client drops late interrupted frames, preserves listening/mute, and reports the actual audible cursor', async () => {
  const socket = new FakeSocket();
  const f = liveVoiceFixture({ client: options => new VoiceClient({ ...options,
    pageUrl: 'https://aurvin.example/chat', socket: () => socket.asSocket() }) });
  await f.controller.start({ text: 'Unsent original', start: 7, end: 15, direction: 'backward' }, null, f.config);
  socket.open(); socket.receive(ready()); await settle();
  socket.receive(control({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 }, 1));
  socket.receive(output()); f.context.currentTime = 0.05;
  expect(f.controller.getSnapshot()).toMatchObject({ input: 'listening', agent: 'speaking' });
  f.controller.interrupt(); socket.receive(output(1, 100));
  expect(f.context.sources).toHaveLength(1);
  const sent = socket.sent.filter((value): value is string => typeof value === 'string').map(value => JSON.parse(value));
  expect(sent.find(value => value.type === 'response.interrupt')).toMatchObject({ responseId: 'r1', playedSamples: 1200, playbackPositionMs: 50 });
  await f.controller.toggleMute(); f.frame();
  expect(socket.sent.filter(value => value instanceof Uint8Array)).toHaveLength(0);
  await f.controller.toggleMute(); f.frame();
  expect(socket.sent.filter(value => value instanceof Uint8Array)).toHaveLength(1);
  f.controller.exit(); await settle(); expect(socket.close).toHaveBeenCalledTimes(1); expect(f.draft()).toBe('Unsent original');
});

it('real client reauthorizes with the original key and bound conversation; ten-second failure exits without replay', async () => {
  vi.useFakeTimers(); const sockets = [new FakeSocket(), new FakeSocket()]; let index = 0;
  const f = liveVoiceFixture({ client: options => new VoiceClient({ ...options, random: () => 0.5,
    pageUrl: 'https://aurvin.example/chat', socket: () => sockets[index++].asSocket() }) });
  await f.controller.start({ text: 'Unsent original', start: 0, end: 0, direction: 'none' }, null, f.config);
  sockets[0].open(); sockets[0].receive(ready()); await settle();
  sockets[0].receive(control({ type: 'conversation.bound', conversationId: 'voice-chat' }, 1));
  const originalKey = f.http.create.mock.calls[0][0].idempotencyKey;
  f.http.create.mockResolvedValueOnce({ ...session(2), conversationId: 'voice-chat' });
  sockets[0].lose(); await vi.advanceTimersByTimeAsync(250);
  expect(f.http.create.mock.calls[1][0]).toMatchObject({ idempotencyKey: originalKey, conversationId: 'voice-chat', mode: 'live' });
  // Second socket never becomes ready: P4's original total recovery deadline must win.
  await vi.advanceTimersByTimeAsync(10_000); await settle();
  expect(f.controller.getSnapshot().phase).toBe('idle');
  expect(f.capture.start).toHaveBeenCalledTimes(1); expect(f.draft()).toBe('Unsent original');
  expect(sockets.flatMap(socket => socket.sent).filter(value => value instanceof Uint8Array)).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('actual P7 dispatch closes voice before same-null New Chat and stale text submit remains fenced', async () => {
  let context!: ReturnType<typeof useChat>;
  const fetcher = vi.fn(async () => new Response('{}', { status: 500 }));
  function Child() { context = useChat(); return null; }
  renderToStaticMarkup(createElement(ChatProvider, { client: new ApiClient({ fetch: fetcher }), children: createElement(Child) }));
  const staleSubmit = context.actions.submitMessage;
  const f = liveVoiceFixture({ bindings: {
    claimVoiceInput: context.actions.claimVoiceInput,
    writeVoiceDraft: context.actions.writeVoiceDraft,
    releaseVoiceInput: context.actions.releaseVoiceInput,
    bindVoiceConversation: (_token, _id) => { throw new Error('P7_BINDING_SEAM_REQUIRED'); },
    refreshSessions: () => { void context.actions.loadSessions(); },
  } });
  await f.begin(); await staleSubmit('must not submit'); expect(fetcher).not.toHaveBeenCalled();
  context.dispatch({ type: 'NEW_CHAT' });
  expect(f.capture.stop).toHaveBeenCalledWith(false); expect(f.client.dispose).toHaveBeenCalledTimes(1);
  expect(context.actions.isVoiceInputLocked()).toBe(false); await settle();
  expect(f.controller.getSnapshot().restoreDraft).toBeNull();
});
```

Task 1's fixture HTTP spy already has production argument types, so these `mock.calls` checks compile without casts. The navigation composition calls the actual P7 claim/write/release methods explicitly. Its `bindVoiceConversation` callback is a temporary blocker until the serialized P7 follow-up adds that method; then replace the throwing callback with `context.actions.bindVoiceConversation` and add a real accepted-ID assertion. Never cast `context.actions` to invent the method.

- [ ] **5.13 Run composition verification:** `npm test -- src/features/voice/live/live-voice-composition.test.ts`. Expected GREEN after earlier steps; any RED is a real cross-boundary defect, not permission to alter the wire contract or fake away the production client. Correct only the shared P8 path shown above; upstream defects return to P4/P7/P5/P6 owners with the failing fixture and expected behavior.
- [ ] **5.14 Run complete frontend verification:** `npm test`; `npm run build`; `npm run lint`. Expected: discovered suites pass, no unhandled rejection/leaked timer, build/lint succeed. Report actual discovered counts and any failures/skips; no empty or skipped suite is evidence. Do not run unrelated backend/native/paid checks for this frontend implementation.
- [ ] **5.15 Commit exact task paths, serialized:**

```powershell
git add frontend/src/features/voice/live/live-voice-lifecycle.ts frontend/src/features/voice/live/live-voice-lifecycle.test.ts frontend/src/features/voice/live/live-voice-composition.test.ts frontend/src/features/voice/live/LiveVoicePanel.tsx frontend/src/features/voice/live/LiveVoiceControls.tsx frontend/src/features/voice/state/useLiveVoice.ts frontend/src/features/voice/state/live-voice-controller.ts frontend/src/features/voice/state/live-voice-controller.test.ts frontend/src/features/voice/state/testing/live-voice-fixture.ts frontend/src/features/chat/ChatView.tsx
git commit -m "test(voice): verify foreground recovery focus and real transport composition"
```

## Required browser follow-through / evidence boundaries

P10 assembles the default-off feature; P11 owns actual browser/device/accessibility/provider measurements. The following procedures are **unrun** by this plan and must not be reported as passed by SSR, mocked gestures, or CSS assertions:

1. Fixture-backed assembled app: independently enable neither/dictation/live/both through server config; test centered and docked entries. On load/disabled config there is no microphone prompt. Enter live from a composer with selected Unicode draft text; transcript/composer disappear from the DOM and accessibility tree, and no hidden voice text appears in header/sidebar/previews/attributes or when exiting.
2. Keyboard: Tab/Enter/Space reach both voice entries and all live controls; entry focuses the heading once. Mute toggles its pressed state; Escape stops an identifiable reply; Alt+M/Alt+X work only while focus is inside the panel. Sidebar navigation remains usable, no trap exists, and IME/editor/held-key events do not trigger controls. User Exit/error restores the matching draft selection after DOM commit; navigation cleanup never pulls focus back to the previous chat.
3. Reduced motion and 200% zoom/mobile/short landscape: bubble is static but all labels remain clear, controls wrap and scroll, focus is visible, and hover/focus tooltips expose only operational hints. Assistive technology announces state changes but never transcript/response text or every progress poll. A user unable to use voice can always return to text.
4. Permission denied/unsupported browser/audio playback blocked/device loss: useful fixed notices and text remain usable. Blocked playback offers an explicit Resume voice gesture. Hide during permission/worklet/HTTP startup and deliver late success: no microphone/socket/panel reopens. Verify actual track release with P4's hardware hooks, not solely a mock `stop` call.
5. Speaking and listening concurrently: capture continues during replies; mute discards source/unsent buffers without stopping playback; unmute transmits only fresh post-acknowledgment samples. Stop speaking clears local audio before its control, drops late response frames, remains live, and reports actual played audio, not downloaded/queued bytes. Measure p95 interruption-to-silence against the goal's 250 ms target on real hardware; Node has no latency claim.
6. Background/freeze suspends both directions/discards unfinished input. Becoming visible, restoring from BFCache, or reconnecting never silently restarts audio; require Resume voice or a fresh entry as applicable. Pagehide/unmount/New Chat/selection/active deletion/device changes end resources; deleting an unrelated session leaves the active voice session unchanged. Repeated enter/exit must leave no active media tracks, nodes, socket listeners, progress timers, or stale draft updates.
7. Network loss: bounded P4 backoff reuses the session/key and updates the epoch/bound conversation, resets the new provider playback origin only then, and never replays PCM or repeats inference. Recoverable pause explains repeating lost **speech**, not replaying a completed request. Timeout restores text/draft. TTS/STT/quota/session-duration/idle failures retain finalized backend results and hidden serialization; no client reinference/retry is introduced.
8. Internal New Chat voice turns bind one durable conversation only on accepted input. Exit/text follow-up stays on that ID; neutral navigation metadata contains no transcript. Across-tab text/live exclusion is P5/P6 evidence and cannot be certified by this single-tab controller.

Real devices/Deepgram checks require explicit operator authorization, bounded spend/data exposure, and the target Chrome/Edge/Firefox/Safari/iOS Safari/Android Chrome devices. Missing hardware, assembly, credentials, or budget is a blocked prerequisite, never an implicit pass. No public deployment or flag enablement is authorized by writing this plan.

## Acceptance coverage and worker handoff

| Requirement | Local planned check | Separate owner/evidence |
| --- | --- | --- |
| A1 text regression | ChatView legacy branch, full existing frontend suite | P11 assembled text regression |
| A2 explicit activation/denial | Controller immediate-gesture/no-allocation/late-start/error checks | P4 actual track release; P11 real permissions |
| A7 dedicated voice-only surface | Actual ChatView SSR omits composer/transcript/secret text; panel has only operational state | P2/P6 filtered archives/wire; P11 DOM/AT/audible path |
| A9/V4 interruption | Real playback/transport composition, played cursor, invalidate before transport | P3/P5/P6 delivered speech reconciliation; P11 250 ms/echo |
| A12 mute/unmute | Source-reset/transport frame gates, duplex state, controls pressed status | P4 real buffered-source discard; P11 devices |
| A13 draft/exit/no transcript | Token-fenced exact draft restore, late-event cleanup, caret helper and ChatView exit branch | P7 binding seam; P2/P6 hidden serialization |
| A14 recovery | Same-key/epoch reauthorization, timeout, blocked audio gesture, fixed error notices | P5/P6 durable outcomes/no reinference; P11 service/device faults |
| A17/V11 foreground/navigation | Actual listeners, synchronous P7 navigation composition, startup race fence/unmount cleanup | P11 foreground/BFCache/route/media checks |
| A18 accessibility | Native names/buttons/pressed status, no trap, panel shortcuts, reduced-motion CSS and focus helpers | P11 real browser/AT/device matrix |
| V10 operational limits | Consume bounded negotiated config and stable warnings/terminal errors | P9 server timers/quota enforcement and P11 measurements |

Return to the orchestrator: exact implementation commit list, red/green discovery counts, full frontend build/lint/test results and limitations; confirmed P7 binding handoff commit; P10 hook/entry/refresh composition contract; P11 browser procedures and current pre-audio Stop speaking protocol ceiling. Do not edit workflow state yourself. Distinguish implemented, locally tested, blocked/unrun hardware/service evidence, and review **skipped**.

## Planner self-consistency check

- Five requested tasks map to state/hook, waveform/panel, controls, ChatView/navigation/draft preservation, and lifecycle/component/composition verification.
- Every task contains runnable failing tests, an explicit RED command, concrete minimal implementation, GREEN verification, and named-file commit commands. Task 5's startup race/listener/helper tests intentionally fail before its implementation; later composition cases validate already-built behavior.
- Types match the actual P1/P4 names (`VoiceServerEvent`, `VoiceResponseRef`, `CreateVoiceSessionResponse`, `playedSamples`, `connectionEpoch`, `firstAudioSequence`); no research-era unversioned transcript event or fake playback offset is used.
- Only P8 paths are assigned for writes. P7's missing bind action and P10's central entry registration are explicit owner handoffs, not silent cross-owner edits or a source-presence readiness claim.
- Local document links resolve to existing workflow artifacts. Review remains skipped; tools/authentication/captions/provider provisioning/paid tests remain outside this plan.
