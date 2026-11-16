/**
 * ============================================================================
 * FILE: voice.ts
 * LOCATION: backend/src/contracts/voice.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define server-side voice session schemas, delivery records, and provider ports.
 *
 * ROLE IN PROJECT:
 *    Specifies backend-only Zod validation rules for persisted voice records and
 *    interfaces for STT, TTS, and turn execution reservations.
 *
 * KEY COMPONENTS:
 *    - voiceSessionRecordSchema: Persisted session schema
 *    - voiceDeliveryRecordSchema: Detailed speech delivery and playback tracking schema
 *    - SpeechToTextPort / SpeechSynthesisPort: Provider connection interfaces
 *    - ExecutionReservationPort: Turn concurrency coordination interface
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { DEFAULT_BUDGETS } from './budgets.js';
import { canvasArtifactsSchema } from './canvas-artifact.js';
import type { ResolvedIdentity } from './identity.js';
import type { VoiceMode, InputAudioSettings, OutputAudioSettings, VoiceErrorCode,
  VoiceRecovery, VoiceLiveKitTransport } from './voice-wire.js';
import type { LiveKitConfig } from './config-runtime.js';

const uint = z.number().int().nonnegative().max(0xffffffff);
const chars = z.string().max(DEFAULT_BUDGETS.maxInputChars);
export const voiceSessionRecordSchema = z.object({
  schemaVersion: z.literal(1), voiceSessionId: idSchema, userId: idSchema,
  conversationId: idSchema.nullable(), mode: z.enum(['dictation', 'live']),
  locale: z.literal('en-US'), connectionEpoch: uint,
  status: z.enum(['created', 'connecting', 'active', 'reconnecting', 'ending', 'ended']),
  createdAt: isoDateSchema, expiresAt: isoDateSchema,
}).strict();
export type VoiceSessionRecord = z.infer<typeof voiceSessionRecordSchema>;
export const voiceDeliveryRecordSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('voice-delivery'),
  userId: idSchema, sessionId: idSchema, voiceSessionId: idSchema,
  turnId: idSchema, attemptId: idSchema, responseId: idSchema,
  eventId: idSchema, sequence: sequenceSchema,
  speechId: idSchema.nullable(), providerSocketId: idSchema,
  status: z.enum(['pending', 'completed', 'interrupted', 'cancelled', 'failed', 'unknown']),
  audioDurationMs: uint.nullable(), audioPlayedMs: uint.nullable(),
  playedSamples: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  audioSamples: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  textGenerated: chars, textSpoken: chars.nullable(), textRemaining: chars.nullable(),
  canvasArtifacts: canvasArtifactsSchema.optional(),
  createdAt: isoDateSchema, updatedAt: isoDateSchema,
}).strict().superRefine((v, ctx) => {
  if (v.canvasArtifacts) {
    for (let i = 0; i < v.canvasArtifacts.length; i++) {
      if (v.canvasArtifacts[i].responseId !== v.responseId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['canvasArtifacts', i, 'responseId'],
          message: 'artifact responseId must match delivery responseId',
        });
      }
    }
  }
  if (v.audioDurationMs !== null && v.audioPlayedMs !== null && v.audioPlayedMs > v.audioDurationMs)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['audioPlayedMs'], message: 'played exceeds generated' });
  if (v.textSpoken !== null && !v.textGenerated.startsWith(v.textSpoken))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['textSpoken'], message: 'spoken must be a generated prefix' });
  if (v.textSpoken !== null && v.textRemaining !== null && v.textSpoken + v.textRemaining !== v.textGenerated)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['textRemaining'], message: 'delivery text must reconcile' });
});
export type VoiceDeliveryRecord = z.infer<typeof voiceDeliveryRecordSchema>;
export type VoiceFault = { code: VoiceErrorCode; recovery: VoiceRecovery; recoverable: boolean };
export type SpeechUsage = { providerRequestId: string | null; model: string;
  modelVersion: string | null; audioMs: number | null; billableCharacters: number | null;
  usageId?: string; speechId?: string | null };
export type SttEvent =
  | { type: 'partial' | 'final'; segmentId: string; text: string }
  | { type: 'start-of-turn'; providerTurnId: string }
  | { type: 'end-of-turn'; providerTurnId: string; text: string }
  | { type: 'finalized'; unfinalizedTail: boolean }
  | { type: 'usage'; usage: SpeechUsage }
  | { type: 'error'; fault: VoiceFault };
export type SttConnectRequest = { mode: VoiceMode; locale: 'en-US';
  audio: InputAudioSettings; abortSignal: AbortSignal };
export interface SpeechInputConnection {
  readonly events: AsyncIterable<SttEvent>;
  writeAudio(pcm: Uint8Array): Promise<void>;
  /** Resolves after provider settlement, not merely after writing the finalization command. */
  finalize(): Promise<void>;
  close(): Promise<void>;
}
export interface SpeechToTextPort {
  connect(request: SttConnectRequest): Promise<SpeechInputConnection>;
}
export type TtsEvent =
  | { type: 'audio'; turnId: string; responseId: string; pcm: Uint8Array }
  | { type: 'speech-started'; turnId: string; responseId: string; speechId: string }
  | { type: 'speech-completed'; turnId: string; responseId: string; speechId: string;
      audioDurationMs: number; audioSamples?: number; usage: SpeechUsage }
  | { type: 'speech-interrupted'; turnId: string; responseId: string; speechId: string | null;
      audioPlayedMs: number | null; textSpoken: string | null; textRemaining: string | null;
      usage: SpeechUsage }
  | { type: 'error'; fault: VoiceFault };
export interface SpeechOutputConnection {
  readonly providerSocketId: string;
  readonly events: AsyncIterable<TtsEvent>;
  speak(command: { turnId: string; responseId: string; text: string }): Promise<void>;
  flush(command: { turnId: string; responseId: string }): Promise<void>;
  interrupt(command: { turnId: string; responseId: string; providerSocketId: string;
    playbackPositionMs: number }): Promise<void>;
  close(): Promise<void>;
}
export interface SpeechSynthesisPort {
  connect(request: { audio: OutputAudioSettings; abortSignal: AbortSignal }): Promise<SpeechOutputConnection>;
}
export type ExecutionReservation = { reservationId: string; userId: string;
  conversationId: string | null; owner: { kind: 'text'; attemptId: string } |
  { kind: 'live'; voiceSessionId: string } };
export interface ExecutionReservationPort {
  acquire(command: { identity: ResolvedIdentity; conversationId: string | null;
    owner: ExecutionReservation['owner'] }): Promise<ExecutionReservation>;
  bindConversation(command: { reservationId: string; identity: ResolvedIdentity;
    conversationId: string }): Promise<ExecutionReservation>;
  release(command: { reservationId: string; identity: ResolvedIdentity }): Promise<void>;
}
export type LiveKitParticipantGrant = {
  roomCreate: boolean;
  roomJoin: true;
  room: string;
  canPublish: true;
  canSubscribe: true;
  canPublishData: true;
  canPublishSources?: readonly ['microphone'];
  roomAdmin: false;
  roomList: false;
  roomRecord: false;
};
export type LiveKitAdmissionTicket = {
  transport: VoiceLiveKitTransport;
  agentIdentity: string;
  agentToken: string;
  expiresAtMs: number;
  ttlSeconds: number;
};
export interface LiveKitAdmissionPort {
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
  evictParticipant?(command: {
    config: LiveKitConfig;
    roomName: string;
    participantIdentity: string;
    timeoutMs?: number;
  }): Promise<void>;
}
