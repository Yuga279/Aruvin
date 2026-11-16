/**
 * ============================================================================
 * FILE: calendar-voice.spec.ts
 * LOCATION: backend/test/voice/integration/calendar-voice.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify offline voice Calendar authority across the admitted transport.
 * ROLE IN PROJECT:
 *    Connects real session, Calendar runtime, speech and archive boundaries.
 *    Uses deterministic provider doubles, never live calendar data.
 * KEY COMPONENTS:
 *    - Transport scenarios: Lookup, shared proposal confirmation and lifecycle.
 *    - Continuity: Saved views, mode switches and dictation exclusion.
 * ============================================================================
 */
import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { integratedFixture, origin } from './integrated-fixture.js';
import type { LivePeer } from './integrated-fixture.js';
import { calendarFixture, loadWire, skillWire, textWire } from '../../runtime/calendar-runtime.fixture.js';
import { CALENDAR_VIEW_MAX_BYTES, calendarViewSchema } from '../../../src/contracts/calendar-view.js';
import { googleJson } from '../../plugins/google-calendar/tools-fixtures.js';
import type { MongoClient } from 'mongodb';
import { calendarMemory } from '../../persistence/calendar-multi-memory.js';
import { createPersistenceBundle } from '../../../src/persistence/persistence.js';
import { DEFAULT_BUDGETS } from '../../../src/contracts/budgets.js';
import { PROPOSED_MEMORY_TEXT_POLICY } from '../../../src/chat-runtime/memory-text.js';
import { createWire } from '../../runtime/calendar-runtime.fixture.js';
import { event } from '../../runtime/calendar-multi-fixture.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

/** Count raw provider POST attempts separately from the fixture's success ledger. */
function countCreates(calendar: ReturnType<typeof calendarFixture>) {
  const base = calendar.fetcher.getMockImplementation()!;
  let creates = 0;
  calendar.fetcher.mockImplementation((url, init) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.includes('/calendar/v3/calendars/') && parsed.pathname.endsWith('/events')
      && String(init?.method ?? 'GET').toUpperCase() === 'POST') creates++;
    return base(url, init);
  });
  return { get creates() { return creates; } };
}

it('opens an offline live Calendar session without native DB prerequisites', async () => {
  const calendar = calendarFixture();
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-smoke-0001');
    expect(peer.events().some(e => e.type === 'session.ready')).toBe(true);
    expect(calendar.modelBodies).toHaveLength(0);
    expect(calendar.effects).toHaveLength(0);
    await f.end(peer);
  } finally { await f.close(); }
});

it('streams a live agenda before narration completes and reloads the same saved view', async () => {
  const calendar = calendarFixture();
  const f = await integratedFixture(calendar);
  try {
    calendar.modelWires.push(loadWire('calendar_list_events'), skillWire('call_tool', {
      plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
        timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20,
      },
    }, 'calendar-agenda-read'), textWire('No events in that range.'));
    const peer = await f.connect('live', null, 'calendar-agenda-0001');
    const ref = await f.startReply(peer, 'List my calendar for November 3.', 'agenda-speech-1');
    const frames = peer.events().filter(e => e.type === 'calendar.frame');
    const viewFrame = frames.find(e => e.event.type === 'calendar-view');
    expect(viewFrame).toMatchObject({ turnId: ref.turnId, responseId: ref.responseId,
      attemptId: expect.any(String), event: { type: 'calendar-view', view: {
        kind: 'agenda', entries: [], truncated: false, entriesOmitted: 0,
      } } });
    expect(frames.some(e => e.event.type === 'calendar-progress' && e.event.phase === 'executing')).toBe(true);
    expect(peer.events().some(e => e.type === 'audio.watermark' && e.final
      && e.responseId === ref.responseId)).toBe(false);
    await f.finishReply(peer, ref);
    const sessionId = f.latest().context.response.conversationId!;
    await f.end(peer);
    const saved = await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
    const assistant = saved.body.items.find((m: { role: string; turnId: string }) =>
      m.role === 'assistant' && m.turnId === ref.turnId);
    if (!viewFrame || viewFrame.event.type !== 'calendar-view') throw new Error('Missing agenda frame');
    expect(assistant.calendarView).toEqual(viewFrame.event.view);
    expect(assistant).toMatchObject({ mode: 'live', voiceSessionId: peer.response.sessionId });
    expect(assistant.content).toBe(''); // voice transcript remains separate
    expect(calendar.effects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(calendar.modelBodies).toHaveLength(3);
    expect(calendar.modelWires).toHaveLength(0);
    for (const body of calendar.modelBodies) expect(body.user).toBe(calendar.identity.userId);
    await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
    expect(calendar.effects.filter(e => e.kind === 'list')).toHaveLength(1); // reload is read-only
    expect(calendar.modelBodies).toHaveLength(3);
  } finally { await f.close(); }
});

it('reports a provider read failure instead of an empty agenda', async () => {
  const calendar = calendarFixture();
  const base = calendar.fetcher.getMockImplementation()!;
  calendar.fetcher.mockImplementation((url, init) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === 'www.googleapis.com' && parsed.pathname.includes('/calendar/v3/calendars/')
      && parsed.pathname.endsWith('/events') && String(init?.method ?? 'GET').toUpperCase() === 'GET') {
      return Promise.resolve(googleJson({ error: { code: 403, message: 'Insufficient Permission',
        errors: [{ reason: 'forbidden', domain: 'global' }] } }, { status: 403 }));
    }
    return base(url, init);
  });
  calendar.modelWires.push(loadWire('calendar_list_events'), skillWire('call_tool', {
    plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
      timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20,
    },
  }, 'agenda-failure-read'), textWire('The calendar could not be read.'));
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-agenda-failure');
    const ref = await f.startReply(peer, 'List my calendar for November 3.', 'agenda-failure-1');
    await f.finishReply(peer, ref);
    const sessionId = f.latest().context.response.conversationId!;
    await f.end(peer);
    const frames = peer.events().filter(e => e.type === 'calendar.frame');
    const viewFrame = frames.find(e => e.event.type === 'calendar-view');
    if (!viewFrame || viewFrame.event.type !== 'calendar-view') throw new Error('Missing failure frame');
    const view = calendarViewSchema.parse(viewFrame.event.view);
    // A processed provider failure must never be presented as "no events".
    expect(view).not.toMatchObject({ kind: 'agenda', entries: [] });
    expect(['notice', 'outcome']).toContain(view.kind);
    if (view.kind === 'notice') expect(['failed', 'unavailable']).toContain(view.state);
    if (view.kind === 'outcome') expect(view.state).not.toBe('succeeded');
    const saved = await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
    const assistant = saved.body.items.find((m: { role: string; turnId: string }) =>
      m.role === 'assistant' && m.turnId === ref.turnId);
    expect(assistant.calendarView).toEqual(viewFrame.event.view);
    // The provider read really was attempted and processed; it must not become a write.
    expect(calendar.effects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(0);
  } finally { await f.close(); }
});

it('asks for a real target instead of reading an unknown calendar', async () => {
  const calendar = calendarFixture();
  calendar.modelWires.push(loadWire('calendar_list_events'), skillWire('call_tool', {
    plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
      calendarId: 'missing@example.test', timeMin: '2026-11-03T00:00:00Z',
      timeMax: '2026-11-04T00:00:00Z', maxResults: 20,
    },
  }, 'agenda-unavailable-read'), textWire('Which calendar should I read?'));
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-agenda-unavailable');
    const ref = await f.startReply(peer, 'List my calendar for November 3.', 'agenda-unavailable-1');
    await f.finishReply(peer, ref);
    const sessionId = f.latest().context.response.conversationId!;
    await f.end(peer);
    const frames = peer.events().filter(e => e.type === 'calendar.frame');
    const viewFrame = frames.find(e => e.event.type === 'calendar-view');
    if (!viewFrame || viewFrame.event.type !== 'calendar-view') throw new Error('Missing unavailable frame');
    const view = calendarViewSchema.parse(viewFrame.event.view);
    expect(view).not.toMatchObject({ kind: 'agenda', entries: [] });
    expect(['proposal', 'notice']).toContain(view.kind);
    const saved = await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
    const assistant = saved.body.items.find((m: { role: string; turnId: string }) =>
      m.role === 'assistant' && m.turnId === ref.turnId);
    expect(assistant.calendarView).toEqual(viewFrame.event.view);
    expect(calendar.effects.filter(e => e.kind === 'list')).toHaveLength(0);
    expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(0);
  } finally { await f.close(); }
});

it('serves the same agenda from the memory-first configuration over the offline BSON double', async () => {
  // A BSON double is not a native MongoDB or Azure certification.
  const db = calendarMemory();
  const client = Object.assign(db.commandSource, {
    db: () => db.store.db, appendMetadata: () => undefined,
  }) as unknown as MongoClient;
  const persistence = await createPersistenceBundle(client, 'offline-calendar-canvas-integration',
    DEFAULT_BUDGETS, 'offline-calendar-canvas-executor');
  const calendar = calendarFixture(undefined, persistence, {
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxAttempts: 1, shutdownDrainMs: 50 }, voice: true,
  });
  const f = await integratedFixture(calendar);
  try {
    calendar.modelWires.push(loadWire('calendar_list_events'), skillWire('call_tool', {
      plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
        timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20,
      },
    }, 'memory-agenda-read'), textWire('No events in that range.'));
    const peer = await f.connect('live', null, 'calendar-memory-0001');
    const ref = await f.startReply(peer, 'List my calendar for November 3.', 'memory-agenda-speech');
    await f.finishReply(peer, ref);
    const sessionId = f.latest().context.response.conversationId!;
    await f.end(peer);
    const frames = peer.events().filter(e => e.type === 'calendar.frame');
    const viewFrame = frames.find(e => e.event.type === 'calendar-view');
    if (!viewFrame || viewFrame.event.type !== 'calendar-view') throw new Error('Missing agenda frame');
    const view = calendarViewSchema.parse(viewFrame.event.view);
    expect(view).toMatchObject({ kind: 'agenda', entries: [] });
    await vi.waitFor(async () => {
      const saved = await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
      const assistant = saved.body.items.find((m: { role: string; turnId: string }) =>
        m.role === 'assistant' && m.turnId === ref.turnId);
      expect(assistant?.calendarView).toEqual(viewFrame.event.view);
    }, { timeout: 5000 });
    expect(calendar.effects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(0);
  } finally { await f.close(); }
});

const agendas = [
  { name: 'timed details', payload: { timeZone: 'Etc/UTC', items: [{ id: 'evt_timed_1',
    summary: '<script>Not executable</script>', status: 'confirmed',
    start: { dateTime: '2026-11-03T10:00:00Z' }, end: { dateTime: '2026-11-03T11:00:00Z' },
    location: 'Room 4', description: 'Plain returned details',
    htmlLink: 'https://calendar.google.com/calendar/event?eid=evt_timed_1' }] } },
  { name: 'exclusive all-day span', payload: { timeZone: 'Etc/UTC', items: [{ id: 'evt_allday_1',
    summary: 'Offsite', status: 'confirmed', start: { date: '2026-11-03' }, end: { date: '2026-11-05' } }] } },
  { name: 'more results available', payload: { timeZone: 'Etc/UTC', items: [], nextPageToken: 'opaque-next' } },
  { name: 'missing optional fields', payload: { timeZone: 'Etc/UTC', items: [{ id: 'evt_minimal_1',
    summary: '', status: 'tentative', start: { dateTime: '2026-11-03T12:00:00Z' },
    end: { dateTime: '2026-11-03T12:30:00Z' } }] } },
];

it.each(agendas)('projects $name through the real fetcher and archives the identical view', async row => {
  const calendar = calendarFixture();
  const base = calendar.fetcher.getMockImplementation()!;
  calendar.fetcher.mockImplementation((url, init) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === 'www.googleapis.com' && String(init?.method ?? 'GET').toUpperCase() === 'GET'
      && parsed.pathname.includes('/calendar/v3/calendars/') && parsed.pathname.endsWith('/events')) {
      return Promise.resolve(googleJson(row.payload));
    }
    return base(url, init);
  });
  calendar.modelWires.push(loadWire('calendar_list_events'), skillWire('call_tool', {
    plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
      timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-06T00:00:00Z', maxResults: 20,
    },
  }, `agenda-row-${row.name}`), textWire('Here is your agenda.'));
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, `calendar-agenda-${row.name.slice(0, 12)}`);
    const ref = await f.startReply(peer, 'List my calendar for November 3.', `agenda-speech-${row.name}`);
    await f.finishReply(peer, ref);
    const sessionId = f.latest().context.response.conversationId!;
    await f.end(peer);
    const frames = peer.events().filter(e => e.type === 'calendar.frame');
    const viewFrame = frames.find(e => e.event.type === 'calendar-view');
    if (!viewFrame || viewFrame.event.type !== 'calendar-view') throw new Error('Missing agenda frame');
    const view = calendarViewSchema.parse(viewFrame.event.view);
    expect(view.kind).toBe('agenda');
    const saved = await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
    const assistant = saved.body.items.find((m: { role: string; turnId: string }) =>
      m.role === 'assistant' && m.turnId === ref.turnId);
    expect(assistant.calendarView).toEqual(viewFrame.event.view);
    expect(Buffer.byteLength(JSON.stringify(view), 'utf8')).toBeLessThanOrEqual(CALENDAR_VIEW_MAX_BYTES);
    if (view.kind !== 'agenda') throw new Error('Expected agenda view');
    expect(view.entries).toHaveLength(row.name === 'more results available' ? 0 : 1);
    if (row.name === 'timed details') {
      expect(view.entries[0]).toMatchObject({ eventId: 'evt_timed_1', summary: '<script>Not executable</script>',
        allDay: false, status: 'confirmed', location: 'Room 4', description: 'Plain returned details' });
      expect(view.entries[0].start).toBe('2026-11-03T10:00:00Z');
    }
    if (row.name === 'exclusive all-day span') {
      expect(view.entries[0]).toMatchObject({ eventId: 'evt_allday_1', summary: 'Offsite', allDay: true });
      expect(view.entries[0].start).toBe('2026-11-03');
      expect(view.entries[0].end).toBe('2026-11-05'); // exclusive end preserved as a date string
    }
    if (row.name === 'more results available') {
      // The runtime re-issues the provider token as its own bounded opaque continuation
      // token rather than passing 'opaque-next' through verbatim.
      expect(typeof view.nextPageToken).toBe('string');
      expect(view.nextPageToken!.length).toBeGreaterThan(0);
      expect(view.truncated).toBe(true);
      // No entries were actually dropped by the provider page (it returned none), so
      // incompleteness is carried by the labelled continuation token alone.
      expect(view.entriesOmitted).toBe(0);
    }
    if (row.name === 'missing optional fields') {
      expect(view.entries[0]).toMatchObject({ eventId: 'evt_minimal_1', summary: '', allDay: false,
        status: 'tentative' });
      expect(view.entries[0]).not.toHaveProperty('location');
      expect(view.entries[0]).not.toHaveProperty('description');
    }
    expect(calendar.effects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(0);
  } finally { await f.close(); }
});

type ProposalFacts = { proposalId: string; intentId: string; revision: number;
  action: Record<string, unknown>; target: { calendarId: string } };

/** Disclose one real proposal over the admitted transport and return its stored facts. */
async function discloseProposal(calendar: ReturnType<typeof calendarFixture>,
  f: Awaited<ReturnType<typeof integratedFixture>>, peer: LivePeer, key: string) {
  calendar.modelWires.push(loadWire('calendar_create_event'), createWire(event()));
  const reply = await f.startReply(peer, 'create the event', `proposal-speech-${key}`);
  await f.finishReply(peer, reply);
  const sessionId = f.latest().context.response.conversationId!;
  const proposal = await calendar.currentProposal(sessionId);
  if (!proposal) throw new Error('Expected current proposal');
  const control = { type: 'calendar.confirm' as const, proposalId: proposal.proposalId,
    proposalRevision: proposal.revision, answer: { kind: 'accept' as const } };
  return { reply, sessionId, proposal: proposal as unknown as ProposalFacts, control };
}

it.each(['speech', 'button', 'duplicate-button'] as const)(
  'confirms the same proposal once using %s', async channel => {
    const calendar = calendarFixture();
    const posts = countCreates(calendar);
    const f = await integratedFixture(calendar);
    try {
      const peer = await f.connect('live', null, `calendar-confirm-${channel}`);
      const { sessionId, proposal, control } = await discloseProposal(calendar, f, peer, channel);
      expect(posts.creates).toBe(0);
      const disclosed = peer.events().find(e => e.type === 'calendar.frame'
        && e.event.type === 'calendar-clarification');
      expect(disclosed).toMatchObject({ type: 'calendar.frame', event: {
        type: 'calendar-clarification', view: { kind: 'proposal', proposalId: proposal.proposalId,
          intentId: proposal.intentId, revision: proposal.revision, action: proposal.action,
          target: { calendarId: proposal.target.calendarId } },
      } });
      const count = vi.mocked(f.latest().tts.connection.speak).mock.calls.length;
      let reply: { turnId: string; responseId: string };
      if (channel === 'speech') reply = await f.startReply(peer, 'yes', 'confirmation-speech-1');
      else {
        peer.control(control);
        if (channel === 'duplicate-button') peer.control(control);
        reply = await f.awaitReply(peer, count);
      }
      await f.finishReply(peer, reply);
      const result = peer.events().findLast(e => e.type === 'calendar.frame'
        && e.turnId === reply.turnId && e.event.type === 'calendar-view');
      expect(result).toMatchObject({ type: 'calendar.frame', event: { type: 'calendar-view', view: {
        kind: 'outcome', proposalId: proposal.proposalId, intentId: proposal.intentId,
        state: 'succeeded', receipt: { durable: true },
      } } });
      expect(posts.creates).toBe(1);
      expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(1);
      expect(calendar.modelBodies).toHaveLength(2);
      await f.end(peer);
      const history = await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
      expect(history.body.items.some((m: { calendarView?: { kind: string; state?: string } }) =>
        m.calendarView?.kind === 'outcome' && m.calendarView.state === 'succeeded')).toBe(true);
      expect(posts.creates).toBe(1);
    } finally { await f.close(); }
  },
);

it.each(['button-first', 'speech-first'] as const)(
  'executes exactly one write when %s confirmation inputs race', async order => {
    const calendar = calendarFixture();
    const posts = countCreates(calendar);
    const f = await integratedFixture(calendar);
    try {
      const peer = await f.connect('live', null, `calendar-race-${order}`);
      const { sessionId, proposal, control } = await discloseProposal(calendar, f, peer, order);
      const count = vi.mocked(f.latest().tts.connection.speak).mock.calls.length;
      const speech = () => f.latest().stt.events.push({ type: 'end-of-turn',
        providerTurnId: 'race-speech-1', text: 'yes' });
      if (order === 'button-first') { peer.control(control); speech(); }
      else { speech(); peer.control(control); }
      const reply = await f.awaitReply(peer, count);
      await f.finishReply(peer, reply);
      expect(posts.creates).toBe(1);
      expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(1);
      const operations = peer.events().filter(e => e.type === 'calendar.frame'
        && e.event.type === 'calendar-view' && e.event.view.kind === 'outcome');
      expect(operations).toHaveLength(1);
      expect(peer.events().findLast(e => e.type === 'calendar.frame'
        && e.turnId === reply.turnId && e.event.type === 'calendar-view')!.event).toMatchObject({ view: {
          kind: 'outcome', proposalId: proposal.proposalId, state: 'succeeded',
        } });
      // The losing input resolves without a second write, and the proposal is consumed.
      const modelCalls = calendar.modelBodies.length;
      await vi.waitFor(async () => expect(await calendar.currentProposal(sessionId)).toBeNull());
      f.latest().stt.events.push({ type: 'end-of-turn', providerTurnId: 'race-speech-1', text: 'yes' });
      peer.control(control);
      // Replay after settlement: the durable proposal is consumed, so nothing new is authored.
      await vi.waitFor(async () => expect(await calendar.currentProposal(sessionId)).toBeNull());
      expect(posts.creates).toBe(1);
      expect(calendar.modelBodies).toHaveLength(modelCalls);
      expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    } finally { await f.close(); }
  },
);

it('keeps dictation draft-only and refuses live Calendar controls', async () => {
  const calendar = calendarFixture();
  const posts = countCreates(calendar);
  const f = await integratedFixture(calendar);
  try {
    const dictation = await f.connect('dictation', null, 'calendar-dictation-0001');
    const connection = f.latest();
    dictation.pcm();
    connection.stt.events.push({ type: 'final', segmentId: 'one', text: 'create the event' });
    await dictation.wait('dictation.final');
    dictation.control({ type: 'calendar.confirm', proposalId: 'proposal-none', proposalRevision: 1,
      answer: { kind: 'accept' } });
    await vi.waitFor(() => expect(dictation.events.some(e => e.type === 'session.error')).toBe(true));
    expect(dictation.events.some(e => e.type === 'dictation.final')).toBe(true); // stays a draft
    expect(connection.stt.connection.finalize).not.toHaveBeenCalled();
    expect(calendar.modelBodies).toHaveLength(0);
    expect(calendar.effects).toHaveLength(0);
    expect(posts.creates).toBe(0);
    expect(dictation.events.some(e => e.type === 'calendar.frame')).toBe(false);
  } finally { await f.close(); }
});

it('keeps one archived agenda across live exit, text, reload and another chat', async () => {
  const calendar = calendarFixture();
  const f = await integratedFixture(calendar);
  try {
    calendar.modelWires.push(loadWire('calendar_list_events'), skillWire('call_tool', {
      plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
        timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20,
      },
    }, 'continuity-read'), textWire('No events in that range.'));
    const peer = await f.connect('live', null, 'calendar-continuity-0001');
    const ref = await f.startReply(peer, 'List my calendar for November 3.', 'continuity-speech');
    await f.finishReply(peer, ref);
    const sessionId = f.latest().context.response.conversationId!;
    await f.end(peer);
    const frames = peer.events().filter(e => e.type === 'calendar.frame');
    const viewFrame = frames.find(e => e.event.type === 'calendar-view');
    if (!viewFrame || viewFrame.event.type !== 'calendar-view') throw new Error('Missing agenda frame');
    const first = await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
    const archived = first.body.items.find((m: { role: string; turnId: string }) =>
      m.role === 'assistant' && m.turnId === ref.turnId);
    expect(archived.calendarView).toEqual(viewFrame.event.view);
    const effectsAfterLive = calendar.effects.length;
    const modelsAfterLive = calendar.modelBodies.length;
    // Reloading history is a pure read: no replay of calendar work or inference.
    const reload = await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
    expect(reload.body.items.find((m: { role: string; turnId: string }) =>
      m.role === 'assistant' && m.turnId === ref.turnId).calendarView).toEqual(viewFrame.event.view);
    expect(calendar.effects).toHaveLength(effectsAfterLive);
    expect(calendar.modelBodies).toHaveLength(modelsAfterLive);
    // Text in the same chat keeps the snapshot and adds no calendar work.
    calendar.modelWires.push(textWire('You are welcome.'));
    await f.text(sessionId, 'Thanks.', 'continuity-text-0001');
    const afterText = await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
    expect(afterText.body.items.find((m: { role: string; turnId: string }) =>
      m.role === 'assistant' && m.turnId === ref.turnId).calendarView).toEqual(viewFrame.event.view);
    expect(calendar.effects).toHaveLength(effectsAfterLive);
    // A different chat must not inherit the first chat's calendar frames.
    const other = await f.connect('live', null, 'calendar-continuity-other');
    expect(other.events().some(e => e.type === 'calendar.frame')).toBe(false);
    await f.end(other);
  } finally { await f.close(); }
});

const warning = (peer: LivePeer, code: string) => peer.events().some(e =>
  e.type === 'session.warning' && e.code === code);
const lastView = (peer: LivePeer, turnId?: string) => peer.events().findLast(e =>
  e.type === 'calendar.frame' && e.event.type === 'calendar-view'
  && (turnId === undefined || e.turnId === turnId));

it('rejects the old proposal revision without consuming the current proposal', async () => {
  const calendar = calendarFixture();
  const posts = countCreates(calendar);
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-stale-revision');
    const { sessionId, proposal, control } = await discloseProposal(calendar, f, peer, 'stale');
    peer.control({ ...control, proposalRevision: proposal.revision + 1 });
    await vi.waitFor(() => expect(warning(peer, 'INVALID_VOICE_CONTROL')).toBe(true));
    expect(posts.creates).toBe(0);
    const current = await calendar.currentProposal(sessionId);
    expect(current?.proposalId).toBe(proposal.proposalId);
    expect(current?.revision).toBe(proposal.revision);
  } finally { await f.close(); }
});

it('expires a once-disclosed proposal before a late confirmation', async () => {
  const calendar = calendarFixture();
  const posts = countCreates(calendar);
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-expiry');
    await discloseProposal(calendar, f, peer, 'expiry');
    calendar.advance(600001); // never wait six real minutes
    const ref = await f.startReply(peer, 'yes', 'expiry-yes');
    await f.finishReply(peer, ref);
    expect(posts.creates).toBe(0);
    expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    const succeeded = peer.events().some(e => e.type === 'calendar.frame'
      && e.event.type === 'calendar-view' && e.event.view.kind === 'outcome'
      && e.event.view.state === 'succeeded');
    expect(succeeded).toBe(false);
    const view = lastView(peer, ref.turnId);
    if (view && view.event.type === 'calendar-view') {
      // Truthful expiry disclosure; never a success and never a silent write.
      expect(view.event.view.kind === 'notice' ? [ 'expired', 'failed', 'unavailable' ]
        : [view.event.view.kind === 'outcome' ? view.event.view.state : 'proposal'])
        .not.toContain('succeeded');
    }
  } finally { await f.close(); }
});

it('cannot approve replaced details with an old proposal reference', async () => {
  const calendar = calendarFixture();
  const posts = countCreates(calendar);
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-replaced');
    const { sessionId, control } = await discloseProposal(calendar, f, peer, 'replaced');
    calendar.modelWires.push(loadWire('calendar_create_event'),
      createWire(event({ summary: 'Revised Planning' })));
    const second = await f.startReply(peer, 'change the title to Revised Planning', 'replaced-2');
    await f.finishReply(peer, second);
    const revised = await calendar.currentProposal(sessionId);
    expect(revised).not.toBeNull();
    expect(revised!.proposalId).not.toBe(control.proposalId);
    peer.control(control);
    await vi.waitFor(() => expect(warning(peer, 'INVALID_VOICE_CONTROL')).toBe(true));
    expect(posts.creates).toBe(0);
    expect((await calendar.currentProposal(sessionId))!.proposalId).toBe(revised!.proposalId);
  } finally { await f.close(); }
});

it('rejects a proposal from another conversation', async () => {
  const calendar = calendarFixture();
  const posts = countCreates(calendar);
  const f = await integratedFixture(calendar);
  try {
    const a = await f.connect('live', null, 'calendar-cross-a');
    const { control } = await discloseProposal(calendar, f, a, 'cross-a');
    await f.end(a);
    const b = await f.connect('live', null, 'calendar-cross-b');
    b.control(control);
    await vi.waitFor(() => expect(warning(b, 'INVALID_VOICE_CONTROL')).toBe(true));
    expect(posts.creates).toBe(0);
    expect(b.events().some(e => e.type === 'calendar.frame')).toBe(false);
  } finally { await f.close(); }
});

it('does not approve an undisclosed spoken yes', async () => {
  const calendar = calendarFixture();
  const posts = countCreates(calendar);
  const f = await integratedFixture(calendar);
  try {
    calendar.modelWires.push(textWire('There is nothing to confirm yet.'));
    const peer = await f.connect('live', null, 'calendar-undisclosed');
    const ref = await f.startReply(peer, 'yes', 'undisclosed-yes');
    await f.finishReply(peer, ref);
    expect(posts.creates).toBe(0);
    expect(peer.events().some(e => e.type === 'calendar.frame'
      && e.event.type === 'calendar-view' && e.event.view.kind === 'outcome')).toBe(false);
    expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(0);
  } finally { await f.close(); }
});

it('rejects by speech without creating', async () => {
  const calendar = calendarFixture();
  const posts = countCreates(calendar);
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-reject-speech');
    const { sessionId } = await discloseProposal(calendar, f, peer, 'reject-speech');
    const ref = await f.startReply(peer, 'cancel', 'reject-speech-2');
    await f.finishReply(peer, ref);
    expect(posts.creates).toBe(0);
    const view = lastView(peer, ref.turnId);
    expect(view?.event).toMatchObject({ view: { kind: 'notice', state: 'cancelled' } });
    expect(await calendar.currentProposal(sessionId)).toBeNull();
  } finally { await f.close(); }
});

it('rejects by button without creating', async () => {
  const calendar = calendarFixture();
  const posts = countCreates(calendar);
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-reject-button');
    const { proposal, control } = await discloseProposal(calendar, f, peer, 'reject-button');
    const count = vi.mocked(f.latest().tts.connection.speak).mock.calls.length;
    peer.control({ type: 'calendar.confirm', proposalId: proposal.proposalId,
      proposalRevision: proposal.revision, answer: { kind: 'reject' } });
    const ref = await f.awaitReply(peer, count);
    await f.finishReply(peer, ref);
    expect(posts.creates).toBe(0);
    expect(lastView(peer, ref.turnId)?.event).toMatchObject({ view: { kind: 'notice', state: 'cancelled' } });
    expect(control.answer.kind).toBe('accept');
  } finally { await f.close(); }
});

it('does not call a denied target a successful creation', async () => {
  const calendar = calendarFixture();
  const posts = countCreates(calendar);
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-denied');
    const { proposal, control } = await discloseProposal(calendar, f, peer, 'denied');
    await calendar.setRole(proposal.target.calendarId, 'reader');
    calendar.modelWires.push(textWire('Permission to schedule on this calendar was denied.'));
    const count = vi.mocked(f.latest().tts.connection.speak).mock.calls.length;
    peer.control(control);
    const ref = await f.awaitReply(peer, count);
    await f.finishReply(peer, ref);
    expect(posts.creates).toBe(0);
    const succeeded = peer.events().some(e => e.type === 'calendar.frame'
      && e.event.type === 'calendar-view' && e.event.view.kind === 'outcome'
      && e.event.view.state === 'succeeded');
    expect(succeeded).toBe(false);
  } finally { await f.close(); }
});

it('shows a definitely failed create without a receipt', async () => {
  const calendar = calendarFixture();
  const base = calendar.fetcher.getMockImplementation()!;
  calendar.fetcher.mockImplementation((url, init) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.includes('/calendar/v3/calendars/') && parsed.pathname.endsWith('/events')
      && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
      return Promise.resolve(googleJson({ error: { code: 400, message: 'Invalid request',
        errors: [{ reason: 'badRequest', domain: 'global' }] } }, { status: 400 }));
    }
    return base(url, init);
  });
  const posts = countCreates(calendar);
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-failed-create');
    const { control } = await discloseProposal(calendar, f, peer, 'failed-create');
    const count = vi.mocked(f.latest().tts.connection.speak).mock.calls.length;
    peer.control(control);
    const ref = await f.awaitReply(peer, count);
    await f.finishReply(peer, ref);
    expect(posts.creates).toBe(1); // one attempted provider POST
    const outcome = lastView(peer, ref.turnId);
    expect(outcome?.event).toMatchObject({ view: { kind: 'outcome', state: 'definitely-failed',
      receipt: null } });
  } finally { await f.close(); }
});

it('retains an unknown write outcome without retrying it', async () => {
  const calendar = calendarFixture();
  const base = calendar.fetcher.getMockImplementation()!;
  calendar.fetcher.mockImplementation((url, init) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.includes('/calendar/v3/calendars/') && parsed.pathname.endsWith('/events')
      && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
      return Promise.reject(new TypeError('network connection reset'));
    }
    return base(url, init);
  });
  const posts = countCreates(calendar);
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-unknown-write');
    const { control } = await discloseProposal(calendar, f, peer, 'unknown-write');
    const count = vi.mocked(f.latest().tts.connection.speak).mock.calls.length;
    peer.control(control);
    const ref = await f.awaitReply(peer, count);
    await f.finishReply(peer, ref);
    expect(posts.creates).toBe(1); // exactly one attempt, no automatic second POST
    const outcome = lastView(peer, ref.turnId);
    expect(outcome?.event).toMatchObject({ view: { kind: 'outcome', state: 'unknown', receipt: null } });
    await vi.waitFor(() => expect(posts.creates).toBe(1));
  } finally { await f.close(); }
});

it('records one durable operation bound to the shared proposal for button confirmation', async () => {
  const calendar = calendarFixture();
  const posts = countCreates(calendar);
  const f = await integratedFixture(calendar);
  try {
    const peer = await f.connect('live', null, 'calendar-shared-authority');
    const { sessionId, proposal, control } = await discloseProposal(calendar, f, peer, 'shared');
    const count = vi.mocked(f.latest().tts.connection.speak).mock.calls.length;
    peer.control(control);
    const ref = await f.awaitReply(peer, count);
    await f.finishReply(peer, ref);
    const operation = await calendar.p.calendarOperationsV2.getByTurn(
      calendar.identity.userId, sessionId, ref.turnId);
    expect(operation).toMatchObject({ state: 'succeeded', intentId: proposal.intentId,
      authorization: { proposalId: proposal.proposalId } });
    expect(posts.creates).toBe(1);
    expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    expect(await calendar.currentProposal(sessionId)).toBeNull();
    const saved = await request(f.url).get(`/api/sessions/${sessionId}/messages`).expect(200);
    expect(saved.body.items.find((m: { role: string; turnId: string }) =>
      m.role === 'assistant' && m.turnId === ref.turnId).calendarView).toMatchObject({
      kind: 'outcome', proposalId: proposal.proposalId, intentId: proposal.intentId,
      state: 'succeeded', receipt: { durable: true },
    });
  } finally { await f.close(); }
});

it('excludes live turns from the public HTTP stream and rejects calendar controls as text', async () => {
  const calendar = calendarFixture();
  const f = await integratedFixture(calendar);
  try {
    calendar.modelWires.push(textWire('Hello.'));
    const peer = await f.connect('live', null, 'calendar-live-exclusion');
    const ref = await f.startReply(peer, 'Hello', 'exclusion-speech');
    await f.finishReply(peer, ref);
    const sessionId = f.latest().context.response.conversationId!;
    await request(f.url).get(`/api/sessions/${sessionId}/turns/${ref.turnId}/stream`).expect(404);
    await request(f.url).post(`/api/sessions/${sessionId}/turns`).set('Origin', origin).send({
      sessionId, content: 'yes', idempotencyKey: 'exclusion-text-0001', calendarProtocol: 3,
      type: 'calendar.confirm', proposalId: 'proposal-none', proposalRevision: 1,
      answer: { kind: 'accept' },
    }).expect(400);
    expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    expect(calendar.modelBodies).toHaveLength(1);
  } finally { await f.close(); }
});
