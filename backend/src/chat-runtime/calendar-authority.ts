/**
 * ============================================================================
 * FILE: calendar-authority.ts
 * LOCATION: backend/src/chat-runtime/calendar-authority.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Manage lifecycle, publication, reply interpretation, and single-use consumption of Calendar proposals.
 *
 * ROLE IN PROJECT:
 *    Maintains cross-turn proposal authority for calendar selection, scheduling details, and conflict
 *    clarifications. Bridges natural user replies to verified proposal consumption and tombstone state.
 *
 * KEY COMPONENTS:
 *    - publishProposal: Publishes a bounded proposal via CAS with verified lifetimes.
 *    - consumeOrTombstoneProposal: Consumes valid replies or marks expired/cancelled tombstones.
 *    - resolveReplyTarget: Decides whether a reply provably answers the current proposal.
 * ============================================================================
 */

import type { CalendarAccountBinding, CalendarResolvedTarget } from '../contracts/calendar-discovery.js';
import {
  calendarProposalReplySchema,
  calendarProposalSchema,
  calendarProposalTombstoneSchema,
  type CalendarProposalConsumption,
  type CalendarProposalIncomplete,
  type CalendarProposalRecord,
  type CalendarProposalStore,
  type CalendarReplyReference,
} from '../contracts/calendar-authority.js';
import type { AttemptRecord } from '../contracts/attempt.js';
import type { CalendarLimits } from '../contracts/calendar-policy.js';
import type { CalendarCreateInput } from '../contracts/calendar-tools.js';
import type { CalendarAvailabilityResult } from '../contracts/calendar-availability.js';
import type { MessageRecord } from '../contracts/message.js';
import { calendarActionHash } from '../plugins/google-calendar/tools-validation.js';
import { key } from '../persistence/records.js';
import { AppError } from '../platform/errors/app-error.js';
import { readCalendarReply } from './calendar-intent.js';
import { canonicalCalendarAction } from './calendar-operation.js';

export type PublishProposalInput = {
  account: CalendarAccountBinding;
  intent: {
    intentId: string;
    originatingTurnId: string;
    originatingAcceptedMessageId: string;
    originatingAttemptId: string;
    action: CalendarCreateInput;
    selector: string | null;
  };
  purpose: 'selection' | 'details' | 'conflict';
  target: CalendarResolvedTarget | null;
  action: CalendarCreateInput | null;
  /**
   * The explicit incomplete-details declaration. A proposal that carries it has
   * no complete canonical action and cannot be consumed.
   */
  incomplete?: CalendarProposalIncomplete;
  candidates: CalendarResolvedTarget[];
  conditionFingerprint: string | null;
  disclosedLimitations?: CalendarAvailabilityResult['limitations'];
  discoveryRevision: number;
  availabilityRevision: number | null;
  retentionPolicyId: string;
  contentExpiresAt: string;
  limits: CalendarLimits;
  clock: () => number;
  proposals: CalendarProposalStore;
  sessionId: string;
};

/** The identity of one incomplete declaration, for the identical-proposal check. */
function incompleteKey(value: CalendarProposalIncomplete | undefined): string {
  return value ? `${value.missing.join(',')}|${value.messageRefs.join(',')}` : '';
}

export async function publishProposal(input: PublishProposalInput): Promise<CalendarProposalRecord> {
  const nowMs = input.clock();
  const createdAt = new Date(nowMs).toISOString();
  const previous = await input.proposals.getCurrent(input.account.userId, input.sessionId);

  const previousExpiryAt = previous?.intentId === input.intent.intentId
    ? Date.parse(previous.expiresAt)
    : Number.POSITIVE_INFINITY;

  const contentExpiryMs = Date.parse(input.contentExpiresAt);
  const expiry = Math.min(
    nowMs + Math.min(input.limits.proposalLifetimeMs, 600000),
    contentExpiryMs,
    previousExpiryAt,
  );

  if (expiry <= nowMs) {
    throw new AppError('NOT_READY', 'Calendar confirmation cannot be retained safely.', false);
  }
  const expiresAt = new Date(expiry).toISOString();

  const canonicalActionHash = input.action ? calendarActionHash(input.action) : null;

  // Check if identical pending proposal exists
  if (
    previous
    && previous.state === 'pending'
    && previous.intentId === input.intent.intentId
    && previous.purpose === input.purpose
    && previous.conditionFingerprint === input.conditionFingerprint
    && previous.canonicalActionHash === canonicalActionHash
    && previous.candidates.length === input.candidates.length
    && incompleteKey(previous.incomplete) === incompleteKey(input.incomplete)
  ) {
    return previous;
  }

  const proposalId = key(
    'calendar-proposal',
    input.intent.intentId,
    input.purpose,
    canonicalActionHash ?? '',
    input.conditionFingerprint ?? '',
    incompleteKey(input.incomplete),
    input.candidates.map(c => c.calendarId).join('\0'),
  );
  const mappedCandidates = input.purpose === 'selection'
    ? input.candidates.map(c => ({
        target: c,
        canonicalActionHash: calendarActionHash(canonicalCalendarAction(input.intent.action, c)),
      }))
    : [];

  const raw = {
    schemaVersion: 2 as const,
    kind: 'calendar-proposal' as const,
    userId: input.account.userId,
    connectionId: input.account.connectionId,
    connectionRevision: input.account.connectionRevision,
    googleSubjectId: input.account.googleSubjectId,
    sessionId: input.sessionId,
    proposalId,
    revision: 1,
    originatingTurnId: input.intent.originatingTurnId,
    originatingAcceptedMessageId: input.intent.originatingAcceptedMessageId,
    originatingAttemptId: input.intent.originatingAttemptId,
    intentId: input.intent.intentId,
    target: input.target,
    action: input.action,
    canonicalActionHash: input.purpose === 'selection' ? null : canonicalActionHash,
    discoveryRevision: input.discoveryRevision,
    availabilityRevision: input.availabilityRevision,
    conditionFingerprint: input.conditionFingerprint,
    disclosedLimitations: input.disclosedLimitations ?? [],
    candidates: mappedCandidates,
    purpose: input.purpose,
    retentionPolicyId: input.retentionPolicyId,
    contentExpiresAt: input.contentExpiresAt,
    createdAt,
    expiresAt,
    state: 'pending' as const,
    consumedBy: null,
    ...(input.incomplete ? { incomplete: input.incomplete } : {}),
  };

  const proposal = calendarProposalSchema.parse(raw);
  const saved = await input.proposals.putCurrent({
    expectedProposalId: previous?.proposalId ?? null,
    expectedRevision: previous?.revision ?? null,
    proposal,
  });

  if (saved.outcome !== 'confirmed') {
    throw new AppError('PERSISTENCE_ERROR', 'Failed to persist calendar proposal.', false);
  }
  return saved.proposal;
}

export type ConsumeProposalInput = {
  account: CalendarAccountBinding;
  proposal: CalendarProposalRecord;
  replyMessage: MessageRecord;
  replyTurnId: string;
  operationId: string;
  clock: () => number;
  proposals: CalendarProposalStore;
};

export type ConsumeProposalResult =
  | { outcome: 'authorized'; consumption: CalendarProposalConsumption; choiceTarget: CalendarResolvedTarget | null }
  | { outcome: 'cancelled' }
  | { outcome: 'expired' }
  | { outcome: 'unrelated' }
  | { outcome: 'clarify'; reason: 'ambiguous' | 'edit' | 'incomplete' };

export type ReplyTargetDecision =
  | { outcome: 'current' }
  | { outcome: 'not-current'; reason: 'stale-reference' | 'unproven' };

/**
 * Decides whether a reply provably answers the current pending proposal.
 *
 * A client reference is UNTRUSTED: it names the proposal revision the client
 * believed it was answering and never approves anything by itself. It is
 * accepted only when it names the current proposal and its current revision.
 *
 * A reply without a reference is accepted only when the server can prove a
 * unique unchanged immediately preceding disclosure. The proof is durable: the
 * server binds the disclosure it made to the attempt that made it, so the
 * ledger of disclosed proposals is the set of reply-reference bindings of the
 * session's attempts. The current proposal is unique when it is the only
 * disclosure whose authority is still live: a superseded or unknown earlier
 * disclosure is still a candidate for a bare reply.
 *
 * ponytail: one bounded pass over the session's attempts. The ceiling is one
 * point read per attempt; upgrade with a per-session disclosure index if
 * profiling requires it.
 */
export async function resolveReplyTarget(input: {
  proposals: CalendarProposalStore;
  userId: string;
  sessionId: string;
  proposal: CalendarProposalRecord;
  replyTo: CalendarReplyReference | null;
  attempts: readonly AttemptRecord[];
}): Promise<ReplyTargetDecision> {
  const { proposal } = input;
  if (input.replyTo) {
    return input.replyTo.proposalId === proposal.proposalId && input.replyTo.revision === proposal.revision
      ? { outcome: 'current' }
      : { outcome: 'not-current', reason: 'stale-reference' };
  }

  // A follow-up warning retains the original intent's attempt ID, but its
  // disclosure is bound to the later attempt that actually showed the warning.
  let disclosed = false;
  for (const attempt of input.attempts) {
    const bound = await input.proposals.getReplyReference(input.userId, input.sessionId, attempt.attemptId);
    if (!bound) continue;
    if (bound.proposalId === proposal.proposalId) {
      if (bound.revision === proposal.revision) disclosed = true;
      continue;
    }
    const authority = await input.proposals.getAuthority(input.userId, input.sessionId, bound.proposalId);
    if (authority.state !== 'consumed' && authority.state !== 'tombstone') {
      return { outcome: 'not-current', reason: 'unproven' };
    }
  }
  return disclosed ? { outcome: 'current' } : { outcome: 'not-current', reason: 'unproven' };
}

export async function consumeOrTombstoneProposal(
  input: ConsumeProposalInput,
): Promise<ConsumeProposalResult> {
  const nowMs = input.clock();
  const proposal = input.proposal;
  const interpreted = readCalendarReply(input.replyMessage.content, proposal);

  if (nowMs >= Date.parse(proposal.expiresAt) || nowMs >= Date.parse(proposal.contentExpiresAt)) {
    await input.proposals.tombstone({
      expectedRevision: proposal.revision,
      tombstone: calendarProposalTombstoneSchema.parse({
        schemaVersion: 2,
        kind: 'calendar-proposal-tombstone',
        userId: proposal.userId,
        sessionId: proposal.sessionId,
        proposalId: proposal.proposalId,
        intentId: proposal.intentId,
        revision: proposal.revision + 1,
        reason: 'expired',
        operationId: null,
        canonicalActionHash: null,
        at: new Date(nowMs).toISOString(),
        unresolvedOperation: false,
      }),
    });
    return { outcome: interpreted.decision === 'unrelated' ? 'unrelated' : 'expired' };
  }

  if (interpreted.decision === 'cancel') {
    await input.proposals.tombstone({
      expectedRevision: proposal.revision,
      tombstone: calendarProposalTombstoneSchema.parse({
        schemaVersion: 2,
        kind: 'calendar-proposal-tombstone',
        userId: proposal.userId,
        sessionId: proposal.sessionId,
        proposalId: proposal.proposalId,
        intentId: proposal.intentId,
        revision: proposal.revision + 1,
        reason: 'cancelled',
        operationId: null,
        canonicalActionHash: null,
        at: new Date(nowMs).toISOString(),
        unresolvedOperation: false,
      }),
    });
    return { outcome: 'cancelled' };
  }

  if (interpreted.decision === 'ambiguous' || interpreted.decision === 'edit') {
    return { outcome: 'clarify', reason: interpreted.decision };
  }
  if (interpreted.decision === 'unrelated') {
    // The message is not an answer to this proposal. It never consumes the
    // proposal and never becomes authority for an effect.
    return { outcome: 'unrelated' };
  }
  if (proposal.incomplete !== undefined) {
    // An explicitly incomplete proposal carries no canonical action yet. It stays
    // pending until a complete proposal supersedes it; no reply may consume it.
    return { outcome: 'clarify', reason: 'incomplete' };
  }

  let choiceTarget: CalendarResolvedTarget | null = null;
  let actionHash = proposal.canonicalActionHash;
  if (proposal.purpose === 'selection') {
    const selectedCand = proposal.candidates.find(c => c.target.calendarId === interpreted.choiceCalendarId);
    if (!selectedCand) {
      return { outcome: 'clarify', reason: 'ambiguous' };
    }
    choiceTarget = selectedCand.target;
    actionHash = selectedCand.canonicalActionHash;
  }

  const reply = calendarProposalReplySchema.parse({
    userId: input.account.userId,
    connectionId: input.account.connectionId,
    connectionRevision: input.account.connectionRevision,
    googleSubjectId: input.account.googleSubjectId,
    sessionId: proposal.sessionId,
    proposalId: proposal.proposalId,
    expectedProposalRevision: proposal.revision,
    acceptedMessageId: input.replyMessage.messageId,
    acceptedTurnId: input.replyTurnId,
    canonicalActionHash: actionHash,
    conditionFingerprint: proposal.conditionFingerprint,
    choiceCalendarId: interpreted.choiceCalendarId,
    receivedAt: input.replyMessage.createdAt,
    decision: proposal.purpose === 'selection' ? 'select' : 'accept',
  });

  const consumeResult = await input.proposals.consume({
    reply,
    operationId: input.operationId,
    intentId: proposal.intentId,
  });

  if (consumeResult.outcome === 'consumed' || consumeResult.outcome === 'existing') {
    return { outcome: 'authorized', consumption: consumeResult.consumption, choiceTarget };
  }
  if (consumeResult.outcome === 'rejected' && consumeResult.reason === 'expired') {
    return { outcome: 'expired' };
  }
  if (consumeResult.outcome === 'rejected' && consumeResult.reason === 'incomplete') {
    // The proposal is explicitly incomplete. It stays pending and the runtime
    // asks for the missing details instead of consuming it.
    return { outcome: 'clarify', reason: 'incomplete' };
  }
  return { outcome: 'clarify', reason: 'ambiguous' };
}
