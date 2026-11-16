/**
 * ============================================================================
 * FILE: local-open.spec.ts
 * LOCATION: backend/test/persistence/local-open.spec.ts
 * PURPOSE: Exercise production local bootstrap/close with a network-disabled driver.
 * ROLE IN PROJECT: Real MongoClient options, stock saver and OS guard; fake I/O.
 * KEY COMPONENTS: ACKed busy bootstrap, setup failure retention, graceful release.
 * ============================================================================
 */
import { MongoClient, type Db } from 'mongodb';
import { loadConfig } from '../../src/platform/config/load-config.js';
import { openPersistence } from '../../src/persistence/persistence.js';
import { key, type StoredDocument } from '../../src/persistence/records.js';
import { acquireLocalGuard } from '../../src/operations/local-guard.js';
import { randomUUID } from 'node:crypto';
import { APP_INDEXES, CALENDAR_INDEXES } from '../../src/persistence/indexes.js';
import { Telemetry } from '../../src/operations/telemetry.js';

function fixture(failSetup=false) {
  let doc:StoredDocument | null=null; const events:string[]=[];
  const collections=new Map<string,object>();
  for (const name of ['metadata','sessions','messages','agent-memory','checkpoints','checkpoint_writes','integration_connections','users']) {
    collections.set(name,{
      findOne:async () => name === 'metadata' ? doc : null,
      insertOne:async (next:StoredDocument) => { doc=structuredClone(next);events.push('claim-busy');return { acknowledged:true }; },
      updateOne:async (filter:Record<string,unknown>,update:Record<string,Record<string,unknown>>) => {
        if (!doc || filter.ownerId !== doc.ownerId || filter['local.mutation.state'] !== doc.local.mutation.state)
          return { acknowledged:true,matchedCount:0 };
        for (const [field,value] of Object.entries(update.$set)) doc.local[field.replace('local.','')]=value;
        doc._revision++;events.push(update.$set['local.released'] ? 'release' : 'idle');return { acknowledged:true,matchedCount:1 };
      },
      createIndex:async () => {
        expect(doc?.local.mutation.state).toBe('busy');events.push(`ddl:${name}`);
        if (failSetup) throw new Error('Unknown DDL result.');return 'index';
      },
      deleteOne:async (filter:Record<string,unknown>) => {
        expect(filter).toMatchObject({ ownerId:doc?.ownerId,_revision:doc?._revision,'local.mutation.state':'idle' });
        doc=null;events.push('release');return { acknowledged:true,deletedCount:1 };
      },
    });
  }
  const db={ collection:(name:string) => collections.get(name),command:async (cmd:Record<string,unknown>) =>
    cmd.hello ? { setName:'fixture',isWritablePrimary:true } : { ok:1 } } as unknown as Db;
  let client:MongoClient | undefined;
  const connect=vi.spyOn(MongoClient.prototype,'connect').mockImplementation(async function(this:MongoClient) { client=this; return this; });
  const getDb=vi.spyOn(MongoClient.prototype,'db').mockReturnValue(db);
  const close=vi.spyOn(MongoClient.prototype,'close').mockImplementation(async () => { events.push('close-client'); });
  const config=loadConfig({ AURVIN_LOCAL_CRASH_RECOVERY:'true',PERSISTENCE_PROFILE:'native-mongodb',
    MONGODB_URI:`mongodb://never-connect.invalid/?replicaSet=fixture&appName=ignored`,
    MONGODB_DB_NAME:`fixture-${randomUUID()}` });
  return { config,events,get:() => doc,client:() => client,restore:() => { connect.mockRestore();getDb.mockRestore();close.mockRestore(); } };
}
it.skipIf(process.platform !== 'win32')('removes raw-client observation listeners on the existing close path',async () => {
  const f=fixture();
  try {
    const opened=await openPersistence(f.config);
    opened.observeDatabase(new Telemetry(() => undefined));
    expect(f.client()!.listenerCount('commandStarted')).toBe(1);
    await opened.close();
    expect(f.client()!.listenerCount('commandStarted')).toBe(0);
  } finally { f.restore(); }
},15000);
it.skipIf(process.platform !== 'win32')('production opt-in completes guarded setup and graceful raw release without any network',async () => {
  const f=fixture();
  try {
    const opened=await openPersistence(f.config);
    expect(f.get()?.local).toMatchObject({ mode:'local-mutation-v1',mutation:{ state:'idle',token:null },pending:false });
    expect(f.get()?.local.binding.databaseHash).toBe(key('exact-configured-database',f.config.persistence.mongoUri,f.config.persistence.mongoDbName));
    expect(f.events.filter(e => e.startsWith('ddl:'))).toHaveLength(APP_INDEXES.length + CALENDAR_INDEXES.length + 2);
    await opened.close();expect(f.get()?.local.released).toBe(true);expect(f.events.slice(-2)).toEqual(['release','close-client']);
    const guard=await acquireLocalGuard(key('configured-local-db',f.config.persistence.mongoUri,f.config.persistence.mongoDbName));
    await guard.close(); // Guard is released only after client cleanup, provenance is retained.
  } finally { f.restore(); }
},15000);
it.skipIf(process.platform !== 'win32')('ambiguous setup leaves a busy sentinel and cannot quietly auto-admit the next process',async () => {
  const f=fixture(true);
  try {
    await expect(openPersistence(f.config)).rejects.toMatchObject({ code:'NOT_READY' });
    expect(f.get()?.local.mutation.state).toBe('busy');expect(f.events).not.toContain('release');
    await expect(openPersistence(f.config)).rejects.toMatchObject({ code:'UNSUPPORTED_TOPOLOGY' });
    expect(f.get()?.local.mutation.state).toBe('busy');
  } finally { f.restore(); }
},15000);
