# Backend Process Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explain a backend chat's admission, model/tool decisions, failures, external delivery and durable outcome using one safe correlated trace, without changing Calendar behavior.

**Architecture:** Extend the existing `Telemetry` projection and AsyncLocalStorage scope; inject a small optional diagnostic port into the existing runtime and adapters. Observe facts at their original boundaries, before coarse public failures discard them, and report chat delivery separately from Calendar execution and write certainty. Keep JSON Lines on the existing sink, with a short readable summary built only from projected fields; add no dependency, queue, logging platform, persistent schema or P2 simplification.

**Tech Stack:** Existing TypeScript/NodeNext, NestJS, Node AsyncLocalStorage/crypto, Zod validation and Vitest offline production-assembly fixtures.

---

## Execution boundary and prerequisite checks

This is **P1 only**, covering AC1–AC4 and the diagnostic contract handed to P2 for AC9. P2 planning waits for P1's verified implementation commits and diagnostic evidence, not this document. Read [goal.md](goal.md), [state.md](state.md), [research.md](research.md), root [AGENTS.md](../../AGENTS.md) and the source paths below. In this harness the worker loads `executing-plans` and `test-driven-development`; work as the assigned MAW worker, without nested delegation. Unified review is **skipped**, not passed. Do not create `plan2.md`, edit `state.md`, dispatch a reviewer, or implement Calendar simplification.

Source baseline: `de68b1e`. Planning inspection found HEAD `b61de04`, with only the tracked deletion of the earlier `plan1.md`; `state.md` still referenced old plan commit `8c7c06e`. This replacement plan does not alter that state. The orchestrator must record the replacement plan commit and confirm the worker's baseline. Workflow-document commits after `de68b1e` are not implementation evidence.

- [x] Run `git status --porcelain=v1 --untracked-files=all`, `git diff --cached --name-only`, and `git log -6 --oneline` separately at repository root. Preserve intervening edits and `.openchamber/`; stop and obtain an attributable boundary from the orchestrator if owned source paths are dirty. Do not switch branch/worktree or absorb unrelated changes.
- [x] Confirm P1 owns shared paths until handoff: runtime/Calendar loop, ports, adapters and `app.service.ts`. Add diagnostic plumbing only in these files. No changes to advertised tools, argument acceptance, cursors, retry/correction policy, prompts, OAuth scopes, authority, accounting, receipts, checkpoint schemas, transcript/stream content, or database schema.
- [x] Use named files for every commit, serialize index operations with the orchestrator, and tick this plan's steps as finished. No `git add .`, broad format pass, lockfile changes or new dependency. New code files need the mandatory header; add one to an existing headerless code file when changing more than 30%.

## Source map and ownership

All paths are relative to repository root. Existing entry points—not a second runtime, logger or persistence owner—are the insertion points.

| Exact path | P1 change and boundary |
| --- | --- |
| `backend/src/operations/telemetry.ts` | Fixed diagnostic projection, pseudonymous correlation, bounded records, readable safe summary and best-effort sink. Preserve existing metrics and legacy event behavior. |
| `backend/src/operations/observed-runtime.ts` | Admission and stream-delivery observations; retain existing delegation, metrics and readiness semantics. |
| `backend/src/operations/observe-persistence.ts` | Add payload-free success/failure timing at the existing proxy, not another persistence decorator. |
| `backend/src/chat-runtime/ports.ts` | The optional diagnostic port and safe callback helper defined below; no HTTP/durable contract changes. |
| `backend/src/chat-runtime/durable-chat-runtime.ts` | Context, durable acceptance/finalization, recovery observations and removal of raw stack printing. |
| `backend/src/chat-runtime/calendar-loop.ts` | Decision/tool/correction observations and transient task/write classification; no execution simplification. |
| `backend/src/app.service.ts` | Initialize the existing telemetry before Calendar assembly and inject the same port into assembly/runtime. |
| `backend/src/operations/calendar-assembly.ts` | Pass the hook into existing provider/tools/connections; keep the current embedded execution adapter. |
| `backend/src/model/calendar-adapter.ts` | Actual model dispatch/response, safe provider identifiers and hook forwarding. |
| `backend/src/model/calendar-stream.ts` | Forward one optional callback to candidate validation; no parsing/result changes. |
| `backend/src/model/calendar-validation.ts` | Emit safe original scanner/Zod issue facts without modifying repair evidence. |
| `backend/src/model/openrouter-adapter.ts`, `backend/src/model/index.ts` | Equivalent ordinary-chat model-boundary observations; retain all existing retries/accounting. |
| `backend/src/plugins/google-calendar/calendar-api-cursor.ts` | Precise transient cursor rejection classes; preserve public faults and token checks. |
| `backend/src/plugins/google-calendar/tools-validation.ts` | Safe facts at semantic validation guards, retaining the exact fault/retry behavior. |
| `backend/src/plugins/google-calendar/tools.ts` | Hook forwarding, actual executor result origin and the out-of-range list-offset guard. |
| `backend/src/plugins/google-calendar/calendar-api-http.ts` | Emit only at actual fetch/response/fault boundaries; no claim that invocation proves provider receipt. |
| `backend/src/plugins/google-calendar/calendar-api.ts` | Forward hooks through all eight `calendarHttp` sites and both cursor decode paths. |
| `backend/src/plugins/google-calendar/calendar-discovery-api.ts`, `backend/src/plugins/google-calendar/calendar-availability-api.ts` | Forward hooks at their one HTTP site each; safe local validation facts where these adapters reject. |
| `backend/src/plugins/google-calendar/discovery.ts`, `backend/src/plugins/google-calendar/connection.ts` | Actual `ensureFresh` hit/refresh observations; forward the hook through existing discovery construction. |
| `backend/test/operations/telemetry.spec.ts`, `backend/test/operations/runtime.spec.ts`, `backend/test/operations/persistence.spec.ts` | Projection, ALS/concurrency, delivery observation, no-throw and persistence regressions. |
| `backend/test/model/calendar-validation.spec.ts`, `backend/test/model/calendar-adapter.spec.ts` | Exact rejected-field facts, unchanged repair records, model fetch and identity observations. |
| `backend/test/plugins/google-calendar/calendar-api-cursor.spec.ts`, `backend/test/plugins/google-calendar/calendar-api-http.spec.ts`, `backend/test/plugins/google-calendar/tools-validation.spec.ts` | Cursor classes, semantic validation, real delivery seam and failure isolation. |
| `backend/test/assembly/calendar-fixture.ts`, new `backend/test/assembly/calendar-observability.spec.ts` | Real `AppService` plus production runtime/model/executor path with deterministic providers and captured logs. |
| `backend/test/assembly/calendar-flow.spec.ts`, `backend/test/runtime/calendar-runtime.fixture.ts` | HTTP request-to-stream correlation assertions and a fail-closed exact-origin fixture guard; no production transport changes. |
| `backend/test/runtime/calendar-feedback.spec.ts`, `backend/test/runtime/calendar-answer-regressions.spec.ts`, `backend/test/runtime/calendar-recovery.spec.ts` | Add assertions to the existing correction/fallback/recovery cases; preserve baseline tests. |
| New `docs/calendar-visibility-simplification/observability.md` | Implemented contract, synthetic reproducer/trace, operator instructions, evidence gaps and P2 handoff. |

`backend/src/chat-runtime/calendar-ports.ts` need not change: the current model-factory types use `typeof createCalendarModelPort[V2]` and pick up an optional final callback argument automatically. No persistence, wire or frontend type needs to change. If inspection during implementation disproves these boundaries, stop for ownership reconciliation rather than adding a generalized framework.

## Diagnostic contract v1 — freeze before P2 handoff

Use `Telemetry.event('process', fields)` for the new lifecycle records; existing `calendar` progress records stay compatible. This is one additional event-kind literal in the existing logger, not another event system. All fields below are optional when unknown, except `stage` on a process event. Never manufacture later-stage evidence.

| Field | Closed projection / meaning |
| --- | --- |
| `diagnosticVersion` | Fixed `1`; independent of Calendar/persistent schema revisions. |
| `stage` | `admission`, `context`, `model-dispatch`, `model-response`, `model-decision`, `validation`, `cursor`, `authority`, `cache`, `tool-execution`, `provider-request`, `provider-response`, `correction`, `persistence`, `finalization`, `task-outcome`, `runtime-error`, `terminal`. `runtime-error` is the general execution catch, not a claim that an earlier-stage error happened in finalization. No MCP/transport-specific stage required by P2. |
| `state` | `start`, `ok`, `rejected`, `error`, `skipped`; start is not success. |
| Correlation | Existing validated server `requestId`; hash `sessionId`, `turnId`, `attemptId`, `dispatchId`, `decisionId`, `toolCallId`, `operationId`, `generationId`, `providerRequestId`. Hash nonempty strings of at most 200 characters with the existing `h:` + 24 hex scheme; never log raw values. Scope IDs are application-owned, never copied from client headers. |
| `tool` | Only the five names in existing `CALENDAR_TOOLS`; unknown names are omitted. |
| `schemaRevision` | Only `google-calendar.v1` / `google-calendar.v2`. Also emit `schemaFingerprint` = SHA-256 of the actual static tools/schema catalogue, not arguments. Compute once from safe schema definitions; never hash user content into logs. |
| `dispatchKind`, `decisionKind` | `initial` / `continuation` / `schema-repair`; `tool` / `text` / `rejected` / `failure`. |
| `provider`, `requestKind` | `openrouter` / `google-calendar`; `model`, `list`, `get`, `create`, `readback`, `availability`, `preflight`, `discovery`, `capability-recheck`. These are fixed labels, never URLs. |
| `origin` | `none`, `local`, `cache`, `provider`. Describes this observation, not all preceding work. A refreshed snapshot may have both a provider fetch and a later local projection. |
| `delivery` | `not-sent`, `attempted`, `response-received`, `unknown`. `attempted` means fetch invoked, not proof of remote receipt; a response does not prove a write succeeded. Never call embedded MCP delivery a Google request. |
| `reason` | `malformed-json`, `duplicate-key`, `missing`, `unknown-field`, `wrong-type`, `out-of-range`, `invalid-value`, `invalid-envelope`, `truncated`, `depth-limit`, `cardinality`, `duplicate-call`, `cursor-format`, `cursor-signature`, `cursor-scope`, `cursor-expired`, `access-denied`, `provider-4xx`, `provider-5xx`, `provider-error`, `budget-exhausted`, `cancelled`, `persistence-error`, `unclassified`. No exception prose. |
| `code` | Existing `APP_ERROR_CODES` plus a fixed Calendar code set in Task 1. Never accept arbitrary uppercase strings via the broad `calendarFailureSchema` regex. |
| `field` | `$`, `tool_calls`, `tool_calls.id`, `tool_calls.name`, `tool_calls.arguments`, `timeMin`, `timeMax`, `maxResults`, `pageToken`, `eventId`, `summary`, `start`, `end`, `timeZone`, `description`, `location`, `calendarId`, `calendarIds`. Unknown property names map to `$`, not truncation/hash. |
| `expected`, `constraint`, `limit` | Expected JSON/semantic kind from a fixed enum: `object`, `string`, `integer`, `array`, `bounded-value`, `complete-json`, `native-envelope`, `one-call`, `valid-cursor`; constraint `type`, `required`, `no-extra-fields`, `min`, `max`, `unique`, `rfc3339`, `time-order`, `max-window`, `iana-zone`, `valid-id`, `signed-cursor`, `json`, `native-envelope`, `one-call`. Optional numeric `limit` is an actual schema/policy bound, never the supplied value, finite and clamped to `[0, 1048576]`. |
| `suppliedType`, `presence` | `missing`, `null`, `boolean`, `number`, `string`, `array`, `object`, `unavailable`; `missing`, `present`, `unavailable`. Determine only from already-parsed data at a known allowlisted field. Scanner failures use `unavailable`; unknown fields describe the root object, not the unknown key/value. |
| `correctionAttempt`, `correctionLimit` | Actual `budget.repairs` and `ctx.limits.repairs`, not an invented retry counter; finite integers clamped to `[0, 1000]`. Initial rejection has repairs-used 0. |
| `durationMs`, `statusClass` | Finite nonnegative duration clamped to one hour; `2xx`, `3xx`, `4xx`, `5xx`, `other`. No body/header dump. |
| `persistenceKind` | `write` / `checkpoint`, selected by the existing proxy's fixed metric, never arbitrary method names. |
| `chat` | Durable/application delivery `completed`, `truncated`, `failed`, `cancelled`, `interrupted`, `unknown`. `unknown` covers a finalization gap; do not invent a failed terminal when saved results need reconciliation. |
| `task`, `writeCertainty` | `success`, `clarification`, `fallback`, `denied`, `failed`, `cancelled`, `uncertain`, `not-applicable`, `unknown`; `not-applicable`, `not-sent`, `confirmed`, `unknown`. Separate from `chat`. `success` means a verified successful Calendar execution, not proof the model answered ownership correctly or that a list is exhaustive. |
| `summary` | At most 512 characters, built from projected fields only. A readable explanation in the same JSON record, not a second raw log. |

No raw prompts, messages, reasoning, arguments, argument hashes, results, event text, user/account/calendar/event IDs, cursors, URLs, arbitrary names, tokens, credentials, authorization headers, provider error bodies, exception messages or stacks. Pseudonymization is linkable, not anonymization. A schema fingerprint is content-independent; user-argument hashes are explicitly excluded.

Hard record ceiling: 4096 UTF-8 bytes. Project fixed scalars only and discard unknown keys; do not stringify input objects or coerce fields using `String(value)`. On an impossible oversized projected record, drop it and increment existing `log_failure`, without recursing or emitting misleading budget errors. No detailed-payload mode exists: development and production use the same safe projection, and a supplied detail flag cannot enable logging content. No new event queue or per-ID metrics/map. Emit no per-token, per-SSE-frame, per-result-entry or per-argument-character record. At most `min(limits.diagnosticCount, 10)` validation observations per rejected decision; other observations occur only at bounded existing dispatch/tool/request/state boundaries. Tests must exercise maximum permitted loop budgets and stable metric keys.

The two-method port below is just the existing synchronous callback plus the existing ALS scoped runner. Scope has no sink operations. `run` must execute work **once**, preserving its return/rejection; never catch an action failure and rerun it as a logging fallback. Catch callback/sink failures, never swallow business failures. Do not add subscriptions, dynamic event registration, decorators, generic spans or another ALS instance.

## Task 1: projection, privacy and a minimal hook (AC1, AC2, AC4)

**Files:** `backend/src/operations/telemetry.ts`, `backend/src/chat-runtime/ports.ts`, `backend/test/operations/telemetry.spec.ts`.

- [x] **Red — append these regressions** (existing suite imports `Telemetry` and provides Vitest globals):

```ts
it('keeps exact safe process facts and never enables payload detail', async () => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); }, () => 0);
  await t.inRequest('00000000-0000-4000-8000-000000000001', () =>
    t.inTurn({ sessionId: 'private-session', turnId: 'private-turn', attemptId: 'private-attempt' }, async () => {
      await Promise.resolve();
      t.event('process', {
        stage: 'cursor', state: 'rejected', tool: 'calendar_list_calendars',
        schemaRevision: 'google-calendar.v2', reason: 'cursor-signature',
        code: 'CALENDAR_INPUT_REJECTED', field: 'pageToken', expected: 'valid-cursor',
        constraint: 'signed-cursor', suppliedType: 'string', presence: 'present',
        origin: 'local', delivery: 'not-sent', correctionAttempt: 1, correctionLimit: 2,
        durationMs: 7, dispatchId: 'private-dispatch', providerRequestId: 'private-provider',
        detail: true, arguments: 'secret-cursor', content: 'secret-prompt',
        authorization: 'Bearer secret', error: new Error('secret-stack'),
      });
    }));
  const record = JSON.parse(lines[0]!) as Record<string, unknown>;
  expect(record).toMatchObject({ diagnosticVersion: 1, stage: 'cursor', state: 'rejected',
    reason: 'cursor-signature', code: 'CALENDAR_INPUT_REJECTED', field: 'pageToken',
    origin: 'local', delivery: 'not-sent', correctionAttempt: 1, correctionLimit: 2 });
  expect(record.dispatchId).toMatch(/^h:[a-f0-9]{24}$/);
  expect(record.providerRequestId).toMatch(/^h:[a-f0-9]{24}$/);
  expect(record.summary).toEqual(expect.stringContaining('cursor-signature'));
  expect(Buffer.byteLength(lines[0]!, 'utf8')).toBeLessThanOrEqual(4096);
  for (const value of ['private-session', 'private-turn', 'private-attempt', 'private-dispatch',
    'private-provider', 'secret-cursor', 'secret-prompt', 'Bearer secret', 'secret-stack']) {
    expect(lines.join('\n')).not.toContain(value);
  }
  expect(record).not.toHaveProperty('detail');
});

it('isolates throwing sinks and refuses arbitrary code, field and tool labels', () => {
  const t = new Telemetry(() => { throw new Error('secret'); });
  expect(() => t.event('process', { stage: 'terminal' })).not.toThrow();
  expect(t.snapshot().log_failure.count).toBe(1);
  const lines: string[] = [];
  new Telemetry(line => { lines.push(line); }).event('process', {
    stage: 'validation', tool: 'private-tool', code: 'PRIVATE_SECRET', reason: 'private-reason',
    field: 'private-field', durationMs: Infinity, correctionAttempt: NaN,
  });
  const r = JSON.parse(lines[0]!);
  for (const key of ['tool', 'code', 'reason', 'durationMs', 'correctionAttempt']) expect(r).not.toHaveProperty(key);
  expect(r.field).toBe('$');
  expect(lines[0]).not.toContain('private-');
});
```

- [x] **Run red** from `backend`: `npm test -- test/operations/telemetry.spec.ts -t "safe process facts"`. Expected: failure because `process` and diagnostic fields are not yet supported, not a network/configuration failure.
- [x] **Green — add the port/helper** in `backend/src/chat-runtime/ports.ts`, and `diagnostics?: ProcessDiagnostics` on `RuntimeDependencies`. Only transient diagnostic types, not persisted types:

```ts
export type DiagnosticSink = (fields: Readonly<Record<string, unknown>>) => void;
export type DiagnosticScope = Partial<Record<'sessionId' | 'turnId' | 'attemptId' |
  'dispatchId' | 'decisionId' | 'toolCallId' | 'operationId' | 'tool' | 'schemaRevision' |
  'schemaFingerprint', string>>;
export type ProcessDiagnostics = {
  emit: DiagnosticSink;
  run<T>(scope: DiagnosticScope, work: () => T): T;
};
export function diagnose(sink: DiagnosticSink | undefined, fields: Readonly<Record<string, unknown>>): void {
  try { sink?.(fields); } catch { /* Best effort; never retry or change chat. */ }
}
```

- [x] **Green — extend `Telemetry.event` in place.** Add `process` to the kind union; retain the existing `kind/at/requestId`, legacy phase/accounting/ok and metric logic. The following is the complete projection algorithm to insert inside its existing `try`, before serialization. Define `ENUMS` with exactly the closed values in the contract table, `FIELDS` with the table's field paths, and `CALENDAR_CODES` with the literals below, as module-level constants; they must not be derived from input. Add `providerRequestId` to the existing ID loop and use `f[key] ?? context[key]` for scope-aware enum/field values. A process event without an allowlisted stage is dropped; legacy events still work.

```ts
const ENUMS: Readonly<Record<string, readonly string[]>> = {
  stage: ['admission', 'context', 'model-dispatch', 'model-response', 'model-decision',
    'validation', 'cursor', 'authority', 'cache', 'tool-execution', 'provider-request',
    'provider-response', 'correction', 'persistence', 'finalization', 'task-outcome', 'runtime-error', 'terminal'],
  state: ['start', 'ok', 'rejected', 'error', 'skipped'],
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
  persistenceKind: ['write', 'checkpoint'],
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

// Inside event(), after its existing context/identifier projection:
if (kind === 'process') {
  record.diagnosticVersion = 1;
  for (const [name, allowed] of Object.entries(ENUMS)) {
    const value = f[name] ?? context[name];
    if (typeof value === 'string' && allowed.includes(value)) record[name] = value;
  }
  if (!record.stage) return;
  if (typeof f.field === 'string') record.field = FIELDS.has(f.field) ? f.field : '$';
  const fingerprint = f.schemaFingerprint ?? context.schemaFingerprint;
  if (typeof fingerprint === 'string' && /^[a-f0-9]{64}$/u.test(fingerprint)) record.schemaFingerprint = fingerprint;
  for (const name of ['durationMs', 'limit', 'correctionAttempt', 'correctionLimit'] as const) {
    const value = f[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (name.startsWith('correction') && !Number.isInteger(value)) continue;
    const ceiling = name === 'durationMs' ? 3600000 : name === 'limit' ? 1048576 : 1000;
    record[name] = Math.max(0, Math.min(value, ceiling));
  }
}
if (typeof f.code === 'string' && (APP_ERROR_CODES.some(code => code === f.code)
  || ((kind === 'process' || kind === 'calendar') && CALENDAR_CODES.has(f.code)))) record.code = f.code;
if (kind === 'process') {
  record.summary = ['stage', 'state', 'tool', 'reason', 'code', 'field', 'expected', 'constraint',
    'limit', 'suppliedType', 'presence', 'origin', 'delivery', 'correctionAttempt', 'correctionLimit',
    'chat', 'task', 'writeCertainty', 'durationMs']
    .filter(name => record[name] !== undefined)
    .map(name => `${name}=${record[name]}`).join(' ').slice(0, 512);
}
const line = JSON.stringify(redactSecrets(record));
if (Buffer.byteLength(line, 'utf8') > 4096) { this.measure('log_failure'); return; }
this.sink(line);
```

Do not keep the old unconditional `this.sink` after this block, and remove the old duplicate `code` assignment. Replace the old accounting coercion and add the scope method below, importing the scope type only. Scope has no sink, undefined values cannot erase existing IDs, and `inTurn` remains compatible.

```ts
if (f.accountingStatus === 'known' || f.accountingStatus === 'pending' || f.accountingStatus === 'unknown') {
  record.accountingStatus = f.accountingStatus;
}
// Telemetry class method:
inDiagnosticScope<T>(scope: DiagnosticScope, work: () => T): T {
  const next = { ...this.context.getStore() };
  for (const [name, value] of Object.entries(scope)) if (typeof value === 'string') next[name] = value;
  return this.context.run(next, work);
}
```
- [x] **Add/run the remaining red/green privacy checks:** throwing field getters/proxies and custom `toString` cannot escape or leak; unknown and giant values are dropped before serialization; negative/large/NaN/Infinity durations/counts; empty/oversized IDs; schema fingerprint accepted only as 64 hex; one record per call, no nested payload/detail; 10,000 distinct IDs leave `Object.keys(t.snapshot())` unchanged; concurrent ALS scopes retain independent IDs and restore the outer scope after nested work. Expected unknown values are omitted, unknown field is `$`, finite out-of-range numbers clamp. Run `npm test -- test/operations/telemetry.spec.ts`.
- [x] **Commit** only the three task files and plan ticks: `git commit -m "feat(operations): add bounded safe process diagnostics"` after named staging. No application assembly claims yet.

## Task 2: precise validation and cursor facts without behavior changes (AC2, AC4)

**Files:** model validation/stream/adapter; cursor/tools/semantic validation and their tests from the source map.

- [x] **Red — add this table to `backend/test/model/calendar-validation.spec.ts`**, importing `Telemetry` and using existing `candidate` helper. The new optional fourth argument is a callback, not part of `ValidatedCandidate`:

```ts
it.each([
  ['{', 'calendar_get_event', 'malformed-json', '$', 'unavailable', 'unavailable'],
  ['{"eventId":"a","eventId":"b"}', 'calendar_get_event', 'duplicate-key', '$', 'unavailable', 'unavailable'],
  ['{}', 'calendar_get_event', 'missing', 'eventId', 'missing', 'missing'],
  ['{"eventId":4}', 'calendar_get_event', 'wrong-type', 'eventId', 'number', 'present'],
  ['{"eventId":""}', 'calendar_get_event', 'out-of-range', 'eventId', 'string', 'present'],
  ['{"eventId":"abcde","privateUnknown":"SECRET"}', 'calendar_get_event', 'unknown-field', '$', 'object', 'present'],
  ['{"pageToken":null}', 'calendar_list_calendars', 'wrong-type', 'pageToken', 'null', 'present'],
] as const)('observes safe original rejection for %s', (raw, name, reason, field, suppliedType, presence) => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); });
  const batch = candidate(raw, name);
  const before = validateCalendarCandidate(batch, CALENDAR_TOOLS, CALENDAR_LIMITS);
  const result = validateCalendarCandidate(batch, CALENDAR_TOOLS, CALENDAR_LIMITS,
    facts => t.event('process', facts));
  expect(result).toEqual(before);
  const records = lines.map(line => JSON.parse(line));
  expect(records).toContainEqual(expect.objectContaining({ stage: 'validation', state: 'rejected',
    origin: 'local', delivery: 'not-sent', reason, field, suppliedType, presence }));
  expect(lines.join('\n')).not.toContain('privateUnknown');
  expect(lines.join('\n')).not.toContain('SECRET');
  expect(lines.join('\n')).not.toContain('rawArgumentsSha256');
});
```

- [x] **Run red**: `npm test -- test/model/calendar-validation.spec.ts -t "safe original rejection"`. Assert missing observations, not changed validation outcomes. Extend table for numeric 0/21/1.5 `maxResults`, array wrong type/size/member/duplicates, null/root array, envelope cardinality, forbidden/unknown tool priority, byte/depth bounds and truncated calls. `{}` for list remains valid and does not emit a rejection.
- [x] **Green — append `diagnostic?: DiagnosticSink` to `validateCalendarCandidate`.** Keep return objects/evidence hashes and existing check order unchanged. Import `type ZodIssue` from the installed `zod`, and `diagnose`/`DiagnosticSink` from `../chat-runtime/ports.js`. Use `diagnose` for every callback. At scanner/envelope/policy branches emit the reason already proven there; do not parse malformed JSON to guess a field/type. Add this local observer and call it **before** the unchanged `fromZod` mapper:

```ts
function jsonType(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}
function observeIssues(call: CandidateCall, parsed: unknown, issues: readonly ZodIssue[],
  limits: CalendarLimits, diagnostic: DiagnosticSink | undefined): void {
  const root = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : null;
  for (const issue of issues.slice(0, Math.min(limits.diagnosticCount, 10))) {
    const path = issue.path[0] === 'arguments' ? issue.path.slice(1) : issue.path;
    const field = issue.code === 'unrecognized_keys' ? '$' : diagnosticPath(path[0]);
    let value = field === '$' ? parsed : root?.[field];
    const index = path[1];
    const member = field === 'calendarIds' && typeof index === 'number'
      && Number.isInteger(index) && index >= 0 && index < 100;
    if (member && Array.isArray(value)) value = value[index];
    const missing = issue.code === 'invalid_type' && issue.received === 'undefined';
    diagnose(diagnostic, {
      stage: 'validation', state: 'rejected', origin: 'local', delivery: 'not-sent',
      tool: call.name, toolCallId: call.id, field,
      reason: issue.code === 'unrecognized_keys' ? 'unknown-field' : missing ? 'missing'
        : issue.code === 'too_small' || issue.code === 'too_big' ? 'out-of-range'
        : issue.code === 'custom' ? 'invalid-value' : 'wrong-type',
      expected: member ? 'string' : field === 'calendarIds' ? 'array'
        : field === '$' ? 'object' : expectedType(call.name, field),
      constraint: issue.code === 'unrecognized_keys' ? 'no-extra-fields' : missing ? 'required'
        : issue.code === 'too_small' ? 'min' : issue.code === 'too_big' ? 'max'
        : field === 'calendarIds' && issue.code === 'custom' ? 'unique' : 'type',
      suppliedType: jsonType(value), presence: value === undefined ? 'missing' : 'present',
      limit: issue.code === 'too_small' ? issue.minimum : issue.code === 'too_big' ? issue.maximum : undefined,
    });
  }
}
// Replace the original two !success return statements at the end of validateCalendarCandidate:
if (!input.success) {
  observeIssues(call, parsed, input.error.issues, limits, diagnostic);
  return rejected(fromZod(call.name, input.error.issues), batch, limits);
}
const validated = calendarCallSchema.safeParse({ name: call.name, arguments: input.data });
if (!validated.success) {
  observeIssues(call, parsed, validated.error.issues, limits, diagnostic);
  return rejected(fromZod(call.name, validated.error.issues), batch, limits);
}
```

Do not duplicate the existing `const validated` declaration when replacing that tail. Report at most ten observations across the selected failure branch, not ten per nested object. Scanner issues use `expected: 'complete-json'`, `constraint: 'json'`, type/presence `unavailable`; policy failures report `$` unless the field is actually known. Preserve policy-before-structural precedence and unchanged repair diagnostics. Diagnostic revision is supplied by the adapter's real v1/v2 dispatch scope, not hardcoded in the validation helper.
- [x] **Forward the callback**: third optional constructor argument on `CalendarStreamAssembly`; fourth argument of `validateCalendarCandidate` in `finish`; fifth optional argument on `OpenRouterCalendarAdapter`/`createCalendarModelPort`/`createCalendarModelPortV2`. All existing callers remain valid. Use the v1/v2 binding revision at adapter scope, not a fabricated v2 revision for a legacy call. No callback/facts in stream chunks, repair evidence or provider request bodies.
- [x] **Red — append this cursor regression** in `backend/test/plugins/google-calendar/calendar-api-cursor.spec.ts` (existing `key`, `args`, `multiTarget` helpers). Third constructor argument is the optional sink:

```ts
it('observes format signature scope and authenticated expiry without revealing cursors', () => {
  let now = Date.parse('2026-10-27T10:00:00Z');
  const target = multiTarget('writer', 'shared', new Date(now).toISOString());
  const scope = { kind: 'events' as const, discoveryRevision: 1, expiresAt: new Date(now + 1000).toISOString() };
  const facts: Record<string, unknown>[] = [];
  const cursor = new CalendarCursor(key(), () => now, f => { facts.push({ ...f }); });
  const token = cursor.encode('PRIVATE_PROVIDER_TOKEN', target, args, scope);
  const parts = token.split('.');
  const wrongSignature = `${parts[0]}.${parts[1]![0] === '0' ? '1' : '0'}${parts[1]!.slice(1)}`;
  const check = (run: () => unknown, reason: string) => {
    expect(run).toThrow('CALENDAR_INPUT_REJECTED');
    expect(facts.at(-1)).toMatchObject({ stage: 'cursor', state: 'rejected', reason,
      field: 'pageToken', expected: 'valid-cursor', suppliedType: 'string', presence: 'present',
      origin: 'local', delivery: 'not-sent', code: 'CALENDAR_INPUT_REJECTED' });
  };
  check(() => cursor.decode('not-a-cursor', target, args, scope), 'cursor-format');
  check(() => cursor.decode(wrongSignature, target, args, scope), 'cursor-signature');
  check(() => cursor.decode(token, target, { ...args, maxResults: 5 }, scope), 'cursor-scope');
  now += 1001;
  check(() => cursor.decode(token, target, args, scope), 'cursor-expired');
  expect(JSON.stringify(facts)).not.toContain(token);
  expect(JSON.stringify(facts)).not.toContain('PRIVATE_PROVIDER_TOKEN');
});
```

- [x] **Run red**, then implement `CalendarCursor`'s private rejection helper with a fixed reason and `diagnose(this.diagnostic, facts)` followed by the **same** `toolFault('clarification', 'CALENDAR_INPUT_REJECTED')`. Format covers bounds/separator/hex/JSON/payload schema; signature covers constant-time mismatch; authenticated kind/revision/expiry-string/account/query/offset mismatch is scope; time expiration after successful authentication is expired. Do not check unauthenticated scope/expiry. Split the current combined condition in its existing left-to-right order: invalid schema, kind, discovery revision, differing expiry string, elapsed expiry, binding hash, query hash. Maintain that precedence when multiple conditions fail. Legacy decode retains no invented expiry check. Test both decoders, wrong-account/query/revision, process-key mismatch, correctly signed bad payload and correctly signed expired token, throwing callback and omission. Run `npm test -- test/plugins/google-calendar/calendar-api-cursor.spec.ts`.
- [x] **Green — propagate cursor/semantic facts at existing guards.** `CalendarApi` and `CalendarApiTools` pass their callback into their cursor constructors. `tools.ts`'s list offset outside `[0, snapshot.entries.length]` emits `cursor-scope` before the current throw/catch; never derive a reason from the caught broad fault. Add third optional `DiagnosticSink` parameter to `validateCalendarCall` and pass it from CalendarLoop/tools; forward it into its existing semantic helpers. Emit immediately before these original throws, retaining values privately: bad `timeMin/timeMax` or `start/end` → that exact field + `rfc3339`; inverted interval → `timeMax`/`end` + `time-order`; list window → `timeMax` + `max-window` + `limit: limits.listDays`; invalid zone → `timeZone` + `iana-zone`; whitespace summary → `summary`; unsafe ID → actual `eventId/calendarId/calendarIds` + `valid-id`. Do not mislabel a calendar ID as `eventId` just because it reuses `validateGetArguments`.

```ts
// Example insertion at the original minimum-time guard in validateListArguments:
if (!minimum) {
  diagnose(diagnostic, { stage: 'validation', state: 'rejected', reason: 'invalid-value',
    field: 'timeMin', expected: 'string', constraint: 'rfc3339', suppliedType: 'string',
    presence: 'present', origin: 'local', delivery: 'not-sent', code: TIME_REQUIRES_CLARIFICATION });
  throw toolFault('clarification', TIME_REQUIRES_CLARIFICATION);
}
```

Repeat the explicit emission at each named guard with its actual field/code/constraint, not a second semantic validator or error-message parser. Use a fixed helper for the repeated safe emission if it shortens those guards; leave the original validation and faults authoritative. Add table tests comparing with/without/throwing sink return/fault equality and proving unknown field names, dates, titles and IDs never appear in logs. `CalendarAvailabilityApi`'s timestamp/zone/array guards use the same facts before their existing local input rejection; do not pretend its locally rejected request was sent.
- [x] **Run green**: model-validation, cursor and tools-validation focused suites; confirm pre-existing repair-diagnostic assertions remain unchanged. Commit only named task changes with `git commit -m "feat(calendar): expose precise safe rejection facts"`.

## Task 3: actual provider/model boundaries and cache origin (AC1, AC2, AC4)

**Files:** HTTP/provider/model adapters, assembly/connections/discovery and focused tests listed above. Existing execution behavior and in-process MCP remain unchanged.

TDD dependency: before this task's implementation/wiring, perform Task 5's two **Red** setup steps (fixture sink and assembly test file) and record their behavioral assertion failures. Leave Task 5 green verification/commit until Task 4 is implemented. Do not use a missing file or empty discovery as the red result. This keeps real-assembly regressions ahead of their nontrivial implementation without creating another plan.

- [x] **Red — append this HTTP test** in `backend/test/plugins/google-calendar/calendar-api-http.spec.ts` using existing `context`/`json` helpers:

```ts
it('observes actual attempted and received delivery without leaking errors or changing admission', async () => {
  const facts: Record<string, unknown>[] = [];
  const diagnostic = (f: Readonly<Record<string, unknown>>) => { facts.push({ ...f }); };
  const fetcher = vi.fn<typeof fetch>(async () => json({ error: { message: 'SECRET_BODY' } }, { status: 400 }));
  await expect(calendarHttp(context({ diagnostic, fetcher }))).rejects.toHaveProperty('failure.code', 'CALENDAR_INPUT_REJECTED');
  expect(facts).toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'provider-request', provider: 'google-calendar', delivery: 'attempted' }),
    expect.objectContaining({ stage: 'provider-response', provider: 'google-calendar', delivery: 'response-received', statusClass: '4xx' }),
    expect.objectContaining({ reason: 'provider-4xx', origin: 'provider', code: 'CALENDAR_INPUT_REJECTED' }),
  ]));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(facts)).not.toContain('SECRET_BODY');
  expect(JSON.stringify(facts)).not.toContain('fixture-token');
  facts.length = 0;
  fetcher.mockClear();
  await expect(calendarHttp(context({ diagnostic, fetcher,
    consumeRequest: async () => { throw new Error('SECRET_ADMISSION'); },
  }))).rejects.toHaveProperty('failure.code', 'CALENDAR_REQUEST_NOT_ADMITTED');
  expect(fetcher).not.toHaveBeenCalled();
  expect(facts.some(f => f.delivery === 'attempted')).toBe(false);
  expect(facts).toContainEqual(expect.objectContaining({ origin: 'local', delivery: 'not-sent' }));
});
```

- [x] **Run red**: `npm test -- test/plugins/google-calendar/calendar-api-http.spec.ts -t "actual attempted"`. Add rejected-fetch, pre-abort, expired deadline, 2xx undecodable write, permission denial, 403 quota/rate and throwing-callback rows to the same existing suite. Assert exact original fault/category/retry and request count; attempted is never response-received if fetch rejects.
- [x] **Green — add these two optional fields to `CalendarHttpInput`**; default requestKind is omitted for old callers, never guessed from URL contents. Import `DiagnosticSink` and `diagnose` from `../../chat-runtime/ports.js`. Replace only the existing timeout/fetch/fetchedAt block with the following code. It retains fetch arguments, admission ordering and write-uncertainty mapping, using `performance.now()` only for diagnostic duration:

```ts
diagnostic?: DiagnosticSink;
requestKind?: 'list' | 'get' | 'create' | 'readback' | 'availability' | 'preflight' |
  'discovery' | 'capability-recheck';
```

```ts
const timeout = AbortSignal.timeout(afterAdmission);
const signal = AbortSignal.any([input.signal, timeout]);
let response: Response;
let dispatched = false;
const startedAt = performance.now();
try {
  dispatched = true;
  diagnose(input.diagnostic, { stage: 'provider-request', state: 'start', provider: 'google-calendar',
    requestKind: input.requestKind, origin: 'provider', delivery: 'attempted' });
  response = await input.fetcher(url.toString(), { ...init, signal });
} catch (error) {
  diagnose(input.diagnostic, { stage: 'provider-request', state: 'error', provider: 'google-calendar',
    requestKind: input.requestKind, origin: 'provider', delivery: 'attempted',
    reason: 'provider-error', durationMs: performance.now() - startedAt });
  if (input.write === true && dispatched) failure('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback');
  if (isAbort(error) || input.signal.aborted) failure('cancelled', 'CALENDAR_CANCELLED');
  failure('delivery', 'CALENDAR_TEMPORARILY_UNAVAILABLE', 'delivery-same-id');
}
diagnose(input.diagnostic, { stage: 'provider-response', state: response.ok ? 'ok' : 'error',
  provider: 'google-calendar', requestKind: input.requestKind, origin: 'provider',
  delivery: 'response-received', durationMs: performance.now() - startedAt,
  statusClass: response.status >= 500 ? '5xx' : response.status >= 400 ? '4xx'
    : response.status >= 300 ? '3xx' : response.status >= 200 ? '2xx' : 'other' });
const fetchedAt = new Date(clock()).toISOString();
```

The catch emits attempted/error with no error object before retaining the original throw/failure mapping. The non-ok decoded-failure branch emits `reason` (`provider-4xx`/`provider-5xx`), decoded safe `code`, `delivery: 'response-received'`; local admission failure emits `code: 'CALENDAR_REQUEST_NOT_ADMITTED'`, not-sent/local. Pre-abort/deadline emit not-sent/local with their existing codes. Do not set `writeCertainty: confirmed` just because HTTP is 2xx; only validated durable receipt evidence can confirm that. All calls use `diagnose`, so throwing sinks cannot enter business catches.
- [x] **Wire the HTTP hook through every real caller**, with no global or mutable current-tool variable. Constructors gain one optional `diagnostic` option. `CalendarApi` forwards it in all eight HTTP calls (`list` v2/v1, `get` v2/v1, `create` v2, `readback` v2/v1, target `resolve`) and the two cursor constructors/decoders; use actual kinds list/get/create/readback/capability-recheck. Discovery's one site uses discovery; availability's one site uses existing purpose availability/preflight. `CalendarApiTools`, `GoogleCalendarConnections` and `CalendarDiscoveryService` gain the same optional dependency and forward it. At the actual fresh snapshot return in `ensureFresh`, emit `stage: cache/state: ok/origin: cache/delivery: not-sent`; at refresh choice emit `cache/start/origin: local/not-sent`, not a fabricated provider-request. Provider HTTP records alone establish delivery. The later list snapshot projection emits tool-execution/cache and does not erase preceding refresh delivery.
- [x] **Wire the one existing telemetry instance** in `AppService`: move `this.telemetry = new Telemetry(this.ports.writeLog)` directly after `this.ports` assignment; delete the later assignment. Keep the default stdout writer best effort under backpressure with the guard below (drop, never wait, buffer or retry). Pass `diagnostic: fields => this.telemetry.event('process', fields)` to `createCalendarAssembly` and the `CalendarDiscoveryApi` it receives. Pass it from that assembly to CalendarApi, tools, availability, connections; connections passes it to discovery. Add `diagnostics` to `createRuntime`'s existing dependency object:

```ts
// Default AssemblyPorts writer in AppService; caller overrides remain synchronous/bounded.
writeLog: line => {
  if (!process.stdout.writableNeedDrain) process.stdout.write(`${line}\n`);
},
// Existing createRuntime dependency object:
diagnostics: {
  emit: fields => this.telemetry.event('process', fields),
  run: (scope, work) => this.telemetry.inDiagnosticScope(scope, work),
},
```

No new AppService ports are needed. The sink already has an override. The default-sink regression in Task 5 verifies a blocked sink drops without writing/waiting or affecting runtime creation, and a nonbackpressured sink writes one bounded line. Custom sinks are synchronous/bounded by contract; Telemetry itself never queues their work. Do not instantiate a second runtime, discovery service, credential owner or logger.
- [x] **Instrument actual model delivery**, not dispatch reservation. In Calendar adapter's existing fetch try block emit model-dispatch/attempted after `beforeDispatch` and deadline checks, then model-response/response-received after fetch resolves. Include request dispatch/decision IDs, static catalogue fingerprint, revision, duration and `provider: openrouter`. At header parsing emit only the existing validated `identifier(...)` provider request ID; when generation ID first appears emit a bounded model-response identity observation once, not per SSE/usage snapshot. Failed fetch emits attempted/error, with fixed code and no private exception. Returned rejection/failure decisions carry separate local-validation versus provider-response observations.

```ts
// Module constants in calendar-adapter.ts; import createHash and both static catalogues.
export const CALENDAR_DIAGNOSTIC_FINGERPRINTS = {
  'google-calendar.v1': createHash('sha256').update(JSON.stringify(CALENDAR_TOOLS_V1)).digest('hex'),
  'google-calendar.v2': createHash('sha256').update(JSON.stringify(CALENDAR_TOOLS)).digest('hex'),
} as const;
// Inside stream():
const report: DiagnosticSink = fields => diagnose(this.diagnostic, {
  ...fields, dispatchId: request.dispatchId, decisionId: request.decisionId,
  schemaRevision: this.binding.dispatch.schemaRevision,
  schemaFingerprint: CALENDAR_DIAGNOSTIC_FINGERPRINTS[this.binding.dispatch.schemaRevision],
});
const assembly = new CalendarStreamAssembly(request.tools, this.binding.limits,
  fields => report(fields));
```

The existing `buildCalendarBody` equality check still proves that the outgoing tools match the static catalogue; do not hash an arbitrary caller-supplied tools object. Import this same fixed fingerprint map in CalendarLoop for tool scope. Use `report` for all adapter emissions and validation. Emit correction-used/limit from the existing binding budget/limits so invalid arguments still have counts before runtime repair. Preserve all hooks/accounting calls and iterator yields.
- [x] **Ordinary text path uses the same optional callback.** Add it as final optional parameter after existing `random` on `createModelServices` and `OpenRouterAttemptAdapter`; forward it to the existing adapter, not `AccountingService` or catalogue fetches. Pass it from `DurableChatRuntime`'s one `createModelServices` call. Emit dispatch/response for **each existing retry** with known attempt IDs. `correctionAttempt`/`correctionLimit` are schema-repair counts; never repurpose them for ordinary delivery retries. Emit generation ID only on first existing capture, optional validated header provider request ID, and fixed local pre-fetch failure versus actual fetch. Include a local-safe monotonically numbered dispatch identity such as `${record.attemptId}:model:${dispatch}` and hash it normally; no user values in labels or metrics.
- [x] **Run green**: HTTP tests, `npm test -- test/model/calendar-adapter.spec.ts`, and existing ordinary-model fixture tests. Add comparisons with/without/throwing callback for request bodies, retry counts, accounting and errors. An optional hook must not appear in provider bodies. Verify `ensureFresh` cache hit sends no Google HTTP; a refresh has actual provider request/response. Commit named paths with `git commit -m "feat(operations): trace actual model and calendar delivery"`.

## Task 4: correlated lifecycle and independent terminal outcomes (AC1, AC3, AC4)

**Files:** observed runtime/persistence, durable runtime, Calendar loop and existing operations/runtime tests.

- [x] **Red — capture outcome facts in existing production-assembly fixture**, not a Telemetry-only fake. Task 5 supplies complete assembly tests. Also append this ordinary-chat test to `backend/test/operations/runtime.spec.ts`, importing existing `textConfigFixture` and `textSnapshot` helpers:

```ts
it('traces ordinary chat without printing private errors or making diagnostics a dependency', async () => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); });
  const h = textConfigFixture(textSnapshot(1), d => ({ ...d, diagnostics: {
    emit: fields => t.event('process', fields), run: (scope, work) => t.inDiagnosticScope(scope, work),
  } }));
  const rawPrint = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const ids = await h.submit('PRIVATE_USER_MESSAGE');
    await h.execute(ids);
    const records = lines.map(line => JSON.parse(line));
    expect(records).toContainEqual(expect.objectContaining({ stage: 'admission', state: 'ok' }));
    expect(records).toContainEqual(expect.objectContaining({ stage: 'context', state: 'ok' }));
    expect(records).toContainEqual(expect.objectContaining({ stage: 'finalization', state: 'ok' }));
    expect(records).toContainEqual(expect.objectContaining({ stage: 'task-outcome', task: 'not-applicable' }));
    expect(lines.join('\n')).not.toContain('PRIVATE_USER_MESSAGE');
    expect(rawPrint).not.toHaveBeenCalled();
  } finally { rawPrint.mockRestore(); await h.dispose(); }
});
```

Import paths are `../runtime/text-config-fixture.js` and `../model/config-snapshot.js`. Add a second case forcing `h.fetcher.mockRejectedValue(new Error('PRIVATE_EXCEPTION'))`; assert the existing rejection/durable status, no `console.error`, and no private message/stack in logs. This explicitly reaches the catch currently printing at `durable-chat-runtime.ts:662`.
- [x] **Run red**: `npm test -- test/operations/runtime.spec.ts -t "ordinary chat"` and the new assembly cases. Do not change existing stream/fallback assertions just to make logs pass.
- [x] **Green — emit lifecycle facts at the real durable points.** `observedRuntime.submitTurn/retryTurn` emit request-only admission/start then ok with accepted IDs (or rejected with safe AppError code), retaining sync null-runtime rejection. Runtime emits durable-admission/ok only after `confirmAcceptance`; idempotent acceptance emits ok for the reused accepted IDs, never a second inference. Scope validation/acceptance with known server-derived session/turn/attempt IDs as soon as computed; before that request-only is honest. At `checkBoundary` instrument one shared wrapper, not three callers, preserving signature plus optional attemptId if needed to correlate pre-acceptance context: start, ok/error, duration, no content/history. It is called from accept, retry and execution. Do not move context validation after durable acceptance.

Replace `checkBoundary` with this scoped version, adding optional final `diagnosticAttemptId`; its original business statements are preserved. Pass `aId` from accept/new and retry, and `a.attemptId` from execute, so context failure before confirmed acceptance is still correlated. Local imports already supply the types/functions other than `diagnose` from ports.

```ts
async checkBoundary(lease: ExecutionLease, job: Work, newTurnId: string, content: string,
  responseMode: ResponseMode, assembler?: ContextAssembler, diagnosticAttemptId?: string) {
  const scope = { sessionId: lease.sessionId, turnId: newTurnId, attemptId: diagnosticAttemptId };
  const run = async () => {
    const startedAt = performance.now();
    diagnose(this.d.diagnostics?.emit, { stage: 'context', state: 'start', ...scope,
      origin: 'local', delivery: 'not-sent' });
    try {
      const p = this.d.persistence; const u = lease.userId; const s = lease.sessionId;
      const records = await acceptedHistory(p, u, s); let manifest = await p.memory.get(u, s);
      const graph = await this.graph(lease); const cfg = graphConfig(u, s); const snap = await graph.getState(cfg);
      if (!manifest) {
        if (records.length || snap.values.boundary) throw new AppError('NOT_READY', 'Chat context needs recovery.');
        manifest = buildReferenceManifest(u, s, 0, [], this.d.assets, p.memory.budgets);
        await job.wait(p.owner.run(lease, () => p.memory.put(manifest!)), this.d.config.budgets.persistenceTimeoutMs);
      }
      const referenced = new Set(manifest.messageRefs.map(r => r.messageId));
      const committed = records.filter(m => !(m.turnId === newTurnId && m.role === 'user' && !referenced.has(m.messageId)));
      const expected = buildReferenceManifest(u, s, manifest.contextVersion, committed, this.d.assets, p.memory.budgets);
      if (!isDeepStrictEqual(expected, manifest)) throw new AppError('NOT_READY', 'Chat context needs recovery.');
      if (!snap.values.boundary) {
        if (manifest.messageRefs.length || manifest.contextVersion !== 0) throw new AppError('NOT_READY', 'Graph state needs recovery.');
        await job.wait(graph.updateState(cfg, { boundary: boundaryFor(manifest), input: null, result: null, sealed: false, rebase: null }, 'seal'), this.d.config.budgets.persistenceTimeoutMs);
      } else if (snap.next.length || !isDeepStrictEqual(snap.values.boundary, boundaryFor(manifest))) {
        throw new AppError('NOT_READY', 'Graph state needs recovery.');
      }
      const effectiveAssembler = assembler ?? this.d.assembler;
      const assembled = await effectiveAssembler.assemble({ userId: u, sessionId: s,
        turnId: newTurnId, newUserInput: content, responseMode });
      if (!assembled.ok) throw new AppError('CONTEXT_BUDGET_EXCEEDED', assembled.overflow.message, false);
      diagnose(this.d.diagnostics?.emit, { stage: 'context', state: 'ok', ...scope,
        origin: 'local', delivery: 'not-sent', durationMs: performance.now() - startedAt });
      return assembled.context;
    } catch (error) {
      diagnose(this.d.diagnostics?.emit, { stage: 'context', state: 'error', ...scope,
        origin: 'local', delivery: 'not-sent', code: error instanceof AppError ? error.code : 'PERSISTENCE_ERROR',
        durationMs: performance.now() - startedAt });
      throw error;
    }
  };
  return this.d.diagnostics ? this.d.diagnostics.run(scope, run) : run();
}
```

Retain the original comments about accepted input/history when applying this replacement; no requirement is dropped with the condensed code above. Replace the raw `console.error` line in execute catch with `diagnose(this.d.diagnostics?.emit, { stage: 'runtime-error', state: 'error', code: error instanceof AppError ? error.code : 'PERSISTENCE_ERROR' })`; never send `error`, `.message`, `.stack` or `String(error)`. Keep the original error/transition behavior.
- [x] **Scope tool execution without globals.** Add optional `diagnostics?: ProcessDiagnostics` to `CalendarLoopContext`, pass from runtime, and wrap the existing post-reservation model work and post-load execution body in `diagnostics.run(scope, work)` when present, otherwise call work once. Scope carries accepted IDs plus dispatch/decision and, after a valid tool decision, toolCallId/tool/revision/fingerprint. This ensures nested discovery/cursor/provider emissions share the actual decision through the embedded in-process path. Use a lexical async closure around the original statements; do not refactor the execution engine or catch-and-rerun work. Provider identifiers are event-local; a continuation must not inherit a previous generation/provider request ID.

```ts
// Insert after saved decision is loaded/narrowed in execute(); this is the original
// remaining execution body, now inside a single lexical closure.
const run = async (): Promise<CalendarGraphPatch> => {
  await this.emit({ type: 'calendar-progress', phase: 'executing' });
  const budget = await this.ctx.ledger.ensureBudget();
  if (isCalendarV2(this.ctx.calendar)) {
    if (decision.call.name === 'calendar_create_event') {
      return this.executeCreateV2(input, decision as CalendarDecision & { kind: 'tool' });
    }
    return this.executeReadV2(input, decision as CalendarDecision & { kind: 'tool' });
  }
  await this.ctx.ledger.consume({ logicalTools: budget.logicalTools + 1 });
  const invoked = await (this.ctx.calendar.execution as any).invoke({
    binding: {
      ...this.ctx.binding, sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
      attemptId: this.ctx.attempt.attemptId, decisionId: decision.decisionId, toolCallId: decision.toolCallId,
      schemaRevision: 'google-calendar.v1', operation: null, trustedNow: this.ctx.now(),
      trustedTimeZone: this.ctx.calendar.trustedTimeZone,
      deadlineAt: (await this.ctx.ledger.ensureBudget()).deadlineAt,
    },
    call: decision.call, signal: this.ctx.job.signal,
    consumeRequest: async () => {
      const current = await this.ctx.ledger.ensureBudget();
      await this.ctx.ledger.consume({ calendarRequests: current.calendarRequests + 1 });
    },
    consumeRefreshRequest: async () => {
      const current = await this.ctx.ledger.ensureBudget();
      await this.ctx.ledger.consume({ refreshRequests: current.refreshRequests + 1 });
    },
  });
  if (invoked.outcome !== 'success') {
    if (invoked.failure.category === 'clarification' && invoked.failure.code === 'CALENDAR_INPUT_REJECTED') {
      return this.correctToolCall(input, decision, [{
        path: 'pageToken' in decision.call.arguments ? 'pageToken' : 'tool_calls.arguments',
        code: 'invalid-value', expected: 'bounded-value',
      }]);
    }
    return this.failConversationally(input, invoked.failure, decision.decisionId);
  }
  if (invoked.source.permission.content === 'volatile') this.volatileSourceIds.add(invoked.source.sourceId);
  await this.ctx.persistence.calendarRetention.registerSource({
    userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, source: invoked.source,
  });
  await this.ctx.persistence.calendarResults.put(calendarToolResultRecordSchema.parse({
    schemaVersion: 1, kind: 'calendar-tool-result',
    userId: this.ctx.attempt.userId, sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
    attemptId: this.ctx.attempt.attemptId, decisionId: decision.decisionId,
    eventId: key('calendar-tool-result-event', this.ctx.attempt.userId, decision.toolCallId),
    sequence: this.groups.length, toolCallId: decision.toolCallId, createdAt: this.ctx.now(),
    resultRef: invoked.source.permission.content === 'retained'
      ? { storage: 'retained', source: invoked.source, toolCallId: decision.toolCallId,
        operationId: decision.toolCallId, result: invoked.result }
      : { storage: 'reference', source: invoked.source, toolCallId: decision.toolCallId,
        operationId: decision.toolCallId, outcome: 'ok' },
  }));
  this.groups.push(completeToolGroupSchema.parse({
    assistant: { role: 'assistant', content: null,
      tool_calls: [{ id: decision.toolCallId, type: 'function',
        function: { name: decision.call.name, arguments: JSON.stringify(decision.call.arguments) } }] },
    result: { role: 'tool', tool_call_id: decision.toolCallId, name: decision.call.name,
      content: JSON.stringify(invoked.result) },
    sources: [invoked.source],
  }));
  this.cursor = calendarCursorSchema.parse({ ...this.cursor, next: 'decide', pendingDecisionId: null, repair: null });
  return { calendarCursor: this.cursor, calendarRefs: this.refs() };
};
const revision = isCalendarV2(this.ctx.calendar) ? 'google-calendar.v2' : 'google-calendar.v1';
const scope = { sessionId: this.ctx.attempt.sessionId, turnId: this.ctx.attempt.turnId,
  attemptId: this.ctx.attempt.attemptId, decisionId: decision.decisionId,
  toolCallId: decision.toolCallId, tool: decision.call.name,
  schemaRevision: revision, schemaFingerprint: CALENDAR_DIAGNOSTIC_FINGERPRINTS[revision] };
return this.ctx.diagnostics ? this.ctx.diagnostics.run(scope, run) : run();
```

Retain the original comments describing v1 read-only behavior and v2 debit behavior when applying this mechanically scoped body. Scope the model adapter invocation after `reserveDispatch` using the same accepted scope plus its existing dispatch/decision IDs; the model adapter's `report` closure additionally attaches those IDs to all of its own events. Include operationId when already known; early proposals without a model dispatch must not invent dispatch/tool IDs. Test concurrent turns with interleaved promises and provider responses: no tool/decision/attempt leaks and outer scopes restored. If the real embedded adapter loses ALS context, stop and report the failing test to the orchestrator before introducing extra protocol/plumbing; do not substitute timestamps or mutable last-tool state.
- [x] **Decision and correction facts:** after adapter decision/rejection classification emit `model-decision` with fixed kind/allowed tool, scope IDs and duration. After the existing decision/rejection save succeeds emit persistence/ok; on save failure emit error/persistence-error and propagate. On duplicate suppression emit `duplicate-call` and not-sent, with correction count; access denial is authority/rejected, never schema repair. In both `correctToolCall` and structural-rejection budget branches emit actual repairs-used/limit; exhaustion is `budget-exhausted`/`REPAIR_EXHAUSTED`. The current structural exhaustion throws `PROVIDER_ERROR`; the current semantic/cursor exhaustion seals fallback. P1 must observe that difference, not change it.
- [x] **Keep task classification transient.** Add a private fixed-enum task/write pair to CalendarLoop (default `not-applicable`/`not-applicable`), expose `diagnosticOutcome()` to the existing runtime, and set it at branch decisions—not from assistant text. Emit task-outcome when `seal` observes it; after publication emit it again only if evidence actually changes. Required assignments:

| Existing branch | `task` / `writeCertainty` |
| --- | --- |
| Successful read after actual executor result and required result save | `success` / `not-applicable` |
| Text-only Calendar-capable answer with no tool | `not-applicable` / `not-applicable`; do not call it a successful Calendar lookup |
| `correctToolCall` exhausted with delivered fallback | `fallback` / `not-applicable` |
| `failConversationally`: uncertain | `uncertain` / `unknown` |
| `failConversationally`: policy or credential denial | `denied` / `not-sent` for create, otherwise `not-applicable` |
| `failConversationally`: genuine missing/ambiguous user detail | `clarification` / `not-sent` for create, otherwise `not-applicable` |
| Local bad tool argument/provider rejection with fixed conversational answer | `fallback` / `not-applicable`; bad model arguments are not a user clarification |
| Pending proposal: not-current/expired/edit/incomplete/select/ambiguous | `clarification` / `not-sent` |
| Pending proposal cancelled by user | `cancelled` / `not-sent`; chat may still be completed |
| Early incomplete intent/target/preflight/conflict question | `clarification` / `not-sent`; use `denied` if an actual capability denial is observed |
| `finishCreate`: created or existing succeeded with verified receipt | `success` / `confirmed` |
| `finishCreate`: clarify | `clarification` / `not-sent` |
| `finishCreate`: unknown/dispatching/unknown readback | `uncertain` / `unknown` |
| `finishCreate`: failed with proven no send | `failed` / `not-sent`; absent proof is `unknown`, not not-sent |
| Ordinary non-Calendar model execution | `not-applicable` / `not-applicable` |
| Recovery/replay without trustworthy task evidence | `unknown` / `unknown`; no new inference/write or schema to reconstruct logging |

In particular annotate all direct `lastText =` branches, `answerAndSeal` callers, `executeReadV2`'s clarify/denied returns and `finishCreate`; grepping only the reported fallback misses sibling paths. A successful result before a later failure is not overwritten into overall success. Set a rejected attempted tool's task to fallback until a corrected successful execution supersedes it; a later text-only repair answer must not reset that failure to not-applicable. `failConversationally` code `CALENDAR_INPUT_REJECTED` is fallback, not a user detail request. A known confirmed write remains confirmed if subsequent narration/delivery fails. Use the operation record's actual succeeded/receipt evidence before calling an existing write successful.

```ts
// Fixed setter/getter only; these never enter a seal, checkpoint, receipt or API response.
private task: 'success' | 'clarification' | 'fallback' | 'denied' | 'failed' | 'cancelled' |
  'uncertain' | 'not-applicable' | 'unknown' = 'not-applicable';
private writeCertainty: 'not-applicable' | 'not-sent' | 'confirmed' | 'unknown' = 'not-applicable';
diagnosticOutcome() { return { task: this.task, writeCertainty: this.writeCertainty }; }
// At the existing correction-exhaustion return, before answerAndSeal:
this.task = 'fallback';
diagnose(this.ctx.diagnostics?.emit, { stage: 'correction', state: 'rejected',
  reason: 'budget-exhausted', code: 'REPAIR_EXHAUSTED', origin: 'local', delivery: 'not-sent',
  correctionAttempt: budget.repairs, correctionLimit: this.ctx.limits.repairs });
```

- [x] **Finalization/delivery are independent facts.** Emit finalization/start before existing publish and ok only after durable checkpoint/application publication and required clear-attempt work; failure with saved seal is finalization/error + chat unknown, not a false failed terminal. In `observedRuntime` observe protocol-1 and Calendar protocol-2/3 statuses/completed/error **without changing forwarding or readiness**. Terminal `chat` comes from actual terminal envelope/durable outcome, never merely an awaited `executeTurn`; task observations join by attempt. Do not equate successfully calling `c.emit` with browser receipt. A completed fallback has `(chat: completed, task: fallback)`. A cancelled attempt has chat cancelled/interrupted as actually durable, not inferred from a transport disconnect. Record recovered task unknown if evidence cannot discriminate fallback from success. No new durable fields just for logging.
- [x] **Persistence proxy stays single-owner.** In existing `observeMethods` before Reflect.apply record start time, after successful return emit `stage: persistence/state: ok/durationMs/persistenceKind: metric` for the existing write/checkpoint metric, in catch emit error/persistence-error then rethrow, keep metric timing in `finally`. Never inspect/log `args`, result records or method names from arbitrary keys; `requestKind` is not a persistence method. Existing accounting emission remains allowlisted. Add tests that receiver, return value, rejection identity and invocation count are unchanged with throwing sink.
- [x] **Run green**: operations runtime/persistence, Calendar feedback/answer/recovery focused suites plus assembled trace tests. Verify no change to frames, accepted messages, effects, retries, ledger counters, manifests, checkpoints and saved result recovery. Commit named changes with `git commit -m "feat(runtime): distinguish chat delivery and calendar task outcomes"`.

## Task 5: production-assembly regressions and diagnostic handoff trace (AC1–AC4, AC9 contract)

**Files:** `backend/test/assembly/calendar-fixture.ts`, new `backend/test/assembly/calendar-observability.spec.ts`; extend existing runtime/operations suites rather than cloning fixtures.

- [x] **Red — add `writeLog?: AssemblyPorts['writeLog']` to `AssembledCalendarInit`** and `if (init.writeLog) f.ports.writeLog = init.writeLog;` before `AppService.create`. This is the only needed assembly-fixture extension. Existing `cal.fetcher` is scripted; tighten the completion route to require the exact OpenRouter origin/path, not only `.includes('/chat/completions')`, before using its fake response. Never fall back to real `fetch`. Place that tiny fixture guard in `backend/test/runtime/calendar-runtime.fixture.ts`, preserving all existing routing/controls.
- [x] **Red — create the following test file**, including its mandatory header. These are core complete tests; append the named cases below using the same harness.

```ts
/**
 * ============================================================================
 * FILE: calendar-observability.spec.ts
 * LOCATION: backend/test/assembly/calendar-observability.spec.ts
 * ============================================================================
 * PURPOSE: Verify safe process traces through the offline production assembly.
 * ROLE IN PROJECT: Exercises AppService, durable runtime, real model serialization
 *    and the current Calendar executor without live providers or application data.
 * KEY COMPONENTS:
 *    - run: Capture one scripted turn and its unchanged durable outcome.
 *    - Diagnostic assertions: Reject locally, execute fixtures and separate fallback.
 * ============================================================================
 */
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { AppService } from '../../src/app.service.js';
import { assembledCalendarApp } from './calendar-fixture.js';
import { assemblyFixture } from './admin-config-fixture.js';
import { nativeFrame } from '../model/calendar-fixtures.js';
import { textWire } from '../runtime/calendar-runtime.fixture.js';

function tool(name: string, raw = '{}') {
  return nativeFrame({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function',
    function: { name, arguments: raw } }] }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
}
const hash = (v: string) => `h:${createHash('sha256').update(v).digest('hex').slice(0, 24)}`;

type Assembly = Awaited<ReturnType<typeof assembledCalendarApp>>;
async function run(wires: string[], throwing = false,
  prepare: (h: Assembly) => void | Promise<void> = () => undefined, question = 'PRIVATE_QUESTION') {
  const lines: string[] = [];
  const h = await assembledCalendarApp({ writeLog: line => {
    if (throwing) throw new Error('PRIVATE_SINK_FAILURE');
    lines.push(line);
  } });
  try {
    await prepare(h);
    h.cal.modelWires.push(...wires);
    const runtime = h.service.operations.runtime;
    const ids = await runtime.submitTurn({ identity: { userId: 'aurvin-dev-user',
      openRouterUser: 'aurvin-dev-user', source: 'server-configured' }, sessionId: null,
      content: question, idempotencyKey: 'visibility-0001' });
    const frames: unknown[] = [];
    await runtime.executeTurn({ userId: 'aurvin-dev-user', ...ids, signal: new AbortController().signal,
      emit: async f => { frames.push(f); }, emitCalendar: async f => { frames.push(f); } });
    const attempt = await h.cal.p.metadata.getAttempt('aurvin-dev-user', ids.sessionId, ids.attemptId);
    const googleCalls = h.fetcher.mock.calls.filter(([url]) => new URL(String(url)).origin === 'https://www.googleapis.com').length;
    return { records: lines.map(line => JSON.parse(line) as Record<string, unknown>), lines,
      attempt, ids, frames, googleCalls, modelCalls: h.cal.modelBodies.length };
  } finally { await h.dispose(); }
}

it('traces local cursor rejection correction cache execution and durable completion', async () => {
  const r = await run([tool('calendar_list_calendars', '{"pageToken":"first"}'),
    tool('calendar_list_calendars'), textWire('Fixture answer.')]);
  const records = r.records.filter(f => f.kind === 'process');
  expect(records).toContainEqual(expect.objectContaining({ stage: 'cursor', state: 'rejected',
    reason: 'cursor-format', origin: 'local', delivery: 'not-sent', field: 'pageToken',
    code: 'CALENDAR_INPUT_REJECTED' }));
  expect(records).toContainEqual(expect.objectContaining({ stage: 'correction', correctionAttempt: 0, correctionLimit: 2 }));
  expect(records).toContainEqual(expect.objectContaining({ stage: 'cache', origin: 'cache', delivery: 'not-sent' }));
  expect(records).toContainEqual(expect.objectContaining({ stage: 'task-outcome', task: 'success' }));
  expect(records).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'completed' }));
  expect(r.attempt?.status).toBe('completed');
  expect(r.googleCalls).toBe(0);
  expect(r.modelCalls).toBe(3);
  const correlated = records.filter(f => ['model-dispatch', 'model-decision', 'cursor', 'correction', 'task-outcome', 'terminal'].includes(String(f.stage)));
  expect(correlated.length).toBeGreaterThan(5);
  expect(correlated.every(f => f.attemptId === hash(r.ids.attemptId))).toBe(true);
  expect(records.filter(f => f.stage === 'model-dispatch')).toHaveLength(3);
  expect(records.some(f => f.stage === 'provider-request' && f.provider === 'google-calendar')).toBe(false);
  for (const line of r.lines) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(4096);
  expect(r.lines.join('\n')).not.toContain('PRIVATE_QUESTION');
});

it('does not equate delivered correction exhaustion with a successful calendar task', async () => {
  const wires = Array.from({ length: 3 }, () => tool('calendar_list_calendars', '{"pageToken":"first"}'));
  const r = await run(wires);
  expect(r.attempt?.status).toBe('completed');
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'correction', reason: 'budget-exhausted',
    code: 'REPAIR_EXHAUSTED', correctionAttempt: 2, correctionLimit: 2 }));
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'task-outcome', task: 'fallback' }));
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'completed' }));
  expect(r.records.some(f => f.task === 'success')).toBe(false);
  expect(r.googleCalls).toBe(0);
  expect(r.modelCalls).toBe(3);
});

it('keeps logging failure out of response durability and provider execution', async () => {
  const wires = [tool('calendar_list_calendars'), textWire('Fixture answer.')];
  const baseline = await run(wires);
  const throwing = await run(wires, true);
  expect(throwing.attempt?.status).toBe(baseline.attempt?.status);
  expect(throwing.modelCalls).toBe(baseline.modelCalls);
  expect(throwing.googleCalls).toBe(baseline.googleCalls);
  expect(throwing.frames).toEqual(baseline.frames);
});

it('distinguishes a received Google 400 from an unsent local argument rejection', async () => {
  const r = await run([tool('calendar_get_event', '{"eventId":"abcde"}'), textWire('Unable to read.')], false, h => {
    const original = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.origin === 'https://www.googleapis.com' && parsed.pathname.includes('/events/')) {
        return new Response(JSON.stringify({ error: { message: 'PRIVATE_PROVIDER_BODY' } }),
          { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return original(url, init);
    });
  });
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'provider-request',
    provider: 'google-calendar', delivery: 'attempted' }));
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'provider-response',
    provider: 'google-calendar', origin: 'provider', delivery: 'response-received',
    reason: 'provider-4xx', code: 'CALENDAR_INPUT_REJECTED' }));
  expect(r.records.some(f => f.stage === 'cursor')).toBe(false);
  expect(r.googleCalls).toBe(1);
  expect(r.lines.join('\n')).not.toContain('PRIVATE_PROVIDER_BODY');
});

it('observes the real discovery refresh before a local snapshot projection', async () => {
  const r = await run([tool('calendar_list_calendars'), textWire('Fixture answer.')], false, async h => {
    const current = await h.cal.p.calendarConnectionsV2.get('aurvin-dev-user');
    if (!current || current.schemaVersion !== 2 || !current.discovery) throw new Error('Missing fixture discovery');
    const now = Date.now();
    const past = new Date(now - 1000).toISOString();
    const result = await h.cal.p.calendarConnectionsV2.compareAndSwap({ userId: current.userId,
      expectedRevision: current.revision, expectedConnectionRevision: current.connectionRevision,
      expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
      next: { ...current, revision: current.revision + 1,
        discovery: { ...current.discovery, fetchedAt: new Date(now - 2000).toISOString(),
          expiresAt: past, retentionExpiresAt: past } } });
    expect(result.outcome).toBe('confirmed');
  });
  expect(r.googleCalls).toBe(1);
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'provider-request',
    provider: 'google-calendar', requestKind: 'discovery', delivery: 'attempted' }));
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'provider-response',
    provider: 'google-calendar', requestKind: 'discovery', delivery: 'response-received' }));
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'tool-execution', tool: 'calendar_list_calendars', origin: 'cache' }));
});

it('hashes model provider IDs and never prints private event content', async () => {
  const r = await run([tool('calendar_get_event', '{"eventId":"abcde"}'), textWire('PRIVATE_ASSISTANT_TEXT')], false, h => {
    const original = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      const parsed = new URL(String(url));
      if (parsed.origin === 'https://openrouter.ai') response.headers.set('x-request-id', 'private-request-id');
      if (parsed.origin === 'https://www.googleapis.com' && parsed.pathname.includes('/events/')) {
        const event = await response.json() as Record<string, unknown>;
        return new Response(JSON.stringify({ ...event, summary: 'PRIVATE_EVENT_TITLE',
          description: 'PRIVATE_EVENT_DESCRIPTION', location: 'PRIVATE_EVENT_LOCATION' }),
          { status: response.status, headers: response.headers });
      }
      return response;
    });
  });
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'model-response',
    providerRequestId: hash('private-request-id') }));
  for (const value of ['private-request-id', 'PRIVATE_ASSISTANT_TEXT', 'PRIVATE_EVENT_TITLE',
    'PRIVATE_EVENT_DESCRIPTION', 'PRIVATE_EVENT_LOCATION', 'fixture-access-token', 'fixture-refresh-token']) {
    expect(r.lines.join('\n')).not.toContain(value);
  }
});

it('does not turn an uncertain create into success or repeat its POST', async () => {
  const create = tool('calendar_create_event', JSON.stringify({ summary: 'Planning',
    start: '2026-11-03T10:00:00Z', end: '2026-11-03T11:00:00Z', timeZone: 'Etc/UTC' }));
  let posts = 0;
  const r = await run([create], false, h => {
    const original = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.origin === 'https://www.googleapis.com' && parsed.pathname.includes('/events')) {
        if (init?.method === 'POST') posts += 1;
        throw new Error('PRIVATE_LOST_RESPONSE');
      }
      return original(url, init);
    });
  }, 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
  expect(posts).toBe(1);
  expect(r.records).toContainEqual(expect.objectContaining({ stage: 'task-outcome',
    task: 'uncertain', writeCertainty: 'unknown' }));
  expect(r.records.some(f => f.writeCertainty === 'confirmed')).toBe(false);
  expect(r.records.some(f => f.task === 'success')).toBe(false);
  expect(r.lines.join('\n')).not.toContain('PRIVATE_LOST_RESPONSE');
});

it.each([true, false])('keeps default stdout bounded when backpressured=%s', async blocked => {
  const f = assemblyFixture();
  const { writeLog: ignoredSink, ...ports } = f.ports;
  void ignoredSink;
  const pressure = vi.spyOn(process.stdout, 'writableNeedDrain', 'get').mockReturnValue(blocked);
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  let service: AppService | undefined;
  try {
    service = await AppService.create(f.bootstrap, ports);
    write.mockClear();
    service.telemetry.event('process', { stage: 'terminal', chat: 'unknown' });
    expect(write).toHaveBeenCalledTimes(blocked ? 0 : 1);
    if (!blocked) expect(Buffer.byteLength(String(write.mock.calls[0]![0]), 'utf8')).toBeLessThanOrEqual(4097);
  } finally {
    await service?.operations.shutdown();
    write.mockRestore();
    pressure.mockRestore();
  }
});
```

- [x] **Run red**: `npm test -- test/assembly/calendar-observability.spec.ts`. Expect the new diagnostic assertions to fail before Tasks 1–4; preserve failure evidence. Run after implementation for green. If generated IDs differ across two independent fixture runs, compare frame **event payloads** plus sequence/protocol, not unrelated generated IDs; do not weaken the durability/call-count assertions.
- [x] **Add/run these exact scenario regressions before their corresponding implementation:**

| Scenario / existing fixture control | Mandatory assertions |
| --- | --- |
| Malformed model JSON followed by corrected `{}` | Native model dispatch/response → local validation rejected → correction 0/2 → repaired dispatch → tool/cache → decision/result persistence → finalization → terminal. No Google request for local rejection. Initial/repair/continuation share attempt but not dispatch/generation IDs. |
| Real fixture Google 400 on `calendar_get_event` | Wrap `h.fetcher.getMockImplementation()` to return fixture JSON only for exact Google events URL; preserve all other scripted routes. Provider request attempted and response received/4xx/code CALENDAR_INPUT_REJECTED, unlike a local cursor fault. Never attribute a failed provider 400 field from model schema evidence. |
| Cached calendar list then forced stale snapshot | First has zero Google fetch; expire the fixture record's discovery timestamps using its existing CAS, then next turn refreshes via the real discovery service and actual HTTP seam. Tool snapshot result may be local, but the earlier refresh delivery remains visible. |
| Rejected Google fetch; synthetic request/generation header IDs | Attempted, no response-received, no URL or exception text; validated provider IDs hash and correlate with the correct dispatch. Absent/invalid IDs omitted. |
| Semantic bad timestamp/range/zone and duplicate call | Exact safe field/constraint, no supplied value; duplicate executes only once, correction counts bounded, successful prior results retained. Use current `calendar-feedback.spec.ts` cases. |
| Capability denial / target ambiguity / create missing details | Denied versus clarification (not lookup success); zero forbidden write; no schema-repair bypass. Use `calendar-answer-regressions.spec.ts` and existing preflight/target fixtures. |
| Confirmed create, lost create response/readback unknown, user cancellation | Confirmed versus unknown write certainty; never repeat create. Use deterministic saved operation/response controls in current runtime/recovery fixtures, not a live write. |
| Structural repair exhaustion | Current error branch remains failure, not silently changed into completed fallback. Distinguish from the cursor/semantic completed fallback test above. |
| Archive/manifest/terminal-CAS failure then saved-result recovery | Finalization failure is not success; recovery records truthful durable status and unknown task if no safe evidence. Existing model/tool counts unchanged, no repeated inference/write. |
| Concurrent attempts in distinct sessions, with deliberately interleaved provider promises | Correct hashed request/attempt/dispatch/decision/tool IDs at validation/cache/provider boundaries; no cross-talk or stale last-tool/generation ID. Same-session active-attempt rules unchanged. |
| Privacy and disabled detail | Tokens, headers, prompts, event summary/description/location, unknown-field name, cursor, raw provider body/URL and exception/stack sentinels absent in all logs, including summary and raw-print catch path. Same projection in dev/test/production; no detail flag enables extra fields. |
| Maximum bounded repairs/tools/requests and throwing diagnostic callback | Finite stage-only record count derived from actual ledger limits, at most ten issue observations per rejection; each record ≤4096 bytes, summary ≤512 chars, fixed metric keys, no token/frame log storm or queue. With/without hook same effects and durable outcomes. |

Keep unrecognized network destinations fail-closed. Count OpenRouter and Google calls separately. At least one HTTP route test must preserve server request UUID → hashed accepted attempt → stream request and downstream stages; extend existing `backend/test/assembly/calendar-flow.spec.ts` boot pattern without changing frontend/wire behavior. The stream is a second HTTP request: link them by accepted attempt, not an invented single request ID. New source headers apply when extending that headerless file by more than 30%.
- [x] **Commit** only attributable fixture/tests and plan ticks with `git commit -m "test(operations): verify assembled calendar process traces"`. Report this as synthetic/offline evidence, never the observed user incident.

## Task 6: runbook, final P1 verification and P2 handoff (AC1–AC4, AC9, AC10)

**Files:** create only `docs/calendar-visibility-simplification/observability.md`; tick this plan. Orchestrator owns `state.md`, final `verification.md` and `final_report.md`.

- [x] **Write the actual runbook** with these required headings and contents: `Contract v1` (implemented fields/enums/fingerprint derivation); `Where logs go` (existing injected sink, stdout by default, no application log file/rotation or new queue, records may be dropped under stdout backpressure and are not guaranteed durable); `Follow one turn` (PowerShell commands below and request/attempt cross-request linkage); `Interpret outcomes` (local/cache/provider, attempted versus receipt, independent task/chat/write certainty); `Privacy and bounds` (4096 bytes, 512 summary, finite issue count/stage emissions, pseudonymization caveat, disabled-by-design detail); `Offline diagnosis` (test-generated synthetic local failure/correction/cache/provider trace, commands, observed boundaries, worker commits); `Evidence gaps` (actual incident and live/native status); `P2 handoff` (contract/tests/shared paths and caveats).

```powershell
# Run only against the already configured local environment when its operator permits startup.
# Startup itself is not authorization for a chat/provider call.
npm run start:dev 2>&1 | Tee-Object -FilePath "$env:LOCALAPPDATA\Temp\opencode\aurvin-process.log"
```

```powershell
$records = Get-Content "$env:LOCALAPPDATA\Temp\opencode\aurvin-process.log" | ForEach-Object {
  try { $_ | ConvertFrom-Json -ErrorAction Stop } catch { }
}
$records | Where-Object { $_.kind -eq 'process' } | Select-Object at, requestId, attemptId, summary
```

```powershell
# Copy one pseudonymous attemptId from the previous display, never a raw token/cursor.
$attempt = Read-Host 'Pseudonymous attemptId'
$records | Where-Object { $_.kind -eq 'process' -and $_.attemptId -eq $attempt } |
  Select-Object at, requestId, dispatchId, decisionId, toolCallId, operationId, summary
```

Document that this **optional operator-created file** has no application TTL/rotation; shell/host retention applies. Operator should keep it local and remove that specifically named file after diagnosis under their policy; do not promise automatic deletion or prescribe dumping `.env`/payloads. No live call is made by plan verification. Prefer fixture-derived traces when sharing evidence. No screenshots/dashboards/frontend panels needed.
- [x] **Record evidence honestly:** runbook includes actual commands/pass-fail counts/skips and exact worker commits, plus synthetic trace from tests. Label source-derived hypotheses separately. The live incident's actual arguments, failed boundary, selected-model repair behavior and accurate owned-calendar answer remain **unobserved/unrun** unless separately authorized and executed. `owner` access role is manager access, not proof of data ownership; P1 success does not solve that P2 question. Do not inspect application records or change failure behavior to obtain a prettier trace.
- [x] **Run checks sequentially from `backend`:** `npm run build` (complete first), `npm run lint`, all new focused suites, `npm test -- --no-file-parallelism`, `npm run test:e2e`. The routine command is the full `npm test` suite in serial mode: existing `backend/test/operations/bootstrap.spec.ts` rebuilds in `beforeAll`, so serialize routine files to avoid rebuilding while another dist-consuming suite runs. Do not run another build/test process concurrently. Report warnings/errors and individual skips separately. Native checks require operator-supplied isolated `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; never print URI or use application/production data. Absent prerequisites mean skipped/unrun, not passed. Empty test discovery is not evidence. No Google/OpenRouter live calls, new scopes, provisioning or paid checks. Frontend unchanged means frontend checks not required for P1; any unexpected shared-wire/frontend change pauses ownership/scope and requires its checks if authorized.
- [x] **Check docs and commit:** `git diff --check`; confirm exact linked source/test paths exist, enums/code/tests/runbook agree, only P1 checkboxes changed in this plan, no persistent/wire/schema/body change, and no unrelated paths staged. Stage named docs and remaining attributable P1 hunks, then `git commit -m "docs(calendar): document safe visibility and P2 handoff"`. Do not modify `state.md` yourself.
- [x] **Return to orchestrator**: implementation hashes in order, changed shared paths, tests/red-green results/warnings/skips, one offline trace/reproducer, stable diagnostic contract v1 and any gaps. P2 may now plan against verified code; if AC1–AC4 fail, retain/reopen P1 instead. Explicitly report live gate blocked/unrun and review **skipped**. Orchestrator—not this worker—reconciles old plan references and records worker readiness/completion.

### P2 handoff invariants (not a P2 implementation plan)

P2 preserves or deliberately updates `process` contract v1 and the assembled tests after replacing any internal layers. Stage names describe real business boundaries, not an embedded MCP architecture that may disappear. Local rejection must remain not-sent; only the actual Google fetch seam emits attempted/response-received; a true cache hit has zero Calendar HTTP calls. Dispatch/decision/tool/operation correlation, precise safe reasons, bounded correction counts, independent fallback/clarification/uncertain-write outcomes, redaction and throwing-sink isolation survive the final simplified path. A retained event without its actual stage, a stale provider label, or lost correlation fails AC9. Coordinate a versioned diagnostic contract change with P1 before downstream implementation; no silent changes.

### Exit checklist and evidence ownership

- [x] AC1: actual admission-to-terminal offline trace, stage duration and correlated model/tool/provider/cache evidence; ordinary chat path covered.
- [x] AC2: malformed/missing/unknown/type/range/semantic/cursor/duplicate/denial/provider/budget distinctions, precise safe field/constraint and actual correction counts survive real assembly.
- [x] AC3: completed success versus completed fallback/clarification/denial, cancellation, uncertainty and recovery are not conflated; no false success from completed transport.
- [x] AC4: allowlisted logs, fixed bounds/cardinality/no frame storm, detail disabled, no secret/payload/stack, omitted/throwing hook and sink isolation verified.
- [ ] AC9: P2 has stable contract and runnable assembly assertions; **final P2-path AC9 is pending P2/final verification**, not claimed passed by P1.
- [x] AC10: offline, native, live and skipped-review states separated. Unauthorized live gate remains blocked/unrun; only explicit separate live authorization or implementation-only waiver can change that gate, and a waiver never proves live incident resolution.
