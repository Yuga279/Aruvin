/**
 * ============================================================================
 * FILE: flux-tts.ts
 * LOCATION: backend/src/voice/providers/flux-tts.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deepgram Flux conversational text-to-speech adapter.
 *
 * ROLE IN PROJECT:
 *    Implements SpeechSynthesisPort for live voice mode, converting streamed
 *    agent response text into 24kHz PCM audio chunks, gating completion on SpeechMetadata,
 *    and reconciling socket-wide interruption playback offsets.
 *
 * KEY COMPONENTS:
 *    - FluxTtsAdapter: SpeechSynthesisPort implementation for Flux TTS
 *    - Response fencing and single-active-response enforcement
 *    - Interruption offset reconciliation and late audio invalidation
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { VoiceAccounting, SpeechAccountingEntry } from '../usage/voice-accounting.js';
import type { SpeechSynthesisPort, SpeechOutputConnection, TtsEvent, SpeechUsage } from '../../contracts/voice.js';
import { OUTPUT_AUDIO } from '../../contracts/voice-wire.js';
import type { VoiceConfig } from '../../platform/config/voice-config.js';
import { ProviderLink, ProviderFault, providerUrl, providerText, providerId, uint, sameAudio, socketFactory, type SocketFactory } from './provider-link.js';

const metaSchema = z.object({ speech_id: providerId, audio_duration_ms: uint, billable_character_count: uint });
type Active = { turnId: string; responseId: string; text: string; speechId: string | null;
  baseMs: number; bytes: number; flushed: boolean; interrupted: boolean; offset: number | null;
  entry: SpeechAccountingEntry };
export class FluxTtsAdapter implements SpeechSynthesisPort {
  constructor(private readonly cfg: VoiceConfig, private readonly factory: SocketFactory = socketFactory,
    private readonly accounting: VoiceAccounting) {}
  async connect(request: Parameters<SpeechSynthesisPort['connect']>[0]): Promise<SpeechOutputConnection> {
    if (!sameAudio(request.audio, OUTPUT_AUDIO)) throw new ProviderFault('INVALID_VOICE_REQUEST', 'return_to_chat', false);
    const providerSocketId = randomUUID();
    const socketEntry = await this.accounting.start(providerSocketId, this.cfg.deepgram.ttsModel);
    let active: Active | undefined; let completedMs = 0; let lastInterrupt = -1;
    let lastInvalidated: string | undefined; let lastCompleted: string | undefined;
    let cancelInterrupt: (() => void) | undefined;
    let cancelCompletion: (() => void) | undefined;
    let cancelFirstAudio: (() => void) | undefined;
    let requestId: string | null = null; let version: string | null = null;
    const usage = (duration: number | null = null, chars: number | null = null): SpeechUsage => ({
      providerRequestId: requestId, model: this.cfg.deepgram.ttsModel, modelVersion: version,
      audioMs: duration, billableCharacters: chars,
      usageId: active?.entry.usageId, speechId: active?.speechId ?? null,
    });
    const persist = (entry: SpeechAccountingEntry, value: SpeechUsage,
      status: Parameters<SpeechAccountingEntry['finish']>[1]) => {
      void entry.finish(value, status).catch(() => link.fail(new ProviderFault('TTS_UNAVAILABLE')));
    };
    const publishUnknown = () => {
      cancelFirstAudio?.(); cancelCompletion?.(); cancelInterrupt?.();
      if (!active) return;
      const r = active;
      link.queue.discard(e => e.type === 'audio' && e.responseId === r.responseId);
      // A terminal fault must retain evidence even when the normal queue is full.
      const event: TtsEvent = { type: 'speech-interrupted', turnId: r.turnId, responseId: r.responseId,
        speechId: r.speechId, audioPlayedMs: null, textSpoken: null, textRemaining: null, usage: usage() };
      persist(r.entry, event.usage, request.abortSignal.aborted ? 'cancelled' : 'failed');
      lastInvalidated = r.responseId; active = undefined;
      link.queue.discard(e => e.type === 'speech-started' && e.responseId === r.responseId);
      link.queue.retainTerminalEvidence(event);
    };
    const unknown = () => { publishUnknown(); link.fail(new ProviderFault('VOICE_DELIVERY_UNKNOWN')); };
    const requireResponse = (command: { turnId: string; responseId: string }) => {
      if (!link.active || !active || active.turnId !== command.turnId || active.responseId !== command.responseId)
        throw new ProviderFault('VOICE_INVALID_STATE');
      return active;
    };
    const link = new ProviderLink<TtsEvent>(this.cfg, request.abortSignal, 'TTS_UNAVAILABLE', 'return_to_chat',
      this.cfg.limits.outputQueueMs * 48, e => e.type === 'audio' ? e.pcm.byteLength : 0,
      fault => ({ type: 'error', fault }), message => {
        if (message instanceof Uint8Array) {
          if (!active || active.interrupted) return;
          if (!active.speechId || !message.byteLength || message.byteLength % 2) throw new Error('Invalid PCM ordering');
          cancelFirstAudio?.();
          if (active.flushed) { cancelCompletion?.(); cancelCompletion = link.deadline(30000, unknown, true); }
          active.bytes += message.byteLength;
          link.emit({ type: 'audio', turnId: active.turnId, responseId: active.responseId, pcm: Uint8Array.from(message) }); return;
        }
        if (message.type === 'Connected') {
          requestId = providerId.parse(message.request_id); version = providerId.parse(message.model_version);
          providerId.parse(message.model_name); return;
        }
        if (!active) return;
        if (message.type === 'SpeechStarted') {
          const id = providerId.parse(message.speech_id);
          if (active.speechId === id) return;
          if (active.speechId) throw new Error('Overlapping speech');
          active.speechId = id;
          if (!active.interrupted) link.emit({ type: 'speech-started', turnId: active.turnId, responseId: active.responseId, speechId: id });
        } else if (message.type === 'SpeechMetadata') {
          const m = metaSchema.parse(message);
          if (m.speech_id !== active.speechId || active.interrupted) return;
          const response = active;
          cancelFirstAudio?.(); cancelCompletion?.();
          const evidence = usage(m.audio_duration_ms, m.billable_character_count);
          persist(active.entry, evidence, active.flushed ? 'completed' : 'failed');
          if (!active.flushed) throw new Error('Premature completion');
          link.emit({ type: 'speech-completed', turnId: active.turnId, responseId: active.responseId,
            speechId: m.speech_id, audioDurationMs: m.audio_duration_ms,
            usage: evidence });
          completedMs = response.baseMs + m.audio_duration_ms; lastCompleted = response.responseId; active = undefined;
        } else if (message.type === 'SpeechInterrupted') {
          if (!active.interrupted) return;
          const m = metaSchema.parse(message.metadata);
          if (active.speechId !== null && m.speech_id !== active.speechId) return;
          cancelFirstAudio?.(); cancelInterrupt?.(); cancelCompletion?.();
          const response = active;
          const evidence = { ...usage(m.audio_duration_ms, m.billable_character_count), speechId: m.speech_id };
          // Billing evidence is independent of the validity of playback reconciliation.
          persist(response.entry, evidence, 'interrupted');
          const offset = uint.parse(message.audio_played_ms);
          const spoken = providerText.safeParse(message.text_spoken); const remaining = providerText.safeParse(message.text_remaining);
          const valid = active.offset === offset && spoken.success && remaining.success &&
            spoken.data + remaining.data === active.text && active.text.startsWith(spoken.data) &&
            offset >= active.baseMs && offset - active.baseMs <= Math.ceil(active.bytes / 48);
          link.emit({ type: 'speech-interrupted', turnId: active.turnId, responseId: active.responseId,
            speechId: m.speech_id, audioPlayedMs: valid ? offset - active.baseMs : null,
            textSpoken: valid ? spoken.data : null, textRemaining: valid ? remaining.data : null,
            usage: evidence });
          // The provider rebases cumulative audio at an interrupt; discarded generated audio is not counted.
          completedMs = offset; lastInterrupt = Math.max(lastInterrupt, offset);
          lastInvalidated = response.responseId; active = undefined;
        } else if (message.type === 'Warning' && active.interrupted &&
          ['INVALID_INTERRUPT_OFFSET', 'NO_AUDIO_GENERATED', 'INTERRUPT_IN_PROGRESS'].includes(String(message.code))) unknown();
        // Flushed and non-fatal informational warnings do not mean completion.
      }, this.factory, true, (previous, next) => {
        if (previous.type !== 'audio' || next.type !== 'audio' || previous.responseId !== next.responseId ||
          previous.turnId !== next.turnId || previous.pcm.length + next.pcm.length > 9600) return undefined;
        // ponytail: copy at most one 200ms PCM block to bound tiny-frame object overhead; a block deque is the upgrade path if profiling warrants it.
        const pcm = new Uint8Array(previous.pcm.length + next.pcm.length);
        pcm.set(previous.pcm); pcm.set(next.pcm, previous.pcm.length);
        return { ...previous, pcm };
      });
    link.onFailure = () => { publishUnknown(); persist(socketEntry, usage(), request.abortSignal.aborted ? 'cancelled' : 'failed'); };
    link.onFinish = () => persist(socketEntry, usage(), 'closed');
    try { await link.start(providerUrl(this.cfg, '/v2/speak', { model: this.cfg.deepgram.ttsModel,
      tag: this.accounting.tag, encoding: 'linear16', sample_rate: '24000' }), true); } catch (error) {
      link.fail(error instanceof ProviderFault ? error : new ProviderFault('TTS_UNAVAILABLE'));
      await this.accounting.drain(); throw error;
    }
    link.heartbeat('ping');
    return { providerSocketId, events: link.queue,
      speak: async command => {
        providerId.parse(command.turnId); providerId.parse(command.responseId); providerText.parse(command.text);
        if (!link.active || command.responseId === lastInvalidated || command.responseId === lastCompleted) throw new ProviderFault('VOICE_INVALID_STATE');
        if (!command.text) return;
        if (!active) {
          try {
            const entry = await this.accounting.start(providerSocketId, this.cfg.deepgram.ttsModel, command);
            if (!link.active) {
              await entry.finish(usage(), request.abortSignal.aborted ? 'cancelled' : 'failed');
              throw new ProviderFault('VOICE_SESSION_ENDED');
            }
            void entry.admitted?.catch(() => {
              publishUnknown();
              link.fail(new ProviderFault('TTS_UNAVAILABLE'));
            });
            active = { turnId: command.turnId, responseId: command.responseId, text: '', speechId: null,
              baseMs: completedMs, bytes: 0, flushed: false, interrupted: false, offset: null, entry };
            cancelFirstAudio = link.deadline(30000, unknown);
          } catch (error) {
            link.fail(new ProviderFault('TTS_UNAVAILABLE')); throw error;
          }
        }
        const r = requireResponse(command);
        if (r.flushed || r.interrupted || r.text.length + command.text.length > 32000) throw new ProviderFault('VOICE_INVALID_STATE');
        r.text += command.text;
        // Preserve chunks verbatim: adding spaces here would corrupt token splits such as "Al" + "fred".
        await link.json({ type: 'Speak', text: command.text });
      },
      flush: async command => {
        const r = requireResponse(command); if (r.flushed || r.interrupted) return; r.flushed = true;
        cancelCompletion = link.deadline(30000, unknown, true);
        await link.json({ type: 'Flush' });
      },
      interrupt: async command => {
        if (command.providerSocketId !== providerSocketId) throw new ProviderFault('VOICE_BINDING_MISMATCH');
        if (command.responseId === lastInvalidated) return;
        const r = requireResponse(command); if (r.interrupted) return;
        const offset = uint.safeParse(command.playbackPositionMs);
        if (!offset.success || offset.data < r.baseMs || offset.data > r.baseMs + Math.ceil(r.bytes / 48))
          throw new ProviderFault('INVALID_VOICE_CONTROL', 'return_to_chat', false);
        r.interrupted = true; lastInvalidated = r.responseId;
        link.queue.discard(e => e.type === 'audio' && e.responseId === r.responseId);
        cancelCompletion?.();
        if (offset.data <= lastInterrupt) { unknown(); return; }
        r.offset = offset.data; lastInterrupt = offset.data;
        cancelInterrupt = link.deadline(Math.min(2000, this.cfg.limits.finalizationMs), unknown);
        await link.json({ type: 'Interrupt', playback_offset: { type: 'time_ms', value: offset.data } });
      },
      close: async () => {
        try {
          if (!link.active) return;
          cancelFirstAudio?.(); cancelInterrupt?.(); cancelCompletion?.();
          if (active) { unknown(); return; }
          try { await link.json({ type: 'Close' }); } finally { link.finish(); }
        } finally { await this.accounting.drain(); }
      },
    };
  }
}
