/**
 * ============================================================================
 * FILE: MandatoryPasswordChangeForm.tsx
 * LOCATION: frontend/src/features/auth/MandatoryPasswordChangeForm.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    First-login onboarding screen requiring private password replacement.
 *
 * ROLE IN PROJECT:
 *    Gates new User accounts provisioned with admin temporary passwords until
 *    a distinct 8+ character password is confirmed.
 *
 * KEY COMPONENTS:
 *    - MandatoryPasswordChangeForm: Current vs new password validation.
 * ============================================================================
 */

import { useState, type FormEvent } from 'react';
import type { PasswordRequest } from '../../api/auth-protocol.ts';
import './auth.css';
import { BRAND_NAME } from '../../app/brand.ts';
import { BrandMark } from '../../components/BrandMark.tsx';

export type MandatoryPasswordChangeFormProps = {
  onSubmit: (request: PasswordRequest) => Promise<boolean | void>;
  onSignOut: () => void;
  error?: string | null;
  busy?: boolean;
};

export function MandatoryPasswordChangeForm({
  onSubmit,
  onSignOut,
  error,
  busy = false,
}: MandatoryPasswordChangeFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (newPassword.length < 10) {
      setLocalError('New password must be at least 10 characters long.');
      return;
    }
    if (newPassword === currentPassword) {
      setLocalError('New password must be different from your temporary password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError('New passwords do not match.');
      return;
    }

    setLocalBusy(true);
    try {
      await onSubmit({ currentPassword, newPassword });
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
        <h1 className="aurvin-auth-title">Set a new private password</h1>
        <p className="aurvin-auth-desc">
          Your account was provisioned with a temporary password. Choose a private password before accessing Aurvin.
        </p>

        {activeError ? (
          <div className="aurvin-auth-error" role="alert">
            {activeError}
          </div>
        ) : null}

        <form className="aurvin-auth-form" onSubmit={handleSubmit}>
          <div className="aurvin-auth-field">
            <label htmlFor="temp-password">Current temporary password</label>
            <input
              id="temp-password"
              type="password"
              required
              autoFocus
              value={currentPassword}
              disabled={isSubmitting}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>

          <div className="aurvin-auth-field">
            <label htmlFor="new-password">New password (minimum 10 characters)</label>
            <input
              id="new-password"
              type="password"
              required
              minLength={10}
              value={newPassword}
              disabled={isSubmitting}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <span className="aurvin-auth-hint">Must be at least 10 characters and avoid common words (e.g. "password", sequential numbers).</span>
          </div>

          <div className="aurvin-auth-field">
            <label htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              disabled={isSubmitting}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <div className="aurvin-auth-actions">
            <button
              type="submit"
              className="aurvin-auth-submit"
              disabled={isSubmitting || !currentPassword || !newPassword || !confirmPassword}
            >
              {isSubmitting ? 'Updating…' : 'Set new password & continue'}
            </button>
            <button
              type="button"
              className="aurvin-auth-secondary"
              disabled={isSubmitting}
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
