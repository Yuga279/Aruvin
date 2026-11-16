/**
 * ============================================================================
 * FILE: configure-administration-http.ts
 * LOCATION: backend/src/administration/configure-administration-http.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bound Administration credential ingress with existing HTTP policy.
 *
 * ROLE IN PROJECT:
 *    Installed by P3 before global parsers without installing global auth.
 *    Matches the existing same-origin credential handling policy.
 *
 * KEY COMPONENTS:
 *    - Exact origin/TLS, 4-KiB/5s JSON collector and no-store replies.
 * ============================================================================
 */
import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { BootstrapConfig } from '../platform/config/bootstrap-config.js';
import { AuthFault } from '../auth/errors.js';

export type AdministrationHttpOptions = {
  bootstrap: BootstrapConfig; trustedHttpsIngress: (req: Request) => boolean;
};
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const loopbackPeers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function fail(res: Response, code: 'INVALID_REQUEST' | 'FORBIDDEN', status?: number): void {
  if (res.headersSent || res.writableEnded) return;
  const fault = new AuthFault(code); res.status(status ?? fault.status).json(fault.body());
}
function closeAfterReply(req: Request, res: Response): void {
  res.setHeader('Connection', 'close');
  res.once('finish', () => {
    if (req.readableEnded) { req.socket.end(); return; }
    const timer = setTimeout(() => req.destroy(), 1000); timer.unref();
    req.once('end', () => { clearTimeout(timer); req.socket.end(); });
    req.once('close', () => clearTimeout(timer)); req.resume();
  });
}
function originAllowed(req: Request, bootstrap: BootstrapConfig): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return req.method === 'GET';
  return typeof origin === 'string' && origin !== 'null' && !origin.includes(',') && origin === bootstrap.frontendOrigin;
}
function transportAllowed(req: Request, options: AdministrationHttpOptions): boolean {
  const origin = new URL(options.bootstrap.frontendOrigin);
  if (origin.protocol === 'https:') return options.trustedHttpsIngress(req) === true;
  const host = req.headers.host;
  if (typeof host !== 'string' || host.includes(',')) return false;
  try {
    return options.bootstrap.nodeEnv === 'development' && origin.protocol === 'http:' && loopbackHosts.has(origin.hostname) &&
      loopbackHosts.has(new URL(`http://${host}`).hostname) && loopbackPeers.has(req.socket.remoteAddress ?? '');
  } catch { return false; }
}
export function configureAdministrationHttp(app: NestExpressApplication, options: AdministrationHttpOptions): void {
  const parser = json({ limit: 4096, inflate: false, strict: true, type: 'application/json',
    verify: (_req, _res, bytes) => { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path.replace(/\/+$/, '').toLowerCase();
    if (path !== '/api/admin/users' && !path.startsWith('/api/admin/users/')) { next(); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const setHeader = res.setHeader.bind(res);
    res.setHeader = ((name: string, value: number | string | readonly string[]) =>
      name.toLowerCase() === 'etag' ? res : setHeader(name, value)) as typeof res.setHeader;
    res.removeHeader('ETag');
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    if (!originAllowed(req, options.bootstrap) || !transportAllowed(req, options)) { fail(res, 'FORBIDDEN'); return; }
    const collection = path === '/api/admin/users';
    const action = /^\/api\/admin\/users\/[^/]+\/(deactivate|reactivate|password-reset)$/.test(path);
    if (!((req.method === 'GET' && collection) || (req.method === 'POST' && (collection || action))) ||
        (req.method !== 'GET' && (req.url ?? '').includes('?'))) { fail(res, 'INVALID_REQUEST'); return; }
    if (req.method === 'GET') { next(); return; }
    const contentType = req.headers['content-type']; const encoding = req.headers['content-encoding'];
    const length = req.headers['content-length'];
    const validType = typeof contentType === 'string' && /^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(contentType);
    const validLength = length === undefined || (typeof length === 'string' && /^\d+$/.test(length) &&
      Number.isSafeInteger(Number(length)) && Number(length) > 0);
    if (!validType || (encoding !== undefined && encoding !== 'identity') || !validLength) {
      closeAfterReply(req, res); fail(res, 'INVALID_REQUEST'); return;
    }
    if (length !== undefined && Number(length) > 4096) { closeAfterReply(req, res); fail(res, 'INVALID_REQUEST', 413); return; }
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return; finished = true; closeAfterReply(req, res); fail(res, 'INVALID_REQUEST', 408);
    }, 5000);
    const cleanup = () => { clearTimeout(timer); req.off('aborted', cleanup); res.off('finish', cleanup); res.off('close', cleanup); };
    req.once('aborted', cleanup); res.once('finish', cleanup); res.once('close', cleanup);
    parser(req, res, (error?: unknown) => {
      cleanup(); if (finished || req.aborted || res.writableEnded) return; finished = true;
      if (error) {
        const type = error !== null && typeof error === 'object' && 'type' in error ? String(error.type) : '';
        closeAfterReply(req, res); fail(res, 'INVALID_REQUEST', type === 'entity.too.large' ? 413 : 400); return;
      }
      const body: unknown = req.body;
      if (body === null || typeof body !== 'object' || Array.isArray(body)) { fail(res, 'INVALID_REQUEST'); return; }
      next();
    });
  });
}
