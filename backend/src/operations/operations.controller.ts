/**
 * ============================================================================
 * FILE: operations.controller.ts
 * LOCATION: backend/src/operations/operations.controller.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Expose liveness, readiness, and finite metrics under the /operations path.
 *
 * ROLE IN PROJECT:
 *    Gives P9 /api health routes that report process reachability separately
 *    from accept-ready work without leaking configuration or credentials.
 *
 * KEY COMPONENTS:
 *    - live/ready/metrics: Static liveness, 200/503 readiness, aggregate cells.
 * ============================================================================
 */

import { Controller,Get,Inject,Res } from '@nestjs/common';
import type { Response } from 'express';
import { OperationsService } from './operations.service.js';
@Controller('operations')
export class OperationsController {
  constructor(@Inject(OperationsService) private ops:OperationsService) {}
  @Get('live') live() { return { live:true }; }
  @Get('ready') async ready(@Res() response:Response) {
    const status=await this.ops.readiness.read(); response.status(status.acceptReady ? 200 : 503).json(status);
  }
  @Get('metrics') metrics() { return this.ops.metrics(); }
}
