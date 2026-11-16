/**
 * ============================================================================
 * FILE: calendar-multi-proposals.spec.ts
 * LOCATION: backend/test/persistence/calendar-multi-proposals.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Tests for Google Calendar Phase 2 proposal persistence, consumption, and tombstones.
 *
 * ROLE IN PROJECT:
 *    Verifies session-bound pending proposal storage, atomic supersession,
 *    single-consumption CAS, replay-safe approval recovery, and tombstone replacement.
 *
 * KEY COMPONENTS:
 *    - Supersedes only expected current proposal in its own session.
 *    - Rejects invalid lifetimes, bounds, nonpending states, and mixed account bindings.
 *    - Racing approvals return original consumption.
 *    - Replay table for wrong session, changed action, changed condition, expired, cancelled.
 *    - Multi-stage selection and conflict approvals on single intent reservation.
 *    - Tombstone lifecycle transitions and wrapper confirmation.
 *    - Recovery lookups: expired current slot and scoped proposal authority.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { calendarProposalSchema, calendarProposalTombstoneSchema } from '../../src/contracts/calendar-authority.js';
import { MongoCalendarProposals } from '../../src/persistence/calendar-proposals.js';
import { proposalConsumptionKey, proposalKey } from '../../src/persistence/calendar-records.js';
import { pendingProposal, acceptedReply, connectedCalendarMemory } from './calendar-multi-fixtures.js';
import { at, entry, target, hash } from '../contracts/calendar-multi-fixtures.js';

it('supersedes only the expected current proposal in its own session', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
  const first = pendingProposal();
  expect((await store.putCurrent({ expectedProposalId: null, expectedRevision: null,
    proposal: first })).outcome).toBe('confirmed');
  const next = { ...first, proposalId: 'p2', intentId: 'intent2' };
  expect((await store.putCurrent({ expectedProposalId: 'p', expectedRevision: 2,
    proposal: next })).outcome).toBe('conflict');
  expect((await store.putCurrent({ expectedProposalId: 'p', expectedRevision: 1,
    proposal: next })).outcome).toBe('confirmed');
  expect((await store.getCurrent('u', 's'))?.proposalId).toBe('p2');
  expect(await store.getCurrent('u', 'other')).toBeNull();
  expect((await store.putCurrent({ expectedProposalId: null, expectedRevision: null,
    proposal: first })).outcome).toBe('conflict');
});

it('rejects invalid lifetimes, bounds, nonpending states, and mixed account bindings', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
  const p = pendingProposal();

  // >10-minute lifetime (600,001 ms)
  const over10mLifetime = { ...p, expiresAt: '2026-10-22T10:10:00.001Z' };
  await expect(store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: over10mLifetime }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  // Expiry beyond source permission / contentExpiresAt
  const beyondContentExpires = { ...p, contentExpiresAt: '2026-10-22T10:05:00.000Z', expiresAt: '2026-10-22T10:08:00.000Z' };
  await expect(store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: beyondContentExpires }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  // >16 KiB multibyte content
  const hugeAction = { ...p.action!, summary: '界'.repeat(6000) };
  const hugeProposal = { ...p, action: hugeAction };
  await expect(store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: hugeProposal }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  // >20 candidates
  const twentyOneCandidates = Array.from({ length: 21 }, (_, i) => ({
    target: { ...target, calendarId: `cal-${i}@group.calendar.google.com` },
    canonicalActionHash: hash,
  }));
  const tooManyCandidates = { ...p, candidates: twentyOneCandidates, purpose: 'selection' as const, target: null, canonicalActionHash: null };
  await expect(store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: tooManyCandidates }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  // Nonpending incoming state
  const nonpending = { ...p, state: 'consumed' as const };
  await expect(store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: nonpending }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  // Mixed account / target binding (target has different subject)
  const mixedBinding = { ...p, target: { ...target, googleSubjectId: 'other-sub' } };
  await expect(store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: mixedBinding }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('returns the original consumption after racing approvals and restart', async () => {
  const f = await connectedCalendarMemory(); const clock = () => Date.parse('2026-10-22T10:01:00.000Z');
  const a = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  await a.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });
  const reply = acceptedReply();
  const results = await Promise.all([
    a.consume({ reply, operationId: 'op', intentId: 'intent' }),
    a.consume({ reply, operationId: 'losing-operation', intentId: 'intent' }),
  ]);
  const successful = results.filter(r => r.outcome === 'consumed' || r.outcome === 'existing');
  expect(successful).toHaveLength(2);
  expect(new Set(successful.map(r => r.consumption.operationId)).size).toBe(1);
  const b = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  const replay = await b.consume({ reply, operationId: 'third-operation', intentId: 'intent' });
  expect(replay.outcome).toBe('existing');
  if (replay.outcome === 'existing') {
    expect(replay.consumption).toEqual(successful[0].consumption);
    expect(replay.consumption.acceptedMessageId).toBe(reply.acceptedMessageId);
  }
  expect(await b.getCurrent('u', 's')).toBeNull();
});

it('rejects stale, wrong-session, changed-action, changed-condition, expired and cancelled replies', async () => {
  const baseClock = Date.parse('2026-10-22T10:01:00.000Z');
  const cases: Array<{ name: string; replyPatch: Partial<ReturnType<typeof acceptedReply>>; clock?: number; expectedReason: string }> = [
    { name: 'wrong session', replyPatch: { sessionId: 'other-session' }, expectedReason: 'wrong-session' },
    { name: 'changed action hash', replyPatch: { canonicalActionHash: 'b'.repeat(64) }, expectedReason: 'changed-action' },
    { name: 'changed condition fingerprint', replyPatch: { conditionFingerprint: 'b'.repeat(64) }, expectedReason: 'changed-condition' },
    { name: 'wrong connection revision', replyPatch: { connectionRevision: 2 }, expectedReason: 'stale' },
    { name: 'wrong proposal revision', replyPatch: { expectedProposalRevision: 2 }, expectedReason: 'stale' },
    { name: 'expired at exact boundary', replyPatch: { receivedAt: '2026-10-22T10:10:00.000Z' }, clock: Date.parse('2026-10-22T10:10:00.000Z'), expectedReason: 'expired' },
    { name: 'cancelled decision', replyPatch: { decision: 'cancel' }, expectedReason: 'cancelled' },
  ];

  for (const c of cases) {
    const f = await connectedCalendarMemory();
    let currentClock = baseClock;
    const clock = () => currentClock;
    const store = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
    await store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });
    if (c.clock) currentClock = c.clock;
    const reply = { ...acceptedReply(), ...c.replyPatch };
    const res = await store.consume({ reply: reply as never, operationId: 'op', intentId: 'intent' });
    expect(res.outcome, `Case ${c.name} expected rejected`).toBe('rejected');
    if (res.outcome === 'rejected') {
      expect(res.reason, `Case ${c.name}`).toBe(c.expectedReason);
    }
    if (c.expectedReason === 'cancelled') {
      expect([...f.rows('metadata').values()].filter(d => d.kind === 'calendar-proposal-consumption')).toHaveLength(0);
    }
  }
});

it('handles candidate-specific selection and rejects generic accept on selection proposals', async () => {
  const f = await connectedCalendarMemory(); const clock = () => Date.parse('2026-10-22T10:01:00.000Z');
  const store = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  const p = pendingProposal();
  const selection = calendarProposalSchema.parse({
    ...p, purpose: 'selection', target: null, canonicalActionHash: null,
    action: { ...p.action!, calendarId: undefined },
    conditionFingerprint: null, availabilityRevision: null, disclosedLimitations: [],
    candidates: [{ target: p.target, canonicalActionHash: hash }],
  });
  await store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: selection });

  // Negative generic accept on selection proposal rejects
  const genericAccept = { ...acceptedReply(), decision: 'accept' as const, conditionFingerprint: null, choiceCalendarId: null };
  const rejected = await store.consume({ reply: genericAccept, operationId: 'op', intentId: 'intent' });
  expect(rejected.outcome).toBe('rejected');

  // Positive candidate-specific select succeeds
  const candidateSelect = { ...acceptedReply(), decision: 'select' as const, conditionFingerprint: null, choiceCalendarId: p.target!.calendarId };
  const consumed = await store.consume({ reply: candidateSelect, operationId: 'op', intentId: 'intent' });
  expect(consumed.outcome).toBe('consumed');
});

it('keeps selection and conflict approvals on one intent operation', async () => {
  const f = await connectedCalendarMemory(); const clock = () => Date.parse('2026-10-22T10:01:00.000Z');
  const a = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  const p = pendingProposal();
  const selection = calendarProposalSchema.parse({ ...p, purpose: 'selection', target: null,
    canonicalActionHash: null, action: { ...p.action!, calendarId: undefined },
    conditionFingerprint: null, availabilityRevision: null, disclosedLimitations: [],
    candidates: [{ target: p.target, canonicalActionHash: hash }] });
  await a.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: selection });
  const first = await a.consume({ reply: { ...acceptedReply(), decision: 'select',
    conditionFingerprint: null, choiceCalendarId: p.target!.calendarId },
    operationId: 'selected-op', intentId: 'intent' });
  expect(first.outcome).toBe('consumed');
  await a.putCurrent({ expectedProposalId: null, expectedRevision: null,
    proposal: { ...p, proposalId: 'conflict-p' } });
  const second = await a.consume({ reply: { ...acceptedReply(), proposalId: 'conflict-p',
    acceptedMessageId: 'conflict-message', acceptedTurnId: 'conflict-turn' },
    operationId: 'must-not-be-used', intentId: 'intent' });
  expect(second.outcome).toBe('consumed');
  if (second.outcome === 'consumed') {
    expect(second.consumption.operationId).toBe('selected-op');
    expect(second.consumption.acceptedMessageId).toBe('conflict-message');
  }
  expect([...f.rows('metadata').values()].filter(d => d.kind === 'calendar-proposal-consumption'))
    .toHaveLength(2);
});

it('supports proposal tombstones and repairs consumption wrappers', async () => {
  const f = await connectedCalendarMemory(); const clock = () => Date.parse('2026-10-22T10:01:00.000Z');
  const store = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  await store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });
  const consumed = await store.consume({ reply: acceptedReply(), operationId: 'op', intentId: 'intent' });
  expect(consumed.outcome).toBe('consumed');

  // Remove the wrapper to simulate crash between proposal CAS and wrapper write
  const wrapperKey = proposalConsumptionKey('u', 's', 'p');
  f.rows('metadata').delete(wrapperKey);

  // Tombstone confirms and repairs the wrapper
  const tomb = calendarProposalTombstoneSchema.parse({
    schemaVersion: 2, kind: 'calendar-proposal-tombstone',
    userId: 'u', sessionId: 's', proposalId: 'p', intentId: 'intent',
    revision: 3, reason: 'consumed', operationId: 'op', canonicalActionHash: hash,
    at: '2026-10-22T10:02:00.000Z', unresolvedOperation: false,
  });
  expect(await store.tombstone({ expectedRevision: 2, tombstone: tomb })).toBe('confirmed');

  // Wrapper is repaired
  const repaired = f.rows('metadata').get(wrapperKey);
  expect(repaired).toBeDefined();

  // Idempotent retry confirms
  expect(await store.tombstone({ expectedRevision: 2, tombstone: tomb })).toBe('confirmed');

  // Wrong expected revision conflicts
  expect(await store.tombstone({ expectedRevision: 1, tombstone: tomb })).toBe('conflict');
});

it('exposes the expired pending slot while getCurrent keeps hiding expiry', async () => {
  const f = await connectedCalendarMemory();
  const writer = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
  expect((await writer.putCurrent({ expectedProposalId: null, expectedRevision: null,
    proposal: pendingProposal() })).outcome).toBe('confirmed');
  const afterExpiry = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS,
    () => Date.parse('2026-10-22T10:11:00.000Z'));
  expect(await afterExpiry.getCurrent('u', 's')).toBeNull();
  const slot = await afterExpiry.getCurrentSlot('u', 's');
  expect(slot?.proposalId).toBe('p');
  expect(slot?.expiresAt).toBe('2026-10-22T10:10:00.000Z');
});

it('looks up proposal authority as pending, consumed, or absent', async () => {
  const f = await connectedCalendarMemory(); const clock = () => Date.parse('2026-10-22T10:01:00.000Z');
  const store = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  await store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });

  const pending = await store.getAuthority('u', 's', 'p');
  expect(pending.state).toBe('pending');
  if (pending.state === 'pending') expect(pending.proposal.proposalId).toBe('p');

  const reply = acceptedReply();
  expect((await store.consume({ reply, operationId: 'op', intentId: 'intent' })).outcome).toBe('consumed');

  const authority = await store.getAuthority('u', 's', 'p');
  expect(authority.state).toBe('consumed');
  if (authority.state === 'consumed') {
    expect(authority.proposal?.state).toBe('consumed');
    expect(authority.reply.acceptedMessageId).toBe(reply.acceptedMessageId);
    expect(authority.consumption.operationId).toBe('op');
    expect(authority.authorityExpiresAt).toBe('2026-10-22T10:10:00.000Z');
  }

  // Crash window: the wrapper is lost but the proposal keeps its persisted approval.
  f.rows('metadata').delete(proposalConsumptionKey('u', 's', 'p'));
  const recovered = await store.getAuthority('u', 's', 'p');
  expect(recovered.state).toBe('consumed');
  if (recovered.state === 'consumed') {
    expect(recovered.reply.acceptedMessageId).toBe(reply.acceptedMessageId);
    expect(recovered.consumption.operationId).toBe('op');
  }

  expect((await store.getAuthority('u', 's', 'unknown-proposal')).state).toBe('absent');
});

it('reports a tombstone for a tombstoned proposal', async () => {
  const f = await connectedCalendarMemory(); const clock = () => Date.parse('2026-10-22T10:01:00.000Z');
  const store = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  await store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });
  const tomb = calendarProposalTombstoneSchema.parse({
    schemaVersion: 2, kind: 'calendar-proposal-tombstone',
    userId: 'u', sessionId: 's', proposalId: 'p', intentId: 'intent',
    revision: 2, reason: 'expired', operationId: null, canonicalActionHash: hash,
    at: '2026-10-22T10:02:00.000Z', unresolvedOperation: false,
  });
  expect(await store.tombstone({ expectedRevision: 1, tombstone: tomb })).toBe('confirmed');
  const authority = await store.getAuthority('u', 's', 'p');
  expect(authority.state).toBe('tombstone');
  if (authority.state === 'tombstone') {
    expect(authority.tombstone.proposalId).toBe('p');
    expect(authority.tombstone.reason).toBe('expired');
  }
  expect(await store.getCurrentSlot('u', 's')).toBeNull();
});

it('scopes the current slot and authority lookup to one user and session', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
  await store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });
  expect(await store.getCurrentSlot('u', 'other-session')).toBeNull();
  expect(await store.getCurrentSlot('other-user', 's')).toBeNull();
  expect((await store.getAuthority('u', 'other-session', 'p')).state).toBe('absent');
  expect((await store.getAuthority('other-user', 's', 'p')).state).toBe('absent');
});

it('detects multiple pending proposals in one session', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
  await store.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });
  const secondId = proposalKey('u', 's', 'p2');
  f.rows('metadata').set(secondId, { ...pendingProposal(), proposalId: 'p2', intentId: 'intent2',
    _id: secondId, _revision: 0 });
  await expect(store.getCurrentSlot('u', 's')).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  await expect(store.getCurrent('u', 's')).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
});

it('stores an incomplete-details proposal and refuses to consume it', async () => {
  const f = await connectedCalendarMemory(); const clock = () => Date.parse('2026-10-22T10:01:00.000Z');
  const store = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  const p = pendingProposal();
  const incomplete = calendarProposalSchema.parse({ ...p, purpose: 'details', action: null,
    canonicalActionHash: null, conditionFingerprint: null, availabilityRevision: null,
    incomplete: { missing: ['start', 'end'], messageRefs: ['m1', 'm2'] } });
  expect((await store.putCurrent({ expectedProposalId: null, expectedRevision: null,
    proposal: incomplete })).outcome).toBe('confirmed');

  const stored = await store.getCurrent('u', 's');
  expect(stored?.incomplete).toEqual({ missing: ['start', 'end'], messageRefs: ['m1', 'm2'] });
  expect(stored?.canonicalActionHash).toBeNull();

  // Consumption is refused until a complete action/target proposal replaces it.
  const refused = await store.consume({ reply: acceptedReply(), operationId: 'op', intentId: 'intent' });
  expect(refused.outcome).toBe('rejected');
  if (refused.outcome === 'rejected') expect(refused.reason).toBe('incomplete');
  expect([...f.rows('metadata').values()].filter(d => d.kind === 'calendar-proposal-consumption')).toHaveLength(0);
  expect((await store.getCurrent('u', 's'))?.state).toBe('pending');

  // A complete proposal replaces it and is consumable again.
  expect((await store.putCurrent({ expectedProposalId: 'p', expectedRevision: 1,
    proposal: { ...p, proposalId: 'p2', intentId: 'intent2' } })).outcome).toBe('confirmed');
  const consumed = await store.consume({ reply: { ...acceptedReply(), proposalId: 'p2' },
    operationId: 'op', intentId: 'intent2' });
  expect(consumed.outcome).toBe('consumed');
});

it('binds the untrusted reply reference to one accepted attempt', async () => {
  const f = await connectedCalendarMemory(); const clock = () => Date.parse('2026-10-22T10:01:00.000Z');
  const store = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  const reference = { proposalId: 'p', revision: 1 };

  expect(await store.getReplyReference('u', 's', 'attempt-1')).toBeNull();
  expect(await store.bindReplyReference({ userId: 'u', sessionId: 's', turnId: 'turn-1',
    attemptId: 'attempt-1', replyTo: reference })).toBe('confirmed');
  expect(await store.getReplyReference('u', 's', 'attempt-1')).toEqual(reference);
  expect([...f.rows('metadata').values()].filter(d => d.kind === 'calendar-reply-binding')).toHaveLength(1);

  // The same attempt and reference rebind idempotently.
  expect(await store.bindReplyReference({ userId: 'u', sessionId: 's', turnId: 'turn-1',
    attemptId: 'attempt-1', replyTo: reference })).toBe('confirmed');
  // A different reference for the same attempt conflicts.
  expect(await store.bindReplyReference({ userId: 'u', sessionId: 's', turnId: 'turn-1',
    attemptId: 'attempt-1', replyTo: { proposalId: 'other', revision: 2 } })).toBe('conflict');
  // The binding is scoped to one attempt, session, and user.
  expect(await store.getReplyReference('u', 's', 'attempt-2')).toBeNull();
  expect(await store.getReplyReference('other-user', 's', 'attempt-1')).toBeNull();
  expect(await store.getReplyReference('u', 'other-session', 'attempt-1')).toBeNull();
});
