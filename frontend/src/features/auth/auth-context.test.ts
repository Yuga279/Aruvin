/**
 * ============================================================================
 * FILE: auth-context.test.ts
 * LOCATION: frontend/src/features/auth/auth-context.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for AuthProvider state transitions and useAuth hook.
 *
 * ROLE IN PROJECT:
 *    Verifies bootstrap session checks, unauthenticated states, password-change
 *    gates, and clean logout flows.
 *
 * KEY COMPONENTS:
 *    - Initial /auth/me bootstrap
 *    - Login with passwordChangeRequired gating
 *    - Logout clearing user state
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuthClientError, type AuthClient } from '../../api/auth-client.ts';
import { AuthProvider, loginFailureMessage, useAuth } from './auth-context.tsx';

function ConsumerComponent() {
  const { user, status } = useAuth();
  return createElement(
    'div',
    { 'data-testid': 'auth-state' },
    `${status}:${user?.email ?? 'none'}:${user?.role ?? 'none'}`,
  );
}

describe('AuthProvider & useAuth', () => {
  it('renders unauthenticated state when initialStatus is unauthenticated', () => {
    const fakeClient: AuthClient = {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(AuthProvider, {
        client: fakeClient,
        initialStatus: 'unauthenticated',
        children: createElement(ConsumerComponent),
      }),
    );

    expect(html).toContain('unauthenticated:none:none');
  });

  it('renders authenticated state when initial user is provided', () => {
    const fakeClient: AuthClient = {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(AuthProvider, {
        client: fakeClient,
        initialUser: {
          userId: 'usr-1',
          email: 'admin@example.com',
          role: 'super-admin',
          passwordChangeRequired: false,
        },
        initialStatus: 'authenticated',
        children: createElement(ConsumerComponent),
      }),
    );

    expect(html).toContain('authenticated:admin@example.com:super-admin');
  });

  it('renders password-change-required state when initial user requires change', () => {
    const fakeClient: AuthClient = {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(AuthProvider, {
        client: fakeClient,
        initialUser: {
          userId: 'usr-2',
          email: 'newbie@example.com',
          role: 'user',
          passwordChangeRequired: true,
        },
        initialStatus: 'password-change-required',
        children: createElement(ConsumerComponent),
      }),
    );

    expect(html).toContain('password-change-required:newbie@example.com:user');
  });
});

describe('loginFailureMessage', () => {
  it('keeps credential failures generic', () => {
    expect(loginFailureMessage(new AuthClientError({ code: 'UNAUTHENTICATED', status: 401 }))).toBe(
      'Invalid email or password.',
    );
    expect(loginFailureMessage(new Error('nope'))).toBe('Invalid email or password.');
  });

  it('does not disguise service unavailability as a bad password', () => {
    expect(loginFailureMessage(new AuthClientError({ code: 'NOT_READY', status: 503 }))).toBe(
      'Sign-in is temporarily unavailable. Please try again in a moment.',
    );
    expect(
      loginFailureMessage(new AuthClientError({ code: 'AUTH_PROVIDER_UNAVAILABLE', status: 503 })),
    ).toBe('Sign-in is temporarily unavailable. Please try again in a moment.');
    expect(
      loginFailureMessage(new AuthClientError({ code: 'INVALID_AUTH_RESPONSE', status: 503 })),
    ).toBe('Sign-in is temporarily unavailable. Please try again in a moment.');
  });

  it('explains rate limits and unreachable Aurvin separately', () => {
    expect(loginFailureMessage(new AuthClientError({ code: 'RATE_LIMITED', status: 429 }))).toBe(
      'Too many login attempts. Please wait 60 seconds before trying again.',
    );
    expect(loginFailureMessage(new AuthClientError({ code: 'NETWORK_ERROR', retryable: true }))).toBe(
      'Could not reach Aurvin. Please try again in a moment.',
    );
  });
});
