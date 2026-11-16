/**
 * ============================================================================
 * FILE: Sidebar.test.ts
 * LOCATION: frontend/src/components/Sidebar.test.ts
 * ============================================================================
 * PURPOSE: Verify accessible session options and pinned navigation markup.
 * ROLE IN PROJECT: Static rendering checks within the existing Node Vitest suite.
 * KEY COMPONENTS: Three-dot disclosure, pin/unpin labels, active-turn delete lock.
 * ============================================================================
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { initialChatState } from '../features/chat/state/chat-reducer.ts';
import type { ChatState } from '../features/chat/state/chat-types.ts';
import { shellNavItems } from '../app/navigation.ts';
import { Sidebar } from './Sidebar.tsx';

const context = vi.hoisted(() => ({ state: {} as ChatState }));
vi.mock('../features/chat/state/chat-context.tsx', () => ({
  useChat: () => ({ state: context.state, actions: {}, dispatch: vi.fn(), client: {} }),
}));

describe('Sidebar session menu', () => {
  it('is exported as a React functional component', () => {
    expect(typeof Sidebar).toBe('function');
  });
  it('shows the decorative Aurvin mark beside the brand name', () => {
    context.state = initialChatState;
    const html = renderToStaticMarkup(createElement(Sidebar));
    expect(html).toMatch(/<svg[^>]*class="aurvin-brand-mark"[^>]*aria-hidden="true"/);
    expect(html).toContain('<span class="aurvin-brand-name">Aurvin</span>');
    expect(html).not.toContain('aurvin-logo.png');
  });
  it('renders only working Workspace destinations and the Search entry', () => {
    context.state = initialChatState;
    const html = renderToStaticMarkup(createElement(Sidebar, {
      onManageAurvin: () => undefined, onOpenIntegrations: () => undefined, onOpenCommandPalette: () => undefined,
    }));
    expect(html).toContain('aria-label="Workspace"');
    expect(html).toContain('<span>Integrations</span>');
    expect(html).toContain('<span>Settings</span>');
    expect(html).toContain('<span>Search</span>');
    for (const hidden of ['Projects', 'Agents', 'Memory', 'Automations', 'Home']) {
      expect(html).not.toContain(`<span>${hidden}</span>`);
    }
  });
  it('omits Settings for members because it would duplicate Integrations', () => {
    expect(shellNavItems({ onManageAurvin: () => undefined, onOpenIntegrations: () => undefined }, 'user')
      .map((item) => item.id)).toEqual(['integrations']);
    expect(shellNavItems({ onManageAurvin: () => undefined, onOpenIntegrations: () => undefined }, 'super-admin')
      .map((item) => item.id)).toEqual(['integrations', 'settings']);
    expect(shellNavItems({}, 'super-admin')).toEqual([]);
  });
  it.each([true, false])('offers rename, delete and pin toggle for pinned=%s', pinned => {
    context.state = { ...initialChatState, sessions: [{ sessionId: 's1', title: 'My chat', pinned,
      createdAt: '2026-10-08T00:00:00Z', lastActivityAt: '2026-10-08T00:00:00Z' }] };
    const html = renderToStaticMarkup(createElement(Sidebar));
    expect(html).toContain('aria-label="Options for My chat"');
    expect(html).toContain('•••');
    expect(html).toMatch(/<button[^>]*><svg[^>]*>[\s\S]*?<\/svg>Rename<\/button>/);
    expect(html).toMatch(/<button[^>]*><svg[^>]*>[\s\S]*?<\/svg>Delete<\/button>/);
    expect(html).toMatch(new RegExp(`<button[^>]*><svg[^>]*>[\\s\\S]*?<\\/svg>${pinned ? 'Unpin' : 'Pin'}<\\/button>`));
    if (pinned) expect(html).toContain('>Pinned</h2>');
  });
  it('disables deletion while the selected session streams', () => {
    context.state = { ...context.state, activeSessionId: 's1', isStreaming: true };
    expect(renderToStaticMarkup(createElement(Sidebar))).toMatch(/<button[^>]*disabled=""[^>]*><svg[^>]*>[\s\S]*?<\/svg>Delete<\/button>/);
  });
});
