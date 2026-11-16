# P2: Frontend Live Canvas, Controls, and Archived Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver live-voice Canvas visual reception, responsive right-to-left split-pane animation, accessible live Canvas and "Stop speaking" controls, uninterrupted media continuity, and post-call inline transcript cards with clean spoken explanations.

**Architecture:** Extend `LiveVoiceController` and `liveVoiceReducer` to validate, deduplicate, and retain complete `canvas.artifact` wire projections (`${responseId}::canvas::${ordinal}`) across pre-audio arrival, barge-in cancellation, and user hang-up teardown without perturbing capture, socket, or playback instances. Merge durable archive artifacts (validated through P1's `isVisibleMessageCanvasArtifacts`) with accepted live projections into one session artifact list in `ChatView`, drive a 320 ms cubic-bezier enter/exit lifecycle that keeps `CanvasPanel` mounted with `inert` + `aria-hidden` while sliding closed and restores focus cleanly, and expose completed voice visual turns as inline assistant explanation + `CanvasArtifactCard` rows outside grouped call pills while preserving call duration and full transcript modal access.

**Tech Stack:** TypeScript (`bundler` ESM, strict), React 19 (`useSyncExternalStore`, `inert`), Vite 8, Vitest 4 (`environment: 'node'`, `react-dom/server` `renderToStaticMarkup`), Oxlint, dependency-free portable contracts (`voice-protocol.ts`, `protocol.ts`), existing Aurvin SVG/Mermaid/Chart Canvas renderers.

---

## MAW execution constraints and upstream P1 handoff

- **Skill announcement:** I'm using the `writing-plans` skill to create the implementation plan.
- **Scope and authority:** Implement only P2 of [goal.md](goal.md) under the ownership and exit gates in [state.md](state.md). Do not edit `goal.md`, `state.md`, `plan1.md`, or P1/P3 files. This document is a plan only; its snippets are instructions for Worker W2, **not** yet implemented or verified application code.
- **Worker execution mode:** Worker W2 starts only after **both** L2 (`plan2.md`) and W1 (backend + portable contracts) are committed. W2 loads `executing-plans` and `test-driven-development` and executes directly in its assigned worker slot without spawning sub-workers. Research and unified code review remain **skipped**, never passed.
- **Serialization and git hygiene:** Preserve user changes and untracked files. Coordinate shared Git index access with the orchestrator before staging/committing, and stage **only** named P2-owned files (`git add <explicit-paths>` — never `git add .`). Preserve mandatory `====` file headers on all touched code/test files.
- **Oxlint component-export rule:** `frontend/.oxlintrc.json` enforces `"react/only-export-components": ["warn", { "allowConstantExport": true }]`. Keep all new pure helper functions and constants in `.ts` modules (`canvas-artifacts.ts`, `group-voice-messages.ts`), leaving `.tsx` files (`CanvasPanel.tsx`, `LiveVoiceControls.tsx`, `LiveVoicePanel.tsx`, `ChatView.tsx`, `MessageItem.tsx`) exporting only React components (or pre-existing helpers).
- **Upstream P1 frozen contracts consumed read-only by W2** (owned by P1 in `frontend/src/api/voice-protocol.ts` and `frontend/src/api/protocol.ts`; W2 **never** edits `src/api/**`):
  - Wire payload in `VoiceServerEvent`:
    ```typescript
    type CanvasArtifactKind = 'mermaid' | 'chart' | 'svg';
    type CanvasArtifactSource = {
      ordinal: number; // integer 0..2; gaps valid when earlier candidate discarded
      kind: CanvasArtifactKind; // 'graph' already normalized to 'chart'
      subType: string; // <= 48 UTF-16 units / 192 UTF-8 bytes, trimmed, single-line
      title: string; // <= 120 UTF-16 units / 480 UTF-8 bytes, trimmed, single-line
      rawSource: string; // <= 8192 UTF-16 units / 16384 UTF-8 bytes, trimmed
    };
    type CanvasArtifactProjection = CanvasArtifactSource & { responseId: string };
    type CanvasArtifactPayload = {
      type: 'canvas.artifact';
      turnId: string;
    } & CanvasArtifactProjection;
    ```
  - Portable guards in `frontend/src/api/voice-protocol.ts`:
    - `MAX_VOICE_CONTROL_BYTES` (`131072`)
    - `CANVAS_ARTIFACT_LIMITS`
    - `isCanvasArtifactId(value: unknown): value is string`
    - `isCanvasArtifactSource(value: unknown): value is CanvasArtifactSource`
    - `isCanvasArtifactProjection(value: unknown): value is CanvasArtifactProjection`
    - `isCanvasArtifactProjectionList(value: unknown): value is CanvasArtifactProjection[]`
  - Visible archive contract in `frontend/src/api/protocol.ts`:
    - `VisibleMessage.canvasArtifacts?: CanvasArtifactProjection[]` (assistant/live only; `content` remains `''` for voice turns; clean spoken prose lives in `voiceTranscripts`; `canvasArtifacts` is top-level only).
    - `isVisibleMessageCanvasArtifacts(value: unknown): boolean` (returns `true` when `canvasArtifacts` is absent, or when `role === 'assistant'`, `mode === 'live'`, `isCanvasArtifactId(voiceSessionId)`, and `isCanvasArtifactProjectionList(canvasArtifacts)` all hold).
- **Cross-plan transport note for orchestrator awareness (no unowned edits by W2):**
  - P1 (`plan1.md` lines 241, 509) emits `{ type: 'response.cancelled', turnId, responseId, lastAudioSequence: null }` when an in-flight turn is interrupted **before** `audio.start`.
  - In `frontend/src/api/voice-client.ts` (lines 248–252, currently outside both P1 and P2 owned lists), `VoiceClient.receive` checks `if (!response || ...)` on `response.cancelled` and throws `VOICE_INVALID_STATE` when `this.response` has not been created by `audio.start`.
  - Task 2 makes `LiveVoiceController` handle pre-audio `canvas.artifact`, pre-audio `response.cancelled`, and pre-audio local `interrupt()` completely. W2 **must not** edit `frontend/src/api/voice-client.ts` unless the orchestrator explicitly grants ownership in `state.md` first (if authorized, the exact 5-line transport guard is: when `event.type === 'response.cancelled' && !this.response && event.lastAudioSequence === null && !this.responsesSeen.has(event.responseId) && this.responsesSeen.size < 4096`, record `this.responsesSeen.add(event.responseId)` instead of throwing `VOICE_INVALID_STATE`).

---

## Exact ownership and file structure

### Implementation files W2 will modify (15 owned paths)

1. `frontend/src/features/canvas/canvas-artifacts.ts` — convert validated `CanvasArtifactProjection` records to `CanvasArtifact` (`${responseId}::canvas::${ordinal}`), map chart `subType` back to forced `ChartKind` (preserving `line` default for untyped `graph` blocks), reject unrenderable/empty Mermaid/Chart/SVG bodies safely, extract validated archive voice artifacts via `isVisibleMessageCanvasArtifacts`, merge archive + live artifacts without duplicates, and provide pure transition/reduced-motion/focus-target/`Alt+C` shortcut helpers.
2. `frontend/src/features/canvas/CanvasPanel.tsx` — add `id="aurvin-canvas-panel"`, `transitionState` (`'open' | 'exiting'`), `inert` + `aria-hidden` during exit animation, `panelRef`, and subtype-aware `ChartModel` resolution for `ChartRenderer`.
3. `frontend/src/features/canvas/index.ts` — re-export new Canvas conversion, merge, auto-open, reduced-motion, focus, and shortcut helpers.
4. `frontend/src/features/chat/state/chat-reducer.ts` — ensure `CLOSE_CANVAS_TAB` with `fallbackArtifactId: null` (closing last open tab) always sets `activeCanvasArtifactId: null` and `canvasOpen: false`.
5. `frontend/src/features/voice/state/live-voice-reducer.ts` — track `conversationId: string | null` and accepted `artifacts: CanvasArtifactProjection[]` across active, interrupted, paused, and user-exit lifecycle transitions.
6. `frontend/src/features/voice/state/live-voice-controller.ts` — accept valid `canvas.artifact` events before or after `audio.start`, enforce turn/response/epoch/cancellation/ordinal/aggregate-budget guards without crashing on malformed input, retain accepted artifacts across barge-in, bridge user-exit reload before clearing provisional state, and invoke optional `openCanvasArtifact` once per newly accepted artifact.
7. `frontend/src/features/voice/state/useLiveVoice.ts` — forward optional `openCanvasArtifact` binding through `latest` ref without recreating `LiveVoiceController`.
8. `frontend/src/App.tsx` — pass `openCanvasArtifact` imperative binding in `VoiceChatShell` so live artifact acceptance dispatches `OPEN_CANVAS_ARTIFACT` immediately even outside browser effect loops.
9. `frontend/src/features/voice/live/LiveVoiceControls.tsx` — add accessible `Stop speaking` button (`aria-label="Stop speaking"`, shown during active interruptible speech) and keyboard-accessible `Canvas` toggle button with `aria-expanded`, `aria-controls="aurvin-canvas-panel"`, and unique session artifact count badge (active while paused as well as while speaking; omitted when count is `0`).
10. `frontend/src/features/voice/live/LiveVoicePanel.tsx` — accept optional `canvas` control descriptor and `surfaceRef`, forwarding Canvas props to `LiveVoiceControls` and `Alt+C` shortcut handling to `handleLiveCanvasShortcut`.
11. `frontend/src/features/voice/live/live-voice.css` — responsive wrapping call-control layout (`overflow-x: hidden`, zero horizontal overflow on narrow viewports), `.aurvin-live-button-interrupt`, `.aurvin-live-canvas-toggle`, focus-visible rings, and reduced-motion rules.
12. `frontend/src/features/chat/ChatView.tsx` — remove `!liveActive` Canvas exclusion, merge archived and live session artifacts without duplicates, auto-open newly accepted live artifacts while keeping user dismissals sticky across audio ticks, drive 320 ms cubic-bezier right-slide entry/exit mounting with `inert` and focus restoration, and keep media instances untouched.
13. `frontend/src/styles/chat.css` — desktop split-screen Canvas bounds (`380px` to `50vw`), responsive mobile overlay (`<= 900px`), 320 ms `cubic-bezier(0.32, 0.72, 0, 1)` right-to-left slide-in / slide-out keyframes, and `prefers-reduced-motion: reduce` instant mounting rules.
14. `frontend/src/components/group-voice-messages.ts` — preserve consolidated call duration and full transcript modal pill while emitting completed voice turns with valid `canvasArtifacts` as standalone transcript entries outside the grouped call pill.
15. `frontend/src/components/MessageItem.tsx` — render inline assistant spoken explanations (`voiceTranscripts`) and `CanvasArtifactCard` triggers in the main transcript for completed voice visual turns without duplicate explanations, broken cards, or invalid text-SSE retry actions (`chat-types.ts`, `use-chat.ts`, `chat-context.tsx`, `canvas-types.ts`, `CanvasArtifactCard.tsx`, `Transcript.tsx`, `VoiceTranscriptModal.tsx`, `live-voice-lifecycle.ts`, and `safe-markdown.tsx` remain untouched).

### Owned test files W2 will modify (10 existing suites)

1. `frontend/src/features/canvas/canvas.test.ts`
2. `frontend/src/features/voice/state/live-voice-reducer.test.ts`
3. `frontend/src/features/voice/state/live-voice-controller.test.ts`
4. `frontend/src/features/voice/live/live-voice-controls.test.ts`
5. `frontend/src/features/voice/live/live-voice-surface.test.ts`
6. `frontend/src/features/chat/ChatView.voice.test.ts`
7. `frontend/src/features/voice/live/live-voice-composition.test.ts`
8. `frontend/src/components/group-voice-messages.test.ts`
9. `frontend/src/components/MessageItem.test.ts`
10. `frontend/src/styles/styles.test.ts` (excludes P1's `src/api/*.test.ts` and P3's `src/features/voice/integration-tests/canvas-multimodal.test.ts`).

---

### Task 1: Canvas Projection Conversion, Chart Subtype Parity, Archive Validation, Merging, and Panel Transition Helpers

**Files:**
- Modify: `frontend/src/features/canvas/canvas-artifacts.ts`
- Modify: `frontend/src/features/canvas/CanvasPanel.tsx`
- Modify: `frontend/src/features/canvas/index.ts`
- Modify: `frontend/src/features/chat/state/chat-reducer.ts`
- Test: `frontend/src/features/canvas/canvas.test.ts`

- [ ] **Step 1: Write the failing Canvas conversion, archive-guard, merge, parity, and exit-inert tests**

Append the following `describe` block to `frontend/src/features/canvas/canvas.test.ts` (updating the imports at lines 28–37 of `frontend/src/features/canvas/canvas.test.ts` to also import `CANVAS_TRANSITION_MS`, `claimNewAutoOpenArtifactId`, `extractVoiceMessageCanvasArtifacts`, `forcedChartKindFromSubType`, `mergeSessionCanvasArtifacts`, `prefersReducedCanvasMotion`, `projectionToCanvasArtifact`, `resolveCanvasCloseFocusTarget`, and `restoreCanvasCloseFocus` from `./index.ts`, plus `type VisibleMessage` from `../../api/protocol.ts`):

```typescript
describe('Multimodal voice Canvas projections, archive merging, and panel exit semantics', () => {
  const mermaidProjection = {
    responseId: 'resp_voice_1',
    ordinal: 0,
    kind: 'mermaid' as const,
    subType: 'Flowchart',
    title: 'Auth Pipeline',
    rawSource: 'flowchart TD\n  Gateway --> AuthDB',
  };

  it('converts valid Mermaid, sequence, bar/line/pie, scatter, and sanitized SVG projections with deterministic IDs', () => {
    const flow = projectionToCanvasArtifact(mermaidProjection);
    expect(flow).toEqual({
      artifactId: 'resp_voice_1::canvas::0',
      messageId: 'resp_voice_1',
      index: 0,
      kind: 'mermaid',
      subType: 'Flowchart',
      title: 'Auth Pipeline',
      buttonLabel: 'View diagram',
      rawSource: 'flowchart TD\n  Gateway --> AuthDB',
      isStreaming: false,
    });

    const seq = projectionToCanvasArtifact({
      responseId: 'resp_voice_1',
      ordinal: 1,
      kind: 'mermaid',
      subType: 'Sequence Diagram',
      title: 'Handshake',
      rawSource: 'sequenceDiagram\n  User->>Aurvin: Speak\n  Aurvin-->>User: Visual',
    });
    expect(seq?.artifactId).toBe('resp_voice_1::canvas::1');
    expect(seq?.buttonLabel).toBe('View diagram');

    const untypedLineGraph = projectionToCanvasArtifact({
      responseId: 'resp_voice_1',
      ordinal: 2,
      kind: 'chart',
      subType: 'Line Graph',
      title: 'Latency Trend',
      rawSource: 'Mon: 42\nTue: 38\nWed: 31',
    });
    expect(untypedLineGraph?.buttonLabel).toBe('View graph');
    expect(forcedChartKindFromSubType('Line Graph', 'Mon: 42\nTue: 38')).toBe('line');

    // CanvasPanel renders untyped Line Graph projection as a line path rather than defaulting to bar rects
    const linePanelHtml = renderToStaticMarkup(
      createElement(CanvasPanel, {
        artifacts: [untypedLineGraph!],
        activeArtifactId: untypedLineGraph!.artifactId,
        onSelectArtifact: () => {},
        onCloseTab: () => {},
        onClosePanel: () => {},
      }),
    );
    expect(linePanelHtml).toContain('Latency Trend');
    expect(linePanelHtml).toContain('<path');

    const scatter = projectionToCanvasArtifact({
      responseId: 'resp_voice_2',
      ordinal: 0,
      kind: 'chart',
      subType: 'X-Y Point Plot',
      title: 'Clusters',
      rawSource: 'Dog: (8, 9)\nToaster: (-4, -3)',
    });
    expect(scatter?.buttonLabel).toBe('View graph');

    const safeSvg = projectionToCanvasArtifact({
      responseId: 'resp_voice_2',
      ordinal: 2,
      kind: 'svg',
      subType: 'SVG Visual',
      title: 'Badge',
      rawSource: '<svg viewBox="0 0 80 40"><script>alert(1)</script><rect x="2" y="2" width="40" height="20" /></svg>',
    });
    expect(safeSvg?.artifactId).toBe('resp_voice_2::canvas::2');
    expect(safeSvg?.buttonLabel).toBe('View diagram');
  });

  it('rejects malformed or empty unrenderable projections without throwing', () => {
    expect(
      projectionToCanvasArtifact({
        ...mermaidProjection,
        rawSource: 'flowchart TD',
      }),
    ).toBeNull();
    expect(
      projectionToCanvasArtifact({
        ...mermaidProjection,
        kind: 'chart',
        subType: 'Bar Chart',
        rawSource: '{"type":"bar","labels":["A"],"datasets":[]}',
      }),
    ).toBeNull();
    expect(
      projectionToCanvasArtifact({
        ...mermaidProjection,
        kind: 'svg',
        subType: 'SVG Visual',
        rawSource: '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>',
      }),
    ).toBeNull();
    expect(
      projectionToCanvasArtifact({
        ...mermaidProjection,
        ordinal: 4,
      }),
    ).toBeNull();
  });

  it('validates archive voice messages via isVisibleMessageCanvasArtifacts and deduplicates live-to-archive merges', () => {
    const validVoiceMsg: VisibleMessage = {
      messageId: 'msg_voice_9',
      turnId: 'turn_9',
      eventId: 'evt_9',
      sequence: 4,
      role: 'assistant',
      content: '',
      createdAt: '2026-11-02T10:00:00.000Z',
      completionStatus: 'completed',
      truncated: false,
      mode: 'live',
      voiceSessionId: 'vs_1',
      voiceTranscripts: [{ role: 'assistant', content: 'Explaining the auth pipeline.' }],
      canvasArtifacts: [mermaidProjection],
    };

    const invalidUserMsg: VisibleMessage = {
      ...validVoiceMsg,
      messageId: 'msg_bad_user',
      role: 'user',
    };

    expect(extractVoiceMessageCanvasArtifacts(invalidUserMsg)).toEqual([]);
    const archived = collectSessionCanvasArtifacts([invalidUserMsg, validVoiceMsg], '', false);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.artifactId).toBe('resp_voice_1::canvas::0');
    expect(archived[0]?.messageId).toBe('msg_voice_9');

    const secondLive = {
      responseId: 'resp_voice_2',
      ordinal: 1,
      kind: 'chart' as const,
      subType: 'Pie Chart',
      title: 'Share',
      rawSource: '{"type":"pie","labels":["A","B"],"datasets":[{"label":"S","data":[60,40]}]}',
    };

    const merged = mergeSessionCanvasArtifacts(archived, [mermaidProjection, secondLive]);
    expect(merged.map((item) => item.artifactId)).toEqual([
      'resp_voice_1::canvas::0',
      'resp_voice_2::canvas::1',
    ]);
    // Durable archive artifact wins over provisional live projection with identical artifactId
    expect(merged[0]?.messageId).toBe('msg_voice_9');
  });

  it('claims auto-open once per unique live artifact, closes last tab cleanly, and renders exiting panel as inert', () => {
    const seen = new Set<string>();
    expect(claimNewAutoOpenArtifactId([mermaidProjection], seen)).toBe('resp_voice_1::canvas::0');
    expect(claimNewAutoOpenArtifactId([mermaidProjection], seen)).toBeNull();

    // Closing last tab closes panel even if activeCanvasArtifactId had drifted
    const closedLast = chatReducer(
      {
        ...initialChatState,
        canvasOpen: true,
        activeCanvasArtifactId: 'stale_id',
      },
      {
        type: 'CLOSE_CANVAS_TAB',
        payload: { artifactId: 'resp_voice_1::canvas::0', fallbackArtifactId: null },
      },
    );
    expect(closedLast.canvasOpen).toBe(false);
    expect(closedLast.activeCanvasArtifactId).toBeNull();

    expect(CANVAS_TRANSITION_MS).toBeGreaterThanOrEqual(300);
    expect(CANVAS_TRANSITION_MS).toBeLessThanOrEqual(350);
    expect(prefersReducedCanvasMotion({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(prefersReducedCanvasMotion({ matchMedia: () => ({ matches: false }) })).toBe(false);

    const focusSpy = { focus: (opts?: FocusOptions) => opts };
    let focusedWith: FocusOptions | undefined;
    const liveToggle = {
      focus: (opts?: FocusOptions) => {
        focusedWith = opts;
      },
    } as unknown as HTMLElement;
    expect(
      resolveCanvasCloseFocusTarget({
        liveActive: true,
        liveCanvasToggle: liveToggle,
        headerCanvasToggle: focusSpy as unknown as HTMLElement,
      }),
    ).toBe(liveToggle);
    restoreCanvasCloseFocus({ liveActive: true, liveCanvasToggle: liveToggle });
    expect(focusedWith).toEqual({ preventScroll: true });

    const artifact = projectionToCanvasArtifact(mermaidProjection)!;
    const exitingHtml = renderToStaticMarkup(
      createElement(CanvasPanel, {
        artifacts: [artifact],
        activeArtifactId: artifact.artifactId,
        onSelectArtifact: () => {},
        onCloseTab: () => {},
        onClosePanel: () => {},
        transitionState: 'exiting',
      }),
    );
    expect(exitingHtml).toContain('id="aurvin-canvas-panel"');
    expect(exitingHtml).toContain('data-canvas-state="exiting"');
    expect(exitingHtml).toContain('aria-hidden="true"');
    expect(exitingHtml).toContain('inert=""');
  });
});
```

- [ ] **Step 2: Run the focused Canvas test to verify RED**

Run in `frontend`:
```bash
npm test -- src/features/canvas/canvas.test.ts -t "Multimodal voice Canvas projections"
```
Expected: FAIL because `projectionToCanvasArtifact`, `extractVoiceMessageCanvasArtifacts`, `mergeSessionCanvasArtifacts`, `forcedChartKindFromSubType`, `claimNewAutoOpenArtifactId`, `CANVAS_TRANSITION_MS`, `prefersReducedCanvasMotion`, `resolveCanvasCloseFocusTarget`, and `restoreCanvasCloseFocus` are not exported yet.

- [ ] **Step 3: Implement projection conversion, archive validation, session merging, and transition helpers**

1. In `frontend/src/features/canvas/canvas-artifacts.ts`:
   - Update line 22 imports to:
     ```typescript
     import {
       isVisibleMessageCanvasArtifacts,
       type CanvasArtifactProjection,
       type VisibleMessage,
     } from '../../api/protocol.ts';
     import { isCanvasArtifactProjection } from '../../api/voice-protocol.ts';
     ```
   - Update `archivedArtifacts` cache and `collectSessionCanvasArtifacts` (lines 1041–1063), and add the conversion, merge, auto-open, reduced-motion, and focus helpers right after `collectSessionCanvasArtifacts`:

```typescript
export const CANVAS_TRANSITION_MS = 320;
export type CanvasPanelTransitionState = 'open' | 'exiting';

const EXPLICIT_CHART_TYPE_RE =
  /"type"\s*:\s*"(bar|line|area|pie|donut|scatter|point|xy|plot|graph)"|(?:^|\n)\s*type\s*:\s*(bar|line|area|pie|donut|scatter|point|xy|plot|graph)\b/i;

const SAFE_DRAWABLE_SVG_CHILD_RE =
  /<(?:g|path|rect|circle|ellipse|line|polyline|polygon|text|tspan|use)\b/i;

export function forcedChartKindFromSubType(
  subType: string,
  rawSource: string,
): ChartKind | undefined {
  if (EXPLICIT_CHART_TYPE_RE.test(rawSource)) {
    return undefined;
  }
  const lower = subType.trim().toLowerCase();
  if (lower === 'line graph' || lower === 'coordinate graph') return 'line';
  if (lower === 'area graph') return 'area';
  if (lower === 'pie chart') return 'pie';
  if (lower === 'x-y point plot' || lower.includes('scatter') || lower.includes('plot')) {
    return 'scatter';
  }
  if (lower === 'bar chart') return 'bar';
  return undefined;
}

export function buttonLabelForCanvasArtifact(
  kind: CanvasArtifactKind,
  subType: string,
): string {
  const lower = subType.trim().toLowerCase();
  if (kind === 'svg') return 'View diagram';
  if (kind === 'mermaid') {
    if (lower === 'pie chart' || lower === 'timeline chart') return 'View chart';
    if (lower === 'coordinate graph') return 'View graph';
    return 'View diagram';
  }
  if (
    lower.includes('graph') ||
    lower.includes('line') ||
    lower.includes('area') ||
    lower.includes('plot') ||
    lower.includes('scatter') ||
    lower.includes('x-y')
  ) {
    return 'View graph';
  }
  return 'View chart';
}

function isRenderableProjectionSource(projection: CanvasArtifactProjection): boolean {
  const trimmed = projection.rawSource.trim();
  if (!trimmed) return false;
  if (projection.kind === 'mermaid') {
    if (!MERMAID_HEADER_RE.test(trimmed)) return false;
    const parsed = parseMermaidSource(trimmed, projection.title);
    if (parsed.kind === 'chart') return parsed.chart.datasets.length > 0;
    if (parsed.kind === 'sequence') {
      return parsed.participants.length > 0 || parsed.items.length > 0;
    }
    return parsed.nodes.length > 0 || parsed.edges.length > 0;
  }
  if (projection.kind === 'chart') {
    const forced = forcedChartKindFromSubType(projection.subType, trimmed);
    const model = parseChartSource(trimmed, projection.title, forced);
    return Boolean(model && model.datasets.length > 0);
  }
  const cleaned = trimmed
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .trim();
  if (!/^<svg\b[^>]*>[\s\S]*<\/svg>$/i.test(cleaned)) {
    return false;
  }
  return SAFE_DRAWABLE_SVG_CHILD_RE.test(cleaned);
}

export function projectionToCanvasArtifact(
  projection: CanvasArtifactProjection,
  ownerMessageId?: string,
): CanvasArtifact | null {
  try {
    if (!isCanvasArtifactProjection(projection)) return null;
    if (!isRenderableProjectionSource(projection)) return null;
    return {
      artifactId: `${projection.responseId}::canvas::${projection.ordinal}`,
      messageId: ownerMessageId ?? projection.responseId,
      index: projection.ordinal,
      kind: projection.kind,
      subType: projection.subType,
      title: projection.title,
      buttonLabel: buttonLabelForCanvasArtifact(projection.kind, projection.subType),
      rawSource: projection.rawSource,
      isStreaming: false,
    };
  } catch {
    return null;
  }
}

export function extractVoiceMessageCanvasArtifacts(message: VisibleMessage): CanvasArtifact[] {
  if (
    message.role !== 'assistant' ||
    !Object.hasOwn(message, 'canvasArtifacts') ||
    message.canvasArtifacts === undefined
  ) {
    return [];
  }
  if (!isVisibleMessageCanvasArtifacts(message)) {
    return [];
  }
  const result: CanvasArtifact[] = [];
  for (const projection of message.canvasArtifacts) {
    const artifact = projectionToCanvasArtifact(projection, message.messageId);
    if (artifact) {
      result.push(artifact);
    }
  }
  return result;
}

const archivedArtifacts = new WeakMap<
  VisibleMessage,
  {
    content: string;
    messageId: string;
    canvasArtifacts: VisibleMessage['canvasArtifacts'];
    items: CanvasArtifact[];
  }
>();

export function collectSessionCanvasArtifacts(
  messages: readonly VisibleMessage[],
  streamText: string,
  isStreaming: boolean,
): CanvasArtifact[] {
  const result: CanvasArtifact[] = [];
  const seen = new Set<string>();
  const pushUnique = (items: readonly CanvasArtifact[]) => {
    for (const item of items) {
      if (!seen.has(item.artifactId)) {
        seen.add(item.artifactId);
        result.push(item);
      }
    }
  };

  for (const msg of messages) {
    if (msg.role === 'assistant' && (msg.content || msg.canvasArtifacts !== undefined)) {
      let cached = archivedArtifacts.get(msg);
      if (
        !cached ||
        cached.content !== msg.content ||
        cached.messageId !== msg.messageId ||
        cached.canvasArtifacts !== msg.canvasArtifacts
      ) {
        const textItems = msg.content
          ? extractMessageCanvasArtifacts(msg.content, msg.messageId, false)
          : [];
        const voiceItems = extractVoiceMessageCanvasArtifacts(msg);
        cached = {
          content: msg.content,
          messageId: msg.messageId,
          canvasArtifacts: msg.canvasArtifacts,
          items: [...textItems, ...voiceItems],
        };
        archivedArtifacts.set(msg, cached);
      }
      pushUnique(cached.items);
    }
  }
  if (isStreaming && streamText) {
    pushUnique(extractMessageCanvasArtifacts(streamText, 'streaming_in_flight', true));
  }
  return result;
}

export function mergeSessionCanvasArtifacts(
  archived: readonly CanvasArtifact[],
  liveProjections: readonly CanvasArtifactProjection[],
): CanvasArtifact[] {
  if (liveProjections.length === 0) {
    return [...archived];
  }
  const merged = [...archived];
  const seen = new Set(archived.map((item) => item.artifactId));
  for (const projection of liveProjections) {
    const artifact = projectionToCanvasArtifact(projection, projection.responseId);
    if (artifact && !seen.has(artifact.artifactId)) {
      seen.add(artifact.artifactId);
      merged.push(artifact);
    }
  }
  return merged;
}

export function claimNewAutoOpenArtifactId(
  liveProjections: readonly CanvasArtifactProjection[],
  seenArtifactIds: Set<string>,
): string | null {
  let newestUnseenId: string | null = null;
  for (const projection of liveProjections) {
    const artifact = projectionToCanvasArtifact(projection, projection.responseId);
    if (artifact && !seenArtifactIds.has(artifact.artifactId)) {
      seenArtifactIds.add(artifact.artifactId);
      newestUnseenId = artifact.artifactId;
    }
  }
  return newestUnseenId;
}

export function prefersReducedCanvasMotion(
  win: { matchMedia?: (query: string) => { matches: boolean } } | undefined =
    typeof window !== 'undefined' ? window : undefined,
): boolean {
  return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

export type CanvasCloseFocusTargets = {
  liveActive: boolean;
  liveCanvasToggle?: HTMLElement | null;
  liveSurface?: HTMLElement | null;
  headerCanvasToggle?: HTMLElement | null;
  composer?: HTMLElement | null;
};

export function resolveCanvasCloseFocusTarget(
  targets: CanvasCloseFocusTargets,
): HTMLElement | null {
  if (targets.liveActive) {
    return targets.liveCanvasToggle ?? targets.liveSurface ?? null;
  }
  return targets.headerCanvasToggle ?? targets.composer ?? null;
}

export function restoreCanvasCloseFocus(
  targets: CanvasCloseFocusTargets,
): HTMLElement | null {
  const target = resolveCanvasCloseFocusTarget(targets);
  target?.focus({ preventScroll: true });
  return target;
}

export type CanvasShortcutKeyEvent = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
};

export function handleLiveCanvasShortcut(
  event: CanvasShortcutKeyEvent,
  canvas?: { artifactCount: number; onToggle: () => void },
): boolean {
  const target = event.target as Element | null;
  if (
    !canvas ||
    canvas.artifactCount <= 0 ||
    event.repeat ||
    event.defaultPrevented ||
    event.isComposing ||
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.key.toLowerCase() !== 'c' ||
    target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  ) {
    return false;
  }
  event.preventDefault();
  canvas.onToggle();
  return true;
}
```

2. In `frontend/src/features/canvas/CanvasPanel.tsx`:
   - Update imports (lines 20–21) to:
     ```typescript
     import { useEffect, useRef, useState, type Ref } from 'react';
     import {
       computeWheelZoomView,
       forcedChartKindFromSubType,
       parseChartSource,
       type CanvasPanelTransitionState,
     } from './canvas-artifacts.ts';
     ```
   - Extend `CanvasPanel` props (lines 64–76) with optional `transitionState = 'open'` and `panelRef`:
     ```typescript
     export function CanvasPanel({
       artifacts,
       activeArtifactId,
       onSelectArtifact,
       onCloseTab,
       onClosePanel,
       transitionState = 'open',
       panelRef,
     }: {
       artifacts: CanvasArtifact[];
       activeArtifactId: string | null;
       onSelectArtifact: (artifactId: string) => void;
       onCloseTab: (artifactId: string) => void;
       onClosePanel: () => void;
       transitionState?: CanvasPanelTransitionState;
       panelRef?: Ref<HTMLElement>;
     }) {
     ```
   - Update `<aside>` (lines 189–193) to carry `id="aurvin-canvas-panel"`, `ref={panelRef}`, `data-canvas-state={transitionState}`, `aria-hidden={transitionState === 'exiting' ? 'true' : undefined}`, and `inert={transitionState === 'exiting'}`:
     ```tsx
     const isExiting = transitionState === 'exiting';
     ```
     ```tsx
     <aside
       ref={panelRef}
       id="aurvin-canvas-panel"
       className={`aurvin-canvas-panel${maximized ? ' aurvin-canvas-panel-maximized' : ''}`}
       aria-label="Aurvin's Canvas"
       data-active-artifact-id={activeArtifact.artifactId}
       data-canvas-state={transitionState}
       aria-hidden={isExiting ? 'true' : undefined}
       inert={isExiting}
     >
     ```
   - Update `<ChartRenderer>` (lines 418–423) to pass the subtype-aware parsed `ChartModel`:
     ```tsx
     ) : activeArtifact.kind === 'chart' ? (
       <ChartRenderer
         source={activeArtifact.rawSource}
         title={activeArtifact.title}
         model={parseChartSource(
           activeArtifact.rawSource,
           activeArtifact.title,
           forcedChartKindFromSubType(activeArtifact.subType, activeArtifact.rawSource),
         )}
       />
     ```

3. In `frontend/src/features/canvas/index.ts`, export the new helpers and types:
   ```typescript
   export {
     buttonLabelForCanvasArtifact,
     CANVAS_TRANSITION_MS,
     claimNewAutoOpenArtifactId,
     collectSessionCanvasArtifacts,
     computeWheelZoomView,
     extractMessageCanvasArtifacts,
     extractVoiceMessageCanvasArtifacts,
     forcedChartKindFromSubType,
     handleLiveCanvasShortcut,
     mergeSessionCanvasArtifacts,
     parseCanvasCodeBlock,
     parseChartSource,
     parseMermaidSource,
     prefersReducedCanvasMotion,
     preprocessCanvasTags,
     projectionToCanvasArtifact,
     resolveCanvasCloseFocusTarget,
     restoreCanvasCloseFocus,
   } from './canvas-artifacts.ts';
   export type {
     CanvasCloseFocusTargets,
     CanvasPanelTransitionState,
     CanvasShortcutKeyEvent,
   } from './canvas-artifacts.ts';
   ```

4. In `frontend/src/features/chat/state/chat-reducer.ts`, update `CLOSE_CANVAS_TAB` (lines 203–217) so closing the last open tab (`fallbackArtifactId === null`) always closes the panel cleanly:
   ```typescript
   case 'CLOSE_CANVAS_TAB': {
     const closed = state.closedCanvasArtifactIds.includes(action.payload.artifactId)
       ? state.closedCanvasArtifactIds
       : [...state.closedCanvasArtifactIds, action.payload.artifactId];
     const nextActive =
       action.payload.fallbackArtifactId === null
         ? null
         : state.activeCanvasArtifactId === action.payload.artifactId
           ? action.payload.fallbackArtifactId
           : state.activeCanvasArtifactId;
     return {
       ...state,
       closedCanvasArtifactIds: closed,
       activeCanvasArtifactId: nextActive,
       canvasOpen: nextActive !== null ? state.canvasOpen : false,
     };
   }
   ```

- [ ] **Step 4: Run Canvas tests to verify GREEN**

Run in `frontend`:
```bash
npm test -- src/features/canvas/canvas.test.ts
```
Expected: PASS (all existing and new Canvas tests pass).

- [ ] **Step 5: Commit Task 1**

Coordinate shared Git index access with the orchestrator, then run:
```bash
git add frontend/src/features/canvas/canvas-artifacts.ts frontend/src/features/canvas/CanvasPanel.tsx frontend/src/features/canvas/index.ts frontend/src/features/chat/state/chat-reducer.ts frontend/src/features/canvas/canvas.test.ts
git commit -m "feat(voice-canvas): add projection conversion, archive merge, and exit helpers"
```

---

### Task 2: Live Voice Reducer & Controller `canvas.artifact` Handling, Pre-Audio Arrival, Deduplication, and Cancellation Fencing

**Files:**
- Modify: `frontend/src/features/voice/state/live-voice-reducer.ts`
- Modify: `frontend/src/features/voice/state/live-voice-controller.ts`
- Modify: `frontend/src/features/voice/state/useLiveVoice.ts`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/features/voice/state/live-voice-reducer.test.ts`
- Test: `frontend/src/features/voice/state/live-voice-controller.test.ts`

- [ ] **Step 1: Write the failing reducer and controller tests**

1. Append to `frontend/src/features/voice/state/live-voice-reducer.test.ts`:

```typescript
it('retains accepted Canvas artifacts across interrupt, pause, and user hang-up while clearing on navigation or new start', () => {
  const artifact = {
    responseId: 'resp-1',
    ordinal: 0,
    kind: 'mermaid' as const,
    subType: 'Flowchart',
    title: 'Pipeline',
    rawSource: 'flowchart TD\nA --> B',
  };
  let state = liveVoiceReducer(initialLiveVoice, { type: 'START', conversationId: null });
  state = liveVoiceReducer(state, { type: 'READY', resumeRequired: false });
  state = liveVoiceReducer(state, { type: 'CONVERSATION_BOUND', conversationId: 'conv-1' });
  state = liveVoiceReducer(state, { type: 'ARTIFACT_ACCEPTED', artifact });
  // Duplicate identity does not duplicate in reducer state
  state = liveVoiceReducer(state, { type: 'ARTIFACT_ACCEPTED', artifact });
  expect(state.conversationId).toBe('conv-1');
  expect(state.artifacts).toEqual([artifact]);

  state = liveVoiceReducer(state, { type: 'INTERRUPT' });
  expect(state.artifacts).toEqual([artifact]);

  state = liveVoiceReducer(state, { type: 'PAUSE', notice: 'Paused', canResume: true });
  expect(state.artifacts).toEqual([artifact]);

  // User hang-up retains provisional artifacts across ENDING/EXIT bridge
  const endingUser = liveVoiceReducer(state, {
    type: 'ENDING',
    notice: null,
    restoreDraft: null,
    retainArtifacts: true,
  });
  expect(endingUser.artifacts).toEqual([artifact]);
  const exitedUser = liveVoiceReducer(endingUser, {
    type: 'EXIT',
    notice: null,
    retainArtifacts: true,
  });
  expect(exitedUser.artifacts).toEqual([artifact]);
  expect(exitedUser.conversationId).toBe('conv-1');

  // Navigation exit clears immediately so artifacts never leak across conversations
  const exitedNav = liveVoiceReducer(state, {
    type: 'ENDING',
    notice: null,
    restoreDraft: null,
    retainArtifacts: false,
  });
  expect(exitedNav.artifacts).toEqual([]);
  expect(exitedNav.conversationId).toBeNull();

  // Next call START resets artifacts
  const restarted = liveVoiceReducer(exitedUser, { type: 'START', conversationId: 'conv-2' });
  expect(restarted.artifacts).toEqual([]);
  expect(restarted.conversationId).toBe('conv-2');
});
```

2. Append to `frontend/src/features/voice/state/live-voice-controller.test.ts`:

```typescript
it('accepts pre-audio canvas.artifact events, deduplicates by responseId+ordinal, allows ordinal gaps, and auto-opens once', async () => {
  const openCanvasArtifact = vi.fn();
  const f = liveVoiceFixture({
    bindings: {
      claimVoiceInput: vi.fn((_mode: 'live', _onClose: () => void) => 'lease-1'),
      writeVoiceDraft: vi.fn(() => true),
      releaseVoiceInput: vi.fn(),
      bindVoiceConversation: vi.fn(() => true),
      refreshSessions: vi.fn(),
      openCanvasArtifact,
    },
  });
  await f.begin();
  f.event({ type: 'conversation.bound', conversationId: 'conv-live-1' });

  // Arrives BEFORE audio.start; ordinal 0 succeeded, ordinal 1 was skipped on server, ordinal 2 succeeded
  f.event({
    type: 'canvas.artifact',
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 0,
    kind: 'mermaid',
    subType: 'Flowchart',
    title: 'Step One',
    rawSource: 'flowchart TD\n  A --> B',
  });
  // Exact duplicate replay of ordinal 0
  f.event({
    type: 'canvas.artifact',
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 0,
    kind: 'mermaid',
    subType: 'Flowchart',
    title: 'Step One',
    rawSource: 'flowchart TD\n  A --> B',
  });
  f.event({
    type: 'canvas.artifact',
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 2,
    kind: 'chart',
    subType: 'Line Graph',
    title: 'Latency',
    rawSource: 'Mon: 12\nTue: 9',
  });
  // Out-of-sequence descending ordinal 1 after ordinal 2 must be discarded
  f.event({
    type: 'canvas.artifact',
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 1,
    kind: 'chart',
    subType: 'Bar Chart',
    title: 'Late Middle',
    rawSource: 'Q1: 10\nQ2: 20',
  });

  expect(f.controller.getSnapshot().conversationId).toBe('conv-live-1');
  expect(f.controller.getSnapshot().artifacts.map((a) => `${a.responseId}::canvas::${a.ordinal}`)).toEqual([
    'resp-1::canvas::0',
    'resp-1::canvas::2',
  ]);
  expect(openCanvasArtifact).toHaveBeenCalledTimes(2);
  expect(openCanvasArtifact).toHaveBeenNthCalledWith(1, 'resp-1::canvas::0');
  expect(openCanvasArtifact).toHaveBeenNthCalledWith(2, 'resp-1::canvas::2');

  // Audio starts afterward for the same turn/response without disturbing accepted artifacts
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'resp-1', sampleRate: 24000, firstAudioSequence: 0 });
  expect(f.controller.getSnapshot().agent).toBe('speaking');
  expect(f.controller.getSnapshot().artifacts).toHaveLength(2);
  f.controller.exit();
  await settle();
});

it('discards malformed, oversized, stale-epoch, and unrenderable canvas.artifact payloads without failing the call', async () => {
  const openCanvasArtifact = vi.fn();
  const f = liveVoiceFixture({
    bindings: {
      claimVoiceInput: vi.fn(() => 'lease-1'),
      writeVoiceDraft: vi.fn(() => true),
      releaseVoiceInput: vi.fn(),
      bindVoiceConversation: vi.fn(() => true),
      refreshSessions: vi.fn(),
      openCanvasArtifact,
    },
  });
  await f.begin();

  const base = {
    type: 'canvas.artifact' as const,
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 0,
    kind: 'mermaid' as const,
    subType: 'Flowchart',
    title: 'Valid',
    rawSource: 'flowchart TD\n  A --> B',
  };

  // Wrong epoch
  f.event(base, f.response.connectionEpoch + 1);
  // Malformed ordinal, oversized title, oversized rawSource, empty Mermaid nodes, empty SVG
  for (const invalid of [
    { ...base, ordinal: 3 },
    { ...base, ordinal: -1 },
    { ...base, turnId: 'bad turn id' },
    { ...base, title: 'T'.repeat(121) },
    { ...base, subType: 'S'.repeat(49) },
    { ...base, rawSource: 'X'.repeat(8193) },
    { ...base, rawSource: 'flowchart TD' },
    { ...base, kind: 'svg' as const, subType: 'SVG Visual', rawSource: '<svg><script>alert(1)</script></svg>' },
  ]) {
    f.event(invalid);
  }

  expect(f.controller.getSnapshot().phase).toBe('active');
  expect(f.controller.getSnapshot().errorCode).toBeNull();
  expect(f.controller.getSnapshot().artifacts).toEqual([]);
  expect(openCanvasArtifact).not.toHaveBeenCalled();

  // Call stays completely healthy and accepts a subsequent valid artifact
  f.event(base);
  expect(f.controller.getSnapshot().artifacts).toHaveLength(1);
  expect(openCanvasArtifact).toHaveBeenCalledExactlyOnceWith('resp-1::canvas::0');
  f.controller.exit();
  await settle();
});

it('retains accepted artifacts on barge-in and response.cancelled while rejecting cancelled in-flight and retired-turn artifacts', async () => {
  const f = liveVoiceFixture();
  await f.begin();

  // Turn 1: ordinal 0 accepted before audio, then audio starts, then user interrupts (barge-in)
  f.event({
    type: 'canvas.artifact',
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 0,
    kind: 'mermaid',
    subType: 'Flowchart',
    title: 'Retained On Barge-In',
    rawSource: 'flowchart TD\n  Start --> Keep',
  });
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'resp-1', sampleRate: 24000, firstAudioSequence: 0 });
  f.audio('resp-1');
  f.controller.interrupt();

  // Late artifact for interrupted resp-1 must be rejected
  f.event({
    type: 'canvas.artifact',
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 1,
    kind: 'mermaid',
    subType: 'Flowchart',
    title: 'Cancelled Late',
    rawSource: 'flowchart TD\n  Late --> Drop',
  });
  expect(f.controller.getSnapshot().artifacts.map((a) => a.title)).toEqual(['Retained On Barge-In']);

  // Turn 2: pre-audio response.cancelled fences late pre-audio artifact and late audio.start
  f.event({
    type: 'canvas.artifact',
    turnId: 't2',
    responseId: 'resp-2',
    ordinal: 0,
    kind: 'chart',
    subType: 'Bar Chart',
    title: 'Turn 2 Kept',
    rawSource: 'A: 10\nB: 20',
  });
  f.event({ type: 'response.cancelled', turnId: 't2', responseId: 'resp-2', lastAudioSequence: null });
  f.event({
    type: 'canvas.artifact',
    turnId: 't2',
    responseId: 'resp-2',
    ordinal: 1,
    kind: 'chart',
    subType: 'Bar Chart',
    title: 'Turn 2 Dropped After Cancel',
    rawSource: 'C: 30\nD: 40',
  });

  // Turn 3 retires prior turns; late Turn 2 or Turn 1 events stay rejected
  f.event({
    type: 'canvas.artifact',
    turnId: 't3',
    responseId: 'resp-3',
    ordinal: 0,
    kind: 'chart',
    subType: 'Pie Chart',
    title: 'Turn 3 Fresh',
    rawSource: '{"type":"pie","labels":["X","Y"],"datasets":[{"label":"P","data":[70,30]}]}',
  });

  expect(f.controller.getSnapshot().artifacts.map((a) => a.title)).toEqual([
    'Retained On Barge-In',
    'Turn 2 Kept',
    'Turn 3 Fresh',
  ]);
  f.controller.exit();
  await settle();
});
```

- [ ] **Step 2: Run the focused reducer and controller tests to verify RED**

Run in `frontend`:
```bash
npm test -- src/features/voice/state/live-voice-reducer.test.ts src/features/voice/state/live-voice-controller.test.ts -t "Canvas|canvas.artifact|barge-in"
```
Expected: FAIL because `LiveVoiceState.artifacts`, `LiveVoiceState.conversationId`, `ARTIFACT_ACCEPTED`, `CONVERSATION_BOUND`, and `LiveVoiceController` `canvas.artifact` handling do not exist yet.

- [ ] **Step 3: Implement `liveVoiceReducer`, `LiveVoiceController`, `useLiveVoice`, and `App` bindings**

1. Replace `frontend/src/features/voice/state/live-voice-reducer.ts` with:

```typescript
/**
 * ============================================================================
 * FILE: live-voice-reducer.ts
 * LOCATION: frontend/src/features/voice/state/live-voice-reducer.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Independent operational state reducer for live duplex voice and Canvas.
 *
 * ROLE IN PROJECT:
 *    Models independent input (listening/suspended/muted), agent, connection,
 *    paused/blocked call recovery, bound conversation identity, and accepted
 *    provisional Canvas artifact projections without a transcript field.
 *
 * KEY COMPONENTS:
 *    - liveVoiceReducer: Reducer managing operational phase, status, and visuals.
 *    - initialLiveVoice: Initial state baseline.
 *    - showsLiveVoice: Predicate for showing the live surface.
 * ============================================================================
 */

import type {
  CanvasArtifactProjection,
  VoiceResponseRef,
} from '../../../api/voice-protocol.ts';

export type LiveDraft = {
  text: string;
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
};

export type LiveVoiceState = {
  phase: 'idle' | 'requesting_permission' | 'connecting' | 'active' | 'suspended' | 'ending';
  input: 'listening' | 'muted' | 'suspended';
  agent: 'idle' | 'thinking' | 'speaking';
  connection: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  response: VoiceResponseRef | null;
  resumeRequired: boolean;
  inputBusy: boolean;
  canResume: boolean;
  errorCode: string | null;
  notice: string | null;
  restoreDraft: LiveDraft | null;
  conversationId: string | null;
  artifacts: CanvasArtifactProjection[];
};

export const initialLiveVoice: LiveVoiceState = {
  phase: 'idle',
  input: 'listening',
  agent: 'idle',
  connection: 'connecting',
  response: null,
  resumeRequired: false,
  inputBusy: false,
  canResume: false,
  errorCode: null,
  notice: null,
  restoreDraft: null,
  conversationId: null,
  artifacts: [],
};

export type LiveVoiceAction =
  | { type: 'START'; conversationId?: string | null }
  | { type: 'CONNECTING' | 'LOST' | 'RESUMED' | 'INTERRUPT' }
  | { type: 'READY'; resumeRequired: boolean }
  | { type: 'CONVERSATION_BOUND'; conversationId: string }
  | { type: 'ARTIFACT_ACCEPTED'; artifact: CanvasArtifactProjection }
  | { type: 'INPUT'; input: LiveVoiceState['input'] }
  | { type: 'INPUT_BUSY'; value: boolean }
  | { type: 'AGENT'; agent: LiveVoiceState['agent'] }
  | { type: 'AUDIO_START'; ref: VoiceResponseRef }
  | { type: 'DRAINED'; responseId: string }
  | { type: 'SUSPEND' | 'NOTICE'; notice: string }
  | { type: 'PAUSE'; notice: string; canResume: boolean; code?: string; disconnected?: boolean }
  | {
      type: 'ENDING';
      notice: string | null;
      restoreDraft: LiveDraft | null;
      retainArtifacts?: boolean;
    }
  | { type: 'EXIT'; notice: string | null; retainArtifacts?: boolean };

export function liveVoiceReducer(
  state: LiveVoiceState,
  action: LiveVoiceAction,
): LiveVoiceState {
  switch (action.type) {
    case 'START':
      return {
        ...initialLiveVoice,
        phase: 'requesting_permission',
        conversationId: action.conversationId ?? null,
      };
    case 'CONNECTING':
      return { ...state, phase: 'connecting', connection: 'connecting' };
    case 'READY':
      return {
        ...state,
        connection: 'connected',
        resumeRequired: action.resumeRequired,
        phase: action.resumeRequired ? 'suspended' : 'active',
        canResume: action.resumeRequired
          ? state.errorCode
            ? state.canResume
            : true
          : state.canResume,
      };
    case 'CONVERSATION_BOUND':
      return state.conversationId === action.conversationId
        ? state
        : { ...state, conversationId: action.conversationId };
    case 'ARTIFACT_ACCEPTED': {
      const exists = state.artifacts.some(
        (item) =>
          item.responseId === action.artifact.responseId &&
          item.ordinal === action.artifact.ordinal,
      );
      return exists ? state : { ...state, artifacts: [...state.artifacts, action.artifact] };
    }
    case 'INPUT':
      return { ...state, input: action.input };
    case 'INPUT_BUSY':
      return { ...state, inputBusy: action.value };
    case 'AGENT':
      return state.response && action.agent === 'idle'
        ? state
        : {
            ...state,
            agent: action.agent === 'speaking' && !state.response ? 'thinking' : action.agent,
          };
    case 'AUDIO_START':
      return { ...state, agent: 'speaking', response: action.ref };
    case 'DRAINED':
      return state.response?.responseId === action.responseId
        ? { ...state, agent: 'idle', response: null }
        : state;
    case 'INTERRUPT':
      return { ...state, agent: 'idle', response: null };
    case 'LOST':
      return {
        ...state,
        phase: 'suspended',
        connection: 'reconnecting',
        resumeRequired: true,
        canResume: false,
        agent: 'idle',
        response: null,
        inputBusy: false,
        notice: 'Connection lost. Reconnecting; you may need to repeat your last turn.',
      };
    case 'SUSPEND':
      return {
        ...state,
        phase: 'suspended',
        resumeRequired: true,
        canResume: state.connection === 'connected',
        agent: 'idle',
        response: null,
        inputBusy: false,
        notice: action.notice,
      };
    case 'PAUSE':
      return {
        ...state,
        phase: 'suspended',
        resumeRequired: true,
        canResume: action.canResume,
        errorCode: action.code ?? null,
        connection: action.disconnected ? 'disconnected' : state.connection,
        response: null,
        agent: 'idle',
        inputBusy: false,
        notice: action.notice,
      };
    case 'RESUMED':
      return {
        ...state,
        phase: 'active',
        resumeRequired: false,
        notice: null,
        canResume: false,
        errorCode: null,
        inputBusy: false,
      };
    case 'NOTICE':
      return { ...state, notice: action.notice };
    case 'ENDING':
      return {
        ...state,
        phase: 'ending',
        response: null,
        agent: 'idle',
        resumeRequired: false,
        inputBusy: false,
        notice: action.notice,
        restoreDraft: action.restoreDraft,
        conversationId: action.retainArtifacts ? state.conversationId : null,
        artifacts: action.retainArtifacts ? state.artifacts : [],
      };
    case 'EXIT':
      return {
        ...initialLiveVoice,
        notice: action.notice,
        restoreDraft: state.restoreDraft,
        conversationId: action.retainArtifacts ? state.conversationId : null,
        artifacts: action.retainArtifacts ? state.artifacts : [],
      };
  }
}

export const showsLiveVoice = (state: LiveVoiceState) =>
  state.phase !== 'idle' && state.phase !== 'ending';
```

2. In `frontend/src/features/voice/state/live-voice-controller.ts`:
   - Update imports (lines 24–28) to include `MAX_VOICE_CONTROL_BYTES`, `isCanvasArtifactId`, `isCanvasArtifactProjection`, `isCanvasArtifactProjectionList`, `type CanvasArtifactPayload`, and `type CanvasArtifactProjection` from `../../../api/voice-protocol.ts`, plus `projectionToCanvasArtifact` from `../../canvas/canvas-artifacts.ts`.
   - Extend `LiveVoiceBindings` (lines 30–39) with optional `openCanvasArtifact?: (artifactId: string) => void;`.
   - Extend `Run` (lines 49–65) with bounded per-run artifact tracking fields (`MAX_TRACKED_RESPONSES = 4096`):
     ```typescript
     // ponytail: bounded to 4096 responses per live session matching VoiceClient.responsesSeen ceiling.
     turnByResponse: Map<string, string>;
     projectionsByResponse: Map<string, CanvasArtifactProjection[]>;
     cancelledResponses: Set<string>;
     retiredResponses: Set<string>;
     activeArtifactResponse: VoiceResponseRef | null;
     ```
   - Initialize those five fields in `start()` (`turnByResponse: new Map()`, `projectionsByResponse: new Map()`, `cancelledResponses: new Set()`, `retiredResponses: new Set()`, `activeArtifactResponse: null`), dispatch `{ type: 'START', conversationId }`, and when `run.session` is created in `activate()` (after line 290), if `run.session.conversationId` is non-null, dispatch `{ type: 'CONVERSATION_BOUND', conversationId: run.session.conversationId }`.
   - In `pause()`, `suspend()`, and `lost()`, fence any in-flight `run.response` or `run.activeArtifactResponse` by adding its `responseId` to `run.cancelledResponses` (if `size < 4096`) and clearing `run.activeArtifactResponse = null` while leaving already-accepted `this.view.artifacts` untouched.
   - Add a private helper `acceptCanvasArtifact(run: Run, event: VoiceServerEvent & CanvasArtifactPayload)` on `LiveVoiceController`:
     ```typescript
     private acceptCanvasArtifact(run: Run, event: VoiceServerEvent & CanvasArtifactPayload) {
       if (!run.ready || this.view.phase !== 'active' || run.needsGesture) return;
       if (!isCanvasArtifactId(event.turnId) || !isCanvasArtifactId(event.responseId)) return;
       if (
         new TextEncoder().encode(JSON.stringify(event)).byteLength > MAX_VOICE_CONTROL_BYTES
       ) {
         return;
       }
       const projection: CanvasArtifactProjection = {
         responseId: event.responseId,
         ordinal: event.ordinal,
         kind: event.kind,
         subType: event.subType,
         title: event.title,
         rawSource: event.rawSource,
       };
       if (!isCanvasArtifactProjection(projection)) return;
       if (
         run.cancelledResponses.has(event.responseId) ||
         run.retiredResponses.has(event.responseId)
       ) {
         return;
       }
       const knownTurn = run.turnByResponse.get(event.responseId);
       if (knownTurn !== undefined && knownTurn !== event.turnId) return;
       if (
         run.response &&
         run.response.responseId !== event.responseId &&
         run.response.turnId === event.turnId
       ) {
         return;
       }
       if (knownTurn === undefined && run.turnByResponse.size >= 4096) return;

       const existing = run.projectionsByResponse.get(event.responseId) ?? [];
       if (existing.some((item) => item.ordinal === projection.ordinal)) {
         return; // Idempotent duplicate delivery of already-accepted ordinal
       }
       const nextForResponse = [...existing, projection];
       if (!isCanvasArtifactProjectionList(nextForResponse)) return;

       const converted = projectionToCanvasArtifact(projection, projection.responseId);
       if (!converted) return;

       if (
         run.activeArtifactResponse &&
         run.activeArtifactResponse.responseId !== event.responseId
       ) {
         if (run.retiredResponses.size < 4096) {
           run.retiredResponses.add(run.activeArtifactResponse.responseId);
         }
       }
       run.turnByResponse.set(event.responseId, event.turnId);
       run.projectionsByResponse.set(event.responseId, nextForResponse);
       run.activeArtifactResponse = { turnId: event.turnId, responseId: event.responseId };

       this.dispatch({ type: 'ARTIFACT_ACCEPTED', artifact: projection });
       this.ports.bindings.openCanvasArtifact?.(converted.artifactId);
     }
     ```
   - Update `event(run, event)` (lines 374–408):
     - In `case 'conversation.bound':`: after updating `run.session`, add `this.dispatch({ type: 'CONVERSATION_BOUND', conversationId: event.conversationId });`.
     - Add `case 'canvas.artifact': this.acceptCanvasArtifact(run, event); break;`.
     - In `case 'audio.start':`:
       ```typescript
       case 'audio.start': {
         if (run.cancelledResponses.has(event.responseId)) {
           run.client?.invalidate(event.responseId);
           break;
         }
         const boundTurn = run.turnByResponse.get(event.responseId);
         if (boundTurn !== undefined && boundTurn !== event.turnId) break;
         if (
           run.activeArtifactResponse &&
           run.activeArtifactResponse.responseId !== event.responseId &&
           run.retiredResponses.size < 4096
         ) {
           run.retiredResponses.add(run.activeArtifactResponse.responseId);
         }
         if (run.turnByResponse.size < 4096) {
           run.turnByResponse.set(event.responseId, event.turnId);
         }
         run.activeArtifactResponse = { turnId: event.turnId, responseId: event.responseId };
         run.response = { turnId: event.turnId, responseId: event.responseId };
         run.responseHasAudio = false;
         run.responseHasOrigin = event.firstAudioSample !== undefined;
         run.playback.begin(event.turnId, event.responseId, event.firstAudioSample);
         if (run.needsGesture) this.interrupt();
         else this.dispatch({ type: 'AUDIO_START', ref: run.response });
         break;
       }
       ```
     - In `case 'response.cancelled':`:
       ```typescript
       case 'response.cancelled':
         if (run.cancelledResponses.size < 4096) {
           run.cancelledResponses.add(event.responseId);
         }
         if (run.activeArtifactResponse?.responseId === event.responseId) {
           run.activeArtifactResponse = null;
         }
         if (run.response?.responseId === event.responseId) {
           this.interrupt(false);
         } else if (!run.response && this.view.agent !== 'idle') {
           this.dispatch({ type: 'INTERRUPT' });
         }
         break;
       ```
   - Update `poll(run)` (lines 438–440) when `DRAINED` completes so `run.retiredResponses.add(ref.responseId)` (bounded `< 4096`) and `if (run.activeArtifactResponse?.responseId === ref.responseId) run.activeArtifactResponse = null`.
   - Update `interrupt(notify = true)` (lines 482–490) to also fence pre-audio `activeArtifactResponse` and add `responseId` to `run.cancelledResponses`:
     ```typescript
     interrupt(notify = true) {
       const run = this.run;
       if (!run) return;
       const ref = run.response;
       if (!ref) {
         if (run.activeArtifactResponse) {
           if (run.cancelledResponses.size < 4096) {
             run.cancelledResponses.add(run.activeArtifactResponse.responseId);
           }
           run.client?.invalidate(run.activeArtifactResponse.responseId);
           run.activeArtifactResponse = null;
           if (this.view.agent !== 'idle') this.dispatch({ type: 'INTERRUPT' });
         }
         return;
       }
       if (run.cancelledResponses.size < 4096) {
         run.cancelledResponses.add(ref.responseId);
       }
       if (run.activeArtifactResponse?.responseId === ref.responseId) {
         run.activeArtifactResponse = null;
       }
       const progress = run.playback.interrupt(); // Immediate local silence before any transport call.
       run.client?.invalidate(ref.responseId);
       run.response = null;
       this.dispatch({ type: 'INTERRUPT' });
       if (
         notify &&
         run.ready &&
         (run.responseHasAudio || run.responseHasOrigin) &&
         !run.client?.control({
           type: 'response.interrupt',
           ...ref,
           playbackPositionMs: progress.playedMs,
           playedSamples: progress.playedSamples,
         }) &&
         run.ready
       ) {
         this.fail(run, 'VOICE_RECONNECT_TIMEOUT');
       }
     }
     ```
   - Update `exit(reason: LiveExitReason = 'user', notice: string | null = null)` (lines 577–595) to retain provisional artifacts only on `reason === 'user'` and trigger `refreshSessions(conversationId)` **before** dispatching `EXIT` so `state.messagesLoading` bridges seamlessly until authoritative `MESSAGES_LOADED` arrives:
     ```typescript
     const retainArtifacts = reason === 'user';
     this.dispatch({
       type: 'ENDING',
       notice,
       restoreDraft: written && reason === 'user' ? run.draft : null,
       retainArtifacts,
     });
     const conversationId = run.session?.conversationId || undefined;
     const voiceSessionId = run.session?.sessionId;
     const durationSeconds = run.startedAt
       ? Math.max(1, Math.round((Date.now() - run.startedAt) / 1000))
       : undefined;
     const startedAt = run.startedAt
       ? new Date(run.startedAt).toISOString()
       : new Date().toISOString();

     this.ports.bindings.refreshSessions(
       conversationId,
       voiceSessionId && durationSeconds !== undefined
         ? { voiceSessionId, durationSeconds, startedAt }
         : undefined,
     );

     void Promise.allSettled([stopping, run.playback.dispose(), this.endSession(run)]).then(
       (results) => {
         const endedNotice = results.some((result) => result.status === 'rejected')
           ? liveVoiceNotice('REMOTE_END_UNCONFIRMED')
           : notice;
         this.ports.bindings.refreshSessions(conversationId);
         this.dispatch({ type: 'EXIT', notice: endedNotice, retainArtifacts });
       },
     );
     ```

3. In `frontend/src/features/voice/state/useLiveVoice.ts` (lines 47–56), forward optional `openCanvasArtifact`:
   ```typescript
   openCanvasArtifact: (artifactId) =>
     latest.current.bindings.openCanvasArtifact?.(artifactId),
   ```

4. In `frontend/src/App.tsx` (lines 94–117), add `openCanvasArtifact` to `useLiveVoice` `bindings`:
   ```typescript
   openCanvasArtifact: (artifactId) =>
     dispatch({ type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId } }),
   ```

- [ ] **Step 4: Run reducer, controller, and App assembly tests to verify GREEN**

Run in `frontend`:
```bash
npm test -- src/features/voice/state/live-voice-reducer.test.ts src/features/voice/state/live-voice-controller.test.ts src/App.assembly.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Coordinate shared Git index access with the orchestrator, then run:
```bash
git add frontend/src/features/voice/state/live-voice-reducer.ts frontend/src/features/voice/state/live-voice-controller.ts frontend/src/features/voice/state/useLiveVoice.ts frontend/src/App.tsx frontend/src/features/voice/state/live-voice-reducer.test.ts frontend/src/features/voice/state/live-voice-controller.test.ts
git commit -m "feat(voice-canvas): handle live canvas.artifact events with pre-audio and barge-in fencing"
```

---

### Task 3: Live Voice Controls (`Stop speaking` & `Canvas (N)` Toggle), Keyboard Shortcut, and Responsive Call-Bar Styles

**Files:**
- Modify: `frontend/src/features/voice/live/LiveVoiceControls.tsx`
- Modify: `frontend/src/features/voice/live/LiveVoicePanel.tsx`
- Modify: `frontend/src/features/voice/live/live-voice.css`
- Test: `frontend/src/features/voice/live/live-voice-controls.test.ts`
- Test: `frontend/src/features/voice/live/live-voice-surface.test.ts`

- [ ] **Step 1: Write failing control, surface, and shortcut tests**

1. Replace lines 41–61 of `frontend/src/features/voice/live/live-voice-controls.test.ts` and append Canvas toggle assertions so the file tests both idle (2-button) and active-speaking (`Stop speaking`) + Canvas toggle (`aria-expanded`, count badge, usable while paused/suspended and omitted when count is 0):

```typescript
it('exposes pressed mute state, accessible Stop speaking during active response, and Hang up without tooltips', () => {
  const idleProps: LiveVoiceControlsProps = {
    ...props(),
    view: { ...props().view, agent: 'idle', response: null },
  };
  const idleHtml = renderToStaticMarkup(createElement(LiveVoiceControls, idleProps));
  expect(idleHtml.match(/type="button"/g)).toHaveLength(2);
  expect(idleHtml).toContain('aria-label="Mute microphone"');
  expect(idleHtml).toContain('aria-pressed="false"');
  expect(idleHtml).toContain('aria-label="Hang up"');
  expect(idleHtml).not.toContain('Stop speaking');
  expect(idleHtml).not.toContain('aurvin-live-canvas-toggle');

  const speakingProps = props();
  const speakingHtml = renderToStaticMarkup(createElement(LiveVoiceControls, speakingProps));
  expect(speakingHtml.match(/type="button"/g)).toHaveLength(3);
  expect(speakingHtml).toContain('aria-label="Stop speaking"');
  expect(speakingHtml).toContain('aria-keyshortcuts="Escape"');
  expect(speakingHtml).not.toContain('role="tooltip"');
  expect(speakingHtml).not.toContain('tabindex=');

  const muted = renderToStaticMarkup(
    createElement(LiveVoiceControls, {
      ...speakingProps,
      view: { ...speakingProps.view, input: 'muted' },
    }),
  );
  expect(muted).toContain('aria-label="Unmute microphone"');
  expect(muted).toContain('aria-pressed="true"');
});

it('wires each enabled button to its real action and leaves Exit usable during connection/recovery', () => {
  const p = props();
  buttons(LiveVoiceControls(p)).forEach((button) => button.props.onClick());
  expect(p.onMute).toHaveBeenCalledTimes(1);
  expect(p.onInterrupt).toHaveBeenCalledTimes(1);
  expect(p.onExit).toHaveBeenCalledTimes(1);
  for (const phase of ['requesting_permission', 'connecting', 'suspended'] as const) {
    const controls = buttons(
      LiveVoiceControls({
        ...p,
        view: { ...p.view, phase, response: null, connection: 'reconnecting' },
      }),
    );
    expect(controls[0].props.disabled).toBe(true);
    expect(controls[1].props.disabled).not.toBe(true);
  }
});

it('exposes keyboard-accessible Canvas toggle with expanded state and unique artifact count while speaking or paused, and omits it when 0', () => {
  const onToggleCanvas = vi.fn();
  const zeroHtml = renderToStaticMarkup(
    createElement(LiveVoiceControls, {
      ...props(),
      canvasArtifactCount: 0,
      canvasOpen: false,
      onToggleCanvas,
    }),
  );
  expect(zeroHtml).not.toContain('aurvin-live-canvas-toggle');

  const openSpeakingHtml = renderToStaticMarkup(
    createElement(LiveVoiceControls, {
      ...props(),
      canvasArtifactCount: 2,
      canvasOpen: true,
      onToggleCanvas,
    }),
  );
  expect(openSpeakingHtml).toContain('aria-label="Close Canvas (2)"');
  expect(openSpeakingHtml).toContain('aria-expanded="true"');
  expect(openSpeakingHtml).toContain('aria-controls="aurvin-canvas-panel"');
  expect(openSpeakingHtml).toContain('<span class="aurvin-live-canvas-count">2</span>');

  // Must remain enabled and operable even when audio/call is paused (phase === 'suspended')
  const pausedNode = LiveVoiceControls({
    ...props(),
    view: {
      ...props().view,
      phase: 'suspended',
      connection: 'connected',
      resumeRequired: true,
      response: null,
    },
    canvasArtifactCount: 3,
    canvasOpen: false,
    onToggleCanvas,
  });
  const pausedHtml = renderToStaticMarkup(pausedNode);
  expect(pausedHtml).toContain('aria-label="Open Canvas (3)"');
  expect(pausedHtml).toContain('aria-expanded="false"');
  const toggleBtn = buttons(pausedNode).find((b) =>
    String((b.props as { className?: string }).className).includes('aurvin-live-canvas-toggle'),
  );
  expect(toggleBtn).toBeDefined();
  expect(toggleBtn?.props.disabled).not.toBe(true);
  toggleBtn?.props.onClick();
  expect(onToggleCanvas).toHaveBeenCalledTimes(1);
});
```

2. In `frontend/src/features/voice/live/live-voice-surface.test.ts`, import `handleLiveCanvasShortcut` from `../../canvas/index.ts` and append:

```typescript
it('wires Canvas toggle pill on LiveVoicePanel and handles Alt+C shortcut only when artifacts exist', () => {
  const onToggle = vi.fn();
  const html = renderToStaticMarkup(
    createElement(LiveVoicePanel, {
      voice: {
        view: {
          ...initialLiveVoice,
          phase: 'suspended',
          connection: 'connected',
          resumeRequired: true,
        },
        start: vi.fn(),
        toggleMute: vi.fn(),
        interrupt: vi.fn(),
        exit: vi.fn(),
        resume: vi.fn(),
      },
      canvas: { artifactCount: 2, open: true, onToggle },
    }),
  );
  expect(html).toContain('aria-label="Close Canvas (2)"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('aria-controls="aurvin-canvas-panel"');

  const preventDefault = vi.fn();
  const baseKey = {
    key: 'c',
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    isComposing: false,
    target: null,
    preventDefault,
  };
  expect(handleLiveCanvasShortcut(baseKey, { artifactCount: 0, onToggle })).toBe(false);
  expect(onToggle).not.toHaveBeenCalled();

  expect(handleLiveCanvasShortcut(baseKey, { artifactCount: 2, onToggle })).toBe(true);
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(onToggle).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused control and surface tests to verify RED**

Run in `frontend`:
```bash
npm test -- src/features/voice/live/live-voice-controls.test.ts src/features/voice/live/live-voice-surface.test.ts
```
Expected: FAIL because `Stop speaking` and `Canvas` toggle props/button on `LiveVoiceControls` / `LiveVoicePanel` do not exist yet.

- [ ] **Step 3: Implement `LiveVoiceControls.tsx`, `LiveVoicePanel.tsx`, and `live-voice.css`**

1. Replace `frontend/src/features/voice/live/LiveVoiceControls.tsx` with:

```tsx
/**
 * ============================================================================
 * FILE: LiveVoiceControls.tsx
 * LOCATION: frontend/src/features/voice/live/LiveVoiceControls.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Accessible mobile-call style control bar for live voice and Canvas toggle.
 *
 * ROLE IN PROJECT:
 *    Renders circular Microphone (Mute/Unmute), active-speech Stop speaking,
 *    session Canvas toggle pill with unique artifact count badge, and Hang up
 *    controls without disturbing capture, socket, or playback lifecycles.
 *
 * KEY COMPONENTS:
 *    - LiveVoiceControls: Action group for mic, interrupt, Canvas, and hang up.
 *    - LiveVoiceControlsProps: Prop interface for live call controls.
 * ============================================================================
 */

import type { Ref } from 'react';
import type { LiveVoiceState } from '../state/live-voice-reducer.ts';

export type LiveVoiceControlsProps = {
  view: LiveVoiceState;
  onMute: () => void;
  onInterrupt?: () => void;
  onExit: () => void;
  canvasArtifactCount?: number;
  canvasOpen?: boolean;
  onToggleCanvas?: () => void;
  canvasToggleRef?: Ref<HTMLButtonElement>;
};

export function LiveVoiceControls(props: LiveVoiceControlsProps) {
  const { view } = props;
  const usable = view.phase === 'active' && view.connection === 'connected' && !view.resumeRequired;
  const isMuted = view.input === 'muted';
  const muteLabel = isMuted ? 'Unmute microphone' : 'Mute microphone';
  const canInterrupt = usable && Boolean(view.response) && Boolean(props.onInterrupt);
  const artifactCount = props.canvasArtifactCount ?? 0;
  const showCanvasToggle = artifactCount > 0 && Boolean(props.onToggleCanvas);
  const canvasOpen = Boolean(props.canvasOpen);

  return (
    <div className="aurvin-live-controls" role="group" aria-label="Live voice controls">
      <button
        type="button"
        className="aurvin-live-button aurvin-live-button-mic"
        aria-label={muteLabel}
        aria-keyshortcuts="Alt+M"
        aria-pressed={isMuted}
        disabled={!usable || (view.inputBusy && isMuted)}
        onClick={props.onMute}
      >
        {isMuted ? (
          <svg
            viewBox="0 0 24 24"
            width="28"
            height="28"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <line x1="2" y1="2" x2="22" y2="22" />
            <path d="M18.89 13.23A7.12 7.12 0 0 0 19 11v-1" />
            <path d="M5 10v1a7 7 0 0 0 12 5" />
            <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
            <path d="M9 9v2a3 3 0 0 0 5.12 2.12" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="8" y1="22" x2="16" y2="22" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="28"
            height="28"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="17" x2="12" y2="21" />
            <line x1="8" y1="21" x2="16" y2="21" />
          </svg>
        )}
      </button>

      {canInterrupt ? (
        <button
          type="button"
          className="aurvin-live-button aurvin-live-button-interrupt"
          aria-label="Stop speaking"
          aria-keyshortcuts="Escape"
          onClick={props.onInterrupt}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="6" y="6" width="12" height="12" rx="2.5" />
          </svg>
        </button>
      ) : null}

      {showCanvasToggle ? (
        <button
          ref={props.canvasToggleRef}
          type="button"
          className="aurvin-live-canvas-toggle"
          data-open={canvasOpen ? 'true' : 'false'}
          aria-label={
            canvasOpen
              ? `Close Canvas (${artifactCount})`
              : `Open Canvas (${artifactCount})`
          }
          aria-expanded={canvasOpen}
          aria-controls="aurvin-canvas-panel"
          aria-keyshortcuts="Alt+C"
          onClick={props.onToggleCanvas}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M14 4v16" />
          </svg>
          <span className="aurvin-live-canvas-label">Canvas</span>
          <span className="aurvin-live-canvas-count">{artifactCount}</span>
        </button>
      ) : null}

      <button
        type="button"
        className="aurvin-live-button aurvin-live-button-hangup"
        aria-label="Hang up"
        aria-keyshortcuts="Alt+X"
        onClick={props.onExit}
      >
        <svg
          viewBox="0 0 24 24"
          width="28"
          height="28"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C2.5 9.4 6.98 8 12 8s9.5 1.4 11.71 3.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
        </svg>
      </button>
    </div>
  );
}
```

2. Replace `frontend/src/features/voice/live/LiveVoicePanel.tsx` (preserving its mandatory `====` header and routing `Alt+C` through `handleLiveCanvasShortcut` without modifying `live-voice-lifecycle.ts`):

```tsx
/**
 * ============================================================================
 * FILE: LiveVoicePanel.tsx
 * LOCATION: frontend/src/features/voice/live/LiveVoicePanel.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Main surface panel for transcript-free live duplex voice conversation.
 *
 * ROLE IN PROJECT:
 *    Presents the animated voice bubble, screen-reader-only aria-live status
 *    announcements, and minimal icon/Canvas controls without visible text clutter.
 *
 * KEY COMPONENTS:
 *    - LiveVoicePanel: Dedicated voice page region with Canvas toggle support.
 *    - liveVoiceLabels: Maps LiveVoiceState to accessible screen-reader strings.
 * ============================================================================
 */

import { useLayoutEffect, useRef, type Ref, type RefObject } from 'react';
import { handleLiveCanvasShortcut } from '../../canvas/index.ts';
import type { LiveVoiceSurface } from '../state/useLiveVoice.ts';
import { LiveVoiceBubble } from './LiveVoiceBubble.tsx';
import { LiveVoiceControls } from './LiveVoiceControls.tsx';
import { focusVoiceSurface, handleLiveVoiceKey } from './live-voice-lifecycle.ts';
import './live-voice.css';

export type LiveVoiceCanvasControl = {
  artifactCount: number;
  open: boolean;
  onToggle: () => void;
  toggleRef?: Ref<HTMLButtonElement>;
};

export function liveVoiceLabels(view: LiveVoiceSurface['view']) {
  const connection = {
    connecting: 'Connecting',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    disconnected: 'Disconnected',
  }[view.connection];
  const input = view.resumeRequired
    ? 'Voice paused'
    : view.input === 'muted'
      ? 'Microphone muted'
      : view.input === 'suspended'
        ? 'Listening locally; uploads paused'
        : view.phase === 'active'
          ? 'Listening'
          : 'Microphone starting';
  const agent = { idle: 'Ready', thinking: 'Thinking', speaking: 'Speaking' }[view.agent];
  const phase =
    view.phase === 'requesting_permission'
      ? 'Requesting microphone permission'
      : view.phase === 'connecting'
        ? 'Connecting voice'
        : 'Live voice';
  return { phase, connection, input, agent };
}

export function LiveVoicePanel({
  voice,
  canvas,
  surfaceRef,
}: {
  voice: LiveVoiceSurface;
  canvas?: LiveVoiceCanvasControl;
  surfaceRef?: RefObject<HTMLElement | null>;
}) {
  const internalSurface = useRef<HTMLElement | null>(null);
  const surface = surfaceRef ?? internalSurface;
  useLayoutEffect(() => {
    focusVoiceSurface(surface.current);
  }, [surface]);
  const labels = liveVoiceLabels(voice.view);
  return (
    <section
      ref={surface}
      tabIndex={-1}
      className="aurvin-live-panel"
      aria-label="Live voice conversation"
      onKeyDown={(event) => {
        const keyEvent = {
          key: event.key,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
          defaultPrevented: event.defaultPrevented,
          isComposing: event.nativeEvent.isComposing,
          target: event.target,
          preventDefault: () => event.preventDefault(),
        };
        if (handleLiveCanvasShortcut(keyEvent, canvas)) {
          return;
        }
        handleLiveVoiceKey(keyEvent, voice.view, {
          onMute: voice.toggleMute,
          onInterrupt: voice.interrupt,
          onExit: voice.exit,
        });
      }}
    >
      <LiveVoiceBubble view={voice.view} getVolume={voice.getVolume} />
      <p className="aurvin-live-status sr-only" role="status" aria-live="polite" aria-atomic="true">
        {labels.phase}. {labels.connection}. {labels.input}. {labels.agent}.
      </p>
      {voice.view.notice || voice.view.input === 'suspended' ? (
        <p className="aurvin-live-notice" role="status" aria-live="polite" aria-atomic="true">
          {voice.view.notice ?? 'Listening locally. Audio uploads paused until speech.'}
        </p>
      ) : null}
      {voice.view.resumeRequired ? (
        <button
          type="button"
          className="aurvin-live-button"
          aria-label="Resume voice"
          disabled={!voice.view.canResume || voice.view.inputBusy}
          onClick={voice.resume}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M8 5.5v13l11-6.5-11-6.5z" />
          </svg>
        </button>
      ) : null}
      <LiveVoiceControls
        view={voice.view}
        onMute={voice.toggleMute}
        onInterrupt={voice.interrupt}
        onExit={voice.exit}
        canvasArtifactCount={canvas?.artifactCount}
        canvasOpen={canvas?.open}
        onToggleCanvas={canvas?.onToggle}
        canvasToggleRef={canvas?.toggleRef}
      />
    </section>
  );
}
```

3. In `frontend/src/features/voice/live/live-voice.css`:
   - Add `overflow-x: hidden; box-sizing: border-box;` to `.aurvin-live-panel` (line 28).
   - Replace `.aurvin-live-controls` (lines 102–107) and add `.aurvin-live-button-interrupt`, `.aurvin-live-canvas-toggle`, `.aurvin-live-canvas-count`, focus-visible, and narrow-screen rules:

```css
.aurvin-live-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: clamp(14px, 2.8vw, 28px);
  max-width: 100%;
}

.aurvin-live-button-interrupt {
  background: #272726;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.16);
}

.aurvin-live-button-interrupt:hover:not(:disabled) {
  background: #363635;
  transform: scale(1.05);
}

.aurvin-live-button-interrupt:active:not(:disabled) {
  transform: scale(0.95);
}

.aurvin-live-canvas-toggle {
  height: 52px;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #1f1f22;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.16);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease, transform 0.15s ease;
}

.aurvin-live-canvas-toggle:hover {
  background: #2c2c30;
  border-color: rgba(255, 255, 255, 0.28);
}

.aurvin-live-canvas-toggle[data-open='true'] {
  background: #ffffff;
  color: #121212;
  border-color: #ffffff;
}

.aurvin-live-canvas-toggle:focus {
  outline: none;
}

.aurvin-live-canvas-toggle:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 3px;
}

.aurvin-live-canvas-count {
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.78rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.14);
  color: inherit;
}

.aurvin-live-canvas-toggle[data-open='true'] .aurvin-live-canvas-count {
  background: rgba(18, 18, 18, 0.12);
}

@media (max-width: 480px) {
  .aurvin-live-button {
    width: 56px;
    height: 56px;
    min-width: 56px;
    min-height: 56px;
  }
  .aurvin-live-canvas-toggle {
    height: 46px;
    padding: 0 14px;
  }
}
```

- [ ] **Step 4: Run live voice control, lifecycle, and surface tests to verify GREEN**

Run in `frontend`:
```bash
npm test -- src/features/voice/live/live-voice-controls.test.ts src/features/voice/live/live-voice-surface.test.ts src/features/voice/live/live-voice-lifecycle.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Coordinate shared Git index access with the orchestrator, then run:
```bash
git add frontend/src/features/voice/live/LiveVoiceControls.tsx frontend/src/features/voice/live/LiveVoicePanel.tsx frontend/src/features/voice/live/live-voice.css frontend/src/features/voice/live/live-voice-controls.test.ts frontend/src/features/voice/live/live-voice-surface.test.ts
git commit -m "feat(voice-canvas): add live Canvas toggle, Stop speaking button, and Alt+C shortcut"
```


---

### Task 4: ChatView Split-Screen Composition, Auto-Open/Dismissal Lifecycle, 320 ms Slide Entry/Exit Mounting (`inert` + Focus Restoration), and Media Continuity

**Files:**
- Modify: `frontend/src/features/chat/ChatView.tsx`
- Modify: `frontend/src/styles/chat.css`
- Test: `frontend/src/features/chat/ChatView.voice.test.ts`
- Test: `frontend/src/features/voice/live/live-voice-composition.test.ts`
- Test: `frontend/src/styles/styles.test.ts`

- [ ] **Step 1: Write failing split-screen, provisional-to-archive bridge, media-continuity, and CSS motion tests**

1. Append the following tests to `frontend/src/features/chat/ChatView.voice.test.ts`:

```typescript
it('mounts CanvasPanel beside LiveVoicePanel during active voice while keeping draft and transcript unmounted', () => {
  const liveProjection = {
    responseId: 'resp_live_1',
    ordinal: 0,
    kind: 'mermaid' as const,
    subType: 'Flowchart',
    title: 'Request Routing',
    rawSource: 'flowchart LR\n  Client --> Edge --> Service',
  };
  context.state = {
    ...initialChatState,
    draftInput: 'UNSENT_SECRET_DRAFT',
    activeSessionId: 'chat-1',
    canvasOpen: true,
    activeCanvasArtifactId: 'resp_live_1::canvas::0',
    messages: [
      {
        messageId: 'm1',
        turnId: 't1',
        eventId: 'e1',
        sequence: 0,
        role: 'user',
        content: 'EXISTING_SECRET_TRANSCRIPT',
        createdAt: '2026-10-08T00:00:00Z',
        completionStatus: 'completed',
        truncated: false,
      },
    ],
  };

  const surface: LiveVoiceSurface = {
    ...voice('active'),
    view: {
      ...voice('active').view,
      conversationId: 'chat-1',
      agent: 'speaking',
      response: { turnId: 'turn_live_1', responseId: 'resp_live_1' },
      artifacts: [liveProjection],
    },
  };

  const html = renderToStaticMarkup(createElement(ChatView, { liveVoice: surface }));
  expect(html).toContain('Live voice conversation');
  expect(html).toContain('aurvin-layout-canvas-open');
  expect(html).toContain('id="aurvin-canvas-panel"');
  expect(html).toContain('data-canvas-state="open"');
  expect(html).toContain('data-active-artifact-id="resp_live_1::canvas::0"');
  expect(html).toContain('aria-label="Close Canvas (1)"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('aria-label="Stop speaking"');
  expect(html).not.toContain('aurvin-canvas-header-btn');
  expect(html).not.toContain('<textarea');
  expect(html).not.toContain('UNSENT_SECRET_DRAFT');
  expect(html).not.toContain('EXISTING_SECRET_TRANSCRIPT');
});

it('deduplicates identical live and archived artifact IDs in the unified count and keeps dismissed Canvas hidden during voice', () => {
  const sharedProjection = {
    responseId: 'resp_shared_1',
    ordinal: 0,
    kind: 'chart' as const,
    subType: 'Line Graph',
    title: 'Throughput',
    rawSource: 'Q1: 12\nQ2: 18\nQ3: 27',
  };
  context.state = {
    ...initialChatState,
    activeSessionId: 'chat-1',
    canvasOpen: false,
    activeCanvasArtifactId: 'resp_shared_1::canvas::0',
    messages: [
      {
        messageId: 'v_arch_1',
        turnId: 't_arch_1',
        eventId: 'e_arch_1',
        sequence: 1,
        role: 'assistant',
        content: '',
        createdAt: '2026-11-02T10:00:00Z',
        completionStatus: 'completed',
        truncated: false,
        mode: 'live',
        voiceSessionId: 'vs_1',
        voiceTranscripts: [{ role: 'assistant', content: 'Throughput climbed each quarter.' }],
        canvasArtifacts: [sharedProjection],
      },
    ],
  };

  const surface: LiveVoiceSurface = {
    ...voice('active'),
    view: {
      ...voice('active').view,
      conversationId: 'chat-1',
      artifacts: [sharedProjection],
    },
  };

  const html = renderToStaticMarkup(createElement(ChatView, { liveVoice: surface }));
  expect(html).not.toContain('id="aurvin-canvas-panel"');
  expect(html).toContain('aria-label="Open Canvas (1)"');
  expect(html).toContain('aria-expanded="false"');
});

it('bridges provisional live artifacts across ending/messagesLoading and drops unpersisted live artifacts once idle reload settles', () => {
  const unpersistedProjection = {
    responseId: 'resp_unpersisted',
    ordinal: 0,
    kind: 'svg' as const,
    subType: 'SVG Visual',
    title: 'Transient Sketch',
    rawSource: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="12" /></svg>',
  };

  context.state = {
    ...initialChatState,
    activeSessionId: 'chat-1',
    messagesLoading: true,
    canvasOpen: true,
    activeCanvasArtifactId: 'resp_unpersisted::canvas::0',
    messages: [],
  };
  const loadingIdleSurface: LiveVoiceSurface = {
    ...voice('idle'),
    view: {
      ...voice('idle').view,
      conversationId: 'chat-1',
      artifacts: [unpersistedProjection],
    },
  };
  const duringReloadHtml = renderToStaticMarkup(
    createElement(ChatView, { liveVoice: loadingIdleSurface }),
  );
  expect(duringReloadHtml).toContain('id="aurvin-canvas-panel"');
  expect(duringReloadHtml).toContain('Transient Sketch');

  // Once messagesLoading finishes (false) and phase is idle, authoritative messages win:
  context.state = {
    ...initialChatState,
    activeSessionId: 'chat-1',
    messagesLoading: false,
    canvasOpen: true,
    activeCanvasArtifactId: 'resp_unpersisted::canvas::0',
    messages: [],
  };
  const settledIdleHtml = renderToStaticMarkup(
    createElement(ChatView, { liveVoice: loadingIdleSurface }),
  );
  expect(settledIdleHtml).not.toContain('id="aurvin-canvas-panel"');
  expect(settledIdleHtml).not.toContain('aurvin-canvas-header-btn');
});
```

2. In `frontend/src/features/voice/live/live-voice-composition.test.ts`, import `ChatView` from `../../chat/ChatView.tsx` and append:

```typescript
it('preserves capture, socket, scheduled playback, and mute state across live Canvas auto-open, tab switch, dismiss, audio ticks, and reopen', async () => {
  let chatCtx!: ReturnType<typeof useChat>;
  const fetcher = vi.fn(async () => new Response('{"items":[]}', { status: 200 }));
  function Probe() {
    chatCtx = useChat();
    return null;
  }
  const client = new ApiClient({ fetch: fetcher });
  renderToStaticMarkup(createElement(ChatProvider, { client, children: createElement(Probe) }));

  const socket = new FakeSocket();
  const f = liveVoiceFixture({
    client: (options) =>
      new VoiceClient({
        ...options,
        pageUrl: 'https://aurvin.example/chat',
        socket: () => socket.asSocket(),
      }),
    bindings: {
      ...chatCtx.actions,
      refreshSessions: vi.fn(),
      bindVoiceConversation: vi.fn(() => true),
      openCanvasArtifact: (artifactId) =>
        chatCtx.dispatch({ type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId } }),
    },
  });

  await f.controller.start(
    { text: 'Draft stays intact', start: 0, end: 5, direction: 'none' },
    null,
    f.config,
  );
  socket.open();
  socket.receive(ready());
  await settle();
  socket.receive(
    control({ type: 'voice.state', input: 'listening', agent: 'thinking', connection: 'connected' }, 1),
  );
  socket.receive(control({ type: 'conversation.bound', conversationId: 'voice-canvas-chat' }, 2));
  await settle();

  // Pre-audio Canvas artifact arrives and auto-opens Canvas
  socket.receive(
    control(
      {
        type: 'canvas.artifact',
        turnId: 'turn_1',
        responseId: 'resp_1',
        ordinal: 0,
        kind: 'mermaid',
        subType: 'Flowchart',
        title: 'Pipeline',
        rawSource: 'flowchart TD\n  Mic --> Filter --> Canvas',
      },
      3,
    ),
  );
  await settle();

  // Audio begins and a second visual arrives on the same response
  socket.receive(
    control(
      {
        type: 'audio.start',
        turnId: 'turn_1',
        responseId: 'resp_1',
        sampleRate: 24000,
        firstAudioSequence: 0,
      },
      4,
    ),
  );
  socket.receive(output(0, 100));
  socket.receive(
    control(
      {
        type: 'canvas.artifact',
        turnId: 'turn_1',
        responseId: 'resp_1',
        ordinal: 1,
        kind: 'chart',
        subType: 'Line Graph',
        title: 'Frame Latency',
        rawSource: 'T1: 18\nT2: 15\nT3: 14',
      },
      5,
    ),
  );
  await settle();

  expect(f.controller.getSnapshot().artifacts).toHaveLength(2);

  // Switch active tab, dismiss Canvas, continue receiving audio chunks, then reopen Canvas
  chatCtx.dispatch({
    type: 'OPEN_CANVAS_ARTIFACT',
    payload: { artifactId: 'resp_1::canvas::0' },
  });
  chatCtx.dispatch({ type: 'CLOSE_CANVAS' });
  socket.receive(output(1, 100));
  socket.receive(
    control({ type: 'voice.state', input: 'listening', agent: 'speaking', connection: 'connected' }, 6),
  );
  await settle();

  // Re-render probe to read latest ChatProvider state and verify dismissal stayed sticky across audio ticks
  renderToStaticMarkup(createElement(ChatProvider, { client, children: createElement(Probe) }));
  expect(f.controller.getSnapshot().artifacts).toHaveLength(2);
  expect(f.controller.getSnapshot().input).toBe('listening');

  // Reopen Canvas and render ChatView with live voice surface
  const liveSurface = {
    view: f.controller.getSnapshot(),
    start: vi.fn(),
    toggleMute: () => f.controller.toggleMute(),
    interrupt: () => f.controller.interrupt(),
    exit: () => f.controller.exit(),
    resume: () => f.controller.resume(),
  };
  const reopenedHtml = renderToStaticMarkup(
    createElement(ChatProvider, {
      client,
      children: createElement(ChatView, { liveVoice: liveSurface }),
    }),
  );
  expect(reopenedHtml).toContain('aria-label="Open Canvas (2)"');

  // Media continuity: zero mic restart, zero socket reconnect/close, zero playback stop
  expect(f.capture.start).toHaveBeenCalledTimes(1);
  expect(f.capture.stop).not.toHaveBeenCalled();
  expect(socket.close).not.toHaveBeenCalled();
  expect(f.context.sources).toHaveLength(2);
  for (const source of f.context.sources) {
    expect(source.stop).not.toHaveBeenCalled();
  }

  f.controller.exit();
  await settle();
});
```

3. Append the following stylesheet contract test to `frontend/src/styles/styles.test.ts`:

```typescript
  it('defines desktop 380px..50vw Canvas bounds, mobile sheet, 320ms right-slide keyframes, and reduced-motion override', () => {
    const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf-8');
    const panel = css.match(/\.aurvin-canvas-panel\s*\{([^}]*)\}/)?.[1];
    expect(panel).toContain('width: min(50vw, 680px);');
    expect(panel).toContain('min-width: 380px;');
    expect(panel).toContain('max-width: 50vw;');
    expect(css).toContain(".aurvin-canvas-panel[data-canvas-state='open']");
    expect(css).toContain(".aurvin-canvas-panel[data-canvas-state='exiting']");
    expect(css).toContain('320ms cubic-bezier(0.32, 0.72, 0, 1)');
    expect(css).toContain('@keyframes aurvin-canvas-slide-in');
    expect(css).toContain('@keyframes aurvin-canvas-slide-out');
    expect(css).toContain('translateX(100%)');
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion: reduce\)[\s\S]*?\.aurvin-canvas-panel[\s\S]*?animation:\s*none;/,
    );
  });
```

- [ ] **Step 2: Run the focused ChatView, composition, and stylesheet tests to verify RED**

Run in `frontend`:
```bash
npm test -- src/features/chat/ChatView.voice.test.ts src/features/voice/live/live-voice-composition.test.ts src/styles/styles.test.ts
```
Expected: FAIL because `ChatView.tsx` still excludes Canvas when `liveActive` is true, does not merge `liveVoice.view.artifacts` or pass `canvas` props to `LiveVoicePanel`, and `chat.css` lacks `max-width: 50vw` and 320 ms slide-in/out keyframes.

- [ ] **Step 3: Implement `ChatView.tsx` and `chat.css`**

1. Replace `frontend/src/features/chat/ChatView.tsx` with:

```tsx
/**
 * ============================================================================
 * FILE: ChatView.tsx
 * LOCATION: frontend/src/features/chat/ChatView.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Assemble sidebar, header, transcript or live voice surface, composer, and Canvas.
 *
 * ROLE IN PROJECT:
 *    Public chat feature container mounted inside ChatProvider. Coordinates
 *    unified text + live-voice Canvas artifacts, auto-open and sticky dismissal,
 *    320 ms right-slide entry/exit mounting with inert + focus restoration,
 *    and layout chrome without restarting active media instances.
 *
 * KEY COMPONENTS:
 *    - Responsive layout shell with split-screen desktop / overlay mobile Canvas
 *    - Session header and unified Canvas toggle controls
 *    - LiveVoicePanel versus EmptyState / Transcript switch
 * ============================================================================
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Composer } from '../../components/Composer.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { IconNewChat, IconSidebar } from '../../components/icons.tsx';
import { Sidebar } from '../../components/Sidebar.tsx';
import { Transcript } from '../../components/Transcript.tsx';
import {
  CANVAS_TRANSITION_MS,
  CanvasPanel,
  claimNewAutoOpenArtifactId,
  collectSessionCanvasArtifacts,
  mergeSessionCanvasArtifacts,
  prefersReducedCanvasMotion,
  restoreCanvasCloseFocus,
  type CanvasArtifact,
} from '../canvas/index.ts';
import { CalendarTurnRegion } from '../plugins/google-calendar/index.ts';
import { restoreLiveDraftFocus } from '../voice/live/live-voice-lifecycle.ts';
import { LiveVoicePanel } from '../voice/live/LiveVoicePanel.tsx';
import { showsLiveVoice, type LiveDraft } from '../voice/state/live-voice-reducer.ts';
import type { LiveVoiceSurface } from '../voice/state/useLiveVoice.ts';
import { useChat } from './state/chat-context.tsx';

const NOTICE_TIMEOUT_MS = 6_000;

type ExitingCanvasSnapshot = {
  artifacts: CanvasArtifact[];
  activeArtifactId: string | null;
  sessionId: string | null;
};

export function ChatView(props: {
  liveVoice?: LiveVoiceSurface;
  visible?: boolean;
  onManageAurvin?: () => void;
  onOpenCalendarSetup?: () => void;
}) {
  const liveVoice = props?.liveVoice;
  const visible = props.visible ?? true;
  const returning = useRef(visible);
  const { state, dispatch, actions } = useChat();
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [greetingKey, setGreetingKey] = useState(0);
  const [hiddenNotice, setHiddenNotice] = useState<string | null>(null);
  const [exitingCanvas, setExitingCanvas] = useState<ExitingCanvasSnapshot | null>(null);
  const isEmpty = !state.activeSessionId && state.messages.length === 0 && !state.isStreaming;
  const liveActive = liveVoice ? showsLiveVoice(liveVoice.view) : false;
  const rawNotice = liveVoice?.view.notice ?? null;
  const visibleNotice = rawNotice && rawNotice !== hiddenNotice ? rawNotice : null;
  const mainRef = useRef<HTMLElement | null>(null);
  const liveSurfaceRef = useRef<HTMLElement | null>(null);
  const liveCanvasToggleRef = useRef<HTMLButtonElement | null>(null);
  const headerCanvasToggleRef = useRef<HTMLButtonElement | null>(null);
  const restored = useRef<LiveDraft | null>(null);
  const seenLiveArtifactIdsRef = useRef<Set<string>>(new Set());
  const previousSessionIdRef = useRef<string | null>(state.activeSessionId);

  const archivedArtifacts = useMemo(
    () => collectSessionCanvasArtifacts(state.messages, state.streamText, state.isStreaming),
    [state.messages, state.streamText, state.isStreaming],
  );

  const includeLiveArtifacts = Boolean(
    liveVoice &&
      (liveActive || liveVoice.view.phase === 'ending' || state.messagesLoading) &&
      (liveVoice.view.conversationId !== null
        ? liveVoice.view.conversationId === state.activeSessionId
        : liveActive),
  );
  const liveProjections = useMemo(
    () => (includeLiveArtifacts && liveVoice ? liveVoice.view.artifacts : []),
    [includeLiveArtifacts, liveVoice],
  );

  const sessionArtifacts = useMemo(
    () => mergeSessionCanvasArtifacts(archivedArtifacts, liveProjections),
    [archivedArtifacts, liveProjections],
  );

  const openCanvasArtifacts = useMemo(() => {
    const filtered = sessionArtifacts.filter(
      (a) => !state.closedCanvasArtifactIds.includes(a.artifactId),
    );
    return filtered.length > 0 ? filtered : sessionArtifacts;
  }, [sessionArtifacts, state.closedCanvasArtifactIds]);

  const showCanvasPanel = state.canvasOpen && openCanvasArtifacts.length > 0;
  const activeExitingCanvas =
    !showCanvasPanel &&
    exitingCanvas !== null &&
    exitingCanvas.sessionId === state.activeSessionId &&
    exitingCanvas.artifacts.length > 0
      ? exitingCanvas
      : null;

  useLayoutEffect(() => {
    const prev = previousSessionIdRef.current;
    if (prev !== state.activeSessionId) {
      const sameCallBinding = prev === null && state.activeSessionId !== null && liveActive;
      if (!sameCallBinding) {
        seenLiveArtifactIdsRef.current.clear();
      }
      previousSessionIdRef.current = state.activeSessionId;
    }

    const autoOpenId = claimNewAutoOpenArtifactId(liveProjections, seenLiveArtifactIdsRef.current);
    if (
      autoOpenId &&
      (!state.canvasOpen || state.activeCanvasArtifactId !== autoOpenId)
    ) {
      dispatch({ type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId: autoOpenId } });
    }
  }, [
    dispatch,
    liveActive,
    liveProjections,
    state.activeCanvasArtifactId,
    state.activeSessionId,
    state.canvasOpen,
  ]);

  useEffect(() => {
    if (!activeExitingCanvas) return;
    const timer = setTimeout(() => setExitingCanvas(null), CANVAS_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [activeExitingCanvas]);

  useEffect(() => {
    if (!rawNotice || liveActive) return;
    const timer = setTimeout(() => setHiddenNotice(rawNotice), NOTICE_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
      setHiddenNotice(null);
    };
  }, [rawNotice, liveActive]);

  useLayoutEffect(() => {
    if (!visible) return;
    if (!liveActive) {
      restoreLiveDraftFocus(
        mainRef.current?.querySelector<HTMLTextAreaElement>('.aurvin-textarea') ?? null,
        liveVoice?.view.restoreDraft ?? null,
        restored,
      );
    }
  }, [visible, liveActive, liveVoice?.view.restoreDraft, state.draftInput]);

  useLayoutEffect(() => {
    if (visible && !returning.current) {
      const profile = document.querySelector<HTMLElement>('.aurvin-profile-trigger');
      const openSidebar = document.querySelector<HTMLElement>('button[aria-label="Open sidebar"]');
      const composer = mainRef.current?.querySelector<HTMLTextAreaElement>('.aurvin-textarea');
      const target =
        profile && profile.getClientRects().length > 0
          ? profile
          : openSidebar && openSidebar.getClientRects().length > 0
            ? openSidebar
            : composer;
      target?.focus();
    }
    returning.current = visible;
  }, [visible]);

  const restoreFocusAfterCanvasClose = () => {
    restoreCanvasCloseFocus({
      liveActive,
      liveCanvasToggle: liveCanvasToggleRef.current,
      liveSurface: liveSurfaceRef.current,
      headerCanvasToggle: headerCanvasToggleRef.current,
      composer: mainRef.current?.querySelector<HTMLTextAreaElement>('.aurvin-textarea') ?? null,
    });
  };

  const captureExitingCanvas = () => {
    if (!prefersReducedCanvasMotion() && openCanvasArtifacts.length > 0) {
      setExitingCanvas({
        artifacts: openCanvasArtifacts,
        activeArtifactId: state.activeCanvasArtifactId,
        sessionId: state.activeSessionId,
      });
    } else {
      setExitingCanvas(null);
    }
  };

  const closeCanvasPanel = () => {
    captureExitingCanvas();
    dispatch({ type: 'CLOSE_CANVAS' });
    restoreFocusAfterCanvasClose();
  };

  const toggleCanvasPanel = () => {
    if (showCanvasPanel) {
      closeCanvasPanel();
      return;
    }
    if (sessionArtifacts.length === 0) return;
    setExitingCanvas(null);
    const hasOpenActive =
      state.activeCanvasArtifactId !== null &&
      openCanvasArtifacts.some((item) => item.artifactId === state.activeCanvasArtifactId);
    const targetId = hasOpenActive
      ? state.activeCanvasArtifactId!
      : (openCanvasArtifacts[openCanvasArtifacts.length - 1] ??
          sessionArtifacts[sessionArtifacts.length - 1])!.artifactId;
    dispatch({ type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId: targetId } });
  };

  const startNewChat = () => {
    setExitingCanvas(null);
    seenLiveArtifactIdsRef.current.clear();
    actions.startNewChat();
    setGreetingKey((key) => key + 1);
  };

  const renderedCanvas = showCanvasPanel
    ? {
        artifacts: openCanvasArtifacts,
        activeArtifactId: state.activeCanvasArtifactId,
        transitionState: 'open' as const,
      }
    : activeExitingCanvas
      ? {
          artifacts: activeExitingCanvas.artifacts,
          activeArtifactId: activeExitingCanvas.activeArtifactId,
          transitionState: 'exiting' as const,
        }
      : null;

  return (
    <div
      className={`aurvin-layout${desktopCollapsed ? ' aurvin-layout-collapsed' : ''}${showCanvasPanel ? ' aurvin-layout-canvas-open' : ''}`}
    >
      <Sidebar
        onCollapse={() => setDesktopCollapsed(true)}
        onNewChat={startNewChat}
        onManageAurvin={props.onManageAurvin}
      />

      {state.sidebarOpen ? (
        <button
          type="button"
          className="aurvin-backdrop"
          aria-label="Close sidebar"
          onClick={() => dispatch({ type: 'CLOSE_SIDEBAR' })}
        />
      ) : null}

      <main ref={mainRef} className="aurvin-main" role="main">
        <header className="aurvin-header">
          <div className="aurvin-header-left">
            <button
              type="button"
              className="aurvin-chat-icon-btn aurvin-header-menu"
              onClick={() => {
                dispatch({ type: 'TOGGLE_SIDEBAR' });
                setDesktopCollapsed(false);
              }}
              aria-label="Open sidebar"
              aria-expanded={state.sidebarOpen || !desktopCollapsed}
            >
              <IconSidebar />
            </button>
            <button
              type="button"
              className="aurvin-chat-icon-btn aurvin-header-new"
              onClick={startNewChat}
              aria-label="Start a new chat"
            >
              <IconNewChat />
            </button>
          </div>

          {sessionArtifacts.length > 0 && !liveActive ? (
            <div className="aurvin-header-right">
              <button
                ref={headerCanvasToggleRef}
                type="button"
                className="aurvin-canvas-header-btn"
                data-open={showCanvasPanel ? 'true' : 'false'}
                aria-label={showCanvasPanel ? 'Close Canvas panel' : 'Open Canvas panel'}
                aria-expanded={showCanvasPanel}
                aria-controls="aurvin-canvas-panel"
                onClick={toggleCanvasPanel}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M14 4v16" />
                </svg>
                <span>Canvas</span>
                <span className="aurvin-canvas-header-count">{sessionArtifacts.length}</span>
              </button>
            </div>
          ) : null}
        </header>

        {liveActive && liveVoice ? (
          <LiveVoicePanel
            voice={liveVoice}
            surfaceRef={liveSurfaceRef}
            canvas={{
              artifactCount: sessionArtifacts.length,
              open: showCanvasPanel,
              onToggle: toggleCanvasPanel,
              toggleRef: liveCanvasToggleRef,
            }}
          />
        ) : (
          <>
            {isEmpty ? (
              <div className="aurvin-empty">
                <EmptyState key={greetingKey} />
                <Composer variant="centered" />
              </div>
            ) : (
              <>
                <Transcript />
                <CalendarTurnRegion
                  onOpenCalendarSetup={props.onOpenCalendarSetup ?? props.onManageAurvin}
                  onFocusComposer={() => {
                    mainRef.current?.querySelector<HTMLTextAreaElement>('.aurvin-textarea')?.focus();
                  }}
                />
              </>
            )}

            {isEmpty ? null : <Composer variant="docked" />}
            {visibleNotice ? (
              <p className="aurvin-live-chat-notice" role="status" aria-live="polite" aria-atomic="true">
                {visibleNotice}
              </p>
            ) : null}
            <p className="aurvin-disclaimer">Aurvin can make mistakes. Check important information.</p>
          </>
        )}
      </main>

      {renderedCanvas ? (
        <CanvasPanel
          artifacts={renderedCanvas.artifacts}
          activeArtifactId={renderedCanvas.activeArtifactId}
          transitionState={renderedCanvas.transitionState}
          onSelectArtifact={(artifactId) => {
            setExitingCanvas(null);
            dispatch({ type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId } });
          }}
          onCloseTab={(artifactId) => {
            const remaining = openCanvasArtifacts.filter((a) => a.artifactId !== artifactId);
            const fallback =
              remaining.length > 0 ? remaining[remaining.length - 1]!.artifactId : null;
            if (fallback === null) {
              captureExitingCanvas();
            }
            dispatch({
              type: 'CLOSE_CANVAS_TAB',
              payload: { artifactId, fallbackArtifactId: fallback },
            });
            if (fallback === null) {
              restoreFocusAfterCanvasClose();
            }
          }}
          onClosePanel={closeCanvasPanel}
        />
      ) : null}
    </div>
  );
}
```

2. In `frontend/src/styles/chat.css`:
   - Add `position: relative;` to `.aurvin-layout` (lines 1–8):
     ```css
     .aurvin-layout {
       position: relative;
       display: flex;
       height: 100%;
       width: 100%;
       overflow: hidden;
       background-color: var(--aurvin-bg);
       color: var(--aurvin-text-primary);
     }
     ```
   - Update `.aurvin-canvas-panel` and `.aurvin-canvas-panel-maximized` (lines 1317–1332) to enforce `380px` to `50vw` split-screen bounds and add 320 ms cubic-bezier right-to-left slide-in / slide-out keyframes:
     ```css
     /* Split-Screen Canvas Side Panel */
     .aurvin-canvas-panel {
       width: min(50vw, 680px);
       min-width: 380px;
       max-width: 50vw;
       height: 100%;
       flex-shrink: 0;
       display: flex;
       flex-direction: column;
       border-left: 1px solid var(--aurvin-border);
       background-color: var(--aurvin-canvas-bg);
       z-index: 18;
       will-change: transform, opacity;
     }

     .aurvin-canvas-panel[data-canvas-state='open'] {
       animation: aurvin-canvas-slide-in 320ms cubic-bezier(0.32, 0.72, 0, 1) both;
     }

     .aurvin-canvas-panel[data-canvas-state='exiting'] {
       position: absolute;
       top: 0;
       right: 0;
       bottom: 0;
       pointer-events: none;
       animation: aurvin-canvas-slide-out 320ms cubic-bezier(0.32, 0.72, 0, 1) both;
     }

     .aurvin-canvas-panel-maximized {
       width: min(72vw, 1060px);
       max-width: 72vw;
     }

     @keyframes aurvin-canvas-slide-in {
       from {
         opacity: 0;
         transform: translateX(100%);
       }
       to {
         opacity: 1;
         transform: translateX(0);
       }
     }

     @keyframes aurvin-canvas-slide-out {
       from {
         opacity: 1;
         transform: translateX(0);
       }
       to {
         opacity: 0;
         transform: translateX(100%);
       }
     }
     ```
   - Update the `@media (max-width: 900px)` block (lines 1819–1827) and add medium-desktop split-screen guardrails:
     ```css
     @media (min-width: 901px) and (max-width: 1120px) {
       .aurvin-layout-canvas-open .aurvin-sidebar {
         width: 220px;
       }

       .aurvin-canvas-panel {
         width: clamp(380px, 44vw, 50vw);
       }
     }

     @media (max-width: 900px) {
       .aurvin-canvas-panel,
       .aurvin-canvas-panel[data-canvas-state='exiting'] {
         position: fixed;
         inset: 0;
         width: 100%;
         max-width: 100%;
         min-width: 0;
         z-index: 40;
       }
     }
     ```
   - Update the `@media (prefers-reduced-motion: reduce)` block at the bottom of `frontend/src/styles/chat.css` (lines 2056–2063) so Canvas opening/closing is instant when reduced motion is active:
     ```css
     @media (prefers-reduced-motion: reduce) {
       .aurvin-canvas-panel,
       .aurvin-canvas-panel[data-canvas-state='open'],
       .aurvin-canvas-panel[data-canvas-state='exiting'] {
         animation: none;
         transition: none;
         transform: none;
       }

       .aurvin-prompt-traveler-tick,
       .aurvin-prompt-traveler-chevron,
       .aurvin-prompt-traveler-popover,
       .aurvin-prompt-traveler-item {
         transition: none;
       }
     }
     ```

- [ ] **Step 4: Run ChatView, composition, and stylesheet tests to verify GREEN**

Run in `frontend`:
```bash
npm test -- src/features/chat/ChatView.voice.test.ts src/features/voice/live/live-voice-composition.test.ts src/styles/styles.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Coordinate shared Git index access with the orchestrator, then run:
```bash
git add frontend/src/features/chat/ChatView.tsx frontend/src/styles/chat.css frontend/src/features/chat/ChatView.voice.test.ts frontend/src/features/voice/live/live-voice-composition.test.ts frontend/src/styles/styles.test.ts
git commit -m "feat(voice-canvas): compose live split-screen Canvas with 320ms slide lifecycle"
```

---

### Task 5: Post-Call Main-Transcript Inline Explanations and Canvas Cards Outside Call Grouping

**Files:**
- Modify: `frontend/src/components/group-voice-messages.ts`
- Modify: `frontend/src/components/MessageItem.tsx`
- Test: `frontend/src/components/group-voice-messages.test.ts`
- Test: `frontend/src/components/MessageItem.test.ts`

- [ ] **Step 1: Write failing grouping and inline voice-card rendering tests**

1. Append the following tests to `frontend/src/components/group-voice-messages.test.ts`:

```typescript
  it('exposes completed voice turns with valid canvasArtifacts outside the consolidated call pill while preserving call duration and full transcript modal items', () => {
    clearVoiceDurationsCache();
    const chartProjection = {
      responseId: 'resp_mars_1',
      ordinal: 0,
      kind: 'chart' as const,
      subType: 'Bar Chart',
      title: 'Planet Distances',
      rawSource: '{"type":"bar","labels":["Earth","Mars"],"datasets":[{"label":"AU","data":[1,1.52]}]}',
    };
    const input: VisibleMessage[] = [
      createVoiceTurn('v1', 'call-visual', 'user', 'Compare Earth and Mars distances.', '2026-11-02T10:00:00.000Z'),
      {
        ...createVoiceTurn(
          'v2',
          'call-visual',
          'assistant',
          'Here is the orbital distance comparison between Earth and Mars.',
          '2026-11-02T10:00:12.000Z',
        ),
        canvasArtifacts: [chartProjection],
      },
      createVoiceTurn('v3', 'call-visual', 'user', 'Thanks Aurvin.', '2026-11-02T10:00:18.000Z'),
      createVoiceTurn('v4', 'call-visual', 'assistant', 'Anytime.', '2026-11-02T10:00:22.000Z'),
    ];

    const output = groupVoiceMessages(input);

    // 1 consolidated call indicator pill + 1 inline visual assistant turn = 2 entries
    expect(output).toHaveLength(2);

    const callPill = output[0];
    expect(callPill.messageId).toBe('voice_call_call-visual');
    expect(callPill.voiceSessionId).toBe('call-visual');
    expect(callPill.voiceDurationSeconds).toBe(22);
    expect(callPill.canvasArtifacts).toBeUndefined();
    expect(callPill.voiceTranscripts).toHaveLength(4);

    const inlineVisualTurn = output[1];
    expect(inlineVisualTurn.messageId).toBe('v2');
    expect(inlineVisualTurn.role).toBe('assistant');
    expect(inlineVisualTurn.canvasArtifacts).toEqual([chartProjection]);
    expect(inlineVisualTurn.voiceTranscripts).toEqual([
      {
        role: 'assistant',
        content: 'Here is the orbital distance comparison between Earth and Mars.',
        createdAt: '2026-11-02T10:00:12.000Z',
      },
    ]);
  });

  it('splits a single-turn voice call with valid canvasArtifacts into one call pill plus the original inline visual turn with distinct messageIds', () => {
    clearVoiceDurationsCache();
    const mermaidProjection = {
      responseId: 'resp_single_1',
      ordinal: 0,
      kind: 'mermaid' as const,
      subType: 'Flowchart',
      title: 'Cache Flow',
      rawSource: 'flowchart LR\n  API --> Cache',
    };
    const singleVisual: VisibleMessage = {
      ...createVoiceTurn(
        'v_single',
        'call-single-visual',
        'assistant',
        'Requests check the cache first.',
        '2026-11-02T11:00:00.000Z',
        9,
      ),
      canvasArtifacts: [mermaidProjection],
    };

    const output = groupVoiceMessages([singleVisual]);
    expect(output).toHaveLength(2);
    expect(output[0].messageId).toBe('voice_call_call-single-visual');
    expect(output[0].voiceDurationSeconds).toBe(9);
    expect(output[0].canvasArtifacts).toBeUndefined();
    expect(output[1].messageId).toBe('v_single');
    expect(output[1].canvasArtifacts).toEqual([mermaidProjection]);
  });

  it('ignores malformed canvasArtifacts and keeps the voice turn consolidated as a standard call pill without broken inline rows', () => {
    const malformed: VisibleMessage = {
      ...createVoiceTurn(
        'v_bad',
        'call-malformed',
        'assistant',
        'Spoken answer still works.',
        '2026-11-02T11:05:00.000Z',
        6,
      ),
      canvasArtifacts: [
        {
          responseId: 'resp_bad',
          ordinal: 99,
          kind: 'mermaid',
          subType: 'Flowchart',
          title: 'Invalid Ordinal',
          rawSource: 'flowchart TD\n  A --> B',
        },
      ],
    };

    const output = groupVoiceMessages([malformed]);
    expect(output).toHaveLength(1);
    expect(output[0].voiceSessionId).toBe('call-malformed');
    expect(output[0].canvasArtifacts).toBeUndefined();
    expect(output[0].voiceTranscripts).toEqual([
      {
        role: 'assistant',
        content: 'Spoken answer still works.',
        createdAt: '2026-11-02T11:05:00.000Z',
      },
    ]);
  });
```

2. Append the following tests to `frontend/src/components/MessageItem.test.ts`:

```typescript
  it('renders inline spoken explanation and CanvasArtifactCard triggers for voice assistant turns with valid canvasArtifacts without duplicating text or exposing text-SSE Retry', () => {
    const html = renderMessage({
      messageId: 'voice_vis_1',
      turnId: 'turn_vis_1',
      role: 'assistant',
      content: '',
      completionStatus: 'interrupted',
      mode: 'live',
      voiceSessionId: 'voice_sess_vis',
      voiceTranscripts: [
        {
          role: 'assistant',
          content: 'Notice how traffic splits across the primary and standby regions.',
        },
      ],
      canvasArtifacts: [
        {
          responseId: 'resp_vis_1',
          ordinal: 0,
          kind: 'mermaid',
          subType: 'Flowchart',
          title: 'Region Failover',
          rawSource: 'flowchart TD\n  DNS --> Primary\n  DNS --> Standby',
        },
        {
          responseId: 'resp_vis_1',
          ordinal: 2,
          kind: 'chart',
          subType: 'Line Graph',
          title: 'Failover Latency',
          rawSource: '0s: 20\n5s: 45\n10s: 21',
        },
      ],
    });

    expect(html).not.toContain('aurvin-voice-chat-indicator');
    expect(html).toContain('class="aurvin-message aurvin-message-assistant"');
    expect(html).toContain('Notice how traffic splits across the primary and standby regions.');
    expect(
      html.match(/Notice how traffic splits across the primary and standby regions\./g),
    ).toHaveLength(1);
    expect(html).toContain('data-canvas-artifact-id="resp_vis_1::canvas::0"');
    expect(html).toContain('aria-label="View diagram: Region Failover"');
    expect(html).toContain('data-canvas-artifact-id="resp_vis_1::canvas::2"');
    expect(html).toContain('aria-label="View graph: Failover Latency"');
    expect(html).toContain('Generation interrupted');
    expect(html).not.toContain('aria-label="Retry generation"');
    expect(html).toContain('aria-label="Copy response"');
  });

  it('renders inline CanvasArtifactCard cleanly even when an interrupted voice turn has empty spoken explanation, and falls back to call pill if canvasArtifacts are malformed', () => {
    const preAudioInterruptedHtml = renderMessage({
      messageId: 'voice_pre_audio',
      turnId: 'turn_pre_audio',
      role: 'assistant',
      content: '',
      completionStatus: 'cancelled',
      mode: 'live',
      voiceSessionId: 'voice_sess_pre',
      voiceTranscripts: [{ role: 'assistant', content: '' }],
      canvasArtifacts: [
        {
          responseId: 'resp_pre_1',
          ordinal: 0,
          kind: 'svg',
          subType: 'SVG Visual',
          title: 'Topology Icon',
          rawSource: '<svg viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" /></svg>',
        },
      ],
    });
    expect(preAudioInterruptedHtml).toContain('data-canvas-artifact-id="resp_pre_1::canvas::0"');
    expect(preAudioInterruptedHtml).toContain('Cancelled');
    expect(preAudioInterruptedHtml).not.toContain('aurvin-copy-btn');

    const malformedFallbackHtml = renderMessage({
      messageId: 'voice_malformed',
      role: 'assistant',
      content: '',
      mode: 'live',
      voiceSessionId: 'voice_sess_bad',
      voiceDurationSeconds: 11,
      voiceTranscripts: [{ role: 'assistant', content: 'Clean fallback speech.' }],
      canvasArtifacts: [
        {
          responseId: 'resp_bad',
          ordinal: 0,
          kind: 'mermaid',
          subType: 'Flowchart',
          title: 'Empty Source',
          rawSource: 'flowchart TD',
        },
      ],
    });
    expect(malformedFallbackHtml).toContain('aurvin-voice-chat-indicator');
    expect(malformedFallbackHtml).toContain('Voice Chat · 11s');
    expect(malformedFallbackHtml).not.toContain('aurvin-canvas-card');
  });
```

- [ ] **Step 2: Run the focused grouping and MessageItem tests to verify RED**

Run in `frontend`:
```bash
npm test -- src/components/group-voice-messages.test.ts src/components/MessageItem.test.ts
```
Expected: FAIL because `groupVoiceMessages` currently collapses all turns sharing `voiceSessionId` into a single call pill without inline visual rows, and `MessageItem` branches unconditionally on `if (message.voiceSessionId)` before checking `extractVoiceMessageCanvasArtifacts(message)`.

- [ ] **Step 3: Implement `group-voice-messages.ts` and `MessageItem.tsx`**

1. Replace `frontend/src/components/group-voice-messages.ts` with:

```typescript
/**
 * ============================================================================
 * FILE: group-voice-messages.ts
 * LOCATION: frontend/src/components/group-voice-messages.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Consolidate contiguous voice session turns while surfacing visual Canvas turns.
 *
 * ROLE IN PROJECT:
 *    Preserves a consolidated Voice Chat duration + full-transcript pill per call
 *    block while emitting completed assistant voice turns that carry validated
 *    Canvas artifacts as inline main-transcript items right after the call pill.
 *
 * KEY COMPONENTS:
 *    - clearVoiceDurationsCache: Resets cached per-session duration fallbacks.
 *    - groupVoiceMessages: Groups consecutive voiceSessionId messages and surfaces
 *      validated visual turns outside the grouped call modal.
 * ============================================================================
 */

import type { VisibleMessage, VoiceTranscriptItem } from '../api/protocol.ts';
import { extractVoiceMessageCanvasArtifacts } from '../features/canvas/index.ts';

const knownVoiceDurations = new Map<string, number>();

export function clearVoiceDurationsCache(): void {
  knownVoiceDurations.clear();
}

function collectGroupTranscripts(group: readonly VisibleMessage[]): VoiceTranscriptItem[] {
  const allTranscripts: VoiceTranscriptItem[] = [];
  for (const msg of group) {
    if (msg.voiceTranscripts && msg.voiceTranscripts.length > 0) {
      allTranscripts.push(...msg.voiceTranscripts);
    } else if (msg.content) {
      allTranscripts.push({
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
      });
    }
  }
  return allTranscripts;
}

function resolveGroupDuration(
  sessionId: string,
  group: readonly VisibleMessage[],
): number | undefined {
  const first = group[0]!;
  const last = group[group.length - 1]!;
  const explicitDuration =
    group.find(
      (m) => typeof m.voiceDurationSeconds === 'number' && m.voiceDurationSeconds > 0,
    )?.voiceDurationSeconds ?? knownVoiceDurations.get(sessionId);

  let calculatedDuration: number | undefined = explicitDuration;
  if (calculatedDuration === undefined && first.createdAt && last.createdAt) {
    const startMs = new Date(first.createdAt).getTime();
    const endMs = new Date(last.createdAt).getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs) {
      const diffSec = Math.round((endMs - startMs) / 1000);
      if (diffSec > 0) {
        calculatedDuration = diffSec;
      }
    }
  }

  if (typeof calculatedDuration === 'number' && calculatedDuration > 0) {
    knownVoiceDurations.set(sessionId, calculatedDuration);
  }
  return calculatedDuration;
}

export function groupVoiceMessages(messages: VisibleMessage[]): VisibleMessage[] {
  const result: VisibleMessage[] = [];
  const usedPillIds = new Set<string>();
  let currentGroup: VisibleMessage[] = [];
  let currentSessionId: string | null = null;

  const nextPillMessageId = (sessionId: string): string => {
    const base = `voice_call_${sessionId}`;
    if (!usedPillIds.has(base)) {
      usedPillIds.add(base);
      return base;
    }
    const disambiguated = `${base}_${result.length}`;
    usedPillIds.add(disambiguated);
    return disambiguated;
  };

  const flush = () => {
    if (currentGroup.length === 0 || !currentSessionId) {
      currentGroup = [];
      currentSessionId = null;
      return;
    }

    const visualTurns = currentGroup.filter(
      (msg) => extractVoiceMessageCanvasArtifacts(msg).length > 0,
    );
    const allTranscripts = collectGroupTranscripts(currentGroup);
    const calculatedDuration = resolveGroupDuration(currentSessionId, currentGroup);

    if (currentGroup.length === 1 && visualTurns.length === 0) {
      const { canvasArtifacts: _discardedInvalidArtifacts, ...singleWithoutArtifacts } =
        currentGroup[0]!;
      result.push({
        ...singleWithoutArtifacts,
        voiceDurationSeconds: calculatedDuration,
        voiceTranscripts: allTranscripts,
      });
    } else {
      const first = currentGroup[0]!;
      const last = currentGroup[currentGroup.length - 1]!;
      const consolidated: VisibleMessage = {
        messageId: nextPillMessageId(currentSessionId),
        turnId: last.turnId,
        eventId: last.eventId,
        sequence: last.sequence,
        role: 'assistant',
        content: '',
        createdAt: first.createdAt,
        completionStatus: last.completionStatus,
        truncated: last.truncated,
        mode: 'live',
        visibility: 'visible',
        voiceSessionId: currentSessionId,
        voiceDurationSeconds: calculatedDuration,
        voiceTranscripts: allTranscripts,
      };
      result.push(consolidated);

      for (const visualTurn of visualTurns) {
        result.push(visualTurn);
      }
    }

    currentGroup = [];
    currentSessionId = null;
  };

  for (const msg of messages) {
    if (msg.voiceSessionId) {
      if (currentSessionId === msg.voiceSessionId) {
        currentGroup.push(msg);
      } else {
        flush();
        currentSessionId = msg.voiceSessionId;
        currentGroup = [msg];
      }
    } else {
      flush();
      result.push(msg);
    }
  }

  flush();
  return result;
}
```

2. Replace `frontend/src/components/MessageItem.tsx` with:

```tsx
/**
 * ============================================================================
 * FILE: MessageItem.tsx
 * LOCATION: frontend/src/components/MessageItem.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Render safe message content, live placeholders, copy actions, voice pills,
 *    and inline post-call Canvas visual cards.
 *
 * ROLE IN PROJECT:
 *    Distinguishes user plaintext from assistant Markdown, renders Voice Chat
 *    indicator pills with transcript modals, surfaces inline spoken explanations
 *    and CanvasArtifactCard buttons for completed voice turns with visuals, and
 *    copies prompt or response text to the clipboard.
 *
 * KEY COMPONENTS:
 *    - MessageItem: Main message entry point supporting text, call pills, and inline voice visuals.
 *    - CopyMessageButton: Copies prompt or response text with copied feedback.
 *    - SafeMarkdown / CanvasArtifactCard: Assistant prose and Canvas visual triggers.
 *    - VoiceTranscriptModal: Hovering window modal displaying full call transcripts.
 * ============================================================================
 */

import { memo, useEffect, useMemo, useState } from 'react';
import type { VisibleMessage } from '../api/protocol.ts';
import {
  CanvasArtifactCard,
  extractVoiceMessageCanvasArtifacts,
} from '../features/canvas/index.ts';
import { SafeMarkdown } from '../features/chat/markdown/safe-markdown.tsx';
import { IconCheck, IconCopy } from './icons.tsx';
import { getMessagePresentation } from './message-presentation.ts';
import { formatVoiceDuration, VoiceTranscriptModal } from './VoiceTranscriptModal.tsx';

const COPIED_FEEDBACK_MS = 1800;

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API unavailable in non-secure or headless context
  }
  return false;
}

function CopyMessageButton({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  const actionLabel = copied ? 'Copied' : label;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="aurvin-copy-btn"
      aria-label={actionLabel}
      onClick={() => {
        void copyTextToClipboard(text).then((ok) => {
          if (ok) setCopied(true);
        });
      }}
    >
      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
      <span className="aurvin-copy-tooltip" role="tooltip">{actionLabel}</span>
    </button>
  );
}

export const MessageItem = memo(function MessageItem({
  message,
  liveStatus,
  activeArtifactId = null,
  onOpenArtifact,
  onRetry,
}: {
  message: VisibleMessage;
  liveStatus?: string;
  activeArtifactId?: string | null;
  onOpenArtifact?: (artifactId: string) => void;
  onRetry?: (turnId: string) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const voiceArtifacts = useMemo(
    () => extractVoiceMessageCanvasArtifacts(message),
    [message],
  );

  if (message.voiceSessionId && voiceArtifacts.length === 0) {
    const durationText = formatVoiceDuration(message.voiceDurationSeconds);
    const label =
      message.voiceDurationSeconds === undefined
        ? 'Voice message'
        : `Voice Chat · ${durationText}`;
    return (
      <article
        className="aurvin-voice-chat-indicator"
        data-voice-session-id={message.voiceSessionId}
      >
        <button
          type="button"
          className="aurvin-voice-chat-pill"
          title='"show transcript"'
          aria-label={`${label}. "show transcript"`}
          onClick={() => setModalOpen(true)}
        >
          <span className="aurvin-voice-chat-waveform" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1.5" y="5" width="2" height="6" rx="1" />
              <rect x="5.5" y="2" width="2" height="12" rx="1" />
              <rect x="9.5" y="4" width="2" height="8" rx="1" />
              <rect x="13.5" y="6" width="2" height="4" rx="1" />
            </svg>
          </span>
          <span className="aurvin-voice-chat-label">{label}</span>
          <span className="aurvin-voice-tooltip" role="tooltip">&quot;show transcript&quot;</span>
        </button>
        {modalOpen ? (
          <VoiceTranscriptModal
            durationSeconds={message.voiceDurationSeconds}
            transcripts={message.voiceTranscripts ?? []}
            onClose={() => setModalOpen(false)}
          />
        ) : null}
      </article>
    );
  }

  const isUser = message.role === 'user';
  const status = liveStatus ?? message.completionStatus;
  const { generatingClassName, terminalStatus } = getMessagePresentation(message, liveStatus);
  const voiceExplanation =
    voiceArtifacts.length > 0
      ? (message.voiceTranscripts
          ?.filter((item) => item.role === 'assistant' && item.content.trim().length > 0)
          .map((item) => item.content.trim())
          .join('\n\n') ?? '')
      : '';
  const displayContent = message.content.length > 0 ? message.content : voiceExplanation;
  const copyText = isUser ? message.content : displayContent;
  const canCopy = copyText.length > 0;
  const copyButton = canCopy ? (
    <CopyMessageButton
      text={copyText}
      label={isUser ? 'Copy message' : 'Copy response'}
    />
  ) : null;

  return (
    <article
      className={`aurvin-message ${isUser ? 'aurvin-message-user' : 'aurvin-message-assistant'}`}
      data-role={message.role}
      data-status={status}
      data-message-id={message.messageId}
      data-turn-id={message.turnId}
    >
      {isUser ? (
        <>
          <div className="aurvin-bubble">{message.content}</div>
          {copyButton}
        </>
      ) : (
        <div className="aurvin-message-body">
          {generatingClassName ? (
            <span className={generatingClassName}>Generating…</span>
          ) : (
            <div className="aurvin-message-content">
              {voiceArtifacts.length > 0 ? (
                <>
                  {displayContent.length > 0 ? (
                    <SafeMarkdown
                      content={displayContent}
                      messageId={message.messageId}
                      isStreaming={false}
                      activeArtifactId={activeArtifactId}
                      onOpenArtifact={onOpenArtifact}
                    />
                  ) : null}
                  {voiceArtifacts.map((artifact) => (
                    <CanvasArtifactCard
                      key={artifact.artifactId}
                      artifact={artifact}
                      isActive={activeArtifactId === artifact.artifactId}
                      onOpen={onOpenArtifact}
                    />
                  ))}
                </>
              ) : (
                <SafeMarkdown
                  content={message.content}
                  messageId={message.messageId}
                  isStreaming={status === 'streaming' || status === 'generating'}
                  activeArtifactId={activeArtifactId}
                  onOpenArtifact={onOpenArtifact}
                />
              )}
            </div>
          )}

          {terminalStatus === 'truncated' ? (
            <span className="aurvin-status-badge aurvin-badge-truncated">
              Response reached maximum length
            </span>
          ) : null}

          {terminalStatus === 'cancelled' ? (
            <span className="aurvin-status-badge aurvin-badge-failed">Cancelled</span>
          ) : null}

          {terminalStatus === 'failed' || terminalStatus === 'interrupted' ? (
            <div className="aurvin-retry-row">
              <span className="aurvin-status-badge aurvin-badge-failed">
                {terminalStatus === 'failed' ? 'Generation failed' : 'Generation interrupted'}
              </span>
              {!message.voiceSessionId ? (
                <button
                  type="button"
                  className="aurvin-retry-btn"
                  onClick={() => onRetry?.(message.turnId)}
                  aria-label="Retry generation"
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}

          {copyButton ? <div className="aurvin-message-actions">{copyButton}</div> : null}
        </div>
      )}
    </article>
  );
});
```

- [ ] **Step 4: Run grouping, MessageItem, and Transcript suites to verify GREEN**

Run in `frontend`:
```bash
npm test -- src/components/group-voice-messages.test.ts src/components/MessageItem.test.ts src/components/Transcript.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Coordinate shared Git index access with the orchestrator, then run:
```bash
git add frontend/src/components/group-voice-messages.ts frontend/src/components/MessageItem.tsx frontend/src/components/group-voice-messages.test.ts frontend/src/components/MessageItem.test.ts
git commit -m "feat(voice-canvas): expose post-call inline explanations and Canvas cards outside call grouping"
```

---

### Task 6: Full P2 Frontend Verification Gate and W2 → P3 Handoff Evidence

**Files:**
- Verify only (no new edits unless fixing a regression inside P2's 15 owned source files or 10 owned test files)

- [ ] **Step 1: Run the full frontend Vitest suite**

Run in `frontend`:
```bash
npm test
```
Expected: Exit code `0`, all discovered `src/**/*.test.ts` suites PASS with zero skipped or empty suites.

- [ ] **Step 2: Run the frontend linter**

Run in `frontend`:
```bash
npm run lint
```
Expected: Exit code `0` (`oxlint` passes with 0 errors and 0 new warnings).

- [ ] **Step 3: Run the full TypeScript and Vite production build**

Run in `frontend`:
```bash
npm run build
```
Expected: Exit code `0` (`tsc -b && vite build` succeeds cleanly against W1's committed `voice-protocol.ts` and `protocol.ts`).

- [ ] **Step 4: Verify whitespace hygiene and strict P2 file-ownership boundaries**

Run at repository root:
```bash
git diff --check
git status --short
```
Expected:
- `git diff --check` prints nothing (exit code `0`).
- Every commit produced by W2 touched **only** paths in P2's 15 owned implementation files and 10 owned test files; `frontend/src/api/**`, `backend/**`, `docs/voice-canvas-multimodal/state.md`, and `frontend/src/features/voice/integration-tests/**` remain untouched by W2.

- [ ] **Step 5: Report W2 completion and explicit browser-only assertions deferred to P3**

In W2's completion report to the orchestrator, record:
1. All commit hashes from Tasks 1–5 and exact command outputs/counts for `npm test`, `npm run lint`, and `npm run build`.
2. **Node-verified P2 gates** (proven in `environment: 'node'`):
   - Pre-audio, in-speech, multi-artifact (`ordinal` `0..2`, including ordinal gaps), multi-turn, and multi-session `canvas.artifact` reception and `${responseId}::canvas::${ordinal}` deduplication.
   - Malformed, oversized, out-of-range, unrenderable, stale-epoch, and post-cancel artifact rejection without throwing or rendering partial/broken cards.
   - Barge-in retention of already accepted artifacts alongside rejection of cancelled in-flight candidates.
   - Provisional-to-archive bridge across `ending` / `messagesLoading` and authoritative archive takeover once `idle` + `!messagesLoading`.
   - Mermaid (flowchart + sequence), Chart (bar, line, pie, untyped `Line Graph` parity, scatter/`X-Y Point Plot`), and sanitized SVG rendering safety.
   - `Stop speaking` button, `Canvas` toggle (`aria-expanded`, `aria-controls="aurvin-canvas-panel"`, unique count badge while active or suspended, `Alt+C` shortcut), `inert` + `aria-hidden` exit state, reduced-motion helper, focus-restoration target resolution, and zero mic/socket/playback disruption across toggle/tab/dismiss/reopen actions.
   - Post-call main-transcript inline spoken explanations and `CanvasArtifactCard` buttons outside grouped call pills, with call duration and `VoiceTranscriptModal` access intact.
3. **Browser-only assertions explicitly awaiting P3 (`plan3.md` / `verification.md`)** — W2 must **not** claim Node tests prove these:
   - Real browser computed layout geometry (`380px` to `50vw` desktop split width, `<= 900px` mobile overlay, zero horizontal clipping/scroll across desktop and narrow mobile viewports).
   - Real browser CSS keyframe execution (right-to-left slide-in and left-to-right slide-out over `320ms cubic-bezier(0.32, 0.72, 0, 1)`, and real `matchMedia('(prefers-reduced-motion: reduce)')` instant layout in a live DOM).
   - Real DOM active-element focus transitions on live interactive click/keyboard sequences.
   - Real end-to-end `< 5s` turn-to-rendered-Canvas latency, audible walkthrough vs. Canvas render timestamp alignment, and `< 250ms` browser playback stop latency on barge-in / `Stop speaking`.

---

## Acceptance Coverage Matrix (P2 Scope)

| Goal / Acceptance Criterion | P2 Task(s) | Owned Verification Suite(s) |
| --- | --- | --- |
| **G2 / AC-1 / AC-3:** Clean speech vs. structured `canvas.artifact` reception (`mermaid`, `chart`, `svg`, untyped `graph` -> `Line Graph` parity, sanitized SVG) | Task 1, Task 2 | `canvas.test.ts`, `live-voice-controller.test.ts` |
| **G2 / G4 / AC-2:** Pre-audio and in-speech reception, auto-open on new artifact, 320 ms right-to-left slide lifecycle, `380px`–`50vw` desktop split & mobile sheet, `prefers-reduced-motion` | Task 1, Task 2, Task 4 | `canvas.test.ts`, `ChatView.voice.test.ts`, `styles.test.ts` *(real browser geometry/frames/5s timing verified in P3)* |
| **G3 / G4 / AC-4:** Media continuity across auto-open, tab selection, dismiss, audio ticks, and reopen; accessible toggle with unique count while speaking or paused | Task 2, Task 3, Task 4 | `live-voice-controls.test.ts`, `live-voice-surface.test.ts`, `live-voice-composition.test.ts` |
| **G2 / G4 / AC-5:** Barge-in and `Stop speaking` UI control retain accepted visuals and reject cancelled in-flight visuals across epoch/response fences | Task 2, Task 3 | `live-voice-reducer.test.ts`, `live-voice-controller.test.ts`, `live-voice-controls.test.ts` *(browser `< 250ms` audio stop verified in P3)* |
| **G3 / G4 / AC-6:** Post-call and post-reload inline assistant explanations + inline `CanvasArtifactCard` items outside call grouping while preserving call duration & modal transcript; unified `${responseId}::canvas::${ordinal}` identity without flash or unpersisted ghosts | Task 1, Task 2, Task 4, Task 5 | `canvas.test.ts`, `ChatView.voice.test.ts`, `group-voice-messages.test.ts`, `MessageItem.test.ts` |
| **G3 / AC-7:** Follow-up turns reuse unified session Canvas artifacts across live and text modes | Task 1, Task 4, Task 5 | `canvas.test.ts`, `ChatView.voice.test.ts` *(end-to-end backend context assembly verified in P1/P3)* |
| **G1–G4 / AC-8:** Oversized, malformed, out-of-range, unrenderable, duplicate, or out-of-sequence wire/archive artifacts discarded safely without crashing or broken cards | Task 1, Task 2, Task 5 | `canvas.test.ts`, `live-voice-controller.test.ts`, `group-voice-messages.test.ts`, `MessageItem.test.ts` |
