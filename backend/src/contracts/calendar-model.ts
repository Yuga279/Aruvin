import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { SKILL_PROTOCOL_VERSION, type CalendarFailure } from './calendar-policy.js';
import { activateSkillEnvelopeSchema, calendarCallSchema, calendarCallV1Schema, calendarToolNameSchema,
  CALENDAR_TOOLS, callToolEnvelopeSchema, repairDiagnosticsSchema, skillNativeNameSchema,
  type CalendarRepairDiagnostics, type SkillNativeDefinition } from './calendar-tools.js';
import { sourceReferenceSchema, sourceReferenceV2Schema } from './calendar-sources.js';
import { sha256Schema } from './calendar-connections.js';
import type { CalendarModelDispatch } from './calendar-accounting.js';

export { repairDiagnosticsSchema };
export type { CalendarRepairDiagnostics };

const boundedArguments = z.string().refine(v => Buffer.byteLength(v, 'utf8') <= 16384);
const readableNativeNameSchema = z.union([calendarToolNameSchema, skillNativeNameSchema]);
export const nativeToolCallSchema = z.object({ id: idSchema, type: z.literal('function'),
  function: z.object({ name: readableNativeNameSchema, arguments: boundedArguments }).strict() }).strict();
export const nativeAssistantToolSchema = z.object({ role: z.literal('assistant'),
  content: z.string().max(32000).nullable(), tool_calls: z.array(nativeToolCallSchema).length(1) }).strict();
const textMessageSchema = z.object({ role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(131072) }).strict();
export const nativeToolResultSchema = z.object({ role: z.literal('tool'), tool_call_id: idSchema,
  name: readableNativeNameSchema, content: boundedArguments }).strict();
export const nativeModelMessageSchema = z.union([textMessageSchema, nativeAssistantToolSchema, nativeToolResultSchema]);
export type NativeCalendarModelMessage = z.infer<typeof nativeModelMessageSchema>;
export const completeToolGroupSchema = z.object({ assistant: nativeAssistantToolSchema,
  result: nativeToolResultSchema, sources: z.array(sourceReferenceSchema).max(6) }).strict().refine(v =>
  v.assistant.tool_calls[0].id === v.result.tool_call_id
  && v.assistant.tool_calls[0].function.name === v.result.name);
export type CompleteCalendarToolGroup = z.infer<typeof completeToolGroupSchema>;
export const nativeToolFragmentSchema = z.object({ index: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  id: idSchema.optional(), type: z.literal('function').optional(),
  function: z.object({ name: z.string().max(64).optional(), arguments: boundedArguments.optional() }).strict().optional(),
}).strict();
export const rejectedDecisionSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-rejected-decision'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema,
  decisionId: idSchema, dispatchId: idSchema, dispatchIndex: z.number().int().min(1).max(8),
  repairsUsed: z.number().int().min(0).max(2), rawArgumentsSha256: sha256Schema,
  diagnostics: repairDiagnosticsSchema, createdAt: isoDateSchema,
}).strict();
export type CalendarRejectedDecision = z.infer<typeof rejectedDecisionSchema>;
export const calendarDecisionV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), decisionId: idSchema, content: z.string().max(32000),
    truncated: z.boolean() }).strict(),
  z.object({ kind: z.literal('tool'), decisionId: idSchema, toolCallId: idSchema,
    call: calendarCallV1Schema, terminal: z.literal('tool_calls') }).strict(),
]);
export type CalendarDecisionV1 = z.infer<typeof calendarDecisionV1Schema>;
export const calendarDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), decisionId: idSchema, content: z.string().max(32000),
    truncated: z.boolean() }).strict(),
  z.object({ kind: z.literal('tool'), decisionId: idSchema, toolCallId: idSchema,
    call: calendarCallSchema, terminal: z.literal('tool_calls') }).strict(),
]);
export type CalendarDecision = z.infer<typeof calendarDecisionSchema>;
export type CalendarDispatchObservation = Pick<CalendarModelDispatch,
  'reportedModel' | 'reportedProvider' | 'generationId' | 'providerRequestId' | 'promptTokens'
  | 'completionTokens' | 'cachedPromptTokens' | 'cacheWriteTokens' | 'reasoningOutputTokens'
  | 'money' | 'firstOutputAt' | 'endedAt'>;
export type CalendarDecisionRequest = {
  dispatchId: string; decisionId: string; user: string; modelId: string;
  messages: readonly NativeCalendarModelMessage[]; tools: readonly (typeof CALENDAR_TOOLS)[number][];
  maxOutputTokens: number; remainingContextTokens: number; deadlineAt: string; signal: AbortSignal;
  dataCollection: 'deny'; processingPolicyId: string;
  repair: { rejectedDecisionId: string; diagnostics: CalendarRepairDiagnostics } | null;
};
export type CalendarDecisionChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'decision'; decision: CalendarDecision }
  | { type: 'usage'; observation: CalendarDispatchObservation }
  | { type: 'rejected'; evidence: CalendarRejectedDecision }
  | { type: 'failure'; failure: CalendarFailure };
export interface CalendarModelPort {
  stream(request: CalendarDecisionRequest): AsyncIterable<CalendarDecisionChunk>;
}
export const resumableDecisionSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-model-decision'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema, decisionId: idSchema,
  dispatchId: idSchema, configRevision: z.number().int().nonnegative(), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), schemaRevision: z.literal('google-calendar.v1'),
  rejectedDecisionId: idSchema.nullable(), decision: calendarDecisionV1Schema.nullable(),
  sources: z.array(sourceReferenceSchema).max(6), operationId: idSchema.nullable(), createdAt: isoDateSchema,
}).strict().refine(v => v.sources.every(s => s.permission.minimalEvidenceAllowed)
  && (v.decision === null || (v.decision.decisionId === v.decisionId
    && v.sources.every(s => s.permission.content === 'retained'
      && Date.parse(s.expiresAt) > Date.parse(v.createdAt)))));
export type ResumableCalendarDecision = z.infer<typeof resumableDecisionSchema>;
export interface CalendarDecisionStore {
  put(record: ResumableCalendarDecision): Promise<void>;
  get(userId: string, decisionId: string): Promise<ResumableCalendarDecision | null>;
  putRejected(record: CalendarRejectedDecision): Promise<void>;
}

export const completeToolGroupV2Schema = z.object({ assistant: nativeAssistantToolSchema,
  result: nativeToolResultSchema, sources: z.array(sourceReferenceV2Schema).max(6) }).strict().refine(v =>
  v.assistant.tool_calls[0].id === v.result.tool_call_id
    && v.assistant.tool_calls[0].function.name === v.result.name);
export const rejectedDecisionV2Schema = rejectedDecisionSchema.extend({ schemaVersion: z.literal(2),
  schemaRevision: z.literal('google-calendar.v2') }).strict();
export const resumableDecisionV2Schema = z.object({ schemaVersion: z.literal(2), kind: z.literal('calendar-model-decision'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema, decisionId: idSchema,
  dispatchId: idSchema, configRevision: z.number().int().nonnegative(), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), schemaRevision: z.literal('google-calendar.v2'),
  rejectedDecisionId: idSchema.nullable(), decision: calendarDecisionSchema.nullable(),
  sources: z.array(sourceReferenceV2Schema).max(6), operationId: idSchema.nullable(),
  intentId: idSchema.nullable(), proposalId: idSchema.nullable(), createdAt: isoDateSchema,
}).strict().refine(v => v.sources.every(s => s.permission.minimalEvidenceAllowed
    && s.connectionId === v.connectionId && s.connectionRevision === v.connectionRevision)
  && (v.decision === null || (v.decision.decisionId === v.decisionId
    && v.sources.every(s => s.permission.content === 'retained'
      && Date.parse(s.expiresAt) > Date.parse(v.createdAt)))));
export type CalendarRejectedDecisionV2 = z.infer<typeof rejectedDecisionV2Schema>;
export type ResumableCalendarDecisionV2 = z.infer<typeof resumableDecisionV2Schema>;
export type CalendarDecisionChunkV2 = Exclude<CalendarDecisionChunk, { type: 'rejected' }>
  | { type: 'rejected'; evidence: CalendarRejectedDecisionV2 };
export interface CalendarModelPortV2 {
  stream(request: CalendarDecisionRequest): AsyncIterable<CalendarDecisionChunkV2>;
}
export interface CalendarDecisionStoreV2 {
  put(record: ResumableCalendarDecisionV2): Promise<void>;
  get(userId: string, decisionId: string): Promise<ResumableCalendarDecision | ResumableCalendarDecisionV2 | null>;
  putRejected(record: CalendarRejectedDecisionV2): Promise<void>;
}

const skillNativeCallSchema = nativeToolCallSchema.refine(v => skillNativeNameSchema.safeParse(v.function.name).success);
export const skillDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), decisionId: idSchema,
    content: z.string().max(32000), truncated: z.boolean() }).strict(),
  z.object({ kind: z.literal('activate_skill'), decisionId: idSchema,
    nativeCall: skillNativeCallSchema, assistantContent: z.string().max(32000).nullable(),
    envelope: activateSkillEnvelopeSchema, terminal: z.literal('tool_calls') }).strict(),
  z.object({ kind: z.literal('call_tool'), decisionId: idSchema,
    nativeCall: skillNativeCallSchema, assistantContent: z.string().max(32000).nullable(),
    envelope: callToolEnvelopeSchema, terminal: z.literal('tool_calls') }).strict(),
]).superRefine((value, ctx) => {
  if (value.kind === 'text') return;
  let same = false;
  try { same = value.nativeCall.function.name === value.kind
    && isDeepStrictEqual(JSON.parse(value.nativeCall.function.arguments), value.envelope); }
  catch { same = false; }
  if (!same) ctx.addIssue({ code: 'custom', message: 'Native decision identity mismatch.' });
});
export type SkillDecision = z.infer<typeof skillDecisionSchema>;
export type SkillDecisionRequest = Omit<CalendarDecisionRequest, 'tools'> & {
  tools: readonly SkillNativeDefinition[];
};
export type SkillDecisionChunk = Exclude<CalendarDecisionChunkV2, { type: 'decision' }>
  | { type: 'decision'; decision: SkillDecision };
export interface SkillModelPort {
  stream(request: SkillDecisionRequest): AsyncIterable<SkillDecisionChunk>;
}

export const resumableSkillDecisionSchema = z.object({ schemaVersion: z.literal(3),
  kind: z.literal('calendar-model-decision'), protocolVersion: z.literal(SKILL_PROTOCOL_VERSION),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema, decisionId: idSchema,
  dispatchId: idSchema, configRevision: z.number().int().nonnegative(), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), schemaRevision: z.literal('google-calendar.v2'),
  rejectedDecisionId: idSchema.nullable(), decision: skillDecisionSchema.nullable(),
  sources: z.array(sourceReferenceV2Schema).max(6), operationId: idSchema.nullable(),
  intentId: idSchema.nullable(), proposalId: idSchema.nullable(), createdAt: isoDateSchema,
}).strict().refine(v => v.sources.every(s => s.permission.minimalEvidenceAllowed
    && s.connectionId === v.connectionId && s.connectionRevision === v.connectionRevision)
  && (v.decision === null || (v.decision.decisionId === v.decisionId
    && v.sources.every(s => s.permission.content === 'retained'
      && Date.parse(s.expiresAt) > Date.parse(v.createdAt)))));
export type ResumableSkillDecision = z.infer<typeof resumableSkillDecisionSchema>;
export interface SkillDecisionStore {
  put(record: ResumableSkillDecision): Promise<void>;
  get(userId: string, decisionId: string):
    Promise<ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision | null>;
  putRejected(record: CalendarRejectedDecisionV2): Promise<void>;
}
