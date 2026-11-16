/**
 * ============================================================================
 * FILE: voice-messages.native.e2e-spec.ts
 * LOCATION: backend/test/persistence/voice-messages.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Native MongoDB integration tests for mixed-history voice/text pagination.
 *
 * ROLE IN PROJECT:
 *    Validates that real database queries exclude internal voice records from
 *    public pages and navigation, while soft deletion and raw paging work properly.
 *
 * KEY COMPONENTS:
 *    - Mixed-history paging: tests internal vs visible records on native MongoDB.
 *    - Navigation isolation: verifies public pages omit secret transcripts.
 *    - Soft deletion: ensures records and memory remain intact after session deletion.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoMemory } from '../../src/persistence/memory.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { RecordStore } from '../../src/persistence/store.js';
import { message, session, manifest } from './fixtures.js';
import { nativeDatabase } from './native.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('Voice history pagination on native MongoDB', () => {
  it('pages legacy and visible text around internal turns without leaking navigation text', async () => {
    const h = await nativeDatabase();
    try {
      const store = new RecordStore(h.db, 15_000);
      const messages = new MongoMessages(store, DEFAULT_BUDGETS);
      const sessions = new MongoSessions(store, DEFAULT_BUDGETS);
      const memory = new MongoMemory(store, DEFAULT_BUDGETS);
      await sessions.createForInternalTurn({ ...session(), title: 'Hey aurvin can you check', latestTurnId: 't1' });
      for (const n of [6, 1, 5, 0, 4, 3, 2]) await messages.append({ ...message(n),
        ...(n % 2 ? { visibility: 'internal' as const, mode: 'live' as const,
          content: 'SECRET voice transcript' } : n === 0 ? {} : { visibility: 'visible' as const }) });
      const pages = [];
      let cursor: string | null = null;
      for (let n = 0; n < 4; n++) {
        const found = await messages.list('u1', 's1', { cursor, limit: 2 });
        pages.push(found); cursor = found.nextCursor;
        if (!cursor) break;
      }
      expect(cursor).toBeNull();
      expect(pages.map(p => p.items.map(m => m.sequence))).toEqual([[4, 6], [0, 2]]);
      expect(pages.at(-1)?.olderAvailable).toBe(false);
      expect(JSON.stringify(pages)).not.toContain('SECRET');
      expect((await messages.list('u2', 's1', { cursor: null, limit: 2 })).items).toEqual([]);
      const raw = await messages.listForContext('u1', 's1', { cursor: null, limit: 50 });
      expect(raw.items.map(m => m.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect((await messages.get('u1', 's1', 'm3'))?.visibility).toBe('internal');
      const nav = await sessions.list('u1', { cursor: null, limit: 10 });
      expect(nav.items[0]?.title).toBe('Hey aurvin can you check');
      expect(JSON.stringify(nav)).not.toContain('SECRET');
      expect(nav.items[0]).not.toHaveProperty('preview');
      await memory.put(manifest());
      await sessions.delete('u1', 's1');
      expect((await sessions.list('u1', { cursor: null, limit: 10 })).items).toEqual([]);
      expect((await messages.get('u1', 's1', 'm3'))?.content).toBe('SECRET voice transcript');
      expect(await memory.get('u1', 's1')).toEqual(manifest());
      await sessions.createIfAbsent({ ...session('u1', 'text'), title: 'Visible text', latestTurnId: 't1' });
      await sessions.createForInternalTurn({ ...session('u1', 'text'), title: 'SECRET' });
      expect((await sessions.get('u1', 'text'))?.title).toBe('Visible text');
      await sessions.createIfAbsent(session('u1', 'empty'));
      expect((await sessions.list('u1', { cursor: null, limit: 10 })).items.map(s => s.sessionId)).toEqual(['text']);
    } finally { await h.close(); }
  }, 30_000);
});
