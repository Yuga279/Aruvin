/**
 * ============================================================================
 * FILE: platform.module.ts
 * LOCATION: backend/src/platform/platform.module.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide validated platform configuration and server identity in Nest.
 *
 * ROLE IN PROJECT:
 *    Exposes reusable infrastructure-independent primitives for downstream
 *    modules without wiring the P1 module into the application entry point.
 *
 * KEY COMPONENTS:
 *    - AURVIN_CONFIG provider: Loads and validates process environment values.
 *    - RequestIdentityStore / ServerIdentityResolver: Shared request identity.
 * ============================================================================
 */

import { Module } from '@nestjs/common';
import { loadBootstrapConfig, legacyConfigWarning } from './config/bootstrap-config.js';
import { RequestIdentityStore } from './identity/request-identity-store.js';
import { ServerIdentityResolver } from './identity/server-identity-resolver.js';
import { AURVIN_CONFIG } from './tokens.js';

@Module({
  providers: [
    {
      provide: AURVIN_CONFIG,
      useFactory: () => {
        const bootstrap = loadBootstrapConfig(process.env);
        const warning = legacyConfigWarning(process.env);
        if (warning) process.stderr.write(`${warning}\n`);
        return bootstrap;
      },
    },
    RequestIdentityStore,
    ServerIdentityResolver,
  ],
  exports: [AURVIN_CONFIG, RequestIdentityStore, ServerIdentityResolver],
})
export class PlatformModule {}
