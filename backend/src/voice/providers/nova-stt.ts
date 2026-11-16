/**
 * ============================================================================
 * FILE: nova-stt.ts
 * LOCATION: backend/src/voice/providers/nova-stt.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deepgram Nova-3 speech-to-text adapter for dictation mode.
 *
 * ROLE IN PROJECT:
 *    Implements SpeechToTextPort for dictation, translating streaming Nova-3
 *    results into normalized SttEvents and handling bounded Stop finalization.
 *
 * KEY COMPONENTS:
 *    - NovaSttAdapter: SpeechToTextPort implementation for Nova-3 dictation
 *    - resultSchema: Validation schema for Deepgram Nova Results messages
 *    - Finalize / Stop drain with 2s deadline
 * ============================================================================
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { VoiceAccounting } from '../usage/voice-accounting.js';
import type { SpeechToTextPort, SpeechInputConnection, SttConnectRequest, SttEvent } from '../../contracts/voice.js';
import { INPUT_AUDIO } from '../../contracts/voice-wire.js';
import type { VoiceConfig } from '../../platform/config/voice-config.js';
import { ProviderLink, ProviderFault, providerUrl, providerText, providerId, sameAudio, socketFactory, type SocketFactory } from './provider-link.js';

const resultSchema = z.object({ type: z.literal('Results'), start: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(), channel_index: z.array(z.number().int().nonnegative()).min(1).max(2),
  is_final: z.boolean(), speech_final: z.boolean(), from_finalize: z.boolean().optional(),
  channel: z.object({ alternatives: z.array(z.object({ transcript: providerText })).min(1).max(10) }),
});
export class NovaSttAdapter implements SpeechToTextPort {
  constructor(private readonly cfg: VoiceConfig, private readonly factory: SocketFactory = socketFactory,
    private readonly accounting: VoiceAccounting) {}
  async connect(request: SttConnectRequest): Promise<SpeechInputConnection> {
    if (request.mode !== 'dictation' || request.locale !== 'en-US' || !sameAudio(request.audio, INPUT_AUDIO))
      throw new ProviderFault('INVALID_VOICE_REQUEST', 'retry_dictation', false);
    const entry = await this.accounting.start(randomUUID(), this.cfg.deepgram.dictationModel);
    let stopping = false; let stopPromise: Promise<void> | undefined;
    let resolveStop: (() => void) | undefined;
    let rejectStop: ((error: ProviderFault) => void) | undefined;
    let cancelDeadline: (() => void) | undefined;
    let audioEnd = 0; let finalEnd = 0; let interim = '';
    let finalStart = -1; let finalId = '';
    let providerRequestId: string | null = null;
    const finish = (uncertain: boolean) => {
      if (!link.active) return;
      cancelDeadline?.();
      if (uncertain) link.emit({ type: 'error', fault: { code: 'DICTATION_FINALIZATION_TIMEOUT', recovery: 'retry_dictation', recoverable: true } });
      link.emit({ type: 'finalized', unfinalizedTail: uncertain }); link.finish(); resolveStop?.();
    };
    const link = new ProviderLink<SttEvent>(this.cfg, request.abortSignal, 'STT_UNAVAILABLE', 'retry_dictation',
      131072, event => event.type === 'partial' || event.type === 'final' ? Buffer.byteLength(event.text) : 0,
      fault => ({ type: 'error', fault }), message => {
        if (message instanceof Uint8Array) throw new Error('Unexpected STT audio');
        if (message.type === 'Metadata' && message.request_id !== undefined)
          providerRequestId = providerId.parse(message.request_id);
        if (message.type !== 'Results') return;
        const r = resultSchema.parse(message); const text = r.channel.alternatives[0].transcript;
        // Duration changes across interim revisions and finalization; it is not identity.
        const segmentId = `${r.channel_index[0]}:${r.start}`;
        if (r.is_final) {
          if (r.start >= finalStart && segmentId !== finalId) {
            finalStart = r.start; finalId = segmentId;
            finalEnd = Math.max(finalEnd, r.start + r.duration); interim = '';
            if (text) link.emit({ type: 'final', segmentId, text });
          }
        } else if (segmentId !== finalId && r.start >= finalStart) { interim = text; link.emit({ type: 'partial', segmentId, text }); }
        if (stopping && r.from_finalize) finish(false);
      }, this.factory);
    const reportUsage = (status: 'closed' | 'failed' | 'cancelled') => { const usage = {
      providerRequestId, model: this.cfg.deepgram.dictationModel, modelVersion: null,
      usageId: entry.usageId, audioMs: Math.round(audioEnd * 1000), billableCharacters: null,
    };
      link.queue.retainTerminalEvidence({ type: 'usage', usage });
      void entry.finish(usage, status, usage.audioMs).catch(() => link.fail(new ProviderFault('STT_UNAVAILABLE')));
    };
    link.onFailure = error => { reportUsage(request.abortSignal.aborted ? 'cancelled' : 'failed'); cancelDeadline?.(); rejectStop?.(error); };
    link.onFinish = () => { reportUsage('closed'); cancelDeadline?.(); resolveStop?.(); };
    const url = providerUrl(this.cfg, '/v1/listen', { model: this.cfg.deepgram.dictationModel,
      tag: this.accounting.tag,
      language: request.locale, encoding: 'linear16', sample_rate: '16000', channels: '1',
      interim_results: 'true', punctuate: 'true', smart_format: 'true', endpointing: String(this.cfg.deepgram.endpointingMs) });
    for (const term of this.cfg.deepgram.keyterms) url.searchParams.append('keyterm', term);
    if (this.cfg.deepgram.spokenPunctuation) url.searchParams.set('dictation', 'true');
    try { await link.start(url); } catch (error) {
      link.fail(error instanceof ProviderFault ? error : new ProviderFault('STT_UNAVAILABLE'));
      await this.accounting.drain(); throw error;
    }
    link.heartbeat('nova');
    return {
      events: link.queue,
      writeAudio: pcm => {
        if (stopping) return Promise.reject(new ProviderFault('VOICE_INVALID_STATE', 'retry_dictation'));
        if (!pcm.byteLength || pcm.byteLength % 2 || pcm.byteLength > 2560)
          return Promise.reject(new ProviderFault('INVALID_AUDIO_FRAME', 'retry_dictation', false));
        return link.send(pcm, this.cfg.limits.inputQueueMs * 32).then(() => { audioEnd += pcm.byteLength / 32000; });
      },
      finalize: () => {
        if (stopPromise) return stopPromise;
        if (!link.active) return Promise.reject(new ProviderFault('VOICE_INVALID_STATE', 'retry_dictation'));
        stopping = true;
        stopPromise = new Promise<void>((resolve, reject) => {
          resolveStop = resolve;
          rejectStop = reject;
          cancelDeadline = link.deadline(Math.min(2000, this.cfg.limits.finalizationMs), () => finish(Boolean(interim) || audioEnd > finalEnd));
          // ws preserves the order of earlier audio sends and this Finalize control.
          void link.json({ type: 'Finalize' }).catch(reject);
        });
        return stopPromise;
      },
      close: async () => { cancelDeadline?.(); link.finish(); resolveStop?.(); await this.accounting.drain(); },
    };
  }
}
