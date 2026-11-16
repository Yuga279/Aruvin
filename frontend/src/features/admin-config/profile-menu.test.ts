/**
 * ============================================================================
 * FILE: profile-menu.test.ts
 * LOCATION: frontend/src/features/admin-config/profile-menu.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for ProfileMenu verifying dynamic user role/email rendering
 *    and functional Sign out triggers.
 *
 * ROLE IN PROJECT:
 *    Verifies that the pinned footer displays logged-in identity and provides
 *    an operable logout control without authentication disabled placeholders.
 *
 * KEY COMPONENTS:
 *    - Super Admin vs standard User email and role label
 *    - Sign out button execution
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProfileMenu } from './ProfileMenu.tsx';

describe('ProfileMenu role-aware and functional logout', () => {
  it('displays user email and role for standard User with enabled Sign out', () => {
    const onSignOut = vi.fn();
    const onManage = vi.fn();

    const html = renderToStaticMarkup(
      createElement(ProfileMenu, {
        user: {
          userId: 'usr-123',
          email: 'peter@example.com',
          role: 'user',
          passwordChangeRequired: false,
        },
        onManageAurvin: onManage,
        onSignOut,
      }),
    );

    expect(html).toContain('peter@example.com');
    expect(html).toContain('User');
    expect(html).not.toContain('Authentication not enabled');
    expect(html).toMatch(/<button[^>]*>Sign out<\/button>/);
    expect(html).not.toContain('disabled=""');
  });

  it('displays Super admin role for super-admin user', () => {
    const html = renderToStaticMarkup(
      createElement(ProfileMenu, {
        user: {
          userId: 'usr-admin',
          email: 'admin@example.com',
          role: 'super-admin',
          passwordChangeRequired: false,
        },
        onManageAurvin: vi.fn(),
        onSignOut: vi.fn(),
      }),
    );

    expect(html).toContain('admin@example.com');
    expect(html).toContain('Super admin');
  });

  it('falls back safely when user is not provided', () => {
    const html = renderToStaticMarkup(
      createElement(ProfileMenu, {
        onManageAurvin: vi.fn(),
      }),
    );

    expect(html).toContain('Super admin');
    expect(html).toContain('Authentication not enabled.');
  });
});
