/**
 * ============================================================================
 * FILE: operations.module.ts
 * LOCATION: backend/src/operations/operations.module.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Register the operations controller against one injected OperationsService.
 *
 * ROLE IN PROJECT:
 *    Lets P9 compose register/registerAsync without constructing a second
 *    runtime, telemetry instance, or persistence owner inside this module.
 *
 * KEY COMPONENTS:
 *    - OperationsModule: Configurable factory that reuses the caller service.
 * ============================================================================
 */

import { ConfigurableModuleBuilder,Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
type ModuleOptions={ service:OperationsService };
const { ConfigurableModuleClass,MODULE_OPTIONS_TOKEN }=new ConfigurableModuleBuilder<ModuleOptions>().build();
@Module({ controllers:[OperationsController],providers:[{
  provide:OperationsService,inject:[MODULE_OPTIONS_TOKEN],useFactory:(o:ModuleOptions) => o.service,
}],exports:[OperationsService] })
export class OperationsModule extends ConfigurableModuleClass {}
