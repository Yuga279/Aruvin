/**
 * ============================================================================
 * FILE: ui.test.ts
 * LOCATION: frontend/src/ui/ui.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Render-level checks for Aurvin design-system primitives.
 *
 * ROLE IN PROJECT:
 *    Guards accessible defaults: buttons never submit forms by accident,
 *    icon buttons always have a name, errors are announced, skeletons are
 *    hidden from assistive technology.
 *
 * KEY COMPONENTS:
 *    - Button, IconButton, Badge, Card, Skeleton, Kbd, ErrorState
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge, Button, Card, ErrorState, IconButton, Kbd, Skeleton } from './index.ts';

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe('ui primitives', () => {
  it('Button defaults to type=button and applies variant and size classes', () => {
    const out = html(createElement(Button, { variant: 'primary', size: 'sm' }, 'Save'));
    expect(out).toContain('type="button"');
    expect(out).toContain('class="aurvin-btn aurvin-btn-primary aurvin-btn-sm"');
    expect(html(createElement(Button, { type: 'submit' }, 'Go'))).toContain('type="submit"');
  });

  it('IconButton exposes its label as the accessible name', () => {
    const out = html(createElement(IconButton, { label: 'Close panel', icon: createElement('svg') }));
    expect(out).toContain('aria-label="Close panel"');
    expect(out).toContain('type="button"');
  });

  it('Badge, Card and Kbd render with tokenised classes', () => {
    expect(html(createElement(Badge, { tone: 'success' }, 'Live'))).toContain('aurvin-badge aurvin-badge-success');
    expect(html(createElement(Card, null, 'Body'))).toContain('class="aurvin-card"');
    expect(html(createElement(Kbd, null, 'Esc'))).toBe('<kbd class="aurvin-kbd">Esc</kbd>');
  });

  it('Skeleton is hidden from assistive technology', () => {
    expect(html(createElement(Skeleton, { width: 120 }))).toContain('aria-hidden="true"');
  });

  it('ErrorState announces itself and shows the action only with a handler', () => {
    const withAction = html(createElement(ErrorState, { title: 'Could not load', actionLabel: 'Retry', onAction: () => undefined }));
    expect(withAction).toContain('role="alert"');
    expect(withAction).toContain('Retry');
    expect(html(createElement(ErrorState, { title: 'Could not load', actionLabel: 'Retry' }))).not.toContain('Retry');
  });
});
