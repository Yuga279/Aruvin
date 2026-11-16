# P2 — Persistence evolution and proposal authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. P2 is one storage unit; do not dispatch a reviewer.

**Goal:** Persist bounded multi-calendar connection state and durable cross-turn proposal/operation authority without changing the meaning of legacy evidence or introducing another persistence owner.

**Architecture:** Extend the existing `RecordStore`-backed Calendar adapters with explicitly typed v2 facades; retain their legacy entry points until their consumers migrate. Use single-document CAS, deterministic keys, scoped unique indexes, exact rereads, and recoverable ordered writes in the existing collections—not transactions. A proposal consumption fixes an intent's operation identity before reservation; neither expiry nor an ambiguous acknowledgement creates fresh effect authority.

**Tech Stack:** TypeScript/ESM NodeNext (`.js` local imports), existing MongoDB driver 6.x, Zod 3, Vitest and guarded native fixtures; Node `^22.22.3 || ^24.15.0 || >=26.0.0`. No dependency or package-manifest changes; commands run in `backend/`, not a root workspace.

---

## Boundary, prerequisites, and evidence

Read the approved `goal.md`, P2/shared-file/A1 sections of `state.md`, relevant `research.md`, `plan1.md`, actual contracts, and root `AGENTS.md`. The dated approval/resume gates in state supersede preparation-era stop prose. P1's worker is complete through `5bd1d33`, A1 is `e160c0c`; planning baseline is `75f088c`. P2's worker starts only after this plan is committed and the orchestrator dispatches it. Review remains **skipped**, not passed.

Write only `backend/src/persistence/calendar-*.ts`, necessary `persistence.ts`, `indexes.ts`, `index.ts`, and matching `backend/test/persistence/calendar-*`. Migration source/fixtures use `calendar-migration*`. This planner writes **only this document**. Never edit contracts, manifests, generic `store.ts`, `records.ts`, `checkpoints.ts`, `metadata.ts`, ownership/journal code, P4/P5/P6/P8 source/tests, another plan, goal/state/research, `.env`, or `.openchamber/`. An amendment is required before a standalone migration script or any foreign-path write.

The reported post-P1/A1 backend baseline has **13 failing files / 34 failing tests; 1,563 passed, 10 skipped**. P4 verified-scope fixtures, P5 v1/three-tool expectations and P8 assembly/HTTP consumers remain their owners' work. Record the actual current result; do not weaken, skip, delete, or absorb those tests. A newly demonstrated P2 regression is P2's responsibility. Full-package failures are failures with named owner gates, not passing evidence.

No account/Google/model calls, installs, application-data migration, provisioning or deployment are authorized here. Native execution requires separately supplied isolated prerequisites. A fixture is not live-service, Azure, multi-instance or production certification.

### Code and commit conventions

- Every new code/test file starts with the root-required `FILE`, `LOCATION`, `PURPOSE`, `ROLE IN PROJECT`, `KEY COMPONENTS` banner; add it to existing files changed by >30%. Snippets below omit repeated banners; prepend the actual filename/path-specific banner before writing. This Markdown has no code-file banner.
- Preserve existing Vitest discovery/configuration and fixtures. Local TypeScript imports end in `.js`. No framework or dependency additions, permissive schemas, fabricated scopes, invented primary flags, raw provider dumps, tokens in logs, or text-similarity deduplication.
- Each task is ordered **test → red → minimum implementation → green → commit**. Split its test/implementation actions into individual small edits; do not write all production code first. Commands below are individual commands, always sequential.
- Before each commit obtain the orchestrator's shared-index slot, run `git diff --check`, stage only that task's named paths, inspect `git diff --cached --name-only`, then commit. No `git add .`, amend, branch/worktree changes, reset, or unrelated staging. Return the index slot after each commit.

## Exact P1 handoff and source reconciliation

These names exist in committed source; import them, do not recreate their schemas:

| Source | P2 consumption |
| --- | --- |
| `contracts/calendar-discovery.ts` | `calendarConnectionV2Schema`, `calendarConnectionTransitionV2Schema`, `calendarDiscoverySnapshotSchema`, `calendarDefaultSettingSchema`, `CalendarConnectionRecordV2`, `CalendarConnectionStoreV2`, `CalendarDiscoverySnapshot`, `CalendarAccountBinding`, `CalendarResolvedTarget` |
| `contracts/calendar-authority.ts` | `calendarProposalSchema`, `calendarProposalReplySchema`, `calendarProposalConsumptionSchema`, `calendarProposalTombstoneSchema`, `proposalMatchesReply`, `CalendarProposalRecord`, `CalendarProposalReply`, `CalendarProposalConsumption`, `CalendarProposalTombstone`, `CalendarProposalConsumeResult`, `CalendarProposalStore` |
| `contracts/calendar-operations.ts` | `operationRecordSchema`, `operationRecordV2Schema`, `calendarOperationTransitionV2Schema`, `calendarReceiptSchema`, `calendarReceiptV2Schema`, `CalendarOperation`, `CalendarOperationV2`, `CalendarOperationStoreV2`, `CalendarReceiptV2`, `CalendarRequestKindV2` |
| `contracts/calendar-compatibility.ts` | `compatibleCalendarConnectionSchema`, `compatibleCalendarOperationSchema`, `compatibleCalendarReceiptSchema`, `compatibleCalendarSourceSchema`, `compatibleCalendarResultRecordSchema`, `compatibleCalendarDecisionSchema`, `compatibleCalendarRejectedDecisionSchema`, `compatibleCalendarDispatchSchema`, `compatibleCalendarCheckpointRefsSchema`, `calendarCheckpointRefsV1Schema`, `calendarCheckpointRefsV2Schema`, `calendarLegacyDispositionSchema`, `legacyOperationDisposition`, `CalendarLegacyDisposition` |
| `contracts/calendar-model.ts` | `resumableDecisionV2Schema`, `rejectedDecisionV2Schema`, `CalendarDecisionStoreV2`, `ResumableCalendarDecisionV2`, `CalendarRejectedDecisionV2` |
| `contracts/calendar-sources.ts` | `sourceReferenceV2Schema`, `persistedCalendarResultV2Schema`, `calendarToolResultRecordV2Schema`, `CalendarSourceReferenceV2`, `CalendarToolResultRecordV2`, `CalendarResultStoreV2` |
| `contracts/calendar-accounting.ts` | `modelDispatchV2Schema`, `CalendarModelDispatchV2`, `CalendarAccountingStoreV2`; unchanged `turnBudgetRecordSchema`, `modelAggregateSchema`, money helpers |
| `contracts/calendar-policy.ts` | `CALENDAR_SCOPES_V1`, `CALENDAR_SCOPES`, `CALENDAR_LIMITS`, `calendarGrantStatus`; active tool `google-calendar.v2`, proof `google-calendar.multi.v2`, cursor 2; historical schema marker remains 1 and explicit v2 schemas use 2 |

**Reconciliation:** the completed P1 source incorporates plan1's later retention, selection and boundary additions: proposals require `retentionPolicyId` and `contentExpiresAt`; operation labels require supporting `actionSources`; selection consumption uses a candidate-specific action hash. No incompatible P1 port/name mismatch was found. The original research's `calendarSuccessSchema.data` and `pending`/`resumable` operation-state descriptions do not match actual source; plan1 explicitly corrects them. Actual legacy operation states are `planned`, `dispatching`, `unknown`, `succeeded`, `definitely-failed`, `evidence-expired`. Do not rewrite an unknown external effect to a known failure.

Two deliberately stricter **storage** rules supplement, not replace, P1 validation:

1. `calendarConnectionTransitionV2Schema` allows an authority-changing transition to leave `connectionRevision` unchanged. P2 additionally requires +1 for enable/disable, meaningful grant/status changes, disconnect/reconnect and account replacement; default/discovery/token-only changes require unchanged account authority. Token refresh must not silently change status/scopes. Degraded-health annotations belong outside a token-only write.
2. `calendarOperationTransitionV2Schema` is not a full state machine. P2 adds the explicit allowed-edge table, immutable canonical action, nondecreasing delivery counters and time, no replay of `unknown`, and one-way privacy redaction. In particular v2 `unknown → dispatching` is forbidden by the frozen contract even though the legacy adapter has an absent-readback retry path. Do not copy that v1 path into v2 or change the contract; P6 reconciles the original ID/target without a new insert.

**Collections:** exact existing names are `sessions`, `messages`, `agent-memory`, `metadata`, `checkpoints`, `checkpoint_writes`, `config`, `integration_connections` (eight; the collection header's “seven” prose is stale). Connection/default/discovery remain in `integration_connections`; proposal/consumption/disposition/operation/evidence records remain in `metadata`. No new collection or TTL index.

## File map and internal API decisions

| Owned paths | Responsibility |
| --- | --- |
| `src/persistence/calendar-records.ts` | Deterministic proposal/intent/disposition keys and compatible one-way redaction; reuse `encodeCalendar`/`decodeCalendar`/money codec |
| `src/persistence/calendar-connections.ts` | Existing OAuth state behavior unchanged; add a `v2: CalendarConnectionStoreV2` facade, compatible read, v2 create/CAS and explicit legacy migration entry |
| New `src/persistence/calendar-proposals.ts` | Implement frozen `CalendarProposalStore`; one pending record per user/session, durable consumption, supersession and tombstones |
| `src/persistence/calendar-operations.ts` | Add `v2: CalendarOperationStoreV2`; immutable intent reservation and transition fencing, compatible history |
| `src/persistence/calendar-evidence.ts`, `calendar-accounting.ts` | Explicit v2 facades over existing instances; compatible reads with unchanged budget/money ownership |
| `src/persistence/calendar-checkpoints.ts` | Re-export original v1 schema for legacy callers; use compatible refs in the shared safety walker and export v2 schema |
| `src/persistence/calendar-retention.ts` | Bounded, cursor-honoring cleanup and version-aware privacy redaction; keep unresolved identity/quarantine |
| New `src/persistence/calendar-migration.ts` | Explicit per-record migration/projection and read-only rollback assessment; no executable CLI or automatic bootstrap conversion |
| `src/persistence/indexes.ts`, `persistence.ts`, `index.ts` | Only additive scoped indexes/exports/bundle fields over the existing `store`, owner and close lifecycle |
| New `test/persistence/calendar-multi-fixtures.ts`, `calendar-multi-memory.ts` | Parsed inert fixtures and a collection-separated, fault-injectable memory adapter |
| New `test/persistence/calendar-multi-{connections,proposals,operations,evidence,accounting,retention,indexes}.spec.ts` | Deterministic storage regressions |
| New `test/persistence/calendar-migration.spec.ts`, `calendar-migration.native.e2e-spec.ts`, `calendar-multi-storage.native.e2e-spec.ts` | Explicit migration/rollback and isolated replica-set checks |

`v2` is a small typed object facade on the existing concrete adapter, not a second instance or persistence bundle. Keep public legacy signatures intact for unconverted consumers. V2 writes never flow through v1 schemas. Legacy facades must refuse to mutate a v2 row, not downgrade it. After explicit migration or a legacy admission disposition, legacy reservation/dispatch transitions also fail closed; historical reads and matched original-target reconciliation are not new admission. Existing v1 fixtures continue proving the historical codec/state machine, not permission for active Phase 2 execution. P4/P6 own final retirement of old active runtime admission; P2 must not claim that end-to-end gate is complete merely because compatibility getters exist. New v2 `get` methods use compatible decoders and expose the actual `schemaVersion`; callers must branch before execution. P4/P6/P8 choose the v2 ports explicitly.

### Storage protocol fixed by this plan

- Connection revisions: `revision` is whole-document CAS; `connectionRevision` is account/grant/enablement fencing; `credentialVersion` is token-encryption/AAD version; `defaultSetting.defaultSettingRevision` is preference-only. Discovery has its own `discoveryRevision`. A new snapshot uses the winning next document revision as its discovery revision, which remains increasing across cache clearing; preference/token-only writes preserve the existing snapshot byte-for-byte. P4 must obtain/rebase a fresh next revision after a conflict; no automatic replay of a stale replacement document.
- Proposal key is by `(userId, sessionId, proposalId)`. A unique partial index permits one **pending** proposal per `(userId, sessionId)`. Terminal records are bounded history, not current authorization. `getCurrent` returns the pending record only and expires it against the injected server clock; it never reconstructs one from history.
- Internal consumption wrapper in `metadata`: `{schemaVersion:2, kind:'calendar-proposal-consumption', userId, sessionId, proposalId, intentId, authorityExpiresAt, reply: CalendarProposalReply, consumption: CalendarProposalConsumption}`. Define it with **nested P1 schemas**, not copied fields; equality refinements bind wrapper scope/IDs and the actual accepted reply. `authorityExpiresAt` is copied exactly from the proposal's expiry, not extended on consumption. It contains no message text, event content, label or token. Its unique proposal identity preserves each accepted stage. Keep it while the associated intent/operation could be replayed, especially for unresolved effects; no TTL deletion. Returning `existing` prevents duplication but never renews this authority deadline.
- One additional bounded **storage-only** intent reservation in `metadata` fixes `(user,session,intent) → (operation,account,canonical action hash,calendar)` before a consumption CAS. It is not consent, an executable operation, or a new shared contract. Selection and a subsequent conflict disclosure can have **different proposal/consumption records for the same intent and operation**; a unique consumption-by-intent index would incorrectly prevent this valid flow. Task 5 defines the exact reservation codec and nontransactional recovery.
- Consumption order: validate current trusted reply → immutable intent reservation → CAS proposal from `pending` to `consumed` with `consumedBy` and the original reply → idempotently persist the minimal consumption wrapper. If any ACK is uncertain, reread the same records; never consume again with another operation ID. Expiry/tombstoning must repair/confirm the wrapper before removing consumed content. A crash after the intent reservation but before consumption leaves a nonexecutable identity claim, not approval. A crash after consumption is recoverable from the still-consumed proposal. `reserveByIntent` requires persisted final consumed evidence, not merely a caller-supplied `consumption` object.
- Operation order: resolve details/selection → mandatory preflight/any conflict approval (P6) → confirm final consumption → insert the operation at its intent key → exact reread. Do **not** reserve an immutable operation immediately after a selection if a conflict approval may still change its final authorization. A crash before operation insertion leaves the intent reservable **only** under its fixed operation ID/hash/target. A direct explicit request skips proposal consumption, not intent uniqueness. Reservation is not permission to dispatch; P6 performs current rights/preflight/lease/budget checks.
- Supersession is deliberately nontransactional: CAS the expected pending proposal to terminal `superseded`, then insert the new pending record. Concurrent new publishers may produce a safe gap/conflict, never two active proposals. If the replacement cannot be confirmed, return `uncertain`/`conflict`; do not restore the old proposal. Recovery asks anew rather than interpreting historical prose as consent.
- `existing` always returns the stored consumption/operation identity. A caller's newly generated operation ID is not adopted on retry. Changed event/hash/target/account/origin under the same intent fails `IDEMPOTENCY_PAYLOAD_MISMATCH`. A genuinely new accepted request uses a new intent, even if its text happens to match.

## Task 1: Add compatible keys/codecs and reusable deterministic fixtures

**Files:** modify `backend/src/persistence/calendar-records.ts`; create `backend/test/persistence/calendar-multi-fixtures.ts`, `calendar-multi-memory.ts`, `calendar-multi-evidence.spec.ts`.

- [ ] **Write the failing test** in `calendar-multi-evidence.spec.ts`:

```ts
import { expect, it } from 'vitest';
import { compatibleCalendarOperationSchema, compatibleCalendarConnectionSchema }
  from '../../src/contracts/calendar-compatibility.js';
import { decodeCalendar, encodeCalendar, proposalKey, intentOperationKey }
  from '../../src/persistence/calendar-records.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { operationV1, operationV2 } from '../contracts/calendar-multi-fixtures.js';
import { connectionV2 } from './calendar-multi-fixtures.js';

it('round trips both versions without promoting legacy authority', () => {
  for (const value of [operationV1, operationV2]) {
    const encoded = encodeCalendar(compatibleCalendarOperationSchema, value, 'fixture',
      DEFAULT_BUDGETS.maxDocumentBytes);
    expect(decodeCalendar(compatibleCalendarOperationSchema, encoded.doc)).toEqual(encoded.record);
    expect(encoded.record.schemaRevision).toBe(value.schemaRevision);
  }
  const c = connectionV2();
  expect(decodeCalendar(compatibleCalendarConnectionSchema,
    encodeCalendar(compatibleCalendarConnectionSchema, c, 'c', 262144).doc)).toEqual(c);
  expect(proposalKey('u', 's', 'p')).not.toBe(proposalKey('u', 'other', 'p'));
  expect(intentOperationKey('u', 's', 'intent')).not.toBe(intentOperationKey('u', 's', 'other'));
});
```

- [ ] **Run red**, cwd `backend`: `npm test -- test/persistence/calendar-multi-evidence.spec.ts -t "round trips both versions"`. Expect missing owned key/fixture exports, not empty discovery.
- [ ] **Minimum implementation.** Append these keys using existing `key` (already imported by `calendar-records.ts`):

```ts
export const proposalKey = (u: string, s: string, p: string) => key('calendar-proposal', u, s, p);
export const proposalConsumptionKey = (u: string, s: string, p: string) =>
  key('calendar-proposal-consumption', u, s, p);
export const intentOperationKey = (u: string, s: string, i: string) =>
  key('calendar-intent-operation', u, s, i);
export const intentReservationKey = (u: string, s: string, i: string) =>
  key('calendar-intent-reservation', u, s, i);
export const legacyDispositionKey = (u: string, kind: string, id: string) =>
  key('calendar-legacy-disposition', u, kind, id);
```

Create these parsed fixture factories in `calendar-multi-fixtures.ts` (reuse P1's read-only fixture file, never edit it):

```ts
import { calendarConnectionV2Schema } from '../../src/contracts/calendar-discovery.js';
import { calendarProposalSchema, calendarProposalReplySchema } from '../../src/contracts/calendar-authority.js';
import { operationRecordV2Schema } from '../../src/contracts/calendar-operations.js';
import { CALENDAR_SCOPES } from '../../src/contracts/calendar-policy.js';
import { account, at, until, snapshot, proposal, operationV2, hash }
  from '../contracts/calendar-multi-fixtures.js';
import { secretEnvelope } from './calendar-fixtures.js';

export const connectionV2 = () => calendarConnectionV2Schema.parse({ ...account,
  schemaVersion: 2, provider: 'google-calendar', revision: 1, credentialVersion: 1,
  accountEmail: null, enabled: true, status: 'connected',
  credentials: { access: secretEnvelope, refresh: secretEnvelope }, tokenExpiresAt: until,
  grantedScopes: [...CALENDAR_SCOPES], updatedAt: at,
  defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 1 },
  discovery: { ...snapshot, retentionExpiresAt: '2026-10-22T10:10:00.000Z' } });
export const pendingProposal = () => calendarProposalSchema.parse(proposal);
export const acceptedReply = () => calendarProposalReplySchema.parse({ ...account, sessionId: 's',
  proposalId: 'p', expectedProposalRevision: 1, acceptedMessageId: 'followup-message',
  acceptedTurnId: 'followup-turn', canonicalActionHash: hash, conditionFingerprint: hash,
  choiceCalendarId: null, receivedAt: '2026-10-22T10:01:00.000Z', decision: 'accept' });
export const directOperation = () => operationRecordV2Schema.parse(operationV2);
```

Add the following complete memory helper. It preserves per-collection scope, BSON money types and pre/post-write fault distinction. It is a test helper, not a replacement MongoDB implementation or evidence for unique-index semantics (Task 11 supplies those).

```ts
import { isDeepStrictEqual } from 'node:util';
import { BSON, type Db, type Document } from 'mongodb';
import { RecordStore } from '../../src/persistence/store.js';

const copy = <T extends Document>(v: T): T => BSON.deserialize(BSON.serialize(v)) as T;
function compare(a: unknown, b: unknown): number {
  if (isDeepStrictEqual(a, b)) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  if (typeof a === 'string' && typeof b === 'string') return a > b ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a > b ? 1 : -1;
  throw new Error('fixture comparison requires matching scalar types');
}
function field(d: Document, k: string): unknown {
  return k.split('.').reduce<unknown>((v, part) =>
    v && typeof v === 'object' ? (v as Document)[part] : undefined, d);
}
function matches(d: Document, f: Document): boolean {
  return Object.entries(f).every(([k, v]) => {
    if (k === '$or') return (v as Document[]).some(x => matches(d, x));
    const a = field(d, k);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.entries(v).every(([op, b]) => {
        if (op === '$in') return (b as unknown[]).some(x => isDeepStrictEqual(a, x));
        if (op === '$exists') return (a !== undefined) === b;
        if (op === '$gt') return a !== undefined && compare(a, b) > 0;
        if (op === '$gte') return a !== undefined && compare(a, b) >= 0;
        if (op === '$lt') return a !== undefined && compare(a, b) < 0;
        if (op === '$lte') return a !== undefined && compare(a, b) <= 0;
        return isDeepStrictEqual(a, v);
      });
    }
    return isDeepStrictEqual(a, v);
  });
}
export function calendarMemory() {
  const collections = new Map<string, Map<string, Document>>();
  const calls: { collection: string; method: string; filter: Document }[] = [];
  let fault: 'before-write' | 'after-write' | 'read' | null = null;
  const rows = (name: string) => {
    let result = collections.get(name);
    if (!result) { result = new Map(); collections.set(name, result); }
    return result;
  };
  const fail = (phase: typeof fault) => {
    if (fault === phase) { fault = null; throw new Error('fixture acknowledgement unavailable'); }
  };
  const db = { collection(name: string) {
    const data = rows(name);
    return {
      async findOne(filter: Document) {
        calls.push({ collection: name, method: 'findOne', filter }); fail('read');
        const found = [...data.values()].find(d => matches(d, filter));
        return found ? copy(found) : null;
      },
      async updateOne(filter: Document, update: Document) {
        calls.push({ collection: name, method: 'updateOne', filter }); fail('before-write');
        const old = [...data.values()].find(d => matches(d, filter));
        if (!old && update.$setOnInsert) {
          if (data.has(String(filter._id))) throw new Error('duplicate fixture key');
          data.set(String(filter._id), copy(update.$setOnInsert));
        }
        fail('after-write');
        return { acknowledged: true, matchedCount: old ? 1 : 0, upsertedCount: old ? 0 : 1 };
      },
      async replaceOne(filter: Document, next: Document) {
        calls.push({ collection: name, method: 'replaceOne', filter }); fail('before-write');
        const old = [...data.values()].find(d => matches(d, filter));
        if (old) data.set(String(old._id), copy(next));
        fail('after-write');
        return { acknowledged: true, matchedCount: old ? 1 : 0 };
      },
      find(filter: Document) {
        let result = [...data.values()].filter(d => matches(d, filter));
        const cursor = {
          sort(spec: Document) {
            result.sort((a, b) => {
              for (const [k, dir] of Object.entries(spec)) {
                const x = field(a, k), y = field(b, k);
                if (!isDeepStrictEqual(x, y)) return compare(x, y) * Number(dir);
              }
              return 0;
            }); return cursor;
          },
          limit(n: number) { result = result.slice(0, n); return cursor; },
          async toArray() { fail('read'); return result.map(copy); },
        }; return cursor;
      },
    };
  } };
  return { store: new RecordStore(db as unknown as Db, 1000), rows, calls,
    failNext: (phase: NonNullable<typeof fault>) => { fault = phase; } };
}
```

Use equality-field filters for proposal state/revision/time validation before replacement; the helper does not emulate `findOneAndUpdate`. Existing OAuth fixtures already test that method; leave them intact. Comparison explicitly narrows scalars; do not cast production records to `any`.

- [ ] **Run green:** `npm test -- test/persistence/calendar-multi-evidence.spec.ts -t "round trips both versions"`.
- [ ] **Commit:** `test(calendar): add versioned persistence fixtures and scoped record keys`.

## Task 2: Persist v2 connections with independent preference authority

**Files:** modify `backend/src/persistence/calendar-connections.ts`; create `backend/test/persistence/calendar-multi-connections.spec.ts`. Reuse Task 1 fixture files.

- [ ] **Write the failing test:**

```ts
import { expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoCalendarConnections } from '../../src/persistence/calendar-connections.js';
import { calendarMemory } from './calendar-multi-memory.js';
import { connectionV2 } from './calendar-multi-fixtures.js';
import { at, entry } from '../contracts/calendar-multi-fixtures.js';

it('saves and resets a default across restart without fencing an account', async () => {
  const f = calendarMemory();
  const first = connectionV2();
  const a = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  expect((await a.v2.create(first)).outcome).toBe('confirmed');
  const next = { ...first, revision: 2, updatedAt: at,
    defaultSetting: { defaultCalendarId: entry.calendarId, defaultSettingRevision: 2 } };
  expect((await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 1,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1, next })).outcome).toBe('confirmed');
  const b = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  expect(await b.v2.get('u')).toEqual(next);
  expect((await b.v2.compareAndSwap({ userId: 'u', expectedRevision: 1,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1, next })).outcome).toBe('confirmed');
  const reset = { ...next, revision: 3,
    defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 3 } };
  expect((await b.v2.compareAndSwap({ userId: 'u', expectedRevision: 2,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 2, next: reset })).outcome).toBe('confirmed');
  expect((await b.v2.get('u'))?.connectionRevision).toBe(1);
  expect(await b.v2.get('other-user')).toBeNull();
  expect(f.rows('integration_connections').size).toBe(1);
});
```

Add independent assertions that setting the same value advances only document CAS (not setting revision), wrong expected default revision conflicts, a changed default with no setting-revision increment rejects `INVALID_REQUEST`, and a supplied `'primary'` ID fails schema validation (reset is `null`). Default writability validation belongs to P4's fresh capability gate, not a second store-level routing engine.

- [ ] **Run red:** `npm test -- test/persistence/calendar-multi-connections.spec.ts -t "saves and resets a default"`.
- [ ] **Minimum implementation.** Add a facade with these exact signatures, using the frozen port:

```ts
readonly v2: CalendarConnectionStoreV2 = {
  get: userId => this.getCompatible(userId),
  create: record => this.createV2(record),
  compareAndSwap: input => this.compareAndSwapV2(input),
};
```

`getCompatible(userId)` uses `connectionKey`, existing owner/provider filters and `decodeCalendar(compatibleCalendarConnectionSchema, raw)`. Implement `createV2` by the existing v1 create algorithm with `calendarConnectionV2Schema`, revision 1, default-setting revision 1, and an exact compatible reread. An existing v1 owner is a conflict, **not** implicitly migrated. Report `currentDefaultSettingRevision: 0` for v1 conflicts (sentinel means “not yet a v2 setting”, not a stored v2 revision); for v2 use its actual setting revision. Missing/unreadable confirmation is `uncertain`.

`compareAndSwapV2` has `Parameters<CalendarConnectionStoreV2['compareAndSwap']>[0]` input. Parse `next` with the frozen schema; require matching user. Read current compatible record; an exactly equal v2 reread confirms an idempotent retry. A legacy row conflicts; no row is `uncertain`. Compare **all three** expected revisions before validation or write. Run `calendarConnectionTransitionV2Schema.parse({previous: current, next})`, then Task 3's stricter transition validation. Encode with the existing size/money helper. The actual write filter is:

```ts
const filter = { _id: connectionKey(input.userId), userId: input.userId,
  provider: 'google-calendar', schemaVersion: 2, revision: input.expectedRevision,
  connectionRevision: input.expectedConnectionRevision,
  'defaultSetting.defaultSettingRevision': input.expectedDefaultSettingRevision,
  credentialVersion: current.credentialVersion, _revision: raw._revision };
```

Use `replaceOne(filter, doc, store.options())`, no upsert; set `doc._revision = raw._revision + 1`. Catch ambiguous write failures and confirm only by exact compatible reread, returning current document/default revisions on a different saved row. Catch failed confirmation reads and return `uncertain`, never report confirmed merely because a higher revision exists. Keep v1 `get/create/compareAndSwap/putState/consumeState` signatures and tests intact; they must not write over v2 records.

- [ ] **Run green:** `npm test -- test/persistence/calendar-multi-connections.spec.ts test/persistence/calendar-connections.spec.ts test/persistence/calendar-secret-cipher.spec.ts`.
- [ ] **Commit:** `feat(calendar): persist v2 connections with independent default revisions`.

## Task 3: Fence discovery, token and settings races, including lost acknowledgements

**Files:** modify `backend/src/persistence/calendar-connections.ts`, `backend/test/persistence/calendar-multi-connections.spec.ts`.

- [ ] **Write this failing test** in the existing new suite (reuse its imports):

```ts
it('does not let stale discovery or token refresh overwrite a winning preference', async () => {
  const f = calendarMemory();
  const a = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  const first = connectionV2();
  await a.v2.create(first);
  const selected = { ...first, revision: 2,
    defaultSetting: { defaultCalendarId: entry.calendarId, defaultSettingRevision: 2 } };
  await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 1,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1, next: selected });
  const stale = { ...first, revision: 2, discovery: { ...first.discovery!, discoveryRevision: 2 } };
  expect((await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 1,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1, next: stale })).outcome).toBe('conflict');
  const refreshed = { ...selected, revision: 3, discovery: { ...first.discovery!, discoveryRevision: 3 } };
  f.failNext('after-write');
  expect((await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 2,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 2, next: refreshed })).outcome).toBe('confirmed');
  expect(await a.v2.get('u')).toEqual(refreshed);
  const rollbackSnapshot = { ...refreshed, revision: 4, discovery: first.discovery };
  await expect(a.v2.compareAndSwap({ userId: 'u', expectedRevision: 3,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 2, next: rollbackSnapshot }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});
```

Also add this exact rejection matrix, independently instantiating a fresh store for each case:

```ts
it('requires token and authority revisions only for their own mutations', async () => {
  for (const patch of [
    { credentials: { ...connectionV2().credentials!, access: {
      ...connectionV2().credentials!.access!, ciphertext: 'Yg==' } } },
    { credentialVersion: 2 },
    { enabled: false },
    { connectionRevision: 2, discovery: null },
    { discovery: { ...connectionV2().discovery!, complete: false,
      discoveryRevision: 2, limitations: ['provider-error'] } },
  ]) {
    const f = calendarMemory(); const a = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
    const first = connectionV2(); await a.v2.create(first);
    await expect(a.v2.compareAndSwap({ userId: 'u', expectedRevision: 1,
      expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1,
      next: { ...first, revision: 2, ...patch } as ReturnType<typeof connectionV2> }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  }
});
```

Before green add positive rotation (both ciphertexts replaced, `credentialVersion +1`, no other revision changes), disconnect (tokens/discovery removed, enablement false, account revision +1, credential version +1), account replacement (new subject/connection, reset override and discovery, setting revision +1), and fail-before-write/read-unavailable checks. Use `f.failNext('before-write')`: reread sees unchanged row so outcome is conflict, never confirmed. Use `f.failNext('read')` on the confirmation path through a one-shot `vi.spyOn(f.store, 'raw')` rejection after the mutation: outcome must be `uncertain`; remove the spy afterward. A later same-payload retry confirms only if the exact row exists.

Add this storage-boundary test before green; pass invalid plain inputs to the adapter rather than failing in the fixture factory:

```ts
it('rejects oversized count byte lifetime and partial-grant connection writes before storage', async () => {
  const c = connectionV2();
  const entries = Array.from({ length: 100 }, (_, i) => ({ ...entry,
    calendarId: `cal-${i}`, primary: i === 0 }));
  const huge = entries.map((e, i) => ({ ...e, calendarId: `${i}-${'界'.repeat(1019)}`,
    label: '界'.repeat(200), timeZone: '界'.repeat(100) }));
  const invalid = [
    { ...c, discovery: { ...c.discovery!, entries: [...entries, { ...entry, calendarId: 'overflow', primary: false }] } },
    { ...c, discovery: { ...c.discovery!, entries: huge } },
    { ...c, discovery: { ...c.discovery!, expiresAt: '2026-10-22T10:05:00.001Z' } },
    { ...c, grantedScopes: c.grantedScopes.slice(0, -1) },
  ];
  for (const value of invalid) {
    const f = calendarMemory(); const a = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
    await expect(a.v2.create(value)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(f.rows('integration_connections').size).toBe(0);
  }
});
```

- [ ] **Run red:** `npm test -- test/persistence/calendar-multi-connections.spec.ts -t "requires token and authority revisions"`.
- [ ] **Minimum implementation.** In v2 transition validation use deep equality, not `JSON.stringify` ordering, for unchanged encrypted envelopes and snapshots. Translate rejected validation to `AppError('INVALID_REQUEST', 'Invalid persistence record.')`. Apply these predicates after the frozen pair schema:

```ts
const replaced = p.connectionId !== n.connectionId || p.googleSubjectId !== n.googleSubjectId;
const authorityChanged = replaced || p.enabled !== n.enabled || p.status !== n.status
  || !isDeepStrictEqual([...p.grantedScopes].sort(), [...n.grantedScopes].sort());
const tokensChanged = !isDeepStrictEqual(p.credentials, n.credentials);
const discoveryChanged = !isDeepStrictEqual(p.discovery, n.discovery);
const valid = Date.parse(n.updatedAt) >= Date.parse(p.updatedAt)
  && n.connectionRevision === p.connectionRevision + (authorityChanged ? 1 : 0)
  && n.credentialVersion === p.credentialVersion + (tokensChanged ? 1 : 0)
  && (!replaced || tokensChanged)
  && (!authorityChanged || n.discovery === null)
  && (!discoveryChanged || n.discovery === null ||
    (n.discovery.discoveryRevision === n.revision
      && n.discovery.discoveryRevision > (p.discovery?.discoveryRevision ?? 0)
      && Date.parse(n.discovery.fetchedAt) >= Date.parse(p.discovery?.fetchedAt ?? p.updatedAt)))
  && (!(p.discovery?.complete && n.discovery && !n.discovery.complete));
```

For a failed/partial refresh over a complete snapshot, reject replacement; P4 keeps the old snapshot (now honestly stale as its expiry passes) and reports refresh failure separately. A partial snapshot may be stored for a connection without a complete snapshot, with explicit limitations; never merge partial fresh entries into a purportedly complete old set or extend old expiry. Clearing discovery for expiry is permitted, preserving the next `revision` high-water mark. P4 may clear and then store a partial snapshot in two separately confirmed mutations, never hide that transition as a successful complete refresh.

Validate tokens as a pair: if either encrypted token changes, increment `credentialVersion` once and require the non-disconnected next record to contain both access/refresh. Preserve the cipher/AAD logic; P4 must encrypt the **whole pair** under the new version, not copy the old refresh envelope into a different AAD version. No cipher or credential lifecycle redesign here.

Every stale default/discovery/token replacement must conflict after account replacement/disconnect; the filter includes the old account, credential, document and preference revisions. Do not transparently rebase inside the store. Same-account re-consent and health-state policy are P4's orchestration using this port.

- [ ] **Run green:** `npm test -- test/persistence/calendar-multi-connections.spec.ts test/persistence/calendar-connections.spec.ts test/persistence/calendar-secret-cipher.spec.ts`.
- [ ] **Commit:** `fix(calendar): fence cache token and preference writes across connection races`.

## Task 4: Publish one bounded current proposal and supersede safely

**Files:** create `backend/src/persistence/calendar-proposals.ts`, `backend/test/persistence/calendar-multi-proposals.spec.ts`; modify `backend/src/persistence/calendar-records.ts` only for the internal consumption wrapper export used by Tasks 5/6, and `backend/test/persistence/calendar-multi-fixtures.ts` for the connected-memory fixture below.

- [ ] **Write the failing test:**

```ts
import { expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoCalendarProposals } from '../../src/persistence/calendar-proposals.js';
import { pendingProposal, connectedCalendarMemory } from './calendar-multi-fixtures.js';
import { at } from '../contracts/calendar-multi-fixtures.js';

it('supersedes only the expected current proposal in its own session', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
  const first = pendingProposal();
  expect((await store.putCurrent({ expectedProposalId: null, expectedRevision: null,
    proposal: first })).outcome).toBe('confirmed');
  const next = { ...first, proposalId: 'p2', intentId: 'intent2' };
  expect((await store.putCurrent({ expectedProposalId: 'p', expectedRevision: 2,
    proposal: next })).outcome).toBe('conflict');
  expect((await store.putCurrent({ expectedProposalId: 'p', expectedRevision: 1,
    proposal: next })).outcome).toBe('confirmed');
  expect((await store.getCurrent('u', 's'))?.proposalId).toBe('p2');
  expect(await store.getCurrent('u', 'other')).toBeNull();
  expect((await store.putCurrent({ expectedProposalId: null, expectedRevision: null,
    proposal: first })).outcome).toBe('conflict');
});
```

Add exact assertions for >10-minute lifetime, expiry beyond source permission, >16 KiB multibyte content, >20 candidates, nonpending incoming state, and mixed account/target bindings: all reject before driver writes. A missing primary does not itself invalidate a selection proposal; P1's parsed candidate/account binding governs it. Do not add fuzzy matching or accepted-message extraction to storage.

- [ ] **Run red:** `npm test -- test/persistence/calendar-multi-proposals.spec.ts -t "supersedes only the expected"`.
- [ ] **Minimum implementation.** Implement `MongoCalendarProposals implements CalendarProposalStore` with `(store, budgets, clock = Date.now)` constructor. `getCurrent` queries `{kind:'calendar-proposal', userId, sessionId, state:'pending'}`, `limit(2)`; >1 is `PERSISTENCE_ERROR`. Parse with P1, expire against trusted clock and `contentExpiresAt`, otherwise return the pending record. Task 5 supplies tombstoning. Never accept `receivedAt` as a client clock.

`putCurrent` parses P1, requires revision 1/state pending/consumedBy null and creation ≤ clock < expiry. Read the existing connection at `connectionKey`: it must be v2, connected/enabled, fully granted, and match proposal user/connection/subject/account revision; a cached label never supplies account authority. The published discovery revision must match its persisted snapshot, and proposal `contentExpiresAt` must not exceed that snapshot's retention deadline. P6 supplies any stricter availability/result-source deadline; P2 must not extend it. Check exact replay of an already-stored pending proposal first; a terminal/tombstoned same ID cannot be republished. Compare expected ID/revision with the current record; nulls mean no pending proposal. An expected nonnull pair must be supplied together. Supersede with a `replaceOne` CAS on scoped key, pending state, public revision and `_revision`; write `{...old, revision:old.revision+1, state:'superseded'}`. On ACK loss reread exact terminal record; if consumption won, conflict and **do not publish**. Then immutable-upsert the new pending record at `proposalKey`, using `encodeCalendar` bounded by `Math.min(maxDocumentBytes, 16384 + 1024)` for its storage envelope and P1's 16 KiB payload bound. Confirm exact contents and current identity before returning confirmed. The Task 11 pending unique index handles independent concurrent publishers. Duplicate index errors return conflict after scoped reread; network uncertainty with unavailable reread returns uncertain. Do not implement a process-local lock as the only uniqueness mechanism.

Add this exact shared fixture function in `calendar-multi-fixtures.ts`, with imports for `DEFAULT_BUDGETS`, `MongoCalendarConnections`, and `calendarMemory` from their already-named modules:

```ts
export async function connectedCalendarMemory() {
  const f = calendarMemory();
  const connections = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  const saved = await connections.v2.create(connectionV2());
  if (saved.outcome !== 'confirmed') throw new Error('fixture connection did not persist');
  return f;
}
```

Define only the **storage wrapper**, reusing P1 schemas:

```ts
export const proposalConsumptionRecordSchema = z.object({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-proposal-consumption'), userId: idSchema, sessionId: idSchema,
  proposalId: idSchema, intentId: idSchema, authorityExpiresAt: isoDateSchema,
  reply: calendarProposalReplySchema,
  consumption: calendarProposalConsumptionSchema,
}).strict().refine(v => v.userId === v.reply.userId && v.userId === v.consumption.userId
  && v.sessionId === v.reply.sessionId && v.sessionId === v.consumption.sessionId
  && v.proposalId === v.reply.proposalId && v.proposalId === v.consumption.proposalId
  && v.intentId === v.consumption.intentId
  && v.reply.acceptedMessageId === v.consumption.acceptedMessageId
  && v.reply.acceptedTurnId === v.consumption.acceptedTurnId
  && v.reply.canonicalActionHash === v.consumption.canonicalActionHash
  && v.reply.receivedAt === v.consumption.consumedAt
  && Date.parse(v.authorityExpiresAt) > Date.parse(v.consumption.consumedAt));
```

This wrapper is P2's internal codec, not a new shared approval contract. Nested account/fingerprint/expected-revision evidence remains available after content tombstoning.

- [ ] **Run green:** `npm test -- test/persistence/calendar-multi-proposals.spec.ts -t "supersedes only the expected"`.
- [ ] **Commit:** `feat(calendar): store bounded session proposals with fenced supersession`.

## Task 5: Consume once, preserve approval authority, and tombstone without renewal

**Files:** modify `backend/src/persistence/calendar-proposals.ts`, `calendar-records.ts`, `backend/test/persistence/calendar-multi-proposals.spec.ts`.

- [ ] **Write this failing test**, adding `acceptedReply` to the fixture import:

```ts
it('returns the original consumption after racing approvals and restart', async () => {
  const f = await connectedCalendarMemory(); const clock = () => Date.parse('2026-10-22T10:01:00.000Z');
  const a = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  await a.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });
  const reply = acceptedReply();
  const results = await Promise.all([
    a.consume({ reply, operationId: 'op', intentId: 'intent' }),
    a.consume({ reply, operationId: 'losing-operation', intentId: 'intent' }),
  ]);
  const successful = results.filter(r => r.outcome === 'consumed' || r.outcome === 'existing');
  expect(successful).toHaveLength(2);
  expect(new Set(successful.map(r => r.consumption.operationId)).size).toBe(1);
  const b = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  const replay = await b.consume({ reply, operationId: 'third-operation', intentId: 'intent' });
  expect(replay.outcome).toBe('existing');
  if (replay.outcome === 'existing') {
    expect(replay.consumption).toEqual(successful[0].consumption);
    expect(replay.consumption.acceptedMessageId).toBe(reply.acceptedMessageId);
  }
  expect(await b.getCurrent('u', 's')).toBeNull();
});
```

Add a table against fresh pending records: changed session → `wrong-session` or scoped absence → `stale`; changed action hash → `changed-action`; changed condition → `changed-condition`; wrong account/revision/proposal revision/intent → `stale`; expiry at the exact boundary → `expired`; cancel reply → `cancelled`, no consumption wrapper. Add positive candidate-specific `select` and negative generic `accept` of a selection. Add pre/post-write ACK loss: an exact consumed reread returns original consumption, an unavailable read returns uncertain, and no retry changes the winning operation ID.

- [ ] **Run red:** `npm test -- test/persistence/calendar-multi-proposals.spec.ts -t "returns the original consumption"`.
- [ ] **Minimum implementation.** `consume` parses trusted P1 reply and input IDs, loads the scoped record and any existing consumption wrapper. Check the current persisted account as in Task 4, both before mutation and before reporting acceptance; an absent/replaced/disconnected/disabled/reconnect-required account yields `rejected/stale`. For a pending proposal verify current pending identity, server time, `proposalMatchesReply`, and exact supplied `intentId`; refuse a reply timestamp ahead of server clock. Match account/revision/hash/fingerprint before accepting a replay. The reply is trusted evidence from P6, not a model/browser body; storage does not infer “yes”. Connection and proposal documents are not transactional: if the account changes after the last read, the immutable consumption still carries the old account fence and cannot authorize a replacement account; P6/P4 must require current account authority again before reservation/dispatch. Never claim the read/consume pair is cross-document atomic.

For acceptance/select build exactly:

```ts
const consumption = calendarProposalConsumptionSchema.parse({
  userId: p.userId, sessionId: p.sessionId, proposalId: p.proposalId, intentId: p.intentId,
  operationId: reservation.operationId, acceptedMessageId: r.acceptedMessageId,
  acceptedTurnId: r.acceptedTurnId, canonicalActionHash: r.canonicalActionHash,
  calendarId: p.purpose === 'selection' ? r.choiceCalendarId : p.target?.calendarId,
  consumedAt: r.receivedAt,
});
const next = calendarProposalSchema.parse({ ...p, revision: p.revision + 1,
  state: 'consumed', consumedBy: consumption });
```

Before that construction, use this internal codec, composed from P1's account and hash/calendar/ID schemas in `calendar-records.ts`:

```ts
export const calendarIntentReservationSchema = calendarAccountBindingSchema.extend({
  schemaVersion: z.literal(2), kind: z.literal('calendar-intent-reservation'),
  sessionId: idSchema, intentId: idSchema, operationId: idSchema,
  canonicalActionHash: sha256Schema, calendarId: calendarCanonicalIdSchema,
}).strict();
```

Insert the proposed reservation at `intentReservationKey` using `encodeCalendar`, immutable upsert and reread. If one exists, require matching account/connection/hash/calendar and reuse **its** operation ID, not the new offered ID; mismatches reject. An unconfirmed insert cannot proceed to consumption. A reservation by itself cannot authorize `reserveByIntent` on a proposal-based request. It is retained to avoid changing operation identity after a crash, and contains no labels or event content. This small extra metadata record is necessary for multi-stage consent without a transaction; it is not a second authority service.

Build its payload from `p`'s account fields, `r.canonicalActionHash`, and the selected candidate's canonical ID (or the resolved target for nonselection); never use a selection proposal's null root hash. A `details` proposal without a complete target/action cannot be consumed into an operation; it must be replaced by P6's completed validated proposal first.

CAS pending to consumed with original proposal/revision/account/_revision fields. The next record is the linearization point. Reread if another consumer won; return **its** consumption when the immutable reply authority agrees, even if the losing caller offered another operation ID. Persist the wrapper at `proposalConsumptionKey` with immutable insert and reread before `consumed`/`existing` is reported, copying `authorityExpiresAt = p.expiresAt` exactly. Crash repair reads `consumedBy` plus the originally accepted reply; retain that reply in the same stored document's bounded `_calendarApproval` envelope at the consumption CAS. Extend `encodeCalendar` extras and `decodeCalendar` destructuring with `_calendarApproval?: CalendarProposalReply`, validating it with the P1 schema and consumed record's scope/hash/accepted IDs; it is storage-only and is stripped before P1 payload parse. Without this simultaneous small envelope field the accepted reply could be lost between CAS and wrapper persistence—do not reconstruct its fingerprint/revision from free-form history. The wrapper copies this exact evidence. A later proposal for the same intent may add a separate approval wrapper only for the same reserved operation/account/hash/calendar; it must not overwrite an earlier accepted-message link. After expiry an exact consumed replay may return `existing` for deduplication, but cannot authorize a new reservation/dispatch or extend `authorityExpiresAt`.

Add this exact multi-stage regression before green (imports `calendarProposalSchema` and `hash` from their existing P1 modules):

```ts
it('keeps selection and conflict approvals on one intent operation', async () => {
  const f = await connectedCalendarMemory(); const clock = () => Date.parse('2026-10-22T10:01:00.000Z');
  const a = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  const p = pendingProposal();
  const selection = calendarProposalSchema.parse({ ...p, purpose: 'selection', target: null,
    canonicalActionHash: null, action: { ...p.action!, calendarId: undefined },
    conditionFingerprint: null, availabilityRevision: null, disclosedLimitations: [],
    candidates: [{ target: p.target, canonicalActionHash: hash }] });
  await a.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: selection });
  const first = await a.consume({ reply: { ...acceptedReply(), decision: 'select',
    conditionFingerprint: null, choiceCalendarId: p.target!.calendarId },
    operationId: 'selected-op', intentId: 'intent' });
  expect(first.outcome).toBe('consumed');
  await a.putCurrent({ expectedProposalId: null, expectedRevision: null,
    proposal: { ...p, proposalId: 'conflict-p' } });
  const second = await a.consume({ reply: { ...acceptedReply(), proposalId: 'conflict-p',
    acceptedMessageId: 'conflict-message', acceptedTurnId: 'conflict-turn' },
    operationId: 'must-not-be-used', intentId: 'intent' });
  expect(second.outcome).toBe('consumed');
  if (second.outcome === 'consumed') {
    expect(second.consumption.operationId).toBe('selected-op');
    expect(second.consumption.acceptedMessageId).toBe('conflict-message');
  }
  expect([...f.rows('metadata').values()].filter(d => d.kind === 'calendar-proposal-consumption'))
    .toHaveLength(2);
});
```

Cancellation CASes to terminal `cancelled` and returns `rejected/cancelled`; it never creates an operation link. A consumed record can never be reactivated, cancelled or superseded as pending. New same-session requests use a new proposal ID. Terminal/tombstone lookup is by exact ID, not “latest message”.

Implement `tombstone({expectedRevision,tombstone})` by scoped ID lookup, P1 parse and CAS replacement of the proposal payload at **the same `_id`**. Validate identity/intent and revision +1. Pending records may expire/cancel/supersede/disconnect/redact but cannot claim consumed. A consumed record first repairs/confirms its wrapper and then requires tombstone operation/hash to equal `consumedBy`. Preserve unknown-operation linkage; an `unresolvedOperation:true` tombstone requires operation ID. Strip `_calendarApproval` only after the wrapper is confirmed. Exact tombstone reread confirms a lost ACK; a different row conflicts; failed reread is uncertain. A null read never authorizes recreation.

- [ ] **Run green:** `npm test -- test/persistence/calendar-multi-proposals.spec.ts test/contracts/calendar-multi-authority.spec.ts`.
- [ ] **Commit:** `feat(calendar): consume proposal authority once and retain replay-safe tombstones`.

## Task 6: Reserve one immutable operation per accepted intent across turns

**Files:** modify `backend/src/persistence/calendar-operations.ts`; create `backend/test/persistence/calendar-multi-operations.spec.ts`.

- [ ] **Write this failing test:**

```ts
import { expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoCalendarOperations } from '../../src/persistence/calendar-operations.js';
import { directOperation, connectedCalendarMemory } from './calendar-multi-fixtures.js';

it('keeps one intent operation and rejects cross-turn retargeting', async () => {
  const f = await connectedCalendarMemory(); const a = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS);
  const op = directOperation();
  expect((await a.v2.reserveByIntent({ operation: op, consumption: null })).outcome).toBe('created');
  const b = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS);
  expect(await b.v2.getByIntent('u', 's', 'intent')).toEqual(op);
  expect((await b.v2.reserveByIntent({ operation: { ...op, originatingAttemptId: 'retry-attempt' },
    consumption: null })).outcome).toBe('existing');
  await expect(b.v2.reserveByIntent({ operation: { ...op, calendarId: 'other',
    calendarLabel: null, labelExpiresAt: null, actionSources: [], action: { ...op.action!, calendarId: 'other' } },
    consumption: null })).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  expect(await b.v2.getByIntent('u', 'other-session', 'intent')).toBeNull();
  const dispatched = { ...op, revision: 2, sequence: op.sequence + 1, state: 'dispatching' as const };
  expect((await b.v2.compareAndSwap({ expectedRevision: 1, next: dispatched })).outcome).toBe('confirmed');
  const unknown = { ...dispatched, revision: 3, sequence: dispatched.sequence + 1, state: 'unknown' as const };
  expect((await b.v2.compareAndSwap({ expectedRevision: 2, next: unknown })).outcome).toBe('confirmed');
  await expect(b.v2.compareAndSwap({ expectedRevision: 3,
    next: { ...unknown, revision: 4, sequence: unknown.sequence + 1, state: 'dispatching' } }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});
```

Add an actual cross-turn proposal reservation: consume Task 5 reply, construct an operation with `turnId/authorization.acceptedTurnId = reply.acceptedTurnId`, originating fields from the proposal, authorization basis `conflict-acceptance`, proposal ID/fingerprint, and the **consumption's** operation/hash/calendar. Missing/unpersisted/forged consumption rejects before insertion. Retrying from another accepted turn returns the stored intent operation only if its canonical intent/account/target/action agrees; never overwrite its original accepted-turn authorization. A request with a new intent and new turn can reserve independently. Same turn with a second intent must conflict via the turn index; no multiple creates in one accepted turn.

- [ ] **Run red:** `npm test -- test/persistence/calendar-multi-operations.spec.ts -t "keeps one intent operation"`.
- [ ] **Minimum implementation.** Add `v2: CalendarOperationStoreV2` delegating to new concrete `getCompatibleByTurn`, `getByIntent`, `reserveByIntent`, `compareAndSwapV2` methods. Intent writes use `intentOperationKey`, **not** the legacy turn key. `getCompatibleByTurn` uses a scoped indexed query with `limit(2)` to find either key/version; duplicate rows fail closed. Legacy `getByTurn` remains v1-only for legacy consumers.

`reserveByIntent` validates planned/revision1/sequence≥0/retries0 using P1's v2 schema. Before **new** reservation require the current durable connection/account fence to match; do not retarget on failure. For nonexplicit authorization, compare all consumption/operation/origin/account/hash/target/accepted IDs and fingerprint with the persisted **final** Task 5 wrapper, intent reservation and consumed proposal or tombstone. Require server clock < `authorityExpiresAt` for a new reservation; an existing operation can still be returned for reconciliation without renewing authorization. Add optional third constructor argument `clock: () => number = Date.now` to the existing operation adapter and inject the fixture time in proposal-based tests. Caller-supplied consumption alone is not authority. Reserve only after P6's final preflight/approval, not between selection and a possible conflict pause. For direct explicit requests require `consumption === null`, no proposal ID/condition override, and origin fields that P6 derived from accepted input; immutable-upsert the same Task 5 intent reservation before operation insertion, requiring its operation ID to match any existing claim. Runtime acceptance verification remains P6; no browser/model consent flag is accepted here. Include an exact-boundary test: consumed wrapper expiry reached, no operation yet → `INVALID_REQUEST`, no operation insert; same expired wrapper with an already-reserved unknown operation → return that existing identity only.

First read the existing intent key. Return existing only when immutable canonical authority agrees; permit a different retry-attempt ID without replacing the original. Normalize a follow-up retry to the stored authorization for comparison **only after** its originating intent/action/account/target and persisted approval evidence match; new follow-up message text is not identity. Otherwise throw `IDEMPOTENCY_PAYLOAD_MISMATCH`. Insert using existing bounded immutable-upsert/money codec, no transaction; reread and return stored identity. Missing/unreadable ACK is uncertain. Check legacy turn operations/dispositions before insertion: a v1 turn cannot be promoted into a v2 create, and unresolved same-session v1 effects block new v2 create admission until original reconciliation. Do not reinterpret a new intent as permission to evade quarantine.

For v2 CAS run the P1 transition pair plus these allowed edges:

```ts
const edges: Record<CalendarOperationV2['state'], readonly CalendarOperationV2['state'][]> = {
  planned: ['dispatching', 'definitely-failed', 'failed', 'cancelled', 'evidence-expired'],
  dispatching: ['succeeded', 'definitely-failed', 'unknown'],
  unknown: ['succeeded', 'definitely-failed'],
  succeeded: ['evidence-expired'], 'definitely-failed': ['evidence-expired'],
  failed: ['evidence-expired'], cancelled: ['evidence-expired'], 'evidence-expired': [],
};
```

Require sequence exactly +1, updatedAt nondecreasing, retry count nondecreasing (and unchanged for ordinary v2 creates), immutable created/audit deadlines and canonical action until one-way privacy removal. An exact same-record retry confirms without another transition. Receipt success can only come from a matching v2 receipt; no replacement except deterministic privacy scrub in Task 9. No v2 dispatching→dispatching insert retry or unknown→dispatching replay. A same-state CAS is permitted only for Task 9's deterministic redaction. Original calendar/account/connection/event/intent/hash/authorization never changes, including after default changes and account replacement. A reservation read must not bind to the current connection/default.

- [ ] **Run green:** `npm test -- test/persistence/calendar-multi-operations.spec.ts test/persistence/calendar-operations.spec.ts test/contracts/calendar-multi-operations.spec.ts`.
- [ ] **Commit:** `feat(calendar): reserve pinned operations by durable cross-turn intent`.

## Task 7: Read/write v2 decisions, results and checkpoint references without v1 laundering

**Files:** modify `backend/src/persistence/calendar-evidence.ts`, `calendar-records.ts`, `calendar-checkpoints.ts`; extend `backend/test/persistence/calendar-multi-evidence.spec.ts`, `calendar-checkpoints.spec.ts`.

- [ ] **Write this failing test** in `calendar-multi-evidence.spec.ts` (add the shown imports):

```ts
import { MongoCalendarDecisions, MongoCalendarResults } from '../../src/persistence/calendar-evidence.js';
import { calendarToolResultRecordV2Schema } from '../../src/contracts/calendar-sources.js';
import { resumableDecisionV2Schema } from '../../src/contracts/calendar-model.js';
import { sourceV2, event, entry, at, until } from '../contracts/calendar-multi-fixtures.js';
import { calendarMemory } from './calendar-multi-memory.js';

it('preserves versioned provenance and tombstones expired v2 result content', async () => {
  const f = calendarMemory(); let now = Date.parse(at);
  const results = new MongoCalendarResults(f.store, DEFAULT_BUDGETS, () => now);
  const decisions = new MongoCalendarDecisions(f.store, DEFAULT_BUDGETS, () => now);
  const r = calendarToolResultRecordV2Schema.parse({ schemaVersion: 2, kind: 'calendar-tool-result',
    userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', eventId: 'e',
    sequence: 1, toolCallId: 'call', createdAt: at, resultRef: { storage: 'retained', source: sourceV2,
      toolCallId: 'call', operationId: 'op', result: { schemaVersion: 2, tool: 'calendar_get_event', event,
        target: { calendarId: entry.calendarId, calendarLabel: entry.label,
          discoveryRevision: 1, privateAccess: true } } } });
  await results.v2.put(r);
  expect(await results.v2.get('u', 's', 'call')).toEqual(r);
  const d = resumableDecisionV2Schema.parse({ schemaVersion: 2, kind: 'calendar-model-decision',
    userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch',
    configRevision: 1, connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v2',
    rejectedDecisionId: null, decision: null, sources: [sourceV2], operationId: 'op',
    intentId: 'intent', proposalId: 'p', createdAt: at });
  await decisions.v2.put(d);
  now = Date.parse(until);
  const expired = await results.v2.get('u', 's', 'call');
  expect(expired?.resultRef.storage).toBe('tombstone');
  expect(JSON.stringify(expired)).not.toContain('Team');
  expect(JSON.stringify(expired)).not.toContain('Visit');
  expect((await decisions.v2.get('u', 'd'))?.decision).toBeNull();
});
```

Append this checkpoint test; keep existing v1 export/type stable so `agent/state.ts` does not require an out-of-scope edit:

```ts
it('accepts scoped v2 references without admitting content or upgrading v1 refs', () => {
  const v2 = { version: 2, userId: 'u1', sessionId: 's1', turnId: 't1', decisionIds: ['d'],
    toolCallIds: ['call'], operationId: 'op', intentId: 'intent', proposalId: 'p',
    connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v2' };
  expect(() => assertCalendarCheckpointSafe({ channel_values: { calendarRefs: v2 } }, scope)).not.toThrow();
  expect(() => assertCalendarCheckpointSafe([['calendarRefs', { ...v2, action: {} }]], scope)).toThrow();
  expect(() => assertCalendarCheckpointSafe({ calendarRefs: { ...v2, sessionId: 'other' } }, scope)).toThrow();
  expect(calendarCheckpointRefsSchema.parse(refs()).version).toBe(1);
});
```

- [ ] **Run red:** `npm test -- test/persistence/calendar-multi-evidence.spec.ts -t "preserves versioned provenance"` and then `npm test -- test/persistence/calendar-checkpoints.spec.ts -t "accepts scoped v2 references"`.
- [ ] **Minimum implementation.** Add `.v2` facades typed `CalendarDecisionStoreV2` and `CalendarResultStoreV2` to existing instances. Reuse deterministic keys and immutable insert checks. V2 puts validate **only** their explicit v2 schema; compatible getters parse with `compatibleCalendarDecisionSchema`/`compatibleCalendarResultRecordSchema`. Preserve rejected-decision diagnostic-only validation and no raw JSON/reasoning/token payload. Versions share existing keys, so the same decision/result identity cannot be rewritten under another version. Do not copy v2 results through a v1 `resultRef` or source.

Extend redaction functions in `calendar-records.ts` with overloads accepting original types and compatible unions; keep original caller return types. For v2 expired/redacted sources, clear target labels to `null`, preserve IDs/revisions/tool/operation links, set `redactedAt`, clear decision content, and convert retained result to the P1 v2 tombstone. Branch on `schemaVersion` and parse the appropriate schema; no `as` cast that erases a v2 source into a v1 slot. V1 behavior remains unchanged.

In `calendar-checkpoints.ts` remove its duplicate local v1 declaration, import/re-export P1 `calendarCheckpointRefsV1Schema as calendarCheckpointRefsSchema`, export `calendarCheckpointRefsV2Schema`, and use `compatibleCalendarCheckpointRefsSchema` **inside both walker validation sites**. Preserve node/depth bounds, blocked keys and scoping. Decoding/persisting a v1 reference is not permission to resume its effect; Task 10/P6 handle dispositions. The standard saver, its serialization and indexes remain untouched.

- [ ] **Run green:** `npm test -- test/persistence/calendar-multi-evidence.spec.ts test/persistence/calendar-evidence.spec.ts test/persistence/calendar-checkpoints.spec.ts test/persistence/calendar-records.spec.ts`.
- [ ] **Commit:** `feat(calendar): persist versioned evidence and compatible checkpoint references`.

## Task 8: Extend dispatch storage without resetting budgets or double counting

**Files:** modify `backend/src/persistence/calendar-accounting.ts`; create `backend/test/persistence/calendar-multi-accounting.spec.ts`; extend owned `backend/test/persistence/calendar-accounting-reporting.spec.ts` only for the mixed-version assertion.

- [ ] **Write the failing test:**

```ts
import { expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { modelDispatchV2Schema } from '../../src/contracts/calendar-accounting.js';
import { MongoCalendarAccounting } from '../../src/persistence/calendar-accounting.js';
import { calendarMemory } from './calendar-multi-memory.js';
import { budget, dispatch, turnWindowNow } from './calendar-fixtures.js';

it('shares original budget claims across v1 and v2 dispatches and restarts', async () => {
  const f = calendarMemory(); const clock = () => Date.parse(turnWindowNow);
  const a = new MongoCalendarAccounting(f.store, DEFAULT_BUDGETS, undefined, clock);
  await a.createBudget(budget()); await a.putDispatch(dispatch());
  const second = modelDispatchV2Schema.parse({ ...dispatch(), schemaVersion: 2,
    schemaRevision: 'google-calendar.v2', dispatchId: 'd2', decisionId: 'dec2', dispatchIndex: 2,
    reason: 'schema-repair', repairedDecisionId: 'dec1' });
  await a.v2.putDispatch(second); await a.v2.putDispatch(second);
  const b = new MongoCalendarAccounting(f.store, DEFAULT_BUDGETS, undefined, clock);
  expect(await b.v2.createBudget(budget())).toMatchObject({ modelDispatches: 2, repairs: 1,
    reservedUsd: '0.5', settledUsd: '0', deadlineAt: budget().deadlineAt });
  expect((await b.v2.listDispatches('u1', 't1')).map(d => d.schemaVersion)).toEqual([1, 2]);
  await expect(b.v2.putDispatch({ ...second, reservationUsd: '0.1' }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});
```

In `calendar-accounting-reporting.spec.ts` add a second test using its existing `fixture`, `pluginDispatch`, `knownMoney`, `range`, `now`: change only the second dispatch's `schemaVersion:2, schemaRevision:'google-calendar.v2'`, include the same legacy attempt accounting row and the aggregate. Assert `reportedTotal === '0.3'`, dispatch count 2, and no added legacy `0.9`. No `metadata.ts` edits are planned; its aggregation is kind-based and should remain correct. A failure there is an explicit ownership request, not permission to change it.

- [ ] **Run red:** `npm test -- test/persistence/calendar-multi-accounting.spec.ts -t "shares original budget claims"`.
- [ ] **Minimum implementation.** Introduce a local dispatch union type (`CalendarModelDispatch | CalendarModelDispatchV2`) for existing internal fingerprint/evolution/claim/money functions, parse reads through `compatibleCalendarDispatchSchema`, and choose an explicit schema on writes. Add `v2: CalendarAccountingStoreV2` forwarding unchanged budget/aggregate methods and the v2 dispatch writer/compatible getters. Keep legacy public method return signatures by v1 schema/type checking, not widening foreign consumers. Internal reconciliation/listAttemptAccounting/aggregate computation must see **both** versions, or legacy public filtering would drop a held v2 reservation. Add private `getDispatchCompatible(userId,dispatchId)`, `listDispatchesCompatible(userId,turnId)` and `putDispatchVersioned(record)` methods, used by internal reservation confirmation, reconciliation, money recomputation and the v2 facade. The existing legacy methods call those methods but admit/return only their original types; no internal v2 save-confirmation may call the legacy getter.

Keep `turnBudgetRecordSchema`, `modelAggregateSchema`, claim bound 8, unique dispatch identity/index, exact Decimal128 money codec, spend arithmetic, repair counters, deadline and legacy preference logic. Include schema revision/version in immutable dispatch comparison. A v1→v2 relabel at an existing dispatch key rejects. Unknown dispatched cost holds its reservation; only proven nondispatch releases it. Every added Calendar request consumes the existing persisted `calendarRequests`; no new budget document per proposal or retry. Request-category selection is P6/P3, not a second accounting accumulator. Apply exact-reread confirmation on dispatch mutation ACK loss without releasing a hold or charging twice.

- [ ] **Run green:** `npm test -- test/persistence/calendar-multi-accounting.spec.ts test/persistence/calendar-accounting.spec.ts test/persistence/calendar-accounting-reporting.spec.ts`.
- [ ] **Commit:** `feat(calendar): preserve mixed-version dispatch budgets and accounting totals`.

## Task 9: Expire content with bounded sweeps while preserving unknown effects

**Files:** modify `backend/src/persistence/calendar-retention.ts`, `calendar-records.ts`, `calendar-proposals.ts`, `calendar-operations.ts`; create `backend/test/persistence/calendar-multi-retention.spec.ts`. Tests stay Calendar-prefixed; generic messages/store source remains read-only.

- [ ] **Write the failing test:**

```ts
import { expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoCalendarRetention } from '../../src/persistence/calendar-retention.js';
import { MongoCalendarProposals } from '../../src/persistence/calendar-proposals.js';
import { MongoCalendarOperations } from '../../src/persistence/calendar-operations.js';
import { directOperation, pendingProposal, acceptedReply, connectedCalendarMemory } from './calendar-multi-fixtures.js';
import { at } from '../contracts/calendar-multi-fixtures.js';

it('expires proposal content without erasing consumed intent or unknown-operation quarantine', async () => {
  const f = await connectedCalendarMemory(); let now = Date.parse('2026-10-22T10:01:00.000Z');
  const proposals = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, () => now);
  await proposals.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });
  await proposals.consume({ reply: acceptedReply(), operationId: 'proposal-op', intentId: 'intent' });
  const operations = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS);
  const op = { ...directOperation(), intentId: 'different-intent', operationId: 'op',
    originatingTurnId: 'direct-origin', originatingAcceptedMessageId: 'direct-message' };
  await operations.v2.reserveByIntent({ operation: op, consumption: null });
  const dispatched = { ...op, revision: 2, sequence: op.sequence + 1, state: 'dispatching' as const };
  await operations.v2.compareAndSwap({ expectedRevision: 1, next: dispatched });
  const unknown = { ...dispatched, revision: 3, sequence: dispatched.sequence + 1, state: 'unknown' as const };
  await operations.v2.compareAndSwap({ expectedRevision: 2, next: unknown });
  now = Date.parse('2026-10-22T10:10:00.000Z');
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS, () => now);
  await retention.sweepMultiCalendarPage({ userId: 'u', now: new Date(now).toISOString(),
    cursor: null, limit: 20 });
  expect(await proposals.getCurrent('u', 's')).toBeNull();
  expect((await proposals.consume({ reply: acceptedReply(), operationId: 'new-op', intentId: 'intent' })).outcome)
    .toBe('existing');
  const saved = await operations.v2.getByIntent('u', 's', 'different-intent');
  expect(saved).toMatchObject({ state: 'unknown', operationId: 'op', calendarId: op.calendarId,
    googleEventId: op.googleEventId, action: null, calendarLabel: null });
  expect(saved?.requestHash).toBe(op.requestHash);
  expect(at).not.toBe(new Date(now).toISOString());
});
```

Add 21+ records and page size 1 fixtures: each sweep returns a cursor; following cursors visits later records (not the same first page); pages are byte/count bounded and no unbounded `toArray`. Add disconnect cleanup scoped by user **and original connection ID/revision**, preserving another account's snapshot. Add successful v2 receipt expiry: calendar label/link/action/source labels disappear, but `succeeded`, event/operation/calendar IDs and request hash remain. User-authored message content is never redacted merely for mentioning a calendar.

- [ ] **Run red:** `npm test -- test/persistence/calendar-multi-retention.spec.ts -t "expires proposal content"`.
- [ ] **Minimum implementation.** Add `sweepMultiCalendarPage({userId,now,cursor,limit})` to the existing retention instance. Cursor is a bounded base64url strict object `{v:2,userId,collection:'metadata'|'integration_connections',after:string}`, scoped and length-limited to 2048; use `_id:{$gt:after}` with deterministic sort and `limit +1`. Do not persist arrays of swept IDs. Iterate the two existing collections in cursor order; inspect only Calendar kinds and the provider-scoped connection. No new cron/background owner is introduced. P8 schedules/calls the existing retention lifecycle.

Use the P1 proposal/tombstone schemas and Task 5 method, one-way redaction, and exact CAS. Expire pending proposals at the earlier approved content/authority deadline, redact terminal proposals to tombstones, preserve minimal consumed wrappers and operation links. Mark unresolved linkage conservatively when operation outcome is absent/unknown/dispatching; never delete that deduplication authority due to proposal TTL. Distinguish cache freshness from retention: a stale snapshot may be displayed as stale until `retentionExpiresAt`; clear its content at retention expiry using a connection CAS that leaves tokens/default/account revision unchanged. Never extend expiry during failed refresh or cleanup.

Generalize existing source registration's local wrapper using the P1 v1/v2 nested source schemas; keep its `calendar-source` kind/key and exact no-extension retention rule. Extend its existing sweep and derived Calendar cleanup to compatible result/decision schemas and honor their cursor instead of repeatedly scanning the first 50. Keep v1 transcript behavior intact; any need to admit v2 message provenance into `contracts/message.ts` belongs to P1/P6 and is not silently cast here.

Add `redactCalendarOperation(record, nowMs)` to `calendar-records.ts`, overloaded for v1/v2. For v2, remove expired source labels/content, clear action if any supporting source has expired, and remove receipt/name/link content only through this deterministic privacy transform. Keep action-less direct requests until their existing audit deadline; no unsupported claim that all user-created details have a Calendar-source TTL. If a source-backed `dispatching` operation needs action removal, CAS it to `unknown` (never to definitely-failed) and retain original reconciliation identity; P6 must observe that revision fence before finalization. Completed receipts keep minimal success evidence, never get retargeted, and can only lose fields through this transform. Validate the resulting record using P1 and allow only that exact same-state/dispatching→unknown privacy transition in the operation adapter. No provider call is made by cleanup.

`expireAuditPage` must continue preserving unresolved v1/v2 operation identities even beyond ordinary audit expiry. Do not emit a fake failed/succeeded result, delete an intent key, or implement broad TTL deletion. For resolved operations, only redact content within existing policy; keep minimal deduplication evidence rather than introducing an unapproved new operation-tombstone schema. Record the retained minimal-evidence ceiling and source policy in the worker handoff.

- [ ] **Run green:** `npm test -- test/persistence/calendar-multi-retention.spec.ts test/persistence/calendar-retention.spec.ts test/persistence/calendar-records.spec.ts test/persistence/calendar-multi-proposals.spec.ts test/persistence/calendar-multi-operations.spec.ts`.
- [ ] **Commit:** `fix(calendar): expire multi-calendar content without dropping effect authority`.

## Task 10: Explicit versioned migration and fail-closed rollback assessment

**Files:** create `backend/src/persistence/calendar-migration.ts`, `backend/test/persistence/calendar-migration.spec.ts`; modify `calendar-connections.ts`, `calendar-operations.ts` only for the explicit entry/lookup methods described here. No bootstrap or standalone migration script.

- [ ] **Write the failing test:**

```ts
import { expect, it } from 'vitest';
import { projectLegacyCalendarConnection, assessCalendarRollback }
  from '../../src/persistence/calendar-migration.js';
import { compatibleCalendarConnectionSchema, legacyOperationDisposition }
  from '../../src/contracts/calendar-compatibility.js';
import { connection } from './calendar-fixtures.js';
import { operationV1, receiptV1, at } from '../contracts/calendar-multi-fixtures.js';

it('migrates only an explicit legacy pin and quarantines unknown legacy effects', () => {
  const old = connection(); const migrated = projectLegacyCalendarConnection(old, at);
  expect(migrated).toMatchObject({ schemaVersion: 2, revision: old.revision + 1,
    connectionRevision: old.connectionRevision + 1, credentialVersion: old.credentialVersion,
    status: 'reconnect-required', discovery: null,
    defaultSetting: { defaultCalendarId: old.calendarId, defaultSettingRevision: 1 } });
  expect(migrated.credentials).toEqual(old.credentials);
  expect(migrated.grantedScopes).toEqual(old.grantedScopes);
  expect(compatibleCalendarConnectionSchema.parse(old)).toEqual(old);
  expect(legacyOperationDisposition({ ...operationV1, state: 'unknown' }, at))
    .toMatchObject({ state: 'cancelled', externalOutcome: 'unknown', reconcileOriginal: true });
  expect(legacyOperationDisposition({ ...operationV1, state: 'succeeded', receipt: receiptV1 }, at)).toBeNull();
  expect(assessCalendarRollback({ admissionStopped: false, executorDrained: true,
    pageComplete: true, v2Records: 0, unresolvedEffects: 0 }).outcome).toBe('blocked');
  expect(assessCalendarRollback({ admissionStopped: true, executorDrained: true,
    pageComplete: true, v2Records: 1, unresolvedEffects: 0 }).outcome).toBe('preserve-v2-read-only');
});
```

Add store tests seeding v1 rows via existing v1 adapter/fixture: plain `v2.get` changes nothing; `v2.create` conflicts; explicit `migrateLegacy({userId,expectedRevision,expectedConnectionRevision,legacy,now,admissionStopped:true,executorDrained:true})` migrates exactly once, wrong revision conflicts, failure-before-write leaves old row, failure-after-write confirms exact row, retry confirms same projection. `legacy` is the exact P1-parsed old record supplied by the explicit maintenance caller, not a new schema; it makes a later retry's intended projection exactly reconstructible. Scan legacy operations/decision/checkpoint fixture references page-by-page to record deterministic `CalendarLegacyDisposition` rows; completed v1 operation/receipt remains byte-equivalent. A legacy `calendarId:'primary'` projection rejects rather than inventing canonical identity. Account/default migration never reads `process.env.AURVIN_GOOGLE_CALENDAR_TARGET_ID`.

Also add this exact encryption regression, importing `CalendarSecretCipher` from `../../src/platform/crypto/calendar-secret-cipher.js` (no changes to that source):

```ts
it('keeps the original token AAD decryptable after explicit schema migration', () => {
  const cipher = new CalendarSecretCipher({ status: 'ready', key: Buffer.alloc(32, 7) });
  const old = connection();
  const aad = { version: 1 as const, userId: old.userId, provider: old.provider,
    connectionId: old.connectionId, credentialVersion: old.credentialVersion,
    googleSubjectId: old.googleSubjectId, tokenKind: 'refresh' as const };
  const encrypted = cipher.sealToken(aad, 'fixture-refresh-token');
  const migrated = projectLegacyCalendarConnection({ ...old,
    credentials: { access: null, refresh: encrypted } }, at);
  expect(cipher.openToken({ ...aad, credentialVersion: migrated.credentialVersion },
    migrated.credentials!.refresh)).toBe('fixture-refresh-token');
  expect(migrated.credentials!.refresh).toEqual(encrypted);
  expect(() => cipher.openToken({ ...aad, googleSubjectId: 'replacement-account' }, encrypted)).toThrow();
});
```

The actual token AAD includes version, user/provider/connection/credential version/subject/token kind, **not** `connectionRevision` or record `schemaVersion`. Thus the migration's account fencing bump does not require decrypting/re-encrypting the preserved envelopes. Do not bump AAD version merely because the storage schema becomes v2.

- [ ] **Run red:** `npm test -- test/persistence/calendar-migration.spec.ts -t "migrates only an explicit legacy pin"`.
- [ ] **Minimum implementation.** Implement the pure connection projection with this exact shape (existing v1 schema parse first; then P1 v2 parse):

```ts
export function projectLegacyCalendarConnection(old: CalendarConnectionRecord, now: string): CalendarConnectionRecordV2 {
  const p = connectionRecordSchema.parse(old);
  const { calendarId, targetRevision, ...rest } = p;
  void targetRevision;
  if (calendarId === 'primary' || Date.parse(now) < Date.parse(p.updatedAt))
    throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
  return calendarConnectionV2Schema.parse({ ...rest, schemaVersion: 2, revision: p.revision + 1,
    connectionRevision: p.connectionRevision + 1,
    status: p.status === 'disconnected' ? 'disconnected' : 'reconnect-required',
    updatedAt: now, defaultSetting: { defaultCalendarId: calendarId, defaultSettingRevision: 1 }, discovery: null });
}
```

Keep old scopes, encrypted envelopes, token expiry, account ID and credential/AAD version unchanged. Migration is **not re-consent** and cannot certify the grant. New installations use null override; old installations retain their actual persisted pin as an explicit override. P4 reconnect decides whether it is still valid; unavailable default does not fall back silently. A disconnected historical pin may remain a preference but is not executable until same-account validation; account replacement resets it.

Implement concrete `migrateLegacy` as a named explicit method on `MongoCalendarConnections`, outside the frozen normal v2 port. Validate the operator/orchestrator preconditions and exact legacy input scope/revisions, read exact legacy version/revisions, require deep equality with that supplied old record, encode the projection and replace with a v1-version/_revision/revision/account filter, no upsert. It never runs from `get`, normal CAS, `createPersistenceBundle` or startup. A different current v2 record is conflict; exact projected retry is confirmed. Migration fixtures are the only execution in this unit absent separate application-data authorization.

Add `recordLegacyDisposition(record: CalendarLegacyDisposition): Promise<void>` to `MongoCalendarOperations`, using P1 schema, deterministic `legacyDispositionKey`, existing immutable insert and budget. Store dispositions separately; never rewrite original operation states, scopes, receipts or checkpoint bytes. `planned` legacy admission → failed/not-dispatched; `dispatching`/`unknown` → cancelled/unknown/reconcileOriginal. For a legacy resumable decision or checkpoint use the frozen `legacyKind` and original reference ID; if an operation is linked, inspect it and preserve unknown outcome/quarantine rather than guessing nondispatch. P6 owns invoking this during recovery and P8 owns explicit maintenance/drain authorization.

Implement `assessCalendarRollback` as a pure nonmutating check with input `{admissionStopped:boolean, executorDrained:boolean, pageComplete:boolean, v2Records:number, unresolvedEffects:number}` (nonnegative safe integers) and outcomes:

```ts
if (!input.admissionStopped || !input.executorDrained || !input.pageComplete || input.unresolvedEffects > 0)
  return { outcome: 'blocked' as const };
return { outcome: input.v2Records > 0 ? 'preserve-v2-read-only' as const : 'legacy-compatible' as const };
```

`pageComplete` is true only after the operator's bounded scan reaches the end, never per first page; this function cannot prove an external executor is drained. Do not downgrade v2 records or feed them to an old binary. Full rollback needs admission stopped, active effects reconciled/quarantined, source-expiry-compliant backup/restore and a binary that can preserve/read the actual formats. Restoring old application state without checking provider effects can duplicate writes and is not supported. P8 publishes the operator procedure; P2 supplies executable precondition fixtures and truthful blockers.

- [ ] **Run green:** `npm test -- test/persistence/calendar-migration.spec.ts test/persistence/calendar-multi-connections.spec.ts test/persistence/calendar-multi-operations.spec.ts test/contracts/calendar-multi-compatibility.spec.ts`.
- [ ] **Commit:** `feat(calendar): add explicit legacy migration and safe rollback preconditions`.

## Task 11: Wire the existing owner, add scoped indexes, and prove native restart/races

**Files:** modify `backend/src/persistence/indexes.ts`, `persistence.ts`, `index.ts`; create `backend/test/persistence/calendar-multi-indexes.spec.ts`, `calendar-multi-storage.native.e2e-spec.ts`, `calendar-migration.native.e2e-spec.ts`. Existing `native.ts` and unrelated integration files remain read-only.

- [ ] **Write the failing index test:**

```ts
import { expect, it } from 'vitest';
import { CALENDAR_INDEXES } from '../../src/persistence/indexes.js';
import { COLLECTIONS } from '../../src/contracts/collections.js';

it('uses only existing collections and scoped authority indexes without TTL', () => {
  const byName = new Map(CALENDAR_INDEXES.map(i => [i.options.name, i]));
  expect(byName.get('calendar_pending_proposal_session')).toMatchObject({ collection: 'metadata',
    keys: { userId: 1, sessionId: 1 }, options: { unique: true,
      partialFilterExpression: { kind: 'calendar-proposal', state: 'pending' } } });
  expect(byName.get('calendar_operation_intent')).toMatchObject({ collection: 'metadata',
    keys: { userId: 1, sessionId: 1, intentId: 1 }, options: { unique: true,
      partialFilterExpression: { kind: 'calendar-operation', schemaVersion: 2 } } });
  expect(byName.get('calendar_intent_reservation')?.options.unique).toBe(true);
  expect(byName.get('calendar_consumption_proposal')?.options.unique).toBe(true);
  expect(CALENDAR_INDEXES.every(i => Object.values(COLLECTIONS).includes(i.collection as never))).toBe(true);
  expect(CALENDAR_INDEXES.every(i => i.options.expireAfterSeconds === undefined)).toBe(true);
});
```

Write this native test (same imports in both new native files where used):

```ts
import { expect, it, describe } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { nativeDatabase } from './native.js';
import { connectionV2, pendingProposal, acceptedReply } from './calendar-multi-fixtures.js';
import { entry } from '../contracts/calendar-multi-fixtures.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';
describe.skipIf(!configured)('multi-calendar isolated native storage', () => {
  it('persists a default and has one approval winner across reconnect', async () => {
    const f = await nativeDatabase();
    try {
      expect(/^aurvin_p2_test_[a-f0-9]{32}$/.test(f.name)).toBe(true);
      const hello = await f.client.db('admin').command({ hello: 1 });
      expect(typeof hello.setName).toBe('string'); expect(hello.isWritablePrimary).toBe(true);
      let bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        const first = connectionV2(); await bundle.calendarConnectionsV2.create(first);
        await bundle.calendarConnectionsV2.compareAndSwap({ userId: 'u', expectedRevision: 1,
          expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1,
          next: { ...first, revision: 2,
            defaultSetting: { defaultCalendarId: entry.calendarId, defaultSettingRevision: 2 } } });
        const clocked = new MongoCalendarProposals(new RecordStore(f.db, 1000), DEFAULT_BUDGETS,
          () => Date.parse('2026-10-22T10:01:00.000Z'));
        await clocked.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });
        const replies = await Promise.all(['op', 'other-op'].map(operationId => clocked.consume({
          reply: acceptedReply(), operationId, intentId: 'intent' })));
        const wins = replies.filter(r => r.outcome === 'consumed' || r.outcome === 'existing');
        expect(wins).toHaveLength(2);
        expect(new Set(wins.map(r => r.consumption.operationId)).size).toBe(1);
      } finally { await bundle.owner.releaseExecutor(); }
      const nextClient = await f.reconnect();
      try {
        bundle = await createPersistenceBundle(nextClient, f.name, DEFAULT_BUDGETS);
        try {
          expect(await bundle.calendarConnectionsV2.get('u')).toMatchObject({ connectionRevision: 1,
            defaultSetting: { defaultCalendarId: entry.calendarId, defaultSettingRevision: 2 } });
          const indexes = await f.db.collection('metadata').indexes();
          expect(indexes.every(i => i.expireAfterSeconds === undefined)).toBe(true);
          expect(indexes.some(i => i.name === 'calendar_operation_intent' && i.unique)).toBe(true);
        } finally { await bundle.owner.releaseExecutor(); }
      } finally { await nextClient.close(); }
    } finally { await f.close(); }
  }, 60000);
});
```

Import `MongoCalendarProposals` and `RecordStore` from their exact `.js` persistence paths in the native file. The direct clocked adapter shares the same fixture database/store boundary and has no executor/close owner of its own; it is only deterministic test injection. In production use the bundle's `calendarProposals` instance.

Add native tests with exact assertions before green:

- Concurrent publication of distinct proposal IDs in one session: exactly one confirmed publisher; query pending count **1**. Separate sessions/users can each have one.
- Concurrent default/token/discovery writes from one revision: exactly one winning mutation, losers conflict; reread/rebase disjoint update then persists both without token or default loss. Replacement/disconnect invalidates stale callbacks. Concurrent `reserveByIntent`: one operation document, identical returned IDs; a second operation for the same turn/intent cannot appear under another key.
- Native migration fixture: seed legacy connection plus succeeded and unknown operations with distinct turns; compatible read does not mutate. Explicit migration preserves old override/encrypted tokens/scopes, writes dispositions separately, and reconnect/readback sees original unknown calendar/event IDs. Rollback assessment blocks unknown effects and otherwise requires preserve-v2-read-only. Corrupt version at the **queried deterministic key** rejects `PERSISTENCE_ERROR` (no swallowed `.catch(() => undefined)` assertion).
- Native consumption crash window: seed a consumed proposal with `_calendarApproval` but no wrapper, instantiate a fresh adapter, consume the same reply and assert existing original operation ID plus a repaired wrapper. Seed immutable wrapper but no operation; reserve only its fixed operation; no expiry deletes it. Preserve completed receipt through narration-independent restart.
- Native mixed v1/v2 accounting storage retains Decimal128 and budget/deadline/claims; source/proposal expiry strips names but not uncertain operation identity. Collections after saver setup are a subset of the approved eight (ordinary indexes do not create additional collection names).

- [ ] **Run red**, sequentially: `npm test -- test/persistence/calendar-multi-indexes.spec.ts -t "uses only existing collections"`; with prerequisites, `npm run test:e2e -- test/persistence/calendar-multi-storage.native.e2e-spec.ts -t "persists a default"`. Without prerequisites record **skipped**; deterministic tests remain required red/green proof.
- [ ] **Minimum implementation.** Append these indexes without changing stock saver or legacy indexes:

```ts
{ collection: 'metadata', keys: { userId: 1, sessionId: 1 }, options: {
  name: 'calendar_pending_proposal_session', unique: true,
  partialFilterExpression: { kind: 'calendar-proposal', state: 'pending' } } },
{ collection: 'metadata', keys: { userId: 1, sessionId: 1, proposalId: 1 }, options: {
  name: 'calendar_proposal_identity', unique: true,
  partialFilterExpression: { kind: { $in: ['calendar-proposal', 'calendar-proposal-tombstone'] } } } },
{ collection: 'metadata', keys: { userId: 1, sessionId: 1, intentId: 1 }, options: {
  name: 'calendar_operation_intent', unique: true,
  partialFilterExpression: { kind: 'calendar-operation', schemaVersion: 2 } } },
{ collection: 'metadata', keys: { userId: 1, sessionId: 1, intentId: 1 }, options: {
  name: 'calendar_intent_reservation', unique: true,
  partialFilterExpression: { kind: 'calendar-intent-reservation' } } },
{ collection: 'metadata', keys: { userId: 1, sessionId: 1, intentId: 1 }, options: {
  name: 'calendar_consumption_intent',
  partialFilterExpression: { kind: 'calendar-proposal-consumption' } } },
{ collection: 'metadata', keys: { userId: 1, sessionId: 1, proposalId: 1 }, options: {
  name: 'calendar_consumption_proposal', unique: true,
  partialFilterExpression: { kind: 'calendar-proposal-consumption' } } },
{ collection: 'metadata', keys: { userId: 1, kind: 1, expiresAt: 1, _id: 1 }, options: {
  name: 'calendar_content_expiry' } },
```

Indexes are additive/idempotent. Existing duplicate/corrupt data causes readiness failure and an explicit maintenance gate, never deletion or silent deduplication during startup. Preserve the old unique operation-turn/identity indexes; they cover both operation versions. No broad TTL, multicollection transaction or schema installation script.

In `createPersistenceBundle`, assign each existing Calendar adapter to a local variable once, add `new MongoCalendarProposals(store,budgets)`, return original fields plus:

```ts
calendarConnectionsV2: calendarConnections.v2,
calendarOperationsV2: calendarOperations.v2,
calendarDecisionsV2: calendarDecisions.v2,
calendarResultsV2: calendarResults.v2,
calendarAccountingV2: calendarAccounting.v2,
calendarProposals,
```

Reuse the single `store`, owner, saver, mutation-journal client and close lifecycle. Do not call `claimExecutor` again, open another client, automatically migrate rows, or add a second runtime. Export `MongoCalendarProposals`, migration projection/assessment, and the v2 checkpoint schema from `index.ts` alongside existing exports. P8 binds the new fields to P4/P6 consumers; it must also route them through the existing owner/run fencing, not bypass ownership just because a facade exists.

- [ ] **Run green**, sequentially: `npm test -- test/persistence/calendar-multi-indexes.spec.ts`; `npm run test:e2e -- test/persistence/calendar-multi-storage.native.e2e-spec.ts test/persistence/calendar-migration.native.e2e-spec.ts`. Then run existing Calendar native files through the same e2e config. Report prerequisite skips separately; an empty discovered suite or skipped native run is not a pass.
- [ ] **Commit:** `feat(calendar): wire versioned storage and verify isolated native authority races`.

## Final sequential verification and owner handoff

No application suites or native fixtures were run by this documentation-only planner. Worker records exact commit set, environment, red/green outputs, actual counts and gates. Capture `git rev-parse HEAD`, `git status --short`, `node --version`, `npm --version`. Node must satisfy `^22.22.3 || ^24.15.0 || >=26.0.0`. Missing dependencies are a prerequisite, not permission to install or change manifests.

Run each command **sequentially** from `backend/`; never overlap a build with bootstrap/native tests:

1. `npm test -- test/persistence/calendar-multi-evidence.spec.ts test/persistence/calendar-multi-connections.spec.ts test/persistence/calendar-multi-proposals.spec.ts test/persistence/calendar-multi-operations.spec.ts test/persistence/calendar-multi-accounting.spec.ts test/persistence/calendar-multi-retention.spec.ts test/persistence/calendar-multi-indexes.spec.ts test/persistence/calendar-migration.spec.ts`
2. `npm test -- test/persistence/calendar-`
3. `npm test -- test/contracts/calendar-multi-`
4. `npm run test:e2e -- test/persistence/calendar-multi-storage.native.e2e-spec.ts test/persistence/calendar-migration.native.e2e-spec.ts test/persistence/calendar-storage.native.e2e-spec.ts test/persistence/calendar-retention.native.e2e-spec.ts test/persistence/calendar-accounting.native.e2e-spec.ts`
5. `npm run build`
6. `npm run lint`
7. `npm test`
8. `npm run test:e2e`

Then repository root: `git diff --check`, `git status --short` as separate commands. No root npm command. Full backend commands **remain in the required order** build → lint → test → e2e; focused/native commands above are earlier checks, not replacements.

Native checks require operator-supplied `AURVIN_TEST_MONGODB_URI` and **exact** `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`. Reuse read-only `test/persistence/native.ts`: it creates a random generated database and drops only that fixture on cleanup. Assert replica-set writable primary before test mutations. Never print the URI or credentials, discover a fallback URI, point at application data, widen prefixes, launch MongoDB infrastructure, or mutate OAuth grants. If absent report `SKIPPED — isolated replica-set prerequisites missing`, with actual test count. A configured but incompatible/unavailable service fails, it is not a skip.

### Exit/acceptance matrix

| P2 requirement | Tasks and required evidence | Downstream boundary |
| --- | --- | --- |
| AC02 bounded cache/count/UTF-8/time/complete-vs-partial | 1–3, 9, 11; persisted bounds, expiry and refresh race results | P3 ingests provider pages; P4 handles user-visible refresh failures |
| AC04 default durable and independent of operations | 2–3, 6, 11; restart, reset, CAS conflicts, no authority bump | P4 validates capability; P6 selects precedence |
| AC05/07 causal proposal and actual-reply persistence | 4–6, 9, 11; selection/conflict binding, same-session one consumer, expiry/tombstones | P6 interprets only accepted user input and enforces fresh preflight |
| AC09 no duplicate or retargeted effects | 5–6, 10–11; crash windows, unique intent, fixed event/account/target, old unknown quarantine | P5/P6 original-target readback; no v2 unknown-write replay |
| AC10 accounting/source lifetime correctness | 7–9, 11; mixed-version money, held claims/deadlines, expired provenance | No new totals engine; category admission stays with runtime/provider owners |
| AC12 explicit migration/rollback/single owner | 1, 7, 10–11; legacy read-only, receipts/checkpoints preserved, per-record CAS, rollback blockers | P8 operator runbook and authorization; P6 legacy recovery disposition |
| AC13 privacy/retention/fencing | 3–5, 7, 9–11; no resurrection, bounded cleanup, source policy, no unresolved TTL | P8 lifecycle/security/service gates remain unproven by storage fixtures |

- [ ] All new deterministic P2 tests execute meaningfully and pass; existing P2 regressions remain covered. No tests are weakened to hide the tracked P4/P5/P8 baseline.
- [ ] Every ambiguous connection/consumption/reservation write has pre-write failure, post-write lost-ACK, exact-reread and unavailable-reread evidence. Only durable matching authority can lead to downstream dispatch.
- [ ] Native evidence is recorded as executed/pass/fail/skipped with exact prerequisites and count. Missing native/live inputs prevent full certification, not truthful delivery of the deterministic subset.
- [ ] Publish concrete bundle fields and v2 facades, internal wrapper/approval envelope, migration entry/preconditions, conflict sentinel semantics, discovery revision generation and no-unknown-reinsert rule to P4/P6/P8. P3 continues using only its frozen provider ports.
- [ ] Record all task hashes, named-path stats, package failures with their owning unit, source-expiry limitations and pending native/service gates. Verify the shared index is empty and preserve all unrelated working-tree changes.

No infeasible goal requirement was found for P2's owned storage boundaries. Executed Google ACL/consent/quota behavior, natural-language intent extraction, live preflight and whole-workflow acceptance are **not** established by this plan or by storage tests. Any newly required shared-contract or foreign-file change pauses that affected task for a serialized ownership amendment; do not invent a second schema or silently edit another owner's code.
