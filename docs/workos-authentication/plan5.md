# Explicit Super Admin Bootstrap and Legacy-Owner Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide an explicit, stopped-application operator command that inspects legacy ownership without mutations and inserts the first Super Admin mapping without rewriting existing personal data.

**Architecture:** Select an already provisioned, exact WorkOS subject through P1's bounded `getUser` adapter; do not create users or accept passwords in this command. A separate read-only MongoDB inspection closes before adoption opens the existing admitted persistence lifecycle. Adoption repeats the checks under executor ownership and performs exactly one confirmed `users.insert`, retaining the explicitly selected legacy internal ID.

**Tech Stack:** Existing TypeScript NodeNext/ESM, Node built-ins, MongoDB driver 6, WorkOS provider adapter, MongoUsers/RecordStore, Zod and Vitest. No dependencies, runtime, HTTP endpoint, startup migration or credential-handling framework added.

---

## Scope, gates and inspected interfaces

- Inputs: [goal.md](goal.md), especially AC7 and “Initial Super Admin and existing data”; [research.md](research.md), sections 8–9; [state.md](state.md), P5 and the separate planner/worker dependency matrix; committed [plan2.md](plan2.md) and [plan3.md](plan3.md). This document is **planning**, not implemented capability or migration evidence.
- Planning prerequisites are satisfied by P1 implementation and committed P2/P3 plans. **Execution still waits for both P2 and P3 workers**, their passing/recorded checks and commits, and this committed plan. Do not treat the user's reference to completed upstream plans as completed upstream workers. Refresh the state before execution.
- Unified review remains **skipped**. Use the available `executing-plans` and `test-driven-development` skills when implementing. The template's `superpowers:` names refer to those available skills, not a new agent hierarchy. An assigned worker executes directly; do not dispatch another worker/reviewer.
- P1's implemented `backend/src/contracts/auth.ts` exports `UserAccount`, `UsersRepository`, `normalizedEmailSchema`, `userAccountSchema`. Repository methods are `get`, `bySubject`, `byEmail`, `insert`, `compareAndSwap`, `list`; `insert` returns a confirmed `AccountRead` or throws. `MongoUsers.insert` preserves explicit `userId`; its CAS deliberately cannot change identity/role. **Use insert, never CAS promotion or an upsert written here.**
- P1's `backend/src/auth/provider.ts` exports `createWorkosProvider`, `AuthProvider` and `ProviderUser = { id, email, externalId: string | null }`; `getUser(workosUserId)` already has a ten-second bound and no SDK retries. No new SDK wrapper is needed.
- `loadBootstrapConfig` supplies infrastructure, legacy `identity.userId`, native profile, safety budgets and `workos`. The runtime must not fall back to that legacy owner. This script constructs only `source: 'bootstrap-operator'` attribution, never an authenticated principal.
- `openPersistence`/`createPersistenceBundle` **claim/take over executor state and create indexes/checkpointer setup**. They cannot implement a non-mutating preflight. Read-only inspection uses a short-lived driver client, no bundle/checkpointer/repository construction, and closes before the mutation client opens. Adoption uses the existing bundle exactly once; it never constructs AppService/Nest/runtime or a second live client.
- P3's plan changes existing identity callers and recovery; P5 does not edit those files. P2 forbids Super Admin creation through Administration. This script is not imported by runtime code, and unknown WorkOS logins remain closed admission.
- P1's package ownership must be explicitly handed off before Task 6; P5 adds **only one script key**, no lockfile/dependency changes. P5 hands the initial operations document and its commit to P6. Do not edit state/other plans; report handoffs to the orchestrator.
- Documentation consultation: Context7 `/mongodb/node-mongodb-native/v6.20.0` confirms projection, bounded cursor and primary-read interfaces; `/workos/workos-node` confirms `getUser(userId)` is exact-ID retrieval; `/websites/mongodb_database-tools` confirms secret-bearing `--config`, gzip archives and isolated namespace remapping with `--nsFrom`/`--nsTo`. Installed P1 source is authoritative for Aurvin's bounded adapter. These are API checks, not live WorkOS or database evidence.

### Deliberate narrow choices

1. **Select, do not provision:** An operator separately provisions/selects the intended password-enabled WorkOS account under separate authorization, then supplies its exact subject and expected email. The goal permits “provisions or selects.” This command never accepts a password, sends email, changes WorkOS email/password/externalId or looks up a subject by email. `externalId` may be null or the selected legacy ID; a different value refuses. Local mapping remains authoritative; null is not silently rewritten.
2. **First administrator only:** Any existing Super Admin, including an inactive one, refuses both modes. Existing mapping for owner, subject or normalized email refuses, including exact repeats. There is no `--force`, update, promotion, replacement, reactivation, rollback or “already succeeded” success path.
3. **One unambiguous legacy dataset:** All personal owner-bearing records must belong to the explicit selected owner; mixed/missing/invalid owners refuse even if some belong to another mapped account. This intentionally conservative one-time command does not transfer a subset or infer which account owns ambiguous data. Empty personal data is allowed for a fresh installation with an explicit legacy ID. Global `config` is not a personal-owner source.
4. **Bounded inspection:** At most 5,000 projected rows per inspected collection, cursor batches at most 50, per-query/connect time at most ten seconds. Seeing row 5,001 refuses; never truncate and approve. This is an offline one-time ceiling, not a new application budget. Hashed checkpoint thread IDs must match sessions owned by the selected ID; never infer an owner from checkpoint payload or parse a hash. Unknown/orphan threads refuse.
5. **No plugin credential read:** Inspection does not project encrypted credentials or decrypt tokens. It reports `preserved-unverified`, not “connected/valid.” Fixture tests prove unchanged owner/AAD/key can still open a synthetic grant, and wrong keys/owners cannot. Real consent/key validity remains an operator verification/reconnect gate using existing plugin controls. No resealing, invented consent or plugin migration is added.
6. **No stop detection promise:** `--app-stopped`, `--backup-confirmed`, `--authorized` and exact `--confirm-owner` are explicit operator attestations, not process-death proof or a verified backup. Default executor admission can take over a sentinel; it does not exclude an overlapping backend. Operations must freeze every writer/disable watch/supervision and prove shutdown. Retained local-recovery state is admitted only through its existing clean handoff, never toggled off or deleted.

## File responsibility map

| Action/path | Responsibility |
| --- | --- |
| Create `backend/src/scripts/bootstrap-auth.ts` | Strict operator arguments, bounded projected inspection, pure refusal checks, one confirmed account insertion and redacted CLI/lifecycle. Keep in one script; no general migration framework. |
| Create `backend/test/auth/bootstrap-auth.spec.ts` | Parser, read-only inspection, real MongoUsers fixture insertion/refusal, lifecycle/redaction and synthetic data/AAD preservation. Reuse P1 fixtures; no native URI/WorkOS calls. |
| Modify `backend/package.json`, scripts object only | `auth:bootstrap` invokes the compiled script; package-owner handoff required. |
| Create `docs/workos-authentication/operations.md` | Explicit authorized commands, prerequisites, backup/restore/rollback, verification and initially unrun migration ledger. |

All `npm` commands below run in **`backend/`**, Git commands at **repository root**. Every numbered checkbox is one approximately 2–5 minute action. For parameterized tests, add/run one case at a time; for long implementation blocks, add one named function at a time after its RED case. Retain full headers on both new TypeScript files. Local imports always end in `.js`. No code or database command is executed merely by writing this plan.

## Task 0 — Confirm gates and preserve other work (no code commit)

**Files:** Read only current state, upstream summaries and Git metadata. Do not edit any of the eight preserved files.

- [ ] **Step 1 — Confirm P2/P3 worker completion and obtain the package-script handoff/commit slot.** Run:

```powershell
git status --short
git diff --cached --name-only
git log -5 --oneline
```

At this planner's initial inspection, the following eight user files were **already staged**, not an empty index. Concurrent work can change repository status before implementation; refresh it, never recreate earlier staged/dirty state. Preserve current user bytes **and index entries**:

```text
backend/src/chat-runtime/durable-chat-runtime.ts
backend/src/persistence/sessions.ts
backend/test/persistence/voice-messages.native.e2e-spec.ts
backend/test/persistence/voice-messages.spec.ts
backend/test/runtime/voice-acceptance.native.e2e-spec.ts
frontend/src/features/chat/state/chat-reducer.ts
frontend/src/features/chat/state/memory-save-state.test.ts
frontend/src/features/chat/state/voice-draft-lock.test.ts
```

Never stage, unstage, reset, stash, overwrite or commit them. Preserve `.env`, `.openchamber/` and intervening changes. Stage named task files only. Every commit command below uses `git commit --only <task paths>` so unrelated staged changes cannot enter the commit; still serialize the shared commit slot. Stop if an owned target already has someone else's work.

- [ ] **Step 2 — Record baseline evidence without reading secrets.** At repository root:

```powershell
$preserved = @(
  'backend/src/chat-runtime/durable-chat-runtime.ts',
  'backend/src/persistence/sessions.ts',
  'backend/test/persistence/voice-messages.native.e2e-spec.ts',
  'backend/test/persistence/voice-messages.spec.ts',
  'backend/test/runtime/voice-acceptance.native.e2e-spec.ts',
  'frontend/src/features/chat/state/chat-reducer.ts',
  'frontend/src/features/chat/state/memory-save-state.test.ts',
  'frontend/src/features/chat/state/voice-draft-lock.test.ts'
)
$evidence = Join-Path 'C:/Users/Peter/AppData/Local/Temp/opencode' ('aurvin-p5-' + [guid]::NewGuid() + '.json')
$baseline = @{
  index = @(git ls-files --stage -- $preserved)
  hashes = @($preserved | ForEach-Object {
    @{ path = $_; sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash }
  })
}
$baseline | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $evidence
```

Expected: one local evidence file outside Git, no repository writes. Retain `$evidence` for the final comparison. No copying credentials, environment files or private database contents. If another authorized worker changes one of these files during execution, report the intervening change; do not revert it to make a baseline assertion pass.
- [ ] **Step 3 — Baseline offline checks.** Run `npm run build`, `npm run lint`, `npm test`; record existing failures/counts/skips. Missing dependencies are a blocker, not permission to install/rewrite locks during planning. No native/live/provider checks or real bootstrap.

## Task 1 — Exact operator arguments and closed faults

**Files:** Create `backend/test/auth/bootstrap-auth.spec.ts`; create `backend/src/scripts/bootstrap-auth.ts`.

- [ ] **Step 1 — Write the exact failing parser tests.** Initial test file:

```ts
/**
 * ============================================================================
 * FILE: bootstrap-auth.spec.ts
 * LOCATION: backend/test/auth/bootstrap-auth.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify explicit bootstrap/adoption without services or application data.
 * ROLE IN PROJECT:
 *    Exercises P5 operator boundaries using deterministic P1 fixtures.
 *    Separates fixture preservation from unrun real migration evidence.
 * KEY COMPONENTS:
 *    - Argument, inspection, insertion, lifecycle and preservation checks.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { parseBootstrapArguments } from '../../src/scripts/bootstrap-auth.js';

const selection = ['--workos-user', 'user_operator', '--email', ' Admin@Example.com ',
  '--legacy-owner', 'aurvin-dev-user'];
const acknowledgements = ['--confirm-owner', 'aurvin-dev-user', '--app-stopped',
  '--backup-confirmed', '--authorized'];

it('requires explicit preflight selection and normalizes only email', () => {
  expect(parseBootstrapArguments(['preflight', ...selection])).toEqual({
    mode: 'preflight', workosUserId: 'user_operator', emailNormalized: 'admin@example.com',
    legacyOwner: 'aurvin-dev-user', authorized: false,
  });
});
it('requires all adoption acknowledgements and exact owner confirmation', () => {
  expect(parseBootstrapArguments(['adopt', ...selection, ...acknowledgements]).authorized).toBe(true);
  for (const flag of ['--app-stopped', '--backup-confirmed', '--authorized']) {
    expect(() => parseBootstrapArguments(['adopt', ...selection,
      ...acknowledgements.filter(v => v !== flag)])).toThrow('INVALID_ARGUMENTS');
  }
  expect(() => parseBootstrapArguments(['adopt', ...selection, ...acknowledgements,
    '--confirm-owner', 'other'])).toThrow('INVALID_ARGUMENTS');
});
it.each([
  [], ['adopt', ...selection], ['preflight'], ['login', ...selection],
  ['preflight', ...selection, '--force'], ['preflight', ...selection, '--password', 'secret'],
  ['preflight', ...selection, '--email', 'other@example.com'],
  ['preflight', ...selection, '--authorized'],
  ['preflight', '--workos-user', 'not-a-subject', '--email', 'admin@example.com', '--legacy-owner', 'owner'],
  ['preflight', '--workos-user', 'user_x', '--email', 'bad', '--legacy-owner', 'owner'],
  ['preflight', '--workos-user', 'user_x', '--email', 'a@example.com', '--legacy-owner', '__aurvin_system__'],
  ['preflight', '--workos-user', 'user_x', '--email', 'a@example.com', '--legacy-owner', ' owner'],
  ['preflight', '--workos-user', 'user_x', '--email', 'a@example.com', '--legacy-owner', 'x'.repeat(129)],
].map(argv => ({ argv })))('refuses missing, duplicate, unsupported or malformed arguments: %j', ({ argv }) => {
  expect(() => parseBootstrapArguments(argv)).toThrow('INVALID_ARGUMENTS');
});
```

- [ ] **Step 2 — RED.** `npm test -- test/auth/bootstrap-auth.spec.ts -t "requires explicit preflight"`. Expected: discovered suite fails on missing script/export, not an SDK call or missing test framework.
- [ ] **Step 3 — Add the minimal parser/fault implementation.** Initial script:

```ts
/**
 * ============================================================================
 * FILE: bootstrap-auth.ts
 * LOCATION: backend/src/scripts/bootstrap-auth.ts
 * ============================================================================
 * PURPOSE:
 *    Explicitly inspect and adopt the first Super Admin's legacy owner ID.
 * ROLE IN PROJECT:
 *    Runs only as an operator command, never during application startup/login.
 *    Preserves personal records and uses the existing executor for insertion.
 * KEY COMPONENTS:
 *    - Argument parsing, read-only inspection, guarded insertion and safe CLI.
 * ============================================================================
 */
import { normalizedEmailSchema } from '../contracts/auth.js';
import { idSchema } from '../contracts/identifiers.js';

type FaultCode = 'INVALID_ARGUMENTS' | 'CONFIGURATION_REQUIRED' | 'TARGET_MISMATCH'
  | 'ALREADY_BOOTSTRAPPED' | 'ACCOUNT_CONFLICT' | 'AMBIGUOUS_OWNER' | 'INSPECTION_LIMIT'
  | 'RECOVERY_REQUIRED' | 'UNSUPPORTED_TOPOLOGY' | 'PROVIDER_UNAVAILABLE'
  | 'STORAGE_UNAVAILABLE' | 'WRITE_UNCONFIRMED' | 'CLOSE_UNCONFIRMED' | 'CANCELLED';
export class BootstrapFault extends Error {
  constructor(readonly code: FaultCode) { super(code); }
}
export type BootstrapArguments = {
  mode: 'preflight' | 'adopt'; workosUserId: string; emailNormalized: string;
  legacyOwner: string; authorized: boolean;
};
export function parseBootstrapArguments(argv: string[]): BootstrapArguments {
  const bad = (): never => { throw new BootstrapFault('INVALID_ARGUMENTS'); };
  const [mode, ...rest] = argv;
  if (mode !== 'preflight' && mode !== 'adopt') return bad();
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const valueFlags = new Set(['--workos-user', '--email', '--legacy-owner', '--confirm-owner']);
  const switchFlags = new Set(['--app-stopped', '--backup-confirmed', '--authorized']);
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (values.has(flag) || switches.has(flag)) return bad();
    if (valueFlags.has(flag)) {
      const value = rest[++i];
      if (!value || value.startsWith('--')) return bad();
      values.set(flag, value);
    } else if (switchFlags.has(flag)) switches.add(flag);
    else return bad();
  }
  const owner = values.get('--legacy-owner');
  const subject = values.get('--workos-user');
  const email = normalizedEmailSchema.safeParse(values.get('--email'));
  if (!owner || !idSchema.safeParse(owner).success || owner !== owner.trim() ||
    /[\u0000-\u001f\u007f]/.test(owner) || owner.startsWith('__aurvin_') ||
    !subject || !/^user_[A-Za-z0-9_-]+$/.test(subject) || !idSchema.safeParse(subject).success ||
    !email.success) return bad();
  if (mode === 'preflight' && (switches.size !== 0 || values.has('--confirm-owner'))) return bad();
  if (mode === 'adopt' && (switches.size !== 3 || values.get('--confirm-owner') !== owner)) return bad();
  return { mode, workosUserId: subject, emailNormalized: email.data, legacyOwner: owner,
    authorized: mode === 'adopt' };
}
```

- [ ] **Step 4 — GREEN.** `npm test -- test/auth/bootstrap-auth.spec.ts`; all parser cases pass. Missing/duplicate/unknown options never initiate environment loading, DB or WorkOS work once CLI wiring is added.
- [ ] **Step 5 — Commit.**

```bash
git add backend/src/scripts/bootstrap-auth.ts backend/test/auth/bootstrap-auth.spec.ts
git commit --only backend/src/scripts/bootstrap-auth.ts backend/test/auth/bootstrap-auth.spec.ts -m "feat(auth-bootstrap): require explicit operator selection and acknowledgements"
```

## Task 2 — Pure preflight identity, ownership and refusal checks

**Files:** Modify `backend/src/scripts/bootstrap-auth.ts`, `backend/test/auth/bootstrap-auth.spec.ts`.

- [ ] **Step 1 — Add the fixture imports/helpers and failing checks.** Merge these imports into the existing test imports, then append the body:

```ts
import type { Document } from 'mongodb';
import type { ProviderUser } from '../../src/auth/provider.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { graphThreadId, key } from '../../src/persistence/records.js';
import { account } from './fixtures.js';
import { checkBootstrapPreflight, INSPECTION_COLLECTIONS,
  type BootstrapInventory } from '../../src/scripts/bootstrap-auth.js';

const target: ProviderUser = { id: 'user_operator', email: 'admin@example.com', externalId: null };
function bootstrap() {
  return loadBootstrapConfig({ PERSISTENCE_PROFILE: 'native-mongodb',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/fixture?replicaSet=rs0', MONGODB_DB_NAME: 'fixture',
    AURVIN_USER_ID: 'aurvin-dev-user', WORKOS_API_KEY: 'fixture-not-a-key',
    WORKOS_CLIENT_ID: 'client_fixture', WORKOS_COOKIE_PASSWORD: 'x'.repeat(32) });
}
function inventory(): BootstrapInventory {
  return { users: [], sessions: [], messages: [], 'agent-memory': [], metadata: [],
    checkpoints: [], checkpoint_writes: [], integration_connections: [] };
}
function legacyInventory(): BootstrapInventory {
  const rows = inventory();
  rows.sessions.push({ _id: 'session_record', userId: 'aurvin-dev-user', sessionId: 's1',
    execution: { ownerId: null, activeAttemptId: null } });
  rows.messages.push({ _id: 'message_record', userId: 'aurvin-dev-user', sessionId: 's1' });
  rows.metadata.push({ _id: 'usage_record', kind: 'accounting', userId: 'aurvin-dev-user', sessionId: 's1' });
  rows.checkpoints.push({ _id: 'checkpoint_record', thread_id: graphThreadId('aurvin-dev-user', 's1') });
  rows.checkpoint_writes.push({ _id: 'write_record', thread_id: graphThreadId('aurvin-dev-user', 's1') });
  return rows;
}
const args = () => parseBootstrapArguments(['preflight', ...selection]);

it('preflights empty or exact-owner data without mutating its inputs', () => {
  for (const rows of [inventory(), legacyInventory()]) {
    const before = structuredClone(rows);
    const report = checkBootstrapPreflight(args(), bootstrap(), target, rows);
    expect(report).toMatchObject({ userId: 'aurvin-dev-user', workosUserId: 'user_operator',
      emailNormalized: 'admin@example.com', source: 'bootstrap-operator', calendar: 'absent' });
    expect(rows).toEqual(before);
  }
});
it.each([
  ['existing Super Admin', (r: BootstrapInventory) => r.users.push({ _id: 'admin', _revision: 0,
    ...account({ userId: 'admin', role: 'super-admin', status: 'inactive' }) }), 'ALREADY_BOOTSTRAPPED'],
  ['mapped owner', (r: BootstrapInventory) => r.users.push({ _id: 'aurvin-dev-user', _revision: 0,
    ...account({ userId: 'aurvin-dev-user' }) }), 'ACCOUNT_CONFLICT'],
  ['mapped subject', (r: BootstrapInventory) => r.users.push({ _id: 'u1', _revision: 0,
    ...account({ workosUserId: 'user_operator' }) }), 'ACCOUNT_CONFLICT'],
  ['mapped email', (r: BootstrapInventory) => r.users.push({ _id: 'u1', _revision: 0,
    ...account({ emailNormalized: 'admin@example.com' }) }), 'ACCOUNT_CONFLICT'],
  ['mixed message owner', (r: BootstrapInventory) => { r.messages[0]!.userId = 'someone-else'; }, 'AMBIGUOUS_OWNER'],
  ['missing owner', (r: BootstrapInventory) => { delete r.messages[0]!.userId; }, 'AMBIGUOUS_OWNER'],
  ['orphan checkpoint', (r: BootstrapInventory) => { r.checkpoints[0]!.thread_id = 'unknown'; }, 'AMBIGUOUS_OWNER'],
  ['orphan pending write', (r: BootstrapInventory) => { r.checkpoint_writes[0]!.thread_id = 'unknown'; }, 'AMBIGUOUS_OWNER'],
  ['active work', (r: BootstrapInventory) => { r.sessions[0]!.execution = { activeAttemptId: 'a1' }; }, 'RECOVERY_REQUIRED'],
  ['retained local control', (r: BootstrapInventory) => r.metadata.push({ _id: key('executor'),
    _revision: 0, schemaVersion: 1, kind: 'executor', userId: '__aurvin_system__',
    sessionId: '__executor__', ownerId: 'old', local: { pending: true } }), 'RECOVERY_REQUIRED'],
] as const)('refuses %s without rewriting records', (_label, mutate, code) => {
  const rows = legacyInventory(); mutate(rows);
  const before = structuredClone(rows);
  expect(() => checkBootstrapPreflight(args(), bootstrap(), target, rows)).toThrow(code);
  expect(rows).toEqual(before);
});
it.each([
  { ...target, id: 'user_other' }, { ...target, email: 'other@example.com' },
  { ...target, externalId: 'another-owner' },
])('refuses a different provider identity rather than retargeting: %j', candidate => {
  expect(() => checkBootstrapPreflight(args(), bootstrap(), candidate, inventory())).toThrow('TARGET_MISMATCH');
});
it('requires the explicit owner to equal configured AURVIN_USER_ID', () => {
  expect(() => checkBootstrapPreflight({ ...args(), legacyOwner: 'other' }, bootstrap(), target, inventory()))
    .toThrow('TARGET_MISMATCH');
  expect(checkBootstrapPreflight(args(), bootstrap(), { ...target, externalId: 'aurvin-dev-user' }, inventory())
    .userId).toBe('aurvin-dev-user');
});
```

- [ ] **Step 2 — RED.** `npm test -- test/auth/bootstrap-auth.spec.ts -t "preflight|refuses|explicit owner"`. Expect missing preflight export/type; after its skeleton exists, each new negative case must fail on its missing guard before adding that guard.
- [ ] **Step 3 — Add the pure inspection contract and checks.** Add these imports and append the functions; consolidate the existing `normalizedEmailSchema` import:

```ts
import type { Document } from 'mongodb';
import { userAccountSchema } from '../contracts/auth.js';
import type { ProviderUser } from '../auth/provider.js';
import type { BootstrapConfig } from '../platform/config/bootstrap-config.js';
import { decode, executorSchema, graphThreadId, key } from '../persistence/records.js';

export const INSPECTION_COLLECTIONS = ['users', 'sessions', 'messages', 'agent-memory',
  'metadata', 'checkpoints', 'checkpoint_writes', 'integration_connections'] as const;
export type BootstrapInventory = Record<typeof INSPECTION_COLLECTIONS[number], Document[]>;
export type BootstrapReport = {
  userId: string; workosUserId: string; emailNormalized: string; source: 'bootstrap-operator';
  counts: Record<typeof INSPECTION_COLLECTIONS[number], number>;
  calendar: 'absent' | 'preserved-unverified';
};
export function checkBootstrapPreflight(a: BootstrapArguments, b: BootstrapConfig,
  target: ProviderUser, rows: BootstrapInventory, executorId?: string): BootstrapReport {
  if (!b.workos || !b.persistence.mongoUri) throw new BootstrapFault('CONFIGURATION_REQUIRED');
  if (b.persistence.profile !== 'native-mongodb' || b.topology.executor !== 'single-process')
    throw new BootstrapFault('UNSUPPORTED_TOPOLOGY');
  const email = normalizedEmailSchema.safeParse(target.email);
  if (a.legacyOwner !== b.identity.userId || target.id !== a.workosUserId || !email.success ||
    email.data !== a.emailNormalized || (target.externalId !== null && target.externalId !== a.legacyOwner))
    throw new BootstrapFault('TARGET_MISMATCH');
  if (rows.users.some(r => r.role === 'super-admin')) throw new BootstrapFault('ALREADY_BOOTSTRAPPED');
  const accounts = rows.users.map(r => {
    try {
      const value = decode(userAccountSchema, r)!;
      if (r._id !== value.userId || !Number.isSafeInteger(r._revision) || r._revision < 0) throw new Error();
      return value;
    } catch { throw new BootstrapFault('ACCOUNT_CONFLICT'); }
  });
  if (accounts.some(r => r.userId === a.legacyOwner || r.workosUserId === a.workosUserId ||
    r.emailNormalized === a.emailNormalized)) throw new BootstrapFault('ACCOUNT_CONFLICT');
  for (const field of ['userId', 'workosUserId', 'emailNormalized'] as const) {
    if (new Set(accounts.map(r => r[field])).size !== accounts.length) throw new BootstrapFault('ACCOUNT_CONFLICT');
  }
  const personalMetadata = rows.metadata.filter(r => r._id !== key('executor'));
  for (const raw of rows.metadata.filter(r => r._id === key('executor'))) {
    try {
      const control = decode(executorSchema, raw)!;
      if (control.ownerId !== executorId && control.local &&
        (!b.topology.localCrashRecovery || !control.local.released || control.local.pending ||
          control.local.mutation.state !== 'idle' || control.local.ancestors.length !== 0)) throw new Error();
    } catch { throw new BootstrapFault('RECOVERY_REQUIRED'); }
  }
  for (const list of [rows.sessions, rows.messages, rows['agent-memory'], personalMetadata,
    rows.integration_connections]) {
    if (list.some(r => r.userId !== a.legacyOwner)) throw new BootstrapFault('AMBIGUOUS_OWNER');
  }
  if (rows.sessions.some(r => r.execution?.ownerId != null || r.execution?.activeAttemptId != null))
    throw new BootstrapFault('RECOVERY_REQUIRED');
  const threads = new Set<string>();
  for (const session of rows.sessions) {
    if (!idSchema.safeParse(session.sessionId).success) throw new BootstrapFault('AMBIGUOUS_OWNER');
    const thread = graphThreadId(a.legacyOwner, session.sessionId as string);
    if (threads.has(thread)) throw new BootstrapFault('AMBIGUOUS_OWNER');
    threads.add(thread);
  }
  if ([...rows.checkpoints, ...rows.checkpoint_writes].some(r =>
    typeof r.thread_id !== 'string' || !threads.has(r.thread_id))) throw new BootstrapFault('AMBIGUOUS_OWNER');
  return { userId: a.legacyOwner, workosUserId: a.workosUserId, emailNormalized: a.emailNormalized,
    source: 'bootstrap-operator', counts: Object.fromEntries(INSPECTION_COLLECTIONS.map(name =>
      [name, name === 'metadata' ? personalMetadata.length : rows[name].length])) as BootstrapReport['counts'],
    calendar: rows.integration_connections.length === 0 ? 'absent' : 'preserved-unverified' };
}
```

Keep the exact executor-ID exception: do not exclude every `__aurvin_system__` row or every `kind: executor` row. A forged/system-looking personal record remains ambiguous. A malformed retained sentinel blocks; it is never deleted. Post-open checks may observe this command's own busy journal, hence the explicit `executorId` exception; the lifecycle still asserts the executor.

- [ ] **Step 4 — GREEN.** `npm test -- test/auth/bootstrap-auth.spec.ts`. Also add/run these exact boundedness and owner-source cases before Task 3 (the limit check is implemented in Task 3):

```ts
it.each(['sessions', 'messages', 'agent-memory', 'metadata', 'integration_connections'] as const)
('refuses a foreign owner in %s', name => {
  const rows = inventory(); rows[name].push({ _id: 'foreign', userId: 'other' });
  expect(() => checkBootstrapPreflight(args(), bootstrap(), target, rows)).toThrow('AMBIGUOUS_OWNER');
});
it('does not treat a system-looking personal record as the executor', () => {
  const rows = inventory(); rows.metadata.push({ _id: 'not-the-executor', kind: 'executor',
    userId: '__aurvin_system__' });
  expect(() => checkBootstrapPreflight(args(), bootstrap(), target, rows)).toThrow('AMBIGUOUS_OWNER');
});
```

- [ ] **Step 5 — Commit.**

```bash
git add backend/src/scripts/bootstrap-auth.ts backend/test/auth/bootstrap-auth.spec.ts
git commit --only backend/src/scripts/bootstrap-auth.ts backend/test/auth/bootstrap-auth.spec.ts -m "feat(auth-bootstrap): refuse conflicting identities and ambiguous legacy owners"
```

## Task 3 — Actually non-mutating, bounded database inspection

**Files:** Modify `backend/src/scripts/bootstrap-auth.ts`, `backend/test/auth/bootstrap-auth.spec.ts`.

- [ ] **Step 1 — Add the read-only driver fixture and failing tests.** Merge imports then append:

```ts
import type { Db, MongoClient } from 'mongodb';
import { inspectBootstrapDatabase, readBootstrapInventory,
  INSPECTION_LIMIT, INVENTORY_PROJECTION } from '../../src/scripts/bootstrap-auth.js';

function databaseFixture(rows = inventory()) {
  const calls: { name: string; filter: Document; options: Document }[] = [];
  const db = {
    command: vi.fn<(command: Document) => Promise<Document>>(async command => command.hello
      ? { setName: 'rs0', isWritablePrimary: true } : { ok: 1 }),
    collection: vi.fn((name: keyof BootstrapInventory) => ({
      find: (filter: Document, options: Document) => {
        calls.push({ name, filter, options }); let cap = Infinity;
        const cursor = {
          batchSize: vi.fn((_n: number) => cursor),
          limit: vi.fn((n: number) => { cap = n; return cursor; }),
          toArray: vi.fn(async () => rows[name].slice(0, cap).map(row =>
            Object.fromEntries(Object.keys(INVENTORY_PROJECTION).filter(k => Object.hasOwn(row, k))
              .map(k => [k, structuredClone(row[k])])))),
        };
        return cursor;
      },
    })),
  };
  const client = { options: { replicaSet: 'rs0' }, connect: vi.fn(async () => undefined),
    db: vi.fn(() => db), close: vi.fn(async () => undefined) };
  return { db, client, calls, rows };
}
it('inspects by projections and closes the read-only client without opening persistence', async () => {
  const f = databaseFixture(legacyInventory());
  f.rows.messages[0]!.text = 'private message';
  const before = structuredClone(f.rows);
  const rows = await readBootstrapInventory(bootstrap(), f.client as unknown as MongoClient);
  expect(rows.messages[0]).not.toHaveProperty('text');
  expect(f.rows).toEqual(before);
  expect(f.client.close).toHaveBeenCalledTimes(1);
  expect(f.calls.map(c => c.name)).toEqual([...INSPECTION_COLLECTIONS]);
  for (const call of f.calls) {
    expect(call.filter).toEqual({});
    expect(call.options).toMatchObject({ projection: INVENTORY_PROJECTION });
    expect(call.options.maxTimeMS).toBeGreaterThan(0);
    expect(call.options.timeoutMS).toBeLessThanOrEqual(10_000);
  }
  expect(Object.keys(INVENTORY_PROJECTION)).not.toEqual(expect.arrayContaining([
    'credentials', 'checkpoint', 'writes', 'text', 'content', 'ciphertext', 'encryptedVerifier',
  ]));
});
it.each(INSPECTION_COLLECTIONS)('refuses overflow in %s instead of truncating approval', async name => {
  const f = databaseFixture();
  f.rows[name] = Array.from({ length: INSPECTION_LIMIT + 1 }, (_, n) => ({ _id: String(n) }));
  await expect(inspectBootstrapDatabase(f.db as unknown as Db, 1000)).rejects.toThrow('INSPECTION_LIMIT');
});
it.each([
  { setName: 'other', isWritablePrimary: true }, { isWritablePrimary: true },
  { setName: 'rs0', isWritablePrimary: false }, { msg: 'isdbgrid', isWritablePrimary: true },
])('refuses unsupported or unverified native topology: %j', async hello => {
  const f = databaseFixture();
  f.db.command.mockImplementation(async (command: Document) => command.hello ? hello : { ok: 1 });
  await expect(readBootstrapInventory(bootstrap(), f.client as unknown as MongoClient))
    .rejects.toThrow('UNSUPPORTED_TOPOLOGY');
  expect(f.client.close).toHaveBeenCalledTimes(1);
});
it('closes on connection/query failure and never swallows unconfirmed close', async () => {
  const f = databaseFixture(); f.client.connect.mockRejectedValueOnce(new Error('uri=secret'));
  await expect(readBootstrapInventory(bootstrap(), f.client as unknown as MongoClient)).rejects.toThrow('STORAGE_UNAVAILABLE');
  expect(f.client.close).toHaveBeenCalledTimes(1);
  const g = databaseFixture(); g.client.close.mockRejectedValueOnce(new Error('credential'));
  await expect(readBootstrapInventory(bootstrap(), g.client as unknown as MongoClient)).rejects.toThrow('CLOSE_UNCONFIRMED');
});
```

- [ ] **Step 2 — RED.** `npm test -- test/auth/bootstrap-auth.spec.ts -t "inspects|overflow|topology|connection/query"`; missing inspection exports/behavior fail. Routine fixture must not connect to the URI in `bootstrap()`.
- [ ] **Step 3 — Add bounded inspection.** Merge `MongoClient` as a runtime import, `Db` as type, with the existing `Document` type import:

```ts
import { MongoClient, type Db, type Document } from 'mongodb';

export const INSPECTION_LIMIT = 5000;
export const INVENTORY_PROJECTION = {
  _id: 1, _revision: 1, schemaVersion: 1, userId: 1, sessionId: 1, thread_id: 1,
  kind: 1, execution: 1, ownerId: 1, local: 1,
  workosUserId: 1, emailNormalized: 1, role: 1, status: 1, passwordChangeRequired: 1,
  currentWorkosSessionId: 1, sessionEpoch: 1, createdAt: 1, updatedAt: 1,
} as const;
export async function inspectBootstrapDatabase(db: Db, timeoutMs: number): Promise<BootstrapInventory> {
  const rows = {} as BootstrapInventory;
  for (const name of INSPECTION_COLLECTIONS) {
    // ponytail: bounded one-time scan, max 5,000 rows/collection; larger datasets
    // need an explicitly planned paged adoption check, never silent truncation.
    rows[name] = await db.collection(name).find({}, {
      projection: INVENTORY_PROJECTION, maxTimeMS: timeoutMs, timeoutMS: timeoutMs,
    }).batchSize(50).limit(INSPECTION_LIMIT + 1).toArray();
    if (rows[name].length > INSPECTION_LIMIT) throw new BootstrapFault('INSPECTION_LIMIT');
  }
  return rows;
}
function inspectionClient(b: BootstrapConfig): MongoClient {
  return new MongoClient(b.persistence.mongoUri, { appName: 'aurvin-auth-preflight',
    retryWrites: false, retryReads: false, readPreference: 'primary', readConcern: { level: 'majority' },
    connectTimeoutMS: Math.min(b.safety.connectTimeoutMs, 10_000),
    serverSelectionTimeoutMS: Math.min(b.safety.connectTimeoutMs, 10_000),
    timeoutMS: Math.min(b.safety.persistenceTimeoutMs, 10_000) });
}
export async function readBootstrapInventory(b: BootstrapConfig,
  supplied?: Pick<MongoClient, 'options' | 'connect' | 'db' | 'close'>): Promise<BootstrapInventory> {
  if (b.persistence.profile !== 'native-mongodb' || !b.persistence.mongoUri)
    throw new BootstrapFault('UNSUPPORTED_TOPOLOGY');
  const client = supplied ?? inspectionClient(b);
  const timeoutMs = Math.min(b.safety.persistenceTimeoutMs, 10_000);
  try {
    await client.connect();
    await client.db(b.persistence.mongoDbName).command({ ping: 1, maxTimeMS: timeoutMs }, { timeoutMS: timeoutMs });
    const hello = await client.db('admin').command({ hello: 1, maxTimeMS: timeoutMs }, { timeoutMS: timeoutMs });
    if (!client.options.replicaSet || client.options.directConnection || client.options.loadBalanced ||
      hello.setName !== client.options.replicaSet || hello.isWritablePrimary !== true || hello.msg === 'isdbgrid')
      throw new BootstrapFault('UNSUPPORTED_TOPOLOGY');
    return await inspectBootstrapDatabase(client.db(b.persistence.mongoDbName), timeoutMs);
  } catch (error) {
    throw error instanceof BootstrapFault ? error : new BootstrapFault('STORAGE_UNAVAILABLE');
  } finally {
    try { await client.close(); } catch { throw new BootstrapFault('CLOSE_UNCONFIRMED'); }
  }
}
```

This is a read-only **application data** command: only driver handshakes, `ping`, `hello`, `find`/`getMore` and cursor/client cleanup. No `openPersistence`, `setupIndexes`, checkpointer setup, write command, transaction, `$out` or `$merge`. A database may log reads; do not claim it has no server-side observational effects. The post-open recheck reuses this bounded scanner on the admitted database, not a new client.

- [ ] **Step 4 — GREEN and strengthen boundary checks.** Run `npm test -- test/auth/bootstrap-auth.spec.ts` and `npm run build`. Add/run a query-error fixture by making `db.collection` throw, and assert close once/`STORAGE_UNAVAILABLE`. The projection test must assert **each** forbidden field is absent, not just that the whole forbidden list is not present:

```ts
it('never projects credential or transcript payload fields', () => {
  for (const field of ['credentials', 'checkpoint', 'writes', 'text', 'content',
    'ciphertext', 'encryptedVerifier']) expect(INVENTORY_PROJECTION).not.toHaveProperty(field);
});
it('closes when a projected query fails', async () => {
  const f = databaseFixture(); f.db.collection.mockImplementation(() => { throw new Error('raw db failure'); });
  await expect(readBootstrapInventory(bootstrap(), f.client as unknown as MongoClient)).rejects.toThrow('STORAGE_UNAVAILABLE');
  expect(f.client.close).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 5 — Commit.**

```bash
git add backend/src/scripts/bootstrap-auth.ts backend/test/auth/bootstrap-auth.spec.ts
git commit --only backend/src/scripts/bootstrap-auth.ts backend/test/auth/bootstrap-auth.spec.ts -m "feat(auth-bootstrap): inspect legacy data through bounded read-only queries"
```

## Task 4 — One confirmed insertion through existing executor ownership

**Files:** Modify `backend/src/scripts/bootstrap-auth.ts`, `backend/test/auth/bootstrap-auth.spec.ts`.

- [ ] **Step 1 — Add the real MongoUsers fixture and failing adoption checks.** Merge imports and append:

```ts
import { MongoUsers } from '../../src/persistence/users.js';
import { usersStore } from '../persistence/auth-users-fixture.js';
import { at } from './fixtures.js';
import { executeBootstrap, type BootstrapPorts } from '../../src/scripts/bootstrap-auth.js';

function commandFixture(initial = legacyInventory()) {
  const storage = usersStore();
  const users = new MongoUsers(storage.store, storage.owner, 8192);
  const rows = initial;
  const snapshot = (): BootstrapInventory => ({ ...structuredClone(rows),
    users: [...storage.documents.values()].map(r => structuredClone(r)) });
  const close = vi.fn(async () => undefined);
  const assertExecutor = vi.fn(async () => undefined);
  const inspect = vi.fn(async () => snapshot());
  const opened = { users, owner: { executorId: 'bootstrap_executor', assertExecutor },
    inspect: vi.fn(async () => snapshot()), close };
  const open = vi.fn(async () => opened);
  const provider = { getUser: vi.fn(async () => ({ ...target })) };
  const ports: BootstrapPorts = { inspect, open, provider, now: () => new Date(at) };
  return { storage, users, rows, opened, close, assertExecutor, inspect, open, provider, ports };
}
const adoptArgs = () => parseBootstrapArguments(['adopt', ...selection, ...acknowledgements]);

it('preflight never opens admitted persistence or inserts an account', async () => {
  const f = commandFixture();
  expect(await executeBootstrap(args(), bootstrap(), f.ports)).toMatchObject({ outcome: 'preflight' });
  expect(f.open).not.toHaveBeenCalled();
  expect(f.storage.collection.updateOne).not.toHaveBeenCalled();
  expect(f.storage.documents.size).toBe(0);
});
it('inserts exactly one active first Super Admin under the unchanged internal ID', async () => {
  const f = commandFixture();
  const result = await executeBootstrap(adoptArgs(), bootstrap(), f.ports);
  expect(result).toMatchObject({ outcome: 'adopted', userId: 'aurvin-dev-user', source: 'bootstrap-operator' });
  expect((await f.users.get('aurvin-dev-user'))?.account).toEqual(account({ userId: 'aurvin-dev-user',
    workosUserId: 'user_operator', emailNormalized: 'admin@example.com', role: 'super-admin',
    status: 'active', passwordChangeRequired: true, currentWorkosSessionId: null, sessionEpoch: 0 }));
  expect(f.storage.collection.updateOne).toHaveBeenCalledTimes(1);
  expect(f.storage.collection.replaceOne).not.toHaveBeenCalled();
  expect(f.open).toHaveBeenCalledTimes(1);
  expect(f.opened.inspect).toHaveBeenCalledTimes(1);
  expect(f.assertExecutor).toHaveBeenCalledTimes(2);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.provider.getUser).toHaveBeenCalledWith('user_operator');
});
it('refuses a repeat rather than overwriting or reporting a second success', async () => {
  const f = commandFixture(); await executeBootstrap(adoptArgs(), bootstrap(), f.ports);
  const before = structuredClone([...f.storage.documents]);
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow('ALREADY_BOOTSTRAPPED');
  expect([...f.storage.documents]).toEqual(before);
  expect(f.open).toHaveBeenCalledTimes(1);
});
it('rechecks conflicts after opening and closes without insertion', async () => {
  const f = commandFixture(); f.open.mockImplementationOnce(async () => {
    await f.users.insert(account({ userId: 'other', emailNormalized: 'admin@example.com' }));
    f.storage.collection.updateOne.mockClear(); return f.opened;
  });
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow('ACCOUNT_CONFLICT');
  expect(f.storage.collection.updateOne).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledTimes(1);
});
it('does not announce success when insert or close is unconfirmed', async () => {
  const f = commandFixture(); vi.spyOn(f.users, 'insert').mockRejectedValueOnce(new Error('raw write error'));
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow('WRITE_UNCONFIRMED');
  expect(f.close).toHaveBeenCalledTimes(1);
  const g = commandFixture(); g.close.mockRejectedValueOnce(new Error('raw close error'));
  await expect(executeBootstrap(adoptArgs(), bootstrap(), g.ports)).rejects.toThrow('CLOSE_UNCONFIRMED');
  expect(g.storage.documents.size).toBe(1); // May have committed: never compensate/delete or auto-retry.
});
it('refuses provider mismatch and cancellation before opening a mutation client', async () => {
  const f = commandFixture(); f.provider.getUser.mockResolvedValueOnce({ ...target, externalId: 'other' });
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow('TARGET_MISMATCH');
  expect(f.open).not.toHaveBeenCalled();
  const g = commandFixture(); const controller = new AbortController(); controller.abort();
  await expect(executeBootstrap(adoptArgs(), bootstrap(), g.ports, controller.signal)).rejects.toThrow('CANCELLED');
  expect(g.provider.getUser).not.toHaveBeenCalled(); expect(g.open).not.toHaveBeenCalled();
});
```

- [ ] **Step 2 — RED.** `npm test -- test/auth/bootstrap-auth.spec.ts -t "preflight never|inserts exactly|repeat|rechecks|unconfirmed|cancellation"`. Discover the named tests; missing orchestration or guards fail before implementation.
- [ ] **Step 3 — Add the narrow ports and one-write implementation.** Imports and body:

```ts
import { isDeepStrictEqual } from 'node:util';
import type { UsersRepository, UserAccount } from '../contracts/auth.js';
import type { AuthProvider } from '../auth/provider.js';

export type BootstrapOpened = {
  users: UsersRepository; owner: { executorId: string; assertExecutor(): Promise<void> };
  inspect(): Promise<BootstrapInventory>; close(): Promise<void>;
};
export type BootstrapPorts = {
  inspect(b: BootstrapConfig): Promise<BootstrapInventory>;
  open(b: BootstrapConfig): Promise<BootstrapOpened>;
  provider: Pick<AuthProvider, 'getUser'>; now(): Date;
};
export type BootstrapResult = BootstrapReport & { outcome: 'preflight' | 'adopted' };
function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new BootstrapFault('CANCELLED');
}
export async function executeBootstrap(a: BootstrapArguments, b: BootstrapConfig,
  ports: BootstrapPorts, signal?: AbortSignal): Promise<BootstrapResult> {
  checkCancellation(signal);
  if (!b.workos || !b.persistence.mongoUri) throw new BootstrapFault('CONFIGURATION_REQUIRED');
  if (a.mode === 'adopt' && !a.authorized) throw new BootstrapFault('INVALID_ARGUMENTS');
  let target: ProviderUser;
  try { target = await ports.provider.getUser(a.workosUserId); }
  catch { throw new BootstrapFault('PROVIDER_UNAVAILABLE'); }
  checkCancellation(signal);
  const report = checkBootstrapPreflight(a, b, target, await ports.inspect(b));
  checkCancellation(signal);
  if (a.mode === 'preflight') return { ...report, outcome: 'preflight' };
  let opened: BootstrapOpened;
  try { opened = await ports.open(b); }
  catch { throw new BootstrapFault('STORAGE_UNAVAILABLE'); }
  try {
    await opened.owner.assertExecutor();
    const current = checkBootstrapPreflight(a, b, target, await opened.inspect(), opened.owner.executorId);
    checkCancellation(signal);
    if (await opened.users.get(a.legacyOwner) || await opened.users.bySubject(a.workosUserId) ||
      await opened.users.byEmail(a.emailNormalized)) throw new BootstrapFault('ACCOUNT_CONFLICT');
    const now = ports.now().toISOString();
    const next: UserAccount = userAccountSchema.parse({ schemaVersion: 1,
      userId: a.legacyOwner, workosUserId: a.workosUserId, emailNormalized: a.emailNormalized,
      role: 'super-admin', status: 'active', passwordChangeRequired: true,
      currentWorkosSessionId: null, sessionEpoch: 0, createdAt: now, updatedAt: now });
    checkCancellation(signal);
    try {
      const saved = await opened.users.insert(next);
      await opened.owner.assertExecutor();
      if (!isDeepStrictEqual(saved.account, next)) throw new Error();
    } catch { throw new BootstrapFault('WRITE_UNCONFIRMED'); }
    return { ...current, outcome: 'adopted' };
  } finally {
    try { await opened.close(); } catch { throw new BootstrapFault('CLOSE_UNCONFIRMED'); }
  }
}
```

No automatic retry, provider write, compensating delete or account CAS is allowed. Once insertion is dispatched, wait for its confirmed result and close; cancellation cannot undo a committed insertion. A close failure takes precedence over earlier errors because the stop/cleanup state is unknown. If a write/close is unconfirmed, operators inspect the mapping; they never blindly repeat or change the target. No cross-collection transaction or exactly-once process guarantee is claimed.

- [ ] **Step 4 — GREEN and ownership-loss checks.** Run `npm test -- test/auth/bootstrap-auth.spec.ts`; add/run these exact regression cases:

```ts
it('refuses executor loss before insert and treats post-write loss as uncertain', async () => {
  const f = commandFixture(); f.assertExecutor.mockRejectedValueOnce(new Error('not owner'));
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow();
  expect(f.storage.collection.updateOne).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
  const g = commandFixture(); g.assertExecutor.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('lost'));
  await expect(executeBootstrap(adoptArgs(), bootstrap(), g.ports)).rejects.toThrow('WRITE_UNCONFIRMED');
  expect(g.storage.documents.size).toBe(1); expect(g.close).toHaveBeenCalledTimes(1);
});
it('refuses changes to legacy ownership between inspection and mutation', async () => {
  const f = commandFixture(); f.open.mockImplementationOnce(async () => {
    f.rows.messages[0]!.userId = 'other'; return f.opened;
  });
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow('AMBIGUOUS_OWNER');
  expect(f.storage.collection.updateOne).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
});
```

`npm run build` must pass without touching upstream contracts. Repeat/refusal is not a concurrency proof: this is an authorized, stopped-writer command inside the admitted single-process topology.

- [ ] **Step 5 — Commit.**

```bash
git add backend/src/scripts/bootstrap-auth.ts backend/test/auth/bootstrap-auth.spec.ts
git commit --only backend/src/scripts/bootstrap-auth.ts backend/test/auth/bootstrap-auth.spec.ts -m "feat(auth-bootstrap): insert the first administrator through admitted persistence"
```

## Task 5 — CLI lifecycle, default ports and unchanged historical/plugin records

**Files:** Modify `backend/src/scripts/bootstrap-auth.ts`, `backend/test/auth/bootstrap-auth.spec.ts`.

- [ ] **Step 1 — Add failing CLI tests.** Merge imports then append:

```ts
import { runBootstrapCommand } from '../../src/scripts/bootstrap-auth.js';

it('parses before environment loading and prints only safe command outcomes', async () => {
  const load = vi.fn(), stdout = vi.fn(), stderr = vi.fn(), makePorts = vi.fn();
  expect(await runBootstrapCommand({ argv: ['adopt'], loadEnvFile: load, makePorts, stdout, stderr })).toBe(2);
  expect(load).not.toHaveBeenCalled(); expect(makePorts).not.toHaveBeenCalled();
  expect(stderr).toHaveBeenCalledWith('BOOTSTRAP_REFUSED INVALID_ARGUMENTS');
});
it('prints a preflight report without opening admitted persistence', async () => {
  const f = commandFixture(); const stdout = vi.fn(), stderr = vi.fn();
  expect(await runBootstrapCommand({ argv: ['preflight', ...selection], bootstrap: bootstrap(),
    loadEnvFile: () => undefined, makePorts: () => f.ports, stdout, stderr })).toBe(0);
  expect(stdout).toHaveBeenCalledTimes(1);
  expect(stdout.mock.calls[0]![0]).toMatch(/^BOOTSTRAP_PREFLIGHT_OK /);
  expect(stderr).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled();
});
it('prints successful preflight/adoption only after close, never provider or DB details', async () => {
  const f = commandFixture(); const lines: string[] = [];
  expect(await runBootstrapCommand({ argv: ['adopt', ...selection, ...acknowledgements],
    bootstrap: bootstrap(), loadEnvFile: () => undefined, makePorts: () => f.ports,
    stdout: line => { expect(f.close).toHaveBeenCalledTimes(1); lines.push(line); },
    stderr: line => lines.push(line) })).toBe(0);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('BOOTSTRAP_ADOPTED ');
  expect(lines[0]).toContain('"source":"bootstrap-operator"');
  expect(lines[0]).not.toMatch(/fixture-not-a-key|currentWorkosSessionId|sealedSession|password|mongodb:/);
});
it('redacts arbitrary errors and distinguishes uncertain writes from known refusals', async () => {
  const f = commandFixture(); const stderr = vi.fn();
  f.provider.getUser.mockRejectedValueOnce(new Error('apiKey=secret&resetToken=raw'));
  expect(await runBootstrapCommand({ argv: ['preflight', ...selection], bootstrap: bootstrap(),
    loadEnvFile: () => undefined, makePorts: () => f.ports, stderr, stdout: vi.fn() })).toBe(1);
  expect(stderr).toHaveBeenLastCalledWith('BOOTSTRAP_FAILED PROVIDER_UNAVAILABLE');
  const g = commandFixture(); g.close.mockRejectedValueOnce(new Error('password=raw'));
  expect(await runBootstrapCommand({ argv: ['adopt', ...selection, ...acknowledgements], bootstrap: bootstrap(),
    loadEnvFile: () => undefined, makePorts: () => g.ports, stderr, stdout: vi.fn() })).toBe(1);
  expect(stderr).toHaveBeenLastCalledWith('BOOTSTRAP_FAILED CLOSE_UNCONFIRMED');
});
```

- [ ] **Step 2 — RED.** `npm test -- test/auth/bootstrap-auth.spec.ts -t "parses before|prints successful|redacts arbitrary"`; missing CLI export/behavior fails.
- [ ] **Step 3 — Wire defaults and the safe command entry.** Merge imports into existing declarations; add this code **after** the preceding exports, with the entry guard last:

```ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkosProvider } from '../auth/provider.js';
import { loadBootstrapConfig } from '../platform/config/bootstrap-config.js';
import { configurationAdapter } from '../app.service.js';
import { buildRuntimeSnapshot, defaultManageableSettings } from '../platform/config/manageable-config.js';
import { openPersistence } from '../persistence/index.js';

export function defaultBootstrapPorts(b: BootstrapConfig): BootstrapPorts {
  if (!b.workos) throw new BootstrapFault('CONFIGURATION_REQUIRED');
  return {
    provider: createWorkosProvider(b.workos), now: () => new Date(), inspect: readBootstrapInventory,
    open: async bootstrap => {
      const adapter = configurationAdapter(bootstrap, buildRuntimeSnapshot(bootstrap, {
        revision: 0, settings: defaultManageableSettings(),
        credentials: { openrouter: null, deepgram: null },
      }, null));
      const opened = await openPersistence(adapter);
      return { users: opened.users, owner: opened.owner, close: () => opened.close(),
        inspect: () => inspectBootstrapDatabase(opened.owner.store.db,
          Math.min(bootstrap.safety.persistenceTimeoutMs, 10_000)) };
    },
  };
}
export type BootstrapCommandOptions = {
  argv?: string[]; bootstrap?: BootstrapConfig; loadEnvFile?: (path: string) => void;
  makePorts?: (b: BootstrapConfig) => BootstrapPorts; stdout?: (line: string) => void;
  stderr?: (line: string) => void; signal?: AbortSignal;
};
const refused = new Set<FaultCode>(['INVALID_ARGUMENTS', 'CONFIGURATION_REQUIRED', 'TARGET_MISMATCH',
  'ALREADY_BOOTSTRAPPED', 'ACCOUNT_CONFLICT', 'AMBIGUOUS_OWNER', 'INSPECTION_LIMIT',
  'RECOVERY_REQUIRED', 'UNSUPPORTED_TOPOLOGY']);
export async function runBootstrapCommand(o: BootstrapCommandOptions = {}): Promise<number> {
  const stdout = o.stdout ?? (line => { process.stdout.write(`${line}\n`); });
  const stderr = o.stderr ?? (line => { process.stderr.write(`${line}\n`); });
  try {
    const a = parseBootstrapArguments(o.argv ?? process.argv.slice(2));
    (o.loadEnvFile ?? (path => { if (existsSync(path)) process.loadEnvFile(path); }))(resolve(process.cwd(), '.env'));
    const b = o.bootstrap ?? loadBootstrapConfig(process.env);
    const result = await executeBootstrap(a, b, (o.makePorts ?? defaultBootstrapPorts)(b), o.signal);
    // Only this allowlisted report is serialized; never a provider/local account object.
    const { userId, workosUserId, emailNormalized, source, counts, calendar } = result;
    stdout(`BOOTSTRAP_${result.outcome === 'preflight' ? 'PREFLIGHT_OK' : 'ADOPTED'} ${JSON.stringify({
      userId, workosUserId, emailNormalized, source, counts, calendar })}`);
    return 0;
  } catch (error) {
    const code = error instanceof BootstrapFault ? error.code : 'BOOTSTRAP_FAILED';
    const isRefusal = error instanceof BootstrapFault && refused.has(error.code);
    stderr(`BOOTSTRAP_${isRefusal ? 'REFUSED' : 'FAILED'} ${code}`);
    return isRefusal ? 2 : 1;
  }
}
const entry = process.argv[1] ? resolve(process.argv[1]) : null;
if (entry && fileURLToPath(import.meta.url) === entry) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const onMessage = (message: unknown) => { if (message === 'shutdown') controller.abort(); };
  process.once('SIGINT', abort);
  if (process.platform !== 'win32') process.once('SIGTERM', abort);
  process.on('message', onMessage);
  try { process.exitCode = await runBootstrapCommand({ signal: controller.signal }); }
  catch { process.stderr.write('BOOTSTRAP_FAILED BOOTSTRAP_FAILED\n'); process.exitCode = 1; }
  finally {
    process.off('SIGINT', abort);
    if (process.platform !== 'win32') process.off('SIGTERM', abort);
    process.off('message', onMessage);
  }
}
```

The default adapter is the existing unconfigured persistence adapter pattern from `import-config.ts`; it does not load stored global credentials, assets, model catalogues, provider inference or run application initialization. `openPersistence` alone owns mutation-client cleanup; its returned `close()` is called once. The initial read-only client is already closed when this opens. Do not add an alternate connection if upstream P3 changes those exports; coordinate the small interface correction with its owner.

- [ ] **Step 4 — Write the historical-data and encrypted-binding regression test before changing any preservation behavior.** Add imports then append:

```ts
import { CalendarSecretCipher } from '../../src/platform/crypto/calendar-secret-cipher.js';

it('preserves transcript, checkpoints, usage, global config and encrypted Calendar binding', async () => {
  const cipher = new CalendarSecretCipher({ status: 'ready', key: new Uint8Array(32).fill(7) });
  const aad = { version: 1, userId: 'aurvin-dev-user', provider: 'google-calendar',
    connectionId: 'connection_1', credentialVersion: 1, googleSubjectId: 'google_1', tokenKind: 'refresh' };
  const grant = cipher.sealToken(aad, 'synthetic-refresh-token');
  const f = commandFixture();
  f.rows.messages[0] = { ...f.rows.messages[0], messageId: 'm1', turnId: 't1', sequence: 9,
    content: 'synthetic transcript', provenance: { inputId: 'original_input' } };
  f.rows.checkpoints[0]!.checkpoint = Buffer.from('synthetic checkpoint');
  f.rows.checkpoint_writes[0]!.value = Buffer.from('synthetic pending write');
  f.rows.metadata[0]!.openRouterUser = 'aurvin-dev-user';
  f.rows.metadata[0]!.providerGenerationId = 'original_generation';
  f.rows.integration_connections.push({ _id: 'connection', userId: 'aurvin-dev-user',
    provider: 'google-calendar', grantedScopes: ['existing-consent'], credentials: { refresh: grant } });
  const globalConfig = { _id: 'aurvin', revision: 12, updatedBy: 'aurvin-dev-user', settings: { shared: true } };
  const before = structuredClone({ rows: f.rows, globalConfig });
  const result = await executeBootstrap(adoptArgs(), bootstrap(), f.ports);
  expect({ rows: f.rows, globalConfig }).toEqual(before);
  expect(result.calendar).toBe('preserved-unverified');
  expect(cipher.openToken(aad, grant)).toBe('synthetic-refresh-token');
  expect(() => cipher.openToken({ ...aad, userId: 'user_operator' }, grant)).toThrow();
  const wrongKey = new CalendarSecretCipher({ status: 'ready', key: new Uint8Array(32).fill(8) });
  expect(() => wrongKey.openToken(aad, grant)).toThrow();
  expect(f.storage.collection.replaceOne).not.toHaveBeenCalled();
});
```

Expected first run: the preservation case should already PASS because this design has no data-writing port beyond users; this is a regression/invariant check, **not a fabricated RED**. If it fails, first diagnose it and fix only the P5 cause. It proves local fixture preservation/AAD behavior, not actual saver compatibility, real Google consent or refresh success. P6 owns native cross-feature evidence.

- [ ] **Step 5 — Add/run lifecycle cases one at a time.** Exact tests:

```ts
it('does not open mutation persistence after an unconfirmed read-only close', async () => {
  const f = commandFixture();
  const { BootstrapFault } = await import('../../src/scripts/bootstrap-auth.js');
  f.inspect.mockRejectedValueOnce(new BootstrapFault('CLOSE_UNCONFIRMED'));
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow('CLOSE_UNCONFIRMED');
  expect(f.open).not.toHaveBeenCalled();
});
it('cancels after inspection without opening admitted persistence', async () => {
  const f = commandFixture(); const c = new AbortController();
  f.inspect.mockImplementationOnce(async () => { c.abort(); return legacyInventory(); });
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports, c.signal)).rejects.toThrow('CANCELLED');
  expect(f.open).not.toHaveBeenCalled();
});
it('reports reconnect verification without touching an unusable fixture envelope', async () => {
  const f = commandFixture();
  f.rows.integration_connections.push({ _id: 'connection', userId: 'aurvin-dev-user',
    provider: 'google-calendar', status: 'reconnect-required', credentials: { ciphertext: 'invalid-fixture' } });
  const before = structuredClone(f.rows);
  expect((await executeBootstrap(adoptArgs(), bootstrap(), f.ports)).calendar).toBe('preserved-unverified');
  expect(f.rows).toEqual(before);
});
```

- [ ] **Step 6 — GREEN.** `npm test -- test/auth/bootstrap-auth.spec.ts` and `npm run build`. All discovered checks pass; no provider/DB calls escape fixtures. Default-port **assembly** source is not actual native admission evidence. P6 will exercise it on authorized isolated native fixtures and preserve historical metadata excluding legitimate executor/journal/DDL changes.
- [ ] **Step 7 — Commit.**

```bash
git add backend/src/scripts/bootstrap-auth.ts backend/test/auth/bootstrap-auth.spec.ts
git commit --only backend/src/scripts/bootstrap-auth.ts backend/test/auth/bootstrap-auth.spec.ts -m "feat(auth-bootstrap): add redacted CLI and preservation regression checks"
```

## Task 6 — Serialized npm entry and initial operator runbook

**Files:** Modify `backend/package.json`, scripts object only; create `docs/workos-authentication/operations.md`; modify `backend/test/auth/bootstrap-auth.spec.ts`.

- [ ] **Step 1 — Obtain the package/operations handoffs and add failing wiring/document checks.** No lockfile changes. Add `readFileSync` import and append:

```ts
import { readFileSync } from 'node:fs';

it('exposes only the compiled explicit bootstrap entry and records unrun migration gates', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  };
  expect(pkg.scripts['auth:bootstrap']).toBe('node dist/src/scripts/bootstrap-auth.js');
  const runbook = readFileSync(new URL('../../../docs/workos-authentication/operations.md', import.meta.url), 'utf8');
  for (const required of ['## Authorization and evidence boundary', '## Preflight', '## Explicit adoption',
    '## Backup and rollback', '## Verification', '## Evidence ledger', 'Real application-data adoption: **UNRUN**',
    'Review: **SKIPPED**', '--confirm-owner', '--backup-confirmed', 'preserved-unverified']) {
    expect(runbook).toContain(required);
  }
});
```

- [ ] **Step 2 — RED.** `npm test -- test/auth/bootstrap-auth.spec.ts -t "compiled explicit bootstrap"`; fail on missing script/document, not provider/database prerequisites.
- [ ] **Step 3 — Add the script key.** In `backend/package.json`'s existing scripts object, add exactly:

```json
"auth:bootstrap": "node dist/src/scripts/bootstrap-auth.js"
```

Keep surrounding entries; adjust its comma only. `tsconfig.json` uses `rootDir: "."`, so this is `dist/src/scripts/...`, not `dist/scripts/...`. Build first. Do not use tsx/ts-node, add dependencies, change startup scripts or execute this command as a smoke test (it can read real `.env`).

- [ ] **Step 4 — Create the complete initial `operations.md` below.** The shell blocks are operator examples for a future separately authorized maintenance window, **not commands the worker runs**. Placeholder-looking values are concrete illustrative IDs; operators must use the exact privately confirmed values for their environment, not these example identities.

````markdown
# WorkOS bootstrap and legacy-owner operations

## Authorization and evidence boundary

This procedure selects an already provisioned WorkOS identity and creates the first local Aurvin Super Admin. It does not create a WorkOS account, change a password/email/externalId, send email, migrate transcripts or authorize deployment. The CLI is never called from startup or login. WorkOS credentials alone do not admit an unknown local account.

Implementation/fixture evidence is separate from an operator run. Real application-data adoption: **UNRUN**. Live WorkOS validation: **UNRUN**. Backup/restore drill: **UNRUN**. Review: **SKIPPED**. P6 records actual source commits/checks; do not infer a completed migration from source, this runbook or test passes.

Obtain separate explicit authorization for the target database, exact WorkOS environment/subject, legacy owner, maintenance window, backup/restore, live read calls and the one mapping insertion. No infrastructure provisioning, paid service/add-on, live inference, real mailbox test, private-data browsing or public deployment is authorized by the implementation plan.

## Prerequisites and stop boundary

1. Use the approved release after P1–P5 worker gates; record the exact Git SHA and Node/package versions. Backend requires Node `^22.22.3 || ^24.15.0 || >=26.0.0`; use its own lockfile. Build from `backend/` with `npm run build` before these examples.
2. Verify native MongoDB, an explicit replica-set URI naming the intended set, writable primary, admitted `single-process` topology, bounded safety settings and the exact database. Azure/Cosmos/standalone/mongos profiles are not admitted by this command. Never print the URI.
3. An authorized operator must separately provision/select the exact intended WorkOS password account. Confirm the environment and subject from the provider dashboard; do not choose a subject by email search inside Aurvin. Public sign-up off, email/password on, MFA off. WorkOS's existing account must meet P1's password-auth prerequisites; the CLI does not bypass provider email-verification/MFA restrictions. `externalId` must be null or the selected legacy owner, never another internal ID. A null value stays null; Aurvin's unique local subject mapping is authoritative.
4. Configure `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD` (at least 32 characters), persistence settings and the **original** `AURVIN_USER_ID` privately on the server. Existing `AURVIN_CONFIG_ENCRYPTION_KEY` and Calendar infrastructure must be preserved. Do not put secrets in command arguments, evidence, source, chat or `VITE_*`. Do not change `AURVIN_USER_ID` to a WorkOS subject or new UUID.
5. Freeze all writers: stop admissions, drain/reconcile accepted text/voice/accounting work, shut down/close the app and disable watch-mode/supervisor restarts. Also stop other backend copies, maintenance tools and external writers. Prove the exact process is stopped using the existing host procedures. Keep the freeze through backup, preflight, adoption and verification. A CLI flag is an attestation, not proof. The default executor can take over a sentinel; it does not make overlapping processes safe.
6. Reconcile unfinished work under the existing [Phase 1 operations procedures](../aurvin-phase-1/operations.md) and P3 recovery gate **before adoption**. Unmapped legacy work is not permission to run a live backend with a shared development identity. Never clear owner IDs, delete sentinels because leases expired, or replay inference to make bootstrap pass. Local-crash-recovery mode requires its existing clean stopped-owner handoff; never toggle it off to bypass retained local control. Pending/busy/malformed/future state is a stop condition.

## Backup and rollback

Before any mutation, make and verify a complete quiescent backup of the exact database, **including** `users`, `config`, `integration_connections`, `sessions`, `messages`, `agent-memory`, `metadata`, `checkpoints`, `checkpoint_writes` and all other extant collections/index/control records. Old six-collection examples are not sufficient for today's application. Preserve encrypted records and the master key using separate approved secret custody; a database dump without the right key cannot restore Calendar/global credentials.

Use the approved native Database Tools and access-restricted tool config files (not URI/password command arguments). The following PowerShell variables must already be set privately by the operator: `$BackupToolConfig`, `$RestoreToolConfig`, `$SourceDb`, `$RestoreDb`, `$ArchivePath`. `$RestoreDb` is a **new isolated empty database**, never source/application/production. Tools must support `--config`. Keep tool stderr private; it may contain connection details.

```powershell
mongodump --config "$BackupToolConfig" --db "$SourceDb" --archive="$ArchivePath" --gzip
Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256
mongorestore --config "$RestoreToolConfig" --archive="$ArchivePath" --gzip --nsFrom="$SourceDb.*" --nsTo="$RestoreDb.*"
```

A gzip archive is not encrypted: use the approved encrypted, access-restricted backup store. Record release/schema/saver/tool versions, freeze time, collection counts/index definitions, archive hash and restore-test outcome without URI, passwords, tokens or message bodies. Validate the restored database privately against the frozen boundary before checking `--backup-confirmed`. Do not use `--drop` or overwrite a database. Restored executor/control records do not authorize two executors.

There is no automatic undo or `--force`. If write/close outcome is uncertain, keep the app stopped and inspect the exact `users` mapping using authorized read-only access; do not retry, delete the row or change the target. If wrong ownership was selected, keep access closed and treat it as an incident, not an email/ID edit.

Before new application writes, rollback is an explicitly authorized full consistent restore into a **new isolated target**, validation of history/checkpoint/accounting/config/plugin bindings and a separately approved endpoint switch. Never run incompatible pre-auth code against the adopted database or reopen the old shared development identity. After new writes, restoring an earlier backup loses those writes and does not undo WorkOS sessions/external side effects/provider costs; decide retention/reconciliation separately. No partial collection restore, destructive users-row deletion or automatic prompt replay is supplied here. Do not delete/recreate the selected WorkOS account as compensation.

## Preflight

Run only in the separately authorized window; routine fixture checks do not run these examples. All examples run in `backend/`, loading its `.env` server-side. The sample legacy owner is the historic default and the sample subject/email are illustrative, not a target selection recommendation:

```powershell
npm run auth:bootstrap -- preflight --workos-user user_operator --email admin@example.com --legacy-owner aurvin-dev-user
```

This makes an exact-ID, bounded **read-only** WorkOS lookup and read-only native MongoDB inspection. It does not instantiate admitted persistence, set indexes, take over executor state, insert users, decrypt credentials or mutate application data. Read-only client cleanup must finish before success. Server-side connection/read logs may still be generated. No provider response/error bodies are printed.

Expected success: exit 0, one `BOOTSTRAP_PREFLIGHT_OK` report with selected owner/subject/email, `source: bootstrap-operator`, bounded per-collection counts and Calendar assessment. Verify these three identity fields privately against the explicit intended mapping. Reports contain sensitive account metadata, not credentials; restrict their storage.

The owner flag must exactly equal configured `AURVIN_USER_ID`; omission does not silently adopt the default. Empty personal data is allowed for a fresh installation, with explicit selection still mandatory. A preflight report is not a signed migration authorization, process-death proof, backup verification, real plugin check, admission certification or future concurrency lock. Adoption repeats the checks under ownership.

## Explicit adoption

After confirming backup/restore, explicit authorization, exact mapping and stopped writers, run:

```powershell
npm run auth:bootstrap -- adopt --workos-user user_operator --email admin@example.com --legacy-owner aurvin-dev-user --confirm-owner aurvin-dev-user --app-stopped --backup-confirmed --authorized
```

Expected success: exit 0, one `BOOTSTRAP_ADOPTED` report **after** confirmed insertion and persistence close. Exactly one new local `users` account maps the unchanged `aurvin-dev-user` to the exact subject/email, role `super-admin`, active status, `passwordChangeRequired: true`, null current session and epoch zero. The administrator must sign in and replace the bootstrap password before chat/config/admin/plugin access. There is no session or password in the command output.

No historical application document is rewritten: transcript order/IDs, provenance, graph thread IDs, checkpoint bytes/pending writes, accounting attribution and global config remain as stored. Normal admitted opening/closing may create indexes or change executor/journal control metadata; this is why adoption is mutating and preflight is separate. Those control changes are not transcript/accounting migration.

The original Calendar owner, grant, consent, connection IDs, credential versions and encryption key/AAD remain unchanged. `preserved-unverified` means exactly that: bootstrap never decrypts, refreshes or claims live validity. Keep existing connected state only when existing runtime checks and consent/deployment policy permit it. Missing/wrong keys, revoked grants or failed binding checks require **reconnection through the existing plugin UI**; never reseal credentials under another owner or invent consent. A pre-existing reconnect-required connection remains so.

## Refusal and uncertain outcomes

- Exit 2 / `BOOTSTRAP_REFUSED`: malformed/missing/duplicate options or acknowledgements; missing config; mismatched owner/subject/email/externalId; any existing Super Admin; mapped owner/subject/email; ambiguous/mixed/missing owners; orphan checkpoints; unsupported topology; inspection ceiling; unreconciled work/local control. No force/adopt-by-email/update/promote path exists. Fix the identified prerequisite through separately authorized procedures, not credential/owner retargeting.
- At most 5,000 projected records per inspected collection, batches of 50 and ten-second connect/query/WorkOS bounds. Row 5,001 refuses with `INSPECTION_LIMIT`; timeouts fail closed. Larger datasets require a separately planned bounded inspection, not raising constants blindly or skipping collections.
- Exit 1 / `BOOTSTRAP_FAILED`: unavailable service, cancellation, unknown error, `WRITE_UNCONFIRMED` or `CLOSE_UNCONFIRMED`. Never assume no write occurred; keep the application stopped and reconcile the exact mapping plus executor/control state. No automatic retry, rollback, compensation or provider overwrite occurs.
- Any repeat after a confirmed adoption refuses with `ALREADY_BOOTSTRAPPED`; it does not silently succeed or overwrite the account. Repeated refusal is not evidence that the previous close/backup was safe.

## Verification

Routine implementation checks use deterministic fixtures only, from `backend/`:

```powershell
npm test -- test/auth/bootstrap-auth.spec.ts
npm test -- test/persistence/auth-users.spec.ts
npm run build
npm run lint
npm test
npm run test:e2e
```

The inspected P1 repository spec is `test/persistence/auth-users.spec.ts`; its separate native spec is `test/persistence/auth-users.native.e2e-spec.ts`. Native tests can skip without `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; they create/drop generated isolated databases only. Do not point them at application data, print a URI, or count skips/empty discovery as passes. P6 owns cross-feature/native preservation evidence; fixtures do not certify a real MongoDB/WorkOS/Google migration.

In an authorized real maintenance window, verify privately: exactly one intended Super Admin mapping, old internal ID unchanged; all non-control historical records/counts/IDs/order/provenance/accounting/config/encrypted bytes unchanged; no unintended mapping; expected executor close state. After authorized restart verify required first-password change, sign-in/out, own history and existing plugin status; use no paid inference. Live login/email/Google calls require their separate authorization. P6 verifies normal accounts cannot see adopted personal data and Super Admin has no read-all ownership override. Never use a second application process as a migration probe.

## Evidence ledger

| Evidence | Initial disposition |
| --- | --- |
| CLI/unit fixture checks | UNRUN until worker records exact commits/commands/results |
| Package build/lint/test/e2e | UNRUN for P5 until worker records actual outcomes/skips |
| Isolated native preservation | UNRUN; P6 owns authorized fixture evidence |
| Live WorkOS exact-subject/login/email | UNRUN; separate authorization/configuration required |
| Backup/restore/rollback drill | UNRUN; operator-owned separately authorized maintenance |
| Real application-data adoption | UNRUN; never inferred from fixture checks |
| Google grant/decryption/reconnection | UNRUN against real data/services |
| Deployment/Azure certification | NOT AUTHORIZED / NOT ESTABLISHED |
| Unified review | SKIPPED, not passed |

P5 hands this initial runbook and its commit to P6, which adds actual evidence and release gates without relabeling unrun operator actions as completed.
````

- [ ] **Step 5 — GREEN.** `npm test -- test/auth/bootstrap-auth.spec.ts -t "compiled explicit bootstrap"`; `npm run build`. From `backend/`, verify the compiled file exists using `Test-Path dist/src/scripts/bootstrap-auth.js` (expected `True`) **without executing it**. Check `git diff -- backend/package.json`; one script key only, no package-lock change. Check runbook Markdown links exist. If the actual P1 repository spec filename differs from the runbook, correct the command to that exact extant filename now, not after handoff.
- [ ] **Step 6 — Commit.**

```bash
git add backend/package.json backend/test/auth/bootstrap-auth.spec.ts docs/workos-authentication/operations.md
git commit --only backend/package.json backend/test/auth/bootstrap-auth.spec.ts docs/workos-authentication/operations.md -m "docs(auth-bootstrap): add explicit operator commands and adoption runbook"
```

## Task 7 — Offline verification and P6 handoff

**Files:** Only amend `docs/workos-authentication/operations.md`'s fixture/package evidence rows with actual results; no real migration result may be invented. Do not alter state.md; return evidence to its orchestrator owner.

- [ ] **Step 1 — Run focused checks.** From `backend/`:

```powershell
npm test -- test/auth/bootstrap-auth.spec.ts
npm test -- test/persistence/auth-users.spec.ts
npm run build
npm run lint
```

Expected: discovered bootstrap and real MongoUsers fixture assertions pass, TypeScript compiles and lint passes. The P1 spec path above was verified during planning; refresh only if an upstream owner explicitly renames it. Any failure requires diagnosis/correction in P5 ownership or routing to the upstream owner, not weakening auth/inspection. Record actual counts and skipped tests; do not prefill a pass.

- [ ] **Step 2 — Run required backend regressions.** `npm test` and `npm run test:e2e`. Record pre-existing failures separately, native prerequisites/skips separately and exact tested commit set/environment. No `npm run auth:bootstrap`, `.env` read, live WorkOS/email, native application DB, paid inference or real restore is part of routine verification. Frontend is unchanged; P6 runs both package suites.
- [ ] **Step 3 — Check documentation and import boundaries.** Verify `goal.md`, `research.md`, `state.md`, `plan2.md`, `plan3.md` and the runbook's Phase 1 operations link exist. Check that production imports of `bootstrap-auth` do not exist, provider write APIs do not appear in the script and no non-users writes/CAS are introduced. Example read-only checks at repository root:

```powershell
git grep -n 'bootstrap-auth' -- backend/src
git diff --check
git status --short
git diff --cached --name-only
```

Expected: script/self references only, no startup/controller import; no whitespace errors in P5 files. Unrelated existing dirty whitespace is a baseline limitation, not permission to edit preserved files. Compare the eight preserved file SHA256 values and Git index entries with Task 0; both remain unchanged. Inspect each P5 commit's file list to ensure no user work entered it.

Use this exact read-only comparison with the Task 0 `$evidence` path retained in the same PowerShell session:

```powershell
$before = Get-Content -LiteralPath $evidence -Raw | ConvertFrom-Json
$currentIndex = @(git ls-files --stage -- $preserved)
if (($before.index -join "`n") -cne ($currentIndex -join "`n")) { throw 'Preserved index changed; investigate without resetting.' }
foreach ($entry in $before.hashes) {
  if ((Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash -cne $entry.sha256) {
    throw ('Preserved file changed; investigate without resetting: ' + $entry.path)
  }
}
```

- [ ] **Step 4 — Record actual evidence and hand off.** Replace only the first two runbook ledger dispositions with actual commands/counts/commits/limitations. Keep live/native/real adoption/backup/Google/deployment UNRUN unless independently authorized **and actually executed**; P6 may later extend evidence. Report P5 source commits, operations handoff commit, exact CLI interface, `BootstrapPorts`/report contract, deterministic spec path/results, refusal/uncertainty limits and unresolved external gates. Review stays skipped. Do not call the whole workflow complete.
- [ ] **Step 5 — Commit evidence documentation only.**

```bash
git add docs/workos-authentication/operations.md
git commit --only docs/workos-authentication/operations.md -m "docs(auth-bootstrap): record offline verification and operations handoff"
```

## Coverage/self-check (plan completeness, not a code review pass)

| Requirement | Planned task/evidence |
| --- | --- |
| Explicit intended WorkOS subject and legacy owner/confirmation | Task 1 exact parser; Task 2 provider/config matching; Task 6 commands |
| Truly non-mutating DB/WorkOS preflight | Task 3 projected driver reads and close tests; Task 4 proves no admitted open/insertion |
| First active Super Admin only, no automatic login/startup promotion | Tasks 2/4 refuse mapping/admin, insert one active row; Task 7 import-boundary check; P1/P3 admission remains unchanged |
| Preserve old internal ID, ordering/provenance, checkpoint and usage identity | Tasks 2/4 original owner/thread links; Task 5 full synthetic snapshots; P6 actual native integration |
| Safe duplicate/repeat/partial failure behavior | Tasks 2/4 refusals, post-open recheck, write/ownership/close uncertainty; Task 5 safe exit/output tests |
| Valid versus reconnect-required encrypted plugin bindings | Task 5 unchanged envelope/AAD/right-key/wrong-key fixtures; Task 6 `preserved-unverified` and existing reconnection procedure |
| Existing executor/mutation lifecycle and finite limits | Tasks 2/3 local/sentinel/unfinished-work checks and scan ceiling; Tasks 4/5 one admitted owner/close; explicit stopped-writer limitation |
| Backup/rollback and real migration not implied by code | Task 6 full-database/restored-target procedure and UNRUN ledger; Task 7 factual evidence only |
| Scope/ownership/preservation/headers/NodeNext | Task 0 and file map; full new-code headers, `.js` imports, named/path-scoped commits; no dependency/contract/root wiring changes |

Self-check before reporting this plan: all symbols used later are defined above or are inspected existing exports; no unspecified SDK methods or owner-transfer/CAS mutations; all implementation/test steps show exact code, commands and expected RED/GREEN outcomes; no live commands were executed. The pure preservation test intentionally starts green and is labeled honestly. This is not the skipped unified review.

**Planner-only validation:** The 16 TypeScript code blocks were reconstructed into two in-memory virtual files (merging their explicitly instructed imports) and statically checked against the installed backend TypeScript configuration/dependencies: **zero diagnostics**, with no emitted/source files and no application execution. This checks plan syntax/interfaces, not behavior; all implementation, fixture, native and operator evidence remains pending execution. Markdown targets, scope and placeholder consistency are checked separately before the plan-only commit.
