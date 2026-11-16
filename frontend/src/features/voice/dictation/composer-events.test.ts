/**
 * ============================================================================
 * FILE: composer-events.test.ts
 * LOCATION: frontend/src/features/voice/dictation/composer-events.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Component-handler tests for Composer keyboard events, selection timing, and CSS.
 *
 * ROLE IN PROJECT:
 *    Verifies Enter/Shift+Enter/IME/Escape handling, pre-render lock race conditions,
 *    one-time post-commit selection restoration, and reduced-motion stylesheet contracts.
 *
 * KEY COMPONENTS:
 *    - Composer events and selection test suite
 * ============================================================================
 */

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
  // Follow the context wrapper's memoized view; hooks are stubbed above.
  if (typeof element.type === 'object' && 'type' in element.type) {
    return elements((element.type as { type: (props: unknown) => ReactElement }).type(element.props));
  }
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
