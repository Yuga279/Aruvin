/**
 * ============================================================================
 * FILE: configure-chat-http.ts
 * LOCATION: backend/src/http/configure-chat-http.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Install bounded JSON parsing and client-safe parser error responses.
 *
 * ROLE IN PROJECT:
 *    P9 calls this before init/listen so oversized and malformed bodies never
 *    reach controllers and never expose parser exception text.
 *
 * KEY COMPONENTS:
 *    - Security/cache headers: no-store and nosniff on every response.
 *    - JSON body parser: UTF-8-aware cap derived from input budgets.
 *    - Parser errors: INPUT_TOO_LARGE and INVALID_REQUEST without stacks.
 * ============================================================================
 */

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request,Response,NextFunction } from 'express';
import type { BudgetConfig } from '../contracts/budgets.js';
import { errorBody } from './client-errors.js';
export function configureChatHttp(app:NestExpressApplication,_budgets?:BudgetConfig):void {
  app.use((_req:Request,res:Response,next:NextFunction) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); next();
  });
  // JSON can escape one UTF-16 code unit as six ASCII bytes. Fixed envelope reserve.
  const limit = Math.min(262144, 32000 * 6 + 4096);
  app.useBodyParser('json',{ limit,strict:true });
  app.use((error:unknown,_req:Request,res:Response,next:NextFunction) => {
    const fault = error && typeof error === 'object' ? error as { type?:unknown; status?:unknown } : null;
    if (fault?.type === 'entity.too.large') { res.status(413).json(errorBody('INPUT_TOO_LARGE')); return; }
    if (fault?.type === 'entity.parse.failed' || fault?.status === 400) { res.status(400).json(errorBody('INVALID_REQUEST')); return; }
    next(error);
  });
}
