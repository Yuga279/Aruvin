/**
 * ============================================================================
 * FILE: live-voice-composition.test.ts
 * LOCATION: frontend/src/features/voice/live/live-voice-composition.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Assembled composition tests for LiveVoiceController over the real P4
 *    LiveKitVoiceClient, the rtcFixture SDK/media doubles, and P7 ChatProvider.
 *
 * ROLE IN PROJECT:
 *    Proves the live hook never constructs the dictation PCM path, that one Room
 *    carries one native microphone publication and one reliable Aurvin control
 *    channel, that every server control arrives through SDK `DataReceived`, that
 *    reported playout progress is the client's proven output cursor, that a local
 *    interruption silences the element before the reliable interrupt is published,
 *    and that mute/Canvas continuity never reconnects, recaptures, or stops output.
 *    ChatProvider draft/lease, navigation hang-up, and Canvas dismissal coverage is
 *    retained. Dictation keeps its own transport suites and is not composed here.
 *
 * KEY COMPONENTS:
 *    - Static hook composition guard over useLiveVoice.ts (readFileSync)
 *    - Real LiveKitVoiceClient + rtcFixture composition (join, progress, interrupt,
 *      mute, Canvas continuity, bounded recovery failure)
 *    - ChatProvider dispatch/navigation lease and Canvas surface tests
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { RoomEvent } from 'livekit-client';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../api/client.ts';
import { LiveKitVoiceClient } from '../../../api/livekit-voice-client.ts';
import { liveSession, remoteAudioTrack, rtcFixture } from '../../../api/testing/livekit-fakes.ts';
import type {
  CreateVoiceSessionResponse,
  VoiceClientPayload,
  VoiceServerPayload,
} from '../../../api/voice-protocol.ts';
import { ChatProvider, useChat } from '../../chat/state/chat-context.tsx';
import { ChatView } from '../../chat/ChatView.tsx';
import type { LiveVoiceBindings } from '../state/live-voice-controller.ts';
import { liveVoiceFixture, settle } from '../state/testing/live-voice-fixture.ts';

afterEach(() => vi.useRealTimers());

type Rtc = ReturnType<typeof rtcFixture>;
const draft = { text: 'Unsent original', start: 7, end: 15, direction: 'backward' as const };
const listening = { type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' } as const;

/**
 * Composes one real live transport over deterministic SDK doubles.
 *
 * `liveVoiceFixture` accepts but ignores a `client` override (it keeps its in-memory
 * client for the P8-owned callers), so the production composition is installed on the
 * port the controller receives: one `LiveKitVoiceClient` built from the fixture's
 * callbacks plus rtcFixture Room/mic/element/clock doubles, exactly like
 * `useLiveVoice`'s `client: callbacks => new LiveKitVoiceClient(callbacks)`.
 * Server controls are fed through `DataReceived`, never through fixture callbacks.
 */
function composeLive(scene: Rtc, bindings?: LiveVoiceBindings) {
  const f = bindings ? liveVoiceFixture({ bindings }) : liveVoiceFixture();
  const port = f.client;
  let live: LiveKitVoiceClient | undefined;
  const transport = (): LiveKitVoiceClient => (live ??= new LiveKitVoiceClient({
    ...f.callbacks(), random: () => 0.5, room: scene.options.room,
    microphone: scene.options.microphone, element: scene.options.element, clock: scene.options.clock }));
  Object.assign(port, {
    prepare: vi.fn(() => transport().prepare()),
    connect: vi.fn((response: CreateVoiceSessionResponse) => transport().connect(response)),
    control: vi.fn((payload: Exclude<VoiceClientPayload, { type: 'session.start' }>) => transport().control(payload)),
    setInputEnabled: vi.fn((enabled: boolean) => transport().setInputEnabled(enabled)),
    stopInput: vi.fn(() => transport().stopInput()),
    unlock: vi.fn(() => transport().unlock()),
    invalidate: vi.fn((responseId?: string) => transport().invalidate(responseId)),
    progress: vi.fn(() => transport().progress()),
    isDrained: vi.fn(() => transport().isDrained()),
    dispose: vi.fn(() => transport().dispose()),
  });
  // `session.ready` is sequence 0 on a fresh generation; later controls follow in order.
  let sequence = 1;
  const feed = (payload: VoiceServerPayload) => scene.event(payload, sequence++);
  /** start -> prepare -> HTTP create -> connect -> ready -> listening, all reliable. */
  const begin = async () => {
    await f.controller.start(draft, null, f.config);
    scene.ready();
    await settle();
    feed(listening);
    await settle();
  };
  return { f, begin, feed };
}

it('composes live without constructing the dictation PCM path', () => {
  const source = readFileSync(new URL('../state/useLiveVoice.ts', import.meta.url), 'utf8');
  expect(source).toContain('new LiveKitVoiceClient(');
  expect(source).not.toContain('new VoiceClient(');
  expect(source).not.toContain('new AudioCaptureService(');
  expect(source).not.toContain('new AudioPlaybackService(');
});

it('joins one Room once, publishes one native mic, and reports only proven playout progress', async () => {
  vi.useFakeTimers();
  const scene = rtcFixture();
  const { f, begin, feed } = composeLive(scene);
  await begin();

  // One admitted Room, one gesture audio unlock, one captured and published mic.
  expect(scene.room.connect).toHaveBeenCalledTimes(1);
  expect(scene.room.connect).toHaveBeenCalledWith(liveSession().livekit.url,
    liveSession().livekit.participantToken, expect.objectContaining({ autoSubscribe: false }));
  expect(scene.room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
  expect(scene.room.localParticipant.publishTrack).toHaveBeenCalledWith(scene.mic, { source: 'microphone' });
  expect(scene.room.startAudio).toHaveBeenCalled();
  expect(scene.microphone).toHaveBeenCalledTimes(1);
  expect(scene.mediaTrack.enabled).toBe(true); // the listening ack enabled the native track

  // `session.start` is the first reliable packet, addressed to this session's agent.
  expect(scene.packets()[0]).toMatchObject({ type: 'session.start', mode: 'live', sessionId: 'v1',
    connectionEpoch: 1, sequence: 0 });
  expect(scene.participant.publishData.mock.calls[0][1]).toEqual({ reliable: true,
    topic: 'aurvin.voice.control', destinationIdentities: ['aurvin-agent:v1'] });
  expect(scene.packets().map(packet => packet.type)).toEqual(['session.start', 'input.unmute']);
  expect(scene.room.disconnect).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', connection: 'connected', input: 'listening' });

  // Ready/listening arrived through DataReceived: no second join and no reconnect.
  scene.emit(RoomEvent.TrackSubscribed, remoteAudioTrack(), {}, { identity: 'aurvin-agent:v1' });
  feed({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 });
  feed({ type: 'audio.watermark', turnId: 't1', responseId: 'r1', firstAudioSample: 0,
    queuedSamples: 2400, lastAudioSample: 2400, final: false });
  expect(scene.audio.muted).toBe(false);
  const progress = () => scene.packets().filter(packet => packet.type === 'playback.progress').at(-1);
  await vi.advanceTimersByTimeAsync(100); // first poll anchors the output observation
  expect(progress()).toMatchObject({ playedSamples: 0 });
  scene.clock.value += 100; // 100 ms of real output at the 24 kHz reference
  await vi.advanceTimersByTimeAsync(100);
  expect(progress()).toMatchObject({ turnId: 't1', responseId: 'r1', playedSamples: 2400, playedMs: 100 });
  expect(progress()).not.toHaveProperty('proof');
  expect(scene.room.connect).toHaveBeenCalledTimes(1);
  expect(scene.room.disconnect).not.toHaveBeenCalled();

  // Hang-up releases the one Room/mic once and keeps the unsent draft for the user.
  f.controller.exit();
  await settle();
  expect(vi.getTimerCount()).toBe(0);
  expect(f.draft()).toBe('Unsent original');
  expect(f.controller.getSnapshot().restoreDraft).toEqual(draft);
});

it('silences the attached element before the reliable interrupt and keeps late response audio inaudible', async () => {
  vi.useFakeTimers();
  const scene = rtcFixture();
  const { f, begin, feed } = composeLive(scene);
  const track = remoteAudioTrack();
  // Records the audible state at the instant each reliable control is published.
  const published: { packet: Record<string, unknown>; muted: boolean; paused: boolean; detached: boolean }[] = [];
  scene.participant.publishData.mockImplementation(async (bytes: Uint8Array) => {
    published.push({ packet: JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>,
      muted: scene.audio.muted, paused: scene.audio.paused, detached: track.detach.mock.calls.length > 0 });
    return undefined;
  });
  await begin();
  scene.emit(RoomEvent.TrackSubscribed, track, {}, { identity: 'aurvin-agent:v1' });
  feed({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 });
  feed({ type: 'audio.watermark', turnId: 't1', responseId: 'r1', firstAudioSample: 0,
    queuedSamples: 2400, lastAudioSample: 2400, final: false });
  await vi.advanceTimersByTimeAsync(100); // anchor the observation at clock 0
  scene.clock.value = 50; // 50 ms heard == 1200 samples of the 24 kHz reference

  f.controller.interrupt();
  expect(published.at(-1)).toMatchObject({ muted: true, paused: true, detached: true });
  expect(published.at(-1)!.packet).toMatchObject({ type: 'response.interrupt', turnId: 't1',
    responseId: 'r1', playbackPositionMs: 50, playedSamples: 1200 });
  expect(published.at(-1)!.packet).not.toHaveProperty('proof');
  expect(scene.audio.muted).toBe(true);
  expect(scene.audio.pause).toHaveBeenCalled();
  expect(track.detach).toHaveBeenCalledWith(scene.audio);
  expect(scene.audio.srcObject).toBeNull();

  // Stale media for the interrupted response is re-fenced and never becomes audible.
  published.length = 0;
  feed({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 });
  feed({ type: 'audio.watermark', turnId: 't1', responseId: 'r1', firstAudioSample: 0,
    queuedSamples: 2400, lastAudioSample: 2400, final: false });
  await settle();
  expect(published).toHaveLength(0);
  expect(scene.audio.muted).toBe(true);
  expect(scene.audio.paused).toBe(true);
  expect(scene.audio.srcObject).toBeNull();
  expect(track.detach.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(f.controller.getSnapshot().response).toBeNull();

  f.controller.exit();
  await settle();
});

it('keeps one Room, one mic, and one output across Canvas auto-open, mute, tab switch, and dismiss', async () => {
  const captured: { chat?: ReturnType<typeof useChat> } = {};
  const fetcher = vi.fn(async () => new Response('{"items":[]}', { status: 200 }));
  function Probe() { captured.chat = useChat(); return null; }
  const api = new ApiClient({ fetch: fetcher });
  renderToStaticMarkup(createElement(ChatProvider, { client: api, children: createElement(Probe) }));
  const chat = captured.chat!;
  const scene = rtcFixture();
  const openCanvasArtifact = vi.fn((artifactId: string) =>
    chat.dispatch({ type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId } }));
  const { f, begin, feed } = composeLive(scene, { ...chat.actions, refreshSessions: vi.fn(),
    bindVoiceConversation: vi.fn(() => true), openCanvasArtifact });
  await begin();

  // A pre-audio Canvas artifact arrives over reliable DataReceived and auto-opens.
  feed({ type: 'canvas.artifact', turnId: 'turn_1', responseId: 'resp_1', ordinal: 0, kind: 'mermaid',
    subType: 'Flowchart', title: 'Pipeline', rawSource: 'flowchart TD\n  Mic --> Filter --> Canvas' });
  await settle();
  // Auto-open is the real P7 dispatch: the controller hired the ChatProvider action.
  expect(openCanvasArtifact).toHaveBeenCalledExactlyOnceWith('resp_1::canvas::0');
  expect(f.controller.getSnapshot().artifacts).toHaveLength(1);

  feed({ type: 'audio.start', turnId: 'turn_1', responseId: 'resp_1', sampleRate: 24000,
    firstAudioSequence: 0, firstAudioSample: 0 });
  scene.emit(RoomEvent.TrackSubscribed, remoteAudioTrack(), {}, { identity: 'aurvin-agent:v1' });
  expect(scene.audio.muted).toBe(false);
  expect(scene.audio.paused).toBe(false);
  feed({ type: 'canvas.artifact', turnId: 'turn_1', responseId: 'resp_1', ordinal: 1, kind: 'chart',
    subType: 'Line Graph', title: 'Frame Latency', rawSource: 'T1: 18\nT2: 15\nT3: 14' });
  await settle();
  expect(openCanvasArtifact).toHaveBeenLastCalledWith('resp_1::canvas::1');
  expect(f.controller.getSnapshot().artifacts).toHaveLength(2);

  // Auto-open neither reconnects the Room, recaptures the mic, nor stops output.
  expect(scene.room.connect).toHaveBeenCalledTimes(1);
  expect(scene.microphone).toHaveBeenCalledTimes(1);
  expect(scene.mic.stop).not.toHaveBeenCalled();
  expect(scene.room.disconnect).not.toHaveBeenCalled();
  expect(scene.audio.remove).not.toHaveBeenCalled();
  expect(scene.audio.muted).toBe(false);

  // Mute disables the native track synchronously and reports input.mute; output survives.
  await f.controller.toggleMute();
  expect(scene.mediaTrack.enabled).toBe(false);
  expect(scene.mic.mute).toHaveBeenCalled();
  expect(scene.packets().map(packet => packet.type)).toContain('input.mute');
  expect(f.controller.getSnapshot()).toMatchObject({ input: 'muted' });
  expect(scene.audio.muted).toBe(false);
  expect(scene.audio.pause).not.toHaveBeenCalled();

  // Unmute asks for the listening ack and only then enables the same native track.
  const beforeUnmute = scene.packets().length;
  await f.controller.toggleMute();
  expect(scene.packets().slice(beforeUnmute).map(packet => packet.type)).toContain('input.unmute');
  expect(scene.mediaTrack.enabled).toBe(false);
  expect(scene.microphone).toHaveBeenCalledTimes(1);
  feed(listening);
  await settle();
  expect(scene.mediaTrack.enabled).toBe(true);
  expect(scene.mic.unmute).toHaveBeenCalled();
  expect(f.controller.getSnapshot()).toMatchObject({ input: 'listening' });

  // Switch tabs and dismiss Canvas, then re-render the live surface over ChatProvider.
  chat.dispatch({ type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId: 'resp_1::canvas::0' } });
  chat.dispatch({ type: 'CLOSE_CANVAS' });
  const liveSurface = { view: f.controller.getSnapshot(), start: vi.fn(),
    toggleMute: () => f.controller.toggleMute(), interrupt: () => f.controller.interrupt(),
    exit: () => f.controller.exit(), resume: () => f.controller.resume() };
  const html = renderToStaticMarkup(createElement(ChatProvider,
    { client: api, children: createElement(ChatView, { liveVoice: liveSurface }) }));
  expect(html).toContain('aria-label="Open Canvas (2)"');
  expect(f.controller.getSnapshot().artifacts).toHaveLength(2);
  expect(scene.room.connect).toHaveBeenCalledTimes(1);
  expect(scene.microphone).toHaveBeenCalledTimes(1);
  expect(scene.audio.remove).not.toHaveBeenCalled();
  expect(scene.mic.stop).not.toHaveBeenCalled();

  f.controller.exit();
  await settle();
  expect(scene.mic.stop).toHaveBeenCalledTimes(1);
  expect(scene.room.disconnect).toHaveBeenCalledTimes(1);
});

it('a bounded recovery failure pauses the mounted call without recapturing or replaying', async () => {
  vi.useFakeTimers();
  const scene = rtcFixture();
  const { f, begin } = composeLive(scene);
  await begin();
  const idempotencyKey = f.http.create.mock.calls[0]![0].idempotencyKey;
  f.http.create.mockResolvedValueOnce({ ...liveSession(2) });

  scene.emit(RoomEvent.Disconnected);
  expect(scene.mediaTrack.enabled).toBe(false);
  expect(scene.mic.stop).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(250);
  expect(f.http.create).toHaveBeenCalledTimes(2);
  expect(f.http.create.mock.calls[1]![0]).toMatchObject({ idempotencyKey, mode: 'live' });
  // The new epoch joins control-only: no second capture and no second publication.
  expect(scene.microphone).toHaveBeenCalledTimes(1);
  expect(scene.room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
  expect(scene.mediaTrack.enabled).toBe(false);

  // The second epoch never becomes ready: P4's one total recovery deadline wins.
  await vi.advanceTimersByTimeAsync(10_000);
  await settle();
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: false });
  expect(f.draft()).toBe('Unsent original');
  expect(scene.room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);

  f.controller.exit();
  await settle();
  expect(vi.getTimerCount()).toBe(0);
});

it('actual P7 dispatch closes voice before same-null New Chat and stale text submit remains fenced', async () => {
  const captured: { context?: ReturnType<typeof useChat> } = {};
  const fetcher = vi.fn(async () => new Response('{}', { status: 500 }));
  function Child() { captured.context = useChat(); return null; }
  renderToStaticMarkup(createElement(ChatProvider, { client: new ApiClient({ fetch: fetcher }), children: createElement(Child) }));
  const context = captured.context!;
  const staleSubmit = context.actions.submitMessage;
  const f = liveVoiceFixture({ bindings: { ...context.actions, refreshSessions: vi.fn(), bindVoiceConversation: vi.fn(() => true) } });
  await f.begin(); await staleSubmit('must not submit'); expect(fetcher).not.toHaveBeenCalled();
  context.dispatch({ type: 'NEW_CHAT' });
  expect(f.client.setInputEnabled).toHaveBeenCalledWith(false);
  expect(f.client.stopInput).toHaveBeenCalledTimes(1);
  expect(f.client.dispose).toHaveBeenCalledTimes(1);
  expect(f.http.end).toHaveBeenCalledWith('v1');
  expect(context.actions.isVoiceInputLocked()).toBe(false);
  await settle();
  expect(f.controller.getSnapshot().restoreDraft).toBeNull();
  expect(f.http.end).toHaveBeenCalledTimes(1);
});
