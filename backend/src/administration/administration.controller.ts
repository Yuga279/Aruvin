/**
 * ============================================================================
 * FILE: administration.controller.ts
 * LOCATION: backend/src/administration/administration.controller.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Expose the five safe User Administration HTTP routes.
 *
 * ROLE IN PROJECT:
 *    Keeps routing thin and reads P3's current request principal.
 *    Serializes only the closed account and auth failure contracts.
 *
 * KEY COMPONENTS:
 *    - AdministrationController, principal token and safe fault filter.
 * ============================================================================
 */
import { Body, Catch, Controller, Get, HttpCode, Inject, Param, Post, Query, UseFilters,
  type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { administrationActionRequestSchema } from '../contracts/administration.js';
import type { AuthPrincipal } from '../contracts/auth.js';
import { AuthFault } from '../auth/errors.js';
import { AdministrationService } from './administration.service.js';
import { safeAdministrationFault } from './errors.js';

export const ADMINISTRATION_PRINCIPAL = Symbol('ADMINISTRATION_PRINCIPAL');
@Catch()
class AdministrationFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent || res.writableEnded) return;
    const fault = safeAdministrationFault(error);
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (fault.code === 'RATE_LIMITED') res.setHeader('Retry-After', '60');
    res.status(fault.status).json(fault.body());
  }
}
function noQuery(query: unknown): void {
  if (!administrationActionRequestSchema.safeParse(query).success) throw new AuthFault('INVALID_REQUEST');
}
@Controller('admin/users')
@UseFilters(AdministrationFilter)
export class AdministrationController {
  constructor(@Inject(AdministrationService) private readonly service: AdministrationService,
    @Inject(ADMINISTRATION_PRINCIPAL) private readonly principal: () => AuthPrincipal | null) {}
  @Get()
  list(@Query() query: unknown) { return this.service.list(this.principal(), query); }
  @Post() @HttpCode(201)
  create(@Body() body: unknown, @Query() query: unknown) {
    noQuery(query); return this.service.create(this.principal(), body);
  }
  @Post(':userId/deactivate') @HttpCode(200)
  deactivate(@Param('userId') userId: string, @Body() body: unknown, @Query() query: unknown) {
    noQuery(query); return this.service.deactivate(this.principal(), userId, body);
  }
  @Post(':userId/reactivate') @HttpCode(200)
  reactivate(@Param('userId') userId: string, @Body() body: unknown, @Query() query: unknown) {
    noQuery(query); return this.service.reactivate(this.principal(), userId, body);
  }
  @Post(':userId/password-reset') @HttpCode(204)
  passwordReset(@Param('userId') userId: string, @Body() body: unknown, @Query() query: unknown) {
    noQuery(query); return this.service.passwordReset(this.principal(), userId, body);
  }
}
