/**
 * ============================================================================
 * FILE: LoginForm.tsx
 * LOCATION: frontend/src/features/auth/LoginForm.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Email and password authentication screen for Aurvin users.
 *
 * ROLE IN PROJECT:
 *    Renders the unauthenticated login form with client validation, rate limit
 *    notices, and navigation to the password recovery screen.
 *
 * KEY COMPONENTS:
 *    - LoginForm: Accessible inputs for email and password.
 * ============================================================================
 */

import { useState, type FormEvent } from 'react';
import type { LoginRequest } from '../../api/auth-protocol.ts';
import './auth.css';
import { BRAND_NAME } from '../../app/brand.ts';
import { BrandMark } from '../../components/BrandMark.tsx';

export type LoginFormProps = {
  onSubmit: (credentials: LoginRequest) => Promise<boolean | void>;
  onForgotPassword: () => void;
  error?: string | null;
  busy?: boolean;
};

export function LoginForm({ onSubmit, onForgotPassword, error, busy = false }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localBusy, setLocalBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || localBusy || !email.trim() || !password) return;
    setLocalBusy(true);
    try {
      await onSubmit({ email: email.trim().toLowerCase(), password });
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
        <h1 className="aurvin-auth-title">Sign in to Aurvin</h1>
        <p className="aurvin-auth-desc">Enter your credentials to access your personal assistant.</p>

        {error ? (
          <div className="aurvin-auth-error" role="alert">
            {error}
          </div>
        ) : null}

        <form className="aurvin-auth-form" onSubmit={handleSubmit}>
          <div className="aurvin-auth-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              disabled={isSubmitting}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="aurvin-auth-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              disabled={isSubmitting}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="aurvin-auth-actions">
            <button
              type="submit"
              className="aurvin-auth-submit"
              disabled={isSubmitting || !email.trim() || !password}
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="aurvin-auth-secondary"
              disabled={isSubmitting}
              onClick={onForgotPassword}
            >
              Forgot password?
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
