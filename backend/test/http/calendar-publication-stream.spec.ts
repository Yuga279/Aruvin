/**
 * ============================================================================
 * FILE: calendar-publication-stream.spec.ts
 * LOCATION: backend/test/http/calendar-publication-stream.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify Calendar publication through the real HTTP stream transport.
 * ROLE IN PROJECT:
 *    Connects the offline Calendar runtime, SSE sequencing and visible archive.
 *    Distinguishes existing terminal backpressure from new presentation waits.
 * KEY COMPONENTS:
 *    - Publication: Completion-carried view matches saved assistant state.
 *    - Terminal failure: Display delivery cannot replay authoritative work.
 * ============================================================================
 */
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { ChatStreamTransport } from '../../src/http/chat-stream.transport.js';
import { calendarCompatibleEnvelopeSchema } from '../../src/contracts/calendar-wire.js';
import { calendarViewSchema, CALENDAR_VIEW_MAX_BYTES } from '../../src/contracts/calendar-view.js';
import { fixtureOptions, deferred } from './fixtures.js';
import { calendarFixture, loadWire, skillWire, textWire, createWire }
  from '../runtime/calendar-runtime.fixture.js';
import { event } from '../runtime/calendar-multi-fixture.js';
import { principal } from '../assembly/auth-principal-fixture.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function socket() {
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false, headersSent: false, writableLength: 0,
    setHeader: vi.fn(), flushHeaders() { this.headersSent = true; },
    write: vi.fn((_frame: string) => true), end() { this.writableEnded = true; },
  });
  return { req: req as Request, res: res as unknown as Response, raw: res };
}
function envelopes(writes: string[]) {
  return writes.flatMap(frame => frame.split('\n\n').filter(Boolean).map(line =>
    calendarCompatibleEnvelopeSchema.parse(JSON.parse(line.slice(6)))));
}
function publication(calendar: ReturnType<typeof calendarFixture>) {
  const base = fixtureOptions();
  return new ChatHttpService({ ...base,
    identity: { ...base.identity, resolve: () => calendar.identity },
    principal: () => principal(calendar.identity.userId),
    sessions: calendar.p.sessions, messages: calendar.p.messages,
    runtime: calendar.runtime, currentConfig: calendar.currentConfig,
    executionReservations: calendar.runtime.reservations,
  });
}
function scriptLookup(calendar: ReturnType<typeof calendarFixture>) {
  calendar.modelWires.push(loadWire('calendar_list_events'), skillWire('call_tool', {
    plugin: 'google-calendar', tool: 'calendar_list_events', arguments: {
      timeMin: '2026-11-03T00:00:00Z', timeMax: '2026-11-04T00:00:00Z', maxResults: 20,
    },
  }, 'http-calendar-read'), textWire('No events in that range.'));
}

it('carries the saved agenda on completion after prose without another display frame', async () => {
  const calendar = calendarFixture();
  try {
    await calendar.ready;
    scriptLookup(calendar);
    const ids = await calendar.submit('List my calendar for November 3.');
    const service = publication(calendar), s = socket();
    await new ChatStreamTransport(service).open(ids.sessionId, ids.turnId, s.req, s.res);
    const frames = envelopes(s.raw.write.mock.calls.map(([frame]) => frame));
    const completed = frames.find(f => f.event.type === 'completed');
    if (!completed || completed.event.type !== 'completed') throw new Error('Missing completion');
    const view = calendarViewSchema.parse(completed.event.calendarView);
    expect(view).toMatchObject({ kind: 'agenda', entries: [] });
    expect(Buffer.byteLength(JSON.stringify(view), 'utf8')).toBeLessThanOrEqual(CALENDAR_VIEW_MAX_BYTES);
    expect(frames.some(f => f.event.type === 'calendar-view')).toBe(false);
    const proseAt = frames.findIndex(f => f.event.type === 'delta');
    expect(proseAt).toBeGreaterThanOrEqual(0);
    expect(frames.indexOf(completed)).toBeGreaterThan(proseAt);
    expect(frames.map(f => f.sequence)).toEqual(frames.map((_, index) => index));
    const visible = await service.messages(ids.sessionId, {});
    const assistantMessageId = completed.event.assistantMessageId;
    expect(visible.items.find(m => m.messageId === assistantMessageId)?.calendarView).toEqual(view);
    expect(calendar.modelBodies).toHaveLength(3);
    expect(calendar.effects.filter(e => e.kind === 'list')).toHaveLength(1);
    expect(calendar.runtime.snapshot().active).toBe(0);
  } finally { await calendar.dispose(); }
});

it('honors terminal SSE backpressure without holding authoritative work', async () => {
  const calendar = calendarFixture();
  try {
    await calendar.ready;
    scriptLookup(calendar);
    const ids = await calendar.submit('List my calendar for November 3.');
    const service = publication(calendar), s = socket();
    const transport = new ChatStreamTransport(service);
    const reached = deferred<void>();
    s.raw.write.mockImplementation(frame => {
      if (frame.includes('"type":"completed"')) { reached.resolve(); return false; }
      return true;
    });
    let settled = false;
    const opening = transport.open(ids.sessionId, ids.turnId, s.req, s.res)
      .then(() => { settled = true; });
    try {
      await reached.promise;
      expect(settled).toBe(false);
      expect(calendar.runtime.snapshot().active).toBe(0);
      expect(transport.snapshot().active).toBe(0);
      expect((await calendar.runtime.getTurnStatus(calendar.identity.userId,
        ids.sessionId, ids.turnId)).status).toBe('completed');
      expect(envelopes(s.raw.write.mock.calls.map(([frame]) => frame))
        .some(f => f.event.type === 'delta')).toBe(true);
    } finally {
      s.raw.emit('drain');
      await opening;
    }
  } finally { await calendar.dispose(); }
});

it('publishes the stored proposal action and target on completion and in history', async () => {
  const calendar = calendarFixture();
  try {
    await calendar.ready;
    calendar.setAvailability({ busy: [{ start: '2026-11-03T10:00:00Z',
      end: '2026-11-03T11:00:00Z' }] });
    calendar.modelWires.push(loadWire('calendar_create_event'), createWire(event()),
      textWire('Please confirm the event.'));
    const ids = await calendar.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    const service = publication(calendar), s = socket();
    await new ChatStreamTransport(service).open(ids.sessionId, ids.turnId, s.req, s.res);
    const frames = envelopes(s.raw.write.mock.calls.map(([frame]) => frame));
    const completed = frames.find(f => f.event.type === 'completed');
    if (!completed || completed.event.type !== 'completed') throw new Error('Missing completion');
    const view = calendarViewSchema.parse(completed.event.calendarView);
    const proposal = await calendar.currentProposal(ids.sessionId);
    if (!proposal) throw new Error('Expected a current proposal');
    expect(view).toMatchObject({ kind: 'proposal', proposalId: proposal.proposalId,
      intentId: proposal.intentId, revision: proposal.revision,
      action: { calendarId: 'personal@example.test', summary: 'Planning' },
      target: { calendarId: 'personal@example.test' } });
    const visible = await service.messages(ids.sessionId, {});
    expect(visible.items.find(m => m.messageId === completed.event.assistantMessageId)?.calendarView)
      .toEqual(view);
    expect(frames.some(f => f.event.type === 'calendar-view')).toBe(false);
    expect(calendar.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    expect(calendar.runtime.snapshot().active).toBe(0);
  } finally { await calendar.dispose(); }
});

it('keeps a completed attempt and archive when the terminal SSE write fails', async () => {
  const calendar = calendarFixture();
  try {
    await calendar.ready;
    scriptLookup(calendar);
    const ids = await calendar.submit('List my calendar for November 3.');
    const service = publication(calendar), s = socket();
    const transport = new ChatStreamTransport(service);
    const execute = vi.spyOn(calendar.runtime, 'executeTurn');
    s.raw.write.mockImplementation(frame => {
      if (frame.includes('"type":"completed"')) throw new Error('terminal write failed');
      return true;
    });
    await transport.open(ids.sessionId, ids.turnId, s.req, s.res);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await calendar.runtime.getTurnStatus(calendar.identity.userId,
      ids.sessionId, ids.turnId)).status).toBe('completed');
    const writes = s.raw.write.mock.calls.map(([frame]) => frame);
    expect(writes.some(frame => frame.includes('"type":"delta"'))).toBe(true);
    expect(calendar.runtime.snapshot().active).toBe(0);
    const listed = await calendar.p.messages.list(calendar.identity.userId, ids.sessionId,
      { cursor: null, limit: 20 });
    expect(listed.items.find(m => m.role === 'assistant')?.calendarView)
      .toMatchObject({ kind: 'agenda' });
    const models = calendar.modelBodies.length, effects = calendar.effects.length;
    await service.messages(ids.sessionId, {});
    expect(calendar.modelBodies).toHaveLength(models);
    expect(calendar.effects).toHaveLength(effects);
  } finally { await calendar.dispose(); }
});
