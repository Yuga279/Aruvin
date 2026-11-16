/**
 * ============================================================================
 * FILE: claim-executor.spec.ts
 * LOCATION: backend/test/persistence/claim-executor.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove leftover executor sentinels are taken over on the next claim.
 *
 * ROLE IN PROJECT:
 *    Routine check that watch-kill/unsafe-exit leftovers no longer block boot.
 *
 * KEY COMPONENTS:
 *    - Empty claim: First owner inserts the sentinel.
 *    - Leftover takeover: Second owner replaces the first and fences it.
 * ============================================================================
 */

import { MongoOwnership } from '../../src/persistence/ownership.js';
import {
  EXECUTOR_SCOPE,
  executorSchema,
  key,
  type StoredDocument,
} from '../../src/persistence/records.js';
import type { RecordStore } from '../../src/persistence/store.js';
import { AppError } from '../../src/platform/errors/app-error.js';

function mockStore(seed?: { ownerId: string; revision: number }) {
  let doc: StoredDocument | null = seed
    ? {
        _id: key('executor'),
        _revision: seed.revision,
        schemaVersion: 1,
        kind: 'executor',
        ...EXECUTOR_SCOPE,
        ownerId: seed.ownerId,
      }
    : null;
  const record = () => {
    if (!doc) return null;
    const { _id, _revision, ...rest } = doc;
    void _id;
    void _revision;
    return executorSchema.parse(rest);
  };
  return {
    timeoutMs: 1000,
    options: () => ({}),
    insert: async (_c: string, _s: unknown, value: { ownerId: string }) => {
      if (doc && doc.ownerId !== value.ownerId) {
        throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'mismatch');
      }
      if (!doc) {
        doc = {
          _id: key('executor'),
          _revision: 0,
          schemaVersion: 1,
          kind: 'executor',
          ...EXECUTOR_SCOPE,
          ownerId: value.ownerId,
        };
      }
      return value;
    },
    read: async () => record(),
    raw: async (_c: string, filter: { ownerId?: string }) => {
      if (!doc) return null;
      if (filter.ownerId && filter.ownerId !== doc.ownerId) return null;
      return structuredClone(doc);
    },
    replace: async (
      _c: string,
      _s: unknown,
      value: { ownerId: string },
      _id: string,
      expectedRevision: number,
    ) => {
      if (!doc || doc._revision !== expectedRevision) return false;
      doc = { ...doc, ownerId: value.ownerId, _revision: expectedRevision + 1 };
      return true;
    },
  } as unknown as RecordStore;
}

it('claims an empty executor sentinel', async () => {
  const owner = new MongoOwnership(mockStore(), 'process-a');
  await owner.claimExecutor();
  await owner.assertExecutor();
});

it('takes over a leftover executor sentinel', async () => {
  const store = mockStore({ ownerId: 'process-a', revision: 0 });
  const next = new MongoOwnership(store, 'process-b');
  await next.claimExecutor();
  await next.assertExecutor();
  await expect(new MongoOwnership(store, 'process-a').assertExecutor())
    .rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
});
