/**
 * ============================================================================
 * FILE: records.spec.ts
 * LOCATION: backend/test/persistence/records.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify hashed identities, strict codecs, BSON bounds, and date normalization.
 *
 * ROLE IN PROJECT:
 *    Provides deterministic persistence-codec coverage that does not require a
 *    database and therefore runs in routine `npm test`.
 *
 * KEY COMPONENTS:
 *    - Identity tests: Tuple hashing without delimiter collisions.
 *    - Bound tests: Unknown fields, unsafe sequences, and UTF-8 BSON size.
 * ============================================================================
 */

import {
  DEFAULT_BUDGETS,
  messageRecordSchema,
  sessionRecordSchema,
} from '../../src/contracts/index.js';
import {
  bounded,
  graphThreadId,
  key,
  normalizeDate,
} from '../../src/persistence/records.js';
import { message, session } from './fixtures.js';

describe('bounded persistence codec', () => {
  it('separates tuples and identities without delimiter collisions', () => {
    expect(key('x', 'a|b', 'c')).not.toBe(key('x', 'a', 'b|c'));
    expect(graphThreadId('u1', 's1')).not.toBe(graphThreadId('u2', 's1'));
    expect(key('x', 'u1', 's1')).toHaveLength(64);
  });

  it('rejects unknown transcript fields and unsafe sequences', () => {
    expect(() =>
      bounded(
        sessionRecordSchema,
        { ...session(), transcript: [] },
        'x',
        DEFAULT_BUDGETS.maxDocumentBytes,
      ),
    ).toThrow();
    expect(() =>
      bounded(
        messageRecordSchema,
        { ...message(), sequence: Number.MAX_SAFE_INTEGER + 1 },
        'x',
        DEFAULT_BUDGETS.maxMessageBytes,
      ),
    ).toThrow();
  });

  it('measures UTF-8 BSON, not string length', () => {
    expect(() =>
      bounded(
        messageRecordSchema,
        { ...message(), content: '界'.repeat(24_000) },
        'x',
        DEFAULT_BUDGETS.maxMessageBytes,
      ),
    ).toThrow();
    expect(
      bounded(messageRecordSchema, message(), 'x', 65_536).bytes,
    ).toBeLessThan(65_536);
  });

  it('normalizes accepted datetimes for lexical ordering', () => {
    expect(normalizeDate('2026-10-06T02:00:00+02:00')).toBe(
      '2026-10-06T00:00:00.000Z',
    );
  });
});
