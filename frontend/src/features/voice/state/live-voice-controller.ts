/**
 * ============================================================================
 * FILE: live-voice-controller.ts
 * LOCATION: frontend/src/features/voice/state/live-voice-controller.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Controller orchestrating live voice lifecycle, resources, and events.
 *
 * ROLE IN PROJECT:
 *    Composes the live-only LiveKit WebRTC client with P7 lease bindings, enforcing
 *    gesture boundaries, mute/interrupt, the backend listening handshake, and
 *    paused-call recovery without automatic hang-up. Dictation keeps its own PCM
 *    capture/playback composition; live no longer owns PCM capture or queues.
 *
 * KEY COMPONENTS:
 *    - LiveVoiceController: Central class managing live session lifecycle.
 *    - liveVoiceNotice: Operational notice mapper for paused/blocked codes.
 *    - LiveVoicePorts / LiveVoiceBindings: Contracts for external dependencies.
 * ============================================================================
 */

import type { VoiceHttpClient } from '../../../api/voice-client.ts';
import type { LiveKitVoiceClient, LiveKitVoiceClientOptions } from '../../../api/livekit-voice-client.ts';
import { ApiClientError } from '../../../api/client.ts';
import {
  MAX_VOICE_CONTROL_BYTES,
  isCanvasArtifactId,
  isCanvasArtifactProjection,
  isCanvasArtifactProjectionList,
  type CanvasArtifactPayload,
  type CanvasArtifactProjection,
  type CalendarConfirmPayload,
  type CreateVoiceSessionRequest,
  type CreateVoiceSessionResponse,
  type PublicVoiceConfig,
  type VoiceResponseRef,
  type VoiceSaveSnapshot,
  type VoiceServerEvent,
} from '../../../api/voice-protocol.ts';
import { projectionToCanvasArtifact } from '../../canvas/canvas-artifacts.ts';
import type { AudioCaptureService } from '../audio/audio-capture-service.ts';
import type { AudioPlaybackService } from '../audio/audio-playback-service.ts';
import { initialLiveVoice, liveVoiceReducer, type LiveDraft, type LiveVoiceAction } from './live-voice-reducer.ts';

export type LiveVoiceBindings = {
  claimVoiceInput: (mode: 'live', onClose: () => void) => string | null;
  writeVoiceDraft: (token: string, text: string) => boolean;
  releaseVoiceInput: (token: string) => void;
  bindVoiceConversation: (
    token: string,
    conversationId: string,
    meta?: { turnId: string; save: VoiceSaveSnapshot },
  ) => boolean;
  refreshSessions: (
    conversationId?: string,
    voiceSession?: { voiceSessionId: string; durationSeconds: number; startedAt: string },
  ) => void;
  getActiveConversationId?: () => string | null;
  openCanvasArtifact?: (artifactId: string) => void;
};
/** The public live transport surface the controller drives; no PCM input exists here. */
export type LiveVoiceClientPort = Pick<LiveKitVoiceClient,
  'prepare' | 'connect' | 'control' | 'setInputEnabled' | 'stopInput' | 'unlock'
  | 'invalidate' | 'progress' | 'isDrained' | 'dispose'>;
export type LiveVoicePorts = {
  http: Pick<VoiceHttpClient, 'create' | 'end'>;
  bindings: LiveVoiceBindings;
  client: (options: LiveKitVoiceClientOptions) => LiveVoiceClientPort;
  /** Live-only browser support probe evaluated at activation. */
  support?: () => boolean;
  /** @deprecated Live mode no longer uses PCM capture. Ignored by this controller; the property remains required only so P8-owned `Parameters<LiveVoicePorts['capture']>` type callers keep compiling until they migrate. */
  capture: (options: ConstructorParameters<typeof AudioCaptureService>[0]) => Pick<AudioCaptureService,
    'start' | 'setMuted' | 'stop' | 'setUploading'>;
  /** @deprecated Same as `capture`; ignored. */
  playback: (maxQueueMs: number) => Pick<AudioPlaybackService,
    'unlock' | 'begin' | 'enqueue' | 'end' | 'progress' | 'isDrained' | 'interrupt' | 'resetOrigin' | 'dispose' | 'configureSessionQueue'>;
};
/** Ports the controller actually needs; deprecated PCM ports stay optional here. */
export type LiveVoiceControllerPorts = Omit<LiveVoicePorts, 'capture' | 'playback'> &
  Partial<Pick<LiveVoicePorts, 'capture' | 'playback'>>;
type Run = {
  token: string; draft: LiveDraft; abort: AbortController; request: CreateVoiceSessionRequest;
  session?: CreateVoiceSessionResponse; client?: LiveVoiceClientPort;
  ready: boolean; transmitting: boolean; muted: boolean;
  needsGesture: boolean; response: VoiceResponseRef | null;
  timer?: ReturnType<typeof setInterval>; endRequested: boolean;
  startedAt?: number;
  inputSuspended: boolean; waitingForListening: boolean; inputGeneration: number;
  sourceReady: boolean; listeningGeneration: number | null;
  ackTimer?: ReturnType<typeof setTimeout>;
  initialLimits: PublicVoiceConfig['limits'];
  stoppingInput?: Promise<void>;
  resuming: boolean;
  // ponytail: bounded to 4096 responses per live session matching VoiceClient.responsesSeen ceiling.
  turnByResponse: Map<string, string>;
  projectionsByResponse: Map<string, CanvasArtifactProjection[]>;
  cancelledResponses: Set<string>;
  retiredResponses: Set<string>;
  activeArtifactResponse: VoiceResponseRef | null;
  calendarSequence: number;
  calendarEpoch: number | undefined;
  calendarAttempts: Map<string, string>;
};
export type LiveExitReason = 'user' | 'navigation' | 'unmount' | 'pagehide';

const blocked = new Set(['VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT', 'VOICE_DISABLED',
  'VOICE_SESSION_ENDED', 'VOICE_RECONNECT_TIMEOUT', 'VOICE_DELIVERY_UNKNOWN', 'VOICE_BINDING_MISMATCH',
  'INVALID_VOICE_CONTROL', 'VOICE_SEQUENCE_ERROR', 'STALE_CONNECTION_EPOCH'])

/** Every sanitized local/transport code the live client may surface to this controller. */
const LOCAL_CODES = ['CAPTURE_CANCELLED', 'CAPTURE_TIMEOUT', 'PLAYBACK_BLOCKED', 'MICROPHONE_DENIED',
  'MICROPHONE_LOST', 'MICROPHONE_UNAVAILABLE', 'UNSUPPORTED_AUDIO', 'AUDIO_BUFFER_OVERFLOW',
  'VOICE_CONNECT_TIMEOUT', 'VOICE_DISABLED', 'VOICE_INVALID_STATE'];

/** One mapping for every rejection: admission codes win, then known local codes, else unsupported. */
function localError(error: unknown): string {
  if (error instanceof ApiClientError) return error.code;
  const message = error instanceof Error ? error.message : '';
  return LOCAL_CODES.includes(message) ? message : 'UNSUPPORTED_AUDIO';
}

export function liveVoiceNotice(code: string) {
  if (code === 'MEDIA_GATE_UNAVAILABLE') return 'Microphone uploads are paused. Select Resume voice to try again.';
  if (code === 'VOICE_IDLE_TIMEOUT') return 'Call is quiet. Audio uploads are paused.';
  if (code === 'MICROPHONE_DENIED') return 'Microphone access was denied. Allow access, then select Resume voice.';
  if (['MICROPHONE_LOST', 'MICROPHONE_UNAVAILABLE'].includes(code)) return 'Microphone unavailable. Reconnect it, then select Resume voice.';
  if (code === 'UNSUPPORTED_AUDIO') return 'Voice is unavailable in this browser. Text chat is still available.';
  if (code === 'PLAYBACK_BLOCKED') return 'Audio is paused. Select Resume voice to enable playback.';
  if (code === 'VOICE_RECONNECT_TIMEOUT') return 'The connection could not be restored. This call is paused. Hang up when ready.';
  if (code === 'VOICE_QUOTA_EXHAUSTED') return 'The voice limit was reached. This call is paused; Resume cannot reset the limit.';
  if (code === 'VOICE_DURATION_LIMIT') return 'The call time limit was reached. Audio uploads and responses are stopped.';
  if (code === 'STT_UNAVAILABLE') return 'Speech recognition is unavailable. This call is paused.';
  if (code === 'TTS_UNAVAILABLE') return 'Speech playback is unavailable. This call is paused.';
  if (code === 'VOICE_PROVIDER_RATE_LIMITED') return 'The speech service is busy. Try voice later or continue in text.';
  if (code === 'AUDIO_BUFFER_OVERFLOW') return 'The audio connection could not keep up. Start voice again or continue in text.';
  if (code === 'VOICE_AGENT_FAILED') return 'Aurvin could not finish this voice response. Check the saved conversation before retrying.';
  if (code === 'VOICE_DISABLED') return 'Voice is currently unavailable. You can continue in text.';
  if (code === 'CONFLICT_ACTIVE_TURN') return 'Another response is still active. Wait before starting voice again.';
  if (code === 'VOICE_DELIVERY_UNKNOWN') return 'Some audio may not have been heard. Continue in text without repeating a completed request.';
  if (code === 'REMOTE_END_UNCONFIRMED') return 'Voice stopped locally. Its connection is still closing; wait before starting again.';
  if (code === 'VOICE_SESSION_ENDED') return 'The voice service shut down. This call is paused; audio is stopped.';
  return 'Voice is paused. Your conversation and draft are unchanged. Hang up when ready.';
}

export class LiveVoiceController {
  private readonly ports: LiveVoiceControllerPorts;
  private run: Run | null = null;
  private view = initialLiveVoice;
  private listeners = new Set<() => void>();
  constructor(ports: LiveVoiceControllerPorts) {
    this.ports = ports;
  }
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private dispatch(action: LiveVoiceAction) {
    const next = liveVoiceReducer(this.view, action);
    if (next !== this.view) { this.view = next; this.listeners.forEach(listener => listener()); }
  }
  private current(run: Run) { return this.run === run && !run.abort.signal.aborted; }

  /**
   * Local source must stop before the transport reports anything: disabling the native
   * track is synchronous, `stopInput()` retires the owned mic, and the awaited SDK mute
   * is tracked so Resume can wait for prior cleanup.
   */
  private silenceInput(run: Run) {
    const stopping = run.client?.setInputEnabled(false).catch(() => {});
    run.client?.stopInput();
    if (!stopping) return;
    run.stoppingInput = stopping;
    void stopping.then(() => { if (run.stoppingInput === stopping) run.stoppingInput = undefined; });
  }

  private fail(run: Run, code: string) {
    if (!this.current(run)) return
    const micErrors = ['MICROPHONE_DENIED', 'MICROPHONE_LOST', 'MICROPHONE_UNAVAILABLE', 'MEDIA_GATE_UNAVAILABLE',
      'CAPTURE_TIMEOUT', 'CAPTURE_CANCELLED'].includes(code);
    if (micErrors && run.ready) {
      run.inputGeneration++;
      run.waitingForListening = false;
      clearTimeout(run.ackTimer);
      run.ackTimer = undefined;
      run.transmitting = false;
      run.sourceReady = false;
      run.listeningGeneration = null;
      run.muted = true;
      this.silenceInput(run);
      run.client?.control({ type: 'input.mute' });
      this.dispatch({ type: 'INPUT', input: 'muted' });
      this.dispatch({ type: 'INPUT_BUSY', value: false });
      this.dispatch({ type: 'NOTICE', notice: liveVoiceNotice(code) });
      return;
    }
    const local = ['MICROPHONE_DENIED', 'MICROPHONE_LOST', 'MICROPHONE_UNAVAILABLE', 'MEDIA_GATE_UNAVAILABLE',
      'UNSUPPORTED_AUDIO', 'PLAYBACK_BLOCKED', 'AUDIO_BUFFER_OVERFLOW', 'CAPTURE_TIMEOUT', 'CAPTURE_CANCELLED'].includes(code)
    if (local && run.ready) run.client?.control({ type: 'input.mute' })
    this.pause(run, code, local && (!run.session || run.ready))
  }

  private pause(run: Run, code: string, canResume: boolean, disconnected = false) {
    if (!this.current(run)) return;
    if (run.response && run.cancelledResponses.size < 4096) {
      run.cancelledResponses.add(run.response.responseId);
    }
    if (run.activeArtifactResponse && run.cancelledResponses.size < 4096) {
      run.cancelledResponses.add(run.activeArtifactResponse.responseId);
    }
    run.activeArtifactResponse = null;
    const keepPolicy = this.view.phase === 'suspended' && this.view.errorCode
      && (blocked.has(this.view.errorCode) || !this.view.canResume)
    run.inputGeneration++; run.waitingForListening = false
    clearTimeout(run.ackTimer); run.transmitting = false; run.needsGesture = true; run.resuming = false
    this.stopTimer(run)
    run.client?.invalidate(); run.response = null
    this.silenceInput(run)
    if (keepPolicy) {
      this.dispatch({ type: 'PAUSE', code: this.view.errorCode!, notice: this.view.notice ?? liveVoiceNotice(code),
        canResume: false, disconnected: disconnected || this.view.connection === 'disconnected' })
      return
    }
    this.dispatch({ type: 'PAUSE', code, notice: liveVoiceNotice(code),
      canResume: canResume && !blocked.has(code), disconnected })
  }

  // ponytail: visible live-only simplification — no second microphone capture or VAD meter
  // until a native-track meter is demonstrably needed. P8 must not read this as a measured
  // amplitude. Upgrade path: an SDK-native meter on the SAME mic track, with a delay-free test.
  getVolume = (): number => 0;

  private requestListening(run: Run) {
    if (!this.current(run) || !run.ready || run.waitingForListening) return false
    run.transmitting = false
    run.inputGeneration++; run.listeningGeneration = null
    run.waitingForListening = true
    clearTimeout(run.ackTimer)
    run.ackTimer = setTimeout(() => {
      if (this.current(run) && run.waitingForListening) this.fail(run, 'VOICE_CONNECT_TIMEOUT')
    }, run.session!.limits.connectMs)
    if (!run.client?.control({ type: 'input.unmute' })) {
      if (run.ready) this.fail(run, 'VOICE_CONNECT_TIMEOUT')
      return false
    }
    return true
  }

  /** The backend owns quieting; the ack is the only thing that may enable the native track. */
  private listening(run: Run) {
    if (!this.current(run) || !run.waitingForListening || !run.session || !run.ready) return
    if (run.needsGesture || run.listeningGeneration !== run.inputGeneration) return
    if (run.resuming && run.muted) {
      clearTimeout(run.ackTimer); run.waitingForListening = false; run.resuming = false
      run.transmitting = false
      run.client?.control({ type: 'input.mute' })
      void run.client?.setInputEnabled(false).catch(() => {})
      this.dispatch({ type: 'RESUMED' })
      this.dispatch({ type: 'INPUT', input: 'muted' })
      this.dispatch({ type: 'INPUT_BUSY', value: false })
      this.startTimer(run)
      return
    }
    if (run.muted) return
    const generation = run.inputGeneration
    void this.enableInput(run, generation)
  }

  private async enableInput(run: Run, generation: number) {
    try {
      await run.client!.setInputEnabled(true)
    } catch (error) {
      if (!this.current(run) || generation !== run.inputGeneration) return
      this.fail(run, localError(error))
      return
    }
    if (!this.current(run) || generation !== run.inputGeneration || run.needsGesture) return
    if (run.muted) {
      // Manual mute won during the await: keep the native track off and show muted.
      void run.client?.setInputEnabled(false).catch(() => {})
      this.dispatch({ type: 'INPUT', input: 'muted' })
      return
    }
    clearTimeout(run.ackTimer); run.waitingForListening = false; run.inputSuspended = false; run.resuming = false
    run.transmitting = true; run.sourceReady = true
    if (this.view.phase === 'suspended') {
      this.dispatch({ type: 'RESUMED' })
      this.startTimer(run)
    }
    this.dispatch({ type: 'INPUT', input: 'listening' })
    this.dispatch({ type: 'INPUT_BUSY', value: false })
  }

  private stopTimer(run: Run) { clearInterval(run.timer); run.timer = undefined; }
  private startTimer(run: Run) {
    this.stopTimer(run);
    run.timer = setInterval(() => { if (this.current(run)) this.poll(run); }, 100);
  }
  private endSession(run: Run) {
    if (!run.session || run.endRequested) return Promise.resolve();
    run.endRequested = true; return this.ports.http.end(run.session.sessionId);
  }

  async start(draft: LiveDraft, conversationId: string | null, config: PublicVoiceConfig) {
    if (this.run || this.view.phase === 'ending' || !config.enabledModes.live || draft.text.length > 32_000) return;
    const token = this.ports.bindings.claimVoiceInput('live', () => this.exit('navigation'));
    if (!token) return;
    const run: Run = { token, draft: { ...draft }, abort: new AbortController(),
      request: { protocolVersion: 1, mode: 'live', conversationId, locale: 'en-US', idempotencyKey: crypto.randomUUID() },
      ready: false, transmitting: false, muted: false, needsGesture: false, response: null, endRequested: false,
      startedAt: Date.now(), inputSuspended: false, waitingForListening: false, inputGeneration: 0,
      sourceReady: false, listeningGeneration: null, initialLimits: config.limits, resuming: false,
      turnByResponse: new Map(), projectionsByResponse: new Map(), cancelledResponses: new Set(),
      retiredResponses: new Set(), activeArtifactResponse: null,
      calendarSequence: -1, calendarEpoch: undefined, calendarAttempts: new Map() };
    this.run = run; this.dispatch({ type: 'START', conversationId });
    if (this.ports.support && !this.ports.support()) {
      this.pause(run, 'UNSUPPORTED_AUDIO', false);
      return;
    }
    await this.activate(run)
  }

  /** One live client per run, constructed here (never during render) with the admission gesture. */
  private async activate(run: Run) {
    const generation = run.inputGeneration
    try {
      if (!run.client) {
        run.client = this.ports.client({
          connectMs: run.initialLimits.connectMs,
          event: event => this.event(run, event),
          lost: () => this.lost(run),
          recovered: session => {
            if (!this.current(run)) return;
            run.session = session;
            if (session.conversationId && !this.ports.bindings.bindVoiceConversation(run.token, session.conversationId)) {
              this.fail(run, 'VOICE_BINDING_MISMATCH'); return;
            }
            run.needsGesture = true;
          },
          error: code => {
            if (code === 'PLAYBACK_BLOCKED') {
              if (this.current(run)) this.suspend(liveVoiceNotice('PLAYBACK_BLOCKED'));
              return;
            }
            run.ready = false
            this.pause(run, code, false, true)
          },
          ended: () => {
            if (!this.current(run)) return
            if (this.view.errorCode) this.pause(run, this.view.errorCode, false, true)
            else this.pause(run, 'VOICE_SESSION_ENDED', false, true)
          },
          reauthorize: (previous, signal) => this.ports.http.create(
            { ...run.request, conversationId: previous.conversationId }, signal, previous),
          microphoneLost: () => { if (this.current(run)) this.fail(run, 'MICROPHONE_LOST'); },
        });
      }
      // Both steps start before the first await, retaining the activation gesture.
      const preparing = run.client.prepare()
      await preparing
      if (!this.current(run) || generation !== run.inputGeneration || run.needsGesture) return;
      if (!run.session) {
        this.dispatch({ type: 'CONNECTING' });
        run.session = await this.ports.http.create(run.request, run.abort.signal);
        if (!this.current(run)) { void this.endSession(run).catch(() => {}); return; }
        if (generation !== run.inputGeneration) return;
        if (run.session.conversationId) {
          this.dispatch({ type: 'CONVERSATION_BOUND', conversationId: run.session.conversationId });
        }
      }
      await run.client.connect(run.session);
    } catch (error) {
      if (!this.current(run) || generation !== run.inputGeneration) return
      const code = localError(error);
      if (code === 'CAPTURE_CANCELLED') return
      // Missing live descriptor: clean up the accidental admission once; never fall back to PCM.
      if (code === 'VOICE_DISABLED') void this.endSession(run).catch(() => {});
      this.fail(run, code);
    }
  }

  private async ready(run: Run) {
    if (!this.current(run)) return;
    run.ready = true;
    if (run.needsGesture) {
      if (!run.client!.control({ type: 'input.mute' })) { if (run.ready) this.fail(run, 'VOICE_RECONNECT_TIMEOUT'); return; }
      this.dispatch({ type: 'READY', resumeRequired: true });
      this.dispatch({ type: 'NOTICE', notice: 'Voice paused. Select Resume voice; repeat any speech lost during the interruption.' });
      return;
    }
    run.sourceReady = false
    if (!this.requestListening(run)) return;
    this.dispatch({ type: 'READY', resumeRequired: false }); this.startTimer(run);
  }

  private acceptCanvasArtifact(run: Run, event: VoiceServerEvent & CanvasArtifactPayload) {
    if (!run.ready || this.view.phase !== 'active' || run.needsGesture) return;
    if (!isCanvasArtifactId(event.turnId) || !isCanvasArtifactId(event.responseId)) return;
    if (
      new TextEncoder().encode(JSON.stringify(event)).byteLength > MAX_VOICE_CONTROL_BYTES
    ) {
      return;
    }
    const projection: CanvasArtifactProjection = {
      responseId: event.responseId,
      ordinal: event.ordinal,
      kind: event.kind,
      subType: event.subType,
      title: event.title,
      rawSource: event.rawSource,
    };
    if (!isCanvasArtifactProjection(projection)) return;
    if (
      run.cancelledResponses.has(event.responseId) ||
      run.retiredResponses.has(event.responseId)
    ) {
      return;
    }
    const knownTurn = run.turnByResponse.get(event.responseId);
    if (knownTurn !== undefined && knownTurn !== event.turnId) return;
    if (
      run.response &&
      run.response.responseId !== event.responseId &&
      run.response.turnId === event.turnId
    ) {
      return;
    }
    if (knownTurn === undefined && run.turnByResponse.size >= 4096) return;

    const existing = run.projectionsByResponse.get(event.responseId) ?? [];
    if (existing.some((item) => item.ordinal === projection.ordinal)) {
      return; // Idempotent duplicate delivery of already-accepted ordinal
    }
    const nextForResponse = [...existing, projection];
    if (!isCanvasArtifactProjectionList(nextForResponse)) return;

    const converted = projectionToCanvasArtifact(projection, projection.responseId);
    if (!converted) return;

    if (
      run.activeArtifactResponse &&
      run.activeArtifactResponse.responseId !== event.responseId
    ) {
      if (run.retiredResponses.size < 4096) {
        run.retiredResponses.add(run.activeArtifactResponse.responseId);
      }
    }
    run.turnByResponse.set(event.responseId, event.turnId);
    run.projectionsByResponse.set(event.responseId, nextForResponse);
    run.activeArtifactResponse = { turnId: event.turnId, responseId: event.responseId };

    this.dispatch({ type: 'ARTIFACT_ACCEPTED', artifact: projection });
    this.ports.bindings.openCanvasArtifact?.(converted.artifactId);
  }

  private event(run: Run, event: VoiceServerEvent) {
    if (!this.current(run) || event.sessionId !== run.session?.sessionId ||
      event.connectionEpoch !== run.session.connectionEpoch) return;
    try {
      switch (event.type) {
        case 'session.ready': void this.ready(run); break;
        case 'conversation.bound': {
          const meta = event.turnId && event.save ? { turnId: event.turnId, save: event.save } : undefined;
          const ok = meta
            ? this.ports.bindings.bindVoiceConversation(run.token, event.conversationId, meta)
            : this.ports.bindings.bindVoiceConversation(run.token, event.conversationId);
          if (!ok) {
            this.fail(run, 'VOICE_BINDING_MISMATCH'); break;
          }
          run.session = { ...run.session, conversationId: event.conversationId };
          this.dispatch({ type: 'CONVERSATION_BOUND', conversationId: event.conversationId });
          break;
        }
        case 'canvas.artifact':
          this.acceptCanvasArtifact(run, event as VoiceServerEvent & CanvasArtifactPayload);
          break;
        case 'calendar.frame': {
          try {
            const selected=this.ports.bindings.getActiveConversationId?.();
            if (!run.ready || !selected || selected !== run.session?.conversationId || selected !== this.view.conversationId) break;
            if (run.calendarEpoch !== event.connectionEpoch) {
              run.calendarEpoch=event.connectionEpoch;run.calendarSequence=-1;
            }
            if (event.sequence <= run.calendarSequence) break;
            const attempt=run.calendarAttempts.get(event.turnId);
            if (attempt && attempt !== event.attemptId) break;
            if (!attempt && run.calendarAttempts.size >= 4096) break;
            const knownTurn=run.turnByResponse.get(event.responseId);
            if (knownTurn !== undefined && knownTurn !== event.turnId) break;
            if (knownTurn === undefined && run.turnByResponse.size >= 4096) break;
            run.turnByResponse.set(event.responseId,event.turnId);
            run.calendarAttempts.set(event.turnId,event.attemptId);run.calendarSequence=event.sequence;
            this.dispatch({type:'CALENDAR_FRAME',frame:event});
          } catch { /* Calendar presentation failure never pauses media or changes the authoritative result. */ }
          break;
        }
        case 'voice.state':
          if (!run.needsGesture) this.dispatch({ type: 'AGENT', agent: event.agent });
          if (event.input === 'suspended') {
            // UI only: the backend input gate already owns quieting; never touch the native track.
            if (!run.muted && !run.waitingForListening) {
              run.inputSuspended = true;
              this.dispatch({ type: 'INPUT', input: 'suspended' });
            }
          } else if (event.input === 'listening') {
            if (run.waitingForListening) {
              run.listeningGeneration = run.inputGeneration
              this.listening(run)
            } else if (!run.muted && run.inputSuspended) {
              run.inputSuspended = false;
              this.dispatch({ type: 'INPUT', input: 'listening' });
            }
          }
          break;
        case 'audio.start': {
          if (run.cancelledResponses.has(event.responseId)) {
            run.client?.invalidate(event.responseId);
            break;
          }
          const boundTurn = run.turnByResponse.get(event.responseId);
          if (boundTurn !== undefined && boundTurn !== event.turnId) break;
          if (
            run.activeArtifactResponse &&
            run.activeArtifactResponse.responseId !== event.responseId &&
            run.retiredResponses.size < 4096
          ) {
            run.retiredResponses.add(run.activeArtifactResponse.responseId);
          }
          if (run.turnByResponse.size < 4096) {
            run.turnByResponse.set(event.responseId, event.turnId);
          }
          run.activeArtifactResponse = { turnId: event.turnId, responseId: event.responseId };
          run.response = { turnId: event.turnId, responseId: event.responseId };
          if (run.needsGesture) this.interrupt();
          else this.dispatch({ type: 'AUDIO_START', ref: run.response });
          break;
        }
        case 'audio.end':
          if (run.response?.responseId === event.responseId) this.poll(run);
          break;
        case 'response.cancelled':
          if (run.cancelledResponses.size < 4096) {
            run.cancelledResponses.add(event.responseId);
          }
          if (run.activeArtifactResponse?.responseId === event.responseId) {
            run.activeArtifactResponse = null;
          }
          if (run.response?.responseId === event.responseId) {
            this.interrupt(false);
          } else if (!run.response && this.view.agent !== 'idle') {
            this.dispatch({ type: 'INTERRUPT' });
          }
          break;
        case 'session.warning':
          if (event.recovery === 'resume_gesture') this.suspend(liveVoiceNotice('PLAYBACK_BLOCKED'));
          else if (event.code === 'VOICE_IDLE_TIMEOUT') this.dispatch({ type: 'NOTICE',
            notice: 'Call is quiet. Audio uploads are paused automatically.' });
          else if (event.code === 'VOICE_DURATION_LIMIT') this.dispatch({ type: 'NOTICE', notice: 'The voice session is nearing its time limit.' });
          else this.dispatch({ type: 'NOTICE', notice: liveVoiceNotice(event.code) });
          break;
        case 'session.error': {
          if (event.terminal) run.ready = false
          const allowed = !event.terminal && event.recoverable
            && (event.recovery === 'resume_call' || event.recovery === 'resume_gesture')
          this.pause(run, event.code, allowed)
          break
        }
        case 'session.ended': {
          if (event.terminal) run.ready = false
          const code = event.reason === 'idle' ? 'VOICE_IDLE_TIMEOUT'
            : event.reason === 'duration' ? 'VOICE_DURATION_LIMIT'
            : event.reason === 'quota' ? 'VOICE_QUOTA_EXHAUSTED'
            : event.reason === 'shutdown' ? 'VOICE_SESSION_ENDED'
            : 'VOICE_SESSION_ENDED'
          this.pause(run, code, false, true)
          break
        }
      }
    } catch { this.fail(run, 'VOICE_DELIVERY_UNKNOWN'); }
  }

  /** Progress comes from the client's proven output cursor; drain is its verified boundary. */
  private poll(run: Run) {
    if (!this.current(run) || !run.ready || run.needsGesture || !run.response) return;
    const ref = run.response;
    const progress = run.client!.progress();
    const proof = progress.proof === 'unproven' ? { proof: 'unproven' as const } : {};
    if (!run.client!.control({ type: 'playback.progress', ...ref,
      playedMs: progress.playedMs, playedSamples: progress.playedSamples, ...proof })) {
      if (run.ready) this.fail(run, 'VOICE_RECONNECT_TIMEOUT'); return;
    }
    if (run.client!.isDrained() && run.response === ref) {
      if (run.retiredResponses.size < 4096) {
        run.retiredResponses.add(ref.responseId);
      }
      if (run.activeArtifactResponse?.responseId === ref.responseId) {
        run.activeArtifactResponse = null;
      }
      run.response = null; this.dispatch({ type: 'DRAINED', responseId: ref.responseId });
    }
  }

  async toggleMute() {
    const run = this.run;
    if (!run || this.view.phase !== 'active' || this.view.connection !== 'connected'
      || (this.view.inputBusy && run.muted)) return;
    run.inputGeneration++; run.waitingForListening = false
    clearTimeout(run.ackTimer); run.transmitting = false
    run.muted = !run.muted;
    this.dispatch({ type: 'INPUT', input: run.muted ? 'muted' : 'listening' });
    this.dispatch({ type: 'INPUT_BUSY', value: true });
    const generation = run.inputGeneration
    try {
      if (run.muted) {
        run.sourceReady = false; run.listeningGeneration = null
        // The native track is disabled synchronously inside this call, before any transport work.
        const stopping = run.client!.setInputEnabled(false);
        const sent = run.client!.control({ type: 'input.mute' });
        try { await stopping; } finally { if (!sent && run.ready) this.fail(run, 'VOICE_CONNECT_TIMEOUT'); }
      } else {
        // Reacquires a lost microphone only from this gesture; idempotent otherwise.
        await run.client!.prepare();
        if (!this.current(run) || generation !== run.inputGeneration || run.needsGesture || run.muted) return;
        run.sourceReady = false;
        if (!this.requestListening(run)) return;
      }
    } catch (error) {
      if (!this.current(run) || generation !== run.inputGeneration || run.muted) return;
      this.fail(run, localError(error));
    }
    finally { if (this.current(run) && run.muted) this.dispatch({ type: 'INPUT_BUSY', value: false }); }
  }

  confirmCalendar(proposalId:string,revision:number,answer:CalendarConfirmPayload['answer']):boolean {
    const run=this.run;
    if (!run || !this.current(run) || !run.ready || run.needsGesture || this.view.phase !== 'active' ||
      this.view.connection !== 'connected' || this.view.agent === 'thinking' || this.view.inputBusy ||
      this.ports.bindings.getActiveConversationId?.() !== run.session?.conversationId) return false;
    const workspace=this.view.calendarWorkspaces.find(w=>w.interactive && !w.pending && w.view?.kind === 'proposal' &&
      w.view.proposalId === proposalId && w.view.revision === revision);
    const view=workspace?.view;
    if (!view || view.kind !== 'proposal' || Date.parse(view.expiresAt) <= Date.now()) return false;
    if (answer.kind === 'select' && !view.candidates.some(c=>c.calendarId === answer.calendarId)) return false;
    if (answer.kind === 'accept' && (view.reason === 'target' || !view.action || !view.target)) return false;
    const unconfirmed=()=>{
      try {this.dispatch({type:'NOTICE',notice:'Confirmation delivery is unconfirmed. Check the outcome before trying again.'});}
      catch { /* A visual subscriber must not escape this control handler. */ }
    };
    // dispatch updates the snapshot before notifying subscribers: the duplicate fence is synchronous.
    try {this.dispatch({type:'CALENDAR_PENDING',proposalId,revision});}
    catch { /* A failed visual notification must not prevent the authorized control send. */ }
    try {
      const sent=run.client?.control({type:'calendar.confirm',proposalId,proposalRevision:revision,answer}) ?? false;
      if (!sent) unconfirmed();
      return sent;
    } catch {unconfirmed();return false;}
  }

  interrupt(notify = true) {
    const run = this.run;
    if (!run) return;
    const ref = run.response;
    if (!ref) {
      if (run.activeArtifactResponse) {
        if (run.cancelledResponses.size < 4096) {
          run.cancelledResponses.add(run.activeArtifactResponse.responseId);
        }
        run.client?.invalidate(run.activeArtifactResponse.responseId);
        run.activeArtifactResponse = null;
        if (this.view.agent !== 'idle') this.dispatch({ type: 'INTERRUPT' });
      }
      return;
    }
    if (run.cancelledResponses.size < 4096) {
      run.cancelledResponses.add(ref.responseId);
    }
    if (run.activeArtifactResponse?.responseId === ref.responseId) {
      run.activeArtifactResponse = null;
    }
    const progress = run.client!.progress(); // Frozen before invalidation freezes it.
    run.client!.invalidate(ref.responseId); // Immediate local silence BEFORE any transport call.
    run.response = null;
    this.dispatch({ type: 'INTERRUPT' });
    if (
      notify &&
      run.ready &&
      !run.client!.control({
        type: 'response.interrupt',
        ...ref,
        playbackPositionMs: progress.playedMs,
        playedSamples: progress.playedSamples,
        ...(progress.proof === 'unproven' ? { proof: 'unproven' as const } : {}),
      }) &&
      run.ready
    ) {
      this.fail(run, 'VOICE_RECONNECT_TIMEOUT');
    }
  }

  suspend(notice = 'Voice paused while the page was hidden. Select Resume voice to continue.') {
    const run = this.run;
    if (!run) return;
    if (run.response && run.cancelledResponses.size < 4096) {
      run.cancelledResponses.add(run.response.responseId);
    }
    if (run.activeArtifactResponse && run.cancelledResponses.size < 4096) {
      run.cancelledResponses.add(run.activeArtifactResponse.responseId);
    }
    run.activeArtifactResponse = null;
    run.inputGeneration++; run.waitingForListening = false
    clearTimeout(run.ackTimer); run.transmitting = false; run.needsGesture = true; run.resuming = false
    this.interrupt(); this.stopTimer(run);
    this.silenceInput(run)
    if (run.ready) run.client?.control({ type: 'input.mute' })
    this.dispatch({ type: 'PAUSE', notice, canResume: !run.client || run.ready })
  }

  private lost(run: Run) {
    if (!this.current(run)) return;
    if (run.response && run.cancelledResponses.size < 4096) {
      run.cancelledResponses.add(run.response.responseId);
    }
    if (run.activeArtifactResponse && run.cancelledResponses.size < 4096) {
      run.cancelledResponses.add(run.activeArtifactResponse.responseId);
    }
    run.activeArtifactResponse = null;
    run.ready = false; run.needsGesture = true; run.transmitting = false;
    run.waitingForListening = false; clearTimeout(run.ackTimer)
    run.sourceReady = false; run.listeningGeneration = null
    // The client already retired the microphone and output; do not stop them twice.
    run.client?.invalidate(); run.response = null;
    this.stopTimer(run);
    if (this.view.errorCode) {
      this.dispatch({ type: 'PAUSE', code: this.view.errorCode, notice: this.view.notice ?? liveVoiceNotice(this.view.errorCode),
        canResume: false, disconnected: true })
      return
    }
    this.dispatch({ type: 'LOST' });
  }

  async resume() {
    const run = this.run;
    if (!run || this.view.phase !== 'suspended' || !this.view.canResume || this.view.inputBusy) return;
    this.dispatch({ type: 'INPUT_BUSY', value: true });
    const stopping = run.stoppingInput
    if (stopping) {
      await stopping
      if (this.current(run) && run.stoppingInput === stopping) run.stoppingInput = undefined
      if (!this.current(run) || this.view.phase !== 'suspended' || !this.view.canResume) {
        if (this.current(run)) this.dispatch({ type: 'INPUT_BUSY', value: false });
        return
      }
    }
    run.inputGeneration++; run.needsGesture = false
    const generation = run.inputGeneration
    if (!run.session) {
      await this.activate(run)
      return
    }
    if (!run.ready) {
      this.pause(run, this.view.errorCode ?? 'VOICE_RECONNECT_TIMEOUT', false, true)
      return
    }
    try {
      // Gesture retention: both calls start synchronously before the first await.
      const results = await Promise.allSettled([run.client!.unlock(), run.client!.prepare()]);
      for (const result of results) {
        if (result.status !== 'rejected') continue;
        const code = localError(result.reason);
        if (code === 'PLAYBACK_BLOCKED') {
          if (this.current(run)) this.suspend(liveVoiceNotice('PLAYBACK_BLOCKED'));
          return;
        }
        this.pause(run, ['MICROPHONE_DENIED', 'MICROPHONE_UNAVAILABLE', 'MICROPHONE_LOST'].includes(code) ? code : 'UNSUPPORTED_AUDIO', true)
        return;
      }
      if (!this.current(run) || generation !== run.inputGeneration || run.needsGesture || !run.ready) return;
      run.sourceReady = false
      run.resuming = true
      // The backend ack is the only path that enables or re-mutes the native track.
      if (!this.requestListening(run)) return;
    } finally {
      if (this.current(run) && !run.waitingForListening && this.view.phase === 'suspended') {
        this.dispatch({ type: 'INPUT_BUSY', value: false });
      }
    }
  }

  exit(reason: LiveExitReason = 'user', notice: string | null = null) {
    const run = this.run;
    if (!run) return;
    this.run = null; run.abort.abort(); run.transmitting = false;
    run.waitingForListening = false; clearTimeout(run.ackTimer)
    this.stopTimer(run)
    // Local source and output stop first; the SDK release is bounded and once-only.
    const stopping = run.client?.setInputEnabled(false).catch(() => {}) ?? Promise.resolve();
    try { run.client?.control({ type: 'session.end' }); } catch { /* Local teardown still runs. */ }
    run.client?.stopInput();
    run.client?.invalidate();
    const disposing = run.client?.dispose() ?? Promise.resolve();
    const written = this.ports.bindings.writeVoiceDraft(run.token, run.draft.text);
    this.ports.bindings.releaseVoiceInput(run.token);
    const retainArtifacts = reason === 'user';
    this.dispatch({
      type: 'ENDING',
      notice,
      restoreDraft: written && reason === 'user' ? run.draft : null,
      retainArtifacts,
    });
    const conversationId = run.session?.conversationId || undefined;
    const voiceSessionId = run.session?.sessionId;
    const durationSeconds = run.startedAt
      ? Math.max(1, Math.round((Date.now() - run.startedAt) / 1000))
      : undefined;
    const startedAt = run.startedAt
      ? new Date(run.startedAt).toISOString()
      : new Date().toISOString();

    this.ports.bindings.refreshSessions(
      conversationId,
      voiceSessionId && durationSeconds !== undefined
        ? { voiceSessionId, durationSeconds, startedAt }
        : undefined,
    );

    void Promise.allSettled([stopping, disposing, this.endSession(run)]).then(
      (results) => {
        const endedNotice = results.some((result) => result.status === 'rejected')
          ? liveVoiceNotice('REMOTE_END_UNCONFIRMED')
          : notice;
        this.ports.bindings.refreshSessions(conversationId);
        this.dispatch({ type: 'EXIT', notice: endedNotice, retainArtifacts });
      },
    );
  }
}
