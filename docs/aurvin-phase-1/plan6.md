# P6 Session/Chat API and Streaming Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose scoped, validated chat/session routes and a bounded version-1 application stream that delegates all acceptance, execution, cancellation, retry, and durable completion to P5.

**Architecture:** A Nest dynamic module receives one existing P5 runtime, read-only P2 repository ports, P1 server identity, and validated budgets. Thin controllers use strict P1 schemas; a request-owned Express SSE adapter awaits each write and interrupts on disconnect without owning graph/database lifecycle. P9 alone installs the exported parser boundary, API prefix, and application composition; P8 owns admission/rate/readiness/drain/proxy policy.

**Tech Stack:** Existing NestJS 12 / Express 5 adapter, TypeScript ESM with `.js` relative imports, Zod 3, Vitest 4, Supertest, Node HTTP/fetch; actual P2/P5 native integration with deterministic provider fixtures. No new dependency.

---

## Authority, prerequisites, and ownership

- Read [goal](goal.md) §§5/9 and AC01/02/08/10/11/13/17, [research](research.md), [state](state.md), [P1](plan1.md), [P5](plan5.md), root `AGENTS.md`, and actual upstream interface exports. Approval is recorded in state; old awaiting-approval prose is not a renewed gate.
- P1 contracts complete through `db763b6`; P5 plan `2663bfc`, worker `3fd9e1f`..`bb90fcb` complete. P6 can start after this plan is committed and the parent dispatches. Preserve the checked baseline and other owners' work.
- Implementation ownership **only** `backend/src/http/**` and `backend/test/http/**`. This planner commits **only** `docs/aurvin-phase-1/plan6.md`. Never edit contracts/platform/persistence/runtime/model, manifests, frontend, application entry points, state, or operations. Escalate upstream defects to their owners through the parent.
- Workers add root-required descriptive headers to each new `.ts` file; examples intentionally omit those blocks. Keep formatting focused. All npm/npx commands below run in `backend`; Git commands run at repository root in the parent's serialized commit slot. Stage exact filenames, never all files.
- Unified review is **skipped**, not passed. No reviewer dispatch. Meaningful tests, local self-checks, and defect correction are required. No live inference, Azure certification, infrastructure provisioning, deployment, authentication, tools, compaction, or detached execution service in this plan.

## Locked HTTP handoff (P7/P8/P9)

Resource paths are P1 `API_ROUTES`, under a P9-owned `/api` prefix. The existing `frontend/src/api/client.ts` uses these exact methods; do not redefine the shared protocol.

| Method / resource-relative path | Request | Success / behavior |
| --- | --- | --- |
| GET `/sessions` | Optional `cursor`, `limit` | 200 `ListSessionsResponse`; repository stable activity/ID order |
| GET `/sessions/:sessionId` | No query fields | 200 `SessionSummary`; no execution/thread/user fields |
| POST `/sessions` | `SubmitTurnRequest`, `sessionId:null` | 202 `SubmitTurnResponse`; first-input acceptance creates session, never navigation |
| GET `/sessions/:sessionId/messages` | Optional `cursor`, `limit` | 200 `ListMessagesResponse`; newest page in ascending sequence, cursor loads older pages |
| POST `/sessions/:sessionId/turns` | `SubmitTurnRequest`, body session ID must equal path | 202 recorded acceptance identifiers; no inference |
| GET `/sessions/:sessionId/turns/:turnId` | No query fields | 200 latest durable `TurnStatusResponse`; no automatic resubmission/reconciliation |
| GET `/sessions/:sessionId/turns/:turnId/stream` | No query fields; `Accept:text/event-stream` | 200 lazy SSE, latest attempt selected server-side; sole request-owned `executeTurn` |
| POST `/sessions/:sessionId/turns/:turnId/cancel` | `CancelTurnRequest` (`attemptId`) | 204 acknowledgment only, terminal durability checked via status/archive |
| POST `/sessions/:sessionId/turns/:turnId/retry` | `RetryTurnRequest` (`idempotencyKey`) | 202 new/recorded attempt IDs referencing the original input; P5 decides eligibility |

**Duplicate/status contract:** P1 submit/retry response contains identifiers, not a `status` property. Return the same recorded acceptance for a same-key/same-payload duplicate (202); the existing GET status route retrieves recorded lifecycle/result, and messages retrieve saved text. Do not add a response field or execute a duplicate implicitly. P5 owns durable keys, payload mismatch (409), latest-turn/max-three-attempt retry rules, and cross-tab active-turn conflict (409). P6's attachment guard is only a bounded transport reservation, not a second persistence lock or horizontal safety claim.

**Stream:** `data: <JSON version-1 StreamEnvelope>\n\n`, no raw graph/provider frames. Envelope contains session/turn/attempt IDs and attempt-local delivery sequence starting at zero. This sequence is not a persisted replay cursor. Do not support `Last-Event-ID` replay, broadcast, resume from a delta index, or inference by reconnect recovery. Headers: `Content-Type:text/event-stream; charset=utf-8`, `Cache-Control:no-store, no-transform`, `X-Accel-Buffering:no`, `X-Content-Type-Options:nosniff`. Commit headers only on the first validated application event so early conflicts remain JSON errors. No SSE heartbeat timer is needed: P5 emits acceptance before inference and finite provider/total budgets apply; P8 must configure proxy timeouts accordingly.

**Completion:** Forward P5's completed event only after its terminal status, retaining `outcome:'truncated'` distinctly. P6 never turns HTTP 200, EOF, provider end, a fulfilled transport promise, or finalizing into completion. P5 validates checkpoint/application durability including on terminal reattachment. After disconnect, interrupt request-owned execution and let P5 finish/reconcile a sealed result if present; do not overwrite that result with cancelled/interrupted. Cancel acknowledgment does not guarantee stopped upstream charges.

**P8:** Apply admission/rate policy to acceptance/retry and stream GET (stream GET starts inference), protect both UI/API at staging gateway, expose no admin recovery/rebase routes. Inject the same runtime as operations. Export transport `snapshot():{active:number,backpressured:number}` for bounded aggregate telemetry, never user/session labels, prompts, URLs, or error objects. P8 calls P5 `stopAccepting`, `drain`, and quiescent reconciliation directly; a retained transport reservation or unresolved runtime promise is not a drained executor. Provider/database degradation must preserve status/archive access where possible.

**P9:** Import `ChatHttpModule.register(options)` or generated `registerAsync({imports,inject,useFactory})`; supply existing `ChatRuntime`, P2 `SessionRepository`/`MessageRepository`, `ServerIdentityResolver`, `BudgetConfig`. Construct no runtime in HTTP. Bootstrap with `{bodyParser:false}` then call exported `configureChatHttp(app,budgets)` **before** `app.init()`/listen and set global prefix `api`. This installs bounded JSON parsing and client-safe malformed/oversized parser errors; ordinary route exceptions are module/controller scoped. P9 owns CORS/access/bootstrap/global defaults; register the HTTP module once per app. Existing P7 client already uses `/api`, null-session POST, body session ID on follow-ups, GET streaming, cancel 204, and status recovery.

## File map (all worker-owned)

| Exact path | Responsibility |
| --- | --- |
| `backend/src/http/options.ts` | Structural composition of existing runtime/repository/identity/budget ports |
| `backend/src/http/validation.ts` | Strict body/path/query parsing and numerical/UTF-8 limits |
| `backend/src/http/client-errors.ts` | Fixed public messages and canonical status mapping |
| `backend/src/http/chat-http.service.ts` | Read projections and P5 command delegation |
| `backend/src/http/sse-writer.ts` | Scope/order checks, lazy SSE headers, one awaited bounded write |
| `backend/src/http/chat-stream.transport.ts` | Bounded single attachment, disconnect wiring, safe post-header errors |
| `backend/src/http/chat-http.controller.ts` | Exact resource routes and HTTP response codes |
| `backend/src/http/chat-http.filter.ts` | Handler error boundary without stack/provider/private payload exposure |
| `backend/src/http/chat-http.module.ts` | Configurable dynamic module and exported service/transport |
| `backend/src/http/configure-chat-http.ts` | P9-callable JSON parser/security/cache boundary |
| `backend/src/http/index.ts` | Public module/configuration/options exports |
| `backend/src/http/README.md` | Actual worker evidence, integration contract, external limitations |
| `backend/test/http/validation.spec.ts` | Body/query/path/error boundary assertions |
| `backend/test/http/fixtures.ts` | Typed fake ports and known application envelopes, no fake provider guarantee |
| `backend/test/http/service.spec.ts` | Server identity, read projections, command/result validation |
| `backend/test/http/sse-writer.spec.ts` | Fake response drain/error/close/abort/timer/scope/order tests |
| `backend/test/http/stream-transport.spec.ts` | Attachment conflict, deferred finalization, error/no-false-completion |
| `backend/test/http/http-harness.ts` | Isolated real Nest HTTP listener with injected options |
| `backend/test/http/routes.e2e-spec.ts` | Actual route/parser/method/status/no-leak tests with fake ports |
| `backend/test/http/runtime.native.e2e-spec.ts` | Actual P2/P5 route lifecycle, duplicate/retry/disconnect/finalization evidence |
| `backend/test/http/pagination.native.e2e-spec.ts` | Real P2 stable ties, older-message pages, scoped/malformed cursors |

## Task 1: Strict validation and canonical safe errors

**Files:** Create `backend/src/http/options.ts`, `backend/src/http/validation.ts`, `backend/src/http/client-errors.ts`, `backend/test/http/validation.spec.ts`.

- [ ] **Step 1 — Write the failing tests**:

```typescript
// backend/test/http/validation.spec.ts
import { z } from 'zod';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { submitTurnRequestSchema } from '../../src/contracts/api.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { parseBody, pageQuery, pathId, noQuery } from '../../src/http/validation.js';
import { publicError } from '../../src/http/client-errors.js';
const identity = new ServerIdentityResolver({ identity: { userId: 'server-user' } });
const base = { sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' };
it('rejects privileged/unknown fields without returning their values', () => {
  for (const [field, code] of [['userId','IDENTITY_OVERRIDE_REJECTED'], ['model','MODEL_OVERRIDE_REJECTED'],
    ['role','UNKNOWN_FIELD'], ['checkpoint','UNKNOWN_FIELD']] as const) {
    expect(() => parseBody(submitTurnRequestSchema, { ...base, [field]: 'secret' }, identity))
      .toThrow(expect.objectContaining({ code }));
  }
  expect(() => parseBody(submitTurnRequestSchema, [], identity)).toThrow();
  expect(() => parseBody(submitTurnRequestSchema, { ...base, content: ' \n\t' }, identity)).toThrow();
});
it('parses only scalar bounded pagination and opaque bounded cursors', () => {
  expect(pageQuery({}, DEFAULT_BUDGETS)).toEqual({ cursor: null, limit: 20 });
  expect(pageQuery({ limit: '2', cursor: 'opaque' }, DEFAULT_BUDGETS)).toEqual({ cursor: 'opaque', limit: 2 });
  for (const q of [{ limit: '0' }, { limit: '51' }, { limit: '1.5' }, { limit: ['2','3'] },
    { limit: '1e1' }, { limit: '' }, { cursor: '' }, { cursor: 'x'.repeat(2049) }, { userId:'other' }]) {
    expect(() => pageQuery(q, DEFAULT_BUDGETS)).toThrow();
  }
  expect(() => pageQuery({ limit: '3' }, { ...DEFAULT_BUDGETS, maxPageSize: 2, defaultPageSize: 2 })).toThrow();
  expect(() => pathId('\n')).toThrow(); expect(() => pathId('x'.repeat(129))).toThrow();
  expect(() => noQuery({ role: 'system' })).toThrow();
});
it('never serializes exception text, causes, Zod issues, keys, or private state', () => {
  const fault = new AppError('PROVIDER_AUTH', 'sk-private private instructions mongodb://u:p@host');
  expect(publicError(fault)).toEqual({ status: 502, body: { code:'PROVIDER_AUTH',
    message:'The model service is unavailable.', retryable:false } });
  expect(publicError(new Error('checkpoint dump sk-private')).body.code).toBe('PERSISTENCE_ERROR');
  const invalid = z.string().safeParse(123);
  if (!invalid.success) expect(publicError(invalid.error).body.code).toBe('INVALID_REQUEST');
  expect(JSON.stringify(publicError(fault))).not.toMatch(/sk-private|instructions|mongodb|stack|cause/i);
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/http/validation.spec.ts`; expect missing HTTP modules, not unrelated setup errors.
- [ ] **Step 3 — Create the complete definitions**:

```typescript
// backend/src/http/options.ts
import type { ChatRuntime } from '../chat-runtime/index.js';
import type { SessionRepository, MessageRepository } from '../contracts/repositories.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import type { ServerIdentityResolver } from '../platform/identity/server-identity-resolver.js';
export type ChatHttpOptions = {
  runtime: ChatRuntime;
  sessions: SessionRepository;
  messages: MessageRepository;
  identity: Pick<ServerIdentityResolver, 'resolve' | 'assertNoClientOverrides'>;
  budgets: BudgetConfig;
};
```

```typescript
// backend/src/http/client-errors.ts
import { ZodError } from 'zod';
import { HttpException } from '@nestjs/common';
import { AppError } from '../platform/errors/app-error.js';
import { ERROR_HTTP_STATUS, isRetryable, isNeverRetry, type AppErrorCode, type ClientErrorBody } from '../contracts/errors.js';
const messages: Record<AppErrorCode, string> = {
  INVALID_REQUEST: 'The request is invalid.', UNKNOWN_FIELD: 'The request contains an unsupported field.',
  IDENTITY_OVERRIDE_REJECTED: 'Identity is resolved by the server.',
  MODEL_OVERRIDE_REJECTED: 'Model settings are controlled by the server.',
  NOT_FOUND: 'Chat or turn not found.', CONFLICT_ACTIVE_TURN: 'Another request is active or this attempt is no longer current.',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'This request identity was already used for different input.',
  CONTEXT_BUDGET_EXCEEDED: 'This chat is too long. Start a new chat.',
  INPUT_TOO_LARGE: 'The message is too large.', STORAGE_BUDGET_EXCEEDED: 'This chat has reached its storage limit. Start a new chat.',
  RATE_LIMITED: 'Too many requests. Try again shortly.', CONCURRENCY_LIMIT: 'Too many chat requests are active.',
  TIMEOUT: 'The response could not be confirmed in time. Check its status.',
  PROVIDER_ERROR: 'The model service could not answer.', PROVIDER_AUTH: 'The model service is unavailable.',
  PROVIDER_CREDITS: 'The model service is unavailable.', CANCELLED: 'Generation was cancelled.',
  INTERRUPTED: 'Generation was interrupted. Check its status before retrying.',
  PERSISTENCE_ERROR: 'The chat save could not be confirmed. Check its status.',
  CONFIGURATION_ERROR: 'Chat is unavailable.', NOT_READY: 'Chat is not ready. Try again shortly.',
  UNSUPPORTED_TOPOLOGY: 'Chat is unavailable.',
};
export function errorBody(code: AppErrorCode, retryable = isRetryable(code)): ClientErrorBody {
  return { code, message: messages[code], retryable: !isNeverRetry(code) && retryable };
}
export function publicError(error: unknown): { status: number; body: ClientErrorBody } {
  let code: AppErrorCode = 'PERSISTENCE_ERROR'; let retryable: boolean | undefined;
  if (error instanceof AppError) { code = error.code; retryable = error.retryable; }
  else if (error instanceof ZodError) code = 'INVALID_REQUEST';
  else if (error instanceof HttpException) {
    const status = error.getStatus();
    code = status === 413 ? 'INPUT_TOO_LARGE' : status === 429 ? 'RATE_LIMITED' :
      status === 404 ? 'NOT_FOUND' : status < 500 ? 'INVALID_REQUEST' : 'PERSISTENCE_ERROR';
  }
  return { status: ERROR_HTTP_STATUS[code], body: errorBody(code, retryable) };
}
```

```typescript
// backend/src/http/validation.ts
import { z } from 'zod';
import { pageRequestSchema } from '../contracts/api.js';
import { idSchema } from '../contracts/identifiers.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import type { ChatHttpOptions } from './options.js';
import { AppError } from '../platform/errors/app-error.js';
export function parseBody<S extends z.ZodTypeAny>(schema: S, raw: unknown, identity: ChatHttpOptions['identity']): z.infer<S> {
  identity.assertNoClientOverrides(raw);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppError(parsed.error.issues.some(i => i.code === 'unrecognized_keys')
    ? 'UNKNOWN_FIELD' : 'INVALID_REQUEST', 'Invalid request.');
  const data = parsed.data as z.infer<S>;
  if (data && typeof data === 'object' && 'content' in data && typeof data.content === 'string' && !data.content.trim())
    throw new AppError('INVALID_REQUEST', 'Empty message.');
  return data;
}
export function pathId(value: unknown): string {
  const id = idSchema.parse(value);
  if (/[\s/\\?#\u0000-\u001f\u007f]/u.test(id)) throw new AppError('INVALID_REQUEST', 'Invalid identifier.');
  return id;
}
export function noQuery(query: unknown): void { z.object({}).strict().parse(query); }
export function pageQuery(raw: unknown, budgets: BudgetConfig) {
  const query = z.object({ cursor: z.string().min(1).max(2048).optional(),
    limit: z.string().regex(/^[1-9]\d{0,2}$/u).optional() }).strict().parse(raw);
  const page = pageRequestSchema.parse({ cursor: query.cursor ?? null,
    limit: query.limit === undefined ? budgets.defaultPageSize : Number(query.limit) });
  if (page.limit > budgets.maxPageSize) throw new AppError('INVALID_REQUEST', 'Invalid page size.');
  return page;
}
export function inputBounds(content: string, budgets: BudgetConfig): void {
  if (content.length > Math.min(budgets.maxInputChars, 32000) || Buffer.byteLength(content, 'utf8') > budgets.maxMessageBytes)
    throw new AppError('INPUT_TOO_LARGE', 'Input limit exceeded.');
}
```

Strict body schema overlength maps to INVALID_REQUEST unless explicitly prechecked; Task 2 prechecks content bounds before the shared schema for stable 413. Do not trim/normalize stored content: whitespace-only is invalid, but legitimate multiline content and payload identity remain unchanged. P5 performs the stronger token/document/context checks. Query errors are INVALID_REQUEST; unknown body fields have UNKNOWN_FIELD. IDs are bounded path-safe opaque values, not client identity.

- [ ] **Step 4 — Run green:** same validation command and `npx tsc --noEmit --incremental false -p tsconfig.json`; expect pass.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/http/options.ts backend/src/http/validation.ts backend/src/http/client-errors.ts backend/test/http/validation.spec.ts
git commit -m "feat(p6): validate HTTP inputs and normalize public errors"
```

## Task 2: Scoped read service and runtime command delegation

**Files:** Create `backend/src/http/chat-http.service.ts`, `backend/test/http/fixtures.ts`, `backend/test/http/service.spec.ts`.

- [ ] **Step 1 — Write the typed fixtures and failing tests**:

```typescript
// backend/test/http/fixtures.ts
import type { ChatHttpOptions } from '../../src/http/options.js';
import type { StreamEnvelope } from '../../src/contracts/stream.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { session } from '../persistence/fixtures.js';
export const ids = { sessionId:'s1', turnId:'t1', attemptId:'a1', userMessageId:'m0',
  streamPath:'/sessions/s1/turns/t1/stream' };
export const submission = { sessionId:null, content:'Hello', idempotencyKey:'request-0001' };
export function envelope(sequence: number, event: StreamEnvelope['event']): StreamEnvelope {
  return { protocolVersion:1, sessionId:'s1', turnId:'t1', attemptId:'a1', sequence, event };
}
export function fixtureOptions(): ChatHttpOptions {
  return {
    budgets: { ...DEFAULT_BUDGETS }, identity: new ServerIdentityResolver({ identity:{ userId:'server-user' } }),
    sessions: { get:vi.fn(async () => session('server-user','s1')),
      list:vi.fn(async () => ({ items:[], nextCursor:null })), createIfAbsent:vi.fn(async r => r),
      touchActivity:vi.fn(async () => undefined) },
    messages: { append:vi.fn(async () => undefined), list:vi.fn(async () => ({ items:[], nextCursor:null, olderAvailable:false })),
      get:vi.fn(async () => null), updateCompletion:vi.fn(async () => undefined) },
    runtime: { submitTurn:vi.fn(async () => ids), retryTurn:vi.fn(async () => ({ ...ids, attemptId:'a2' })),
      cancelTurn:vi.fn(async () => undefined), getTurnStatus:vi.fn(async () => ({ sessionId:'s1', turnId:'t1',
        attemptId:'a1', status:'accepted' as const, truncated:false, error:null })), reconcileSession:vi.fn(async () => undefined),
      executeTurn:vi.fn(async c => {
        await c.emit(envelope(0, { type:'turn-accepted', userMessageId:'m0' }));
        await c.emit(envelope(1, { type:'status', status:'generating', truncated:false }));
        await c.emit(envelope(2, { type:'delta', text:'Hello' }));
        await c.emit(envelope(3, { type:'status', status:'finalizing', truncated:false }));
        await c.emit(envelope(4, { type:'status', status:'completed', truncated:false }));
        await c.emit(envelope(5, { type:'completed', assistantMessageId:'m2', outcome:'completed' }));
      }), stopAccepting:vi.fn(), snapshot:vi.fn(() => ({ accepting:true, active:0, unresolvedWrites:0, degraded:false })),
      drain:vi.fn(async () => ({ drained:true, active:0, unresolvedWrites:0 })), allowStoppedOwner:vi.fn(),
      rebaseSession:vi.fn(async () => undefined) },
  };
}
export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
```

```typescript
// backend/test/http/service.spec.ts
import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { fixtureOptions, submission, ids } from './fixtures.js';
it('creates only on first input and delegates trusted identity without inference', async () => {
  const o = fixtureOptions(); const s = new ChatHttpService(o);
  expect(await s.submit(null, submission)).toEqual(ids);
  expect(o.runtime.submitTurn).toHaveBeenCalledWith({ ...submission, identity:o.identity.resolve() });
  expect(o.runtime.executeTurn).not.toHaveBeenCalled();
  expect(o.sessions.createIfAbsent).not.toHaveBeenCalled();
  await expect(s.submit('different', { ...submission, sessionId:'s1' })).rejects.toMatchObject({ code:'INVALID_REQUEST' });
  await expect(s.submit(null, { ...submission, content:'😀'.repeat(17000) })).rejects.toMatchObject({ code:'INPUT_TOO_LARGE' });
});
it('projects reads and scopes both missing and foreign sessions to 404', async () => {
  const o = fixtureOptions(); const s = new ChatHttpService(o);
  const summary = await s.session('s1');
  expect(Object.keys(summary).sort()).toEqual(['createdAt','lastActivityAt','sessionId','title']);
  await s.sessions({ limit:'2' }); await s.messages('s1',{ limit:'1' });
  expect(o.sessions.list).toHaveBeenCalledWith('server-user',{ cursor:null, limit:2 });
  expect(o.messages.list).toHaveBeenCalledWith('server-user','s1',{ cursor:null, limit:1 });
  vi.mocked(o.sessions.get).mockResolvedValueOnce(null);
  await expect(s.messages('foreign',{})).rejects.toMatchObject({ code:'NOT_FOUND' });
  expect(o.messages.list).toHaveBeenCalledTimes(1);
});
it('delegates retry/cancel/status, sanitizes nested errors, and rejects privileged fields', async () => {
  const o = fixtureOptions(); const s = new ChatHttpService(o);
  await s.retry('s1','t1',{ idempotencyKey:'retry-0001' });
  await s.cancel('s1','t1',{ attemptId:'a1' });
  expect(o.runtime.cancelTurn).toHaveBeenCalledWith({ identity:o.identity.resolve(), sessionId:'s1', turnId:'t1', attemptId:'a1' });
  vi.mocked(o.runtime.getTurnStatus).mockResolvedValueOnce({ sessionId:'s1',turnId:'t1',attemptId:'a1',
    status:'failed',truncated:false,error:{ code:'PROVIDER_ERROR',message:'sk-private graph prompt',retryable:false } });
  expect(JSON.stringify(await s.status('s1','t1'))).not.toMatch(/sk-private|graph prompt/);
  await expect(s.retry('s1','t1',{ idempotencyKey:'retry-0001', role:'system' })).rejects.toMatchObject({ code:'UNKNOWN_FIELD' });
  expect(o.runtime.reconcileSession).not.toHaveBeenCalled();
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/http/service.spec.ts`; missing service.
- [ ] **Step 3 — Create the service** (dependency token is defined in Task 5; this class is deliberately plain until module factory construction):

```typescript
// backend/src/http/chat-http.service.ts
import { submitTurnRequestSchema, retryTurnRequestSchema, cancelTurnRequestSchema, submitTurnResponseSchema,
  sessionSummarySchema, listSessionsResponseSchema, listMessagesResponseSchema, turnStatusResponseSchema } from '../contracts/api.js';
import { AppError } from '../platform/errors/app-error.js';
import type { ChatHttpOptions } from './options.js';
import { parseBody, pageQuery, pathId, inputBounds } from './validation.js';
import { errorBody } from './client-errors.js';
export class ChatHttpService {
  constructor(readonly o: ChatHttpOptions) {}
  async sessions(query: unknown) {
    return listSessionsResponseSchema.parse(await this.o.sessions.list(this.o.identity.resolve().userId, pageQuery(query,this.o.budgets)));
  }
  async session(id: string) {
    const record = await this.o.sessions.get(this.o.identity.resolve().userId,pathId(id));
    if (!record || record.userId !== this.o.identity.resolve().userId || record.sessionId !== id)
      throw new AppError('NOT_FOUND','Chat not found.');
    return sessionSummarySchema.parse({ sessionId:record.sessionId, title:record.title,
      createdAt:record.createdAt,lastActivityAt:record.lastActivityAt });
  }
  async messages(id: string, query: unknown) {
    const page = pageQuery(query,this.o.budgets); await this.session(id);
    return listMessagesResponseSchema.parse(await this.o.messages.list(this.o.identity.resolve().userId,pathId(id),page));
  }
  async submit(sessionId: string | null, raw: unknown) {
    this.o.identity.assertNoClientOverrides(raw);
    if (raw && typeof raw === 'object' && 'content' in raw && typeof raw.content === 'string') inputBounds(raw.content,this.o.budgets);
    const body = parseBody(submitTurnRequestSchema,raw,this.o.identity);
    if (body.sessionId !== sessionId) throw new AppError('INVALID_REQUEST','Body and route disagree.');
    if (sessionId !== null) pathId(sessionId);
    return submitTurnResponseSchema.parse(await this.o.runtime.submitTurn({ ...body,identity:this.o.identity.resolve() }));
  }
  async status(sessionId: string, turnId: string) {
    await this.session(sessionId);
    const status = turnStatusResponseSchema.parse(await this.o.runtime.getTurnStatus(this.o.identity.resolve().userId,pathId(sessionId),pathId(turnId)));
    return { ...status,error:status.error ? errorBody(status.error.code,status.error.retryable) : null };
  }
  async retry(sessionId: string, turnId: string, raw: unknown) {
    const body = parseBody(retryTurnRequestSchema,raw,this.o.identity); await this.session(sessionId);
    return submitTurnResponseSchema.parse(await this.o.runtime.retryTurn({ ...body,identity:this.o.identity.resolve(),
      sessionId:pathId(sessionId),turnId:pathId(turnId) }));
  }
  async cancel(sessionId: string, turnId: string, raw: unknown) {
    const body = parseBody(cancelTurnRequestSchema,raw,this.o.identity); await this.session(sessionId);
    await this.o.runtime.cancelTurn({ ...body,identity:this.o.identity.resolve(),sessionId:pathId(sessionId),turnId:pathId(turnId) });
  }
}
```

Returned schemas are strict: extra internal fields from a bad port fail closed, never serialize the object directly. P2 already returns safe list/message projections; P6 does not query checkpoints or metadata for UI. Ownership is enforced by server-scoped repository reads and P5 commands, not arbitrary headers/cookies/body fields. Future auth replaces the injected resolver, not HTTP schema identity.

- [ ] **Step 4 — Run green:** service/validation specs and full TypeScript check. Preserve multiline content exactly in command assertions.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/http/chat-http.service.ts backend/test/http/fixtures.ts backend/test/http/service.spec.ts
git commit -m "feat(p6): delegate scoped chat routes to durable runtime"
```

## Task 3: Bounded, awaited SSE writes and scope/order checks

**Files:** Create `backend/src/http/sse-writer.ts`, `backend/test/http/sse-writer.spec.ts`.

- [ ] **Step 1 — Write failing response-level tests**:

```typescript
// backend/test/http/sse-writer.spec.ts
import { EventEmitter } from 'node:events';
import { SseWriter, type SseResponse } from '../../src/http/sse-writer.js';
import { envelope } from './fixtures.js';
class ResponseFixture extends EventEmitter implements SseResponse {
  destroyed = false; writableEnded = false; headersSent = false; writableLength = 0;
  headers: Record<string,string> = {}; frames: string[] = []; ready = true;
  setHeader(name: string, value: string) { this.headers[name] = value; return this; }
  flushHeaders() { this.headersSent = true; }
  write(frame: string) { this.frames.push(frame); return this.ready; }
}
afterEach(() => vi.useRealTimers());
it('does not advance the producer until drain and removes all wait listeners', async () => {
  const res = new ResponseFixture(); res.ready = false;
  const abort = new AbortController(); const writer = new SseWriter(res,abort,20,10000,{ sessionId:'s1',turnId:'t1',attemptId:'a1' });
  let done = false; const pending = writer.emit(envelope(0,{ type:'delta',text:'a\n😀' })).then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false); expect(res.frames).toHaveLength(1);
  res.emit('drain'); await pending;
  expect(res.listenerCount('drain')).toBe(0); expect(res.listenerCount('close')).toBe(0);
  expect(JSON.parse(res.frames[0].slice(6).trim()).event.text).toBe('a\n😀');
  expect(res.headers['Cache-Control']).toBe('no-store, no-transform');
});
it.each(['close','error','abort','timeout'] as const)('settles blocked emit on %s without leaking timers', async event => {
  vi.useFakeTimers(); const res = new ResponseFixture(); res.ready = false;
  const abort = new AbortController(); const writer = new SseWriter(res,abort,5,10000,{ sessionId:'s1',turnId:'t1',attemptId:'a1' });
  const result = expect(writer.emit(envelope(0,{ type:'delta',text:'partial' }))).rejects.toMatchObject({ code:'INTERRUPTED' });
  if (event === 'abort') abort.abort(); else if (event === 'timeout') await vi.advanceTimersByTimeAsync(6);
  else res.emit(event, new Error('private socket details'));
  await result; expect(abort.signal.aborted).toBe(true);
  expect(res.listenerCount('drain')).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it('rejects wrong scope, sequence, private fields, oversized frames, and premature completion before writing', async () => {
  const res = new ResponseFixture(); const writer = new SseWriter(res,new AbortController(),20,1000,{ sessionId:'s1',turnId:'t1',attemptId:'a1' });
  for (const e of [{ ...envelope(0,{ type:'delta',text:'x' }), attemptId:'other' },
    envelope(2,{ type:'delta',text:'x' }), { ...envelope(0,{ type:'delta',text:'x' }), checkpoint:'private' },
    envelope(0,{ type:'delta',text:'x'.repeat(1001) }),
    envelope(0,{ type:'completed',assistantMessageId:'m2',outcome:'completed' })]) {
    await expect(writer.emit(e)).rejects.toThrow();
  }
  expect(res.frames).toEqual([]); expect(res.headersSent).toBe(false);
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/http/sse-writer.spec.ts`.
- [ ] **Step 3 — Create the writer**:

```typescript
// backend/src/http/sse-writer.ts
import type { EventEmitter } from 'node:events';
import { streamEnvelopeSchema, encodeSseFrame, type StreamEnvelope } from '../contracts/stream.js';
import { AppError } from '../platform/errors/app-error.js';
import { errorBody } from './client-errors.js';
export type SseResponse = Pick<EventEmitter,'once'|'off'> & {
  destroyed:boolean; writableEnded:boolean; headersSent:boolean; writableLength:number;
  setHeader(name:string,value:string): unknown; flushHeaders():void; write(chunk:string):boolean;
};
export class SseWriter {
  next = 0; terminal = false; blocked = false;
  private outcome: 'completed' | 'truncated' | null = null;
  constructor(private res:SseResponse, private abort:AbortController, private timeoutMs:number,
    private maxFrameBytes:number, private scope:Pick<StreamEnvelope,'sessionId'|'turnId'|'attemptId'>) {}
  async emit(raw: unknown): Promise<void> {
    if (this.abort.signal.aborted || this.res.destroyed || this.res.writableEnded)
      throw new AppError('INTERRUPTED','Stream closed.',false);
    const e = streamEnvelopeSchema.parse(raw);
    if (e.sessionId !== this.scope.sessionId || e.turnId !== this.scope.turnId || e.attemptId !== this.scope.attemptId ||
      e.sequence !== this.next || this.terminal) throw new AppError('PERSISTENCE_ERROR','Invalid application event.',false);
    if (e.event.type === 'error') e.event = { type:'error',...errorBody(e.event.code,e.event.retryable) };
    if (e.event.type === 'completed' && this.outcome !== e.event.outcome)
      throw new AppError('PERSISTENCE_ERROR','Completion order invalid.',false);
    const frame = encodeSseFrame(e);
    if (Buffer.byteLength(frame,'utf8') > this.maxFrameBytes || this.res.writableLength > this.maxFrameBytes)
      throw new AppError('INTERRUPTED','Stream buffer limit exceeded.',false);
    if (!this.res.headersSent) {
      this.res.setHeader('Content-Type','text/event-stream; charset=utf-8');
      this.res.setHeader('Cache-Control','no-store, no-transform');
      this.res.setHeader('X-Accel-Buffering','no'); this.res.setHeader('X-Content-Type-Options','nosniff');
      this.res.flushHeaders();
    }
    if (!this.res.write(frame)) await this.waitDrain();
    this.next++;
    if (e.event.type === 'status' && ['completed','truncated'].includes(e.event.status))
      this.outcome = e.event.status as 'completed' | 'truncated';
    if (e.event.type === 'completed' || e.event.type === 'error') this.terminal = true;
  }
  private waitDrain(): Promise<void> {
    this.blocked = true;
    return new Promise<void>((resolve,reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const clean = () => { clearTimeout(timer); this.blocked = false; this.res.off('drain',drain);
        this.res.off('error',fail); this.res.off('close',fail); this.abort.signal.removeEventListener('abort',fail); };
      const drain = () => { clean(); resolve(); };
      const fail = () => { clean(); this.abort.abort(); reject(new AppError('INTERRUPTED','Stream write failed.',false)); };
      this.res.once('drain',drain); this.res.once('error',fail); this.res.once('close',fail);
      this.abort.signal.addEventListener('abort',fail,{ once:true });
      timer = setTimeout(fail,this.timeoutMs);
      if (this.abort.signal.aborted || this.res.destroyed || this.res.writableEnded) fail();
    });
  }
}
```

No userland event queue; P5 awaits `emit` before reading more provider output. The Node writable has finite high-water mark plus at most this one bounded frame; bound a frame to `6 * min(maxMessageBytes,65536) + 4096` bytes (JSON escaping worst case), and bounded drain to `idleStreamTimeoutMs`. Only one emit may be pending per P5 execution. A connected HTTP response is not proof a displayed delta is durable. Socket close/error/abort/deadline always settles pending emit so P5 can settle tracked work; do not leave a forever-pending sink promise.

- [ ] **Step 4 — Run green:** writer spec, all HTTP unit tests, TypeScript check. The first supplied test covers non-ASCII/multiline round-trip. Add this repeated-wait regression:

```typescript
// Add to backend/test/http/sse-writer.spec.ts
it('cleans repeated backpressure waits and preserves exact frame order',async () => {
  const res = new ResponseFixture(); res.ready = false;
  const writer = new SseWriter(res,new AbortController(),100,10000,{ sessionId:'s1',turnId:'t1',attemptId:'a1' });
  for (let sequence=0;sequence<5;sequence++) {
    const pending = writer.emit(envelope(sequence,{ type:'delta',text:`part ${sequence}` }));
    res.emit('drain'); await pending;
    expect(res.listenerCount('drain')).toBe(0); expect(res.listenerCount('error')).toBe(0);
  }
  expect(res.frames.map(frame => JSON.parse(frame.slice(6).trim()).sequence)).toEqual([0,1,2,3,4]);
});
```
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/http/sse-writer.ts backend/test/http/sse-writer.spec.ts
git commit -m "feat(p6): stream bounded application frames with awaited backpressure"
```

## Task 4: One request-owned attachment and honest error/disconnect handling

**Files:** Create `backend/src/http/chat-stream.transport.ts`, `backend/test/http/stream-transport.spec.ts`.

- [ ] **Step 1 — Write the failing attachment/finalization tests**:

```typescript
// backend/test/http/stream-transport.spec.ts
import { EventEmitter } from 'node:events';
import type { Request,Response } from 'express';
import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { ChatStreamTransport } from '../../src/http/chat-stream.transport.js';
import { fixtureOptions,envelope,deferred } from './fixtures.js';
function socket() {
  const request = new EventEmitter();
  const response = Object.assign(new EventEmitter(), { destroyed:false,writableEnded:false,headersSent:false,writableLength:0,
    setHeader:vi.fn(),flushHeaders() { this.headersSent = true; },write:vi.fn((_frame:string) => true),
    end() { this.writableEnded = true; } });
  return { request:request as Request,response:response as unknown as Response, raw:response };
}
it('holds the slot until durable execution settles and rejects a second attachment with 409', async () => {
  const o = fixtureOptions(); const sealed = deferred<void>(); const attached = deferred<void>();
  vi.mocked(o.runtime.executeTurn).mockImplementation(async c => {
    await c.emit(envelope(0,{ type:'status',status:'finalizing',truncated:false })); attached.resolve();
    await sealed.promise;
    await c.emit(envelope(1,{ type:'status',status:'completed',truncated:false }));
    await c.emit(envelope(2,{ type:'completed',assistantMessageId:'m2',outcome:'completed' }));
  });
  const t = new ChatStreamTransport(new ChatHttpService(o)); const a = socket();
  const run = t.open('s1','t1',a.request,a.response); await attached.promise;
  const b = socket(); await expect(t.open('s1','t1',b.request,b.response)).rejects.toMatchObject({ code:'CONFLICT_ACTIVE_TURN' });
  expect(a.raw.write.mock.calls.some(call => call[0].includes('"type":"completed"'))).toBe(false);
  expect(t.snapshot().active).toBe(1); sealed.resolve(); await run;
  expect(t.snapshot()).toEqual({ active:0,backpressured:0 }); expect(o.runtime.executeTurn).toHaveBeenCalledTimes(1);
});
it('abort from response close reaches P5 but does not release a still-pending execution', async () => {
  const o = fixtureOptions(); const entered = deferred<void>(); const stopped = deferred<void>();
  vi.mocked(o.runtime.executeTurn).mockImplementation(async c => {
    await c.emit(envelope(0,{ type:'delta',text:'partial' })); entered.resolve();
    await stopped.promise; expect(c.signal.aborted).toBe(true);
  });
  const t = new ChatStreamTransport(new ChatHttpService(o)); const a = socket();
  const run = t.open('s1','t1',a.request,a.response); await entered.promise;
  a.raw.destroyed = true; a.raw.emit('close'); expect(t.snapshot().active).toBe(1);
  stopped.resolve(); await run; expect(t.snapshot().active).toBe(0);
  expect(a.raw.listenerCount('close')).toBe(0);
});
it('normalizes a post-header persistence failure without inventing a failed/completed status', async () => {
  const o = fixtureOptions();
  vi.mocked(o.runtime.executeTurn).mockImplementation(async c => {
    await c.emit(envelope(0,{ type:'status',status:'finalizing',truncated:false }));
    throw new Error('checkpoint dump sk-private private system instructions');
  });
  const t = new ChatStreamTransport(new ChatHttpService(o)); const a = socket();
  await t.open('s1','t1',a.request,a.response);
  const text = a.raw.write.mock.calls.map(call => call[0]).join('');
  expect(text).toContain('PERSISTENCE_ERROR'); expect(text).not.toMatch(/sk-private|checkpoint dump|"type":"completed"|"status":"failed"/);
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/http/stream-transport.spec.ts`.
- [ ] **Step 3 — Create the transport**:

```typescript
// backend/src/http/chat-stream.transport.ts
import type { Request,Response } from 'express';
import { AppError } from '../platform/errors/app-error.js';
import { ChatHttpService } from './chat-http.service.js';
import { SseWriter } from './sse-writer.js';
import { publicError,errorBody } from './client-errors.js';
export class ChatStreamTransport {
  private attachments = new Map<string,SseWriter | null>();
  constructor(private service:ChatHttpService) {}
  snapshot() { return { active:this.attachments.size,
    backpressured:[...this.attachments.values()].filter(w => w?.blocked).length }; }
  async open(sessionId:string,turnId:string,req:Request,res:Response): Promise<void> {
    const o = this.service.o; const userId = o.identity.resolve().userId;
    const key = JSON.stringify([userId,sessionId]);
    if (this.attachments.has(key)) throw new AppError('CONFLICT_ACTIVE_TURN','Stream already attached.');
    if (this.attachments.size >= o.budgets.maxConcurrentGenerationsPerProcess)
      throw new AppError('CONCURRENCY_LIMIT','Too many streams.');
    this.attachments.set(key,null);
    const abort = new AbortController();
    const closed = () => { if (!res.writableEnded) abort.abort(); };
    req.once('aborted',closed); res.once('close',closed); res.once('error',closed);
    if (req.aborted || res.destroyed) abort.abort();
    let writer:SseWriter | undefined; let selectedAttemptId:string | undefined;
    try {
      const status = await this.service.status(sessionId,turnId);
      selectedAttemptId = status.attemptId;
      if (abort.signal.aborted) return;
      // Other tabs may poll status, but cannot attach and own the same run.
      if (['generating','finalizing'].includes(status.status))
        throw new AppError('CONFLICT_ACTIVE_TURN','An attempt is already running or needs recovery.');
      writer = new SseWriter(res,abort,o.budgets.idleStreamTimeoutMs,
        6 * Math.min(o.budgets.maxMessageBytes,65536) + 4096,{ sessionId,turnId,attemptId:status.attemptId });
      this.attachments.set(key,writer);
      await o.runtime.executeTurn({ userId,sessionId,turnId,attemptId:status.attemptId,
        signal:abort.signal,emit:event => writer!.emit(event) });
      // A terminal read-only reattachment can have only a status event in P5.
      if (!writer.terminal && ['failed','cancelled','interrupted'].includes(status.status)) {
        const body = status.error ?? errorBody(status.status === 'cancelled' ? 'CANCELLED' : 'INTERRUPTED',false);
        await writer.emit({ protocolVersion:1,sessionId,turnId,attemptId:status.attemptId,sequence:writer.next,
          event:{ type:'error',...body } });
      }
    } catch (error) {
      if (abort.signal.aborted || res.destroyed) return;
      if (!res.headersSent) throw error;
      if (writer && selectedAttemptId && !writer.terminal) {
        const { body } = publicError(error);
        try { await writer.emit({ protocolVersion:1,sessionId,turnId,
          attemptId:selectedAttemptId,sequence:writer.next,
          event:{ type:'error',...body } }); } catch { abort.abort(); }
      }
    } finally {
      req.off('aborted',closed); res.off('close',closed); res.off('error',closed);
      this.attachments.delete(key);
      if (res.headersSent && !res.destroyed && !res.writableEnded) res.end();
    }
  }
}
```

The catch path retains the **initial selected** attempt ID rather than rereading a potentially newer retry; avoid extra database access in error handling.

Keep full `executeTurn` promise awaited, including saved-result finalization after client disconnect. Do not time out awaiting it and free the reservation early; P5/P8 handle unresolved work/quarantine/drain. Handler/stream error output is fixed code/message only. If P5 already emitted a terminal error/completion, suppress an extra catch-generated error. EOF alone is not terminal: a faulty fulfilled runtime without a terminal event simply closes; the client fetches stored state instead of P6 inventing success. P5 errors before first event retain JSON HTTP status; after headers, emit a sanitized application error, not an HTTP status change or synthetic database lifecycle.

- [ ] **Step 4 — Run green:** transport/writer/service/validation specs, TypeScript check. Add table-driven pre-header NOT_FOUND/conflict/NOT_READY tests in Task 5 actual route tests rather than faking headers.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/http/chat-stream.transport.ts backend/test/http/stream-transport.spec.ts
git commit -m "feat(p6): own stream attachments and interrupt disconnected requests"
```

## Task 5: Export Nest routes/module and bounded parser boundary

**Files:** Create `backend/src/http/chat-http.controller.ts`, `backend/src/http/chat-http.filter.ts`, `backend/src/http/chat-http.module.ts`, `backend/src/http/configure-chat-http.ts`, `backend/src/http/index.ts`, `backend/test/http/http-harness.ts`, `backend/test/http/routes.e2e-spec.ts`.

- [ ] **Step 1 — Write the real listener harness and failing route assertions**:

```typescript
// backend/test/http/http-harness.ts
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ChatHttpModule,configureChatHttp } from '../../src/http/index.js';
import type { ChatHttpOptions } from '../../src/http/options.js';
export async function httpHarness(options:ChatHttpOptions) {
  const module = await Test.createTestingModule({ imports:[ChatHttpModule.register(options)] }).compile();
  const app = module.createNestApplication<NestExpressApplication>({ bodyParser:false,logger:false });
  app.setGlobalPrefix('api'); configureChatHttp(app,options.budgets);
  await app.listen(0,'127.0.0.1');
  return { app,url:await app.getUrl(),close:() => app.close() };
}
```

```typescript
// backend/test/http/routes.e2e-spec.ts
import request from 'supertest';
import { httpHarness } from './http-harness.js';
import { fixtureOptions,submission,ids } from './fixtures.js';
import { AppError } from '../../src/platform/errors/app-error.js';
it('serves exact P7 routes and never persists a chat merely from navigation', async () => {
  const o = fixtureOptions(); const h = await httpHarness(o);
  try {
    const api = request(h.app.getHttpServer());
    await api.get('/api/sessions').expect(200,{ items:[],nextCursor:null });
    await api.get('/api/sessions/s1').expect(200);
    await api.get('/api/sessions/s1/messages?limit=2').expect(200);
    expect(o.runtime.submitTurn).not.toHaveBeenCalled(); expect(o.sessions.createIfAbsent).not.toHaveBeenCalled();
    await api.post('/api/sessions').send(submission).expect(202,ids);
    await api.post('/api/sessions/s1/turns').send({ ...submission,sessionId:'s1' }).expect(202,ids);
    await api.get('/api/sessions/s1/turns/t1').expect(200);
    await api.post('/api/sessions/s1/turns/t1/retry').send({ idempotencyKey:'retry-0001' }).expect(202);
    await api.post('/api/sessions/s1/turns/t1/cancel').send({ attemptId:'a1' }).expect(204);
    const stream = await fetch(`${h.url}/api${ids.streamPath}`,{ headers:{ Accept:'text/event-stream' } });
    expect(stream.status).toBe(200); expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const text = await stream.text(); expect(text).toContain('"protocolVersion":1'); expect(text).toContain('"type":"completed"');
    expect(text).not.toMatch(/graphThread|checkpoint|openRouterUser|apiKey/);
  } finally { await h.close(); }
});
it('returns stable parser/validation errors and ignores forged identity headers', async () => {
  const o = fixtureOptions(); const h = await httpHarness(o);
  try {
    const api = request(h.app.getHttpServer());
    for (const [field,code] of [['userId','IDENTITY_OVERRIDE_REJECTED'], ['modelId','MODEL_OVERRIDE_REJECTED'],
      ['role','UNKNOWN_FIELD'], ['tools','UNKNOWN_FIELD']] as const) {
      const res = await api.post('/api/sessions').send({ ...submission,[field]:'sk-private' }).expect(400);
      expect(res.body.code).toBe(code); expect(JSON.stringify(res.body)).not.toContain('sk-private');
    }
    await api.post('/api/sessions').send({}).expect(400);
    await api.post('/api/sessions').send({ ...submission,sessionId:'s1' }).expect(400);
    await api.post('/api/sessions/s1/turns').send({ ...submission,sessionId:'other' }).expect(400);
    for (const query of ['limit=0','limit=51','limit=2&limit=3','cursor=','cursor[x]=y','userId=other'])
      await api.get(`/api/sessions?${query}`).expect(400);
    const malformed = await api.post('/api/sessions').set('Content-Type','application/json').send('{"apiKey":').expect(400);
    expect(malformed.body.code).toBe('INVALID_REQUEST'); expect(malformed.body).not.toHaveProperty('stack');
    await api.post('/api/sessions').send({ ...submission,content:'x'.repeat(32001) }).expect(413);
    const giant = await api.post('/api/sessions').set('Content-Type','application/json').send(JSON.stringify({ content:'x'.repeat(270000) })).expect(413);
    expect(giant.body.code).toBe('INPUT_TOO_LARGE');
    await api.post('/api/sessions').set('X-User-Id','attacker').send(submission).expect(202);
    expect(o.runtime.submitTurn).toHaveBeenCalledWith(expect.objectContaining({ identity:o.identity.resolve() }));
  } finally { await h.close(); }
});
it('maps P5 conflicts and early stream failures to JSON without leaking exceptions', async () => {
  const o = fixtureOptions(); const h = await httpHarness(o);
  try {
    const api = request(h.app.getHttpServer());
    for (const code of ['IDEMPOTENCY_PAYLOAD_MISMATCH','CONFLICT_ACTIVE_TURN'] as const) {
      vi.mocked(o.runtime.submitTurn).mockRejectedValueOnce(new AppError(code,'private prompt sk-private'));
      const res = await api.post('/api/sessions').send(submission).expect(409);
      expect(res.body.code).toBe(code); expect(res.body.message).not.toMatch(/private/);
    }
    vi.mocked(o.runtime.executeTurn).mockRejectedValueOnce(new AppError('NOT_READY','raw checkpoint'));
    const early = await api.get('/api/sessions/s1/turns/t1/stream').expect(503);
    expect(early.body.code).toBe('NOT_READY'); expect(early.headers['content-type']).toContain('application/json');
    vi.mocked(o.sessions.get).mockResolvedValueOnce(null);
    await api.get('/api/sessions/foreign/messages').expect(404);
    vi.mocked(o.runtime.getTurnStatus).mockRejectedValueOnce(new AppError('NOT_FOUND','private ids'));
    await api.get('/api/sessions/s1/turns/foreign/stream').expect(404);
  } finally { await h.close(); }
});
```

- [ ] **Step 2 — Run red:** `npm run test:e2e -- test/http/routes.e2e-spec.ts`; missing exported HTTP module. This suite runs with no DB or model key.
- [ ] **Step 3 — Create the module/filter/controller/configuration**:

```typescript
// backend/src/http/chat-http.module.ts
import { ConfigurableModuleBuilder,Module } from '@nestjs/common';
import type { ChatHttpOptions } from './options.js';
import { ChatHttpService } from './chat-http.service.js';
import { ChatStreamTransport } from './chat-stream.transport.js';
import { ChatHttpController } from './chat-http.controller.js';
const { ConfigurableModuleClass,MODULE_OPTIONS_TOKEN } = new ConfigurableModuleBuilder<ChatHttpOptions>().build();
@Module({ controllers:[ChatHttpController],providers:[
  { provide:ChatHttpService,inject:[MODULE_OPTIONS_TOKEN],useFactory:(o:ChatHttpOptions) => new ChatHttpService(o) },
  { provide:ChatStreamTransport,inject:[ChatHttpService],useFactory:(s:ChatHttpService) => new ChatStreamTransport(s) },
],exports:[ChatHttpService,ChatStreamTransport] })
export class ChatHttpModule extends ConfigurableModuleClass {}
```

```typescript
// backend/src/http/chat-http.filter.ts
import { Catch,type ArgumentsHost,type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { publicError } from './client-errors.js';
@Catch()
export class ChatHttpFilter implements ExceptionFilter {
  catch(error:unknown,host:ArgumentsHost):void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) { if (!res.destroyed && !res.writableEnded) res.end(); return; }
    const safe = publicError(error); res.setHeader('Cache-Control','no-store');
    res.status(safe.status).json(safe.body);
  }
}
```

```typescript
// backend/src/http/chat-http.controller.ts
import { Body,Controller,Get,Post,Param,Query,Req,Res,HttpCode,Inject,UseFilters } from '@nestjs/common';
import type { Request,Response } from 'express';
import { ChatHttpService } from './chat-http.service.js';
import { ChatStreamTransport } from './chat-stream.transport.js';
import { ChatHttpFilter } from './chat-http.filter.js';
import { noQuery,pathId } from './validation.js';
@Controller('sessions')
@UseFilters(ChatHttpFilter)
export class ChatHttpController {
  constructor(@Inject(ChatHttpService) private service:ChatHttpService,
    @Inject(ChatStreamTransport) private transport:ChatStreamTransport) {}
  @Get() list(@Query() q:unknown) { return this.service.sessions(q); }
  @Post() @HttpCode(202) create(@Body() body:unknown,@Query() q:unknown) {
    noQuery(q); return this.service.submit(null,body);
  }
  @Get(':sessionId') session(@Param('sessionId') s:string,@Query() q:unknown) {
    noQuery(q); return this.service.session(pathId(s));
  }
  @Get(':sessionId/messages') messages(@Param('sessionId') s:string,@Query() q:unknown) {
    return this.service.messages(pathId(s),q);
  }
  @Post(':sessionId/turns') @HttpCode(202) submit(@Param('sessionId') s:string,@Body() body:unknown,@Query() q:unknown) {
    noQuery(q); return this.service.submit(pathId(s),body);
  }
  @Get(':sessionId/turns/:turnId') status(@Param('sessionId') s:string,@Param('turnId') t:string,@Query() q:unknown) {
    noQuery(q); return this.service.status(pathId(s),pathId(t));
  }
  @Post(':sessionId/turns/:turnId/retry') @HttpCode(202)
  retry(@Param('sessionId') s:string,@Param('turnId') t:string,@Body() body:unknown,@Query() q:unknown) {
    noQuery(q); return this.service.retry(pathId(s),pathId(t),body);
  }
  @Post(':sessionId/turns/:turnId/cancel') @HttpCode(204)
  cancel(@Param('sessionId') s:string,@Param('turnId') t:string,@Body() body:unknown,@Query() q:unknown) {
    noQuery(q); return this.service.cancel(pathId(s),pathId(t),body);
  }
  @Get(':sessionId/turns/:turnId/stream')
  stream(@Param('sessionId') s:string,@Param('turnId') t:string,@Query() q:unknown,@Req() req:Request,@Res() res:Response) {
    noQuery(q); return this.transport.open(pathId(s),pathId(t),req,res);
  }
}
```

```typescript
// backend/src/http/configure-chat-http.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request,Response,NextFunction } from 'express';
import type { BudgetConfig } from '../contracts/budgets.js';
import { errorBody } from './client-errors.js';
export function configureChatHttp(app:NestExpressApplication,budgets:BudgetConfig):void {
  app.use((_req:Request,res:Response,next:NextFunction) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); next();
  });
  // JSON can escape one UTF-16 code unit as six ASCII bytes. Fixed envelope reserve.
  const limit = Math.min(262144,Math.min(budgets.maxInputChars,32000) * 6 + 4096);
  app.useBodyParser('json',{ limit,strict:true });
  app.use((error:unknown,_req:Request,res:Response,next:NextFunction) => {
    const fault = error && typeof error === 'object' ? error as { type?:unknown; status?:unknown } : null;
    if (fault?.type === 'entity.too.large') { res.status(413).json(errorBody('INPUT_TOO_LARGE')); return; }
    if (fault?.type === 'entity.parse.failed' || fault?.status === 400) { res.status(400).json(errorBody('INVALID_REQUEST')); return; }
    next(error);
  });
}
```

```typescript
// backend/src/http/index.ts
export { ChatHttpModule } from './chat-http.module.js';
export { ChatHttpService } from './chat-http.service.js';
export { ChatStreamTransport } from './chat-stream.transport.js';
export { configureChatHttp } from './configure-chat-http.js';
export type { ChatHttpOptions } from './options.js';
```

Do not use Nest `@Sse()` Observable buffering: P5's promise sink needs real awaited Node backpressure. Use `@Res()` only on the stream method. The ordinary routes stay Nest-managed; inject tokens explicitly so Vitest transpilation does not depend on emitted constructor metadata. ConfigurableModuleBuilder defaults generate `register`/`registerAsync`; current Nest documentation confirms manual response handling and dynamic factories. No `APP_FILTER` side effect on unrelated modules. P9 must actually call the exported parser configuration; controller filters do not catch errors thrown before routing. Type-only Express imports use existing declared typings, no unlisted runtime package import.

- [ ] **Step 4 — Run green:** route e2e, HTTP unit specs, full type check/build/lint. Add async-module registration regression before closing this task:

```typescript
// Add to backend/test/http/routes.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { ChatHttpModule,ChatHttpService } from '../../src/http/index.js';
it('supports async P9 composition without manufacturing another runtime', async () => {
  const options = fixtureOptions();
  const module = await Test.createTestingModule({ imports:[ChatHttpModule.registerAsync({
    useFactory:async () => options,
  })] }).compile();
  try { expect(module.get(ChatHttpService).o.runtime).toBe(options.runtime); }
  finally { await module.close(); }
});
```

- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/http/chat-http.controller.ts backend/src/http/chat-http.filter.ts backend/src/http/chat-http.module.ts backend/src/http/configure-chat-http.ts backend/src/http/index.ts backend/test/http/http-harness.ts backend/test/http/routes.e2e-spec.ts
git commit -m "feat(p6): export validated Nest chat routes and parser boundary"
```

## Task 6: Prove real runtime lifecycle through actual HTTP

**Files:** Create `backend/test/http/runtime.native.e2e-spec.ts`. Minimal defects only in an exact owning HTTP file; upstream defects go to P5/P2/P1 via parent.

- [ ] **Step 1 — Add behavioral native tests before any correction**. They use P5's read-only native harness, actual P2 bundle/standard saver, real Nest socket, and provider fixtures, not mocked runtime success. Each generated native database is owned by its harness. Native URI/prefix must be operator-supplied; missing configuration is blocked evidence, not a skipped-green result.

```typescript
// backend/test/http/runtime.native.e2e-spec.ts
import request from 'supertest';
import { nativeHarness } from '../runtime/native-harness.js';
import { httpHarness } from './http-harness.js';
import { createChatRuntime } from '../../src/chat-runtime/index.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { parseSseDataLine } from '../../src/contracts/stream.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';
async function nativeHttp(text:string = FRAMES.normal) {
  const h = await nativeHarness(text); const runtime = createChatRuntime(h.deps);
  try {
    const http = await httpHarness({ runtime,sessions:h.persistence.sessions,messages:h.persistence.messages,
      identity:new ServerIdentityResolver(h.deps.config),budgets:h.deps.config.budgets });
    return { ...h,http,runtime,close:async () => { await http.close(); await h.close(); } };
  } catch (error) { await h.close(); throw error; }
}
const command = { sessionId:null,content:'Hello',idempotencyKey:'request-0001' };
function frames(text:string) { return text.split('\n').filter(line => line.startsWith('data:')).map(parseSseDataLine); }
it('accepts once before inference, returns duplicates, rejects conflicts, then streams durable completion', async () => {
  const h = await nativeHttp();
  try {
    const api = request(h.http.app.getHttpServer());
    const [one,two] = await Promise.all([api.post('/api/sessions').send(command),api.post('/api/sessions').send(command)]);
    expect(one.status).toBe(202); expect(two.status).toBe(202); expect(one.body).toEqual(two.body);
    const ids = one.body as { sessionId:string;turnId:string;attemptId:string;streamPath:string };
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(await h.persistence.metadata.getAcceptance(h.identity.userId,ids.sessionId,ids.attemptId)).not.toBeNull();
    await api.post('/api/sessions').send({ ...command,content:'Changed' }).expect(409);
    await api.post(`/api/sessions/${ids.sessionId}/turns`).send({ ...command,sessionId:ids.sessionId,idempotencyKey:'request-0002' }).expect(409);
    const response = await fetch(`${h.http.url}/api${ids.streamPath}`); const events = frames(await response.text());
    expect(events.map(e => e.sequence)).toEqual(events.map((_,i) => i));
    expect(events.at(-1)?.event).toMatchObject({ type:'completed',outcome:'completed' });
    expect(events.some(e => e.event.type === 'usage')).toBe(true);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    const outgoing = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body)) as { user:string;model:string };
    expect(outgoing.user).toBe(h.identity.userId); expect(outgoing.model).toBe(h.deps.config.openRouter.modelId);
    const status = await api.get(`/api/sessions/${ids.sessionId}/turns/${ids.turnId}`).expect(200);
    expect(status.body.status).toBe('completed');
    const archive = await api.get(`/api/sessions/${ids.sessionId}/messages`).expect(200);
    expect(archive.body.items.map((m:{ role:string }) => m.role)).toEqual(['user','assistant']);
    const reattach = await fetch(`${h.http.url}/api${ids.streamPath}`);
    expect(frames(await reattach.text()).some(e => e.event.type === 'delta')).toBe(false);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  } finally { await h.close(); }
},30000);
it.each([['length','truncated'],['errorBefore','failed'],['errorAfter','failed'],['eof','interrupted']] as const)
('reports %s honestly and never treats a provider EOF/error as saved success',async (fixture,outcome) => {
  const h = await nativeHttp(FRAMES[fixture]);
  try {
    const api = request(h.http.app.getHttpServer()); const accepted = await api.post('/api/sessions').send(command).expect(202);
    const ids = accepted.body as { sessionId:string;turnId:string;streamPath:string };
    const stream = await fetch(`${h.http.url}/api${ids.streamPath}`); const events = frames(await stream.text());
    const status = await h.runtime.getTurnStatus(h.identity.userId,ids.sessionId,ids.turnId);
    expect(status.status).toBe(outcome);
    expect(events.some(e => e.event.type === 'completed' && e.event.outcome === 'completed')).toBe(false);
    if (fixture === 'length') expect(events.at(-1)?.event).toMatchObject({ type:'completed',outcome:'truncated' });
  } finally { await h.close(); }
},30000);
it('cancel before attachment and explicit retry keep one original user input',async () => {
  const h = await nativeHttp();
  try {
    const api = request(h.http.app.getHttpServer()); const accepted = await api.post('/api/sessions').send(command).expect(202);
    const ids = accepted.body as { sessionId:string;turnId:string;attemptId:string;userMessageId:string };
    const path = `/api/sessions/${ids.sessionId}/turns/${ids.turnId}`;
    await api.post(`${path}/cancel`).send({ attemptId:ids.attemptId }).expect(204);
    expect((await api.get(path).expect(200)).body.status).toBe('cancelled');
    const retried = await api.post(`${path}/retry`).send({ idempotencyKey:'retry-0001' }).expect(202);
    await api.post(`${path}/retry`).send({ idempotencyKey:'retry-0001' }).expect(202,retried.body);
    expect(retried.body.userMessageId).toBe(ids.userMessageId); expect(retried.body.attemptId).not.toBe(ids.attemptId);
    await api.post(`${path}/cancel`).send({ attemptId:ids.attemptId }).expect(409);
    const stream = await fetch(`${h.http.url}/api${retried.body.streamPath}`); await stream.text();
    const archive = await api.get(`/api/sessions/${ids.sessionId}/messages`).expect(200);
    expect(archive.body.items.filter((m:{ role:string }) => m.role === 'user')).toHaveLength(1);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  } finally { await h.close(); }
},30000);
```

P4's abrupt EOF parser reports INTERRUPTED; preserve upstream classification, not a synthetic completed/failed result. Actual client disconnect is interrupted and explicit cancellation is cancelled. Add the concrete disconnect and finalization-window assertions next:

```typescript
// Add imports and tests to backend/test/http/runtime.native.e2e-spec.ts
import { deferred } from './fixtures.js';
it('disconnect after a delta interrupts one run, keeps partials incomplete, and leaves status readable',async () => {
  const h = await nativeHttp(); const release = deferred<void>(); const stopped = deferred<void>();
  const providerAborted = deferred<void>();
  try {
    const api = request(h.http.app.getHttpServer());
    h.fetcher.mockImplementation(async (_url,init) => {
      const signal = init?.signal;
      if (signal?.aborted) providerAborted.resolve();
      else signal?.addEventListener('abort',() => providerAborted.resolve(),{ once:true });
      return new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(new TextEncoder().encode('data: {"id":"gen_disconnect","choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n'));
            await release.promise;
            controller.enqueue(new TextEncoder().encode('data: {"id":"gen_disconnect","choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
            controller.close();
          } catch { controller.error(new Error('fixture source closed')); }
          finally { stopped.resolve(); }
        },
      }),{ headers:{ 'content-type':'text/event-stream' } });
    });
    const accepted = await api.post('/api/sessions').send(command).expect(202);
    const ids = accepted.body as { sessionId:string;turnId:string;streamPath:string };
    const abort = new AbortController(); const response = await fetch(`${h.http.url}/api${ids.streamPath}`,{ signal:abort.signal });
    const reader = response.body!.getReader(); let text = '';
    while (!text.includes('"type":"delta"')) { const value = await reader.read(); if (value.done) throw new Error('no delta'); text += new TextDecoder().decode(value.value); }
    abort.abort(); await reader.cancel().catch(() => undefined);
    await providerAborted.promise; release.resolve(); await stopped.promise;
    // Runtime owns asynchronous interruption persistence; wait boundedly, never resubmit.
    let status = await h.runtime.getTurnStatus(h.identity.userId,ids.sessionId,ids.turnId);
    for (let n=0;n<100 && ['accepted','generating','finalizing'].includes(status.status);n++) {
      await new Promise(resolve => setTimeout(resolve,10)); status = await h.runtime.getTurnStatus(h.identity.userId,ids.sessionId,ids.turnId);
    }
    expect(status.status).toBe('interrupted'); expect(h.fetcher).toHaveBeenCalledTimes(1);
    const archive = await api.get(`/api/sessions/${ids.sessionId}/messages`).expect(200);
    expect(archive.body.items.find((m:{ role:string }) => m.role === 'assistant')?.completionStatus).toBe('interrupted');
    expect(text).not.toContain('"type":"completed"');
  } finally { release.resolve(); await h.close(); }
},30000);
it('does not emit completion when finalization fails; recovery reuses the saved result without a new POST',async () => {
  const h = await nativeHttp();
  try {
    const api = request(h.http.app.getHttpServer()); const accepted = await api.post('/api/sessions').send(command).expect(202);
    const ids = accepted.body as { sessionId:string;turnId:string;streamPath:string };
    const append = h.persistence.messages.append.bind(h.persistence.messages);
    const fault = vi.spyOn(h.persistence.messages,'append').mockImplementation(async record => {
      if (record.role === 'assistant') throw new Error('fixture archive failure sk-private'); return append(record);
    });
    let text:string;
    try { const response = await fetch(`${h.http.url}/api${ids.streamPath}`); text = await response.text(); }
    finally { fault.mockRestore(); }
    expect(text).not.toContain('"type":"completed"'); expect(text).not.toContain('sk-private');
    expect((await h.runtime.getTurnStatus(h.identity.userId,ids.sessionId,ids.turnId)).status).toBe('finalizing');
    const recovered = createChatRuntime(h.deps); // P8 would orchestrate quiescent recovery, never an HTTP repair route.
    await recovered.reconcileSession(h.identity.userId,ids.sessionId);
    await recovered.reconcileSession(h.identity.userId,ids.sessionId);
    expect((await api.get(`/api/sessions/${ids.sessionId}/turns/${ids.turnId}`).expect(200)).body.status).toBe('completed');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  } finally { await h.close(); }
},30000);
```

The controlled source holds provider termination until the outgoing request's AbortSignal fires, eliminating the race where a deliberately released provider terminal frame seals a result before the server sees socket close. The test's 30-second timeout bounds missing abort propagation. Do not use sleeps alone as durability evidence: poll authoritative status with a finite 1-second terminal budget after provider settlement. Saved-result recovery can legitimately complete after disconnect if seal won the race; this test specifically stops before seal. Task 7 separately proves cancel-after-seal completes rather than interrupts.

- [ ] **Step 2 — Run red/coverage:** `npm run test:e2e -- test/http/runtime.native.e2e-spec.ts`. If already passing against implemented HTTP, record coverage-green honestly; do not break upstream code to manufacture failure. For a failing assertion, first verify it reached intended lifecycle/window.
- [ ] **Step 3 — Correct only the smallest responsible HTTP implementation**. Example correction for a missed response close is exactly the `res.once('close',closed)` plus signal forwarding in Task 4, not a P5 lifecycle rewrite. For failing native EOF/outcome semantics, read P5/P4 actual status and escalate genuine upstream defects.
- [ ] **Step 4 — Run green:** native HTTP suite, HTTP route/unit suites, TypeScript/build/lint. Record native URI environment **without value**, prefix, test counts, and fixture-only provider use. This is not Azure or genuine process-kill/staging evidence.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/test/http/runtime.native.e2e-spec.ts
git commit -m "test(p6): verify HTTP durable acceptance outcomes and disconnect recovery"
```

If a production HTTP correction was needed, stage that exact owned filename in the same serialized commit; no upstream source belongs here.

## Task 7: Stable pagination, isolation, and finalization barriers

**Files:** Create `backend/test/http/pagination.native.e2e-spec.ts`; extend `backend/test/http/runtime.native.e2e-spec.ts`, `backend/test/http/routes.e2e-spec.ts`, `backend/test/http/sse-writer.spec.ts`.

- [ ] **Step 1 — Write the additional failing/coverage regressions**:

```typescript
// backend/test/http/pagination.native.e2e-spec.ts
import request from 'supertest';
import { nativeHarness } from '../runtime/native-harness.js';
import { httpHarness } from './http-harness.js';
import { createChatRuntime } from '../../src/chat-runtime/index.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { session,message } from '../persistence/fixtures.js';
it('pages stable same-time session ties and older messages with no duplicates or scope leaks',async () => {
  const h = await nativeHarness(); let http:Awaited<ReturnType<typeof httpHarness>> | undefined;
  try {
    const u = h.identity.userId;
    for (const s of ['s1','s2','s3']) await h.persistence.sessions.createIfAbsent({ ...session(u,s),latestTurnId:'t1' });
    await h.persistence.sessions.createIfAbsent({ ...session('foreign','s1'),latestTurnId:'t1' });
    for (const n of [0,1,2,3,4]) await h.persistence.messages.append(message(n,u,'s1'));
    await h.persistence.messages.append({ ...message(99,'foreign','s1'),content:'foreign secret' });
    http = await httpHarness({ runtime:createChatRuntime(h.deps),sessions:h.persistence.sessions,messages:h.persistence.messages,
      identity:new ServerIdentityResolver(h.deps.config),budgets:h.deps.config.budgets });
    const api = request(http.app.getHttpServer());
    let cursor:string | null = null; const seen:string[] = [];
    do {
      const page:request.Response = await api.get('/api/sessions').query({ limit:2,...(cursor ? { cursor } : {}) }).expect(200);
      seen.push(...page.body.items.map((s:{ sessionId:string }) => s.sessionId)); cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['s3','s2','s1']); expect(new Set(seen).size).toBe(3);
    const newest = await api.get('/api/sessions/s1/messages?limit=2').expect(200);
    expect(newest.body.items.map((m:{ sequence:number }) => m.sequence)).toEqual([3,4]);
    expect(newest.body.olderAvailable).toBe(true);
    const older = await api.get('/api/sessions/s1/messages').query({ limit:2,cursor:newest.body.nextCursor }).expect(200);
    expect(older.body.items.map((m:{ sequence:number }) => m.sequence)).toEqual([1,2]);
    const oldest = await api.get('/api/sessions/s1/messages').query({ limit:2,cursor:older.body.nextCursor }).expect(200);
    expect(oldest.body.items.map((m:{ sequence:number }) => m.sequence)).toEqual([0]);
    expect(oldest.body.olderAvailable).toBe(false);
    expect(JSON.stringify([newest.body,older.body,oldest.body])).not.toContain('foreign secret');
    await api.get('/api/sessions/s2/messages').query({ cursor:newest.body.nextCursor }).expect(400);
    await api.get('/api/sessions?cursor=malformed').expect(400);
  } finally { if (http) await http.close(); await h.close(); }
},30000);
```

Read P2's actual session sort/cursor interface: the current stable tie order is activity descending then session ID descending. If it differs, assert its documented stable tie-breaker rather than sorting in HTTP (which would corrupt pagination). Foreign/malformed cursor rejection is P2-owned; preserve opaque cursor strings through P6 with only the 2,048-character request cap.

```typescript
// Add to backend/test/http/runtime.native.e2e-spec.ts (nativeHttp/frames/deferred already defined)
it('blocks a second stream and completion until application finalization is released',async () => {
  const h = await nativeHttp(); const entered = deferred<void>(); const release = deferred<void>();
  try {
    const api = request(h.http.app.getHttpServer()); const accepted = await api.post('/api/sessions').send(command).expect(202);
    const ids = accepted.body as { sessionId:string;turnId:string;attemptId:string;streamPath:string };
    const append = h.persistence.messages.append.bind(h.persistence.messages);
    const barrier = vi.spyOn(h.persistence.messages,'append').mockImplementation(async record => {
      if (record.role === 'assistant') { entered.resolve(); await release.promise; } return append(record);
    });
    const response = await fetch(`${h.http.url}/api${ids.streamPath}`); const reader = response.body!.getReader();
    let partial = '';
    try {
      await entered.promise;
      await api.get(`/api${ids.streamPath}`).expect(409);
      await api.post(`/api/sessions/${ids.sessionId}/turns/${ids.turnId}/cancel`).send({ attemptId:ids.attemptId }).expect(204);
      expect((await h.runtime.getTurnStatus(h.identity.userId,ids.sessionId,ids.turnId)).status).toBe('finalizing');
      // Read until finalizing; no successful terminal event may precede the held durable archive write.
      while (!partial.includes('"status":"finalizing"')) {
        const chunk = await reader.read(); if (chunk.done) throw new Error('early EOF'); partial += new TextDecoder().decode(chunk.value);
      }
      expect(partial).not.toContain('"type":"completed"'); release.resolve();
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; partial += new TextDecoder().decode(chunk.value); }
      expect(frames(partial).at(-1)?.event).toMatchObject({ type:'completed',outcome:'completed' });
      const assistant = (await h.persistence.messages.list(h.identity.userId,ids.sessionId,{ cursor:null,limit:50 })).items.find(m => m.role === 'assistant');
      expect(assistant?.completionStatus).toBe('completed');
      expect((await h.persistence.sessions.get(h.identity.userId,ids.sessionId))?.execution.activeAttemptId).toBeNull();
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { release.resolve(); barrier.mockRestore(); reader.releaseLock(); }
  } finally { release.resolve(); await h.close(); }
},30000);
```

```typescript
// Add to backend/test/http/routes.e2e-spec.ts
it('rejects unknown stream/query fields, returns terminal error reattachments honestly, and never exposes internals',async () => {
  const o = fixtureOptions(); const h = await httpHarness(o);
  try {
    const api = request(h.app.getHttpServer());
    await api.get('/api/sessions/s1/turns/t1/stream?checkpoint=private').expect(400);
    await api.post('/api/sessions/s1/turns/t1/cancel').send({ attemptId:'a1',user:'other' }).expect(400);
    vi.mocked(o.runtime.executeTurn).mockImplementationOnce(async c => {
      await c.emit({ protocolVersion:1,sessionId:c.sessionId,turnId:c.turnId,attemptId:c.attemptId,sequence:0,
        event:{ type:'status',status:'failed',truncated:false } });
    });
    vi.mocked(o.runtime.getTurnStatus).mockResolvedValueOnce({ sessionId:'s1',turnId:'t1',attemptId:'a1',status:'failed',truncated:false,
      error:{ code:'PROVIDER_ERROR',message:'sk-private stack graph prompt',retryable:false } });
    const response = await fetch(`${h.url}/api/sessions/s1/turns/t1/stream`); const text = await response.text();
    expect(text).toContain('"type":"error"'); expect(text).not.toMatch(/sk-private|graph prompt|"type":"completed"/);
    vi.mocked(o.runtime.getTurnStatus).mockRejectedValueOnce(new Error('raw mongo dump private instructions'));
    const failure = await api.get('/api/sessions/s1/turns/t1').expect(503);
    expect(Object.keys(failure.body).sort()).toEqual(['code','message','retryable']);
    expect(JSON.stringify(failure.body)).not.toMatch(/mongo|instructions|stack|cause/);
  } finally { await h.close(); }
});
```

- [ ] **Step 2 — Run red/coverage:** `npm run test:e2e -- test/http/pagination.native.e2e-spec.ts test/http/runtime.native.e2e-spec.ts test/http/routes.e2e-spec.ts`. Record an already-green coverage regression honestly.
- [ ] **Step 3 — Apply only demonstrated owned corrections**; do not sort repository pages, create a second runtime, fabricate completion, or rewrite upstream retry/cancel semantics. Required example tightening for an emit overflow is this bounded writer check already provided in Task 3:

```typescript
if (Buffer.byteLength(frame,'utf8') > this.maxFrameBytes || this.res.writableLength > this.maxFrameBytes)
  throw new AppError('INTERRUPTED','Stream buffer limit exceeded.',false);
```

- [ ] **Step 4 — Run the full P6 test set** and type/build/lint; no unresolved HTTP regression may be deferred to a skipped review. Failure from missing native DB prevents full P6 exit. Do not run selected-service scripts to obtain a misleading pass.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/test/http/pagination.native.e2e-spec.ts backend/test/http/runtime.native.e2e-spec.ts backend/test/http/routes.e2e-spec.ts
git commit -m "test(p6): verify scoped pagination and durable stream finalization barriers"
```

Only include `backend/test/http/sse-writer.spec.ts` or an exact HTTP production file if genuinely extended/corrected; never stage unrelated unchanged paths or directories.

## Task 8: Verify exit and record P8/P9 handoff evidence

**Files:** Create `backend/src/http/README.md`; corrections only in previously listed owning HTTP files after regression tests.

- [ ] **Step 1 — Run deterministic HTTP units:**

```powershell
npx vitest run test/http/validation.spec.ts test/http/service.spec.ts test/http/sse-writer.spec.ts test/http/stream-transport.spec.ts
```

Expected: all pass; fixed safe errors, strict scalar queries, identity forwarding, bounded awaited backpressure, detach/cleanup, one attachment, no premature success.

- [ ] **Step 2 — Run actual route and native runtime suites:**

```powershell
npm run test:e2e -- test/http/routes.e2e-spec.ts
npm run test:e2e -- test/http/runtime.native.e2e-spec.ts test/http/pagination.native.e2e-spec.ts
```

Native requirements: operator-set `AURVIN_TEST_MONGODB_URI` (never echo), `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; P2 harness generates/deletes only its isolated test databases. Use existing operator-provided loopback native target. No secret `.env` read, live paid model, Azure target, or broad deletion. Expect real HTTP + P2/P5 durability/order/isolation/cancel/retry/disconnect/finalization assertions pass. Genuine process kill, selected Azure, proxy/access/backup/drain evidence remain P8/P10.

- [ ] **Step 3 — Run compilation and existing backend checks**:

```powershell
npx tsc --noEmit --incremental false -p tsconfig.json
npm run build
npm run lint
npm test
npm run test:e2e
```

Expected: source **and tests** type-check; backend build succeeds; lint has no new error (record upstream warnings separately); unit suites all pass. `npm test` excludes e2e. Full repository `npm run test:e2e` with the configured native fixture environment is required before handing off; existing P2/P5 tests remain covered. Do not run unrelated frontend checks for this documentation/backend-owned unit. Do not claim AC16 or production readiness from local success.

- [ ] **Step 4 — Write `backend/src/http/README.md`** using these literal policy sections and replace evidence entries only with actual measured outcomes:

```markdown
# Chat HTTP transport

## P9 assembly
ChatHttpModule.register / registerAsync accepts existing ChatRuntime, SessionRepository,
MessageRepository, ServerIdentityResolver, and BudgetConfig. Register once. Bootstrap with
bodyParser:false; configureChatHttp(app,budgets) before init/listen; set global prefix api.
No HTTP module constructs a second runtime or changes application entry points.

## Routes and lifecycle
GET sessions/session/messages/status; POST sessions accepts first input with sessionId:null;
POST session turns requires matching body/path session ID; retry returns original-user-linked
attempt; cancel returns 204 acknowledgment. Submit/retry return 202 acceptance IDs, including
duplicates. GET status/archive recovers durable state; reconnect never resubmits the prompt.
GET stream executes the latest accepted attempt once. Early errors are safe JSON; after first
event, errors are version-1 application frames. Headers disable caching/proxy buffering.
No SSE replay cursor, broadcast queue, private state, model override, or detached run exists.

## Resource and security boundary
Strict body/unknown-field validation, path-safe bounded IDs, bounded scalar cursor/page size,
configured UTF-8/input checks, finite JSON body cap, one awaited bounded frame/drain deadline.
Server identity ignores forged client headers. Error messages are fixed allowlisted public text.
Disconnect interrupts unless a sealed result must finalize; cancelled and truncated are distinct.
Cancel acknowledgment does not guarantee stopped charges. EOF/HTTP 200 never means completion.

## P8 hooks and rollout limits
ChatStreamTransport.snapshot exports active/backpressured aggregate counts only. P8 wraps
acceptance/retry/stream admission, rate/readiness/telemetry, runtime drain/reconcile, staging
gateway/proxy and retention/backup policy. Single-process sentinel topology remains mandatory.
No recovery/rebase admin endpoint. Actual Azure service, live provider capabilities, proxy/access,
process-kill/backup/restore evidence and public-production decisions are external gates.

## Actual verification
Record exact worker commit set, date/Node versions, unit/route/native/type/build/lint commands,
test counts/results, native isolated environment without credentials, measured frame/body limits,
and remaining limitations. Unified review is skipped, not passed. Distinguish fixtures from staging.
```

- [ ] **Step 5 — Check ownership and commit evidence**. Run root `git diff --check`, `git status --short`, and `git diff --name-only`; no source changes outside `backend/src/http/**` / `backend/test/http/**`. Parent records workflow state; no P6 state edit.

```powershell
git add backend/src/http/README.md
git commit -m "docs(p6): record HTTP transport evidence and assembly handoff"
```

If a test-driven correction was required, commit its exact owned test/source files separately before evidence. Never create an empty verification commit or claim planned tests ran.

## Coverage and readiness

| Requirement | Concrete tasks/evidence |
| --- | --- |
| AC01 sessions/navigation/history | 2/5/6/7: first-input creation only, metadata projection, title from P5, stable session pages and older message pages |
| AC02 application streaming | 3/4/5/6/7: accepted/status/delta/usage/completed v1 frames, provisional/finalizing and truncated distinctions |
| AC08 duplicate/conflict/retry | 2/5/6: identical simultaneous requests share one recorded acceptance/input; changed payload/new active input 409; explicit retry reuses user message |
| AC10 durable acceptance/finalization | 6/7: zero inference before accepted marker, native held archive write, saved-result recovery without second POST |
| AC11 failure/disconnect/cancel/EOF | 3/4/5/6/7: pre-header JSON, post-header safe events, bounded drain, client abort interrupted, cancel acknowledgement, length/EOF/finalization failures |
| AC13 server identity/key/model | 1/2/5/6: reject privileged fields, ignore identity headers, outgoing P5 identity, no private-state/key serialization |
| AC17 validation/redaction | 1/2/3/5/7: strict unknown fields, malformed/oversized JSON, UTF-8/path/query bounds, fixed public errors; UI rendering P7 and staging controls P8 |
| P6 exit gate | All: actual route scoping/pages/conflicts/disconnect/status/cancel/order/durable completion/no-leak, unit/native/type/build/lint evidence |

**P6 worker ready:** plan commit plus P5 implementation dependency satisfied, native/deterministic scope. No shared interface redesign or P9 entry edit required. Full worker completion requires actual HTTP/native tests and recorded checks, not this document. Azure service identification/certification, staging proxy/access/restore, genuine crash and production rollout remain explicit R1/P8/P10 gates; they do not prevent restricted native HTTP implementation. If existing P1/P5 declarations change or real tests reveal upstream defects, pause affected work and request serialized owning fixes.

## Planner verification (documentation only)

- [x] Required goal/research/state/upstream plans and actual P1/P5 interfaces inspected; existing frontend route usage checked for consistency.
- [x] P6-only file map and P1/P5 runtime/signature/stream boundaries preserved; no application entry wiring, administrative endpoints, detached jobs, or client identity added.
- [x] Current Context7 Nest controller/manual-response/exception-filter and configurable-module documentation consulted.
- [x] AC01/02/08/10/11/13/17 mapped, bounded transport policy and module/parser assembly handoff explicit, review skipped.
- [x] Actual planner check: all 26 displayed TypeScript blocks syntax-checked; 20 assembled virtual source/test modules type-check against installed upstream dependencies/contracts, including appended regressions. No implementation/test files were written or executed by these checks.
- [x] Actual document consistency check: five workflow links exist; eight tasks / 40 numbered checkbox steps; 21 owned file-map paths / 23 named commit paths stay inside P6 ownership; every requested acceptance criterion mapped; prohibited unfinished/header/broad-staging markers absent. Staged document whitespace is checked before commit.
- [ ] Worker runtime/build/tests/service verification: not executed by this planner; no implementation-pass claim.
