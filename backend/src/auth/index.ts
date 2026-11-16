/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: backend/src/auth/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Export the implemented public authentication surface for P2–P5.
 *
 * ROLE IN PROJECT:
 *    Lets later plans register one service, HTTP guard, and Nest module without
 *    depending on test fixtures or root application wiring.
 *
 * KEY COMPONENTS:
 *    - Module/service/boundary/HTTP helper and closed fault exports.
 * ============================================================================
 */

export { AuthModule, type AuthModuleOptions } from './auth.module.js';
export { AuthService, type AuthServiceOptions } from './auth.service.js';
export { authenticateCookie, authBoundary, type RunAuthenticated } from './auth-boundary.js';
export { configureAuthHttp, type AuthHttpOptions } from './configure-auth-http.js';
export { admitAccount, requireFullAccount, requireSuperAdmin, publicUser, invalidateAccount } from './access.js';
export { WorkosProvider, createWorkosProvider, ProviderAccountConflict, type AuthProvider } from './provider.js';
export { AuthFault } from './errors.js';
export { readSessionCookie, sessionCookie, clearSessionCookie } from './cookies.js';
