/**
 * ============================================================================
 * FILE: operations.service.ts
 * LOCATION: backend/src/operations/operations.service.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compose readiness, admission, observed runtime, and bounded shutdown.
 *
 * ROLE IN PROJECT:
 *    Coordinates P5 stop/drain with persistence close for P9 lifecycle while
 *    keeping a single telemetry and runtime instance for HTTP admission.
 *
 * KEY COMPONENTS:
 *    - accept/metrics: Generation gate and finite observation snapshot.
 *    - shutdown: Idempotent synchronous stop, concurrent bounded voice/runtime
 *      drains, and one persistence close only after every required drain succeeds.
 * ============================================================================
 */

import { Admission } from './admission.js';
import { Telemetry } from './telemetry.js';
import { Readiness } from './readiness.js';
import { observedRuntime } from './observed-runtime.js';
import { boundedResult } from './bounded.js';
import { AppError } from '../platform/errors/app-error.js';
import type { OperationsOptions } from './options.js';

export class OperationsService {
  readonly telemetry:Telemetry;
  readonly readiness:Readiness;
  readonly runtime:ReturnType<typeof observedRuntime>;
  readonly admission:Admission;
  private shutdownJob:Promise<{ safe:boolean }> | null=null;
  constructor(readonly o:OperationsOptions, telemetry?:Telemetry) {
    this.telemetry=telemetry ?? new Telemetry(o.writeLog,o.now);
    this.readiness=new Readiness(o); this.runtime=observedRuntime(o.runtime,this.telemetry,this.readiness);
    this.admission=new Admission(() => this.generationRateCap());
  }
  private generationRateCap(): number {
    return this.o.currentConfig?.current()?.budgets.maxRequestsPerMinutePerUser
      ?? this.o.config.budgets.maxRequestsPerMinutePerUser;
  }
  private generationConcurrencyCap(): number {
    return this.o.currentConfig?.current()?.budgets.maxConcurrentGenerationsPerProcess
      ?? this.o.config.budgets.maxConcurrentGenerationsPerProcess;
  }
  async accept() {
    if (!(await this.readiness.readForText()).acceptReady) throw new AppError('NOT_READY','Chat is temporarily unavailable.');
    if (this.runtime.snapshot().active >= this.generationConcurrencyCap())
      throw new AppError('CONCURRENCY_LIMIT','Too many responses are active.');
    this.telemetry.measure('admitted');
  }
  async acceptForRetry() {
    if (!(await this.readiness.readForRetry()).acceptReady) throw new AppError('NOT_READY','Chat is temporarily unavailable.');
    if (this.runtime.snapshot().active >= this.generationConcurrencyCap())
      throw new AppError('CONCURRENCY_LIMIT','Too many responses are active.');
    this.telemetry.measure('admitted');
  }
  metrics() { return { observations:this.telemetry.snapshot(),runtime:this.runtime.snapshot(),
    transport:this.o.transportSnapshot(), ...(this.o.voiceSnapshot ? { voice:this.o.voiceSnapshot() } : {}) }; }
  shutdown():Promise<{ safe:boolean }> {
    if (this.shutdownJob) return this.shutdownJob;
    this.readiness.closing=true; this.o.stopVoice?.(); this.o.stopConfig?.(); this.o.stopCalendar?.(); this.o.runtime()?.stopAccepting();
    this.shutdownJob=(async () => {
      const start=this.telemetry.now(); const ms=this.o.config.budgets.shutdownDrainMs;
      const remaining=() => Math.max(0, start + ms - this.telemetry.now());
      // Start media drain alongside the model drain under the same deadline.
      const voiceJob=this.o.drainVoice
        ? boundedResult(Promise.resolve().then(() => this.o.drainVoice!(remaining())),remaining())
        : Promise.resolve({ ok:true as const,value:{ drained:true,active:0 } });
      const r=this.o.runtime();
      const drained=r ? await boundedResult(Promise.resolve().then(() => r.drain(remaining())),remaining()) :
        { ok:true as const,value:{ drained:true,active:0,unresolvedWrites:0 } };
      const config=this.o.drainConfig
        ? await boundedResult(Promise.resolve().then(() => this.o.drainConfig!(remaining())),remaining())
        : { ok:true as const,value:{ drained:true,unresolvedWrites:0 } };
      const calendar=this.o.drainCalendar
        ? await boundedResult(Promise.resolve().then(() => this.o.drainCalendar!(remaining())),remaining())
        : { ok:true as const,value:{ drained:true,active:0,unresolvedWrites:0 } };
      const voice=await voiceJob;
      let safe=false;
      if (drained.ok && drained.value.drained && drained.value.active === 0 && drained.value.unresolvedWrites === 0
          && voice.ok && voice.value.drained && voice.value.active === 0
          && config.ok && config.value.drained && config.value.unresolvedWrites === 0
          && calendar.ok && calendar.value.drained && calendar.value.active === 0 && calendar.value.unresolvedWrites === 0
          && this.o.transportSnapshot().active === 0) {
        // This close phase has its own finite budget. P9 must not close DB sooner.
        const close=await boundedResult(Promise.resolve().then(() => this.o.closePersistence()),
          this.o.config.budgets.persistenceTimeoutMs);
        safe=close.ok;
      }
      this.telemetry.measure('shutdown',this.telemetry.now()-start);
      this.telemetry.event('shutdown',{ ok:safe }); return { safe };
    })();
    return this.shutdownJob;
  }
  async beforeApplicationShutdown():Promise<void> {
    const result=await this.shutdown();
    if (!result.safe) process.exitCode=1;
  }
}
