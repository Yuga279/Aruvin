/**
 * ============================================================================
 * FILE: pagination.spec.ts
 * LOCATION: backend/test/persistence/pagination.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify scoped keyset cursor encoding and malformed request rejection.
 *
 * ROLE IN PROJECT:
 *    Covers cursor/kind/scope binding without requiring a database.
 *
 * KEY COMPONENTS:
 *    - Scope tests: Cross-user and cross-kind cursor reuse is rejected.
 *    - Bound tests: Oversized, malformed, and invalid page sizes fail closed.
 * ============================================================================
 */

import { cursor, page } from '../../src/persistence/pagination.js';

describe('keyset cursors', () => {
  it('binds a bounded cursor to kind and scope', () => {
    const value = cursor({
      kind: 'messages',
      userId: 'u1',
      sessionId: 's1',
      value: 4,
      id: 'm4',
    });
    expect(page({ cursor: value, limit: 2 }, 'messages', 'u1', 's1', 50).after?.value).toBe(
      4,
    );
    expect(() => page({ cursor: value, limit: 2 }, 'messages', 'u2', 's1', 50)).toThrow();
    expect(() => page({ cursor: value, limit: 2 }, 'sessions', 'u1', '', 50)).toThrow();
  });

  it('rejects malformed, oversized and unbounded requests', () => {
    for (const value of ['bad', 'x'.repeat(2049)]) {
      expect(() =>
        page({ cursor: value, limit: 2 }, 'messages', 'u1', 's1', 50),
      ).toThrow();
    }
    for (const limit of [0, 51, 1.5, Infinity]) {
      expect(() =>
        page({ cursor: null, limit }, 'messages', 'u1', 's1', 50),
      ).toThrow();
    }
  });
});
