/**
 * ============================================================================
 * FILE: native.ts
 * LOCATION: backend/test/persistence/native.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide an isolated native MongoDB harness for P2 integration tests.
 *
 * ROLE IN PROJECT:
 *    Connects only when the operator supplies a replica-set URI and the P2 test
 *    database prefix, then drops the generated database on close.
 *
 * KEY COMPONENTS:
 *    - nativeDatabase: Connect, reconnect, and drop-only cleanup helpers.
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';

export async function nativeDatabase() {
  const uri = process.env.AURVIN_TEST_MONGODB_URI;
  if (!uri || process.env.AURVIN_TEST_DB_PREFIX !== 'aurvin_p2_test_') {
    throw new Error('Isolated native test configuration is required.');
  }
  const name = `aurvin_p2_test_${randomUUID().replaceAll('-', '')}`;
  const client = new MongoClient(uri, {
    retryWrites: false,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    timeoutMS: 15_000,
    maxIdleTimeMS: 120_000,
    writeConcern: { w: 'majority' },
  });
  try {
    await client.connect();
  } catch {
    await client.close();
    throw new Error('Native test database is unavailable.');
  }
  const db = client.db(name, { writeConcern: { w: 'majority' } });
  return {
    client,
    db,
    name,
    async reconnect() {
      const next = new MongoClient(uri, {
        retryWrites: false,
        serverSelectionTimeoutMS: 10_000,
        connectTimeoutMS: 10_000,
        timeoutMS: 15_000,
        maxIdleTimeMS: 120_000,
        writeConcern: { w: 'majority' },
      });
      try {
        await next.connect();
        return next;
      } catch {
        await next.close();
        throw new Error('Native test reconnection failed.');
      }
    },
    async close() {
      try {
        await db.dropDatabase();
      } finally {
        await client.close();
      }
    },
  };
}
