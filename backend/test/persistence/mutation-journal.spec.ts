/**
 * ============================================================================
 * FILE: mutation-journal.spec.ts
 * LOCATION: backend/test/persistence/mutation-journal.spec.ts
 * PURPOSE: Verify durable write intent and fail-closed driver coverage offline.
 * ROLE IN PROJECT: Fake driver never contacts MongoDB or application env.
 * KEY COMPONENTS: ACK ordering, retained busy intent, saver coverage, escape refusal.
 * ============================================================================
 */
import { MutationJournal, guardedClient } from '../../src/persistence/mutation-journal.js';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { RecordStore } from '../../src/persistence/store.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { attempt, message, session } from './fixtures.js';
import { accountingTotalsPipeline } from '../../src/persistence/accounting-reporting.js';

function fixture() {
  const events:string[]=[]; let resolveAck!:() => void;
  const ack=new Promise<void>(r => { resolveAck=r; });
  const control={ updateOne:vi.fn<(...args:unknown[]) => Promise<{ acknowledged:boolean;matchedCount:number }>>().mockImplementationOnce(async () => {
    events.push('intent'); await ack; return { acknowledged:true,matchedCount:1 };
  }).mockImplementation(async () => { events.push('idle'); return { acknowledged:true,matchedCount:1 }; }) };
  const collection={ updateOne:vi.fn(async (..._args:unknown[]) => { events.push('data'); return { acknowledged:true }; }),
    findOne:vi.fn<(...args:unknown[]) => Promise<Record<string,unknown> | null>>(async () => null),
    findOneAndUpdate:vi.fn(async () => ({ ...session('u','s'),execution:{ ownerId:'owner',activeAttemptId:null,
      leaseExpiresAt:new Date(Date.now()+180000).toISOString(),generation:1 } })),
    bulkWrite:vi.fn(async () => ({ acknowledged:true })),createIndex:vi.fn(async () => 'index'),
    find:vi.fn(() => ({ sort() { return this; },limit() { return this; },toArray:async () => [] })),
    aggregate:vi.fn(() => ({ toArray:async () => [{ input: [], rows: [] }] })),
  };
  const client={ db:vi.fn(() => ({ collection:() => collection,command:vi.fn(async () => ({ ok:1 })) })),appendMetadata:vi.fn() };
  const journal=new MutationJournal(control as never,'owner',1000);
  return { journal,client,collection,control,events,resolveAck };
}
it('does not dispatch a data mutation until owner-bound majority intent ACK; then clears only after data completion',async () => {
  const f=fixture(); const client=guardedClient(f.client as never,'db',f.journal);
  const saving=client.db('db').collection('sessions').updateOne({}, { $set:{ title:'fixture' } });
  await Promise.resolve(); await Promise.resolve(); expect(f.collection.updateOne).not.toHaveBeenCalled();
  f.resolveAck(); await saving; expect(f.events).toEqual(['intent','data','idle']);
  expect(f.control.updateOne.mock.calls[0][0]).toMatchObject({ ownerId:'owner','local.mutation.state':'idle' });
  expect(f.collection.updateOne.mock.calls[0][2]).toMatchObject({ writeConcern:{ w:'majority',j:true } });
});
it('admits only the frozen bounded accounting read pipeline, with no mutation intent or output escape', async () => {
  const f = fixture(); const client = guardedClient(f.client as never, 'db', f.journal);
  const q = { start: '2026-10-06T00:00:00.000Z', end: '2026-10-07T00:00:00.000Z', limit: 20 };
  const pipeline = accountingTotalsPipeline(q);
  const metadata = new MongoMetadata(new RecordStore(client.db('db'), 1000), DEFAULT_BUDGETS);
  expect(await metadata.accountingTotals(q)).toEqual({ items: [], nextCursor: null });
  expect(f.collection.aggregate).toHaveBeenCalledTimes(1);
  expect(f.control.updateOne).not.toHaveBeenCalled();
  expect(() => pipeline.push({ $out: 'metadata' })).toThrow();
  expect(() => client.db('db').collection('metadata').aggregate([...pipeline])).toThrow();
  expect(() => client.db('db').collection('metadata').aggregate([{ $merge: 'metadata' }])).toThrow();
  expect(() => client.db('db').collection('messages').aggregate(pipeline)).toThrow();
  expect(() => client.db('db').collection('metadata').aggregate(pipeline, { session: {} as never })).toThrow();
});
it('retains busy on thrown/unknown data result and refuses all subsequent mutation and admission',async () => {
  const f=fixture(); f.resolveAck(); f.collection.updateOne.mockRejectedValueOnce(new Error('unknown write'));
  const client=guardedClient(f.client as never,'db',f.journal);
  await expect(client.db('db').collection('messages').updateOne({},{})).rejects.toThrow('unknown write');
  expect(f.control.updateOne).toHaveBeenCalledTimes(1);
  expect(() => f.journal.assertHealthy()).toThrow();
  await expect(client.db('db').collection('sessions').updateOne({},{})).rejects.toMatchObject({ code:'NOT_READY' });
});
it('fences rejected/unknown begin-intent before any data dispatch',async () => {
  const f=fixture(); f.control.updateOne.mockReset().mockResolvedValue({ acknowledged:true,matchedCount:0 });
  await expect(f.journal.write(async () => { f.events.push('data'); })).rejects.toMatchObject({ code:'NOT_READY' });
  expect(f.events).not.toContain('data');
});
it('covers stock saver setup/checkpoint/pending writes and raw session writes; reads do not mark intent',async () => {
  const f=fixture(); f.resolveAck(); const client=guardedClient(f.client as never,'db',f.journal);
  const saver=new MongoDBSaver({ client,dbName:'db' });
  expect(await saver.setup()).toEqual([]);
  await saver.put({ configurable:{ thread_id:'s',checkpoint_ns:'' } },
    { v:4,id:'checkpoint',ts:new Date().toISOString(),channel_values:{},channel_versions:{},versions_seen:{} },
    { source:'input',step:0,parents:{} });
  await saver.putWrites({ configurable:{ thread_id:'s',checkpoint_ns:'',checkpoint_id:'checkpoint' } },[['fixture','value']],'task');
  const calls=f.control.updateOne.mock.calls.length;
  await client.db('db').collection('sessions').find({}).sort({ sessionId:1 }).limit(1).toArray();
  expect(f.control.updateOne).toHaveBeenCalledTimes(calls);
  expect(f.collection.createIndex).toHaveBeenCalledTimes(2); expect(f.collection.bulkWrite).toHaveBeenCalledTimes(1);
  expect(calls).toBe(8);
});
it('guards session creation before acquire AND direct ownership session writes through the same facade',async () => {
  const f=fixture();f.resolveAck();const client=guardedClient(f.client as never,'db',f.journal);
  const store=new RecordStore(client.db('db'),1000);
  const record=session('u','s');f.collection.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...record,_id:'session',_revision:0 });
  await new MongoSessions(store,DEFAULT_BUDGETS).createIfAbsent(record);
  const control={ read:async () => ({ ownerId:'owner' }) } as unknown as RecordStore;
  const owner=new MongoOwnership(store,'owner',Date.now,control,f.journal);
  await owner.recoverStoppedSession('u','s','previous',180000);
  expect(f.collection.updateOne).toHaveBeenCalledTimes(1);expect(f.collection.findOneAndUpdate).toHaveBeenCalledTimes(1);
  expect(f.control.updateOne).toHaveBeenCalledTimes(4);
});
it('stops new mutations, drains existing ACKed work, and quarantines an ambiguous clear without quiet retry',async () => {
  const f=fixture();f.resolveAck();
  await f.journal.write(async () => undefined);await f.journal.stop();
  await expect(f.journal.write(async () => undefined)).rejects.toMatchObject({ code:'NOT_READY' });
  const unknown=fixture();unknown.resolveAck();
  unknown.control.updateOne.mockReset().mockImplementationOnce(async () => ({ acknowledged:true,matchedCount:1 }))
    .mockImplementationOnce(async () => { throw new Error('Unknown clear ACK.'); });
  await expect(unknown.journal.write(async () => undefined)).rejects.toThrow('Unknown clear ACK.');
  expect(() => unknown.journal.assertHealthy()).toThrow();expect(unknown.control.updateOne).toHaveBeenCalledTimes(2);
});
it('rejects the 101st queued write without dispatching it or extra intent',async () => {
  const f=fixture();
  const jobs=Array.from({ length:100 },() => f.journal.write(async () => { f.events.push('data'); }));
  await Promise.resolve(); await Promise.resolve();
  await expect(f.journal.write(async () => { f.events.push('overflow'); })).rejects.toMatchObject({ code:'CONCURRENCY_LIMIT' });
  expect(f.events).toEqual(['intent']); expect(f.collection.updateOne).not.toHaveBeenCalled();
  f.resolveAck(); await Promise.all(jobs); expect(f.events.filter(e => e === 'data')).toHaveLength(100);
  expect(f.events).not.toContain('overflow');
});
it('drain does not finish while an ACKed write is still in flight',async () => {
  const f=fixture(); f.control.updateOne.mockReset().mockResolvedValue({ acknowledged:true,matchedCount:1 });
  let release!:() => void; const held=new Promise<void>(r => { release=r; });
  const writing=f.journal.write(async () => held);
  let drained=false; const draining=f.journal.drain().then(() => { drained=true; });
  await vi.waitFor(() => { expect(f.control.updateOne).toHaveBeenCalled(); });
  expect(drained).toBe(false);
  release(); await writing; await draining; expect(drained).toBe(true);
  await f.journal.stop();
  await expect(f.journal.write(async () => undefined)).rejects.toMatchObject({ code:'NOT_READY' });
});
it('blocks uncovered mutation methods, commands, aggregate output, client/database and cursor escapes',async () => {
  const f=fixture(); const client=guardedClient(f.client as never,'db',f.journal);
  const db=client.db('db'); const collection=db.collection('sessions');
  expect(() => client.db('other')).toThrow();
  expect(() => collection.insertMany([])).toThrow();
  expect(() => Reflect.apply(Reflect.get(collection,'toString'),collection,[])).toThrow();
  expect(() => db.command({ drop:'sessions' })).toThrow();
  expect(() => collection.aggregate([{ $out:'escape' }])).toThrow();
  expect(() => collection.find({}).client).toThrow();
  expect(() => (db as never as { client:unknown }).client).toThrow();
  expect(f.control.updateOne).not.toHaveBeenCalled();
});

it('journals delivery create and CAS through the same guarded metadata facade', async () => {
  const f = fixture(); f.resolveAck();
  const client = guardedClient(f.client as never, 'db', f.journal);
  const store = new RecordStore(client.db('db'), 1000);
  const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
  const value = voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a1', status: 'pending', textGenerated: 'Hello. More.' });
  const linkedInput = { ...message(), mode: 'live', visibility: 'internal' };
  f.collection.findOne.mockResolvedValueOnce({ ...attempt(), _id: 'attempt', _revision: 0 })
    .mockResolvedValueOnce({ ...linkedInput, _id: 'input', _revision: 0 })
    .mockResolvedValueOnce({ ...value, _id: 'delivery', _revision: 0 });
  await metadata.putVoiceDelivery(value);
  expect(f.control.updateOne).toHaveBeenCalledTimes(2);
  expect(f.collection.updateOne).toHaveBeenCalledTimes(1);
  expect(f.collection.updateOne.mock.calls[0]?.[2]).toMatchObject({ writeConcern: { w: 'majority', j: true } });

  const rawCollection = f.collection as typeof f.collection & { replaceOne: ReturnType<typeof vi.fn> };
  rawCollection.replaceOne = vi.fn(async () => ({ acknowledged: true, matchedCount: 1 }));
  f.collection.findOne.mockResolvedValueOnce({ ...attempt(), _id: 'attempt', _revision: 0 })
    .mockResolvedValueOnce({ ...linkedInput, _id: 'input', _revision: 0 })
    .mockResolvedValueOnce({ ...value, _id: 'delivery', _revision: 0 });
  expect(await metadata.compareVoiceDelivery({ ...value, sequence: 2, eventId: 'delivery-2', status: 'interrupted',
    textSpoken: 'Hello.', textRemaining: ' More.' }, 1)).toBe(true);
  expect(f.control.updateOne).toHaveBeenCalledTimes(4);
  expect(rawCollection.replaceOne.mock.calls[0]?.[2]).toMatchObject({ writeConcern: { w: 'majority', j: true } });
  expect(f.events.filter(event => event === 'intent')).toHaveLength(1);
  expect(() => f.journal.assertHealthy()).not.toThrow();
});

it('fences Calendar collection writes and keeps unsupported escapes closed', async () => {
  const f = fixture();
  const client = guardedClient(f.client as never, 'db', f.journal);
  const writing = client.db('db').collection('integration_connections').updateOne(
    { userId: 'u1', provider: 'google-calendar' }, { $set: { enabled: false } });
  await Promise.resolve(); await Promise.resolve();
  expect(f.collection.updateOne).not.toHaveBeenCalled();
  f.resolveAck(); await writing;
  expect(f.events).toEqual(['intent', 'data', 'idle']);
  expect(() => client.db('db').collection('integration_connections').deleteMany({})).toThrow();
  expect(() => client.db('db').collection('unregistered')).toThrow();
});
