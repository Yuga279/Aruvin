/**
 * ============================================================================
 * FILE: auth-boundary.ts
 * LOCATION: backend/src/auth/auth-boundary.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Expose a request-bound cookie admission seam without implementing ALS.
 *
 * ROLE IN PROJECT:
 *    Gives P3 HTTP and upgrade callers one authenticateCookie/authBoundary
 *    helper. P1 does not install global middleware or request-context storage.
 *
 * KEY COMPONENTS:
 *    - authenticateCookie: Admit a sealed session cookie.
 *    - authBoundary: Per-request principal, optional refreshed Set-Cookie.
 * ============================================================================
 */

import type { NextFunction, Request, Response } from 'express';
import type { AuthPrincipal } from '../contracts/auth.js';
import { AuthService } from './auth.service.js';
import { readSessionCookie, sessionCookie } from './cookies.js';
export const authenticateCookie = (service: AuthService, header: string | string[] | undefined) =>
  service.authenticate(readSessionCookie(header));
export type RunAuthenticated = (principal: AuthPrincipal, next: () => void) => void;
export function authBoundary(service: AuthService, run: RunAuthenticated, secureCookie = false) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authenticateCookie(service, req.headers.cookie);
      if (result.sealedSession) res.setHeader('Set-Cookie', sessionCookie(result.sealedSession, secureCookie));
      run(result.principal, () => next());
    } catch (error) { next(error); }
  };
}
