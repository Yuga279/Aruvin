/**
 * ============================================================================
 * FILE: configure-auth-http.ts
 * LOCATION: backend/src/auth/configure-auth-http.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Guard authentication HTTP with origin, transport, body, and cache rules.
 *
 * ROLE IN PROJECT:
 *    Installs route-scoped middleware before any global parser so credential
 *    JSON is bounded, uncached, and rejected on untrusted origin or transport.
 *
 * KEY COMPONENTS:
 *    - configureAuthHttp: Exact /api/auth segment origin/transport/body checks.
 *    - Bounded JSON collector: 4 KiB, 5s, identity encoding, no-store replies.
 * ============================================================================
 */

import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { BootstrapConfig } from '../platform/config/bootstrap-config.js';
import { AuthFault } from './errors.js';
export type AuthHttpOptions = { bootstrap: BootstrapConfig; trustedHttpsIngress: (req: Request) => boolean };
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const loopbackPeers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const posts = new Set(['login', 'logout', 'password', 'forgot-password', 'reset-password']);
function fail(res: Response, code: 'INVALID_REQUEST' | 'FORBIDDEN', status?: number) {
  if (res.headersSent || res.writableEnded) return;
  const fault = new AuthFault(code); res.status(status ?? fault.status).json(fault.body());
}
function closeAfterReply(req: Request, res: Response) {
  res.setHeader('Connection', 'close');
  res.once('finish', () => {
    if (req.readableEnded) { req.socket.end(); return; }
    const timer = setTimeout(() => req.destroy(), 1000); timer.unref();
    req.once('end', () => { clearTimeout(timer); req.socket.end(); });
    req.once('close', () => clearTimeout(timer)); req.resume();
  });
}
function originAllowed(req: Request, bootstrap: BootstrapConfig) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return req.method === 'GET';
  return typeof origin === 'string' && origin !== 'null' && !origin.includes(',') && origin === bootstrap.frontendOrigin;
}
function transportAllowed(req: Request, o: AuthHttpOptions) {
  const origin = new URL(o.bootstrap.frontendOrigin);
  if (origin.protocol === 'https:') return o.trustedHttpsIngress(req) === true;
  const host = req.headers.host;
  if (typeof host !== 'string' || host.includes(',')) return false;
  try {
    return o.bootstrap.nodeEnv === 'development' && origin.protocol === 'http:' && loopbackHosts.has(origin.hostname) &&
      loopbackHosts.has(new URL(`http://${host}`).hostname) && loopbackPeers.has(req.socket.remoteAddress ?? '');
  } catch { return false; }
}
export function configureAuthHttp(app: NestExpressApplication, o: AuthHttpOptions): void {
  const parser = json({ limit: 4096, inflate: false, strict: true, type: 'application/json',
    verify: (_req, _res, bytes) => { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path.replace(/\/+$/, '').toLowerCase();
    if (path !== '/api/auth' && !path.startsWith('/api/auth/')) { next(); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const originalSet = res.setHeader.bind(res);
    res.setHeader = ((name: string, value: number | string | readonly string[]) =>
      name.toLowerCase() === 'etag' ? res : originalSet(name, value)) as typeof res.setHeader;
    res.removeHeader('ETag');
    if (!originAllowed(req, o.bootstrap) || !transportAllowed(req, o)) { fail(res, 'FORBIDDEN'); return; }
    const suffix = path.slice('/api/auth/'.length);
    if ((req.url ?? '').includes('?') || !((req.method === 'GET' && suffix === 'me') ||
        (req.method === 'POST' && posts.has(suffix)))) { fail(res, 'INVALID_REQUEST'); return; }
    if (req.method === 'GET') { next(); return; }
    const contentType = req.headers['content-type'];
    const encoding = req.headers['content-encoding'];
    const length = req.headers['content-length'];
    const validType = typeof contentType === 'string' && /^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(contentType);
    const validEncoding = encoding === undefined || encoding === 'identity';
    const validLength = length === undefined || (typeof length === 'string' && /^\d+$/.test(length) &&
      Number.isSafeInteger(Number(length)) && Number(length) > 0);
    if (!validType || !validEncoding || !validLength) {
      closeAfterReply(req, res); fail(res, 'INVALID_REQUEST'); return;
    }
    if (length !== undefined && Number(length) > 4096) {
      closeAfterReply(req, res); fail(res, 'INVALID_REQUEST', 413); return;
    }
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
      if (body === null || typeof body !== 'object' || Array.isArray(body) ||
          (suffix === 'logout' && Object.keys(body).length !== 0)) { fail(res, 'INVALID_REQUEST'); return; }
      next();
    });
  });
}
