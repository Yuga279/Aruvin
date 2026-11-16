/**
 * ============================================================================
 * FILE: livekit-fakes.ts
 * LOCATION: frontend/src/api/testing/livekit-fakes.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic LiveKit Room/media doubles and a valid live session fixture.
 *
 * ROLE IN PROJECT:
 *    Provides the live-only test seams used by the browser WebRTC transport
 *    (Room, local microphone, audio element, reliable control channel) and by
 *    the remote-track playback helper, without touching the legacy PCM fakes.
 *
 * KEY COMPONENTS:
 *    - liveSession(): Valid `CreateVoiceSessionResponse` carrying a livekit descriptor.
 *    - rtcFixture(): Room/mic/audio/participant doubles, control emitter, packet log.
 *    - remoteAudioTrack(): Minimal structural RemoteAudioTrack double.
 * ============================================================================
 */

import { vi } from 'vitest';
import type { LocalAudioTrack, Room } from 'livekit-client';
import { RoomEvent } from 'livekit-client';
import { control, session } from '../../features/voice/transport/testing/voice-fakes.ts';
import { LIVEKIT_CONTROL_TOPIC, livekitParticipantIdentity, livekitRoomName,
  type VoiceServerEvent, type VoiceServerPayload } from '../voice-protocol.ts';

export function liveSession(epoch = 1) {
  return { ...session(epoch), livekit: {
    url: 'ws://127.0.0.1:7880', roomName: livekitRoomName('v1'),
    participantIdentity: livekitParticipantIdentity('aurvin-dev-user', 'v1', epoch),
    participantToken: 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJlMTIzNDU2',
  } };
}

export function rtcFixture() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const mediaTrack = Object.assign(new EventTarget(), { enabled: false, readyState: 'live' });
  const mic = { mediaStreamTrack: mediaTrack, mute: vi.fn(), unmute: vi.fn(),
    stop: vi.fn(() => { mediaTrack.readyState = 'ended'; }) };
  mic.mute.mockImplementation(async () => mic);
  mic.unmute.mockImplementation(async () => mic);
  const audio = Object.assign(new EventTarget(), {
    muted: true, autoplay: false, currentTime: 0, paused: true, readyState: 4,
    error: null as Error | null, srcObject: null as unknown, volume: 1,
    play: vi.fn(), pause: vi.fn(), remove: vi.fn(),
  });
  audio.play.mockImplementation(async () => { audio.paused = false; });
  audio.pause.mockImplementation(() => { audio.paused = true; });
  const participant = {
    publishTrack: vi.fn(async () => undefined),
    unpublishTrack: vi.fn(async () => undefined),
    publishData: vi.fn(async (_data: Uint8Array, _options: unknown) => undefined),
  };
  const room = {
    localParticipant: participant, remoteParticipants: new Map(), canPlaybackAudio: true,
    connect: vi.fn(), disconnect: vi.fn(), startAudio: vi.fn(), on: vi.fn(), off: vi.fn(),
  };
  room.connect.mockImplementation(async () => undefined);
  room.disconnect.mockImplementation(async (_stopTracks?: boolean) => undefined);
  room.startAudio.mockImplementation(async () => undefined);
  room.on.mockImplementation((name: string, fn: (...args: unknown[]) => void) => {
    const set = listeners.get(name) ?? new Set<(...args: unknown[]) => void>();
    set.add(fn); listeners.set(name, set);
    return room;
  });
  room.off.mockImplementation((name: string, fn: (...args: unknown[]) => void) => {
    listeners.get(name)?.delete(fn);
    return room;
  });
  const emit = (name: string, ...args: unknown[]) => {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(...args);
  };
  const microphone = vi.fn(async () => mic as unknown as LocalAudioTrack);
  const clock = { value: 0 };
  const options = { room: () => room as unknown as Room, microphone,
    element: () => audio as unknown as HTMLAudioElement, clock: () => clock.value };
  const event = (payload: VoiceServerPayload, sequence: number, epoch = 1,
    identity = 'aurvin-agent:v1', topic = LIVEKIT_CONTROL_TOPIC): VoiceServerEvent => {
    const body = control(payload, sequence, epoch);
    emit(RoomEvent.DataReceived, new TextEncoder().encode(body), { identity }, 0, topic);
    return JSON.parse(body) as VoiceServerEvent;
  };
  const ready = (epoch = 1) => event({ type: 'session.ready', limits: liveSession(epoch).limits,
    effectiveAudioSettings: liveSession(epoch).effectiveAudioSettings }, 0, epoch);
  const packets = () => participant.publishData.mock.calls.map(([bytes]) =>
    JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>);
  return { room, mic, mediaTrack, audio, participant, microphone, clock, options,
    emit, event, ready, packets, listeners };
}

export function remoteAudioTrack(overrides: Record<string, unknown> = {}) {
  const media = Object.assign(new EventTarget(), { readyState: 'live', kind: 'audio' });
  const track = { kind: 'audio', mediaStreamTrack: media, attach: vi.fn(), detach: vi.fn(),
    setVolume: vi.fn(), ...overrides };
  return track;
}
