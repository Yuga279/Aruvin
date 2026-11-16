/**
 * ============================================================================
 * FILE: owned-phases.spec.ts
 * LOCATION: backend/test/persistence/owned-phases.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify short owned phases, single-fence elision, control serialization,
 *    operation ceilings, and fail-safe drain barriers in MongoOwnership.
 *
 * ROLE IN PROJECT:
 *    Ensures multiple repository actions within a bounded phase share one
 *    authoritative executor fence while enforcing deadlines and draining all
 *    tracked writes before token close.
 *
 * KEY COMPONENTS:
 *    - Single fence query pair per phase vs per-operation fence.
 *    - Control serialization blocking release/handoff while write is unresolved.
 *    - Deadline and lease-expiry pre-mutation enforcement.
 *    - All-settled draining and error latching.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { calendarMemory } from './calendar-multi-memory.js';
import { key } from '../../src/persistence/records.js';
import { session } from './fixtures.js';

async function setup() {
  const mem = calendarMemory();
  const owner = new MongoOwnership(mem.store, 'test-executor');
  const sessions = new MongoSessions(mem.store, DEFAULT_BUDGETS);
  await owner.claimExecutor();
  await sessions.createIfAbsent(session('u1', 's1'));
  const acquired = await owner.acquire({
    userId: 'u1',
    sessionId: 's1',
    ownerId: 'test-executor',
    leaseMs: 30000,
  });
  if (!acquired.ok) throw new Error('Failed to acquire lease');
  return { mem, owner, sessions, lease: acquired.lease };
}

it('performs only one fence validation pair for multiple operations inside runPhase', async () => {
  const { mem, owner, lease } = await setup();

  // Baseline: two independent owner.run calls outside a phase perform 2 fences
  mem.calls.length = 0;
  await owner.run(lease, async () => 1);
  await owner.run(lease, async () => 2);
  const baselineFenceReads = mem.calls.filter(
    c => c.method === 'findOne' && (c.collection === 'sessions' || c.collection === 'metadata'),
  ).length;
  expect(baselineFenceReads).toBe(4); // 2 calls * (assertExecutor + session fence)

  // Under runPhase: two operations inside share a single fence pair at phase entry
  mem.calls.length = 0;
  const result = await owner.runPhase(
    lease,
    { name: 'acceptance-stage', deadlineAt: Date.now() + 10000, maxOperations: 8 },
    async () => {
      const a = await owner.run(lease, async () => 10);
      const b = await owner.run(lease, async () => 20);
      return a + b;
    },
  );
  expect(result).toBe(30);
  const phaseFenceReads = mem.calls.filter(
    c => c.method === 'findOne' && (c.collection === 'sessions' || c.collection === 'metadata'),
  ).length;
  expect(phaseFenceReads).toBe(2); // exactly 1 assertExecutor + 1 session fence
});

it('blocks releaseExecutor and same-process handoff while a phase write is held', async () => {
  const { mem, owner, lease } = await setup();
  let writeBlocked = true;
  let releaseCalled = false;
  let releaseSettled = false;

  const phasePromise = owner.runPhase(
    lease,
    { name: 'acceptance-stage', deadlineAt: Date.now() + 10000, maxOperations: 8 },
    async () => {
      return owner.run(lease, async () => {
        while (writeBlocked) {
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
        await mem.store.collection('sessions').updateOne(
          { _id: key('session', lease.userId, lease.sessionId) },
          { $set: { 'execution.ownerId': null, 'execution.leaseExpiresAt': null } },
        );
        return 'phase-done';
      });
    },
  );

  // Request release while phase is running
  const releasePromise = (async () => {
    releaseCalled = true;
    await owner.releaseExecutor();
    releaseSettled = true;
  })();

  // Give a small tick for release to enter queue
  await new Promise<void>(resolve => setTimeout(resolve, 30));
  expect(releaseCalled).toBe(true);
  expect(releaseSettled).toBe(false);

  // Unblock the phase write
  writeBlocked = false;
  expect(await phasePromise).toBe('phase-done');

  // Now release is allowed to settle
  await releasePromise;
  expect(releaseSettled).toBe(true);
});

it('refuses nested action if phase deadline or lease expires before dispatch', async () => {
  const { owner, lease } = await setup();

  // Expired phase deadline
  await expect(
    owner.runPhase(
      lease,
      { name: 'acceptance-stage', deadlineAt: Date.now() - 100, maxOperations: 8 },
      async () => {
        return owner.run(lease, async () => 1);
      },
    ),
  ).rejects.toMatchObject({ code: 'INTERRUPTED' });

  // Expired lease
  const expiredLease = { ...lease, leaseExpiresAt: new Date(Date.now() - 100).toISOString() };
  await expect(
    owner.runPhase(
      expiredLease,
      { name: 'acceptance-stage', deadlineAt: Date.now() + 10000, maxOperations: 8 },
      async () => {
        return owner.run(expiredLease, async () => 1);
      },
    ),
  ).rejects.toMatchObject({ code: 'INTERRUPTED' });
});

it('enforces maximum operations ceiling within a phase', async () => {
  const { owner, lease } = await setup();

  await expect(
    owner.runPhase(
      lease,
      { name: 'acceptance-stage', deadlineAt: Date.now() + 10000, maxOperations: 2 },
      async () => {
        await owner.run(lease, async () => 1);
        await owner.run(lease, async () => 2);
        await owner.run(lease, async () => 3);
      },
    ),
  ).rejects.toMatchObject({ code: 'STORAGE_BUDGET_EXCEEDED' });
});

it('drains all operations via Promise.allSettled and latches error if a sibling fails', async () => {
  const { owner, lease } = await setup();
  let slowFinished = false;

  await expect(
    owner.runPhase(
      lease,
      { name: 'acceptance-stage', deadlineAt: Date.now() + 10000, maxOperations: 8 },
      async () => {
        const p1 = owner.run(lease, async () => {
          throw new AppError('PERSISTENCE_ERROR', 'Simulated write failure.');
        });
        const p2 = owner.run(lease, async () => {
          await new Promise<void>(resolve => setTimeout(resolve, 20));
          slowFinished = true;
          return 'ok';
        });
        await Promise.allSettled([p1, p2]);
        const err = await p1.catch(e => e);
        throw err;
      },
    ),
  ).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });

  expect(slowFinished).toBe(true);
});

it('rejects nested phases and lease mismatch', async () => {
  const { owner, lease } = await setup();

  // Nested phase rejected
  await expect(
    owner.runPhase(
      lease,
      { name: 'acceptance-stage', deadlineAt: Date.now() + 10000, maxOperations: 8 },
      async () => {
        return owner.runPhase(
          lease,
          { name: 'acceptance-publish', deadlineAt: Date.now() + 10000, maxOperations: 8 },
          async () => 1,
        );
      },
    ),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  // Mismatched lease rejected
  const otherLease = { ...lease, sessionId: 'other-session' };
  await expect(
    owner.runPhase(
      lease,
      { name: 'acceptance-stage', deadlineAt: Date.now() + 10000, maxOperations: 8 },
      async () => {
        return owner.run(otherLease, async () => 1);
      },
    ),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('stops a multi-write action before the second mutation if the first write exceeded the phase deadline', async () => {
  let currentTime = 1000;
  const mem = calendarMemory();
  const owner = new MongoOwnership(mem.store, 'test-executor', () => currentTime);
  const sessions = new MongoSessions(mem.store, DEFAULT_BUDGETS);
  await owner.claimExecutor();
  await sessions.createIfAbsent(session('u1', 's1'));
  const acquired = await owner.acquire({
    userId: 'u1',
    sessionId: 's1',
    ownerId: 'test-executor',
    leaseMs: 30000,
  });
  if (!acquired.ok) throw new Error('Failed to acquire lease');
  const lease = acquired.lease;

  // Phase deadline is at currentTime + 50 = 1050
  await expect(
    owner.runPhase(
      lease,
      { name: 'acceptance-stage', deadlineAt: 1050, maxOperations: 8 },
      async () => {
        return owner.run(lease, async () => {
          // First write at currentTime = 1000
          await mem.store.collection('metadata').insertOne({ _id: 'first-write' });
          // Time elapses past deadline (now 1060 > 1050)
          currentTime = 1060;
          // Second write should be blocked by RecordStore.beforeMutation!
          await mem.store.collection('metadata').insertOne({ _id: 'second-write' });
        });
      },
    ),
  ).rejects.toMatchObject({ code: 'INTERRUPTED' });

  // Verify second write never landed in metadata collection
  expect(mem.rows('metadata').has('first-write')).toBe(true);
  expect(mem.rows('metadata').has('second-write')).toBe(false);
});

