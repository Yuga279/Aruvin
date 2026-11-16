/**
 * ============================================================================
 * FILE: api.ts
 * LOCATION: backend/src/contracts/api.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define versioned, strict client-safe HTTP request and response schemas.
 *
 * ROLE IN PROJECT:
 *    Shares resource paths and validated payload types across backend HTTP
 *    adapters and the frontend without accepting client identity or model data.
 *
 * KEY COMPONENTS:
 *    - API_ROUTES: Resource-relative paths served beneath the API prefix.
 *    - Request/response schemas: Bounded submit, retry, paging, and status data.
 * ============================================================================
 */

import { z } from 'zod';
import { attemptStatusSchema } from './attempt.js';
import { DEFAULT_BUDGETS } from './budgets.js';
import { clientErrorBodySchema } from './errors.js';
import { idSchema, isoDateSchema } from './identifiers.js';
import { messageRecordObjectSchema } from './message.js';
import { isCanvasArtifactId } from './voice-wire.js';
import { CONTRACT_VERSIONS } from './versions.js';
import { calendarCompatibleTurnStateSchema } from './calendar-wire.js';
import { calendarReplyReferenceSchema } from './calendar-authority.js';
import { saveStateSnapshotSchema } from './stream.js';

export const API_PROTOCOL_VERSION = CONTRACT_VERSIONS.api;

export const API_ROUTES = {
  sessions: '/sessions',
  session: (sessionId: string) => `/sessions/${sessionId}`,
  messages: (sessionId: string) => `/sessions/${sessionId}/messages`,
  turns: (sessionId: string) => `/sessions/${sessionId}/turns`,
  turnStatus: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}`,
  turnStream: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/stream`,
  cancelTurn: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/cancel`,
  retryTurn: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/retry`,
  retrySave: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/retry-save`,
} as const;

export const submitTurnRequestSchema = z
  .object({
    sessionId: idSchema.nullable(),
    content: z.string().min(1).max(DEFAULT_BUDGETS.maxInputChars),
    idempotencyKey: z.string().min(8).max(128),
    expectedEpoch: idSchema.optional(),
    calendarProtocol: z.union([z.literal(2), z.literal(3)]).optional(),
    /**
     * Optional untrusted causal reference to the proposal revision this reply answers.
     *
     * It is bounded, optional, and never approval: it lets the server tell a reply to
     * a superseded disclosure from an affirmative to the current one. A reply without
     * it stays valid here; the server-side acceptance rule is a runtime concern.
     */
    calendarReplyTo: calendarReplyReferenceSchema.optional(),
  })
  .strict();

export const retryTurnRequestSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(128),
    expectedEpoch: idSchema.optional(),
    calendarProtocol: z.union([z.literal(2), z.literal(3)]).optional(),
  })
  .strict();

export const cancelTurnRequestSchema = z
  .object({
    attemptId: idSchema,
  })
  .strict();

export const retrySaveRequestSchema = z.object({ epoch: idSchema,
  version: z.number().int().nonnegative().safe() }).strict();

export const submitTurnResponseSchema = z
  .object({
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    userMessageId: idSchema,
    streamPath: z.string().min(1),
    processEpoch: idSchema.optional(),
  })
  .strict();

export const sessionSummarySchema = z
  .object({
    sessionId: idSchema,
    title: z.string().min(1).max(DEFAULT_BUDGETS.titleMaxChars),
    pinned: z.boolean().optional(),
    createdAt: isoDateSchema,
    lastActivityAt: isoDateSchema,
  })
  .strict();

export const listSessionsResponseSchema = z
  .object({
    items: z.array(sessionSummarySchema).max(DEFAULT_BUDGETS.maxPageSize),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();

export const visibleMessageSchema = messageRecordObjectSchema.pick({
  messageId: true,
  turnId: true,
  eventId: true,
  sequence: true,
  role: true,
  content: true,
  createdAt: true,
  completionStatus: true,
  truncated: true,
  mode: true,
  voiceSessionId: true,
  voiceDurationSeconds: true,
  voiceTranscripts: true,
  canvasArtifacts: true,
  calendarView: true,
}).superRefine((v, ctx) => {
  if (v.calendarView !== undefined && v.role !== 'assistant') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['role'], message: 'calendar views require assistant role' });
  }
  if (v.canvasArtifacts !== undefined) {
    if (v.role !== 'assistant') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['role'], message: 'canvas artifacts require assistant role' });
    }
    if (v.mode !== 'live') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mode'], message: 'canvas artifacts require live mode' });
    }
    if (!v.voiceSessionId || !isCanvasArtifactId(v.voiceSessionId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['voiceSessionId'], message: 'canvas artifacts require valid voiceSessionId' });
    }
  }
});

export const activeSessionTurnSchema = z
  .object({
    turnId: idSchema,
    attemptId: idSchema,
    status: z.enum(['accepted', 'generating', 'finalizing']),
    mode: z.enum(['text', 'live']).optional(),
  })
  .strict();

export const listMessagesResponseSchema = z
  .object({
    items: z.array(visibleMessageSchema).max(DEFAULT_BUDGETS.maxPageSize),
    nextCursor: z.string().min(1).nullable(),
    olderAvailable: z.boolean(),
    save: saveStateSnapshotSchema.optional(),
    saveTurnId: idSchema.optional(),
    activeTurn: activeSessionTurnSchema.optional(),
  })
  .strict();

export const turnStatusResponseSchema = z
  .object({
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    status: attemptStatusSchema,
    truncated: z.boolean(),
    error: clientErrorBodySchema.nullable(),
    calendar: calendarCompatibleTurnStateSchema.optional(),
    save: saveStateSnapshotSchema.optional(),
  })
  .strict();

export const pageRequestSchema = z
  .object({
    cursor: z.string().min(1).nullable(),
    limit: z
      .number()
      .int()
      .positive()
      .max(DEFAULT_BUDGETS.maxPageSize)
      .default(DEFAULT_BUDGETS.defaultPageSize),
  })
  .strict();

export type SubmitTurnRequest = z.infer<typeof submitTurnRequestSchema>;
export type RetryTurnRequest = z.infer<typeof retryTurnRequestSchema>;
export type CancelTurnRequest = z.infer<typeof cancelTurnRequestSchema>;
export type SubmitTurnResponse = z.infer<typeof submitTurnResponseSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;
export type VisibleMessage = z.infer<typeof visibleMessageSchema>;
export type ActiveSessionTurn = z.infer<typeof activeSessionTurnSchema>;
export type ListMessagesResponse = z.infer<typeof listMessagesResponseSchema>;
export type TurnStatusResponse = z.infer<typeof turnStatusResponseSchema>;
export type PageRequest = z.infer<typeof pageRequestSchema>;
