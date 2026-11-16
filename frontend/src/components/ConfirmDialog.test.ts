/**
 * ============================================================================
 * FILE: ConfirmDialog.test.ts
 * LOCATION: frontend/src/components/ConfirmDialog.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for the ConfirmDialog component.
 *
 * ROLE IN PROJECT:
 *    Validates that the confirmation dialog renders accessible markup,
 *    appropriate variant styling, busy indicators, and handles dismissal.
 *
 * KEY COMPONENTS:
 *    - Alertdialog ARIA attributes & role checks
 *    - Variant styling (danger, warning, primary)
 *    - Busy state and button disabling
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog.tsx';

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: false,
        title: 'Delete session?',
        message: 'This will delete the session.',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(html).toBe('');
  });

  it('renders accessible alertdialog with title, message, and action labels', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        title: 'Delete chat?',
        message: 'Delete “Hey Aurvin”? This chat will be removed from your history.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        variant: 'danger',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="aurvin-confirm-title"');
    expect(html).toContain('aria-describedby="aurvin-confirm-message"');
    expect(html).toContain('Delete chat?');
    expect(html).toContain('Delete “Hey Aurvin”? This chat will be removed from your history.');
    expect(html).toContain('Cancel');
    expect(html).toContain('Delete');
    expect(html).toContain('aurvin-confirm-badge-danger');
    expect(html).toContain('aurvin-confirm-btn-danger');
  });

  it('renders warning variant for discard flows', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        title: 'Discard unsaved changes?',
        message: 'Discard unsaved configuration changes and return to chat?',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        variant: 'warning',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('Discard unsaved changes?');
    expect(html).toContain('Discard changes');
    expect(html).toContain('Keep editing');
    expect(html).toContain('aurvin-confirm-badge-warning');
    expect(html).toContain('aurvin-confirm-btn-warning');
  });

  it('disables buttons and shows busy label when busy', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        title: 'Delete chat?',
        message: 'Deleting this session...',
        confirmLabel: 'Delete',
        variant: 'danger',
        busy: true,
        busyLabel: 'Deleting…',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('Deleting…');
    expect(html).not.toContain('>Delete<');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Cancel<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Deleting…<\/button>/);
  });
});
