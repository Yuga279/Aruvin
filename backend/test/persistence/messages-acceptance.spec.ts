/**
 * ============================================================================
 * FILE: messages-acceptance.spec.ts
 * LOCATION: backend/test/persistence/messages-acceptance.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for batched transcript acceptance verification in MongoMessages.list.
 *
 * ROLE IN PROJECT:
 *    Verifies that internal user voice messages query metadata in a single bounded
 *    batch query rather than N sequential lookups, isolating scope and turns.
 *
 * KEY COMPONENTS:
 *    - Query count validation: 0 queries for ordinary page, exactly 1 for candidate page.
 *    - Isolation tests: cross-turn and wrong-scope isolation.
 *    - Confirmation tests: unconfirmed acceptance filtering and confirmed retention.
 *    - Bounds, pagination, and persistence error handling checks.
 * ============================================================================
 */

import type { Db } from 'mongodb';
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import type { MessageRecord } from '../../src/contracts/message.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { key } from '../../src/persistence/records.js';
import { RecordStore } from '../../src/persistence/store.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { message } from './fixtures.js';

interface TestFixtureOptions {
  messageDocs?: MessageRecord[];
  metadataDocs?: Array<Record<string, unknown>>;
  metadataFindError?: Error;
}

function createFixture(options: TestFixtureOptions = {}) {
  const store = new RecordStore({} as Db, 1000);

  const messageDocs = options.messageDocs ?? [message(0), message(2)];
  const messagesCursor = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn(async () =>
      [...messageDocs]
        .sort((a, b) => (b.sequence !== a.sequence ? b.sequence - a.sequence : b.messageId.localeCompare(a.messageId)))
        .map((rec) => ({
          ...rec,
          _id: key('message', rec.userId, rec.sessionId, rec.messageId),
          _revision: 0,
        })),
    ),
  };
  const messagesFind = vi.fn((_filter: unknown, _options: unknown) => messagesCursor);

  const metadataDocs = options.metadataDocs ?? [];
  const metadataCursor = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn(async () => {
      if (options.metadataFindError) {
        throw options.metadataFindError;
      }
      return metadataDocs;
    }),
  };
  const metadataFind = vi.fn((_filter: unknown, _options: unknown) => metadataCursor);

  vi.spyOn(store, 'collection').mockImplementation((colName: string) => {
    if (colName === 'messages') {
      return { find: messagesFind } as unknown as ReturnType<RecordStore['collection']>;
    }
    if (colName === 'metadata') {
      return { find: metadataFind } as unknown as ReturnType<RecordStore['collection']>;
    }
    throw new Error(`Unexpected collection in test: ${colName}`);
  });

  const rawSpy = vi.spyOn(store, 'raw');

  const repository = new MongoMessages(store, DEFAULT_BUDGETS);
  return {
    repository,
    messagesFind,
    messagesCursor,
    metadataFind,
    metadataCursor,
    rawSpy,
  };
}

function internalUserMessage(sequence: number, turnId = `t${sequence}`, messageId = `m${sequence}`): MessageRecord {
  return {
    ...message(sequence),
    messageId,
    turnId,
    role: 'user',
    visibility: 'internal',
    mode: 'live',
    voiceSessionId: 'voice-session-1',
    completionStatus: 'accepted',
    content: `User voice turn ${sequence}`,
  };
}

describe('MongoMessages.list batched transcript acceptance checks (O3)', () => {
  it('executes zero metadata queries on ordinary pages without internal user candidates', async () => {
    const ordinaryRecords: MessageRecord[] = [
      { ...message(0), role: 'user', visibility: undefined },
      { ...message(2), role: 'assistant', visibility: undefined },
      {
        ...message(3),
        role: 'assistant',
        visibility: 'internal',
        mode: 'live',
        voiceSessionId: 'voice-session-1',
        completionStatus: 'completed',
        content: 'Assistant answer',
      },
    ];
    const f = createFixture({ messageDocs: ordinaryRecords });

    const result = await f.repository.list('u1', 's1', { limit: 10, cursor: null });

    expect(f.metadataFind).toHaveBeenCalledTimes(0);
    expect(f.rawSpy).toHaveBeenCalledTimes(0);
    expect(result.items).toHaveLength(3);
    expect(result.items.map((m) => m.sequence)).toEqual([0, 2, 3]);
  });

  it('executes exactly one bounded batch metadata query when multiple internal user candidates are present', async () => {
    const candidates: MessageRecord[] = [
      internalUserMessage(1, 'turn-1', 'msg-1'),
      internalUserMessage(2, 'turn-2', 'msg-2'),
      internalUserMessage(3, 'turn-3', 'msg-3'),
    ];
    const acceptances = [
      {
        _id: 'acc-1',
        userId: 'u1',
        sessionId: 's1',
        kind: 'acceptance',
        turnId: 'turn-1',
        userMessageId: 'msg-1',
        attemptId: 'a1',
      },
      {
        _id: 'acc-3',
        userId: 'u1',
        sessionId: 's1',
        kind: 'acceptance',
        turnId: 'turn-3',
        userMessageId: 'msg-3',
        attemptId: 'a3',
      },
    ];
    const f = createFixture({ messageDocs: candidates, metadataDocs: acceptances });

    const result = await f.repository.list('u1', 's1', { limit: 10, cursor: null });

    expect(f.metadataFind).toHaveBeenCalledTimes(1);
    expect(f.rawSpy).toHaveBeenCalledTimes(0);

    const [filterArg, optionsArg] = f.metadataFind.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(filterArg).toEqual({
      userId: 'u1',
      sessionId: 's1',
      kind: 'acceptance',
      $or: [
        { userMessageId: 'msg-1', turnId: 'turn-1' },
        { userMessageId: 'msg-2', turnId: 'turn-2' },
        { userMessageId: 'msg-3', turnId: 'turn-3' },
      ],
    });
    expect(optionsArg).toEqual({ maxTimeMS: 1000 });
    expect(f.metadataCursor.limit).toHaveBeenCalledWith(3);

    // msg-2 had no acceptance, so only msg-1 and msg-3 remain
    expect(result.items).toHaveLength(2);
    expect(result.items.map((m) => m.messageId)).toEqual(['msg-1', 'msg-3']);
    expect(result.items[0]?.content).toBe('');
    expect(result.items[0]?.voiceTranscripts).toEqual([
      { role: 'user', content: 'User voice turn 1', createdAt: candidates[0]?.createdAt },
    ]);
  });

  it('executes single-candidate batch query without $or when exactly one candidate is present', async () => {
    const candidates: MessageRecord[] = [
      internalUserMessage(1, 'turn-1', 'msg-1'),
    ];
    const acceptances = [
      {
        _id: 'acc-1',
        userId: 'u1',
        sessionId: 's1',
        kind: 'acceptance',
        turnId: 'turn-1',
        userMessageId: 'msg-1',
        attemptId: 'a1',
      },
    ];
    const f = createFixture({ messageDocs: candidates, metadataDocs: acceptances });

    const result = await f.repository.list('u1', 's1', { limit: 10, cursor: null });

    expect(f.metadataFind).toHaveBeenCalledTimes(1);
    expect(f.rawSpy).toHaveBeenCalledTimes(0);

    const [filterArg] = f.metadataFind.mock.calls[0] as [Record<string, unknown>];
    expect(filterArg).toEqual({
      userId: 'u1',
      sessionId: 's1',
      kind: 'acceptance',
      userMessageId: 'msg-1',
      turnId: 'turn-1',
    });
    expect(f.metadataCursor.limit).toHaveBeenCalledWith(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.messageId).toBe('msg-1');
  });

  it('enforces cross-turn isolation so mismatched turnId does not confirm acceptance', async () => {
    const candidates: MessageRecord[] = [
      internalUserMessage(1, 'turn-1', 'msg-1'),
      internalUserMessage(2, 'turn-2', 'msg-2'),
    ];
    // Notice: msg-1 has turn-2, msg-2 has turn-1 (cross-turn mismatch)
    const mismatchedAcceptances = [
      {
        _id: 'acc-cross-1',
        userId: 'u1',
        sessionId: 's1',
        kind: 'acceptance',
        turnId: 'turn-2',
        userMessageId: 'msg-1',
        attemptId: 'a-cross-1',
      },
      {
        _id: 'acc-cross-2',
        userId: 'u1',
        sessionId: 's1',
        kind: 'acceptance',
        turnId: 'turn-1',
        userMessageId: 'msg-2',
        attemptId: 'a-cross-2',
      },
    ];
    const f = createFixture({ messageDocs: candidates, metadataDocs: mismatchedAcceptances });

    const result = await f.repository.list('u1', 's1', { limit: 10, cursor: null });

    expect(f.metadataFind).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(0);
  });

  it('enforces wrong-scope isolation so candidates only query the requested user and session', async () => {
    const candidates: MessageRecord[] = [
      internalUserMessage(1, 'turn-1', 'msg-1'),
    ];
    const f = createFixture({ messageDocs: candidates, metadataDocs: [] });

    await f.repository.list('user-xyz', 'session-123', { limit: 10, cursor: null });

    expect(f.metadataFind).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-xyz',
        sessionId: 'session-123',
        kind: 'acceptance',
      }),
      expect.anything(),
    );
  });

  it('filters unconfirmed candidates when metadata returns empty results', async () => {
    const candidates: MessageRecord[] = [
      internalUserMessage(1, 'turn-1', 'msg-1'),
      internalUserMessage(2, 'turn-2', 'msg-2'),
    ];
    const f = createFixture({ messageDocs: candidates, metadataDocs: [] });

    const result = await f.repository.list('u1', 's1', { limit: 10, cursor: null });

    expect(f.metadataFind).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(0);
  });

  it('preserves pagination cursor and olderAvailable when unconfirmed candidates are hidden', async () => {
    const candidates: MessageRecord[] = [
      internalUserMessage(1, 'turn-1', 'msg-1'),
      internalUserMessage(2, 'turn-2', 'msg-2'),
      internalUserMessage(3, 'turn-3', 'msg-3'),
    ];
    const acceptances = [
      {
        _id: 'acc-3',
        userId: 'u1',
        sessionId: 's1',
        kind: 'acceptance',
        turnId: 'turn-3',
        userMessageId: 'msg-3',
      },
      // msg-2 unconfirmed
    ];
    const f = createFixture({ messageDocs: candidates, metadataDocs: acceptances });

    // Limit is 2; 3 records were in collection so descending page fetches msg-3 & msg-2, olderAvailable is true
    const result = await f.repository.list('u1', 's1', { limit: 2, cursor: null });

    expect(result.olderAvailable).toBe(true);
    expect(result.nextCursor).not.toBeNull();
    // msg-2 filtered, only msg-3 visible on this page
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.messageId).toBe('msg-3');
  });

  it('wraps database errors during metadata batch lookup into a sanitized PERSISTENCE_ERROR', async () => {
    const candidates: MessageRecord[] = [
      internalUserMessage(1, 'turn-1', 'msg-1'),
    ];
    const f = createFixture({
      messageDocs: candidates,
      metadataFindError: new Error('MongoNetworkTimeoutException: socket closed unexpectedly'),
    });

    const promise = f.repository.list('u1', 's1', { limit: 10, cursor: null });

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toMatchObject({
      code: 'PERSISTENCE_ERROR',
      message: 'The chat could not be read.',
    });
  });

  it('bounds the batch query limit to the number of candidate records', async () => {
    const candidates: MessageRecord[] = [
      internalUserMessage(1, 'turn-1', 'msg-1'),
      internalUserMessage(2, 'turn-2', 'msg-2'),
      internalUserMessage(3, 'turn-3', 'msg-3'),
      internalUserMessage(4, 'turn-4', 'msg-4'),
    ];
    const f = createFixture({ messageDocs: candidates, metadataDocs: [] });

    await f.repository.list('u1', 's1', { limit: 10, cursor: null });

    expect(f.metadataCursor.limit).toHaveBeenCalledWith(4);
  });
});
