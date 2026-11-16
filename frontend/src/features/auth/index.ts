/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: frontend/src/features/auth/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Public exports for the auth feature module.
 *
 * ROLE IN PROJECT:
 *    Exposes AuthProvider, useAuth hook, and custom authentication screens.
 *
 * KEY COMPONENTS:
 *    - AuthProvider & useAuth
 * ============================================================================
 */

export { AuthProvider, useAuth } from './auth-context.tsx';
export type { AuthProviderProps, AuthStatus, AuthContextValue } from './auth-context.tsx';
export { LoginForm } from './LoginForm.tsx';
export { MandatoryPasswordChangeForm } from './MandatoryPasswordChangeForm.tsx';
export { ForgotPasswordForm } from './ForgotPasswordForm.tsx';
export { ResetPasswordForm } from './ResetPasswordForm.tsx';
