# Integrated Verification and Operations Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce reproducible AC1–AC8 evidence for the assembled WorkOS implementation, including Super Admin plus two isolated Users, real DOM checks and an honest operations handoff.

**Architecture:** Reuse upstream auth, persistence, runtime and assembly fixtures; add only cross-feature regression tests and a development-only browser entry. Mock external providers, not Aurvin authorization or ownership decisions. Record fixture, browser, native and live-service evidence separately; route production defects to their owners rather than patching P1–P5 source.

**Tech Stack:** Existing TypeScript NodeNext, NestJS/Express, Supertest, Vitest 4, React 19, Vite 8, native browser DOM and existing isolated MongoDB fixtures. No new dependency, framework, permission system or production auth bypass.

---

## 1. Execution boundaries and source reconciliation

- Inputs: [goal.md](goal.md), [research.md](research.md), [state.md](state.md), [plan1.md](plan1.md), [plan2.md](plan2.md), [plan3.md](plan3.md), [plan4.md](plan4.md), [plan5.md](plan5.md), root [AGENTS.md](../../AGENTS.md).
- This is a **plan**, not a verification report. At planning inspection, P1/P2/P4 implementations were committed; state recorded P3 in progress and P5 waiting. The task context's “completed implementations” is not sufficient worker-completion evidence. P6 implementation waits for P2/P3/P4/P5 verified worker commits, this plan's commit and P5's explicit `operations.md` handoff. P1 is a transitive prerequisite. Older preparation-era approval paragraphs do not reopen the approved written-goal gate.
- Use the available `executing-plans` skill task-by-task and `test-driven-development` for new test-harness logic. The template's `superpowers:` names map to available skills, not permission for another agent hierarchy. An assigned P6 worker executes directly. Unified review is **skipped**; no reviewer or review-triggered fixer is dispatched.
- P6 edits only its new test directories, `verification.md`, and handed-over `operations.md`. Although state allows relevant README updates, the present assignment does not request them: return any necessary README correction to the orchestrator. Do not edit P1–P5 production files, package manifests/locks, test configs or upstream tests.
- For a failing production assertion: preserve the failing P6 test, identify AC/path/reproduction, return it to P1 (auth/contracts/persistence), P2 (administration), P3 (wiring/isolation/lifecycle), P4 (UI) or P5 (bootstrap). Pause that acceptance gate; resume after the owner's fix commit and rerun affected suites. Do not weaken assertions, mark a regression as skipped, or add a test-only production branch.
- Never read real `.env`/credentials, execute bootstrap against application data, provision WorkOS, send email, run paid inference, enable add-ons, deploy or remove staging access gates. Native checks require supplied isolated-test prerequisites. Live checks require explicit separate authorization; report them unrun otherwise.
- Every checkbox is one approximately 2–5 minute action; run each command separately. Long suites may execute longer. Add one named test at a time. Verification tests may pass immediately against completed upstream work: record that honestly. A deliberately broken **local fixture expectation** may prove test sensitivity; it is not a production defect or a fabricated RED result.

## 2. File and fixture map

| Path | Responsibility |
| --- | --- |
| Create `backend/test/auth/integration/accounts.ts` | Three distinct local accounts sharing real AuthService, AdministrationService and MongoUsers; provider-only deterministic double. |
| Create `backend/test/auth/integration/lifecycle.spec.ts` | Auth → administration → auth admission, onboarding, reset, deactivation, partial failure and bounded attempts. |
| Create `backend/test/auth/integration/owner-config.spec.ts` | Real durable runtime with three authenticated identities, private transcripts, captured attribution and old/new global snapshots. |
| Create `frontend/src/features/auth/integration-tests/auth-browser.html` | DEV-only browser fixture entry and named result regions; no production route. |
| Create `frontend/src/features/auth/integration-tests/auth-browser.tsx` | Mount real App using real API clients with deny-by-default fixture fetch; drive login, onboarding, role navigation, table and account teardown. |
| Create `frontend/src/features/auth/integration-tests/fixture-api.ts` | Small closed fetch/media fixture, counters and owner-tagged data; never a reusable mock auth platform. |
| Create `frontend/src/features/auth/integration-tests/fixture-api.test.ts` | Node checks of fixture refusal, owner routing and deterministic errors; these are not DOM evidence. |
| Create `docs/workos-authentication/verification.md` | Tested commit set, environment, exact commands/counts, AC evidence, defects, browser records and external gates. |
| Finalize `docs/workos-authentication/operations.md` | P5 procedures plus verified auth/session/recovery, configuration and rollout limits. |

Do not create empty e2e/native suites merely to fill directories. Existing P3 assembled suites and P5 bootstrap tests supply those layers; run and cite them. Add an owned integration case only for an actual missing cross-feature assertion. Never use `backend/test/admin-config/integration-fixture.ts` as a working harness: inspection found it exports an unconditional refusal, not an assembled app.

### Existing seams verified during planning

- `backend/test/auth/fixtures.ts`: `account`, `providerFixture`, `at`.
- `backend/test/persistence/auth-users-fixture.ts`: `usersStore`; `MongoUsers(store, owner, 8192)` is a real repository over deterministic storage.
- `AuthService`: `login`, `authenticate`, `password`, `logout`, `forgotPassword`, `resetPassword`. `authenticate` returns `{ principal }`; `login/password` return `{ user, sealedSession }`.
- `AdministrationService`: `list(principal, query)`, `create(principal, body)`, `deactivate(principal, userId, {})`, `reactivate(principal, userId, {})`, `passwordReset(principal, userId, {})`.
- `backend/test/runtime/text-config-fixture.ts`: real `runtime`, `p`, fixture `fetcher`, `publish`, `dispose`; `backend/test/model/config-snapshot.ts`: `textSnapshot`. Do not use its single-owner convenience `submit/execute` helpers for multi-owner acceptance.
- P3 supplies request-bound `RequestIdentityStore`, `configurePrivateHttp` and real assembled auth suites. Their completed commit is authoritative, not a speculative signature from a plan.
- `frontend/src/App.tsx`: accepts `authClient`, `client`, `adminClient`, `calendarClient`, `administrationClient`, `refreshCapabilities`; normally begin without `initialAuthUser` to exercise `/auth/me` and actual login.
- Reuse DOM primitives from `frontend/src/features/admin-config/testing/browser-checks.ts` (`check`, `byLabel`, `typeInput`, `press`). Do not copy the old dashboard fixture's disabled-Sign-out assertion: it predates this feature.
- Frontend test discovery is `src/**/*.test.ts`, **Node environment**. A `.tsx` HTML entry must run in an actual browser, not be reported as covered by `npm test`. Context7 Vitest 4.1.12 environment/discovery documentation was consulted during planning; installed package/configuration determines actual commands.

## Task 0 — Confirm upstream gates and establish evidence (no production edits)

**Files:** Create `docs/workos-authentication/verification.md`; read current state/upstream handoffs.

- [ ] **Step 1:** Obtain P2–P5 completion hashes and P5 operations handoff from the orchestrator. Run at repository root:

```powershell
git status --short
git diff --cached --name-only
git log -12 --oneline
node --version
npm --version
```

Record hashes using `git show --no-patch --format=fuller` on the reported commits. Never infer worker completion from a plan file. Preserve all current staged/unstaged/untracked work, including the eight historical user files in state and `.openchamber/`; do not recreate obsolete dirty state if the current checkout is clean. If another worker is changing a tested dependency, freeze the acceptance run until its commit is available.

- [ ] **Step 2:** Write these initial report sections with actual inspected values: `Scope and authorization`, `Commit set and dirty-tree status`, `Environment and resolved versions`, `Commands and counts`, `AC1–AC8 matrix`, `Browser evidence`, `Defects and owner reruns`, `External/unrun gates`, `Operations handoff`, `Review: skipped`. Initial result is **not run**, never pass. Record the OS, Node/npm, package-lock hashes and resolved WorkOS/Nest/Vitest/React/Vite/MongoDB versions using `npm ls --depth=0` in each package. Do not copy environment variables or private logs.
- [ ] **Step 3:** Run the seven baseline package commands in Task 8, recording status and actual discovered/passed/failed/skipped counts. Do not install dependencies during planning; at implementation, missing dependencies remain a prerequisite until authorized package-local `npm ci` is agreed. No root workspace command exists.
- [ ] **Step 4:** Confirm source/test discovery and safe network seams by opening the completed P3 assembly fixture/suites and P5 script tests. Note exact reusable entry points in the report. Any changed method/fixture interface is reconciled before test writing, not hidden behind `as any`.
- [ ] **Step 5:** Obtain the serialized commit slot; stage only `docs/workos-authentication/verification.md`, inspect `git diff --cached --name-only` and `git diff --cached --check`, then commit as `docs(workos-authentication): establish integrated verification baseline`. If unrelated files are staged, do not unstage them: use a path-limited commit after coordination.

## Task 1 — Three real local accounts and a closed provider fixture

**Files:** Create `backend/test/auth/integration/accounts.ts`, `backend/test/auth/integration/lifecycle.spec.ts`.

- [ ] **Step 1:** Create the lifecycle test with the header below and the first test body from Step 3. Run `npm test -- test/auth/integration/lifecycle.spec.ts -t "keeps three"` in `backend`. Missing fixture is a harness-construction failure, not auth evidence.
- [ ] **Step 2:** Add this complete fixture. It does not bypass local admission or maintain a second account repository:

```ts
/**
 * ============================================================================
 * FILE: accounts.ts
 * LOCATION: backend/test/auth/integration/accounts.ts
 * ============================================================================
 * PURPOSE:
 *    Compose three isolated accounts across real auth and admin services.
 * ROLE IN PROJECT:
 *    Reuses MongoUsers and P1 storage fixtures without network access.
 *    Only the external WorkOS provider is replaced with deterministic results.
 * KEY COMPONENTS:
 *    - accounts: owner-specific provider sessions and shared account services.
 * ============================================================================
 */
import { vi } from 'vitest';
import { AuthService } from '../../../src/auth/auth.service.js';
import { AuthFault } from '../../../src/auth/errors.js';
import { AdministrationService } from '../../../src/administration/administration.service.js';
import { MongoUsers } from '../../../src/persistence/users.js';
import { account, providerFixture } from '../fixtures.js';
import { usersStore } from '../../persistence/auth-users-fixture.js';

export async function accounts() {
  const storage = usersStore();
  const users = new MongoUsers(storage.store, storage.owner, 8192);
  const rows = ['admin', 'a', 'b'].map(userId => account({ userId,
    workosUserId: `user_${userId}`, emailNormalized: `${userId}@example.com`,
    role: userId === 'admin' ? 'super-admin' : 'user', passwordChangeRequired: false }));
  for (const row of rows) await users.insert(row);
  const provider = providerFixture();
  const sessions = new Map<string, { workosUserId: string; sessionId: string }>();
  let sequence = 0;
  provider.login.mockImplementation(async email => {
    const row = await users.byEmail(email);
    if (!row) throw new AuthFault('UNAUTHENTICATED');
    const sessionId = `sid_${++sequence}`;
    const sealedSession = `fixture_sealed_${sequence}`;
    const session = { workosUserId: row.account.workosUserId, sessionId };
    sessions.set(sealedSession, session);
    return { ...session, sealedSession };
  });
  provider.read.mockImplementation(async cookie => {
    const session = sessions.get(cookie);
    if (!session) throw new AuthFault('UNAUTHENTICATED');
    return { ...session };
  });
  provider.revoke.mockImplementation(async sid => {
    for (const [cookie, session] of sessions) if (session.sessionId === sid) sessions.delete(cookie);
  });
  provider.listSessions.mockImplementation(async subject => ({
    ids: [...sessions.values()].filter(s => s.workosUserId === subject).map(s => s.sessionId),
    nextCursor: null,
  }));
  const auth = new AuthService({ users, provider });
  const cleanup = vi.fn<(userId: string) => Promise<void>>(async () => undefined);
  const admin = new AdministrationService({ users, provider, onUserDeactivated: cleanup,
    newUserId: () => 'created' });
  const login = (userId: string) => auth.login({ email: `${userId}@example.com`, password: 'fixture-private' });
  return { storage, users, provider, sessions, auth, admin, cleanup, login };
}
```

The fixture's `read` intentionally accepts issued provider sessions even after local invalidation: local status/SID must be tested independently of successful provider revoke. For that case, replace `revoke` with a rejecting implementation **before** deactivation. Do not claim this double tests provider password policy, SDK crypto or reset replay.

- [ ] **Step 3:** Add this complete first test, rerun the focused command and then the whole new file:

```ts
/**
 * ============================================================================
 * FILE: lifecycle.spec.ts
 * LOCATION: backend/test/auth/integration/lifecycle.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify cross-service account admission and lifecycle fences.
 * ROLE IN PROJECT:
 *    Exercises real auth, administration and users repository together.
 *    Complements assembled HTTP tests without asserting live WorkOS behavior.
 * KEY COMPONENTS:
 *    - Three-owner admission, onboarding, recovery and invalidation cases.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { AuthFault } from '../../../src/auth/errors.js';
import { accounts } from './accounts.js';

it('keeps three simultaneous accounts distinct across auth and administration', async () => {
  const f = await accounts();
  const cookies = await Promise.all(['admin', 'a', 'b'].map(f.login));
  const principals = await Promise.all(cookies.map(c => f.auth.authenticate(c.sealedSession)));
  expect(principals.map(p => p.principal.account.userId)).toEqual(['admin', 'a', 'b']);
  expect((await f.admin.list(principals[0]!.principal, {})).items).toHaveLength(3);
  for (const p of principals.slice(1)) {
    await expect(f.admin.list(p.principal, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
  expect(JSON.stringify([...f.storage.documents.values()])).not.toContain('fixture-private');
});
```

- [ ] **Step 4:** Add each following lifecycle test independently, run by its exact title, then rerun the file. These are complete bodies to append to `lifecycle.spec.ts`:

```ts
it('blocks stale cookies after deactivate and reactivate even when provider revoke fails', async () => {
  const f = await accounts();
  const admin = (await f.auth.authenticate((await f.login('admin')).sealedSession)).principal;
  const a = await f.login('a'); const b = await f.login('b');
  f.provider.revoke.mockRejectedValue(new Error('fixture provider unavailable'));
  await f.admin.deactivate(admin, 'a', {});
  expect(f.cleanup).toHaveBeenCalledWith('a');
  await expect(f.auth.authenticate(a.sealedSession)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect((await f.auth.authenticate(b.sealedSession)).principal.account.userId).toBe('b');
  await f.admin.reactivate(admin, 'a', {});
  await expect(f.auth.authenticate(a.sealedSession)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect((await f.auth.authenticate((await f.login('a')).sealedSession)).principal.account.userId).toBe('a');
});

it('keeps onboarding locked after an unknown password-change outcome', async () => {
  const f = await accounts(); const current = (await f.users.get('a'))!;
  expect((await f.users.compareAndSwap(current, { ...current.account,
    passwordChangeRequired: true })).outcome).toBe('confirmed');
  const cookie = (await f.login('a')).sealedSession;
  const principal = (await f.auth.authenticate(cookie)).principal;
  f.provider.replacePassword.mockRejectedValueOnce(new AuthFault('AUTH_TIMEOUT'));
  await expect(f.auth.password(principal, { currentPassword: 'fixture-private',
    newPassword: 'fixture-new-private' })).rejects.toMatchObject({ code: 'AUTH_TIMEOUT' });
  expect((await f.users.get('a'))!.account.passwordChangeRequired).toBe(true);
  await expect(f.auth.authenticate(cookie)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  const again = (await f.auth.authenticate((await f.login('a')).sealedSession)).principal;
  const changed = await f.auth.password(again, { currentPassword: 'fixture-private',
    newPassword: 'fixture-new-private' });
  expect(changed.user.passwordChangeRequired).toBe(false);
});

it('reset fences the old cookie and recovery does not enumerate accounts', async () => {
  const f = await accounts(); const old = await f.login('a');
  const known = await f.auth.forgotPassword({ email: 'a@example.com' });
  const unknown = await f.auth.forgotPassword({ email: 'unknown@example.com' });
  expect(known).toEqual(unknown); expect(known).toEqual({ ok: true });
  expect(f.provider.sendRecovery).toHaveBeenCalledExactlyOnceWith('a@example.com');
  f.provider.reset.mockResolvedValueOnce({ workosUserId: 'user_a' });
  expect(await f.auth.resetPassword({ token: 'fixture-reset-secret',
    newPassword: 'fixture-new-private' })).toEqual({ ok: true });
  await expect(f.auth.authenticate(old.sealedSession)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  const row = (await f.users.get('a'))!.account;
  expect(row.currentWorkosSessionId).toBeNull(); expect(row.passwordChangeRequired).toBe(false);
  const stored = JSON.stringify([...f.storage.documents.values()]);
  expect(stored).not.toContain('fixture-reset-secret'); expect(stored).not.toContain('fixture-new-private');
});

it('bounds normalized-email login and recovery attempts before provider work', async () => {
  vi.useFakeTimers();
  try {
    const f = await accounts();
    for (let n = 0; n < 10; n++) await f.auth.login({ email: ' A@EXAMPLE.COM ', password: 'fixture-private' });
    const calls = f.provider.login.mock.calls.length;
    await expect(f.login('a')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(f.provider.login).toHaveBeenCalledTimes(calls);
    await f.login('b');
    for (let n = 0; n < 3; n++) await f.auth.forgotPassword({ email: 'a@example.com' });
    await expect(f.auth.forgotPassword({ email: ' A@EXAMPLE.COM ' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await vi.advanceTimersByTimeAsync(60_000);
    await f.login('a'); await f.auth.forgotPassword({ email: 'a@example.com' });
  } finally { vi.useRealTimers(); }
});
```

- [ ] **Step 5:** Run `npm test -- test/auth/integration/lifecycle.spec.ts test/auth/ test/administration/`. Expected: new assertions execute, upstream error/body/redaction/timeout/duplicate/partial-write/replay tests execute, no network. The service tests above do **not** establish browser cookies, middleware gates, provider timeouts or P3 cleanup; Tasks 3 and 5 supply those layers. Commit named new files as `test(auth): integrate account lifecycle and local session fences`.

## Task 2 — Real runtime privacy, captured identity and shared snapshots

**Files:** Create `backend/test/auth/integration/owner-config.spec.ts`.

- [ ] **Step 1:** Confirm completed P3 retained the fixture/runtime methods used below. Open `text-config-fixture.ts`, `text-config.spec.ts`, P3's `auth-owner.spec.ts`. Do not change those files or fall back to its legacy single-owner helpers.
- [ ] **Step 2:** Add this regression file and run `npm test -- test/auth/integration/owner-config.spec.ts`.

```ts
/**
 * ============================================================================
 * FILE: owner-config.spec.ts
 * LOCATION: backend/test/auth/integration/owner-config.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify three-owner runtime isolation and shared config snapshots.
 * ROLE IN PROJECT:
 *    Exercises the real durable runtime using existing provider fixtures.
 *    Separates runtime binding evidence from HTTP authorization evidence.
 * KEY COMPONENTS:
 *    - Private transcripts, captured attribution and shared snapshot checks.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import type { ResolvedIdentity } from '../../../src/contracts/identity.js';
import type { SubmitTurnResponse } from '../../../src/contracts/api.js';
import { textConfigFixture } from '../../runtime/text-config-fixture.js';
import { textSnapshot } from '../../model/config-snapshot.js';

const identity = (userId: string): ResolvedIdentity => ({ userId,
  openRouterUser: userId, source: 'authenticated-session' });
type Fixture = ReturnType<typeof textConfigFixture>;
function submit(f: Fixture, userId: string, content: string, idempotencyKey: string) {
  return f.runtime.submitTurn({ identity: identity(userId), sessionId: null, content, idempotencyKey });
}
function execute(f: Fixture, userId: string, ids: SubmitTurnResponse) {
  return f.runtime.executeTurn({ userId, ...ids, signal: new AbortController().signal,
    emit: async () => undefined });
}

it('isolates three transcripts and attributes accepted work after another owner runs', async () => {
  const f = textConfigFixture(textSnapshot(1));
  try {
    const owners = ['admin', 'a', 'b'];
    const turns = await Promise.all(owners.map(u => submit(f, u, `[owner:${u}]`, 'same-request-key')));
    await execute(f, 'b', turns[2]!);
    await execute(f, 'a', turns[1]!);
    await execute(f, 'admin', turns[0]!);
    expect(f.fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)).user)).toEqual(['b', 'a', 'admin']);
    for (const [index, owner] of owners.entries()) {
      const own = turns[index]!;
      const messages = await f.p.messages.list(owner, own.sessionId, { cursor: null, limit: 50 });
      const text = JSON.stringify(messages.items);
      expect(text).toContain(`[owner:${owner}]`);
      for (const other of owners.filter(u => u !== owner)) {
        expect(text).not.toContain(`[owner:${other}]`);
        expect(await f.p.sessions.get(other, own.sessionId)).toBeNull();
      }
    }
  } finally { await f.dispose(); }
});

it('shares published settings for new work while every accepted owner retains its snapshot', async () => {
  const f = textConfigFixture(textSnapshot(1, { maxOutputTokens: 2048 }, 'fixture/old', 'fixture-A'));
  try {
    const a = await submit(f, 'a', 'first-a', 'first-request-a');
    const b = await submit(f, 'b', 'first-b', 'first-request-b');
    f.publish(textSnapshot(2, { maxOutputTokens: 512 }, 'fixture/new', 'fixture-B'));
    await execute(f, 'a', a); await execute(f, 'b', b);
    await execute(f, 'a', await submit(f, 'a', 'second-a', 'second-request-a'));
    await execute(f, 'b', await submit(f, 'b', 'second-b', 'second-request-b'));
    const requests = f.fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)));
    expect(requests.map(r => r.model)).toEqual(['fixture/old', 'fixture/old', 'fixture/new', 'fixture/new']);
    expect(requests.map(r => r.max_tokens)).toEqual([2048, 2048, 512, 512]);
    expect(requests.map(r => r.user)).toEqual(['a', 'b', 'a', 'b']);
  } finally { await f.dispose(); }
});
```

- [ ] **Step 3:** Run `npm test -- test/auth/integration/owner-config.spec.ts test/runtime/auth-owner.spec.ts test/runtime/text-config.spec.ts test/performance/auth-memory-owners.spec.ts`. Expected: real runtime assertions execute; delayed acceptance, retry, memory-first compartments and account-local recovery retain identity. A changed upstream method is a reconciled test-interface change, not permission to modify production or use unsafe casts.
- [ ] **Step 4:** Record the limitation: publishing directly proves runtime snapshot binding, **not** config HTTP authorization or save/activation wiring. Task 3 requires both the real admin controller/activation suites and this runtime evidence for AC6.
- [ ] **Step 5:** Commit the named new file as `test(auth): verify three-owner runtime privacy and global snapshots`.

## Task 3 — Assemble HTTP, transport, isolation and cleanup evidence

**Files:** Read/run completed P1–P3 test suites; update `docs/workos-authentication/verification.md`. No upstream edits.

- [ ] **Step 1:** Run in `backend`:

```bash
npm test -- test/auth/http.spec.ts test/http/private-boundary.spec.ts test/assembly/auth-wiring.spec.ts test/admin-config/authorization.spec.ts test/assembly/admin-http.spec.ts test/administration/
```

Record named assertions demonstrating real login cookies, unknown/inactive/stale/expired rejection, no runtime default owner, User config **GET and PUT** denial before storage/activation, Super Admin success, direct admin-route denial, pending onboarding denial and safe capability access. A User who cannot write but can read Config fails AC3/AC6. Require exact-origin credentialed preflight, evil/null/missing-origin mutation denial, oversize/non-JSON bodies, cookie append/clear/refresh and Secure policy. Public liveness remains safe without WorkOS; private routes fail closed. A fake route returning a marker is useful middleware evidence, not a real-controller pass.

- [ ] **Step 2:** Run:

```bash
npm test -- test/runtime/auth-owner.spec.ts test/http/ test/performance/auth-memory-owners.spec.ts test/runtime/text-config.spec.ts test/assembly/auth-calendar.spec.ts
```

For each of admin/A/B, require owner-scoped session/message list pagination, forged cursor/ID and override rejection, read/rename/delete, stream attachment/status/cancel/retry and artifacts. Require positive own-owner controls and denied **all six ordered foreign-owner pairs** (admin→A/B, A→admin/B, B→admin/A). Shared idempotency keys or colliding fixture IDs must not cross namespaces. Include concurrent requests and execution after another caller; assert persisted attempt/accounting/OpenRouter `user`, not just rendered titles. Preserve transcript order and durable terminal state; provisional streaming text is not completion.

- [ ] **Step 3:** Run:

```bash
npm test -- test/voice/session/auth-owners.spec.ts test/voice/transport/gateway.integration.spec.ts test/assembly/auth-calendar.spec.ts test/plugins/google-calendar/owner-registry.spec.ts test/plugins/google-calendar/oauth.spec.ts test/plugins/google-calendar/connection-multi.spec.ts test/plugins/google-calendar/connection-refresh.spec.ts test/plugins/google-calendar/discovery.spec.ts
```

Record actual assertions for authenticated dictation upgrade; foreign voice ticket/token/room/control/reconnect/end rejection; artifact ownership; owner-bound LiveKit/background callback; Calendar status/settings/defaults/disconnect/discovery/OAuth; callback state+session binding, replay, refresh coalescing and discovery/credential caches. A second owner's grant must never replace the first. Check both connected A/B and unconnected admin, then Super Admin's own grant without access override. Existing feature-admission/consent/encryption restrictions remain in force. An admission-denied voice fixture is not evidence that the admitted path works: require fixture-enabled positive controls.

- [ ] **Step 4:** Run:

```bash
npm test -- test/assembly/auth-deactivation.spec.ts test/runtime/work.spec.ts test/http/stream-transport.spec.ts test/voice/session/auth-owners.spec.ts test/operations/auth-multi-owner-recovery.spec.ts test/operations/local-recovery.spec.ts test/runtime/local-reconciliation.spec.ts
```

Require a real Administration request through the confirmed-local-update → P3 hook chain, not just `cleanup` spy calls in Task 1. Active A text/SSE/dictation/live/OAuth stops or fences; B continues, process admission remains open, durable failed/interrupted/finalizing/unknown outcomes remain honest. Cleanup failure cannot restore access; reactivation cannot revive an old cookie/ticket/stream. New login works. Deactivation during delayed voice creation/OAuth exchange cannot publish a stale capability/grant. Logout is browser/session-specific; reset/expiry teardown is separately exercised. Recovery includes active and inactive mapped owners through one maintenance lifecycle without repeating inference.

- [ ] **Step 5:** Trace each required assertion above to a test title/result. Missing or vacuous coverage is a gate: report exact missing owner/surface/action to the responsible worker, or add a minimal P6-owned case by composing its **completed, inspected** fixture. Do not count a path-filter command that discovers no matching test as evidence. Record every correction hash and rerun the affected command before updating AC status. Commit only report evidence as `docs(workos-authentication): record assembled authorization and isolation checks`.

## Task 4 — Bootstrap/adoption verification without a real migration

**Files:** Read `backend/test/auth/bootstrap-auth.spec.ts`, `backend/src/scripts/bootstrap-auth.ts`; update `verification.md`. Read P5's handed-over `operations.md`.

- [ ] **Step 1:** Run `npm test -- test/auth/bootstrap-auth.spec.ts` in `backend`. Verify actual discovered tests, not merely exit zero.
- [ ] **Step 2:** Record named assertions for non-mutating preflight (no persistence admission/index/checkpointer setup), exact WorkOS subject/email/legacy-owner selection, duplicate/ambiguous/mixed-owner/refusal and repeat refusal; no automatic startup/first-login assignment. An already provisioned WorkOS subject is selected, not silently provisioned/adopted by email.
- [ ] **Step 3:** Record one confirmed users insert with unchanged legacy owner; no transcript/checkpoint/accounting/config rewrite. Compare fixture before/after IDs, ordering, provenance and plugin encrypted bytes/AAD. Synthetic decrypt success with unchanged owner/key is fixture evidence only; real grant consent/key usability remains unverified/reconnect-required.
- [ ] **Step 4:** Verify refusal/unconfirmed-write/close/provider failure/owner-loss assertions execute. No compensating delete, forced sentinel removal or automatic repeat. Do not execute `npm run auth:bootstrap` even in “preflight” against application data; that still accesses an actual provider/database and needs operator permission.
- [ ] **Step 5:** Add AC7 result and remaining operator backup/stopped-writer/authorization gates to the report. If P5 omitted a required check, request its owner fix or add a new P6 integration case using P5's exported pure ports only; do not duplicate the entire bootstrap unit suite. Commit report evidence as `docs(workos-authentication): record isolated bootstrap preservation evidence`.

## Task 5 — Closed real-App browser fixture, not a new test framework

**Files:** Create the four frontend files in section 2. Preserve existing browser fixtures and production UI.

- [ ] **Step 1:** Before coding, read `App.tsx`, `auth-context.tsx`, real auth/admin/Calendar/chat client protocols and the existing dashboard browser entry/helpers. List the **actual** request shapes the shell issues. Prefer existing response factories: `features/admin-config/testing/fixtures.ts`, `api/testing/voice-fixtures.ts`, Calendar fixtures and P1 auth/admin protocols. Do not guess protocol fields or copy stale Sign-out behavior.
- [ ] **Step 2:** Create `fixture-api.test.ts` first using the full repository header with its exact FILE/LOCATION. Its PURPOSE is “Verify closed browser fixture routing”; ROLE distinguishes fixture integrity from application authorization; KEY COMPONENTS names network refusal, session ownership and counters. Add this first complete check:

```ts
import { expect, it } from 'vitest'
import { createFixtureApi } from './fixture-api.ts'

it('refuses unexpected external requests without invoking a real network', async () => {
  const f = createFixtureApi()
  await expect(f.fetch('https://outside.invalid/api/auth/me')).rejects.toThrow('Unexpected fixture request')
  expect(f.unexpected).toEqual(['GET https://outside.invalid/api/auth/me'])
})
```

Run `npm test -- src/features/auth/integration-tests/fixture-api.test.ts` in `frontend`; missing helper is construction RED. Implement `createFixtureApi()` in `fixture-api.ts` with the mandatory header; keep the return shape `{ fetch, unexpected, requests, controls }`. `fetch` has type `typeof globalThis.fetch`; use a URL based at `http://127.0.0.1:5173`, reject **any** other origin and unmatched method/path, and never call original fetch as a fallback. `requests` stores only `{ method, path, owner }`, never password/token bodies. `controls` exposes fixture modes below; keep it local to this fixture, never export it from production auth modules.

The complete minimal refusal branch is:

```ts
const unexpected: string[] = []
const requests: { method: string; path: string; owner: string | null }[] = []
function refuse(method: string, url: URL): never {
  const key = `${method} ${url.href}`
  unexpected.push(key)
  throw new Error(`Unexpected fixture request: ${key}`)
}
```

Implement explicit handlers one at a time after a failing Node check. The table is the handler specification, not permission for a wildcard success:

| Method/path | Exact fixture behavior |
| --- | --- |
| GET `/api/auth/me` | Initially 401 using P1 error envelope; after fixture login return `{ user: { userId, email, role, passwordChangeRequired } }`. |
| POST `/api/auth/login` | Three fixed `.test` accounts; temporary A returns pending onboarding, admin/B return full account; invalid fixture password returns generic 401. Return only `{ user }`. |
| POST `/api/auth/password` | Selected failure returns safe timeout; confirmed success clears gate and returns current `{ user }`; equal passwords rejected. |
| POST `/api/auth/logout` | Clear fixture current account, return 204; optional deferred response exercises immediate/settled teardown. |
| POST `/api/auth/forgot-password` | Known and unknown return identical `{ ok: true }`; never return token. |
| POST `/api/auth/reset-password` | One fixed synthetic token accepted once, then safe rejection; return `{ ok: true }`. |
| GET `/api/sessions` and seeded own session/messages paths | Owner-tagged titles/text for current admin/A/B, bounded protocol-valid pages; requests before full admission fail the fixture. Foreign IDs return not-found, never another owner's transcript. |
| POST session submit and GET its returned streamPath | Protocol-valid acceptance and controllable pending SSE. Store request abort signal; track cancellation independently of server terminal state. Use existing envelope factory/stream example. |
| GET `/api/voice/config` | Existing protocol-valid disabled fixture by default; media-specific run uses existing enabled voice fixture and fake local media only. |
| GET `/api/admin/config` / PUT same | Existing `publicConfig` response; User request is counted and fails this fixture (zero calls is a UI requirement); admin save advances revision. |
| GET `/api/admin/users` | Bounded safe rows for admin/A/B; no passwords/SIDs; only admin. |
| POST `/api/admin/users` and three explicit lifecycle action paths | Exactly P1 wire shapes; duplicate and selected partial-create failure are safe errors; success creates only role `user`, pending password change. Reset sends no token in response. |
| Existing Calendar capability/status/settings/disconnect endpoints actually requested by Plugins | Reuse protocol-valid Calendar factory with owner-specific account label and no actual OAuth/provider call. User Plugins must not request Config. |

For handlers beyond the first refusal test, add Node assertions for all three login identities, pending/full responses, malformed JSON refusal, unknown route refusal, reset replay, owner switch returning different histories and User config-call counter. These test the fixture's integrity, **not** backend enforcement; Task 3 establishes actual enforcement. If adding a fixture branch needs substantial unrelated infrastructure, reuse an existing injected client fixture instead and document the reduced transport coverage.

- [ ] **Step 3:** Create the HTML entry with a valid HTML comment header containing FILE, LOCATION, PURPOSE, ROLE IN PROJECT and KEY COMPONENTS:

```html
<!--
============================================================================
FILE: auth-browser.html
LOCATION: frontend/src/features/auth/integration-tests/auth-browser.html
PURPOSE: Run deterministic auth and role-navigation checks in a real browser.
ROLE IN PROJECT: Development-only harness; not an application route or service proof.
KEY COMPONENTS: Named result regions and the fixture module entry.
============================================================================
-->
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Auth integration fixture</title></head>
  <body>
    <p id="fixture-status" role="status">Running</p>
    <ol id="fixture-checks"></ol>
    <div id="root"></div>
    <script type="module" src="./auth-browser.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4:** Create `auth-browser.tsx` with mandatory exact-path header; use the existing `act`/`createRoot`/DOM-check pattern, import `index.css`, require `import.meta.env.DEV`, install fixture fetch **before dynamically importing App**, and mount the real App. Do not set a full initial principal to bypass login. Deny real WebSocket, sendBeacon and media by default; explicitly allow only fixture implementations when testing teardown. Wrap global patches/root lifecycle in `try/finally`, restore originals and unmount. Emit each named assertion as `pass/fail`, counts, unexpected request count and a finished flag; crash or zero assertions is failure. Do not swallow a failed check and show an overall green result.

Use this exact assertion/reporting shape in the browser runner (with `checks` holding the procedures in Task 6):

```ts
type Result = { name: string; ok: boolean; error?: string }
const results: Result[] = []
for (const [name, runCheck] of checks) {
  try { await runCheck(); results.push({ name, ok: true }) }
  catch (error) { results.push({ name, ok: false,
    error: error instanceof Error ? error.message : 'Check failed' }) }
}
const failed = results.filter(r => !r.ok)
const list = document.getElementById('fixture-checks')!
list.replaceChildren(...results.map(result => {
  const li = document.createElement('li')
  li.textContent = `${result.ok ? 'pass' : 'fail'}: ${result.name}${result.error ? ` (${result.error})` : ''}`
  return li
}))
document.getElementById('fixture-status')!.textContent =
  `${results.length - failed.length}/${results.length} passed; unexpected=${api.unexpected.length}`
document.documentElement.dataset.fixtureFinished = 'true'
document.documentElement.dataset.fixturePassed =
  String(results.length > 0 && failed.length === 0 && api.unexpected.length === 0)
```

- [ ] **Step 5:** Run frontend focused Node fixture tests, build and lint. Then start `npm run dev -- --host 127.0.0.1` in `frontend` as a background process. Open `http://127.0.0.1:5173/src/features/auth/integration-tests/auth-browser.html` in the browser tool. Expected: actual rendered application, named checks, nonzero counts, zero unexpected/network/media escapes. Browser launch failure is **blocked**, not pass. Commit the four named new files only as `test(auth): add closed real-App browser integration fixture`.

## Task 6 — Browser acceptance scripts and teardown evidence

**Files:** Extend only `frontend/src/features/auth/integration-tests/auth-browser.tsx` and its fixture as needed; record `verification.md`.

Each row below becomes one separately named async DOM check using real labeled inputs/buttons, `act`, `typeInput` and `check`; no source-string/SSR-only substitute. Run a row independently before joining the sequence. Reload/reset the fixture between independent account/error scenarios so a failure cannot produce a false positive downstream.

| Named check | Actions | Required assertions |
| --- | --- | --- |
| `closed login and safe failures` | Start unauthenticated; submit invalid then successful fixture credentials. | No chat/provider state before login; no registration affordance; labeled fields; generic safe error; default landing is chat. No bearer/reset/password values in local/session storage or rendered error. |
| `mandatory onboarding blocks the shell` | Login A with temporary password; try equal replacement, selected timeout, then confirmed different replacement. | Only password-change/logout flow while pending; zero sessions/plugins/config/admin requests; timeout cannot unlock; success reaches chat. |
| `admin role navigation and bounded table` | Login admin; open profile/Manage Aurvin; visit Config, Plugins, Analytics, Administration. | Correct profile email/role; all four tabs; Analytics stays empty; table bounded with required columns; no private activity/secrets; return-to-chat preserves same composer node/draft/stream within one account. |
| `create failure and transient password cleanup` | Open create form; inspect role selector; submit duplicate, partial failure, then distinct successful User; cancel/exit a separate form. | User is the only role choice; no false success row on failure; no retry credential overwrite; password input masked and cleared on success/cancel/exit; no password in table or browser storage. |
| `lifecycle actions and mailbox reset` | Deactivate/reactivate/reset a User from table; select provider failure where supported. | Accurate status/pending state; safe actionable error; no Super Admin/self controls, delete/promote/email-edit/impersonation/password-reveal UI; reset never reveals a token. Backend mailbox and stale-cookie proof remains Task 1/3. |
| `user plugins without config loading` | Login B; open Manage Aurvin; use Plugins, return to chat. | Plugins usable; no Config/Analytics/Administration tabs/panels; **zero** config/admin requests, not merely handled 403s; profile reflects B; no admin/A grant label. |
| `logout and next-account privacy` | As A seed history, draft, artifact selection, plugin status, pending SSE, submission-recovery entry; logout, then login B. | Old content absent from DOM and active state, old stream signal aborted/reader cancelled, old drafts/artifacts/recovery/plugin values absent; B gets only B history. Logout does not imply server work was durably completed/cancelled. |
| `expiry during private work` | Issue a genuine protocol-valid 401 from the next real private client request while SSE/media fixture is open. | Existing auth flow removes private shell and closes browser resources; login is shown; later B cannot see A state. Do not replace this with remounting App or manually calling a fixture logout control. A missing expiry event path is a P4 defect. |
| `media and late callbacks cannot survive switching` | Use fixture MediaStream tracks/WebSocket/room owner and a deferred A result; logout/switch; resolve old callback after B mounts. | Stop/close/disconnect counters increment for A only; no real microphone/WebRTC/provider; late A callback cannot write B draft/artifact/chat; normal within-account settings navigation does not tear down the owner. |
| `forgotten and reset screens` | Known/unknown forgot requests, successful fixed-token reset, replay, fresh sign-in. | Generic forgotten result; no raw link in admin; successful reset requires login and scrubs URL/token state; failure stays safe; no stored token. |
| `keyboard mobile and both themes` | Keyboard through login, password change, table/actions, tabs/profile; repeat at desktop and 360px with light/dark. | Logical focus/labels, visible focus/error/status, masked passwords, readable table with contained overflow, no page-level horizontal overflow. |

- [ ] **Step 1:** Implement/run `closed login` and `mandatory onboarding` checks; capture named result text and a sanitized screenshot. Never screenshot entered passwords or reset URLs.
- [ ] **Step 2:** Implement/run admin navigation, table creation and lifecycle checks. Assert request counts and cleared input values, not just screenshots.
- [ ] **Step 3:** Implement/run User Plugins and same-account navigation continuity checks. Assert config/admin request counter remains zero for Users.
- [ ] **Step 4:** Implement/run logout, expiry, deferred-result and media checks. Exercise actual App teardown and real client unauthorized events; fixture track/socket counters supply DOM lifecycle evidence, not external token revocation evidence.
- [ ] **Step 5:** Implement/run recovery, keyboard, desktop/mobile and themes. Record browser/version, viewport, fixture URL, named counts, screenshots and console/network failures (none expected). Store sanitized images/logs outside tracked source under `C:/Users/Peter/AppData/Local/Temp/opencode`; cite their absolute paths and result summaries. Browser-tool access alone is not authorization to contact a service.
- [ ] **Step 6:** Check real Strict-cookie OAuth navigation separately from fetch-mocked DOM checks. Use P3's completed local fixture app and a second local-origin redirect stub with deterministic provider exchange; browser starts OAuth as A, navigates from the other origin to the static callback bridge, then performs same-origin completion. Require cookie absent on the cross-site entry when appropriate, present on the bridge's same-origin request, no sensitive callback data retained, A installs its own grant, B cannot complete A's state, logout/deactivation/replay refuses. Ordinary Supertest Cookie headers and mocked fetch **cannot** establish SameSite navigation semantics. If P3 exposes no safe runnable browser fixture server, report this browser/network gate blocked and request a narrowly owned harness handoff; do not start the real application against `.env` or a live OAuth service.
- [ ] **Step 7:** Rerun frontend Node/build/lint after browser fixture edits; commit only owned test files/report as `test(auth): verify role navigation and private client teardown`. Keep DOM, backend, cookie-network and live-provider evidence distinct.

## Task 7 — Native verification only with operator-supplied isolated prerequisites

**Files:** No production/native-fixture edits; update `verification.md`.

- [ ] **Step 1:** Check only variable presence and exact prefix, without printing values. Native admission requires `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; never derive a URI from `.env` or use the application database. When absent record native checks **skipped: isolated prerequisites absent**. When explicitly supplied, retain them only in process environment and run the named suites.
- [ ] **Step 2:** Run in `backend`, only when that gate is satisfied:

```bash
npm run test:e2e -- test/persistence/auth-users.native.e2e-spec.ts test/runtime/isolation.native.e2e-spec.ts test/runtime/lifecycle.native.e2e-spec.ts test/runtime/voice-recovery.native.e2e-spec.ts test/http/runtime.native.e2e-spec.ts
```

Record discovered/executed/skipped tests and admitted replica-set topology, generated disposable database cleanup and any reconnect/recovery limitation. A standalone substitute does not prove admitted replica-set behavior. Do not print connection strings. Existing `nativeDatabase()` generates and drops only `aurvin_p2_test_` random databases; preserve that safeguard. No WorkOS/email/paid model calls are part of this command.
- [ ] **Step 3:** If an owned native cross-feature test is actually needed, create it only under `backend/test/auth/integration/` with `.native.e2e-spec.ts` suffix and mandatory header, reuse `nativeDatabase()`, guard prerequisites before fixture opening and close/drop in `finally`. Do not add it merely to produce green skipped discovery. Its exact assertion, dependencies and authorization must be recorded before executing.
- [ ] **Step 4:** Record WorkOS crypto/session refresh, actual email delivery/reset replay, real account bootstrap/adoption and deployment as **unrun** unless separately authorized. A provider mock that rejects token reuse is application reaction evidence, not proof of WorkOS single-use behavior. Keep optional service gates visible without inventing a pass or enabling a paid add-on.

## Task 8 — Complete package verification on a frozen commit set

**Files:** `verification.md` only; fixes go to owners.

- [ ] **Step 1:** Freeze/record the actual P1–P6 implementation/fix commits and dirty state. Run `git diff --check` at root. Record any uncommitted P6 tests separately until committed; rerun affected acceptance after the final source commit. No check run before an owner's final fix establishes that fix.
- [ ] **Step 2:** In `backend`, run each separately:

```bash
npm run build
npm run lint
npm test
npm run test:e2e
```

Expected: build/lint succeed; routine and e2e discovered assertions pass; native skips reported separately. `test:e2e` may include native suites with supplied variables: inspect authorization/prerequisites first. Do not expose URIs/raw provider bodies in retained output.

- [ ] **Step 3:** In `frontend`, run each separately:

```bash
npm run build
npm run lint
npm test
```

Expected: production build/types/lint and Node tests pass; these do not execute HTML DOM fixtures. Confirm fixture entry is not imported by `frontend/src/main.tsx`/production shell and has no production route. Build success alone does not prove this isolation; inspect emitted entry references without editing build config.

- [ ] **Step 4:** Rerun all P6 named focused files and the full browser fixture on the final commit set. Report command, package directory, timestamp/duration, exit status, files/tests passed/failed/skipped, nonzero assertion counts and sanitized evidence path. Preserve baseline failures and post-fix reruns as separate records. Empty `test:azure`/`test:behavior` discovery is not auth acceptance; no need to run unrelated empty scripts to inflate evidence.
- [ ] **Step 5:** Resolve feature-caused required failures through owners; retain pre-existing failures with baseline proof and an explicit unresolved completion gate. Do not label AC8 complete while a required failure remains unresolved. Stop/release the fixture dev server when browser work is finished; do not terminate unrelated user processes.

## Task 9 — Finalize operations and AC1–AC8 evidence

**Files:** Finalize `docs/workos-authentication/operations.md`; complete `docs/workos-authentication/verification.md`. Orchestrator owns `state.md` and `final_report.md`.

- [ ] **Step 1:** Preserve P5's exact stopped-writer/backup/selection/adoption/refusal/rollback procedures. Add a concise setup checklist: same-origin API/UI; server-only WorkOS key/client/cookie secret; HttpOnly/Strict `/api` cookie; Secure required for remote HTTPS; explicit loopback-only HTTP development; exact-origin credentialed CORS; missing auth diagnostic liveness only; no runtime legacy fallback. Do not put credential values in examples.
- [ ] **Step 2:** Add operator prerequisites from research with dated source links: email/password enabled, public sign-up disabled, MFA off for this approved V1, WorkOS default recovery email enabled, reset redirect to Aurvin `/reset-password`, no custom mailer/verification workflow. Explain admin provisioning's `emailVerified` flag does **not** prove mailbox ownership. Retain expected free AuthKit allowance for 10–15 users as a dated pricing observation, production billing-details gate and no paid SSO/custom-domain/Radar add-ons. No provisioning or perpetual-free claim.
- [ ] **Step 3:** Document concrete implemented limits and ceilings verified from tests: login 10/60s per normalized email, recovery 3/60s, process mutation 60/60s, bounded keys, 4KiB auth body and ten-second provider budget where actually implemented. Note in-process/single-executor ceilings and one active provider SID/account; new-device login invalidates prior admission. Document browser logout/expiry cleanup, deactivation's immediate local fence versus best-effort work cleanup, recovery requiring fresh login, preserved history, no provider-billing guarantee and bounded already-issued external capabilities. Do not assert instant LiveKit/provider-token revocation.
- [ ] **Step 4:** Add failure/reconciliation guidance: partial WorkOS/local account creation never means success; inspect exact mapping through authorized operator procedures without adopting by email, resetting an activated credential, retrying blindly or revealing a recovery link. Lost/unconfirmed bootstrap writes require inspection, not force/repeat. Config is singleton/global, active work retains captured snapshot, Users use safe capability/plugin paths without Config reads. Plugin reconnect may be required; auth is not new consent.
- [ ] **Step 5:** Complete this acceptance matrix with actual test titles, commands, commit hashes, outcomes and limitations in each cell; never use source existence alone:

| AC | Required evidence and responsible task | Completion rule |
| --- | --- | --- |
| AC1 | Task 1/3 auth success/failure/timeout/expiry/logout; Task 6 real login DOM; unknown admission/register/fallback/token-storage rejection. | Fixture/HTTP/browser passes recorded separately; live WorkOS not implied. |
| AC2 | Task 1 failed/confirmed replacement and reset fence; upstream provider tests for replay/failure; Task 3 pending private-route denial; Task 6 onboarding/recovery DOM and token cleanup. | Mail recipient spy proves intended email only; actual delivery remains separate. |
| AC3 | Task 1 service denial; Task 3 direct Config GET/PUT and admin API denials; Task 6 four admin tabs versus User Plugins-only/zero restricted requests. | Exactly two roles; admin is not an ownership override. |
| AC4 | Task 1/3 create/list/duplicate/partial/fence/reactivate/reset and safe records; Task 6 table/password clearing. | Cleanup-chain evidence, not just hook invocation; no false success or takeover. |
| AC5 | Task 2 three transcripts/attribution; Task 3 all six foreign-owner pairs across chat/artifact/voice/Calendar/cache/background paths; Task 6 account-state teardown. | Positive own-owner controls, concurrent/delayed cases, no missing admitted path. |
| AC6 | Task 2 accepted/new multi-owner snapshots; Task 3 real admin save/activation and User read denial; Task 6 Plugins independence. | Runtime publish alone cannot establish HTTP activation or read protection. |
| AC7 | Task 4 isolated preflight/adoption/refusal/record/plugin preservation; P5 operations handoff. | Real-data migration explicitly unrun; never inferred from fixtures. |
| AC8 | Tasks 6–8 browser, versions and seven package commands, authorized native results, counts/skips and owner-fix reruns. | No unresolved feature failure; blocked required browser/native/service claims remain visible. |

Use precise statuses: **passed (fixture)**, **passed (browser fixture)**, **passed (isolated native)**, **failed**, **blocked**, **skipped (prerequisite absent)**, **unrun (not authorized)**. Report review only as **skipped**. Separate implementation completion from release readiness and external acceptance evidence; missing required evidence prevents an unqualified “all criteria verified.”

- [ ] **Step 6:** Perform documentation-only consistency checks: all relative Markdown links resolve; AC1–AC8 each map to actual evidence and explicit remaining gates; commands agree with manifests; cookie/role/onboarding/bootstrap limits agree across goal/research/operations/report; no secrets or unstated deployment authorization. Have the worker self-check this plan's coverage—this is not a unified code review. Do not create `review.md` or a passed-review label.
- [ ] **Step 7:** Obtain commit slot; stage exactly `docs/workos-authentication/verification.md` and `docs/workos-authentication/operations.md`; inspect named cached diff/status/check; commit as `docs(workos-authentication): finalize verification and operations handoff`. Never `git add .`; preserve others' index entries and use path-limited commit when necessary.
- [ ] **Step 8:** Return concise summary to orchestrator: P6 commits and tested source set; paths; seven package outcomes/counts; browser assertions/viewport/evidence; isolated native results/skips; AC1–AC8 evidence; owner fixes; unrun WorkOS/email/real-bootstrap/deployment gates; review **skipped**. Request orchestrator update graph/ledger and synthesize `final_report.md`; do not mark the entire workflow complete yourself.

## Planner self-check

- Every goal acceptance criterion is mapped above, including Config **read** protection, mandatory onboarding, all three account owners, session revival prevention, deactivation cleanup, bounded attempts/error sanitization and exact bootstrap adoption.
- Scope is tests/evidence/operations only. Upstream fixes retain their owners; no package/framework/production UI changes are authorized by this plan.
- Browser DOM and actual cookie-navigation evidence are distinct from Node tests; native and live-provider prerequisites are explicit. No empty suite, denied admitted path or fake API result substitutes for an end-to-end positive control.
- Frequent commits are path-scoped and serialized. Headers are mandatory on all new TypeScript/TSX/HTML files. Documentation completion remains distinct from executed verification.
