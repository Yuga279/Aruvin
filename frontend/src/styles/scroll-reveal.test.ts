/**
 * ============================================================================
 * FILE: scroll-reveal.test.ts
 * LOCATION: frontend/src/styles/scroll-reveal.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the scroll container that the pointer reveal marks.
 *
 * ROLE IN PROJECT:
 *    Node-side contract check for scroll-reveal.ts, which decides which
 *    scrollbar belongs to the region under the cursor.
 *
 * KEY COMPONENTS:
 *    - Stubbed overflow styles
 *    - Nearest scrollable ancestor selection
 *    - Non-scrollable regions resolve to no container
 * ============================================================================
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findScrollContainer } from './scroll-reveal.ts';

interface FakeBox {
  tag: string;
  overflowY: string;
  overflowX: string;
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
  parentElement: FakeBox | null;
}

function box(overrides: Partial<FakeBox> & { tag: string }): FakeBox {
  return {
    overflowY: 'visible',
    overflowX: 'visible',
    scrollHeight: 100,
    clientHeight: 100,
    scrollWidth: 100,
    clientWidth: 100,
    parentElement: null,
    ...overrides,
  };
}

const body = box({ tag: 'body' });
const documentElement = box({ tag: 'html', parentElement: body });
body.parentElement = documentElement;

const originalGetComputedStyle = globalThis.getComputedStyle;
const originalDocument = globalThis.document;

beforeEach(() => {
  globalThis.getComputedStyle = ((element: FakeBox) => ({
    overflowY: element.overflowY,
    overflowX: element.overflowX,
  })) as unknown as typeof globalThis.getComputedStyle;
  globalThis.document = { body, documentElement } as unknown as Document;
});

afterEach(() => {
  globalThis.getComputedStyle = originalGetComputedStyle;
  globalThis.document = originalDocument;
});

describe('scroll reveal target', () => {
  it('picks the nearest ancestor that shows a scrollbar', () => {
    const transcript = box({
      tag: 'transcript',
      overflowY: 'auto',
      scrollHeight: 3000,
      clientHeight: 800,
    });
    const message = box({ tag: 'message', parentElement: transcript });

    expect(findScrollContainer(message as unknown as Element)).toBe(
      transcript as unknown as Element,
    );
  });

  it('prefers the innermost scrollable region over its scrollable ancestor', () => {
    const transcript = box({
      tag: 'transcript',
      overflowY: 'auto',
      scrollHeight: 3000,
      clientHeight: 800,
    });
    const codeBlock = box({
      tag: 'pre',
      overflowX: 'auto',
      scrollWidth: 900,
      clientWidth: 400,
      parentElement: transcript,
    });

    expect(findScrollContainer(codeBlock as unknown as Element)).toBe(
      codeBlock as unknown as Element,
    );
  });

  it('ignores clipped regions that cannot scroll', () => {
    const layout = box({ tag: 'layout', overflowY: 'hidden', scrollHeight: 3000, clientHeight: 800 });

    expect(findScrollContainer(layout as unknown as Element)).toBeNull();
  });

  it('ignores scrollable regions whose content fits', () => {
    const transcript = box({ tag: 'transcript', overflowY: 'auto' });

    expect(findScrollContainer(transcript as unknown as Element)).toBeNull();
  });
});
