/**
 * ============================================================================
 * FILE: seal-history-reuse.spec.ts
 * LOCATION: backend/test/runtime/seal-history-reuse.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify validated seal history reuse without database or provider calls.
 * ROLE IN PROJECT:
 *    Exercises real ownership, repositories, and checkpoints over the BSON fake
 *    plus strict reconstruction paths over the existing runtime fixture.
 * KEY COMPONENTS:
 *    - Query counts and exact manifests for ordinary, retry, and restarted turns.
 *    - Invalid source snapshots and mutable-record fallback safety checks.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import type { MongoClient } from 'mongodb';
import type { ContextSourceSnapshot } from '../../src/contracts/context.js';
import type { MessageRecord } from '../../src/contracts/message.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { buildReferenceManifest } from '../../src/context/reference-selection.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { assets } from '../context/fixtures.js';
import { source as calendarSource } from '../persistence/calendar-fixtures.js';
import { textConfigFixture, type TextConfigFixture } from './text-config-fixture.js';

async function receiptFixture() {
  const snapshot = textSnapshot(1);
  const memory = calendarMemory(undefined, { databaseName: 'seal-history-offline' });
  const client = Object.assign(memory.commandSource, {
    appendMetadata: () => undefined, db: () => memory.store.db,
  }) as unknown as MongoClient;
  const p = await createPersistenceBundle(client, 'seal-history-offline', snapshot.budgets, 'seal-executor');
  return textConfigFixture(snapshot, deps => deps, p);
}

async function expectManifest(h: TextConfigFixture, sessionId: string, version: number) {
  const rows = await h.p.messages.listForContext(h.identity.userId, sessionId, { limit: 50 });
  expect(await h.p.memory.get(h.identity.userId, sessionId)).toEqual(buildReferenceManifest(
    h.identity.userId, sessionId, version, rows.items, assets, h.p.memory.budgets,
  ));
}

it.each(['receipt', 'reconstruction'] as const)('reuses complete %s sources with exact ordered manifests', async path => {
  const h = path === 'receipt' ? await receiptFixture() : textConfigFixture(textSnapshot(1));
  try {
    const reads = vi.spyOn(h.p.messages, 'getReferences');
    const first = await h.submit('First');
    reads.mockClear();
    await h.execute(first);
    expect(reads).not.toHaveBeenCalled();
    await expectManifest(h, first.sessionId, 1);
    const second = await h.submit('Second', first.sessionId);
    reads.mockClear();
    await h.execute(second);
    expect(reads).not.toHaveBeenCalled();
    await expectManifest(h, first.sessionId, 2);
    const body = JSON.parse(h.fetcher.mock.calls.at(-1)![1]?.body as string);
    expect(body.messages.filter((m: { role: string }) => m.role === 'user').map((m: { content: string }) => m.content))
      .toEqual(['First', 'Second']);
  } finally { await h.dispose(); }
});

it.each(['missing', 'stale', 'cross-session', 'reordered', 'calendar', 'transcript'] as const)(
  'handles %s retained rows without changing manifest membership', async kind => {
    const h = textConfigFixture(textSnapshot(1));
    try {
      const first = await h.submit('First');
      await h.execute(first);
      const second = await h.submit('Second', first.sessionId);
      let source: ContextSourceSnapshot | undefined;
      const boundary = h.runtime.checkBoundary.bind(h.runtime);
      vi.spyOn(h.runtime, 'checkBoundary').mockImplementation(async (...args) => {
        const loaded = await boundary(...args);
        source = loaded.source;
        return loaded;
      });
      const fetch = h.fetcher.getMockImplementation()!;
      h.fetcher.mockImplementationOnce(async (...args) => {
        const rows = source!.records as MessageRecord[];
        if (kind === 'missing') rows.pop();
        if (kind === 'stale') rows[0] = { ...rows[0], eventId: 'stale-event' };
        if (kind === 'cross-session') rows[0] = { ...rows[0], sessionId: 'other-session' };
        if (kind === 'reordered') rows.reverse();
        if (kind === 'calendar') rows[1] = { ...rows[1], sourceProvenance: [calendarSource()] };
        if (kind === 'transcript') rows[0] = { ...rows[0], voiceTranscripts: [{ role: 'user', content: 'transcript' }] };
        return fetch(...args);
      });
      const reads = vi.spyOn(h.p.messages, 'getReferences');
      await h.execute(second);
      expect(reads).toHaveBeenCalledTimes(kind === 'reordered' ? 0 : 1);
      await expectManifest(h, first.sessionId, 2);
    } finally { await h.dispose(); }
  },
);

it.each(['missing', 'stale', 'cross-session'] as const)('refuses %s fallback rows at seal', async kind => {
  const h = textConfigFixture(textSnapshot(1));
  try {
    const first = await h.submit('First');
    await h.execute(first);
    const second = await h.submit('Second', first.sessionId);
    let source: ContextSourceSnapshot | undefined;
    const boundary = h.runtime.checkBoundary.bind(h.runtime);
    vi.spyOn(h.runtime, 'checkBoundary').mockImplementation(async (...args) => {
      const loaded = await boundary(...args);
      source = loaded.source;
      return loaded;
    });
    const fetch = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementationOnce(async (...args) => {
      (source!.records as MessageRecord[]).pop();
      return fetch(...args);
    });
    const getReferences = h.p.messages.getReferences.bind(h.p.messages);
    vi.spyOn(h.p.messages, 'getReferences').mockImplementation(async (...args) => {
      const rows = await getReferences(...args);
      if (kind === 'missing') return rows.slice(1);
      return [{ ...rows[0], ...(kind === 'stale' ? { eventId: 'stale-event' } : { sessionId: 'other-session' }) }, ...rows.slice(1)];
    });
    await expect(h.execute(second)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect((await h.p.metadata.getAttempt(h.identity.userId, second.sessionId, second.attemptId))?.status)
      .not.toBe('completed');
  } finally { await h.dispose(); }
});

it.each(['ownership', 'manifest-version'] as const)('retains the pre-inference %s fence', async kind => {
  const h = kind === 'manifest-version' ? await receiptFixture() : textConfigFixture(textSnapshot(1));
  try {
    const ids = await h.submit('First');
    if (kind === 'ownership') vi.spyOn(h.p.owner, 'fence').mockResolvedValue(false);
    else {
      const manifest = await h.p.memory.get(h.identity.userId, ids.sessionId);
      await h.p.memory.put({ ...manifest!, contextVersion: manifest!.contextVersion + 1 });
    }
    await expect(h.execute(ids)).rejects.toMatchObject({ code: kind === 'ownership' ? 'INTERRUPTED' : 'NOT_READY' });
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.dispose(); }
});

it('reuses restarted admission sources and explicit retry sources without duplicating input', async () => {
  const h = await receiptFixture();
  try {
    const first = await h.submit('First');
    await h.execute(first);
    await h.restart();
    const second = await h.submit('Second', first.sessionId);
    const reads = vi.spyOn(h.p.messages, 'getReferences');
    h.fetcher.mockRejectedValueOnce(new TypeError('offline fixture failure'));
    await expect(h.execute(second)).rejects.toThrow();
    expect(reads).not.toHaveBeenCalled();
    const retry = await h.runtime.retryTurn({ identity: h.identity, sessionId: second.sessionId,
      turnId: second.turnId, idempotencyKey: 'retry-seal-history' });
    reads.mockClear();
    await h.execute(retry);
    expect(reads).not.toHaveBeenCalled();
    await expectManifest(h, first.sessionId, 3);
    const body = JSON.parse(h.fetcher.mock.calls.at(-1)![1]?.body as string);
    expect(body.messages.filter((m: { content: string }) => m.content === 'Second')).toHaveLength(1);
  } finally { await h.dispose(); }
});
