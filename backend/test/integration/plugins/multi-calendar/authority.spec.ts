/**
 * ============================================================================
 * FILE: authority.spec.ts
 * LOCATION: backend/test/integration/plugins/multi-calendar/authority.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify durable multi-calendar selection and condition acceptance over HTTP.
 * ROLE IN PROJECT:
 *    Runs real runtime/MCP logic against scripted Google/model responses.
 *    Confirms that browser references and competing tabs grant no extra authority.
 * KEY COMPONENTS:
 *    - Disclosure: Zero effect before a durable current proposal is answered.
 *    - Recheck: Material condition changes require renewed acceptance.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { submitTurnResponseSchema } from '../../../../src/contracts/api.js';
import { createWire, textWire } from '../../../runtime/calendar-runtime.fixture.js';
import { event } from '../../../runtime/calendar-multi-fixture.js';
import { loadWire } from '../../../assembly/skill-fixture.js';
import { openApp } from './assembled.js';

const content = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.';
const busy = [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }];
type App = Awaited<ReturnType<typeof openApp>>;
const posts = (h: App) => h.fetcher.mock.calls.filter(([url, init]) =>
  String(url).includes('/events') && init?.method === 'POST');
async function disclose(h: App) {
  h.cal.modelWires.push(loadWire(['calendar_create_event'], 'authority-load'), createWire(event()));
  const ids = await h.submit(content);
  await h.stream(ids);
  const proposal = await h.cal.currentProposal(ids.sessionId);
  if (!proposal) throw new Error('Expected a durable proposal.');
  expect(posts(h)).toHaveLength(0);
  expect(proposal.originatingAcceptedMessageId).toBe(ids.userMessageId);
  expect(Date.parse(proposal.expiresAt) - Date.parse(proposal.createdAt)).toBeLessThanOrEqual(600000);
  return { ids, proposal, reference: { proposalId: proposal.proposalId, revision: proposal.revision } };
}

it('accepts a natural choice once without exposing internal JSON or IDs to the user', async () => {
  const h = await openApp();
  try {
    await h.cal.setDiscovery({ duplicateWorkNames: true });
    const first = await disclose(h);
    expect(first.proposal.purpose).toBe('selection');
    h.cal.modelWires.push(textWire('Created on the selected calendar.'));
    const reply = await h.submit('Use the second one', first.ids.sessionId, first.reference);
    await h.stream(reply);
    expect(await h.cal.operationFor(reply)).toMatchObject({ state: 'succeeded',
      intentId: first.proposal.intentId, originatingAcceptedMessageId: first.ids.userMessageId,
      authorization: { acceptedUserMessageId: reply.userMessageId, basis: 'proposal-selection' } });
    expect(posts(h)).toHaveLength(1);
  } finally { await h.dispose(); }
}, 20000);

it.each(['conflict', 'coverage'] as const)('accepts unchanged disclosed %s but never before a reply', async mode => {
  const h = await openApp();
  try {
    h.cal.setAvailability(mode === 'conflict' ? { busy }
      : { calendarErrors: { 'read@example.test': 'notFound' } });
    const first = await disclose(h);
    expect(first.proposal.conditionFingerprint).toBeTruthy();
    h.cal.modelWires.push(textWire('Created with your acceptance.'));
    const reply = await h.submit('Yes, go ahead', first.ids.sessionId, first.reference);
    const frames = await h.stream(reply);
    expect(await h.cal.operationFor(reply)).toMatchObject({ state: 'succeeded',
      authorization: { basis: 'conflict-acceptance', conditionFingerprint: first.proposal.conditionFingerprint } });
    expect(posts(h)).toHaveLength(1);
    expect(frames.some(frame => frame.event.type === 'calendar-clarification')).toBe(false);
  } finally { await h.dispose(); }
}, 20000);

it('renews acceptance when fresh coverage changes instead of replaying the old yes', async () => {
  const h = await openApp();
  try {
    h.cal.setAvailability({ busy });
    const first = await disclose(h);
    h.cal.setAvailability({ busy, calendarErrors: { 'read@example.test': 'notFound' } });
    h.cal.modelWires.push(textWire('That time is still busy. Would you like a different time?'));
    const reply = await h.submit('Go ahead', first.ids.sessionId, first.reference);
    const frames = await h.stream(reply);
    expect(posts(h)).toHaveLength(0);
    expect(frames.some(frame => frame.event.type === 'calendar-clarification')).toBe(false);
    expect(frames.at(-1)?.event.type).toBe('completed');
    expect(await h.cal.currentProposal(reply.sessionId)).toBeNull();
  } finally { await h.dispose(); }
}, 20000);

it('admits one competing same-session reply and does not consume a cross-session reference', async () => {
  const h = await openApp();
  try {
    h.cal.setAvailability({ busy });
    const first = await disclose(h);
    h.cal.modelWires.push(textWire('There is no scheduling request to confirm in this chat.'));
    const foreign = await h.submit('Go ahead', null, first.reference);
    await h.stream(foreign);
    expect(posts(h)).toHaveLength(0);
    expect(await h.cal.p.calendarProposals.getAuthority('aurvin-dev-user', first.ids.sessionId,
      first.proposal.proposalId)).toMatchObject({ state: 'pending' });
    const replies = await Promise.all([
      h.accept('Yes', first.ids.sessionId, 'multi-tab-one', first.reference),
      h.accept('Go ahead', first.ids.sessionId, 'multi-tab-two', first.reference),
    ]);
    expect(replies.map(reply => reply.status).sort()).toEqual([202, 409]);
    h.cal.modelWires.push(textWire('Created once.'));
    await h.stream(submitTurnResponseSchema.parse(replies.find(reply => reply.status === 202)!.body));
    expect(posts(h)).toHaveLength(1);
    expect(await h.cal.p.calendarProposals.getAuthority('aurvin-dev-user', first.ids.sessionId,
      first.proposal.proposalId)).toMatchObject({ state: 'consumed' });
    h.cal.modelWires.push(textWire('That event is already scheduled.'));
    const replay = await h.submit('Go ahead', first.ids.sessionId, first.reference);
    await h.stream(replay);
    expect(posts(h)).toHaveLength(1);
  } finally { await h.dispose(); }
}, 20000);
