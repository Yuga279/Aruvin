/**
 * ============================================================================
 * FILE: readonly-harness.ts
 * LOCATION: backend/src/benchmark/readonly-harness.ts
 * PURPOSE: Prepare selected read-only pairing without any implicit live path.
 * ROLE IN PROJECT: Synthetic-only harness until production integration exists.
 * KEY COMPONENTS: validateReadOnlyEnvelope, runReadOnlyHarness.
 * ============================================================================
 */
import { z } from 'zod';
import { benchmarkConfigSchema, correlate, hashId, runText, safeEvidence, type WireResult } from './runner.js';
import { analyzeTurn, scenarios } from './report.js';
import { createReadOnlyCalendarBoundary, readOnlyCalendarPolicySchema } from './readonly-calendar-boundary.js';

const count = (max: number) => z.number().int().min(0).max(max);
const positive = (max: number) => z.number().int().min(1).max(max);
const snapshotSchema = z.object({ sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
  buildRevision: z.string().regex(/^[a-f0-9]{40}$/u), sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  buildSourceHash: z.string().regex(/^[a-f0-9]{64}$/u), harnessHash: z.string().regex(/^[a-f0-9]{64}$/u),
  semanticsHash: z.string().regex(/^[a-f0-9]{64}$/u), baseUrl: z.string().max(200) }).strict();
type Snapshot = z.infer<typeof snapshotSchema>;
const envelopeSchema = z.object({ scenario: z.literal('calendar_list_events'), maxTurns: z.literal(2),
  baseline: snapshotSchema, current: snapshotSchema,
  approval: z.object({ reference: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
    operator: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u), paid: z.literal(true), calendarData: z.literal(true),
    databaseWrites: z.literal(true), syntheticAccountOnly: z.literal(true), expiresAt: z.string().datetime({ offset: true }) }).strict(),
  calendarId: readOnlyCalendarPolicySchema.innerType().shape.calendarId,
  start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), timeZone: z.literal('Etc/UTC'),
  perTurn: z.object({ contextTokens: positive(1000000), outputTokens: positive(1000000), modelDispatches: positive(8),
    calendarRequests: positive(20), refreshRequests: count(2), reservedMicrousd: positive(100000000) }).strict(),
  budgets: z.object({ costMicrousd: positive(100000000), promptTokens: positive(16000000), completionTokens: positive(16000000),
    modelDispatches: positive(16), calendarRequests: positive(40), refreshRequests: count(4),
    totalMs: positive(300000), turnTimeoutMs: z.number().int().min(1000).max(90000),
    responseBytes: positive(262144), maxResults: positive(20) }).strict(),
}).strict();
type Envelope = z.infer<typeof envelopeSchema>;

export function validateReadOnlyEnvelope(raw: unknown, wallNow = Date.now()): Envelope {
  const parsed = envelopeSchema.safeParse(raw);
  const denied = () => { throw new Error('READONLY_ENVELOPE_DENIED'); };
  if (!parsed.success || !Number.isFinite(wallNow)) return denied();
  const e = parsed.data, b = e.budgets, p = e.perTurn;
  if (Date.parse(e.approval.expiresAt) <= wallNow || Date.parse(e.end) <= Date.parse(e.start)
    || Date.parse(e.end) - Date.parse(e.start) > 3600000
    || e.baseline.sourceRevision === e.current.sourceRevision
    || e.baseline.harnessHash !== e.current.harnessHash || e.baseline.semanticsHash !== e.current.semanticsHash
    || b.promptTokens < 2 * p.modelDispatches * p.contextTokens || b.completionTokens < 2 * p.modelDispatches * p.outputTokens
    || b.modelDispatches < 2 * p.modelDispatches || b.calendarRequests < 2 * p.calendarRequests
    || b.refreshRequests < 2 * p.refreshRequests || b.costMicrousd < 2 * p.reservedMicrousd) return denied();
  for (const source of [e.baseline, e.current]) {
    if (source.sourceRevision !== source.buildRevision || source.sourceHash !== source.buildSourceHash
      || !benchmarkConfigSchema.safeParse({ baseUrl: source.baseUrl,
      start: e.start, end: e.end, timeZone: e.timeZone }).success) return denied();
  }
  return e; // Parsed copies: caller mutation cannot change the admitted envelope.
}

const receiptSchema = snapshotSchema.extend({ durable: z.literal(true), ready: z.literal(true),
  accounting: z.literal('known'), billedMicrousd: count(100000000), promptTokens: count(16000000),
  completionTokens: count(16000000), modelDispatches: positive(16), calendarRequests: count(40),
  refreshRequests: count(4), events: z.array(z.unknown()).min(1).max(128) }).strict();
type Options = { mode: 'live' } | { mode: 'synthetic';
  transport: (source: Snapshot, guardedCalendar: typeof fetch, signal: AbortSignal) => typeof fetch;
  calendarFetch: typeof fetch;
  settle: (wire: WireResult, source: Snapshot, signal: AbortSignal) => Promise<unknown>;
  wallNow?: () => number; now?: () => number };
type Row = { label: 'baseline' | 'current'; sourceRevision: string; outcome: 'unverified' | 'synthetic-success';
  attemptHash?: string; durationMs: number; firstTextMs: number | null; models: ReturnType<typeof analyzeTurn>['models'] };

/** Synthetic hooks are trusted test dependencies, NOT server security attestations. No live adapter exists. */
export async function runReadOnlyHarness(raw: unknown, options: Options) {
  // No approval JSON or injected client can switch on an unintegrated server-side safety boundary.
  if (options.mode !== 'synthetic') throw new Error('LIVE_RUNTIME_INTEGRATION_REQUIRED');
  const wallNow = options.wallNow ?? Date.now, now = options.now ?? (() => performance.now());
  const e = validateReadOnlyEnvelope(raw, wallNow()), started = now();
  const deadline = started + Math.min(e.budgets.totalMs, Date.parse(e.approval.expiresAt) - wallNow());
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), Math.max(1, deadline - now()));
  const records: Row[] = [];
  const result = { evidenceKind: 'synthetic-only' as const, outcome: 'stopped' as 'stopped' | 'synthetic-complete',
    actualBilling: 'unknown' as const, commandWaves: 'unavailable' as const, records };
  const totals = { billedMicrousd: 0, promptTokens: 0, completionTokens: 0, modelDispatches: 0, calendarRequests: 0, refreshRequests: 0 };
  const check = () => {
    if (stop.signal.aborted || !Number.isFinite(now()) || now() >= deadline || wallNow() >= Date.parse(e.approval.expiresAt)) {
      stop.abort(); throw new Error('READONLY_RUN_STOPPED');
    }
  };
  const wait = async <T>(work: Promise<T>): Promise<T> => {
    let abort = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('READONLY_RUN_STOPPED'));
      if (stop.signal.aborted) abort(); else stop.signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([work, cancelled]); }
    finally { stop.signal.removeEventListener('abort', abort); }
  };
  try {
    for (const label of ['baseline', 'current'] as const) {
      check();
      const source = e[label];
      const boundary = createReadOnlyCalendarBoundary({ calendarId: e.calendarId, start: e.start, end: e.end,
        maxResults: e.budgets.maxResults, maxRequests: e.perTurn.calendarRequests,
        maxResponseBytes: e.budgets.responseBytes, deadlineMs: deadline }, options.calendarFetch, now, stop.signal);
      const upstream = options.transport({ ...source }, boundary.fetch, stop.signal);
      if (boundary.signal.aborted) throw new Error('READONLY_RUN_STOPPED');
      let requests = 0, responseBytes = 0;
      const client: typeof fetch = async (input, init) => {
        check();
        if (boundary.signal.aborted || ++requests > 3) throw new Error('READONLY_RUN_STOPPED');
        const signal = AbortSignal.any([stop.signal, boundary.signal, ...(init?.signal ? [init.signal] : [])]);
        const response = await wait(upstream(input, { ...init, signal, redirect: 'error' }));
        if (!response.body) return response;
        const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
          responseBytes += chunk.byteLength;
          if (responseBytes > e.budgets.responseBytes) { stop.abort(); throw new Error('READONLY_RUN_STOPPED'); }
          controller.enqueue(chunk);
        } }), { signal });
        return new Response(body, { status: response.status, headers: response.headers });
      };
      const config = benchmarkConfigSchema.parse({ baseUrl: source.baseUrl, start: e.start, end: e.end, timeZone: e.timeZone,
        calendarId: e.calendarId, repetitions: 1, warmups: 0, timeoutMs: e.budgets.turnTimeoutMs });
      const scenario = scenarios(config).find(s => s.id === e.scenario)!;
      const wire = await wait(runText(scenario, config, client));
      const row: Row = { label, sourceRevision: source.sourceRevision, outcome: 'unverified', durationMs: wire.durationMs,
        firstTextMs: wire.firstTextMs, models: [], ...(wire.attemptId ? { attemptHash: hashId(wire.attemptId) } : {}) };
      records.push(row);
      check();
      if (wire.outcome !== 'completed' || !wire.completed || boundary.signal.aborted) break;
      const receipt = receiptSchema.safeParse(await wait(options.settle(wire, { ...source }, stop.signal)));
      if (!receipt.success) break;
      const r = receipt.data;
      if ((Object.keys(source) as Array<keyof Snapshot>).some(key => r[key] !== source[key])) break;
      if (r.modelDispatches > e.perTurn.modelDispatches || r.calendarRequests > e.perTurn.calendarRequests
        || r.refreshRequests > e.perTurn.refreshRequests || r.billedMicrousd > e.perTurn.reservedMicrousd
        || r.promptTokens > e.perTurn.modelDispatches * e.perTurn.contextTokens
        || r.completionTokens > e.perTurn.modelDispatches * e.perTurn.outputTokens) break;
      const events = correlate(r.events.flatMap(v => { const safe = safeEvidence(v); return safe ? [safe] : []; }), wire)
        .filter(event => event.attemptId === hashId(wire.attemptId!) && event.turnId === hashId(wire.turnId!));
      const analysis = analyzeTurn(e.scenario, events, wire.durationMs);
      const ends = events.filter(event => event.stage === 'model-stream-end');
      if (analysis.outcome !== 'success' || !events.some(event => event.stage === 'terminal' && event.chat === 'completed')
        || analysis.observedTools.some(tool => tool !== e.scenario) || analysis.models.length !== r.modelDispatches
        || analysis.models.some(model => !model.dispatchId || model.state !== 'ok' || model.firstOutputMs === null
          || model.durationMs === null || model.firstOutputMs > model.durationMs || model.completionTokens === null
          || model.firstTextMs !== null && model.firstTextMs > model.durationMs
          || model.firstEventMs !== null && model.firstEventMs > model.firstOutputMs)
        || new Set(analysis.models.map(model => model.dispatchId)).size !== r.modelDispatches
        || ends.some(event => !Number.isSafeInteger(event.promptTokens) || !Number.isSafeInteger(event.completionTokens))
        || ends.reduce((n, event) => n + Number(event.promptTokens), 0) !== r.promptTokens
        || ends.reduce((n, event) => n + Number(event.completionTokens), 0) !== r.completionTokens) break;
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += r[key];
      if (totals.billedMicrousd > e.budgets.costMicrousd || totals.promptTokens > e.budgets.promptTokens
        || totals.completionTokens > e.budgets.completionTokens || totals.modelDispatches > e.budgets.modelDispatches
        || totals.calendarRequests > e.budgets.calendarRequests || totals.refreshRequests > e.budgets.refreshRequests) break;
      check();
      row.models = analysis.models;
      row.outcome = 'synthetic-success';
    }
    if (records.length === 2 && records.every(row => row.outcome === 'synthetic-success')) result.outcome = 'synthetic-complete';
  } catch { /* Payload-free stop; unknown real billing and outstanding work remain unknown. */ }
  finally { clearTimeout(timer); stop.abort(); }
  return result;
}
