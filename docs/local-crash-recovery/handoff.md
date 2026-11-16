# Local crash recovery — STOPPED handoff

## Transfer instruction

The user stopped implementation on 8 October 2026. This handoff is the only edit made after that instruction. **Do not treat the feature as completed or certified.** Continue only when the user authorizes the next agent. Preserve all current changes. No skills, old launcher plan, research/plan artifacts, new agents, reviewer, live/native/Azure/e2e tests, external provisioning or paid inference were requested/authorized.

The latest request is a useful, default-off Windows LOCAL recovery path for idle crashes/provider-generation crashes **between acknowledged database writes**, not arbitrary mid-write recovery. The previous unconditional-refusal implementation was rejected by the user.

## Commits and workspace status

- Own completed commit: **`7844658`**, `feat: add fail-closed local crash recovery foundations`. This is the earlier, rejected no-op foundation, not completion of the current journal feature.
- **No follow-up implementation commit or staging has been performed.** Follow-up source/tests/docs remain uncommitted. No edits/tests/commits were started after the STOP request.
- Existing untracked `docs/terminal-close-launcher/goal.md` and `state.md` remain unrelated, untouched and uncommitted.
- A sibling worker has substantial uncommitted session-edit/pin/delete changes. Do not stage shared files wholesale or discard sibling work.
- Pre-edit shared-file snapshot: `C:/Users/Peter/AppData/Local/Temp/opencode/local-recovery-app-service-before.ts`. It includes the sibling's session `update`/`delete` delegates before this worker's recovery edits. Compare it with current `backend/src/app.service.ts` to isolate recovery hunks; **do not restore it over the working file**. Check current HEAD/index and coordinate staging before using any derived patch.

### Own unfinished follow-up changes

- `backend/src/persistence/mutation-journal.ts` — new shared restricted driver facade and mutation journal.
- `backend/src/persistence/records.ts` — strict `local-mutation-v1` marker, `released` flag, bounded ancestry, idle/busy token schema; removes fictitious replica-set ID/member proof fields. Binding uses machine/installation/guard hashes, exact configured URI+database hash, PID/creation and appName.
- `backend/src/persistence/ownership.ts` — raw control-store separation; acknowledged conservative busy bootstrap insert; primary idle/revision/owner handoff CAS; journal health/drain; recovery completion; graceful local release retains binding/provenance by setting `released:true` rather than deleting local sentinel. Session/data ownership writes still use `store`, not raw `controlStore`.
- `backend/src/persistence/persistence.ts` — production opt-in admission, OS guard lifecycle, explicit replica-set URI/primary check, guarded store+saver setup, bootstrap completion and cleanup. Default-off path remains separate.
- `backend/src/operations/local-recovery.ts` — removes `unsupportedNativeProof`/currentOp scaffolding; exact local process check plus idle journal handoff; bounded reconciliation and fresh maintenance/runtime lifecycle.
- `backend/src/operations/local-guard.ts` — installation hash now uses exact canonical `realpath`, without lowercasing distinct case-sensitive paths. Existing parent-linked PowerShell guard remains from the previous commit.
- **Own hunks only** in `backend/src/app.service.ts`: import `finishLocalMaintenance`; hard-fail local admission errors; construct stopped maintenance after catalogue limits load, authorize persisted ancestors, reconcile/drain/complete evidence, then expose a fresh runtime on the same bundle. Leave sibling session delegates intact.
- Own docs/config: `README.md`, `backend/.env.example`, `run.bat` (comments only; frontend gates unchanged), `docs/aurvin-phase-1/operations.md`.
- New tests: `backend/test/persistence/mutation-journal.spec.ts`, `local-open.spec.ts`, `backend/test/operations/local-startup.spec.ts`.
- Rewritten own tests: `backend/test/persistence/local-owner.spec.ts`, `backend/test/operations/local-recovery.spec.ts`.
- Existing own guard/real reconciliation tests from the prior commit remain relevant: `backend/test/operations/local-guard.spec.ts`, `backend/test/runtime/local-reconciliation.spec.ts`.

### Unrelated sibling changes to preserve

Observed sibling files: backend contracts `api.ts`, `interfaces.spec.ts`, `repositories.ts`, `session.ts`; HTTP `README.md`, `chat-http.controller.ts`, `chat-http.service.ts`; `operations/observe-persistence.ts`; persistence `pagination.ts`, `sessions.ts`; HTTP fixtures/routes/session-actions tests; persistence archive-native/session-actions tests; frontend API client/protocol/client tests, Sidebar and tests, chat reducer/types/tests and chat CSS. `app.service.ts` is shared as described above. This list may evolve: inspect status before staging.

The sibling's actual session update/pin/delete implementation uses `sessions.updateOne` (delete is a lifecycle/tombstone change), so it is covered by the driver facade. This worker did not implement or own those actions. Recovery listing's owner-only OR predicate was already in the previous own commit and remains in the sibling-modified `sessions.ts`.

## Chosen safety invariant and current implementation

1. One guarded executor per configured database. OS mutex is acquired before connection/admission and remains held through client cleanup. Parent-linked helper holds an opened exact Windows process handle; unexpected guard loss defaults to exiting this backend, not leaving it running without exclusion.
2. Every ordinary semantic data mutation is serialized through `MutationJournal.write`: owner-bound majority+journal-ACKed idle→busy CAS **before dispatch**; actual driver mutation is awaited with forced majority+journal concern; busy→idle is issued only after successful completion. Data-write exceptions/unknown results leave busy and quarantine subsequent mutations/admission. No clear in catch/finally or ambiguous-result reread.
3. Queue ceiling: 100 jobs/process/database. Ordinary mutations add up to two sentinel writes. Bootstrap creates an ACKed busy sentinel, holds busy across application/stock-saver DDL setup, and clears only after successful setup. Setup failure never quietly releases it.
4. Raw sentinel control transitions are the only bypass. They use owner/revision/token/state conditions. The shared facade is passed to **both RecordStore and the installed stock MongoDBSaver**. Audit found data methods `updateOne`, `replaceOne`, `findOneAndUpdate`, `bulkWrite`, plus startup `createIndex`; these are wrapped against real driver receivers (no internal double wrapping). Only read `find`/`findOne` and limited read cursor methods are exposed. Only a constrained ping command is exposed. Unknown methods, arbitrary commands, aggregation (including `$out`/`$merge`), transactions, foreign DB/collection and raw cursor/client/database escapes are blocked. Whitelist uses `Object.hasOwn`, not inherited object keys.
5. At automatic handoff, persisted marker must decode as the supported version, same binding/app attribution must match, and exact old PID/creation lifetime must be proven dead. Live, reused or unverifiable lifetimes refuse. **Primary replacement requires the same observed owner/revision AND idle marker.** A late begin-intent winning first makes the CAS fail; if handoff wins, old intent is fenced before any old data dispatch. No currentOp absence, sleep, lease expiry or process-death-only settlement argument.
6. Handoff atomically records new binding, conservative busy bootstrap and bounded inherited ancestry/pending recovery. Crash during a mutation remains busy and refuses; crash between ACKed recovery writes can hand off again with ancestry intact. Ancestry ceiling is 16; overflow needs operator repair.
7. Startup recovery runs after verified catalogue limits, without invoking inference: maintenance stops acceptance, authorizes persisted old owners, scans active attempts **and owner-only leftovers**, reuses sealed saved results or interrupts no-result inputs, fully drains, and completes durable recovery evidence before constructing the fresh runtime. Scan is capped at 1,000 pages, page size at most 50/configured max. Catalogue failure remains diagnostic and does not clear pending evidence.
8. Graceful local close stops/drains journal writes and only releases a completed idle owner through raw CAS, retaining the sentinel binding with `released:true`; it then closes client and releases guard. Pending/unfinished accepted work retains an unreleased idle sentinel for restart. Busy work remains blocked. Restart still requires the previous exact process to be dead; same-process reopening after close is intentionally refused. Default-off bootstrap cannot silently claim a retained local sentinel.

## Restrictions and remaining work

- Default **OFF**. Explicit `AURVIN_LOCAL_CRASH_RECOVERY=true` in backend `.env` or inherited environment; `run.bat` does not silently enable it. Requires Windows/native profile, explicit replica-set URI, writable primary matching its set name, and supported majority+journal acknowledgements. No Azure certification or support inferred.
- Binding is strict exact configured URI+database hashing, not guessed alias equivalence. Credential/URI/installation/machine changes and disabling mode on a bound database require explicit operator migration. No plaintext URI/message/credentials are logged or persisted by the feature.
- Legacy/missing/malformed/future local evidence refuses. Complete one-time **operator** stopped-work handoff/reconciliation and graceful release of the legacy default sentinel before enabling local mode. Never delete a sentinel merely because a lease expired.
- No external writers, restore/server replacement/topology migration, arbitrary mid-write/DDL recovery, automatic accepted-input inference, exactly-once billing or charge prevention is promised.
- **Do not call this finished:** inspect the final diff/end-to-end lifecycle, remaining edge cases and fixtures before approval/commit. Explicit queue-overflow/prolonged-drain and unexpected *helper* death could use focused regressions; parent/owned-child crash guard release is already tested. Check operational wording against retained released sentinels (README was updated; operations text may need final consistency tightening).
- Latest changes after the final lint run were small handoff error normalization and corresponding race/release tests; latest build/full routine suite includes them. Re-run lint before landing.
- No follow-up whole-tree `tsc --noEmit` run was performed. Earlier foundation work found six errors in unchanged native/bootstrap test files; do not claim all tests type-check solely from Nest build/Vitest transpilation.
- Commit only task-owned files/hunks. Do not wholesale stage `app.service.ts`, `sessions.ts`, sibling tests/front-end files or old launcher docs. Latest status before STOP had all implementation work unstaged; confirm current index rather than assume this remains true.

## Actual verification already performed

All commands used `backend/` except git checks. No configured application env/live DB imported by the new fixtures; fake driver/provider I/O and local OS processes only.

- RED: `npm test -- test/persistence/mutation-journal.spec.ts` failed because the new journal module did not exist, before implementation.
- Subsequent focused fake-driver tests passed; stock saver source was inspected at `backend/node_modules/@langchain/langgraph-checkpoint-mongodb/dist/checkpoint.js`: setup uses `createIndex`, checkpoint uses `updateOne`, pending writes use `bulkWrite`.
- Latest focused seven-file run: **31 passed**, 7 files (journal, local-open, local-owner, local-startup, local-recovery, local-guard, real local-reconciliation).
- `npm run build`: initially failed on two obsolete narrowed `observed` references; fixed. **Latest run at 14:20 passed**.
- `npm run lint`: **passed at 14:15**, existing unrelated warnings; newly introduced facade unbound-method warnings were corrected before that run. No clean-whole-repository warning claim.
- `npm test`: **latest 14:20 run passed: 62 files, 366 passed, 1 skipped (367 total), 33.65 s**. This includes sibling routine tests. Skip is the existing operator-gated native assembled smoke, not passing native evidence.
- An earlier full+focused parallel run collided on a fixed fake database mutex identity and failed one local-open test. Corrected fixture to use random database names; subsequent full suite passed twice. Do not overlap OS-resource fixtures with identical fixed identities.
- `git diff --check`: **passed at 14:20**, only CRLF conversion warnings, no whitespace errors. It examined the shared workspace including sibling changes.
- No native/Azure/e2e/live-provider tests ran. Current Context7 MongoDB/Node documentation was consulted for driver methods, majority+journal acknowledgement and replica-set rollback semantics; this is not actual-service certification. Review remains skipped.

## Safe next verification (after authorization)

Read root AGENTS and this handoff, inspect current git status/index, then examine the existing implementation rather than restarting old plans. Run checks from `backend/`:

```text
npm run build
npm run lint
npm test -- test/persistence/mutation-journal.spec.ts test/persistence/local-open.spec.ts test/persistence/local-owner.spec.ts test/operations/local-startup.spec.ts test/operations/local-recovery.spec.ts test/operations/local-guard.spec.ts test/runtime/local-reconciliation.spec.ts
npm test
```

Run focused and full suites sequentially unless all OS guard fixture identities are isolated. Verify no operator-supplied native test configuration can activate the routine suite's optional native assembled test before running; no service/live authorization has been granted. Do **not** run `test:e2e`, `test:azure`, live behavior or native suites. Use `git diff --check` and named/hunk staging only. Preserve sibling work and private/untracked configuration. Main agent intended to run final checks/report; no feature-completion claim should be made from this stopped handoff alone.
