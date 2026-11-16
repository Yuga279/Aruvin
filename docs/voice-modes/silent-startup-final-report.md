# Silent voice startup correction — final report

13 October 2026. Status: implemented and offline verified; full-device/native verification blocked. Review **skipped**.

## Outcome

The authorized single silent provider check confirmed that Deepgram returns a valid resolved TTS model name different from the configured request identifier. Aurvin incorrectly rejected that handshake, then mapped the startup failure to the misleading delivery-unknown notice. Commit `817888f` replaces exact-name equality with the existing bounded nonempty-string validator. Request model selection, request/version validation, and accounting remain unchanged.

The source change is one line in `backend/src/voice/providers/flux-tts.ts`; provider and session regressions are in `backend/test/voice/providers/flux-tts.spec.ts` and `backend/test/voice/session/live.spec.ts`. No other delivery defects, error mapping, UI, dependencies, or settings changed.

## Execution record

- Existing user UI work committed on request: `ed3f5cb`.
- Investigation/evidence: `78599a8`, `6e4472e`, `eff53e4`; [investigation](live-delivery-investigation.md).
- Separate P12 planner: `7ad7af3`; [plan](plan12.md).
- One implementation worker: `817888f`; red provider result 3 failed / 9 passed, plus failing startup regression with no ready event. Green focused result: 5 files / 45 tests passed, no skips.
- User explicitly chose the shared checkout after another session switched to `codex/super-admin-config`. Only named voice-task paths were staged.

## Verification

Environment: Windows, Node v24.18.0, npm 12.0.1. Post-fix checks ran on commit `817888f` in the shared checkout.

| Directory | Check | Actual result |
| --- | --- | --- |
| frontend | Two focused existing UI suites before UI commit | 6 tests passed |
| backend | Worker focused provider/accounting/live/gateway suites | 45 passed, no skips |
| backend | `npm test` | 94 files passed / 2 skipped; 543 tests passed / 10 skipped |
| backend | `npm run build` | Exit zero |
| backend | `npm run lint` | Exit zero, warnings emitted |
| backend | `npm run test:e2e` | Exit one: 17 files failed / 4 passed / 11 skipped; 70 tests failed / 18 passed / 34 skipped |

The e2e failures report `Isolated native test configuration is required.` Operator-supplied `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_` were absent; no application database was substituted. Native verification is blocked, not passed. The new startup regression uses actual adapters and transport with in-memory provider/accounting fixtures and fake timers: ready remains open for 6000ms without audio/text. Malformed names and request/version fields remain rejected.

## Limits and next action

- The pre-fix authorized live check used exactly one STT/TTS pair, zero text/audio/retries, no database changes, and terminated within 7.484 seconds. No post-fix paid repeat or browser/device/app-startup test was run.
- Restart the backend and retry voice in the real app to confirm the user-visible symptom is gone. A production build uses the newly rebuilt backend output.
- Other reproduced delivery-origin, settlement-deadline, sample-precision, and diagnostic-mapping issues are recorded in the investigation and deferred; they are not fixed or certified by this correction.
- Historical workflow evidence is preserved. No review result or full production readiness is claimed.
