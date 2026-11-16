/**
 * ============================================================================
 * FILE: ownership.native.e2e-spec.ts
 * LOCATION: backend/test/persistence/ownership.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Exercise single-executor admission, leases, sequences, and acceptance.
 *
 * ROLE IN PROJECT:
 *    Proves P2 ownership primitives against native MongoDB: no expiry takeover,
 *    reserved order replay, and acceptance only after input and attempt exist.
 *
 * KEY COMPONENTS:
 *    - Admission tests: Leftover sentinel takeover and expired-lease steal.
 *    - Acceptance tests: Reservation replay and active-slot reconciliation.
 * ============================================================================
 */

import { DEFAULT_BUDGETS } from '../../src/contracts/index.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { RecordStore } from '../../src/persistence/store.js';
import { hashPayload } from '../../src/platform/crypto/hash-payload.js';
import { attempt, message, session } from './fixtures.js';
import { nativeDatabase } from './native.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('single-executor ownership', () => {
  it('takes over a leftover executor sentinel instead of refusing startup', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      const first = new MongoOwnership(store, 'process-a');
      const second = new MongoOwnership(store, 'process-b');
      await first.claimExecutor();
      await second.claimExecutor();
      await second.assertExecutor();
      await expect(first.assertExecutor()).rejects.toMatchObject({
        code: 'UNSUPPORTED_TOPOLOGY',
      });
    } finally {
      await harness.close();
    }
  }, 30_000);

  it('never steals an expired session lease', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      await new MongoSessions(store, DEFAULT_BUDGETS).createIfAbsent(session());
      let time = Date.parse('2026-10-06T00:00:00.000Z');
      const first = new MongoOwnership(store, 'process-a', () => time);
      await first.claimExecutor();
      const input = { userId: 'u1', sessionId: 's1', ownerId: 'process-a', leaseMs: 1000 };
      const results = await Promise.all([first.acquire(input), first.acquire(input)]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      const success = results.find((result) => result.ok)!;
      if (!success.ok) {
        throw new Error('lease expected');
      }
      time += 1001;
      expect(await first.fence(success.lease)).toBe(false);
      expect((await first.acquire(input)).ok).toBe(false);
      await expect(first.run(success.lease, async () => 'write')).rejects.toMatchObject({
        code: 'INTERRUPTED',
      });
      await first.release(success.lease);
      const next = await first.acquire(input);
      expect(next.ok).toBe(true);
      if (next.ok) {
        expect(next.lease.generation).toBeGreaterThan(success.lease.generation);
      }
      expect(await first.fence(success.lease)).toBe(false);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it('replays reserved order and confirms acceptance only after input and attempt exist', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      const sessions = new MongoSessions(store, DEFAULT_BUDGETS);
      const messages = new MongoMessages(store, DEFAULT_BUDGETS);
      const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
      const owner = new MongoOwnership(store, 'process-a');
      await sessions.createIfAbsent(session());
      await owner.claimExecutor();
      const result = await owner.acquire({
        userId: 'u1',
        sessionId: 's1',
        ownerId: 'process-a',
        leaseMs: 60_000,
      });
      if (!result.ok) {
        throw new Error('lease expected');
      }
      const lease = result.lease;
      const first = await owner.allocateSequences(lease, 'reservation-a', 3);
      expect(await owner.allocateSequences(lease, 'reservation-a', 3)).toEqual(first);
      const second = await owner.allocateSequences(lease, 'reservation-b', 2);
      expect(second.start).toBeGreaterThanOrEqual(first.start + first.count);
      await owner.reserveAttempt(lease, 'a1');
      await expect(owner.confirmAcceptance(lease, 'a1')).rejects.toMatchObject({
        code: 'NOT_READY',
      });
      await owner.run(lease, async () => {
        await messages.append(message());
        await metadata.putAttempt({
          ...attempt(),
          payloadHash: hashPayload(message().content),
        });
      });
      await owner.confirmAcceptance(lease, 'a1');
      await owner.confirmAcceptance(lease, 'a1');
      expect((await sessions.get('u1', 's1'))?.latestTurnId).toBe('t1');
      expect((await metadata.getAcceptance('u1', 's1', 'a1'))?.userMessageId).toBe('m0');
      await expect(owner.reserveAttempt(lease, 'a2')).rejects.toMatchObject({
        code: 'CONFLICT_ACTIVE_TURN',
      });
      await owner.release(lease);
      expect(
        (
          await owner.acquire({
            userId: 'u1',
            sessionId: 's1',
            ownerId: 'process-a',
            leaseMs: 60_000,
          })
        ).ok,
      ).toBe(false);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it('requires explicit stopped handoff and fences all prior owner tokens', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      await new MongoSessions(store, DEFAULT_BUDGETS).createIfAbsent(session());
      const first = new MongoOwnership(store, 'process-a');
      const second = new MongoOwnership(store, 'process-b');
      await first.claimExecutor();
      const result = await first.acquire({
        userId: 'u1',
        sessionId: 's1',
        ownerId: 'process-a',
        leaseMs: 60_000,
      });
      if (!result.ok) {
        throw new Error('lease expected');
      }
      await first.drain();
      await second.handoffStoppedExecutor('process-a');
      const recovered = await second.recoverStoppedSession('u1', 's1', 'process-a', 60_000);
      expect(recovered.generation).toBeGreaterThan(result.lease.generation);
      await expect(first.run(result.lease, async () => 'unsafe')).rejects.toMatchObject({
        code: 'UNSUPPORTED_TOPOLOGY',
      });
    } finally {
      await harness.close();
    }
  }, 30_000);

  it('retains acceptance across restart and reconciles a released active slot', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      await new MongoSessions(store, DEFAULT_BUDGETS).createIfAbsent(session());
      const owner = new MongoOwnership(store, 'process-a');
      await owner.claimExecutor();
      const result = await owner.acquire({
        userId: 'u1',
        sessionId: 's1',
        ownerId: 'process-a',
        leaseMs: 60_000,
      });
      if (!result.ok) {
        throw new Error('lease expected');
      }
      await owner.reserveAttempt(result.lease, 'a1');
      await owner.run(result.lease, async () => {
        await new MongoMessages(store, DEFAULT_BUDGETS).append(message());
        await new MongoMetadata(store, DEFAULT_BUDGETS).putAttempt({
          ...attempt(),
          payloadHash: hashPayload(message().content),
        });
      });
      await owner.confirmAcceptance(result.lease, 'a1');
      const client = await harness.reconnect();
      try {
        const restarted = new MongoMetadata(
          new RecordStore(client.db(harness.name), 15_000),
          DEFAULT_BUDGETS,
        );
        expect((await restarted.getAcceptance('u1', 's1', 'a1'))?.payloadHash).toBe(
          hashPayload(message().content),
        );
        expect((await restarted.getAttempt('u1', 's1', 'a1'))?.causal.userMessageId).toBe(
          'm0',
        );
      } finally {
        await client.close();
      }
      await owner.release(result.lease);
      const recovered = await owner.recoverStoppedSession('u1', 's1', null, 60_000);
      expect(await owner.fence(recovered)).toBe(true);
      const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
      const accepted = (await metadata.getAttempt('u1', 's1', 'a1'))!;
      await owner.run(recovered, async () => {
        expect(
          await metadata.compareAttempt(
            { ...accepted, status: 'interrupted', errorCode: 'INTERRUPTED' },
            'accepted',
          ),
        ).toBe(true);
      });
      await owner.clearAttempt(recovered, 'a1');
      await owner.clearAttempt(recovered, 'a1');
      await owner.release(recovered);
      expect(
        (
          await owner.acquire({
            userId: 'u1',
            sessionId: 's1',
            ownerId: 'process-a',
            leaseMs: 60_000,
          })
        ).ok,
      ).toBe(true);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it('renews a live lease but never revives an expired one', async () => {
    const harness = await nativeDatabase();
    try {
      const store = new RecordStore(harness.db, 15_000);
      let time = Date.now();
      await new MongoSessions(store, DEFAULT_BUDGETS).createIfAbsent(session());
      const owner = new MongoOwnership(store, 'process-a', () => time);
      await owner.claimExecutor();
      const result = await owner.acquire({
        userId: 'u1',
        sessionId: 's1',
        ownerId: 'process-a',
        leaseMs: 1000,
      });
      if (!result.ok) {
        throw new Error('lease expected');
      }
      time += 500;
      const renewed = await owner.renew(result.lease, 1000);
      time += 600;
      expect(await owner.fence(renewed)).toBe(true);
      time += 401;
      await expect(owner.renew(renewed, 1000)).rejects.toMatchObject({
        code: 'INTERRUPTED',
      });
    } finally {
      await harness.close();
    }
  }, 30_000);
});
