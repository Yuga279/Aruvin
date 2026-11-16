/**
 * ============================================================================
 * FILE: ForgotPasswordForm.tsx
 * LOCATION: frontend/src/features/auth/ForgotPasswordForm.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    User-facing mailbox password recovery request screen.
 *
 * ROLE IN PROJECT:
 *    Allows accounts to request a WorkOS password reset email with generic
 *    enumeration-safe feedback.
 *
 * KEY COMPONENTS:
 *    - ForgotPasswordForm: Email input and confirmation notice.
 * ============================================================================
 */

import { useState, type FormEvent } from 'react';
import type { ForgotPasswordRequest } from '../../api/auth-protocol.ts';
import './auth.css';
import { BRAND_NAME } from '../../app/brand.ts';
import { BrandMark } from '../../components/BrandMark.tsx';

export type ForgotPasswordFormProps = {
  onSubmit: (request: ForgotPasswordRequest) => Promise<boolean | void>;
  onBackToLogin: () => void;
  error?: string | null;
  busy?: boolean;
};

export function ForgotPasswordForm({
  onSubmit,
  onBackToLogin,
  error,
  busy = false,
}: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || localBusy || !email.trim()) return;
    setLocalBusy(true);
    try {
      await onSubmit({ email: email.trim().toLowerCase() });
      setSubmitted(true);
    } finally {
      setLocalBusy(false);
    }
  };

  const isSubmitting = busy || localBusy;

  return (
    <div className="aurvin-auth-shell">
      <div className="aurvin-auth-card">
        <div className="aurvin-auth-brand">
          <BrandMark size={24} />
          <span>{BRAND_NAME}</span>
        </div>
        <h1 className="aurvin-auth-title">Reset your password</h1>
        <p className="aurvin-auth-desc">
          Enter your account email. If the address is registered, instructions will be delivered to your inbox.
        </p>

        {submitted ? (
          <div className="aurvin-auth-notice" role="status">
            If an account exists for {email}, a recovery link has been sent. Check your inbox.
          </div>
        ) : null}

        {error ? (
          <div className="aurvin-auth-error" role="alert">
            {error}
          </div>
        ) : null}

        {!submitted ? (
          <form className="aurvin-auth-form" onSubmit={handleSubmit}>
            <div className="aurvin-auth-field">
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                disabled={isSubmitting}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="aurvin-auth-actions">
              <button
                type="submit"
                className="aurvin-auth-submit"
                disabled={isSubmitting || !email.trim()}
              >
                {isSubmitting ? 'Sending…' : 'Send recovery email'}
              </button>
              <button
                type="button"
                className="aurvin-auth-secondary"
                disabled={isSubmitting}
                onClick={onBackToLogin}
              >
                Back to sign in
              </button>
            </div>
          </form>
        ) : (
          <div className="aurvin-auth-actions">
            <button
              type="button"
              className="aurvin-auth-submit"
              onClick={onBackToLogin}
            >
              Return to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
