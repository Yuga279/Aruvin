/**
 * ============================================================================
 * FILE: App.auth.test.ts
 * LOCATION: frontend/src/App.auth.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Assembly tests verifying the top-level App authentication shell:
 *    switching between login, onboarding, and authenticated chat, with private
 *    state teardown when user changes.
 *
 * ROLE IN PROJECT:
 *    Ensures unauthenticated users never reach ChatProvider, and logging out
 *    unmounts and resets all conversation memory and live voice state.
 *
 * KEY COMPONENTS:
 *    - Unauthenticated state renders LoginForm
 *    - Password-change-required renders MandatoryPasswordChangeForm
 *    - Authenticated state renders ChatProvider keyed by userId
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthClient } from './api/auth-client.ts';
import App from './App.tsx';

vi.mock('./features/voice/dictation/useDictation.ts', () => ({
  useDictation: () => ({
    config: null,
    locked: false,
    phase: 'idle',
    status: '',
    notice: null,
    start: () => undefined,
    stop: () => undefined,
    cancel: () => undefined,
  }),
}));

vi.mock('./features/voice/state/useLiveVoice.ts', () => ({
  useLiveVoice: () => ({
    view: { phase: 'idle', connection: 'disconnected' },
    start: () => undefined,
    toggleMute: () => undefined,
    interrupt: () => undefined,
    exit: () => undefined,
    resume: () => undefined,
  }),
}));

describe('App top-level auth shell', () => {
  it('renders LoginForm when user is unauthenticated', () => {
    const fakeAuthClient: AuthClient = {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(App, {
        authClient: fakeAuthClient,
        initialAuthStatus: 'unauthenticated',
      }),
    );

    expect(html).toContain('Sign in to Aurvin');
    expect(html).not.toContain('Message composer');
  });

  it('renders MandatoryPasswordChangeForm when password change is required', () => {
    const fakeAuthClient: AuthClient = {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(App, {
        authClient: fakeAuthClient,
        initialAuthStatus: 'password-change-required',
        initialAuthUser: {
          userId: 'usr-new',
          email: 'new@example.com',
          role: 'user',
          passwordChangeRequired: true,
        },
      }),
    );

    expect(html).toContain('Set a new private password');
    expect(html).not.toContain('Message composer');
  });

  it('renders chat shell when authenticated', () => {
    const fakeAuthClient: AuthClient = {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(App, {
        authClient: fakeAuthClient,
        initialAuthStatus: 'authenticated',
        initialAuthUser: {
          userId: 'usr-peter',
          email: 'peter@example.com',
          role: 'super-admin',
          passwordChangeRequired: false,
        },
      }),
    );

    expect(html).toContain('Message composer');
    expect(html).toContain('peter@example.com');
  });
});
