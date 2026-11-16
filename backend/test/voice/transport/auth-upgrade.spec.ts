/**
 * ============================================================================
 * FILE: auth-upgrade.spec.ts
 * LOCATION: backend/test/voice/transport/auth-upgrade.spec.ts
 * ============================================================================
 * PURPOSE: Reject unauthenticated dictation WebSocket upgrades before 101.
 * ROLE IN PROJECT: Proves VoiceUpgradeAdmission runs in verifyClient so a
 * missing cookie never claims a voice ticket.
 * KEY COMPONENTS: AuthenticatedWsAdapter loopback handshake.
 * ============================================================================
 */

import { once } from 'node:events';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { expect, it, vi } from 'vitest';
import { AuthenticatedWsAdapter, VoiceUpgradeAdmission } from '../../../src/voice/transport/authenticated-ws-adapter.js';
import { AuthFault } from '../../../src/auth/errors.js';

it('rejects unauthenticated upgrades before 101 and before voice ticket consumption', async () => {
  const server = createServer();
  const auth = { authenticate: vi.fn(async () => { throw new AuthFault('UNAUTHENTICATED'); }) };
  const admission = new VoiceUpgradeAdmission(auth, {
    frontendOrigin: 'http://127.0.0.1:5173', secureCookie: false,
    developmentLoopback: true, trustedHttpsIngress: () => false,
  });
  const adapter = new AuthenticatedWsAdapter(server, admission);
  const ws = adapter.create(0, { path: '/api/voice', maxPayload: 131072, perMessageDeflate: false });
  const connected = vi.fn(); ws.on('connection', connected);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No loopback port');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/api/voice`, {
    headers: { Origin: 'http://127.0.0.1:5173' },
  });
  try {
    const response = new Promise<number>((resolve, reject) => {
      client.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode!); });
      client.once('open', () => reject(new Error('Unauthenticated upgrade succeeded')));
      client.once('error', () => {});
    });
    expect(await response).toBe(401);
    expect(connected).not.toHaveBeenCalled();
  } finally {
    client.terminate(); await adapter.close(ws); await adapter.dispose();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
