/**
 * ============================================================================
 * FILE: http-fixture.ts
 * LOCATION: backend/test/administration/http-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Boot Administration in isolation without infrastructure or auth bypasses.
 *
 * ROLE IN PROJECT:
 *    Supplies trusted test principals, never a production singleton.
 *    Reuses the same service instance through real Nest route registration.
 *
 * KEY COMPONENTS:
 *    - AdministrationModule fixture and sequential principal selector.
 * ============================================================================
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { AuthPrincipal } from '../../src/contracts/auth.js';
import { AdministrationModule } from '../../src/administration/administration.module.js';
import { configureAdministrationHttp } from '../../src/administration/configure-administration-http.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { administrationFixture } from './fixtures.js';
type HttpFixtureOptions = { frontendOrigin?: string; trustedHttpsIngress?: (req: Request) => boolean };

export async function administrationHttpFixture(options: HttpFixtureOptions = {}) {
  const f = await administrationFixture(); let principal: AuthPrincipal | null = f.admin;
  const moduleRef = await Test.createTestingModule({ imports: [AdministrationModule.register({
    service: f.service, principal: () => principal,
  })] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  app.setGlobalPrefix('api');
  configureAdministrationHttp(app, {
    bootstrap: loadBootstrapConfig({ FRONTEND_ORIGIN: options.frontendOrigin ?? 'http://localhost:5173' }),
    trustedHttpsIngress: options.trustedHttpsIngress ?? (() => false),
  });
  await app.init();
  return { ...f, app, as: (next: AuthPrincipal | null) => { principal = next; } };
}
