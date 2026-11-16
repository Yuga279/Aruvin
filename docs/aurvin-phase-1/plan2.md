# P2 Bounded Persistence and Checkpoint Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide bounded, scoped, restart-safe persistence primitives in the six agreed collections and a guarded standard MongoDB checkpoint adapter, without implementing the P5 runtime or claiming unidentified Azure compatibility.

**Architecture:** Implement the existing P1 repository/ownership/factory ports, with concrete persistence-only extensions for sequence reservations, acceptance evidence, conditional replacement, recovery scans, and executor admission. Stable hashed storage identities, immutable inserts, revision-checked replacements, and rereads handle ambiguous writes without cross-collection transactions. Wrap the standard saver rather than replacing its serialization; admit only one executor, never transfer a live executor on lease expiry, and leave lifecycle/reconciliation policy to P5.

**Tech Stack:** Existing NestJS/TypeScript ESM, Zod 3, MongoDB Node driver 6.21, Vitest 4, `@langchain/langgraph-checkpoint-mongodb` 1.4.1 and its installed checkpoint types. Relative TypeScript imports use `.js`.

---

## Authority, readiness, and constraints

- Read `goal.md` §§7–9 and AC04–AC05/AC08–AC10/AC12/AC16, `research.md` baseline and R1 supplement `dfe4e08`, `state.md` P2 scope, and `plan1.md`. P1 worker `d899e93..db763b6` is complete; actual files, not plan samples, define signatures.
- Implementation ownership is **only** `backend/src/persistence/**`, `backend/test/persistence/**`, `backend/test/compatibility/**`. This planner's sole deliverable is this Markdown file. Do not edit contracts, manifests, test configs, entry points, runtime, operations, or state.
- All P1 interfaces in `backend/src/contracts/repositories.ts` remain unchanged. Additional methods below are concrete adapter methods, not replacement shared contracts. P5 may consume their exported concrete types; a requested shared-port extension goes through P1, not a unilateral edit.
- Actual Azure product/API/tier/partition keys/capabilities/consistency/staging target are missing. Under this task's native/intersection scope, that independent slice is ready for parent worker dispatch after this plan commit and P1 completion; record the restricted slice explicitly rather than treating it as closure of R1. Selected-service provisioning, activation, index certification, and actual-service tests remain blocked. **P2 overall exit gate and AC16 cannot pass until actual-service evidence exists.**
- No cross-collection transaction, custom unique compound index, TTL, summary generation, live tool, inference, detached work, or HTTP route is added. Default `_id` identity is used within supported partitions; it is not a global sharded uniqueness claim.
- New implementation/test `.ts` files require root `AGENTS.md` headers. Headers are deliberately omitted from this clean Markdown plan and its samples. Use exact explicit staging lists below; commits are serialized by the parent orchestrator.
- Unified review remains **skipped**. Perform the plan's own consistency check and meaningful tests, not a reviewer dispatch.

## Storage and behavior decisions

| Concern | Decision |
| --- | --- |
| Physical identity | SHA-256 of JSON-encoded tuples, not delimiter concatenation. `_id` is 64 ASCII bytes. Every application read/update includes `userId` and, where applicable, `sessionId`. |
| Graph identity | `graphThreadId(userId, sessionId)` is a scope-derived 64-byte digest. Never use an unscoped client session ID as a saver thread. |
| Database-only envelope | Application documents add `_id` and `_revision` outside their P1 schema. Strip only these on decode; unknown payload fields still fail strict P1 validation. Internal counter/reservation/executor/acceptance records have their own strict version-1 schemas. |
| Bounds | BSON size, not JS character length, including envelope and a 256-byte safety reserve. Maximum document 1,800,000 bytes; message 65,536 and manifest 131,072 bytes or smaller configured budgets. P1 schema maxima still apply. No transcript/ID arrays in sessions. |
| Indexes | Non-unique, ordinary compound indexes only. App index prefixes use `userId, sessionId` where applicable. Stock saver indexes are unchanged. No sparse/partial/hashed/TTL options. |
| Supported partitions | Application collections unsharded, `userId`, or `sessionId` (sessions must use `userId` or be unsharded); saver collections unsharded or `thread_id`. Other keys block activation pending R1/P1 reconciliation. Session listing may fan out when actual service permits it; confirm cost/index behavior on that service. |
| Writes | Immutable `updateOne(..., {$setOnInsert: doc}, {upsert:true})`; reread and compare stable content after acknowledgment **or** an ambiguous error. Mutable replacement uses `_revision` CAS, no upsert. Never retry an arbitrary mutation blindly. |
| Session list | Descending normalized `lastActivityAt`, then descending `sessionId`; keyset cursor. Hide initial records with `latestTurnId: null` until acceptance is confirmed. Activity changes can move a session between pages; no snapshot-pagination promise. |
| Transcript page | Fetch descending `(sequence,messageId)`, bounded `limit+1`, return each selected page ascending. Cursor points to oldest fetched item; older pages append before current UI history. |
| Sequence | Internal metadata counter and bounded reservation per owner-issued reservation ID. Counter ambiguity can cause gaps; existing reservations are replayed exactly. Sequences never imply completion. Reject unsafe integer exhaustion. |
| Acceptance | P5 reserves active attempt, persists user message and accepted attempt, then asks `confirmAcceptance` to verify causal/hash scope and save a bounded reference-only acceptance marker. No model call before this succeeds. No atomicity claim across those writes. |
| Retry | New attempt ID/key and sequence reservation, same turn/user-message linkage. P5 validates eligible previous outcome. Never append another user input for explicit retry. |
| Executor safety | Durable database executor sentinel, no expiring sentinel or automatic takeover. Session expiry stops writes; does not authorize another executor. Deployment/P8 must ensure exactly one process. Operator-confirmed stopped-executor handoff is explicit, never a public/client operation. |
| Recovery | P2 exposes scoped bounded reads, CAS writes, reservations and references. P5 decides whether to finalize from graph result or interrupt; P2 never invokes/replays graph or provider. |
| Accounting | One bounded record per attempt; generation mapping in metadata prevents assigning one generation to two attempts. Known values cannot regress to null/unknown or conflicting cost. No billing sum or provider lookup in P2. |

## File map

| Exact path | Responsibility |
| --- | --- |
| `backend/src/persistence/records.ts` | Stable keys, BSON/schema bounds, normalized dates, strict internal schemas |
| `backend/src/persistence/store.ts` | Scoped document reads, immutable upsert, revision CAS and safe ambiguous-write rereads |
| `backend/src/persistence/indexes.ts` | Non-unique application index definitions/setup |
| `backend/src/persistence/pagination.ts` | Strict bounded scope-bound keyset cursor encoding/decoding |
| `backend/src/persistence/sessions.ts` | P1 session port and scoped recovery listing |
| `backend/src/persistence/messages.ts` | P1 archive port, scoped context-reference reads, immutable visible output |
| `backend/src/persistence/memory.ts` | P1 manifest port and monotonic context activation |
| `backend/src/persistence/metadata.ts` | P1 attempts/accounting port and scoped CAS/recovery/acceptance evidence |
| `backend/src/persistence/ownership.ts` | P1 ownership port, durable executor admission, renewal, reservations and guarded I/O |
| `backend/src/persistence/checkpoints.ts` | Standard saver subclass for scope/bounds/guardrails, checked setup facade |
| `backend/src/persistence/persistence.ts` | Open/close/ping factory, repository bundle; no Nest entry-point wiring |
| `backend/src/persistence/index.ts` | Public P2 exports |
| `backend/test/persistence/records.spec.ts` | Deterministic BSON/schema/key tests |
| `backend/test/persistence/pagination.spec.ts` | Deterministic malformed/cross-scope cursor tests |
| `backend/test/persistence/fixtures.ts` | Typed bounded record factories |
| `backend/test/persistence/native.ts` | Explicit isolated native MongoDB harness, cleanup only its generated database |
| `backend/test/persistence/archive.native.e2e-spec.ts` | Real archive restart/isolation/order/dedup/CAS tests |
| `backend/test/persistence/ownership.native.e2e-spec.ts` | Real admission/lease/sequence/acceptance tests |
| `backend/test/persistence/checkpoints.native.e2e-spec.ts` | Real setup/put/pending-write/restart/scope/bounds tests |
| `backend/test/persistence/faults.native.e2e-spec.ts` | Fault injection after committed writes; repeated repair primitives |
| `backend/test/compatibility/intersection.spec.ts` | Deterministic index/driver/capability assertions, not service evidence |
| `backend/test/compatibility/service-facts.ts` | Non-secret selected-service input validation |
| `backend/test/compatibility/persistence.azure.spec.ts` | Fail-closed actual-service integration suite |
| `backend/test/compatibility/evidence.md` | Worker measurements/commands/limits, Azure gate and actual results |

## Test environment and command conventions

Every `npx`/`npm` command below runs in **`backend`**; every `git` command runs in the repository root. Reuse installed dependencies; request P1 follow-up if another package/config is necessary.

For native integration, the operator supplies an **isolated existing native MongoDB replica set** through `AURVIN_TEST_MONGODB_URI` without printing it. The harness validates `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_` and generates a random database. Do not purchase/start external infrastructure or use the application's real database. Missing URI fails with a sanitized environment error; no skipped-green database certification. Routine `npm test` excludes `.e2e-spec.ts`, so deterministic tests need no database.

Commands:

```powershell
$env:AURVIN_TEST_DB_PREFIX = 'aurvin_p2_test_'
npm test
npm run test:e2e -- test/persistence/archive.native.e2e-spec.ts
npm run test:e2e -- test/persistence/ownership.native.e2e-spec.ts
npm run test:e2e -- test/persistence/checkpoints.native.e2e-spec.ts
npm run test:e2e -- test/persistence/faults.native.e2e-spec.ts
npm run build
npm run lint
```

The URI is set privately by the operator, not entered into this document, logs, or shell command history. Real-service tests use a separate URI and facts (§Task 10). No inference credentials are needed or used.

---

### Task 1: Stable scoped identities and bounded document codec

**Files:** Create `backend/src/persistence/records.ts`, `backend/test/persistence/records.spec.ts`, `backend/test/persistence/fixtures.ts`.

- [ ] **Step 1: Write the failing tests.** Create the fixtures and spec:

```typescript
// backend/test/persistence/fixtures.ts
import type { SessionRecord, MessageRecord, AttemptRecord,
  AgentMemoryManifest, AccountingRecord } from '../../src/contracts/index.js';
import { graphThreadId } from '../../src/persistence/records.js';
export const at = '2026-10-06T00:00:00.000Z';
export function session(userId = 'u1', sessionId = 's1'): SessionRecord {
  return { schemaVersion: 1, userId, sessionId, title: 'Hello', createdAt: at,
    updatedAt: at, lastActivityAt: at, lifecycle: 'active',
    graphThreadId: graphThreadId(userId, sessionId), latestTurnId: null,
    execution: { ownerId: null, leaseExpiresAt: null, activeAttemptId: null,
      generation: 0 } };
}
export function message(sequence = 0, userId = 'u1', sessionId = 's1'): MessageRecord {
  return { schemaVersion: 1, userId, sessionId, turnId: 't1',
    messageId: `m${sequence}`, eventId: `e${sequence}`, sequence,
    role: sequence === 0 ? 'user' : 'assistant', content: 'Hello', createdAt: at,
    completionStatus: sequence === 0 ? 'accepted' : 'completed',
    attemptId: sequence === 0 ? null : 'a1', truncated: false };
}
export function attempt(): AttemptRecord {
  return { schemaVersion: 1, kind: 'attempt', userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a1', idempotencyKey: 'request-0001',
    payloadHash: 'a'.repeat(64), status: 'accepted', sequence: 1,
    createdAt: at, updatedAt: at, instructionVersion: 'phase1.v1',
    knowledgeContentHash: 'abc', graphSchemaVersion: 'phase1.v1', contextVersion: 0,
    modelId: 'fixture/model', openRouterUser: 'u1', generationId: null,
    truncated: false, errorCode: null,
    causal: { userMessageId: 'm0', previousAttemptId: null } };
}
export function manifest(): AgentMemoryManifest {
  return { schemaVersion: 1, userId: 'u1', sessionId: 's1', contextVersion: 1,
    sourceRanges: [{ fromSequence: 0, toSequence: 0, fromEventId: 'e0', toEventId: 'e0' }],
    messageRefs: [{ messageId: 'm0', eventId: 'e0', sequence: 0 }],
    activeSummaryRef: null, instructionVersion: 'phase1.v1',
    knowledgeContentHash: 'abc', graphSchemaVersion: 'phase1.v1' };
}
export function accounting(): AccountingRecord {
  return { schemaVersion: 1, kind: 'accounting', userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a1', generationId: null, requestedModel: 'fixture/model',
    reportedModel: null, reportedProvider: null, promptTokens: null,
    completionTokens: null, cost: null, accountingStatus: 'unknown',
    outcome: 'accepted', startedAt: at, endedAt: null };
}
```

```typescript
// backend/test/persistence/records.spec.ts
import { DEFAULT_BUDGETS, messageRecordSchema, sessionRecordSchema } from '../../src/contracts/index.js';
import { bounded, key, graphThreadId, normalizeDate } from '../../src/persistence/records.js';
import { message, session } from './fixtures.js';
describe('bounded persistence codec', () => {
  it('separates tuples and identities without delimiter collisions', () => {
    expect(key('x', 'a|b', 'c')).not.toBe(key('x', 'a', 'b|c'));
    expect(graphThreadId('u1', 's1')).not.toBe(graphThreadId('u2', 's1'));
    expect(key('x', 'u1', 's1')).toHaveLength(64);
  });
  it('rejects unknown transcript fields and unsafe sequences', () => {
    expect(() => bounded(sessionRecordSchema, { ...session(), transcript: [] }, 'x', DEFAULT_BUDGETS.maxDocumentBytes)).toThrow();
    expect(() => bounded(messageRecordSchema, { ...message(), sequence: Number.MAX_SAFE_INTEGER + 1 }, 'x', DEFAULT_BUDGETS.maxMessageBytes)).toThrow();
  });
  it('measures UTF-8 BSON, not string length', () => {
    expect(() => bounded(messageRecordSchema, { ...message(), content: '界'.repeat(24_000) }, 'x', DEFAULT_BUDGETS.maxMessageBytes)).toThrow();
    expect(bounded(messageRecordSchema, message(), 'x', 65_536).bytes).toBeLessThan(65_536);
  });
  it('normalizes accepted datetimes for lexical ordering', () => {
    expect(normalizeDate('2026-10-06T02:00:00+02:00')).toBe('2026-10-06T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run red.** `npx vitest run test/persistence/records.spec.ts`. Expected missing `records.js`, not a database/network failure.
- [ ] **Step 3: Implement `records.ts`.**

```typescript
import { createHash } from 'node:crypto';
import { BSON, type Document } from 'mongodb';
import { z, type ZodType } from 'zod';
import { idSchema } from '../contracts/identifiers.js';
import { AppError } from '../platform/errors/app-error.js';

export function key(kind: string, ...parts: (string | number)[]): string {
  return createHash('sha256').update(JSON.stringify([kind, ...parts])).digest('hex');
}
export const graphThreadId = (userId: string, sessionId: string): string => key('thread', userId, sessionId);
export function normalizeDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AppError('INVALID_REQUEST', 'Invalid date.');
  return date.toISOString();
}
export function safeSequence(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Ordering capacity exceeded.');
  return value;
}
export function assertBytes(doc: Document, limit: number): number {
  const bytes = BSON.calculateObjectSize(doc) + 256;
  if (bytes > Math.min(limit, 1_800_000)) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The record is too large to save.');
  return bytes;
}
export type StoredDocument = Document & { _id: string; _revision: number };
export function bounded<T extends Document>(schema: ZodType<T>, value: unknown, id: string, limit: number): { record: T; doc: StoredDocument; bytes: number } {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
  const record = parsed.data;
  if ('sequence' in record) safeSequence(record.sequence as number);
  if ('contextVersion' in record) safeSequence(record.contextVersion as number);
  if ('execution' in record) safeSequence((record.execution as { generation: number }).generation);
  if ('messageRefs' in record) for (const ref of record.messageRefs as { sequence: number }[]) safeSequence(ref.sequence);
  if ('sourceRanges' in record) for (const range of record.sourceRanges as { fromSequence: number; toSequence: number }[]) {
    safeSequence(range.fromSequence); safeSequence(range.toSequence);
  }
  const doc = { ...record, _id: id, _revision: 0 };
  return { record, doc, bytes: assertBytes(doc, limit) };
}
export function decode<T>(schema: ZodType<T>, doc: Document | null): T | null {
  if (!doc) return null;
  const { _id: ignoredId, _revision: ignoredRevision, ...payload } = doc;
  void ignoredId; void ignoredRevision;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new AppError('PERSISTENCE_ERROR', 'Saved chat data is unavailable.');
  return parsed.data;
}
export const scopeSchema = z.object({ userId: idSchema, sessionId: idSchema }).strict();
const internalBase = { schemaVersion: z.literal(1), userId: idSchema, sessionId: idSchema };
export const counterSchema = z.object({ ...internalBase, kind: z.literal('sequence-counter'), next: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export const reservationSchema = z.object({ ...internalBase, kind: z.literal('sequence-reservation'), reservationId: idSchema,
  start: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), count: z.number().int().positive().max(80) }).strict();
export const acceptanceSchema = z.object({ ...internalBase, kind: z.literal('acceptance'), turnId: idSchema,
  attemptId: idSchema, userMessageId: idSchema, payloadHash: z.string().length(64) }).strict();
export const EXECUTOR_SCOPE = { userId: '__aurvin_system__', sessionId: '__executor__' } as const;
export const executorSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('executor'),
  userId: z.literal(EXECUTOR_SCOPE.userId), sessionId: z.literal(EXECUTOR_SCOPE.sessionId), ownerId: idSchema }).strict();
export const generationSchema = z.object({ ...internalBase, kind: z.literal('generation'), generationId: z.string().min(1).max(200), attemptId: idSchema }).strict();
```

- [ ] **Step 4: Run green.** Same command; all four tests pass. `npm run build` must still compile.
- [ ] **Step 5: Commit.**

```powershell
git add backend/src/persistence/records.ts backend/test/persistence/records.spec.ts backend/test/persistence/fixtures.ts
git commit -m "feat(p2): add bounded scoped persistence record codec"
```

### Task 2: Scoped immutable upserts and conditional replacements

**Files:** Create `backend/src/persistence/store.ts`, `backend/test/persistence/native.ts`, `backend/test/persistence/archive.native.e2e-spec.ts`.

- [ ] **Step 1: Write the harness and failing real-DB test.**

```typescript
// backend/test/persistence/native.ts
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
export async function nativeDatabase() {
  const uri = process.env.AURVIN_TEST_MONGODB_URI;
  if (!uri || process.env.AURVIN_TEST_DB_PREFIX !== 'aurvin_p2_test_') throw new Error('Isolated native test configuration is required.');
  const name = `aurvin_p2_test_${randomUUID().replaceAll('-', '')}`;
  const client = new MongoClient(uri, { retryWrites: false, serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000, timeoutMS: 15_000, maxIdleTimeMS: 120_000, writeConcern: { w: 'majority' } });
  try { await client.connect(); } catch { await client.close(); throw new Error('Native test database is unavailable.'); }
  const db = client.db(name, { writeConcern: { w: 'majority' } });
  return { client, db, name, async reconnect() {
    const next = new MongoClient(uri, { retryWrites: false, serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000, timeoutMS: 15_000, maxIdleTimeMS: 120_000, writeConcern: { w: 'majority' } });
    try { await next.connect(); return next; }
    catch { await next.close(); throw new Error('Native test reconnection failed.'); }
  }, async close() {
    try { await db.dropDatabase(); } finally { await client.close(); }
  } };
}
```

```typescript
// backend/test/persistence/archive.native.e2e-spec.ts (initial contents)
import { messageRecordSchema } from '../../src/contracts/index.js';
import { RecordStore } from '../../src/persistence/store.js';
import { key } from '../../src/persistence/records.js';
import { message } from './fixtures.js';
import { nativeDatabase } from './native.js';
describe('native record store', () => {
  it('deduplicates writes and scopes reads, including a new store after restart', async () => {
    const h = await nativeDatabase();
    try {
      const s = new RecordStore(h.db, 15_000);
      const id = key('message', 'u1', 's1', 'm0');
      await s.insert('messages', messageRecordSchema, message(), id, 65_536);
      await s.insert('messages', messageRecordSchema, message(), id, 65_536);
      expect(await h.db.collection('messages').countDocuments({ userId: 'u1', sessionId: 's1' })).toBe(1);
      const restarted = new RecordStore(h.db, 15_000);
      expect((await restarted.read('messages', messageRecordSchema, { _id: id, userId: 'u1', sessionId: 's1' }))?.messageId).toBe('m0');
      expect(await restarted.read('messages', messageRecordSchema, { _id: id, userId: 'u2', sessionId: 's1' })).toBeNull();
      await expect(s.insert('messages', messageRecordSchema, { ...message(), content: 'changed' }, id, 65_536)).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    } finally { await h.close(); }
  }, 30_000);
});
```

- [ ] **Step 2: Run red.** `npm run test:e2e -- test/persistence/archive.native.e2e-spec.ts`; missing store import. After imports resolve, missing native configuration is a blocker, not success.
- [ ] **Step 3: Implement `store.ts`.**

```typescript
import { isDeepStrictEqual } from 'node:util';
import type { Db, Document, Filter } from 'mongodb';
import type { ZodType } from 'zod';
import { bounded, decode, type StoredDocument } from './records.js';
import { AppError } from '../platform/errors/app-error.js';
export class RecordStore {
  constructor(readonly db: Db, readonly timeoutMs: number) {}
  collection(name: string) { return this.db.collection<StoredDocument>(name); }
  options() { return { maxTimeMS: this.timeoutMs }; }
  async raw(collection: string, filter: Filter<StoredDocument>): Promise<StoredDocument | null> {
    try { return await this.collection(collection).findOne(filter, this.options()); }
    catch { throw new AppError('PERSISTENCE_ERROR', 'The chat could not be read.'); }
  }
  async read<T>(collection: string, schema: ZodType<T>, filter: Filter<StoredDocument>): Promise<T | null> {
    return decode(schema, await this.raw(collection, filter));
  }
  async insert<T extends Document>(collection: string, schema: ZodType<T>, value: T, id: string, limit: number): Promise<T> {
    const { record, doc } = bounded(schema, value, id, limit);
    const scope = 'userId' in record ? { userId: record.userId, sessionId: record.sessionId } : {};
    const filter = { _id: id, ...scope };
    let failed = false;
    try { await this.collection(collection).updateOne(filter, { $setOnInsert: doc }, { upsert: true, ...this.options() }); }
    catch { failed = true; }
    const saved = await this.read(collection, schema, filter);
    if (saved && isDeepStrictEqual(saved, record)) return saved;
    if (saved) throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
    throw new AppError('PERSISTENCE_ERROR', failed ? 'The save could not be confirmed.' : 'The record could not be saved.');
  }
  async replace<T extends Document>(collection: string, schema: ZodType<T>, value: T, id: string, expectedRevision: number, limit: number): Promise<boolean> {
    const { record, doc } = bounded(schema, value, id, limit);
    doc._revision = expectedRevision + 1;
    const scope = 'userId' in record ? { userId: record.userId, sessionId: record.sessionId } : {};
    const filter = { _id: id, ...scope, _revision: expectedRevision };
    try {
      const result = await this.collection(collection).replaceOne(filter, doc, this.options());
      if (result.matchedCount === 1) return true;
    } catch { /* The write might already be durable; verify the exact revision. */ }
    const saved = await this.raw(collection, { _id: id, ...scope });
    return saved?._revision === expectedRevision + 1 && isDeepStrictEqual(decode(schema, saved), record);
  }
}
```

`RecordStore` is low-level and never an HTTP dependency. Callers are responsible for fixed collection names and validated scope; do not export arbitrary database query endpoints. `insert` is never a mutable status update.

- [ ] **Step 4: Run green** with the same native command, then `npm run build`. Expected one durable record, wrong user returns null, changed payload rejected.
- [ ] **Step 5: Commit.**

```powershell
git add backend/src/persistence/store.ts backend/test/persistence/native.ts backend/test/persistence/archive.native.e2e-spec.ts
git commit -m "feat(p2): add scoped idempotent upserts and revision CAS"
```

### Task 3: Intersection indexes and bounded keyset cursors

**Files:** Create `backend/src/persistence/indexes.ts`, `backend/src/persistence/pagination.ts`, `backend/test/persistence/pagination.spec.ts`, `backend/test/compatibility/intersection.spec.ts`.

- [ ] **Step 1: Write failing specs.**

```typescript
// backend/test/persistence/pagination.spec.ts
import { cursor, page } from '../../src/persistence/pagination.js';
describe('keyset cursors', () => {
  it('binds a bounded cursor to kind and scope', () => {
    const value = cursor({ kind: 'messages', userId: 'u1', sessionId: 's1', value: 4, id: 'm4' });
    expect(page({ cursor: value, limit: 2 }, 'messages', 'u1', 's1', 50).after?.value).toBe(4);
    expect(() => page({ cursor: value, limit: 2 }, 'messages', 'u2', 's1', 50)).toThrow();
    expect(() => page({ cursor: value, limit: 2 }, 'sessions', 'u1', '', 50)).toThrow();
  });
  it('rejects malformed, oversized and unbounded requests', () => {
    for (const c of ['bad', 'x'.repeat(2049)]) expect(() => page({ cursor: c, limit: 2 }, 'messages', 'u1', 's1', 50)).toThrow();
    for (const limit of [0, 51, 1.5, Infinity]) expect(() => page({ cursor: null, limit }, 'messages', 'u1', 's1', 50)).toThrow();
  });
});
```

```typescript
// backend/test/compatibility/intersection.spec.ts
import { APP_INDEXES } from '../../src/persistence/indexes.js';
import { readFileSync } from 'node:fs';
describe('intersection profile (not Azure certification)', () => {
  it('has no unique, partial, sparse, hashed or TTL app indexes', () => {
    expect(APP_INDEXES).toHaveLength(8);
    for (const item of APP_INDEXES) {
      expect(item.options).toEqual({ name: expect.any(String) });
      expect(Object.keys(item.keys)[0]).toBe('userId');
      expect(Object.values(item.keys).every((v) => v === 1 || v === -1)).toBe(true);
    }
  });
  it('keeps the driver/saver compatible installed major lines', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.mongodb).toMatch(/^\^6\./);
    expect(pkg.dependencies['@langchain/langgraph-checkpoint-mongodb']).toBe('^1.4.1');
  });
});
```

- [ ] **Step 2: Run red.** `npx vitest run test/persistence/pagination.spec.ts test/compatibility/intersection.spec.ts`; missing modules.
- [ ] **Step 3: Implement both modules.**

```typescript
// backend/src/persistence/indexes.ts
import type { Db, IndexSpecification } from 'mongodb';
import { AppError } from '../platform/errors/app-error.js';
export const APP_INDEXES: { collection: string; keys: IndexSpecification; options: { name: string } }[] = [
  { collection: 'sessions', keys: { userId: 1, lastActivityAt: -1, sessionId: -1 }, options: { name: 'user_activity_session' } },
  { collection: 'messages', keys: { userId: 1, sessionId: 1, sequence: -1, messageId: -1 }, options: { name: 'scope_sequence_message' } },
  { collection: 'messages', keys: { userId: 1, sessionId: 1, messageId: 1 }, options: { name: 'scope_message' } },
  { collection: 'agent-memory', keys: { userId: 1, sessionId: 1 }, options: { name: 'scope_manifest' } },
  { collection: 'metadata', keys: { userId: 1, sessionId: 1, kind: 1, attemptId: 1 }, options: { name: 'scope_kind_attempt' } },
  { collection: 'metadata', keys: { userId: 1, sessionId: 1, kind: 1, idempotencyKey: 1 }, options: { name: 'scope_kind_request' } },
  { collection: 'metadata', keys: { userId: 1, sessionId: 1, kind: 1, sequence: -1, attemptId: -1 }, options: { name: 'scope_kind_sequence' } },
  { collection: 'metadata', keys: { userId: 1, kind: 1, generationId: 1 }, options: { name: 'user_kind_generation' } },
];
export async function setupIndexes(db: Db): Promise<void> {
  try { for (const index of APP_INDEXES) await db.collection(index.collection).createIndex(index.keys, index.options); }
  catch { throw new AppError('NOT_READY', 'Chat storage setup failed.'); }
}
```

```typescript
// backend/src/persistence/pagination.ts
import { z } from 'zod';
import type { PageQuery } from '../contracts/repositories.js';
import { idSchema } from '../contracts/identifiers.js';
import { AppError } from '../platform/errors/app-error.js';
const cursorSchema = z.object({ v: z.literal(1), kind: z.enum(['sessions', 'messages', 'attempts']), userId: idSchema,
  sessionId: z.string().max(128), value: z.union([z.string().max(64), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]), id: idSchema }).strict();
type Cursor = z.infer<typeof cursorSchema>;
export function cursor(input: Omit<Cursor, 'v'>): string {
  return Buffer.from(JSON.stringify(cursorSchema.parse({ ...input, v: 1 }))).toString('base64url');
}
export function page(query: PageQuery, kind: Cursor['kind'], userId: string, sessionId: string, max: number): { limit: number; after: Cursor | null } {
  idSchema.parse(userId);
  if (kind !== 'sessions') idSchema.parse(sessionId);
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > Math.min(max, 50)) throw new AppError('INVALID_REQUEST', 'Invalid page size.');
  if (!query.cursor) return { limit: query.limit, after: null };
  try {
    if (query.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error('cursor');
    const after = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
    if (after.kind !== kind || after.userId !== userId || after.sessionId !== sessionId) throw new Error('scope');
    if (kind === 'sessions' ? typeof after.value !== 'string' || new Date(after.value).toISOString() !== after.value : typeof after.value !== 'number') throw new Error('order');
    return { limit: query.limit, after };
  } catch { throw new AppError('INVALID_REQUEST', 'Invalid page cursor.'); }
}
```

- [ ] **Step 4: Run green** with the same command. `npm run build`; inspect the real index definitions later in Tasks 4/8/10. These deterministic assertions do **not** establish service support.
- [ ] **Step 5: Commit.**

```powershell
git add backend/src/persistence/indexes.ts backend/src/persistence/pagination.ts backend/test/persistence/pagination.spec.ts backend/test/compatibility/intersection.spec.ts
git commit -m "feat(p2): define intersection indexes and scoped keyset cursors"
```

### Task 4: Session and message archive ports

**Files:** Create `backend/src/persistence/sessions.ts`, `backend/src/persistence/messages.ts`; extend `backend/test/persistence/archive.native.e2e-spec.ts`.

- [ ] **Step 1: Add the failing test** (add imports for `MongoSessions`, `MongoMessages`, `session`, `setupIndexes`, `DEFAULT_BUDGETS`).

```typescript
it('lists accepted sessions and stable transcript pages without leaking private fields', async () => {
  const h = await nativeDatabase();
  try {
    const store = new RecordStore(h.db, 15_000);
    const sessions = new MongoSessions(store, DEFAULT_BUDGETS);
    const messages = new MongoMessages(store, DEFAULT_BUDGETS);
    await setupIndexes(h.db);
    await sessions.createIfAbsent({ ...session(), latestTurnId: 't1' });
    await sessions.createIfAbsent(session('u1', 'empty'));
    await sessions.createIfAbsent({ ...session('u2', 's1'), latestTurnId: 't1' });
    for (const n of [3, 0, 2, 1]) await messages.append(message(n));
    expect((await sessions.list('u1', { cursor: null, limit: 2 })).items.map((x) => x.sessionId)).toEqual(['s1']);
    const newest = await messages.list('u1', 's1', { cursor: null, limit: 2 });
    expect(newest.items.map((x) => x.sequence)).toEqual([2, 3]);
    expect(newest.items[0]).not.toHaveProperty('userId');
    expect(newest.items[0]).not.toHaveProperty('attemptId');
    const older = await messages.list('u1', 's1', { cursor: newest.nextCursor, limit: 2 });
    expect(older.items.map((x) => x.sequence)).toEqual([0, 1]);
    expect(older.olderAvailable).toBe(false);
    expect((await messages.list('u2', 's1', { cursor: null, limit: 2 })).items).toEqual([]);
    await expect(messages.append({ ...message(2), content: 'overwrite' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    expect((await h.db.collection('messages').indexes()).some((i) => i.name === 'scope_sequence_message' && i.unique !== true)).toBe(true);
  } finally { await h.close(); }
}, 30_000);
```

- [ ] **Step 2: Run red.** `npm run test:e2e -- test/persistence/archive.native.e2e-spec.ts`; missing adapters.
- [ ] **Step 3: Implement the ports.**

```typescript
// backend/src/persistence/sessions.ts
import type { Filter } from 'mongodb';
import { sessionRecordSchema } from '../contracts/session.js';
import { sessionSummarySchema } from '../contracts/api.js';
import type { SessionRecord } from '../contracts/session.js';
import type { SessionRepository, PageQuery } from '../contracts/repositories.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import { RecordStore } from './store.js';
import { decode, key, graphThreadId, normalizeDate, type StoredDocument } from './records.js';
import { page, cursor } from './pagination.js';
import { AppError } from '../platform/errors/app-error.js';
export class MongoSessions implements SessionRepository {
  constructor(readonly store: RecordStore, readonly budgets: BudgetConfig) {}
  get(userId: string, sessionId: string) {
    return this.store.read('sessions', sessionRecordSchema, { _id: key('session', userId, sessionId), userId, sessionId });
  }
  async createIfAbsent(record: SessionRecord): Promise<SessionRecord> {
    const value = sessionRecordSchema.parse({ ...record, createdAt: normalizeDate(record.createdAt),
      updatedAt: normalizeDate(record.updatedAt), lastActivityAt: normalizeDate(record.lastActivityAt) });
    if (value.graphThreadId !== graphThreadId(value.userId, value.sessionId) || value.title.length > this.budgets.titleMaxChars) throw new AppError('INVALID_REQUEST', 'Invalid session record.');
    const saved = await this.get(value.userId, value.sessionId);
    if (saved) {
      if (saved.graphThreadId !== value.graphThreadId) throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The session identity is already used.');
      return saved;
    }
    try { return await this.store.insert('sessions', sessionRecordSchema, value, key('session', value.userId, value.sessionId), this.budgets.maxDocumentBytes); }
    catch (error) {
      if (error instanceof AppError && error.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
        const winner = await this.get(value.userId, value.sessionId);
        if (winner?.graphThreadId === value.graphThreadId) return winner;
      }
      throw error;
    }
  }
  async list(userId: string, query: PageQuery) {
    const { limit, after } = page(query, 'sessions', userId, '', this.budgets.maxPageSize);
    const filter: Filter<StoredDocument> = { userId, latestTurnId: { $ne: null } };
    if (after) filter.$or = [{ lastActivityAt: { $lt: after.value } }, { lastActivityAt: after.value, sessionId: { $lt: after.id } }];
    const docs = await this.store.collection('sessions').find(filter, this.store.options()).sort({ lastActivityAt: -1, sessionId: -1 }).limit(limit + 1).toArray();
    const selected = docs.slice(0, limit).map((doc) => sessionSummarySchema.parse(decode(sessionRecordSchema, doc) && {
      sessionId: doc.sessionId, title: doc.title, createdAt: doc.createdAt, lastActivityAt: doc.lastActivityAt }));
    const last = selected.at(-1);
    return { items: selected, nextCursor: docs.length > limit && last ? cursor({ kind: 'sessions', userId, sessionId: '', value: last.lastActivityAt, id: last.sessionId }) : null };
  }
  async touchActivity(userId: string, sessionId: string, at: string): Promise<void> {
    const value = normalizeDate(at);
    try {
      const result = await this.store.collection('sessions').updateOne({ _id: key('session', userId, sessionId), userId, sessionId },
        { $max: { lastActivityAt: value, updatedAt: value }, $inc: { _revision: 1 } }, this.store.options());
      if (!result.matchedCount) throw new Error('missing');
    } catch {
      const saved = await this.get(userId, sessionId);
      if (!saved || saved.lastActivityAt < value) throw new AppError('PERSISTENCE_ERROR', 'Chat activity could not be saved.');
    }
  }
  async listForRecovery(userId: string, query: PageQuery) {
    // Reuse bounded session ordering; hidden partial acceptances are included here.
    const { limit, after } = page(query, 'sessions', userId, '', this.budgets.maxPageSize);
    const filter: Filter<StoredDocument> = { userId, 'execution.activeAttemptId': { $ne: null } };
    if (after) filter.$or = [{ lastActivityAt: { $lt: after.value } }, { lastActivityAt: after.value, sessionId: { $lt: after.id } }];
    const docs = await this.store.collection('sessions').find(filter, this.store.options()).sort({ lastActivityAt: -1, sessionId: -1 }).limit(limit + 1).toArray();
    const items = docs.slice(0, limit).map((d) => decode(sessionRecordSchema, d)!);
    const last = items.at(-1);
    return { items, nextCursor: docs.length > limit && last ? cursor({ kind: 'sessions', userId, sessionId: '', value: last.lastActivityAt, id: last.sessionId }) : null };
  }
}
```

```typescript
// backend/src/persistence/messages.ts
import type { Filter } from 'mongodb';
import { messageRecordSchema, type MessageRecord, type MessageCompletionStatus } from '../contracts/message.js';
import { visibleMessageSchema } from '../contracts/api.js';
import type { MessageRepository, PageQuery } from '../contracts/repositories.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import type { MessageRef } from '../contracts/agent-memory.js';
import { RecordStore } from './store.js';
import { key, decode, normalizeDate, type StoredDocument } from './records.js';
import { cursor, page } from './pagination.js';
import { AppError } from '../platform/errors/app-error.js';
export class MongoMessages implements MessageRepository {
  constructor(readonly store: RecordStore, readonly budgets: BudgetConfig) {}
  async append(record: MessageRecord): Promise<void> {
    if (record.role === 'user' && record.content.length > this.budgets.maxInputChars) throw new AppError('INPUT_TOO_LARGE', 'The message exceeds the input limit.');
    await this.store.insert('messages', messageRecordSchema, { ...record, createdAt: normalizeDate(record.createdAt) },
      key('message', record.userId, record.sessionId, record.messageId), this.budgets.maxMessageBytes);
  }
  get(userId: string, sessionId: string, messageId: string) {
    return this.store.read('messages', messageRecordSchema, { _id: key('message', userId, sessionId, messageId), userId, sessionId });
  }
  async list(userId: string, sessionId: string, query: PageQuery) {
    const { limit, after } = page(query, 'messages', userId, sessionId, this.budgets.maxPageSize);
    const filter: Filter<StoredDocument> = { userId, sessionId };
    if (after) filter.$or = [{ sequence: { $lt: after.value } }, { sequence: after.value, messageId: { $lt: after.id } }];
    const docs = await this.store.collection('messages').find(filter, this.store.options()).sort({ sequence: -1, messageId: -1 }).limit(limit + 1).toArray();
    const records = docs.slice(0, limit).map((doc) => decode(messageRecordSchema, doc)!);
    const last = records.at(-1);
    const items = records.reverse().map(({ messageId, turnId, eventId, sequence, role, content, createdAt, completionStatus, truncated }) =>
      visibleMessageSchema.parse({ messageId, turnId, eventId, sequence, role, content, createdAt, completionStatus, truncated }));
    return { items, olderAvailable: docs.length > limit, nextCursor: docs.length > limit && last ? cursor({ kind: 'messages', userId, sessionId, value: last.sequence, id: last.messageId }) : null };
  }
  async updateCompletion(userId: string, sessionId: string, messageId: string, completionStatus: MessageCompletionStatus, truncated: boolean): Promise<void> {
    const id = key('message', userId, sessionId, messageId);
    const doc = await this.store.raw('messages', { _id: id, userId, sessionId });
    const saved = decode(messageRecordSchema, doc);
    if (!saved || !doc) throw new AppError('NOT_FOUND', 'Message not found.');
    if (saved.completionStatus === completionStatus && saved.truncated === truncated) return;
    if (['completed', 'truncated', 'failed', 'cancelled', 'interrupted'].includes(saved.completionStatus)) throw new AppError('CONFLICT_ACTIVE_TURN', 'Message is already finalized.');
    if (truncated !== (completionStatus === 'truncated')) throw new AppError('INVALID_REQUEST', 'Invalid truncation state.');
    if (!await this.store.replace('messages', messageRecordSchema, { ...saved, completionStatus, truncated }, id, doc._revision as number, this.budgets.maxMessageBytes)) throw new AppError('CONFLICT_ACTIVE_TURN', 'Message changed while saving.');
  }
  async getReferences(userId: string, sessionId: string, refs: readonly MessageRef[]): Promise<MessageRecord[]> {
    if (refs.length > Math.min(500, this.budgets.maxMessagesInContext)) throw new AppError('CONTEXT_BUDGET_EXCEEDED', 'The selected history is too large.');
    const items: MessageRecord[] = [];
    for (const ref of refs) {
      const item = await this.get(userId, sessionId, ref.messageId);
      if (!item || item.eventId !== ref.eventId || item.sequence !== ref.sequence) throw new AppError('NOT_READY', 'Chat context needs recovery.');
      items.push(item);
    }
    return items;
  }
}
```

No partial-output content mutator is introduced: P5 can persist one bounded immutable partial message on an explicit failed/cancelled/interrupted outcome. Live displayed deltas remain provisional; the plan does not promise periodic durability.

- [ ] **Step 4: Run green** with native archive command and `npm run build`.
- [ ] **Step 5: Commit.**

```powershell
git add backend/src/persistence/sessions.ts backend/src/persistence/messages.ts backend/test/persistence/archive.native.e2e-spec.ts
git commit -m "feat(p2): implement bounded session and transcript repositories"
```

### Task 5: Reference manifests and immutable/CAS attempt/accounting records

**Files:** Create `backend/src/persistence/memory.ts`, `backend/src/persistence/metadata.ts`; extend `backend/test/persistence/archive.native.e2e-spec.ts`.

- [ ] **Step 1: Add failing tests** (import `MongoMemory`, `MongoMetadata`, `manifest`, `attempt`, `accounting`).

```typescript
it('activates only monotonic reference manifests and deduplicates attempt accounting', async () => {
  const h = await nativeDatabase();
  try {
    const store = new RecordStore(h.db, 15_000);
    const memory = new MongoMemory(store, DEFAULT_BUDGETS);
    const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
    await memory.put(manifest()); await memory.put(manifest());
    await expect(memory.put({ ...manifest(), contextVersion: 0 })).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
    await expect(memory.put({ ...manifest(), sourceRanges: [{ ...manifest().sourceRanges[0], fromSequence: 2, toSequence: 1 }] })).rejects.toThrow();
    await metadata.putAttempt(attempt()); await metadata.putAttempt(attempt());
    expect((await metadata.getAttemptByIdempotency('u1', 's1', 'request-0001'))?.attemptId).toBe('a1');
    await expect(metadata.putAttempt({ ...attempt(), payloadHash: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    await metadata.putAccounting(accounting());
    const known = { ...accounting(), generationId: 'gen1', promptTokens: 10, completionTokens: 5, cost: 0.001, accountingStatus: 'known' as const, outcome: 'completed' as const };
    await metadata.putAccounting(known); await metadata.putAccounting(known);
    await expect(metadata.putAccounting(accounting())).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
    expect(await h.db.collection('metadata').countDocuments({ kind: 'accounting' })).toBe(1);
    await metadata.putAttempt({ ...attempt(), attemptId: 'a2', idempotencyKey: 'request-0002', sequence: 2,
      causal: { userMessageId: 'm0', previousAttemptId: 'a1' } });
    await expect(metadata.putAccounting({ ...known, attemptId: 'a2' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    expect(await memory.get('u2', 's1')).toBeNull();
  } finally { await h.close(); }
}, 30_000);
```

- [ ] **Step 2: Run red.** Native archive command; missing adapters.
- [ ] **Step 3: Implement manifest adapter.**

```typescript
// backend/src/persistence/memory.ts
import { isDeepStrictEqual } from 'node:util';
import { agentMemoryManifestSchema, type AgentMemoryManifest } from '../contracts/agent-memory.js';
import type { AgentMemoryRepository } from '../contracts/repositories.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import { RecordStore } from './store.js';
import { key, decode, bounded } from './records.js';
import { AppError } from '../platform/errors/app-error.js';
export class MongoMemory implements AgentMemoryRepository {
  constructor(readonly store: RecordStore, readonly budgets: BudgetConfig) {}
  get(userId: string, sessionId: string) {
    return this.store.read('agent-memory', agentMemoryManifestSchema, { _id: key('memory', userId, sessionId), userId, sessionId });
  }
  async put(manifest: AgentMemoryManifest): Promise<void> {
    const id = key('memory', manifest.userId, manifest.sessionId);
    const { record } = bounded(agentMemoryManifestSchema, manifest, id, this.budgets.maxManifestBytes);
    if (record.activeSummaryRef !== null || record.sourceRanges.some((r) => r.fromSequence > r.toSequence) ||
      new Set(record.messageRefs.map((r) => r.messageId)).size !== record.messageRefs.length ||
      record.messageRefs.some((r, i) => i > 0 && r.sequence <= record.messageRefs[i - 1].sequence)) throw new AppError('INVALID_REQUEST', 'Invalid context manifest.');
    const doc = await this.store.raw('agent-memory', { _id: id, userId: record.userId, sessionId: record.sessionId });
    const old = decode(agentMemoryManifestSchema, doc);
    if (!old) { await this.store.insert('agent-memory', agentMemoryManifestSchema, record, id, this.budgets.maxManifestBytes); return; }
    if (isDeepStrictEqual(old, record)) return;
    if (record.contextVersion !== old.contextVersion + 1 || !doc || !await this.store.replace('agent-memory', agentMemoryManifestSchema, record, id, doc._revision as number, this.budgets.maxManifestBytes)) throw new AppError('CONFLICT_ACTIVE_TURN', 'Context changed while saving.');
  }
}
```

- [ ] **Step 4: Implement metadata adapter.** `putAttempt` is immutable insertion; status changes must use the explicit CAS extension. This preserves acceptance fields rather than blindly overwriting them.

```typescript
// backend/src/persistence/metadata.ts
import { isDeepStrictEqual } from 'node:util';
import type { Filter } from 'mongodb';
import { attemptRecordSchema, type AttemptRecord, type AttemptStatus } from '../contracts/attempt.js';
import { accountingRecordSchema, type AccountingRecord } from '../contracts/metadata.js';
import type { MetadataRepository, PageQuery } from '../contracts/repositories.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import { RecordStore } from './store.js';
import { key, decode, generationSchema, acceptanceSchema, safeSequence, type StoredDocument } from './records.js';
import { page, cursor } from './pagination.js';
import { AppError } from '../platform/errors/app-error.js';
export class MongoMetadata implements MetadataRepository {
  constructor(readonly store: RecordStore, readonly budgets: BudgetConfig) {}
  async putAttempt(record: AttemptRecord): Promise<void> {
    const byId = await this.getAttempt(record.userId, record.sessionId, record.attemptId);
    if (byId && byId.idempotencyKey !== record.idempotencyKey) throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Attempt identity is already used.');
    await this.store.insert('metadata', attemptRecordSchema, record, key('attempt', record.userId, record.sessionId, record.idempotencyKey), this.budgets.maxDocumentBytes);
  }
  getAttempt(userId: string, sessionId: string, attemptId: string) {
    return this.store.read('metadata', attemptRecordSchema, { kind: 'attempt', userId, sessionId, attemptId });
  }
  getAttemptByIdempotency(userId: string, sessionId: string, idempotencyKey: string) {
    return this.store.read('metadata', attemptRecordSchema, { _id: key('attempt', userId, sessionId, idempotencyKey), kind: 'attempt', userId, sessionId, idempotencyKey });
  }
  async compareAttempt(record: AttemptRecord, expectedStatus: AttemptStatus): Promise<boolean> {
    const id = key('attempt', record.userId, record.sessionId, record.idempotencyKey);
    const doc = await this.store.raw('metadata', { _id: id, kind: 'attempt', userId: record.userId, sessionId: record.sessionId });
    const old = decode(attemptRecordSchema, doc);
    if (!old || !doc) return false;
    if (isDeepStrictEqual(old, record)) return true;
    const immutable = (r: AttemptRecord) => {
      const { status, updatedAt, generationId, truncated, errorCode, ...rest } = r;
      void status; void updatedAt; void generationId; void truncated; void errorCode; return rest;
    };
    if (!isDeepStrictEqual(immutable(old), immutable(record))) throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Accepted attempt identity cannot change.');
    if (old.status !== expectedStatus) return false;
    const allowed: Record<AttemptStatus, AttemptStatus[]> = {
      accepted: ['generating', 'failed', 'cancelled', 'interrupted'],
      generating: ['generating', 'finalizing', 'failed', 'cancelled', 'interrupted'],
      finalizing: ['finalizing', 'completed', 'truncated', 'failed', 'cancelled', 'interrupted'],
      completed: [], truncated: [], failed: [], cancelled: [], interrupted: [],
    };
    if (!allowed[old.status].includes(record.status) || record.truncated !== (record.status === 'truncated') ||
      (old.generationId !== null && old.generationId !== record.generationId)) throw new AppError('CONFLICT_ACTIVE_TURN', 'Invalid attempt transition.');
    return this.store.replace('metadata', attemptRecordSchema, record, id, doc._revision as number, this.budgets.maxDocumentBytes);
  }
  async putAccounting(record: AccountingRecord): Promise<void> {
    const value = accountingRecordSchema.parse(record);
    for (const tokens of [value.promptTokens, value.completionTokens]) if (tokens !== null) safeSequence(tokens);
    if (value.cost !== null && !Number.isFinite(value.cost)) throw new AppError('INVALID_REQUEST', 'Invalid accounting cost.');
    const linked = await this.getAttempt(value.userId, value.sessionId, value.attemptId);
    if (!linked || linked.turnId !== value.turnId || linked.modelId !== value.requestedModel) throw new AppError('INVALID_REQUEST', 'Accounting attempt linkage is invalid.');
    if (value.accountingStatus === 'known' && (value.cost === null || value.promptTokens === null || value.completionTokens === null)) throw new AppError('INVALID_REQUEST', 'Known accounting needs complete usage.');
    if (value.generationId) {
      const claim = await this.store.read('metadata', generationSchema, { kind: 'generation', userId: value.userId, generationId: value.generationId });
      if (claim && (claim.sessionId !== value.sessionId || claim.attemptId !== value.attemptId)) throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Generation is already assigned to another attempt.');
      await this.store.insert('metadata', generationSchema, { schemaVersion: 1, kind: 'generation',
        userId: value.userId, sessionId: value.sessionId, attemptId: value.attemptId, generationId: value.generationId },
        key('generation', value.userId, value.generationId), this.budgets.maxDocumentBytes);
    }
    const id = key('accounting', value.userId, value.sessionId, value.attemptId);
    const doc = await this.store.raw('metadata', { _id: id, userId: value.userId, sessionId: value.sessionId, kind: 'accounting' });
    const old = decode(accountingRecordSchema, doc);
    if (!old) { await this.store.insert('metadata', accountingRecordSchema, value, id, this.budgets.maxDocumentBytes); return; }
    if (isDeepStrictEqual(old, value)) return;
    if (old.turnId !== value.turnId || old.requestedModel !== value.requestedModel || old.startedAt !== value.startedAt ||
      ['generationId', 'promptTokens', 'completionTokens', 'cost', 'reportedModel', 'reportedProvider'].some((k) => {
        const field = k as 'generationId' | 'promptTokens' | 'completionTokens' | 'cost' | 'reportedModel' | 'reportedProvider';
        return old[field] !== null && old[field] !== value[field];
      }) || (old.accountingStatus === 'known' && value.accountingStatus !== 'known') ||
      (old.endedAt !== null && old.endedAt !== value.endedAt)) throw new AppError('CONFLICT_ACTIVE_TURN', 'Accounting evidence cannot be replaced.');
    if (!doc || !await this.store.replace('metadata', accountingRecordSchema, value, id, doc._revision as number, this.budgets.maxDocumentBytes)) throw new AppError('CONFLICT_ACTIVE_TURN', 'Accounting changed while saving.');
  }
  getAccounting(userId: string, sessionId: string, attemptId: string) {
    return this.store.read('metadata', accountingRecordSchema, { _id: key('accounting', userId, sessionId, attemptId), userId, sessionId });
  }
  getAcceptance(userId: string, sessionId: string, attemptId: string) {
    return this.store.read('metadata', acceptanceSchema, { _id: key('acceptance', userId, sessionId, attemptId), userId, sessionId });
  }
  async listAttempts(userId: string, sessionId: string, query: PageQuery) {
    const { limit, after } = page(query, 'attempts', userId, sessionId, this.budgets.maxPageSize);
    const filter: Filter<StoredDocument> = { userId, sessionId, kind: 'attempt' };
    if (after) filter.$or = [{ sequence: { $lt: after.value } }, { sequence: after.value, attemptId: { $lt: after.id } }];
    const docs = await this.store.collection('metadata').find(filter, this.store.options()).sort({ sequence: -1, attemptId: -1 }).limit(limit + 1).toArray();
    const items = docs.slice(0, limit).map((d) => decode(attemptRecordSchema, d)!);
    const last = items.at(-1);
    return { items, nextCursor: docs.length > limit && last ? cursor({ kind: 'attempts', userId, sessionId, value: last.sequence, id: last.attemptId }) : null };
  }
}
```

P5 must gate all writes while executing through Task 6's `run`; these P1 ports do not themselves accept leases. P4 returns accounting evidence; P5 persists it. Known usage may still have missing cost: use `pending`/`unknown`, preserving observed tokens, until complete usage/cost is known.

- [ ] **Step 5: Run green.** Native archive command; `npm run build` and `npm run lint`. Expected manifest replay succeeds, regression fails, one accounting record, generation conflict rejected.
- [ ] **Step 6: Commit.**

```powershell
git add backend/src/persistence/memory.ts backend/src/persistence/metadata.ts backend/test/persistence/archive.native.e2e-spec.ts
git commit -m "feat(p2): add versioned manifests and attempt accounting persistence"
```

### Task 6: Single-executor admission and conditional session ownership

**Files:** Create `backend/src/persistence/ownership.ts`, `backend/test/persistence/ownership.native.e2e-spec.ts`.

Admission policy is intentionally conservative. A durable sentinel is claimed on startup; a crashed owner blocks restart until P8's operator has verified the old process is stopped and no graph/database operations remain in flight. It has **no TTL/lease**. Session lease expiry is a write-stop signal, not failover. `handoffStoppedExecutor` is an administrative persistence primitive requiring that external proof; never call it merely because a timeout elapsed. P8 documents proof and P5 handles session recovery after stopped-owner handoff.

- [ ] **Step 1: Write failing tests.**

```typescript
import { DEFAULT_BUDGETS } from '../../src/contracts/index.js';
import { RecordStore } from '../../src/persistence/store.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { nativeDatabase } from './native.js';
import { session } from './fixtures.js';
describe('single-executor ownership', () => {
  it('blocks another executor and never steals an expired session lease', async () => {
    const h = await nativeDatabase();
    try {
      const store = new RecordStore(h.db, 15_000);
      await new MongoSessions(store, DEFAULT_BUDGETS).createIfAbsent(session());
      let time = Date.parse('2026-10-06T00:00:00.000Z');
      const a = new MongoOwnership(store, 'process-a', () => time);
      const b = new MongoOwnership(store, 'process-b', () => time);
      await a.claimExecutor();
      await expect(b.claimExecutor()).rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
      const input = { userId: 'u1', sessionId: 's1', ownerId: 'process-a', leaseMs: 1000 };
      const results = await Promise.all([a.acquire(input), a.acquire(input)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const success = results.find((r) => r.ok)!;
      if (!success.ok) throw new Error('lease expected');
      time += 1001;
      expect(await a.fence(success.lease)).toBe(false);
      expect((await a.acquire(input)).ok).toBe(false);
      await expect(a.run(success.lease, async () => 'write')).rejects.toMatchObject({ code: 'INTERRUPTED' });
      await a.release(success.lease);
      const next = await a.acquire(input);
      expect(next.ok).toBe(true);
      if (next.ok) expect(next.lease.generation).toBeGreaterThan(success.lease.generation);
      expect(await a.fence(success.lease)).toBe(false);
    } finally { await h.close(); }
  }, 30_000);
});
```

- [ ] **Step 2: Run red.** `npm run test:e2e -- test/persistence/ownership.native.e2e-spec.ts`; missing ownership adapter.
- [ ] **Step 3: Implement `ownership.ts` initial contents.**

```typescript
import type { Filter } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { sessionRecordSchema } from '../contracts/session.js';
import type { ExecutionOwnership, ExecutionLease, AcquireExecutionResult } from '../contracts/repositories.js';
import { idSchema } from '../contracts/identifiers.js';
import { RecordStore } from './store.js';
import { key, decode, executorSchema, EXECUTOR_SCOPE, safeSequence, type StoredDocument } from './records.js';
import { AppError } from '../platform/errors/app-error.js';
export class MongoOwnership implements ExecutionOwnership {
  private tail: Promise<void> = Promise.resolve();
  constructor(readonly store: RecordStore, readonly executorId: string = randomUUID(), readonly now = Date.now) { idSchema.parse(executorId); }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
  async claimExecutor(): Promise<void> {
    try { await this.store.insert('metadata', executorSchema, { schemaVersion: 1, kind: 'executor', ...EXECUTOR_SCOPE, ownerId: this.executorId }, key('executor'), 4096); }
    catch (error) {
      if (error instanceof AppError && error.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') throw new AppError('UNSUPPORTED_TOPOLOGY', 'Another executor owns this database.');
      throw error;
    }
  }
  async assertExecutor(): Promise<void> {
    const doc = await this.store.read('metadata', executorSchema, { _id: key('executor'), ...EXECUTOR_SCOPE, kind: 'executor' });
    if (doc?.ownerId !== this.executorId) throw new AppError('UNSUPPORTED_TOPOLOGY', 'This process is not the active executor.');
  }
  async handoffStoppedExecutor(previousExecutorId: string): Promise<void> {
    // Caller is an operator after verified process stop, not an expiry watcher.
    const doc = await this.store.raw('metadata', { _id: key('executor'), ...EXECUTOR_SCOPE, kind: 'executor', ownerId: previousExecutorId });
    if (!doc || !await this.store.replace('metadata', executorSchema, { schemaVersion: 1, kind: 'executor', ...EXECUTOR_SCOPE, ownerId: this.executorId },
      key('executor'), doc._revision as number, 4096)) throw new AppError('UNSUPPORTED_TOPOLOGY', 'Executor handoff could not be confirmed.');
  }
  private leaseFilter(lease: ExecutionLease): Filter<StoredDocument> {
    return { _id: key('session', lease.userId, lease.sessionId), userId: lease.userId, sessionId: lease.sessionId,
      'execution.ownerId': lease.ownerId, 'execution.generation': lease.generation };
  }
  async acquire(input: { userId: string; sessionId: string; ownerId: string; leaseMs: number; expectedGeneration?: number }): Promise<AcquireExecutionResult> {
    return this.exclusive(async () => {
      await this.assertExecutor();
      if (input.ownerId !== this.executorId || !Number.isInteger(input.leaseMs) || input.leaseMs < 1 || input.leaseMs > 180_000) throw new AppError('INVALID_REQUEST', 'Invalid execution ownership request.');
      const base = { _id: key('session', input.userId, input.sessionId), userId: idSchema.parse(input.userId), sessionId: idSchema.parse(input.sessionId) };
      const old = decode(sessionRecordSchema, await this.store.raw('sessions', base));
      if (!old || old.lifecycle !== 'active' || old.execution.ownerId !== null || old.execution.activeAttemptId !== null) return { ok: false, code: 'CONFLICT_ACTIVE_TURN' };
      const generation = safeSequence(old.execution.generation);
      if (generation === Number.MAX_SAFE_INTEGER) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Ownership capacity exceeded.');
      if (input.expectedGeneration !== undefined && input.expectedGeneration !== generation) return { ok: false, code: 'CONFLICT_ACTIVE_TURN' };
      const filter: Filter<StoredDocument> = { ...base, lifecycle: 'active', 'execution.ownerId': null,
        'execution.activeAttemptId': null, 'execution.generation': generation };
      const expiry = new Date(this.now() + input.leaseMs).toISOString();
      let record: StoredDocument | null;
      try {
        record = await this.store.collection('sessions').findOneAndUpdate(filter,
          { $set: { 'execution.ownerId': input.ownerId, 'execution.leaseExpiresAt': expiry },
            $inc: { 'execution.generation': 1, _revision: 1 } }, { returnDocument: 'after', includeResultMetadata: false, ...this.store.options() });
      } catch {
        record = await this.store.raw('sessions', { ...base, 'execution.ownerId': input.ownerId,
          'execution.generation': generation + 1, 'execution.leaseExpiresAt': expiry });
        if (!record) throw new AppError('PERSISTENCE_ERROR', 'Ownership could not be confirmed.');
      }
      if (!record) return { ok: false, code: 'CONFLICT_ACTIVE_TURN' };
      const saved = decode(sessionRecordSchema, record)!;
      return { ok: true, lease: { userId: input.userId, sessionId: input.sessionId, ownerId: input.ownerId,
        generation: saved.execution.generation, leaseExpiresAt: expiry } };
    });
  }
  async fence(lease: ExecutionLease): Promise<boolean> {
    await this.assertExecutor();
    if (lease.ownerId !== this.executorId) return false;
    const record = await this.store.raw('sessions', { ...this.leaseFilter(lease), 'execution.leaseExpiresAt': { $gt: new Date(this.now()).toISOString() } });
    return record !== null;
  }
  async run<T>(lease: ExecutionLease, action: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      if (!await this.fence(lease)) throw new AppError('INTERRUPTED', 'Execution ownership was lost.');
      return action();
    });
  }
  async renew(lease: ExecutionLease, leaseMs: number): Promise<ExecutionLease> {
    return this.run(lease, async () => {
      if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 180_000) throw new AppError('INVALID_REQUEST', 'Invalid lease duration.');
      const expiry = new Date(this.now() + leaseMs).toISOString();
      const result = await this.store.collection('sessions').updateOne(this.leaseFilter(lease),
        { $set: { 'execution.leaseExpiresAt': expiry }, $inc: { _revision: 1 } }, this.store.options());
      if (!result.matchedCount) throw new AppError('INTERRUPTED', 'Execution ownership was lost.');
      return { ...lease, leaseExpiresAt: expiry };
    });
  }
  async release(lease: ExecutionLease): Promise<void> {
    await this.exclusive(async () => {
      await this.assertExecutor();
      await this.store.collection('sessions').updateOne(this.leaseFilter(lease),
        { $set: { 'execution.ownerId': null, 'execution.leaseExpiresAt': null }, $inc: { _revision: 1 } }, this.store.options());
    });
  }
  async recoverStoppedSession(userId: string, sessionId: string, previousOwnerId: string | null, leaseMs: number): Promise<ExecutionLease> {
    // External stopped-process proof is mandatory even when its session lease expired.
    return this.exclusive(async () => {
      await this.assertExecutor();
      if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 180_000) throw new AppError('INVALID_REQUEST', 'Invalid lease duration.');
      const expiry = new Date(this.now() + leaseMs).toISOString();
      const doc = await this.store.collection('sessions').findOneAndUpdate({ _id: key('session', userId, sessionId), userId, sessionId,
        'execution.ownerId': previousOwnerId, 'execution.generation': { $lt: Number.MAX_SAFE_INTEGER } },
        { $set: { 'execution.ownerId': this.executorId, 'execution.leaseExpiresAt': expiry }, $inc: { 'execution.generation': 1, _revision: 1 } },
        { returnDocument: 'after', includeResultMetadata: false, ...this.store.options() });
      if (!doc) throw new AppError('CONFLICT_ACTIVE_TURN', 'Recovery ownership could not be obtained.');
      const saved = decode(sessionRecordSchema, doc)!;
      return { userId, sessionId, ownerId: this.executorId, generation: saved.execution.generation, leaseExpiresAt: expiry };
    });
  }
  async drain(): Promise<void> { await this.tail; }
  async releaseExecutor(): Promise<void> {
    await this.exclusive(async () => {
      const active = await this.store.collection('sessions').findOne({ 'execution.ownerId': this.executorId }, this.store.options());
      if (active) throw new AppError('NOT_READY', 'Executor still owns chat work.');
      await this.store.collection('metadata').deleteOne({ _id: key('executor'), ...EXECUTOR_SCOPE, kind: 'executor', ownerId: this.executorId }, this.store.options());
    });
  }
}
```

The queue serializes only guarded persistence I/O; it must not wrap inference or an entire graph invocation (that would deadlock guarded saver writes). Call `run` for each application write group; nested `run`, `renew`, or `release` inside `run` is prohibited. Construct exactly one ownership object/bundle per database in the process; reuse it for all saver bindings. Long-running graph/model work is managed by P5. No existing write is killed by a JS timeout; the executor is not released while unresolved operations exist. `drain` drains queued persistence operations, not model/graph work: P5/P8 must first stop admission and quiesce graph/provider tasks. Same-process recovery after lease expiry requires old graph tasks to be stopped and guarded I/O drained; different-process handoff requires stopped-process proof, never elapsed time.

- [ ] **Step 4: Run green** with ownership command plus `npm run build`.
- [ ] **Step 5: Commit.**

```powershell
git add backend/src/persistence/ownership.ts backend/test/persistence/ownership.native.e2e-spec.ts
git commit -m "feat(p2): enforce single executor and conditional session ownership"
```

### Task 7: Sequence reservations and durable acceptance/reconciliation primitives

**Files:** Extend `backend/src/persistence/ownership.ts`, `backend/test/persistence/ownership.native.e2e-spec.ts`.

- [ ] **Step 1: Add failing test** (import `MongoMessages`, `MongoMetadata`, `message`, `attempt`, `hashPayload`).

```typescript
it('replays reserved order and confirms acceptance only after input and attempt exist', async () => {
  const h = await nativeDatabase();
  try {
    const store = new RecordStore(h.db, 15_000);
    const sessions = new MongoSessions(store, DEFAULT_BUDGETS);
    const messages = new MongoMessages(store, DEFAULT_BUDGETS);
    const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
    const owner = new MongoOwnership(store, 'process-a');
    await sessions.createIfAbsent(session()); await owner.claimExecutor();
    const result = await owner.acquire({ userId: 'u1', sessionId: 's1', ownerId: 'process-a', leaseMs: 60_000 });
    if (!result.ok) throw new Error('lease expected');
    const lease = result.lease;
    const first = await owner.allocateSequences(lease, 'reservation-a', 3);
    expect(await owner.allocateSequences(lease, 'reservation-a', 3)).toEqual(first);
    const second = await owner.allocateSequences(lease, 'reservation-b', 2);
    expect(second.start).toBeGreaterThanOrEqual(first.start + first.count);
    await owner.reserveAttempt(lease, 'a1');
    await expect(owner.confirmAcceptance(lease, 'a1')).rejects.toMatchObject({ code: 'NOT_READY' });
    await owner.run(lease, async () => {
      await messages.append(message());
      await metadata.putAttempt({ ...attempt(), payloadHash: hashPayload(message().content) });
    });
    await owner.confirmAcceptance(lease, 'a1'); await owner.confirmAcceptance(lease, 'a1');
    expect((await sessions.get('u1', 's1'))?.latestTurnId).toBe('t1');
    expect((await metadata.getAcceptance('u1', 's1', 'a1'))?.userMessageId).toBe('m0');
    await expect(owner.reserveAttempt(lease, 'a2')).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
    await owner.release(lease);
    expect((await owner.acquire({ userId: 'u1', sessionId: 's1', ownerId: 'process-a', leaseMs: 60_000 })).ok).toBe(false);
  } finally { await h.close(); }
}, 30_000);
```

- [ ] **Step 2: Run red.** Ownership command; missing extension methods.
- [ ] **Step 3: Add these imports and class methods** to `ownership.ts` (keep Task 6 methods).

```typescript
// Additional imports at file top:
import { counterSchema, reservationSchema, acceptanceSchema } from './records.js';
import { attemptRecordSchema } from '../contracts/attempt.js';
import { messageRecordSchema } from '../contracts/message.js';
import { hashPayload } from '../platform/crypto/hash-payload.js';

// Add inside MongoOwnership:
async allocateSequences(lease: ExecutionLease, reservationId: string, count: number) {
  return this.run(lease, async () => {
    idSchema.parse(reservationId);
    if (!Number.isInteger(count) || count < 1 || count > 80) throw new AppError('INVALID_REQUEST', 'Invalid sequence reservation.');
    const scope = { userId: lease.userId, sessionId: lease.sessionId };
    const id = key('sequence-reservation', lease.userId, lease.sessionId, reservationId);
    const existing = await this.store.read('metadata', reservationSchema, { _id: id, ...scope });
    if (existing) {
      if (existing.count !== count) throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Sequence reservation changed.');
      return existing;
    }
    const counterId = key('sequence-counter', lease.userId, lease.sessionId);
    const rawCounter = await this.store.raw('metadata', { _id: counterId, ...scope });
    if (!rawCounter) {
      const priorMessage = await this.store.collection('messages').findOne(scope, this.store.options());
      const priorReservation = await this.store.collection('metadata').findOne({ ...scope, kind: 'sequence-reservation' }, this.store.options());
      if (priorMessage || priorReservation) throw new AppError('NOT_READY', 'Ordering state needs restore reconciliation.');
      await this.store.insert('metadata', counterSchema, { schemaVersion: 1, kind: 'sequence-counter', ...scope, next: 0 }, counterId, 4096);
    }
    const counter = await this.store.collection('metadata').findOneAndUpdate({ _id: counterId, ...scope,
      next: { $lte: Number.MAX_SAFE_INTEGER - count } }, { $inc: { next: count, _revision: 1 } },
      { returnDocument: 'before', includeResultMetadata: false, ...this.store.options() });
    // An ambiguous increment is NOT retried here. Caller may retry this reservation;
    // if no reservation was saved, the next increment legitimately leaves a gap.
    if (!counter) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Ordering capacity exceeded.');
    const record = { schemaVersion: 1 as const, kind: 'sequence-reservation' as const, ...scope,
      reservationId, start: safeSequence(counter.next as number), count };
    return this.store.insert('metadata', reservationSchema, record, id, 4096);
  });
}
async reserveAttempt(lease: ExecutionLease, attemptId: string): Promise<void> {
  await this.run(lease, async () => {
    idSchema.parse(attemptId);
    const result = await this.store.collection('sessions').updateOne({ ...this.leaseFilter(lease),
      $or: [{ 'execution.activeAttemptId': null }, { 'execution.activeAttemptId': attemptId }] },
      { $set: { 'execution.activeAttemptId': attemptId }, $inc: { _revision: 1 } }, this.store.options());
    if (!result.matchedCount) throw new AppError('CONFLICT_ACTIVE_TURN', 'Another turn is active.');
  });
}
async confirmAcceptance(lease: ExecutionLease, attemptId: string): Promise<void> {
  await this.run(lease, async () => {
    const scope = { userId: lease.userId, sessionId: lease.sessionId };
    const session = await this.store.raw('sessions', { ...this.leaseFilter(lease), 'execution.activeAttemptId': attemptId });
    const attempt = await this.store.read('metadata', attemptRecordSchema, { ...scope, kind: 'attempt', attemptId });
    const input = attempt ? await this.store.read('messages', messageRecordSchema,
      { ...scope, _id: key('message', lease.userId, lease.sessionId, attempt.causal.userMessageId) }) : null;
    if (!session || !attempt || !input || input.role !== 'user' || input.turnId !== attempt.turnId || hashPayload(input.content) !== attempt.payloadHash) throw new AppError('NOT_READY', 'Accepted chat data needs recovery.');
    const marker = { schemaVersion: 1 as const, kind: 'acceptance' as const, ...scope, turnId: attempt.turnId,
      attemptId, userMessageId: input.messageId, payloadHash: attempt.payloadHash };
    await this.store.insert('metadata', acceptanceSchema, marker, key('acceptance', lease.userId, lease.sessionId, attemptId), 4096);
    const result = await this.store.collection('sessions').updateOne({ ...this.leaseFilter(lease), 'execution.activeAttemptId': attemptId },
      { $set: { latestTurnId: attempt.turnId }, $inc: { _revision: 1 } }, this.store.options());
    if (!result.matchedCount) throw new AppError('INTERRUPTED', 'Acceptance ownership was lost.');
  });
}
async clearAttempt(lease: ExecutionLease, attemptId: string): Promise<void> {
  await this.run(lease, async () => {
    const attempt = await this.store.read('metadata', attemptRecordSchema,
      { userId: lease.userId, sessionId: lease.sessionId, kind: 'attempt', attemptId });
    if (attempt && !['completed', 'truncated', 'failed', 'cancelled', 'interrupted'].includes(attempt.status)) throw new AppError('NOT_READY', 'The attempt is not finalized.');
    // Missing attempt is a partial-acceptance crash. P5 must first reconcile any
    // surviving input; clearing does not mark it completed or run inference.
    const result = await this.store.collection('sessions').updateOne({ ...this.leaseFilter(lease), 'execution.activeAttemptId': attemptId },
      { $set: { 'execution.activeAttemptId': null }, $inc: { _revision: 1 } }, this.store.options());
    if (!result.matchedCount) {
      const saved = await this.store.raw('sessions', this.leaseFilter(lease));
      if (!saved || saved.execution.activeAttemptId !== null) throw new AppError('CONFLICT_ACTIVE_TURN', 'Attempt ownership changed.');
    }
  });
}
```

Normal order is P5-owned: validate budgets → deterministic scope/IDs → create first session while accepting (not on navigation) → acquire → reserve attempt → allocate → user message → accepted attempt → confirm acceptance → inference. A new-chat retry with `sessionId:null` must deterministically derive its session ID from server user plus request identity in P5; otherwise the per-session idempotency key cannot deduplicate repeated new-chat requests. Retry payload hashing uses the **original input content**, not the retry command JSON.

For a first attempt, use a reproducible input ID (`key('input',userId,sessionId,attemptId)`, or an equivalent documented P5 recipe), so the active slot can locate an orphaned user message even if its attempt insert never committed. Explicit retry uses the original message ID, not a new input ID. P5 checks the acceptance marker, original record hash, and terminal result before deciding any recovery action.

Recovery accepts a non-null stopped previous owner or a released-but-active session (`previousOwnerId:null`). This does not change P1's lease interface. P5 must not use normal `acquire` to bypass pending acceptance.

- [ ] **Step 4: Run green** with ownership command, then build/lint. Expected no inference path, no second user input, stable reservation on replay, active slot blocks after release until reconciliation.
- [ ] **Step 5: Commit.**

```powershell
git add backend/src/persistence/ownership.ts backend/test/persistence/ownership.native.e2e-spec.ts
git commit -m "feat(p2): add durable ordering and acceptance reference primitives"
```

### Task 8: Guarded standard saver and checked setup facade

**Files:** Create `backend/src/persistence/checkpoints.ts`, `backend/test/persistence/checkpoints.native.e2e-spec.ts`.

Installed saver evidence: `setup(): Promise<Error[]>`, **not** P1's `CheckpointerSetup.setup(): Promise<void>`. A direct `MongoDBSaver implements CheckpointerSetup` is incorrect. The facade below checks the error array; its concrete `bind(lease)` returns a saver subclass compatible with graph compilation. Do not cast away setup failure.

- [ ] **Step 1: Write failing native test.**

```typescript
import { emptyCheckpoint } from '@langchain/langgraph-checkpoint';
import { DEFAULT_BUDGETS } from '../../src/contracts/index.js';
import { MongoCheckpointFactory } from '../../src/persistence/checkpoints.js';
import { RecordStore } from '../../src/persistence/store.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { graphThreadId } from '../../src/persistence/records.js';
import { session } from './fixtures.js';
import { nativeDatabase } from './native.js';
describe('standard MongoDB saver', () => {
  it('sets up both collections, replays pending writes and restores after a new factory', async () => {
    const h = await nativeDatabase();
    try {
      const store = new RecordStore(h.db, 15_000);
      await new MongoSessions(store, DEFAULT_BUDGETS).createIfAbsent(session());
      const owner = new MongoOwnership(store, 'process-a'); await owner.claimExecutor();
      const result = await owner.acquire({ userId: 'u1', sessionId: 's1', ownerId: 'process-a', leaseMs: 60_000 });
      if (!result.ok) throw new Error('lease expected');
      const factory = new MongoCheckpointFactory(h.client, h.name, owner, DEFAULT_BUDGETS);
      const handle = await factory.create(); await handle.setup(); await handle.setup();
      const saver = handle.bind(result.lease);
      const cp = emptyCheckpoint(); cp.channel_values = { result: { attemptId: 'a1', text: 'saved result' } };
      const cfg = { configurable: { thread_id: graphThreadId('u1', 's1'), checkpoint_ns: '' } };
      const saved = await saver.put(cfg, cp, { source: 'update', step: 1, parents: {} });
      await saver.put(cfg, cp, { source: 'update', step: 1, parents: {} });
      expect(await h.db.collection('checkpoints').countDocuments({ thread_id: graphThreadId('u1', 's1') })).toBe(1);
      await saver.putWrites(saved, [['result', 'pending']], 'task-a');
      await saver.putWrites(saved, [['result', 'pending']], 'task-a');
      await saver.putWrites(saved, [], 'task-empty');
      const secondClient = await h.reconnect();
      try {
        const restarted = (await new MongoCheckpointFactory(secondClient, h.name, owner, DEFAULT_BUDGETS).create()).bind(result.lease);
        expect((await restarted.getTuple(saved))?.checkpoint.channel_values.result).toEqual({ attemptId: 'a1', text: 'saved result' });
        expect((await restarted.getTuple(saved))?.pendingWrites).toHaveLength(1);
      } finally { await secondClient.close(); }
      expect(await h.db.collection('checkpoint_writes').countDocuments({ thread_id: graphThreadId('u1', 's1') })).toBe(1);
      for (const name of ['checkpoints', 'checkpoint_writes']) {
        const indexes = await h.db.collection(name).indexes();
        expect(indexes.some((i) => i.name?.startsWith('thread_ns_checkpoint'))).toBe(true);
        expect(indexes.filter((i) => i.name !== '_id_').every((i) => !i.unique && i.expireAfterSeconds === undefined)).toBe(true);
      }
      await expect(saver.getTuple({ configurable: { thread_id: graphThreadId('u2', 's1'), checkpoint_ns: '' } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      const oversized = emptyCheckpoint(); oversized.channel_values = { text: 'x'.repeat(1_800_000) };
      await expect(saver.put(cfg, oversized, { source: 'update', step: 2, parents: {} })).rejects.toMatchObject({ code: 'STORAGE_BUDGET_EXCEEDED' });
      await owner.release(result.lease);
      await expect(saver.put(cfg, cp, { source: 'update', step: 3, parents: {} })).rejects.toMatchObject({ code: 'INTERRUPTED' });
    } finally { await h.close(); }
  }, 30_000);
});
```

- [ ] **Step 2: Run red.** `npm run test:e2e -- test/persistence/checkpoints.native.e2e-spec.ts`; missing factory.
- [ ] **Step 3: Implement `checkpoints.ts`.** Preserve stock `put`/`putWrites` storage layout and semantics. Preflight actual serializer output and bound its stored envelope; no custom checkpoint transcript decoding for UI.

```typescript
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { WRITES_IDX_MAP, type Checkpoint, type CheckpointMetadata, type PendingWrite,
  type CheckpointListOptions } from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Binary, type MongoClient } from 'mongodb';
import type { BudgetConfig } from '../contracts/budgets.js';
import type { CheckpointStoreFactory, CheckpointerSetup, ExecutionLease } from '../contracts/repositories.js';
import { graphThreadId, assertBytes } from './records.js';
import { MongoOwnership } from './ownership.js';
import { AppError } from '../platform/errors/app-error.js';
export class ScopedMongoSaver extends MongoDBSaver {
  constructor(client: MongoClient, dbName: string, readonly owner: MongoOwnership,
    readonly lease: ExecutionLease, readonly budgets: BudgetConfig) {
    super({ client, dbName, checkpointCollectionName: 'checkpoints', checkpointWritesCollectionName: 'checkpoint_writes' });
  }
  private scope(config: RunnableConfig): void {
    const c = config.configurable;
    if (c?.thread_id !== graphThreadId(this.lease.userId, this.lease.sessionId) || (c.checkpoint_ns !== undefined && c.checkpoint_ns !== '') ||
      (c.checkpoint_id !== undefined && (typeof c.checkpoint_id !== 'string' || c.checkpoint_id.length > 128))) throw new AppError('INVALID_REQUEST', 'Invalid graph persistence scope.');
  }
  override async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig> {
    this.scope(config);
    return this.owner.run(this.lease, async () => {
      const [[type, cp], [metaType, meta]] = await Promise.all([this.serde.dumpsTyped(checkpoint), this.serde.dumpsTyped(metadata)]);
      if (type !== metaType) throw new AppError('PERSISTENCE_ERROR', 'Graph state could not be saved.');
      assertBytes({ _id: 'x'.repeat(64), thread_id: config.configurable!.thread_id, checkpoint_ns: '', checkpoint_id: checkpoint.id,
        parent_checkpoint_id: config.configurable?.checkpoint_id, type, checkpoint: new Binary(cp), metadata: new Binary(meta), metadata_search: metadata }, this.budgets.maxDocumentBytes);
      // Stock put is an idempotent upsert. If acknowledgment is ambiguous,
      // propagate failure; P5 reads saved graph state before deciding recovery.
      return super.put(config, checkpoint, metadata);
    });
  }
  override async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    this.scope(config);
    if (taskId.length > 128 || writes.length > 80) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Graph writes exceed their limit.');
    await this.owner.run(this.lease, async () => {
      if (!writes.length) return;
      const c = config.configurable!;
      if (typeof c.checkpoint_id !== 'string' || c.checkpoint_ns !== '') throw new AppError('INVALID_REQUEST', 'Graph write identity is missing.');
      const query = { thread_id: c.thread_id, checkpoint_ns: '', checkpoint_id: c.checkpoint_id };
      // Count existing identities and only new indices. Bound total pending reads
      // to 80 across tasks, not just each batch. Guard serializes this preflight.
      const existing = await this.db.collection('checkpoint_writes').find(query).limit(81).toArray();
      const identities = new Set(existing.map((d) => JSON.stringify([d.task_id, d.idx])));
      const sizes = new Map(existing.map((d) => [JSON.stringify([d.task_id, d.idx]), assertBytes(d, this.budgets.maxDocumentBytes)]));
      for (const [i, [channel, value]] of writes.entries()) {
        const idx = WRITES_IDX_MAP[channel] ?? i;
        identities.add(JSON.stringify([taskId, idx]));
        const [type, serialized] = await this.serde.dumpsTyped(value);
        const bytes = assertBytes({ _id: 'x'.repeat(64), ...query, task_id: taskId, idx, channel, type, value: new Binary(serialized) }, this.budgets.maxDocumentBytes);
        const identity = JSON.stringify([taskId, idx]);
        sizes.set(identity, Math.max(sizes.get(identity) ?? 0, bytes));
      }
      if (identities.size > 80 || [...sizes.values()].reduce((sum, size) => sum + size, 0) > this.budgets.maxDocumentBytes) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Graph writes exceed their limit.');
      await super.putWrites(config, writes, taskId);
    });
  }
  override async getTuple(config: RunnableConfig) {
    this.scope(config);
    const c = config.configurable!;
    const latest = await this.db.collection('checkpoints').find({ thread_id: c.thread_id, checkpoint_ns: '',
      ...(c.checkpoint_id ? { checkpoint_id: c.checkpoint_id } : {}) }).sort({ checkpoint_id: -1 }).limit(1).toArray();
    if (latest[0]) {
      assertBytes(latest[0], this.budgets.maxDocumentBytes);
      const pending = await this.db.collection('checkpoint_writes').find({ thread_id: c.thread_id,
        checkpoint_ns: '', checkpoint_id: latest[0].checkpoint_id }).limit(81).toArray();
      if (pending.length > 80 || pending.reduce((sum, doc) => sum + assertBytes(doc, this.budgets.maxDocumentBytes), 0) > this.budgets.maxDocumentBytes) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Saved graph writes exceed their limit.');
    }
    return super.getTuple(config);
  }
  override async *list(config: RunnableConfig, options: CheckpointListOptions = {}) {
    this.scope(config);
    if (options.before) this.scope(options.before);
    const limit = options.limit ?? this.budgets.defaultPageSize;
    if (!Number.isInteger(limit) || limit < 1 || limit > this.budgets.maxPageSize || options.filter) throw new AppError('INVALID_REQUEST', 'Invalid graph history query.');
    // Do not use stock list's unbounded pending-write loads. Select bounded IDs,
    // then load through our checked getTuple while retaining stock deserialization.
    const c = config.configurable!;
    const docs = await this.db.collection('checkpoints').find({ thread_id: c.thread_id, checkpoint_ns: '',
      ...(options.before?.configurable?.checkpoint_id ? { checkpoint_id: { $lt: options.before.configurable.checkpoint_id } } : {}) })
      .project({ checkpoint_id: 1 }).sort({ checkpoint_id: -1 }).limit(limit).toArray();
    for (const doc of docs) {
      const tuple = await this.getTuple({ configurable: { thread_id: c.thread_id, checkpoint_ns: '', checkpoint_id: doc.checkpoint_id } });
      if (tuple) yield tuple;
    }
  }
  override async deleteThread(_threadId: string): Promise<void> {
    void _threadId;
    throw new AppError('INVALID_REQUEST', 'Graph deletion requires an operational retention procedure.');
  }
}
export class MongoCheckpointFactory implements CheckpointStoreFactory {
  constructor(readonly client: MongoClient, readonly dbName: string, readonly owner: MongoOwnership, readonly budgets: BudgetConfig) {}
  async create(): Promise<CheckpointerSetup & { bind(lease: ExecutionLease): ScopedMongoSaver }> {
    const setupSaver = new MongoDBSaver({ client: this.client, dbName: this.dbName,
      checkpointCollectionName: 'checkpoints', checkpointWritesCollectionName: 'checkpoint_writes' });
    return {
      async setup(): Promise<void> {
        const errors = await setupSaver.setup();
        if (errors.length) throw new AppError('NOT_READY', 'Graph storage setup failed.');
      },
      bind: (lease) => new ScopedMongoSaver(this.client, this.dbName, this.owner, lease, this.budgets),
    };
  }
}
```

P5 uses `bind(lease)` with one stable root namespace, `durability:'sync'`, no nested subgraph namespaces/delta channels, and a small graph. Checkpoint state contains bounded public result/reference/version data, never private reasoning, raw provider responses, or a growing archive transcript. Each checkpoint has at most 80 pending writes and their combined BSON budget is also 1,800,000 bytes. P2's scope checks are backend safety, not authentication. Stock pending-write upserts have non-unique indexes; only admitted/serialized single-executor writes are supported. Foreign direct DB writers and concurrent unguarded savers are outside the supported topology.

- [ ] **Step 4: Add and run failure regression.** Inject setup failure without real network credentials by spying on the installed class, then assert the facade rejects (add to the native saver test):

```typescript
const spy = vi.spyOn(MongoDBSaver.prototype, 'setup').mockResolvedValueOnce([new Error('index failure')]);
try { await expect(handle.setup()).rejects.toMatchObject({ code: 'NOT_READY' }); }
finally { spy.mockRestore(); }
```

Add `import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';`. Run the saver command; then build/lint. Expected both collections and pending writes actually exercised, no TTL/custom uniqueness, oversize and wrong-scope rejected, setup failure not swallowed.

- [ ] **Step 5: Commit.**

```powershell
git add backend/src/persistence/checkpoints.ts backend/test/persistence/checkpoints.native.e2e-spec.ts
git commit -m "feat(p2): integrate scoped bounded standard MongoDB checkpoints"
```

### Task 9: Exportable persistence bundle and ambiguous-write regression tests

**Files:** Create `backend/src/persistence/persistence.ts`, `backend/src/persistence/index.ts`, `backend/test/persistence/faults.native.e2e-spec.ts`; extend the three native suites for coverage below.

- [ ] **Step 1: Write failing tests** for bundle setup and lost acknowledgment after durable immutable/CAS writes.

```typescript
// backend/test/persistence/faults.native.e2e-spec.ts
import { messageRecordSchema, DEFAULT_BUDGETS } from '../../src/contracts/index.js';
import { RecordStore } from '../../src/persistence/store.js';
import { key } from '../../src/persistence/records.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { nativeDatabase } from './native.js';
import { message } from './fixtures.js';
describe('ambiguous persistence writes', () => {
  it('rereads an upsert committed before the acknowledgment failed', async () => {
    const h = await nativeDatabase();
    try {
      const store = new RecordStore(h.db, 15_000);
      const collection = h.db.collection('messages');
      const original = collection.updateOne.bind(collection);
      const spy = vi.spyOn(collection, 'updateOne').mockImplementationOnce(async (...args) => {
        await original(...args); throw new Error('lost acknowledgment');
      });
      const dbSpy = vi.spyOn(h.db, 'collection').mockReturnValue(collection);
      try {
        const id = key('message', 'u1', 's1', 'm0');
        await store.insert('messages', messageRecordSchema, message(), id, 65_536);
        expect(await collection.countDocuments({ userId: 'u1', sessionId: 's1' })).toBe(1);
      } finally { dbSpy.mockRestore(); spy.mockRestore(); }
      const bundle = await createPersistenceBundle(h.client, h.name, DEFAULT_BUDGETS, 'process-fixture');
      expect(await bundle.ping()).toBe(true);
      expect((await bundle.messages.get('u1', 's1', 'm0'))?.content).toBe('Hello');
      await bundle.owner.releaseExecutor();
    } finally { await h.close(); }
  }, 30_000);
  it('verifies a replacement committed before acknowledgment failed and rejects stale revisions', async () => {
    const h = await nativeDatabase();
    try {
      const store = new RecordStore(h.db, 15_000);
      const id = key('message', 'u1', 's1', 'm0');
      await store.insert('messages', messageRecordSchema, message(), id, 65_536);
      const collection = h.db.collection('messages');
      const original = collection.replaceOne.bind(collection);
      const spy = vi.spyOn(collection, 'replaceOne').mockImplementationOnce(async (...args) => {
        await original(...args); throw new Error('lost acknowledgment');
      });
      const dbSpy = vi.spyOn(h.db, 'collection').mockReturnValue(collection);
      try {
        const next = { ...message(), completionStatus: 'interrupted' as const };
        expect(await store.replace('messages', messageRecordSchema, next, id, 0, 65_536)).toBe(true);
        expect(await store.replace('messages', messageRecordSchema, { ...next, completionStatus: 'cancelled' }, id, 0, 65_536)).toBe(false);
      } finally { dbSpy.mockRestore(); spy.mockRestore(); }
    } finally { await h.close(); }
  }, 30_000);
});
```

- [ ] **Step 2: Run red.** `npm run test:e2e -- test/persistence/faults.native.e2e-spec.ts`; missing composition export.
- [ ] **Step 3: Implement composition and exports.** No Nest module/central wiring edit; P9 can supply the exported bundle to its own providers. `createPersistenceBundle` uses an already-connected client, so native tests do not create an extra connection or own its lifetime.

```typescript
// backend/src/persistence/persistence.ts
import { MongoClient } from 'mongodb';
import type { AurvinConfig } from '../platform/config/load-config.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import { AppError } from '../platform/errors/app-error.js';
import { RecordStore } from './store.js';
import { setupIndexes } from './indexes.js';
import { MongoSessions } from './sessions.js';
import { MongoMessages } from './messages.js';
import { MongoMemory } from './memory.js';
import { MongoMetadata } from './metadata.js';
import { MongoOwnership } from './ownership.js';
import { MongoCheckpointFactory } from './checkpoints.js';
export async function createPersistenceBundle(client: MongoClient, dbName: string, budgets: BudgetConfig, executorId?: string) {
  const store = new RecordStore(client.db(dbName), budgets.persistenceTimeoutMs);
  const owner = new MongoOwnership(store, executorId);
  await owner.claimExecutor();
  try {
    await setupIndexes(store.db);
    const checkpoints = new MongoCheckpointFactory(client, dbName, owner, budgets);
    const checkpointer = await checkpoints.create(); await checkpointer.setup();
    return { sessions: new MongoSessions(store, budgets), messages: new MongoMessages(store, budgets),
      memory: new MongoMemory(store, budgets), metadata: new MongoMetadata(store, budgets), owner, checkpoints,
      async ping(): Promise<boolean> {
        try { await store.db.command({ ping: 1, maxTimeMS: budgets.persistenceTimeoutMs }, { timeoutMS: budgets.persistenceTimeoutMs }); return true; }
        catch { return false; }
      } };
  } catch (error) { await owner.releaseExecutor(); throw error; }
}
export type PersistenceBundle = Awaited<ReturnType<typeof createPersistenceBundle>>;
export async function openPersistence(config: AurvinConfig) {
  if (config.topology.executor !== 'single-process') throw new AppError('UNSUPPORTED_TOPOLOGY', 'Only one executor is supported.');
  // Azure activation requires R1 facts and Task 10 assertions. Until those are
  // available, this constructor deliberately permits the native profile only.
  if (config.persistence.profile !== 'native-mongodb' || !config.persistence.mongoUri) throw new AppError('NOT_READY', 'The persistence service has not been verified.');
  const client = new MongoClient(config.persistence.mongoUri, { retryWrites: false,
    maxIdleTimeMS: 120_000, connectTimeoutMS: config.budgets.connectTimeoutMs,
    serverSelectionTimeoutMS: config.budgets.connectTimeoutMs, timeoutMS: config.budgets.persistenceTimeoutMs,
    writeConcern: { w: 'majority' } });
  try {
    await client.connect();
    const bundle = await createPersistenceBundle(client, config.persistence.mongoDbName, config.budgets);
    return { ...bundle, async close(): Promise<void> {
      await bundle.owner.drain(); await bundle.owner.releaseExecutor(); await client.close();
    } };
  } catch (error) {
    await client.close();
    if (error instanceof AppError) throw error;
    throw new AppError('NOT_READY', 'Chat storage is unavailable.');
  }
}
```

```typescript
// backend/src/persistence/index.ts
export { graphThreadId } from './records.js';
export { MongoSessions } from './sessions.js';
export { MongoMessages } from './messages.js';
export { MongoMemory } from './memory.js';
export { MongoMetadata } from './metadata.js';
export { MongoOwnership } from './ownership.js';
export { MongoCheckpointFactory, ScopedMongoSaver } from './checkpoints.js';
export { createPersistenceBundle, openPersistence, type PersistenceBundle } from './persistence.js';
```

- [ ] **Step 4: Add complete crash-window and topology regressions before claiming native completion.** Add the following two tests to the archive suite (its earlier imports already include these adapters/fixtures):

```typescript
it('paginates tied session activity with stable identity order', async () => {
  const h = await nativeDatabase();
  try {
    const sessions = new MongoSessions(new RecordStore(h.db, 15_000), DEFAULT_BUDGETS);
    for (const id of ['s1', 's2', 's3']) await sessions.createIfAbsent({ ...session('u1', id), latestTurnId: 't1' });
    const p1 = await sessions.list('u1', { cursor: null, limit: 2 });
    const p2 = await sessions.list('u1', { cursor: p1.nextCursor, limit: 2 });
    expect([...p1.items, ...p2.items].map((s) => s.sessionId)).toEqual(['s3', 's2', 's1']);
  } finally { await h.close(); }
}, 30_000);
it('replays terminal attempt CAS but rejects regression and duplicate attempt identity', async () => {
  const h = await nativeDatabase();
  try {
    const metadata = new MongoMetadata(new RecordStore(h.db, 15_000), DEFAULT_BUDGETS);
    await metadata.putAttempt(attempt());
    await expect(metadata.putAttempt({ ...attempt(), idempotencyKey: 'different-key' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    const generating = { ...attempt(), status: 'generating' as const };
    expect(await metadata.compareAttempt(generating, 'accepted')).toBe(true);
    const interrupted = { ...generating, status: 'interrupted' as const, errorCode: 'INTERRUPTED' as const };
    expect(await metadata.compareAttempt(interrupted, 'generating')).toBe(true);
    expect(await metadata.compareAttempt(interrupted, 'generating')).toBe(true);
    await expect(metadata.compareAttempt(generating, 'interrupted')).rejects.toThrow();
  } finally { await h.close(); }
}, 30_000);
```

Add these tests to the ownership suite (retain imports added in Task 7):

```typescript
it('requires explicit stopped handoff and fences all prior owner tokens', async () => {
  const h = await nativeDatabase();
  try {
    const store = new RecordStore(h.db, 15_000);
    await new MongoSessions(store, DEFAULT_BUDGETS).createIfAbsent(session());
    const a = new MongoOwnership(store, 'process-a');
    const b = new MongoOwnership(store, 'process-b');
    await a.claimExecutor();
    const r = await a.acquire({ userId: 'u1', sessionId: 's1', ownerId: 'process-a', leaseMs: 60_000 });
    if (!r.ok) throw new Error('lease expected');
    // A is quiescent here: no graph/model operation exists in this fixture.
    // Real handoff additionally requires P8's stopped-process proof.
    await a.drain(); await b.handoffStoppedExecutor('process-a');
    const recovered = await b.recoverStoppedSession('u1', 's1', 'process-a', 60_000);
    expect(recovered.generation).toBeGreaterThan(r.lease.generation);
    await expect(a.run(r.lease, async () => 'unsafe')).rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
  } finally { await h.close(); }
}, 30_000);
it('retains acceptance across restart and reconciles a released active slot', async () => {
  const h = await nativeDatabase();
  try {
    const store = new RecordStore(h.db, 15_000);
    await new MongoSessions(store, DEFAULT_BUDGETS).createIfAbsent(session());
    const owner = new MongoOwnership(store, 'process-a'); await owner.claimExecutor();
    const r = await owner.acquire({ userId: 'u1', sessionId: 's1', ownerId: 'process-a', leaseMs: 60_000 });
    if (!r.ok) throw new Error('lease expected');
    await owner.reserveAttempt(r.lease, 'a1');
    await owner.run(r.lease, async () => {
      await new MongoMessages(store, DEFAULT_BUDGETS).append(message());
      await new MongoMetadata(store, DEFAULT_BUDGETS).putAttempt({ ...attempt(), payloadHash: hashPayload(message().content) });
    });
    await owner.confirmAcceptance(r.lease, 'a1');
    const client = await h.reconnect();
    try {
      const restarted = new MongoMetadata(new RecordStore(client.db(h.name), 15_000), DEFAULT_BUDGETS);
      expect((await restarted.getAcceptance('u1', 's1', 'a1'))?.payloadHash).toBe(hashPayload(message().content));
      expect((await restarted.getAttempt('u1', 's1', 'a1'))?.causal.userMessageId).toBe('m0');
    } finally { await client.close(); }
    await owner.release(r.lease);
    const recovered = await owner.recoverStoppedSession('u1', 's1', null, 60_000);
    expect(await owner.fence(recovered)).toBe(true);
    const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
    const accepted = (await metadata.getAttempt('u1', 's1', 'a1'))!;
    await owner.run(recovered, async () => {
      expect(await metadata.compareAttempt({ ...accepted, status: 'interrupted', errorCode: 'INTERRUPTED' }, 'accepted')).toBe(true);
    });
    await owner.clearAttempt(recovered, 'a1'); await owner.clearAttempt(recovered, 'a1');
    await owner.release(recovered);
    expect((await owner.acquire({ userId: 'u1', sessionId: 's1', ownerId: 'process-a', leaseMs: 60_000 })).ok).toBe(true);
  } finally { await h.close(); }
}, 30_000);
it('renews a live lease but never revives an expired one', async () => {
  const h = await nativeDatabase();
  try {
    const store = new RecordStore(h.db, 15_000); let time = Date.now();
    await new MongoSessions(store, DEFAULT_BUDGETS).createIfAbsent(session());
    const owner = new MongoOwnership(store, 'process-a', () => time); await owner.claimExecutor();
    const r = await owner.acquire({ userId: 'u1', sessionId: 's1', ownerId: 'process-a', leaseMs: 1000 });
    if (!r.ok) throw new Error('lease expected');
    time += 500;
    const renewed = await owner.renew(r.lease, 1000);
    time += 600; expect(await owner.fence(renewed)).toBe(true);
    time += 401;
    await expect(owner.renew(renewed, 1000)).rejects.toMatchObject({ code: 'INTERRUPTED' });
  } finally { await h.close(); }
}, 30_000);
```

Add both fault tests to `faults.native.e2e-spec.ts`:

```typescript
it('allows retry after a confirmed pre-write failure without duplicate records', async () => {
  const h = await nativeDatabase();
  try {
    const store = new RecordStore(h.db, 15_000);
    const collection = h.db.collection('messages');
    const spy = vi.spyOn(collection, 'updateOne').mockRejectedValueOnce(new Error('before write'));
    const dbSpy = vi.spyOn(h.db, 'collection').mockReturnValue(collection);
    const id = key('message', 'u1', 's1', 'm0');
    try {
      await expect(store.insert('messages', messageRecordSchema, message(), id, 65_536)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
    } finally { dbSpy.mockRestore(); spy.mockRestore(); }
    await store.insert('messages', messageRecordSchema, message(), id, 65_536);
    expect(await h.db.collection('messages').countDocuments({ userId: 'u1', sessionId: 's1' })).toBe(1);
  } finally { await h.close(); }
}, 30_000);
it('chooses one winner when two conditional replacements race', async () => {
  const h = await nativeDatabase();
  try {
    const store = new RecordStore(h.db, 15_000); const id = key('message', 'u1', 's1', 'm0');
    await store.insert('messages', messageRecordSchema, message(), id, 65_536);
    const a = { ...message(), completionStatus: 'interrupted' as const };
    const b = { ...message(), completionStatus: 'cancelled' as const };
    const results = await Promise.all([
      store.replace('messages', messageRecordSchema, a, id, 0, 65_536),
      store.replace('messages', messageRecordSchema, b, id, 0, 65_536),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const saved = await store.read('messages', messageRecordSchema, { _id: id, userId: 'u1', sessionId: 's1' });
    expect(saved?.completionStatus).toBe(results[0] ? 'interrupted' : 'cancelled');
  } finally { await h.close(); }
}, 30_000);
```

These test the primitives; they do not certify P5's saved-result recovery or application completion ordering.

- [ ] **Step 5: Run green.** All four native commands, `npm test`, build/lint. These are persistence primitive tests, not P5 crash-finalization/inference evidence.
- [ ] **Step 6: Commit.**

```powershell
git add backend/src/persistence/persistence.ts backend/src/persistence/index.ts backend/test/persistence/faults.native.e2e-spec.ts backend/test/persistence/archive.native.e2e-spec.ts backend/test/persistence/ownership.native.e2e-spec.ts
git commit -m "feat(p2): export persistence bundle and test ambiguous write recovery"
```

### Task 10: Fail-closed selected-service compatibility and evidence gate

**Files:** Create `backend/test/compatibility/service-facts.ts`, `backend/test/compatibility/persistence.azure.spec.ts`, `backend/test/compatibility/evidence.md`; extend `backend/test/compatibility/intersection.spec.ts`.

Do not execute against Azure until the operator provides `research.md` §13.3 facts, isolated target, and authorization. No account discovery/provisioning or collection partition changes are authorized by this plan. Ordinary native evidence can be written now; **actual Azure tests and P2 full completion remain blocked**.

- [ ] **Step 1: Add failing deterministic fact-validation test** to the intersection spec:

```typescript
import { parseServiceFacts } from './service-facts.js';
it('rejects missing facts and incompatible partition keys', () => {
  expect(() => parseServiceFacts(undefined)).toThrow();
  expect(() => parseServiceFacts(JSON.stringify({ profile: 'cosmos-mongodb-ru', apiVersion: '7.0', tier: 'serverless',
    consistency: 'Session', backupMode: 'continuous', documentLimitBytes: 2_000_000, capabilities: [],
    partitions: { sessions: 'userId', messages: 'userId', 'agent-memory': 'userId', metadata: 'userId', checkpoints: 'sessionId', checkpoint_writes: 'thread_id' } }))).toThrow();
});
```

- [ ] **Step 2: Run red.** `npx vitest run test/compatibility/intersection.spec.ts`; missing facts module.
- [ ] **Step 3: Implement strict non-secret facts validator and actual-service harness.**

```typescript
// backend/test/compatibility/service-facts.ts
import { z } from 'zod';
const partition = z.enum(['unsharded', 'userId', 'sessionId', 'thread_id']);
const factsSchema = z.object({ profile: z.enum(['cosmos-mongodb-ru', 'azure-documentdb', 'native-mongodb']),
  apiVersion: z.string().min(1).max(64), tier: z.string().min(1).max(128), consistency: z.string().min(1).max(128),
  backupMode: z.string().min(1).max(128), documentLimitBytes: z.number().int().min(2_000_000),
  capabilities: z.array(z.string().max(128)).max(32),
  partitions: z.object({ sessions: partition, messages: partition, 'agent-memory': partition, metadata: partition,
    checkpoints: partition, checkpoint_writes: partition }).strict() }).strict();
export function parseServiceFacts(input: string | undefined) {
  if (!input) throw new Error('Selected-service facts are required; Azure is not certified.');
  const facts = factsSchema.parse(JSON.parse(input));
  if (!['unsharded', 'userId'].includes(facts.partitions.sessions) ||
    ['messages', 'agent-memory', 'metadata'].some((c) => !['unsharded', 'userId', 'sessionId'].includes(facts.partitions[c as 'messages'])) ||
    ['checkpoints', 'checkpoint_writes'].some((c) => !['unsharded', 'thread_id'].includes(facts.partitions[c as 'checkpoints']))) throw new Error('Unsupported selected-service partition profile.');
  return facts;
}
```

```typescript
// backend/test/compatibility/persistence.azure.spec.ts
import { MongoClient, BSON } from 'mongodb';
import { emptyCheckpoint } from '@langchain/langgraph-checkpoint';
import { DEFAULT_BUDGETS } from '../../src/contracts/index.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { graphThreadId, key } from '../../src/persistence/records.js';
import { session, message, attempt, manifest, accounting } from '../persistence/fixtures.js';
import { hashPayload } from '../../src/platform/crypto/hash-payload.js';
import { parseServiceFacts } from './service-facts.js';
describe('selected Azure service compatibility — real isolated target only', () => {
  it('requires facts and exercises six collections and stock saver on the actual API', async () => {
    const facts = parseServiceFacts(process.env.AURVIN_AZURE_TEST_FACTS_JSON);
    const uri = process.env.AURVIN_AZURE_TEST_URI;
    const dbName = process.env.AURVIN_AZURE_TEST_DB_NAME;
    if (!uri || !dbName?.startsWith('aurvin_p2_azure_test_') || process.env.AURVIN_AZURE_TEST_AUTHORIZED !== 'yes') throw new Error('Authorized isolated Azure test target is required; compatibility is blocked.');
    // Operator precreates the six collections with verified partitions/capabilities.
    // Do not silently create differently partitioned production collections.
    const client = new MongoClient(uri, { retryWrites: false, maxIdleTimeMS: 120_000,
      connectTimeoutMS: 10_000, serverSelectionTimeoutMS: 10_000, timeoutMS: 15_000 });
    await client.connect();
    const db = client.db(dbName);
    const userId = 'u1'; const sessionId = 's1';
    try {
      const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
      for (const c of ['sessions', 'messages', 'agent-memory', 'metadata', 'checkpoints', 'checkpoint_writes']) expect(names).toContain(c);
      // An operator must provide a fresh dedicated database; abort on any records.
      for (const c of names) expect(await db.collection(c).findOne({})).toBeNull();
      const bundle = await createPersistenceBundle(client, dbName, DEFAULT_BUDGETS, 'azure-test-executor');
      await bundle.sessions.createIfAbsent(session());
      const owned = await bundle.owner.acquire({ userId, sessionId, ownerId: 'azure-test-executor', leaseMs: 60_000 });
      if (!owned.ok) throw new Error('Expected exclusive selected-service ownership.');
      await bundle.owner.reserveAttempt(owned.lease, 'a1');
      await bundle.owner.allocateSequences(owned.lease, 'service-reservation', 3);
      await bundle.owner.run(owned.lease, async () => {
        await bundle.messages.append(message());
        await bundle.messages.append(message());
        await bundle.metadata.putAttempt({ ...attempt(), payloadHash: hashPayload(message().content) });
      });
      await bundle.owner.confirmAcceptance(owned.lease, 'a1');
      await bundle.owner.run(owned.lease, async () => {
        await bundle.memory.put(manifest()); await bundle.metadata.putAccounting(accounting());
      });
      const handle = await bundle.checkpoints.create(); await handle.setup();
      const saver = handle.bind(owned.lease);
      const cp = emptyCheckpoint(); cp.channel_values = { result: { text: 'saved result', attemptId: 'a1' } };
      const saved = await saver.put({ configurable: { thread_id: graphThreadId(userId, sessionId), checkpoint_ns: '' } }, cp, { source: 'update', step: 1, parents: {} });
      await saver.putWrites(saved, [['result', 'pending']], 'service-task');
      await saver.putWrites(saved, [['result', 'pending']], 'service-task');
      expect((await saver.getTuple(saved))?.pendingWrites).toHaveLength(1);
      expect((await bundle.messages.list(userId, sessionId, { cursor: null, limit: 2 })).items).toHaveLength(1);
      expect(await db.collection('messages').countDocuments({ userId, sessionId })).toBe(1);
      for (const c of ['sessions', 'messages', 'agent-memory', 'metadata', 'checkpoints', 'checkpoint_writes']) {
        const docs = await db.collection(c).find({}).limit(100).toArray();
        expect(docs.length).toBeGreaterThan(0);
        for (const doc of docs) expect(BSON.calculateObjectSize(doc) + 256).toBeLessThanOrEqual(1_800_000);
        for (const index of await db.collection(c).indexes()) if (index.name !== '_id_') {
          expect(index.unique).not.toBe(true); expect(index.expireAfterSeconds).toBeUndefined();
        }
      }
      expect(facts.documentLimitBytes).toBeGreaterThan(1_800_000);
      expect(key('message', userId, sessionId, 'm0')).toHaveLength(64);
      // Leave isolated records for evidence/restart inspection; no database deletion
      // or partition/capability modifications in this compatibility suite.
    } finally { await client.close(); }
  }, 120_000);
});
```

The suite intentionally leaves a sentinel/test records: P8's explicit stopped-owner handoff plus a new client must exercise recovery rather than an unsafe automatic takeover. Operator cleanup is isolated and separately authorized. A second run needs a fresh dedicated database or documented cleanup. Do not run this destructive-in-effect acceptance workload against an existing application DB.

- [ ] **Step 4: Run green deterministic checks.** `npx vitest run test/compatibility/intersection.spec.ts`; expected pass without external credentials.
- [ ] **Step 5: Verify fail-closed Azure command now.** `npm run test:azure` with no real-service env. Expected **FAIL**, sanitized missing-facts/config message. Report this as **blocked**, not an implementation test regression and never an Azure pass.
- [ ] **Step 6: When authorized service input arrives, run actual-service checks.** `npm run test:azure`. Before calling AC16 passed, extend the real-service suite using the same native assertion bodies from Tasks 4–9 for: two scoped identities, tied pagination, concurrent conditional acquisition, changed idempotency payload, interrupted CAS, immutable/CAS lost acknowledgment, fresh-client restart, and stopped-owner recovery. Re-run original tests, not mocked equivalents. Measure largest BSON record and index/query behavior; record operator-verified actual partition keys/flags/default consistency. For Cosmos RU, record that native client write concern is ignored; do not infer acknowledged-write durability from `{w:'majority'}`. Confirm binary BSON/upsert/bulkWrite against actual service. No TTL/transaction/16-MB feature is exercised or certified.
- [ ] **Step 7: Write `evidence.md` with actual results only**, using this clean structure:

```markdown
# P2 Persistence Evidence

## Commit set and environment
- Worker commit range, Node/driver/saver versions, OS, isolated native topology.

## Executed checks
| Command | Target | Outcome | Assertions / measurements |
| --- | --- | --- | --- |

## Bounded storage
- Measured maximum BSON bytes per collection; configured limits and 256-byte reserve.
- Checkpoint state and total pending-write count limits; no TTL or transcript arrays.

## Supported executor and recovery policy
- One admitted executor, per-session CAS, no automatic expiry takeover.
- Operator stopped-process proof requirement; no horizontal stale-worker fencing claim.
- Ambiguous write/repeated primitive recovery evidence; P5 graph finalization remains downstream.

## Actual-service compatibility gate
- Service/API/tier/partition/flags/consistency/backup facts or precise missing input.
- Azure test outcome: blocked until real selected-service tests and facts exist.
- Native/intersection results do not certify Azure; AC16 and full P2 exit remain open.

## Handoff and limitations
- P5 primitives; P8 ping/drain/admission/retention hooks; skipped unified review.
- No provider billing guarantee, deployment authorization, compaction or live tools.
```

Do not write unexecuted successes or invent measurements. Request parent state updates with your result; this worker cannot edit `state.md`. After service evidence passes, request a serialized P1/R1 follow-up for verified Azure activation configuration before extending `openPersistence` beyond native-only. Do not silently unlock production using test-only facts.

- [ ] **Step 8: Commit.**

```powershell
git add backend/test/compatibility/service-facts.ts backend/test/compatibility/persistence.azure.spec.ts backend/test/compatibility/intersection.spec.ts backend/test/compatibility/evidence.md
git commit -m "test(p2): add fail-closed selected-service compatibility gate"
```

---

## Final worker verification and handoff

- [ ] `npm test`: deterministic P1/P2 plus other owned feature suites; do not edit other owners' failures.
- [ ] Run all four native `.e2e-spec.ts` suites with real isolated native URI; verify archive/read-side new instances and saver fresh-client restart.
- [ ] `npm run build`, `npm run lint` in `backend`; fix only P2-owned defects. Record actual results.
- [ ] `npm run test:azure`: blocked without facts/target. Full P2 exit cannot be passed until actual selected-service assertions and activation gate close.
- [ ] `git diff --check`; inspect explicitly staged paths/commit stats; no secret/credential/DB URI in output, artifacts, or logs.
- [ ] Record evidence and report worker path/hash/range, interface summary, measured bounds, supported topology, and blockers to parent. Never mark runtime/AC12/AC16 complete from primitives or native tests alone.

## Interface summary for P5 and P8

**Unchanged P1 ports:** `MongoSessions implements SessionRepository`, `MongoMessages implements MessageRepository`, `MongoMemory implements AgentMemoryRepository`, `MongoMetadata implements MetadataRepository`, `MongoOwnership implements ExecutionOwnership`, `MongoCheckpointFactory implements CheckpointStoreFactory`. Factory returns a **facade** with `setup():Promise<void>` and concrete `bind(lease):ScopedMongoSaver`.

**P5 concrete primitives:** `graphThreadId(userId,sessionId)`; `owner.claimExecutor/assertExecutor/acquire/fence/renew/run/release`; `reserveAttempt`, `allocateSequences`, `confirmAcceptance`, `clearAttempt`, `recoverStoppedSession`; `metadata.compareAttempt(record,expectedStatus)`, `getAcceptance/getAccounting/listAttempts`; `sessions.listForRecovery`; `messages.getReferences`; `memory.put` monotonic version CAS; `checkpoints.create().bind(lease)` with root namespace and bounded standard saver reads/writes. Keep application writes inside separate guarded `run` calls; never wrap graph/inference or nest guarded calls. Saved-result identification and durable finalization sequencing are P5's responsibility.

**P8 hooks:** bundle `ping`, owner `drain/releaseExecutor`, explicit operator `handoffStoppedExecutor`/`recoverStoppedSession` after proven process stop. `openPersistence` is native-only until R1/P1 activation follow-up; no paid health calls. No TTL or independent record expiry. Backups/restore must preserve six collections, executor ownership evidence, P1 schema versions and graph identities together; retention/migration/rollout remains P8-owned.

## Coverage and plan self-check

| Requirement | Tasks / downstream evidence |
| --- | --- |
| AC04 restart/isolation | 2, 4, 5, 8, 9; P3/P5 prove context continuity |
| AC05 six bounded collections | 1, 3–5, 8, 10; BSON guard + actual-service record/index evidence |
| AC06/AC07 references/causality | 1, 4, 5, 7; strict P1 tool-shaped schemas remain deferred storage boundary, no live tool writes |
| AC08 duplicate/retry | 2, 5, 7, 9; P5 preserves logical user input on explicit retry/new-chat deterministic ID |
| AC09 ownership/topology | 6–9; sentinel and no expiry takeover; P8 deployment one-process enforcement |
| AC10 acceptance/finalization | 7, 8; P5 ensures no inference before confirmation and no completion before saved graph/application data |
| AC12 reconciliation | 2, 5, 7–9 primitives; P5 crash graph-result recovery, P10 integrated evidence |
| AC14 accounting | 5, 9; P4/P5 supply provider evidence and reconcile missing cost |
| AC16 compatibility | 3, 8, 10; **blocked** until actual-service facts/tests, native alone insufficient |

Before handoff: compare each concrete method signature/import to P1 files; confirm each referenced file is created in the file map; scan for unfinished implementation markers; verify all staged paths are owned. This is planner consistency checking, not reinstatement of the skipped unified review.

### Planner verification (documentation only)

The complete planned source and assembled test snippets were type-checked in an in-memory TypeScript compiler host against installed P1 files/dependencies: 23 virtual files, no filesystem implementation writes. This checks type/import consistency only; it does not execute native/Azure tests, prove database behavior, or satisfy worker acceptance. Commands and service checks above remain future worker actions. Primary documentation was consulted through Context7 for MongoDB driver-6 `findOneAndUpdate` return semantics and LangGraph saver/thread/durability usage; installed saver declarations/source confirmed the error-array `setup()` signature, standard non-unique indexes, and stock upsert behavior.
