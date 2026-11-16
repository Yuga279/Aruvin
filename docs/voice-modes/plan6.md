# Shared Agent Execution and Speech Delivery (P6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Submit finalized live speech through Aurvin's existing durable agent, exclude competing text execution, and reconcile interrupted delivery without replaying inference or exposing internal turns.

**Architecture:** The existing `DurableChatRuntime` owns one process-local reservation coordinator and all MongoDB execution leases. Normalize live assistant output into bounded prose before adding it to the saved result; stream that same prose to P5's existing Flux flow, and persist generated-versus-heard evidence through a lease-bound writer. Preserve the stock reference-based graph and recover sealed results using existing publication, never a second runtime or rewriting model.

**Tech Stack:** TypeScript/NodeNext with `.js` imports, existing NestJS HTTP, LangGraph, MongoDB repositories, P1 voice ports, P3 Flux adapters, P5 `LiveFlow`, and Vitest. No new packages.

---

## Execution gates, ownership, and reading order

- Read [goal.md](goal.md), [research.md](research.md), [state.md](state.md), and [plan2.md](plan2.md), [plan3.md](plan3.md), [plan5.md](plan5.md). Approved scoped decisions supersede authentication/tool assumptions and stale approval labels in the reproduced PRD. Review is **skipped**, not passed.
- P2 `3c9d638..f9d13f8` and P3 `9bac624..d43eabf` are implemented. P5's plan is `885548f`; its worker advanced through `d20b7ea` during planning. The current `LiveFlow` still lacks the prepared-response handoff below. **Do not start the P6 worker until P5 reports verified commits and these handoffs are reconciled.** A committed plan is not a completed worker prerequisite.
- Run `git status --short` before editing. User work overlaps `backend/src/http/chat-http.service.ts`, `chat-http.controller.ts`, `backend/test/http/fixtures.ts`, and `routes.e2e-spec.ts`. Obtain a reconciled baseline/ownership clearance before changing or staging `chat-http.service.ts`. This plan does not edit those other overlapping files. Never stage user changes or a whole directory.
- Work only under `backend/src/voice/agent/**`, `backend/test/voice/agent/**`, `backend/src/chat-runtime/**`, `backend/test/runtime/**`, `backend/src/agent/**`, `backend/src/http/**`, and `backend/test/http/**`. P1 owns contracts/configuration/manifests; P2 owns persistence/context; P3 owns providers; P5 owns sessions/gateway; P10 owns composition. No independently changed shared schemas, dependencies, or central wiring.
- Use the locally available `executing-plans` and `test-driven-development` skills; the header's upstream `superpowers:` names do not require unavailable literal skill IDs. This assigned worker does not dispatch another agent.
- Add the root-required code-file header when writing implementation/test files, and update existing headers when more than 30% changes. **There are deliberately no code doc headers in this Markdown plan.**
- Each checkbox is one short action. Implement the named function/method edits individually, rather than treating an entire task's code as one action. Run a focused red/green cycle for each assertion group before moving to the next group.
- All npm commands run in `backend`; Git commands run at repository root. Do not read application `.env`, log credentials/URIs, provision infrastructure, or call paid providers. Native checks need operator-supplied `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; the existing fixture creates/drops isolated databases. Missing prerequisites mean **blocked**, not passed or the intended TDD failure.

## File map before implementation

| Action | Exact path | Responsibility |
| --- | --- | --- |
| Create | `backend/src/chat-runtime/execution-reservations.ts` | P1 reservation implementation; synchronous mode gate plus durable busy probe |
| Modify | `backend/src/chat-runtime/durable-chat-runtime.ts` | Shared coordinator, internal acceptance, live normalization, lease-bound delivery, public/internal turn separation |
| Modify | `backend/src/chat-runtime/ports.ts` | Runtime-local live execution/writer types; no P1 interface change |
| Modify | `backend/src/chat-runtime/history.ts` | Original internal-history paging and terminal live eligibility |
| Modify | `backend/src/chat-runtime/reconciliation.ts` | Internal partial records and pending-delivery recovery |
| Modify | `backend/src/chat-runtime/finalization.ts` | Verify saved assistant mode/visibility against original input |
| Modify | `backend/src/http/options.ts` | Optional structural early guard, supplied by P10 with the runtime's same coordinator |
| Modify after clearance | `backend/src/http/chat-http.service.ts` | Early text submit/retry mode checks; preserve session actions |
| Create | `backend/src/voice/agent/agent-voice-adapter.ts` | Finalized-input identity, first conversation binding, P5 callbacks and runtime execution |
| Create | `backend/src/voice/agent/speech-prose.ts` | Bounded incremental prose normalization; no reasoning/code/JSON/table speech |
| Create | `backend/src/voice/agent/voice-delivery.ts` | Serialized delivery snapshots, playback proof, interruption/unknown evidence |
| Create | `backend/test/runtime/execution-reservations.spec.ts` | Reservation races, identity, release and bind behavior |
| Create | `backend/test/runtime/voice-runtime-harness.ts` | Existing isolated native harness with P2 delivery-aware context |
| Create | `backend/test/runtime/voice-acceptance.native.e2e-spec.ts` | Durable internal acceptance and neutral first-turn title |
| Create | `backend/test/runtime/voice-history.spec.ts` | Raw paging and terminal live history regression |
| Create | `backend/test/runtime/voice-recovery.native.e2e-spec.ts` | Checkpoint/publication failures and delivery recovery without inference |
| Create | `backend/test/http/voice-exclusion.spec.ts` | HTTP early guards without altering existing user fixtures |
| Create | `backend/test/voice/agent/submission.spec.ts` | Stable finalized-turn keys, empty input, binding and idempotency |
| Create | `backend/test/voice/agent/speech-prose.spec.ts` | Split-token filtering and factual-value preservation |
| Create | `backend/test/voice/agent/voice-delivery.spec.ts` | Generated/played separation, event ordering, reconciliation and timeout |
| Create | `backend/test/voice/agent/bridge.native.e2e-spec.ts` | Real runtime/repositories/checkpoints/HTTP and P5 flow with deterministic speech |

Read, but do not change: `backend/src/model/openrouter-adapter.ts`, `backend/src/agent/{state,turn-graph}.ts`, P2 repositories/context, P3 providers, P5 flow/options/service, existing HTTP/native fixtures. The model adapter already ignores `delta.reasoning` and rejects `tool_calls`/`function_call`; do not add tools or a second provider parser. LangGraph uses replace-value channels, not a messages reducer.

## Required P5 handoff before the worker starts

The supplied P5 plan registers a response only on the first `speak`. That misses barge-in while the agent is thinking and gives P6 no response-relative playback origin. Ask P5's owner for the following **serialized P5 follow-up**; P6 must not edit P5-owned source:

1. Expose `prepareResponse(ref: { turnId: string; responseId: string }): { providerBaseSamples: number }` on `LiveFlow`. Reuse its existing response registry/one-current-response check. Register the response before inference, without sending TTS text or `audio.start`; return the existing `r.base` (provider cursor, not wire cursor). Track whether any `Speak` was dispatched. `speak` uses the prepared entry.
2. `StartOfTurn` must call the existing interrupt path for that prepared thinking response, even before `SpeechStarted`. Invalidate immediately, call `hooks.interrupt` before waiting on persistence, and do not send a provider Interrupt when no Speak was dispatched. Clear `current` in that case. Duplicate interruption remains a no-op.
3. Keep one STT epoch namespace across reconnect **and mute/unmute**. The `providerSocketEpoch` handed to `finalized` must change when the STT socket changes, not only when the browser connection changes. Do not deduplicate a fresh STT socket's turn `0` against the old socket's turn `0`.
4. Preserve P3's socket-wide offset translation inside P5. `hooks.playback` supplies the provider-coordinate cumulative sample position; P6 subtracts `providerBaseSamples`. P6 never calls Flux Interrupt or constructs a wire-to-provider offset itself.
5. A playback interrupt can contain newer progress than the last periodic report. Deliver that sample evidence before/alongside `hooks.interrupt`, but make generation invalidation synchronous; slow delivery persistence must not delay abort. After `SpeechMetadata`, an interrupt still invalidates queued audio but cannot invent `textSpoken`: P6 records unknown unless independent exact reconciliation exists.
6. P5 cleanup must await `hooks.disconnected` before releasing the live reservation. Do not wait for `finalChain` from inside its own `finalized` callback. P6's cleanup waits for the execution promise; P5's TTS consumer must remain able to deliver interruption evidence while that promise settles.

These are lifecycle integration gaps, not a request to reinstate review. Report them and require P5's tested interface summary before dispatching the P6 worker. Public P1 wire schemas remain unchanged. P10 later wires one `runtime.reservations` into both voice admission and HTTP; no production fallback reservation/no-op bridge is permitted.

## Semantic decisions used by every task

1. Live ownership lasts for the whole live session, including idle/listening/reconnect, not just one inference. Dictation never calls the reservation coordinator or agent. Durable native ownership still fences all mutations; the process-local coordinator does not claim multi-instance exclusion.
2. First accepted live input creates a neutral `Voice Conversation`; opening the voice surface does not create a database session. Bind a deterministic conversation ID before runtime acceptance so another text request cannot race creation. Binding alone is not transcript persistence.
3. A live generated assistant record is the **normalized user-facing prose generated for speech**, not raw Markdown/code/reasoning. Store exactly that prose in the immutable saved result and `VoiceDeliveryRecord.textGenerated`. P2 requires equality with assistant content and a spoken prefix; filtering only after saving raw Markdown would break those contracts. Text turns preserve their current bytes/behavior. Keep factual names, IDs, numbers, dates and negations; structured/unsupported output is withheld, not rewritten by another LLM.
4. Persist accepted internal input/attempt/marker before inference. Persist a pending delivery record before forwarding any prose to synthesis. Provider finish is not durable completion; synthesis finish is not played completion. Only exact final sample acknowledgment plus confirmed synthesis and unchanged response can establish full heard text.
5. Delivery mutations run through the **same acquired runtime lease**, `p.owner.run`, and `Work.wait`. Hold that lease through bounded delivery settlement; never reacquire an unrelated lease in a provider callback or write after release. Callbacks enqueue mutations instead of blocking generation on the TTS reader.
6. Playback samples are per-response in metadata. Browser/wire progress and Flux Interrupt offsets remain socket-wide upstream. Never advance offsets artificially, reset on every turn, derive text from a time fraction, or replay old audio on reconnect.
7. Keep `pending` until generation's archive content is fixed. Reconciliation events can arrive before model cancellation settles; stage their text evidence and terminalize after the final generated prefix is known. Recompute `textRemaining` from the final generated prose after validating the provider's split against the actual submitted synthesis text.
8. Cancellation before a sealed result preserves an internal terminal partial; cancellation after sealing preserves the completed saved result. Delivery can independently be interrupted/unknown. Wait for old execution and delivery to settle before accepting the next finalized turn.
9. Text status, cancel, retry and SSE routes must reject internal voice turns with `NOT_FOUND` even when their IDs are known. Public session summaries/messages are allowlisted/P2-filtered; no generated text, internal message IDs or hidden error details escape via text status/SSE. Existing visible text status polling remains usable while live owns the session.
10. Recovery only reads saved graph state, publishes/rebases/reconciles records, and marks missing playback proof unknown. Never `invoke(null)`, generate again, synthesize old text, rewrite checkpoint content, or clear another executor's sentinel.

### Task 1: Execution Reservation & Mode Exclusion

**Files:** Create `execution-reservations.ts`, `execution-reservations.spec.ts`, `voice-exclusion.spec.ts`; modify runtime constructor/entry guards, `http/options.ts`, and cleared `chat-http.service.ts`.

#### 1A. Atomic process-local ownership and durable busy checks

- [ ] **Write the failing tests** in `backend/test/runtime/execution-reservations.spec.ts`:

```typescript
import { expect, it, vi } from 'vitest';
import { ExecutionReservations } from '../../src/chat-runtime/execution-reservations.js';
const identity = { userId: 'u1', openRouterUser: 'u1', source: 'server-configured' as const };
const live = (voiceSessionId = 'v1', conversationId: string | null = 's1') => ({
  identity, conversationId, owner: { kind: 'live' as const, voiceSessionId },
});
it('claims synchronously before a durable probe and excludes text across tabs', async () => {
  let finish!: (busy: boolean) => void;
  const busy = vi.fn(async () => false);
  busy.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const r = new ExecutionReservations(identity.userId, busy);
  const first = r.acquire(live());
  expect(() => r.assertText('u1', 's1')).toThrow('Another turn is active.');
  await expect(r.acquire(live('v2'))).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  finish(false); const held = await first;
  r.assertLive(held, identity, 's1');
  await r.release({ identity, reservationId: held.reservationId });
  r.assertText('u1', 's1');
});
it('rolls back failed admission and rejects an already accepted or generating text turn', async () => {
  const busy = vi.fn(async () => true), r = new ExecutionReservations('u1', busy);
  await expect(r.acquire(live())).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  r.assertText('u1', 's1'); busy.mockResolvedValue(false);
  const held = await r.acquire(live());
  busy.mockResolvedValue(true);
  await expect(r.release({ identity, reservationId: held.reservationId }))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  expect(() => r.assertText('u1', 's1')).toThrow();
  busy.mockResolvedValue(false); await r.release({ identity, reservationId: held.reservationId });
});
it('binds unsaved chats atomically without blocking unrelated chats', async () => {
  const r = new ExecutionReservations('u1', async () => false);
  const a = await r.acquire(live('v1', null)), b = await r.acquire(live('v2', null));
  const bound = await r.bindConversation({ identity, reservationId: a.reservationId, conversationId: 's1' });
  r.assertLive(bound, identity, 's1'); r.assertText('u1', 's2');
  await expect(r.bindConversation({ identity, reservationId: b.reservationId, conversationId: 's1' }))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  await expect(r.bindConversation({ identity, reservationId: a.reservationId, conversationId: 's2' }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await r.release({ identity, reservationId: a.reservationId });
  await r.release({ identity, reservationId: a.reservationId });
  r.assertText('u1', 's1');
});
it('does not trust another identity or a caller-forged reservation', async () => {
  const r = new ExecutionReservations('u1', async () => false), held = await r.acquire(live());
  const foreign = { ...identity, userId: 'u2', openRouterUser: 'u2' };
  await expect(r.release({ identity: foreign, reservationId: held.reservationId }))
    .rejects.toMatchObject({ code: 'IDENTITY_OVERRIDE_REJECTED' });
  expect(() => r.assertLive({ ...held, owner: { kind: 'live', voiceSessionId: 'forged' } }, identity, 's1')).toThrow();
  expect(() => r.assertLive({ ...held, reservationId: 'missing' }, identity, 's1')).toThrow();
});
```

- [ ] **Run RED:** `npm test -- test/runtime/execution-reservations.spec.ts`. Initially expect missing implementation; thereafter use each test name with `-t`. Do not count skipped discovery as red.
- [ ] **Implement the coordinator** in `backend/src/chat-runtime/execution-reservations.ts`, one method at a time:

```typescript
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ResolvedIdentity } from '../contracts/identity.js';
import { resolvedIdentitySchema } from '../contracts/identity.js';
import { idSchema } from '../contracts/identifiers.js';
import type { ExecutionReservation, ExecutionReservationPort } from '../contracts/voice.js';
import { AppError } from '../platform/errors/app-error.js';
export class ExecutionReservations implements ExecutionReservationPort {
  private entries = new Map<string, ExecutionReservation>();
  private slots = new Map<string, string>();
  private binding = new Set<string>();
  constructor(private readonly userId: string, private readonly busy: (u: string, s: string) => Promise<boolean>) {}
  private scope(u: string, s: string) { return JSON.stringify([u, s]); }
  private identity(id: ResolvedIdentity) {
    const value = resolvedIdentitySchema.parse(id);
    if (value.userId !== this.userId || value.openRouterUser !== this.userId)
      throw new AppError('IDENTITY_OVERRIDE_REJECTED', 'Identity is resolved by the server.');
    return value;
  }
  private conflict(): never { throw new AppError('CONFLICT_ACTIVE_TURN', 'Another turn is active.'); }
  assertText(u: string, s: string) {
    if (u !== this.userId) throw new AppError('IDENTITY_OVERRIDE_REJECTED', 'Identity is resolved by the server.');
    if (this.slots.has(this.scope(u, s))) this.conflict();
  }
  assertLive(value: ExecutionReservation, identity: ResolvedIdentity, s: string) {
    const id = this.identity(identity), current = this.entries.get(value.reservationId);
    if (!current || !isDeepStrictEqual(current, value) || current.userId !== id.userId ||
      current.owner.kind !== 'live' || current.conversationId !== s ||
      this.slots.get(this.scope(id.userId, s)) !== current.reservationId) this.conflict();
  }
  async acquire(c: Parameters<ExecutionReservationPort['acquire']>[0]) {
    const id = this.identity(c.identity);
    if (c.conversationId !== null) idSchema.parse(c.conversationId);
    idSchema.parse(c.owner.kind === 'live' ? c.owner.voiceSessionId : c.owner.attemptId);
    if (this.entries.size >= 1024) throw new AppError('CONCURRENCY_LIMIT', 'Too many reservations.');
    const r: ExecutionReservation = { reservationId: randomUUID(), userId: id.userId,
      conversationId: c.conversationId, owner: { ...c.owner } };
    const slot = r.conversationId === null ? null : this.scope(r.userId, r.conversationId);
    if (slot && this.slots.has(slot)) this.conflict();
    this.entries.set(r.reservationId, r); if (slot) this.slots.set(slot, r.reservationId);
    try {
      if (r.conversationId !== null && await this.busy(r.userId, r.conversationId)) this.conflict();
      return structuredClone(r);
    } catch (error) {
      this.entries.delete(r.reservationId);
      if (slot && this.slots.get(slot) === r.reservationId) this.slots.delete(slot);
      throw error;
    }
  }
  async bindConversation(c: Parameters<ExecutionReservationPort['bindConversation']>[0]) {
    const id = this.identity(c.identity); idSchema.parse(c.conversationId);
    const old = this.entries.get(c.reservationId);
    if (!old || old.userId !== id.userId) this.conflict();
    if (this.binding.has(old.reservationId)) this.conflict();
    if (old.conversationId === c.conversationId) return structuredClone(old);
    if (old.conversationId !== null) throw new AppError('INVALID_REQUEST', 'Conversation binding cannot change.');
    const slot = this.scope(id.userId, c.conversationId);
    if (this.slots.has(slot)) this.conflict();
    this.slots.set(slot, old.reservationId); this.binding.add(old.reservationId);
    try {
      if (await this.busy(id.userId, c.conversationId)) this.conflict();
      const next = { ...old, conversationId: c.conversationId };
      this.entries.set(old.reservationId, next); return structuredClone(next);
    } catch (error) { if (this.slots.get(slot) === old.reservationId) this.slots.delete(slot); throw error; }
    finally { this.binding.delete(old.reservationId); }
  }
  async release(c: Parameters<ExecutionReservationPort['release']>[0]) {
    const id = this.identity(c.identity), old = this.entries.get(c.reservationId);
    if (!old) return;
    if (this.binding.has(old.reservationId)) this.conflict();
    if (old.userId !== id.userId) this.conflict();
    if (old.conversationId !== null && await this.busy(id.userId, old.conversationId)) this.conflict();
    if (this.entries.get(old.reservationId) !== old) this.conflict();
    this.entries.delete(old.reservationId);
    if (old.conversationId !== null) this.slots.delete(this.scope(old.userId, old.conversationId));
  }
}
```

The 1024 ceiling matches P5's finite registry ceiling; do not evict live evidence. The bind-in-flight guard prevents a concurrent release from resurrecting a released reservation after its database probe. The port's text owner form is supported, but runtime text execution remains fenced by its existing `WorkRegistry` and durable attempt slot; there is no second text ownership lifetime to keep in sync.

- [ ] **Integrate the single coordinator in `durable-chat-runtime.ts`.** Import `ExecutionReservations`, add `readonly reservations: ExecutionReservations`, and initialize after `work`:

```typescript
this.reservations = new ExecutionReservations(d.config.identity.userId, async (u, s) => {
  if (this.work.get(u, s)) return true;
  const session = await d.persistence.sessions.get(u, s);
  return Boolean(this.work.get(u, s) || session?.execution.ownerId || session?.execution.activeAttemptId);
});
```

Add `this.reservations.assertText(identity.userId, session)` in `submitTurn` immediately after deriving `session`, and `assertText(identity.userId, c.sessionId)` in `retryTurn` before `joinAcceptance`. Also check immediately before each text `work.open` in `acceptNewTurn`, `acceptRetry`, and `executeTurn`; asynchronous reads can yield to a live acquire. These synchronous checks and `work.open` must have **no intervening await**. Task 2 replaces only the live-aware checks with `assertLive` when a verified internal capability is supplied.

- [ ] **Run GREEN:** `npm test -- test/runtime/execution-reservations.spec.ts`; expect 4 tests passing. Then `npm test -- test/runtime/work.spec.ts test/runtime/local-reconciliation.spec.ts` and `npm run build`.

#### 1B. Early HTTP conflict, backed by the runtime guard

- [ ] **Write `backend/test/http/voice-exclusion.spec.ts`:**

```typescript
import { expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { ExecutionReservations } from '../../src/chat-runtime/execution-reservations.js';
import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { fixtureOptions } from './fixtures.js';
import { httpHarness } from './http-harness.js';
it('returns 409 for text submit and retry while another tab owns live voice', async () => {
  const o = fixtureOptions(), identity = o.identity.resolve();
  const reservations = new ExecutionReservations(identity.userId, async () => false);
  const held = await reservations.acquire({ identity, conversationId: 's1',
    owner: { kind: 'live', voiceSessionId: 'v1' } });
  const options = { ...o, executionReservations: reservations }, api = await httpHarness(options);
  try {
    const submit = await supertest(api.url).post('/api/sessions/s1/turns')
      .send({ sessionId: 's1', content: 'Text tab', idempotencyKey: 'text-request-0001' }).expect(409);
    expect(submit.body.error.code).toBe('CONFLICT_ACTIVE_TURN');
    const retry = await supertest(api.url).post('/api/sessions/s1/turns/t1/retry')
      .send({ idempotencyKey: 'text-retry-0001' }).expect(409);
    expect(retry.body.error.code).toBe('CONFLICT_ACTIVE_TURN');
    expect(o.runtime.submitTurn).not.toHaveBeenCalled(); expect(o.runtime.retryTurn).not.toHaveBeenCalled();
    await reservations.release({ identity, reservationId: held.reservationId });
    await new ChatHttpService(options).submit('s1', { sessionId: 's1', content: 'Text tab', idempotencyKey: 'text-request-0001' });
    expect(o.runtime.submitTurn).toHaveBeenCalledTimes(1);
  } finally { await api.close(); }
});
it('does not leak an identity override through the early mode guard', async () => {
  const o = fixtureOptions(), guard = { assertText: vi.fn() };
  const service = new ChatHttpService({ ...o, executionReservations: guard });
  await expect(service.submit('s1', { sessionId: 's1', content: 'x', idempotencyKey: 'request-0001', userId: 'evil' }))
    .rejects.toMatchObject({ code: 'IDENTITY_OVERRIDE_REJECTED' });
  expect(guard.assertText).not.toHaveBeenCalled();
});
```

- [ ] **Run RED:** `npm test -- test/http/voice-exclusion.spec.ts`. Expected submit/retry return 202 instead of 409, not a schema/import accident.
- [ ] **Minimal HTTP edits.** Add this optional field to `ChatHttpOptions`:

```typescript
executionReservations?: { assertText(userId: string, sessionId: string): void };
```

In `ChatHttpService.submit`, after validation and before calling runtime, insert:

```typescript
if (sessionId !== null) this.o.executionReservations?.assertText(this.o.identity.resolve().userId, sessionId);
```

In `retry`, after body/session validation and before runtime, insert:

```typescript
this.o.executionReservations?.assertText(this.o.identity.resolve().userId, sessionId);
```

The optional early guard preserves existing test/text-only compositions; the **mandatory runtime guard** cannot be bypassed when it is absent. P10 supplies the exact same `runtime.reservations`, not a second instance. Existing error mapping already returns 409 for `AppError('CONFLICT_ACTIVE_TURN')`; no new filter/controller is needed.

- [ ] **Verify:** `npm test -- test/http/voice-exclusion.spec.ts test/http/service.spec.ts test/http/stream-transport.spec.ts`, `npm run build`, `npm run lint`.
- [ ] **Commit only cleared owner files:**

```powershell
git add backend/src/chat-runtime/execution-reservations.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/src/http/options.ts backend/src/http/chat-http.service.ts backend/test/runtime/execution-reservations.spec.ts backend/test/http/voice-exclusion.spec.ts
git commit -m "feat(voice): exclude text execution while live owns a conversation"
```

### Task 2: Agent Voice Adapter & Turn Submission

**Files:** `ports.ts`, runtime acceptance, `agent-voice-adapter.ts`, `submission.spec.ts`, `voice-runtime-harness.ts`, `voice-acceptance.native.e2e-spec.ts`.

#### 2A. Finalized-turn keys and first conversation binding

- [ ] **Write failing adapter tests** in `backend/test/voice/agent/submission.spec.ts`:

```typescript
import { expect, it, vi } from 'vitest';
import { AgentVoiceAdapter, voiceRequestKey } from '../../../src/voice/agent/agent-voice-adapter.js';
import type { SessionContext } from '../../../src/voice/session/voice-session.options.js';
import { options, origin, request } from '../session/fixtures.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { sessionIdFor } from '../../../src/chat-runtime/identity.js';
it('namespaces provider turn identity by voice session and actual STT socket epoch', () => {
  const input = { providerSocketEpoch: 0, providerTurnId: 'provider:0', text: 'Do not change ID ABC-42.' };
  expect(voiceRequestKey('v1', input)).toBe(voiceRequestKey('v1', { ...input, text: 'different' }));
  expect(voiceRequestKey('v1', input)).not.toBe(voiceRequestKey('v2', input));
  expect(voiceRequestKey('v1', input)).not.toBe(voiceRequestKey('v1', { ...input, providerSocketEpoch: 1 }));
});
it('ignores empty finalized speech and binds only a submitted first input', async () => {
  const o = options(), sessions = new VoiceSessionService(o);
  try {
    const created = await sessions.create({ ...request, mode: 'live' }, origin);
    const c: SessionContext = sessions.claim(created.cookie.split(';')[0], origin);
    const submitLiveTurn = vi.fn(async (value: { sessionId: string }) => ({ sessionId: value.sessionId,
      turnId: 't1', attemptId: 'a1', userMessageId: 'm1', streamPath: '/sessions/s1/turns/t1/stream' }));
    const bind = vi.fn(async (_voice: string, s: string) => { c.response.conversationId = s;
      c.reservation = { ...c.reservation!, conversationId: s }; });
    const bridge = new AgentVoiceAdapter({ submitLiveTurn }, bind);
    const input = { providerSocketEpoch: 0, providerTurnId: 'provider:0', text: '   ' };
    expect(await bridge.submit(c, input)).toBeNull(); expect(bind).not.toHaveBeenCalled();
    expect(submitLiveTurn).not.toHaveBeenCalled();
    const accepted = await bridge.submit(c, { ...input, text: 'Do not change ID ABC-42.' });
    const key = voiceRequestKey(c.response.sessionId, input);
    expect(bind).toHaveBeenCalledWith(c.response.sessionId, sessionIdFor(c.identity.userId, null, key));
    expect(submitLiveTurn).toHaveBeenCalledWith(expect.objectContaining({ content: 'Do not change ID ABC-42.',
      identity: c.identity, reservation: c.reservation, idempotencyKey: key }));
    expect(accepted?.sessionId).toBe(c.response.conversationId);
  } finally { await sessions.drain(); }
});
```

- [ ] **Run RED:** `npm test -- test/voice/agent/submission.spec.ts`; expect missing adapter import.
- [ ] **Create the minimal submission adapter** in `backend/src/voice/agent/agent-voice-adapter.ts`:

```typescript
import { key } from '../../persistence/records.js';
import { sessionIdFor } from '../../chat-runtime/identity.js';
import type { DurableChatRuntime } from '../../chat-runtime/durable-chat-runtime.js';
import type { SessionContext } from '../session/voice-session.options.js';
import { VoiceSessionError } from '../session/voice-session.options.js';
export type FinalizedSpeech = { providerSocketEpoch: number; providerTurnId: string; text: string };
export const voiceRequestKey = (voiceSessionId: string, input: FinalizedSpeech) =>
  key('voice-input', voiceSessionId, String(input.providerSocketEpoch), input.providerTurnId);
export class AgentVoiceAdapter {
  constructor(readonly runtime: Pick<DurableChatRuntime, 'submitLiveTurn'>,
    readonly bindConversation: (voiceSessionId: string, conversationId: string) => Promise<void>) {}
  async submit(c: SessionContext, input: FinalizedSpeech) {
    if (!input.text.trim()) return null;
    if (c.response.mode !== 'live' || !c.reservation || c.reservation.owner.kind !== 'live' ||
      c.reservation.owner.voiceSessionId !== c.response.sessionId) throw new VoiceSessionError('VOICE_BINDING_MISMATCH');
    const idempotencyKey = voiceRequestKey(c.response.sessionId, input);
    const sessionId = sessionIdFor(c.identity.userId, c.response.conversationId, idempotencyKey);
    await this.bindConversation(c.response.sessionId, sessionId);
    if (!c.reservation || c.reservation.conversationId !== sessionId || c.response.conversationId !== sessionId)
      throw new VoiceSessionError('VOICE_BINDING_MISMATCH');
    return this.runtime.submitLiveTurn({ identity: c.identity, sessionId, content: input.text,
      idempotencyKey, reservation: c.reservation });
  }
}
```

Task 3 expands this class with actual execution/flow callbacks. This slice deliberately implements acceptance only, not a silent production bridge fallback.

#### 2B. Shared runtime acceptance with explicit internal capability

- [ ] **Add runtime-local types** to `backend/src/chat-runtime/ports.ts`. These are complete declarations needed by Tasks 2–4, not new P1 transport schemas:

```typescript
import type { ExecutionReservation, VoiceDeliveryRecord } from '../contracts/voice.js';
import type { SubmitTurnCommand } from '../contracts/runtime.js';
import type { AttemptRecord } from '../contracts/attempt.js';
export type SubmitLiveTurn = Omit<SubmitTurnCommand, 'sessionId'> & { sessionId: string; reservation: ExecutionReservation };
export type DeliveryWrite = (record: VoiceDeliveryRecord, expectedSequence?: number) => Promise<void>;
export type LiveExecution = {
  reservation: ExecutionReservation;
  start(attempt: AttemptRecord, write: DeliveryWrite): Promise<void>;
  delta(text: string): Promise<void>;
  finish(): Promise<void>;
  settle(finalGenerated: string): Promise<void>;
};
```

Add `live?: LiveExecution` to the existing `ExecuteTurn`. This is backend-only; HTTP passes no `live`, and every live entry still verifies the reservation and input classification.

- [ ] **Create a delivery-aware native fixture**, `backend/test/runtime/voice-runtime-harness.ts`:

```typescript
import { nativeHarness } from './native-harness.js';
import { ReferencedContextAssembler } from '../../src/context/referenced-context-assembler.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
export async function voiceRuntimeHarness(text?: string) {
  const h = await nativeHarness(text);
  h.deps.assembler = new ReferencedContextAssembler({ memory: h.persistence.memory,
    messages: h.persistence.messages, metadata: h.persistence.metadata, assets: h.deps.assets,
    budgets: h.deps.config.budgets });
  const runtime = new DurableChatRuntime(h.deps);
  return { ...h, runtime };
}
```

- [ ] **Write the failing native tests**, `backend/test/runtime/voice-acceptance.native.e2e-spec.ts`:

```typescript
import { expect, it } from 'vitest';
import { voiceRuntimeHarness } from './voice-runtime-harness.js';
import { sessionIdFor } from '../../src/chat-runtime/identity.js';
it('accepts one internal input before inference and creates a neutral first-turn conversation', async () => {
  const h = await voiceRuntimeHarness();
  try {
    const held = await h.runtime.reservations.acquire({ identity: h.identity, conversationId: null,
      owner: { kind: 'live', voiceSessionId: 'v1' } });
    expect((await h.persistence.sessions.list(h.identity.userId, { limit: 10, cursor: null })).items).toEqual([]);
    const sessionId = sessionIdFor(h.identity.userId, null, 'voice-request-0001');
    const reservation = await h.runtime.reservations.bindConversation({ identity: h.identity,
      reservationId: held.reservationId, conversationId: sessionId });
    const command = { identity: h.identity, sessionId, content: 'SECRET ABC-42 is not cancelled.',
      idempotencyKey: 'voice-request-0001', reservation };
    const [a, b] = await Promise.all([h.runtime.submitLiveTurn(command), h.runtime.submitLiveTurn(command)]);
    expect(a).toEqual(b); expect(h.fetcher).not.toHaveBeenCalled();
    expect(await h.persistence.messages.get(h.identity.userId, sessionId, a.userMessageId))
      .toMatchObject({ content: command.content, mode: 'live', visibility: 'internal', completionStatus: 'accepted' });
    expect(await h.persistence.metadata.getAcceptance(h.identity.userId, sessionId, a.attemptId)).not.toBeNull();
    expect((await h.persistence.sessions.get(h.identity.userId, sessionId))?.title).toBe('Voice Conversation');
    expect((await h.persistence.messages.list(h.identity.userId, sessionId, { limit: 10, cursor: null })).items).toEqual([]);
    await expect(h.runtime.submitTurn({ ...command, idempotencyKey: 'text-request-0001' }))
      .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
    await expect(h.runtime.submitLiveTurn({ ...command, content: 'different' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    await h.runtime.reconcileSession(h.identity.userId, sessionId);
    await h.runtime.reservations.release({ identity: h.identity, reservationId: held.reservationId });
  } finally { await h.close(); }
}, 30000);
it('a forged live capability cannot bypass text exclusion or create a record', async () => {
  const h = await voiceRuntimeHarness();
  try {
    await expect(h.runtime.submitLiveTurn({ identity: h.identity, sessionId: 's1', content: 'SECRET',
      idempotencyKey: 'voice-request-0001', reservation: { reservationId: 'forged', userId: h.identity.userId,
        conversationId: 's1', owner: { kind: 'live', voiceSessionId: 'v1' } } }))
      .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
    expect(await h.persistence.sessions.get(h.identity.userId, 's1')).toBeNull();
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.close(); }
}, 30000);
```

- [ ] **Run RED:** `npm run test:e2e -- test/runtime/voice-acceptance.native.e2e-spec.ts`. With admitted isolated configuration, expect absent `submitLiveTurn`. Without it, record blocked and continue only offline steps; do not claim the native acceptance evidence.
- [ ] **Add the internal entry point to `DurableChatRuntime`:** import `SubmitLiveTurn` and `ExecutionReservation`, then add:

```typescript
submitLiveTurn(c: SubmitLiveTurn) {
  try {
    const identity = this.identity(c.identity); this.ready();
    const body = submitTurnRequestSchema.parse({ sessionId: c.sessionId, content: c.content, idempotencyKey: c.idempotencyKey });
    const s = sessionIdFor(identity.userId, body.sessionId, body.idempotencyKey);
    this.reservations.assertLive(c.reservation, identity, s);
    return this.joinAcceptance(JSON.stringify([identity.userId, s, c.idempotencyKey]),
      hashPayload(JSON.stringify(['submit-live', body.content])), () => this.acceptNewTurn(c, c.reservation));
  } catch (error) { return Promise.reject(error); }
}
```

- [ ] **Make acceptance live-aware with these exact local replacements.** Change the signature to `acceptNewTurn(command: SubmitTurnCommand, live?: ExecutionReservation)`. Immediately after deriving `s`, validate mode ownership and define classification:

```typescript
if (live) this.reservations.assertLive(live, id, s); else this.reservations.assertText(id.userId, s);
const classification = live ? { visibility: 'internal' as const, mode: 'live' as const } : {};
```

Inside the existing duplicate branch, read the original before returning and verify channel as well as the existing payload/marker checks:

```typescript
const original = await p.messages.get(id.userId, s, old.causal.userMessageId);
if (!original || (live ? original.visibility !== 'internal' || original.mode !== 'live'
  : original.visibility === 'internal')) throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'This request identity has different input.');
```

Before the duplicate lookup, check a found session's lifecycle; both new input and duplicate replay must reject a deleted conversation:

```typescript
const existingSession = await p.sessions.get(id.userId, s);
if (existingSession && existingSession.lifecycle !== 'active') throw new AppError('NOT_FOUND', 'Chat not found.');
```

Immediately before `work.open`, repeat the ownership check with no intervening await. Replace the existing-session existence requirement with:

```typescript
if (!live && body.sessionId !== null && !await p.sessions.get(id.userId, s)) throw new AppError('NOT_FOUND', 'Chat not found.');
```

Use the same session record already constructed there, but dispatch creation to the existing P2 method:

```typescript
const sessionRecord = { schemaVersion: 1 as const, userId: id.userId, sessionId: s,
  title: live ? 'Voice Conversation' : titleFor(body.content, this.d.config.budgets.titleMaxChars),
  createdAt: at, updatedAt: at, lastActivityAt: at, lifecycle: 'active' as const,
  graphThreadId: graphThreadId(id.userId, s), latestTurnId: null,
  execution: { ownerId: null, leaseExpiresAt: null, activeAttemptId: null, generation: 0 } };
await job.wait(live ? p.sessions.createForInternalTurn(sessionRecord) : p.sessions.createIfAbsent(sessionRecord),
  this.d.config.budgets.persistenceTimeoutMs);
```

Spread `...classification` into **both** the preflight bounded user record and the new `input: MessageRecord`. Extend orphan validation with:

```typescript
if (orphan && (live ? orphan.visibility !== 'internal' || orphan.mode !== 'live' : orphan.visibility === 'internal'))
  throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'This request identity has different input.');
```

Keep marker confirmation, input hash, sequence allocation, server identity, budgets, accounting and owner cleanup unchanged. Do not add client `mode` or `visibility` fields to public submit DTOs. `MongoSessions.get` returns deleted records too; the explicit lifecycle check above is required. Request the matching deleted-conversation admission guard from P5 instead of changing its service independently.

- [ ] **Verify:** `npm test -- test/voice/agent/submission.spec.ts`, native command above (2 actual passes when configured), `npm run test:e2e -- test/runtime/acceptance.native.e2e-spec.ts`, and `npm run build`.
- [ ] **Commit:**

```powershell
git add backend/src/chat-runtime/ports.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/src/voice/agent/agent-voice-adapter.ts backend/test/voice/agent/submission.spec.ts backend/test/runtime/voice-runtime-harness.ts backend/test/runtime/voice-acceptance.native.e2e-spec.ts
git commit -m "feat(voice): durably accept internal turns through the shared runtime"
```

### Task 3: Streamed Speech Filtering & Delivery Reconciliation

**Files:** Create `speech-prose.ts`, `voice-delivery.ts` and their tests; expand adapter/runtime execution. Use P2's existing `MongoMetadata` methods, not a new repository.

#### 3A. Incremental safe prose before archive and synthesis

- [ ] **Write the failing filtering tests**, `backend/test/voice/agent/speech-prose.spec.ts`:

```typescript
import { expect, it } from 'vitest';
import { SpeechProse } from '../../../src/voice/agent/speech-prose.js';
const normalize = (chunks: string[]) => { const f = new SpeechProse(); return chunks.map(c => f.push(c)).join('') + f.finish(); };
it('streams completed prose units but never split reasoning, code, JSON or tables', () => {
  const raw = '<think>private thought. Still private.</think>\n**Do not** change ABC-42.\n' +
    '```json\n{"secret": true}\n```\n{"tool": "hidden"}\n| name | value |\n' +
    '### Price is 12.50 on 2026-10-08.\nSee [Aurvin](https://example.test).';
  const expected = 'Do not change ABC-42. Price is 12.50 on 2026-10-08. See Aurvin.';
  expect(normalize([raw])).toBe(expected);
  expect(normalize([...raw])).toBe(expected);
  for (let cut = 0; cut <= raw.length; cut++) expect(normalize([raw.slice(0, cut), raw.slice(cut)])).toBe(expected);
});
it('preserves factual identifiers, Unicode, repetitions, dates, amounts and negations', () => {
  expect(normalize(['Do not cancel demo_id. Repeat repeat ₹12.50 for Priya on 2026-10-08.']))
    .toBe('Do not cancel demo_id. Repeat repeat ₹12.50 for Priya on 2026-10-08.');
  expect(normalize(['Use `ABC-42`, not `ABC-43`.'])) .toBe('Use ABC-42, not ABC-43.');
});
it('emits before provider completion without speaking an ambiguous incomplete syntax unit', () => {
  const f = new SpeechProse();
  expect(f.push('Hello. Next ')).toBe('Hello.');
  expect(f.push('sentence. ')).toBe(' Next sentence.');
  expect(f.finish()).toBe('');
  expect(normalize(['<analysis>never close'])).toBe('');
  expect(normalize(['```\nnever close'])).toBe('');
  expect(normalize(['[unclosed link'])).toBe('');
});
it('suppresses embedded hidden blocks and raw inline code across arbitrary token splits', () => {
  const raw = 'Safe prefix <think>private one. private two. private three.</think> Safe conclusion.';
  for (let cut = 0; cut <= raw.length; cut++) expect(normalize([raw.slice(0, cut), raw.slice(cut)]))
    .toBe('Safe prefix Safe conclusion.');
  expect(normalize(['Use `rm -rf private_path`.'])).toBe('');
  expect(normalize(['Before {"tool":"x","arguments":{"text":"private one. private two."}} After.']))
    .toBe('Before After.');
  expect(normalize(['[1, 2, 3]'])).toBe('');
});
it('bounds raw input and unfinished units instead of buffering forever', () => {
  const f = new SpeechProse(32);
  expect(() => f.push('<think>' + 'x'.repeat(33))).toThrow();
});
```

- [ ] **Run RED:** `npm test -- test/voice/agent/speech-prose.spec.ts`.
- [ ] **Implement `backend/src/voice/agent/speech-prose.ts`:**

```typescript
import { AppError } from '../../platform/errors/app-error.js';
export class SpeechProse {
  private buffer = ''; private total = 0; private emitted = false;
  constructor(private readonly maximum = 32000) {}
  push(text: string) {
    this.total += text.length;
    if (this.total > this.maximum) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The answer exceeded its speech limit.');
    this.buffer += text; return this.drain(false);
  }
  finish() { return this.drain(true); }
  private plain(raw: string) {
    if (/[{}|<>]/u.test(raw)) return '';
    if ([...raw.matchAll(/`([^`\n]+)`/gu)].some(match => !/^[\p{L}\p{N}_./:@-]+$/u.test(match[1]))) return '';
    let text = raw.replace(/^\s{0,3}(?:#{1,6}\s+|>\s+|[-+*]\s+|\d+[.)]\s+)/u, '')
      .replace(/!?\[([^\]\n]+)\]\([^\)\n]+\)/gu, '$1')
      .replace(/`([^`\n]+)`/gu, '$1')
      .replace(/\*\*([^*\n]+)\*\*/gu, '$1').replace(/__([^_\n]+)__/gu, '$1')
      .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/gu, '$1')
      .replace(/(?<!\w)_([^_\n]+)_(?!\w)/gu, '$1')
      .replace(/&amp;/gu, '&').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'")
      .replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (/[`\[\]*]/u.test(text) || /&(?:\w+|#\d+);/u.test(text) || /^[-=]{3,}$/u.test(text)) return '';
    if (!text) return '';
    text = (this.emitted ? ' ' : '') + text; this.emitted = true; return text;
  }
  private drain(final: boolean) {
    let output = '';
    // ponytail: bounded 32k answer, conservative syntax recognition; use a streaming Markdown parser if richer spoken formatting is approved.
    while (this.buffer) {
      const leading = this.buffer.match(/^\s+/u)?.[0].length ?? 0;
      this.buffer = this.buffer.slice(leading); if (!this.buffer) break;
      const hidden = this.buffer.match(/^<([a-z][a-z0-9_-]*)(?:\s[^>]*)?>/iu);
      if (hidden) {
        const close = this.buffer.toLowerCase().indexOf(`</${hidden[1].toLowerCase()}>`, hidden[0].length);
        if (close < 0) { if (final) this.buffer = ''; break; }
        this.buffer = this.buffer.slice(close + hidden[1].length + 3); continue;
      }
      const fence = this.buffer.match(/^(?:```|~~~)/u)?.[0];
      if (fence) {
        const close = this.buffer.indexOf(fence, fence.length);
        if (close < 0) { if (final) this.buffer = ''; break; }
        this.buffer = this.buffer.slice(close + fence.length); continue;
      }
      if (this.buffer[0] === '{') {
        let depth = 0, quoted = false, escaped = false, end = -1;
        for (let i = 0; i < this.buffer.length; i++) {
          const c = this.buffer[i];
          if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
          else if (c === '"') quoted = true;
          else if (c === '{' || c === '[') depth++;
          else if (c === '}' || c === ']') { if (--depth === 0) { end = i + 1; break; } }
        }
        if (end < 0) { if (final) this.buffer = ''; break; }
        this.buffer = this.buffer.slice(end); continue;
      }
      let inline = false, brackets = 0, parens = 0, end = -1;
      for (let i = 0; i < this.buffer.length; i++) {
        const c = this.buffer[i];
        if (c === '`') inline = !inline;
        if (!inline) {
          if (i > 0 && (c === '{' || /^<([a-z][a-z0-9_-]*)(?:\s[^>]*)?>/iu.test(this.buffer.slice(i)))) { end = i; break; }
          if (c === '[') brackets++; else if (c === ']') brackets--;
          if (c === '(') parens++; else if (c === ')') parens--;
          if (brackets === 0 && parens === 0 && (c === '\n' ||
            (/[.!?]/u.test(c) && i + 1 < this.buffer.length && /\s/u.test(this.buffer[i + 1])))) { end = i + 1; break; }
        }
      }
      if (end < 0) { if (!final) break; end = this.buffer.length; }
      const unit = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end);
      output += this.plain(unit);
    }
    return output;
  }
}
```

Do not claim a heuristic can recognize arbitrary hidden instructions disguised as ordinary prose. The safety boundary is the provider's assistant-content channel plus fail-closed syntactic filtering. Extend the exact regression suite before broadening syntax. Do not save filtered-out reasoning in graph/messages/telemetry. Structured-only output is handled as empty speech and an operational recovery offer, not synthesized JSON.

- [ ] **Run GREEN:** `npm test -- test/voice/agent/speech-prose.spec.ts`; all split positions must produce identical safe prose. Then `npm test -- test/model/adapter.spec.ts` preserves the existing reasoning/tool-channel boundary.

#### 3B. Lease-bound, ordered generated-versus-heard evidence

- [ ] **Write the failing delivery tests**, `backend/test/voice/agent/voice-delivery.spec.ts`:

```typescript
import { afterEach, expect, it, vi } from 'vitest';
import { VoiceDelivery } from '../../../src/voice/agent/voice-delivery.js';
import { deliveryFixture } from '../../../src/contracts/testing/voice-fixtures.js';
import type { VoiceDeliveryRecord } from '../../../src/contracts/voice.js';
import type { DeliveryWrite } from '../../../src/chat-runtime/ports.js';
afterEach(() => vi.useRealTimers());
const usage = { providerRequestId: null, model: 'fixture', modelVersion: null, audioMs: 100, billableCharacters: 12 };
function fixture(baseSamples = 0) {
  const seed = { ...deliveryFixture(), status: 'pending' as const, textGenerated: '', textSpoken: null,
    textRemaining: null, audioDurationMs: null, audioPlayedMs: null, playedSamples: null };
  const writes: VoiceDeliveryRecord[] = [];
  const write: DeliveryWrite = vi.fn(async (record, expected) => {
    if (expected !== undefined) expect(expected).toBe(writes.at(-1)?.sequence);
    writes.push(structuredClone(record));
  });
  const speak = vi.fn(async (_command: { turnId: string; responseId: string; text: string }) => undefined);
  const flush = vi.fn(async (_ref: { turnId: string; responseId: string }) => undefined);
  return { seed, writes, write, speak, flush, delivery: new VoiceDelivery(seed, baseSamples, write, { speak, flush }, 2000) };
}
it('persists prose before Speak and waits for played samples, not synthesis completion', async () => {
  const f = fixture(2400); await f.delivery.start(); await f.delivery.delta('Hello world.');
  expect(f.writes.at(-1)?.textGenerated).toBe('Hello world.');
  await f.delivery.finish();
  await f.delivery.event({ type: 'speech-completed', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-1', audioDurationMs: 100, usage });
  expect(f.writes.at(-1)?.status).toBe('pending');
  await f.delivery.playback(3600); expect(f.writes.at(-1)?.playedSamples).toBe(1200);
  await f.delivery.playback(4800); await f.delivery.settle('Hello world.');
  expect(f.writes.at(-1)).toMatchObject({ status: 'completed', textSpoken: 'Hello world.', textRemaining: '',
    audioPlayedMs: 100, audioDurationMs: 100, playedSamples: 2400 });
});
it('accepts interrupted evidence before generation settles and freezes the final generated prefix', async () => {
  const f = fixture(2400); await f.delivery.start(); await f.delivery.delta('Hello world.');
  f.delivery.invalidate();
  await f.delivery.event({ type: 'speech-interrupted', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-1', audioPlayedMs: 50, textSpoken: 'Hello', textRemaining: ' world.', usage });
  expect(f.writes.at(-1)?.status).toBe('pending');
  await f.delivery.delta(' Late tokens.'); expect(f.speak).toHaveBeenCalledTimes(1);
  await f.delivery.settle('Hello world. Unsent prefix.');
  expect(f.writes.at(-1)).toMatchObject({ status: 'interrupted', textGenerated: 'Hello world. Unsent prefix.',
    textSpoken: 'Hello', textRemaining: ' world. Unsent prefix.', audioPlayedMs: 50 });
});
it('rejects regressing playback and wrong-response callbacks without corrupting evidence', async () => {
  const f = fixture(); await f.delivery.start(); await f.delivery.delta('Hello.'); await f.delivery.playback(1200);
  await expect(f.delivery.playback(1199)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.delivery.event({ type: 'speech-started', turnId: f.seed.turnId, responseId: 'wrong', speechId: 'speech-1' }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.writes.at(-1)?.playedSamples).toBe(1200);
});
it('times out to unknown instead of inventing a spoken substring or replaying audio', async () => {
  vi.useFakeTimers(); const f = fixture(); await f.delivery.start(); await f.delivery.delta('Hello world.');
  f.delivery.invalidate(); const done = f.delivery.settle('Hello world.');
  await vi.advanceTimersByTimeAsync(2000); await done;
  expect(f.writes.at(-1)).toMatchObject({ status: 'unknown', textSpoken: null, textRemaining: null });
  expect(f.speak).toHaveBeenCalledTimes(1);
});
it('cannot treat malformed provider split text or submillisecond short playback as complete', async () => {
  vi.useFakeTimers(); const f = fixture(); await f.delivery.start(); await f.delivery.delta('Hello world.');
  await f.delivery.event({ type: 'speech-completed', turnId: f.seed.turnId, responseId: f.seed.responseId,
    speechId: 'speech-1', audioDurationMs: 100, usage });
  await f.delivery.playback(2399); const done = f.delivery.settle('Hello world.');
  await vi.advanceTimersByTimeAsync(2000); await done;
  expect(f.writes.at(-1)?.status).toBe('unknown');
  const g = fixture(); await g.delivery.start(); await g.delivery.delta('Hello world.'); g.delivery.invalidate();
  await g.delivery.event({ type: 'speech-interrupted', turnId: g.seed.turnId, responseId: g.seed.responseId,
    speechId: 'speech-1', audioPlayedMs: 50, textSpoken: 'Different', textRemaining: ' world.', usage });
  await g.delivery.settle('Hello world.'); expect(g.writes.at(-1)?.status).toBe('unknown');
});
```

- [ ] **Run RED:** `npm test -- test/voice/agent/voice-delivery.spec.ts`.
- [ ] **Implement `backend/src/voice/agent/voice-delivery.ts`**, introducing the queue, then evidence methods, then settlement in separate short actions:

```typescript
import { randomUUID } from 'node:crypto';
import type { TtsEvent, VoiceDeliveryRecord } from '../../contracts/voice.js';
import { voiceDeliveryRecordSchema } from '../../contracts/voice.js';
import type { DeliveryWrite } from '../../chat-runtime/ports.js';
import { AppError } from '../../platform/errors/app-error.js';
type Ref = { turnId: string; responseId: string };
type SpeechWriter = { speak(c: Ref & { text: string }): Promise<void>; flush(c: Ref): Promise<void> };
type Evidence = Extract<TtsEvent, { type: 'speech-interrupted' }>;
export class VoiceDelivery {
  private record: VoiceDeliveryRecord;
  private chain = Promise.resolve(); private invalid = false; private ended = false;
  private sent = ''; private interrupted: Evidence | null = null; private synthesized = false;
  private wake?: () => void;
  constructor(seed: VoiceDeliveryRecord, private readonly base: number, private readonly write: DeliveryWrite,
    private readonly speech: SpeechWriter, private readonly deadlineMs: number) {
    this.record = voiceDeliveryRecordSchema.parse(seed);
  }
  private ref(): Ref { return { turnId: this.record.turnId, responseId: this.record.responseId }; }
  private enqueue(action: () => Promise<void>) { this.chain = this.chain.then(action); return this.chain; }
  private async update(patch: Partial<VoiceDeliveryRecord>) {
    if (this.ended) return;
    const old = this.record;
    const next = voiceDeliveryRecordSchema.parse({ ...old, ...patch, sequence: old.sequence + 1,
      eventId: randomUUID(), updatedAt: new Date().toISOString() });
    await this.write(next, old.sequence); this.record = next; this.wake?.();
  }
  start() { return this.enqueue(() => this.write(this.record)); }
  invalidate() { this.invalid = true; this.wake?.(); }
  delta(text: string) {
    return this.enqueue(async () => {
      if (this.invalid || this.ended || !text) return;
      await this.update({ textGenerated: this.record.textGenerated + text });
      if (this.invalid) return;
      this.sent += text;
      try { await this.speech.speak({ ...this.ref(), text }); }
      catch (error) { this.invalid = true; this.wake?.(); throw error; }
    });
  }
  finish() {
    return this.enqueue(async () => { if (!this.invalid && !this.ended && this.sent) await this.speech.flush(this.ref()); });
  }
  playback(socketSamples: number) {
    return this.enqueue(async () => {
      const relative = socketSamples - this.base;
      if (!Number.isSafeInteger(relative) || relative < 0 || relative < (this.record.playedSamples ?? 0))
        throw new AppError('INVALID_REQUEST', 'Playback evidence regressed.');
      if (this.ended) return;
      await this.update({ playedSamples: relative });
    });
  }
  event(e: Exclude<TtsEvent, { type: 'audio' } | { type: 'error' }>) {
    return this.enqueue(async () => {
      if (e.turnId !== this.record.turnId || e.responseId !== this.record.responseId)
        throw new AppError('INVALID_REQUEST', 'Speech response binding is invalid.');
      if (this.ended) return;
      if (this.record.speechId !== null && e.speechId !== this.record.speechId)
        throw new AppError('INVALID_REQUEST', 'Speech identity changed.');
      if (e.type === 'speech-interrupted') { this.interrupted ??= e; this.invalid = true; }
      if (e.type === 'speech-completed') this.synthesized = true;
      await this.update({ ...(e.speechId !== null ? { speechId: e.speechId } : {}),
        ...(e.type === 'speech-completed' ? { audioDurationMs: e.audioDurationMs } : {}) });
    });
  }
  private proof(): Partial<VoiceDeliveryRecord> | null {
    const generated = this.record.textGenerated, samples = this.record.playedSamples ?? 0;
    if (!this.sent) return { status: this.invalid ? 'cancelled' : generated ? 'failed' : 'completed',
      audioDurationMs: 0, audioPlayedMs: 0, playedSamples: 0, textSpoken: '', textRemaining: generated };
    const e = this.interrupted;
    if (e) {
      if (e.audioPlayedMs === null || e.textSpoken === null || e.textRemaining === null ||
        e.textSpoken + e.textRemaining !== this.sent || !generated.startsWith(e.textSpoken) ||
        e.audioPlayedMs < Math.floor(samples / 24) ||
        (this.record.audioDurationMs !== null && e.audioPlayedMs > this.record.audioDurationMs))
        return { status: 'unknown', textSpoken: null, textRemaining: null };
      return { status: 'interrupted', textSpoken: e.textSpoken,
        textRemaining: generated.slice(e.textSpoken.length), audioPlayedMs: e.audioPlayedMs,
        playedSamples: Math.max(samples, e.audioPlayedMs * 24) };
    }
    if (!this.invalid && this.synthesized && generated === this.sent && this.record.audioDurationMs !== null &&
      samples === this.record.audioDurationMs * 24) return { status: 'completed', textSpoken: generated,
        textRemaining: '', audioPlayedMs: this.record.audioDurationMs };
    return null;
  }
  async settle(finalGenerated: string) {
    await this.enqueue(async () => {
      if (!finalGenerated.startsWith(this.record.textGenerated)) throw new AppError('NOT_READY', 'Generated speech evidence disagrees.');
      if (finalGenerated !== this.record.textGenerated) await this.update({ textGenerated: finalGenerated });
    });
    const until = Date.now() + this.deadlineMs;
    while (!this.proof() && Date.now() < until) {
      await new Promise<void>(resolve => {
        let timer: ReturnType<typeof setTimeout>;
        const done = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
        timer = setTimeout(done, Math.max(1, until - Date.now())); this.wake = done;
      });
      await this.chain;
    }
    await this.enqueue(async () => {
      await this.update(this.proof() ?? { status: 'unknown', textSpoken: null, textRemaining: null });
      this.ended = true;
    });
  }
}
```

P5 already validates played-not-sent samples. This producer adds response-relative monotonicity and exact full-playback proof. Do not replace missing provider split text with a proportion of the answer. MongoMetadata's CAS and replay/linkage validation remain the persistence trust boundary. Terminal callbacks after settlement are no-ops, never writes through a released lease. Duplicate provider events must not replace established split evidence.

- [ ] **Run GREEN:** `npm test -- test/voice/agent/voice-delivery.spec.ts` (5 tests), then `npm test -- test/persistence/voice-metadata.spec.ts test/context/voice-context.spec.ts`. Native metadata suites remain separate; fake writer tests are not MongoDB certification.

#### 3C. Runtime lease and normalized immutable result

- [ ] **Make `executeTurn` verify the original channel before any stream emit.** Read the causal user input after `latestAttempt`, before the terminal reattachment branch:

```typescript
const acceptedInput = await p.messages.get(c.userId, c.sessionId, a.causal.userMessageId);
if (!acceptedInput) throw new AppError('NOT_READY', 'Accepted input needs recovery.');
const internal = acceptedInput.visibility === 'internal' && acceptedInput.mode === 'live';
if (c.live) {
  if (!internal) throw new AppError('NOT_FOUND', 'Turn not found.');
  this.reservations.assertLive(c.live.reservation, this.identity({ userId: c.userId,
    openRouterUser: c.userId, source: 'server-configured' }), c.sessionId);
} else {
  if (acceptedInput.visibility === 'internal') throw new AppError('NOT_FOUND', 'Turn not found.');
  this.reservations.assertText(c.userId, c.sessionId);
}
```

Repeat the appropriate `assertLive`/`assertText` immediately before `work.open`, replacing Task 1's unconditional text check. A terminal live reattachment returns operational status only and never initializes delivery or synthesizes saved prose.

- [ ] **Add live projection state beside `partial`** in `executeTurn`: import `SpeechProse`, declare `const prose = c.live ? new SpeechProse(this.d.config.budgets.maxInputChars) : null; let deliveryStarted = false;`.
- [ ] **Initialize pending delivery under the acquired execution lease**, after validating input/marker/context and before inference/first delta:

```typescript
if (c.live) {
  await c.live.start(a, async (record, expectedSequence) => {
    if (record.userId !== a.userId || record.sessionId !== a.sessionId || record.turnId !== a.turnId || record.attemptId !== a.attemptId)
      throw new AppError('INVALID_REQUEST', 'Delivery scope is invalid.');
    await job.wait(p.owner.run(owned, async () => {
      if (expectedSequence === undefined) await p.metadata.putVoiceDelivery(record);
      else if (!await p.metadata.compareVoiceDelivery(record, expectedSequence))
        throw new AppError('CONFLICT_ACTIVE_TURN', 'Delivery evidence changed.');
    }), this.d.config.budgets.persistenceTimeoutMs);
  });
  deliveryStarted = true;
}
```

- [ ] **Replace only the model delta branch with:**

```typescript
case 'delta': {
  const text = prose ? prose.push(chunk.text) : chunk.text;
  if (text) { partial += text; await c.live?.delta(text); await emit({ type: 'delta', text }); }
  break;
}
```

After confirming provider `end`, before constructing the assistant, drain the final safe prose and signal synthesis end:

```typescript
const tail = prose?.finish() ?? '';
if (tail) { partial += tail; await c.live?.delta(tail); await emit({ type: 'delta', text: tail }); }
await c.live?.finish();
```

Spread `...(internal ? { visibility: 'internal' as const, mode: 'live' as const } : {})` into the assistant record. Pass `internal` to `outputBudget` (add optional `internal = false`, spread the same classification into `emptyOutput`); preflight live acceptance passes `Boolean(live)`, and execution passes `internal`. This preserves the existing byte-headroom calculation with the added fields instead of allowing a storage overflow at finalization.

- [ ] **Keep live delivery fenced through cleanup.** In the normal success path, retain the acquired lease for live execution; replace immediate release with `if (!c.live) { await p.owner.release(owned); lease = undefined; }`. It is safe to clear the attempt after durable graph/application completion because the coordinator and still-owned session lease exclude text; delivery is an independent status.

In `executeTurn`'s `finally`, **before** final owner release, settle delivery if initialized:

```typescript
if (c.live && deliveryStarted && lease) {
  const original = await p.messages.get(a.userId, a.sessionId, outputId(a));
  const finalGenerated = saved?.assistant.content ?? original?.content ?? partial;
  try { await c.live.settle(finalGenerated); }
  catch (error) { this.work.degraded = true; throw error; }
}
```

Place settlement inside a nested `try/finally` whose cleanup always calls existing `job.stopHeartbeat`, `job.settled`, `p.owner.drain`, owner release and `job.close`; a delivery failure must not skip existing cleanup. A still-unconfirmed write quarantines work through the existing `Work.wait`, and a failed settlement keeps admission degraded for reconciliation. Do not suppress persistence errors or release while `Work.pending` has promises. Keep heartbeat running through normal live playback settlement; move its successful-path stop to this final cleanup for live work.

**Why before release:** P2 explicitly requires all delivery callbacks to remain owner-fenced. A separate post-runtime callback writing directly to MongoMetadata is invalid even if its unit tests pass.

#### 3D. Attach P5 callbacks without consuming its provider iterables twice

- [ ] **Expand the adapter constructor's runtime port** to a structural `VoiceBridgeRuntime` declaration. It retains the submission-only fixture by making execution operations optional there, but `attach` requires them and throws `VOICE_INVALID_STATE` when absent:

```typescript
type VoiceBridgeRuntime = Pick<DurableChatRuntime, 'submitLiveTurn'> &
  Partial<Pick<DurableChatRuntime, 'executeTurn' | 'cancelLiveTurn' | 'reconcileSession' | 'getLiveTurnStatus' | 'findLiveSubmission'>>;
```

- [ ] **Add these imports and declarations in `agent-voice-adapter.ts`:**

```typescript
import { randomUUID } from 'node:crypto';
import type { LiveHooks, VoiceSink } from '../session/voice-session.options.js';
import type { LiveFlow } from '../session/live-flow.js';
import type { SubmitTurnResponse } from '../../contracts/api.js';
import { voiceDeliveryRecordSchema } from '../../contracts/voice.js';
import { VoiceDelivery } from './voice-delivery.js';
type Active = { ids: SubmitTurnResponse; responseId: string; controller: AbortController;
  delivery?: VoiceDelivery; invalid: boolean; done?: Promise<void> };
```

Change the existing constructor parameter type from `Pick<DurableChatRuntime, 'submitLiveTurn'>` to `VoiceBridgeRuntime`. Keep the exact Task 2 `submit` method; add the following fields/methods:

```typescript
private context?: SessionContext; private flow?: LiveFlow; private sink?: VoiceSink; private active?: Active;
private closed = false; private submitted = new Map<string, { text: string; promise: Promise<void> }>();
readonly hooks: LiveHooks = {
  finalized: (c, input, signal) => this.finalized(c, input, signal),
  interrupt: (c, ref) => this.interrupt(c, ref),
  delivery: (c, event) => { this.check(c); return this.forResponse(event)?.delivery?.event(event) ?? Promise.resolve(); },
  playback: (c, ref, samples) => { this.check(c); const a = this.forResponse(ref);
    return a?.delivery?.playback(samples) ?? Promise.resolve(); },
  disconnected: c => this.disconnected(c),
};
attach(c: SessionContext, flow: LiveFlow, sink: VoiceSink) {
  if (this.flow || !this.runtime.executeTurn || !this.runtime.cancelLiveTurn ||
    !this.runtime.reconcileSession || !this.runtime.getLiveTurnStatus || !this.runtime.findLiveSubmission)
    throw new VoiceSessionError('VOICE_INVALID_STATE');
  this.context = c; this.flow = flow; this.sink = sink;
}
private check(c: SessionContext) {
  if (c !== this.context || c.response.mode !== 'live') throw new VoiceSessionError('VOICE_BINDING_MISMATCH');
}
private forResponse(ref: { turnId: string; responseId: string }) {
  const a = this.active;
  return a?.ids.turnId === ref.turnId && a.responseId === ref.responseId ? a : undefined;
}
currentResponse() {
  return this.active ? { turnId: this.active.ids.turnId, responseId: this.active.responseId } : null;
}
finalized(c: SessionContext, input: FinalizedSpeech, signal: AbortSignal): Promise<void> {
  this.check(c); if (this.closed || !input.text.trim()) return Promise.resolve();
  const requestKey = voiceRequestKey(c.response.sessionId, input), old = this.submitted.get(requestKey);
  if (old) {
    if (old.text !== input.text) return Promise.reject(new VoiceSessionError('VOICE_BINDING_MISMATCH'));
    return old.promise;
  }
  if (this.submitted.size >= 4096) return Promise.reject(new VoiceSessionError('VOICE_SEQUENCE_ERROR'));
  const promise = this.run(c, input, signal);
  this.submitted.set(requestKey, { text: input.text, promise }); return promise;
}
private async run(c: SessionContext, input: FinalizedSpeech, signal: AbortSignal) {
  if (this.active) await this.active.done;
  if (this.closed || signal.aborted) return;
  const requestKey = voiceRequestKey(c.response.sessionId, input);
  const conversationId = sessionIdFor(c.identity.userId, c.response.conversationId, requestKey);
  await this.bindConversation(c.response.sessionId, conversationId);
  if (await this.runtime.findLiveSubmission!({ identity: c.identity, sessionId: conversationId,
    content: input.text, idempotencyKey: requestKey, reservation: c.reservation! })) {
    await this.runtime.reconcileSession!(c.identity.userId, conversationId); return;
  }
  const ids = await this.submit(c, input); if (!ids) return;
  this.sink!.event({ type: 'conversation.bound', conversationId: ids.sessionId });
  const status = await this.runtime.getLiveTurnStatus!(c.identity.userId, ids.sessionId, ids.turnId, c.reservation!);
  if (status.status !== 'accepted') {
    await this.runtime.reconcileSession!(c.identity.userId, ids.sessionId); return; // Never infer or speak on replay.
  }
  if (this.closed || signal.aborted) {
    await this.runtime.cancelLiveTurn!({ identity: c.identity, ...ids }, c.reservation!); return;
  }
  const responseId = key('voice-response', c.identity.userId, ids.sessionId, ids.attemptId);
  const controller = new AbortController();
  const active: Active = { ids, responseId, controller, invalid: false };
  this.active = active;
  const base = this.flow!.prepareResponse({ turnId: ids.turnId, responseId }).providerBaseSamples;
  const disconnect = () => { active.invalid = true; active.delivery?.invalidate(); controller.abort(); };
  signal.addEventListener('abort', disconnect, { once: true });
  if (signal.aborted) disconnect();
  const execute = this.runtime.executeTurn!({ userId: c.identity.userId, ...ids,
    signal: controller.signal, emit: async () => undefined,
    live: { reservation: c.reservation!,
      start: async (attempt, write) => {
        const at = new Date().toISOString();
        active.delivery = new VoiceDelivery(voiceDeliveryRecordSchema.parse({ schemaVersion: 1, kind: 'voice-delivery',
          userId: attempt.userId, sessionId: attempt.sessionId, voiceSessionId: c.response.sessionId,
          turnId: attempt.turnId, attemptId: attempt.attemptId, responseId, eventId: randomUUID(), sequence: 1,
          speechId: null, providerSocketId: this.flow!.providerSocketId, status: 'pending', audioDurationMs: null,
          audioPlayedMs: null, playedSamples: null, textGenerated: '', textSpoken: null, textRemaining: null,
          createdAt: at, updatedAt: at }), base, write, this.flow!, Math.min(2000, c.response.limits.finalizationMs));
        if (active.invalid) active.delivery.invalidate();
        await active.delivery.start();
      },
      delta: text => active.delivery!.delta(text), finish: () => active.delivery!.finish(),
      settle: generated => active.delivery!.settle(generated),
    } });
  active.done = execute.catch(async error => {
    const state = await this.runtime.getLiveTurnStatus!(c.identity.userId, ids.sessionId, ids.turnId, c.reservation!);
    if (!['cancelled', 'interrupted'].includes(state.status)) throw error;
  }).finally(() => { signal.removeEventListener('abort', disconnect); if (this.active === active) this.active = undefined; });
  await active.done;
}
async interrupt(c: SessionContext, ref: { turnId: string; responseId: string }) {
  this.check(c); const a = this.forResponse(ref); if (!a || a.invalid) return;
  a.invalid = true; a.delivery?.invalidate();
  // cancelLiveTurn synchronously marks Work CANCELLED before its first await.
  const cancellation = this.runtime.cancelLiveTurn!({ identity: c.identity, ...a.ids }, c.reservation!);
  a.controller.abort(); await cancellation;
}
async disconnected(c: SessionContext) {
  this.check(c); this.closed = true;
  const a = this.active;
  if (a) { a.invalid = true; a.delivery?.invalidate(); a.controller.abort(); await a.done?.catch(() => undefined); }
  if (c.response.conversationId) await this.runtime.reconcileSession!(c.identity.userId, c.response.conversationId);
}
```

Do not send runtime `delta`/`completed` envelopes to the browser: this bridge's sink is intentionally internal. P5 alone owns TTS/STT iterable consumption, audio framing, response invalidation and UI state. Task 4 adds the internal status/cancellation methods and hardens admission races; do not commit this cross-task slice with missing types/methods or failed build.

- [ ] **Verification checkpoint:** `npm test -- test/voice/agent/speech-prose.spec.ts test/voice/agent/voice-delivery.spec.ts test/voice/agent/submission.spec.ts`, `npm test -- test/voice/session/live.spec.ts test/voice/providers/flux-tts.spec.ts`, and `npm run build`. If P5's prepared-response handoff is absent, stop at this boundary and return that blocker rather than patch its files.

### Task 4: Turn Interruption & Recovery Consistency

**Files:** Runtime public/internal methods, `history.ts`, `reconciliation.ts`, `finalization.ts`, `voice-history.spec.ts`, `voice-recovery.native.e2e-spec.ts`.

#### 4A. Preserve original internal history and channel-safe saved results

- [ ] **Write `backend/test/runtime/voice-history.spec.ts`:**

```typescript
import { expect, it, vi } from 'vitest';
import { acceptedHistory } from '../../src/chat-runtime/history.js';
import type { PersistenceBundle } from '../../src/persistence/persistence.js';
import type { MessageRecord } from '../../src/contracts/message.js';
import { attempt, message } from '../persistence/fixtures.js';
it('uses original paging and retains heard-context candidates for terminal live attempts', async () => {
  const input = { ...message(0), visibility: 'internal' as const, mode: 'live' as const };
  const assistant: MessageRecord = { ...message(2), role: 'assistant', visibility: 'internal', mode: 'live',
    completionStatus: 'cancelled' as const, content: 'Hello. Unheard.', attemptId: 'a1' };
  const a = { ...attempt(), status: 'cancelled' as const };
  const list = vi.fn(async () => { throw new Error('Public paging is forbidden here'); });
  const p = { messages: { budgets: { maxPageSize: 50 }, list,
    listForContext: vi.fn(async () => ({ items: [input, assistant], nextCursor: null })) },
    metadata: { budgets: { maxPageSize: 50 }, listAttempts: vi.fn(async () => ({ items: [a], nextCursor: null })),
      getAcceptance: vi.fn(async () => ({ turnId: a.turnId, userMessageId: input.messageId, payloadHash: a.payloadHash })) },
  } as unknown as PersistenceBundle;
  expect((await acceptedHistory(p, 'u1', 's1')).map(m => m.role)).toEqual(['user', 'assistant']);
  expect(list).not.toHaveBeenCalled();
  assistant.visibility = 'visible'; assistant.mode = 'text';
  expect((await acceptedHistory(p, 'u1', 's1')).map(m => m.role)).toEqual(['user']);
});
```

The typed original lets this one test compare live terminal eligibility with unchanged text eligibility; no production type assertion is needed.

- [ ] **Run RED:** `npm test -- test/runtime/voice-history.spec.ts`; expected public paging call/failure and absent live terminal history.
- [ ] **Minimal raw paging change** in `archiveRecords`: replace `p.messages.list` and its per-visible `get` loop with:

```typescript
const found = await p.messages.listForContext(u, s, { cursor, limit: p.messages.budgets.maxPageSize });
out.push(...found.items);
```

Keep cursor, 100-page ceiling and sequence sorting unchanged. In `acceptedHistory`, add a `terminalLive` set and fill it for `completed`, `truncated`, `cancelled`, `interrupted`, `failed`. Replace only the assistant condition:

```typescript
const terminalLive = new Set<string>();
// In the existing attempt loop:
if (['completed', 'truncated', 'cancelled', 'interrupted', 'failed'].includes(a.status)) terminalLive.add(a.attemptId);
// In the final filter:
return (await archiveRecords(p, u, s)).filter(m => eligible(m) && (m.role === 'user' ? accepted.has(m.messageId)
  : m.visibility === 'internal' && m.mode === 'live' ? terminalLive.has(m.attemptId!) : completed.has(m.attemptId!)));
```

- [ ] **Retain current live partial on interrupted reconciliation.** In `interruptAttempt`, spread the original input's classification into the partial assistant append:

```typescript
...(input?.visibility === 'internal' && input.mode === 'live' ? { visibility: 'internal' as const, mode: 'live' as const } : {}),
```

The current attempt has not yet transitioned terminal when `acceptedHistory` runs. Before building its manifest, read the now-written partial and include it explicitly only for live input when `eligible({...partial, completionStatus: status})` and not already present:

```typescript
const livePartial = input?.visibility === 'internal' && input.mode === 'live'
  ? await p.messages.get(a.userId, a.sessionId, outputId(a)) : null;
if (livePartial && !targetRecords.some(m => m.messageId === livePartial.messageId)) targetRecords.push(livePartial);
```

Text partial eligibility remains unchanged. No generated text is copied into manifests; P2 projects delivery when materializing the next prompt.

- [ ] **Add saved-result classification validation** to `checkedResult`'s existing invalid condition in `finalization.ts`:

```typescript
|| (input.visibility === 'internal' && input.mode === 'live'
  ? r.assistant.visibility !== 'internal' || r.assistant.mode !== 'live'
  : r.assistant.visibility === 'internal' || r.assistant.mode === 'live')
```

This rejects a fabricated voice result published as visible text (and vice versa), while legacy records lacking mode/visibility remain valid text. It does not mutate old checkpoints or add new graph channels.

- [ ] **Verify:** `npm test -- test/runtime/voice-history.spec.ts test/context/voice-context.spec.ts`, `npm run build`.

#### 4B. Public status/cancel/retry/SSE cannot reach internal turns

- [ ] **Add these runtime methods**, keeping the current status body in a renamed private `turnStatus`:

```typescript
private async visibleTurn(u: string, s: string, t: string) {
  if (u !== this.d.config.identity.userId) throw new AppError('NOT_FOUND', 'Turn not found.');
  const a = await latestAttempt(this.d.persistence, u, s, t);
  const input = await this.d.persistence.messages.get(u, s, a.causal.userMessageId);
  if (!input || input.visibility === 'internal') throw new AppError('NOT_FOUND', 'Turn not found.');
  return a;
}
async getTurnStatus(u: string, s: string, t: string) {
  await this.visibleTurn(u, s, t); return this.turnStatus(u, s, t);
}
async getLiveTurnStatus(u: string, s: string, t: string, reservation: ExecutionReservation) {
  this.reservations.assertLive(reservation, this.identity({ userId: u, openRouterUser: u, source: 'server-configured' }), s);
  const a = await latestAttempt(this.d.persistence, u, s, t);
  const input = await this.d.persistence.messages.get(u, s, a.causal.userMessageId);
  if (!input || input.visibility !== 'internal' || input.mode !== 'live') throw new AppError('NOT_FOUND', 'Turn not found.');
  return this.turnStatus(u, s, t);
}
async findLiveSubmission(c: SubmitLiveTurn) {
  const id = this.identity(c.identity), s = sessionIdFor(id.userId, c.sessionId, c.idempotencyKey);
  this.reservations.assertLive(c.reservation, id, s);
  const a = await this.d.persistence.metadata.getAttemptByIdempotency(id.userId, s, c.idempotencyKey);
  if (!a) return null;
  const input = await this.d.persistence.messages.get(id.userId, s, a.causal.userMessageId);
  if (!input || input.visibility !== 'internal' || input.mode !== 'live' || input.content !== c.content)
    throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'This request identity has different input.');
  if (!await this.d.persistence.metadata.getAcceptance(id.userId, s, a.attemptId))
    throw new AppError('NOT_READY', 'Voice acceptance needs recovery.');
  return responseFor(a);
}
```

Rename the existing `cancelTurn` body to private `cancelOwnedTurn`; expose public and internal wrappers:

```typescript
async cancelTurn(c: CancelTurnCommand): Promise<void> {
  const id = this.identity(c.identity); await this.visibleTurn(id.userId, c.sessionId, c.turnId);
  return this.cancelOwnedTurn(c);
}
cancelLiveTurn(c: CancelTurnCommand, reservation: ExecutionReservation): Promise<void> {
  try {
    const id = this.identity(c.identity); this.reservations.assertLive(reservation, id, c.sessionId);
    const active = this.work.get(id.userId, c.sessionId);
    if (active) { active.abort('CANCELLED'); return this.cancelOwnedTurn(c); }
    return this.getLiveTurnStatus(id.userId, c.sessionId, c.turnId, reservation).then(status => {
      if (status.attemptId !== c.attemptId) throw new AppError('CONFLICT_ACTIVE_TURN', 'This attempt is no longer current.');
      return this.cancelOwnedTurn(c);
    });
  } catch (error) { return Promise.reject(error); }
}
```

`cancelLiveTurn` has no leading await: generation and late-token rejection are immediate, while its returned promise is only cancellation/reconciliation acknowledgment. The idle branch checks internal mode and the matching attempt before cancellation. An active live capability can only be running a live attempt because every execution entry verifies mode and the reservation.

In `acceptRetry`, reject `original.visibility === 'internal'` with `NOT_FOUND` before duplicate replay. In runtime `executeTurn`'s interruption catch, use private `turnStatus` rather than public `getTurnStatus`, since it must finalize internal turns without leaking them. Public `ChatStreamTransport.open` already calls public status before constructing its SSE writer; retain that order so known internal IDs fail before headers or delta events.

#### 4C. Pending delivery after restart must become explicit unknown

- [ ] **Add recovery helper code** to `backend/src/chat-runtime/reconciliation.ts`. Import `randomUUID`, `voiceDeliveryRecordSchema`, and `attemptsFor`, then add:

```typescript
export async function hasPendingVoiceDelivery(p: PersistenceBundle, u: string, s: string) {
  // ponytail: <=100 pages x 50 attempts, one scoped read each; add a filtered metadata query if the conversation ceiling grows.
  for (const a of await attemptsFor(p, u, s)) {
    const delivery = await p.metadata.getVoiceDelivery(u, s, a.attemptId);
    if (delivery?.status === 'pending') return true;
  }
  return false;
}
export async function reconcileVoiceDeliveries(p: PersistenceBundle, lease: ExecutionLease, job: Work) {
  for (const a of await attemptsFor(p, lease.userId, lease.sessionId)) {
    const input = await p.messages.get(a.userId, a.sessionId, a.causal.userMessageId);
    if (input?.visibility !== 'internal' || input.mode !== 'live') continue;
    const assistant = await p.messages.get(a.userId, a.sessionId, outputId(a));
    const old = await p.metadata.getVoiceDelivery(a.userId, a.sessionId, a.attemptId);
    if (!old) {
      if (assistant) throw new AppError('NOT_READY', 'Voice delivery evidence is unavailable.');
      continue; // Acceptance crashed before inference/delivery start: no assistant/audio exists.
    }
    if (old.status !== 'pending') continue;
    if (!terminal(a.status)) throw new AppError('NOT_READY', 'Voice generation needs reconciliation first.');
    const generated = assistant?.content ?? old.textGenerated;
    if (!generated.startsWith(old.textGenerated)) throw new AppError('NOT_READY', 'Voice result and delivery disagree.');
    const recovered = voiceDeliveryRecordSchema.parse({ ...old, textGenerated: generated, status: 'unknown',
      eventId: randomUUID(), sequence: old.sequence + 1, updatedAt: new Date().toISOString(),
      textSpoken: old.textSpoken, textRemaining: old.textSpoken === null ? null : generated.slice(old.textSpoken.length) });
    if (!await job.wait(p.owner.run(lease, () => p.metadata.compareVoiceDelivery(recovered, old.sequence)),
      p.metadata.budgets.persistenceTimeoutMs)) throw new AppError('CONFLICT_ACTIVE_TURN', 'Voice recovery evidence changed.');
  }
}
```

Preserve any known spoken prefix rather than erasing monotonic evidence. P2's `unknown` context projection remains deliberately conservative. Missing record plus an assistant is an invariant violation, not permission to invent socket/session IDs. The producer starts delivery before inference, so that case must fail closed.

- [ ] **Integrate recovery using the existing lease**, not an independently acquired owner. Import the helpers into runtime. Its early quiescent return becomes:

```typescript
if (session.execution.activeAttemptId === null && session.execution.ownerId === null && !pendingRebase &&
  !await hasPendingVoiceDelivery(p, u, s)) return;
```

After the existing generation/result reconciliation branch finishes, call `reconcileVoiceDeliveries(p, lease, job)` before releasing ownership. Specifically replace `if (!aId) return` with:

```typescript
if (!aId) { await reconcileVoiceDeliveries(p, lease, job); return; }
```

Call it after sealed publication, terminal slot clearing, and `interruptAttempt` paths, but not after a thrown incompatible-state error. The existing `finishRebase` branch need not alter delivery; it must not bypass pending delivery if rebasing and pending delivery coexist—call the same helper there after rebase completion. Only stopped/authorized executor recovery is admitted.

#### 4D. Recovery failure-window tests

- [ ] **Write `backend/test/runtime/voice-recovery.native.e2e-spec.ts`:**

```typescript
import { expect, it, vi } from 'vitest';
import { voiceRuntimeHarness } from './voice-runtime-harness.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { archiveRecords } from '../../src/chat-runtime/history.js';
it('restores a sealed live result and pending delivery after archive failure without reinference', async () => {
  const h = await voiceRuntimeHarness();
  try {
    const reservation = await h.runtime.reservations.acquire({ identity: h.identity, conversationId: 's1',
      owner: { kind: 'live', voiceSessionId: 'v1' } });
    const ids = await h.runtime.submitLiveTurn({ identity: h.identity, sessionId: 's1', content: 'SECRET input',
      idempotencyKey: 'voice-request-0001', reservation });
    let generated = '';
    const append = h.persistence.messages.append.bind(h.persistence.messages);
    const broken = vi.spyOn(h.persistence.messages, 'append').mockImplementation(async message => {
      if (message.role === 'assistant') throw new Error('fixture crash before archive'); return append(message);
    });
    await expect(h.runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
      emit: async () => undefined, live: { reservation,
        start: async (a, write) => { await write(voiceDeliveryRecordSchema.parse({ ...deliveryFixture(),
          userId: a.userId, sessionId: a.sessionId, turnId: a.turnId, attemptId: a.attemptId,
          voiceSessionId: 'v1', textGenerated: '', status: 'pending', textSpoken: null, textRemaining: null,
          audioDurationMs: null, audioPlayedMs: null, playedSamples: null })); },
        delta: async text => { generated += text; }, finish: async () => undefined,
        settle: async () => { throw new Error('fixture process stopped before delivery settlement'); },
      } })).rejects.toThrow();
    broken.mockRestore();
    expect(generated).toBe('Hello 🌍'); expect(h.fetcher).toHaveBeenCalledTimes(1);
    const restarted = new DurableChatRuntime(h.deps);
    await restarted.reconcileSession(h.identity.userId, ids.sessionId);
    await restarted.reconcileSession(h.identity.userId, ids.sessionId);
    const raw = await archiveRecords(h.persistence, h.identity.userId, ids.sessionId);
    expect(raw.map(m => [m.role, m.visibility])).toEqual([['user', 'internal'], ['assistant', 'internal']]);
    expect(raw[1]?.content).toBe(generated);
    expect(await h.persistence.metadata.getVoiceDelivery(h.identity.userId, ids.sessionId, ids.attemptId))
      .toMatchObject({ status: 'unknown', textGenerated: generated, textSpoken: null });
    const next = await restarted.submitTurn({ identity: h.identity, sessionId: ids.sessionId, content: 'Follow up',
      idempotencyKey: 'text-request-0002' });
    await restarted.executeTurn({ userId: h.identity.userId, ...next, signal: new AbortController().signal, emit: async () => undefined });
    expect(h.fetcher).toHaveBeenCalledTimes(2); // One original inference plus the explicit new follow-up.
    const body = JSON.parse(String(h.fetcher.mock.calls[1]?.[1]?.body)) as { messages: { content: string }[] };
    expect(body.messages.some(m => m.content === generated)).toBe(false);
    expect(body.messages.some(m => m.content.includes('delivery is unknown'))).toBe(true);
    expect(body.messages.filter(m => m.content === 'Follow up')).toHaveLength(1);
  } finally { await h.close(); }
}, 30000);
```

The explicit nulls in the seed document zero-generation pending evidence, not proof of playback.

- [ ] **Run RED before 4C implementation:** `npm run test:e2e -- test/runtime/voice-recovery.native.e2e-spec.ts`. Expected pending/mismatched delivery or generated full-answer history, not a paid provider call. Run after implementing 4A–4C for GREEN.
- [ ] **Verify interruption and recovery together:** `npm test -- test/runtime/voice-history.spec.ts test/voice/agent`, `npm run test:e2e -- test/runtime/voice-recovery.native.e2e-spec.ts test/runtime/recovery.native.e2e-spec.ts`, `npm run build`, `npm run lint`. Record actual native pass counts separately from blocked tests.
- [ ] **Commit Tasks 3–4 together only after the cross-task runtime types compile**, using explicit owner paths:

```powershell
git add backend/src/voice/agent/agent-voice-adapter.ts backend/src/voice/agent/speech-prose.ts backend/src/voice/agent/voice-delivery.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/src/chat-runtime/ports.ts backend/src/chat-runtime/history.ts backend/src/chat-runtime/reconciliation.ts backend/src/chat-runtime/finalization.ts backend/test/voice/agent/speech-prose.spec.ts backend/test/voice/agent/voice-delivery.spec.ts backend/test/runtime/voice-history.spec.ts backend/test/runtime/voice-recovery.native.e2e-spec.ts
git commit -m "feat(voice): fence speech delivery and recover interrupted shared execution"
```

### Task 5: Agent Bridge & Exclusion Integration Tests

**Files:** Create `backend/test/voice/agent/bridge.native.e2e-spec.ts`; make only regression-proven P6-owned corrections to the runtime/adapter/delivery implementation. Do not move these tests into P11's integrated-evaluation ownership.

#### 5A. Real runtime + persistence + HTTP + P5 lifecycle, deterministic speech

- [ ] **Write this complete fixture and failing integration tests** in `bridge.native.e2e-spec.ts`. Speech fakes are P5's existing typed ports; MongoDB/checkpoints/runtime/HTTP/flow are real. New fixtures do not claim to test microphone hardware or Deepgram performance.

```typescript
import { expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { voiceRuntimeHarness } from '../../runtime/voice-runtime-harness.js';
import { httpHarness } from '../../http/http-harness.js';
import { fixtureOptions } from '../../http/fixtures.js';
import { options, origin, request, fakeStt, fakeTts } from '../session/fixtures.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { LiveFlow } from '../../../src/voice/session/live-flow.js';
import type { VoiceSink } from '../../../src/voice/session/voice-session.options.js';
import { AgentVoiceAdapter } from '../../../src/voice/agent/agent-voice-adapter.js';
import { ServerIdentityResolver } from '../../../src/platform/identity/server-identity-resolver.js';
import { attemptsFor } from '../../../src/chat-runtime/history.js';
import { chunk, usage as modelUsage, done } from '../../fixtures/openrouter/frames.js';
const speechUsage = { providerRequestId: 'fixture-tts', model: 'fixture', modelVersion: 'fixture-v1',
  audioMs: 100, billableCharacters: 12 };
async function fixture() {
  const h = await voiceRuntimeHarness(chunk('Hello world. ') + chunk('', 'stop') + modelUsage + done);
  const o = options(), identityResolver = new ServerIdentityResolver(h.deps.config); o.identity = identityResolver;
  o.sessions = h.persistence.sessions; o.reservations = h.runtime.reservations;
  const sessions = new VoiceSessionService(o);
  const created = await sessions.create({ ...request, mode: 'live' }, origin);
  const context = sessions.claim(created.cookie.split(';')[0], origin), stt = fakeStt(), tts = fakeTts();
  let outputSamples = 0;
  const sink: VoiceSink = { outputSamples: () => outputSamples, event: vi.fn(),
    audio: vi.fn((_ref, pcm) => { outputSamples += pcm.byteLength / 2; }), invalidate: vi.fn(), finish: vi.fn() };
  const bridge = new AgentVoiceAdapter(h.runtime, (v, s) => sessions.bindConversation(v, s));
  const signal = new AbortController();
  const flow = await LiveFlow.open(context, sink, signal.signal, { stt: stt.port, tts: tts.port,
    hooks: bridge.hooks, usage: o.usage });
  bridge.attach(context, flow, sink); context.cleanup = () => flow.close(); flow.start();
  const api = await httpHarness({ ...fixtureOptions(), identity: identityResolver, sessions: h.persistence.sessions,
    messages: h.persistence.messages, runtime: h.runtime, budgets: h.deps.config.budgets,
    executionReservations: h.runtime.reservations });
  const control = (payload: import('../../../src/contracts/voice-wire.js').VoiceClientPayload) => ({
    protocolVersion: 1 as const, sessionId: context.response.sessionId, connectionEpoch: context.response.connectionEpoch,
    eventId: 'fixture-control', sequence: 1, ...payload });
  return { ...h, sessions, context, stt, tts, sink, bridge, flow, api, control,
    async cleanup() { await flow.close(); await sessions.drain(); await api.close(); await h.close(); } };
}
async function started(f: Awaited<ReturnType<typeof fixture>>, text = 'SECRET voice input') {
  f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'provider:0', text });
  await vi.waitFor(() => expect(f.tts.connection.speak).toHaveBeenCalled());
  const ref = f.bridge.currentResponse(); if (!ref) throw new Error('Expected active response');
  f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
  f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
  await vi.waitFor(() => expect(f.sink.audio).toHaveBeenCalled());
  await vi.waitFor(async () => expect((await attemptsFor(f.persistence, f.identity.userId,
    f.context.response.conversationId!))[0]?.status).toBe('completed'));
  return ref;
}
it('rejects competing text submit/retry and hides live status, stream and transcript paths', async () => {
  const f = await fixture();
  try {
    const ref = await started(f), s = f.context.response.conversationId!;
    await supertest(f.api.url).post(`/api/sessions/${s}/turns`)
      .send({ sessionId: s, content: 'Text collision', idempotencyKey: 'text-request-0001' }).expect(409);
    await supertest(f.api.url).post(`/api/sessions/${s}/turns/${ref.turnId}/retry`)
      .send({ idempotencyKey: 'text-retry-0001' }).expect(409);
    const paths = [`/api/sessions/${s}/turns/${ref.turnId}`, `/api/sessions/${s}/turns/${ref.turnId}/stream`];
    for (const path of paths) { const result = await supertest(f.api.url).get(path).expect(404);
      expect(JSON.stringify(result.body)).not.toMatch(/SECRET|Hello world|speech-1/); }
    const activeAttempt = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
    await supertest(f.api.url).post(`/api/sessions/${s}/turns/${ref.turnId}/cancel`)
      .send({ attemptId: activeAttempt.attemptId }).expect(404);
    const messages = await supertest(f.api.url).get(`/api/sessions/${s}/messages`).expect(200);
    const navigation = await supertest(f.api.url).get('/api/sessions').expect(200);
    expect(JSON.stringify([messages.body, navigation.body])).not.toMatch(/SECRET|Hello world/);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage: speechUsage });
    await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
    await vi.waitFor(() => expect(f.bridge.currentResponse()).toBeNull());
  } finally { await f.cleanup(); }
}, 30000);
it('barge-in cancels once, drops late audio and corrects the next prompt to heard content', async () => {
  const f = await fixture();
  try {
    const ref = await started(f), s = f.context.response.conversationId!;
    await f.flow.control(f.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 }));
    f.tts.events.push({ type: 'speech-interrupted', ...ref, speechId: 'speech-1', audioPlayedMs: 50,
      textSpoken: 'Hello', textRemaining: ' world.', usage: speechUsage });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    await vi.waitFor(() => expect(f.bridge.currentResponse()).toBeNull());
    const first = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
    expect(await f.persistence.metadata.getVoiceDelivery(f.identity.userId, s, first.attemptId))
      .toMatchObject({ status: 'interrupted', textGenerated: 'Hello world.', textSpoken: 'Hello', textRemaining: ' world.' });
    expect(f.sink.audio).toHaveBeenCalledTimes(1);
    expect(f.tts.connection.interrupt).toHaveBeenCalledTimes(1);
    f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'provider:1', text: 'Continue.' });
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String(f.fetcher.mock.calls[1]?.[1]?.body)) as { messages: { role: string; content: string }[]; user: string };
    expect(body.user).toBe(f.identity.userId);
    expect(body.messages.filter(m => m.content === 'Continue.')).toHaveLength(1);
    expect(body.messages.filter(m => m.role === 'assistant')).toEqual([{ role: 'assistant', content: 'Hello' }]);
  } finally { await f.cleanup(); }
}, 30000);
it('completed generated state survives reconnect without automatic inference or TTS replay', async () => {
  const f = await fixture();
  try {
    const ref = await started(f), s = f.context.response.conversationId!;
    f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage: speechUsage });
    await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
    await vi.waitFor(() => expect(f.bridge.currentResponse()).toBeNull());
    const before = vi.mocked(f.tts.connection.speak).mock.calls.length;
    await f.flow.close(); await f.runtime.reconcileSession(f.identity.userId, s); await f.runtime.reconcileSession(f.identity.userId, s);
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.tts.connection.speak).toHaveBeenCalledTimes(before);
    const first = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
    expect(first.status).toBe('completed');
    expect(await f.persistence.metadata.getVoiceDelivery(f.identity.userId, s, first.attemptId))
      .toMatchObject({ status: 'completed', textSpoken: 'Hello world.' });
  } finally { await f.cleanup(); }
}, 30000);
```

`sessions.claim` already returns P5's exported `VoiceBinding`, so assigning `cleanup` compiles without widening `SessionContext`. Run integration tests on a fully implemented P5 fixture; its connection methods preserve the typed `vi.fn` seams.

- [ ] **Run RED:** `npm run test:e2e -- test/voice/agent/bridge.native.e2e-spec.ts`. Run each test separately with `-t`. Expected initial failures are integration semantics (wrong mode guard, visible internal status, retained full assistant context, timing races), not absent native configuration.

#### 5B. Minimal corrections exposed by the integration suite

The following are explicit regression-driven small edits, not a license to modify P5 or redesign execution:

- [ ] **Close the adapter's acceptance/active-promise race.** `run()` currently begins asynchronously before storing `active.done`. Add one bridge-local pending-turn promise and assign it synchronously in `finalized`, so a second completed input waits from **acceptance through delivery**. Do not coalesce two different transcripts, start another inference while the prior lease is held, or allow disconnect cleanup to miss an in-flight acceptance. Add these exact fields:

```typescript
private running: Promise<void> = Promise.resolve();
private acceptingTurn = false;
```

In `finalized`, replace the `const promise = this.run(...)` assignment with:

```typescript
if (this.acceptingTurn) return Promise.reject(new VoiceSessionError('CONFLICT_ACTIVE_TURN'));
this.acceptingTurn = true;
const promise = this.running.then(() => this.run(c, input, signal)).finally(() => { this.acceptingTurn = false; });
this.running = promise;
```

In `disconnected`, after synchronously setting `closed`/invalidating/aborting, await `this.running.catch(() => undefined)` before `reconcileSession`. This must not deadlock with the TTS reader: queued evidence delivery remains independent of `finalized`, and settlement has a finite 2-second deadline. P5 already supplies a single bounded pending finalized input; do not add an unbounded queue here. Repeated finalized input hits `submitted` first and joins its original promise.

- [ ] **Avoid early bridge cancellation response while generation is still settling.** Keep `hooks.interrupt` as prompt acknowledgment (no `await active.done` inside the P5 TTS consumer), but the next `finalized` waits on the preceding execution promise. Store/handle every promise rejection; a persistence failure rejects the bridge, never becomes an automatic retry.
- [ ] **Handle terminal delivery failure honestly.** After `executeTurn` returns, read the existing delivery record via a narrow optional bridge `deliveryStatus` reader supplied from runtime rather than direct writes. Prefer a runtime method with exact scope validation:

```typescript
async getLiveDelivery(u: string, s: string, a: string, reservation: ExecutionReservation) {
  this.reservations.assertLive(reservation, this.identity({ userId: u, openRouterUser: u, source: 'server-configured' }), s);
  return this.d.persistence.metadata.getVoiceDelivery(u, s, a);
}
```

Replace the bridge runtime declaration with the following final type, and include `!this.runtime.getLiveDelivery` in `attach`'s existing required-method condition. The submission-only fixture remains supported until attached:

```typescript
type VoiceBridgeRuntime = Pick<DurableChatRuntime, 'submitLiveTurn'> & Partial<Pick<DurableChatRuntime,
  'executeTurn' | 'cancelLiveTurn' | 'reconcileSession' | 'getLiveTurnStatus' | 'findLiveSubmission' | 'getLiveDelivery'>>;
```

In `run`, after `await active.done`, check:

```typescript
const delivery = await this.runtime.getLiveDelivery!(c.identity.userId, ids.sessionId, ids.attemptId, c.reservation!);
if (delivery?.status === 'unknown' || delivery?.status === 'failed') throw new VoiceSessionError('VOICE_DELIVERY_UNKNOWN');
if (!delivery?.textGenerated && !active.invalid) throw new VoiceSessionError('VOICE_AGENT_FAILED');
```

This makes P5 surface an operational recovery error instead of silently continuing with unavailable delivery evidence. A purely structured/unsupported answer offers return to chat through P5's operational error/recovery event rather than leaving a prepared response stuck with no audio. An intentionally interrupted zero-output turn remains listening. Generation success remains preserved; it does not trigger inference replay. Do not emit transcript/assistant text in the error.
- [ ] **Fix the synthesis/playback race in producer settlement**, if exact-progress-before-metadata ordering fails: `proof()` already reads current samples when `speech-completed` arrives; do not demand a second playback report. Leave full playback equality exact; never promote P5's <1ms transport tolerance into a durable completion assertion.

#### 5C. Additional exact race checks before declaring P6 complete

- [ ] **Append this deterministic mid-generation interruption regression**. Unlike `started`, it deliberately keeps the model stream open after the first safe prose delta:

```typescript
it('mid-generation barge-in archives an internal partial and never forwards late model tokens', async () => {
  const f = await fixture(); let source!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  f.fetcher.mockImplementationOnce(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { source = c;
    c.enqueue(encoder.encode(chunk('Hello. '))); } }), { headers: { 'content-type': 'text/event-stream' } }));
  try {
    f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'provider:0', text: 'SECRET slow answer' });
    await vi.waitFor(() => expect(f.tts.connection.speak).toHaveBeenCalledTimes(1));
    const ref = f.bridge.currentResponse(); if (!ref) throw new Error('Expected running response');
    const s = f.context.response.conversationId!;
    expect((await attemptsFor(f.persistence, f.identity.userId, s))[0]?.status).toBe('generating');
    f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'speech-1' });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    await vi.waitFor(() => expect(f.sink.audio).toHaveBeenCalledTimes(1));
    await f.flow.control(f.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 }));
    f.tts.events.push({ type: 'speech-interrupted', ...ref, speechId: 'speech-1', audioPlayedMs: 50,
      textSpoken: 'Hello', textRemaining: '.', usage: speechUsage });
    try { source.enqueue(encoder.encode(chunk('Late secret sentence. ') + chunk('', 'stop') + modelUsage + done)); source.close(); }
    catch { /* The reader may already have cancelled the fixture stream. */ }
    await vi.waitFor(() => expect(f.bridge.currentResponse()).toBeNull());
    const a = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
    expect(a.status).toBe('cancelled');
    expect(await f.persistence.metadata.getVoiceDelivery(f.identity.userId, s, a.attemptId))
      .toMatchObject({ status: 'interrupted', textGenerated: 'Hello.', textSpoken: 'Hello', textRemaining: '.' });
    const manifest = await f.persistence.memory.get(f.identity.userId, s);
    const originals = await f.persistence.messages.getReferences(f.identity.userId, s, manifest!.messageRefs);
    expect(originals.find(m => m.role === 'assistant')).toMatchObject({ content: 'Hello.', visibility: 'internal', mode: 'live' });
    expect(f.tts.connection.speak).toHaveBeenCalledTimes(1); expect(f.fetcher).toHaveBeenCalledTimes(1);
  } finally { await f.cleanup(); }
}, 30000);
```

- [ ] **Append this prose/privacy and duplicate-EndOfTurn regression** to the same native integration file:

```typescript
it('archives only filtered generated prose and duplicate finalized input never launches inference twice', async () => {
  const f = await fixture();
  f.fetcher.mockImplementationOnce(async () => new Response(
    chunk('<think>private one. private two.</think>\n**Hello world.**\n') + chunk('', 'stop') + modelUsage + done,
    { headers: { 'content-type': 'text/event-stream' } }));
  try {
    const ref = await started(f), s = f.context.response.conversationId!;
    f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'provider:0', text: 'SECRET voice input' });
    expect(vi.mocked(f.tts.connection.speak).mock.calls.map(([c]) => c.text).join('')).toBe('Hello world.');
    f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'speech-1', audioDurationMs: 100, usage: speechUsage });
    await f.flow.control(f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 }));
    await vi.waitFor(() => expect(f.bridge.currentResponse()).toBeNull());
    const attempts = await attemptsFor(f.persistence, f.identity.userId, s);
    expect(attempts).toHaveLength(1); expect(f.fetcher).toHaveBeenCalledTimes(1);
    const manifest = await f.persistence.memory.get(f.identity.userId, s);
    const originals = await f.persistence.messages.getReferences(f.identity.userId, s, manifest!.messageRefs);
    expect(originals.find(m => m.role === 'assistant')?.content).toBe('Hello world.');
    expect(JSON.stringify(originals)).not.toContain('private one');
    expect(JSON.stringify(vi.mocked(f.sink.event).mock.calls)).not.toMatch(/SECRET|Hello world|private one/);
  } finally { await f.cleanup(); }
}, 30000);
```

- [ ] **Append this mid-generation StartOfTurn regression** to the same native integration file. It exercises cancellation while thinking, before any TTS text:

```typescript
it('StartOfTurn aborts thinking before first prose and late provider tokens cannot reach speech', async () => {
  const f = await fixture();
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  f.fetcher.mockImplementationOnce(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { source = c; } }),
    { headers: { 'content-type': 'text/event-stream' } }));
  try {
    f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'provider:0', text: 'SECRET slow turn' });
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));
    expect(f.bridge.currentResponse()).not.toBeNull();
    f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'provider:1' });
    await vi.waitFor(() => expect(f.sink.invalidate).toHaveBeenCalled());
    try { source.enqueue(encoder.encode(chunk('Must not be spoken. ') + chunk('', 'stop') + modelUsage + done)); source.close(); }
    catch { /* The fixture reader may already have been cancelled. */ }
    await vi.waitFor(() => expect(f.bridge.currentResponse()).toBeNull());
    expect(f.tts.connection.speak).not.toHaveBeenCalled();
    const s = f.context.response.conversationId!, a = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
    expect(['cancelled', 'interrupted']).toContain(a.status);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  } finally { await f.cleanup(); }
}, 30000);
```

- [ ] **Append a reverse-collision check** to `voice-acceptance.native.e2e-spec.ts`:

```typescript
it('live admission rejects an accepted text attempt even between HTTP acceptance and stream attach', async () => {
  const h = await voiceRuntimeHarness();
  try {
    const ids = await h.runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Visible text', idempotencyKey: 'text-request-0001' });
    await expect(h.runtime.reservations.acquire({ identity: h.identity, conversationId: ids.sessionId,
      owner: { kind: 'live', voiceSessionId: 'v1' } })).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
    expect(h.fetcher).not.toHaveBeenCalled();
    await h.runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal, emit: async () => undefined });
    const live = await h.runtime.reservations.acquire({ identity: h.identity, conversationId: ids.sessionId,
      owner: { kind: 'live', voiceSessionId: 'v1' } });
    await h.runtime.reservations.release({ identity: h.identity, reservationId: live.reservationId });
    expect((await h.persistence.sessions.get(h.identity.userId, ids.sessionId))?.title).toBe('Visible text');
  } finally { await h.close(); }
}, 30000);
```

- [ ] **Run final owner verification** with actual discovered tests:

```powershell
npm test -- test/voice/agent test/runtime/voice-history.spec.ts test/runtime/execution-reservations.spec.ts test/http/voice-exclusion.spec.ts
npm test -- test/voice/session test/voice/providers test/context test/http test/runtime
npm run test:e2e -- test/voice/agent/bridge.native.e2e-spec.ts test/runtime/voice-acceptance.native.e2e-spec.ts test/runtime/voice-recovery.native.e2e-spec.ts test/runtime/recovery.native.e2e-spec.ts
npm run build
npm run lint
```

Run commands individually; do not chain them with shell separators. Native checks are prerequisites to verified P6 completion, not optional passes. Report absent operator database as blocked and ask the orchestrator not to mark the worker verified. Routine tests must still pass. Native fixtures certify admitted native topology only; Azure compatibility, provider availability, browser/device behavior, cost and latency remain P11/operator evidence.

- [ ] **Commit regression-tested owner files explicitly:**

```powershell
git add backend/test/voice/agent/bridge.native.e2e-spec.ts backend/test/runtime/voice-acceptance.native.e2e-spec.ts backend/src/voice/agent/agent-voice-adapter.ts backend/src/voice/agent/voice-delivery.ts backend/src/chat-runtime/durable-chat-runtime.ts
git commit -m "test(voice): verify shared execution interruption and checkpoint recovery"
```

## Worker handoff and completion evidence

Return to the orchestrator:

- Exact P6 implementation commit list and upstream P5 handoff commit(s), plus any remaining ownership blockers. Do not update the orchestrator-owned workflow state yourself.
- Actual red/green counts, build/lint outcomes, native fixture topology and blocked/skipped checks without credential output. Do not claim code snippets or an empty/absent suite are verification.
- P10 composition recipe: instantiate **one existing runtime**, pass its `reservations` to P5 and HTTP, create one `AgentVoiceAdapter` per live connection, open `LiveFlow` with `bridge.hooks`, then `bridge.attach(context, flow, sink)` before starting it. Bind through `VoiceSessionService.bindConversation`. Supply P2 metadata to the existing context assembler. Do not construct another persistence bundle/model/runtime or close owner.
- P9 operational handoff: live cleanup can wait for model cancellation and bounded delivery settlement; late/unknown delivery stays explicitly unknown. Admission remains degraded after unconfirmed persistence. Cancellation is best effort and does not guarantee charge prevention or exactly-once provider billing.
- P8 consumes only P5 operational/audio events; there are no live transcript/delta browser messages. P11 measures real echo/interruption/latency/devices and repeats no-reinference/reconnect/hidden-text integration across actual transport.

## Acceptance/self-consistency checklist

- [ ] A1: visible text acceptance/retry/cancel/status/SSE bytes and existing history behavior preserved; only same-conversation live ownership adds 409 conflicts.
- [ ] V1/V2/A8: finalized nonempty input only, same identity/model/runtime, accepted input saved once, current input appears once after restored checkpoint.
- [ ] V3/A7/A13: reasoning/tool/JSON/code/Markdown syntax never synthesized or leaked to browser; neutral navigation and all text status/stream/cancel/retry paths reject internal turns.
- [ ] V4/V5/A9: thinking and speaking barge-in, immediate invalidation/abort, no late tokens/audio, actual played samples, normalized socket-wide offsets, interrupted/unknown delivery retained independently of generated completion.
- [ ] A11/A14: sealed result wins over cancellation; repeated reconciliation does not invoke inference or synthesis; pending delivery reconciles even with a cleared attempt slot; missing evidence fails closed.
- [ ] P2 contracts: generated prose equals stored assistant content, split text is a generated prefix, snapshots are bounded/CAS ordered, writes use the existing lease/journal and never run after release.
- [ ] P5 prerequisite follow-ups are tested/committed by P5; P6 does not silently change upstream interfaces or central composition.
- [ ] Auth/tools/confirmations/Aura/eager turns/multilingual/captions/deployment remain out of scope. Review remains skipped. Device/provider metrics are blocked/unrun until authorized measurements exist.

**Planner verification:** This artifact is an implementation plan, not implemented/tested voice support. Validate local document links, named source paths, exactly five task sections, matching types/method names, code-fence balance and whitespace before committing the plan. Application/native/provider checks above are worker commands and have not been run merely by writing this document.

On 8 October 2026, documentation assertions passed for five tasks, local links, balanced fences, absent code doc headers and unresolved-work markers. Sixteen complete import-bearing TypeScript example blocks passed syntax transpilation (not full type checking). In-memory checks of the illustrative prose filter passed arbitrary split positions, embedded hidden blocks/JSON, raw-code suppression and factual-value preservation; reservation and full-playback delivery examples also passed isolated illustrative checks. These do **not** constitute application, native MongoDB, provider, hardware or release verification. The prepared-response/STT-epoch P5 handoff remains an explicit worker prerequisite.
