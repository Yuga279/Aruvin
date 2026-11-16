# Internal Voice Persistence and Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist internal live-voice turns and bounded delivery evidence, keep them out of text archives/navigation, and assemble shared context from confirmed heard content without losing recovery guarantees.

**Architecture:** Extend the existing messages and metadata adapters, not the six-collection layout. Keep generated assistant records immutable and manifests reference-only; apply delivery correction only when materializing model context. The existing reference-based graph remains the only execution/checkpoint boundary.

**Tech Stack:** TypeScript/ESM with `.js` local imports, MongoDB Node driver 6.21, existing Zod schemas, Vitest 4, existing LangGraph MongoDB saver.

---

## Read first: scope, prerequisites, and ownership

- Specification: [goal.md](goal.md), particularly authoritative decisions 1, 5 and 6, A8/A9/A11/A13, and heard-content/reconnect requirements. Research: [research.md](research.md), sections 5 and 6. Workflow: [state.md](state.md), P2 ownership and exit gate. Goal approval in the state supersedes the goal's older pending-approval label.
- P1 implementation prerequisite: `952b605..a2860f7`. Use the actual `backend/src/contracts/voice.ts`, **not** the shorter research sample. The implemented delivery schema additionally requires `voiceSessionId`, `responseId`, `eventId`, `sequence`, `providerSocketId`, and `playedSamples`; it supports `pending` and `unknown`.
- This is a P2 plan, not an instruction to implement P5/P6/P9/P10. Authentication, tools, providers, transport, UI, deployment, and paid tests are excluded. Review remains **skipped**.
- Before implementation, recheck `git status --short`. User work currently overlaps `backend/src/persistence/sessions.ts`, `backend/src/persistence/pagination.ts`, `backend/test/persistence/archive.native.e2e-spec.ts`, and shared contracts. Obtain orchestrator ownership clearance for the small sessions addition. Do not stage those files wholesale if they still contain unrelated work; request a reconciled baseline before that commit. Create new voice tests rather than altering the user's archive/session-action suites.
- Do not change shared schemas/manifests/test configs. `MetadataRepository` currently lacks delivery methods. The concrete adapter extension below does not require changing that interface, and the context dependency is a narrow structural read port. P1 must publish matching shared declarations before downstream consumers need the generic metadata interface. Report this handoff rather than independently editing `backend/src/contracts/repositories.ts`.
- New code/test files need repository-mandated valid TypeScript headers; existing files modified by more than 30% need an updated header. This Markdown plan deliberately contains no code-file doc headers. Add the required headers in implementation files before their first write.
- All npm commands below run with working directory `backend`; all Git commands run at repository root. Existing dependencies suffice. Do not load application `.env` or print MongoDB URIs.

## Files and responsibilities

| Action | Exact path | Responsibility |
| --- | --- | --- |
| Modify | `backend/src/persistence/messages.ts` | Filter before public pagination; separate bounded original-record paging for recovery |
| Modify, after ownership clearance | `backend/src/persistence/sessions.ts` | Neutral first-live-turn session creation without altering pin/update/delete behavior |
| Modify | `backend/src/persistence/metadata.ts` | Bounded delivery create/read/CAS update, immutable linkage and replay checks |
| Modify | `backend/src/context/reference-selection.ts` | Retain terminal internal assistant references; retain text eligibility rules |
| Modify | `backend/src/context/referenced-context-assembler.ts` | Scoped delivery reads and generated-to-heard projection after validating original records |
| Modify | `backend/src/context/create-context-assembler.ts` | Forward the optional delivery reader through the existing startup factory |
| Create | `backend/test/persistence/voice-messages.spec.ts` | Offline public query/privacy and raw-context query checks |
| Create | `backend/test/persistence/voice-messages.native.e2e-spec.ts` | Actual mixed-history paging, legacy records, neutral navigation and soft deletion |
| Create | `backend/test/persistence/voice-metadata.spec.ts` | Actual RecordStore over a tiny fake driver; replay/CAS/linkage/bounds/fault checks |
| Create | `backend/test/persistence/voice-metadata.native.e2e-spec.ts` | Actual native persistence round-trip/restart/CAS/ambiguous ACK evidence |
| Create | `backend/test/context/voice-context.spec.ts` | Original-reference selection, delivered text, unknown delivery, scope and current-input checks |
| Create | `backend/test/context/voice-startup.spec.ts` | Factory forwarding regression |
| Create | `backend/test/persistence/voice-checkpoints.native.e2e-spec.ts` | Restored generated result stays unchanged while assembled history uses delivery correction |
| Modify | `backend/test/persistence/mutation-journal.spec.ts` | Delivery insert/replace go through the existing owner-bound mutation facade |

Read, but do not change: `backend/src/persistence/{store,records,memory,ownership,mutation-journal,checkpoints,persistence,indexes}.ts`, `backend/src/agent/{state,turn-graph}.ts`, and `backend/src/chat-runtime/{history,durable-chat-runtime,finalization,reconciliation}.ts`. No instructions asset changes are needed: delivery uncertainty is a bounded context projection, not a new system prompt/version migration.

## Decisions and downstream interface handoff

1. Missing `visibility`/`mode` means legacy text. Public paging excludes `visibility: 'internal'` at the MongoDB filter, before sort/limit/cursor calculation. Context `get` and `getReferences` remain able to read internal originals.
2. Add `MongoMessages.listForContext(userId, sessionId, PageQuery)` returning original `MessageRecord[]`, `olderAvailable`, and `nextCursor`. This is backend-only, includes all visibilities, and keeps existing page bounds/order. **P6 must switch `archiveRecords` in `backend/src/chat-runtime/history.ts` to this method.** Filtering `list` without this change would silently drop internal turns during reconciliation/rebase.
3. Add `MongoSessions.createForInternalTurn(SessionRecord)`. P6 calls it only upon the first accepted live input; P5 must not persist an empty conversation merely to open voice. Existing text sessions retain their title. Automatic live-input title generation must never call `titleFor(transcript)`; P6 owns that route. Session summaries currently have **no message-preview field**. Keep their existing explicit allowlist; no message lookup or copied transcript field is introduced.
4. One bounded delivery snapshot per `(userId, sessionId, attemptId)` in `metadata`, with one stable response/socket binding. P6 allocates a new attempt/response for a new inference attempt; it does not reuse a delivery key across sockets or retries. `speechId` may become known once, never change. Each advancing snapshot has a new server `eventId`; exact repeated events replay the same snapshot. `sequence` is a monotonically increasing server delivery revision/event sequence, not a provider socket playback offset; P6 translates its events accordingly. `audioPlayedMs` is per-response played duration, not the provider's session-wide interrupt offset.
5. Concrete metadata API: `putVoiceDelivery(record): Promise<void>`, `getVoiceDelivery(userId, sessionId, attemptId): Promise<VoiceDeliveryRecord | null>`, and `compareVoiceDelivery(record, expectedSequence): Promise<boolean>`. Existing `scope_kind_attempt` index and hashed `_id` suffice; no new collection/index/uniqueness assumption is needed.
6. Create requires `pending`. Update allows pending progress and terminal delivery; `unknown` may be refined to a non-pending terminal outcome by a later authoritative recovery event. Completed/interrupted/cancelled/failed evidence is immutable except exact replay. TTS synthesis completion alone is **not** played completion; P6 owns which authoritative evidence is submitted.
7. CRUD deletion follows existing **session soft deletion**, preserving delivery/accounting/checkpoint evidence until the operator's full-conversation retention procedure. Do **not** add an arbitrary individual-delivery hard-delete API: deleting it while a manifest/checkpoint still refers to that attempt destroys heard-content evidence. P9 owns operational physical retention of all six collections and must include `kind: 'voice-delivery'` in scoped metadata cleanup; its procedure must not be represented as implemented by P2. `deleteMany` is intentionally unsupported by the existing guarded driver, so bypassing it here is not acceptable.
8. Keep original generated message content and saved graph results unchanged. For terminal internal assistants, context uses `textSpoken`, including a known partial prefix on failed/cancelled/truncated generation. Known empty speech omits the assistant context entry. Unknown/null delivered text uses a server-controlled uncertainty sentence, never generated text. Missing reader/record or pending delivery fails `NOT_READY`; recovery must persist explicit `unknown` before allowing the next turn.
9. The graph has replace-value `input`, `boundary`, `result`, `sealed`, `rebase` channels, **not a messages reducer**. Never concatenate restored generated output with manifest history or rewrite stock saver serialization. P6 restores/finalizes saved results without reinference; subsequent generation always assembles corrected context afresh.
10. All runtime writes, including delivery callbacks after generation, must be inside the existing `p.owner.run(lease, ...)` and tracked by `Work.wait`. P6 retains/acquires the proper session lease until delivery is reconciled; callbacks must not write with released/stale leases. The bundle already passes the guarded client to RecordStore. P2 creates no raw client, executor, close owner, timer-based takeover, or unjournaled mutation path.

### Task 1: Message Record Visibility & Filtering

**Files:**
- Modify: `backend/src/persistence/messages.ts:63–124`.
- Modify after clearance: `backend/src/persistence/sessions.ts`, add a method immediately before `createIfAbsent`; do not rewrite existing user logic.
- Create tests: `backend/test/persistence/voice-messages.spec.ts`, `backend/test/persistence/voice-messages.native.e2e-spec.ts`.

#### 1A. Public and context query separation

- [ ] **Step 1 (2–5 minutes): Write the offline failing tests.** Create `backend/test/persistence/voice-messages.spec.ts` with these imports/body, plus the required code-file header:

```typescript
import type { Db } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { RecordStore } from '../../src/persistence/store.js';
import { key } from '../../src/persistence/records.js';
import { message } from './fixtures.js';

function fixture() {
  const store = new RecordStore({} as Db, 1000);
  const originals = [message(2), message(0)];
  const toArray = vi.fn(async () => originals.map(record => ({
    ...record, _id: key('message', 'u1', 's1', record.messageId), _revision: 0,
  })));
  const cursor = { sort: vi.fn(), limit: vi.fn(), toArray };
  cursor.sort.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  const find = vi.fn((_filter: unknown, _options: unknown) => cursor);
  vi.spyOn(store, 'collection').mockReturnValue({ find } as unknown as ReturnType<RecordStore['collection']>);
  return { repository: new MongoMessages(store, DEFAULT_BUDGETS), find, cursor };
}

it('filters internal records before public pagination and strips private fields', async () => {
  const f = fixture();
  const result = await f.repository.list('u1', 's1', { limit: 1, cursor: null });
  expect(f.find.mock.calls[0]).toEqual([
    { userId: 'u1', sessionId: 's1', visibility: { $ne: 'internal' } },
    { maxTimeMS: 1000 },
  ]);
  expect(f.cursor.sort).toHaveBeenCalledWith({ sequence: -1, messageId: -1 });
  expect(f.cursor.limit).toHaveBeenCalledWith(2);
  expect(result.items[0]).not.toHaveProperty('visibility');
  expect(result.items[0]).not.toHaveProperty('attemptId');
  await f.repository.list('u1', 's1', { limit: 1, cursor: result.nextCursor });
  expect(f.find.mock.calls[1]?.[0]).toMatchObject({ visibility: { $ne: 'internal' },
    $or: [{ sequence: { $lt: 2 } }, { sequence: 2, messageId: { $lt: 'm2' } }] });
});

it('provides original bounded records for context without a visibility filter', async () => {
  const f = fixture();
  const result = await f.repository.listForContext('u1', 's1', { limit: 2, cursor: null });
  expect(f.find.mock.calls[0]?.[0]).toEqual({ userId: 'u1', sessionId: 's1' });
  expect(result.items.map(item => item.sequence)).toEqual([0, 2]);
  expect(result.items[1]).toHaveProperty('attemptId', 'a1');
  expect(result.olderAvailable).toBe(false);
  expect(result.nextCursor).toBeNull();
});
```

- [ ] **Step 2: Run RED.** `npm test -- test/persistence/voice-messages.spec.ts`. Expect the missing visibility-filter assertion and absent `listForContext` to fail, not a discovery/import error. The fake cursor checks adapter query construction only; the native test below proves actual filtering semantics.
- [ ] **Step 3: Minimal implementation.** In `backend/src/persistence/messages.ts`, replace `list` with the following three methods. Existing append/get/completion/reference methods are unchanged.

```typescript
async list(userId: string, sessionId: string, query: PageQuery) {
  const result = await this.readPage(userId, sessionId, query, true);
  return { ...result, items: result.items.map(({
    messageId, turnId, eventId, sequence, role, content, createdAt, completionStatus, truncated,
  }) => visibleMessageSchema.parse({
    messageId, turnId, eventId, sequence, role, content, createdAt, completionStatus, truncated,
  })) };
}

listForContext(userId: string, sessionId: string, query: PageQuery) {
  return this.readPage(userId, sessionId, query, false);
}

private async readPage(userId: string, sessionId: string, query: PageQuery, visibleOnly: boolean) {
  const { limit, after } = page(query, 'messages', userId, sessionId, this.budgets.maxPageSize);
  const filter: Filter<StoredDocument> = { userId, sessionId,
    ...(visibleOnly ? { visibility: { $ne: 'internal' } } : {}) };
  if (after) filter.$or = [
    { sequence: { $lt: after.value } },
    { sequence: after.value, messageId: { $lt: after.id } },
  ];
  const docs = await this.store.collection('messages').find(filter, this.store.options())
    .sort({ sequence: -1, messageId: -1 }).limit(limit + 1).toArray();
  const records = docs.slice(0, limit).map(doc => decode(messageRecordSchema, doc)!);
  const last = records.at(-1);
  return { items: records.reverse(), olderAvailable: docs.length > limit,
    nextCursor: docs.length > limit && last ? cursor({ kind: 'messages', userId, sessionId,
      value: last.sequence, id: last.messageId }) : null };
}
```

- [ ] **Step 4: Run GREEN.** `npm test -- test/persistence/voice-messages.spec.ts`; expect 2 passing tests. Run `npm test -- test/persistence/pagination.spec.ts test/persistence/records.spec.ts` to preserve scoped cursor and bounded-record behavior.

#### 1B. Neutral navigation, real pagination, and deletion

- [ ] **Step 5: Write the native test.** Create `backend/test/persistence/voice-messages.native.e2e-spec.ts`:

```typescript
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoMemory } from '../../src/persistence/memory.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { RecordStore } from '../../src/persistence/store.js';
import { message, session, manifest } from './fixtures.js';
import { nativeDatabase } from './native.js';

it('pages legacy and visible text around internal turns without leaking navigation text', async () => {
  const h = await nativeDatabase();
  try {
    const store = new RecordStore(h.db, 15_000);
    const messages = new MongoMessages(store, DEFAULT_BUDGETS);
    const sessions = new MongoSessions(store, DEFAULT_BUDGETS);
    const memory = new MongoMemory(store, DEFAULT_BUDGETS);
    await sessions.createForInternalTurn({ ...session(), title: 'SECRET voice transcript', latestTurnId: 't1' });
    for (const n of [6, 1, 5, 0, 4, 3, 2]) await messages.append({ ...message(n),
      ...(n % 2 ? { visibility: 'internal' as const, mode: 'live' as const,
        content: 'SECRET voice transcript' } : n === 0 ? {} : { visibility: 'visible' as const }) });
    const pages = [];
    let cursor: string | null = null;
    for (let n = 0; n < 4; n++) {
      const found = await messages.list('u1', 's1', { cursor, limit: 2 });
      pages.push(found); cursor = found.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(pages.map(p => p.items.map(m => m.sequence))).toEqual([[4, 6], [0, 2]]);
    expect(pages.at(-1)?.olderAvailable).toBe(false);
    expect(JSON.stringify(pages)).not.toContain('SECRET');
    expect((await messages.list('u2', 's1', { cursor: null, limit: 2 })).items).toEqual([]);
    const raw = await messages.listForContext('u1', 's1', { cursor: null, limit: 50 });
    expect(raw.items.map(m => m.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect((await messages.get('u1', 's1', 'm3'))?.visibility).toBe('internal');
    const nav = await sessions.list('u1', { cursor: null, limit: 10 });
    expect(nav.items[0]?.title).toBe('Voice Conversation');
    expect(JSON.stringify(nav)).not.toContain('SECRET');
    expect(nav.items[0]).not.toHaveProperty('preview');
    await memory.put(manifest());
    await sessions.delete('u1', 's1');
    expect((await sessions.list('u1', { cursor: null, limit: 10 })).items).toEqual([]);
    expect((await messages.get('u1', 's1', 'm3'))?.content).toBe('SECRET voice transcript');
    expect(await memory.get('u1', 's1')).toEqual(manifest());
    await sessions.createIfAbsent({ ...session('u1', 'text'), title: 'Visible text', latestTurnId: 't1' });
    await sessions.createForInternalTurn({ ...session('u1', 'text'), title: 'SECRET' });
    expect((await sessions.get('u1', 'text'))?.title).toBe('Visible text');
    await sessions.createIfAbsent(session('u1', 'empty'));
    expect((await sessions.list('u1', { cursor: null, limit: 10 })).items.map(s => s.sessionId)).toEqual(['text']);
  } finally { await h.close(); }
}, 30_000);
```

- [ ] **Step 6: Run RED with isolated operator configuration only.** `npm run test:e2e -- test/persistence/voice-messages.native.e2e-spec.ts`. Expect `createForInternalTurn is not a function`. Missing database configuration is a **blocked check**, not the intended red result. Do not provision MongoDB or copy application credentials to make this run.
- [ ] **Step 7: Add the smallest title-safe creation method** inside `MongoSessions` in `backend/src/persistence/sessions.ts`:

```typescript
createForInternalTurn(record: SessionRecord): Promise<SessionRecord> {
  return this.createIfAbsent({ ...record,
    title: 'Voice Conversation'.slice(0, this.budgets.titleMaxChars) });
}
```

Also append this offline test to `voice-messages.spec.ts`, importing `MongoSessions` and `session` from their existing paths. It allows a real red/green title test even if native verification is blocked:

```typescript
it('replaces a first-live-turn title without changing existing session semantics', async () => {
  const repository = new MongoSessions(new RecordStore({} as Db, 1000), DEFAULT_BUDGETS);
  const create = vi.spyOn(repository, 'createIfAbsent').mockResolvedValue(session());
  await repository.createForInternalTurn({ ...session(), title: 'SECRET' });
  expect(create).toHaveBeenCalledWith({ ...session(), title: 'Voice Conversation' });
});
```

Write/run this test **before** adding the method when no native prerequisites exist.

- [ ] **Step 8: Verify.** `npm test -- test/persistence/voice-messages.spec.ts` (3 pass). Run the native command above when admitted; expect 1 pass and actual mixed-history pages. Then `npm run build`.
- [ ] **Step 9: Commit only reconciled owner files.**

```text
git add backend/src/persistence/messages.ts backend/src/persistence/sessions.ts backend/test/persistence/voice-messages.spec.ts backend/test/persistence/voice-messages.native.e2e-spec.ts
git commit -m "feat(voice): isolate internal history from text archives"
```

### Task 2: Voice Delivery Records in Metadata Repository

**Files:** Modify `backend/src/persistence/metadata.ts`; create `backend/test/persistence/voice-metadata.spec.ts` and `backend/test/persistence/voice-metadata.native.e2e-spec.ts`.

#### 2A. Round-trip, idempotency, bounded updates, and linkage

- [ ] **Step 1: Write the fake driver and failing tests** in `backend/test/persistence/voice-metadata.spec.ts`. This uses real `RecordStore.insert/replace/bounded/decode`; only MongoDB I/O is substituted. No fake service or provider runs.

```typescript
import type { Db } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { messageRecordSchema } from '../../src/contracts/message.js';
import { voiceDeliveryRecordSchema, type VoiceDeliveryRecord } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { key, type StoredDocument } from '../../src/persistence/records.js';
import { RecordStore } from '../../src/persistence/store.js';
import { attempt, message } from './fixtures.js';

function delivery(overrides: Partial<VoiceDeliveryRecord> = {}): VoiceDeliveryRecord {
  return voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a1', status: 'pending', textGenerated: 'Hello. More.', ...overrides });
}
function driver() {
  const collections = new Map<string, Map<string, StoredDocument>>();
  let loseInsert = false;
  let loseReplace = false;
  const db = { collection(name: string) {
    if (!collections.has(name)) collections.set(name, new Map());
    const docs = collections.get(name)!;
    const matches = (d: StoredDocument, f: Record<string, unknown>) =>
      Object.entries(f).every(([k, v]) => d[k] === v);
    return {
      async findOne(filter: Record<string, unknown>) {
        return [...docs.values()].find(d => matches(d, filter)) ?? null;
      },
      async updateOne(filter: Record<string, unknown>, update: { $setOnInsert: StoredDocument }) {
        if (!docs.has(filter._id as string)) docs.set(filter._id as string, update.$setOnInsert);
        if (loseInsert) { loseInsert = false; throw new Error('ACK lost'); }
        return { acknowledged: true, matchedCount: 1 };
      },
      async replaceOne(filter: Record<string, unknown>, doc: StoredDocument) {
        const old = docs.get(filter._id as string);
        if (!old || !matches(old, filter)) return { acknowledged: true, matchedCount: 0 };
        docs.set(doc._id, doc);
        if (loseReplace) { loseReplace = false; throw new Error('ACK lost'); }
        return { acknowledged: true, matchedCount: 1 };
      },
    };
  } };
  return { db: db as unknown as Db, collections,
    loseInsert: () => { loseInsert = true; }, loseReplace: () => { loseReplace = true; } };
}
async function fixture(budgets = DEFAULT_BUDGETS) {
  const io = driver(); const store = new RecordStore(io.db, 1000);
  const metadata = new MongoMetadata(store, budgets);
  await metadata.putAttempt(attempt());
  await store.insert('messages', messageRecordSchema,
    { ...message(), mode: 'live', visibility: 'internal' }, key('message', 'u1', 's1', 'm0'), budgets.maxMessageBytes);
  return { ...io, store, metadata };
}

it('round trips one bounded scoped delivery and confirms ambiguous inserts', async () => {
  const f = await fixture(); const value = delivery();
  f.loseInsert();
  await f.metadata.putVoiceDelivery(value);
  await f.metadata.putVoiceDelivery(value);
  expect(await f.metadata.getVoiceDelivery('u1', 's1', 'a1')).toEqual(value);
  expect(await f.metadata.getVoiceDelivery('u2', 's1', 'a1')).toBeNull();
  expect(await f.metadata.getVoiceDelivery('u1', 'other', 'a1')).toBeNull();
  expect([...f.collections.get('metadata')!.values()].filter(d => d.kind === 'voice-delivery')).toHaveLength(1);
  await expect(f.metadata.putVoiceDelivery(delivery({ responseId: 'other' })))
    .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
});

it('updates played evidence with sequence CAS and keeps terminal generated text immutable', async () => {
  const f = await fixture(); const first = delivery();
  await f.metadata.putVoiceDelivery(first);
  const progress = delivery({ sequence: 2, eventId: 'delivery-2', speechId: 'speech-1', audioDurationMs: 2000,
    audioPlayedMs: 500, playedSamples: 12000, textSpoken: 'Hello.', textRemaining: ' More.' });
  expect(await f.metadata.compareVoiceDelivery(progress, 1)).toBe(true);
  expect(await f.metadata.compareVoiceDelivery(progress, 1)).toBe(true);
  const interrupted = { ...progress, sequence: 3, eventId: 'delivery-3', status: 'interrupted' as const };
  f.loseReplace();
  expect(await f.metadata.compareVoiceDelivery(interrupted, 2)).toBe(true);
  expect(await f.metadata.compareVoiceDelivery(interrupted, 2)).toBe(true);
  expect(await f.metadata.getVoiceDelivery('u1', 's1', 'a1')).toEqual(interrupted);
  expect(await f.metadata.compareVoiceDelivery({ ...interrupted, sequence: 4 }, 1)).toBe(false);
  await expect(f.metadata.compareVoiceDelivery({ ...progress, sequence: 4 }, 3))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
});

it('rejects invalid linkage, raw audio, byte overflow and regressing evidence', async () => {
  const f = await fixture();
  await expect(f.metadata.putVoiceDelivery(delivery({ turnId: 'wrong' })))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.metadata.putVoiceDelivery({ ...delivery(), audio: [1, 2] } as VoiceDeliveryRecord))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  const small = new MongoMetadata(f.store, { ...DEFAULT_BUDGETS, maxDocumentBytes: 1024 });
  await expect(small.putVoiceDelivery(delivery({ textGenerated: 'x'.repeat(2000) })))
    .rejects.toMatchObject({ code: 'STORAGE_BUDGET_EXCEEDED' });
  const first = delivery({ speechId: 'speech-1', audioDurationMs: 2000, audioPlayedMs: 500,
    playedSamples: 12000, textSpoken: 'Hello.', textRemaining: ' More.' });
  await f.metadata.putVoiceDelivery(first);
  for (const next of [
    { ...first, sequence: 2, audioPlayedMs: 400 },
    { ...first, sequence: 2, playedSamples: 10000 },
    { ...first, sequence: 2, speechId: 'different' },
    { ...first, sequence: 2, providerSocketId: 'different' },
    { ...first, sequence: 2, textGenerated: 'Different', textSpoken: null, textRemaining: null },
    { ...first, sequence: 2, textSpoken: null, textRemaining: null },
  ]) await expect(f.metadata.compareVoiceDelivery({ ...next, eventId: 'delivery-2' }, 1)).rejects.toThrow();
});

it('permits pending generated prefixes and explicit unknown recovery without assuming delivery', async () => {
  const f = await fixture();
  const first = delivery({ textGenerated: 'Hello.' });
  await f.metadata.putVoiceDelivery(first);
  const next = delivery({ sequence: 2, eventId: 'delivery-2' });
  expect(await f.metadata.compareVoiceDelivery(next, 1)).toBe(true);
  const unknown = { ...next, sequence: 3, eventId: 'delivery-3', status: 'unknown' as const };
  expect(await f.metadata.compareVoiceDelivery(unknown, 2)).toBe(true);
  const recovered = { ...unknown, sequence: 4, eventId: 'delivery-4', status: 'interrupted' as const,
    textSpoken: 'Hello.', textRemaining: ' More.' };
  expect(await f.metadata.compareVoiceDelivery(recovered, 3)).toBe(true);
  await expect(f.metadata.compareVoiceDelivery({ ...recovered, sequence: 5, eventId: 'delivery-5',
    textGenerated: 'Hello. More. EXTRA', textRemaining: ' More. EXTRA' }, 4)).rejects.toThrow();
});
```

- [ ] **Step 2: Run RED.** `npm test -- test/persistence/voice-metadata.spec.ts`. Expect missing delivery methods; do not count syntax or absent-test errors as feature failures.
- [ ] **Step 3: Add imports and the following methods inside `MongoMetadata`.** Reuse the existing `isDeepStrictEqual`, `AppError`, `key`, `decode`, and RecordStore. Add `bounded` to the records import, plus:

```typescript
import { messageRecordSchema } from '../contracts/message.js';
import { voiceDeliveryRecordSchema, type VoiceDeliveryRecord } from '../contracts/voice.js';
```

```typescript
getVoiceDelivery(userId: string, sessionId: string, attemptId: string) {
  return this.store.read('metadata', voiceDeliveryRecordSchema, {
    _id: key('voice-delivery', userId, sessionId, attemptId),
    kind: 'voice-delivery', userId, sessionId, attemptId,
  });
}

private async checkedDelivery(value: VoiceDeliveryRecord) {
  const id = key('voice-delivery', value.userId, value.sessionId, value.attemptId);
  const { record } = bounded(voiceDeliveryRecordSchema, value, id, this.budgets.maxDocumentBytes);
  const attempt = await this.getAttempt(record.userId, record.sessionId, record.attemptId);
  const input = attempt && await this.store.read('messages', messageRecordSchema, {
    _id: key('message', record.userId, record.sessionId, attempt.causal.userMessageId),
    userId: record.userId, sessionId: record.sessionId,
  });
  if (!attempt || attempt.turnId !== record.turnId || !input || input.role !== 'user' ||
    input.turnId !== record.turnId || input.visibility !== 'internal' || input.mode !== 'live') {
    throw new AppError('INVALID_REQUEST', 'Voice delivery linkage is invalid.');
  }
  return { record, id };
}

async putVoiceDelivery(value: VoiceDeliveryRecord): Promise<void> {
  const { record, id } = await this.checkedDelivery(value);
  if (record.status !== 'pending') throw new AppError('INVALID_REQUEST', 'Initial voice delivery must be pending.');
  await this.store.insert('metadata', voiceDeliveryRecordSchema, record, id, this.budgets.maxDocumentBytes);
}

async compareVoiceDelivery(value: VoiceDeliveryRecord, expectedSequence: number): Promise<boolean> {
  safeSequence(expectedSequence);
  const { record, id } = await this.checkedDelivery(value);
  const doc = await this.store.raw('metadata', { _id: id, kind: 'voice-delivery',
    userId: record.userId, sessionId: record.sessionId, attemptId: record.attemptId });
  const old = decode(voiceDeliveryRecordSchema, doc);
  if (!old || !doc) return false;
  if (isDeepStrictEqual(old, record)) return true;
  const binding = (v: VoiceDeliveryRecord) => [v.schemaVersion, v.kind, v.userId, v.sessionId,
    v.voiceSessionId, v.turnId, v.attemptId, v.responseId, v.providerSocketId, v.createdAt];
  if (!isDeepStrictEqual(binding(old), binding(record))) {
    throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Voice delivery identity cannot change.');
  }
  if (old.sequence !== expectedSequence || record.sequence <= old.sequence) return false;
  const regress = (before: number | null, after: number | null) =>
    before !== null && (after === null || after < before);
  if (!['pending', 'unknown'].includes(old.status) ||
    record.eventId === old.eventId ||
    (old.status === 'unknown' && record.status === 'pending') ||
    record.updatedAt < old.updatedAt ||
    (old.speechId !== null && old.speechId !== record.speechId) ||
    regress(old.audioDurationMs, record.audioDurationMs) ||
    regress(old.audioPlayedMs, record.audioPlayedMs) ||
    regress(old.playedSamples, record.playedSamples) ||
    (old.textSpoken !== null && (record.textSpoken === null || !record.textSpoken.startsWith(old.textSpoken))) ||
    (old.status === 'pending' ? !record.textGenerated.startsWith(old.textGenerated)
      : record.textGenerated !== old.textGenerated) ||
    (record.status === 'completed' && (record.textSpoken !== record.textGenerated ||
      record.audioDurationMs === null || record.audioPlayedMs !== record.audioDurationMs))) {
    throw new AppError('CONFLICT_ACTIVE_TURN', 'Invalid voice delivery transition.');
  }
  return this.store.replace('metadata', voiceDeliveryRecordSchema, record, id,
    doc._revision, this.budgets.maxDocumentBytes);
}
```

`textGenerated` can extend while pending; otherwise it is fixed. Provider response/socket IDs and record creation time are immutable. Do not compute a spoken prefix from elapsed milliseconds: only the provider reconciliation or confirmed full playback can supply text evidence. `updatedAt` uses canonical ISO UTC strings from the P6 producer; it is audit information, not ordering authority.

- [ ] **Step 4: Run GREEN.** `npm test -- test/persistence/voice-metadata.spec.ts` (4 pass). `npm run build` and `npm run lint` must pass or report unrelated baseline failures without modifying others' files.
- [ ] **Step 5: Add the following focused trust-boundary cases** to the same test file; run each red/green before tightening any discovered gap. The implementation above already handles these cases, so do not invent redundant production guards merely to produce a new red result.

```typescript
it('rejects non-live attempts, inconsistent generated prefixes and unconfirmed completed playback', async () => {
  const f = await fixture();
  const inputId = key('message', 'u1', 's1', 'm0');
  f.collections.get('messages')!.set(inputId, { ...message(), _id: inputId, _revision: 0 });
  await expect(f.metadata.putVoiceDelivery(delivery())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  f.collections.get('messages')!.set(inputId, { ...message(), visibility: 'internal', mode: 'live',
    _id: inputId, _revision: 0 });
  const first = delivery(); await f.metadata.putVoiceDelivery(first);
  await expect(f.metadata.compareVoiceDelivery({ ...first, sequence: 2,
    textSpoken: 'Not a prefix', textRemaining: null }, 1)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.metadata.compareVoiceDelivery({ ...first, sequence: 2, eventId: 'delivery-2', status: 'completed',
    textSpoken: first.textGenerated, textRemaining: '', audioDurationMs: 2000, audioPlayedMs: 500 }, 1))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  await expect(f.metadata.compareVoiceDelivery({ ...first, sequence: 2, audioDurationMs: 100,
    audioPlayedMs: 101 }, 1)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.metadata.compareVoiceDelivery({ ...first, sequence: 2 }, 1))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  expect(await f.metadata.compareVoiceDelivery({ ...first, sequence: 2, eventId: 'delivery-2', status: 'completed',
    textSpoken: first.textGenerated, textRemaining: '', audioDurationMs: 2000, audioPlayedMs: 2000 }, 1)).toBe(true);
});
```

#### 2B. Native restart, race, and ambiguous CAS

- [ ] **Step 6: Create `backend/test/persistence/voice-metadata.native.e2e-spec.ts`** with the following complete test. This is real-service verification of the behavior just implemented, not a new driver abstraction.

```typescript
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { RecordStore } from '../../src/persistence/store.js';
import { attempt, message, session } from './fixtures.js';
import { nativeDatabase } from './native.js';

it('restores delivery evidence after reconnect, wins one CAS and confirms a lost update ACK', async () => {
  const h = await nativeDatabase();
  try {
    const store = new RecordStore(h.db, 15_000);
    const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
    await new MongoSessions(store, DEFAULT_BUDGETS).createForInternalTurn({ ...session(), latestTurnId: 't1' });
    await new MongoMessages(store, DEFAULT_BUDGETS).append({ ...message(), mode: 'live', visibility: 'internal' });
    await metadata.putAttempt(attempt());
    const first = voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: 'u1', sessionId: 's1',
      turnId: 't1', attemptId: 'a1', status: 'pending', textGenerated: 'Hello. More.' });
    await metadata.putVoiceDelivery(first);
    await metadata.putVoiceDelivery(first);
    const variants = [
      { ...first, sequence: 2, eventId: 'delivery-2a', status: 'interrupted' as const, textSpoken: 'Hello.', textRemaining: ' More.' },
      { ...first, sequence: 2, eventId: 'delivery-2b', status: 'unknown' as const },
    ];
    const won = await Promise.all(variants.map(record => metadata.compareVoiceDelivery(record, 1)));
    expect(won.filter(Boolean)).toHaveLength(1);
    const current = variants[won[0] ? 0 : 1];
    const nextClient = await h.reconnect();
    try {
      const restarted = new MongoMetadata(new RecordStore(nextClient.db(h.name), 15_000), DEFAULT_BUDGETS);
      expect(await restarted.getVoiceDelivery('u1', 's1', 'a1')).toEqual(current);
      expect(await restarted.getVoiceDelivery('u2', 's1', 'a1')).toBeNull();
    } finally { await nextClient.close(); }
    expect(await h.db.collection('metadata').countDocuments({ kind: 'voice-delivery' })).toBe(1);
    await new MongoSessions(store, DEFAULT_BUDGETS).delete('u1', 's1');
    expect(await metadata.getVoiceDelivery('u1', 's1', 'a1')).toEqual(current);

    await metadata.putAttempt({ ...attempt(), attemptId: 'a2', idempotencyKey: 'request-0002', sequence: 2 });
    const second = { ...first, attemptId: 'a2', responseId: 'response-2', eventId: 'delivery-2' };
    await metadata.putVoiceDelivery(second);
    const collection = store.collection('metadata');
    const replace = collection.replaceOne.bind(collection);
    const dbSpy = vi.spyOn(store, 'collection').mockImplementation(name =>
      name === 'metadata' ? collection : h.db.collection(name) as ReturnType<RecordStore['collection']>);
    const ack = vi.spyOn(collection, 'replaceOne').mockImplementationOnce(async (...args) => {
      await replace(...args); throw new Error('ACK lost after commit');
    });
    try {
      const terminal = { ...second, sequence: 2, eventId: 'delivery-3', status: 'interrupted' as const,
        textSpoken: 'Hello.', textRemaining: ' More.' };
      expect(await metadata.compareVoiceDelivery(terminal, 1)).toBe(true);
      expect(await metadata.getVoiceDelivery('u1', 's1', 'a2')).toEqual(terminal);
    } finally { ack.mockRestore(); dbSpy.mockRestore(); }
  } finally { await h.close(); }
}, 30_000);
```

- [ ] **Step 7: Verify.** `npm test -- test/persistence/voice-metadata.spec.ts` (5 pass); `npm run test:e2e -- test/persistence/voice-metadata.native.e2e-spec.ts` (1 actual native pass, or explicitly blocked). Native `RecordStore` tests exercise CAS and ACK recovery, not owner admission; Task 4 tests the owner/journal integration. Record native fixture topology/configuration without credentials.
- [ ] **Step 8: Commit.**

```text
git add backend/src/persistence/metadata.ts backend/test/persistence/voice-metadata.spec.ts backend/test/persistence/voice-metadata.native.e2e-spec.ts
git commit -m "feat(voice): persist replay-safe speech delivery evidence"
```

### Task 3: Context Selection with Heard-Content Tracking

**Files:** Modify `backend/src/context/reference-selection.ts:67–71` and `backend/src/context/referenced-context-assembler.ts`; create `backend/test/context/voice-context.spec.ts`. Keep archived messages/manifest schemas unchanged.

#### 3A. Reference eligibility without transcript copies

- [ ] **Step 1: Write the first failing test** in `backend/test/context/voice-context.spec.ts`:

```typescript
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { voiceDeliveryRecordSchema, type VoiceDeliveryRecord } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { buildReferenceManifest } from '../../src/context/reference-selection.js';
import { ReferencedContextAssembler } from '../../src/context/referenced-context-assembler.js';
import { assets, manifest, ports, record, request } from './fixtures.js';

function voiceRecords(status: 'completed' | 'interrupted' | 'cancelled' | 'failed' | 'truncated' = 'completed') {
  return [record({ visibility: 'internal', mode: 'live' }), record({
    messageId: 'm2', eventId: 'e2', sequence: 1, role: 'assistant',
    content: 'Hello. More.', completionStatus: status, truncated: status === 'truncated',
    attemptId: 'a1', visibility: 'internal', mode: 'live',
  })];
}
function delivery(overrides: Partial<VoiceDeliveryRecord> = {}): VoiceDeliveryRecord {
  return voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a1', status: 'interrupted', textGenerated: 'Hello. More.',
    textSpoken: 'Hello.', textRemaining: ' More.', ...overrides });
}

it.each(['interrupted', 'cancelled', 'failed', 'truncated'] as const)
  ('retains terminal %s live assistant references without copying generated content', status => {
    const records = voiceRecords(status);
    const selected = buildReferenceManifest('u1', 's1', 2, records, assets, DEFAULT_BUDGETS);
    expect(selected.messageRefs.map(ref => ref.messageId)).toEqual(['m1', 'm2']);
    expect(JSON.stringify(selected)).not.toContain('Hello');
    const text = records.map(({ visibility, mode, ...rest }) => {
      void visibility; void mode; return rest;
    });
    expect(buildReferenceManifest('u1', 's1', 2, text, assets, DEFAULT_BUDGETS).messageRefs)
      .toEqual([{ messageId: 'm1', eventId: 'e1', sequence: 0 }]);
  });
```

- [ ] **Step 2: Run RED.** `npm test -- test/context/voice-context.spec.ts -t "retains terminal"`; expect four failures because only completed assistants are currently eligible.
- [ ] **Step 3: Minimal implementation — replace `eligible` in `backend/src/context/reference-selection.ts`** with:

```typescript
export function eligible(record: MessageRecord): boolean {
  if (record.role === 'user') return (record.completionStatus === 'accepted' ||
    record.completionStatus === 'completed') && !record.truncated;
  if (record.visibility === 'internal' && record.mode === 'live') {
    return record.attemptId !== null &&
      ['completed', 'truncated', 'interrupted', 'cancelled', 'failed'].includes(record.completionStatus);
  }
  return record.completionStatus === 'completed' && !record.truncated && record.attemptId !== null;
}
```

This broadens **candidate references**, not delivery assumptions. Streaming assistants remain ineligible; terminal text behavior is unchanged. P6's acceptance/history filter must also admit terminal live candidates rather than retaining only `a.status === 'completed'`; Task 1's raw paging alone cannot make interrupted attempts survive recovery.

- [ ] **Step 4: Run GREEN.** Repeat the focused command (4 pass), then `npm test -- test/context/reference-selection.spec.ts` to prove text exclusions are unchanged.

#### 3B. Correct original messages at prompt materialization

- [ ] **Step 5: Append these failing tests** to `backend/test/context/voice-context.spec.ts`:

```typescript
it.each(['completed', 'interrupted', 'cancelled', 'failed', 'truncated'] as const)
  ('uses heard speech for a %s live original without changing stored content', async status => {
    const records = voiceRecords(status); const d = ports(records);
    const before = structuredClone(records);
    const metadata = { getVoiceDelivery: vi.fn(async () => delivery()) };
    const result = await new ReferencedContextAssembler({ ...d, metadata }).assemble(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected context');
    expect(result.context.messages.slice(2)).toEqual([
      { role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hello.' },
      { role: 'user', content: request.newUserInput },
    ]);
    expect(metadata.getVoiceDelivery).toHaveBeenCalledExactlyOnceWith('u1', 's1', 'a1');
    expect(records).toEqual(before);
  });

it('omits known zero speech and preserves explicit unknown instead of generated output', async () => {
  for (const [textSpoken, expected] of [
    ['', []],
    [null, [{ role: 'assistant', content: 'Voice reply delivery is unknown; do not assume generated content was heard.' }]],
  ] as const) {
    const metadata = { getVoiceDelivery: vi.fn(async () => delivery({ status: textSpoken === null ? 'unknown' : 'interrupted',
      textSpoken, textRemaining: textSpoken === '' ? 'Hello. More.' : null })) };
    const result = await new ReferencedContextAssembler({ ...ports(voiceRecords()), metadata }).assemble(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected context');
    expect(result.context.messages.slice(2)).toEqual([
      { role: 'user', content: 'Hello' }, ...expected, { role: 'user', content: request.newUserInput },
    ]);
  }
});

it('fails closed for missing, pending, mismatched or malformed delivery evidence', async () => {
  await expect(new ReferencedContextAssembler(ports(voiceRecords())).assemble(request))
    .rejects.toMatchObject({ code: 'NOT_READY' });
  for (const value of [null, delivery({ status: 'pending' }), delivery({ sessionId: 'other' }),
    delivery({ userId: 'other' }), delivery({ attemptId: 'other' }), delivery({ turnId: 'other' }),
    delivery({ textGenerated: 'Hello. More. EXTRA', textRemaining: ' More. EXTRA' }),
    { ...delivery(), textSpoken: 'INVALID PREFIX' } as VoiceDeliveryRecord]) {
    const metadata = { getVoiceDelivery: vi.fn(async () => value) };
    await expect(new ReferencedContextAssembler({ ...ports(voiceRecords()), metadata }).assemble(request))
      .rejects.toMatchObject({ code: 'NOT_READY' });
  }
});

it('includes internal input once by turn identity while retaining repeated text from prior turns', async () => {
  const records = [...voiceRecords(), record({ messageId: 'm3', eventId: 'e3', sequence: 3,
    turnId: request.turnId, content: request.newUserInput, visibility: 'internal', mode: 'live' })];
  records[0] = { ...records[0], content: request.newUserInput };
  const metadata = { getVoiceDelivery: vi.fn(async () => delivery()) };
  const result = await new ReferencedContextAssembler({ ...ports(records), metadata }).assemble(request);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected context');
  expect(result.context.messages.slice(2)).toEqual([
    { role: 'user', content: request.newUserInput }, { role: 'assistant', content: 'Hello.' },
    { role: 'user', content: request.newUserInput },
  ]);
});

it('keeps visible legacy assistant history unchanged and performs no delivery lookup', async () => {
  const metadata = { getVoiceDelivery: vi.fn(async () => delivery()) };
  const result = await new ReferencedContextAssembler({ ...ports(), metadata }).assemble(request);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected context');
  expect(result.context.messages[3]).toEqual({ role: 'assistant', content: 'Hi' });
  expect(metadata.getVoiceDelivery).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run RED.** `npm test -- test/context/voice-context.spec.ts -t "uses heard speech"`; expect full generated content instead of `Hello.`. The other cases then lock in fail-closed/empty/unknown behavior.
- [ ] **Step 7: Minimal implementation — add imports and the optional reader field to `ContextDependencies`** in `backend/src/context/referenced-context-assembler.ts`:

```typescript
import type { MessageRecord } from '../contracts/message.js';
import { voiceDeliveryRecordSchema, type VoiceDeliveryRecord } from '../contracts/voice.js';
```

```typescript
metadata?: {
  getVoiceDelivery(userId: string, sessionId: string, attemptId: string): Promise<VoiceDeliveryRecord | null>;
};
```

The optional field preserves every existing text-only assembler/test caller. Internal live history without this field fails closed; it does not silently fall back to generated text. P10 supplies `persistence.metadata` to this existing factory, not a second persistence instance.

Add the following private method to `ReferencedContextAssembler`:

```typescript
private async heardMessage(record: MessageRecord): Promise<ContextChatMessage | null> {
  if (record.role !== 'assistant' || record.visibility !== 'internal' || record.mode !== 'live') {
    return { role: record.role, content: record.content };
  }
  const reader = this.dependencies.metadata;
  if (!reader || !record.attemptId) throw new AppError('NOT_READY', 'Voice delivery needs reconciliation.');
  const raw = await reader.getVoiceDelivery(record.userId, record.sessionId, record.attemptId);
  const parsed = voiceDeliveryRecordSchema.safeParse(raw);
  if (!parsed.success || parsed.data.userId !== record.userId || parsed.data.sessionId !== record.sessionId ||
    parsed.data.turnId !== record.turnId || parsed.data.attemptId !== record.attemptId ||
    parsed.data.textGenerated !== record.content || parsed.data.status === 'pending') {
    throw new AppError('NOT_READY', 'Voice delivery needs reconciliation.');
  }
  const delivery = parsed.data;
  const content = delivery.status === 'unknown' || delivery.textSpoken === null
    ? 'Voice reply delivery is unknown; do not assume generated content was heard.'
    : delivery.textSpoken;
  return content === '' ? null : { role: 'assistant', content };
}
```

Replace the history-to-prompt construction immediately after `selectReferences` in `assemble`:

```typescript
const heardHistory: ContextChatMessage[] = [];
for (const record of history) {
  const message = await this.heardMessage(record);
  if (message) heardHistory.push(message);
}
const messages: ContextChatMessage[] = [...this.fixedMessages(), ...heardHistory,
  { role: 'user', content: request.newUserInput }];
```

Keep original schema/scope/ref/byte validation **before** projection and the existing `checkContextBudget` **after** projection. No transcript writes, no cached delivery result, no metadata copied into manifests, and no compensation/retry/inference from this read-only assembler.

- [ ] **Step 8: Verify.** `npm test -- test/context/voice-context.spec.ts` (13 cases before the next regression); `npm test -- test/context` (all existing context suites discovered, unchanged text/tool-protocol isolation and budgets). `npm run build` and `npm run lint`.
- [ ] **Step 9: Add the byte-bound regression** to the same file and run it; a shorter spoken projection cannot make an oversized original acceptable:

```typescript
it('validates original generated bytes before projection and never silently discards overflow', async () => {
  const generated = 'x'.repeat(3000);
  const records = voiceRecords(); records[1] = { ...records[1], content: generated };
  const d = ports(records);
  const metadata = { getVoiceDelivery: vi.fn(async () => delivery({ textGenerated: generated,
    textSpoken: 'x', textRemaining: generated.slice(1) })) };
  await expect(new ReferencedContextAssembler({ ...d, metadata,
    budgets: { ...DEFAULT_BUDGETS, maxMessageBytes: 1024 } }).assemble(request))
    .rejects.toMatchObject({ code: 'NOT_READY', message: 'A saved message exceeds the context limits.' });
  expect(metadata.getVoiceDelivery).not.toHaveBeenCalled();
  expect(manifest(records).messageRefs).toHaveLength(2);
});
```

- [ ] **Step 10: Commit.**

```text
git add backend/src/context/reference-selection.ts backend/src/context/referenced-context-assembler.ts backend/test/context/voice-context.spec.ts
git commit -m "feat(voice): build context from confirmed heard speech"
```

### Task 4: Checkpoint & Session Memory Consistency

**Files:** Modify `backend/src/context/create-context-assembler.ts`; create `backend/test/context/voice-startup.spec.ts` and `backend/test/persistence/voice-checkpoints.native.e2e-spec.ts`; extend `backend/test/persistence/mutation-journal.spec.ts`. Leave saver, graph channels, owner and mutation-journal production code unchanged unless these checks identify a P2-owned defect.

#### 4A. The real context factory must forward delivery reads

- [ ] **Step 1: Write the failing factory test** in `backend/test/context/voice-startup.spec.ts`. This uses existing valid deployment Markdown assets without changing them.

```typescript
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { createContextAssembler } from '../../src/context/create-context-assembler.js';
import { buildReferenceManifest } from '../../src/context/reference-selection.js';
import { ports, record, request } from './fixtures.js';

it('forwards delivery reads through startup and rebuilds heard context on every assembly', async () => {
  const records = [record({ mode: 'live', visibility: 'internal' }), record({ messageId: 'm2', eventId: 'e2',
    sequence: 1, role: 'assistant', attemptId: 'a1', completionStatus: 'completed',
    mode: 'live', visibility: 'internal', content: 'Hello. More.' })];
  const dependencies = ports(records);
  const value = voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a1', textGenerated: 'Hello. More.' });
  const metadata = { getVoiceDelivery: vi.fn(async () => value) };
  const { assembler, assets } = await createContextAssembler({ ...dependencies, metadata,
    paths: { knowledge: new URL('../../../product_knowledge.md', import.meta.url),
      instructions: new URL('../../src/instructions/system.md', import.meta.url) } });
  dependencies.memory.get.mockResolvedValue(buildReferenceManifest('u1', 's1', 1, records, assets, DEFAULT_BUDGETS));
  const unknown = await assembler.assemble(request);
  expect(unknown.ok).toBe(true);
  if (!unknown.ok) throw new Error('expected context');
  expect(unknown.context.messages[3].content).toContain('delivery is unknown');
  metadata.getVoiceDelivery.mockResolvedValue({ ...value, status: 'interrupted', sequence: 2,
    textSpoken: 'Hello.', textRemaining: ' More.' });
  const corrected = await assembler.assemble(request);
  expect(corrected.ok).toBe(true);
  if (!corrected.ok) throw new Error('expected context');
  expect(corrected.context.messages.slice(2)).toEqual([
    { role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hello.' },
    { role: 'user', content: request.newUserInput },
  ]);
  expect(metadata.getVoiceDelivery).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run RED.** `npm test -- test/context/voice-startup.spec.ts`. Expect `NOT_READY` because the current factory drops the newly added reader even though the caller supplied it.
- [ ] **Step 3: Minimal implementation** in `backend/src/context/create-context-assembler.ts`, replace only constructor dependency forwarding:

```typescript
const assembler = new ReferencedContextAssembler({ memory: options.memory,
  messages: options.messages, metadata: options.metadata, budgets: options.budgets, assets });
```

- [ ] **Step 4: Run GREEN.** `npm test -- test/context/voice-startup.spec.ts test/context/startup.spec.ts`; expect 5 passes. No fixed asset/schema version change is required.

#### 4B. Native checkpoint-restored generated result cannot override delivered history

- [ ] **Step 5: Add `backend/test/persistence/voice-checkpoints.native.e2e-spec.ts`.** The stock checkpoint deliberately contains the original generated assistant. The application must still read the manifest and the latest delivery snapshot after reconnect, not append checkpoint text to the prompt. This is a storage/assembler boundary test; P6/P11 must additionally verify the actual graph/runtime saved-result reconciliation.

```typescript
import { emptyCheckpoint } from '@langchain/langgraph-checkpoint';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { ReferencedContextAssembler } from '../../src/context/referenced-context-assembler.js';
import { buildReferenceManifest } from '../../src/context/reference-selection.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { MongoCheckpointFactory } from '../../src/persistence/checkpoints.js';
import { MongoMemory } from '../../src/persistence/memory.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { graphThreadId } from '../../src/persistence/records.js';
import { RecordStore } from '../../src/persistence/store.js';
import { assets, request } from '../context/fixtures.js';
import { attempt, message, session } from './fixtures.js';
import { nativeDatabase } from './native.js';

it('restores original graph evidence but assembles corrected internal history once and fences stale writers', async () => {
  const h = await nativeDatabase();
  try {
    const p = await createPersistenceBundle(h.client, h.name, DEFAULT_BUDGETS, 'voice-process');
    try {
    await p.sessions.createForInternalTurn({ ...session(), latestTurnId: 't1' });
    const acquired = await p.owner.acquire({ userId: 'u1', sessionId: 's1', ownerId: 'voice-process', leaseMs: 60_000 });
    if (!acquired.ok) throw new Error('expected lease');
    const lease = acquired.lease;
    const records = [
      { ...message(0), mode: 'live' as const, visibility: 'internal' as const },
      { ...message(2), mode: 'live' as const, visibility: 'internal' as const, content: 'Hello. More.' },
      { ...message(3), role: 'user' as const, completionStatus: 'accepted' as const,
        attemptId: null, turnId: request.turnId, content: request.newUserInput,
        mode: 'live' as const, visibility: 'internal' as const },
    ];
    const memory = buildReferenceManifest('u1', 's1', 1, records, assets, DEFAULT_BUDGETS);
    await p.owner.run(lease, async () => {
      for (const record of records) await p.messages.append(record);
      await p.metadata.putAttempt(attempt());
      await p.memory.put(memory);
    });
    const initial = voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: 'u1', sessionId: 's1',
      turnId: 't1', attemptId: 'a1', status: 'pending', textGenerated: 'Hello. More.' });
    await p.owner.run(lease, () => p.metadata.putVoiceDelivery(initial));
    const saver = (await p.checkpoints.create()).bind(lease);
    const checkpoint = emptyCheckpoint();
    checkpoint.channel_values = { result: { assistant: records[1], target: memory }, sealed: true };
    const cfg = { configurable: { thread_id: graphThreadId('u1', 's1'), checkpoint_ns: '' } };
    const saved = await saver.put(cfg, checkpoint, { source: 'update', step: 1, parents: {} });
    const interrupted = { ...initial, sequence: 2, eventId: 'delivery-2', status: 'interrupted' as const,
      textSpoken: 'Hello.', textRemaining: ' More.' };
    expect(await p.owner.run(lease, () => p.metadata.compareVoiceDelivery(interrupted, 1))).toBe(true);
    const other = await h.reconnect();
    try {
      const store = new RecordStore(other.db(h.name), 15_000);
      const restoredSaver = (await new MongoCheckpointFactory(other, h.name, p.owner, DEFAULT_BUDGETS).create()).bind(lease);
      const restored = await restoredSaver.getTuple(saved);
      expect(restored?.checkpoint.channel_values.result).toEqual({ assistant: records[1], target: memory });
      const assembler = new ReferencedContextAssembler({ assets, budgets: DEFAULT_BUDGETS,
        memory: new MongoMemory(store, DEFAULT_BUDGETS), messages: new MongoMessages(store, DEFAULT_BUDGETS),
        metadata: new MongoMetadata(store, DEFAULT_BUDGETS) });
      const result = await assembler.assemble(request);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected context');
      expect(result.context.messages.slice(2)).toEqual([
        { role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hello.' },
        { role: 'user', content: request.newUserInput },
      ]);
      expect(await p.memory.get('u1', 's1')).toEqual(memory);
      expect((await p.messages.get('u1', 's1', 'm2'))?.content).toBe('Hello. More.');
      expect((await p.messages.list('u1', 's1', { cursor: null, limit: 20 })).items).toEqual([]);
    } finally { await other.close(); }
    await p.owner.release(lease);
    await expect(p.owner.run(lease, () => p.metadata.compareVoiceDelivery({ ...interrupted, sequence: 3 }, 2)))
      .rejects.toMatchObject({ code: 'INTERRUPTED' });
    await expect(saver.put(cfg, checkpoint, { source: 'update', step: 2, parents: {} }))
      .rejects.toMatchObject({ code: 'INTERRUPTED' });
    } finally { await p.owner.releaseExecutor(); }
  } finally { await h.close(); }
}, 30_000);
```

- [ ] **Step 6: Verify native invariants.** `npm run test:e2e -- test/persistence/voice-checkpoints.native.e2e-spec.ts test/persistence/checkpoints.native.e2e-spec.ts test/persistence/ownership.native.e2e-spec.ts`. Expect actual native passes (or blocked prerequisites). Existing saver/owner checks need no artificial failing change. Do not patch/rewrite checkpoint history, remove sentinels, or introduce a `messages` reducer. The fixture's synthetic saved `result` is not a claim that `SavedResult` runtime validation has been tested.

#### 4C. Preserve owner-bound mutation journaling for delivery records

- [ ] **Step 7: Extend `backend/test/persistence/mutation-journal.spec.ts`.** Add imports for `MongoMetadata`, `voiceDeliveryRecordSchema`, `deliveryFixture`, and `attempt` from their exact existing paths. Reuse the existing file-local `fixture()` and its collection/control spies; append:

```typescript
it('journals delivery create and CAS through the same guarded metadata facade', async () => {
  const f = fixture(); f.resolveAck();
  const client = guardedClient(f.client as never, 'db', f.journal);
  const store = new RecordStore(client.db('db'), 1000);
  const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
  const value = voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a1', status: 'pending', textGenerated: 'Hello. More.' });
  const linkedInput = { ...message(), mode: 'live', visibility: 'internal' };
  f.collection.findOne.mockResolvedValueOnce({ ...attempt(), _id: 'attempt', _revision: 0 })
    .mockResolvedValueOnce({ ...linkedInput, _id: 'input', _revision: 0 })
    .mockResolvedValueOnce({ ...value, _id: 'delivery', _revision: 0 });
  await metadata.putVoiceDelivery(value);
  expect(f.control.updateOne).toHaveBeenCalledTimes(2);
  expect(f.collection.updateOne).toHaveBeenCalledTimes(1);
  expect(f.collection.updateOne.mock.calls[0]?.[2]).toMatchObject({ writeConcern: { w: 'majority', j: true } });

  const rawCollection = f.collection as typeof f.collection & { replaceOne: ReturnType<typeof vi.fn> };
  rawCollection.replaceOne = vi.fn(async () => ({ acknowledged: true, matchedCount: 1 }));
  f.collection.findOne.mockResolvedValueOnce({ ...attempt(), _id: 'attempt', _revision: 0 })
    .mockResolvedValueOnce({ ...linkedInput, _id: 'input', _revision: 0 })
    .mockResolvedValueOnce({ ...value, _id: 'delivery', _revision: 0 });
  expect(await metadata.compareVoiceDelivery({ ...value, sequence: 2, eventId: 'delivery-2', status: 'interrupted',
    textSpoken: 'Hello.', textRemaining: ' More.' }, 1)).toBe(true);
  expect(f.control.updateOne).toHaveBeenCalledTimes(4);
  expect(rawCollection.replaceOne.mock.calls[0]?.[2]).toMatchObject({ writeConcern: { w: 'majority', j: true } });
  expect(f.events.filter(event => event === 'intent')).toHaveLength(1);
  expect(() => f.journal.assertHealthy()).not.toThrow();
});
```

Add `message` to the existing fixtures import along with `attempt`. The fake control fixture logs `intent` only for its first control update and `idle` thereafter; assert mutation/control call counts rather than treating its labels as a production journal state trace. `RecordStore.replace` uses the computed hashed `_id`, so the stubbed saved document must use that same ID for meaningful filter checking if the fake is extended to inspect the query.

- [ ] **Step 8: Run the deterministic guard checks.** `npm test -- test/persistence/mutation-journal.spec.ts test/persistence/local-owner.spec.ts test/persistence/local-open.spec.ts`. The new test proves existing guarded-client coverage of both delivery write primitives; existing tests prove rejected begin-intent, unknown write quarantine, pending journal preservation, drain and stale-owner refusal. If the new test exposes a real gap, record RED and use systematic debugging before the smallest P2-owned correction. Do not add a second mutation wrapper.
- [ ] **Step 9: Commit.**

```text
git add backend/src/context/create-context-assembler.ts backend/test/context/voice-startup.spec.ts backend/test/persistence/voice-checkpoints.native.e2e-spec.ts backend/test/persistence/mutation-journal.spec.ts
git commit -m "test(voice): preserve checkpoint and fenced recovery consistency"
```

## Final P2 verification and reporting

- [ ] Run `npm test -- test/persistence/voice-messages.spec.ts test/persistence/voice-metadata.spec.ts test/context/voice-context.spec.ts test/context/voice-startup.spec.ts` and record discovered tests/pass/fail counts. No empty suite is evidence.
- [ ] Run `npm test -- test/persistence test/context`, then `npm test`, `npm run build`, and `npm run lint`. Report unrelated pre-existing failures with paths; do not overwrite other owners' changes to make a plan look green.
- [ ] With operator-supplied `AURVIN_TEST_MONGODB_URI` and **exactly** `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`, run `npm run test:e2e -- test/persistence/voice-messages.native.e2e-spec.ts test/persistence/voice-metadata.native.e2e-spec.ts test/persistence/voice-checkpoints.native.e2e-spec.ts`, then the existing persistence native suites. Tests create/drop generated isolated databases only. Do not print URI values, target application databases, or run live Deepgram/OpenRouter calls.
- [ ] Check `git diff --check`, and before each commit inspect `git diff --cached --name-only` under the orchestrator's serialized commit window. Stage named P2 files only; do not commit user work, `.openchamber/`, generated output, or configuration.
- [ ] Return P2 implementation commit hashes, exact tests actually run, native blocked/unrun status, and the following interfaces/remaining integration requirements. P2 completion is **not** complete voice rollout or runtime integration certification.

| Owner | Required downstream work (outside P2 implementation) |
| --- | --- |
| P1 | Publish the concrete delivery method signatures and backend-only original-history paging port when generic repository consumers require them; preserve current user session contract changes |
| P5 | Do not create empty chats for voice startup; carry server-resolved identity and stable voice/conversation/socket/response binding; never expose internal transcript text |
| P6 | Call neutral session creation for first accepted live input; append both input/output as `visibility: 'internal', mode: 'live'`; preserve these fields on failure/recovery/retry paths |
| P6 | Change `archiveRecords` to `listForContext`; include terminal live candidates in accepted-history recovery while retaining acceptance-marker validation and text semantics |
| P6 | Write pending delivery before speech; project provider socket-wide offsets into per-response played evidence; make completed delivery contingent on actual playback; persist unknown on lost reconciliation; sequence/CAS/fence all writes and reject late callbacks |
| P6 | Reuse sealed generated results for finalization without replaying inference; never substitute full checkpoint output for delivery-corrected model history; test the actual graph/runtime restore path |
| P6 | Filter every text status/submission/retry/stream serializer, not only `MongoMessages.list`; prevent text retry of an internal voice turn from surfacing its input/output |
| P9 | Keep soft-deleted delivery evidence until operational full-conversation retention; include delivery snapshots in bounded metadata cleanup/backup/restore without bypassing owner/journal policy |
| P10 | Pass the single bundle's metadata adapter into `createContextAssembler`; retain one runtime/persistence-close owner |
| P11 | Prove assembled cross-mode/restart behavior and no hidden text in wire responses/sidebar/UI; measure real-device/provider heard-content and latency gates separately |

### Acceptance/evidence checklist

- [ ] Old text records and explicit visible records remain readable; internal message pages/cursors do not leak or consume public page slots (Task 1).
- [ ] Navigation stays neutral for voice-created chats; existing text titles/pins remain untouched; soft deletion preserves internal memory/evidence (Tasks 1–2).
- [ ] Delivery attempts/socket/response bindings are scoped, bounded, prefix-consistent, monotonic, CAS-updated, and replay-safe through ambiguous ACKs (Task 2).
- [ ] Original reference validation/order/input identity remains intact; delivered prefix/empty/unknown handling is explicit; generated text never silently becomes heard speech (Task 3).
- [ ] Interrupted/cancelled/failed/truncated live originals survive reference selection; incomplete text assistants remain excluded (Task 3).
- [ ] Factory wiring does not drop delivery reads; restored stock graph evidence is not mutated or concatenated into prompt history; stale leases fail and delivery writes retain existing journals (Task 4).
- [ ] Actual runtime no-reinference recovery and all text serializer filtering are identified as P6/P11 obligations, not falsely claimed as P2 passing evidence.
- [ ] Native/Azure/provider/device limitations remain explicit; review is **skipped**; no production readiness assertion.

## Planner validation (documentation only, 8 October 2026)

- Checked four required task headings, local Markdown links, explicit ownership/handoffs, absence of placeholders, and absence of code-file headers in this plan.
- All 22 TypeScript code blocks parsed successfully. A read-only TypeScript compiler overlay assembling the proposed snippets into 14 source/test files found **no new diagnostics**. One existing diagnostic, `TS2339` at `backend/test/persistence/mutation-journal.spec.ts:119` (`collection.find({}).client`), was reported separately and not changed or counted as a passing package check.
- No implementation files were written, emitted, or executed. Application suites, builds, MongoDB tests, paid providers, and browser/device checks were **not run** during planning. The commands/results specified in task steps are expected worker evidence, not current passing results.
