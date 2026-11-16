# P5 Durable LangGraph Turn Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute one durably accepted input per session through LangGraph, stream honest lifecycle events, and recover saved answers without another inference or duplicated input.

**Architecture:** Keep P1's `AgentRuntime` unchanged and add a transport-independent, request-owned `executeTurn` method for P6. A small reference-state graph validates acceptance, generates once through P4, and seals a bounded public result; P2 guards checkpoint writes and application finalization. Reconciliation runs only after work is quiescent, repairs from a sealed result, or marks interrupted without replaying the graph.

**Tech Stack:** Existing TypeScript ESM/Node 24/NestJS host, Vitest 4, Zod 3, LangGraph 1.4.19, P2's guarded MongoDB saver/driver 6.21, P3 reference assembler, and P4 attempt-bound OpenRouter services. Relative imports use `.js`.

---

## Authority, prerequisites, and restrictions

- Sources: [goal](goal.md) §§6/8/9, AC02/08/09/10/11/12; [R1 research](research.md) §13; [state](state.md) P5 ownership/gate; [P1](plan1.md), [P2](plan2.md), [P3](plan3.md), [P4](plan4.md). Read upstream actual interfaces before implementation. P1 completed through `db763b6`, P2 through `ea46dd3`, P3 through `3362082`, P4 through `8ae8de7`. Approval is recorded in state; older awaiting-approval prose is not a new gate.
- Implementation ownership **only** `backend/src/agent/**`, `backend/src/chat-runtime/**`, `backend/test/runtime/**`. Planner writes/commits only this document. Do not edit upstream contracts/persistence/context/model, manifests, HTTP, operations, application entry points, or state. Request upstream defects through the orchestrator.
- Add the root-required descriptive headers to implementation `.ts` files before first write. This plan deliberately contains **no** TypeScript FILE-header block.
- Every code-changing step below supplies the implementation/test content; add imports from the displayed file blocks, not parallel replacement contracts. Test/code blocks omit headers only. Keep focused formatting on owned paths.
- All npm/npx commands run in `backend`; all Git commands run at repository root with the parent's serialized commit slot. Stage named files only. Unified review remains **skipped**, not passed.
- P2's native/intersection implementation is available, but R1 service identification, Azure activation/certification, and AC16 remain blocked. P5 native/deterministic work is ready; do not certify Azure or production from it. No deployment, infrastructure purchase, live inference, tools, summaries, compaction, or detached durable job service is authorized here.

## Locked interfaces and topology

| Existing boundary | Exact use |
| --- | --- |
| `AgentRuntime` | `submitTurn`, `retryTurn`, `cancelTurn`, `getTurnStatus`, `reconcileSession`; unchanged P1 signatures |
| P2 ownership | One shared bundle/object per database; `assertExecutor`, `acquire`, `reserveAttempt`, `allocateSequences`, `confirmAcceptance`, `run`, `renew`, `clearAttempt`, `release`, `drain`, `recoverStoppedSession` |
| P2 metadata | Immutable `putAttempt`; lifecycle via `compareAttempt(record, expectedStatus)`; `getAcceptance`, `getAccounting`, bounded `listAttempts` |
| P2 checkpoints | `(await checkpoints.create()).bind(lease)`; root `checkpoint_ns:''`; stock serialization; saver performs its own `owner.run` |
| P3 | `ContextAssembler.assemble({userId,sessionId,turnId,newUserInput})`; returned model projection used once; `buildReferenceManifest`, `eligible`, `validateInput`, `FixedAssets` reused |
| P4 | `createModelServices(config,limits,guardedMetadata,fetcher)` per executing lease; fresh adapter per attempt; early-ID CAS callback; scoped accounting snapshot and durable absolute snapshots |
| Stream | Existing `StreamEnvelope` version 1; `completed` event's `outcome` is **completed or truncated**, never treating the latter as ordinary success |

**Safety decisions:**

1. Enforce `single-process` and the durable executor sentinel. Never reacquire/take over merely because a lease expired. P8 controls verified stopped-process handoff; P5 has no public executor handoff operation.
2. `owner.run` guards each application write only. Never nest guarded operations or wrap `graph.invoke`, `graph.updateState`, saver calls, renewal, or the model inside `run`; these would deadlock P2's queue.
3. Use a 180,000 ms session lease (P2's hard ceiling), renewed by one awaited, non-overlapping heartbeat every 30,000 ms. Expiry or renewal failure aborts graph/provider work; no automatic takeover. Global run deadline uses configured `totalRunTimeoutMs`, including model/backpressure waits. P4 keeps its connect/first/idle timers; P5 does not multiply inference retries.
4. Every asynchronous write is tracked until settled even after a waiting deadline expires. A timeout is not cancellation of a MongoDB write. Stop admission and quarantine the session/process while unresolved work exists. Do not release executor/session ownership, report drained, or launch another graph until those promises settle and `owner.drain()` completes.
5. `submitTurn` only accepts and returns identifiers. It releases the temporary lease but retains `activeAttemptId`; P6 explicitly calls `executeTurn` under its stream request. No inference before stream attachment, no detached run. A never-attached accepted attempt becomes interrupted when P8 invokes quiescent reconciliation; it is never inferred by recovery.
6. `executeTurn` permits one stream executor; a second attachment conflicts. Other clients use durable status/archive, not a second graph or unbounded broadcast buffer. P6 drives backpressure through an awaited event sink. Stream sequence is attempt-local delivery order (starts at zero), **not** the archive's reserved session event sequence or durable replay cursor.
7. Disconnect/iterator/sink failure maps to **interrupted**, explicit cancel to **cancelled**, provider failure to **failed**, length to **truncated**. Once a sealed result exists, disconnect/cancel cannot discard it: finish/reconcile application finalization. Cancellation is best effort and has no exactly-once billing/charge-prevention promise.
8. Explicit retry is allowed for the latest logical turn only, in failed/cancelled/interrupted states, with an original accepted input/marker. Maximum **three durable attempts per logical turn**, separately from P4's bounded definitive-rejection dispatch retries. Completed/truncated outcomes are not regeneration. Reject retry of an older turn after another turn was accepted.

## File structure (all implementation paths P5-owned)

| Exact path | Responsibility |
| --- | --- |
| `backend/src/agent/state.ts` | Strict bounded public graph input/result schemas and manifest digests |
| `backend/src/agent/turn-graph.ts` | Reference-only prepare/generate/seal graph, sync invocation and state-update port |
| `backend/src/chat-runtime/identity.ts` | Deterministic scoped session/turn/attempt/message/event recipes, title/response |
| `backend/src/chat-runtime/ports.ts` | Local structural projections of existing P1/P2/P4 types, request-owned execution/drain exports |
| `backend/src/chat-runtime/history.ts` | Bounded full-archive verification and latest-turn attempt discovery |
| `backend/src/chat-runtime/work.ts` | Session admission, linked abort/deadline, tracked promises, heartbeat/quarantine |
| `backend/src/chat-runtime/finalization.ts` | Saved-result publication, accounting, manifest/checkpoint alignment, terminal commit |
| `backend/src/chat-runtime/reconciliation.ts` | Quiescent recovery and interrupted fallback, never inference |
| `backend/src/chat-runtime/durable-chat-runtime.ts` | Acceptance, stream execution, explicit cancel/retry, durable status |
| `backend/src/chat-runtime/index.ts` | Public factory/types; no central Nest wiring |
| `backend/src/chat-runtime/README.md` | P6/P8 usage, topology/crash policy, actual worker evidence |
| `backend/test/runtime/identity.spec.ts` | Scope/idempotency/Unicode title assertions |
| `backend/test/runtime/graph.spec.ts` | Real LangGraph with MemorySaver; no transcript/replay; terminal proof |
| `backend/test/runtime/work.spec.ts` | Deadline/heartbeat/quarantine fake-clock tests |
| `backend/test/runtime/native-harness.ts` | Actual P2 repositories and fake P4 fetch; isolated native DB |
| `backend/test/runtime/acceptance.native.e2e-spec.ts` | Acceptance ordering, duplicate/change/concurrent/retry/orphan evidence |
| `backend/test/runtime/lifecycle.native.e2e-spec.ts` | Application events, failure/length/cancel/disconnect/status |
| `backend/test/runtime/recovery.native.e2e-spec.ts` | Crash-window faults, saved-result/no-result recovery, repeated recovery |
| `backend/test/runtime/operations.native.e2e-spec.ts` | Stop/drain/stale owner/version/history disagreement assertions |

## State and durability protocol

Graph channels replace values; **no messages reducer**. `input` is only the new attempt/original-message reference and reserved output sequence. `boundary` is `{contextVersion, manifestHash}` for the last application-committed eligible history. `result` is one bounded visible assistant record, accounting snapshot, base-manifest hash/version, and target reference manifest. `sealed` is false until the last graph node. No model prompt, transcript array, credentials, reasoning, raw frames, or AbortSignal enters checkpoint state.

Before normal continuation, compare the archive's complete eligible references, manifest/version/assets, and checkpoint boundary. Missing checkpoint with nonempty history, missing manifests for existing history, unsupported schema, unaccounted assistant completion, or unexplained disagreement fails closed with `NOT_READY`. Do not rebuild from a UI page, concatenate restored history, silently rebase, or call the model. Initial empty sessions may initialize an empty boundary. Asset changes require an explicit quiescent rebase that validates the old archive/manifest/boundary, preserves all refs, increments context version, and writes both current asset versions and graph boundary; historical attempts/results retain old versions. P8/P9 call the exported `rebaseSession` deliberately, not during submission.

Required new-attempt ordering:

```text
validate identity/input/schema -> deterministic IDs -> duplicate lookup
 -> create session only while accepting first input -> acquire
 -> verify existing boundary + complete history + budget; reserve attempt
 -> allocate 3 sequences (user/attempt/assistant; retry uses 2, no new user)
 -> immutable user -> immutable accepted attempt -> confirmAcceptance
 -> release lease retaining activeAttemptId -> return acceptance response
 -> P6 executeTurn: quiescent claim -> accepted event -> generating CAS/event
 -> graph prepare -> generate through P4 -> seal -> await sync graph completion
 -> reread completed graph state (matching sealed result, next=[])
 -> finalizing CAS/event -> application publication -> terminal CAS
 -> clear active slot -> release lease -> emit terminal status and completed event
```

Saved-result publication is replay-safe:

```text
validate sealed scoped result against immutable attempt/input/hash/acceptance
 -> append assistant as streaming if absent (stable ID/sequence/content/time)
 -> put absolute accounting snapshot with terminal outcome; preserve endedAt
 -> put target manifest only if current == base OR exact target already exists
 -> graph.updateState(boundary=target, input/result preserved, sealed=true, asNode='seal')
 -> reread graph next=[] and target boundary
 -> update assistant completed/truncated -> touch session at saved result timestamp
 -> attempt terminal CAS -> clearAttempt -> release -> terminal stream
```

Never emit completion after only provider `end`, EOF, a checkpoint pending write, or an allocated sequence. If any publication step fails and a sealed result exists, leave the attempt **finalizing** and active slot intact; report `PERSISTENCE_ERROR` without a false terminal failed/completed claim. Reconciliation uses the same immutable saved result, including its timestamps/IDs, and does not recompute text or rerun `invoke(null)`. A durable terminal attempt left in an active slot is checked/cleared, never re-inferred.

No-result fallback: preserve any already-durable partial assistant unchanged; include only acceptance-confirmed original user inputs and non-truncated completed assistants in memory, write a cleared graph boundary via `updateState(...,'seal')`, then mark nonterminal attempt interrupted, save accounting without losing known values, clear slot and release. No graph/model replay. A missing-attempt orphan is found from `inputId(userId,sessionId,activeAttemptId)`; preserve it and clear the slot after verification, but do not include it in context without an acceptance marker. Repeated submission of that same deterministic identity can finish acceptance from the original record without another user insertion. Missing input for an existing attempt yields interrupted/NOT_READY retry, not invented content.

## Commands and native test environment

Routine unit tests use MemorySaver and fake clocks. Runtime integration uses P2's read-only `backend/test/persistence/native.ts` harness with operator-set private `AURVIN_TEST_MONGODB_URI` and `$env:AURVIN_TEST_DB_PREFIX = 'aurvin_p2_test_'`; each harness owns only its generated database. No real `.env`, Azure target, or OpenRouter key is read. Missing native configuration fails clearly; it is not skipped-green evidence. Native tests exercise the actual graph and standard saver, with injected raw provider fixtures. Genuine process-kill/selected-service/staging proof remains P10-owned.

```powershell
npx vitest run test/runtime/identity.spec.ts test/runtime/graph.spec.ts test/runtime/work.spec.ts
npm run test:e2e -- test/runtime/acceptance.native.e2e-spec.ts
npm run test:e2e -- test/runtime/lifecycle.native.e2e-spec.ts
npm run test:e2e -- test/runtime/recovery.native.e2e-spec.ts
npm run test:e2e -- test/runtime/operations.native.e2e-spec.ts
npx tsc --noEmit --incremental false -p tsconfig.json
npm run build
npm run lint
npm test
```

---

### Task 1: Lock deterministic scope/IDs and P6/P8 local ports

**Files:** Create `identity.ts`, `ports.ts` under `backend/src/chat-runtime/`; test `backend/test/runtime/identity.spec.ts`.

- [ ] **Step 1 — Write failing test**:

```typescript
// backend/test/runtime/identity.spec.ts
import { sessionIdFor, attemptIdFor, inputId, titleFor } from '../../src/chat-runtime/identity.js';
it('deduplicates new-chat identity without hashing content into request identity', () => {
  expect(sessionIdFor('u', null, 'request-0001')).toBe(sessionIdFor('u', null, 'request-0001'));
  expect(sessionIdFor('u', null, 'request-0001')).not.toBe(sessionIdFor('v', null, 'request-0001'));
  expect(sessionIdFor('u', 'existing', 'request-0001')).toBe('existing');
  expect(attemptIdFor('u', 's', 'request-0001')).not.toBe(attemptIdFor('u', 's', 'request-0002'));
  expect(inputId('u', 's', 'a')).toHaveLength(64);
});
it('does not leave surrogate halves or control characters in bounded titles', () => {
  expect(titleFor('  Hello\nworld\u0000  ', 80)).toBe('Hello world');
  expect(titleFor('😀😀', 3)).toBe('😀');
  expect(titleFor('\u0000\n', 80)).toBe('New chat');
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/runtime/identity.spec.ts`; missing `identity.js`.
- [ ] **Step 3 — Create these complete local definitions**. Types project upstream contracts; do not change their fields.

```typescript
// backend/src/chat-runtime/identity.ts
import { key } from '../persistence/records.js';
import { API_ROUTES, type SubmitTurnResponse } from '../contracts/api.js';
import type { AttemptRecord } from '../contracts/attempt.js';
export const sessionIdFor = (u: string, s: string | null, k: string) => s ?? key('new-session', u, k);
export const attemptIdFor = (u: string, s: string, k: string) => key('attempt-id', u, s, k);
export const turnIdFor = (u: string, s: string, k: string) => key('turn', u, s, k);
export const inputId = (u: string, s: string, a: string) => key('input', u, s, a);
export const outputId = (a: AttemptRecord) => key('output', a.userId, a.sessionId, a.attemptId);
export const eventIdFor = (u: string, s: string, id: string) => key('event', u, s, id);
export function titleFor(content: string, maximum: number): string {
  const text = content.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim() || 'New chat';
  let out = '';
  for (const point of text) { if (out.length + point.length > Math.min(maximum, 80)) break; out += point; }
  return out || 'Chat'.slice(0, Math.min(maximum, 80));
}
export function responseFor(a: AttemptRecord): SubmitTurnResponse {
  return { sessionId: a.sessionId, turnId: a.turnId, attemptId: a.attemptId,
    userMessageId: a.causal.userMessageId, streamPath: API_ROUTES.turnStream(a.sessionId, a.turnId) };
}
```

```typescript
// backend/src/chat-runtime/ports.ts
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { AgentRuntime } from '../contracts/runtime.js';
import type { StreamEnvelope } from '../contracts/stream.js';
import type { PersistenceBundle } from '../persistence/persistence.js';
import type { ContextAssembler } from '../contracts/context.js';
import type { FixedAssets } from '../instructions/fixed-assets.js';
import type { AurvinConfig } from '../platform/config/load-config.js';
import type { ModelLimits } from '../model/index.js';
export type RuntimeDependencies = {
  config: AurvinConfig; persistence: PersistenceBundle; assembler: ContextAssembler;
  assets: FixedAssets; limits: ModelLimits; fetcher?: typeof fetch; now?: () => number;
};
export type ExecuteTurn = {
  userId: string; sessionId: string; turnId: string; attemptId: string;
  signal: AbortSignal; emit: (event: StreamEnvelope) => Promise<void>;
};
export type DrainResult = { drained: boolean; active: number; unresolvedWrites: number };
export interface ChatRuntime extends AgentRuntime {
  executeTurn(command: ExecuteTurn): Promise<void>;
  stopAccepting(): void;
  snapshot(): { accepting: boolean; active: number; unresolvedWrites: number; degraded: boolean };
  drain(timeoutMs?: number): Promise<DrainResult>;
  allowStoppedOwner(ownerId: string): void;
  rebaseSession(userId: string, sessionId: string): Promise<void>;
}
export type RuntimeSaver = BaseCheckpointSaver;
```

`allowStoppedOwner` is **administrative only**, never on an HTTP route. P8 calls it only after verified old-process stop, all in-flight I/O settled, and P2 sentinel handoff. A string token is not proof; deployment/control-plane authorization supplies that proof. `drain` never releases the sentinel; P8/P9 close persistence only after `drained:true`.

- [ ] **Step 4 — Run green:** same identity test; `npx tsc --noEmit --incremental false -p tsconfig.json`.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/chat-runtime/identity.ts backend/src/chat-runtime/ports.ts backend/test/runtime/identity.spec.ts
git commit -m "feat(p5): define deterministic runtime identities and execution hooks"
```

### Task 2: Define strict reference-only graph state

**Files:** Create `backend/src/agent/state.ts`; create `backend/test/runtime/graph.spec.ts`.

- [ ] **Step 1 — Write failing schema test**:

```typescript
// backend/test/runtime/graph.spec.ts
import { emptyBoundary, boundaryFor, resultSchema } from '../../src/agent/state.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { buildReferenceManifest } from '../../src/context/index.js';
import { assets } from '../context/fixtures.js';
it('identifies exact reference/version state and refuses fabricated/private result data', () => {
  const m = buildReferenceManifest('u', 's', 0, [], assets, DEFAULT_BUDGETS);
  expect(emptyBoundary(m)).toEqual(boundaryFor(m));
  expect(boundaryFor({ ...m, contextVersion: 1 })).not.toEqual(boundaryFor(m));
  expect(resultSchema.safeParse({ reasoning: 'private', text: 'not a linked result' }).success).toBe(false);
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/runtime/graph.spec.ts`; missing state module.
- [ ] **Step 3 — Create state**:

```typescript
// backend/src/agent/state.ts
import { Annotation } from '@langchain/langgraph';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { agentMemoryManifestSchema, type AgentMemoryManifest } from '../contracts/agent-memory.js';
import { attemptRecordSchema } from '../contracts/attempt.js';
import { accountingRecordSchema } from '../contracts/metadata.js';
import { messageRecordSchema } from '../contracts/message.js';
import { AppError } from '../platform/errors/app-error.js';
export const boundarySchema = z.object({ contextVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  manifestHash: z.string().length(64) }).strict();
export const graphInputSchema = z.object({ attempt: attemptRecordSchema,
  assistantSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export const resultSchema = z.object({ input: graphInputSchema, assistant: messageRecordSchema,
  accounting: accountingRecordSchema, base: boundarySchema, target: agentMemoryManifestSchema,
  outcome: z.enum(['completed', 'truncated']) }).strict();
export type Boundary = z.infer<typeof boundarySchema>;
export type GraphInput = z.infer<typeof graphInputSchema>;
export type SavedResult = z.infer<typeof resultSchema>;
export const rebaseSchema = z.object({ base: boundarySchema, target: agentMemoryManifestSchema }).strict();
export function boundaryFor(m: AgentMemoryManifest): Boundary {
  const canonical = agentMemoryManifestSchema.parse(m);
  return { contextVersion: canonical.contextVersion,
    manifestHash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex') };
}
export function emptyBoundary(m: AgentMemoryManifest): Boundary {
  if (m.contextVersion !== 0 || m.messageRefs.length) throw new AppError('NOT_READY', 'Chat context needs recovery.');
  return boundaryFor(m);
}
export const TurnState = Annotation.Root({
  input: Annotation<GraphInput | null>(), boundary: Annotation<Boundary | null>(),
  result: Annotation<SavedResult | null>(), sealed: Annotation<boolean>(),
  rebase: Annotation<z.infer<typeof rebaseSchema> | null>(),
});
```

Do not annotate a transcript or persist the transient assembled model projection. The schema field `input.attempt` is immutable acceptance evidence, not a second input message. It may preserve accepted status even after the metadata record moves to generating/finalizing; compare immutable fields, not mutable lifecycle.

- [ ] **Step 4 — Run green:** graph spec and source/test type check; schema strictly rejects unknown keys.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/agent/state.ts backend/test/runtime/graph.spec.ts
git commit -m "feat(p5): define bounded reference graph state and saved result"
```

### Task 3: Build the actual prepare/generate/seal graph

**Files:** Create `backend/src/agent/turn-graph.ts`; extend graph spec.

- [ ] **Step 1 — Add failing real-LangGraph tests** (imports below are additions to Task 2's test):

```typescript
import { MemorySaver } from '@langchain/langgraph';
import { buildTurnGraph } from '../../src/agent/turn-graph.js';
it('awaits sync terminal persistence and never appends model messages into graph state', async () => {
  const saver = new MemorySaver();
  const prepare = vi.fn(async () => undefined);
  const generate = vi.fn(async () => { throw new Error('fixture generate fails'); });
  const graph = buildTurnGraph(saver, { prepare, generate });
  const cfg = { configurable: { thread_id: 'fixture', checkpoint_ns: '' }, durability: 'sync' as const };
  await graph.updateState(cfg, { input: null, result: null, boundary: null, sealed: false }, 'seal');
  await expect(graph.invoke({ input: null, result: null, sealed: false }, cfg)).rejects.toThrow('Chat input is unavailable.');
  expect(generate).not.toHaveBeenCalled();
  expect((await graph.getState(cfg)).values).not.toHaveProperty('messages');
});
it('manual boundary update uses seal and leaves no model node scheduled', async () => {
  const generate = vi.fn(async () => { throw new Error('must not infer'); });
  const graph = buildTurnGraph(new MemorySaver(), { prepare: async () => undefined, generate });
  const cfg = { configurable: { thread_id: 'repair', checkpoint_ns: '' } };
  await graph.updateState(cfg, { input: null, result: null, sealed: false,
    boundary: { contextVersion: 0, manifestHash: 'a'.repeat(64) } }, 'seal');
  expect((await graph.getState(cfg)).next).toEqual([]);
  expect(generate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2 — Run red:** graph spec; missing `turn-graph.js`.
- [ ] **Step 3 — Create graph**:

```typescript
// backend/src/agent/turn-graph.ts
import { StateGraph, START, END } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { TurnState, graphInputSchema, resultSchema, type GraphInput, type SavedResult } from './state.js';
import { AppError } from '../platform/errors/app-error.js';
export function buildTurnGraph(saver: BaseCheckpointSaver, hooks: {
  prepare: (input: GraphInput) => Promise<void>;
  generate: (input: GraphInput) => Promise<SavedResult>;
}) {
  return new StateGraph(TurnState)
    .addNode('prepare', async state => {
      if (!state.input) throw new AppError('NOT_READY', 'Chat input is unavailable.');
      const input = graphInputSchema.parse(state.input);
      await hooks.prepare(input);
      return { result: null, sealed: false };
    })
    .addNode('generate', async state => {
      if (!state.input) throw new AppError('NOT_READY', 'Chat input is unavailable.');
      return { result: resultSchema.parse(await hooks.generate(state.input)), sealed: false };
    })
    .addNode('seal', state => {
      if (!state.result || !state.input || state.result.input.attempt.attemptId !== state.input.attempt.attemptId)
        throw new AppError('NOT_READY', 'The saved answer could not be confirmed.');
      resultSchema.parse(state.result);
      return { sealed: true };
    })
    .addEdge(START, 'prepare').addEdge('prepare', 'generate')
    .addEdge('generate', 'seal').addEdge('seal', END).compile({ checkpointer: saver });
}
export type TurnGraph = ReturnType<typeof buildTurnGraph>;
```

No node retry policy or `invoke(null)` exists. `updateState` attributed to seal records a repair without executing seal or scheduling generation. P5 only accepts saved success when `getState` reports `sealed:true`, matching validated result, `next:[]`, no tasks with errors/interrupts, and a checkpoint ID. Pending writes alone are not success; conservatively interrupt if the seal was never durably committed. Graph `getState`/`updateState` are public APIs; do not decode saver blobs or query checkpoint collections for the UI.

- [ ] **Step 4 — Run green:** graph spec + type check + build. Installed declarations confirm Annotation/StateGraph/getState/updateState/durability; if an upgrade changes them, stop for P1 dependency reconciliation.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/agent/turn-graph.ts backend/test/runtime/graph.spec.ts
git commit -m "feat(p5): compile a sync durable reference-only turn graph"
```

### Task 4: Add bounded full-history and attempt discovery

**Files:** Create `backend/src/chat-runtime/history.ts`, `backend/test/runtime/native-harness.ts`, `backend/test/runtime/acceptance.native.e2e-spec.ts`.

- [ ] **Step 1 — Write native harness and failing history test**:

```typescript
// backend/test/runtime/native-harness.ts
import { nativeDatabase } from '../persistence/native.js';
import { createPersistenceBundle } from '../../src/persistence/index.js';
import { loadConfig } from '../../src/platform/config/load-config.js';
import { createContextAssembler } from '../../src/context/index.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';
export async function nativeHarness(text: string = FRAMES.normal) {
  const db = await nativeDatabase();
  const config = loadConfig({ AURVIN_USER_ID: 'aurvin-dev-user', OPENROUTER_API_KEY: 'fixture-key',
    OPENROUTER_MODEL: 'fixture/model', PERSISTENCE_PROFILE: 'native-mongodb' });
  const persistence = await createPersistenceBundle(db.client, db.name, config.budgets, 'p5-executor');
  const context = await createContextAssembler({ memory: persistence.memory, messages: persistence.messages,
    budgets: config.budgets, paths: { instructions: new URL('../../src/instructions/system.md', import.meta.url),
      knowledge: new URL('../../../product_knowledge.md', import.meta.url) } });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(text,
    { headers: { 'content-type': 'text/event-stream' } }));
  const deps = { config, persistence, ...context, limits: { modelId: 'fixture/model', contextTokens: 32768,
    outputTokens: 4096, supportsMaxTokens: true, source: 'fixture' as const }, fetcher };
  const identity = { userId: config.identity.userId, openRouterUser: config.identity.userId, source: 'server-configured' as const };
  return { db, deps, persistence, fetcher, identity, close: () => db.close() };
}
```

```typescript
// backend/test/runtime/acceptance.native.e2e-spec.ts
import { nativeHarness } from './native-harness.js';
import { archiveRecords, attemptsFor } from '../../src/chat-runtime/history.js';
it('reads complete bounded archive, not just the newest UI page', async () => {
  const h = await nativeHarness();
  try {
    expect(await archiveRecords(h.persistence, h.identity.userId, 'absent')).toEqual([]);
    expect(await attemptsFor(h.persistence, h.identity.userId, 'absent')).toEqual([]);
  } finally { await h.close(); }
}, 30000);
```

- [ ] **Step 2 — Run red:** `npm run test:e2e -- test/runtime/acceptance.native.e2e-spec.ts`; missing history module. Missing native configuration after imports resolve is a blocker, not green.
- [ ] **Step 3 — Create bounded discovery**:

```typescript
// backend/src/chat-runtime/history.ts
import type { PersistenceBundle } from '../persistence/persistence.js';
import type { MessageRecord } from '../contracts/message.js';
import type { AttemptRecord } from '../contracts/attempt.js';
import { eligible } from '../context/reference-selection.js';
import { AppError } from '../platform/errors/app-error.js';
export async function attemptsFor(p: PersistenceBundle, u: string, s: string): Promise<AttemptRecord[]> {
  let cursor: string | null = null;
  const out: AttemptRecord[] = [];
  for (let page = 0; page < 100; page++) {
    const found = await p.metadata.listAttempts(u, s, { cursor, limit: p.metadata.budgets.maxPageSize });
    out.push(...found.items); cursor = found.nextCursor;
    if (!cursor) return out.sort((a, b) => b.sequence - a.sequence);
  }
  throw new AppError('STORAGE_BUDGET_EXCEEDED', 'This chat has reached its record limit. Start a new chat.');
}
export async function archiveRecords(p: PersistenceBundle, u: string, s: string): Promise<MessageRecord[]> {
  let cursor: string | null = null;
  const out: MessageRecord[] = [];
  for (let page = 0; page < 100; page++) {
    const found = await p.messages.list(u, s, { cursor, limit: p.messages.budgets.maxPageSize });
    for (const visible of found.items) {
      const original = await p.messages.get(u, s, visible.messageId);
      if (!original) throw new AppError('NOT_READY', 'Chat history needs recovery.');
      out.push(original);
    }
    cursor = found.nextCursor;
    if (!cursor) return out.sort((a, b) => a.sequence - b.sequence);
  }
  throw new AppError('STORAGE_BUDGET_EXCEEDED', 'This chat has reached its record limit. Start a new chat.');
}
export async function acceptedHistory(p: PersistenceBundle, u: string, s: string): Promise<MessageRecord[]> {
  const attempts = await attemptsFor(p, u, s);
  const accepted = new Set<string>();
  const completed = new Set<string>();
  for (const a of attempts) {
    const marker = await p.metadata.getAcceptance(u, s, a.attemptId);
    if (marker && marker.turnId === a.turnId && marker.userMessageId === a.causal.userMessageId && marker.payloadHash === a.payloadHash)
      accepted.add(marker.userMessageId);
    if (a.status === 'completed' && !a.truncated) completed.add(a.attemptId);
  }
  return (await archiveRecords(p, u, s)).filter(m => eligible(m) &&
    (m.role === 'user' ? accepted.has(m.messageId) : completed.has(m.attemptId!)));
}
export async function latestAttempt(p: PersistenceBundle, u: string, s: string, t: string): Promise<AttemptRecord> {
  const a = (await attemptsFor(p, u, s)).find(item => item.turnId === t);
  if (!a) throw new AppError('NOT_FOUND', 'Turn not found.');
  return a;
}
```

The cap is 100 pages and at most 50 records/page (5,000 records total); sequential reads bound in-flight work. Reaching it rejects, never selects a newest-only window. `acceptedHistory` is for quiescent boundary checks/recovery. During saved-result publication the assistant may be completed before its attempt; use the **saved target manifest** as publication intent, not this selector to erase a half-finalized answer. Before inference validate every manifest reference against actual original record and terminal attempt/marker.

- [ ] **Step 4 — Run green:** native command + type check. Extend the initial assertion in Task 7 after acceptance works to prove >1 page, session isolation, and no omissions.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/chat-runtime/history.ts backend/test/runtime/native-harness.ts backend/test/runtime/acceptance.native.e2e-spec.ts
git commit -m "feat(p5): bound full-history and attempt recovery reads"
```

### Task 5: Track request-owned work, deadlines, lease renewal, and quarantine

**Files:** Create `backend/src/chat-runtime/work.ts`, `backend/test/runtime/work.spec.ts`.

- [ ] **Step 1 — Write failing fake-clock tests**:

```typescript
// backend/test/runtime/work.spec.ts
import { WorkRegistry } from '../../src/chat-runtime/work.js';
afterEach(() => vi.useRealTimers());
it('rejects a second owner and retains timed-out unresolved writes', async () => {
  vi.useFakeTimers();
  const registry = new WorkRegistry();
  const job = registry.open('u', 's', new AbortController().signal, 100);
  expect(() => registry.open('u', 's', new AbortController().signal, 100)).toThrow();
  let settle!: () => void;
  const write = new Promise<void>(resolve => { settle = resolve; });
  const result = expect(job.wait(write, 5)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  await vi.advanceTimersByTimeAsync(6); await result;
  expect(registry.snapshot().unresolvedWrites).toBe(1);
  expect(() => job.close()).toThrow();
  settle(); await write; await Promise.resolve(); job.close();
  expect(registry.snapshot().active).toBe(0);
});
it('disconnect abort is interrupted while explicit cancellation is cancelled', () => {
  const r = new WorkRegistry(); const signal = new AbortController();
  const job = r.open('u', 's', signal.signal, 1000); signal.abort();
  expect(job.failure().code).toBe('INTERRUPTED'); job.close();
  const other = r.open('u', 's', new AbortController().signal, 1000);
  other.abort('CANCELLED'); expect(other.failure().code).toBe('CANCELLED'); other.close();
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/runtime/work.spec.ts`.
- [ ] **Step 3 — Create work tracker**:

```typescript
// backend/src/chat-runtime/work.ts
import { AppError } from '../platform/errors/app-error.js';
export class WorkRegistry {
  accepting = true;
  degraded = false;
  private jobs = new Map<string, Work>();
  constructor(private readonly maximum = 8) {}
  key(u: string, s: string) { return JSON.stringify([u, s]); }
  get(u: string, s: string) { return this.jobs.get(this.key(u, s)); }
  open(u: string, s: string, signal: AbortSignal, totalMs: number) {
    if (this.jobs.has(this.key(u, s))) throw new AppError('CONFLICT_ACTIVE_TURN', 'Another request owns this turn.');
    if (this.jobs.size >= this.maximum) throw new AppError('CONCURRENCY_LIMIT', 'Too many chat requests are active.');
    const job = new Work(signal, totalMs, () => this.jobs.delete(this.key(u, s)), () => { this.degraded = true; });
    this.jobs.set(this.key(u, s), job); return job;
  }
  snapshot() { return { accepting: this.accepting, active: this.jobs.size,
    unresolvedWrites: [...this.jobs.values()].reduce((n, j) => n + j.pending.size, 0), degraded: this.degraded }; }
  async drain(ms: number) {
    this.accepting = false;
    const until = Date.now() + ms;
    while (this.jobs.size && Date.now() < until) await new Promise<void>(resolve => setTimeout(resolve, Math.min(10, Math.max(1, until - Date.now()))));
    if (this.jobs.size) for (const job of this.jobs.values()) job.abort('INTERRUPTED');
    const state = this.snapshot();
    return { drained: state.active === 0 && state.unresolvedWrites === 0, active: state.active, unresolvedWrites: state.unresolvedWrites };
  }
}
export class Work {
  private controller = new AbortController();
  readonly signal = this.controller.signal;
  readonly pending = new Set<Promise<unknown>>();
  private code: 'INTERRUPTED' | 'CANCELLED' | 'TIMEOUT' = 'INTERRUPTED';
  private timer: ReturnType<typeof setTimeout>;
  private disconnect = () => this.abort('INTERRUPTED');
  private heartbeat: Promise<void> | null = null;
  private heartbeatStopped = true;
  private wakeHeartbeat: (() => void) | null = null;
  constructor(private outer: AbortSignal, ms: number, private remove: () => void, private quarantine: () => void) {
    this.timer = setTimeout(() => this.abort('TIMEOUT'), ms);
    if (outer.aborted) this.disconnect(); else outer.addEventListener('abort', this.disconnect, { once: true });
  }
  abort(code: 'INTERRUPTED' | 'CANCELLED' | 'TIMEOUT') { if (!this.signal.aborted) { this.code = code; this.controller.abort(); } }
  failure() { return new AppError(this.code, this.code === 'CANCELLED' ? 'Generation was cancelled.' : 'Generation was interrupted. Retry to continue.', false); }
  check() { if (this.signal.aborted) throw this.failure(); }
  track<T>(p: Promise<T>): Promise<T> {
    this.pending.add(p); void p.then(() => this.pending.delete(p), () => this.pending.delete(p)); return p;
  }
  async wait<T>(promise: Promise<T>, ms: number): Promise<T> {
    const p = this.track(promise); let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([p, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { this.quarantine(); this.abort('INTERRUPTED');
        reject(new AppError('PERSISTENCE_ERROR', 'The chat save could not be confirmed.', false)); }, ms);
    })]); } finally { if (timer) clearTimeout(timer); }
  }
  startHeartbeat(renew: () => Promise<void>, period = 30000) {
    this.heartbeatStopped = false;
    this.heartbeat = (async () => {
      while (!this.heartbeatStopped && !this.signal.aborted) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(done, period);
          const stop = () => done();
          const thisSignal = this.signal;
          const clearWake = () => { this.wakeHeartbeat = null; };
          function done() { clearTimeout(timer); thisSignal.removeEventListener('abort', stop); clearWake(); resolve(); }
          this.wakeHeartbeat = done;
          if (thisSignal.aborted) done(); else thisSignal.addEventListener('abort', stop, { once: true });
        });
        if (this.heartbeatStopped || this.signal.aborted) break;
        try { await renew(); } catch { this.quarantine(); this.abort('INTERRUPTED'); }
      }
    })();
  }
  async stopHeartbeat() { this.heartbeatStopped = true; this.wakeHeartbeat?.(); await this.heartbeat; }
  async settled() { await Promise.allSettled([...this.pending]); }
  close() {
    if (this.pending.size || !this.heartbeatStopped) throw new AppError('NOT_READY', 'Chat work is not quiescent.');
    clearTimeout(this.timer); this.outer.removeEventListener('abort', this.disconnect); this.remove();
  }
}
```

`Work.wait` bounds a wait, not the operation. `settled` is deliberately allowed to remain pending: bounded drain then reports `drained:false` and P8 terminates/retains the sentinel rather than pretending safe takeover. In production track graph invocation **as well as writes**; unresolved source work must stay visible until settled. `stopHeartbeat` wakes only its renewal loop and does not abort successful execution/terminal delivery. Admission rejects when `degraded:true`; P8 decides readiness/reset after recovery, not a retry loop.

- [ ] **Step 4 — Add and run heartbeat/deadline tests**:

```typescript
it('serializes renewal and aborts without permitting a new executor on failure', async () => {
  vi.useFakeTimers(); const r = new WorkRegistry();
  const j = r.open('u', 's', new AbortController().signal, 100);
  const renew = vi.fn(async () => { throw new Error('lost ownership'); });
  j.startHeartbeat(renew, 5); await vi.advanceTimersByTimeAsync(6);
  expect(renew).toHaveBeenCalledTimes(1); expect(j.signal.aborted).toBe(true);
  expect(r.snapshot().degraded).toBe(true); await j.stopHeartbeat(); j.close();
  expect(vi.getTimerCount()).toBe(0);
});
it('total deadline and stop admission are finite without deleting live work', async () => {
  vi.useFakeTimers(); const r = new WorkRegistry(); const j = r.open('u', 's', new AbortController().signal, 5);
  await vi.advanceTimersByTimeAsync(6); expect(j.failure().code).toBe('TIMEOUT');
  j.close(); expect(await r.drain(1)).toEqual({ drained: true, active: 0, unresolvedWrites: 0 });
  expect(r.snapshot().accepting).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
```

Run work spec and full type check. Correct only P5 code if assertions reveal timer leaks.

- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/chat-runtime/work.ts backend/test/runtime/work.spec.ts
git commit -m "feat(p5): track bounded request work and quarantine ambiguous writes"
```

### Task 6: Implement checkpoint-aware saved-result finalization

**Files:** Create `backend/src/chat-runtime/finalization.ts`; create `backend/test/runtime/recovery.native.e2e-spec.ts`.

- [ ] **Step 1 — Write the failing publication test**. Task 9 adds runtime-driven fault cases; this first test directly uses a real graph/saver with a constructed saved public result.

```typescript
// backend/test/runtime/recovery.native.e2e-spec.ts
import { checkedResult } from '../../src/chat-runtime/finalization.js';
import { nativeHarness } from './native-harness.js';
import { attempt, message, accounting } from '../persistence/fixtures.js';
import { buildReferenceManifest } from '../../src/context/index.js';
import { boundaryFor } from '../../src/agent/state.js';
import { outputId, eventIdFor } from '../../src/chat-runtime/identity.js';
it('does not publish an unlinked/fabricated saved result', async () => {
  const h = await nativeHarness();
  try {
    const a = attempt();
    const assets = { ...h.deps.assets, instructionVersion: a.instructionVersion,
      knowledgeContentHash: a.knowledgeContentHash, graphSchemaVersion: a.graphSchemaVersion };
    const base = buildReferenceManifest(a.userId, a.sessionId, 0, [], assets, h.deps.config.budgets);
    const assistant = { ...message(2), role: 'assistant' as const, messageId: outputId(a),
      eventId: eventIdFor(a.userId, a.sessionId, outputId(a)), completionStatus: 'streaming' as const };
    const target = buildReferenceManifest(a.userId, a.sessionId, 1,
      [message(0), { ...assistant, completionStatus: 'completed' }], assets, h.deps.config.budgets);
    await expect(checkedResult(h.persistence, a, { input: { attempt: a, assistantSequence: 2 }, assistant,
      accounting: accounting(), base: boundaryFor(base), target, outcome: 'completed' }))
      .rejects.toMatchObject({ code: 'NOT_READY' });
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.close(); }
}, 30000);
```

This rejection test proves a well-shaped but unlinked result cannot publish; it is not crash-recovery evidence. Task 9 supplies the required saved-result crash fault before wiring runtime reconciliation.

- [ ] **Step 2 — Run red:** native recovery command; missing finalization module.
- [ ] **Step 3 — Create the publication implementation**:

```typescript
// backend/src/chat-runtime/finalization.ts
import { isDeepStrictEqual } from 'node:util';
import type { PersistenceBundle } from '../persistence/persistence.js';
import type { ExecutionLease } from '../contracts/repositories.js';
import type { AttemptRecord, AttemptStatus } from '../contracts/attempt.js';
import type { TurnGraph } from '../agent/turn-graph.js';
import { boundaryFor, resultSchema, type SavedResult } from '../agent/state.js';
import { graphThreadId } from '../persistence/index.js';
import { hashPayload } from '../platform/crypto/hash-payload.js';
import { AppError } from '../platform/errors/app-error.js';
import { outputId, eventIdFor } from './identity.js';
import type { Work } from './work.js';
export const graphConfig = (u: string, s: string) => ({ configurable: { thread_id: graphThreadId(u, s), checkpoint_ns: '' }, durability: 'sync' as const });
export const terminal = (s: AttemptStatus) => ['completed', 'truncated', 'failed', 'cancelled', 'interrupted'].includes(s);
export async function transition(p: PersistenceBundle, lease: ExecutionLease, work: Work,
  a: AttemptRecord, status: AttemptStatus, errorCode: AttemptRecord['errorCode'] = null): Promise<AttemptRecord> {
  const next = { ...a, status, errorCode, truncated: status === 'truncated', updatedAt: new Date().toISOString() };
  const ok = await work.wait(p.owner.run(lease, () => p.metadata.compareAttempt(next, a.status)), p.metadata.budgets.persistenceTimeoutMs);
  if (!ok) throw new AppError('CONFLICT_ACTIVE_TURN', 'Turn state changed.');
  return next;
}
export async function checkedResult(p: PersistenceBundle, a: AttemptRecord, raw: SavedResult): Promise<SavedResult> {
  const r = resultSchema.parse(raw); const saved = r.input.attempt;
  const strip = (v: AttemptRecord) => { const { status, updatedAt, generationId, truncated, errorCode, ...rest } = v;
    void status; void updatedAt; void generationId; void truncated; void errorCode; return rest; };
  const input = await p.messages.get(a.userId, a.sessionId, a.causal.userMessageId);
  const marker = await p.metadata.getAcceptance(a.userId, a.sessionId, a.attemptId);
  if (!input || !marker || !isDeepStrictEqual(strip(saved), strip(a)) || input.role !== 'user' ||
    input.turnId !== a.turnId || hashPayload(input.content) !== a.payloadHash || marker.payloadHash !== a.payloadHash ||
    marker.userMessageId !== input.messageId || marker.turnId !== a.turnId ||
    r.assistant.role !== 'assistant' || r.assistant.messageId !== outputId(a) ||
    r.assistant.eventId !== eventIdFor(a.userId, a.sessionId, outputId(a)) ||
    r.assistant.userId !== a.userId || r.assistant.sessionId !== a.sessionId ||
    r.assistant.turnId !== a.turnId || r.assistant.attemptId !== a.attemptId ||
    r.assistant.sequence !== r.input.assistantSequence || r.assistant.completionStatus !== 'streaming' || r.assistant.truncated ||
    r.accounting.userId !== a.userId || r.accounting.sessionId !== a.sessionId || r.accounting.turnId !== a.turnId ||
    r.accounting.attemptId !== a.attemptId || r.accounting.requestedModel !== a.modelId ||
    r.accounting.generationId !== a.generationId ||
    r.target.userId !== a.userId || r.target.sessionId !== a.sessionId ||
    r.target.contextVersion !== r.base.contextVersion + 1 || r.base.contextVersion !== a.contextVersion ||
    r.target.instructionVersion !== a.instructionVersion || r.target.knowledgeContentHash !== a.knowledgeContentHash ||
    r.target.graphSchemaVersion !== a.graphSchemaVersion || r.target.activeSummaryRef !== null)
    throw new AppError('NOT_READY', 'The saved answer needs recovery.');
  return r;
}
export async function publishResult(p: PersistenceBundle, lease: ExecutionLease, work: Work,
  graph: TurnGraph, a: AttemptRecord, raw: SavedResult): Promise<AttemptRecord> {
  const r = await checkedResult(p, a, raw); const cfg = graphConfig(a.userId, a.sessionId);
  const snapshot = await graph.getState(cfg);
  if (!snapshot.values.sealed || snapshot.next.length || snapshot.tasks.some(t => t.error || t.interrupts?.length) ||
    snapshot.values.result?.input.attempt.attemptId !== a.attemptId)
    throw new AppError('NOT_READY', 'The saved graph result is not complete.');
  const manifest = await p.memory.get(a.userId, a.sessionId);
  const target = boundaryFor(r.target);
  if (!manifest || (!isDeepStrictEqual(boundaryFor(manifest), r.base) && !isDeepStrictEqual(boundaryFor(manifest), target)))
    throw new AppError('NOT_READY', 'Chat context needs recovery.');
  const existing = await p.messages.get(a.userId, a.sessionId, r.assistant.messageId);
  if (existing) {
    const normalized = { ...existing, completionStatus: 'streaming', truncated: false };
    if (!isDeepStrictEqual(normalized, r.assistant) || !['streaming', r.outcome].includes(existing.completionStatus))
      throw new AppError('NOT_READY', 'Saved answer evidence disagrees.');
  } else await work.wait(p.owner.run(lease, () => p.messages.append(r.assistant)), p.metadata.budgets.persistenceTimeoutMs);
  const currentAccounting = await p.metadata.getAccounting(a.userId, a.sessionId, a.attemptId);
  const accounting = { ...(currentAccounting ?? r.accounting), outcome: r.outcome };
  await work.wait(p.owner.run(lease, () => p.metadata.putAccounting(accounting)), p.metadata.budgets.persistenceTimeoutMs);
  await work.wait(p.owner.run(lease, () => p.memory.put(r.target)), p.metadata.budgets.persistenceTimeoutMs);
  await work.wait(graph.updateState(cfg, { boundary: target }, 'seal'), p.metadata.budgets.persistenceTimeoutMs);
  const confirmed = await graph.getState(cfg);
  if (confirmed.next.length || !isDeepStrictEqual(confirmed.values.boundary, target))
    throw new AppError('PERSISTENCE_ERROR', 'Chat context save could not be confirmed.');
  await work.wait(p.owner.run(lease, () => p.messages.updateCompletion(a.userId, a.sessionId,
    r.assistant.messageId, r.outcome, r.outcome === 'truncated')), p.metadata.budgets.persistenceTimeoutMs);
  await work.wait(p.owner.run(lease, () => p.sessions.touchActivity(a.userId, a.sessionId, r.assistant.createdAt)), p.metadata.budgets.persistenceTimeoutMs);
  if (!terminal(a.status)) a = await transition(p, lease, work, a, r.outcome);
  if (a.status !== r.outcome) throw new AppError('NOT_READY', 'Turn outcome disagrees with its saved answer.');
  return a;
}
```

Before publishing, validate target refs against base manifest: target = exactly old refs plus original accepted input once plus the assistant only when outcome completed. Require exact IDs/order/range via P3's `buildReferenceManifest`, using versions **from the saved attempt**, not current assets. A result's target is not permission to remove any prior ref. This check is added in Task 9 with the tampered-target regression; its implementation is shown there. Keep `createdAt`, accounting `startedAt/endedAt`, sequence and IDs from the saved result; never regenerate on each recovery. When retrying terminal-attempt cleanup, bypass lifecycle CAS only after checking the terminal outcome agrees.

- [ ] **Step 4 — Run green:** current native recovery command + type check. No completion flag is returned until all required writes succeed.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/chat-runtime/finalization.ts backend/test/runtime/recovery.native.e2e-spec.ts
git commit -m "feat(p5): publish checkpoint results through idempotent finalization"
```

### Task 7: Implement durable acceptance and duplicate/concurrent semantics

**Files:** Create `backend/src/chat-runtime/durable-chat-runtime.ts`; extend acceptance spec. This task implements acceptance helpers first; execution/recovery methods are added in Tasks 8–10, not stubs returning success.

- [ ] **Step 1 — Add failing acceptance tests**:

```typescript
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
it('accepts before inference, deduplicates new chats and refuses changed payload', async () => {
  const h = await nativeHarness();
  try {
    const runtime = new DurableChatRuntime(h.deps);
    const command = { identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' };
    const first = await runtime.submitTurn(command);
    expect(await runtime.submitTurn(command)).toEqual(first);
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(await h.persistence.metadata.getAcceptance(h.identity.userId, first.sessionId, first.attemptId)).not.toBeNull();
    expect((await h.persistence.messages.list(h.identity.userId, first.sessionId, { cursor: null, limit: 50 })).items).toHaveLength(1);
    await expect(runtime.submitTurn({ ...command, content: 'Changed' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    await expect(runtime.submitTurn({ ...command, sessionId: first.sessionId, idempotencyKey: 'request-0002' })).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  } finally { await h.close(); }
}, 30000);
it('two clients cannot accept two distinct inputs into one active session', async () => {
  const h = await nativeHarness();
  try {
    const runtime = new DurableChatRuntime(h.deps);
    const first = await runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
    const results = await Promise.allSettled([2, 3].map(n => runtime.submitTurn({ identity: h.identity,
      sessionId: first.sessionId, content: `Input ${n}`, idempotencyKey: `request-000${n}` })));
    expect(results.every(r => r.status === 'rejected')).toBe(true);
    expect((await h.persistence.messages.list(h.identity.userId, first.sessionId, { cursor: null, limit: 50 })).items).toHaveLength(1);
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.close(); }
}, 30000);
```

- [ ] **Step 2 — Run red:** native acceptance command; missing runtime.
- [ ] **Step 3 — Implement acceptance**. Use the following complete acceptance method/helper sequence in `DurableChatRuntime`; Tasks 8/9/10 provide the class's remaining methods.

```typescript
// backend/src/chat-runtime/durable-chat-runtime.ts (imports and acceptance class)
import { isDeepStrictEqual } from 'node:util';
import type { ExecutionLease } from '../contracts/repositories.js';
import type { SubmitTurnCommand, RetryTurnCommand, CancelTurnCommand } from '../contracts/runtime.js';
import type { AttemptRecord } from '../contracts/attempt.js';
import type { MessageRecord } from '../contracts/message.js';
import { submitTurnRequestSchema, retryTurnRequestSchema, turnStatusResponseSchema } from '../contracts/api.js';
import { resolvedIdentitySchema } from '../contracts/identity.js';
import { streamEnvelopeSchema, type StreamEvent } from '../contracts/stream.js';
import { graphThreadId } from '../persistence/index.js';
import { validateInput } from '../context/context-budget.js';
import { buildReferenceManifest } from '../context/index.js';
import { hashPayload } from '../platform/crypto/hash-payload.js';
import { AppError } from '../platform/errors/app-error.js';
import { buildTurnGraph } from '../agent/turn-graph.js';
import { boundaryFor, resultSchema, rebaseSchema, type GraphInput, type SavedResult } from '../agent/state.js';
import { createModelServices } from '../model/index.js';
import type { AssembledContext } from '../contracts/context.js';
import type { RuntimeDependencies, ExecuteTurn, ChatRuntime } from './ports.js';
import { acceptedHistory, archiveRecords, attemptsFor, latestAttempt } from './history.js';
import { sessionIdFor, attemptIdFor, turnIdFor, inputId, outputId, eventIdFor, titleFor, responseFor } from './identity.js';
import { WorkRegistry, type Work } from './work.js';
import { graphConfig, transition, terminal, publishResult } from './finalization.js';

export class DurableChatRuntime {
  readonly work: WorkRegistry;
  readonly stoppedOwners = new Set<string>();
  constructor(readonly d: RuntimeDependencies) {
    if (d.config.topology.executor !== 'single-process') throw new AppError('UNSUPPORTED_TOPOLOGY', 'Only one executor is supported.');
    this.work = new WorkRegistry(d.config.budgets.maxConcurrentGenerationsPerProcess);
  }
  now() { return new Date((this.d.now ?? Date.now)()).toISOString(); }
  identity(value: SubmitTurnCommand['identity']) {
    const identity = resolvedIdentitySchema.parse(value);
    if (identity.userId !== this.d.config.identity.userId || identity.openRouterUser !== identity.userId)
      throw new AppError('IDENTITY_OVERRIDE_REJECTED', 'Identity is resolved by the server.');
    return identity;
  }
  ready() {
    if (!this.work.accepting || this.work.degraded) throw new AppError('NOT_READY', 'Chat is not accepting work.');
  }
  graph(lease: ExecutionLease) {
    return this.d.persistence.checkpoints.create().then(handle => buildTurnGraph(handle.bind(lease), {
      prepare: async () => { throw new AppError('NOT_READY', 'Recovery cannot invoke the graph.'); },
      generate: async () => { throw new AppError('NOT_READY', 'Recovery cannot invoke the model.'); },
    }));
  }
  async checkBoundary(lease: ExecutionLease, job: Work, newTurnId: string, content: string) {
    const p = this.d.persistence; const u = lease.userId; const s = lease.sessionId;
    const records = await acceptedHistory(p, u, s); let manifest = await p.memory.get(u, s);
    const graph = await this.graph(lease); const cfg = graphConfig(u, s); const snap = await graph.getState(cfg);
    if (!manifest) {
      if (records.length || snap.values.boundary) throw new AppError('NOT_READY', 'Chat context needs recovery.');
      manifest = buildReferenceManifest(u, s, 0, [], this.d.assets, this.d.config.budgets);
      await job.wait(p.owner.run(lease, () => p.memory.put(manifest!)), this.d.config.budgets.persistenceTimeoutMs);
    }
    // The currently accepted input is deliberately not committed history yet.
    // On explicit retry it may already be referenced; P3 removes it by turn ID.
    const referenced = new Set(manifest.messageRefs.map(r => r.messageId));
    const committed = records.filter(m => !(m.turnId === newTurnId && m.role === 'user' && !referenced.has(m.messageId)));
    const expected = buildReferenceManifest(u, s, manifest.contextVersion, committed, this.d.assets, this.d.config.budgets);
    if (!isDeepStrictEqual(expected, manifest)) throw new AppError('NOT_READY', 'Chat context needs recovery.');
    if (!snap.values.boundary) {
      if (manifest.messageRefs.length || manifest.contextVersion !== 0) throw new AppError('NOT_READY', 'Graph state needs recovery.');
      await job.wait(graph.updateState(cfg, { boundary: boundaryFor(manifest), input: null, result: null, sealed: false, rebase: null }, 'seal'), this.d.config.budgets.persistenceTimeoutMs);
    } else if (snap.next.length || !isDeepStrictEqual(snap.values.boundary, boundaryFor(manifest)))
      throw new AppError('NOT_READY', 'Graph state needs recovery.');
    const assembled = await this.d.assembler.assemble({ userId: u, sessionId: s, turnId: newTurnId, newUserInput: content });
    if (!assembled.ok) throw new AppError('CONTEXT_BUDGET_EXCEEDED', assembled.overflow.message, false);
    return assembled.context;
  }
  async submitTurn(command: SubmitTurnCommand) {
    const id = this.identity(command.identity); this.ready();
    const body = submitTurnRequestSchema.parse({ sessionId: command.sessionId, content: command.content, idempotencyKey: command.idempotencyKey });
    validateInput(body.content, this.d.config.budgets);
    const p = this.d.persistence; const s = sessionIdFor(id.userId, body.sessionId, body.idempotencyKey);
    const old = await p.metadata.getAttemptByIdempotency(id.userId, s, body.idempotencyKey);
    if (old) {
      if (old.payloadHash !== hashPayload(body.content) || old.causal.previousAttemptId !== null)
        throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'This request identity has different input.');
      if (!await p.metadata.getAcceptance(id.userId, s, old.attemptId)) throw new AppError('NOT_READY', 'Acceptance needs recovery.');
      return responseFor(old);
    }
    const job = this.work.open(id.userId, s, new AbortController().signal, this.d.config.budgets.totalRunTimeoutMs);
    let lease: ExecutionLease | undefined;
    try {
      await p.owner.assertExecutor(); const at = this.now();
      if (body.sessionId !== null && !await p.sessions.get(id.userId, s)) throw new AppError('NOT_FOUND', 'Chat not found.');
      await job.wait(p.sessions.createIfAbsent({ schemaVersion: 1, userId: id.userId, sessionId: s,
        title: titleFor(body.content, this.d.config.budgets.titleMaxChars), createdAt: at, updatedAt: at,
        lastActivityAt: at, lifecycle: 'active', graphThreadId: graphThreadId(id.userId, s), latestTurnId: null,
        execution: { ownerId: null, leaseExpiresAt: null, activeAttemptId: null, generation: 0 } }), this.d.config.budgets.persistenceTimeoutMs);
      const owned = await p.owner.acquire({ userId: id.userId, sessionId: s, ownerId: p.owner.executorId, leaseMs: 180000 });
      if (!owned.ok) throw new AppError('CONFLICT_ACTIVE_TURN', 'Another turn is active.'); lease = owned.lease;
      const t = turnIdFor(id.userId, s, body.idempotencyKey);
      const context = await this.checkBoundary(lease, job, t, body.content);
      const aId = attemptIdFor(id.userId, s, body.idempotencyKey); const mId = inputId(id.userId, s, aId);
      await job.wait(p.owner.reserveAttempt(lease, aId), this.d.config.budgets.persistenceTimeoutMs);
      const reserved = await p.owner.allocateSequences(lease, aId, 3);
      const orphan = await p.messages.get(id.userId, s, mId);
      if (orphan && (orphan.content !== body.content || orphan.turnId !== t || orphan.role !== 'user'))
        throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'This request identity has different input.');
      if (orphan && (await acceptedHistory(p, id.userId, s)).some(m => m.role === 'user' && m.sequence > orphan.sequence))
        throw new AppError('NOT_READY', 'This orphaned input cannot be accepted after later turns.');
      const input: MessageRecord = orphan ?? { schemaVersion: 1, userId: id.userId, sessionId: s, turnId: t,
        messageId: mId, eventId: eventIdFor(id.userId, s, mId), sequence: reserved.start, role: 'user', content: body.content,
        createdAt: at, completionStatus: 'accepted', attemptId: null, truncated: false };
      const attempt: AttemptRecord = { schemaVersion: 1, kind: 'attempt', userId: id.userId, sessionId: s, turnId: t,
        attemptId: aId, idempotencyKey: body.idempotencyKey, payloadHash: hashPayload(body.content), status: 'accepted',
        sequence: reserved.start + 1, createdAt: input.createdAt, updatedAt: input.createdAt,
        instructionVersion: context.instructionVersion, knowledgeContentHash: context.knowledgeContentHash,
        graphSchemaVersion: context.graphSchemaVersion, contextVersion: context.contextVersion, modelId: this.d.config.openRouter.modelId,
        openRouterUser: id.openRouterUser, generationId: null, truncated: false, errorCode: null,
        causal: { userMessageId: mId, previousAttemptId: null } };
      await job.wait(p.owner.run(lease, () => p.messages.append(input)), this.d.config.budgets.persistenceTimeoutMs);
      await job.wait(p.owner.run(lease, () => p.metadata.putAttempt(attempt)), this.d.config.budgets.persistenceTimeoutMs);
      await job.wait(p.owner.confirmAcceptance(lease, aId), this.d.config.budgets.persistenceTimeoutMs);
      return responseFor(attempt);
    } finally {
      await job.settled(); await p.owner.drain();
      if (lease) await p.owner.release(lease);
      job.close();
    }
  }
}
```

If acceptance fails after `activeAttemptId` reservation, leave the slot for reconciliation. Do not call the model or report accepted when confirmation failed. Existing accepted attempt lacking its marker is handled by Task 9: if original input and immutable hash agree, recovery confirms acceptance then interrupts, requiring explicit retry (not silent inference). For simultaneous **identical** requests, the local admission conflict path must reread the durable key after the first acceptance settles and return the same response; Task 10 adds this regression and the bounded join. Different keys never queue generation.

Add actual pre-inference BSON headroom preflight to acceptance: run P2 `bounded(messageRecordSchema, input, key('message',u,s,mId), budgets.maxMessageBytes)` before reserving, and preflight a worst-case assistant envelope (`content` up to min(32,000 chars, byte bound minus record envelope)) plus target manifest headroom. P4 text-only output bound alone omits BSON envelope. Configure the runtime adapter's output byte budget to `maxMessageBytes - measured empty assistant envelope - 256` for that attempt, leaving P1 stored record max unchanged. If this would be nonpositive or a manifest with the next two refs does not fit, reject before inference. Show the measurement assertion in Task 10; request P4 follow-up if adapter cannot safely consume the reduced configured budget.

- [ ] **Step 4 — Run green:** native acceptance command + source/test type check. Verify no provider fetch occurs even after durable acceptance. The class is not yet exported as `ChatRuntime`; do not add fake recovery/execution stubs just to satisfy it early.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/chat-runtime/durable-chat-runtime.ts backend/test/runtime/acceptance.native.e2e-spec.ts
git commit -m "feat(p5): persist accepted turns before request-owned inference"
```

### Task 8: Execute once, stream lifecycle, and preserve provider outcomes

**Files:** Extend `durable-chat-runtime.ts`; create `backend/test/runtime/lifecycle.native.e2e-spec.ts`.

- [ ] **Step 1 — Write failing lifecycle test**:

```typescript
// backend/test/runtime/lifecycle.native.e2e-spec.ts
import { nativeHarness } from './native-harness.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import type { StreamEnvelope } from '../../src/contracts/stream.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';
it.each([['normal', 'completed'], ['length', 'truncated']] as const)('durably publishes %s with honest outcome', async (fixture, outcome) => {
  const h = await nativeHarness(FRAMES[fixture]);
  try {
    const runtime = new DurableChatRuntime(h.deps); const events: StreamEnvelope[] = [];
    const ids = await runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
    await runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
      emit: async e => {
        events.push(e);
        if (e.event.type === 'completed') {
          expect((await h.persistence.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status).toBe(outcome);
          expect((await h.persistence.messages.get(h.identity.userId, ids.sessionId, e.event.assistantMessageId))?.completionStatus).toBe(outcome);
          expect((await h.persistence.sessions.get(h.identity.userId, ids.sessionId))?.execution.activeAttemptId).toBeNull();
        }
      } });
    expect(events.map(e => e.sequence)).toEqual(events.map((_, i) => i));
    expect(events.some(e => e.event.type === 'delta')).toBe(true);
    expect(events.filter(e => e.event.type === 'status').map(e => e.event.type === 'status' && e.event.status))
      .toEqual(['generating', 'finalizing', outcome]);
    expect(events.at(-1)?.event).toMatchObject({ type: 'completed', outcome });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  } finally { await h.close(); }
}, 30000);
```

- [ ] **Step 2 — Run red:** native lifecycle command; missing `executeTurn`.
- [ ] **Step 3 — Add `executeTurn` inside the existing class**:

```typescript
async executeTurn(c: ExecuteTurn): Promise<void> {
  const p = this.d.persistence; this.ready();
  if (c.userId !== this.d.config.identity.userId) throw new AppError('NOT_FOUND', 'Turn not found.');
  let a = await latestAttempt(p, c.userId, c.sessionId, c.turnId);
  if (a.attemptId !== c.attemptId) throw new AppError('CONFLICT_ACTIVE_TURN', 'This attempt is no longer current.');
  if (terminal(a.status)) {
    const message = await p.messages.get(c.userId, c.sessionId, outputId(a));
    if (['completed', 'truncated'].includes(a.status)) {
      const session = await p.sessions.get(c.userId, c.sessionId);
      if (!session || !message || message.completionStatus !== a.status || message.truncated !== a.truncated)
        throw new AppError('NOT_READY', 'Saved completion evidence is unavailable.');
      // Read-only saver binding: this value grants no write ownership.
      const graph = await this.graph({ userId: c.userId, sessionId: c.sessionId, ownerId: p.owner.executorId,
        generation: session.execution.generation, leaseExpiresAt: this.now() });
      const snapshot = await graph.getState(graphConfig(c.userId, c.sessionId));
      const manifest = await p.memory.get(c.userId, c.sessionId);
      if (!manifest || snapshot.next.length || !isDeepStrictEqual(snapshot.values.boundary, boundaryFor(manifest)))
        throw new AppError('NOT_READY', 'Saved completion needs reconciliation.');
    }
    await c.emit(streamEnvelopeSchema.parse({ protocolVersion: 1, sessionId: c.sessionId, turnId: c.turnId,
      attemptId: a.attemptId, sequence: 0, event: { type: 'status', status: a.status, truncated: a.truncated } }));
    if (message && ['completed', 'truncated'].includes(a.status)) await c.emit(streamEnvelopeSchema.parse({
      protocolVersion: 1, sessionId: c.sessionId, turnId: c.turnId, attemptId: a.attemptId, sequence: 1,
      event: { type: 'completed', assistantMessageId: message.messageId, outcome: a.status } }));
    return;
  }
  if (a.status !== 'accepted') throw new AppError('NOT_READY', 'Turn requires reconciliation before it can run.');
  const job = this.work.open(c.userId, c.sessionId, c.signal, this.d.config.budgets.totalRunTimeoutMs);
  let lease: ExecutionLease | undefined; let sequence = 0; let partial = ''; let graph: Awaited<ReturnType<DurableChatRuntime['graph']>> | undefined;
  let saved: SavedResult | null = null;
  const emit = async (event: StreamEvent) => {
    job.check();
    const envelope = streamEnvelopeSchema.parse({ protocolVersion: 1, sessionId: c.sessionId, turnId: c.turnId,
      attemptId: c.attemptId, sequence: sequence++, event });
    try { await job.wait(c.emit(envelope), this.d.config.budgets.idleStreamTimeoutMs); }
    catch { job.abort('INTERRUPTED'); throw job.failure(); }
  };
  try {
    const session = await p.sessions.get(c.userId, c.sessionId);
    if (!session || session.execution.activeAttemptId !== a.attemptId || session.execution.ownerId !== null)
      throw new AppError('CONFLICT_ACTIVE_TURN', 'Another request owns this turn.');
    lease = await p.owner.recoverStoppedSession(c.userId, c.sessionId, null, 180000);
    const owned = lease;
    job.startHeartbeat(async () => { lease = await job.wait(p.owner.renew(owned, 180000), this.d.config.budgets.persistenceTimeoutMs); });
    const input = await p.messages.get(c.userId, c.sessionId, a.causal.userMessageId);
    const marker = await p.metadata.getAcceptance(c.userId, c.sessionId, a.attemptId);
    if (!input || !marker || input.turnId !== a.turnId || hashPayload(input.content) !== a.payloadHash)
      throw new AppError('NOT_READY', 'Accepted input needs recovery.');
    const context = await this.checkBoundary(owned, job, a.turnId, input.content);
    if (context.contextVersion !== a.contextVersion || context.instructionVersion !== a.instructionVersion ||
      context.knowledgeContentHash !== a.knowledgeContentHash || context.graphSchemaVersion !== a.graphSchemaVersion)
      throw new AppError('NOT_READY', 'Accepted context versions changed.');
    const reservation = await p.owner.allocateSequences(owned, a.attemptId, a.causal.previousAttemptId === null ? 3 : 2);
    const assistantSequence = reservation.start + (a.causal.previousAttemptId === null ? 2 : 1);
    const graphInput: GraphInput = { attempt: a, assistantSequence };
    await emit({ type: 'turn-accepted', userMessageId: input.messageId });
    a = await transition(p, owned, job, a, 'generating');
    await emit({ type: 'status', status: 'generating', truncated: false });
    const manifest = await p.memory.get(c.userId, c.sessionId);
    if (!manifest) throw new AppError('NOT_READY', 'Chat context needs recovery.');
    const services = createModelServices(this.d.config, this.d.limits, { putAccounting: record =>
      job.wait(p.owner.run(owned, () => p.metadata.putAccounting(record)), this.d.config.budgets.persistenceTimeoutMs) }, this.d.fetcher);
    const adapter = services.createAttemptAdapter({ schemaVersion: 1, kind: 'accounting', userId: a.userId,
      sessionId: a.sessionId, turnId: a.turnId, attemptId: a.attemptId, generationId: null,
      requestedModel: a.modelId, reportedModel: null, reportedProvider: null, promptTokens: null,
      completionTokens: null, cost: null, accountingStatus: 'unknown', outcome: 'generating', startedAt: a.createdAt, endedAt: null },
      async generationId => { a = await transition(p, owned, job, { ...a, generationId }, 'generating'); });
    let projected: AssembledContext = context;
    graph = buildTurnGraph((await p.checkpoints.create()).bind(owned), {
      prepare: async current => {
        job.check();
        if (current.attempt.attemptId !== a.attemptId || !await p.owner.fence(owned)) throw new AppError('INTERRUPTED', 'Execution ownership was lost.');
        const assembled = await this.d.assembler.assemble({ userId: a.userId, sessionId: a.sessionId, turnId: a.turnId, newUserInput: input.content });
        if (!assembled.ok) throw new AppError('CONTEXT_BUDGET_EXCEEDED', assembled.overflow.message, false);
        if (!isDeepStrictEqual(assembled.context, context)) throw new AppError('NOT_READY', 'Chat context changed before inference.');
        projected = assembled.context;
      },
      generate: async current => {
        let ended = false; let length = false;
        for await (const chunk of adapter.stream({ modelId: a.modelId, user: a.openRouterUser, messages: projected.messages,
          maxOutputTokens: this.d.config.budgets.maxOutputTokens, abortSignal: job.signal, transforms: [],
          dataCollection: this.d.config.openRouter.dataCollection })) {
          job.check();
          if (ended) throw new AppError('PROVIDER_ERROR', 'The model response was invalid.', false);
          switch (chunk.type) {
            case 'comment': break;
            case 'generation-id': if (a.generationId !== chunk.generationId) throw new AppError('PERSISTENCE_ERROR', 'Generation identity was not saved.', false); break;
            case 'delta': partial += chunk.text; await emit({ type: 'delta', text: chunk.text }); break;
            case 'usage': await emit({ ...chunk }); break;
            case 'length': length = true; break;
            case 'error': throw new AppError('PROVIDER_ERROR', 'The model service could not answer.', false);
            case 'end': ended = true; break;
          }
        }
        if (!ended) throw new AppError('INTERRUPTED', 'The response stream ended early.', false);
        const accounting = adapter.accounting.snapshot(a.userId, a.sessionId, a.attemptId);
        if (!accounting) throw new AppError('PERSISTENCE_ERROR', 'The model accounting was not saved.', false);
        const assistant: MessageRecord = { schemaVersion: 1, userId: a.userId, sessionId: a.sessionId, turnId: a.turnId,
          attemptId: a.attemptId, messageId: outputId(a), eventId: eventIdFor(a.userId, a.sessionId, outputId(a)),
          sequence: current.assistantSequence, role: 'assistant', content: partial,
          createdAt: accounting.endedAt ?? this.now(), completionStatus: 'streaming', truncated: false };
        const history = await p.messages.getReferences(a.userId, a.sessionId, manifest.messageRefs);
        const target = buildReferenceManifest(a.userId, a.sessionId, manifest.contextVersion + 1,
          [...history.filter(m => m.messageId !== input.messageId), input,
            { ...assistant, completionStatus: length ? 'truncated' : 'completed', truncated: length }], this.d.assets, this.d.config.budgets);
        return { input: current, assistant, accounting, base: boundaryFor(manifest), target, outcome: length ? 'truncated' : 'completed' };
      },
    });
    await job.wait(graph.invoke({ input: graphInput, result: null, sealed: false, rebase: null }, { ...graphConfig(a.userId, a.sessionId), signal: job.signal }),
      this.d.config.budgets.totalRunTimeoutMs);
    const complete = await graph.getState(graphConfig(a.userId, a.sessionId));
    if (!complete.values.sealed || complete.next.length || !complete.values.result || !complete.config.configurable?.checkpoint_id)
      throw new AppError('PERSISTENCE_ERROR', 'The graph save could not be confirmed.', false);
    const finalResult = resultSchema.parse(complete.values.result);
    saved = finalResult;
    a = await transition(p, owned, job, a, 'finalizing');
    // Saved result now wins over cancellation/disconnect; a failed sink is not a failed answer.
    try { await emit({ type: 'status', status: 'finalizing', truncated: false }); } catch { /* Durable finalization proceeds. */ }
    a = await publishResult(p, owned, job, graph, a, finalResult);
    await job.stopHeartbeat(); await job.settled();
    await job.wait(p.owner.clearAttempt(owned, a.attemptId), this.d.config.budgets.persistenceTimeoutMs);
    await p.owner.release(owned); lease = undefined;
    try {
      await emit({ type: 'status', status: a.status, truncated: a.truncated });
      await emit({ type: 'completed', assistantMessageId: finalResult.assistant.messageId, outcome: finalResult.outcome });
    } catch { /* Stored status and transcript are authoritative on reconnect. */ }
  } catch (error) {
    const outcomeError = job.signal.aborted ? job.failure() : error;
    job.abort('INTERRUPTED');
    await job.stopHeartbeat(); await job.settled(); await p.owner.drain();
    if (lease && graph) {
      const snap = await graph.getState(graphConfig(a.userId, a.sessionId));
      if (snap.values.sealed && !snap.next.length && snap.values.result?.input.attempt.attemptId === a.attemptId) saved = snap.values.result;
    }
    if (lease && saved) {
      const durable = await p.metadata.getAttempt(a.userId, a.sessionId, a.attemptId);
      if (durable && durable.status === 'generating') await transition(p, lease, job, durable, 'finalizing');
      this.work.degraded = true; // Keep active slot for record-driven recovery; no false failed terminal.
    } else if (lease) {
      await this.interruptOwned(lease, job, a, partial, outcomeError);
      const status = await this.getTurnStatus(a.userId, a.sessionId, a.turnId);
      if (terminal(status.status)) {
        try {
          for (const event of [{ type: 'status', status: status.status, truncated: status.truncated },
            ...(status.error ? [{ type: 'error', ...status.error }] : [])])
            await job.wait(c.emit(streamEnvelopeSchema.parse({ protocolVersion: 1, sessionId: a.sessionId,
              turnId: a.turnId, attemptId: a.attemptId, sequence: sequence++, event })), this.d.config.budgets.idleStreamTimeoutMs);
        } catch { /* Disconnected client reads durable status later. */ }
      }
    }
    throw error instanceof AppError ? error : new AppError('PERSISTENCE_ERROR', 'The chat could not be saved.', false);
  } finally {
    await job.stopHeartbeat(); await job.settled(); await p.owner.drain();
    if (lease) await p.owner.release(lease);
    job.close();
  }
}
```

Two integration rules must hold before claiming this task green:

1. Finalization has a separate cleanup/persistence budget, not the aborted provider signal. `Work.wait` does not reject on abort, so saved-result writes remain possible. `emit` can fail but must not prevent publication. The displayed sequence stops heartbeat and awaits tracked renewal before clearing/releasing; retain that ordering.
2. `interruptOwned` is implemented in Task 9; write its failure regression first. For incremental commits do not export/claim runtime completeness until that method is present. If lease expired, release only after tasks settle; preserve active slot and report interrupted/persistence failure for explicit reconciliation under a fresh lease, not an unfenced write.

- [ ] **Step 4 — Add honest provider/failure tests before completing Task 9**:

```typescript
it.each(['errorBefore', 'errorAfter', 'eof', 'finishEof', 'onlyDone', 'malformed'] as const)('never emits completion on %s', async fixture => {
  const h = await nativeHarness(FRAMES[fixture]);
  try {
    const runtime = new DurableChatRuntime(h.deps); const events: StreamEnvelope[] = [];
    const ids = await runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
    await expect(runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
      emit: async e => { events.push(e); } })).rejects.toThrow();
    expect(events.some(e => e.event.type === 'completed')).toBe(false);
    expect((await h.persistence.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status).not.toBe('completed');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  } finally { await h.close(); }
}, 30000);
it('disconnect after a delta interrupts and preserves a bounded incomplete archive record', async () => {
  const h = await nativeHarness();
  try {
    const runtime = new DurableChatRuntime(h.deps); const controller = new AbortController();
    const ids = await runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
    await expect(runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: controller.signal,
      emit: async e => { if (e.event.type === 'delta') controller.abort(); } })).rejects.toThrow();
    expect((await runtime.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('interrupted');
    const messages = await archiveRecords(h.persistence, h.identity.userId, ids.sessionId);
    expect(messages.find(m => m.role === 'assistant')).toMatchObject({ completionStatus: 'interrupted' });
    expect((await h.persistence.memory.get(h.identity.userId, ids.sessionId))?.messageRefs.map(r => r.messageId)).toEqual([ids.userMessageId]);
  } finally { await h.close(); }
}, 30000);
```

Add `archiveRecords` import to lifecycle spec. Run lifecycle and type checks after Task 9 supplies fallback/status methods. No routine test may hit real OpenRouter. Events must exclude provider comments/IDs, checkpoint data, private instructions, and reasoning.

- [ ] **Step 5 — Commit Task 8+9 together only after both are green** (Task 9's named list includes this source/spec). This dependency prevents committing an undefined fallback as supposedly working lifecycle code.

### Task 9: Implement no-replay reconciliation and interrupted fallback

**Files:** Create `backend/src/chat-runtime/reconciliation.ts`; extend runtime/finalization/recovery/lifecycle specs.

- [ ] **Step 1 — Write the required behavioral crash test before recovery wiring**:

```typescript
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import { archiveRecords } from '../../src/chat-runtime/history.js';
it('recovers a sealed graph answer after archive failure without reinference and is repeatable', async () => {
  const h = await nativeHarness();
  try {
    const runtime = new DurableChatRuntime(h.deps);
    const ids = await runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
    const append = h.persistence.messages.append.bind(h.persistence.messages);
    const failure = vi.spyOn(h.persistence.messages, 'append').mockImplementation(async m => {
      if (m.role === 'assistant') throw new Error('fixture crash before archive write');
      return append(m);
    });
    await expect(runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
      emit: async () => undefined })).rejects.toThrow();
    failure.mockRestore();
    expect((await runtime.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('finalizing');
    const restarted = new DurableChatRuntime(h.deps);
    await restarted.reconcileSession(h.identity.userId, ids.sessionId);
    await restarted.reconcileSession(h.identity.userId, ids.sessionId);
    expect((await restarted.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('completed');
    expect((await archiveRecords(h.persistence, h.identity.userId, ids.sessionId)).map(m => m.role)).toEqual(['user', 'assistant']);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  } finally { await h.close(); }
}, 30000);
it('interrupts accepted work with no sealed result and never starts inference during recovery', async () => {
  const h = await nativeHarness();
  try {
    const r = new DurableChatRuntime(h.deps);
    const ids = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
    await r.reconcileSession(h.identity.userId, ids.sessionId);
    await r.reconcileSession(h.identity.userId, ids.sessionId);
    expect((await r.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('interrupted');
    expect(h.fetcher).not.toHaveBeenCalled();
    expect((await archiveRecords(h.persistence, h.identity.userId, ids.sessionId)).filter(m => m.role === 'user')).toHaveLength(1);
  } finally { await h.close(); }
}, 30000);
```

- [ ] **Step 2 — Run red:** recovery command; missing recovery methods. Verify assertions reach the intended crash window, not a fixture/setup error.
- [ ] **Step 3 — Create interruption helper and add runtime recovery methods**:

```typescript
// backend/src/chat-runtime/reconciliation.ts
import type { PersistenceBundle } from '../persistence/persistence.js';
import type { ExecutionLease } from '../contracts/repositories.js';
import type { AttemptRecord } from '../contracts/attempt.js';
import type { FixedAssets } from '../instructions/fixed-assets.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import type { TurnGraph } from '../agent/turn-graph.js';
import { buildReferenceManifest } from '../context/index.js';
import { boundaryFor } from '../agent/state.js';
import { AppError } from '../platform/errors/app-error.js';
import { hashPayload } from '../platform/crypto/hash-payload.js';
import { outputId, eventIdFor } from './identity.js';
import { acceptedHistory } from './history.js';
import { graphConfig, terminal, transition } from './finalization.js';
import type { Work } from './work.js';
export async function interruptAttempt(options: { p: PersistenceBundle; lease: ExecutionLease; job: Work;
  graph: TurnGraph; attempt: AttemptRecord; partial: string; error: unknown; assets: FixedAssets; budgets: BudgetConfig }) {
  const { p, lease, job, graph, partial, budgets } = options; let a = options.attempt;
  if (terminal(a.status)) return a;
  const input = await p.messages.get(a.userId, a.sessionId, a.causal.userMessageId);
  let marker = await p.metadata.getAcceptance(a.userId, a.sessionId, a.attemptId);
  if (!marker && input && input.role === 'user' && input.turnId === a.turnId && hashPayload(input.content) === a.payloadHash) {
    await job.wait(p.owner.confirmAcceptance(lease, a.attemptId), budgets.persistenceTimeoutMs);
    marker = await p.metadata.getAcceptance(a.userId, a.sessionId, a.attemptId);
  }
  const fault = options.error instanceof AppError ? options.error : new AppError('PERSISTENCE_ERROR', 'The chat could not be saved.', false);
  const status = fault.code === 'CANCELLED' ? 'cancelled' : ['INTERRUPTED', 'TIMEOUT', 'NOT_READY'].includes(fault.code) ? 'interrupted' : 'failed';
  const reservation = await p.owner.allocateSequences(lease, a.attemptId, a.causal.previousAttemptId === null ? 3 : 2);
  const existing = await p.messages.get(a.userId, a.sessionId, outputId(a));
  if (partial && !existing) await job.wait(p.owner.run(lease, () => p.messages.append({ schemaVersion: 1,
    userId: a.userId, sessionId: a.sessionId, turnId: a.turnId, attemptId: a.attemptId,
    messageId: outputId(a), eventId: eventIdFor(a.userId, a.sessionId, outputId(a)),
    sequence: reservation.start + (a.causal.previousAttemptId === null ? 2 : 1), role: 'assistant', content: partial,
    createdAt: a.updatedAt, completionStatus: status, truncated: false })), budgets.persistenceTimeoutMs);
  // Never overwrite an already-durable incomplete message after a crash.
  const current = await p.memory.get(a.userId, a.sessionId);
  const history = await acceptedHistory(p, a.userId, a.sessionId);
  const targetRecords = marker && input && !history.some(m => m.messageId === input.messageId) ? [...history, input] : history;
  const assets = { ...options.assets, instructionVersion: a.instructionVersion,
    knowledgeContentHash: a.knowledgeContentHash, graphSchemaVersion: a.graphSchemaVersion };
  const candidate = buildReferenceManifest(a.userId, a.sessionId, current?.contextVersion ?? 0, targetRecords, assets, budgets);
  const next = current && JSON.stringify(current) !== JSON.stringify(candidate)
    ? { ...candidate, contextVersion: current.contextVersion + 1 } : candidate;
  await job.wait(p.owner.run(lease, () => p.memory.put(next)), budgets.persistenceTimeoutMs);
  await job.wait(graph.updateState(graphConfig(a.userId, a.sessionId), { boundary: boundaryFor(next),
    input: null, result: null, sealed: false }, 'seal'), budgets.persistenceTimeoutMs);
  const accounting = await p.metadata.getAccounting(a.userId, a.sessionId, a.attemptId);
  await job.wait(p.owner.run(lease, () => p.metadata.putAccounting({ ...(accounting ?? {
    schemaVersion: 1 as const, kind: 'accounting' as const, userId: a.userId, sessionId: a.sessionId, turnId: a.turnId,
    attemptId: a.attemptId, generationId: a.generationId, requestedModel: a.modelId, reportedModel: null, reportedProvider: null,
    promptTokens: null, completionTokens: null, cost: null, accountingStatus: a.generationId ? 'pending' as const : 'unknown' as const,
    startedAt: a.createdAt, endedAt: a.updatedAt }), outcome: status })), budgets.persistenceTimeoutMs);
  a = await transition(p, lease, job, a, status, fault.code);
  await job.wait(p.owner.clearAttempt(lease, a.attemptId), budgets.persistenceTimeoutMs);
  return a;
}
```

Add import `interruptAttempt` to runtime and add these methods:

```typescript
async interruptOwned(lease: ExecutionLease, job: Work, a: AttemptRecord, partial: string, error: unknown) {
  if (!await this.d.persistence.owner.fence(lease)) { this.work.degraded = true; return; }
  return interruptAttempt({ p: this.d.persistence, lease, job, graph: await this.graph(lease),
    attempt: a, partial, error, assets: this.d.assets, budgets: this.d.config.budgets });
}
async reconcileSession(u: string, s: string): Promise<void> {
  const p = this.d.persistence;
  if (u !== this.d.config.identity.userId) throw new AppError('NOT_FOUND', 'Chat not found.');
  if (this.work.get(u, s)) throw new AppError('CONFLICT_ACTIVE_TURN', 'Chat work is still active.');
  await p.owner.assertExecutor(); await p.owner.drain();
  const session = await p.sessions.get(u, s);
  if (!session) throw new AppError('NOT_FOUND', 'Chat not found.');
  const readGraph = await this.graph({ userId: u, sessionId: s, ownerId: p.owner.executorId,
    generation: session.execution.generation, leaseExpiresAt: this.now() });
  const pendingRebase = (await readGraph.getState(graphConfig(u, s))).values.rebase;
  if (session.execution.activeAttemptId === null && session.execution.ownerId === null && !pendingRebase) return;
  if (session.execution.ownerId && session.execution.ownerId !== p.owner.executorId && !this.stoppedOwners.has(session.execution.ownerId))
    throw new AppError('NOT_READY', 'Stopped-executor recovery has not been authorized.');
  const job = this.work.open(u, s, new AbortController().signal, this.d.config.budgets.totalRunTimeoutMs);
  let lease: ExecutionLease | undefined;
  try {
    lease = await p.owner.recoverStoppedSession(u, s, session.execution.ownerId, 180000);
    const aId = session.execution.activeAttemptId;
    const graph = await this.graph(lease); const snap = await graph.getState(graphConfig(u, s));
    if (snap.values.rebase) {
      if (aId) throw new AppError('NOT_READY', 'A version rebase cannot overlap an active turn.');
      await finishRebase(p, lease, job, graph, rebaseSchema.parse(snap.values.rebase));
      return;
    }
    if (!aId) return;
    let a = await p.metadata.getAttempt(u, s, aId);
    if (!a) {
      const orphan = await p.messages.get(u, s, inputId(u, s, aId));
      if (orphan && (orphan.role !== 'user' || orphan.attemptId !== null)) throw new AppError('NOT_READY', 'Orphaned acceptance needs operator repair.');
      await job.wait(p.owner.clearAttempt(lease, aId), this.d.config.budgets.persistenceTimeoutMs);
      return; // Preserve original; a repeated identical submission can finish acceptance.
    }
    if (snap.values.sealed && !snap.next.length && snap.values.result?.input.attempt.attemptId === aId) {
      if (a.status === 'generating') a = await transition(p, lease, job, a, 'finalizing');
      if (!['finalizing', 'completed', 'truncated'].includes(a.status)) throw new AppError('NOT_READY', 'Saved result and attempt disagree.');
      await publishResult(p, lease, job, graph, a, snap.values.result);
      await job.wait(p.owner.clearAttempt(lease, aId), this.d.config.budgets.persistenceTimeoutMs);
    } else if (terminal(a.status)) {
      if (['completed', 'truncated'].includes(a.status)) throw new AppError('NOT_READY', 'Completed turn is missing graph evidence.');
      await job.wait(p.owner.clearAttempt(lease, aId), this.d.config.budgets.persistenceTimeoutMs);
    } else await interruptAttempt({ p, lease, job, graph, attempt: a, partial: '',
      error: new AppError('INTERRUPTED', 'Generation was interrupted. Retry to continue.', false), assets: this.d.assets, budgets: this.d.config.budgets });
  } finally {
    await job.settled(); await p.owner.drain(); if (lease) await p.owner.release(lease); job.close();
  }
}
async getTurnStatus(u: string, s: string, t: string) {
  if (u !== this.d.config.identity.userId) throw new AppError('NOT_FOUND', 'Turn not found.');
  const a = await latestAttempt(this.d.persistence, u, s, t);
  const error = a.errorCode ? new AppError(a.errorCode,
    a.errorCode === 'CANCELLED' ? 'Generation was cancelled.' : 'This response is incomplete. Retry or start a new chat.',
    ['failed', 'cancelled', 'interrupted'].includes(a.status)).toClientBody() : null;
  return turnStatusResponseSchema.parse({ sessionId: s, turnId: t, attemptId: a.attemptId,
    status: a.status, truncated: a.truncated, error });
}
```

Preserve the displayed cancellation reason ordering: capture `outcomeError` **before** cleanup abort, then pass it unchanged into `interruptAttempt`; `interruptOwned` must not reread the cleanup-aborted signal. Otherwise provider auth/credits/errors would incorrectly become interrupted. This regression belongs to the error fixtures above.

Add strict target construction check to `checkedResult`, before returning `r`:

```typescript
const current = await p.memory.get(a.userId, a.sessionId);
if (!current) throw new AppError('NOT_READY', 'Chat context needs recovery.');
const history = await p.messages.getReferences(a.userId, a.sessionId, current.messageRefs);
const prior = history.filter(m => m.messageId !== input.messageId && m.messageId !== r.assistant.messageId);
const expected = buildReferenceManifest(a.userId, a.sessionId, r.target.contextVersion,
  [...prior, input, { ...r.assistant, completionStatus: r.outcome, truncated: r.outcome === 'truncated' }],
  { instructions: '', knowledge: '', instructionVersion: a.instructionVersion,
    knowledgeContentHash: a.knowledgeContentHash, graphSchemaVersion: a.graphSchemaVersion }, p.memory.budgets);
if (!isDeepStrictEqual(expected, r.target)) throw new AppError('NOT_READY', 'Saved context references disagree.');
```

Add `buildReferenceManifest` import to finalization. If current is target and its assistant is still streaming, fetch original and project saved completion only for expected manifest construction. Do not use current assets to reinterpret an old result. Validate current checkpoint boundary is either exact `r.base` or `boundaryFor(r.target)`; arbitrary boundary mismatch is a recovery failure, not permission to overwrite. Validate generation ID and accounting known values from P2 rather than replacing them with null.

- [ ] **Step 4 — Run green** lifecycle/recovery/acceptance suites + full type check. Add each mandatory crash-window case as a test in recovery spec before its fix:

```typescript
it.each(['memory', 'checkpoint-boundary', 'assistant-terminal', 'attempt-terminal', 'slot-clear'] as const)
('replays %s publication window without a second POST', async window => {
  const h = await nativeHarness();
  try {
    const runtime = new DurableChatRuntime(h.deps);
    const ids = await runtime.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
    const p = h.persistence;
    let spy: { mockRestore(): void };
    if (window === 'memory') spy = vi.spyOn(p.memory, 'put').mockRejectedValueOnce(new Error('crash before memory'));
    else if (window === 'assistant-terminal') spy = vi.spyOn(p.messages, 'updateCompletion').mockRejectedValueOnce(new Error('crash before message terminal'));
    else if (window === 'attempt-terminal') {
      const original = p.metadata.compareAttempt.bind(p.metadata);
      spy = vi.spyOn(p.metadata, 'compareAttempt').mockImplementation(async (a, expected) => {
        if (a.status === 'completed') throw new Error('crash before attempt terminal'); return original(a, expected);
      });
    } else if (window === 'slot-clear') spy = vi.spyOn(p.owner, 'clearAttempt').mockRejectedValueOnce(new Error('crash before slot clear'));
    else {
      const { ScopedMongoSaver } = await import('../../src/persistence/checkpoints.js');
      const original = ScopedMongoSaver.prototype.put;
      spy = vi.spyOn(ScopedMongoSaver.prototype, 'put').mockImplementation(async function (...args) {
        if (args[2].source === 'update') throw new Error('crash before boundary checkpoint');
        return original.apply(this, args);
      });
    }
    try { await expect(runtime.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
      emit: async () => undefined })).rejects.toThrow(); } finally { spy.mockRestore(); }
    const restarted = new DurableChatRuntime(h.deps);
    await restarted.reconcileSession(h.identity.userId, ids.sessionId);
    await restarted.reconcileSession(h.identity.userId, ids.sessionId);
    expect((await restarted.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('completed');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect((await archiveRecords(p, h.identity.userId, ids.sessionId)).filter(m => m.role === 'user')).toHaveLength(1);
    expect((await archiveRecords(p, h.identity.userId, ids.sessionId)).filter(m => m.role === 'assistant')).toHaveLength(1);
  } finally { await h.close(); }
}, 30000);
```

For checkpoint-boundary fault, install the spy **after acceptance** (its initial update must not fail). A committed-but-unacknowledged put requires a second regression: call original `put`, then throw once; recovery rereads state and never infers again. For the memory fault, do not fail initial empty-manifest initialization. Add graph terminal-checkpoint failure/no seal → interrupted, wrong attempt ID/schema/version/tampered result/target → `NOT_READY`, orphan user without attempt → no new input on same-key resubmit, missing original input → interrupted but retry blocked, and terminal slot cleanup tests. Use P2 record/saver spies, not production crash-hook switches.

- [ ] **Step 5 — Commit completed lifecycle/recovery together**:

```powershell
git add backend/src/chat-runtime/durable-chat-runtime.ts backend/src/chat-runtime/finalization.ts backend/src/chat-runtime/reconciliation.ts backend/test/runtime/lifecycle.native.e2e-spec.ts backend/test/runtime/recovery.native.e2e-spec.ts
git commit -m "feat(p5): execute durable turns and reconcile results without inference replay"
```

### Task 10: Explicit retry/cancel, duplicate join, and bounded storage preflight

**Files:** Extend runtime, acceptance/lifecycle/recovery specs.

- [ ] **Step 1 — Add failing retry/cancel tests**:

```typescript
it('explicit retry links a new attempt to the original accepted input once', async () => {
  const h = await nativeHarness();
  try {
    const r = new DurableChatRuntime(h.deps);
    const ids = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
    await r.reconcileSession(h.identity.userId, ids.sessionId);
    const command = { identity: h.identity, sessionId: ids.sessionId, turnId: ids.turnId, idempotencyKey: 'retry-key-0001' };
    const retry = await r.retryTurn(command);
    expect(await r.retryTurn(command)).toEqual(retry);
    expect(retry.userMessageId).toBe(ids.userMessageId); expect(retry.turnId).toBe(ids.turnId);
    expect(retry.attemptId).not.toBe(ids.attemptId);
    await r.executeTurn({ userId: h.identity.userId, ...retry, signal: new AbortController().signal, emit: async () => undefined });
    const body = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
    expect(body.messages.filter((m: { role: string; content: string }) => m.role === 'user' && m.content === 'Hello')).toHaveLength(1);
    expect((await archiveRecords(h.persistence, h.identity.userId, ids.sessionId)).filter(m => m.role === 'user')).toHaveLength(1);
    expect((await h.persistence.metadata.getAttempt(h.identity.userId, ids.sessionId, retry.attemptId))?.causal.previousAttemptId).toBe(ids.attemptId);
  } finally { await h.close(); }
}, 30000);
```

Add `archiveRecords` import to acceptance spec. Add lifecycle test:

```typescript
it('cancel after a delta aborts the active attempt; stale cancel cannot cancel a retry', async () => {
  const h = await nativeHarness();
  try {
    const r = new DurableChatRuntime(h.deps);
    const ids = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
    await expect(r.executeTurn({ userId: h.identity.userId, ...ids, signal: new AbortController().signal,
      emit: async e => { if (e.event.type === 'delta') await r.cancelTurn({ identity: h.identity,
        sessionId: ids.sessionId, turnId: ids.turnId, attemptId: ids.attemptId }); } })).rejects.toThrow();
    expect((await r.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('cancelled');
    const retry = await r.retryTurn({ identity: h.identity, sessionId: ids.sessionId, turnId: ids.turnId, idempotencyKey: 'retry-key-0001' });
    await expect(r.cancelTurn({ identity: h.identity, sessionId: ids.sessionId, turnId: ids.turnId,
      attemptId: ids.attemptId })).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
    expect(retry.attemptId).not.toBe(ids.attemptId);
  } finally { await h.close(); }
}, 30000);
```

- [ ] **Step 2 — Run red:** acceptance/lifecycle native suites.
- [ ] **Step 3 — Add retry/cancel methods**:

```typescript
async retryTurn(c: RetryTurnCommand) {
  const id = this.identity(c.identity); this.ready(); retryTurnRequestSchema.parse({ idempotencyKey: c.idempotencyKey });
  const p = this.d.persistence; const session = await p.sessions.get(id.userId, c.sessionId);
  if (!session || session.latestTurnId !== c.turnId) throw new AppError('CONFLICT_ACTIVE_TURN', 'Only the latest incomplete turn can be retried.');
  const prior = await latestAttempt(p, id.userId, c.sessionId, c.turnId);
  const original = await p.messages.get(id.userId, c.sessionId, prior.causal.userMessageId);
  const duplicate = await p.metadata.getAttemptByIdempotency(id.userId, c.sessionId, c.idempotencyKey);
  if (duplicate) {
    if (duplicate.turnId !== c.turnId || duplicate.causal.previousAttemptId === null ||
      !original || duplicate.payloadHash !== hashPayload(original.content))
      throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'This retry identity has different input.');
    if (!await p.metadata.getAcceptance(id.userId, c.sessionId, duplicate.attemptId)) throw new AppError('NOT_READY', 'Retry acceptance needs recovery.');
    return responseFor(duplicate);
  }
  const attempts = (await attemptsFor(p, id.userId, c.sessionId)).filter(a => a.turnId === c.turnId);
  if (!['failed', 'cancelled', 'interrupted'].includes(prior.status) || attempts.length >= 3)
    throw new AppError('CONFLICT_ACTIVE_TURN', 'This turn cannot be retried. Start a new chat.');
  if (!original || original.role !== 'user' || hashPayload(original.content) !== prior.payloadHash ||
    !await p.metadata.getAcceptance(id.userId, c.sessionId, prior.attemptId)) throw new AppError('NOT_READY', 'Original input needs recovery.');
  const job = this.work.open(id.userId, c.sessionId, new AbortController().signal, this.d.config.budgets.totalRunTimeoutMs);
  let lease: ExecutionLease | undefined;
  try {
    const owned = await p.owner.acquire({ userId: id.userId, sessionId: c.sessionId, ownerId: p.owner.executorId, leaseMs: 180000 });
    if (!owned.ok) throw new AppError('CONFLICT_ACTIVE_TURN', 'Another turn is active.'); lease = owned.lease;
    const context = await this.checkBoundary(lease, job, c.turnId, original.content);
    const aId = attemptIdFor(id.userId, c.sessionId, c.idempotencyKey);
    await job.wait(p.owner.reserveAttempt(lease, aId), this.d.config.budgets.persistenceTimeoutMs);
    const reservation = await p.owner.allocateSequences(lease, aId, 2); const at = this.now();
    const a: AttemptRecord = { ...prior, attemptId: aId, idempotencyKey: c.idempotencyKey, status: 'accepted',
      sequence: reservation.start, createdAt: at, updatedAt: at, generationId: null, truncated: false, errorCode: null,
      contextVersion: context.contextVersion, instructionVersion: context.instructionVersion, knowledgeContentHash: context.knowledgeContentHash,
      graphSchemaVersion: context.graphSchemaVersion, modelId: this.d.config.openRouter.modelId, openRouterUser: id.openRouterUser,
      causal: { userMessageId: original.messageId, previousAttemptId: prior.attemptId } };
    await job.wait(p.owner.run(lease, () => p.metadata.putAttempt(a)), this.d.config.budgets.persistenceTimeoutMs);
    await job.wait(p.owner.confirmAcceptance(lease, aId), this.d.config.budgets.persistenceTimeoutMs);
    return responseFor(a);
  } finally { await job.settled(); await p.owner.drain(); if (lease) await p.owner.release(lease); job.close(); }
}
async cancelTurn(c: CancelTurnCommand): Promise<void> {
  const id = this.identity(c.identity); const p = this.d.persistence;
  const a = await latestAttempt(p, id.userId, c.sessionId, c.turnId);
  if (a.attemptId !== c.attemptId) throw new AppError('CONFLICT_ACTIVE_TURN', 'This attempt is no longer current.');
  if (terminal(a.status) || a.status === 'finalizing') return;
  const active = this.work.get(id.userId, c.sessionId);
  if (active) { active.abort('CANCELLED'); return; } // Accepted response is request-owned cancellation acknowledgment, not terminal proof.
  const session = await p.sessions.get(id.userId, c.sessionId);
  if (!session || session.execution.ownerId !== null) throw new AppError('NOT_READY', 'Turn needs recovery before cancellation.');
  const job = this.work.open(id.userId, c.sessionId, new AbortController().signal, this.d.config.budgets.totalRunTimeoutMs);
  let lease: ExecutionLease | undefined;
  try {
    lease = await p.owner.recoverStoppedSession(id.userId, c.sessionId, null, 180000);
    await interruptAttempt({ p, lease, job, graph: await this.graph(lease), attempt: a, partial: '',
      error: new AppError('CANCELLED', 'Generation was cancelled.', false), assets: this.d.assets, budgets: this.d.config.budgets });
  } finally { await job.settled(); await p.owner.drain(); if (lease) await p.owner.release(lease); job.close(); }
}
```

**Duplicate bounded join implementation:** Add an acceptance-only map `private accepting = new Map<string, Promise<SubmitTurnResponse>>()` keyed by JSON `[userId,sessionId,idempotencyKey]`, with payload hash stored alongside the promise. Wrap `submitTurn`'s acceptance body in a registered promise **before its first await**, remove in `finally`, and return the same promise for matching content. Changed content throws immediately. Apply the same wrapper to retry with original logical turn identity. Bound map cardinality by the same global admission cap, remove settled promises, and retain no transcript/event cache. Cross-process dedup remains P2's durable key+sentinel, not this map. Add the precise test:

```typescript
it('identical simultaneous new-chat requests join acceptance without duplicate input', async () => {
  const h = await nativeHarness();
  try {
    const r = new DurableChatRuntime(h.deps); const c = { identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' };
    const results = await Promise.all([r.submitTurn(c), r.submitTurn(c)]);
    expect(results[0]).toEqual(results[1]);
    expect((await archiveRecords(h.persistence, h.identity.userId, results[0].sessionId)).filter(m => m.role === 'user')).toHaveLength(1);
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.close(); }
}, 30000);
```

Add a complete generic join helper (inside runtime, with imported `SubmitTurnResponse`):

```typescript
private accepting = new Map<string, { hash: string; promise: Promise<SubmitTurnResponse> }>();
private joinAcceptance(key: string, hash: string, action: () => Promise<SubmitTurnResponse>) {
  const existing = this.accepting.get(key);
  if (existing) {
    if (existing.hash !== hash) throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'This request identity has different input.');
    return existing.promise;
  }
  if (this.accepting.size >= this.d.config.budgets.maxConcurrentGenerationsPerProcess)
    throw new AppError('CONCURRENCY_LIMIT', 'Too many chat requests are active.');
  const promise = Promise.resolve().then(action);
  this.accepting.set(key, { hash, promise });
  void promise.then(() => this.accepting.delete(key), () => this.accepting.delete(key));
  return promise;
}
```

Rename displayed acceptance bodies `acceptNewTurn`/`acceptRetry` and add wrappers `submitTurn(c)`/`retryTurn(c)` that compute the key synchronously and call `joinAcceptance`. For retry, join hash uses `JSON.stringify(['retry',c.turnId])`; persisted `payloadHash` still hashes original content. New submission and retry cannot reuse a key as different operations. Do not use `AppError.retryable` alone as retry permission.

```typescript
// Add inside DurableChatRuntime after renaming the two acceptance bodies:
submitTurn(c: SubmitTurnCommand) {
  const identity = this.identity(c.identity); this.ready();
  const body = submitTurnRequestSchema.parse({ sessionId: c.sessionId, content: c.content, idempotencyKey: c.idempotencyKey });
  const session = sessionIdFor(identity.userId, body.sessionId, body.idempotencyKey);
  return this.joinAcceptance(JSON.stringify([identity.userId, session, c.idempotencyKey]),
    hashPayload(JSON.stringify(['submit', body.content])), () => this.acceptNewTurn(c));
}
retryTurn(c: RetryTurnCommand) {
  const identity = this.identity(c.identity); this.ready();
  retryTurnRequestSchema.parse({ idempotencyKey: c.idempotencyKey });
  return this.joinAcceptance(JSON.stringify([identity.userId, c.sessionId, c.idempotencyKey]),
    hashPayload(JSON.stringify(['retry', c.turnId])), () => this.acceptRetry(c));
}
```

**Storage preflight implementation:** Add P2 `bounded`, `key`, `assertBytes` and P1 `messageRecordSchema` imports. Before model adapter creation construct the empty assistant envelope and derive its budget as shown (same IDs/sequence/createdAt lengths as the eventual saved result):

```typescript
const emptyOutput = { schemaVersion: 1 as const, userId: a.userId, sessionId: a.sessionId, turnId: a.turnId,
  attemptId: a.attemptId, messageId: outputId(a), eventId: eventIdFor(a.userId, a.sessionId, outputId(a)),
  sequence: assistantSequence, role: 'assistant' as const, content: '', createdAt: a.createdAt,
  completionStatus: 'streaming' as const, truncated: false };
const headroom = bounded(messageRecordSchema, emptyOutput, key('message', a.userId, a.sessionId, outputId(a)), this.d.config.budgets.maxMessageBytes).bytes;
const maxVisibleBytes = this.d.config.budgets.maxMessageBytes - headroom;
if (maxVisibleBytes < 1) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The answer cannot fit in storage.');
const attemptConfig = { ...this.d.config, budgets: { ...this.d.config.budgets, maxMessageBytes: maxVisibleBytes } };
```

Use `attemptConfig` for P4 only after checking every context message is ≤ reduced limit; do not silently reject previously accepted context under a different budget. Preflight this same derived budget **during acceptance** using deterministic prospective output identity and sequence upper-bound `Number.MAX_SAFE_INTEGER`; if it cannot contain the model context/input or a valid bounded result, reject before acceptance. Use `bounded` for user/attempt/target manifest and `assertBytes`/serializer-bound P2 saver for graph result. Saved output bytes must pass `bounded` again before returning generate result. Use a conservative 256-byte reserve already included in P2 codec, not character counting. Add exact multibyte/envelope boundary assertions; cap before violating output is emitted, never after a terminal stream claim.

- [ ] **Step 4 — Run green:** acceptance/lifecycle/recovery + type/build/lint. Add max-three-attempts, changed retry key payload/other turn, old-turn retry rejection, accepted-before-attach cancellation, cancel after seal, two simultaneous executeTurn attachments (one POST), and terminal reattach without inference tests. Make later turns use a fresh fixture generation ID (P2 correctly rejects assigning one provider ID to two attempts).
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/chat-runtime/durable-chat-runtime.ts backend/test/runtime/acceptance.native.e2e-spec.ts backend/test/runtime/lifecycle.native.e2e-spec.ts backend/test/runtime/recovery.native.e2e-spec.ts
git commit -m "feat(p5): deduplicate acceptance and support bounded explicit retry and cancellation"
```

### Task 11: Export P8 drain/rebase hooks and P6 runtime factory

**Files:** Extend runtime; create `backend/src/chat-runtime/index.ts`, `backend/test/runtime/operations.native.e2e-spec.ts`.

- [ ] **Step 1 — Write failing operation tests**:

```typescript
// backend/test/runtime/operations.native.e2e-spec.ts
import { createChatRuntime } from '../../src/chat-runtime/index.js';
import { nativeHarness } from './native-harness.js';
it('stops admission, never infers accepted work during drain, and leaves it recoverable', async () => {
  const h = await nativeHarness();
  try {
    const r = createChatRuntime(h.deps);
    const ids = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' });
    r.stopAccepting();
    await expect(r.submitTurn({ identity: h.identity, sessionId: ids.sessionId, content: 'Another', idempotencyKey: 'request-0002' }))
      .rejects.toMatchObject({ code: 'NOT_READY' });
    expect(await r.drain(20)).toMatchObject({ drained: true, active: 0, unresolvedWrites: 0 });
    await r.reconcileSession(h.identity.userId, ids.sessionId);
    expect((await r.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('interrupted');
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.close(); }
}, 30000);
```

- [ ] **Step 2 — Run red:** operations native command; missing exported factory/hooks.
- [ ] **Step 3 — Add complete operational exports**:

```typescript
// Add inside DurableChatRuntime:
stopAccepting() { this.work.accepting = false; }
snapshot() { return this.work.snapshot(); }
async drain(timeoutMs = this.d.config.budgets.shutdownDrainMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > this.d.config.budgets.shutdownDrainMs)
    throw new AppError('INVALID_REQUEST', 'Invalid drain budget.');
  const result = await this.work.drain(timeoutMs);
  if (!result.drained) return result;
  await this.d.persistence.owner.drain(); return result;
}
allowStoppedOwner(ownerId: string) {
  if (!ownerId || ownerId.length > 128 || this.work.snapshot().active) throw new AppError('NOT_READY', 'Recovery is not quiescent.');
  this.stoppedOwners.add(ownerId);
}
async rebaseSession(u: string, s: string): Promise<void> {
  const p = this.d.persistence;
  if (u !== this.d.config.identity.userId) throw new AppError('NOT_FOUND', 'Chat not found.');
  if (this.work.get(u, s)) throw new AppError('CONFLICT_ACTIVE_TURN', 'Chat is still active.');
  const session = await p.sessions.get(u, s);
  if (!session || session.execution.activeAttemptId || session.execution.ownerId) throw new AppError('NOT_READY', 'Chat must be reconciled before rebasing.');
  const job = this.work.open(u, s, new AbortController().signal, this.d.config.budgets.totalRunTimeoutMs);
  let lease: ExecutionLease | undefined;
  try {
    const owned = await p.owner.acquire({ userId: u, sessionId: s, ownerId: p.owner.executorId, leaseMs: 180000 });
    if (!owned.ok) throw new AppError('CONFLICT_ACTIVE_TURN', 'Chat is active.'); lease = owned.lease;
    const old = await p.memory.get(u, s); if (!old) throw new AppError('NOT_READY', 'Chat memory is unavailable.');
    const graph = await this.graph(lease); const snap = await graph.getState(graphConfig(u, s));
    if (snap.values.rebase) {
      await finishRebase(p, lease, job, graph, rebaseSchema.parse(snap.values.rebase));
      return;
    }
    if (snap.next.length || !isDeepStrictEqual(snap.values.boundary, boundaryFor(old))) throw new AppError('NOT_READY', 'Graph and memory disagree.');
    const history = await acceptedHistory(p, u, s);
    const oldAssets = { ...this.d.assets, instructionVersion: old.instructionVersion,
      knowledgeContentHash: old.knowledgeContentHash, graphSchemaVersion: old.graphSchemaVersion };
    const verified = buildReferenceManifest(u, s, old.contextVersion, history, oldAssets, this.d.config.budgets);
    if (!isDeepStrictEqual(verified, old) || old.graphSchemaVersion !== this.d.assets.graphSchemaVersion)
      throw new AppError('NOT_READY', 'Chat requires a schema migration, not a version rebase.');
    if (old.instructionVersion === this.d.assets.instructionVersion && old.knowledgeContentHash === this.d.assets.knowledgeContentHash) return;
    const next = buildReferenceManifest(u, s, old.contextVersion + 1, history, this.d.assets, this.d.config.budgets);
    const intent = { base: boundaryFor(old), target: next };
    await job.wait(graph.updateState(graphConfig(u, s), { rebase: intent }, 'seal'), this.d.config.budgets.persistenceTimeoutMs);
    await finishRebase(p, lease, job, graph, intent);
  } finally { await job.settled(); await p.owner.drain(); if (lease) await p.owner.release(lease); job.close(); }
}
```

Asset rebase has a cross-record crash window. Make it repairable without accepting an unexplained mismatch: persist rebase intent in an explicit bounded graph channel (`rebase: {base:Boundary,target:AgentMemoryManifest} | null`) **before** changing memory, using `updateState(...,'seal')`. Rebase replay checks current boundary equals intent base or target and current manifest equals base or target; writes exact target, then target boundary, clears intent. Neither normal acceptance nor inference performs a rebase. `reconcileSession` detects this typed intent even when no active slot exists and finishes it under a fresh lease; its saved manifest contains references/versions only, no transcript. This is a P5 internal graph channel, not a seventh collection or a shared schema change. Implement the following helper in `reconciliation.ts` and call it from both methods:

```typescript
export async function finishRebase(p: PersistenceBundle, lease: ExecutionLease, job: Work, graph: TurnGraph,
  intent: { base: Boundary; target: AgentMemoryManifest }) {
  const current = await p.memory.get(lease.userId, lease.sessionId);
  const target = boundaryFor(intent.target);
  if (!current || (![intent.base, target].some(b => JSON.stringify(b) === JSON.stringify(boundaryFor(current)))))
    throw new AppError('NOT_READY', 'Version rebase evidence disagrees.');
  const snapshot = await graph.getState(graphConfig(lease.userId, lease.sessionId));
  if (snapshot.next.length || ![intent.base, target].some(b => JSON.stringify(b) === JSON.stringify(snapshot.values.boundary)))
    throw new AppError('NOT_READY', 'Version rebase graph evidence disagrees.');
  const history = await acceptedHistory(p, lease.userId, lease.sessionId);
  const verified = buildReferenceManifest(lease.userId, lease.sessionId, intent.target.contextVersion, history,
    { instructions: '', knowledge: '', instructionVersion: intent.target.instructionVersion,
      knowledgeContentHash: intent.target.knowledgeContentHash, graphSchemaVersion: intent.target.graphSchemaVersion }, p.memory.budgets);
  if (JSON.stringify(verified) !== JSON.stringify(intent.target) || current.graphSchemaVersion !== intent.target.graphSchemaVersion ||
    intent.target.contextVersion !== intent.base.contextVersion + 1)
    throw new AppError('NOT_READY', 'Version rebase history evidence disagrees.');
  await job.wait(p.owner.run(lease, () => p.memory.put(intent.target)), p.metadata.budgets.persistenceTimeoutMs);
  await job.wait(graph.updateState(graphConfig(lease.userId, lease.sessionId), { boundary: target, rebase: null }, 'seal'), p.metadata.budgets.persistenceTimeoutMs);
}
```

Import `Boundary` and `AgentMemoryManifest` in reconciliation, and import `finishRebase` in runtime. The strict channel and recovery-before-early-return are included above. Repeated finish is idempotent; replay never increments target version again, and already-current asset versions make rebase a no-op. Add crash-after-intent/after-memory and duplicate rebase tests before code. Model/instruction/knowledge rollout evaluation remains P10-owned; this hook is not authorization to change them.

```typescript
// backend/src/chat-runtime/index.ts
import { DurableChatRuntime } from './durable-chat-runtime.js';
import type { RuntimeDependencies, ChatRuntime } from './ports.js';
export { DurableChatRuntime } from './durable-chat-runtime.js';
export type { RuntimeDependencies, ExecuteTurn, ChatRuntime, DrainResult } from './ports.js';
export function createChatRuntime(dependencies: RuntimeDependencies): ChatRuntime {
  return new DurableChatRuntime(dependencies);
}
```

No Nest application wiring is added. P9 supplies one runtime factory instance, existing P2 bundle, already-loaded P3 assets/assembler, and verified P4 limits. P8 adds readiness, metrics, rate/admission policy, staging controls and shutdown caller around these hooks.

- [ ] **Step 4 — Run green and add required operation assertions**: active execute vs reconcile conflict; expired lease cannot infer/write or be taken over; foreign stopped owner refused without explicit proof; delayed guard/write makes drain return `drained:false`; stopAccepting blocks new runs but allows recovery/cancel/status; missing/changed manifest and omitted completed archive ref reject before POST; explicit asset rebase increments once and preserves old attempt versions. Global runtime work cap uses `maxConcurrentGenerationsPerProcess`; reject excess starts before inference even if P8 middleware is bypassed. P8 alone owns request-rate policy; do not implement it here.
- [ ] **Step 5 — Commit**:

```powershell
git add backend/src/agent/state.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/src/chat-runtime/reconciliation.ts backend/src/chat-runtime/index.ts backend/test/runtime/operations.native.e2e-spec.ts backend/test/runtime/recovery.native.e2e-spec.ts
git commit -m "feat(p5): export quiescent recovery rebase and drain hooks"
```

### Task 12: Complete reliability regressions, run verification, and document handoff

**Files:** Extend the exact P5 test files above; create `backend/src/chat-runtime/README.md`. Production corrections only in the responsible P5 file with a demonstrated regression.

- [ ] **Step 1 — Add the remaining failing regression assertions** using the same native harness, never live models:

| Test file | Required additional concrete assertion |
| --- | --- |
| `acceptance.native.e2e-spec.ts` | User/attempt/acceptance failure before inference yields zero POSTs. After original input but before attempt insert, reconcile preserves orphan; same-key resubmit writes one user record. Ambiguous acceptance marker acknowledgment is reread/reconciled, not silently inferred. Accepted after confirmation survives new runtime. |
| `acceptance.native.e2e-spec.ts` | Follow-up outgoing body equals fixed messages + first user + first completed assistant + new user once. Three attempts are a hard bound. More than 50 archive records produce a complete manifest or explicit budget failure, never newest-page selection. |
| `lifecycle.native.e2e-spec.ts` | Slow/throwing sink aborts upstream and persists interruption; pre-stream auth/credit failures stay failed. Usage unknown stays null; repeated generation frames not summed. Cancellation preserves accounting outcome. Terminal reattach does not emit deltas or POST. |
| `recovery.native.e2e-spec.ts` | Fault after saved graph but before each application write, including committed-but-lost acknowledgment, recovers same output IDs/text/timestamps/version; repeated reconcile has exactly one assistant/accounting record and unchanged context version. No seal, wrong saved attempt, tampered target, unsupported schema, or arbitrary boundary mismatch never yields completion. |
| `operations.native.e2e-spec.ts` | Reconnect a new MongoClient/P2 factory and new runtime to the same isolated DB after old tasks/guard drain and explicit sentinel handoff; saved answer recovers without POST. Before handoff a second executor is rejected. Expiry alone never supplies stopped proof. |
| `graph.spec.ts` | Real sync saver failure is propagated; completed checkpoint is reread; manual repair schedules no nodes. New invocation replaces old input/result rather than appending history; no graph channel contains complete prompt/messages. |
| `work.spec.ts` | Non-overlapping heartbeat, deadlines include slow sink, quarantine retains unresolved operations, timer cleanup, bounded drain; transient acceptance joins are removed after success/failure. |

Use exact fault spy bodies from Task 9, replacing only their target method; do not stub `reconcileSession`/`executeTurn` or assert only mocks called. Count actual scoped repository rows and inspect actual fixture POST JSON. Add a durable accounting reconciliation case using P4's `AccountingService.reconcile` with `getAccounting` under the same guarded lease; a generation GET may reconcile pending/unknown cost, never a chat POST. This record-driven method can remain an exported admin helper called by P8, not an automatic scanner or inference retry. Preserve known values/outcome/endedAt on repeated lookup.

- [ ] **Step 2 — Run each new test red** before the owning correction. If a coverage-only test already passes, record that honestly; do not weaken code to manufacture red. `npx tsc --noEmit --incremental false -p tsconfig.json` must check tests too (Nest build excludes them).
- [ ] **Step 3 — Apply minimum P5 correction and rerun its suite**. Fix these self-check points explicitly rather than accepting misleading green:

  - `transition` sets `updatedAt` to one chosen timestamp per durable transition and reuses it during recovery; P2 terminal idempotency must compare the saved record exactly. Provider generation-ID CAS uses the old expected record/status while changing only its mutable `generationId`; P2 immutable fields remain intact.
  - Response terminal branch reads stored message **and** graph boundary/manifest agreement before emitting a completed event. A stale completed record without required checkpoint/application evidence is `NOT_READY`, not success.
  - Terminal status/error events for failed/cancelled/interrupted are emitted **after** fallback writes/terminal CAS, if sink remains connected, then execution rejects/returns a documented failure. `error` contains a fixed safe message/code, never original error text. Captured partials are best effort at termination, not periodic/per-token durability.
  - Cleanup abort cannot relabel provider errors. Stop heartbeat before release; track renew/save/invoke promises; no nested guarded call. A late graph result after timeout must be checked after settlement, not discarded or re-inferred.
  - Before claiming drained, boundedly settle runtime tasks and guard; if guard itself exceeds drain deadline, return false and retain sentinel. Stop/drain reports pending accepted slots separately in README; P8 performs bounded `sessions.listForRecovery` pages after quiescence.
  - Sealed-result fallback never changes attempt to failed/cancelled/interrupted. Unsealed checkpoint/pending writes never count as a completed result. Stale retry/cancel/stream IDs cannot mutate newer attempts.
  - Boundary mismatch with a **typed saved publication/rebase intent** may be repaired idempotently. Any mismatch without that evidence blocks continuation; do not select a new baseline from archive alone.

- [ ] **Step 4 — Execute all commands in the command section** and root `git diff --check`. Record actual unit/native/type/build/lint outcomes and limitations. Do not run unrelated frontend checks for this backend-only worker or report `test:azure` as passing. If native URI is missing, stop at restricted unit evidence and report P5 full exit blocked; do not declare completion.
- [ ] **Step 5 — Write `backend/src/chat-runtime/README.md` with these exact policy sections** and actual worker evidence table:

```markdown
# Durable chat runtime

## P6 request ownership
submitTurn/retryTurn durably accept and return P1 identifiers/streamPath without inference. executeTurn({userId,sessionId,turnId,attemptId,signal,emit}) is a transport-independent request-owned Promise. emit receives version-1 envelopes in attempt-local order and must honor bounded backpressure. Only one request can execute an attempt; a second stream attachment conflicts. Disconnect signals interruption, explicit cancel signals cancellation. Read durable status/archive after reconnect; never automatically submit or retry. Provider end and provisional deltas are not application completion. Truncated completion is distinctly labeled and excluded from future assistant context. Cancel acknowledgment is not proof of terminal durability or stopped upstream billing.

## P8 operations
stopAccepting, snapshot, drain and reconcileSession expose admission/quiescence/degradation/recovery. drain reports false for unresolved graph/database work; caller retains executor sentinel and must not hand off live operations. Accepted unattached turns are not background jobs; quiescent recovery marks interrupted rather than inferring. P8 owns readiness/rate/telemetry/proxy/staging/retention/backup/shutdown orchestration. Admin allowStoppedOwner/rebaseSession are never HTTP endpoints. P9 supplies one bundle/runtime per database and already-validated assets/model limits.

## Supported topology and recovery
One admitted process per database, no horizontal executor safety claim. Durable sentinel has no TTL. Lease expiry stops writes and never authorizes takeover. Operator must prove old process and in-flight I/O stopped before sentinel handoff and allowStoppedOwner. Graph state is reference-only with a bounded public result; standard saver sync persistence is required. Publication uses exact saved IDs/sequences/timestamps/accounting/manifest version. A sealed result recovers without model replay; no result interrupts and requires explicit retry. Partial text is only best-effort terminal capture; every streamed token is not promised durable. No exactly-once inference/billing claim is made.

## Limits and future boundaries
P1 budgets apply, P4 alone performs finite definitive pre-stream rejection retries. Explicit logical retries are limited to three attempts of the latest incomplete turn. Full history reads cap at 100 pages of at most 50 records; overflow requires a new chat, never silent removal. Record envelopes and checkpoint/result bytes are bounded. No live tools, reasoning storage, compaction, summaries, retrieval, or alternate models are introduced.

## Actual verification
Record worker commit range, Node/LangGraph/saver versions, isolated native topology, command/date/result/test count and crash window assertions. Distinguish fixture/native tests from real process termination/staging proof. Azure facts and activation, selected-model tokenizer/privacy/usage checks, actual proxy/drain/backup/restore and public-production decisions remain upstream/P8/P10 gates. Unified review is skipped, not passed.
```

- [ ] **Step 6 — Commit evidence/regressions**. Stage only the test files genuinely extended; include a production fix by its exact filename if required, never an entire directory.

```powershell
git add backend/src/chat-runtime/README.md backend/test/runtime/identity.spec.ts backend/test/runtime/graph.spec.ts backend/test/runtime/work.spec.ts backend/test/runtime/acceptance.native.e2e-spec.ts backend/test/runtime/lifecycle.native.e2e-spec.ts backend/test/runtime/recovery.native.e2e-spec.ts backend/test/runtime/operations.native.e2e-spec.ts
git commit -m "test(p5): verify durable lifecycle concurrency and crash recovery"
```

## Coverage and exit gate

| Requirement | Tasks/evidence |
| --- | --- |
| AC02 lifecycle stream | 8/10/12 accepted/generating/finalizing/terminal, deltas, outcome-specific events |
| AC08 logical idempotency/retry | 1/7/10/12 deterministic new-chat identity, changed payload, concurrent join, same original input, three-attempt cap |
| AC09 exclusive execution/topology | 5/7/8/11/12 sentinel+guard+request registry, concurrent attachments/tabs, no expiry takeover, tracked late writes |
| AC10 acceptance/durable completion | 3/6/7/8/9/12 zero POST before marker; sealed checkpoint and full publication before completion |
| AC11 explicit outcomes | 8/9/10/12 P4 framing/error/EOF/length/cancel/timeouts/disconnect fixture outcomes, incomplete archive exclusion |
| AC12 basic reconciliation | 6/9/11/12 saved-result recovery, no-result fallback, repeated repair, orphan/partial acceptance, no model replay |
| §6 context/checkpoint agreement | 2/3/4/7/8/11/12 reference boundary, complete archive check, exactly-once model projection, explicit version intent |
| §8 ordering/causality | 1/7/8/10 stable scope/IDs, sequence reservations, original message and previousAttemptId links |
| P8 operations | 5/11/12 stopped proof, degradation, finite drain, recovery/rebase exports; P8 owns policies/wiring |

Worker ready for **native/deterministic P5 implementation** once this plan is committed and parent dispatches; P2/P3/P4 worker prerequisites satisfied in the restricted native scope. Full P5 worker exit requires actual graph/saver/native crash-window/concurrency tests, meaningful unit tests, type/build/lint, and recorded evidence; code existence or a plan/type check alone is not exit. Azure certification/service activation, live model capabilities/tokenizer/privacy and actual staging behavior are explicit external gates, not invented passes. Report downstream interface summary, actual commit range, checks and blockers; orchestrator updates state.

## Planner document verification (not worker execution)

- [x] Read required goals/R1/state/upstream plans and actual P1–P4 implementations; no upstream edits.
- [x] Ownership/file map/commit paths remain P5-only; planner deliverable only `plan5.md`.
- [x] P1 signatures/stream fields retained; P2 concrete extensions and P4 factory accounting used without redefinition.
- [x] Current Context7 LangGraph persistence/state docs consulted; installed declarations checked for durability/getState/updateState. Latest docs may demonstrate StateSchema, but this plan uses installed supported Annotation API.
- [x] AC02/08/09/10/11/12 and scope gates mapped; no HTTP/P8 policy/detached job/tool/compaction implementation planned.
- [x] Document consistency self-check distinguishes implementation steps from unexecuted tests and explicit rollout gates; unified review remains skipped.
- [x] Actual planner checks: 36 TypeScript blocks syntax-checked (class fragments wrapped in a virtual class); 10 assembled virtual source modules type-check against installed upstream contracts/dependencies. This checks displayed source/interface examples, not execution of the worker's additional regression/preflight tasks. No source/test files were written by the checks.
- [x] All seven linked upstream workflow documents exist; 12 tasks and 61 numbered checkbox steps checked; prohibited unfinished/header/staging markers absent. Git whitespace check passed.
- [ ] Worker tests/type/build/native/service execution: **not executed by this planner**. Follow red/green tasks and report actual results.
