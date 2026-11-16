/**
 * ============================================================================
 * FILE: auth-owner.spec.ts
 * LOCATION: backend/test/runtime/auth-owner.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify one durable runtime admits multiple captured account identities.
 *
 * ROLE IN PROJECT:
 *    Proves owner-scoped status, provider attribution, and forged-identity
 *    rejection without creating per-user runtimes.
 *
 * KEY COMPONENTS:
 *    - Multi-owner submit/execute test: Isolated status and OpenRouter user.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { textConfigFixture } from './text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { principal } from '../assembly/auth-principal-fixture.js';
import { ExecutionReservations } from '../../src/chat-runtime/execution-reservations.js';

it('runs two owners through one runtime with captured provider attribution and no cross-owner status', async () => {
  const f = textConfigFixture(textSnapshot(1));
  try {
    const owners = [principal('u1').identity, principal('u2').identity, principal('admin', 'super-admin').identity];
    const accepted = await Promise.all(owners.map(identity => f.runtime.submitTurn({ identity,
      sessionId: null, content: `private ${identity.userId}`, idempotencyKey: 'same-key-0001' })));
    expect(new Set(accepted.map(a => a.sessionId)).size).toBe(3);
    for (let i = 0; i < owners.length; i++) await f.runtime.executeTurn({ userId: owners[i]!.userId,
      ...accepted[i]!, signal: new AbortController().signal, emit: async () => {} });
    expect(f.fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)).user)).toEqual(['u1', 'u2', 'admin']);
    await expect(f.runtime.getTurnStatus('u2', accepted[0]!.sessionId, accepted[0]!.turnId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.runtime.getTurnStatus('admin', accepted[0]!.sessionId, accepted[0]!.turnId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const text = JSON.stringify(f.fetcher.mock.calls[1]![1]?.body);
    expect(text).not.toContain('private u1');
  } finally { await f.dispose(); }
});

it('does not let a Super Admin cancel or retry a different owner turn', async () => {
  const f = textConfigFixture(textSnapshot(1));
  try {
    const identity = principal('u1').identity, admin = principal('admin', 'super-admin').identity;
    const ids = await f.runtime.submitTurn({ identity, sessionId: null, content: 'private', idempotencyKey: 'owner-private-01' });
    await expect(f.runtime.cancelTurn({ identity: admin, sessionId: ids.sessionId,
      turnId: ids.turnId, attemptId: ids.attemptId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.runtime.retryTurn({ identity: admin, sessionId: ids.sessionId,
      turnId: ids.turnId, idempotencyKey: 'owner-retry-0001' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.runtime.submitTurn({ identity: { ...identity, openRouterUser: 'u2' },
      sessionId: null, content: 'forged', idempotencyKey: 'forged-owner-01' }))
      .rejects.toMatchObject({ code: 'IDENTITY_OVERRIDE_REJECTED' });
    expect(f.fetcher).not.toHaveBeenCalled();
  } finally { await f.dispose(); }
});

it('scopes the same session id in reservations by owner and rejects a foreign release', async () => {
  const r = new ExecutionReservations(async () => false);
  const a = principal('u1').identity, b = principal('u2').identity;
  const one = await r.acquire({ identity: a, conversationId: 'same-session', owner: { kind: 'live', voiceSessionId: 'voice-a' } });
  const two = await r.acquire({ identity: b, conversationId: 'same-session', owner: { kind: 'live', voiceSessionId: 'voice-b' } });
  r.assertLive(one, a, 'same-session'); r.assertLive(two, b, 'same-session');
  await expect(r.release({ identity: b, reservationId: one.reservationId })).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  await r.release({ identity: a, reservationId: one.reservationId });
  expect(() => r.assertText('u2', 'same-session')).toThrow();
  await r.release({ identity: b, reservationId: two.reservationId });
});

it('shares new config revisions while accepted work keeps its earlier snapshot', async () => {
  const f = textConfigFixture(textSnapshot(1, {}, 'fixture/old', 'fixture-key-old'));
  const a = principal('u1').identity, b = principal('u2').identity;
  try {
    const old = await f.runtime.submitTurn({ identity: a, sessionId: null, content: 'before', idempotencyKey: 'config-before-01' });
    f.publish(textSnapshot(2, {}, 'fixture/new', 'fixture-key-new'));
    const next = await Promise.all([a, b].map(identity => f.runtime.submitTurn({ identity,
      sessionId: null, content: 'after', idempotencyKey: 'config-after-001' })));
    for (const [userId, ids] of [[a.userId, old], [a.userId, next[0]!], [b.userId, next[1]!]] as const)
      await f.runtime.executeTurn({ userId, ...ids, signal: new AbortController().signal, emit: async () => {} });
    expect(f.fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)).model))
      .toEqual(['fixture/old', 'fixture/new', 'fixture/new']);
    expect(f.fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)).user)).toEqual(['u1', 'u1', 'u2']);
  } finally { await f.dispose(); }
});
