/**
 * ============================================================================
 * FILE: calendar-voice-authority.spec.ts
 * LOCATION: backend/test/runtime/calendar-voice-authority.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove synthetic and spoken voice turns share one proposal authority.
 *
 * ROLE IN PROJECT:
 *    Exercises stale/expired references, duplicate acceptance and race
 *    exclusion through the existing runtime in both memory and durable modes.
 *
 * KEY COMPONENTS:
 *    - Stale and expired references: No write, truthful narration.
 *    - Voice/button race: One accepted write; replay never infers again.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { calendarLiveFixture } from './calendar-live.fixture.js';
import { loadWire, createWire } from './calendar-runtime.fixture.js';
import { event } from './calendar-multi-fixture.js';

it.each(['memory', 'durable'] as const)('%s voice rejects a stale revision and expired current proposal', async mode => {
  const f = await calendarLiveFixture(mode);
  try {
    f.h.modelWires.push(loadWire('calendar_create_event'), createWire(event()));
    const first = await f.submit('create the event'); await f.execute(first);
    const p = (await f.h.currentProposal(first.sessionId))!;
    const stale = await f.submit('yes', { proposalId: p.proposalId, revision: p.revision + 1 });
    await f.execute(stale);
    expect(f.h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    expect(await f.h.currentProposal(first.sessionId)).toMatchObject({ proposalId: p.proposalId, state: 'pending' });
    f.h.advance(600001);
    const expired = await f.submit('yes', { proposalId: p.proposalId, revision: p.revision });
    await f.execute(expired);
    expect(f.h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    expect(f.spoken.join('')).toContain('expired');
  } finally { await f.dispose(); }
});

it.each(['memory', 'durable'] as const)('%s voice/button race produces one accepted write and replay never infers again', async mode => {
  const f = await calendarLiveFixture(mode);
  try {
    f.h.modelWires.push(loadWire('calendar_create_event'), createWire(event()));
    const first = await f.submit('create the event'); await f.execute(first);
    const p = (await f.h.currentProposal(first.sessionId))!;
    const attempts = await Promise.allSettled([
      f.submit('yes', { proposalId: p.proposalId, revision: p.revision }), // button-shaped accepted reference
      f.submit('yes'), // independent finalized speech
    ]);
    const accepted = attempts.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof f.submit>>> => r.status === 'fulfilled');
    expect(accepted).toHaveLength(1);
    expect(attempts.filter(r => r.status === 'rejected')).toHaveLength(1);
    const ids = accepted[0].value;
    await f.execute(ids);
    const requests = f.h.modelBodies.length;
    await f.execute(ids); // completed live turn reattachment must not speak/infer/write
    expect(f.h.modelBodies).toHaveLength(requests);
    expect(f.h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    expect(await f.h.operationFor(ids)).toMatchObject({ state: 'succeeded', intentId: p.intentId,
      authorization: { proposalId: p.proposalId } });
  } finally { await f.dispose(); }
});
