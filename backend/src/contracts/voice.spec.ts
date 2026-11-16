/**
 * ============================================================================
 * FILE: voice.spec.ts
 * LOCATION: backend/src/contracts/voice.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for shared voice contracts, wire types, audio codecs, and schemas.
 *
 * ROLE IN PROJECT:
 *    Verifies that voice wire protocols, binary audio framing, and server delivery
 *    records conform strictly to contract rules and reject malformed/tampered data.
 *
 * KEY COMPONENTS:
 *    - Wire protocol validation tests
 *    - Binary PCM16 audio framing codec tests
 *    - Message/session record compatibility tests
 *    - Delivery record schema tests
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { messageRecordSchema } from './message.js';
import { sessionRecordSchema } from './session.js';
import { encodeVoiceAudio, decodeVoiceAudio } from './voice-audio.js';
import {
  DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO, isVoiceClientEvent,
  isVoiceServerEvent, isCreateVoiceSessionRequest, isCreateVoiceSessionResponse,
  isVoiceLiveKitTransport, isLiveKitVoiceSessionResponse, livekitRoomName,
  livekitParticipantIdentity, livekitAgentIdentity, LIVEKIT_CONTROL_TOPIC,
  LIVEKIT_TOKEN_MAX_TTL_MS, LIVEKIT_TEARDOWN_TIMEOUT_MS, LIVE_WEBRTC_AUDIO,
  VOICE_PLAYBACK_PROOFS, clampPlayedSamplesToWatermark,
  LIVEKIT_MAX_CONTROL_PACKET_BYTES, LIVEKIT_CONTROL_LIMITS,
  isVoiceControlChunkPacket, encodeVoiceControlPackets, VoiceControlReassembler,
  parseVoiceControl, CANVAS_ARTIFACT_LIMITS, isCanvasArtifactId,
  isCanvasArtifactSource, isCanvasArtifactProjection, isCanvasArtifactProjectionList,
} from './voice-wire.js';
import { voiceDeliveryRecordSchema, voiceSessionRecordSchema } from './voice.js';

const envelope = {
  protocolVersion: 1, sessionId: 'voice-1', connectionEpoch: 1,
  eventId: 'event-1', sequence: 0,
};
describe('voice contracts', () => {
  it('accepts draft-only/new-chat starts and rejects overrides', () => {
    const request = { protocolVersion: 1, mode: 'dictation', conversationId: null,
      locale: 'en-US', idempotencyKey: 'voice-key-1' };
    expect(isCreateVoiceSessionRequest(request)).toBe(true);
    expect(isCreateVoiceSessionRequest({ ...request, mode: 'live' })).toBe(true);
    for (const field of ['userId', 'tenantId', 'model', 'apiKey', 'draft', 'voice']) {
      expect(isCreateVoiceSessionRequest({ ...request, [field]: 'override' })).toBe(false);
    }
    expect(isCreateVoiceSessionRequest({ ...request, locale: 'hi-IN' })).toBe(false);
    expect(isVoiceClientEvent({ ...envelope, type: 'session.start', mode: 'live',
      audioSettings: INPUT_AUDIO })).toBe(true);
    expect(isVoiceClientEvent({ ...envelope, type: 'session.start', mode: 'live',
      audioSettings: { ...INPUT_AUDIO, sampleRate: 48000 } })).toBe(false);
    expect(isVoiceClientEvent({ ...envelope, type: 'session.end', connectionEpoch: -1 })).toBe(false);
    expect(isVoiceClientEvent({ ...envelope, type: 'session.end', sequence: 2 ** 32 })).toBe(false);
  });
  it('keeps independent state and prevents live text payloads', () => {
    const state = { ...envelope, type: 'voice.state',
      input: 'listening', agent: 'speaking', connection: 'connected' };
    expect(isVoiceServerEvent(state, 'live')).toBe(true);
    expect(isVoiceServerEvent({ ...state, text: 'hidden' }, 'live')).toBe(false);
    expect(isVoiceServerEvent({ ...envelope, type: 'dictation.final',
      segmentId: 'segment-1', text: 'draft' }, 'live')).toBe(false);
    expect(isVoiceServerEvent({ ...envelope, type: 'dictation.final',
      segmentId: 'segment-1', text: 'draft' }, 'dictation')).toBe(true);
    expect(isVoiceServerEvent({ ...envelope, type: 'session.ready',
      limits: DEFAULT_VOICE_LIMITS, effectiveAudioSettings: { input: INPUT_AUDIO, output: OUTPUT_AUDIO } }, 'live')).toBe(true);
  });
  it('encodes the exact LE header independently of native typed-array endianness', () => {
    const frame = encodeVoiceAudio({ kind: 1, flags: 0, sequence: 7, offsetMs: 80,
      pcm: new Uint8Array([0, 128, 255, 127]) });
    expect([...frame.slice(0, 16)]).toEqual([
      175, 1, 1, 0, 7, 0, 0, 0, 80, 0, 0, 0, 4, 0, 0, 0,
    ]);
    expect(decodeVoiceAudio(frame)).toEqual({ kind: 1, flags: 0, sequence: 7,
      offsetMs: 80, pcm: new Uint8Array([0, 128, 255, 127]) });
    const padded = new Uint8Array(frame.length + 6);
    padded.set(frame, 3);
    expect(decodeVoiceAudio(padded.subarray(3, -3)).sequence).toBe(7);
  });
  it('rejects malformed, oversized and wrapping audio without silent truncation', () => {
    const valid = encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0, offsetMs: 0,
      pcm: new Uint8Array(2560) });
    for (const [index, value] of [[0, 0], [1, 2], [2, 3], [3, 2], [12, 1]]) {
      const corrupt = valid.slice(); corrupt[index] = value;
      expect(() => decodeVoiceAudio(corrupt)).toThrow('INVALID_AUDIO_FRAME');
    }
    expect(() => decodeVoiceAudio(valid.slice(0, 15))).toThrow();
    expect(() => encodeVoiceAudio({ kind: 1, flags: 0, sequence: 2 ** 32,
      offsetMs: 0, pcm: new Uint8Array(2) })).toThrow();
    expect(() => encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0,
      offsetMs: 0, pcm: new Uint8Array(2562) })).toThrow();
    expect(() => encodeVoiceAudio({ kind: 2, flags: 0, sequence: 0,
      offsetMs: 0, pcm: new Uint8Array(9602) })).toThrow();
    expect(() => encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0,
      offsetMs: 0, pcm: new Uint8Array(1) })).toThrow();
    expect(() => encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0,
      offsetMs: 0, pcm: new Uint8Array(0) })).toThrow();
    expect(decodeVoiceAudio(encodeVoiceAudio({ kind: 1, flags: 1, sequence: 1,
      offsetMs: 80, pcm: new Uint8Array(0) })).flags).toBe(1);
  });
  it('keeps legacy messages readable and permits bounded internal records', () => {
    const message = { schemaVersion: 1, userId: 'user-1', sessionId: 'chat-1',
      turnId: 'turn-1', messageId: 'message-1', eventId: 'event-1', sequence: 1,
      role: 'user', content: 'hello', createdAt: '2026-10-08T00:00:00Z',
      completionStatus: 'accepted', attemptId: null, truncated: false };
    expect(messageRecordSchema.parse(message)).toEqual(message);
    expect(messageRecordSchema.parse({ ...message, visibility: 'internal', mode: 'live' }).visibility).toBe('internal');
    expect(messageRecordSchema.parse({
      ...message,
      visibility: 'visible',
      mode: 'live',
      voiceSessionId: 'voice-1',
      voiceDurationSeconds: 5,
      voiceTranscripts: [
        { role: 'user', content: 'Consider Grok build a similar to cursor or claude code.' },
        { role: 'assistant', content: "I can't fully replace Cursor or Claude Code." },
      ],
    }).voiceDurationSeconds).toBe(5);
    expect(messageRecordSchema.safeParse({ ...message, visibility: 'secret' }).success).toBe(false);
    expect(sessionRecordSchema.shape.pinned).toBeDefined();
  });
  it('records unknown delivery and separate voice/conversation identity', () => {
    const delivery = { schemaVersion: 1, kind: 'voice-delivery', userId: 'user-1',
      sessionId: 'chat-1', voiceSessionId: 'voice-1', turnId: 'turn-1',
      attemptId: 'attempt-1', responseId: 'response-1', eventId: 'event-2', sequence: 2,
      speechId: null, providerSocketId: 'socket-1', status: 'unknown',
      audioDurationMs: null, audioPlayedMs: null, playedSamples: null,
      textGenerated: 'Paris is the capital.', textSpoken: null, textRemaining: null,
      createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' };
    expect(voiceDeliveryRecordSchema.parse(delivery)).toEqual(delivery);
    expect(voiceDeliveryRecordSchema.safeParse({ ...delivery, audioDurationMs: 100,
      audioPlayedMs: 101 }).success).toBe(false);
    expect(voiceDeliveryRecordSchema.safeParse({ ...delivery, textGenerated: 'x'.repeat(32001) }).success).toBe(false);
    expect(voiceDeliveryRecordSchema.safeParse({ ...delivery, rawAudio: [] }).success).toBe(false);
    expect(voiceSessionRecordSchema.parse({ schemaVersion: 1, voiceSessionId: 'voice-1',
      userId: 'user-1', conversationId: null, mode: 'dictation', locale: 'en-US',
      connectionEpoch: 0, status: 'created', createdAt: delivery.createdAt,
      expiresAt: '2026-10-08T00:05:00Z' }).conversationId).toBeNull();
  });
  it('requires explicit terminal flags and admits suspend only in live mode', () => {
    const suspend = { ...envelope, type: 'input.suspend' };
    expect(parseVoiceControl(JSON.stringify(suspend), 'client', 'live')).toEqual(suspend);
    expect(() => parseVoiceControl(JSON.stringify(suspend), 'client', 'dictation'))
      .toThrow('INVALID_VOICE_CONTROL');
    for (const extra of [{ resume: true }, { reason: 'idle' }, { userId: 'browser' }])
      expect(() => parseVoiceControl(JSON.stringify({ ...suspend, ...extra }), 'client', 'live')).toThrow();
    const state = { ...envelope, type: 'voice.state', input: 'suspended',
      agent: 'speaking', connection: 'connected' };
    expect(isVoiceServerEvent(state, 'live')).toBe(true);
    expect(isVoiceServerEvent(state, 'dictation')).toBe(false);
    const error = { ...envelope, type: 'session.error', code: 'MEDIA_GATE_UNAVAILABLE',
      recovery: 'resume_call', recoverable: true, terminal: false };
    const ended = { ...envelope, type: 'session.ended', reason: 'quota', terminal: false };
    for (const event of [error, ended]) {
      expect(isVoiceServerEvent(event, 'live')).toBe(true);
      expect(isVoiceServerEvent({ ...event, terminal: true }, 'live')).toBe(true);
      const { terminal: flag, ...missing } = event;
      expect(flag).toBe(false);
      expect(isVoiceServerEvent(missing, 'live')).toBe(false);
      for (const terminal of [null, 0, 'false'])
        expect(isVoiceServerEvent({ ...event, terminal }, 'live')).toBe(false);
      expect(isVoiceServerEvent({ ...event, providerPayload: 'private' }, 'live')).toBe(false);
    }
    expect(isVoiceClientEvent({ ...envelope, type: 'input.resume' })).toBe(false);
  });
  it('accepts complete canvas artifacts only on the live server channel', () => {
    expect(CANVAS_ARTIFACT_LIMITS.maxArtifactsPerResponse).toBe(3);
    const baseEnvelope = { protocolVersion: 1, sessionId: 'voice-1', connectionEpoch: 1,
      eventId: 'event-1', sequence: 0 };
    const event = { ...baseEnvelope, type: 'canvas.artifact', turnId: 'turn-1',
      responseId: 'response-1', ordinal: 0, kind: 'mermaid', subType: 'Flowchart',
      title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
    expect(parseVoiceControl(JSON.stringify(event), 'server', 'live')).toEqual(event);
    expect(() => parseVoiceControl(JSON.stringify(event), 'server', 'dictation')).toThrow('INVALID_VOICE_CONTROL');
    expect(() => parseVoiceControl(JSON.stringify(event), 'client', 'live')).toThrow('INVALID_VOICE_CONTROL');
    for (const patch of [{ ordinal: -1 }, { ordinal: 3 }, { ordinal: 0.5 }, { kind: 'graph' },
      { responseId: '' }, { turnId: 'bad id' }, { title: 'x'.repeat(121) },
      { subType: 'x'.repeat(49) }, { rawSource: 'x'.repeat(8193) },
      { rawSource: '界'.repeat(6000) }, { rawSource: '\uD800' }, { rawSource: '' },
      { rawSource: 'x\u0000' }, { extra: true }]) {
      expect(() => parseVoiceControl(JSON.stringify({ ...event, ...patch }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
    }
    const json = JSON.stringify(event);
    const exactCeiling = json + ' '.repeat(131072 - new TextEncoder().encode(json).byteLength);
    expect(parseVoiceControl(exactCeiling, 'server', 'live')).toEqual(event);
    expect(() => parseVoiceControl(exactCeiling + ' ', 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');

    // Title / subtype byte limits, isolated low surrogate, missing properties, extra nested values, wrong protocol
    expect(() => parseVoiceControl(JSON.stringify({ ...event, title: '界'.repeat(121) }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
    expect(() => parseVoiceControl(JSON.stringify({ ...event, subType: '界'.repeat(49) }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
    expect(() => parseVoiceControl(JSON.stringify({ ...event, rawSource: '\uDC00' }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
    expect(() => parseVoiceControl(JSON.stringify({ ...event, protocolVersion: 2 }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
    expect(() => parseVoiceControl(JSON.stringify({ ...event, sessionId: 'bad session id' }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
    expect(() => parseVoiceControl(JSON.stringify({ ...event, eventId: 'bad event id' }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');

    // Max legal ordinal
    expect(parseVoiceControl(JSON.stringify({ ...event, ordinal: 2 }), 'server', 'live')).toEqual({ ...event, ordinal: 2 });

    // Unicode source, escaped/newline source
    const unicodeSource = 'flowchart TD\nA["こんにちは 🌍"] --> B["Data \n Line 2 \t Tab"]';
    expect(parseVoiceControl(JSON.stringify({ ...event, rawSource: unicodeSource }), 'server', 'live')).toEqual({
      ...event, rawSource: unicodeSource,
    });

    // Guards validation
    expect(isCanvasArtifactId('valid-id_123.abc:xyz')).toBe(true);
    expect(isCanvasArtifactId('')).toBe(false);
    expect(isCanvasArtifactId('-bad-start')).toBe(false);
    expect(isCanvasArtifactId('bad id')).toBe(false);
    expect(isCanvasArtifactId('x'.repeat(129))).toBe(false);

    const source = { ordinal: 0, kind: 'mermaid' as const, subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
    expect(isCanvasArtifactSource(source)).toBe(true);
    expect(isCanvasArtifactSource({ ...source, extra: 1 })).toBe(false);
    const projection = { ...source, responseId: 'response-1' };
    expect(isCanvasArtifactProjection(projection)).toBe(true);
    expect(isCanvasArtifactProjection({ ...projection, responseId: 'bad id' })).toBe(false);
    expect(isCanvasArtifactProjectionList([projection])).toBe(true);
    expect(isCanvasArtifactProjectionList([])).toBe(false);
    expect(isCanvasArtifactProjectionList([projection, { ...projection, ordinal: 0 }])).toBe(false);
    expect(isCanvasArtifactProjectionList([projection, { ...projection, ordinal: 1, responseId: 'response-2' }])).toBe(false);
    expect(isCanvasArtifactProjectionList([projection, { ...projection, ordinal: 2 }, { ...projection, ordinal: 1 }])).toBe(false);
  });
  it('validates scoped LiveKit transport descriptors for live mode and rejects cross-mode or malformed descriptors', () => {
    expect(LIVEKIT_CONTROL_TOPIC).toBe('aurvin.voice.control');
    expect(LIVEKIT_TOKEN_MAX_TTL_MS).toBe(30000);
    expect(LIVEKIT_TEARDOWN_TIMEOUT_MS).toBe(2000);
    expect(LIVE_WEBRTC_AUDIO).toEqual({
      browserPublishCodec: 'opus',
      browserClockHz: 48000,
      sttSampleRateHz: 16000,
      sttChannels: 1,
      sttFrameMs: 80,
      sttFrameSamples: 1280,
      sttFrameBytes: 2560,
      ttsSampleRateHz: 24000,
      ttsChannels: 1,
      ttsMaxChunkMs: 200,
      ttsMaxChunkSamples: 4800,
      ttsMaxChunkBytes: 9600,
      quietPeakThreshold: 600,
      quietHangoverMs: 5000,
      quietFrameWindowMs: 20,
      quietPreRollFrames: 4,
    });
    expect(livekitRoomName('voice-1')).toBe('aurvin-live-voice-1');
    expect(livekitParticipantIdentity('aurvin-dev-user', 'voice-1', 2)).toBe('aurvin-dev-user:voice-1:2');
    expect(livekitAgentIdentity('voice-1')).toBe('aurvin-agent:voice-1');

    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJlMTIzNDU2';
    const livekit = {
      url: 'wss://livekit.example.com',
      roomName: 'aurvin-live-voice-1',
      participantIdentity: 'aurvin-dev-user:voice-1:1',
      participantToken: jwt,
    };
    expect(isVoiceLiveKitTransport(livekit, 'voice-1', 1)).toBe(true);
    expect(isVoiceLiveKitTransport({ ...livekit, url: 'ws://127.0.0.1:7880' }, 'voice-1', 1)).toBe(true);

    const baseResponse = {
      protocolVersion: 1 as const,
      sessionId: 'voice-1',
      conversationId: null,
      mode: 'live' as const,
      connectionEpoch: 1,
      websocketUrl: '/api/voice' as const,
      expiresAt: '2026-11-05T12:00:00.000Z',
      effectiveAudioSettings: { input: INPUT_AUDIO, output: OUTPUT_AUDIO },
      limits: DEFAULT_VOICE_LIMITS,
    };
    const liveWithWebRtc = { ...baseResponse, livekit };
    expect(isCreateVoiceSessionResponse(liveWithWebRtc)).toBe(true);
    expect(isLiveKitVoiceSessionResponse(liveWithWebRtc)).toBe(true);
    expect(isCreateVoiceSessionResponse(baseResponse)).toBe(true);
    expect(isLiveKitVoiceSessionResponse(baseResponse)).toBe(false);

    const dictationResponse = {
      ...baseResponse,
      mode: 'dictation' as const,
      effectiveAudioSettings: { input: INPUT_AUDIO, output: null },
    };
    expect(isCreateVoiceSessionResponse(dictationResponse)).toBe(true);
    expect(isCreateVoiceSessionResponse({ ...dictationResponse, livekit })).toBe(false);

    for (const invalidLiveKit of [
      undefined,
      null,
      {},
      { ...livekit, url: 'https://livekit.example.com' },
      { ...livekit, url: 'wss://user:secret@livekit.example.com' },
      { ...livekit, url: 'wss://livekit.example.com/rtc' },
      { ...livekit, url: 'wss://livekit.example.com?token=1' },
      { ...livekit, url: 'wss://livekit.example.com/' },
      { ...livekit, roomName: 'aurvin-live-other-session' },
      { ...livekit, participantIdentity: 'aurvin-dev-user:voice-1:0' },
      { ...livekit, participantIdentity: 'aurvin-dev-user:other:1' },
      { ...livekit, participantIdentity: ':voice-1:1' },
      { ...livekit, participantIdentity: 'bad:user:voice-1:1' },
      { ...livekit, participantToken: 'not-a-jwt' },
      { ...livekit, apiSecret: 'leaked' },
    ]) {
      expect(isCreateVoiceSessionResponse({ ...baseResponse, livekit: invalidLiveKit })).toBe(false);
      expect(isLiveKitVoiceSessionResponse({ ...baseResponse, livekit: invalidLiveKit })).toBe(false);
    }
  });
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
  it('mirrors the entire portable voice contract', () => {
    const body = (text: string) => text.slice(text.indexOf('export const VOICE_PROTOCOL_VERSION'));
    const backend = readFileSync(new URL('./voice-wire.ts', import.meta.url), 'utf8');
    const frontend = readFileSync(new URL('../../../frontend/src/api/voice-protocol.ts', import.meta.url), 'utf8');
    expect(body(frontend)).toBe(body(backend));
  });
});
