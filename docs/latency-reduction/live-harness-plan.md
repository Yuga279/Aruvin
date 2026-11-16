# Read-only Live Harness Implementation Plan

> **For agentic workers:** Execute in this same owning session with TDD; no delegation, review, commits or service calls are authorized. This explicit task overrides the generic skill's dispatch/commit suggestions.

**Goal:** Prepare a fail-closed selected Calendar-read harness and execution-boundary guard using only synthetic transports; keep actual execution blocked until server/credential/budget integration is separately authorized and verified.

**Architecture:** Reuse `runText` and existing timing/redaction analysis, never the full CLI suite. Add a narrowly allowlisted Calendar fetch boundary and a two-snapshot synthetic runner; the live mode rejects unconditionally because no production injection or reliable total-spend enforcement exists. No JSON attestation/approval flag can convert client-side checks into server enforcement.

**Tech Stack:** Existing TypeScript ESM, Zod, native fetch interfaces and Vitest; no dependencies/scripts/shared runtime edits.

## Steps

- [x] Write red safety tests, then implement numerical-envelope validation and actual injected Calendar-fetch denial.
- [x] Write red selected-run tests, then implement bounded synthetic pairing with existing HTTP/SSE client and redacted timing evidence; live must remain blocked before any callback.
- [x] Run only the owned offline specs and targeted lint/type diagnostics; document precise integration gaps and append dated continuation without rewriting historical evidence.

## Files and task details

Create `backend/src/benchmark/readonly-calendar-boundary.ts` and `backend/test/benchmark/readonly-calendar-boundary.spec.ts`. The boundary must accept an explicitly injected fetcher (no global/default transport), reject methods other than GET, credentials/redirects/unsupported requests, and allow only the exact approved Calendar events-list path/window/known query keys. Reserve request count before dispatch, enforce monotonic whole-run expiry and cap response bytes. Invalid/out-of-scope requests poison the boundary, so a caught denial cannot continue. Do not log URLs, headers or bodies. Test native `Request` input cannot bypass method checks and response redirects cannot escape the guard.

Representative first red assertion:

```typescript
const upstream = vi.fn<typeof fetch>();
const boundary = createReadOnlyCalendarBoundary(policy, upstream);
await expect(boundary.fetch(url, { method: 'POST' })).rejects.toThrow('READONLY_BOUNDARY_DENIED');
expect(upstream).not.toHaveBeenCalled();
```

Run from `backend/`: `npm test -- test/benchmark/readonly-calendar-boundary.spec.ts --maxWorkers=1`. Initially minimal exports will lack denial behavior and assertions must fail; then implement the allowlist once at the fetch boundary. A real production `GoogleCalendarApi` injected with this boundary must reject its create path before the underlying fake transport. All calls remain synthetic.

Create `backend/src/benchmark/readonly-harness.ts` and `backend/test/benchmark/readonly-harness.spec.ts`. Strict envelope: one fixed list-events scenario, one turn per baseline/current source, matched harness/semantic fingerprints, separate 40-hex source and build identities, expiring explicit operator/data/cost/database-write approval references, fixed synthetic target/window, numeric cost/token/request/time/response limits. Require cumulative token/request budgets to cover unchanged server per-turn ceilings rather than silently reducing model/context/tools. Reject invalid/expired/mismatched envelopes with a payload-free code. No dotenv, environment reads, CLI, installations or implicit network.

Representative red assertions:

```typescript
await expect(runReadOnlyHarness(envelope, { mode: 'live' })).rejects.toThrow('LIVE_RUNTIME_INTEGRATION_REQUIRED');
expect(() => validateReadOnlyEnvelope({ ...envelope, maxTurns: 3 })).toThrow();
```

Synthetic mode requires injected wire fetcher plus per-turn bounded evidence/settlement receipt. Reuse `runText` exactly once per snapshot, then `safeEvidence`/`correlate`/`analyzeTurn`; no voice/retries/warmups. Stop pair on failure, unknown usage/billing, wrong tool, missing durable completion/cleanup evidence, or time expiry. Emit no payload/raw IDs. Mark synthetic provenance, unknown actual billing, missing command/wave/seal coverage. A runtime receipt is test data, not an authentication or hard-spend control. Do not provide an adapter that can run live with only config flags.

Run from `backend/`: `npm test -- test/benchmark/readonly-harness.spec.ts --maxWorkers=1`. Use only in-memory JSON/SSE/Response fixtures and fake clocks; assert no second submission after first failure and no callbacks at all for live mode.

## Verification and handoff

Run both exact owned specs, then `node node_modules/oxlint/bin/oxlint --type-aware src/benchmark/readonly-calendar-boundary.ts src/benchmark/readonly-harness.ts test/benchmark/readonly-calendar-boundary.spec.ts test/benchmark/readonly-harness.spec.ts` (verify installed executable path first). No broad tests/e2e or package build while I1 owns shared changes. Check new-file whitespace/local links explicitly because files are untracked. Record red/green counts, commands, boundaries and remaining runtime/credential/hard-spend/approval/native gates in `live-harness-results.md`, and append dated I4 note to `acceptance-live.md`. Integration/full build remains orchestrator-coordinated. No commit/staging action.
