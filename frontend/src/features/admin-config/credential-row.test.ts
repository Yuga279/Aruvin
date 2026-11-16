/**
 * ============================================================================
 * FILE: credential-row.test.ts
 * LOCATION: frontend/src/features/admin-config/credential-row.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Static-render checks for write-only credential masking and actions.
 *
 * ROLE IN PROJECT:
 *    Locks the eight-dot mask, configured/unconfigured copy, and absence of
 *    reveal controls without exercising live provider validation.
 *
 * KEY COMPONENTS:
 *    - Configured mask without fingerprint or value
 *    - Unconfigured add versus configured replace/remove
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { createAdminConfigClient } from '../../api/admin-config-client.ts';
import { CredentialRow } from './CredentialRow.tsx';
import { publicConfig } from './testing/fixtures.ts';

const client = createAdminConfigClient({ fetch: vi.fn() });

it('renders a fixed mask without a reveal control or credential value', () => {
  const html = renderToStaticMarkup(createElement(CredentialRow, {
    provider: 'openrouter', credential: publicConfig().credentials.openrouter,
    expectedRevision: 1, disabled: false, client,
    onBusy: () => undefined, onSaved: () => undefined, onFailure: () => undefined,
  }));
  expect(html).toContain('••••••••');
  expect(html).toContain('Configured');
  expect(html).toContain('Replace key');
  expect(html).toContain('Remove key');
  expect(html).toMatch(/<span class="aurvin-admin-mask" aria-hidden="true">••••••••<\/span><span>Configured<\/span>/);
  expect(html).not.toMatch(/Reveal|Show key|fingerprint|suffix|prefix/);
  expect(html).not.toContain('type="password"');
  expect(html).toContain('Checks whether the provider recognizes this key');
});

it('renders an unconfigured row with Add key and no mask', () => {
  const html = renderToStaticMarkup(createElement(CredentialRow, {
    provider: 'deepgram', credential: { configured: false, validatedAt: null },
    expectedRevision: 0, disabled: false, client,
    onBusy: () => undefined, onSaved: () => undefined, onFailure: () => undefined,
  }));
  expect(html).toContain('Not configured');
  expect(html).toContain('Add key');
  expect(html).toContain('Deepgram');
  expect(html).not.toContain('••••••••');
  expect(html).not.toContain('Remove key');
  expect(html).not.toContain('Replace key');
});

it('keeps the mask constant across validation timestamps', () => {
  const later = { configured: true as const, validatedAt: '2026-12-01T00:00:00.000Z' };
  const html = renderToStaticMarkup(createElement(CredentialRow, {
    provider: 'openrouter', credential: later,
    expectedRevision: 4, disabled: false, client,
    onBusy: () => undefined, onSaved: () => undefined, onFailure: () => undefined,
  }));
  expect(html).toContain('••••••••');
  expect(html).toContain('Last validation 2026-12-01T00:00:00.000Z');
  expect(html).not.toContain('fingerprint');
});
