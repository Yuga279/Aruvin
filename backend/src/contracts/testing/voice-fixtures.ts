/**
 * ============================================================================
 * FILE: voice-fixtures.ts
 * LOCATION: backend/src/contracts/testing/voice-fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide reusable deterministic fixtures for voice contract testing.
 *
 * ROLE IN PROJECT:
 *    Supplies fresh golden audio frames, control event catalogs, mock environments,
 *    and delivery record factories for unit and contract testing.
 *
 * KEY COMPONENTS:
 *    - goldenInputFrame / goldenOutputFrame: Raw binary PCM frames
 *    - clientControls / serverControls: Catalog of all valid voice control events
 *    - disabledVoiceEnvironment / enabledVoiceEnvironment: Mock env maps
 *    - deliveryFixture / createSessionFixture: Factory functions for schemas
 * ============================================================================
 */

import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO,
  livekitRoomName, livekitParticipantIdentity,
  type VoiceMode, type VoiceClientEvent, type VoiceServerEvent,
  type CreateVoiceSessionRequest, type CreateVoiceSessionResponse,
  type VoiceLiveKitTransport, type CanvasArtifactPayload } from '../voice-wire.js';
import type { LiveKitConfig } from '../config-runtime.js';

export const goldenInputFrame = () => new Uint8Array([
  175, 1, 1, 0, 7, 0, 0, 0, 80, 0, 0, 0, 4, 0, 0, 0, 0, 128, 255, 127,
]);
export const goldenOutputFrame = () => new Uint8Array([
  175, 1, 2, 0, 3, 0, 0, 0, 200, 0, 0, 0, 2, 0, 0, 0, 255, 127,
]);
export function createSessionFixture(mode: VoiceMode): CreateVoiceSessionRequest {
  return { protocolVersion: 1, mode, conversationId: null, locale: 'en-US', idempotencyKey: 'voice-fixture-1' };
}
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

// Server-only fixtures below this marker; never mirror into frontend.
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
export const deliveryFixture = () => ({ schemaVersion: 1 as const, kind: 'voice-delivery' as const,
  userId: 'user-1', sessionId: 'chat-1', voiceSessionId: 'voice-1', turnId: 'turn-1',
  attemptId: 'attempt-1', responseId: 'response-1', eventId: 'delivery-1', sequence: 1,
  speechId: null, providerSocketId: 'provider-socket-1', status: 'unknown' as const,
  audioDurationMs: null, audioPlayedMs: null, playedSamples: null,
  textGenerated: 'Hello.', textSpoken: null, textRemaining: null,
  createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' });
