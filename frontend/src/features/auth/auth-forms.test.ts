/**
 * ============================================================================
 * FILE: auth-forms.test.ts
 * LOCATION: frontend/src/features/auth/auth-forms.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    SSR markup tests for custom authentication screens verifying accessibility,
 *    input labeling, masking, and error/help roles.
 *
 * ROLE IN PROJECT:
 *    Ensures all auth forms follow Aurvin visual standards and WCAG form labeling.
 *
 * KEY COMPONENTS:
 *    - LoginForm markup and password masking
 *    - MandatoryPasswordChangeForm validation rules
 *    - ForgotPasswordForm and ResetPasswordForm controls
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ForgotPasswordForm } from './ForgotPasswordForm.tsx';
import { LoginForm } from './LoginForm.tsx';
import { MandatoryPasswordChangeForm } from './MandatoryPasswordChangeForm.tsx';
import { ResetPasswordForm } from './ResetPasswordForm.tsx';

describe('Custom Auth Forms SSR', () => {
  it('renders LoginForm with email, masked password, submit, and forgot password toggle', () => {
    const html = renderToStaticMarkup(
      createElement(LoginForm, {
        onSubmit: vi.fn(),
        onForgotPassword: vi.fn(),
      }),
    );

    expect(html).toContain('Sign in to Aurvin');
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('Forgot password?');
    expect(html).toContain('Sign in</button>');
  });

  it('renders MandatoryPasswordChangeForm with explanation and password inputs', () => {
    const html = renderToStaticMarkup(
      createElement(MandatoryPasswordChangeForm, {
        onSubmit: vi.fn(),
        onSignOut: vi.fn(),
      }),
    );

    expect(html).toContain('Set a new private password');
    expect(html).toContain('Current temporary password');
    expect(html).toContain('New password');
    expect(html).toContain('Confirm new password');
    expect(html).toContain('Sign out</button>');
  });

  it('renders ForgotPasswordForm with email input and generic mailbox notice', () => {
    const html = renderToStaticMarkup(
      createElement(ForgotPasswordForm, {
        onSubmit: vi.fn(),
        onBackToLogin: vi.fn(),
      }),
    );

    expect(html).toContain('Reset your password');
    expect(html).toContain('Send recovery email</button>');
    expect(html).toContain('Back to sign in</button>');
  });

  it('renders ResetPasswordForm with token requirement and new password inputs', () => {
    const html = renderToStaticMarkup(
      createElement(ResetPasswordForm, {
        token: 'test-token-123',
        onSubmit: vi.fn(),
      }),
    );

    expect(html).toContain('Choose a new password');
    expect(html).toContain('New password');
    expect(html).toContain('Confirm new password');
    expect(html).toContain('Update password</button>');
  });
});
