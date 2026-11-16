/**
 * ============================================================================
 * FILE: http-harness.ts
 * LOCATION: backend/test/http/http-harness.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Boot an isolated Nest HTTP listener with injected ChatHttpOptions.
 *
 * ROLE IN PROJECT:
 *    Gives P6 route and native e2e tests a real Express adapter, API prefix,
 *    and parser boundary without P9 application entry wiring.
 *
 * KEY COMPONENTS:
 *    - httpHarness: Register module, configure parser, listen on loopback.
 * ============================================================================
 */

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ChatHttpModule,configureChatHttp } from '../../src/http/index.js';
import type { ChatHttpOptions } from '../../src/http/options.js';
export async function httpHarness(options:ChatHttpOptions) {
  const module = await Test.createTestingModule({ imports:[ChatHttpModule.register(options)] }).compile();
  const app = module.createNestApplication<NestExpressApplication>({ bodyParser:false,logger:false });
  app.setGlobalPrefix('api'); configureChatHttp(app,options.budgets);
  await app.listen(0,'127.0.0.1');
  return { app,url:await app.getUrl(),close:() => app.close() };
}
