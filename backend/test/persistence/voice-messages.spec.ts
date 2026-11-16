/**
 * ============================================================================
 * FILE: voice-messages.spec.ts
 * LOCATION: backend/test/persistence/voice-messages.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for internal voice message filtering and context pagination.
 *
 * ROLE IN PROJECT:
 *    Ensures private/internal turns are excluded from public navigation while
 *    remaining accessible to internal context assembly.
 *
 * KEY COMPONENTS:
 *    - Public list filtering: verifies $ne: 'internal' filter and field stripping.
 *    - Context list: verifies raw bounded message access without visibility filtering.
 *    - First live turn title: verifies the provided title is kept for voice chats.
 * ============================================================================
 */

import type { Db } from 'mongodb';
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { RecordStore } from '../../src/persistence/store.js';
import { key } from '../../src/persistence/records.js';
import { message, session } from './fixtures.js';
import { agendaFixture } from '../contracts/calendar-view.fixture.js';

function fixture() {
  const store = new RecordStore({} as Db, 1000);
  const originals = [message(2), message(0)];
  const toArray = vi.fn(async () => originals.map(record => ({
    ...record, _id: key('message', 'u1', 's1', record.messageId), _revision: 0,
  })));
  const cursor = { sort: vi.fn(), limit: vi.fn(), toArray };
  cursor.sort.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  const find = vi.fn((_filter: unknown, _options: unknown) => cursor);
  vi.spyOn(store, 'collection').mockReturnValue({ find } as unknown as ReturnType<RecordStore['collection']>);
  return { repository: new MongoMessages(store, DEFAULT_BUDGETS), find, cursor };
}

it('filters internal records before public pagination and strips private fields', async () => {
  const f = fixture();
  const result = await f.repository.list('u1', 's1', { limit: 1, cursor: null });
  expect(f.find.mock.calls[0]).toEqual([
    expect.objectContaining({ userId: 'u1', sessionId: 's1', $and: expect.any(Array) }),
    { maxTimeMS: 1000 },
  ]);
  expect(f.cursor.sort).toHaveBeenCalledWith({ sequence: -1, messageId: -1 });
  expect(f.cursor.limit).toHaveBeenCalledWith(2);
  expect(result.items[0]).not.toHaveProperty('visibility');
  expect(result.items[0]).not.toHaveProperty('attemptId');
  await f.repository.list('u1', 's1', { limit: 1, cursor: result.nextCursor });
  expect(f.find.mock.calls[1]?.[0]).toMatchObject({ $and: expect.any(Array),
    $or: [{ sequence: { $lt: 2 } }, { sequence: 2, messageId: { $lt: 'm2' } }] });
});

it('provides original bounded records for context without a visibility filter', async () => {
  const f = fixture();
  const result = await f.repository.listForContext('u1', 's1', { limit: 2, cursor: null });
  expect(f.find.mock.calls[0]?.[0]).toEqual({ userId: 'u1', sessionId: 's1' });
  expect(result.items.map(item => item.sequence)).toEqual([0, 2]);
  expect(result.items[1]).toHaveProperty('attemptId', 'a1');
  expect(result.olderAvailable).toBe(false);
  expect(result.nextCursor).toBeNull();
});

it('keeps a first-live-turn title without changing existing session semantics', async () => {
  const repository = new MongoSessions(new RecordStore({} as Db, 1000), DEFAULT_BUDGETS);
  const create = vi.spyOn(repository, 'createIfAbsent').mockResolvedValue(session());
  await repository.createForInternalTurn({ ...session(), title: 'Hey aurvin can you check' });
  expect(create).toHaveBeenCalledWith({ ...session(), title: 'Hey aurvin can you check' });
});

it.each(['text', 'live'] as const)('hydrates a %s calendar snapshot in the existing message page', async mode => {
  const store = new RecordStore({} as Db, 1000);
  const calendarView = agendaFixture();
  const raw = { ...message(2), role: 'assistant' as const, completionStatus: 'completed' as const,
    mode, content: 'Saved calendar answer.', calendarView,
    ...(mode === 'live' ? { visibility: 'internal' as const, voiceSessionId: 'voice-1' } : {}) };
  const cursor = { sort: vi.fn(), limit: vi.fn(), toArray: vi.fn(async () => [{ ...raw, _id: 'original', _revision: 0 }]) };
  cursor.sort.mockReturnValue(cursor); cursor.limit.mockReturnValue(cursor);
  vi.spyOn(store, 'collection').mockReturnValue({ find: vi.fn(() => cursor) } as unknown as ReturnType<RecordStore['collection']>);
  const found = await new MongoMessages(store, DEFAULT_BUDGETS).list('u1', 's1', { limit: 10, cursor: null });
  expect(found.items[0].calendarView).toEqual(calendarView);
  expect(found.items[0]).not.toHaveProperty('visibility');
  expect(found.items[0]).not.toHaveProperty('sourceProvenance');
  expect(found.items[0].content).toBe(mode === 'live' ? '' : raw.content);
  expect(cursor.toArray).toHaveBeenCalledTimes(1);
});

it('includes voiceSessionId, duration, transcripts, and mode on visible voice summary message', async () => {
  const store = new RecordStore({} as Db, 1000);
  const voiceMsg = {
    ...message(1),
    mode: 'live' as const,
    voiceSessionId: 'voice-1',
    voiceDurationSeconds: 5,
    voiceTranscripts: [
      { role: 'user' as const, content: 'Hello voice' },
      { role: 'assistant' as const, content: 'Hello there' },
    ],
  };
  const toArray = vi.fn(async () => [{ ...voiceMsg, _id: key('message', 'u1', 's1', voiceMsg.messageId), _revision: 0 }]);
  const cursor = { sort: vi.fn(), limit: vi.fn(), toArray };
  cursor.sort.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  vi.spyOn(store, 'collection').mockReturnValue({ find: vi.fn(() => cursor) } as any);
  const repository = new MongoMessages(store, DEFAULT_BUDGETS);
  const result = await repository.list('u1', 's1', { limit: 10, cursor: null });
  expect(result.items[0]).toMatchObject({
    mode: 'live',
    voiceSessionId: 'voice-1',
    voiceDurationSeconds: 5,
    voiceTranscripts: [
      { role: 'user', content: 'Hello voice' },
      { role: 'assistant', content: 'Hello there' },
    ],
  });
});

it('projects a durable attributed live message without copying an aggregate or inventing sequence', async () => {
  const store = new RecordStore({} as Db, 1000);
  const raw = { ...message(2), role: 'assistant' as const, completionStatus: 'completed' as const,
    visibility: 'internal' as const, mode: 'live' as const, voiceSessionId: 'voice-1', content: 'Saved answer.' };
  const cursor = { sort: vi.fn(), limit: vi.fn(), toArray: vi.fn(async () => [{ ...raw, _id: 'original', _revision: 0 }]) };
  cursor.sort.mockReturnValue(cursor); cursor.limit.mockReturnValue(cursor);
  vi.spyOn(store, 'collection').mockReturnValue({ find: vi.fn(() => cursor) } as unknown as ReturnType<RecordStore['collection']>);
  const repository = new MongoMessages(store, DEFAULT_BUDGETS);
  const found = await repository.list('u1', 's1', { limit: 10, cursor: null });
  expect(found.items[0]).toMatchObject({ sequence: raw.sequence, messageId: raw.messageId, content: '',
    voiceSessionId: 'voice-1', voiceTranscripts: [{ role: 'assistant', content: 'Saved answer.', createdAt: raw.createdAt }] });
  expect(found.items[0]).not.toHaveProperty('attemptId');
  expect((await repository.listForContext('u1', 's1', { limit: 10, cursor: null })).items[0].content).toBe('Saved answer.');
});

it('pages more than 50 durable voice originals without a session-wide byte cap or truncation', async () => {
  const store = new RecordStore({} as Db, 1000);
  const originals = Array.from({ length: 61 }, (_, i) => ({ ...message(i + 1), role: 'assistant' as const,
    completionStatus: 'completed' as const, mode: 'live' as const, visibility: 'internal' as const,
    voiceSessionId: 'voice-1', content: `Turn ${i} ` + 'x'.repeat(4000), _id: `record-${i}`, _revision: 0 }));
  let before = Infinity, limit = 0;
  const cursor = { sort: vi.fn(), limit: vi.fn((n: number) => { limit = n; return cursor; }),
    toArray: async () => originals.filter(r => r.sequence < before).sort((a, b) => b.sequence - a.sequence).slice(0, limit) };
  cursor.sort.mockReturnValue(cursor);
  const find = vi.fn((filter: { $or?: Array<{ sequence: { $lt?: number } }> }) => {
    before = filter.$or?.[0].sequence.$lt ?? Infinity; return cursor;
  });
  vi.spyOn(store, 'collection').mockReturnValue({ find } as unknown as ReturnType<RecordStore['collection']>);
  const repository = new MongoMessages(store, DEFAULT_BUDGETS), found = [];
  let next: string | null = null;
  do {
    const page = await repository.list('u1', 's1', { limit: 20, cursor: next });
    found.push(...page.items); next = page.nextCursor;
  } while (next);
  expect(found).toHaveLength(61);
  expect(new Set(found.map(r => r.messageId)).size).toBe(61);
  expect(found.reduce((n, r) => n + r.voiceTranscripts![0].content.length, 0)).toBeGreaterThan(65536);
  expect(found.every(r => r.voiceTranscripts?.length === 1 && r.content === '')).toBe(true);
  expect(found.map(r => r.sequence).sort((a, b) => a - b)).toEqual(originals.map(r => r.sequence));
});


it('projects archived visuals with originating voice messages', async () => {
  const store = new RecordStore({} as Db, 1000);
  const visual = { responseId: 'response-1', ordinal: 0, kind: 'mermaid' as const,
    subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
  const raw = {
    ...message(2),
    role: 'assistant' as const,
    completionStatus: 'completed' as const,
    visibility: 'internal' as const,
    mode: 'live' as const,
    voiceSessionId: 'voice-1',
    content: 'Saved answer.',
    canvasArtifacts: [visual],
  };
  const cursor = { sort: vi.fn(), limit: vi.fn(), toArray: vi.fn(async () => [{ ...raw, _id: 'original', _revision: 0 }]) };
  cursor.sort.mockReturnValue(cursor); cursor.limit.mockReturnValue(cursor);
  vi.spyOn(store, 'collection').mockReturnValue({ find: vi.fn(() => cursor) } as unknown as ReturnType<RecordStore['collection']>);
  const repository = new MongoMessages(store, DEFAULT_BUDGETS);
  const found = await repository.list('u1', 's1', { limit: 10, cursor: null });

  expect(found.items[0]).toMatchObject({
    messageId: raw.messageId, turnId: raw.turnId, sequence: raw.sequence,
    content: '', canvasArtifacts: raw.canvasArtifacts,
    voiceTranscripts: [{ role: 'assistant', content: raw.content, createdAt: raw.createdAt }],
  });
  expect(found.items[0]).not.toHaveProperty('attemptId');
  expect(found.items[0].voiceTranscripts?.[0].content).not.toContain('flowchart');
  expect((await repository.listForContext('u1', 's1', { limit: 10, cursor: null })).items[0].canvasArtifacts).toEqual([visual]);
});

it('projects artifact-only interrupted assistant and handles legacy records without artifacts', async () => {
  const store = new RecordStore({} as Db, 1000);
  const visual = { responseId: 'response-1', ordinal: 0, kind: 'mermaid' as const,
    subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
  const interrupted = {
    ...message(3),
    role: 'assistant' as const,
    completionStatus: 'interrupted' as const,
    visibility: 'internal' as const,
    mode: 'live' as const,
    voiceSessionId: 'voice-1',
    content: '',
    canvasArtifacts: [visual],
  };
  const legacy = {
    ...message(2),
    role: 'assistant' as const,
    completionStatus: 'completed' as const,
    visibility: 'internal' as const,
    mode: 'live' as const,
    voiceSessionId: 'voice-1',
    content: 'Legacy speech.',
  };
  const cursor = {
    sort: vi.fn(),
    limit: vi.fn(),
    toArray: vi.fn(async () => [
      { ...interrupted, _id: 'doc-3', _revision: 0 },
      { ...legacy, _id: 'doc-2', _revision: 0 },
    ]),
  };
  cursor.sort.mockReturnValue(cursor); cursor.limit.mockReturnValue(cursor);
  vi.spyOn(store, 'collection').mockReturnValue({ find: vi.fn(() => cursor) } as unknown as ReturnType<RecordStore['collection']>);
  const repository = new MongoMessages(store, DEFAULT_BUDGETS);
  const found = await repository.list('u1', 's1', { limit: 10, cursor: null });

  expect(found.items[0]).toMatchObject({
    messageId: legacy.messageId,
    content: '',
    completionStatus: 'completed',
    voiceTranscripts: [{ role: 'assistant', content: 'Legacy speech.', createdAt: legacy.createdAt }],
  });
  expect(found.items[0].canvasArtifacts).toBeUndefined();
  expect(found.items[1]).toMatchObject({
    messageId: interrupted.messageId,
    content: '',
    completionStatus: 'interrupted',
    canvasArtifacts: [visual],
    voiceTranscripts: [{ role: 'assistant', content: '', createdAt: interrupted.createdAt }],
  });
});

it('rejects artifact-bearing non-live or user records at append trust boundary', async () => {
  const store = new RecordStore({} as Db, 1000);
  const insertConfirmed = vi.spyOn(store, 'insertConfirmed').mockResolvedValue({
    status: 'confirmed',
    record: {} as any,
    revision: 1,
  } as any);
  const repository = new MongoMessages(store, DEFAULT_BUDGETS);
  const visual = { responseId: 'response-1', ordinal: 0, kind: 'mermaid' as const,
    subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };

  // User record with artifacts
  await expect(repository.appendConfirmed({
    ...message(1),
    role: 'user',
    canvasArtifacts: [visual] as any,
  })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  // Non-live assistant record with artifacts
  await expect(repository.appendConfirmed({
    ...message(2),
    role: 'assistant',
    mode: 'text' as any,
    canvasArtifacts: [visual] as any,
  })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  expect(insertConfirmed).not.toHaveBeenCalled();
});
