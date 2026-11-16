# Verification: voice-canvas-multimodal

## Decision and scope
- Overall gate: offline integrated verification passed after both discovered owner defects were corrected; **full acceptance remains blocked** on unverified live/browser/native gates and pre-existing baseline limitations.
- Research: skipped. Unified review: skipped.
- W3 defect corrections: W1 `49559bf`, W2 `83ce037`; both integrated suites rerun green (`33/33` backend, `15/15` frontend).
- Authorizations actually received: offline deterministic test execution in repository working tree.
- Requested scopes not granted: live provider calls, live microphone capture, real browser runtime execution, external infrastructure provisioning, and production deployment are unauthorized and blocked.
- Isolated native database tests: skipped/blocked (prerequisites `AURVIN_TEST_MONGODB_URI` not supplied; operator authorization required before connecting/creating/dropping test databases).
- No production claim: offline fixture success and virtual timing proxies do not establish production latency, browser rendering timing, or audible synchronization.

## Tested commit set and environment
- Pre-test HEAD: `8f4f8f0` (`docs(voice-canvas): open integrated verification ledger`).
- W1 commits: `b8e09cd`, `28a349c`, `aa3083e`, `2109835`, `1dd3704`, `b1048e0`, `49f5f02`, `2f6cfc9`, `ce5158d`, `6b49768`.
- W2 commits: `24a7e43`, `ae76686`, `58f3059`, `fe94dc7`, `9e8a224`, `13113e1`.
- L3 commit: `a30ff49`.
- W3 integration commits: `8f4f8f0`, `717ed70`, `716f079`, `48b4b17`, `3cb841f`, `aafbb1b`, `06e9f07`.
- W3 defect corrections: `49559bf` (W1 labeled chart coordinates), `83ce037` (W2 external SVG paint URLs).
- Final code HEAD before documentation closeout: `83ce037`.
- Branch: `voice-chat-upgrade`.
- OS: Windows_NT (x64, 16 logical cores).
- Node: `v24.19.0` (conforms to `^22.22.3 || ^24.15.0 || >=26.0.0`).
- npm: `11.17.0`.
- Package locks:
  - backend: `00a1e39` (`refactor(calendar): execute REST tools without embedded MCP`).
  - frontend: `8a39652` (`feat(voice): pin offline embedded capture detector`).
- Dirty paths: none (exclusive P3 test files only).
- Fixture credentials: synthetic offline deterministic mocks only; no real provider keys or tokens.

## Command ledger
| ID | Status (planned/executed/skipped/blocked) | Workdir | Exact command | HEAD | Exit | Discovered | Passed | Failed | Skipped | Duration | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CMD-1 | executed | backend | `npx --no-install vitest list test/voice/integration/canvas-multimodal.spec.ts --json` | `8f4f8f0` | 0 | 33 | 33 | 0 | 0 | 1.8s | 33 discovered test items |
| CMD-2 | executed | backend | `npx --no-install vitest run --config ./vitest.config.e2e.ts test/voice/integration/canvas-multimodal.native.e2e-spec.ts` | `8f4f8f0` | 0 | 3 | 0 | 0 | 3 | 3.6s | 3 skipped tests (prereqs absent) |
| CMD-3 | executed | frontend | `npx --no-install vitest list src/features/voice/integration-tests/canvas-multimodal.test.ts --json` | `8f4f8f0` | 0 | 15 | 15 | 0 | 0 | 0.8s | 15 discovered test items |
| CMD-4 | executed | backend | `npm test -- test/voice/integration/canvas-multimodal.spec.ts --reporter=default --reporter=json --outputFile.json="C:/Users/Peter/AppData/Local/Temp/opencode/voice-canvas-backend-focused.json"` | `8f4f8f0` | 1 | 33 | 31 | 2 | 0 | 6.6s | 31 passed, 2 failed (W1 defect) |
| CMD-5 | executed | backend | `npm test -- test/voice/agent/speech-prose.spec.ts test/voice/agent/pipeline.spec.ts test/voice/agent/voice-delivery.spec.ts test/runtime/voice-output.spec.ts test/runtime/voice-history.spec.ts test/context/voice-context.spec.ts test/persistence/voice-messages.spec.ts src/contracts/voice.spec.ts src/contracts/canvas-artifact.spec.ts` | `8f4f8f0` | 0 | 99 | 99 | 0 | 0 | 3.6s | 99 passed across 9 suites |
| CMD-6 | executed | frontend | `npm test -- src/features/voice/integration-tests/canvas-multimodal.test.ts --reporter=default --reporter=json --outputFile.json="C:/Users/Peter/AppData/Local/Temp/opencode/voice-canvas-frontend-focused.json"` | `8f4f8f0` | 1 | 15 | 14 | 1 | 0 | 0.9s | 14 passed, 1 failed (W2 defect) |
| CMD-7 | executed | frontend | `npm test -- src/api/voice-protocol.test.ts src/api/protocol.test.ts src/features/canvas/canvas.test.ts src/features/voice/state/live-voice-controller.test.ts src/features/voice/state/live-voice-reducer.test.ts src/features/chat/ChatView.voice.test.ts src/components/group-voice-messages.test.ts src/components/MessageItem.test.ts` | `8f4f8f0` | 0 | 114 | 114 | 0 | 0 | 1.1s | 114 passed across 8 suites |
| CMD-8 | executed | backend | `npm run build` | `8f4f8f0` | 0 | - | - | - | - | 5.2s | Nest build complete |
| CMD-9 | executed | backend | `npm run lint` | `8f4f8f0` | 0 | 592 | - | 0 err | 546 warn | 2.2s | oxlint clean (0 errors) |
| CMD-10 | executed | backend | `npm test` | `8f4f8f0` | 1 | 2490 | 2383 | 97 | 10 | 100.5s | 255 passed files, 24 failed (baseline perf/sandbox EACCES/W1 defect), 10 skipped native |
| CMD-11 | executed | backend | `npm run test:e2e` | `8f4f8f0` | 1 | 160 | 1 | 21 | 138 | 19.7s | 21 failed (sandbox EACCES), 138 skipped native |
| CMD-12 | executed | frontend | `npm run build` | `8f4f8f0` | 0 | - | - | - | - | 3.5s | Vite build clean |
| CMD-13 | executed | frontend | `npm run lint` | `8f4f8f0` | 0 | 163 | - | 0 err | 73 warn | 0.1s | oxlint clean (0 errors) |
| CMD-14 | executed | frontend | `npm test` | `8f4f8f0` | 1 | 576 | 575 | 1 | 0 | 5.3s | 73 passed files, 1 failed file (W2 SVG url safety defect) |
| CMD-15 | blocked | backend | `npm run test:e2e -- test/voice/integration/canvas-multimodal.native.e2e-spec.ts` | `8f4f8f0` | - | - | - | - | - | - | Blocked: operator DB authorization absent |
| CMD-16 | blocked | - | Real browser audio/timing runs | `8f4f8f0` | - | - | - | - | - | - | Blocked: browser execution unauthorized |
| CMD-17 | blocked | - | Live provider spend checks | `8f4f8f0` | - | - | - | - | - | - | Blocked: provider spend unauthorized |
| CMD-18 | executed | backend | `npm test -- test/voice/agent/speech-prose.spec.ts` | `49559bf` | 0 | 14 | 14 | 0 | 0 | 0.48s | W1 correction focused unit suite |
| CMD-19 | executed | backend | `npm test -- test/voice/integration/canvas-multimodal.spec.ts` | `49559bf` | 0 | 33 | 33 | 0 | 0 | 7.8s | W1 defect rerun; X-Y Point Plot tests pass |
| CMD-20 | executed | frontend | `npm test -- src/features/canvas/canvas.test.ts` | `83ce037` | 0 | 19 | 19 | 0 | 0 | - | W2 correction focused Canvas suite |
| CMD-21 | executed | frontend | `npm test -- src/features/voice/integration-tests/canvas-multimodal.test.ts` | `83ce037` | 0 | 15 | 15 | 0 | 0 | 0.98s | W2 defect rerun; SVG safety test passes |
| CMD-22 | executed | backend | `PSExecutionPolicyPreference=Bypass; npm test` | `83ce037` | 1 | 2491 | 2458 | 23 | 10 | 81.9s | 2 failed files: 22 pre-existing performance-target failures + 1 full-run assembly flake; guard suites pass with policy override |
| CMD-23 | executed | backend | `PSExecutionPolicyPreference=Bypass; npm test -- test/operations/local-guard.spec.ts test/persistence/local-open.spec.ts test/assembly/calendar-simplification.built.spec.ts` | `83ce037` | 0 | 7 | 7 | 0 | 0 | 5.2s | Guard/local-open/assembly pass standalone |
| CMD-24 | executed | backend | `npm run build` | `83ce037` | 0 | - | - | - | - | 5.2s | Nest build complete |
| CMD-25 | executed | backend | `npm run lint` | `83ce037` | 0 | 592 | - | 0 err | 546 warn | 2.2s | oxlint clean (0 errors) |
| CMD-26 | executed | frontend | `npm run build` | `83ce037` | 0 | - | - | - | - | 3.5s | Vite build clean |
| CMD-27 | executed | frontend | `npm run lint` | `83ce037` | 0 | 163 | - | 0 err | 73 warn | 0.1s | oxlint clean (0 errors) |
| CMD-28 | executed | frontend | `npm test` | `83ce037` | 0 | 577 | 577 | 0 | 0 | 5.0s | 74/74 files passed |
| CMD-29 | executed | backend | `npm test` without policy override | `83ce037` | 1 | 2491 | 2452 | 29 | 10 | 86.1s | 6 additional guard/local-open failures caused by unsigned `.ps1` execution policy; environment limitation, not code regression |

## Integrated functional evidence
- **Post-correction rerun:** backend `canvas-multimodal.spec.ts` **33/33 passed**; frontend `canvas-multimodal.test.ts` **15/15 passed**; focused Canvas suite **19/19 passed**. Both defects recorded below are resolved.
- **Filter boundaries and adversarial cuts**: `backend/test/voice/integration/canvas-multimodal.spec.ts`
  - Validated boundary cuts across all corpus types (Flowchart, Sequence Diagram, Bar Chart, Line Graph, Pie Chart, X-Y Point Plot, SVG Visual) and framing variants (`ticks`, `tildes`, `tag`).
  - Tested chunk partition sizes [1], [split chars], [1, 2, 5, 13-char chunks], and every single 2-cut prefix/suffix position.
  - Partial fences (`\`\`\`mermaid\nflowchart TD\nA -->`), malformed JSON in chart fences, incomplete tags, and oversized source (>8192 chars or >16384 bytes) dropped cleanly while preserving preceding speech.
  - Hidden reasoning tags (`<think>...</think>`) completely silenced without emitting artifacts.
  - Ordinal gaps preserved: candidate 0 discarded, candidate 1 accepted with `ordinal: 1`. Fourth candidate dropped cleanly per 3-artifact cap.
  - Delimiter adversaries: code-unit cuts across openers/headers, 4-backtick opener with 3-backtick close, mismatched fence characters, JSON strings containing fences, CRLF and Unicode split surrogates, 513-char and 1025-byte header rejections, raw JSON and unsupported JavaScript (safe prose spoken, unsupported code silenced, supported candidate latches silence). Bounded raw-answer overflow throws `AppError` rather than allocating unbounded memory.
- **Real offline pipeline**: `canvasPipeline()` in `backend/test/voice/integration/canvas-multimodal-fixture.ts`
  - Reconstructs real `DurableChatRuntime`, `AgentVoiceAdapter`, `VoiceConnection`, `VoiceClient`, and `LiveVoiceController`.
  - Proves `artifact-committed` (journal CAS) precedes `artifact-sent` on server WebSocket.
  - Proves `canvas.artifact` emitted before provider EOF without triggering pre-audio events.
  - TTS speaks only clean prose (`SPEECH`); post-visual `TRAILING` text is never synthesized.
  - Final assistant message has `content === SPEECH` and `canvasArtifacts` matching journal.
  - Wire control parser validates 131072-byte ceiling, rejects client-to-server and dictation direction misuse.
- **Interruption and fault matrix**:
  - `interrupt before visual keeps only confirmed complete source`: 0 artifacts retained, clean assistant recovery.
  - `interrupt during visual keeps only confirmed complete source`: 0 artifacts retained, partial candidate rejected.
  - `interrupt after visual keeps only confirmed complete source`: 1 confirmed artifact retained, survives barge-in and double session reconciliation.
  - `interrupt during artifact CAS keeps confirmed evidence but emits no late visual`: microphone audio flows uninterrupted to STT while CAS gate waits; release publishes exactly one assistant artifact and zero late WebSocket events.
  - `journal CAS rejection emits zero artifact events and leaves terminal evidence`: rejected CAS results in 0 client artifacts and uncorrupted journal.
  - `server send failure after confirmed CAS preserves source in assistant without re-inference`: network failure on socket does not trigger re-inference; reconciliation restores assistant with confirmed artifact.
  - `sealed result publication failure recovers deterministic assistant without re-inference`: assistant append failure leaves sealed graph state with artifact intact; restart and reconciliation restores assistant without duplicate fetch or speak.
  - `second crash location gating memory.put recovers confirmed artifact`: manifest failure recovered deterministically.
  - `follow-up retains visual data once without labeling unknown speech as heard`: subsequent text turn receives `Retained Canvas artifacts (...)` message labeled `role: assistant` with explanation that visual data is data, not authority, without injecting unconfirmed speech into history.
- **Frontend event isolation, dismissal, and local stop**: `frontend/src/features/voice/integration-tests/canvas-multimodal.test.ts`
  - Pre-audio visuals retained once; stale/cancelled/retired turns fenced.
  - Conversation isolation verified: `conversation.bound` binds session; navigation exit resets state and clears artifacts.
  - Dismissal/tab controls: closing canvas or tab retains artifact in snapshot; reopening selects proper tab; media capture/playback/socket instances remain stable without restart.
  - Local stop-before-network: stopping speaking immediately calls `source.stop()` on playing audio node prior to WebSocket interrupt dispatch; visual artifact is retained.
  - Accessible markup: `LiveVoicePanel` renders `aria-label="Stop speaking"`, `aria-label="Close Canvas (1)"`, `aria-expanded="true"`, `aria-controls="aurvin-canvas-panel"`. Exiting `CanvasPanel` applies `inert=""` and `aria-hidden="true"`. Keyboard shortcut Alt+C toggles canvas and respects composing/focus boundaries.
- **Renderer safety parity and post-call grouping**:
  - All 7 visual corpus types render to SVG through `CanvasPanel` and underlying renderers, including labeled X-Y Point Plot coordinates after the W1 correction.
  - Malicious script tags, foreignObjects, event handlers (`onload`), and javascript/data URIs stripped.
  - External paint-server URLs in `fill`/`stroke` are stripped; only safe local `url(#fragment)` references and normal colors remain after the W2 correction.
  - Archive reload replaces provisional ownership by stable identity without duplicate cards.
  - Post-call message grouping preserves single inline card with transcript modal access.

## Native durability evidence
- Authorization status: blocked (neither `AURVIN_TEST_MONGODB_URI` nor operator authorization is supplied).
- Discovery: confirmed via Vitest config (`3` test cases discovered in `canvas-multimodal.native.e2e-spec.ts`).
- Execution: skipped cleanly in offline environment (`3 skipped`, 0 failures).
- Limitations: native test execution does not certify Azure Cosmos DB or multi-process topologies.

## Timing definitions and measurements
- Clocks:
  - `virtual-proxy`: `Date.now() - origin` with 10 ms stepped fake timers and `FakeContext.currentTime`.
  - `browser-audible`: blocked / unverified (requires authorized physical microphone, loopback audio capture, and browser runtime).
- Measured timing table:

| Run | Scenario/environment | Status | Turn start | First audible/proxy | Complete artifact | First paint/proxy | Audible reference/proxy | Underruns/ms | Interrupt start/end/ms | Five-second gate | Render-before-reference | Gap gate | Local <250 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `oracle` (virtual-proxy) | executed | 0 | 300 ms | 900 ms | 900 ms | 1200 ms | 0 / 0 ms | 1300 / 1301 ms | pass (900 <= 5000) | pass (900 < 1200) | pass (0 ms) | pass (1 ms) |
| 2 | `control-900` (virtual-proxy) | executed | 0 | 300 ms | null | null | 1200 ms | 0 / 0 ms | null / null | unverified | unverified | pass (0 ms) | unverified |
| 3 | `visual-900` (virtual-proxy) | executed | 0 | 300 ms | 900 ms | 900 ms | 1200 ms | 0 / 0 ms | null / null | pass (900 <= 5000) | pass (900 < 1200) | pass (0 ms) | unverified |
| 4 | `control-6200` (virtual-proxy) | executed | 0 | 300 ms | null | null | 1200 ms | 0 / 0 ms | null / null | unverified | unverified | pass (0 ms) | unverified |
| 5 | `visual-6200` (virtual-proxy) | executed | 0 | 300 ms | 6200 ms | 6200 ms | 1200 ms | 0 / 0 ms | null / null | fail (6200 > 5000) | fail (6200 > 1200) | pass (0 ms; wait: 4700 ms) | unverified |
| 6 | `underrun-stalled-packet` (virtual-proxy) | executed | 0 | - | - | - | - | 1 / >=400 ms | - | - | - | fail (detector detected stall) | - |
| 7 | Real browser audible timing | blocked | - | - | - | - | - | - | - | blocked | blocked | blocked | blocked |
| 8 | Paid provider timing checks | blocked | - | - | - | - | - | - | - | blocked | blocked | blocked | blocked |

- Detector observations:
  - `slow generation timing at 900ms`: visual rendered at 900 ms, strictly before 1200 ms walkthrough reference onset. Zero speech underruns.
  - `slow generation timing at 6200ms`: detects deadline miss (>5000 ms) and reference order violation (6200 ms > 1200 ms). Exposes `waitingVisualSilenceMs = 4700 ms` where speech ended but visual remained pending.
  - `underrun detector`: accurately observes >=400 ms mid-speech arrival stall.
  - Real browser painting and physical audible output remain **blocked and unverified**.

## Browser UI/accessibility/media evidence
- Node SSR markup and accessibility:
  - Verified `LiveVoicePanel` toggle renders `aria-label="Close Canvas (1)"` (when open) and `aria-label="Open Canvas (1)"` (when paused/closed).
  - Verified `aria-expanded="true"` and `aria-controls="aurvin-canvas-panel"`.
  - Verified `CanvasPanel` applies `inert=""` and `aria-hidden="true"` during exit transition.
  - Verified `CANVAS_TRANSITION_MS = 320` ms (within 300–350 ms target).
  - Verified `prefersReducedCanvasMotion` detection and focus restoration to live toggle.
  - Verified Alt+C shortcut integration.
- Real browser layout/motion/media checks: blocked / unauthorized (requires manual browser interaction, viewport resizing, and device media testing).

## Acceptance mapping
| AC | Named tests/measurements | Result | Missing evidence / decision |
| --- | --- | --- | --- |
| AC-1 | Boundary cuts, pipeline speech separation, timing traces | Partially Evidenced | Offline speech/visual separation proven, including labeled X-Y Point Plot after correction; real physical audible continuity unverified (live audio unauthorized). |
| AC-2 | Right-slide transition, SSR inert/markup, five-second target | Partially Evidenced | SSR markup and transition duration constants verified; real browser paint and physical 300–350 ms animation unverified. |
| AC-3 | Synthetic audio trace and slow detector | Partially Evidenced | Detector sensitivity verified on virtual clocks; real provider/browser common clock timing unverified. |
| AC-4 | Panel/tab exit, selection, media instance continuity | Partially Evidenced | Tab close/open state and audio/socket instance continuity verified; physical browser viewport layout unverified. |
| AC-5 | Toggle/reopen/count, sticky dismissal, replay isolation | Partially Evidenced | Controller state, sticky dismissal, and shortcut verified; physical browser keyboard/resize access unverified. |
| AC-6 | Interruption before/during/after, CAS gate, local stop | Partially Evidenced | Deterministic stop-before-network and CAS resilience verified; physical acoustic cutoff <250 ms unverified. |
| AC-7 | Journal/checkpoint/reload, follow-up context separation | Partially Evidenced | In-memory checkpoint and follow-up context separation verified; native DB execution blocked; browser reload unverified. |
| AC-8 | Mermaid/chart/SVG corpus, renderer safety parity | Partially Evidenced | 7 corpus types verified through CanvasPanel; external SVG paint URLs stripped and labeled coordinates captured; real browser rendering unverified. |

## Baseline limitations, new defects, and owner corrections
### Pre-existing baseline limitations
- `backend/test/performance/durable-latency.spec.ts`: 17 failures standalone, 22 in full run under load (historical baseline limitation at `4c9ada7`).
- `backend/test/assembly/calendar-simplification.built.spec.ts`: passes standalone (2459 ms), intermittently flakes under full parallel suite load.
- Loopback TCP port binding in sandbox: backend HTTP e2e specs fail with `connect EACCES 127.0.0.1:<port>` due to Windows low-integrity sandbox policy.

### Discovered defects and owner corrections (resolved)
1. **W1 defect — labeled chart coordinates** (`backend/src/voice/agent/speech-prose.ts`):
   - **Root cause**: `classifyVisual()` line-oriented recognition only matched bare coordinate tuples and single key-number pairs, so labeled coordinates (`Dog: (8, 9)`) left `hasData = false` and the X-Y Point Plot block was dropped.
   - **Correction** (`49559bf`): added the frontend-compatible labeled-coordinate pattern while preserving bare coordinates, key-number rows, fences/tags, bounds, and post-visual silence.
   - **Evidence**: `speech-prose.spec.ts` **14/14 passed**; `canvas-multimodal.spec.ts` **33/33 passed**, including both previously failing X-Y Point Plot tests.
   - **Owner**: W1.

2. **W2 defect — external SVG paint URLs** (`frontend/src/features/canvas/renderers/svg-renderer.tsx`):
   - **Root cause**: `parseSafeAttributes()` allowed external `url(...)` values in `fill`/`stroke`, creating a tracker/leak path from untrusted SVG artifacts.
   - **Correction** (`83ce037`): paint values are sanitized; only safe local fragment references such as `url(#localGradient)` and normal colors pass, while external, protocol-relative, `data:`, `javascript:`, and `vbscript:` URLs are stripped.
   - **Evidence**: focused Canvas suite **19/19 passed**; `canvas-multimodal.test.ts` **15/15 passed**; full frontend suite **577/577 passed**.
   - **Owner**: W2.

## Final handoff and acceptance decision
- **P3 Owned Files**:
  - `frontend/src/features/voice/integration-tests/canvas-multimodal-fixtures.ts`
  - `frontend/src/features/voice/integration-tests/canvas-multimodal.test.ts`
  - `backend/test/voice/integration/canvas-multimodal-fixture.ts`
  - `backend/test/voice/integration/canvas-multimodal.spec.ts`
  - `backend/test/voice/integration/canvas-multimodal.native.e2e-spec.ts`
  - `docs/voice-canvas-multimodal/verification.md`
- **Acceptance Status**: Offline integrated evidence passes; **full acceptance is blocked** until:
  1. Operator authorizes and supplies isolated replica-set MongoDB prerequisites for native durability verification.
  2. Operator authorizes physical browser layout, media, focus, animation, and audible timing verification.
  3. Operator authorizes bounded-cost live provider timing checks.
- **Baseline limitations retained**: the pre-existing performance-target suite and full-run assembly flake are not P3 acceptance evidence; backend HTTP e2e remains blocked by sandbox loopback `EACCES`.
- **Workflow State**: P3 verification and both owner corrections are complete. Final synthesis is recorded in `final_report.md`; full acceptance remains pending external authorization.
