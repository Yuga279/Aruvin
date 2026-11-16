/**
 * ============================================================================
 * FILE: auth-users.native.e2e-spec.ts
 * LOCATION: backend/test/persistence/auth-users.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify admitted users durability and uniqueness on isolated native Mongo.
 *
 * ROLE IN PROJECT:
 *    Proves users persist through the admitted bundle and a second RecordStore
 *    over the same client, without using the application database.
 *
 * KEY COMPONENTS:
 *    - Unique email/subject inserts and confirmed CAS.
 *    - Independent MongoUsers reread: not a cache assertion.
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { RecordStore } from '../../src/persistence/store.js';
import { MongoUsers } from '../../src/persistence/users.js';
import { account } from '../auth/fixtures.js';
const uri = process.env.AURVIN_TEST_MONGODB_URI;
const prefix = process.env.AURVIN_TEST_DB_PREFIX;
it.skipIf(!uri || prefix !== 'aurvin_p2_test_')('persists users with unique mappings through the admitted bundle', async () => {
  const dbName = `${prefix}${randomUUID().replaceAll('-', '')}`;
  const client = new MongoClient(uri!, { retryWrites: false });
  let bundle: Awaited<ReturnType<typeof createPersistenceBundle>> | undefined;
  let connected = false;
  try {
    await client.connect();
    connected = true;
    bundle = await createPersistenceBundle(client, dbName, DEFAULT_BUDGETS);
    const first = await bundle.users.insert(account());
    await expect(bundle.users.insert(account({ userId: 'u2', workosUserId: 'user_2' }))).rejects.toThrow();
    await expect(bundle.users.insert(account({ userId: 'u3', emailNormalized: 'c@example.com' }))).rejects.toThrow();
    const changed = await bundle.users.compareAndSwap(first, { ...first.account, currentWorkosSessionId: 'sid_native' });
    expect(changed.outcome).toBe('confirmed');
    expect((await bundle.users.get('u1'))!.account.currentWorkosSessionId).toBe('sid_native');
    const independentRead = await client.db(dbName).collection('users').findOne({ userId: 'u1' });
    expect(independentRead?._revision).toBe(1);
    expect(Object.keys(independentRead!).sort()).toEqual(['_id', '_revision', 'schemaVersion', 'userId', 'workosUserId',
      'emailNormalized', 'role', 'status', 'passwordChangeRequired', 'currentWorkosSessionId', 'sessionEpoch', 'createdAt', 'updatedAt'].sort());
    const independentUsers = new MongoUsers(new RecordStore(client.db(dbName), DEFAULT_BUDGETS.persistenceTimeoutMs),
      bundle.owner, DEFAULT_BUDGETS.maxDocumentBytes);
    expect((await independentUsers.get('u1'))!.account.currentWorkosSessionId).toBe('sid_native');
    expect((await independentUsers.get('u1'))!.revision).toBe(1);
  } finally {
    await bundle?.owner.drain(); await bundle?.owner.releaseExecutor();
    if (connected) await client.db(dbName).dropDatabase();
    await client.close();
  }
});
