# Voice agent failure follow-up — 15 October 2026

## Outcome

Reproduced and corrected an application-assembly defect consistent with the supplied incident: the first live voice turn can succeed, but subsequent context assembly fails before inference because the production assembler lacks the voice-delivery reader. The original incident's underlying exception was masked, so exact historical attribution remains unconfirmed. No provider retry policy was changed.

## Incident evidence

The supplied logs share voice-session hash `h:3253b37b3ededcd01d1d7785` and conversation hash `h:5613fcc1fa7f79435f8baa87`:

| UTC | Observation |
| --- | --- |
| 09:17:20.393 | First TTS audio for the recorded turn; elapsed 595 ms. |
| 09:17:20.485 | First playback acknowledgment; elapsed 92 ms. |
| 09:17:23.539 | Delivery settled with no error code; elapsed 10,205 ms. |
| 09:17:33.866 | `VOICE_AGENT_FAILED`, queue samples zero, no current turn/response identifiers. |

This sequence points toward a later finalized-input path rather than demonstrating failure of the earlier synthesis/playback. Successful HTTP request observations immediately afterward do not establish voice success or a provider cause.

## Root cause and correction

- [AppService.createRuntime](../backend/src/app.service.ts) constructs `ReferencedContextAssembler` with message and memory repositories but previously omitted `metadata`.
- [ReferencedContextAssembler.heardMessage](../backend/src/context/referenced-context-assembler.ts) requires `metadata.getVoiceDelivery` when a previous assistant message is internal live speech. Without it, assembly throws `NOT_READY` with `Voice delivery needs reconciliation.`
- Initial empty-history assembly does not need this reader. The failure therefore appears on a subsequent turn, before response preparation/model dispatch.
- [LiveFlow](../backend/src/voice/session/live-flow.ts) catches finalized-hook errors, and [voiceError](../backend/src/voice/session/voice-session.options.ts) maps non-voice codes such as `NOT_READY` to `VOICE_AGENT_FAILED`.
- The production fix supplies `metadata: persistence.metadata` to the existing assembler. No new dependency, runtime instance, fallback, inference replay, or retry wrapper was added.
- The context factory already forwards metadata; budget-specific assembler copies preserve injected dependencies. The native voice runtime harness supplies metadata explicitly, so it did not exercise this production omission.

## Regression and verification

New regression: [backend/test/assembly/voice-context.spec.ts](../backend/test/assembly/voice-context.spec.ts). It captures the real AppService-created assembler through existing offline assembly ports rather than constructing a separately corrected assembler. Both completed and interrupted prior deliveries are covered.

- **Red:** both subsequent-turn cases failed with `NOT_READY` / `Voice delivery needs reconciliation.` before the production change; initial assembly succeeded.
- **Green:** initial input appears once without reading delivery; subsequent context contains the previous user input, the actually heard assistant text, and the new input once. Interrupted unheard text remains outside model context, and the original archive content is unchanged.
- Worker focused checks: 52 tests passed across four files.
- Worker backend `npm run build`: passed.
- Worker backend `npm run lint`: exit zero with existing warnings; no warning-free claim.
- Worker backend `npm test`: 966 passed, 10 skipped; 123 files passed, two skipped.
- Parent independent check: assembly regression, voice pipeline, live flow, and voice context suites — 40 tests passed across four files.
- Parent executable assertion against the built error mapper confirmed that this `NOT_READY` exception maps to `VOICE_AGENT_FAILED`.
- `git diff --check`: passed, with checkout line-ending notices.

Verification baseline: `247e717` plus the uncommitted source/test changes recorded here, Windows checkout. Unified review **skipped**, not passed. No frontend source changed.

## Limitations and next validation

No live OpenRouter/Deepgram calls, microphone/speaker checks, application database inspection, deployment, or provisioning were performed. Native/e2e suites were not run for this correction: operator-supplied isolated MongoDB URI and the approved test prefix were absent. Offline ports do not certify native persistence behavior.

Restart the backend with this change and manually verify consecutive voice turns, including an interrupted reply followed by another question. This fixes the reproduced wiring defect, not every possible source of the generic error. Original non-voice error classification remains masked in the existing voice log, and the unused Deepgram connection-backoff helper remains a separate resilience gap; neither was changed or represented as fixed here. Provider-only retries cannot repair a missing backend dependency.
