/**
 * ============================================================================
 * FILE: controller.spec.ts
 * LOCATION: backend/test/voice/session/controller.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for voice session admission, configuration projection, and creation.
 *
 * ROLE IN PROJECT:
 *    Validates that VoiceSessionService and Controller enforce strict origin checking,
 *    DTO validation, identity binding, safe error semantics, scoped LiveKit admission,
 *    reconnect epoch rotation, and single-release teardown.
 *
 * KEY COMPONENTS:
 *    - Admission tests (origin, DTO, disabled modes, identity binding).
 *    - LiveKit transport/claim/reconnect/teardown and HTTP status mapping tests.
 * ============================================================================
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenVerifier } from 'livekit-server-sdk';
import {
  isLiveKitVoiceSessionResponse,
  livekitParticipantIdentity,
  livekitRoomName,
} from '../../../src/contracts/voice-wire.js';
import { redactSecrets } from '../../../src/platform/security/redact.js';
import {
  VoiceHttpFilter,
  VoiceSessionController,
} from '../../../src/voice/session/voice-session.controller.js';
import { VoiceSessionError } from '../../../src/voice/session/voice-session.options.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { options, origin, request, owner } from './fixtures.js';

const services: VoiceSessionService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.drain())); vi.useRealTimers(); });

function fixture() { const o = options(); const s = new VoiceSessionService(o); services.push(s); return { o, s }; }

describe('voice REST admission', () => {
  it('projects config without provider settings', () => {
    const { s } = fixture();
    expect(s.config()).toMatchObject({ protocolVersion: 1, supportedLocales: ['en-US'] });
    expect(JSON.stringify(s.config())).not.toContain('fixture-secret');
  });

  it.each([{ ...request, userId: 'attacker' }, { ...request, model: 'other' },
    { ...request, protocolVersion: 2 }, { ...request, locale: 'hi-IN' },
    { ...request, conversationId: '' }])('rejects malformed DTO before allocation: %j', async body => {
    const { s, o } = fixture();
    await expect(s.create(body, origin, owner)).rejects.toMatchObject({ code: 'INVALID_VOICE_REQUEST' });
    expect(o.admission).not.toHaveBeenCalled(); expect(o.open).not.toHaveBeenCalled();
  });

  it('rejects missing/wrong Origin and disabled mode before admission', async () => {
    const { s, o } = fixture();
    await expect(s.create(request, undefined)).rejects.toMatchObject({ code: 'INVALID_ORIGIN' });
    await expect(s.create(request, 'https://evil.example')).rejects.toMatchObject({ code: 'INVALID_ORIGIN' });
    o.config.enabledModes.dictation = false;
    await expect(s.create(request, origin, owner)).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
    expect(o.admission).not.toHaveBeenCalled();
  });

  it('checks the resolved identity; New Chat stays unsaved', async () => {
    const { s, o } = fixture();
    await expect(s.create({ ...request, conversationId: 'foreign' }, origin, owner))
      .rejects.toMatchObject({ code: 'VOICE_BINDING_MISMATCH' });
    expect(o.sessions.get).toHaveBeenCalledWith('server-user', 'foreign');
    const created = await s.create(request, origin, owner);
    expect(created.response.conversationId).toBeNull();
    expect(o.reservations.acquire).not.toHaveBeenCalled(); expect(o.open).not.toHaveBeenCalled();
  });

  it('single-use cookie ticket has no URL/body secret and a replay cannot allocate', async () => {
    const { s, o } = fixture(); const result = await s.create(request, origin, owner);
    expect(result.cookie).toContain('HttpOnly; SameSite=Strict; Path=/api/voice');
    expect(result.response.websocketUrl).toBe('/api/voice');
    expect(Object.keys(result.response)).not.toContain('ticket');
    const cookie = result.cookie.split(';')[0]; const binding = s.claim(cookie, origin, owner);
    expect(binding.identity.userId).toBe('server-user');
    expect(() => s.claim(cookie, origin, owner)).toThrow('VOICE_BINDING_MISMATCH');
    expect(o.open).not.toHaveBeenCalled();
  });

  it('coalesces concurrent creation and rejects a key reused with different mode', async () => {
    const { s, o } = fixture();
    const [a, b] = await Promise.all([s.create(request, origin, owner), s.create(request, origin, owner)]);
    expect(a).toEqual(b); expect(o.admission).toHaveBeenCalledTimes(1);
    await expect(s.create({ ...request, mode: 'live' }, origin, owner)).rejects.toMatchObject({ code: 'VOICE_BINDING_MISMATCH' });
  });

  it('expires unconnected sessions and DELETE releases each owner once', async () => {
    vi.useFakeTimers(); const { s, o } = fixture();
    const created = await s.create({ ...request, mode: 'live' }, origin, owner);
    await vi.advanceTimersByTimeAsync(o.config.limits.connectMs);
    await s.end(created.response.sessionId); await s.end(created.response.sessionId);
    expect(o.reservations.release).toHaveBeenCalledTimes(1); expect(s.snapshot().active).toBe(0);
  });

  it('drain waits for admission and reservation creation without double release', async () => {
    const { s, o } = fixture();
    let resolve!: (value: Awaited<ReturnType<typeof o.reservations.acquire>>) => void;
    const held = new Promise<Awaited<ReturnType<typeof o.reservations.acquire>>>(r => { resolve = r; });
    const release = vi.fn(async () => undefined);
    o.admission = vi.fn(async () => ({ release }));
    o.reservations.acquire = vi.fn(() => held);
    const creation = s.create({ ...request, mode: 'live' }, origin, owner);
    const rejected = expect(creation).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
    await Promise.resolve(); await Promise.resolve();
    const draining = s.drain();
    resolve({ reservationId: 'r1', userId: 'server-user', conversationId: null,
      owner: { kind: 'live', voiceSessionId: 'v1' } });
    await rejected; await draining;
    expect(o.reservations.release).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(['duration', 'quota'] as const)('retains the same admitted call after a %s stop', async reason => {
    const { s, o } = fixture();
    const created = await s.create({ ...request, mode: 'live' }, origin, owner);
    const binding = s.claim(created.cookie.split(';')[0], origin, owner);
    binding.pause = vi.fn(async () => undefined);
    binding.cleanup = vi.fn(async () => undefined);
    binding.terminal = vi.fn();
    await s.stop(created.response.sessionId, reason);
    await s.stop(created.response.sessionId, reason);
    expect(binding.pause).toHaveBeenCalledTimes(1);
    expect(binding.pause).toHaveBeenCalledWith(reason);
    expect(binding.terminal).not.toHaveBeenCalled();
    expect(binding.cleanup).not.toHaveBeenCalled();
    expect(s.snapshot().active).toBe(1);
    expect(() => binding.assertPaidWork?.()).toThrowError(
      reason === 'quota' ? 'VOICE_QUOTA_EXHAUSTED' : 'VOICE_DURATION_LIMIT');
    const duplicate = await s.create({ ...request, mode: 'live' }, origin, owner);
    expect(duplicate.response.sessionId).toBe(created.response.sessionId);
    expect(duplicate.cookie).toBe('');
    expect(o.admission).toHaveBeenCalledTimes(1);
    expect(o.reservations.acquire).toHaveBeenCalledTimes(1);
    expect(o.reservations.release).not.toHaveBeenCalled();
    await s.end(created.response.sessionId);
    expect(o.reservations.release).toHaveBeenCalledTimes(1);
  });

  it('does not turn the legacy idle stop into a live terminal event', async () => {
    const { s } = fixture();
    const created = await s.create({ ...request, mode: 'live' }, origin, owner);
    const binding = s.claim(created.cookie.split(';')[0], origin, owner);
    binding.terminal = vi.fn(); binding.pause = vi.fn(async () => undefined);
    await s.stop(created.response.sessionId, 'idle');
    expect(binding.terminal).not.toHaveBeenCalled();
    expect(binding.pause).not.toHaveBeenCalled();
    expect(s.snapshot().active).toBe(1);
  });

  it('checks original duration and admission on resume without re-admitting', async () => {
    vi.useFakeTimers();
    const { s, o } = fixture();
    const assertActive = vi.fn();
    o.admission = vi.fn(async () => ({ release: vi.fn(async () => undefined), assertActive }));
    const created = await s.create({ ...request, mode: 'live' }, origin, owner);
    const binding = s.claim(created.cookie.split(';')[0], origin, owner);
    binding.assertPaidWork?.();
    expect(assertActive).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(binding.response.limits.liveMaxMs);
    expect(() => binding.assertPaidWork?.()).toThrowError('VOICE_DURATION_LIMIT');
    expect(o.admission).toHaveBeenCalledTimes(1);
  });

  it('issues scoped LiveKit credentials for live mode while keeping dictation WebSocket-only', async () => {
    const { s, o } = fixture();
    const dictationCreated = await s.create(request, origin, owner);
    expect(dictationCreated.response.mode).toBe('dictation');
    expect(dictationCreated.response.livekit).toBeUndefined();
    expect(dictationCreated.cookie).toContain('aurvin_voice_ticket=');
    await s.end(dictationCreated.response.sessionId);

    const liveCreated = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-request-1' },
      origin, owner);
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
      s.create({ ...request, mode: 'live', idempotencyKey: 'live-disabled-1' }, origin, owner),
    ).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
    expect(o.admission).not.toHaveBeenCalled();
    expect(o.reservations.acquire).not.toHaveBeenCalled();
    expect(o.open).not.toHaveBeenCalled();

    const dictation = await s.create(request, origin, owner);
    expect(dictation.response.mode).toBe('dictation');
  });

  it('validates participant and room bindings in claimLive and blocks duplicate live owners', async () => {
    const { s } = fixture();
    const created = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-claim-1' },
      origin, owner);
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
    expect(() => s.claim(created.cookie.split(';')[0], origin, owner)).toThrow(
      'VOICE_BINDING_MISMATCH',
    );
  });

  it('rotates connectionEpoch, evicts stale participant, and mints fresh LiveKit credentials on reconnect', async () => {
    const { s, o } = fixture();
    const first = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-reconnect-1' },
      origin, owner);
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
      origin, owner);
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
      origin, owner);
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
      origin, owner);
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

  it('tears down the LiveKit room and releases reservations exactly once on stop, disconnected, and drain', async () => {
    for (const path of ['stop', 'disconnected', 'drain'] as const) {
      const { s, o } = fixture();
      const created = await s.create(
        { ...request, mode: 'live', idempotencyKey: `live-${path}-1` },
        origin, owner);
      const binding = s.claimLive(
        created.response.sessionId,
        created.response.livekit!.participantIdentity,
        created.response.livekit!.roomName,
      );

      if (path === 'stop') await s.stop(created.response.sessionId, 'shutdown');
      else if (path === 'disconnected') await s.disconnected(binding, false);
      else await s.drain();

      await s.end(created.response.sessionId);

      expect(o.roomClient.deleteRoom).toHaveBeenCalledTimes(1);
      expect(o.roomClient.deleteRoom).toHaveBeenCalledWith(
        livekitRoomName(created.response.sessionId),
      );
      expect(o.reservations.release).toHaveBeenCalledTimes(1);
      expect(o.admission).toHaveBeenCalledTimes(1);
    }
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

  it('enforces expected mode in claim, rejecting live tickets for dictation without consuming them (H1)', async () => {
    const { s, o } = fixture();
    o.config.quotas.identityConcurrent = 5;
    const liveCreated = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-h1-1' },
      origin, owner);
    const liveCookie = liveCreated.cookie.split(';')[0];

    // Asserting dictation on a live ticket throws VOICE_BINDING_MISMATCH
    expect(() => s.claim(liveCookie, origin, owner, 'dictation')).toThrow(
      'VOICE_BINDING_MISMATCH',
    );

    // The live ticket was NOT consumed and can still be claimed via claimLive()
    const liveBinding = s.claimLive(
      liveCreated.response.sessionId,
      liveCreated.response.livekit!.participantIdentity,
      liveCreated.response.livekit!.roomName,
    );
    expect(liveBinding.state).toBe('active');

    // Dictation ticket asserted as live throws without consuming
    const dictCreated = await s.create(
      { ...request, mode: 'dictation', idempotencyKey: 'dict-h1-1' },
      origin, owner);
    const dictCookie = dictCreated.cookie.split(';')[0];
    expect(() => s.claim(dictCookie, origin, owner, 'live')).toThrow(
      'VOICE_BINDING_MISMATCH',
    );

    // Can still be claimed with dictation
    const dictBinding = s.claim(dictCookie, origin, owner, 'dictation');
    expect(dictBinding.state).toBe('active');

    // Backward compatibility: claim without expectedMode succeeds for matching state
    const compatCreated = await s.create(
      { ...request, mode: 'dictation', idempotencyKey: 'dict-h1-2' },
      origin, owner);
    const compatBinding = s.claim(compatCreated.cookie.split(';')[0], origin, owner);
    expect(compatBinding.state).toBe('active');
  });

  it('session drain publishes one terminal session.ended with reason shutdown for each active live session before cleanup exactly once (H3)', async () => {
    const { s, o } = fixture();
    o.config.quotas.identityConcurrent = 5;
    const live1 = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-h3-1' },
      origin, owner);
    const live2 = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-h3-2' },
      origin, owner);
    await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-h3-unclaimed' },
      origin, owner);
    const dictation = await s.create(
      { ...request, mode: 'dictation', idempotencyKey: 'dict-h3-1' },
      origin, owner);

    const binding1 = s.claimLive(
      live1.response.sessionId,
      live1.response.livekit!.participantIdentity,
      live1.response.livekit!.roomName,
    );
    const binding2 = s.claimLive(
      live2.response.sessionId,
      live2.response.livekit!.participantIdentity,
      live2.response.livekit!.roomName,
    );
    const dictBinding = s.claim(dictation.cookie.split(';')[0], origin, owner, 'dictation');

    const term1 = vi.fn();
    const term2 = vi.fn();
    const dictTerm = vi.fn();
    binding1.terminal = term1;
    binding2.terminal = term2;
    dictBinding.terminal = dictTerm;

    let cleanupCalledBeforeTerminal = false;
    binding1.cleanup = vi.fn(async () => {
      if (!term1.mock.calls.length) cleanupCalledBeforeTerminal = true;
    });

    // Drain should publish terminal 'shutdown' for active live sessions before cleanup
    await s.drain();

    expect(cleanupCalledBeforeTerminal).toBe(false);
    expect(term1).toHaveBeenCalledTimes(1);
    expect(term1).toHaveBeenCalledWith('shutdown');
    expect(term2).toHaveBeenCalledTimes(1);
    expect(term2).toHaveBeenCalledWith('shutdown');
    expect(dictTerm).not.toHaveBeenCalled();

    // Idempotency: second drain does not publish terminal again
    await s.drain();
    expect(term1).toHaveBeenCalledTimes(1);
    expect(term2).toHaveBeenCalledTimes(1);
  });

  it('drain is idempotent when a live session was already stopped with shutdown (H3)', async () => {
    const { s } = fixture();
    const live = await s.create(
      { ...request, mode: 'live', idempotencyKey: 'live-h3-prior-stop' },
      origin, owner);
    const binding = s.claimLive(
      live.response.sessionId,
      live.response.livekit!.participantIdentity,
      live.response.livekit!.roomName,
    );
    const terminal = vi.fn();
    binding.terminal = terminal;

    await s.stop(live.response.sessionId, 'shutdown');
    expect(terminal).toHaveBeenCalledTimes(1);
    expect(terminal).toHaveBeenCalledWith('shutdown');

    // Now drain runs
    await s.drain();
    // Must NOT call terminal a second time
    expect(terminal).toHaveBeenCalledTimes(1);
  });
});
