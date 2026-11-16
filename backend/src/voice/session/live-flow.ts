/**
 * ============================================================================
 * FILE: live-flow.ts
 * LOCATION: backend/src/voice/session/live-flow.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Live voice mode bidirectional speech flow and playback management.
 *
 * ROLE IN PROJECT:
 *    Bridges Flux STT input and Flux TTS output with VoiceSink. Enforces
 *    final-only user turn dispatch, barge-in / StartOfTurn invalidation,
 *    monotonic playback progress translation, and P6 lifecycle hook callbacks.
 *
 * KEY COMPONENTS:
 *    - LiveFlow: Implements VoiceFlow for live duplex conversation mode.
 * ============================================================================
 */

import type { SpeechInputConnection, SpeechOutputConnection } from '../../contracts/voice.js';
import { INPUT_AUDIO, OUTPUT_AUDIO, type VoiceClientEvent, type VoiceErrorCode } from '../../contracts/voice-wire.js';
import { fault, voiceError, VoiceSessionError, type FlowDependencies, type SessionContext, type VoiceSink, type VoiceFlow } from './voice-session.options.js';

type Response = {
  turnId: string;
  responseId: string;
  invalid: boolean;
  started: boolean;
  sent: number;
  base: number;
  wireBase: number;
  completed: boolean;
  spoken: boolean;
  interrupt?: Promise<void>;
  drained: Promise<void>;
  release(): void;
  preparedAt: number;
  modelStartedAt?: number;
  modelOutputAt?: number;
  modelOutputSeen?: boolean;
  firstSpeakAt?: number;
  firstAudioAt?: number;
  playbackSeen?: boolean;
};

export class LiveFlow implements VoiceFlow {
  private muted = false;
  private suspended = false;
  private resumeRequested = false;
  private settlingInput?: Promise<void>;
  private inputLost = false;
  private speechActive = false;
  private renewalUsed = false;
  private retiredStt?: Promise<void>;
  private cancelInputSettlement?: () => void;
  private closed = false;
  private agent: 'idle' | 'thinking' | 'speaking' = 'idle';
  private responses = new Map<string, Response>();
  private current?: Response;
  private providerBase = 0;
  private played = 0;
  private wirePlayed = 0;
  private lastInterrupt = -1;
  private turns = new Set<string>();
  private closing?: Promise<void>;
  private finalChain = Promise.resolve();
  private pendingTurns = 0;
  private started = false;
  private sttTask?: Promise<void>;
  private ttsTask?: Promise<void>;
  private ttsGeneration = 0;
  private ttsTasks = new Set<Promise<void>>();
  private resettingTts?: Promise<void>;
  private sttGeneration = 0;
  private sttTasks = new Set<Promise<void>>();
  private openingStt?: Promise<SpeechInputConnection>;
  private wakeOutput?: () => void;
  private thinking?: AbortController;
  private speechFailed?: VoiceErrorCode;
  private speechReconnectUsed = false;
  private recoveringSpeech?: Promise<void>;
  private endOfTurnAt?: number;
  private lifetime = new AbortController();

  private constructor(
    private readonly context: SessionContext,
    private readonly sink: VoiceSink,
    private readonly signal: AbortSignal,
    private stt: SpeechInputConnection,
    private tts: SpeechOutputConnection,
    private readonly deps: FlowDependencies
  ) {}

  static async open(context: SessionContext, sink: VoiceSink, signal: AbortSignal, deps: FlowDependencies) {
    if (context.response.mode !== 'live' || !context.reservation) fault('VOICE_INVALID_STATE');
    const opening = new AbortController();
    const abortSignal = AbortSignal.any([signal, opening.signal]);
    const sttStarted = performance.now();
    const stt = deps.stt.connect({ mode: 'live', locale: 'en-US', audio: INPUT_AUDIO, abortSignal }).then(connection => {
      deps.observe?.(context, { stage: 'stt-connected', elapsedMs: performance.now() - sttStarted });
      return connection;
    });
    const ttsStarted = performance.now();
    const tts = deps.tts.connect({ audio: OUTPUT_AUDIO, abortSignal }).then(connection => {
      deps.observe?.(context, { stage: 'tts-connected', elapsedMs: performance.now() - ttsStarted });
      return connection;
    });
    try {
      const [input, output] = await Promise.all([stt, tts]);
      return new LiveFlow(context, sink, signal, input, output, deps);
    } catch (error) {
      opening.abort();
      // Drain both opens: a late successful peer must not leak its socket or accounting.
      const results = await Promise.allSettled([stt, tts]);
      await Promise.allSettled(results.map(result => result.status === 'fulfilled' ? result.value.close() : undefined));
      throw error;
    }
  }

  get providerSocketId() { return this.tts.providerSocketId; }

  modelStarted(ref: { responseId: string }) {
    const r = this.responses.get(ref.responseId);
    if (r && !r.invalid) r.modelStartedAt = performance.now();
  }

  modelOutput(ref: { responseId: string }) {
    const r = this.responses.get(ref.responseId);
    if (!r || r.invalid || r.modelOutputSeen || r.modelStartedAt === undefined) return;
    r.modelOutputSeen = true;
    r.modelOutputAt = performance.now();
    this.deps.observe?.(this.context, { stage: 'model-first-output', ...this.ref(r), elapsedMs: r.modelOutputAt - r.modelStartedAt });
  }

  deliverySettled(ref: { turnId: string; responseId: string }, unknown: boolean) {
    const r = this.responses.get(ref.responseId);
    if (r) this.deps.observe?.(this.context, { stage: 'delivery-settled', ...ref,
      elapsedMs: performance.now() - r.preparedAt, ...(unknown ? { code: 'VOICE_DELIVERY_UNKNOWN' } : {}) });
  }

  private ref(r: Response) { return { turnId: r.turnId, responseId: r.responseId }; }

  async waitForOutput(signal = this.signal): Promise<boolean> {
    if (this.closed || signal.aborted) return false;
    const pending = this.current?.drained ?? this.resettingTts;
    if (!pending) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort!: () => void;
    try {
      await Promise.race([pending, new Promise<void>((resolve, reject) => {
        abort = resolve;
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => reject(new VoiceSessionError('VOICE_DELIVERY_UNKNOWN')),
          this.context.response.limits.connectMs + this.context.response.limits.finalizationMs);
      })]);
      return !this.closed && !signal.aborted;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }

  start() {
    if (this.started || this.closed) return;
    this.started = true;
    this.deps.activity?.(this.context, false);
    this.startInputReader();
    this.startOutputReader();
  }

  private startOutputReader() {
    const task = this.readTts(this.tts, this.ttsGeneration);
    this.ttsTask = task;
    this.ttsTasks.add(task);
    void task.finally(() => this.ttsTasks.delete(task));
  }

  private resetOutput(r: Response) {
    if (this.resettingTts) return this.resettingTts;
    this.ttsGeneration++;
    const old = this.tts;
    this.deps.observe?.(this.context, { stage: 'tts-reset', ...this.ref(r), code: 'VOICE_DELIVERY_UNKNOWN' });
    this.resettingTts = (async () => {
      // Retired-socket unknown evidence is durable; it is never a guessed spoken prefix.
      await old.close();
      if (this.closed) return;
      const fresh = await this.deps.tts.connect({ audio: OUTPUT_AUDIO, abortSignal: this.signal });
      if (this.closed) { await fresh.close(); return; }
      this.tts = fresh;
      this.providerBase = 0; this.played = 0; this.lastInterrupt = -1;
      if (this.current === r) this.current = undefined;
      r.release();
      this.startOutputReader();
    })().finally(() => { this.resettingTts = undefined; });
    return this.resettingTts;
  }

  private startInputReader() {
    const task = this.readStt(this.stt, this.sttGeneration);
    this.sttTask = task;
    this.sttTasks.add(task);
    void task.finally(() => this.sttTasks.delete(task));
  }

  async input(pcm: Uint8Array) {
    if (this.closed) fault('VOICE_INVALID_STATE');
    if (pcm.byteLength !== 2560) fault('INVALID_AUDIO_FRAME');
    if (!this.muted && !this.suspended && !this.inputLost) {
      this.context.assertPaidWork?.();
      await this.stt.writeAudio(pcm);
      this.renewalUsed = false;
    }
  }

  private state() {
    this.deps.activity?.(this.context, this.agent !== 'idle');
    this.sink.event({
      type: 'voice.state',
      input: this.muted ? 'muted' : this.suspended ? 'suspended' : 'listening',
      agent: this.agent,
      connection: 'connected'
    });
    this.resumeInput();
  }

  suspendInput(_reason: 'quiet' = 'quiet') {
    if (this.muted) fault('VOICE_INVALID_STATE');
    if (this.suspended) return;
    this.suspended = true;
    this.resumeRequested = false;
    this.state();
    const generation = this.sttGeneration;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel!: () => void;
    const finalization = this.stt.finalize();
    const pending = Promise.race([finalization, new Promise<void>((_resolve, reject) => {
      cancel = () => reject(new VoiceSessionError('STT_UNAVAILABLE', 'resume_call'));
      this.cancelInputSettlement = cancel;
      timer = setTimeout(cancel, Math.min(2000, this.context.response.limits.finalizationMs));
    })]).catch(() => {
      if (!this.closed && !this.muted && generation === this.sttGeneration && !this.current && this.speechActive) {
        this.retireInput();
      }
    }).finally(() => {
      clearTimeout(timer);
      this.speechActive = false;
      if (this.cancelInputSettlement === cancel) this.cancelInputSettlement = undefined;
      if (this.settlingInput === pending) this.settlingInput = undefined;
      this.resumeInput();
    });
    this.settlingInput = pending;
  }

  private retireInput() {
    if (this.closed || this.muted || this.inputLost) return;
    this.inputLost = true;
    this.speechActive = false;
    this.sttGeneration++;
    this.retiredStt = this.stt.close().catch(() => undefined);
    this.resumeInput();
  }

  resumeCapture() {
    if (this.closed || this.muted) return;
    this.resumeRequested = true;
    this.resumeInput();
  }

  private resumeInput() {
    if (this.closed || this.muted || this.settlingInput) return;
    if (this.inputLost) { void this.renewInput(); return; }
    if (!this.suspended || !this.resumeRequested) return;
    try { this.context.assertPaidWork?.(); }
    catch (error) { this.error(voiceError(error, 'VOICE_QUOTA_EXHAUSTED').code); return; }
    this.suspended = false;
    this.resumeRequested = false;
    this.state();
  }

  private async renewInput() {
    if (this.closed || this.muted || !this.inputLost || this.settlingInput || this.openingStt ||
      this.pendingTurns || this.current || this.resettingTts || this.agent !== 'idle') return;
    // ponytail: one renewal per quiet stretch without new admitted media; another failure pauses for manual recovery, not a retry loop.
    if (this.renewalUsed) { this.error('STT_UNAVAILABLE'); return; }
    this.renewalUsed = true;
    const generation = this.sttGeneration;
    const opening = (async () => {
      await this.retiredStt;
      if (this.closed || this.muted || generation !== this.sttGeneration)
        throw new VoiceSessionError('VOICE_SESSION_ENDED', 'none');
      this.context.assertPaidWork?.();
      return this.deps.stt.connect({ mode: 'live', locale: 'en-US', audio: INPUT_AUDIO, abortSignal: this.signal });
    })();
    this.openingStt = opening;
    try {
      const stt = await opening;
      try {
        if (this.closed || this.muted || generation !== this.sttGeneration) { await stt.close(); return; }
        this.context.assertPaidWork?.();
      } catch (error) { await stt.close(); throw error; }
      this.stt = stt;
      this.inputLost = false;
      this.startInputReader();
    } catch (error) {
      if (!this.closed && !this.muted && generation === this.sttGeneration)
        this.error(voiceError(error, 'STT_UNAVAILABLE').code);
    } finally {
      if (this.openingStt === opening) this.openingStt = undefined;
    }
    if (!this.inputLost) this.resumeInput();
  }

  private unavailableInput(generation: number, code: import('../../contracts/voice-wire.js').VoiceErrorCode) {
    if (this.closed || generation !== this.sttGeneration) return;
    if (this.suspended && (code === 'STT_UNAVAILABLE' || code === 'VOICE_CONNECT_TIMEOUT')) this.retireInput();
    else this.error(code);
  }

  async control(e: VoiceClientEvent) {
    if (this.closed) fault('VOICE_INVALID_STATE');
    if (e.type === 'calendar.confirm') {
      if (!this.deps.hooks.calendarControl) fault('VOICE_INVALID_STATE');
      if (this.pendingTurns || this.agent === 'thinking') {
        this.sink.event({ type: 'session.warning', code: 'CONFLICT_ACTIVE_TURN',
          recovery: 'none', recoverable: true });
        return;
      }
      const thinking = new AbortController();
      this.thinking = thinking;
      this.pendingTurns++;
      this.agent = 'thinking'; this.state();
      this.finalChain = this.finalChain.then(async () => {
        if (!this.closed && !thinking.signal.aborted) {
          this.context.assertPaidWork?.();
          await this.deps.hooks.calendarControl!(this.context, e,
            AbortSignal.any([this.signal, this.lifetime.signal, thinking.signal]));
        }
      }).catch(error => {
        const failure = voiceError(error, 'VOICE_AGENT_FAILED');
        if (failure.code === 'INVALID_VOICE_CONTROL' || failure.code === 'CONFLICT_ACTIVE_TURN') {
          if (!this.closed) this.sink.event({ type: 'session.warning', code: failure.code,
            recovery: 'none', recoverable: true });
        } else this.error(failure.code);
      }).finally(() => {
        this.pendingTurns--;
        if (this.thinking === thinking) this.thinking = undefined;
        if (!this.current && !this.pendingTurns && !this.closed) { this.agent = 'idle'; this.state(); }
      });
      return;
    }
    if (e.type === 'input.suspend') { this.suspendInput(); return; }
    if (e.type === 'input.unmute' && this.suspended && !this.muted) {
      this.resumeRequested = true;
      this.resumeInput();
      return;
    }
    if (e.type === 'input.mute') {
      if (this.muted && !this.openingStt) return;
      this.muted = true;
      this.suspended = false;
      this.resumeRequested = false;
      this.inputLost = false;
      this.speechActive = false;
      this.sttGeneration++;
      this.cancelInputSettlement?.();
      this.state();
      await this.stt.close().catch(() => undefined);
      return;
    }
    if (e.type === 'input.unmute') {
      if (!this.muted) {
        if (!this.suspended && !this.openingStt) this.state();
        return;
      }
      if (this.openingStt) return;
      this.context.assertPaidWork?.();
      const generation = this.sttGeneration;
      const opening = this.deps.stt.connect({ mode: 'live', locale: 'en-US', audio: INPUT_AUDIO, abortSignal: this.signal });
      this.openingStt = opening;
      try {
        const stt = await opening;
        try {
          if (this.closed || generation !== this.sttGeneration) { await stt.close(); return; }
          this.context.assertPaidWork?.();
        } catch (error) { await stt.close(); throw error; }
        this.stt = stt;
        this.muted = false;
        this.renewalUsed = false;
        this.startInputReader();
        this.state();
      } finally {
        if (this.openingStt === opening) this.openingStt = undefined;
      }
      return;
    }
    if (e.type === 'playback.progress') {
      const r = this.progress(e, e.playedMs);
      this.wakeOutput?.();
      // Unproven cursor reports may guide local pacing but are not durable playback evidence.
      if (e.proof !== 'unproven') {
        await this.deps.hooks.playback(this.context, r, this.played);
        this.completePlayback(r);
      }
      return;
    }
    if (e.type === 'response.interrupt') {
      const r = this.progress(e, e.playbackPositionMs);
      // Unproven interruption cannot be reconciled as a provider playback offset; reset output instead.
      const proven = e.proof !== 'unproven';
      const position = proven ? Math.floor(this.played / 24) : -1;
      // Invalidate/cancel immediately; durable cleanup is tracked, not on the PCM receive chain.
      void this.interrupt(r, position, proven).catch(error => this.error(voiceError(error, 'VOICE_DELIVERY_UNKNOWN').code));
      return;
    }
    fault('VOICE_INVALID_STATE');
  }

  private progress(e: Extract<VoiceClientEvent, { type: 'playback.progress' | 'response.interrupt' }>, ms: number) {
    const r = this.responses.get(e.responseId);
    if (!r || r.turnId !== e.turnId) fault('VOICE_BINDING_MISMATCH');
    if (e.playedSamples < this.wirePlayed || e.playedSamples > r.wireBase + r.sent || e.playedSamples < r.wireBase ||
      ms !== Math.floor(e.playedSamples / 24)) fault('INVALID_VOICE_CONTROL');
    this.wirePlayed = e.playedSamples;
    // Transport cursor includes discarded frames; provider cursor does not. Never send the wire cursor to Flux.
    this.played = r.base + e.playedSamples - r.wireBase;
    if (!r.playbackSeen && e.playedSamples > r.wireBase && r.firstAudioAt !== undefined) {
      r.playbackSeen = true;
      this.deps.observe?.(this.context, { stage: 'playback-first-ack', ...this.ref(r),
        elapsedMs: performance.now() - r.firstAudioAt, queueSamples: r.wireBase + r.sent - e.playedSamples });
    }
    return r;
  }

  private finalWatermark(r: Response) {
    const sink = this.sink as VoiceSink & {
      watermark?(ref: { turnId: string; responseId: string }): void;
    };
    try {
      sink.watermark?.({ turnId: r.turnId, responseId: r.responseId });
    } catch {
      // A lost media lane must not fabricate or block delivery evidence.
    }
  }

  private completePlayback(r: Response) {
    if (!r.invalid && r.completed && r.wireBase + r.sent === this.wirePlayed && this.current === r) {
      this.sink.event({ type: 'audio.end', turnId: r.turnId, responseId: r.responseId, lastAudioSequence: null });
      this.current = undefined;
      r.release();
      this.agent = 'idle';
      this.state();
    }
  }

  prepareResponse(ref: { turnId: string; responseId: string }) {
    if (this.closed) fault('VOICE_INVALID_STATE');
    let r = this.responses.get(ref.responseId);
    if (!r) {
      if (this.current || this.responses.size >= 4096) fault('VOICE_INVALID_STATE');
      let release!: () => void;
      const drained = new Promise<void>(resolve => { release = resolve; });
      r = {
        ...ref,
        drained, release,
        preparedAt: performance.now(),
        invalid: false,
        started: false,
        spoken: false,
        sent: 0,
        base: this.providerBase,
        wireBase: this.sink.outputSamples(),
        completed: false
      };
      this.responses.set(ref.responseId, r);
      this.current = r;
      this.played = r.base;
      this.deps.observe?.(this.context, { stage: 'response-prepared', ...ref,
        ...(this.endOfTurnAt === undefined ? {} : { elapsedMs: performance.now() - this.endOfTurnAt }) });
      this.endOfTurnAt = undefined;
    }
    if (r.turnId !== ref.turnId || r.invalid || r.completed) fault('VOICE_INVALID_STATE');
    return { providerBaseSamples: r.base };
  }

  async speak(command: { turnId: string; responseId: string; text: string }) {
    if (!command.text) return;
    if (this.recoveringSpeech) await this.recoveringSpeech;
    if (this.speechFailed) return;
    this.prepareResponse(command);
    const r = this.responses.get(command.responseId)!;
    if (r.turnId !== command.turnId || r.invalid || r.completed) fault('VOICE_INVALID_STATE');
    r.spoken = true;
    if (r.firstSpeakAt === undefined) {
      r.firstSpeakAt = performance.now();
      this.deps.observe?.(this.context, { stage: 'tts-first-submit', ...this.ref(r),
        ...(r.modelOutputAt === undefined ? {} : { elapsedMs: r.firstSpeakAt - r.modelOutputAt }) });
    }
    await this.tts.speak(command);
  }

  async flush(ref: { turnId: string; responseId: string }) {
    if (this.recoveringSpeech) await this.recoveringSpeech;
    if (this.speechFailed) return;
    const r = this.responses.get(ref.responseId);
    if (!r || r.invalid || r.turnId !== ref.turnId || this.closed) fault('VOICE_INVALID_STATE');
    await this.tts.flush(ref);
  }

  private async interrupt(r: Response, ms: number, persistPlayback = true) {
    if (r.interrupt) { await r.interrupt; return; }
    if (r.invalid) return;
    r.invalid = true;
    this.wakeOutput?.();
    if (r.started) {
      try {
        this.sink.invalidate({ turnId: r.turnId, responseId: r.responseId });
      } catch {
        // Failed media must not prevent durable cancellation.
      }
    }
    this.agent = 'idle';
    try {
      this.state();
    } catch {
      // Cancellation below remains authoritative after transport loss.
    }
    r.interrupt = (async () => {
      // Invalidation occurs before either asynchronous operation; provider cancellation is best-effort.
      const abort = (async () => {
        const playback = persistPlayback
          ? this.deps.hooks.playback(this.context, r, this.played)
          : Promise.resolve();
        const cancellation = this.deps.hooks.interrupt(this.context, r);
        await Promise.all([playback, cancellation]);
      })();
      if (r.completed || !r.spoken) {
        await abort;
        if (this.current === r) this.current = undefined;
        r.release();
        return;
      }
      if (!r.sent || ms <= this.lastInterrupt) {
        await Promise.all([abort, this.resetOutput(r)]);
        return;
      }
      this.lastInterrupt = ms;
      try {
        await this.tts.interrupt({
          turnId: r.turnId,
          responseId: r.responseId,
          providerSocketId: this.tts.providerSocketId,
          playbackPositionMs: ms
        });
      } finally {
        await abort;
      }
    })();
    await r.interrupt;
  }

  private async readStt(connection = this.stt, generation = this.sttGeneration) {
    try {
      for await (const e of connection.events) {
        if (e.type === 'usage') { await this.deps.usage(this.context, e.usage); continue; }
        if (this.closed || generation !== this.sttGeneration) continue;
        if (!this.muted && ((e.type === 'partial' || e.type === 'final' || e.type === 'end-of-turn') && e.text.trim() || e.type === 'start-of-turn'))
          this.deps.activity?.(this.context);
        if ((e.type === 'partial' || e.type === 'final') && e.text.trim()) {
          this.speechActive = true;
        }
        if (e.type === 'start-of-turn' && !this.muted && !this.suspended && !this.settlingInput) {
          this.thinking?.abort();
          if (this.current) void this.interrupt(this.current, Math.floor(this.played / 24))
            .catch(() => this.error('VOICE_DELIVERY_UNKNOWN'));
        } else if (e.type === 'end-of-turn') {
          this.speechActive = false;
          if (!this.muted && e.text.trim() && !this.turns.has(e.providerTurnId)) {
            if (this.turns.size >= 4096) fault('VOICE_SEQUENCE_ERROR');
            if (this.pendingTurns >= 2) fault('CONFLICT_ACTIVE_TURN');
            this.pendingTurns++;
            this.turns.add(e.providerTurnId);
            this.agent = 'thinking';
            this.state();
            const thinking = new AbortController();
            const endedAt = performance.now();
            this.deps.observe?.(this.context, { stage: 'stt-end-of-turn' });
            this.thinking = thinking;
            // One bounded pending completed input; never spawn unbounded agent promises.
            this.finalChain = this.finalChain.then(async () => {
              this.endOfTurnAt = endedAt;
              if (!this.closed && !thinking.signal.aborted) await this.deps.hooks.finalized(this.context, {
                providerSocketEpoch: this.context.response.connectionEpoch,
                providerTurnId: e.providerTurnId,
                text: e.text
              }, AbortSignal.any([this.signal, this.lifetime.signal, thinking.signal]));
            }).catch(error => this.error(voiceError(error, 'VOICE_AGENT_FAILED').code))
              .finally(() => {
                this.pendingTurns--;
                if (this.thinking === thinking) this.thinking = undefined;
                if (this.speechFailed && !this.closed) this.error(this.speechFailed);
                if (!this.current && !this.pendingTurns) { this.agent = 'idle'; this.state(); }
              });
          }
        } else if (e.type === 'error') {
          this.unavailableInput(generation, e.fault.code);
        }
      }
      this.unavailableInput(generation, 'STT_UNAVAILABLE');
    } catch (error) {
      this.unavailableInput(generation, error instanceof VoiceSessionError ? error.code : 'STT_UNAVAILABLE');
    }
  }

  private async readTts(connection = this.tts, generation = this.ttsGeneration) {
    try {
      for await (const e of connection.events) {
        if (e.type === 'error') {
          if (!this.closed && generation === this.ttsGeneration) {
            if (e.fault.code === 'VOICE_DELIVERY_UNKNOWN' && this.current?.invalid) {
              void this.resetOutput(this.current).catch(() => this.error('TTS_UNAVAILABLE'));
            } else if (this.thinking) this.recoverSpeech(e.fault.code);
            else this.error(e.fault.code);
          }
          continue;
        }
        // Reconciliation evidence must reach P6 even after the UI/transport is closed; speech-started is tracked without blocking first PCM.
        if (e.type === 'speech-started') {
          const startedHook = Promise.resolve(this.deps.hooks.delivery(this.context, e)).catch(error => {
            if (!this.closed && generation === this.ttsGeneration) {
              const code = error instanceof VoiceSessionError ? error.code : 'VOICE_DELIVERY_UNKNOWN';
              if (this.thinking) this.recoverSpeech(code);
              else this.error(code);
            }
          });
          this.ttsTasks.add(startedHook);
          void startedHook.finally(() => this.ttsTasks.delete(startedHook));
        } else if (e.type !== 'audio') {
          await this.deps.hooks.delivery(this.context, e.type === 'speech-completed'
            ? { ...e, audioSamples: this.responses.get(e.responseId)?.sent } : e);
        }
        if (e.type === 'speech-completed' || e.type === 'speech-interrupted') await this.deps.usage(this.context, e.usage);
        if (this.closed || generation !== this.ttsGeneration) continue;
        const r = this.responses.get(e.responseId);
        if (!r || r.turnId !== e.turnId) continue;
        if (e.type === 'speech-interrupted') {
          if (e.audioPlayedMs === null) {
            if (r.invalid) void this.resetOutput(r).catch(() => this.error('TTS_UNAVAILABLE'));
            else if (this.thinking) this.recoverSpeech('VOICE_DELIVERY_UNKNOWN');
            else this.error('VOICE_DELIVERY_UNKNOWN');
            continue;
          }
          this.providerBase = r.base + e.audioPlayedMs * 24;
          if (this.current === r) this.current = undefined;
          r.release();
          continue;
        }
        if (r.invalid || this.speechFailed) continue;
        if (e.type === 'speech-started') {
          if (r.started) continue;
          r.started = true;
          this.agent = 'speaking';
          this.state();
          this.sink.event({
            type: 'audio.start',
            turnId: r.turnId,
            responseId: r.responseId,
            sampleRate: 24000,
            firstAudioSequence: 0
          });
        } else if (e.type === 'audio') {
          if (!r.started || !e.pcm.byteLength || e.pcm.byteLength > 131072 || e.pcm.byteLength % 2) fault('INVALID_AUDIO_FRAME');
          // Pace PCM to actual playback, retaining only one bounded provider frame here.
          const bytes = Math.min(9600, this.context.response.limits.outputQueueMs * 48);
          for (let offset = 0; offset < e.pcm.byteLength; offset += bytes) {
            const part = e.pcm.subarray(offset, offset + bytes);
            while (!this.closed && !r.invalid && !this.speechFailed && generation === this.ttsGeneration && r.wireBase + r.sent + part.byteLength / 2 - Math.max(this.wirePlayed, r.wireBase) > this.context.response.limits.outputQueueMs * 24) {
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => { this.wakeOutput = undefined; reject(new VoiceSessionError('VOICE_DELIVERY_UNKNOWN')); }, 30000);
                this.wakeOutput = () => { clearTimeout(timer); this.wakeOutput = undefined; resolve(); };
              });
            }
            if (this.closed || r.invalid || this.speechFailed || generation !== this.ttsGeneration) break;
            if (r.firstAudioAt === undefined) {
              r.firstAudioAt = performance.now();
              this.deps.observe?.(this.context, { stage: 'tts-first-audio', ...this.ref(r),
                ...(r.firstSpeakAt === undefined ? {} : { elapsedMs: performance.now() - r.firstSpeakAt }) });
            }
            this.sink.audio({ turnId: r.turnId, responseId: r.responseId }, part);
            r.sent += part.byteLength / 2;
          }
        } else if (e.type === 'speech-completed') {
          if (!r.started) fault('VOICE_INVALID_STATE');
          r.completed = true;
          this.providerBase = r.base + e.audioDurationMs * 24;
          // Announce the final generated-sample ceiling before any final progress ACK.
          this.finalWatermark(r);
          // Keep audio response open until final playback.progress: barge-in must still cancel queued playback.
          // Progress may already have arrived before provider completion; do not require a second acknowledgment.
          this.completePlayback(r);
        }
      }
      if (!this.closed && generation === this.ttsGeneration) {
        if (this.thinking) this.recoverSpeech('TTS_UNAVAILABLE');
        else this.error('TTS_UNAVAILABLE');
      }
    } catch (error) {
      if (!this.closed && generation === this.ttsGeneration) {
        const code = error instanceof VoiceSessionError ? error.code : 'VOICE_DELIVERY_UNKNOWN';
        if (this.thinking) this.recoverSpeech(code);
        else this.error(code);
      }
    }
  }

  private recoverSpeech(code: VoiceErrorCode) {
    if (this.closed || this.speechFailed) return;
    if (this.speechReconnectUsed) {
      this.failSpeech(code);
      return;
    }
    this.speechReconnectUsed = true;
    this.recoveringSpeech = this.reconnectSpeech(code);
  }

  private async reconnectSpeech(code: VoiceErrorCode) {
    this.ttsGeneration++;
    this.wakeOutput?.();
    const old = this.tts;
    try {
      await old.close();
      if (this.closed) return;
      const fresh = await this.deps.tts.connect({ audio: OUTPUT_AUDIO, abortSignal: this.signal });
      if (this.closed) { await fresh.close(); return; }
      this.tts = fresh;
      this.providerBase = 0;
      this.lastInterrupt = -1;
      this.startOutputReader();
    } catch {
      this.failSpeech(code);
    }
  }

  private failSpeech(code: VoiceErrorCode) {
    if (this.closed) return;
    this.speechFailed ??= code;
    this.wakeOutput?.();
  }

  private error(code: VoiceErrorCode) {
    if (this.closed) return;
    this.deps.observe?.(this.context, { stage: 'flow-error', code, ...(this.current ? this.ref(this.current) : {}),
      queueSamples: this.current ? Math.max(0, this.current.wireBase + this.current.sent - this.wirePlayed) : 0 });
    const recoverable = !['VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT', 'VOICE_DISABLED',
      'VOICE_SESSION_ENDED', 'VOICE_RECONNECT_TIMEOUT'].includes(code);
    if (this.sink.pause) this.sink.pause(code, recoverable);
    else this.sink.event({ type: 'session.error', code,
      recovery: recoverable ? 'resume_call' : 'none', recoverable, terminal: false });
    void this.close().catch(() => undefined);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.speechActive = false;
    this.sttGeneration++;
    this.cancelInputSettlement?.();
    this.lifetime.abort();
    this.thinking?.abort();
    this.wakeOutput?.();
    if (this.current) {
      this.current.invalid = true;
      this.current.release();
      try { if (this.current.started) this.sink.invalidate({ turnId: this.current.turnId, responseId: this.current.responseId }); }
      catch { /* Transport already failed; still drain providers. */ }
    }
    const opening = this.openingStt;
    this.closing = (async () => {
      const result = await Promise.allSettled([this.stt.close(), this.tts.close()]);
      await this.resettingTts;
      await this.recoveringSpeech;
      await this.retiredStt;
      const late = await opening?.catch(() => undefined);
      if (late && late !== this.stt) await late.close();
      // Allocation may be disposed before ready/start; still drain terminal accounting/evidence.
      this.sttTask ??= this.readStt();
      this.ttsTask ??= this.readTts();
      await Promise.all([...this.sttTasks, ...this.ttsTasks, this.sttTask, this.ttsTask]);
      await Promise.all([...this.responses.values()].map(r => r.interrupt));
      await this.deps.hooks.disconnected(this.context);
      if (result.some(r => r.status === 'rejected')) fault('VOICE_DELIVERY_UNKNOWN');
    })();
    return this.closing;
  }
}
