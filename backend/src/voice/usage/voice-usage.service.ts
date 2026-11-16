/**
 * ============================================================================
 * FILE: voice-usage.service.ts
 * LOCATION: backend/src/voice/usage/voice-usage.service.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Process-local attribution, quota enforcement, latency percentiles, and redacted logging.
 *
 * ROLE IN PROJECT:
 *    Implements voice session admission, speech usage aggregation, and drain hooks for P9.
 *
 * KEY COMPONENTS:
 *    - LATENCY_SEGMENTS / LatencySegment: Measured latency pipeline segments
 *    - VoiceUsageService: Admission, usage attribution, quota timers, and metrics snapshot
 *    - percentile: Computes percentile ranking over sorted samples
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import type { CurrentConfigPort, VoiceConfig } from '../../contracts/config-runtime.js';
import type { SpeechUsage } from '../../contracts/voice.js';
import { redactSecrets } from '../../platform/security/redact.js';
import { VOICE_STAGES, VoiceSessionError, type SessionContext, type VoiceObservation } from '../session/voice-session.options.js';
import { VOICE_ERROR_CODES } from '../../contracts/voice-wire.js';

export const LATENCY_SEGMENTS = ['stt', 'turn', 'llm', 'tool', 'tts', 'transport', 'playback'] as const;
export type LatencySegment = typeof LATENCY_SEGMENTS[number];
export type VoiceStopReason = 'duration' | 'idle' | 'quota' | 'shutdown';
export type VoiceWarnCode = 'VOICE_DURATION_LIMIT' | 'VOICE_IDLE_TIMEOUT';
export type VoiceUsageSnapshot = {
  active: number; sessions: number; reconnects: number; failures: number; rejected: number;
  sttAudioMs: number; ttsAudioMs: number; ttsCharacters: number;
  audioComplete: boolean; charactersComplete: boolean;
  promptTokens: number | null; completionTokens: number | null;
  estimatedSpendUsd: number | null; spendStatus: 'known' | 'unknown';
  latency: Record<LatencySegment, { count: number; p50: number | null; p95: number | null }>;
};
export type VoiceUsagePorts = {
  config: VoiceConfig;
  currentConfig?: CurrentConfigPort;
  now: () => number;
  schedule: (ms: number, run: () => void) => () => void;
  stop: (sessionId: string, reason: VoiceStopReason) => Promise<void>;
  warn: (sessionId: string, code: VoiceWarnCode) => void;
  writeLog: (line: string) => void;
  admissionPerMinute: number;
};
type AttemptUsage = { promptTokens: number | null; completionTokens: number | null };
type SttKey = string;
type Recorded = {
  sessionId: string; userId: string; mode: 'dictation' | 'live'; startedAt: number;
  endedAt: number | null; stt: Map<SttKey, number | null>; ttsKeys: Set<string>;
  ttsAudioMs: number; ttsCharacters: number; audioComplete: boolean; charactersComplete: boolean;
  rates: VoiceConfig['rates']; limits: VoiceConfig['limits']; quotas: VoiceConfig['quotas'];
  dictationWarningMs: number | null;
};
type Lease = Recorded & {
  halting: boolean; warnedDuration: boolean; warnedIdle: boolean;
  busy?: boolean;
  stopReason?: VoiceStopReason;
  durationCancels: Array<() => void>; idleCancels: Array<() => void>;
};
const TTS = new Set(['flux-haley-en', 'flux-alexis-en', 'flux-priya-en']);
const hash = (value: string) => `h:${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
const finite = (value: number | null): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

export class VoiceUsageService {
  private accepting = true;
  private degraded = false;
  private failures = 0;
  private rejected = 0;
  private reconnects = 0;
  private readonly active = new Map<string, Lease>();
  private readonly closed: Recorded[] = [];
  private readonly attempts = new Map<string, AttemptUsage>();
  private readonly admissions: number[] = [];
  private readonly latency = Object.fromEntries(LATENCY_SEGMENTS.map(segment => [segment, [] as number[]])) as
    Record<LatencySegment, number[]>;
  // ponytail: one server-resolved development identity bounds this daily map; multi-identity admission needs bounded/durable quota storage, not arbitrary client IDs.
  private archivedDay = '';
  private archived = new Map<string, { ms: number; usd: number; known: boolean }>();

  constructor(private readonly ports: VoiceUsagePorts) {}

  speechStatus() {
    const voice = this.ports.currentConfig
      ? this.ports.currentConfig.current()?.voice ?? null : this.ports.config;
    const enabled = Boolean(voice && (voice.enabledModes.dictation || voice.enabledModes.live));
    return { enabled, configured: !enabled || Boolean(voice?.deepgram.apiKey), degraded: this.degraded };
  }

  degrade() { this.degraded = true; this.failures += 1; this.log({ action: 'speech-degraded' }); }

  snapshot(): VoiceUsageSnapshot {
    const rows = [...this.closed, ...this.active.values()];
    let sttAudioMs = 0; let ttsAudioMs = 0; let ttsCharacters = 0;
    let audioComplete = true; let charactersComplete = true; let spendKnown = true; let spend = 0;
    if (rows.length === 0) {
      const voice = this.ports.currentConfig ? this.ports.currentConfig.current()?.voice ?? null : this.ports.config;
      const rates = voice?.rates;
      spendKnown = Boolean(rates && rates.novaPerMinuteUsd !== null && rates.fluxSttPerMinuteUsd !== null
        && rates.fluxTtsPerThousandCharsUsd !== null);
    }
    for (const row of rows) {
      ttsAudioMs += row.ttsAudioMs; ttsCharacters += row.ttsCharacters;
      audioComplete &&= row.audioComplete; charactersComplete &&= row.charactersComplete;
      for (const [, audioMs] of row.stt) {
        if (audioMs === null) { audioComplete = false; continue; }
        sttAudioMs += audioMs;
      }
      const cost = this.cost(row);
      spend += cost.usd; spendKnown &&= cost.known;
    }
    const attempts = [...this.attempts.values()];
    const tokensComplete = attempts.every(item => item.promptTokens !== null && item.completionTokens !== null);
    const latency = Object.fromEntries(LATENCY_SEGMENTS.map(segment => {
      const sorted = [...this.latency[segment]].sort((a, b) => a - b);
      return [segment, { count: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) }];
    })) as VoiceUsageSnapshot['latency'];
    // Open/paused admissions may still receive provider evidence. Known means a closed observed estimate, never an invoice guarantee.
    spendKnown &&= this.active.size === 0;
    return {
      active: this.active.size, sessions: rows.length, reconnects: this.reconnects,
      failures: this.failures, rejected: this.rejected, sttAudioMs, ttsAudioMs, ttsCharacters,
      audioComplete, charactersComplete,
      promptTokens: attempts.length && tokensComplete ? attempts.reduce((sum, item) => sum + (item.promptTokens ?? 0), 0) : attempts.length ? null : 0,
      completionTokens: attempts.length && tokensComplete ? attempts.reduce((sum, item) => sum + (item.completionTokens ?? 0), 0) : attempts.length ? null : 0,
      estimatedSpendUsd: spendKnown ? spend : null, spendStatus: spendKnown ? 'known' : 'unknown', latency,
    };
  }

  noteLatency(segment: LatencySegment, ms: number) {
    if (!LATENCY_SEGMENTS.includes(segment) || !finite(ms)) return;
    const samples = this.latency[segment];
    samples.push(Math.min(ms, 3_600_000));
    // ponytail: 256-sample ring; p95 is approximate under load. Upgrade path: external reservoir.
    if (samples.length > 256) samples.shift();
  }

  observe(context: SessionContext, event: VoiceObservation) {
    if (!VOICE_STAGES.includes(event.stage)) return;
    if (event.stage === 'flow-error' || event.stage === 'transport-error') {
      const row = this.find(context.response.sessionId);
      if (row) { row.audioComplete = false; row.charactersComplete = false; }
    }
    const segments: Partial<Record<VoiceObservation['stage'], LatencySegment>> = {
      'response-prepared': 'turn', 'model-first-output': 'llm', 'tts-first-audio': 'tts', 'playback-first-ack': 'playback',
    };
    const elapsedMs = typeof event.elapsedMs === 'number' && finite(event.elapsedMs)
      ? Math.min(event.elapsedMs, 3_600_000) : undefined;
    const segment = segments[event.stage];
    if (segment && elapsedMs !== undefined) this.noteLatency(segment, elapsedMs);
    const row = { kind: 'voice-pipeline', at: new Date(this.ports.now()).toISOString(), stage: event.stage,
      clockMs: performance.now(), clockOriginMs: performance.timeOrigin,
      sessionId: hash(context.response.sessionId), connectionEpoch: context.response.connectionEpoch,
      ...(context.response.conversationId ? { conversationId: hash(context.response.conversationId) } : {}),
      ...(event.turnId ? { turnId: hash(event.turnId) } : {}),
      ...(event.responseId ? { responseId: hash(event.responseId) } : {}),
      ...(elapsedMs === undefined ? {} : { elapsedMs }),
      ...(typeof event.queueSamples === 'number' && finite(event.queueSamples)
        ? { queueSamples: Math.min(Math.floor(event.queueSamples), context.response.limits.liveMaxMs * 24) } : {}),
      ...(event.code && VOICE_ERROR_CODES.includes(event.code) ? { code: event.code } : {}),
    };
    try { this.ports.writeLog(JSON.stringify(row)); } catch { /* Observability never changes delivery. */ }
  }

  noteModelUsage(sessionId: string, usage: AttemptUsage & { attemptId: string }) {
    if (!this.find(sessionId)) return;
    this.attempts.set(`${sessionId}:${usage.attemptId}`, {
      promptTokens: finite(usage.promptTokens) ? usage.promptTokens : null,
      completionTokens: finite(usage.completionTokens) ? usage.completionTokens : null,
    });
  }

  noteActivity(sessionId: string, busy?: boolean) {
    const lease = this.active.get(sessionId);
    if (lease && busy !== undefined) lease.busy = busy;
    this.armIdle(lease);
  }

  async admission(context: SessionContext): Promise<{ release: () => Promise<void>; assertActive: () => void }> {
    const mode = context.response.mode;
    const snapshot = this.ports.currentConfig ? this.ports.currentConfig.current() : null;
    if (this.ports.currentConfig && !snapshot) throw new VoiceSessionError('VOICE_DISABLED');
    const voice = snapshot ? snapshot.voice : this.ports.config;
    if (!this.accepting || !voice.enabledModes[mode] || !voice.deepgram.apiKey)
      throw new VoiceSessionError('VOICE_DISABLED');
    const now = this.ports.now();
    this.admissions.splice(0, this.admissions.length, ...this.admissions.filter(at => now - at < 60_000));
    const requestRate = snapshot ? snapshot.budgets.maxRequestsPerMinutePerUser : this.ports.admissionPerMinute;
    if (this.admissions.length >= requestRate) { this.rejected += 1; throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED'); }
    const userId = context.identity.userId;
    const active = [...this.active.values()];
    if (active.length >= voice.quotas.globalConcurrent
      || active.filter(row => row.userId === userId).length >= voice.quotas.identityConcurrent) {
      this.rejected += 1; throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED');
    }
    this.assertBudget(userId, 0, voice.quotas);
    const row = this.blank(context, now);
    const lease: Lease = { ...row, halting: false, warnedDuration: false, warnedIdle: false, durationCancels: [], idleCancels: [] };
    this.active.set(row.sessionId, lease);
    this.admissions.push(now);
    this.armDuration(lease);
    this.armIdle(lease);
    this.log({ action: 'admit', sessionId: row.sessionId, mode });
    return { release: () => this.release(row.sessionId), assertActive: () => this.assertActive(row.sessionId) };
  }

  async usage(context: SessionContext, usage: SpeechUsage): Promise<void> {
    const row = this.find(context.response.sessionId);
    if (!row) return;
    this.noteActivity(context.response.sessionId);
    if (usage.model === 'nova-3' || usage.model === 'flux-general-en') this.applyStt(row, usage);
    else if (TTS.has(usage.model)) this.applyTts(row, usage);
    else { row.audioComplete = false; }
    const cap = row.quotas.dailySpendUsd;
    const spend = this.dailySpend();
    if (cap !== null && spend.usd >= cap)
      this.halt(context.response.sessionId, 'quota');
  }

  async disconnected(context: SessionContext): Promise<void> {
    if (!this.find(context.response.sessionId)) return;
    this.reconnects += 1;
    this.log({ action: 'reconnect', sessionId: context.response.sessionId });
  }

  stopAccepting() { this.accepting = false; }

  async drain(): Promise<{ drained: boolean; active: number }> {
    this.stopAccepting();
    const ids = [...this.active.keys()];
    await Promise.all(ids.map(async id => {
      await this.ports.stop(id, 'shutdown');
      await this.release(id);
    }));
    return { drained: this.active.size === 0, active: this.active.size };
  }

  private blank(context: SessionContext, startedAt: number): Recorded {
    const voice = context.voiceConfig;
    return {
      sessionId: context.response.sessionId, userId: context.identity.userId, mode: context.response.mode,
      startedAt, endedAt: null, stt: new Map(), ttsKeys: new Set(), ttsAudioMs: 0, ttsCharacters: 0,
      audioComplete: true, charactersComplete: true,
      rates: { ...voice.rates }, limits: { ...voice.limits }, quotas: { ...voice.quotas },
      dictationWarningMs: voice.dictationWarningMs,
    };
  }

  private cost(row: Recorded): { usd: number; known: boolean } {
    const rates = row.rates;
    let usd = 0;
    let known = row.audioComplete && rates.novaPerMinuteUsd !== null && rates.fluxSttPerMinuteUsd !== null
      && rates.fluxTtsPerThousandCharsUsd !== null;
    for (const [key, audioMs] of row.stt) {
      const rate = key.endsWith('|nova-3') ? rates.novaPerMinuteUsd : rates.fluxSttPerMinuteUsd;
      if (audioMs === null || rate === null) known = false;
      else usd += audioMs / 60_000 * rate;
    }
    if (!row.charactersComplete || rates.fluxTtsPerThousandCharsUsd === null) known = false;
    else usd += row.ttsCharacters / 1000 * rates.fluxTtsPerThousandCharsUsd;
    return { usd, known };
  }

  private find(sessionId: string): Recorded | undefined {
    return this.active.get(sessionId) ?? this.closed.find(row => row.sessionId === sessionId);
  }

  private applyStt(row: Recorded, usage: SpeechUsage) {
    const key = `${usage.usageId ?? usage.providerRequestId ?? 'socket'}|${usage.model}`;
    if (!finite(usage.audioMs)) { row.stt.set(key, row.stt.get(key) ?? null); row.audioComplete = false; return; }
    const previous = row.stt.get(key);
    if (previous !== undefined && previous !== null && usage.audioMs < previous) return;
    row.stt.set(key, usage.audioMs);
  }

  private applyTts(row: Recorded, usage: SpeechUsage) {
    if (!finite(usage.billableCharacters)) { row.charactersComplete = false; return; }
    const key = usage.usageId ?? `${usage.providerRequestId ?? 'socket'}|${usage.model}|${usage.audioMs}|${usage.billableCharacters}`;
    if (row.ttsKeys.has(key)) return;
    row.ttsKeys.add(key);
    row.ttsCharacters += usage.billableCharacters;
    if (finite(usage.audioMs)) row.ttsAudioMs += usage.audioMs; else row.audioComplete = false;
  }

  private elapsed(row: Recorded, now = this.ports.now()) {
    return Math.max(0, (row.endedAt ?? now) - row.startedAt);
  }

  private day() {
    const day = new Date(this.ports.now()).toISOString().slice(0, 10);
    if (day !== this.archivedDay) { this.archivedDay = day; this.archived.clear(); }
    return day;
  }

  private archive(row: Recorded) {
    if (new Date(row.startedAt).toISOString().slice(0, 10) !== this.day()) return;
    const previous = this.archived.get(row.userId) ?? { ms: 0, usd: 0, known: true };
    const cost = this.cost(row);
    this.archived.set(row.userId, {
      ms: previous.ms + this.elapsed(row), usd: previous.usd + cost.usd,
      known: previous.known && cost.known,
    });
  }

  private dailySpend(): { usd: number; known: boolean } {
    const day = this.day();
    let usd = 0; let known = true;
    for (const aggregate of this.archived.values()) { usd += aggregate.usd; known &&= aggregate.known; }
    for (const row of [...this.closed, ...this.active.values()]) {
      if (new Date(row.startedAt).toISOString().slice(0, 10) !== day) continue;
      const cost = this.cost(row); usd += cost.usd; known &&= cost.known;
    }
    return { usd, known };
  }

  private consumed(userId?: string) {
    const day = this.day();
    const now = this.ports.now();
    let sum = 0;
    for (const [id, aggregate] of this.archived) {
      if (userId === undefined || id === userId) sum += aggregate.ms;
    }
    return sum + [...this.closed, ...this.active.values()]
      .filter(row => userId === undefined || row.userId === userId)
      .filter(row => new Date(row.startedAt).toISOString().slice(0, 10) === day)
      .reduce((total, row) => total + this.elapsed(row, now), 0);
  }

  private assertActive(sessionId: string) {
    const lease = this.active.get(sessionId);
    if (!lease) throw new VoiceSessionError('VOICE_SESSION_ENDED', 'none');
    if (lease.halting) throw new VoiceSessionError(
      lease.stopReason === 'duration' ? 'VOICE_DURATION_LIMIT' :
      lease.stopReason === 'shutdown' ? 'VOICE_DISABLED' : 'VOICE_QUOTA_EXHAUSTED', 'none');
    const cap = lease.mode === 'live' ? lease.limits.liveMaxMs : lease.limits.dictationMaxMs;
    if (this.elapsed(lease) >= cap) throw new VoiceSessionError('VOICE_DURATION_LIMIT', 'none');
    this.assertBudget(lease.userId, 0, lease.quotas);
  }

  private assertBudget(userId: string, additionalMs: number, quotas: VoiceConfig['quotas']) {
    if (this.consumed(userId) + additionalMs >= quotas.identityDailyMinutes * 60_000
      || this.consumed() + additionalMs >= quotas.globalDailyMinutes * 60_000) {
      this.rejected += 1; throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED');
    }
    const spend = this.dailySpend();
    if (quotas.dailySpendUsd !== null && spend.usd >= quotas.dailySpendUsd) {
      this.rejected += 1; throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED');
    }
  }

  private clear(list: Array<() => void>) { for (const cancel of list.splice(0)) cancel(); }

  private armDuration(lease: Lease) {
    this.clear(lease.durationCancels);
    const limits = lease.limits;
    const modeCap = lease.mode === 'dictation' ? limits.dictationMaxMs : limits.liveMaxMs;
    const identityLeft = lease.quotas.identityDailyMinutes * 60_000 - this.consumed(lease.userId);
    const globalLeft = lease.quotas.globalDailyMinutes * 60_000 - this.consumed();
    const hard = Math.min(modeCap, identityLeft, globalLeft);
    if (hard <= 0) { this.active.delete(lease.sessionId); this.rejected += 1; throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED'); }
    const warningAt = lease.mode === 'live' ? limits.liveWarningMs : lease.dictationWarningMs;
    if (warningAt !== null && warningAt > 0 && warningAt < hard) lease.durationCancels.push(this.ports.schedule(warningAt, () => {
      if (lease.endedAt !== null || lease.warnedDuration || lease.halting) return;
      lease.warnedDuration = true;
      this.ports.warn(lease.sessionId, 'VOICE_DURATION_LIMIT');
      this.log({ action: 'warn', sessionId: lease.sessionId, code: 'VOICE_DURATION_LIMIT' });
    }));
    lease.durationCancels.push(this.ports.schedule(hard, () => {
      this.halt(lease.sessionId, hard < modeCap ? 'quota' : 'duration');
    }));
  }

  private armIdle(lease: Lease | undefined) {
    if (!lease || lease.mode !== 'live' || lease.endedAt !== null || lease.halting) return;
    this.clear(lease.idleCancels);
    lease.warnedIdle = false;
    if (lease.busy) return;
    const limits = lease.limits;
    lease.idleCancels.push(this.ports.schedule(limits.idleWarningMs, () => {
      if (lease.endedAt !== null || lease.halting || lease.warnedIdle) return;
      lease.warnedIdle = true;
      this.ports.warn(lease.sessionId, 'VOICE_IDLE_TIMEOUT');
      this.log({ action: 'warn', sessionId: lease.sessionId, code: 'VOICE_IDLE_TIMEOUT' });
    }));
  }

  private halt(sessionId: string, reason: VoiceStopReason) {
    const lease = this.active.get(sessionId);
    if (!lease || lease.halting) return;
    lease.halting = true;
    lease.stopReason = reason;
    lease.endedAt = this.ports.now();
    this.clear(lease.durationCancels);
    this.clear(lease.idleCancels);
    const code = reason === 'duration' ? 'VOICE_DURATION_LIMIT'
      : reason === 'idle' ? 'VOICE_IDLE_TIMEOUT'
      : reason === 'quota' ? 'VOICE_QUOTA_EXHAUSTED' : undefined;
    this.log({ action: 'stop', sessionId, reason, code });
    void this.ports.stop(sessionId, reason).catch(() => undefined);
  }

  private async release(sessionId: string): Promise<void> {
    const lease = this.active.get(sessionId);
    if (!lease) return;
    lease.endedAt ??= this.ports.now();
    this.clear(lease.durationCancels);
    this.clear(lease.idleCancels);
    this.active.delete(sessionId);
    this.closed.push(lease);
    if (this.closed.length > 256) {
      const evicted = this.closed.shift();
      if (evicted) this.archive(evicted);
    }
  }

  private log(fields: { action: string; sessionId?: string; mode?: string; reason?: string; code?: string }) {
    const record: Record<string, unknown> = {
      kind: 'voice-usage', at: new Date(this.ports.now()).toISOString(), action: fields.action,
    };
    if (fields.sessionId) record.sessionId = hash(fields.sessionId);
    if (fields.mode === 'dictation' || fields.mode === 'live') record.mode = fields.mode;
    if (fields.reason) record.reason = fields.reason;
    if (fields.code) record.code = fields.code;
    try { this.ports.writeLog(JSON.stringify(redactSecrets(record))); } catch { /* metric only; no throw */ }
  }
}
