/**
 * ============================================================================
 * FILE: configure-admin-http.ts
 * LOCATION: backend/src/admin-config/configure-admin-http.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Guard admin configuration HTTP with origin, transport, body, and rate limits.
 *
 * ROLE IN PROJECT:
 *    Installs route-scoped middleware before chat parsers so credential JSON is
 *    bounded, uncached, and rejected on untrusted origins or plaintext remote HTTP.
 *
 * KEY COMPONENTS:
 *    - Path/origin/TLS checks: Exact browser origin and fail-closed ingress.
 *    - Bounded JSON collector: 16 KiB, 5s, identity encoding, no-store replies.
 * ============================================================================
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { MAX_ADMIN_CONFIG_BODY_BYTES } from '../contracts/admin-config-wire.js';
import type { AdminConfigActor } from '../contracts/config-runtime.js';
import type { BootstrapConfig } from '../platform/config/bootstrap-config.js';
import { AdminConfigFault } from './errors.js';

export type AdminHttpOptions = {
  bootstrap: BootstrapConfig;
  actor: () => AdminConfigActor;
  trustedHttpsIngress: (request: Request) => boolean;
  now?: () => number;
};

const BODY_DEADLINE_MS = 5_000;
const CLOSE_DRAIN_GRACE_MS = 1_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function configureAdminHttp(app: NestExpressApplication, options: AdminHttpOptions): void {
  const now = options.now ?? Date.now;
  const hits: number[] = [];
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isAdminConfigPath(req.path)) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const setHeader = res.setHeader.bind(res);
    res.setHeader = ((name: string, value: number | string | readonly string[]) => {
      if (String(name).toLowerCase() === 'etag') return res;
      return setHeader(name, value);
    }) as typeof res.setHeader;
    res.removeHeader('ETag');
    if (hasQuery(req)) {
      sendFault(res, new AdminConfigFault('INVALID_CONFIG_REQUEST'));
      return;
    }
    if (!originAllowed(req, options.bootstrap)) {
      sendFault(res, new AdminConfigFault('INVALID_ADMIN_ORIGIN'));
      return;
    }
    if (!transportAllowed(req, options.bootstrap, options.trustedHttpsIngress)) {
      sendFault(res, new AdminConfigFault('ADMIN_TRANSPORT_REQUIRED'));
      return;
    }
    const instant = now();
    while (hits.length > 0 && instant - hits[0]! >= RATE_WINDOW_MS) hits.shift();
    if (hits.length >= RATE_LIMIT) {
      sendFault(res, new AdminConfigFault('ADMIN_RATE_LIMITED'));
      return;
    }
    hits.push(instant);
    const method = req.method.toUpperCase();
    if (method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (method !== 'GET' && method !== 'PUT' && method !== 'POST') {
      sendFault(res, new AdminConfigFault('INVALID_CONFIG_REQUEST'));
      return;
    }
    if (method === 'GET') {
      next();
      return;
    }
    collectJson(req, res, next);
  });
}

function isAdminConfigPath(path: string): boolean {
  const normalized = path.replace(/\/+$/, '').toLowerCase();
  return normalized === '/api/admin/config' || normalized.startsWith('/api/admin/config/');
}

function hasQuery(req: Request): boolean {
  const url = req.url ?? '';
  return url.includes('?');
}

function originAllowed(req: Request, bootstrap: BootstrapConfig): boolean {
  const raw = req.headers.origin;
  const mutation = req.method.toUpperCase() !== 'GET';
  if (raw === undefined) {
    if (mutation) return false;
    return req.headers['sec-fetch-site'] !== 'cross-site';
  }
  if (Array.isArray(raw) || raw === 'null' || raw.includes(',')) return false;
  return raw === bootstrap.frontendOrigin;
}

function transportAllowed(
  req: Request,
  bootstrap: BootstrapConfig,
  trustedHttpsIngress: (request: Request) => boolean,
): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(bootstrap.frontendOrigin);
  } catch {
    return false;
  }
  const hostHeader = req.headers.host;
  if (typeof hostHeader !== 'string' || hostHeader.includes(',')) return false;
  let backendHost: string;
  try {
    backendHost = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return false;
  }
  const peer = req.socket?.remoteAddress;
  const developmentHttp = bootstrap.nodeEnv === 'development'
    && originUrl.protocol === 'http:'
    && LOOPBACK_HOSTS.has(originUrl.hostname)
    && LOOPBACK_HOSTS.has(backendHost)
    && isLoopbackPeer(peer);
  if (developmentHttp) return true;
  return originUrl.protocol === 'https:' && trustedHttpsIngress(req) === true;
}

function isLoopbackPeer(address: string | undefined): boolean {
  if (address === undefined) return false;
  return address === '127.0.0.1'
    || address === '::1'
    || address === 'localhost'
    || address === '::ffff:127.0.0.1';
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const media = value.split(';', 1)[0]?.trim().toLowerCase();
  if (media !== 'application/json') return false;
  const charset = /charset\s*=\s*([^;]+)/i.exec(value)?.[1]?.trim().toLowerCase();
  return charset === undefined || charset === '' || charset === 'utf-8';
}

function collectJson(req: Request, res: Response, next: NextFunction): void {
  const encoding = headerValue(req.headers['content-encoding']);
  if (encoding !== undefined && encoding.toLowerCase() !== 'identity') {
    sendFault(res, new AdminConfigFault('INVALID_CONFIG_REQUEST'));
    close(req, res);
    return;
  }
  if (!isJsonContentType(headerValue(req.headers['content-type']))) {
    sendFault(res, new AdminConfigFault('INVALID_CONFIG_REQUEST'));
    close(req, res);
    return;
  }
  const lengthHeader = req.headers['content-length'];
  if (Array.isArray(lengthHeader) || (typeof lengthHeader === 'string' && lengthHeader.includes(','))) {
    sendFault(res, new AdminConfigFault('INVALID_CONFIG_REQUEST'));
    close(req, res);
    return;
  }
  if (typeof lengthHeader === 'string') {
    const length = Number(lengthHeader);
    if (!Number.isSafeInteger(length) || length <= 0) {
      sendFault(res, new AdminConfigFault('INVALID_CONFIG_REQUEST'));
      close(req, res);
      return;
    }
    if (length > MAX_ADMIN_CONFIG_BODY_BYTES) {
      sendFault(res, new AdminConfigFault('INVALID_CONFIG_REQUEST'), 413);
      close(req, res);
      return;
    }
  }
  const chunks: Buffer[] = [];
  let total = 0;
  let finished = false;
  const timer = setTimeout(() => finish(new AdminConfigFault('INVALID_CONFIG_REQUEST')), BODY_DEADLINE_MS);

  function cleanup(): void {
    clearTimeout(timer);
    req.off('data', onData);
    req.off('end', onEnd);
    req.off('aborted', onAborted);
    req.off('error', onAborted);
  }

  function finish(error?: AdminConfigFault, status?: number): void {
    if (finished) return;
    finished = true;
    cleanup();
    if (error) {
      sendFault(res, error, status);
      close(req, res);
    }
  }

  function onData(chunk: Buffer): void {
    total += chunk.length;
    if (total > MAX_ADMIN_CONFIG_BODY_BYTES) {
      finish(new AdminConfigFault('INVALID_CONFIG_REQUEST'), 413);
      return;
    }
    chunks.push(chunk);
  }

  function onEnd(): void {
    if (finished) return;
    finished = true;
    cleanup();
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      const json: unknown = JSON.parse(text);
      if (json === null || typeof json !== 'object' || Array.isArray(json) || Object.keys(json as object).length === 0) {
        sendFault(res, new AdminConfigFault('INVALID_CONFIG_REQUEST'));
        return;
      }
      (req as Request & { body: unknown }).body = json;
      next();
    } catch {
      sendFault(res, new AdminConfigFault('INVALID_CONFIG_REQUEST'));
    }
  }

  function onAborted(): void {
    finish(new AdminConfigFault('INVALID_CONFIG_REQUEST'));
  }

  req.on('data', onData);
  req.on('end', onEnd);
  req.on('aborted', onAborted);
  req.on('error', onAborted);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return undefined;
  return value;
}

function sendFault(res: Response, fault: AdminConfigFault, status = fault.status): void {
  if (res.headersSent || res.writableEnded) return;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (fault.code === 'ADMIN_RATE_LIMITED') res.setHeader('Retry-After', '60');
  res.status(status).json(fault.body());
}

/**
 * Tear the request down after the fault response has been flushed.
 *
 * The socket must not die before the reply is on the wire: destroying it while
 * the rejected body is still unread resets the connection and the client reads
 * ECONNRESET instead of the fault it was promised. The unread body is drained
 * first so the close is a clean FIN; a client that keeps streaming past the
 * grace period is torn down.
 */
function close(req: IncomingMessage, res: ServerResponse): void {
  let closed = false;
  const teardown = (): void => {
    if (closed) return;
    closed = true;
    req.destroy();
  };
  const finish = (): void => {
    if (closed) return;
    closed = true;
    req.socket?.end();
  };
  const drain = (): void => {
    if (req.readableEnded || req.destroyed) { finish(); return; }
    const timer = setTimeout(teardown, CLOSE_DRAIN_GRACE_MS);
    timer.unref?.();
    const drained = (): void => {
      clearTimeout(timer);
      if (req.readableEnded) finish(); else teardown();
    };
    req.once('end', drained);
    req.once('close', drained);
    req.resume();
  };
  if (res.writableFinished) { drain(); return; }
  res.once('finish', drain);
  if (!res.writableEnded) res.end(drain);
}
