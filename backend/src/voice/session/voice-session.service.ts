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
import type { AuthPrincipal } from '../../contracts/auth.js';
import { requireFullAccount } from '../../auth/access.js';
import type { LiveKitConfig, VoiceConfig } from '../../contracts/config-runtime.js';
import type { LiveKitAdmissionPort } from '../../contracts/voice.js';
import { DEFAULT_VOICE_LIMITS, isCreateVoiceSessionRequest, INPUT_AUDIO, OUTPUT_AUDIO,
  LIVEKIT_TEARDOWN_TIMEOUT_MS, LIVEKIT_TOKEN_MAX_TTL_MS, livekitRoomName,
  type CreateVoiceSessionRequest, type VoiceErrorCode, type VoiceMode } from '../../contracts/voice-wire.js';
import { effectiveVoiceModes, isLiveKitConfigured,
  publicVoiceConfig } from '../../platform/config/voice-config.js';
import { LiveKitAdmission, assertLiveKitParticipantBinding } from './livekit-admission.js';
import { VOICE_SESSION_OPTIONS, assertOrigin, fault, type CreateResult,
  type SessionContext, type VoiceSessionOptions } from './voice-session.options.js';

export type VoiceBinding = SessionContext & {
  authSessionId: string;
  sessionEpoch: number;
  request: CreateVoiceSessionRequest;
  state: 'created' | 'active' | 'reconnecting' | 'ended';
  token: string | null; tokenHash: string | null; deadline: number;
  admission: { release(): Promise<void>; assertActive?(): void };
  startedAt: number;
  blockedCode?: VoiceErrorCode;
  pause?: (reason: 'duration' | 'quota') => Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  cleanup?: () => Promise<void>;
  livekitCleanup?: () => Promise<void>;
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
    // LiveKit is bootstrap-only; a snapshot that omits it still admits the server capability.
    return isLiveKitConfigured(this.options.config.livekit) ? this.options.config.livekit : null;
  }

  private currentVoice(): VoiceConfig | null {
    return this.options.currentConfig ? this.options.currentConfig.current()?.voice ?? null : this.options.config;
  }

  private isModeEnabled(voice: VoiceConfig | null, mode: 'dictation' | 'live'): boolean {
    return Boolean(voice && effectiveVoiceModes({ ...voice, livekit: this.livekitConfig(voice) })[mode]);
  }

  config() {
    const voice = this.currentVoice();
    const result = voice ? publicVoiceConfig({ ...voice, livekit: this.livekitConfig(voice) }) : {
      protocolVersion: 1 as const, enabledModes: { dictation: false, live: false },
      supportedLocales: ['en-US'] as ['en-US'], limits: { ...DEFAULT_VOICE_LIMITS },
      inputAudio: { ...INPUT_AUDIO }, outputAudio: { ...OUTPUT_AUDIO },
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
    return { configSnapshot: null,
      voiceConfig: { ...voice, dictationWarningMs: Math.max(0, voice.limits.dictationMaxMs - 30_000) || null } };
  }

  private key(identity: string, key: string) { return JSON.stringify([identity, key]); }

  private isEnded(entry: VoiceBinding) { return entry.state === 'ended'; }

  private response(entry: VoiceBinding): CreateResult {
    // Duplicate active POST is idempotent, but cannot mint another socket ticket.
    const response = {
      ...entry.response,
      ...(entry.response.livekit ? { livekit: { ...entry.response.livekit } } : {}),
    };
    if (!entry.token) return { response, cookie: '' };
    const maxAge = Math.max(1, Math.ceil((entry.deadline - Date.now()) / 1000));
    return {
      response,
      cookie: `aurvin_voice_ticket=${entry.token}; HttpOnly; SameSite=Strict; Path=/api/voice; Max-Age=${maxAge}${this.options.secureCookie ? '; Secure' : ''}`
    };
  }

  private async issue(entry: VoiceBinding): Promise<void> {
    const now = Date.now();
    entry.token = randomBytes(32).toString('base64url');
    entry.tokenHash = digest(entry.token);
    entry.deadline = Math.min(
      entry.state === 'reconnecting' ? entry.deadline : Infinity,
      now + Math.min(LIVEKIT_TOKEN_MAX_TTL_MS, entry.response.limits.connectMs)
    );
    entry.response.expiresAt = new Date(entry.deadline).toISOString();

    if (entry.response.mode === 'live') {
      const livekit = this.livekitConfig(entry.voiceConfig);
      if (!livekit) fault('VOICE_DISABLED');
      const ticket = await this.livekit.issue({ config: livekit,
        userId: entry.identity.userId, sessionId: entry.response.sessionId,
        connectionEpoch: entry.response.connectionEpoch,
        connectMs: Math.max(1000, entry.deadline - now), nowMs: now });
      entry.livekitTicket = ticket;
      entry.response.livekit = { ...ticket.transport };
      if (this.options.openLiveBridge) {
        const handle = await this.options.openLiveBridge(entry, ticket);
        entry.livekitCleanup = handle && typeof handle.close === 'function'
          ? () => handle.close() : undefined;
      }
    }

    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { void this.end(entry.response.sessionId).catch(() => undefined); },
      Math.max(0, entry.deadline - Date.now()));
  }

  async create(body: unknown, origin: string | undefined, principal: AuthPrincipal): Promise<CreateResult> {
    assertOrigin(this.options, origin);
    if (!isCreateVoiceSessionRequest(body)) fault('INVALID_VOICE_REQUEST');
    if (!this.accepting) fault('VOICE_DISABLED');
    requireFullAccount(principal);
    await this.options.assertAccountCurrent(principal);
    const identity = Object.freeze({ ...principal.identity });
    const key = this.key(identity.userId, body.idempotencyKey);
    const inFlight = this.pending.get(key);
    if (inFlight) {
      const result = await inFlight;
      const entry = this.entries.get(result.response.sessionId);
      if (!entry || !this.matches(entry, body)) fault('VOICE_BINDING_MISMATCH');
      return this.response(entry);
    }
    const operation = this.createOnce(body, principal);
    this.pending.set(key, operation);
    try { return await operation; } finally { if (this.pending.get(key) === operation) this.pending.delete(key); }
  }

  private matches(e: VoiceBinding, r: CreateVoiceSessionRequest) {
    return e.request.mode === r.mode && e.request.locale === r.locale &&
      (e.request.conversationId === r.conversationId || e.response.conversationId === r.conversationId);
  }

  private async createOnce(body: CreateVoiceSessionRequest, principal: AuthPrincipal): Promise<CreateResult> {
    const identity = Object.freeze({ ...principal.identity });
    const old = [...this.entries.values()].find(e => e.identity.userId === identity.userId &&
      e.request.idempotencyKey === body.idempotencyKey);
    if (old) {
      if (!this.matches(old, body)) fault('VOICE_BINDING_MISMATCH');
      if (old.state === 'ended') fault('VOICE_SESSION_ENDED');
      if (old.state === 'active') return this.response(old);
      if (old.deadline <= Date.now()) {
        const expiredCode = old.state === 'reconnecting' ? 'VOICE_RECONNECT_TIMEOUT' : 'VOICE_CONNECT_TIMEOUT';
        await this.end(old.response.sessionId);
        fault(expiredCode);
      }
      if (old.state === 'reconnecting') {
        await old.stopping;
        if (this.entries.get(old.response.sessionId)?.state === 'ended' || old.deadline <= Date.now()) {
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
                await this.livekit.evictParticipant({ config: livekit,
                  roomName: old.response.livekit?.roomName ?? livekitRoomName(old.response.sessionId),
                  participantIdentity: previousIdentity, timeoutMs: LIVEKIT_TEARDOWN_TIMEOUT_MS });
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

    if (body.conversationId !== null && !await this.options.sessions.get(identity.userId, body.conversationId))
      fault('VOICE_BINDING_MISMATCH');

    const response: SessionContext['response'] = {
      protocolVersion: 1,
      sessionId: randomUUID(),
      conversationId: body.conversationId,
      mode: body.mode,
      connectionEpoch: 0,
      websocketUrl: '/api/voice',
      expiresAt: new Date().toISOString(),
      effectiveAudioSettings: { input: INPUT_AUDIO, output: body.mode === 'live' ? OUTPUT_AUDIO : null },
      limits: { ...captured.voiceConfig.limits }
    };
    const context: SessionContext = { identity, response, reservation: null, livekitTicket: null, ...captured };
    const startedAt = Date.now();
    const admission = await this.options.admission(context);
    let registered = false;
    try {
      // Recheck after the asynchronous policy: reserve registry capacity synchronously.
      const voice = this.currentVoice();
      if (!this.accepting || !voice || !this.isModeEnabled(voice, body.mode)) fault('VOICE_DISABLED');
      const active = [...this.entries.values()].filter(e => e.state !== 'ended');
      if (active.length >= voice.quotas.globalConcurrent ||
        active.filter(e => e.identity.userId === identity.userId).length >= voice.quotas.identityConcurrent)
        fault('VOICE_QUOTA_EXHAUSTED');
      // ponytail: at most 1024 ten-second tombstones; reject rather than evict live idempotency evidence.
      if (this.entries.size >= 1024) fault('VOICE_QUOTA_EXHAUSTED');

      let creationDone!: () => void;
      const creating = new Promise<void>(resolve => { creationDone = resolve; });
      const entry: VoiceBinding = { ...context, authSessionId: principal.sessionId,
        sessionEpoch: principal.account.sessionEpoch, request: { ...body }, state: 'created',
        token: null, tokenHash: null, deadline: 0, admission, startedAt, creating };
      entry.assertPaidWork = () => this.assertPaidWork(entry);
      this.entries.set(response.sessionId, entry);
      registered = true;

      try {
        if (body.mode === 'live') entry.reservation = await this.options.reservations.acquire({
          identity, conversationId: body.conversationId, owner: { kind: 'live', voiceSessionId: response.sessionId } });
        if (!this.accepting || this.isEnded(entry)) fault('VOICE_DISABLED');
        await this.issue(entry);
        if (!this.accepting || this.isEnded(entry)) fault('VOICE_DISABLED');
        try { await this.options.assertAccountCurrent(principal); }
        catch (error) { await this.end(response.sessionId); throw error; }
        return this.response(entry);
      } catch (error) {
        creationDone();
        await this.end(response.sessionId);
        if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'CONFLICT_ACTIVE_TURN')
          fault('CONFLICT_ACTIVE_TURN');
        throw error;
      } finally {
        creationDone();
      }
    } catch (error) {
      if (!registered) await admission.release();
      throw error;
    }
  }

  claim(cookie: string | undefined, origin: string | undefined, principal: AuthPrincipal, expectedMode?: VoiceMode): VoiceBinding {
    assertOrigin(this.options, origin);
    if (!this.accepting) fault('VOICE_DISABLED');
    requireFullAccount(principal);
    const parts = (cookie ?? '').split(';').map(p => p.trim()).filter(p => p.startsWith('aurvin_voice_ticket='));
    if (parts.length !== 1) fault('VOICE_BINDING_MISMATCH');
    const token = parts[0].slice('aurvin_voice_ticket='.length);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fault('VOICE_BINDING_MISMATCH');
    const hash = digest(token);
    const entry = [...this.entries.values()].find(e => e.tokenHash === hash);
    if (!entry || entry.identity.userId !== principal.identity.userId || entry.authSessionId !== principal.sessionId)
      fault('VOICE_BINDING_MISMATCH');
    if (expectedMode && entry.response.mode !== expectedMode) fault('VOICE_BINDING_MISMATCH');
    if (entry.state === 'ended') fault('VOICE_SESSION_ENDED');
    if (entry.deadline <= Date.now()) fault('VOICE_CONNECT_TIMEOUT');
    if (!['created', 'reconnecting'].includes(entry.state)) fault('VOICE_INVALID_STATE');
    entry.assertPaidWork?.();
    // Consume synchronously before any provider/socket work; a second claim cannot race this one.
    entry.token = null; entry.tokenHash = null; clearTimeout(entry.timer); entry.state = 'active';
    return entry;
  }

  claimLive(sessionId: string, participantIdentity: string, roomName: string): VoiceBinding {
    if (!this.accepting) fault('VOICE_DISABLED');
    const entry = this.entries.get(sessionId);
    if (!entry || entry.response.mode !== 'live')
      fault('VOICE_BINDING_MISMATCH');
    const expectedRoom = entry.response.livekit?.roomName ?? livekitRoomName(entry.response.sessionId);
    assertLiveKitParticipantBinding({
      userId: entry.identity.userId,
      sessionId: entry.response.sessionId,
      connectionEpoch: entry.response.connectionEpoch,
      roomName: expectedRoom,
    }, { participantIdentity, roomName });
    if (entry.state === 'ended') fault('VOICE_SESSION_ENDED');
    if (entry.deadline <= Date.now()) fault('VOICE_CONNECT_TIMEOUT');
    if (!['created', 'reconnecting'].includes(entry.state)) fault('VOICE_INVALID_STATE');
    entry.assertPaidWork?.();
    entry.token = null; entry.tokenHash = null; clearTimeout(entry.timer); entry.state = 'active';
    return entry;
  }

  async endOwned(id: string, principal: AuthPrincipal): Promise<void> {
    requireFullAccount(principal);
    const entry = this.entries.get(id);
    if (entry && (entry.identity.userId !== principal.identity.userId || entry.authSessionId !== principal.sessionId))
      fault('VOICE_BINDING_MISMATCH');
    await this.end(id);
  }

  async end(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    await entry.creating;
    if (entry.state === 'ended') { await entry.stopping; return; }
    entry.state = 'ended'; entry.token = null; entry.tokenHash = null; clearTimeout(entry.timer);
    entry.stopping = (async () => {
      try {
        try { await entry.cleanup?.(); }
        finally { await entry.livekitCleanup?.(); }
      }
      finally {
        try {
          if (entry.response.mode === 'live') {
            const livekit = this.livekitConfig(entry.voiceConfig);
            if (livekit) await this.livekit.teardownRoom({ config: livekit,
              roomName: entry.response.livekit?.roomName ?? livekitRoomName(entry.response.sessionId),
              timeoutMs: LIVEKIT_TEARDOWN_TIMEOUT_MS });
          }
        }
        finally {
          try { if (entry.reservation) await this.options.reservations.release({
            identity: entry.identity, reservationId: entry.reservation.reservationId }); }
          finally { await entry.admission.release(); }
        }
      }
    })();
    try { await entry.stopping; } finally {
      entry.timer = setTimeout(() => this.entries.delete(id), 10000);
      entry.timer.unref?.();
    }
  }

  async stop(id: string, reason: 'duration' | 'idle' | 'quota' | 'shutdown') {
    const entry = this.entries.get(id);
    if (!entry || entry.state === 'ended') return;
    if (entry.response.mode === 'live' && reason !== 'shutdown') {
      if (reason === 'idle' || entry.blockedCode) return;
      entry.blockedCode = reason === 'duration' ? 'VOICE_DURATION_LIMIT' : 'VOICE_QUOTA_EXHAUSTED';
      await entry.pause?.(reason);
      return;
    }
    const terminal = entry.terminal;
    entry.terminal = undefined;
    try { terminal?.(reason); } finally { await this.end(id); }
  }

  async sweep(now = Date.now()): Promise<void> {
    const expired: string[] = [];
    for (const [id, entry] of this.entries) {
      if ((entry.state === 'created' || entry.state === 'reconnecting') && entry.deadline <= now) {
        expired.push(id);
      }
    }
    await Promise.allSettled(expired.map(id => this.end(id)));
  }

  async stopUser(userId: string, sessionId?: string): Promise<void> {
    const selected = [...this.entries.values()].filter(entry =>
      entry.identity.userId === userId && (sessionId === undefined || entry.authSessionId === sessionId));
    for (const entry of selected) { entry.token = null; entry.tokenHash = null; }
    await Promise.allSettled(selected.map(entry => this.end(entry.response.sessionId)));
  }

  private assertPaidWork(entry: VoiceBinding) {
    if (entry.state === 'ended') fault('VOICE_SESSION_ENDED');
    if (entry.blockedCode) fault(entry.blockedCode);
    const cap = entry.response.mode === 'live' ? entry.response.limits.liveMaxMs : entry.response.limits.dictationMaxMs;
    if (Date.now() - entry.startedAt >= cap) {
      entry.blockedCode = 'VOICE_DURATION_LIMIT';
      fault(entry.blockedCode);
    }
    entry.admission.assertActive?.();
  }

  warn(id: string, code: 'VOICE_DURATION_LIMIT' | 'VOICE_IDLE_TIMEOUT') {
    const entry = this.entries.get(id);
    if (entry?.state === 'active') {
      try { entry.warning?.(code); } catch { /* A lost warning must not crash a policy timer. */ }
    }
  }

  async disconnected(entry: VoiceBinding, recover: boolean): Promise<void> {
    if (entry.state === 'ended') return;
    if (!recover || entry.response.mode === 'dictation' || !this.accepting) { await this.end(entry.response.sessionId); return; }
    if (entry.state === 'reconnecting') return;
    entry.state = 'reconnecting'; entry.token = null; entry.tokenHash = null;
    entry.deadline = Date.now() + entry.response.limits.reconnectMs;
    entry.stopping = (async () => {
      await entry.cleanup?.();
      await entry.livekitCleanup?.();
      entry.livekitCleanup = undefined;
      await this.options.disconnected(entry);
    })();
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { void this.end(entry.response.sessionId).catch(() => undefined); },
      entry.response.limits.reconnectMs);
    try { await entry.stopping; } catch (error) { await this.end(entry.response.sessionId); throw error; }
  }

  async bindConversation(id: string, conversationId: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || entry.state !== 'active' || entry.response.mode !== 'live' || !entry.reservation)
      fault('VOICE_INVALID_STATE');
    if (entry.response.conversationId !== null && entry.response.conversationId !== conversationId)
      fault('VOICE_BINDING_MISMATCH');
    entry.reservation = await this.options.reservations.bindConversation({ identity: entry.identity,
      reservationId: entry.reservation.reservationId, conversationId });
    entry.response.conversationId = conversationId;
  }

  stopAccepting() { this.accepting = false; }

  snapshot() { return { accepting: this.accepting,
    active: [...this.entries.values()].filter(e => e.state !== 'ended').length }; }

  async drain() {
    this.stopAccepting();
    await Promise.allSettled([...this.pending.values()]);
    const activeLive = [...this.entries.values()].filter(e => e.response.mode === 'live' && e.state === 'active');
    for (const entry of activeLive) {
      try {
        const terminal = entry.terminal;
        entry.terminal = undefined;
        terminal?.('shutdown');
      } catch { /* A failing sink must not prevent cleanup or crash drain. */ }
    }
    const results = await Promise.allSettled([...this.entries.keys()].map(id => this.end(id)));
    for (const e of this.entries.values()) clearTimeout(e.timer);
    this.entries.clear();
    if (results.some(r => r.status === 'rejected')) fault('VOICE_DELIVERY_UNKNOWN');
  }
}
