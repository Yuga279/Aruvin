/**
 * ============================================================================
 * FILE: calendar-multi-indexes.spec.ts
 * LOCATION: backend/test/persistence/calendar-multi-indexes.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Google Calendar Phase 2 indexes are scoped, unique where required,
 *    and defined only on existing collections without TTL.
 *
 * ROLE IN PROJECT:
 *    Ensures Mongo indexes uphold concurrency, pending proposal uniqueness,
 *    operation intent uniqueness, and claim fencing on metadata collection.
 *
 * KEY COMPONENTS:
 *    - Validates CALENDAR_INDEXES entries for proposals, operations, and claims.
 *    - Ensures no TTL or unauthorized collection creation.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { CALENDAR_INDEXES } from '../../src/persistence/indexes.js';
import { COLLECTIONS } from '../../src/contracts/collections.js';

it('uses only existing collections and scoped authority indexes without TTL', () => {
  const byName = new Map(CALENDAR_INDEXES.map(i => [i.options.name, i]));
  expect(byName.get('calendar_pending_proposal_session')).toMatchObject({ collection: 'metadata',
    keys: { userId: 1, sessionId: 1 }, options: { unique: true,
      partialFilterExpression: { kind: 'calendar-proposal', state: 'pending' } } });
  expect(byName.get('calendar_operation_intent')).toMatchObject({ collection: 'metadata',
    keys: { userId: 1, sessionId: 1, intentId: 1 }, options: { unique: true,
      partialFilterExpression: { kind: 'calendar-operation', schemaVersion: 2 } } });
  expect(byName.get('calendar_intent_reservation')?.options.unique).toBe(true);
  expect(byName.get('calendar_consumption_proposal')?.options.unique).toBe(true);
  expect(CALENDAR_INDEXES.every(i => Object.values(COLLECTIONS).includes(i.collection as never))).toBe(true);
  expect(CALENDAR_INDEXES.every(i => i.options.expireAfterSeconds === undefined)).toBe(true);
});

it('indexes every account-revision invalidation branch and its keyset order', () => {
  const byName = new Map(CALENDAR_INDEXES.map(i => [i.options.name, i]));
  const expected: Record<string, { collection: string; keys: Record<string, 1> }> = {
    calendar_invalidation_source: { collection: 'metadata', keys: { userId: 1, kind: 1,
      'source.connectionId': 1, 'source.connectionRevision': 1, _id: 1 } },
    calendar_invalidation_decision: { collection: 'metadata', keys: { userId: 1, kind: 1,
      connectionId: 1, connectionRevision: 1, _id: 1 } },
    calendar_invalidation_result: { collection: 'metadata', keys: { userId: 1, kind: 1,
      'resultRef.source.connectionId': 1, 'resultRef.source.connectionRevision': 1, _id: 1 } },
    calendar_invalidation_operation: { collection: 'metadata', keys: { userId: 1, kind: 1,
      connectionId: 1, connectionRevision: 1, _id: 1 } },
    calendar_invalidation_proposal: { collection: 'metadata', keys: { userId: 1, kind: 1,
      connectionId: 1, connectionRevision: 1, _id: 1 } },
    calendar_invalidation_message: { collection: 'messages', keys: { userId: 1,
      'sourceProvenance.connectionId': 1, 'sourceProvenance.connectionRevision': 1, _id: 1 } },
  };

  for (const [name, index] of Object.entries(expected)) {
    expect(byName.get(name), `${name} must cover the invalidation predicate`).toMatchObject(index);
  }
  for (const [name, kind] of [
    ['calendar_invalidation_source', 'calendar-source'],
    ['calendar_invalidation_decision', 'calendar-model-decision'],
    ['calendar_invalidation_result', 'calendar-tool-result'],
    ['calendar_invalidation_operation', 'calendar-operation'],
    ['calendar_invalidation_proposal', 'calendar-proposal'],
  ]) {
    expect(byName.get(name)?.options.partialFilterExpression).toEqual({ kind });
  }
});
