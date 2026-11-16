/**
 * ============================================================================
 * FILE: voice.gateway.ts
 * LOCATION: backend/src/voice/transport/voice.gateway.ts
 * ============================================================================
 *
 * PURPOSE:
 *    NestJS WebSocket Gateway for dictation-only `/api/voice` transport.
 *
 * ROLE IN PROJECT:
 *    Validates the origin and claims a dictation ticket before attaching raw
 *    WebSocket listeners. Live voice is admitted through LiveKit, never PCM here.
 *
 * KEY COMPONENTS:
 *    - VoiceGateway: WebSocket gateway on path `/api/voice`.
 * ============================================================================
 */

import { Inject, Optional } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { RawData } from 'ws';
import { VoiceSessionService } from '../session/voice-session.service.js';
import { VoiceConnection, type VoiceSocket } from './voice-connection.js';
import { VoiceUpgradeAdmission } from './authenticated-ws-adapter.js';

type GatewaySocket = VoiceSocket & {
  on(event: 'message', listener: (data: RawData, binary: boolean) => void): unknown;
  on(event: 'close' | 'error', listener: () => void): unknown;
  off(event: 'message', listener: (data: RawData, binary: boolean) => void): unknown;
  off(event: 'close' | 'error', listener: () => void): unknown;
};

@WebSocketGateway({ path: '/api/voice', maxPayload: 131072, perMessageDeflate: false })
export class VoiceGateway {
  constructor(
    @Inject(VoiceSessionService) private readonly sessions: VoiceSessionService,
    @Optional() @Inject(VoiceUpgradeAdmission) private readonly admission?: VoiceUpgradeAdmission,
  ) {}

  handleConnection(socket: GatewaySocket, request: IncomingMessage) {
    let connection: VoiceConnection;
    try {
      if (request.url !== '/api/voice') throw new Error('INVALID_VOICE_REQUEST');
      const principal = this.admission!.takePrincipal(request);
      const binding = this.sessions.claim(request.headers.cookie, request.headers.origin, principal, 'dictation');
      connection = new VoiceConnection(this.sessions, binding, socket);
    } catch {
      socket.close(1008);
      return;
    }
    const message = (data: RawData, binary: boolean) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data)
        : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      connection.receive(bytes, binary);
    };
    const closed = () => {
      socket.off('message', message);
      socket.off('close', closed);
      socket.off('error', errored);
      void connection.lost().catch(() => undefined);
    };
    const errored = () => {
      // A socket failure is a disconnect, not a client protocol violation.
      void connection.lost().catch(() => undefined);
    };
    socket.on('message', message);
    socket.on('close', closed);
    socket.on('error', errored);
  }
}
