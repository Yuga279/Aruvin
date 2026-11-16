/**
 * ============================================================================
 * FILE: voice-livekit-fixture.ts
 * LOCATION: backend/test/assembly/voice-livekit-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Adapt existing offline RTC and token fixtures for application assembly.
 *
 * ROLE IN PROJECT:
 *    Exercises real AppService/P2/P3 seams without an SFU, database or provider.
 *    Keeps one captured epoch at a time and preserves prior resource references.
 *
 * KEY COMPONENTS:
 *    - livekitEnvironment: Explicit fixture-only bootstrap settings.
 *    - offlineLiveKit: Fake room administration and real bridge over fake RTC.
 * ============================================================================
 */

// Import the RTC fake before any module that binds @livekit/rtc-node.
import { rtcFixture, type RtcFixture } from '../voice/transport/livekit-fixture.js';
import { vi } from 'vitest';
import { TrackKind, TrackSource } from '@livekit/rtc-node';
import { LiveKitMediaBridge, type LiveKitMediaOptions } from '../../src/voice/transport/livekit-media.js';
import { LiveKitAdmission } from '../../src/voice/session/livekit-admission.js';
import { livekitConfigFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { VoiceControlReassembler, type CreateVoiceSessionResponse,
  type VoiceClientPayload, type VoiceServerEvent } from '../../src/contracts/voice-wire.js';

export const livekitEnvironment = () => {
  const config = livekitConfigFixture();
  return { LIVEKIT_URL: config.url, LIVEKIT_API_KEY: config.apiKey,
    LIVEKIT_API_SECRET: config.apiSecret };
};

type Epoch = {
  response: CreateVoiceSessionResponse;
  rtc: RtcFixture;
  bridge: LiveKitMediaBridge;
  events(): VoiceServerEvent[];
  control(payload: VoiceClientPayload): void;
  microphone(): void;
};

export function offlineLiveKit() {
  const roomClient = { deleteRoom: vi.fn(async (_name: string) => undefined),
    removeParticipant: vi.fn(async (_room: string, _identity: string) => undefined) };
  const epochs: Epoch[] = [];
  const admission = new LiveKitAdmission(() => roomClient);
  const connect = vi.fn(async (options: LiveKitMediaOptions) => {
    // P2 mutates its binding on rejoin: hold an immutable test epoch descriptor.
    const response = structuredClone(options.context.response);
    const rtc = rtcFixture(response);
    const bridge = await LiveKitMediaBridge.connect(options);
    let sequence = 0;
    const events = () => {
      const rx = new VoiceControlReassembler('server', 'live', {
        sessionId: response.sessionId, connectionEpoch: response.connectionEpoch,
      });
      const output: VoiceServerEvent[] = [];
      for (const packet of rtc.controlPackets) {
        const result = rx.push(packet.bytes);
        if (result.status === 'complete') output.push(result.event);
      }
      return output;
    };
    epochs.push({ response, rtc, bridge, events,
      control: payload => rtc.emitControl(payload, sequence++),
      microphone: () => {
        const publication = { sid: 'assembly-mic', kind: TrackKind.KIND_AUDIO,
          source: TrackSource.SOURCE_MICROPHONE, setSubscribed: vi.fn() };
        const participant = { identity: response.livekit!.participantIdentity };
        rtc.rooms[0].emit('trackPublished', publication, participant);
        rtc.rooms[0].emit('trackSubscribed', {}, publication, participant);
      },
    });
    return bridge;
  });
  return { admission, connect, roomClient, epochs,
    last: () => {
      const epoch = epochs.at(-1);
      if (!epoch) throw new Error('Assembly did not open a LiveKit bridge.');
      return epoch;
    },
  };
}
