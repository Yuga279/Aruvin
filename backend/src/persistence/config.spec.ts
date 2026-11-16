/**
 * ============================================================================
 * FILE: config.spec.ts
 * LOCATION: backend/src/persistence/config.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify bounded singleton config reads, CAS, and ownership fencing.
 *
 * ROLE IN PROJECT:
 *    Exercises MongoConfigRepository against a fake driver so revision races,
 *    oversize documents, and journal uncertainty never touch a real database.
 *
 * KEY COMPONENTS:
 *    - Singleton tests: Missing read, create revision 1, CAS, preserved _id.
 *    - Race tests: One winner, stale refusal, no mutation on invalid candidates.
 * ============================================================================
 */

import { BSON } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type { StoredConfigDocument } from '../contracts/admin-config.js';
import { defaultManageableSettings } from '../platform/config/manageable-config.js';
import { DEFAULT_BUDGETS } from '../contracts/budgets.js';
import { MAX_CONFIG_DOCUMENT_BYTES } from '../contracts/admin-config.js';
import { RecordStore } from './store.js';
import { MongoConfigRepository } from './config.js';
import { MutationJournal, guardedClient } from './mutation-journal.js';

const at = '2026-10-13T12:00:00.000Z';

function document(revision = 1): StoredConfigDocument {
  return {
    _id: 'aurvin',
    schemaVersion: 1,
    revision,
    settings: defaultManageableSettings(),
    credentials: { openrouter: null, deepgram: null },
    updatedAt: at,
    updatedBy: 'aurvin-dev-user',
  };
}

function repositoryFixture(initial: StoredConfigDocument | null = null) {
  let stored = initial === null ? null : structuredClone(initial);
  const collection = {
    findOne: vi.fn(async (filter: Record<string, unknown>) => {
      if (filter._id !== 'aurvin') return null;
      return stored === null ? null : structuredClone(stored);
    }),
    updateOne: vi.fn(async (
      _filter: Record<string, unknown>,
      update: { $setOnInsert: StoredConfigDocument },
    ) => {
      if (stored) {
        return { acknowledged: true, matchedCount: 1, upsertedCount: 0, modifiedCount: 0 };
      }
      stored = structuredClone(update.$setOnInsert);
      return { acknowledged: true, matchedCount: 0, upsertedCount: 1, modifiedCount: 0 };
    }),
    replaceOne: vi.fn(async (
      filter: Record<string, unknown>,
      doc: StoredConfigDocument,
    ) => {
      if (!stored || stored.revision !== filter.revision) {
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      }
      stored = structuredClone(doc);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    }),
  };
  const fakeDb = {
    collection: vi.fn((name: string) => {
      expect(name).toBe('config');
      return collection;
    }),
  };
  const store = new RecordStore(fakeDb as never, 1000);
  const owner = { assertExecutor: vi.fn(async () => undefined) };
  const repository = new MongoConfigRepository(store, owner, 16_384);
  return {
    collection,
    store,
    owner,
    repository,
    stored: () => stored,
    setStored(next: StoredConfigDocument | null) {
      stored = next === null ? null : structuredClone(next);
    },
  };
}

describe('config repository', () => {
  it('reads and stores a singleton config document', async () => {
    const missing = repositoryFixture(null);
    expect(await missing.repository.read()).toBeNull();

    const created = await missing.repository.createIfAbsent(document(1));
    expect(created).toEqual({ outcome: 'confirmed', document: document(1) });
    expect(missing.stored()?._id).toBe('aurvin');
    expect(missing.stored()?.schemaVersion).toBe(1);
    expect(missing.stored()?.revision).toBe(1);
    expect(missing.collection.updateOne).toHaveBeenCalledTimes(1);
    expect(missing.owner.assertExecutor).toHaveBeenCalled();

    const loaded = await missing.repository.read();
    expect(loaded?._id).toBe('aurvin');
    expect(loaded?.revision).toBe(1);
    expect(loaded).not.toBe(missing.stored());

    const swapped = await missing.repository.compareAndSwap(1, document(2));
    expect(swapped).toEqual({ outcome: 'confirmed', document: document(2) });
    expect(missing.stored()?.revision).toBe(2);
    expect(missing.stored()?._id).toBe('aurvin');
  });

  it('confirms one create and conflicts the repeat including equal documents', async () => {
    const f = repositoryFixture(null);
    const first = await f.repository.createIfAbsent(document(1));
    const second = await f.repository.createIfAbsent(document(1));
    expect(first).toEqual({ outcome: 'confirmed', document: document(1) });
    expect(second).toEqual({ outcome: 'conflict', currentRevision: 1 });
    expect(f.stored()).toEqual(document(1));
    expect(f.collection.updateOne).toHaveBeenCalledTimes(2);
  });

  it('lets one same-revision replacement win and ignores the stale request', async () => {
    const f = repositoryFixture(document(1));
    const winner = await f.repository.compareAndSwap(1, document(2));
    const stale = await f.repository.compareAndSwap(1, {
      ...document(2),
      settings: { ...document(2).settings, chat: { ...document(2).settings.chat, titleMaxChars: 70 } },
    });
    expect(winner).toEqual({ outcome: 'confirmed', document: document(2) });
    expect(stale).toEqual({ outcome: 'conflict', currentRevision: 2 });
    expect(f.stored()?.settings.chat.titleMaxChars).toBe(document(1).settings.chat.titleMaxChars);
  });

  it('never mutates on wrong id, revision jump, unknown fields, or malformed ciphertext', async () => {
    const f = repositoryFixture(null);
    await expect(f.repository.createIfAbsent({ ...document(1), _id: 'other' } as never))
      .rejects.toMatchObject({ code: 'CONFIG_STORED_INVALID' });
    await expect(f.repository.createIfAbsent(document(2)))
      .rejects.toMatchObject({ code: 'CONFIG_STORED_INVALID' });
    await expect(f.repository.createIfAbsent({ ...document(1), extra: true } as never))
      .rejects.toMatchObject({ code: 'CONFIG_STORED_INVALID' });
    await expect(f.repository.createIfAbsent({
      ...document(1),
      credentials: {
        openrouter: {
          envelope: { algorithm: 'aes-256-gcm', nonce: '!!!', tag: '!!!', ciphertext: '!!!' },
          validatedAt: at,
        },
        deepgram: null,
      },
    } as never)).rejects.toMatchObject({ code: 'CONFIG_STORED_INVALID' });
    expect(f.collection.updateOne).not.toHaveBeenCalled();
    expect(f.collection.replaceOne).not.toHaveBeenCalled();
    expect(f.stored()).toBeNull();
  });

  it('enforces BSON size with maximum envelopes and preserves old data', async () => {
    const existing = document(1);
    const envelope = {
      algorithm: 'aes-256-gcm' as const,
      nonce: Buffer.alloc(12, 1).toString('base64'),
      tag: Buffer.alloc(16, 2).toString('base64'),
      ciphertext: Buffer.alloc(4096, 7).toString('base64'),
    };
    const bulky: StoredConfigDocument = {
      ...document(2),
      settings: {
        ...document(2).settings,
        deepgram: {
          ...document(2).settings.deepgram,
          keyterms: Array.from({ length: 50 }, (_, index) => `k${index.toString().padStart(62, 'x')}`),
        },
      },
      credentials: {
        openrouter: { envelope, validatedAt: at },
        deepgram: {
          envelope: { ...envelope, nonce: Buffer.alloc(12, 3).toString('base64') },
          validatedAt: at,
        },
      },
    };
    const bson = BSON.calculateObjectSize(bulky);
    const under = repositoryFixture(existing);
    const allowed = new MongoConfigRepository(under.store, under.owner, bson + 256);
    expect(await allowed.compareAndSwap(1, bulky)).toEqual({
      outcome: 'confirmed', document: bulky,
    });

    const overFixture = repositoryFixture(existing);
    const capped = new MongoConfigRepository(overFixture.store, overFixture.owner, bson + 255);
    await expect(capped.compareAndSwap(1, bulky)).rejects.toMatchObject({ code: 'CONFIG_STORED_INVALID' });
    expect(overFixture.collection.replaceOne).not.toHaveBeenCalled();
    expect(overFixture.stored()).toEqual(existing);
  });

  it('does not confirm a matching reread through journal quarantine', async () => {
    const f = repositoryFixture(document(1));
    const next = document(2);
    f.collection.replaceOne.mockRejectedValueOnce(new Error('unknown fixture write'));
    f.collection.findOne.mockResolvedValueOnce(next);
    f.owner.assertExecutor
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('journal quarantined'));
    expect(await f.repository.compareAndSwap(1, next)).toEqual({ outcome: 'uncertain' });
    expect(f.collection.replaceOne).toHaveBeenCalledTimes(1);
  });

  it('confirms a matching reread only when ownership stays healthy', async () => {
    const f = repositoryFixture(document(1));
    const next = document(2);
    f.collection.replaceOne.mockRejectedValueOnce(new Error('unknown fixture write'));
    f.collection.findOne.mockResolvedValueOnce(next);
    expect(await f.repository.compareAndSwap(1, next)).toEqual({
      outcome: 'confirmed', document: next,
    });
  });

  it('does not dispatch when ownership is unhealthy before write', async () => {
    const f = repositoryFixture(document(1));
    f.owner.assertExecutor.mockRejectedValueOnce(new Error('journal quarantined'));
    await expect(f.repository.compareAndSwap(1, document(2)))
      .rejects.toMatchObject({ code: 'CONFIG_STORAGE_UNAVAILABLE' });
    expect(f.collection.replaceOne).not.toHaveBeenCalled();
  });

  it('treats missing, old, invalid, and unacknowledged results as uncertain', async () => {
    const f = repositoryFixture(document(1));
    f.collection.replaceOne.mockRejectedValueOnce(new Error('unknown fixture write'));
    f.collection.findOne.mockResolvedValueOnce(null);
    expect(await f.repository.compareAndSwap(1, document(2))).toEqual({ outcome: 'uncertain' });

    f.collection.replaceOne.mockRejectedValueOnce(new Error('unknown fixture write'));
    f.collection.findOne.mockResolvedValueOnce(document(1));
    expect(await f.repository.compareAndSwap(1, document(2))).toEqual({ outcome: 'uncertain' });

    f.collection.replaceOne.mockRejectedValueOnce(new Error('unknown fixture write'));
    f.collection.findOne.mockResolvedValueOnce({ _id: 'aurvin', bogus: true });
    expect(await f.repository.compareAndSwap(1, document(2))).toEqual({ outcome: 'uncertain' });

    f.collection.replaceOne.mockResolvedValueOnce({ acknowledged: false, matchedCount: 0 });
    f.collection.findOne.mockResolvedValueOnce(document(1));
    expect(await f.repository.compareAndSwap(1, document(2))).toEqual({ outcome: 'uncertain' });
  });

  it('conflicts a newer healthy revision and never confirms a different candidate', async () => {
    const f = repositoryFixture(document(1));
    f.collection.replaceOne.mockRejectedValueOnce(new Error('unknown fixture write'));
    f.collection.findOne.mockResolvedValueOnce(document(3));
    expect(await f.repository.compareAndSwap(1, document(2))).toEqual({
      outcome: 'conflict', currentRevision: 3,
    });
  });

  it('treats unknown create and idle-clear ACK loss as uncertain without journal reset', async () => {
    const created = repositoryFixture(null);
    const journal = { reset: vi.fn(), stop: vi.fn(), deleteSentinel: vi.fn() };
    Object.assign(created.owner, journal);
    created.collection.updateOne.mockRejectedValueOnce(new Error('unknown fixture write'));
    created.collection.findOne.mockResolvedValueOnce(null);
    expect(await created.repository.createIfAbsent(document(1))).toEqual({ outcome: 'uncertain' });
    expect(journal.reset).not.toHaveBeenCalled();
    expect(journal.stop).not.toHaveBeenCalled();
    expect(journal.deleteSentinel).not.toHaveBeenCalled();

    const f = repositoryFixture(document(1));
    Object.assign(f.owner, journal);
    f.owner.assertExecutor
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('idle ack lost'));
    expect(await f.repository.compareAndSwap(1, document(2))).toEqual({ outcome: 'uncertain' });
    expect(f.collection.replaceOne).toHaveBeenCalledTimes(1);
    expect(journal.reset).not.toHaveBeenCalled();
    expect(journal.stop).not.toHaveBeenCalled();
    expect(journal.deleteSentinel).not.toHaveBeenCalled();
  });

  it('admits config through the guarded bundle only after the journal allowlist includes it', async () => {
    const collection = {
      findOne: vi.fn(async () => null),
      updateOne: vi.fn(async () => ({ acknowledged: true, matchedCount: 0, upsertedCount: 1 })),
      replaceOne: vi.fn(async () => ({ acknowledged: true, matchedCount: 1 })),
    };
    const client = {
      db: vi.fn(() => ({ collection: () => collection, command: vi.fn(async () => ({ ok: 1 })) })),
      appendMetadata: vi.fn(),
    };
    const journal = new MutationJournal(
      { updateOne: vi.fn(async () => ({ acknowledged: true, matchedCount: 1 })) } as never,
      'owner',
      1000,
    );
    const guarded = guardedClient(client as never, 'db', journal);
    const store = new RecordStore(guarded.db('db'), 1000);
    const owner = { assertExecutor: vi.fn(async () => { journal.assertHealthy(); }) };
    expect(() => new MongoConfigRepository(
      store,
      owner,
      Math.min(MAX_CONFIG_DOCUMENT_BYTES, DEFAULT_BUDGETS.maxDocumentBytes),
    )).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_TOPOLOGY' }));
    expect(collection.updateOne).not.toHaveBeenCalled();
    expect(() => guarded.db('db').collection('sessions')).not.toThrow();
    expect(() => guarded.db('db').collection('not-a-collection')).toThrow();
  });
});
