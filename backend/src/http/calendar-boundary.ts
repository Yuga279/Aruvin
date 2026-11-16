import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { errorBody } from './client-errors.js';

export type CalendarChatBoundary = Readonly<{
  frontendOrigin: string;
  backendOrigin: string;
}>;

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

function normalizePath(path: string): string {
  return path.replace(/\/+$/, '').toLowerCase();
}

export function isCalendarChatPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === '/api/sessions' || normalized.startsWith('/api/sessions/');
}

function jsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const media = value.split(';', 1)[0]?.trim().toLowerCase();
  if (media !== 'application/json') return false;
  const charset = /charset\s*=\s*([^;]+)/i.exec(value)?.[1]?.trim().toLowerCase();
  return charset === undefined || charset === '' || charset === 'utf-8';
}

function reject(res: Response): void {
  if (res.headersSent || res.writableEnded) return;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(403).json(errorBody('INVALID_REQUEST', false));
}

function allowedFor(path: string): { methods: string; headers: string } {
  const normalized = normalizePath(path);
  if (normalized.endsWith('/stream')) return { methods: 'GET, OPTIONS', headers: 'Content-Type' };
  if (/\/turns\/[^/]+$/.test(normalized)) return { methods: 'GET, OPTIONS', headers: 'Content-Type' };
  if (normalized.endsWith('/retry') || normalized.endsWith('/cancel') || normalized.endsWith('/turns')) {
    return { methods: 'POST, OPTIONS', headers: 'Content-Type' };
  }
  if (normalized === '/api/sessions') return { methods: 'GET, POST, OPTIONS', headers: 'Content-Type' };
  return { methods: 'GET, POST, PATCH, DELETE, OPTIONS', headers: 'Content-Type' };
}

export function configureCalendarChatBoundary(
  app: NestExpressApplication,
  boundary: CalendarChatBoundary,
): void {
  const backendHost = new URL(boundary.backendOrigin).host;
  const frontendOrigin = boundary.frontendOrigin;

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isCalendarChatPath(req.path)) {
      next();
      return;
    }

    const hosts = headerValues(req.rawHeaders, 'host');
    if (hosts.length !== 1 || hosts[0] !== backendHost) {
      reject(res);
      return;
    }
    if (!loopbackPeer(req.socket?.remoteAddress)) {
      reject(res);
      return;
    }

    const origins = headerValues(req.rawHeaders, 'origin');
    const exactOrigin = origins.length === 1 && origins[0] === frontendOrigin;
    const fetchSite = headerValues(req.rawHeaders, 'sec-fetch-site');
    const fetchMode = headerValues(req.rawHeaders, 'sec-fetch-mode');
    const fetchDest = headerValues(req.rawHeaders, 'sec-fetch-dest');
    const browserFetch = origins.length === 0
      && fetchSite.length === 1 && fetchSite[0] === 'same-origin'
      && fetchMode.length === 1
      && (fetchMode[0] === 'cors' || fetchMode[0] === 'same-origin')
      && fetchDest.length === 1 && fetchDest[0] === 'empty';

    const method = req.method.toUpperCase();
    if (method === 'OPTIONS') {
      if (!exactOrigin) {
        reject(res);
        return;
      }
      const allowed = allowedFor(req.path);
      res.setHeader('Access-Control-Allow-Origin', frontendOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', allowed.methods);
      res.setHeader('Access-Control-Allow-Headers', allowed.headers);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(204).end();
      return;
    }

    const mutation = method === 'POST' || method === 'PATCH' || method === 'DELETE';
    if (mutation) {
      if (!exactOrigin) {
        reject(res);
        return;
      }
      if (method === 'POST' || method === 'PATCH') {
        const encoding = headerValues(req.rawHeaders, 'content-encoding');
        if (encoding.length > 1 || (encoding[0] && encoding[0].toLowerCase() !== 'identity')) {
          reject(res);
          return;
        }
        const types = headerValues(req.rawHeaders, 'content-type');
        if (types.length !== 1 || !jsonContentType(types[0])) {
          reject(res);
          return;
        }
      }
      next();
      return;
    }

    if (method === 'GET') {
      if (origins.length > 0 && !exactOrigin) {
        reject(res);
        return;
      }
      if (!exactOrigin && !browserFetch) {
        reject(res);
        return;
      }
      next();
      return;
    }

    reject(res);
  });
}
