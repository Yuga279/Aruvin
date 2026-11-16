/**
 * ============================================================================
 * FILE: webrtc-voice.ts
 * LOCATION: backend/src/benchmark/webrtc-voice.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Run one headless LiveKit participant and measure decoded response onset.
 *
 * ROLE IN PROJECT:
 *    Invoked only by runVoice after existing admission; never mints tokens,
 *    creates rooms or proves audible playback. Incomplete evidence fails closed.
 *
 * KEY COMPONENTS:
 *    - runWebRtcVoice: native connect, real-time PCM replay, decoded receipt.
 * ============================================================================
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, RemoteAudioTrack,
  Room, RoomEvent, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { INPUT_AUDIO, LIVEKIT_CONTROL_TOPIC, isLiveKitVoiceSessionResponse,
  livekitAgentIdentity, parseVoiceControl, type CreateVoiceSessionResponse,
  type VoiceClientPayload } from '../contracts/voice-wire.js';
import type { BenchmarkConfig, WireResult } from './runner.js';
import { DecodedReceipt } from './voice-measurements.js';

export async function runWebRtcVoice(options: {
  config: BenchmarkConfig; pcm: Uint8Array; session: CreateVoiceSessionResponse;
  result: WireResult; started: number; signal: AbortSignal;
  confirmDelivery?: (wire: WireResult, signal: AbortSignal) => Promise<boolean>;
}): Promise<void> {
  const { config, pcm, session, result, started, signal, confirmDelivery } = options;
  if (!isLiveKitVoiceSessionResponse(session)) throw new Error('BENCHMARK_TRANSPORT_MISMATCH');
  // Native direct capture (queue=0) requires 10 ms frames. The supported SDK
  // buffer accepts our 80 ms paced input; it is capacity, not a startup delay.
  const inputQueueMs = 1000;
  const room = new Room(), source = new AudioSource(16000, 1, inputQueueMs);
  const receipt = new DecodedReceipt(started);
  const agent = livekitAgentIdentity(session.sessionId);
  let sequence = 0, serverSequence = -1, stopped = false, connected = false;
  let disconnectTask: Promise<void> | undefined;
  const disconnect = () => {
    if (!connected) return Promise.resolve();
    connected = false;
    disconnectTask ??= room.disconnect();
    return disconnectTask;
  };
  let reader: ReadableStreamDefaultReader<AudioFrame> | undefined;
  let mediaTask: Promise<void> | undefined;
  let response: { turnId: string; responseId: string } | undefined;
  let endSeen = false;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  let resolveEnd!: () => void, rejectEnd!: (error: Error) => void;
  const ready = new Promise<void>((yes, no) => { resolveReady = yes; rejectReady = no; });
  const end = new Promise<void>((yes, no) => { resolveEnd = yes; rejectEnd = no; });
  void ready.catch(() => undefined); void end.catch(() => undefined);
  const fail = () => {
    if (stopped) return;
    stopped = true;
    const error = new Error('BENCHMARK_MEDIA_FAILED');
    rejectReady(error); rejectEnd(error);
    void reader?.cancel().catch(() => undefined);
  };
  const send = async (payload: VoiceClientPayload) => {
    if (!room.localParticipant || signal.aborted) return;
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({
      protocolVersion: 1, sessionId: session.sessionId, connectionEpoch: session.connectionEpoch,
      eventId: randomUUID(), sequence: sequence++, ...payload,
    })), { reliable: true, topic: LIVEKIT_CONTROL_TOPIC, destination_identities: [agent] });
  };
  Object.assign(result, { transport: 'webrtc',
    firstAudioBoundary: 'webrtc-decoded-nonzero-after-start-v1',
    firstMediaReceiptMs: null, firstTrackSubscribedMs: null, firstTrackScheduledMs: null,
    firstAudibleMs: null, speechEndToAudibleMs: null, interruptionToAudibleStopMs: null,
    speechEndToPlaybackEndMs: null, durableCompletionMs: null, inputAudioMs: 0 });
  room.on(RoomEvent.DataReceived, (bytes, participant, _kind, topic) => {
    if (stopped || topic !== LIVEKIT_CONTROL_TOPIC) return;
    try {
      if (participant?.identity !== agent || bytes.byteLength > 131072) throw new Error();
      const event = parseVoiceControl(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'server', 'live');
      if (event.sessionId !== session.sessionId || event.connectionEpoch !== session.connectionEpoch ||
        event.sequence <= serverSequence) throw new Error();
      serverSequence = event.sequence;
      if (event.type === 'session.ready') resolveReady();
      if (event.type === 'conversation.bound') result.sessionId = event.conversationId;
      if (event.type === 'voice.state' && event.agent === 'thinking' &&
        result.speechEndClockMs !== undefined && result.speechEndToThinkingMs === undefined) {
        const elapsed = performance.now() - result.speechEndClockMs;
        if (elapsed < 0) throw new Error();
        result.speechEndToThinkingMs = elapsed;
      }
      if (event.type === 'audio.start') {
        receipt.start(event.turnId, event.responseId);
        response = { turnId: event.turnId, responseId: event.responseId };
        result.turnId = event.turnId;
      }
      if (event.type === 'audio.end') {
        if (!response || response.turnId !== event.turnId || response.responseId !== event.responseId)
          throw new Error();
        endSeen = true;
        // Audio may trail reliable data. Do not stop the decoder on this control alone.
        if (receipt.snapshot().firstAudioMs !== null) resolveEnd();
      }
      if (event.type === 'response.cancelled' || event.type === 'session.error' || event.type === 'session.ended')
        fail();
    } catch { fail(); }
  });
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (stopped) return;
    if (participant.identity !== agent) return;
    if (!(track instanceof RemoteAudioTrack) || reader) { fail(); return; }
    result.firstTrackSubscribedMs = performance.now() - started;
    reader = new AudioStream(track, { sampleRate: 24000, numChannels: 1 }).getReader();
    mediaTask = (async () => {
      while (!stopped && !signal.aborted) {
        const frame = await reader!.read();
        if (frame.done) { if (!stopped) fail(); break; }
        receipt.frame(frame.value.data, frame.value.sampleRate, frame.value.channels);
        Object.assign(result, receipt.snapshot());
        if (endSeen && result.firstAudioMs !== null) resolveEnd();
      }
    })().catch(() => fail());
  });
  room.on(RoomEvent.Disconnected, fail);
  room.on(RoomEvent.Reconnecting, fail);
  room.on(RoomEvent.TrackUnsubscribed, fail);
  room.on(RoomEvent.TrackSubscriptionFailed, fail);
  signal.addEventListener('abort', fail, { once: true });
  const within = async <T>(promise: Promise<T>): Promise<T> => {
    let abort!: () => void;
    const aborted = new Promise<never>((_yes, no) => {
      abort = () => no(new Error('BENCHMARK_TIMEOUT'));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([promise, aborted]); }
    finally { signal.removeEventListener('abort', abort); }
  };
  const boundedClose = async (task: Promise<unknown> | undefined) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([task, new Promise<void>(yes => { timer = setTimeout(yes, 2000); })]);
    } finally { clearTimeout(timer); }
  };
  try {
    const connectTask = room.connect(session.livekit.url, session.livekit.participantToken).then(async () => {
      connected = true;
      if (stopped || signal.aborted) await disconnect();
    });
    // The retained handler also tears down a successful join that resolves after timeout.
    void connectTask.catch(() => undefined);
    await within(connectTask);
    if (stopped || signal.aborted || room.name !== session.livekit.roomName || !room.localParticipant)
      throw new Error('BENCHMARK_MEDIA_FAILED');
    const track = LocalAudioTrack.createAudioTrack('benchmark-input', source);
    await within(room.localParticipant.publishTrack(track,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE })));
    await within(send({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }));
    await within(ready);
    result.setupMs = performance.now() - started;
    const inputStarted = performance.now();
    receipt.inputStarted(inputStarted, config.speechEndMs!);
    result.speechEndClockMs = inputStarted + config.speechEndMs!;
    result.maxInputLatenessMs = 0;
    result.maxInputQueuedMs = 0;
    for (let offset = 0, n = 0; offset < pcm.length; offset += 2560, n++) {
      if (stopped || signal.aborted) throw new Error('BENCHMARK_MEDIA_FAILED');
      const due = inputStarted + n * 80;
      await sleep(Math.max(0, due - performance.now()), undefined, { signal });
      const at = performance.now(), late = at - due;
      result.maxInputLatenessMs = Math.max(result.maxInputLatenessMs ?? 0, late);
      if (late > 80) throw new Error('BENCHMARK_MEDIA_FAILED'); // no catch-up bursts
      const queued = source.queuedDuration;
      if (!Number.isFinite(queued) || queued < 0 || queued + 80 > inputQueueMs)
        throw new Error('BENCHMARK_MEDIA_FAILED');
      const samples = new Int16Array(1280);
      const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      for (let j = 0; j < 1280 && offset + j * 2 + 1 < pcm.length; j++)
        samples[j] = view.getInt16(offset + j * 2, true);
      if (n * 80 <= config.speechEndMs! && config.speechEndMs! < (n + 1) * 80)
        result.speechEndFrameSubmittedMs = at - started;
      await within(source.captureFrame(new AudioFrame(samples, 16000, 1, 1280)));
      result.maxInputQueuedMs = Math.max(result.maxInputQueuedMs ?? 0, source.queuedDuration);
      result.inputAudioMs! += 80;
    }
    await within(end);
    Object.assign(result, receipt.snapshot());
    // The callback must independently prove this exact turn settled durably.
    const confirmed = confirmDelivery ? await within(confirmDelivery(result, signal)) : false;
    if (!stopped && !signal.aborted && confirmed) {
      result.completed = true;
      result.outcome = 'completed';
      result.durableCompletionMs = performance.now() - started;
    } else {
      result.outcome = 'unverified';
      result.failureCode = 'BENCHMARK_UNPROVEN_PLAYBACK';
    }
  } catch {
    result.completed = false;
    result.outcome = signal.aborted ? 'timeout' : 'failed';
    result.failureCode = signal.aborted ? 'BENCHMARK_TIMEOUT' : 'BENCHMARK_MEDIA_FAILED';
  } finally {
    Object.assign(result, receipt.snapshot());
    signal.removeEventListener('abort', fail);
    stopped = true;
    source.clearQueue();
    // Never leave native work running after a Promise.race deadline.
    // A late connect completion also needs a bounded disconnect, below.
    await Promise.allSettled([
      reader?.cancel(), source.close(), disconnect(),
    ].map(task => boundedClose(task)));
    if (mediaTask) {
      // Releasing a reader lock with an outstanding read is unsafe; release only on settlement.
      void mediaTask.finally(() => reader?.releaseLock()).catch(() => undefined);
      await boundedClose(mediaTask);
    }
    room.removeAllListeners();
  }
}
