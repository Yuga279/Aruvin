/**
 * ============================================================================
 * FILE: stream-render-boundary.test.ts
 * LOCATION: frontend/src/components/stream-render-boundary.test.ts
 * ============================================================================
 * PURPOSE: Verify heavy chat views receive only shallow-stable selected inputs.
 * ROLE IN PROJECT: Guard React memo boundaries against stream-only invalidation.
 * KEY COMPONENTS: Real wrapper elements, memo identity, relevant-state forwarding.
 * ============================================================================
 */
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { initialChatState } from '../features/chat/state/chat-reducer.ts';
import type { ChatState } from '../features/chat/state/chat-types.ts';
import { Composer } from './Composer.tsx';
import { Sidebar } from './Sidebar.tsx';

const context = vi.hoisted(() => ({ state: {} as ChatState, actions: {}, dispatch: () => {}, client: {} }));
vi.mock('../features/chat/state/chat-context.tsx', () => ({ useChat: () => context }));
vi.mock('../features/voice/dictation/useDictation.ts', () => ({ useDictation: () => ({ locked: false }) }));

function selectedElement(Component: typeof Composer | typeof Sidebar) {
  let element!: ReactElement<Record<string, unknown>>;
  function Harness() {
    element = Component({});
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return element;
}

it.each([Composer, Sidebar])('isolates heavy view from stream-only context changes', Component => {
  context.state = initialChatState;
  const before = selectedElement(Component);
  context.state = { ...initialChatState, streamText: 'new token' };
  const after = selectedElement(Component);
  expect(before.type).toHaveProperty('$$typeof', Symbol.for('react.memo'));
  expect(after.type).toBe(before.type);
  for (const key of Object.keys(before.props)) {
    expect(after.props[key], key).toBe(before.props[key]);
  }
});
