/**
 * ============================================================================
 * FILE: voice-session.controller.ts
 * LOCATION: backend/src/voice/session/voice-session.controller.ts
 * ============================================================================
 *
 * PURPOSE:
 *    REST Controller and HTTP exception filter for voice sessions.
 *
 * ROLE IN PROJECT:
 *    Handles `/api/voice` HTTP endpoints (`/config`, `/sessions`, `/sessions/:id`),
 *    enforcing strict DTO validation, origin verification, and cookie header generation.
 *
 * KEY COMPONENTS:
 *    - VoiceHttpFilter: Maps domain VoiceSessionErrors to normalized HTTP status responses.
 *    - VoiceSessionController: REST controller exposing config, session creation and termination.
 * ============================================================================
 */

import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query,
  Req, Res, Catch, UseFilters, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { VoiceSessionService } from './voice-session.service.js';
import { assertOrigin, fault, VoiceSessionError } from './voice-session.options.js';
import { RequestIdentityStore } from '../../platform/identity/request-identity-store.js';

const noQuery = (q: unknown) => { if (!q || typeof q !== 'object' || Object.keys(q).length) fault('INVALID_VOICE_REQUEST'); };

@Catch()
export class VoiceHttpFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const code = error instanceof VoiceSessionError ? error.code : 'VOICE_DELIVERY_UNKNOWN';
    const status = code === 'INVALID_ORIGIN' || code === 'VOICE_BINDING_MISMATCH' ? 403
      : code === 'VOICE_DISABLED' ? 503 : code === 'VOICE_QUOTA_EXHAUSTED' ? 429
      : code === 'CONFLICT_ACTIVE_TURN' || code === 'VOICE_INVALID_STATE' || code === 'STALE_CONNECTION_EPOCH' ? 409
      : code === 'VOICE_SESSION_ENDED' || code === 'VOICE_RECONNECT_TIMEOUT' ? 410
      : code === 'INVALID_VOICE_REQUEST' ? 400 : 503;
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({ error: { code, message: 'Voice is unavailable.', retryable: status >= 500 || status === 429 } });
  }
}

@Controller('voice')
@UseFilters(VoiceHttpFilter)
export class VoiceSessionController {
  constructor(
    @Inject(VoiceSessionService) private readonly sessions: VoiceSessionService,
    @Inject(RequestIdentityStore) private readonly identities: RequestIdentityStore,
  ) {}

  @Get('config')
  config(@Query() q: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    noQuery(q);
    assertOrigin(this.sessions.options, req.headers.origin, false);
    res.setHeader('Cache-Control', 'no-store');
    return this.sessions.config();
  }

  @Post('sessions')
  @HttpCode(201)
  async create(@Body() body: unknown, @Query() q: unknown, @Req() req: Request,
    @Res({ passthrough: true }) res: Response) {
    noQuery(q);
    const result = await this.sessions.create(body, req.headers.origin, this.identities.principal());
    res.setHeader('Cache-Control', 'no-store');
    if (result.cookie) res.append('Set-Cookie', result.cookie);
    return result.response;
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async end(@Param('id') id: string, @Query() q: unknown, @Req() req: Request,
    @Res({ passthrough: true }) res: Response) {
    noQuery(q);
    assertOrigin(this.sessions.options, req.headers.origin);
    if (!id || id.length > 128) fault('INVALID_VOICE_REQUEST');
    await this.sessions.endOwned(id, this.identities.principal());
    res.setHeader('Cache-Control', 'no-store');
    // Do not clear the origin-wide cookie here: it may belong to another newly created session.
  }
}
