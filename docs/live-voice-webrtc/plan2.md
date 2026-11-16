# Live Voice Session Admission and Scoped LiveKit Access (P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement backend LiveKit session admission, room/participant/epoch-scoped short-lived JWT issuance, reconnect epoch rotation with stale-participant eviction, and bounded server-side room teardown behind the P1 contracts while preserving dictation cookie tickets, single-executor reservations, config snapshots, and quota accounting.

**Architecture:** Introduce `LiveKitAdmission` (`backend/src/voice/session/livekit-admission.ts`) implementing `LiveKitAdmissionPort` using `livekit-server-sdk` (`AccessToken`, `TokenVerifier`, `RoomServiceClient`, `TrackSource.MICROPHONE`). Wire `VoiceSessionService` (`backend/src/voice/session/voice-session.service.ts`) to gate `live` mode on configured LiveKit settings without disabling `dictation`, attach `CreateVoiceSessionResponse.livekit` on `live` session creation and reconnect, verify participant/room/epoch bindings via `claimLive`, and actively tear down the LiveKit room (`deleteRoom`, bounded to `2,000 ms`) alongside bridge cleanup and single reservation/admission release on `end`, `stop`, unrecoverable `disconnected`, expiry `sweep`, and `drain`.

**Tech Stack:** TypeScript 6 (ESM NodeNext), NestJS 12, Vitest 4, `livekit-server-sdk@^2.19.2`.

---

## Interfaces Consumed from P1 and Handed to P5

### 1. Interfaces Consumed from P1 (`backend/src/contracts/*` & `backend/src/platform/*`)
- From `backend/src/contracts/voice-wire.ts`:
  - `LIVEKIT_ROOM_PREFIX` (`'aurvin-live-'`), `LIVEKIT_AGENT_PREFIX` (`'aurvin-agent:'`), `LIVEKIT_TOKEN_MAX_TTL_MS` (`30000`), `LIVEKIT_TEARDOWN_TIMEOUT_MS` (`2000`)
  - `VoiceLiveKitTransport`, `CreateVoiceSessionResponse` (`livekit?: VoiceLiveKitTransport`)
  - `livekitRoomName(sessionId)`, `livekitParticipantIdentity(userId, sessionId, connectionEpoch)`, `livekitAgentIdentity(sessionId)`
  - `isVoiceLiveKitTransport(value, sessionId?, connectionEpoch?)`, `isLiveKitVoiceSessionResponse(value)`
- From `backend/src/contracts/config-runtime.ts` & `backend/src/platform/config/voice-config.ts`:
  - `LiveKitConfig`, `VoiceConfig` (`livekit?: LiveKitConfig | null`)
  - `isLiveKitConfigured(livekit)`, `effectiveVoiceModes(config)`, `publicVoiceConfig(config)`
- From `backend/src/contracts/voice.ts`:
  - `LiveKitParticipantGrant`, `LiveKitAdmissionTicket`, `LiveKitAdmissionPort`
- From `backend/src/contracts/testing/voice-fixtures.ts`:
  - `livekitConfigFixture()`, `livekitTransportFixture()`, `enabledVoiceEnvironment()`
- From `backend/src/platform/security/redact.ts`:
  - `redactSecrets(value)` (redacts `participantToken`, `accessToken`, `apiKey`, `apiSecret`, and compact JWTs `eyJ...`)

### 2. Interfaces Handed to P5 (and P3/P8 Test Harnesses)
```typescript
// backend/src/voice/session/livekit-admission.ts
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

export function parseLiveKitParticipantIdentity(
  participantIdentity: string,
): ParsedLiveKitParticipantIdentity | null;

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
): ParsedLiveKitParticipantIdentity;

export class LiveKitAdmission implements LiveKitAdmissionPort {
  constructor(clientFactory?: RoomServiceClientFactory);
  issue(command: {
    config: LiveKitConfig;
    userId: string;
    sessionId: string;
    connectionEpoch: number;
    connectMs: number;
    nowMs?: number;
  }): Promise<LiveKitAdmissionTicket>;
  teardownRoom(command: {
    config: LiveKitConfig;
    roomName: string;
    timeoutMs?: number;
  }): Promise<void>;
  evictParticipant(command: {
    config: LiveKitConfig;
    roomName: string;
    participantIdentity: string;
    timeoutMs?: number;
  }): Promise<void>;
  verifyParticipantToken(command: {
    config: LiveKitConfig;
    token: string;
    expectedUserId: string;
    expectedSessionId: string;
    expectedEpoch: number;
    clockToleranceSeconds?: number;
  }): Promise<LiveKitParticipantGrant>;
}

// backend/src/voice/session/voice-session.options.ts
export type SessionContext = {
  identity: ResolvedIdentity;
  response: CreateVoiceSessionResponse;
  reservation: ExecutionReservation | null;
  voiceConfig: RuntimeConfigSnapshot['voice'];
  configSnapshot: RuntimeConfigSnapshot | null;
  livekitTicket?: LiveKitAdmissionTicket | null;
  /** Checks the original admission; transport renewal must not mint a new lease. */
  assertPaidWork?(): void;
};

export type VoiceSessionOptions = {
  config: VoiceConfig;
  currentConfig?: CurrentConfigPort;
  identity: IdentityResolver;
  sessions: Pick<SessionRepository, 'get'>;
  reservations: ExecutionReservationPort;
  livekit?: LiveKitAdmissionPort;
  frontendOrigin: string;
  secureCookie: boolean;
  observe?(context: SessionContext, observation: VoiceObservation): void;
  admission(context: SessionContext): Promise<{ release(): Promise<void>; assertActive?(): void }>;
  usage(context: SessionContext, usage: SpeechUsage): Promise<void>;
  disconnected(context: SessionContext): Promise<void>;
  open(context: SessionContext, sink: VoiceSink, signal: AbortSignal): Promise<VoiceFlow>;
  /** Optional P5 hook invoked on live session issue/reconnect to start/attach the server-side LiveKit media bridge. */
  openLiveBridge?(
    context: SessionContext,
    ticket: LiveKitAdmissionTicket,
  ): Promise<{ close(): Promise<void> } | void>;
};

// backend/src/voice/session/voice-session.service.ts
// Added methods on VoiceSessionService:
// claimLive(sessionId: string, participantIdentity?: string, roomName?: string): VoiceBinding;
// sweep(now?: number): Promise<void>;
```

---

## File Map & Ownership Check

All created and modified files belong exclusively to P2 (`docs/live-voice-webrtc/state.md:150,246`):

- Create: `backend/src/voice/session/livekit-admission.ts` — scoped JWT minter (`AccessToken`), token/identity/room verifier (`TokenVerifier`), and bounded room/participant teardown (`RoomServiceClient.deleteRoom` / `removeParticipant`)
- Create: `backend/test/voice/session/livekit-admission.spec.ts` — unit tests for grant scope, TTL bounds, token expiry, room/identity/epoch mismatch rejection, secret redaction, and bounded teardown timeout/error handling
- Modify: `backend/test/voice/session/fixtures.ts` — P1->P2 handoff update adding `LIVEKIT_*` / `livekitConfigFixture()` and a deterministic `fakeLiveKitRoomService` to `options()` and `revisionFixture()`
- Modify: `backend/src/voice/session/voice-session.options.ts` — add `livekitTicket` to `SessionContext` and `livekit` + `openLiveBridge` to `VoiceSessionOptions`
- Modify: `backend/src/voice/session/voice-session.service.ts` — wire LiveKit capability gating, `livekit` transport descriptor issuance, reconnect epoch rotation + stale participant eviction, `claimLive` participant binding verification, `sweep`, and bounded room deletion on terminal transitions
- Modify: `backend/src/voice/session/voice-session.controller.ts` — map `VOICE_RECONNECT_TIMEOUT` (410) and `STALE_CONNECTION_EPOCH` (409) in `VoiceHttpFilter`
- Modify: `backend/test/voice/session/controller.spec.ts` — add live WebRTC admission, reconnect, `claimLive`, mismatch, expiry `sweep`, single-release teardown, and redaction tests
- Modify: `backend/test/voice/session/config-snapshots.spec.ts` — add LiveKit config snapshot retention and unconfigured LiveKit fail-closed tests

Do **not** modify `backend/src/voice/session/live-flow.ts`, `backend/src/app.service.ts`, `backend/src/app.module.ts`, or `backend/test/voice/transport/gateway.integration.spec.ts`.

---

### Task 1: Implement `LiveKitAdmission` (`livekit-admission.ts`) and Unit Tests (`livekit-admission.spec.ts`)

**Files:**
- Create: `backend/src/voice/session/livekit-admission.ts`
- Create: `backend/test/voice/session/livekit-admission.spec.ts`

- [ ] **Step 1: Write the failing unit tests in `backend/test/voice/session/livekit-admission.spec.ts`**

Create `backend/test/voice/session/livekit-admission.spec.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run in `backend/`:
```powershell
npm test -- test/voice/session/livekit-admission.spec.ts
```
Expected: FAIL with `Cannot find module '../../../src/voice/session/livekit-admission.js'`.

- [ ] **Step 3: Implement `backend/src/voice/session/livekit-admission.ts`**

Create `backend/src/voice/session/livekit-admission.ts`:

```typescript
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
    if (!video || typeof claims.sub !== 'string') {
      fault('VOICE_BINDING_MISMATCH');
    }
    assertLiveKitParticipantBinding(
      {
        userId: command.expectedUserId,
        sessionId: command.expectedSessionId,
        connectionEpoch: command.expectedEpoch,
        roomName: expectedRoom,
      },
      {
        participantIdentity: claims.sub,
        roomName: video.room,
      },
    );

    const sources = video.canPublishSources as unknown;
    const isMicOnly =
      Array.isArray(sources) && sources.length === 1 && sources[0] === 'microphone';
    if (
      video.roomJoin !== true ||
      video.room !== expectedRoom ||
      video.roomCreate !== false ||
      video.roomAdmin !== false ||
      video.roomList !== false ||
      video.roomRecord !== false ||
      video.canPublish !== true ||
      video.canSubscribe !== true ||
      video.canPublishData !== true ||
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run in `backend/`:
```powershell
npm test -- test/voice/session/livekit-admission.spec.ts
```
Expected: PASS (5 passed).

- [ ] **Step 5: Commit Task 1**

```powershell
git add backend/src/voice/session/livekit-admission.ts backend/test/voice/session/livekit-admission.spec.ts
git commit -m "feat(voice): add LiveKitAdmission token minter and bounded room teardown"
```

---

### Task 2: Update Session Test Fixtures (`backend/test/voice/session/fixtures.ts`) for P1->P2 Handoff

**Files:**
- Modify: `backend/test/voice/session/fixtures.ts:20-67`
-Modify: `backend/src/voice/session/voice-session.options.ts:22-84`

- [ ] **Step 1: Verify the P1->P2 handoff failure in `gateway.integration.spec.ts`**

Run in `backend/`:
```powershell
npm test -- test/voice/transport/gateway.integration.spec.ts
```
Expected: FAIL on `serves exact REST routes and rejects unknown DTO/query keys without allocation` (`expected { dictation: true, live: false } to deeply equal { dictation: true, live: true }`).

- [ ] **Step 2: Add `livekit` and `openLiveBridge` to `VoiceSessionOptions` (`backend/src/voice/session/voice-session.options.ts`) and update `backend/test/voice/session/fixtures.ts`**

In `backend/src/voice/session/voice-session.options.ts`, update imports at lines 25–28 and update `SessionContext` and `VoiceSessionOptions` (lines 47–83):

```typescript
import type { ExecutionReservation, ExecutionReservationPort, SpeechUsage,
  TtsEvent, SpeechToTextPort, SpeechSynthesisPort, LiveKitAdmissionPort,
  LiveKitAdmissionTicket } from '../../contracts/voice.js';
```

And update `SessionContext` and `VoiceSessionOptions` in `backend/src/voice/session/voice-session.options.ts`:

```typescript
export type SessionContext = {
  identity: ResolvedIdentity;
  response: CreateVoiceSessionResponse;
  reservation: ExecutionReservation | null;
  voiceConfig: RuntimeConfigSnapshot['voice'];
  configSnapshot: RuntimeConfigSnapshot | null;
  livekitTicket?: LiveKitAdmissionTicket | null;
  /** Checks the original admission; transport renewal must not mint a new lease. */
  assertPaidWork?(): void;
};
export type LiveHooks = {
  finalized(context: SessionContext, input: { providerSocketEpoch: number;
    providerTurnId: string; text: string }, signal: AbortSignal): Promise<void>;
  interrupt(context: SessionContext, ref: { turnId: string; responseId: string }): Promise<void>;
  delivery(context: SessionContext, event: Exclude<TtsEvent, { type: 'audio' } | { type: 'error' }>): Promise<void>;
  playback(context: SessionContext, ref: { turnId: string; responseId: string }, playedSamples: number): Promise<void>;
  disconnected(context: SessionContext): Promise<void>;
};
export const VOICE_STAGES = ['response-prepared', 'model-first-output', 'tts-first-audio',
  'stt-end-of-turn', 'tts-first-submit', 'stt-connected', 'tts-connected',
  'playback-first-ack', 'delivery-settled', 'tts-reset', 'flow-error', 'transport-error'] as const;
export type VoiceObservation = { stage: typeof VOICE_STAGES[number]; elapsedMs?: number;
  queueSamples?: number; code?: VoiceErrorCode; turnId?: string; responseId?: string };
export type VoiceSessionOptions = {
  config: VoiceConfig;
  currentConfig?: CurrentConfigPort;
  identity: IdentityResolver;
  sessions: Pick<SessionRepository, 'get'>;
  reservations: ExecutionReservationPort;
  livekit?: LiveKitAdmissionPort;
  frontendOrigin: string;
  secureCookie: boolean;
  observe?(context: SessionContext, observation: VoiceObservation): void;
  admission(context: SessionContext): Promise<{ release(): Promise<void>; assertActive?(): void }>;
  usage(context: SessionContext, usage: SpeechUsage): Promise<void>;
  disconnected(context: SessionContext): Promise<void>;
  open(context: SessionContext, sink: VoiceSink, signal: AbortSignal): Promise<VoiceFlow>;
  openLiveBridge?(
    context: SessionContext,
    ticket: LiveKitAdmissionTicket,
  ): Promise<{ close(): Promise<void> } | void>;
};
```

In `backend/test/voice/session/fixtures.ts`, update lines 20–68 to include `livekitConfigFixture()` / `LIVEKIT_*` values and a deterministic `LiveKitAdmission` with a spyable `fakeRoomService`:

```typescript
import { vi } from 'vitest';
import type { ManageableSettings } from '../../../src/contracts/admin-config-wire.js';
import type { CurrentConfigPort, RuntimeConfigSnapshot } from '../../../src/contracts/config-runtime.js';
import { livekitConfigFixture } from '../../../src/contracts/testing/voice-fixtures.js';
import { loadBootstrapConfig } from '../../../src/platform/config/bootstrap-config.js';
import { buildRuntimeSnapshot, defaultManageableSettings } from '../../../src/platform/config/manageable-config.js';
import { loadVoiceConfig } from '../../../src/platform/config/voice-config.js';
import { ServerIdentityResolver } from '../../../src/platform/identity/server-identity-resolver.js';
import { LiveKitAdmission, type RoomServiceClientLike } from '../../../src/voice/session/livekit-admission.js';
import type { VoiceSessionOptions } from '../../../src/voice/session/voice-session.options.js';

export const origin = 'http://127.0.0.1:5173';
export const request = { protocolVersion: 1 as const, mode: 'dictation' as const,
  conversationId: null, locale: 'en-US' as const, idempotencyKey: 'request-0001' };

export function fakeRoomService(): {
  client: RoomServiceClientLike;
  admission: LiveKitAdmission;
} {
  const client: RoomServiceClientLike = {
    deleteRoom: vi.fn(async () => undefined),
    removeParticipant: vi.fn(async () => undefined),
  };
  return {
    client,
    admission: new LiveKitAdmission(() => client),
  };
}

export function options(): VoiceSessionOptions & { roomClient: RoomServiceClientLike } {
  const livekit = livekitConfigFixture();
  const room = fakeRoomService();
  return {
    config: loadVoiceConfig({
      ENABLE_DICTATION_MODE: 'true',
      ENABLE_LIVE_VOICE_MODE: 'true',
      DEEPGRAM_API_KEY: 'fixture-secret',
      LIVEKIT_URL: livekit.url,
      LIVEKIT_API_KEY: livekit.apiKey,
      LIVEKIT_API_SECRET: livekit.apiSecret,
    }),
    frontendOrigin: origin, secureCookie: false,
    identity: new ServerIdentityResolver({ identity: { userId: 'server-user' } }),
    sessions: { get: vi.fn(async () => null) },
    reservations: {
      acquire: vi.fn(async c => ({ reservationId: 'reservation-1', userId: c.identity.userId,
        conversationId: c.conversationId, owner: c.owner })),
      bindConversation: vi.fn(async c => ({ reservationId: c.reservationId,
        userId: c.identity.userId, conversationId: c.conversationId,
        owner: { kind: 'live' as const, voiceSessionId: 'voice-1' } })),
      release: vi.fn(async () => undefined),
    },
    livekit: room.admission,
    roomClient: room.client,
    admission: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
    usage: vi.fn(async () => undefined), disconnected: vi.fn(async () => undefined),
    open: vi.fn(async () => ({ start: vi.fn(), input: vi.fn(async () => undefined),
      control: vi.fn(async () => undefined), close: vi.fn(async () => undefined) })),
  };
}

export function revisionFixture() {
  const livekit = livekitConfigFixture();
  function make(revision: number, edit: (s: ManageableSettings) => void = () => {}) {
    const settings = defaultManageableSettings();
    settings.voice.enabledModes = { dictation: true, live: true };
    edit(settings);
    return buildRuntimeSnapshot(loadBootstrapConfig({
      LIVEKIT_URL: livekit.url,
      LIVEKIT_API_KEY: livekit.apiKey,
      LIVEKIT_API_SECRET: livekit.apiSecret,
    }), {
      revision, settings, credentials: { openrouter: null, deepgram: `fixture-speech-${revision}` },
    }, null);
  }
  let value: RuntimeConfigSnapshot | null = make(1);
  const port: CurrentConfigPort = { current: () => value };
  return { port, make, publish: (next: RuntimeConfigSnapshot | null) => { value = next; } };
}
```

- [ ] **Step 3: Run `gateway.integration.spec.ts` and existing session suites to verify the fixture handoff passes**

Run in `backend/`:
```powershell
npm test -- test/voice/transport/gateway.integration.spec.ts test/voice/session/controller.spec.ts test/voice/session/config-snapshots.spec.ts
```
Expected: PASS (all 5 tests in `gateway.integration.spec.ts` pass, including `{ dictation: true, live: true }`).

- [ ] **Step 4: Commit Task 2**

```powershell
git add backend/src/voice/session/voice-session.options.ts backend/test/voice/session/fixtures.ts
git commit -m "test(voice): include LiveKit config and fake room service in session fixtures"
```

---

### Task 3: Wire Scoped LiveKit Admission, Reconnect & Bounded Teardown in `VoiceSessionService` and `VoiceSessionController`

**Files:**
- Modify: `backend/src/voice/session/voice-session.service.ts:1-320`
- Modify: `backend/src/voice/session/voice-session.controller.ts:28-40`
- Modify: `backend/test/voice/session/controller.spec.ts:19-155`
- Modify: `backend/test/voice/session/config-snapshots.spec.ts:20-143`

- [ ] **Step 1: Write failing tests in `backend/test/voice/session/controller.spec.ts` and `backend/test/voice/session/config-snapshots.spec.ts`**

In `backend/test/voice/session/controller.spec.ts`, update imports at lines 19–22 and add tests covering LiveKit transport issuance on `live` mode, dictation isolation, `claimLive` room/identity/epoch enforcement, reconnect epoch rotation and stale participant eviction, `sweep` expiry, single-execution teardown (`deleteRoom` + `cleanup` + `reservations.release`), and log/response redaction:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenVerifier } from 'livekit-server-sdk';
import {
  isLiveKitVoiceSessionResponse,
  livekitParticipantIdentity,
  livekitRoomName,
} from '../../../src/contracts/voice-wire.js';
import { redactSecrets } from '../../../src/platform/security/redact.js';
import { VoiceSessionController, VoiceHttpFilter } from '../../../src/voice/session/voice-session.controller.js';
import { VoiceSessionError } from '../../../src/voice/session/voice-session.options.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { options, origin, request } from './fixtures.js';
```

And append the following tests inside `describe('voice REST admission')` in `backend/test/voice/session/controller.spec.ts` (right after line 154):

```typescript
  it('issues scoped LiveKit credentials for live mode while keeping dictation WebSocket-only', async () => {
    const { s, o } = fixture();
    const dictationCreated = await s.create(request, origin);
    expect(dictationCreated.response.mode).toBe('dictation');
    expect(dictationCreated.response.livekit).toBeUndefined();
    expect(dictationCreated.cookie).toContain('aurvin_voice_ticket=');

    const liveCreated = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-request-1' },
      origin,
    );
    expect(isLiveKitVoiceSessionResponse(liveCreated.response)).toBe(true);
    expect(liveCreated.response.livekit).toMatchObject({
      url: 'ws://127.0.0.1:7880',
      roomName: livekitRoomName(liveCreated.response.sessionId),
      participantIdentity: livekitParticipantIdentity(
        'server-user',
        liveCreated.response.sessionId,
        0,
      ),
    });

    const verifier = new TokenVerifier(
      o.config.livekit!.apiKey,
      o.config.livekit!.apiSecret,
    );
    const claims = await verifier.verify(
      liveCreated.response.livekit!.participantToken,
      0,
    );
    expect(claims.sub).toBe(liveCreated.response.livekit!.participantIdentity);
    expect(claims.video).toEqual({
      roomCreate: false,
      roomJoin: true,
      room: livekitRoomName(liveCreated.response.sessionId),
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: ['microphone'],
      roomAdmin: false,
      roomList: false,
      roomRecord: false,
    });

    const serializedResponse = JSON.stringify(liveCreated.response);
    expect(serializedResponse).not.toContain(o.config.livekit!.apiSecret);
    expect(serializedResponse).not.toContain('aurvin-agent:');
    expect(JSON.stringify(redactSecrets(liveCreated.response))).not.toContain(
      liveCreated.response.livekit!.participantToken,
    );
  });

  it('rejects live session creation when LiveKit is unconfigured without disabling dictation or calling providers', async () => {
    const { s, o } = fixture();
    o.config.livekit = null;
    expect(s.config().enabledModes).toEqual({ dictation: true, live: false });

    await expect(
      s.create({ ...request, mode: 'live', idempotencyKey: 'live-disabled-1' }, origin),
    ).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
    expect(o.admission).not.toHaveBeenCalled();
    expect(o.reservations.acquire).not.toHaveBeenCalled();
    expect(o.open).not.toHaveBeenCalled();

    const dictation = await s.create(request, origin);
    expect(dictation.response.mode).toBe('dictation');
  });

  it('validates participant and room bindings in claimLive and blocks duplicate live owners', async () => {
    const { s } = fixture();
    const created = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-claim-1' },
      origin,
    );
    const { sessionId, livekit } = created.response;
    expect(livekit).toBeDefined();

    expect(() =>
      s.claimLive(sessionId, 'other-user:' + sessionId + ':0', livekit!.roomName),
    ).toThrow('VOICE_BINDING_MISMATCH');
    expect(() =>
      s.claimLive(sessionId, 'server-user:other-session:0', livekit!.roomName),
    ).toThrow('VOICE_BINDING_MISMATCH');
    expect(() =>
      s.claimLive(sessionId, livekit!.participantIdentity, 'aurvin-live-other'),
    ).toThrow('VOICE_BINDING_MISMATCH');
    expect(() =>
      s.claimLive(sessionId, `server-user:${sessionId}:1`, livekit!.roomName),
    ).toThrow('STALE_CONNECTION_EPOCH');

    const binding = s.claimLive(
      sessionId,
      livekit!.participantIdentity,
      livekit!.roomName,
    );
    expect(binding.state).toBe('active');
    expect(binding.livekitTicket?.agentIdentity).toBe(`aurvin-agent:${sessionId}`);

    expect(() =>
      s.claimLive(sessionId, livekit!.participantIdentity, livekit!.roomName),
    ).toThrow('VOICE_INVALID_STATE');
    expect(() => s.claim(created.cookie.split(';')[0], origin)).toThrow(
      'VOICE_BINDING_MISMATCH',
    );
  });

  it('rotates connectionEpoch, evicts stale participant, and mints fresh LiveKit credentials on reconnect', async () => {
    const { s, o } = fixture();
    const first = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-reconnect-1' },
      origin,
    );
    const firstIdentity = first.response.livekit!.participantIdentity;
    const binding = s.claimLive(
      first.response.sessionId,
      firstIdentity,
      first.response.livekit!.roomName,
    );

    await s.disconnected(binding, true);
    expect(binding.state).toBe('reconnecting');

    const reconnected = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-reconnect-1' },
      origin,
    );
    expect(reconnected.response.sessionId).toBe(first.response.sessionId);
    expect(reconnected.response.connectionEpoch).toBe(1);
    expect(reconnected.response.livekit!.roomName).toBe(first.response.livekit!.roomName);
    expect(reconnected.response.livekit!.participantIdentity).toBe(
      `server-user:${first.response.sessionId}:1`,
    );
    expect(o.roomClient.removeParticipant).toHaveBeenCalledWith(
      first.response.livekit!.roomName,
      firstIdentity,
    );
    expect(o.reservations.acquire).toHaveBeenCalledTimes(1);

    const repeatedReconnect = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-reconnect-1' },
      origin,
    );
    expect(repeatedReconnect.response.connectionEpoch).toBe(1);
    expect(o.roomClient.removeParticipant).toHaveBeenCalledTimes(1);

    expect(() =>
      s.claimLive(
        first.response.sessionId,
        firstIdentity,
        first.response.livekit!.roomName,
      ),
    ).toThrow('STALE_CONNECTION_EPOCH');

    const reclaimed = s.claimLive(
      reconnected.response.sessionId,
      reconnected.response.livekit!.participantIdentity,
      reconnected.response.livekit!.roomName,
    );
    expect(reclaimed.state).toBe('active');
  });

  it('tears down the LiveKit room and releases reservations exactly once across sweep, end, and drain without creating empty transcripts', async () => {
    vi.useFakeTimers();
    const { s, o } = fixture();
    const bridgeClose = vi.fn(async () => undefined);
    o.openLiveBridge = vi.fn(async () => ({ close: bridgeClose }));

    const created = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-sweep-1' },
      origin,
    );
    expect(created.response.conversationId).toBeNull();
    expect(o.openLiveBridge).toHaveBeenCalledTimes(1);

    await s.sweep(Date.now() + o.config.limits.connectMs + 1);
    await s.end(created.response.sessionId);
    await s.drain();

    expect(bridgeClose).toHaveBeenCalledTimes(1);
    expect(o.roomClient.deleteRoom).toHaveBeenCalledTimes(1);
    expect(o.roomClient.deleteRoom).toHaveBeenCalledWith(
      livekitRoomName(created.response.sessionId),
    );
    expect(o.reservations.release).toHaveBeenCalledTimes(1);
    expect(o.reservations.bindConversation).not.toHaveBeenCalled();
  });

  it('maps stale epoch and reconnect timeout errors to non-retryable HTTP status codes in VoiceHttpFilter', () => {
    const filter = new VoiceHttpFilter();
    const invoke = (error: unknown) => {
      let statusCode = 0;
      let payload: unknown;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn((code: number) => {
          statusCode = code;
          return {
            json: (body: unknown) => {
              payload = body;
            },
          };
        }),
      };
      filter.catch(error, {
        switchToHttp: () => ({ getResponse: () => res }),
      } as never);
      return { statusCode, payload };
    };

    expect(invoke(new VoiceSessionError('STALE_CONNECTION_EPOCH'))).toEqual({
      statusCode: 409,
      payload: {
        error: {
          code: 'STALE_CONNECTION_EPOCH',
          message: 'Voice is unavailable.',
          retryable: false,
        },
      },
    });
    expect(invoke(new VoiceSessionError('VOICE_RECONNECT_TIMEOUT'))).toEqual({
      statusCode: 410,
      payload: {
        error: {
          code: 'VOICE_RECONNECT_TIMEOUT',
          message: 'Voice is unavailable.',
          retryable: false,
        },
      },
    });
    expect(VoiceSessionController).toBeDefined();
  });
```

In `backend/test/voice/session/config-snapshots.spec.ts`, append a test verifying that an admitted live session retains its original LiveKit config snapshot across reconnect and teardown even if LiveKit is missing in a later snapshot:

```typescript
it('retains the admitted LiveKit config snapshot for reconnect and room teardown after live mode is disabled', async () => {
  const revisions = revisionFixture();
  const first = revisions.port.current()!;
  const o = { ...options(), currentConfig: revisions.port };
  const service = new VoiceSessionService(o);
  services.push(service);

  const created = await service.create({ ...request, mode: 'live' }, origin);
  expect(created.response.livekit?.roomName).toBe(`aurvin-live-${created.response.sessionId}`);
  const claimed = service.claimLive(
    created.response.sessionId,
    created.response.livekit!.participantIdentity,
    created.response.livekit!.roomName,
  );
  expect(claimed.configSnapshot).toBe(first);

  const withoutLiveKit = revisions.make(2, s => {
    s.voice.enabledModes = { dictation: true, live: false };
  });
  revisions.publish({
    ...withoutLiveKit,
    voice: { ...withoutLiveKit.voice, livekit: null },
  });
  o.config.livekit = null;
  expect(service.config().enabledModes).toEqual({ dictation: true, live: false });

  await service.disconnected(claimed, true);
  const reconnected = await service.create({ ...request, mode: 'live' }, origin);
  expect(reconnected.response.connectionEpoch).toBe(1);
  expect(reconnected.response.livekit?.participantIdentity).toBe(
    `server-user:${created.response.sessionId}:1`,
  );

  await service.end(created.response.sessionId);
  expect(o.roomClient.deleteRoom).toHaveBeenCalledWith(
    `aurvin-live-${created.response.sessionId}`,
  );
});
```

- [ ] **Step 2: Run the session tests to verify they fail**

Run in `backend/`:
```powershell
npm test -- test/voice/session/controller.spec.ts test/voice/session/config-snapshots.spec.ts
```
Expected: FAIL because `liveCreated.response.livekit` is `undefined` and `s.claimLive` / `s.sweep` are not yet implemented.

- [ ] **Step 3: Implement LiveKit admission, `claimLive`, reconnect eviction, `sweep`, and bounded teardown in `voice-session.service.ts` and `voice-session.controller.ts`**

Replace `backend/src/voice/session/voice-session.service.ts` with:

```typescript
/**
 * ============================================================================
 * FILE: voice-session.service.ts
 * LOCATION: backend/src/voice/session/voice-session.service.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Manages voice session lifecycle, tickets, LiveKit admission, and state transitions.
 *
 * ROLE IN PROJECT:
 *    Central process-local registry for voice sessions. Implements idempotent session
 *    creation, short-lived single-use ticket and LiveKit JWT issuance/claim, conversation
 *    binding, reconnect epoch rotation, and bounded room teardown/drain barriers.
 *
 * KEY COMPONENTS:
 *    - VoiceBinding: Internal state representation of an active/created voice session.
 *    - VoiceSessionService: Service handling session creation, tickets, cleanup, and reconnects.
 * ============================================================================
 */

import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { LiveKitConfig, VoiceConfig } from '../../contracts/config-runtime.js';
import type { LiveKitAdmissionPort } from '../../contracts/voice.js';
import {
  DEFAULT_VOICE_LIMITS,
  INPUT_AUDIO,
  LIVEKIT_TEARDOWN_TIMEOUT_MS,
  LIVEKIT_TOKEN_MAX_TTL_MS,
  OUTPUT_AUDIO,
  isCreateVoiceSessionRequest,
  livekitRoomName,
  type CreateVoiceSessionRequest,
  type CreateVoiceSessionResponse,
  type VoiceErrorCode,
} from '../../contracts/voice-wire.js';
import {
  effectiveVoiceModes,
  isLiveKitConfigured,
  publicVoiceConfig,
} from '../../platform/config/voice-config.js';
import {
  LiveKitAdmission,
  assertLiveKitParticipantBinding,
} from './livekit-admission.js';
import {
  VOICE_SESSION_OPTIONS,
  assertOrigin,
  fault,
  type CreateResult,
  type SessionContext,
  type VoiceSessionOptions,
} from './voice-session.options.js';

export type VoiceBinding = SessionContext & {
  request: CreateVoiceSessionRequest;
  state: 'created' | 'active' | 'reconnecting' | 'ended';
  token: string | null;
  tokenHash: string | null;
  deadline: number;
  admission: { release(): Promise<void>; assertActive?(): void };
  startedAt: number;
  blockedCode?: VoiceErrorCode;
  pause?: (reason: 'duration' | 'quota') => Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  cleanup?: () => Promise<void>;
  terminal?: (reason: 'duration' | 'idle' | 'quota' | 'shutdown') => void;
  warning?: (code: 'VOICE_DURATION_LIMIT' | 'VOICE_IDLE_TIMEOUT') => void;
  stopping?: Promise<void>;
  creating?: Promise<void>;
};

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class VoiceSessionService {
  private readonly entries = new Map<string, VoiceBinding>();
  private readonly pending = new Map<string, Promise<CreateResult>>();
  private readonly livekit: LiveKitAdmissionPort;
  private accepting = true;

  constructor(@Inject(VOICE_SESSION_OPTIONS) readonly options: VoiceSessionOptions) {
    this.livekit = options.livekit ?? new LiveKitAdmission();
  }

  private livekitConfig(voice: VoiceConfig | null | undefined): LiveKitConfig | null {
    if (!voice) return null;
    if (isLiveKitConfigured(voice.livekit)) return voice.livekit;
    return isLiveKitConfigured(this.options.config.livekit)
      ? this.options.config.livekit
      : null;
  }

  private currentVoice(): VoiceConfig | null {
    return this.options.currentConfig
      ? this.options.currentConfig.current()?.voice ?? null
      : this.options.config;
  }

  private isModeEnabled(voice: VoiceConfig | null, mode: 'dictation' | 'live'): boolean {
    if (!voice) return false;
    return effectiveVoiceModes({ ...voice, livekit: this.livekitConfig(voice) })[mode];
  }

  config() {
    const voice = this.currentVoice();
    const result = voice
      ? publicVoiceConfig({ ...voice, livekit: this.livekitConfig(voice) })
      : {
          protocolVersion: 1 as const,
          enabledModes: { dictation: false, live: false },
          supportedLocales: ['en-US'] as ['en-US'],
          limits: { ...DEFAULT_VOICE_LIMITS },
          inputAudio: { ...INPUT_AUDIO },
          outputAudio: { ...OUTPUT_AUDIO },
        };
    if (!voice?.deepgram.apiKey) result.enabledModes = { dictation: false, live: false };
    return result;
  }

  private capture(): Pick<SessionContext, 'voiceConfig' | 'configSnapshot'> {
    if (this.options.currentConfig) {
      const snapshot = this.options.currentConfig.current();
      if (!snapshot) fault('VOICE_DISABLED');
      return { configSnapshot: snapshot, voiceConfig: snapshot.voice };
    }
    const voice = structuredClone(this.options.config);
    return {
      configSnapshot: null,
      voiceConfig: {
        ...voice,
        dictationWarningMs: Math.max(0, voice.limits.dictationMaxMs - 30_000) || null,
      },
    };
  }

  private key(identity: string, key: string) {
    return JSON.stringify([identity, key]);
  }

  private cloneResponse(response: CreateVoiceSessionResponse): CreateVoiceSessionResponse {
    return {
      ...response,
      ...(response.livekit ? { livekit: { ...response.livekit } } : {}),
      effectiveAudioSettings: {
        input: { ...response.effectiveAudioSettings.input },
        output: response.effectiveAudioSettings.output
          ? { ...response.effectiveAudioSettings.output }
          : null,
      },
      limits: { ...response.limits },
    };
  }

  private response(entry: VoiceBinding): CreateResult {
    // Duplicate active POST is idempotent, but cannot mint another socket ticket.
    if (!entry.token) return { response: this.cloneResponse(entry.response), cookie: '' };
    const maxAge = Math.max(1, Math.ceil((entry.deadline - Date.now()) / 1000));
    return {
      response: this.cloneResponse(entry.response),
      cookie: `aurvin_voice_ticket=${entry.token}; HttpOnly; SameSite=Strict; Path=/api/voice; Max-Age=${maxAge}${this.options.secureCookie ? '; Secure' : ''}`,
    };
  }

  private async issue(entry: VoiceBinding): Promise<void> {
    const now = Date.now();
    entry.token = randomBytes(32).toString('base64url');
    entry.tokenHash = digest(entry.token);
    entry.deadline = Math.min(
      entry.state === 'reconnecting' ? entry.deadline : Infinity,
      now + Math.min(LIVEKIT_TOKEN_MAX_TTL_MS, entry.response.limits.connectMs),
    );
    entry.response.expiresAt = new Date(entry.deadline).toISOString();

    if (entry.response.mode === 'live') {
      const livekit = this.livekitConfig(entry.voiceConfig);
      if (!livekit) fault('VOICE_DISABLED');
      const ticket = await this.livekit.issue({
        config: livekit,
        userId: entry.identity.userId,
        sessionId: entry.response.sessionId,
        connectionEpoch: entry.response.connectionEpoch,
        connectMs: Math.max(1000, entry.deadline - now),
        nowMs: now,
      });
      entry.livekitTicket = ticket;
      entry.response.livekit = { ...ticket.transport };
      if (this.options.openLiveBridge) {
        const handle = await this.options.openLiveBridge(entry, ticket);
        if (handle && typeof handle.close === 'function' && !entry.cleanup) {
          entry.cleanup = () => handle.close();
        }
      }
    }

    clearTimeout(entry.timer);
    entry.timer = setTimeout(
      () => {
        void this.end(entry.response.sessionId).catch(() => undefined);
      },
      Math.max(0, entry.deadline - Date.now()),
    );
  }

  async create(body: unknown, origin: string | undefined): Promise<CreateResult> {
    assertOrigin(this.options, origin);
    if (!isCreateVoiceSessionRequest(body)) fault('INVALID_VOICE_REQUEST');
    if (!this.accepting) fault('VOICE_DISABLED');
    const identity = this.options.identity.resolve();
    const key = this.key(identity.userId, body.idempotencyKey);
    const inFlight = this.pending.get(key);
    if (inFlight) {
      const result = await inFlight;
      const entry = this.entries.get(result.response.sessionId);
      if (!entry || !this.matches(entry, body)) fault('VOICE_BINDING_MISMATCH');
      return this.response(entry);
    }
    const operation = this.createOnce(body, identity);
    this.pending.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(key) === operation) this.pending.delete(key);
    }
  }

  private matches(e: VoiceBinding, r: CreateVoiceSessionRequest) {
    return (
      e.request.mode === r.mode &&
      e.request.locale === r.locale &&
      (e.request.conversationId === r.conversationId ||
        e.response.conversationId === r.conversationId)
    );
  }

  private async createOnce(
    body: CreateVoiceSessionRequest,
    identity: SessionContext['identity'],
  ): Promise<CreateResult> {
    const old = [...this.entries.values()].find(
      (e) =>
        e.identity.userId === identity.userId &&
        e.request.idempotencyKey === body.idempotencyKey,
    );
    if (old) {
      if (!this.matches(old, body)) fault('VOICE_BINDING_MISMATCH');
      if (old.state === 'ended') fault('VOICE_SESSION_ENDED');
      if (old.state === 'active') return this.response(old);
      if (old.deadline <= Date.now()) {
        const expiredCode =
          old.state === 'reconnecting' ? 'VOICE_RECONNECT_TIMEOUT' : 'VOICE_CONNECT_TIMEOUT';
        await this.end(old.response.sessionId);
        fault(expiredCode);
      }
      if (old.state === 'reconnecting') {
        await old.stopping;
        if (
          this.entries.get(old.response.sessionId)?.state === 'ended' ||
          old.deadline <= Date.now()
        ) {
          await this.end(old.response.sessionId);
          fault('VOICE_RECONNECT_TIMEOUT');
        }
        // A repeated HTTP request reuses the already-issued ticket/epoch until it is consumed.
        if (!old.token) {
          if (old.response.connectionEpoch === 0xffffffff) fault('VOICE_SEQUENCE_ERROR');
          const previousIdentity = old.response.livekit?.participantIdentity;
          old.response.connectionEpoch++;
          try {
            if (old.response.mode === 'live' && previousIdentity) {
              const livekit = this.livekitConfig(old.voiceConfig);
              if (livekit && this.livekit.evictParticipant) {
                await this.livekit.evictParticipant({
                  config: livekit,
                  roomName:
                    old.response.livekit?.roomName ?? livekitRoomName(old.response.sessionId),
                  participantIdentity: previousIdentity,
                  timeoutMs: LIVEKIT_TEARDOWN_TIMEOUT_MS,
                });
              }
            }
            await this.issue(old);
          } catch (error) {
            await this.end(old.response.sessionId);
            throw error;
          }
        }
      }
      return this.response(old);
    }

    const current = this.currentVoice();
    if (!this.isModeEnabled(current, body.mode)) fault('VOICE_DISABLED');
    const captured = this.capture();

    if (
      body.conversationId !== null &&
      !(await this.options.sessions.get(identity.userId, body.conversationId))
    ) {
      fault('VOICE_BINDING_MISMATCH');
    }

    const response: SessionContext['response'] = {
      protocolVersion: 1,
      sessionId: randomUUID(),
      conversationId: body.conversationId,
      mode: body.mode,
      connectionEpoch: 0,
      websocketUrl: '/api/voice',
      expiresAt: new Date().toISOString(),
      effectiveAudioSettings: {
        input: INPUT_AUDIO,
        output: body.mode === 'live' ? OUTPUT_AUDIO : null,
      },
      limits: { ...captured.voiceConfig.limits },
    };
    const context: SessionContext = {
      identity,
      response,
      reservation: null,
      livekitTicket: null,
      ...captured,
    };
    const startedAt = Date.now();
    const admission = await this.options.admission(context);
    let registered = false;
    try {
      // Recheck after the asynchronous policy: reserve registry capacity synchronously.
      const voice = this.currentVoice();
      if (!this.accepting || !this.isModeEnabled(voice, body.mode)) fault('VOICE_DISABLED');
      const active = [...this.entries.values()].filter((e) => e.state !== 'ended');
      if (
        active.length >= voice!.quotas.globalConcurrent ||
        active.filter((e) => e.identity.userId === identity.userId).length >=
          voice!.quotas.identityConcurrent
      ) {
        fault('VOICE_QUOTA_EXHAUSTED');
      }
      // ponytail: at most 1024 ten-second tombstones; reject rather than evict live idempotency evidence.
      if (this.entries.size >= 1024) fault('VOICE_QUOTA_EXHAUSTED');

      let creationDone!: () => void;
      const creating = new Promise<void>((resolve) => {
        creationDone = resolve;
      });
      const entry: VoiceBinding = {
        ...context,
        request: { ...body },
        state: 'created',
        token: null,
        tokenHash: null,
        deadline: 0,
        admission,
        startedAt,
        creating,
      };
      entry.assertPaidWork = () => this.assertPaidWork(entry);
      this.entries.set(response.sessionId, entry);
      registered = true;

      try {
        if (body.mode === 'live') {
          entry.reservation = await this.options.reservations.acquire({
            identity,
            conversationId: body.conversationId,
            owner: { kind: 'live', voiceSessionId: response.sessionId },
          });
        }
        if (!this.accepting || entry.state === 'ended') fault('VOICE_DISABLED');
        await this.issue(entry);
        if (!this.accepting || entry.state === 'ended') fault('VOICE_DISABLED');
        return this.response(entry);
      } catch (error) {
        creationDone();
        await this.end(response.sessionId);
        if (
          error !== null &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'CONFLICT_ACTIVE_TURN'
        ) {
          fault('CONFLICT_ACTIVE_TURN');
        }
        throw error;
      } finally {
        creationDone();
      }
    } catch (error) {
      if (!registered) await admission.release();
      throw error;
    }
  }

  claim(cookie: string | undefined, origin: string | undefined): VoiceBinding {
    assertOrigin(this.options, origin);
    if (!this.accepting) fault('VOICE_DISABLED');
    const parts = (cookie ?? '')
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p.startsWith('aurvin_voice_ticket='));
    if (parts.length !== 1) fault('VOICE_BINDING_MISMATCH');
    const token = parts[0].slice('aurvin_voice_ticket='.length);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fault('VOICE_BINDING_MISMATCH');
    const hash = digest(token),
      identity = this.options.identity.resolve();
    const entry = [...this.entries.values()].find((e) => e.tokenHash === hash);
    if (!entry || entry.identity.userId !== identity.userId) fault('VOICE_BINDING_MISMATCH');
    if (entry.state === 'ended') fault('VOICE_SESSION_ENDED');
    if (entry.deadline <= Date.now()) fault('VOICE_CONNECT_TIMEOUT');
    if (!['created', 'reconnecting'].includes(entry.state)) fault('VOICE_INVALID_STATE');
    entry.assertPaidWork?.();
    // Consume synchronously before any provider/socket work; a second claim cannot race this one.
    entry.token = null;
    entry.tokenHash = null;
    clearTimeout(entry.timer);
    entry.state = 'active';
    return entry;
  }

  claimLive(
    sessionId: string,
    participantIdentity?: string,
    roomName?: string,
  ): VoiceBinding {
    if (!this.accepting) fault('VOICE_DISABLED');
    const identity = this.options.identity.resolve();
    const entry = this.entries.get(sessionId);
    if (!entry || entry.response.mode !== 'live' || entry.identity.userId !== identity.userId) {
      fault('VOICE_BINDING_MISMATCH');
    }
    const expectedRoom =
      entry.response.livekit?.roomName ?? livekitRoomName(entry.response.sessionId);
    if (participantIdentity !== undefined) {
      assertLiveKitParticipantBinding(
        {
          userId: entry.identity.userId,
          sessionId: entry.response.sessionId,
          connectionEpoch: entry.response.connectionEpoch,
          roomName: expectedRoom,
        },
        {
          participantIdentity,
          roomName,
        },
      );
    } else if (roomName !== undefined && roomName !== expectedRoom) {
      fault('VOICE_BINDING_MISMATCH');
    }
    if (entry.state === 'ended') fault('VOICE_SESSION_ENDED');
    if (entry.deadline <= Date.now()) fault('VOICE_CONNECT_TIMEOUT');
    if (!['created', 'reconnecting'].includes(entry.state)) fault('VOICE_INVALID_STATE');
    entry.assertPaidWork?.();
    entry.token = null;
    entry.tokenHash = null;
    clearTimeout(entry.timer);
    entry.state = 'active';
    return entry;
  }

  async end(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.identity.userId !== this.options.identity.resolve().userId) {
      fault('VOICE_BINDING_MISMATCH');
    }
    await entry.creating;
    if (entry.state === 'ended') {
      await entry.stopping;
      return;
    }
    entry.state = 'ended';
    entry.token = null;
    entry.tokenHash = null;
    clearTimeout(entry.timer);
    entry.stopping = (async () => {
      try {
        await entry.cleanup?.();
      } finally {
        try {
          if (entry.response.mode === 'live') {
            const livekit = this.livekitConfig(entry.voiceConfig);
            if (livekit) {
              await this.livekit.teardownRoom({
                config: livekit,
                roomName:
                  entry.response.livekit?.roomName ?? livekitRoomName(entry.response.sessionId),
                timeoutMs: LIVEKIT_TEARDOWN_TIMEOUT_MS,
              });
            }
          }
        } finally {
          try {
            if (entry.reservation) {
              await this.options.reservations.release({
                identity: entry.identity,
                reservationId: entry.reservation.reservationId,
              });
            }
          } finally {
            await entry.admission.release();
          }
        }
      }
    })();
    try {
      await entry.stopping;
    } finally {
      entry.timer = setTimeout(() => this.entries.delete(id), 10000);
      entry.timer.unref?.();
    }
  }

  async stop(id: string, reason: 'duration' | 'idle' | 'quota' | 'shutdown') {
    const entry = this.entries.get(id);
    if (!entry || entry.state === 'ended') return;
    if (entry.response.mode === 'live' && reason !== 'shutdown') {
      if (reason === 'idle' || entry.blockedCode) return;
      entry.blockedCode =
        reason === 'duration' ? 'VOICE_DURATION_LIMIT' : 'VOICE_QUOTA_EXHAUSTED';
      await entry.pause?.(reason);
      return;
    }
    try {
      entry.terminal?.(reason);
    } finally {
      await this.end(id);
    }
  }

  async sweep(now = Date.now()): Promise<void> {
    const expiredIds: string[] = [];
    for (const [id, entry] of this.entries) {
      if (
        (entry.state === 'created' || entry.state === 'reconnecting') &&
        entry.deadline <= now
      ) {
        expiredIds.push(id);
      }
    }
    await Promise.allSettled(expiredIds.map((id) => this.end(id)));
  }

  private assertPaidWork(entry: VoiceBinding) {
    if (entry.state === 'ended') fault('VOICE_SESSION_ENDED');
    if (entry.identity.userId !== this.options.identity.resolve().userId) {
      fault('VOICE_BINDING_MISMATCH');
    }
    if (entry.blockedCode) fault(entry.blockedCode);
    const cap =
      entry.response.mode === 'live'
        ? entry.response.limits.liveMaxMs
        : entry.response.limits.dictationMaxMs;
    if (Date.now() - entry.startedAt >= cap) {
      entry.blockedCode = 'VOICE_DURATION_LIMIT';
      fault(entry.blockedCode);
    }
    entry.admission.assertActive?.();
  }

  warn(id: string, code: 'VOICE_DURATION_LIMIT' | 'VOICE_IDLE_TIMEOUT') {
    const entry = this.entries.get(id);
    if (entry?.state === 'active') {
      try {
        entry.warning?.(code);
      } catch {
        /* A lost warning must not crash a policy timer. */
      }
    }
  }

  async disconnected(entry: VoiceBinding, recover: boolean): Promise<void> {
    if (entry.state === 'ended') return;
    if (!recover || entry.response.mode === 'dictation' || !this.accepting) {
      await this.end(entry.response.sessionId);
      return;
    }
    if (entry.state === 'reconnecting') return;
    entry.state = 'reconnecting';
    entry.token = null;
    entry.tokenHash = null;
    entry.deadline = Date.now() + entry.response.limits.reconnectMs;
    entry.stopping = (async () => {
      await entry.cleanup?.();
      await this.options.disconnected(entry);
    })();
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      void this.end(entry.response.sessionId).catch(() => undefined);
    }, entry.response.limits.reconnectMs);
    try {
      await entry.stopping;
    } catch (error) {
      await this.end(entry.response.sessionId);
      throw error;
    }
  }

  async bindConversation(id: string, conversationId: string): Promise<void> {
    const entry = this.entries.get(id);
    if (
      !entry ||
      entry.state !== 'active' ||
      entry.response.mode !== 'live' ||
      !entry.reservation
    ) {
      fault('VOICE_INVALID_STATE');
    }
    if (
      entry.response.conversationId !== null &&
      entry.response.conversationId !== conversationId
    ) {
      fault('VOICE_BINDING_MISMATCH');
    }
    entry.reservation = await this.options.reservations.bindConversation({
      identity: entry.identity,
      reservationId: entry.reservation.reservationId,
      conversationId,
    });
    entry.response.conversationId = conversationId;
  }

  stopAccepting() {
    this.accepting = false;
  }

  snapshot() {
    return {
      accepting: this.accepting,
      active: [...this.entries.values()].filter((e) => e.state !== 'ended').length,
    };
  }

  async drain() {
    this.stopAccepting();
    await Promise.allSettled([...this.pending.values()]);
    const results = await Promise.allSettled(
      [...this.entries.keys()].map((id) => this.end(id)),
    );
    for (const e of this.entries.values()) clearTimeout(e.timer);
    this.entries.clear();
    if (results.some((r) => r.status === 'rejected')) fault('VOICE_DELIVERY_UNKNOWN');
  }
}
```

In `backend/src/voice/session/voice-session.controller.ts` (lines 28–40), update `VoiceHttpFilter` to map `STALE_CONNECTION_EPOCH` to 409 and `VOICE_RECONNECT_TIMEOUT` to 410:

```typescript
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
```

- [ ] **Step 4: Run the session and voice test suites to verify all tests pass**

Run in `backend/`:
```powershell
npm test -- test/voice/session/controller.spec.ts test/voice/session/config-snapshots.spec.ts test/voice/session/dictation.spec.ts test/voice/session/live.spec.ts test/voice/session/livekit-admission.spec.ts
```
Expected: PASS across all 5 test files in `test/voice/session/`.

- [ ] **Step 5: Commit Task 3**

```powershell
git add backend/src/voice/session/voice-session.service.ts backend/src/voice/session/voice-session.controller.ts backend/test/voice/session/controller.spec.ts backend/test/voice/session/config-snapshots.spec.ts
git commit -m "feat(voice): wire scoped LiveKit session admission, reconnect, and room teardown"
```

---

## Final Verification for P2 Worker

After completing Tasks 1–3, run the focused and package verification commands in `backend/` before reporting completion:

- [ ] **Step 1: Run focused P2 session and transport verification suites**
```powershell
cd backend
npm test -- test/voice/session/livekit-admission.spec.ts test/voice/session/controller.spec.ts test/voice/session/config-snapshots.spec.ts test/voice/session/dictation.spec.ts test/voice/session/live.spec.ts test/voice/transport/gateway.spec.ts test/voice/transport/gateway.integration.spec.ts test/voice/integration/canvas-multimodal.spec.ts
```
Expected: All 8 voice test suites pass (0 failed, including `gateway.integration.spec.ts` `{ dictation: true, live: true }`).

- [ ] **Step 2: Run backend build and lint**
```powershell
npm run build
npm run lint
```
Expected: `nest build` exits 0; `oxlint --type-aware src/ test/` exits 0.

- [ ] **Step 3: Check Git hygiene and ownership**
```powershell
cd ..
git diff --check
git status --short
```
Expected: `git diff --check` produces no output; modified/added files are strictly within P2's owned paths (`backend/src/voice/session/*` and `backend/test/voice/session/*`). No signed access tokens appear in any committed artifact or log output.
