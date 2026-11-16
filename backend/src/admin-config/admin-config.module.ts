/**
 * ============================================================================
 * FILE: admin-config.module.ts
 * LOCATION: backend/src/admin-config/admin-config.module.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Register an independently composable admin configuration HTTP module.
 *
 * ROLE IN PROJECT:
 *    Receives the already-created AdminConfigService and actor closure. It
 *    never constructs persistence, encryption, or a second runtime.
 *
 * KEY COMPONENTS:
 *    - AdminConfigModule.register: Configurable Nest composition.
 * ============================================================================
 */

import { ConfigurableModuleBuilder, Module } from '@nestjs/common';
import type { AdminConfigActor } from '../contracts/config-runtime.js';
import { AdminConfigController } from './admin-config.controller.js';
import { AdminConfigService } from './admin-config.service.js';
import { ADMIN_CONFIG_ACTOR } from './admin-config.tokens.js';

export type AdminConfigModuleOptions = {
  service: AdminConfigService;
  actor: () => AdminConfigActor;
};

const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
  new ConfigurableModuleBuilder<AdminConfigModuleOptions>().build();

@Module({
  controllers: [AdminConfigController],
  providers: [
    {
      provide: AdminConfigService,
      inject: [MODULE_OPTIONS_TOKEN],
      useFactory: (options: AdminConfigModuleOptions) => options.service,
    },
    {
      provide: ADMIN_CONFIG_ACTOR,
      inject: [MODULE_OPTIONS_TOKEN],
      useFactory: (options: AdminConfigModuleOptions) => options.actor,
    },
  ],
  exports: [AdminConfigService],
})
export class AdminConfigModule extends ConfigurableModuleClass {}
