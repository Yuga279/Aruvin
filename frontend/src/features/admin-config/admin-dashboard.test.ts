/**
 * ============================================================================
 * FILE: admin-dashboard.test.ts
 * LOCATION: frontend/src/features/admin-config/admin-dashboard.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Static-render checks for section fields, Config/Plugins/Analytics tabs, and save/status copy.
 *
 * ROLE IN PROJECT:
 *    Complements the closed browser fixture with Node SSR markup assertions.
 *    Interaction, focus, and lifecycle proof remain in the browser fixture.
 *
 * KEY COMPONENTS:
 *    - ConfigFields selected-section rendering
 *    - AdminDashboard activation and unavailable-read markup
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { AdminConfigClient } from '../../api/admin-config-client.ts';
import { AdminDashboard, activationCopy } from './AdminDashboard.tsx';
import { ConfigFields, fieldDomId } from './ConfigFields.tsx';
import { editableFields, fieldsFromSettings } from './config-edit-state.ts';
import { publicConfig } from './testing/fixtures.ts';

const client: AdminConfigClient = {
  read: vi.fn(async () => publicConfig()),
  saveSettings: vi.fn(async () => publicConfig()),
  updateCredential: vi.fn(async () => publicConfig()),
};

it('renders only the selected section with labeled units and fixed privacy', () => {
  const html = renderToStaticMarkup(createElement(ConfigFields, {
    section: 'openrouter', fields: fieldsFromSettings(publicConfig().settings),
    errors: [], disabled: false, onChange: () => undefined,
  }));
  expect(html).toContain('Model ID');
  expect(html).toContain('Data collection denied');
  expect(html).toContain('Transforms disabled');
  expect(html).not.toContain('Daily minutes');
  expect(html).not.toContain('OPENROUTER_API_KEY');
});

it('covers each section catalog with human labels', () => {
  const fields = fieldsFromSettings(publicConfig().settings);
  for (const section of ['openrouter', 'chat', 'voice', 'deepgram'] as const) {
    const html = renderToStaticMarkup(createElement(ConfigFields, {
      section, fields, errors: [], disabled: false, onChange: () => undefined,
    }));
    for (const field of editableFields.filter((item) => item.section === section)) {
      expect(html).toContain(field.label);
    }
  }
});

it('describes invalid fields with linked error ids', () => {
  const path = 'chat.maxInputChars' as const;
  const html = renderToStaticMarkup(createElement(ConfigFields, {
    section: 'chat', fields: fieldsFromSettings(publicConfig().settings),
    errors: [{ path, code: 'out_of_range' }], disabled: false, onChange: () => undefined,
  }));
  const id = fieldDomId(path);
  expect(html).toContain(`id="${id}"`);
  expect(html).toContain(`id="${id}-help"`);
  expect(html).toContain(`id="${id}-error"`);
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain(`aria-describedby="${id}-help ${id}-error"`);
});

it('defaults to Config and keeps Analytics empty without an analytics client method', () => {
  const html = renderToStaticMarkup(createElement(AdminDashboard, {
    client, onBackToChat: () => undefined, refreshCapabilities: async () => true,
  }));
  expect(html).toContain('Manage Aurvin');
  expect(html).toContain('Back to chat');
  expect(html).toContain('Config');
  expect(html).toContain('Plugins');
  expect(html).toContain('Analytics');
  expect(html).toContain('Loading configuration');
  expect(html).not.toContain('Model ID');
  expect(html).not.toContain('chart');
  expect(html).not.toContain('metric');
  expect('analytics' in client).toBe(false);
});

it('associates tabs with panels and keeps only the selected tab in tab order', () => {
  const html = renderToStaticMarkup(createElement(AdminDashboard, {
    client, onBackToChat: () => undefined, refreshCapabilities: async () => true,
  }));
  const selected = html.match(/id="([^"]+-config-tab)"[^>]*aria-selected="true"[^>]*aria-controls="([^"]+-config-panel)"[^>]*tabindex="0"/);
  expect(selected).not.toBeNull();
  expect(html).toContain(`id="${selected?.[2]}"`);
  expect(html).toContain(`aria-labelledby="${selected?.[1]}"`);
  expect(html).toMatch(/id="[^"]+-plugins-tab"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  expect(html).toMatch(/id="[^"]+-analytics-tab"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
});

it('does not label unconfigured or blocked configuration as active', () => {
  const unconfigured = publicConfig();
  unconfigured.activation = 'unconfigured';
  unconfigured.activeRevision = null;
  const blocked = publicConfig();
  blocked.activation = 'blocked';
  blocked.activeRevision = null;
  expect(activationCopy(publicConfig())).toBe('Saved and active for new work');
  expect(activationCopy(unconfigured)).not.toMatch(/active for new work/);
  expect(activationCopy(blocked)).toContain('blocked');
  expect(activationCopy(blocked)).not.toBe('Saved and active for new work');
});

it('keeps save disabled while clean, pending, stale, or uncertain', async () => {
  const { createEditState, editReducer, isDirty } = await import('./config-edit-state.ts');
  let state = createEditState(publicConfig());
  expect(isDirty(state)).toBe(false);
  state = editReducer(state, { type: 'edit', path: 'openRouter.modelId', value: 'x' });
  state = editReducer(state, { type: 'begin', scope: 'settings' });
  expect(state.pending).toBe('settings');
  state = editReducer(state, {
    type: 'failed',
    error: { code: 'CONFIG_CONFLICT', currentRevision: 2, fieldErrors: [] },
  });
  expect(state.stale).toBe(true);
  expect(editReducer(state, { type: 'begin', scope: 'settings' }).pending).toBeNull();
});

it('does not fabricate substitute settings while configuration is unavailable', () => {
  const html = renderToStaticMarkup(createElement(AdminDashboard, {
    client, onBackToChat: () => undefined, refreshCapabilities: async () => true,
  }));
  expect(html).not.toContain('openai/gpt-4.1-mini');
  expect(html).not.toContain('OPENROUTER_API_KEY');
});

it('keeps Google Calendar on the Plugins tab, not the Config rail', () => {
  const html = renderToStaticMarkup(
    createElement(AdminDashboard, {
      client,
      onBackToChat: () => undefined,
      refreshCapabilities: async () => true,
      initialSection: 'calendar',
      initialCalendarStatus: {
        protocolVersion: 1,
        state: 'connected',
        enabled: true,
        accountEmail: 'operator@example.com',
        targetCalendarId: 'disposable-cal-1@group.calendar.google.com',
        processingDisclosure: {
          policyId: 'policy-1',
          processors: 'Google, OpenRouter and the configured model provider',
          dataCollection: 'deny',
        },
      },
    }),
  );
  expect(html).toMatch(/id="[^"]+-plugins-tab"[^>]*aria-selected="true"/);
  expect(html).toContain('aria-label="Plugin sections"');
  expect(html).toContain('Google Calendar');
  expect(html).toContain('Loading configuration');
  const settingsRail = html.match(/aria-label="Settings sections"[^]*?<\/nav>/);
  expect(settingsRail?.[0]).toContain('OpenRouter');
  expect(settingsRail?.[0]).not.toContain('Google Calendar');
});
