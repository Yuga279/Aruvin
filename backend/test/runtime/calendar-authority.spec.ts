/**
 * ============================================================================
 * FILE: calendar-authority.spec.ts
 * LOCATION: backend/test/runtime/calendar-authority.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integration tests for cross-turn proposal authority, natural choice replies, and single-use consumption.
 *
 * ROLE IN PROJECT:
 *    Enforces that user replies bind to durable proposals, prevents replay or revived consent after expiry,
 *    and verifies single-use proposal consumption semantics.
 *
 * KEY COMPONENTS:
 *    - Binds natural choice to proposal and original intent.
 *    - Rejects expired proposal reconstruction from transcript or late replies.
 *    - Binds the untrusted reply reference and refuses a stale one.
 *    - Publishes and refuses incomplete-details proposals.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readCalendarReply } from '../../src/chat-runtime/calendar-intent.js';
import { calendarEventId } from '../../src/plugins/google-calendar/tools-validation.js';
import { calendarFixture, createWire, skillWire, textWire, type CalendarRuntimeFixture }
  from './calendar-runtime.fixture.js';
import { busy, disclose, event } from './calendar-multi-fixture.js';
import type { CalendarCreateInput } from '../../src/contracts/calendar-tools.js';
import type { CalendarReplyReference } from '../../src/contracts/calendar-authority.js';
import type { SubmitTurnCommand } from '../../src/contracts/runtime.js';

const REQUEST = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.';
const SECOND_REQUEST = 'Schedule Review on 2026-11-04 from 10:00 to 11:00 Etc/UTC.';

let authoritySequence = 0;

/** One disclosure inside an existing session. */
async function discloseIn(h: CalendarRuntimeFixture, content: string, action: CalendarCreateInput, sessionId: string) {
  const ids = await h.submit(content, sessionId);
  authoritySequence += 1;
  h.modelWires.push(
    skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] },
      `load-create-${authoritySequence}`),
    createWire(action, 'create-one'));
  await h.execute(ids);
  const proposal = await h.currentProposal(ids.sessionId);
  if (!proposal) throw new Error('Expected a proposal after the disclosure');
  return { ids, proposal };
}

/** One submit that carries the untrusted Calendar reply reference. */
function submitReferenced(h: CalendarRuntimeFixture, content: string, sessionId: string,
  idempotencyKey: string, replyTo: CalendarReplyReference) {
  return h.runtime.submitTurn({
    identity: h.identity, sessionId, content, idempotencyKey, calendarReplyTo: replyTo,
  } as SubmitTurnCommand);
}

describe('calendar-authority', () => {
  it('binds a natural choice to one current proposal and its originating intent', async () => {
    const h = calendarFixture();
    try {
      await h.setDiscovery({ duplicateWorkNames: true });
      let first: any;
      try {
        first = await disclose(
          h,
          'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.',
          event(),
        );
      } catch (err: any) {
        console.error('ERROR IN DISCLOSE:', err, err.stack);
        throw err;
      }
      expect(first.proposal).toMatchObject({
        purpose: 'selection',
        state: 'pending',
        originatingTurnId: first.ids.turnId,
        originatingAcceptedMessageId: first.ids.userMessageId,
      });
      expect(Date.parse(first.proposal.expiresAt) - Date.parse(first.proposal.createdAt)).toBeLessThanOrEqual(600000);

      const reply = await h.reply(first.proposal, 'Use the second one', first.ids.sessionId);
      h.modelWires.push(textWire('Created on the selected calendar.'));
      await h.execute(reply);

      const op = await h.operationFor(reply);
      expect(op).toMatchObject({
        intentId: first.proposal.intentId,
        originatingAcceptedMessageId: first.ids.userMessageId,
        turnId: reply.turnId,
        authorization: { acceptedUserMessageId: reply.userMessageId, basis: 'proposal-selection' },
      });
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it('cannot reconstruct an expired proposal from a later yes or transcript', async () => {
    const h = calendarFixture();
    try {
      await h.setDiscovery({ duplicateWorkNames: true });
      const first = await disclose(
        h,
        'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.',
        event(),
      );
      h.advance(600000);
      const reply = await h.reply(first.proposal, 'Yes, use the second one', first.ids.sessionId);
      await h.execute(reply);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      expect((await h.proposalAuthority(first.proposal)).state).toBe('tombstone');
    } finally {
      await h.dispose();
    }
  });

  it('links a conflict reply to the original accepted intent and one operation', async () => {
    const h = calendarFixture();
    try {
      h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
      const first = await disclose(
        h,
        'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
        event(),
      );
      expect(first.proposal.purpose).toBe('conflict');
      const reply = await h.reply(first.proposal, 'Yes, go ahead', first.ids.sessionId);
      h.modelWires.push(textWire('Created despite the disclosed conflict.'));
      await h.execute(reply);
      const op = await h.operationFor(reply);
      expect(op).toMatchObject({
        schemaVersion: 2,
        intentId: first.proposal.intentId,
        originatingTurnId: first.ids.turnId,
        originatingAcceptedMessageId: first.ids.userMessageId,
        turnId: reply.turnId,
        state: 'succeeded',
        authorization: {
          basis: 'conflict-acceptance',
          acceptedTurnId: reply.turnId,
          acceptedUserMessageId: reply.userMessageId,
          canonicalActionHash: op!.requestHash,
          conditionFingerprint: first.proposal.conditionFingerprint,
        },
      });
      expect(op!.googleEventId).toBe(calendarEventId(op!.operationId));
      expect(h.order.indexOf('operation-dispatch-event')).toBeLessThan(h.order.indexOf('google-create'));
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it('separates an ambiguous reply from an unrelated message', async () => {
    const h = calendarFixture();
    try {
      h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
      const first = await disclose(
        h,
        'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
        event(),
      );
      expect(first.proposal.purpose).toBe('conflict');

      // The intent layer distinguishes a reply that engages the proposal without
      // answering it from a message that is not an answer at all.
      expect(readCalendarReply('maybe?', first.proposal).decision).toBe('ambiguous');
      expect(readCalendarReply('the quarterly report is done', first.proposal).decision).toBe('unrelated');

      // An uncertain reply keeps the proposal pending and asks again instead of
      // being answered as ordinary chat.
      const unsure = await h.reply(first.proposal, 'maybe?', first.ids.sessionId);
      await h.execute(unsure);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      expect((await h.proposalAuthority(first.proposal)).state).toBe('pending');
      const asked = await h.p.messages.list(h.identity.userId, unsure.sessionId, { cursor: null, limit: 50 });
      expect(asked.items.filter(m => m.role === 'assistant').at(-1)?.content)
        .toContain('Should I create the event anyway');

      // An unrelated message is ordinary chat. It never consumes the proposal
      // and never becomes authority for an effect.
      const unrelated = await h.reply(first.proposal, 'the quarterly report is done', first.ids.sessionId);
      h.modelWires.push(textWire('Noted.'));
      await h.execute(unrelated);
      expect((await h.proposalAuthority(first.proposal)).state).toBe('pending');
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      const answered = await h.p.messages.list(h.identity.userId, unrelated.sessionId, { cursor: null, limit: 50 });
      expect(answered.items.filter(m => m.role === 'assistant').at(-1)?.content).toBe('Noted.');
    } finally {
      await h.dispose();
    }
  });

  it('accepts a reply that names the current proposal revision', async () => {
    const h = calendarFixture();
    try {
      h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
      const first = await disclose(h, REQUEST, event());
      const ids = await submitReferenced(h, 'Yes, go ahead', first.ids.sessionId, 'reply-current-1',
        { proposalId: first.proposal.proposalId, revision: first.proposal.revision });
      h.modelWires.push(textWire('Created despite the disclosed conflict.'));
      await h.execute(ids);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
      expect(await h.proposalAuthority(first.proposal)).toMatchObject({ state: 'consumed' });
    } finally {
      await h.dispose();
    }
  });

  it('never lets a reply that names a superseded disclosure approve the current proposal', async () => {
    const h = calendarFixture();
    try {
      h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z'),
        busy('2026-11-04T10:15:00Z', '2026-11-04T10:30:00Z')] });
      const first = await disclose(h, REQUEST, event());
      // A second disclosure in the same session supersedes the first one.
      const second = await discloseIn(h, SECOND_REQUEST,
        event({ summary: 'Review', start: '2026-11-04T10:00:00+00:00', end: '2026-11-04T11:00:00+00:00' }),
        first.ids.sessionId);
      expect(second.proposal.proposalId).not.toBe(first.proposal.proposalId);

      // The stale tab names the superseded disclosure. It must not approve the
      // current proposal and must not create anything.
      const ids = await submitReferenced(h, 'Yes, go ahead', first.ids.sessionId, 'reply-stale-1',
        { proposalId: first.proposal.proposalId, revision: first.proposal.revision });
      await h.execute(ids);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      expect(await h.proposalAuthority(second.proposal)).toMatchObject({ state: 'pending' });
      const asked = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
      expect(asked.items.filter(m => m.role === 'assistant').at(-1)?.content)
        .toContain('Which current scheduling request do you mean');
    } finally {
      await h.dispose();
    }
  });

  it('asks which proposal is meant when a bare reply cannot be tied to one disclosure', async () => {
    const h = calendarFixture();
    try {
      h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z'),
        busy('2026-11-04T10:15:00Z', '2026-11-04T10:30:00Z')] });
      const first = await disclose(h, REQUEST, event());
      const second = await discloseIn(h, SECOND_REQUEST,
        event({ summary: 'Review', start: '2026-11-04T10:00:00+00:00', end: '2026-11-04T11:00:00+00:00' }),
        first.ids.sessionId);

      // Without a reference the server cannot prove that the bare approval
      // belongs to the current disclosure, so it asks instead of approving.
      const reply = await h.reply(second.proposal, 'Yes, go ahead', first.ids.sessionId);
      await h.execute(reply);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      expect(await h.proposalAuthority(second.proposal)).toMatchObject({ state: 'pending' });
      const asked = await h.p.messages.list(h.identity.userId, reply.sessionId, { cursor: null, limit: 50 });
      expect(asked.items.filter(m => m.role === 'assistant').at(-1)?.content)
        .toContain('Which current scheduling request do you mean');
    } finally {
      await h.dispose();
    }
  });

  it('detects a resubmitted request identity that names a different proposal revision', async () => {
    const h = calendarFixture();
    try {
      h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
      const first = await disclose(h, REQUEST, event());
      const ids = await submitReferenced(h, 'Yes, go ahead', first.ids.sessionId, 'reply-same-key-1',
        { proposalId: first.proposal.proposalId, revision: first.proposal.revision });
      h.modelWires.push(textWire('Created despite the disclosed conflict.'));
      await h.execute(ids);
      await expect(submitReferenced(h, 'Yes, go ahead', first.ids.sessionId, 'reply-same-key-1',
        { proposalId: first.proposal.proposalId, revision: first.proposal.revision + 1 }))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    } finally {
      await h.dispose();
    }
  });

  it('publishes an incomplete proposal for missing details and never consumes it', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit(REQUEST);
      // The model changed the title, so the accepted request is still missing
      // material details.
      h.modelWires.push(
        skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] }, 'load-create'),
        createWire(event({ summary: 'Different' }), 'create-one'));
      await h.execute(ids);
      const proposal = await h.currentProposal(ids.sessionId);
      expect(proposal).toMatchObject({
        purpose: 'details', action: null, canonicalActionHash: null, target: null,
        incomplete: { missing: ['title', 'start', 'end', 'timeZone'], messageRefs: [ids.userMessageId] },
      });

      // The incomplete proposal cannot be consumed: it stays pending and the
      // runtime asks for the missing details.
      const reply = await h.reply(proposal!, 'Yes, go ahead', ids.sessionId);
      await h.execute(reply);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      expect(await h.proposalAuthority(proposal!)).toMatchObject({ state: 'pending' });
      const asked = await h.p.messages.list(h.identity.userId, reply.sessionId, { cursor: null, limit: 50 });
      expect(asked.items.filter(m => m.role === 'assistant').at(-1)?.content)
        .toContain('Please provide the missing scheduling details');
    } finally {
      await h.dispose();
    }
  });

  it('renews acceptance when fresh coverage changes instead of replaying the old yes', async () => {
    const h = calendarFixture();
    try {
      h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
      const first = await disclose(h, REQUEST, event());
      h.setAvailability({
        busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')],
        calendarErrors: { 'read@example.test': 'notFound' },
      });
      h.modelWires.push(textWire('That time is still busy. Would you like a different time?'));
      const reply = await h.reply(first.proposal, 'Go ahead', first.ids.sessionId);
      await h.execute(reply);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      expect(h.frames.filter(frame => frame.event.type === 'calendar-clarification'
        && frame.turnId === reply.turnId)).toHaveLength(0);
      expect(await h.currentProposal(reply.sessionId)).toBeNull();
      const asked = await h.p.messages.list(h.identity.userId, reply.sessionId, { cursor: null, limit: 50 });
      expect(asked.items.filter(m => m.role === 'assistant').at(-1)?.content)
        .toContain('different time');
    } finally {
      await h.dispose();
    }
  });

  it('publishes an incomplete selection without candidates when the target is unknown', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC on my Missing calendar.');
      h.modelWires.push(
        skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] }, 'load-create'),
        createWire(event(), 'create-one'));
      await h.execute(ids);
      const proposal = await h.currentProposal(ids.sessionId);
      expect(proposal).toMatchObject({
        purpose: 'selection', action: null, canonicalActionHash: null, target: null, candidates: [],
        incomplete: { missing: ['target'], messageRefs: [ids.userMessageId] },
      });
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  });
});
