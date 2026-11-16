/**
 * ============================================================================
 * FILE: local-recovery.ts
 * LOCATION: backend/src/operations/local-recovery.ts
 * PURPOSE: Recover proven stopped local owners only from an idle mutation journal.
 * ROLE IN PROJECT: No currentOp, expiry takeover, provider call, or operator boolean.
 * KEY COMPONENTS: handoffLocalOwner, recoverLocalSessions, finishLocalMaintenance.
 * ============================================================================
 */
import type { ChatRuntime } from '../chat-runtime/index.js';
import { localBindingSchema, LOCAL_MUTATION_MODE, type LocalBinding } from '../persistence/records.js';
import type { PersistenceBundle } from '../persistence/persistence.js';
import type { MongoOwnership } from '../persistence/ownership.js';
import type { UsersRepository } from '../contracts/auth.js';
import { AppError } from '../platform/errors/app-error.js';
import { reconcilePage } from './recovery.js';
import { inspectLocalProcess } from './local-guard.js';
import { randomUUID } from 'node:crypto';

export async function handoffLocalOwner(owner:MongoOwnership,current:LocalBinding,inspect=inspectLocalProcess) {
  const observed=await owner.observedExecutor().catch(() => {
    throw new AppError('UNSUPPORTED_TOPOLOGY','Saved local executor evidence is unavailable or unsupported.');
  });
  const old=observed.record.local;
  const next=localBindingSchema.parse(current);
  if (!old || old.mode !== LOCAL_MUTATION_MODE || old.mutation.state !== 'idle')
    throw new AppError('UNSUPPORTED_TOPOLOGY','Legacy or uncertain database writes require operator recovery.');
  for (const field of ['machineHash','installationHash','databaseHash','guardHash'] as const)
    if (old.binding[field] !== next[field])
      throw new AppError('UNSUPPORTED_TOPOLOGY','Local executor binding does not match this installation/database.');
  if (current.appName !== `aurvin-local-${owner.executorId}` ||
      observed.record.local?.binding.appName !== `aurvin-local-${observed.record.ownerId}`)
    throw new AppError('NOT_READY','Local stopped-owner attribution is unavailable.');
  if (await inspect(old.binding,next.machineHash) !== 'dead')
    throw new AppError('UNSUPPORTED_TOPOLOGY','The previous exact executor lifetime is not proven stopped.');
  const ancestors=[...new Set([...(observed.record.local?.ancestors ?? []),observed.record.ownerId])];
  if (ancestors.length > 16 || ancestors.includes(owner.executorId))
    throw new AppError('NOT_READY','Local recovery ancestry requires operator repair.');
  const token=randomUUID();
  const local={ mode:LOCAL_MUTATION_MODE,released:false,binding:next,ancestors,pending:true,
    mutation:{ state:'busy' as const,token } };
  // One revision-fenced replacement records ownership AND prior authorization.
  // A crash before/after this write never creates an unbound intermediate owner.
  await owner.handoffStoppedExecutor(observed.record.ownerId,{ revision:observed.revision,local });
  return { ancestors,token };
}

async function scanOwnerPages(runtime:ChatRuntime,
  sessions:Pick<PersistenceBundle['sessions'],'listForRecovery'> & { budgets?:{ maxPageSize:number } },userId:string) {
  let cursor:string | null=null;
  // ponytail: cap at 50,000 rows/owner/start; larger databases require operator maintenance.
  for (let n=0;n<1000;n++) {
    const page=await reconcilePage(runtime,sessions,userId,cursor,Math.min(50,sessions.budgets?.maxPageSize ?? 50));
    if (page.nextCursor === null) return;
    if (page.nextCursor === cursor) break;
    cursor=page.nextCursor;
  }
  throw new AppError('NOT_READY','Local recovery scan exceeded its bounded progress limit.');
}

export async function recoverLocalSessions(runtime:ChatRuntime,
  sessions:Pick<PersistenceBundle['sessions'],'listForRecovery'> & { budgets?:{ maxPageSize:number } },userId:string,ancestors:string[],drainMs:number) {
  runtime.stopAccepting();
  if (ancestors.length > 16) throw new AppError('NOT_READY','Local recovery ancestry requires operator repair.');
  for (const ancestor of ancestors) runtime.allowStoppedOwner(ancestor);
  await scanOwnerPages(runtime,sessions,userId);
  const drained=await runtime.drain(drainMs);
  if (!drained.drained) throw new AppError('NOT_READY','Local recovery did not quiesce.');
}

export async function finishLocalMaintenance(owner:MongoOwnership,
  sessions:Pick<PersistenceBundle['sessions'],'listForRecovery'>,userId:string,ancestors:string[],
  drainMs:number,createRuntime:() => ChatRuntime) {
  const maintenance=createRuntime();
  await recoverLocalSessions(maintenance,sessions,userId,ancestors,drainMs);
  // Durable completion only after maintenance is fully drained; errors retain pending ancestry.
  await owner.finishLocalRecovery();
  return createRuntime(); // stopAccepting is irreversible; never reuse maintenance for admission.
}

export async function finishLocalMaintenanceForUsers(owner:MongoOwnership,
  sessions:Pick<PersistenceBundle['sessions'],'listForRecovery'> & { budgets?:{ maxPageSize:number } },
  users:Pick<UsersRepository,'list'>,ancestors:string[],drainMs:number,createRuntime:() => ChatRuntime) {
  const maintenance=createRuntime();
  maintenance.stopAccepting();
  if (ancestors.length > 16) throw new AppError('NOT_READY','Local recovery ancestry requires operator repair.');
  for (const ancestor of ancestors) maintenance.allowStoppedOwner(ancestor);
  let cursor:string | undefined;
  const seen=new Set<string>();
  for (let n=0;n<1000;n++) {
    const page=await users.list({ limit:50, ...(cursor ? { cursor } : {}) });
    for (const item of page.items) await scanOwnerPages(maintenance,sessions,item.account.userId);
    if (!page.nextCursor) {
      const drained=await maintenance.drain(drainMs);
      if (!drained.drained) throw new AppError('NOT_READY','Local recovery did not quiesce.');
      await owner.finishLocalRecovery();
      return createRuntime();
    }
    if (page.nextCursor === cursor || seen.has(page.nextCursor))
      throw new AppError('NOT_READY','Local recovery scan exceeded its bounded progress limit.');
    seen.add(page.nextCursor); cursor=page.nextCursor;
  }
  throw new AppError('NOT_READY','Local recovery scan exceeded its bounded progress limit.');
}
