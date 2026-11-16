import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../platform/errors/app-error.js';
import type { AppErrorCode } from '../../contracts/errors.js';
import { scanJsonObject } from '../../model/strict-json.js';

export type CalendarHttpBoundary = Readonly<{
  frontendOrigin: string; backendOrigin: string; redirectUri: string; now?: () => number;
}>;

const BODY_CAP = 16 * 1024;
const BODY_DEADLINE_MS = 5_000;
const CLOSE_DRAIN_GRACE_MS = 1_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const CSRF_HEADER = 'x-aurvin-calendar-csrf';
const CSRF_VALUE = '1';

const MESSAGES: Record<string, string> = {
  INVALID_REQUEST: 'The request is invalid.',
  INPUT_TOO_LARGE: 'The request is too large.',
  RATE_LIMITED: 'Too many requests. Try again shortly.',
  NOT_READY: 'Calendar setup is not ready.',
  PERSISTENCE_ERROR: 'The save could not be confirmed.',
  TIMEOUT: 'Calendar setup timed out.',
};

function isCalendarPath(path: string): boolean {
  const normalized = path.replace(/\/+$/, '').toLowerCase();
  return normalized === '/api/plugins/google-calendar'
    || normalized.startsWith('/api/plugins/google-calendar/');
}

function isCallbackPath(path: string): boolean {
  return path.replace(/\/+$/, '').toLowerCase() === '/api/plugins/google-calendar/oauth/callback';
}

function isStatusPath(path: string): boolean {
  return path.replace(/\/+$/, '').toLowerCase() === '/api/plugins/google-calendar/status';
}

function isCalendarsPath(path: string): boolean {
  return path.replace(/\/+$/, '').toLowerCase() === '/api/plugins/google-calendar/calendars';
}

function headerValues(raw: string[] | undefined, name: string): string[] {
  if (!raw) return [];
  const values: string[] = [];
  const needle = name.toLowerCase();
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i]!.toLowerCase() === needle) values.push(raw[i + 1] ?? '');
  }
  return values;
}

function loopbackPeer(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function sendFault(res: Response, code: AppErrorCode, status?: number): void {
  if (res.headersSent || res.writableEnded) return;
  const error = new AppError(code, MESSAGES[code] ?? 'The request is invalid.', false);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (code === 'RATE_LIMITED') res.setHeader('Retry-After', '60');
  res.status(status ?? error.httpStatus).json(error.toClientBody());
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

function jsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const media = value.split(';', 1)[0]?.trim().toLowerCase();
  if (media !== 'application/json') return false;
  const charset = /charset\s*=\s*([^;]+)/i.exec(value)?.[1]?.trim().toLowerCase();
  return charset === undefined || charset === '' || charset === 'utf-8';
}

export function configureGoogleCalendarHttp(
  app: NestExpressApplication,
  boundary: CalendarHttpBoundary,
): void {
  const now = boundary.now ?? Date.now;
  const hits: number[] = [];
  const backendHost = new URL(boundary.backendOrigin).host;
  const frontendOrigin = boundary.frontendOrigin;

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isCalendarPath(req.path)) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const setHeader = res.setHeader.bind(res);
    res.setHeader = ((name: string, value: number | string | readonly string[]) => {
      if (String(name).toLowerCase() === 'etag') return res;
      return setHeader(name, value);
    }) as typeof res.setHeader;
    res.removeHeader('ETag');

    const hosts = headerValues(req.rawHeaders, 'host');
    if (hosts.length !== 1 || hosts[0] !== backendHost) {
      sendFault(res, 'INVALID_REQUEST', 403);
      return;
    }
    if (!loopbackPeer(req.socket?.remoteAddress)) {
      sendFault(res, 'INVALID_REQUEST', 403);
      return;
    }

    const method = req.method.toUpperCase();
    const callback = isCallbackPath(req.path);
    const status = isStatusPath(req.path);
    const calendars = isCalendarsPath(req.path);
    const origins = headerValues(req.rawHeaders, 'origin');
    const origin = origins.length === 1 ? origins[0] : undefined;

    if (method === 'OPTIONS') {
      if (origin !== frontendOrigin) {
        sendFault(res, 'INVALID_REQUEST', 403);
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', frontendOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Aurvin-Calendar-CSRF');
      res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, POST');
      res.status(204).end();
      return;
    }

    if (callback) {
      if (origins.length > 1 || (origin !== undefined && origin !== frontendOrigin)) {
        sendFault(res, 'INVALID_REQUEST', 403);
        return;
      }
      if (method !== 'GET') {
        sendFault(res, 'INVALID_REQUEST');
        return;
      }
      next();
      return;
    }

    if ((req.url ?? '').includes('?') && !(calendars && method === 'GET')) {
      sendFault(res, 'INVALID_REQUEST');
      return;
    }

    if (status && method === 'GET') {
      const fetchSite = headerValues(req.rawHeaders, 'sec-fetch-site');
      if (origin !== undefined && origin !== frontendOrigin) {
        sendFault(res, 'INVALID_REQUEST', 403);
        return;
      }
      if (origin === undefined && fetchSite[0] === 'cross-site') {
        sendFault(res, 'INVALID_REQUEST', 403);
        return;
      }
    } else if (calendars && method === 'GET') {
      const fetchSite = headerValues(req.rawHeaders, 'sec-fetch-site');
      if (origins.length > 1 || (origin !== frontendOrigin && !(origin === undefined && fetchSite.length === 1 && fetchSite[0] === 'same-origin'))) {
        sendFault(res, 'INVALID_REQUEST', 403);
        return;
      }
    } else if (origin !== frontendOrigin || origins.length !== 1) {
      sendFault(res, 'INVALID_REQUEST', 403);
      return;
    }

    const instant = now();
    while (hits.length > 0 && instant - hits[0]! >= RATE_WINDOW_MS) hits.shift();
    if (hits.length >= RATE_LIMIT) {
      sendFault(res, 'RATE_LIMITED');
      return;
    }
    hits.push(instant);

    const mutation = method === 'POST' || method === 'PATCH';
    if (mutation) {
      const csrf = headerValues(req.rawHeaders, CSRF_HEADER);
      if (csrf.length !== 1 || csrf[0] !== CSRF_VALUE) {
        sendFault(res, 'INVALID_REQUEST', 403);
        return;
      }
      collectJson(req, res, next);
      return;
    }
    if (method === 'GET' && (status || calendars)) {
      next();
      return;
    }
    sendFault(res, 'INVALID_REQUEST');
  });
}

function collectJson(req: Request, res: Response, next: NextFunction): void {
  if (req.body !== undefined) {
    sendFault(res, 'INVALID_REQUEST');
    return;
  }
  const encoding = headerValues(req.rawHeaders, 'content-encoding');
  if (encoding.length > 1 || (encoding[0] && encoding[0].toLowerCase() !== 'identity')) {
    sendFault(res, 'INVALID_REQUEST');
    close(req, res);
    return;
  }
  const types = headerValues(req.rawHeaders, 'content-type');
  if (types.length !== 1 || !jsonContentType(types[0])) {
    sendFault(res, 'INVALID_REQUEST');
    close(req, res);
    return;
  }
  const lengths = headerValues(req.rawHeaders, 'content-length');
  if (lengths.length > 1) {
    sendFault(res, 'INVALID_REQUEST');
    close(req, res);
    return;
  }
  if (lengths[0] !== undefined) {
    const length = Number(lengths[0]);
    if (!Number.isSafeInteger(length) || length < 0) {
      sendFault(res, 'INVALID_REQUEST');
      close(req, res);
      return;
    }
    if (length > BODY_CAP) {
      sendFault(res, 'INPUT_TOO_LARGE', 413);
      close(req, res);
      return;
    }
  }
  const chunks: Buffer[] = [];
  let total = 0;
  let finished = false;
  const timer = setTimeout(() => finish(new AppError('TIMEOUT', MESSAGES.TIMEOUT, false)), BODY_DEADLINE_MS);

  function cleanup(): void {
    clearTimeout(timer);
    req.off('data', onData);
    req.off('end', onEnd);
    req.off('aborted', onAborted);
    req.off('error', onAborted);
  }

  function finish(error?: AppError, status?: number): void {
    if (finished) return;
    finished = true;
    cleanup();
    if (error) {
      sendFault(res, error.code, status);
      close(req, res);
    }
  }

  function onData(chunk: Buffer): void {
    total += chunk.length;
    if (total > BODY_CAP) {
      finish(new AppError('INPUT_TOO_LARGE', MESSAGES.INPUT_TOO_LARGE, false), 413);
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
      const scan = scanJsonObject(text);
      if (scan.code !== null) {
        sendFault(res, 'INVALID_REQUEST');
        return;
      }
      const json: unknown = JSON.parse(text);
      if (json === null || typeof json !== 'object' || Array.isArray(json)) {
        sendFault(res, 'INVALID_REQUEST');
        return;
      }
      (req as Request & { body: unknown }).body = json;
      next();
    } catch {
      sendFault(res, 'INVALID_REQUEST');
    }
  }

  function onAborted(): void {
    finish(new AppError('INVALID_REQUEST', MESSAGES.INVALID_REQUEST, false));
  }

  req.on('data', onData);
  req.on('end', onEnd);
  req.on('aborted', onAborted);
  req.on('error', onAborted);
}
