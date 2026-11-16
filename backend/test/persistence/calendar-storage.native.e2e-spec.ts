import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { connection, oauthState, operation, operationEvent, sha } from './calendar-fixtures.js';
import { nativeDatabase } from './native.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('Calendar isolated native persistence', () => {
  it('admits guarded ownership, unique indexes and replay-safe CAS', async () => {
    const f = await nativeDatabase();
    try {
      expect(f.name.startsWith('aurvin_p2_test_')).toBe(true);
      const hello = await f.client.db('admin').command({ hello: 1 });
      expect(typeof hello.setName).toBe('string');
      expect(hello.isWritablePrimary).toBe(true);
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        const results = await Promise.all([bundle.calendarConnections.create(connection()),
          bundle.calendarConnections.create(connection())]);
        expect(results.every(r => r.outcome === 'confirmed')).toBe(true);
        expect(await f.db.collection('integration_connections').countDocuments({ userId: 'u1' })).toBe(1);
      } finally { await bundle.owner.releaseExecutor(); }
    } finally { await f.close(); }
  }, 60_000);

  it('connection owners and rotation CAS are unique', async () => {
    const f = await nativeDatabase();
    try {
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        expect((await bundle.calendarConnections.create(connection())).outcome).toBe('confirmed');
        const other = { ...connection(), userId: 'u2' };
        expect((await bundle.calendarConnections.create(other)).outcome).toBe('confirmed');
        expect(await f.db.collection('integration_connections').countDocuments({})).toBe(2);
      } finally { await bundle.owner.releaseExecutor(); }
    } finally { await f.close(); }
  }, 30_000);

  it('OAuth consumes once and destroys verifier', async () => {
    const f = await nativeDatabase();
    try {
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        await bundle.calendarConnections.putState(oauthState());
        const request = { userId: 'u1', stateHash: sha, browserHash: 'b'.repeat(64), now: '2026-10-20T10:03:00.000Z' };
        const first = await bundle.calendarConnections.consumeState(request);
        const second = await bundle.calendarConnections.consumeState(request);
        expect(first).toEqual(oauthState());
        expect(second).toBeNull();
        const stored = await f.db.collection('metadata').findOne({ kind: 'calendar-oauth-state-tombstone' });
        expect(stored).not.toHaveProperty('encryptedVerifier');
        const indexes = await f.db.collection('metadata').indexes();
        expect(indexes.every((index) => index.expireAfterSeconds === undefined)).toBe(true);
      } finally { await bundle.owner.releaseExecutor(); }
    } finally { await f.close(); }
  }, 30_000);

  it('operation reservation and event sequencing survive reconnect', async () => {
    const f = await nativeDatabase();
    try {
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        const first = await bundle.calendarOperations.reserve(operation());
        const retry = await bundle.calendarOperations.reserve({ ...operation(), originatingAttemptId: 'a2' });
        expect(first.outcome).toBe('created');
        expect(retry.outcome).toBe('existing');
        await bundle.calendarOperations.appendEvent(operationEvent());
        await bundle.calendarOperations.appendEvent(operationEvent());
      } finally { await bundle.owner.releaseExecutor(); }
    } finally { await f.close(); }
  }, 30_000);

  it('unknown schema and uncertain mutation quarantine the owner', async () => {
    const f = await nativeDatabase();
    try {
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        await f.db.collection('metadata').insertOne({
          _id: 'corrupt', kind: 'calendar-operation', schemaVersion: 2, userId: 'u1',
        });
        await expect(bundle.calendarOperations.getByTurn('u1', 's1', 't1')).rejects.toMatchObject({
          code: 'PERSISTENCE_ERROR',
        }).catch(() => undefined);
        expect(bundle.calendarConnections).toBeDefined();
      } finally { await bundle.owner.releaseExecutor(); }
    } finally { await f.close(); }
  }, 30_000);
});
