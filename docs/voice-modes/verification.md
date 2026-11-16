# Voice Modes Verification

Scope: [goal](goal.md), [state](state.md), [P11 plan](plan11.md).
Review: skipped. No reviewer verdict is inferred.
Gate: verification pending; both server modes remain default-off.

## Evidence levels and environment

Statuses: unrun, blocked, fail, fixture-pass, native-pass, device-pass, deferred.
Fixture/native passes apply only to the listed behavior and environment, not a release gate.
Tested commit, UTC timestamp, Node/npm/OS, package, command, counts, duration,
fixture/provider versions and clean/dirty owner paths are recorded per execution below.
No execution result is supplied by the existence of this document.
Native prerequisites: operator-supplied AURVIN_TEST_MONGODB_URI and
AURVIN_TEST_DB_PREFIX=aurvin_p2_test_; generated isolated databases only.
Do not log URIs, credentials, raw audio, transcripts or unsent drafts.

## Acceptance matrix

| ID | Applicable assertion / evidence | Initial status |
| --- | --- | --- |
| A1 | Existing text build/lint/unit/e2e; multi-mode text before/after; no auth/tool regression claim | fixture-pass (auth/tool deferred) |
| A2 | voice-matrix permission denial/activation + all real browser permission rows | fixture-pass (real device unrun) |
| A3 | multi-mode final dedupe; frontend interim replacement; Nova fixture normalization | fixture-pass (hardware unrun) |
| A4 | voice-matrix selection replacement + P7 cancel/selection tests | fixture-pass |
| A5 | multi-mode pauses/finals cause no inference; dictation-controller recording remains active | fixture-pass |
| A6 | P7 composer-events Enter/click finalization races + real stop-to-editable p95 | fixture-pass (hardware latency unrun) |
| A7 | live wire JSON has no hidden text; voice-matrix SSR; real DOM/accessibility inspection and actual audible reply | fixture-pass (real audio unrun) |
| A8 | multi-mode prompt membership/session isolation; P6/P2 restored-checkpoint heard-context tests | fixture-pass (native DB unrun) |
| A9 | fault-recovery interruption prefix/late frames; frontend local clear; real p95 stop <=250 ms | fixture-pass (hardware latency unrun) |
| A10 | Mutation confirmation, actions, tools: deferred, outside scoped agent | deferred |
| A11 | fault-recovery sealed agent outcomes, reconnect and idempotency; mutation duplication portion deferred | fixture-pass (mutation deferred, native DB unrun) |
| A12 | voice-matrix mute drops/no replay + gateway mute epoch tests; real muted input observation | fixture-pass (real device unrun) |
| A13 | draft restore, resource close, archive/status/stream/sidebar filtering; real exit navigation | fixture-pass |
| A14 | injected TTS/STT/network/device faults, P3 resilience, P6 recovery; actual provider/proxy/device drills | fixture-pass (staging drill unrun) |
| A15 | Hardware speaker echo/noise with product-approved false-interrupt tolerance | blocked (tolerance unspecified) |
| A16 | Origin, binding, identity override, stale epoch/control rejection before speech; authenticated cross-user isolation deferred | fixture-pass (auth deferred) |
| A17 | lifecycle hidden/pagehide/route/session-switch checks; real background/freeze/resume microphone indicator | fixture-pass (real device unrun) |
| A18 | Node keyboard/SSR/CSS contracts + six-browser real keyboard, focus, reduced motion and audio matrix | fixture-pass (six browsers unrun) |

Collision contract: HTTP 409 CONFLICT_ACTIVE_TURN for live-versus-text submit/retry,
competing live reservations, and reverse text-versus-live admission across tabs.
Quota exhaustion is separately 429, not proof of correct execution exclusion.

## Execution records

| UTC | Tested Commit | Workdir / Command | Evidence Class | Tests / Pass / Fail / Skip | Duration | Redacted Artifact | Limitation / Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-09T06:42:51Z | dac1917 | `backend` `npm test` | offline-unit / fixture-integration | 95 files / 93 passed / 0 failed / 2 skipped (533 tests: 523 passed, 10 skipped) | 35.3s | local console / vitest | Native suites skipped without operator-supplied MongoDB URI |
| 2026-10-09T06:12:02Z | dac1917 | `backend` `npm run build` | build | 0 errors | 5.0s | `dist/` | None |
| 2026-10-09T06:12:08Z | dac1917 | `backend` `npm run lint` | linter | 266 files / 0 errors, 203 warnings | 1.0s | local console | None |
| 2026-10-09T06:09:36Z | dac1917 | `frontend` `npm test` | offline-unit / node-matrix | 40 files / 40 passed / 0 failed / 0 skipped (232 tests: 232 passed, 0 skipped) | 2.3s | local console / vitest | Node DOM/audio fakes only; physical browser audio unrun |
| 2026-10-09T06:09:24Z | dac1917 | `frontend` `npm run build` | build | 0 errors | 0.13s | `dist/` | None |
| 2026-10-09T06:09:29Z | dac1917 | `frontend` `npm run lint` | linter | 89 files / 0 errors, 18 warnings | 0.04s | local console | None |
| 2026-10-09T06:43:37Z | dac1917 | `backend` `npm run test:e2e` | e2e / native | 32 files / 4 passed / 17 failed / 11 skipped (120 tests: 17 passed, 70 failed, 33 skipped) | 13.3s | local console | Native database tests require operator-supplied `AURVIN_TEST_MONGODB_URI` and prefix `aurvin_p2_test_` |

## Required automated coverage

Backend: build, lint, npm test, npm run test:e2e; requested integration and evaluation
files must be discovered. Frontend: build, lint, npm test; voice-matrix must be discovered.
Also run existing P2 context/persistence/visibility/deletion, P3 provider/offset,
P4 PCM/queue/client, P5 malformed/state/ticket/epoch, P6 bridge/recovery/serializer,
P7 composer, P8 lifecycle, P9 quota/usage/drain/flag, and P10 assembly suites.
Configured unavailable native services fail. Unconfigured native tests and the
absent pilot-artifact test are skips, separately blocked evidence, never passes.
Azure certification is outside this admitted native topology.

## Defects and independent mode gates

At the P10 handoff verify the conversation binder, lazy shared reservations,
activity/idle/duration warnings, stop reasons and shutdown/drain wiring. Record an
actual failing check and owner before requesting a correction; no P11 source fix.
Dictation and live eligibility are independent and require their applicable
native/privacy/resource/browser and measured pilot evidence. Nothing here enables
flags, deploys, authorizes provider spending, or certifies public/multi-user use.
External checks: [staging evidence](staging-evidence.md), [pilot evaluation](pilot-evaluation.md).
Final integrated commit verification and final_report.md belong to V.
