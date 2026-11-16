/**
 * ============================================================================
 * FILE: voice-protocol.ts
 * LOCATION: frontend/src/api/voice-protocol.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide portable voice wire types, runtime guards, routes, and defaults.
 *
 * ROLE IN PROJECT:
 *    Defines the shared client/server JSON contract for real-time and dictation
 *    voice modes, safe to import across browser and Node runtimes without dependencies.
 *
 * KEY COMPONENTS:
 *    - VOICE_ROUTES: Canonical voice HTTP and WebSocket endpoints
 *    - DEFAULT_VOICE_LIMITS / Audio settings: Default parameters for voice channels
 *    - isVoiceClientEvent / isVoiceServerEvent: Structural runtime type guards
 *    - parseVoiceControl: JSON parser enforcing size and schema constraints
 *    - audio.watermark / clampPlayedSamplesToWatermark: 24 kHz playout bounds
 *    - encodeVoiceControlPackets / VoiceControlReassembler: bounded LiveKit frames
 * ============================================================================
 */

import {
  isCalendarPresentationEvent,
  type CalendarPresentationEvent,
} from './calendar-protocol.ts';

export const VOICE_PROTOCOL_VERSION = 1 as const;
export const CANVAS_ARTIFACT_LIMITS = Object.freeze({
  sourceMaxChars: 8192,
  sourceMaxBytes: 16384,
  titleMaxChars: 120,
  titleMaxBytes: 480,
  subTypeMaxChars: 48,
  subTypeMaxBytes: 192,
  maxArtifactsPerResponse: 3,
  responseSourceMaxChars: 16384,
  responseSourceMaxBytes: 24576,
  projectionMaxBytes: 32768,
  messageReserveBytes: 33792,
  headerMaxChars: 512,
  headerMaxBytes: 1024,
});
export type CanvasArtifactKind = 'mermaid' | 'chart' | 'svg' | 'calendar';
export type CanvasArtifactSource = {
  ordinal: number;
  kind: CanvasArtifactKind;
  subType: string;
  title: string;
  rawSource: string;
};
export type CanvasArtifactProjection = CanvasArtifactSource & { responseId: string };
export type CanvasArtifactPayload = {
  type: 'canvas.artifact';
  turnId: string;
} & CanvasArtifactProjection;
export const MAX_VOICE_CONTROL_BYTES = 131072;
export const LIVEKIT_MAX_CONTROL_PACKET_BYTES = 15360 as const;
export const LIVEKIT_CONTROL_LIMITS = Object.freeze({
  maxPacketBytes: LIVEKIT_MAX_CONTROL_PACKET_BYTES,
  maxMessageBytes: MAX_VOICE_CONTROL_BYTES,
  maxChunkBytes: 14336,
  maxChunksPerMessage: 16,
  maxInflightReassemblies: 2,
  reassemblyTimeoutMs: 5000,
} as const);
export const LIVEKIT_CONTROL_TOPIC = 'aurvin.voice.control' as const;
export const LIVEKIT_ROOM_PREFIX = 'aurvin-live-' as const;
export const LIVEKIT_AGENT_PREFIX = 'aurvin-agent:' as const;
export const LIVEKIT_TOKEN_MAX_TTL_MS = 30000 as const;
export const LIVEKIT_TEARDOWN_TIMEOUT_MS = 2000 as const;
export const LIVE_WEBRTC_AUDIO = Object.freeze({
  browserPublishCodec: 'opus',
  browserClockHz: 48000,
  sttSampleRateHz: 16000,
  sttChannels: 1,
  sttFrameMs: 80,
  sttFrameSamples: 1280,
  sttFrameBytes: 2560,
  ttsSampleRateHz: 24000,
  ttsChannels: 1,
  ttsMaxChunkMs: 200,
  ttsMaxChunkSamples: 4800,
  ttsMaxChunkBytes: 9600,
  quietPeakThreshold: 600,
  quietHangoverMs: 5000,
  quietFrameWindowMs: 20,
  quietPreRollFrames: 4,
} as const);
export const VOICE_ROUTES = {
  config: '/voice/config', sessions: '/voice/sessions',
  session: (id: string) => `/voice/sessions/${encodeURIComponent(id)}`,
  websocket: '/api/voice',
} as const;
export type VoiceMode = 'dictation' | 'live';
export type VoiceSessionStatus = 'created' | 'connecting' | 'active' | 'reconnecting' | 'ending' | 'ended';
export const INPUT_AUDIO = { encoding: 'pcm16', sampleRate: 16000, channels: 1,
  endian: 'little', frameMs: 80 } as const;
export const OUTPUT_AUDIO = { encoding: 'pcm16', sampleRate: 24000, channels: 1,
  endian: 'little' } as const;
export type InputAudioSettings = typeof INPUT_AUDIO;
export type OutputAudioSettings = typeof OUTPUT_AUDIO;
export type VoiceLimits = {
  dictationMaxMs: number; liveMaxMs: number; liveWarningMs: number;
  idleWarningMs: number; idleExitAfterWarningMs: number;
  finalizationMs: number; reconnectMs: number; connectMs: number;
  inputQueueMs: number; outputQueueMs: number;
};
export const DEFAULT_VOICE_LIMITS: Readonly<VoiceLimits> = Object.freeze({
  dictationMaxMs: 300000, liveMaxMs: 1200000, liveWarningMs: 1080000,
  idleWarningMs: 60000, idleExitAfterWarningMs: 30000, finalizationMs: 2000,
  reconnectMs: 10000, connectMs: 10000, inputQueueMs: 1000, outputQueueMs: 2000,
});
export const VOICE_ERROR_CODES = [
  'VOICE_DISABLED', 'INVALID_VOICE_REQUEST', 'INVALID_VOICE_CONTROL',
  'INVALID_AUDIO_FRAME', 'INVALID_ORIGIN', 'VOICE_SESSION_NOT_FOUND',
  'VOICE_SESSION_ENDED', 'VOICE_BINDING_MISMATCH', 'STALE_CONNECTION_EPOCH',
  'VOICE_SEQUENCE_ERROR', 'VOICE_INVALID_STATE', 'CONFLICT_ACTIVE_TURN',
  'AUDIO_BUFFER_OVERFLOW', 'VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT',
  'VOICE_IDLE_TIMEOUT', 'DICTATION_FINALIZATION_TIMEOUT', 'VOICE_RECONNECT_TIMEOUT',
  'VOICE_CONNECT_TIMEOUT', 'STT_UNAVAILABLE', 'TTS_UNAVAILABLE', 'VOICE_PROVIDER_RATE_LIMITED',
  'VOICE_AGENT_FAILED', 'VOICE_DELIVERY_UNKNOWN', 'MEDIA_GATE_UNAVAILABLE',
] as const;
export type VoiceErrorCode = typeof VOICE_ERROR_CODES[number];
export type VoiceRecovery = 'none' | 'retry_dictation' | 'resume_gesture' |
  'repeat_turn' | 'return_to_chat' | 'resume_call';
export type CreateVoiceSessionRequest = { protocolVersion: 1; mode: VoiceMode;
  conversationId: string | null; locale: 'en-US'; idempotencyKey: string };
export type PublicVoiceConfig = { protocolVersion: 1;
  enabledModes: { dictation: boolean; live: boolean }; supportedLocales: ['en-US'];
  limits: VoiceLimits; inputAudio: InputAudioSettings; outputAudio: OutputAudioSettings };
export type VoiceLiveKitTransport = {
  url: string;
  roomName: string;
  participantIdentity: string;
  participantToken: string;
};
export type CreateVoiceSessionResponse = { protocolVersion: 1; sessionId: string;
  conversationId: string | null; mode: VoiceMode; connectionEpoch: number;
  websocketUrl: '/api/voice'; livekit?: VoiceLiveKitTransport; expiresAt: string;
  effectiveAudioSettings: { input: InputAudioSettings; output: OutputAudioSettings | null };
  limits: VoiceLimits };
export type VoiceEnvelope = { protocolVersion: 1; sessionId: string;
  connectionEpoch: number; eventId: string; sequence: number };
export type VoiceResponseRef = { turnId: string; responseId: string };
export const VOICE_PLAYBACK_PROOFS = ['proven', 'unproven'] as const;
export type VoicePlaybackProof = typeof VOICE_PLAYBACK_PROOFS[number];
export const VOICE_SAVE_STATES = ['pending', 'saving', 'saved', 'failed', 'unknown', 'fenced'] as const;
export type VoiceSaveState = typeof VOICE_SAVE_STATES[number];
export type VoiceSaveSnapshot = {
  state: VoiceSaveState;
  epoch: string;
  version: number;
  durableVersion: number;
};
export type VoiceAudioWatermarkPayload = {
  type: 'audio.watermark';
  firstAudioSample: number;
  queuedSamples: number;
  lastAudioSample: number;
  final: boolean;
} & VoiceResponseRef;
export type CalendarConfirmPayload = { type: 'calendar.confirm'; proposalId: string; proposalRevision: number;
  answer: { kind: 'accept' } | { kind: 'reject' } | { kind: 'select'; calendarId: string } };
export type CalendarFramePayload = { type: 'calendar.frame'; turnId: string; attemptId: string;
  responseId: string; event: CalendarPresentationEvent };
export type VoiceClientPayload =
  | { type: 'session.start'; mode: VoiceMode; audioSettings: InputAudioSettings }
  | { type: 'dictation.stop' | 'dictation.cancel' | 'input.mute' | 'input.unmute' |
      'input.suspend' | 'session.end' }
  | ({ type: 'response.interrupt'; playbackPositionMs: number; playedSamples: number;
      proof?: VoicePlaybackProof } & VoiceResponseRef)
  | ({ type: 'playback.progress'; playedMs: number; playedSamples: number;
      proof?: VoicePlaybackProof } & VoiceResponseRef)
  | CalendarConfirmPayload;
export type VoiceClientEvent = VoiceEnvelope & VoiceClientPayload;
export type VoiceServerPayload =
  | { type: 'session.ready'; limits: VoiceLimits;
      effectiveAudioSettings: { input: InputAudioSettings; output: OutputAudioSettings | null } }
   | { type: 'session.ended'; reason: 'completed' | 'cancelled' | 'disconnected' |
      'duration' | 'idle' | 'quota' | 'error' | 'shutdown'; terminal: boolean }
  | { type: 'conversation.bound'; conversationId: string; turnId?: string; save?: VoiceSaveSnapshot }
  | { type: 'dictation.partial' | 'dictation.final'; segmentId: string; text: string }
  | { type: 'dictation.complete'; finalization: 'complete' | 'timeout' | 'empty'; unfinalizedTail: boolean }
  | { type: 'voice.state'; input: 'listening' | 'suspended' | 'muted';
      agent: 'idle' | 'thinking' | 'speaking'; connection: 'connected' | 'reconnecting' }
   | ({ type: 'audio.start'; sampleRate: 24000; firstAudioSequence: number; firstAudioSample?: number } & VoiceResponseRef)
  | VoiceAudioWatermarkPayload
  | ({ type: 'audio.end' | 'response.cancelled'; lastAudioSequence: number | null;
      firstAudioSample?: number; lastAudioSample?: number; totalAudioSamples?: number } & VoiceResponseRef)
  | { type: 'session.warning'; code: VoiceErrorCode; recovery: VoiceRecovery; recoverable: boolean }
  | { type: 'session.error'; code: VoiceErrorCode; recovery: VoiceRecovery;
      recoverable: boolean; terminal: boolean }
  | CanvasArtifactPayload
  | CalendarFramePayload;
export type VoiceServerEvent = VoiceEnvelope & VoiceServerPayload;

type Guard = (value: unknown) => boolean;
type Shape = Record<string, Guard>;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const id: Guard = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const uint: Guard = value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const safeUint: Guard = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const alignedSample: Guard = value => safeUint(value) && (value as number) % 24 === 0;
const positive: Guard = value => uint(value) && (value as number) > 0;
const bool: Guard = value => typeof value === 'boolean';
const text: Guard = value => typeof value === 'string' && value.length <= 32000;
const oneOf = (...values: readonly unknown[]): Guard => value => values.includes(value);
const nullable = (guard: Guard): Guard => value => value === null || guard(value);
const exact = (value: unknown, shape: Shape): boolean => record(value) &&
  Object.keys(value).length === Object.keys(shape).length &&
  Object.entries(shape).every(([key, guard]) => Object.hasOwn(value, key) && guard(value[key]));
const input: Guard = value => exact(value, { encoding: oneOf('pcm16'), sampleRate: oneOf(16000),
  channels: oneOf(1), endian: oneOf('little'), frameMs: oneOf(80) });
const output: Guard = value => exact(value, { encoding: oneOf('pcm16'), sampleRate: oneOf(24000),
  channels: oneOf(1), endian: oneOf('little') });
const audio: Guard = value => exact(value, { input, output: nullable(output) });
const utf8 = (value: string) => new TextEncoder().encode(value).byteLength;
const wellFormed = (value: string) => {
  for (const point of value) {
    const code = point.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
};
export function isCanvasArtifactId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}
const canvasLabel = (maxChars: number, maxBytes: number): Guard => value =>
  typeof value === 'string' && value.length > 0 && value.length <= maxChars &&
  value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value) &&
  wellFormed(value) && utf8(value) <= maxBytes;
const canvasSubtype = canvasLabel(CANVAS_ARTIFACT_LIMITS.subTypeMaxChars, CANVAS_ARTIFACT_LIMITS.subTypeMaxBytes);
const canvasTitle = canvasLabel(CANVAS_ARTIFACT_LIMITS.titleMaxChars, CANVAS_ARTIFACT_LIMITS.titleMaxBytes);
const canvasSource: Guard = value => typeof value === 'string' &&
  value.length > 0 && value.length <= CANVAS_ARTIFACT_LIMITS.sourceMaxChars && value === value.trim() &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) &&
  wellFormed(value) && utf8(value) <= CANVAS_ARTIFACT_LIMITS.sourceMaxBytes;

export function isCanvasArtifactSource(value: unknown): value is CanvasArtifactSource {
  return exact(value, {
    ordinal: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < CANVAS_ARTIFACT_LIMITS.maxArtifactsPerResponse,
    kind: oneOf('mermaid', 'chart', 'svg', 'calendar'),
    subType: canvasSubtype,
    title: canvasTitle,
    rawSource: canvasSource,
  });
}

export function isCanvasArtifactProjection(value: unknown): value is CanvasArtifactProjection {
  return exact(value, {
    responseId: isCanvasArtifactId,
    ordinal: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < CANVAS_ARTIFACT_LIMITS.maxArtifactsPerResponse,
    kind: oneOf('mermaid', 'chart', 'svg', 'calendar'),
    subType: canvasSubtype,
    title: canvasTitle,
    rawSource: canvasSource,
  });
}

export function isCanvasArtifactProjectionList(value: unknown): value is CanvasArtifactProjection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > CANVAS_ARTIFACT_LIMITS.maxArtifactsPerResponse ||
      !value.every(isCanvasArtifactProjection)) return false;
  const items = value as CanvasArtifactProjection[];
  return items.every((item, index) => item.responseId === items[0].responseId &&
      (index === 0 || item.ordinal > items[index - 1].ordinal)) &&
    items.reduce((n, item) => n + item.rawSource.length, 0) <= CANVAS_ARTIFACT_LIMITS.responseSourceMaxChars &&
    items.reduce((n, item) => n + new TextEncoder().encode(item.rawSource).byteLength, 0) <= CANVAS_ARTIFACT_LIMITS.responseSourceMaxBytes &&
    new TextEncoder().encode(JSON.stringify(items)).byteLength <= CANVAS_ARTIFACT_LIMITS.projectionMaxBytes;
}
export function isVoiceLimits(value: unknown): value is VoiceLimits {
  const shape = Object.fromEntries(Object.keys(DEFAULT_VOICE_LIMITS).map(key => [key, positive]));
  if (!exact(value, shape)) return false;
  const v = value as VoiceLimits;
  return v.liveWarningMs < v.liveMaxMs && v.finalizationMs <= v.dictationMaxMs &&
    v.inputQueueMs <= v.dictationMaxMs && v.outputQueueMs <= v.liveMaxMs;
}
export function isCreateVoiceSessionRequest(value: unknown): value is CreateVoiceSessionRequest {
  return exact(value, { protocolVersion: oneOf(1), mode: oneOf('dictation', 'live'),
    conversationId: nullable(id), locale: oneOf('en-US'),
    idempotencyKey: v => id(v) && (v as string).length >= 8 });
}
export function isPublicVoiceConfig(value: unknown): value is PublicVoiceConfig {
  return exact(value, { protocolVersion: oneOf(1),
    enabledModes: v => exact(v, { dictation: bool, live: bool }),
    supportedLocales: v => Array.isArray(v) && v.length === 1 && v[0] === 'en-US',
    limits: isVoiceLimits, inputAudio: input, outputAudio: output });
}
export function livekitRoomName(sessionId: string): string {
  return `${LIVEKIT_ROOM_PREFIX}${sessionId}`;
}
export function livekitParticipantIdentity(
  userId: string,
  sessionId: string,
  connectionEpoch: number,
): string {
  return `${userId}:${sessionId}:${connectionEpoch}`;
}
export function livekitAgentIdentity(sessionId: string): string {
  return `${LIVEKIT_AGENT_PREFIX}${sessionId}`;
}
export function isLiveKitSignalingUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 ||
      value !== value.trim() || /[\u0000-\u0020\u007f]/u.test(value) || value.endsWith('/')) {
    return false;
  }
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  return (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') &&
    parsed.username === '' && parsed.password === '' &&
    parsed.pathname === '/' && parsed.search === '' && parsed.hash === '' &&
    parsed.hostname.length > 0;
}
export function isCompactJwt(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 4096 &&
    /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}$/.test(value);
}
export function isVoiceLiveKitTransport(
  value: unknown,
  sessionId?: string,
  connectionEpoch?: number,
): value is VoiceLiveKitTransport {
  if (!exact(value, {
    url: isLiveKitSignalingUrl,
    roomName: v => id(v) && (v as string).startsWith(LIVEKIT_ROOM_PREFIX) &&
      (v as string).length > LIVEKIT_ROOM_PREFIX.length,
    participantIdentity: id,
    participantToken: isCompactJwt,
  })) return false;
  const v = value as VoiceLiveKitTransport;
  const parts = v.participantIdentity.split(':');
  if (parts.length !== 3) return false;
  const [userPart, sessionPart, epochPart] = parts;
  if (!userPart || userPart.length > 128 || /[\u0000-\u0020\u007f]/u.test(userPart)) return false;
  if (!sessionPart || !/^(?:0|[1-9]\d*)$/.test(epochPart)) return false;
  const parsedEpoch = Number(epochPart);
  if (!uint(parsedEpoch)) return false;
  if (v.roomName !== livekitRoomName(sessionPart)) return false;
  if (sessionId !== undefined && sessionPart !== sessionId) return false;
  if (connectionEpoch !== undefined && parsedEpoch !== connectionEpoch) return false;
  return true;
}
export function isCreateVoiceSessionResponse(value: unknown): value is CreateVoiceSessionResponse {
  if (!record(value)) return false;
  const hasLivekit = Object.hasOwn(value, 'livekit');
  const baseShape: Shape = {
    protocolVersion: oneOf(1), sessionId: id, conversationId: nullable(id),
    mode: oneOf('dictation', 'live'), connectionEpoch: uint, websocketUrl: oneOf('/api/voice'),
    expiresAt: v => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)),
    effectiveAudioSettings: audio, limits: isVoiceLimits,
    ...(hasLivekit ? { livekit: () => true } : {}),
  };
  if (!exact(value, baseShape)) return false;
  const v = value as CreateVoiceSessionResponse;
  if (v.mode === 'dictation') {
    return !hasLivekit && v.effectiveAudioSettings.output === null;
  }
  if (!output(v.effectiveAudioSettings.output)) return false;
  return !hasLivekit || isVoiceLiveKitTransport(v.livekit, v.sessionId, v.connectionEpoch);
}
export function isLiveKitVoiceSessionResponse(
  value: unknown,
): value is CreateVoiceSessionResponse & { mode: 'live'; livekit: VoiceLiveKitTransport } {
  return isCreateVoiceSessionResponse(value) && value.mode === 'live' &&
    isVoiceLiveKitTransport(value.livekit, value.sessionId, value.connectionEpoch);
}
const envelope: Shape = { protocolVersion: oneOf(1), sessionId: id,
  connectionEpoch: uint, eventId: id, sequence: uint };
const response: Shape = { turnId: id, responseId: id };
const clientShapes: Record<string, Shape> = {
  'session.start': { mode: oneOf('dictation', 'live'), audioSettings: input },
  'dictation.stop': {}, 'dictation.cancel': {}, 'input.mute': {}, 'input.unmute': {},
  'input.suspend': {}, 'session.end': {},
  'response.interrupt': { ...response, playbackPositionMs: uint, playedSamples: safeUint },
  'playback.progress': { ...response, playedMs: uint, playedSamples: safeUint },
  'calendar.confirm': {proposalId:id,proposalRevision:positive,answer:v =>
    exact(v,{kind:oneOf('accept')}) || exact(v,{kind:oneOf('reject')}) ||
    exact(v,{kind:oneOf('select'),calendarId:v=>typeof v === 'string' && v.length > 0 && v.length <= 1024 && v !== 'primary' && !/[\u0000-\u001f\u007f]/u.test(v)})},
};
const serverShapes: Record<string, Shape> = {
  'session.ready': { limits: isVoiceLimits, effectiveAudioSettings: audio },
  'session.ended': { reason: oneOf('completed', 'cancelled', 'disconnected',
    'duration', 'idle', 'quota', 'error', 'shutdown'), terminal: bool },
  'conversation.bound': { conversationId: id },
  'dictation.partial': { segmentId: id, text }, 'dictation.final': { segmentId: id, text },
  'dictation.complete': { finalization: oneOf('complete', 'timeout', 'empty'), unfinalizedTail: bool },
  'voice.state': { input: oneOf('listening', 'suspended', 'muted'),
    agent: oneOf('idle', 'thinking', 'speaking'), connection: oneOf('connected', 'reconnecting') },
  'audio.start': { ...response, sampleRate: oneOf(24000), firstAudioSequence: uint },
  'audio.watermark': {
    ...response,
    firstAudioSample: alignedSample,
    queuedSamples: safeUint,
    lastAudioSample: safeUint,
    final: bool,
  },
  'audio.end': { ...response, lastAudioSequence: nullable(uint) },
  'response.cancelled': { ...response, lastAudioSequence: nullable(uint) },
  'session.warning': { code: oneOf(...VOICE_ERROR_CODES), recovery: oneOf('none',
    'retry_dictation', 'resume_gesture', 'repeat_turn', 'return_to_chat', 'resume_call'), recoverable: bool },
  'session.error': { code: oneOf(...VOICE_ERROR_CODES), recovery: oneOf('none',
    'retry_dictation', 'resume_gesture', 'repeat_turn', 'return_to_chat', 'resume_call'),
    recoverable: bool, terminal: bool },
  'canvas.artifact': {
    turnId: isCanvasArtifactId,
    responseId: isCanvasArtifactId,
    ordinal: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < CANVAS_ARTIFACT_LIMITS.maxArtifactsPerResponse,
    kind: oneOf('mermaid', 'chart', 'svg', 'calendar'),
    subType: canvasSubtype,
    title: canvasTitle,
    rawSource: canvasSource,
  },
  'calendar.frame': { ...response, attemptId: id, event: isCalendarPresentationEvent },
};
const voiceSaveSnapshot: Guard = value => exact(value, {
  state: oneOf(...VOICE_SAVE_STATES),
  epoch: id,
  version: safeUint,
  durableVersion: safeUint,
});
const optionalEventFields: Record<string, Shape> = {
  'conversation.bound': { turnId: id, save: voiceSaveSnapshot },
  'response.interrupt': { proof: oneOf(...VOICE_PLAYBACK_PROOFS) },
  'playback.progress': { proof: oneOf(...VOICE_PLAYBACK_PROOFS) },
  'audio.start': { firstAudioSample: alignedSample },
  'audio.end': {
    firstAudioSample: alignedSample,
    lastAudioSample: safeUint,
    totalAudioSamples: safeUint,
  },
  'response.cancelled': {
    firstAudioSample: alignedSample,
    lastAudioSample: safeUint,
    totalAudioSamples: safeUint,
  },
};
function hasValidSampleBounds(value: Record<string, unknown>): boolean {
  if (value.type === 'conversation.bound') {
    return Object.hasOwn(value, 'turnId') === Object.hasOwn(value, 'save');
  }
  if (value.type === 'audio.watermark') {
    const first = value.firstAudioSample as number;
    const queued = value.queuedSamples as number;
    const last = value.lastAudioSample as number;
    return Number.isSafeInteger(first + queued) && last === first + queued;
  }
  if (value.type === 'audio.end' || value.type === 'response.cancelled') {
    const hasFirst = Object.hasOwn(value, 'firstAudioSample');
    const hasLast = Object.hasOwn(value, 'lastAudioSample');
    const hasTotal = Object.hasOwn(value, 'totalAudioSamples');
    if (!hasFirst && !hasLast && !hasTotal) return true;
    const first = hasFirst ? (value.firstAudioSample as number) : undefined;
    const last = hasLast ? (value.lastAudioSample as number) : undefined;
    const total = hasTotal ? (value.totalAudioSamples as number) : undefined;
    if (first !== undefined && last !== undefined && last < first) return false;
    if (first !== undefined && total !== undefined && !Number.isSafeInteger(first + total)) return false;
    if (first !== undefined && last !== undefined && total !== undefined && last !== first + total) return false;
    if (first === undefined && last !== undefined && total !== undefined) {
      if (last < total || (last - total) % 24 !== 0) return false;
    }
  }
  return true;
}
function isEvent(value: unknown, shapes: Record<string, Shape>): boolean {
  if (!record(value) || typeof value.type !== 'string' || !Object.hasOwn(shapes, value.type)) return false;
  const opt = optionalEventFields[value.type];
  const extra: Shape = {};
  if (opt) {
    for (const [key, guard] of Object.entries(opt)) {
      if (Object.hasOwn(value, key)) extra[key] = guard;
    }
  }
  return exact(value, { ...envelope, type: oneOf(value.type), ...shapes[value.type], ...extra }) &&
    hasValidSampleBounds(value);
}
export function clampPlayedSamplesToWatermark(
  firstAudioSample: number,
  currentPlayedSamples: number,
  activeDeltaSamples: number,
  watermarkLastAudioSample: number,
): number {
  if (!alignedSample(firstAudioSample) || !safeUint(currentPlayedSamples) ||
      !safeUint(activeDeltaSamples) || !safeUint(watermarkLastAudioSample) ||
      watermarkLastAudioSample < firstAudioSample || currentPlayedSamples < firstAudioSample) {
    throw new Error('INVALID_VOICE_CONTROL');
  }
  const clampedCurrent = Math.min(currentPlayedSamples, watermarkLastAudioSample);
  if (watermarkLastAudioSample === firstAudioSample || activeDeltaSamples === 0) {
    return clampedCurrent;
  }
  return Math.min(watermarkLastAudioSample, clampedCurrent + activeDeltaSamples);
}
export function isVoiceClientEvent(value: unknown): value is VoiceClientEvent {
  return isEvent(value, clientShapes);
}
export function isVoiceServerEvent(value: unknown, mode: VoiceMode): value is VoiceServerEvent {
  if (!isEvent(value, serverShapes)) return false;
  const v = value as VoiceServerEvent;
  if (mode === 'live' && v.type.startsWith('dictation.')) return false;
  if (mode === 'dictation' && ['voice.state', 'audio.start', 'audio.watermark', 'audio.end', 'response.cancelled', 'conversation.bound', 'canvas.artifact', 'calendar.frame'].includes(v.type)) return false;
  if (v.type === 'calendar.frame' && utf8(JSON.stringify(v)) > 16384) return false;
  if (v.type === 'canvas.artifact') {
    if (!isCanvasArtifactId(v.sessionId) || !isCanvasArtifactId(v.eventId)) return false;
  }
  if (v.type === 'session.ready') return mode === 'dictation'
    ? v.effectiveAudioSettings.output === null : output(v.effectiveAudioSettings.output);
  return true;
}
export function parseVoiceControl(json: string, direction: 'client', mode: VoiceMode): VoiceClientEvent;
export function parseVoiceControl(json: string, direction: 'server', mode: VoiceMode): VoiceServerEvent;
export function parseVoiceControl(json: string, direction: 'client' | 'server', mode: VoiceMode): VoiceClientEvent | VoiceServerEvent {
  if (json.length > MAX_VOICE_CONTROL_BYTES || new TextEncoder().encode(json).byteLength > MAX_VOICE_CONTROL_BYTES) throw new Error('INVALID_VOICE_CONTROL');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('INVALID_VOICE_CONTROL'); }
  if (direction === 'client' && isVoiceClientEvent(value)) {
    if (value.type === 'session.start' && value.mode !== mode) throw new Error('INVALID_VOICE_CONTROL');
    if (mode === 'live' && value.type.startsWith('dictation.')) throw new Error('INVALID_VOICE_CONTROL');
    if (mode === 'dictation' && ['input.mute', 'input.unmute', 'input.suspend',
      'response.interrupt', 'playback.progress', 'calendar.confirm'].includes(value.type))
      throw new Error('INVALID_VOICE_CONTROL');
    return value;
  }
  if (direction === 'server' && isVoiceServerEvent(value, mode)) return value;
  throw new Error('INVALID_VOICE_CONTROL');
}
export type VoiceControlChunkPacket = {
  protocolVersion: 1;
  type: 'control.chunk';
  sessionId: string;
  connectionEpoch: number;
  sequence: number;
  eventId: string;
  turnId?: string;
  responseId?: string;
  chunkIndex: number;
  chunkCount: number;
  totalBytes: number;
  payload: string;
};
export type VoiceControlReassemblyResult<E extends VoiceClientEvent | VoiceServerEvent> =
  | { status: 'complete'; event: E; chunked: boolean; chunkCount: number; totalBytes: number }
  | {
      status: 'partial';
      eventId: string;
      sequence: number;
      turnId?: string;
      responseId?: string;
      chunkIndex: number;
      chunkCount: number;
      receivedBytes: number;
      totalBytes: number;
    };
export function isVoiceControlChunkPacket(value: unknown): value is VoiceControlChunkPacket {
  if (!record(value)) return false;
  const hasTurnId = Object.hasOwn(value, 'turnId');
  const hasResponseId = Object.hasOwn(value, 'responseId');
  if (hasTurnId !== hasResponseId) return false;
  const shape: Shape = {
    protocolVersion: oneOf(1),
    type: oneOf('control.chunk'),
    sessionId: id,
    connectionEpoch: uint,
    sequence: uint,
    eventId: id,
    ...(hasTurnId ? { turnId: id, responseId: id } : {}),
    chunkIndex: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 &&
      v < LIVEKIT_CONTROL_LIMITS.maxChunksPerMessage,
    chunkCount: v => typeof v === 'number' && Number.isInteger(v) && v >= 2 &&
      v <= LIVEKIT_CONTROL_LIMITS.maxChunksPerMessage,
    totalBytes: v => typeof v === 'number' && Number.isInteger(v) &&
      v > LIVEKIT_CONTROL_LIMITS.maxPacketBytes && v <= LIVEKIT_CONTROL_LIMITS.maxMessageBytes,
    payload: v => typeof v === 'string' && v.length > 0 && wellFormed(v) &&
      utf8(v) <= LIVEKIT_CONTROL_LIMITS.maxChunkBytes,
  };
  if (!exact(value, shape)) return false;
  const v = value as VoiceControlChunkPacket;
  return v.chunkIndex < v.chunkCount && utf8(v.payload) <= v.totalBytes;
}
export function encodeVoiceControlPackets(
  eventOrJson: VoiceClientEvent | VoiceServerEvent | string,
  direction: 'client' | 'server',
  mode: VoiceMode,
): Uint8Array[] {
  const json = typeof eventOrJson === 'string' ? eventOrJson : JSON.stringify(eventOrJson);
  const parsed = direction === 'client'
    ? parseVoiceControl(json, 'client', mode)
    : parseVoiceControl(json, 'server', mode);
  const rawBytes = new TextEncoder().encode(json);
  const totalBytes = rawBytes.byteLength;
  if (totalBytes <= LIVEKIT_CONTROL_LIMITS.maxPacketBytes) {
    return [rawBytes];
  }
  if (mode !== 'live') throw new Error('INVALID_VOICE_CONTROL');
  const ref = 'turnId' in parsed && 'responseId' in parsed &&
    typeof parsed.turnId === 'string' && typeof parsed.responseId === 'string'
    ? { turnId: parsed.turnId, responseId: parsed.responseId }
    : {};
  const slices: string[] = [];
  let current = '';
  let currentUtf8 = 0;
  let currentEscapedUtf8 = 0;
  for (const ch of json) {
    const chUtf8 = utf8(ch);
    const chEscapedUtf8 = utf8(JSON.stringify(ch)) - 2;
    if (
      current.length > 0 &&
      (currentUtf8 + chUtf8 > LIVEKIT_CONTROL_LIMITS.maxChunkBytes ||
        currentEscapedUtf8 + chEscapedUtf8 > LIVEKIT_CONTROL_LIMITS.maxChunkBytes)
    ) {
      slices.push(current);
      current = ch;
      currentUtf8 = chUtf8;
      currentEscapedUtf8 = chEscapedUtf8;
    } else {
      current += ch;
      currentUtf8 += chUtf8;
      currentEscapedUtf8 += chEscapedUtf8;
    }
  }
  if (current.length > 0) slices.push(current);
  const chunkCount = slices.length;
  if (chunkCount < 2 || chunkCount > LIVEKIT_CONTROL_LIMITS.maxChunksPerMessage) {
    throw new Error('INVALID_VOICE_CONTROL');
  }
  return slices.map((payload, chunkIndex) => {
    const packet: VoiceControlChunkPacket = {
      protocolVersion: 1,
      type: 'control.chunk',
      sessionId: parsed.sessionId,
      connectionEpoch: parsed.connectionEpoch,
      sequence: parsed.sequence,
      eventId: parsed.eventId,
      ...ref,
      chunkIndex,
      chunkCount,
      totalBytes,
      payload,
    };
    if (!isVoiceControlChunkPacket(packet)) throw new Error('INVALID_VOICE_CONTROL');
    const encoded = new TextEncoder().encode(JSON.stringify(packet));
    if (encoded.byteLength > LIVEKIT_CONTROL_LIMITS.maxPacketBytes) {
      throw new Error('INVALID_VOICE_CONTROL');
    }
    return encoded;
  });
}
type InflightControlReassembly = {
  sessionId: string;
  connectionEpoch: number;
  sequence: number;
  eventId: string;
  turnId?: string;
  responseId?: string;
  chunkCount: number;
  totalBytes: number;
  receivedBytes: number;
  nextChunkIndex: number;
  startedAtMs: number;
  parts: string[];
};
export class VoiceControlReassembler<D extends 'client' | 'server' = 'server'> {
  private readonly inflight = new Map<string, InflightControlReassembly>();
  private readonly direction: D;
  private readonly mode: VoiceMode;
  private readonly binding?: { sessionId: string; connectionEpoch: number };
  private bufferedBytes = 0;

  constructor(
    direction: D,
    mode: VoiceMode,
    binding?: { sessionId: string; connectionEpoch: number },
  ) {
    this.direction = direction;
    this.mode = mode;
    this.binding = binding;
  }

  get pendingAssemblies(): number {
    return this.inflight.size;
  }

  get pendingBytes(): number {
    return this.bufferedBytes;
  }

  clear(): void {
    this.inflight.clear();
    this.bufferedBytes = 0;
  }

  sweep(nowMs = Date.now()): void {
    for (const [eventId, entry] of this.inflight) {
      if (nowMs - entry.startedAtMs > LIVEKIT_CONTROL_LIMITS.reassemblyTimeoutMs) {
        this.bufferedBytes -= entry.receivedBytes;
        this.inflight.delete(eventId);
        throw new Error('INVALID_VOICE_CONTROL');
      }
    }
  }

  push(
    packetBytes: Uint8Array,
    nowMs = Date.now(),
  ): VoiceControlReassemblyResult<D extends 'client' ? VoiceClientEvent : VoiceServerEvent> {
    this.sweep(nowMs);
    if (
      !(packetBytes instanceof Uint8Array) ||
      packetBytes.byteLength === 0 ||
      packetBytes.byteLength > LIVEKIT_CONTROL_LIMITS.maxPacketBytes
    ) {
      throw new Error('INVALID_VOICE_CONTROL');
    }
    let textDecoded: string;
    try {
      textDecoded = new TextDecoder('utf-8', { fatal: true }).decode(packetBytes);
    } catch {
      throw new Error('INVALID_VOICE_CONTROL');
    }
    let rawValue: unknown;
    try {
      rawValue = JSON.parse(textDecoded);
    } catch {
      throw new Error('INVALID_VOICE_CONTROL');
    }
    if (!record(rawValue)) throw new Error('INVALID_VOICE_CONTROL');

    if (rawValue.type !== 'control.chunk') {
      const event = this.parseEvent(textDecoded);
      if (this.binding) {
        if (event.sessionId !== this.binding.sessionId) throw new Error('VOICE_BINDING_MISMATCH');
        if (event.connectionEpoch !== this.binding.connectionEpoch) throw new Error('STALE_CONNECTION_EPOCH');
      }
      return {
        status: 'complete',
        event: event as D extends 'client' ? VoiceClientEvent : VoiceServerEvent,
        chunked: false,
        chunkCount: 1,
        totalBytes: packetBytes.byteLength,
      };
    }

    if (this.mode !== 'live' || !isVoiceControlChunkPacket(rawValue)) {
      throw new Error('INVALID_VOICE_CONTROL');
    }
    if (this.binding) {
      if (rawValue.sessionId !== this.binding.sessionId) throw new Error('VOICE_BINDING_MISMATCH');
      if (rawValue.connectionEpoch !== this.binding.connectionEpoch) throw new Error('STALE_CONNECTION_EPOCH');
    }

    const partBytes = utf8(rawValue.payload);
    let entry = this.inflight.get(rawValue.eventId);
    if (!entry) {
      if (rawValue.chunkIndex !== 0) throw new Error('VOICE_SEQUENCE_ERROR');
      if (
        this.inflight.size >= LIVEKIT_CONTROL_LIMITS.maxInflightReassemblies ||
        this.bufferedBytes + partBytes > LIVEKIT_CONTROL_LIMITS.maxMessageBytes
      ) {
        throw new Error('AUDIO_BUFFER_OVERFLOW');
      }
      entry = {
        sessionId: rawValue.sessionId,
        connectionEpoch: rawValue.connectionEpoch,
        sequence: rawValue.sequence,
        eventId: rawValue.eventId,
        ...(rawValue.turnId !== undefined ? { turnId: rawValue.turnId, responseId: rawValue.responseId } : {}),
        chunkCount: rawValue.chunkCount,
        totalBytes: rawValue.totalBytes,
        receivedBytes: 0,
        nextChunkIndex: 0,
        startedAtMs: nowMs,
        parts: [],
      };
      this.inflight.set(rawValue.eventId, entry);
    } else {
      if (
        entry.sessionId !== rawValue.sessionId ||
        entry.connectionEpoch !== rawValue.connectionEpoch ||
        entry.sequence !== rawValue.sequence ||
        entry.turnId !== rawValue.turnId ||
        entry.responseId !== rawValue.responseId ||
        entry.chunkCount !== rawValue.chunkCount ||
        entry.totalBytes !== rawValue.totalBytes
      ) {
        this.bufferedBytes -= entry.receivedBytes;
        this.inflight.delete(rawValue.eventId);
        throw new Error('INVALID_VOICE_CONTROL');
      }
      if (rawValue.chunkIndex < entry.nextChunkIndex) {
        if (entry.parts[rawValue.chunkIndex] === rawValue.payload) {
          return {
            status: 'partial',
            eventId: entry.eventId,
            sequence: entry.sequence,
            ...(entry.turnId !== undefined ? { turnId: entry.turnId, responseId: entry.responseId } : {}),
            chunkIndex: rawValue.chunkIndex,
            chunkCount: entry.chunkCount,
            receivedBytes: entry.receivedBytes,
            totalBytes: entry.totalBytes,
          };
        }
        this.bufferedBytes -= entry.receivedBytes;
        this.inflight.delete(rawValue.eventId);
        throw new Error('VOICE_SEQUENCE_ERROR');
      }
      if (rawValue.chunkIndex !== entry.nextChunkIndex) {
        this.bufferedBytes -= entry.receivedBytes;
        this.inflight.delete(rawValue.eventId);
        throw new Error('VOICE_SEQUENCE_ERROR');
      }
      if (this.bufferedBytes + partBytes > LIVEKIT_CONTROL_LIMITS.maxMessageBytes) {
        this.bufferedBytes -= entry.receivedBytes;
        this.inflight.delete(rawValue.eventId);
        throw new Error('AUDIO_BUFFER_OVERFLOW');
      }
    }

    const nextReceivedBytes = entry.receivedBytes + partBytes;
    const isFinalChunk = rawValue.chunkIndex === entry.chunkCount - 1;
    if (
      nextReceivedBytes > entry.totalBytes ||
      (isFinalChunk && nextReceivedBytes !== entry.totalBytes) ||
      (!isFinalChunk && nextReceivedBytes >= entry.totalBytes)
    ) {
      this.bufferedBytes -= entry.receivedBytes;
      this.inflight.delete(rawValue.eventId);
      throw new Error('INVALID_VOICE_CONTROL');
    }

    entry.parts.push(rawValue.payload);
    entry.receivedBytes = nextReceivedBytes;
    entry.nextChunkIndex++;
    this.bufferedBytes += partBytes;

    if (!isFinalChunk) {
      return {
        status: 'partial',
        eventId: entry.eventId,
        sequence: entry.sequence,
        ...(entry.turnId !== undefined ? { turnId: entry.turnId, responseId: entry.responseId } : {}),
        chunkIndex: rawValue.chunkIndex,
        chunkCount: entry.chunkCount,
        receivedBytes: entry.receivedBytes,
        totalBytes: entry.totalBytes,
      };
    }

    this.bufferedBytes -= entry.receivedBytes;
    this.inflight.delete(rawValue.eventId);
    const reassembledJson = entry.parts.join('');
    const event = this.parseEvent(reassembledJson);

    const eventTurnId = 'turnId' in event && typeof event.turnId === 'string' ? event.turnId : undefined;
    const eventResponseId = 'responseId' in event && typeof event.responseId === 'string' ? event.responseId : undefined;
    if (
      event.sessionId !== entry.sessionId ||
      event.connectionEpoch !== entry.connectionEpoch ||
      event.sequence !== entry.sequence ||
      event.eventId !== entry.eventId ||
      eventTurnId !== entry.turnId ||
      eventResponseId !== entry.responseId
    ) {
      throw new Error('INVALID_VOICE_CONTROL');
    }

    return {
      status: 'complete',
      event: event as D extends 'client' ? VoiceClientEvent : VoiceServerEvent,
      chunked: true,
      chunkCount: entry.chunkCount,
      totalBytes: entry.totalBytes,
    };
  }

  private parseEvent(json: string): VoiceClientEvent | VoiceServerEvent {
    return this.direction === 'client'
      ? parseVoiceControl(json, 'client', this.mode)
      : parseVoiceControl(json, 'server', this.mode);
  }
}
