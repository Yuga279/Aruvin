/**
 * ============================================================================
 * FILE: livekit-fixture.ts
 * LOCATION: backend/test/voice/transport/livekit-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic RTC SDK fake for offline LiveKit media bridge tests.
 *
 * ROLE IN PROJECT:
 *    Replaces Room, AudioStream, AudioSource and LocalAudioTrack while retaining
 *    the installed enums/AudioFrame, so no native binding or server is used.
 *
 * KEY COMPONENTS:
 *    - rtcFixture(): Resets captured rooms/sources/streams and injects frames/controls.
 * ============================================================================
 */

import { vi } from 'vitest';
import { DataPacketKind } from '@livekit/rtc-node';
import {
  livekitAgentIdentity,
  LIVEKIT_CONTROL_TOPIC,
  type CreateVoiceSessionResponse,
  type VoiceClientPayload,
} from '../../../src/contracts/voice-wire.js';

type Frame = { data: Int16Array; sampleRate: number; channels: number; samplesPerChannel: number };
type RecordedStream = {
  track: unknown;
  options: unknown;
  cancelled: ReturnType<typeof vi.fn>;
  controller: ReadableStreamDefaultController<Frame>;
  error: (reason: unknown) => void;
};

const state = vi.hoisted(() => ({
  rooms: [] as unknown[],
  sources: [] as unknown[],
  streams: [] as RecordedStream[],
  tracks: [] as unknown[],
  controlPackets: [] as { bytes: Uint8Array; options: unknown }[],
  publishedTracks: [] as { track: unknown; options: unknown }[],
  roomName: '',
  agentIdentity: '',
  connectFailures: [] as unknown[],
  publishFailures: [] as unknown[],
}));

vi.mock('@livekit/rtc-node', async importOriginal => {
  const actual = await importOriginal<typeof import('@livekit/rtc-node')>();
  const { EventEmitter } = await import('node:events');

  class FakeRoom extends EventEmitter {
    name?: string;
    localParticipant: {
      identity: string;
      publishData: ReturnType<typeof vi.fn>;
      publishTrack: ReturnType<typeof vi.fn>;
    };
    remoteParticipants = new Map<string, unknown>();
    connect = vi.fn(async (_url: string, _token: string, _options: unknown) => {
      const failure = state.connectFailures.shift();
      if (failure) throw failure;
      this.name = state.roomName;
      this.localParticipant.identity = state.agentIdentity;
    });
    disconnect = vi.fn(async () => undefined);

    constructor() {
      super();
      this.localParticipant = {
        identity: '',
        publishData: vi.fn(async (bytes: Uint8Array, options: unknown) => {
          state.controlPackets.push({ bytes: Uint8Array.from(bytes), options });
        }),
        publishTrack: vi.fn(async (track: unknown, options: unknown) => {
          const failure = state.publishFailures.shift();
          if (failure) throw failure;
          state.publishedTracks.push({ track, options });
          return { sid: 'assistant-track' };
        }),
      };
      state.rooms.push(this);
    }
  }

  class FakeAudioSource {
    args: [number, number, number];
    captured: Int16Array[] = [];
    captureArgs: number[][] = [];
    captureFrame = vi.fn(async (frame: { data: Int16Array; sampleRate: number; channels: number }) => {
      this.captureArgs.push([frame.sampleRate, frame.channels]);
      this.captured.push(frame.data.slice());
    });
    clearQueue = vi.fn();
    close = vi.fn(async () => undefined);

    constructor(sampleRate: number, numChannels: number, queueSize: number) {
      this.args = [sampleRate, numChannels, queueSize];
      state.sources.push(this);
    }
  }

  class FakeAudioStream extends ReadableStream<Frame> {
    constructor(track: unknown, options: unknown) {
      const record = {
        track,
        options,
        cancelled: vi.fn(),
        controller: undefined as unknown as ReadableStreamDefaultController<Frame>,
        error: undefined as unknown as (reason: unknown) => void,
      };
      super({
        start(controller) {
          record.controller = controller;
          record.error = reason => controller.error(reason);
          state.streams.push(record);
        },
        cancel() {
          record.cancelled();
        },
      });
    }
  }

  class FakeLocalAudioTrack {
    static createAudioTrack = vi.fn((name: string, source: unknown) => {
      const track = { name, source, close: vi.fn(async (_closeSource?: boolean) => undefined) };
      state.tracks.push(track);
      return track;
    });
  }

  return {
    ...actual,
    Room: FakeRoom,
    AudioStream: FakeAudioStream,
    AudioSource: FakeAudioSource,
    LocalAudioTrack: FakeLocalAudioTrack,
  };
});

export type RtcFixture = {
  rooms: Array<{
    name?: string;
    remoteParticipants: Map<string, unknown>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    localParticipant: {
      identity: string;
      publishData: ReturnType<typeof vi.fn>;
      publishTrack: ReturnType<typeof vi.fn>;
    };
    emit: (event: string, ...args: unknown[]) => boolean;
    off: (event: string, listener: (...args: unknown[]) => void) => unknown;
    listenerCount: (event: string) => number;
  }>;
  sources: Array<{
    args: [number, number, number];
    captured: Int16Array[];
    captureArgs: number[][];
    captureFrame: ReturnType<typeof vi.fn>;
    clearQueue: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }>;
  streams: RecordedStream[];
  tracks: Array<{ name: string; source: unknown; close: ReturnType<typeof vi.fn> }>;
  controlPackets: Array<{ bytes: Uint8Array; options: unknown }>;
  publishedTracks: Array<{ track: unknown; options: unknown }>;
  pushFrame: (data: Int16Array) => void;
  errorFrame: (reason: unknown) => void;
  emitControl: (payload: VoiceClientPayload, sequence: number, identity?: string) => void;
  rejectConnectOnce: (reason: unknown) => void;
  rejectPublishTrackOnce: (reason: unknown) => void;
};

export function rtcFixture(response: CreateVoiceSessionResponse): RtcFixture {
  state.rooms.length = 0;
  state.sources.length = 0;
  state.streams.length = 0;
  state.tracks.length = 0;
  state.controlPackets.length = 0;
  state.publishedTracks.length = 0;
  state.connectFailures.length = 0;
  state.publishFailures.length = 0;
  state.roomName = response.livekit!.roomName;
  state.agentIdentity = livekitAgentIdentity(response.sessionId);
  return {
    rooms: state.rooms as unknown as RtcFixture['rooms'],
    sources: state.sources as unknown as RtcFixture['sources'],
    streams: state.streams,
    tracks: state.tracks as unknown as RtcFixture['tracks'],
    controlPackets: state.controlPackets,
    publishedTracks: state.publishedTracks,
    pushFrame(data: Int16Array) {
      const stream = state.streams[state.streams.length - 1];
      if (!stream) throw new Error('no microphone stream');
      stream.controller.enqueue({
        data,
        sampleRate: 16000,
        channels: 1,
        samplesPerChannel: data.length,
      });
    },
    errorFrame(reason: unknown) {
      const stream = state.streams[state.streams.length - 1];
      if (!stream) throw new Error('no microphone stream');
      stream.error(reason);
    },
    rejectConnectOnce(reason: unknown) {
      state.connectFailures.push(reason);
    },
    rejectPublishTrackOnce(reason: unknown) {
      state.publishFailures.push(reason);
    },
    emitControl(payload: VoiceClientPayload, sequence: number,
      identity = response.livekit!.participantIdentity) {
      const room = state.rooms[0] as RtcFixture['rooms'][number] | undefined;
      if (!room) throw new Error('no room');
      room.emit('dataReceived', new TextEncoder().encode(JSON.stringify({
        protocolVersion: 1,
        sessionId: response.sessionId,
        connectionEpoch: response.connectionEpoch,
        sequence,
        eventId: `control-${sequence}`,
        ...payload,
      })), { identity }, DataPacketKind.KIND_RELIABLE, LIVEKIT_CONTROL_TOPIC);
    },
  };
}
