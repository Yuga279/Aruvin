/**
 * ============================================================================
 * FILE: navigation.test.ts
 * LOCATION: frontend/src/features/admin-config/navigation.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Static assembly checks for profile entry and persistent chat navigation.
 *
 * ROLE IN PROJECT:
 *    Locks Manage Aurvin, disabled Sign out, and hidden/inert chat wrapping
 *    without claiming browser event or voice-lifecycle proof.
 *
 * KEY COMPONENTS:
 *    - ProfileMenu disclosure copy
 *    - App persistent chat surface
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { initialChatState } from '../chat/state/chat-reducer.ts';
import { Sidebar } from '../../components/Sidebar.tsx';
import { ProfileMenu } from './ProfileMenu.tsx';
import { navigationDecision } from './config-edit-state.ts';

vi.mock('../chat/state/chat-context.tsx', () => ({
  useChat: () => ({ state: initialChatState, actions: {}, dispatch: vi.fn(), client: {} }),
}));

it('keeps unsaved edits when leaving is declined and never leaves during a save', () => {
  const decline = vi.fn(() => false);
  expect(navigationDecision({ dirty: true, pending: false }, decline)).toBe('stay');
  expect(decline).toHaveBeenCalledOnce();
  const accept = vi.fn(() => true);
  expect(navigationDecision({ dirty: true, pending: true }, accept)).toBe('stay');
  expect(accept).not.toHaveBeenCalled();
});

it('offers Manage Aurvin and explains the disabled Sign out', () => {
  const html = renderToStaticMarkup(createElement(ProfileMenu, { onManageAurvin: vi.fn() }));
  expect(html).toContain('Super admin');
  expect(html).toContain('Manage Aurvin');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Sign out<\/button>/);
  expect(html).toContain('Authentication not enabled.');
});

it('pins the profile footer after independently scrolling history', () => {
  const html = renderToStaticMarkup(createElement(Sidebar, { onManageAurvin: () => undefined }));
  expect(html.indexOf('aurvin-profile-footer')).toBeGreaterThan(html.indexOf('aurvin-session-nav'));
  expect(html).toContain('Super admin');
});

it('keeps one ChatProvider and a hidden inert chat surface without a page key', () => {
  const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
  expect(app).toContain('<ChatProvider');
  expect(app.match(/<ChatProvider/g)?.length).toBe(1);
  expect(app).toContain("hidden={page !== 'chat'}");
  expect(app).toContain("inert={page !== 'chat'}");
  expect(app).toContain('className="aurvin-chat-surface"');
  expect(app).not.toMatch(/key=\{page/);
  expect(app).not.toMatch(/NEW_CHAT|SELECT_SESSION|RELEASE_VOICE_INPUT/);
});
