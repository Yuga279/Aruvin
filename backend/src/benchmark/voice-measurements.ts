/**
 * ============================================================================
 * FILE: voice-measurements.ts
 * LOCATION: backend/src/benchmark/voice-measurements.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Gate decoded WebRTC onset and summarize per-metric voice samples.
 *
 * ROLE IN PROJECT:
 *    Pure benchmark measurement code; no SDK, network, storage or application
 *    wiring. Reuses the existing nearest-rank summarizer.
 *
 * KEY COMPONENTS:
 *    - DecodedReceipt: monotonic decoded-nonzero-after-start gate.
 *    - summarizeVoiceMetric: missing/failed rows retained, warmups excluded.
 *    - voiceProvenanceSchema / projectVoiceProvenance: strict export allowlist.
 * ============================================================================
 */
import { z } from 'zod';
import { isCompactJwt } from '../contracts/voice-wire.js';
import { summarize } from './report.js';

export class DecodedReceipt {
  private last: number;
  private ref: string | null = null;
  private speechEnd: number | null = null;
  private first: number | null = null;
  private samples = 0;
  private before = 0;
  constructor(private readonly started: number,
    private readonly now: () => number = () => performance.now()) {
    if (!Number.isFinite(started) || started < 0) throw new Error('BENCHMARK_MEDIA_FAILED');
    this.last = started;
  }
  private clock() {
    const n = this.now();
    if (!Number.isFinite(n) || n < this.last) throw new Error('BENCHMARK_MEDIA_FAILED');
    this.last = n;
    return n;
  }
  inputStarted(at: number, marker: number) {
    if (this.speechEnd !== null || !Number.isFinite(at) || at < this.started ||
      !Number.isFinite(marker) || marker <= 0) throw new Error('BENCHMARK_MEDIA_FAILED');
    this.speechEnd = at + marker;
  }
  start(turnId: string, responseId: string) {
    this.clock();
    if (this.ref || !turnId || !responseId) throw new Error('BENCHMARK_MEDIA_FAILED');
    this.ref = `${turnId}:${responseId}`;
  }
  frame(data: Int16Array, rate: number, channels: number) {
    const at = this.clock();
    if (rate !== 24000 || channels !== 1 || !data.length || data.length > 4800)
      throw new Error('BENCHMARK_MEDIA_FAILED');
    if (!this.ref) { this.before++; return; }
    this.samples += data.length;
    if (this.samples > 24000 * 180) throw new Error('BENCHMARK_MEDIA_FAILED');
    if (this.first === null && data.some(sample => sample !== 0)) {
      if (this.speechEnd === null || at < this.speechEnd) throw new Error('BENCHMARK_MEDIA_FAILED');
      this.first = at;
    }
  }
  snapshot() {
    return { firstAudioMs: this.first === null ? null : this.first - this.started,
      speechEndToFirstAudioMs: this.first === null || this.speechEnd === null ? null : this.first - this.speechEnd,
      decodedSamples: this.samples, preStartFrames: this.before };
  }
}

export function summarizeVoiceMetric(rows: ReadonlyArray<{ warmup?: boolean; outcome: string;
  [key: string]: unknown }>, metric: string) {
  return summarize(rows.map(row => {
    const value = row[metric];
    const valid = typeof value === 'number' && Number.isFinite(value) && value >= 0;
    return { scenario: metric, warmup: row.warmup === true,
      outcome: row.outcome === 'success' && valid ? 'success' : 'unverified',
      durationMs: valid ? value : 0 };
  }))[0] ?? { scenario: metric, samples: 0, succeeded: 0, failed: 0, p50Ms: null, p95Ms: null };
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const isToken = (value: string): boolean => isCompactJwt(value);
const label = z.string().regex(/^[A-Za-z0-9/_.:-]{1,128}$/)
  .refine(value => !isToken(value) && !value.startsWith('sk-') && !value.startsWith('Bearer'));
const nullablePositive = z.number().finite().positive().max(1000).nullable();
export const voiceProvenanceSchema = z.object({
  authorizationReference: label,
  sourceHash: sha256, buildHash: sha256, configurationHash: sha256,
  instructionHash: sha256, productKnowledgeHash: sha256,
  inputSha256: sha256, inputBytes: z.number().int().positive().max(65000 * 32),
  speechEndMs: z.number().finite().positive().max(60000),
  scenario: z.literal('voice-baseline'), freshConversation: z.literal(true),
  inputSampleRateHz: z.literal(16000), inputChannels: z.literal(1), inputFrameMs: z.literal(80),
  decodedSampleRateHz: z.literal(24000), decodedChannels: z.literal(1),
  codec: z.enum(['pcm16', 'opus']), rtpClockHz: z.literal(48000).nullable(),
  requestedPacketMs: nullablePositive, observedPacketMs: nullablePositive,
  resampling: z.enum(['none', 'rtc-native-16k-to-opus-and-opus-to-24k']),
  clientPlacement: label, backendPlacement: label, sfuPlacement: label,
  databasePlacement: label, providerRegion: label,
  rtcNodeVersion: label.nullable(), ffiVersion: label.nullable(),
  modelLabel: label, routingLabel: label, sttModel: label, ttsModel: label,
  endpointingHash: sha256, limitsHash: sha256,
  impairment: z.enum(['none', 'fixed-delay-jitter-loss-v1']),
  playbackBoundary: z.enum(['ws-simulated-24k-v1', 'unproven']),
}).strict();

export type VoiceProvenance = z.infer<typeof voiceProvenanceSchema>;

export function projectVoiceProvenance(raw: unknown): VoiceProvenance {
  const parsed = voiceProvenanceSchema.safeParse(raw);
  if (!parsed.success) throw new Error('BENCHMARK_PROVENANCE_INVALID');
  return parsed.data;
}
