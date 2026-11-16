/**
 * ============================================================================
 * FILE: auth.controller.ts
 * LOCATION: backend/src/auth/auth.controller.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Expose isolated login, me, password, recovery, and logout HTTP routes.
 *
 * ROLE IN PROJECT:
 *    Keeps Nest routing thin: cookie admission and AuthService own behavior,
 *    while this adapter maps safe JSON and Set-Cookie without AppModule.
 *
 * KEY COMPONENTS:
 *    - AuthController: Six auth routes under /auth.
 *    - AuthFilter: Closed AuthFault bodies; unknown errors become NOT_READY.
 * ============================================================================
 */

import { Body, Catch, Controller, Get, HttpCode, Inject, Post, Req, Res, UseFilters,
  type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthPrincipal } from '../contracts/auth.js';
import { AuthService } from './auth.service.js';
import { AuthFault } from './errors.js';
import { authenticateCookie } from './auth-boundary.js';
import { clearSessionCookie, sessionCookie } from './cookies.js';
export const AUTH_HTTP_OPTIONS = Symbol('AUTH_HTTP_OPTIONS');
@Catch()
class AuthFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent || res.writableEnded) return;
    const fault = error instanceof AuthFault ? error : new AuthFault('NOT_READY');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (fault.code === 'RATE_LIMITED') res.setHeader('Retry-After', '60');
    res.status(fault.status).json(fault.body());
  }
}
@Controller('auth')
@UseFilters(AuthFilter)
export class AuthController {
  constructor(@Inject(AuthService) private readonly service: AuthService,
    @Inject(AUTH_HTTP_OPTIONS) private readonly options: { secureCookie: boolean }) {}
  @Post('login') @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.login(body); res.setHeader('Set-Cookie', sessionCookie(r.sealedSession, this.options.secureCookie));
    return { user: r.user };
  }
  @Get('me')
  async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.service.me(await this.principal(req, res));
  }
  @Post('password') @HttpCode(200)
  async password(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.password(await this.principal(req, res), body);
    res.setHeader('Set-Cookie', sessionCookie(r.sealedSession, this.options.secureCookie)); return { user: r.user };
  }
  @Post('forgot-password') @HttpCode(200)
  forgotPassword(@Body() body: unknown) { return this.service.forgotPassword(body); }
  @Post('reset-password') @HttpCode(200)
  async resetPassword(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.resetPassword(body); res.setHeader('Set-Cookie', clearSessionCookie(this.options.secureCookie)); return result;
  }
  @Post('logout') @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try { await this.service.logout(await this.principal(req, res)); }
    finally { res.setHeader('Set-Cookie', clearSessionCookie(this.options.secureCookie)); }
  }
  private async principal(req: Request, res: Response): Promise<AuthPrincipal> {
    try {
      const r = await authenticateCookie(this.service, req.headers.cookie);
      if (r.sealedSession) res.setHeader('Set-Cookie', sessionCookie(r.sealedSession, this.options.secureCookie));
      return r.principal;
    } catch (error) {
      if (error instanceof AuthFault && error.code === 'UNAUTHENTICATED')
        res.setHeader('Set-Cookie', clearSessionCookie(this.options.secureCookie));
      throw error;
    }
  }
}
