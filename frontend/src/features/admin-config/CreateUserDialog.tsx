/**
 * ============================================================================
 * FILE: CreateUserDialog.tsx
 * LOCATION: frontend/src/features/admin-config/CreateUserDialog.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Accessible modal dialog for Super Admins to provision new User accounts.
 *
 * ROLE IN PROJECT:
 *    Captures email and masked temporary password, restricts the role choice
 *    to 'user' only, and clears the temporary password on submission or exit.
 *
 * KEY COMPONENTS:
 *    - CreateUserDialog: Transient input clearing and creation submission.
 * ============================================================================
 */

import { useState, type FormEvent } from 'react';
import type { CreateUserRequest } from '../../api/administration-protocol.ts';

export type CreateUserDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (request: CreateUserRequest) => Promise<boolean | void>;
  error?: string | null;
  busy?: boolean;
};

export function CreateUserDialog({
  open,
  onClose,
  onCreate,
  error,
  busy = false,
}: CreateUserDialogProps) {
  const [email, setEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!open) return null;

  const handleClose = () => {
    setEmail('');
    setTemporaryPassword('');
    setLocalError(null);
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!email.trim() || !temporaryPassword) return;

    if (temporaryPassword.length < 8) {
      setLocalError('Temporary password must be at least 8 characters long.');
      return;
    }

    setLocalBusy(true);
    try {
      const ok = await onCreate({
        email: email.trim().toLowerCase(),
        temporaryPassword,
        role: 'user',
      });
      if (ok !== false) {
        handleClose();
      }
    } finally {
      setLocalBusy(false);
    }
  };

  const isSubmitting = busy || localBusy;
  const activeError = localError || error;

  return (
    <div className="aurvin-dialog-backdrop" onClick={handleClose}>
      <div
        className="aurvin-dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-user-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="create-user-dialog-title" className="aurvin-dialog-title">
          Create new user
        </h2>
        <p className="aurvin-admin-help">
          The user will be required to replace their temporary password on first sign-in.
        </p>

        {activeError ? (
          <div className="aurvin-admin-summary" role="alert">
            <p>{activeError}</p>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="aurvin-dialog-form">
          <div className="aurvin-admin-field">
            <label htmlFor="create-user-email">Email</label>
            <input
              id="create-user-email"
              type="email"
              required
              autoFocus
              autoComplete="off"
              value={email}
              disabled={isSubmitting}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="aurvin-admin-field">
            <label htmlFor="create-user-password">Temporary password</label>
            <input
              id="create-user-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={temporaryPassword}
              disabled={isSubmitting}
              onChange={(e) => setTemporaryPassword(e.target.value)}
            />
          </div>

          <div className="aurvin-admin-field">
            <label htmlFor="create-user-role">Role</label>
            <select id="create-user-role" disabled value="user">
              <option value="user">User</option>
            </select>
          </div>

          <div className="aurvin-dialog-buttons">
            <button
              type="button"
              className="aurvin-dialog-cancel"
              disabled={isSubmitting}
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="aurvin-admin-save"
              disabled={isSubmitting || !email.trim() || !temporaryPassword}
            >
              {isSubmitting ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
