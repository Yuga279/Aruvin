/**
 * ============================================================================
 * FILE: app.controller.ts
 * LOCATION: backend/src/app.controller.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Preserve scaffold greeting and legacy health routes under /api.
 *
 * ROLE IN PROJECT:
 *    Keeps /api and /api/health coherent after assembly without competing with
 *    operations readiness. Explicit injection avoids relying on emitted
 *    constructor metadata in Vitest.
 *
 * KEY COMPONENTS:
 *    - GET /: Greeting string from AppService.
 *    - GET /health: Legacy liveness-only payload.
 * ============================================================================
 */

import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(@Inject(AppService) private readonly appService: AppService) {}
  @Get()
  getHello(): string { return this.appService.getHello(); }
  @Get('health')
  getHealth(): { status: string } { return this.appService.getHealth(); }
}
