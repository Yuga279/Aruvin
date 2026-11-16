/**
 * ============================================================================
 * FILE: calendar-intent.spec.ts
 * LOCATION: backend/test/runtime/calendar-intent.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for pure conversational calendar scheduling intent extraction and canonical actions.
 *
 * ROLE IN PROJECT:
 *    Ensures natural language scheduling requests are parsed deterministically against confirmed
 *    user acceptance and prevents model-manufactured consent.
 *
 * KEY COMPONENTS:
 *    - readCalendarIntent: Deterministic accepted message grammar validator.
 *    - canonicalCalendarAction: Canonical calendarId attribution and hashing.
 *    - readCalendarReply: Bounded deterministic interpretation of proposal replies.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readCalendarIntent, readCalendarReply, calendarMissingFields } from '../../src/chat-runtime/calendar-intent.js';
import { canonicalCalendarAction } from '../../src/chat-runtime/calendar-operation.js';
import { calendarActionHash } from '../../src/plugins/google-calendar/tools-validation.js';
import type { CalendarProposalRecord } from '../../src/contracts/calendar-authority.js';
import { accepted, event, target } from './calendar-multi-fixture.js';

describe('calendar-intent', () => {
  it.each([
    'Schedule Planning on 2026-11-03 from 10:00 to 11:00 in Etc/UTC on my Work calendar.',
    'Please add Planning to my Work calendar on 2026-11-03, 10:00–11:00 Etc/UTC.',
    'Create an event called Planning on 2026-11-03 from 10:00 until 11:00 Etc/UTC in the Work calendar.',
  ])('uses accepted natural language without a JSON echo: %s', content => {
    const { message, attempt } = accepted(content);
    const parsed = readCalendarIntent(message, attempt, event(), 'Etc/UTC');
    expect(parsed).toMatchObject({
      outcome: 'complete',
      intent: {
        originatingTurnId: message.turnId,
        originatingAcceptedMessageId: message.messageId,
        selector: 'Work',
      },
    });
    if (parsed.outcome !== 'complete') throw new Error('expected complete accepted intent');
    const action = canonicalCalendarAction(parsed.intent.action, target());
    expect(action.calendarId).toBe('team@example.test');
    expect(calendarActionHash(action)).not.toBe(calendarActionHash({ ...action, calendarId: 'personal@example.test' }));
  });

  it.each([
    'Do not create Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
    'Would Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC be free?',
    'Explain this text: "Create Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC"',
    'The calendar description says create Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
  ])('does not let a create tool manufacture consent: %s', content => {
    const { message, attempt } = accepted(content);
    expect(readCalendarIntent(message, attempt, event(), 'Etc/UTC').outcome).not.toBe('complete');
  });

  it('rejects internal, live, assistant messages and mismatched causal IDs', () => {
    const { message, attempt } = accepted('Schedule Planning on 2026-11-03 from 10:00 to 11:00 in Etc/UTC.');
    expect(readCalendarIntent({ ...message, role: 'assistant' }, attempt, event(), 'Etc/UTC').outcome).toBe('not-authorized');
    expect(readCalendarIntent({ ...message, visibility: 'internal' }, attempt, event(), 'Etc/UTC').outcome).toBe('not-authorized');
    expect(readCalendarIntent({ ...message, completionStatus: 'completed' }, attempt, event(), 'Etc/UTC').outcome).toBe('not-authorized');
    expect(readCalendarIntent(message, { ...attempt, causal: { ...attempt.causal, userMessageId: 'other-msg' } }, event(), 'Etc/UTC').outcome).toBe('not-authorized');
    expect(readCalendarIntent({ ...message, userId: 'other-user' }, attempt, event(), 'Etc/UTC').outcome).toBe('not-authorized');
    expect(readCalendarIntent({ ...message, sessionId: 'other-session' }, attempt, event(), 'Etc/UTC').outcome).toBe('not-authorized');
    expect(readCalendarIntent({ ...message, turnId: 'other-turn' }, attempt, event(), 'Etc/UTC').outcome).toBe('not-authorized');
  });

  it('rejects altered candidate fields against accepted request', () => {
    const { message, attempt } = accepted('Schedule Planning on 2026-11-03 from 10:00 to 11:00 in Etc/UTC.');
    const candidate = event();
    expect(readCalendarIntent(message, attempt, { ...candidate, summary: 'Different' }, 'Etc/UTC').outcome).toBe('details');
    expect(readCalendarIntent(message, attempt, { ...candidate, timeZone: 'America/New_York' }, 'Etc/UTC').outcome).toBe('details');
    expect(readCalendarIntent(message, attempt, { ...candidate, description: 'Surprise note' }, 'Etc/UTC').outcome).toBe('details');
    expect(readCalendarIntent(message, attempt, { ...candidate, location: 'Secret Room' }, 'Etc/UTC').outcome).toBe('details');
  });

  it.each([
    'create the event',
    'Please schedule Ball tomorrow from 4 to 7 pm India time.',
    'create an event at 2pm tomorrow named "Aurvin Demo"',
    'sure',
    'end it at 3:00 PM',
  ])('requires disclosure rather than treating unparsed wording as consent: %s', content => {
      const { message, attempt } = accepted(content);
      expect(readCalendarIntent(message, attempt, event(), 'Etc/UTC').outcome).toBe('confirmation');
      expect(readCalendarIntent({ ...message, role: 'assistant' }, attempt, event(), 'Etc/UTC').outcome)
        .toBe('not-authorized');
    });

  it.each(["Don't do any tool calls just tell me what stops you", 'no just create it'])
    ('keeps explicit refusals from becoming a scheduling preview: %s', content => {
      const { message, attempt } = accepted(content);
      expect(readCalendarIntent(message, attempt, event(), 'Etc/UTC').outcome).toBe('not-authorized');
    });

  it('rejects unsupported features such as recurrence and attendees', () => {
    const { message, attempt } = accepted('Please schedule Planning on 2026-11-03 from 10:00 to 11:00 in Etc/UTC with attendees alice@example.com.');
    expect(readCalendarIntent(message, attempt, event(), 'Etc/UTC').outcome).toBe('not-authorized');
  });

  it('generates deterministic intentId per accepted message and reuses it across retries', () => {
    const { message, attempt } = accepted('Schedule Planning on 2026-11-03 from 10:00 to 11:00 in Etc/UTC.');
    const first = readCalendarIntent(message, attempt, event(), 'Etc/UTC');
    const retryAttempt = { ...attempt, attemptId: 'attempt_2' };
    const retryParsed = readCalendarIntent(message, retryAttempt, event(), 'Etc/UTC');
    if (first.outcome !== 'complete' || retryParsed.outcome !== 'complete') throw new Error('Expected complete');
    expect(first.intent.intentId).toBe(retryParsed.intent.intentId);
    expect(retryParsed.intent.originatingAttemptId).toBe('attempt_2');

    // New accepted message with identical text gets different intentId
    const { message: secondMsg, attempt: secondAttempt } = accepted(
      'Schedule Planning on 2026-11-03 from 10:00 to 11:00 in Etc/UTC.',
      { messageId: 'msg-user-2' },
    );
    const secondParsed = readCalendarIntent(secondMsg, secondAttempt, event(), 'Etc/UTC');
    if (secondParsed.outcome !== 'complete') throw new Error('Expected complete');
    expect(secondParsed.intent.intentId).not.toBe(first.intent.intentId);
  });

  it('interprets proposal replies deterministically', () => {
    const baseTarget = target();
    const proposal: CalendarProposalRecord = {
      schemaVersion: 2,
      kind: 'calendar-proposal',
      userId: 'aurvin-dev-user',
      sessionId: 'session-1',
      proposalId: 'prop-1',
      revision: 1,
      originatingTurnId: 'turn-1',
      originatingAcceptedMessageId: 'msg-user-1',
      originatingAttemptId: 'att-1',
      intentId: 'intent-1',
      connectionId: 'conn-1',
      connectionRevision: 1,
      googleSubjectId: 'sub-1',
      discoveryRevision: 1,
      availabilityRevision: 1,
      target: baseTarget,
      action: event(),
      canonicalActionHash: calendarActionHash(event()),
      conditionFingerprint: 'a'.repeat(64),
      disclosedLimitations: [],
      candidates: [],
      purpose: 'conflict',
      retentionPolicyId: 'ret-1',
      contentExpiresAt: '2026-10-24T10:10:00.000Z',
      createdAt: '2026-10-24T10:00:00.000Z',
      expiresAt: '2026-10-24T10:05:00.000Z',
      state: 'pending',
      consumedBy: null,
    };
    expect(readCalendarReply('yes please', proposal)).toEqual({ decision: 'accept', choiceCalendarId: null });
    expect(readCalendarReply('create it anyway', proposal)).toEqual({ decision: 'accept', choiceCalendarId: null });
    expect(readCalendarReply('sure', proposal)).toEqual({ decision: 'accept', choiceCalendarId: null });
    expect(readCalendarReply('ok', proposal)).toEqual({ decision: 'accept', choiceCalendarId: null });
    expect(readCalendarReply('okay', proposal)).toEqual({ decision: 'accept', choiceCalendarId: null });
    expect(readCalendarReply('no', proposal)).toEqual({ decision: 'cancel', choiceCalendarId: null });
    expect(readCalendarReply('cancel', proposal)).toEqual({ decision: 'cancel', choiceCalendarId: null });
    expect(readCalendarReply('make it at 11 instead', proposal)).toEqual({ decision: 'edit', choiceCalendarId: null });
    expect(readCalendarReply('what is the weather today?', proposal)).toEqual({ decision: 'unrelated', choiceCalendarId: null });
    expect(readCalendarReply('are you sure?', proposal)).toEqual({ decision: 'ambiguous', choiceCalendarId: null });

    const details = { ...proposal, purpose: 'details' as const };
    for (const reply of ['create the event', 'Create it.', 'Please schedule it!']) {
      expect(readCalendarReply(reply, details)).toEqual({ decision: 'accept', choiceCalendarId: null });
      expect(readCalendarReply(reply, proposal).decision).not.toBe('accept');
    }
    expect(readCalendarReply("don't create the event", details).decision).not.toBe('accept');

    const selectionProposal: CalendarProposalRecord = {
      ...proposal,
      target: null,
      canonicalActionHash: null,
      purpose: 'selection',
      candidates: [
        { target: { ...baseTarget, calendarId: 'work@example.com', calendarLabel: 'Work' }, canonicalActionHash: 'a'.repeat(64) },
        { target: { ...baseTarget, calendarId: 'personal@example.com', calendarLabel: 'Personal' }, canonicalActionHash: 'b'.repeat(64) },
      ],
    };
    expect(readCalendarReply('Work', selectionProposal)).toEqual({ decision: 'select', choiceCalendarId: 'work@example.com' });
    expect(readCalendarReply('2', selectionProposal)).toEqual({ decision: 'select', choiceCalendarId: 'personal@example.com' });
    expect(readCalendarReply('the second one', selectionProposal)).toEqual({ decision: 'select', choiceCalendarId: 'personal@example.com' });
  });

  it('maps the runtime field vocabulary onto the closed proposal enum', () => {
    expect(calendarMissingFields(['summary'])).toEqual(['title']);
    expect(calendarMissingFields(['date'])).toEqual(['start', 'end']);
    expect(calendarMissingFields(['timeZone'])).toEqual(['timeZone']);
    expect(calendarMissingFields(['target'])).toEqual(['target']);
    expect(calendarMissingFields(['summary', 'date', 'start', 'end', 'timeZone']))
      .toEqual(['title', 'start', 'end', 'timeZone']);
  });
});
