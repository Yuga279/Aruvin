/**
 * ============================================================================
 * FILE: livekit-admission.spec.ts
 * LOCATION: backend/test/voice/session/livekit-admission.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for LiveKit admission token minting, binding verification, and room teardown.
 *
 * ROLE IN PROJECT:
 *    Verifies least-privilege participant and agent grants, <=30s token TTL,
 *    room/identity/epoch mismatch rejection, expired token handling, bounded
 *    teardown timeouts, and secret redaction safety.
 *
 * KEY COMPONENTS:
 *    - Grant scope and TTL verification tests.
 *    - Identity, room, and connectionEpoch mismatch tests.
 *    - Bounded RoomServiceClient deleteRoom / removeParticipant tests.
 * ============================================================================
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenVerifier } from 'livekit-server-sdk';
import {
  LIVEKIT_TEARDOWN_TIMEOUT_MS,
  LIVEKIT_TOKEN_MAX_TTL_MS,
  isCompactJwt,
  isVoiceLiveKitTransport,
  livekitAgentIdentity,
  livekitParticipantIdentity,
  livekitRoomName,
} from '../../../src/contracts/voice-wire.js';
import { livekitConfigFixture } from '../../../src/contracts/testing/voice-fixtures.js';
import { redactSecrets } from '../../../src/platform/security/redact.js';
import {
  LiveKitAdmission,
  assertLiveKitParticipantBinding,
  parseLiveKitParticipantIdentity,
  type RoomServiceClientLike,
} from '../../../src/voice/session/livekit-admission.js';

afterEach(() => {
  vi.useRealTimers();
});

function fakeRoomClient() {
  const client: RoomServiceClientLike = {
    deleteRoom: vi.fn(async () => undefined),
    removeParticipant: vi.fn(async () => undefined),
  };
  const factory = vi.fn(() => client);
  return { client, factory };
}

describe('LiveKitAdmission', () => {
  it('mints room-scoped, mic-only browser tokens and room-create agent tokens bounded to <=30s TTL', async () => {
    const { factory } = fakeRoomClient();
    const admission = new LiveKitAdmission(factory);
    const config = livekitConfigFixture();
    const nowMs = Date.parse('2026-11-05T12:00:00.000Z');

    const ticket = await admission.issue({
      config,
      userId: 'server-user',
      sessionId: 'session-123',
      connectionEpoch: 0,
      connectMs: 45_000,
      nowMs,
    });

    expect(ticket.ttlSeconds).toBe(LIVEKIT_TOKEN_MAX_TTL_MS / 1000);
    expect(ticket.expiresAtMs).toBe(nowMs + LIVEKIT_TOKEN_MAX_TTL_MS);
    expect(ticket.agentIdentity).toBe(livekitAgentIdentity('session-123'));
    expect(isCompactJwt(ticket.agentToken)).toBe(true);
    expect(isVoiceLiveKitTransport(ticket.transport, 'session-123', 0)).toBe(true);
    expect(ticket.transport).toMatchObject({
      url: config.url,
      roomName: livekitRoomName('session-123'),
      participantIdentity: livekitParticipantIdentity('server-user', 'session-123', 0),
    });

    const verifiedGrant = await admission.verifyParticipantToken({
      config,
      token: ticket.transport.participantToken,
      expectedUserId: 'server-user',
      expectedSessionId: 'session-123',
      expectedEpoch: 0,
    });
    expect(verifiedGrant).toEqual({
      roomCreate: false,
      roomJoin: true,
      room: 'aurvin-live-session-123',
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: ['microphone'],
      roomAdmin: false,
      roomList: false,
      roomRecord: false,
    });

    const verifier = new TokenVerifier(config.apiKey, config.apiSecret);
    const browserClaims = await verifier.verify(ticket.transport.participantToken, 0);
    expect(browserClaims.sub).toBe('server-user:session-123:0');
    expect(Number(browserClaims.exp) - Number(browserClaims.nbf)).toBe(30);

    const agentClaims = await verifier.verify(ticket.agentToken, 0);
    expect(agentClaims.sub).toBe('aurvin-agent:session-123');
    expect(agentClaims.video).toEqual({
      roomCreate: true,
      roomJoin: true,
      room: 'aurvin-live-session-123',
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: false,
      roomList: false,
      roomRecord: false,
    });
  });

  it('rejects expired tokens, wrong signatures, cross-session rooms, cross-user identities, and stale epochs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T12:00:00.000Z'));
    const { factory } = fakeRoomClient();
    const admission = new LiveKitAdmission(factory);
    const config = livekitConfigFixture();

    const ticket = await admission.issue({
      config,
      userId: 'server-user',
      sessionId: 'session-123',
      connectionEpoch: 1,
      connectMs: 10_000,
    });
    expect(ticket.ttlSeconds).toBe(10);

    await expect(
      admission.verifyParticipantToken({
        config,
        token: ticket.transport.participantToken,
        expectedUserId: 'other-user',
        expectedSessionId: 'session-123',
        expectedEpoch: 1,
      }),
    ).rejects.toMatchObject({ code: 'VOICE_BINDING_MISMATCH' });

    await expect(
      admission.verifyParticipantToken({
        config,
        token: ticket.transport.participantToken,
        expectedUserId: 'server-user',
        expectedSessionId: 'other-session',
        expectedEpoch: 1,
      }),
    ).rejects.toMatchObject({ code: 'VOICE_BINDING_MISMATCH' });

    await expect(
      admission.verifyParticipantToken({
        config,
        token: ticket.transport.participantToken,
        expectedUserId: 'server-user',
        expectedSessionId: 'session-123',
        expectedEpoch: 2,
      }),
    ).rejects.toMatchObject({ code: 'STALE_CONNECTION_EPOCH' });

    await expect(
      admission.verifyParticipantToken({
        config: { ...config, apiSecret: 'wrong-secret-value-12345' },
        token: ticket.transport.participantToken,
        expectedUserId: 'server-user',
        expectedSessionId: 'session-123',
        expectedEpoch: 1,
      }),
    ).rejects.toMatchObject({ code: 'VOICE_BINDING_MISMATCH' });

    await vi.advanceTimersByTimeAsync(11_000);
    await expect(
      admission.verifyParticipantToken({
        config,
        token: ticket.transport.participantToken,
        expectedUserId: 'server-user',
        expectedSessionId: 'session-123',
        expectedEpoch: 1,
        clockToleranceSeconds: 0,
      }),
    ).rejects.toMatchObject({ code: 'VOICE_CONNECT_TIMEOUT' });
  });

  it('parses and enforces participant identity and room bindings directly', () => {
    expect(parseLiveKitParticipantIdentity('server-user:session-1:3')).toEqual({
      userId: 'server-user',
      sessionId: 'session-1',
      connectionEpoch: 3,
    });
    expect(parseLiveKitParticipantIdentity('invalid')).toBeNull();
    expect(parseLiveKitParticipantIdentity('a:b:c:d')).toBeNull();
    expect(parseLiveKitParticipantIdentity('server-user:session-1:-1')).toBeNull();

    expect(() =>
      assertLiveKitParticipantBinding(
        {
          userId: 'server-user',
          sessionId: 'session-1',
          connectionEpoch: 2,
          roomName: 'aurvin-live-session-1',
        },
        {
          participantIdentity: 'server-user:session-1:2',
          roomName: 'aurvin-live-session-1',
        },
      ),
    ).not.toThrow();

    expect(() =>
      assertLiveKitParticipantBinding(
        { userId: 'server-user', sessionId: 'session-1', connectionEpoch: 2 },
        { participantIdentity: 'server-user:session-1:1' },
      ),
    ).toThrow('STALE_CONNECTION_EPOCH');

    expect(() =>
      assertLiveKitParticipantBinding(
        {
          userId: 'server-user',
          sessionId: 'session-1',
          connectionEpoch: 2,
          roomName: 'aurvin-live-session-1',
        },
        {
          participantIdentity: 'server-user:session-1:2',
          roomName: 'aurvin-live-session-2',
        },
      ),
    ).toThrow('VOICE_BINDING_MISMATCH');
  });

  it('actively deletes rooms and evicts stale participants within a bounded 2s timeout without throwing on server failure', async () => {
    vi.useFakeTimers();
    const { client, factory } = fakeRoomClient();
    const admission = new LiveKitAdmission(factory);
    const config = livekitConfigFixture();

    await admission.teardownRoom({
      config,
      roomName: 'aurvin-live-session-1',
    });
    expect(factory).toHaveBeenCalledWith(config, LIVEKIT_TEARDOWN_TIMEOUT_MS);
    expect(client.deleteRoom).toHaveBeenCalledWith('aurvin-live-session-1');

    await admission.evictParticipant({
      config,
      roomName: 'aurvin-live-session-1',
      participantIdentity: 'server-user:session-1:0',
    });
    expect(client.removeParticipant).toHaveBeenCalledWith(
      'aurvin-live-session-1',
      'server-user:session-1:0',
    );

    vi.mocked(client.deleteRoom).mockRejectedValueOnce(new Error('livekit unreachable'));
    await expect(
      admission.teardownRoom({ config, roomName: 'aurvin-live-session-1' }),
    ).resolves.toBeUndefined();

    vi.mocked(client.deleteRoom).mockImplementationOnce(() => new Promise<void>(() => {}));
    const hanging = admission.teardownRoom({
      config,
      roomName: 'aurvin-live-session-hang',
      timeoutMs: 2000,
    });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(hanging).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('redacts signed access tokens and secrets while keeping session correlation fields', async () => {
    const { factory } = fakeRoomClient();
    const admission = new LiveKitAdmission(factory);
    const config = livekitConfigFixture();
    const ticket = await admission.issue({
      config,
      userId: 'server-user',
      sessionId: 'session-redact',
      connectionEpoch: 0,
      connectMs: 10_000,
    });

    const redacted = redactSecrets({
      config,
      transport: ticket.transport,
      agentToken: ticket.agentToken,
      logLine: `token=${ticket.transport.participantToken}`,
    });
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain(ticket.transport.participantToken);
    expect(serialized).not.toContain(ticket.agentToken);
    expect(serialized).not.toContain(config.apiSecret);
    expect(serialized).toContain('aurvin-live-session-redact');
    expect(serialized).toContain('server-user:session-redact:0');
  });
});
