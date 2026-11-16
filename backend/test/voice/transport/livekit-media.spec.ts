/**
 * ============================================================================
 * FILE: livekit-media.spec.ts
 * LOCATION: backend/test/voice/transport/livekit-media.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic checks for the admitted LiveKit media bridge lifecycle.
 *
 * ROLE IN PROJECT:
 *    Proves room join/publication, trusted microphone subscription, one flow
 *    open per session.start and bounded input draining without native RTC.
 *
 * KEY COMPONENTS:
 *    - fixture(): Trusted SessionContext plus fake room/track/stream fixture.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
// Import the RTC fake before any module that binds @livekit/rtc-node.
import { rtcFixture } from './livekit-fixture.js';
import { DataPacketKind, TrackKind, TrackSource } from '@livekit/rtc-node';
import { LiveKitMediaBridge, type LiveKitFlow } from '../../../src/voice/transport/livekit-media.js';
import {
  createSessionResponseFixture,
  enabledVoiceEnvironment,
} from '../../../src/contracts/testing/voice-fixtures.js';
import { loadVoiceConfig } from '../../../src/platform/config/voice-config.js';
import {
  INPUT_AUDIO,
  LIVEKIT_CONTROL_TOPIC,
  VoiceControlReassembler,
  livekitAgentIdentity,
  type VoiceClientEvent,
  type VoiceServerEvent,
} from '../../../src/contracts/voice-wire.js';
import type { LiveKitAdmissionTicket } from '../../../src/contracts/voice.js';
import {
  VoiceSessionError,
  type SessionContext,
  type VoiceObservation,
  type VoiceSink,
} from '../../../src/voice/session/voice-session.options.js';
import { settle } from './fixtures.js';

function optionsFixture() {
  const response = createSessionResponseFixture('live');
  const expiresAtMs = Date.now() + response.limits.connectMs;
  response.expiresAt = new Date(expiresAtMs).toISOString();
  const voice = loadVoiceConfig(enabledVoiceEnvironment());
  const context: SessionContext = {
    identity: {
      userId: 'aurvin-dev-user',
      source: 'authenticated-session',
      openRouterUser: 'aurvin-dev-user',
    },
    response,
    reservation: {
      reservationId: 'reservation-1',
      userId: 'aurvin-dev-user',
      conversationId: null,
      owner: { kind: 'live', voiceSessionId: response.sessionId },
    },
    voiceConfig: { ...voice, dictationWarningMs: 270000 },
    configSnapshot: null,
    assertPaidWork: vi.fn(),
  };
  const ticket: LiveKitAdmissionTicket = {
    transport: response.livekit!,
    agentIdentity: livekitAgentIdentity(response.sessionId),
    agentToken: 'offline-server-token',
    expiresAtMs,
    ttlSeconds: Math.ceil(response.limits.connectMs / 1000),
  };
  const observe = vi.fn((_observation: VoiceObservation) => undefined);
  const rtc = rtcFixture(response);
  const flow = {
    start: vi.fn(),
    input: vi.fn(async (_pcm: Uint8Array): Promise<void> => undefined),
    control: vi.fn(async (_event: VoiceClientEvent): Promise<void> => undefined),
    close: vi.fn(async (): Promise<void> => undefined),
    suspendInput: vi.fn(),
    resumeCapture: vi.fn(),
  };
  let openSignal!: AbortSignal;
  const open = vi.fn(async (
    _context: SessionContext,
    _sink: VoiceSink,
    signal: AbortSignal,
  ): Promise<LiveKitFlow> => {
    openSignal = signal;
    return flow;
  });
  const ended = vi.fn(async (_reason: 'completed' | 'cancelled' | 'error') => undefined);
  const disconnected = vi.fn(async (_recoverable: boolean) => undefined);
  const connect = () => LiveKitMediaBridge.connect({ context, ticket, open, ended, disconnected, observe });
  const events = () => {
    const reassembler = new VoiceControlReassembler('server', 'live', {
      sessionId: response.sessionId,
      connectionEpoch: response.connectionEpoch,
    });
    const out: VoiceServerEvent[] = [];
    for (const packet of rtc.controlPackets) {
      try {
        const result = reassembler.push(packet.bytes);
        if (result.status === 'complete') out.push(result.event);
      } catch {
        // Ignore malformed/partial packets in fixture parsing.
      }
    }
    return out;
  };
  const start = async () => {
    rtc.emitControl({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }, 0);
    await settle();
  };
  const subscribe = (
    identity = response.livekit!.participantIdentity,
    source: TrackSource = TrackSource.SOURCE_MICROPHONE,
    kind: TrackKind = TrackKind.KIND_AUDIO,
  ) => {
    const publication = {
      sid: `sid-${identity}-${source}`,
      kind,
      source,
      muted: false,
      setSubscribed: vi.fn(),
      track: undefined as unknown,
      participant: undefined as unknown,
    };
    const participant = { identity, trackPublications: new Map() };
    const track = { sid: publication.sid };
    publication.track = track;
    publication.participant = participant;
    rtc.rooms[0].emit('trackPublished', publication, participant);
    rtc.rooms[0].emit('trackSubscribed', track, publication, participant);
    return publication;
  };
  const unsubscribe = (publication: ReturnType<typeof subscribe>) => {
    rtc.rooms[0].emit('trackUnsubscribed', publication.track, publication, publication.participant);
  };
  return {
    response,
    voice,
    context,
    ticket,
    rtc,
    flow,
    open,
    ended,
    disconnected,
    observe,
    connect,
    events,
    start,
    subscribe,
    unsubscribe,
    signal: () => openSignal,
    assertPaidWork: vi.mocked(context.assertPaidWork!),
    emitControl: rtc.emitControl,
    pushFrame: rtc.pushFrame,
    browserIdentity: response.livekit!.participantIdentity,
  };
}

async function fixture() {
  const f = optionsFixture();
  const bridge = await f.connect();
  return { ...f, bridge };
}

it('joins and publishes without provider work, then starts exactly once on a valid control', async () => {
  const f = await fixture();
  try {
    expect(f.open).not.toHaveBeenCalled();
    expect(f.rtc.sources[0].args).toEqual([24000, 1, 2000]);
    expect(f.rtc.rooms[0].connect).toHaveBeenCalledWith(
      f.ticket.transport.url,
      f.ticket.agentToken,
      expect.objectContaining({ autoSubscribe: false }),
    );
    f.emitControl({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }, 0);
    f.emitControl({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }, 0);
    await settle();
    expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.flow.start).toHaveBeenCalledTimes(1);
    expect(f.events().map(e => e.type)).toEqual(['session.ready', 'voice.state']);
  } finally {
    await f.bridge.dispose();
  }
});

it('announces a final watermark and never treats publication as completion', async () => {
  const f = await fixture();
  try {
    await f.start();
    const ref = { turnId: 't1', responseId: 'r1' };
    f.bridge.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
    f.bridge.audio(ref, new Uint8Array(9600));
    f.bridge.watermark(ref);
    await settle();
    expect(f.events()).toContainEqual(expect.objectContaining({
      type: 'audio.watermark', ...ref,
      firstAudioSample: 0, queuedSamples: 4800, lastAudioSample: 4800, final: true,
    }));
    expect(f.events().some(e => e.type === 'audio.end')).toBe(false);
  } finally {
    await f.bridge.dispose();
  }
});

it('accepts only the expected participant microphone and drains reads while STT is blocked', async () => {
  const f = await fixture();
  try {
    await f.start();
    f.subscribe('intruder');
    expect(f.rtc.streams).toHaveLength(0);
    const publication = f.subscribe(f.browserIdentity);
    expect(publication.setSubscribed).toHaveBeenCalledWith(true);
    expect(f.rtc.streams[0].options).toEqual({ sampleRate: 16000, numChannels: 1, frameSizeMs: 80 });
    f.subscribe(f.browserIdentity, TrackSource.SOURCE_CAMERA);
    f.subscribe(f.browserIdentity);
    expect(f.rtc.streams).toHaveLength(1);
    let release!: () => void;
    f.flow.input.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    for (let i = 0; i < 13; i++) {
      f.pushFrame(new Int16Array(1280).fill(1000));
      await settle();
    }
    expect(f.flow.input).toHaveBeenCalledTimes(1);
    expect(f.rtc.streams[0].cancelled).toHaveBeenCalledTimes(1);
    expect(f.events()).toContainEqual(expect.objectContaining({ code: 'AUDIO_BUFFER_OVERFLOW' }));
    release();
  } finally {
    await f.bridge.dispose();
  }
});

it('resets retired partial PCM when the microphone track is replaced', async () => {
  const f = await fixture();
  try {
    await f.start();
    const first = f.subscribe(f.browserIdentity);
    f.pushFrame(new Int16Array(100).fill(1));
    await settle();
    expect(f.flow.input).not.toHaveBeenCalled();
    f.unsubscribe(first);
    expect(f.rtc.streams[0].cancelled).toHaveBeenCalledTimes(1);
    f.subscribe(f.browserIdentity);
    expect(f.rtc.streams).toHaveLength(2);
    f.pushFrame(new Int16Array(1280).fill(2));
    await settle();
    expect(f.flow.input).toHaveBeenCalledTimes(1);
    const pcm = f.flow.input.mock.calls[0][0] as Uint8Array;
    expect(new DataView(pcm.buffer, pcm.byteOffset).getInt16(0, true)).toBe(2);
  } finally {
    await f.bridge.dispose();
  }
});

it('denies startup without opening providers when paid work is unavailable', async () => {
  const f = await fixture();
  try {
    f.assertPaidWork.mockImplementation(() => {
      throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED');
    });
    f.emitControl({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }, 0);
    await settle();
    expect(f.open).not.toHaveBeenCalled();
    expect(f.events().some(e => e.type === 'session.ready')).toBe(false);
    expect(f.events()).toContainEqual(expect.objectContaining({ code: 'VOICE_QUOTA_EXHAUSTED' }));
  } finally {
    await f.bridge.dispose();
  }
});

it('distinguishes explicit end from disconnect and disposes local resources once', async () => {
  const f = await fixture();
  await f.start();
  f.emitControl({ type: 'session.end' }, 1);
  await settle();
  expect(f.ended).toHaveBeenCalledExactlyOnceWith('completed');
  expect(f.disconnected).not.toHaveBeenCalled();
  await Promise.all([f.bridge.dispose(), f.bridge.dispose()]);
  expect(f.flow.close).toHaveBeenCalledTimes(1);
  expect(f.rtc.sources[0].close).toHaveBeenCalledTimes(1);
  expect(f.rtc.rooms[0].disconnect).toHaveBeenCalledTimes(1);

  const g = await fixture();
  await g.start();
  g.rtc.rooms[0].emit('reconnecting');
  g.rtc.rooms[0].emit('disconnected');
  await settle();
  expect(g.disconnected).toHaveBeenCalledExactlyOnceWith(true);
  expect(g.ended).not.toHaveBeenCalled();
  expect(g.signal().aborted).toBe(true);
  await g.bridge.dispose();
});

it('stops paid work on pause and never reopens after quota denial', async () => {
  const f = await fixture();
  try {
    await f.start();
    f.bridge.pause('VOICE_QUOTA_EXHAUSTED', false);
    await settle();
    f.assertPaidWork.mockImplementation(() => {
      throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED');
    });
    f.emitControl({ type: 'input.unmute' }, 1);
    await settle();
    expect(f.flow.close).toHaveBeenCalledTimes(1);
    expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.events()).toContainEqual(expect.objectContaining({
      type: 'session.error', code: 'VOICE_QUOTA_EXHAUSTED', recovery: 'none', terminal: false,
    }));
  } finally {
    await f.bridge.dispose();
  }
});

it.each(['VOICE_DURATION_LIMIT', 'VOICE_QUOTA_EXHAUSTED'] as const)(
  'handles session.end after %s pause and keeps end terminal and idempotent',
  async code => {
    const f = await fixture();
    try {
      await f.start();
      f.bridge.pause(code, false);
      await settle();

      f.emitControl({ type: 'session.end' }, 1);
      f.emitControl({ type: 'session.end' }, 2);
      f.emitControl({ type: 'input.unmute' }, 3);
      await settle();

      expect(f.ended).toHaveBeenCalledExactlyOnceWith('completed');
      expect(f.open).toHaveBeenCalledTimes(1);
      expect(f.flow.start).toHaveBeenCalledTimes(1);
      expect(f.flow.close).toHaveBeenCalledTimes(1);
      expect(f.events()).toContainEqual(expect.objectContaining({
        type: 'session.ended', reason: 'completed', terminal: true,
      }));
    } finally {
      await f.bridge.dispose();
    }
  },
);

it('observes a terminal post-join control fault once without copying its sensitive payload', async () => {
  const f = await fixture();
  const sensitive = 'private transcript must not enter telemetry';
  try {
    f.rtc.rooms[0].emit('dataReceived', new TextEncoder().encode(JSON.stringify({
      protocolVersion: 1,
      sessionId: f.response.sessionId,
      connectionEpoch: f.response.connectionEpoch,
      sequence: 0,
      eventId: 'invalid-control',
      type: 'session.start',
      mode: 'live',
      audioSettings: INPUT_AUDIO,
      transcript: sensitive,
    })), { identity: f.browserIdentity }, DataPacketKind.KIND_RELIABLE, LIVEKIT_CONTROL_TOPIC);
    await vi.waitFor(() => expect(f.disconnected).toHaveBeenCalledExactlyOnceWith(false));

    expect(f.observe).toHaveBeenCalledExactlyOnceWith({
      stage: 'transport-error',
      code: 'INVALID_VOICE_CONTROL',
    });
    expect(JSON.stringify(f.observe.mock.calls)).not.toContain(sensitive);
  } finally {
    await f.bridge.dispose();
  }
});

it('closes a late provider open, clears queued media and ignores a retired epoch', async () => {
  const f = await fixture();
  let resolve!: (flow: LiveKitFlow) => void;
  f.open.mockImplementationOnce(() => new Promise<LiveKitFlow>(done => { resolve = done; }));
  f.emitControl({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }, 0);
  await settle();
  const disposing = f.bridge.dispose();
  resolve(f.flow);
  await disposing;
  f.emitControl({ type: 'input.unmute' }, 1);
  await settle();
  expect(f.flow.close).toHaveBeenCalledTimes(1);
  expect(f.flow.start).not.toHaveBeenCalled();
  expect(f.events().some(e => e.type === 'session.ready')).toBe(false);
  expect(f.rtc.sources[0].clearQueue).toHaveBeenCalled();
  expect(f.open).toHaveBeenCalledTimes(1);
});

it.each(['connect', 'publishTrack', 'captureFrame', 'publishData', 'read'] as const)(
  'stops local media cleanly after a %s failure without touching text runtime',
  async operation => {
    const f = optionsFixture();
    const textRuntimeClose = vi.fn();
    let bridge: LiveKitMediaBridge | undefined;
    if (operation === 'connect' || operation === 'publishTrack') {
      if (operation === 'connect') f.rtc.rejectConnectOnce(new Error('offline'));
      else f.rtc.rejectPublishTrackOnce(new Error('publish rejected'));
      await expect(f.connect()).rejects.toMatchObject({ code: 'VOICE_CONNECT_TIMEOUT' });
      expect(f.ended).not.toHaveBeenCalled();
      expect(f.disconnected).not.toHaveBeenCalled();
    } else {
      bridge = await f.connect();
      await f.start();
      if (operation === 'captureFrame') {
        f.rtc.sources[0].captureFrame.mockRejectedValueOnce(new Error('native capture'));
        const ref = { turnId: 't1', responseId: 'r1' };
        bridge.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
        bridge.audio(ref, new Uint8Array(9600));
        await settle();
        expect(f.events()).toContainEqual(expect.objectContaining({ code: 'VOICE_DELIVERY_UNKNOWN' }));
      } else if (operation === 'publishData') {
        f.rtc.rooms[0].localParticipant.publishData.mockRejectedValueOnce(new Error('lane failed'));
        bridge.pause('STT_UNAVAILABLE');
        await vi.waitFor(() => expect(f.disconnected).toHaveBeenCalledWith(false));
      } else {
        f.subscribe(f.browserIdentity);
        f.rtc.errorFrame(new Error('native read failed'));
        await settle();
        expect(f.events()).toContainEqual(expect.objectContaining({ code: 'MEDIA_GATE_UNAVAILABLE' }));
      }
    }
    await bridge?.dispose();
    expect(f.rtc.sources[0].close).toHaveBeenCalled();
    expect(f.rtc.tracks[0].close).toHaveBeenCalled();
    expect(f.rtc.rooms[0].disconnect).toHaveBeenCalled();
    expect(textRuntimeClose).not.toHaveBeenCalled();
    const second = optionsFixture();
    const secondBridge = await second.connect();
    expect(second.rtc.rooms[0].connect).toHaveBeenCalledTimes(1);
    await secondBridge.dispose();
  },
);

it('expires the finite handshake, clears timers and drains without reopening', async () => {
  vi.useFakeTimers();
  try {
    const f = await fixture();
    expect(f.open).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(f.response.limits.connectMs + 1);
    await vi.waitFor(() => expect(f.disconnected).toHaveBeenCalledExactlyOnceWith(false));
    expect(f.events()).toContainEqual(expect.objectContaining({
      type: 'session.error', code: 'VOICE_CONNECT_TIMEOUT', terminal: true,
    }));
    await f.bridge.dispose();
    expect(vi.getTimerCount()).toBe(0);

    const g = await fixture();
    await g.start();
    await g.bridge.dispose();
    expect(g.open).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('waits for the retired flow drain before reopening one fresh flow on recoverable unmute', async () => {
  const f = await fixture();
  try {
    await f.start();
    let release!: () => void;
    f.flow.close.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    f.bridge.pause('STT_UNAVAILABLE');
    f.emitControl({ type: 'input.unmute' }, 1);
    await settle();
    expect(f.open).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(f.open).toHaveBeenCalledTimes(2));
    expect(f.flow.start).toHaveBeenCalledTimes(2);
  } finally {
    await f.bridge.dispose();
  }
});

it('refuses to resume when the retired flow evidence drain rejects', async () => {
  const f = await fixture();
  try {
    await f.start();
    f.flow.close.mockRejectedValueOnce(new Error('drain failed'));
    f.bridge.pause('STT_UNAVAILABLE');
    f.emitControl({ type: 'input.unmute' }, 1);
    await settle();
    expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.events()).toContainEqual(expect.objectContaining({
      type: 'session.error', code: 'VOICE_DELIVERY_UNKNOWN', terminal: false,
    }));
  } finally {
    await f.bridge.dispose();
  }
});
