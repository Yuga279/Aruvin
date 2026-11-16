/**
 * ============================================================================
 * FILE: native-database.ts
 * LOCATION: backend/test/performance/native-database.ts
 * PURPOSE: Open only an explicitly approved, generated native test database.
 * ROLE IN PROJECT: Preconnect authorization, replica verification and drop cleanup.
 * KEY COMPONENTS: openNativePerformanceDatabase; injectable offline client factory.
 * ============================================================================
 */
import { randomUUID } from 'node:crypto';
import { MongoClient, type MongoClientOptions } from 'mongodb';
import { authorizeNative } from './native-safety.js';

export async function openNativePerformanceDatabase(
  env: NodeJS.ProcessEnv = process.env,
  construct: (uri: string, options: MongoClientOptions) => MongoClient = (uri, options) => new MongoClient(uri, options),
) {
  const authorization = authorizeNative(env); // Before client construction, not just before connect.
  const name = `aurvin_p2_test_${randomUUID().replaceAll('-', '')}`;
  let client: MongoClient | undefined;
  try {
    client = construct(authorization.uri, {
      replicaSet: authorization.replicaSet, monitorCommands: true, retryWrites: false,
      directConnection: false, loadBalanced: false, readPreference: 'primary',
      connectTimeoutMS: 10_000, serverSelectionTimeoutMS: 10_000, timeoutMS: 15_000,
      maxIdleTimeMS: 120_000, writeConcern: { w: 'majority' },
    });
    await client.connect();
    const hello = await client.db('admin').command({ hello: 1, maxTimeMS: 10_000 });
    if (hello.setName !== authorization.replicaSet || hello.isWritablePrimary !== true || hello.msg === 'isdbgrid') {
      throw new Error('Replica-set verification failed.');
    }
    const db = client.db(name, { writeConcern: { w: 'majority' } });
    const connected = client;
    return { client: connected, db, name,
      provenance: { revision: authorization.revision, label: authorization.label, samples: authorization.samples },
      async close() {
        let failure: Error | undefined;
        try { await db.dropDatabase(); }
        catch { failure = new Error(`Generated native test database ${name} cleanup failed; operator cleanup required.`); }
        try { await connected.close(); }
        catch { failure ??= new Error(`Native test client cleanup failed for ${name}; details suppressed.`); }
        if (failure) throw failure;
      },
    };
  } catch {
    try { await client?.close(); }
    catch { throw new Error('Native performance setup and client cleanup failed; details suppressed.'); }
    // Driver diagnostics can contain URI/host/auth details. Never forward them.
    throw new Error('Authorized native performance database setup failed; connection details suppressed.');
  }
}
