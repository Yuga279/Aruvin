/**
 * ============================================================================
 * FILE: dependency-probe.ts
 * LOCATION: backend/test/performance/dependency-probe.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Model bounded dependency waves for offline storage-latency tests.
 *
 * ROLE IN PROJECT:
 *    A deterministic test scheduler (dependency-wave model and per-command
 *    timer overlap mode), not a driver or real-time event-loop simulator.
 *
 * KEY COMPONENTS:
 *    - DependencyProbe: Records command starts, advances waves or earliest
 *      timer completions, and drives microtasks with bounded setImmediate turns.
 * ============================================================================
 */
import { setImmediate as flushImmediate } from 'node:timers/promises';

export type ProbeKind = 'read' | 'write';
export type ProbeMode = 'wave' | 'timer';
export type ProbeEvent = { id:number; kind:ProbeKind; method:string; collection:string;
  startedAt:number; endedAt:number | null; wave:number };
export class DependencyProbe {
  readonly events:ProbeEvent[] = [];
  private now = 0;
  private wave = 0;
  private next = 0;
  private pending:Array<{ event:ProbeEvent; run:() => unknown;
    resolve:(value:unknown) => void; reject:(reason:unknown) => void }> = [];
  constructor(readonly mode:ProbeMode = 'wave') {}
  command<T>(kind:ProbeKind, method:string, collection:string, run:() => T):Promise<T> {
    if (this.events.length >= 100_000) throw new Error('Probe command ceiling exceeded');
    const event = { id:++this.next,kind,method,collection,startedAt:this.now,endedAt:null,wave:this.wave+1 };
    this.events.push(event);
    return new Promise<T>((resolve,reject) => this.pending.push({ event,run,
      resolve:value => resolve(value as T),reject }));
  }
  advance(readMs:number,writeMs:number):void {
    if (!this.pending.length) throw new Error('No pending storage wave');
    ++this.wave;
    if (this.mode === 'timer') {
      const targetOf = (item:typeof this.pending[number]) =>
        item.event.startedAt + (item.event.kind === 'read' ? readMs : writeMs);
      const nextEnd = Math.min(...this.pending.map(targetOf));
      const ready:typeof this.pending = [];
      const remaining:typeof this.pending = [];
      for (const item of this.pending) {
        if (targetOf(item) <= nextEnd) ready.push(item);
        else remaining.push(item);
      }
      this.pending = remaining;
      this.now = Math.max(this.now, nextEnd);
      for (const item of ready) {
        item.event.endedAt = this.now;
        item.event.wave = this.wave;
        try { item.resolve(item.run()); } catch (error) { item.reject(error); }
      }
      return;
    }
    // Dependency-wave model: rounds mixed-duration independent operations up to the wave boundary.
    const ready=this.pending.splice(0);
    let end=this.now;
    for (const item of ready) {
      const duration=item.event.kind === 'read' ? readMs : writeMs;
      item.event.endedAt=this.now+duration;
      end=Math.max(end,item.event.endedAt);
      try { item.resolve(item.run()); } catch (error) { item.reject(error); }
    }
    this.now=end;
  }
  async drive<T>(operation:() => Promise<T>, readMs:number, writeMs:number):Promise<T> {
    let settled = false;
    let outcome:T | undefined;
    let failure:unknown;
    let failed = false;
    const promise = Promise.resolve().then(operation).then(
      value => { settled = true; outcome = value; },
      error => { settled = true; failed = true; failure = error; },
    );
    for (let step = 0; step < 10_000; step++) {
      await flushImmediate();
      if (settled) break;
      if (!this.pending.length) {
        await flushImmediate();
        if (settled) break;
        if (!this.pending.length) throw new Error('DependencyProbe made no progress');
      }
      this.advance(readMs, writeMs);
    }
    if (!settled) {
      await flushImmediate();
      if (!settled) throw new Error('DependencyProbe advance ceiling exceeded');
    }
    await promise;
    if (failed) throw failure;
    return outcome as T;
  }
  reset():void {
    if (this.pending.length) throw new Error('Cannot reset probe with pending commands');
    this.events.length = 0;
    this.now = 0;
    this.wave = 0;
    this.next = 0;
  }
  get waiting():number { return this.pending.length; }
  get waves():number { return this.wave; }
  get elapsedMs():number { return this.now; }
}
