# P3 Integrated Voice Canvas Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce nonempty, deterministic integrated evidence for silent live Canvas, interruption, durable recovery, archive/context correctness, renderer parity, and honestly measured timing, without changing P1/P2 application code.

**Architecture:** Compose the real `DurableChatRuntime`/`SpeechProse`, `AgentVoiceAdapter`, `LiveFlow`, `VoiceConnection`, browser `VoiceClient`, `LiveVoiceController`, playback service, and Canvas conversion across an in-process socket relay. Substitute only model HTTP, speech providers, persistence in the routine fixture, and browser hardware; separately exercise native persistence with an isolated generated database. Keep simulated scheduling, Node markup evidence, native durability, and actual browser/provider measurements separate; integration defects return to their owning worker.

**Tech Stack:** Existing TypeScript/NodeNext and browser TypeScript, Vitest 4, LangGraph `MemorySaver`, native MongoDB/checkpointer when authorized, existing React server rendering and Canvas renderers, existing fake STT/TTS/Web Audio/socket fixtures. No dependency, application service, renderer, queue, collection, or configuration migration.

---

## Authority, prerequisites, and stop rules

- This is **L3, planning only**. The planner writes and commits only this document. No application tests, database connections, browser runs, paid calls, or implementation are performed by writing it.
- Read [goal.md](goal.md), [state.md](state.md), [plan1.md](plan1.md), and [plan2.md](plan2.md). The explicit resumed assignment/current state supersedes their stale preparation-era authorization paragraphs. Research and unified review are **skipped**, never passed; create neither `research.md` nor `review.md`.
- Branch verified for planning: `voice-chat-upgrade`; do not switch it. W1 is committed through `6b49768`; its implementation commits are `b8e09cd`, `28a349c`, `aa3083e`, `2109835`, `1dd3704`, `b1048e0`, `49f5f02`, `2f6cfc9`, `ce5158d`, `6b49768`. L2 is `06106ce`. W2 is executing concurrently: planning uses its frozen interfaces, not a partially edited checkout.
- **W3 execution prerequisite:** L3 + committed W1 + committed W2 and their handoffs. A plan or partially implemented W2 file does not satisfy W2. Verify actual W2 hashes/paths/check results with the orchestrator before Task 1. Any frozen-contract deviation pauses dependent work for an explicit reconciled handoff.
- W3 loads the installed `executing-plans` and `test-driven-development` skills and works directly in its assigned slot. The standard header does not authorize another agent hierarchy. This plan is integrated verification, not code review.
- P3 never repairs P1/P2 source/tests. On an integration failure, preserve the failing assertion, record a minimal reproduction, expected/actual behavior, command, owning path/worker, and tested hash. Ask the orchestrator for a **serialized owner correction**, then rerun the focused failure and both affected package gates. Do not add a fourth plan, weaken guards/assertions, hide a test with a skip, or dispatch a reviewer/fixer.
- Existing W1 baseline limitations remain separate: `backend/test/performance/durable-latency.spec.ts` fails standalone at baseline `4c9ada7` and current W1 under this environment; full-suite load raises failure counts. `backend/test/assembly/calendar-simplification.built.spec.ts` fails intermittently only in a full run and passes standalone. P3 does **not** fix either. The W1 recorded full run was 27 failed / 2420 passed / 10 skipped, including 26 performance failures and one assembly flake. These are historical observations, not W3 results and not a clean-suite waiver.
- No live/provider/service/browser check is authorized merely because credentials or tools exist. Native tests require separate explicit operator authorization and isolated prerequisites. Browser layout/media checks and bounded paid provider checks have separate gates in Task 8. Missing authorization remains **blocked for full acceptance**.
- Preserve all concurrent/user changes, including `.openchamber/`. Serialize index access through the orchestrator. Stage exact task paths only. Never reset, clean, broadly stage directories, print credentials/URIs, provision infrastructure, or alter queue limits.

## Exact write map and reuse decision

| P3-owned path | Responsibility |
| --- | --- |
| `backend/test/voice/integration/canvas-multimodal.spec.ts` | Offline filter/runtime/adapter/flow/wire/client/controller/Canvas chain, fault matrix, context and timing assertions. |
| `backend/test/voice/integration/canvas-multimodal.native.e2e-spec.ts` | Authorized generated-database publication/recovery/archive evidence, never a paid provider. |
| `frontend/src/features/voice/integration-tests/canvas-multimodal.test.ts` | Receiver/state, media identity, controls, archive reconciliation, inline-card and renderer safety integration. |
| `docs/voice-canvas-multimodal/verification.md` | Future executed evidence, timing rows, skips, blockers, baseline distinctions and acceptance decisions. |
| `backend/test/voice/integration/canvas-multimodal-fixture.ts` | **Named conditional helper:** minimum relay joining existing backend/runtime and frontend fixtures; the existing `integrated-fixture.ts` requires a database and cannot supply routine offline composition. |
| `frontend/src/features/voice/integration-tests/canvas-multimodal-fixtures.ts` | **Named conditional helper:** dependency-free shared synthetic visual corpus and chunk partitions, consumed by both package suites; no existing corpus spans extraction and portable Canvas descriptors. |

These are the only helper names authorized by L3. Reuse existing helpers first and omit either new helper if reuse makes it unnecessary. Any other path needs an ownership update **before** writing it. Do not edit P1/P2 helpers to make P3 easier.

Read-only reuse: `backend/test/runtime/text-config-fixture.ts` (real runtime/assembler/MemorySaver, controlled `fetcher`, `restart`, `dispose`); `backend/test/fixtures/openrouter/frames.ts` (`chunk`, `usage`, `done`); `backend/test/voice/session/fixtures.ts` (`options`, `fakeStt`, `fakeTts`); `backend/test/voice/transport/fixtures.ts` (`FakeSocket`, `settle`); `backend/test/voice/integration/integrated-fixture.ts` (`liveConfigSnapshot`); `backend/test/runtime/voice-runtime-harness.ts`; `backend/test/persistence/native.ts`; `frontend/src/features/voice/state/testing/live-voice-fixture.ts`; `frontend/src/features/voice/transport/testing/voice-fakes.ts`; `frontend/src/features/voice/audio/testing/audio-fakes.ts`; existing Canvas, message, and chat fixtures.

Every new code file starts with the mandatory repository `FILE`/`LOCATION`/`PURPOSE`/`ROLE IN PROJECT`/`KEY COMPONENTS` comment header, naming that file and its exact path. All code below goes **after** that header. Use backend `.js` import specifiers, including imports of frontend source in backend test-only code; Vite resolves them to TypeScript. Do not add backend imports to frontend source or change either tsconfig to permit a test harness. Backend Nest build excludes `test`; frontend build still checks the frontend fixture/test files.

## Frozen interface checklist — assertion targets, not replacement contracts

1. `canvas.artifact` is protocol v1, live server-only, with exact envelope keys `protocolVersion`, `sessionId` (voice session), `connectionEpoch`, `eventId`, `sequence`, plus `type`, `turnId`, `responseId`, `ordinal`, `kind`, `subType`, `title`, `rawSource`. The bound conversation comes from `conversation.bound`, not envelope `sessionId`.
2. `kind` is `mermaid | chart | svg`; `graph` maps to `chart`. `responseId = key('voice-response', userId, conversationId, attemptId)`; frontend key is `${responseId}::canvas::${ordinal}`. Ordinal is the supported candidate opener index 0–2, including discarded supported candidates; gaps remain gaps.
3. Caps: source 8192 UTF-16 units / 16384 UTF-8 bytes; title 120 / 480; subtype 48 / 192; three artifacts; response sources 16384 units / 24576 bytes; projection JSON 32768 bytes; header 512 / 1024; message reserve 33792; raw answer 32000 or a lower frozen input cap; serialized control ceiling **131072 bytes**, default message ceiling **65536 bytes**, existing output queue **2000 ms**. All remain unchanged. Both portable guards and actual sender/client parser are exercised.
4. Optional nonempty `canvasArtifacts` lives on the originating assistant/internal/live message, saved result, delivery journal and top-level public assistant/live projection. Public internal-voice `content` remains `''`, and clean explanation is in `voiceTranscripts`. Legacy records omit the field. Do not manufacture empty arrays in durable records.
5. Artifact journal CAS precedes live sink delivery. Live receipt is not final archive publication, browser display, or heard-speech proof. Confirmed artifacts survive cancellation and publication recovery; partial candidates never become artifacts. Saved-result replay must use one assistant ID and never reinfer/re-synthesize.
6. `projectionToCanvasArtifact(projection, ownerMessageId?)`, `collectSessionCanvasArtifacts(messages, streamText, isStreaming)`, `mergeSessionCanvasArtifacts(archived, liveProjections)`, `forcedChartKindFromSubType(subType, rawSource)`, `claimNewAutoOpenArtifactId(projections, seen)`, `CANVAS_TRANSITION_MS = 320`, and focus/reduced-motion/shortcut helpers are P2's frozen exports in `frontend/src/features/canvas/canvas-artifacts.ts`/`index.ts`.
7. P2 adds `getSnapshot().conversationId`, `.artifacts`, optional `bindings.openCanvasArtifact`, and `ARTIFACT_ACCEPTED`/`CONVERSATION_BOUND`. Accepted artifacts survive interrupt/pause/user exit, but not navigation/new start into another conversation. Archive projection wins over provisional live source by stable identity without re-auto-opening a dismissed visual.
8. **Known integration risk, not P3 ownership:** L2 documents `frontend/src/api/voice-client.ts` rejecting pre-audio `response.cancelled` when no `audio.start` created its response. Test the actual client, not only `f.event()` callbacks. If still present after W2, hand back through the orchestrator, who must explicitly assign transport ownership before any owner changes it. Do not accept a fixture bypass as proof that this path works.

## Coverage and oracle rules

| AC / goal | Executable coverage | Additional evidence needed |
| --- | --- | --- |
| AC-1 / G1–G2 | Task 2 exhaustive cuts and complete/invalid corpus; Task 3 real pipeline; Task 8 queue observations, paired nonvisual control, trailing-prose suppression | Task 8 actual audible continuity, no artifact-induced gap |
| AC-2 / G4–G5 | Tasks 5–6 conversion, panel state, SSR inert/markup; Task 8 deadline miss detector | Task 8 first painted visual ≤5000 ms, actual right-slide 300–350 ms, responsive/reduced motion |
| AC-3 | Task 8 synthetic audio sample/reference trace, normal and slow scenarios | Task 8 rendered visual strictly before audible walkthrough reference on a common clock |
| AC-4 | Task 5 panel/tab closing, stable selection and unchanged media instances | Task 8 actual exit direction/duration, exit mounting/inert/focus lifecycle |
| AC-5 | Task 5 toggle/reopen/count, sticky dismissal and replay isolation | Task 8 actual keyboard/paused access, resize, media continuity and reopen behavior |
| AC-6 | Task 4 before/during/after visual and journal CAS; Task 5 local stop before blocked network | Task 8 real local silence <250 ms, accepted visual retained |
| AC-7 | Tasks 4/6 journal/checkpoint/reload and no duplicate assistant/card; follow-up input once and visual data separate from heard truth | Authorized native execution plus exit/reload browser evidence |
| AC-8 | Task 2 corpus through pipeline; Task 6 original renderers for flow/sequence/bar/line/pie/scatter/SVG and safety parity | Browser visual spot-checks of the same types, not new renderer privileges |

Use exact speech/source/ordinal equality, real durable reads and parser guards, call-count and identity assertions, and explicit nonzero discovery. Assertions that merely search source text or assert a mock was invoked are insufficient integrated evidence. New tests may pass immediately against W1/W2; do not damage production to manufacture RED. Demonstrate oracle sensitivity using deliberately invalid fixture inputs, failed publication and slow timing cases; a known timing miss may make a **detector test** pass while its recorded acceptance gate still fails.

### Task 1: Preflight, dependency handoff, and evidence ledger

**Files:** create `docs/voice-canvas-multimodal/verification.md`; read package manifests/configs and existing fixtures listed above.

- [ ] **1. Confirm W2 completion with the orchestrator.** Record all W1/W2 hashes and contract changes, or stop blocked without constructing a new source contract.
- [ ] **2. Record environment without secrets.** Run separately at repository root:

```powershell
git branch --show-current
git status --short
git rev-parse HEAD
node --version
npm --version
git log -1 --format="%h %s" -- backend/package-lock.json
git log -1 --format="%h %s" -- frontend/package-lock.json
```

Require `voice-chat-upgrade` and Node `^22.22.3 || ^24.15.0 || >=26.0.0`. Record OS, CPU/RAM, package lock hashes/versions, process parallelism, baseline HEAD, dirty paths without contents, and that fixture credentials are synthetic. Run `npm ci` separately in `backend`/`frontend` only if dependencies are absent/out of sync; do not rewrite lockfiles.

- [ ] **3. Create the evidence document using Task 9's structure.** Initially label every unrun row **planned**, all unauthorized external rows **blocked**, research/review **skipped**. Never copy this plan's expected outcomes into actual-result columns.
- [ ] **4. Verify ownership and document links**, then commit only `verification.md` as `docs(voice-canvas): open integrated verification ledger`. Coordinate this commit with the orchestrator.

### Task 2: Shared synthetic corpus and exhaustive real-filter boundaries

**Files:** create `frontend/src/features/voice/integration-tests/canvas-multimodal-fixtures.ts`; create `backend/test/voice/integration/canvas-multimodal.spec.ts`.

- [ ] **1. Write the corpus module.** No provider keys, file I/O, production imports beyond the portable descriptor type, or executable markup evaluation:

```typescript
import type { CanvasArtifactSource } from '../../../api/voice-protocol.ts';

export const SPEECH = 'Explain the concept. Follow A to B.';
export const TRAILING = 'POST_VISUAL_MUST_NOT_BE_SPOKEN';
export const VISUALS: Array<CanvasArtifactSource & { language: string }> = [
  { ordinal: 0, language: 'mermaid', kind: 'mermaid', subType: 'Flowchart',
    title: 'Flowchart', rawSource: 'flowchart TD\nA[Start] --> B[Finish]' },
  { ordinal: 0, language: 'mmd', kind: 'mermaid', subType: 'Sequence Diagram',
    title: 'Sequence Diagram', rawSource: 'sequenceDiagram\nA->>B: Hello\nB-->>A: Ready' },
  { ordinal: 0, language: 'chart', kind: 'chart', subType: 'Bar Chart',
    title: 'Bar Chart', rawSource: '{"type":"bar","labels":["A","B"],"datasets":[{"label":"Count","data":[2,3]}]}' },
  { ordinal: 0, language: 'graph', kind: 'chart', subType: 'Line Graph',
    title: 'Line Graph', rawSource: 'Mon: 42\nTue: 38\nWed: 31' },
  { ordinal: 0, language: 'chart', kind: 'chart', subType: 'Pie Chart',
    title: 'Pie Chart', rawSource: '{"type":"pie","labels":["A","B"],"datasets":[{"label":"Share","data":[60,40]}]}' },
  { ordinal: 0, language: 'scatter', kind: 'chart', subType: 'X-Y Point Plot',
    title: 'X-Y Point Plot', rawSource: 'Dog: (8, 9)\nToaster: (-4, -3)' },
  { ordinal: 0, language: 'svg', kind: 'svg', subType: 'SVG Visual',
    title: 'SVG Visual', rawSource: '<svg viewBox="0 0 80 40"><rect x="2" y="2" width="40" height="20" /></svg>' },
];

export function sourceOf(item: typeof VISUALS[number]): CanvasArtifactSource {
  return { ordinal: item.ordinal, kind: item.kind, subType: item.subType,
    title: item.title, rawSource: item.rawSource };
}
export function block(item: typeof VISUALS[number], frame: 'ticks' | 'tildes' | 'tag') {
  if (frame === 'tag') {
    const type = item.language === 'graph' || item.language === 'scatter' ? item.language : item.kind;
    return `<aurvin-canvas type="${type}" title="${item.title}">\n${item.rawSource}\n</aurvin-canvas>\n`;
  }
  const fence = frame === 'ticks' ? '```' : '~~~';
  return `${fence}${item.language} title="${item.title}"\n${item.rawSource}\n${fence}\n`;
}
export function partitions(text: string): string[][] {
  const chunks: string[] = []; let at = 0, step = 0;
  const sizes = [1, 2, 5, 13];
  while (at < text.length) { const size = sizes[step++ % sizes.length]!;
    chunks.push(text.slice(at, at + size)); at += size; }
  return [[text], text.split(''), chunks,
    ...Array.from({ length: text.length + 1 }, (_, cut) => [text.slice(0, cut), text.slice(cut)])];
}
```

`tag` framing deliberately preserves aliases whose defaults differ: untyped `graph` uses `type="graph"`, and scatter uses `type="scatter"`. Do not change the expected frozen subtype to accommodate a bad fixture.

- [ ] **2. Add the boundary suite below.** These imports/functions remain in the backend spec and are reused by later tasks:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechProse } from '../../../src/voice/agent/speech-prose.js';
import type { CanvasArtifactSource } from '../../../src/contracts/voice-wire.js';
import { VISUALS, SPEECH, TRAILING, sourceOf, block, partitions }
  from '../../../../frontend/src/features/voice/integration-tests/canvas-multimodal-fixtures.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function filtered(chunks: string[]) {
  const artifacts: CanvasArtifactSource[] = [];
  const filter = new SpeechProse(32000, a => artifacts.push(a));
  return { speech: chunks.map(c => filter.push(c)).join('') + filter.finish(), artifacts };
}
describe('Canvas multimodal boundaries', () => {
  it.each(VISUALS)('silences every cut for $subType', item => {
    for (const frame of ['ticks', 'tildes', 'tag'] as const) {
      const raw = `${SPEECH}\n${block(item, frame)}${TRAILING}`;
      for (const chunks of partitions(raw)) {
        expect(filtered(chunks)).toEqual({ speech: SPEECH, artifacts: [sourceOf(item)] });
      }
    }
  });
  it('drops partial, malformed, hidden and oversized candidates with stable ordinal gaps', () => {
    const flow = VISUALS[0]!;
    const invalid = [
      '```mermaid\nflowchart TD\nA -->',
      '~~~chart\n{"type":"bar","data":[',
      '<aurvin-canvas type="svg"><svg><rect /></svg>',
      '```chart\n{"type":"bar","data":[}\n```\n',
      '```mermaid\n\n```\n',
      `\`\`\`mermaid\nflowchart TD\nA[${'x'.repeat(8193)}] --> B\n\`\`\`\n`,
      `\`\`\`mermaid\nflowchart TD\nA[${'界'.repeat(6000)}] --> B\n\`\`\`\n`,
      '<aurvin-canvas type="svg" type="chart"><svg><rect /></svg></aurvin-canvas>\n',
      '<aurvin-canvas type="svg"><aurvin-canvas type="svg"><svg><rect /></svg></aurvin-canvas></aurvin-canvas>\n',
    ];
    for (const bad of invalid) for (const chunks of partitions(`${SPEECH}\n${bad}`)) {
      expect(filtered(chunks)).toEqual({ speech: SPEECH, artifacts: [] });
    }
    const hidden = `<think>${block(flow, 'ticks')}</think>${SPEECH}`;
    for (const chunks of partitions(hidden)) expect(filtered(chunks)).toEqual({ speech: SPEECH, artifacts: [] });
    const gap = `\`\`\`mermaid\n\n\`\`\`\n${block(flow, 'ticks')}${TRAILING}`;
    expect(filtered([`${SPEECH}\n${gap}`])).toEqual({ speech: SPEECH,
      artifacts: [{ ...sourceOf(flow), ordinal: 1 }] });
    const four = filtered([`${SPEECH}\n${block(flow, 'ticks').repeat(4)}${TRAILING}`]);
    expect(four.speech).toBe(SPEECH);
    expect(four.artifacts.map(a => a.ordinal)).toEqual([0, 1, 2]);
  });
});
```

- [ ] **3. Run focused boundaries** in `backend`: `npm test -- test/voice/integration/canvas-multimodal.spec.ts -t "Canvas multimodal boundaries"`. Require eight non-skipped tests (seven table rows plus rejection test). Record actual assertion/cut counts, not only test count.
- [ ] **4. Extend the same rejection table with concrete delimiter adversaries:** opener/header/closing run/tag truncated at each code-unit position; 4-backtick opener with a 3-backtick non-close; wrong-character close; delimiter inside a JSON string; CRLF and Unicode/split surrogate pairs; 513-char and 1025-byte headers; raw JSON/hidden tags/unsupported JavaScript; missing source metadata; supported suffix followed by unsupported code and trailing prose. Use `partitions()` for each. Assert unsupported-only silent code may still be followed by safe prose, whereas a supported candidate permanently latches silence even if rejected. Add a bounded raw-answer overflow assertion that throws rather than growing buffers. Reuse `filtered`/`partitions`, not another parser.
- [ ] **5. Commit only the new corpus and backend spec** as `test(voice-canvas): cover integrated visual corpus and chunk boundaries`.

### Task 3: Real offline runtime → durable journal → wire → browser client → controller → Canvas

**Files:** create `backend/test/voice/integration/canvas-multimodal-fixture.ts`; extend `backend/test/voice/integration/canvas-multimodal.spec.ts`.

- [ ] **1. Add this test before the helper exists**, then run `npm test -- test/voice/integration/canvas-multimodal.spec.ts -t "real pipeline"`; the initial missing test-helper import is expected RED. Once composed, production assertions may already pass. Do not mock the runtime, filter, delivery writer, adapter, wire parser, client, reducer or Canvas converter.

```typescript
// Add to canvas-multimodal.spec.ts imports.
import { canvasPipeline } from './canvas-multimodal-fixture.js';
import { collectSessionCanvasArtifacts, mergeSessionCanvasArtifacts, projectionToCanvasArtifact }
  from '../../../../frontend/src/features/canvas/canvas-artifacts.js';

it.each(VISUALS)('real pipeline keeps $subType silent and linked before provider EOF', async item => {
  vi.useFakeTimers();
  const f = await canvasPipeline();
  try {
    await f.begin();
    for (const piece of `${SPEECH}\n${block(item, 'ticks')}`.split('')) await f.push(piece);
    await f.until(() => f.ui.controller.getSnapshot().artifacts.length === 1);
    expect(f.events.some(e => e.type === 'audio.start')).toBe(false);
    const event = f.events.find(e => e.type === 'canvas.artifact')!;
    const journal = await f.delivery();
    expect(journal?.canvasArtifacts).toEqual(f.ui.controller.getSnapshot().artifacts);
    expect(f.trace.indexOf('artifact-committed')).toBeLessThan(f.trace.indexOf('artifact-sent'));
    expect(projectionToCanvasArtifact(journal!.canvasArtifacts![0]!)?.rawSource).toBe(item.rawSource);
    expect(vi.mocked(f.tts.connection.speak).mock.calls.map(([c]) => c.text).join('')).toBe(SPEECH);
    expect(event.type).toBe('canvas.artifact');
    await f.push(TRAILING); await f.endModel(); await f.finishAudio();
    const rows = await f.messages();
    const assistant = rows.filter(m => m.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.content).toBe(SPEECH);
    expect(assistant[0]!.canvasArtifacts).toEqual(journal!.canvasArtifacts);
    expect((await f.delivery())!.textGenerated).toBe(SPEECH);
    expect(f.h.fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(f.h.fetcher.mock.calls[0]![1]!.body)).user).toBe(f.h.identity.openRouterUser);
  } finally { await f.close(); }
}, 30000);
```

- [ ] **2. Implement only the named test helper**, using the following complete relay core. Existing `liveVoiceFixture` supplies real playback/FakeContext and capture spies; replace its client with the **real** `VoiceClient`, and connect that client's fake socket to the **real** backend connection. Direct `f.ui.event()` is not the transport used here.

```typescript
import { expect, vi } from 'vitest';
import { textConfigFixture } from '../../runtime/text-config-fixture.js';
import { liveConfigSnapshot } from './integrated-fixture.js';
import { options, origin, request, fakeStt, fakeTts } from '../session/fixtures.js';
import { FakeSocket as ServerSocket, settle } from '../transport/fixtures.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { VoiceConnection } from '../../../src/voice/transport/voice-connection.js';
import { AgentVoiceAdapter } from '../../../src/voice/agent/agent-voice-adapter.js';
import { LiveFlow } from '../../../src/voice/session/live-flow.js';
import { ServerIdentityResolver } from '../../../src/platform/identity/server-identity-resolver.js';
import { chunk, usage, done } from '../../fixtures/openrouter/frames.js';
import { attemptsFor, archiveRecords } from '../../../src/chat-runtime/history.js';
import { parseVoiceControl, type VoiceServerEvent } from '../../../src/contracts/voice-wire.js';
import { liveVoiceFixture } from '../../../../frontend/src/features/voice/state/testing/live-voice-fixture.js';
import { FakeSocket as BrowserSocket } from '../../../../frontend/src/features/voice/transport/testing/voice-fakes.js';
import { VoiceClient } from '../../../../frontend/src/api/voice-client.js';

export async function canvasPipeline() {
  const h = textConfigFixture(liveConfigSnapshot());
  const stt = fakeStt(), tts = fakeTts(), server = new ServerSocket(), browser = new BrowserSocket();
  const trace: string[] = [], events: VoiceServerEvent[] = [];
  const opened = vi.fn();
  let stream!: ReadableStreamDefaultController<Uint8Array>, modelClosed = false;
  let fetched = false, serial = 0, started = false, samples = 0;
  const body = new ReadableStream<Uint8Array>({ start(c) { stream = c; } });
  h.fetcher.mockImplementationOnce(async () => { fetched = true; return new Response(body,
    { headers: { 'content-type': 'text/event-stream' } }); });
  const compare = h.p.metadata.compareVoiceDelivery.bind(h.p.metadata);
  h.p.metadata.compareVoiceDelivery = async (r, n) => {
    const ok = await compare(r, n);
    if (ok && r.canvasArtifacts?.length) trace.push('artifact-committed');
    return ok;
  };
  const o = options();
  o.identity = new ServerIdentityResolver({ identity: { userId: h.identity.userId } });
  o.currentConfig = h.currentConfig; o.sessions = h.p.sessions; o.reservations = h.runtime.reservations;
  let bridge!: AgentVoiceAdapter, flow!: LiveFlow;
  const sessions = new VoiceSessionService(o);
  o.open = async (context, sink, signal) => {
    bridge = new AgentVoiceAdapter(h.runtime, (v, s) => sessions.bindConversation(v, s));
    flow = await LiveFlow.open(context, sink, signal, { stt: stt.port, tts: tts.port,
      hooks: bridge.hooks, usage: o.usage });
    bridge.attach(context, flow, sink); return flow;
  };
  const created = await sessions.create({ ...request, mode: 'live' }, origin);
  const binding = sessions.claim(created.cookie.split(';')[0], origin);
  const connection = new VoiceConnection(sessions, binding, server);
  const ui = liveVoiceFixture({
    http: { create: async () => ({ ...created.response }), end: async id => { await sessions.end(id); } },
    bindings: { claimVoiceInput: vi.fn(() => 'canvas-lease'), writeVoiceDraft: vi.fn(() => true),
      releaseVoiceInput: vi.fn(), bindVoiceConversation: vi.fn(() => true), refreshSessions: vi.fn(),
      openCanvasArtifact: opened },
    client: callbacks => new VoiceClient({ ...callbacks, pageUrl: origin,
      socket: () => browser.asSocket(), id: () => `canvas-client-${serial++}` }),
  });
  browser.send = data => { connection.receive(typeof data === 'string' ? Buffer.from(data) : data, typeof data !== 'string'); };
  server.send.mockImplementation(data => {
    if (typeof data === 'string') {
      const event = parseVoiceControl(data, 'server', 'live');
      events.push(event);
      if (event.type === 'canvas.artifact') trace.push('artifact-sent');
      browser.receive(data);
    } else {
      const copy = Uint8Array.from(data);
      browser.receive(copy.buffer);
    }
  });
  const tick = async (ms = 0) => {
    let remaining = ms;
    do {
      const step = Math.min(10, remaining);
      ui.context.currentTime += step / 1000;
      await vi.advanceTimersByTimeAsync(step); await settle();
      remaining -= step;
    } while (remaining > 0);
  };
  const until = async (predicate: () => boolean) => {
    for (let n = 0; n < 100 && !predicate(); n++) await tick();
    expect(predicate()).toBe(true);
  };
  const ref = () => { const value = bridge.currentResponse();
    if (!value) throw new Error('Expected active fixture response'); return value; };
  const delivery = async () => {
    const s = binding.response.conversationId;
    if (!s) return null;
    const a = (await attemptsFor(h.p, h.identity.userId, s)).at(-1);
    return a ? h.p.metadata.getVoiceDelivery(h.identity.userId, s, a.attemptId) : null;
  };
  const audio = async (count = 2400) => {
    const r = ref();
    if (!started) { tts.events.push({ type: 'speech-started', ...r, speechId: 'canvas-speech' }); started = true; }
    const pcm = new Uint8Array(count * 2), view = new DataView(pcm.buffer);
    for (let n = 0; n < count; n++) view.setInt16(n * 2, n % 24 < 12 ? 4000 : -4000, true);
    samples += count; tts.events.push({ type: 'audio', ...r, pcm }); await tick();
  };
  const push = async (text: string) => { stream.enqueue(new TextEncoder().encode(chunk(text))); await tick(); };
  const endModel = async () => {
    if (!modelClosed) { stream.enqueue(new TextEncoder().encode(chunk('', 'stop') + usage + done));
      stream.close(); modelClosed = true; }
    await tick();
  };
  return { h, ui, server, browser, connection, sessions, binding, stt, tts, events, trace, opened,
    tick, until, ref, delivery, audio, push, endModel,
    bridge: () => bridge, flow: () => flow,
    begin: async () => {
      await ui.controller.start({ text: 'Unsent original', start: 0, end: 0, direction: 'none' }, null, ui.config);
      browser.open(); await until(() => ui.controller.getSnapshot().phase === 'active');
      stt.events.push({ type: 'end-of-turn', providerTurnId: 'canvas-input-1', text: 'Explain the path.' });
      await until(() => fetched);
    },
    messages: () => archiveRecords(h.p, h.identity.userId, binding.response.conversationId!),
    finishAudio: async () => {
      if (!samples) await audio();
      const r = ref();
      tts.events.push({ type: 'speech-completed', ...r, speechId: 'canvas-speech',
        audioDurationMs: samples / 24, usage: { providerRequestId: null, model: 'fixture',
          modelVersion: null, audioMs: samples / 24,
          billableCharacters: vi.mocked(tts.connection.speak).mock.calls.reduce((n, [c]) => n + c.text.length, 0) } });
      await tick(samples / 24 + 500); await until(() => bridge.currentResponse() === null);
    },
    crashStream: async () => { if (!modelClosed) { stream.error(new Error('fixture provider disconnected'));
      modelClosed = true; } await tick(); },
    close: async () => {
      ui.controller.exit(); await tick(2500);
      try { await connection.dispose(); await sessions.drain(); }
      finally { await h.dispose(); }
    },
  };
}
```

Keep helper construction cleanup fail-safe: wrap initialization after the connection is created in `try/catch`; on error, `try { await connection.dispose(); await sessions.drain(); } finally { await h.dispose(); }`, then rethrow the original initialization error. Do not leave resources running when a genuine integration assertion fails. `tick()` advances both virtual clocks in 10 ms steps; it is not measured real time. `finishAudio` uses the actual cumulative audio duration plus a finite drain allowance.

- [ ] **3. Run the real-pipeline table** in `backend`: `npm test -- test/voice/integration/canvas-multimodal.spec.ts -t "real pipeline"`. Require seven executed rows and matching source bytes/IDs. If a cross-package test-only import needs an explicit source extension for Vite, resolve it inside the P3 fixture only; do not change package/tsconfig or pull backend imports into the frontend build.
- [ ] **4. Repeat the real chain for tilde and wrapper framing** using the corpus, plus ordinal gap 0-discarded/1-accepted, two different complete artifacts, and the fourth candidate silently rejected. Test actual event JSON through both portable guards and assert dictation/client-direction parsing rejects it. Assert emitted maximum legal event remains below 131072 UTF-8 bytes and cap+1 fails. Reuse W1 caps; also reject aggregate source/projection limits without enlarging message, raw-answer or audio budgets.
- [ ] **5. Commit only the relay helper and backend spec** as `test(voice-canvas): join real runtime and frontend artifact pipeline`.

### Task 4: Interrupt/failure matrix, checkpoint replay and honest follow-up context

**Files:** extend `backend/test/voice/integration/canvas-multimodal.spec.ts` and its named relay helper only if a local control hook is necessary.

- [ ] **1. Add this parametrized before/during/after test.** Backend STT `start-of-turn` exercises actual barge-in, including pre-audio cancellation. Also retain a separate client Stop-speaking test in Task 5.

```typescript
it.each(['before', 'during', 'after'] as const)('interrupt %s visual keeps only confirmed complete source', async phase => {
  vi.useFakeTimers(); const f = await canvasPipeline();
  try {
    await f.begin(); await f.push(`${SPEECH}\n`);
    const framed = block(VISUALS[0]!, 'ticks');
    if (phase === 'during') await f.push(framed.slice(0, -5));
    if (phase === 'after') {
      await f.push(framed);
      await f.until(() => f.ui.controller.getSnapshot().artifacts.length === 1);
    }
    const retained = structuredClone(f.ui.controller.getSnapshot().artifacts);
    f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'barge-in-2' });
    await f.tick(2500);
    await f.until(() => f.bridge().currentResponse() === null);
    expect(f.ui.controller.getSnapshot().artifacts).toEqual(retained);
    expect(retained).toHaveLength(phase === 'after' ? 1 : 0);
    const s = f.binding.response.conversationId!;
    await f.h.runtime.reconcileSession(f.h.identity.userId, s);
    await f.h.runtime.reconcileSession(f.h.identity.userId, s);
    const assistants = (await f.messages()).filter(m => m.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.canvasArtifacts ?? []).toEqual(retained);
    expect(f.h.fetcher).toHaveBeenCalledTimes(1);
    expect(f.ui.controller.getSnapshot().errorCode).not.toBe('VOICE_INVALID_STATE');
  } finally { await f.close(); }
}, 30000);
```

- [ ] **2. Run** `npm test -- test/voice/integration/canvas-multimodal.spec.ts -t "interrupt .* visual"`. A real pre-audio `VOICE_INVALID_STATE` is a blocking owner defect, not permission to remove `VoiceClient` from the relay.
- [ ] **3. Add a deferred-CAS test with actual persistence confirmation.** Wrap `f.h.p.metadata.compareVoiceDelivery` after `begin`, returning a gate only when `canvasArtifacts` first appears. Start `const writing = f.push(block(VISUALS[0]!, 'ticks'))` without awaiting it, wait for gate entry, inject STT start-of-turn, then release the gate and await `writing`. Assert no `canvas.artifact` arrived after cancellation, microphone `flow.input(new Uint8Array(2560))` still reaches `stt.connection.writeAudio` before the gate resolves, and after reconciliation exactly one journal-confirmed artifact survives in one assistant. This covers invalidation during a started CAS, not an invented rollback.

Use this local gate pattern inside the test; restore the spy/release it in `finally`:

```typescript
it('interrupt during artifact CAS keeps confirmed evidence but emits no late visual', async () => {
  vi.useFakeTimers(); const f = await canvasPipeline();
  let release!: () => void, entered = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let blocked: { mockRestore(): void } | undefined;
  try {
    await f.begin(); await f.push(`${SPEECH}\n`);
    const compare = f.h.p.metadata.compareVoiceDelivery.bind(f.h.p.metadata);
    blocked = vi.spyOn(f.h.p.metadata, 'compareVoiceDelivery').mockImplementation(async (record, n) => {
      if (record.canvasArtifacts?.length && !entered) { entered = true; await gate; }
      return compare(record, n);
    });
    const writing = f.push(block(VISUALS[0]!, 'ticks'));
    await f.until(() => entered);
    f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'interrupt-during-cas' });
    f.ui.frame();
    await f.until(() => vi.mocked(f.stt.connection.writeAudio).mock.calls.length === 1);
    expect(f.events.filter(e => e.type === 'canvas.artifact')).toEqual([]);
    release(); await writing; await f.tick(2500);
    await f.until(() => f.bridge().currentResponse() === null);
    const s = f.binding.response.conversationId!;
    await f.h.runtime.reconcileSession(f.h.identity.userId, s);
    const assistants = (await f.messages()).filter(m => m.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]!.canvasArtifacts).toEqual((await f.delivery())!.canvasArtifacts);
    expect(assistants[0]!.canvasArtifacts).toHaveLength(1);
    expect(f.events.filter(e => e.type === 'canvas.artifact')).toEqual([]);
    expect(f.h.fetcher).toHaveBeenCalledTimes(1);
  } finally { release(); blocked?.mockRestore(); await f.close(); }
});
```

- [ ] **4. Add journal/sink failure injection as independent cases**, using a real completed first artifact and a partial second candidate. `vi.spyOn(f.h.p.metadata, 'compareVoiceDelivery')` rejects the first artifact admission: assert zero artifact events and explicit failed/unknown terminal evidence, not a saved badge. In a different case, make `server.send` throw **only on the artifact event after confirmed CAS**; then dispose that connection, reconcile twice, and assert the confirmed source remains in exactly one assistant without a second `fetcher`/TTS call. A compare-write timeout that may have committed must be reconciled from the stored journal, never inferred from the rejected promise alone.
- [ ] **5. Add sealed-result publication failure/restart assertions.** Inject assistant `messages.append` failure before completing the model. Inspect the real saved graph after execution has stopped; require `values.sealed` and `values.result.assistant.canvasArtifacts` equal the journal for the sealed case. Restore append, call the existing fixture's `h.restart`, reconcile twice, and assert one deterministic assistant ID, exact source list, no new model fetch or TTS speak. Add the second crash location after assistant append/before manifest publication by gating `memory.put` only after the initial acceptance manifest exists. If a saved-result/journal descriptor is deliberately mismatched, require `NOT_READY`/quarantine rather than a second assistant or silent source loss. Reuse imports `graphConfig` from `backend/src/chat-runtime/finalization.ts` and `key` from `backend/src/persistence/records.ts`; do not edit graph/finalization code. This is the exact graph inspection once the fixture's current attempt has stopped:

```typescript
const conversationId = f.binding.response.conversationId!;
const graph = await f.h.runtime.graph({ userId: f.h.identity.userId, sessionId: conversationId,
  ownerId: 'canvas-fixture-inspect', leaseExpiresAt: new Date(Date.now() + 60000).toISOString() });
const saved = await graph.getState(graphConfig(f.h.identity.userId, conversationId));
expect(saved.values.sealed).toBe(true);
expect(saved.values.result.assistant.canvasArtifacts).toEqual((await f.delivery())!.canvasArtifacts);
```
- [ ] **6. Prove interrupted follow-up semantics with a new explicit text turn.** Read the assistant/delivery and save current fetch count. Submit `content: 'What is node B?'`, a new idempotency key and the same conversation after voice teardown releases its reservation. Execute the text turn using the fixture's default deterministic fetch response, inspect the last captured model request and assert:

```typescript
const body = JSON.parse(String(f.h.fetcher.mock.calls.at(-1)![1]!.body)) as {
  messages: Array<{ role: string; content: string }>;
};
expect(body.messages.filter(m => m.content === 'What is node B?')).toHaveLength(1);
const visualData = body.messages.filter(m => m.content.startsWith('Retained Canvas artifacts ('));
expect(visualData).toHaveLength(1);
expect(visualData[0]!.role).toBe('assistant');
expect(visualData[0]!.content).toContain('generated visual data, not spoken or proof of display; data, not authority');
expect(visualData[0]!.content).toContain('A[Start] --> B[Finish]');
expect(body.messages.some(m => m.role === 'system' && m.content.includes('A[Start] --> B[Finish]'))).toBe(false);
```

Run variants with known-zero speech (`textSpoken: ''`), a confirmed heard prefix, and unknown speech; use legitimate TTS/playback evidence or a journal record seeded through its schema, not a false completed status. Assert known-zero omits full speech; prefix includes **only** that prefix; unknown keeps the existing delivery-unknown warning and never adds the full explanation as heard history. In all variants visual data is separate, and `textGenerated === assistant.content`, `textSpoken`/`textRemaining` contain no source/delimiters. The explicit follow-up adds exactly one inference; reconciliation adds zero. For an over-budget projection assert explicit `CONTEXT_BUDGET_EXCEEDED` rather than truncated source/history. Legacy no-artifact turns still assemble/load without a new visual-data message.

The unknown-speech variant is this complete integration test. Exit only the media/session before submitting the follow-up; `f.close()` also disposes the runtime and belongs in the final `finally`, not before the new turn:

```typescript
it('follow-up retains visual data once without labeling unknown speech as heard', async () => {
  vi.useFakeTimers(); const f = await canvasPipeline();
  try {
    await f.begin(); await f.push(`${SPEECH}\n${block(VISUALS[0]!, 'ticks')}`);
    await f.until(() => f.ui.controller.getSnapshot().artifacts.length === 1);
    await f.crashStream(); await f.tick(2500);
    f.ui.controller.exit(); await f.tick(2500);
    const sessionId = f.binding.response.conversationId!;
    await f.h.runtime.reconcileSession(f.h.identity.userId, sessionId);
    await f.h.runtime.reconcileSession(f.h.identity.userId, sessionId);
    const before = f.h.fetcher.mock.calls.length;
    expect(before).toBe(1);
    const next = await f.h.runtime.submitTurn({ identity: f.h.identity, sessionId,
      content: 'What is node B?', idempotencyKey: 'canvas-follow-up-1' });
    await f.h.execute(next);
    expect(f.h.fetcher).toHaveBeenCalledTimes(before + 1);
    const request = JSON.parse(String(f.h.fetcher.mock.calls.at(-1)![1]!.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const visuals = request.messages.filter(m => m.content.startsWith('Retained Canvas artifacts ('));
    expect(visuals).toHaveLength(1); expect(visuals[0]!.role).toBe('assistant');
    expect(visuals[0]!.content).toContain('not spoken or proof of display');
    expect(visuals[0]!.content).toContain('A[Start] --> B[Finish]');
    expect(request.messages.filter(m => m.content === 'What is node B?')).toHaveLength(1);
    expect(request.messages.some(m => m.role === 'assistant' && m.content === SPEECH)).toBe(false);
    expect(request.messages.some(m => m.content.includes('delivery is unknown'))).toBe(true);
  } finally { await f.close(); }
});
```
- [ ] **7. Run the whole offline integration spec**, record results, route any failing application behavior to W1/W2, and commit only owned tests/helper as `test(voice-canvas): verify interruption publication and context recovery`.

### Task 5: Frontend event isolation, dismissal/controls, media identity and local stop

**Files:** create `frontend/src/features/voice/integration-tests/canvas-multimodal.test.ts`; reuse the named corpus, `liveVoiceFixture`, `matrixFixture`, chat reducer and P2 helpers read-only.

- [ ] **1. Start the new frontend suite with these imports and receiver/state test.** Use actual payload validation before handing external data to `callbacks.event`; malformed input belongs to parser rejection, whereas well-shaped stale/cancelled/duplicate input belongs to controller fencing.

```typescript
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { liveVoiceFixture, settle } from '../state/testing/live-voice-fixture.ts';
import { VISUALS, SPEECH, sourceOf } from './canvas-multimodal-fixtures.ts';
import { parseVoiceControl, type CanvasArtifactProjection, type VoiceServerPayload }
  from '../../../api/voice-protocol.ts';
import type { VisibleMessage } from '../../../api/protocol.ts';
import { chatReducer, initialChatState } from '../../chat/state/chat-reducer.ts';
import { collectSessionCanvasArtifacts, mergeSessionCanvasArtifacts, projectionToCanvasArtifact,
  forcedChartKindFromSubType } from '../../canvas/canvas-artifacts.ts';
import { CanvasPanel, ChartRenderer, MermaidRenderer, SvgRenderer } from '../../canvas/index.ts';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const projection = (responseId = 'response-1', ordinal = 0): CanvasArtifactProjection =>
  ({ responseId, ...sourceOf(VISUALS[0]!), ordinal });
const artifactEvent = (responseId = 'response-1', ordinal = 0): VoiceServerPayload =>
  ({ type: 'canvas.artifact', turnId: `turn-${responseId}`, ...projection(responseId, ordinal) });

it('retains pre-audio visuals once, fences cancelled/stale turns and isolates conversations', async () => {
  const openCanvasArtifact = vi.fn();
  const f = liveVoiceFixture({ bindings: { claimVoiceInput: vi.fn(() => 'lease-1'),
    writeVoiceDraft: vi.fn(() => true), releaseVoiceInput: vi.fn(), bindVoiceConversation: vi.fn(() => true),
    refreshSessions: vi.fn(), openCanvasArtifact } });
  try {
    await f.begin(); f.event({ type: 'conversation.bound', conversationId: 'conversation-1' });
    f.event(artifactEvent()); f.event(artifactEvent());
    expect(f.controller.getSnapshot().response).toBeNull();
    expect(f.controller.getSnapshot().artifacts).toEqual([projection()]);
    expect(openCanvasArtifact).toHaveBeenCalledExactlyOnceWith('response-1::canvas::0');
    f.event({ type: 'response.cancelled', turnId: 'turn-response-1', responseId: 'response-1', lastAudioSequence: null });
    f.event(artifactEvent('response-1', 1));
    f.event(artifactEvent('response-2'), f.response.connectionEpoch - 1);
    expect(f.controller.getSnapshot().artifacts).toEqual([projection()]);
    f.event(artifactEvent('response-2')); f.event(artifactEvent('response-1', 2));
    expect(f.controller.getSnapshot().artifacts).toEqual([projection(), projection('response-2')]);
    f.controller.exit('navigation'); await settle();
    expect(f.controller.getSnapshot().artifacts).toEqual([]);
    expect(f.controller.getSnapshot().conversationId).toBeNull();
  } finally { f.controller.exit(); await settle(); }
});
```

- [ ] **2. Run** `npm test -- src/features/voice/integration-tests/canvas-multimodal.test.ts -t "retains pre-audio"` in `frontend`. Add table rows for duplicate same wire sequence (through real `VoiceClient` in backend relay), fresh sequence/same identity, conflicting same ordinal, descending ordinal, gaps, same response/wrong turn, stale old epoch, future epoch (client errors, not silent acceptance), wrong voice session, missing conversation binding, retired turn, pause/loss, multi-turn and new conversation start. Reject unknown kind, over-budget control, invalid IDs, malformed archive and aggregate-over-budget list through actual portable guards. Do not expect a malformed wire event to leave the transport healthy if its defined policy is fail-closed; controller callback tests and transport tests assert their distinct policies.

```typescript
it('portable receiver rejects malformed and oversized visuals outside the live server channel', () => {
  const event = { protocolVersion: 1, sessionId: 'voice-1', connectionEpoch: 1,
    eventId: 'event-1', sequence: 1, ...artifactEvent() };
  expect(parseVoiceControl(JSON.stringify(event), 'server', 'live')).toEqual(event);
  expect(() => parseVoiceControl(JSON.stringify(event), 'server', 'dictation')).toThrow('INVALID_VOICE_CONTROL');
  expect(() => parseVoiceControl(JSON.stringify(event), 'client', 'live')).toThrow('INVALID_VOICE_CONTROL');
  for (const patch of [{ kind: 'graph' }, { ordinal: 3 }, { responseId: 'bad id' }, { turnId: '' },
    { title: 'x'.repeat(121) }, { rawSource: '界'.repeat(6000) }, { rawSource: 'x'.repeat(8193) }, { extra: true }]) {
    expect(() => parseVoiceControl(JSON.stringify({ ...event, ...patch }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
  }
  const json = JSON.stringify(event);
  const padded = json + ' '.repeat(131072 - new TextEncoder().encode(json).byteLength);
  expect(parseVoiceControl(padded, 'server', 'live')).toEqual(event);
  expect(() => parseVoiceControl(padded + ' ', 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
});
```
- [ ] **3. Add the dismissal/media-identity test below.** This is real state/action composition but not proof that a React mounted tree never remounts; Task 8 covers that last distinction.

```typescript
it('close reopen tab and replay keep count, selection and media resources stable', async () => {
  let chat = { ...initialChatState };
  const open = vi.fn((id: string) => { chat = chatReducer(chat,
    { type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId: id } }); });
  const f = liveVoiceFixture({ bindings: { claimVoiceInput: vi.fn(() => 'lease-1'),
    writeVoiceDraft: vi.fn(() => true), releaseVoiceInput: vi.fn(), bindVoiceConversation: vi.fn(() => true),
    refreshSessions: vi.fn(), openCanvasArtifact: open } });
  try {
    await f.begin(); f.event({ type: 'conversation.bound', conversationId: 'conversation-1' });
    const capture = f.capture, playback = f.playback, socket = f.client;
    const muteCalls = f.capture.setMuted.mock.calls.length;
    f.event(artifactEvent());
    expect(chat.canvasOpen).toBe(true);
    chat = chatReducer(chat, { type: 'CLOSE_CANVAS' });
    f.event(artifactEvent()); f.listening();
    expect(chat.canvasOpen).toBe(false);
    f.event(artifactEvent('response-2'));
    expect(chat.canvasOpen).toBe(true);
    let list = mergeSessionCanvasArtifacts([], f.controller.getSnapshot().artifacts);
    expect(list).toHaveLength(2);
    chat = chatReducer(chat, { type: 'CLOSE_CANVAS_TAB', payload: {
      artifactId: 'response-2::canvas::0', fallbackArtifactId: 'response-1::canvas::0' } });
    expect(chat.canvasOpen).toBe(true);
    chat = chatReducer(chat, { type: 'CLOSE_CANVAS_TAB', payload: {
      artifactId: 'response-1::canvas::0', fallbackArtifactId: null } });
    expect(chat.canvasOpen).toBe(false);
    chat = chatReducer(chat, { type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId: 'response-1::canvas::0' } });
    expect(chat.activeCanvasArtifactId).toBe('response-1::canvas::0');
    list = mergeSessionCanvasArtifacts([], f.controller.getSnapshot().artifacts);
    expect(list).toHaveLength(2); // Closing is not deletion.
    expect(f.capture).toBe(capture); expect(f.playback).toBe(playback); expect(f.client).toBe(socket);
    expect(f.capture.start).toHaveBeenCalledTimes(1);
    expect(f.capture.stop).not.toHaveBeenCalled(); expect(f.client.dispose).not.toHaveBeenCalled();
    expect(f.capture.setMuted).toHaveBeenCalledTimes(muteCalls);
    expect(f.context.close).not.toHaveBeenCalled();
  } finally { f.controller.exit(); await settle(); }
});
```

- [ ] **4. Add local stop-before-network proof.** Use the real playback service and nonzero PCM. Advance its clock beyond the existing 100 ms startup reserve before interrupting, not to a point where output has not begun. This deterministic check is not the <250 ms physical-audio certificate:

```typescript
it('stops local audio before a failed network interrupt and retains the visual', async () => {
  const f = liveVoiceFixture();
  try {
    await f.begin(); f.event({ type: 'conversation.bound', conversationId: 'conversation-1' });
    f.event(artifactEvent());
    const ref = { turnId: 'turn-response-1', responseId: 'response-1' };
    f.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0 });
    const pcm = new Uint8Array(4800); pcm.fill(16);
    f.callbacks().audio?.({ kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm }, ref);
    f.context.currentTime = 0.15;
    const source = f.context.sources[0]!;
    expect(source.start).toHaveBeenCalled();
    const retained = structuredClone(f.controller.getSnapshot().artifacts);
    f.client.control.mockImplementation(event => {
      if (event.type === 'response.interrupt') {
        expect(source.stop).toHaveBeenCalledTimes(1);
        return false;
      }
      return true;
    });
    f.controller.interrupt();
    expect(source.stop).toHaveBeenCalledTimes(1);
    expect(f.client.invalidate).toHaveBeenCalledWith('response-1');
    expect(f.controller.getSnapshot().artifacts).toEqual(retained);
    f.callbacks().audio?.({ kind: 2, flags: 0, sequence: 1, offsetMs: 100, pcm }, ref);
    expect(f.context.sources).toHaveLength(1);
  } finally { f.controller.exit(); await settle(); }
});
```

Include stop after complete visual, mid-partial-visual (no card) and paused reopening. Keep separate server-gated cancellation evidence from Task 4 to prove storage/network latency never gates local node stopping.
- [ ] **5. Add Node markup/accessibility checks using P2's exact frozen props.** `LiveVoicePanel.canvas` is `{ artifactCount, open, onToggle, toggleRef? }`; do not invent `isOpen`/`count` props. CSS/SSR checks are supplemental only; Task 8 measures actual movement, mounting and focus:

```typescript
import { LiveVoicePanel } from '../live/LiveVoicePanel.tsx';
import { initialLiveVoice } from '../state/live-voice-reducer.ts';
import { CANVAS_TRANSITION_MS, handleLiveCanvasShortcut, prefersReducedCanvasMotion,
  restoreCanvasCloseFocus } from '../../canvas/canvas-artifacts.ts';

it('live controls and exiting Canvas expose paused keyboard and focus-safe semantics', () => {
  const onToggle = vi.fn();
  const view = { ...initialLiveVoice, phase: 'active' as const, connection: 'connected' as const,
    agent: 'speaking' as const, response: { turnId: 'turn-response-1', responseId: 'response-1' },
    conversationId: 'conversation-1', artifacts: [projection()] };
  const voice = { view, start: vi.fn(), toggleMute: vi.fn(), interrupt: vi.fn(), exit: vi.fn(), resume: vi.fn() };
  const speaking = renderToStaticMarkup(createElement(LiveVoicePanel,
    { voice, canvas: { artifactCount: 1, open: true, onToggle } }));
  expect(speaking).toContain('aria-label="Stop speaking"');
  expect(speaking).toContain('aria-label="Close Canvas (1)"');
  expect(speaking).toContain('aria-expanded="true"');
  expect(speaking).toContain('aria-controls="aurvin-canvas-panel"');
  const paused = renderToStaticMarkup(createElement(LiveVoicePanel, {
    voice: { ...voice, view: { ...view, phase: 'suspended', resumeRequired: true, response: null } },
    canvas: { artifactCount: 1, open: false, onToggle },
  }));
  expect(paused).toContain('aria-label="Open Canvas (1)"');
  const empty = renderToStaticMarkup(createElement(LiveVoicePanel,
    { voice, canvas: { artifactCount: 0, open: false, onToggle } }));
  expect(empty).not.toContain('aria-controls="aurvin-canvas-panel"');
  const a = projectionToCanvasArtifact(projection())!;
  const exiting = renderToStaticMarkup(createElement(CanvasPanel, { artifacts: [a], activeArtifactId: a.artifactId,
    onSelectArtifact: () => {}, onCloseTab: () => {}, onClosePanel: () => {}, transitionState: 'exiting' }));
  expect(exiting).toContain('inert=""'); expect(exiting).toContain('aria-hidden="true"');
  expect(CANVAS_TRANSITION_MS).toBeGreaterThanOrEqual(300); expect(CANVAS_TRANSITION_MS).toBeLessThanOrEqual(350);
  expect(prefersReducedCanvasMotion({ matchMedia: () => ({ matches: true }) })).toBe(true);
  const focus = vi.fn(); restoreCanvasCloseFocus({ liveActive: true, liveCanvasToggle: { focus } as unknown as HTMLElement });
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  const key = { key: 'c', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
    repeat: false, defaultPrevented: false, isComposing: false, target: null, preventDefault: vi.fn() };
  expect(handleLiveCanvasShortcut(key, { artifactCount: 1, onToggle })).toBe(true);
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(handleLiveCanvasShortcut({ ...key, isComposing: true }, { artifactCount: 1, onToggle })).toBe(false);
  expect(handleLiveCanvasShortcut({ ...key, target: { closest: () => ({}) } as unknown as EventTarget },
    { artifactCount: 1, onToggle })).toBe(false);
});
```
- [ ] **6. Run the new frontend integration file** and commit only it as `test(voice-canvas): verify live artifact controls isolation and interruption`.

### Task 6: Renderer safety parity and archive exit/reload deduplication

**Files:** extend `frontend/src/features/voice/integration-tests/canvas-multimodal.test.ts` and backend integration spec only.

- [ ] **1. Add actual Canvas render parity to the frontend integration suite.** Render projections using the existing `CanvasPanel` so subtype forcing is applied by the real panel. Also compare direct original renderers for matching safe sources; do not replace renderer functions with spies or equate parse success with render success.

```typescript
it.each(VISUALS)('renders $subType through the existing Canvas path', item => {
  const p = { responseId: 'render-response', ...sourceOf(item) };
  const a = projectionToCanvasArtifact(p)!;
  expect(a).not.toBeNull(); expect(a.rawSource).toBe(item.rawSource);
  const html = renderToStaticMarkup(createElement(CanvasPanel, { artifacts: [a],
    activeArtifactId: a.artifactId, onSelectArtifact: () => {}, onCloseTab: () => {}, onClosePanel: () => {} }));
  expect(html).toContain('<svg'); expect(html).toContain(item.title);
  if (item.language === 'graph') {
    expect(forcedChartKindFromSubType(a.subType, a.rawSource)).toBe('line');
    expect(html).toContain('<path');
  }
});
it('preserves SVG safety and keeps malicious labels inert in every renderer', () => {
  const unsafe = '<svg viewBox="0 0 80 40"><script>EXECUTE_ME()</script><foreignObject><div>BAD_HTML</div></foreignObject>' +
    '<image href="https://invalid.example/tracker"/><rect onload="EXECUTE_ME()" style="fill:url(https://invalid.example/tracker)" ' +
    'fill="url(https://invalid.example/tracker)" x="2" y="2" width="20" height="20"/></svg>';
  const html = renderToStaticMarkup(createElement(SvgRenderer, { source: unsafe, title: 'Safe' }));
  expect(html).toContain('<rect');
  expect(html).not.toMatch(/<script|foreignObject|<image|onload=|EXECUTE_ME|BAD_HTML|invalid\.example|javascript:|data:/i);
  const chart = renderToStaticMarkup(createElement(ChartRenderer, {
    source: '{"type":"bar","labels":["<script>LABEL</script>"],"datasets":[{"label":"Count","data":[1]}]}', title: 'Chart' }));
  expect(chart).not.toContain('<script>'); expect(chart).toContain('&lt;script&gt;');
  const mermaid = renderToStaticMarkup(createElement(MermaidRenderer, {
    source: 'flowchart TD\nA[<script>LABEL</script>] --> B[Safe]', title: 'Diagram' }));
  expect(mermaid).not.toContain('<script>');
  expect(mermaid).not.toMatch(/href="https?:|onclick=/i);
});
```

The external SVG `fill="url(...)"` assertion deliberately tests the safety requirement, not only parity with an existing weakness. If the existing allowlist still allows an external paint URL, report it to the orchestrator/P2 owner for explicit renderer-path ownership before a fix. P3 must not weaken the assertion to match unsafe baseline output. Compare text and voice rendering of the same unsafe source; neither may gain fetch/script privileges. Add dangerous event attributes, `href`/`xlink:href`, `javascript:`/`data:`, CSS URL, script/foreignObject, and malformed-only SVG with no drawable child. Structurally transported but unrenderable source yields no broken live card and does not crash media.

- [ ] **2. Add archive replacement/legacy test.** Reuse this exact visible message constructor and real merge path:

```typescript
function archivedMessage(p: CanvasArtifactProjection): VisibleMessage {
  return { messageId: 'assistant-archive-1', turnId: 'turn-response-1', eventId: 'archive-event-1', sequence: 2,
    role: 'assistant', content: '', createdAt: '2026-11-02T10:00:00Z', completionStatus: 'completed', truncated: false,
    mode: 'live', voiceSessionId: 'voice-archive-1', voiceDurationSeconds: 3,
    voiceTranscripts: [{ role: 'assistant', content: SPEECH }], canvasArtifacts: [p] };
}
it('archive reload replaces provisional ownership once and keeps legacy speech separate', () => {
  const p = projection(), row = archivedMessage(p);
  const live = mergeSessionCanvasArtifacts([], [p]);
  const archive = collectSessionCanvasArtifacts([row], '', false);
  const merged = mergeSessionCanvasArtifacts(archive, [p, p]);
  expect(live[0]!.artifactId).toBe(merged[0]!.artifactId);
  expect(merged).toHaveLength(1); expect(merged[0]!.messageId).toBe(row.messageId);
  expect(merged[0]!.rawSource).toBe(p.rawSource);
  const { canvasArtifacts: removed, ...legacy } = row;
  expect(removed).toEqual([p]);
  expect(collectSessionCanvasArtifacts([legacy], '', false)).toEqual([]);
  expect(legacy.voiceTranscripts![0]!.content).toBe(SPEECH);
  expect(collectSessionCanvasArtifacts([{ ...row, role: 'user' }], '', false)).toEqual([]);
  expect(collectSessionCanvasArtifacts([{ ...row, canvasArtifacts: [] }], '', false)).toEqual([]);
});
```

- [ ] **3. Exercise actual post-call grouping and inline `MessageItem`.** Add the following imports/test to the P3 frontend spec. Main cards must not exist only inside a closed call modal:

```typescript
import { groupVoiceMessages } from '../../../components/group-voice-messages.ts';
import { MessageItem } from '../../../components/MessageItem.tsx';
import { ChatProvider } from '../../chat/state/chat-context.tsx';
import { ApiClient } from '../../../api/client.ts';

it('post-call grouping keeps one inline explanation card and original transcript access', () => {
  const assistant = archivedMessage(projection());
  const user: VisibleMessage = { ...assistant, messageId: 'voice-user-1', sequence: 1,
    role: 'user', canvasArtifacts: undefined,
    voiceTranscripts: [{ role: 'user', content: 'Explain the path.' }] };
  delete user.canvasArtifacts;
  const grouped = groupVoiceMessages([user, assistant]);
  const client = new ApiClient({ fetch: async () => { throw new Error('No network in Canvas markup fixture'); } });
  const html = renderToStaticMarkup(createElement(ChatProvider, { client,
    children: createElement('div', {}, ...grouped.map(row => createElement(MessageItem,
      { key: row.messageId, message: row }))) }));
  expect(html.split(SPEECH).length - 1).toBe(1);
  expect(html.match(/data-canvas-artifact-id="response-1::canvas::0"/g)).toHaveLength(1);
  expect(html).not.toContain('A[Start] --> B[Finish]');
  expect(grouped.filter(row => row.canvasArtifacts?.length)).toHaveLength(1);
  expect(grouped.some(row => row.voiceDurationSeconds === 3 && (row.voiceTranscripts?.length ?? 0) >= 2)).toBe(true);
});
```

Extend it for two visuals on the same message, two artifact-bearing turns in one call, a legacy voice-only call, malformed optional metadata, user hang-up then authoritative reload, and dismissal before reload. Preserve call duration/full transcript modal access and no duplicate assistant response row. Run the P2 grouping/MessageItem suites as read-only regression checks as well.
- [ ] **4. Connect reload to actual backend output.** In the backend real-pipeline test, after publication read its actual assistant/journal, convert the public projection shape for the offline memory fixture only, and merge that projection with the already accepted **actual live** controller artifacts. Assert one key/source and durable owner message ID. Do not claim the memory fixture's `messages.list` is the real public projection: it returns raw records. The native test in Task 7 calls real `MongoMessages.list` and checks `content: ''`, top-level artifacts and `voiceTranscripts`.
- [ ] **5. Run both integration files plus existing Canvas/MessageItem/group suites**, then commit named P3 specs only as `test(voice-canvas): verify renderer safety and archive reconciliation`. Keep discovered source defects as owner handbacks, not P3 renderer edits.

### Task 7: Authorized isolated native publication/recovery fixture

**Files:** create `backend/test/voice/integration/canvas-multimodal.native.e2e-spec.ts`.

- [ ] **1. Add this native suite using existing generated-DB helpers.** This is sequential runtime reconstruction after awaited failure, not a claim of real process-kill/sentinel certification. It uses no live model/audio provider:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { voiceRuntimeHarness } from '../../runtime/voice-runtime-harness.js';
import { chunk, usage, done } from '../../fixtures/openrouter/frames.js';
import { deliveryFixture } from '../../../src/contracts/testing/voice-fixtures.js';
import { VoiceDelivery } from '../../../src/voice/agent/voice-delivery.js';
import { DurableChatRuntime } from '../../../src/chat-runtime/durable-chat-runtime.js';
import { archiveRecords } from '../../../src/chat-runtime/history.js';
import { graphConfig } from '../../../src/chat-runtime/finalization.js';
import { key } from '../../../src/persistence/records.js';
import type { LiveExecution } from '../../../src/chat-runtime/ports.js';
import { VISUALS, SPEECH, block } from '../../../../frontend/src/features/voice/integration-tests/canvas-multimodal-fixtures.js';

const authorized = process.env.AURVIN_CANVAS_NATIVE_AUTHORIZED === '1';
const supplied = Boolean(process.env.AURVIN_TEST_MONGODB_URI);
if (authorized && supplied && process.env.AURVIN_TEST_DB_PREFIX !== 'aurvin_p2_test_')
  throw new Error('Canvas native checks require the isolated test prefix.');

describe.skipIf(!authorized || !supplied)('Canvas multimodal native recovery', () => {
  it.each(['before-append', 'after-append', 'journal-only'] as const)('recovers %s without inference or artifact replay', async fault => {
    const h = await voiceRuntimeHarness(chunk(`${SPEECH}\n${block(VISUALS[0]!, 'ticks')}`) + chunk('', 'stop') + usage + done);
    let delivery!: VoiceDelivery;
    let failure: { mockRestore(): void } | undefined;
    try {
      const reservation = await h.runtime.reservations.acquire({ identity: h.identity, conversationId: 'canvas-native-chat',
        owner: { kind: 'live', voiceSessionId: 'canvas-native-voice' } });
      const ids = await h.runtime.submitLiveTurn({ identity: h.identity, sessionId: 'canvas-native-chat',
        content: 'Explain the path.', idempotencyKey: 'canvas-native-1', reservation, configSnapshot: h.currentConfig.current() });
      if (fault === 'before-append') {
        const append = h.persistence.messages.append.bind(h.persistence.messages);
        failure = vi.spyOn(h.persistence.messages, 'append').mockImplementation(async row => {
          if (row.role === 'assistant') throw new Error('fixture archive failure'); return append(row);
        });
      }
      if (fault === 'after-append') failure = vi.spyOn(h.persistence.memory, 'put')
        .mockRejectedValue(new Error('fixture manifest failure'));
      const live: LiveExecution = { reservation,
        start: async (a, write) => {
          delivery = new VoiceDelivery({ ...deliveryFixture(), userId: a.userId, sessionId: a.sessionId,
            turnId: a.turnId, attemptId: a.attemptId, responseId: key('voice-response', a.userId, a.sessionId, a.attemptId),
            voiceSessionId: 'canvas-native-voice', status: 'pending', textGenerated: '', textSpoken: null,
            textRemaining: null, audioDurationMs: null, audioPlayedMs: null, playedSamples: null }, 0, write,
            { speak: async () => undefined, flush: async () => undefined }, 2000);
          await delivery.start();
        },
        delta: text => delivery.delta(text), finish: () => delivery.finish(),
        artifact: async artifact => { const accepted = await delivery.artifact(artifact);
          if (fault === 'journal-only') throw new Error('fixture stop after confirmed artifact'); return accepted; },
        settle: async () => { throw new Error('fixture stopped before heard evidence'); },
      };
      await expect(h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
        signal: new AbortController().signal, emit: async () => undefined, live })).rejects.toThrow();
      failure?.mockRestore(); failure = undefined;
      const journal = await h.persistence.metadata.getVoiceDelivery(h.identity.userId, ids.sessionId, ids.attemptId);
      expect(journal?.canvasArtifacts).toHaveLength(1);
      if (fault !== 'journal-only') {
        const graph = await h.runtime.graph({ userId: h.identity.userId, sessionId: ids.sessionId,
          ownerId: 'canvas-native-inspect', leaseExpiresAt: new Date(Date.now() + 60000).toISOString() });
        const snapshot = await graph.getState(graphConfig(h.identity.userId, ids.sessionId));
        expect(snapshot.values.sealed).toBe(true);
        expect(snapshot.values.result.assistant.canvasArtifacts).toEqual(journal!.canvasArtifacts);
      }
      const restarted = new DurableChatRuntime(h.deps);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      const assistants = (await archiveRecords(h.persistence, h.identity.userId, ids.sessionId)).filter(m => m.role === 'assistant');
      expect(assistants).toHaveLength(1); expect(assistants[0]!.content).toBe(SPEECH);
      expect(assistants[0]!.canvasArtifacts).toEqual(journal!.canvasArtifacts);
      const page = await h.persistence.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
      const visible = page.items.filter(m => m.role === 'assistant');
      expect(visible).toHaveLength(1); expect(visible[0]!.content).toBe('');
      expect(visible[0]!.canvasArtifacts).toEqual(journal!.canvasArtifacts);
      expect(visible[0]!.voiceTranscripts?.map(t => t.content)).toEqual([SPEECH]);
      const settled = await h.persistence.metadata.getVoiceDelivery(h.identity.userId, ids.sessionId, ids.attemptId);
      expect(settled?.textGenerated).toBe(SPEECH); expect(settled?.textSpoken).toBeNull();
      expect(settled?.status).toBe('unknown'); expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { failure?.mockRestore(); await h.close(); }
  }, 30000);
});
```

For the after-append injection, use the actual finalization `memory.put` stage; if committed native repositories use a confirmed variant at that stage, spy on that existing public method **inside this test** instead and record the injection point. Prove the assistant was appended before the injected failure. Do not mistake an admission/initial-manifest failure for checkpoint publication recovery. `journal-only` can already publish interrupted output before reconstruction; record that honestly and require an actual absent-assistant/journal recovery case as a separate fault location if no recovery work remained.

- [ ] **2. Discover without connecting.** From `backend`: `npx --no-install vitest list --config ./vitest.config.e2e.ts test/voice/integration/canvas-multimodal.native.e2e-spec.ts --json`. Require three discovered table cases even if currently skipped. Native discovery is not native execution.
- [ ] **3. Apply the authorization gate before execution.** Operator must explicitly approve connecting/creating/dropping generated test databases; privately supply `AURVIN_TEST_MONGODB_URI` to an admitted native MongoDB **replica set**, set `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`, and identify the isolated disposable service/topology. Never use an application/production database or overlapping live executor, provision a DB automatically, inspect/print the URI, or load application `.env` credentials as authorization. The existing helper creates/drops **only** its random `aurvin_p2_test_<uuid>` database. Confirm cleanup in `finally` and report cleanup failures.
- [ ] **4. If approved, set the test-only authorization flag and run**, in the existing privately configured shell in `backend`:

```powershell
$env:AURVIN_CANVAS_NATIVE_AUTHORIZED = '1'
if (-not $env:AURVIN_TEST_MONGODB_URI -or $env:AURVIN_TEST_DB_PREFIX -ne 'aurvin_p2_test_') { throw 'Isolated native prerequisites missing.' }
npm run test:e2e -- test/voice/integration/canvas-multimodal.native.e2e-spec.ts --reporter=verbose
```

Require three executed, zero skipped, zero failures, real archive/checkpoint assertions and generated-database cleanup. With no approval/URI, record **blocked** and do not connect; a deliberately run offline skip is **skipped**, not passed. Supplied invalid prefix/unavailable database/topology rejection is failure/blocked prerequisites, never silent success. The local flag is a fail-safe, not a substitute for the user's approval.
- [ ] **5. Commit only the native spec** as `test(voice-canvas): verify isolated native artifact publication recovery`, with executed/blocked state recorded separately in `verification.md`.

### Task 8: Timing traces, adverse-rate detection, and separately authorized browser runbook

**Files:** extend P3 backend/frontend integration specs and named fixture; record results in `docs/voice-canvas-multimodal/verification.md`. No application timing instrumentation, browser automation dependency, or new harness file is authorized.

- [ ] **1. Define clocks before collecting results.** Offline fake timer origin is captured once after fixture creation; `Date.now() - origin` is virtual elapsed ms. Advance existing `FakeContext.currentTime` consistently in 10 ms steps with that clock. Backend `performance.now()` observations are a **different clock** unless fake-timer configuration explicitly fakes it; never subtract unrelated clocks. Source counts/TTS callbacks are not audio playback.

| Marker | Offline measurement | Real browser/provider measurement |
| --- | --- | --- |
| `t_turn_start` | Instant the synthetic STT finalized user turn is injected; label this narrower fixture definition | First captured user speech onset on browser monotonic `performance.now()`; also record end-of-user-speech and server STT-finalized/accepted times separately. Do not move the start to provider-first-token to improve the deadline. Use a pre-agreed short utterance. |
| `t_first_audible` | First nonzero PCM sample's scheduled source start from real `AudioPlaybackService` (`FakeNode.start`); **audible proxy** | Audio output timestamp/loopback capture of first audible nonzero output; map AudioContext time to performance clock using `getOutputTimestamp`, record measured device/loopback latency and uncertainty. |
| `t_artifact_receipt` | Full validated `canvas.artifact` reached real client/controller | Timestamp complete WebSocket event parsing, never opener/first source token. |
| `t_first_rendered` | Actual Canvas conversion completion at virtual time; label **conversion proxy**, not paint. Frontend SSR rendering is separately asserted, not given a fake paint timestamp. | Visible nonempty renderer first paint/filmstrip frame with panel actually on screen; record paint and enter-transition completion separately. DOM insertion/RAF alone is not proof of visible pixels. |
| `t_walkthrough_reference` | Predeclared synthetic speech phrase/sample offset within generated PCM, mapped through actual scheduled sources; **reference proxy** | Manually annotate the first audible referential phrase in captured output (e.g. “Follow A to B”), with onset uncertainty; do not infer from text/token/TTS callback order. |
| underrun | Existing playback `observations().underruns/underrunMs` plus sample-start gaps before terminal completion; paired identical-speech nonvisual control | Audible capture and queue trace while speech still expected; separate planned silence, startup reserve, network/TTS stall, and artifact-associated additional gaps. If attribution is uncertain mark unknown, not zero. |
| interruption | Local UI action → scheduled nodes stopped before network; **local completion proxy** | Monotonic input/physical action onset → last nonzero audible sample, including device latency; barge-in and Stop-speaking separately. |

Raw backend/provider clocks are correlated by turn/response ID and relative spans, not subtracted from the browser's monotonic clock. Record UTC only to identify a run. With external capture, align an approved local calibration marker and record error bounds; do not add marker/filler speech to Aurvin's answer. If necessary markers/capture cannot be obtained without unowned code, request ownership or report timing blocked; do not invent measurements.

- [ ] **2. Add a timing-record type/local function in the P3 spec** and populate it from actual relay/playback/render actions, not from expected constants:

```typescript
type TimingRow = {
  scenario: string; clock: 'virtual-proxy' | 'browser-audible';
  turnStart: number; firstAudible: number | null; artifactReceipt: number | null;
  firstRendered: number | null; walkthroughReference: number | null;
  underruns: number; underrunMs: number; interruptStart: number | null; interruptEnd: number | null;
};
function timingGates(row: TimingRow) {
  return {
    fiveSeconds: row.firstRendered === null ? 'unverified' : row.firstRendered - row.turnStart <= 5000 ? 'pass' : 'fail',
    visualBeforeReference: row.firstRendered === null || row.walkthroughReference === null ? 'unverified'
      : row.firstRendered < row.walkthroughReference ? 'pass' : 'fail',
    noUnderrun: row.underruns === 0 && row.underrunMs === 0 ? 'pass' : 'fail',
    localStop: row.interruptStart === null || row.interruptEnd === null ? 'unverified'
      : row.interruptEnd - row.interruptStart < 250 ? 'pass' : 'fail',
  };
}
```

Add pure detector assertions with a 5001 ms render delay, render at/after reference, a positive underrun and 250 ms interruption: all must be `fail`; absent markers must be `unverified`, not fabricated zeros. **Never** use this function's `noUnderrun` alone to prove causal attribution or production readiness.

```typescript
it('timing detector reports deadlines reference order gaps and interruption misses', () => {
  const normal: TimingRow = { scenario: 'oracle', clock: 'virtual-proxy', turnStart: 0,
    firstAudible: 300, artifactReceipt: 900, firstRendered: 900, walkthroughReference: 1200,
    underruns: 0, underrunMs: 0, interruptStart: 1300, interruptEnd: 1301 };
  expect(timingGates(normal)).toEqual({ fiveSeconds: 'pass', visualBeforeReference: 'pass', noUnderrun: 'pass', localStop: 'pass' });
  expect(timingGates({ ...normal, firstRendered: 5001 }).fiveSeconds).toBe('fail');
  expect(timingGates({ ...normal, firstRendered: 1200 }).visualBeforeReference).toBe('fail');
  expect(timingGates({ ...normal, underruns: 1, underrunMs: 400 }).noUnderrun).toBe('fail');
  expect(timingGates({ ...normal, interruptEnd: 1550 }).localStop).toBe('fail');
  expect(timingGates({ ...normal, firstRendered: null, walkthroughReference: null, interruptEnd: null }))
    .toMatchObject({ fiveSeconds: 'unverified', visualBeforeReference: 'unverified', localStop: 'unverified' });
});
```

- [ ] **3. Exercise normal and adverse generation with the real pipeline.** Enqueue concept and walkthrough speech first; drive nonzero 24 kHz PCM in ≤4800-sample packets (existing cap), leaving at most the existing 2000 ms queue. Record each scheduled start/duration and a predetermined sample offset corresponding to the fixture walkthrough reference. Close the visual suffix after a short controlled delay for normal generation; repeat with a **6200 ms** closure delay and a partial second block. Advance one virtual clock; read `AudioPlaybackService.observations()` and complete-source receipt/conversion times. Assert the slow detector reports the five-second/reference-order misses rather than making its timer stand in for paint. A frame sequence with a deliberate ≥400 ms mid-speech arrival stall must produce a positive observed underrun, proving the detector can detect a gap. Keep a matched nonvisual control with identical speech, PCM timing and durable-write delay; compare extra gap count/duration before claiming any artifact causality. Do not pad prose, replay frames, silently speed audio, increase queues, or delay speech to force the visual-before-reference result.

Use this runnable schedule in the backend spec. Its synthetic phrase-to-sample mapping is declared by the fixture (walkthrough starts 21600 samples into the 28800-sample speech), **not** an inference about a provider's alignment. The existing service's 100 ms startup reserve is measured from actual source starts, not rewritten:

```typescript
it.each([900, 6200])('slow generation timing and control expose closure at %ims', async closeAt => {
  vi.useFakeTimers();
  const rows: Array<TimingRow & { waitingVisualSilenceMs: number }> = [];
  for (const visual of [false, true]) {
    const f = await canvasPipeline();
    try {
      await f.begin(); const origin = Date.now();
      let artifactReceipt: number | null = null, firstRendered: number | null = null;
      const transmit = f.server.send.getMockImplementation()!;
      f.server.send.mockImplementation(data => {
        transmit(data);
        if (typeof data === 'string' && JSON.parse(data).type === 'canvas.artifact') {
          artifactReceipt = Date.now() - origin;
          expect(projectionToCanvasArtifact(f.ui.controller.getSnapshot().artifacts[0]!)).not.toBeNull();
          firstRendered = Date.now() - origin;
        }
      });
      await f.push(`${SPEECH}\n`); await f.tick(200);
      await f.until(() => vi.mocked(f.tts.connection.speak).mock.calls.length > 0);
      // Twelve 100ms packets, arriving every 50ms: <2000ms queue, no replay/filler.
      for (let n = 0; n < 12; n++) { await f.audio(2400); await f.tick(50); }
      const elapsed = Date.now() - origin;
      await f.tick(Math.max(0, closeAt - elapsed));
      if (visual) {
        await f.push(block(VISUALS[0]!, 'ticks'));
        await f.until(() => f.ui.controller.getSnapshot().artifacts.length === 1);
        await f.push('~~~chart\n{"type":"bar","data":['); // Incomplete candidate remains silent.
      }
      await f.endModel();
      const starts = f.ui.context.sources.map(s =>
        Number((s.start.mock.calls as unknown as Array<[number]>)[0]?.[0]) * 1000);
      expect(starts).toHaveLength(12);
      const first = starts[0]!;
      const lastEnd = starts.at(-1)! + 100;
      const observation = f.ui.playback.observations();
      const row: TimingRow & { waitingVisualSilenceMs: number } = {
        scenario: `${visual ? 'visual' : 'control'}-${closeAt}`, clock: 'virtual-proxy',
        turnStart: 0, firstAudible: first, artifactReceipt, firstRendered,
        walkthroughReference: starts[9]!, underruns: observation.underruns, underrunMs: observation.underrunMs,
        interruptStart: null, interruptEnd: null,
        waitingVisualSilenceMs: artifactReceipt === null ? 0 : Math.max(0, artifactReceipt - lastEnd),
      };
      rows.push(row);
      expect(observation.underruns).toBe(0);
      if (visual) expect(timingGates(row)).toMatchObject({
        fiveSeconds: closeAt > 5000 ? 'fail' : 'pass',
        visualBeforeReference: closeAt > 5000 ? 'fail' : 'pass',
      });
      await f.finishAudio();
      expect((await f.delivery())!.textGenerated).toBe(SPEECH);
      expect(f.h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await f.close(); }
  }
  expect(rows[1]!.underrunMs - rows[0]!.underrunMs).toBe(0);
  if (closeAt === 6200) expect(rows[1]!.waitingVisualSilenceMs).toBeGreaterThan(0);
  console.info('Canvas fixture timing (virtual proxies only)', JSON.stringify(rows));
}, 30000);

it('underrun detector observes a deliberately stalled mid-speech packet', async () => {
  vi.useFakeTimers(); const f = await canvasPipeline();
  try {
    await f.begin(); await f.push(`${SPEECH}\n`); await f.tick(200);
    await f.audio(2400); await f.tick(700); await f.audio(2400);
    const observed = f.ui.playback.observations();
    expect(observed.underruns).toBeGreaterThan(0);
    expect(observed.underrunMs).toBeGreaterThanOrEqual(400);
    await f.push(block(VISUALS[0]!, 'ticks')); await f.endModel(); await f.finishAudio();
  } finally { await f.close(); }
});
```

The fake node's existing `start` spy is declared without parameters; its parameter tuple is narrowed **in this spec**, rather than editing shared audio fakes. If actual delivery yields a different packet segmentation, derive sample positions from real node buffer lengths and source starts instead of expecting twelve nodes blindly. Record measured segmentation. `waitingVisualSilenceMs` exposes speech-ended-but-visual-pending silence separately; it is not hidden by a zero intra-speech underrun count and may itself be an AC-1 experience miss.

Run: `npm test -- test/voice/integration/canvas-multimodal.spec.ts -t "timing|underrun|slow generation"` in `backend`; require actual discovered named timing cases. Virtual scheduled audio is not heard audio, and Node markup is not first rendered pixels. Record timing misses as acceptance misses even when their detector regression test passes. If the normal fixture also misses a gate, preserve the miss and request a scope/acceptance decision; no second inference or synchronization scheduler is authorized.

- [ ] **4. Gate real browser layout/media checks separately.** Ask explicit permission for local browser/microphone use, display/recording scope and isolated seeded data before starting browser checks. No approval means **blocked**, not executed. Use the existing application and authorized staging/local access controls only. If running servers is approved, use separate package shells: backend `npm run start:dev`; frontend `npm run dev -- --host 127.0.0.1`. Use only operator-approved isolated DB/provider settings; do not expose secrets in `VITE_*`, inspect ordinary user chats, or deploy publicly. Offline browser rendering of synthetic data does not authorize live speech providers.

Check desktop 1440×900, tablet 1024×768, narrow 390×844 and 320×568; browser zoom 200%; normal/reduced motion. Measure panel entry from right/exit to right with computed animation duration and frame/filmstrip (300–350 ms normal, reduced-motion override explicitly recorded). Verify exit stays mounted but inert/unfocusable until completed, focus returns to live Canvas toggle/surface or text composer, no horizontal overflow or hidden call controls, ≥380 px to ≤50vw right pane when space permits, and call region resizes without replacing the media controller. While speaking **and paused**, dismiss by panel/last tab, reopen with Canvas/keyboard, select/close non-last tab, replay duplicate event/refresh archive, receive later new artifact. Count remains unique; dismissal is sticky until a new identity. Record stream/track/socket/playback identities, mute state and capture acquisition/stop counts before/after each layout action. Actual hang-up is allowed to stop media; Canvas actions are not.

- [ ] **5. Gate provider timing checks independently.** Obtain explicit approval naming provider accounts/models, permitted data, maximum cost/calls/time, browser audio/recording consent, and stop conditions. Propose a finite run of **at most six responses** (three normal, three agreed slow/adverse) with synthetic short prompts, existing configured output limits and no retries; operator must approve the numeric spend ceiling before any paid request. If controlled provider slowness cannot be safely introduced without unowned instrumentation, keep adverse evidence at offline/browser-fixture level and mark real adverse timing unverified. Existing secrets alone are never authorization. No Azure certification, provisioning or deployment belongs here.

For every agreed live scenario capture all seven timing markers above, output queue setting, input/STT delays, browser/version/device/audio route, provider/model/config revision, renderer/source size, network conditions, sample rate, run IDs and error bounds. Measure five-second visual deadline from the agreed user speech onset, visible-before-audible-reference strictly with uncertainty bounds, no artifact-induced playback gap against control/trace, and local interruption **<250 ms** for both barge-in and the accessible Stop-speaking action. Exit then reload and follow up about node B; keep durable explanation/card/linkage without duplicate archive or display/heard claims. Store only consented synthetic timing evidence, no credentials/private reasoning or unrelated audio. Link sanitized capture locations in `verification.md`; raw artifacts outside owned paths require separate artifact/ownership approval.
- [ ] **6. Evaluate rather than average away misses.** Report per-run values, worst case, sample count and scope. If `t_render + error >= t_reference - error`, order is unverified/fail, not proven. If live checks remain unauthorized, database prerequisites missing, a required scenario misses timing, or baseline/new required checks fail, full acceptance remains blocked pending the orchestrator/user's explicit decision. No prompt-only universal timing guarantee is established.
- [ ] **7. Commit only P3 timing tests/helper and `verification.md`** as `test(voice-canvas): record normal and adverse timing evidence`. Describe unrun browser/provider gates as blocked; do not write a final workflow report or mark the workflow complete from P3.

### Task 9: Discovery, full commands, evidence reconciliation and handoff

**Files:** `docs/voice-canvas-multimodal/verification.md`; only already named P3 tests/helpers if a test fixture itself is defective.

- [ ] **1. Prove nonempty discovery first.** Run each command in the indicated package; `npx --no-install` must use its installed Vitest, never download another version:

```powershell
# backend
npx --no-install vitest list test/voice/integration/canvas-multimodal.spec.ts --json
npx --no-install vitest list --config ./vitest.config.e2e.ts test/voice/integration/canvas-multimodal.native.e2e-spec.ts --json
# frontend
npx --no-install vitest list src/features/voice/integration-tests/canvas-multimodal.test.ts --json
```

Use a real shell `workdir`, not comments as directory changes. Check each JSON list includes that exact file and at least one named test. Listing a skipped test is discovery only. Fail on zero tests, wrong config, test collection/import errors, or absent new filenames; never use `--passWithNoTests`.

- [ ] **2. Run focused suites with JSON evidence outside the checkout.** Pre-created approved directory is `C:/Users/Peter/AppData/Local/Temp/opencode`. Commands below use unique objective-specific report names; preserve pre-existing reports by choosing a run timestamp when necessary and record actual paths.

```powershell
# backend
npm test -- test/voice/integration/canvas-multimodal.spec.ts --reporter=default --reporter=json --outputFile.json="C:/Users/Peter/AppData/Local/Temp/opencode/voice-canvas-backend-focused.json"
npm test -- test/voice/agent/speech-prose.spec.ts test/voice/agent/pipeline.spec.ts test/voice/agent/voice-delivery.spec.ts test/runtime/voice-output.spec.ts test/runtime/voice-history.spec.ts test/context/voice-context.spec.ts test/persistence/voice-messages.spec.ts src/contracts/voice.spec.ts src/contracts/canvas-artifact.spec.ts
# frontend
npm test -- src/features/voice/integration-tests/canvas-multimodal.test.ts --reporter=default --reporter=json --outputFile.json="C:/Users/Peter/AppData/Local/Temp/opencode/voice-canvas-frontend-focused.json"
npm test -- src/api/voice-protocol.test.ts src/api/protocol.test.ts src/features/canvas/canvas.test.ts src/features/voice/state/live-voice-controller.test.ts src/features/voice/state/live-voice-reducer.test.ts src/features/chat/ChatView.voice.test.ts src/components/group-voice-messages.test.ts src/components/MessageItem.test.ts
```

Inspect `testResults[].assertionResults` and require ≥1 **passed** result from each named P3 ordinary file, zero failed and zero pending/skipped in those deterministic suites. Record discovered/executed/passed/failed/skipped separately; aggregate exit zero is insufficient. Native results separately require explicit authorized execution and three passed cases, not three pending.

Example evidence check, from either package (select its actual report path):

```powershell
node --input-type=module -e 'import fs from "node:fs"; const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const t=r.testResults.flatMap(s=>s.assertionResults); if(!t.length || !t.some(x=>x.status==="passed") || t.some(x=>x.status!=="passed")) process.exit(1); console.log(JSON.stringify({discovered:t.length,passed:t.filter(x=>x.status==="passed").length}));' "C:/Users/Peter/AppData/Local/Temp/opencode/voice-canvas-backend-focused.json"
```

Keep the Vitest process exit code separately: a stale valid JSON file does not override a failed test command. Record run start/end and report modification time; do not consume a previous run's report. Vitest 4 reporter/list syntax was checked against its current documentation during planning; confirm installed minor versions if command parsing differs, without upgrading packages.

- [ ] **3. Run all required package commands**, separately in each package. Record stdout summary, exit code, counts, duration, skipped-suite reasons and tested HEAD. Both full backend `npm test` (existing native-gated ordinary specs) and `test:e2e` may connect a supplied database, so run them only under their approved prerequisite scope; if absent, avoid exporting the native authorization flag/URI and record native skips. Never invoke unrelated live/service tests merely to obtain a green badge.

```powershell
# backend
npm run build
npm run lint
npm test
npm run test:e2e
# frontend
npm run build
npm run lint
npm test
```

If an inherited `AURVIN_TEST_MONGODB_URI` is present without native authorization, do **not** run full backend `npm test` or `test:e2e`: existing suites do not share P3's additional authorization flag. Mark those full commands blocked instead; do not change the operator's environment or connect first and ask later. P3's explicitly selected deterministic spec remains offline; discovery is not permission to execute other native-gated suites.

Run `npm test -- test/performance/durable-latency.spec.ts` and `npm test -- test/assembly/calendar-simplification.built.spec.ts` separately in `backend` **only to characterize actual remaining full-run failures**. Keep their output/counts distinct from P3's functional/timing acceptance. Do not change their thresholds, fixtures or ownership, suppress them from the full run, or call a standalone pass proof that the earlier full-run failure vanished. Existing baseline failures still prevent saying “all checks passed.” Native skipped tests and empty `test:azure`/`test:behavior` discovery are not evidence; do not run Azure certification for this objective.

- [ ] **4. Fill `verification.md` using this exact evidence structure**, with real values and explicit status labels; empty actual cells use **not executed**, not invented numbers:

```markdown
# Verification: voice-canvas-multimodal

## Decision and scope
- Overall gate: blocked / offline verified with outstanding acceptance gates / accepted by explicit decision.
- Research: skipped. Unified review: skipped.
- Authorizations actually received; requested scopes not granted; no production claim.

## Tested commit set and environment
- W1/W2/P3 commit hashes, pre-test HEAD and any subsequent correction hashes.
- Branch, OS/CPU/RAM, Node/npm, package locks/dependency versions, dirty paths and parallelism.
- Fixture/native/browser/provider environments separately, no secrets or URIs.

## Command ledger
| ID | Status (planned/executed/skipped/blocked) | Workdir | Exact command | HEAD | Exit | Discovered | Passed | Failed | Skipped | Duration | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Integrated functional evidence
- Actual filter/runtime/journal/wire/client/state/Canvas chain and test names.
- Boundary counts, malformed/partial/oversize and ordinal/budget behavior.
- Pre-audio, replay/stale/cancelled/multi-turn/session isolation.
- Interrupt before/during/after visual and CAS, local stop ordering, source retention.
- Checkpoint/journal publication replay, one assistant/key/card, inference/synthesis call counts.
- Clean generated/heard/remaining speech, legacy compatibility, separately labeled context and input once.
- Renderer matrix and safety parity with actual source/render assertions.

## Native durability evidence
- Authorization reference, supplied-prerequisite presence (not values), replica-set identity, generated DB prefix and cleanup.
- Tests executed versus skipped; fault locations actually reached; raw/public archive/checkpoint equality.
- Sequential reconstruction limitations and no Azure/process-kill certification claim.

## Timing definitions and measurements
- Clock origin, user turn start definition, audio-clock mapping, device/capture latency/error bounds.
| Run | Scenario/environment | Status | Turn start | First audible/proxy | Complete artifact | First paint/proxy | Audible reference/proxy | Underruns/ms | Interrupt start/end/ms | Five-second gate | Render-before-reference | Gap gate | Local <250 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
- Normal, slow generation, deliberate underrun detector, matched nonvisual control, browser and bounded live runs separately.
- Explain every miss/unknown, uncertainty, causal attribution limits and stop condition.

## Browser UI/accessibility/media evidence
- Browser/version, viewports/zoom/reduced motion, actual entry/exit timings/directions, focus/inert lifecycle.
- Toggle/tab/card count/dismiss/replay/reload, paused access, media identity/mute continuity, barge-in/Stop-speaking.
- Consent and sanitized capture references, or blocked authorization rows.

## Acceptance mapping
| AC | Named tests/measurements | Result | Missing evidence / decision |
| --- | --- | --- | --- |
- Include AC-1 through AC-8 individually; fixture/SSR/native/live evidence is not interchangeable.

## Baseline limitations, new defects, and owner corrections
- W1 historical performance/assembly findings versus W3 actual full-run results.
- New integration defect reproductions, expected/actual, owning worker/path, correction hashes and rerun evidence.
- Skipped database checks, authorization blockers, unresolved timing/service/browser gates.

## Final handoff and acceptance decision
- P3 owned-path hashes and final tested commit set; reports/captures actually available.
- Scope/acceptance decisions verbatim with reference; no implied timing waiver.
- Orchestrator writes final_report.md/state.md and decides completion only after required evidence/approved changes.
```

- [ ] **5. Check documents/links/ownership.** Run `git diff --check`, inspect `git diff --name-only` and `git diff --cached --name-only`, verify every relative Markdown link and exact owned filename, verify no secret/payload/capture slipped into Git, and ensure evidence distinguishes planned/implemented/tested/skipped/blocked. W3 does not edit `state.md` or `final_report.md`; report these updates to the orchestrator.
- [ ] **6. Commit only the completed evidence document** as `docs(voice-canvas): record integrated verification and acceptance blockers`. Serialize with the orchestrator; never stage another worker's files. Report final P3 hashes, focused/full counts and failures/skips, native prerequisites, measured proxies versus actual timing, owner handbacks, and all unverified acceptance gates. No full-acceptance claim if native/browser/live evidence or an explicit user decision is still missing.

## Planning self-check and final constraints

- G1/G2 → Tasks 2–4; G3 → Tasks 4/6/7; G4 → Tasks 5/6/8; G5 → Task 8. AC-1 through AC-8 each retain executable and, where required, native/browser/audible evidence.
- Exact P1 caps, speech/archive separation, IDs and P2 exports are preserved. No fourth kind, second inference, new collection, 20-second queue claim, exit upload, display acknowledgment or automatic acceptance waiver is introduced.
- Only named P3 test/helper/evidence paths are planned; source/safety/transport defects require owner correction. The known pre-audio transport risk and renderer URL safety assertion are not silently bypassed.
- Planning verification is limited to required-header/task/AC coverage, relative links, placeholder scan, TypeScript snippet **syntax parsing** and Git whitespace/owned-path checks. Snippets have not been type-checked or executed; no application, native, browser or provider result is claimed by L3.
- Current unresolved execution dependencies: W2 must complete/commit; any frozen-contract change must be reconciled. Native DB, real browser/microphone and paid/provider timing authorizations are not currently granted. Full acceptance stays blocked until the necessary evidence or explicit acceptance decision exists.
- The planner commits **only** this file, with `git add docs/voice-canvas-multimodal/plan3.md` then `git commit -m "docs(voice-canvas-multimodal): plan 3 - integrated verification"`. On concurrent index lock, retry for at most 60 seconds; never remove another process's lock, stage its changes or switch branches.
