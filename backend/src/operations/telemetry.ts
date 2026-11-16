/**
 * ============================================================================
 * FILE: telemetry.ts
 * LOCATION: backend/src/operations/telemetry.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Emit allowlisted pseudonymous logs and finite aggregate metric cells.
 *
 * ROLE IN PROJECT:
 *    Correlates server request IDs with hashed scope identifiers while
 *    refusing transcripts, secrets, stacks, and unbounded label cardinality.
 *
 * KEY COMPONENTS:
 *    - Telemetry: Async request/turn context, redacted events, bounded metrics.
 *    - METRICS: Fixed operational observation slots shared by later adapters.
 * ============================================================================
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { DiagnosticScope } from '../chat-runtime/ports.js';
import { APP_ERROR_CODES } from '../contracts/errors.js';
import { redactSecrets } from '../platform/security/redact.js';
import { DATABASE_COLLECTIONS, type DatabasePhase, type DatabaseOrigin,
  type DatabaseCollection, type DatabaseCommand } from '../persistence/database-observation.js';
const ENUMS: Readonly<Record<string, readonly string[]>> = {
  stage: ['admission', 'acceptance-durable', 'admission-returned', 'stream-open', 'stream-header',
    'first-feedback', 'context', 'model-dispatch',
    'model-response', 'model-decision',
    'model-first-event', 'model-first-output', 'model-first-text', 'model-stream-end', 'model-complete',
    'validation', 'cursor', 'authority', 'cache', 'tool-execution', 'provider-request',
     'provider-response', 'correction', 'persistence', 'finalization',
     'attempt-terminal-durable', 'slot-release', 'slot-released', 'terminal-delivered',
     'task-outcome', 'runtime-error', 'terminal'],
  state: ['start', 'ok', 'rejected', 'error', 'skipped'],
  failureKind: ['application', 'type', 'validation', 'unexpected'],
  tool: ['calendar_list_events', 'calendar_get_event', 'calendar_create_event',
    'calendar_list_calendars', 'calendar_check_availability'],
  schemaRevision: ['google-calendar.v1', 'google-calendar.v2'],
  dispatchKind: ['initial', 'continuation', 'schema-repair'],
  decisionKind: ['tool', 'text', 'rejected', 'failure'],
  provider: ['openrouter', 'google-calendar'],
  requestKind: ['model', 'list', 'get', 'create', 'readback', 'availability',
    'preflight', 'discovery', 'capability-recheck'],
  origin: ['none', 'local', 'cache', 'provider'],
  delivery: ['not-sent', 'attempted', 'response-received', 'unknown'],
  reason: ['malformed-json', 'duplicate-key', 'missing', 'unknown-field', 'wrong-type',
    'out-of-range', 'invalid-value', 'invalid-envelope', 'truncated', 'depth-limit',
    'cardinality', 'duplicate-call', 'cursor-format', 'cursor-signature', 'cursor-scope',
    'cursor-expired', 'access-denied', 'provider-4xx', 'provider-5xx', 'provider-error',
    'budget-exhausted', 'cancelled', 'persistence-error', 'unclassified'],
  expected: ['object', 'string', 'integer', 'array', 'bounded-value', 'complete-json',
    'native-envelope', 'one-call', 'valid-cursor'],
  constraint: ['type', 'required', 'no-extra-fields', 'min', 'max', 'unique', 'rfc3339',
    'time-order', 'max-window', 'iana-zone', 'valid-id', 'signed-cursor', 'json',
    'native-envelope', 'one-call'],
  suppliedType: ['missing', 'null', 'boolean', 'number', 'string', 'array', 'object', 'unavailable'],
  presence: ['missing', 'present', 'unavailable'],
  statusClass: ['2xx', '3xx', '4xx', '5xx', 'other'],
   persistenceKind: ['read', 'write', 'checkpoint'],
  chat: ['completed', 'truncated', 'failed', 'cancelled', 'interrupted', 'unknown'],
  task: ['success', 'clarification', 'fallback', 'denied', 'failed', 'cancelled',
    'uncertain', 'not-applicable', 'unknown'],
  writeCertainty: ['not-applicable', 'not-sent', 'confirmed', 'unknown'],
};
const FIELDS = new Set(['$', 'tool_calls', 'tool_calls.id', 'tool_calls.name',
  'tool_calls.arguments', 'timeMin', 'timeMax', 'maxResults', 'pageToken', 'eventId',
  'summary', 'start', 'end', 'timeZone', 'description', 'location', 'calendarId', 'calendarIds']);
const CALENDAR_CODES = new Set<string>([
  'CALENDAR_INPUT_REJECTED', 'CALENDAR_ARGUMENTS_INVALID', 'CALENDAR_EXECUTION_DENIED',
  'CALENDAR_FORBIDDEN', 'CALENDAR_UNKNOWN_TOOL', 'UNKNOWN_OR_DISABLED_TOOL',
  'FORBIDDEN_TOOL_FIELD', 'EXECUTION_BINDING_REQUIRED', 'STRUCTURAL_VALIDATION_FAILED',
  'TIMED_EVENT_REQUIRED', 'TIME_REQUIRES_CLARIFICATION', 'SUMMARY_REQUIRES_CLARIFICATION',
  'CALENDAR_TARGET_UNKNOWN', 'CALENDAR_TARGET_AMBIGUOUS', 'CALENDAR_DEFAULT_UNAVAILABLE',
  'CALENDAR_PRIMARY_MISSING', 'CALENDAR_TARGET_READ_ONLY', 'CALENDAR_TARGET_REQUIRED',
  'CALENDAR_TARGET_NOT_OWNED', 'CALENDAR_RECONNECT_REQUIRED', 'RECONNECT_REQUIRED',
  'CALENDAR_RESPONSE_INVALID', 'CALENDAR_RESPONSE_TOO_LARGE', 'CALENDAR_RESULT_TOO_LARGE',
  'CALENDAR_UNSUPPORTED_CONTENT', 'CALENDAR_TEMPORARILY_UNAVAILABLE', 'CALENDAR_CANCELLED',
  'CALENDAR_REQUEST_NOT_ADMITTED', 'CALENDAR_DEADLINE_EXCEEDED', 'CALENDAR_REQUEST_BUDGET',
  'CALENDAR_RATE_LIMITED', 'CALENDAR_QUOTA_EXCEEDED', 'EVENT_NOT_FOUND', 'EVENT_GONE',
  'EVENT_ID_CONFLICT', 'WRITE_OUTCOME_UNKNOWN', 'OPERATION_AUTHORITY_REQUIRED',
  'OPERATION_AUTHORITY_MISMATCH', 'MODEL_SPEND_EXCEEDED', 'ARGUMENT_BUDGET_EXCEEDED',
  'DIAGNOSTIC_BUDGET_EXCEEDED', 'REPAIR_EXHAUSTED', 'EVIDENCE_MISSING', 'EVIDENCE_EXPIRED',
  'INFERENCE_OUTCOME_UNKNOWN', 'TURN_DEADLINE_EXCEEDED',
]);
export const METRICS = ['request','admitted','rate_rejected','overload_rejected','dedup_hit',
  'first_output','total_run','failure','interruption','checkpoint','write','finalization',
  'reconciliation','reconciliation_failure','accounting_known','accounting_pending',
  'accounting_unknown','shutdown','log_failure','read','checkpoint_read','ownership_queue',
  'driver_read','driver_write','stream_header','stream_first_feedback','event_loop_delay',
  'mongo_read','mongo_write','mongo_other','mongo_failed','mongo_pool_wait',
  'mongo_unattributed','mongo_observation_dropped'] as const;
export type Metric = typeof METRICS[number];
type Cell = { count:number; sumMs:number; maxMs:number };
export type LatencyBuckets = { le10Ms:number; le50Ms:number; le250Ms:number; le1000Ms:number; gt1000Ms:number };
type TurnDriverCounter = { driverReads:number; driverWrites:number };
const DATABASE_PHASES: readonly DatabasePhase[] = ['admission','attachment','context','model-observation',
  'tool-evidence','seal','publication','release','recovery','other'];
const DATABASE_ORIGINS: readonly DatabaseOrigin[] = ['repository','ownership','checkpoint','other'];
type DatabaseCounter = { read:number; write:number; other:number; failed:number;
  phases:Record<DatabasePhase,number>; phaseMs:Record<DatabasePhase,number>; origins:Record<DatabaseOrigin,number>;
  collections:Record<DatabaseCollection,number>;
  operationSumMs:number; busyMs:number; active:number; lastIntervalAt:number | null;
  details:Array<{ id:number; kind:'read'|'write'|'other'; command:DatabaseCommand; phase:DatabasePhase; origin:DatabaseOrigin; collection:DatabaseCollection; durationMs:number; failed:boolean }>;
  droppedDetails:number };
function emptyDatabaseCounter():DatabaseCounter {
  return { read:0, write:0, other:0, failed:0,
    operationSumMs:0, busyMs:0, active:0, lastIntervalAt:null, details:[], droppedDetails:0,
    phases:Object.fromEntries(DATABASE_PHASES.map(v => [v,0])) as Record<DatabasePhase,number>,
    phaseMs:Object.fromEntries(DATABASE_PHASES.map(v => [v,0])) as Record<DatabasePhase,number>,
    collections:Object.fromEntries(DATABASE_COLLECTIONS.map(v => [v,0])) as Record<DatabaseCollection,number>,
    origins:Object.fromEntries(DATABASE_ORIGINS.map(v => [v,0])) as Record<DatabaseOrigin,number> };
}
function advanceDatabaseIntervals(counter:DatabaseCounter, now:number):void {
  if (counter.active && counter.lastIntervalAt !== null) {
    const elapsed = Math.max(0, now-counter.lastIntervalAt);
    counter.busyMs += elapsed;
    counter.operationSumMs += elapsed * counter.active;
  }
  counter.lastIntervalAt = now;
}
export class Telemetry {
  private context = new AsyncLocalStorage<Record<string,string>>();
  private turnCounters = new WeakMap<Record<string,string>, TurnDriverCounter>();
  private databaseCounters = new WeakMap<Record<string,string>, DatabaseCounter>();
  private cells = Object.fromEntries(METRICS.map(k => [k,{ count:0,sumMs:0,maxMs:0 }])) as Record<Metric,Cell>;
  private histograms = Object.fromEntries(METRICS.map(k => [k,{ le10Ms:0,le50Ms:0,le250Ms:0,le1000Ms:0,gt1000Ms:0 }])) as Record<Metric,LatencyBuckets>;
  private loopDelay = (() => {
    try {
      const h = monitorEventLoopDelay({ resolution: 20 });
      h.enable();
      return h;
    } catch {
      return null;
    }
  })();
  constructor(private sink:(line:string) => void, readonly now:() => number = Date.now) {}
  monotonic() { return performance.now(); }
  inRequest<T>(requestId:string, job:() => T):T {
    const context = { requestId };
    this.databaseCounters.set(context, emptyDatabaseCounter());
    return this.context.run(context, job);
  }
  inDatabaseRequest<T>(job:() => T):T {
    const context = { ...this.context.getStore() };
    this.databaseCounters.set(context, emptyDatabaseCounter());
    return this.context.run(context, job);
  }
  captureDatabaseScope(): (job: () => void) => void {
    const scope = this.context.getStore();
    return job => scope ? this.context.run(scope, job) : this.context.exit(job);
  }
  inTurn<T>(scope:{ sessionId:string; turnId:string; attemptId:string }, job:() => T):T {
    const prev = this.context.getStore();
    const next = { ...prev, ...scope };
    this.turnCounters.set(next, { driverReads: 0, driverWrites: 0 });
    const counter = prev && this.databaseCounters.get(prev);
    this.databaseCounters.set(next, counter ?? emptyDatabaseCounter());
    return this.context.run(next, job);
  }
  inDatabasePhase<T>(phase:DatabasePhase, origin:DatabaseOrigin, job:() => T):T {
    const prev = this.context.getStore();
    const next = { ...prev, databasePhase:phase, databaseOrigin:origin };
    const db = prev && this.databaseCounters.get(prev);
    const driver = prev && this.turnCounters.get(prev);
    if (db) this.databaseCounters.set(next, db);
    if (driver) this.turnCounters.set(next, driver);
    return this.context.run(next, job);
  }
  inDatabaseOrigin<T>(origin:DatabaseOrigin, job:() => T):T {
    const phase = DATABASE_PHASES.find(value => value === this.context.getStore()?.databasePhase) ?? 'other';
    return this.inDatabasePhase(phase, origin, job);
  }
  beginMongoInterval(): () => void {
    const scope = this.context.getStore();
    const counter = scope && this.databaseCounters.get(scope);
    if (!counter) return () => undefined;
    const started = this.monotonic();
    advanceDatabaseIntervals(counter, started);
    counter.active++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      const now = this.monotonic();
      advanceDatabaseIntervals(counter, now);
      if (--counter.active === 0) counter.lastIntervalAt = null;
    };
  }
  recordMongoCommand(kind:'read'|'write'|'other', duration:number, failed:boolean,
    collection:DatabaseCollection = 'other', command:DatabaseCommand = 'other'):void {
    this.measure(kind === 'read' ? 'mongo_read' : kind === 'write' ? 'mongo_write' : 'mongo_other', duration);
    if (failed) this.measure('mongo_failed', duration);
    const scope = this.context.getStore();
    const counter = scope && this.databaseCounters.get(scope);
    if (counter) {
      const durationMs = Number.isFinite(duration) ? Math.max(0, Math.min(duration, 3600000)) : 0;
      counter[kind] = Math.min(1000000, counter[kind]+1);
      if (failed) counter.failed = Math.min(1000000, counter.failed+1);
      const phase = DATABASE_PHASES.find(value => value === scope.databasePhase) ?? 'other';
      const origin = DATABASE_ORIGINS.find(value => value === scope.databaseOrigin) ?? 'other';
      counter.phases[phase] = Math.min(1000000, counter.phases[phase]+1);
      counter.phaseMs[phase] = Math.min(3600000, counter.phaseMs[phase]+durationMs);
      counter.origins[origin] = Math.min(1000000, counter.origins[origin]+1);
      counter.collections[collection] = Math.min(1000000, counter.collections[collection]+1);
      if (counter.details.length < 128) counter.details.push({ id:counter.details.length+1, kind, command, phase, origin, collection,
        durationMs, failed });
      else counter.droppedDetails = Math.min(1000000,counter.droppedDetails+1);
    } else this.measure('mongo_unattributed');
  }
  databaseCounts():DatabaseCounter & { overlapMs:number } {
    const scope = this.context.getStore();
    const counter = scope && this.databaseCounters.get(scope);
    const result = counter ? { ...counter, phases:{ ...counter.phases }, phaseMs:{ ...counter.phaseMs }, origins:{ ...counter.origins },
      collections:{ ...counter.collections }, details:counter.details.map(detail => ({ ...detail })) } : emptyDatabaseCounter();
    if (result.active) advanceDatabaseIntervals(result, this.monotonic());
    return { ...result, overlapMs:Math.max(0, result.operationSumMs - result.busyMs) };
  }
  inDiagnosticScope<T>(scope: DiagnosticScope, work: () => T): T {
    const prev = this.context.getStore();
    const next = { ...prev };
    for (const [name, value] of Object.entries(scope)) if (typeof value === 'string') next[name] = value;
    if (prev) {
      const counter = this.turnCounters.get(prev);
      if (counter) this.turnCounters.set(next, counter);
      const dbCounter = this.databaseCounters.get(prev);
      if (dbCounter) this.databaseCounters.set(next, dbCounter);
      else if (scope.sessionId || scope.databasePhase) this.databaseCounters.set(next, emptyDatabaseCounter());
    } else if (scope.sessionId || scope.databasePhase) {
      this.databaseCounters.set(next, emptyDatabaseCounter());
    }
    return this.context.run(next, work);
  }
  measure(metric:Metric, ms=0) {
    const value = Number.isFinite(ms) ? Math.max(0, Math.min(ms,3600000)) : 0;
    const c = this.cells[metric]; c.count = Math.min(Number.MAX_SAFE_INTEGER,c.count+1);
    c.sumMs = Math.min(Number.MAX_SAFE_INTEGER,c.sumMs+value); c.maxMs = Math.max(c.maxMs,value);
    const b = this.histograms[metric];
    if (value <= 10) b.le10Ms = Math.min(Number.MAX_SAFE_INTEGER, b.le10Ms + 1);
    else if (value <= 50) b.le50Ms = Math.min(Number.MAX_SAFE_INTEGER, b.le50Ms + 1);
    else if (value <= 250) b.le250Ms = Math.min(Number.MAX_SAFE_INTEGER, b.le250Ms + 1);
    else if (value <= 1000) b.le1000Ms = Math.min(Number.MAX_SAFE_INTEGER, b.le1000Ms + 1);
    else b.gt1000Ms = Math.min(Number.MAX_SAFE_INTEGER, b.gt1000Ms + 1);
  }
  recordDriverCommand(kind: 'read' | 'write', ms = 0) {
    this.measure(kind === 'read' ? 'driver_read' : 'driver_write', ms);
    const store = this.context.getStore();
    const counter = store ? this.turnCounters.get(store) : undefined;
    if (counter) {
      if (kind === 'read') counter.driverReads = Math.min(1000000, counter.driverReads + 1);
      else counter.driverWrites = Math.min(1000000, counter.driverWrites + 1);
    }
  }
  turnDriverCounts(): TurnDriverCounter {
    const store = this.context.getStore();
    const counter = store ? this.turnCounters.get(store) : undefined;
    return counter ? { ...counter } : { driverReads: 0, driverWrites: 0 };
  }
  sampleEventLoopDelay(): number {
    if (!this.loopDelay) return 0;
    const rawNs = this.loopDelay.max;
    const delayMs = Number.isFinite(rawNs) && rawNs > 0
      ? Math.max(0, Math.min(3600000, Math.round((rawNs / 1e6) * 100) / 100))
      : 0;
    this.loopDelay.reset();
    this.measure('event_loop_delay', delayMs);
    return delayMs;
  }
  event(kind:'request'|'attempt'|'accounting'|'readiness'|'recovery'|'shutdown'|'calendar'|'process', fields:unknown = {}) {
    try {
      const f = fields && typeof fields === 'object' ? fields as Record<string,unknown> : {};
      const record:Record<string,unknown> = { kind, at:new Date(this.now()).toISOString() };
      const context = this.context.getStore() ?? {};
      const requestId = context.requestId;
      if (requestId && /^[a-f0-9-]{36}$/.test(requestId)) record.requestId = requestId;
      for (const key of ['sessionId','turnId','attemptId','generationId',
        'dispatchId','decisionId','toolCallId','operationId','connectionId','providerRequestId'] as const) {
        const value = f[key] ?? context[key];
        if (typeof value === 'string' && value.length > 0 && value.length <= 200)
          record[key] = `h:${createHash('sha256').update(value).digest('hex').slice(0,24)}`;
      }
      if (typeof f.phase === 'string' && ['validating','repairing','executing','reconciling'].includes(f.phase))
        record.phase = f.phase;
      if (f.accountingStatus === 'known' || f.accountingStatus === 'pending' || f.accountingStatus === 'unknown') {
        record.accountingStatus = f.accountingStatus;
      }
      if (typeof f.ok === 'boolean') record.ok = f.ok;
      if (typeof f.terminalCallbackReturned === 'boolean') record.terminalCallbackReturned = f.terminalCallbackReturned;
      if (kind === 'process') {
        record.diagnosticVersion = 1;
        record.clockMs = performance.now();
        record.clockOriginMs = performance.timeOrigin;
        for (const [name, allowed] of Object.entries(ENUMS)) {
          const value = f[name] ?? context[name];
          if (typeof value === 'string' && allowed.includes(value)) record[name] = value;
        }
        if (!record.stage) return;
        if (typeof f.field === 'string') record.field = FIELDS.has(f.field) ? f.field : '$';
        const fingerprint = f.schemaFingerprint ?? context.schemaFingerprint;
        if (typeof fingerprint === 'string' && /^[a-f0-9]{64}$/u.test(fingerprint)) record.schemaFingerprint = fingerprint;
        for (const name of ['durationMs', 'limit', 'correctionAttempt', 'correctionLimit',
           'promptTokens', 'completionTokens', 'cachedPromptTokens', 'reasoningOutputTokens',
           'driverReads', 'driverWrites', 'mongoReads', 'mongoWrites', 'mongoFailures', 'mongoBusyMs', 'mongoOverlapMs', 'eventLoopDelayMs'] as const) {
          const value = f[name];
          if (typeof value !== 'number' || !Number.isFinite(value)) continue;
          if ((name.startsWith('correction') || name.startsWith('driver') || (name.startsWith('mongo') && !name.endsWith('Ms'))) && !Number.isInteger(value)) continue;
          const ceiling = name.endsWith('Ms') ? 3600000
            : name === 'limit' ? 1048576
            : name.startsWith('driver') || name.startsWith('mongo') ? 1000000
            : name.endsWith('Tokens') ? 10000000 : 1000;
          record[name] = Math.max(0, Math.min(value, ceiling));
        }
      }
      if (typeof f.code === 'string' && (APP_ERROR_CODES.some(code => code === f.code)
        || ((kind === 'process' || kind === 'calendar') && CALENDAR_CODES.has(f.code)))) record.code = f.code;
      if (kind === 'process') {
        record.summary = ['stage', 'state', 'tool', 'reason', 'code', 'field', 'expected', 'constraint',
          'limit', 'suppliedType', 'presence', 'origin', 'delivery', 'correctionAttempt', 'correctionLimit',
          'chat', 'task', 'writeCertainty', 'durationMs', 'driverReads', 'driverWrites', 'eventLoopDelayMs']
          .filter(name => record[name] !== undefined)
          .map(name => `${name}=${record[name]}`).join(' ').slice(0, 512);
      }
      const line = JSON.stringify(redactSecrets(record));
      if (Buffer.byteLength(line, 'utf8') > 4096) { this.measure('log_failure'); return; }
      this.sink(line);
    } catch { this.measure('log_failure'); }
  }
  snapshot():Record<Metric,Cell> {
    return Object.fromEntries(METRICS.map(k => [k,{ ...this.cells[k] }])) as Record<Metric,Cell>;
  }
  distribution():Record<Metric,LatencyBuckets> {
    return Object.fromEntries(METRICS.map(k => [k,{ ...this.histograms[k] }])) as Record<Metric,LatencyBuckets>;
  }
}

const STDOUT_KINDS = new Set(['readiness', 'recovery', 'shutdown']);
// Fixed milestones per bounded turn/dispatch, never deltas or PCM frames. Keep
// normal logs useful for latency attribution without requiring debug logging.
const STDOUT_PROCESS_STAGES = new Set(['terminal', 'task-outcome', 'runtime-error',
  'acceptance-durable', 'admission-returned', 'model-dispatch', 'model-response',
  'model-first-event', 'model-first-output', 'model-first-text', 'model-stream-end',
  'model-complete', 'finalization', 'attempt-terminal-durable']);
const STDOUT_PROCESS_STATES = new Set(['error', 'rejected']);
const STDOUT_VOICE_ACTIONS = new Set(['warn', 'stop', 'speech-degraded']);
const STDOUT_VOICE_STAGES = new Set(['stt-end-of-turn', 'response-prepared',
  'tts-first-submit', 'tts-first-audio', 'delivery-settled']);

export function shouldWriteStdoutLog(line: string, level?: string): boolean {
  if (level === 'debug') return true;
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    const kind = record.kind;
    if (typeof kind === 'string' && STDOUT_KINDS.has(kind)) return true;
    if (kind === 'request' || kind === 'attempt') return record.ok === false;
    if (kind === 'process') {
      return (typeof record.state === 'string' && STDOUT_PROCESS_STATES.has(record.state))
        || (typeof record.stage === 'string' && STDOUT_PROCESS_STAGES.has(record.stage));
    }
    if (kind === 'voice-usage')
      return typeof record.action === 'string' && STDOUT_VOICE_ACTIONS.has(record.action);
    if (kind === 'voice-pipeline') return typeof record.code === 'string'
      || (typeof record.stage === 'string' && STDOUT_VOICE_STAGES.has(record.stage));
    return false;
  } catch { return false; }
}

export function writeStdoutLog(line: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!shouldWriteStdoutLog(line, env.AURVIN_LOG_LEVEL)) return;
  if (!process.stdout.writableNeedDrain) process.stdout.write(`${line}\n`);
}
