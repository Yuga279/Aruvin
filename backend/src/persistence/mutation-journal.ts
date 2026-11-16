/**
 * ============================================================================
 * FILE: mutation-journal.ts
 * LOCATION: backend/src/persistence/mutation-journal.ts
 * PURPOSE: Fence every admitted data/DDL write with majority-acknowledged intent.
 * ROLE IN PROJECT: Shared driver facade covers application stores and stock saver.
 *    Unknown results quarantine writes; raw sentinel CAS is the only bypass.
 * KEY COMPONENTS: MutationJournal, guardedClient, bounded global write queue.
 * ============================================================================
 */
import { randomUUID } from 'node:crypto';
import type { Collection, MongoClient } from 'mongodb';
import { AppError } from '../platform/errors/app-error.js';
import { EXECUTOR_SCOPE, key, LOCAL_MUTATION_MODE, type StoredDocument } from './records.js';
import { isAccountingReadPipeline } from './accounting-reporting.js';

export class MutationJournal {
  private tail:Promise<void>=Promise.resolve();
  private queued=0;
  private failed=false;
  private stopped=false;
  constructor(private readonly control:Pick<Collection<StoredDocument>,'updateOne'>,
    readonly ownerId:string,readonly timeoutMs:number,private bootstrapToken:string | null=null) {}
  assertHealthy() {
    if (this.failed || this.stopped || this.bootstrapToken)
      throw new AppError('NOT_READY','Local mutation journal is not ready. Operator recovery may be required.');
  }
  private async transition(from:'idle' | 'busy',to:'idle' | 'busy',token:string) {
    const result=await this.control.updateOne({ _id:key('executor'),...EXECUTOR_SCOPE,kind:'executor',
      ownerId:this.ownerId,'local.mode':LOCAL_MUTATION_MODE,'local.mutation.state':from,
      'local.released':false,
      ...(from === 'busy' ? { 'local.mutation.token':token } : {}),
    },{ $set:{ 'local.mutation':{ state:to,token:to === 'busy' ? token : null } },$inc:{ _revision:1 } },
    { writeConcern:{ w:'majority',j:true },timeoutMS:this.timeoutMs,maxTimeMS:this.timeoutMs });
    if (!result.acknowledged || result.matchedCount !== 1)
      throw new AppError('NOT_READY','Local mutation ownership could not be confirmed.');
  }
  write<T>(action:() => Promise<T>):Promise<T> {
    if (this.failed || this.stopped) return Promise.reject(new AppError('NOT_READY','Local writes have been stopped.'));
    // ponytail: one process-wide write queue, at most 100 jobs; scaling needs a new topology protocol.
    if (this.queued >= 100) return Promise.reject(new AppError('CONCURRENCY_LIMIT','Local write queue is full.'));
    this.queued++;
    const result=this.tail.then(async () => {
      if (this.failed || this.stopped) throw new AppError('NOT_READY','Local writes have been stopped.');
      const token=this.bootstrapToken ?? randomUUID();
      try {
        if (!this.bootstrapToken) await this.transition('idle','busy',token);
        // This is the ONLY dispatch point, after intent ACK (or bootstrap insert ACK).
        const value=await action();
        if (value && typeof value === 'object' && 'acknowledged' in value && value.acknowledged === false)
          throw new AppError('NOT_READY','A local write was not acknowledged.');
        if (!this.bootstrapToken) await this.transition('busy','idle',token);
        return value;
      } catch (error) {
        this.failed=true; // Never clear intent in catch/finally or after a reread.
        throw error;
      }
    });
    this.tail=result.then(() => { this.queued--; },() => { this.queued--; });
    return result;
  }
  async finishBootstrap() {
    await this.tail;
    if (this.failed || !this.bootstrapToken) throw new AppError('NOT_READY','Local setup did not complete.');
    try { await this.transition('busy','idle',this.bootstrapToken); this.bootstrapToken=null; }
    catch (error) { this.failed=true; throw error; }
  }
  async drain() { while (this.queued > 0) await this.tail; await this.tail; }
  async stop() { this.stopped=true; await this.drain(); if (this.failed || this.bootstrapToken)
    throw new AppError('NOT_READY','Uncertain local writes retain their executor sentinel.'); }
}

const mutations:Record<string,number>={ updateOne:2,replaceOne:2,findOneAndUpdate:2,bulkWrite:1,createIndex:1 };
const collections=new Set(['sessions','messages','agent-memory','metadata','checkpoints','checkpoint_writes','integration_connections','users']);
const cursorMethods=new Set(['sort','limit','project','toArray','next','hasNext','close']);
const unsupported=() => new AppError('UNSUPPORTED_TOPOLOGY','An unguarded database API is not admitted in local mode.');

// Empty proxy targets prevent reflective access to the driver's raw internals.
function facade(get:(property:string | symbol) => unknown) {
  return new Proxy(Object.create(null) as object,{ get:(_target,property) => property === 'then' ? undefined : get(property) });
}
function readCursor(raw:Record<string | symbol,unknown>):unknown {
  let wrapped:unknown;
  wrapped=facade(property => {
    if (property === Symbol.asyncIterator) return () => Reflect.apply(raw[Symbol.asyncIterator] as (...a:unknown[]) => unknown,raw,[]);
    if (typeof property !== 'string' || !cursorMethods.has(property)) throw unsupported();
    return (...args:unknown[]) => {
      const value=Reflect.apply(raw[property] as (...a:unknown[]) => unknown,raw,args);
      return value === raw ? wrapped : value;
    };
  });
  return wrapped;
}
export function guardedClient(client:MongoClient,dbName:string,journal:MutationJournal):MongoClient {
  const rawDb=client.db(dbName);
  const db=facade(property => {
    if (property === 'collection') return (name:string) => {
      if (!collections.has(name)) throw unsupported();
      const raw=rawDb.collection(name);
      return facade(method => {
        if (method === 'find') return (...args:unknown[]) => readCursor(Reflect.apply(Reflect.get(raw,'find'),raw,args) as unknown as Record<string | symbol,unknown>);
        if (method === 'findOne') return (...args:unknown[]) => Reflect.apply(Reflect.get(raw,'findOne'),raw,args);
        if (method === 'aggregate') return (pipeline:unknown,options:Record<string,unknown>={}) => {
          if (name !== 'metadata' || !isAccountingReadPipeline(pipeline)
            || Object.keys(options).some(k => k !== 'maxTimeMS' && k !== 'allowDiskUse')
            || options.allowDiskUse !== false) throw unsupported();
          return readCursor(Reflect.apply(Reflect.get(raw,'aggregate'),raw,[pipeline,
            { maxTimeMS:journal.timeoutMs,timeoutMS:journal.timeoutMs,allowDiskUse:false }]) as Record<string | symbol,unknown>);
        };
        if (typeof method !== 'string' || !Object.hasOwn(mutations,method)) throw unsupported();
        return (...args:unknown[]) => {
          const index=mutations[method]; const options=(args[index] ?? {}) as Record<string,unknown>;
          if (options.session) throw unsupported(); // Transaction ACK is not durable commit.
          args[index]={ ...options,writeConcern:{ w:'majority',j:true },timeoutMS:journal.timeoutMs,maxTimeMS:journal.timeoutMs };
          return journal.write(() => Reflect.apply(Reflect.get(raw,method) as (...a:unknown[]) => Promise<unknown>,raw,args));
        };
      });
    };
    if (property === 'command') return (command:Record<string,unknown>,options:unknown) => {
      if (command.ping !== 1 || Object.keys(command).some(k => k !== 'ping' && k !== 'maxTimeMS')) throw unsupported();
      return Reflect.apply(Reflect.get(rawDb,'command'),rawDb,[command,options]);
    };
    throw unsupported();
  });
  return facade(property => {
    if (property === 'db') return (name:string) => { if (name !== dbName) throw unsupported(); return db; };
    if (property === 'appendMetadata') return client.appendMetadata.bind(client);
    throw unsupported();
  }) as MongoClient;
}
