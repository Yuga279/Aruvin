/**
 * ============================================================================
 * FILE: fixtures.ts
 * LOCATION: backend/test/http/fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Supply typed fake HTTP ports and known application stream envelopes.
 *
 * ROLE IN PROJECT:
 *    Lets P6 unit and route tests inject ChatHttpOptions without constructing
 *    a runtime or claiming a fake provider guarantee.
 *
 * KEY COMPONENTS:
 *    - fixtureOptions: Identity, repositories, and runtime command fakes.
 *    - envelope / deferred: Version-1 frames and controllable promises.
 * ============================================================================
 */

import type { ChatHttpOptions } from '../../src/http/options.js';
import type { StreamEnvelope } from '../../src/contracts/stream.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { RequestIdentityStore } from '../../src/platform/identity/request-identity-store.js';
import { principal } from '../assembly/auth-principal-fixture.js';
import { session } from '../persistence/fixtures.js';
export const ids = { sessionId:'s1', turnId:'t1', attemptId:'a1', userMessageId:'m0',
  streamPath:'/sessions/s1/turns/t1/stream' };
export const submission = { sessionId:null, content:'Hello', idempotencyKey:'request-0001' };
export function envelope(sequence: number, event: StreamEnvelope['event']): StreamEnvelope {
  return { protocolVersion:1, sessionId:'s1', turnId:'t1', attemptId:'a1', sequence, event };
}
export function fixtureOptions(): ChatHttpOptions {
  return {
    budgets: { ...DEFAULT_BUDGETS },
    identity: { resolve: () => principal('server-user').identity,
      assertNoClientOverrides: new ServerIdentityResolver(new RequestIdentityStore()).assertNoClientOverrides },
    principal: () => principal('server-user'),
    sessions: { get:vi.fn(async () => session('server-user','s1')),
      list:vi.fn(async () => ({ items:[], nextCursor:null })), createIfAbsent:vi.fn(async r => r),
      touchActivity:vi.fn(async () => undefined), update:vi.fn(async () => undefined), delete:vi.fn(async () => undefined) },
    messages: { append:vi.fn(async () => undefined), list:vi.fn(async () => ({ items:[], nextCursor:null, olderAvailable:false })),
      get:vi.fn(async () => null), updateCompletion:vi.fn(async () => undefined) },
    runtime: { submitTurn:vi.fn(async () => ids), retryTurn:vi.fn(async () => ({ ...ids, attemptId:'a2' })),
      cancelTurn:vi.fn(async () => undefined), getTurnStatus:vi.fn(async () => ({ sessionId:'s1', turnId:'t1',
        attemptId:'a1', status:'accepted' as const, truncated:false, error:null })), reconcileSession:vi.fn(async () => undefined),
      executeTurn:vi.fn(async c => {
        await c.emit(envelope(0, { type:'turn-accepted', userMessageId:'m0' }));
        await c.emit(envelope(1, { type:'status', status:'generating', truncated:false }));
        await c.emit(envelope(2, { type:'delta', text:'Hello' }));
        await c.emit(envelope(3, { type:'status', status:'finalizing', truncated:false }));
        await c.emit(envelope(4, { type:'status', status:'completed', truncated:false }));
        await c.emit(envelope(5, { type:'completed', assistantMessageId:'m2', outcome:'completed' }));
      }),
      reserveStream:vi.fn((userId, sessionId, signal) => ({
        userId, sessionId, signal,
        run: async <T>(work: () => Promise<T>) => work(),
        release: vi.fn(),
      })),
      quiesceStreams:vi.fn(async () => ({ drained:true, active:0, unresolvedWrites:0, fenced:true as const })),
      releaseStreamFence:vi.fn(),
      stopAccepting:vi.fn(), snapshot:vi.fn(() => ({ accepting:true, active:0, unresolvedWrites:0, degraded:false })),
      drain:vi.fn(async () => ({ drained:true, active:0, unresolvedWrites:0 })), allowStoppedOwner:vi.fn(),
      rebaseSession:vi.fn(async () => undefined) },
  };
}
export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
