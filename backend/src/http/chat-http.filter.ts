/**
 * ============================================================================
 * FILE: chat-http.filter.ts
 * LOCATION: backend/src/http/chat-http.filter.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Convert handler exceptions into cache-free public JSON error bodies.
 *
 * ROLE IN PROJECT:
 *    Scopes the chat HTTP error boundary to this controller so stacks,
 *    provider text, and private payloads never leave the process.
 *
 * KEY COMPONENTS:
 *    - ChatHttpFilter: Safe status/body mapping; no-op after headers.
 * ============================================================================
 */

import { Catch,type ArgumentsHost,type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { publicError } from './client-errors.js';
@Catch()
export class ChatHttpFilter implements ExceptionFilter {
  catch(error:unknown,host:ArgumentsHost):void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) { if (!res.destroyed && !res.writableEnded) res.end(); return; }
    const safe = publicError(error); res.setHeader('Cache-Control','no-store');
    res.status(safe.status).json(safe.body);
  }
}
