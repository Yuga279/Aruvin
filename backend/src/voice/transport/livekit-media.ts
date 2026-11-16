/**
 * ============================================================================
 * FILE: livekit-media.ts
 * LOCATION: backend/src/voice/transport/livekit-media.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bridge one admitted LiveKit room to Aurvin's existing LiveFlow lifecycle.
 *
 * ROLE IN PROJECT:
 *    Subscribes to the trusted browser microphone, publishes bounded assistant
 *    audio/control packets, and fences pause, interruption and room loss without
 *    creating a second conversation runtime or releasing P2's admission.
 *
 * KEY COMPONENTS:
 *    - LiveKitFlow: The live-flow surface consumed by this transport.
 *    - LiveKitMediaBridge: VoiceSink, room/media owner and finite lifecycle.
 * ============================================================================
 */

import {
  AudioSource,
  AudioStream,
  DataPacketKind,
  LocalAudioTrack,
  Room,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  type AudioFrame,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from '@livekit/rtc-node';
import type { LiveKitAdmissionTicket } from '../../contracts/voice.js';
import {
  LIVEKIT_CONTROL_TOPIC,
  LIVEKIT_TEARDOWN_TIMEOUT_MS,
  MAX_VOICE_CONTROL_BYTES,
  isLiveKitVoiceSessionResponse,
  livekitAgentIdentity,
  livekitParticipantIdentity,
  livekitRoomName,
  type VoiceClientEvent,
  type VoiceErrorCode,
  type VoiceResponseRef,
  type VoiceServerPayload,
} from '../../contracts/voice-wire.js';
import type { LiveFlow } from '../session/live-flow.js';
import {
  VoiceSessionError,
  fault,
  voiceError,
  type SessionContext,
  type VoiceObservation,
  type VoiceSink,
} from '../session/voice-session.options.js';
import { LiveKitControls } from './livekit-control.js';
import { LiveKitInput } from './livekit-input.js';
import { LiveKitOutput } from './livekit-output.js';

export type LiveKitFlow = Pick<LiveFlow,
  'start' | 'input' | 'control' | 'close' | 'suspendInput' | 'resumeCapture'>;

export type LiveKitMediaOptions = {
  context: SessionContext;
  ticket: LiveKitAdmissionTicket;
  open(context: SessionContext, sink: VoiceSink, signal: AbortSignal): Promise<LiveKitFlow>;
  ended(reason: 'completed' | 'cancelled' | 'error'): Promise<void>;
  disconnected(recoverable: boolean): Promise<void>;
  observe?(observation: VoiceObservation): void;
};

const TERMINAL_CODES: ReadonlySet<VoiceErrorCode> = new Set([
  'VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT', 'VOICE_DISABLED',
  'VOICE_SESSION_ENDED', 'VOICE_RECONNECT_TIMEOUT',
]);

export class LiveKitMediaBridge implements VoiceSink {
  private readonly room: Room;
  private readonly source: AudioSource;
  private readonly track: LocalAudioTrack;
  private readonly controls: LiveKitControls;
  private readonly output: LiveKitOutput;
  private readonly abort = new AbortController();
  private flow?: LiveKitFlow;
  private input?: LiveKitInput;
  private reader?: ReadableStreamDefaultReader<AudioFrame>;
  private microphoneTrack?: RemoteTrack;
  private microphoneSid?: string;
  private starting?: Promise<LiveKitFlow | undefined>;
  private pausing?: Promise<void>;
  private pauseDrainFailed = false;
  private closing?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private ready = false;
  private paused = false;
  private closed = false;
  private failing = false;
  private finished = false;
  private reconnecting = false;
  private lastInput?: 'listening' | 'suspended' | 'muted';

  private readonly onData = (
    payload: Uint8Array,
    participant?: RemoteParticipant,
    kind?: DataPacketKind,
    topic?: string,
  ) => {
    this.controls.receive(
      payload,
      participant?.identity,
      kind === DataPacketKind.KIND_RELIABLE,
      topic,
    );
  };

  private readonly onTrackPublished = (
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => this.consider(publication, participant);

  private readonly onTrackSubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => this.subscribed(track, publication, participant);

  private readonly onTrackUnsubscribed = (
    track: RemoteTrack,
    _publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => this.unsubscribed(track, participant);

  private readonly onReconnecting = () => this.lost();

  private readonly onDisconnected = () => this.lost();

  private readonly onParticipantDisconnected = (participant: RemoteParticipant) => {
    if (participant.identity === this.options.ticket.transport.participantIdentity) this.lost();
  };

  private constructor(private readonly options: LiveKitMediaOptions) {
    this.assertDescriptor();
    this.room = new Room();
    this.source = new AudioSource(24000, 1, options.context.response.limits.outputQueueMs);
    this.track = LocalAudioTrack.createAudioTrack('aurvin-assistant', this.source);
    this.controls = new LiveKitControls(
      options.context.response,
      bytes => this.room.localParticipant!.publishData(bytes, {
        reliable: true,
        topic: LIVEKIT_CONTROL_TOPIC,
        destination_identities: [options.ticket.transport.participantIdentity],
      }),
      event => this.control(event),
      code => this.fail(code),
    );
    this.output = new LiveKitOutput(
      this.source,
      options.context.response.limits.outputQueueMs,
      payload => this.controls.send(payload),
      code => this.pause(code),
    );
  }

  static async connect(options: LiveKitMediaOptions): Promise<LiveKitMediaBridge> {
    const bridge = new LiveKitMediaBridge(options);
    try {
      await bridge.join();
      return bridge;
    } catch (error) {
      await bridge.dispose().catch(() => undefined);
      throw error;
    }
  }

  private assertDescriptor() {
    const { context, ticket } = this.options;
    const response = context.response;
    if (response.mode !== 'live' || !isLiveKitVoiceSessionResponse(response)) {
      fault('VOICE_BINDING_MISMATCH');
    }
    const descriptor = response.livekit;
    if (
      descriptor.url !== ticket.transport.url ||
      descriptor.roomName !== ticket.transport.roomName ||
      descriptor.participantIdentity !== ticket.transport.participantIdentity ||
      descriptor.participantToken !== ticket.transport.participantToken ||
      descriptor.roomName !== livekitRoomName(response.sessionId) ||
      descriptor.participantIdentity !== livekitParticipantIdentity(
        context.identity.userId, response.sessionId, response.connectionEpoch) ||
      ticket.agentIdentity !== livekitAgentIdentity(response.sessionId)
    ) {
      fault('VOICE_BINDING_MISMATCH');
    }
    if (!Number.isFinite(ticket.expiresAtMs) || ticket.expiresAtMs <= Date.now()) {
      fault('VOICE_CONNECT_TIMEOUT');
    }
  }

  private async join() {
    const { context, ticket } = this.options;
    const limits = context.response.limits;
    this.room.on('dataReceived', this.onData);
    this.room.on('trackPublished', this.onTrackPublished);
    this.room.on('trackSubscribed', this.onTrackSubscribed);
    this.room.on('trackUnsubscribed', this.onTrackUnsubscribed);
    this.room.on('reconnecting', this.onReconnecting);
    this.room.on('disconnected', this.onDisconnected);
    this.room.on('participantDisconnected', this.onParticipantDisconnected);
    const remaining = Math.max(
      1,
      Math.min(ticket.expiresAtMs, Date.now() + limits.connectMs) - Date.now(),
    );
    try {
      await this.bounded(
        this.room.connect(ticket.transport.url, ticket.agentToken, {
          autoSubscribe: false,
          dynacast: false,
          dataStream: { maxPayloadByteLength: MAX_VOICE_CONTROL_BYTES },
        }),
        limits.connectMs,
        'VOICE_CONNECT_TIMEOUT',
      );
    } catch (error) {
      throw voiceError(error, 'VOICE_CONNECT_TIMEOUT');
    }
    if (this.closed) throw new VoiceSessionError('VOICE_CONNECT_TIMEOUT');
    if (
      this.room.name !== ticket.transport.roomName ||
      this.room.localParticipant?.identity !== ticket.agentIdentity
    ) {
      fault('VOICE_BINDING_MISMATCH');
    }
    try {
      await this.bounded(
        this.room.localParticipant!.publishTrack(
          this.track,
          new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
        ),
        limits.connectMs,
        'VOICE_CONNECT_TIMEOUT',
      );
    } catch (error) {
      throw voiceError(error, 'VOICE_CONNECT_TIMEOUT');
    }
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        this.consider(publication, participant);
      }
    }
    this.timer = setTimeout(() => this.fail('VOICE_CONNECT_TIMEOUT'), remaining);
    this.timer.unref?.();
  }

  private consider(publication: RemoteTrackPublication, participant: RemoteParticipant) {
    if (this.closed) return;
    if (
      participant.identity !== this.options.ticket.transport.participantIdentity ||
      publication.kind !== TrackKind.KIND_AUDIO ||
      publication.source !== TrackSource.SOURCE_MICROPHONE
    ) {
      return;
    }
    const sid = publication.sid ?? 'microphone';
    if (this.microphoneSid === sid) return;
    this.microphoneSid = sid;
    publication.setSubscribed(true);
  }

  private subscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) {
    if (this.closed || participant.identity !== this.options.ticket.transport.participantIdentity) return;
    if (
      publication.kind !== TrackKind.KIND_AUDIO ||
      publication.source !== TrackSource.SOURCE_MICROPHONE
    ) {
      return;
    }
    if (this.microphoneTrack) return;
    this.microphoneTrack = track;
    this.microphoneSid = publication.sid ?? this.microphoneSid;
    this.attachMicrophone(track);
  }

  private unsubscribed(track: RemoteTrack, participant: RemoteParticipant) {
    if (participant.identity !== this.options.ticket.transport.participantIdentity ||
      this.microphoneTrack !== track) return;
    this.retireMicrophone();
    this.microphoneTrack = undefined;
    this.microphoneSid = undefined;
  }

  private retireMicrophone() {
    const reader = this.reader;
    this.reader = undefined;
    if (reader) void reader.cancel().catch(() => undefined);
    // A replacement track must not inherit the retired track's partial or queued PCM.
    try {
      this.input?.setEnabled(false);
      this.input?.setEnabled(true);
    } catch {
      // The gate may already be closed during teardown.
    }
  }

  private attachMicrophone(track: RemoteTrack) {
    // ponytail: AudioStream exposes no capacity option; a blocked Node event loop can still
    // backlog inside the SDK/FFI. Application overflow cancels this reader immediately.
    if (this.closed || this.reader) return;
    const stream = new AudioStream(track, { sampleRate: 16000, numChannels: 1, frameSizeMs: 80 });
    const reader = stream.getReader();
    this.reader = reader;
    void this.readLoop(reader);
  }

  private async readLoop(reader: ReadableStreamDefaultReader<AudioFrame>) {
    try {
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || this.paused || !this.ready) continue;
        this.input?.push(value);
      }
    } catch {
      if (!this.closed && !this.paused) this.pause('MEDIA_GATE_UNAVAILABLE');
    } finally {
      if (this.reader === reader) this.reader = undefined;
    }
  }

  outputSamples() {
    return this.output.outputSamples();
  }

  event(payload: VoiceServerPayload) {
    if (this.closed) return;
    if (payload.type === 'voice.state' && payload.input !== this.lastInput) {
      this.lastInput = payload.input;
      this.input?.setUploading(payload.input === 'listening');
    }
    this.output.event(payload);
  }

  audio(ref: VoiceResponseRef, pcm: Uint8Array) {
    if (this.paused) return;
    this.output.audio(ref, pcm);
  }

  invalidate(ref: VoiceResponseRef) {
    this.output.invalidate(ref);
  }

  /** Emits the final generated-sample ceiling before a browser progress ACK. */
  watermark(ref: VoiceResponseRef) {
    this.output.finalize(ref);
  }

  finish(reason: 'completed' | 'cancelled' | 'error') {
    if (this.closed || this.finished) return;
    this.finished = true;
    this.controls.send({ type: 'session.ended', reason, terminal: true });
    void this.options.ended(reason).catch(() => undefined);
  }

  pause(code: VoiceErrorCode, recoverable = !TERMINAL_CODES.has(code)) {
    if (this.closed || this.paused) return;
    this.paused = true;
    clearTimeout(this.timer);
    this.input?.close();
    this.input = undefined;
    const reader = this.reader;
    this.reader = undefined;
    if (reader) void reader.cancel().catch(() => undefined);
    try {
      this.output.clear();
    } catch {
      // Still stop providers and reconcile.
    }
    try {
      this.controls.send({
        type: 'session.error',
        code,
        recovery: recoverable ? 'resume_call' : 'none',
        recoverable,
        terminal: false,
      });
    } catch {
      // A lost control lane must not prevent stopping paid work.
    }
    this.pausing = (async () => {
      const flow = this.flow ?? await this.starting?.catch(() => undefined);
      await flow?.close();
      if (this.flow === flow) this.flow = undefined;
    })().catch(() => {
      this.pauseDrainFailed = true;
    });
  }

  private async resumePaidWork() {
    await this.pausing;
    if (this.closed || !this.paused) return;
    if (this.pauseDrainFailed) {
      this.controls.send({
        type: 'session.error',
        code: 'VOICE_DELIVERY_UNKNOWN',
        recovery: 'none',
        recoverable: false,
        terminal: false,
      });
      return;
    }
    try {
      this.options.context.assertPaidWork?.();
      const firstReady = !this.ready;
      const flow = await this.options.open(this.options.context, this, this.abort.signal);
      if (this.closed || !this.paused) {
        await flow.close().catch(() => undefined);
        return;
      }
      try {
        this.options.context.assertPaidWork?.();
      } catch (error) {
        await flow.close().catch(() => undefined);
        this.pause(voiceError(error, 'VOICE_QUOTA_EXHAUSTED').code, false);
        return;
      }
      this.flow = flow;
      this.input = new LiveKitInput(
        this.options.context.response.limits.inputQueueMs,
        pcm => flow.input(pcm),
        () => flow.suspendInput('quiet'),
        () => flow.resumeCapture(),
        code => this.pause(code),
      );
      this.paused = false;
      this.ready = true;
      if (firstReady) {
        this.controls.send({
          type: 'session.ready',
          limits: this.options.context.response.limits,
          effectiveAudioSettings: this.options.context.response.effectiveAudioSettings,
        });
      }
      flow.start();
      this.event({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' });
      if (this.microphoneTrack) this.attachMicrophone(this.microphoneTrack);
    } catch (error) {
      this.pause(voiceError(error, 'STT_UNAVAILABLE').code);
    }
  }

  async control(event: VoiceClientEvent) {
    if (this.closed) fault('VOICE_INVALID_STATE');
    if (event.type === 'session.end') {
      this.finish('completed');
      return;
    }
    if (this.finished) return;
    if (this.paused) {
      if (event.type === 'input.unmute') await this.resumePaidWork();
      return;
    }
    if (!this.ready) {
      if (event.type !== 'session.start') fault('VOICE_INVALID_STATE');
      if (this.starting) fault('VOICE_INVALID_STATE');
      await this.startFlow();
      return;
    }
    if (event.type === 'session.start') fault('VOICE_INVALID_STATE');
    if (event.type === 'input.mute') {
      this.input?.setEnabled(false);
      await this.flow!.control(event);
      return;
    }
    if (event.type === 'input.unmute') {
      await this.flow!.control(event);
      this.input?.setEnabled(true);
      return;
    }
    await this.flow!.control(event);
  }

  private startFlow(): Promise<LiveKitFlow | undefined> {
    const task = (async (): Promise<LiveKitFlow | undefined> => {
      try {
        this.options.context.assertPaidWork?.();
        const flow = await this.options.open(this.options.context, this, this.abort.signal);
        if (this.closed || this.paused) {
          await flow.close().catch(() => undefined);
          return undefined;
        }
        try {
          this.options.context.assertPaidWork?.();
        } catch (error) {
          await flow.close().catch(() => undefined);
          this.pause(voiceError(error, 'VOICE_QUOTA_EXHAUSTED').code, false);
          return undefined;
        }
        this.flow = flow;
        this.input = new LiveKitInput(
          this.options.context.response.limits.inputQueueMs,
          pcm => flow.input(pcm),
          () => flow.suspendInput('quiet'),
          () => flow.resumeCapture(),
          code => this.pause(code),
        );
        if (this.closed) {
          this.flow = undefined;
          await flow.close().catch(() => undefined);
          return undefined;
        }
        this.controls.send({
          type: 'session.ready',
          limits: this.options.context.response.limits,
          effectiveAudioSettings: this.options.context.response.effectiveAudioSettings,
        });
        this.ready = true;
        clearTimeout(this.timer);
        flow.start();
        this.event({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' });
        if (this.microphoneTrack) this.attachMicrophone(this.microphoneTrack);
        return flow;
      } catch (error) {
        if (!this.closed) this.pause(voiceError(error, 'STT_UNAVAILABLE').code);
        return undefined;
      }
    })();
    this.starting = task;
    void task.finally(() => {
      if (this.starting === task) this.starting = undefined;
    }).catch(() => undefined);
    return task;
  }

  private fail(code: VoiceErrorCode) {
    if (this.closed || this.failing) return;
    this.failing = true;
    clearTimeout(this.timer);
    try {
      this.options.observe?.({ stage: 'transport-error', code });
    } catch {
      // Telemetry must not interfere with terminal cleanup.
    }
    try {
      this.controls.send({
        type: 'session.error',
        code,
        recovery: 'return_to_chat',
        recoverable: false,
        terminal: true,
      });
    } catch {
      // The lane may already be gone; local teardown below remains authoritative.
    }
    void (async () => {
      // Deliver one terminal error before closing the control lane, bounded so a dead lane cannot hang teardown.
      await this.bounded(this.controls.flush(), LIVEKIT_TEARDOWN_TIMEOUT_MS, 'VOICE_DELIVERY_UNKNOWN')
        .catch(() => undefined);
      await this.dispose().catch(() => undefined);
      await this.options.disconnected(false).catch(() => undefined);
    })();
  }

  private lost() {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    const notify = () => {
      this.options.disconnected(true).catch(() => undefined);
    };
    void this.dispose().then(notify, notify);
  }

  private async bounded<T>(operation: Promise<T>, ms: number, code: VoiceErrorCode): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new VoiceSessionError(code)), Math.max(1, ms));
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private removeRoomHandlers() {
    this.room.off('dataReceived', this.onData);
    this.room.off('trackPublished', this.onTrackPublished);
    this.room.off('trackSubscribed', this.onTrackSubscribed);
    this.room.off('trackUnsubscribed', this.onTrackUnsubscribed);
    this.room.off('reconnecting', this.onReconnecting);
    this.room.off('disconnected', this.onDisconnected);
    this.room.off('participantDisconnected', this.onParticipantDisconnected);
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.abort.abort();
    clearTimeout(this.timer);
    this.input?.close();
    this.input = undefined;
    try {
      this.output.close();
    } catch {
      // Preserve provider cleanup below.
    }
    this.controls.close();
    this.removeRoomHandlers();
    this.closing = (async () => {
      const reader = this.reader;
      this.reader = undefined;
      const cleanup = await Promise.allSettled([
        reader ? reader.cancel() : Promise.resolve(),
        this.bounded(this.source.close(), LIVEKIT_TEARDOWN_TIMEOUT_MS, 'VOICE_DELIVERY_UNKNOWN'),
        this.bounded(this.track.close(false), LIVEKIT_TEARDOWN_TIMEOUT_MS, 'VOICE_DELIVERY_UNKNOWN'),
        this.bounded(this.room.disconnect(), LIVEKIT_TEARDOWN_TIMEOUT_MS, 'VOICE_DELIVERY_UNKNOWN'),
      ]);
      await this.pausing;
      const flow = this.flow ?? await this.starting?.catch(() => undefined);
      await flow?.close();
      if (cleanup.some(result => result.status === 'rejected')) {
        throw new VoiceSessionError('VOICE_DELIVERY_UNKNOWN');
      }
    })();
    return this.closing;
  }
}
