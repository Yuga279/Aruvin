/**
 * ============================================================================
 * FILE: ConfirmDialog.tsx
 * LOCATION: frontend/src/components/ConfirmDialog.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Accessible confirmation modal dialog replacing browser-native confirm prompts.
 *
 * ROLE IN PROJECT:
 *    Renders a themed modal dialog with keyboard trapping, backdrop blur,
 *    cancellation, and action variants (danger, warning, primary) for destructive
 *    or critical actions like session deletion, user deactivation, and discard.
 *
 * KEY COMPONENTS:
 *    - ConfirmDialog: Accessible modal dialog with focus trapping and ESC dismiss.
 * ============================================================================
 */

import { useRef, type ReactNode } from 'react';
import { useDialogFocusTrap } from '../ui/Dialog.tsx';
import './confirm-dialog.css';

export type ConfirmDialogVariant = 'danger' | 'warning' | 'primary';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  busy = false,
  busyLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus Cancel by default for safety on destructive actions. Focus is not
  // restored on close: callers (e.g. ChatView) already manage return focus.
  useDialogFocusTrap(dialogRef, {
    open,
    onEscape: onCancel,
    escapeDisabled: busy,
    initialFocusRef: cancelButtonRef,
    restoreFocus: false,
  });

  if (!open) return null;

  return (
    <div
      className="aurvin-confirm-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        ref={dialogRef}
        className={`aurvin-confirm-dialog aurvin-confirm-${variant}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="aurvin-confirm-title"
        aria-describedby="aurvin-confirm-message"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="aurvin-confirm-header">
          <div className={`aurvin-confirm-icon-badge aurvin-confirm-badge-${variant}`} aria-hidden="true">
            {variant === 'danger' ? (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            ) : variant === 'warning' ? (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            )}
          </div>
          <div className="aurvin-confirm-text">
            <h2 id="aurvin-confirm-title" className="aurvin-confirm-title">
              {title}
            </h2>
            <div id="aurvin-confirm-message" className="aurvin-confirm-message">
              {message}
            </div>
          </div>
        </div>
        <div className="aurvin-confirm-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="aurvin-confirm-cancel-btn"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            className={`aurvin-confirm-btn aurvin-confirm-btn-${variant}`}
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? (busyLabel ?? 'Working…') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
