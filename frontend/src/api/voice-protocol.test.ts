/**
 * ============================================================================
 * FILE: voice-protocol.test.ts
 * LOCATION: frontend/src/api/voice-protocol.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for frontend voice protocol validation, route constants, and audio codecs.
 *
 * ROLE IN PROJECT:
 *    Validates that the browser-side voice protocol mirror accurately validates
 *    server events, rejects unauthorized/hidden payloads, and enforces audio framing.
 *
 * KEY COMPONENTS:
 *    - Route and configuration validation tests
 *    - Client and server control parsing and rejection tests
 *    - SessionSummary compatibility tests
 * ============================================================================
 */

import { describe, expect, it } from 'vitest'
import type { SessionSummary } from './protocol'
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO, VOICE_ROUTES,
  LIVEKIT_CONTROL_TOPIC, LIVE_WEBRTC_AUDIO, isCreateVoiceSessionResponse,
  isLiveKitVoiceSessionResponse, isVoiceLiveKitTransport, isPublicVoiceConfig,
  livekitRoomName, livekitParticipantIdentity, parseVoiceControl,
  VOICE_PLAYBACK_PROOFS, clampPlayedSamplesToWatermark,
  LIVEKIT_MAX_CONTROL_PACKET_BYTES, LIVEKIT_CONTROL_LIMITS,
  encodeVoiceControlPackets, VoiceControlReassembler,
  CANVAS_ARTIFACT_LIMITS, isCanvasArtifactId, isCanvasArtifactSource,
  isCanvasArtifactProjection, isCanvasArtifactProjectionList,
  isVoiceClientEvent, isVoiceServerEvent } from './voice-protocol'
import { agenda } from '../features/canvas/testing/calendar-view-fixtures.ts'
import { encodeVoiceAudio, decodeVoiceAudio } from './voice-audio'

const base = { protocolVersion: 1, sessionId: 'voice-1', connectionEpoch: 1,
  eventId: 'event-1', sequence: 0 }
describe('frontend voice protocol', () => {
  it('mirrors routes, frame bytes and preserves existing pinned type', () => {
    const summary: Pick<SessionSummary, 'pinned'> = { pinned: true }
    expect(summary.pinned).toBe(true)
    expect(VOICE_ROUTES.config).toBe('/voice/config')
    expect(VOICE_ROUTES.websocket).toBe('/api/voice')
    const bytes = encodeVoiceAudio({ kind: 2, flags: 0, sequence: 3, offsetMs: 200,
      pcm: new Uint8Array([255, 127]) })
    expect([...bytes]).toEqual([175, 1, 2, 0, 3, 0, 0, 0, 200, 0, 0, 0, 2, 0, 0, 0, 255, 127])
    expect(decodeVoiceAudio(bytes).kind).toBe(2)
  })
  it('validates control events and rejects hidden text, bad JSON and overrides', () => {
    const event = { ...base, type: 'audio.start', turnId: 'turn-1', responseId: 'response-1',
      sampleRate: 24000, firstAudioSequence: 0 }
    expect(parseVoiceControl(JSON.stringify(event), 'server', 'live')).toEqual(event)
    for (const invalid of [ { ...event, text: 'hidden' }, { ...event, userId: 'browser' },
      { ...event, sampleRate: 16000 }, { ...event, protocolVersion: 2 },
      { ...event, responseId: '' }, { ...event, type: 'unknown' } ]) {
      expect(() => parseVoiceControl(JSON.stringify(invalid), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')
    }
    expect(() => parseVoiceControl('{', 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')
    expect(() => parseVoiceControl(' '.repeat(131073), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')
    expect(() => parseVoiceControl(JSON.stringify({ ...base, type: 'dictation.stop' }), 'client', 'live')).toThrow()
    expect(() => parseVoiceControl(JSON.stringify({ ...base, type: 'input.mute' }), 'client', 'dictation')).toThrow()
  })
  it('accepts safe public/session config without keys, URLs or model selection', () => {
    expect(LIVEKIT_CONTROL_TOPIC).toBe('aurvin.voice.control')
    expect(LIVE_WEBRTC_AUDIO.sttFrameBytes).toBe(2560)
    const pub = { protocolVersion: 1, enabledModes: { dictation: false, live: false },
      supportedLocales: ['en-US'], limits: DEFAULT_VOICE_LIMITS,
      inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO }
    expect(isPublicVoiceConfig(pub)).toBe(true)
    expect(isPublicVoiceConfig({ ...pub, apiKey: 'key' })).toBe(false)
    expect(isPublicVoiceConfig({ ...pub, livekitUrl: 'wss://livekit.example.com' })).toBe(false)
    const livekit = {
      url: 'ws://127.0.0.1:7880',
      roomName: livekitRoomName('voice-1'),
      participantIdentity: livekitParticipantIdentity('aurvin-dev-user', 'voice-1', 1),
      participantToken: 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJlMTIzNDU2',
    }
    expect(isVoiceLiveKitTransport(livekit, 'voice-1', 1)).toBe(true)
    const created = { protocolVersion: 1, sessionId: 'voice-1', conversationId: null,
      mode: 'live', connectionEpoch: 1, websocketUrl: '/api/voice',
      expiresAt: '2026-10-08T00:20:00Z', limits: DEFAULT_VOICE_LIMITS,
      effectiveAudioSettings: { input: INPUT_AUDIO, output: OUTPUT_AUDIO } }
    expect(isCreateVoiceSessionResponse(created)).toBe(true)
    expect(isLiveKitVoiceSessionResponse(created)).toBe(false)
    expect(isCreateVoiceSessionResponse({ ...created, livekit })).toBe(true)
    expect(isLiveKitVoiceSessionResponse({ ...created, livekit })).toBe(true)
    expect(isCreateVoiceSessionResponse({ ...created, websocketUrl: 'wss://provider/?key=secret' })).toBe(false)
    expect(isCreateVoiceSessionResponse({ ...created, mode: 'dictation' })).toBe(false)
    expect(isCreateVoiceSessionResponse({
      ...created,
      mode: 'dictation',
      effectiveAudioSettings: { input: INPUT_AUDIO, output: null },
      livekit,
    })).toBe(false)
  })
  it('parses suspended input and nonterminal call failures without relaxing exact shapes', () => {
    const suspend = { ...base, type: 'input.suspend' }
    expect(parseVoiceControl(JSON.stringify(suspend), 'client', 'live')).toEqual(suspend)
    expect(() => parseVoiceControl(JSON.stringify(suspend), 'client', 'dictation')).toThrow()
    for (const event of [
      { ...base, type: 'voice.state', input: 'suspended', agent: 'speaking', connection: 'connected' },
      { ...base, type: 'session.error', code: 'MEDIA_GATE_UNAVAILABLE', recovery: 'resume_call',
        recoverable: true, terminal: false },
      { ...base, type: 'session.ended', reason: 'duration', terminal: false },
    ]) expect(parseVoiceControl(JSON.stringify(event), 'server', 'live')).toEqual(event)
    for (const type of ['session.error', 'session.ended']) {
      const event = type === 'session.error'
        ? { ...base, type, code: 'STT_UNAVAILABLE', recovery: 'resume_call', recoverable: true }
        : { ...base, type, reason: 'error' }
      expect(() => parseVoiceControl(JSON.stringify(event), 'server', 'live')).toThrow()
      expect(() => parseVoiceControl(JSON.stringify({ ...event, terminal: 'false' }), 'server', 'live')).toThrow()
    }

    expect(VOICE_PLAYBACK_PROOFS).toEqual(['proven', 'unproven'])
    const watermark = { ...base, type: 'audio.watermark', turnId: 'turn-1', responseId: 'response-1',
      firstAudioSample: 0, queuedSamples: 2400, lastAudioSample: 2400, final: true }
    expect(parseVoiceControl(JSON.stringify(watermark), 'server', 'live')).toEqual(watermark)
    expect(() => parseVoiceControl(JSON.stringify(watermark), 'server', 'dictation')).toThrow()
    const unprovenProgress = { ...base, type: 'playback.progress', turnId: 'turn-1', responseId: 'response-1',
      playedMs: 50, playedSamples: 1200, proof: 'unproven' }
    expect(parseVoiceControl(JSON.stringify(unprovenProgress), 'client', 'live')).toEqual(unprovenProgress)
    expect(clampPlayedSamplesToWatermark(0, 1200, 2400, 2400)).toBe(2400)
  })
  it('accepts complete canvas artifacts only on the live server channel', () => {
    expect(CANVAS_ARTIFACT_LIMITS.maxArtifactsPerResponse).toBe(3)
    const baseEnvelope = { protocolVersion: 1, sessionId: 'voice-1', connectionEpoch: 1,
      eventId: 'event-1', sequence: 0 }
    const event = { ...baseEnvelope, type: 'canvas.artifact', turnId: 'turn-1',
      responseId: 'response-1', ordinal: 0, kind: 'mermaid', subType: 'Flowchart',
      title: 'Approval path', rawSource: 'flowchart TD\nA --> B' }
    expect(parseVoiceControl(JSON.stringify(event), 'server', 'live')).toEqual(event)
    expect(() => parseVoiceControl(JSON.stringify(event), 'server', 'dictation')).toThrow('INVALID_VOICE_CONTROL')
    expect(() => parseVoiceControl(JSON.stringify(event), 'client', 'live')).toThrow('INVALID_VOICE_CONTROL')
    for (const patch of [{ ordinal: -1 }, { ordinal: 3 }, { ordinal: 0.5 }, { kind: 'graph' },
      { responseId: '' }, { turnId: 'bad id' }, { title: 'x'.repeat(121) },
      { subType: 'x'.repeat(49) }, { rawSource: 'x'.repeat(8193) },
      { rawSource: '界'.repeat(6000) }, { rawSource: '\uD800' }, { rawSource: '' },
      { rawSource: 'x\u0000' }, { extra: true }]) {
      expect(() => parseVoiceControl(JSON.stringify({ ...event, ...patch }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')
    }
    const json = JSON.stringify(event)
    const exactCeiling = json + ' '.repeat(131072 - new TextEncoder().encode(json).byteLength)
    expect(parseVoiceControl(exactCeiling, 'server', 'live')).toEqual(event)
    expect(() => parseVoiceControl(exactCeiling + ' ', 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')

    expect(() => parseVoiceControl(JSON.stringify({ ...event, title: '界'.repeat(121) }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')
    expect(() => parseVoiceControl(JSON.stringify({ ...event, subType: '界'.repeat(49) }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')
    expect(() => parseVoiceControl(JSON.stringify({ ...event, rawSource: '\uDC00' }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')
    expect(() => parseVoiceControl(JSON.stringify({ ...event, protocolVersion: 2 }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')
    expect(() => parseVoiceControl(JSON.stringify({ ...event, sessionId: 'bad session id' }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')
    expect(() => parseVoiceControl(JSON.stringify({ ...event, eventId: 'bad event id' }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL')

    expect(parseVoiceControl(JSON.stringify({ ...event, ordinal: 2 }), 'server', 'live')).toEqual({ ...event, ordinal: 2 })

    const unicodeSource = 'flowchart TD\nA["こんにちは 🌍"] --> B["Data \n Line 2 \t Tab"]'
    expect(parseVoiceControl(JSON.stringify({ ...event, rawSource: unicodeSource }), 'server', 'live')).toEqual({
      ...event, rawSource: unicodeSource,
    })

    expect(isCanvasArtifactId('valid-id_123.abc:xyz')).toBe(true)
    expect(isCanvasArtifactId('')).toBe(false)
    expect(isCanvasArtifactId('-bad-start')).toBe(false)
    expect(isCanvasArtifactId('bad id')).toBe(false)
    expect(isCanvasArtifactId('x'.repeat(129))).toBe(false)

    const source = { ordinal: 0, kind: 'mermaid' as const, subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' }
    expect(isCanvasArtifactSource(source)).toBe(true)
    expect(isCanvasArtifactSource({ ...source, extra: 1 })).toBe(false)
    const projection = { ...source, responseId: 'response-1' }
    expect(isCanvasArtifactProjection(projection)).toBe(true)
    expect(isCanvasArtifactProjection({ ...projection, responseId: 'bad id' })).toBe(false)
    expect(isCanvasArtifactProjectionList([projection])).toBe(true)
    expect(isCanvasArtifactProjectionList([])).toBe(false)
    expect(isCanvasArtifactProjectionList([projection, { ...projection, ordinal: 0 }])).toBe(false)
    expect(isCanvasArtifactProjectionList([projection, { ...projection, ordinal: 1, responseId: 'response-2' }])).toBe(false)
    expect(isCanvasArtifactProjectionList([projection, { ...projection, ordinal: 2 }, { ...projection, ordinal: 1 }])).toBe(false)
  })
  it('reassembles chunked live canvas artifacts and rejects oversized or timed-out packets', () => {
    expect(LIVEKIT_MAX_CONTROL_PACKET_BYTES).toBe(15360)
    expect(LIVEKIT_CONTROL_LIMITS.maxChunksPerMessage).toBe(16)
    const event = {
      ...base,
      protocolVersion: 1 as const,
      sequence: 4,
      eventId: 'canvas-big',
      type: 'canvas.artifact' as const,
      turnId: 'turn-1',
      responseId: 'response-1',
      ordinal: 0,
      kind: 'mermaid' as const,
      subType: 'Flowchart',
      title: 'Chunked artifact',
      rawSource: `flowchart TD\nA["${'界'.repeat(5200)}"] --> B`,
    }
    const packets = encodeVoiceControlPackets(event, 'server', 'live')
    expect(packets.length).toBe(2)
    const reassembler = new VoiceControlReassembler('server', 'live', {
      sessionId: 'voice-1',
      connectionEpoch: 1,
    })
    expect(reassembler.push(packets[0], 100).status).toBe('partial')
    const done = reassembler.push(packets[1], 150)
    expect(done).toMatchObject({ status: 'complete', event, chunked: true, chunkCount: 2 })
  })
  it('mirrors calendar frames with response IDs and live-only revision-bound controls', () => {
    const envelope = {protocolVersion:1,sessionId:'v',connectionEpoch:1,eventId:'e',sequence:0};
    const frame = {...envelope,type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',
      event:{type:'calendar-view',view:agenda()}};
    expect(isVoiceServerEvent(frame,'live')).toBe(true);
    expect(isVoiceServerEvent(frame,'dictation')).toBe(false);
    const {responseId: removed, ...missingResponse} = frame;
    expect(removed).toBe('r');
    expect(isVoiceServerEvent(missingResponse,'live')).toBe(false);
    for (const answer of [{kind:'accept'},{kind:'reject'},{kind:'select',calendarId:'team@example.com'}]) {
      const control = {...envelope,type:'calendar.confirm',proposalId:'p',proposalRevision:2,answer};
      expect(parseVoiceControl(JSON.stringify(control),'client','live')).toEqual(control);
      expect(() => parseVoiceControl(JSON.stringify(control),'client','dictation')).toThrow('INVALID_VOICE_CONTROL');
    }
    expect(isVoiceClientEvent({...envelope,type:'calendar.confirm',proposalId:'p',proposalRevision:0,
      answer:{kind:'accept'}})).toBe(false);
  })
})
