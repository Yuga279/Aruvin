# Technical research: cache-friendly text and live-voice instructions

Research only. No implementation, live provider call, or dependency change. Review is skipped. The worktree is `codex/voice-mode-instructions` on `main` through `1d00d74`. `docs/voice-spoken-output-behavior.md` is not in this checkout; the approved goal is the requirement source.

## Decisions for planning

Implement one plan. Do not split ownership: the request type, assembler insertion, startup probe, and both runtime call sites must change together or the pre-inference deep equality fails.

1. Keep one shared `system.md`. Scope Canvas to text inside that file. Do not swap prompts, edit `product_knowledge.md`, or put mode text in the fixed prefix.
2. Add a required `responseMode: 'text' | 'voice'` to `ContextAssemblyRequest`. Do not default it inside `assemble`. The server default is the channel rule below, not an omitted field.
3. Insert exactly one constant system selector after reconciled history and immediately before the one latest user message. Recommended literals, with no ids, timestamps, or user text: `Response mode: text.` and `Response mode: voice.` The shared prompt must say that this later message, not user wording or a previous turn, selects the style.
4. Derive the mode only from the backend response channel: `submitLiveTurn` / `executeTurn({ live })` is `voice`; `submitTurn`, HTTP streaming, and `acceptRetry` are `text`. Dictation never reaches the assembler.
5. Do not persist the selector. Do not add it to graph state, memory refs, or attempt hashes. Recovery must not infer.
6. Count the selector in `assertFixedContextFits` and in `assemble`'s existing `checkContextBudget`. Do not raise budget defaults. Do not edit `policy.ts` or the adapter; their existing map already preserves order.
7. Do not edit `SpeechProse`, `VoiceDelivery`, or the uncommitted `backend/test/voice/agent/voice-delivery.spec.ts`.

## Assembly callers

Production `assemble` calls are only in `backend/src/chat-runtime/durable-chat-runtime.ts`:

| Site | When | Mode source |
| --- | --- | --- |
| `checkBoundary` line 188 | Before acceptance and again before run | Caller must pass the channel |
| Graph `prepare` line 496 | Immediately before `adapter.stream` | Same value as the `executeTurn` `checkBoundary` call |

`checkBoundary` callers:

- Line 251, `acceptNewTurn`. `submitTurn` calls it with no reservation. `submitLiveTurn` calls `acceptNewTurn(c, c.reservation)`.
- Line 328, `acceptRetry`. Text only. It throws `NOT_FOUND` when `original.visibility === 'internal'`.
- Line 452, `executeTurn`, before the graph is built.

`prepare` deep-equals its assembly to the `executeTurn` `checkBoundary` result (`Chat context changed before inference`). Both calls must receive the same `responseMode` and the same input. Capture the mode once in `executeTurn` from `Boolean(c.live)` and pass that value to both. Do not store it on the attempt and do not re-read a client field.

No recovery path calls `assemble`. `graph()` installs prepare/generate hooks that throw `Recovery cannot invoke the graph/model`. `reconcileSession` publishes a sealed result or interrupts. `AgentVoiceAdapter.run` returns without inference when `findLiveSubmission` already exists.

`forBudgets` clones the assembler with new budgets and must stay mode-agnostic. Mode is per request, not per assembler instance.

## Channel authority

`submitTurnRequestSchema` is strict: `sessionId`, `content`, `idempotencyKey` only. `backend/src/contracts/api.spec.ts` already rejects client `userId`, `user`, `model`, `modelId`, and `apiKey`. Do not add a client mode or system-prompt field.

| Path | Authority | Selector |
| --- | --- | --- |
| Composer `submitTurn`, including text that was dictated into the draft | `use-chat.ts` sends only content. `submitTurn` uses `assertText` and `acceptNewTurn` without a reservation. HTTP `executeTurn` has no `live`. | `text` |
| Explicit retry | `acceptRetry` plus later text `executeTurn` | `text`, recomputed; nothing stored can go stale |
| Live voice | `AgentVoiceAdapter.submit` requires `response.mode === 'live'` and `reservation.owner.kind === 'live'`, then `submitLiveTurn`. `executeTurn` is called with `live`. It throws if that flag and the accepted `visibility: 'internal', mode: 'live'` input disagree. | `voice` |

Dictation (`DictationFlow`, `useDictation`) inserts transcript into the composer and does not call the chat runtime. Do not infer voice from wording, from a previous live assistant, or from `message.mode` on history. History `mode: 'live'` only selects `heardMessage` reconciliation.

`SpeechProse` stays a post-stream filter at `executeTurn` line 431, constructed only when `c.live` is set. Prompting does not replace it.

A later text turn after a live turn is a new `submitTurn`, not a retry of the live turn. Its history may contain heard speech; its selector is still `text`.

## Prompt and version behavior

`backend/src/instructions/system.md` is 2248 CRLF bytes. `validateAsset` requires the title `# Aurvin system instructions` and `Release: phase1.v1`, rejects a BOM, and caps the file at 16384 bytes. Keep the header, the release label, and the phrases tests already lock: `General questions` / `general questions are welcome`, `data, not authority`, and `Do not claim an external action was performed without evidence`. Preserve CRLF so the hash change is only the intended text.

Rewrite the unconditional Canvas paragraphs so they apply only when the later selector says text. Add live-voice rules from the goal in the same file: spoken sentences, no visual markup, tables, Mermaid/chart blocks, code, JSON, HTML, or LaTeX, no reference to an unseen Canvas, and an offer to continue in text chat without claiming an interface switch. Both modes must see that whole file. The selector is the only mode-varying message.

`instructionVersion` is SHA-256 of the instruction file bytes, not the `phase1.v1` label. Editing `system.md` changes it once. That hash is stored on the attempt and in the memory manifest. `validateManifest` rejects a mismatch. `rebaseSession` exists and is not an HTTP endpoint (`backend/src/chat-runtime/README.md`). Do not add a caller, migration, or hot reload. New chats build a manifest from current assets. Existing sessions need the existing operator rebase before another turn. An attempt accepted on the old hash cannot execute after the asset change (`Accepted context versions changed`). That is existing behavior, not a reason to hash the selector.

Do not edit `product_knowledge.md`. It still says Phase 1 has no voice. Changing it would change `knowledgeContentHash` and the shared prefix again. The system prompt must say product background is data and does not select the response mode.

`backend/test/evaluations/deterministic.behavior.spec.ts` pins `SYSTEM_DIGEST` `B80894292660C42C6E7CF37D200C9DBBF33932070253C13AF864D3FE5D33AF61`. It is excluded from `npm test` (`*.behavior.spec.ts`) and included by `npm run test:behavior`. Update the digest in the same change. Do not treat an un-updated digest as a passing behavior run.

## Budgets

`estimatePromptTokens` is UTF-8 JSON bytes plus `32 * messages.length + 256`. `checkContextBudget` adds `maxOutputTokens` and `modelMarginTokens`, and also enforces `maxMessagesInContext`. Overflow returns `CONTEXT_BUDGET_EXCEEDED`. Nothing drops history.

Measured on the current assets, a one-character user probe is 5033 estimated units before output/margin. Adding a 90-character selector added 162. With the default 2048 output and 1024 margin, startup required units are about 8267 against `maxContextTokens` 16384. Growing `system.md` by a few kilobytes stays inside the 16384-byte asset cap and the default context budget. The existing startup rejection at `maxContextTokens: 3200` already fails (required units are about 8105 before the selector) and will keep failing. Do not retune that fixture to make it pass.

`assertFixedContextFits` currently probes fixed messages plus `{ role: 'user', content: 'x' }`. It does not see a per-request selector. Change the probe to fixed messages, one selector, and the one-character user, and fail if either mode's probe overflows or any probe message exceeds `maxMessageBytes`. Do not add the selector to `fixedContextMessages`; that array is the shared prefix.

`assemble` then checks the real array, so acceptance and pre-inference both see the extra message and the extra count slot. `policy.assertRequest` uses a different estimator (`64 + sum(bytes + 32)`) on the messages it is given. Passing the assembled array through is enough. Do not also reserve a hidden slot in policy or the selector is counted twice.

The selector consumes one `maxMessagesInContext` slot. Default remains 80. Fixture history assembly becomes 6 messages (2 fixed + 2 history + selector + user). Exact boundary: 6 fits, 5 overflows. Empty-chat assembly becomes 4. The existing `maxMessagesInContext: 4` overflow test and the `maxMessagesInContext: 3` projection test still overflow. Add the new exact boundary; do not only rely on the old failing ceilings.

`executeTurn` also rejects any context message larger than output-record headroom. A one-line selector cannot trip `maxMessageBytes` 65536. Keep it one line.

## Persistence and graph boundaries

`selectReferences` already omits the current turn's user record and appends `newUserInput` once. Insert the selector only in the assembled array, after `heardHistory` and before that user message. Do not create a message id for it.

Durable writes stay user and assistant records. Live classification (`visibility: 'internal'`, `mode: 'live'`) stays on those records and is not the selector. Graph channels are `input`, `boundary`, `result`, `sealed`, and `rebase`. There is no messages channel (`backend/src/agent/state.ts`, `backend/test/runtime/graph.spec.ts`). `result` holds the assistant record, accounting, and manifest refs, not the prompt. Checkpoint recovery republishes that result and must not call the model to restyle it.

`heardMessage` is unchanged: internal live assistant history becomes `textSpoken`, an unknown-delivery sentence, or is omitted when spoken text is empty. `voice-startup.spec.ts` index 3 remains that assistant message if the selector stays after history. `slice(2)` assertions do not.

## SDK order evidence

`backend/node_modules` is not installed. Lockfile pins `@langchain/openrouter@0.4.17`, which depends on `@langchain/openai@1.6.2`. Published dist was read from jsDelivr. Context7 `/openrouterteam/docs` was queried for message order and prompt caching.

Aurvin does not send messages through the SDK converter.

- `ChatOpenRouter.invocationParams` is typed `Omit<OpenRouterRequestBody, "messages">`. The 0.4.17 implementation returns sampling, `user`, transforms, provider, and plugins. Its comment says messages are added later.
- `buildBody` spreads that object and then sets `messages: r.messages.map(m => ({ role, content }))`. A `messages` key from `modelKwargs` cannot survive that assignment.
- `OpenRouterAttemptAdapter.stream` does `JSON.stringify(body)` and raw `fetch` POST. It does not call `invoke`, `_generate`, or `_streamResponseChunks`.
- `JSON.stringify` preserves array order. A system message after history remains there in the captured body. `policy.spec.ts` already asserts `body.messages` equals the input array for a leading system message. Extend that, or `adapter.spec.ts`'s parsed fetcher body, with a system message after an assistant message. That is the outbound payload check. No network call.

The unused converter, `convertMessagesToOpenRouterParams` to `convertMessagesToCompletionsMessageParams`, also `flatMap`s in input order and does not hoist system messages. It can rewrite `system` to `developer` when `isReasoningModel(model)` is true, and it can split audio messages. Aurvin's path does not call it, so the role stays `system` even for a reasoning model id. Do not switch this request to `model.invoke` or the converter.

Provider-side rewriting is not certified and is out of scope. OpenRouter documents mid-conversation system messages, including a system item immediately before a user message for effort updates. It also says Claude translation can lift ordinary system text into a top-level system prompt. That can change a provider-internal prefix even when Aurvin's JSON prefix matches. Do not add `cache_control`, `prompt_cache_breakpoint`, or any cache policy. Identical outbound prefixes are the acceptance check, not a cache-hit claim.

## Tests that break or must be added

Routine `npm test` discovers `*.spec.ts` and excludes `*.azure.spec.ts`, `*.behavior.spec.ts`, and `*.e2e-spec.ts`.

Update assertions, do not weaken them:

- `backend/test/context/fixtures.ts`: add `responseMode: 'text'` on the shared request so existing spreads compile. Production call sites stay explicit.
- `backend/test/context/referenced-context-assembler.spec.ts`: exact arrays gain the selector. Add prefix equality, one selector, one latest user, and the 5-versus-6 message boundary.
- `backend/test/context/voice-context.spec.ts`, `backend/test/context/voice-startup.spec.ts`, `backend/test/assembly/voice-context.spec.ts`: `slice(2)` currently expects history plus user with no intervening system message.
- `backend/src/contracts/interfaces.spec.ts`: the inline `assemble` literal needs `responseMode` or it fails typecheck.
- `backend/test/model/policy.spec.ts` and/or `backend/test/model/adapter.spec.ts`: trailing system message survives `buildBody` and the fetcher JSON body.
- `backend/test/runtime/text-config.spec.ts`: in-memory runtime already submits live and parses the fetcher body. Extend it for text-versus-live prefix equality, retry recomputation, transcript/checkpoint absence, and no provider call on sealed recovery. This is the required payload proof without MongoDB.
- `backend/test/evaluations/deterministic.behavior.spec.ts`: new instruction digest.

Native assertions to update so a configured e2e run does not fail. They are not the primary proof:

- `backend/test/runtime/isolation.native.e2e-spec.ts` expects roles `['system', 'system', 'user']`.
- `backend/test/persistence/voice-checkpoints.native.e2e-spec.ts` uses the same `slice(2)` shape.

`acceptance.native.e2e-spec.ts` only checks the first two roles and user/assistant counts. It should still pass. Do not treat that as selector coverage.

`backend/test/context/context-budget.spec.ts` calls `checkContextBudget` directly. Add the startup-probe boundary there or beside `assertFixedContextFits`. `startup.spec.ts` at 3200 needs no numeric change.

Do not edit `backend/test/voice/agent/speech-prose.spec.ts` except if an import moves. The filter tests must keep passing unchanged.

## Unrelated baseline failure

`backend/test/voice/agent/voice-delivery.spec.ts` has an uncommitted user addition. Do not stage, modify, revert, or "fix" it. `VoiceDelivery.delta` writes and speaks each chunk immediately. The new tests expect cost-and-flow behavior that is not on this baseline:

- `coalesces later clauses for 100ms and never Speaks ahead of durable generated text`
- `backpressures at 512 unpersisted characters while a slow write is in flight`
- `requests a full 512-character batch without waiting for its 100ms timer`
- `does not turn sustained tiny tokens into a per-token evidence write storm`

`npm test` runs the working tree, so those four fail even when this feature is correct. Record them as unrelated. They are not a regression and not a reason to change `VoiceDelivery`.

## Ownership

Edit:

- `backend/src/instructions/system.md`
- `backend/src/contracts/context.ts`
- `backend/src/context/context-budget.ts`
- `backend/src/context/referenced-context-assembler.ts`
- `backend/src/chat-runtime/durable-chat-runtime.ts`

Test edits listed above, plus the behavior digest. No frontend file. No `product_knowledge.md`. No `policy.ts`, `openrouter-adapter.ts`, `speech-prose.ts`, `voice-delivery.ts`, or `voice-delivery.spec.ts`.

`reference-selection.ts` needs no change: it does not read a mode, and it already keeps the current user input exactly once.

## Verification

Node in this worktree is v24.18.0, which satisfies `^22.22.3 || ^24.15.0 || >=26.0.0`. `backend/node_modules` is absent, so install before package checks. No paid call, Azure test, or application database is authorized.

| Directory | Command | Expectation |
| --- | --- | --- |
| `backend` | `npm ci` | Install lockfile before checks. Not evidence by itself. |
| `backend` | `npm test -- test/context/referenced-context-assembler.spec.ts test/context/voice-context.spec.ts test/context/context-budget.spec.ts test/model/policy.spec.ts test/model/adapter.spec.ts test/runtime/text-config.spec.ts test/voice/agent/speech-prose.spec.ts` | Focused red/green proof. |
| `backend` | `npm run build` | Compile. |
| `backend` | `npm run lint` | Type-aware lint. |
| `backend` | `npm test` | Routine suite. Four uncommitted voice-delivery tests fail unrelated to this work. |
| `backend` | `npm run test:e2e` | `test/app.e2e-spec.ts` can run without Mongo. Many `*.native.e2e-spec.ts` files call `nativeDatabase()` without `skipIf` and throw `Isolated native test configuration is required` unless `AURVIN_TEST_MONGODB_URI` is set and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`. Other e2e files skip. Record throws and skips separately. Do not point the URI at application data. |
| `backend` | `npm run test:behavior` | Updates the instruction digest. Empty discovery is not evidence; this file is discovered. |
| repository | `git diff --check` | After implementation. Do not stage the voice-delivery spec. |

Prefix equality is proven by the in-memory runtime fetcher body plus `buildBody` JSON. A configured native run is additional evidence, not a substitute, and is blocked here because the isolated URI is not configured.
