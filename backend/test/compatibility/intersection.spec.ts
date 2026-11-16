/**
 * ============================================================================
 * FILE: intersection.spec.ts
 * LOCATION: backend/test/compatibility/intersection.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Assert deterministic index/driver/capability constraints for P2.
 *
 * ROLE IN PROJECT:
 *    Records the native/intersection profile without claiming Azure service
 *    certification or exercising a live selected-service target.
 *
 * KEY COMPONENTS:
 *    - Index assertions: No unique/partial/sparse/hashed/TTL application indexes.
 *    - Driver pins: Installed MongoDB 6 and saver 1.4.1 major lines.
 *    - Facts validation: Incompatible partition keys are rejected.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { APP_INDEXES } from '../../src/persistence/indexes.js';
import { parseServiceFacts } from './service-facts.js';

describe('intersection profile (not Azure certification)', () => {
  it('has no unique, partial, sparse, hashed or TTL app indexes', () => {
    // Unique users indexes are P1 native uniqueness; Azure intersection is not certified for them.
    const intersectionIndexes = APP_INDEXES.filter((item) => item.collection !== 'users');
    expect(intersectionIndexes).toHaveLength(11);
    for (const item of intersectionIndexes) {
      expect(item.options).toEqual({ name: expect.any(String) });
      expect(Object.keys(item.keys)[0]).toBe(item.options.name.includes('accounting_range') ? 'kind' : 'userId');
      expect(Object.values(item.keys).every((value) => value === 1 || value === -1)).toBe(
        true,
      );
    }
    expect(intersectionIndexes.slice(-2).map(i => i.keys)).toEqual([
      { kind: 1, userId: 1, startedAt: 1, _id: 1 }, { kind: 1, startedAt: 1, userId: 1 },
    ]);
  });

  it('keeps the driver/saver compatible installed major lines', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.mongodb).toMatch(/^\^6\./);
    expect(pkg.dependencies['@langchain/langgraph-checkpoint-mongodb']).toBe('^1.4.1');
  });

  it('rejects missing facts and incompatible partition keys', () => {
    expect(() => parseServiceFacts(undefined)).toThrow();
    expect(() =>
      parseServiceFacts(
        JSON.stringify({
          profile: 'cosmos-mongodb-ru',
          apiVersion: '7.0',
          tier: 'serverless',
          consistency: 'Session',
          backupMode: 'continuous',
          documentLimitBytes: 2_000_000,
          capabilities: [],
          partitions: {
            sessions: 'userId',
            messages: 'userId',
            'agent-memory': 'userId',
            metadata: 'userId',
            checkpoints: 'sessionId',
            checkpoint_writes: 'thread_id',
          },
        }),
      ),
    ).toThrow();
  });
});
