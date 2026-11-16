/**
 * ============================================================================
 * FILE: persistence.ts
 * LOCATION: backend/src/persistence/persistence.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compose the exportable persistence bundle and native-only open helper.
 *
 * ROLE IN PROJECT:
 *    Claims the executor, sets up indexes and the standard saver, and returns
 *    repository adapters without wiring Nest entry points.
 *
 * KEY COMPONENTS:
 *    - createPersistenceBundle: Connected-client composition for tests and P9.
 *    - openPersistence: Native MongoDB profile only until Azure activation.
 * ============================================================================
 */

import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import type { BudgetConfig } from '../contracts/budgets.js';
import type { AurvinConfig } from '../platform/config/load-config.js';
import { AppError } from '../platform/errors/app-error.js';
import { MongoCheckpointFactory } from './checkpoints.js';
import { setupIndexes } from './indexes.js';
import { MongoMemory } from './memory.js';
import { MongoMessages } from './messages.js';
import { MongoMetadata } from './metadata.js';
import { MongoOwnership } from './ownership.js';
import { MongoSessions } from './sessions.js';
import { MongoUsers } from './users.js';
import { MongoCalendarAccounting } from './calendar-accounting.js';
import { MongoCalendarConnections } from './calendar-connections.js';
import { MongoCalendarDecisions, MongoCalendarResults } from './calendar-evidence.js';
import { MongoCalendarOperations } from './calendar-operations.js';
import { MongoCalendarRetention } from './calendar-retention.js';
import { MongoCalendarProposals } from './calendar-proposals.js';
import { RecordStore } from './store.js';
import { acquireLocalGuard } from '../operations/local-guard.js';
import { handoffLocalOwner } from '../operations/local-recovery.js';
import { key, type LocalBinding } from './records.js';
import { MutationJournal, guardedClient } from './mutation-journal.js';
import { observeDatabaseCommands } from './database-observation.js';
import type { Telemetry } from '../operations/telemetry.js';

export async function createPersistenceBundle(
  client: MongoClient,
  dbName: string,
  budgets: BudgetConfig,
  executorId?: string,
  local?: { controlStore:RecordStore; journal:MutationJournal },
  diagnosticsSource: MongoClient = client,
) {
  const store = new RecordStore(client.db(dbName), budgets.persistenceTimeoutMs);
  const owner = new MongoOwnership(store, executorId,Date.now,local?.controlStore ?? store,local?.journal);
  if (!local) await owner.claimExecutor();
  try {
    await setupIndexes(store.db);
    const checkpoints = new MongoCheckpointFactory(client, dbName, owner, budgets);
    const checkpointer = await checkpoints.create();
    await checkpointer.setup();
    await local?.journal.finishBootstrap();
    const calendarConnections = new MongoCalendarConnections(store, budgets);
    const calendarOperations = new MongoCalendarOperations(store, budgets);
    const calendarDecisions = new MongoCalendarDecisions(store, budgets);
    const calendarResults = new MongoCalendarResults(store, budgets);
    const calendarAccounting = new MongoCalendarAccounting(store, budgets);
    const calendarRetention = new MongoCalendarRetention(store, budgets);
    const calendarProposals = new MongoCalendarProposals(store, budgets);
    let stopObserving: (() => void) | undefined;
    return {
      sessions: new MongoSessions(store, budgets),
      users: new MongoUsers(store, owner, budgets.maxDocumentBytes),
      messages: new MongoMessages(store, budgets),
      memory: new MongoMemory(store, budgets),
      metadata: new MongoMetadata(store, budgets),
      calendarConnections,
      calendarOperations,
      calendarDecisions,
      calendarResults,
      calendarAccounting,
      calendarRetention,
      calendarConnectionsV2: calendarConnections.v2,
      calendarOperationsV2: calendarOperations.v2,
      calendarDecisionsV2: calendarDecisions.v2,
      calendarResultsV2: calendarResults.v2,
      skillDecisions: calendarDecisions.skills,
      skillResults: calendarResults.skills,
      calendarAccountingV2: calendarAccounting.v2,
      calendarProposals,
      owner,
      checkpoints,
      observeDatabase(telemetry: Telemetry): () => void {
        if (!stopObserving) stopObserving = observeDatabaseCommands(diagnosticsSource, dbName, telemetry);
        return () => { stopObserving?.(); stopObserving = undefined; };
      },
      disposeDatabaseObservation(): void { stopObserving?.(); stopObserving = undefined; },
      async ping(): Promise<boolean> {
        try {
          await store.db.command(
            { ping: 1, maxTimeMS: budgets.persistenceTimeoutMs },
            { timeoutMS: budgets.persistenceTimeoutMs },
          );
          return true;
        } catch {
          return false;
        }
      },
    };
  } catch (error) {
    if (!local) await owner.releaseExecutor(); // Local uncertainty/pending evidence is never discarded on setup failure.
    throw error;
  }
}

export type PersistenceBundle = Awaited<ReturnType<typeof createPersistenceBundle>>;

export async function openPersistence(config: AurvinConfig) {
  const executorId = randomUUID();
  if (config.topology.executor !== 'single-process') {
    throw new AppError('UNSUPPORTED_TOPOLOGY', 'Only one executor is supported.');
  }
  if (!config.persistence.mongoUri) {
    throw new AppError('NOT_READY', 'The persistence service has not been verified.');
  }
  let guard:Awaited<ReturnType<typeof acquireLocalGuard>> | undefined;
  let journal:MutationJournal | undefined;
  if (config.topology.localCrashRecovery) {
    if (config.persistence.profile !== 'native-mongodb')
      throw new AppError('UNSUPPORTED_TOPOLOGY', 'Local recovery requires native MongoDB.');
  }
  const client = new MongoClient(config.persistence.mongoUri, {
    appName: `${config.topology.localCrashRecovery ? 'aurvin-local' : 'aurvin'}-${executorId}`,
    monitorCommands: true,
    retryWrites: false,
    maxIdleTimeMS: 120_000,
    connectTimeoutMS: config.budgets.connectTimeoutMs,
    serverSelectionTimeoutMS: config.budgets.connectTimeoutMs,
    timeoutMS: config.budgets.persistenceTimeoutMs,
    writeConcern: { w: 'majority', ...(config.topology.localCrashRecovery ? { j:true } : {}) },
    ...(config.topology.localCrashRecovery ? { readPreference:'primary' as const,readConcern:{ level:'majority' } } : {}),
  });
  try {
    if (config.topology.localCrashRecovery) {
      guard=await acquireLocalGuard(key('configured-local-db',config.persistence.mongoUri,config.persistence.mongoDbName));
      guard.assertHeld();
    }
    if (guard && (!client.options.replicaSet || client.options.loadBalanced || client.options.directConnection))
      throw new AppError('UNSUPPORTED_TOPOLOGY','Local recovery requires an explicit native replica-set URI.');
    await client.connect();
    let admittedClient=client;
    let local: { controlStore:RecordStore; journal:MutationJournal } | undefined;
    if (guard) {
      const hello=await client.db('admin').command({ hello:1,maxTimeMS:config.budgets.persistenceTimeoutMs },
        { timeoutMS:config.budgets.persistenceTimeoutMs });
      if (hello.setName !== client.options.replicaSet || hello.isWritablePrimary !== true || hello.msg === 'isdbgrid')
        throw new AppError('UNSUPPORTED_TOPOLOGY','The configured native replica-set primary is not verified.');
      const controlStore=new RecordStore(client.db(config.persistence.mongoDbName),config.budgets.persistenceTimeoutMs);
      const owner=new MongoOwnership(controlStore,executorId);
      const binding:LocalBinding={ machineHash:guard.machineHash,installationHash:guard.installationHash,pid:guard.pid,
        creation:guard.creation,guardHash:guard.guardHash,appName:`aurvin-local-${executorId}`,
        databaseHash:key('exact-configured-database',config.persistence.mongoUri,config.persistence.mongoDbName) };
      const previous=await controlStore.raw('metadata',{ _id:key('executor') });
      guard.assertHeld();
      if (previous) await handoffLocalOwner(owner,binding);
      else await owner.claimExecutor(binding);
      const observed=await owner.observedExecutor();
      if (observed.record.ownerId !== executorId || observed.record.local?.mutation.state !== 'busy')
        throw new AppError('UNSUPPORTED_TOPOLOGY','Local bootstrap ownership is unavailable.');
      journal=new MutationJournal(controlStore.collection('metadata'),executorId,config.budgets.persistenceTimeoutMs,
        observed.record.local.mutation.token);
      local={ controlStore,journal };
      admittedClient=guardedClient(client,config.persistence.mongoDbName,journal);
    }
    const bundle = await createPersistenceBundle(
      admittedClient,
      config.persistence.mongoDbName,
      config.budgets,
      executorId,
      local,
      client,
    );
    guard?.assertHeld();
    return {
      ...bundle,
      async close(): Promise<void> {
        if (journal) {
          try {
            await bundle.owner.drain(); await journal.stop(); await bundle.owner.releaseExecutor();
          } finally { bundle.disposeDatabaseObservation(); try { await client.close(); } finally { await guard?.close(); } }
          return;
        }
        await bundle.owner.drain();
        await bundle.owner.releaseExecutor();
        bundle.disposeDatabaseObservation();
        await client.close();
      },
    };
  } catch (error) {
    try { await client.close(); } finally { await guard?.close(); }
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('NOT_READY', 'Chat storage is unavailable.');
  }
}
