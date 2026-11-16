/**
 * ============================================================================
 * FILE: deadlines.spec.ts
 * LOCATION: backend/test/model/deadlines.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify linked abort, finite provider deadlines, and bounded JSON reads.
 *
 * ROLE IN PROJECT:
 *    Proves connect/first/idle/total timers abort cleanly, external cancel wins
 *    over backoff, and JSON bodies cannot be read without a byte ceiling.
 *
 * KEY COMPONENTS:
 *    - Fake-clock deadline tests: Expire phases and clean leftover timers.
 *    - Body/backoff tests: Bounded JSON and abortable sleep.
 * ============================================================================
 */

import { RunDeadlines, sleep, readJson } from '../../src/model/deadlines.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
afterEach(()=>vi.useRealTimers());
it.each(['connect','first','idle','total'] as const)('expires %s deadline and cleans timers',async phase=>{
  vi.useFakeTimers();
  const d=new RunDeadlines({...DEFAULT_BUDGETS,totalRunTimeoutMs:10000},new AbortController().signal);
  if(phase==='connect')d.armConnect(5);
  if(phase==='first'){d.headers();d.armFirst(5);}
  if(phase==='idle'){d.headers();d.firstText();d.armIdle(5);}
  await vi.advanceTimersByTimeAsync(phase==='total'?10000:6);
  expect(d.signal.aborted).toBe(true);expect(d.failure().code).toBe('TIMEOUT');
  d.dispose();expect(vi.getTimerCount()).toBe(0);
});
it('external abort wins cancellation and cancels pending backoff',async()=>{
  vi.useFakeTimers();const outer=new AbortController();const d=new RunDeadlines(DEFAULT_BUDGETS,outer.signal);
  const waiting=sleep(1000,d.signal);const result=expect(waiting).rejects.toMatchObject({code:'CANCELLED'});
  outer.abort();await result;expect(d.failure().code).toBe('CANCELLED');d.dispose();expect(vi.getTimerCount()).toBe(0);
});
it('bounds JSON bodies instead of calling unbounded Response.json',async()=>{
  await expect(readJson(new Response('x'.repeat(100)),50)).rejects.toThrow();
  await expect(readJson(new Response('{"ok":true}'),50)).resolves.toEqual({ok:true});
});
it('pre-aborted signal starts no timers',()=>{
  vi.useFakeTimers();const controller=new AbortController();controller.abort();
  const d=new RunDeadlines(DEFAULT_BUDGETS,controller.signal);expect(d.signal.aborted).toBe(true);d.dispose();expect(vi.getTimerCount()).toBe(0);
});
it('frame activity does not postpone first output',async()=>{
  vi.useFakeTimers();const d=new RunDeadlines({...DEFAULT_BUDGETS,firstOutputTimeoutMs:10,idleStreamTimeoutMs:8,totalRunTimeoutMs:100},new AbortController().signal);
  d.headers();await vi.advanceTimersByTimeAsync(5);d.frame();await vi.advanceTimersByTimeAsync(6);expect(d.signal.aborted).toBe(true);d.dispose();
});
it('dispatch reset and idle activity never extend total including backoff',async()=>{
  vi.useFakeTimers();const d=new RunDeadlines({...DEFAULT_BUDGETS,totalRunTimeoutMs:10},new AbortController().signal);
  await vi.advanceTimersByTimeAsync(6);d.resetDispatch();d.armConnect();d.frame();await vi.advanceTimersByTimeAsync(5);expect(d.failure().code).toBe('TIMEOUT');expect(d.signal.aborted).toBe(true);d.dispose();
});
it('second dispatch near an absolute deadline only gets remaining time', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
  const deadlineAt = '2026-10-20T00:00:10.000Z';
  const first = new RunDeadlines({ ...DEFAULT_BUDGETS, totalRunTimeoutMs: 180000 }, new AbortController().signal, deadlineAt);
  await vi.advanceTimersByTimeAsync(10000);
  expect(first.signal.aborted).toBe(true);
  expect(first.failure().code).toBe('TIMEOUT');
  first.dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.setSystemTime(new Date('2026-10-20T00:00:07.000Z'));
  const second = new RunDeadlines({ ...DEFAULT_BUDGETS, totalRunTimeoutMs: 180000 }, new AbortController().signal, deadlineAt);
  await vi.advanceTimersByTimeAsync(2999);
  expect(second.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(second.signal.aborted).toBe(true);
  second.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
it('expired or invalid absolute deadlines fail closed without extra total-run time', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T00:00:10.000Z'));
  const expired = new RunDeadlines(DEFAULT_BUDGETS, new AbortController().signal, '2026-10-20T00:00:00.000Z');
  expect(expired.signal.aborted).toBe(true);
  expect(expired.failure().code).toBe('TIMEOUT');
  expired.dispose();
  expect(vi.getTimerCount()).toBe(0);
  expect(() => new RunDeadlines(DEFAULT_BUDGETS, new AbortController().signal, 'not-a-date')).toThrow();
});

