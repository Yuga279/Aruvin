/**
 * ============================================================================
 * FILE: runner.ts
 * LOCATION: backend/src/benchmark/runner.ts
 * PURPOSE: Exercise existing text HTTP/SSE routes without bypassing authorization.
 * ROLE IN PROJECT: Opt-in benchmark client; does not start or own a backend/database.
 * KEY COMPONENTS: benchmarkConfigSchema, runText, safeEvidence, correlate.
 * ============================================================================
 */
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { parseSse } from '../model/sse.js';
import { calendarCompatibleEnvelopeSchema } from '../contracts/calendar-wire.js';
import { submitTurnResponseSchema } from '../contracts/api.js';
import type { Scenario, Evidence } from './report.js';
import { voiceProvenanceSchema } from './voice-measurements.js';

export const benchmarkConfigSchema = z.object({
  baseUrl: z.string().url().default('http://127.0.0.1:8001/api').refine(value => {
    const u = new URL(value);
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
      && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/api';
  }, 'Use an existing loopback HTTP backend at /api; never embed credentials.'),
  origin: z.string().url().default('http://localhost:5173'),
  voiceOnly: z.boolean().default(false),
  repetitions: z.number().int().min(1).max(10).default(3),
  warmups: z.number().int().min(0).max(2).default(1),
  timeoutMs: z.number().int().min(1000).max(180000).default(90000),
  start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }),
  timeZone: z.string().min(1).max(100).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }),
  calendarId: z.string().min(1).max(1024).optional(),
  eventId: z.string().min(5).max(1024).optional(),
  allowPaid: z.boolean().default(false), budgetCeilingUsd: z.number().positive().max(100).optional(),
  allowCalendarData: z.boolean().default(false), allowMutations: z.boolean().default(false),
  disposableCalendar: z.boolean().default(false),
  serverLog: z.string().min(1).optional(),
  outputDirectory: z.string().min(1).default('benchmark-results'),
  voicePcm: z.string().min(1).optional(), speechEndMs: z.number().min(1).max(60000).optional(),
  modelLabel: z.string().regex(/^[a-zA-Z0-9/_.:-]{1,128}$/).optional(),
  serverRevision: z.string().regex(/^[a-f0-9]{7,40}$/).optional(),
  transport: z.enum(['websocket', 'webrtc']).default('websocket'),
  provenance: voiceProvenanceSchema.optional(),
}).strict().refine(v => {
  const window = Date.parse(v.end) - Date.parse(v.start);
  return window > 0 && window <= 31 * 86400000;
}, 'Use an increasing time window of at most 31 days.');
export type BenchmarkConfig = z.infer<typeof benchmarkConfigSchema>;
export type WireResult = { sessionId?: string; turnId?: string; attemptId?: string; voiceSessionId?: string;
  durationMs: number; firstTextMs: number | null; acceptanceMs: number | null;
  firstAudioMs?: number | null; speechEndToFirstAudioMs?: number | null; speechEndClockMs?: number;
  speechEndToThinkingMs?: number | null;
  speechEndToPlaybackEndMs?: number | null; cleanupMs?: number;
  durableCompletionMs?: number | null;
  setupMs?: number; inputAudioMs?: number; audioDurationMs?: number; outcome: string; completed?: boolean;
  transport?: 'websocket' | 'webrtc';
  firstAudioBoundary?: 'ws-pcm-receipt-v1' | 'webrtc-decoded-nonzero-after-start-v1';
  firstMediaReceiptMs?: number | null;
  firstTrackSubscribedMs?: number | null;
  firstTrackScheduledMs?: number | null;
  firstAudibleMs?: number | null;
  speechEndToAudibleMs?: number | null;
  interruptionToAudibleStopMs?: number | null;
  decodedSamples?: number;
  preStartFrames?: number;
  maxInputLatenessMs?: number;
  maxInputQueuedMs?: number;
  speechEndFrameSubmittedMs?: number | null;
  failureCode?: 'BENCHMARK_TRANSPORT_MISMATCH' | 'BENCHMARK_MEDIA_FAILED' |
    'BENCHMARK_TIMEOUT' | 'BENCHMARK_UNPROVEN_PLAYBACK' };

export function blockedReason(scenario: Scenario, config: BenchmarkConfig, live: boolean): string | null {
  if (!live) return 'dry-run';
  if (!config.allowPaid || !config.budgetCeilingUsd) return 'paid-call-approval-required';
  if (!config.serverLog) return 'server-log-required-for-stage-evidence';
  if (scenario.expectedTool && !config.allowCalendarData) return 'calendar-data-approval-required';
  if (scenario.mutation && (!config.allowMutations || !config.disposableCalendar || !config.calendarId)) return 'disposable-calendar-mutation-approval-required';
  if (scenario.mode === 'voice' && (!config.voicePcm || !config.speechEndMs)) return 'synthetic-pcm-and-speech-end-marker-required';
  return scenario.blocked ?? null;
}

export async function runText(scenario: Scenario, config: BenchmarkConfig,
  fetcher: typeof fetch = fetch, authorization?: string): Promise<WireResult> {
  const start = performance.now();
  const signal = AbortSignal.timeout(config.timeoutMs);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authorization) headers.Authorization = authorization;
  const result: WireResult = { durationMs: 0, firstTextMs: null, acceptanceMs: null, outcome: 'failed' };
  try {
    const accepted = await fetcher(`${config.baseUrl}/sessions`, { method: 'POST', headers,
      body: JSON.stringify({ sessionId: null, content: scenario.prompt, idempotencyKey: randomUUID(), calendarProtocol: 3 }), signal, redirect: 'error' });
    if (accepted.status !== 202) { result.outcome = `http-${accepted.status}`; await accepted.body?.cancel(); return result; }
    const ids = submitTurnResponseSchema.parse(await accepted.json());
    Object.assign(result, { sessionId: ids.sessionId, turnId: ids.turnId, attemptId: ids.attemptId, acceptanceMs: performance.now() - start });
    const stream = await fetcher(`${config.baseUrl}/sessions/${encodeURIComponent(ids.sessionId)}/turns/${encodeURIComponent(ids.turnId)}/stream`,
      { headers, signal, redirect: 'error' });
    if (!stream.ok || !stream.body) { result.outcome = `http-${stream.status}`; await stream.body?.cancel(); return result; }
    let bytes = 0;
    for await (const frame of parseSse(stream.body)) {
      if (frame.type !== 'data') continue;
      bytes += frame.data.length;
      if (bytes > 2_000_000) throw new Error('BENCHMARK_STREAM_LIMIT');
      const envelope = calendarCompatibleEnvelopeSchema.parse(JSON.parse(frame.data));
      if (envelope.sessionId !== ids.sessionId || envelope.turnId !== ids.turnId || envelope.attemptId !== ids.attemptId) throw new Error('BENCHMARK_CORRELATION');
      const event = envelope.event;
      if (event.type === 'delta' && event.text && result.firstTextMs === null) result.firstTextMs = performance.now() - start;
      if (event.type === 'calendar-clarification') result.outcome = 'needs-user-confirmation';
      if (event.type === 'completed') { result.completed = true;
        if (result.outcome !== 'needs-user-confirmation') result.outcome = event.outcome === 'completed' ? 'completed' : 'truncated'; }
      if (event.type === 'error') result.outcome = event.code === 'TIMEOUT' ? 'timeout' : 'failed';
    }
    if (result.completed) {
      // Read durable status, not just provisional text or a closing socket.
      const status = await fetcher(`${config.baseUrl}/sessions/${encodeURIComponent(ids.sessionId)}/turns/${encodeURIComponent(ids.turnId)}`,
        { headers, signal, redirect: 'error' });
      const body = await status.json() as { status?: string };
      if (!status.ok || body.status !== 'completed') result.outcome = body.status === 'truncated' ? 'truncated' : 'unverified';
    }
  } catch {
    result.outcome = signal.aborted ? 'timeout' : 'failed';
  } finally {
    result.durationMs = performance.now() - start;
    // No automatic retry: disconnection may leave a paid/uncertain operation.
  }
  return result;
}

export const hashId = (s: string) => `h:${createHash('sha256').update(s).digest('hex').slice(0, 24)}`;
const safeStrings = new Set(['kind', 'stage', 'state', 'tool', 'requestKind', 'task', 'chat', 'code', 'persistenceKind']);
const safeIds = new Set(['sessionId', 'turnId', 'attemptId', 'dispatchId', 'decisionId', 'toolCallId', 'responseId']);
const safeNumbers = new Set(['clockMs', 'clockOriginMs', 'durationMs', 'elapsedMs', 'promptTokens', 'completionTokens']);
/** Only projected metadata leaves the server log reader, even if a file contains payloads. */
export function safeEvidence(raw: unknown): Evidence | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const object = raw as Evidence;
  if (!['process', 'voice-pipeline'].includes(String(object.kind))) return null;
  const event: Evidence = {};
  for (const [key, value] of Object.entries(object)) {
    if (safeIds.has(key) && typeof value === 'string' && /^h:[a-f0-9]{24}$/.test(value)) event[key] = value;
    if (safeStrings.has(key) && typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value)) event[key] = value;
    if (safeNumbers.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0) event[key] = value;
  }
  return event;
}
export function correlate(raw: Evidence[], wire: WireResult): Evidence[] {
  const turn = wire.turnId ? hashId(wire.turnId) : null;
  const attempt = wire.attemptId ? hashId(wire.attemptId) : null;
  const voice = wire.voiceSessionId ? hashId(wire.voiceSessionId) : null;
  return raw.filter(e => (turn && e.turnId === turn && (!attempt || !e.attemptId || e.attemptId === attempt))
    || (voice && e.kind === 'voice-pipeline' && e.sessionId === voice));
}

/** Requires durable settlement and terminal completion for this exact turn/session. */
export function isVoiceDeliveryConfirmed(events: Evidence[], wire: WireResult): boolean {
  if (!wire.turnId || !wire.voiceSessionId) return false;
  const turn = hashId(wire.turnId), voice = hashId(wire.voiceSessionId);
  const rows = events.filter(event => event.turnId === turn &&
    (event.kind !== 'voice-pipeline' || event.sessionId === voice));
  return rows.some(event => event.stage === 'delivery-settled' && !event.code) &&
    rows.some(event => event.stage === 'terminal' && event.chat === 'completed') &&
    !rows.some(event => event.stage === 'delivery-settled' && event.code ||
      event.stage === 'terminal' && event.chat !== 'completed');
}
