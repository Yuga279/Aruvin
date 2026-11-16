/**
 * ============================================================================
 * FILE: stream-quiescence.spec.ts
 * LOCATION: backend/test/runtime/stream-quiescence.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove the runtime-owned atomic stream reservation and quiescence contract.
 *
 * ROLE IN PROJECT:
 *    Gives P8 a fenced stream attachment before status work and a barrier that
 *    waits through final message persistence without silently reopening.
 *
 * KEY COMPONENTS:
 *    - Reservation tests: Fence a stream before executeTurn; adopt vs conflict.
 *    - Quiescence tests: Reject, abort, wait, propagate, keep the fence closed.
 * ============================================================================
 */

import { AppError } from '../../src/platform/errors/app-error.js';
import { WorkRegistry } from '../../src/chat-runtime/work.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function registry() {
  return new WorkRegistry();
}

it('reserves a stream before executeTurn so quiesce can see it', () => {
  const r = registry();
  const slot = r.reserve('u', 's', new AbortController().signal, 1000);
  expect(slot.userId).toBe('u');
  expect(slot.sessionId).toBe('s');
  expect(r.get('u', 's')).toBeDefined();
  expect(r.snapshot().active).toBe(1);
  expect(() => r.reserve('u', 's', new AbortController().signal, 1000))
    .toThrow(AppError);
  slot.release();
  expect(r.snapshot().active).toBe(0);
});

it('adopts a reservation once and still conflicts with a second owner', () => {
  const r = registry();
  const signal = new AbortController().signal;
  const slot = r.reserve('u', 's', signal, 1000);
  const job = r.get('u', 's');
  expect(r.attach('u', 's', signal, 1000)).toBe(job);
  expect(() => r.attach('u', 's', new AbortController().signal, 1000)).toThrow(AppError);
  expect(() => r.open('u', 's', new AbortController().signal, 1000)).toThrow(AppError);
  job!.close();
  slot.release();
});

it('quiesce rejects new relevant attachments, aborts work, and waits through persistence', async () => {
  const r = registry();
  const slot = r.reserve('u', 's', new AbortController().signal, 60_000);
  const persist = deferred();
  let persisted = false;
  const run = slot.run(async () => {
    await persist.promise;
    persisted = true;
  });
  const quiescing = r.quiesce(5_000);
  expect(r.fenced).toBe(true);
  try {
    r.reserve('u', 's2', new AbortController().signal, 1000);
    throw new Error('expected fenced reserve to fail');
  } catch (error) {
    expect(error).toMatchObject({ code: 'NOT_READY' });
  }
  expect(() => r.attach('u', 's3', new AbortController().signal, 1000)).toThrow(AppError);

  let quiesced = false;
  void quiescing.then(() => { quiesced = true; });
  await Promise.resolve();
  await Promise.resolve();
  expect(quiesced).toBe(false);
  expect(persisted).toBe(false);

  persist.resolve();
  await run;
  await expect(quiescing).resolves.toEqual({
    drained: true, active: 0, unresolvedWrites: 0, fenced: true,
  });
  expect(persisted).toBe(true);
  expect(r.fenced).toBe(true);
  expect(() => r.reserve('u', 's4', new AbortController().signal, 1000)).toThrow(AppError);
});

it('does not reopen the fence after a failed or timed-out quiesce', async () => {
  vi.useFakeTimers();
  try {
    const r = registry();
    const slot = r.reserve('u', 's', new AbortController().signal, 60_000);
    const persist = deferred();
    const run = slot.run(async () => persist.promise);
    const quiescing = r.quiesce(20);
    await vi.advanceTimersByTimeAsync(25);
    await expect(quiescing).resolves.toMatchObject({ drained: false, fenced: true });
    expect(r.fenced).toBe(true);
    expect(() => r.reserve('u', 's2', new AbortController().signal, 1000)).toThrow(AppError);
    persist.resolve();
    await run;
    expect(r.fenced).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it('propagates a persistence failure from quiesce and keeps the fence closed', async () => {
  const r = registry();
  const slot = r.reserve('u', 's', new AbortController().signal, 60_000);
  const persist = deferred();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const run = slot.run(async () => { started(); await persist.promise; });
  await ready;
  const failed = expect(run).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  const quiescing = expect(r.quiesce(5_000)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  persist.reject(new AppError('PERSISTENCE_ERROR', 'The chat save could not be confirmed.', false));
  await failed;
  await quiescing;
  expect(r.fenced).toBe(true);
  expect(() => r.reserve('u', 's2', new AbortController().signal, 1000)).toThrow(AppError);
});

it('treats abort interruption as settlement, not a quiesce failure', async () => {
  const r = registry();
  const slot = r.reserve('u', 's', new AbortController().signal, 60_000);
  let listening!: () => void;
  const armed = new Promise<void>(resolve => { listening = resolve; });
  const run = slot.run(async () => {
    await new Promise<void>((_resolve, reject) => {
      const fail = () => reject(new AppError('INTERRUPTED', 'Generation was interrupted. Retry to continue.', false));
      if (slot.signal.aborted) fail();
      else slot.signal.addEventListener('abort', fail, { once: true });
      listening();
    });
  });
  await armed;
  const failed = expect(run).rejects.toMatchObject({ code: 'INTERRUPTED' });
  const quiescing = r.quiesce(5_000);
  await failed;
  await expect(quiescing).resolves.toMatchObject({ drained: true, fenced: true, active: 0 });
  expect(r.fenced).toBe(true);
});

it('reopens only through an explicit releaseFence after a successful scan', async () => {
  const r = registry();
  await expect(r.quiesce(10)).resolves.toMatchObject({ drained: true, fenced: true });
  expect(() => r.reserve('u', 's', new AbortController().signal, 1000)).toThrow(AppError);
  r.releaseFence();
  expect(r.fenced).toBe(false);
  const slot = r.reserve('u', 's', new AbortController().signal, 1000);
  const job = r.attach('u', 's', slot.signal, 1000);
  job.close();
  slot.release();
});

it('adopts a reserved stream after the fence closes so finalization can finish', async () => {
  const r = registry();
  const slot = r.reserve('u', 's', new AbortController().signal, 1000);
  const quiescing = r.quiesce(50);
  expect(r.fenced).toBe(true);
  const job = r.attach('u', 's', slot.signal, 1000);
  expect(job.signal.aborted).toBe(true);
  job.close();
  slot.release();
  await expect(quiescing).resolves.toMatchObject({ drained: true, fenced: true, active: 0 });
});
