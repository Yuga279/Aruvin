/**
 * ============================================================================
 * FILE: local-reconciliation.spec.ts
 * LOCATION: backend/test/runtime/local-reconciliation.spec.ts
 * PURPOSE: Exercise real reconciliation with an in-memory LangGraph saver.
 * ROLE IN PROJECT: Deterministic repository doubles, no configured env or network.
 * KEY COMPONENTS: Sealed publication, interruption, owner-only cleanup, replay guard.
 * ============================================================================
 */
import { MemorySaver } from '@langchain/langgraph';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import type { PersistenceBundle } from '../../src/persistence/persistence.js';
import { loadConfig } from '../../src/platform/config/load-config.js';
import { boundaryFor, type SavedResult } from '../../src/agent/state.js';
import { graphConfig } from '../../src/chat-runtime/finalization.js';
import { outputId, eventIdFor } from '../../src/chat-runtime/identity.js';
import { buildReferenceManifest } from '../../src/context/index.js';
import { hashPayload } from '../../src/platform/crypto/hash-payload.js';
import { session, message, attempt, accounting } from '../persistence/fixtures.js';
import { assets } from '../context/fixtures.js';
import { limits } from '../model/helpers.js';

function fixture() {
  const config=loadConfig({ AURVIN_USER_ID:'u1' }); const budgets=config.budgets;
  const savedSession=session(); savedSession.execution={ ownerId:'previous',activeAttemptId:'a1',leaseExpiresAt:null,generation:1 };
  let savedAttempt={ ...attempt(),status:'generating' as ReturnType<typeof attempt>['status'],
    payloadHash:hashPayload('Hello'),instructionVersion:assets.instructionVersion,
    knowledgeContentHash:assets.knowledgeContentHash,graphSchemaVersion:assets.graphSchemaVersion };
  const originals=[message()];
  let memory=buildReferenceManifest('u1','s1',0,[],assets,budgets);
  const marker={ turnId:'t1',userMessageId:'m0',payloadHash:savedAttempt.payloadHash };
  const saver=new MemorySaver(); const fetcher=vi.fn(async () => { throw new Error('Network forbidden.'); });
  const owner={ executorId:'current',assertExecutor:async () => undefined,drain:async () => undefined,
    run:async (_lease:unknown,action:() => Promise<unknown>) => action(),
    recoverStoppedSession:async () => { savedSession.execution.ownerId='current'; return {
      userId:'u1',sessionId:'s1',ownerId:'current',generation:2,leaseExpiresAt:new Date(Date.now()+180000).toISOString() }; },
    release:async () => { savedSession.execution.ownerId=null; },
    clearAttempt:async () => { savedSession.execution.activeAttemptId=null; },
    allocateSequences:async () => ({ start:0 }),
  };
  const p={ owner,checkpoints:{ create:async () => ({ bind:() => saver }) },
    sessions:{ get:async () => savedSession,touchActivity:async () => undefined },
    messages:{ budgets,get:async (_u:string,_s:string,id:string) => originals.find(m => m.messageId === id) ?? null,
      getReferences:async (_u:string,_s:string,refs:{ messageId:string }[]) => refs.map(r => originals.find(m => m.messageId === r.messageId)!),
      list:async () => ({ items:originals,nextCursor:null }),
      listForContext:async () => ({ items:originals,nextCursor:null }),
      append:async (m:ReturnType<typeof message>) => { originals.push(m); },
      updateCompletion:async (_u:string,_s:string,id:string,status:ReturnType<typeof message>['completionStatus']) => {
        originals.find(m => m.messageId === id)!.completionStatus=status;
      } },
    memory:{ budgets,get:async () => memory,put:async (m:typeof memory) => { memory=m; } },
    metadata:{ budgets,getAttempt:async () => savedAttempt,getAcceptance:async () => marker,
      listAttempts:async () => ({ items:[savedAttempt],nextCursor:null }),
      compareAttempt:async (a:typeof savedAttempt) => { savedAttempt=a; return true; },
      getVoiceDelivery:async () => null,compareVoiceDelivery:async () => true,putVoiceDelivery:async () => undefined,
      getAccounting:async () => null,putAccounting:async () => undefined },
  } as unknown as PersistenceBundle;
  const runtime=new DurableChatRuntime({ config,persistence:p,assets,fetcher,limits,
    assembler:{ assemble:async () => { throw new Error('Recovery must not assemble inference.'); } },
  });
  runtime.stopAccepting(); runtime.allowStoppedOwner('previous');
  return { runtime,p,savedSession,fetcher,originals,getAttempt:() => savedAttempt,getMemory:() => memory,
    async seal() {
      const a=savedAttempt; const assistant={ ...message(2),messageId:outputId(a),eventId:eventIdFor('u1','s1',outputId(a)),
        role:'assistant' as const,attemptId:a.attemptId,completionStatus:'streaming' as const,content:'Saved response' };
      const target=buildReferenceManifest('u1','s1',1,[originals[0],{ ...assistant,completionStatus:'completed' }],assets,budgets);
      const result:SavedResult={ input:{ attempt:a,assistantSequence:2 },assistant,
        accounting:{ ...accounting(),outcome:'completed' },base:boundaryFor(memory),target,outcome:'completed' };
      const graph=await runtime.graph({ userId:'u1',sessionId:'s1',ownerId:'current',generation:1,leaseExpiresAt:new Date().toISOString() });
      await graph.updateState(graphConfig('u1','s1'),{ input:result.input,result,sealed:true,boundary:result.base,rebase:null },'seal');
    },
  };
}

it('finishes a saved sealed result idempotently without model replay', async () => {
  const f=fixture(); await f.seal();
  await f.runtime.reconcileSession('u1','s1'); await f.runtime.reconcileSession('u1','s1');
  expect(f.originals.map(m => m.content)).toEqual(['Hello','Saved response']);
  expect(f.getAttempt().status).toBe('completed'); expect(f.getMemory().contextVersion).toBe(1);
  expect(f.savedSession.execution).toMatchObject({ ownerId:null,activeAttemptId:null });
  expect(f.fetcher).not.toHaveBeenCalled();
});
it('interrupts a no-result accepted input instead of inferring or losing the user archive', async () => {
  const f=fixture(); await f.runtime.reconcileSession('u1','s1');
  expect(f.getAttempt()).toMatchObject({ status:'interrupted',errorCode:'INTERRUPTED' });
  expect(f.originals.map(m => m.content)).toEqual(['Hello']); expect(f.getMemory().messageRefs).toHaveLength(1);
  expect(f.savedSession.execution).toMatchObject({ ownerId:null,activeAttemptId:null });
  expect(f.fetcher).not.toHaveBeenCalled();
});
it('clears authorized owner-only leftovers without accepting an orphan for inference', async () => {
  const f=fixture(); f.savedSession.execution.activeAttemptId=null;
  await f.runtime.reconcileSession('u1','s1');
  expect(f.savedSession.execution.ownerId).toBeNull(); expect(f.originals).toHaveLength(1);
  expect(f.getAttempt().status).toBe('generating'); expect(f.fetcher).not.toHaveBeenCalled();
});

it('completes finalization from saved result without reading API key or model settings', async () => {
  const f = fixture();
  const runtimeNoConfig = new DurableChatRuntime({
    config: loadConfig({ AURVIN_USER_ID: 'u1' }),
    persistence: f.p,
    assets,
    fetcher: f.fetcher,
    limits,
    currentConfig: { current: () => null },
    assembler: { assemble: async () => { throw new Error('Recovery must not assemble inference.'); } },
  });
  runtimeNoConfig.stopAccepting();
  runtimeNoConfig.allowStoppedOwner('previous');
  await f.seal();
  await runtimeNoConfig.reconcileSession('u1', 's1');
  expect(f.originals.map(m => m.content)).toEqual(['Hello', 'Saved response']);
  expect(f.getAttempt().status).toBe('completed');
  expect(f.fetcher).not.toHaveBeenCalled();
});

