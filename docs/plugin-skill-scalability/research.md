# Plugin skill scalability — technical research and baseline

Research date: 4 November 2026. Goal: [goal.md](goal.md). Assignment/ownership: [state.md](state.md). Research only; no application source changes, live provider calls, infrastructure, or dependency changes.

## 1. Baseline and environment

- Checkout: `D:/Peter/Aurvin Agent/Aurvin`; branch `codex/plugin-skill-scalability-v1`; HEAD at capture `bab30722901d2752da2348ed36f08829766431fe`.
- Application source equals `118ba21`, including confirmed-state reuse `04485ad`: `git diff --stat 118ba21 -- backend/src frontend/src` returned no differences. Working tree initially clean.
- Windows PowerShell; Node `v24.18.0`, npm `12.0.1`, installed Vitest reports `4.1.11`. Existing dependencies were used without installation.
- `AURVIN_TEST_MONGODB_URI` absent; required test prefix not set. No application environment secrets were opened or printed. Native replica-set evidence is unavailable; do not substitute application data.
- Source search used the dedicated grep tool. Attempted shell `rg` was unavailable (exit 1); this did not block investigation.

## 2. End-to-end consumer map

### Admission and unrelated modes

1. `app.service.ts:465–502` derives Calendar eligibility from configuration, model capability/pricing, policy, connection status and closing state; `projectCurrent()` freezes that projection. `operations/calendar-assembly.ts:42–123` creates the existing connection authority, execution object and model-port factory. Keep this single composition.
2. `chat-runtime/durable-chat-runtime.ts:1609–1629` admits Calendar only with v2 dependencies, enabled snapshot, native-tool model capability and a current account. Admission failure intentionally leaves ordinary text healthy. `executeTurn` chooses the Calendar branch at `1195` only for **non-internal** turns with an admitted window. It is not keyword-selected: general questions in an eligible deployment also traverse CalendarLoop.
3. `runCalendarTurn():1631–1807` binds the existing ledger, account, graph callbacks, publication, checkpoint boundary and confirmed cache. It creates one CalendarLoop for this turn. `calendar-loop.ts:666–700` currently supplies all five schemas on every initial/correction/continuation model request.
4. Disabled, disconnected/unconfigured, policy-ineligible or model-ineligible deployments use the ordinary text path, `model/openrouter-adapter.ts` -> `model/policy.ts:70`. That body has no tools. Do **not** globally inject the two tools in `providerParameters()` or the ordinary adapter.
5. `voice/agent/agent-voice-adapter.ts:160,290` reuses `submitLiveTurn`/`executeTurn`, but internal live turns deliberately bypass Calendar admission (`durable-chat-runtime.ts:771,995,1195`). Voice uses its delivery accounting and spoken-history projection. Preserve that exclusion; reuse of the runtime is not proof of a voice Calendar execution path. Previously retained schemas should not make tools available to live voice.
6. `model/catalogue.ts` admits model support/pricing, not plugin definitions. `benchmark/report.ts` enumerates the five real Calendar operations for scenario prompts and operation-outcome matching; preserve these canonical execution identities even when native transport names become generic.

### Shared model and streaming boundary

- `contracts/calendar-tools.ts` is the existing authoritative registry: five v2 names, descriptions, JSON input schemas, Zod input/call schemas, result unions, annotations and retry metadata. Plugin ID/revision are `google-calendar` / `google-calendar.v2` in `contracts/calendar-policy.ts`. Do not create copied argument definitions.
- `contracts/calendar-model.ts` restricts native call and result names to Calendar names; assistant groups contain exactly one call. Decisions currently contain only parsed `CalendarCall`, not the original native function name/raw argument JSON. `CalendarDecisionRequest.tools` is typed to `CALENDAR_TOOLS`. Complete groups, diagnostic enums, resumable decision/store facades and v1/v2 compatibility all need coordinated protocol support.
- `model/calendar-policy.ts:47–55,63–72,89–170` estimates input, checks registry byte equality/revision, validates full native history and budgets, and serializes tools. It advertises all parameter schemas with **no `strict: true`**. `parallel_tool_calls: false` is conditional on admitted model parameter support. Provider identity, transforms, deny-data-collection and usage streaming come from existing common policy.
- `model/calendar-adapter.ts` binds that serializer to one charged provider dispatch, emits parsed decision/rejection/usage/failure chunks, hashes registry definitions for diagnostics and uses `CalendarStreamAssembly`. `calendar-stream.ts` merges fragmented names/arguments, requires a valid terminal frame, bounds bytes, and allows one call at index zero; keep these protections.
- `model/calendar-validation.ts:171–262` currently scans JSON then validates **plugin-specific arguments in the adapter**. `model/strict-json.ts` detects duplicate keys, forbidden keys, malformed/non-finite JSON, byte/depth overflow. New native validation should check the stable envelope, not repeat Calendar argument Zod validation before the executor. Preserve the scanner's security and finite bounds; inspect nesting depth for the new `arguments` wrapper.
- `model/calendar-repair.ts:40–84` revalidates every historical call through the current Calendar candidate validator; a prefix is explicitly text-only. This must accept stable native envelopes and retained error/discovery groups, while retaining read compatibility for existing five-name history. Historical validation is structural evidence validation, not permission to execute old/stale calls.
- `contracts/calendar-accounting.ts` already supports initial/continuation/schema-repair/provider-retry dispatch reasons, provider/cached token fields, money evidence and bounded per-turn debits. Discovery must use this accounting, not another model-attempt system.

### Execution, confirmation, recovery and persistence

- `calendar-loop.ts:301–342` shares the existing repair path; ledger reservation increments repairs only for `schema-repair` (`calendar-budget.ts:450–499`). Limits are 8 dispatches, 2 repairs, 6 logical Calendar tools, 1 create, 20 Calendar deliveries and 2 refreshes; arguments/results are each <=16,384 UTF-8 bytes. A successful load must not reset repairs. Do not count schema discovery as a create or Google delivery; keep all model continuations charged.
- `CalendarLoop.decide()` persists a decision **before** execute (`737–765`), detects redundant reads and second creates, validates domain semantics, and checkpoints a pending decision ID. `execute()` retrieves it from the store and dispatches canonical Calendar operations. Keep dispatcher native identity separate from that canonical operation identity; otherwise duplicate suppression, diagnostics and create classification silently break.
- `recordResult():419–451` persists a bounded result/source, then synthesizes a native call/result pair in the in-memory `groups` array. Its current reconstruction uses `JSON.stringify(decision.call.arguments)` and `content:null`, so original raw native arguments/assistant content are not retained. New records must retain the raw accepted envelope/call ID for accurate replay rather than reconstructing `call_tool` as a Calendar-native call.
- `calendar-loop.ts:565–663` handles pending proposal answers before normal model dispatch. Authorized confirmations execute the saved action through `executeAuthorizedProposal`; they must not be forced to activate again, invoke a new router, or regenerate the proposal. The free/busy/create/receipt paths, durable intent/proposal authorization and operation IDs remain the execution authority. Keep the original accepted dispatch envelope available for results of deferred creates (`recordResult`, create result group and authorized-proposal paths are separate group builders).
- `calendar-recovery.ts` classifies publish/reuse-decision/reuse-result/repair-consumption/dispatch-planned/reconcile-operation. Unknown writes use the **original** operation/account/target and readback; no replay permission follows from a schema load. These classifiers are not a general cross-turn schema-history loader. `calendar-publication.ts` and durable runtime publish sealed narration, manifest boundary, accounting and terminal state; retain that order.
- `persistence/calendar-evidence.ts` writes decisions/results into existing **metadata**, with v1/v2 facades, immutable identity keys, account-before/after checks and redaction. Current result API is get-by-call, not list-history. `calendar-records.ts`, `calendar-retention.ts`, `accounting-codec.ts`, `calendar-checkpoints.ts`, indexes and `contracts/calendar-compatibility.ts` are downstream decoders/retention consumers; new record variants cannot be added in just the loop.
- `contracts/calendar-sources.ts` currently requires actual external source provenance and a Calendar result payload for retained results. Local trusted schema metadata and safe pre-execution errors have neither external source nor Google discovery revision. Do **not** invent Google source records, call `registerSource` or refresh discovery for them. Extend the existing metadata result record with a small discriminated local-result variant and retain the source-bearing variant for real Calendar data.
- `plugins/google-calendar/tools.ts`, `tools-validation.ts` and the connection/capability paths are the established authoritative argument/access/delivery boundaries. Reuse them after envelope + loaded-revision checks. Calendar **resource discovery** (`contracts/calendar-discovery.ts`, `readDiscovery`, `ensureFresh`) may refresh Google calendar lists; it is not tool-schema discovery and must not be called by `activate_skill`.

## 3. History, restart and prefix findings

### Actual current behavior

- `context/referenced-context-assembler.ts:108–172` selects manifest message refs in order, checks records, reprojects expiring Calendar narration and live voice delivery, then emits fixed instructions, product background, environment, response mode, visible text history and the accepted input once.
- `contracts/context.ts` allows text-only messages; `agent-memory.ts` references visible message IDs/sequences, not tool groups. `calendar-context.ts` accepts groups only for the current loop; `rebuildCalendarMessages()` refuses native groups in its prefix. A new loop starts with `groups=[]`. Existing metadata evidence is durable, but full native history is **not currently reconstructed across completed turns**.
- `agent/state.ts` checkpoints cursor/seal/references rather than an ever-growing transcript; `contracts/calendar-compatibility.ts` bounds checkpoint refs to 8 decisions/6 calls and pins Calendar revision. Do not use a last-turn checkpoint list as the sole lifetime schema registry or silently grow these per-turn arrays without a bound decision.
- Fixed asset pair and mode content are deterministic. Environment background comes before history and changes with local date/timezone (`context-budget.ts:32–80`); it is not byte-stable across date changes. Keep it for scheduling correctness and record the limitation, rather than promising an invariant total prefix across arbitrary days/configuration changes. For ordinary same-date/same-mode continuation, the catalog and native definitions should remain identical and native groups append in their original positions.

### Smallest viable strategy

1. Keep decision + result evidence in metadata. Persist successful disclosure schemas/revisions/instructions or a compact prior-disclosure acknowledgement as an ordinary matched tool result using the existing result write, with user/session/turn/attempt, decision ID, raw native call ID, event ID and sequence. No new collection, activation transaction, provider call or independent loaded-state table.
2. Load bounded existing records for the selected manifest turns/attempts under the server identity; join decisions to results by stable IDs. Order by visible turn position then result sequence, not timestamps. Only replay the accepted/finalized attempt for completed turns; keep current-attempt groups separate. Existing user/session result identity index is a useful prefix for a scoped bounded query; add an index only if the chosen query actually requires it.
3. Insert complete groups **between the historical user input and its assistant narration**, never collect all disclosures after the newest user input or rewrite the system prefix. Validate each group and preserve its original name, raw arguments, ID and result. Keep original schema disclosures even after a revision changes. An acknowledgement references a retained disclosure; it never establishes loading by itself.
4. Derive the loaded `(plugin, tool, revision)` set from disclosure results actually present in the assembled model messages. Require all of a requested batch to fit before writing the disclosure. Validate current executable registry revision before action; missing/stale reject before executor invocation, append a safe machine-readable tool result and enter the existing shared repair loop. Strictly parsed envelopes rejected by plugin argument validation can likewise have paired safe error results; malformed/forbidden raw output still uses hash + bounded diagnostics, not unrestricted persistence of hostile content.
5. On cache miss, restart or chat reopen rebuild from these same durable records. No client assertion establishes loading. A fresh chat has no loaded set. Missing/corrupt/over-budget history fails explicitly, never silently omits a disclosure while keeping it loaded. Redacted provider payloads retain safe paired placeholders or use the established explicit failure policy; authorization still comes from the executor.
6. Preserve confirmation and unknown-write state unchanged. After a durable disclosure but before a graph checkpoint, idempotently reload its existing result rather than issuing a plugin action. A disclosure is usable only after its write is acknowledged and included in context. A new attempt does not invent successful disclosure evidence from an abandoned incomplete group.

### Confirmed-state cache (`04485ad`)

`chat-runtime/confirmed-state-cache.ts` is a bounded 128-entry, 2 MiB/entry, 16 MiB-total, five-minute process cache of confirmed manifests, checkpoint IDs and immutable message refs. `durable-chat-runtime.ts:490–565` requires executor identity, next lease generation, latest turn, asset hashes, graph schema and pinned checkpoint before using it. Calendar/voice-sensitive messages go into `refreshRefs` rather than permanently cached plain records; Calendar publication at `1756–1803` maintains that split.

Do not bypass this path or introduce an unconditional second manifest/checkpoint fetch for schema history. Local immutable disclosure groups can be reused only as derivable confirmed data linked to records. External source-bearing groups must still be refreshed/reprojected for expiry/disconnect/revocation; do not cache them indefinitely beside loaded revisions. A process-only set is neither restart-safe nor an authority. Compare cached/cold assembled messages and verify a missing disclosure cannot be rescued by a cached loaded flag. Existing cache invalidation on reconcile/cancel/config and account invalidation must still hold.

## 4. Recommended plan contracts and ownership

### P1: shared protocol

- Export deterministic compact catalog projections and exactly two frozen native definitions, separate from the real five-operation registry. Derive revealed parameter schemas from that registry; avoid another manually maintained schema set.
- Distinguish text, `activate_skill` and `call_tool` decisions at the model boundary; retain raw accepted native name/argument string/call ID. Resolve dispatch envelopes to canonical `CalendarCall` only at execution. Do not change the canonical Calendar operation union just to make discovery look like a provider operation.
- Define bounded one/many/all activation selection, disclosed schemas with revisions/instructions, prior-disclosure acknowledgement and safe machine-readable missing/stale/argument-error results. Unknown plugin/tool is distinct from not-loaded. The provider can enforce the wrapper only, not a schema disclosed as result text.
- Extend native message/group and existing decision/result record schemas for local outcomes without false external provenance; retain old record decoders without a parallel legacy production router. Keep accounting operation revisions distinct from a new generic protocol version if a version is necessary.
- Change adapter/stream validation to validate the wrapper and JSON safety; leave plugin-specific argument checks to the existing executor. Extend diagnostics for wrapper paths and schema-not-loaded/stale cases within existing size bounds. History validators must accept recorded error arguments without demanding they were executable plugin inputs.

**Minimal ownership amendment:** add `backend/src/contracts/calendar-compatibility.ts` to P1 for the shared compatibility unions/checkpoint-ref definitions. Existing P1 listed files cover the other essential contracts. P2 already owns persistence/checkpoint wiring and agent state. If a plan elects to widen text-only `contracts/context.ts` or message/manifest contracts, explicitly amend ownership first; a Calendar-specific ordered history overlay can avoid that broad shared change. No frontend change is established as necessary.

### P2: runtime and durable state

Use the existing loop/ledger/result store and authoritative executor. Add local activation and bounded scoped history reconstruction, not another service. Update **every** group builder, duplicate detection, pending decision execute path, create/confirmed-proposal result, recovery decoder, redaction branch and confirmed-state cache consumer. Separate lifetime loaded history from the per-turn logical-operation count. Safe local metadata must not run the external result store's account/OAuth/preflight work just to disclose a schema. Existing real-action authority checks remain.

### P3: assembled evidence

Extend existing assembly fixtures/model body capture and performance checks. Cover enabled generic chat, disabled text, internal voice exclusion, cold one/batch/all loads, warm execution, later-new-tool load, missing/stale corrections, bounded errors, old persisted data, restart, exact pair order, prefix comparison and cache invalidation. Count **model**, **Google**, **OAuth** and extra authorization/preflight work independently. Synthetic metadata catalogs can demonstrate scale without new plugins. Keep task-level size, cumulative context, call count and latency separate; schema retention can increase later total input.

## 5. Executed baseline checks

All package commands below used working directory `D:/Peter/Aurvin Agent/Aurvin/backend`. PowerShell capture pattern was `npm test <arguments> *> '<log>'; $code = $LASTEXITCODE; Get-Content '<log>' -Tail 12; exit $code`. Logs are local, not tracked; final summary output is preserved here.

| Command | Result | Evidence |
| --- | --- | --- |
| `npm test` (first run) | Exit 1 | 14 failed / 268 passed / 2 skipped files; 63 failed / 2499 passed / 10 skipped tests; 85.39 s |
| `npm run build` | Exit 0 | `nest build`; no compile error |
| `npm test -- test/contracts/ test/model/ test/context/ test/assembly/calendar-simplification.built.spec.ts` | Exit 1 | 1 failed / 49 passed files; 1 failed / 573 passed tests; 9.69 s |
| `npm test -- test/contracts/ test/model/ test/context/ test/assembly/calendar-simplification.spec.ts test/assembly/calendar-multi-flow.spec.ts test/performance/confirmed-state-cache.spec.ts` | Exit 0 | 52 passed files; 609 passed tests; 8.11 s |
| `npm test` (post-build, authoritative full baseline) | Exit 1 | 13 failed / 269 passed / 2 skipped files; 60 failed / 2502 passed / 10 skipped tests; 81.44 s |

The first full run overlapped the build and included a missing emitted-module failure, so it is not the authoritative post-build full-suite result. The post-build focused built check instead reaches an existing pagination API failure. The full post-build rerun reproduces 60 failures with no build running; operations bootstrap failures do not persist.

Local logs: `C:/Users/Peter/AppData/Local/Temp/opencode/plugin-skill-baseline-tests.log`, `plugin-skill-baseline-focused.log`, `plugin-skill-baseline-protocol.log`, `plugin-skill-baseline-postbuild.log`.

Confirmed failure trace: `test/runtime/calendar-answer-regressions.spec.ts:45` calls `messages.list(userId,sessionId)` without pagination; `persistence/messages.ts:90,172` forwards undefined query to `pagination.ts:60`, producing `Cannot read properties of undefined (reading 'limit')`. Many runtime/confirmation/recovery/finalization/scripted tests and the built assembly test share this signature. Do not weaken pagination validation to satisfy stale callers. Performance tests also report context overflow and native-command/wave thresholds; the multi-calendar authority suite has a changed-condition clarification assertion failure. These are pre-change failures, not permission to declare the existing behavior fully verified. Owners must classify/correct applicable gates before final completion; research does not change their code.

Post-build failure inventory (paths relative to `backend/test/`): `runtime/finalization-repair.spec.ts` 6; `runtime/calendar-recovery.spec.ts` 3; `runtime/calendar-recovery-unavailable.spec.ts` 1; `plugins/integration/scripted-model.spec.ts` 3; `runtime/calendar-loop.spec.ts` 7; `runtime/calendar-feedback.spec.ts` 3; `runtime/calendar-logical-tools.spec.ts` 2; `runtime/calendar-override-reply.spec.ts` 2; `runtime/calendar-authority.spec.ts` 5; `runtime/calendar-answer-regressions.spec.ts` 9; `integration/plugins/multi-calendar/authority.spec.ts` 1; `performance/durable-latency.spec.ts` 17; `assembly/calendar-simplification.built.spec.ts` 1. Total 60. This inventory is not a diagnosis of every assertion; only the shared pagination trace above was established directly.

The successful assembled simplification test asserts **3 model requests** for invalid `pageToken:null` -> corrected list-calendars -> text, with reasons initial/schema-repair/continuation and all five identical native tools on each. Its pagination case asserts **3 model requests**, **2 logical tools**, **0 repairs**, two result pages (20 + 1 calendars), and **0 Google requests** with fresh retained calendar metadata. These are observed passing deterministic assertions, not live latency or provider-cache evidence.

## 6. Pre-change serialized request shape and size

Existing serialized shape: `{...providerParameters, messages, tools:[{type:'function',function:{name,description,parameters}}, ...five], stream:true, stream_options:{include_usage:true}}`; identity is backend `user`, model is configured; provider has `data_collection:'deny', require_parameters:true`; transforms are disabled and existing OpenRouter plugins disabled. No strict flag is attached. Anthropic configurations also add the existing top-level `cache_control:{type:'ephemeral'}`; this fixture uses `fixture/model` and does not add it.

Native tools JSON: **2774 UTF-8 bytes**; SHA-256 `fbed2721e65f33b5a890d1bd77ee17fb2ccd5a5cae5e5f16b410db87d844f8f8`. Names in current order: list-events, get-event, create-event, list-calendars, check-availability (each prefixed `calendar_`). A minimal existing model fixture (`Rules`, `Read event abcde`) has estimator value **3006**.

The probes below use real checkout assets with fixed environment `Etc/UTC`, `2026-11-04`, `Wednesday`, text mode, `maxOutputTokens:256`. Their four-message fixed prefix JSON is **9680 bytes**, SHA-256 `fffdb37fc8709f79cc2e87b8e29e9ba29a05ce1aac65558ed220fe3df0be14ea`. Each probe is an independent cold request, **not a measured multi-turn task**; follow-up wording alone does not imply retained history was assembled.

| User input | Message JSON bytes | Serialized body bytes | Existing reservation estimate |
| --- | ---: | ---: | ---: |
| `What is 2 + 2?` | 9723 | 12884 | 12743 |
| `Read event abcde` | 9725 | 12886 | 12745 |
| `List my calendars and check availability tomorrow` | 9758 | 12919 | 12778 |
| `Read event abcde again` | 9731 | 12892 | 12751 |
| `Now find events tomorrow` | 9733 | 12894 | 12753 |

All have five messages. The estimate is the existing conservative **byte-based reservation unit**, not a tokenizer count: `64 + utf8(JSON.stringify({messages,tools:nativeTools})) + 32*messages.length`. Do not divide it by four and call it provider usage. Body construction here mirrors the serializer projection; it does not run a paid model request or certify admission under a particular configured context ceiling.

Reproduce from `backend` after `npm run build` using this exact PowerShell here-string command (standard output only):

```powershell
@'
import { CALENDAR_TOOLS } from './dist/contracts/calendar-tools.js';
import { estimateCalendarInput } from './dist/model/calendar-policy.js';
import { providerParameters } from './dist/model/policy.js';
import { loadConfig } from './dist/platform/config/load-config.js';
import { loadFixedAssets } from './dist/instructions/fixed-assets.js';
import { fixedContextMessages, environmentContextMessage, responseModeMessage } from './dist/context/context-budget.js';
import { createHash } from 'node:crypto';
const tools=CALENDAR_TOOLS.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}));
const config=loadConfig({OPENROUTER_API_KEY:'fixture-key',OPENROUTER_MODEL:'fixture/model'});
const assets=await loadFixedAssets({instructions:'src/instructions/system.md',knowledge:'../product_knowledge.md'});
const prefix=[...fixedContextMessages(assets),environmentContextMessage({timeZone:'Etc/UTC',currentDate:'2026-11-04',dayOfWeek:'Wednesday'}),responseModeMessage('text')];
if(prefix.some(m=>typeof m.content!=='string')) throw Error('Invalid prefix');
const bytes=x=>Buffer.byteLength(JSON.stringify(x),'utf8');
console.log(JSON.stringify({nativeToolsBytes:bytes(tools),toolDefinitionSha256:createHash('sha256').update(JSON.stringify(tools)).digest('hex'),strictPresent:tools.some(t=>'strict' in t.function),fixedPrefixBytes:bytes(prefix),prefixSha256:createHash('sha256').update(JSON.stringify(prefix)).digest('hex')}));
for(const content of ['What is 2 + 2?','Read event abcde','List my calendars and check availability tomorrow','Read event abcde again','Now find events tomorrow']) {
 const messages=[...prefix,{role:'user',content}];
 const body={...providerParameters(config,{user:'aurvin-dev-user',maxOutputTokens:256}),messages,tools,stream:true,stream_options:{include_usage:true}};
 console.log(JSON.stringify({input:content,messageCount:messages.length,messagesBytes:bytes(messages),bodyBytes:bytes(body),reservationEstimate:estimateCalendarInput(messages,CALENDAR_TOOLS)}));
}
console.log(JSON.stringify({minimalFixtureEstimate:estimateCalendarInput([{role:'system',content:'Rules'},{role:'user',content:'Read event abcde'}],CALENDAR_TOOLS)}));
'@ | node --input-type=module
```

An initial exploratory probe forgot to await asset loading and omitted asset content; it was discarded. Only the validated awaited output above is baseline evidence.

## 7. Limits and handoff gate

- No design blocker found: the existing loop, registry and metadata can carry v1 discovery without a new subsystem. Cross-turn native-history reconstruction is necessary implementation, not an existing capability to assume.
- Existing full-suite failures block an eventual all-green completion claim; assign stale runtime tests to P2 and assembled/performance tests to P3 under their current ownership. Post-build operations bootstrap passes, so no operations-test ownership expansion is currently necessary. Do not silently expand scope.
- Provider-reported prompt/output/uncached/cached tokens, billing, actual cache hits and live task latency are **unavailable**, not zero. Fixtures verify request counts/shapes; suite duration is not task end-to-end latency. Matched multi-turn task totals and synthetic-catalog scaling remain P3 evidence work.
- Native MongoDB, Azure and external service certification are not established. Routine suite skips are reported separately. No external SDK/provider documentation claims were needed to derive this source-local contract; no provider enforcement or cache guarantee is inferred.
