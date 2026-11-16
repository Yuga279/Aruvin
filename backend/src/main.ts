/**
 * ============================================================================
 * FILE: main.ts
 * LOCATION: backend/src/main.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bootstrap loopback HTTP with bounded parser ordering and graceful close.
 *
 * ROLE IN PROJECT:
 *    Loads private env only when this file is the process entry, installs
 *    operations admission before chat parsing, binds 127.0.0.1, and delegates
 *    persistence closure exclusively to the existing operations shutdown hook.
 *
 * KEY COMPONENTS:
 *    - configureApplication: CORS, auth, private admission, operations, chat HTTP.
 *    - bootstrap: Safe factory, SIGINT/SIGTERM, supervisor IPC shutdown.
 *    - Startup diagnostic: Allowlisted failure code and static operator guidance.
 * ============================================================================
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AuthenticatedWsAdapter } from './voice/transport/authenticated-ws-adapter.js';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module.js';
import { AppService } from './app.service.js';
import { APP_ERROR_CODES } from './contracts/errors.js';
import { ChatStreamTransport, configureChatHttp } from './http/index.js';
import { configureCalendarChatBoundary } from './http/calendar-boundary.js';
import { configurePrivateHttp } from './http/configure-private-http.js';
import { errorBody } from './http/client-errors.js';
import { configureAdminHttp } from './admin-config/index.js';
import { configureAuthHttp } from './auth/index.js';
import { configureAdministrationHttp } from './administration/configure-administration-http.js';
import { configureOperations } from './operations/index.js';
import { configureGoogleCalendarHttp } from './plugins/google-calendar/controller-http.js';
import { AppError } from './platform/errors/app-error.js';

export function trustedAdminHttpsIngress(req: Request): boolean {
  const peer = req.socket.remoteAddress;
  return (peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1')
    && req.headers['x-forwarded-proto'] === 'https';
}

export function configureApplication(app: NestExpressApplication): void {
  const service = app.get(AppService);
  app.useWebSocketAdapter(new AuthenticatedWsAdapter(app, service.voiceUpgrades));
  service.attachTransport(app.get(ChatStreamTransport));
  app.setGlobalPrefix('api');
  const calendar = service.bootstrap.calendar;
  const frontend = new URL(service.config.frontendOrigin);
  const localFrontend = frontend.protocol === 'http:'
    && (frontend.hostname === 'localhost' || frontend.hostname === '127.0.0.1');
  const calendarCors = Boolean(calendar) || localFrontend;
  app.enableCors({ origin: service.config.frontendOrigin, credentials: true,
    methods: calendarCors
      ? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
      : ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: calendarCors ? ['Content-Type', 'X-Aurvin-Calendar-CSRF'] : ['Content-Type'],
    exposedHeaders: ['X-Request-ID', 'Retry-After'], preflightContinue: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'OPTIONS') { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.origin !== undefined && req.headers.origin !== service.config.frontendOrigin) {
      res.status(403).end();
      return;
    }
    res.status(204).end();
  });
  configureAuthHttp(app, { bootstrap: service.bootstrap, trustedHttpsIngress: trustedAdminHttpsIngress });
  configurePrivateHttp(app, {
    auth: service.auth, identities: service.identities,
    frontendOrigin: service.config.frontendOrigin,
    secureCookie: frontend.protocol === 'https:',
    prepareOwner: principal => service.prepareOwner(principal),
  });
  configureOperations(app, service.operations);
  if (calendar) {
    configureGoogleCalendarHttp(app, {
      frontendOrigin: calendar.setup.frontendOrigin,
      backendOrigin: calendar.setup.backendOrigin,
      redirectUri: calendar.setup.oauth?.redirectUri
        ?? `${calendar.setup.backendOrigin}/api/plugins/google-calendar/oauth/callback`,
    });
    configureCalendarChatBoundary(app, {
      frontendOrigin: calendar.setup.frontendOrigin,
      backendOrigin: calendar.setup.backendOrigin,
    });
  } else if (localFrontend) {
    const backendOrigin = `http://${frontend.hostname}:${service.config.port}`;
    configureGoogleCalendarHttp(app, {
      frontendOrigin: service.config.frontendOrigin,
      backendOrigin,
      redirectUri: `${backendOrigin}/api/plugins/google-calendar/oauth/callback`,
    });
  } else {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const path = (req.path ?? '').replace(/\/+$/, '').toLowerCase();
      if (path === '/api/plugins/google-calendar' || path.startsWith('/api/plugins/google-calendar/')) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.status(503).json(errorBody('NOT_READY', false));
        return;
      }
      next();
    });
  }
  configureAdminHttp(app, { bootstrap: service.bootstrap,
    actor: () => service.adminActor(), trustedHttpsIngress: trustedAdminHttpsIngress });
  configureAdministrationHttp(app, { bootstrap: service.bootstrap,
    trustedHttpsIngress: trustedAdminHttpsIngress });
  configureChatHttp(app, service.config.budgets);
  app.use((req: Request, _res: Response, next: NextFunction) => {
    service.identities.restore(req);
    next();
  });
}

export async function bootstrap(): Promise<NestExpressApplication> {
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false, logger: false, abortOnError: false,
  });
  try {
    configureApplication(app);
    app.enableShutdownHooks(process.platform === 'win32' ? ['SIGINT'] : ['SIGINT', 'SIGTERM']);
    await app.listen(app.get(AppService).config.port, '127.0.0.1');
    process.on('message', message => {
      if (message !== 'shutdown') return;
      void app.close().then(() => { if (process.connected) process.disconnect(); }, () => {
        process.exitCode = 1;
        process.stderr.write('Aurvin shutdown could not be confirmed.\n');
        if (process.connected) process.disconnect();
      });
    });
    return app;
  } catch (error) {
    await app.close().catch(() => { process.exitCode = 1; });
    if (error instanceof AppError) throw error;
    throw new Error('Aurvin startup failed.');
  }
}

// Nest's current start:prod uses extensionless dist/main; accept that entry too.
const entry = process.argv[1] ? resolve(process.argv[1]) : null;
if (entry && (fileURLToPath(import.meta.url) === entry || fileURLToPath(import.meta.url) === `${entry}.js`)) {
  try { await bootstrap(); }
  catch (error) {
    process.exitCode = 1;
    const code = error instanceof AppError && APP_ERROR_CODES.includes(error.code)
      ? error.code : null;
    const guidance = code === 'UNSUPPORTED_TOPOLOGY'
      ? 'Executor ownership/topology refused. Verify the previous executor and its work are stopped, then follow docs/aurvin-phase-1/operations.md; do not delete the sentinel or retry takeover.'
      : 'check configuration and dependencies.';
    process.stderr.write(`Aurvin startup failed${code ? ` [${code}]` : ''}; ${guidance}\n`);
  }
}
