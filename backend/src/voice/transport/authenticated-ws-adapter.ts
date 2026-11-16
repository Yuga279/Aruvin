/**
 * ============================================================================
 * FILE: authenticated-ws-adapter.ts
 * LOCATION: backend/src/voice/transport/authenticated-ws-adapter.ts
 * ============================================================================
 * PURPOSE: Authenticate dictation WebSocket upgrades before the 101 handshake.
 * ROLE IN PROJECT: Shares one upgrade-admission object with the voice gateway
 * so tickets are never claimed for unauthenticated sockets.
 * KEY COMPONENTS: VoiceUpgradeAdmission.verify/takePrincipal; AuthenticatedWsAdapter.
 * ============================================================================
 */

import type { IncomingMessage } from 'node:http';
import { WsAdapter } from '@nestjs/platform-ws';
import type { WebSocketServer } from 'ws';
import type { AuthPrincipal } from '../../contracts/auth.js';
import type { AuthService } from '../../auth/auth.service.js';
import { readSessionCookie, sessionCookie } from '../../auth/cookies.js';
import { requireFullAccount } from '../../auth/access.js';
import { AuthFault } from '../../auth/errors.js';

type UpgradeOptions = { frontendOrigin: string; secureCookie: boolean;
  developmentLoopback: boolean; trustedHttpsIngress: (req: IncomingMessage) => boolean };
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const loopbackPeers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function countHeader(req: IncomingMessage, name: string): number {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]!.toLowerCase() === name) count++;
  return count;
}
export class VoiceUpgradeAdmission {
  private readonly admitted = new WeakMap<IncomingMessage, { principal: AuthPrincipal; sealedSession?: string }>();
  constructor(private readonly auth: Pick<AuthService, 'authenticate'>, private readonly o: UpgradeOptions) {}
  async verify(req: IncomingMessage): Promise<void> {
    const origin = new URL(this.o.frontendOrigin);
    let host = '';
    try { host = new URL(`http://${req.headers.host ?? ''}`).hostname; } catch { /* denied below */ }
    const local = this.o.developmentLoopback && origin.protocol === 'http:' &&
      loopbackHosts.has(origin.hostname) && loopbackHosts.has(host) &&
      loopbackPeers.has(req.socket.remoteAddress ?? '');
    if (req.url !== '/api/voice' || countHeader(req, 'origin') !== 1 || countHeader(req, 'host') !== 1 ||
        req.headers.origin !== this.o.frontendOrigin || req.headers['sec-fetch-site'] === 'cross-site' ||
        (!local && !(origin.protocol === 'https:' && this.o.trustedHttpsIngress(req))))
      throw new AuthFault('FORBIDDEN');
    const result = await this.auth.authenticate(readSessionCookie(req.headers.cookie));
    requireFullAccount(result.principal); this.admitted.set(req, result);
  }
  appendHeaders(headers: string[], req: IncomingMessage): void {
    const sealed = this.admitted.get(req)?.sealedSession;
    if (sealed) headers.push(`Set-Cookie: ${sessionCookie(sealed, this.o.secureCookie)}`);
  }
  takePrincipal(req: IncomingMessage): AuthPrincipal {
    const result = this.admitted.get(req); this.admitted.delete(req);
    if (!result) throw new AuthFault('UNAUTHENTICATED');
    return result.principal;
  }
}
export class AuthenticatedWsAdapter extends WsAdapter {
  constructor(serverOrApp: object, private readonly admission: VoiceUpgradeAdmission) { super(serverOrApp); }
  override create(port: number, options: Record<string, unknown> = {}): WebSocketServer {
    const server = super.create(port, { ...options,
      verifyClient: (info: { req: IncomingMessage }, done: (ok: boolean, code?: number) => void) => {
        void this.admission.verify(info.req).then(() => done(true), error =>
          done(false, error instanceof AuthFault ? error.status : 503));
      },
    }) as WebSocketServer;
    server.on('headers', (headers, req) => this.admission.appendHeaders(headers, req));
    return server;
  }
}
