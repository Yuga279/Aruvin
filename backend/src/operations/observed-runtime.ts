/**
 * ============================================================================
 * FILE: observed-runtime.ts
 * LOCATION: backend/src/operations/observed-runtime.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Delegate the existing ChatRuntime while recording stream and recovery metrics.
 *
 * ROLE IN PROJECT:
 *    Observes envelopes, terminal errors, and reconciliation without fabricating
 *    completion, calling the provider, or stopping acceptance on outage.
 *
 * KEY COMPONENTS:
 *    - observedRuntime: Structural delegator around one P5 runtime getter.
 *    - executeTurn emit wrapper: First-output, finalization, and failure cells.
 * ============================================================================
 */

import type { ChatRuntime } from '../chat-runtime/index.js';
import { AppError } from '../platform/errors/app-error.js';
import type { Readiness } from './readiness.js';
import { Telemetry } from './telemetry.js';
import type { calendarCompatibleEnvelopeSchema } from '../contracts/calendar-wire.js';
type CalendarCompatibleEnvelope = ReturnType<typeof calendarCompatibleEnvelopeSchema.parse>;
export function observedRuntime(get:() => ChatRuntime | null,t:Telemetry,ready:Readiness):ChatRuntime {
  const raw = () => { const r=get(); if (!r) throw new AppError('NOT_READY','Chat is unavailable.'); return r; };
  return {
    processEpoch: () => get()?.processEpoch?.() ?? null,
    activeSessionTurn: (u, s) => raw().activeSessionTurn ? raw().activeSessionTurn!(u, s) : Promise.resolve(null),
    get retrySave() {
      const runtime = get();
      return runtime?.retrySave?.bind(runtime);
    },
    memorySession: (u, s) => raw().memorySession?.(u, s) ?? null,
    memoryMessages: (u, s, p) => raw().memoryMessages?.(u, s, p) ?? null,
    assertSessionMutation: (u, s) => raw().assertSessionMutation?.(u, s),
    memoryAdmissionReady: () => raw().memoryAdmissionReady?.() ?? false,
    overlaySessions: (u, p, durable) => raw().overlaySessions?.(u, p, durable) ?? durable,
    get attemptStreamBudgets() {
      const runtime = get();
      return runtime?.attemptStreamBudgets?.bind(runtime);
    },
    get reserveStream() {
      const runtime = get();
      return runtime?.reserveStream?.bind(runtime);
    },
    get quiesceStreams() {
      const runtime = get();
      return runtime?.quiesceStreams?.bind(runtime);
    },
    get releaseStreamFence() {
      const runtime = get();
      return runtime?.releaseStreamFence?.bind(runtime);
    },
    get clearConfirmedState() {
      const runtime = get();
      return runtime?.clearConfirmedState?.bind(runtime);
    },
    get getCalendarTurnState() {
      const runtime = get();
      return runtime?.getCalendarTurnState?.bind(runtime);
    },
    submitTurn:c => t.inDatabaseRequest(() => t.inDatabasePhase('admission','other', () => {
      t.event('process', { stage: 'admission', state: 'start', origin: 'local', delivery: 'not-sent' });
      try {
        const result = raw().submitTurn(c);
        return Promise.resolve(result).then(ids => {
          const counts = t.databaseCounts();
          t.event('process', { stage: 'admission', state: 'ok', sessionId: ids.sessionId,
            turnId: ids.turnId, attemptId: ids.attemptId, origin: 'local', delivery: 'not-sent',
            mongoReads:counts.read, mongoWrites:counts.write, mongoFailures:counts.failed });
          t.event('process', { stage: 'admission-returned', state: 'ok', sessionId: ids.sessionId,
            turnId: ids.turnId, attemptId: ids.attemptId, origin: 'local', delivery: 'not-sent',
            mongoReads:counts.read, mongoWrites:counts.write, mongoFailures:counts.failed });
          return ids;
        }, error => {
          t.event('process', { stage: 'admission', state: 'rejected',
            code: error instanceof AppError ? error.code : undefined, origin: 'local', delivery: 'not-sent' });
          throw error;
        });
      } catch (error) {
        t.event('process', { stage: 'admission', state: 'rejected',
          code: error instanceof AppError ? error.code : undefined, origin: 'local', delivery: 'not-sent' });
        throw error;
      }
    })),
    retryTurn:c => t.inDatabaseRequest(() => t.inDatabasePhase('admission','other', () => {
      t.event('process', { stage: 'admission', state: 'start', origin: 'local', delivery: 'not-sent' });
      try {
        const result = raw().retryTurn(c);
        return Promise.resolve(result).then(ids => {
          const counts = t.databaseCounts();
          t.event('process', { stage: 'admission', state: 'ok', sessionId: ids.sessionId,
            turnId: ids.turnId, attemptId: ids.attemptId, origin: 'local', delivery: 'not-sent',
            mongoReads:counts.read, mongoWrites:counts.write, mongoFailures:counts.failed });
          t.event('process', { stage: 'admission-returned', state: 'ok', sessionId: ids.sessionId,
            turnId: ids.turnId, attemptId: ids.attemptId, origin: 'local', delivery: 'not-sent',
            mongoReads:counts.read, mongoWrites:counts.write, mongoFailures:counts.failed });
          return ids;
        }, error => {
          t.event('process', { stage: 'admission', state: 'rejected',
            code: error instanceof AppError ? error.code : undefined, origin: 'local', delivery: 'not-sent' });
          throw error;
        });
      } catch (error) {
        t.event('process', { stage: 'admission', state: 'rejected',
          code: error instanceof AppError ? error.code : undefined, origin: 'local', delivery: 'not-sent' });
        throw error;
      }
    })),
    cancelTurn:c => raw().cancelTurn(c), getTurnStatus:(u,s,id) => raw().getTurnStatus(u,s,id),
    getStreamAttempt:(u,s,id) => { const r = raw(); return r.getStreamAttempt ? r.getStreamAttempt(u,s,id) : Promise.resolve(null); },
    stopAccepting:() => { get()?.stopAccepting(); },
    snapshot:() => get()?.snapshot() ?? { accepting:false,active:0,unresolvedWrites:0,degraded:false },
    drain:ms => raw().drain(ms), allowStoppedOwner:id => raw().allowStoppedOwner(id),
    rebaseSession:(u,s) => raw().rebaseSession(u,s),
    reconcileSession:(u,s) => t.inTurn({ sessionId:s,turnId:'recovery',attemptId:'recovery' },() =>
      t.inDatabasePhase('recovery','other',async () => {
        const start=t.now();
        try { await raw().reconcileSession(u,s); t.event('recovery',{ ok:true }); }
        catch (error) { t.measure('reconciliation_failure'); t.event('recovery',{ ok:false }); throw error; }
        finally { t.measure('reconciliation',t.now()-start); }
      })),
    executeTurn:c => t.inTurn(c,() => t.inDatabasePhase('attachment','other',async () => {
      const start=t.monotonic(); let first=false; let firstFeedback=false; let finalizing:number | null=null;
      let outcome:'completed'|'truncated'|'failed'|'cancelled'|'interrupted'|'unknown' = 'unknown';
      let terminalCallbackReturned = false;
      try {
        const observe = (envelope: CalendarCompatibleEnvelope) => {
          const e=envelope.event;
          if (!firstFeedback && ((e.type === 'status' && (e.status === 'accepted' || e.status === 'generating'))
            || (e.type === 'delta' && e.text.length > 0) || e.type === 'calendar-progress')) {
            firstFeedback = true;
            const elapsed = t.monotonic() - start;
            t.measure('stream_first_feedback', elapsed);
            t.event('process', { stage: 'first-feedback', state: 'ok', durationMs: elapsed, origin: 'local', delivery: 'not-sent' });
          }
          if (e.type === 'delta' && e.text.length && !first) { first=true; t.measure('first_output',t.monotonic()-start); }
          if (e.type === 'status' && e.status === 'finalizing' && finalizing === null) finalizing=t.monotonic();
          if (e.type === 'status' && (e.status === 'completed' || e.status === 'truncated') && finalizing !== null) {
            t.measure('finalization',t.monotonic()-finalizing); finalizing=null;
          }
          if (e.type === 'error') {
            ready.providerFailure(e.code);
            t.measure(e.code === 'CANCELLED' || e.code === 'INTERRUPTED' || e.code === 'TIMEOUT' ? 'interruption' : 'failure');
            t.event('attempt',{ code:e.code,ok:false });
            outcome = e.code === 'CANCELLED' ? 'cancelled' : e.code === 'INTERRUPTED' ? 'interrupted' : 'failed';
          }
          if (e.type === 'completed') {
            ready.providerSuccess();
            if (outcome === 'unknown') outcome = 'completed';
          }
          if (e.type === 'status' && (e.status === 'completed' || e.status === 'truncated' || e.status === 'failed'
            || e.status === 'cancelled' || e.status === 'interrupted')) {
            outcome = e.status;
          }
        };
        await raw().executeTurn({ ...c, emit:async envelope => {
          observe(envelope);
          await c.emit(envelope);
          if (envelope.event.type === 'completed' || envelope.event.type === 'error') {
            terminalCallbackReturned = true;
            t.event('process', { stage: 'terminal-delivered', state: 'ok', origin: 'local', delivery: 'not-sent' });
          }
        }, emitCalendar: c.emitCalendar ? async envelope => {
          observe(envelope);
          const e = envelope.event;
          if (e.type === 'calendar-progress') t.event('calendar', { phase: e.phase });
          if (e.type === 'calendar-operation') t.event('calendar', { operationId: e.operation.operationId });
          await c.emitCalendar!(envelope);
          if (e.type === 'completed' || e.type === 'error') {
            terminalCallbackReturned = true;
            t.event('process', { stage: 'terminal-delivered', state: 'ok', origin: 'local', delivery: 'not-sent' });
          }
        } : c.emitCalendar });
      } catch (error) {
        const code=error instanceof AppError ? error.code : 'INTERRUPTED'; ready.providerFailure(code);
        if (outcome === 'unknown') outcome = code === 'CANCELLED' ? 'cancelled' : code === 'INTERRUPTED' ? 'interrupted' : 'failed';
        t.measure(code === 'CANCELLED' || code === 'INTERRUPTED' || code === 'TIMEOUT' ? 'interruption' : 'failure');
        t.event('attempt',{ code,ok:false }); throw error;
      } finally {
        const counts = t.databaseCounts();
        t.event('process', { stage:'terminal', chat:outcome, terminalCallbackReturned,
          durationMs:t.monotonic()-start, ...t.turnDriverCounts(), eventLoopDelayMs:t.sampleEventLoopDelay(),
          mongoReads:counts.read, mongoWrites:counts.write, mongoFailures:counts.failed,
          mongoBusyMs:counts.busyMs, mongoOverlapMs:counts.overlapMs });
        t.measure('total_run',t.monotonic()-start);
      }
    })),
  };
}
