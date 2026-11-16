/**
 * ============================================================================
 * FILE: auth.module.ts
 * LOCATION: backend/src/auth/auth.module.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Register an independently composable authentication HTTP module.
 *
 * ROLE IN PROJECT:
 *    Receives the already-created AuthService and cookie Secure flag. It never
 *    constructs persistence, a WorkOS client, or a second runtime.
 *
 * KEY COMPONENTS:
 *    - AuthModule.register: Configurable Nest composition.
 * ============================================================================
 */

import { ConfigurableModuleBuilder, Module } from '@nestjs/common';
import { AUTH_HTTP_OPTIONS, AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
export type AuthModuleOptions = { service: AuthService; secureCookie: boolean };
const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } = new ConfigurableModuleBuilder<AuthModuleOptions>().build();
@Module({ controllers: [AuthController], providers: [
  { provide: AuthService, inject: [MODULE_OPTIONS_TOKEN], useFactory: (o: AuthModuleOptions) => o.service },
  { provide: AUTH_HTTP_OPTIONS, inject: [MODULE_OPTIONS_TOKEN], useFactory: (o: AuthModuleOptions) => ({ secureCookie: o.secureCookie }) },
], exports: [AuthService] })
export class AuthModule extends ConfigurableModuleClass {}
