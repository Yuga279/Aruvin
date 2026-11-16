/**
 * ============================================================================
 * FILE: voice-session.options.ts
 * LOCATION: backend/src/voice/session/voice-session.options.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Dependency and callback contract definitions for voice sessions.
 *
 * ROLE IN PROJECT:
 *    Defines the injection token, context, flow interfaces, and callback types
 *    bridging voice session transport/flow lifecycle to P6 runtime and P9 policy.
 *
 * KEY COMPONENTS:
 *    - VOICE_SESSION_OPTIONS: Injection token for session options.
 *    - VoiceFlow / VoiceSink: Interfaces for duplex voice flow handling.
 *    - VoiceSessionOptions / LiveHooks / FlowDependencies: External dependency contracts.
 *    - LiveKit admission ticket context and optional bridge hook.
 *    - VoiceSessionError / fault / assertOrigin: Error handling and origin validation helpers.
 * ============================================================================
 */

import type { CurrentConfigPort, RuntimeConfigSnapshot, VoiceConfig } from '../../contracts/config-runtime.js';
import type { ResolvedIdentity } from '../../contracts/identity.js';
import type { AuthPrincipal } from '../../contracts/auth.js';
import type { SessionRepository } from '../../contracts/repositories.js';
import type { ExecutionReservation, ExecutionReservationPort, LiveKitAdmissionPort,
  LiveKitAdmissionTicket, SpeechUsage, TtsEvent, SpeechToTextPort, SpeechSynthesisPort
} from '../../contracts/voice.js';
import type { CreateVoiceSessionResponse, VoiceClientEvent,
  VoiceServerPayload, VoiceErrorCode, VoiceRecovery, CalendarConfirmPayload } from '../../contracts/voice-wire.js';
import { VOICE_ERROR_CODES } from '../../contracts/voice-wire.js';

export const VOICE_SESSION_OPTIONS = Symbol('VOICE_SESSION_OPTIONS');
export type VoiceFlow = {
  start(): void;
  input(pcm: Uint8Array): Promise<void>;
  control(event: VoiceClientEvent): Promise<void>;
  close(): Promise<void>;
};
export type VoiceSink = {
  outputSamples(): number;
  event(payload: VoiceServerPayload): void;
  audio(ref: { turnId: string; responseId: string }, pcm: Uint8Array): void;
  invalidate(ref: { turnId: string; responseId: string }): void;
  finish(reason: 'completed' | 'cancelled' | 'error'): void;
  /** Stops paid resources, retaining the admitted call/control connection. */
  pause?(code: VoiceErrorCode, recoverable?: boolean): void;
};
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
  calendarControl?(context: SessionContext, input: CalendarConfirmPayload, signal: AbortSignal): Promise<void>;
};
export const VOICE_STAGES = ['response-prepared', 'model-first-output', 'tts-first-audio',
  'stt-end-of-turn', 'tts-first-submit', 'stt-connected', 'tts-connected',
  'playback-first-ack', 'delivery-settled', 'tts-reset', 'flow-error', 'transport-error'] as const;
export type VoiceObservation = { stage: typeof VOICE_STAGES[number]; elapsedMs?: number;
  queueSamples?: number; code?: VoiceErrorCode; turnId?: string; responseId?: string };
export type VoiceSessionOptions = {
  config: VoiceConfig;
  currentConfig?: CurrentConfigPort;
  assertAccountCurrent: (principal: AuthPrincipal) => Promise<void>;
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
export type CreateResult = { response: CreateVoiceSessionResponse; cookie: string };
export type FlowDependencies = {
  stt: SpeechToTextPort; tts: SpeechSynthesisPort; hooks: LiveHooks;
  activity?(context: SessionContext, busy?: boolean): void;
  observe?(context: SessionContext, observation: VoiceObservation): void;
  usage(context: SessionContext, usage: SpeechUsage): Promise<void>;
};
export class VoiceSessionError extends Error {
  constructor(readonly code: VoiceErrorCode, readonly recovery: VoiceRecovery = 'return_to_chat') {
    super(code);
  }
}
export function fault(code: VoiceErrorCode): never { throw new VoiceSessionError(code); }
export function voiceError(error: unknown, fallback: VoiceErrorCode): VoiceSessionError {
  if (error instanceof VoiceSessionError) return error;
  const candidate = error && typeof error === 'object' && 'fault' in error ? error.fault : error;
  const code = candidate && typeof candidate === 'object' && 'code' in candidate ? candidate.code
    : error instanceof Error ? error.message : null;
  return new VoiceSessionError(typeof code === 'string' && (VOICE_ERROR_CODES as readonly string[]).includes(code)
    ? code as VoiceErrorCode : fallback);
}
export function assertOrigin(options: Pick<VoiceSessionOptions, 'frontendOrigin'>,
  origin: string | undefined, required = true): void {
  if ((!origin && required) || (origin && origin !== options.frontendOrigin)) fault('INVALID_ORIGIN');
}
