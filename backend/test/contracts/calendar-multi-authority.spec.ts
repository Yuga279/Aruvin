/**
 * ============================================================================
 * FILE: calendar-multi-authority.spec.ts
 * LOCATION: backend/test/contracts/calendar-multi-authority.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Google Calendar Phase 2 cross-turn proposal, selection, and authority contracts.
 *
 * ROLE IN PROJECT:
 *    Ensures proposals bind single-consumption without model approval, validate
 *    selection candidates, and enforce expiration / tombstone invariants.
 *
 * KEY COMPONENTS:
 *    - calendarProposalSchema / calendarProposalConsumptionSchema
 *    - calendarProposalReplySchema / proposalMatchesReply
 *    - calendarProposalTombstoneSchema / CalendarProposalStore / CalendarCapabilityGate
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { calendarProposalSchema, calendarProposalConsumptionSchema, calendarProposalTombstoneSchema,
  calendarProposalReplySchema, proposalMatchesReply, type CalendarProposalStore,
} from '../../src/contracts/calendar-authority.js';
import { proposal, at, hash } from './calendar-multi-fixtures.js';

it('binds one expiring proposal consumption across turns without model approval', () => {
  const p = calendarProposalSchema.parse(proposal);
  expect(calendarProposalSchema.safeParse({ ...proposal, expiresAt: '2026-10-22T10:10:00.001Z' }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...proposal, state: 'consumed' }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...proposal, candidates: Array(21).fill({
    target: proposal.target, canonicalActionHash: hash }) }).success).toBe(false);
  const reply = calendarProposalReplySchema.parse({ userId: 'u', sessionId: 's', proposalId: 'p',
    expectedProposalRevision: 1, acceptedMessageId: 'followup-message', acceptedTurnId: 'followup-turn',
    connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub',
    canonicalActionHash: hash, conditionFingerprint: hash, choiceCalendarId: null,
    receivedAt: '2026-10-22T10:01:00.000Z', decision: 'accept' });
  expect(proposalMatchesReply(p, reply)).toBe(true);
  for (const patch of [{ sessionId: 'other' }, { connectionRevision: 2 },
    { canonicalActionHash: 'b'.repeat(64) }, { conditionFingerprint: 'b'.repeat(64) },
    { receivedAt: proposal.expiresAt }, { expectedProposalRevision: 2 }]) {
    expect(proposalMatchesReply(p, { ...reply, ...patch })).toBe(false);
  }
  const consumed = calendarProposalConsumptionSchema.parse({ userId: 'u', sessionId: 's', proposalId: 'p',
    intentId: 'intent', operationId: 'op', acceptedMessageId: reply.acceptedMessageId,
    acceptedTurnId: reply.acceptedTurnId, canonicalActionHash: hash,
    calendarId: proposal.target.calendarId, consumedAt: reply.receivedAt });
  expect(proposalMatchesReply({ ...p, state: 'consumed', consumedBy: consumed }, reply)).toBe(false);
  expect(calendarProposalTombstoneSchema.safeParse({ schemaVersion: 2, kind: 'calendar-proposal-tombstone',
    userId: 'u', sessionId: 's', proposalId: 'p', intentId: 'intent', revision: 2,
    reason: 'expired', operationId: null, canonicalActionHash: hash, at,
    unresolvedOperation: false }).success).toBe(true);
  expect(calendarProposalReplySchema.safeParse({ ...reply, confirmed: true }).success).toBe(false);
  const selection = calendarProposalSchema.parse({ ...proposal, purpose: 'selection', target: null,
    canonicalActionHash: null, action: { ...proposal.action, calendarId: undefined },
    candidates: [{ target: proposal.target, canonicalActionHash: hash }],
    conditionFingerprint: null, availabilityRevision: null, disclosedLimitations: [] });
  expect(proposalMatchesReply(selection, { ...reply, decision: 'select',
    choiceCalendarId: proposal.target.calendarId, conditionFingerprint: null })).toBe(true);
  const store: CalendarProposalStore = { getCurrent: async () => null,
    getCurrentSlot: async () => null,
    getAuthority: async () => ({ state: 'absent' }),
    putCurrent: async () => ({ outcome: 'uncertain' }),
    consume: async () => ({ outcome: 'uncertain' }), tombstone: async () => 'uncertain',
    bindReplyReference: async () => 'confirmed', getReplyReference: async () => null };
  expect(store.consume).toBeTypeOf('function');
});

it('admits an explicitly incomplete proposal and refuses its consumption', () => {
  const incomplete = { ...proposal, purpose: 'details' as const, action: null,
    canonicalActionHash: null, conditionFingerprint: null, availabilityRevision: null,
    incomplete: { missing: ['start', 'end'], messageRefs: ['m1', 'm2'] } };

  // Only an explicit incompleteness declaration admits a null canonical hash.
  expect(calendarProposalSchema.safeParse(incomplete).success).toBe(true);
  expect(calendarProposalSchema.safeParse({ ...incomplete, incomplete: undefined }).success).toBe(false);
  // An incomplete proposal carries neither a canonical action nor a made-up hash.
  expect(calendarProposalSchema.safeParse({ ...incomplete, canonicalActionHash: hash }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...incomplete, action: proposal.action }).success).toBe(false);

  // Consumption of an incomplete proposal is refused by the contract itself.
  expect(calendarProposalSchema.safeParse({ ...incomplete, state: 'consumed' as const,
    consumedBy: { userId: 'u', sessionId: 's', proposalId: 'p', intentId: 'intent',
      operationId: 'op', acceptedMessageId: 'followup-message', acceptedTurnId: 'followup-turn',
      canonicalActionHash: hash, calendarId: proposal.target.calendarId,
      consumedAt: '2026-10-22T10:01:00.000Z' } }).success).toBe(false);

  const reply = calendarProposalReplySchema.parse({ userId: 'u', sessionId: 's', proposalId: 'p',
    expectedProposalRevision: 1, acceptedMessageId: 'followup-message', acceptedTurnId: 'followup-turn',
    connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub',
    canonicalActionHash: hash, conditionFingerprint: hash, choiceCalendarId: null,
    receivedAt: '2026-10-22T10:01:00.000Z', decision: 'accept' });
  expect(proposalMatchesReply(calendarProposalSchema.parse(incomplete), reply)).toBe(false);

  // A selection with an unknown or unavailable target and no candidates is admissible
  // only when it declares the missing target.
  const selection = { ...proposal, purpose: 'selection' as const, target: null, action: null,
    canonicalActionHash: null, candidates: [], conditionFingerprint: null, availabilityRevision: null,
    incomplete: { missing: ['target'], messageRefs: [] } };
  expect(calendarProposalSchema.safeParse(selection).success).toBe(true);
  expect(calendarProposalSchema.safeParse({ ...selection, incomplete: undefined }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...selection,
    incomplete: { missing: ['title'], messageRefs: [] } }).success).toBe(false);
});

it('bounds the incomplete-details declaration', () => {
  const incomplete = { ...proposal, purpose: 'details' as const, action: null,
    canonicalActionHash: null, conditionFingerprint: null, availabilityRevision: null,
    incomplete: { missing: ['start'], messageRefs: ['m1'] } };
  expect(calendarProposalSchema.safeParse(incomplete).success).toBe(true);
  expect(calendarProposalSchema.safeParse({ ...incomplete,
    incomplete: { missing: [], messageRefs: [] } }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...incomplete,
    incomplete: { missing: ['attendees'], messageRefs: [] } }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...incomplete,
    incomplete: { missing: ['timeZone'], messageRefs: [] } }).success).toBe(true);
  expect(calendarProposalSchema.safeParse({ ...incomplete,
    incomplete: { missing: ['start'], messageRefs: Array(9).fill('m') } }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...incomplete,
    incomplete: { missing: ['start'], messageRefs: ['m', 'm'] } }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...incomplete,
    incomplete: { missing: ['start'], messageRefs: ['m'], note: 'free text' } }).success).toBe(false);
  // The existing lifetime and document bounds still hold for the incomplete variant.
  expect(calendarProposalSchema.safeParse({ ...incomplete,
    expiresAt: '2026-10-22T10:10:00.001Z' }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...incomplete,
    incomplete: { missing: ['start'], messageRefs: ['m'.repeat(128)] } }).success).toBe(true);
});
