/**
 * ============================================================================
 * FILE: livekit-admission.ts
 * LOCATION: backend/src/voice/session/livekit-admission.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Scoped LiveKit JWT issuance, participant binding verification, and room teardown.
 *
 * ROLE IN PROJECT:
 *    Implements LiveKitAdmissionPort behind VoiceSessionService. Mints short-lived
 *    room/participant/epoch-scoped tokens and executes bounded server-side room
 *    deletion and stale-epoch participant eviction via RoomServiceClient.
 *
 * KEY COMPONENTS:
 *    - parseLiveKitParticipantIdentity / assertLiveKitParticipantBinding: Binding guards.
 *    - LiveKitAdmission: Issues tokens, verifies grants, and tears down rooms.
 * ============================================================================
 */

import { AccessToken, RoomServiceClient, TokenVerifier, TrackSource } from 'livekit-server-sdk';
import type { LiveKitConfig } from '../../contracts/config-runtime.js';
import type {
  LiveKitAdmissionPort,
  LiveKitAdmissionTicket,
  LiveKitParticipantGrant,
} from '../../contracts/voice.js';
import {
  LIVEKIT_TEARDOWN_TIMEOUT_MS,
  LIVEKIT_TOKEN_MAX_TTL_MS,
  isVoiceLiveKitTransport,
  livekitAgentIdentity,
  livekitParticipantIdentity,
  livekitRoomName,
  type VoiceLiveKitTransport,
} from '../../contracts/voice-wire.js';
import { isLiveKitConfigured } from '../../platform/config/voice-config.js';
import { fault } from './voice-session.options.js';

export type RoomServiceClientLike = {
  deleteRoom(room: string): Promise<void>;
  removeParticipant(room: string, identity: string): Promise<void>;
};

export type RoomServiceClientFactory = (
  config: LiveKitConfig,
  timeoutMs: number,
) => RoomServiceClientLike;

export type ParsedLiveKitParticipantIdentity = {
  userId: string;
  sessionId: string;
  connectionEpoch: number;
};

type VideoClaims = {
  roomCreate?: unknown;
  roomJoin?: unknown;
  room?: unknown;
  canPublish?: unknown;
  canSubscribe?: unknown;
  canPublishData?: unknown;
  canPublishSources?: unknown;
  roomAdmin?: unknown;
  roomList?: unknown;
  roomRecord?: unknown;
};

const defaultRoomClientFactory: RoomServiceClientFactory = (config, timeoutMs) =>
  new RoomServiceClient(config.url, config.apiKey, config.apiSecret, {
    requestTimeout: Math.max(0.5, timeoutMs / 1000),
    failover: false,
  });

export function parseLiveKitParticipantIdentity(
  participantIdentity: string,
): ParsedLiveKitParticipantIdentity | null {
  if (
    typeof participantIdentity !== 'string' ||
    participantIdentity.length === 0 ||
    participantIdentity.length > 256 ||
    /[\u0000-\u0020\u007f]/u.test(participantIdentity)
  ) {
    return null;
  }
  const parts = participantIdentity.split(':');
  if (parts.length !== 3) return null;
  const [userId, sessionId, epochPart] = parts;
  if (!userId || !sessionId || !/^(?:0|[1-9]\d*)$/.test(epochPart)) return null;
  const connectionEpoch = Number(epochPart);
  if (!Number.isInteger(connectionEpoch) || connectionEpoch < 0 || connectionEpoch > 0xffffffff) {
    return null;
  }
  return { userId, sessionId, connectionEpoch };
}

export function assertLiveKitParticipantBinding(
  expected: {
    userId: string;
    sessionId: string;
    connectionEpoch: number;
    roomName?: string;
  },
  actual: {
    participantIdentity: string;
    roomName?: string;
  },
): ParsedLiveKitParticipantIdentity {
  const expectedRoom = expected.roomName ?? livekitRoomName(expected.sessionId);
  if (actual.roomName !== undefined && actual.roomName !== expectedRoom) {
    fault('VOICE_BINDING_MISMATCH');
  }
  const parsed = parseLiveKitParticipantIdentity(actual.participantIdentity);
  if (!parsed || parsed.userId !== expected.userId || parsed.sessionId !== expected.sessionId) {
    fault('VOICE_BINDING_MISMATCH');
  }
  if (parsed.connectionEpoch !== expected.connectionEpoch) {
    fault('STALE_CONNECTION_EPOCH');
  }
  return parsed;
}

async function runBoundedBestEffort(
  operation: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  const boundMs = Math.max(1, Math.min(10_000, timeoutMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, boundMs);
        timer.unref?.();
      }),
    ]);
  } catch {
    /* Best-effort teardown: an unreachable SFU or already-deleted room must not hang drain. */
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class LiveKitAdmission implements LiveKitAdmissionPort {
  constructor(private readonly clientFactory: RoomServiceClientFactory = defaultRoomClientFactory) {}

  async issue(command: {
    config: LiveKitConfig;
    userId: string;
    sessionId: string;
    connectionEpoch: number;
    connectMs: number;
    nowMs?: number;
  }): Promise<LiveKitAdmissionTicket> {
    if (!isLiveKitConfigured(command.config)) {
      fault('VOICE_DISABLED');
    }
    if (
      !command.userId ||
      !command.sessionId ||
      !Number.isInteger(command.connectionEpoch) ||
      command.connectionEpoch < 0 ||
      command.connectionEpoch > 0xffffffff
    ) {
      fault('VOICE_BINDING_MISMATCH');
    }

    const nowMs = command.nowMs ?? Date.now();
    const boundedMs = Math.max(1000, Math.min(LIVEKIT_TOKEN_MAX_TTL_MS, command.connectMs));
    const ttlSeconds = Math.max(1, Math.ceil(boundedMs / 1000));
    const expiresAtMs = nowMs + ttlSeconds * 1000;
    const roomName = livekitRoomName(command.sessionId);
    const participantIdentity = livekitParticipantIdentity(
      command.userId,
      command.sessionId,
      command.connectionEpoch,
    );
    const agentIdentity = livekitAgentIdentity(command.sessionId);

    const browserAccess = new AccessToken(command.config.apiKey, command.config.apiSecret, {
      identity: participantIdentity,
      ttl: ttlSeconds,
    });
    browserAccess.addGrant({
      roomCreate: false,
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: [TrackSource.MICROPHONE],
      roomAdmin: false,
      roomList: false,
      roomRecord: false,
    });

    const agentAccess = new AccessToken(command.config.apiKey, command.config.apiSecret, {
      identity: agentIdentity,
      ttl: ttlSeconds,
    });
    agentAccess.addGrant({
      roomCreate: true,
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: false,
      roomList: false,
      roomRecord: false,
    });

    const [participantToken, agentToken] = await Promise.all([
      browserAccess.toJwt(),
      agentAccess.toJwt(),
    ]);

    const transport: VoiceLiveKitTransport = {
      url: command.config.url,
      roomName,
      participantIdentity,
      participantToken,
    };
    if (!isVoiceLiveKitTransport(transport, command.sessionId, command.connectionEpoch)) {
      fault('VOICE_BINDING_MISMATCH');
    }

    return {
      transport,
      agentIdentity,
      agentToken,
      expiresAtMs,
      ttlSeconds,
    };
  }

  async teardownRoom(command: {
    config: LiveKitConfig;
    roomName: string;
    timeoutMs?: number;
  }): Promise<void> {
    if (!isLiveKitConfigured(command.config) || !command.roomName) return;
    const timeoutMs = command.timeoutMs ?? LIVEKIT_TEARDOWN_TIMEOUT_MS;
    await runBoundedBestEffort(async () => {
      const client = this.clientFactory(command.config, timeoutMs);
      await client.deleteRoom(command.roomName);
    }, timeoutMs);
  }

  async evictParticipant(command: {
    config: LiveKitConfig;
    roomName: string;
    participantIdentity: string;
    timeoutMs?: number;
  }): Promise<void> {
    if (!isLiveKitConfigured(command.config) || !command.roomName || !command.participantIdentity) {
      return;
    }
    const timeoutMs = command.timeoutMs ?? LIVEKIT_TEARDOWN_TIMEOUT_MS;
    await runBoundedBestEffort(async () => {
      const client = this.clientFactory(command.config, timeoutMs);
      await client.removeParticipant(command.roomName, command.participantIdentity);
    }, timeoutMs);
  }

  async verifyParticipantToken(command: {
    config: LiveKitConfig;
    token: string;
    expectedUserId: string;
    expectedSessionId: string;
    expectedEpoch: number;
    clockToleranceSeconds?: number;
  }): Promise<LiveKitParticipantGrant> {
    if (!isLiveKitConfigured(command.config)) {
      fault('VOICE_DISABLED');
    }
    const verifier = new TokenVerifier(command.config.apiKey, command.config.apiSecret);
    let claims: Awaited<ReturnType<TokenVerifier['verify']>>;
    try {
      claims = await verifier.verify(command.token, command.clockToleranceSeconds ?? 0);
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code === 'ERR_JWT_EXPIRED') {
        fault('VOICE_CONNECT_TIMEOUT');
      }
      fault('VOICE_BINDING_MISMATCH');
    }

    const expectedRoom = livekitRoomName(command.expectedSessionId);
    const video = claims.video;
    if (!video || typeof video !== 'object' || typeof claims.sub !== 'string') {
      fault('VOICE_BINDING_MISMATCH');
    }
    const grant = video as VideoClaims;
    assertLiveKitParticipantBinding(
      {
        userId: command.expectedUserId,
        sessionId: command.expectedSessionId,
        connectionEpoch: command.expectedEpoch,
        roomName: expectedRoom,
      },
      {
        participantIdentity: claims.sub,
        roomName: typeof grant.room === 'string' ? grant.room : undefined,
      },
    );

    const sources = grant.canPublishSources;
    const isMicOnly =
      Array.isArray(sources) && sources.length === 1 && sources[0] === 'microphone';
    if (
      grant.roomJoin !== true ||
      grant.room !== expectedRoom ||
      grant.roomCreate !== false ||
      grant.roomAdmin !== false ||
      grant.roomList !== false ||
      grant.roomRecord !== false ||
      grant.canPublish !== true ||
      grant.canSubscribe !== true ||
      grant.canPublishData !== true ||
      !isMicOnly
    ) {
      fault('VOICE_BINDING_MISMATCH');
    }

    return {
      roomCreate: false,
      roomJoin: true,
      room: expectedRoom,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: ['microphone'],
      roomAdmin: false,
      roomList: false,
      roomRecord: false,
    };
  }
}
