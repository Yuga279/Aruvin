/**
 * ============================================================================
 * FILE: dictation-flow.ts
 * LOCATION: backend/src/voice/session/dictation-flow.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Dictation mode audio streaming and transcript event routing.
 *
 * ROLE IN PROJECT:
 *    Connects incoming client audio to Nova STT, routes partial and final
 *    transcription events to VoiceSink, handles bounded stop and cancellation,
 *    and produces final dictation completion events.
 *
 * KEY COMPONENTS:
 *    - DictationFlow: Implements VoiceFlow for dictation mode.
 * ============================================================================
 */

import type { SpeechToTextPort, SpeechInputConnection, SttEvent, SpeechUsage } from '../../contracts/voice.js';
import { INPUT_AUDIO, type VoiceClientEvent } from '../../contracts/voice-wire.js';
import { fault, type SessionContext, type VoiceFlow, type VoiceSink } from './voice-session.options.js';

export class DictationFlow implements VoiceFlow {
  private state: 'recording' | 'finalizing' | 'closed' = 'recording';
  private finals = new Set<string>();
  private interim = false;
  private audioBytes = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private closing?: Promise<void>;
  private task?: Promise<void>;

  private constructor(
    private readonly context: SessionContext,
    private readonly sink: VoiceSink,
    private readonly stt: SpeechInputConnection,
    private readonly usage: (c: SessionContext, u: SpeechUsage) => Promise<void>
  ) {}

  static async open(
    context: SessionContext,
    sink: VoiceSink,
    signal: AbortSignal,
    port: SpeechToTextPort,
    usage: (c: SessionContext, u: SpeechUsage) => Promise<void>
  ) {
    if (context.response.mode !== 'dictation') fault('VOICE_INVALID_STATE');
    const stt = await port.connect({ mode: 'dictation', locale: 'en-US', audio: INPUT_AUDIO, abortSignal: signal });
    const flow = new DictationFlow(context, sink, stt, usage);
    return flow;
  }

  start() {
    if (!this.task) this.task = this.consume();
  }

  async input(pcm: Uint8Array) {
    if (this.state !== 'recording') fault('VOICE_INVALID_STATE');
    this.audioBytes += pcm.byteLength;
    await this.stt.writeAudio(pcm);
  }

  async control(event: VoiceClientEvent) {
    if (event.type === 'dictation.cancel') {
      if (this.state === 'closed') return;
      await this.close();
      this.sink.finish('cancelled');
      return;
    }
    if (event.type !== 'dictation.stop') fault('VOICE_INVALID_STATE');
    if (this.state !== 'recording') return;
    this.state = 'finalizing';
    this.timer = setTimeout(() => {
      void this.complete(this.interim || this.audioBytes > 0, true);
    }, Math.min(2000, this.context.response.limits.finalizationMs));
    // Non-blocking: a later Cancel must not wait behind provider finalization.
    void this.stt.finalize().catch(() => this.providerError());
  }

  private async consume() {
    try {
      for await (const e of this.stt.events) {
        if (e.type === 'usage') { await this.usage(this.context, e.usage); continue; }
        if (this.state === 'closed') continue;
        await this.handle(e);
      }
      if (this.state !== 'closed') await this.providerError();
    } catch {
      if (this.state !== 'closed') await this.providerError();
    }
  }

  private async handle(e: SttEvent) {
    if (e.type === 'partial' && !this.finals.has(e.segmentId)) {
      this.interim = Boolean(e.text);
      this.sink.event({ type: 'dictation.partial', segmentId: e.segmentId, text: e.text });
    } else if (e.type === 'final' && !this.finals.has(e.segmentId)) {
      if (this.finals.size >= 4096) fault('VOICE_SEQUENCE_ERROR');
      this.finals.add(e.segmentId);
      this.interim = false;
      this.sink.event({ type: 'dictation.final', segmentId: e.segmentId, text: e.text });
    } else if (e.type === 'finalized' && this.state === 'finalizing') {
      await this.complete(e.unfinalizedTail, false);
    } else if (e.type === 'error') {
      if (e.fault.code === 'DICTATION_FINALIZATION_TIMEOUT' && this.state === 'finalizing') return;
      await this.providerError();
    }
  }

  private async complete(unfinalizedTail: boolean, timeout = unfinalizedTail) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearTimeout(this.timer);
    if (timeout) this.sink.event({
      type: 'session.warning',
      code: 'DICTATION_FINALIZATION_TIMEOUT',
      recovery: 'retry_dictation',
      recoverable: true
    });
    try { await this.close(); } catch {
      this.sink.event({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'retry_dictation', recoverable: true, terminal: true });
      this.sink.finish('error');
      return;
    }
    this.sink.event({
      type: 'dictation.complete',
      finalization: timeout ? 'timeout' : this.finals.size ? 'complete' : 'empty',
      unfinalizedTail
    });
    this.sink.finish('completed');
  }

  private async providerError() {
    if (this.state === 'closed') return;
    this.sink.event({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'retry_dictation', recoverable: true, terminal: true });
    await this.close();
    this.sink.finish('error');
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.state = 'closed';
    clearTimeout(this.timer);
    // Never await the consumer from inside its own event callback.
    this.closing = this.stt.close();
    return this.closing;
  }
}
