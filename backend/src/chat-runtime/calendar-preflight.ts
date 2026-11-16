/**
 * ============================================================================
 * FILE: calendar-preflight.ts
 * LOCATION: backend/src/chat-runtime/calendar-preflight.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Run the server-owned availability preflight for a Calendar create and decide
 *    whether the turn may write, must ask again, or must stop.
 *
 * ROLE IN PROJECT:
 *    Aurvin never writes an event on an unverified free/busy condition. The preflight
 *    issues an internal `calendar_check_availability` call over every discovered
 *    calendar and compares the resulting condition with one the user already
 *    accepted. Every actual REST delivery, including discovery and rechecks, is
 *    charged before dispatch.
 *
 * KEY COMPONENTS:
 *    - runCalendarPreflight: Internal availability check over the canonical range.
 *    - requiresAcceptance: Material condition that needs explicit user acceptance.
 *    - sameApprovedCondition: Comparison against an already accepted condition.
 *    - describeAvailabilityCondition: Constant-semantics disclosure for the question.
 * ============================================================================
 */

import {
  calendarAvailabilityResultSchema,
  type CalendarAvailabilityResult,
} from '../contracts/calendar-availability.js';
import type { CalendarProposalRecord } from '../contracts/calendar-authority.js';
import type { CalendarAccountBinding, CalendarResolvedTarget } from '../contracts/calendar-discovery.js';
import type {
  CalendarExecutionBindingV2,
  CalendarExecutionPortV2,
  CalendarRequestKindV2,
} from '../contracts/calendar-operations.js';
import { key } from '../persistence/records.js';
import { AppError } from '../platform/errors/app-error.js';
import { PROVIDER_REQUEST_KINDS } from './calendar-operation.js';

export type CalendarPreflightStage = 'direct-create' | 'proposal-reply';

export type CalendarPreflightInput = {
  execution: CalendarExecutionPortV2;
  ledger: {
    chargeCalendarRequest(kind: CalendarRequestKindV2): Promise<void>;
    chargeRefreshRequest(): Promise<void>;
  };
  account: CalendarAccountBinding;
  sessionId: string;
  turnId: string;
  attemptId: string;
  decisionId: string;
  intentId: string;
  stage: CalendarPreflightStage;
  action: { start: string; end: string; timeZone: string };
  trustedNow: string;
  trustedTimeZone: string;
  deadlineAt: string;
  signal: AbortSignal;
};

/**
 * One internal availability check over every discovered calendar for the exact
 * canonical event range. It is a real server check, not a model-requested tool:
 * no logical tool, model dispatch, repair or create is charged for it.
 */
export async function runCalendarPreflight(
  input: CalendarPreflightInput,
): Promise<CalendarAvailabilityResult> {
  const binding: CalendarExecutionBindingV2 = {
    ...input.account,
    target: null,
    operation: null,
    sessionId: input.sessionId,
    turnId: input.turnId,
    attemptId: input.attemptId,
    decisionId: input.decisionId,
    toolCallId: key('calendar-preflight', input.intentId, input.turnId, input.stage),
    schemaRevision: 'google-calendar.v2',
    trustedNow: input.trustedNow,
    trustedTimeZone: input.trustedTimeZone,
    deadlineAt: input.deadlineAt,
  };

  const checked = await input.execution.invoke({
    binding,
    call: {
      name: 'calendar_check_availability',
      arguments: {
        timeMin: input.action.start,
        timeMax: input.action.end,
        timeZone: input.action.timeZone,
      },
    },
    signal: input.signal,
    // The HTTP adapter calls this once per actual REST delivery. Availability
    // requests in a server-owned scan share the preflight budget category.
    consumeRequest: kind => {
      if (!PROVIDER_REQUEST_KINDS.has(kind)) return Promise.resolve();
      return input.ledger.chargeCalendarRequest(kind === 'availability' ? 'preflight' : kind);
    },
    consumeRefreshRequest: () => input.ledger.chargeRefreshRequest(),
  });

  if (checked.outcome !== 'success' || checked.result.tool !== 'calendar_check_availability') {
    throw new AppError('NOT_READY', 'Calendar availability could not be verified.', false);
  }
  return calendarAvailabilityResultSchema.parse(checked.result);
}

/**
 * A material condition needs explicit acceptance. Intrinsic Google semantics do
 * not count: only a conflict, incomplete coverage, truncation or a real
 * limitation does.
 */
export function requiresAcceptance(result: CalendarAvailabilityResult): boolean {
  return result.conflict !== 'clear'
    || result.coverage !== 'complete'
    || result.truncated
    || result.limitations.length > 0;
}

/**
 * Compare a fresh condition with the one an earlier proposal already disclosed.
 * Discovery or availability revision, check time, ordering and label refresh do
 * not change the condition; busy intervals, errors, limits, the calendar set,
 * the target and the action do.
 */
export function sameApprovedCondition(input: {
  proposal: Pick<CalendarProposalRecord,
    'canonicalActionHash' | 'target' | 'connectionId' | 'connectionRevision'
    | 'googleSubjectId' | 'conditionFingerprint'> | null;
  actionHash: string;
  target: CalendarResolvedTarget;
  fingerprint: string;
}): boolean {
  const proposal = input.proposal;
  if (!proposal || proposal.conditionFingerprint === null) return false;
  return proposal.canonicalActionHash === input.actionHash
    && proposal.target?.calendarId === input.target.calendarId
    && proposal.connectionId === input.target.connectionId
    && proposal.connectionRevision === input.target.connectionRevision
    && proposal.googleSubjectId === input.target.googleSubjectId
    && proposal.conditionFingerprint === input.fingerprint;
}

/**
 * The question shown to the user always states the constant semantics of the
 * scan: Google reports opaque busy time only.
 */
export function describeAvailabilityCondition(result: CalendarAvailabilityResult): string {
  const condition = result.conflict === 'conflict'
    ? 'a busy period that overlaps your event'
    : 'an incomplete picture of when you are free';
  const limitations = result.limitations.length > 0
    ? ` (${result.limitations.join(', ')})`
    : '';
  return `I checked the calendars for that time and found ${condition}${limitations}. `
    + 'Google Calendar only reports opaque busy time, so transparent events (including all-day '
    + 'entries), declined or cancelled events, and working hours are not covered. '
    + 'Should I create the event anyway?';
}
