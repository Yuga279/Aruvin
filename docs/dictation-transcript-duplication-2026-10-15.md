# Dictation transcript duplication investigation — 15 October 2026

## Outcome and scope

Reproduced the reported temporary duplication in the existing dictation draft model. Fixed its source with one expression change in the Nova dictation adapter: segment identity is now `channel:start`, not `channel:start:duration`.

Only the dictation adapter, its existing provider tests, an existing frontend dictation composition test, and this record belong to this change. The checkout contains concurrent, uncommitted live-voice work; none of those pre-existing changes was edited or included. No services were restarted, configuration changed, dependencies added, or live provider requests made.

## End-to-end investigation

Traced the complete transcript display path:

1. [`NovaSttAdapter`](../backend/src/voice/providers/nova-stt.ts) validates Deepgram `Results` and translates them to partial/final events with a segment ID.
2. [`DictationFlow`](../backend/src/voice/session/dictation-flow.ts) forwards those IDs unchanged as `dictation.partial` / `dictation.final` and deduplicates finals by ID.
3. [`VoiceClient`](../frontend/src/api/voice-client.ts) validates the envelope, mode, epoch, and sequence, drops replayed control sequences, and forwards each accepted event. It does not concatenate transcript text.
4. [`DictationController`](../frontend/src/features/voice/dictation/dictation-controller.ts) feeds the event into `DictationDraft` and writes the complete composed draft.
5. [`DictationDraft`](../frontend/src/features/voice/dictation/dictation-draft.ts) stores final segments separately from one revisable interim. A final clears the interim only when their IDs match.
6. [`useChatActions`](../frontend/src/features/chat/state/use-chat.ts) and [`chatReducer`](../frontend/src/features/chat/state/chat-reducer.ts) replace the leased draft with the supplied string. [`Composer`](../frontend/src/components/Composer.tsx) renders that string in its controlled textarea. There is no second transcript append at these boundaries.

Checked callers and consumers: application composition selects Nova only for dictation, while live conversation uses Flux. Segment IDs are opaque strings in the wire/client contracts; consumers do not parse the old duration component. Fixing the producer therefore satisfies the existing replacement contract without modifying shared transport, React state, or live conversation code.

### Root cause

Deepgram interim results cover a growing/revised audio window. Duration changes between revisions and may shrink when a final result commits a shorter prefix. The adapter incorrectly included that changing duration in segment identity.

For the same speech, this produced different IDs for interim and final text. The draft then rendered the newly committed final **plus the stale interim**, rather than replacing it. The next partial replaced the single interim slot, and Stop/completion used finals only, explaining why the duplicate disappeared and the final output looked correct.

The same unstable key could also let a repeated final with a changed duration bypass final deduplication. Stable identity fixes that at the same source. Identical words spoken in a later segment still have a different start and are preserved.

Provider references checked via Context7:

- [Using interim results](https://developers.deepgram.com/docs/using-interim-results): successive results retain the same start while their end changes; a final can end earlier than the preceding interim.
- [Endpointing and interim results](https://developers.deepgram.com/docs/understand-endpointing-interim-results): subsequent final segments must be concatenated; `speech_final` is distinct from `is_final`.

### Deterministic reproduction before the fix

Ran the actual `DictationDraft` with synthetic, provider-shaped IDs, without microphone access or a paid request:

| Event | Old segment ID | Visible draft |
| --- | --- | --- |
| partial | `0:0:1.1` | `Hello Aurvin` |
| final | `0:0:1.4` | `Hello Aurvin. Hello Aurvin` |
| next partial | `0:1.4:0.6` | `Hello Aurvin. Next sentence` |

At the duplicated step, `text(false)` was already `Hello Aurvin.`, independently confirming why final-only completion hid the bug. This reproduces the reported behavior in the real composition logic, not a browser recording of the user's session.

### Why existing checks missed it

The shared `novaResult` fixture always supplies duration `0.8`; existing provider tests consequently gave partial and final results identical IDs. Frontend fixtures used stable symbolic IDs such as `one`. Neither exercised changing provider durations.

## Minimal fix and regression coverage

- Remove duration from the Nova-produced segment ID; retain channel and audio-window start. Add a short comment explaining why duration is not identity.
- Add a provider regression with growing interim durations, a shorter final, a repeated final with a different duration, a stale partial, and genuinely repeated words at a later start. Assert the complete normalized event sequence. Local object overrides keep the shared fixture untouched.
- Update two existing provider expectations to the corrected ID format.
- Strengthen the existing frontend transport/controller/reducer composition test to assert each intermediate draft, final replacement, the next segment, and a tail partial finalized after Stop. Continue checking selection preservation, draft-only behavior, and explicit Send.

The provider regression was run **before** the production edit and failed with changing IDs and an extra final. After the edit it passed. No text-similarity deduplication, delays, interim suppression, or UI workaround was introduced.

## Verification evidence

Environment: Windows, Node `v24.18.0`; starting HEAD `364e169`, with the concurrent working changes present. Results describe this working snapshot, not an isolated certification of all live-voice changes.

| Directory | Command | Result |
| --- | --- | --- |
| backend | `npm test -- test/voice/providers/nova-stt.spec.ts -t "keeps segment identity stable"` before fix | Expected failure: unstable IDs / duplicate final |
| backend | `npm test -- test/voice/providers/nova-stt.spec.ts test/voice/session/dictation.spec.ts` after fix | 11 passed |
| frontend | `npm test -- src/features/voice/dictation src/features/chat/state/voice-draft-lock.test.ts` | 42 passed |
| backend | `npm test` | 943 passed, 10 skipped; 121 files passed, 2 skipped |
| frontend | `npm test` | 330 passed; 49 files passed |
| backend | `npm run lint` | Exit 0; warnings outside the changed files |
| frontend | `npm run lint` | Exit 0; warnings outside the changed files |
| backend | `npx tsc --noEmit --incremental false --project tsconfig.build.json` | Passed |
| frontend | `npx tsc --noEmit --project tsconfig.app.json` | Passed |
| backend | `npm run test:e2e` | Exit 1: 19 passed, 40 skipped, 70 failed at missing isolated native database configuration |
| repository | `git diff --check` scoped to task files | Passed |

E2E failures report `Isolated native test configuration is required.` from the database fixture guard: operator-supplied `AURVIN_TEST_MONGODB_URI` and the required `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_` configuration are unavailable. They are environment-blocked failures, not passes or skips. No application database was substituted. Routine-suite skips likewise remain skips, not evidence of service/hardware readiness.

Full emit/bundling builds were not run, to avoid replacing outputs used by the concurrent work; no-emit TypeScript checks were used instead. Real-browser microphone/provider verification was not performed. Unified review: **skipped**, consistent with repository instructions.

Optional manual confirmation, once the operator loads the updated backend: start a fresh Dictate message recording; speak several phrases with pauses; confirm each partial becomes its final without a second copy; repeat the same words deliberately and confirm they remain; Stop and confirm no duplicate disappears only at completion. This remains unperformed and would use the configured speech service.
