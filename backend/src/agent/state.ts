/**
 * ============================================================================
 * FILE: state.ts
 * LOCATION: backend/src/agent/state.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define strict bounded public graph input, boundary, and saved-result schemas.
 *
 * ROLE IN PROJECT:
 *    Keeps LangGraph checkpoint channels reference-only so transcripts, prompts,
 *    credentials, and private reasoning never enter durable graph state.
 *
 * KEY COMPONENTS:
 *    - boundaryFor/emptyBoundary: Canonical manifest hash and empty-session gate.
 *    - graphInputSchema/resultSchema: Immutable acceptance and sealed public result.
 *    - calendarCursorSchema/calendarSealSchema: Compatible v1/v2 reference-only decoders.
 *    - assertRestorableBoundary: Honest refusal when the committed manifest moved.
 *    - TurnState: Replace-value channels for input, boundary, result, sealed, rebase.
 * ============================================================================
 */

import { Annotation } from '@langchain/langgraph';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { agentMemoryManifestSchema, type AgentMemoryManifest } from '../contracts/agent-memory.js';
import { attemptRecordSchema } from '../contracts/attempt.js';
import { repairDiagnosticsSchema } from '../contracts/calendar-model.js';
import { calendarLimitsSchema } from '../contracts/calendar-policy.js';
import { calendarViewSchema } from '../contracts/calendar-view.js';
import { idSchema, isoDateSchema } from '../contracts/identifiers.js';
import { accountingRecordSchema } from '../contracts/metadata.js';
import { messageRecordSchema } from '../contracts/message.js';
import { canvasArtifactsSchema } from '../contracts/canvas-artifact.js';
import { compatibleSkillCheckpointRefsSchema } from '../persistence/calendar-checkpoints.js';
import { AppError } from '../platform/errors/app-error.js';
export const boundarySchema = z.object({ contextVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  manifestHash: z.string().length(64) }).strict();
export const graphInputSchema = z.object({ attempt: attemptRecordSchema,
  assistantSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export const resultSchema = z.object({ input: graphInputSchema, assistant: messageRecordSchema,
  accounting: accountingRecordSchema, base: boundarySchema, target: agentMemoryManifestSchema,
  outcome: z.enum(['completed', 'truncated']) }).strict();
export type Boundary = z.infer<typeof boundarySchema>;
export type GraphInput = z.infer<typeof graphInputSchema>;
export type SavedResult = z.infer<typeof resultSchema>;
export const rebaseSchema = z.object({ base: boundarySchema, target: agentMemoryManifestSchema }).strict();
export const calendarCursorV1Schema = z.object({
  version: z.literal(1),
  configRevision: z.number().int().nonnegative(),
  connectionId: idSchema,
  connectionRevision: z.number().int().positive(),
  targetRevision: z.number().int().positive(),
  trustedNow: isoDateSchema,
  trustedTimeZone: z.string().min(1).max(100),
  limits: calendarLimitsSchema,
  next: z.enum(['decide', 'execute', 'seal']),
  pendingDecisionId: idSchema.nullable(),
  repair: z.object({ rejectedDecisionId: idSchema, diagnostics: repairDiagnosticsSchema }).strict().nullable(),
}).strict();
export const calendarCursorV2Schema = z.object({
  version: z.literal(2),
  schemaRevision: z.literal('google-calendar.v2'),
  configRevision: z.number().int().nonnegative(),
  connectionId: idSchema,
  connectionRevision: z.number().int().positive(),
  accountSubjectId: z.string().min(1).max(255),
  deadlineAt: isoDateSchema,
  trustedNow: isoDateSchema,
  trustedTimeZone: z.string().min(1).max(100),
  limits: calendarLimitsSchema,
  next: z.enum(['decide', 'execute', 'seal']),
  pendingDecisionId: idSchema.nullable(),
  pendingToolCallId: idSchema.nullable(),
  pendingOperationId: idSchema.nullable(),
  pendingIntentId: idSchema.nullable(),
  pendingProposalId: idSchema.nullable(),
  repair: z.object({ rejectedDecisionId: idSchema, diagnostics: repairDiagnosticsSchema }).strict().nullable(),
}).strict();
export const calendarCursorSchema = z.union([calendarCursorV1Schema, calendarCursorV2Schema]);
export const calendarSealV1Schema = z.object({
  version: z.literal(1),
  input: graphInputSchema,
  base: boundarySchema,
  target: agentMemoryManifestSchema,
  finalDecisionId: idSchema,
  dispatchIds: z.array(idSchema).max(8).refine(ids => new Set(ids).size === ids.length),
  operationId: idSchema.nullable(),
  outcome: z.enum(['completed', 'truncated']),
  assistantCreatedAt: isoDateSchema,
}).strict();
export const calendarNarrationRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text-decision'), decisionId: idSchema }).strict(),
  z.object({ kind: z.literal('proposal-message'), proposalId: idSchema, proposalRevision: z.number().int().positive() }).strict(),
]);
export const calendarSealV2Schema = z.object({
  version: z.literal(2),
  input: graphInputSchema,
  base: boundarySchema,
  target: agentMemoryManifestSchema,
  narrationRef: calendarNarrationRefSchema,
  dispatchIds: z.array(idSchema).max(8).refine(ids => new Set(ids).size === ids.length),
  operationId: idSchema.nullable(),
  outcome: z.enum(['completed', 'truncated']),
  assistantCreatedAt: isoDateSchema,
  view: calendarViewSchema.optional(),
  assistantFields: z.object({ mode: z.enum(['text', 'live']).optional(),
    visibility: z.enum(['visible', 'internal']).optional(), voiceSessionId: idSchema.optional(),
    canvasArtifacts: canvasArtifactsSchema.optional() }).strict().optional(),
}).strict();
export const calendarSealSchema = z.union([calendarSealV1Schema, calendarSealV2Schema]);
export type CalendarCursor = z.infer<typeof calendarCursorSchema>;
export type CalendarSeal = z.infer<typeof calendarSealSchema>;
export type CalendarRefs = z.infer<typeof compatibleSkillCheckpointRefsSchema>;
export function assertRestorableBoundary(base: Boundary, committed: Boundary | null): void {
  if (!committed) return;
  if (base.contextVersion !== committed.contextVersion || base.manifestHash !== committed.manifestHash)
    throw new AppError('NOT_READY', 'Chat context needs recovery.');
}
export function boundaryFor(m: AgentMemoryManifest): Boundary {
  const canonical = agentMemoryManifestSchema.parse(m);
  return { contextVersion: canonical.contextVersion,
    manifestHash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex') };
}
export function emptyBoundary(m: AgentMemoryManifest): Boundary {
  if (m.contextVersion !== 0 || m.messageRefs.length) throw new AppError('NOT_READY', 'Chat context needs recovery.');
  return boundaryFor(m);
}
export const TurnState = Annotation.Root({
  input: Annotation<GraphInput | null>(), boundary: Annotation<Boundary | null>(),
  result: Annotation<SavedResult | null>(), sealed: Annotation<boolean>(),
  rebase: Annotation<z.infer<typeof rebaseSchema> | null>(),
  calendarCursor: Annotation<CalendarCursor | null>(),
  calendarSeal: Annotation<CalendarSeal | null>(),
  calendarRefs: Annotation<CalendarRefs | null>(),
});
