/**
 * ============================================================================
 * FILE: observe-persistence.ts
 * LOCATION: backend/src/operations/observe-persistence.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Decorate persistence writes and checkpointer puts with bounded timing.
 *
 * ROLE IN PROJECT:
 *    Observes original receivers without reading payloads, disabling fencing,
 *    or inventing a second persistence owner for P9 to wrap once.
 *
 * KEY COMPONENTS:
 *    - observeMethods: Proxy selected methods onto the original this-binding.
 *    - observePersistence: Apply write/checkpoint/dedup/accounting metrics.
 * ============================================================================
 */

import type { PersistenceBundle } from '../persistence/persistence.js';
import type { ExecutionLease } from '../contracts/repositories.js';
import { Telemetry, type Metric } from './telemetry.js';
const READS = new Set(['get', 'getConfirmed', 'list', 'listPublished', 'listForContext', 'getReferences', 'getAttempt', 'getAttemptConfirmed',
  'getAttemptByIdempotency', 'getAcceptance', 'getAcceptances', 'latestAttempt', 'getAccounting', 'getAccountingConfirmed',
  'listAttempts', 'getVoiceDelivery', 'getVoiceDeliveries', 'getVoiceAccounting', 'getBudget', 'getBudgetConfirmed',
  'getDispatch', 'getDispatchConfirmed', 'listDispatches',
  'getDebit', 'listAttemptAccounting', 'getCurrent', 'getCurrentSlot', 'getReplyReference', 'listReplyReferences',
  'getByTurn', 'listEvents', 'listEventsV2', 'findSucceededByRequestHash', 'findOwnCreateBySlot']);
export function observeMethods<T extends object>(target:T, t:Telemetry, metric:Metric, names:readonly string[]):T {
  return new Proxy(target, { get(object, key) {
    const value:unknown = Reflect.get(object,key,object);
    if (typeof value !== 'function') return value;
    const read = READS.has(String(key));
    if (!names.includes(String(key)) && !read) return value.bind(object);
    const measured = read ? 'read' : metric;
    return (...args:unknown[]) => t.inDatabaseOrigin(metric === 'checkpoint' || metric === 'checkpoint_read'
      ? 'checkpoint' : 'repository', async () => {
      const started = t.monotonic();
      try {
        const result:unknown = await Reflect.apply(value,object,args);
        if (key === 'getAttemptByIdempotency' && result) t.measure('dedup_hit');
        if (key === 'putAccounting' || key === 'putAccountingConfirmed') {
          const record = args[0] as { sessionId:string; turnId:string; attemptId:string;
            generationId:string | null; accountingStatus:'known'|'pending'|'unknown' };
          t.event('accounting',record); t.measure(`accounting_${record.accountingStatus}` as Metric);
        }
        return result;
      } catch (error) {
        t.event('process', { stage: 'persistence', state: 'error', reason: 'persistence-error',
          durationMs: t.monotonic()-started, persistenceKind: read ? 'read' : metric === 'checkpoint' ? 'checkpoint' : 'write' });
        throw error;
      } finally { t.measure(measured,t.monotonic()-started); }
    });
  } });
}
export function observePersistence(p:PersistenceBundle,t:Telemetry):PersistenceBundle {
  p.observeDatabase?.(t);
  if (p.owner) {
    p.owner.onQueueWait = ms => t.measure('ownership_queue', ms);
    p.owner.onOrigin = (origin, fn) => t.inDatabaseOrigin(origin, fn);
    if (p.owner.store) {
      p.owner.store.onCommand = (kind, ms) => t.recordDriverCommand(kind, ms);
    }
  }
  return { ...p,
    sessions:observeMethods(p.sessions,t,'write',['createIfAbsent','createForInternalTurn','touchActivity','update','delete']),
    messages:observeMethods(p.messages,t,'write',['append','appendConfirmed','updateCompletion','updateCompletionConfirmed']),
    memory:observeMethods(p.memory,t,'write',['put','putConfirmed']),
    metadata:observeMethods(p.metadata,t,'write',['putAttempt','putAttemptConfirmed','compareAttempt','compareAttemptConfirmed','putAccounting','putAccountingConfirmed','putVoiceAccounting','putVoiceDelivery','compareVoiceDelivery','getAttemptByIdempotency']),
    ...('calendarConnections' in p && p.calendarConnections
      ? { calendarConnections: observeMethods(p.calendarConnections,t,'write',['create','compareAndSwap','putState','consumeState']) }
      : {}),
    ...('calendarOperations' in p && p.calendarOperations
      ? { calendarOperations: observeMethods(p.calendarOperations,t,'write',['reserve','compareAndSwap','putReconciliation','appendEvent','recordLegacyDisposition']) }
      : {}),
    ...('calendarRetention' in p && p.calendarRetention
      ? { calendarRetention: observeMethods(p.calendarRetention,t,'write',['sweepPage','expireAuditPage','registerSource','redactSource','sweepMultiCalendarPage']) }
      : {}),
    ...('calendarConnectionsV2' in p && p.calendarConnectionsV2
      ? { calendarConnectionsV2: observeMethods(p.calendarConnectionsV2,t,'write',['create','compareAndSwap']) }
      : {}),
    ...('calendarOperationsV2' in p && p.calendarOperationsV2
      ? { calendarOperationsV2: observeMethods(p.calendarOperationsV2,t,'write',
        ['reserveByIntent','compareAndSwap','appendEventV2']) }
      : {}),
    ...('calendarDecisionsV2' in p && p.calendarDecisionsV2
      ? { calendarDecisionsV2: observeMethods(p.calendarDecisionsV2,t,'write',['put','putRejected']) }
      : {}),
    ...('calendarResultsV2' in p && p.calendarResultsV2
      ? { calendarResultsV2: observeMethods(p.calendarResultsV2,t,'write',['put']) }
      : {}),
    ...('calendarAccountingV2' in p && p.calendarAccountingV2
      ? { calendarAccountingV2: observeMethods(p.calendarAccountingV2,t,'write',
        ['createBudget','createBudgetConfirmed','compareAndSwapBudget','compareBudgetConfirmed','putDispatch','reserveDispatchConfirmed','updateDispatchConfirmed','putAggregate','debit']) }
      : {}),
    ...('calendarProposals' in p && p.calendarProposals
      ? { calendarProposals: observeMethods(p.calendarProposals,t,'write',
        ['putCurrent','consume','tombstone','bindReplyReference']) }
      : {}),
    checkpoints:{ create:async () => {
      const factory = await p.checkpoints.create();
      return { setup:() => factory.setup(), bind:(lease:ExecutionLease) =>
        observeMethods(observeMethods(factory.bind(lease),t,'checkpoint_read',['getTuple']),t,'checkpoint',['put','putWrites']) };
    } } as PersistenceBundle['checkpoints'],
  };
}
