/**
 * ============================================================================
 * FILE: configure-operations.ts
 * LOCATION: backend/src/operations/configure-operations.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Install early request IDs, rate/readiness admission, and safe 429/503 bodies.
 *
 * ROLE IN PROJECT:
 *    P9 calls this before chat HTTP parsing so generation traffic cannot bypass
 *    the shared-identity budget or provider gate, including path aliases.
 *
 * KEY COMPONENTS:
 *    - configureOperations: Server UUID, no-store, generation vs control windows.
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request,Response,NextFunction } from 'express';
import { AppError } from '../platform/errors/app-error.js';
import { ERROR_HTTP_STATUS } from '../contracts/errors.js';
import { errorBody } from '../http/client-errors.js';
import { OperationsService } from './operations.service.js';
export function configureOperations(app:NestExpressApplication,ops:OperationsService) {
  app.use((req:Request,res:Response,next:NextFunction) => {
    const id=randomUUID(); res.setHeader('X-Request-ID',id); res.setHeader('Cache-Control','no-store');
    const started=performance.now();
    res.once('finish',() => { ops.telemetry.measure('request',performance.now()-started); });
    ops.telemetry.inRequest(id,() => {
      void (async () => {
        // Match pathname only; never log originalUrl/query/body/headers.
        // Express accepts trailing slash and case-insensitive resource paths by
        // default; classify those aliases identically rather than letting them
        // bypass the generation budget/provider gate.
        const path=req.path.replace(/\/+$/,'').toLowerCase();
        const retryPost=req.method === 'POST' && /^\/api\/sessions\/[^/]+\/turns\/[^/]+\/retry$/.test(path);
        const streamGet=req.method === 'GET' && /^\/api\/sessions\/[^/]+\/turns\/[^/]+\/stream$/.test(path);
        if (streamGet && typeof res.flushHeaders === 'function') {
          let headerMeasured = false;
          const origFlush = res.flushHeaders.bind(res);
          res.flushHeaders = () => {
            if (!headerMeasured) {
              headerMeasured = true;
              const elapsed = performance.now() - started;
              ops.telemetry.measure('stream_header', elapsed);
              ops.telemetry.event('process', { stage: 'stream-header', state: 'ok', durationMs: elapsed, origin: 'local', delivery: 'not-sent' });
            }
            origFlush();
          };
        }
        const generation=(req.method === 'POST' && (path === '/api/sessions' ||
          /^\/api\/sessions\/[^/]+\/turns$/.test(path) || retryPost)) || streamGet;
        try {
          ops.admission.take(generation ? 'generation' : 'control',performance.now());
          // ponytail: explicit retries and their streams bypass only the transient
          // 30s degraded gate; new-turn POSTs stay cooled, auth/credit blocks and
          // config/DB/executor/drain gates still reject, and rate/concurrency plus
          // P5's 3-retry cap bound recovery discovery (provider re-cools on failure).
          if (retryPost || streamGet) await ops.acceptForRetry();
          else if (generation) await ops.accept();
          ops.telemetry.event('request',{ ok:true });
          if (streamGet) ops.telemetry.inDatabasePhase('attachment','other',() => next());
          else next();
        } catch (error) {
          const code=error instanceof AppError ? error.code : 'NOT_READY';
          ops.telemetry.measure(code === 'RATE_LIMITED' ? 'rate_rejected' : 'overload_rejected');
          ops.telemetry.event('request',{ code,ok:false });
          if (code === 'RATE_LIMITED') res.setHeader('Retry-After','60');
          if (!res.destroyed) res.status(ERROR_HTTP_STATUS[code]).json(errorBody(code));
        }
      })();
    });
  });
}
