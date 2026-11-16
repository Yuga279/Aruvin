/**
 * ============================================================================
 * FILE: voice-accounting.ts
 * LOCATION: backend/src/contracts/voice-accounting.ts
 * ============================================================================
 * PURPOSE:
 *    Define bounded, payload-free direct speech provider accounting.
 * ROLE IN PROJECT:
 *    Adds socket/response evidence to the existing metadata collection.
 *    Separates observed input, provider-reported usage, and estimated cost.
 * KEY COMPONENTS:
 *    - VoiceAccountingRecord: Pending admission and immutable terminal usage evidence.
 * ============================================================================
 */
import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { compatibleAmount, moneyEvidenceSchema, timingEvidenceSchema } from './usage-evidence.js';

const amount = z.number().finite().nonnegative();
const count = amount.int().max(Number.MAX_SAFE_INTEGER).nullable();
export const voiceAccountingRecordSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('voice-accounting'), provider: z.literal('deepgram'),
  userId: idSchema, sessionId: idSchema, voiceSessionId: idSchema,
  conversationId: idSchema.nullable(), usageId: idSchema, providerSocketId: idSchema,
  userTag: z.string().regex(/^aurvin-user-[a-f0-9]{64}$/), model: idSchema,
  turnId: idSchema.nullable(), responseId: idSchema.nullable(), speechId: idSchema.nullable(),
  providerRequestId: idSchema.nullable(), modelVersion: idSchema.nullable(),
  status: z.enum(['pending', 'closed', 'completed', 'interrupted', 'cancelled', 'failed']),
  observedAudioMs: count, audioMs: count, billableCharacters: count,
  estimatedCostUsd: amount.nullable(), actualCostUsd: z.null(),
  money: moneyEvidenceSchema.optional(), timing: timingEvidenceSchema.optional(),
  startedAt: isoDateSchema, endedAt: isoDateSchema.nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.money && (v.money.reportedAmount !== null || v.money.costStatus === 'known'
    || !compatibleAmount(v.estimatedCostUsd, v.money.estimatedAmount)))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Conflicting voice cost evidence.' });
  if (v.sessionId !== v.voiceSessionId || (v.turnId === null) !== (v.responseId === null)
    || (v.status === 'pending') !== (v.endedAt === null)
    || (v.endedAt !== null && v.endedAt < v.startedAt)
    || (v.responseId === null && v.usageId !== v.providerSocketId)
    || (v.responseId !== null && v.usageId === v.providerSocketId)
    || (v.estimatedCostUsd !== null && v.billableCharacters === null)
    || (v.status === 'pending' && [v.providerRequestId, v.modelVersion, v.speechId, v.observedAudioMs,
      v.audioMs, v.billableCharacters, v.estimatedCostUsd].some(value => value !== null)))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid voice accounting linkage or evidence' });
});
export type VoiceAccountingRecord = z.infer<typeof voiceAccountingRecordSchema>;
