/**
 * ============================================================================
 * FILE: execution-reservations.spec.ts
 * LOCATION: backend/test/runtime/execution-reservations.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for ExecutionReservations coordinator and mode exclusion.
 *
 * ROLE IN PROJECT:
 *    Validates synchronous process-local mode reservation, durable busy checks,
 *    atomic conversation binding, and exclusion of competing text execution.
 *
 * KEY COMPONENTS:
 *    - ExecutionReservations: Process-local reservation coordinator.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { ExecutionReservations } from '../../src/chat-runtime/execution-reservations.js';

const identity = { userId: 'u1', openRouterUser: 'u1', source: 'authenticated-session' as const };
const live = (voiceSessionId = 'v1', conversationId: string | null = 's1') => ({
  identity,
  conversationId,
  owner: { kind: 'live' as const, voiceSessionId },
});

it('claims synchronously before a durable probe and excludes text across tabs', async () => {
  let finish!: (busy: boolean) => void;
  const busy = vi.fn(async () => false);
  busy.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const r = new ExecutionReservations(busy);
  const first = r.acquire(live());
  expect(() => r.assertText('u1', 's1')).toThrow('Another turn is active.');
  await expect(r.acquire(live('v2'))).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  finish(false);
  const held = await first;
  r.assertLive(held, identity, 's1');
  await r.release({ identity, reservationId: held.reservationId });
  r.assertText('u1', 's1');
});

it('rolls back failed admission and rejects an already accepted or generating text turn', async () => {
  const busy = vi.fn(async () => true), r = new ExecutionReservations(busy);
  await expect(r.acquire(live())).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  r.assertText('u1', 's1');
  busy.mockResolvedValue(false);
  const held = await r.acquire(live());
  busy.mockResolvedValue(true);
  await expect(r.release({ identity, reservationId: held.reservationId }))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  expect(() => r.assertText('u1', 's1')).toThrow();
  busy.mockResolvedValue(false);
  await r.release({ identity, reservationId: held.reservationId });
});

it('binds unsaved chats atomically without blocking unrelated chats', async () => {
  const r = new ExecutionReservations(async () => false);
  const a = await r.acquire(live('v1', null)), b = await r.acquire(live('v2', null));
  const bound = await r.bindConversation({ identity, reservationId: a.reservationId, conversationId: 's1' });
  r.assertLive(bound, identity, 's1');
  r.assertText('u1', 's2');
  await expect(r.bindConversation({ identity, reservationId: b.reservationId, conversationId: 's1' }))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  await expect(r.bindConversation({ identity, reservationId: a.reservationId, conversationId: 's2' }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await r.release({ identity, reservationId: a.reservationId });
  await r.release({ identity, reservationId: a.reservationId });
  r.assertText('u1', 's1');
});

it('does not trust another identity or a caller-forged reservation', async () => {
  const r = new ExecutionReservations(async () => false), held = await r.acquire(live());
  const foreign = { ...identity, userId: 'u2', openRouterUser: 'u2' };
  await expect(r.release({ identity: foreign, reservationId: held.reservationId }))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  expect(() => r.assertLive({ ...held, owner: { kind: 'live', voiceSessionId: 'forged' } }, identity, 's1')).toThrow();
  expect(() => r.assertLive({ ...held, reservationId: 'missing' }, identity, 's1')).toThrow();
});
