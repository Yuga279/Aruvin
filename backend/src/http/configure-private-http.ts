/**
 * ============================================================================
 * FILE: configure-private-http.ts
 * LOCATION: backend/src/http/configure-private-http.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Admit cookie sessions before private parsers or controller work.
 *
 * ROLE IN PROJECT:
 *    Closes every /api route except public liveness, exact auth routes, OPTIONS
 *    preflight, and the static Calendar callback; binds ALS for admitted work.
 *
 * KEY COMPONENTS:
 *    - configurePrivateHttp: Origin policy, cookie admission, ALS run.
 * ============================================================================
 */

import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AuthService } from '../auth/auth.service.js';
import { readSessionCookie, clearSessionCookie, sessionCookie } from '../auth/cookies.js';
import { requireFullAccount, requireSuperAdmin } from '../auth/access.js';
import { AuthFault } from '../auth/errors.js';
import type { RequestIdentityStore } from '../platform/identity/request-identity-store.js';
import type { AuthPrincipal } from '../contracts/auth.js';

export type PrivateHttpOptions = { auth: Pick<AuthService, 'authenticate'>;
  identities: RequestIdentityStore; frontendOrigin: string; secureCookie: boolean;
  prepareOwner?: (principal: AuthPrincipal) => Promise<void> };
const authRoutes = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/me',
  '/api/auth/password', '/api/auth/forgot-password', '/api/auth/reset-password']);
export function configurePrivateHttp(app: Pick<NestExpressApplication, 'use'>, o: PrivateHttpOptions): void {
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const path = req.path.replace(/\/+$/, '').toLowerCase();
    if (path !== '/api' && !path.startsWith('/api/')) { next(); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const originalSet = res.setHeader.bind(res);
    res.setHeader = ((name: string, value: number | string | readonly string[]) =>
      name.toLowerCase() === 'etag' ? res : originalSet(name, value)) as typeof res.setHeader;
    res.removeHeader('ETag');
    if (req.method === 'OPTIONS' || authRoutes.has(path) ||
      (req.method === 'GET' && path === '/api/operations/live') ||
      (req.method === 'GET' && path === '/api/plugins/google-calendar/oauth/callback')) {
      next(); return;
    }
    try {
      const origin = req.headers.origin;
      const mutation = !['GET', 'HEAD'].includes(req.method);
      if (req.headers['sec-fetch-site'] === 'cross-site' ||
        (origin !== undefined && origin !== o.frontendOrigin) || (mutation && origin !== o.frontendOrigin))
        throw new AuthFault('FORBIDDEN');
      const admitted = await o.auth.authenticate(readSessionCookie(req.headers.cookie));
      const p = requireFullAccount(admitted.principal);
      if (path === '/api/admin' || path.startsWith('/api/admin/')) requireSuperAdmin(p);
      if (admitted.sealedSession) res.append('Set-Cookie', sessionCookie(admitted.sealedSession, o.secureCookie));
      await o.prepareOwner?.(p);
      o.identities.attach(req, p);
      o.identities.run(p, () => next());
    } catch (error) {
      const fault = error instanceof AuthFault ? error : new AuthFault('NOT_READY');
      if (fault.code === 'UNAUTHENTICATED') res.append('Set-Cookie', clearSessionCookie(o.secureCookie));
      res.status(fault.status).json(fault.body());
    }
  });
}
