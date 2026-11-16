/**
 * ============================================================================
 * FILE: livekit-voice-client.ts
 * LOCATION: frontend/src/api/livekit-voice-client.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Live-only voice transport over one LiveKit Room plus one native microphone.
 *
 * ROLE IN PROJECT:
 *    Replaces the PCM WebSocket composition for live calls while dictation keeps
 *    VoiceClient, AudioCaptureService, and AudioPlaybackService unchanged. Owns the
 *    Room generation, the microphone, the reliable Aurvin control channel, fenced
 *    epochs/sequences, and bounded reauthorization. No PCM input API exists here.
 *
 * KEY COMPONENTS:
 *    - LiveKitVoiceClient: Admission, join/publish, control send/receive, mic ownership,
 *      playback delegation, bounded recovery, idempotent teardown.
 *    - LiveKitVoiceClientOptions / LiveVoiceProgress: Public seams and progress snapshot.
 * ============================================================================
 */

import { Room, RoomEvent, Track, createLocalAudioTrack } from 'livekit-client';
import type { LocalAudioTrack, RemoteAudioTrack } from 'livekit-client';
import { LiveTrackPlayback } from '../features/voice/audio/live-track-playback.ts';
import { ApiClientError } from './client.ts';
import type { VoiceClientOptions } from './voice-client.ts';
import {
  DEFAULT_VOICE_LIMITS, INPUT_AUDIO, LIVEKIT_CONTROL_TOPIC, LIVEKIT_TEARDOWN_TIMEOUT_MS,
  MAX_VOICE_CONTROL_BYTES, VoiceControlReassembler, encodeVoiceControlPackets,
  isCreateVoiceSessionResponse, isLiveKitVoiceSessionResponse, livekitAgentIdentity,
} from './voice-protocol.ts';
import type {
  CreateVoiceSessionResponse, VoiceClientPayload, VoiceLiveKitTransport, VoicePlaybackProof,
  VoiceServerEvent,
} from './voice-protocol.ts';

export type LiveKitVoiceClientOptions = Pick<VoiceClientOptions,
  'event' | 'lost' | 'recovered' | 'error' | 'ended' | 'reauthorize' | 'id' | 'random'> & {
  room?: () => Room;
  microphone?: () => Promise<LocalAudioTrack>;
  element?: () => HTMLAudioElement;
  microphoneLost?: () => void;
  connectMs?: number;
  /** Monotonic milliseconds; deterministic test seam for playout observation. */
  clock?: () => number;
};

export type LiveVoiceProgress = { playedSamples: number; playedMs: number; proof: VoicePlaybackProof };

/** An admitted live session: the descriptor is present and bound to its own epoch. */
type LiveSession = CreateVoiceSessionResponse & { mode: 'live'; livekit: VoiceLiveKitTransport };
/** Structural view of the emitter so one listener registry serves every SDK event. */
type RoomHandler = (...args: never[]) => void;
type LiveRoom = { on(event: string, handler: RoomHandler): unknown; off(event: string, handler: RoomHandler): unknown };
type Peer = { identity?: string; trackPublications?: Map<string, unknown> };
type Publication = { kind?: string; setSubscribed?: (subscribed: boolean) => void };
/** One Room generation: its listeners, send path, reassembly, and playout ownership. */
type Generation = {
  room: Room;
  playback: LiveTrackPlayback;
  reassembler: VoiceControlReassembler<'server'>;
  sending: { queue: Uint8Array[]; running: boolean; pending: number };
  listeners: { event: string; handler: RoomHandler }[];
};

// ponytail: at most 32 queued control packets; overflow closes the transport instead of
// accumulating promises without bound. Upgrade path: per-topic flow control, not a bigger queue.
const MAX_QUEUED_PACKETS = 32;
/** First retry delay; doubles per attempt up to the SDK-independent 2 s ceiling. */
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 2000;
const CAPTURE_CONSTRAINTS = { channelCount: 1, echoCancellation: true, noiseSuppression: true,
  autoGainControl: true } as const;
const MICROPHONE_CODES: Record<string, string> = {
  NotAllowedError: 'MICROPHONE_DENIED', SecurityError: 'MICROPHONE_DENIED',
  NotFoundError: 'MICROPHONE_UNAVAILABLE', NotReadableError: 'MICROPHONE_UNAVAILABLE',
  OverconstrainedError: 'MICROPHONE_UNAVAILABLE',
};

/** Device labels and browser/SDK text never leave this module; only these codes do. */
function microphoneCode(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name) : '';
  return MICROPHONE_CODES[name] ?? 'UNSUPPORTED_AUDIO';
}

function createRoom(): Room {
  return new Room({
    publishDefaults: { stopMicTrackOnMute: false },
    reconnectPolicy: { nextRetryDelayInMs: () => null },
    disconnectOnPageLeave: false,
  });
}

function captureMicrophone(): Promise<LocalAudioTrack> {
  return createLocalAudioTrack({ ...CAPTURE_CONSTRAINTS });
}

export class LiveKitVoiceClient {
  private readonly options: LiveKitVoiceClientOptions;
  private session?: LiveSession;
  private active?: Generation;
  private generation = 0;
  private admittedAt = 0;
  private ready = false;
  private closed = false;
  private tx = 0;
  private rx = -1;
  private mic?: LocalAudioTrack;
  private micEnded?: () => void;
  private captureToken = 0;
  private captureTimer?: ReturnType<typeof setTimeout>;
  private preparing?: Promise<void>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private deadlineTimer?: ReturnType<typeof setTimeout>;
  private reauth?: AbortController;
  private recovering = false;
  private retryAttempt = 0;
  private deadline = 0;
  private lostFor = -1;
  private closing?: Promise<void>;

  constructor(options: LiveKitVoiceClientOptions = {}) { this.options = options; }

  /** Gesture entry: unlock Room output and capture one disabled native mic, once. */
  prepare(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('VOICE_INVALID_STATE'));
    if (this.preparing) return this.preparing;
    const unlock = this.ensureRoom().startAudio();
    const capture = this.mic ? Promise.resolve(this.mic) : this.capture();
    const pending = Promise.allSettled([unlock, capture]).then(([audio, track]) => {
      if (track.status === 'rejected') throw track.reason;
      if (audio.status === 'rejected' || this.room()?.canPlaybackAudio === false) {
        throw new Error('PLAYBACK_BLOCKED');
      }
    });
    const settled: Promise<void> = pending.finally(() => {
      if (this.preparing === settled) this.preparing = undefined;
    });
    this.preparing = settled;
    return settled;
  }

  async connect(session: CreateVoiceSessionResponse): Promise<void> {
    if (!isLiveKitVoiceSessionResponse(session)) throw new Error('VOICE_DISABLED');
    if (Date.parse(session.expiresAt) <= Date.now()) throw new Error('VOICE_CONNECT_TIMEOUT');
    if (this.closed || this.session) throw new Error('VOICE_INVALID_STATE');
    this.session = session;
    this.admittedAt = Date.now();
    this.ready = false;
    this.tx = 0;
    this.rx = -1;
    this.ensureRoom();
    await this.join(false);
  }

  control(payload: Exclude<VoiceClientPayload, { type: 'session.start' }>): boolean {
    return this.send(payload);
  }

  async setInputEnabled(enabled: boolean): Promise<void> {
    const mic = this.mic;
    if (!mic) {
      if (enabled) throw new Error('MICROPHONE_LOST');
      return;
    }
    mic.mediaStreamTrack.enabled = enabled;
    if (enabled) await mic.unmute();
    else await mic.mute();
  }

  stopInput(): void { this.retireMic(true); }

  async unlock(): Promise<void> {
    try { await this.ensureRoom().startAudio(); } catch { throw new Error('PLAYBACK_BLOCKED'); }
    if (this.room()?.canPlaybackAudio === false) throw new Error('PLAYBACK_BLOCKED');
  }

  invalidate(responseId?: string): void {
    const playback = this.active?.playback;
    if (!playback) return;
    if (responseId !== undefined && playback.activeResponse()?.responseId !== responseId) return;
    playback.interrupt();
  }

  progress(): LiveVoiceProgress {
    return this.active?.playback.progress() ?? { playedSamples: 0, playedMs: 0, proof: 'proven' };
  }

  isDrained(): boolean { return this.active?.playback.isDrained() ?? false; }

  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    const closing = this.shutdown();
    this.closing = closing;
    return closing;
  }

  /** Runs synchronously up to the bounded SDK disconnect; returns one shared promise. */
  private async shutdown(): Promise<void> {
    this.closed = true;
    this.generation++;
    this.ready = false;
    this.recovering = false;
    this.clearConnect();
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    clearTimeout(this.deadlineTimer);
    this.deadlineTimer = undefined;
    this.reauth?.abort();
    this.reauth = undefined;
    clearTimeout(this.captureTimer);
    this.captureTimer = undefined;
    this.captureToken++;
    this.stopInput();
    const active = this.detach();
    if (active) await this.retire(active.room, true);
  }

  private room(): Room | undefined { return this.active?.room; }

  private ensureRoom(): Room { return (this.active ?? this.open()).room; }

  private open(): Generation {
    const room = (this.options.room ?? createRoom)();
    const active: Generation = {
      room,
      playback: new LiveTrackPlayback(this.options.element ?? (() => document.createElement('audio')), {
        now: this.options.clock,
        canPlayback: () => this.room()?.canPlaybackAudio !== false,
        blocked: () => { if (!this.closed) this.options.error?.('PLAYBACK_BLOCKED'); },
      }),
      reassembler: new VoiceControlReassembler('server', 'live'),
      sending: { queue: [], running: false, pending: 0 },
      listeners: [],
    };
    this.generation++;
    this.active = active;
    this.bind(active);
    return active;
  }

  /** One listener registry per generation so retirement unbinds every SDK callback. */
  private bind(active: Generation): void {
    const events = active.room as unknown as LiveRoom;
    const on = (event: string, handler: RoomHandler) => {
      events.on(event, handler);
      active.listeners.push({ event, handler });
    };
    on(RoomEvent.DataReceived, (bytes: unknown, participant: unknown, _kind: unknown, topic: unknown) =>
      this.receive(active, bytes, participant, topic));
    on(RoomEvent.ParticipantConnected, (participant: unknown) => this.subscribe(participant));
    on(RoomEvent.TrackPublished, (publication: unknown, participant: unknown) =>
      this.announce(publication, participant));
    on(RoomEvent.TrackSubscribed, (track: unknown, _publication: unknown, participant: unknown) =>
      this.attached(active, track, participant));
    on(RoomEvent.TrackUnsubscribed, (track: unknown, _publication: unknown, participant: unknown) =>
      this.detached(active, track, participant));
    on(RoomEvent.Disconnected, () => this.dropped(active));
  }

  /**
   * The SDK never retries on its own; one application-managed epoch rejoin runs inside a
   * single deadline. Output is silenced and the microphone retired before any callback.
   */
  private dropped(active: Generation): void {
    if (this.closed || this.active !== active) return;
    this.ready = false;
    this.clearConnect();
    const retired = this.detach();
    this.stopInput();
    this.announceLost();
    const session = this.session;
    if (!session) return;
    if (retired) void this.retire(retired.room, false);
    if (!this.options.reauthorize) { this.fail('VOICE_RECONNECT_TIMEOUT'); return; }
    if (!this.recovering) {
      this.recovering = true;
      this.retryAttempt = 0;
      this.deadline = Date.now() + session.limits.reconnectMs;
      this.deadlineTimer = setTimeout(() => this.fail('VOICE_RECONNECT_TIMEOUT'),
        session.limits.reconnectMs);
    }
    this.retry();
  }

  private retry(): void {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) { this.fail('VOICE_RECONNECT_TIMEOUT'); return; }
    const random = Math.max(0, Math.min(1, this.options.random?.() ?? Math.random()));
    const delay = Math.min(remaining,
      Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(this.retryAttempt++, 4)) * (0.8 + 0.4 * random));
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.reconnect(); }, delay);
  }

  /** One reauthorization attempt: the controller supplies the request, we only pass the prior session. */
  private async reconnect(): Promise<void> {
    const previous = this.session;
    if (this.closed || !this.recovering || !previous || Date.now() >= this.deadline) return;
    const abort = new AbortController();
    this.reauth = abort;
    try {
      const next = await this.options.reauthorize!(previous, abort.signal);
      if (this.closed || abort.signal.aborted || Date.now() >= this.deadline) return;
      if (!isCreateVoiceSessionResponse(next) || next.sessionId !== previous.sessionId ||
        next.mode !== previous.mode || next.connectionEpoch <= previous.connectionEpoch ||
        (previous.conversationId !== null && next.conversationId !== previous.conversationId) ||
        !isLiveKitVoiceSessionResponse(next) || Date.parse(next.expiresAt) <= Date.now()) {
        this.fail('STALE_CONNECTION_EPOCH');
        return;
      }
      this.session = next;
      this.ready = false;
      this.tx = 0;
      this.rx = -1;
      this.admittedAt = Date.now();
      this.open();
      await this.join(true);
    } catch (error) {
      if (this.closed || abort.signal.aborted) return;
      if (error instanceof ApiClientError && !error.retryable) { this.fail(error.code); return; }
      this.retry();
    } finally {
      if (this.reauth === abort) this.reauth = undefined;
    }
  }

  /** A subscribed agent audio track becomes the one owned output; video is ignored. */
  private attached(active: Generation, track: unknown, participant: unknown): void {
    const session = this.session;
    if (this.closed || this.active !== active || !session) return;
    if ((participant as Peer | undefined)?.identity !== livekitAgentIdentity(session.sessionId)) return;
    if ((track as { kind?: string } | undefined)?.kind !== Track.Kind.Audio) return;
    active.playback.attach(track as unknown as RemoteAudioTrack);
  }

  /** The subscribed audio track went away: silence output, never stop the SDK's track. */
  private detached(active: Generation, track: unknown, participant: unknown): void {
    const session = this.session;
    if (this.closed || this.active !== active || !session) return;
    if ((participant as Peer | undefined)?.identity !== livekitAgentIdentity(session.sessionId)) return;
    if ((track as { kind?: string } | undefined)?.kind !== Track.Kind.Audio) return;
    active.playback.interrupt();
  }

  /** Unbinds and discards the current generation, keeping the session and microphone. */
  private detach(): Generation | undefined {
    const active = this.active;
    this.active = undefined;
    if (!active) return undefined;
    const events = active.room as unknown as LiveRoom;
    for (const { event, handler } of active.listeners) events.off(event, handler);
    active.listeners.length = 0;
    active.reassembler.clear();
    active.sending.queue.length = 0;
    active.playback.interrupt();
    active.playback.dispose();
    return active;
  }

  /** Best-effort SDK release: rejection is observed, never surfaced, never retried. */
  private async retire(room: Room, bounded: boolean): Promise<void> {
    const budget = bounded
      ? Math.min(LIVEKIT_TEARDOWN_TIMEOUT_MS,
        Math.max(0, this.admittedAt + this.connectMs() - Date.now()))
      : 0;
    await new Promise<void>(resolve => {
      const timer = budget > 0 ? setTimeout(resolve, budget) : undefined;
      const finish = () => { if (timer !== undefined) clearTimeout(timer); resolve(); };
      try { Promise.resolve(room.disconnect(false)).then(finish, finish); }
      catch { finish(); }
    });
  }

  private async join(recovering: boolean): Promise<void> {
    const session = this.session;
    const active = this.active;
    if (!session || !active) return;
    const budget = this.connectMs();
    this.clearConnect();
    this.connectTimer = setTimeout(() => {
      if (this.active === active) {
        this.fail(this.recovering ? 'VOICE_RECONNECT_TIMEOUT' : 'VOICE_CONNECT_TIMEOUT');
      }
    }, budget);
    try {
      await active.room.connect(session.livekit.url, session.livekit.participantToken, {
        autoSubscribe: false, maxRetries: 0,
        peerConnectionTimeout: budget, websocketTimeout: budget,
      });
    } catch {
      this.joinFailed(active, recovering);
      return;
    }
    if (this.active !== active || this.closed) return;
    this.subscribeAgent();
    if (this.mic && !recovering) {
      try {
        active.room.localParticipant.publishTrack(this.mic, { source: Track.Source.Microphone })
          .then(() => undefined, () => this.joinFailed(active, recovering));
      } catch {
        this.joinFailed(active, recovering);
        return;
      }
    }
    if (this.active !== active || this.closed) return;
    this.send({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }, true);
  }

  /**
   * Initial joins fail closed with the connect code; recovery keeps trying the same deadline
   * so a transient SFU rejection cannot masquerade as a successful new epoch.
   */
  private joinFailed(active: Generation, recovering: boolean): void {
    if (this.active !== active || this.closed) return;
    if (!recovering) { this.fail('VOICE_CONNECT_TIMEOUT'); return; }
    const dead = this.detach();
    if (dead) void this.retire(dead.room, false);
    this.retry();
  }

  /** Subscribes the admitted agent's audio publications present at join time. */
  private subscribeAgent(): void {
    const room = this.room();
    const session = this.session;
    if (!room || !session) return;
    const agent = livekitAgentIdentity(session.sessionId);
    for (const participant of room.remoteParticipants.values()) {
      if (participant.identity !== agent) continue;
      for (const publication of participant.trackPublications.values()) {
        if (publication.kind === Track.Kind.Audio) publication.setSubscribed(true);
      }
    }
  }

  /** A later participant joined: follow it only when it is this session's agent. */
  private subscribe(participant: unknown): void {
    const session = this.session;
    const peer = participant as Peer | undefined;
    if (!session || peer?.identity !== livekitAgentIdentity(session.sessionId)) return;
    for (const publication of peer.trackPublications?.values() ?? []) {
      const pub = publication as Publication;
      if (pub.kind === Track.Kind.Audio) pub.setSubscribed?.(true);
    }
  }

  /** A later publication appeared: audio from anyone else is never subscribed. */
  private announce(publication: unknown, participant: unknown): void {
    const session = this.session;
    if (!session || (participant as Peer | undefined)?.identity !== livekitAgentIdentity(session.sessionId)) return;
    const pub = publication as Publication;
    if (pub.kind === Track.Kind.Audio) pub.setSubscribed?.(true);
  }

  private receive(active: Generation, bytes: unknown, participant: unknown, topic: unknown): void {
    const session = this.session;
    if (this.closed || this.active !== active || !session) return;
    if ((participant as Peer | undefined)?.identity !== livekitAgentIdentity(session.sessionId)) return;
    if (topic !== LIVEKIT_CONTROL_TOPIC || !(bytes instanceof Uint8Array)) return;
    try {
      const result = active.reassembler.push(bytes);
      if (result.status === 'complete') this.accept(active, result.event);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'INVALID_VOICE_CONTROL');
    }
  }

  /**
   * Single fence order for every completed server event: binding, epoch, sequence,
   * readiness, then the event-specific rules. Old epochs and repeats are dropped
   * silently; anything else closes the transport with its code.
   */
  private accept(active: Generation, event: VoiceServerEvent): void {
    const session = this.session;
    if (!session) return;
    if (event.sessionId !== session.sessionId) throw new Error('VOICE_BINDING_MISMATCH');
    if (event.connectionEpoch < session.connectionEpoch) return;
    if (event.connectionEpoch > session.connectionEpoch) throw new Error('STALE_CONNECTION_EPOCH');
    if (event.sequence <= this.rx) return;
    if (event.sequence !== this.rx + 1) throw new Error('VOICE_SEQUENCE_ERROR');
    if (!this.ready && !['session.ready', 'session.error', 'session.ended'].includes(event.type)) {
      throw new Error('VOICE_INVALID_STATE');
    }
    this.rx = event.sequence;
    if (event.type === 'session.ready') {
      const admitted = session.effectiveAudioSettings;
      const settings = event.effectiveAudioSettings;
      const sameInput = Object.entries(admitted.input).every(([key, value]) =>
        settings.input[key as keyof typeof settings.input] === value);
      const sameOutput = admitted.output === null ? settings.output === null
        : settings.output !== null && Object.entries(admitted.output).every(([key, value]) =>
          settings.output![key as keyof typeof settings.output] === value);
      const sameLimits = Object.entries(session.limits).every(([key, value]) =>
        event.limits[key as keyof typeof event.limits] === value);
      if (this.ready || !sameInput || !sameOutput || !sameLimits) throw new Error('VOICE_INVALID_STATE');
      this.ready = true;
      this.clearConnect();
      if (this.recovering) {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
        clearTimeout(this.deadlineTimer);
        this.deadlineTimer = undefined;
        this.recovering = false;
        // The controller updates its own session fence before it sees the ready event.
        this.options.recovered?.(session);
      }
    }
    if (event.type === 'conversation.bound') {
      if (session.conversationId !== null && session.conversationId !== event.conversationId) {
        throw new Error('VOICE_BINDING_MISMATCH');
      }
      this.session = { ...session, conversationId: event.conversationId };
    }
    this.forward(active, event);
    if ((event.type === 'session.error' || event.type === 'session.ended') && !event.terminal) return;
    if (event.type === 'session.ended') { void this.dispose(); this.options.ended?.(); return; }
    if (event.type === 'session.error') this.fail(event.code);
  }

  /** Media boundaries move before the controller sees the event that caused them. */
  private forward(active: Generation, event: VoiceServerEvent): void {
    const playback = active.playback;
    try {
      if (event.type === 'audio.start') playback.begin(event.turnId, event.responseId, event.firstAudioSample);
      else if (event.type === 'audio.watermark') playback.watermark(event);
      else if (event.type === 'audio.end') playback.end(event);
      else if (event.type === 'response.cancelled') {
        const ref = playback.activeResponse();
        if (ref && ref.turnId === event.turnId && ref.responseId === event.responseId) playback.interrupt();
      }
    } catch { throw new Error('VOICE_SEQUENCE_ERROR'); }
    this.options.event?.(event);
  }

  private send(payload: VoiceClientPayload, handshake = false): boolean {
    const session = this.session;
    const active = this.active;
    if (this.closed || !session || !active) return false;
    if (!handshake && !this.ready) return false;
    if (this.tx > 0xffffffff) { this.fail('VOICE_SEQUENCE_ERROR'); return false; }
    const json = JSON.stringify({ protocolVersion: 1, sessionId: session.sessionId,
      connectionEpoch: session.connectionEpoch, eventId: this.options.id?.() ?? crypto.randomUUID(),
      sequence: this.tx, ...payload });
    let packets: Uint8Array[];
    try { packets = encodeVoiceControlPackets(json, 'client', 'live'); }
    catch { this.fail('INVALID_VOICE_CONTROL'); return false; }
    const bytes = packets.reduce((total, packet) => total + packet.byteLength, 0);
    if (bytes > MAX_VOICE_CONTROL_BYTES || active.sending.pending + packets.length > MAX_QUEUED_PACKETS) {
      this.fail('AUDIO_BUFFER_OVERFLOW');
      return false;
    }
    this.tx++;
    active.sending.pending += packets.length;
    active.sending.queue.push(...packets);
    this.pump(active);
    return true;
  }

  /**
   * One serializer per Room generation: the next packet starts only after the previous
   * publish settles, and a per-generation guard stops stale/closed work from failing a
   * newer Room or decrementing its counter.
   */
  private pump(active: Generation): void {
    if (active.sending.running || this.active !== active || this.closed) return;
    const packet = active.sending.queue.shift();
    const session = this.session;
    if (!packet || !session) return;
    active.sending.running = true;
    const settle = (failed: boolean) => {
      active.sending.pending--;
      active.sending.running = false;
      if (failed) {
        if (this.active === active && !this.closed) this.fail('VOICE_CONNECT_TIMEOUT');
        return;
      }
      this.pump(active);
    };
    try {
      active.room.localParticipant.publishData(packet as Uint8Array<ArrayBuffer>,
        { reliable: true, topic: LIVEKIT_CONTROL_TOPIC,
          destinationIdentities: [livekitAgentIdentity(session.sessionId)] })
        .then(() => settle(false), () => settle(true));
    } catch { settle(true); }
  }

  private capture(): Promise<LocalAudioTrack> {
    const token = ++this.captureToken;
    let granted: Promise<LocalAudioTrack>;
    try { granted = (this.options.microphone ?? captureMicrophone)(); }
    catch { return Promise.reject(new Error('UNSUPPORTED_AUDIO')); }
    return new Promise<LocalAudioTrack>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (token !== this.captureToken) return;
        this.captureToken++;
        this.captureTimer = undefined;
        reject(new Error('CAPTURE_TIMEOUT'));
      }, this.connectMs());
      this.captureTimer = timer;
      const settle = () => {
        clearTimeout(timer);
        if (this.captureTimer === timer) this.captureTimer = undefined;
      };
      granted.then(track => {
        settle();
        if (token !== this.captureToken) {
          track.mediaStreamTrack.enabled = false;
          track.stop();
          reject(new Error('CAPTURE_CANCELLED'));
          return;
        }
        this.install(track);
        resolve(track);
      }, error => { settle(); reject(new Error(microphoneCode(error))); });
    });
  }

  private install(track: LocalAudioTrack): void {
    this.retireMic(false);
    track.mediaStreamTrack.enabled = false;
    const ended = () => { this.retireMic(false); this.options.microphoneLost?.(); };
    this.micEnded = ended;
    track.mediaStreamTrack.addEventListener('ended', ended);
    this.mic = track;
  }

  private retireMic(stop: boolean): void {
    const mic = this.mic;
    this.mic = undefined;
    if (!mic) return;
    if (this.micEnded) {
      mic.mediaStreamTrack.removeEventListener('ended', this.micEnded);
      this.micEnded = undefined;
    }
    mic.mediaStreamTrack.enabled = false;
    if (stop) mic.stop();
  }

  private connectMs(): number {
    return this.options.connectMs ?? this.session?.limits.connectMs ?? DEFAULT_VOICE_LIMITS.connectMs;
  }

  private clearConnect(): void {
    clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
  }

  /** Exactly one `lost` per Room generation, however many failure paths report it. */
  private announceLost(): void {
    if (this.lostFor === this.generation) return;
    this.lostFor = this.generation;
    this.options.lost?.();
  }

  private fail(code: string): void {
    if (this.closed) return;
    void this.dispose();
    this.options.error?.(code);
    this.announceLost();
  }
}
