/**
 * ============================================================================
 * FILE: work.spec.ts
 * LOCATION: backend/test/runtime/work.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify request-owned deadlines, heartbeat, quarantine, and drain.
 *
 * ROLE IN PROJECT:
 *    Proves P5 never admits a second session owner, retains unresolved writes,
 *    and distinguishes disconnect interruption from explicit cancellation.
 *
 * KEY COMPONENTS:
 *    - Ownership tests: Second open rejected; timed-out writes stay pending.
 *    - Heartbeat/deadline tests: Serialized renewal, finite drain, timer cleanup.
 * ============================================================================
 */

import { WorkRegistry } from '../../src/chat-runtime/work.js';
afterEach(() => vi.useRealTimers());
it('rejects a second owner and retains timed-out unresolved writes', async () => {
  vi.useFakeTimers();
  const registry = new WorkRegistry();
  const job = registry.open('u', 's', new AbortController().signal, 100);
  expect(() => registry.open('u', 's', new AbortController().signal, 100)).toThrow();
  let settle!: () => void;
  const write = new Promise<void>(resolve => { settle = resolve; });
  const result = expect(job.wait(write, 5)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  await vi.advanceTimersByTimeAsync(6); await result;
  expect(registry.snapshot().unresolvedWrites).toBe(1);
  expect(() => job.close()).toThrow();
  settle(); await write; await Promise.resolve(); job.close();
  expect(registry.snapshot().active).toBe(0);
});
it('disconnect abort is interrupted while explicit cancellation is cancelled', () => {
  const r = new WorkRegistry(); const signal = new AbortController();
  const job = r.open('u', 's', signal.signal, 1000); signal.abort();
  expect(job.failure().code).toBe('INTERRUPTED'); job.close();
  const other = r.open('u', 's', new AbortController().signal, 1000);
  other.abort('CANCELLED'); expect(other.failure().code).toBe('CANCELLED'); other.close();
});
it('serializes renewal and aborts without permitting a new executor on failure', async () => {
  vi.useFakeTimers(); const r = new WorkRegistry();
  const j = r.open('u', 's', new AbortController().signal, 100);
  const renew = vi.fn(async () => { throw new Error('lost ownership'); });
  j.startHeartbeat(renew, 5); await vi.advanceTimersByTimeAsync(6);
  expect(renew).toHaveBeenCalledTimes(1); expect(j.signal.aborted).toBe(true);
  expect(r.snapshot().degraded).toBe(true); await j.stopHeartbeat(); j.close();
  expect(vi.getTimerCount()).toBe(0);
});
it('total deadline and stop admission are finite without deleting live work', async () => {
  vi.useFakeTimers(); const r = new WorkRegistry(); const j = r.open('u', 's', new AbortController().signal, 5);
  await vi.advanceTimersByTimeAsync(6); expect(j.failure().code).toBe('TIMEOUT');
  j.close(); expect(await r.drain(1)).toEqual({ drained: true, active: 0, unresolvedWrites: 0 });
  expect(r.snapshot().accepting).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
it('removes transient work after close so a later owner can start', () => {
  const r = new WorkRegistry();
  const job = r.open('u', 's', new AbortController().signal, 1000);
  job.close();
  expect(r.snapshot().active).toBe(0);
  const next = r.open('u', 's', new AbortController().signal, 1000);
  next.close();
});

it('old release and run cleanup cannot close a newer reserved follow-up', async () => {
  const registry = new WorkRegistry(); const signal = new AbortController().signal;
  const old = registry.reserve('u', 's', signal, 1000);
  let next: ReturnType<WorkRegistry['reserve']> | undefined;
  try {
    await old.run(async () => {
      registry.attach('u', 's', signal, 1000).close();
      next = registry.reserve('u', 's', signal, 1000);
      old.release();
      expect(registry.snapshot().active).toBe(1);
    });
    expect(registry.snapshot().active).toBe(1);
  } finally { next?.release(); }
  expect(registry.snapshot().active).toBe(0);
});

it('dynamic ceiling lowering rejects subsequent open calls without aborting active work', () => {
  let limit = 2;
  const r = new WorkRegistry(() => limit);
  const j1 = r.open('u', 's1', new AbortController().signal, 1000);
  const j2 = r.open('u', 's2', new AbortController().signal, 1000);
  expect(r.snapshot().active).toBe(2);

  // Lower limit to 1
  limit = 1;
  expect(j1.signal.aborted).toBe(false);
  expect(j2.signal.aborted).toBe(false);
  expect(() => r.open('u', 's3', new AbortController().signal, 1000)).toThrowError(/Too many chat requests/);

  j1.close();
  // Still at 1 active job, limit is 1, so s3 cannot open yet
  expect(() => r.open('u', 's3', new AbortController().signal, 1000)).toThrowError(/Too many chat requests/);
  j2.close();
  // Now 0 active jobs, s3 can open
  const j3 = r.open('u', 's3', new AbortController().signal, 1000);
  j3.close();
});

it('dynamic ceiling raising admits additional work up to new maximum', () => {
  let limit = 1;
  const r = new WorkRegistry(() => limit);
  const j1 = r.open('u', 's1', new AbortController().signal, 1000);
  expect(() => r.open('u', 's2', new AbortController().signal, 1000)).toThrowError(/Too many chat requests/);

  // Raise limit to 2
  limit = 2;
  const j2 = r.open('u', 's2', new AbortController().signal, 1000);
  expect(r.snapshot().active).toBe(2);
  j1.close();
  j2.close();
});

it('interrupts one owner without fencing another owner or closing admission', async () => {
  const work = new WorkRegistry(4);
  const a = work.open('u1', 'same-session', new AbortController().signal, 1000);
  const b = work.open('u2', 'same-session', new AbortController().signal, 1000);
  try {
    work.interruptUser('u1');
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(work.accepting).toBe(true);
    expect(work.fenced).toBe(false);
  } finally { a.close(); b.close(); }
});
