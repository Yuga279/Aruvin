/**
 * ============================================================================
 * FILE: ResetPasswordForm.tsx
 * LOCATION: frontend/src/features/auth/ResetPasswordForm.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Password reset confirmation screen consuming single-use recovery token.
 *
 * ROLE IN PROJECT:
 *    Completes the mailbox recovery flow, invalidates older sessions on the
 *    provider, and guides the user to standard sign-in.
 *
 * KEY COMPONENTS:
 *    - ResetPasswordForm: Token binding and new password validation.
 * ============================================================================
 */

import { useState, type FormEvent } from 'react';
import type { ResetPasswordRequest } from '../../api/auth-protocol.ts';
import './auth.css';
import { BRAND_NAME } from '../../app/brand.ts';
import { BrandMark } from '../../components/BrandMark.tsx';

export type ResetPasswordFormProps = {
  token: string;
  onSubmit: (request: ResetPasswordRequest) => Promise<boolean | void>;
  onSuccess?: () => void;
  error?: string | null;
  busy?: boolean;
};

export function ResetPasswordForm({
  token,
  onSubmit,
  onSuccess,
  error,
  busy = false,
}: ResetPasswordFormProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [completed, setCompleted] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (newPassword.length < 10) {
      setLocalError('Password must be at least 10 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }

    setLocalBusy(true);
    try {
      await onSubmit({ token, newPassword });
      setCompleted(true);
      onSuccess?.();
    } finally {
      setLocalBusy(false);
    }
  };

  const isSubmitting = busy || localBusy;
  const activeError = localError || error;

  return (
    <div className="aurvin-auth-shell">
      <div className="aurvin-auth-card">
        <div className="aurvin-auth-brand">
          <BrandMark size={24} />
          <span>{BRAND_NAME}</span>
        </div>
        <h1 className="aurvin-auth-title">Choose a new password</h1>
        <p className="aurvin-auth-desc">Create a secure private password for your account.</p>

        {completed ? (
          <div className="aurvin-auth-notice" role="status">
            Password has been reset successfully. You can now sign in with your new credentials.
          </div>
        ) : null}

        {activeError ? (
          <div className="aurvin-auth-error" role="alert">
            {activeError}
          </div>
        ) : null}

        {!completed ? (
          <form className="aurvin-auth-form" onSubmit={handleSubmit}>
            <div className="aurvin-auth-field">
              <label htmlFor="reset-new-password">New password (minimum 10 characters)</label>
              <input
                id="reset-new-password"
                type="password"
                required
                minLength={10}
                autoFocus
                value={newPassword}
                disabled={isSubmitting}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <span className="aurvin-auth-hint">Must be at least 10 characters and avoid common words.</span>
            </div>

            <div className="aurvin-auth-field">
              <label htmlFor="reset-confirm-password">Confirm new password</label>
              <input
                id="reset-confirm-password"
                type="password"
                required
                minLength={10}
                value={confirmPassword}
                disabled={isSubmitting}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <div className="aurvin-auth-actions">
              <button
                type="submit"
                className="aurvin-auth-submit"
                disabled={isSubmitting || !newPassword || !confirmPassword}
              >
                {isSubmitting ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
