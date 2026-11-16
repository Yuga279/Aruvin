/**
 * ============================================================================
 * FILE: owner-config.spec.ts
 * LOCATION: backend/test/auth/integration/owner-config.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify three-owner runtime isolation and shared config snapshots.
 * ROLE IN PROJECT:
 *    Exercises the real durable runtime using existing provider fixtures.
 *    Separates runtime binding evidence from HTTP authorization evidence.
 * KEY COMPONENTS:
 *    - Private transcripts, captured attribution and shared snapshot checks.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import type { ResolvedIdentity } from '../../../src/contracts/identity.js';
import type { SubmitTurnResponse } from '../../../src/contracts/api.js';
import { textConfigFixture } from '../../runtime/text-config-fixture.js';
import { textSnapshot } from '../../model/config-snapshot.js';

const identity = (userId: string): ResolvedIdentity => ({ userId,
  openRouterUser: userId, source: 'authenticated-session' });
type Fixture = ReturnType<typeof textConfigFixture>;
function submit(f: Fixture, userId: string, content: string, idempotencyKey: string) {
  return f.runtime.submitTurn({ identity: identity(userId), sessionId: null, content, idempotencyKey });
}
function execute(f: Fixture, userId: string, ids: SubmitTurnResponse) {
  return f.runtime.executeTurn({ userId, ...ids, signal: new AbortController().signal,
    emit: async () => undefined });
}

it('isolates three transcripts and attributes accepted work after another owner runs', async () => {
  const f = textConfigFixture(textSnapshot(1));
  try {
    const owners = ['admin', 'a', 'b'];
    const turns = await Promise.all(owners.map(u => submit(f, u, `[owner:${u}]`, 'same-request-key')));
    await execute(f, 'b', turns[2]!);
    await execute(f, 'a', turns[1]!);
    await execute(f, 'admin', turns[0]!);
    expect(f.fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)).user)).toEqual(['b', 'a', 'admin']);
    for (const [index, owner] of owners.entries()) {
      const own = turns[index]!;
      const messages = await f.p.messages.list(owner, own.sessionId, { cursor: null, limit: 50 });
      const text = JSON.stringify(messages.items);
      expect(text).toContain(`[owner:${owner}]`);
      for (const other of owners.filter(u => u !== owner)) {
        expect(text).not.toContain(`[owner:${other}]`);
        expect(await f.p.sessions.get(other, own.sessionId)).toBeNull();
      }
    }
  } finally { await f.dispose(); }
});

it('shares published settings for new work while every accepted owner retains its snapshot', async () => {
  const f = textConfigFixture(textSnapshot(1, { maxOutputTokens: 2048 }, 'fixture/old', 'fixture-A'));
  try {
    const a = await submit(f, 'a', 'first-a', 'first-request-a');
    const b = await submit(f, 'b', 'first-b', 'first-request-b');
    f.publish(textSnapshot(2, { maxOutputTokens: 512 }, 'fixture/new', 'fixture-B'));
    await execute(f, 'a', a); await execute(f, 'b', b);
    await execute(f, 'a', await submit(f, 'a', 'second-a', 'second-request-a'));
    await execute(f, 'b', await submit(f, 'b', 'second-b', 'second-request-b'));
    const requests = f.fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)));
    expect(requests.map(r => r.model)).toEqual(['fixture/old', 'fixture/old', 'fixture/new', 'fixture/new']);
    expect(requests.map(r => r.max_tokens)).toEqual([2048, 2048, 512, 512]);
    expect(requests.map(r => r.user)).toEqual(['a', 'b', 'a', 'b']);
  } finally { await f.dispose(); }
});
