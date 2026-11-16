/**
 * ============================================================================
 * FILE: app.module.ts
 * LOCATION: backend/src/app.module.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Register one assembled AppService with operations and chat HTTP modules.
 *
 * ROLE IN PROJECT:
 *    Shares a single composition owner so P6 and P8 receive the same observed
 *    runtime, identity, and lazy archive delegates without circular lifecycle
 *    hooks or a second persistence close path.
 *
 * KEY COMPONENTS:
 *    - AssemblyModule: Async AppService factory over validated platform config.
 *    - AppModule: Auth, administration, operations, and chat HTTP modules.
 * ============================================================================
 */

import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PlatformModule } from './platform/platform.module.js';
import { AURVIN_CONFIG } from './platform/tokens.js';
import type { BootstrapConfig } from './platform/config/bootstrap-config.js';
import { RequestIdentityStore } from './platform/identity/request-identity-store.js';
import { ServerIdentityResolver } from './platform/identity/server-identity-resolver.js';
import { ChatHttpModule } from './http/index.js';
import { OperationsModule } from './operations/index.js';
import { AdminConfigModule } from './admin-config/index.js';
import { AuthModule } from './auth/index.js';
import { AdministrationModule } from './administration/administration.module.js';
import { VoiceGateway } from './voice/transport/voice.gateway.js';
import { VoiceUpgradeAdmission } from './voice/transport/authenticated-ws-adapter.js';
import { VoiceSessionController } from './voice/session/voice-session.controller.js';
import { VoiceSessionService } from './voice/session/voice-session.service.js';
import { GoogleCalendarModule } from './plugins/google-calendar/module.js';

@Module({
  imports: [PlatformModule],
  providers: [{ provide: AppService, inject: [AURVIN_CONFIG, RequestIdentityStore, ServerIdentityResolver],
    useFactory: (config: BootstrapConfig, identities: RequestIdentityStore, identity: ServerIdentityResolver) =>
      AppService.create(config, { identities, identity }) }],
  exports: [AppService, PlatformModule],
})
class AssemblyModule {}

@Module({
  imports: [AssemblyModule,
    AuthModule.registerAsync({ imports: [AssemblyModule], inject: [AppService],
      useFactory: (service: AppService) => ({
        service: service.auth,
        secureCookie: new URL(service.bootstrap.frontendOrigin).protocol === 'https:',
      }) }),
    AdministrationModule.registerAsync({ imports: [AssemblyModule], inject: [AppService],
      useFactory: (service: AppService) => ({ service: service.administration,
        principal: () => service.identities.principal() }) }),
    OperationsModule.registerAsync({ imports: [AssemblyModule], inject: [AppService],
      useFactory: (service: AppService) => ({ service: service.operations }) }),
    AdminConfigModule.registerAsync({ imports: [AssemblyModule], inject: [AppService],
      useFactory: (service: AppService) => ({
        service: service.adminConfig, actor: () => service.adminActor(),
      }) }),
    ChatHttpModule.registerAsync({ imports: [AssemblyModule], inject: [AppService],
      useFactory: (service: AppService) => service.httpOptions(service.identity) }),
    GoogleCalendarModule.registerAsync({
      imports: [AssemblyModule], inject: [AppService],
      useFactory: (service: AppService) => ({
        connections: () => service.calendarFor(service.identities.resolve().userId).connections,
        oauth: () => service.calendarFor(service.identities.resolve().userId).oauth,
        principal: () => service.identities.principal(),
        frontendOrigin: service.bootstrap.frontendOrigin,
      }),
    }),
  ],
  controllers: [AppController, VoiceSessionController],
  providers: [
    { provide: VoiceSessionService, inject: [AppService],
      useFactory: (service: AppService) => service.voiceSessions },
    { provide: VoiceUpgradeAdmission, inject: [AppService],
      useFactory: (service: AppService) => service.voiceUpgrades },
    VoiceGateway,
  ],
})
export class AppModule {}
