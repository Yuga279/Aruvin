# P3: Integrated Verification and Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the assembled voice-calendar Canvas experience, single-write authority, continuity, and preserved voice/text critical paths with deterministic fixtures, then record the actual evidence and completion decision.

**Architecture:** Extend existing offline integration seams rather than building another calendar runtime or test framework. Exercise real CalendarLoop, proposal authority, persistence projections, AgentVoiceAdapter, LiveFlow, HTTP publication, frontend protocol/controller/reducer, and Canvas rendering, with scripted model/Google/STT/TTS/LiveKit dependencies. P1/P2 retain implementation ownership; P3 adds dedicated integration checks and evidence, returning test-discovered source defects to their owners.

**Tech Stack:** TypeScript/NodeNext, NestJS/Express, LangGraph, existing BSON MongoDB doubles and DependencyProbe, Vitest 4, Supertest, offline LiveKit peers, dictation WebSocket, React 19 static-render assertions, Markdown evidence.

---

## 1. Execution contract

- **Do not start implementation until both P1 and P2 workers are complete, meaning committed implementation plus meaningful checks and an interface handoff.** A committed P2 plan is not this gate. P1 implementation is `f9ca285` through `d8ee6a4`, inclusive; record the exact P2 commits when supplied.
- Load the available `executing-plans` and `test-driven-development` skills when executing; use `systematic-debugging` for a discovered failure. These harness skill IDs are the equivalents of the header's upstream `superpowers:` names. Do not dispatch another planner, reviewer, or review-triggered fixer.
- **Unified review: skipped, never passed.** Integration verification, defect correction, and final verification are still required. The orchestrator, not this worker, updates DAG/status and authorizes final completion.
- Change only the files in the ownership map below. P1 owns backend source/unit tests; P2 owns frontend source/unit tests. Send failures to the owning worker with the exact command, assertion, expected/actual evidence, and tested SHA. Do not patch source under the guise of fixing a fixture.
- Ponytail discipline: reuse `calendarFixture`, `calendarMemory`, `integratedFixture`, `matrixFixture`, `httpHarness`, and the existing probe; no new dependency, generalized scenario engine, duplicate authorization state machine, source-only tests, or arbitrary sleeps. Every negative test must also show the operation/control was actually processed or explicitly rejected.
- All new code files begin with the repository's FILE/LOCATION/PURPOSE/ROLE IN PROJECT/KEY COMPONENTS header. Preserve/update an existing header when editing; add one before changing more than 30% of an unheaded file. Backend imports of local TypeScript use `.js`; frontend follows existing `.ts`/`.tsx` imports. Do not add comments to strict JSON/generated files.
- Tests are offline. A Supertest loopback listener and deterministic SDK doubles are allowed; no real Google/OpenRouter/LiveKit/STT/TTS endpoints, application DB access, calendar mutations, credential changes, infrastructure, or paid checks. Do not print environment values that might be credentials.
- Preserve unrelated work, including the auth/Vite modifications and `.openchamber/`. Stage explicit task paths only. Serialize staging/commits through the orchestrator if another worker is active; check `git diff --cached --name-only` before each commit. No `git add .`, reset, checkout-overwrite, or broad delete.
- Each checkbox below is one short action (approximately 2–5 minutes); scenario rows are separate small tests, not one large test. Add the assertion, run it, make only the required fixture adjustment, rerun, commit. As P1/P2 already implement behavior, an initially passing integration test is valid: record it honestly, then demonstrate its failure sensitivity through the specified fixture injection. Never invent a red test result.

## 2. Verified interfaces and boundaries

Use the implemented P1 handoff, not the research's proposed alternate wire format:

1. `backend/src/contracts/calendar-view.ts` exports `CalendarView`, `CalendarProposalView`, `calendarViewSchema`, and `CALENDAR_VIEW_MAX_BYTES = 14336`. The strict union is `agenda | proposal | outcome | notice`.
2. Agenda has at most 20 entries, `requested` range/zone **or null** for a get-event result, date-only all-day start and **exclusive** end, `detailsTrimmed`, `entriesOmitted`, bounded label/link expiry, `truncated`, and opaque `nextPageToken`. Do not invent attendees or fetch fields for decoration.
3. Live: `{ type: 'calendar.frame', turnId, attemptId, responseId, event }`, with outer voice session/epoch/event ID/sequence. `event` is progress, v2 operation, clarification, or view. `calendar-view` is protocol 3 inside the runtime, not an independent voice session or HTTP endpoint.
4. Text lookup/outcome views ride **`completed.calendarView`**. Text clarification carries `view` containing the canonical action/target. There is deliberately **no extra text `calendar-view` frame/drain** before model continuation. The ordinary terminal SSE delivery still obeys existing backpressure; do not demand removal of that durability/transport boundary.
5. Live button: `{ type: 'calendar.confirm', proposalId, proposalRevision, answer: { kind: 'accept' } | { kind: 'reject' } | { kind: 'select', calendarId } }`. It produces a synthetic live turn with a revision-bound `calendarReplyTo`; speech and buttons share proposal CAS and `CalendarOperationWriter`. There is no direct execute endpoint or text HTTP submit while live holds the reservation.
6. Optional `calendarView` is saved with the existing assistant message in text/live modes. History is a snapshot, **never authorization**. Do not relax the separate voice-only `canvasArtifacts` rules.
7. `executing` means validated real calendar work, not schema activation/repair. A proposal has `intentId`; operation/outcome carries proposal/intent linkage so confirmation does not create a second workspace.
8. Public live transport is **LiveKit only**. WebSocket is dictation; it must reject live calendar frames/controls. An internal historical WS sink unit fixture is not an admitted live transport.
9. `calendarFixture` exports `ready`, `modelWires`, `modelBodies`, `effects`, `requestKinds`, `fetcher`, `clock/advance`, `currentProposal(sessionId)`, `operationFor(ids)`, `setDiscovery`, `setAvailability`, `setRole`, `failOnce`, and `failOperationEvent`. `effects` records successful tool invocations; count raw attempted POSTs separately for unknown/failed-write tests.

### P2 interface reconciliation gate

P2 was not implemented when this plan was written. Its concurrently available `plan2.md` draft specifies `LiveVoiceState.calendarWorkspaces`, `confirmCalendar(proposalId, revision, answer): boolean`, `LiveVoiceBindings.getActiveConversationId`, and `calendar-workspace.ts` projection/merge helpers. These are planning inputs, not implementation evidence. Before writing frontend integration code, inspect the committed worker handoff and these exact files: `frontend/src/api/calendar-protocol.ts`, `frontend/src/api/voice-protocol.ts`, `frontend/src/features/voice/state/live-voice-controller.ts`, `frontend/src/features/voice/state/live-voice-reducer.ts`, `frontend/src/features/canvas/calendar-workspace.ts`, `frontend/src/features/canvas/canvas-artifacts.ts`, `frontend/src/features/canvas/CanvasPanel.tsx`, and `frontend/src/features/chat/ChatView.tsx`.

Record the actual calendar slice shape, `confirmCalendar` signature, conversation-binding callback, workspace identity/alias rules, and Canvas props in `verification.md`. The code below deliberately uses stable wire shapes and existing collection/SSR seams; bind controller/interactive cases to P2's **actual** public methods. If behavior lives solely in a React effect, test that effect in the fixture-backed browser, not by reimplementing it in a test helper. Do not introduce speculative APIs such as `controller.closeCanvas()`, use optional chaining to skip missing methods, or cast a missing surface through `any`. An incompatible/missing handoff blocks that test and goes back to P2.

## 3. File ownership map

| Action | Exact path | Responsibility |
| --- | --- | --- |
| Modify | `backend/test/voice/integration/integrated-fixture.ts` | Optional offline Calendar runtime injection, current test principal/admission wiring, per-response speech/watermark waits, returning the existing media peer for reconnect assertions. Preserve no-argument native behavior. |
| Create | `backend/test/voice/integration/calendar-voice.spec.ts` | Real transport/authority lookup, confirmation, race, lifecycle, history, mode, and dictation-isolation scenarios; small local setup/data helpers only. |
| Create | `backend/test/http/calendar-publication-stream.spec.ts` | Real Calendar runtime → HTTP transport → saved visible-message equality; completion backpressure/failure checks. |
| Create | `backend/test/performance/calendar-voice-latency.spec.ts` | Frozen P1 confirmation comparison plus matched lookup/sink-ablation measurements and real runtime non-blocking assertions. |
| Create | `frontend/src/features/voice/integration-tests/calendar-canvas.test.ts` | Real client/controller + chat/artifact/Canvas seams, controls, history and protocol isolation; Node/SSR limitations explicit. |
| Create | `docs/voice-calendar-canvas/verification.md` | Reproducible command/results ledger, AC mapping, baseline provenance, measurements, browser evidence, defects, skips/limitations. |
| Create | `docs/voice-calendar-canvas/final_report.md` | Actual outcomes, commits, remaining blockers, skipped review, and completion recommendation to orchestrator. |

Read-only reuse: `backend/test/performance/calendar-critical-path.spec.ts`, `backend/test/performance/dependency-probe.ts`, `backend/test/performance/latency-runtime-fixture.ts`, `backend/test/runtime/calendar-live.fixture.ts`, `backend/test/runtime/calendar-runtime.fixture.ts`, `backend/test/persistence/calendar-multi-memory.ts`, `backend/test/contracts/calendar-view.fixture.ts`, `backend/test/voice/transport/gateway.integration.spec.ts`, `frontend/src/features/voice/integration-tests/matrix-fixture.ts`, and P1/P2 source/unit tests. Keep the established critical-path spec unchanged so the reference workload cannot drift silently. Request an explicit ownership change before editing any additional file.

## 4. P1 deterministic reference measurements

Reference source: P1's pre-edit run of `npm test -- test/performance/calendar-critical-path.spec.ts`; the earlier recorded P3 draft (`48c18c0`) preserves the handoff numbers below. Pre-feature source is `622c0a7ac217d2b60847e933015d3bb88bad1917` (`f9ca285^`). Confirm the raw P1 transcript/source SHA with the orchestrator before labelling these **observed** baseline evidence; until then label them **P1-reported reference**, not measurements performed by P3.

Parameters: `new DependencyProbe()` (wave mode), `readMs: 67`, `writeMs: 449`, `path: 'calendar'`, durable path, existing confirmation workload. Setup/earlier turns/proposal publication occur outside `measure`; the measured region is **submit confirmation + execute confirmation**.

| Earlier turns | Explicit reply reference | Wire reads | Wire writes | Waves | Modeled elapsed ms | First succeeded receipt ms |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | no | 158 | 45 | 199 | 30523 | 21108 |
| 0 | yes | 155 | 45 | 196 | 30322 | 20907 |
| 8 | no | 182 | 45 | 223 | 32131 | 22716 |
| 8 | yes | 171 | 45 | 212 | 31394 | 21979 |

These numbers are **wire** counts, not an invented combined logical/wire count. Capture logical reads/writes separately in P3. For this workload the total model requests are `earlierTurns + 2` (activation + proposed create, no model call for deterministic confirmation); the lookup workload uses **3** model requests (activation, read, narration), not one. Do not impose a universal one-model-call budget or forbid pre-existing availability/capability requests.

Acceptance: same scripted operations and request-kind sequence; no added display-only model/Google request; unchanged write count; no increased reads/waves/modeled elapsed/receipt time without a documented, resolved explanation. No blanket `reads <= 165`, timing slack, or baseline rebasing to hide regressions. Improvements are allowed but explain their provenance. If a historical baseline is not reproducible, explicitly leave the historical comparison inconclusive; sink-ablation is useful additional evidence, not a replacement historical baseline.

---

### Task 1: Open the evidence ledger and confirm prerequisites

**Files:** Create `docs/voice-calendar-canvas/verification.md`; read `AGENTS.md`, `docs/voice-calendar-canvas/goal.md`, `docs/voice-calendar-canvas/state.md`, both package manifests, and P1/P2 handoffs.

- [ ] **Step 1: Confirm both worker prerequisites and capture the checkout.** From repository root run each command separately:

```bash
git status --short
git rev-parse HEAD
git log --oneline f9ca285^..d8ee6a4
node --version
npm --version
```

Expected: exact source SHAs and supported Node (`^22.22.3 || ^24.15.0 || >=26.0.0`); unrelated files left untouched. Do not echo secret environment values. Capture OS/architecture with `node -p "process.platform + ' ' + process.arch"`.

- [ ] **Step 2: Write the evidence document's headings and initial truth state.** Use this content, adding captured facts rather than speculative results:

```markdown
# Voice Calendar Canvas — Integrated Verification

## Scope and tested commits
P3 verifies the approved goal. P1/P2 source ownership is unchanged.
Unified review: **skipped**, per user instruction.
Execution status: **in progress**; no completion claim follows from this ledger's existence.

## Environment and prerequisites
## Command ledger
## Acceptance evidence (AC1–AC9)
## Deterministic historical comparison
## Matched sink-ablation and non-blocking evidence
## Browser interaction evidence
## Test-discovered defects and owning-worker rechecks
## Skips, baseline failures, and limitations
## Completion gate
```

- [ ] **Step 3: Establish the current focused baseline**, separately in each package, before adding tests:

Backend: `npm test -- test/performance/calendar-critical-path.spec.ts test/runtime/calendar-durable-voice.spec.ts test/runtime/calendar-memory-voice.spec.ts test/runtime/calendar-voice-authority.spec.ts test/http/calendar-stream.spec.ts test/voice/agent/submission.spec.ts`.

Frontend: `npm test -- src/features/voice/integration-tests/canvas-multimodal.test.ts src/features/canvas/calendar-canvas.test.ts src/features/chat/ChatView.voice.test.ts`.

Expected: actual nonzero discovery and P1/P2 coverage; record exact pass/fail/skip counts, duration and exit codes. A baseline failure is not repaired by weakening tests. Do not run `npm ci` unless the relevant package dependencies are missing; if needed run it in that package and record it.

- [ ] **Step 4: Record baseline provenance and P2 bindings.** Put the four P1-reported rows above beside the current `CONFIRM_REFERENCE_MEASUREMENT` output; record source SHA, wave parameters, measurement boundaries, and whether the raw pre-edit log is available. List P2's actual method/slice/prop names, not research guesses. Mark native/browser checks not yet run.

- [ ] **Step 5: Commit only the evidence ledger.**

```bash
git add docs/voice-calendar-canvas/verification.md
git commit -m "docs(voice-calendar-canvas): initialize integrated verification evidence"
```

### Task 2: Extend the existing transport fixture without copying its stack

**Files:** Modify `backend/test/voice/integration/integrated-fixture.ts`; create the first smoke case in `backend/test/voice/integration/calendar-voice.spec.ts`.

- [ ] **Step 1: Add the smoke test before the fixture extension.** Begin the new spec with this header and imports:

```typescript
/**
 * ============================================================================
 * FILE: calendar-voice.spec.ts
 * LOCATION: backend/test/voice/integration/calendar-voice.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify offline voice Calendar authority across the admitted transport.
 * ROLE IN PROJECT:
 *    Connects real session, Calendar runtime, speech and archive boundaries.
 *    Uses deterministic provider doubles, never live calendar data.
 * KEY COMPONENTS:
 *    - Transport scenarios: Lookup, shared proposal confirmation and lifecycle.
 *    - Continuity: Saved views, mode switches and dictation exclusion.
 * ============================================================================
 */
import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { integratedFixture } from './integrated-fixture.js';
import { calendarFixture, loadWire, skillWire, textWire, createWire }
  from '../../runtime/calendar-runtime.fixture.js';
import { event } from '../../runtime/calendar-multi-fixture.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('opens an offline live Calendar session without native DB prerequisites', async () => {
  expect(integratedFixture.length).toBe(1); // fails before calling the old native-only factory
  const calendar = calendarFixture();
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-smoke-0001');
    expect(peer.events().some(e => e.type === 'session.ready')).toBe(true);
    expect(calendar.modelBodies).toHaveLength(0);
    expect(calendar.effects).toHaveLength(0);
    await f.end(peer);
  } finally { await f.close(); }
});
```

- [ ] **Step 2: Run** `npm test -- test/voice/integration/calendar-voice.spec.ts -t "opens an offline"` in `backend/`. Expected before extension: the injection is not supported and/or native dependency setup is reached. Capture the real failure; this routine suite must never be skipped behind `nativeConfigured`.

- [ ] **Step 3: Add optional Calendar injection at `integratedFixture`'s existing setup.** Add imports for `CalendarRuntimeFixture`, `loadConfig`, `RequestIdentityStore`, `principal`, `AuthenticatedWsAdapter`, and `VoiceUpgradeAdmission` from their existing exact paths. Replace the initial harness/config declarations with:

```typescript
export async function integratedFixture(calendar?: CalendarRuntimeFixture) {
  await calendar?.ready;
  const h = calendar ? {
    get runtime() { return calendar.runtime; },
    persistence: calendar.p,
    identity: calendar.identity,
    fetcher: calendar.fetcher,
    deps: { config: loadConfig({ AURVIN_USER_ID: calendar.identity.userId }) },
    close: () => calendar.dispose(),
  } : await voiceRuntimeHarness(chunk('Hello world. ') + chunk('', 'stop') + usage + done);
  const o = options();
  const identities = new RequestIdentityStore();
  const admitted = principal(h.identity.userId);
  const identityResolver = new ServerIdentityResolver(identities);
  const configSnapshot = calendar ? {
    ...liveConfigSnapshot(),
    calendar: calendar.currentConfig.current()!.calendar,
    modelLimits: calendar.currentConfig.current()!.modelLimits,
  } : liveConfigSnapshot();
  calendar?.publish(configSnapshot);
```

Keep existing session/reservation/media/flow creation immediately after this block; remove only its now-duplicate `configSnapshot` declaration. The calendar fixture, not `calendarLiveFixture`, is injected: it has **not** pre-acquired a second live reservation. One service owns the reservation and one fixture owns cleanup. If app construction fails, dispose the supplied calendar in the existing catch path.

- [ ] **Step 4: Bring only this fixture's principal/admission wiring up to the current API.** Existing no-argument code still constructs `ServerIdentityResolver` with config and omits required request-principal providers. Reuse `backend/test/voice/transport/gateway.integration.spec.ts:48–67`, not a production auth bypass. Add:

```typescript
const admission = new VoiceUpgradeAdmission(
  { authenticate: async () => ({ principal: admitted }) },
  { frontendOrigin: origin, secureCookie: false, developmentLoopback: true,
    trustedHttpsIngress: () => false },
);
```

Pass `principal: () => identities.principal()` and, for injected Calendar, `currentConfig: calendar.currentConfig` into `ChatHttpModule.register`. Add these providers alongside the existing voice providers:

```typescript
{ provide: RequestIdentityStore, useValue: identities },
{ provide: VoiceUpgradeAdmission, useValue: admission },
```

Before listen, set the fixture-only request context and adapter:

```typescript
app.use((_req: object, _res: unknown, next: () => void) => identities.run(admitted, next));
app.useWebSocketAdapter(new AuthenticatedWsAdapter(app, admission));
```

Remove the unused `WsAdapter` import. This fixture uses a fixed admitted test principal, not WorkOS, and does **not** claim to test real authentication. Origin, voice owner, proposal and identity checks in the actual application services remain real.

- [ ] **Step 5: Make response synchronization turn-local.** Replace the existing `startReply` wait with a separate `awaitReply` helper, then return it with `media` from the fixture:

```typescript
const awaitReply = async (peer: LivePeer, previousSpeakCount: number): Promise<Ref> => {
  const c = latest();
  await vi.waitFor(() => expect(vi.mocked(c.tts.connection.speak).mock.calls.length)
    .toBeGreaterThan(previousSpeakCount), { timeout: 5000 });
  const ref = c.bridge?.currentResponse();
  if (!ref) throw new Error('Expected active response for this reply');
  c.tts.events.push({ type: 'speech-started', ...ref, speechId: `speech-${ref.responseId}` });
  c.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await vi.waitFor(() => expect(peer.events().some(e => e.type === 'audio.start'
    && e.turnId === ref.turnId && e.responseId === ref.responseId)).toBe(true));
  return ref;
};
const startReply = async (peer: LivePeer, input: string,
  providerTurnId = 'provider:0'): Promise<Ref> => {
  const c = latest();
  const count = vi.mocked(c.tts.connection.speak).mock.calls.length;
  c.stt.events.push({ type: 'end-of-turn', providerTurnId, text: input });
  return awaitReply(peer, count);
};
```

In `finishReply`, emit that same `speech-${ref.responseId}`, find/wait for a **final watermark with matching turnId and responseId**, and send its playback proof. The old unconditional `findLast(final)` can falsely satisfy the second turn with the first turn's watermark. Preserve captured-output and delivery-settlement assertions. Remove the smoke's arity assertion after the injection guard has proved the red state; the retained behavioral test is the actual admitted offline session.

- [ ] **Step 6: Update the existing `text` helper minimally for injected Calendar.** Add `{ calendarProtocol: 2 }` to submissions only when the injected snapshot enables Calendar, and forward `emitCalendar` through the existing runtime execute call. Do not reuse `startReply` for a button; use `awaitReply` without injecting fake speech. No sleeps or swallowed `catch(() => {})` race results.

- [ ] **Step 7: Rerun the smoke plus transport regressions.** Backend: `npm test -- test/voice/integration/calendar-voice.spec.ts test/voice/transport/gateway.integration.spec.ts test/voice/integration/canvas-multimodal.spec.ts`. Expected: offline smoke and existing offline regressions execute/pass; report native cases skipped separately, not as exercised coverage.

- [ ] **Step 8: Commit the fixture and smoke.**

```bash
git add backend/test/voice/integration/integrated-fixture.ts backend/test/voice/integration/calendar-voice.spec.ts
git commit -m "test(voice-calendar): extend offline integrated voice fixture"
```

### Task 3: Verify lookup → transport view → saved history

**Files:** Modify `backend/test/voice/integration/calendar-voice.spec.ts`.

- [ ] **Step 1: Add the end-to-end empty-lookup test.** This checks actual transport publication and archive identity, not merely that a fabricated fixture contains a view:

```typescript
it('streams a live agenda before narration completes and reloads the same saved view', async () => {
  const calendar = calendarFixture();
  const f = await integratedFixture(calendar);
  try {
    calendar.modelWires.push(loadWire('calendar_list_events'), skillWire('call_tool', {
      plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
        timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20,
      },
    }, 'calendar-agenda-read'), textWire('No events in that range.'));
    const peer = await f.connect('live', null, 'calendar-agenda-0001');
    const ref = await f.startReply(peer, 'List my calendar for November 3.', 'agenda-speech-1');
    const frames = peer.events().filter(e => e.type === 'calendar.frame');
    const viewFrame = frames.find(e => e.event.type === 'calendar-view');
    expect(viewFrame).toMatchObject({ turnId: ref.turnId, responseId: ref.responseId,
      attemptId: expect.any(String), event: { type: 'calendar-view', view: {
        kind: 'agenda', entries: [], truncated: false, entriesOmitted: 0,
      } } });
    expect(frames.some(e => e.event.type === 'calendar-progress' && e.event.phase === 'executing')).toBe(true);
    expect(peer.events().some(e => e.type === 'audio.watermark' && e.final
      && e.responseId === ref.responseId)).toBe(false);
    await f.finishReply(peer, ref);
    const sessionId = f.latest().context.response.conversationId!;
    await f.end(peer);
    const saved = await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
    const assistant = saved.body.items.find((m: { role: string; turnId: string }) =>
      m.role === 'assistant' && m.turnId === ref.turnId);
    if (!viewFrame || viewFrame.event.type !== 'calendar-view') throw new Error('Missing agenda frame');
    expect(assistant.calendarView).toEqual(viewFrame.event.view);
    expect(assistant).toMatchObject({ mode: 'live', voiceSessionId: peer.response.sessionId });
    expect(assistant.content).toBe(''); // voice transcript remains separate
    expect(calendar.effects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(calendar.modelBodies).toHaveLength(3);
    expect(calendar.modelWires).toHaveLength(0);
    for (const body of calendar.modelBodies) expect(body.user).toBe(calendar.identity.userId);
    await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
    expect(calendar.effects.filter(e => e.kind === 'list')).toHaveLength(1); // reload is read-only
    expect(calendar.modelBodies).toHaveLength(3);
  } finally { await f.close(); }
});
```

- [ ] **Step 2: Run** `npm test -- test/voice/integration/calendar-voice.spec.ts -t "streams a live agenda"`. Expected: pass, or a concrete P1-owned defect. The fixture speech is scripted: this proves routing/no duplicate narration, **not** real-model summary quality.

- [ ] **Step 3: Add the timed/all-day/partial data cases through the existing fetcher seam.** Before `f.connect`, preserve `const base = calendar.fetcher.getMockImplementation()!` and wrap only Google `GET /calendar/v3/calendars/.../events`; delegate every other URL to `base(url, init)`. Return `googleJson(payload)` from `backend/test/plugins/google-calendar/tools-fixtures.ts`. Do not intercept OpenRouter or fabricate a `calendar.frame` in these producer tests. Use these exact payload rows, one test per row:

```typescript
const agendas = [
  { name: 'timed details', payload: { timeZone: 'Etc/UTC', items: [{ id: 'evt_timed_1',
    summary: '<script>Not executable</script>', status: 'confirmed',
    start: { dateTime: '2026-11-03T10:00:00Z' }, end: { dateTime: '2026-11-03T11:00:00Z' },
    location: 'Room 4', description: 'Plain returned details',
    htmlLink: 'https://calendar.google.com/calendar/event?eid=evt_timed_1' }] } },
  { name: 'exclusive all-day span', payload: { timeZone: 'Etc/UTC', items: [{ id: 'evt_allday_1',
    summary: 'Offsite', status: 'confirmed', start: { date: '2026-11-03' }, end: { date: '2026-11-05' } }] } },
  { name: 'more results available', payload: { timeZone: 'Etc/UTC', items: [], nextPageToken: 'opaque-next' } },
  { name: 'missing optional fields', payload: { timeZone: 'Etc/UTC', items: [{ id: 'evt_minimal_1',
    summary: '', status: 'tentative', start: { dateTime: '2026-11-03T12:00:00Z' },
    end: { dateTime: '2026-11-03T12:30:00Z' } }] } },
];
```

Repeat the three scripted wires from Step 1 for each row. Assert frame view and archived view deep-equal; entry core fields match provider projection; dates remain strings `2026-11-03`/`2026-11-05` rather than timestamp-converted; next-page presence implies `truncated: true`; optional fields are absent rather than invented. Count one list and zero creates. Assert every view parses with `calendarViewSchema` and UTF-8 bytes `<= CALENDAR_VIEW_MAX_BYTES`. A schema-only assertion is supplementary, not the main proof.

- [ ] **Step 4: Add a provider-read failure row and an unavailable-target row.** Return a bounded Google 403 JSON error for the list URL, or request `calendarId: 'missing@example.test'`. Exhaust the runtime's configured deterministic repair wires if that branch requests one; do not let `Unexpected model request` substitute for the intended failure. Assert the processed turn's notice/failure is **not** `agenda { entries: [] }`, no receipt appears, and no create POST occurs.

- [ ] **Step 5: Add one memory-first transport run**, reusing Step 1, with real persistence over the offline BSON fake. Local setup code:

```typescript
const db = calendarMemory();
const client = Object.assign(db.commandSource, {
  db: () => db.store.db, appendMetadata: () => undefined,
}) as unknown as MongoClient;
const persistence = await createPersistenceBundle(client, 'offline-calendar-canvas-integration',
  DEFAULT_BUDGETS, 'offline-calendar-canvas-executor');
const calendar = calendarFixture(undefined, persistence, {
  policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxAttempts: 1, shutdownDrainMs: 50 }, voice: true,
});
```

Import these existing exports from `mongodb`, `../../persistence/calendar-multi-memory.js`, `../../../src/persistence/persistence.js`, `../../../src/contracts/budgets.js`, and `../../../src/chat-runtime/memory-text.js`. Await archive visibility through bounded `vi.waitFor` after settlement. State clearly that a BSON double is not a native MongoDB/Azure certification. Do not use `createLatencyFixture({ path: 'calendar', memoryFirst: true })` to claim memory coverage: that fixture currently only applies that flag to its text branch.

- [ ] **Step 6: Run** `npm test -- test/voice/integration/calendar-voice.spec.ts` and record actual discovery/results. No source edit by P3 is permitted to make a producer assertion pass; route it to P1.

- [ ] **Step 7: Commit.**

```bash
git add backend/test/voice/integration/calendar-voice.spec.ts
git commit -m "test(voice-calendar): verify lookup transport and archived agenda snapshots"
```

### Task 4: Verify proposal authority, races, and truthful outcomes

**Files:** Modify `backend/test/voice/integration/calendar-voice.spec.ts`.

- [ ] **Step 1: Add the shared speech/button/duplicate confirmation test.** Reuse the same fixture per test, not one calendar fixture shared across concurrent tests (its request-kind recorder spies on a prototype). Use `it.each` without `concurrent`:

```typescript
it.each(['speech', 'button', 'duplicate-button'] as const)(
  'confirms the same proposal once using %s', async channel => {
    const calendar = calendarFixture();
    const f = await integratedFixture(calendar);
    let creates = 0;
    const fetch = calendar.fetcher.getMockImplementation()!;
    calendar.fetcher.mockImplementation((url, init) => {
      if (String(url).includes('/calendar/v3/calendars/')
        && new URL(String(url)).pathname.endsWith('/events') && init?.method === 'POST') creates++;
      return fetch(url, init);
    });
    try {
      calendar.modelWires.push(loadWire('calendar_create_event'), createWire(event()));
      const peer = await f.connect('live', null, `calendar-confirm-${channel}`);
      const first = await f.startReply(peer, 'create the event', 'proposal-speech-1');
      await f.finishReply(peer, first);
      const sessionId = f.latest().context.response.conversationId!;
      const proposal = await calendar.currentProposal(sessionId);
      expect(proposal).not.toBeNull();
      if (!proposal) throw new Error('Expected current proposal');
      expect(creates).toBe(0);
      const disclosed = peer.events().find(e => e.type === 'calendar.frame'
        && e.event.type === 'calendar-clarification');
      expect(disclosed).toMatchObject({ type: 'calendar.frame', event: {
        type: 'calendar-clarification', view: { kind: 'proposal', proposalId: proposal.proposalId,
          intentId: proposal.intentId, revision: proposal.revision, action: proposal.action,
          target: { calendarId: proposal.target!.calendarId } },
      } });
      const control = { type: 'calendar.confirm' as const, proposalId: proposal.proposalId,
        proposalRevision: proposal.revision, answer: { kind: 'accept' as const } };
      const count = vi.mocked(f.latest().tts.connection.speak).mock.calls.length;
      let reply: { turnId: string; responseId: string };
      if (channel === 'speech') reply = await f.startReply(peer, 'yes', 'confirmation-speech-1');
      else {
        peer.control(control);
        if (channel === 'duplicate-button') peer.control(control);
        reply = await f.awaitReply(peer, count);
      }
      await f.finishReply(peer, reply);
      const result = peer.events().findLast(e => e.type === 'calendar.frame'
        && e.turnId === reply.turnId && e.event.type === 'calendar-view');
      expect(result).toMatchObject({ type: 'calendar.frame', event: { type: 'calendar-view', view: {
        kind: 'outcome', proposalId: proposal.proposalId, intentId: proposal.intentId,
        state: 'succeeded', receipt: { durable: true },
      } } });
      expect(creates).toBe(1);
      expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(1);
      expect(calendar.modelBodies).toHaveLength(2);
      await f.end(peer);
      const history = await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
      expect(history.body.items.some((m: { calendarView?: { kind: string; state?: string } }) =>
        m.calendarView?.kind === 'outcome' && m.calendarView.state === 'succeeded')).toBe(true);
      expect(creates).toBe(1);
    } finally { await f.close(); }
  },
);
```

- [ ] **Step 2: Run** `npm test -- test/voice/integration/calendar-voice.spec.ts -t "confirms the same proposal"`. Expected: three cases actually execute; raw provider POST count is one, not merely one successful effect.

- [ ] **Step 3: Add the two real transport race orderings.** Start with the exact proposal setup in Step 1; snapshot TTS call count, then submit both events before awaiting either. For button-first:

```typescript
peer.control(control);
f.latest().stt.events.push({ type: 'end-of-turn', providerTurnId: 'race-speech-1', text: 'yes' });
const reply = await f.awaitReply(peer, count);
await f.finishReply(peer, reply);
expect(creates).toBe(1);
expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(1);
```

For speech-first, reverse only the first two statements. Wait until the adapter has no current response and the relevant attempt is terminal; assert proposal consumption, one durable operation/event identity and one provider POST. Verify the losing input is rejected/busy/stale or resolves as a non-writing reply according to the actual adapter contract. Capture its observed disposition rather than imposing a preferred scheduler winner or swallowing a rejected promise. Replay the original STT `providerTurnId` and duplicate button **after settlement**; wait for their processing boundary and assert no additional model/POST, not just an immediate zero count.

- [ ] **Step 4: Add each authority-negative test in this matrix.** Each row repeats the real disclosed-proposal setup from Step 1 and changes only the listed input. Use transport `session.error`/processed control or direct hook rejection as the positive completion signal; a malformed frame rejected by the parser proves a parser boundary, not proposal CAS.

| Test name | Input/action | Required observable assertion |
| --- | --- | --- |
| `rejects the old proposal revision without consuming the current proposal` | Send `proposalRevision + 1`. | Control rejected, zero POST, current proposal unchanged/pending. |
| `expires a once-disclosed proposal before a late confirmation` | `calendar.advance(600001)`, then valid control. | Runtime processes expiry; no write/success, expired notice/rejection; never wait six real minutes. |
| `cannot approve replaced details with an old proposal reference` | Speak a changed action using a new `createWire(event({ summary: 'Revised Planning' }))`; capture the new proposal, then send old control. | New proposal identity/revision survives; old control cannot authorize either action. |
| `rejects a proposal from another conversation` | Disclose in A; end A; connect B; send A's reference. | Explicit rejection; no A data/proposal authority in B; no POST. |
| `does not approve an undisclosed or ambiguous spoken yes` | No current proposal, or target-selection proposal with duplicate Work labels via `setDiscovery({ duplicateWorkNames: true })`; speak `yes`. | Ask for missing target/current authorization; zero POST. |
| `selects only a disclosed calendar candidate` | Use the target-selection proposal; send disclosed candidate ID, then an arbitrary undisclosed ID in a separate case. | Disclosed choice uses canonical action/target; undisclosed input rejected, never treated as executable instruction. |
| `rejects by voice or button without creating` | Speak `cancel` or send `{ kind: 'reject' }`. | Notice `cancelled`/proposal consumed-or-tombstoned; zero POST; no false success. |

`event(overrides)` is the existing factory in `backend/test/runtime/calendar-multi-fixture.ts`; keep exact proposal facts, not narration-parsed guesses. Confirm both memory and durable modes for at least success, stale/expiry, and race; use the existing P1 runtime suites for the full authority matrix rather than duplicating every unit case in both transport variants.

- [ ] **Step 5: Add truthful terminal-failure cases at the existing provider/store seams.** Count POST attempts separately. Test each case after both inference/transport processing and archive projection settle:

| Test name | Fixture injection | Expected authority/view |
| --- | --- | --- |
| `does not call a denied target a successful creation` | Before confirmation use `setRole(calendarId, 'reader')`. | No provider POST; no succeeded receipt; permission failure/clarification. |
| `shows a definitely failed create without a receipt` | Calendar POST returns deterministic Google 400 invalid request. | One attempted POST, `definitely-failed`, null receipt. |
| `retains an unknown write outcome without retrying it` | Calendar POST throws a network error after request dispatch. | One attempted POST, `unknown`, null receipt, reconciliation guidance; no automatic second POST. |
| `never claims success from an unacknowledged operation event` | `calendar.failOperationEvent('succeeded')` or existing receipt-save failpoint. | No succeeded projection unless matching durable operation evidence exists; no invented receipt. |
| `keeps committed success when later narration or display fails` | Existing `failOnce('result-save-v2')` after supported fully specified create. | Durable operation remains succeeded; truthful archived outcome despite failed narration; no inference/write replay. |

Do not assert `effects.length === 1` on a thrown provider call: the fixture appends success effects after `tools.invoke` returns. Use the attempted-POST ledger and actual operation record/event evidence.

- [ ] **Step 6: Add continuity/transport compatibility cases.** End live after an agenda/outcome; reload `/api/sessions/:id/messages`; start text in the same chat, then reconnect live and inspect another chat. Assert same saved view, no replay writes/model calls from history, no cross-chat frames, and old-epoch controls fail. Use `f.media.last()` and its existing offline peer helpers to inspect epoch/sequence; never invent public live WS support.

For dictation, connect the existing `DictationPeer`; inject STT final text without explicit text Send and assert no model/create/calendar frame. Send `calendar.confirm` through its control path and assert protocol rejection plus no effects. Reuse actual frontend/backend guards for `calendar.frame` dictation exclusion. A dictation final must remain draft-only.

- [ ] **Step 7: Run the dedicated suite plus retained authority regressions.** Backend: `npm test -- test/voice/integration/calendar-voice.spec.ts test/runtime/calendar-voice-authority.spec.ts test/runtime/calendar-multi-concurrency.spec.ts test/voice/transport/livekit-control.spec.ts`. Expected: offline cases run, raw attempted writes remain bounded, and no unhandled async error. Log every source defect and recheck its owner-supplied fix before continuing.

- [ ] **Step 8: Commit.**

```bash
git add backend/test/voice/integration/calendar-voice.spec.ts
git commit -m "test(voice-calendar): verify confirmation races and truthful lifecycle"
```

### Task 5: Verify real HTTP publication and terminal independence

**Files:** Create `backend/test/http/calendar-publication-stream.spec.ts`; read `backend/src/http/chat-stream.transport.ts`, `backend/src/http/sse-writer.ts`, and `backend/test/http/calendar-stream.spec.ts`.

- [ ] **Step 1: Write the real-runtime publication test**, beginning with the mandatory header. Unlike a mocked `executeTurn` that simply emits an expected view, this connects the actual producer and HTTP publication path:

```typescript
/**
 * ============================================================================
 * FILE: calendar-publication-stream.spec.ts
 * LOCATION: backend/test/http/calendar-publication-stream.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify Calendar publication through the real HTTP stream transport.
 * ROLE IN PROJECT:
 *    Connects the offline Calendar runtime, SSE sequencing and visible archive.
 *    Distinguishes existing terminal backpressure from new presentation waits.
 * KEY COMPONENTS:
 *    - Publication: Completion-carried view matches saved assistant state.
 *    - Terminal failure: Display delivery cannot replay authoritative work.
 * ============================================================================
 */
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { ChatStreamTransport } from '../../src/http/chat-stream.transport.js';
import { calendarCompatibleEnvelopeSchema } from '../../src/contracts/calendar-wire.js';
import { calendarViewSchema, CALENDAR_VIEW_MAX_BYTES } from '../../src/contracts/calendar-view.js';
import { fixtureOptions, deferred } from './fixtures.js';
import { calendarFixture, loadWire, skillWire, textWire } from '../runtime/calendar-runtime.fixture.js';
import { principal } from '../assembly/auth-principal-fixture.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function socket() {
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false, headersSent: false, writableLength: 0,
    setHeader: vi.fn(), flushHeaders() { this.headersSent = true; },
    write: vi.fn((_frame: string) => true), end() { this.writableEnded = true; },
  });
  return { req: req as Request, res: res as unknown as Response, raw: res };
}
function envelopes(writes: string[]) {
  return writes.flatMap(frame => frame.split('\n\n').filter(Boolean).map(line =>
    calendarCompatibleEnvelopeSchema.parse(JSON.parse(line.slice(6)))));
}
function publication(calendar: ReturnType<typeof calendarFixture>) {
  const base = fixtureOptions();
  return new ChatHttpService({ ...base,
    identity: { ...base.identity, resolve: () => calendar.identity },
    principal: () => principal(calendar.identity.userId),
    sessions: calendar.p.sessions, messages: calendar.p.messages,
    runtime: calendar.runtime, currentConfig: calendar.currentConfig,
    executionReservations: calendar.runtime.reservations,
  });
}
function scriptLookup(calendar: ReturnType<typeof calendarFixture>) {
  calendar.modelWires.push(loadWire('calendar_list_events'), skillWire('call_tool', {
    plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
      timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20,
    },
  }, 'http-calendar-read'), textWire('No events in that range.'));
}

it('carries the saved agenda on completion after prose without another display frame', async () => {
  const calendar = calendarFixture();
  try {
    await calendar.ready;
    scriptLookup(calendar);
    const ids = await calendar.submit('List my calendar for November 3.');
    const service = publication(calendar), s = socket();
    await new ChatStreamTransport(service).open(ids.sessionId, ids.turnId, s.req, s.res);
    const frames = envelopes(s.raw.write.mock.calls.map(([frame]) => frame));
    const completed = frames.find(f => f.event.type === 'completed');
    if (!completed || completed.event.type !== 'completed') throw new Error('Missing completion');
    const view = calendarViewSchema.parse(completed.event.calendarView);
    expect(view).toMatchObject({ kind: 'agenda', entries: [] });
    expect(Buffer.byteLength(JSON.stringify(view), 'utf8')).toBeLessThanOrEqual(CALENDAR_VIEW_MAX_BYTES);
    expect(frames.some(f => f.event.type === 'calendar-view')).toBe(false);
    const proseAt = frames.findIndex(f => f.event.type === 'delta');
    expect(proseAt).toBeGreaterThanOrEqual(0);
    expect(frames.indexOf(completed)).toBeGreaterThan(proseAt);
    expect(frames.map(f => f.sequence)).toEqual(frames.map((_, index) => index));
    const visible = await service.messages(ids.sessionId, {});
    const assistantMessageId = completed.event.assistantMessageId;
    expect(visible.items.find(m => m.messageId === assistantMessageId)?.calendarView).toEqual(view);
    expect(calendar.modelBodies).toHaveLength(3);
    expect(calendar.effects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(calendar.runtime.snapshot().active).toBe(0);
  } finally { await calendar.dispose(); }
});
```

Add a real `httpHarness`/Supertest message reload assertion by reusing Task 3's injected Nest fixture; do not claim the fake socket alone tests the full proxy/browser network stack.

- [ ] **Step 2: Run** `npm test -- test/http/calendar-publication-stream.spec.ts -t "carries the saved agenda"`. Expected: actual producer parses on protocol 3, monotonic SSE sequence, view equals archive, no extra text display frame. A strict completion guard dropping the view is a P1/P2 handoff defect, not grounds to relax validation.

- [ ] **Step 3: Add the terminal-drain barrier test.** Repeat the real lookup setup; make `write` return false **only** for `completed`, and wait on an explicit barrier:

```typescript
const reached = deferred<void>();
s.raw.write.mockImplementation(frame => {
  if (frame.includes('"type":"completed"')) { reached.resolve(); return false; }
  return true;
});
let settled = false;
const opening = transport.open(ids.sessionId, ids.turnId, s.req, s.res)
  .then(() => { settled = true; });
try {
  await reached.promise;
  expect(settled).toBe(false); // existing SSE drain is intentionally still honored
  expect(calendar.runtime.snapshot().active).toBe(0);
  expect(transport.snapshot().active).toBe(0); // reservation released before terminal network drain
  expect((await calendar.runtime.getTurnStatus(calendar.identity.userId,
    ids.sessionId, ids.turnId)).status).toBe('completed');
  expect(envelopes(s.raw.write.mock.calls.map(([frame]) => frame))
    .some(f => f.event.type === 'delta')).toBe(true);
} finally {
  s.raw.emit('drain');
  await opening;
}
```

Keep this within a normal bounded Vitest timeout; always release the barrier in `finally` so cleanup cannot hang if an assertion fails. A stalled terminal view frame must not gate earlier text/model continuation or the committed action; existing network delivery can still fail or wait. Do not misreport terminal transport cleanup as end-user render acknowledgement.

- [ ] **Step 4: Add a terminal-write error case.** Throw only when the completed frame is written; spy on `runtime.executeTurn` by wrapping its real method to record completion rather than mocking its result. Assert the attempt and saved view remain completed, earlier deltas exist, active runtime slots are released, and reload does not infer/read/write again. For create, repeat with a fully specified supported action or the proposal/confirm flow from Task 4 and assert attempted POST remains one. Do not require the failed client to receive a success frame or turn a transport error into an operation failure.

- [ ] **Step 5: Add structured-proposal publication and public live-turn exclusion.** Use real `loadWire('calendar_create_event')` + `createWire(event())`; assert clarification `view.action` and target equal the stored proposal and final archive. Take live IDs from Task 3 and request the actual public turn stream; assert not-found/exclusion before runtime attachment (P1's `getStreamAttempt` boundary), not merely absence of `calendar.frame` from an ordinary text stream. Also submit a `calendar.confirm` object to text HTTP input and assert strict-body rejection, not write execution.

- [ ] **Step 6: Run** `npm test -- test/http/calendar-publication-stream.spec.ts test/http/calendar-stream.spec.ts test/http/sse-writer.spec.ts test/http/voice-exclusion.spec.ts`. Expected: no changed durability/sequence/transport semantics or new display wait. Record the actual text policy as completion-carried snapshot.

- [ ] **Step 7: Commit.**

```bash
git add backend/test/http/calendar-publication-stream.spec.ts
git commit -m "test(voice-calendar): verify completion publication and terminal backpressure"
```

### Task 6: Compare the frozen P1 workload and exercise non-blocking sinks

**Files:** Create `backend/test/performance/calendar-voice-latency.spec.ts`; read the unchanged reference spec and existing probe/runtime/voice fixtures.

- [ ] **Step 1: Begin the performance spec with the mandatory header and frozen reference.** Use explicit imports; this test does not need new package scripts/config:

```typescript
/**
 * ============================================================================
 * FILE: calendar-voice-latency.spec.ts
 * LOCATION: backend/test/performance/calendar-voice-latency.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Compare Calendar dependency paths with the P1 reference and hostile visuals.
 * ROLE IN PROJECT:
 *    Uses the existing offline storage-wave probe and actual Calendar runtime.
 *    Measures dependencies, not real network latency or absolute zero CPU cost.
 * KEY COMPONENTS:
 *    - Historical comparison: Identical confirmation workload and boundaries.
 *    - Sink ablation: Same requests/durability with blocked or failed visuals.
 * ============================================================================
 */
import { afterEach, expect, it, vi } from 'vitest';
import { DependencyProbe } from './dependency-probe.js';
import { createLatencyFixture } from './latency-runtime-fixture.js';
import { createWire, textWire } from '../runtime/calendar-runtime.fixture.js';
import { callWire, loadWire } from '../assembly/skill-fixture.js';
import { event } from '../runtime/calendar-multi-fixture.js';
import { calendarLiveFixture } from '../runtime/calendar-live.fixture.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const P1_REFERENCE = [
  { earlierTurns: 0, referenced: false, reads: 158, writes: 45, waves: 199, elapsedMs: 30523, receiptMs: 21108 },
  { earlierTurns: 0, referenced: true, reads: 155, writes: 45, waves: 196, elapsedMs: 30322, receiptMs: 20907 },
  { earlierTurns: 8, referenced: false, reads: 182, writes: 45, waves: 223, elapsedMs: 32131, receiptMs: 22716 },
  { earlierTurns: 8, referenced: true, reads: 171, writes: 45, waves: 212, elapsedMs: 31394, receiptMs: 21979 },
] as const;

it.each(P1_REFERENCE)('compares P1 confirmation: $earlierTurns turns, reference=$referenced', async baseline => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
  let restoreFrames = () => {};
  try {
    let sessionId: string | null = null;
    for (let n = 0; n < baseline.earlierTurns; n++) {
      fx.calendar!.modelWires.push(textWire('Noted.'));
      const ids = await fx.run(() => fx.submit(`Note ${n}`, sessionId));
      sessionId = ids.sessionId;
      await fx.run(() => fx.execute(ids));
    }
    fx.calendar!.modelWires.push(loadWire(['calendar_create_event'], 'confirm-load'), createWire(event()));
    const first = await fx.run(() => fx.submit('create the event', sessionId));
    await fx.run(() => fx.execute(first));
    const proposal = await fx.run(() => fx.calendar!.currentProposal(first.sessionId));
    if (!proposal) throw new Error('Reference workload did not create a proposal');
    let receiptMs: number | null = null;
    const push = fx.frames.push.bind(fx.frames);
    const frames = vi.spyOn(fx.frames, 'push').mockImplementation((...items) => {
      for (const item of items) {
        const frame = item as { event?: { type: string; operation?: { state: string } } };
        if (receiptMs === null && frame.event?.type === 'calendar-operation'
          && frame.event.operation?.state === 'succeeded') receiptMs = probe.elapsedMs;
      }
      return push(...items);
    });
    restoreFrames = () => frames.mockRestore();
    const measured = await fx.measure(async () => {
      const ids = await fx.submit('yes', first.sessionId, baseline.referenced ? {
        calendarReplyTo: { proposalId: proposal.proposalId, revision: proposal.revision },
      } : undefined);
      await fx.execute(ids);
      return ids;
    });
    console.log('CALENDAR_P3_CONFIRM_COMPARISON', JSON.stringify({ baseline,
      after: measured.metrics, receiptMs, modelCalls: fx.modelCalls.length,
      requestKinds: fx.calendar!.requestKinds, effects: fx.googleEffects.map(e => e.kind) }));
    expect(fx.modelCalls).toHaveLength(baseline.earlierTurns + 2);
    expect(fx.googleEffects.filter(e => e.kind === 'create')).toHaveLength(1);
    expect(fx.calendar!.modelWires).toHaveLength(0);
    expect(measured.metrics.wireWrites).toBe(baseline.writes);
    expect(measured.metrics.wireReads).toBeLessThanOrEqual(baseline.reads);
    expect(measured.metrics.waves).toBeLessThanOrEqual(baseline.waves);
    expect(measured.metrics.elapsedMs).toBeLessThanOrEqual(baseline.elapsedMs);
    expect(receiptMs).not.toBeNull();
    expect(receiptMs!).toBeLessThanOrEqual(baseline.receiptMs);
    expect(fx.rawRuntime.snapshot().active).toBe(0);
  } finally { restoreFrames(); await fx.close(); }
});
```

`vi.spyOn` observes the existing frame append; it adds no reads or model calls. Keep the baseline's exact script, read/write delays and setup exclusion. If prototype spies interact with `restoreAllMocks`, restore per test before creating the next fixture, not halfway through a live fixture.

- [ ] **Step 2: Run both reference and new comparison together.** Backend: `npm test -- test/performance/calendar-critical-path.spec.ts test/performance/calendar-voice-latency.spec.ts`. Expected: four nonempty comparison rows plus original reference measurements. Record the new metrics even when an assertion fails. A difference is a P1-owned regression investigation, not permission to change the baseline or weaken the write boundary.

- [ ] **Step 3: Add a deterministic lookup measurement.** Use a fresh `createLatencyFixture` with the same 67/449 ms settings; script activation, list, concise narration with these actual helpers:

```typescript
fx.calendar!.modelWires.push(loadWire(['calendar_list_events'], 'lookup-load'),
  callWire('calendar_list_events', {
    timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20,
  }, 'lookup-call'), textWire('No events in that range.'));
const measured = await fx.measure(async () => {
  const ids = await fx.submit('List my calendar for November 3.');
  await fx.execute(ids);
  return ids;
});
expect(fx.modelCalls).toHaveLength(3);
expect(fx.googleEffects.filter(e => e.kind === 'list')).toHaveLength(1);
expect(fx.googleEffects.filter(e => e.kind === 'create')).toHaveLength(0);
expect(fx.frames.some(raw => (raw as { event: { type: string } }).event.type === 'calendar-view')).toBe(false);
console.log('CALENDAR_P3_LOOKUP_PROFILE', JSON.stringify({ metrics: measured.metrics,
  modelCalls: fx.modelCalls.length, requestKinds: fx.calendar!.requestKinds,
  effects: fx.googleEffects.map(e => e.kind), frameCount: fx.frames.length }));
```

Add positive assertions that completion contains agenda, view bytes are bounded, milestones are populated for dispatch/delta/terminal where the fixture instruments them, and no unexpected OpenRouter/Google URL was requested. Record wire command histogram, logical reads/writes, phases, waves, first delta/terminal, and frame bytes/count. This is an **after-feature lookup profile**, not a pre-feature lookup baseline P1 never recorded.

- [ ] **Step 4: Add matched sink ablation on the real voice runtime in both modes.** Reuse `calendarLiveFixture(mode)` without changing its owned file. This is a representative code case; parameterize it with `it.each` for `memory | durable` and `record | throws | pending | rejected`:

```typescript
it.each(['memory', 'durable'] as const)('%s completes lookup while visual sink is pending', async mode => {
  const f = await calendarLiveFixture(mode);
  let resolve!: () => void;
  const pending = new Promise<void>(r => { resolve = r; });
  const visual = vi.fn(() => pending);
  try {
    f.h.modelWires.push(loadWireForRuntime('calendar_list_events'),
      skillWireForRuntime('call_tool', { plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
        timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20,
      } }, 'sink-list'), textWire('No events in that range.'));
    const ids = await f.submit('List my calendar for November 3.');
    await f.execute(ids, visual);
    expect(visual).toHaveBeenCalled();
    expect(f.spoken.join('')).toBe('No events in that range.');
    expect(f.finish).toHaveBeenCalledTimes(1);
    expect(f.h.modelBodies).toHaveLength(3);
    expect(f.h.effects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(f.h.runtime.snapshot().active).toBe(0);
  } finally { resolve(); await f.dispose(); }
}, 1500);
```

Add the **defined imports** for the aliases above:

```typescript
import { loadWire as loadWireForRuntime, skillWire as skillWireForRuntime }
  from '../runtime/calendar-runtime.fixture.js';
```

For `record`, return `Promise.resolve()` and retain frames; for `throws`, throw synchronously; for `pending`, never release until after speech/terminal assertions; for `rejected`, return a promise with an attached rejection observer so the test itself does not create an unhandled rejection, and assert production handling creates no unhandled failure. Do not use an expensive synchronous infinite loop as a "slow renderer": JavaScript cannot make synchronous blocking code non-blocking.

- [ ] **Step 5: Repeat sink ablation with a pending proposal then a confirmed write.** Use `loadWireForRuntime('calendar_create_event')`, `createWire(event())`; execute proposal and revision-bound `yes` with the same sink. Assert proposal speech, created speech suffix exactly once (publisher reset is not repeated), `finish` exactly once per turn, one actual create, same durable operation state and saved `calendarView` as the recording-sink control, and no additional model requests. For the pending/rejected sinks assert these facts **before** releasing visual work. Also run the P1 adapter test that exercises actual `VoiceSink.event` rather than assuming the runtime callback test covers the adapter.

- [ ] **Step 6: Measure matched voice sink variants with the existing probe, without a new harness.** Add this local composition to the new spec. It reuses the established `VoiceDelivery` pattern from `backend/test/performance/voice-critical-path.spec.ts`, including real journal writes and synthetic playback proof, rather than deleting durability to improve the measurement:

```typescript
import type { TurnMeasurement } from './latency-runtime-fixture.js';
import type { CalendarView } from '../../src/contracts/calendar-view.js';
import type { CalendarCompatibleEnvelope } from '../../src/chat-runtime/ports.js';
import type { VoiceDeliveryRecord } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { VoiceDelivery } from '../../src/voice/agent/voice-delivery.js';
import { key } from '../../src/persistence/records.js';

type SinkBehavior = 'record' | 'throws' | 'pending' | 'rejected';
type SinkMeasurement = {
  metrics: TurnMeasurement; modelCalls: number; requestKinds: string[];
  providerRequests: { method: string; path: string }[];
  firstSpeechMs: number | null; outcome: CalendarView | null;
};
async function measureVoiceSink(behavior: SinkBehavior): Promise<SinkMeasurement> {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
  const sessionId = 'voice-calendar-probe', voiceSessionId = 'voice-calendar-probe-session';
  const providerRequests: SinkMeasurement['providerRequests'] = [];
  const fetch = fx.fetcher.getMockImplementation()!;
  fx.fetcher.mockImplementation((url, init) => {
    const parsed = new URL(String(url));
    providerRequests.push({ method: String(init?.method ?? 'GET').toUpperCase(),
      path: parsed.pathname.replace(/(\/events\/)[^/]+$/, '$1fixture-event') });
    return fetch(url, init);
  });
  let resolveVisual!: () => void;
  const pending = new Promise<void>(resolve => { resolveVisual = resolve; });
  let latest!: VoiceDeliveryRecord, delivery!: VoiceDelivery;
  let firstSpeechMs: number | null = null, spoken = '';
  const flush = vi.fn(async () => undefined);
  const visual = vi.fn((_frame: CalendarCompatibleEnvelope): Promise<void> => {
    if (behavior === 'throws') throw new Error('offline visual failure');
    if (behavior === 'pending') return pending;
    if (behavior === 'rejected') {
      const rejected = Promise.reject<void>(new Error('offline async visual failure'));
      void rejected.catch(() => {}); // observe the test-created promise immediately
      return rejected;
    }
    return Promise.resolve();
  });
  const reservation = await fx.run(() => fx.rawRuntime.reservations.acquire({ identity: fx.identity,
    conversationId: sessionId, owner: { kind: 'live', voiceSessionId } }));
  try {
    fx.calendar!.modelWires.push(loadWire(['calendar_list_events'], 'voice-lookup-load'),
      callWire('calendar_list_events', { timeMin: '2026-11-03T00:00:00Z',
        timeMax: '2026-11-04T00:00:00Z', maxResults: 20 }, 'voice-lookup-call'),
      textWire('No events in that range.'));
    const measured = await fx.measure(async () => {
      const ids = await fx.rawRuntime.submitLiveTurn({ identity: fx.identity, sessionId,
        content: 'List my calendar for November 3.', idempotencyKey: 'voice-calendar-probe-input',
        reservation, configSnapshot: fx.calendar!.currentConfig.current()!,
        voice: { voiceSessionId, socketEpoch: 1, providerTurnId: 'voice-calendar-probe-stt' } });
      await fx.runtime.executeTurn({ userId: fx.identity.userId, ...ids,
        signal: new AbortController().signal, emit: async () => undefined, emitCalendar: visual,
        live: {
          reservation,
          start: async (attempt, write) => {
            const seed: VoiceDeliveryRecord = { ...deliveryFixture(), userId: attempt.userId,
              sessionId: attempt.sessionId, turnId: attempt.turnId, attemptId: attempt.attemptId,
              voiceSessionId, responseId: key('voice-response', attempt.userId, attempt.sessionId, attempt.attemptId),
              status: 'pending', textGenerated: '', textSpoken: null, textRemaining: null,
              audioDurationMs: null, audioPlayedMs: null, playedSamples: null,
              createdAt: attempt.createdAt, updatedAt: attempt.createdAt };
            delivery = new VoiceDelivery(seed, 0, async (record, sequence) => {
              await write(record, sequence); latest = structuredClone(record);
            }, { flush, speak: async command => {
              if (firstSpeechMs === null) firstSpeechMs = probe.elapsedMs;
              spoken += command.text;
            } }, 2000);
            await delivery.start();
          },
          delta: text => delivery.delta(text), finish: () => delivery.finish(),
          settle: async text => {
            await delivery.event({ type: 'speech-completed', turnId: latest.turnId,
              responseId: latest.responseId, speechId: 'voice-calendar-probe-tts',
              audioDurationMs: 100, audioSamples: 2400, usage: { providerRequestId: null,
                model: 'fixture', modelVersion: null, audioMs: 100, billableCharacters: text.length } });
            await delivery.playback(2400);
            await delivery.settle(text);
          },
        },
      });
      return ids;
    });
    expect(visual).toHaveBeenCalled();
    expect(spoken).toBe('No events in that range.');
    expect(firstSpeechMs).not.toBeNull();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(fx.modelCalls).toHaveLength(3);
    expect(fx.googleEffects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(fx.rawRuntime.snapshot().active).toBe(0);
    // Diagnostic read is outside the frozen measurement, not hidden in the critical path.
    const history = await fx.run(() => fx.persistence.messages.listForContext(fx.identity.userId,
      measured.result.sessionId, { cursor: null, limit: 20 }));
    const outcome = history.items.find(m => m.role === 'assistant'
      && m.turnId === measured.result.turnId)?.calendarView ?? null;
    expect(outcome).toMatchObject({ kind: 'agenda', entries: [] });
    return { metrics: measured.metrics, modelCalls: fx.modelCalls.length,
      requestKinds: [...fx.calendar!.requestKinds], providerRequests,
      firstSpeechMs, outcome };
  } finally {
    resolveVisual();
    await fx.run(() => fx.rawRuntime.reservations.release({ identity: fx.identity,
      reservationId: reservation.reservationId }));
    await fx.close();
  }
}

it.each(['throws', 'pending', 'rejected'] as const)('preserves probe dependencies with %s visuals', async behavior => {
  vi.useFakeTimers({ toFake: ['Date'] }); // fixed source expiry, real timers/setImmediate for the probe
  vi.setSystemTime('2026-11-11T10:00:00Z');
  const recorded = await measureVoiceSink('record');
  const hostile = await measureVoiceSink(behavior);
  expect(hostile.modelCalls).toBe(recorded.modelCalls);
  expect(hostile.requestKinds).toEqual(recorded.requestKinds);
  expect(hostile.providerRequests).toEqual(recorded.providerRequests);
  expect(hostile.metrics.logicalReads).toBe(recorded.metrics.logicalReads);
  expect(hostile.metrics.logicalWrites).toBe(recorded.metrics.logicalWrites);
  expect(hostile.metrics.wireReads).toBe(recorded.metrics.wireReads);
  expect(hostile.metrics.wireWrites).toBe(recorded.metrics.wireWrites);
  expect(hostile.metrics.wireCommands).toEqual(recorded.metrics.wireCommands);
  expect(hostile.metrics.waves).toBe(recorded.metrics.waves);
  expect(hostile.metrics.elapsedMs).toBe(recorded.metrics.elapsedMs);
  expect(hostile.firstSpeechMs).toBe(recorded.firstSpeechMs);
  expect(hostile.outcome).toEqual(recorded.outcome);
  console.log('CALENDAR_P3_SINK_ABLATION', JSON.stringify({ behavior, recorded, hostile }));
}, 5000);
```

Record first speech in the actual speak callback and authority completion at execute settlement. The generic fixture's `milestones.firstDeltaMs` is only instrumented by `fx.execute`; if using this direct live command report it null rather than inventing a measurement. This is **sink-ablation**, not historical before-feature voice admission: the old durable path did not support Calendar voice. Raw request traces contain only fixture method/path, no credentials/payloads. The rejection observer prevents a test-created orphan rejection; retained adapter/error-handling checks must still verify production does not leak errors.

- [ ] **Step 7: Capture informational timing and reject false certainty.** Repeat the fixed workloads at least five times, fixed clock/fixtures, no provider network, alternating order for ablation. Record wall elapsed samples/median/range and bounded view bytes separately from modeled probe milliseconds. Do not create a flaky wall-clock CI threshold or claim storage waves prove CPU cost is zero. Any repeatable regression is investigated; noisy/inconclusive CPU/browser timing stays explicitly inconclusive.

- [ ] **Step 8: Run focused latency and adapter/HTTP isolation checks.** Backend: `npm test -- test/performance/calendar-critical-path.spec.ts test/performance/calendar-voice-latency.spec.ts test/voice/agent/submission.spec.ts test/runtime/calendar-durable-voice.spec.ts test/runtime/calendar-memory-voice.spec.ts test/http/calendar-publication-stream.spec.ts`. Expected: all deterministic assertions hold; pending sinks cannot exhaust the normal test timeout. A delayed promise that is immediately resolved does not count as the pending-sink proof.

- [ ] **Step 9: Commit.**

```bash
git add backend/test/performance/calendar-voice-latency.spec.ts
git commit -m "test(voice-calendar): compare P1 latency and prove visual sink independence"
```

### Task 7: Verify frontend protocol, controller, history, and Canvas composition

**Files:** Create `frontend/src/features/voice/integration-tests/calendar-canvas.test.ts`; read P2's actual public exports at the reconciliation gate.

- [ ] **Step 1: Bind the test to P2's committed surfaces.** Record which code owns automatic opening (controller binding versus ChatView effect), sticky dismissal, correlation, and confirmation. Keep `matrixFixture.begin()`/`event()` (not nonexistent `start` variants), chat reducer `CLOSE_CANVAS` (not a nonexistent controller method), and current `LiveVoiceState.phase` (not a fabricated `state: 'ready'`). Do not mock the controller/reducer/Canvas renderer to assert the behavior they are supposed to implement.

- [ ] **Step 2: Write portable protocol plus real history-to-Canvas checks.** Start with this complete test code and mandatory header; use the reconciled P2 `CalendarView` export if it is in a separate calendar-view module rather than its protocol module:

```typescript
/**
 * ============================================================================
 * FILE: calendar-canvas.test.ts
 * LOCATION: frontend/src/features/voice/integration-tests/calendar-canvas.test.ts
 * ============================================================================
 * PURPOSE:
 *    Verify Calendar wire, voice state, history and Canvas integration offline.
 * ROLE IN PROJECT:
 *    Exercises real frontend boundaries with existing Room and controller doubles.
 *    Uses SSR for markup only, not as evidence that browser effects ran.
 * KEY COMPONENTS:
 *    - Portable wire: Correlated frames and dictation exclusion.
 *    - History: Read-only snapshots, safe rendering and Canvas continuity.
 * ============================================================================
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { parseVoiceControl, type VoiceServerPayload } from '../../../api/voice-protocol.ts';
import type { VisibleMessage } from '../../../api/protocol.ts';
import type { CalendarView } from '../../../api/calendar-protocol.ts';
import { collectSessionCanvasArtifacts } from '../../canvas/canvas-artifacts.ts';
import { CanvasPanel } from '../../canvas/CanvasPanel.tsx';
import { chatReducer, initialChatState } from '../../chat/state/chat-reducer.ts';
import { matrixFixture } from './matrix-fixture.ts';
import { settle } from '../state/testing/live-voice-fixture.ts';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const agenda: CalendarView = {
  viewVersion: 1, kind: 'agenda',
  target: { calendarId: 'personal@example.test', calendarLabel: 'Personal',
    labelExpiresAt: '2026-11-11T10:05:00.000Z' },
  requested: { timeMin: '2026-11-03T00:00:00.000Z', timeMax: '2026-11-06T00:00:00.000Z',
    displayTimeZone: 'Etc/UTC' },
  entries: [{ eventId: 'evt_all_day_1', summary: 'Offsite', start: '2026-11-03', end: '2026-11-05',
    allDay: true, timeZone: 'Etc/UTC', status: 'confirmed', htmlLink: null,
    description: '<script>plain description</script>' }],
  nextPageToken: null, truncated: false, detailsTrimmed: false, entriesOmitted: 0,
  expiresAt: '2026-11-11T10:05:00.000Z',
};
const frame: VoiceServerPayload = { type: 'calendar.frame', turnId: 'calendar-turn-1',
  attemptId: 'calendar-attempt-1', responseId: 'calendar-response-1',
  event: { type: 'calendar-view', view: agenda } };
function archived(view: CalendarView, mode: 'text' | 'live' = 'text'): VisibleMessage {
  return { messageId: 'calendar-message-1', turnId: 'calendar-turn-1', eventId: 'calendar-event-1',
    sequence: 2, role: 'assistant', content: mode === 'text' ? 'Your agenda.' : '',
    createdAt: '2026-11-11T10:00:00.000Z', completionStatus: 'completed', truncated: false,
    mode, calendarView: view,
    ...(mode === 'live' ? { voiceSessionId: 'voice-history-1',
      voiceTranscripts: [{ role: 'assistant' as const, content: 'Your agenda.' }] } : {}),
  };
}
function panel(view: CalendarView): string {
  const artifacts = collectSessionCanvasArtifacts([archived(view)], '', false);
  expect(artifacts).toHaveLength(1);
  return renderToStaticMarkup(createElement(CanvasPanel, { artifacts,
    activeArtifactId: artifacts[0]!.artifactId, onSelectArtifact: vi.fn(),
    onCloseTab: vi.fn(), onClosePanel: vi.fn() }));
}

it('accepts the correlated live frame and rejects it in dictation and client directions', () => {
  const event = { protocolVersion: 1, sessionId: 'voice-calendar-1', connectionEpoch: 1,
    eventId: 'wire-calendar-1', sequence: 0, ...frame };
  expect(parseVoiceControl(JSON.stringify(event), 'server', 'live')).toEqual(event);
  expect(() => parseVoiceControl(JSON.stringify(event), 'server', 'dictation')).toThrow();
  expect(() => parseVoiceControl(JSON.stringify(event), 'client', 'live')).toThrow();
  expect(() => parseVoiceControl(JSON.stringify({ ...event, extra: true }), 'server', 'live')).toThrow();
});

it.each(['text', 'live'] as const)('reloads a %s calendar snapshot through actual artifact collection', mode => {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-11T10:00:00Z');
  const row = archived(agenda, mode);
  const artifacts = collectSessionCanvasArtifacts([row], '', false);
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]).toMatchObject({ kind: 'calendar', messageId: row.messageId });
  let state = { ...initialChatState, messages: [row] };
  expect(state.canvasOpen).toBe(false);
  state = chatReducer(state, { type: 'OPEN_CANVAS_ARTIFACT',
    payload: { artifactId: artifacts[0]!.artifactId } });
  expect(state.canvasOpen).toBe(true);
  state = chatReducer(state, { type: 'CLOSE_CANVAS' });
  expect(state.canvasOpen).toBe(false);
  expect(collectSessionCanvasArtifacts([row], '', false)).toHaveLength(1);
  const html = panel(agenda);
  expect(html).toContain('Offsite');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('Confirmed on Google Calendar');
});

it('disarms historical proposal buttons rather than treating expiry as authorization', () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-11T10:00:00Z');
  const proposal: CalendarView = { viewVersion: 1, kind: 'proposal', proposalId: 'proposal-history-1',
    intentId: 'intent-history-1', revision: 1, expiresAt: '2026-11-11T10:05:00.000Z', reason: 'details',
    target: { calendarId: 'personal@example.test', calendarLabel: 'Personal',
      labelExpiresAt: '2026-11-11T10:05:00.000Z' },
    action: { calendarId: 'personal@example.test', summary: 'Planning',
      start: '2026-11-12T10:00:00Z', end: '2026-11-12T11:00:00Z', timeZone: 'Etc/UTC' }, candidates: [] };
  const html = panel(proposal);
  expect(html).toContain('Planning');
  expect(html).not.toContain('Confirmed on Google Calendar');
  expect(html).toContain('Historical snapshot');
  expect(html).not.toContain('Calendar request confirmation');
  expect(html).not.toContain('>Confirm event</button>');
  expect(html).not.toContain('>Cancel request</button>');
});
```

The last case uses the read-only wording and accessible control-group names from P2's draft. Reconcile deliberate wording changes with the committed handoff without dropping the negative control assertions. Do not accept `expect(message.calendarView).toBeDefined()` or a data literal equality as proof of history hydration. Rendering must traverse actual artifact collection and CanvasPanel. Do not assume all action buttons (tab close, copy, expand) are authorization buttons.

- [ ] **Step 3: Run** `npm test -- src/features/voice/integration-tests/calendar-canvas.test.ts`. Expected: protocol mirror accepts P1 payloads, both message modes hydrate via the real collector, proposal is read-only, and description remains inert text. Any P2 export mismatch must be reconciled, not optional-chained away.

- [ ] **Step 4: Add actual controller/control-channel tests.** The planned P2 positional method and slice permit this full test (reconcile only if its committed handoff changes):

```typescript
it('sends one revision-bound control without touching microphone or playback', async () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-11T10:00:00Z');
  let selected: string | null = null;
  const f = matrixFixture('granted', { bindings: {
    claimVoiceInput: vi.fn(() => 'calendar-lease-1'), writeVoiceDraft: vi.fn(() => true),
    releaseVoiceInput: vi.fn(), refreshSessions: vi.fn(),
    bindVoiceConversation: vi.fn((_token: string, id: string) => { selected = id; return true; }),
    getActiveConversationId: () => selected,
    openCanvasArtifact: vi.fn(),
  } });
  try {
    await f.begin();
    f.event({ type: 'conversation.bound', conversationId: 'calendar-chat-1' });
    const proposal: Extract<CalendarView, { kind: 'proposal' }> = {
      viewVersion: 1, kind: 'proposal', proposalId: 'proposal-live-1', intentId: 'intent-live-1',
      revision: 2, expiresAt: '2026-11-11T10:05:00Z', reason: 'details',
      target: { calendarId: 'personal@example.test', calendarLabel: 'Personal',
        labelExpiresAt: '2026-11-11T10:05:00Z' },
      action: { summary: 'Planning', start: '2026-11-12T10:00:00Z',
        end: '2026-11-12T11:00:00Z', timeZone: 'Etc/UTC' }, candidates: [],
    };
    f.event({ type: 'calendar.frame', turnId: 'confirm-turn-1', attemptId: 'confirm-attempt-1',
      responseId: 'confirm-response-1', event: { type: 'calendar-view', view: proposal } });
    expect(f.controller.getSnapshot().calendarWorkspaces).toHaveLength(1);
    const control = vi.spyOn(f.client(), 'control');
    const micStops = f.rtc.mic.stop.mock.calls.length;
    const publishes = f.rtc.participant.publishTrack.mock.calls.length;
    expect(f.controller.confirmCalendar(proposal.proposalId, proposal.revision, { kind: 'accept' })).toBe(true);
    expect(f.controller.confirmCalendar(proposal.proposalId, proposal.revision, { kind: 'accept' })).toBe(false);
    expect(control).toHaveBeenCalledExactlyOnceWith({ type: 'calendar.confirm', proposalId: proposal.proposalId,
      proposalRevision: proposal.revision, answer: { kind: 'accept' } });
    expect(f.controller.getSnapshot().calendarWorkspaces[0]).toMatchObject({ pending: true, interactive: false });
    expect(f.controller.getSnapshot().phase).toBe('active');
    expect(f.rtc.mic.stop).toHaveBeenCalledTimes(micStops);
    expect(f.rtc.participant.publishTrack).toHaveBeenCalledTimes(publishes);
    expect(f.rtc.room.disconnect).not.toHaveBeenCalled();
    expect(f.http.end).not.toHaveBeenCalled();
    expect(f.http.create).toHaveBeenCalledTimes(1);
  } finally { f.controller.exit(); await settle(); }
});
```

Add reject and candidate variants with the exact wire answer union. For busy/expired/stale/historical cases assert **no `calendar.confirm` call**, not merely that phase remains active. Set selected conversation to another ID to exercise fail-closed navigation. Reset control spies after session-start/voice handshake controls so counts refer to calendar control. This proves the controller sends the reference, not backend authorization; Task 4 proves the latter.

- [ ] **Step 5: Add one short test per continuity/opening scenario.** Exercise the P2-owned policy at its real location; do not reproduce its algorithm in a test helper:

| Test name | Input/actions | Assert |
| --- | --- | --- |
| `opens voice workspace on actual work, not schema activation` | Validating/repairing only; then executing; then agenda frame. | No early open; one actual-work open; agenda updates same selection/tab before speech final. |
| `keeps a dismissed operation closed but opens a genuinely new request` | Open; `chatReducer(CLOSE_CANVAS)`; replay/update same intent/proposal; new request. | No reopening for same operation; new request may open once. |
| `keeps proposal confirmation and outcome in one workspace` | Proposal on turn A; execution/outcome on turn B with same proposalId/intentId. | Stable identity/alias, one tab, no second automatic open. |
| `closing and reopening never touches microphone or playback resources` | Record client/room/mic/track identities and publish/stop/disconnect call counts; close/reopen panel. | Resources/call counts unchanged; pending proposal remains pending; no confirm/reject/interrupt control. |
| `ignores old epoch, wrong conversation, and mismatched response updates` | `f.event(frame, oldEpoch)`; navigation/exit; delayed old frame; stale attempt or response claiming another turn. | No leaked view/success or reopened panel; active conversation's data retained. A late authoritative outcome after barge-in still updates its own workspace; speech retirement alone must not erase committed facts. |
| `retains completed view through live exit and message reload` | End call; load real visible-message payload with calendarView; collect/merge. | One artifact (no live/history duplicate), read-only history, original voice transcript/artifacts remain usable. |
| `does not auto-open any text calendar result` | Feed text progress/proposal/outcome and `completed.calendarView` through real text state path. | Inline data/button visible, Canvas stays closed until the real inspect-button action. Include legacy succeeded receipt and calendar fenced block. |
| `keeps non-calendar Canvas behavior unchanged` | Existing Mermaid/chart/SVG voice projections and text manual entries. | Existing counts/selection/opening remain; calendar policy does not swallow unrelated artifacts. |

Controller integration proves controller behavior; SSR cannot prove a ChatView `useEffect` ran or a user clicked the inspect button. If those policies live in effects, use the browser evidence task for actual mounted interactions and label Node coverage partial. Never say `chatReducer(OPEN_CANVAS_ARTIFACT)` proves the button was wired or automatic policy was correct.

- [ ] **Step 6: Add agenda-integrity and safe-markup cases**, each through the actual P2 artifact collector/Canvas renderer; use the data variants from Task 3 and these additional precise cases:

| Case | Data | Required result |
| --- | --- | --- |
| Day grouping/DST | Timed events `2026-11-01T05:30:00Z` and `2026-11-01T06:30:00Z`, display zone `America/New_York`. | Same Nov 1 group, honest repeated 01:30 times/zone; no browser-zone-dependent grouping. |
| Exclusive all-day end | `2026-11-03` → `2026-11-05`. | Occupies Nov 3/4 or an equivalent correct interval, not a Nov 5 event. |
| Timed multi-day | `2026-11-03T23:30:00Z` → `2026-11-04T01:00:00Z`. | Accurate interval/day headings without silently shortening it. |
| Empty/failure/unavailable | Successful `agenda.entries=[]`; separate notice failure/unavailable. | Distinct labels, never false "no events" on failure. |
| Partial/truncated/trimmed | `nextPageToken: 'opaque-next'`, `truncated: true`; `detailsTrimmed: true`, `entriesOmitted: 1`. | Explicit incompleteness; no invented completeness or automatic provider fetch. |
| Missing fields | No location/description; empty summary. | No invented attendees/place/calendar label; appropriate neutral missing-title treatment. |
| Expired metadata | Advance from before `expiresAt` to after using fixed clock. | Calendar facts remain; link and verified label disappear; proposal action controls disabled. |
| Unsafe content/link | Returned description contains `<script>`; invalid `javascript:` link in a separately malformed wire fixture. | Text escaped, no executable HTML; strict mirror rejects invalid URL; renderer safety fallback hides bad links. |
| Accessible normal layout | Agenda/proposal/outcome in CanvasPanel. | Day headings/details semantics, accessible names/status, no calendar pan/zoom stage or diagram drag controls. |

Assert actual output and control behavior, not snapshots alone. For `<details>`, use native details/summary semantics if P2 chose them instead of demanding an invented `aria-expanded` prop. Full keyboard/screen-reader/responsiveness claims require the browser task.

- [ ] **Step 7: Verify frontend visual failure cannot gate media.** Use the same selected-conversation bindings and a real `controller.subscribe` listener that throws only during the calendar update, or returns a pending thenable; unsubscribe before feeding the next `audio.start`, watermark, and listening events. Assert the real client/controller continues, resource state remains current, no extra HTTP/control/provider request is made, and no false write success is manufactured. Run the text path with completion-carried view and a paused/failing visual consumer; earlier text still streams and terminal state remains authoritative. Exercise P2's actual `CalendarViewBoundary` fallback/recovery when mounted-browser coverage exists; a source/class-state assertion alone is not a thrown-render interaction test. Keep React render failures distinct from network/authority failures; an unhandled exception is a defect, not a passing "ignored sink" case.

- [ ] **Step 8: Run integration and retained P2 regressions.** Frontend: `npm test -- src/features/voice/integration-tests/calendar-canvas.test.ts src/features/voice/integration-tests/canvas-multimodal.test.ts src/features/canvas/calendar-canvas.test.ts src/features/chat/ChatView.voice.test.ts src/features/chat/state/calendar-chat-state.test.ts src/api/voice-protocol.test.ts src/api/calendar-protocol.test.ts`. Expected: real nonzero discovery in Node, actual pass counts, no extra packages/DOM environment added. Record missing interaction evidence separately.

- [ ] **Step 9: Commit.**

```bash
git add frontend/src/features/voice/integration-tests/calendar-canvas.test.ts
git commit -m "test(voice-calendar): integrate voice controls Canvas policy and history"
```

### Task 8: Collect browser interaction evidence where available

**Files:** Update `docs/voice-calendar-canvas/verification.md` only. P2 retains UI source; do not create a browser framework, new entry route, or screenshot-driven replacement UI for this task.

- [ ] **Step 1: Check for an already available fixture-backed browser/test page.** Use the browser panel only against loopback with synthetic data and deterministic providers. Do not launch the configured real backend and speak a calendar mutation to obtain a screenshot. If no fixture page/browser capability is available, record **not run — fixture-backed browser unavailable**, explain which AC7/effect interactions remain unverified, and continue automated verification without pretending SSR covers them.

- [ ] **Step 2: At a desktop viewport (approximately 1280×800), exercise lookup and dismissal.** Trigger schema activation then actual work; verify first automatic open occurs at actual work, real phase/status text, concise speech fixture, accurate agenda details/scrolling, no zoom/pan, same workspace on updates. Close while speaking; verify mic/playback resource counters remain stable, ordinary updates do not reopen, explicit reopen works. Record observed focus before/after, not just markup.

- [ ] **Step 3: Exercise proposal controls and races with synthetic provider writes.** Keyboard Tab/Enter/Space to named confirm/cancel/candidate buttons; speech and button acceptance bind the same proposal; duplicate click/race produces one recorded fixture POST; expiry/revision replacement disables old controls. Close the panel and barge-in separately: neither authorizes nor silently cancels committed work. Verify unknown/failed/succeeded wording against the fixture's authoritative ledger.

- [ ] **Step 4: Exercise text entry, continuity, and non-calendar regression.** Text lookup/proposal/create remain inline, manual inspect is required to open Canvas; reload and historical reopening cause no write or active confirmation; voice→text→voice and A→B navigation do not leak old views. Existing chart/Mermaid/SVG and voice transcript remain usable.

- [ ] **Step 5: At a mobile viewport (approximately 390×844), repeat controls/details and enable reduced motion.** Verify readable agenda, no horizontal overflow trap, keyboard focus/restoration and status announcements where observable, large enough controls, responsive panel, and no forced animation. Describe screen-reader testing as not run unless an actual screen reader was used; DOM role inspection is not full assistive-technology testing.

- [ ] **Step 6: Record evidence with date, tested SHA, viewport, browser/version, fixture method, scenario, observed result, and screenshot/trace paths.** Save screenshots in `C:/Users/Peter/AppData/Local/Temp/opencode/` with specific names and link the actual files if retained. Do not commit generated screenshots or secret/session payload logs. A screenshot proves appearance, not authority, absence of awaits, or provider compatibility.

### Task 9: Run the complete package checks and route real defects

**Files:** Update `docs/voice-calendar-canvas/verification.md`; no new scripts, dependency changes, or out-of-ownership source repairs.

- [ ] **Step 1: Run backend build.** Working directory `backend/`: `npm run build`. Record exit code and compiler diagnostics; expect 0 only if actually observed. Build may exclude test TypeScript, so a passing build is not test-suite evidence.
- [ ] **Step 2: Run backend lint.** Working directory `backend/`: `npm run lint` (current script is oxlint, not ESLint). Record warnings/errors/exit code.
- [ ] **Step 3: Run backend full routine tests.** Working directory `backend/`: `npm test`. Record discovered files, executed/passed/failed/skipped tests, duration and unhandled errors. The new routine integration specs must execute without MongoDB variables.
- [ ] **Step 4: Run backend e2e.** Working directory `backend/`: `npm run test:e2e`. Before execution confirm no unauthorized native DB settings are active; do not print URIs. Without prerequisites report each native skip and why; with operator-supplied authorized isolated prerequisites use `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_` only. Do not provision a DB, inspect application data, or assert a zero-exit empty discovery is a pass. Respect the separate voice-native authorization flag if those suites require it.
- [ ] **Step 5: Run frontend build.** Working directory `frontend/`: `npm run build`. Record TypeScript and Vite outcomes separately when useful.
- [ ] **Step 6: Run frontend lint.** Working directory `frontend/`: `npm run lint`. Record actual errors/warnings/exit code.
- [ ] **Step 7: Run frontend full tests.** Working directory `frontend/`: `npm test`. Record discovery, executed/passed/failed/skipped counts, duration, unhandled errors. Do not confuse `*.test.ts` Node checks with mounted-browser interactions.
- [ ] **Step 8: Run root hygiene and named-diff checks.** `git diff --check`, `git diff --stat`, `git status --short`, and `git diff --cached --name-only`. Distinguish unrelated pre-existing failures from P3's diff; do not clean them by reset/revert. Verify all new code files carry headers and no dependencies, output, secrets, or unrelated auth/Vite work are staged.
- [ ] **Step 9: For every failure, record the smallest reproduction and ownership.** Required entry: test/command, tested SHA, expected/actual, failing assertion/log excerpt without payload secrets, fixture prerequisites, P1/P2/P3 owner, correcting commit, focused rerun and full rerun. P3 may correct its own integration fixture/test defects; P1/P2 source defects return to that worker. This is **test-discovered correction**, not a reinstated unified review. Do not dispatch a reviewer/fixer or classify a new regression as baseline without pre-change evidence.
- [ ] **Step 10: Rerun the focused affected suite after each owner fix, then rerun all seven package commands on the final assembled source commit set.** Preserve first-run failures in the ledger with their correction/recheck outcome. Unresolved failures/skips are explicit; do not replace the initial log with a blanket green summary.

### Task 10: Finalize verification and the completion report

**Files:** Update `docs/voice-calendar-canvas/verification.md`; create `docs/voice-calendar-canvas/final_report.md`. `state.md` remains orchestrator-owned.

- [ ] **Step 1: Complete the verification ledger from actual results.** Include:

1. Scope/date/branch/tested source SHA, exact P1/P2/P3 implementation and correction commits, uncommitted/unrelated changes present, OS/architecture/Node/npm.
2. Every focused and full command with working directory, exit code, discovery, pass/fail/skip counts, duration, log path, and whether external prerequisites were absent. Never prefill expected counts as results.
3. AC1–AC9 matrix with named test case, evidence type (runtime/transport/controller/SSR/browser), result (`passed | failed | partial | not run`), and limitation. Source presence alone is not evidence.
4. P1-reported/factually observed baseline provenance, four before/after confirmation rows and deltas; model/Google request kinds/counts, logical/wire reads/writes, commands, phases, waves, first delta/receipt/speech/terminal where measured; after-only lookup profile; hostile-sink ablations; bounded frame bytes/count.
5. Wall-clock sample count/samples/median/range clearly separated from modeled milliseconds. Explain noise, missing historical lookup/voice baseline, and what was **not** measured. No absolute zero-overhead claim.
6. Text policy chosen: completion-carried view, no extra serial display frame; ordinary terminal drain retained. Voice visual callback is not awaited; required durability remains intact.
7. Browser/keyboard/mobile/reduced-motion evidence or exact reason not run; SSR/controller checks do not establish full focus/effect/browser behavior or real hardware/audio quality.
8. Test-discovered defects, owners, correction SHAs and rechecks; baseline/unrelated failures; native/database/provider/staging skips; no live-service certification.
9. Completion gate assessment: completed only if required evidence is present and no unresolved required criterion/failure remains. Otherwise explicitly name blocked/partial criteria and the next owner action.

- [ ] **Step 2: Write the final report with this structure, using actual outcomes rather than a predetermined success verdict.**

```markdown
# Final Report: Voice Calendar Canvas

## Executive outcome
## Workflow configuration
Unified review: **skipped** (user instruction); final verification remains required.

## Plan execution and tested commit set
## Experience and authority verified
## Verification results
## Latency and non-blocking findings
## Acceptance decision (AC1–AC9)
## Defects, remaining work, and limitations
## Key artifacts
## Completion recommendation
```

Link `goal.md`, `research.md`, `state.md`, `plan1.md`, `plan2.md`, `plan3.md`, and `verification.md` using valid relative Markdown paths. List P1/P2/P3 commit sets/status accurately; distinguish planned/implemented/tested. Summarize voice automatic vs text manual policy, shared proposal authority, bounded truthful agenda/outcome history, preserved transcript/transport behavior. State no new dependency/framework only after checking the actual diff. No public deployment, paid-provider, MongoDB/Azure, real-model speech quality, or production-readiness claim follows from offline success.

- [ ] **Step 3: Check the coverage closure matrix below against actual named cases.** Any uncovered goal becomes a blocker/limitation entry, not a checked criterion. Do not silently trim an acceptance criterion to close the workflow.

- [ ] **Step 4: Validate documents and named paths.** Run from root:

```bash
git diff --check
git diff --name-only
```

Then verify the artifact links and paths exist using the repository file tools. Ensure the report agrees with the exact command ledger, scenario results, latency classifications and skipped-review status. `verification.md` must identify the tested code SHA; a later docs-only commit is not a new test run. Keep stale state reconciliation with the orchestrator, not this worker.

- [ ] **Step 5: Commit the final evidence/report.**

```bash
git add docs/voice-calendar-canvas/verification.md docs/voice-calendar-canvas/final_report.md
git commit -m "docs(voice-calendar-canvas): record integrated verification and completion evidence"
```

- [ ] **Step 6: Hand back the P3 commit list, exact checks/counts/skips, acceptance decision and blockers.** Include paths to both evidence artifacts, baseline and after numbers, request/serial-dependency findings, browser limitations, owner fixes, and explicit **review skipped**. The orchestrator records graph/status and decides workflow completion; do not claim complete just because this plan's documentation files exist.

## Acceptance closure map

| Goal | Required P3 evidence | Tasks |
| --- | --- | --- |
| AC1 — Voice lookup | Real admitted LiveKit lookup/executing/agenda before final narration; real controller/Canvas opening path. Scripted concise narration is routing evidence, not a real-model quality guarantee. | 2, 3, 7, 8 |
| AC2 — Text/manual | Real completed.calendarView publication; inline result/confirmation and actual manual inspect action; no calendar text auto-open including legacy artifacts; unrelated visuals unchanged. | 5, 7, 8 |
| AC3 — Confirmation | Canonical proposal details; speech/button same reference; duplicate/race/replaced/expired/ambiguous/cross-session cases; one raw provider POST and durable authority. | 4, 7, 8 |
| AC4 — Truthful lifecycle | Real work start; cancelled/failed/unavailable/unknown distinct; durable receipt required; dismissal/barge-in separate from authorization/cancellation. | 3, 4, 5, 7, 8 |
| AC5 — Agenda integrity | Provider-to-view-to-rendered facts; empty vs failed, bounded/partial/trimmed, all-day exclusive end, multi-day/DST/zone/missing fields, safe details/expiry. | 3, 7 |
| AC6 — Continuity/isolation | Visible history equality; reload read-only; one live/history workspace; modes/navigation/epoch/attempt/response isolation; no replay create/inference. | 3, 4, 7, 8 |
| AC7 — Accessible presentation | Real ordinary agenda layout, semantic headings/details/named controls, safety, reduced-motion assertions; actual keyboard/focus/responsive observation when available. Explicitly distinguish static markup from interaction evidence. | 7, 8 |
| AC8 — Evidence | All seven package commands, nonempty focused suites, tested commit/environment, failures/rechecks/skips, no source-only pass or unauthorized live checks. | 1, 9, 10 |
| AC9 — Minimal work/latency | Frozen P1 before/after confirmation; after-only lookup profile; matched request/storage/wave/speech metrics; actual pending/throwing visual non-blocking tests at runtime/adapter/HTTP/frontend boundaries; noisy timing labelled honestly. | 5, 6, 7, 10 |

## Planner self-check (not implementation verification)

- P3 ownership is limited to dedicated integration tests, the assigned fixture, and verification/report artifacts; no P1/P2 runtime/UI work is assigned here.
- P1-reported reference numbers are preserved with provenance and correct wire/model-count semantics; missing historical measurements are not invented.
- Protocol 3, `responseId`, completion-carried text snapshots, `notice` views, exact canonical create shape (no unsupported `allDay: false` input), and LiveKit-only live admission match implemented P1 contracts.
- Every task names exact files, executable commands, meaningful observables and a focused commit; frontend API uncertainty is an explicit upstream gate rather than fictional optional methods.
- Tests distinguish authority, successful effects and raw attempted writes; actual hydration from data-literal assertions; actual mounted effects from SSR; modeled dependencies from noisy CPU/network timings.
- No review dispatch, external provisioning, credential change, live provider/calendar write, new dependency, or automatic completion claim is authorized by this plan.

### Library documentation checked while planning

- [Vitest 4 assertions and async handling](https://vitest.dev/api/expect.html) and [timer/waitFor behavior](https://vitest.dev/api/vi.html): attach rejection assertions/observers before advancing time; `vi.waitFor` advances fake timers, so do not mistake it for a passive clock.
- [React renderToStaticMarkup](https://react.dev/reference/react-dom/server/renderToStaticMarkup): output is non-interactive and cannot be hydrated; it does not establish browser effect, click, focus, keyboard, or layout behavior. Retain the repository's Node/SSR conventions without adding a DOM dependency.
