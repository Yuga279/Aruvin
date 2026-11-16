/**
 * ============================================================================
 * FILE: auth-memory-owners.spec.ts
 * LOCATION: backend/test/performance/auth-memory-owners.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify memory-first state stays owner-isolated under shared process budgets.
 *
 * ROLE IN PROJECT:
 *    Proves two admitted owners cannot see each other's memory while one runtime
 *    still enforces a single session/byte/saver ceiling.
 *
 * KEY COMPONENTS:
 *    - Owner isolation test: Separate lookups and captured attribution.
 *    - Shared budget test: Second owner cannot multiply process capacity.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { textConfigFixture } from '../runtime/text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { principal } from '../assembly/auth-principal-fixture.js';
import { PROPOSED_MEMORY_TEXT_POLICY } from '../../src/chat-runtime/memory-text.js';
import type { TerminalEnvelope, SaveOutcome } from '../../src/chat-runtime/memory-first-foundation.js';

it('keeps memory replies, saves and owner-qualified lookups separate without request context', async () => {
  const saved: TerminalEnvelope[] = [];
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d, memoryFirst: {
    policy: PROPOSED_MEMORY_TEXT_POLICY, save: async (e): Promise<SaveOutcome> => {
      saved.push(e); return { kind: 'saved', epoch: e.epoch, sessionId: e.sessionId, version: e.version, fence: e.fence };
    },
  } }));
  try {
    const owners = ['u1', 'u2'].map(u => principal(u).identity);
    const rows = await Promise.all(owners.map(identity => f.runtime.submitTurn({ identity,
      sessionId: null, content: `only ${identity.userId}`, idempotencyKey: 'memory-owner-0001' })));
    for (let i = 0; i < rows.length; i++) await f.runtime.executeTurn({ userId: owners[i]!.userId,
      ...rows[i]!, signal: new AbortController().signal, emit: async () => {} });
    expect(f.runtime.memorySession('u2', rows[0]!.sessionId)).toBeNull();
    expect(f.runtime.memoryMessages('u1', rows[0]!.sessionId, { cursor: null, limit: 20 })!.items[0]!.content)
      .toBe('only u1');
    expect(f.fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)).user)).toEqual(['u1', 'u2']);
    expect(await f.runtime.drain(1000)).toMatchObject({ drained: true });
    expect(saved.map(e => e.userId).sort()).toEqual(['u1', 'u2']);
    expect(new Set(saved.map(e => e.epoch)).size).toBe(1);
  } finally { await f.dispose(); }
});

it('does not multiply session and byte budgets when another owner signs in', async () => {
  const policy = { ...PROPOSED_MEMORY_TEXT_POLICY, maxSessions: 1,
    maxMemoryBytes: PROPOSED_MEMORY_TEXT_POLICY.maxSessionBytes };
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d, memoryFirst: { policy,
    save: async e => ({ kind: 'saved', epoch: e.epoch, sessionId: e.sessionId, version: e.version, fence: e.fence }),
  } }));
  try {
    await f.runtime.submitTurn({ identity: principal('u1').identity, sessionId: null,
      content: 'one', idempotencyKey: 'budget-owner-0001' });
    const before = f.runtime.memoryFor('u1')!.foundation.totalCapacity();
    await expect(f.runtime.submitTurn({ identity: principal('u2').identity, sessionId: null,
      content: 'two', idempotencyKey: 'budget-owner-0002' })).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(f.runtime.memoryFor('u1')!.foundation.totalCapacity()).toEqual(before);
    expect(before.sessions).toBeLessThanOrEqual(policy.maxSessions);
    expect(before.reservedMemoryBytes).toBeLessThanOrEqual(policy.maxMemoryBytes);
    expect(before.reservedBacklogBytes).toBeLessThanOrEqual(policy.maxBacklogBytes);
  } finally { await f.dispose(); }
});

it('holds one process saver ceiling across owners until actual promise settlement', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d, memoryFirst: {
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxConcurrentSaves: 1, writeTimeoutMs: 20 },
    save: async e => {
      calls.push(e.userId); await gate;
      return { kind: 'saved', epoch: e.epoch, sessionId: e.sessionId, version: e.version, fence: e.fence };
    },
  } }));
  let first: Awaited<ReturnType<typeof f.runtime.submitTurn>> | undefined;
  try {
    for (const owner of ['u1', 'u2']) {
      const ids = await f.runtime.submitTurn({ identity: principal(owner).identity,
        sessionId: null, content: owner, idempotencyKey: `save-owner-${owner}` });
      if (owner === 'u1') first = ids;
      await f.runtime.executeTurn({ userId: owner, ...ids, signal: new AbortController().signal, emit: async () => {} });
    }
    await vi.waitFor(() => expect(f.runtime.memoryFor('u1')!.foundation.snapshot().unresolvedWrites).toBe(1));
    expect(calls).toEqual(['u1']);
    if (!first) throw new Error('Missing accepted fixture');
    const accepted = first;
    await vi.waitFor(async () => expect((await f.runtime.getTurnStatus('u1', accepted.sessionId, accepted.turnId)).save?.state)
      .toBe('unknown'), { timeout: 1000 });
    expect(calls).toEqual(['u1']);
    release();
    await vi.waitFor(() => expect(calls).toEqual(['u1', 'u2']));
    expect(await f.runtime.drain(1000)).toMatchObject({ drained: true });
  } finally { release(); await f.dispose(); }
});

it('does not dispatch a third owner save until an actual promise settles', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const f = textConfigFixture(textSnapshot(1), d => ({ ...d, memoryFirst: {
    policy: { ...PROPOSED_MEMORY_TEXT_POLICY, maxConcurrentSaves: 2, writeTimeoutMs: 20 },
    save: async e => {
      calls.push(e.userId); await gate;
      return { kind: 'saved', epoch: e.epoch, sessionId: e.sessionId, version: e.version, fence: e.fence };
    },
  } }));
  try {
    for (const owner of ['u1', 'u2', 'u3']) {
      const ids = await f.runtime.submitTurn({ identity: principal(owner).identity,
        sessionId: null, content: owner, idempotencyKey: `save-triple-${owner}` });
      await f.runtime.executeTurn({ userId: owner, ...ids, signal: new AbortController().signal, emit: async () => {} });
    }
    await vi.waitFor(() => expect(calls.sort()).toEqual(['u1', 'u2']));
    expect(calls).not.toContain('u3');
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(calls).not.toContain('u3');
    release();
    await vi.waitFor(() => expect(calls.sort()).toEqual(['u1', 'u2', 'u3']));
    expect(await f.runtime.drain(1000)).toMatchObject({ drained: true });
  } finally { release(); await f.dispose(); }
});
