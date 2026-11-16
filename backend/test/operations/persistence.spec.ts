/**
 * ============================================================================
 * FILE: persistence.spec.ts
 * LOCATION: backend/test/operations/persistence.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove persistence decoration keeps original receivers and redacts faults.
 *
 * ROLE IN PROJECT:
 *    Ensures write/checkpoint/dedup/accounting observations do not inspect
 *    payloads or serialize database exceptions into logs.
 *
 * KEY COMPONENTS:
 *    - Receiver binding: Original this is used for success and rejection.
 *    - Accounting/dedup/checkpoint: Allowlisted metadata and put timing only.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { Telemetry } from '../../src/operations/telemetry.js';
import { observeMethods, observePersistence } from '../../src/operations/observe-persistence.js';
import type { PersistenceBundle } from '../../src/persistence/persistence.js';
it('calls the original receiver once and measures rejection without serializing exceptions', async () => {
  const lines: string[] = []; const t = new Telemetry(s => { lines.push(s); });
  class Store {
    n = 0;
    async put() { this.n++; if (this.n === 2) throw new Error('private database URI'); return this.n; }
  }
  const raw = new Store(); const observed = observeMethods(raw, t, 'write', ['put']);
  expect(await observed.put()).toBe(1);
  await expect(observed.put()).rejects.toThrow('private database URI');
  expect(raw.n).toBe(2); expect(t.snapshot().write.count).toBe(2);
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({ stage: 'persistence', state: 'error' });
  expect(lines.join()).not.toContain('private database URI');
});
it('records only allowed accounting metadata and a dedup lookup hit', async () => {
  const lines:string[] = []; const t = new Telemetry(s => { lines.push(s); });
  const raw = { async putAccounting(_record:unknown) { return undefined; },
    async getAttemptByIdempotency() { return { content:'private' }; } };
  const p = observeMethods(raw,t,'write',['putAccounting','getAttemptByIdempotency']);
  await p.putAccounting({ sessionId:'s',turnId:'t',attemptId:'a',generationId:'g',
    accountingStatus:'unknown',content:'private',apiKey:'secret' });
  await p.getAttemptByIdempotency();
  expect(t.snapshot().accounting_unknown.count).toBe(1);
  expect(t.snapshot().dedup_hit.count).toBe(1); expect(lines.join()).not.toContain('private');
});
it('times original checkpoint put and putWrites without looking at payload', async () => {
  const t = new Telemetry(() => undefined); const receiver = {
    alive:true, async put(_v:unknown) { expect(this.alive).toBe(true); },
    async putWrites(_v:unknown) { expect(this.alive).toBe(true); },
  };
  const saver = observeMethods(receiver,t,'checkpoint',['put','putWrites']);
  await saver.put({ secret:'never inspect' }); await saver.putWrites({ content:'private' });
  expect(t.snapshot().checkpoint.count).toBe(2);
});

it('observes v2 facade writes once without examining sensitive payloads', async () => {
  const telemetry = new Telemetry(() => undefined);
  const connection = {
    calls: 0,
    async compareAndSwap(_input: unknown) {
      this.calls += 1;
      return { outcome: 'uncertain' as const };
    },
  };
  const proposals = {
    calls: 0,
    async consume(_input: unknown) { this.calls += 1; return { outcome: 'consumed' }; },
  };
  const retention = { async sweepMultiCalendarPage(_input: unknown) { return { nextCursor: null }; } };
  const bundle = {
    sessions: {}, messages: {}, memory: {}, metadata: {}, checkpoints: {},
    calendarConnectionsV2: connection, calendarProposals: proposals, calendarRetention: retention,
  } as unknown as PersistenceBundle;
  const observed = observePersistence(bundle, telemetry);
  const payload = new Proxy({}, { get() { throw new Error('Payload was inspected.'); } });
  await observed.calendarConnectionsV2.compareAndSwap(payload as never);
  await observed.calendarProposals.consume(payload as never);
  await observed.calendarRetention.sweepMultiCalendarPage(payload as never);
  expect(connection.calls).toBe(1);
  expect(proposals.calls).toBe(1);
  expect(telemetry.snapshot().write.count).toBe(3);
});
