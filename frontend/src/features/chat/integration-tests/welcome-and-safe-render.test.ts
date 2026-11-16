/**
 * ============================================================================
 * FILE: welcome-and-safe-render.test.ts
 * LOCATION: frontend/src/features/chat/integration-tests/welcome-and-safe-render.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the welcome empty state and disarmed Markdown rendering.
 *
 * ROLE IN PROJECT:
 *    P10 UI evidence using renderToStaticMarkup without importing the chat
 *    barrel, App.tsx as a module, CSS, jsdom, or Testing Library.
 *
 * KEY COMPONENTS:
 *    - ChatProvider/ChatView: empty greeting and New chat chrome.
 *    - SafeMarkdown: javascript: links are not rendered as hrefs.
 * ============================================================================
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_GREETINGS } from '../../../components/EmptyState.tsx';
import { ApiClient } from '../../../api/client.ts';
import { ChatView } from '../ChatView.tsx';
import { SafeMarkdown } from '../markdown/safe-markdown.tsx';
import { ChatProvider } from '../state/chat-context.tsx';

describe('P10 welcome and safe render', () => {
  it.each(EMPTY_GREETINGS)('renders welcome chrome for "%s" and disarms javascript links', (greeting) => {
    const random = vi.spyOn(Math, 'random').mockReturnValue((EMPTY_GREETINGS.indexOf(greeting) + 0.5) / EMPTY_GREETINGS.length);
    const client = new ApiClient({ fetch: async () => { throw new Error('no server'); } });
    const view = createElement(ChatView) as ReactElement;
    const html = renderToStaticMarkup(createElement(ChatProvider, { client, children: view }));
    random.mockRestore();
    expect(html).toContain(renderToStaticMarkup(createElement('h1', null, greeting)));
    expect(html).toContain('New chat');
    expect(html).not.toContain('aurvin-header-title');
    const unsafe = renderToStaticMarkup(createElement(SafeMarkdown, { content: '[secret](javascript:alert(1))' }));
    expect(unsafe.toLowerCase()).not.toContain('javascript:');
    expect(unsafe).not.toContain('dangerouslySetInnerHTML');
  });

  it('keeps the P9 App client injection seam in source', () => {
    const source = readFileSync('src/App.tsx', 'utf8');
    expect(source).toContain('client?: ApiClient');
  });
});

