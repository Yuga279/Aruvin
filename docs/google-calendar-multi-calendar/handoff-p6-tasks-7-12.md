# Handoff — Google Calendar Multi-Calendar Plan 6, Tasks 7-12

Paste the block below into the next session.

---

## Handoff prompt

You are continuing **P6 of the Google Calendar multi-calendar programme** in the Aurvin
repository at `D:\Peter\ECG\Aurvin`, branch `codex/google-calendar-plugin`.

- Plan: `docs/google-calendar-multi-calendar/plan6.md` ("Conversational Calendar Authority
  and Pinned Recovery Implementation Plan"). Read the task sections you own before writing code.
- Workflow: MAW with `--skip review`. Red-Green-Refactor TDD for every task. Review stays
  **skipped**, never passed. Planning, execution, meaningful tests, compatibility checks,
  defect correction and final verification are still required.
- Node/TypeScript: ESM with mandatory `.js` local import specifiers. Mandatory file header
  on every new file and on any file modified by more than 30%.

### Already committed (do not redo)

| Commit | Content |
| --- | --- |
| `3679f83` | Owner amendment **I1**: `CalendarProposalStore.getCurrentSlot` (pending slot including expired records) and `getAuthority` (pending record / persisted reply+consumption / tombstone). `getCurrent` still hides expired records. |
| `eac927d` | Owner amendment **I8**: the MCP server-side gate check now mirrors the client — a v2 capability gate is rechecked with the v2 input shape only when the binding has a target; a null-target binding skips the target check. Legacy gate path and create authorization unchanged. |
| `7df2570` | **Task 4**: durable single-use cross-turn proposal authority (`calendar-authority.ts`), expired-proposal tombstoning, ordinal reply interpretation, proposal content expiry clamped to discovery retention, calendar turn advances the graph boundary, v2 runtime reads/writes resumable decisions through the v2 evidence stores. |
| `9cac8fd` | **Task 5**: server-owned availability preflight (`calendar-preflight.ts`), conflict proposals with the disclosed fingerprint and limitations, and the same check inside the operation writer's create entry point. |
| `8396dbd` | **Task 6 (partial)**: one shared `buildV2CreateOperation` seam; the authority basis is derived from verified proposal evidence. |
| `4063227` | Owner amendment **I3**: durable idempotent budget debits (`calendarDebitId`, `debit` port, `consume(change, identity?)`). |
| `0257aa0` | Owner amendment **I2**: `operationEventV2Schema` + `appendEventV2` / `listEventsV2`. |
| `c920c55` | **Task 7 (test only)**: "uses the stored event on yes and returns a matched create result before narration". |
| `d9fcb37` | Docs: P6 progress in `state.md`; I1/I2/I3/I8 ratified in the `plan6.md` gap table. |

Green as of the last run: `npm --prefix backend run build` and `npm --prefix backend run lint`
exit 0. Focused suites — `test/runtime/calendar-authority.spec.ts`,
`test/runtime/calendar-preflight.spec.ts`, `test/runtime/calendar-loop.spec.ts`,
`test/persistence/calendar-multi-{operations,accounting,proposals}.spec.ts`,
`test/plugins/mcp/calendar-server.spec.ts` — 7 files / 55 tests pass.

Full backend suite baseline right now: **17 failed files, 33 failed tests, 1756 passed,
10 skipped** (227 files). It was 39 failed tests before this session; nothing regressed.

### Red tests you inherit, with the evidence trail

1. **The v2 read path fails with a provider error** — `test/runtime/calendar-logical-tools.spec.ts`
   (4 tests), `test/runtime/calendar-operation.spec.ts` (1), `test/runtime/calendar-publication.spec.ts` (1),
   `test/runtime/calendar-recovery.spec.ts` (3), `test/runtime/calendar-recovery-unavailable.spec.ts` (3).
   - Symptom: the v2 `executeReadV2` invoke returns
     `{ category: 'delivery', code: 'CALENDAR_TEMPORARILY_UNAVAILABLE', retry: 'none' }`
     (the client's `SAFE_UNAVAILABLE`), so the loop raises
     `AppError('PROVIDER_ERROR', 'The Calendar request could not be completed.')`.
   - Already ruled out: the server-side gate branch does **not** throw (instrumenting
     `backend/src/plugins/mcp/calendar-server.ts` produced no failure), and the client's
     `runGateCheck` is unchanged. The failure is in the call phase, i.e. inside the MCP tool
     callback in `backend/src/plugins/mcp/calendar-server.ts` or the tools layer in
     `backend/src/plugins/google-calendar/tools.ts` / `calendar-api.ts`.
   - The fixture's Google mock already answers `GET /calendars/{id}/events/{eventId}` and
     `GET /calendars/{id}/events` (`backend/test/runtime/calendar-runtime.fixture.ts`), so check
     what the v2 get branch validates against the response body (`projectEvent`, the event
     schema, `visibility`/`extendedProperties`) and what the mock returns.
   - Note: the fixture pushes the `get`/`create` effect **before** checking the outcome, so an
     effect count is not evidence that a call succeeded.
2. **`calendar-logical-tools.spec.ts` still expects the legacy authorization.** It submits the
   canonical JSON prompt (`Create this Google Calendar event: {...}`); the v2 runtime requires a
   natural request, so the turn stops with "I need explicit confirmation" and the budget stays
   at `logicalTools: 0, creates: 0`. Task 7 owns this spec: move it to a natural request and to
   the v2 expectations (`calendarRequests` now includes the preflight, so a create is 2 requests).
3. **`test/assembly/calendar-{capability,flow,assets}.spec.ts`, `test/plugins/integration/*`,
   `src/platform/config/calendar-config.spec.ts`, `test/model/sse.spec.ts`,
   `test/persistence/{accounting,calendar-accounting}-reporting.spec.ts`,
   `test/operations/bootstrap.spec.ts`, `test/assembly/admin-http.spec.ts`** — 17 failing tests
   outside the runtime folder. `calendar-assets` asserts operator-runbook text that is missing
   from the docs. The two accounting-reporting failures are load-timeout flakes that pass in
   isolation. Confirm whether each is in P6's scope, a downstream consumer, or pre-existing
   before changing anything.

### Remaining tasks, in order

- **Task 7** — reply/clarification loop integration and complete tool groups.
  Files: `backend/src/chat-runtime/calendar-loop.ts`, the Calendar sections of
  `backend/src/chat-runtime/durable-chat-runtime.ts`, `calendar-ports.ts`;
  `backend/test/runtime/calendar-loop.spec.ts`, `calendar-logical-tools.spec.ts`,
  `calendar-lifecycle.spec.ts`, `calendar-targeting.spec.ts`.
  Requirements: a reply is resolved from the stored proposal (no new model create, no silent
  second dispatch); persist and emit the clarification before sealing; one matched result group
  per model-requested call (list/get/discovery/availability/create) built with
  `completeToolGroupV2Schema`; v2 sources never pass through the legacy group schema; the
  internal preflight is evidence, not a fake model tool group.
  Commit: `feat(calendar): integrate durable replies and complete v2 tool groups`.
- **Task 8** — reference-only graph state and context assembly.
  Files: `backend/src/agent/state.ts`, `turn-graph.ts`,
  `backend/src/context/calendar-context.ts`, `backend/src/chat-runtime/calendar-ports.ts`,
  `calendar-loop.ts`; create `backend/test/runtime/calendar-graph.spec.ts`; modify
  `backend/test/context/calendar-context.spec.ts`.
  Commit: as recorded in `plan6.md` Task 8.
- **Task 9** — pinned recovery without paid or write replay.
  Files: `backend/src/chat-runtime/calendar-recovery.ts` (create),
  `backend/test/runtime/calendar-multi-recovery.spec.ts` (create).
  Requirements: reuse the saved graph result; use the I1 authority lookup for the exact persisted
  reply/consumption after a consume-before-operation crash; never replay a paid model call or a
  write; an unknown write stays unknown.
  Commit: as recorded in `plan6.md` Task 9.
- **Task 10** — durable receipts and truthful publication.
  Files: `backend/src/chat-runtime/calendar-publication.ts`, `calendar-publication.spec.ts`.
  Requirements: project durable v2 receipts and clarification/narration outcomes truthfully; a
  saved receipt survives a failed narration. This is the spec that currently fails.
  Commit: as recorded in `plan6.md` Task 10.
- **Task 11** — multi-turn concurrency and budget enforcement.
  File: `backend/test/runtime/calendar-multi-concurrency.spec.ts` (create); run it together with
  `calendar-budget.spec.ts`, `calendar-logical-tools.spec.ts`, `calendar-lifecycle.spec.ts`,
  `calendar-multi-recovery.spec.ts`. Exact counts matter: the server preflight and rechecks are
  HTTP counts, not additional model tools; a server-resumed single create still occupies exactly
  one logical action in its approving turn.
  Commit: `test(calendar): verify concurrent approvals and persistent runtime limits`.
- **Task 12** — native integration and full verification.
  Run sequentially: `npm --prefix backend run build`, `npm --prefix backend run lint`,
  `npm --prefix backend test`, `npm --prefix backend run test:e2e`. Record the exact commit set,
  environment, results and the remaining limitations. Native database suites need
  `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; never print the URI, and
  report a skipped native suite as skipped, never as evidence.

### Rules that keep this branch honest

- **Do not write into another owner's files.** P6 owns `backend/src/chat-runtime/calendar-*.ts`,
  the Calendar sections of `durable-chat-runtime.ts`, `backend/src/agent/state.ts`, `turn-graph.ts`,
  `backend/src/context/calendar-context.ts` and `backend/test/runtime/calendar-*`. Contracts,
  persistence, the MCP server/client, the Google Calendar plugin and the model adapters belong to
  P1/P2/P4/P5/P8.
- When a task needs another owner's file, stop and report the gap the way I1, I2, I3 and I8 were
  handled: a scoped owner amendment, committed separately, recorded in the `plan6.md` gap table and
  in `state.md`. Do not cast around a type and do not keep an alternate bypass entry point.
- Keep each commit focused: stage named files explicitly, never `git add .`, and never include
  secrets, dependencies, generated output or unrelated work.
- **Line endings:** this repository's blobs are mostly LF. The `edit`/`write` tooling rewrites
  files as CRLF. After any worker or tool edits a file, check
  `git diff --numstat -- <file>` against `git diff --numstat --ignore-cr-at-eol -- <file>`; if they
  differ, the file's endings drifted and the diff will look like a whole-file rewrite. Convert it
  back to LF before committing.
- **Windows sandbox:** set `$env:GIT_CONFIG_GLOBAL="nul"; $env:GIT_CONFIG_SYSTEM="nul"` before git
  commands, or git fails on the host `.gitconfig`. Set the repo-local identity once
  (`git config user.name "peter-eclabs"; git config user.email "peter.j@ecgroup-intl.com"`) or the
  commits are refused.
- A local chat success is not production readiness. Record measurements and limitations, and do
  not claim final verification is complete while `plan6.md` Task 12 is unfinished.

### Start here

1. `git log --oneline -10` and `git status` — the tree must be clean.
2. Read `plan6.md` Task 7 and the two red-spec areas above.
3. Fix the v2 read path first: it blocks the largest share of the remaining red tests and it is
   the precondition for Tasks 9, 10 and 11.

---

## Files worth reading before you touch anything

- `docs/google-calendar-multi-calendar/plan6.md` — the authoritative task list and the ratified
  interface-gap table.
- `docs/google-calendar-multi-calendar/state.md` — execution index, ownership and commit records.
- `backend/src/chat-runtime/calendar-authority.ts` — proposal publish/consume/tombstone.
- `backend/src/chat-runtime/calendar-preflight.ts` — availability preflight and condition rules.
- `backend/src/chat-runtime/calendar-operation.ts` — `buildV2CreateOperation`, `deriveV2Basis`,
  the writer and its preflight injection point.
- `backend/src/chat-runtime/calendar-loop.ts` — the turn loop: proposal handling, preflight,
  operation reservation, dispatch, tool groups.
- `backend/test/runtime/calendar-runtime.fixture.ts` — the runtime fixture (virtual clock, Google
  mock, failure injector, `order` trace).
- `backend/test/runtime/calendar-multi-fixture.ts` — `disclose`, `event`, `busy`, `availability`.
