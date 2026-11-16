/**
 * ============================================================================
 * FILE: persistence.azure.spec.ts
 * LOCATION: backend/test/compatibility/persistence.azure.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Fail closed unless an authorized isolated selected-service target is provided.
 *
 * ROLE IN PROJECT:
 *    Exercises six collections and the stock saver on the actual Azure API only
 *    after operator facts, URI, database name, and authorization are present.
 *
 * KEY COMPONENTS:
 *    - Facts/authorization gate: Missing input fails; it is not a green skip.
 *    - Actual-service workload: Bounded writes, indexes, and BSON headroom.
 * ============================================================================
 */

import { emptyCheckpoint } from '@langchain/langgraph-checkpoint';
import { BSON, MongoClient } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/index.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { graphThreadId, key } from '../../src/persistence/records.js';
import { hashPayload } from '../../src/platform/crypto/hash-payload.js';
import {
  accounting,
  attempt,
  manifest,
  message,
  session,
} from '../persistence/fixtures.js';
import { parseServiceFacts } from './service-facts.js';

describe('selected Azure service compatibility — real isolated target only', () => {
  it('requires facts and exercises six collections and stock saver on the actual API', async () => {
    const facts = parseServiceFacts(process.env.AURVIN_AZURE_TEST_FACTS_JSON);
    const uri = process.env.AURVIN_AZURE_TEST_URI;
    const dbName = process.env.AURVIN_AZURE_TEST_DB_NAME;
    if (
      !uri ||
      !dbName?.startsWith('aurvin_p2_azure_test_') ||
      process.env.AURVIN_AZURE_TEST_AUTHORIZED !== 'yes'
    ) {
      throw new Error(
        'Authorized isolated Azure test target is required; compatibility is blocked.',
      );
    }
    const client = new MongoClient(uri, {
      retryWrites: false,
      maxIdleTimeMS: 120_000,
      connectTimeoutMS: 10_000,
      serverSelectionTimeoutMS: 10_000,
      timeoutMS: 15_000,
    });
    await client.connect();
    const db = client.db(dbName);
    const userId = 'u1';
    const sessionId = 's1';
    try {
      const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(
        (collection) => collection.name,
      );
      for (const collection of [
        'sessions',
        'messages',
        'agent-memory',
        'metadata',
        'checkpoints',
        'checkpoint_writes',
      ]) {
        expect(names).toContain(collection);
      }
      for (const collection of names) {
        expect(await db.collection(collection).findOne({})).toBeNull();
      }
      const bundle = await createPersistenceBundle(
        client,
        dbName,
        DEFAULT_BUDGETS,
        'azure-test-executor',
      );
      await bundle.sessions.createIfAbsent(session());
      const owned = await bundle.owner.acquire({
        userId,
        sessionId,
        ownerId: 'azure-test-executor',
        leaseMs: 60_000,
      });
      if (!owned.ok) {
        throw new Error('Expected exclusive selected-service ownership.');
      }
      await bundle.owner.reserveAttempt(owned.lease, 'a1');
      await bundle.owner.allocateSequences(owned.lease, 'service-reservation', 3);
      await bundle.owner.run(owned.lease, async () => {
        await bundle.messages.append(message());
        await bundle.messages.append(message());
        await bundle.metadata.putAttempt({
          ...attempt(),
          payloadHash: hashPayload(message().content),
        });
      });
      await bundle.owner.confirmAcceptance(owned.lease, 'a1');
      await bundle.owner.run(owned.lease, async () => {
        await bundle.memory.put(manifest());
        await bundle.metadata.putAccounting(accounting());
      });
      const handle = await bundle.checkpoints.create();
      await handle.setup();
      const saver = handle.bind(owned.lease);
      const checkpoint = emptyCheckpoint();
      checkpoint.channel_values = { result: { text: 'saved result', attemptId: 'a1' } };
      const saved = await saver.put(
        { configurable: { thread_id: graphThreadId(userId, sessionId), checkpoint_ns: '' } },
        checkpoint,
        { source: 'update', step: 1, parents: {} },
      );
      await saver.putWrites(saved, [['result', 'pending']], 'service-task');
      await saver.putWrites(saved, [['result', 'pending']], 'service-task');
      expect((await saver.getTuple(saved))?.pendingWrites).toHaveLength(1);
      expect(
        (await bundle.messages.list(userId, sessionId, { cursor: null, limit: 2 })).items,
      ).toHaveLength(1);
      expect(await db.collection('messages').countDocuments({ userId, sessionId })).toBe(1);
      for (const collection of [
        'sessions',
        'messages',
        'agent-memory',
        'metadata',
        'checkpoints',
        'checkpoint_writes',
      ]) {
        const docs = await db.collection(collection).find({}).limit(100).toArray();
        expect(docs.length).toBeGreaterThan(0);
        for (const doc of docs) {
          expect(BSON.calculateObjectSize(doc) + 256).toBeLessThanOrEqual(1_800_000);
        }
        for (const index of await db.collection(collection).indexes()) {
          if (index.name !== '_id_') {
            expect(index.unique).not.toBe(true);
            expect(index.expireAfterSeconds).toBeUndefined();
          }
        }
      }
      expect(facts.documentLimitBytes).toBeGreaterThan(1_800_000);
      expect(key('message', userId, sessionId, 'm0')).toHaveLength(64);
    } finally {
      await client.close();
    }
  }, 120_000);
});
