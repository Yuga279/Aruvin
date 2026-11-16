/**
 * ============================================================================
 * FILE: calendar-confirmation.spec.ts
 * LOCATION: backend/test/runtime/calendar-confirmation.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Reproduce and prevent the conversational scheduling confirmation loop.
 *
 * ROLE IN PROJECT:
 *    Exercises real intent, proposal, preflight and operation paths with local
 *    model/Calendar fixtures; never sends a live provider request.
 *
 * KEY COMPONENTS:
 *    - Saved disclosure: A model suggestion is not permission to write.
 *    - Short replies: Approve only the current, unexpired disclosed action.
 *    - Safety: No-tool instructions and new conflicts cannot authorize writes.
 *    - Repeat create: A succeeded event is not a new busy conflict.
 *    - Confirm after own write: A hash-mismatched later Confirm must not
 *      narrate "not created" for the busy interval we just wrote.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { calendarFixture, createWire, processDiagnosticCapture, skillWire, textWire }
  from './calendar-runtime.fixture.js';
import { busy, event } from './calendar-multi-fixture.js';

const ball = event({ summary: 'Ball', start: '2026-10-31T16:00:00+05:30',
  end: '2026-10-31T19:00:00+05:30', timeZone: 'Asia/Kolkata',
  description: 'An evening game', location: 'The park' });

let createSequence = 0;

function creates(action: Parameters<typeof createWire>[0], callId = 'create-one'): string[] {
  createSequence += 1;
  return [
    skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] },
      `load-create-${createSequence}`),
    createWire(action, callId),
  ];
}

function visibleText(h: ReturnType<typeof calendarFixture>) {
  return h.frames.reduce((text, frame) => frame.event.type === 'delta'
    ? (frame.event.reset ? '' : text) + frame.event.text : text, '');
}

it('persists the Confirm reference with acceptance instead of a separate binding write', async () => {
  const h = calendarFixture();
  try {
    const first = await h.submit('create the event');
    h.modelWires.push(...creates(ball));
    await h.execute(first);
    const proposal = (await h.currentProposal(first.sessionId))!;
    const binding = vi.spyOn(h.p.calendarProposals, 'bindReplyReference');
    const command = { identity: h.identity, sessionId: first.sessionId, content: 'yes',
      idempotencyKey: 'referenced-confirm-1',
      calendarReplyTo: { proposalId: proposal.proposalId, revision: proposal.revision } };
    const reply = await h.runtime.submitTurn(command);
    expect(binding).not.toHaveBeenCalled();
    const accepted = await h.p.metadata.getAttempt(h.identity.userId, first.sessionId, reply.attemptId);
    expect(accepted).toHaveProperty('calendarReplyTo', command.calendarReplyTo);
    await h.execute(reply);
    expect(await h.operationFor(reply)).toMatchObject({ state: 'succeeded' });
    await h.restart(); // Idempotent replay reads the persisted reference, not an in-memory handoff.
    expect((await h.runtime.submitTurn(command)).attemptId).toBe(reply.attemptId);
    await expect(h.runtime.submitTurn({ ...command,
      calendarReplyTo: { ...command.calendarReplyTo, revision: proposal.revision + 1 },
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    await expect(h.runtime.submitTurn({ ...command, calendarReplyTo: undefined }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    binding.mockRestore();
  } finally { await h.dispose(); }
});

it('emits a durable success receipt before retention bookkeeping without claiming turn completion', async () => {
  const h = calendarFixture();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let reached!: () => void;
  const started = new Promise<void>(resolve => { reached = resolve; });
  try {
    const first = await h.submit('create the event');
    h.modelWires.push(...creates(ball));
    await h.execute(first);
    const register = h.p.calendarRetention.registerSource.bind(h.p.calendarRetention);
    const spy = vi.spyOn(h.p.calendarRetention, 'registerSource').mockImplementation(async input => {
      reached();
      await held;
      return register(input);
    });
    const reply = await h.submit('yes', first.sessionId);
    const executing = h.execute(reply);
    await started;
    const frames = h.frames.filter(frame => frame.turnId === reply.turnId);
    // Release even when the assertion fails so the fixture never leaves a live run behind.
    try {
      expect(frames.some(frame => frame.event.type === 'calendar-operation'
        && frame.event.operation.receipt?.durable === true)).toBe(true);
      expect(frames.some(frame => frame.event.type === 'completed')).toBe(false);
    } finally {
      release();
      await executing;
      spy.mockRestore();
    }
    expect(h.frames.at(-1)?.event.type).toBe('completed');
    expect(h.modelBodies).toHaveLength(2);
  } finally { release(); await h.dispose(); }
});

it('seals a successful model-directed create without another LLM call', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    h.modelWires.push(...creates(event()));
    h.modelWires.push(textWire('I have not created the meeting.'));
    await h.execute(ids);
    expect(await h.operationFor(ids)).toMatchObject({ state: 'succeeded' });
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(2);
    expect(visibleText(h)).toContain('Created "Planning"');
    expect(visibleText(h)).not.toContain('not created');
    expect(h.frames.some(frame => frame.event.type === 'calendar-operation'
      && frame.event.operation.state === 'succeeded')).toBe(true);
  } finally { await h.dispose(); }
});

it.each(['matched', 'absent', 'mismatch', 'unavailable'] as const)(
  'verifies a response-field error with one %s readback and no additional LLM call', async readback => {
  const h = calendarFixture();
  try {
    const first = await h.submit('create the event');
    h.modelWires.push(...creates(ball));
    await h.execute(first);
    const original = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      const path = new URL(String(url)).pathname;
      if (String(init?.method) === 'POST' && path.endsWith('/events')) {
        return Response.json({ error: { code: 400,
          message: 'Invalid field selection extendedProperties.private' } }, { status: 400 });
      }
      if (path.includes('/events/') && readback !== 'matched') {
        if (readback === 'mismatch') {
          return Response.json({ ...await response.json(), summary: 'An unrelated event' });
        }
        return Response.json({ error: {} }, { status: readback === 'absent' ? 404 : 503 });
      }
      return response;
    });
    h.modelWires.push(textWire('Google rejected the event details. Nothing was added.'));
    const reply = await h.submit('yes', first.sessionId);
    await h.execute(reply);
    expect(await h.operationFor(reply)).toMatchObject({ state: readback === 'matched' ? 'succeeded' : 'unknown' });
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(h.requestKinds.filter(kind => kind === 'readback')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(2);
    expect(visibleText(h)).toContain(readback === 'matched' ? 'Created "Ball"' : 'may or may not have been created');
    expect(h.frames.some(frame => frame.turnId === reply.turnId
      && frame.event.type === 'calendar-operation'
      && frame.event.operation.receipt?.durable === true)).toBe(readback === 'matched');
  } finally { await h.dispose(); }
});

it('reports an actual Calendar rejection directly without asking the LLM to narrate it', async () => {
  const h = calendarFixture();
  try {
    const first = await h.submit('create the event');
    h.modelWires.push(...creates(ball));
    await h.execute(first);
    const original = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (url, init) => {
      if (String(init?.method) === 'POST' && new URL(String(url)).pathname.endsWith('/events')) {
        return Response.json({ error: { code: 400, message: 'Invalid Value' } }, { status: 400 });
      }
      return original(url, init);
    });
    const reply = await h.submit('yes', first.sessionId);
    await h.execute(reply);
    expect(await h.operationFor(reply)).toMatchObject({ state: 'definitely-failed' });
    expect(h.modelBodies).toHaveLength(2);
    expect(h.requestKinds.filter(kind => kind === 'create')).toHaveLength(1);
    expect(h.requestKinds.filter(kind => kind === 'readback')).toHaveLength(0);
    expect(visibleText(h)).toContain('Google Calendar rejected the event details');
    expect(h.frames.some(frame => frame.turnId === reply.turnId
      && frame.event.type === 'calendar-operation'
      && frame.event.operation.receipt?.durable === true)).toBe(false);
  } finally { await h.dispose(); }
});

it.each([
  { content: 'Schedule Ball tomorrow from 4 to 7 pm India time.', replyText: 'yes' },
  { content: 'create the event', replyText: 'create the event' },
  { content: 'create an event at 2pm tomorrow named "Aurvin Demo"', replyText: 'sure' },
  { content: 'end it at 3:00 PM', replyText: 'yes' },
])('saves an actionable confirmation instead of looping for $content', async ({ content, replyText }) => {
    const trace = processDiagnosticCapture();
    const h = calendarFixture(trace.diagnostics);
    try {
      const first = await h.submit(content);
      h.modelWires.push(...creates(ball));
      await h.execute(first);
      const proposal = await h.currentProposal(first.sessionId);
      expect(proposal).toMatchObject({ purpose: 'details', state: 'pending',
        action: { ...ball, calendarId: 'personal@example.test' } });
      expect(proposal?.incomplete).toBeUndefined();
      expect(h.frames.some(frame => frame.event.type === 'calendar-clarification'
        && frame.event.proposalRevision === proposal!.revision)).toBe(true);
      expect(visibleText(h)).toContain('Ball');
      for (const value of [ball.start, ball.end, ball.timeZone, ball.description!, ball.location!, 'Personal']) {
        expect(visibleText(h)).toContain(value);
      }
      expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(0);
      expect(await h.operationFor(first)).toBeNull();
      expect(trace.records()).toContainEqual(expect.objectContaining({ stage: 'task-outcome',
        task: 'clarification', writeCertainty: 'not-sent' }));

      // No client proposal reference or second model call is necessary.
      const reply = await h.submit(replyText, first.sessionId);
      await h.execute(reply);
      expect(await h.operationFor(reply)).toMatchObject({ state: 'succeeded',
        intentId: proposal!.intentId, action: proposal!.action,
        authorization: { basis: 'proposal-confirmation', proposalId: proposal!.proposalId,
          acceptedUserMessageId: reply.userMessageId } });
      expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
      expect(h.modelBodies).toHaveLength(2);
      expect(visibleText(h)).toContain('Created "Ball"');
      expect(h.frames.some(frame => frame.turnId === reply.turnId
        && frame.event.type === 'calendar-operation'
        && frame.event.operation.state === 'succeeded'
        && frame.event.operation.receipt?.durable === true)).toBe(true);
      expect(h.frames.at(-1)?.event.type).toBe('completed');
      await h.execute(reply);
      expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    } finally { await h.dispose(); }
  });

it('discloses the whole proposed action before a calendar choice can authorize it', async () => {
  const h = calendarFixture();
  try {
    await h.setDiscovery({ duplicateWorkNames: true });
    const ids = await h.submit('create the event');
    h.modelWires.push(...creates({ ...ball, calendarId: 'Work' }));
    await h.execute(ids);
    const proposal = await h.currentProposal(ids.sessionId);
    expect(proposal).toMatchObject({ purpose: 'selection', state: 'pending' });
    expect(proposal!.action?.calendarId).toBeUndefined();
    for (const value of [ball.summary, ball.start, ball.end, ball.timeZone, ball.description!, ball.location!]) {
      expect(visibleText(h)).toContain(value);
    }
    const reply = await h.submit('Use the second one', ids.sessionId);
    await h.execute(reply);
    expect(await h.operationFor(reply)).toMatchObject({ state: 'succeeded',
      calendarId: proposal!.candidates[1].target.calendarId, action: ball });
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('resolves a model-suggested calendar label without granting permission until disclosure', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Please schedule the event on Work.');
    h.modelWires.push(...creates({ ...ball, calendarId: 'Work' }));
    await h.execute(ids);
    expect(await h.currentProposal(ids.sessionId)).toMatchObject({ purpose: 'details',
      target: { calendarId: 'team@example.test' }, action: { ...ball, calendarId: 'team@example.test' } });
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(0);
  } finally { await h.dispose(); }
});

it('does not lecture about authorization when a short follow-up needs a preview', async () => {
  const h = calendarFixture();
  try {
    const first = await h.submit('sure');
    h.modelWires.push(...creates(ball));
    await h.execute(first);
    expect(visibleText(h)).not.toContain('does not authorize scheduling');
    expect(await h.currentProposal(first.sessionId)).toMatchObject({ purpose: 'details', state: 'pending' });
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(0);
  } finally { await h.dispose(); }
});

it('does not turn a no-tool request into a scheduling proposal or a write', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit("Don't do any tool calls just tell me what stops you from doing it just a plain response");
    h.modelWires.push(...creates(ball)); // Even a misbehaving model cannot approve it.
    await h.execute(ids);
    expect(h.effects).toHaveLength(0);
    expect(h.requestKinds).toHaveLength(0);
    expect(await h.currentProposal(ids.sessionId)).toBeNull();
    expect(visibleText(h)).not.toContain('I need explicit confirmation');
  } finally { await h.dispose(); }
});

it('does not accept a new conflict as part of a plain event confirmation', async () => {
  const h = calendarFixture();
  try {
    const first = await h.submit('create the event');
    h.modelWires.push(...creates(event()));
    await h.execute(first);
    expect(await h.currentProposal(first.sessionId)).toMatchObject({ purpose: 'details' });
    h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
    h.modelWires.push(textWire('That time is busy. Would you like a different time?'));
    const reply = await h.submit('create the event', first.sessionId);
    await h.execute(reply);
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(0);
    expect(await h.operationFor(reply)).toBeNull();
    expect(await h.currentProposal(first.sessionId)).toBeNull();
    expect(visibleText(h)).toContain('different time');
    expect(visibleText(h)).not.toContain('create the event anyway');
  } finally { await h.dispose(); }
});

it('does not revive an expired event confirmation', async () => {
  const h = calendarFixture();
  try {
    const first = await h.submit('create the event');
    h.modelWires.push(...creates(event()));
    await h.execute(first);
    expect(await h.currentProposal(first.sessionId)).toMatchObject({ purpose: 'details' });
    h.advance(600001);
    const reply = await h.submit('create the event', first.sessionId);
    await h.execute(reply);
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(0);
    expect(visibleText(h)).toContain('expired');
    expect(h.modelBodies).toHaveLength(2);
  } finally { await h.dispose(); }
});

it('does not narrate failure after Confirm when Google already has that same slot', async () => {
  const h = calendarFixture();
  try {
    const first = await h.submit('create the event');
    h.modelWires.push(...creates(event()));
    await h.execute(first);
    const created = await h.submit('yes', first.sessionId);
    await h.execute(created);
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(visibleText(h)).toContain('Created "Planning"');

    // Live Google freeBusy reports the written window in UTC. A later model
    // proposal can spell the same instants differently, so the canonical hash
    // misses the succeeded row.
    h.setAvailability({ busy: [busy('2026-11-03T10:00:00.000Z', '2026-11-03T11:00:00.000Z')] });
    const sameSlot = event({ start: '2026-11-03T10:00:00Z', end: '2026-11-03T11:00:00Z' });
    const again = await h.submit('create the event', first.sessionId);
    h.modelWires.push(...creates(sameSlot));
    await h.execute(again);
    expect(await h.currentProposal(first.sessionId)).toMatchObject({
      purpose: 'details', action: { start: sameSlot.start, end: sameSlot.end },
    });

    h.modelWires.push(textWire(
      'No Calendar event was created. The requested time overlaps busy periods (2026-11-03T10:00:00.000Z to 2026-11-03T11:00:00.000Z).',
    ));
    const reply = await h.submit('yes', first.sessionId);
    await h.execute(reply);
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(visibleText(h)).toContain('Created "Planning"');
    expect(visibleText(h)).not.toMatch(/was not created/i);
    expect(visibleText(h)).not.toMatch(/overlaps busy/i);
    expect(h.modelBodies).toHaveLength(4);
  } finally { await h.dispose(); }
});

it('does not treat a just-created event as a new busy conflict', async () => {
  const h = calendarFixture();
  try {
    const first = await h.submit('create the event');
    h.modelWires.push(...creates(event()));
    await h.execute(first);
    const reply = await h.submit('yes', first.sessionId);
    await h.execute(reply);
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(visibleText(h)).toContain('Created "Planning"');

    // Google now reports the written slot as busy because that event exists.
    h.setAvailability({ busy: [busy('2026-11-03T10:00:00Z', '2026-11-03T11:00:00Z')] });
    const again = await h.submit('create the event', first.sessionId);
    h.modelWires.push(...creates(event()));
    await h.execute(again);
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(await h.currentProposal(first.sessionId)).toBeNull();
    expect(visibleText(h)).toContain('Created "Planning"');
    expect(visibleText(h)).not.toMatch(/was not created/i);
    expect(h.modelBodies).toHaveLength(4);
  } finally { await h.dispose(); }
});
