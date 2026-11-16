/**
 * ============================================================================
 * FILE: local-owner.spec.ts
 * LOCATION: backend/test/persistence/local-owner.spec.ts
 * PURPOSE: Prove idle-only conditional handoff and durable recovery ancestry.
 * ROLE IN PROJECT: In-memory raw control boundary; no service connection.
 * KEY COMPONENTS: Late intent fencing, bootstrap uncertainty, release and binding.
 * ============================================================================
 */
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { EXECUTOR_SCOPE, executorSchema, key, LOCAL_MUTATION_MODE, type StoredDocument } from '../../src/persistence/records.js';
import type { RecordStore } from '../../src/persistence/store.js';
import { handoffLocalOwner } from '../../src/operations/local-recovery.js';
import { MutationJournal } from '../../src/persistence/mutation-journal.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { session } from './fixtures.js';

const binding={ machineHash:'a'.repeat(64),installationHash:'e'.repeat(64),pid:1,creation:'123',
  appName:'aurvin-local-first',databaseHash:'b'.repeat(64),guardHash:'d'.repeat(64) };
const current={ ...binding,pid:2,creation:'456',appName:'aurvin-local-second' };
const dead=vi.fn(async () => 'dead' as const);
function fixture() {
  let doc:StoredDocument | null={ _id:key('executor'),_revision:0,schemaVersion:1,kind:'executor',...EXECUTOR_SCOPE,
    ownerId:'first',local:{ mode:LOCAL_MUTATION_MODE,released:false,binding,mutation:{ state:'idle',token:null },ancestors:[],pending:false } };
  const findOne=vi.fn<() => Promise<Record<string,unknown> | null>>(async () => null);
  const matches=(f:Record<string,unknown>) => !!doc && (!f.ownerId || f.ownerId === doc.ownerId) &&
    (f._revision === undefined || f._revision === doc._revision) &&
    (f['local.released'] === undefined || f['local.released'] === doc.local?.released) &&
    (!f['local.mutation.state'] || f['local.mutation.state'] === doc.local?.mutation.state) &&
    (f['local.mutation.token'] === undefined || f['local.mutation.token'] === doc.local?.mutation.token);
  const control={
    replaceOne:vi.fn(async (f:Record<string,unknown>,next:StoredDocument,_options:unknown) => {
      if (!matches(f)) return { acknowledged:true,matchedCount:0 };
      doc=structuredClone(next); return { acknowledged:true,matchedCount:1 };
    }),
    insertOne:vi.fn(async (next:StoredDocument,_options:unknown) => { doc=structuredClone(next); return { acknowledged:true }; }),
    updateOne:vi.fn(async (f:Record<string,unknown>,update:Record<string,Record<string,unknown>>,_options:unknown) => {
      if (!matches(f)) return { acknowledged:true,matchedCount:0 };
      for (const [field,value] of Object.entries(update.$set)) doc!.local[field.replace('local.','')]=value;
      doc!._revision++; return { acknowledged:true,matchedCount:1 };
    }),
    deleteOne:vi.fn(async (f:Record<string,unknown>,_options:unknown) => {
      if (!matches(f)) return { acknowledged:true,deletedCount:0 };
      doc=null; return { acknowledged:true,deletedCount:1 };
    }),findOne,
  };
  const store={ timeoutMs:1000,options:() => ({}),
    raw:vi.fn(async (_collection:string,_filter:unknown):Promise<StoredDocument | null> => structuredClone(doc)),
    read:async () => { if (!doc) return null; const { _id,_revision,...record }=doc; void _id;void _revision; return executorSchema.parse(record); },
    collection:(_name:string) => control,
  } as unknown as RecordStore;
  return { store,control,findOne,get:() => doc!,clear:() => { doc=null; } };
}
async function idle(f:ReturnType<typeof fixture>,ownerId:string,token:string) {
  const journal=new MutationJournal(f.control as never,ownerId,1000,token); await journal.finishBootstrap();
}
it('atomically requires observed owner/revision AND idle marker; bootstrap remains busy until ACKed setup',async () => {
  const f=fixture(); const owner=new MongoOwnership(f.store,'second');
  const { token }=await handoffLocalOwner(owner,current,dead);
  expect(f.control.replaceOne.mock.calls[0][0]).toMatchObject({ ownerId:'first',_revision:0,
    'local.mode':LOCAL_MUTATION_MODE,'local.mutation.state':'idle','local.mutation.token':null });
  expect(f.get().local).toMatchObject({ pending:true,ancestors:['first'],mutation:{ state:'busy',token } });
  await expect(owner.releaseExecutor()).rejects.toMatchObject({ code:'NOT_READY' });
  await idle(f,'second',token); expect(f.get().local.mutation.state).toBe('idle');
});
it('preserves ancestors after a crash between ACKed recovery writes; only completed recovery clears them',async () => {
  const f=fixture(); const second=new MongoOwnership(f.store,'second');
  const { token }=await handoffLocalOwner(second,current,dead); await idle(f,'second',token);
  const third=new MongoOwnership(f.store,'third');
  const next=await handoffLocalOwner(third,{ ...current,pid:3,creation:'789',appName:'aurvin-local-third' },dead);
  expect(next.ancestors).toEqual(['first','second']); await idle(f,'third',next.token);
  f.findOne.mockResolvedValueOnce({ execution:{ ownerId:'first' } });
  await expect(third.finishLocalRecovery()).rejects.toMatchObject({ code:'NOT_READY' });
  expect(f.get().local.pending).toBe(true);
  await third.finishLocalRecovery(); expect(f.get().local).toMatchObject({ pending:false,ancestors:[] });
});
it('rejects a begin-intent winning the race after the idle observation',async () => {
  const f=fixture(); const inspect=async () => {
    f.get().local.mutation={ state:'busy',token:'late-intent' }; f.get()._revision++; return 'dead' as const;
  };
  await expect(handoffLocalOwner(new MongoOwnership(f.store,'second'),current,inspect))
    .rejects.toMatchObject({ code:'UNSUPPORTED_TOPOLOGY' });
  expect(f.get().ownerId).toBe('first');
});
it('fences delayed old begin-intent after handoff wins',async () => {
  const f=fixture(); await handoffLocalOwner(new MongoOwnership(f.store,'second'),current,dead);
  const oldJournal=new MutationJournal(f.control as never,'first',1000);
  const write=vi.fn(async () => undefined);
  await expect(oldJournal.write(write)).rejects.toMatchObject({ code:'NOT_READY' });
  expect(write).not.toHaveBeenCalled(); expect(f.get().ownerId).toBe('second');
});
it('rejects busy, legacy, malformed/future markers, live/reused lifetimes and foreign bindings',async () => {
  for (const process of ['live','reused'] as const) {
    const f=fixture(); await expect(handoffLocalOwner(new MongoOwnership(f.store,'second'),current,async () => process)).rejects.toThrow();
    expect(f.control.replaceOne).not.toHaveBeenCalled();
  }
  for (const change of [{ machineHash:'f'.repeat(64) },{ installationHash:'f'.repeat(64) },
    { databaseHash:'f'.repeat(64) },{ guardHash:'f'.repeat(64) }]) {
    const f=fixture(); await expect(handoffLocalOwner(new MongoOwnership(f.store,'second'),{ ...current,...change },dead)).rejects.toThrow();
    expect(f.control.replaceOne).not.toHaveBeenCalled();
  }
  for (const local of [undefined,{ mode:'future' },{ ...fixture().get().local,mutation:{ state:'busy',token:'busy' } }]) {
    const f=fixture(); f.get().local=local;
    await expect(handoffLocalOwner(new MongoOwnership(f.store,'second'),current,dead)).rejects.toMatchObject({ code:'UNSUPPORTED_TOPOLOGY' });
    expect(f.control.replaceOne).not.toHaveBeenCalled();
  }
});
it('retains a conservative busy sentinel on ambiguous first claim and handoff ACK',async () => {
  const first=fixture(); first.clear();
  first.control.insertOne.mockImplementationOnce(async next => {
    await first.control.insertOne(next,{}); throw new Error('unknown bootstrap ACK'); });
  await expect(new MongoOwnership(first.store,'first').claimExecutor(binding)).rejects.toThrow('unknown bootstrap ACK');
  expect(first.get().local.mutation.state).toBe('busy');
  const f=fixture(); const real=f.control.replaceOne.getMockImplementation()!;
  f.control.replaceOne.mockImplementationOnce(async (...args) => { await real(...args); throw new Error('unknown handoff ACK'); });
  await expect(handoffLocalOwner(new MongoOwnership(f.store,'second'),current,dead)).rejects.toThrow('unknown handoff ACK');
  expect(f.get()).toMatchObject({ ownerId:'second',local:{ pending:true,mutation:{ state:'busy' } } });
});
it('releases only idle, completed owners through raw control; unfinished accepted work keeps the sentinel',async () => {
  const f=fixture(); const owner=new MongoOwnership(f.store,'first');
  f.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ execution:{ activeAttemptId:'accepted' } });
  await expect(owner.releaseExecutor()).rejects.toMatchObject({ code:'NOT_READY' });
  expect(f.control.deleteOne).not.toHaveBeenCalled();
  await owner.releaseExecutor();expect(f.get().local.released).toBe(true);
  expect(f.control.updateOne.mock.calls[0][0]).toMatchObject({ ownerId:'first','local.mutation.state':'idle' });
  expect(f.control.deleteOne).not.toHaveBeenCalled();
  const stale=new MutationJournal(f.control as never,'first',1000);const data=vi.fn(async () => undefined);
  await expect(stale.write(data)).rejects.toMatchObject({ code:'NOT_READY' });expect(data).not.toHaveBeenCalled();
});
it('refuses live reopen of a released sentinel and hands off only after the exact process is dead',async () => {
  const f=fixture(); await new MongoOwnership(f.store,'first').releaseExecutor();
  expect(f.get().local.released).toBe(true);
  await expect(handoffLocalOwner(new MongoOwnership(f.store,'second'),current,async () => 'live')).rejects.toThrow();
  expect(f.get().ownerId).toBe('first'); expect(f.control.replaceOne).not.toHaveBeenCalled();
  await handoffLocalOwner(new MongoOwnership(f.store,'second'),current,dead);
  expect(f.get()).toMatchObject({ ownerId:'second',local:{ released:false,pending:true,ancestors:['first'] } });
});
it('includes owner-only leftovers and preserves that filter when advancing a bounded recovery page',async () => {
  const record=session(); record.execution.ownerId='previous';
  const docs=[{ ...record,_id:'1',_revision:0 },{ ...record,sessionId:'s2',_id:'2',_revision:0 }];
  const find=vi.fn((_filter:Record<string,unknown>,_options:unknown) => ({ sort:() => ({ limit:() => ({ toArray:async () => docs }) }) }));
  const store={ options:() => ({}),collection:() => ({ find }) } as unknown as RecordStore;
  const sessions=new MongoSessions(store,DEFAULT_BUDGETS);
  const first=await sessions.listForRecovery('u1',{ limit:1,cursor:null });
  expect(first.items[0].execution).toMatchObject({ ownerId:'previous',activeAttemptId:null });
  await sessions.listForRecovery('u1',{ limit:1,cursor:first.nextCursor });
  expect(find.mock.calls[1][0].$or).toEqual([{ 'execution.activeAttemptId':{ $ne:null } },{ 'execution.ownerId':{ $ne:null } }]);
  expect(find.mock.calls[1][0].$and).toHaveLength(1);
});
