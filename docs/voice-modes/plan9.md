# Voice Quotas, Usage, Readiness, and Runbooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce server-side voice quotas, idle and duration stops, and redacted usage attribution, and report speech health without paid probes or taking text chat down.

**Architecture:** One process-local `VoiceUsageService` implements the P5 `admission` / `usage` / `disconnected` hooks. It tracks mode, wall duration, audio, characters, tokens, and latency reservoirs, and calls injected `warn` / `stop` ports when a cap fires. Operations readiness gains a separate speech field and a bounded voice drain that runs before persistence close. P10 wires the ports; this plan does not edit session, agent, or composition files.

**Tech Stack:** TypeScript NodeNext, existing NestJS operations types, Vitest, NGINX staging assets. No new dependency.

---

## Execution boundaries and facts checked

- Read [goal.md](goal.md), [research.md](research.md), and [state.md](state.md). Review is **skipped**, not passed. Do not write `review.md` or mark review passed.
- Authentication, tenants, live tools, public deployment, and infrastructure provisioning are out of scope. Accounting is the shared server identity, not per-browser billing.
- P5 is complete and must not be edited. It already calls `options.admission(context)`, `options.usage(context, usage)`, and `options.disconnected(context)`. It exposes `stopAccepting()`, `snapshot()`, and `drain()`. It does **not** pass a `VoiceSink` to P9, and `VoiceConnection.finish` only accepts `'completed' | 'cancelled' | 'error'`. `session.warning` is an exact object `{ code, recovery, recoverable }` whose `code` must be a `VoiceErrorCode` (`VOICE_DURATION_LIMIT`, `VOICE_IDLE_TIMEOUT`, `VOICE_QUOTA_EXHAUSTED`). Do not invent `DURATION_LIMIT`, `IDLE_TIMEOUT`, `message`, or `timeRemainingMs`.
- `SpeechUsage` is `{ providerRequestId, model, modelVersion, audioMs, billableCharacters }`. Nova and Flux STT emit one cumulative `audioMs` snapshot per socket. Flux TTS reuses the socket `providerRequestId` across speeches and emits per-utterance characters. Deduping only on `providerRequestId` drops later TTS. Deduping a cumulative STT snapshot by adding it twice over-counts.
- Missing rates stay unknown. Never store that case as `$0`. `loadVoiceConfig` already rejects a spend cap when any rate is null, so a spend cap implies all three rates exist.
- Daily minute quotas are wall-clock session time, not audio time. A silent session still consumes the operator minute cap. Audio milliseconds are for attribution and spend only.
- Idle policy is live-only. Dictation pauses must not end the recording (D4). Live idle is 60s warning then 30s hard stop (V10). Defaults: dictation 300000 ms, live 1200000 ms, live warning 1080000 ms.
- Text readiness already refuses paid health calls. Speech failure must not call `runtime.stopAccepting`, must not set `process.exitCode`, and must not flip `acceptReady` or the text `provider` circuit. `/api/operations/live` stays process reachability only.
- `AurvinConfig.voice` is already optional on the operations config. Reuse `backend/test/operations/fixtures.ts`. Do not build a fake config with `as any`.
- Do not add voice names to `METRICS`. Those cells are the text-chat contract. Voice aggregates ride `metrics().voice` only when a snapshot port is injected.
- HEAD `dadd5c7` implemented the previous plan's usage service. That code treats unknown rates as zero and collapses every later speech that shares a provider request id. Replace it. The worktree may already show those files deleted. Do not stage unrelated deletions or user edits. Stage only the paths named in each commit.
- Add the repository file header when saving each code file. Headers are omitted from the snippets below.
- No paid Deepgram call, no `npm install`, no flag enablement, no Azure or public rollout.

## File map

| Exact path | Responsibility |
| --- | --- |
| `backend/src/voice/usage/voice-usage.service.ts` | Attribution, quota clock, redacted log, aggregate snapshot |
| `backend/src/voice/usage/index.ts` | Public export |
| `backend/test/voice/usage/fixtures.ts` | Fake clock, valid session context, service harness |
| `backend/test/voice/usage/attribution.spec.ts` | Idempotent usage, unknown spend, tokens, percentiles, redaction |
| `backend/test/voice/usage/quota.spec.ts` | Duration, idle, daily minutes, spend, concurrency, rate limit |
| `backend/test/voice/usage/operations.spec.ts` | Composed readiness, degradation, and drain |
| `backend/src/operations/options.ts` | Optional speech-degraded, voice-drain, and snapshot ports |
| `backend/src/operations/readiness.ts` | Separate speech status, no text-chat coupling, no fetch |
| `backend/src/operations/operations.service.ts` | Voice drain before persistence close; optional voice metrics |
| `backend/test/operations/voice-readiness.spec.ts` | Speech field and no-restart degradation |
| `backend/test/operations/voice-shutdown.spec.ts` | Drain barrier |
| `deployment/staging/nginx.conf` | Exact `/api/voice` WebSocket location |
| `deployment/staging/README.md` | Proxy note only |
| `docs/voice-modes/operations.md` | Runbook policy, not measured evidence |

Do not modify `backend/src/voice/session/**`, `backend/src/voice/agent/**`, `backend/src/voice/providers/**`, `backend/src/contracts/**`, `backend/src/platform/**`, `backend/src/operations/telemetry.ts`, or P10 composition files.

## Shared types (Task 1 introduces them; later tasks must use these names)

```typescript
export const LATENCY_SEGMENTS = ['stt', 'turn', 'llm', 'tool', 'tts', 'transport', 'playback'] as const;
export type LatencySegment = typeof LATENCY_SEGMENTS[number];
export type VoiceStopReason = 'duration' | 'idle' | 'quota' | 'shutdown';
export type VoiceWarnCode = 'VOICE_DURATION_LIMIT' | 'VOICE_IDLE_TIMEOUT';
export type VoiceUsageSnapshot = {
  active: number;
  sessions: number;
  reconnects: number;
  failures: number;
  rejected: number;
  sttAudioMs: number;
  ttsAudioMs: number;
  ttsCharacters: number;
  audioComplete: boolean;
  charactersComplete: boolean;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedSpendUsd: number | null;
  spendStatus: 'known' | 'unknown';
  latency: Record<LatencySegment, { count: number; p50: number | null; p95: number | null }>;
};
export type VoiceUsagePorts = {
  config: VoiceConfig;
  now: () => number;
  schedule: (ms: number, run: () => void) => () => void;
  stop: (sessionId: string, reason: VoiceStopReason) => Promise<void>;
  warn: (sessionId: string, code: VoiceWarnCode) => void;
  writeLog: (line: string) => void;
  admissionPerMinute: number;
};
```

`turn` means turn detection. `tool` stays in the snapshot so the shape is stable; this workflow never records tool timings. Empty latency is `null`, not `0`.

P10 wiring, after this plan, is:

```typescript
const voiceUsage = new VoiceUsageService({
  config, now: Date.now, admissionPerMinute: config.budgets.maxRequestsPerMinutePerUser,
  schedule: (ms, run) => { const timer = setTimeout(run, ms); timer.unref?.(); return () => clearTimeout(timer); },
  stop: sessionId => sessions.end(sessionId),
  warn: () => undefined,
  writeLog: line => { /* existing telemetry sink; line is already redacted */ },
});
// VoiceSessionOptions:
admission: context => voiceUsage.admission(context),
usage: (context, usage) => voiceUsage.usage(context, usage),
disconnected: context => voiceUsage.disconnected(context),
// OperationsOptions:
speechDegraded: () => voiceUsage.speechStatus().degraded,
drainVoice: () => voiceUsage.drain(),
voiceSnapshot: () => voiceUsage.snapshot(),
```

P10 must call `voiceUsage.degrade()` for a speech-provider failure and must not call `readiness.providerFailure` for that failure. P10 calls `noteActivity`, `noteLatency`, and `noteModelUsage` when it has those signals. Until the P5 follow-up below exists, live idle can false-fire during a long utterance that has not yet emitted usage. Do not enable the live flag in a deployment until that follow-up is committed. Dictation duration and daily quota do not depend on it.

### P5 follow-up (do not implement in this plan)

Request a serialized P5 change. Do not edit P5 files from the P9 worker.

1. Add optional `activity?(sessionId: string): void` to `VoiceSessionOptions`.
2. Call it from `VoiceConnection` after an accepted binary input frame, accepted control, or accepted `playback.progress`, and from dictation/live flows when a non-error provider event arrives.
3. Extend connection finish so a policy stop can emit exact wire events before `sessions.end`: warning `{ type: 'session.warning', code, recovery: 'none', recoverable: true }` and `session.ended` reason `'duration' | 'idle' | 'shutdown'`. Today's `finish` cannot express those reasons; a socket close alone is not the warning.

Until that lands, P9 still stops the session through the `stop` port. P10 implements `stop` as `sessions.end(sessionId)`. The client sees cleanup, not a validated warning frame. The runbook must say that.

---

### Task 1: Voice usage service and metrics attribution

**Files:**
- Create: `backend/src/voice/usage/voice-usage.service.ts`
- Create: `backend/src/voice/usage/index.ts`
- Create: `backend/test/voice/usage/fixtures.ts`
- Create: `backend/test/voice/usage/attribution.spec.ts`
- Replace, if present: `backend/src/voice/usage/voice-usage.types.ts` and `backend/test/voice/usage/voice-usage.spec.ts` (delete those two paths in the Task 1 commit; their API is retired)

- [ ] **Step 1: Write the failing attribution test**

`backend/test/voice/usage/fixtures.ts`:

```typescript
import { INPUT_AUDIO, OUTPUT_AUDIO } from '../../../src/contracts/voice-wire.js';
import { loadVoiceConfig, type VoiceConfig } from '../../../src/platform/config/voice-config.js';
import type { SessionContext } from '../../../src/voice/session/voice-session.options.js';
import { VoiceUsageService, type VoiceUsagePorts } from '../../../src/voice/usage/voice-usage.service.js';

export function clock() {
  let now = Date.parse('2026-10-08T12:00:00.000Z');
  const jobs: { at: number; fn: () => void }[] = [];
  return {
    now: () => now,
    schedule(ms: number, fn: () => void) {
      const job = { at: now + ms, fn };
      jobs.push(job);
      return () => { const i = jobs.indexOf(job); if (i >= 0) jobs.splice(i, 1); };
    },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const next = jobs.filter(job => job.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        jobs.splice(jobs.indexOf(next), 1);
        now = next.at;
        next.fn();
      }
      now = target;
    },
  };
}

export function context(config: VoiceConfig, mode: 'dictation' | 'live' = 'live',
  sessionId = 'voice-session-1', userId = 'aurvin-dev-user'): SessionContext {
  return {
    identity: { userId, source: 'server-configured', openRouterUser: userId },
    reservation: null,
    response: {
      protocolVersion: 1, sessionId, conversationId: null, mode, connectionEpoch: 0,
      websocketUrl: '/api/voice', expiresAt: '2026-10-08T12:00:10.000Z',
      effectiveAudioSettings: { input: { ...INPUT_AUDIO }, output: mode === 'live' ? { ...OUTPUT_AUDIO } : null },
      limits: { ...config.limits },
    },
  };
}

export function harness(env: Record<string, string | undefined> = {}, admissionPerMinute = 20) {
  const time = clock();
  const stops: { sessionId: string; reason: string }[] = [];
  const warns: { sessionId: string; code: string }[] = [];
  const lines: string[] = [];
  const config = loadVoiceConfig({
    ENABLE_DICTATION_MODE: 'true', ENABLE_LIVE_VOICE_MODE: 'true',
    DEEPGRAM_API_KEY: 'fixture-secret', ...env,
  });
  const ports: VoiceUsagePorts = {
    config, now: time.now, schedule: time.schedule, admissionPerMinute,
    stop: async (sessionId, reason) => { stops.push({ sessionId, reason }); },
    warn: (sessionId, code) => { warns.push({ sessionId, code }); },
    writeLog: line => { lines.push(line); },
  };
  return { time, stops, warns, lines, config, ports, service: new VoiceUsageService(ports) };
}
```

`backend/test/voice/usage/attribution.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { LATENCY_SEGMENTS } from '../../../src/voice/usage/voice-usage.service.js';
import { context, harness } from './fixtures.js';

describe('voice usage attribution', () => {
  it('replaces cumulative STT snapshots and adds distinct TTS speeches once', async () => {
    const { service, config } = harness({
      DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.006',
      DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.006',
      DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.015',
    });
    const live = context(config, 'live');
    await service.admission(live);
    await service.usage(live, { providerRequestId: 'socket-stt', model: 'flux-general-en',
      modelVersion: null, audioMs: 1000, billableCharacters: null });
    await service.usage(live, { providerRequestId: 'socket-stt', model: 'flux-general-en',
      modelVersion: null, audioMs: 2500, billableCharacters: null });
    await service.usage(live, { providerRequestId: 'socket-stt', model: 'flux-general-en',
      modelVersion: null, audioMs: 2000, billableCharacters: null });
    await service.usage(live, { providerRequestId: 'socket-tts', model: 'flux-haley-en',
      modelVersion: 'v1', audioMs: 800, billableCharacters: 200 });
    await service.usage(live, { providerRequestId: 'socket-tts', model: 'flux-haley-en',
      modelVersion: 'v1', audioMs: 800, billableCharacters: 200 });
    await service.usage(live, { providerRequestId: 'socket-tts', model: 'flux-haley-en',
      modelVersion: 'v1', audioMs: 400, billableCharacters: 40 });
    const snap = service.snapshot();
    expect(snap.sttAudioMs).toBe(2500);
    expect(snap.ttsAudioMs).toBe(1200);
    expect(snap.ttsCharacters).toBe(240);
    expect(snap.charactersComplete).toBe(true);
    expect(snap.audioComplete).toBe(true);
    expect(snap.spendStatus).toBe('known');
    expect(snap.estimatedSpendUsd).toBeCloseTo((2500 / 60000) * 0.006 + (240 / 1000) * 0.015, 8);
  });

  it('keeps missing rates and null measurements unknown instead of zero', async () => {
    const { service, config, lines } = harness();
    const dictation = context(config, 'dictation', 'voice-session-2');
    await service.admission(dictation);
    await service.usage(dictation, { providerRequestId: null, model: 'nova-3',
      modelVersion: null, audioMs: null, billableCharacters: null });
    const snap = service.snapshot();
    expect(snap.spendStatus).toBe('unknown');
    expect(snap.estimatedSpendUsd).toBeNull();
    expect(snap.audioComplete).toBe(false);
    expect(snap.sttAudioMs).toBe(0);
    const text = lines.join('\n');
    expect(text).not.toContain('fixture-secret');
    expect(text).not.toContain('voice-session-2');
    expect(text).not.toContain('transcript');
    expect(text).toContain('"kind":"voice-usage"');
  });

  it('attributes tokens once per attempt and leaves incomplete tokens null', async () => {
    const { service, config } = harness();
    const live = context(config);
    await service.admission(live);
    service.noteModelUsage(live.response.sessionId, { attemptId: 'attempt-1', promptTokens: 3, completionTokens: 5 });
    service.noteModelUsage(live.response.sessionId, { attemptId: 'attempt-1', promptTokens: 3, completionTokens: 5 });
    expect(service.snapshot()).toMatchObject({ promptTokens: 3, completionTokens: 5 });
    service.noteModelUsage(live.response.sessionId, { attemptId: 'attempt-2', promptTokens: 2, completionTokens: 2 });
    expect(service.snapshot()).toMatchObject({ promptTokens: 5, completionTokens: 7 });
    service.noteModelUsage(live.response.sessionId, { attemptId: 'attempt-3', promptTokens: null, completionTokens: 1 });
    expect(service.snapshot().promptTokens).toBeNull();
    expect(service.snapshot().completionTokens).toBeNull();
  });

  it('reports p50 and p95 per segment and null for an empty segment', () => {
    const { service } = harness();
    for (let value = 10; value <= 1000; value += 10) service.noteLatency('stt', value);
    expect(service.snapshot().latency.stt).toEqual({ count: 100, p50: 500, p95: 950 });
    expect(service.snapshot().latency.tool).toEqual({ count: 0, p50: null, p95: null });
    expect(service.snapshot().latency.turn.p50).toBeNull();
    service.noteLatency('llm', Number.NaN);
    service.noteLatency('llm', -1);
    expect(service.snapshot().latency.llm.count).toBe(0);
    expect(Object.keys(service.snapshot().latency)).toEqual([...LATENCY_SEGMENTS]);
  });

  it('still attributes a usage snapshot that arrives after release', async () => {
    const { service, config } = harness({
      DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.006',
      DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.006',
      DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.015',
    });
    const dictation = context(config, 'dictation');
    const lease = await service.admission(dictation);
    await lease.release();
    await service.usage(dictation, { providerRequestId: 'nova-socket', model: 'nova-3',
      modelVersion: null, audioMs: 60000, billableCharacters: null });
    expect(service.snapshot().sttAudioMs).toBe(60000);
    expect(service.snapshot().active).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Working directory `backend`:

```bash
npm test -- test/voice/usage/attribution.spec.ts
```

Expected: FAIL. Either the module is missing, or the `dadd5c7` constructor rejects `VoiceUsagePorts`. Do not change the test to call `recordSessionStart` or `recordSpeechUsage`.

- [ ] **Step 3: Write the minimal service**

`backend/src/voice/usage/voice-usage.service.ts` (add the repository header above this source):

```typescript
import { createHash } from 'node:crypto';
import type { SpeechUsage } from '../../contracts/voice.js';
import type { VoiceConfig } from '../../platform/config/voice-config.js';
import { redactSecrets } from '../../platform/security/redact.js';
import { VoiceSessionError, type SessionContext } from '../session/voice-session.options.js';

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
};
type Lease = Recorded & {
  halting: boolean; warnedDuration: boolean; warnedIdle: boolean; cancel: Array<() => void>;
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

  constructor(private readonly ports: VoiceUsagePorts) {}

  speechStatus() {
    const voice = this.ports.config;
    const enabled = voice.enabledModes.dictation || voice.enabledModes.live;
    return { enabled, configured: !enabled || voice.deepgram.apiKey.length > 0, degraded: this.degraded };
  }

  degrade() { this.degraded = true; this.failures += 1; this.log({ action: 'speech-degraded' }); }

  snapshot(): VoiceUsageSnapshot {
    const rows = [...this.closed, ...this.active.values()];
    let sttAudioMs = 0; let ttsAudioMs = 0; let ttsCharacters = 0;
    let audioComplete = true; let charactersComplete = true; let spendKnown = true; let spend = 0;
    const rates = this.ports.config.rates;
    const ratesKnown = rates.novaPerMinuteUsd !== null && rates.fluxSttPerMinuteUsd !== null
      && rates.fluxTtsPerThousandCharsUsd !== null;
    if (!ratesKnown) spendKnown = false;
    for (const row of rows) {
      ttsAudioMs += row.ttsAudioMs; ttsCharacters += row.ttsCharacters;
      audioComplete &&= row.audioComplete; charactersComplete &&= row.charactersComplete;
      for (const [key, audioMs] of row.stt) {
        if (audioMs === null) { audioComplete = false; spendKnown = false; continue; }
        sttAudioMs += audioMs;
        const rate = key.endsWith('|nova-3') ? rates.novaPerMinuteUsd : rates.fluxSttPerMinuteUsd;
        if (rate === null) spendKnown = false; else spend += (audioMs / 60000) * rate;
      }
      if (!row.charactersComplete) spendKnown = false;
      else if (rates.fluxTtsPerThousandCharsUsd === null) spendKnown = false;
      else spend += (row.ttsCharacters / 1000) * rates.fluxTtsPerThousandCharsUsd;
    }
    const attempts = [...this.attempts.values()];
    const tokensComplete = attempts.every(item => item.promptTokens !== null && item.completionTokens !== null);
    const latency = Object.fromEntries(LATENCY_SEGMENTS.map(segment => {
      const sorted = [...this.latency[segment]].sort((a, b) => a - b);
      return [segment, { count: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) }];
    })) as VoiceUsageSnapshot['latency'];
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

  noteModelUsage(sessionId: string, usage: AttemptUsage & { attemptId: string }) {
    if (!this.find(sessionId)) return;
    this.attempts.set(`${sessionId}:${usage.attemptId}`, {
      promptTokens: finite(usage.promptTokens) ? usage.promptTokens : null,
      completionTokens: finite(usage.completionTokens) ? usage.completionTokens : null,
    });
  }

  noteActivity(sessionId: string) { this.armIdle(this.active.get(sessionId)); }

  async admission(context: SessionContext): Promise<{ release: () => Promise<void> }> {
    const mode = context.response.mode;
    if (!this.accepting || !this.ports.config.enabledModes[mode]) throw new VoiceSessionError('VOICE_DISABLED');
    const now = this.ports.now();
    this.admissions.splice(0, this.admissions.length, ...this.admissions.filter(at => now - at < 60_000));
    if (this.admissions.length >= this.ports.admissionPerMinute) { this.rejected += 1; throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED'); }
    const userId = context.identity.userId;
    const active = [...this.active.values()];
    if (active.length >= this.ports.config.quotas.globalConcurrent
      || active.filter(row => row.userId === userId).length >= this.ports.config.quotas.identityConcurrent) {
      this.rejected += 1; throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED');
    }
    this.assertBudget(userId, 0);
    const row = this.blank(context, now);
    const lease: Lease = { ...row, halting: false, warnedDuration: false, warnedIdle: false, cancel: [] };
    this.active.set(row.sessionId, lease);
    this.admissions.push(now);
    this.armDuration(lease);
    this.armIdle(lease);
    this.log({ action: 'admit', sessionId: row.sessionId, mode });
    return { release: () => this.release(row.sessionId) };
  }

  async usage(context: SessionContext, usage: SpeechUsage): Promise<void> {
    const row = this.find(context.response.sessionId);
    if (!row) return;
    this.noteActivity(context.response.sessionId);
    if (usage.model === 'nova-3' || usage.model === 'flux-general-en') this.applyStt(row, usage);
    else if (TTS.has(usage.model)) this.applyTts(row, usage);
    else { row.audioComplete = false; }
    const spend = this.snapshot();
    const cap = this.ports.config.quotas.dailySpendUsd;
    if (cap !== null && spend.spendStatus === 'known' && (spend.estimatedSpendUsd ?? 0) >= cap)
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
      this.halt(id, 'shutdown');
      await this.release(id);
    }));
    return { drained: this.active.size === 0, active: this.active.size };
  }

  private blank(context: SessionContext, startedAt: number): Recorded {
    return {
      sessionId: context.response.sessionId, userId: context.identity.userId, mode: context.response.mode,
      startedAt, endedAt: null, stt: new Map(), ttsKeys: new Set(), ttsAudioMs: 0, ttsCharacters: 0,
      audioComplete: true, charactersComplete: true,
    };
  }

  private find(sessionId: string): Recorded | undefined {
    return this.active.get(sessionId) ?? this.closed.find(row => row.sessionId === sessionId);
  }

  private applyStt(row: Recorded, usage: SpeechUsage) {
    const key = `${usage.providerRequestId ?? 'socket'}|${usage.model}`;
    if (!finite(usage.audioMs)) { row.stt.set(key, row.stt.get(key) ?? null); row.audioComplete = false; return; }
    const previous = row.stt.get(key);
    if (previous !== undefined && previous !== null && usage.audioMs < previous) return;
    row.stt.set(key, usage.audioMs);
  }

  private applyTts(row: Recorded, usage: SpeechUsage) {
    if (!finite(usage.billableCharacters)) { row.charactersComplete = false; return; }
    const key = `${usage.providerRequestId ?? 'socket'}|${usage.model}|${usage.audioMs}|${usage.billableCharacters}`;
    if (row.ttsKeys.has(key)) return;
    row.ttsKeys.add(key);
    row.ttsCharacters += usage.billableCharacters;
    if (finite(usage.audioMs)) row.ttsAudioMs += usage.audioMs; else row.audioComplete = false;
  }

  private elapsed(row: Recorded, now = this.ports.now()) {
    return Math.max(0, (row.endedAt ?? now) - row.startedAt);
  }

  private consumed(userId?: string) {
    const now = this.ports.now();
    return [...this.closed, ...this.active.values()]
      .filter(row => userId === undefined || row.userId === userId)
      .filter(row => new Date(row.startedAt).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10))
      .reduce((sum, row) => sum + this.elapsed(row, now), 0);
  }

  private assertBudget(userId: string, additionalMs: number) {
    const quotas = this.ports.config.quotas;
    if (this.consumed(userId) + additionalMs >= quotas.identityDailyMinutes * 60_000
      || this.consumed() + additionalMs >= quotas.globalDailyMinutes * 60_000) {
      this.rejected += 1; throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED');
    }
    const spend = this.snapshot();
    if (quotas.dailySpendUsd !== null && spend.spendStatus === 'known' && (spend.estimatedSpendUsd ?? 0) >= quotas.dailySpendUsd) {
      this.rejected += 1; throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED');
    }
  }

  private armDuration(lease: Lease) {
    const limits = this.ports.config.limits;
    const modeCap = lease.mode === 'dictation' ? limits.dictationMaxMs : limits.liveMaxMs;
    const identityLeft = this.ports.config.quotas.identityDailyMinutes * 60_000 - this.consumed(lease.userId);
    const globalLeft = this.ports.config.quotas.globalDailyMinutes * 60_000 - this.consumed();
    const hard = Math.min(modeCap, identityLeft, globalLeft);
    if (hard <= 0) { this.active.delete(lease.sessionId); this.rejected += 1; throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED'); }
    const warningAt = lease.mode === 'live' ? limits.liveWarningMs : modeCap - 30_000;
    if (warningAt > 0 && warningAt < hard) lease.cancel.push(this.ports.schedule(warningAt, () => {
      if (lease.endedAt !== null || lease.warnedDuration) return;
      lease.warnedDuration = true;
      this.ports.warn(lease.sessionId, 'VOICE_DURATION_LIMIT');
      this.log({ action: 'warn', sessionId: lease.sessionId, code: 'VOICE_DURATION_LIMIT' });
    }));
    lease.cancel.push(this.ports.schedule(hard, () => {
      this.halt(lease.sessionId, hard < modeCap ? 'quota' : 'duration');
    }));
  }

  private armIdle(lease: Lease | undefined) {
    if (!lease || lease.mode !== 'live' || lease.endedAt !== null || lease.halting) return;
    for (const cancel of lease.cancel.splice(0)) cancel();
    this.armDuration(lease);
    lease.warnedIdle = false;
    const limits = this.ports.config.limits;
    const warnTimer = this.ports.schedule(limits.idleWarningMs, () => {
      if (lease.endedAt !== null || lease.halting) return;
      lease.warnedIdle = true;
      this.ports.warn(lease.sessionId, 'VOICE_IDLE_TIMEOUT');
      this.log({ action: 'warn', sessionId: lease.sessionId, code: 'VOICE_IDLE_TIMEOUT' });
      const exitTimer = this.ports.schedule(limits.idleExitAfterWarningMs, () => this.halt(lease.sessionId, 'idle'));
      lease.cancel.push(exitTimer);
    });
    lease.cancel.push(warnTimer);
  }

  private halt(sessionId: string, reason: VoiceStopReason) {
    const lease = this.active.get(sessionId);
    if (!lease || lease.halting) return;
    lease.halting = true;
    for (const cancel of lease.cancel.splice(0)) cancel();
    const code = reason === 'duration' ? 'VOICE_DURATION_LIMIT'
      : reason === 'idle' ? 'VOICE_IDLE_TIMEOUT'
      : reason === 'quota' ? 'VOICE_QUOTA_EXHAUSTED' : undefined;
    this.log({ action: 'stop', sessionId, reason, code });
    void this.ports.stop(sessionId, reason).catch(() => undefined);
  }

  private async release(sessionId: string): Promise<void> {
    const lease = this.active.get(sessionId);
    if (!lease) return;
    lease.endedAt = this.ports.now();
    for (const cancel of lease.cancel.splice(0)) cancel();
    this.active.delete(sessionId);
    this.closed.push(lease);
    // ponytail: last 256 closed sessions only. Upgrade path: P1 metadata record.
    if (this.closed.length > 256) this.closed.shift();
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
```

`backend/src/voice/usage/index.ts`:

```typescript
export { LATENCY_SEGMENTS, VoiceUsageService, percentile } from './voice-usage.service.js';
export type { LatencySegment, VoiceStopReason, VoiceUsagePorts, VoiceUsageSnapshot, VoiceWarnCode } from './voice-usage.service.js';
```

Task 1 keeps duration and idle callbacks in one `cancel` list. Task 2 splits that list before the quota tests run. Task 1 tests do not advance the clock, so they still pass.

- [ ] **Step 4: Run the attribution test**

Working directory `backend`:

```bash
npm test -- test/voice/usage/attribution.spec.ts
```

Expected: PASS, 5 tests. If token expectation fails because no attempts yields `null` instead of `0`, the no-attempt branch in `snapshot()` must return `0` for both token fields. The incomplete-attempt branch must return `null`.

- [ ] **Step 5: Commit only these paths**

```bash
git add backend/src/voice/usage/voice-usage.service.ts backend/src/voice/usage/index.ts backend/test/voice/usage/fixtures.ts backend/test/voice/usage/attribution.spec.ts
git add -u -- backend/src/voice/usage/voice-usage.types.ts backend/test/voice/usage/voice-usage.spec.ts
git commit -m "feat(voice): attribute speech usage without inventing spend"
```

The second `git add -u --` only stages deletion of the retired files if they are tracked. Do not use `git add .`.

---

### Task 2: Quota and idle policy enforcement

**Files:**
- Modify: `backend/src/voice/usage/voice-usage.service.ts`
- Test: `backend/test/voice/usage/quota.spec.ts`

- [ ] **Step 1: Write the failing quota tests**

`backend/test/voice/usage/quota.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { VoiceSessionError } from '../../../src/voice/session/voice-session.options.js';
import { context, harness } from './fixtures.js';

const rates = {
  DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.01',
  DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.01',
  DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.01',
};

describe('voice quota clock', () => {
  it('warns before the live cap and hard-stops at 20 minutes', async () => {
    const { service, config, time, warns, stops } = harness();
    const live = context(config, 'live');
    await service.admission(live);
    let seen = 0;
    while (seen < 1_080_000) {
      const step = Math.min(30_000, 1_080_000 - seen);
      time.advance(step);
      seen += step;
      if (seen < 1_080_000) service.noteActivity(live.response.sessionId);
    }
    expect(warns).toEqual([{ sessionId: live.response.sessionId, code: 'VOICE_DURATION_LIMIT' }]);
    expect(stops).toEqual([]);
    while (seen < 1_200_000) {
      const step = Math.min(30_000, 1_200_000 - seen);
      time.advance(step);
      seen += step;
      if (seen < 1_200_000) service.noteActivity(live.response.sessionId);
    }
    expect(stops).toEqual([{ sessionId: live.response.sessionId, reason: 'duration' }]);
  });

  it('warns 30 seconds before the dictation cap and does not idle-stop a pause', async () => {
    const { service, config, time, warns, stops } = harness();
    const dictation = context(config, 'dictation');
    await service.admission(dictation);
    time.advance(90_000);
    expect(warns).toEqual([]);
    expect(stops).toEqual([]);
    time.advance(180_000);
    expect(warns).toEqual([{ sessionId: dictation.response.sessionId, code: 'VOICE_DURATION_LIMIT' }]);
    time.advance(30_000);
    expect(stops).toEqual([{ sessionId: dictation.response.sessionId, reason: 'duration' }]);
  });

  it('warns after 60 idle seconds and stops 30 seconds later unless activity resumes', async () => {
    const { service, config, time, warns, stops } = harness();
    const live = context(config, 'live');
    await service.admission(live);
    time.advance(59_000);
    service.noteActivity(live.response.sessionId);
    time.advance(60_000);
    expect(warns).toEqual([{ sessionId: live.response.sessionId, code: 'VOICE_IDLE_TIMEOUT' }]);
    service.noteActivity(live.response.sessionId);
    time.advance(30_000);
    expect(stops).toEqual([]);
    time.advance(60_000);
    expect(warns).toHaveLength(2);
    time.advance(30_000);
    expect(stops).toEqual([{ sessionId: live.response.sessionId, reason: 'idle' }]);
  });

  it('does not treat reconnect as activity', async () => {
    const { service, config, time, warns } = harness();
    const live = context(config, 'live');
    await service.admission(live);
    time.advance(50_000);
    await service.disconnected(live);
    time.advance(10_000);
    expect(warns.map(item => item.code)).toEqual(['VOICE_IDLE_TIMEOUT']);
    expect(service.snapshot().reconnects).toBe(1);
  });

  it('rejects a second concurrent session and a third admission inside one minute', async () => {
    const { service, config, time } = harness({ VOICE_IDENTITY_CONCURRENT: '1' }, 2);
    const first = context(config, 'live', 'voice-session-1');
    const lease = await service.admission(first);
    await expect(service.admission(context(config, 'dictation', 'voice-session-2')))
      .rejects.toBeInstanceOf(VoiceSessionError);
    await lease.release();
    const third = await service.admission(context(config, 'dictation', 'voice-session-3'));
    await expect(service.admission(context(config, 'live', 'voice-session-4')))
      .rejects.toMatchObject({ code: 'VOICE_QUOTA_EXHAUSTED' });
    await third.release();
    time.advance(60_000);
    await expect(service.admission(context(config, 'live', 'voice-session-5'))).resolves.toBeTruthy();
    expect(service.snapshot().rejected).toBe(2);
  });

  it('stops the running session at the remaining daily minute budget and resets on the next UTC day', async () => {
    const { service, config, time, stops } = harness({
      VOICE_IDENTITY_DAILY_MINUTES: '1', VOICE_GLOBAL_DAILY_MINUTES: '1', ...rates,
    });
    const dictation = context(config, 'dictation');
    const lease = await service.admission(dictation);
    time.advance(60_000);
    expect(stops).toEqual([{ sessionId: dictation.response.sessionId, reason: 'quota' }]);
    await lease.release();
    await expect(service.admission(context(config, 'dictation', 'voice-session-same-day')))
      .rejects.toMatchObject({ code: 'VOICE_QUOTA_EXHAUSTED' });
    time.advance(12 * 60 * 60 * 1000);
    await expect(service.admission(context(config, 'dictation', 'voice-session-next'))).resolves.toBeTruthy();
  });

  it('stops when known spend reaches the cap and does not invent a cap from unknown rates', async () => {
    const capped = harness({ VOICE_DAILY_SPEND_USD: '0.01', ...rates });
    const live = context(capped.config, 'live');
    await capped.service.admission(live);
    await capped.service.usage(live, { providerRequestId: 'tts-1', model: 'flux-haley-en',
      modelVersion: null, audioMs: 1000, billableCharacters: 1000 });
    expect(capped.stops).toEqual([{ sessionId: live.response.sessionId, reason: 'quota' }]);
    const unknown = harness();
    const other = context(unknown.config, 'live');
    await unknown.service.admission(other);
    await unknown.service.usage(other, { providerRequestId: 'tts-2', model: 'flux-priya-en',
      modelVersion: null, audioMs: 1000, billableCharacters: 5000 });
    expect(unknown.stops).toEqual([]);
    expect(unknown.service.snapshot().estimatedSpendUsd).toBeNull();
  });

  it('rejects a disabled mode and a drained service before counting a session', async () => {
    const { service, config } = harness({ ENABLE_LIVE_VOICE_MODE: 'false' });
    await expect(service.admission(context(config, 'live'))).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
    service.stopAccepting();
    await expect(service.admission(context(config, 'dictation'))).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
    expect(service.snapshot().sessions).toBe(0);
  });
});
```

- [ ] **Step 2: Run the quota test to verify it fails**

Working directory `backend`:

```bash
npm test -- test/voice/usage/quota.spec.ts
```

Expected: FAIL. The idle test fails if `noteActivity` clears the duration timers and then the later idle stop never rearms, or if `armIdle` is not separated from duration timers. The daily-budget test fails if the hard stop uses audio minutes or does not compare wall-clock remainder. Do not loosen the expected reasons.

- [ ] **Step 3: Separate idle timers from duration timers**

In `voice-usage.service.ts`, replace `armIdle` and the `noteActivity` path so activity does not cancel duration timers. Keep the Task 1 methods. Use this replacement:

```typescript
type Lease = Recorded & {
  halting: boolean; warnedDuration: boolean; warnedIdle: boolean;
  durationCancels: Array<() => void>; idleCancels: Array<() => void>;
};

private clear(list: Array<() => void>) { for (const cancel of list.splice(0)) cancel(); }

noteActivity(sessionId: string) { this.armIdle(this.active.get(sessionId)); }

private armDuration(lease: Lease) {
  this.clear(lease.durationCancels);
  const limits = this.ports.config.limits;
  const modeCap = lease.mode === 'dictation' ? limits.dictationMaxMs : limits.liveMaxMs;
  const identityLeft = this.ports.config.quotas.identityDailyMinutes * 60_000 - this.consumed(lease.userId);
  const globalLeft = this.ports.config.quotas.globalDailyMinutes * 60_000 - this.consumed();
  const hard = Math.min(modeCap, identityLeft, globalLeft);
  if (hard <= 0) { this.active.delete(lease.sessionId); this.rejected += 1; throw new VoiceSessionError('VOICE_QUOTA_EXHAUSTED'); }
  const warningAt = lease.mode === 'live' ? limits.liveWarningMs : modeCap - 30_000;
  if (warningAt > 0 && warningAt < hard) lease.durationCancels.push(this.ports.schedule(warningAt, () => {
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
  const limits = this.ports.config.limits;
  lease.idleCancels.push(this.ports.schedule(limits.idleWarningMs, () => {
    if (lease.endedAt !== null || lease.halting || lease.warnedIdle) return;
    lease.warnedIdle = true;
    this.ports.warn(lease.sessionId, 'VOICE_IDLE_TIMEOUT');
    this.log({ action: 'warn', sessionId: lease.sessionId, code: 'VOICE_IDLE_TIMEOUT' });
    lease.idleCancels.push(this.ports.schedule(limits.idleExitAfterWarningMs, () => this.halt(lease.sessionId, 'idle')));
  }));
}

private halt(sessionId: string, reason: VoiceStopReason) {
  const lease = this.active.get(sessionId);
  if (!lease || lease.halting) return;
  lease.halting = true;
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
  lease.endedAt = this.ports.now();
  this.clear(lease.durationCancels);
  this.clear(lease.idleCancels);
  this.active.delete(sessionId);
  this.closed.push(lease);
  if (this.closed.length > 256) this.closed.shift();
}
```

Update the lease literal in `admission` to `{ ...row, halting: false, warnedDuration: false, warnedIdle: false, durationCancels: [], idleCancels: [] }`. Delete the old `cancel` field. Keep `this.armDuration(lease); this.armIdle(lease);` in that order. `armIdle` must not call `armDuration`. Call `armDuration` before `armIdle` so an equal deadline halts for quota or duration before an idle timer at the same timestamp can run. The daily test uses dictation so idle is not armed at all.

- [ ] **Step 4: Run quota and attribution tests**

Working directory `backend`:

```bash
npm test -- test/voice/usage/quota.spec.ts test/voice/usage/attribution.spec.ts
```

Expected: PASS. Quota file has 8 tests. Attribution file still has 5.

- [ ] **Step 5: Commit**

```bash
git add backend/src/voice/usage/voice-usage.service.ts backend/test/voice/usage/quota.spec.ts
git commit -m "feat(voice): enforce duration idle and spend caps"
```

---

### Task 3: Operations readiness and drain

**Files:**
- Modify: `backend/src/operations/options.ts`
- Modify: `backend/src/operations/readiness.ts`
- Modify: `backend/src/operations/operations.service.ts`
- Test: `backend/test/operations/voice-readiness.spec.ts`
- Test: `backend/test/operations/voice-shutdown.spec.ts`

- [ ] **Step 1: Write the failing operations tests**

`backend/test/operations/voice-readiness.spec.ts`:

```typescript
import { Readiness } from '../../src/operations/readiness.js';
import { loadVoiceConfig } from '../../src/platform/config/voice-config.js';
import { options } from './fixtures.js';

it('reports speech separately and does not take text chat down or call the provider', async () => {
  const previousExit = process.exitCode;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('paid probe'));
  try {
    const off = options();
    off.o.config.voice = loadVoiceConfig({});
    expect(await new Readiness(off.o).read()).toMatchObject({
      live: true, acceptReady: true, provider: 'unknown', speech: 'off',
    });
    const missing = options();
    missing.o.config.voice = loadVoiceConfig({ ENABLE_DICTATION_MODE: 'true' });
    const missingStatus = await new Readiness(missing.o).read();
    expect(missingStatus.acceptReady).toBe(true);
    expect(missingStatus.speech).toBe('unconfigured');
    expect(missingStatus.issues).not.toContain('DEEPGRAM_API_KEY is missing');
    expect(missing.runtime.stopAccepting).not.toHaveBeenCalled();
    const { o, runtime } = options();
    o.config.voice = loadVoiceConfig({ ENABLE_LIVE_VOICE_MODE: 'true', DEEPGRAM_API_KEY: 'fixture-secret' });
    o.speechDegraded = () => true;
    const degraded = await new Readiness(o).read();
    expect(degraded).toMatchObject({ live: true, acceptReady: true, provider: 'unknown', speech: 'degraded' });
    expect(runtime.stopAccepting).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(previousExit);
  } finally { fetchSpy.mockRestore(); }
});
```

`backend/test/operations/voice-shutdown.spec.ts`:

```typescript
import { OperationsService } from '../../src/operations/operations.service.js';
import { options } from './fixtures.js';

it('drains voice after the runtime and before persistence close', async () => {
  const { o, runtime } = options();
  const order: string[] = [];
  vi.spyOn(runtime, 'stopAccepting').mockImplementation(() => { order.push('stop'); });
  vi.spyOn(runtime, 'drain').mockImplementation(async () => { order.push('runtime'); return { drained: true, active: 0, unresolvedWrites: 0 }; });
  o.drainVoice = vi.fn(async () => { order.push('voice'); return { drained: true, active: 0 }; });
  o.closePersistence = vi.fn(async () => { order.push('close'); });
  const ops = new OperationsService(o);
  expect(await ops.shutdown()).toEqual({ safe: true });
  expect(order).toEqual(['stop', 'runtime', 'voice', 'close']);
});

it('does not close persistence while voice drain is active, hung, or rejected', async () => {
  const active = options();
  active.o.drainVoice = async () => ({ drained: false, active: 1 });
  expect(await new OperationsService(active.o).shutdown()).toEqual({ safe: false });
  expect(active.o.closePersistence).not.toHaveBeenCalled();
  const hung = options();
  vi.useFakeTimers();
  try {
    hung.o.drainVoice = () => new Promise(() => undefined);
    const pending = new OperationsService(hung.o).shutdown();
    await vi.advanceTimersByTimeAsync(hung.o.config.budgets.shutdownDrainMs);
    expect(await pending).toEqual({ safe: false });
    expect(hung.o.closePersistence).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it('includes only the injected voice snapshot and no transcript', () => {
  const { o } = options();
  o.voiceSnapshot = () => ({ active: 1, sessions: 1, reconnects: 0, failures: 0, rejected: 0,
    sttAudioMs: 1, ttsAudioMs: 0, ttsCharacters: 0, audioComplete: true, charactersComplete: true,
    promptTokens: 0, completionTokens: 0, estimatedSpendUsd: null, spendStatus: 'unknown',
    latency: { stt: { count: 0, p50: null, p95: null }, turn: { count: 0, p50: null, p95: null },
      llm: { count: 0, p50: null, p95: null }, tool: { count: 0, p50: null, p95: null },
      tts: { count: 0, p50: null, p95: null }, transport: { count: 0, p50: null, p95: null },
      playback: { count: 0, p50: null, p95: null } } });
  const body = JSON.stringify(new OperationsService(o).metrics());
  expect(JSON.parse(body).voice.spendStatus).toBe('unknown');
  expect(body).not.toContain('transcript');
  expect(body).not.toContain('fixture-secret');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Working directory `backend`:

```bash
npm test -- test/operations/voice-readiness.spec.ts test/operations/voice-shutdown.spec.ts
```

Expected: FAIL because `speech` is absent and `drainVoice` is not called. Existing `test/operations/readiness.spec.ts` and `test/operations/shutdown.spec.ts` must remain applicable; do not edit them.

- [ ] **Step 3: Add the optional ports and the speech field**

In `backend/src/operations/options.ts`, extend the type. Leave the existing fields unchanged:

```typescript
speechDegraded?: () => boolean;
drainVoice?: (ms: number) => Promise<{ drained: boolean; active: number }>;
voiceSnapshot?: () => {
  active: number; sessions: number; reconnects: number; failures: number; rejected: number;
  sttAudioMs: number; ttsAudioMs: number; ttsCharacters: number;
  audioComplete: boolean; charactersComplete: boolean;
  promptTokens: number | null; completionTokens: number | null;
  estimatedSpendUsd: number | null; spendStatus: 'known' | 'unknown';
  latency: Record<string, { count: number; p50: number | null; p95: number | null }>;
};
```

In `readiness.ts`, import `voiceReadinessIssues` from `../platform/config/voice-config.js`. Immediately before the `return` in `read()`, add:

```typescript
const voiceConfig = this.o.config.voice;
const speechEnabled = Boolean(voiceConfig && (voiceConfig.enabledModes.dictation || voiceConfig.enabledModes.live));
const speech = !speechEnabled ? 'off' as const
  : voiceReadinessIssues(voiceConfig!).length ? 'unconfigured' as const
  : this.o.speechDegraded?.() ? 'degraded' as const : 'ready' as const;
```

Add `speech` to the returned object. Do not push speech issues into `issues`. Do not call `stopAccepting`, `fetch`, or `process.exit` from `read()`.

Replace `metrics()` and the voice section of `shutdown()` in `operations.service.ts` with:

```typescript
metrics() { return { observations:this.telemetry.snapshot(),runtime:this.runtime.snapshot(),
  transport:this.o.transportSnapshot(), ...(this.o.voiceSnapshot ? { voice:this.o.voiceSnapshot() } : {}) }; }
```

Inside the shutdown job, after the runtime `drained` assignment and before `let safe=false`, insert:

```typescript
const voice=this.o.drainVoice
  ? await boundedResult(Promise.resolve().then(() => this.o.drainVoice!(ms)),ms)
  : { ok:true as const,value:{ drained:true,active:0 } };
```

Extend the close condition with `&& voice.ok && voice.value.drained && voice.value.active === 0`. When `drainVoice` is omitted, existing shutdown tests still close after a quiescent runtime. Do not close persistence before voice drain. Do not delete the sentinel.

- [ ] **Step 4: Run operations tests**

Working directory `backend`:

```bash
npm test -- test/operations/voice-readiness.spec.ts test/operations/voice-shutdown.spec.ts test/operations/readiness.spec.ts test/operations/shutdown.spec.ts
```

Expected: PASS. The pre-existing readiness and shutdown files still pass. Speech degradation does not call `fetch` or `stopAccepting`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/operations/options.ts backend/src/operations/readiness.ts backend/src/operations/operations.service.ts backend/test/operations/voice-readiness.spec.ts backend/test/operations/voice-shutdown.spec.ts
git commit -m "feat(operations): report speech health without stopping text chat"
```

---

### Task 4: Operations runbook and staging proxy documentation

**Files:**
- Create: `docs/voice-modes/operations.md`
- Modify: `deployment/staging/nginx.conf`
- Modify: `deployment/staging/README.md`

- [ ] **Step 1: Write the runbook and the proxy change**

Create `docs/voice-modes/operations.md` with this exact body:

```markdown
# Voice modes operations

Policy for the scoped voice baseline. This file is not measured evidence. P11 owns `staging-evidence.md`, `verification.md`, and `pilot-evaluation.md`. Review is skipped, not passed. Do not provision infrastructure, deploy publicly, enable flags, or run paid provider checks from this runbook.

## Scope and topology

Voice is admitted only on loopback or inside the existing access-controlled staging boundary. One Node process and one database executor. No rolling overlap, no second runtime, no browser-supplied identity, and no new authentication. Dictation and live voice stay independently default-off. Text chat remains available when either flag is off.

Session creation, deletion, and the WebSocket upgrade use the same `/api` boundary as text chat. Origin checks, the connection ticket cookie, and the shared development identity are not user authentication. Credentials stay in backend secrets. They must not appear in URLs, Vite settings, or logs.

P10 wires `VoiceUsageService` into the P5 admission, usage, and disconnected hooks, and into `speechDegraded`, `drainVoice`, and `voiceSnapshot`. P10 implements `stop` as `VoiceSessionService.end`. That releases the admission lease. P10 must not point speech failures at `Readiness.providerFailure`.

## Quotas and clocks

| Control | Default | Enforcement |
| --- | --- | --- |
| Dictation duration | 300000 ms | Warn 30000 ms before the cap, then stop `duration` |
| Live duration | 1200000 ms, warn at 1080000 ms | Warn, then stop `duration` |
| Live idle | 60000 ms warning, then 30000 ms | Stop `idle`. Dictation pauses do not idle-stop |
| Identity / global concurrency | 1 / 4 | Reject `VOICE_QUOTA_EXHAUSTED` before provider allocation |
| Identity / global daily minutes | 60 / 120 | Wall-clock, UTC day the session started. In-memory |
| Daily spend | unset | Known rates only. Missing rates stay unknown, never `$0` |
| Voice admissions | same number as `maxRequestsPerMinutePerUser` (20) | Sliding 60s window. Not a Deepgram rate |

The clock starts at admission, which is slightly before the socket is ready. Connect budget is already capped at 10 seconds. Process restart resets in-memory counters. That is a ceiling, not durable billing. Do not add a metadata kind in this workflow.

Cancellation and quota stop do not claim charge prevention. Provider usage that arrives after release is still attributed. Identical TTS tuples are idempotent. Cumulative STT snapshots replace, they do not add.

Client-visible `session.warning` and `session.ended` reasons `duration`, `idle`, and `shutdown` need the P5 follow-up named in `plan9.md`. Until that commit exists, the server still stops the session, and the live flag must not be enabled for operators. Dictation duration enforcement does not need that follow-up.

## Readiness without paid probes

`/api/operations/live` is process reachability only. It must not call Deepgram, OpenRouter, or the database.

`/api/operations/ready` remains the text-chat gate. Speech status is a separate `speech` field:

| `speech` | Meaning | Text `acceptReady` |
| --- | --- | --- |
| `off` | Both voice flags off | Unchanged |
| `unconfigured` | A flag is on and `DEEPGRAM_API_KEY` is missing | Unchanged, no paid call |
| `ready` | Enabled, key present, no recorded speech failure | Unchanged |
| `degraded` | `VoiceUsageService.degrade()` was called | Unchanged |

A speech failure must not call `stopAccepting`, must not set `process.exitCode`, and must not cool text generation. Do not supervise `/ready` as a restart probe. Provider auth or credit failures on the text path keep the existing text circuit; speech must not be wired into that circuit.

## Redacted telemetry

Voice logs are JSON objects with `kind: "voice-usage"`, an action, a hashed session id (`h:` plus 24 hex chars), mode, reason, and code. They must not contain transcripts, audio, API keys, raw session ids, provider request ids, or token text. Aggregate `metrics().voice` exposes counts, milliseconds, character totals, token totals, spend status, and p50/p95. Empty latency is null. The `tool` segment stays empty because tools are out of scope.

Text-chat `METRICS` cells are unchanged. Unknown spend is `estimatedSpendUsd: null` and `spendStatus: "unknown"`. Do not alert on a fabricated zero.

Actual account rates are operator inputs: `DEEPGRAM_NOVA_RATE_PER_MIN_USD`, `DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD`, and `DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD`. A spend cap requires all three. Invoice reconciliation is an operator action, not a health check.

## Staging WebSocket proxy

Use `deployment/staging/nginx.conf`. The exact location `= /api/voice` is the socket. REST `/api/voice/sessions` and `/api/voice/config` stay on the existing `/api/` location and the existing basic-auth server block. Operations routes stay local-only.

The socket location sets `Upgrade` and `Connection "upgrade"`, clears `Authorization`, `X-Forwarded-For`, and `X-Request-ID`, and uses a 10 second connect timeout and 1260 second read/send timeouts. 1260 seconds is longer than the 20 minute live cap so the application policy fires first. Proxy timeout is not the quota. Buffering and cache stay off. Access logs stay off. Do not log the upgrade URL.

Backend remains bound to `127.0.0.1:3000`. The gateway remains the selected staging profile. Copying the config does not start NGINX, install certificates, or open a firewall. `nginx -t` is syntax only and is not streaming evidence.

## Drain and shutdown

1. Stop text admission, then drain the text runtime.
2. Drain voice by calling `VoiceUsageService.drain()`, which stops new admissions, asks each active session to end, and releases leases.
3. Close persistence only when text drain, voice drain, and HTTP transport are quiescent.
4. A hung or active voice drain is unsafe. Do not close the database and do not delete the executor sentinel.
5. Supervisor hard-stop remains 45 seconds, as in [Phase 1 operations](../aurvin-phase-1/operations.md). A speech outage is not a reason to restart.

## Retention, deletion, migration, and rollback

No raw audio is stored. Transient buffers belong to the session and provider adapters and are cleared on end. Finalized internal voice turns, if written by P2, follow the existing conversation retention policy. There is no voice TTL and no automated session deletion in this workflow.

Voice usage counters are process memory. They are not a seventh collection. Backup and restore remain the six-collection procedure in the Phase 1 runbook. Do not add a voice collection to `mongodump`. Do not put URIs, keys, or transcripts in evidence.

No voice schema migration is authorized here. Rollback of the voice feature is flag-off, then drain, on the same release. Do not roll an older build that does not understand `visibility: internal` onto data that already contains internal voice messages. If that data exists, restore an isolated pre-voice snapshot using the Phase 1 procedure and switch only after operator approval. Do not replay prompts. Record any post-snapshot provider cost as unknown unless the invoice says otherwise.

Disabling one flag must leave the other flag and text chat operable. Disabling both leaves diagnostic liveness and text chat on their existing gates.

## Operator inputs still required

Actual Deepgram rates, whether to set `VOICE_DAILY_SPEND_USD`, privacy/model-improvement choices, and any staging exposure beyond loopback are operator decisions. This document does not supply them and does not authorize the spend. P11 records measurements. Unavailable latency, fidelity, device, and cost results stay blocked or unrun, not passed.
```

In `deployment/staging/nginx.conf`, insert this location immediately before `location /api/`:

```nginx
    location = /api/voice {
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_set_header Authorization "";
      proxy_set_header X-Forwarded-For "";
      proxy_set_header X-Request-ID "";
      proxy_buffering off;
      proxy_cache off;
      proxy_connect_timeout 10s;
      proxy_read_timeout 1260s;
      proxy_send_timeout 1260s;
    }
```

Do not move `/api/operations/` or weaken its `allow 127.0.0.1; deny all;`. Do not add credentials.

Append this paragraph to `deployment/staging/README.md`:

```markdown
Voice WebSocket uses the exact `location = /api/voice` block. It inherits the server basic-auth boundary and does not trust forwarded identity headers. REST voice routes stay on `/api/`. The 1260 second proxy read timeout only lets the application duration and idle policy fire first; it is not a quota and it does not authorize enabling flags. Do not start this gateway from the voice runbook.
```

- [ ] **Step 2: Check the documents**

Working directory: repository root.

```bash
node --input-type=module -e "import { readFileSync } from 'node:fs'; const ops = readFileSync('docs/voice-modes/operations.md','utf8'); const ngx = readFileSync('deployment/staging/nginx.conf','utf8'); const readme = readFileSync('deployment/staging/README.md','utf8'); for (const needle of ['no paid', 'WebSocket', 'redact', 'retention', 'rollback', '1260', 'VOICE_QUOTA_EXHAUSTED', 'speech']) if (!ops.toLowerCase().includes(needle.toLowerCase())) throw new Error('missing '+needle); if (!ngx.includes('location = /api/voice')) throw new Error('missing socket location'); if (!ngx.includes('proxy_read_timeout 1260s')) throw new Error('missing voice timeout'); if (!ngx.includes('deny all')) throw new Error('operations boundary removed'); if (ngx.includes('sk-') || ngx.includes('DEEPGRAM_API_KEY=')) throw new Error('secret in proxy'); if (!readme.includes('location = /api/voice')) throw new Error('readme missing voice note'); console.log('voice-ops-docs-ok');"
```

Expected: prints `voice-ops-docs-ok`. This does not prove NGINX was started or that a socket streamed.

- [ ] **Step 3: Commit**

```bash
git add docs/voice-modes/operations.md deployment/staging/nginx.conf deployment/staging/README.md
git commit -m "docs(voice): define quota readiness and staging websocket policy"
```

---

### Task 5: Operations and usage integration tests

**Files:**
- Create: `backend/test/voice/usage/operations.spec.ts`

- [ ] **Step 1: Write the composed tests**

`backend/test/voice/usage/operations.spec.ts`:

```typescript
import { OperationsService } from '../../../src/operations/operations.service.js';
import { Readiness } from '../../../src/operations/readiness.js';
import { context, harness } from './fixtures.js';
import { options } from '../../operations/fixtures.js';

describe('voice usage and operations', () => {
  it('rejects the admission rate limit without a provider call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no probe'));
    try {
      const { service, config, time } = harness({}, 1);
      const lease = await service.admission(context(config, 'dictation', 'voice-session-1'));
      await lease.release();
      await expect(service.admission(context(config, 'dictation', 'voice-session-2')))
        .rejects.toMatchObject({ code: 'VOICE_QUOTA_EXHAUSTED' });
      time.advance(60_000);
      await expect(service.admission(context(config, 'dictation', 'voice-session-3'))).resolves.toBeTruthy();
      expect(service.snapshot().rejected).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it('quota stop does not degrade text readiness or call fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no probe'));
    try {
      const { service, config, time, stops, lines } = harness({
        VOICE_IDENTITY_DAILY_MINUTES: '1', VOICE_GLOBAL_DAILY_MINUTES: '1',
        DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.01', DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.01',
        DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.01',
      });
      const { o, runtime } = options();
      o.config.voice = config;
      o.speechDegraded = () => service.speechStatus().degraded;
      o.voiceSnapshot = () => service.snapshot();
      const dictation = context(config, 'dictation');
      await service.admission(dictation);
      time.advance(60_000);
      expect(stops.map(item => item.reason)).toEqual(['quota']);
      expect(await new Readiness(o).read()).toMatchObject({ acceptReady: true, speech: 'ready', provider: 'unknown' });
      expect(runtime.stopAccepting).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(lines.join('\n')).not.toContain('fixture-secret');
      expect(JSON.stringify(new OperationsService(o).metrics())).not.toContain(dictation.response.sessionId);
    } finally { fetchSpy.mockRestore(); }
  });

  it('speech degrade leaves text admission up and shutdown still refuses an active voice drain', async () => {
    const { service, config } = harness();
    const { o, runtime } = options();
    o.config.voice = config;
    o.speechDegraded = () => service.speechStatus().degraded;
    o.drainVoice = () => service.drain();
    service.degrade();
    expect(service.speechStatus()).toMatchObject({ enabled: true, degraded: true });
    expect(await new Readiness(o).read()).toMatchObject({ live: true, acceptReady: true, speech: 'degraded' });
    expect(runtime.stopAccepting).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    const lease = await service.admission(context(config, 'dictation'));
    o.drainVoice = async () => ({ drained: false, active: 1 });
    expect(await new OperationsService(o).shutdown()).toEqual({ safe: false });
    expect(o.closePersistence).not.toHaveBeenCalled();
    await lease.release();
    const again = options();
    again.o.drainVoice = () => service.drain();
    expect(await new OperationsService(again.o).shutdown()).toEqual({ safe: true });
    expect(service.snapshot().active).toBe(0);
  });
});
```

- [ ] **Step 2: Run the composed test**

Working directory `backend`:

```bash
npm test -- test/voice/usage/operations.spec.ts
```

Expected: PASS, 3 tests, if Tasks 1–3 match this plan. If it fails, fix the service or operations wiring named by the assertion. Do not skip the test, mock `fetch` into a success, or treat speech degrade as text `provider: 'degraded'`.

- [ ] **Step 3: Run the focused package checks**

Working directory `backend`:

```bash
npm test -- test/voice/usage test/operations
npm run build
npm run lint
```

Expected: usage and operations tests PASS. Build PASS. Lint PASS, or only pre-existing warnings outside the files this plan touched. Do not report an empty suite as a pass. Do not run `test:azure`, live Deepgram, or a staging drill.

- [ ] **Step 4: Commit**

```bash
git add backend/test/voice/usage/operations.spec.ts
git commit -m "test(voice): cover quota degradation and drain together"
```

---

## Requirement map

| Requirement | Task |
| --- | --- |
| Mode, duration, audio minutes, characters, tokens, p50/p95 | Task 1 |
| Unknown rates stay unknown; no transcript or key in logs | Task 1 |
| Usage idempotency for cumulative STT and repeated TTS tuples | Task 1 |
| 5 minute dictation, 20 minute live, warning before the cap | Task 2 |
| 60s idle warning and 30s hard stop; activity resets idle; reconnect does not | Task 2 |
| Daily minutes, concurrency, spend cap, admission rate limit, disabled flag | Task 2 |
| Readiness without a paid probe; speech failure leaves text chat up and does not restart | Task 3 |
| Bounded voice drain before persistence close | Task 3 |
| Staging WebSocket proxy, redaction, retention, rollback | Task 4 |
| Composed fake-clock, degradation, and drain checks | Task 5 |

## Worker completion note

Report commit hashes, the exact test commands, pass counts, and skips. Say that client-visible duration/idle warnings are blocked on the P5 follow-up, that in-memory quotas reset on restart, and that review was skipped. Do not update `state.md` unless the orchestrator assigns that write. Do not claim staging, device, latency, or cost evidence.
