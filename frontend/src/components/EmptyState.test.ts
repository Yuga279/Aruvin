/**
 * ============================================================================
 * FILE: EmptyState.test.ts
 * LOCATION: frontend/src/components/EmptyState.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Confirm EmptyState exports a React function component.
 *
 * ROLE IN PROJECT:
 *    Node-environment smoke check for the welcoming landing view.
 *
 * KEY COMPONENTS:
 *    - Export type assertion
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EMPTY_GREETINGS, EmptyState } from './EmptyState.tsx';

describe('EmptyState component', () => {
  it('is exported as a React functional component', () => {
    expect(typeof EmptyState).toBe('function');
  });

  it('offers at least five new-chat greetings', () => {
    expect(EMPTY_GREETINGS.length).toBeGreaterThanOrEqual(5);
    expect(EMPTY_GREETINGS).toContain('Where should we begin?');
  });

  it('shows the Aurvin mark with an accessible name and the tagline on the welcome screen', () => {
    const html = renderToStaticMarkup(createElement(EmptyState));
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Aurvin"/);
    expect(html).toContain('<h1>');
    expect(html).toContain('Beyond assistance. Into intelligence.');
  });
});
