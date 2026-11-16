/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: backend/src/admin-config/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Export the P6-facing admin configuration surface.
 *
 * ROLE IN PROJECT:
 *    Lets assembly register one service, HTTP guard, and Nest module without
 *    depending on test fixtures or a decrypt endpoint.
 *
 * KEY COMPONENTS:
 *    - Service/module/HTTP helper and closed fault exports.
 * ============================================================================
 */

export { AdminConfigService, type AdminConfigOptions } from './admin-config.service.js';
export { AdminConfigModule, type AdminConfigModuleOptions } from './admin-config.module.js';
export { CredentialService } from './credential-service.js';
export { CredentialValidator } from './credential-validation.js';
export { configureAdminHttp, type AdminHttpOptions } from './configure-admin-http.js';
export { AdminConfigFault } from './errors.js';
