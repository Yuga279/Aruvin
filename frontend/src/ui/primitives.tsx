/**
 * ============================================================================
 * FILE: primitives.tsx
 * LOCATION: frontend/src/ui/primitives.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Small accessible design-system primitives built on Aurvin tokens.
 *
 * ROLE IN PROJECT:
 *    FE-02 shared building blocks for new screens. Native elements only
 *    (no headless-UI dependency); styling lives in ui.css under
 *    aurvin- class names that feature stylesheets do not reuse.
 *
 * KEY COMPONENTS:
 *    - Button / IconButton: variants, sizes; IconButton requires a label
 *    - Badge, Card, Skeleton, Kbd
 *    - ErrorState: role=alert message with optional retry action
 * ============================================================================
 */

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import './ui.css';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('aurvin-btn', `aurvin-btn-${variant}`, `aurvin-btn-${size}`, className)}
      {...rest}
    />
  );
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & {
  /** Required: icon-only controls must have an accessible name. */
  label: string;
  icon: ReactNode;
};

export function IconButton({ label, icon, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={label} className={cx('aurvin-icon-btn', className)} {...rest}>
      {icon}
    </button>
  );
}

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export function Badge({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cx('aurvin-badge', `aurvin-badge-${tone}`, className)} {...rest} />;
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('aurvin-card', className)} {...rest} />;
}

export function Skeleton({ className, width, height = 14 }: { className?: string; width?: number | string; height?: number | string }) {
  return <span aria-hidden="true" className={cx('aurvin-skeleton', className)} style={{ width, height }} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="aurvin-kbd">{children}</kbd>;
}

export function ErrorState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="aurvin-error-state" role="alert">
      <p className="aurvin-error-state-title">{title}</p>
      {message ? <p className="aurvin-error-state-message">{message}</p> : null}
      {actionLabel && onAction ? (
        <Button size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
