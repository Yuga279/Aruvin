/**
 * ============================================================================
 * FILE: browser-checks.ts
 * LOCATION: frontend/src/features/admin-config/testing/browser-checks.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Native DOM assertion helpers for the closed admin dashboard fixture.
 *
 * ROLE IN PROJECT:
 *    Provides check/type/press primitives so the Vite fixture can prove
 *    real interaction without a new test runner or production imports.
 *
 * KEY COMPONENTS:
 *    - check: Throw on a failed named assertion.
 *    - typeInput / press: Native value and keyboard events.
 * ============================================================================
 */

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function typeInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function press(target: HTMLElement, key: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

export function byLabel(root: ParentNode, name: string): HTMLElement | null {
  const candidates = root.querySelectorAll('input, textarea, button, select, summary, [aria-label], [role="tab"]');
  for (const node of candidates) {
    if (!(node instanceof HTMLElement)) continue;
    const label = node.getAttribute('aria-label')
      || (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement
        ? node.labels?.[0]?.textContent?.trim()
        : null)
      || node.textContent?.trim();
    if (label === name) return node;
  }
  return root.querySelector<HTMLElement>(`[aria-label="${name}"]`);
}
