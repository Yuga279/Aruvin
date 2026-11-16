/**
 * ============================================================================
 * FILE: administration.module.ts
 * LOCATION: backend/src/administration/administration.module.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Register Administration using existing service and principal reader.
 *
 * ROLE IN PROJECT:
 *    Lets P3 compose once without opening persistence or a runtime.
 *    Leaves request context and infrastructure lifecycle with their owners.
 *
 * KEY COMPONENTS:
 *    - AdministrationModule.register and its narrow options type.
 * ============================================================================
 */
import { ConfigurableModuleBuilder, Module } from '@nestjs/common';
import type { AuthPrincipal } from '../contracts/auth.js';
import { ADMINISTRATION_PRINCIPAL, AdministrationController } from './administration.controller.js';
import { AdministrationService } from './administration.service.js';

export type AdministrationModuleOptions = {
  service: AdministrationService; principal: () => AuthPrincipal | null;
};
const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } = new ConfigurableModuleBuilder<AdministrationModuleOptions>().build();
@Module({ controllers: [AdministrationController], providers: [
  { provide: AdministrationService, inject: [MODULE_OPTIONS_TOKEN],
    useFactory: (o: AdministrationModuleOptions) => o.service },
  { provide: ADMINISTRATION_PRINCIPAL, inject: [MODULE_OPTIONS_TOKEN],
    useFactory: (o: AdministrationModuleOptions) => o.principal },
], exports: [AdministrationService] })
export class AdministrationModule extends ConfigurableModuleClass {}
