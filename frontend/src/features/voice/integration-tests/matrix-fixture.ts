/**
 * ============================================================================
 * FILE: matrix-fixture.ts
 * LOCATION: frontend/src/features/voice/integration-tests/matrix-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compose the real LiveKit voice client/controller with deterministic SDK doubles.
 *
 * ROLE IN PROJECT:
 *    Drives frontend integration regressions through the assembled live transport
 *    without a browser, microphone, SFU, network connection, or PCM live fallback.
 *
 * KEY COMPONENTS:
 *    - matrixFixture: Permission, session, Room, and control-channel test harness.
 *    - event/begin/advance: Deterministic reliable-control and virtual-clock helpers.
 * ============================================================================
 */

import { vi } from 'vitest';
import { RoomEvent } from 'livekit-client';
import { LiveKitVoiceClient, type LiveKitVoiceClientOptions } from '../../../api/livekit-voice-client.ts';
import { liveSession, rtcFixture, remoteAudioTrack } from '../../../api/testing/livekit-fakes.ts';
import { INPUT_AUDIO, OUTPUT_AUDIO, LIVEKIT_CONTROL_TOPIC, encodeVoiceControlPackets,
  livekitAgentIdentity, type CreateVoiceSessionResponse, type PublicVoiceConfig,
  type VoiceServerPayload } from '../../../api/voice-protocol.ts';
import { LiveVoiceController, type LiveVoiceControllerPorts }
  from '../state/live-voice-controller.ts';
import { settle } from '../state/testing/live-voice-fixture.ts';

export function matrixFixture(permission: 'granted' | 'denied',
  overrides: Partial<Pick<LiveVoiceControllerPorts, 'http' | 'bindings'>> = {},
  response: CreateVoiceSessionResponse = liveSession(),
  clientOptions: LiveKitVoiceClientOptions = {}) {
  const rtc = rtcFixture();
  if (permission === 'denied') rtc.microphone.mockRejectedValue(
    new DOMException('fixture denial', 'NotAllowedError'));
  const config: PublicVoiceConfig = { protocolVersion: 1,
    enabledModes: { dictation: true, live: true }, supportedLocales: ['en-US'],
    limits: { ...response.limits }, inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO };
  let draft = 'Unsent original', owner: string | null = null;
  let close: (() => void) | undefined;
  const sequences = new Map([[response.connectionEpoch, 0]]);
  const http = {
    create: vi.fn<LiveVoiceControllerPorts['http']['create']>(async () => structuredClone(response)),
    end: vi.fn(async (_id: string) => {}),
  };
  const bindings = {
    claimVoiceInput: vi.fn((_mode: 'live', callback: () => void): string | null => {
      if (owner) return null; owner = 'lease-1'; close = callback; return owner;
    }),
    writeVoiceDraft: vi.fn((token: string, text: string) => {
      if (token !== owner) return false; draft = text; return true;
    }),
    releaseVoiceInput: vi.fn((token: string) => { if (token === owner) owner = null; }),
    bindVoiceConversation: vi.fn((token: string, _id: string) => token === owner),
    refreshSessions: vi.fn(),
  };
  let client!: LiveKitVoiceClient;
  const controller = new LiveVoiceController({ http: overrides.http ?? http,
    bindings: overrides.bindings ?? bindings, support: () => true,
    client: callbacks => {
      client = new LiveKitVoiceClient({ ...callbacks, ...rtc.options,
        random: () => 0.5, ...clientOptions });
      return client;
    } });
  const event = (payload: VoiceServerPayload, epoch = response.connectionEpoch) => {
    const n = sequences.get(epoch) ?? 0;
    sequences.set(epoch, n + 1);
    const json = JSON.stringify({ protocolVersion: 1, sessionId: response.sessionId,
      connectionEpoch: epoch, eventId: `integration-${n}`, sequence: n, ...payload });
    for (const bytes of encodeVoiceControlPackets(json, 'server', 'live')) {
      rtc.emit(RoomEvent.DataReceived, bytes,
        { identity: livekitAgentIdentity(response.sessionId) }, 0, LIVEKIT_CONTROL_TOPIC);
    }
  };
  const listening = () => event({ type: 'voice.state', input: 'listening',
    agent: 'idle', connection: 'connected' });
  const start = async () => {
    await controller.start({ text: draft, start: 7, end: 15, direction: 'backward' }, null, config);
    await settle();
  };
  const begin = async () => {
    await start();
    event({ type: 'session.ready', limits: response.limits,
      effectiveAudioSettings: response.effectiveAudioSettings });
    await settle(); listening(); await settle();
  };
  const track = remoteAudioTrack();
  const attach = () => rtc.emit(RoomEvent.TrackSubscribed, track, {},
    { identity: livekitAgentIdentity(response.sessionId) });
  return { controller, config, response, http, bindings, rtc, track, attach,
    client: () => client, event, listening, start, begin,
    draft: () => draft, close: () => close?.(),
    advance: async (ms: number) => {
      rtc.clock.value += ms; await vi.advanceTimersByTimeAsync(ms); await settle();
    } };
}
