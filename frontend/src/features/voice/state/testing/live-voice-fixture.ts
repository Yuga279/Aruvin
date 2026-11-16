/**
 * ============================================================================
 * FILE: live-voice-fixture.ts
 * LOCATION: frontend/src/features/voice/state/testing/live-voice-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Test fixture for LiveVoiceController tests and live voice integration.
 *
 * ROLE IN PROJECT:
 *    Provides one fake live WebRTC client (prepare/connect/control/input/unlock/
 *    invalidate/progress/isDrained/dispose) plus real P4 admission fixtures. The
 *    legacy PCM capture/playback surface is retained, deprecated, only so P8-owned
 *    callers keep compiling until they migrate; the live controller never uses it.
 *
 * KEY COMPONENTS:
 *    - liveVoiceFixture: Factory producing controller and test harnesses.
 *    - settle: Helper to wait for promise resolution cycles.
 * ============================================================================
 */

import { vi } from 'vitest';
import type { LiveKitVoiceClientOptions, LiveVoiceProgress } from '../../../../api/livekit-voice-client.ts';
import type { VoiceAudioFrame } from '../../../../api/voice-audio.ts';
import { liveSession } from '../../../../api/testing/livekit-fakes.ts';
import { INPUT_AUDIO, OUTPUT_AUDIO, DEFAULT_VOICE_LIMITS,
  type CreateVoiceSessionResponse, type PublicVoiceConfig, type VoiceClientPayload,
  type VoiceResponseRef, type VoiceServerPayload } from '../../../../api/voice-protocol.ts';
import { AudioPlaybackService } from '../../audio/audio-playback-service.ts';
import { FakeContext } from '../../audio/testing/audio-fakes.ts';
import { LiveVoiceController, type LiveVoiceBindings, type LiveVoicePorts } from '../live-voice-controller.ts';

export async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

type LiveVoiceFixtureOverrides = Omit<Partial<LiveVoicePorts>, 'capture' | 'playback' | 'client'> & {
  /** @deprecated PCM capture override; accepted for P8 type compatibility and ignored. */
  capture?: (options: any) => any;
  /** @deprecated PCM playback override; accepted for P8 type compatibility and ignored. */
  playback?: (maxQueueMs: number) => any;
  /** @deprecated WebSocket client override; accepted for P8 type compatibility and ignored. */
  client?: (options: any) => any;
};

function build(overrides: LiveVoiceFixtureOverrides) {
  const context = new FakeContext();
  const playback = new AudioPlaybackService(() => context.asContext());
  const response = liveSession();
  const config: PublicVoiceConfig = { protocolVersion: 1,
    enabledModes: { dictation: true, live: true }, supportedLocales: ['en-US'],
    limits: { ...DEFAULT_VOICE_LIMITS }, inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO };
  /** Live callbacks, plus the legacy PCM audio sink P8 helpers still call by hand. */
  type Callbacks = LiveKitVoiceClientOptions & {
    audio?: (frame: VoiceAudioFrame, ref: VoiceResponseRef) => void };
  let callbacks!: Callbacks;
  // @deprecated the live controller never calls the PCM `capture` port, so this stays unset;
  // the legacy frame()/gate() helpers below are inert no-ops by design.
  const legacyCapture: { callbacks?: Parameters<NonNullable<LiveVoicePorts['capture']>>[0] } = {};
  let sequence = 0, draft = 'Unsent original', owner: string | null = null;
  let selectedConversationId = response.conversationId;
  let close: (() => void) | undefined;
  // @deprecated legacy PCM doubles; never constructed by the controller.
  const capture = { start: vi.fn(async () => {}), setMuted: vi.fn(async (_muted: boolean, _maxPendingMs?: number) => {}),
    stop: vi.fn(async (_drain = false) => {}), setUploading: vi.fn() };
  const configureSessionQueue = vi.spyOn(playback, 'configureSessionQueue');
  const client = {
    prepare: vi.fn(async () => {}),
    connect: vi.fn(async (_session: CreateVoiceSessionResponse) => {}),
    control: vi.fn((_event: Exclude<VoiceClientPayload, { type: 'session.start' }>) => true),
    setInputEnabled: vi.fn(async (_enabled: boolean) => {}),
    stopInput: vi.fn(),
    unlock: vi.fn(async () => {}),
    invalidate: vi.fn((_responseId?: string) => {}),
    progress: vi.fn((): LiveVoiceProgress => ({ playedSamples: 0, playedMs: 0, proof: 'proven' })),
    isDrained: vi.fn(() => false),
    dispose: vi.fn(async () => {}),
    /** @deprecated P8-owned suites still read this PCM sender; live never calls it. */
    sendInput: vi.fn((_pcm?: Uint8Array, _flags?: 0 | 1) => true),
  };
  const http = {
    create: vi.fn(async (_request: Parameters<LiveVoicePorts['http']['create']>[0],
      _signal?: AbortSignal): Promise<CreateVoiceSessionResponse> => ({ ...response })),
    end: vi.fn(async (_id: string) => {}),
  };
  const bindings = {
    claimVoiceInput: vi.fn((_mode: 'live', onClose: () => void): string | null => {
      if (owner) return null; owner = 'lease-1'; close = onClose; return owner;
    }),
    writeVoiceDraft: vi.fn((token: string, text: string) => {
      if (owner !== token) return false; draft = text; return true;
    }),
    releaseVoiceInput: vi.fn((token: string) => { if (owner === token) owner = null; }),
    bindVoiceConversation: vi.fn((token: string, id: string) => {
      if (owner !== token) return false;
      selectedConversationId = id; return true;
    }),
    getActiveConversationId: () => selectedConversationId,
    refreshSessions: vi.fn(),
  };
  const controller = new LiveVoiceController({
    http: overrides.http ?? http,
    bindings: { ...bindings, ...overrides.bindings },
    client: options => {
      callbacks = options as Callbacks;
      // Legacy sink: best-effort so old fixture callers do not crash, never a live path.
      callbacks.audio = (frame, ref) => { try { playback.enqueue(ref.responseId, frame); } catch { /* legacy only */ } };
      return client;
    },
    ...(overrides.support ? { support: overrides.support } : {}),
  });
  const event = (payload: VoiceServerPayload, epoch = response.connectionEpoch) => {
    callbacks.event?.({ protocolVersion: 1, sessionId: response.sessionId, connectionEpoch: epoch,
      eventId: `event-${sequence}`, sequence: sequence++, ...payload });
  };
  const listening = () => event({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' });
  const begin = async () => {
    await controller.start({ text: draft, start: 7, end: 15, direction: 'backward' }, null, config);
    event({ type: 'session.ready', limits: response.limits, effectiveAudioSettings: response.effectiveAudioSettings });
    await settle();
    listening();
    await settle();
  };
  return { controller, config, response, context, playback, capture, configureSessionQueue, client, http, bindings, begin,
    event, callbacks: () => callbacks, captureCallbacks: () => legacyCapture.callbacks, draft: () => draft, close: () => close?.(),
    selectConversation: (id: string | null) => { selectedConversationId = id; },
    listening,
    // @deprecated legacy PCM helpers: inert unless a caller supplies a `capture` override.
    gate: (state: 'suspended' | 'speech') => legacyCapture.callbacks?.speechGate?.(state),
    frame: (buf?: Uint8Array) => legacyCapture.callbacks?.frame?.(buf ?? new Uint8Array(2560), 0),
    deviceLost: () => callbacks.microphoneLost?.(),
    audio: (id = 'r1', seq = 0, offsetMs = 0) => callbacks.audio?.(
      { kind: 2, flags: 0, sequence: seq, offsetMs, pcm: new Uint8Array(4800) },
      { turnId: 't1', responseId: id }) };
}

export type LiveVoiceFixture = ReturnType<typeof build>;

export function liveVoiceFixture(overrides?: Partial<LiveVoicePorts>): LiveVoiceFixture;
/** @deprecated P8-owned suites still pass PCM capture/playback/socket overrides; accepted for type compatibility until P8 migrates. */
export function liveVoiceFixture(overrides?: { capture?: (options: any) => any; playback?: (maxQueueMs: number) => any;
  client?: (options: any) => any; bindings?: LiveVoiceBindings; support?: () => boolean }): LiveVoiceFixture;
export function liveVoiceFixture(overrides: LiveVoiceFixtureOverrides = {}) { return build(overrides); }
