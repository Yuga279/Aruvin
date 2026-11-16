/**
 * ============================================================================
 * FILE: module.ts
 * LOCATION: backend/src/plugins/google-calendar/module.ts
 * ============================================================================
 *
 * PURPOSE:
 *    NestJS configurable module definition for the Google Calendar plugin.
 *
 * ROLE IN PROJECT:
 *    Registers GoogleCalendarController and provides injection tokens for
 *    connections and OAuth services.
 *
 * KEY COMPONENTS:
 *    - GoogleCalendarModule: Dynamic module providing plugin routes and services
 *    - GoogleCalendarModuleOptions: Configuration options for injection
 * ============================================================================
 */

import { ConfigurableModuleBuilder, Module } from '@nestjs/common';
import type { AuthPrincipal } from '../../contracts/auth.js';
import { GoogleCalendarConnections } from './connection.js';
import {
  GOOGLE_CALENDAR_CONNECTIONS,
  GOOGLE_CALENDAR_OAUTH,
  GOOGLE_CALENDAR_PRINCIPAL,
  GoogleCalendarController,
} from './controller.js';
import { GoogleCalendarOAuthService } from './oauth.js';

export type GoogleCalendarModuleOptions = {
  connections: () => GoogleCalendarConnections;
  oauth: () => GoogleCalendarOAuthService;
  principal: () => AuthPrincipal;
  frontendOrigin: string;
};

const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
  new ConfigurableModuleBuilder<GoogleCalendarModuleOptions>().build();

@Module({
  controllers: [GoogleCalendarController],
  providers: [
    {
      provide: GOOGLE_CALENDAR_CONNECTIONS,
      inject: [MODULE_OPTIONS_TOKEN],
      useFactory: (options: GoogleCalendarModuleOptions) => options.connections,
    },
    {
      provide: GOOGLE_CALENDAR_OAUTH,
      inject: [MODULE_OPTIONS_TOKEN],
      useFactory: (options: GoogleCalendarModuleOptions) => options.oauth,
    },
    {
      provide: GOOGLE_CALENDAR_PRINCIPAL,
      inject: [MODULE_OPTIONS_TOKEN],
      useFactory: (options: GoogleCalendarModuleOptions) => options.principal,
    },
  ],
  exports: [GOOGLE_CALENDAR_CONNECTIONS, GOOGLE_CALENDAR_OAUTH, GOOGLE_CALENDAR_PRINCIPAL],
})
export class GoogleCalendarModule extends ConfigurableModuleClass {}
