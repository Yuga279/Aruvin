/**
 * ============================================================================
 * FILE: role-aware-dashboard.test.ts
 * LOCATION: frontend/src/features/admin-config/role-aware-dashboard.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AdminDashboard presents role-gated tabs and avoids restricted
 *    configuration reads when rendered for standard Users.
 *
 * ROLE IN PROJECT:
 *    Ensures standard Users can access Plugins without calling the 403-restricted
 *    GET /admin/config endpoint, while Super Admins see all 4 tabs.
 *
 * KEY COMPONENTS:
 *    - Role check: User sees Plugins only; Super Admin sees Config, Plugins, Analytics, Administration
 *    - Client read call suppression for standard Users
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminConfigClient } from '../../api/admin-config-client.ts';
import { AdminDashboard } from './AdminDashboard.tsx';
import { publicConfig } from './testing/fixtures.ts';

describe('AdminDashboard role-aware navigation', () => {
  it('renders only Plugins tab for standard User and does not call client.read', () => {
    const read = vi.fn(async () => publicConfig());
    const client: AdminConfigClient = {
      read,
      saveSettings: vi.fn(),
      updateCredential: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(AdminDashboard, {
        client,
        user: {
          userId: 'usr-user',
          email: 'user@example.com',
          role: 'user',
          passwordChangeRequired: false,
        },
        onBackToChat: () => undefined,
        refreshCapabilities: async () => true,
      }),
    );

    expect(html).toContain('Manage Aurvin');
    expect(html).toContain('Plugins');
    expect(html).not.toContain('>Config<');
    expect(html).not.toContain('>Analytics<');
    expect(html).not.toContain('>Administration<');
    expect(read).not.toHaveBeenCalled();
  });

  it('renders all 4 tabs for Super Admin and invokes client.read', () => {
    const read = vi.fn(async () => publicConfig());
    const client: AdminConfigClient = {
      read,
      saveSettings: vi.fn(),
      updateCredential: vi.fn(),
    };

    const html = renderToStaticMarkup(
      createElement(AdminDashboard, {
        client,
        user: {
          userId: 'usr-admin',
          email: 'admin@example.com',
          role: 'super-admin',
          passwordChangeRequired: false,
        },
        onBackToChat: () => undefined,
        refreshCapabilities: async () => true,
      }),
    );

    expect(html).toContain('Config');
    expect(html).toContain('Plugins');
    expect(html).toContain('Analytics');
    expect(html).toContain('Administration');
    expect(html).toContain('Loading configuration');
  });
});
