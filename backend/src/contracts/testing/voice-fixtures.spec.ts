/**
 * ============================================================================
 * FILE: voice-fixtures.spec.ts
 * LOCATION: backend/src/contracts/testing/voice-fixtures.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify deterministic fixture factories for voice tests on the backend.
 *
 * ROLE IN PROJECT:
 *    Ensures that shared golden frames, client/server control event catalogs,
 *    and environment fixtures are isolated, immutable across tests, and valid.
 *
 * KEY COMPONENTS:
 *    - Golden input/output audio frame round-trip tests
 *    - Client and server control catalog validation
 *    - LiveKit transport/config fixtures and public/session mode checks
 *    - Mock environment and delivery record schema tests
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { decodeVoiceAudio, encodeVoiceAudio } from '../voice-audio.js';
import {
  LIVEKIT_MAX_CONTROL_PACKET_BYTES,
  VoiceControlReassembler,
  encodeVoiceControlPackets,
  isCreateVoiceSessionResponse,
  isLiveKitVoiceSessionResponse,
  parseVoiceControl,
} from '../voice-wire.js';
import { loadConfig } from '../../platform/config/load-config.js';
import { voiceDeliveryRecordSchema } from '../voice.js';
import {
  goldenInputFrame,
  goldenOutputFrame,
  clientControls,
  serverControls,
  disabledVoiceEnvironment,
  enabledVoiceEnvironment,
  deliveryFixture,
  createSessionFixture,
  createSessionResponseFixture,
  livekitTransportFixture,
  livekitConfigFixture,
  largeCanvasArtifactFixture,
} from './voice-fixtures.js';

describe('shared voice fixtures', () => {
  it('uses independent golden frame bytes and returns fresh buffers', () => {
    const first = goldenInputFrame();
    expect(encodeVoiceAudio(decodeVoiceAudio(first))).toEqual(first);
    expect(decodeVoiceAudio(goldenOutputFrame()).pcm).toEqual(new Uint8Array([255, 127]));
    first[0] = 0;
    expect(goldenInputFrame()[0]).toBe(175);
  });
  it('provides every control event, watermark/proof variants, large canvas fixture, and LiveKit fixtures', () => {
    for (const row of clientControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'client', row.mode)).toEqual(row.event);
    for (const row of serverControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'server', row.mode)).toEqual(row.event);
    expect(new Set(clientControls().map(row => row.event.type)).size).toBe(9);
    expect(new Set(serverControls().map(row => row.event.type)).size).toBe(13);
    const largeArtifact = largeCanvasArtifactFixture();
    const packets = encodeVoiceControlPackets(largeArtifact, 'server', 'live');
    expect(packets.length).toBe(2);
    expect(packets.every(p => p.byteLength <= LIVEKIT_MAX_CONTROL_PACKET_BYTES)).toBe(true);
    const reassembler = new VoiceControlReassembler('server', 'live', {
      sessionId: largeArtifact.sessionId,
      connectionEpoch: largeArtifact.connectionEpoch,
    });
    expect(reassembler.push(packets[0], 10).status).toBe('partial');
    expect(reassembler.push(packets[1], 20)).toMatchObject({ status: 'complete', event: largeArtifact, chunked: true });
    expect(createSessionFixture('dictation').conversationId).toBeNull();
    const dictationRes = createSessionResponseFixture('dictation');
    expect(isCreateVoiceSessionResponse(dictationRes)).toBe(true);
    expect(dictationRes.livekit).toBeUndefined();
    const liveRes = createSessionResponseFixture('live');
    expect(isLiveKitVoiceSessionResponse(liveRes)).toBe(true);
    expect(liveRes.livekit).toEqual(livekitTransportFixture('voice-1', 1));
    expect(livekitConfigFixture().url).toBe('ws://127.0.0.1:7880');
    expect(loadConfig(disabledVoiceEnvironment()).voice.enabledModes.live).toBe(false);
    expect(loadConfig(enabledVoiceEnvironment()).voice.enabledModes).toEqual({ dictation: true, live: true });
    expect(voiceDeliveryRecordSchema.parse(deliveryFixture()).status).toBe('unknown');
  });
});
