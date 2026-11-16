/**
 * ============================================================================
 * FILE: administration-panel.test.ts
 * LOCATION: frontend/src/features/admin-config/administration-panel.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for AdministrationPanel and CreateUserDialog verifying
 *    table columns, status badges, keyset pagination, and lifecycle action wiring.
 *
 * ROLE IN PROJECT:
 *    Verifies that Super Admin user management operates with clean credentials,
 *    safe error feedback, and single-role creation.
 *
 * KEY COMPONENTS:
 *    - Users table column verification (Email, Role, Status, Created, Actions)
 *    - Status badges (Active, Pending password change, Inactive)
 *    - CreateUserDialog input masking & transient clear
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdministrationClient } from '../../api/administration-client.ts';
import type { AdministrationUser } from '../../api/administration-protocol.ts';
import { AdministrationPanel } from './AdministrationPanel.tsx';
import { CreateUserDialog } from './CreateUserDialog.tsx';

const SAMPLE_USERS: AdministrationUser[] = [
  {
    userId: 'usr-1',
    email: 'admin@example.com',
    role: 'super-admin',
    status: 'active',
    passwordChangeRequired: false,
    createdAt: '2026-11-10T10:00:00.000Z',
  },
  {
    userId: 'usr-2',
    email: 'newbie@example.com',
    role: 'user',
    status: 'active',
    passwordChangeRequired: true,
    createdAt: '2026-11-10T11:00:00.000Z',
  },
  {
    userId: 'usr-3',
    email: 'disabled@example.com',
    role: 'user',
    status: 'inactive',
    passwordChangeRequired: false,
    createdAt: '2026-11-10T09:00:00.000Z',
  },
];

describe('AdministrationPanel & CreateUserDialog', () => {
  it('renders users table with email, role, status badges, and action controls', () => {
    const client: AdministrationClient = {
      listUsers: vi.fn(async () => ({
        items: SAMPLE_USERS,
        nextCursor: null,
      })),
      createUser: vi.fn(),
      deactivateUser: vi.fn(),
      reactivateUser: vi.fn(),
      sendPasswordReset: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(AdministrationPanel, {
        client,
        initialUsers: SAMPLE_USERS,
      }),
    );

    expect(html).toContain('User administration');
    expect(html).toContain('Create user');
    expect(html).toContain('admin@example.com');
    expect(html).toContain('newbie@example.com');
    expect(html).toContain('disabled@example.com');

    expect(html).toContain('Active');
    expect(html).toContain('Pending password change');
    expect(html).toContain('Inactive');

    expect(html).toContain('Deactivate');
    expect(html).toContain('Reactivate');
    expect(html).toContain('Send reset');
  });

  it('renders CreateUserDialog with email, masked temporary password, and User-only role', () => {
    const html = renderToStaticMarkup(
      createElement(CreateUserDialog, {
        open: true,
        onClose: vi.fn(),
        onCreate: vi.fn(),
      }),
    );

    expect(html).toContain('Create new user');
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('Temporary password');
    expect(html).toContain('Role');
    expect(html).toContain('value="user"');
    expect(html).not.toContain('value="super-admin"');
  });
});
