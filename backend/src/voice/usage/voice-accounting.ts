/**
 * ============================================================================
 * FILE: voice-accounting.ts
 * LOCATION: backend/src/voice/usage/voice-accounting.ts
 * ============================================================================
 * PURPOSE:
 *    Persist voice admission and terminal evidence independently of event queues.
 * ROLE IN PROJECT:
 *    Binds trusted server identity to Deepgram tags and Mongo accounting.
 *    Keeps provider callbacks independent of transcript/delivery consumers.
 * KEY COMPONENTS:
 *    - VoiceAccounting: Session-bound ledger with socket admission and tracked response writes.
 *    - SpeechAccountingEntry: One idempotent terminal write per socket or response.
 * ============================================================================
 */
import { createHash } from 'node:crypto';
import type { SpeechUsage } from '../../contracts/voice.js';
import { idSchema } from '../../contracts/identifiers.js';
import type { VoiceAccountingRecord } from '../../contracts/voice-accounting.js';
import type { VoiceConfig } from '../../platform/config/voice-config.js';
import { key } from '../../persistence/records.js';
import { characterEstimate, decimalFromNumber, unavailableMoney } from '../../contracts/usage-evidence.js';

type Terminal = Exclude<VoiceAccountingRecord['status'], 'pending'>;
export type SpeechAccountingEntry = {
  usageId: string;
  admitted?: Promise<void>;
  finish(usage: SpeechUsage, status: Terminal, observedAudioMs?: number): Promise<void>;
};
export class VoiceAccounting {
  readonly tag: string;
  private readonly rates: VoiceConfig['rates'];
  private readonly pending = new Set<Promise<void>>();
  private failure: unknown;
  constructor(private readonly ports: {
    userId: string; voiceSessionId: string; conversationId: () => string | null;
    config: VoiceConfig; write: (record: VoiceAccountingRecord) => Promise<void>;
  }) {
    idSchema.parse(ports.userId); idSchema.parse(ports.voiceSessionId);
    this.rates = Object.freeze({ ...ports.config.rates });
    this.tag = `aurvin-user-${createHash('sha256').update(`aurvin:deepgram:user:v1:${ports.userId}`).digest('hex')}`;
  }
  private track(write: Promise<void>): Promise<void> {
    this.pending.add(write);
    void write.then(() => this.pending.delete(write), error => {
      this.pending.delete(write); this.failure ??= error;
    });
    return write;
  }
  async start(providerSocketId: string, model: string,
    ref?: { turnId: string; responseId: string }): Promise<SpeechAccountingEntry> {
    if (this.failure) throw this.failure;
    const record: VoiceAccountingRecord = {
      schemaVersion: 1, kind: 'voice-accounting', provider: 'deepgram',
      userId: this.ports.userId, sessionId: this.ports.voiceSessionId, voiceSessionId: this.ports.voiceSessionId,
      conversationId: this.ports.conversationId(), userTag: this.tag, model, providerSocketId,
      usageId: ref ? key('voice-speech', providerSocketId, ref.turnId, ref.responseId) : providerSocketId,
      turnId: ref?.turnId ?? null, responseId: ref?.responseId ?? null,
      speechId: null, providerRequestId: null, modelVersion: null, status: 'pending',
      observedAudioMs: null, audioMs: null, billableCharacters: null,
      estimatedCostUsd: null, actualCostUsd: null, startedAt: new Date().toISOString(), endedAt: null,
      money: unavailableMoney(true),
    };
    const admitted = this.track(this.ports.write(record));
    // Socket-level admission stays synchronous before opening provider sockets; per-response speech accounting is pipelined so Speak is not blocked.
    if (!ref) await admitted;
    let terminal: Promise<void> | undefined;
    return { usageId: record.usageId, admitted, finish: (usage, status, observedAudioMs) => {
      const rate = this.rates.fluxTtsPerThousandCharsUsd;
      const endedAt = new Date().toISOString();
      const estimatedAmount = ref && rate !== null && usage.billableCharacters !== null
        ? characterEstimate(usage.billableCharacters, decimalFromNumber(rate)) : null;
      terminal ??= this.track(admitted.then(() => this.ports.write({ ...record, status,
        providerRequestId: usage.providerRequestId, modelVersion: usage.modelVersion,
        speechId: usage.speechId ?? null, observedAudioMs: observedAudioMs ?? null,
        // STT adapters measure submitted input, not provider-billed duration.
        audioMs: ref ? usage.audioMs : null, billableCharacters: ref ? usage.billableCharacters : null,
        estimatedCostUsd: estimatedAmount === null ? null : Number(estimatedAmount),
        money: estimatedAmount === null ? unavailableMoney() : { ...unavailableMoney(), estimatedAmount,
          source: 'provider-estimate', observedAt: endedAt, pricing: { version: 'voice-rate-snapshot-v1',
            source: 'operator-configured', unit: 'characters', units: usage.billableCharacters!, unitSize: 1000,
            rateUsd: decimalFromNumber(rate!) } },
        endedAt,
      })));
      return terminal;
    } };
  }
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.allSettled(this.pending);
    if (this.failure) throw this.failure;
  }
}
