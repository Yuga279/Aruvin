/**
 * ============================================================================
 * FILE: work.ts
 * LOCATION: backend/src/chat-runtime/work.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Track request-owned jobs, linked abort, deadlines, heartbeats, and quarantine.
 *
 * ROLE IN PROJECT:
 *    Enforces one stream executor per session, bounds wait times without
 *    cancelling MongoDB writes, and reports drain honestly for P8.
 *
 * KEY COMPONENTS:
 *    - WorkRegistry: Session admission, stream reservation, snapshots, drain.
 *    - Stream fence: Atomic quiesce that rejects, aborts, and waits to persist.
 *    - Work: Abort mapping, tracked promises, heartbeat, wait/quarantine.
 * ============================================================================
 */

import { AppError } from '../platform/errors/app-error.js';

export type StreamReservation = {
  readonly userId: string;
  readonly sessionId: string;
  readonly signal: AbortSignal;
  run<T>(work: () => Promise<T>): Promise<T>;
  release(): void;
};

export type StreamQuiesceResult = {
  drained: boolean;
  active: number;
  unresolvedWrites: number;
  fenced: true;
};

function isInterrupt(error: unknown): boolean {
  return error instanceof AppError
    && (error.code === 'INTERRUPTED' || error.code === 'CANCELLED' || error.code === 'TIMEOUT');
}

export class WorkRegistry {
  accepting = true;
  degraded = false;
  private fenceClosed = false;
  private jobs = new Map<string, Work>();
  private reserved = new Set<string>();
  private holds = new Set<Promise<unknown>>();
  constructor(private readonly maximum: number | (() => number) = 8) {}
  get fenced() { return this.fenceClosed; }
  key(u: string, s: string) { return JSON.stringify([u, s]); }
  get(u: string, s: string) { return this.jobs.get(this.key(u, s)); }
  open(u: string, s: string, signal: AbortSignal, totalMs: number, recovery = false) {
    if (this.jobs.has(this.key(u, s))) throw new AppError('CONFLICT_ACTIVE_TURN', 'Another request owns this turn.');
    const max = typeof this.maximum === 'function' ? this.maximum() : this.maximum;
    if (!recovery && this.jobs.size >= max) throw new AppError('CONCURRENCY_LIMIT', 'Too many chat requests are active.');
    const job = new Work(signal, totalMs, () => this.jobs.delete(this.key(u, s)), () => { this.degraded = true; });
    this.jobs.set(this.key(u, s), job); return job;
  }
  /**
   * Fence a relevant stream attachment before its first asynchronous status work.
   * Relevant means an operator chat stream on this single-process runtime.
   */
  reserve(u: string, s: string, signal: AbortSignal, totalMs: number): StreamReservation {
    if (this.fenceClosed) throw new AppError('NOT_READY', 'Stream attachments are fenced.');
    const job = this.open(u, s, signal, totalMs);
    const key = this.key(u, s);
    this.reserved.add(key);
    return {
      userId: u,
      sessionId: s,
      signal: job.signal,
      run: <T>(work: () => Promise<T>) => this.hold(u, s, key, job, work),
      release: () => this.releaseReservation(u, s, key, job),
    };
  }
  /**
   * Adopt a reserved stream for executeTurn, or open one if none exists.
   * A second owner still conflicts. New attachments are rejected while fenced.
   */
  attach(u: string, s: string, signal: AbortSignal, totalMs: number): Work {
    const key = this.key(u, s);
    const existing = this.get(u, s);
    if (existing && this.reserved.has(key)) {
      this.reserved.delete(key);
      return existing;
    }
    if (this.fenceClosed) throw new AppError('NOT_READY', 'Stream attachments are fenced.');
    return this.open(u, s, signal, totalMs);
  }
  snapshot() { return { accepting: this.accepting, active: this.jobs.size,
    unresolvedWrites: [...this.jobs.values()].reduce((n, j) => n + j.pending.size, 0), degraded: this.degraded }; }
  async drain(ms: number) {
    this.accepting = false;
    const until = Date.now() + ms;
    while (this.jobs.size && Date.now() < until) await new Promise<void>(resolve => setTimeout(resolve, Math.min(10, Math.max(1, until - Date.now()))));
    if (this.jobs.size) for (const job of this.jobs.values()) job.abort('INTERRUPTED');
    const state = this.snapshot();
    return { drained: state.active === 0 && state.unresolvedWrites === 0, active: state.active, unresolvedWrites: state.unresolvedWrites };
  }
  /**
   * Atomically reject new relevant attachments, abort existing work, and wait
   * for each reserved run through final message persistence. Never reopens.
   */
  async quiesce(ms: number): Promise<StreamQuiesceResult> {
    this.fenceClosed = true;
    for (const job of this.jobs.values()) job.abort('INTERRUPTED');
    const held = [...this.holds];
    const waitHolds = Promise.all(held.map(async promise => {
      try { await promise; }
      catch (error) { if (!isInterrupt(error)) throw error; }
    }));
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        waitHolds.then(() => 'done' as const),
        new Promise<'timeout'>(resolve => {
          timeoutId = setTimeout(() => resolve('timeout'), Math.max(1, ms));
        }),
      ]);
      if (result === 'timeout') {
        void waitHolds.then(() => undefined, () => undefined);
        const state = this.snapshot();
        return { drained: false, active: state.active, unresolvedWrites: state.unresolvedWrites, fenced: true };
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
    const until = Date.now() + Math.max(0, ms);
    while (this.jobs.size && Date.now() < until) {
      await Promise.allSettled([...this.jobs.values()].map(job => job.settled()));
      if (!this.jobs.size) break;
      await new Promise<void>(resolve => setTimeout(resolve, Math.min(10, Math.max(1, until - Date.now()))));
    }
    const state = this.snapshot();
    return {
      drained: state.active === 0 && state.unresolvedWrites === 0,
      active: state.active, unresolvedWrites: state.unresolvedWrites, fenced: true,
    };
  }
  releaseFence() { this.fenceClosed = false; }
  interruptUser(userId: string): void {
    for (const [key, job] of this.jobs) {
      const [owner] = JSON.parse(key) as [string, string];
      if (owner === userId) job.abort('INTERRUPTED');
    }
  }
  private hold<T>(u: string, s: string, key: string, reservedJob: Work, work: () => Promise<T>): Promise<T> {
    const run = (async () => {
      try { return await work(); }
      finally {
        const job = this.get(u, s);
        if (job === reservedJob) {
          this.reserved.delete(key);
          await job.settled();
          if (this.get(u, s) === job) {
            try { job.close(); } catch { /* still pending; quiesce reports unresolved */ }
          }
        }
      }
    })();
    this.holds.add(run);
    void run.finally(() => this.holds.delete(run)).then(() => undefined, () => undefined);
    return run;
  }
  private releaseReservation(u: string, s: string, key: string, reservedJob: Work) {
    if (!this.reserved.has(key) || this.get(u, s) !== reservedJob) return;
    this.reserved.delete(key);
    const job = this.get(u, s);
    if (!job) return;
    try { job.close(); } catch { /* still pending */ }
  }
}
export class Work {
  private closed = false;
  private controller = new AbortController();
  readonly signal = this.controller.signal;
  readonly pending = new Set<Promise<unknown>>();
  private code: 'INTERRUPTED' | 'CANCELLED' | 'TIMEOUT' = 'INTERRUPTED';
  private timer: ReturnType<typeof setTimeout>;
  private disconnect = () => this.abort('INTERRUPTED');
  private heartbeat: Promise<void> | null = null;
  private heartbeatStopped = true;
  private wakeHeartbeat: (() => void) | null = null;
  constructor(private outer: AbortSignal, ms: number, private remove: () => void, private quarantine: () => void) {
    this.timer = setTimeout(() => this.abort('TIMEOUT'), ms);
    if (outer.aborted) this.disconnect(); else outer.addEventListener('abort', this.disconnect, { once: true });
  }
  abort(code: 'INTERRUPTED' | 'CANCELLED' | 'TIMEOUT') { if (!this.signal.aborted) { this.code = code; this.controller.abort(); } }
  failure() { return new AppError(this.code, this.code === 'CANCELLED' ? 'Generation was cancelled.' : 'Generation was interrupted. Retry to continue.', false); }
  check() { if (this.signal.aborted) throw this.failure(); }
  track<T>(p: Promise<T>): Promise<T> {
    this.pending.add(p); void p.then(() => this.pending.delete(p), () => this.pending.delete(p)); return p;
  }
  async wait<T>(promise: Promise<T>, ms: number): Promise<T> {
    const p = this.track(promise); let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([p, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { this.quarantine(); this.abort('INTERRUPTED');
        reject(new AppError('PERSISTENCE_ERROR', 'The chat save could not be confirmed.', false)); }, ms);
    })]); } finally { if (timer) clearTimeout(timer); }
  }
  startHeartbeat(renew: () => Promise<void>, period = 30000) {
    this.heartbeatStopped = false;
    this.heartbeat = (async () => {
      while (!this.heartbeatStopped && !this.signal.aborted) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(done, period);
          const stop = () => done();
          const thisSignal = this.signal;
          const clearWake = () => { this.wakeHeartbeat = null; };
          function done() { clearTimeout(timer); thisSignal.removeEventListener('abort', stop); clearWake(); resolve(); }
          this.wakeHeartbeat = done;
          if (thisSignal.aborted) done(); else thisSignal.addEventListener('abort', stop, { once: true });
        });
        if (this.heartbeatStopped || this.signal.aborted) break;
        try { await renew(); } catch { this.quarantine(); this.abort('INTERRUPTED'); }
      }
    })();
  }
  async stopHeartbeat() { this.heartbeatStopped = true; this.wakeHeartbeat?.(); await this.heartbeat; }
  async settled(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled(Array.from(this.pending));
    }
  }
  close() {
    if (this.closed) return;
    if (this.pending.size || !this.heartbeatStopped) throw new AppError('NOT_READY', 'Chat work is not quiescent.');
    this.closed = true;
    clearTimeout(this.timer); this.outer.removeEventListener('abort', this.disconnect); this.remove();
  }
}
