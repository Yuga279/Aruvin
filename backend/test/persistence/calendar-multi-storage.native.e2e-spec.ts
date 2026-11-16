/**
 * ============================================================================
 * FILE: calendar-multi-storage.native.e2e-spec.ts
 * LOCATION: backend/test/persistence/calendar-multi-storage.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Native MongoDB replica-set integration tests for multi-calendar persistence.
 *
 * ROLE IN PROJECT:
 *    Proves concurrent proposal and operation races, default calendar persistence,
 *    fenced mutations, and unique authority indexes against a real MongoDB engine.
 *
 * KEY COMPONENTS:
 *    - Persists default and confirms single approval winner across reconnect.
 *    - Validates concurrent publication and intent reservation uniqueness.
 * ============================================================================
 */

import { expect, it, describe } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { MongoCalendarProposals } from '../../src/persistence/calendar-proposals.js';
import { RecordStore } from '../../src/persistence/store.js';
import { nativeDatabase } from './native.js';
import { connectionV2, pendingProposal, acceptedReply } from './calendar-multi-fixtures.js';
import { entry } from '../contracts/calendar-multi-fixtures.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';
describe.skipIf(!configured)('multi-calendar isolated native storage', () => {
  it('persists a default and has one approval winner across reconnect', async () => {
    const f = await nativeDatabase();
    try {
      expect(/^aurvin_p2_test_[a-f0-9]{32}$/.test(f.name)).toBe(true);
      const hello = await f.client.db('admin').command({ hello: 1 });
      expect(typeof hello.setName).toBe('string'); expect(hello.isWritablePrimary).toBe(true);
      let bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        const first = connectionV2(); await bundle.calendarConnectionsV2.create(first);
        await bundle.calendarConnectionsV2.compareAndSwap({ userId: 'u', expectedRevision: 1,
          expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1,
          next: { ...first, revision: 2,
            defaultSetting: { defaultCalendarId: entry.calendarId, defaultSettingRevision: 2 } } });
        const clocked = new MongoCalendarProposals(new RecordStore(f.db, 1000), DEFAULT_BUDGETS,
          () => Date.parse('2026-10-22T10:01:00.000Z'));
        await clocked.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });
        const replies = await Promise.all(['op', 'other-op'].map(operationId => clocked.consume({
          reply: acceptedReply(), operationId, intentId: 'intent' })));
        const wins = replies.filter(r => r.outcome === 'consumed' || r.outcome === 'existing');
        expect(wins).toHaveLength(2);
        expect(new Set(wins.map(r => r.consumption.operationId)).size).toBe(1);
      } finally { await bundle.owner.releaseExecutor(); }
      const nextClient = await f.reconnect();
      try {
        bundle = await createPersistenceBundle(nextClient, f.name, DEFAULT_BUDGETS);
        try {
          expect(await bundle.calendarConnectionsV2.get('u')).toMatchObject({ connectionRevision: 1,
            defaultSetting: { defaultCalendarId: entry.calendarId, defaultSettingRevision: 2 } });
          const indexes = await f.db.collection('metadata').indexes();
          expect(indexes.every(i => i.expireAfterSeconds === undefined)).toBe(true);
          expect(indexes.some(i => i.name === 'calendar_operation_intent' && i.unique)).toBe(true);
        } finally { await bundle.owner.releaseExecutor(); }
      } finally { await nextClient.close(); }
    } finally { await f.close(); }
  }, 60000);
});
