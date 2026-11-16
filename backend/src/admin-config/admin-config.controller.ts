/**
 * ============================================================================
 * FILE: admin-config.controller.ts
 * LOCATION: backend/src/admin-config/admin-config.controller.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Expose GET/PUT config and POST credential operations with safe errors.
 *
 * ROLE IN PROJECT:
 *    Keeps HTTP routing thin: query/provider checks live here while CAS,
 *    encryption, and provider recognition belong to AdminConfigService.
 *
 * KEY COMPONENTS:
 *    - AdminConfigController: Strict routes under admin/config.
 *    - AdminConfigFilter: Closed fault bodies; unknown errors stay static.
 * ============================================================================
 */

import {
  Body,
  Catch,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseFilters,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AdminConfigActor } from '../contracts/config-runtime.js';
import type { CredentialProvider } from '../contracts/admin-config-wire.js';
import { AuthFault } from '../auth/errors.js';
import { AdminConfigService } from './admin-config.service.js';
import { AdminConfigFault } from './errors.js';
import { ADMIN_CONFIG_ACTOR } from './admin-config.tokens.js';

@Catch()
class AdminConfigFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      if (!res.destroyed && !res.writableEnded) res.end();
      return;
    }
    if (error instanceof AuthFault) {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(error.status).json(error.body()); return;
    }
    const fault = error instanceof AdminConfigFault
      ? error
      : new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(fault.status).json(fault.body());
  }
}

@Controller('admin/config')
@UseFilters(AdminConfigFilter)
export class AdminConfigController {
  constructor(
    @Inject(AdminConfigService) private readonly service: AdminConfigService,
    @Inject(ADMIN_CONFIG_ACTOR) private readonly actor: () => AdminConfigActor,
  ) {}

  @Get()
  get(@Query() query: unknown) {
    noQuery(query);
    return this.service.read(this.actor());
  }

  @Put()
  put(@Body() body: unknown, @Query() query: unknown) {
    noQuery(query);
    return this.service.saveSettings(body, this.actor());
  }

  @Post('credentials/:provider')
  @HttpCode(200)
  post(
    @Param('provider') provider: string,
    @Body() body: unknown,
    @Query() query: unknown,
  ) {
    noQuery(query);
    if (provider !== 'openrouter' && provider !== 'deepgram') {
      throw new AdminConfigFault('INVALID_CONFIG_REQUEST');
    }
    return this.service.updateCredential(provider as CredentialProvider, body, this.actor());
  }
}

function noQuery(query: unknown): void {
  if (query !== undefined && query !== null && typeof query === 'object'
    && Object.keys(query as object).length > 0) {
    throw new AdminConfigFault('INVALID_CONFIG_REQUEST');
  }
}
