/**
 * ============================================================================
 * FILE: flux-stt.ts
 * LOCATION: backend/src/voice/providers/flux-stt.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deepgram Flux conversational speech-to-text adapter for live voice mode.
 *
 * ROLE IN PROJECT:
 *    Implements SpeechToTextPort for live conversation, enforcing 80ms PCM16
 *    input frames, mapping TurnInfo messages to SttEvents, and handling turn lifecycle.
 *
 * KEY COMPONENTS:
 *    - FluxSttAdapter: SpeechToTextPort implementation for Flux live recognition
 *    - turnSchema: Validation schema for Deepgram TurnInfo protocol messages
 *    - ForceEndTurn and CloseStream protocol methods
 * ============================================================================
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { VoiceAccounting } from '../usage/voice-accounting.js';
import type { SpeechToTextPort, SpeechInputConnection, SttConnectRequest, SttEvent } from '../../contracts/voice.js';
import { INPUT_AUDIO } from '../../contracts/voice-wire.js';
import type { VoiceConfig } from '../../platform/config/voice-config.js';
import { ProviderLink, ProviderFault, providerUrl, providerText, providerId, uint, sameAudio, socketFactory, type SocketFactory } from './provider-link.js';

const turnSchema = z.object({ type: z.literal('TurnInfo'), request_id: providerId,
  sequence_id: uint, turn_index: uint, event: z.string().max(64), transcript: providerText,
  audio_window_end: z.number().finite().nonnegative() });
export class FluxSttAdapter implements SpeechToTextPort {
  constructor(private readonly cfg: VoiceConfig, private readonly factory: SocketFactory = socketFactory,
    private readonly accounting: VoiceAccounting) {}
  async connect(request: SttConnectRequest): Promise<SpeechInputConnection> {
    if (request.mode !== 'live' || request.locale !== 'en-US' || !sameAudio(request.audio, INPUT_AUDIO))
      throw new ProviderFault('INVALID_VOICE_REQUEST', 'repeat_turn', false);
    const entry = await this.accounting.start(randomUUID(), this.cfg.deepgram.liveModel);
    let sequence = -1; let endedTurn = -1; let startedTurn = -1; let closing = false;
    let inputMs = 0; let providerRequestId: string | null = null; let modelVersion: string | null = null;
    let settledInputMs = -1;
    let finalization: Promise<void> | undefined;
    let resolveFinalization: (() => void) | undefined;
    let rejectFinalization: ((error: ProviderFault) => void) | undefined;
    const settleFinalization = () => {
      settledInputMs = inputMs;
      const resolve = resolveFinalization;
      if (!resolve) return;
      resolveFinalization = undefined;
      rejectFinalization = undefined;
      link.emit({ type: 'finalized', unfinalizedTail: false });
      resolve();
    };
    const failFinalization = (error: ProviderFault) => {
      const reject = rejectFinalization;
      resolveFinalization = undefined;
      rejectFinalization = undefined;
      reject?.(error);
    };
    const link = new ProviderLink<SttEvent>(this.cfg, request.abortSignal, 'STT_UNAVAILABLE', 'repeat_turn',
      131072, e => e.type === 'partial' || e.type === 'final' || e.type === 'end-of-turn' ? Buffer.byteLength(e.text) : 0,
      fault => ({ type: 'error', fault }), message => {
        if (message instanceof Uint8Array) throw new Error('Unexpected STT audio');
        if (message.sequence_id !== undefined) {
          const next = uint.parse(message.sequence_id); if (next <= sequence) return; sequence = next;
        }
        if (message.type === 'Connected') {
          providerRequestId = providerId.parse(message.request_id);
          if (message.model_version !== undefined) modelVersion = providerId.parse(message.model_version);
        }
        if (message.type === 'Warning' && message.code === 'FORCE_END_TURN_NO_ACTIVE_TURN') {
          settleFinalization();
          return;
        }
        if (message.type !== 'TurnInfo' || closing) return;
        const r = turnSchema.parse(message);
        if (r.turn_index <= endedTurn) return;
        const providerTurnId = `${r.request_id}:${r.turn_index}`;
        if (r.event === 'StartOfTurn' && r.turn_index > startedTurn) {
          startedTurn = r.turn_index; link.emit({ type: 'start-of-turn', providerTurnId });
        } else if (r.event === 'Update') {
          link.emit({ type: 'partial', segmentId: providerTurnId, text: r.transcript });
        } else if (r.event === 'EndOfTurn') {
          endedTurn = r.turn_index;
          if (r.transcript.trim()) link.emit({ type: 'end-of-turn', providerTurnId, text: r.transcript });
          settleFinalization();
        }
        // EagerEndOfTurn and TurnResumed never authorize execution in this baseline.
      }, this.factory);
    const reportUsage = (status: 'closed' | 'failed' | 'cancelled') => { const usage = {
      providerRequestId, model: this.cfg.deepgram.liveModel, modelVersion,
      usageId: entry.usageId, audioMs: inputMs, billableCharacters: null,
    };
      link.queue.retainTerminalEvidence({ type: 'usage', usage });
      void entry.finish(usage, status, inputMs).catch(() => link.fail(new ProviderFault('STT_UNAVAILABLE')));
    };
    link.onFailure = error => {
      failFinalization(error);
      reportUsage(request.abortSignal.aborted ? 'cancelled' : 'failed');
    };
    link.onFinish = () => {
      failFinalization(new ProviderFault('STT_UNAVAILABLE', 'resume_call'));
      reportUsage('closed');
    };
    try { await link.start(providerUrl(this.cfg, '/v2/listen', { model: this.cfg.deepgram.liveModel,
      tag: this.accounting.tag,
      encoding: 'linear16', sample_rate: '16000', eot_threshold: String(this.cfg.deepgram.eotThreshold),
      eot_timeout_ms: String(this.cfg.deepgram.eotTimeoutMs) }), true); } catch (error) {
      link.fail(error instanceof ProviderFault ? error : new ProviderFault('STT_UNAVAILABLE'));
      await this.accounting.drain(); throw error;
    }
    link.heartbeat('ping');
    return { events: link.queue,
      writeAudio: pcm => {
        if (closing || pcm.byteLength !== 2560)
          return Promise.reject(new ProviderFault('INVALID_AUDIO_FRAME', 'repeat_turn', false));
        if (resolveFinalization)
          return Promise.reject(new ProviderFault('VOICE_INVALID_STATE', 'resume_call'));
        return link.send(pcm, this.cfg.limits.inputQueueMs * 32).then(() => {
          inputMs += 80;
          finalization = undefined;
        });
      },
      finalize: () => {
        if (finalization) return finalization;
        if (!link.active || closing)
          return Promise.reject(new ProviderFault('STT_UNAVAILABLE', 'resume_call'));
        if (settledInputMs === inputMs) return Promise.resolve();
        finalization = new Promise<void>((resolve, reject) => {
          resolveFinalization = resolve;
          rejectFinalization = reject;
        });
        void link.json({ type: 'ForceEndTurn' }).catch(error => {
          failFinalization(error instanceof ProviderFault ? error : new ProviderFault('STT_UNAVAILABLE', 'resume_call'));
        });
        return finalization;
      },
      close: async () => {
        try { if (link.active && !closing) { closing = true;
          try { await link.json({ type: 'CloseStream' }); } finally { link.finish(); }
        } } finally { await this.accounting.drain(); }
      },
    };
  }
}
