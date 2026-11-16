Verify AC1–AC8 against the assembled configuration feature, retaining explicit failures, skips and release blockers. Reuse the guarded MongoDB bundle, existing provider/speech fixtures, real AppService/runtime and browser-mounted App; do not create production services or replace lifecycle owners. Stack: existing NodeNext TypeScript, Nest, MongoDB, LangGraph, React/Vite and Vitest; no new dependency.

This is a verification implementation plan, not evidence of passing checks. Read [goal.md](goal.md), [state.md](state.md) and [operations.md](operations.md). Research and unified review are **skipped**, never passed. No reviewer dispatch, live/paid provider calls, operator application import, application-data mutations, provisioning or deployment. Synthetic import/restart tests may mutate only generated isolated test databases under the prerequisites below. The planner writes only this plan; the worker implements only P7 tests/evidence.

## Files and ownership

Create only the missing dedicated files needed for uncovered integration checks; extend these same files rather than adding a parallel test framework:

| P7 path | Responsibility |
| --- | --- |
| `backend/test/admin-config/admin-config.integration.spec.ts` | Offline AppService save/activation, provider failures, CAS and lifecycle integration. |
| `backend/test/admin-config/admin-config.security.integration.spec.ts` | Real AppModule/configureApplication security and redaction boundary. |
| `backend/test/admin-config/admin-config.native.e2e-spec.ts` | Guarded native config, text/voice flows, encrypted restart and saved-result recovery. |
| `backend/test/admin-config/admin-config-import.native.e2e-spec.ts` | Explicit synthetic import, ownership, atomicity and process restart. |
| `backend/test/admin-config/integration-fixture.ts` | Small native AppModule fixture, using `nativeDatabase`, bootstrap/stored settings and injected providers. No independent production client/owner. |
| `frontend/src/features/admin-config/integration-tests/config-flow.test.ts` | Client/reducer revision, credential/settings scope and safe capabilities integration in Node. |
| `frontend/src/features/admin-config/integration-tests/dashboard-browser.html` | Development-only entry for additional real DOM checks. |
| `frontend/src/features/admin-config/integration-tests/dashboard-browser.tsx` | Extended App interactions, keyboard/storage/active voice checks using closed fixtures. |
| `docs/super-admin-config/verification.md` | Actual commit set, environment, commands/counts, AC outcomes, browser evidence and blockers. |
| `docs/super-admin-config/operations.md` | Append/update evidence entries only; preserve P6 procedures. |

Read/reuse, do not edit: `backend/test/assembly/admin-config-fixture.ts` (`assemblyFixture`, `deferred`); `backend/test/admin-config/fixtures.ts` (`document`, `actor`, `at`); `backend/test/persistence/native.ts` (`nativeDatabase`); `backend/test/runtime/text-config-fixture.ts`; `backend/test/model/config-snapshot.ts`; `backend/test/fixtures/openrouter/frames.ts`; `backend/test/fixtures/deepgram/socket.ts`; `backend/test/voice/session/fixtures.ts`; `frontend/src/features/admin-config/testing/{fixtures.ts,browser-checks.ts,dashboard-browser.html,dashboard-browser.tsx}`. Use `.js` backend local import specifiers and `.ts`/`.tsx` frontend conventions.

P1–P6 production files and focused tests remain with their owners. `state.md` and `final_report.md` belong to the orchestrator. Do not edit chat-state files, `backend/test/model/config-snapshot.ts`, legacy `backend/test/integration/**`, package/config files or existing browser fixtures without an explicit ownership transfer. Report defects with smallest reproducer, owner, failing command and affected AC; wait for the owner's correction, then rerun. This is defect verification, not reinstated unified review.

## Acceptance-to-check matrix

The IDs below are evidence keys in `verification.md`; a source file or previous worker's reported count is not a passing result.

| AC | Required integrated checks | Supporting existing checks to execute | Exit condition |
| --- | --- | --- | --- |
| AC1 | U1 profile/menu/focus; U2 Config/empty Analytics/sections; U3 chat draft/selection/stream/voice navigation; B1 desktop and mobile inspection. | `frontend/src/features/admin-config/{navigation,admin-dashboard}.test.ts`; `frontend/src/features/chat/state/voice-draft-lock.test.ts`. | Actual interactive browser assertions and layout inspection pass at both sizes; no navigation-driven cancellation or draft loss. |
| AC2 | I1 missing-key admin bootstrap; N1 stored configuration beats obsolete env before/after restart; M1 exhaustive source map reconciliation. | `backend/src/platform/config/bootstrap-config.spec.ts`, `manageable-config.spec.ts`, `legacy-config-import.spec.ts`; `backend/test/assembly/admin-config.spec.ts`. | Every manageable name is accounted for; normal startup never imports/overlays legacy values; missing keys keep voice off/chat not ready. |
| AC3 | I2 safe credential API/logs; S1 origin/body/TLS/redaction; N2 at-rest cipher/nonce/AAD/tamper; U4 fixed mask/local candidate clearing/storage instrumentation. | `backend/src/admin-config/{credential-service,credential-validation}.spec.ts`; `frontend/src/features/admin-config/{credential-row,admin-config-client}.test.ts`. | No plaintext outside transient authorized memory/provider fixture headers; no envelopes in API/errors/logs; no application browser persistence of candidates. |
| AC4 | I3 recognition then one automatic save; I4 both-provider failure matrix with unchanged old configuration; U5 no keystroke calls/no second save. | `backend/test/admin-config/admin-config-api.spec.ts`; `backend/src/admin-config/credential-validation.spec.ts`. | Only fixed non-billable recognition GETs; failure/timeout/malformed response never changes stored or active key; UI reports recognition limitation. |
| AC5 | N3 new/accepted/automatic/explicit text revisions; N4 dictation/live/reconnect snapshots, capabilities and quota continuity; I5 same-owner confirmed publication; F2 attempt revision gap resolved or blocked. | `backend/test/runtime/text-config.spec.ts`; `backend/test/voice/session/config-snapshots.spec.ts`; `backend/test/voice/usage/config-snapshots.spec.ts`; `backend/test/assembly/admin-config.spec.ts`. | New work sees confirmed revision; active work retains original snapshot; no extra owners or quota reset; no unresolved transport/attempt revision gap. |
| AC6 | I6 delayed credential validation versus settings/removal/CAS; I7 invalid caps/catalogue/failed or uncertain write; U6 dirty/conflict/unavailable/removal confirmation; N5 disabled/lowered admission. | `backend/src/persistence/config.spec.ts`; `backend/src/admin-config/admin-config.service.spec.ts`; `frontend/src/features/admin-config/config-edit-state.test.ts`. | No lost updates, false success, unsafe activation or abrupt active-work cancellation; pending/unknown writes remain fenced. |
| AC7 | N6 empty/populated/invalid synthetic import; N7 child-process restart, no env fallback, wrong key/schema/tamper diagnostics; N8 ownership/journal/drain refusal. | `backend/test/assembly/{admin-config,config-drain}.spec.ts`. | Generated replica-set DB evidence passes, no partial/duplicate document or secret output, no stale-sentinel deletion and no private `.env` access/rewrite. |
| AC8 | S1 boundary checks; R1 finalization/recovery; R2 voice accounting/exclusion; F1 ownership exception; F3 legacy harness; Q1 all seven package checks and native suite outcomes. | `backend/test/integration/**`, `backend/test/runtime/local-reconciliation.spec.ts`, `backend/test/voice/integration/**`, voice usage/provider specs. | Actual counts/exit codes recorded, required gates run and pass or explicitly blocked; no zero-discovery/skip presented as pass. |

Confirm supporting paths with `git ls-files` before execution; an upstream rename is a mapping correction, not permission to drop that check. Current source registries are `BOOTSTRAP_ENV_NAMES`/`LEGACY_MANAGEABLE_ENV_NAMES` in `backend/src/platform/config/bootstrap-config.ts`; `bootstrap-config.spec.ts` checks their disjoint/exhaustive union against `PREVIOUS_LOADER_ENV_NAMES`. P1's exhaustive settings mapping is in `docs/super-admin-config/plan1.md` under “Exhaustive source and migration map”; `legacy-config-import.ts` projects it. There is no separate source-map module to invent.

For every test addition below, use this TDD/verification cycle as separate actions: add one named assertion/case; run its dedicated file with `-t` matching that case; record the expected failure or baseline green; if already green, run a wrong test-local fixture/adapter result as a negative control and require failure; restore the fixture; route any real defect to its owning worker; rerun the case, then its file and sibling regressions; commit only after green. Never mutate production source for a negative control, use expected-failure annotations, or record an unrun/native-skipped test as green. Each checkbox describing multiple failure variants is repeated once per variant, not one large coding batch.

## Task 1 — Freeze inputs and route the three carried follow-ups

- [ ] Record `git status --short --branch`, `git rev-parse HEAD`, `git log --oneline 78599a8..HEAD`, `node --version`, `npm --version` and installed package versions. Record only names of available prerequisites, not environment values. Preserve `.openchamber/`, screenshots and private configuration.
- [ ] F1: inspect `git show --stat 543e53c` and report its paths to the orchestrator. Request explicit responsible-owner acknowledgement: P5 for `frontend/src/features/chat/state/{chat-reducer.ts,chat-types.ts,use-chat.ts,voice-draft-lock.test.ts}` navigation/live-conversation behavior, P3 for `backend/test/model/config-snapshot.ts`. The orchestrator confirms or reassigns ownership; P7 does not silently adopt these paths. Run `npm test -- src/features/chat/state/voice-draft-lock.test.ts` in `frontend/` and `npm test -- test/runtime/text-config.spec.ts test/model` in `backend/`; add the U3 navigation regression in P7's browser entry. Keep F1 open until ownership is acknowledged and regressions execute.
- [ ] F2: send the P3 owner the AC5 requirement and the concrete observation: `backend/src/chat-runtime/ports.ts` exposes `attemptStreamBudgets`, not `attemptConfigRevision`; `backend/src/operations/observed-runtime.ts` forwards only that snapshot accessor. Ask P3 to identify the intended revision-aware attachment/retry/transport contract and coordinate any P6 operations/wrapper wiring. Do not invent the port or add a durable plaintext snapshot/revision field by inference.
- [ ] Write N3's accepted-A → publish/remove-B → attach-stream test before asking for production fixes. Assert provider request key/model/output/deadlines belong to A and duplicate acceptance keeps original IDs. Independently inject provider auth/credit failures and assert global passive gating still blocks new work. Never make global auth/credit degradation revision-local to get this test green. If P3 documents that existing behavior already satisfies AC5 without a named port, require runnable end-to-end proof and owner acknowledgement; otherwise record the precise unresolved gap and mark AC5 **blocked**, even if narrower runtime tests pass.
- [ ] F3: inspect `backend/test/integration/assembled-harness.ts` and every caller using `openAssembled({ env: ... })`, plus direct `loadConfig` use in `recovery.native.e2e-spec.ts`. It currently projects manageable env values via `loadConfig`; that is obsolete for AppService's bootstrap/stored configuration. Ask the orchestrator for a narrow legacy-harness correction assigned to P6 (assembly) with P3 budget/snapshot coordination. No P7 edit of those paths without explicit transfer.
- [ ] Require F3's owner to replace startup `loadConfig` with `loadBootstrapConfig`, seed encrypted fixture config through guarded `MongoConfigRepository.createIfAbsent` before service startup, translate intentional budget cases to explicit stored `settings` overrides, and keep obsolete-env values only in tests proving they are ignored. Preserve generation-ID uniqueness, repeated shared-DB restart, assistant-append fault, SSE parsing and cleanup. Run `npm test -- test/integration/assembled-harness.spec.ts`; then `npm run test:e2e -- test/integration --reporter=verbose`. Skipped native cases cannot close this follow-up. Report all caller failures, not only the admin suites.
- [ ] Initialize `verification.md` with M1/AC1–AC8/F1–F3/Q1 rows marked **planned/unrun — blocked**; record research/review as skipped. Do not copy P6's 874/314 counts as P7 results.

## Task 2 — Offline integrated saves, failures and concurrency (I1–I7)

Files: create `backend/test/admin-config/admin-config.integration.spec.ts`; reuse existing factories. Each numbered case below is a separate 2–5 minute test addition, focused run and result entry. No production changes by P7.

- [ ] Add I1 `admin remains usable while blank keys keep chat not ready`: create `AppService` with `assemblyFixture().bootstrap/ports`; assert revision 0, no inference/catalogue, liveness and not-ready chat; save settings with expected revision 0 and assert revision/activeRevision 1. Shut down in `finally` and assert close exactly once.
- [ ] Add I5 `publication waits for confirmed persistence and retains owners`: seed `document(1)` with a fixture sealed credential/model; hold repository CAS with `deferred<ConfigCasResult>()`; assert pointer unchanged while pending, resolve confirmed revision 2, assert new pointer and unchanged runtime factory/open/voiceSessions/voiceUsage/admission identities. Also run the existing central publication/drain tests rather than duplicating their full matrix.
- [ ] Add I3 `recognized replacement persists and activates without another save`: injected fetch recognizes OpenRouter and Deepgram US/EU using exact HTTPS GET destinations; call `updateCredential` once; assert one validation call, confirmed revision +1, safe response, encrypted envelope and usable backend snapshot. Check only `GET /api/v1/key`, `GET /v1/auth/token` and fixture model metadata are allowed during validation; reject all inference, speech and temporary-token destinations.
- [ ] Add I4 as separate table-driven cases for both providers: 401/403 → `CREDENTIAL_REJECTED`; 429 → `CREDENTIAL_PROVIDER_RATE_LIMITED`; 503/network failure → `CREDENTIAL_PROVIDER_UNAVAILABLE`; redirect, 204/206, wrong media type, invalid JSON/UTF-8, empty/error-shaped/malformed recognition response and 65,537-byte body → `CREDENTIAL_PROVIDER_RESPONSE_INVALID`; abort-aware stalled fetch/body at 10,000 ms → `CREDENTIAL_VALIDATION_TIMEOUT`. Include dishonest/oversized content-length and chunked overflow. Each case asserts old stored document/active pointer unchanged, no CAS/publish and one validation request with no retry. Deepgram `{}` and request-id-only responses fail; OpenRouter missing recognition fields fails. Fixture success does not certify real-provider semantics.
- [ ] Run a 9,999/10,000 ms fake-clock boundary test with a fetch/body fixture that rejects on the supplied signal's abort. Restore timers after each case; don't use a never-settling mock that ignores AbortSignal and then claim deadline coverage.
- [ ] Add I6 `delayed validation conflicts with newer settings` using this complete regression in the dedicated integration spec. It exercises real central publication instead of manually swapping the repository document:

```typescript
import { expect, it } from 'vitest';
import { AppService } from '../../src/app.service.js';
import { document } from './fixtures.js';
import { assemblyFixture, deferred } from '../assembly/admin-config-fixture.js';

it('delayed validation conflicts with newer settings', async () => {
  const f = assemblyFixture(document(1));
  const started = deferred<void>();
  const response = deferred<Response>();
  f.fetcher.mockImplementationOnce(async () => {
    started.resolve();
    return response.promise;
  });
  const app = await AppService.create(f.bootstrap, f.ports);
  try {
    const replacement = app.adminConfig.updateCredential('openrouter', {
      protocolVersion: 1, expectedRevision: 1,
      action: 'replace', candidate: 'fixture-only-new-key',
    }, app.adminActor());
    const rejected = expect(replacement).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
    await started.promise;
    const settings = structuredClone(document(1).settings);
    settings.chat.titleMaxChars = 70;
    const saved = await app.adminConfig.saveSettings({
      protocolVersion: 1, expectedRevision: 1, settings,
    }, app.adminActor());
    response.resolve(Response.json({ data: {
      label: 'discard', limit: null, usage: 0, is_free_tier: false,
    } }));
    await rejected;
    expect(saved.revision).toBe(2);
    expect(app.currentConfig.current()?.revision).toBe(2);
    expect(f.stored()?.settings.chat.titleMaxChars).toBe(70);
    expect(f.stored()?.credentials.openrouter).toBeNull();
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.repository.compareAndSwap).toHaveBeenCalledOnce();
  } finally {
    response.resolve(Response.json({}));
    await app.operations.shutdown();
  }
});
```

- [ ] Run `npm test -- test/admin-config/admin-config.integration.spec.ts -t "delayed validation conflicts with newer settings"` in `backend/`. If baseline already passes, record baseline green; use a test-local CAS stub ignoring expected revision as a negative control, require the assertion to fail, and restore it. Never weaken assertions or change production to manufacture a red result.
- [ ] Add independent I6 races: two settings saves with expected revision 1 yield exactly one revision 2/one conflict; two delayed credential replacements yield one confirmed change; delayed Deepgram validation conflicts when the stored region changes; confirmed removal beats pending replacement. Verify the losing candidate never becomes active and the winning settings remain intact.
- [ ] Add I7 invalid input/output/context/storage ceiling, warning/duration, retry-delay and quota cross-field cases; unsupported model/catalogue failure never writes/activates. Missing master key/encryption failure, repository failure before dispatch and `{ outcome: 'uncertain' }` retain the old active snapshot. Unknown write blocks subsequent mutations until authorized reconciliation; verify read-back/journal behavior through existing persistence/drain cases, not a blind retry.
- [ ] Add admission bounds: two concurrent validation requests occupy the slots; third is `ADMIN_RATE_LIMITED`; six starts per minute then seventh refused; release/failure doesn't leak a slot; unchanged counters after config edits. Route discrepancies to P2/P6.
- [ ] Run `npm test -- test/admin-config/admin-config.integration.spec.ts test/assembly/admin-config.spec.ts test/assembly/config-drain.spec.ts --reporter=verbose`; record discovered/pass/fail/skip counts. With an exclusive commit turn, stage only the new spec and commit `test(admin-config): verify offline saves validation and revision races`.

## Task 3 — Real HTTP security/redaction integration (S1/I2)

File: `backend/test/admin-config/admin-config.security.integration.spec.ts`. Reuse the AppModule boot pattern in `backend/test/assembly/admin-http.spec.ts`, override `AURVIN_CONFIG` with bootstrap and `AppService` with the fixture service, call `configureApplication` with `bodyParser: false`, bind port 0 to loopback, restore any test environment changes and close in `finally`. Test actual admin controller, not `StubAdminController`.

- [ ] Add the success path: GET `/api/admin/config`, PUT settings, POST `/api/admin/config/credentials/openrouter` and `/deepgram`, confirmed removal with `{ protocolVersion: 1, expectedRevision, action: 'remove', confirm: true }`. All replies carry `Cache-Control: no-store`, no ETag, safe public schema, server-resolved actor/role assumption, no secret/envelope/provider response details. Missing confirmation fails before persistence.
- [ ] Add exact-origin tests: configured origin succeeds; absent/null/wrong/comma-separated origin and cross-site GET fail; reject origin before reading an oversized or malformed credential body. OPTIONS advertises PUT/POST without writing. CORS/origin/TLS are not authorization tests; record the server-assigned development role and deferred authentication explicitly.
- [ ] Add body tests as separate cases: form/text/compressed JSON, query strings, empty/array JSON, invalid UTF-8, malformed JSON, unknown settings/provider/actor/envelope fields; 16,385-byte declared and chunked bodies return 413. Verify rejected requests never reach provider fetch or config mutation. Add aborted and 5-second stalled body cases using `node:http` to a loopback test port; no unbounded sockets remain.
- [ ] Add production ingress cases: exact HTTPS origin with trusted same-host loopback peer and single `X-Forwarded-Proto: https` succeeds; plaintext, remote peer, missing/http/comma/duplicate forwarding header fails. Verify development exception requires development + localhost origin + localhost Host + loopback peer; remote HTTP is refused. Reuse `trustedAdminHttpsIngress` for synthetic peer variants. Do not disable TLS or start a deployment gateway; this certifies local ingress policy only.
- [ ] Add redaction probes: fixture candidate, previous key, master-key sentinel, raw provider error-body sentinel and thrown exception sentinel must be absent from all captured public responses/log lines/errors/telemetry. Credential service decrypt round-trip stays backend-only. Don't dump fetched bodies, headers, whole config or envelopes to evidence when an assertion fails; expose only check ID/category.
- [ ] Run `npm test -- test/admin-config/admin-config.security.integration.spec.ts test/assembly/admin-http.spec.ts test/admin-config/admin-config-api.spec.ts --reporter=verbose`. For each new check confirm an incorrect test-local ingress/redaction stub makes it fail, then restore. Route production failures to P2/P6 and rerun after their commits. Commit only the new file as `test(admin-config): cover assembled ingress and secret redaction`.

## Task 4 — Native fixture prerequisites and encrypted durability (N1/N2)

Files: `backend/test/admin-config/integration-fixture.ts`, `admin-config.native.e2e-spec.ts`.

- [ ] Before any native connection, require operator-supplied `AURVIN_TEST_MONGODB_URI` and exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`. Do not discover a URI from `.env`, set one, print one, provision MongoDB or borrow the app database. Absent URI means named native checks **skipped; required native gate blocked**. A supplied URI with wrong/missing prefix is a failing safety precondition, not an opportunistic skip.
- [ ] Use `nativeDatabase()` for UUID-generated names and cleanup. Run `hello` on the generated handle and require replica-set `setName` and writable primary; standalone/unreachable/incompatible topology is a blocked/failing prerequisite, never native certification. Do not allow a standalone fallback. Drop only that handle's generated DB after its owners and sockets are stopped.
- [ ] Build one dedicated `openAdminIntegration` fixture with `loadBootstrapConfig`, `AppService.create`, real `DurableChatRuntime`, `createPersistenceBundle`, `MongoConfigRepository`, fixed assets, model metadata and provider/speech fixtures. Reuse HTTP patterns from legacy `openAssembled` but not its env-authoritative setup. Use one `open` port returning the guarded bundle and one close/drain/release authority; don't call `openPersistence` a second time to seed config.
- [ ] Before runtime bootstrap, seed through the already admitted repository `createIfAbsent` only when empty, using `document`, `CredentialService.seal` and explicit `settings` overrides. For restart on the same generated DB, read existing config instead of reseeding. Supply a shared native handle to repeated opens; close app/owner before opening the replacement; drop DB only at outer fixture teardown. Retain first `gen_fixture` plus unique subsequent generation IDs and existing fault-injection seam.
- [ ] Install deny-by-default fetch and speech socket factories before AppService creation. Validation allows exactly the three recognition URLs; catalogue metadata uses a fixture `/models` response; text `/chat/completions` and speech sockets are simulated locally only. Every unexpected destination fails. Never call original fetch or production `socketFactory`; keep provider Authorization assertions private/synthetic.
- [ ] Add N1 `stored settings ignore legacy env on native restart`: seed model A/input/output/voice flags and encrypted A keys, run, stop safely, reopen with contradictory synthetic legacy env/model/flags, assert stored revision/settings/keys win and obsolete warning is name-only. Also test empty config/missing key bootstrap: GET admin works, ready 503, no generation, safe voice off, no automatic import.
- [ ] Add N2 `native config stores encrypted credentials only`: inspect the bounded `config` document, assert one stable `_id: 'aurvin'`, schema/revision/actor/timestamp; two saves of the same synthetic key have distinct nonces/envelopes; decrypt to the key only inside backend test memory. Flip tag/ciphertext and swap credential-name/schema binding to prove authenticated failure. Restore only the generated fixture data and prove wrong/missing master key or unsupported stored schema yields safe diagnostic/not-ready, no env fallback or overwrite.
- [ ] Audit the six transcript/checkpoint/memory/accounting collections separately: no keys, master key, envelopes or complete `configSnapshot`. Ciphertext belongs solely to `config`; no unbounded history/duplicate credential metadata. API projection contains only configured/validated metadata, not prefix/suffix/fingerprint/length. Don't include raw MongoDB records in evidence.
- [ ] Run `npm run test:e2e -- test/admin-config/admin-config.native.e2e-spec.ts -t "native config stores encrypted credentials only" --reporter=verbose`, then the entire new native spec. Record each test/pass/fail/skip and cleanup outcome. A skip does not prove encryption/restart. Commit exact helper/spec as `test(admin-config): add isolated encrypted persistence fixtures`.

## Task 5 — Text/voice activation, admission and recovery regressions (N3–N5/R1/R2)

File: extend `backend/test/admin-config/admin-config.native.e2e-spec.ts`; read existing runtime/voice fixtures without taking their ownership.

- [ ] N3 test `accepted A survives publication before stream attachment`: HTTP accept under A, save B through admin, attach SSE, verify all model requests use A key/model/max_tokens and attempt-bound deadlines. Fresh accepted work uses B; duplicate submission preserves IDs/A. Run through real AppService operations/transport as well as raw runtime; this is F2's decisive regression, not merely a test of the pointer getter.
- [ ] N3 test `automatic retry stays A explicit retry captures B`: hold A's first fixture 503/backoff, publish B, release and verify bounded automatic retries remain A including OpenRouter `user`; make terminal failure, explicitly retry same accepted input, assert new attempt ID/causal predecessor with no duplicate user message and B key/model/budgets. Preserve provider auth/credit passive gates globally; test removal-B separately without relaxing outage admission.
- [ ] N5 lower process concurrency while a text stream is running: no cancel/drain/new runtime, fresh work refused until active slots settle, later admission succeeds. Consume per-user rate allowance, edit limits, assert the same history/counters still apply. Check exactly one active attempt per conversation across text and live voice.
- [ ] N4 create dictation and live sessions under A; publish B key/US→EU/model/queue/deadline/rate changes; inspect injected socket destinations/headers and safe negotiated limits. Active session reconnect/live turns continue A; newly admitted session uses B. Account elapsed minutes/TTS characters at A's rates, not B's; already unknown costs stay unknown. Disabling a mode/Deepgram removal prevents new sessions but doesn't end active ones. Lower quotas retain used allowance and existing leases.
- [ ] Feed only fixture speech events/PCM and fake sockets from `backend/test/fixtures/deepgram/socket.ts`; never request real microphone/speech. Assert one voice usage/reservation authority, no reconnect quota reset, safe capabilities update for new work without changing active negotiated limits. Run P4's clock-based usage suites for precise duration/rate boundaries instead of waiting wall-clock minutes.
- [ ] R1 inject failure after graph result/checkpoint is saved but before assistant append, publish changed/removed/null config, reconcile twice, assert one assistant/user transcript, aligned terminal/checkpoint/accounting/manifest and **zero additional completion POSTs**. For accepted/no-result process-loss, reconcile to interrupted without inference; only explicit retry can start new work. Do not rebuild a lost in-memory A binding from current settings.
- [ ] R1 cover provisional SSE until durable terminal state: append/checkpoint/finalization failure never emits successful completion; length terminal is distinct from completed; cancellation/disconnect/provider timeout remain distinct and no saved output duplicated on retry/recovery. Run existing `backend/test/runtime/local-reconciliation.spec.ts`, `backend/test/integration/{streams,recovery,duplicates,ordering,context,accounting}.native.e2e-spec.ts` after F3 correction.
- [ ] R2 run `npm test -- test/voice/session/config-snapshots.spec.ts test/voice/usage/config-snapshots.spec.ts test/voice/usage/quota.spec.ts test/voice/providers/accounting.spec.ts test/runtime/local-reconciliation.spec.ts test/runtime/text-config.spec.ts --reporter=verbose`. Run native/multi-mode regressions via `npm run test:e2e -- test/runtime/text-config.native.e2e-spec.ts test/runtime/voice-recovery.native.e2e-spec.ts test/persistence/voice-metadata.native.e2e-spec.ts test/admin-config/admin-config.native.e2e-spec.ts --reporter=verbose` and `npm test -- test/voice/integration --reporter=verbose` (these routine-discovered specs can still native-skip).
- [ ] Record existing voice investigation limitations from baseline separately; never mark them fixed just because config tests pass. If F2 or F3 is unresolved, mark affected AC5/AC8 blocked. Commit only P7's extended spec as `test(admin-config): verify text voice snapshots and durable recovery`.

## Task 6 — Synthetic import, real process restart and ownership (N6–N8)

File: `backend/test/admin-config/admin-config-import.native.e2e-spec.ts`. All data/keys are synthetic and all databases generated; do **not** run the operator command against the checkout environment.

- [ ] Add N6 empty-store import using `importLegacyConfiguration(env, ports)` from `backend/src/scripts/import-config.ts`. Pass an explicit synthetic legacy env record with test URI/generated DB/master key, disabled voice flags and unknown rates; inject validation/catalogue/asset ports and the admitted open port. Assert exactly one encrypted revision-1 document, preserved deliberate disabled modes/unknown rates, no runtime/inference and confirmed close.
- [ ] Add populated-store refusal: invoke again, assert `already-configured`, no validation/CAS and byte-identical stored settings/envelopes. Invalid first or second provider recognition, encryption or storage failure leaves no config document; failed import never deletes an existing key. Include competing executor, ownership loss and pending local journal/quarantine refusal; prove previous owner/sentinel remains and no stale takeover happens.
- [ ] Test `runImportCommand` with `env`, `argv: []`, `loadEnvFile: () => {}` and `importConfig` delegating to the isolated real import ports. Capture stdout/stderr privately. Assert success code 0, populated/ownership refusal 2, failures/unknown write/cancel/unsafe close 1; output contains only fixed category and setting names/counts, no synthetic credentials/master-key/database URI/raw error. Verify import completion waits for confirmed close and a late/uncertain write does not report success.
- [ ] Add a child-process case after `npm run build` in `backend/`: spawn `process.execPath` with a static `--input-type=module -e` test script importing compiled `dist/scripts/import-config.js` exports. Send the synthetic env record via stdin, not argv, URL, shell interpolation or evidence. Child process environment is an infrastructure-only allowlist (Windows SystemRoot/PATH/temp as needed), never `{ ...process.env }`; do not inherit application credentials or database targets.
- [ ] In that static child script install deny-by-default fetch before imports, supply fixture recognition/catalogue responses, call `runImportCommand({ env, argv: [], loadEnvFile: () => {}, importConfig })`, and wrap `importLegacyConfiguration` with explicit full-checkout asset paths (`backend/src/instructions/system.md`, root `product_knowledge.md`). Don't execute the default CLI entry or load `.env`. Output only a sanitized summary/category/exit code. Parent verifies encrypted document through generated DB handle.
- [ ] Terminate first child gracefully/await exit; open a second independent process against the same generated test database/master key, read stored revision/settings, construct AppService with injected providers and send only safe public metadata to parent. Assert recognition not repeated during restart, stored keys decrypt for new fixture work and contradictory legacy env is ignored. Test wrong key/schema diagnostics separately. Do not claim process-kill/crash certification from an in-process AppService reopen.
- [ ] Add bounded child timeout and IPC shutdown handling; on unsafe stop retain ownership evidence and mark the gate blocked, never remove sentinel to complete cleanup. Drop only generated DB after confirmed test-process termination. Validate no private environment load/rewrite; no secrets in output, snapshots or committed artifacts.
- [ ] Run `npm run build`; then `npm run test:e2e -- test/admin-config/admin-config-import.native.e2e-spec.ts --reporter=verbose`. Counts must distinguish function-level import, process restart and ownership cases. Missing isolated prerequisites block AC7, even if offline import tests pass. Commit only new spec/helper changes as `test(admin-config): verify isolated import and process restart`.

## Task 7 — UI flows and actual desktop/mobile inspection (U1–U6/B1)

Files: create the three `frontend/src/features/admin-config/integration-tests/` files listed above; don't modify P5 fixtures. Node Vitest discovers `src/**/*.test.ts`, not DOM or `.test.tsx`; server-render/source checks do not establish browser interaction.

- [ ] Add `config-flow.test.ts` using `createAdminConfigClient`, `createEditState/editReducer`, `publicConfig/adminFailure` and injected fetch. Cover dirty setting → credential validate-save response → revision advances while dirty setting survives → settings Save uses new revision; assert credential POST contains no settings and capability refresh failure doesn't roll back confirmed saved revision.
- [ ] Add stale/conflict/unknown-write flow: public baseline A plus unsaved edits, POST returns conflict/uncertain; retain edits, don't promote server's `currentRevision` to writable expectedRevision, require explicit refresh before another mutation. Safe errors contain neither candidate nor raw thrown text. Add removal request exact confirmation and no automatic client retry.
- [ ] Use this complete Node integration regression as the first baseline-green/negative-control check; add remaining flow cases in this same file:

```typescript
import { expect, it, vi } from 'vitest';
import { createAdminConfigClient } from '../../../api/admin-config-client.ts';
import { createEditState, editReducer, isDirty } from '../config-edit-state.ts';
import { publicConfig } from '../testing/fixtures.ts';

it('credential save advances revision without saving a dirty setting', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(publicConfig(2)));
  const client = createAdminConfigClient({ fetch: fetcher });
  let state = createEditState(publicConfig(1));
  state = editReducer(state, { type: 'edit', path: 'chat.titleMaxChars', value: '40' });
  const config = await client.updateCredential('openrouter', {
    protocolVersion: 1, expectedRevision: 1,
    action: 'replace', candidate: 'fixture-only-candidate',
  });
  state = editReducer(state, { type: 'credentialSaved', config });
  expect(state.baseline.revision).toBe(2);
  expect(state.fields['chat.titleMaxChars']).toBe('40');
  expect(isDirty(state)).toBe(true);
  expect(JSON.stringify(state)).not.toContain('fixture-only-candidate');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    protocolVersion: 1, expectedRevision: 1,
    action: 'replace', candidate: 'fixture-only-candidate',
  });
});
```

- [ ] Run `npm test -- src/features/admin-config/integration-tests/config-flow.test.ts --reporter=verbose` in `frontend/`; verify test-local stale revision/accidental settings request causes failure, then restore. No implementation change unless routed to P5.
- [ ] Reuse the existing development fixture at `/src/features/admin-config/testing/dashboard-browser.html` for its named draft/menu/tab/save/replace/text-continuity checks. Inspect its actual results, not just source. Its voice check is passive and its storage checks are limited; don't claim active voice or IndexedDB/cache coverage from it.
- [ ] Create an additional development-only browser entry within P7's integration directory mounting the real `App` after installing injected client/fetch, WebSocket/media/audio stubs, storage instrumentation and confirm queue. Reuse `testing/browser-checks.ts` DOM utilities. Keep all request destinations deny-by-default and no native microphone/provider access. Show named pass/fail counts and safe failure categories in a visible results region; no automatic fallback to real fetch or socket.
- [ ] U1/U2: check history scroll independent of pinned Super admin row; menu above row; keyboard activation/Escape/outside click/outside focus/focus return; disabled Sign out explanation and no logout; Config default, Arrow/Home/End tab behavior where supported, empty Analytics/no analytics request; desktop section navigation/mobile selector, one section at a time, labels/units/focus/status and reduced-motion styling. A keyboard event tool is not available: use the fixture's native `press`/DOM focus helpers and expose assertions for browser snapshot rather than pretending a click proves keyboard behavior.
- [ ] U4/U5: vary synthetic candidate length while configured dots stay fixed; no reveal/key substring. Masked editor typing triggers zero POSTs; Validate and save triggers exactly one scoped POST and closes/clears on success, cancel, section change and editor exit. Only actionable validation failure may retain candidate transiently in editor. Verify leaving doesn't copy it into global edit/chat state and a successful credential operation preserves unrelated dirty fields. Verify recognition-not-credit/model-access limitation copy is visible.
- [ ] U6: dirty section/page switch asks for discard; decline retains edits and selection, accept clears appropriately; saving disables duplicate submission/navigation; invalid cross-field rows are accessible; conflict requires refresh; unavailable/unknown-write does not display saved/active; remove decline makes zero request, confirm makes exactly one request without candidate and updates configured state.
- [ ] Instrument candidate-bearing writes before mounting: local/session Storage `setItem`, cookie setter, IndexedDB add/put, CacheStorage put/add/addAll and history/URL navigation. Assert sentinel absent from storage keys/values, rendered text, query strings/caches and unrelated requests; record safe counts only and restore stubs on teardown. Existing unrelated theme storage is allowed, candidate persistence is not. Do not assert that browser extensions/password managers are controlled.
- [ ] U3: begin fixture text stream, navigate Manage Aurvin, deliver provisional and confirmed terminal events while dashboard is visible, Back to chat preserves selection/draft/transcript and no abort/cancel/re-submit. Then negotiate a fixture live voice session and navigate both directions while sending fixture events; session/WebSocket/media owner stays the same, close/stop counts remain zero, safe capability refresh affects only the next session and current limits stay A. Explicit user stop still works once. Passive navigation alone doesn't pass this active-session gate.
- [ ] Start only Vite with `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` in `frontend/`. No backend/application env startup is needed for closed browser fixtures; if port occupied, use a verified free port and record actual URL instead of disrupting another session.
- [ ] Before reusing evidence, read preserved `.openchamber/screenshots/admin-config-desktop-configured-row-2026-10-13T12-37-14-897.jpg` and `admin-config-mobile-configured-row-2026-10-13T12-37-29-425.jpg`. Record known originating commit/fixture/viewport and whether current UI still matches. They can support unchanged appearance only, never current interactions/security/active voice. Unknown provenance means reference-only, not a passed gate.
- [ ] Use `openchamber_web` `browser.open` with the fixture URL and `viewport: desktop`, then snapshot and inspect selectors returned. Read named fixture results and console errors. Click Manage Aurvin/Config/Analytics/each section and type only synthetic inputs through snapshot selectors; inspect actual status and computed styles. Resize `viewport: mobile`, repeat actions and inspect compact selector/overflow/focus. Record actual dimensions from the fixture/browser, not assumed preset widths.
- [ ] Capture desktop/mobile configured row, invalid/dirty or conflict state, and empty Analytics with `browser.capture` safe labels after candidate editor is closed. Add new captures under `.openchamber/screenshots/` only; never stage secrets, candidates, live sessions or screenshots. Record relative path, viewport, commit, fixture counts, observations and console errors in verification/operations evidence. If browser is display-only (`drivable: false`) or inaccessible, B1 is blocked; don't substitute SSR/screenshots/source presence for interaction results.
- [ ] Run `npm test -- src/features/admin-config src/features/chat/state/voice-draft-lock.test.ts --reporter=verbose`; commit only the three new integration files as `test(admin-config): verify dashboard flows and browser continuity`.

## Task 8 — Full checks, evidence and exit gates (Q1/M1)

- [ ] Obtain owner-correction commits for all observed defects, record them with the actual tested HEAD, and rerun each reproducer plus siblings. No reviewer/review-triggered fixer dispatch. A required failure/unrun gate remains blocked; do not mark this worker complete just because evidence documents it.
- [ ] Reconcile M1: read `backend/src/platform/config/{bootstrap-config.ts,bootstrap-config.spec.ts,legacy-config-import.ts}`, P1's exhaustive mapping in `docs/super-admin-config/plan1.md`, `backend/.env.example`, README and feature operations procedures; inspect normal runtime consumers for legacy manageable reads. Distinguish legacy parser/explicit import and fixture use from normal startup; route mapping gaps to P1/P6. Confirm infrastructure/master-key/test-only settings never become dashboard fields and `CONNECT_TIMEOUT_MS` stays shared. Run `npm test -- src/platform/config/bootstrap-config.spec.ts src/platform/config/manageable-config.spec.ts src/platform/config/legacy-config-import.spec.ts --reporter=verbose` in `backend/`; do not silently replace the exhaustive map with a grep count.
- [ ] Run these commands separately in the named working directory. Use existing installed dependencies; if absent use `npm ci` in each package after confirming lockfile consistency (never root workspace install). Preserve logs privately and report sanitized counts. Commands below are planned, not already passed:

| Directory | Exact command | Expected evidence |
| --- | --- | --- |
| `backend/` | `npm run build` | Exit 0; no TypeScript errors; compiled child-import fixtures now available. |
| `backend/` | `npm run lint` | Exit 0; record warning/error counts. |
| `backend/` | `npm test -- --reporter=verbose --reporter=json --outputFile.json=../.openchamber/super-admin-config-backend-unit.json` | All discovered routine cases accounted for, including native-gated routine voice specs; no failing tests. |
| `backend/` | `npm run test:e2e -- --reporter=verbose --reporter=json --outputFile.json=../.openchamber/super-admin-config-backend-e2e.json` | All discovered e2e cases accounted for; explicitly enumerate native skips/blocked gates and any non-native failures. |
| `frontend/` | `npm run build` | Exit 0; no TypeScript/bundle errors. |
| `frontend/` | `npm run lint` | Exit 0; record warning/error counts. |
| `frontend/` | `npm test -- --reporter=verbose --reporter=json --outputFile.json=../.openchamber/super-admin-config-frontend-unit.json` | All discovered Node cases accounted for; no claim of DOM coverage from Node tests. |

- [ ] When isolated prerequisites exist, additionally run `npm run test:e2e -- test/admin-config test/integration test/runtime test/persistence --reporter=verbose`. Record selected suite counts independently; don't add them to full-run counts or treat repeated passes as new coverage. Full e2e includes native suites outside that selection and must still be accounted for.
- [ ] Record per command: workdir, exact command, tested commit, UTC start/end, exit code, discovered files/tests, passed/failed/skipped/todo counts and zero-discovery flag. Build/lint have no test counts: mark them not applicable, not zero tests passed. JSON reporter pending includes unrun/skips: reconcile individual statuses/reasons with verbose output rather than labeling every pending case a pass. Don't use `it.fails` to hide unresolved required failures. Keep raw JSON untracked and inspect for sensitive data before quoting a summary.
- [ ] Native absence: record each affected test group skipped and AC2 native restart/AC3 at-rest/AC5 integrated native/AC7/AC8 native gates blocked. Wrong prefix/topology/connectivity: record the safety/precondition failure and zero certified native cases. Browser absence: AC1/B1 and relevant U3/U4 gates blocked. Paid/live/Azure/gateway checks remain not authorized/skipped, never production-certified; gateway header/access-control release gates from operations remain explicit.
- [ ] Populate `verification.md` with AC1–AC8/check-ID/command or browser observation/result/count/evidence/limitations table, all F1–F3 dispositions, tested commit range and current environment. Add only actual evidence entries to `operations.md`; explicitly distinguish fixture import/restart from operator application migration (not run), and local simulated ingress from real gateway/TLS (not run).
- [ ] Check Markdown relative links and referenced tracked paths; validate `git diff --check`, `git diff --stat` and staged diff. Report the state-file milestone inconsistencies to the orchestrator for reconciliation, don't edit state/final report. Preserve screenshot links as local evidence without committing `.openchamber/` artifacts.
- [ ] With an exclusive commit turn, `git add -- docs/super-admin-config/verification.md docs/super-admin-config/operations.md`, inspect `git diff --cached --name-only`, then commit `docs(super-admin-config): record integrated verification evidence`. Stage additional test corrections only as exact P7 filenames in separately focused commits; never `git add .`.

## Exit and handoff

Return implemented P7 files/commit hashes, owner defect corrections and F1–F3 acknowledgements, AC-to-check table, actual seven-package-check exit/count summaries, native/browser outcomes and evidence paths. Research/review remain **skipped**. The orchestrator alone updates `state.md` and writes `final_report.md`.

P7's completion requires executed required gates with passing evidence and no unresolved acceptance defects. If isolated replica-set access, interactive browser access, F1 owner acknowledgement, F2 revision-safe attachment behavior or F3 harness correction is absent, return **blocked** with the exact decision/prerequisite/owner needed. Documented skips are honest evidence, not acceptance success. No result from this plan certifies live providers, paid features, Azure, public access or deployment readiness.
