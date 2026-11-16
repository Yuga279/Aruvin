/**
 * ============================================================================
 * FILE: voice-connection.ts
 * LOCATION: backend/src/voice/transport/voice-connection.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Dictation PCM WebSocket connection handler for a single voice session.
 *
 * ROLE IN PROJECT:
 *    The public gateway admits dictation only. This generic sink/framing code also
 *    remains available to internal compatibility fixtures, not as live PCM fallback.
 *
 * KEY COMPONENTS:
 *    - VoiceSocket: Abstraction over raw WebSocket interface.
 *    - VoiceConnection: Implements VoiceSink, frames input/output and tracks sequence state.
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { decodeVoiceAudio, encodeVoiceAudio } from '../../contracts/voice-audio.js';
import { parseVoiceControl, MAX_VOICE_CONTROL_BYTES, type VoiceErrorCode, type VoiceServerPayload } from '../../contracts/voice-wire.js';
import { VoiceSessionError, fault, voiceError, type VoiceFlow, type VoiceSink } from '../session/voice-session.options.js';
import { VoiceSessionService, type VoiceBinding } from '../session/voice-session.service.js';

export type VoiceSocket = {
  readyState: number;
  bufferedAmount: number;
  send(data: string | Uint8Array): unknown;
  close(code?: number): unknown;
  terminate(): unknown;
};

export class VoiceConnection implements VoiceSink {
  private flow?: VoiceFlow;
  private abort = new AbortController();
  private ready = false;
  private closed = false;
  private failing = false;
  private rx = -1;
  private tx = 0;
  private inputSequence = 0;
  private inputSamples = 0;
  private inputEnded = false;
  private outputSequence = 0;
  private outputCursor = 0;
  private pendingBytes = 0;
  private pendingMessages = 0;
  private chain = Promise.resolve();
  private closePromise?: Promise<void>;
  private eventIds = new Set<string>();
  private active?: { turnId: string; responseId: string; last: number | null };
  private starting?: Promise<VoiceFlow>;
  private timer: ReturnType<typeof setTimeout>;
  private paused = false;
  private pauseCode?: VoiceErrorCode;
  private pausing?: Promise<void>;
  private pauseDrainFailed = false;

  constructor(
    private readonly sessions: VoiceSessionService,
    readonly binding: VoiceBinding,
    private readonly socket: VoiceSocket
  ) {
    binding.cleanup = () => this.dispose();
    binding.warning = code => this.event({ type: 'session.warning', code, recovery: 'none', recoverable: true });
    binding.terminal = reason => {
      const code = reason === 'duration' ? 'VOICE_DURATION_LIMIT' : reason === 'idle' ? 'VOICE_IDLE_TIMEOUT'
        : reason === 'quota' ? 'VOICE_QUOTA_EXHAUSTED' : undefined;
      if (code) this.event({ type: 'session.error', code, recovery: 'return_to_chat', recoverable: false, terminal: true });
      this.event({ type: 'session.ended', reason, terminal: true });
    };
    binding.pause = async reason => {
      this.pause(reason === 'duration' ? 'VOICE_DURATION_LIMIT' : 'VOICE_QUOTA_EXHAUSTED', false);
      this.event({ type: 'session.ended', reason, terminal: false });
      await this.pausing;
    };
    this.timer = setTimeout(() => this.fail('VOICE_CONNECT_TIMEOUT'), binding.response.limits.connectMs);
  }

  pause(code: VoiceErrorCode, recoverable = !['VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT',
    'VOICE_DISABLED', 'VOICE_SESSION_ENDED', 'VOICE_RECONNECT_TIMEOUT'].includes(code)) {
    if (this.closed) return;
    const wasPaused = this.paused;
    this.paused = true;
    clearTimeout(this.timer);
    if (!wasPaused || this.pauseCode !== code)
      this.sessions.options.observe?.(this.binding, { stage: 'flow-error', code });
    try {
      if (!wasPaused || this.pauseCode !== code) this.event({ type: 'session.error', code,
        recovery: recoverable ? 'resume_call' : 'none', recoverable, terminal: false });
    } catch { /* A lost control socket must not prevent stopping paid work. */ }
    this.pauseCode = code;
    if (wasPaused) return;
    this.pausing = (async () => {
      const retiring = this.flow ?? await this.starting?.catch(() => undefined);
      await retiring?.close();
      if (this.flow === retiring) this.flow = undefined;
    })().catch(() => {
      // Evidence may be uncertain; keep paid work stopped, never pretend the old delivery completed.
      this.pauseDrainFailed = true;
      try { this.event({ type: 'session.error', code: 'VOICE_DELIVERY_UNKNOWN',
        recovery: 'none', recoverable: false, terminal: false }); }
      catch { /* The transport may already have gone away. */ }
    });
  }

  private async resumePaidWork() {
    await this.pausing;
    if (this.closed || !this.paused) return;
    if (this.pauseDrainFailed) {
      this.event({ type: 'session.error', code: 'VOICE_DELIVERY_UNKNOWN',
        recovery: 'none', recoverable: false, terminal: false });
      return;
    }
    try {
      this.binding.assertPaidWork?.();
      const firstReady = !this.ready;
      this.starting = this.sessions.options.open(this.binding, this, this.abort.signal);
      const flow = await this.starting;
      try {
        if (this.closed) return;
        this.binding.assertPaidWork?.();
      } catch (error) { await flow.close(); throw error; }
      this.flow = flow;
      this.paused = false;
      this.pauseCode = undefined;
      this.ready = true;
      if (firstReady) this.event({ type: 'session.ready', limits: this.binding.response.limits,
        effectiveAudioSettings: this.binding.response.effectiveAudioSettings });
      flow.start();
      this.event({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' });
    } catch (error) {
      this.pauseCode = undefined;
      this.pause(voiceError(error, 'STT_UNAVAILABLE').code);
    }
  }

  receive(bytes: Uint8Array, binary: boolean) {
    if (this.closed) return;
    const limit = binary ? 2576 : MAX_VOICE_CONTROL_BYTES;
    if (bytes.byteLength > limit) { this.fail(binary ? 'INVALID_AUDIO_FRAME' : 'INVALID_VOICE_CONTROL'); return; }
    const budget = this.binding.response.limits.inputQueueMs * 32 + 16 * Math.ceil(this.binding.response.limits.inputQueueMs / 80);
    if ((binary && this.pendingBytes + bytes.byteLength > budget) || this.pendingMessages >= 64) {
      this.fail('AUDIO_BUFFER_OVERFLOW'); return;
    }
    this.pendingMessages++;
    if (binary) this.pendingBytes += bytes.byteLength;
    // Copy only admitted bytes; no references to arbitrarily large RawData buffers.
    const data = Uint8Array.from(bytes);
    this.chain = this.chain.then(async () => {
      if (this.closed) return;
      if (binary) {
        if ((!this.ready && !this.paused) || this.inputEnded) fault('VOICE_INVALID_STATE');
        const frame = decodeVoiceAudio(data);
        if (frame.kind !== 1 || (frame.flags === 0 && frame.pcm.byteLength !== 2560)) fault('INVALID_AUDIO_FRAME');
        if (frame.sequence < this.inputSequence) return;
        if (frame.sequence !== this.inputSequence || frame.offsetMs !== Math.floor(this.inputSamples / 16)) fault('VOICE_SEQUENCE_ERROR');
        this.inputSequence++;
        this.inputSamples += frame.pcm.byteLength / 2;
        if (frame.flags === 1) this.inputEnded = true;
        // A live residual END frame is discarded, never ForceEndTurn/submitted; Flux only accepts 80ms.
        if (frame.pcm.byteLength && !(this.binding.response.mode === 'live' && frame.flags === 1 && frame.pcm.byteLength < 2560)
          && !this.paused)
          await this.flow!.input(frame.pcm);
        return;
      }
      let json: string;
      try { json = new TextDecoder('utf-8', { fatal: true }).decode(data); }
      catch { fault('INVALID_VOICE_CONTROL'); }
      const e = parseVoiceControl(json!, 'client', this.binding.response.mode);
      if (e.sessionId !== this.binding.response.sessionId) fault('VOICE_BINDING_MISMATCH');
      if (e.connectionEpoch !== this.binding.response.connectionEpoch) fault('STALE_CONNECTION_EPOCH');
      if (e.sequence <= this.rx) return;
      if (e.sequence !== this.rx + 1 || this.eventIds.has(e.eventId)) fault('VOICE_SEQUENCE_ERROR');
      // Sequence is authoritative for older replays; retain only a bounded recent ID window.
      if (this.eventIds.size >= 4096) this.eventIds.delete(this.eventIds.values().next().value!);
      this.eventIds.add(e.eventId);
      this.rx = e.sequence;
      if (e.type === 'session.end') { this.finish('completed'); return; }
      if (this.paused) {
        if (e.type === 'input.unmute') await this.resumePaidWork();
        return;
      }
      if (!this.ready) {
        if (e.type !== 'session.start') fault('VOICE_INVALID_STATE');
        try {
          this.binding.assertPaidWork?.();
          this.starting = this.sessions.options.open(this.binding, this, this.abort.signal);
          const flow = await this.starting;
          try {
            if (this.closed) return;
            if (this.paused) { await flow.close(); return; }
            this.binding.assertPaidWork?.();
          } catch (error) { await flow.close(); throw error; }
          this.flow = flow;
        } catch (error) {
          if (this.binding.response.mode !== 'live') throw error;
          this.pause(voiceError(error, 'STT_UNAVAILABLE').code);
          return;
        }
        this.ready = true;
        clearTimeout(this.timer);
        this.event({
          type: 'session.ready',
          limits: this.binding.response.limits,
          effectiveAudioSettings: this.binding.response.effectiveAudioSettings
        });
        this.flow!.start();
        return;
      }
      if (e.type === 'session.start') fault('VOICE_INVALID_STATE');
      if (e.type === 'dictation.stop' || e.type === 'dictation.cancel') this.inputEnded = true;
      // Stop starts finalization but must not block a later Cancel; flow owns its bounded drain.
      await this.flow!.control(e);
    }).catch(error => {
      const code = voiceError(error, 'VOICE_DELIVERY_UNKNOWN').code;
      const pauseCodes: readonly string[] = ['VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT',
        'VOICE_DISABLED', 'STT_UNAVAILABLE', 'TTS_UNAVAILABLE', 'VOICE_PROVIDER_RATE_LIMITED',
        'VOICE_AGENT_FAILED', 'VOICE_DELIVERY_UNKNOWN', 'VOICE_CONNECT_TIMEOUT', 'AUDIO_BUFFER_OVERFLOW'];
      if (this.binding.response.mode === 'live' && pauseCodes.includes(code)) this.pause(code);
      else this.fail(code);
    })
      .finally(() => { this.pendingMessages--; if (binary) this.pendingBytes -= data.byteLength; });
  }

  event(payload: VoiceServerPayload) {
    if (this.closed) return;
    if (payload.type === 'audio.start') {
      if (this.active) fault('VOICE_INVALID_STATE');
      // Start each response on an exact millisecond header origin; monotonic, never rebase on interrupt.
      this.outputCursor = Math.ceil(this.outputCursor / 24) * 24;
      this.active = { turnId: payload.turnId, responseId: payload.responseId, last: null };
      payload = { ...payload, firstAudioSequence: this.outputSequence, firstAudioSample: this.outputCursor };
    }
    if (payload.type === 'audio.end') {
      if (!this.active || this.active.responseId !== payload.responseId || this.active.turnId !== payload.turnId)
        fault('VOICE_BINDING_MISMATCH');
      payload = { ...payload, lastAudioSequence: this.active.last };
      this.active = undefined;
    }
    if (this.tx > 0xffffffff) fault('VOICE_SEQUENCE_ERROR');
    const value = {
      protocolVersion: 1,
      sessionId: this.binding.response.sessionId,
      connectionEpoch: this.binding.response.connectionEpoch,
      eventId: randomUUID(),
      sequence: this.tx++,
      ...payload
    };
    const json = JSON.stringify(value);
    parseVoiceControl(json, 'server', this.binding.response.mode);
    this.send(json);
  }

  audio(ref: { turnId: string; responseId: string }, pcm: Uint8Array) {
    if (this.paused) return;
    if (this.closed || !this.active || this.active.turnId !== ref.turnId || this.active.responseId !== ref.responseId) return;
    if (!pcm.byteLength || pcm.byteLength % 2) fault('INVALID_AUDIO_FRAME');
    for (let offset = 0; offset < pcm.byteLength; offset += 9600) {
      const part = pcm.subarray(offset, offset + 9600);
      const sequence = this.outputSequence++;
      this.send(encodeVoiceAudio({
        kind: 2,
        flags: 0,
        sequence,
        offsetMs: Math.floor(this.outputCursor / 24),
        pcm: part
      }));
      this.outputCursor += part.byteLength / 2;
      this.active.last = sequence;
    }
  }

  outputSamples() { return Math.ceil(this.outputCursor / 24) * 24; }

  invalidate(ref: { turnId: string; responseId: string }) {
    if (!this.active || this.active.turnId !== ref.turnId || this.active.responseId !== ref.responseId) return;
    const last = this.active.last;
    this.active = undefined;
    this.event({
      type: 'response.cancelled',
      turnId: ref.turnId,
      responseId: ref.responseId,
      lastAudioSequence: last
    });
  }

  private send(data: string | Uint8Array) {
    try {
      if (this.socket.readyState !== 1) fault('VOICE_INVALID_STATE');
      const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
      // PCM credit is independently playback-paced in LiveFlow. The wire permits
      // one-sample packets: account for their 16-byte headers, not just 200ms frames,
      // and reserve one bounded control payload so cancellation cannot starve.
      const budget = this.binding.response.limits.outputQueueMs * 24 * (2 + 16) + MAX_VOICE_CONTROL_BYTES;
      if (this.socket.bufferedAmount + bytes > budget) fault('AUDIO_BUFFER_OVERFLOW');
      this.socket.send(data);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'VOICE_DELIVERY_UNKNOWN');
      throw error;
    }
  }

  finish(reason: 'completed' | 'cancelled' | 'error') {
    if (this.closed) return;
    this.event({ type: 'session.ended', reason, terminal: true });
    void this.sessions.end(this.binding.response.sessionId).catch(() => undefined);
  }

  fail(code: string) {
    if (this.closed || this.failing) return;
    if (this.socket.readyState !== 1) {
      void this.lost().catch(() => undefined);
      return;
    }
    if (this.binding.response.mode === 'live' && ['AUDIO_BUFFER_OVERFLOW', 'VOICE_CONNECT_TIMEOUT'].includes(code)) {
      this.pause(code as VoiceErrorCode);
      return;
    }
    this.failing = true;
    const allowed = [
      'VOICE_DISABLED', 'INVALID_AUDIO_FRAME', 'INVALID_VOICE_CONTROL',
      'VOICE_BINDING_MISMATCH', 'STALE_CONNECTION_EPOCH', 'VOICE_SEQUENCE_ERROR',
      'VOICE_INVALID_STATE', 'AUDIO_BUFFER_OVERFLOW', 'VOICE_CONNECT_TIMEOUT'
    ];
    const safe = allowed.includes(code) ? code : 'VOICE_DELIVERY_UNKNOWN';
    this.sessions.options.observe?.(this.binding, { stage: 'transport-error', code: safe as VoiceSessionError['code'],
      queueSamples: Math.floor(this.pendingBytes / 2) });
    try {
      this.event({
        type: 'session.error',
        code: safe as VoiceSessionError['code'],
        recovery: 'return_to_chat',
        recoverable: false,
        terminal: true
      });
    } catch {
      /* No payload logging. */
    }
    void this.sessions.disconnected(this.binding, false).catch(() => undefined);
  }

  async lost() { await this.sessions.disconnected(this.binding, true); }

  dispose(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.abort.abort();
    clearTimeout(this.timer);
    this.closePromise = (async () => {
      try {
        await this.pausing;
        const flow = this.flow ?? await this.starting?.catch(() => undefined);
        await flow?.close();
      } finally {
        this.socket.close(1000);
      }
    })();
    return this.closePromise;
  }
}
