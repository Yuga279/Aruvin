/**
 * ============================================================================
 * FILE: voice-fixtures.ts
 * LOCATION: frontend/src/api/testing/voice-fixtures.ts
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
  type VoiceMode, type VoiceClientEvent, type VoiceServerEvent,
  type CreateVoiceSessionRequest, type CanvasArtifactPayload } from '../voice-protocol';

export const goldenInputFrame = () => new Uint8Array([
  175, 1, 1, 0, 7, 0, 0, 0, 80, 0, 0, 0, 4, 0, 0, 0, 0, 128, 255, 127,
]);
export const goldenOutputFrame = () => new Uint8Array([
  175, 1, 2, 0, 3, 0, 0, 0, 200, 0, 0, 0, 2, 0, 0, 0, 255, 127,
]);
export function createSessionFixture(mode: VoiceMode): CreateVoiceSessionRequest {
  return { protocolVersion: 1, mode, conversationId: null, locale: 'en-US', idempotencyKey: 'voice-fixture-1' };
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
