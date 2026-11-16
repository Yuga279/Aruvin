# P4 OpenRouter Adapter and Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a bounded OpenRouter model adapter that preserves stream outcomes, server attribution, generation-level usage/cost, and reconciliation evidence without duplicating inference or accounting.

**Architecture:** Use the pinned `ChatOpenRouter` request integration behind the unchanged P1 `ModelAdapter`; an adapter-owned fetch/SSE reader preserves information the integration's high-level stream currently discards. Bind one adapter instance to one durable attempt and report accounting through `MetadataRepository`, never concrete persistence classes. P5 owns acceptance, attempt lifecycle, checkpoints, durable finalization, and application completion; provider `end` is only a successfully validated provider stream.

**Tech Stack:** NestJS/TypeScript ESM, Node 24.18+, Vitest 4, `@langchain/openrouter@^0.4.17`, `@langchain/core@^1.2.16`, existing Zod contracts, native fetch/Web Streams. Keep `mongodb@^6.21.0`; P4 does not add a driver, SDK, package, script, or database connection.

---

## Authority, prerequisites, and ownership

- Planning authorization is the latest explicit assignment and approval recorded in `state.md` (§ milestones: approval on 2026-10-06). Older awaiting-approval prose in root instructions/goal is stale; do not change it in P4.
- Worker prerequisites: committed P1 worker `d899e93..db763b6`, this committed plan, orchestrator dispatch. P2/P3 implementation is not a prerequisite: use typed fakes. No live request is authorized by this plan.
- Worker may create/modify **only** `backend/src/model/**`, `backend/test/fixtures/openrouter/**`, `backend/test/model/**`. This planner changes only `docs/aurvin-phase-1/plan4.md`.
- Do not edit `backend/src/contracts/**`, `backend/src/platform/**`, persistence, context, runtime, HTTP, operations, entry points, manifests, `.env`, or state. Contract/config/dependency changes require serialized P1 follow-up through the orchestrator.
- Every implementation `.ts` file needs the root-mandated descriptive header before its first write. Headers are deliberately omitted from this document's code blocks. Backend imports use `.js` suffixes.
- Execute strict red/green steps. Commit only named task paths, with the orchestrator's shared-index scheduling permission. Review is **skipped**, not passed; tests/defect correction remain required.

## Locked P1 contracts and handoff semantics

Read interfaces in `backend/src/contracts/runtime.ts`, `repositories.ts`, `context.ts`, `identity.ts`, `metadata.ts`, `attempt.ts`, and existing platform config/error definitions. Do not replace them.

| Boundary | P4 use |
| --- | --- |
| `ModelAdapter.stream(ModelInvokeRequest): AsyncIterable<ModelChunk>` | Implement exactly. Request has modelId, user, ordered text messages, maxOutputTokens, abortSignal, transforms, dataCollection. |
| `ModelChunk` | Emit comment, generation-id, delta, usage, length, end only as described below. Never emit application completion. |
| Failure channel | Throw sanitized `AppError` with existing code/retryable fields. Do **not** also emit an error chunk and then throw. The union's error member remains valid for other adapters; P5 handles both channels. |
| `MetadataRepository.putAccounting(AccountingRecord)` | Absolute snapshot/upsert, not increment. Scope is supplied from accepted attempt, never inferred from browser data or provider body. |
| `AccountingRecord` | Same schema/version/fields. No added billing fields, reasoning, prompt, or completion content. |
| `AurvinConfig` / `BudgetConfig` | Consume P1 configuration. No P4 environment parser or client model overrides. |
| Early generation identity | Await `onGenerationId(id)` supplied by P5 before yielding generation-id/any text; P5 saves the ID to its attempt record using P1 ports. |
| Missing accounting | ID + incomplete usage → pending; no ID → unknown; all three prompt/completion/cost numbers valid → known. True reported zero is known; absence is never zero. |
| Terminal provider proof | Require finish_reason stop/length, then `[DONE]`. Usage-only frames between finish and DONE are consumed. EOF without both is interrupted even after visible text. |
| Length | Emit length, finish accounting, then provider end; P5 finalizes an incomplete `truncated` outcome, not ordinary completed. |
| Cancellation | External abort → CANCELLED; deadline → TIMEOUT; iterator return → stop upstream in finally. HTTP client disconnect policy belongs to P5/P6. |
| Retry | Only definitive pre-stream HTTP 429/503 rejection without generation ID and with valid error envelope may auto-retry. Network/abort/timeout/HTTP-200/malformed/partial/ambiguous outcomes never automatically repeat inference. P5 explicit retry creates a new attempt. |

`AppError.retryable` never authorizes replay of a model call or a browser resubmission. P5 decides explicit retry eligibility from the durable attempt/graph result (including interrupted/timeouts whose errors carry retryable=false); explicit retry creates a new attempt linked to the same accepted input. P4's automatic rejection retry predicate is narrower than the shared error taxonomy.

P1 intentionally does not put scope IDs or reported model/provider fields on `ModelInvokeRequest`/`ModelChunk`. P4 therefore exposes a **local factory**, not a redefined shared interface: `createAttemptAdapter(seed, onGenerationId)` binds scope/times and returns an unchanged `ModelAdapter` with a local readonly `accounting` helper. It also exposes `AccountingService.reconcile(record, signal)`; caller supplies its durable record or reconstructs it from a saved attempt/graph result. `adapter.accounting.snapshot(userId, sessionId, attemptId)` returns the last successfully saved local snapshot to the owning P5 task, or null, without adding a shared repository API. Each attempt has its own service instance; retain its snapshot only for the active attempt and saved graph result, not a global growing cache. P1 has no accounting get/list port: P4 must not invent a repository scanner. P5/P8 request a P1/P2 follow-up if their recovery design needs a global sweep; this is not a blocker to P4's record-driven reconciliation.

## Version-specific findings and primary sources (2026-10-06)

- Installed `@langchain/openrouter` is **0.4.17**. Its public `invocationParams({})` includes constructor `user`, `model`, `max_tokens`, `provider`, `transforms`, `plugins`. Contract-test the actual outgoing JSON, not merely a constructor field.
- Inspected `dist/chat_models/index.js:331-371`: high-level streaming skips frames with no `choices[0].delta` (including usage-only envelopes), discards comments and top-level stream errors, and treats EOF as iterator completion. `dist/utils/stream.js` skips malformed JSON and `[DONE]`. `usage_metadata` conversion loses cost. Do not aggregate LangChain chunks to derive absolute billing.
- Resolution: use `ChatOpenRouter.invocationParams` for request integration and native injected fetch for the raw response, not private package imports, global fetch monkey-patches, or a second concurrent model request. This is an intentional narrow transport bypass, not a claim that upstream streaming works unmodified. Re-run tests on dependency upgrades; stop if the public request API changes.
- Current provider documentation specifies `plugins: [{id:'context-compression', enabled:false}]` to disable default compression. Send this **and** explicit `transforms: []`; the legacy empty transform array alone is insufficient evidence. Disable web/file-parser/response-healing defaults too; confirm the OpenRouter key/account permits request-level overrides. Phase 1 refuses configuration allowing transforms.
- `provider.data_collection:'deny'` is the default; `allow` is an explicit server policy and must match the bound config. This routing filter is not a guarantee of uniform retention or ZDR. P8 documents account logging/retention/access policy.
- Generation lookup: GET `/api/v1/generation?id=...`; use `data.total_cost`, `native_tokens_prompt`, `native_tokens_completion`, `model`, `provider_name`. Do not add `upstream_inference_cost` (BYOK-only) or fall back silently to differently tokenized `tokens_prompt`/`tokens_completion`.
- Pinned integration emits `max_tokens` (accepted legacy parameter). No blind migration to `max_completion_tokens`; validate the configured endpoint supports the outgoing cap before live rollout.

Sources: [LangChain JS OpenRouter](https://docs.langchain.com/oss/javascript/integrations/chat/openrouter), [OpenRouter streaming](https://openrouter.ai/docs/api_reference/streaming), [usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [generation lookup](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation), [provider selection](https://openrouter.ai/docs/guides/routing/provider-selection), [message transforms](https://openrouter.ai/docs/guides/features/message-transforms), [plugins](https://openrouter.ai/docs/guides/features/plugins).

## File map (all implementation paths P4-owned)

| File | Responsibility |
| --- | --- |
| `backend/src/model/policy.ts` | Bound config/capabilities, defensive request checks, request serialization through ChatOpenRouter |
| `backend/src/model/faults.ts` | Sanitized error classification; definitive rejection retry eligibility |
| `backend/src/model/deadlines.ts` | Linked abort/deadline controller, abortable backoff, bounded body read |
| `backend/src/model/sse.ts` | Bounded incremental UTF-8/SSE framing (comments, multiline data, arbitrary packet splits) |
| `backend/src/model/accounting.ts` | Normalize/merge absolute accounting; bounded record-driven generation lookup |
| `backend/src/model/openrouter-adapter.ts` | One-shot attempt adapter, finite dispatch retries, raw stream state machine |
| `backend/src/model/catalogue.ts` | Non-inference selected model capability lookup, called by assembly/readiness rather than stream |
| `backend/src/model/index.ts` | Public factory/export boundary for P5/P8/P9/P10 |
| `backend/src/model/README.md` | Exact capabilities/limits, ownership handoff, live-check procedure |
| `backend/test/fixtures/openrouter/frames.ts` | Deterministic raw SSE and generation responses; no live data |
| `backend/test/model/helpers.ts` | Fake requests/accounting sink/fetch and arbitrary UTF-8 segmentation |
| `backend/test/model/policy.spec.ts` | Wire body/budget/override assertions |
| `backend/test/model/sse.spec.ts` | Packet segmentation, syntax, malformed/oversized boundaries |
| `backend/test/model/faults.spec.ts` | HTTP/error taxonomy/retry matrix |
| `backend/test/model/deadlines.spec.ts` | Connect/first-output/idle/total/backoff abort tests |
| `backend/test/model/accounting.spec.ts` | Null/zero/no-double-sum and reconciliation |
| `backend/test/model/adapter.spec.ts` | Full provider outcomes, outgoing request, persistence hooks, cancellation/retry |
| `backend/test/model/catalogue.spec.ts` | Model availability/context/output/privacy readiness evidence |

## Finite policy (defaults are limits, not measured SLOs)

Use `config.budgets`, never duplicate default configuration. Current defaults: max input 32,000 chars / 8,192 estimated tokens; 80 messages; 16,384 context; 2,048 output; 1,024 margin; 65,536 bytes/message; 2 dispatch attempts (hard config maximum 3); base delay 500 ms; delay cap 5,000 ms; connect 10 s; first output 30 s; idle 20 s; total 180 s; persistence 15 s. Total includes retry delay and awaited accounting/ID hooks. P8 enforces 8 concurrent generations/process and 20 requests/min/user; P4 does not create a second admission limiter.

Additional fixed transport bounds: SSE physical line/event ≤ 65,536 UTF-8 bytes; raw response ≤ 1,048,576 bytes and 10,000 emitted frame items; error/lookup JSON ≤ 65,536 bytes; models catalogue ≤ 4,194,304 bytes; visible output ≤ min(32,000 characters, maxMessageBytes); generation/model/provider identifiers ≤ 200 chars; no more than one generation ID per attempt. Budget overruns fail before yielding the violating text/frame. Reasoning fields are ignored, not forwarded or persisted. Failure cleanup has one separate persistence budget (15 s default), so total execution including failure cleanup is at most totalRunTimeoutMs + persistenceTimeoutMs; this does not extend or restart inference.

Model catalogue must report context ≥ configured context and native completion cap ≥ configured output, and support `max_tokens`. No model has been selected or certified yet. Fail model readiness if the model is missing, caps are absent/too small, or privacy/compression policy is not admissible. P4 deterministic implementation is ready; live/model validation remains P10-gated.

Adapter defense estimates context as UTF-8 byte count + 32 tokens/message + 64 envelope tokens, reserving configured output+margin. This intentionally conservative bound avoids a new tokenizer dependency; it is **not exact model token accounting**. P3 owns context assembly/token estimates and must use an equally safe or stricter admission policy. Validate this bound against the selected tokenizer/native usage in P10; byte estimates cannot universally prove every model tokenizer/template. If unsafe, request a P1/P3 coordinated model-specific tokenizer change and block rollout, never discard history or compress. Latest user-input byte count is a defensive estimate for maxInputTokens, not a fabricated provider count.

---

### Task 1: Policy and the actual ChatOpenRouter outgoing body

**Create:** `backend/src/model/policy.ts`, `backend/test/model/policy.spec.ts`.

- [ ] **Step 1 — Write the failing test.**

```typescript
// backend/test/model/policy.spec.ts
import { loadConfig } from '../../src/platform/config/load-config.js';
import { buildBody, assertRequest, type ModelLimits } from '../../src/model/policy.js';
import type { ModelInvokeRequest } from '../../src/contracts/runtime.js';

const config = loadConfig({ OPENROUTER_API_KEY: 'fixture-key', OPENROUTER_MODEL: 'fixture/model' });
const limits: ModelLimits = { modelId: 'fixture/model', contextTokens: 32768, outputTokens: 4096, supportsMaxTokens: true, source: 'fixture' };
const request = (): ModelInvokeRequest => ({ modelId: config.openRouter.modelId, user: config.identity.userId, messages: [{role:'system',content:'Rules'}, {role:'user',content:'Hello'}], maxOutputTokens: 2048, abortSignal: new AbortController().signal, transforms: [], dataCollection:'deny' });

it('serializes user/model/caps/privacy and explicit compression disable', () => {
  const body = JSON.parse(JSON.stringify(buildBody(config, limits, request())));
  expect(body).toMatchObject({model:'fixture/model',user:'aurvin-dev-user',max_tokens:2048,stream:true,stream_options:{include_usage:true},transforms:[],provider:{data_collection:'deny',require_parameters:true}});
  expect(body.plugins).toContainEqual({id:'context-compression',enabled:false});
  expect(body.messages).toEqual(request().messages);
  for (const field of ['models','route','tools','tool_choice','apiKey','reasoning']) expect(body[field]).toBeUndefined();
});
it('uses allow only when explicitly configured on the server',()=>{
  const allowed={...config,openRouter:{...config.openRouter,dataCollection:'allow' as const}};
  expect(buildBody(allowed,limits,{...request(),dataCollection:'allow'}).provider).toMatchObject({data_collection:'allow'});
});
it.each([
  {modelId:'other/model'}, {user:'browser-user'}, {transforms:['middle-out']}, {dataCollection:'allow'}, {maxOutputTokens:2049}, {maxOutputTokens:Infinity},
])('rejects internal policy mismatch before dispatch: %j', change => {
  expect(() => assertRequest(config,limits,{...request(),...change} as ModelInvokeRequest)).toThrow();
});
it('rejects absent/undersized model capabilities and enabled transforms', () => {
  expect(() => buildBody(config,{...limits,contextTokens:8192},request())).toThrow();
  expect(() => buildBody(config,{...limits,outputTokens:1024},request())).toThrow();
  expect(() => buildBody(config,{...limits,supportsMaxTokens:false},request())).toThrow();
  expect(() => buildBody({...config,openRouter:{...config.openRouter,disableTransforms:false}},limits,request())).toThrow();
});
it('fails overflow rather than removing context', () => {
  const r = {...request(),messages:[{role:'user' as const,content:'x'.repeat(9000)}]};
  expect(() => assertRequest(config,limits,r)).toThrow();
  expect(r.messages[0].content).toHaveLength(9000);
  expect(() => assertRequest(config,limits,{...request(),messages:Array.from({length:81},() => ({role:'user' as const,content:'x'}))})).toThrow();
});
```

- [ ] **Step 2 — Run red:** from `backend`, `npx vitest run test/model/policy.spec.ts`. Expected missing `policy.js`, not a passing skipped test.
- [ ] **Step 3 — Create the complete policy implementation.**

```typescript
// backend/src/model/policy.ts
import { ChatOpenRouter } from '@langchain/openrouter';
import type { AurvinConfig } from '../platform/config/load-config.js';
import { AppError } from '../platform/errors/app-error.js';
import type { ModelInvokeRequest } from '../contracts/runtime.js';

export type ModelLimits = { modelId:string; contextTokens:number; outputTokens:number; supportsMaxTokens:boolean; source:'fixture'|'catalogue' };
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
export const TRANSPORT_LIMITS = { frameBytes:65536, streamBytes:1048576, frames:10000, jsonBytes:65536, catalogueBytes:4194304, outputChars:32000 } as const;

export function assertRequest(c:AurvinConfig,l:ModelLimits,r:ModelInvokeRequest):void {
  const configError = () => { throw new AppError('CONFIGURATION_ERROR','The model configuration is unavailable.',false); };
  if (!c.openRouter.apiKey || !c.openRouter.modelId || c.openRouter.modelId.length>200 || !c.openRouter.disableTransforms || l.modelId!==c.openRouter.modelId || !Number.isSafeInteger(l.contextTokens) || !Number.isSafeInteger(l.outputTokens) || l.contextTokens<c.budgets.maxContextTokens || l.outputTokens<c.budgets.maxOutputTokens || !l.supportsMaxTokens) configError();
  if (r.modelId!==c.openRouter.modelId || r.user!==c.identity.userId || !r.user || r.user.length>128 || r.dataCollection!==c.openRouter.dataCollection || r.transforms.length!==0) configError();
  if (!Number.isSafeInteger(r.maxOutputTokens) || r.maxOutputTokens<=0 || r.maxOutputTokens>c.budgets.maxOutputTokens) throw new AppError('INVALID_REQUEST','The output limit is invalid.',false);
  if (!r.messages.length || r.messages.length>c.budgets.maxMessagesInContext) throw new AppError('CONTEXT_BUDGET_EXCEEDED','This chat is too long. Start a new chat.',false);
  let estimated=64;
  for (const m of r.messages) {
    if (!['system','user','assistant'].includes(m.role) || typeof m.content!=='string') throw new AppError('INVALID_REQUEST','The chat input is invalid.',false);
    const bytes=Buffer.byteLength(m.content,'utf8');
    if (bytes>c.budgets.maxMessageBytes) throw new AppError('INPUT_TOO_LARGE','A chat message is too large.',false);
    estimated+=bytes+32;
  }
  const last=[...r.messages].reverse().find(m=>m.role==='user');
  if (!last || last.content.length>c.budgets.maxInputChars || Buffer.byteLength(last.content,'utf8')>c.budgets.maxInputTokens) throw new AppError('INPUT_TOO_LARGE','The chat input is too large.',false);
  if (estimated+r.maxOutputTokens+c.budgets.modelMarginTokens>c.budgets.maxContextTokens) throw new AppError('CONTEXT_BUDGET_EXCEEDED','This chat is too long. Start a new chat.',false);
}

export function buildBody(c:AurvinConfig,l:ModelLimits,r:ModelInvokeRequest):Record<string,unknown> {
  assertRequest(c,l,r);
  const plugins=['context-compression','web','file-parser','response-healing'].map(id=>({id,enabled:false}));
  const model=new ChatOpenRouter({apiKey:c.openRouter.apiKey,model:c.openRouter.modelId,user:r.user,maxTokens:r.maxOutputTokens,maxRetries:0,streamUsage:true,transforms:[],provider:{data_collection:c.openRouter.dataCollection,require_parameters:true},plugins,siteName:'Aurvin',siteUrl:''});
  // Do not inherit global session grouping/tracing environment settings.
  model.sessionId=undefined;
  model.trace=undefined;
  return {...model.invocationParams({}),messages:r.messages.map(m=>({role:m.role,content:m.content})),stream:true,stream_options:{include_usage:true}};
}
```

- [ ] **Step 4 — Run green:** `npx vitest run test/model/policy.spec.ts`; expected all assertions pass. `npm run build` must accept the public `invocationParams`/provider/plugin types. If not, stop for upstream contract reconciliation; no `any` patch around private APIs.
- [ ] **Step 5 — Commit (repo root):**

```powershell
git add backend/src/model/policy.ts backend/test/model/policy.spec.ts
git commit -m "feat(p4): bind OpenRouter request identity and finite model policy"
```

### Task 2: Deterministic frames and bounded SSE framing

**Create:** `backend/test/fixtures/openrouter/frames.ts`, `backend/test/model/helpers.ts`, `backend/src/model/sse.ts`, `backend/test/model/sse.spec.ts`.

- [ ] **Step 1 — Write fixture/helper and failing parser tests.**

```typescript
// backend/test/fixtures/openrouter/frames.ts
const event=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
export const chunk=(content:string,finish_reason:string|null=null)=>event({id:'gen_fixture',model:'fixture/model',provider:'Fixture',choices:[{index:0,delta:{content},finish_reason}]});
export const usage=event({id:'gen_fixture',choices:[],usage:{prompt_tokens:12,completion_tokens:3,total_tokens:15,cost:0.00002}});
export const done='data: [DONE]\n\n';
export const FRAMES={
  normal:': OPENROUTER PROCESSING\n\n'+chunk('Hello 🌍')+chunk('','stop')+usage+done,
  length:chunk('Partial')+chunk('','length')+usage+done,
  noUsage:chunk('Hello')+chunk('','stop')+done,
  duplicateUsage:chunk('Hello')+chunk('','stop')+usage+usage+done,
  errorBefore:event({id:'gen_fixture',error:{code:402,message:'private provider detail'}})+done,
  errorAfter:chunk('Partial')+event({id:'gen_fixture',choices:[{index:0,delta:{},finish_reason:'error'}],error:{code:502,message:'private provider detail'}})+done,
  errorUsage:chunk('Partial')+event({id:'gen_fixture',error:{code:502,message:'private provider detail'},usage:{prompt_tokens:12,completion_tokens:3,cost:0.00002}})+done,
  eof:chunk('Partial'),
  finishEof:chunk('Hello')+chunk('','stop')+usage,
  onlyDone:done,
  malformed:'data: {broken}\n\n'+done,
  reasoning: event({id:'gen_fixture',choices:[{index:0,delta:{reasoning:'private',content:'Visible'},finish_reason:null}]})+chunk('','stop')+done,
  differentId:chunk('A')+event({id:'gen_other',choices:[{index:0,delta:{content:'B'},finish_reason:'stop'}]})+done,
  contentFilter:chunk('')+chunk('','content_filter')+done,
  tools: event({id:'gen_fixture',choices:[{index:0,delta:{tool_calls:[{id:'call_1'}]},finish_reason:'tool_calls'}]})+done,
};
export const GENERATION={data:{id:'gen_fixture',model:'fixture/model',provider_name:'Fixture',native_tokens_prompt:12,native_tokens_completion:3,total_cost:0.00002,tokens_prompt:99,tokens_completion:99,upstream_inference_cost:7}};
```

```typescript
// backend/test/model/helpers.ts
import { loadConfig } from '../../src/platform/config/load-config.js';
import type { ModelInvokeRequest } from '../../src/contracts/runtime.js';
import type { AccountingRecord } from '../../src/contracts/metadata.js';
import type { ModelLimits } from '../../src/model/policy.js';

export const config=()=>loadConfig({OPENROUTER_API_KEY:'fixture-key',OPENROUTER_MODEL:'fixture/model'});
export const limits:ModelLimits={modelId:'fixture/model',contextTokens:32768,outputTokens:4096,supportsMaxTokens:true,source:'fixture'};
export const request=(signal=new AbortController().signal):ModelInvokeRequest=>({modelId:'fixture/model',user:'aurvin-dev-user',messages:[{role:'system',content:'Rules'},{role:'user',content:'Hello'}],maxOutputTokens:2048,abortSignal:signal,transforms:[],dataCollection:'deny'});
export const seed=():AccountingRecord=>({schemaVersion:1,kind:'accounting',userId:'aurvin-dev-user',sessionId:'sess_fixture',turnId:'turn_fixture',attemptId:'att_fixture',generationId:null,requestedModel:'fixture/model',reportedModel:null,reportedProvider:null,promptTokens:null,completionTokens:null,cost:null,accountingStatus:'unknown',outcome:'generating',startedAt:'2026-10-06T00:00:00.000Z',endedAt:null});
export function bytes(text:string,width=1):ReadableStream<Uint8Array> {
  const data=new TextEncoder().encode(text);
  return new ReadableStream({start(c){for(let i=0;i<data.length;i+=width)c.enqueue(data.slice(i,i+width));c.close();}});
}
export const response=(text:string,width=1)=>new Response(bytes(text,width),{status:200,headers:{'content-type':'text/event-stream'}});
export async function collect<T>(items:AsyncIterable<T>):Promise<T[]> { const out:T[]=[]; for await(const item of items)out.push(item); return out; }
export const sink=()=>({putAccounting:vi.fn<(r:AccountingRecord)=>Promise<void>>().mockResolvedValue(undefined)});
```

```typescript
// backend/test/model/sse.spec.ts
import { parseSse } from '../../src/model/sse.js';
import { bytes, collect } from './helpers.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';

it.each([1,2,7,65536])('preserves UTF-8 and framing across %i-byte packets',async width=>{
  const frames=await collect(parseSse(bytes(FRAMES.normal,width)));
  expect(frames[0]).toEqual({type:'comment',text:'OPENROUTER PROCESSING'});
  expect(frames.some(f=>f.type==='data'&&f.data.includes('Hello 🌍'))).toBe(true);
  expect(frames.at(-1)).toEqual({type:'data',data:'[DONE]'});
});
it('accepts CRLF, multiline data and ignores non-data SSE fields',async()=>{
  expect(await collect(parseSse(bytes(': hi\r\nid: x\r\nevent: message\r\ndata: {\r\ndata: "ok":true}\r\n\r\n')))).toEqual([{type:'comment',text:'hi'},{type:'data',data:'{\n"ok":true}'}]);
});
it('accepts SSE lone CR delimiters without requiring LF',async()=>{
  expect(await collect(parseSse(bytes(':hi\r\rdata:[DONE]\r\r',1)))).toEqual([{type:'comment',text:'hi'},{type:'data',data:'[DONE]'}]);
});
it('rejects oversized unfinished lines/events and invalid UTF-8',async()=>{
  await expect(collect(parseSse(bytes('data: '+'x'.repeat(65537))))).rejects.toMatchObject({code:'PROVIDER_ERROR',retryable:false});
  await expect(collect(parseSse(new ReadableStream({start(c){c.enqueue(new Uint8Array([255]));c.close();}})))).rejects.toThrow();
});
it('does not invent a complete event from trailing unterminated data',async()=>{
  await expect(collect(parseSse(bytes('data: {"ok":true}')))).rejects.toMatchObject({code:'INTERRUPTED'});
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/model/sse.spec.ts`; expected missing `sse.js`.
- [ ] **Step 3 — Implement the complete parser.** Parsing JSON belongs to Task 6, not this framing layer.

```typescript
// backend/src/model/sse.ts
import { AppError } from '../platform/errors/app-error.js';
import { TRANSPORT_LIMITS as L } from './policy.js';
export type SseItem={type:'comment';text:string}|{type:'data';data:string};
const protocol=()=>new AppError('PROVIDER_ERROR','The response stream was invalid.',false);

export async function* parseSse(stream:ReadableStream<Uint8Array>):AsyncGenerator<SseItem> {
  const reader=stream.getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let pending='',data:string[]=[],eventBytes=0,total=0,count=0,closed=false;
  function line(text:string):SseItem|undefined {
    if(Buffer.byteLength(text,'utf8')>L.frameBytes)throw protocol();
    if(text==='') { if(!data.length)return; const item:SseItem={type:'data',data:data.join('\n')};data=[];eventBytes=0;return item; }
    if(text.startsWith(':'))return {type:'comment',text:text.slice(1).trimStart()};
    const colon=text.indexOf(':');
    const field=colon<0?text:text.slice(0,colon);
    let value=colon<0?'':text.slice(colon+1);if(value.startsWith(' '))value=value.slice(1);
    if(field==='data'){eventBytes+=Buffer.byteLength(value,'utf8')+1;if(eventBytes>L.frameBytes)throw protocol();data.push(value);}
  }
  try {
    while(true){
      const next=await reader.read();
      if(next.done){closed=true;try{pending+=decoder.decode();}catch{throw protocol();}}
      else{total+=next.value.byteLength;if(total>L.streamBytes)throw protocol();try{pending+=decoder.decode(next.value,{stream:true});}catch{throw protocol();}}
      let end:number;
      while((end=pending.search(/[\r\n]/))>=0){
        if(pending[end]==='\r'&&end===pending.length-1&&!next.done)break;
        const width=pending[end]==='\r'&&pending[end+1]==='\n'?2:1;
        const text=pending.slice(0,end);pending=pending.slice(end+width);
        const item=line(text);if(item){if(++count>L.frames)throw protocol();yield item;}
      }
      if(Buffer.byteLength(pending.replace(/\r$/,''),'utf8')>L.frameBytes)throw protocol();
      if(next.done)break;
    }
    if(pending || data.length)throw new AppError('INTERRUPTED','The response stream ended early.',false);
  } finally {
    if(!closed)await reader.cancel().catch(()=>undefined);
    reader.releaseLock();
  }
}
```

- [ ] **Step 4 — Add these boundary tests, then run green:** `npx vitest run test/model/sse.spec.ts`. Expected all assertions pass without live networking.

```typescript
it('admits exactly bounded event bytes and rejects aggregate multiline overflow',async()=>{
  const half='x'.repeat(32767),data=`${half}\n${half}`;
  expect((await collect(parseSse(bytes(`data:${half}\ndata:${half}\n\n`,7)))).at(-1)).toEqual({type:'data',data});
  await expect(collect(parseSse(bytes(`data:${'a'.repeat(40000)}\ndata:${'b'.repeat(40000)}\n\n`)))).rejects.toMatchObject({code:'PROVIDER_ERROR'});
});
it('bounds item count even for tiny comments',async()=>{
  await expect(collect(parseSse(bytes(':hi\n'.repeat(10001),4096)))).rejects.toMatchObject({code:'PROVIDER_ERROR'});
});
it('bounds total bytes even when individual frames are small',async()=>{
  await expect(collect(parseSse(bytes(('ignored:'+ 'x'.repeat(1000)+'\n').repeat(1100),4096)))).rejects.toMatchObject({code:'PROVIDER_ERROR'});
});
it('comments are not JSON and CRLF segmentation is harmless',async()=>{
  expect(await collect(parseSse(bytes(': {not json}\r\n\r\ndata:[DONE]\r\n\r\n',1)))).toEqual([{type:'comment',text:'{not json}'},{type:'data',data:'[DONE]'}]);
});
```
- [ ] **Step 5 — Commit:**

```powershell
git add backend/src/model/sse.ts backend/test/fixtures/openrouter/frames.ts backend/test/model/helpers.ts backend/test/model/sse.spec.ts
git commit -m "feat(p4): preserve bounded raw SSE frames and provider fixtures"
```

### Task 3: Sanitized classification and definitive-rejection retry policy

**Create:** `backend/src/model/faults.ts`, `backend/test/model/faults.spec.ts`.

- [ ] **Step 1 — Write failing tests.**

```typescript
// backend/test/model/faults.spec.ts
import { providerFault, mayRetryRejection, retryDelay } from '../../src/model/faults.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';

it.each([[400,'INVALID_REQUEST'],[401,'PROVIDER_AUTH'],[403,'PROVIDER_AUTH'],[402,'PROVIDER_CREDITS'],[413,'CONTEXT_BUDGET_EXCEEDED'],[429,'RATE_LIMITED'],[500,'PROVIDER_ERROR'],[502,'PROVIDER_ERROR'],[503,'PROVIDER_ERROR']])('maps %i without leaking payload', (status,code)=>{
  const error=providerFault(status);
  expect(error.code).toBe(code);
  expect(error.message).not.toMatch(/private|fixture-key|stack|metadata|Mongo/i);
});
it('recognizes structured context errors and does not classify by private prose',()=>{
  expect(providerFault(400,'context_length_exceeded').code).toBe('CONTEXT_BUDGET_EXCEEDED');
  expect(providerFault(400,'invalid_api_key').code).toBe('PROVIDER_AUTH');
  expect(providerFault(200,'server_error').code).toBe('PROVIDER_ERROR');
});
it('retries only definitive rejection before generation or visible output',()=>{
  expect(mayRetryRejection(429,{error:{code:429}},false,false)).toBe(true);
  expect(mayRetryRejection(503,{error:{code:503}},false,false)).toBe(true);
  for(const status of [200,400,401,402,403,413,500,502,504])expect(mayRetryRejection(status,{error:{code:status}},false,false)).toBe(false);
  expect(mayRetryRejection(503,{error:{code:503}},true,false)).toBe(false);
  expect(mayRetryRejection(429,{error:{code:429}},false,true)).toBe(false);
  expect(mayRetryRejection(503,{},false,false)).toBe(false);
});
it('uses capped full jitter and refuses excessive Retry-After',()=>{
  expect(retryDelay(DEFAULT_BUDGETS,1,0.5,null)).toBe(250);
  expect(retryDelay(DEFAULT_BUDGETS,2,1,null)).toBe(1000);
  expect(retryDelay(DEFAULT_BUDGETS,1,0.5,'2')).toBe(2000);
  expect(retryDelay(DEFAULT_BUDGETS,1,0.5,'3600')).toBeNull();
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/model/faults.spec.ts`; expected missing `faults.js`.
- [ ] **Step 3 — Create classifier and bounded jitter.**

```typescript
// backend/src/model/faults.ts
import type { BudgetConfig } from '../contracts/budgets.js';
import { AppError } from '../platform/errors/app-error.js';
export function object(value:unknown):Record<string,unknown> {return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
export function providerFault(status:number,code?:unknown):AppError {
  if(typeof code==='string'&&/^\d{3}$/.test(code))code=Number(code);
  if(status===401||status===403||code===401||code===403||code==='invalid_api_key')return new AppError('PROVIDER_AUTH','The model service credentials are unavailable.',false);
  if(status===402||code===402||code==='insufficient_credits')return new AppError('PROVIDER_CREDITS','The model service has insufficient credits.',false);
  if(status===413||code===413||code==='context_length_exceeded')return new AppError('CONTEXT_BUDGET_EXCEEDED','This chat is too long. Start a new chat.',false);
  if(status===400||status===422||code===400)return new AppError('INVALID_REQUEST','The model service rejected the input.',false);
  if(status===429||code===429||code==='rate_limit_exceeded')return new AppError('RATE_LIMITED','The model service is busy. Try again later.',true);
  return new AppError('PROVIDER_ERROR','The model service could not answer. Try again.',true);
}
export function mayRetryRejection(status:number,body:unknown,hasId:boolean,hasText:boolean):boolean {
  const top=object(body),error=object(top.error);
  return (status===429||status===503)&&!hasId&&!hasText&&!top.id&&error.code===status;
}
export function retryDelay(b:BudgetConfig,number:number,random:number,header:string|null,now=Date.now()):number|null {
  const jitter=Math.floor(Math.max(0,Math.min(1,random))*Math.min(b.retryMaxDelayMs,b.retryBaseDelayMs*2**(number-1)));
  if(!header)return jitter;
  const numeric=Number(header);
  const requested=/^\d+(\.\d+)?$/.test(header)?numeric*1000:Date.parse(header)-now;
  if(!Number.isFinite(requested)||requested<0)return jitter;
  if(requested>b.retryMaxDelayMs)return null;
  return Math.max(jitter,Math.ceil(requested));
}
```

- [ ] **Step 4 — Add these regressions, then run green:** `npx vitest run test/model/faults.spec.ts`; expected sanitized classification and deterministic retry bounds pass.

```typescript
it('maps auth codes even inside HTTP-200 errors',()=>{
  expect(providerFault(200,401).code).toBe('PROVIDER_AUTH');expect(providerFault(200,403).code).toBe('PROVIDER_AUTH');
});
it('caps exponential delay and parses HTTP-date Retry-After deterministically',()=>{
  expect(retryDelay(DEFAULT_BUDGETS,99,1,null)).toBe(5000);
  expect(retryDelay(DEFAULT_BUDGETS,1,0,'Tue, 06 Oct 2026 00:00:02 GMT',Date.parse('2026-10-06T00:00:00Z'))).toBe(2000);
});
```
- [ ] **Step 5 — Commit:**

```powershell
git add backend/src/model/faults.ts backend/test/model/faults.spec.ts
git commit -m "feat(p4): classify provider failures and bound rejection retries"
```

### Task 4: Linked aborts, deadlines, backoff, bounded JSON

**Create:** `backend/src/model/deadlines.ts`, `backend/test/model/deadlines.spec.ts`.

- [ ] **Step 1 — Write failing fake-clock tests.**

```typescript
// backend/test/model/deadlines.spec.ts
import { RunDeadlines, sleep, readJson } from '../../src/model/deadlines.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
afterEach(()=>vi.useRealTimers());
it.each(['connect','first','idle','total'] as const)('expires %s deadline and cleans timers',async phase=>{
  vi.useFakeTimers();
  const d=new RunDeadlines({...DEFAULT_BUDGETS,totalRunTimeoutMs:10000},new AbortController().signal);
  if(phase==='connect')d.armConnect(5);
  if(phase==='first'){d.headers();d.armFirst(5);}
  if(phase==='idle'){d.headers();d.firstText();d.armIdle(5);}
  await vi.advanceTimersByTimeAsync(phase==='total'?10000:6);
  expect(d.signal.aborted).toBe(true);expect(d.failure().code).toBe('TIMEOUT');
  d.dispose();expect(vi.getTimerCount()).toBe(0);
});
it('external abort wins cancellation and cancels pending backoff',async()=>{
  vi.useFakeTimers();const outer=new AbortController();const d=new RunDeadlines(DEFAULT_BUDGETS,outer.signal);
  const waiting=sleep(1000,d.signal);const result=expect(waiting).rejects.toMatchObject({code:'CANCELLED'});
  outer.abort();await result;expect(d.failure().code).toBe('CANCELLED');d.dispose();expect(vi.getTimerCount()).toBe(0);
});
it('bounds JSON bodies instead of calling unbounded Response.json',async()=>{
  await expect(readJson(new Response('x'.repeat(100)),50)).rejects.toThrow();
  await expect(readJson(new Response('{"ok":true}'),50)).resolves.toEqual({ok:true});
});
it('pre-aborted signal starts no timers',()=>{
  vi.useFakeTimers();const controller=new AbortController();controller.abort();
  const d=new RunDeadlines(DEFAULT_BUDGETS,controller.signal);expect(d.signal.aborted).toBe(true);d.dispose();expect(vi.getTimerCount()).toBe(0);
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/model/deadlines.spec.ts`; expected missing `deadlines.js`.
- [ ] **Step 3 — Implement complete deadline/body utilities.**

```typescript
// backend/src/model/deadlines.ts
import type { BudgetConfig } from '../contracts/budgets.js';
import { AppError } from '../platform/errors/app-error.js';

export class RunDeadlines {
  private controller=new AbortController();
  private timers=new Map<string,ReturnType<typeof setTimeout>>();
  private timedOut=false;
  private visible=false;
  private abort=()=>this.controller.abort();
  readonly signal=this.controller.signal;
  constructor(private budgets:BudgetConfig,private outer:AbortSignal){
    if(outer.aborted)this.abort();else{outer.addEventListener('abort',this.abort,{once:true});this.arm('total',budgets.totalRunTimeoutMs);}
  }
  private clear(name:string){const timer=this.timers.get(name);if(timer!==undefined)clearTimeout(timer);this.timers.delete(name);}
  private arm(name:string,ms:number){this.clear(name);if(this.signal.aborted)return;this.timers.set(name,setTimeout(()=>{this.timers.delete(name);this.timedOut=true;this.controller.abort();},ms));}
  armConnect(ms=this.budgets.connectTimeoutMs){this.arm('connect',ms);}
  armFirst(ms=this.budgets.firstOutputTimeoutMs){this.arm('first',ms);}
  armIdle(ms=this.budgets.idleStreamTimeoutMs){this.arm('idle',ms);}
  headers(){this.clear('connect');this.armFirst();this.armIdle();}
  frame(){this.armIdle();}
  firstText(){if(!this.visible){this.visible=true;this.clear('first');}}
  providerFinished(){this.clear('first');this.clear('idle');}
  resetDispatch(){this.clear('connect');this.clear('first');this.clear('idle');}
  failure(){return this.timedOut?new AppError('TIMEOUT','The response took too long. Retry to continue.',false):new AppError('CANCELLED','Generation was cancelled.',false);}
  check(){if(this.signal.aborted)throw this.failure();}
  stop(){this.controller.abort();}
  dispose(){for(const name of [...this.timers.keys()])this.clear(name);this.outer.removeEventListener('abort',this.abort);}
}
export async function sleep(ms:number,signal:AbortSignal):Promise<void>{
  if(signal.aborted)throw new AppError('CANCELLED','Generation was cancelled.',false);
  await new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new AppError('CANCELLED','Generation was cancelled.',false));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
export async function bounded<T>(job:Promise<T>,ms:number,signal:AbortSignal,code:'PERSISTENCE_ERROR'|'TIMEOUT'):Promise<T>{
  if(signal.aborted)throw new AppError('CANCELLED','Generation was cancelled.',false);
  let timer:ReturnType<typeof setTimeout>|undefined;
  let abort:()=>void=()=>undefined;
  const deadline=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new AppError(code,code==='PERSISTENCE_ERROR'?'The chat accounting could not be saved.':'The request took too long.',false)),ms);
    abort=()=>reject(new AppError('CANCELLED','Generation was cancelled.',false));signal.addEventListener('abort',abort,{once:true});
  });
  try{return await Promise.race([job,deadline]);}finally{if(timer!==undefined)clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
export async function readJson(response:Response,maxBytes:number):Promise<unknown>{
  if(!response.body)throw new AppError('PROVIDER_ERROR','The model service returned an invalid response.',false);
  const reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let count=0,text='',closed=false;
  try{while(true){const next=await reader.read();if(next.done){closed=true;break;}count+=next.value.byteLength;if(count>maxBytes)throw new AppError('PROVIDER_ERROR','The model service returned an oversized response.',false);text+=decoder.decode(next.value,{stream:true});}text+=decoder.decode();return JSON.parse(text) as unknown;}
  catch{throw new AppError('PROVIDER_ERROR','The model service returned an invalid response.',false);}
  finally{if(!closed)await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
```

`bounded` cannot cancel a repository write whose port has no AbortSignal. A timed-out write may still complete; P2 idempotency and P5 reconciliation handle ambiguity. Never retry model inference because a metadata hook timed out. For fetch, pass the linked signal so the actual connection/body read aborts, not just the waiting promise.

- [ ] **Step 4 — Add these fake-clock regressions, then run green:** `npx vitest run test/model/deadlines.spec.ts`; expected finite timers and no resets of first-output/total.

```typescript
it('frame activity does not postpone first output',async()=>{
  vi.useFakeTimers();const d=new RunDeadlines({...DEFAULT_BUDGETS,firstOutputTimeoutMs:10,idleStreamTimeoutMs:8,totalRunTimeoutMs:100},new AbortController().signal);
  d.headers();await vi.advanceTimersByTimeAsync(5);d.frame();await vi.advanceTimersByTimeAsync(6);expect(d.signal.aborted).toBe(true);d.dispose();
});
it('dispatch reset and idle activity never extend total including backoff',async()=>{
  vi.useFakeTimers();const d=new RunDeadlines({...DEFAULT_BUDGETS,totalRunTimeoutMs:10},new AbortController().signal);
  await vi.advanceTimersByTimeAsync(6);d.resetDispatch();d.armConnect();d.frame();await vi.advanceTimersByTimeAsync(5);expect(d.failure().code).toBe('TIMEOUT');expect(d.signal.aborted).toBe(true);d.dispose();
});
```
- [ ] **Step 5 — Commit:**

```powershell
git add backend/src/model/deadlines.ts backend/test/model/deadlines.spec.ts
git commit -m "feat(p4): enforce linked aborts and finite provider deadlines"
```

### Task 5: Absolute usage normalization and bounded record-driven reconciliation

**Create:** `backend/src/model/accounting.ts`, `backend/test/model/accounting.spec.ts`.

- [ ] **Step 1 — Write failing tests.**

```typescript
// backend/test/model/accounting.spec.ts
import { AccountingService, mergeUsage, fromGeneration, status } from '../../src/model/accounting.js';
import { GENERATION } from '../fixtures/openrouter/frames.js';
import { seed, sink, config } from './helpers.js';

it('keeps null unknown and preserves explicit zero',()=>{
  expect(status(seed()).accountingStatus).toBe('unknown');
  expect(status({...seed(),generationId:'gen_fixture'}).accountingStatus).toBe('pending');
  expect(mergeUsage(seed(),{prompt_tokens:0,completion_tokens:0,cost:0})).toMatchObject({promptTokens:0,completionTokens:0,cost:0,accountingStatus:'known'});
  expect(mergeUsage(seed(),{prompt_tokens:-1,completion_tokens:NaN,cost:Infinity})).toMatchObject({promptTokens:null,completionTokens:null,cost:null});
});
it('replaces cumulative totals; does not add duplicate frames or cached/BYOK cost',()=>{
  const first=mergeUsage({...seed(),generationId:'gen_fixture'},{prompt_tokens:12,completion_tokens:3,cost:0.00002});
  expect(mergeUsage(first,{prompt_tokens:12,completion_tokens:3,cost:0.00002,cost_details:{upstream_inference_cost:7}})).toEqual(first);
  expect(mergeUsage(first,{completion_tokens:4,cost:null})).toMatchObject({promptTokens:12,completionTokens:4,cost:0.00002});
});
it('lookup uses native counts and total_cost, checking exact generation identity',()=>{
  expect(fromGeneration({...seed(),generationId:'gen_fixture'},GENERATION)).toMatchObject({promptTokens:12,completionTokens:3,cost:0.00002,reportedProvider:'Fixture',accountingStatus:'known'});
  expect(()=>fromGeneration({...seed(),generationId:'gen_other'},GENERATION)).toThrow();
});
it('repeated reconciliation puts the same scoped absolute snapshot',async()=>{
  const repo=sink();const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(GENERATION)));
  const service=new AccountingService(config(),repo,fetcher);
  const original={...seed(),generationId:'gen_fixture',accountingStatus:'pending' as const,outcome:'interrupted' as const};
  const first=await service.reconcile(original,new AbortController().signal);
  const second=await service.reconcile(original,new AbortController().signal);
  expect(first).toEqual(second);expect(first.outcome).toBe('interrupted');
  expect(repo.putAccounting.mock.calls[0][0]).toEqual(repo.putAccounting.mock.calls[1][0]);
  expect(String(fetcher.mock.calls[0][0])).toContain('generation?id=gen_fixture');
});
it('has no-ID fallback and bounded 404/unavailable reconciliation without inference',async()=>{
  const repo=sink();const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify({error:{code:404}}),{status:404}));
  const service=new AccountingService({...config(),budgets:{...config().budgets,retryBaseDelayMs:1,retryMaxDelayMs:2}},repo,fetcher,()=>0);
  expect((await service.reconcile(seed(),new AbortController().signal)).accountingStatus).toBe('unknown');expect(fetcher).not.toHaveBeenCalled();
  const r=await service.reconcile({...seed(),generationId:'gen_fixture'},new AbortController().signal);
  expect(r.accountingStatus).toBe('unknown');expect(r.cost).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/model/accounting.spec.ts`; expected missing `accounting.js`.
- [ ] **Step 3 — Implement normalization and reconciliation.**

```typescript
// backend/src/model/accounting.ts
import type { AccountingRecord } from '../contracts/metadata.js';
import { accountingRecordSchema } from '../contracts/metadata.js';
import type { MetadataRepository } from '../contracts/repositories.js';
import type { AurvinConfig } from '../platform/config/load-config.js';
import { AppError } from '../platform/errors/app-error.js';
import { OPENROUTER_BASE, TRANSPORT_LIMITS } from './policy.js';
import { object, providerFault, retryDelay } from './faults.js';
import { bounded, readJson, sleep } from './deadlines.js';

export function number(value:unknown,integer=false):number|null{return typeof value==='number'&&Number.isFinite(value)&&value>=0&&(!integer||Number.isSafeInteger(value))?value:null;}
export function identifier(value:unknown):string|null{return typeof value==='string'&&value.length>0&&value.length<=200?value:null;}
export function status(r:AccountingRecord):AccountingRecord{return {...r,accountingStatus:r.promptTokens!==null&&r.completionTokens!==null&&r.cost!==null?'known':r.generationId?'pending':'unknown'};}
export function mergeUsage(r:AccountingRecord,raw:unknown):AccountingRecord{
  const u=object(raw);return status({...r,promptTokens:number(u.prompt_tokens,true)??r.promptTokens,completionTokens:number(u.completion_tokens,true)??r.completionTokens,cost:number(u.cost)??r.cost});
}
export function fromGeneration(r:AccountingRecord,raw:unknown):AccountingRecord{
  const d=object(object(raw).data);
  if(identifier(d.id)!==r.generationId)throw new AppError('PROVIDER_ERROR','Accounting identity did not match.',false);
  return status({...r,reportedModel:identifier(d.model)??r.reportedModel,reportedProvider:identifier(d.provider_name)??r.reportedProvider,promptTokens:number(d.native_tokens_prompt,true)??r.promptTokens,completionTokens:number(d.native_tokens_completion,true)??r.completionTokens,cost:number(d.total_cost)??r.cost});
}
export class AccountingService {
  private latest:AccountingRecord|null=null;
  constructor(private config:AurvinConfig,private repository:Pick<MetadataRepository,'putAccounting'>,private fetcher:typeof fetch=fetch,private random:()=>number=Math.random){}
  snapshot(userId:string,sessionId:string,attemptId:string):AccountingRecord|null{
    const r=this.latest;return r&&r.userId===userId&&r.sessionId===sessionId&&r.attemptId===attemptId?{...r}:null;
  }
  async save(record:AccountingRecord,signal:AbortSignal):Promise<void>{
    const parsed=accountingRecordSchema.parse(record);
    if(parsed.userId!==this.config.identity.userId||parsed.requestedModel!==this.config.openRouter.modelId)throw new AppError('CONFIGURATION_ERROR','The accounting scope is invalid.',false);
    try{await bounded(this.repository.putAccounting(parsed),this.config.budgets.persistenceTimeoutMs,signal,'PERSISTENCE_ERROR');this.latest={...parsed};}
    catch(error){if(error instanceof AppError)throw error;throw new AppError('PERSISTENCE_ERROR','The chat accounting could not be saved.',false);}
  }
  async reconcile(record:AccountingRecord,outer:AbortSignal):Promise<AccountingRecord>{
    let result=accountingRecordSchema.parse(record);
    if(result.userId!==this.config.identity.userId||result.requestedModel!==this.config.openRouter.modelId)throw new AppError('CONFIGURATION_ERROR','The accounting scope is invalid.',false);
    if(!result.generationId||result.accountingStatus==='known'){await this.save(result,outer);return result;}
    const controller=new AbortController();const abort=()=>controller.abort();
    if(outer.aborted)abort();else outer.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,this.config.budgets.connectTimeoutMs);
    try{
      for(let dispatch=1;dispatch<=this.config.budgets.retryMaxAttempts;dispatch++){
        if(controller.signal.aborted)break;
        let http:Response;
        try{http=await this.fetcher(`${OPENROUTER_BASE}/generation?id=${encodeURIComponent(result.generationId)}`,{headers:{Authorization:`Bearer ${this.config.openRouter.apiKey}`},signal:controller.signal});}
        catch{break;}
        if(http.ok){
          try{result=fromGeneration(result,await readJson(http,TRANSPORT_LIMITS.jsonBytes));}catch{break;}
          break;
        }
        await http.body?.cancel().catch(()=>undefined);
        if(![404,429,503].includes(http.status)){
          // No credential/credit retry; account degradation is separate from turn outcome.
          if(http.status===401||http.status===403||http.status===402)throw providerFault(http.status);
          break;
        }
        if(dispatch===this.config.budgets.retryMaxAttempts)break;
        const delay=retryDelay(this.config.budgets,dispatch,this.random(),http.headers.get('retry-after'));
        if(delay===null)break;
        try{await sleep(delay,controller.signal);}catch{break;}
      }
      if(result.accountingStatus!=='known')result={...result,accountingStatus:'unknown'};
      await this.save(result,outer);return result;
    }finally{clearTimeout(timer);outer.removeEventListener('abort',abort);}
  }
}
```

Lookup is non-inference and may retry 404 eventual availability/429/503 within one 10-second window and configured attempt count. Exhaustion becomes unknown, preserving every obtained field and the original outcome. A later operator/P5 reconciliation call may try again; it never performs chat inference. Save failure is PERSISTENCE_ERROR, not unknown accounting success. Authentication failures are surfaced once to operations without leaking provider text.

- [ ] **Step 4 — Add these reconciliation regressions, then run green:** `npx vitest run test/model/accounting.spec.ts`. Use absolute snapshots—no mock increment assertions.

```typescript
it('retries eventual lookup once and preserves token/cost zero',async()=>{
  const c={...config(),budgets:{...config().budgets,retryBaseDelayMs:1,retryMaxDelayMs:2}};
  const f=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}',{status:404})).mockResolvedValueOnce(new Response(JSON.stringify({data:{id:'gen_fixture',native_tokens_prompt:0,native_tokens_completion:0,total_cost:0}})));
  expect(await new AccountingService(c,sink(),f,()=>0).reconcile({...seed(),generationId:'gen_fixture'},new AbortController().signal)).toMatchObject({cost:0,promptTokens:0,completionTokens:0,accountingStatus:'known'});expect(f).toHaveBeenCalledTimes(2);
});
it('does not reinterpret string/different-tokenizer/BYOK fields as billing',()=>{
  expect(fromGeneration({...seed(),generationId:'gen_fixture'},{data:{id:'gen_fixture',tokens_prompt:99,tokens_completion:99,native_tokens_prompt:'12',native_tokens_completion:-1,total_cost:'0.5',upstream_inference_cost:7}})).toMatchObject({promptTokens:null,completionTokens:null,cost:null,accountingStatus:'pending'});
});
it('encodes ID and rejects foreign user/requested model before lookup',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('{bad'));
  const service=new AccountingService(config(),sink(),f);
  await service.reconcile({...seed(),generationId:'gen/a?x=1'},new AbortController().signal);expect(String(f.mock.calls[0][0])).toContain('gen%2Fa%3Fx%3D1');
  const before=f.mock.calls.length;
  await expect(service.reconcile({...seed(),userId:'other',generationId:'gen_fixture'},new AbortController().signal)).rejects.toThrow();
  await expect(service.reconcile({...seed(),requestedModel:'other',generationId:'gen_fixture'},new AbortController().signal)).rejects.toThrow();expect(f).toHaveBeenCalledTimes(before);
});
it.each([401,402,403])('surfaces lookup auth/credit %i once',async code=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('{}',{status:code}));
  await expect(new AccountingService(config(),sink(),f).reconcile({...seed(),generationId:'gen_fixture'},new AbortController().signal)).rejects.toThrow();expect(f).toHaveBeenCalledTimes(1);
});
it.each(['{bad','x'.repeat(65537),JSON.stringify({data:{id:'gen_fixture',native_tokens_prompt:12}})])('keeps unavailable/partial lookup unknown',async body=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
  expect((await new AccountingService(config(),sink(),f).reconcile({...seed(),generationId:'gen_fixture'},new AbortController().signal)).accountingStatus).toBe('unknown');expect(f).toHaveBeenCalledTimes(1);
});
it('save failure is not successful reconciliation and snapshot is scope checked',async()=>{
  const repo=sink();const service=new AccountingService(config(),repo);
  await service.save(seed(),new AbortController().signal);expect(service.snapshot('aurvin-dev-user','sess_fixture','att_fixture')).toEqual(seed());expect(service.snapshot('other','sess_fixture','att_fixture')).toBeNull();
  repo.putAccounting.mockRejectedValue(new Error('private'));
  await expect(service.reconcile(seed(),new AbortController().signal)).rejects.toMatchObject({code:'PERSISTENCE_ERROR'});
});
it('distinct retry attempts preserve two durable identities, not a summed generation',async()=>{
  const rows=new Map<string,unknown>();const repo={putAccounting:async(r:ReturnType<typeof seed>)=>{rows.set(`${r.userId}/${r.sessionId}/${r.attemptId}/${r.generationId}`,r);}};
  const service=new AccountingService(config(),repo);
  await service.save({...seed(),generationId:'gen_1',cost:0.1},new AbortController().signal);
  await service.save({...seed(),attemptId:'att_retry',generationId:'gen_2',cost:0.2},new AbortController().signal);expect(rows.size).toBe(2);
});
it('bounds hung lookup body, preserves outcome and never sends a chat POST',async()=>{
  vi.useFakeTimers();
  try{
    const c={...config(),budgets:{...config().budgets,connectTimeoutMs:5}};
    const f=vi.fn<typeof fetch>().mockImplementation(async(_,init)=>new Response(new ReadableStream<Uint8Array>({start(controller){init?.signal?.addEventListener('abort',()=>controller.error(new Error('aborted')),{once:true});}})));
    const pending=new AccountingService(c,sink(),f).reconcile({...seed(),generationId:'gen_fixture',outcome:'cancelled'},new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10);expect(await pending).toMatchObject({accountingStatus:'unknown',outcome:'cancelled',cost:null});expect(f).toHaveBeenCalledTimes(1);expect(String(f.mock.calls[0][0])).toContain('/generation?');expect(f.mock.calls[0][1]?.method).not.toBe('POST');expect(vi.getTimerCount()).toBe(0);
  }finally{vi.useRealTimers();}
});
it('external lookup abort is explicit and does not mutate another scope',async()=>{
  const outer=new AbortController();outer.abort();const repo=sink(),f=vi.fn<typeof fetch>();
  await expect(new AccountingService(config(),repo,f).reconcile({...seed(),generationId:'gen_fixture'},outer.signal)).rejects.toMatchObject({code:'CANCELLED'});expect(f).not.toHaveBeenCalled();expect(repo.putAccounting).not.toHaveBeenCalled();
});
```
- [ ] **Step 5 — Commit:**

```powershell
git add backend/src/model/accounting.ts backend/test/model/accounting.spec.ts
git commit -m "feat(p4): normalize generation accounting and reconcile bounded lookups"
```

### Task 6: One-shot attempt adapter and honest provider terminal states

**Create:** `backend/src/model/openrouter-adapter.ts`, `backend/test/model/adapter.spec.ts`.

- [ ] **Step 1 — Write failing integration-through-fixture tests.** These inspect the actual body passed to injected fetch, not a mocked ChatOpenRouter method.

```typescript
// backend/test/model/adapter.spec.ts
import { OpenRouterAttemptAdapter } from '../../src/model/openrouter-adapter.js';
import { AccountingService } from '../../src/model/accounting.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';
import { config, limits, request, seed, sink, response, collect } from './helpers.js';
import type { ModelChunk } from '../../src/contracts/runtime.js';

function harness(text=FRAMES.normal,c=config(),random:()=>number=()=>0){
  const repo=sink();const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>response(text));
  const onId=vi.fn<(id:string)=>Promise<void>>().mockResolvedValue(undefined);
  const adapter=new OpenRouterAttemptAdapter(c,limits,seed(),new AccountingService(c,repo,fetcher),onId,fetcher,random);
  return {adapter,repo,fetcher,onId};
}
afterEach(()=>vi.useRealTimers());
it('sends server identity/caps/privacy and preserves comment/id/delta/usage/end',async()=>{
  const h=harness();const out=await collect(h.adapter.stream(request()));
  expect(out.map(c=>c.type)).toEqual(['comment','generation-id','delta','usage','end']);
  expect(out.find(c=>c.type==='usage')).toMatchObject({promptTokens:12,completionTokens:3,cost:0.00002,accountingStatus:'known'});
  expect(h.onId).toHaveBeenCalledWith('gen_fixture');
  const body=JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
  expect(body).toMatchObject({user:'aurvin-dev-user',model:'fixture/model',max_tokens:2048,transforms:[],provider:{data_collection:'deny'}});
  expect(body.plugins).toContainEqual({id:'context-compression',enabled:false});
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0]).toMatchObject({generationId:'gen_fixture',reportedProvider:'Fixture',cost:0.00002,outcome:'finalizing'});
});
it.each(['errorBefore','errorAfter','eof','finishEof','onlyDone','malformed','differentId','contentFilter','tools'] as const)('does not emit end or re-infer on %s',async name=>{
  const h=harness(FRAMES[name]);const out:ModelChunk[]=[];
  await expect((async()=>{for await(const c of h.adapter.stream(request()))out.push(c);})()).rejects.toThrow();
  expect(out.some(c=>c.type==='end')).toBe(false);expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0].outcome).not.toBe('completed');
});
it('length remains distinct; repeated usage is not double-summed',async()=>{
  const h=harness(FRAMES.length);expect((await collect(h.adapter.stream(request()))).map(c=>c.type)).toContain('length');
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0].outcome).toBe('truncated');
  const dup=harness(FRAMES.duplicateUsage);const out=await collect(dup.adapter.stream(request()));
  expect(out.filter(c=>c.type==='usage')).toHaveLength(1);expect(dup.repo.putAccounting.mock.calls.at(-1)?.[0].cost).toBe(0.00002);
});
it('discards private reasoning and leaves missing usage pending',async()=>{
  const h=harness(FRAMES.reasoning);const out=await collect(h.adapter.stream(request()));
  expect(JSON.stringify(out)).not.toContain('private');expect(out).toContainEqual({type:'delta',text:'Visible'});
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0]).toMatchObject({cost:null,accountingStatus:'pending'});
});
it('never dispatches if already cancelled or identity mismatches',async()=>{
  const h=harness();const abort=new AbortController();abort.abort();
  await expect(collect(h.adapter.stream(request(abort.signal)))).rejects.toMatchObject({code:'CANCELLED'});expect(h.fetcher).not.toHaveBeenCalled();
  const other=harness();await expect(collect(other.adapter.stream({...request(),user:'other'}))).rejects.toThrow();expect(other.fetcher).not.toHaveBeenCalled();
});
it('awaits generation durability before visible text and blocks on persistence failure',async()=>{
  const h=harness();h.onId.mockRejectedValue(new Error('private database text'));
  await expect(collect(h.adapter.stream(request()))).rejects.toMatchObject({code:'PERSISTENCE_ERROR'});expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it('refuses accidental adapter reuse',async()=>{
  const h=harness();await collect(h.adapter.stream(request()));await expect(collect(h.adapter.stream(request()))).rejects.toThrow();expect(h.fetcher).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/model/adapter.spec.ts`; expected missing `openrouter-adapter.js`.
- [ ] **Step 3 — Implement the complete adapter.**

```typescript
// backend/src/model/openrouter-adapter.ts
import type { ModelAdapter, ModelInvokeRequest, ModelChunk } from '../contracts/runtime.js';
import type { AccountingRecord } from '../contracts/metadata.js';
import type { AurvinConfig } from '../platform/config/load-config.js';
import { AppError } from '../platform/errors/app-error.js';
import { OPENROUTER_BASE, TRANSPORT_LIMITS as L, buildBody, type ModelLimits } from './policy.js';
import { AccountingService, identifier, mergeUsage, status } from './accounting.js';
import { object, providerFault, mayRetryRejection, retryDelay } from './faults.js';
import { RunDeadlines, bounded, readJson, sleep } from './deadlines.js';
import { parseSse } from './sse.js';

export class OpenRouterAttemptAdapter implements ModelAdapter {
  private used=false;
  constructor(private config:AurvinConfig,private limits:ModelLimits,private record:AccountingRecord,readonly accounting:AccountingService,private onGenerationId:(id:string)=>Promise<void>,private fetcher:typeof fetch=fetch,private random:()=>number=Math.random){}
  async *stream(request:ModelInvokeRequest):AsyncGenerator<ModelChunk>{
    if(this.used)throw new AppError('INVALID_REQUEST','This attempt has already run.',false);
    this.used=true;
    const body=buildBody(this.config,this.limits,request);
    if(this.record.userId!==request.user||this.record.requestedModel!==request.modelId||this.record.generationId!==null||this.record.outcome!=='generating')throw new AppError('CONFIGURATION_ERROR','The model attempt is invalid.',false);
    const d=new RunDeadlines(this.config.budgets,request.abortSignal);
    let started=false,providerEnd=false,visible=false,finish:string|null=null,totalChars=0,totalBytes=0,lastUsage='',http:Response|undefined;
    const save=()=>this.accounting.save(this.record,d.signal);
    const capture=async(id:string)=>{
      if(this.record.generationId&&this.record.generationId!==id)throw new AppError('PROVIDER_ERROR','The response identity changed.',false);
      if(this.record.generationId)return false;
      this.record=status({...this.record,generationId:id});
      try{await bounded(this.onGenerationId(id),this.config.budgets.persistenceTimeoutMs,d.signal,'PERSISTENCE_ERROR');}
      catch(error){if(error instanceof AppError)throw error;throw new AppError('PERSISTENCE_ERROR','The chat could not be saved.',false);}
      await save();return true;
    };
    try{
      d.check();await save(); // A failure here sends no paid request.
      for(let dispatch=1;dispatch<=this.config.budgets.retryMaxAttempts;dispatch++){
        d.check();d.armConnect();started=true;
        try{http=await this.fetcher(`${OPENROUTER_BASE}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${this.config.openRouter.apiKey}`,'Content-Type':'application/json','X-Title':'Aurvin'},body:JSON.stringify(body),signal:d.signal});}
        catch{d.check();throw new AppError('INTERRUPTED','The response could not be confirmed. Retry to continue.',false);}
        d.headers();
        if(http.ok)break;
        const rejected=await readJson(http,L.jsonBytes);
        const top=object(rejected);const id=identifier(top.id);
        if(id&&await capture(id))yield {type:'generation-id',generationId:id};
        const fault=providerFault(http.status,object(top.error).code);
        const delay=retryDelay(this.config.budgets,dispatch,this.random(),http.headers.get('retry-after'));
        if(!mayRetryRejection(http.status,rejected,Boolean(this.record.generationId),visible)||dispatch>=this.config.budgets.retryMaxAttempts||delay===null)throw fault;
        d.resetDispatch();await sleep(delay,d.signal);
      }
      if(!http?.ok||!http.body||!http.headers.get('content-type')?.toLowerCase().includes('text/event-stream'))throw new AppError('PROVIDER_ERROR','The model service returned an invalid stream.',false);
      for await(const frame of parseSse(http.body)){
        d.check();d.frame();
        if(frame.type==='comment'){yield {type:'comment',text:frame.text};continue;}
        if(frame.data==='[DONE]'){
          if(!finish||!this.record.generationId)throw new AppError('INTERRUPTED','The response could not be confirmed.',false);
          providerEnd=true;break;
        }
        let value:unknown;
        try{value=JSON.parse(frame.data) as unknown;}catch{throw new AppError('PROVIDER_ERROR','The response stream was invalid.',false);}
        const raw=object(value);if(!Object.keys(raw).length)throw new AppError('PROVIDER_ERROR','The response stream was invalid.',false);
        const id=identifier(raw.id);
        if(raw.id!==undefined&&!id)throw new AppError('PROVIDER_ERROR','The response identity was invalid.',false);
        if(id&&await capture(id))yield {type:'generation-id',generationId:id};
        this.record={...this.record,reportedModel:identifier(raw.model)??this.record.reportedModel,reportedProvider:identifier(raw.provider)??this.record.reportedProvider};
        if(raw.usage!==undefined){
          this.record=mergeUsage(this.record,raw.usage);
          const usage={type:'usage' as const,promptTokens:this.record.promptTokens,completionTokens:this.record.completionTokens,cost:this.record.cost,accountingStatus:this.record.accountingStatus};
          const signature=JSON.stringify(usage);
          if(signature!==lastUsage){await save();lastUsage=signature;yield usage;}
        }
        if(raw.error!==undefined){const fault=providerFault(200,object(raw.error).code);throw new AppError(fault.code,fault.message,false);}
        const choices=raw.choices===undefined&&raw.usage!==undefined?[]:raw.choices;
        if(!Array.isArray(choices))throw new AppError('PROVIDER_ERROR','The response stream was invalid.',false);
        if(choices.length>1)throw new AppError('PROVIDER_ERROR','The response stream contained multiple answers.',false);
        const choice=object(choices[0]),delta=object(choice.delta);
        if(choice.index!==undefined&&choice.index!==0)throw new AppError('PROVIDER_ERROR','The response stream was invalid.',false);
        if(delta.role!==undefined&&delta.role!=='assistant')throw new AppError('PROVIDER_ERROR','The response role was invalid.',false);
        if(delta.tool_calls!==undefined||delta.function_call!==undefined)throw new AppError('PROVIDER_ERROR','The response requested unsupported actions.',false);
        const text=delta.content;
        if(text!==undefined&&text!==null&&typeof text!=='string')throw new AppError('PROVIDER_ERROR','The response was not text.',false);
        if(typeof text==='string'&&text.length){
          if(finish)throw new AppError('PROVIDER_ERROR','The response continued after its finish marker.',false);
          if(!this.record.generationId)throw new AppError('PROVIDER_ERROR','The response identity was missing.',false);
          totalChars+=text.length;totalBytes+=Buffer.byteLength(text,'utf8');
          if(totalChars>L.outputChars||totalBytes>this.config.budgets.maxMessageBytes)throw new AppError('STORAGE_BUDGET_EXCEEDED','The response exceeded its storage limit.',false);
          visible=true;d.firstText();yield {type:'delta',text};
        }
        if(choice.finish_reason!==undefined&&choice.finish_reason!==null){
          if(!['stop','length'].includes(String(choice.finish_reason)))throw new AppError('PROVIDER_ERROR','The model service did not complete its answer.',false);
          if(finish&&finish!==choice.finish_reason)throw new AppError('PROVIDER_ERROR','The response finish markers disagreed.',false);
          const first=!finish;finish=String(choice.finish_reason);d.firstText();if(first&&finish==='length')yield {type:'length'};
        }
      }
      if(!providerEnd)throw new AppError('INTERRUPTED','The response stream ended early. Retry to continue.',false);
      d.providerFinished();d.check();
      this.record={...status(this.record),outcome:finish==='length'?'truncated':'finalizing',endedAt:new Date().toISOString()};
      await save();d.check();yield {type:'end'};
    }catch(error){
      const fault=d.signal.aborted?d.failure():error instanceof AppError?error:new AppError('PROVIDER_ERROR','The model service could not answer.',false);
      this.record={...status(this.record),outcome:fault.code==='CANCELLED'?'cancelled':fault.code==='INTERRUPTED'||fault.code==='TIMEOUT'?'interrupted':'failed',endedAt:new Date().toISOString()};
      // A separate finite cleanup budget allows cancellation accounting to persist.
      const cleanup=new AbortController();
      try{if(started)await this.accounting.save(this.record,cleanup.signal);}catch{throw new AppError('PERSISTENCE_ERROR','The chat accounting could not be saved.',false);}
      throw fault;
    }finally{
      d.stop();d.dispose();
      await http?.body?.cancel().catch(()=>undefined);
      // Iterator return is not provider success: P5 marks interrupted/cancelled and saves final outcome.
    }
  }
}
```

`onGenerationId` must be awaited before any delta. P4 records reported model/provider without changing requested model; a provider-reported alias is evidence, not permission for automatic model switching. Usage snapshots can repeat writes safely but emit one identical usage event. P5 overwrites provisional finalizing with its actual durable completed/failed outcome using the same absolute record identity after checkpoint/application finalization. Accounting knownness does not imply successful answer or application completion.

- [ ] **Step 4 — Run green:** `npx vitest run test/model/adapter.spec.ts`. Before committing, add the following concrete regression tests to the same file; they are mandatory, not optional integration work:

```typescript
it('propagates external abort after partial output and never emits end',async()=>{
  const h=harness();const controller=new AbortController();const out:ModelChunk[]=[];
  await expect((async()=>{for await(const c of h.adapter.stream(request(controller.signal))){out.push(c);if(c.type==='delta')controller.abort();}})()).rejects.toMatchObject({code:'CANCELLED'});
  expect(out.some(c=>c.type==='end')).toBe(false);expect(h.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0].outcome).toBe('cancelled');
});
it('retries one definitive 429 without multiplying attempts or changing user',async()=>{
  const h=harness();h.fetcher.mockReset();
  h.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({error:{code:429}}),{status:429}));
  h.fetcher.mockResolvedValueOnce(response(FRAMES.normal));
  await collect(h.adapter.stream(request()));expect(h.fetcher).toHaveBeenCalledTimes(2);
  for(const call of h.fetcher.mock.calls)expect(JSON.parse(String(call[1]?.body)).user).toBe('aurvin-dev-user');
});
it.each([401,402,400,413,500,502,504])('does not auto-retry HTTP %i',async status=>{
  const h=harness();h.fetcher.mockReset().mockResolvedValue(new Response(JSON.stringify({error:{code:status}}),{status}));
  await expect(collect(h.adapter.stream(request()))).rejects.toThrow();expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it('caps repeated definitive rejection at configured attempts',async()=>{
  const h=harness();h.fetcher.mockReset().mockImplementation(async()=>new Response(JSON.stringify({error:{code:503}}),{status:503}));
  await expect(collect(h.adapter.stream(request()))).rejects.toThrow();expect(h.fetcher).toHaveBeenCalledTimes(2);
});
it('does not retry network ambiguity, malformed error bodies or generated rejection',async()=>{
  const network=harness();network.fetcher.mockRejectedValue(new TypeError('private socket detail'));
  await expect(collect(network.adapter.stream(request()))).rejects.toMatchObject({code:'INTERRUPTED'});expect(network.fetcher).toHaveBeenCalledTimes(1);
  const malformed=harness();malformed.fetcher.mockResolvedValue(new Response('{bad',{status:503}));
  await expect(collect(malformed.adapter.stream(request()))).rejects.toThrow();expect(malformed.fetcher).toHaveBeenCalledTimes(1);
  const generated=harness();generated.fetcher.mockResolvedValue(new Response(JSON.stringify({id:'gen_fixture',error:{code:503}}),{status:503}));
  await expect(collect(generated.adapter.stream(request()))).rejects.toThrow();expect(generated.fetcher).toHaveBeenCalledTimes(1);expect(generated.onId).toHaveBeenCalled();
});
it('aborts upstream when the consumer returns early',async()=>{
  const h=harness();const iterator=h.adapter.stream(request());await iterator.next();await iterator.return(undefined);
  expect(h.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
it('does not emit provider end when terminal accounting persistence fails',async()=>{
  const h=harness(FRAMES.noUsage);
  h.repo.putAccounting.mockImplementation(async r=>{if(r.outcome==='finalizing')throw new Error('private storage error');});
  const out:ModelChunk[]=[];await expect((async()=>{for await(const c of h.adapter.stream(request()))out.push(c);})()).rejects.toMatchObject({code:'PERSISTENCE_ERROR'});
  expect(out.some(c=>c.type==='end')).toBe(false);expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it('retains billing attached to an HTTP-200 error without claiming answer success',async()=>{
  const h=harness(FRAMES.errorUsage);const out:ModelChunk[]=[];
  await expect((async()=>{for await(const item of h.adapter.stream(request()))out.push(item);})()).rejects.toMatchObject({code:'PROVIDER_ERROR'});
  expect(out).toContainEqual({type:'usage',promptTokens:12,completionTokens:3,cost:0.00002,accountingStatus:'known'});
  expect(out.some(x=>x.type==='end')).toBe(false);expect(h.repo.putAccounting.mock.calls.at(-1)?.[0]).toMatchObject({accountingStatus:'known',cost:0.00002,outcome:'failed'});
});
```

Then append these exact fake-clock/transport regressions and run the same red/green command. Assert finite abort, preserved ID/partial outcome, no repeated POST, no end, and timer cleanup. Keep them in this task's owned file; reuse Task 4 timing API rather than inventing another clock.

```typescript
it('times out hung headers without another POST',async()=>{
  vi.useFakeTimers();const c={...config(),budgets:{...config().budgets,connectTimeoutMs:5,totalRunTimeoutMs:100}};const h=harness(FRAMES.normal,c);
  h.fetcher.mockImplementation(async(_,init)=>new Promise<Response>((_,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}));
  const result=expect(collect(h.adapter.stream(request()))).rejects.toMatchObject({code:'TIMEOUT'});
  await vi.advanceTimersByTimeAsync(10);await result;expect(h.fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('processing comments cannot evade first-output deadline',async()=>{
  vi.useFakeTimers();const c={...config(),budgets:{...config().budgets,firstOutputTimeoutMs:5,idleStreamTimeoutMs:4,totalRunTimeoutMs:100}};const h=harness(FRAMES.normal,c);
  h.fetcher.mockImplementation(async(_,init)=>new Response(new ReadableStream<Uint8Array>({start(controller){
    const timer=setInterval(()=>controller.enqueue(new TextEncoder().encode(': processing\n\n')),2);
    init?.signal?.addEventListener('abort',()=>{clearInterval(timer);controller.error(new Error('aborted'));},{once:true});
  }}),{headers:{'content-type':'text/event-stream'}}));
  const result=expect(collect(h.adapter.stream(request()))).rejects.toMatchObject({code:'TIMEOUT'});
  await vi.advanceTimersByTimeAsync(10);await result;expect(h.fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('stalled body after first delta preserves generation accounting and times out idle',async()=>{
  vi.useFakeTimers();const c={...config(),budgets:{...config().budgets,idleStreamTimeoutMs:5,totalRunTimeoutMs:100}};const h=harness(FRAMES.normal,c);
  h.fetcher.mockImplementation(async(_,init)=>new Response(new ReadableStream<Uint8Array>({start(controller){
    controller.enqueue(new TextEncoder().encode('data: {"id":"gen_fixture","choices":[{"index":0,"delta":{"content":"Partial"},"finish_reason":null}]}\n\n'));
    init?.signal?.addEventListener('abort',()=>controller.error(new Error('aborted')),{once:true});
  }}),{headers:{'content-type':'text/event-stream'}}));
  const out:ModelChunk[]=[];const result=expect((async()=>{for await(const item of h.adapter.stream(request()))out.push(item);})()).rejects.toMatchObject({code:'TIMEOUT'});
  await vi.advanceTimersByTimeAsync(10);await result;expect(out).toContainEqual({type:'delta',text:'Partial'});expect(out.some(x=>x.type==='end')).toBe(false);
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0]).toMatchObject({generationId:'gen_fixture',outcome:'interrupted',cost:null});expect(vi.getTimerCount()).toBe(0);
});
it('total deadline includes rejected backoff without another POST',async()=>{
  vi.useFakeTimers();const c={...config(),budgets:{...config().budgets,totalRunTimeoutMs:5,retryBaseDelayMs:10,retryMaxDelayMs:20}};const h=harness(FRAMES.normal,c,()=>1);
  h.fetcher.mockImplementation(async()=>new Response(JSON.stringify({error:{code:503}}),{status:503}));
  const result=expect(collect(h.adapter.stream(request()))).rejects.toMatchObject({code:'TIMEOUT'});
  await vi.advanceTimersByTimeAsync(10);await result;expect(h.fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('generation hook timeout keeps received ID for accounting and never infers twice',async()=>{
  vi.useFakeTimers();const c={...config(),budgets:{...config().budgets,persistenceTimeoutMs:5}};const h=harness(FRAMES.normal,c);h.onId.mockImplementation(async()=>new Promise<void>(()=>undefined));
  const result=expect(collect(h.adapter.stream(request()))).rejects.toMatchObject({code:'PERSISTENCE_ERROR'});
  await vi.advanceTimersByTimeAsync(10);await result;expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0]).toMatchObject({generationId:'gen_fixture',outcome:'failed'});expect(vi.getTimerCount()).toBe(0);
});
it('fails invalid UTF-8 and missing/wrong-content-type body without end',async()=>{
  const bad=harness();bad.fetcher.mockResolvedValue(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([255]));c.close();}}),{headers:{'content-type':'text/event-stream'}}));
  await expect(collect(bad.adapter.stream(request()))).rejects.toMatchObject({code:'PROVIDER_ERROR'});
  const absent=harness();absent.fetcher.mockResolvedValue(new Response(null,{headers:{'content-type':'text/event-stream'}}));await expect(collect(absent.adapter.stream(request()))).rejects.toThrow();
  const wrong=harness();wrong.fetcher.mockResolvedValue(new Response('{}',{headers:{'content-type':'application/json'}}));await expect(collect(wrong.adapter.stream(request()))).rejects.toThrow();
});
it('rejects the violating output delta before yielding it',async()=>{
  const text='x'.repeat(32001);const stream='data: '+JSON.stringify({id:'gen_fixture',choices:[{index:0,delta:{content:text},finish_reason:null}]})+'\n\n';
  const h=harness(stream);const out:ModelChunk[]=[];
  await expect((async()=>{for await(const item of h.adapter.stream(request()))out.push(item);})()).rejects.toMatchObject({code:'STORAGE_BUDGET_EXCEEDED'});
  expect(out.some(x=>x.type==='delta'||x.type==='end')).toBe(false);expect(h.fetcher).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 5 — Commit:**

```powershell
git add backend/src/model/openrouter-adapter.ts backend/test/model/adapter.spec.ts
git commit -m "feat(p4): stream attributed attempts with honest provider outcomes"
```

### Task 7: Non-inference capabilities and factory handoff

**Create:** `backend/src/model/catalogue.ts`, `backend/src/model/index.ts`, `backend/test/model/catalogue.spec.ts`.

- [ ] **Step 1 — Write failing capability and factory tests.**

```typescript
// backend/test/model/catalogue.spec.ts
import { loadModelLimits, createModelServices } from '../../src/model/index.js';
import { config, limits, seed, sink, request, response, collect } from './helpers.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';
const entry={id:'fixture/model',context_length:32768,top_provider:{max_completion_tokens:4096},supported_parameters:['max_tokens']};
it('loads only selected model limits without a paid health call',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({data:[entry]})));
  expect(await loadModelLimits(config(),new AbortController().signal,fetcher)).toMatchObject({...limits,source:'catalogue'});
  expect(fetcher.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/models');expect(fetcher.mock.calls[0][1]?.method).not.toBe('POST');
});
it.each([{...entry,context_length:8192},{...entry,top_provider:{max_completion_tokens:null}},{...entry,supported_parameters:[]}])('fails readiness on unverified/insufficient caps',async bad=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({data:[bad]})));
  await expect(loadModelLimits(config(),new AbortController().signal,f)).rejects.toMatchObject({code:'CONFIGURATION_ERROR'});
});
it('exports an attempt-bound adapter without central Nest wiring',async()=>{
  const repo=sink();const f=vi.fn<typeof fetch>().mockImplementation(async()=>response(FRAMES.normal));
  const services=createModelServices(config(),limits,repo,f,()=>0);
  const a=services.createAttemptAdapter(seed(),async()=>undefined);
  expect((await collect(a.stream(request()))).at(-1)).toEqual({type:'end'});
  expect(a.accounting.snapshot('aurvin-dev-user','sess_fixture','att_fixture')).toMatchObject({reportedProvider:'Fixture',outcome:'finalizing'});
  expect(typeof services.accounting.reconcile).toBe('function');
});
```

- [ ] **Step 2 — Run red:** `npx vitest run test/model/catalogue.spec.ts`; expected missing `index.js`.
- [ ] **Step 3 — Implement complete public factory and catalogue loader.**

```typescript
// backend/src/model/catalogue.ts
import type { AurvinConfig } from '../platform/config/load-config.js';
import { AppError } from '../platform/errors/app-error.js';
import { OPENROUTER_BASE, TRANSPORT_LIMITS, type ModelLimits } from './policy.js';
import { object } from './faults.js';
import { number } from './accounting.js';
import { readJson } from './deadlines.js';
export async function loadModelLimits(c:AurvinConfig,outer:AbortSignal,fetcher:typeof fetch=fetch):Promise<ModelLimits>{
  if(!c.openRouter.modelId||!c.openRouter.apiKey||!c.openRouter.disableTransforms)throw new AppError('CONFIGURATION_ERROR','The model configuration is unavailable.',false);
  const controller=new AbortController();const abort=()=>controller.abort();
  if(outer.aborted)abort();else outer.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,c.budgets.connectTimeoutMs);
  try{
    if(controller.signal.aborted)throw new Error('catalogue aborted');
    const http=await fetcher(`${OPENROUTER_BASE}/models`,{headers:{Authorization:`Bearer ${c.openRouter.apiKey}`},signal:controller.signal});
    if(!http.ok){await http.body?.cancel().catch(()=>undefined);throw new Error('catalogue unavailable');}
    const raw=object(await readJson(http,TRANSPORT_LIMITS.catalogueBytes));
    const entries=Array.isArray(raw.data)?raw.data:[];
    const entry=object(entries.find(v=>object(v).id===c.openRouter.modelId));
    const context=number(entry.context_length,true),output=number(object(entry.top_provider).max_completion_tokens,true);
    const supports=Array.isArray(entry.supported_parameters)&&entry.supported_parameters.includes('max_tokens');
    if(context===null||output===null||context<c.budgets.maxContextTokens||output<c.budgets.maxOutputTokens||!supports)throw new Error('model caps unavailable');
    return {modelId:c.openRouter.modelId,contextTokens:context,outputTokens:output,supportsMaxTokens:true,source:'catalogue'};
  }catch{throw new AppError('CONFIGURATION_ERROR','The configured model limits could not be verified.',false);}
  finally{clearTimeout(timer);outer.removeEventListener('abort',abort);}
}
```

```typescript
// backend/src/model/index.ts
import type { ModelAdapter } from '../contracts/runtime.js';
import type { AccountingRecord } from '../contracts/metadata.js';
import type { MetadataRepository } from '../contracts/repositories.js';
import type { AurvinConfig } from '../platform/config/load-config.js';
import type { ModelLimits } from './policy.js';
import { AccountingService } from './accounting.js';
import { OpenRouterAttemptAdapter } from './openrouter-adapter.js';
export { loadModelLimits } from './catalogue.js';
export type { ModelLimits } from './policy.js';
export { AccountingService } from './accounting.js';
export type AttemptModelAdapter=ModelAdapter & {readonly accounting:AccountingService};
export function createModelServices(config:AurvinConfig,limits:ModelLimits,metadata:Pick<MetadataRepository,'putAccounting'>,fetcher:typeof fetch=fetch,random:()=>number=Math.random){
  const accounting=new AccountingService(config,metadata,fetcher,random);
  return {accounting,createAttemptAdapter:(seed:AccountingRecord,onGenerationId:(id:string)=>Promise<void>):AttemptModelAdapter=>new OpenRouterAttemptAdapter(config,limits,seed,new AccountingService(config,metadata,fetcher,random),onGenerationId,fetcher,random)};
}
```

P9 may wrap these factories in its module providers; P4 must not edit `app.module.ts`. P8 calls catalogue loading once at readiness/startup (or controlled refresh), caches immutable limits, and treats lookup failure as degradation/configuration readiness failure, never paid health inference or process restart loop. Catalogue describes capabilities; it does **not** certify provider-specific privacy/compression enforcement, exact tokenization, or stream billing behavior. P10 records those live limits separately.

- [ ] **Step 4 — Append these readiness regressions, then run green:** `npx vitest run test/model/catalogue.spec.ts`. Then run `npx vitest run test/model`, `npm run build`, `npm run lint`, `npm test` from `backend`. Expected all P4 tests and current baseline pass; route unrelated concurrent-owner failures rather than editing them.

```typescript
afterEach(()=>vi.useRealTimers());
it.each([JSON.stringify({data:[]}),JSON.stringify({data:[{id:'fixture/model'}]}),'x'.repeat(4194305)])('rejects unavailable/missing/oversized catalogue',async body=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(body));await expect(loadModelLimits(config(),new AbortController().signal,f)).rejects.toMatchObject({code:'CONFIGURATION_ERROR'});
});
it('pre-abort/disabled transforms avoid capability fetch, HTTP failure is sanitized',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('{}',{status:503}));const ctrl=new AbortController();ctrl.abort();
  await expect(loadModelLimits(config(),ctrl.signal,f)).rejects.toThrow();expect(f).not.toHaveBeenCalled();
  await expect(loadModelLimits({...config(),openRouter:{...config().openRouter,disableTransforms:false}},new AbortController().signal,f)).rejects.toThrow();expect(f).not.toHaveBeenCalled();
  await expect(loadModelLimits(config(),new AbortController().signal,f)).rejects.toMatchObject({code:'CONFIGURATION_ERROR'});expect(f).toHaveBeenCalledTimes(1);
});
it('times out catalogue connection/body with no paid POST or restart loop',async()=>{
  vi.useFakeTimers();const c={...config(),budgets:{...config().budgets,connectTimeoutMs:5}};
  const f=vi.fn<typeof fetch>().mockImplementation(async(_,init)=>new Promise<Response>((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('private')),{once:true})));
  const result=expect(loadModelLimits(c,new AbortController().signal,f)).rejects.toMatchObject({code:'CONFIGURATION_ERROR'});await vi.advanceTimersByTimeAsync(10);await result;expect(f).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
```
- [ ] **Step 5 — Commit:**

```powershell
git add backend/src/model/catalogue.ts backend/src/model/index.ts backend/test/model/catalogue.spec.ts
git commit -m "feat(p4): export attempt model services and non-inference capability checks"
```

### Task 8: Version evidence, bounded live procedure, and final P4 verification

**Create:** `backend/src/model/README.md` (only P4-owned documentation; do not create P10 evidence or edit workflow state).

- [ ] **Step 1 — Write this complete runbook content.** Replace version/check outcomes with actual worker evidence after execution, not optimistic claims. Keep the fixed scope/bounds/procedure below.

```markdown
# Aurvin model adapter

The adapter uses ChatOpenRouter's public request serializer and an owned raw SSE transport because the pinned high-level stream drops comments, usage-only frames, HTTP-200 errors, and cost. No tools, web search, or implicit compression are enabled. Every POST includes the server identity and one configured model. Keys remain server-only.

## Wiring and lifecycle

P9 calls createModelServices(config, limits, metadata, fetcher). P5 creates a fresh adapter per accepted durable attempt with an AccountingRecord seed (outcome generating, no generation ID) and an awaited onGenerationId callback which durably saves the ID through its repository port. Adapter failure throws AppError; provider end is not application completion. P5 obtains the scoped adapter.accounting.snapshot, puts that bounded record in its saved graph result, awaits checkpoint/archive finalization, overwrites final accounting outcome through adapter.accounting.save, and only then sends application completion. Iterator return aborts fetch; P5 must persist its explicit interruption/cancellation outcome. Each adapter has an isolated accounting helper, so concurrent sessions cannot overwrite each other's transient snapshot.

P5 must not install a LangGraph/LangChain retry around this adapter. Automatic POST retry only follows an explicit 429/503 rejection without generation/visible output. Network ambiguity, timeout, HTTP-200 errors, EOF, partial output, and persistence errors require explicit new-attempt retry. Cancellation is best effort: billing may continue upstream, and an ambiguous request may have incurred cost. The adapter's finite failure cleanup may add up to one persistenceTimeoutMs after totalRunTimeoutMs; it never restarts inference.

Reconciliation receives an existing scoped AccountingRecord; it uses GET /generation only, writes absolute totals, and never infers. MetadataRepository provides no accounting scanner/getter, so global sweep discovery belongs to P5/P8 plus any approved P1/P2 port follow-up. Preserve unknown status when no valid lookup is available. Aggregate records only by unique scoped attempt/generation identity, never by counting puts or summing identical stream frames.

## Limits and readiness

P1 budgets apply: 16,384 context, 2,048 output, 1,024 margin; 80 messages; input 32,000 chars / 8,192 conservative estimated tokens; 65,536 bytes/message. Two dispatch attempts (configuration hard maximum three), 500 ms base full jitter / 5,000 ms cap. Connect 10 s, first output 30 s, idle 20 s, total 180 s, persistence 15 s. Comments reset idle but not first-output/total. P8 owns process/user admission and drain.

Transport bounds: 65,536-byte physical lines/events and JSON lookups; 1 MiB stream; 10,000 frame items; 4 MiB model catalogue; one generation ID; 32,000 visible characters and configured maxMessageBytes. Missing counts/cost are null, not zero. Ignore reasoning fields entirely. Unsupported tools/multimodal/finish reasons and changed generation IDs fail closed.

Non-inference catalogue lookup must prove selected model capacity/output cap and max_tokens support. Conservative UTF-8 context admission is not exact model tokenization; P10 validates the selected model/templates before rollout. No model is certified solely by fixtures or catalogue. Account-level prevention of plugin overrides, logging/retention, and provider privacy restrictions remain P8/P10 release gates.

## Bounded live check (P10 executes only after explicit authorization)

1. Use a separately limited OpenRouter test key and private/local staging. Operator sets an upstream key spending limit no greater than USD 0.10 for the entire smoke run, disables account prompt/output logging and compression/web defaults, confirms request overrides are permitted, and selects one explicit model. No secrets in command lines, transcripts, logs, or committed evidence.
2. Isolate records: unique run ID, user/session/turn/attempt IDs under test-live-<run>, separate test database or namespaced records. Resolve test identity server-side; the browser never supplies user/model. P10 owns setup/cleanup using P2 ports. Do not delete ordinary records or weaken server identity validation.
3. Use at most two chat POSTs, max 128 completion tokens each, total admitted context at most 512 tokens/request. Prompt 1: "Reply with exactly: Aurvin smoke OK". Prompt 2: "Count slowly from 1 to 20" and abort after first visible delta. P10 supplies server test budgets retryMaxAttempts=1, totalRunTimeoutMs=15,000, connectTimeoutMs=5,000, firstOutputTimeoutMs=10,000, idleStreamTimeoutMs=5,000, persistenceTimeoutMs=3,000. Record both as independent attempts. Enforce a 60-second overall harness cutoff including lookups; lookup wall time at most 10 seconds per ID and at most two GET dispatches each (separate bounded lookup policy may use two attempts). If cap/delay fails, stop; do not buy credits or increase limits.
4. Before POST, fetch the selected model catalogue and operator-verified pricing. Compute conservative upper bound: two times (512 * prompt price per token + 128 * completion price per token), including any applicable provider minimum/request charges. Require bound <= USD 0.05 and remaining enforced key budget >= bound; reject unknown pricing/charges. Spend cap USD 0.10 is a ceiling, not a billing guarantee. Abort does not prove charges stop.
5. Capture only outgoing model/user/privacy/compression/cap option fields through an in-process sanitized test observer; never Authorization or message payload. Compare fixture wire assertions with live request. Require transforms [] and context-compression enabled false, no default web/tool execution. Record installed package/lock hash, model ID/provider, model capacities, privacy policy, native tokenizer comparison, timestamps, outcomes, generation IDs, native token totals, reported USD cost and known/pending/unknown status.
6. For each ID run bounded /generation lookup. Compare native tokens/total_cost with absolute stream accounting; true zero allowed, missing remains unknown. Reconcile the same saved record twice and prove one unique accounting identity/absolute cost, not two charges. Keep cancellation outcome even if cost becomes known. A missed ID is unknown, not free.
7. P10 writes actual results in its verification/staging evidence, recording any provider unsupported cancellation, plugin override restriction, tokenizer mismatch, unknown accounting, or spending uncertainty as a gate/limitation. P4 fixtures do not certify live semantics, Azure, proxy, billing exactly once, or production readiness.

## Deterministic checks

From backend: npx vitest run test/model; npm run build; npm run lint; npm test. No test/model suite may access live OpenRouter, a database, real .env, or production payload. Tests use injected fetch and typed metadata fakes. Review is skipped, not passed.
```

- [ ] **Step 2 — Run complete P4 checks:** from `backend`, `npx vitest run test/model`, `npm run build`, `npm run lint`, `npm test`. Expected zero failed P4 assertions, no live requests. Inspect tests for missing assertions/fake-only self-tests. Do not run `test:behavior` as live evidence; P10 owns its implementation/authorization.
- [ ] **Step 3 — Record actual evidence:** append a small worker table in `backend/src/model/README.md` with installed Node/package versions from `node --version` and `npm ls @langchain/openrouter @langchain/core mongodb`, each actual command/date/outcome, capability limitations, and live status **not executed by P4**. Run root `git diff --check`. Report failures honestly; do not widen ownership to fix P1/P2/P3 files.
- [ ] **Step 4 — Check handoff coverage:** use the checklist below; missing assertions are a defect routed to the current P4 worker, not a skipped-review excuse. No state updates by P4.
- [ ] **Step 5 — Commit:**

```powershell
git add backend/src/model/README.md
git commit -m "docs(p4): document bounded live checks and adapter capability evidence"
```

## Acceptance / worker exit checklist

- [ ] AC02/AC11: progressively yielded text with separate comments/usage; pre-stream/HTTP-200 errors, malformed frames, EOF, stop, length, abort, unsupported tool/filter finish, and partial output have explicit non-success behavior. Provider end never creates UI completion.
- [ ] AC13: actual outgoing JSON proves server user and configured model on **every** dispatch, finite output, privacy and both legacy/current compression-disable options; no keys/models/tools/client overrides in stream.
- [ ] AC14: early generation identity is durably reported; scope/model/provider/time/outcome/tokens/cost snapshots are retained once logically; duplicate totals not added; missing cost null; zero valid; native lookup reconciles without POST; distinct retry attempts retain separate accounting.
- [ ] AC15/AC17: context/input/output/transport bounds, finite connect/first/idle/total/persistence deadlines, linked abort/iterator cleanup, jitter/Retry-After, no multiplying retry layer; errors/logs contain no provider text, prompts, keys, reasoning, or database details.
- [ ] P5 can consume unchanged `ModelAdapter` plus local factory, early-ID hook and record-driven accounting service; P8 has non-inference capabilities, redacted AppError taxonomy, and policy/runbook; P10 has deterministic fixture matrix and bounded live procedure.
- [ ] All worker changes within ownership; package/contracts/entry points unchanged. Named staging only and shared-index commits serialized. Actual versions/checks/limitations reported; live smoke, Azure and production readiness not claimed. Unified review **skipped**.

## Planner verification and readiness

This document is a plan, not implemented/tested provider behavior. Document checks cover ownership, locked interface names, dependency readiness, finite numbers, acceptance mapping, code/test references, existing script availability, and skipped-review consistency. Planner does not execute product tests or paid checks.

Planner evidence: all 17 virtual implementation/test files assembled from the TypeScript blocks compile against the installed P1 interfaces and dependencies with TypeScript strict checking, without creating source files or executing tests. Header/placeholder scan has no prohibited matches. Named ownership/commit commands and AC02/AC11/AC13/AC14 coverage were checked. Git whitespace validation passed. This evidence validates the **plan examples**, not the future implementation.

P4 worker is ready after this plan commit and orchestrator dispatch: P1 is complete, dependencies installed, deterministic checks need no Azure service/key/model. Missing selected model/pricing/provider/account privacy configuration blocks **live certification/rollout**, not fixture implementation. P2's unidentified Azure offering remains an independent gate. Global accounting sweeps require an approved discovery port if P5/P8 select that operational design; do not silently add one here.
