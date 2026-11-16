/**
 * ============================================================================
 * FILE: controller.ts
 * LOCATION: backend/src/plugins/google-calendar/controller.ts
 * ============================================================================
 *
 * PURPOSE:
 *    NestJS HTTP controller for Google Calendar setup, discovery, and OAuth routes.
 *
 * ROLE IN PROJECT:
 *    Exposes /status, /settings, /oauth/start, /oauth/callback, /disconnect,
 *    /calendars, and /calendars/refresh endpoints with strict input validation
 *    and unified error filtering.
 *
 * KEY COMPONENTS:
 *    - GoogleCalendarController: Central endpoint controller
 *    - GoogleCalendarFilter: Safe public error mapping exception filter
 * ============================================================================
 */

import {
  Body,
  Catch,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  UseFilters,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import {
  calendarCalendarsQuerySchema,
  calendarCalendarsResponseSchema,
  calendarDisconnectRequestSchema,
  calendarOAuthStartRequestSchema,
  calendarOAuthStartResponseSchema,
  calendarRefreshRequestSchema,
  calendarSettingsV2RequestSchema,
} from '../../contracts/calendar-wire.js';
import type { AuthPrincipal } from '../../contracts/auth.js';
import { AppError } from '../../platform/errors/app-error.js';
import { GoogleCalendarConnections } from './connection.js';
import { clearOAuthCookie, oauthCookie, GoogleCalendarOAuthService } from './oauth.js';
import { CalendarToolFault } from './tools-validation.js';
import { oauthCallbackCsp, oauthCallbackPage } from './oauth-callback-page.js';

export const GOOGLE_CALENDAR_CONNECTIONS = Symbol('GOOGLE_CALENDAR_CONNECTIONS');
export const GOOGLE_CALENDAR_OAUTH = Symbol('GOOGLE_CALENDAR_OAUTH');
export const GOOGLE_CALENDAR_PRINCIPAL = Symbol('GOOGLE_CALENDAR_PRINCIPAL');

const SAFE: Record<string, { code: AppError['code']; status: number; message: string }> = {
  INVALID_REQUEST: { code: 'INVALID_REQUEST', status: 400, message: 'The request is invalid.' },
  INPUT_TOO_LARGE: { code: 'INPUT_TOO_LARGE', status: 413, message: 'The request is too large.' },
  RATE_LIMITED: { code: 'RATE_LIMITED', status: 429, message: 'Too many requests. Try again shortly.' },
  NOT_READY: { code: 'NOT_READY', status: 503, message: 'Calendar setup is not ready.' },
  PERSISTENCE_ERROR: { code: 'PERSISTENCE_ERROR', status: 503, message: 'The save could not be confirmed.' },
  TIMEOUT: { code: 'TIMEOUT', status: 504, message: 'Calendar setup timed out.' },
  CONFLICT_ACTIVE_TURN: { code: 'CONFLICT_ACTIVE_TURN', status: 409, message: 'Another Calendar setup change is already in progress.' },
};

@Catch()
class GoogleCalendarFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      if (!res.destroyed && !res.writableEnded) res.end();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (error instanceof ZodError) {
      res.status(400).json(new AppError('INVALID_REQUEST', SAFE.INVALID_REQUEST!.message, false).toClientBody());
      return;
    }
    if (error instanceof AppError && SAFE[error.code]) {
      const mapped = SAFE[error.code]!;
      res.status(mapped.status).json(new AppError(mapped.code, mapped.message, false).toClientBody());
      return;
    }
    if (error instanceof CalendarToolFault) {
      const code = error.failure.code;
      if (code === 'CALENDAR_SETTINGS_CONFLICT') {
        res.status(409).json(new AppError('CONFLICT_ACTIVE_TURN', SAFE.CONFLICT_ACTIVE_TURN!.message, false).toClientBody());
        return;
      }
      if (code === 'CALENDAR_REQUEST_BUDGET' || code === 'CALENDAR_REFRESH_BUDGET') {
        res.status(429).json(new AppError('RATE_LIMITED', SAFE.RATE_LIMITED!.message, false).toClientBody());
        return;
      }
      if (code === 'CALENDAR_DEADLINE_EXCEEDED') {
        res.status(504).json(new AppError('TIMEOUT', SAFE.TIMEOUT!.message, false).toClientBody());
        return;
      }
      if (code === 'RECONNECT_REQUIRED' || code === 'CALENDAR_RECONNECT_REQUIRED' || code === 'CALENDAR_SETUP_STALE') {
        res.status(503).json(new AppError('NOT_READY', SAFE.NOT_READY!.message, false).toClientBody());
        return;
      }
      res.status(400).json(new AppError('INVALID_REQUEST', SAFE.INVALID_REQUEST!.message, false).toClientBody());
      return;
    }
    res.status(503).json(new AppError('NOT_READY', SAFE.NOT_READY!.message, false).toClientBody());
  }
}

@Controller('plugins/google-calendar')
@UseFilters(GoogleCalendarFilter)
export class GoogleCalendarController {
  constructor(
    @Inject(GOOGLE_CALENDAR_CONNECTIONS) private readonly connections: () => GoogleCalendarConnections,
    @Inject(GOOGLE_CALENDAR_OAUTH) private readonly oauth: () => GoogleCalendarOAuthService,
    @Inject(GOOGLE_CALENDAR_PRINCIPAL) private readonly principal: () => AuthPrincipal,
  ) {}

  @Get('status')
  async status() {
    const connections = this.connections();
    this.principal();
    return connections.statusV2();
  }

  @Patch('settings')
  async settings(@Body() body: unknown, @Req() req: Request) {
    const connections = this.connections();
    this.principal();
    calendarSettingsV2RequestSchema.parse(body);
    await connections.settings(body, abortOf(req));
    return connections.statusV2();
  }

  @Get('calendars')
  async calendars(@Req() req: Request) {
    const connections = this.connections();
    this.principal();
    const raw = (req.url ?? '').split('?', 2)[1] ?? '';
    if (Buffer.byteLength(raw, 'utf8') > 8192) {
      throw new AppError('INVALID_REQUEST', 'The request is invalid.', false);
    }
    if (raw.length > 0) {
      const pairs = raw.split('&');
      const seenKeys = new Set<string>();
      for (const pair of pairs) {
        const [rawKey, ...rest] = pair.split('=');
        let decodedKey: string;
        try {
          decodedKey = decodeURIComponent(rawKey);
          if (rest.length > 0) {
            decodeURIComponent(rest.join('='));
          }
        } catch {
          throw new AppError('INVALID_REQUEST', 'The request is invalid.', false);
        }
        if (seenKeys.has(decodedKey)) {
          throw new AppError('INVALID_REQUEST', 'The request is invalid.', false);
        }
        seenKeys.add(decodedKey);
        if (decodedKey !== 'pageToken') {
          throw new AppError('INVALID_REQUEST', 'The request is invalid.', false);
        }
      }
    }
    const params = new URLSearchParams(raw);
    const entries = [...params.entries()];
    if (entries.some(([key]) => key !== 'pageToken') || params.getAll('pageToken').length > 1) {
      throw new AppError('INVALID_REQUEST', 'The request is invalid.', false);
    }
    const query = calendarCalendarsQuerySchema.parse(Object.fromEntries(entries));
    return calendarCalendarsResponseSchema.parse(await connections.calendars(query));
  }

  @Post('calendars/refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown, @Req() req: Request) {
    const connections = this.connections();
    this.principal();
    const parsed = calendarRefreshRequestSchema.parse(body);
    return calendarCalendarsResponseSchema.parse(await connections.refreshCalendars(parsed, abortOf(req)));
  }

  @Post('oauth/start')
  @HttpCode(200)
  async start(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const oauth = this.oauth();
    const principal = this.principal();
    calendarOAuthStartRequestSchema.parse(body ?? {});
    const result = await oauth.start(abortOf(req), principal.sessionId);
    res.append('Set-Cookie', oauthCookie(result.browserCookie));
    return calendarOAuthStartResponseSchema.parse({ authorizationUrl: result.authorizationUrl });
  }

  @Get('oauth/callback')
  callback(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', oauthCallbackCsp());
    res.type('html').send(oauthCallbackPage());
  }

  @Post('oauth/complete')
  @HttpCode(200)
  async complete(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const oauth = this.oauth();
    const principal = this.principal();
    const parsed = z.object({ rawQuery: z.string().max(8192) }).strict().parse(body);
    const outcome = await oauth.callback({
      rawQuery: parsed.rawQuery,
      cookieHeader: typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
    }, abortOf(req), principal.sessionId);
    res.append('Set-Cookie', clearOAuthCookie());
    return { outcome };
  }

  @Post('disconnect')
  @HttpCode(200)
  disconnect(@Body() body: unknown, @Req() req: Request) {
    const connections = this.connections();
    this.principal();
    calendarDisconnectRequestSchema.parse(body);
    return connections.disconnect(body, abortOf(req));
  }
}

function abortOf(req: Request): AbortSignal {
  const controller = new AbortController();
  req.on('aborted', () => controller.abort());
  req.socket?.on('close', () => {
    if (!req.complete) controller.abort();
  });
  return controller.signal;
}
