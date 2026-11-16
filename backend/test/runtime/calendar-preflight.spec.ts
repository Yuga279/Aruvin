/**
 * ============================================================================
 * FILE: calendar-preflight.spec.ts
 * LOCATION: backend/test/runtime/calendar-preflight.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove that a Calendar create is never written on an unverified free/busy
 *    condition and that an unchanged disclosed condition stays accepted.
 *
 * ROLE IN PROJECT:
 *    Covers the server-owned availability preflight: a direct model create is
 *    paused when coverage is incomplete, the condition is disclosed in a durable
 *    proposal, and the availability fingerprint ignores revision noise but not a
 *    changed coverage or limitation.
 *
 * KEY COMPONENTS:
 *    - Direct create on incomplete coverage: zero creates, conflict proposal.
 *    - Fingerprint stability: revisions and check time do not re-open acceptance.
 *    - Writer entry point: The final check runs inside `executeCreate`.
 *    - Request charging: Each actual REST delivery is charged once.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';
import { calendarInputSchemas, type CalendarCreateInput } from '../../src/contracts/calendar-tools.js';
import { calendarAvailabilityFingerprint, type CalendarAvailabilityResult } from '../../src/contracts/calendar-availability.js';
import type { CalendarRequestKindV2 } from '../../src/contracts/calendar-operations.js';
import { CalendarTurnLedger } from '../../src/chat-runtime/calendar-budget.js';
import { asCalendarAccountingPort, isCalendarV2 } from '../../src/chat-runtime/calendar-ports.js';
import { CalendarOperationWriter, canonicalCalendarAction } from '../../src/chat-runtime/calendar-operation.js';
import { runCalendarPreflight } from '../../src/chat-runtime/calendar-preflight.js';
import { calendarActionHash } from '../../src/plugins/google-calendar/tools-validation.js';
import { key } from '../../src/persistence/records.js';
import { fixturePricing } from '../model/calendar-fixtures.js';
import { calendarFixture, createWire, loadWire, textWire } from './calendar-runtime.fixture.js';
import { availability, busy, event, target } from './calendar-multi-fixture.js';

const ACTION: CalendarCreateInput = calendarInputSchemas.calendar_create_event.parse({
  summary: 'Planning', start: '2026-11-03T10:00:00+00:00',
  end: '2026-11-03T11:00:00+00:00', timeZone: 'Etc/UTC',
});
const APPROVED = `Create this Google Calendar event: ${JSON.stringify(ACTION)}`;

describe('calendar-preflight', () => {
  it('pauses direct model create on incomplete coverage even with no availability tool call', async () => {
    const h = calendarFixture();
    try {
      h.setAvailability({ calendarErrors: { 'read@example.test': 'notFound' }, busy: [] });
      const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
      h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'direct-create'));
      await h.execute(ids);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      expect(await h.currentProposal(ids.sessionId)).toMatchObject({
        purpose: 'conflict',
        disclosedLimitations: expect.arrayContaining(['calendar-error']),
      });
      expect(h.requestKinds).toContain('preflight');
      const budget = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(budget).toMatchObject({ logicalTools: 1, creates: 0 });
    } finally {
      await h.dispose();
    }
  });

  it('creates the event when the scan is clear and complete', async () => {
    const h = calendarFixture();
    try {
      h.clearAvailability();
      const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
      h.modelWires.push(loadWire('calendar_create_event'),
        createWire(event(), 'direct-create'), textWire('Created on your calendar.'));
      await h.execute(ids);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
      expect(await h.currentProposal(ids.sessionId)).toBeNull();
      expect(h.requestKinds).toContain('preflight');
    } finally {
      await h.dispose();
    }
  });

  it('pauses a direct create on a busy conflict and discloses the condition', async () => {
    const h = calendarFixture();
    try {
      h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
      const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
      h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'direct-create'));
      await h.execute(ids);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      const proposal = await h.currentProposal(ids.sessionId);
      expect(proposal).toMatchObject({ purpose: 'conflict' });
      expect(proposal?.conditionFingerprint).toBeTruthy();
      const budget = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(budget).toMatchObject({ logicalTools: 1, creates: 0 });
    } finally {
      await h.dispose();
    }
  });

  it('accepts an unchanged disclosed condition but re-asks for a new coverage limitation', () => {
    const first = availability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
    const reread = availability({ ...first, availabilityRevision: first.availabilityRevision + 1,
      discoveryRevision: first.discoveryRevision + 1, checkedAt: '2026-10-24T10:01:00.000Z',
      expiresAt: '2026-10-24T10:06:00.000Z' });
    expect(calendarAvailabilityFingerprint(reread)).toBe(calendarAvailabilityFingerprint(first));
    const changed = availability({ ...reread, coverage: 'incomplete', free: [],
      calendars: reread.calendars.map((entry, index) => index ? entry : { ...entry, status: 'error', reason: 'not-found' }),
      limitations: ['calendar-error'] });
    expect(calendarAvailabilityFingerprint(changed)).not.toBe(calendarAvailabilityFingerprint(first));
  });

  it('charges the actual availability REST delivery once as a preflight request', async () => {
    const h = calendarFixture();
    try {
      const charged: CalendarRequestKindV2[] = [];
      const cal = h.runtime.d.calendar!;
      if (!isCalendarV2(cal)) throw new Error('expected the v2 calendar runtime');
      const account = await cal.connection.currentAccount();
      const execution = cal.execution;
      // This focused fixture has an existing discovery snapshot. The assembled
      // regression exercises and counts real discovery REST deliveries.
      await runCalendarPreflight({
        execution,
        ledger: {
          chargeCalendarRequest: async kind => { charged.push(kind); },
          chargeRefreshRequest: async () => undefined,
        },
        account,
        sessionId: 'session-preflight',
        turnId: 'turn-preflight',
        attemptId: 'attempt-preflight',
        decisionId: 'decision-preflight',
        intentId: 'intent-preflight',
        stage: 'direct-create',
        action: { start: '2026-11-03T10:00:00+00:00', end: '2026-11-03T11:00:00+00:00', timeZone: 'Etc/UTC' },
        trustedNow: '2026-10-24T10:00:00.000Z',
        trustedTimeZone: 'Etc/UTC',
        deadlineAt: new Date(Date.now() + 60000).toISOString(),
        signal: new AbortController().signal,
      });
      expect(charged).toEqual(['preflight']);
    } finally {
      await h.dispose();
    }
  });

  it('runs the final check inside the create entry point of the operation writer', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit(APPROVED);
      const attempt = await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId);
      if (!attempt) throw new Error('missing attempt');
      const input = await h.p.messages.get(h.identity.userId, ids.sessionId, attempt.causal.userMessageId);
      if (!input) throw new Error('missing accepted input');
      const cal = h.runtime.d.calendar!;
      if (!isCalendarV2(cal)) throw new Error('expected the v2 calendar runtime');
      const account = await cal.connection.currentAccount();
      const binding = { ...account, calendarId: 'primary', targetRevision: 1 };
      const ledger = new CalendarTurnLedger({
        accounting: asCalendarAccountingPort(h.p),
        identity: {
          userId: h.identity.userId, sessionId: ids.sessionId, turnId: ids.turnId,
          attemptId: ids.attemptId, openRouterUser: h.identity.userId, createdAt: attempt.createdAt,
          deadlineAt: new Date(Date.parse(attempt.createdAt) + DEFAULT_BUDGETS.totalRunTimeoutMs).toISOString(),
        },
        limits: CALENDAR_LIMITS, write: action => action(), clock: Date.now,
        modelId: 'fixture/model', pricing: fixturePricing, configRevision: 1, connection: binding,
        maxOutputTokens: DEFAULT_BUDGETS.maxOutputTokens, processingPolicyId: 'fixture-policy',
        job: { check() {}, wait: async <T>(p: Promise<T>) => p, signal: new AbortController().signal },
        fence: async () => true, requireCurrent: async () => {},
      });
      const resolved = target();
      const canonical = canonicalCalendarAction(ACTION, resolved);
      const requestHash = calendarActionHash(canonical);
      const intentId = key('calendar-intent', h.identity.userId, ids.sessionId, ids.turnId);
      const operationId = key('calendar-operation', h.identity.userId, ids.sessionId, intentId);
      const writer = () => new CalendarOperationWriter({
        operationsV2: h.p.calendarOperationsV2, executionV2: cal.execution,
        write: action => action(), ledger,
        identity: {
          userId: h.identity.userId, sessionId: ids.sessionId,
          turnId: ids.turnId, attemptId: ids.attemptId,
        },
        binding, clock: Date.now,
        job: { check() {}, signal: new AbortController().signal },
        fence: async () => true, requireCurrent: async () => {},
        permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
        trustedTimeZone: 'Etc/UTC',
      });
      const request = (preflight: () => Promise<CalendarAvailabilityResult>) => ({
        intent: {
          intentId, originatingTurnId: ids.turnId,
          originatingAcceptedMessageId: input.messageId, originatingAttemptId: ids.attemptId,
        },
        account, target: resolved,
        accepted: { message: input, turnId: ids.turnId },
        proposal: null, consumption: null,
        action: canonical, requestHash, operationId,
        decisionId: 'decision-preflight', toolCallId: 'tool-call-preflight',
        createdAt: attempt.createdAt,
        auditExpiresAt: new Date(Date.parse(attempt.createdAt) + 2592000000).toISOString(),
        preflight,
      });

      // The model-requested call is charged once before the create is admitted.
      await ledger.consume({ logicalTools: 1 });
      const blocked = await writer().executeCreate(
        request(async () => availability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] })),
      );
      expect(blocked.outcome).toBe('clarify');
      expect(await h.p.calendarOperations.getByTurn(h.identity.userId, ids.sessionId, ids.turnId)).toBeNull();
      expect(await h.p.calendarOperationsV2.getByTurn(h.identity.userId, ids.sessionId, ids.turnId)).toBeNull();

      const created = await writer().executeCreate(request(async () => availability()));
      expect(created.outcome).toBe('created');
    } finally {
      await h.dispose();
    }
  });
});
