/**
 * ============================================================================
 * FILE: local-recovery.spec.ts
 * LOCATION: backend/test/operations/local-recovery.spec.ts
 * PURPOSE: Exercise bounded local maintenance and explicit default-off admission.
 * ROLE IN PROJECT: No configured env or service connections; injected runtime.
 * KEY COMPONENTS: Quiescence, progress limits, fresh-runtime lifecycle.
 * ============================================================================
 */
import { loadConfig } from '../../src/platform/config/load-config.js';
import { recoverLocalSessions,finishLocalMaintenance } from '../../src/operations/local-recovery.js';
import { options } from './fixtures.js';
import { MongoClient } from 'mongodb';
import { openPersistence } from '../../src/persistence/persistence.js';
import type { MongoOwnership } from '../../src/persistence/ownership.js';
import { session } from '../persistence/fixtures.js';
it('defaults off and only accepts explicit native opt-in',() => {
  expect(loadConfig({}).topology.localCrashRecovery).toBe(false);
  expect(() => loadConfig({ AURVIN_LOCAL_CRASH_RECOVERY:'yes' })).toThrow();
  expect(() => loadConfig({ AURVIN_LOCAL_CRASH_RECOVERY:'true' })).toThrow();
  expect(loadConfig({ AURVIN_LOCAL_CRASH_RECOVERY:'true',PERSISTENCE_PROFILE:'native-mongodb' }).topology.localCrashRecovery).toBe(true);
});
it('refuses a URI without an explicit replica set before any connection or sentinel change',async () => {
  const connect=vi.spyOn(MongoClient.prototype,'connect').mockRejectedValue(new Error('Network forbidden.'));
  try {
    await expect(openPersistence(loadConfig({ AURVIN_LOCAL_CRASH_RECOVERY:'true',PERSISTENCE_PROFILE:'native-mongodb',
      MONGODB_URI:'mongodb://never-connect.invalid/' }))).rejects.toMatchObject({ code:'UNSUPPORTED_TOPOLOGY' });
    expect(connect).not.toHaveBeenCalled();
  } finally { connect.mockRestore(); }
});
it('authorizes ancestry and scans owner-only rows without inference',async () => {
  const { runtime }=options();
  const allow=vi.spyOn(runtime,'allowStoppedOwner'); const reconcile=vi.spyOn(runtime,'reconcileSession');
  const execute=vi.spyOn(runtime,'executeTurn'); const submit=vi.spyOn(runtime,'submitTurn');
  vi.spyOn(runtime,'snapshot').mockReturnValue({ accepting:false,active:0,unresolvedWrites:0,degraded:false });
  const list=vi.fn().mockResolvedValueOnce({ items:[session('u','owner-only')],nextCursor:'next' })
    .mockResolvedValueOnce({ items:[session('u','sealed'),session('u','no-result')],nextCursor:null });
  await recoverLocalSessions(runtime,{ listForRecovery:list },'u',['ancestor','previous'],1000);
  expect(allow.mock.calls.map(c => c[0])).toEqual(['ancestor','previous']);
  expect(reconcile).toHaveBeenCalledTimes(3);
  expect(execute).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
});
it('refuses ancestry overflow before scanning and passes the drain budget through',async () => {
  const { runtime }=options(); const list=vi.fn();
  const drain=vi.spyOn(runtime,'drain').mockResolvedValue({ drained:true,active:0,unresolvedWrites:0 });
  vi.spyOn(runtime,'snapshot').mockReturnValue({ accepting:false,active:0,unresolvedWrites:0,degraded:false });
  await expect(recoverLocalSessions(runtime,{ listForRecovery:list },'u',
    Array.from({ length:17 },(_,i) => `ancestor-${i}`),1234)).rejects.toMatchObject({ code:'NOT_READY' });
  expect(list).not.toHaveBeenCalled(); expect(drain).not.toHaveBeenCalled();
  await recoverLocalSessions(runtime,{ listForRecovery:async () => ({ items:[],nextCursor:null }) },'u',['previous'],1234);
  expect(drain).toHaveBeenCalledWith(1234);
});
it('fails closed on nonadvancing page cursors',async () => {
  const { runtime }=options();
  vi.spyOn(runtime,'snapshot').mockReturnValue({ accepting:false,active:0,unresolvedWrites:0,degraded:false });
  const list=vi.fn(async () => ({ items:[],nextCursor:'same' }));
  await expect(recoverLocalSessions(runtime,{ listForRecovery:list },'u',['previous'],1000)).rejects.toMatchObject({ code:'NOT_READY' });
  expect(list).toHaveBeenCalledTimes(2);
});
it('constructs fresh runtime only after maintenance drains and completion is durable',async () => {
  const maintenance=options().runtime; const fresh=options().runtime; const order:string[]=[];
  vi.spyOn(maintenance,'snapshot').mockReturnValue({ accepting:false,active:0,unresolvedWrites:0,degraded:false });
  vi.spyOn(maintenance,'drain').mockImplementation(async () => { order.push('drain');return { drained:true,active:0,unresolvedWrites:0 }; });
  const owner={ finishLocalRecovery:async () => { order.push('durable'); } } as MongoOwnership;
  const factory=vi.fn().mockImplementationOnce(() => { order.push('maintenance');return maintenance; })
    .mockImplementationOnce(() => { order.push('fresh');return fresh; });
  expect(await finishLocalMaintenance(owner,{ listForRecovery:async () => ({ items:[],nextCursor:null }) },'u',['previous'],1000,factory)).toBe(fresh);
  expect(order).toEqual(['maintenance','drain','durable','fresh']);
});
it('retains pending evidence and refuses fresh runtime after partial failure or false drain',async () => {
  for (const failed of ['reconcile','drain']) {
    const maintenance=options().runtime;
    vi.spyOn(maintenance,'snapshot').mockReturnValue({ accepting:false,active:0,unresolvedWrites:0,degraded:false });
    if (failed === 'reconcile') vi.spyOn(maintenance,'reconcileSession').mockRejectedValue(new Error('Fixture failure.'));
    else vi.spyOn(maintenance,'drain').mockResolvedValue({ drained:false,active:0,unresolvedWrites:1 });
    const finish=vi.fn(); const owner={ finishLocalRecovery:finish } as unknown as MongoOwnership;
    const factory=vi.fn(() => maintenance);
    await expect(finishLocalMaintenance(owner,{ listForRecovery:async () => ({ items:[session('u','s')],nextCursor:null }) },
      'u',['previous'],1000,factory)).rejects.toThrow();
    expect(finish).not.toHaveBeenCalled();expect(factory).toHaveBeenCalledTimes(1);
  }
});
