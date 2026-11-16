Make new text attempts use confirmed current configuration while accepted/running attempts keep their original key, model, context/output limits, deadlines and automatic-retry policy. Keep settings in detached in-memory snapshots, not attempts or checkpoints. Reuse the existing durable runtime, reference assembler, OpenRouter adapter, WorkRegistry and reservation authority; do not construct replacement owners on publication. Stack: existing TypeScript/NodeNext, LangGraph, Vitest, Zod and Node/fetch; no dependency changes.

Scope and authorization: [goal.md](goal.md), [state.md](state.md). Research and unified review are **skipped**, not passed. This is a P3 implementation plan, not implementation evidence. No migration execution, paid/live provider requests, provisioning or deployment. Sample code omits header boilerplate by user instruction; actual implementation files retain repository header requirements.

## Boundaries and current-source findings

- P1 implementation exposes `CurrentConfigPort.current(): RuntimeConfigSnapshot | null`, `SnapshotCandidate`, `VerifiedModelLimits` and physically detached/deep-frozen `buildRuntimeSnapshot`. Use these exact exports from `backend/src/contracts/config-runtime.ts` and `backend/src/platform/config/manageable-config.ts`; do not invent a second snapshot contract or freeze helper.
- `RuntimeConfigSnapshot` contains `revision`, `settings`, composed `budgets`, `openRouter`, `voice` (including `dictationWarningMs`) and nullable `modelLimits`. Only transient server code receives it. Voice warning consumption belongs to P4.
- `DurableChatRuntime.acceptNewTurn` persists acceptance and closes its temporary Work. `executeTurn` runs on a later stream request. Capturing settings only inside `executeTurn` is wrong: a save between POST and GET would change an already accepted attempt. Retain a scoped snapshot binding across this gap.
- Automatic provider retries happen inside `OpenRouterAttemptAdapter.stream`, not `retryTurn`. The existing definitive-429/503-only, no-visible-output/no-generation-ID rules remain. `retryMaxAttempts` counts provider dispatches inclusive; the existing maximum three durable user attempts per logical turn stays fixed and is not this setting.
- Attempts have strict schemas and no configuration revision field. Do not add one or spread a snapshot into an attempt. The existing `modelId` and server attribution remain durable evidence; revision assertions use the captured in-memory snapshot and provider fixtures.
- `ReferencedContextAssembler` freezes startup budgets. Add a read-only budget projection using the same repositories/assets rather than rebuilding application ownership or changing P1's `ContextAssembler` contract.
- Manifests store references, not model limits. Building/validating them must use immutable persistence safety, while prompt selection checks use the attempt budgets. A smaller model must fail context overflow without dropping messages, changing manifest versions, or requiring a rebase solely for configuration.
- HTTP currently has startup input bounds, stream concurrency and SSE idle deadlines. Those must not undermine a higher new input limit or a longer already accepted deadline. JSON parser limits must be fixed transport ceilings, not the initial manageable input setting.
- `OperationsService` owns the existing `Admission` sliding-window request counters and a startup concurrency gate. P6 owns operations/assembly edits. P3 must not add a second request-rate limiter or reset its counters. The runtime WorkRegistry remains the final synchronous process-work gate; ExecutionReservations remains the text/live session-exclusion authority.
- P1's model projection validates caps, but not real fixed assets. P3 supplies side-effect-free catalogue/fixed-asset preflight for P6; candidate preflight must not alter current settings, work limits, reservations or usage.

Targeted documentation check, not a research phase: OpenRouter's official models guide/OpenAPI confirms nullable `context_length`, `top_provider.max_completion_tokens`, and `supported_parameters`. Treat missing/null/nonpositive/unsafe caps and absent `max_tokens` as unusable. References: https://openrouter.ai/docs/overview/models and https://github.com/openrouterteam/docs/blob/main/openapi/openapi.yaml. Current OpenAPI deprecates `max_tokens` in favor of `max_completion_tokens`; retain the installed/admitted `ChatOpenRouter` serializer and P1 `supportsMaxTokens` contract for this feature. Any required contract/serializer migration is a reported upstream decision, not an unannounced P3 model expansion.

## Exact file map

Modify:

- `backend/src/model/policy.ts`: export the narrow structural `ModelConfig` type; retain privacy, attribution and fixed transport/output checks.
- `backend/src/model/catalogue.ts`: consume `ModelConfig`, harden positive safe catalogue caps and credential-bearing redirect handling, export text candidate preflight.
- `backend/src/model/index.ts`, `openrouter-adapter.ts`, `accounting.ts`: accept `ModelConfig` instead of a whole bootstrap/environment configuration. Adapter and accounting remain attempt-scoped.
- `backend/src/context/context-budget.ts`: shared fixed-context construction/fit check, reused by assembler and candidate preflight.
- `backend/src/context/referenced-context-assembler.ts`: `forBudgets` read-only projection; preserve voice-delivery-aware history selection.
- `backend/src/context/index.ts`: export the fixed-context helpers.
- `backend/src/chat-runtime/ports.ts`: optional transitional current-config dependency, internal live snapshot handoff, safe stream-budget accessor.
- `backend/src/chat-runtime/durable-chat-runtime.ts`: acceptance-time binding, snapshot-bound execution and cleanup, current admission caps, provider-free recovery.
- `backend/src/chat-runtime/work.ts`: read a live ceiling callback without replacing its jobs map or aborting admitted jobs.
- `backend/src/http/options.ts`, `chat-http.service.ts`, `chat-stream.transport.ts`, `configure-chat-http.ts`: fixed pre-schema input bounds plus authoritative runtime admission, attempt-bound writer deadline, fixed parser limit and current new-stream ceiling.
- `backend/test/runtime/native-harness.ts`: inject a deterministic P1 snapshot/current-config port into existing native runtime fixtures.
- `backend/test/runtime/local-reconciliation.spec.ts`, `work.spec.ts`, `graph.spec.ts`: recovery under absent/changed configuration, dynamic admission, secret-free graph state.
- `backend/test/model/catalogue.spec.ts`, `adapter.spec.ts`: preflight and retry regression cases.
- `backend/test/http/service.spec.ts`, `stream-transport.spec.ts`, `routes.e2e-spec.ts`: dynamic input/stream and fixed-parser regressions.

Create only focused tests/helpers:

- `backend/test/model/config-snapshot.ts`: pure P1 snapshot fixture, shared by P3 tests.
- `backend/test/context/config-budget.spec.ts`: projected context budgets and fixed-asset fit.
- `backend/test/runtime/text-config-fixture.ts`: small in-memory persistence double with the real MemorySaver/assembler/runtime, adapted from existing local reconciliation patterns.
- `backend/test/runtime/text-config.spec.ts`: routine snapshot/admission/retry/security regressions, requiring no MongoDB or network.
- `backend/test/runtime/text-config.native.e2e-spec.ts`: equivalent isolated native lifecycle/restart checks.

Do not edit P1 contracts/config loaders, P2 admin/persistence files, P4 voice/frontend files, P5 dashboard files, P6 assembly/operations, P7 integration artifacts, manifests/lockfiles, private environment files, `goal.md` or `state.md`. `backend/src/agent/state.ts` and `turn-graph.ts` need no new channel or implementation change; prove their existing strict schemas/closure boundary suffice.

## Frozen interfaces for P4 and P6

Add the following local structural interfaces; do not edit shared P1 contracts:

```typescript
export type ModelConfig = Pick<AurvinConfig, 'identity' | 'budgets' | 'openRouter'>;

// Add to RuntimeDependencies; the optional fields keep P6 assembly compiling.
currentConfig?: CurrentConfigPort;
assembler: ContextAssembler & { forBudgets?(budgets: BudgetConfig): ContextAssembler };
limits?: ModelLimits; // Transitional startup field; never used to choose attempt limits.

// Add to SubmitLiveTurn, used only on the server by P4's bridge.
configSnapshot?: RuntimeConfigSnapshot;

export type AttemptStreamBudgets = Pick<BudgetConfig,
  'idleStreamTimeoutMs' | 'maxMessageBytes'>;

// Add as optional on ChatRuntime during assembly transition; concrete runtime implements it.
attemptStreamBudgets?(userId: string, sessionId: string, attemptId: string): AttemptStreamBudgets;

// Add to ChatHttpOptions; bootstrap budgets remain for storage/page/control work.
currentConfig?: CurrentConfigPort;
```

Optional current-config wiring is a compilation transition, **not** a runtime fallback: missing port/null snapshot rejects new text acceptance with `NOT_READY`; never derive a manageable runtime snapshot from `d.config` or environment. Existing recovery, cancellation, status and archive reads remain possible without credentials/current configuration. P6 must wire the port and concrete `forBudgets` projection before claiming integrated chat readiness.

P4 passes its already frozen voice-session `RuntimeConfigSnapshot` as `SubmitLiveTurn.configSnapshot` for every live turn, including turns after a save/key removal. P3 validates the existing reservation before consuming it and binds it exactly like a text snapshot. When `currentConfig` is installed, missing live snapshot fails closed rather than silently using current settings. This parameter is internal only, never a HTTP field. P4 updates bridge/session tests in its own files; P3 does not edit them.

P6 constructs one pointer owner implementing P1 `CurrentConfigPort`/`ConfigActivationPort`, one runtime, one persistence/close owner and one reservation authority. For preparation, compose nonsecret budgets via P1, call P3 `prepareTextConfiguration(config, assets, signal, fetcher)` returning `Promise<VerifiedModelLimits | null>`, then call P1 `buildRuntimeSnapshot`. Publish only after confirmed persistence. Runtime/HTTP read the pointer at new admission; publication does not recreate any owner or invoke inference.

P6 updates the existing operations concurrency/rate ceiling in place (or supplies a getter to the existing Admission instance), preserves its retained timestamps/control reserve, and forwards `attemptStreamBudgets` through the observed-runtime wrapper. P3's runtime and HTTP changes alone do not close the integrated source-separation/rate-limit gates.

## Execution rules

Each numbered checkbox below is one action; split table rows into separate red/green cycles if needed. All npm commands run in `backend/`, Git commands at repository root. Routine checks use injected fixture fetch exclusively. Commit after passing atomic groups, using an orchestrator-granted index turn and exact file paths. Retry index locks with backoff; never delete a lock, stage unrelated paths, or include another worker's staged changes.

## Task 1: Reuse P1 snapshots and preflight model/context edits

Files: `backend/test/model/config-snapshot.ts`; `backend/test/model/catalogue.spec.ts`; `backend/src/model/{policy,catalogue,index,openrouter-adapter,accounting}.ts`; `backend/src/context/{context-budget,index}.ts`.

- [ ] 1. Add this pure fixture, with imports from P1's existing modules. It reads no environment and performs no network/storage operation:

```typescript
import type { ChatLimits } from '../../src/contracts/admin-config-wire.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { buildRuntimeSnapshot, defaultManageableSettings }
  from '../../src/platform/config/manageable-config.js';

export function textSnapshot(revision = 1, chat: Partial<ChatLimits> = {},
  modelId = 'fixture/model', apiKey = 'fixture-key', userId = 'aurvin-dev-user') {
  const bootstrap = loadBootstrapConfig({ AURVIN_USER_ID: userId });
  const settings = defaultManageableSettings();
  settings.openRouter.modelId = modelId;
  Object.assign(settings.chat, chat);
  return buildRuntimeSnapshot(bootstrap, { revision, settings,
    credentials: { openrouter: apiKey || null, deepgram: null } },
    apiKey && modelId ? { modelId, contextTokens: 32768, outputTokens: 4096,
      supportsMaxTokens: true, source: 'fixture' } : null);
}
```

- [ ] 2. Add a failing preflight test to `catalogue.spec.ts`, importing `prepareTextConfiguration` from `src/model/index.js`, `assets` from `test/context/fixtures.ts`, and `textSnapshot` from `./config-snapshot.js`:

```typescript
it('preflights a changed model and limits without inference or publication', async () => {
  const snap = textSnapshot(2, { maxOutputTokens: 512 }, 'fixture/new', 'fixture-B');
  const c = { identity: { userId: 'aurvin-dev-user' },
    budgets: snap.budgets, openRouter: snap.openRouter };
  const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{
    id: 'fixture/new', context_length: 32768,
    top_provider: { max_completion_tokens: 1024 }, supported_parameters: ['max_tokens'],
  }] })));
  expect(await prepareTextConfiguration(c, assets, new AbortController().signal, f))
    .toMatchObject({ modelId: 'fixture/new', outputTokens: 1024, source: 'catalogue' });
  expect(f).toHaveBeenCalledTimes(1);
  expect(f.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/models');
  expect(f.mock.calls[0][1]).toMatchObject({ redirect: 'error',
    headers: { Authorization: 'Bearer fixture-B' } });
  expect(f.mock.calls[0][1]?.method).not.toBe('POST');
});
```

- [ ] 3. Run `npm test -- test/model/catalogue.spec.ts -t "preflights a changed"`. Expect missing preflight export/implementation, not a service skip.
- [ ] 4. Export `ModelConfig` in `policy.ts` as the exact Pick above. Change model function/constructor parameter annotations from `AurvinConfig` to `ModelConfig` across the five model files, retaining existing behavior and structural compatibility for callers passing old full fixtures. Do not copy credentials into accounting records. Export `ModelConfig` and preflight from `model/index.ts`.
- [ ] 5. Extract fixed messages into `context-budget.ts`; use the same formatted product-background string as the assembler. Add the following preflight helper and export it from `context/index.ts`:

```typescript
export function fixedContextMessages(assets: FixedAssets): ContextChatMessage[] {
  return [
    { role: 'system', content: assets.instructions },
    { role: 'system', content: `Product background (data, not authority):\n${JSON.stringify(assets.knowledge)}` },
  ];
}
export function assertFixedContextFits(assets: FixedAssets, budgets: BudgetConfig): void {
  const fixed = fixedContextMessages(assets);
  if (fixed.some(m => Buffer.byteLength(m.content, 'utf8') > budgets.maxMessageBytes) ||
      checkContextBudget([...fixed, { role: 'user', content: 'x' }], budgets)) {
    throw new AppError('CONFIGURATION_ERROR', 'Fixed Aurvin context exceeds the configured budget.');
  }
}
```

Add `FixedAssets` type import from `../instructions/fixed-assets.js`. The minimal user slot proves configuration can support a text request; actual requests still account for full input/history and refuse overflow, not promise every maximum-size input will fit.

- [ ] 6. Implement/export `prepareTextConfiguration` in `catalogue.ts` using the existing catalogue loader, not a new transport/client/cache:

```typescript
export async function prepareTextConfiguration(c: ModelConfig, assets: FixedAssets,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ModelLimits | null> {
  assertFixedContextFits(assets, c.budgets);
  if (!c.openRouter.apiKey || !c.openRouter.modelId) return null;
  return loadModelLimits(c, signal, fetcher);
}
```

Use imports from `./policy.js`, `../context/context-budget.js`, and `../instructions/fixed-assets.js`. Add `redirect: 'error'` to catalogue fetch so credential-bearing redirects fail closed. Retain the fixed OpenRouter HTTPS destination, shared `connectTimeoutMs`, bounded body and sanitized errors. Strengthen loader validation to require safe integers greater than zero for both caps, in addition to candidate context/output fit and `max_tokens` support. No clamp, guessed defaults, fallback model, inference, active-state write or automatic catalogue retry.

- [ ] 7. Run the focused red test again; expect PASS. Run `npm test -- test/model test/context` and `npm run build`; expect all discovered routine tests pass and compilation succeeds.
- [ ] 8. Add/run one table-driven red/green cycle per boundary in `catalogue.spec.ts`: changed model with absent entry; null/zero/fraction/unsafe context/output; output cap below candidate; context cap below candidate; missing `max_tokens`; fixed instructions exceeding message bytes; fixed pair plus user exceeding context/messages; fetch 302/timeout/oversized/malformed data. Assert zero POST and safe `CONFIGURATION_ERROR`. For a missing key/model, assert null result and no fetch, but fixed-asset checks still execute. Repeat fit checks on a same-model output/context edit, not just model-ID changes.
- [ ] 9. Commit the passing group:

```powershell
git add backend/test/model/config-snapshot.ts backend/test/model/catalogue.spec.ts backend/src/model/policy.ts backend/src/model/catalogue.ts backend/src/model/index.ts backend/src/model/openrouter-adapter.ts backend/src/model/accounting.ts backend/src/context/context-budget.ts backend/src/context/index.ts
git commit --only -m "feat(config): preflight text models and fixed context" -- backend/test/model/config-snapshot.ts backend/test/model/catalogue.spec.ts backend/src/model/policy.ts backend/src/model/catalogue.ts backend/src/model/index.ts backend/src/model/openrouter-adapter.ts backend/src/model/accounting.ts backend/src/context/context-budget.ts backend/src/context/index.ts
```

## Task 2: Project attempt budgets without changing archive/manifests

Files: `backend/src/context/referenced-context-assembler.ts`; `backend/test/context/config-budget.spec.ts`.

- [ ] 1. Add this failing test using existing `ports`, `history`, `manifest`, `request` from `./fixtures.js`:

```typescript
it('projects tighter context limits without dropping or rewriting history', async () => {
  const d = ports();
  const base = new ReferencedContextAssembler(d);
  const before = await base.assemble(request);
  const tighter = textSnapshot(2, { maxMessagesInContext: 3 });
  const result = await base.forBudgets(tighter.budgets).assemble(request);
  expect(result).toMatchObject({ ok: false, overflow: { code: 'CONTEXT_BUDGET_EXCEEDED' } });
  expect(await base.assemble(request)).toEqual(before);
  expect(d.memory.put).not.toHaveBeenCalled();
  expect(d.messages.append).not.toHaveBeenCalled();
  expect(d.memory.get.mock.results[0].value).resolves.toEqual(manifest(history));
});
```

Import `ReferencedContextAssembler` from its exact src path and `textSnapshot` from `../model/config-snapshot.js`.
- [ ] 2. Run `npm test -- test/context/config-budget.spec.ts`. Expect `forBudgets` missing, not an unrelated failure.
- [ ] 3. Replace duplicated constructor/fixed-message checks with Task 1's helpers. Add exactly this projection to the existing class:

```typescript
forBudgets(budgets: BudgetConfig): ContextAssembler {
  return new ReferencedContextAssembler({ ...this.dependencies, budgets });
}
```

The new assembler is a stateless read projection, not a runtime, Mongo client, close owner or reservation service. Keep `metadata` when copying dependencies so interrupted/unknown live delivery remains correctly projected. Constructor validates the attempt's fixed fit and freezes its parsed budgets; never modify the original assembler or request a new asset load.
- [ ] 4. Run the red test again; expect PASS.
- [ ] 5. Add/run independent cases: smaller context token ceiling with larger output reserve returns overflow; multibyte new input hits snapshot input tokens; current-turn input already in manifest appears once; old valid history remains ordered; byte/storage limits remain enforced; internal assistant text remains heard/unknown-delivery projection via `test/context/voice-context.spec.ts`. Assert unchanged context/asset versions and no persistence writes. Use `{ maxInputTokens: 128, maxContextTokens: 2048, maxOutputTokens: 128, modelMarginTokens: 128 }` for the tight token fixture so P1 validation itself remains valid.
- [ ] 6. Run `npm test -- test/context` and `npm run build`; expect all discovered tests pass.
- [ ] 7. Commit only this projection group:

```powershell
git add backend/src/context/referenced-context-assembler.ts backend/test/context/config-budget.spec.ts
git commit --only -m "feat(config): bind context assembly to attempt budgets" -- backend/src/context/referenced-context-assembler.ts backend/test/context/config-budget.spec.ts
```

## Task 3: Capture at acceptance, execute on that binding, retry on current

Files: `backend/src/chat-runtime/{ports,durable-chat-runtime}.ts`; `backend/test/runtime/{text-config-fixture.ts,text-config.spec.ts,native-harness.ts}`.

- [ ] 1. Build a small routine fixture in `text-config-fixture.ts` by adapting `test/runtime/local-reconciliation.spec.ts`, not importing or generalizing its private fixture. Use real `MemorySaver`, `ReferencedContextAssembler`, `DurableChatRuntime`, P1 snapshots and `FRAMES.normal`. Implement only runtime-used repository/owner methods with schema-shaped records. The fixture's exact exported shape is:

```typescript
export type TextConfigFixture = {
  runtime: DurableChatRuntime;
  currentConfig: CurrentConfigPort;
  publish(snapshot: RuntimeConfigSnapshot | null): void;
  identity: ResolvedIdentity;
  p: PersistenceBundle;
  saver: MemorySaver;
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  submit(content?: string, sessionId?: string | null): Promise<SubmitTurnResponse>;
  execute(ids: SubmitTurnResponse): Promise<void>;
  dispose(): Promise<void>;
};
```

Imports come from `../../src/chat-runtime/durable-chat-runtime.js`, `../../src/contracts/{config-runtime,identity,api}.js`, `../../src/persistence/persistence.js`, `@langchain/langgraph` and `vitest`. Use maps keyed by `JSON.stringify([userId,sessionId,id])` for messages/attempts/acceptance and by `[userId,sessionId]` for sessions/memory. Clone records on writes/reads. Set `p.messages.budgets`, `p.memory.budgets` and `p.metadata.budgets` to **original storage-safety** budgets; publishing never mutates them. Preserve actual scope and state transitions in the fake rather than returning success for everything.

Implement each row below as a separate short fixture action, exporting `textConfigFixture(initialSnapshot: RuntimeConfigSnapshot): TextConfigFixture` once the ports are assembled. Return a mutable pointer through `currentConfig.current`, assign only that pointer in `publish`, and construct one runtime/assembler/saver for the fixture. `submit` and `execute` simply delegate to that runtime with server identity, incremented request ID, fresh signal and a resolved event sink.

| Port | Exact behavior |
| --- | --- |
| sessions `get/createIfAbsent/touchActivity` | Scoped get; create only absent; update activity time without replacing execution state. |
| messages `get/append/getReferences/list/listForContext/updateCompletion` | Scoped unique IDs; ordered originals; `{items,nextCursor:null}` pages; completion updates preserve text and set truncated flag. |
| memory `get/put` | Scoped detached manifest reads/writes. |
| metadata `getAttempt/getAttemptByIdempotency/listAttempts/putAttempt/compareAttempt` | Scoped lookup; expected-status CAS; ordered attempts, no payload/settings copying. |
| metadata `getAcceptance/getAccounting/putAccounting/getVoiceDelivery` | Real acceptance marker lookup; scoped accounting; null voice delivery for text-only fixture. |
| owner `assertExecutor/run/fence/drain/acquire/recoverStoppedSession/renew/release` | One executor ID; acquire fails on nonnull owner; lease scope and generation retained; run/fence verify ownership; release clears owner only. |
| owner `reserveAttempt/allocateSequences/confirmAcceptance/clearAttempt` | Active-attempt conflict; stable per-attempt sequence allocation; confirm marker from persisted attempt/input and set latestTurnId; clear only matching active attempt. |
| checkpoints `create().bind()` | Return the same MemorySaver; real graph save/restore, not mocked graph completion. |

Use existing `hashPayload`, `graphConfig`, `attemptsFor`, fixture asset constants and stream frames. Request IDs increment as `request-0001`, `request-0002`; default text is `Hello`. Fetch returns a fresh `Response(FRAMES.normal.replaceAll('gen_fixture', uniqueGenerationId))` per POST; throw on unexpected destination/method. `dispose` reconciles unfinished fixture attempts, stops admission, drains and checks zero active jobs/timers. No new fake application framework or production abstraction.

- [ ] 2. Write the principal failing acceptance-gap test in `text-config.spec.ts` with `textConfigFixture(initialSnapshot)` implementing the shape above:

```typescript
it('keeps acceptance settings across a save before stream attachment', async () => {
  const a = textSnapshot(1, { maxOutputTokens: 2048 }, 'fixture/model', 'fixture-A');
  const b = textSnapshot(2, { maxOutputTokens: 512 }, 'fixture/new', 'fixture-B');
  const h = textConfigFixture(a);
  try {
    const first = await h.submit();
    expect(h.fetcher).not.toHaveBeenCalled();
    h.publish(b);
    await h.execute(first);
    const second = await h.submit('Next', first.sessionId);
    await h.execute(second);
    const calls = h.fetcher.mock.calls;
    expect(calls.map(c => JSON.parse(String(c[1]?.body)).model))
      .toEqual(['fixture/model', 'fixture/new']);
    expect(calls.map(c => JSON.parse(String(c[1]?.body)).max_tokens)).toEqual([2048, 512]);
    expect(calls.map(c => (c[1]?.headers as Record<string, string>).Authorization))
      .toEqual(['Bearer fixture-A', 'Bearer fixture-B']);
    expect(h.runtime.snapshot().active).toBe(0);
  } finally { await h.dispose(); }
});
```

- [ ] 3. Run `npm test -- test/runtime/text-config.spec.ts -t "keeps acceptance settings"`. Expect old model/key/output settings on the second request, or missing projection/binding, demonstrating startup consumption.
- [ ] 4. Add Task interfaces to `ports.ts` with `.js` type imports. Retain legacy `config` only for identity/topology/infrastructure/control/recovery compatibility, not a manageable fallback. Add the private snapshot bindings and small capture/lookup helpers to `DurableChatRuntime`:

```typescript
private readonly attemptSettings = new Map<string, RuntimeConfigSnapshot>();
private attemptKey(u: string, s: string, a: string) {
  return JSON.stringify([u, s, a]);
}
private captureTextSettings(): RuntimeConfigSnapshot {
  const snapshot = this.d.currentConfig?.current();
  if (!snapshot || !snapshot.openRouter.apiKey || !snapshot.openRouter.modelId ||
      !snapshot.modelLimits || snapshot.modelLimits.modelId !== snapshot.openRouter.modelId) {
    throw new AppError('NOT_READY', 'Chat configuration is unavailable.');
  }
  return snapshot;
}
private assemblerFor(snapshot: RuntimeConfigSnapshot): ContextAssembler {
  if (!this.d.assembler.forBudgets) {
    throw new AppError('NOT_READY', 'Chat context is unavailable.');
  }
  return this.d.assembler.forBudgets(snapshot.budgets);
}
```

The port must only publish P1-built snapshots; tests also reject a forged mismatched/null-limits snapshot before provider dispatch using existing `assertRequest`/P1 safety checks. Do not implement a second validator/deep freezer. Add a fixed binding ceiling of 1024, matching the existing reservation ceiling, and reject before durable acceptance when reached. Bind synchronously before the first acceptance mutation. Add a `ponytail:` comment: bounded pending-attempt secret retention, 1024 bindings maximum; future durable nonsecret provenance/credential-version design must precede restart-resumable inference. No eviction of an accepted/running binding to admit another request.

- [ ] 5. Move manageable input validation after durable duplicate lookup in `acceptNewTurn`. Identical already accepted submissions must return their original response, including after lower input limits/key removal; never overwrite their binding. After determining a genuinely new attempt, capture exactly once, validate input/title/context against it and bind its stable attempt ID. `acceptRetry` similarly handles duplicate lookup first, then captures current settings, revalidates the **original** user input, binds the new attempt ID and changes only safe `modelId`/causal evidence in its record. Preserve the original input/message ID and fixed three-durable-attempt cap.
- [ ] 6. Make `checkBoundary` receive the captured assembler explicitly. Use `p.memory.budgets`/`p.messages.budgets` for manifest reconstruction/storage bounds; use the projected assembler for prompt/input/output/context checks. Pass the same projected assembler at acceptance, execution boundary and graph `prepare`. No global assembler mutation, manifest rebase or silent history slicing.
- [ ] 7. In `executeTurn`, handle durable terminal reattachment and nonaccepted/recovery states **before** requiring a binding. For an accepted attempt, retrieve its existing binding; never call `current()` to choose its execution settings. Missing binding after restart yields `NOT_READY` and requires existing reconciliation; do not infer with the new key. Verify durable `a.modelId` equals captured model. Build the adapter's narrow config from server identity plus snapshot openRouter/budgets:

```typescript
const attemptConfig: ModelConfig = {
  identity: this.d.config.identity,
  openRouter: snapshot.openRouter,
  budgets: { ...snapshot.budgets, maxMessageBytes: maxVisibleBytes },
};
const limits = snapshot.modelLimits;
if (!limits || a.modelId !== snapshot.openRouter.modelId) {
  throw new AppError('NOT_READY', 'Accepted settings are unavailable.');
}
```

Use the snapshot's total/first/idle deadlines, retry count/delays, model margin, output tokens and privacy policy through the whole adapter/run. Output record headroom uses immutable storage ceilings; target manifest uses `p.memory.budgets`. Avoid carrying the snapshot in `GraphInput`, invoke options, result, accounting or emitted envelopes: graph hooks close over it in memory. `createModelServices(attemptConfig, limits, ...)` retains the existing adapter and accounting behavior.
- [ ] 8. Release a binding only when its attempt is durably terminal/slot cleared or acceptance is proven not to have persisted. On uncertain acceptance/write, retain it for guarded reconciliation and preserve degradation/quarantine. Cancel/reconcile paths remove completed bindings after durable cleanup; terminal reattachment works without them. Failure from the process-cap gate before execution retains the accepted binding for a later stream request. Safe drain can discard ephemeral bindings only after admission is stopped and no execution/write remains; restart recovery interrupts unexecuted accepted attempts. Never clear a live session's snapshot: P4 owns that longer lifetime.
- [ ] 9. Inject `textSnapshot` into `native-harness.ts` without reading private env. Add `currentConfig: {current: () => snapshot}` alongside the existing config/real persistence/assembler, using matching fixture identity/model/budgets. Existing local reconciliation fixture need not supply a current snapshot because it never infers.
- [ ] 10. Run the principal test; expect PASS. Run `npm test -- test/runtime/text-config.spec.ts test/runtime/graph.spec.ts test/runtime/local-reconciliation.spec.ts test/context test/model` and `npm run build`. Expect routine tests/build pass; production assembly activation remains a P6 gate, not a legacy fallback.
- [ ] 11. Add one red/green test per case, in `text-config.spec.ts`: new work after key removal refuses but accepted A still executes; missing port/null snapshot refuses new work; snapshot input/title/total-run budgets are used; repeated idempotent submit/retry after a save returns original IDs/settings; retry of too-large original input under new settings refuses before POST; mismatched binding scope/model refuses; incomplete acceptance/write does not report success; terminal/cancel/reconcile/drain cleans bindings without cancelling unrelated work.
- [ ] 12. Commit the snapshot group:

```powershell
git add backend/src/chat-runtime/ports.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/test/runtime/text-config-fixture.ts backend/test/runtime/text-config.spec.ts backend/test/runtime/native-harness.ts
git commit --only -m "feat(config): freeze text settings at durable attempt admission" -- backend/src/chat-runtime/ports.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/test/runtime/text-config-fixture.ts backend/test/runtime/text-config.spec.ts backend/test/runtime/native-harness.ts
```

## Task 4: Distinguish automatic retries, explicit retry and live-session handoff

Files: `backend/test/runtime/text-config.spec.ts`; `backend/test/model/adapter.spec.ts`; `backend/src/chat-runtime/durable-chat-runtime.ts` only if a test exposes an incomplete Task 3 path.

- [ ] 1. Add the explicit-retry test using Task 3's fixture and existing `archiveRecords` from `src/chat-runtime/history.js`:

```typescript
it('explicit retry uses current settings and keeps the accepted input once', async () => {
  const h = textConfigFixture(textSnapshot(1, {}, 'fixture/model', 'fixture-A'));
  try {
    const first = await h.submit();
    await h.runtime.reconcileSession(h.identity.userId, first.sessionId);
    h.publish(textSnapshot(2, { maxOutputTokens: 512 }, 'fixture/new', 'fixture-B'));
    const retry = await h.runtime.retryTurn({ identity: h.identity,
      sessionId: first.sessionId, turnId: first.turnId, idempotencyKey: 'retry-key-0001' });
    expect(retry.userMessageId).toBe(first.userMessageId);
    expect(retry.attemptId).not.toBe(first.attemptId);
    await h.execute(retry);
    const body = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ model: 'fixture/new', max_tokens: 512,
      user: h.identity.openRouterUser, transforms: [], provider: { data_collection: 'deny' } });
    expect(body.messages.filter((m: { role: string; content: string }) =>
      m.role === 'user' && m.content === 'Hello')).toHaveLength(1);
    expect((await archiveRecords(h.p, h.identity.userId, first.sessionId))
      .filter(m => m.role === 'user')).toHaveLength(1);
    expect(await h.p.metadata.getAttempt(h.identity.userId, first.sessionId, retry.attemptId))
      .toMatchObject({ causal: { previousAttemptId: first.attemptId } });
  } finally { await h.dispose(); }
});
```

- [ ] 2. Run `npm test -- test/runtime/text-config.spec.ts -t "explicit retry uses current"`; if it already passes from Task 3, record it as a regression, then create the genuinely red automatic-retry/save interleaving case before changing code.
- [ ] 3. Add an automatic-retry test. Use fake timers, attach rejection expectation before advancing timers, and restore real timers in `afterEach`. In the fixture fetcher's first call, publish B and return definitive 429 without ID/output; second returns normal frames. A has `{ retryMaxAttempts: 2, retryBaseDelayMs: 500, retryMaxDelayMs: 500 }`; B has `{ retryMaxAttempts: 1, maxOutputTokens: 512 }`. Run the attempt, advance timers by 600 ms, then assert two POSTs with A key/model/max_tokens/user/privacy and identical bodies. Check one durable attempt/accounting identity, not two. Publishing B must not change retry eligibility/deadlines/body. Subsequent new work must use B and refuse automatic retry under its one-dispatch setting.

```typescript
const calls = h.fetcher.mock.calls;
expect(calls).toHaveLength(2);
expect(calls.map(c => (c[1]?.headers as Record<string, string>).Authorization))
  .toEqual(['Bearer fixture-A', 'Bearer fixture-A']);
expect(calls.map(c => JSON.parse(String(c[1]?.body)).model))
  .toEqual(['fixture/model', 'fixture/model']);
expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
```

- [ ] 4. Run `npm test -- test/runtime/text-config.spec.ts -t "automatic retry"`; expect an actionable snapshot-path failure before the fix, then PASS when Task 3 routes every mutable field through the binding. Keep existing adapter retry transport; the smallest fix is its input config, not a second retry loop.
- [ ] 5. Add/run red/green cases: revision/key save during provider backoff, after first visible delta, and while generation-ID persistence waits. Retain A's timers/output limits; never retry after generation ID/visible text, network ambiguity, 401/402, malformed rejection or EOF. Use existing `adapter.spec.ts` helpers/frames/deferred promise patterns rather than new provider machinery. Do not claim key removal/revocation keeps in-flight credentials usable or prevents charges.
- [ ] 6. Add/run an internal live handoff test solely in `text-config.spec.ts`: acquire the existing live reservation, bind its conversation using `sessionIdFor`, publish B, then call `submitLiveTurn` with `configSnapshot: A`. Assert durable model A and A input/context limits. A missing/mismatched reservation still refuses. A configured current port plus absent `configSnapshot` refuses before acceptance. No voice internals edited; P4/P6 verify full live execution/session handoff. Keep voice attribution/history/finalization logic shared with text rather than branching duplicate adapters.
- [ ] 7. Run `npm test -- test/runtime/text-config.spec.ts test/model/adapter.spec.ts test/runtime/execution-reservations.spec.ts` and `npm run build`; expect all discovered tests pass.
- [ ] 8. Commit named changed files only (omit runtime path if unchanged):

```powershell
git add backend/test/runtime/text-config.spec.ts backend/test/model/adapter.spec.ts backend/src/chat-runtime/durable-chat-runtime.ts
git commit --only -m "test(config): distinguish automatic and explicit text retries" -- backend/test/runtime/text-config.spec.ts backend/test/model/adapter.spec.ts backend/src/chat-runtime/durable-chat-runtime.ts
```

## Task 5: Read live admission ceilings without replacing owners

Files: `backend/src/chat-runtime/work.ts`, `durable-chat-runtime.ts`; `backend/test/runtime/work.spec.ts`, `text-config.spec.ts`.

- [ ] 1. Add this failing WorkRegistry test:

```typescript
it('lowering the live ceiling leaves admitted jobs alive and refuses new work', () => {
  let maximum = 2;
  const r = new WorkRegistry(() => maximum);
  const signal = () => new AbortController().signal;
  const a = r.open('u', 'a', signal(), 10000);
  const b = r.open('u', 'b', signal(), 10000);
  try {
    maximum = 1;
    expect(a.signal.aborted || b.signal.aborted).toBe(false);
    expect(() => r.open('u', 'c', signal(), 10000)).toThrowError();
    a.close();
    expect(() => r.open('u', 'c', signal(), 10000)).toThrowError();
    b.close();
    const c = r.open('u', 'c', signal(), 10000);
    c.close();
    expect(r.snapshot().active).toBe(0);
  } finally {
    if (r.get('u', 'a')) a.close();
    if (r.get('u', 'b')) b.close();
  }
});
```

- [ ] 2. Run `npm test -- test/runtime/work.spec.ts -t "lowering the live ceiling"`. Expect constructor/cap comparison mismatch; not a timer leak from the test.
- [ ] 3. Change only WorkRegistry's ceiling argument/comparison:

```typescript
constructor(private readonly maximum: number | (() => number) = 8) {}
// In open, after the existing same-session check and before constructing a Work:
const maximum = typeof this.maximum === 'function' ? this.maximum() : this.maximum;
if (this.jobs.size >= maximum) {
  throw new AppError('CONCURRENCY_LIMIT', 'Too many chat requests are active.');
}
```

Validated P1 snapshots provide finite positive ceilings. Runtime supplies a callback reading the current snapshot's process concurrency; absent configuration uses a conservative fixed ceiling of one for provider-free recovery/control, never environment-derived manageable limits. Update `joinAcceptance` to read current process ceiling at a **new** join; a matching existing join is returned first. Keep its finite 1024 structural ceiling as well. Existing jobs keep their Work/deadline and reservation identity, and no publication mutates jobs.
- [ ] 4. Run the red test; expect PASS. Add/run capacity-increase case and same-session conflict at any ceiling. New admission reads B, while pending execution at capacity returns `CONCURRENCY_LIMIT` without losing its A binding. Lowering is refusal, not cancellation or a newly introduced queue.
- [ ] 5. In `text-config.spec.ts`, hold two executions with existing deferred promises, publish ceiling one, assert neither signal aborted, refuse third, finish both, then admit third with current settings. Assert the original runtime/work/reservations objects stay `===` across saves, active count never underreports, and unresolved writes still quarantine/drain as existing `work.spec.ts` requires.
- [ ] 6. Run `npm test -- test/runtime/work.spec.ts test/runtime/text-config.spec.ts test/runtime/execution-reservations.spec.ts` and `npm run build`; expect all discovered tests pass. Report request-rate counter continuity as **P6-owned, not yet proved**; do not add/reset counters in P3.
- [ ] 7. Commit:

```powershell
git add backend/src/chat-runtime/work.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/test/runtime/work.spec.ts backend/test/runtime/text-config.spec.ts
git commit --only -m "feat(config): apply live text admission ceilings in place" -- backend/src/chat-runtime/work.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/test/runtime/work.spec.ts backend/test/runtime/text-config.spec.ts
```

## Task 6: Remove stale HTTP gates and freeze the active writer deadline

Files: `backend/src/chat-runtime/{ports,durable-chat-runtime}.ts`; `backend/src/http/{options,chat-http.service,chat-stream.transport,configure-chat-http}.ts`; `backend/test/http/{service,stream-transport}.spec.ts`, `routes.e2e-spec.ts`.

- [ ] 1. Add the input-gate failing test to existing `service.spec.ts`:

```typescript
it('does not apply a startup manageable input cap before runtime admission', async () => {
  const o = fixtureOptions();
  o.budgets.maxInputChars = 4;
  const s = new ChatHttpService(o);
  expect(await s.submit(null, { ...submission, content: 'Hello current settings' })).toEqual(ids);
  expect(o.runtime.submitTurn).toHaveBeenCalledTimes(1);
  await expect(s.submit(null, { ...submission, content: 'x'.repeat(32001) }))
    .rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
});
```

The runtime remains authoritative for current manageable input limits; the HTTP precheck protects only fixed transport/storage caps. Checking current manageable input in HTTP before duplicate resolution would also break idempotent resubmission after lowering limits.
- [ ] 2. Run `npm test -- test/http/service.spec.ts -t "does not apply a startup"`. Expect `INPUT_TOO_LARGE` from the stale four-character limit.
- [ ] 3. Change only the service's existing pre-schema bounds call, preserving UTF-8 storage checks:

```typescript
inputBounds(raw.content, { ...this.o.budgets, maxInputChars: 32000 });
```

Keep strict body identity/unknown-field/schema rejection; caller-provided keys/models/settings remain invalid. Runtime validates snapshot input tokens/chars after duplicate lookup. Run the red test again; expect PASS.
- [ ] 4. Add a route e2e fixture with initial input cap four, then a runtime/current-config fixture admitting a 100-character valid request after settings increase. The request must reach runtime without parser 413. Add a second test where runtime rejects current input-token limit, proving HTTP does not bypass runtime validation. Do not use real providers/database. Run `npm run test:e2e -- test/http/routes.e2e-spec.ts -t "parser ceiling"`; expect stale-parser 413 before the fix.
- [ ] 5. In `configure-chat-http.ts`, keep a single bounded startup parser but make its JSON ceiling independent of editable input settings:

```typescript
const limit = Math.min(262144, 32000 * 6 + 4096);
```

Retain the existing signature during P6 transition, naming its unused budget parameter `_budgets`; document with a short ordinary comment that JSON escape overhead is fixed transport safety. Preserve no-store/nosniff and safe parser errors. P2/P6 install the stricter 16 KiB admin route boundary separately; this parser limit is not permission for oversized admin candidates.
- [ ] 6. Run the route red test again; expect PASS; oversized fixed transport/invalid JSON must still reject with safe errors. No parser replacement/reinstallation on saves.
- [ ] 7. Implement the concrete runtime's safe `attemptStreamBudgets` accessor. Validate server user/session/attempt scope, return a new object with only idle timeout and immutable message-byte ceiling from the bound snapshot. For terminal/recovery control use fixed `DEFAULT_BUDGETS.idleStreamTimeoutMs` and persistence storage safety, without requiring a key. Never return full budgets/settings/snapshot/credentials to HTTP or wire callers. Add a routine assertion in `text-config.spec.ts` that captured A idle=20000 persists after B idle=1000, and `Object.keys(result).sort()` equals `['idleStreamTimeoutMs','maxMessageBytes']`.
- [ ] 8. Add a failing stream test using existing `fixtureOptions`, `deferred`, and `socket()` in `stream-transport.spec.ts`. Supply `runtime.attemptStreamBudgets = () => ({ idleStreamTimeoutMs: 20000, maxMessageBytes: 65536 })`; set startup idle to five milliseconds. Have mocked execute emit one delta, wait 20 fake milliseconds, then emit completed. Assert no abort/writer error and genuine terminal completion. A settings save to idle=1 while waiting must not reconstruct the writer or shorten its deadline. Run `npm test -- test/http/stream-transport.spec.ts -t "captured writer deadline"`; expect stale writer abort before the fix.
- [ ] 9. In `ChatStreamTransport.open`, read current concurrency once at a new attachment and preserve the same-session attachment check/map. With a supplied current port, use its current ceiling or fixed one when null; without that transitional port, keep existing fixture budgets for compatibility. After resolving selected attempt status, get safe attempt budgets before creating one writer:

```typescript
const streamBudgets = o.runtime.attemptStreamBudgets?.(userId, sessionId, status.attemptId)
  ?? { idleStreamTimeoutMs: o.budgets.idleStreamTimeoutMs,
    maxMessageBytes: o.budgets.maxMessageBytes };
writer = new SseWriter(res, abort, streamBudgets.idleStreamTimeoutMs,
  6 * Math.min(streamBudgets.maxMessageBytes, 65536) + 4096,
  { sessionId, turnId, attemptId: status.attemptId });
```

The optional fallback is for existing fake runtimes while P6 forwards the method; integrated P6 acceptance must assert the production observed wrapper has/uses it. Do not allow P6 to declare active deadline consistency from only the raw runtime tests. The runtime still enforces final process concurrency and the attempt's actual deadlines. Writer lifecycle/disconnect/backpressure handling is unchanged, and lowering caps does not detach existing streams.
- [ ] 10. Run the writer red test; expect PASS. Add/run new-stream increase/decrease, two-tabs same-session conflict, cancelled/terminal attachment with removed key, and no-secret accessor tests. Use existing stream regression cases to prove no fabricated terminal success after finalization/storage failure.
- [ ] 11. Run `npm test -- test/http test/runtime/text-config.spec.ts`, `npm run test:e2e -- test/http/routes.e2e-spec.ts`, and `npm run build`; expect fixture checks/build pass. Report unrelated failures rather than widening ownership.
- [ ] 12. Commit:

```powershell
git add backend/src/chat-runtime/ports.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/src/http/options.ts backend/src/http/chat-http.service.ts backend/src/http/chat-stream.transport.ts backend/src/http/configure-chat-http.ts backend/test/http/service.spec.ts backend/test/http/stream-transport.spec.ts backend/test/http/routes.e2e-spec.ts backend/test/runtime/text-config.spec.ts
git commit --only -m "fix(config): keep HTTP bounds and streams consistent with text snapshots" -- backend/src/chat-runtime/ports.ts backend/src/chat-runtime/durable-chat-runtime.ts backend/src/http/options.ts backend/src/http/chat-http.service.ts backend/src/http/chat-stream.transport.ts backend/src/http/configure-chat-http.ts backend/test/http/service.spec.ts backend/test/http/stream-transport.spec.ts backend/test/http/routes.e2e-spec.ts backend/test/runtime/text-config.spec.ts
```

## Task 7: Preserve saved-result recovery and prove durable state is secret-free

Files: `backend/test/runtime/local-reconciliation.spec.ts`, `graph.spec.ts`, `text-config.spec.ts`, `text-config.native.e2e-spec.ts`; `backend/src/chat-runtime/durable-chat-runtime.ts` only for demonstrated defects. Do not change graph schema/channels or finalization sequencing to store configuration.

- [ ] 1. Extend the existing local reconciliation `fixture` with an optional `CurrentConfigPort` argument passed into the runtime; leave its deterministic sealed-result construction intact. Add/run a failing test using `current: () => textSnapshot(9, {maxInputTokens:128,maxContextTokens:2048,maxOutputTokens:128,modelMarginTokens:128}, 'fixture/new', '', 'u1')`. Seal the original result, reconcile twice, and assert completed archive/accounting/manifest alignment and **zero fetch calls**. Repeat with `current: () => null` and with `current` throwing if called, proving recovery has no configuration/key dependency. The saved answer remains authoritative even if the new model/output/context is smaller or absent.

```typescript
it('finalizes saved work without reading current credentials or replaying inference', async () => {
  const f = fixture({ current: () => { throw new Error('Recovery must not read settings'); } });
  await f.seal();
  await f.runtime.reconcileSession('u1', 's1');
  await f.runtime.reconcileSession('u1', 's1');
  expect(f.getAttempt().status).toBe('completed');
  expect(f.originals.map(m => m.content)).toEqual(['Hello', 'Saved response']);
  expect(f.fetcher).not.toHaveBeenCalled();
});
```

Work admission during recovery must use a provider-free control path/fixed recovery ceiling, not a callback that calls `current()`. Extend the existing `open` method without a second registry:

```typescript
open(u: string, s: string, signal: AbortSignal, totalMs: number, recovery = false) {
  if (this.jobs.has(this.key(u, s))) {
    throw new AppError('CONFLICT_ACTIVE_TURN', 'Another request owns this turn.');
  }
  const maximum = recovery ? 1
    : typeof this.maximum === 'function' ? this.maximum() : this.maximum;
  if (this.jobs.size >= maximum) {
    throw new AppError('CONCURRENCY_LIMIT', 'Too many chat requests are active.');
  }
  const job = new Work(signal, totalMs, () => this.jobs.delete(this.key(u, s)),
    () => { this.degraded = true; });
  this.jobs.set(this.key(u, s), job);
  return job;
}
```

Pass `true` only from internal reconciliation, nonrunning cancellation and rebase work. Use fixed `DEFAULT_BUDGETS.totalRunTimeoutMs` for provider-free recovery/control, with immutable persistence/drain deadlines from repositories/bootstrap; do not consult stale manageable startup budgets or current credentials. New acceptance and inference never set this flag. The same jobs map/session checks remain authoritative, so recovery cannot overlap live work or bypass one-owner fencing.

- [ ] 2. Run `npm test -- test/runtime/local-reconciliation.spec.ts -t "without reading current"`. Expect a current-port access or stale-fit failure before the fix, then PASS. If Task 3 already correctly separates recovery, add the assertion as regression and leave implementation unchanged.
- [ ] 3. Audit every call to `checkBoundary`, `outputBudget`, `interruptOwned`, `work.open`, assembler `assemble`, model factory and manifest builder in `durable-chat-runtime.ts`. Inference calls require the captured snapshot; reconciliation/cancel/rebase/terminal paths use durable evidence plus immutable repository safety. Keep `publishResult`/`checkedResult` using saved results and persistence budgets. Do not recheck saved results against current model limits, access current keys, call catalogue during repair, or change the order of checkpoint sealing, finalizing, application writes, boundary confirmation and terminal emission.
- [ ] 4. Add/run a routine restart test in `text-config.spec.ts`: accept A, construct a second runtime with the same in-memory persistence but B/current null and no A binding. Executing the still-accepted attempt must refuse before POST. After authorizing stopped owner when needed, reconcile to `interrupted`, preserve original input, then explicit retry uses B. Never implicitly recreate a missing binding from durable `modelId` or current credentials.
- [ ] 5. Add/run secret nonpersistence checks in `graph.spec.ts` and `text-config.spec.ts`. Complete an A attempt then inspect durable attempts, acceptance, accounting, manifests and every MemorySaver checkpoint/pending write. Assert absence of fixture A/B keys, `apiKey`, `credentials`, envelopes, `configSnapshot` and full `settings`; existing strict result/attempt schemas reject those added fields. Permit the existing model ID, provider accounting IDs and visible output; do not ban user text just because it coincidentally names a field.

```typescript
const cfg = graphConfig(h.identity.userId, ids.sessionId);
const saved = [];
for await (const tuple of h.saver.list(cfg)) saved.push(tuple);
const serialized = JSON.stringify(saved);
expect(serialized).not.toContain('fixture-secret-A');
expect(serialized).not.toContain('fixture-secret-B');
expect(serialized).not.toMatch(/"(?:apiKey|credentials|configSnapshot|settings)"\s*:/);
```

Use unique sentinel keys in this fixture, not the ordinary `fixture-key` shared by unrelated tests. Also check stream envelopes/errors for sentinels. Provider request headers are intentionally transient and excluded from persisted/wire assertions.
- [ ] 6. Add `text-config.native.e2e-spec.ts` by reusing `nativeHarness`, existing lifecycle/recovery tests and `archiveRecords`. Inject a mutable current pointer; fake fetch stays local. Cases: save between acceptance/attachment; explicit retry after model change; archive failure after sealed answer then restart on B/null; incomplete accepted A restart interrupts without POST; terminal read with removed key; length truncation remains distinct. Assert one provider call for saved-result finalization and no duplicate assistant/input/accounting/manifest revision after repeated repair.
- [ ] 7. If operator-supplied isolated replica-set prerequisites exist, run `npm run test:e2e -- test/runtime/text-config.native.e2e-spec.ts test/runtime/recovery.native.e2e-spec.ts test/runtime/acceptance.native.e2e-spec.ts test/runtime/lifecycle.native.e2e-spec.ts test/runtime/isolation.native.e2e-spec.ts`. Require `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`, generated test DBs only. Do not print URI/credentials, start/provision a DB, or use application data. Otherwise report **native verification blocked/skipped**, not passed. Source presence or a zero-test exit is not evidence.
- [ ] 8. Run `npm test -- test/runtime test/context test/model test/http`, `npm run build`, `npm run lint`, then `npm test`. Record discovered counts/results and any unrelated failures; no paid/live/API validation calls. P6/P7 must rerun full suites once assembly and P4 live handoff are wired. Do not mark integrated source separation or quota continuity complete from P3-focused passes.
- [ ] 9. Commit named actual changes only:

```powershell
git add backend/test/runtime/local-reconciliation.spec.ts backend/test/runtime/graph.spec.ts backend/test/runtime/text-config.spec.ts backend/test/runtime/text-config.native.e2e-spec.ts
git commit --only -m "test(config): preserve text recovery and secret-free checkpoints" -- backend/test/runtime/local-reconciliation.spec.ts backend/test/runtime/graph.spec.ts backend/test/runtime/text-config.spec.ts backend/test/runtime/text-config.native.e2e-spec.ts
```

If a red test required runtime/work fixes, stage those exact owned files in a separate `fix(config): keep text reconciliation independent of active settings` commit before the verification-only commit; rerun affected tests. Never include P6/P4 files to make the checkpoint green.

## Exit gates and handoff

| P3 gate | Evidence from this plan | Acceptance mapping |
| --- | --- | --- |
| Current-config consumption, no legacy fallback for new generation | Task 3 missing-port/null/key/model tests; Task 1 narrow model inputs; P6 completes actual production wiring | AC2, AC5 |
| New versus accepted/active revisions | Task 3 acceptance-gap/key removal; Task 4 delta/backoff/ID-save interleavings | AC5 |
| Automatic versus explicit retry | Task 4 identical automatic dispatch bodies/headers, explicit retry current settings/causal input linkage and no repeated user message | AC5, AC8 |
| Safe model/context/output changes | Tasks 1–2 catalogue/fixed fit, full-history overflow, storage/transport caps; Task 3 snapshot max_tokens and truncation | AC6, AC8 |
| Lowered concurrency and unchanged authorities | Task 5 same-object runtime/work/reservations, no active abort, new refusal and later admission; Task 6 transport | AC5, AC6 |
| Request-rate accounting survives edits | P6-owned existing Admission changes/tests; P3 adds no competing counter owner | AC5, AC6; integrated gate remains pending |
| Active live turns retain voice-session text settings | Task 4 internal snapshot handoff; P4 owns session/bridge implementation, P6/P7 prove integration | AC5, AC8; integration remains pending |
| Durable terminal and recovery behavior | Task 7 sealed publication/repeated repair/no-result restart, terminal reattachment and existing lifecycle checks | AC8 |
| Keys absent from attempts/checkpoints/API/log events | Task 7 every checkpoint/pending-write and record assertions; Task 6 safe numeric accessor | AC3, AC8 |
| Native topology evidence | Task 7 isolated prerequisite-gated suites; absent prerequisites explicitly blocked/skipped | AC8 |

P3 worker returns: actual commits/paths, routine test counts and commands, native executed/skipped status, interface names above, binding lifetime/cap and cleanup evidence, and any source/contract drift. No P3 plan/test-only result establishes production, Azure, real-provider or gateway readiness.

Required P6 integration items:

1. Provide the same `CurrentConfigPort` to runtime and HTTP, one `forBudgets`-capable reference assembler, fixed assets and shared persistence. Stop using startup manageable values for any new model generation; normal startup ignores obsolete manageable env values.
2. Use `prepareTextConfiguration` plus P1 snapshot construction before durable write/publication; any same-model budget edit also gets fixed/context/output preflight. No catalogue/inference on readiness polling or reconciliation. Missing key/model yields admin/unconfigured state, not a second executor.
3. Preserve `OperationsService`/Admission counters; read current concurrency/rate ceilings in existing owners. Lowering refuses new work without aborting existing jobs; raising becomes effective without owner replacement. Keep cancel/status/control capacity and one active generation per session.
4. Forward the concrete `attemptStreamBudgets` method through `observedRuntime`; verify no startup writer deadline remains on a captured attempt. P6 assembly has no runtime fallback when the optional transition ports are absent.
5. Arrange startup reconciliation even when current settings cannot enable inference; saved sealed results require only persistence/durable evidence. Build legacy compatibility `config` data from bootstrap/fixed defaults only as needed for untouched infrastructure ports, never from ignored manageable env values or a mutable active snapshot.
6. P4 passes the frozen session snapshot into `SubmitLiveTurn.configSnapshot`; neither P6 navigation nor config publication replaces an active voice owner/session's settings. No quotas/rates are reset by P3.

Risks/decisions:

- P1 interfaces match this plan; no requested P1 edits. If the worker observes schema/interface drift, pause dependent work and report the exact conflicting name/type/owner rather than editing contracts.
- A decrypted snapshot must survive the accepted-but-unattached interval. The fixed 1024 binding cap bounds memory; rejected new admission is preferable to silent eviction. Key removal does not revoke that transient copy and cannot guarantee continued provider usability. Clear it at durable termination/reconciliation/safe shutdown, not at a settings edit.
- Snapshot provenance is intentionally not restart-resumable inference: no key or full snapshot is persisted; restart interrupts unsaved work and finalizes already saved results. Adding durable revision provenance/credential versions is a P1/P2 decision if later required, not a reason to replay inference now.
- Current OpenRouter documentation marks `max_tokens` deprecated. The pinned serializer/allowlist and P1 verification contract retain it; do not silently switch request syntax or admit models lacking that support. Report provider incompatibility as an actionable configuration failure/upstream migration decision.
- Full package checks may expose P6/P4 transition gaps until their workers finish. Report exact failures and ownership; focused passes do not excuse them. Do not alter sibling/user frontend changes, unresolved voice investigation defects, or operation ownership for convenience.
- Native checks need an operator-supplied isolated admitted replica set. Missing prerequisites leave that acceptance evidence blocked; fixtures are not native certification. Research/review remain skipped throughout.

## Plan/document checkpoint (planning only)

- [ ] Confirm source/interface names against committed P1, every file path and ownership, no new dependency, no live calls or migration step.
- [ ] Check all new helpers/test fixture names are defined here; run a placeholder/whitespace/link consistency check on `docs/super-admin-config/plan3.md` only.
- [ ] Stage/commit only this plan with `docs(super-admin-config): plan 3 - text snapshots`, preserving sibling index/worktree contents. Use path-limited commit; index-lock retries use bounded backoff, never delete `.git/index.lock`.
- [ ] Return the plan commit and concise P6/P4 interfaces/risks to the orchestrator. Do not update graph/state or claim implementation/tests executed in this planning session.
