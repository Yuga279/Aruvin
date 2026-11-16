# Google Calendar P2 Persistence and Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task, within the MAW orchestrator's assigned slot and serialized commit turns. Do not spawn additional agents without its permission. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the frozen Calendar storage ports, encrypted secret custody primitives, exact dispatch accounting, and source-linked retention foundations without changing the approved plugin behavior or creating another database owner.

**Architecture:** Reuse `RecordStore`, hashed tuple keys, native BSON bounds, `MongoOwnership`, and the admitted guarded client. Store one bounded connection per server-owned user/provider and individually keyed Calendar metadata records; use revision CAS, immutable evidence, bounded reservation claims, and owner-fenced tombstones rather than transactions or TTL deletion. Keep graph checkpoints reference-only for Calendar state and prefer dispatch evidence over legacy attempt accounting exactly once.

**Tech Stack:** Existing Node.js `^22.22.3 || ^24.15.0 || >=26.0.0`, TypeScript/ESM with `.js` import specifiers, MongoDB Node driver 6.21, Zod 3, Vitest, built-in `node:crypto`, and existing standard MongoDB checkpointer.

---

## Steps

- [ ] 1. Establish Calendar fixture builders and guarded collection/index admission.
- [ ] 2. Implement Calendar token/PKCE encryption without changing config ciphertext.
- [ ] 3. Implement connection ownership/revision CAS and single-use OAuth state.
- [ ] 4. Implement one-operation-per-turn authority, transitions, and ordered immutable events.
- [ ] 5. Implement decisions, rejected-decision evidence, and permission-aware tool results.
- [ ] 6. Add exact Decimal128 codecs and durable dispatch/repair reservation accounting.
- [ ] 7. Extend bounded reports with dispatch precedence and legacy/voice compatibility.
- [ ] 8. Implement source-linked read expiry, redaction, audit expiry, and quarantine.
- [ ] 9. Keep Calendar checkpoint state reference-only and expose the shared persistence bundle.
- [ ] 10. Run deterministic and admitted isolated-native gates and deliver the handoff.

## Authority, boundaries, and preflight

Read `goal.md`, `research.md`, and the P2 scope/ownership in `state.md`. Goal approval is recorded in state; the old pending-approval paragraph in the goal is stale, not a new gate. P1's worker commits `9f8da4b` through `9bf224e` freeze the following interfaces:

| Contract file | Frozen inputs/ports used here |
| --- | --- |
| `backend/src/contracts/calendar-connections.ts` | `CalendarConnectionStore`, `CalendarConnectionRecord`, `CalendarOAuthState`, `calendarCredentialAadSchema`, `encryptedCalendarSecretSchema` |
| `backend/src/contracts/calendar-operations.ts` | `CalendarOperationStore`, `CalendarOperation`, `CalendarOperationEvent`, `CalendarReceipt`, operation states and CAS outcomes |
| `backend/src/contracts/calendar-model.ts` | `CalendarDecisionStore`, resumable/rejected decision schemas; normalized diagnostics |
| `backend/src/contracts/calendar-accounting.ts` | `CalendarAccountingStore`, budget/dispatch/aggregate schemas, `sumUsd`, `reserveUsd`, `withinSpendCap`, `preferredAttemptAccounting` |
| `backend/src/contracts/calendar-sources.ts` | `CalendarResultStore`, source references/permissions, `effectiveSourceExpiry`, `CALENDAR_TOMBSTONE` |
| `backend/src/contracts/message.ts` | Optional bounded `sourceProvenance` on assistant archive records |

Own only the files named below. Do not change contracts/manifests, HTTP, Google/OAuth services, model code, runtime/context, operations, or central assembly. Consumers implement policy and execution through these ports; no direct Google request belongs here. `backend/src/persistence/persistence.ts` is the existing storage composition, not a new `AppService`. Preserve its one client, ownership claim, saver and close path.

If an implementation needs to change transport, local/member scope, approved limits/actions/repair wording/retention, stop and report to the orchestrator. Contract amendments return to P1 before consumers proceed. New internal storage envelopes and concrete persistence helper methods below do not alter P1's wire shapes.

Run all npm commands from `backend/`; Git commands use repository-relative paths from the repository root. Do not load application `.env` for fixtures, print connection strings, provision a DB, or use live Google/OpenRouter. Native execution requires an operator-supplied isolated `AURVIN_TEST_MONGODB_URI` and exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`. Missing prerequisites mean **native skipped / gate pending**, never native passed. Unified review is **skipped**; task-local test/plan consistency checking is not a review phase.

Implementation steps below are ordered red/green recipes, not permission to implement an entire adapter before checking it. For each independently named behavior, write that one test, run its exact file command with `-t "<the named behavior>"`, make the smallest method/branch change, rerun it, and only then take the next behavior. Keep these edits in 2–5 minute increments; finish each task with its listed broader verification and named-file commit. Do not commit intentionally failing tests that depend on a later task. Obtain the orchestrator's serialized commit turn before staging each worker commit.

### File map (create only these new production modules)

| File | Responsibility |
| --- | --- |
| `backend/src/platform/crypto/calendar-secret-cipher.ts` | AES-256-GCM Calendar token and OAuth-verifier envelopes with explicit domain-separated AAD |
| `backend/src/persistence/calendar-records.ts` | Calendar keys, strictly validated internal envelopes, bounded CAS confirmation, source/audit helpers |
| `backend/src/persistence/calendar-connections.ts` | Connection store and atomic OAuth state consumption/tombstones |
| `backend/src/persistence/calendar-operations.ts` | Logical create authority and append-only operation events |
| `backend/src/persistence/calendar-evidence.ts` | Decision/rejection and tool-result stores |
| `backend/src/persistence/calendar-accounting.ts` | Accepted-turn budgets, dispatch claims, monetary settlement, verified aggregates |
| `backend/src/persistence/calendar-retention.ts` | Source registration, read redaction, bounded owner-fenced cleanup and safe quarantine |
| `backend/src/persistence/calendar-checkpoints.ts` | Small bounded reference-only Calendar checkpoint validator |

Modify only the necessary portions of `backend/src/persistence/{records,store,indexes,mutation-journal,accounting-codec,accounting-reporting,metadata,messages,checkpoints,persistence,index}.ts`. Do not refactor unrelated adapters. New fixtures/tests are named per task under `backend/test/persistence/`. The existing admin config cipher remains untouched: Calendar uses built-in crypto directly, so no extraction, config re-encryption, or config AAD migration is needed. Run its existing regression suite unchanged.

### Storage rules decided before coding

1. Keys use existing `key(kind, ...parts)`; no text-similarity deduplication. Public `revision` starts at 1 and advances exactly once per successful change. Driver `_revision` remains the existing private CAS token starting at 0; do not confuse them.
2. Calendar storage validation uses the frozen schema plus `bounded`/`assertBytes`; no raw unvalidated driver payload. Strict parsing of saved unknown schema versions/states fails closed with `PERSISTENCE_ERROR`, never `null`, a default state, or newly granted create authority.
3. Correct the shared `RecordStore` scope construction to omit absent `sessionId`, rather than relying on driver serialization of `undefined`. Its callers include user-only connection/OAuth/decision records as well as session-scoped existing adapters; run existing record/voice/config regressions. Do not weaken user/session filters.
4. Private Calendar envelope fields are parsed separately and removed before public strict-schema decoding. The only new private budget field is `_calendarClaims`, bounded to eight entries, each `{dispatchId, dispatchIndex, fingerprint, reservationUsd}`; it binds a particular dispatch to a budget revision without putting growing ledgers in the public budget. Audit envelope `{createdAt, expiresAt, redactedAt}` is bounded and validated; expiry is the earlier of 30 days and the explicitly supplied stricter policy deadline, never extended on updates. Add these only in `calendar-records.ts`, not to public contracts or arbitrary documents.
5. No Calendar `expireAfterSeconds`, collection-wide delete, or new raw deletion API. TTL runs outside fencing and could erase unknown effects. Physically removing documents or editing backups is not this worker's implementation strategy.
6. Operations/events/decisions/results/dispatches remain separate documents. Only the frozen arrays (six source references, eight dispatch IDs, ten diagnostics) and the eight private claims are admitted; no appended event/result/token history arrays.

## Task 1: Fixture records, shared scope, guarded admission, and additive indexes

**Files:** Create `backend/test/persistence/calendar-fixtures.ts` and `backend/test/persistence/calendar-records.spec.ts`; modify `backend/src/persistence/store.ts`, `backend/src/persistence/indexes.ts`, `backend/src/persistence/mutation-journal.ts`, `backend/test/persistence/mutation-journal.spec.ts`, `backend/test/persistence/records.spec.ts`.

- [ ] **1. Write schema-valid fixtures and failing checks.** Fixture functions return parsed frozen schemas; tests parse any spread overrides with the same schema so they cannot silently invent storage shapes. Use this complete core; decision/result/receipt test literals are specified in their owning tasks:

```ts
import { connectionRecordSchema, oauthStateSchema } from '../../src/contracts/calendar-connections.js';
import { operationRecordSchema, operationEventSchema } from '../../src/contracts/calendar-operations.js';
import { sourceReferenceSchema } from '../../src/contracts/calendar-sources.js';
import { turnBudgetRecordSchema, modelDispatchSchema } from '../../src/contracts/calendar-accounting.js';
import { unavailableMoney } from '../../src/contracts/usage-evidence.js';
export const now = '2026-10-20T10:00:00.000Z';
export const later = '2026-10-20T10:03:00.000Z';
export const sha = 'a'.repeat(64);
export const secretEnvelope = { version: 1 as const, iv: Buffer.alloc(12).toString('base64'),
  tag: Buffer.alloc(16).toString('base64'), ciphertext: 'YQ==' };
export const source = () => sourceReferenceSchema.parse({ schemaVersion: 1, sourceId: 'src1',
  plugin: 'google-calendar', connectionId: 'c1', connectionRevision: 1, operationIds: ['op1'],
  fetchedAt: now, expiresAt: '2026-10-20T11:00:00.000Z', redactedAt: null,
  permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' } });
export const connection = () => connectionRecordSchema.parse({ schemaVersion: 1, userId: 'u1',
  provider: 'google-calendar', connectionId: 'c1', revision: 1, connectionRevision: 1,
  credentialVersion: 1, googleSubjectId: 'google-sub1', accountEmail: 'fixture@example.invalid',
  calendarId: 'fixture-owned-calendar', targetRevision: 1, enabled: true, status: 'connected',
  credentials: { access: secretEnvelope, refresh: secretEnvelope }, tokenExpiresAt: later,
  grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events.owned'], updatedAt: now });
export const oauthState = () => oauthStateSchema.parse({ schemaVersion: 1,
  kind: 'calendar-oauth-state', userId: 'u1', stateHash: sha, browserHash: 'b'.repeat(64),
  oidcNonceHash: 'c'.repeat(64), encryptedVerifier: secretEnvelope,
  redirectUri: 'http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback',
  createdAt: now, expiresAt: '2026-10-20T10:10:00.000Z', consumedAt: null });
export const operation = () => operationRecordSchema.parse({ schemaVersion: 1,
  kind: 'calendar-operation', userId: 'u1', sessionId: 's1', turnId: 't1', operationId: 'op1',
  originatingAttemptId: 'a1', revision: 1, sequence: 1, connectionId: 'c1', connectionRevision: 1,
  googleSubjectId: 'google-sub1', calendarId: 'fixture-owned-calendar', targetRevision: 1,
  requestHash: sha, googleEventId: '0123456789abc', schemaRevision: 'google-calendar.v1',
  action: { summary: 'Fixture event', start: '2026-10-21T10:00:00Z',
    end: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' }, actionSources: [],
  authorization: { acceptedUserMessageId: 'm0', canonicalActionHash: sha,
    approvedAt: now, basis: 'explicit-request' }, deliveryRetries: 0,
  createdAt: now, updatedAt: now, auditExpiresAt: '2026-11-19T10:00:00.000Z',
  state: 'planned', receipt: null, failure: null });
export const operationEvent = () => operationEventSchema.parse({ schemaVersion: 1,
  kind: 'calendar-operation-event', userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1',
  operationId: 'op1', eventId: 'oe1', sequence: 1, state: 'planned', createdAt: now, failure: null });
export const budget = () => turnBudgetRecordSchema.parse({ schemaVersion: 1,
  kind: 'calendar-turn-budget', userId: 'u1', sessionId: 's1', turnId: 't1', revision: 1,
  modelDispatches: 0, repairs: 0, logicalTools: 0, creates: 0, calendarRequests: 0,
  refreshRequests: 0, deadlineAt: later, createdAt: now, settledUsd: '0', reservedUsd: '0' });
export const dispatch = () => modelDispatchSchema.parse({ schemaVersion: 1,
  kind: 'calendar-model-dispatch', userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1',
  dispatchId: 'd1', decisionId: 'dec1', dispatchIndex: 1, reason: 'initial', repairedDecisionId: null,
  requestedModel: 'fixture/model', reportedModel: null, reportedProvider: null, openRouterUser: 'u1',
  configRevision: 1, connectionId: 'c1', connectionRevision: 1, schemaRevision: 'google-calendar.v1',
  generationId: null, providerRequestId: null, status: 'reserved', startedAt: now,
  endedAt: null, firstOutputAt: null, promptTokens: null, completionTokens: null,
  cachedPromptTokens: null, cacheWriteTokens: null, reasoningOutputTokens: null,
  money: unavailableMoney(true), pricing: { version: 'fixture-prices', source: 'fixture',
    observedAt: now, modelId: 'fixture/model', providerRoute: 'fixture-provider',
    promptUsdPerToken: '0.000001', completionUsdPerToken: '0.000002', requestUsd: '0' },
  reservationUsd: '0.25', reservationStatus: 'held', failure: null });
```

Add tests to `calendar-records.spec.ts` named `fixtures obey frozen bounds`, `user-only keys omit undefined session scope`, and `Calendar indexes are additive partial unique indexes without TTL`. Exercise a connection insert through the real `RecordStore` with a `vi.fn` collection and inspect the filter: `{_id, userId}` and **no** `sessionId` property. Also assert existing session-scoped insert/replace still include both owner keys. In `mutation-journal.spec.ts`, reuse its `fixture()` and add this complete test:

```ts
it('fences Calendar collection writes and keeps unsupported escapes closed', async () => {
  const f = fixture();
  const client = guardedClient(f.client as never, 'db', f.journal);
  const writing = client.db('db').collection('integration_connections').updateOne(
    { userId: 'u1', provider: 'google-calendar' }, { $set: { enabled: false } });
  await Promise.resolve(); await Promise.resolve();
  expect(f.collection.updateOne).not.toHaveBeenCalled();
  f.resolveAck(); await writing;
  expect(f.events).toEqual(['intent', 'data', 'idle']);
  expect(() => client.db('db').collection('integration_connections').deleteMany({})).toThrow();
  expect(() => client.db('db').collection('unregistered')).toThrow();
});
```

- [ ] **2. Run the new failing tests.** `npm test -- test/persistence/calendar-records.spec.ts`; `npm test -- test/persistence/mutation-journal.spec.ts -t "fences Calendar collection"`. Expect rejection of the unadmitted collection/missing Calendar indexes or the undefined-scope assertion, not a successful suite with zero discovery.
- [ ] **3. Implement minimal admission and index additions.** Add only `integration_connections` to the guarded collection set; do not replace it with all contract collections (that would change config admission). Replace both scope expressions in `RecordStore` with:

```ts
const scope = 'userId' in record
  ? { userId: record.userId, ...('sessionId' in record ? { sessionId: record.sessionId } : {}) }
  : {};
```

Use MongoDB `CreateIndexesOptions` for the existing index options type. Add these explicitly named indexes; existing indexes and the standard saver indexes are preserved:

| Collection / index name | Keys | Options |
| --- | --- | --- |
| `integration_connections` / `calendar_owner` | `{userId:1,provider:1}` | unique |
| `integration_connections` / `calendar_connection_identity` | `{userId:1,connectionId:1}` | unique |
| `metadata` / `calendar_oauth_hash` | `{stateHash:1}` | unique; partial `kind: 'calendar-oauth-state'` |
| `metadata` / `calendar_operation_turn` | `{userId:1,sessionId:1,turnId:1}` | unique; partial `kind: {$in:['calendar-operation','calendar-operation-tombstone']}` |
| `metadata` / `calendar_operation_identity` | `{userId:1,operationId:1}` | unique; same partial live/tombstone kinds |
| `metadata` / `calendar_operation_event_sequence` | `{userId:1,operationId:1,sequence:1}` | unique; partial operation-event kind |
| `metadata` / `calendar_operation_event_identity` | `{userId:1,eventId:1}` | unique; partial operation-event kind |
| `metadata` / `calendar_budget_turn` | `{userId:1,sessionId:1,turnId:1}` | unique; partial budget kind |
| `metadata` / `calendar_dispatch_identity` | `{userId:1,dispatchId:1}` | unique; partial dispatch kind |
| `metadata` / `calendar_dispatch_order` | `{userId:1,turnId:1,dispatchIndex:1}` | unique; partial dispatch kind |
| `metadata` / `calendar_dispatch_generation` | `{userId:1,generationId:1}` | unique; partial dispatch kind **and** `generationId: {$type:'string'}` |
| `metadata` / `calendar_aggregate_attempt` | `{userId:1,sessionId:1,turnId:1,attemptId:1}` | unique; partial aggregate kind |
| `metadata` / `calendar_decision_identity` | `{userId:1,decisionId:1,kind:1}` | unique; partial `kind: {$in:['calendar-model-decision','calendar-rejected-decision']}` |
| `metadata` / `calendar_result_identity` | `{userId:1,sessionId:1,toolCallId:1}` | unique; partial result kind |
| `metadata` / `calendar_source_identity` | `{userId:1,sessionId:1,sourceId:1}` | unique; partial internal source kind |
| `messages` / `calendar_message_source` | `{userId:1,sessionId:1,'sourceProvenance.sourceId':1}` | non-unique |
| `metadata` / `calendar_audit_expiry` | `{kind:1,'_calendarAudit.expiresAt':1,_id:1}` | non-unique, not TTL |

Index conflicts/duplicate pre-existing rows or unsupported partial-index capabilities fail setup safely; never auto-delete or deduplicate application data, silently weaken cross-kind uniqueness, or certify an unsupported service. Connection `_id = key('calendar-connection', userId, 'google-calendar')` also makes owner uniqueness stable.
- [ ] **4. Verify.** Rerun the two focused commands, then `npm test -- test/persistence/records.spec.ts test/persistence/mutation-journal.spec.ts test/persistence/voice-metadata.spec.ts`. Expect discovered passing assertions; record failures as defects, not compatibility certification.
- [ ] **5. Commit the named files only.** Message: `feat(calendar-persistence): admit bounded guarded Calendar records and indexes`.

## Task 2: Calendar encryption/AAD and unchanged config compatibility

**Files:** Create `backend/src/platform/crypto/calendar-secret-cipher.ts`, `backend/test/persistence/calendar-secret-cipher.spec.ts`. Existing `backend/src/admin-config/credential-service.ts` and its test are read-only in this approach.

- [ ] **1. Write a failing `binds every credential ownership/version field` test.** New exported `CalendarSecretCipher` takes existing `EncryptionBootstrap`; methods are `sealToken(aad, plaintext)`, `openToken(aad, envelope)`, `sealVerifier(stateBinding, plaintext)`, and `openVerifier(stateBinding, envelope)`. `stateBinding` is `{userId,stateHash,browserHash,oidcNonceHash,redirectUri}` parsed from `CalendarOAuthState`. Use this executable test body:

```ts
const cipher = new CalendarSecretCipher({ status: 'ready', key: Buffer.alloc(32, 7) });
const aad = { version: 1 as const, userId: 'u1', provider: 'google-calendar' as const,
  connectionId: 'c1', credentialVersion: 1, googleSubjectId: 'google-sub1', tokenKind: 'refresh' as const };
const sealed = cipher.sealToken(aad, 'fixture-refresh');
expect(cipher.openToken(aad, sealed)).toBe('fixture-refresh');
expect(cipher.sealToken(aad, 'fixture-refresh').iv).not.toBe(sealed.iv);
for (const patch of [{ userId: 'u2' }, { connectionId: 'c2' }, { credentialVersion: 2 },
  { googleSubjectId: 'google-sub2' }, { tokenKind: 'access' as const }]) {
  expect(() => cipher.openToken({ ...aad, ...patch }, sealed)).toThrow('Calendar credentials are unavailable.');
}
expect(JSON.stringify(sealed)).not.toContain('fixture-refresh');
```

Add table cases for each ciphertext/tag/iv byte flip, malformed/noncanonical base64, 11/13-byte IV, 15/17-byte tag, wrong/missing/invalid key, provider/version mismatch rejected by schema, blank/oversized/control-character token, random-source failure, PKCE/state/nonce/browser/redirect swap, and token/verifier domain substitution. Errors and serialized stacks must contain neither the token nor crypto exception details.
- [ ] **2. Run.** `npm test -- test/persistence/calendar-secret-cipher.spec.ts -t "binds every credential"`. Expect the missing cipher implementation to fail.
- [ ] **3. Implement using `node:crypto` only.** Validate token AAD with `calendarCredentialAadSchema`. Serialize token AAD as the following fixed ordered tuple, never `Object.values` or object insertion order:

```ts
const tokenAad = (v: z.infer<typeof calendarCredentialAadSchema>) => Buffer.from(JSON.stringify([
  'aurvin', 'calendar-credential', v.version, v.userId, v.provider, v.connectionId,
  v.credentialVersion, v.googleSubjectId, v.tokenKind,
]), 'utf8');
const verifierAad = (v: Pick<CalendarOAuthState,
  'userId' | 'stateHash' | 'browserHash' | 'oidcNonceHash' | 'redirectUri'>) => Buffer.from(JSON.stringify([
  'aurvin', 'calendar-oauth-pkce', 1, v.userId, v.stateHash, v.browserHash, v.oidcNonceHash, v.redirectUri,
]), 'utf8');
```

Use AES-256-GCM, a fresh 12-byte `randomBytes` IV, 16-byte tag, environment-held 32-byte key converted with `createSecretKey`, and the frozen `{version:1,iv,tag,ciphertext}` base64 envelope. Verify canonical base64 by decoding and re-encoding; bound token plaintext to 1–8,192 UTF-8 bytes, reject controls/leading/trailing whitespace, and require verifier RFC7636 characters and 43–128 characters. Enforce encrypted schema/BSON limits after sealing. Catch errors at the cipher boundary and emit only `new AppError('NOT_READY', 'Calendar credentials are unavailable.')`; do not attach `cause` containing secret material. Empty connections need no decrypt/key. Configuration AAD remains exactly `['aurvin','config',1,provider]`; no algorithm/envelope conversion is applied to existing config rows.
- [ ] **4. Verify.** `npm test -- test/persistence/calendar-secret-cipher.spec.ts`; `npm test -- src/admin-config/credential-service.spec.ts`. Expect all existing config fresh-nonce/tamper/provider/missing-key cases unchanged and new Calendar cases passing. Add a fixed legacy config envelope generated by Node's original tuple directly inside the new test, decrypt it using existing `CredentialService`, and assert Calendar cannot open it; this is a regression check, not migration.
- [ ] **5. Commit.** Message: `feat(calendar-persistence): encrypt versioned tokens and browser-bound PKCE secrets`.

## Task 3: Connection CAS and atomic single-use OAuth state

**Files:** Create `backend/src/persistence/calendar-records.ts`, `backend/src/persistence/calendar-connections.ts`, `backend/test/persistence/calendar-connections.spec.ts`.

- [ ] **1. Write failing tests.** Names: `one owner key survives connection replacement`, `rotation CAS never restores a stale token`, `state is consumed once only before expiry`, and `unknown writes never authorize token exchange`. Test same-user/different-connection create collision, different user separation, revision and target/account replacement, cleared credentials on disconnect, mismatched state/browser/user, exact-expiry rejection, replay, unknown stored kind/version, and ambiguous writes before/after actual persistence. Use real adapters against scripted `vi.fn` driver responses and inspect full mutation filters; native races are Task 10.

```ts
const store = new MongoCalendarConnections(recordStore, DEFAULT_BUDGETS);
const first = connection();
expect((await store.create(first)).outcome).toBe('confirmed');
const rotated = { ...first, revision: 2, credentialVersion: 2, updatedAt: later };
expect((await store.compareAndSwap('u1', 1, rotated)).outcome).toBe('confirmed');
expect((await store.compareAndSwap('u1', 1, { ...rotated, credentialVersion: 3 })).outcome).toBe('conflict');
await store.putState(oauthState());
const request = { userId: 'u1', stateHash: sha, browserHash: 'b'.repeat(64), now: later };
expect(await store.consumeState(request)).toEqual(oauthState());
expect(await store.consumeState(request)).toBeNull();
```

Here `recordStore` is the real `RecordStore` wrapping a test driver whose `findOne`, `updateOne`, `replaceOne`, and `findOneAndUpdate` are individually scripted for the test. Do not make the test pass by mocking `MongoCalendarConnections` or by creating a general MongoDB emulator. Record the script expectations next to each assertion; always assert the scoped query/update/options actually sent.
- [ ] **2. Run.** `npm test -- test/persistence/calendar-connections.spec.ts -t "rotation CAS"`; `npm test -- test/persistence/calendar-connections.spec.ts -t "state is consumed"`. Expect missing adapter failures.
- [ ] **3. Implement the frozen store.** Use these exact keys:

```ts
export const connectionKey = (userId: string) => key('calendar-connection', userId, 'google-calendar');
export const oauthKey = (stateHash: string) => key('calendar-oauth-state', stateHash);
export const operationKey = (userId: string, sessionId: string, turnId: string) =>
  key('calendar-operation', userId, sessionId, turnId);
export const budgetKey = (userId: string, sessionId: string, turnId: string) =>
  key('calendar-turn-budget', userId, sessionId, turnId);
```

`get(userId)` always filters provider as well as user and hashed `_id`. `create` admits revision 1 only and returns confirmed only for an identical confirmed row; otherwise conflict with current public revision, or uncertain if exact durable confirmation cannot be read. `compareAndSwap` requires owner/provider unchanged, public next revision `expectedRevision+1`, nondecreasing update time, and monotone connection/target/credential versions. Token changes require credential version +1; access and refresh ciphertext must both be sealed under the new version (P3 preserves an omitted replacement refresh token by decrypting/resealing the existing value). Subject/connection/target replacement or disconnect invalidates connection revision; target changes also advance target revision. Reject toggles that smuggle changed immutable binding fields without those increments. Compare using private `_revision` **and** expected public revision; reread exact resulting record on ambiguous ACK, otherwise return uncertain, never silently retry the write or clear the owner sentinel. An exact retry of the already committed next record is confirmed without another increment.

`putState` requires unconsumed hashed input, a positive lifetime at most 600 seconds, stable `_id`, no extra secret fields, and an immutable upsert. Never store raw state/browser nonce/OIDC nonce or authorization code. Consume in one guarded driver mutation and return its preimage:

```ts
const saved = await collection.findOneAndUpdate({
  _id: oauthKey(input.stateHash), kind: 'calendar-oauth-state', userId: input.userId,
  stateHash: input.stateHash, browserHash: input.browserHash, consumedAt: null,
  createdAt: { $lte: input.now }, expiresAt: { $gt: input.now },
}, {
  $set: { kind: 'calendar-oauth-state-tombstone', consumedAt: input.now, reason: 'consumed' },
  $unset: { encryptedVerifier: '', browserHash: '', oidcNonceHash: '', redirectUri: '' },
  $inc: { _revision: 1 },
}, { ...recordStore.options(), returnDocument: 'before', includeResultMetadata: false });
```

Validate `input.now` and hashes before using this query. Validate the preimage with `oauthStateSchema` before returning it. Reject malformed saved state before mutation using a read/strict parse followed by the same conditional query including its `_revision`; invalid saved state does not become a usable verifier. The internal tombstone schema includes only existing schemaVersion/user/stateHash/createdAt/expiresAt, consumedAt and reason; no encrypted verifier or browser identifiers remain. A thrown/uncertain consume does not expose the verifier; P3 must restart authorization, not infer ownership from a reread tombstone. Expired states are tombstoned by fenced cleanup, not TTL. A later `putState` cannot resurrect a tombstone under the same hash.
- [ ] **4. Verify.** `npm test -- test/persistence/calendar-connections.spec.ts test/persistence/calendar-secret-cipher.spec.ts`; inspect queries for missing user/provider/revision predicates and assert no unguarded API call. The Node driver 6.x document/preimage return behavior is documented; only isolated-native execution establishes its behavior in the supplied admitted service.
- [ ] **5. Commit.** Message: `feat(calendar-persistence): add owner-scoped connection CAS and single-use OAuth state`.

## Task 4: Stable operation authority, immutable receipts, and event sequencing

**Files:** Create `backend/src/persistence/calendar-operations.ts`, `backend/test/persistence/calendar-operations.spec.ts`; extend `calendar-records.ts` only for scoped helper reuse.

- [ ] **1. Write failing tests.** `same accepted turn reserves one operation across attempts`, `terminal receipt cannot be replaced`, `operation events reject duplicate sequence with different content`, and `unknown and expired authority never authorize a new create`. Include different operation/event IDs for the same turn, altered request/event ID/target/account/authorization, cross-user access, exact duplicate upsert, stale revision, uncertain ACK, unknown stored state, event ordering and cursor scope/bounds. Build a valid receipt with `operationId:'op1'`, the fixture event ID, revision/target hashes, `verifiedAt:later`, `source:source()`, `htmlLink:null`; validate it with the frozen receipt schema.

```ts
const original = operation();
const first = await operations.reserve(original);
const retry = await operations.reserve({ ...original, originatingAttemptId: 'a2' });
expect(first.outcome).toBe('created');
expect(retry.outcome).toBe('existing');
expect(retry.record.originatingAttemptId).toBe('a1');
expect(retry.record.googleEventId).toBe(original.googleEventId);
await operations.appendEvent(operationEvent());
await operations.appendEvent(operationEvent());
await expect(operations.appendEvent({ ...operationEvent(), eventId: 'oe2' }))
  .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
```

- [ ] **2. Run.** `npm test -- test/persistence/calendar-operations.spec.ts -t "same accepted turn"`. Expect missing adapter failure.
- [ ] **3. Implement `MongoCalendarOperations implements CalendarOperationStore`.** Reserve starts only from `planned`, revision 1, sequence >=0, deliveryRetries 0, current accepted attempt/user-message linkage and matching `authorization.canonicalActionHash`. Use the turn key even when a subsequent application attempt has a different ID. On an existing turn return that authority without changing any field; if caller proposes incompatible action/ownership/hash/event identity, reject rather than retarget it. A retry may omit its own newly proposed operation ID only by reading the existing turn first; it may not overwrite it.

Implement the state relation explicitly:

```ts
const nextStates = {
  planned: ['dispatching', 'definitely-failed', 'evidence-expired'],
  dispatching: ['succeeded', 'definitely-failed', 'unknown'],
  unknown: ['dispatching', 'succeeded', 'definitely-failed'],
  succeeded: ['evidence-expired'],
  'definitely-failed': ['evidence-expired'],
  'evidence-expired': [],
} as const;
```

`unknown` means reconciliation-required, not permission to create a different event. Safe same-ID external delivery retries belong to P6; storage may accept a `dispatching -> dispatching` update only with revision/sequence +1, deliveryRetries +1 <=2, identical action/binding/hash/event ID and no receipt. `unknown -> dispatching` additionally requires a durable, current, matching **absent** readback observation under the same connection/target revision and operation revision, and current retained action authority. Add the concrete `putReconciliation(record)` method with a strict internal record `{schemaVersion:1,kind:'calendar-operation-reconciliation',userId,sessionId,turnId,operationId,eventId,operationRevision,outcome,connectionRevision,targetRevision,checkedAt}`; `outcome` is `absent | mismatch | unknown`, IDs/dates use P1 validators, and the record is immutable at `key(kind,userId,operationId,eventId)`. The observation contains no fetched body and requires independently permitted minimal evidence. CAS consumes it once by matching the old operation revision; a later revision cannot reuse it. Mismatch/unknown/readback failure never allows delivery. A matched readback uses the validated immutable receipt directly. Allow exact idempotent repeats without changes; all other transitions require public revision +1, sequence +1, nondecreasing timestamps, immutable authority tuple, nondecreasing retry counter. A saved succeeded receipt is immutable on ordinary CAS, including its verified time, ID, request/target and source linkage. The only exception is explicit privacy redaction in Task 8: erase content, never replace one success with another.

CAS confirmation has the same confirmed/conflict/uncertain distinction as connections. The state write and event insertion are deliberately separate: P6 must await a confirmed current-state write and matching immutable event before continuing. Append verifies operation scope, accepted attempt linkage and the current operation's sequence/state; use key `key('calendar-operation-event',userId,operationId,sequence)` and the two unique event indexes. Exact duplicates succeed, conflicts fail, gaps or events ahead of current state fail. A missing matching event after crash is repairable from confirmed current-state evidence; never claim atomicity or infer external success from an event alone. `listEvents` is ascending `(sequence,eventId)`, limit 1..`budgets.maxPageSize`, fetch limit+1; its base64url cursor binds user, operation, sequence and event ID and rejects reuse against another scope.
- [ ] **4. Verify.** `npm test -- test/persistence/calendar-operations.spec.ts`; include a crash between state CAS/event append and prove the same event can be appended once without another create authority. Verify `succeeded -> planned`, `unknown -> planned`, and `evidence-expired -> planned` fail.
- [ ] **5. Commit.** Message: `feat(calendar-persistence): persist same-turn create authority and immutable operation evidence`.

## Task 5: Durable decisions, repair evidence, and bounded result projections

**Files:** Create `backend/src/persistence/calendar-evidence.ts`, `backend/test/persistence/calendar-evidence.spec.ts`; extend `backend/src/persistence/calendar-records.ts` with the pure source-expiry/redaction functions described below.

- [ ] **1. Write failing tests.** `rejected decisions persist hashes and bounded diagnostics only`, `decision and result links cannot be reassigned`, `volatile content never enters durable evidence`, and `expired results read as source-linked tombstones`. Fixtures use the P1 schemas: rejected record links dispatch/decision/index/repairsUsed and exactly one diagnostic `{path:'start',code:'wrong-type',expected:'string'}`; decision record links the same turn/attempt/connection/schema; result has `eventId`, sequence, `toolCallId` and `resultRef`.

```ts
const rejected = rejectedDecisionSchema.parse({ schemaVersion: 1,
  kind: 'calendar-rejected-decision', userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1',
  decisionId: 'dec1', dispatchId: 'd1', dispatchIndex: 1, repairsUsed: 0,
  rawArgumentsSha256: sha, diagnostics: [{ path: 'start', code: 'wrong-type', expected: 'string' }], createdAt: now });
await decisions.putRejected(rejected);
await decisions.putRejected(rejected);
await expect(decisions.putRejected({ ...rejected, rawArgumentsSha256: 'b'.repeat(64) }))
  .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
expect(JSON.stringify(savedDriverPayloads)).not.toContain('fixture-refresh');
```

`savedDriverPayloads` is the list of payload arguments captured by the scripted fixture's actual `updateOne`/`replaceOne` mocks, not a second storage implementation. Add actual schema failures for 11 diagnostics, >2,048 characters, >16 KiB arguments/result, source operation mismatch, and `minimalEvidenceAllowed:false`.
- [ ] **2. Run.** `npm test -- test/persistence/calendar-evidence.spec.ts -t "volatile content"`. Expect missing stores or content rejection failure.
- [ ] **3. Implement separate exported `MongoCalendarDecisions` and `MongoCalendarResults` classes in the one module.** Keys are `key(kind,userId,decisionId)` for decisions/rejections and `key('calendar-tool-result',userId,sessionId,toolCallId)` for results. Persist strict P1 records through guarded immutable upserts; verify accepted attempt/turn, dispatched decision identity, causal tool-call IDs and current operation/source references before acknowledging. Repair evidence never stores raw malformed JSON, private reasoning or provider dumps; `repairsUsed` cannot exceed the saved accepted-turn budget. Repair decision `rejectedDecisionId` must reference rejected evidence from the same accepted turn, and new decision/provider identities remain distinct.

At write and read, retained source content must be permitted **and** unexpired against an injected clock. Zero/absent permission means reference/tombstone only from the outset; never save content expecting the sweeper to catch it. Frozen P1 reference records still require independent permission for minimal evidence. Implement the pure `redactCalendarMessage(record,nowMs)`, `redactCalendarDecision(record,nowMs)` and `redactCalendarResult(record,nowMs)` helpers now in `calendar-records.ts`: preserve IDs/sequence/source deadlines, mark redactedAt once, replace expired/source-volatile assistant content and alternate transcripts with `CALENDAR_TOMBSTONE`, null the decision, and replace retained result with its permitted tombstone variant. When a decision contains fetched/derived content and any source is volatile/expired, save/read the permitted null-decision reference instead of raw text/tool arguments. Preserve canonical user-authored data under its existing policy; source-derived data does not become user-authored because it appears in arguments. Do not hash disallowed content as a supposed privacy exemption. Task 8 extends these same helpers with durable source revocation/registration and archive-wide cleanup; do not leave this task's committed tests failing against a future implementation.
- [ ] **4. Verify.** `npm test -- test/persistence/calendar-evidence.spec.ts`; assert exact duplicate writes are idempotent and mismatched payloads fail; failed/expired reads cannot return an executable decision or fabricated successful tool result.
- [ ] **5. Commit.** Message: `feat(calendar-persistence): persist permission-aware decisions and tool evidence`.

## Task 6: Exact monetary codecs and crash-safe turn/dispatch reservations

**Files:** Create `backend/src/persistence/calendar-accounting.ts`, `backend/test/persistence/calendar-accounting.spec.ts`; modify `backend/src/persistence/accounting-codec.ts` and extend `calendar-records.ts` internal envelopes.

- [ ] **1. Write failing tests.** `Calendar money round trips as Decimal128`, `same dispatch reserves once across restart`, `repair counters and deadline never reset across attempts`, `unknown dispatched cost keeps its hold`, and `only proven non-dispatch releases a reservation`. Include exact USD 1 admission and smallest representable excess, eight total dispatches/two repairs, logical tool/create/request/refresh caps, lower supplied limits, stale CAS, two different dispatch IDs racing the same index, duplicate settlement, reported zero, partially known tokens, generation reuse and inconsistent aggregates. Use the complete fixture dispatch and budget from Task 1.

```ts
const encoded = encodeAccountingMoney({ ...dispatch(), _id: 'd', _revision: 0 });
expect(encoded.reservationUsd).toBeInstanceOf(Decimal128);
expect(encoded.pricing.promptUsdPerToken).toBeInstanceOf(Decimal128);
expect(decodeAccountingMoney(encoded)).toEqual({ ...dispatch(), _id: 'd', _revision: 0 });
await accounting.createBudget(budget());
await accounting.putDispatch(dispatch());
await accounting.putDispatch(dispatch());
expect(await accounting.getBudget('u1', 's1', 't1')).toMatchObject({ modelDispatches: 1,
  repairs: 0, reservedUsd: '0.25', settledUsd: '0', deadlineAt: later });
await accounting.putDispatch({ ...dispatch(), status: 'dispatched' });
await accounting.putDispatch({ ...dispatch(), status: 'terminal', endedAt: later,
  money: unavailableMoney(false) });
expect((await accounting.getBudget('u1', 's1', 't1'))?.reservedUsd).toBe('0.25');
```

- [ ] **2. Run.** `npm test -- test/persistence/calendar-accounting.spec.ts -t "same dispatch reserves"`; `npm test -- test/persistence/calendar-accounting.spec.ts -t "Decimal128"`. Expect missing storage/codec support failures.
- [ ] **3. Extend the existing narrow codec, not arbitrary JSON.** Convert only these paths according to kind, returning canonical strings on decode:

| Kind | Decimal128 paths |
| --- | --- |
| `calendar-turn-budget` | `settledUsd`, `reservedUsd`, `_calendarClaims[].reservationUsd` |
| `calendar-model-dispatch` | `reservationUsd`, `money.reportedAmount`, `money.estimatedAmount`, `money.pricing.rateUsd` when present, `pricing.promptUsdPerToken`, `pricing.completionUsdPerToken`, `pricing.requestUsd` |
| `calendar-model-aggregate` | `reportedUsd`, `heldReservationUsd`, and connectorMoney's corresponding money/pricing paths |

Keep existing text/voice paths and legacy `cost` interpretation unchanged. Use canonical validation and `Decimal128.fromString`; do not use `fromStringWithRounding`, `parseFloat`, binary `number` summation, or canonical `Number()` projections for admission/settlement. Validate exact round trip; reject values outside supported decimal precision/scale. Monetary claims contain canonical strings at the internal API boundary and Decimal128 only in BSON.
- [ ] **4. Implement budgets and reservation protocol.** `MongoCalendarAccounting implements CalendarAccountingStore` receives the shared store, existing budgets, `CalendarLimits` defaulting to `CALENDAR_LIMITS` from `calendar-policy.ts` (or stricter values parsed by `calendarLimitsSchema`), and an injected clock. `createBudget` admits zeroed counters/amounts and one absolute deadline on first creation; returns the existing accepted-turn record on a retry from any application attempt without resetting it. CAS protects user/session/turn/createdAt/deadline; counters never decrease, public revision increments, and generic `compareAndSwapBudget` cannot change dispatch/repair counters, monetary totals or private claims. Those changes have **one owner: `putDispatch`**. Generic CAS advances logicalTools/creates/Calendar/refresh requests only, subject to frozen and smaller limits; it preserves all private claims.

Use this explicit nontransactional protocol for a new reserved dispatch:

```text
1. Strictly validate the immutable dispatch identity/pricing/reservation and accepted attempt.
2. Upsert the immutable reserved dispatch draft at key('calendar-model-dispatch',userId,turnId,dispatchIndex);
   bind dispatchId in its validated payload. Different IDs racing one index hit the same _id:
   the losing payload fails idempotency comparison without provoking a duplicate-key mutation.
3. Read the budget and its <=8 private claims through the guarded store.
4. If this dispatchId is already claimed, require the same fingerprint/index/amount; do not increment.
5. Otherwise require dispatchIndex == modelDispatches+1 and an unexpired original deadline;
   require total dispatch and repair headroom, valid rejected-decision provenance for a repair,
   known matching price evidence, and withinSpendCap(settledUsd,reservedUsd,reservationUsd,cap).
6. CAS the SAME budget document: increment dispatches, optionally repairs, revision;
   add the held amount and this bounded claim together. Confirm the exact dispatch claim on reread.
7. Only after BOTH draft and claim are confirmed may putDispatch return success.
```

The claim fingerprint uses the existing hashed tuple/key convention over immutable dispatch identity, attempt/turn/index/reason, repairedDecisionId, requested model/user, connection/config/schema revisions, startedAt, pricing and reservation. It is not based on mutable reported usage. Do not catch a uniqueness/mutation failure and attempt another write through a poisoned journal. Cross-tab contention returns conflict; the existing one-owner executor is still required.

A draft before its budget claim is **not** dispatch authority. Startup/explicit recovery must call the concrete `reconcileReservations(userId,sessionId,turnId)` helper before a new dispatch: inspect at most eight drafts/claims; claim a valid unclaimed draft conservatively or mark it not-dispatched only when non-dispatch is provable. Contradictory/missing evidence, exhausted cap or ambiguous writes quarantine the turn and hold its money; do not reset counters or infer a free dispatch. A claim without its durable draft is corruption/uncertainty, not permission to reconstruct a paid call. No process-local mutex is the durable correctness mechanism. Add the comment `ponytail: eight persisted claims per accepted turn; expanding the dispatch ceiling requires a versioned accounting protocol.`

- [ ] **5. Implement monotone evidence and settlement.** Allowed lifecycle is `reserved -> dispatched -> terminal`, or `reserved -> not-dispatched` with proof no provider dispatch occurred; exact repeats succeed. Never transition dispatched/terminal to not-dispatched. Preserve immutable fields, non-null IDs/timing/tokens/cost evidence, and terminal facts; allow only validated missing-to-known evidence enrichment. A known charge requires `reservationStatus:'settled'`; pending/unknown dispatched cost keeps held reservation after turn failure/cancel/disconnect/restart. Use the same claim ID for terminal settlement and recompute public held/settled totals from distinct durable claimed dispatches, not increment-on-callback arithmetic. A settlement crash may temporarily over-hold, never under-hold; reconcile before admitting another dispatch. Reject known-to-unknown regression or changed known charge. Actual reported cost can exceed the estimate: persist the truth, stop further admissions, and never clip the amount to the cap.

`getDispatch(userId,dispatchId)` uses the owner/kind/dispatchId unique index (its `_id` is the stable turn/index key). `listDispatches(userId,turnId)` sorts by dispatchIndex, fetches nine to detect overflow, validates one consistent session and unique IDs, and returns at most eight. Generation IDs, when present, must not be assigned to another dispatch **or existing legacy generation mapping**; provider request IDs are bounded optional evidence, not a fabricated prerequisite. Pre-read known uniqueness conflicts and reject them before mutations; if a genuine database constraint/ACK failure still reaches the guarded journal, preserve its conservative fail-stop sentinel rather than treating the exception as permission to keep writing.

`putAggregate` validates that dispatchIds equal the complete distinct durable dispatch set for that application attempt, in order, and recomputes reported/held/token totals/status with exact arithmetic. Partial known costs remain a known subtotal with pending/unknown status; do not label missing cost zero. No aggregate can erase an unsettled reservation. Validate calendar/refresh counts against the accepted-turn budget, and keep `connectorMoney` separate from model costs; no speculative connector rate. The aggregate is a bounded cache/summary, not another charge and not dispatch authority.
- [ ] **6. Verify.** `npm test -- test/persistence/calendar-accounting.spec.ts test/persistence/accounting-evidence.spec.ts test/persistence/voice-metadata.spec.ts`; inject a failure at every numbered reservation boundary and between dispatch settlement and budget recomputation. After reconstructing adapters from saved docs, verify no second claim, replenished repair allowance, released unknown hold or silently repeated paid inference. Record actual discovered case counts.
- [ ] **7. Commit.** Message: `feat(calendar-persistence): persist exact dispatch reservations and non-resetting turn budgets`.

## Task 7: Bounded read-compatible reports without double counting

**Files:** Modify `backend/src/persistence/accounting-reporting.ts`, `backend/src/persistence/metadata.ts`; create `backend/test/persistence/calendar-accounting-reporting.spec.ts`; extend existing `backend/test/persistence/accounting-reporting.spec.ts` only for regression expectations.

- [ ] **1. Write failing `dispatch evidence replaces legacy attempt totals once` cases.** Seed same attempt legacy cost `0.9`, two Calendar dispatches with known costs `0.1` and `0.2`, and aggregate `0.3`; plus a different legacy attempt `0.4` and unchanged voice rows. Expected text reported total is `0.7`, not `1.9`, `1`, or `0.4`; one accepted turn counts once even across multiple application attempts, while each attempt and dispatch keeps its own count. Also test missing/stale aggregate, draft/held/unknown dispatch, zero known cost, empty-visible/tool-only/failed/cancelled dispatch, legacy rows with only numeric cost, mixed user/range/cursor, and 10,001-input overflow.

```ts
expect(textTotals.reportedTotal).toBe('0.7');
expect(textTotals.requestCount).toBe(1);
expect(textTotals.executionAttemptCount).toBe(2);
expect(textTotals.dispatchCount).toBe(3);
expect(textTotals.spendComplete).toBe(true);
```

For the snippet's exact counts, the two plugin dispatches belong to `a1`, the separate legacy row belongs to `a2` of the same `t1`, and its existing timing dispatchCount is 1. Add a second case with a separate turn to make requestCount 2. Voice totals retain their own existing units, not text dispatch counts.
- [ ] **2. Run.** `npm test -- test/persistence/calendar-accounting-reporting.spec.ts -t "replaces legacy"`. Expect current reporting to omit plugin evidence or count the wrong representation.
- [ ] **3. Extend only the immutable admitted reporting pipeline.** Read bounded raw candidates of kinds legacy accounting/voice accounting/Calendar dispatch/Calendar aggregate, with existing range/user filters, no payload collections. Group by full `(userId,sessionId,turnId,attemptId)` before contributing text totals. If a Calendar dispatch ledger exists for that key, use distinct dispatch records; exclude that attempt's legacy cost and exclude aggregate money as a second contribution. Aggregate alone is not proof of complete dispatch evidence: report corruption/incomplete status, never substitute an apparently known total. Without plugin dispatches/aggregate, preserve the original legacy behavior. Dispatches before aggregate creation remain visible and held/unknown, not invisible zero spend.

Separate semantics in the projection: `requestCount` deduplicates accepted turn; `executionAttemptCount` deduplicates application attempt; `operationCount`/billable/token/cost completeness count model dispatch units once (excluding proven not-dispatched units from billable count); `dispatchCount` counts confirmed dispatched/terminal Calendar rows, adding existing legacy observed count only for legacy-only attempts. Reserved/unclaimed drafts must not be presented as a paid known success; missing claim/settlement evidence makes completeness false. All known totals sum Decimal128. Unknown/null tokens and costs remain incomplete even when visible text is empty. Existing query cap, user scoping, cursor binding, read-only WeakSet/freeze capability and `allowDiskUse:false` remain intact; arbitrary `$out`, `$merge`, caller-supplied pipeline and raw-driver escape stay rejected. Do not introduce `$lookup` over messages/checkpoints or silently drop an input-limit overflow.

The frozen `AccountingReportingRepository.listAccounting` return union is legacy text/voice only. Preserve it as a legacy-row reader; do not squeeze eight dispatches into legacy `timing.dispatchCount` (its schema max is 3), change its return type, or fabricate a lossy legacy numeric row. Add concrete `MongoCalendarAccounting.listAttemptAccounting(userId,sessionId,turnId,attemptId)` returning validated `{dispatches,aggregate,legacy}` with `preferredAttemptAccounting(legacy,aggregate)` for preferred attempt-summary selection. Consumers/P8 can expose a versioned report later through P1; no HTTP endpoint is added here. `accountingTotals` includes Calendar evidence as above; this distinction is explicit in the handoff.
- [ ] **4. Verify.** `npm test -- test/persistence/calendar-accounting-reporting.spec.ts test/persistence/accounting-reporting.spec.ts test/persistence/accounting-evidence.spec.ts test/persistence/mutation-journal.spec.ts`. Native pipeline execution (not merely pipeline snapshots or a mocked aggregate result) is required in Task 10. Ensure legacy voice classification, pending/unknown totals and rejected pipeline escapes are unchanged.
- [ ] **5. Commit.** Message: `feat(calendar-persistence): report dispatch accounting once with legacy compatibility`.

## Task 8: Permission-aware source expiry, all-copy tombstones, and quarantine

**Files:** Create `backend/src/persistence/calendar-retention.ts`, `backend/test/persistence/calendar-retention.spec.ts`; modify Calendar stores and `backend/src/persistence/messages.ts` only for source-aware ingress/read/redaction; add source/audit indexes in `indexes.ts` if required by the exact queries below.

- [ ] **1. Write failing tests.** `earliest source expiry governs every derived copy`, `zero permission never persists Calendar content`, `archive reads tombstone expired assistant details but retain user input`, `cleanup cannot erase unresolved create quarantine`, and `audit expiry never makes a retryable turn new`. Use fake clock exact boundaries, two sources, 24h ceiling, stricter 5-minute deadline, zero/no-store policy input, disconnect, delayed sweeper, repeated cleanup, restore of an expired fixture, and cleanup write failure.

```ts
const early = { ...source(), expiresAt: '2026-10-20T10:05:00.000Z' };
const second = { ...source(), sourceId: 'src2' };
const derived = { ...message(2), role: 'assistant' as const, content: 'Fetched event details',
  sourceProvenance: [early, second] };
clock = () => Date.parse('2026-10-20T10:05:00.000Z');
expect(redactCalendarMessage(derived, clock())).toMatchObject({ content: CALENDAR_TOMBSTONE,
  sourceProvenance: [expect.objectContaining({ sourceId: 'src1', redactedAt: '2026-10-20T10:05:00.000Z' }),
    expect.objectContaining({ sourceId: 'src2', redactedAt: '2026-10-20T10:05:00.000Z' })] });
expect(redactCalendarMessage(message(0), clock()).content).toBe('Hello');
```

The first source expiry redacts the whole derived content, with each source retaining its original expiry and recording redaction. Do not refresh either source's fetchedAt on read/derivation/restore. Include `voiceTranscripts` on a source-derived assistant record and prove the content cannot leak through that alternate archive projection.
- [ ] **2. Run.** `npm test -- test/persistence/calendar-retention.spec.ts -t "earliest source expiry"`. Expect missing retention helper/read enforcement failure.
- [ ] **3. Extend the existing pure redaction helpers and implement the concrete `MongoCalendarRetention` adapter.** Import the Task 5 functions from `calendar-records.ts`; do not create duplicate implementations. They validate P1 records, use original source deadlines, and preserve identity/sequence/provenance. On expiry, set `redactedAt` once; replace all source-derived assistant content/alternate transcripts with `CALENDAR_TOMBSTONE`, set decision content to null, and convert result storage to `tombstone` with reason. Reference-only rows never reconstruct removed content. A source with missing independent minimal-evidence permission prevents durable ingress entirely; it is not a license to save identifiers/hashes/links. Reject source provenance on canonical user messages rather than silently rewriting user-authored input.

Define an internal bounded `calendar-source` record `{schemaVersion:1,kind:'calendar-source',userId,sessionId,source}` using frozen `sourceReferenceSchema`. Expose `registerSource(record)`, `redactSource({userId,sessionId,sourceId,reason,now})`, `sweepPage({userId,now,cursor,limit})`, and `expireAuditPage({userId,now,cursor,limit})` as concrete persistence helpers for P6/P8; `limit` must be <= existing maxPageSize. Register sources before durable derived copies and check the registered source on ingress/read, not only the object's caller-supplied permission. A source's ID/binding/permission/fetchedAt cannot be replaced to extend life; revocation may only shorten or redact. Multi-source derived copies inherit the minimum original deadline, computed using `effectiveSourceExpiry` and supplied policy/header deadlines; absent permission means no retained content.

Fenced sweep order: mark source redacted first (closing reads), then bounded keyset pages of linked tool results, decisions, assistant messages, operation actionSources and receipts; finish only when all these pages are confirmed. Every read path uses the same pure expiry logic plus registered-source revocation, so a failed/delayed sweep cannot disclose content. Read protection covers `MongoMessages.get`, `readPage`, `getReferences`, Calendar decision/result reads, and `MongoCalendarOperations.getByTurn`; do not fix only the sidebar path. Unknown source/unknown policy provenance fails closed, not as unbounded retained data. Metadata source lookup filters cover `resultRef.source.sourceId`, `sources.sourceId`, `actionSources.sourceId`, and `receipt.source.sourceId`, each scoped by user/session and bounded by stable `_id` cursor. Add targeted non-TTL compound indexes for these exact paths and `calendar-source` expiry. No opaque cursor may cross user/source/kind scope.

Operation expiry is special: ordinary receipt writes stay immutable. When permitted content expires, redact receipt htmlLink/source-derived action data immediately; retain only independently allowed reconciliation/dedup fields. For a succeeded operation, the explicit privacy transition to `evidence-expired` clears `action` and `receipt`, preserves original IDs/hash/turn binding and non-content terminal marker, increments revision/sequence, and appends a sanitized expiry event. Do not make a succeeded row replayable because its display link expired. For unknown/dispatching effects, preserve `unknown` quarantine, clear any source-derived `action` under an internal privacy-redacted operation envelope, and expose only a non-executable safe view. P1's executable public operation schema requires a non-null action for dispatching; never fabricate an action just to satisfy it. Internally change dispatching to unknown before clearing action. No future CAS can reverse a privacy-redacted/expired authority into dispatchable state.

Audit expiry uses the earlier immutable 30-day/policy deadline. Redact operational diagnostics/content after that deadline and retain only the independently permitted terminal/dedup/quarantine marker while the accepted turn is retryable. Internal marker schema is explicitly non-executable: `{schemaVersion:1,kind:'calendar-operation-tombstone',userId,sessionId,turnId,operationId,connectionId,connectionRevision,targetRevision,requestHash,googleEventId,terminalState,redactedAt,reason}` with strict bounds; it is stored at the original turn `_id` and preserved unique turn identity. Only fields explicitly allowed by the policy may remain. `getByTurn`/`reserve` detect this kind and return a safe `evidence-expired` public view only if all mandatory frozen fields remain independently permitted; otherwise throw a safe `NOT_READY` and require operator reconciliation, never return null. Unknown operations retain a minimal `unknown` quarantine and bounded escalation marker; no TTL or audit sweep may erase them into eligibility. No repeated action/request content, credentials, unbounded escalation history, or new Google event ID enters that marker.

If policy does not allow the required minimum marker, **block admission before dispatch** and report the G9 gate. If a later removal policy invalidates even that evidence, disable/quarantine the affected connection/turn and require operator handling; do not claim a safe automated retry. Same rule applies to connector usage/source IDs and hashes: none are automatically non-content. Expiring pending/unknown usage does not settle its spend to zero; retain the permitted hold/quarantine, prevent further affected admissions and escalate within the bounded policy. Unknown costs and unknown effects remain distinct.

Expired/consumed OAuth states become their secret-free tombstones through guarded CAS. No background timer, separate owner, filesystem backup deletion or live policy certification is introduced. P8 schedules bounded sweeps using the existing owner, documents external cache/backup retention, and ensures restore-time redaction before readiness. Task 9's reference-only graph storage means no Calendar detail bodies need binary checkpoint surgery.
- [ ] **4. Verify.** `npm test -- test/persistence/calendar-retention.spec.ts test/persistence/calendar-evidence.spec.ts test/persistence/calendar-operations.spec.ts test/persistence/voice-messages.spec.ts`. Assert secret/event-detail sentinel strings disappear from every persisted mutable copy and every returned archive/context projection, identity/sequence references remain valid, canonical user content is unchanged, and a partially failed sweep remains blocked on reads/replay.
- [ ] **5. Commit.** Message: `feat(calendar-persistence): redact source-linked content without losing replay quarantine`.

## Task 9: Reference-only graph persistence and shared bundle handoff

**Files:** Create `backend/src/persistence/calendar-checkpoints.ts`, `backend/test/persistence/calendar-checkpoints.spec.ts`; modify `backend/src/persistence/checkpoints.ts`, `backend/src/persistence/persistence.ts`, `backend/src/persistence/index.ts`.

- [ ] **1. Write failing `Calendar checkpoint channel rejects content and retains bounded references only` tests.** Use `ScopedMongoSaver` fixture owner/client and ensure rejection occurs before stock saver writes. The concrete persistence-only `calendarCheckpointRefsSchema` is:

```ts
export const calendarCheckpointRefsSchema = z.object({
  version: z.literal(1), userId: idSchema, sessionId: idSchema, turnId: idSchema,
  decisionIds: z.array(idSchema).max(8), toolCallIds: z.array(idSchema).max(6),
  operationId: idSchema.nullable(),
}).strict();
```

The P6 handoff uses a dedicated graph channel named `calendarRefs` containing only this shape. Tests reject extra `content`, `result`, `messages`, credentials, native tool groups, mismatched owner/session/turn, over-bound refs, and Calendar content written through ordinary `messages`/task pending channels. Test stock text/voice checkpoints without Calendar fields unchanged; expired restored fixture references do not expose data via Calendar stores.
- [ ] **2. Run.** `npm test -- test/persistence/calendar-checkpoints.spec.ts -t "rejects content"`. Expect missing validator or previously accepted content failure.
- [ ] **3. Implement the bounded reference validator at both saver entry points.** Before serializing in `put`, validate `channel_values.calendarRefs` against the schema and lease scope; before `putWrites`, validate its `calendarRefs` pending value. When Calendar refs are present, reject durable native tool message/result groups or source-derived Calendar message/result/decision objects anywhere in checkpoint channel values, metadata, or pending writes; walk only plain serializable data with an explicit finite node/byte ceiling covered by existing checkpoint budget. Reject opaque/unsupported Calendar-bearing serialization rather than stripping unrecognized content. `calendar-checkpoints.ts` exports `assertCalendarCheckpointSafe(value,scope)` for the runtime and saver tests. Runtime P6 must keep native tool groups/provisional fetched/derived text volatile, checkpoint only IDs, and hydrate via the permission-aware ledger; provenance cannot be omitted to sneak data into an otherwise untagged string. On restart, missing/expired references lead to bounded refetch or safe interruption, never a write replay. Existing pre-plugin checkpoints contain no Calendar content; restored new checkpoints reference already protected stores. Any actual legacy fixture containing Calendar bodies is quarantined/refused, not silently certified clean.

Expose the following additive bundle fields using the **same `RecordStore`/budgets/clock** already built inside `createPersistenceBundle`:

```ts
calendarConnections: new MongoCalendarConnections(store, budgets),
calendarOperations: new MongoCalendarOperations(store, budgets),
calendarDecisions: new MongoCalendarDecisions(store, budgets),
calendarResults: new MongoCalendarResults(store, budgets),
calendarAccounting: new MongoCalendarAccounting(store, budgets),
calendarRetention: new MongoCalendarRetention(store, budgets),
```

Use constructor options for injected clock/stricter Calendar limits/policy deadlines where needed; defaults must never grant retention permission. Export classes/helpers from the existing persistence barrel. Do not instantiate a second `MongoClient`, `MongoOwnership`, `MongoDBSaver`, runtime, timer or close callback. Plugin disabled/text-only mode must still open existing storage without Google secrets, encryption key or retained-data policy. P8 later wires crypto/environment and schedules sweeps; those do not belong in this task.
- [ ] **4. Verify.** `npm test -- test/persistence/calendar-checkpoints.spec.ts test/persistence/mutation-journal.spec.ts test/persistence/local-open.spec.ts`; `npm run build`; `npm run lint`. Native saver binary/pending-write behavior is exercised in Task 10; passing pure validation is not a claim of standard checkpointer/native compatibility.
- [ ] **5. Commit.** Message: `feat(calendar-persistence): expose shared stores and reference-only graph persistence`.

## Task 10: Isolated-native matrix, migration decision, and P2 exit gate

**Files:** Create `backend/test/persistence/calendar-storage.native.e2e-spec.ts`, `backend/test/persistence/calendar-accounting.native.e2e-spec.ts`, and `backend/test/persistence/calendar-retention.native.e2e-spec.ts`. Reuse `backend/test/persistence/native.ts`; do not modify its prefix/cleanup safety. Extend deterministic files for any defect found. No application-data migration script is planned.

- [ ] **1. Write native tests before any corrective implementation.** Each file uses the existing opt-in pattern:

```ts
const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';
describe.skipIf(!configured)('Calendar isolated native persistence', () => {
  it('admits guarded ownership, unique indexes and replay-safe CAS', async () => {
    const f = await nativeDatabase();
    try {
      expect(f.name.startsWith('aurvin_p2_test_')).toBe(true);
      const hello = await f.client.db('admin').command({ hello: 1 });
      expect(typeof hello.setName).toBe('string');
      expect(hello.isWritablePrimary).toBe(true);
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        const results = await Promise.all([bundle.calendarConnections.create(connection()),
          bundle.calendarConnections.create(connection())]);
        expect(results.every(r => r.outcome === 'confirmed')).toBe(true);
        expect(await f.db.collection('integration_connections').countDocuments({ userId: 'u1' })).toBe(1);
      } finally { await bundle.owner.releaseExecutor(); }
    } finally { await f.close(); }
  });
});
```

The first bootstrap fixture confirms base native behavior. Add a second production-admitted fixture using the same generated database: claim a local executor with an exact local binding and bootstrap mutation token, construct `MutationJournal`, pass `guardedClient` and `{controlStore,journal}` to `createPersistenceBundle`, and finish/release through the existing owner protocol. Reuse setup patterns in `ownership.native.e2e-spec.ts`/`local-owner.spec.ts`; do not invent a takeover or use `openPersistence` against application configuration. Verify replica-set URI options/primary before calling this an admitted-native result. A configured but non-admitted standalone instance fails that gate; it is not silently skipped/certified. Raw test-client reads/counts are verification only; all application mutations in the guarded fixture pass the facade.

- [ ] **2. Execute focused commands when prerequisites exist.** From `backend/`:

```powershell
npm run test:e2e -- test/persistence/calendar-storage.native.e2e-spec.ts
npm run test:e2e -- test/persistence/calendar-accounting.native.e2e-spec.ts
npm run test:e2e -- test/persistence/calendar-retention.native.e2e-spec.ts
```

Never fill the URI from application `.env` or invent one. Check prerequisites without printing their values. The first run should expose actual missing behavior; note whether each file was discovered, passed, failed or skipped. If no operator prerequisites exist, run deterministic gates and report native as skipped separately with G2 pending.
- [ ] **3. Implement only fixes required by the following executable matrix.** Each scenario is an independently named native test, not a comment or source-presence assertion:

| Native file | Named scenario and required assertions |
| --- | --- |
| `calendar-storage.native.e2e-spec.ts` | `connection owners and rotation CAS are unique`: different owners isolated; two competing revisions produce one winner; account/target/disconnect invalidation persists; cipher token/AAD swaps fail |
| same | `OAuth consumes once and destroys verifier`: two concurrent consumes yield one preimage; replay/browser/user/exact-expiry fail; raw stored tombstone contains no verifier; no TTL indexes |
| same | `operation reservation and event sequencing survive reconnect`: same accepted turn across attempts has one event ID/operation; conflicting event IDs/sequences fail; current-state/event crash gap can be repaired; succeeded receipt cannot be replaced |
| same | `unknown schema and uncertain mutation quarantine the owner`: corrupt saved kinds/states fail closed; injected before/after ACK failure leaves journal busy and further writes blocked; no second client/owner is introduced |
| `calendar-accounting.native.e2e-spec.ts` | `dispatch claims and repair counters survive reconnect`: reopen adapters, retry same dispatch, race distinct same-index claims, exhaust exactly 8/2; no counter/deadline/hold reset |
| same | `Decimal128 and mixed reports do not double count`: inspect BSON actual types; execute real admitted aggregation; known subtotals/unknown holds, zero cost, every token breakdown, 0.1+0.2, same-attempt legacy+aggregate+dispatch, different-attempt legacy, voice rows and input/cursor bounds |
| same | `settlement crash overholds rather than frees unknown spend`: failure between terminal dispatch and budget update; reconstruct and reconcile; duplicate settlement unchanged; missing/stale aggregate cannot hide cost |
| `calendar-retention.native.e2e-spec.ts` | `source expiry redacts archive ledger and graph references`: fake clock, minimum multi-source lifetime/zero permission, raw persisted copies and each reader checked; source/user/sequence provenance retained; canonical user message unchanged |
| same | `disconnect and restore cannot re-admit content`: mark source revoked, interrupt sweep, reconstruct bundle, read blocked before scrub; stock saver/pending writes hold IDs not Calendar bodies; restored expired fixture remains tombstoned |
| same | `audit expiry retains safe quarantine and refuses replay`: 30-day or stricter deadline, minimal-permitted terminal marker, unresolved unknown not erased, no new event ID or replenished spend, policy forbidding minimal evidence blocks admission |

- [ ] **4. Make and test the additive-migration decision.** No backfill is required: all Calendar kinds/collection are additive; legacy account rows remain readable; indexes are idempotent bootstrap DDL, not data conversion. Prove this by seeding pre-P2 session/message/legacy text/voice/config fixtures in the generated DB, taking canonical sorted snapshots, running `setupIndexes` twice through the admitted facade, and comparing unchanged record payloads/totals. The indexes may differ; payloads must not. Seed conflicting candidate new-kind rows in another generated fixture and prove setup fails without editing/deleting them. Do not execute any migration on application data.

If a newly observed compatibility defect genuinely requires backfill, stop and request ownership for exactly `backend/src/persistence/calendar-additive-migration.ts` and `backend/test/persistence/calendar-additive-migration.spec.ts` plus a named isolated-native test **before writing it**. Require dry-run, explicit target guard, keyset batch limit, CAS/idempotent rerun, interruption/conflict tests and byte-identical unaffected legacy fixtures. Do not modify the P8-owned operations migration or add a startup auto-migration. A change to approved retention/accounting semantics or frozen contracts is a P1/orchestrator blocker, not a migration shortcut.
- [ ] **5. Run final package checks.** `npm test -- test/persistence`; `npm test -- src/admin-config/credential-service.spec.ts`; `npm run build`; `npm run lint`; `npm test`; with the isolated prerequisites, `npm run test:e2e`. Existing unconditional native e2e suites also need that configuration: if absent, report the full e2e run blocked/unrun and the new opt-in Calendar native suites skipped; do not substitute application credentials or claim an empty/skip-only exit passed native acceptance. Record executed file/test counts and native skips distinctly. Azure/no-test behavior commands are unnecessary and cannot establish native/Google compatibility. Frontend/Google/MCP/provider integration is downstream ownership, not certified by these storage checks.
- [ ] **6. Commit.** Message: `test(calendar-persistence): verify isolated native accounting retention and ownership gates`. Stage only named tests and any scoped defect fixes after the orchestrator grants the commit turn; never `git add .`.

## Required P2 handoff and completion boundary

Report every worker commit and `git log -1 --stat <hash>`, exact check commands/counts, actual environment, and a separate native pass/skip/block disposition. Do not ask the orchestrator to ingest this plan.

**P3 storage/crypto handoff:** `calendarConnections` implements frozen create/get/CAS/state ports; owner uniqueness is `(server userId,'google-calendar')`, OAuth state is hashed/browser-bound/<=10 minutes/single-use and returns a preimage only on confirmed consumption. `CalendarSecretCipher` uses the explicit token and verifier AAD tuples above; access and preserved refresh tokens are resealed together on a credential-version rotation. P3 owns browser cookies, OIDC verification, network refresh lock/caps, target verification, disable/disconnect/revoke and secret-free HTTP errors. No grant or live target is certified here.

**P6 accounting/authority handoff:** use one existing bundle and accepted-turn budget across retries/application attempts; `putDispatch` is the durable owner of dispatch/repair/money reservation changes and must resolve successfully before model invocation. Mark dispatched durably before the provider call; reconcile draft/claim/settlement gaps before further dispatch. Persist/reuse decisions/results and the same operation/event ID; confirm current state plus ordered event before advancing. Unknown effects/spend remain unknown and held/quarantined. Model aggregates are verified summaries, not charges; `accountingTotals` prefers dispatch evidence and does not add legacy/aggregate money. Legacy `listAccounting` remains its frozen text/voice union; the concrete Calendar reader supplies typed dispatch/aggregate evidence separately.

**P6/P8 retention/checkpoint handoff:** source registration and independent permission precede durable copies; content deadlines are absolute/earliest/<=24h with zero permission volatile. Source-aware reads are mandatory even before cleanup runs. Persist only bounded `calendarRefs` in graph state; fetched/derived text and native tool groups hydrate from the ledger while permitted and otherwise refetch safely/interrupt. Privacy expiry preserves identity/tombstones and refuses unsafe replay; quarantine cannot be erased by TTL. P8 owns scheduling/drain, approved real-data processing policy, cache/backup/restore procedures and central wiring. Policy forbidding required minimal evidence blocks admission; it is not solved by keeping undocumented hashes.

P2 implementation is complete only when deterministic gates pass and admitted isolated-native evidence is recorded or explicitly marked pending/skipped. Full AC03/08/09/10/12/13 acceptance still requires P3/P6/P8/P9 integration; real Google/header/policy, live model and Azure compatibility are **not certified**. G9 real-data processing approval and P9's separately authorized live gate remain open. Review is **skipped**, never passed.
