/**
 * ============================================================================
 * FILE: chat-http.module.ts
 * LOCATION: backend/src/http/chat-http.module.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Export a configurable Nest module for chat HTTP routes and transport.
 *
 * ROLE IN PROJECT:
 *    Lets P9 register one ChatHttpModule with an existing runtime and
 *    repositories; HTTP never constructs a second runtime or global filter.
 *
 * KEY COMPONENTS:
 *    - ChatHttpModule.register / registerAsync: Dynamic composition.
 *    - Factories: ChatHttpService and ChatStreamTransport from options.
 * ============================================================================
 */

import { ConfigurableModuleBuilder,Module } from '@nestjs/common';
import type { ChatHttpOptions } from './options.js';
import { ChatHttpService } from './chat-http.service.js';
import { ChatStreamTransport } from './chat-stream.transport.js';
import { ChatHttpController } from './chat-http.controller.js';
const { ConfigurableModuleClass,MODULE_OPTIONS_TOKEN } = new ConfigurableModuleBuilder<ChatHttpOptions>().build();
@Module({ controllers:[ChatHttpController],providers:[
  { provide:ChatHttpService,inject:[MODULE_OPTIONS_TOKEN],useFactory:(o:ChatHttpOptions) => new ChatHttpService(o) },
  { provide:ChatStreamTransport,inject:[ChatHttpService],useFactory:(s:ChatHttpService) => new ChatStreamTransport(s) },
],exports:[ChatHttpService,ChatStreamTransport] })
export class ChatHttpModule extends ConfigurableModuleClass {}
