# P8 Operational and Staging Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export bounded operational controls and an executable protected-staging runbook without changing application entry points or provisioning infrastructure.

**Architecture:** P8 decorates the existing persistence/runtime ports, supplies cached database readiness and passive provider degradation, and installs an early HTTP admission boundary. One operations service coordinates the existing P5 stop/drain hooks; operator-only recovery uses P2 ownership and P5 reconciliation, never inference. P9 wires these exports into the application; P10 owns actual deployment/restore measurements after P8 hands over the evidence ledger.

**Tech Stack:** Existing NestJS 12, Express 5 types, TypeScript ESM, Node AsyncLocalStorage/crypto, Vitest 4/Supertest; a single-host NGINX TLS/authenticated reverse-proxy profile and native MongoDB backup tooling. No dependency or package-script addition.

---

## Authority, prerequisites, decisions, and ownership

- Read [goal](goal.md) §§11–12, AC15/17/18, [research](research.md) §13 R1, [state](state.md) P8, and actual upstream exports. Approval is recorded in state; stale awaiting-approval prose is not a new gate. Prerequisite plans: P2 `5b20dc4`, P4 `b49196d`, P5 `2663bfc`, P6 `b6cb724`. Their workers are complete through `ea46dd3`, `8ae8de7`, `bb90fcb`, and `efac6e9` respectively.
- This planner writes/commits **only** `docs/aurvin-phase-1/plan8.md`. Worker ownership: `backend/src/operations/**`, `backend/test/operations/**`, `docs/aurvin-phase-1/operations.md`, `docs/aurvin-phase-1/staging-evidence.md`, and the explicitly selected `deployment/staging/**` assets below. Never edit `main.ts`, `app.module.ts`, shared contracts/platform, upstream persistence/runtime/model/HTTP code, manifests, state, or frontend. Send upstream defects to the orchestrator/owner.
- Add root-required descriptive headers to all new worker `.ts` files. Code examples deliberately omit header blocks. Commands `npm`/`npx` run in `backend`; Git commands run at repository root in the parent's serialized commit slot. Stage named files only.
- Unified review is **skipped**, not passed; no reviewer dispatch. Tests, local consistency checks, defect correction and final verification remain required.
- **Selected implementation profile:** existing Windows PC, one Node executor bound to `127.0.0.1:3000`, local loopback usage first. Optional controlled staging uses one NGINX gateway bound to `127.0.0.1:8443` by default, TLS plus Basic authentication protecting **both** built UI and `/api/`. Authorized operators may expose that gateway only on a private interface after firewall/access evidence; do not expose the backend or Vite development server. This is a deployable profile, not authorization to install, expose, purchase, or deploy anything. No Azure hosting platform has been selected.
- **Still blocked:** actual Azure service/API/tier/partitions/backup capabilities and selected-service activation; production identity/access, capacity/spend and recovery objectives. `openPersistence` currently accepts only verified `native-mongodb`; do not activate Azure or substitute native evidence for AC16. Native local controls can finish while these external gates remain explicit.
- Logs are pseudonymous operational metadata, not transcripts. Hash scope/generation IDs before logging; generate request IDs on the server. The configured identity is shared by every Phase 1 client; do not invent per-customer rate limits or authentication.

## Locked upstream interfaces (consume, do not redefine)

| Owner / exact source | P8 use |
| --- | --- |
| P1 `backend/src/platform/config/load-config.ts` | `AurvinConfig`, `readinessIssues`; immutable budgets, model/privacy policy, single-process topology |
| P1 `backend/src/contracts/budgets.ts` | Existing `BudgetConfig`: 20 admission requests/minute/shared identity, 8 active process runs, one/session, 180 s total, 20 s idle, 15 s persistence, 20 s shutdown drain; never copy input/context/schema enforcement |
| P1 errors / `platform/security/redact.ts` | Existing `AppError`, `AppErrorCode`, HTTP mapping; `redactSecrets` after allowlist projection |
| P2 `PersistenceBundle` and `openPersistence` | `ping`, `owner.assertExecutor/drain/releaseExecutor/handoffStoppedExecutor`, `sessions.listForRecovery`, `metadata.getAccounting`, `checkpoints.create().bind(lease)`; `close` supplied by P9 |
| P4 `model/index.ts` | `loadModelLimits` (bounded free catalogue GET), `AccountingService.reconcile` (bounded generation GET); **never** paid health POSTs or new retry layers |
| P5 `chat-runtime/index.ts` | Existing `ChatRuntime`, `ExecuteTurn`, `DrainResult`; `stopAccepting`, `snapshot`, `drain`, `allowStoppedOwner`, `reconcileSession`, `rebaseSession` |
| P6 `http/index.ts` | `ChatHttpModule`, `configureChatHttp`, `ChatStreamTransport.snapshot()`; stream GET starts inference, POST submission/retry only accepts input |

P5 `stopAccepting()` is irreversible for that runtime. Provider cooldown must **not** call it. Degradation/readiness must not disable GET archive/status or POST cancel. P5 drain is not cancellation of MongoDB promises; a race deadline must retain ownership until the old process and its I/O are proven stopped. P2's durable sentinel has no TTL and forbids rolling overlapping executors. An expired session lease is never stopped-process proof.

## File map

| Exact path | Single responsibility |
| --- | --- |
| `backend/src/operations/options.ts` | Structural P9 dependency options using existing types |
| `backend/src/operations/bounded.ts` | Timer-cleaned deadline result, no false cancellation claim |
| `backend/src/operations/telemetry.ts` | Allowlisted pseudonymous logs, finite metric slots, request context |
| `backend/src/operations/observe-persistence.ts` | Bound original methods, time writes/checkpointer, record accounting/dedup observations |
| `backend/src/operations/readiness.ts` | Single-flight cached DB/ownership readiness and passive provider cooldown |
| `backend/src/operations/observed-runtime.ts` | Existing ChatRuntime delegation; stream timing, terminal/error/recovery metrics |
| `backend/src/operations/admission.ts` | Shared-identity sliding windows with separate control/read reserve |
| `backend/src/operations/operations.service.ts` | Readiness/admission composition and bounded idempotent shutdown |
| `backend/src/operations/recovery.ts` | Operator-only stopped-owner and bounded paged reconciliation |
| `backend/src/operations/configure-operations.ts` | Early request ID, safe 429/503 response, aggregate request telemetry |
| `backend/src/operations/operations.controller.ts` | `/operations/live`, `/ready`, `/metrics` under P9's `/api` prefix |
| `backend/src/operations/operations.module.ts` | Nest register/registerAsync composition and lifecycle bridge |
| `backend/src/operations/index.ts` | P9 public exports only |
| `backend/test/operations/fixtures.ts` | Typed local dependencies; fake runtime, not provider/service certification |
| `backend/test/operations/bounded.spec.ts` | Hung-job deadline and cleanup |
| `backend/test/operations/telemetry.spec.ts` | No content/secrets, pseudonymous scope, finite labels/buffers |
| `backend/test/operations/persistence.spec.ts` | Original receiver binding, checkpoint/write/dedup/accounting observations |
| `backend/test/operations/readiness.spec.ts` | Config/assets/model/DB/ownership/startup/degradation/cache behavior |
| `backend/test/operations/runtime.spec.ts` | Actual existing stream envelope timing/delegation/no fake completion |
| `backend/test/operations/admission.spec.ts` | Window expiry, stream admission, control reserve and overload |
| `backend/test/operations/shutdown.spec.ts` | Stop-before-drain, timeout/failure/retained sentinel, repeat safety |
| `backend/test/operations/recovery.spec.ts` | Quiescence, page cap, operator gate, no inference |
| `backend/test/operations/http.e2e-spec.ts` | Real isolated Nest middleware/controller/rate/health wiring |
| `backend/test/operations/assets.spec.ts` | Runbook/proxy/evidence consistency, not deployment measurements |
| `deployment/staging/nginx.conf` | Loopback TLS authenticated UI/API proxy, streaming/no-cache/timeouts |
| `deployment/staging/README.md` | Operator-held files and authorized gateway activation steps |
| `docs/aurvin-phase-1/operations.md` | P8-owned policies, budgets, maintenance/recovery/privacy runbook |
| `docs/aurvin-phase-1/staging-evidence.md` | Prepared evidence ledger; P10 records real results after handoff |

## Task 1: Structural options and honest bounded waiting

**Files:** Create `options.ts`, `bounded.ts`, `backend/test/operations/fixtures.ts`, `bounded.spec.ts` at the paths in the file map.

- [ ] **Step 1 — Write the failing deadline test**:

```typescript
// backend/test/operations/bounded.spec.ts
import { boundedResult } from '../../src/operations/bounded.js';
it('bounds a hung promise without claiming it stopped and clears success timers', async () => {
  vi.useFakeTimers();
  try {
    const result = boundedResult(new Promise<never>(() => undefined), 25);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toEqual({ ok:false });
    expect(await boundedResult(Promise.resolve('yes'), 25)).toEqual({ ok:true, value:'yes' });
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
```

- [ ] **Step 2 — Run red**: `npx vitest run test/operations/bounded.spec.ts` → missing module/export failure.
- [ ] **Step 3 — Create the options, helper and reusable typed fixtures**:

```typescript
// backend/src/operations/options.ts
import type { ChatRuntime } from '../chat-runtime/index.js';
import type { AurvinConfig } from '../platform/config/load-config.js';
import type { ChatStreamTransport } from '../http/index.js';
export type OperationsOptions = {
  config: AurvinConfig;
  runtime: () => ChatRuntime | null;
  assetsReady: () => boolean;
  modelLimitsReady: () => boolean;
  ping: () => Promise<boolean>;
  assertExecutor: () => Promise<void>;
  closePersistence: () => Promise<void>;
  transportSnapshot: () => ReturnType<ChatStreamTransport['snapshot']>;
  writeLog: (line: string) => void;
  now?: () => number;
};
// backend/src/operations/bounded.ts
export async function boundedResult<T>(job: Promise<T>, ms: number): Promise<
  { ok:true; value:T } | { ok:false }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      job.then(value => ({ ok:true as const, value }), () => ({ ok:false as const })),
      new Promise<{ ok:false }>(resolve => { timer = setTimeout(() => resolve({ ok:false }), ms); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
// backend/test/operations/fixtures.ts
import type { OperationsOptions } from '../../src/operations/options.js';
import { loadConfig } from '../../src/platform/config/load-config.js';
import { fixtureOptions } from '../http/fixtures.js';
export function options() {
  const runtime = fixtureOptions().runtime;
  const lines: string[] = [];
  const o: OperationsOptions = {
    config: loadConfig({ PERSISTENCE_PROFILE:'native-mongodb', MONGODB_URI:'mongodb://fixture',
      OPENROUTER_API_KEY:'sk-fixture', OPENROUTER_MODEL:'fixture/model' }),
    runtime: () => runtime, assetsReady: () => true, modelLimitsReady: () => true,
    ping: vi.fn(async () => true), assertExecutor: vi.fn(async () => undefined),
    closePersistence: vi.fn(async () => undefined),
    transportSnapshot: () => ({ active:0, backpressured:0 }), writeLog: line => { lines.push(line); },
  };
  return { o, runtime, lines };
}
```

Fixtures import existing test exports read-only. Tests modifying their fake runtime must use `vi.spyOn(...).mockImplementation`, not unsafe casts or upstream edits. `boundedResult` consumes late rejection but **does not** abort underlying work; later tasks explicitly fail closed after such a timeout.

- [ ] **Step 4 — Run green**: same Vitest command → PASS; `npx tsc --noEmit --incremental false -p tsconfig.json` → no errors.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/operations/options.ts backend/src/operations/bounded.ts backend/test/operations/fixtures.ts backend/test/operations/bounded.spec.ts
git commit -m "feat(p8): define operational ports and bounded waiting"
```

## Task 2: Content-free telemetry and persistence observations

**Files:** Create `telemetry.ts`, `observe-persistence.ts`, `telemetry.spec.ts`, `persistence.spec.ts`.

- [ ] **Step 1 — Write the failing safety and binding tests**:

```typescript
// backend/test/operations/telemetry.spec.ts
import { Telemetry } from '../../src/operations/telemetry.js';
it('hashes correlation identifiers, discards arbitrary fields and bounds metric cardinality', () => {
  const lines: string[] = []; const t = new Telemetry(s => { lines.push(s); });
  t.event('accounting', { sessionId:'private prompt', attemptId:'Bearer secret', generationId:'sk-real',
    content:'private prompt', authorization:'Bearer secret', error:new Error('secret') });
  const text = lines.join('\n');
  for (const value of ['private prompt','Bearer secret','sk-real','authorization','content','stack'])
    expect(text).not.toContain(value);
  expect(JSON.parse(lines[0]).sessionId).toMatch(/^h:[a-f0-9]{24}$/);
  for (let i=0; i<10000; i++) t.event('accounting', { sessionId:String(i) });
  expect(Object.keys(t.snapshot())).toEqual(Object.keys(new Telemetry(() => undefined).snapshot()));
  expect(() => t.event('accounting', { get sessionId() { throw new Error('secret'); } })).not.toThrow();
});
it('retains only server-created request identity in async scope, not arbitrary headers', async () => {
  const lines: string[] = []; const t = new Telemetry(s => { lines.push(s); });
  await t.inRequest('00000000-0000-4000-8000-000000000001', async () => {
    await Promise.resolve(); t.event('request');
  });
  expect(JSON.parse(lines[0]).requestId).toBe('00000000-0000-4000-8000-000000000001');
});
// backend/test/operations/persistence.spec.ts
import { Telemetry } from '../../src/operations/telemetry.js';
import { observeMethods } from '../../src/operations/observe-persistence.js';
it('calls the original receiver once and measures rejection without serializing exceptions', async () => {
  const lines: string[] = []; const t = new Telemetry(s => { lines.push(s); });
  class Store {
    n = 0;
    async put() { this.n++; if (this.n === 2) throw new Error('private database URI'); return this.n; }
  }
  const raw = new Store(); const observed = observeMethods(raw, t, 'write', ['put']);
  expect(await observed.put()).toBe(1);
  await expect(observed.put()).rejects.toThrow('private database URI');
  expect(raw.n).toBe(2); expect(t.snapshot().write.count).toBe(2);
  expect(lines.join()).not.toContain('private database URI');
});
```

- [ ] **Step 2 — Run red**: `npx vitest run test/operations/telemetry.spec.ts test/operations/persistence.spec.ts` → missing exports.
- [ ] **Step 3 — Create telemetry and method decoration**:

```typescript
// backend/src/operations/telemetry.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { APP_ERROR_CODES } from '../contracts/errors.js';
import { redactSecrets } from '../platform/security/redact.js';
export const METRICS = ['request','admitted','rate_rejected','overload_rejected','dedup_hit',
  'first_output','total_run','failure','interruption','checkpoint','write','finalization',
  'reconciliation','reconciliation_failure','accounting_known','accounting_pending',
  'accounting_unknown','shutdown','log_failure'] as const;
export type Metric = typeof METRICS[number];
type Cell = { count:number; sumMs:number; maxMs:number };
export class Telemetry {
  private context = new AsyncLocalStorage<Record<string,string>>();
  private cells = Object.fromEntries(METRICS.map(k => [k,{ count:0,sumMs:0,maxMs:0 }])) as Record<Metric,Cell>;
  constructor(private sink:(line:string) => void, readonly now:() => number = Date.now) {}
  inRequest<T>(requestId:string, job:() => T):T {
    return this.context.run({ requestId }, job);
  }
  inTurn<T>(scope:{ sessionId:string; turnId:string; attemptId:string }, job:() => T):T {
    return this.context.run({ ...this.context.getStore(), ...scope }, job);
  }
  measure(metric:Metric, ms=0) {
    const value = Number.isFinite(ms) ? Math.max(0, Math.min(ms,3600000)) : 0;
    const c = this.cells[metric]; c.count = Math.min(Number.MAX_SAFE_INTEGER,c.count+1);
    c.sumMs = Math.min(Number.MAX_SAFE_INTEGER,c.sumMs+value); c.maxMs = Math.max(c.maxMs,value);
  }
  event(kind:'request'|'attempt'|'accounting'|'readiness'|'recovery'|'shutdown', fields:unknown = {}) {
    try {
      const f = fields && typeof fields === 'object' ? fields as Record<string,unknown> : {};
      const record:Record<string,unknown> = { kind, at:new Date(this.now()).toISOString() };
      const context = this.context.getStore() ?? {};
      const requestId = context.requestId;
      if (requestId && /^[a-f0-9-]{36}$/.test(requestId)) record.requestId = requestId;
      for (const key of ['sessionId','turnId','attemptId','generationId'] as const) {
        const value = f[key] ?? context[key];
        if (typeof value === 'string' && value.length <= 200)
          record[key] = `h:${createHash('sha256').update(value).digest('hex').slice(0,24)}`;
      }
      if (typeof f.code === 'string' && APP_ERROR_CODES.some(code => code === f.code)) record.code = f.code;
      if (['known','pending','unknown'].includes(String(f.accountingStatus))) record.accountingStatus = f.accountingStatus;
      if (typeof f.ok === 'boolean') record.ok = f.ok;
      this.sink(JSON.stringify(redactSecrets(record)));
    } catch { this.measure('log_failure'); }
  }
  snapshot():Record<Metric,Cell> {
    return Object.fromEntries(METRICS.map(k => [k,{ ...this.cells[k] }])) as Record<Metric,Cell>;
  }
}
// backend/src/operations/observe-persistence.ts
import type { PersistenceBundle } from '../persistence/persistence.js';
import type { ExecutionLease } from '../contracts/repositories.js';
import { Telemetry, type Metric } from './telemetry.js';
export function observeMethods<T extends object>(target:T, t:Telemetry, metric:Metric, names:readonly string[]):T {
  return new Proxy(target, { get(object, key) {
    const value:unknown = Reflect.get(object,key,object);
    if (typeof value !== 'function') return value;
    if (!names.includes(String(key))) return value.bind(object);
    return async (...args:unknown[]) => {
      const started = t.now();
      try {
        const result:unknown = await Reflect.apply(value,object,args);
        if (key === 'getAttemptByIdempotency' && result) t.measure('dedup_hit');
        if (key === 'putAccounting') {
          const record = args[0] as { sessionId:string; turnId:string; attemptId:string;
            generationId:string | null; accountingStatus:'known'|'pending'|'unknown' };
          t.event('accounting',record); t.measure(`accounting_${record.accountingStatus}`);
        }
        return result;
      } finally { t.measure(metric,t.now()-started); }
    };
  } });
}
export function observePersistence(p:PersistenceBundle,t:Telemetry):PersistenceBundle {
  return { ...p,
    sessions:observeMethods(p.sessions,t,'write',['createIfAbsent','touchActivity']),
    messages:observeMethods(p.messages,t,'write',['append','updateCompletion']),
    memory:observeMethods(p.memory,t,'write',['put']),
    metadata:observeMethods(p.metadata,t,'write',['putAttempt','putAccounting','getAttemptByIdempotency']),
    checkpoints:{ ...p.checkpoints, create:async () => {
      const factory = await p.checkpoints.create();
      return { setup:() => factory.setup(), bind:(lease:ExecutionLease) =>
        observeMethods(factory.bind(lease),t,'checkpoint',['put','putWrites']) };
    } },
  };
}
```

`getAttemptByIdempotency` is observed under the `write` timing cell for a bounded shared storage-operation aggregate; the runbook must name this aggregate accurately. Accounting counters are **durable save observations**, not distinct generations, tokens, dollars, or billing totals. Finalization timing in Task 4 is from first finalizing event to durable terminal event; checkpoint timings observe actual guarded `put/putWrites` without reading arguments or serialization. Never monkey-patch upstream source or disable saver fencing.

- [ ] **Step 4 — Run green and add these concrete regression cases** (append to `persistence.spec.ts`):

```typescript
it('records only allowed accounting metadata and a dedup lookup hit', async () => {
  const lines:string[] = []; const t = new Telemetry(s => { lines.push(s); });
  const raw = { async putAccounting(_record:unknown) { return undefined; },
    async getAttemptByIdempotency() { return { content:'private' }; } };
  const p = observeMethods(raw,t,'write',['putAccounting','getAttemptByIdempotency']);
  await p.putAccounting({ sessionId:'s',turnId:'t',attemptId:'a',generationId:'g',
    accountingStatus:'unknown',content:'private',apiKey:'secret' });
  await p.getAttemptByIdempotency();
  expect(t.snapshot().accounting_unknown.count).toBe(1);
  expect(t.snapshot().dedup_hit.count).toBe(1); expect(lines.join()).not.toContain('private');
});
it('times original checkpoint put and putWrites without looking at payload', async () => {
  const t = new Telemetry(() => undefined); const receiver = {
    alive:true, async put(_v:unknown) { expect(this.alive).toBe(true); },
    async putWrites(_v:unknown) { expect(this.alive).toBe(true); },
  };
  const saver = observeMethods(receiver,t,'checkpoint',['put','putWrites']);
  await saver.put({ secret:'never inspect' }); await saver.putWrites({ content:'private' });
  expect(t.snapshot().checkpoint.count).toBe(2);
});
```

Run the Step 2 command and TypeScript check → PASS. Verify that no telemetry retains per-session maps or full fields. A synchronous log sink must be nonblocking/bounded at the platform; default JSON stdout goes to an operator-configured rotated sink (Task 9), no in-process history buffer.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/operations/telemetry.ts backend/src/operations/observe-persistence.ts backend/test/operations/telemetry.spec.ts backend/test/operations/persistence.spec.ts
git commit -m "feat(p8): add redacted correlated bounded telemetry"
```

## Task 3: Cached readiness and passive provider degradation

**Files:** Create `readiness.ts`, `readiness.spec.ts`.

- [ ] **Step 1 — Write failing readiness tests**:

```typescript
// backend/test/operations/readiness.spec.ts
import { Readiness } from '../../src/operations/readiness.js';
import { options } from './fixtures.js';
it('separates live/read/accept readiness and caches one DB/ownership probe for five seconds', async () => {
  const { o } = options(); let now = 100; o.now = () => now;
  const r = new Readiness(o);
  const results = await Promise.all([r.read(),r.read(),r.read()]);
  expect(results[0]).toMatchObject({ live:true,readReady:true,acceptReady:true,provider:'unknown' });
  expect(o.ping).toHaveBeenCalledTimes(1); expect(o.assertExecutor).toHaveBeenCalledTimes(1);
  now += 4999; await r.read(); expect(o.ping).toHaveBeenCalledTimes(1);
  now += 1; await r.read(); expect(o.ping).toHaveBeenCalledTimes(2);
});
it('a provider outage keeps liveness/readiness for reads, invokes no provider and cools admission only', async () => {
  const { o, runtime } = options(); let now = 0; o.now = () => now;
  const r = new Readiness(o); r.providerFailure('PROVIDER_ERROR');
  expect(await r.read()).toMatchObject({ live:true,readReady:true,acceptReady:false,provider:'degraded' });
  expect(runtime.stopAccepting).not.toHaveBeenCalled();
  now = 30001; expect(await r.read()).toMatchObject({ acceptReady:true,provider:'unknown' });
  r.providerFailure('PROVIDER_AUTH'); now += 600000;
  expect(await r.read()).toMatchObject({ acceptReady:false,provider:'blocked' });
});
it('missing assets/model/runtime, unverified DB and DB failure fail closed, not live', async () => {
  const { o } = options(); o.assetsReady = () => false; o.modelLimitsReady = () => false; o.runtime = () => null;
  o.config.persistence.profile = 'unknown';
  const r = new Readiness(o);
  expect(await r.read()).toMatchObject({ live:true,acceptReady:false });
  expect(o.ping).not.toHaveBeenCalled();
  const good = options(); vi.mocked(good.o.ping).mockResolvedValue(false);
  expect(await new Readiness(good.o).read()).toMatchObject({ live:true,readReady:false,acceptReady:false });
});
it('missing provider configuration does not pretend the working archive database is down', async () => {
  const { o }=options(); o.config.openRouter.apiKey='';
  expect(await new Readiness(o).read()).toMatchObject({ live:true,readReady:true,acceptReady:false });
});
```

- [ ] **Step 2 — Run red**: `npx vitest run test/operations/readiness.spec.ts` → missing module.
- [ ] **Step 3 — Implement cached probe and static safe reasons**:

```typescript
// backend/src/operations/readiness.ts
import type { AppErrorCode } from '../contracts/errors.js';
import { readinessIssues } from '../platform/config/load-config.js';
import type { OperationsOptions } from './options.js';
import { boundedResult } from './bounded.js';
export class Readiness {
  private cache:{ at:number; db:boolean; executor:boolean } | null = null;
  private pending:Promise<{ db:boolean; executor:boolean }> | null = null;
  private providerUntil = 0;
  private providerBlocked = false;
  private providerHealthy = false;
  closing = false;
  constructor(private o:OperationsOptions) {}
  providerFailure(code:AppErrorCode) {
    if (['PROVIDER_AUTH','PROVIDER_CREDITS'].includes(code)) this.providerBlocked = true;
    if (['PROVIDER_ERROR','TIMEOUT','PROVIDER_AUTH','PROVIDER_CREDITS'].includes(code)) {
      this.providerHealthy = false; this.providerUntil = (this.o.now ?? Date.now)()+30000;
    }
  }
  providerSuccess() { if (!this.providerBlocked) { this.providerHealthy = true; this.providerUntil = 0; } }
  private async dependencies() {
    const now = (this.o.now ?? Date.now)();
    if (this.cache && now-this.cache.at < 5000) return this.cache;
    if (!this.pending) {
      // Keep the same underlying promise until it settles: repeated health requests
      // cannot accumulate hung DB calls after a visible deadline expires.
      this.pending = (async () => {
        let db=false, executor=false;
        try { db = await this.o.ping(); if (db) { await this.o.assertExecutor(); executor=true; } } catch { /* safe flags only */ }
        const value = { db,executor }; this.cache = { at:(this.o.now ?? Date.now)(),...value }; return value;
      })();
      const tracked = this.pending;
      void tracked.finally(() => { if (this.pending === tracked) this.pending = null; });
    }
    const result = await boundedResult(this.pending,1000);
    return result.ok ? result.value : { db:false,executor:false };
  }
  async read() {
    const issues:string[] = [];
    if (readinessIssues(this.o.config).length) issues.push('configuration');
    if (this.o.config.persistence.profile !== 'native-mongodb') issues.push('unverified_persistence');
    if (!this.o.assetsReady()) issues.push('fixed_assets');
    if (!this.o.modelLimitsReady()) issues.push('model_limits');
    if (this.o.config.openRouter.dataCollection !== 'deny' || !this.o.config.openRouter.disableTransforms)
      issues.push('privacy_policy');
    const deps = !this.o.config.persistence.mongoUri || issues.includes('unverified_persistence')
      ? { db:false,executor:false } : await this.dependencies();
    if (!deps.db) issues.push('database'); if (!deps.executor) issues.push('executor');
    const raw = this.o.runtime(); const state = raw?.snapshot();
    if (!raw) issues.push('runtime');
    if (state?.degraded) issues.push('runtime_quarantined');
    if (state && !state.accepting) issues.push('runtime_stopped');
    if (this.closing) issues.push('draining');
    const provider = this.providerBlocked ? 'blocked' : (this.o.now ?? Date.now)() < this.providerUntil
      ? 'degraded' : this.providerHealthy ? 'healthy' : 'unknown';
    return { live:true as const, readReady:deps.db,
      acceptReady:issues.length === 0 && !['blocked','degraded'].includes(provider), provider, issues };
  }
}
```

Provider cooldown is a passive circuit gate: after 30 s one ordinary admitted user request can discover recovery; this is not a health probe or automatic retry. Auth/credit blocks require deliberate operator config/key repair and a fresh service/process. A provider failure discovered as an `INTERRUPTED`/ambiguous failure is measured as interruption, not automatically blamed on provider; never infer billing safety.

- [ ] **Step 4 — Run green and append the hung-probe test**:

```typescript
it('bounds hung readiness while retaining one outstanding dependency probe', async () => {
  vi.useFakeTimers();
  try {
    const { o } = options(); vi.mocked(o.ping).mockReturnValue(new Promise(() => undefined));
    const r = new Readiness(o); const first = r.read();
    await vi.advanceTimersByTimeAsync(1000); expect(await first).toMatchObject({ acceptReady:false });
    const second = r.read(); await vi.advanceTimersByTimeAsync(1000); await second;
    expect(o.ping).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
```

Run Step 2 → PASS. DB probe is at most one/5 s; responses contain only static reasons, no config values. A successful cached DB probe has at most 5 s staleness; P2/P5 still enforce actual ownership/persistence per operation.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/operations/readiness.ts backend/test/operations/readiness.spec.ts
git commit -m "feat(p8): separate cached readiness from provider degradation"
```

## Task 4: Observe the existing runtime without redefining lifecycle

**Files:** Create `observed-runtime.ts`, `runtime.spec.ts`.

- [ ] **Step 1 — Write failing stream/delegation tests**:

```typescript
// backend/test/operations/runtime.spec.ts
import { observedRuntime } from '../../src/operations/observed-runtime.js';
import { Readiness } from '../../src/operations/readiness.js';
import { Telemetry } from '../../src/operations/telemetry.js';
import { options } from './fixtures.js';
import { AppError } from '../../src/platform/errors/app-error.js';
it('passes envelopes unchanged, observes honest finalization and never creates a completed event', async () => {
  const { o } = options(); let clock=0; const t = new Telemetry(() => undefined,() => clock++);
  const r = observedRuntime(o.runtime,t,new Readiness(o)); const events:unknown[] = [];
  await r.executeTurn({ userId:'server-user',sessionId:'s1',turnId:'t1',attemptId:'a1',
    signal:new AbortController().signal,emit:async e => { events.push(e); } });
  expect(events).toHaveLength(6); expect(t.snapshot().first_output.count).toBe(1);
  expect(t.snapshot().finalization.count).toBe(1); expect(t.snapshot().total_run.count).toBe(1);
});
it('propagates failure and records outage without stopping runtime', async () => {
  const { o,runtime } = options(); const ready = new Readiness(o);
  vi.spyOn(runtime,'executeTurn').mockRejectedValue(new AppError('PROVIDER_ERROR','private provider body'));
  const r = observedRuntime(o.runtime,new Telemetry(() => undefined),ready);
  await expect(r.executeTurn({ userId:'server-user',sessionId:'s1',turnId:'t1',attemptId:'a1',
    signal:new AbortController().signal,emit:async () => undefined })).rejects.toMatchObject({ code:'PROVIDER_ERROR' });
  expect(await ready.read()).toMatchObject({ provider:'degraded' });
  expect(runtime.stopAccepting).not.toHaveBeenCalled();
});
```

- [ ] **Step 2 — Run red**: `npx vitest run test/operations/runtime.spec.ts` → missing export.
- [ ] **Step 3 — Add a structural delegator**:

```typescript
// backend/src/operations/observed-runtime.ts
import type { ChatRuntime } from '../chat-runtime/index.js';
import { AppError } from '../platform/errors/app-error.js';
import type { Readiness } from './readiness.js';
import { Telemetry } from './telemetry.js';
export function observedRuntime(get:() => ChatRuntime | null,t:Telemetry,ready:Readiness):ChatRuntime {
  const raw = () => { const r=get(); if (!r) throw new AppError('NOT_READY','Chat is unavailable.'); return r; };
  return {
    submitTurn:c => raw().submitTurn(c), retryTurn:c => raw().retryTurn(c),
    cancelTurn:c => raw().cancelTurn(c), getTurnStatus:(u,s,id) => raw().getTurnStatus(u,s,id),
    stopAccepting:() => { get()?.stopAccepting(); },
    snapshot:() => get()?.snapshot() ?? { accepting:false,active:0,unresolvedWrites:0,degraded:false },
    drain:ms => raw().drain(ms), allowStoppedOwner:id => raw().allowStoppedOwner(id),
    rebaseSession:(u,s) => raw().rebaseSession(u,s),
    reconcileSession:(u,s) => t.inTurn({ sessionId:s,turnId:'recovery',attemptId:'recovery' },async () => {
      const start=t.now();
      try { await raw().reconcileSession(u,s); t.event('recovery',{ ok:true }); }
      catch (error) { t.measure('reconciliation_failure'); t.event('recovery',{ ok:false }); throw error; }
      finally { t.measure('reconciliation',t.now()-start); }
    }),
    executeTurn:c => t.inTurn(c,async () => {
      const start=t.now(); let first=false; let finalizing:number | null=null;
      try {
        await raw().executeTurn({ ...c, emit:async envelope => {
          const e=envelope.event;
          if (e.type === 'delta' && !first) { first=true; t.measure('first_output',t.now()-start); }
          if (e.type === 'status' && e.status === 'finalizing' && finalizing === null) finalizing=t.now();
          if (e.type === 'status' && ['completed','truncated'].includes(e.status) && finalizing !== null) {
            t.measure('finalization',t.now()-finalizing); finalizing=null;
          }
          if (e.type === 'error') {
            ready.providerFailure(e.code);
            t.measure(['CANCELLED','INTERRUPTED','TIMEOUT'].includes(e.code) ? 'interruption' : 'failure');
            t.event('attempt',{ code:e.code,ok:false });
          }
          if (e.type === 'completed') ready.providerSuccess();
          await c.emit(envelope);
        } });
      } catch (error) {
        const code=error instanceof AppError ? error.code : 'INTERRUPTED'; ready.providerFailure(code);
        t.measure(['CANCELLED','INTERRUPTED','TIMEOUT'].includes(code) ? 'interruption' : 'failure');
        t.event('attempt',{ code,ok:false }); throw error;
      } finally { t.measure('total_run',t.now()-start); }
    }),
  };
}
```

This adapter neither fabricates completion nor calls the provider; terminal reattachment can observe the original result again. Timing/error counters are delivery/operation observations, not unique paid attempts. All actual accepted/attempt/accounting authority stays in P2/P5. Do not retain a map of identifiers to deduplicate operational metrics.
- [ ] **Step 4 — Run green and add the delegation regressions**:

```typescript
it('null-runtime diagnostics reject commands, and reconciliation failures stay visible', async () => {
  const { o,runtime }=options(); const t=new Telemetry(() => undefined);
  const ready=new Readiness(o); const r=observedRuntime(o.runtime,t,ready);
  vi.spyOn(runtime,'reconcileSession').mockRejectedValue(new AppError('PERSISTENCE_ERROR','secret'));
  await expect(r.reconcileSession('u','s')).rejects.toMatchObject({ code:'PERSISTENCE_ERROR' });
  expect(t.snapshot().reconciliation_failure.count).toBe(1);
  const missing=observedRuntime(() => null,t,ready);
  expect(() => missing.submitTurn({ identity:{ userId:'u',source:'server-configured',openRouterUser:'u' },
    sessionId:null,content:'Hello',idempotencyKey:'key' })).toThrow(expect.objectContaining({ code:'NOT_READY' }));
});
```

Run Step 2 and `npx tsc --noEmit --incremental false -p tsconfig.json` → PASS.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/operations/observed-runtime.ts backend/test/operations/runtime.spec.ts
git commit -m "feat(p8): observe runtime lifecycle and recovery boundaries"
```

## Task 5: Bounded admission with protected control/read capacity

**Files:** Create `admission.ts`, `admission.spec.ts`.

- [ ] **Step 1 — Write failing rate/expiry/control tests**:

```typescript
// backend/test/operations/admission.spec.ts
import { Admission } from '../../src/operations/admission.js';
it('uses a bounded shared-identity window including inference-starting stream GET and expiry', () => {
  const a=new Admission(2); a.take('generation',0); a.take('generation',1);
  expect(() => a.take('generation',2)).toThrow(expect.objectContaining({ code:'RATE_LIMITED' }));
  expect(() => a.take('control',2)).not.toThrow();
  expect(() => a.take('generation',60000)).not.toThrow();
});
it('caps control requests independently instead of bypassing all overload limits', () => {
  const a=new Admission(20); for (let i=0;i<120;i++) a.take('control',i);
  expect(() => a.take('control',120)).toThrow(expect.objectContaining({ code:'RATE_LIMITED' }));
});
```

- [ ] **Step 2 — Run red**: `npx vitest run test/operations/admission.spec.ts` → missing module.
- [ ] **Step 3 — Implement two finite windows**:

```typescript
// backend/src/operations/admission.ts
import { AppError } from '../platform/errors/app-error.js';
export class Admission {
  private generation:number[]=[];
  private control:number[]=[];
  constructor(private maximum:number) {}
  take(kind:'generation'|'control',now:number) {
    const cap=kind === 'generation' ? this.maximum : 120;
    const retained=this[kind].filter(at => now-at < 60000);
    this[kind]=retained;
    if (retained.length >= cap) throw new AppError('RATE_LIMITED','Too many requests. Wait and try again.');
    retained.push(now);
  }
}
```

Use monotonic `performance.now()` for the middleware window (not wall-clock telemetry timestamps). The 20/min configured generation window counts acceptance/retry POST **and** inference-starting stream GET; a normal new turn consumes two slots, so default sustained ceiling is ten newly streamed turns/min/shared identity. Duplicate submissions and terminal reattachments count as HTTP admission attempts. No durable input is created by a rejected request. GET status/archive and POST cancel share a separate 120/min reserve, including during provider cooldown/drain. Health/metrics have that reserve too; do not add unbounded IP/user maps. P5/P6 enforce the active-run cap even when admission middleware is bypassed.
- [ ] **Step 4 — Run green**: Step 2 → PASS.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/operations/admission.ts backend/test/operations/admission.spec.ts
git commit -m "feat(p8): bound shared admission and control request rates"
```

## Task 6: Stop, bounded drain, and operator-only reconciliation

**Files:** Create `operations.service.ts`, `recovery.ts`, `shutdown.spec.ts`, `recovery.spec.ts`.

- [ ] **Step 1 — Write failing shutdown/recovery tests**:

```typescript
// backend/test/operations/shutdown.spec.ts
import { OperationsService } from '../../src/operations/operations.service.js';
import { options } from './fixtures.js';
it('stops before draining, closes only after true quiescence, and repeats once', async () => {
  const { o,runtime }=options(); const order:string[]=[];
  vi.spyOn(runtime,'stopAccepting').mockImplementation(() => { order.push('stop'); });
  vi.spyOn(runtime,'drain').mockImplementation(async () => {
    order.push('drain'); return { drained:true,active:0,unresolvedWrites:0 };
  });
  o.closePersistence=vi.fn(async () => { order.push('close'); });
  const ops=new OperationsService(o);
  expect(await ops.shutdown()).toEqual({ safe:true }); await ops.shutdown();
  expect(order).toEqual(['stop','drain','close']);
  expect(await ops.readiness.read()).toMatchObject({ acceptReady:false });
});
it('retains sentinel on unresolved work, failed close, or hung drain', async () => {
  const { o,runtime }=options();
  vi.spyOn(runtime,'drain').mockResolvedValue({ drained:false,active:1,unresolvedWrites:1 });
  expect(await new OperationsService(o).shutdown()).toEqual({ safe:false });
  expect(o.closePersistence).not.toHaveBeenCalled();
  vi.spyOn(runtime,'drain').mockResolvedValue({ drained:true,active:0,unresolvedWrites:0 });
  vi.mocked(o.closePersistence).mockRejectedValue(new Error('secret'));
  expect(await new OperationsService(o).shutdown()).toEqual({ safe:false });
});
// backend/test/operations/recovery.spec.ts
import { reconcilePage,handoffVerifiedStopped } from '../../src/operations/recovery.js';
import { options } from './fixtures.js';
import { session } from '../persistence/fixtures.js';
it('reconciles bounded original sessions without execute/submit or unbounded scanning', async () => {
  const { runtime }=options();
  vi.spyOn(runtime,'snapshot').mockReturnValue({ accepting:false,active:0,unresolvedWrites:0,degraded:false });
  const list=vi.fn(async () => ({
    items:[session('u','s1')],nextCursor:'next' }));
  const result=await reconcilePage(runtime,{ listForRecovery:list },'u',null,10);
  expect(result).toEqual({ processed:1,nextCursor:'next' });
  expect(runtime.reconcileSession).toHaveBeenCalledWith('u','s1');
  expect(runtime.executeTurn).not.toHaveBeenCalled(); expect(runtime.submitTurn).not.toHaveBeenCalled();
  expect(list).toHaveBeenCalledWith('u',{ cursor:null,limit:10 });
});
it('refuses reconciliation while active or unresolved work exists', async () => {
  const { runtime }=options(); vi.spyOn(runtime,'snapshot').mockReturnValue({ accepting:false,
    active:0,unresolvedWrites:1,degraded:true });
  await expect(reconcilePage(runtime,{ listForRecovery:async () => ({ items:[],nextCursor:null }) },'u',null,10))
    .rejects.toMatchObject({ code:'NOT_READY' });
});
it('requires stopped acceptance for administrative paging, not merely a momentarily idle runtime', async () => {
  const { runtime }=options();
  await expect(reconcilePage(runtime,{ listForRecovery:async () => ({ items:[],nextCursor:null }) },'u',null,10))
    .rejects.toMatchObject({ code:'NOT_READY' });
});
it('does not accept expiry or false stopped-process proof as handoff authorization', async () => {
  const { runtime }=options(); const owner={ handoffStoppedExecutor:vi.fn(async () => undefined) };
  await expect(handoffVerifiedStopped(owner,runtime,'old-owner',{
    oldProcessStopped:false,inFlightIoSettled:true,operatorAuthorized:true,
  })).rejects.toMatchObject({ code:'NOT_READY' });
  expect(owner.handoffStoppedExecutor).not.toHaveBeenCalled();
  expect(runtime.allowStoppedOwner).not.toHaveBeenCalled();
  await handoffVerifiedStopped(owner,runtime,'old-owner',{
    oldProcessStopped:true,inFlightIoSettled:true,operatorAuthorized:true,
  });
  expect(owner.handoffStoppedExecutor).toHaveBeenCalledWith('old-owner');
  expect(runtime.allowStoppedOwner).toHaveBeenCalledWith('old-owner');
});
```

- [ ] **Step 2 — Run red**: `npx vitest run test/operations/shutdown.spec.ts test/operations/recovery.spec.ts` → missing modules.
- [ ] **Step 3 — Implement composition/drain and admin recovery**:

```typescript
// backend/src/operations/operations.service.ts
import { Admission } from './admission.js';
import { Telemetry } from './telemetry.js';
import { Readiness } from './readiness.js';
import { observedRuntime } from './observed-runtime.js';
import { boundedResult } from './bounded.js';
import { AppError } from '../platform/errors/app-error.js';
import type { OperationsOptions } from './options.js';
export class OperationsService {
  readonly telemetry:Telemetry;
  readonly readiness:Readiness;
  readonly runtime:ReturnType<typeof observedRuntime>;
  readonly admission:Admission;
  private shutdownJob:Promise<{ safe:boolean }> | null=null;
  constructor(readonly o:OperationsOptions, telemetry?:Telemetry) {
    this.telemetry=telemetry ?? new Telemetry(o.writeLog,o.now);
    this.readiness=new Readiness(o); this.runtime=observedRuntime(o.runtime,this.telemetry,this.readiness);
    this.admission=new Admission(o.config.budgets.maxRequestsPerMinutePerUser);
  }
  async accept() {
    if (!(await this.readiness.read()).acceptReady) throw new AppError('NOT_READY','Chat is temporarily unavailable.');
    if (this.runtime.snapshot().active >= this.o.config.budgets.maxConcurrentGenerationsPerProcess)
      throw new AppError('CONCURRENCY_LIMIT','Too many responses are active.');
    this.telemetry.measure('admitted');
  }
  metrics() { return { observations:this.telemetry.snapshot(),runtime:this.runtime.snapshot(),
    transport:this.o.transportSnapshot() }; }
  shutdown():Promise<{ safe:boolean }> {
    if (this.shutdownJob) return this.shutdownJob;
    this.readiness.closing=true; this.o.runtime()?.stopAccepting();
    this.shutdownJob=(async () => {
      const start=this.telemetry.now(); const ms=this.o.config.budgets.shutdownDrainMs;
      const r=this.o.runtime();
      const drained=r ? await boundedResult(Promise.resolve().then(() => r.drain(ms)),ms) :
        { ok:true as const,value:{ drained:true,active:0,unresolvedWrites:0 } };
      let safe=false;
      if (drained.ok && drained.value.drained && drained.value.active === 0 && drained.value.unresolvedWrites === 0
          && this.o.transportSnapshot().active === 0) {
        // This close phase has its own finite budget. P9 must not close DB sooner.
        const close=await boundedResult(Promise.resolve().then(() => this.o.closePersistence()),
          this.o.config.budgets.persistenceTimeoutMs);
        safe=close.ok;
      }
      this.telemetry.measure('shutdown',this.telemetry.now()-start);
      this.telemetry.event('shutdown',{ ok:safe }); return { safe };
    })();
    return this.shutdownJob;
  }
}
// backend/src/operations/recovery.ts
import type { ChatRuntime } from '../chat-runtime/index.js';
import type { PersistenceBundle } from '../persistence/persistence.js';
import type { MongoOwnership } from '../persistence/ownership.js';
import { AppError } from '../platform/errors/app-error.js';
export async function handoffVerifiedStopped(owner:Pick<MongoOwnership,'handoffStoppedExecutor'>,runtime:ChatRuntime,
  previousOwnerId:string,proof:{ oldProcessStopped:boolean; inFlightIoSettled:boolean; operatorAuthorized:boolean }) {
  // These booleans are an operator boundary, not machine-derived proof or HTTP input.
  // No route may accept them. Record control-plane evidence before calling this helper.
  if (!proof.oldProcessStopped || !proof.inFlightIoSettled || !proof.operatorAuthorized)
    throw new AppError('NOT_READY','Stopped executor has not been verified.');
  const state=runtime.snapshot();
  if (state.active || state.unresolvedWrites) throw new AppError('NOT_READY','Recovery is not quiescent.');
  await owner.handoffStoppedExecutor(previousOwnerId); runtime.allowStoppedOwner(previousOwnerId);
}
export async function reconcilePage(runtime:ChatRuntime,
  sessions:Pick<PersistenceBundle['sessions'],'listForRecovery'>,userId:string,cursor:string | null,limit:number) {
  const state=runtime.snapshot();
  if (state.accepting || state.active || state.unresolvedWrites || !Number.isSafeInteger(limit) || limit<1 || limit>50)
    throw new AppError('NOT_READY','Recovery is not quiescent or page exceeds limits.');
  const page=await sessions.listForRecovery(userId,{ cursor,limit });
  for (const row of page.items) await runtime.reconcileSession(userId,row.sessionId);
  return { processed:page.items.length,nextCursor:page.nextCursor };
}
```

**Drain contract:** 20 s runtime drain + up to 15 s persistence close with current defaults, at most 35 s operations hook; select 45 s supervisor hard-stop. This is not a new per-operation graph timeout. False drain skips close/release; false close can be ambiguous, so never call it a clean shutdown. The platform terminates the process at hard-stop and operator records stopped/I/O evidence before restart handoff. Nest connection closure itself may hang; P9 supervisor must bound the whole exit, not trust the lifecycle hook alone. `shutdown()` returns `safe:false` and emits a flag; it never releases the sentinel directly or restarts an executor.

**Startup recovery:** `createPersistenceBundle` claims the sentinel before it can return a runtime. After an abrupt crash its normal startup will refuse. Do not call normal startup then pretend a returned bundle exists: operator first creates a maintenance `MongoClient`/`RecordStore`/`MongoOwnership` with the chosen replacement executor ID, performs `handoffStoppedExecutor` after evidence, then calls `createPersistenceBundle(client,dbName,budgets,sameReplacementId)` (same-ID durable insert is idempotent). Construct the replacement runtime, call `allowStoppedOwner(oldId)`, and reconcile bounded pages **before** readiness/admission is opened. Existing P2 tests establish same-owner sentinel behavior; if this composition fails, route a regression to P2, never delete the sentinel as a shortcut. `handoffVerifiedStopped` is for an already-constructed maintenance runtime; the startup sequence is described separately in the runbook.

Reconciliation can take up to the existing runtime budget per session. This helper deliberately processes **one page**, not a daemon/automatic full scan; operator/P9 maintenance calls `runtime.stopAccepting()` first and keeps admission closed until complete. Because stop is irreversible, after successful repair and verified quiescence construct a fresh runtime on the **same admitted bundle** (not a second concurrent executor), register stopped-owner authorization when needed, and only then open admission. Default page 10, maximum 50, maximum 100 pages per maintenance batch; pause/fail closed at the cap and record the continuation cursor outside logs. Reconciliation errors stop the batch. No saved graph result means interrupted plus explicit retry, not a paid replay. Call twice in P10 to establish idempotence. The accepting-runtime test establishes the fail-closed default.

- [ ] **Step 4 — Run green and append deadline/proof regressions**:

```typescript
// append to backend/test/operations/shutdown.spec.ts
it('returns unsafe after the exact drain deadline even if original promise never settles', async () => {
  vi.useFakeTimers();
  try {
    const { o,runtime }=options();
    vi.spyOn(runtime,'drain').mockReturnValue(new Promise(() => undefined));
    const result=new OperationsService(o).shutdown();
    await vi.advanceTimersByTimeAsync(o.config.budgets.shutdownDrainMs);
    expect(await result).toEqual({ safe:false }); expect(o.closePersistence).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
```

Append the remaining shutdown regressions:

```typescript
it('does not close persistence while the HTTP transport still owns an attachment', async () => {
  const { o }=options(); o.transportSnapshot=() => ({ active:1,backpressured:1 });
  expect(await new OperationsService(o).shutdown()).toEqual({ safe:false });
  expect(o.closePersistence).not.toHaveBeenCalled();
});
it('shuts down a diagnostic-only process with no fabricated graph', async () => {
  const { o }=options(); o.runtime=() => null;
  expect(await new OperationsService(o).shutdown()).toEqual({ safe:true });
  expect(o.closePersistence).toHaveBeenCalledTimes(1);
});
```

Run Step 2 and all operations unit tests → PASS. Do not run a kill, sentinel edit, DB restore or live model request in routine worker tests.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/operations/operations.service.ts backend/src/operations/recovery.ts backend/test/operations/shutdown.spec.ts backend/test/operations/recovery.spec.ts
git commit -m "feat(p8): bound shutdown and gate operator recovery"
```

## Task 7: Export Nest health/lifecycle and install early HTTP admission

**Files:** Create `configure-operations.ts`, `operations.controller.ts`, `operations.module.ts`, `index.ts`, `backend/test/operations/http.e2e-spec.ts`.

- [ ] **Step 1 — Write the isolated real HTTP harness/tests**:

```typescript
// backend/test/operations/http.e2e-spec.ts
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { OperationsModule,OperationsService,configureOperations } from '../../src/operations/index.js';
import { ChatHttpModule,configureChatHttp } from '../../src/http/index.js';
import { fixtureOptions } from '../http/fixtures.js';
import { options } from './fixtures.js';
let app:NestExpressApplication;
afterEach(async () => { if (app) await app.close(); });
async function boot() {
  const { o }=options(); o.config.budgets.maxRequestsPerMinutePerUser=2;
  const ops=new OperationsService(o); const chat=fixtureOptions(); chat.runtime=ops.runtime;
  @Module({ imports:[OperationsModule.register({ service:ops }),ChatHttpModule.register(chat)] })
  class Harness {}
  app=await NestFactory.create<NestExpressApplication>(Harness,{ bodyParser:false,logger:false });
  app.setGlobalPrefix('api'); configureOperations(app,ops); configureChatHttp(app,o.config.budgets);
  await app.init(); return { ops,o,chat };
}
it('returns live vs not-ready during provider outage and preserves read/cancel control paths', async () => {
  const { ops }=await boot(); ops.readiness.providerFailure('PROVIDER_ERROR');
  await request(app.getHttpServer()).get('/api/operations/live').expect(200);
  await request(app.getHttpServer()).get('/api/operations/ready').expect(503);
  await request(app.getHttpServer()).get('/api/sessions').expect(200);
  await request(app.getHttpServer()).get('/api/sessions/s1/turns/t1/stream').expect(503);
  await request(app.getHttpServer()).post('/api/sessions/s1/turns/t1/cancel').send({ attemptId:'a1' }).expect(204);
});
it('rates stream starts as admission and returns safe early errors and server request IDs', async () => {
  await boot(); const agent=request(app.getHttpServer());
  const input={ sessionId:null,content:'Hello',idempotencyKey:'request-0001' };
  await agent.post('/api/sessions').send(input).expect(202);
  await agent.post('/api/sessions').send(input).expect(202);
  const rejected=await agent.get('/api/sessions/s1/turns/t1/stream').set('X-Request-ID','private prompt').expect(429);
  expect(rejected.headers['retry-after']).toBe('60');
  expect(rejected.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
  expect(rejected.body).toMatchObject({ code:'RATE_LIMITED' });
  expect(JSON.stringify(rejected.body)).not.toContain('private prompt');
  await agent.get('/api/sessions').expect(200);
});
```

- [ ] **Step 2 — Run red**: `npm run test:e2e -- test/operations/http.e2e-spec.ts` → missing exports.
- [ ] **Step 3 — Implement module, middleware and public exports**:

```typescript
// backend/src/operations/configure-operations.ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request,Response,NextFunction } from 'express';
import { AppError } from '../platform/errors/app-error.js';
import { ERROR_HTTP_STATUS } from '../contracts/errors.js';
import { errorBody } from '../http/client-errors.js';
import { OperationsService } from './operations.service.js';
export function configureOperations(app:NestExpressApplication,ops:OperationsService) {
  app.use((req:Request,res:Response,next:NextFunction) => {
    const id=randomUUID(); res.setHeader('X-Request-ID',id); res.setHeader('Cache-Control','no-store');
    const started=performance.now();
    res.once('finish',() => { ops.telemetry.measure('request',performance.now()-started); });
    ops.telemetry.inRequest(id,() => {
      void (async () => {
        // Match pathname only; never log originalUrl/query/body/headers.
        // Express accepts trailing slash and case-insensitive resource paths by
        // default; classify those aliases identically rather than letting them
        // bypass the generation budget/provider gate.
        const path=req.path.replace(/\/+$/,'').toLowerCase();
        const generation=(req.method === 'POST' && (path === '/api/sessions' ||
          /^\/api\/sessions\/[^/]+\/turns$/.test(path) || /^\/api\/sessions\/[^/]+\/turns\/[^/]+\/retry$/.test(path))) ||
          (req.method === 'GET' && /^\/api\/sessions\/[^/]+\/turns\/[^/]+\/stream$/.test(path));
        try {
          ops.admission.take(generation ? 'generation' : 'control',performance.now());
          if (generation) await ops.accept();
          ops.telemetry.event('request',{ ok:true }); next();
        } catch (error) {
          const code=error instanceof AppError ? error.code : 'NOT_READY';
          ops.telemetry.measure(code === 'RATE_LIMITED' ? 'rate_rejected' : 'overload_rejected');
          ops.telemetry.event('request',{ code,ok:false });
          if (code === 'RATE_LIMITED') res.setHeader('Retry-After','60');
          if (!res.destroyed) res.status(ERROR_HTTP_STATUS[code]).json(errorBody(code));
        }
      })();
    });
  });
}
// backend/src/operations/operations.controller.ts
import { Controller,Get,Inject,Res } from '@nestjs/common';
import type { Response } from 'express';
import { OperationsService } from './operations.service.js';
@Controller('operations')
export class OperationsController {
  constructor(@Inject(OperationsService) private ops:OperationsService) {}
  @Get('live') live() { return { live:true }; }
  @Get('ready') async ready(@Res() response:Response) {
    const status=await this.ops.readiness.read(); response.status(status.acceptReady ? 200 : 503).json(status);
  }
  @Get('metrics') metrics() { return this.ops.metrics(); }
}
// backend/src/operations/operations.module.ts
import { ConfigurableModuleBuilder,Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
type ModuleOptions={ service:OperationsService };
const { ConfigurableModuleClass,MODULE_OPTIONS_TOKEN }=new ConfigurableModuleBuilder<ModuleOptions>().build();
@Module({ controllers:[OperationsController],providers:[{
  provide:OperationsService,inject:[MODULE_OPTIONS_TOKEN],useFactory:(o:ModuleOptions) => o.service,
}],exports:[OperationsService] })
export class OperationsModule extends ConfigurableModuleClass {}
// backend/src/operations/index.ts
export { OperationsModule } from './operations.module.js';
export { OperationsService } from './operations.service.js';
export { configureOperations } from './configure-operations.js';
export { Telemetry } from './telemetry.js';
export { observePersistence } from './observe-persistence.js';
export { handoffVerifiedStopped,reconcilePage } from './recovery.js';
export type { OperationsOptions } from './options.js';
```

Add this lifecycle method **inside** `OperationsService` before its final brace (no other class change):

```typescript
async beforeApplicationShutdown():Promise<void> {
  const result=await this.shutdown();
  if (!result.safe) process.exitCode=1;
}
```

**P9 wiring contract:** instantiate one `Telemetry`, decorate one already-open P2 bundle with `observePersistence`, create one raw P5 runtime using that bundle plus P3 assets/P4 limits, construct one `OperationsService` with raw-runtime/getter dependencies and the **same** telemetry, register `OperationsModule.register({service})` or `registerAsync`, inject `service.runtime` into P6. Give `transportSnapshot` a closure returning zero until the actual P6 transport is obtained with `app.get(ChatStreamTransport)`; then return its actual snapshot. Do not instantiate a second runtime or persistence owner.

P9 creates app with `{bodyParser:false}`, sets `/api`, installs `configureOperations` **before** `configureChatHttp` and `app.init/listen`, binds loopback and enables supported shutdown hooks. Only P8 service closes persistence; P9 must not install an earlier `onModuleDestroy` closer. On Windows use explicit awaited `app.close()`/IPC maintenance shutdown: Node/Nest do not guarantee SIGTERM support there; Ctrl-C path and supervisor hard-stop require actual P10 evidence. P9 configures supported signals per platform, not blind cross-platform hooks.

P9 also selects a payload-free bootstrap/default Nest logger policy: fixed error codes/messages only, never `console.error(error)`, arbitrary exception objects/stacks or request-logging middleware that serializes URLs/headers/bodies. P8 `writeLog` must go to the bounded rotated platform sink; external tracing/session grouping must not be enabled implicitly. This is assembly ownership, not permission for the P8 worker to change entry points.

If startup catalogue/database/assets are unavailable, P9 can keep the diagnostic service alive with `runtime:() => null`, flags false and safe dependency closures; `/live` remains healthy, `/ready` 503 and writes fail closed. P9 must not construct an invalid graph or perform paid probes to make startup green. An explicit operator reinitialization can attach a fully verified runtime later; there is no P8 auto-restart loop. Fixed-asset/schema/config-invalid deployments remain rollout failures until repaired.

- [ ] **Step 4 — Run green and append HTTP security/wiring regressions**:

```typescript
it('keeps all health/metric/error responses no-store and strips dependency secrets', async () => {
  const { ops }=await boot(); ops.readiness.providerFailure('PROVIDER_AUTH');
  for (const path of ['/api/operations/ready','/api/operations/metrics']) {
    const response=await request(app.getHttpServer()).get(path);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(response.body)).not.toMatch(/sk-fixture|mongodb:\/\/fixture|fixture\/model/);
  }
  for (const path of ['/api/sessions/','/API/sessions']) {
    const response=await request(app.getHttpServer()).post(path).send({}).expect(503);
    expect(response.headers['cache-control']).toContain('no-store');
  }
});
it('blocks before P6 command dispatch and supports the asynchronous module factory', async () => {
  const { o }=options(); o.config.budgets.maxRequestsPerMinutePerUser=1;
  const ops=new OperationsService(o); const chat=fixtureOptions(); chat.runtime=ops.runtime;
  @Module({ imports:[OperationsModule.registerAsync({ useFactory:async () => ({ service:ops }) }),
    ChatHttpModule.register(chat)] })
  class AsyncHarness {}
  app=await NestFactory.create<NestExpressApplication>(AsyncHarness,{ bodyParser:false,logger:false });
  app.setGlobalPrefix('api'); configureOperations(app,ops); configureChatHttp(app,o.config.budgets); await app.init();
  const input={ sessionId:null,content:'Hello',idempotencyKey:'request-0001' };
  await request(app.getHttpServer()).post('/api/sessions').send(input).expect(202);
  await request(app.getHttpServer()).post('/api/sessions').send(input).expect(429);
  expect(o.runtime()?.submitTurn).toHaveBeenCalledTimes(1);
});
```

Run Step 2, all operations unit/e2e suites and build → PASS. The first regression checks Express path aliases cannot bypass admission.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/operations/configure-operations.ts backend/src/operations/operations.controller.ts backend/src/operations/operations.module.ts backend/src/operations/index.ts backend/src/operations/operations.service.ts backend/test/operations/http.e2e-spec.ts
git commit -m "feat(p8): export health admission and shutdown wiring"
```

## Task 8: Selected staging gateway assets, without deployment

**Files:** Create `deployment/staging/nginx.conf`, `deployment/staging/README.md`, `backend/test/operations/assets.spec.ts`.

- [ ] **Step 1 — Write failing asset-policy assertions**:

```typescript
// backend/test/operations/assets.spec.ts
import { readFile } from 'node:fs/promises';
const root=new URL('../../../',import.meta.url);
it('prepares authenticated streaming gateway for both UI/API with no cache or access payload logs', async () => {
  const config=await readFile(new URL('deployment/staging/nginx.conf',root),'utf8');
  for (const directive of ['listen 127.0.0.1:8443 ssl','auth_basic_user_file',
    'proxy_buffering off','proxy_cache off','proxy_read_timeout 240s','proxy_send_timeout 240s',
    'access_log off','Cache-Control "no-store, no-transform"','proxy_pass http://127.0.0.1:3000'])
    expect(config).toContain(directive);
  expect(config).not.toContain('auth_basic off');
  expect(config).not.toContain('listen 0.0.0.0');
});
```

- [ ] **Step 2 — Run red**: `npx vitest run test/operations/assets.spec.ts` → missing asset.
- [ ] **Step 3 — Write the complete gateway configuration**:

```nginx
# deployment/staging/nginx.conf
# Relative operator files resolve under the selected nginx prefix; never commit keys/passwords.
worker_processes 1;
events { worker_connections 256; }
http {
  include mime.types;
  default_type application/octet-stream;
  access_log off;
  error_log logs/error.log crit;
  server_tokens off;
  client_max_body_size 256k;
  client_body_timeout 15s;
  keepalive_timeout 30s;
  send_timeout 240s;
  server {
    listen 127.0.0.1:8443 ssl;
    server_name localhost;
    ssl_certificate conf/operator/staging.crt;
    ssl_certificate_key conf/operator/staging.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    auth_basic "Aurvin controlled staging";
    auth_basic_user_file conf/operator/staging.htpasswd;
    root html/aurvin;
    add_header Cache-Control "no-store, no-transform" always;
    add_header X-Content-Type-Options nosniff always;
    location /api/operations/ {
      allow 127.0.0.1;
      deny all;
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Authorization "";
      proxy_set_header X-Request-ID "";
      proxy_buffering off;
      proxy_cache off;
      proxy_connect_timeout 10s;
      proxy_read_timeout 240s;
      proxy_send_timeout 240s;
    }
    location /api/ {
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Authorization "";
      proxy_set_header X-Request-ID "";
      proxy_set_header X-Forwarded-For "";
      proxy_buffering off;
      proxy_request_buffering on;
      proxy_cache off;
      proxy_connect_timeout 10s;
      proxy_read_timeout 240s;
      proxy_send_timeout 240s;
    }
    location / {
      try_files $uri $uri/ /index.html;
    }
  }
}
```

No wildcard gateway auth bypass, frontend service worker, public health URL or IP-based application identity. Read timeout is inter-read idle, not total wall time; 240 s exceeds the configured 180 s runtime plus finalization safety, while P4/P5 total deadlines remain authoritative. If operators increase budgets beyond this profile, gateway/termination targets must be changed together and remeasured before deployment. Do not enable compression/buffering for SSE. Gateway critical logs may still contain operational connection details; lock access, no debug/body logging, rotate and measure (Task 9).

Write `deployment/staging/README.md` with this literal content:

```markdown
# Controlled staging profile

Selected profile: existing Windows single host, loopback backend and NGINX TLS/authenticated gateway.
These assets do not install, expose, provision or deploy a service. Activation requires operator authorization.

1. Keep one Node process/database executor, backend at 127.0.0.1:3000. No cluster/PM2 workers or overlapping rolling restart.
2. Use the approved release build; copy frontend/dist to the operator NGINX prefix's html/aurvin.
3. Place the trusted certificate, private key and salted password file in conf/operator under that external prefix. Keep them outside Git; restrict ACLs to the service/operator accounts. No password or private key is supplied here.
4. Copy this nginx.conf to conf/nginx.conf under the prefix. Include the installed distribution's mime.types. Use frontend VITE_API_BASE=/api for the release build.
5. From that prefix, run nginx -t. Syntax success is not proof of access/streaming/restore.
6. Only after authorization, start the gateway. Keep its default 127.0.0.1:8443 listener for local validation. Private remote exposure requires an approved private listener, firewall and trusted certificate name; record before opening access.
7. Verify unauthenticated UI and API both deny access, backend direct port cannot be reached remotely, and operations routes remain local-only. CORS is not authentication; do not trust client user IDs or forwarded headers.
8. P10 runs and records delayed fixture streaming through this actual gateway, including no-cache headers, incremental chunk timing, disconnect, total timeout and drain/crash drills.
9. Configure a 45-second process hard-stop after the application shutdown request. Windows requires explicit app.close()/IPC and tested Ctrl-C behavior, not assumed SIGTERM delivery.
10. Follow docs/aurvin-phase-1/operations.md for maintenance, retention, backup/restore, migration and rollback. All actual results belong in staging-evidence.md.

No Azure offering is certified. Do not point the native-only adapter at unidentified Cosmos/DocumentDB or treat mongodump as a universal Azure backup mechanism.
```

- [ ] **Step 4 — Run green**: Step 2 → PASS. Do **not** run NGINX activation or obtain certificates. P10 `nginx -t` is blocked until operator tooling/files are available; record not-run rather than fabricate a passing configuration test.
- [ ] **Step 5 — Commit**:

```powershell
git add deployment/staging/nginx.conf deployment/staging/README.md backend/test/operations/assets.spec.ts
git commit -m "ops(p8): prepare protected single-host streaming gateway"
```

## Task 9: Retention, backup/restore, migration/rollback and finite evidence targets

**Files:** Create `docs/aurvin-phase-1/operations.md`, `docs/aurvin-phase-1/staging-evidence.md`; extend `assets.spec.ts`.

- [ ] **Step 1 — Append a failing runbook/ledger consistency test**:

```typescript
it('names every required measured drill without claiming external evidence passed', async () => {
  const runbook=await readFile(new URL('docs/aurvin-phase-1/operations.md',root),'utf8');
  const evidence=await readFile(new URL('docs/aurvin-phase-1/staging-evidence.md',root),'utf8');
  for (const id of ['OPS-01','OPS-02','OPS-03','OPS-04','OPS-05','OPS-06','OPS-07','OPS-08','OPS-09','OPS-10']) {
    expect(runbook).toContain(id); expect(evidence).toContain(id);
  }
  expect(runbook).toContain('no independent TTL');
  expect(evidence).toContain('P10'); expect(evidence).toContain('not run');
  expect(evidence).toContain('Unified review: skipped');
});
```

- [ ] **Step 2 — Run red**: `npx vitest run test/operations/assets.spec.ts` → missing runbook/ledger.
- [ ] **Step 3 — Write `operations.md` using the complete policy below**. Keep it P8-owned after handoff; add actual worker commands/results in the final subsection, never change pending deployment drills to pass without running them.

```markdown
# Aurvin Phase 1 operations

## Scope, topology and wiring
Local/controlled staging only, one admitted Node executor per database, no rolling overlap, no automatic lease takeover. P2's durable metadata sentinel has no TTL. Public identity/access, hosting/capacity/spend, Azure compatibility and production RPO/RTO are rollout gates. Native local checks do not close AC16.
P9 uses exports from backend/src/operations/index.ts, one Telemetry, observePersistence before constructing P5, one OperationsService and its observed runtime in P6. Install configureOperations before JSON parsing and app.init/listen; set /api and bind backend loopback. Enable supported shutdown paths; never close persistence ahead of the operations drain.

## Readiness, degradation and privacy (OPS-01, OPS-03)
/api/operations/live reports process reachability only. /ready is 200 only when config, assets, verified native persistence, executor, model limits, privacy policy and runtime accept work; otherwise 503 with static reasons. readReady independently reflects DB access. One cached ping/ownership probe per five seconds, response wait at most one second, one outstanding underlying call retained on timeout. Health never sends chat/completion POSTs, performs accounting lookup or calls the catalogue.
P9 loads model catalogue limits by one bounded GET before activating the runtime. On startup catalogue failure keep diagnostic liveness and reject work until explicit repair/reinitialization; do not supervise /ready as liveness. Provider failures cool new generation admission for 30 seconds; an ordinary user request after that may discover recovery. Authentication/credit failures block until operator repair/fresh service. No paid probes, fallback model, automatic restart or extra retry layer. DB/quarantine failures reject writes; status/archive/cancel stay available where DB/runtime permit. Cancellation is best effort and never guarantees charge prevention.
Protected staging requires provider data_collection=deny and transforms disabled, verified outgoing P4 request policy. Separate staging key/database, bounded key spend configured by operator, least-privilege database credentials including only necessary index/setup rights. App never trusts gateway user headers; Phase 1 has one server identity. Access/privacy policy still requires selected-provider/model evidence and public rollout decisions.

## Budgets and metrics (OPS-02, OPS-04)
Current P1 defaults: input 32000 characters/8192 conservative tokens, context 80 messages/16384 tokens including 2048 output reserve and 1024 margin; message 65536 bytes, manifest 131072 bytes, document conservative service headroom, page 50 maximum/20 default. One active attempt/session, eight active runs/process. Admission 20 requests/minute/shared identity includes accept/retry POST and stream GET (normally two slots/turn); control/read/cancel/health reserve 120 requests/minute. No implicit queue; P5/P6 independently enforce run cap. Rate rejection 429 with Retry-After 60; not-ready 503; submissions rejected at the boundary create no accepted input. Clock for rate windows is monotonic; arrays bounded by their caps.
Provider connect 10 s, first output 30 s, idle 20 s, total 180 s, persistence wait 15 s, drain 20 s; at most two definitive pre-stream provider dispatch attempts, exponential/jittered delays 0.5–5 s under P4. Explicit logical retry at most three latest-turn attempts under P5. Full history is never silently dropped/compressed. Budget changes require proxy/supervisor/fixture measurement reconciliation.
Telemetry uses server UUID request IDs and SHA-256 truncated pseudonymous session/turn/attempt/generation IDs in JSON logs; no user IDs, chat/tool payloads, error objects/stacks, request URLs/query/body, raw provider frames or secrets. No identifier metric labels. Finite aggregate cells count/sum/max latency for requests, first output, total run, guarded checkpoint puts/pending writes, application storage operations, finalization, reconciliation, errors/interruptions/dedup lookup hits, accounting save status, admission and shutdown. Storage timing includes getAttemptByIdempotency lookup as well as listed writes; accounting counters are save observations, never dollars or distinct generations. First-output is stream attachment to first observed delta; finalization is first finalizing event to durable terminal status, including stream sink time. Terminal replay can repeat observations. P10 computes p50/p95 from bounded external test measurements, not these aggregate cells.
Use a nonblocking bounded platform stdout sink with 10 MB/file, five files and seven-day maximum retention; gateway access logs disabled, critical-only error logs similarly restricted/rotated. Restrict log ACLs and backups; pseudonymous IDs remain sensitive metadata. Alert locally on log_failure, reconciliation_failure, unsafe shutdown, quarantine and unknown accounting observations. Never store chat content to diagnose failures. If the sink cannot meet bounds, staging telemetry gate is not met.

## Graceful shutdown and crash recovery (OPS-05, OPS-06)
1. Stop traffic/new admission and call OperationsService.shutdown(); readiness turns false immediately and P5 stopAccepting is called before drain. Read/status/cancel remain usable until listener close.
2. Await up to 20 s P5 drain, then up to 15 s persistence close only when runtime and transport are quiescent. False drain retains sentinel and skips DB close; unknown close is unsafe. Never report completion from a fulfilled HTTP/drain Promise alone.
3. Supervisor hard-stop at 45 s bounds the entire process exit including Nest listener close. Windows uses explicit awaited app.close()/IPC; validate Ctrl-C, do not assume SIGTERM. Never restart from /ready failure during provider outage.
4. Abrupt crash/unsafe exit: record old executor ID and control-plane evidence that the old process is stopped and all in-flight DB/graph work settled or has been conclusively terminated. Lease expiry alone is not evidence. Keep gateway unavailable to generation.
5. Normal P2 startup refuses a stale sentinel. In an operator-only maintenance context create MongoClient/RecordStore/MongoOwnership with a new stable executor ID; after authorization invoke handoffStoppedExecutor(oldId). Compose createPersistenceBundle with that same new ID, then P5. Do not delete the sentinel, bypass graph fencing, expose HTTP admin endpoints or overlap the old owner. Call allowStoppedOwner(oldId) on the replacement runtime only after proof.
6. Stop runtime acceptance before maintenance paging. Reconcile listForRecovery pages of ten (max fifty), one page at a time, max one hundred pages/batch; save continuation out of logs, fail closed on a page/error/cap. Repeat the reconciliation drill. Sealed graph results finalize without inference; otherwise interrupt and require explicit retry. Unattached accepted work is never auto-inferred. Inspect any owner-only session/rebase leftovers with P2 get and explicit scoped P5 reconciliation rather than assuming the active-attempt scanner covers every maintenance condition.
7. Open readiness/admission only after recovery completes and runtime is not quarantined. stopAccepting is irreversible; construct a fresh runtime on the same admitted bundle only after the maintenance runtime is fully quiescent, then reconnect P9's getter/P6 observed delegator. Quarantined runtime has no unsafe reset. Do not construct a second executor or overlap graph work. No exactly-once provider billing claim.

## Access and actual proxy streaming (OPS-07)
Selected profile is deployment/staging/nginx.conf on the existing single host. Default gateway loopback TLS:8443, authenticated UI and API, operations local-only, backend loopback:3000. Remote protected staging needs authorized private interface/firewall and trusted certificate evidence before exposure. No Vite dev server, public backend, client identity trust or CORS-as-authentication.
Gateway has response buffering/cache off, no transcript cache/logs, 10 s connect and 240 s read/send timeouts; read timeout is inter-read, not total. App total 180 s remains authoritative. P10 verifies no-store/no-transform, actual delayed incremental SSE through gateway, disconnect and timeout; a source-string assertion or local direct HTTP success is not proxy evidence.

## Retention and consistent backup/restore (OPS-08, OPS-09)
No automated session deletion in Phase 1; preserve all live archive, manifests, metadata and graph state. There is no independent TTL on messages, metadata, checkpoints, checkpoint_writes or executor sentinel. Do not use saver ttl. Whole-session purge needs a separately approved archival/deletion design with provenance/link validation; do not implement it here.
Staging backup policy: quiesce and reconcile first, then backup all six collections and internal metadata/control records together at least daily and before any migration/release. Retain seven daily complete backups and four weekly copies in an access-restricted encrypted operator store; test expiry only of whole backup sets after a newer restorable set is verified. Do not prune active records or expiry-manage one collection separately. This schedule is a staging objective, not proof that a service supplies it.
For verified native MongoDB only, freeze all writers including maintenance/accounting, stop/reconcile/close the app cleanly, and use mongodump of the entire database under that write freeze. No cross-collection transaction/snapshot is assumed. Archive encrypted externally; a gzip file alone is not encryption. Capture release SHA, schema/graph/instruction/knowledge hashes, native server/tool/saver versions, quiescence boundary, six collection counts/index metadata and archive SHA-256 in an encrypted manifest. Never put URI/password/transcript into evidence.
Operator command templates (PowerShell, external ACL-protected tool configuration file contains the URI; database names/archive paths are nonsecret operator variables):
    mongodump --config "$BackupToolConfig" --db "$SourceDb" --archive="$ArchivePath" --gzip
    Get-FileHash -Algorithm SHA256 -LiteralPath "$ArchivePath"
    mongorestore --config "$RestoreToolConfig" --archive="$ArchivePath" --gzip --nsFrom="$SourceDb.*" --nsTo="$RestoreDb.*"
Use MongoDB Database Tools supporting --config. Inspect stderr privately; do not copy credentials into logs or put URI in command-line args. RestoreDb must be a NEW isolated empty database, not production/source. No --drop or automatic overwrite. Restrict network and use fixture provider/offline mode; restored sentinel/owner records must not authorize two processes.
Validate all six collections/counts/indexes/schema bounds/durable input order, archive/manifest/checkpoint alignment and accounting; use the release recorded in the manifest. If snapshot contains an old sentinel, follow verified-stopped handoff, never expiry/delete. Repeat quiescent reconciliation, reopen history and execute one fixture follow-up with exactly-once input; preserve incomplete/truncated outcomes. Run P10 integrated assertions before switching any endpoint. Measure data loss against the frozen boundary and restore elapsed time. Do not claim Azure restore from a native dump.
Actual Azure product/API/tier/partitions/backup mode/PITR/permissions and checkpointer compatibility remain unknown. Cosmos RU continuous backup changes unique-index rules; Azure DocumentDB free tier has no backup in R1 findings. Selected-service restore must use documented tested service-native facilities or proven supported export, into an isolated target with owner proof. Until facts/evidence exist, selected-service staging and AC16/restore certification are blocked, not silently passed by native evidence.

## Migration and rollback (OPS-10)
Phase 1 schema/graph version is one; no migration is authorized merely by this runbook. Before any change freeze acceptance, drain/reconcile, create/verify a complete backup, record old/new release and schema/graph/asset/dependency versions. Unsupported versions fail closed. P1/P2/P5 owners supply versioned migrations; P8 does not invent one or touch their collections directly. Service-specific indexes must be checked against the actual service/partition/backup mode; never assume Cosmos can add a native unique index to populated collections.
Keep all six collections/control state consistent; no collection-at-a-time TTL or partial rollback. With no schema/graph/asset change, test previous compatible release against an isolated restored snapshot. With schema/graph incompatibility or data written by the new release, restore a complete old snapshot to an isolated database, validate and switch only after explicit operator approval; never run incompatible old code on mutated state. Record post-snapshot accepted data lost and provider costs; do not silently replay prompts. Asset-only changes use deliberate quiescent P5 rebaseSession, preserving transcript/provenance; historical versions remain historical. Unknown compatibility blocks rollback readiness until tested.

## Finite controlled-staging targets and evidence ownership
Targets below are measurable acceptance objectives, not observed results or public SLAs. P10 writes actual environment/command/sample size/latencies/outcomes/limitations to staging-evidence.md. Use synthetic fixture content and no live model spending by default. Any authorized live smoke stays separately bounded and reports actual cost/unknowns.
| Drill | Workload / finite target |
| --- | --- |
| OPS-01 health | 20 concurrent readiness callers, single DB/ownership probe, readiness reply <=1100 ms when hung; live has no dependency/provider call |
| OPS-02 overload | 20 admission requests within 60 s accepted at boundary, 21st 429; normal acceptance+stream consumes two; eight distinct active streams, ninth 429; control/read/cancel available under separate 120/min cap |
| OPS-03 degradation/privacy | Fixture provider outage for 2 min, no restart or health POSTs; static config/auth/credit block; outgoing deny/no-transform policy and separate credentials |
| OPS-04 telemetry | 100 fixture attempts including 10 injected failures; zero content/credential/raw-ID leaks, constant metric slots; external p50/p95 first-output/total/checkpoint/finalization measured, fixture first-output p95 <=2 s, terminal total p95 <=5 s on the declared host |
| OPS-05 graceful drain | Eight active fixture sessions incl. slow sink; stop admission immediately, <=35 s operations hook, <=45 s process exit; unsafe work retains ownership |
| OPS-06 crash | Kill at saved-result and no-result windows, prove stop/handoff/repeated reconcile; no additional fixture provider POST for saved completion |
| OPS-07 gateway | At least five delayed chunks 250 ms apart, first chunk delivered before final chunk with <=1 s gateway overhead, no cache, unauthenticated UI/API denied, direct backend remote access denied; test 180 s total/240 s proxy relationship |
| OPS-08 retention | Inspect six collections/control state and saver: zero independent TTL, whole backup-set retention only |
| OPS-09 restore | Isolated native fixture dataset 100 sessions/1000 visible messages; all six collections preserved; frozen-boundary data loss zero, restore+verification <=15 min; daily staging backup objective RPO <=24 h; selected-service result separate and blocked until identified |
| OPS-10 rollback | Previous same-schema release restored isolated, history/context/owner checks pass; incompatible schema fails closed; run rollback+verification <=15 min on same bounded fixture set |

Production gates: public identity/access and isolation policy; actual Azure service and AC16; authorized hosting/private gateway/certificates; chosen live model/privacy/cost evidence; capacity and key spend limits; automated backup mechanism plus measured service restore/RPO/RTO; supervisor/log rotation/telemetry storage; schema migration/rollback evidence. No production-ready claim until settled.

## P8 worker verification
P8 records actual commit set, Node/tool versions, deterministic unit/e2e/build/lint commands and results here after executing them. Deployment drills belong to P10 and are not run by creating these assets. Unified review: skipped, never passed.
```

- [ ] **Step 4 — Write the evidence ledger exactly with initial `not run` statuses**:

```markdown
# Staging evidence ledger

Prepared by P8; ownership of actual evidence entries transfers to P10 after P8 completes. P8 retains operations.md policy and operational source/assets. Unified review: skipped.

No deployment, Azure compatibility, proxy streaming, process-kill, migration or restore success is claimed by this document. Source/fixture assertions are distinct from actual staging evidence.

## Environment and authority
Profile: existing Windows PC, one loopback Node executor, optional authorized NGINX TLS/authenticated gateway.
Azure product/API/tier/partition/backup identity: not supplied; selected-service evidence blocked.
Gateway exposure/tooling/certificates, backup-tool/encrypted-store access, hard-stop supervisor: not supplied; activation requires operator authorization.
Evidence must include release and actual source commit set, OS/Node/Nest/NGINX/server/tools/saver versions, test database alias (no URI), configured budgets, workload/sample count, UTC start/end, command/procedure, result, measured values, limitations and artifact hash/path. Use synthetic data; no keys, passwords, transcripts, raw provider frames or private reasoning.

## Required drills
| ID | Requirement | Initial status | Execution owner / evidence |
| --- | --- | --- | --- |
| OPS-01 | liveness/readiness/probe concurrency/deadline | not run | P10; measured health calls and no-provider-call counter |
| OPS-02 | rate/run/control capacity | not run | P10; boundary outcomes and no accepted input on rejection |
| OPS-03 | outage/privacy/access credentials | not run | P10; fixture outage plus separately authorized provider-policy evidence |
| OPS-04 | correlations/redaction/finite metrics/latencies | not run | P10; bounded samples, p50/p95, zero-leak assertions |
| OPS-05 | graceful drain and full process exit | not run | P10; actual Windows shutdown/supervisor behavior |
| OPS-06 | abrupt crash/stopped-owner/reconciliation | not run | P10; process/control-plane proof and fixture POST counts |
| OPS-07 | authenticated real gateway streaming/cache/timeouts | not run | P10; nginx -t and actual delayed-chunk measurements, access denial |
| OPS-08 | retention/no independent TTL | not run | P10; actual collection index/config inspection |
| OPS-09 | consistent six-collection backup/isolated restore | not run | P10; native result separate from blocked selected-service result, manifest/hash/time/data-loss |
| OPS-10 | migration-version gate/rollback | not run | P10; isolated previous-compatible-release and incompatible-schema assertions |

## Result-entry format
Each result records ID, environment/commit set, authorization, exact command/procedure, workload, target, actual measurement, pass/fail/blocked/not-run, artifact hash/path, defects routed to owner, and limitations. Do not replace not-run with pass merely because a unit test or nginx source assertion passes. Preserve failed attempts and retests. Any blocked required staging evidence remains an integration gate; unresolved public-production-only policy does not falsely fail a completed local fixture test.

## Rollout limitations
No public production authorization, identity decision, capacity/spend commitments or production recovery objectives. Azure selected-service compatibility/backup is unverified. Real deployment access/proxy/shutdown/restore evidence awaits authorized P10 execution. No unified-review pass exists.
```

- [ ] **Step 5 — Run green and consistency checks**: `npx vitest run test/operations/assets.spec.ts` → PASS. Read the written documents against §§11–12 and the source options/exports; verify all OPS IDs match, no orphan file references, no independent expiry or native-only Azure certification, measured-vs-target wording, and ownership transfer. `git diff --check` → clean.
- [ ] **Step 6 — Commit**:

```powershell
git add docs/aurvin-phase-1/operations.md docs/aurvin-phase-1/staging-evidence.md backend/test/operations/assets.spec.ts
git commit -m "docs(p8): define retention restore rollback and staging evidence gates"
```

## Task 10: Verification and exact P9/P10 handoff

**Files:** Modify only `docs/aurvin-phase-1/operations.md` P8 worker-verification subsection with executed results. Fix failing P8 files with regression tests; send upstream failures to their owner, do not broaden ownership.

- [ ] **Step 1 — Execute deterministic checks** (no Azure/model keys required):

```powershell
npx vitest run test/operations
npm run test:e2e -- test/operations/http.e2e-spec.ts
npx tsc --noEmit --incremental false -p tsconfig.json
npm run build
npm run lint
npm test
```

Expected: operations unit suites pass; isolated actual HTTP suite passes; compiler/build succeed; lint introduces no new warnings/errors; broader routine unit regression passes. Existing upstream warnings must be named rather than silently claimed clean. Do not count unit test discovery as e2e execution. No live inference/DB mutations/NGINX activation are necessary for P8's source gate.
- [ ] **Step 2 — Audit exports and security**: `git diff --check`; inspect exact staged files with `git diff --cached --name-only` before each commit. Confirm headers in new `.ts` source/tests, no payload logging, no session-label maps, no paid health calls, no admin recovery route, one runtime/telemetry dependency instance, no changed entry points/manifests/upstream interfaces. Verify ready vs liveness and unsafe-drain behavior using P8 assertions, not descriptions alone.
- [ ] **Step 3 — Record actual verification**: replace the worker-verification paragraph with date, command results/test counts, Node/Nest/tool versions, commit range and precise native/fixture scope. Leave staging ledger drills `not run`/blocked unless actually authorized/executed. Record review **skipped** and external gates explicitly.
- [ ] **Step 4 — Commit evidence only**:

```powershell
git add docs/aurvin-phase-1/operations.md
git commit -m "docs(p8): record operational control verification and handoff"
```

- [ ] **Step 5 — Return to parent**: exact P8 commit set, path/stat, test results, public exports/signatures, wiring order/one-instance constraints and outstanding gates. P9 owns app composition/listen/shutdown/CORS; P10 owns actual evidence entries and defects route to their owners. No deployment/provisioning authorization is inferred.

## Coverage, readiness and exit gate

| Requirement | Tasks / evidence |
| --- | --- |
| AC15 finite rate/run/timeout/overload, no silent history drop | Tasks 1/3/5/6/7/9, existing P1/P3/P4/P5 enforcement; OPS-01/02 |
| AC17 config/assets/privacy/startup/access/redaction | Tasks 2/3/7/8/9; OPS-01/03/04/07 |
| AC18 correlation/metrics/shutdown/crash/proxy/retention/restore/rollback | Tasks 2/4/6/8/9; OPS-04–10 |
| AC09 supported topology, no lease-only takeover | Tasks 3/6/8/9, P2 sentinel; OPS-02/06 |
| AC12 saved-result recovery, explicit retry otherwise | Task 6 uses P5 unchanged; OPS-06/09 |
| AC16 honest selected-service gate | Task 9 and R1 unresolved facts; never native certification |

**P8 worker ready after this plan commit and parent dispatch:** P2/P4/P5/P6 workers complete; no new dependency or external resource required for deterministic operational implementation. Actual Azure identification/activation, authorized gateway/tooling/certificates, encrypted backup-store/supervisor configuration and selected-model evidence block their specific staging tests/deployment—not writing the P8-owned controls. Do not label missing required staging evidence a pass. Production-only access/capacity/RPO/RTO decisions remain explicit rollout gates.

**P8 source exit:** readiness/config/privacy/redaction/rate/runtime/drain/recovery and actual isolated HTTP tests pass; policy/assets/targets are explicit; P9 exports match existing interfaces and no central wiring is edited. **P10 integrated exit:** real deployment proxy/access/crash/restore/rollback measurements, actual service compatibility and AC matrix remain required. Documentation/source-string assertions alone do not close them.

## Documentation sources consulted for this plan

- Nest lifecycle/shutdown ordering and configurable dynamic module factory: [lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events), [dynamic modules](https://docs.nestjs.com/fundamentals/dynamic-modules), Context7 `/nestjs/docs.nestjs.com` (2026-10-06). Before-application-shutdown precedes connection close; shutdown hooks require opt-in or explicit app.close; provider lifecycle is not request-scoped.
- NGINX proxy buffering/cache/inter-read deadlines: [proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html); [Basic authentication](https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html), Context7 `/websites/nginx` (2026-10-06). Config syntax must still be exercised on the actual installed platform.
- Native Database Tools archive/namespace rename: Context7 `/mongodb/mongo-tools` (2026-10-06), [mongodump](https://www.mongodb.com/docs/database-tools/mongodump/), [mongorestore](https://www.mongodb.com/docs/database-tools/mongorestore/). Quiescent all-writer freeze is the plan's consistency boundary; no unverified Cosmos oplog/transaction assumption.

## Planner self-check (documentation only)

- Ownership is restricted to the requested plan file for this planning turn; worker files stay within P8 directories/assets.
- Spec coverage maps all requested operational controls to concrete tasks, tests and bounded objectives; actual staging results are reserved for P10.
- Type/port names match the current P1/P2/P4/P5/P6 sources; P9 wiring exports are explicit; shared protocols are not redefined.
- No production certification, review pass, external provisioning or paid probe is implied; Azure and operator evidence gates remain visible.
- Planner verification: ten sequential tasks, balanced code fences, valid relative Markdown links, matching OPS-01–10 policy/evidence IDs, no placeholder markers and no TypeScript FILE-header block. Named upstream exports/types were checked against current source; plan-only Git scope was checked. Whitespace is checked on the staged plan before commit. Application tests are not required for a documentation-only commit and are not claimed executed here.
