# Dictation Composer Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this harness load `executing-plans`, `test-driven-development`, and `frontend-design`; do not dispatch another agent without the orchestrator's authorization.

**Goal:** Add draft-only dictation with selection-safe transcription, accessible composer controls, an atomic Send interlock, and bounded Stop/Cancel/recovery behavior in both composer placements.

**Architecture:** Reuse P4's capture and native voice clients, P5's dictation gateway, and the existing chat draft. One small dictation controller owns a recording's immutable snapshot and lifecycle; `useDictation` binds it to React and the textarea. A token-fenced chat draft lease blocks every local submit/retry path synchronously, while the reducer protects against stale draft writes and P8 reuses the same mode-exclusion seam.

**Tech Stack:** Existing React 19, TypeScript 6, Vite 8, Node-environment Vitest 4, `react-dom/server`, native browser APIs; no new dependencies or test environment.

---

## Execution gates and ownership

- Scope sources: [goal.md](goal.md), D1–D8 and A1–A6/A14/A17/A18; [research.md](research.md), sections 3–6; [state.md](state.md), P7 ownership and prerequisites. Read [plan4.md](plan4.md) and [plan5.md](plan5.md), then their **actual implementation**, not research's simplified event examples.
- P4 is implemented in `ac707b7..2e2e9e4`. P5 was still executing when this plan was written. **Do not start the P7 worker until the orchestrator reports verified P5 completion and clears overlapping chat-state user changes.** A committed P5 plan or partial worker commit is insufficient.
- This planning turn changes only `docs/voice-modes/plan7.md`. Existing modified chat reducer/types/tests, session/sidebar changes, CSS, logos, configuration, and other workers' files are not adopted or staged. The worker must add narrow patches to the current files, not replace them with an older baseline.
- P7 owns the paths in the file map below. No `ChatView.tsx`, live panel, shared `frontend/src/styles/chat.css`, API protocol/client, audio/transport source, package/lock/test configuration, application entry point, backend, or P11 integration-test edits. Request serialized P1/P4/P5 follow-ups for upstream defects instead of silently changing contracts.
- Dictation never calls `submitTurn`, `retryTurn`, the LLM, or persistence. New Chat remains unsaved; its voice request has `conversationId: null`. No identity, provider model, credentials, or additional `VITE_*` configuration comes from the browser.
- Live-panel behavior is P8-owned. P7 supplies a waveform callback and a shared lease, not a live session implementation. Until P8/P10 supply the callback, an enabled live entry is visibly disabled rather than pretending to start capture.
- Unified review is **skipped**, not passed. Tests, defect correction, and verification are required. The document is a plan, not evidence of implementation or device/provider certification.
- All eventual new code/test/CSS files need the root repository's valid-language file header. No code-documentation headers are included in this Markdown file or its listings. Keep existing headers accurate when modifying source.
- Commands marked **frontend** run with working directory `frontend`; git commands run at repository root. Use existing dependencies. Only P1 changes manifests or test configuration. Serialize staging/commits through the orchestrator; stage named owner files only.
- Framework references checked through Context7: [React refs](https://react.dev/reference/react/useRef), [controlled textarea](https://react.dev/reference/react-dom/components/textarea), [external-store subscriptions](https://react.dev/reference/react/useSyncExternalStore), and [Vitest mocks/timers](https://vitest.dev/api/vi). Keep side effects in handlers/effects and test operational deadlines with fake timers, not real sleeps.

## File map

| Action / exact path | Responsibility |
| --- | --- |
| Create `frontend/src/features/voice/components/ComposerVoiceControls.tsx` | Stateless, independently flagged mic/waveform entries and recording Stop/Cancel/status |
| Create `frontend/src/features/voice/dictation/composer-voice-controls.css` | Scoped controls, visible focus, narrow-layout wrapping, static recording feedback/reduced motion |
| Modify `frontend/src/components/icons.tsx` | Reuse `svgProps` for distinguishable microphone/waveform SVGs |
| Create `frontend/src/features/voice/dictation/dictation-draft.ts` | Immutable UTF-16 selection snapshot, bounded finalized segments, replaceable interim span |
| Create `frontend/src/features/voice/dictation/dictation-controller.ts` | Capture/session ownership, draft writes, stale-run fencing, terminal cleanup and deadlines |
| Create `frontend/src/features/voice/dictation/useDictation.ts` | Config fetch, external-store subscription, explicit gesture entry, selection/focus and page cleanup |
| Create `frontend/src/features/voice/dictation/testing/dictation-fixture.ts` | Small deterministic capture/socket/HTTP doubles and protocol-valid events |
| Create `frontend/src/features/voice/dictation/controls.test.ts` | Static flags, accessible labels, icons, operational controls |
| Create `frontend/src/features/voice/dictation/dictation-draft.test.ts` | Selection replacement, interim/final deduplication, empty and budget invariants |
| Create `frontend/src/features/voice/dictation/dictation-controller.test.ts` | Real controller with injected P4 ports; no hardware/network |
| Create `frontend/src/features/voice/dictation/composer-events.test.ts` | Actual composer handlers, selection restoration and scoped CSS regression checks |
| Create `frontend/src/features/voice/dictation/dictation-composition.test.ts` | Real P4 client + dictation controller + chat reducer, using existing socket fixtures |
| Modify `frontend/src/components/Composer.tsx`, `frontend/src/components/Composer.test.ts` | Both placements, read-only rather than disabled recording input, Stop/Cancel and keyboard interlock |
| Modify `frontend/src/features/chat/state/chat-types.ts`, `chat-reducer.ts`, `use-chat.ts`, `chat-context.tsx` | Token-fenced draft lease, shared synchronous guard, navigation invalidation, optional live-entry callback |
| Create `frontend/src/features/chat/state/voice-draft-lock.test.ts` | Reducer and actual action guards, including stale callbacks and direct navigation dispatch |

### Fixed interface decisions / P8 and P10 handoff

1. Use P1 `PublicVoiceConfig.enabledModes`, fetched through `VoiceHttpClient.config()`. While unavailable, both entries are absent; text remains usable. No client-side enable flag or provider call is a health probe.
2. Use P4 `AudioCaptureService.start()` only inside an activated start handler. Capture stays muted until `session.ready`; then await `setMuted(false)`. Stop must await `stop(true)` before `dictation.stop`; other endings use `stop(false)` and discard the tail. Keep finalizing callbacks eligible to forward the terminal input frame.
3. P1 events carry `sessionId`, `connectionEpoch`, `eventId`, `sequence`, and `segmentId`; completion carries `finalization: 'complete' | 'timeout' | 'empty'` and `unfinalizedTail`. P4 already validates wire order/size/epochs. The controller additionally fences its **recording instance**, so an old callback cannot mutate a new recording.
4. Preserve the original prefix/suffix byte-for-byte as JavaScript strings. Replace exactly the selected UTF-16 range. Do not trim/rewrite recognized nonempty text. Between successive speech segments only, insert a space if neither side already supplies whitespace and the next segment does not begin with closing punctuation. Equal spoken phrases with different segment IDs must remain repeated; deduplicate IDs, never text.
5. Empty speech, including a partial that never finalizes, restores the entire original draft; it does not erase the selection. Only finalized nonempty segments survive disconnect/timeout. The replaceable interim tail is removed, with a clear review warning; never silently promote interim text to a final.
6. Lock permission acquisition and connecting as well as recording/finalizing: otherwise typing during the permission prompt invalidates the snapshot. A read-only textarea remains focusable/selectable; it is not disabled for dictation. Existing disabled input/Cancel response semantics during text generation are unchanged.
7. Chat actions expose `claimVoiceInput(mode, onClose)`, `writeVoiceDraft(token, text)`, `releaseVoiceInput(token)`, and `isVoiceInputLocked()`. `state.voiceInput` exposes only `{ token, mode } | null`. P8 claims `live`, preserves the existing draft, and releases its token on exit. Claiming either mode excludes the other and text submit/retry in this tab; backend cross-tab admission stays P5/P6-owned.
8. `ChatProvider` accepts optional `startVoiceConversation?: () => void` and exposes that callback to Composer. P8/P10 wire it; P7 does not import future P8 modules or edit central assembly. P8 must claim the shared lease synchronously in its activation handler and restore/release on failure.
9. Navigation through New Chat, selection, or deletion of the selected session synchronously invokes the current lease's cleanup **before** reducing navigation. The reducer clears the token as a second fence. Ordinary draft writes while leased are rejected. Ending another tab/session is not inferred to be authentication.
10. Stop's browser watchdog is `min(2_000, negotiated finalizationMs)` from the **Stop click**, including local drain. The server has its own finalization deadline. The browser may conservatively abandon an unknown tail before a delayed server terminal event; it must warn, preserve finalized text, and drop late events. The duration timer uses negotiated `dictationMaxMs`; it is a UX safeguard, not a replacement for P9 server limits.

## Task 1: Composer Voice Controls & Icons

**Files:** Create `frontend/src/features/voice/components/ComposerVoiceControls.tsx`, `frontend/src/features/voice/dictation/composer-voice-controls.css`, `frontend/src/features/voice/dictation/controls.test.ts`; append icons to `frontend/src/components/icons.tsx` using its existing `IconProps` and `svgProps`.

- [ ] **1.1 (2–5 min): Write the failing static-render tests.** Entire initial `controls.test.ts`:

```typescript
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO,
  type PublicVoiceConfig } from '../../../api/voice-protocol.ts';
import { ComposerVoiceControls } from '../components/ComposerVoiceControls.tsx';

const config: PublicVoiceConfig = { protocolVersion: 1,
  enabledModes: { dictation: true, live: true }, supportedLocales: ['en-US'],
  limits: { ...DEFAULT_VOICE_LIMITS }, inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO };
const base = { config, locked: false, recording: false, finalizing: false,
  textBusy: false, otherMode: false, status: '', notice: null,
  onDictate: vi.fn(), onLive: vi.fn(), onStop: vi.fn(), onCancel: vi.fn() };
const render = (props: Partial<typeof base> = {}) =>
  renderToStaticMarkup(createElement(ComposerVoiceControls, { ...base, ...props }));

describe('composer voice controls', () => {
  it('hides entries until server config enables each mode independently', () => {
    expect(renderToStaticMarkup(createElement(ComposerVoiceControls,
      { ...base, config: null }))).toBe('');
    const onlyMic = render({ config: { ...config, enabledModes: { dictation: true, live: false } } });
    expect(onlyMic).toContain('aria-label="Dictate message"');
    expect(onlyMic).not.toContain('Start voice conversation');
    const onlyLive = render({ config: { ...config, enabledModes: { dictation: false, live: true } } });
    expect(onlyLive).not.toContain('Dictate message');
    expect(onlyLive).toContain('aria-label="Start voice conversation"');
  });
  it('provides native buttons and distinct decorative SVGs', () => {
    const html = render();
    expect(html).toContain('aria-label="Voice input"');
    expect(html.match(/type="button"/g)).toHaveLength(2);
    expect(html).toContain('data-voice-icon="microphone"');
    expect(html).toContain('data-voice-icon="waveform"');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(html).not.toContain('tabindex=');
    expect(html).toContain('Audio is processed to transcribe your message. Nothing is sent until you select Send.');
  });
  it.each([{ textBusy: true }, { otherMode: true }, { locked: true }])
    ('disables both entry buttons for %j', props => {
      expect(render(props).match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
    });
  it('keeps Stop and Cancel when an enabled recording loses config', () => {
    const html = renderToStaticMarkup(createElement(ComposerVoiceControls,
      { ...base, config: null, locked: true, recording: true, status: 'Recording' }));
    expect(html).toContain('aria-label="Stop dictation"');
    expect(html).toContain('aria-label="Cancel dictation"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Recording');
  });
  it('disables Stop during finalizing but keeps Cancel available', () => {
    const html = render({ locked: true, finalizing: true, status: 'Finalizing dictation' });
    expect(html).toMatch(/<button[^>]*aria-label="Stop dictation"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*aria-label="Cancel dictation"(?![^>]*disabled)/);
  });
});
```

- [ ] **1.2 (2 min): Run RED, frontend.** `npm test -- src/features/voice/dictation/controls.test.ts`. Expected: missing component/export, not an empty discovery pass.
- [ ] **1.3 (2–5 min): Append the two icons without duplicating the SVG helper.**

```tsx
export function IconMicrophone({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} data-voice-icon="microphone">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
    </svg>
  );
}

export function IconWaveform({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} data-voice-icon="waveform">
      <path d="M4 10v4M8 6v12M12 3v18M16 6v12M20 10v4" />
    </svg>
  );
}
```

- [ ] **1.4 (2–5 min): Add the stateless controls.** Entire `ComposerVoiceControls.tsx`:

```tsx
import { useId } from 'react';
import type { PublicVoiceConfig } from '../../../api/voice-protocol.ts';
import { IconMicrophone, IconStop, IconWaveform } from '../../../components/icons.tsx';
import '../dictation/composer-voice-controls.css';

export type ComposerVoiceControlsProps = {
  config: PublicVoiceConfig | null;
  locked: boolean;
  recording: boolean;
  finalizing: boolean;
  textBusy: boolean;
  otherMode: boolean;
  status: string;
  notice: string | null;
  onDictate: () => void;
  onLive?: () => void;
  onStop: () => void;
  onCancel: () => void;
};

export function ComposerVoiceControls(props: ComposerVoiceControlsProps) {
  const descriptionId = useId();
  const enabled = props.config?.enabledModes;
  if (!enabled?.dictation && !enabled?.live && !props.locked && !props.notice) return null;
  const disabled = props.locked || props.textBusy || props.otherMode;
  return (
    <div className="aurvin-voice-controls" role="group" aria-label="Voice input">
      {enabled?.dictation ? (
        <button type="button" className="aurvin-voice-btn" aria-label="Dictate message"
          aria-describedby={descriptionId} title="Audio is processed to transcribe a draft. You choose when to send."
          disabled={disabled} onClick={props.onDictate}>
          <IconMicrophone />
        </button>
      ) : null}
      {enabled?.live ? (
        <button type="button" className="aurvin-voice-btn" aria-label="Start voice conversation"
          disabled={disabled || !props.onLive} onClick={props.onLive}>
          <IconWaveform />
        </button>
      ) : null}
      {props.locked ? (
        <>
          <button type="button" className="aurvin-voice-btn" aria-label="Stop dictation"
            disabled={!props.recording || props.finalizing} onClick={props.onStop}>
            <IconStop /> Stop
          </button>
          <button type="button" className="aurvin-voice-btn" aria-label="Cancel dictation"
            onClick={props.onCancel}>Cancel</button>
        </>
      ) : null}
      <span id={descriptionId} className="aurvin-voice-description">
        Audio is processed to transcribe your message. Nothing is sent until you select Send.
      </span>
      {props.status || props.notice ? (
        <span className="aurvin-voice-status" role="status" aria-live="polite" aria-atomic="true">
          {props.recording ? <span aria-hidden="true">■ </span> : null}
          {props.status}{props.notice ? ` — ${props.notice}` : ''}
        </span>
      ) : null}
    </div>
  );
}
```

`useId` avoids duplicate description IDs if both placements are mounted in a fixture. Status updates describe operations, not each recognized hypothesis. Do not put draft text in this live region.

- [ ] **1.5 (2–5 min): Add scoped styles.** Entire `composer-voice-controls.css`:

```css
.aurvin-voice-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  max-width: 100%;
}

.aurvin-voice-btn {
  min-width: 36px;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid var(--aurvin-border);
  border-radius: 18px;
  background: transparent;
  color: var(--aurvin-text-primary);
  font: inherit;
  cursor: pointer;
}

.aurvin-voice-btn:disabled { opacity: 0.5; cursor: default; }
.aurvin-voice-btn:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.aurvin-composer .aurvin-textarea:focus-visible { outline: 2px solid var(--aurvin-text-primary); outline-offset: 2px; }
.aurvin-composer .aurvin-textarea { min-width: 0; }
.aurvin-voice-status { flex-basis: 100%; color: var(--aurvin-text-secondary); font-size: 12px; }
.aurvin-voice-description {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .aurvin-voice-controls * { animation: none; transition: none; }
}
```

The recording square plus the word Recording works without color or animation. Reuse the current visual language; do not introduce a bubble or modify shared chat CSS.

- [ ] **1.6 (2 min): Run GREEN, frontend.** Same focused command, then `npm run build` and `npm run lint`. Expected: discovered controls cases pass and both checks succeed.
- [ ] **1.7 (2 min): Commit, serialized.**

```powershell
git add frontend/src/components/icons.tsx frontend/src/features/voice/components/ComposerVoiceControls.tsx frontend/src/features/voice/dictation/composer-voice-controls.css frontend/src/features/voice/dictation/controls.test.ts
git commit -m "feat(voice): add accessible flagged composer voice controls"
```

## Task 2: Dictation State & Hook

**Files:** Create `dictation-draft.ts`, `dictation-draft.test.ts`, `dictation-controller.ts`, `dictation-controller.test.ts`, `testing/dictation-fixture.ts`, and `useDictation.ts` under `frontend/src/features/voice/dictation/`. Task 2 establishes capture/state composition; Task 4 adds the tail-drain and deadline requirements before this feature is eligible for integration/release.

### 2A — Immutable selection snapshot and bounded transcript composition

- [ ] **2.1 (2–5 min): Write `dictation-draft.test.ts`.**

```typescript
import { expect, it } from 'vitest';
import { DictationDraft, snapshotDraft } from './dictation-draft.ts';

it('replaces only the selected range and replaces revised interim hypotheses', () => {
  const snapshot = snapshotDraft('Before OLD after', 7, 10, 'backward');
  expect(snapshot).toMatchObject({ prefix: 'Before ', suffix: ' after', selectedText: 'OLD',
    selection: { start: 7, end: 10, direction: 'backward' } });
  const draft = new DictationDraft(snapshot);
  draft.accept('dictation.partial', 'one', 'new');
  expect(draft.text()).toBe('Before new after');
  draft.accept('dictation.partial', 'one', 'new words');
  expect(draft.text()).toBe('Before new words after');
  draft.accept('dictation.final', 'one', 'New words.');
  draft.accept('dictation.final', 'one', 'New words.');
  draft.accept('dictation.partial', 'one', 'obsolete');
  draft.accept('dictation.partial', 'two', 'more');
  expect(draft.text()).toBe('Before New words. more after');
  expect(draft.text(false)).toBe('Before New words. after');
  draft.accept('dictation.final', 'two', 'New words.');
  expect(draft.text(false)).toBe('Before New words. New words. after');
});

it('keeps empty recordings and the selected text unchanged', () => {
  const draft = new DictationDraft(snapshotDraft('Keep selected text', 5, 13));
  expect(draft.text(false)).toBe('Keep selected text');
  draft.accept('dictation.partial', 'one', '');
  draft.accept('dictation.final', 'one', '');
  expect(draft.text()).toBe('Keep selected text');
  expect(draft.caret()).toEqual({ start: 5, end: 13, direction: 'none' });
});

it('preserves meaning, supplied whitespace, punctuation and UTF-16 caret positions', () => {
  const draft = new DictationDraft(snapshotDraft('🙂 [] end', 4, 4));
  draft.accept('dictation.final', 'one', 'ID AB-123, not 2026-10-09');
  draft.accept('dictation.final', 'two', '.');
  draft.accept('dictation.final', 'three', '  No, no.');
  expect(draft.text()).toBe('🙂 [ID AB-123, not 2026-10-09.  No, no.] end');
  expect(draft.caret().start).toBe(4 + 'ID AB-123, not 2026-10-09.  No, no.'.length);
});

it('rejects overflow without truncating the last accepted final or unrelated text', () => {
  const draft = new DictationDraft(snapshotDraft('x'.repeat(31_996), 31_996, 31_996));
  draft.accept('dictation.final', 'one', 'OK');
  expect(() => draft.accept('dictation.partial', 'two', 'overflow')).toThrow('DICTATION_DRAFT_LIMIT');
  expect(draft.text(false)).toBe('x'.repeat(31_996) + 'OK');
  expect(() => snapshotDraft('x'.repeat(32_001), 0, 0)).toThrow('DICTATION_DRAFT_LIMIT');
});

it('bounds remembered final IDs even when the provider returns empty segments', () => {
  const draft = new DictationDraft(snapshotDraft('Keep me', 0, 4));
  for (let i = 0; i < 4096; i++) draft.accept('dictation.final', `empty-${i}`, '');
  expect(() => draft.accept('dictation.final', 'overflow', '')).toThrow('DICTATION_DRAFT_LIMIT');
  expect(draft.text()).toBe('Keep me');
});
```

- [ ] **2.2 (2 min): Run RED, frontend.** `npm test -- src/features/voice/dictation/dictation-draft.test.ts` → missing module/export.
- [ ] **2.3 (2–5 min per function): Add the complete draft model.**

```typescript
export const MAX_DICTATION_DRAFT_CHARS = 32_000;
export type DraftSelection = { readonly start: number; readonly end: number;
  readonly direction: 'forward' | 'backward' | 'none' };
export type DraftSnapshot = { readonly original: string; readonly prefix: string; readonly suffix: string;
  readonly selectedText: string; readonly selection: DraftSelection };

export function snapshotDraft(original: string, start: number, end: number,
  direction: DraftSelection['direction'] = 'none'): DraftSnapshot {
  if (original.length > MAX_DICTATION_DRAFT_CHARS) throw new Error('DICTATION_DRAFT_LIMIT');
  const clamp = (value: number) => Number.isFinite(value)
    ? Math.max(0, Math.min(original.length, Math.trunc(value))) : original.length;
  const a = clamp(start), b = clamp(end);
  const selection = { start: Math.min(a, b), end: Math.max(a, b), direction };
  return { original, prefix: original.slice(0, selection.start), suffix: original.slice(selection.end),
    selectedText: original.slice(selection.start, selection.end), selection };
}

function joinSegments(parts: string[]) {
  return parts.reduce((text, part) => text +
    (text && part && !/\s$/.test(text) && !/^[\s.,!?;:)\]}]/.test(part) ? ' ' : '') + part, '');
}

export class DictationDraft {
  readonly snapshot: DraftSnapshot;
  private finals = new Map<string, string>();
  private interim: { id: string; text: string } | null = null;
  constructor(snapshot: DraftSnapshot) { this.snapshot = snapshot; }
  private inserted(includeInterim: boolean) {
    // ponytail: rebuild at most 32k characters / 4096 segments; no transcript archive here.
    return joinSegments([...this.finals.values()].filter(Boolean)
      .concat(includeInterim && this.interim ? [this.interim.text] : []));
  }
  private compose(inserted: string) {
    return inserted ? this.snapshot.prefix + inserted + this.snapshot.suffix : this.snapshot.original;
  }
  accept(type: 'dictation.partial' | 'dictation.final', id: string, text: string) {
    if (this.finals.has(id)) return;
    const oldInterim = this.interim;
    if (type === 'dictation.final') {
      if (this.finals.size >= 4096) throw new Error('DICTATION_DRAFT_LIMIT');
      this.finals.set(id, text.trim() ? text : '');
      if (this.interim?.id === id) this.interim = null;
    } else this.interim = text.trim() ? { id, text } : null;
    if (this.text().length > MAX_DICTATION_DRAFT_CHARS) {
      if (type === 'dictation.final') this.finals.delete(id);
      this.interim = oldInterim;
      throw new Error('DICTATION_DRAFT_LIMIT');
    }
  }
  text(includeInterim = true) { return this.compose(this.inserted(includeInterim)); }
  caret(): DraftSelection {
    const inserted = this.inserted(false);
    if (!inserted) return this.snapshot.selection;
    const end = this.snapshot.prefix.length + inserted.length;
    return { start: end, end, direction: 'none' };
  }
}
```

Empty finalized IDs are remembered to suppress their replay, but empty values do not introduce separators. Filtering empty values is not trimming or deduplicating recognized phrases.

- [ ] **2.4 (2 min): Run GREEN.** Same focused command; all five cases pass.

### 2B — Stateful controller, P4 ports and fixture

- [ ] **2.5 (2–5 min): Create the deterministic fixture.** Entire `testing/dictation-fixture.ts` (types are supplied by the controller listing immediately below):

```typescript
import { vi } from 'vitest';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO,
  type PublicVoiceConfig, type VoiceServerPayload } from '../../../../api/voice-protocol.ts';
import { session } from '../../transport/testing/voice-fakes.ts';
import { DictationController, type DictationPorts } from '../dictation-controller.ts';
import { snapshotDraft } from '../dictation-draft.ts';

export async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
export function dictationFixture(original = 'Before OLD after', start = 7, end = 10) {
  const response = session(1, 'dictation');
  const config: PublicVoiceConfig = { protocolVersion: 1,
    enabledModes: { dictation: true, live: true }, supportedLocales: ['en-US'],
    limits: { ...DEFAULT_VOICE_LIMITS }, inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO };
  let text = original, token = 0, sequence = 0;
  let captureCallbacks!: Parameters<DictationPorts['capture']>[0];
  let clientCallbacks!: Parameters<DictationPorts['client']>[0];
  const capture = { start: vi.fn(async () => {}), setMuted: vi.fn(async (_muted: boolean) => {}),
    stop: vi.fn(async (_drain = false) => {}) };
  const client = { connect: vi.fn(), sendInput: vi.fn((_pcm: Uint8Array, _flags?: 0 | 1) => true),
    control: vi.fn((_payload: Parameters<ReturnType<DictationPorts['client']>['control']>[0]) => true),
    dispose: vi.fn() };
  const http = { create: vi.fn(async (_request: Parameters<DictationPorts['http']['create']>[0],
    _signal?: AbortSignal) => response), end: vi.fn(async (_id: string) => {}) };
  const bindings = {
    claimVoiceInput: vi.fn((): string | null => `lease-${++token}`),
    writeVoiceDraft: vi.fn((_token: string, value: string) => { text = value; return true; }),
    releaseVoiceInput: vi.fn(), isVoiceInputLocked: vi.fn(() => false),
  };
  const controller = new DictationController({ http, bindings,
    capture: callbacks => { captureCallbacks = callbacks; return capture; },
    client: callbacks => { clientCallbacks = callbacks; return client; } });
  const event = (payload: VoiceServerPayload) => clientCallbacks.event?.({ protocolVersion: 1,
    sessionId: response.sessionId, connectionEpoch: response.connectionEpoch,
    eventId: `event-${sequence}`, sequence: sequence++, ...payload });
  const begin = async () => {
    await controller.start(snapshotDraft(original, start, end, 'backward'), null, config);
    event({ type: 'session.ready', limits: response.limits,
      effectiveAudioSettings: response.effectiveAudioSettings });
    await settle();
  };
  return { controller, response, config, capture, client, http, bindings, begin, event,
    text: () => text, callbacks: () => clientCallbacks,
    frame: (pcm: Uint8Array, flags: 0 | 1 = 0) => captureCallbacks.frame(pcm, flags) };
}
```

- [ ] **2.6 (2–5 min): Write the initial `dictation-controller.test.ts`.**

```typescript
import { expect, it } from 'vitest';
import { dictationFixture, settle } from './testing/dictation-fixture.ts';
import { snapshotDraft } from './dictation-draft.ts';

it('does not acquire a microphone before activation; unmutes only after ready', async () => {
  const f = dictationFixture();
  expect(f.capture.start).not.toHaveBeenCalled();
  await f.controller.start(snapshotDraft('Before OLD after', 7, 10), null, f.config);
  expect(f.capture.start).toHaveBeenCalledTimes(1);
  expect(f.controller.getSnapshot().phase).toBe('connecting');
  expect(f.capture.setMuted).not.toHaveBeenCalled();
  expect(f.http.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'dictation',
    conversationId: null, locale: 'en-US' }), expect.any(AbortSignal));
  f.event({ type: 'session.ready', limits: f.response.limits,
    effectiveAudioSettings: f.response.effectiveAudioSettings });
  await settle();
  expect(f.capture.setMuted).toHaveBeenCalledWith(false);
  expect(f.controller.getSnapshot().phase).toBe('recording');
  f.controller.cancel();
});

it('writes revisions into the existing draft without submitting a chat turn', async () => {
  const f = dictationFixture(); await f.begin();
  f.event({ type: 'dictation.partial', segmentId: 'one', text: 'hello' });
  f.event({ type: 'dictation.partial', segmentId: 'one', text: 'hello Aurvin' });
  expect(f.text()).toBe('Before hello Aurvin after');
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'Hello Aurvin.' });
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'Hello Aurvin.' });
  expect(f.text()).toBe('Before Hello Aurvin. after');
  expect(f.client.control).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().phase).toBe('recording');
  expect(Object.keys(f.http)).toEqual(['create', 'end']);
  f.controller.cancel();
});

it('Cancel restores the snapshot and a previous recording cannot write into a later one', async () => {
  const f = dictationFixture(); await f.begin(); const old = f.callbacks();
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'new' });
  f.controller.cancel();
  expect(f.text()).toBe('Before OLD after');
  expect(f.controller.getSnapshot().selection).toEqual({ start: 7, end: 10, direction: 'backward' });
  await f.begin();
  old.event?.({ protocolVersion: 1, sessionId: f.response.sessionId, connectionEpoch: 1,
    eventId: 'late', sequence: 99, type: 'dictation.final', segmentId: 'late', text: 'bad' });
  expect(f.text()).toBe('Before OLD after');
  f.controller.cancel();
});

it('disabled dictation or an occupied composer allocates no microphone/session', async () => {
  const f = dictationFixture(); f.config.enabledModes.dictation = false;
  await f.controller.start(snapshotDraft('Before OLD after', 7, 10), null, f.config);
  expect(f.bindings.claimVoiceInput).not.toHaveBeenCalled();
  f.config.enabledModes.dictation = true;
  f.bindings.claimVoiceInput.mockReturnValueOnce(null);
  await f.controller.start(snapshotDraft('Before OLD after', 7, 10), null, f.config);
  expect(f.capture.start).not.toHaveBeenCalled();
  expect(f.http.create).not.toHaveBeenCalled();
});
```

- [ ] **2.7 (2 min): Run RED, frontend.** `npm test -- src/features/voice/dictation/dictation-controller.test.ts` → missing controller/export.
- [ ] **2.8 (2–5 min per method): Add the controller.** Complete initial `dictation-controller.ts`; use type-only P4 imports here, keeping browser implementation construction in the hook.

```typescript
import type { VoiceHttpClient, VoiceClient, VoiceClientOptions } from '../../../api/voice-client.ts';
import type { PublicVoiceConfig, CreateVoiceSessionResponse, VoiceServerEvent } from '../../../api/voice-protocol.ts';
import type { AudioCaptureService } from '../audio/audio-capture-service.ts';
import { DictationDraft, type DraftSelection, type DraftSnapshot } from './dictation-draft.ts';

export type DictationBindings = {
  claimVoiceInput: (mode: 'dictation' | 'live', onClose: () => void) => string | null;
  writeVoiceDraft: (token: string, text: string) => boolean;
  releaseVoiceInput: (token: string) => void;
  isVoiceInputLocked: () => boolean;
};
export type DictationPorts = {
  http: Pick<VoiceHttpClient, 'create' | 'end'>;
  bindings: DictationBindings;
  capture: (options: ConstructorParameters<typeof AudioCaptureService>[0]) =>
    Pick<AudioCaptureService, 'start' | 'setMuted' | 'stop'>;
  client: (options: VoiceClientOptions) => Pick<VoiceClient, 'connect' | 'sendInput' | 'control' | 'dispose'>;
};
export type DictationView = {
  phase: 'idle' | 'requesting_permission' | 'connecting' | 'recording' | 'finalizing' | 'draft_ready';
  notice: string | null;
  selection: DraftSelection | null;
};
type Run = { token: string; draft: DictationDraft; abort: AbortController;
  capture?: ReturnType<DictationPorts['capture']>; client?: ReturnType<DictationPorts['client']>;
  session?: CreateVoiceSessionResponse; ready: boolean; endRequested: boolean };

const tailWarning = 'Some speech may be missing. Review your draft or dictate the remaining words again.';
function message(code: string) {
  if (code === 'MICROPHONE_DENIED') return 'Microphone access was denied. You can still type your message.';
  if (code === 'MICROPHONE_UNAVAILABLE' || code === 'MICROPHONE_LOST') return 'Microphone unavailable. Saved speech is kept; you can still type.';
  if (code === 'UNSUPPORTED_AUDIO' || code === 'PLAYBACK_BLOCKED') return 'Voice is unavailable in this browser. You can still type.';
  if (code === 'DICTATION_DRAFT_LIMIT') return 'The message limit was reached. Saved speech is kept; review or shorten your draft.';
  if (code === 'DICTATION_FINALIZATION_TIMEOUT') return tailWarning;
  return 'Dictation ended unexpectedly. Saved speech is kept; select Dictate message to record again.';
}

export class DictationController {
  private readonly ports: DictationPorts;
  private run: Run | null = null;
  private view: DictationView = { phase: 'idle', notice: null, selection: null };
  private listeners = new Set<() => void>();
  constructor(ports: DictationPorts) { this.ports = ports; }
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<DictationView>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private current(run: Run) { return this.run === run && !run.abort.signal.aborted; }
  async start(snapshot: DraftSnapshot, conversationId: string | null, config: PublicVoiceConfig) {
    if (this.run || !config.enabledModes.dictation) return;
    const token = this.ports.bindings.claimVoiceInput('dictation', () => this.disconnect());
    if (!token) return;
    const run: Run = { token, draft: new DictationDraft(snapshot), abort: new AbortController(),
      ready: false, endRequested: false };
    this.run = run;
    this.publish({ phase: 'requesting_permission', notice: null, selection: null });
    try {
      run.capture = this.ports.capture({ maxPendingMs: config.limits.inputQueueMs,
        frame: (pcm, flags) => {
          if (!this.current(run) || !run.ready) return;
          if (!run.client?.sendInput(pcm, flags)) this.disconnect('DICTATION_DISCONNECTED');
        }, error: code => { if (this.current(run)) this.disconnect(code); } });
      // start() calls getUserMedia before its first await; never invoke this from an effect.
      await run.capture.start();
      if (!this.current(run)) return;
      this.publish({ phase: 'connecting' });
      run.session = await this.ports.http.create({ protocolVersion: 1, mode: 'dictation',
        conversationId, locale: 'en-US', idempotencyKey: crypto.randomUUID() }, run.abort.signal);
      if (!this.current(run)) { this.endSession(run); return; }
      run.client = this.ports.client({ event: event => this.event(run, event),
        lost: () => { if (this.current(run)) this.disconnect(); },
        error: code => { if (this.current(run)) this.disconnect(code); },
        ended: () => { if (this.current(run)) this.disconnect(); } });
      run.client.connect(run.session);
    } catch (error) {
      if (this.current(run)) this.disconnect(error instanceof Error ? error.message : 'VOICE_CONNECT_TIMEOUT');
    }
  }
  private event(run: Run, event: VoiceServerEvent) {
    if (!this.current(run) || event.sessionId !== run.session?.sessionId ||
      event.connectionEpoch !== run.session.connectionEpoch) return;
    if (event.type === 'session.ready') {
      void this.ready(run);
    } else if (event.type === 'dictation.partial' || event.type === 'dictation.final') {
      try {
        run.draft.accept(event.type, event.segmentId, event.text);
        this.ports.bindings.writeVoiceDraft(run.token, run.draft.text());
      } catch { this.disconnect('DICTATION_DRAFT_LIMIT'); }
    } else if (event.type === 'dictation.complete') {
      this.finish(run, false,
        event.finalization === 'timeout' || event.unfinalizedTail ? tailWarning : null, true);
    } else if (event.type === 'session.warning') {
      this.publish({ notice: message(event.code) });
    } else if (event.type === 'session.error') {
      this.disconnect(event.code);
    } else if (event.type === 'session.ended') {
      this.disconnect();
    }
  }
  private async ready(run: Run) {
    try {
      await run.capture!.setMuted(false);
      if (!this.current(run)) return;
      run.ready = true;
      this.publish({ phase: 'recording' });
    } catch { if (this.current(run)) this.disconnect('UNSUPPORTED_AUDIO'); }
  }
  async stop() {
    const run = this.run;
    if (!run || this.view.phase !== 'recording') return;
    this.publish({ phase: 'finalizing' });
    await run.capture!.stop(false);
    if (this.current(run) && !run.client!.control({ type: 'dictation.stop' })) this.disconnect();
  }
  cancel() {
    const run = this.run;
    if (!run) return;
    this.finish(run, true, null, true);
  }
  disconnect(code = 'DICTATION_DISCONNECTED') {
    const run = this.run;
    if (run) this.finish(run, false, message(code), false);
  }
  private endSession(run: Run) {
    if (!run.session || run.endRequested) return;
    run.endRequested = true;
    void this.ports.http.end(run.session.sessionId).catch(() => {});
  }
  private finish(run: Run, cancelled: boolean, notice: string | null, restore: boolean) {
    if (this.run !== run) return;
    this.run = null; // Fence callbacks before any external cleanup or draft dispatch.
    run.abort.abort();
    if (cancelled) {
      try { run.client?.control({ type: 'dictation.cancel' }); } catch { /* Cleanup remains mandatory. */ }
    }
    run.client?.dispose();
    void run.capture?.stop(false).catch(() => {});
    this.endSession(run);
    const text = cancelled ? run.draft.snapshot.original : run.draft.text(false);
    const written = this.ports.bindings.writeVoiceDraft(run.token, text);
    this.ports.bindings.releaseVoiceInput(run.token);
    this.publish({ phase: 'draft_ready', notice,
      selection: written && restore ? cancelled ? run.draft.snapshot.selection : run.draft.caret() : null });
  }
}
```

Do not add an auto-reconnect/reauthorize callback: P4 ends dictation on loss. This controller has no submit API and no transcript persistence. The committed draft remains in the existing draft field, not a second editable copy.

- [ ] **2.9 (2 min): Run GREEN, frontend.** `npm test -- src/features/voice/dictation/dictation-controller.test.ts src/features/voice/dictation/dictation-draft.test.ts` → discovered cases pass.

### 2C — Thin hook, configuration and selection application

- [ ] **2.10 (2–5 min): Add this failing selection-helper test to `dictation-controller.test.ts`.** Import `restoreComposerSelection` from `./useDictation.ts` and `vi` from Vitest.

```typescript
it('restores selection direction after React has committed the controlled draft', () => {
  const element = { value: 'Before OLD after', focus: vi.fn(), setSelectionRange: vi.fn() };
  restoreComposerSelection(element as unknown as HTMLTextAreaElement,
    { start: 7, end: 10, direction: 'backward' });
  expect(element.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(element.setSelectionRange).toHaveBeenCalledWith(7, 10, 'backward');
  restoreComposerSelection(null, { start: 7, end: 10, direction: 'none' });
});
```

- [ ] **2.11 (2 min): Run RED.** `npm test -- src/features/voice/dictation/dictation-controller.test.ts -t "restores selection direction"` → missing hook/helper.
- [ ] **2.12 (2–5 min per effect): Add the hook.** Entire `useDictation.ts`:

```typescript
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type RefObject } from 'react';
import { VoiceClient, VoiceHttpClient } from '../../../api/voice-client.ts';
import type { PublicVoiceConfig } from '../../../api/voice-protocol.ts';
import { AudioCaptureService } from '../audio/audio-capture-service.ts';
import { DictationController, type DictationBindings } from './dictation-controller.ts';
import { snapshotDraft, type DraftSelection } from './dictation-draft.ts';

export function restoreComposerSelection(element: HTMLTextAreaElement | null, selection: DraftSelection) {
  if (!element) return;
  element.focus({ preventScroll: true });
  element.setSelectionRange(selection.start, selection.end, selection.direction);
}

export function useDictation(options: { textareaRef: RefObject<HTMLTextAreaElement | null>;
  draft: string; conversationId: string | null; bindings: DictationBindings }) {
  const latestBindings = useRef(options.bindings);
  useLayoutEffect(() => { latestBindings.current = options.bindings; }, [options.bindings]);
  const [http] = useState(() => new VoiceHttpClient());
  const [config, setConfig] = useState<PublicVoiceConfig | null>(null);
  const [controller] = useState(() => new DictationController({ http,
    capture: callbacks => new AudioCaptureService(callbacks),
    client: callbacks => new VoiceClient(callbacks),
    bindings: {
      claimVoiceInput: (mode, onClose) => latestBindings.current.claimVoiceInput(mode, onClose),
      writeVoiceDraft: (token, text) => latestBindings.current.writeVoiceDraft(token, text),
      releaseVoiceInput: token => latestBindings.current.releaseVoiceInput(token),
      isVoiceInputLocked: () => latestBindings.current.isVoiceInputLocked(),
    } }));
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    const abort = new AbortController();
    void http.config(abort.signal).then(value => {
      if (!abort.signal.aborted) setConfig(value);
    }).catch(() => { if (!abort.signal.aborted) setConfig(null); });
    return () => abort.abort();
  }, [http]);
  useLayoutEffect(() => {
    if (view.selection) restoreComposerSelection(options.textareaRef.current, view.selection);
  }, [view.selection, options.textareaRef]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) controller.disconnect(); };
    const pagehide = () => controller.disconnect();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pagehide);
      controller.disconnect();
    };
  }, [controller]);
  const start = () => {
    const element = options.textareaRef.current;
    if (!element || !config?.enabledModes.dictation) return;
    try {
      const snapshot = snapshotDraft(element.value, element.selectionStart, element.selectionEnd,
        element.selectionDirection);
      void controller.start(snapshot, options.conversationId, config);
    } catch { /* Existing 32k character warning remains visible; do not acquire capture. */ }
  };
  const locked = ['requesting_permission', 'connecting', 'recording', 'finalizing'].includes(view.phase);
  const labels = { idle: '', requesting_permission: 'Requesting microphone permission — audio is processed to transcribe your draft',
    connecting: 'Connecting dictation', recording: 'Recording', finalizing: 'Finalizing dictation',
    draft_ready: 'Draft ready' };
  return { config, locked, phase: view.phase, status: labels[view.phase], notice: view.notice,
    start, stop: () => { void controller.stop(); }, cancel: () => controller.cancel() };
}
```

The controller survives ordinary draft renders, but has no permanently disposed flag: StrictMode's setup→cleanup→setup must still allow a later user gesture. `latestBindings` updates after commit, not during render. Only operational changes publish controller views; draft hypotheses update chat state without reannouncing status. `options.draft` supplies the existing controlled-draft context to the caller, but the activation snapshot reads the current DOM value/selection to cover the last input event before React renders.

- [ ] **2.13 (2 min): Run GREEN, frontend.** `npm test -- src/features/voice/dictation`, then `npm run build` and `npm run lint`. Node does not call browser effects during static rendering. If the worklet URL import needs a fixture, mock the existing `audio-capture-processor.ts?worker&url` URL, not the actual capture/controller methods.
- [ ] **2.14 (2 min): Commit, serialized.**

```powershell
git add frontend/src/features/voice/dictation/dictation-draft.ts frontend/src/features/voice/dictation/dictation-draft.test.ts frontend/src/features/voice/dictation/dictation-controller.ts frontend/src/features/voice/dictation/dictation-controller.test.ts frontend/src/features/voice/dictation/testing/dictation-fixture.ts frontend/src/features/voice/dictation/useDictation.ts
git commit -m "feat(voice): compose dictation drafts from immutable selection snapshots"
```

## Task 3: Composer Read-Only & Send Interlock during Dictation

**Files:** Modify `frontend/src/features/chat/state/chat-types.ts`, `chat-reducer.ts`, `use-chat.ts`, `chat-context.tsx`; create `frontend/src/features/chat/state/voice-draft-lock.test.ts`; modify `frontend/src/components/Composer.tsx`, `frontend/src/components/Composer.test.ts`.

### 3A — Atomic token lease and all action paths

- [ ] **3.1 (2–5 min): Write the failing reducer/action tests in `voice-draft-lock.test.ts`.**

```typescript
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ApiClient } from '../../../api/client.ts';
import { chatReducer, initialChatState } from './chat-reducer.ts';
import type { ChatAction, ChatState } from './chat-types.ts';
import { useChatActions } from './use-chat.ts';
import { ChatProvider, useChat } from './chat-context.tsx';

it('rejects ordinary edits and stale transcript writes while preserving user chat behavior', () => {
  const initial = { ...initialChatState, draftInput: 'old', activeSessionId: 'chat-1' };
  const locked = chatReducer(initial, { type: 'CLAIM_VOICE_INPUT', payload: { token: 'one', mode: 'dictation' } });
  expect(chatReducer(locked, { type: 'SET_DRAFT', payload: 'typed' })).toBe(locked);
  expect(chatReducer(locked, { type: 'VOICE_DRAFT', payload: { token: 'wrong', text: 'bad' } })).toBe(locked);
  expect(chatReducer(locked, { type: 'TURN_SUBMIT_START', payload: { userContent: 'bad', idempotencyKey: 'key-1' } })).toBe(locked);
  const updated = chatReducer(locked, { type: 'VOICE_DRAFT', payload: { token: 'one', text: 'dictated' } });
  const navigated = chatReducer(updated, { type: 'NEW_CHAT' });
  expect(navigated.voiceInput).toBeNull();
  expect(navigated.draftInput).toBe('dictated');
  expect(chatReducer(navigated, { type: 'VOICE_DRAFT', payload: { token: 'one', text: 'late' } })).toBe(navigated);
});

it.each(['dictation', 'live'] as const)('blocks stale submit/retry/setDraft callbacks synchronously for %s', async mode => {
  let state: ChatState = { ...initialChatState, activeSessionId: 'chat-1', draftInput: 'original' };
  const fetcher = vi.fn(async () => new Response('', { status: 500 }));
  const client = new ApiClient({ fetch: fetcher });
  const dispatched: ChatAction[] = [];
  const dispatch = (action: ChatAction) => { dispatched.push(action); state = chatReducer(state, action); };
  let actions!: ReturnType<typeof useChatActions>;
  function Harness() { actions = useChatActions(state, dispatch, client); return null; }
  renderToStaticMarkup(createElement(Harness));
  const staleSubmit = actions.submitMessage;
  const token = actions.claimVoiceInput(mode, () => {});
  expect(token).not.toBeNull();
  expect(actions.claimVoiceInput(mode === 'dictation' ? 'live' : 'dictation', () => {})).toBeNull();
  await staleSubmit('unsent');
  await actions.retryTurn('turn-1');
  actions.setDraft('typed during capture');
  expect(fetcher).not.toHaveBeenCalled();
  expect(state.draftInput).toBe('original');
  expect(dispatched.filter(action => action.type === 'TURN_SUBMIT_START')).toEqual([]);
  expect(actions.writeVoiceDraft(token!, 'finalized')).toBe(true);
  actions.releaseVoiceInput('obsolete');
  expect(actions.isVoiceInputLocked()).toBe(true);
  actions.releaseVoiceInput(token!);
  expect(actions.isVoiceInputLocked()).toBe(false);
  expect(actions.writeVoiceDraft(token!, 'late')).toBe(false);
  expect(state.draftInput).toBe('finalized');
});

it('raw provider navigation dispatch closes capture before navigation, including same-null New Chat', () => {
  const fetcher = vi.fn(async () => new Response('', { status: 500 }));
  let context!: ReturnType<typeof useChat>;
  function Child() { context = useChat(); return null; }
  renderToStaticMarkup(createElement(ChatProvider,
    { client: new ApiClient({ fetch: fetcher }), children: createElement(Child) }));
  const close = vi.fn();
  context.actions.claimVoiceInput('dictation', close);
  context.dispatch({ type: 'NEW_CHAT' });
  expect(close).toHaveBeenCalledTimes(1);
  expect(context.actions.isVoiceInputLocked()).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});
```

- [ ] **3.2 (2 min): Run RED.** `npm test -- src/features/chat/state/voice-draft-lock.test.ts` → missing lease actions/types and assertions failing; do not accept TypeScript-only edits as completion.
- [ ] **3.3 (2–5 min): Extend types and reducer with narrow patches, preserving pinned/session-action work.** Add to `ChatState` beside `draftInput` and to the `ChatAction` union:

```typescript
voiceInput: { token: string; mode: 'dictation' | 'live' } | null;
```

```typescript
| { type: 'CLAIM_VOICE_INPUT'; payload: { token: string; mode: 'dictation' | 'live' } }
| { type: 'VOICE_DRAFT'; payload: { token: string; text: string } }
| { type: 'RELEASE_VOICE_INPUT'; payload: string }
```

Add `voiceInput: null` to `initialChatState` and the existing `NEW_CHAT` and `SELECT_SESSION` result objects. Replace the `SET_DRAFT` case and insert these cases:

```typescript
case 'SET_DRAFT':
  return state.voiceInput ? state : { ...state, draftInput: action.payload };
case 'CLAIM_VOICE_INPUT':
  return state.voiceInput || state.isStreaming || state.isSubmitting ? state
    : { ...state, voiceInput: action.payload };
case 'VOICE_DRAFT':
  return state.voiceInput?.token === action.payload.token
    ? { ...state, draftInput: action.payload.text } : state;
case 'RELEASE_VOICE_INPUT':
  return state.voiceInput?.token === action.payload
    ? { ...state, voiceInput: null } : state;
```

At the very beginning of existing `case 'TURN_SUBMIT_START': {`, insert `if (state.voiceInput) return state;`. Keep the user's session sorting/deletion/rename/pin cases unchanged. Existing `SESSION_DELETED` already delegates active deletion to `NEW_CHAT`, so it inherits the token fence.

- [ ] **3.4 (2–5 min per callback): Add the synchronous lease to `use-chat.ts`.** Extend its React import with `type RefObject`, export this type, and add optional fourth parameter `providedVoiceLease?: RefObject<ComposerVoiceLease | null>` to `useChatActions`:

```typescript
export type ComposerVoiceLease = { token: string; mode: 'dictation' | 'live'; onClose: () => void };
```

Immediately after `activeAbortControllerRef`, add the following. Include these four callbacks in the returned object and its `useMemo` dependency list.

```typescript
const localVoiceLease = useRef<ComposerVoiceLease | null>(null);
const voiceLease = providedVoiceLease ?? localVoiceLease;
const isVoiceInputLocked = useCallback(() => voiceLease.current !== null, [voiceLease]);
const claimVoiceInput = useCallback((mode: 'dictation' | 'live', onClose: () => void) => {
  if (voiceLease.current || activeAbortControllerRef.current || state.voiceInput || state.isStreaming || state.isSubmitting ||
    state.turnStatus === 'generating' || state.messagesLoading) return null;
  const token = crypto.randomUUID();
  voiceLease.current = { token, mode, onClose };
  dispatch({ type: 'CLAIM_VOICE_INPUT', payload: { token, mode } });
  return token;
}, [dispatch, voiceLease, state.voiceInput, state.isStreaming, state.isSubmitting,
  state.turnStatus, state.messagesLoading]);
const writeVoiceDraft = useCallback((token: string, text: string) => {
  if (voiceLease.current?.token !== token) return false;
  dispatch({ type: 'VOICE_DRAFT', payload: { token, text } });
  return true;
}, [dispatch, voiceLease]);
const releaseVoiceInput = useCallback((token: string) => {
  if (voiceLease.current?.token !== token) return;
  voiceLease.current = null;
  dispatch({ type: 'RELEASE_VOICE_INPUT', payload: token });
}, [dispatch, voiceLease]);
```

Replace only the early submit guard, adding the original raw input length bound as well as the lease:

```typescript
const raw = contentToSend ?? state.draftInput;
const text = raw.trim();
if (!text || raw.length > 32_000 || voiceLease.current || state.voiceInput ||
  state.isStreaming || state.isSubmitting || state.turnStatus === 'generating') return;
```

For retry, replace its existing initial guard with:

```typescript
if (!state.activeSessionId || voiceLease.current || state.voiceInput ||
  state.isStreaming || state.isSubmitting) return;
```

For `setDraft`, replace its body and dependency array with:

```typescript
const setDraft = useCallback((value: string) => {
  if (!voiceLease.current && !state.voiceInput) dispatch({ type: 'SET_DRAFT', payload: value });
}, [dispatch, voiceLease, state.voiceInput]);
```

Add `voiceLease` and `state.voiceInput` to the submit/retry dependency arrays. Keep `state.voiceInput` **and** the ref check: the ref rejects same-tick pre-render calls; the captured render state keeps callbacks locked until React commits the finalized draft. Existing retries/cancellation/SSE/idempotency behavior is untouched.

- [ ] **3.5 (2–5 min): Patch `chat-context.tsx` to share the ref and synchronously invalidate on navigation.** Add React imports `useCallback` and `useRef`; import `type ComposerVoiceLease` from `./use-chat.ts`. Add `startVoiceConversation?: () => void` to `ChatContextValue` and to `ChatProvider`'s props/destructuring. Replace only the state/actions declarations:

```typescript
const [state, reduce] = useReducer(chatReducer, initialChatState);
const voiceLease = useRef<ComposerVoiceLease | null>(null);
const dispatch = useCallback((action: ChatAction) => {
  const navigates = action.type === 'NEW_CHAT' || action.type === 'SELECT_SESSION' ||
    (action.type === 'SESSION_DELETED' && action.payload === state.activeSessionId);
  if (navigates && voiceLease.current) {
    const lease = voiceLease.current;
    lease.onClose(); // Controller writes committed text and releases its token first.
    if (voiceLease.current === lease) {
      voiceLease.current = null;
      reduce({ type: 'RELEASE_VOICE_INPUT', payload: lease.token });
    }
  }
  reduce(action);
}, [state.activeSessionId]);
const actions = useChatActions(state, dispatch, client, voiceLease);
```

Include `startVoiceConversation` in the existing context value and its memo dependencies:

```typescript
const value = useMemo(
  () => ({ state, dispatch, actions, client, startVoiceConversation }),
  [state, dispatch, actions, client, startVoiceConversation],
);
```

A reducer fence is necessary even with this cleanup: an old callback must not write into a selected/new conversation. Do not remove the existing session bootstrap effect. Do not mount a live provider here.

- [ ] **3.6 (2 min): Run GREEN.** `npm test -- src/features/chat/state/voice-draft-lock.test.ts src/features/chat/state/chat-reducer.test.ts`, then `npm run build` and `npm run lint`.

### 3B — Composer integration and both render placements

- [ ] **3.7 (2–5 min): Extend `Composer.test.ts` without removing its current text-finalization cases.** Add a `vi.hoisted` dictation stub and a hook mock:

```typescript
const dictation = vi.hoisted(() => ({ current: {
  config: null, locked: false, phase: 'idle', status: '', notice: null,
  start: vi.fn(), stop: vi.fn(), cancel: vi.fn(),
} as { config: import('../api/voice-protocol.ts').PublicVoiceConfig | null;
  locked: boolean; phase: string; status: string; notice: string | null;
  start: () => void; stop: () => void; cancel: () => void } }));
vi.mock('../features/voice/dictation/useDictation.ts', () => ({ useDictation: () => dictation.current }));
```

Add these tests inside the existing describe. Reset the stub to idle in `beforeEach` (import it), so subsequent text-regression cases are unaffected.

```typescript
beforeEach(() => {
  dictation.current.locked = false;
  dictation.current.phase = 'idle';
  dictation.current.status = '';
  dictation.current.config = null;
  dictation.current.notice = null;
});

it.each(['centered', 'docked'] as const)('keeps %s composer visible/read-only and Send disabled through dictation', variant => {
  for (const phase of ['requesting_permission', 'connecting', 'recording', 'finalizing']) {
    context.state = { ...initialChatState, draftInput: 'Review me',
      voiceInput: { token: 'lease-1', mode: 'dictation' } };
    dictation.current.locked = true;
    dictation.current.phase = phase;
    dictation.current.status = phase;
    const html = renderToStaticMarkup(createElement(Composer, { variant }));
    expect(html).toContain(`aurvin-composer-${variant}`);
    expect(html).toMatch(/<textarea[^>]*readOnly=""/);
    expect(html).not.toMatch(/<textarea[^>]*disabled=""/);
    expect(html).toContain('Review me');
    expect(html).toMatch(/<button[^>]*class="aurvin-send-btn"[^>]*disabled=""/);
    expect(html).toContain('aria-label="Cancel dictation"');
  }
});
```

- [ ] **3.8 (2 min): Run RED.** `npm test -- src/components/Composer.test.ts -t "composer visible"` → missing read-only/control integration.
- [ ] **3.9 (2–5 min per edit): Patch `Composer.tsx`.** Add imports:

```tsx
import { ComposerVoiceControls } from '../features/voice/components/ComposerVoiceControls.tsx';
import { useDictation } from '../features/voice/dictation/useDictation.ts';
```

Keep the default placement on the property, but remove the optional/defaulted outer argument so React's `createElement` can infer its props reliably. Replace only the declaration line:

```tsx
export function Composer({ variant = 'docked' }: { variant?: 'docked' | 'centered' }) {
```

JSX callers already supply a props object; direct Node handler tests below call `Composer({})`.

Destructure `startVoiceConversation` from `useChat()` alongside current values. Immediately after `textareaRef`, add:

```tsx
const dictation = useDictation({ textareaRef, draft: state.draftInput,
  conversationId: state.activeSessionId, bindings: actions });
const voiceLocked = dictation.locked || state.voiceInput !== null;
```

Move the existing `isOverBudget`/`isSubmitDisabled` definitions above `handleKeyDown`. Extend `isSubmitDisabled` with `voiceLocked`; keep all existing conditions. Replace the handler and use one guarded action for the Send click:

```tsx
const submit = () => {
  if (!isSubmitDisabled && !actions.isVoiceInputLocked()) void actions.submitMessage();
};
const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === 'Escape' && dictation.locked) {
    e.preventDefault();
    dictation.cancel();
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
    e.preventDefault();
    submit();
  }
};
```

Add `readOnly={voiceLocked}` to textarea. Preserve `disabled={state.isStreaming}` for existing text generation. Replace `onChange` with:

```tsx
onChange={(e) => {
  if (!voiceLocked && !actions.isVoiceInputLocked()) {
    dispatch({ type: 'SET_DRAFT', payload: e.target.value });
  }
}}
```

Place these controls inside `aurvin-composer-box`, immediately after textarea and before the existing Send/Cancel response branch. Do not change that branch except `onClick={submit}` for Send:

```tsx
<ComposerVoiceControls config={dictation.config} locked={dictation.locked}
  recording={dictation.phase === 'recording'} finalizing={dictation.phase === 'finalizing'}
  textBusy={state.isSubmitting || state.isStreaming || state.messagesLoading || isOverBudget}
  otherMode={state.voiceInput?.mode === 'live'} status={dictation.status} notice={dictation.notice}
  onDictate={dictation.start}
  onLive={startVoiceConversation ? () => {
    if (!actions.isVoiceInputLocked() && !isOverBudget && !state.isSubmitting && !state.isStreaming &&
      !state.messagesLoading) startVoiceConversation();
  } : undefined}
  onStop={dictation.stop} onCancel={dictation.cancel} />
```

Native buttons retain Tab/Enter/Space behavior; do not prevent pointer-down on entries, which would harm focus. The textarea's saved DOM selection survives focus moving to the microphone. Escape is an optional shortcut for the explicit Cancel button, not an auto-stop/submit gesture.

- [ ] **3.10 (2 min): Run GREEN, frontend.** `npm test -- src/components/Composer.test.ts src/features/chat/state src/features/voice/dictation`, then `npm run build` and `npm run lint`. Existing text acceptance/generating/finalizing and terminal cases must still pass.
- [ ] **3.11 (2 min): Commit exact files, serialized.**

```powershell
git add frontend/src/components/Composer.tsx frontend/src/components/Composer.test.ts frontend/src/features/chat/state/chat-types.ts frontend/src/features/chat/state/chat-reducer.ts frontend/src/features/chat/state/use-chat.ts frontend/src/features/chat/state/chat-context.tsx frontend/src/features/chat/state/voice-draft-lock.test.ts
git commit -m "feat(voice): interlock dictation drafts and every composer submit path"
```

## Task 4: Stop, Cancel, and Disconnect Handling

**Files:** Modify `frontend/src/features/voice/dictation/dictation-controller.ts`, `dictation-controller.test.ts`, `useDictation.ts`; preserve fixture ownership. This task completes D4/D8: capture drain, two-second bound, final-only recovery, explicit retry, permission cancellation and resource cleanup.

- [ ] **4.1 (2–5 min): Add the exact failing Stop/deadline tests.** Extend the test imports with `afterEach` and `vi`; import `settle` already defined in Task 2. Add `afterEach(() => vi.useRealTimers())`.

```typescript
it('Stop drains the terminal input before its control and stays locked for tail finals', async () => {
  const f = dictationFixture(); await f.begin();
  const order: string[] = [];
  f.client.sendInput.mockImplementation(() => { order.push('tail'); return true; });
  f.client.control.mockImplementation(() => { order.push('stop'); return true; });
  f.capture.stop.mockImplementationOnce(async drain => {
    if (drain) f.frame(new Uint8Array(640), 1);
  });
  await f.controller.stop();
  expect(f.capture.stop).toHaveBeenCalledWith(true);
  expect(order).toEqual(['tail', 'stop']);
  expect(f.controller.getSnapshot().phase).toBe('finalizing');
  expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled();
  f.event({ type: 'dictation.final', segmentId: 'tail', text: 'Not Friday.' });
  f.event({ type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false });
  expect(f.text()).toBe('Before Not Friday. after');
  expect(f.controller.getSnapshot().phase).toBe('draft_ready');
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1);
  expect(f.client.dispose).toHaveBeenCalledTimes(1);
});

it('Stop has a two-second total watchdog and never commits an uncertain interim tail', async () => {
  vi.useFakeTimers(); const f = dictationFixture(); await f.begin();
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'Keep this.' });
  f.event({ type: 'dictation.partial', segmentId: 'two', text: 'uncertain tail' });
  await f.controller.stop();
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.controller.getSnapshot().phase).toBe('finalizing');
  await vi.advanceTimersByTimeAsync(1);
  expect(f.text()).toBe('Before Keep this. after');
  expect(f.controller.getSnapshot().notice).toContain('Some speech may be missing');
  expect(f.controller.getSnapshot().phase).toBe('draft_ready');
  f.event({ type: 'dictation.final', segmentId: 'late', text: 'must not appear' });
  expect(f.text()).toBe('Before Keep this. after');
  expect(vi.getTimerCount()).toBe(0);
});

it('Cancel wins while the drain is pending and drops completion from the cancelled run', async () => {
  vi.useFakeTimers(); const f = dictationFixture(); await f.begin();
  let drained!: () => void;
  f.capture.stop.mockImplementationOnce(() => new Promise<void>(resolve => { drained = resolve; }));
  const stopping = f.controller.stop();
  f.controller.cancel();
  expect(f.text()).toBe('Before OLD after');
  f.event({ type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false });
  drained(); await stopping;
  expect(f.client.control).toHaveBeenCalledWith({ type: 'dictation.cancel' });
  expect(f.client.control).not.toHaveBeenCalledWith({ type: 'dictation.stop' });
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('disconnect keeps finals, discards interim and requires a fresh explicit gesture', async () => {
  const f = dictationFixture(); await f.begin();
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'Committed.' });
  f.event({ type: 'dictation.partial', segmentId: 'two', text: 'not committed' });
  f.callbacks().lost?.();
  expect(f.text()).toBe('Before Committed. after');
  expect(f.capture.stop).toHaveBeenCalledWith(false);
  expect(f.controller.getSnapshot().selection).toBeNull();
  expect(f.controller.getSnapshot().notice).toContain('record again');
  expect(f.http.create).toHaveBeenCalledTimes(1);
  await f.controller.start(snapshotDraft(f.text(), 17, 17), null, f.config);
  expect(f.http.create).toHaveBeenCalledTimes(2);
  const keys = f.http.create.mock.calls.map(([request]) => request.idempotencyKey);
  expect(keys[0]).not.toBe(keys[1]);
  f.controller.cancel();
});

it('permission denial returns an unchanged editable draft and allocates no voice session', async () => {
  const f = dictationFixture();
  f.capture.start.mockRejectedValueOnce(new Error('MICROPHONE_DENIED'));
  await f.controller.start(snapshotDraft('Before OLD after', 7, 10), null, f.config);
  expect(f.text()).toBe('Before OLD after');
  expect(f.http.create).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().notice).toContain('Microphone access was denied');
  expect(f.controller.getSnapshot().phase).toBe('draft_ready');
});

it('stops at the negotiated duration and empty completion does not delete selected text', async () => {
  vi.useFakeTimers(); const f = dictationFixture();
  f.response.limits.dictationMaxMs = 3000;
  await f.begin();
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.client.control).toHaveBeenCalledWith({ type: 'dictation.stop' });
  f.event({ type: 'dictation.complete', finalization: 'empty', unfinalizedTail: false });
  expect(f.text()).toBe('Before OLD after');
  expect(f.controller.getSnapshot().notice).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
```

The fixture spies already carry actual P4 arguments. Keep those signatures when extending mocks; do not cast away incompatible method shapes.

- [ ] **4.2 (2 min): Run RED.** `npm test -- src/features/voice/dictation/dictation-controller.test.ts -t "Stop|duration"` → missing true drain/watchdog/duration behavior. Already-passing Cancel/disconnect cases remain meaningful regressions; do not weaken them to manufacture failure.
- [ ] **4.3 (2–5 min): Add per-run timers to the existing `Run` type.**

```typescript
finalizationTimer?: ReturnType<typeof setTimeout>;
durationTimer?: ReturnType<typeof setTimeout>;
```

In `ready`, after `run.ready = true`, add:

```typescript
run.durationTimer = setTimeout(() => {
  if (this.current(run)) void this.stop();
}, run.session!.limits.dictationMaxMs);
```

In `finish`, immediately after `this.run = null`, add:

```typescript
clearTimeout(run.finalizationTimer);
clearTimeout(run.durationTimer);
```

- [ ] **4.4 (2–5 min): Replace `stop` with the bounded graceful operation.**

```typescript
async stop() {
  const run = this.run;
  if (!run || this.view.phase !== 'recording') return;
  clearTimeout(run.durationTimer);
  this.publish({ phase: 'finalizing' });
  run.finalizationTimer = setTimeout(() => {
    if (this.current(run)) this.finish(run, false, tailWarning, true);
  }, Math.min(2_000, run.session!.limits.finalizationMs));
  try {
    await run.capture!.stop(true);
    if (!this.current(run)) return;
    if (!run.client!.control({ type: 'dictation.stop' })) this.disconnect();
  } catch { if (this.current(run)) this.disconnect('DICTATION_FINALIZATION_TIMEOUT'); }
}
```

Keep `run.ready` true during the drain so its ordered tail frame is sent. Do not `setMuted(true)` before `stop(true)`, because P4 mute resets/discards the residual samples. Do not close/dispose the socket until completion/watchdog/cancel; a sent stop control is not provider completion. Cancel invalidates the run before cleanup, so a pending Stop continuation cannot send a control for a new/cancelled recording.

- [ ] **4.5 (2–5 min): Add late-acquisition and error/budget regressions.** Append to `dictation-controller.test.ts`:

```typescript
it('a cancelled permission acquisition cannot create a session when it resolves late', async () => {
  const f = dictationFixture(); let grant!: () => void;
  f.capture.start.mockImplementationOnce(() => new Promise<void>(resolve => { grant = resolve; }));
  const starting = f.controller.start(snapshotDraft('Before OLD after', 7, 10), null, f.config);
  expect(f.controller.getSnapshot().phase).toBe('requesting_permission');
  f.controller.cancel(); grant(); await starting;
  expect(f.http.create).not.toHaveBeenCalled();
  expect(f.capture.stop).toHaveBeenCalledWith(false);
  expect(f.text()).toBe('Before OLD after');
});

it('an HTTP response arriving after Cancel is ended but never connected', async () => {
  const f = dictationFixture();
  let respond!: (value: typeof f.response) => void;
  f.http.create.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
  const starting = f.controller.start(snapshotDraft('Before OLD after', 7, 10), null, f.config);
  await settle(); f.controller.cancel(); respond(f.response); await starting;
  expect(f.client.connect).not.toHaveBeenCalled();
  expect(f.http.end).toHaveBeenCalledWith(f.response.sessionId);
});

it('server timeout feedback removes interim but preserves every committed word', async () => {
  const f = dictationFixture(); await f.begin();
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'Not 13. ID A-7.' });
  f.event({ type: 'dictation.partial', segmentId: 'two', text: 'wrong tail' });
  await f.controller.stop();
  f.event({ type: 'dictation.complete', finalization: 'timeout', unfinalizedTail: true });
  expect(f.text()).toBe('Before Not 13. ID A-7. after');
  expect(f.controller.getSnapshot().notice).toContain('Review your draft');
});

it('overflow releases capture and keeps the previous final, with an explicit limit notice', async () => {
  const f = dictationFixture('x'.repeat(31_996), 31_996, 31_996); await f.begin();
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'OK' });
  f.event({ type: 'dictation.partial', segmentId: 'two', text: 'too long' });
  expect(f.text()).toBe('x'.repeat(31_996) + 'OK');
  expect(f.controller.getSnapshot().notice).toContain('message limit');
  expect(f.client.dispose).toHaveBeenCalledTimes(1);
  expect(f.capture.stop).toHaveBeenCalledWith(false);
});
```

- [ ] **4.6 (2 min): Run the new regressions before changing source.** `npm test -- src/features/voice/dictation/dictation-controller.test.ts`. Existing fencing should already satisfy late events/acquisitions. If a check fails, trace the common `finish`/`current`/`endSession` path rather than adding per-caller patches. P4 owns actually stopping a late granted MediaStream; its existing tests must remain green.
- [ ] **4.7 (2–5 min): Make background cleanup explicitly operational.** Extend `message` with the `DICTATION_FOREGROUND_REQUIRED` case:

```typescript
if (code === 'DICTATION_FOREGROUND_REQUIRED') {
  return 'Dictation paused because this page left the foreground. Saved speech is kept; select Dictate message to record again.';
}
```

Change only the hook's hidden/pagehide callbacks to:

```typescript
const hidden = () => { if (document.hidden) controller.disconnect('DICTATION_FOREGROUND_REQUIRED'); };
const pagehide = () => controller.disconnect('DICTATION_FOREGROUND_REQUIRED');
```

On return to visibility, do nothing. Do not replay buffers or call `start()` automatically. Route unmount and the provider navigation seam still invoke immediate cleanup without stealing focus in a new view. Start/retry takes a **fresh** current textarea snapshot and UUID; it never resumes the old recording.

- [ ] **4.8 (2 min): Run GREEN and upstream regressions, frontend.** `npm test -- src/features/voice/dictation src/features/voice/audio/audio-capture-service.test.ts src/features/voice/transport/voice-client.test.ts src/features/chat/state/voice-draft-lock.test.ts src/components/Composer.test.ts`, then `npm run build` and `npm run lint`. Expected: actual discovery and passing cases; every terminal test clears timers and closes the client. No provider/network/device claims.
- [ ] **4.9 (2 min): Commit, serialized.**

```powershell
git add frontend/src/features/voice/dictation/dictation-controller.ts frontend/src/features/voice/dictation/dictation-controller.test.ts frontend/src/features/voice/dictation/testing/dictation-fixture.ts frontend/src/features/voice/dictation/useDictation.ts
git commit -m "feat(voice): drain dictation stop and fence cancel timeout and disconnect"
```

## Task 5: Dictation UX Component & Integration Tests

**Files:** Create `frontend/src/features/voice/dictation/composer-events.test.ts` and `dictation-composition.test.ts`; modify `dictation-controller.ts` and `useDictation.ts` for one-time post-commit selection application; retain existing controls/controller/draft/chat tests. These are P7's Node component-handler and subsystem-composition tests, not P11's full application/hardware suites. No dependency or DOM-environment change.

### 5A — Actual composer handlers, selection, keyboard and reduced-motion contract

- [ ] **5.1 (2–5 min): Add `composer-events.test.ts`.** This invokes the actual Composer's props with narrowly mocked hooks. It does not duplicate its keyboard logic in a test-only function.

```typescript
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { Children, isValidElement, type KeyboardEvent, type ReactElement } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Composer } from '../../../components/Composer.tsx';
import { initialChatState } from '../../chat/state/chat-reducer.ts';
import type { ChatState } from '../../chat/state/chat-types.ts';
import { restoreComposerSelection } from './useDictation.ts';

const mock = vi.hoisted(() => ({
  state: {} as ChatState, synchronousLock: false,
  submit: vi.fn(), dispatch: vi.fn(), start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), live: vi.fn(),
  dictation: { config: null, locked: false, phase: 'idle', status: '', notice: null },
}));
vi.mock('../../chat/state/chat-context.tsx', () => ({ useChat: () => ({ state: mock.state,
  dispatch: mock.dispatch, startVoiceConversation: mock.live,
  actions: { submitMessage: mock.submit, isVoiceInputLocked: () => mock.synchronousLock } }) }));
vi.mock('./useDictation.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./useDictation.ts')>();
  return { ...actual, useDictation: () => ({ ...mock.dictation,
    start: mock.start, stop: mock.stop, cancel: mock.cancel }) };
});
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useRef: () => ({ current: null }), useEffect: () => {} };
});

type Props = { children?: import('react').ReactNode; 'aria-label'?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onClick?: () => void; onChange?: (event: { target: { value: string } }) => void };
function elements(element: ReactElement): ReactElement<Props>[] {
  const own = element as ReactElement<Props>;
  return [own, ...Children.toArray(own.props.children).flatMap(child =>
    isValidElement(child) ? elements(child) : [])];
}
function enter(key = 'Enter', shiftKey = false, isComposing = false) {
  const preventDefault = vi.fn();
  const event = { key, shiftKey, nativeEvent: { isComposing }, preventDefault };
  return { event: event as unknown as KeyboardEvent<HTMLTextAreaElement>, preventDefault };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.state = { ...initialChatState, draftInput: 'Ready to send' };
  mock.synchronousLock = false;
  mock.dictation.locked = false;
  mock.dictation.phase = 'idle';
});

it.each(['centered', 'docked'] as const)('blocks Enter, click and synthetic edits in %s, including the pre-render lock race', variant => {
  const nodes = elements(Composer({ variant }));
  const input = nodes.find(node => node.props['aria-label'] === 'Message input')!;
  const send = nodes.find(node => node.props['aria-label'] === 'Send message')!;
  mock.synchronousLock = true; // Existing callbacks were created before the recording claim.
  const event = enter(); input.props.onKeyDown!(event.event);
  send.props.onClick!();
  input.props.onChange!({ target: { value: 'must not overwrite' } });
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(mock.submit).not.toHaveBeenCalled();
  expect(mock.dispatch).not.toHaveBeenCalled();
});

it('preserves Shift+Enter and IME composition; explicit Enter sends only after unlock', () => {
  const input = elements(Composer({})).find(node => node.props['aria-label'] === 'Message input')!;
  const shift = enter('Enter', true), ime = enter('Enter', false, true);
  input.props.onKeyDown!(shift.event); input.props.onKeyDown!(ime.event);
  expect(shift.preventDefault).not.toHaveBeenCalled();
  expect(ime.preventDefault).not.toHaveBeenCalled();
  expect(mock.submit).not.toHaveBeenCalled();
  input.props.onKeyDown!(enter().event);
  expect(mock.submit).toHaveBeenCalledTimes(1);
});

it('Escape cancels rather than sends while recording', () => {
  mock.dictation.locked = true; mock.dictation.phase = 'recording';
  const input = elements(Composer({})).find(node => node.props['aria-label'] === 'Message input')!;
  input.props.onKeyDown!(enter('Escape').event);
  expect(mock.cancel).toHaveBeenCalledTimes(1);
  expect(mock.submit).not.toHaveBeenCalled();
});

it('leaves native keyboard traversal intact and supplies visible focus and reduced-motion styling', () => {
  const css = readFileSync('src/features/voice/dictation/composer-voice-controls.css', 'utf8');
  expect(css).toContain(':focus-visible');
  expect(css).toContain('prefers-reduced-motion: reduce');
  expect(css).toContain('animation: none');
  expect(css).not.toContain('@keyframes');
});

it('waits for the finalized DOM value and applies selection only once, never on subsequent edits', () => {
  const element = { value: 'old DOM value', focus: vi.fn(), setSelectionRange: vi.fn() };
  const selection = { start: 7, end: 10, direction: 'backward' as const };
  const applied = { current: null as typeof selection | null };
  const textarea = element as unknown as HTMLTextAreaElement;
  restoreComposerSelection(textarea, selection, 'Before OLD after', applied);
  expect(element.focus).not.toHaveBeenCalled();
  element.value = 'Before OLD after';
  restoreComposerSelection(textarea, selection, 'Before OLD after', applied);
  expect(element.setSelectionRange).toHaveBeenCalledExactlyOnceWith(7, 10, 'backward');
  element.value = 'Before edited after';
  restoreComposerSelection(textarea, selection, element.value, applied);
  expect(element.focus).toHaveBeenCalledTimes(1);
});
```

- [ ] **5.2 (2 min): Run RED.** `npm test -- src/features/voice/dictation/composer-events.test.ts`. Expected: the new selection timing/one-time test fails because the current helper immediately applies selection. The handler regressions should already pass after Task 3. No assertion that SSR exercised actual Tab traversal.
- [ ] **5.3 (2–5 min): Guard post-commit selection once, without resetting the caret on manual edits.** Extend `DictationView` with `selectionDraft: string | null`, initialize it to `null`, and include `selectionDraft: null` in the start publication. In `finish` publication, add:

```typescript
selectionDraft: written && restore ? text : null,
```

Replace the helper in `useDictation.ts` with this complete implementation. Optional arguments keep Task 2's direct helper test valid; the actual hook supplies both guards.

```typescript
export function restoreComposerSelection(element: HTMLTextAreaElement | null, selection: DraftSelection,
  expectedDraft = element?.value, applied?: { current: DraftSelection | null }) {
  if (!element || element.value !== expectedDraft || applied?.current === selection) return;
  element.focus({ preventScroll: true });
  element.setSelectionRange(selection.start, selection.end, selection.direction);
  if (applied) applied.current = selection;
}
```

Add `const appliedSelection = useRef<DraftSelection | null>(null)` beside the hook's refs. Replace only its selection layout effect with:

```typescript
useLayoutEffect(() => {
  if (view.selection && view.selectionDraft !== null) {
    restoreComposerSelection(options.textareaRef.current, view.selection,
      view.selectionDraft, appliedSelection);
  }
}, [view.selection, view.selectionDraft, options.draft, options.textareaRef]);
```

This waits for React's controlled DOM value, retries after the matching draft commit, and then never reapplies the completed recording's selection on typing. Disconnect/navigation have no restoration request and do not steal focus.

- [ ] **5.4 (2 min): Run GREEN.** `npm test -- src/features/voice/dictation/composer-events.test.ts src/features/voice/dictation/dictation-controller.test.ts` → the selection and handler regressions pass.
- [ ] **5.5 (2–5 min): Append the static keyboard/status contract to `controls.test.ts`.**

```typescript
it('has no custom tab order or keyboard handler and recording status is not transcript text', () => {
  const html = render({ locked: true, recording: true, status: 'Recording' });
  expect(html).not.toContain('tabindex=');
  expect(html).not.toContain('contenteditable');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('■');
  expect(html).not.toContain('Before OLD after');
});
```

This is a static accessibility contract, not assistive-technology certification. Native button callbacks are exercised through the actual Composer handlers; do not install a DOM library just for this assertion.

### 5B — Real P4 transport + dictation + chat-draft composition

- [ ] **5.6 (2–5 min): Add `dictation-composition.test.ts`.** Reuse P4's existing socket/session/JSON fixtures; do not invent a second protocol or mock the production VoiceClient.

```typescript
import { expect, it, vi } from 'vitest';
import { VoiceClient, type VoiceClientOptions } from '../../../api/voice-client.ts';
import { decodeVoiceAudio } from '../../../api/voice-audio.ts';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO, type PublicVoiceConfig } from '../../../api/voice-protocol.ts';
import { chatReducer, initialChatState } from '../../chat/state/chat-reducer.ts';
import type { ChatState } from '../../chat/state/chat-types.ts';
import { FakeSocket, session, ready, control } from '../transport/testing/voice-fakes.ts';
import { DictationController, type DictationPorts } from './dictation-controller.ts';
import { snapshotDraft } from './dictation-draft.ts';
import { settle } from './testing/dictation-fixture.ts';

it('never submits during pauses and sends exactly the finalized selected-span draft after explicit review', async () => {
  let state: ChatState = { ...initialChatState, draftInput: 'Before OLD after' };
  const socket = new FakeSocket();
  let captureCallbacks!: Parameters<DictationPorts['capture']>[0];
  let cleanup: (() => void) | undefined;
  let owner: string | null = null;
  const config: PublicVoiceConfig = { protocolVersion: 1,
    enabledModes: { dictation: true, live: false }, supportedLocales: ['en-US'],
    limits: { ...DEFAULT_VOICE_LIMITS }, inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO };
  const submitTurn = vi.fn();
  const dispatch: (action: import('../../chat/state/chat-types.ts').ChatAction) => void =
    action => { state = chatReducer(state, action); };
  const controller = new DictationController({
    http: { create: async () => session(1, 'dictation'), end: vi.fn(async () => {}) },
    client: (callbacks: VoiceClientOptions) => new VoiceClient({ ...callbacks,
      pageUrl: 'https://aurvin.example/chat', socket: () => socket.asSocket() }),
    capture: callbacks => {
      captureCallbacks = callbacks;
      return { start: async () => {}, setMuted: async () => {}, stop: async drain => {
        if (drain) captureCallbacks.frame(new Uint8Array(640), 1);
      } };
    },
    bindings: {
      claimVoiceInput: (mode, onClose) => {
        if (owner) return null;
        owner = 'lease-1'; cleanup = onClose;
        dispatch({ type: 'CLAIM_VOICE_INPUT', payload: { token: owner, mode } });
        return owner;
      },
      writeVoiceDraft: (token, text) => {
        if (owner !== token) return false;
        dispatch({ type: 'VOICE_DRAFT', payload: { token, text } }); return true;
      },
      releaseVoiceInput: token => {
        if (owner !== token) return;
        owner = null; dispatch({ type: 'RELEASE_VOICE_INPUT', payload: token });
      },
      isVoiceInputLocked: () => owner !== null,
    },
  });
  await controller.start(snapshotDraft(state.draftInput, 7, 10), null, config);
  socket.open(); socket.receive(ready(0, 1, 'dictation')); await settle();
  socket.receive(control({ type: 'dictation.partial', segmentId: 'one', text: 'not' }, 1));
  socket.receive(control({ type: 'dictation.partial', segmentId: 'one', text: 'not Friday' }, 2));
  socket.receive(control({ type: 'dictation.final', segmentId: 'one', text: 'Not Friday.' }, 3));
  expect(state.draftInput).toBe('Before Not Friday. after');
  expect(state.activeSessionId).toBeNull();
  expect(state.messages).toEqual([]);
  expect(controller.getSnapshot().phase).toBe('recording');
  expect(submitTurn).not.toHaveBeenCalled();
  await controller.stop();
  const binary = socket.sent.filter((value): value is Uint8Array => value instanceof Uint8Array);
  expect(decodeVoiceAudio(binary.at(-1)!)).toMatchObject({ kind: 1, flags: 1, sequence: 0 });
  const last = JSON.parse(socket.sent.at(-1) as string);
  expect(last.type).toBe('dictation.stop');
  expect(state.voiceInput).not.toBeNull();
  socket.receive(control({ type: 'dictation.final', segmentId: 'two', text: 'ID A-7.' }, 4));
  socket.receive(control({ type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false }, 5));
  expect(state.voiceInput).toBeNull();
  expect(state.draftInput).toBe('Before Not Friday. ID A-7. after');
  expect(socket.close).toHaveBeenCalledTimes(1);
  expect(submitTurn).not.toHaveBeenCalled();
  // Explicit review/Send is the only point at which a text submission is permitted.
  submitTurn(state.draftInput);
  expect(submitTurn).toHaveBeenCalledExactlyOnceWith('Before Not Friday. ID A-7. after');
  cleanup?.(); // Idempotent after normal completion; no duplicate teardown.
  expect(socket.close).toHaveBeenCalledTimes(1);
});
```

The final `submitTurn` spy documents the draft-only boundary; **actual** action-network guards are exercised by Task 3, and actual Composer keyboard/click callbacks by 5A. Do not report this spy as an assembled backend or provider test.

- [ ] **5.7 (2 min): Run the new composition test before source changes.** `npm test -- src/features/voice/dictation/dictation-composition.test.ts`. Expected GREEN after Task 4; any RED is an integration defect, not permission to alter P1/P4 schemas locally.
- [ ] **5.8 (2–5 min if needed): Correct only the common P7 path exposed by a failure.** The required implementations are the token guard in Task 3 and Stop/finish in Task 4; do not add a second controller, blanket error swallowing around tests, or caller-specific transcript copies. Request an owner follow-up if the defect is in P4/P5.
- [ ] **5.9 (2 min): Run complete frontend verification.** `npm test`, `npm run build`, `npm run lint`. Expected: all discovered existing and new frontend suites pass; build/lint succeed. Record failures/skips separately. Do not run unrelated backend/database/provider checks for this frontend-owned task.
- [ ] **5.10 (2 min): Commit exact files, serialized.** If another regression required source correction, explicitly add only the corrected P7-owned source paths to this commit.

```powershell
git add frontend/src/features/voice/dictation/composer-events.test.ts frontend/src/features/voice/dictation/dictation-composition.test.ts frontend/src/features/voice/dictation/controls.test.ts frontend/src/features/voice/dictation/dictation-controller.ts frontend/src/features/voice/dictation/useDictation.ts
git commit -m "test(voice): verify dictation composer keyboard and transport composition"
```

### Required browser follow-through / no false certification

P11 owns actual browser/device/accessibility evidence after P10 assembles the application. Hand over this exact procedure; keep it **unrun/blocked** until the prerequisites exist. P7's Node checks cannot certify real focus order, selection after DOM updates, media tracks, AudioWorklet behavior, or measured p95 finalization.

1. In an authorized fixture-backed assembled page, test empty New Chat (centered) and an existing text conversation (docked). Config independently enables neither/dictation/live/both; no microphone prompt occurs on load or while disabled. Failure of config leaves text usable.
2. Using only keyboard, Tab from the textarea to Dictate message, activate with Enter or Space, deny permission, and verify draft/editability/focus. Repeat granting permission. Recording uses a square and Recording label, never color alone. Tab reaches Stop and Cancel; Escape cancels. Shift+Enter/IME never submit. Native controls have no positive `tabIndex` or keyboard trap.
3. Start with `Before OLD after`, select `OLD` backward, activate dictation, revise interim hypotheses and finalize `Not Friday. ID A-7.`. Stop immediately then press Enter/click Send during finalization: neither submits. After completion, caret is just after inserted text and explicit Send uses the exact reviewed draft. Cancel instead restores the original text, range, and backward direction.
4. Empty speech restores the selected original text. Drop the connection after a final and an interim: retain only finals, show a retry instruction, release tracks/socket, and do not restart on reconnection. A fresh activation snapshots the current edited draft rather than restoring an older recording's text.
5. Stop with a residual audio frame, fake a missing terminal response, and verify a warning/editable committed draft at the browser's two-second watchdog. Deliver late finals/complete afterward: draft and caret must not change. Cancel during the drain, during a permission prompt, and after session creation; check no orphaned active tracks/sockets. P4 owns physical track checks; P5 owns server release.
6. While recording/finalizing, switch chats, choose New Chat even when already unsaved, delete the selected session, background/pagehide, and unmount the view. No old callback changes the next view's draft; committed draft follows the existing navigation policy. Return to visibility: recording starts only with a new explicit gesture. Deleting an unrelated sidebar session must not end the current capture.
7. At mobile width/200% zoom, controls wrap without clipping textarea/Send. Enable reduced motion: recording remains understandable with no animation. Verify visible focus and operational announcements with assistive technology without reading every interim hypothesis into the status region.

Real microphone/provider checks need explicit authorization, bounded spend/data exposure, and target devices. Latency/fidelity/real keyboard/AT results belong to P11 evidence; they are not passed by static CSS/SSR tests or this plan.

## Acceptance and self-check map

| Requirement | Planned verification |
| --- | --- |
| A1 text chat unchanged | Existing `Composer.test.ts`, reducer/orchestration/client suites; full frontend checks |
| A2 explicit permission/denial | Controller activation/denial/late-permission tests; P4 capture suite; P11 browser procedure 1–2 |
| A3/D1 interim revisions and finals once | Draft/controller tests; real-client composition; ID-not-text deduplication |
| A4/D2 selection/prefix/suffix/Cancel | Draft snapshot tests, backward range helper, controller cancellation and both placements |
| A5 pause does not stop/submit | Controller/composition remain recording after finals, no control or chat submission |
| A6/D3/D4 Stop/Send races | Atomic action-ref guard, reducer fence, real Composer handlers, tail/control ordering and two-second watchdog |
| D5 empty speech/late cancelled events | Draft invariance, empty complete, stale recording callback, Cancel during drain |
| D6 meaning/no rewrite | Exact names/IDs/dates/negations/repetitions/whitespace tests; no rewriting provider |
| D7 keyterms/punctuation settings | P3-owned configuration/provider behavior; P7 accepts formatted text without client overrides |
| D8/A14 failures and explicit retry | Disconnect/denial/late HTTP/budget tests; committed-only draft, new snapshot/key, P4 cleanup regressions |
| A17 navigation/foreground | Provider synchronous dispatch cleanup, hook listener cleanup; browser procedure 6 |
| A18 accessibility/reduced motion | Native labels/decorative icons/status/handler/stylesheet contracts; P11 real devices/AT |
| Finite draft/session resources | 32k text, 4096 final IDs, negotiated capture queue/duration, abort/deadline timers; overflow warns rather than truncates |
| Independent mode flags/exclusion | Stateless flag matrix, shared `dictation`/`live` lease, disabled unwired live callback |

### Completion report to the orchestrator

- Report the P7 implementation commit list and exact frontend test/build/lint results, distinguishing passing/discovered/skipped/unrun checks.
- Identify any ownership conflicts or upstream amendments. Do not mark P7 ready while P5 is incomplete or a required frontend check fails.
- Hand P8/P10 the four lease actions and optional `ChatProvider.startVoiceConversation` callback; P8 retains live-panel/ChatView/shared-style ownership.
- Report browser/device/provider measurements as unrun/blocked until actual authorized evidence exists. Review remains **skipped**. The orchestrator owns state/status updates and the final report.

## Documentation-only plan verification

Before committing this plan, check its local document links, the five task headings, file ownership, code-fence balance, declared method/type names, and absence of placeholder instructions/code headers. Run `git diff --check -- docs/voice-modes/plan7.md`; stage only this plan. Application checks above are **future worker commands**, not checks executed by the planner.

Planner evidence: the final snippets were assembled against current frontend source in a virtual TypeScript compiler host: **18 proposed files, zero diagnostics, zero application files written**. This checks example signatures/imports and preserves the existing user patches; it is not execution of the proposed tests, a production build, or browser/provider evidence.
