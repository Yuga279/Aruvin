/**
 * ============================================================================
 * FILE: scroll-reveal.ts
 * LOCATION: frontend/src/styles/scroll-reveal.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Mark the scroll container under the pointer so its scrollbar is revealed.
 *
 * ROLE IN PROJECT:
 *    Backs the hover-reveal scrollbars in scrollbars.css. Chromium caches
 *    ::-webkit-scrollbar-thumb styles and does not re-resolve them when only
 *    the :hover state changes, so the reveal is driven by an attribute toggle
 *    (a real style change) instead of a CSS pseudo-class.
 *
 * KEY COMPONENTS:
 *    - REVEAL_ATTRIBUTE: Marker the scrollbar stylesheet keys off.
 *    - findScrollContainer: Nearest scrollable ancestor of the pointer target.
 *    - installScrollReveal: Document-level pointer tracking.
 * ============================================================================
 */

export const REVEAL_ATTRIBUTE = 'data-aurvin-scroll-reveal';

const SCROLLABLE_OVERFLOW = /auto|scroll|overlay/;

interface ScrollableBox {
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
  parentElement: ScrollableBox | null;
}

/**
 * Nearest ancestor that actually shows a scrollbar, or null when the pointer
 * is over a region that cannot scroll.
 */
export function findScrollContainer(start: unknown): unknown {
  let element = start as (Element & ScrollableBox) | null;
  while (element && element !== document.body && element !== document.documentElement) {
    if (isScrollable(element)) return element;
    element = element.parentElement as (Element & ScrollableBox) | null;
  }
  return null;
}

function isScrollable(element: Element & ScrollableBox): boolean {
  const style = getComputedStyle(element);
  if (!SCROLLABLE_OVERFLOW.test(`${style.overflowY} ${style.overflowX}`)) return false;
  return (
    element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth
  );
}

let installed = false;

/**
 * Track the pointer and reveal only the scroll container it is over, so a
 * scrollbar never belongs to a region the cursor has left.
 */
export function installScrollReveal(): void {
  if (installed || typeof document === 'undefined') return;
  if (typeof matchMedia === 'function' && !matchMedia('(hover: hover) and (pointer: fine)').matches) {
    return;
  }
  installed = true;

  let revealed: Element | null = null;

  const reveal = (target: unknown): void => {
    const next = (findScrollContainer(target) as Element | null) ?? null;
    if (next === revealed) return;
    revealed?.removeAttribute(REVEAL_ATTRIBUTE);
    revealed = next;
    revealed?.setAttribute(REVEAL_ATTRIBUTE, 'true');
  };

  document.addEventListener(
    'pointerover',
    (event) => reveal(event.target),
    true,
  );
  document.addEventListener(
    'pointerout',
    (event) => {
      if (!event.relatedTarget) reveal(null);
    },
    true,
  );
  document.addEventListener('pointercancel', () => reveal(null), true);
}
