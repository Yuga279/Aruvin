/**
 * ============================================================================
 * FILE: auth-context.tsx
 * LOCATION: frontend/src/features/auth/auth-context.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    React context provider managing authentication state and login/logout flows.
 *
 * ROLE IN PROJECT:
 *    Binds the entire UI to server HttpOnly session state and gates private
 *    chat and admin surfaces without client-side credential storage.
 *
 * KEY COMPONENTS:
 *    - AuthProvider: Mounts auth client, manages session lifecycle.
 *    - loginFailureMessage: Maps 503/network faults away from credential errors.
 *    - useAuth: Hook for consuming auth status, user record, and actions.
 * ============================================================================
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AuthClientError,
  createAuthClient,
  type AuthClient,
} from '../../api/auth-client.ts';
import type {
  AuthUser,
  LoginRequest,
  PasswordRequest,
} from '../../api/auth-protocol.ts';

export type AuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'authenticated'
  | 'password-change-required';

export type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
  login: (credentials: LoginRequest) => Promise<boolean>;
  logout: () => Promise<void>;
  changePassword: (request: PasswordRequest) => Promise<boolean>;
  refreshUser: () => Promise<AuthUser | null>;
  clearError: () => void;
  client: AuthClient;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function loginFailureMessage(error: unknown): string {
  if (!(error instanceof AuthClientError)) return 'Invalid email or password.';
  if (error.code === 'RATE_LIMITED') {
    return 'Too many login attempts. Please wait 60 seconds before trying again.';
  }
  if (
    error.code === 'NOT_READY' ||
    error.code === 'AUTH_PROVIDER_UNAVAILABLE' ||
    (error.code === 'INVALID_AUTH_RESPONSE' && error.status === 503)
  ) {
    return 'Sign-in is temporarily unavailable. Please try again in a moment.';
  }
  if (
    error.code === 'AUTH_TIMEOUT' ||
    error.code === 'AUTH_REQUEST_TIMEOUT' ||
    error.code === 'NETWORK_ERROR'
  ) {
    return 'Could not reach Aurvin. Please try again in a moment.';
  }
  return 'Invalid email or password.';
}

export type AuthProviderProps = {
  children: ReactNode;
  client?: AuthClient;
  initialUser?: AuthUser | null;
  initialStatus?: AuthStatus;
};

export function AuthProvider({
  children,
  client: propClient,
  initialUser = null,
  initialStatus,
}: AuthProviderProps) {
  const [client] = useState(() => propClient ?? createAuthClient());
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [status, setStatus] = useState<AuthStatus>(() => {
    if (initialStatus) return initialStatus;
    if (initialUser) {
      return initialUser.passwordChangeRequired ? 'password-change-required' : 'authenticated';
    }
    return 'loading';
  });
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const activeUser = await client.me();
      setUser(activeUser);
      setStatus(activeUser.passwordChangeRequired ? 'password-change-required' : 'authenticated');
      setError(null);
      return activeUser;
    } catch {
      setUser(null);
      setStatus('unauthenticated');
      return null;
    }
  }, [client]);

  useEffect(() => {
    if (initialStatus !== undefined || initialUser !== null) return;
    void refreshUser();
  }, [initialStatus, initialUser, refreshUser]);

  const login = useCallback(
    async (credentials: LoginRequest): Promise<boolean> => {
      setError(null);
      try {
        const loggedIn = await client.login(credentials);
        setUser(loggedIn);
        setStatus(loggedIn.passwordChangeRequired ? 'password-change-required' : 'authenticated');
        return true;
      } catch (err: unknown) {
        setError(loginFailureMessage(err));
        return false;
      }
    },
    [client],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await client.logout();
    } catch {
      // Best-effort server revocation.
    } finally {
      setUser(null);
      setStatus('unauthenticated');
      setError(null);
    }
  }, [client]);

  const changePassword = useCallback(
    async (request: PasswordRequest): Promise<boolean> => {
      setError(null);
      try {
        const updated = await client.changePassword(request);
        setUser(updated);
        setStatus('authenticated');
        return true;
      } catch (err: unknown) {
        const authErr = err as AuthClientError;
        if (authErr?.code === 'RATE_LIMITED') {
          setError('Too many attempts. Please wait before retrying.');
        } else if (authErr?.code === 'INVALID_REQUEST') {
          setError('New password does not meet security requirements. Use at least 10 characters and avoid common or easily guessed passwords.');
        } else if (authErr?.code === 'UNAUTHENTICATED') {
          setError('Session expired or temporary password incorrect. Please sign out and sign in again.');
        } else {
          setError('Could not update password. Please try again.');
        }
        return false;
      }
    },
    [client],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      error,
      login,
      logout,
      changePassword,
      refreshUser,
      clearError,
      client,
    }),
    [user, status, error, login, logout, changePassword, refreshUser, clearError, client],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
