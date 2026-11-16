/**
 * ============================================================================
 * FILE: local-startup.spec.ts
 * LOCATION: backend/test/operations/local-startup.spec.ts
 * PURPOSE: Verify local startup recovery precedes generation readiness offline.
 * ROLE IN PROJECT: Injects persistence, catalogue and runtime; forbids network.
 * KEY COMPONENTS: Pending evidence, stopped maintenance, fresh runtime, failures.
 * ============================================================================
 */
import { AppService, type AssemblyPorts } from '../../src/app.service.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { defaultManageableSettings } from '../../src/platform/config/manageable-config.js';
import { CredentialService } from '../../src/admin-config/credential-service.js';
import { CredentialValidator } from '../../src/admin-config/credential-validation.js';
import type { StoredConfigDocument } from '../../src/contracts/admin-config.js';
import { options } from './fixtures.js';
import { assets } from '../context/fixtures.js';
import { limits } from '../model/helpers.js';
import { session } from '../persistence/fixtures.js';
import { account, providerFixture } from '../auth/fixtures.js';
import { actor } from '../admin-config/fixtures.js';

function fixture() {
  const bootstrap = loadBootstrapConfig({ AURVIN_LOCAL_CRASH_RECOVERY:'true',PERSISTENCE_PROFILE:'native-mongodb',
    MONGODB_URI:'mongodb://fixture.invalid/?replicaSet=fixture',
    AURVIN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
  const credentials = new CredentialService(bootstrap.encryption,
    new CredentialValidator(async () => { throw new Error('Network forbidden.'); }));
  const settings = defaultManageableSettings();
  settings.openRouter.modelId = 'fixture/model';
  let stored: StoredConfigDocument = {
    _id: 'aurvin', schemaVersion: 1, revision: 1, settings,
    credentials: {
      openrouter: {
        envelope: credentials.seal('openrouter', 'fixture'),
        validatedAt: '2026-10-13T12:00:00.000Z',
      },
      deepgram: null,
    },
    updatedAt: '2026-10-13T12:00:00.000Z', updatedBy: bootstrap.identity.userId,
  };
  const configRepository = () => ({
    read: async () => structuredClone(stored),
    createIfAbsent: async (document: StoredConfigDocument) => {
      if (stored) return { outcome: 'conflict', currentRevision: stored.revision } as const;
      stored = structuredClone(document);
      return { outcome: 'confirmed', document: structuredClone(document) } as const;
    },
    compareAndSwap: async (expected: number, document: StoredConfigDocument) => {
      if (stored?.revision !== expected) {
        return { outcome: 'conflict', currentRevision: stored?.revision ?? 0 } as const;
      }
      stored = structuredClone(document);
      return { outcome: 'confirmed', document: structuredClone(document) } as const;
    },
  });
  const maintenance=options().runtime; const fresh=options().runtime; const order:string[]=[];
  vi.spyOn(maintenance,'snapshot').mockReturnValue({ accepting:false,active:0,unresolvedWrites:0,degraded:false });
  const allow=vi.spyOn(maintenance,'allowStoppedOwner'); const stop=vi.spyOn(maintenance,'stopAccepting');
  const execute=vi.spyOn(maintenance,'executeTurn'); const submit=vi.spyOn(maintenance,'submitTurn');
  vi.spyOn(maintenance,'drain').mockImplementation(async () => { order.push('drain');return { drained:true,active:0,unresolvedWrites:0 }; });
  const finish=vi.fn(async () => { order.push('durable'); });
  const list=vi.fn(async () => ({ items:[session(bootstrap.identity.userId,'owner-only')],nextCursor:null }));
  const close=vi.fn(async () => undefined);
  const ownerAccount = account({ userId: bootstrap.identity.userId, passwordChangeRequired: false,
    currentWorkosSessionId: 'sid_1', emailNormalized: 'aurvin@example.com' });
  const opened={ sessions:{ listForRecovery:list },
    users:{ get:async (id:string) => id === ownerAccount.userId ? { account: ownerAccount, revision: 1 } : null,
      list:async () => ({ items:[{ account: ownerAccount, revision: 1 }], nextCursor: null }) },
    messages:{},metadata:{},memory:{},checkpoints:{},
    owner:{ observedExecutor:async () => ({ record:{ local:{ pending:true,ancestors:['previous','ancestor'] } } }),
      finishLocalRecovery:finish,assertExecutor:async () => undefined,
      store:{ db:{ collection:() => { throw new Error('local fixture uses the config port'); } } } },ping:async () => true,close };
  const runtime=vi.fn<AssemblyPorts['runtime']>().mockImplementationOnce(() => { order.push('maintenance');return maintenance; })
    .mockImplementationOnce(() => { order.push('fresh');return fresh; });
  const catalogue=vi.fn<AssemblyPorts['limits']>(async () => limits);
  const fetcher=vi.fn<typeof fetch>(async () => { throw new Error('Network forbidden.'); });
  const ports={ open:async () => opened,assets:async () => assets,limits:catalogue,runtime,fetcher,writeLog:() => undefined,configRepository,
    authProvider: () => providerFixture() } as unknown as Partial<AssemblyPorts>;
  return { bootstrap,ports,runtime,catalogue,fetcher,maintenance,fresh,allow,stop,finish,list,close,order,execute,submit };
}
it('finishes local maintenance before exposing a fresh accepting runtime on the same bundle',async () => {
  const f=fixture(); const service=await AppService.create(f.bootstrap,f.ports);
  expect(f.order).toEqual(['maintenance','drain','durable','fresh']);
  expect(f.stop).toHaveBeenCalledTimes(1);expect(f.allow.mock.calls.map(c => c[0])).toEqual(['previous','ancestor']);
  expect(f.runtime.mock.calls[0][0].persistence.owner).toBe(f.runtime.mock.calls[1][0].persistence.owner);
  expect((await service.operations.readiness.read()).acceptReady).toBe(true);
  expect(f.execute).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  expect(f.fetcher).not.toHaveBeenCalled(); await service.operations.shutdown();
});
it('catalogue failure remains diagnostic and never clears pending recovery evidence',async () => {
  const f=fixture();f.catalogue.mockRejectedValue(new Error('Catalogue unavailable.'));
  const service=await AppService.create(f.bootstrap,f.ports);
  expect(f.finish).not.toHaveBeenCalled();expect(f.runtime).not.toHaveBeenCalled();
  expect((await service.operations.readiness.read()).acceptReady).toBe(false);
  expect(f.fetcher).not.toHaveBeenCalled();await service.operations.shutdown();
});
it('partial recovery failure never constructs fresh runtime or clears ancestry; cleanup retains ownership',async () => {
  const f=fixture();vi.spyOn(f.maintenance,'reconcileSession').mockRejectedValue(new Error('Unknown write.'));
  await expect(AppService.create(f.bootstrap,f.ports)).rejects.toMatchObject({ code:'NOT_READY' });
  expect(f.runtime).toHaveBeenCalledTimes(1);expect(f.finish).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled();
});
it('applies a config edit after successful recovery without another runtime or inference',async () => {
  const f=fixture(); const service=await AppService.create(f.bootstrap,f.ports);
  expect(f.order).toEqual(['maintenance','drain','durable','fresh']);
  const settings=defaultManageableSettings(); settings.openRouter.modelId='fixture/model';
  settings.chat.titleMaxChars=70;
  const saved=await service.adminConfig.saveSettings({ protocolVersion:1,expectedRevision:1,settings },
    actor);
  expect(saved).toMatchObject({ revision:2,activeRevision:2 });
  expect(service.currentConfig.current()?.budgets.titleMaxChars).toBe(70);
  expect(f.runtime).toHaveBeenCalledTimes(2);
  expect(f.execute).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  expect(f.fetcher).not.toHaveBeenCalled(); await service.operations.shutdown();
  expect(f.close).toHaveBeenCalledTimes(1);
});
