/**
 * ============================================================================
 * FILE: calendar-authority.ts
 * LOCATION: backend/src/contracts/calendar-authority.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define Google Calendar Phase 2 proposals, selections, consumption, and capability gates.
 *
 * ROLE IN PROJECT:
 *    Manages cross-turn scheduling proposal lifecycles, single-consumption semantics,
 *    trusted reply matching, proposal tombstones, and capability resolution gates.
 *
 * KEY COMPONENTS:
 *    - calendarProposalConsumptionSchema / CalendarProposalConsumption
 *    - calendarProposalSchema / CalendarProposalRecord
 *    - calendarProposalReplySchema / CalendarProposalReply / proposalMatchesReply
 *    - calendarProposalTombstoneSchema / CalendarProposalTombstone
 *    - calendarReplyReferenceSchema / calendarProposalIncompleteSchema
 *    - CalendarProposalAuthorityLookup / CalendarProposalStore / CalendarCapabilityGate
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { sha256Schema } from './calendar-connections.js';
import { calendarInputSchemas } from './calendar-tools.js';
import { calendarAccountBindingSchema, calendarCanonicalIdSchema, calendarResolvedTargetSchema,
  type CalendarAccountBinding, type CalendarResolvedTarget } from './calendar-discovery.js';
import { calendarAvailabilityLimitationSchema } from './calendar-availability.js';

/**
 * Bounded causal reference from one user reply to the proposal revision it answers.
 *
 * UNTRUSTED: the client may name any proposal/revision it has seen. The reference
 * never carries approval and never permits a Calendar action by itself; the runtime
 * must resolve it against the current pending proposal before relying on it.
 */
export const calendarReplyReferenceSchema = z.object({ proposalId: idSchema,
  revision: z.number().int().positive(),
}).strict();
export type CalendarReplyReference = z.infer<typeof calendarReplyReferenceSchema>;

export const calendarProposalConsumptionSchema = z.object({ userId: idSchema, sessionId: idSchema,
  proposalId: idSchema, intentId: idSchema, operationId: idSchema, acceptedMessageId: idSchema,
  acceptedTurnId: idSchema, canonicalActionHash: sha256Schema, calendarId: calendarCanonicalIdSchema,
  consumedAt: isoDateSchema }).strict();
export type CalendarProposalConsumption = z.infer<typeof calendarProposalConsumptionSchema>;

/** Material proposal fields that may still be missing. Closed and bounded. */
export const CALENDAR_PROPOSAL_MISSING_FIELDS = ['start', 'end', 'title', 'target', 'duration', 'timeZone'] as const;
export const calendarProposalMissingFieldSchema = z.enum(CALENDAR_PROPOSAL_MISSING_FIELDS);
export type CalendarProposalMissingField = z.infer<typeof calendarProposalMissingFieldSchema>;

/**
 * Explicit incomplete-details declaration of one proposal.
 *
 * Present only when the proposal cannot state a complete canonical action or target
 * yet. `missing` lists the still-missing material fields; `messageRefs` lists at most
 * eight accepted message ids the runtime may use to complete the details
 * deterministically. Only identifiers are stored, never model prose.
 */
export const calendarProposalIncompleteSchema = z.object({
  missing: z.array(calendarProposalMissingFieldSchema).min(1).max(CALENDAR_PROPOSAL_MISSING_FIELDS.length),
  messageRefs: z.array(idSchema).max(8).refine(ids => new Set(ids).size === ids.length,
    { message: 'expected distinct message references' }),
}).strict();
export type CalendarProposalIncomplete = z.infer<typeof calendarProposalIncompleteSchema>;

export const calendarProposalSchema = calendarAccountBindingSchema.extend({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-proposal'), sessionId: idSchema, proposalId: idSchema,
  revision: z.number().int().positive(), originatingTurnId: idSchema,
  originatingAcceptedMessageId: idSchema, originatingAttemptId: idSchema, intentId: idSchema,
  target: calendarResolvedTargetSchema.nullable(),
  action: calendarInputSchemas.calendar_create_event.nullable(), canonicalActionHash: sha256Schema.nullable(),
  discoveryRevision: z.number().int().positive(), availabilityRevision: z.number().int().positive().nullable(),
  conditionFingerprint: sha256Schema.nullable(), disclosedLimitations: z.array(calendarAvailabilityLimitationSchema).max(8),
  candidates: z.array(z.object({ target: calendarResolvedTargetSchema,
    canonicalActionHash: sha256Schema }).strict()).max(20), purpose: z.enum(['selection', 'details', 'conflict']),
  retentionPolicyId: idSchema, contentExpiresAt: isoDateSchema,
  createdAt: isoDateSchema, expiresAt: isoDateSchema,
  state: z.enum(['pending', 'consumed', 'cancelled', 'superseded', 'expired']),
  consumedBy: calendarProposalConsumptionSchema.nullable(),
  incomplete: calendarProposalIncompleteSchema.optional(),
}).strict().refine(v => {
  const ttl = Date.parse(v.expiresAt) - Date.parse(v.createdAt), c = v.consumedBy;
  const incomplete = v.incomplete;
  const bound = (t: CalendarResolvedTarget) => t.userId === v.userId && t.connectionId === v.connectionId
    && t.connectionRevision === v.connectionRevision && t.googleSubjectId === v.googleSubjectId
    && t.discoveryRevision === v.discoveryRevision;
  return ttl > 0 && ttl <= 600000 && Buffer.byteLength(JSON.stringify(v), 'utf8') <= 16384
    && Date.parse(v.expiresAt) <= Date.parse(v.contentExpiresAt)
    && (v.target === null || bound(v.target)) && v.candidates.every(c => bound(c.target))
    && new Set(v.candidates.map(c => c.target.calendarId)).size === v.candidates.length
    && (v.purpose !== 'selection' || (v.target === null && v.canonicalActionHash === null
      && v.action?.calendarId === undefined
      && (v.candidates.length > 0 || incomplete !== undefined)))
    && (v.purpose === 'selection' || v.canonicalActionHash !== null || incomplete !== undefined)
    // An explicitly incomplete proposal has no complete canonical event to hash.
    && (incomplete === undefined || (v.canonicalActionHash === null && v.action === null))
    && (incomplete === undefined || !incomplete.missing.includes('target') || v.target === null)
    && (v.purpose !== 'selection' || incomplete === undefined || incomplete.missing.includes('target'))
    && (v.purpose !== 'conflict' || (v.target !== null && v.action !== null
      && v.conditionFingerprint !== null && v.availabilityRevision !== null))
    && (v.action?.calendarId === undefined || v.target === null || v.action.calendarId === v.target.calendarId)
    && ((v.state === 'consumed') === (c !== null))
    && (c === null || (incomplete === undefined
      && c.userId === v.userId && c.sessionId === v.sessionId && c.proposalId === v.proposalId
      && c.intentId === v.intentId
      && (v.purpose === 'selection' ? v.candidates.some(option => option.target.calendarId === c.calendarId
        && option.canonicalActionHash === c.canonicalActionHash)
        : c.canonicalActionHash === v.canonicalActionHash && v.target?.calendarId === c.calendarId)
      && Date.parse(c.consumedAt) >= Date.parse(v.createdAt) && Date.parse(c.consumedAt) < Date.parse(v.expiresAt)));
});
export type CalendarProposalRecord = z.infer<typeof calendarProposalSchema>;

export const calendarProposalReplySchema = calendarAccountBindingSchema.extend({ sessionId: idSchema,
  proposalId: idSchema, expectedProposalRevision: z.number().int().positive(),
  acceptedMessageId: idSchema, acceptedTurnId: idSchema, canonicalActionHash: sha256Schema,
  conditionFingerprint: sha256Schema.nullable(), choiceCalendarId: calendarCanonicalIdSchema.nullable(),
  receivedAt: isoDateSchema, decision: z.enum(['accept', 'cancel', 'select']) }).strict();
export type CalendarProposalReply = z.infer<typeof calendarProposalReplySchema>;

export function proposalMatchesReply(p: CalendarProposalRecord, r: CalendarProposalReply): boolean {
  // An incomplete-details proposal has no canonical action and can never be consumed.
  return p.incomplete === undefined && p.state === 'pending' && p.userId === r.userId && p.sessionId === r.sessionId
    && p.proposalId === r.proposalId && p.revision === r.expectedProposalRevision
    && p.connectionId === r.connectionId && p.connectionRevision === r.connectionRevision
    && p.googleSubjectId === r.googleSubjectId
    && (p.purpose === 'selection' ? r.decision === 'cancel' || p.candidates.some(c => c.target.calendarId === r.choiceCalendarId
      && c.canonicalActionHash === r.canonicalActionHash) : p.canonicalActionHash === r.canonicalActionHash)
    && p.conditionFingerprint === r.conditionFingerprint
    && Date.parse(r.receivedAt) >= Date.parse(p.createdAt) && Date.parse(r.receivedAt) < Date.parse(p.expiresAt)
    && (r.decision !== 'select' || (p.purpose === 'selection'
      && p.candidates.some(c => c.target.calendarId === r.choiceCalendarId)))
    && (p.purpose !== 'selection' || r.decision === 'select' || r.decision === 'cancel')
    && (r.decision !== 'accept' || p.purpose !== 'selection')
    && (r.decision !== 'select' || r.choiceCalendarId !== null);
}

export const calendarProposalTombstoneSchema = z.object({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-proposal-tombstone'), userId: idSchema, sessionId: idSchema,
  proposalId: idSchema, intentId: idSchema, revision: z.number().int().positive(),
  reason: z.enum(['expired', 'cancelled', 'superseded', 'consumed', 'disconnected', 'redacted']),
  operationId: idSchema.nullable(), canonicalActionHash: sha256Schema.nullable(), at: isoDateSchema,
  unresolvedOperation: z.boolean(),
}).strict().refine(v => (!v.unresolvedOperation || v.operationId !== null)
  && (v.reason !== 'consumed' || (v.operationId !== null && v.canonicalActionHash !== null)));
export type CalendarProposalTombstone = z.infer<typeof calendarProposalTombstoneSchema>;

export type CalendarProposalConsumeResult =
  | { outcome: 'consumed' | 'existing'; consumption: CalendarProposalConsumption }
  | { outcome: 'rejected'; reason: 'expired' | 'stale' | 'wrong-session' | 'changed-action' | 'changed-condition' | 'cancelled' | 'incomplete' }
  | { outcome: 'uncertain' };

/**
 * Scoped authority state of one proposal id inside one user/session scope.
 *
 * - 'pending'   The stored proposal is still pending (expiry is not applied here).
 * - 'consumed'  A single consumption is durable; `proposal` is null when only the
 *               persisted consumption wrapper survived.
 * - 'tombstone' The proposal slot holds a tombstone instead of a proposal.
 * - 'absent'    No recoverable authority for that id in this scope (no record, or
 *               a terminal non-consumed record such as cancelled/superseded/expired).
 */
export type CalendarProposalAuthorityLookup =
  | { state: 'pending'; proposal: CalendarProposalRecord }
  | { state: 'consumed'; proposal: CalendarProposalRecord | null;
      reply: CalendarProposalReply; consumption: CalendarProposalConsumption;
      authorityExpiresAt: string }
  | { state: 'tombstone'; tombstone: CalendarProposalTombstone }
  | { state: 'absent' };

export interface CalendarProposalStore {
  getCurrent(userId: string, sessionId: string): Promise<CalendarProposalRecord | null>;
  /** Pending slot of the session including expired proposals, for expiry cleanup. */
  getCurrentSlot(userId: string, sessionId: string): Promise<CalendarProposalRecord | null>;
  /** Scoped authority lookup of one proposal id, for crash recovery. */
  getAuthority(userId: string, sessionId: string, proposalId: string): Promise<CalendarProposalAuthorityLookup>;
  putCurrent(input: { expectedProposalId: string | null; expectedRevision: number | null;
    proposal: CalendarProposalRecord }): Promise<{ outcome: 'confirmed'; proposal: CalendarProposalRecord }
      | { outcome: 'conflict' | 'uncertain' }>;
  consume(input: { reply: CalendarProposalReply; operationId: string; intentId: string }): Promise<CalendarProposalConsumeResult>;
  tombstone(input: { expectedRevision: number; tombstone: CalendarProposalTombstone }): Promise<'confirmed' | 'conflict' | 'uncertain'>;
  /**
   * Durably bind the causal reply reference that was accepted with one turn attempt.
   *
   * The reference is untrusted: it names the proposal revision the client believed it
   * was answering. It never approves anything and never authorises a Calendar action.
   */
  bindReplyReference(input: { userId: string; sessionId: string; turnId: string; attemptId: string;
    replyTo: CalendarReplyReference; boundAt?: string }): Promise<'confirmed' | 'conflict' | 'uncertain'>;
  /** Read the reply reference that was durably bound to one accepted attempt. */
  getReplyReference(userId: string, sessionId: string, attemptId: string): Promise<CalendarReplyReference | null>;
}

export interface CalendarCapabilityGate {
  resolve(input: { account: CalendarAccountBinding; selector: string | null;
    operation: 'read' | 'create' | 'availability'; signal: AbortSignal; deadlineAt: string;
    consumeRequest: (kind: 'discovery' | 'capability-recheck') => Promise<void>;
    consumeRefreshRequest: () => Promise<void> }): Promise<
      { outcome: 'resolved'; target: CalendarResolvedTarget }
      | { outcome: 'clarify'; code: 'CALENDAR_TARGET_AMBIGUOUS' | 'CALENDAR_TARGET_UNKNOWN'
          | 'CALENDAR_DEFAULT_UNAVAILABLE' | 'CALENDAR_PRIMARY_MISSING'; candidates: CalendarResolvedTarget[] }
      | { outcome: 'denied'; code: 'CALENDAR_RECONNECT_REQUIRED' | 'CALENDAR_TARGET_READ_ONLY' | 'CALENDAR_EXECUTION_DENIED' }>;
  requireCurrent(input: { target: CalendarResolvedTarget; operation: 'read' | 'create' | 'availability';
    signal: AbortSignal; deadlineAt: string; consumeRequest: (kind: 'capability-recheck') => Promise<void>;
    consumeRefreshRequest: () => Promise<void> }): Promise<void>;
}
