/**
 * ============================================================================
 * FILE: Dialog.tsx
 * LOCATION: frontend/src/ui/Dialog.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Modal focus management shared by every Aurvin dialog.
 *
 * ROLE IN PROJECT:
 *    Extracted from the original ConfirmDialog so ConfirmDialog and the
 *    command palette trap focus, close on Escape and restore focus the same
 *    way. The hook is markup-agnostic so existing dialog markup and its
 *    tests stay unchanged.
 *
 * KEY COMPONENTS:
 *    - useDialogFocusTrap: Tab cycling, Escape, focus restore on close
 *    - FOCUSABLE_SELECTOR
 * ============================================================================
 */

import { useEffect, useRef, type RefObject } from 'react';

export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function useDialogFocusTrap(
  dialogRef: RefObject<HTMLElement | null>,
  {
    open,
    onEscape,
    escapeDisabled = false,
    initialFocusRef,
    restoreFocus = true,
  }: {
    open: boolean;
    onEscape: () => void;
    escapeDisabled?: boolean;
    initialFocusRef?: RefObject<HTMLElement | null>;
    /** Return focus to the element that was focused before opening. */
    restoreFocus?: boolean;
  },
) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  // Initial focus and focus restoration are tied to open/close only.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    (initialFocusRef?.current ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus();
    return () => {
      if (restoreFocus && previous && previous.isConnected) previous.focus();
    };
  }, [open, dialogRef, initialFocusRef, restoreFocus]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!escapeDisabled) {
          event.preventDefault();
          event.stopPropagation();
          onEscapeRef.current();
        }
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, escapeDisabled, dialogRef]);
}
