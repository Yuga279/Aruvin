---
objective: aurvin-phase-1
workflow: maw
artifact: research-results
date: 2026-10-06
status: baseline-research-complete
r1_status: partially-blocked
r1_date: 2026-10-06
supersedes: docs/research/2026-10-06-phase-1-production-baseline.md
goal: docs/aurvin-phase-1/goal.md
---

# Research Results: Aurvin Phase 1

## 1. Result and evidence boundary

The React/NestJS/LangGraph/OpenRouter/MongoDB approach is suitable for a focused chat foundation if the application owns request lifecycle, archival conversation records, context selection, accounting, and reconciliation explicitly. Framework checkpoints alone do not supply all those guarantees.

This file replaces and consolidates the earlier production-baseline research. It uses the final selected six-collection architecture and reference-based memory. Superseded proposals for three/four/five collections, whole-session transcripts, and duplicate memory content are not current recommendations.

Research was conducted on 6 October 2026 through primary documentation and scaffold inspection during brainstorming. No live inference, Azure configuration inspection, integration compatibility test, crash test, load test, or implementation verification has been performed. This is completed baseline research, with a defined compatibility supplement R1 still required before database work. It is not an implementation-results or test-pass report.

## 2. Existing project

- Frontend: React, Vite, TypeScript; currently a health-status scaffold.
- Backend: NestJS, TypeScript, ESM; currently app/health wiring with environment loading and development CORS.
- Backend scripts include build, unit tests, end-to-end tests, and lint. Frontend scripts include build and lint.
- Agent, chat sessions, MongoDB repositories, model integration, streaming lifecycle, and memory selection are not implemented in inspected source.
- Repository initially had no commits; scaffold files and this research were untracked. Workflow preparation must commit only its documents and preserve application files.
- No AGENTS.md was found in the project or inspected ancestors during context exploration.

## 3. Confirmed decisions and handoff contracts

| Decision | Final direction |
| --- | --- |
| First release | Basic text chat foundation; live tools and advanced memory algorithms deferred |
| Model | One backend-configured OpenRouter model; no UI picker |
| Fixed context | System instructions, behavioral guardrails, and `product_knowledge.md` |
| Session context | Current-session history, plus new input exactly once |
| Answer scope | General questions supported; product knowledge supplies Aurvin background |
| UI | New chat, sidebar sessions, central chat, welcoming empty state, streamed answers |
| Identity | One hardcoded server-resolved development user; no application login |
| Deployment | Local or controlled staging first; public production access undecided |
| Archive | `sessions` metadata plus separate `messages` records |
| Agent memory | References and active context ranges; no transcript copies |
| Execution metadata | Separate `metadata` records; future tools linked to turns/events |
| Checkpoints | Standard MongoDB adapter with `checkpoints` and `checkpoint_writes` |
| Scope authorization | User approved writing goal, consolidated results, and a fully constructed MAW DAG; implementation dispatch not requested in this preparation turn |

The application archive is the durable record of what was said. Memory describes what context is selected. Checkpoints preserve execution state. Metadata preserves attempts, accounting, and future tool evidence. None should silently become a second independently edited transcript authority.

## 4. LangGraph runtime and model integration

LangGraph distinguishes thread-scoped checkpoint state from long-term stores. Compile the graph with a database-backed checkpointer and associate each chat with a stable thread. Normal continuation supplies new input; avoid re-appending restored full history. [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)

The MongoDB adapter has distinct checkpoint and intermediate-write collections. Its package/version and setup behavior must be verified against the selected published releases and Azure service. [MongoDB LangGraph.js integration](https://www.mongodb.com/docs/atlas/ai-integrations/langgraph-js/), [MongoDB saver reference](https://langchain-ai.github.io/langgraphjs/reference/classes/langgraph-checkpoint-mongodb.MongoDBSaver.html)

LangGraph supports sync/async/exit durability modes. Sync persists checkpoints before progressing, with latency trade-offs; evaluate it initially. Replay can re-execute later model or API calls. Neither durability selection nor checkpoint presence guarantees exactly-once external inference or billing. [LangGraph checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)

LangChain supplies a JavaScript `ChatOpenRouter` integration with streaming and usage metadata. Evaluate it behind Aurvin's model adapter; contract-test outgoing identity and request options, generation ID/cost preservation, errors, and abort propagation. A published integration listing is not proof that every field survives a chosen version. [LangChain OpenRouter integration](https://docs.langchain.com/oss/javascript/integrations/chat/openrouter)

Recommended boundaries are identity/configuration, conversation/attempt services, persistence, context selection, graph runtime, model adapter, stream transport, and operations. Keep them within one NestJS service, with explicit interfaces and a small graph.

## 5. MongoDB and Azure compatibility

Native MongoDB has a 16 MiB BSON document limit and discourages unbounded arrays. Separate messages avoid a transcript consuming one ever-growing session document. Memory and attempt records must be bounded too. [MongoDB document limits](https://www.mongodb.com/docs/manual/core/document/), [Unbounded arrays](https://www.mongodb.com/docs/manual/data-modeling/design-antipatterns/unbounded-arrays/)

The user believes the database is Cosmos DB, but billing/service mode is unidentified:

| Offering | Relevant documented distinction |
| --- | --- |
| MongoDB Atlas/native MongoDB hosted on Azure | Native MongoDB document limits and supported deployment semantics apply |
| Azure Cosmos DB for MongoDB, RU-based | Documents may be limited to 2 MB; enabling 16 MB support applies to subsequently created collections. Multi-document transactions are restricted to one unsharded collection; client write concerns do not behave as native MongoDB settings. |
| Azure DocumentDB / MongoDB vCore lineage | Microsoft documents a 16 MB document maximum; verify the actual resource and capabilities separately from RU-based Cosmos DB. |

[Cosmos DB MongoDB feature support](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/feature-support-70), [Azure DocumentDB limits](https://learn.microsoft.com/en-us/azure/documentdb/max-document-size), [MongoDB limits](https://www.mongodb.com/docs/manual/reference/limits/)

R1 must identify service/API/capabilities/partitioning and produce an adapter compatibility matrix before P2 implementation. Do not assume native cross-collection transactions, unique indexes, TTL, or consistency options work identically. Native MongoDB test results alone cannot certify Azure compatibility.

For native MongoDB, single-document updates are atomic and conditional updates can prevent conflicting writes. Cross-document transactions are available on supported replica-set/sharded deployments. A stock graph saver and an external inference request are not automatically members of an application transaction. Keep transactions short and use idempotent reconciliation across graph/application boundaries. [MongoDB atomicity](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/), [Transactions](https://www.mongodb.com/docs/manual/core/transactions/)

Use indexes for user-scoped session listing and ordered message retrieval; uniqueness must match actual service/partition rules. A unique multikey index is not a substitute for deduplicating repeated embedded IDs. [MongoDB unique indexes](https://www.mongodb.com/docs/manual/core/index-unique/)

## 6. Ordering and causal placement

Assign stable event/message IDs, user/session scope, logical turn ID, attempt ID, and backend session sequence. A turn may contain several model steps and tools. Record causal links in addition to sequence; timestamps alone are insufficient to reconstruct relationships.

Future tool records preserve assistant request groups, arguments/results, tool call IDs, outcomes, and bounded payload references where necessary. OpenRouter's message format links results to assistant tool requests using `tool_call_id`. Multiple tools can finish out of order without losing the group relationship. [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling)

The UI reads visible message records; the context builder can combine them with committed metadata when tools are introduced. Reconstruct protocol-valid call/result groups rather than blindly concatenate all event timestamps. Allocation and record persistence must handle crash gaps and uniqueness without relying on unavailable cross-collection transactions.

## 7. Memory and future compaction

The selected initial `agent-memory` design is a bounded manifest of source references/ranges, context version, and active summary pointer (null in Phase 1). It does not copy the transcript or independently accumulate the entire history.

Later compaction selects a completed event boundary, summarizes older material, and retains recent complete interactions. Original conversation and tool evidence remain in their archives. Summary records identify their source coverage, versions, model/prompt, usage, status, and predecessor; the checkpoint references the explicitly activated version. Saving the newest candidate does not itself make it active.

LangGraph demonstrates a summary field alongside recent messages and documents valid tool-call/result pairing when manipulating history. Aurvin must implement candidate validation, budget policy, version-checked activation, and reconciliation. [LangGraph memory](https://docs.langchain.com/oss/javascript/langgraph/add-memory)

An episodic record captures an experience/task with goal, actions, outcome, and provenance. A factual record captures a fact/preference. Neither is merely another name for a session summary. Retrieval is scoped and selective; embeddings are an optional search mechanism. [LangChain memory concepts](https://docs.langchain.com/oss/javascript/concepts/memory)

Keep compaction and episodic extraction deferred while establishing stable IDs, ranges, scope, and versioning. Once compaction exists, reloading the complete raw transcript into every prompt would undo it. Treat derived memories as data, preserve source retrieval, and track correction/supersession because summaries are lossy.

## 8. Streaming and finalization

OpenRouter can fail within a stream after HTTP 200, including before any text. Its final usage frame is separate from text/termination. EOF or HTTP success alone does not prove a successful answer. Cancellation's upstream billing effect depends on provider support. [OpenRouter streaming](https://openrouter.ai/docs/api_reference/streaming)

Required application policy: durably accept input before inference; stream typed application events; await required graph persistence; finalize archive/attempt/context records; then emit completed. Persist bounded partial snapshots if supported. Length-stop, cancellation, interruption, and failure must remain distinguishable from a completed answer.

Recover from a saved final graph result without another model call when application finalization was interrupted. If no durable final result exists, mark interrupted and require explicit retry. Maintain request/attempt identities so finalization and reconciliation are idempotent.

Test streaming through the real staging path. NGINX, for example, enables upstream response buffering by default; configure buffering and timeouts deliberately. [NGINX proxy buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)

## 9. Attribution, accounting, and retries

OpenRouter accepts a stable caller-supplied `user` identifier. Use a backend-resolved internal identifier consistently; a hardcoded ID is one development identity, not authentication or real multi-user attribution. [OpenRouter user tracking](https://openrouter.ai/docs/cookbook/administration/user-tracking)

Record accounting per attempt/generation with correlation IDs, requested/reported model/provider, outcome, time, tokens, cost, and known/pending/unknown status. Capture generation ID early. OpenRouter exposes terminal usage and generation lookup for accounting reconciliation; unavailable usage is not zero. [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)

Use one logical input per request identity, reject changed input using the same identity, and track explicit retry attempts separately. Allow one active attempt per session. Ensure executor ownership covers the supported topology and graph writes; lease expiry without stale-worker protection is insufficient. Do not claim exactly-once billing after an ambiguous external timeout.

LangGraph documents retry policies and version-dependent timeout/error-handling features. Set finite connection/first-output/idle/total/persistence deadlines and one controlled retry policy across layers. Bound retries, backoff, and resources; do not automatically retry invalid requests/keys/credits/context or restart visible partial output silently. [LangGraph fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)

## 10. Context, security, and operations

Version fixed instructions and product knowledge. Build prompts from raw selected state rather than indefinitely storing formatted prompts. Reserve output capacity; verify token/message/storage limits against the actual model. OpenRouter documents context-compression defaults for some small-context endpoints; disable implicit history removal where needed to honor this goal. [OpenRouter message transforms](https://openrouter.ai/docs/guides/features/message-transforms)

Behavioral guardrails cannot enforce ownership or access. Keep credentials outside prompts; enforce authority in backend code; treat model output as untrusted. OWASP identifies prompt injection and improper output handling risks. [OWASP prompt injection](https://github.com/OWASP/www-project-top-10-for-large-language-model-applications/blob/main/2_0_vulns/LLM01_PromptInjection.md), [Output handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/)

Validate request fields, roles, scope, size, and identity/model overrides. Safely render Markdown/links. Use a private staging boundary until production identity is decided. [NestJS validation](https://docs.nestjs.com/application/validation)

Select OpenRouter provider privacy/routing settings deliberately rather than assume uniform retention across providers. [OpenRouter provider selection](https://openrouter.ai/docs/guides/routing/provider-selection)

NestJS supports readiness/liveness checks and shutdown hooks. Validate database/configuration readiness, avoid paid provider health probes, and test graceful and abrupt termination on the actual host. [NestJS health checks](https://docs.nestjs.com/recipes/terminus), [Lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events)

Use correlated logs, tracing, and latency/error/accounting metrics, with payload/secret redaction and bounded labels. OpenTelemetry JavaScript instrumentation is an available vendor-neutral option. [OpenTelemetry instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/)

NestJS throttler's default storage is in memory; multi-replica enforcement needs shared application/platform state. Backups, migration/rollback, retention, and linked restore need explicit owners and evidence. Native MongoDB write-concern errors can leave an ambiguous successful write, so recheck identity before repeating mutations. Azure may use different consistency semantics. [NestJS rate limiting](https://docs.nestjs.com/security/rate-limiting), [MongoDB write concern](https://www.mongodb.com/docs/manual/reference/write-concern/)

## 11. Evidence required from workers

Workers must prove follow-up/restart continuity, session isolation, duplicate prevention, concurrency control, causal reconstruction, HTTP-200 stream failures, abrupt EOF/cancellation/truncation, finalization crash recovery, missing accounting, and budget enforcement. Include real service-compatible persistence tests, safe rendering/redaction tests, staging proxy/shutdown tests, and backup restore.

Use deterministic model fixtures for lifecycle tests and a versioned behavior evaluation set for product knowledge/general chat/follow-ups/capability honesty/adversarial inputs. Small live-model checks supplement rather than replace deterministic tests. Operational numbers must be selected and measured for the chosen model/workload; no invented universal SLOs or cost promises are established here.

## 12. Open gates and MAW handoff

- R1: Identify Azure offering and verify dependency/checkpointer compatibility before persistence implementation.
- P1/P4/P8: Establish finite defaults, model/provider configuration, supported execution topology, and measured staging targets.
- P3: Supply truthful, backend-owned product knowledge and versioned instructions.
- P8: Resolve staging host/access/proxy, privacy, retention, backup, and rollback evidence before release.
- Public production: Decide real identity/access controls and capacity/recovery objectives separately from local/staging acceptance.

Baseline research is complete, not skipped. R1 is a focused implementation compatibility supplement. `state.md` schedules it and the required planner/worker/review/verification stages. This document is the user-requested research artifact and uses MAW's standard `research.md` filename.

## 13. R1 — Azure and published dependency compatibility (2026-10-06)

This section is the R1 supplement. Sections 1–12 remain the baseline and are not superseded. R1 does not purchase infrastructure, change Azure settings, read real `.env` files, or print credentials. No live Azure, Atlas, OpenRouter, or checkpointer integration test was executed.

### 13.1 Certification result

**Selected Azure offering: unknown.** Authorized local configuration and repository documents do not identify the product family, API/wire version, tier, partition/shard keys, consistency, or enabled capabilities. Compatibility is **not certified**. Do not assume native MongoDB semantics or a universal 16 MB document limit.

| Gate | Status |
| --- | --- |
| Service identified | Failed — missing input listed in §13.3 |
| Candidate behavior matrix | Recorded from primary documentation |
| Published dependency strategy for P1 | Viable |
| Persistence assumptions handed to P1/P2 | Recorded |
| AC16 / P2 selected-service certification | Blocked until §13.3 is answered and P2/P10 run selected-service tests |
| P1 planning/implementation | Unblocked (contracts, config, identity, pin published packages) |

### 13.2 Local identification (authorized sources only)

Inspected without reading secrets:

- `README.md`, `AGENTS.md`, `docs/aurvin-phase-1/goal.md`, baseline of this file, `state.md`
- `backend/package.json`, `backend/package-lock.json`, `frontend/package.json`
- `backend/.env.example`, `frontend/.env.example` (no real `.env` files exist)
- `backend/src/*` scaffold (health/CORS only)
- Repository files: no ARM/Bicep/Terraform, no Docker Compose, no Cosmos/DocumentDB/Atlas connection configuration

Findings:

- Backend env example is only `PORT` and `FRONTEND_ORIGIN`. Frontend env example is only `VITE_API_BASE`.
- Current backend runtime dependencies are NestJS 12 / RxJS only. There is no `mongodb`, LangGraph, or OpenRouter package in either manifest.
- Goal/baseline state that the user believes the database is Cosmos DB, without RU versus vCore/DocumentDB, API version, features, or partitioning.
- Local Node is `v24.18.0` (satisfies Nest CLI 12 / Angular DevKit 22 engines Node 22.22.3+, 24.15+, or 26+). README still says Node 20+, which is too loose for the installed Nest toolchain.

No Azure CLI, portal, or live account inspection was performed.

### 13.3 Precise missing input (required before P2 implementation and AC16)

Supply these as non-secret facts (resource names, SKU, API version, partition keys, capability flags). Connection strings belong only in uncommitted local/staging env files.

1. **Product family** (exactly one):
   - Azure Cosmos DB for MongoDB, RU-based (`*.mongo.cosmos.azure.com` / older `*.documents.azure.com`)
   - Azure DocumentDB (formerly Cosmos DB for MongoDB vCore)
   - MongoDB Atlas or other native MongoDB replica set/cluster hosted on Azure
   - Other named offering
2. **API / server version**: Cosmos RU account server version (3.6 / 4.0 / 4.2 / 5.0 / 7.0) or DocumentDB/Atlas wire-protocol version.
3. **Partitioning**: whether each of the six collections is sharded/partitioned; shard/partition key for each; RU logical-partition strategy if applicable.
4. **RU-only capability flags**, if Cosmos RU: `EnableMongo16MBDocumentSupport`, `EnableMongoRetryableWrites`, `EnableTtlOnCustomPath`, `EnableUniqueCompoundNestedDocs`, `EnablePartialUniqueIndex`; backup mode (periodic vs continuous — continuous backup forbids unique indexes on existing collections).
5. **Consistency**: Cosmos default consistency level; DocumentDB/native write concern and read concern intended for Aurvin.
6. **Tier / topology**: RU provisioned vs serverless vs autoscale; DocumentDB cluster tier and physical shard count; native replica-set vs sharded cluster.
7. **Isolated staging target** for P2/P10 `test:azure` (operator-held URI; never commit secrets).

Until (1)–(3) are known, P2 must not claim Azure compatibility and must not create unique indexes or transaction designs that only work on one unidentified topology.

### 13.4 Candidate service behavior matrix

Sources: [MongoDB BSON document limit](https://www.mongodb.com/docs/manual/core/document/), [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/), [MongoDB unique indexes](https://www.mongodb.com/docs/manual/core/index-unique/), [Cosmos DB quotas](https://learn.microsoft.com/en-us/azure/cosmos-db/concepts-limits), [Cosmos MongoDB 7.0 features](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/feature-support-70), [Cosmos MongoDB indexing](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/indexing), [Cosmos consistency](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels), [Cosmos MongoDB consistency mapping](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/consistency-mapping), [Azure DocumentDB limits](https://learn.microsoft.com/en-us/azure/documentdb/limitations), [Azure DocumentDB document size](https://learn.microsoft.com/en-us/azure/documentdb/max-document-size), [Azure DocumentDB vs Atlas](https://learn.microsoft.com/en-us/azure/documentdb/compare-mongodb-atlas), [DocumentDB partitioning](https://learn.microsoft.com/en-us/azure/documentdb/partitioning).

| Capability | Native MongoDB / Atlas | Cosmos DB for MongoDB (RU) | Azure DocumentDB (vCore lineage) |
| --- | --- | --- | --- |
| Document size | 16 MiB BSON | Default **2 MB**; **16 MB only** after `EnableMongo16MBDocumentSupport`, and only for collections created after enablement. Not universal. | 16 MB BSON |
| Multi-document transactions | Yes, across collections/databases/shards on replica set or sharded cluster | **Only inside one unsharded collection**; **not** cross-collection or sharded; **fixed 5 s** timeout | Yes, including across collections and physical shards; **30 s** transaction lifetime |
| Single-document atomicity | Yes | Yes (use this for ownership) | Yes |
| Unique indexes | Yes; on sharded collections unique indexes must include shard key as prefix (except `_id` per-shard) | Yes, but **create on empty collection**; sharded unique indexes **must include shard key as first field**; continuous backup requires unique indexes at collection creation via extension command; nested unique/compound may need `EnableUniqueCompoundNestedDocs` | Unique indexes supported; unique index builds are **foreground and block writes**; wildcard indexes cannot be unique; `_id` value max **2 KB** |
| TTL | Native TTL index on a BSON date field | TTL is Cosmos `_ts` unless `EnableTtlOnCustomPath`; custom path is one field per collection; continuous backup cannot enable custom-path TTL | Not treated as native MongoDB TTL in this research; do not enable checkpoint expiry in Phase 1 |
| Compound / query indexes | Full MongoDB | Single, compound, multikey yes; text/hashed/2d no; sparse/case-insensitive no; partial only for unique | Compound max 32 fields; default 64 indexes/collection (up to 300); index path max 256 B |
| Consistency / write concern | Client write/read concern honored | Client write concern **ignored**; account consistency maps from MongoDB concerns; default Cosmos consistency is Session | Closer to native MongoDB replica-set semantics; still verify on the actual cluster |
| Partition limits | Shard-key uniqueness rules above | Logical partition **20 GB**; 10k RU/s per partition; idle Mongo connections closed ~30 min (set driver idle timeout 2–3 min vs Azure LB 4 min) | Unsharded collection up to 32 TiB; transactions not limited to one logical shard |
| Backup | Deployment-specific | Periodic or continuous; continuous backup changes unique-index rules | Continuous backup / PITR documented; free tier has no backup |

**Unsupported on Cosmos RU that Aurvin must not assume:** cross-collection transactions, sharded multi-document transactions, native write-concern semantics, universal 16 MB documents, unique indexes created after data exists, hashed indexes, saver TTL on `upserted_at` without `EnableTtlOnCustomPath`.

### 13.5 Six-collection implications (until the offering is identified)

Design for the **intersection** of the three candidates: no cross-collection atomicity, documents bounded **well below 2 MB**, uniqueness expressed as compounds that can include a partition key, application reconciliation instead of multi-document commits.

| Collection | Conservative storage rules | Service-sensitive notes |
| --- | --- | --- |
| `sessions` | One bounded metadata document; ownership/version/lease fields live here | Conditional `findOneAndUpdate` is the execution-ownership primitive. If Cosmos-sharded, unique `sessionId` must include the shard key. |
| `messages` | One visible message per document; paginate; no unbounded arrays | Unique identity should be compound `(userId, sessionId, messageId)` or equivalent so a `userId` or `sessionId` partition key can prefix uniqueness. |
| `agent-memory` | Bounded manifest of references/ranges; no transcript copy | Keep well under 2 MB even if 16 MB is later enabled. |
| `metadata` | Bounded attempt/accounting/event records | Dedup by request/attempt identity with conditional writes, not a cross-collection transaction with `messages`. |
| `checkpoints` | Standard saver documents; graph state must stay bounded | Saver `setup()` indexes are **non-unique** `{thread_id, checkpoint_ns, checkpoint_id}`. If Cosmos-sharded, partition by `thread_id`. Bound serialized checkpoint size; do not put the UI transcript in graph state. |
| `checkpoint_writes` | Standard saver pending writes | Same partition-key recommendation as `checkpoints`. Saver `bulkWrite` upserts are not a multi-document ACID transaction with application collections. |

Do not enable MongoDBSaver `ttl`. Goal forbids independently expiring state needed by live sessions. Cosmos RU TTL on `upserted_at` is not equivalent to native MongoDB TTL unless custom-path TTL is enabled.

### 13.6 LangGraph JS MongoDB saver — published setup behavior

Official package: [`@langchain/langgraph-checkpoint-mongodb`](https://www.npmjs.com/package/@langchain/langgraph-checkpoint-mongodb) (not the unrelated community `lablnet` package). MongoDB Atlas documents the same class: [LangGraph.js MongoDB integration](https://www.mongodb.com/docs/atlas/ai-integrations/langgraph-js/). Source inspected: [checkpoint.ts](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/checkpoint-mongodb/src/checkpoint.ts).

Published runtime behavior (v1.4.1):

- Constructor takes a `mongodb` `MongoClient`, optional `dbName`, collection names defaulting to `checkpoints` and `checkpoint_writes`, optional `enableTimestamps` / `ttl`.
- **Call `await checkpointer.setup()`** before use. Docs state this is required the first time.
- `setup()` creates **non-unique** compound indexes `thread_ns_checkpoint_idx` and `thread_ns_checkpoint_task_idx`. It does **not** set `unique: true` (unlike some Python saver examples). Idempotent / `allSettled`.
- `put` is `updateOne` upsert of serialized checkpoint + metadata (`serde.dumpsTyped`). `putWrites` is `bulkWrite` of upserts; empty `writes` is skipped (interrupt/HIL flows).
- No MongoDB multi-document session/transaction wraps `put` and `putWrites` together, and neither is in an application transaction with `sessions` / `messages` / `metadata`.
- Optional TTL indexes `upserted_at` with `expireAfterSeconds`. **Phase 1: leave `ttl` unset.**
- Peer/runtime: `@langchain/core` `^1.1.44`, `@langchain/langgraph-checkpoint` `^1.1.4`, dependency `mongodb` **`^6.21.0`** (does **not** accept MongoDB Node driver 7.x), `engines.node` `>=18`.

Checkpointer compatibility with an unidentified Azure service is therefore: **likely workable for unsharded or `thread_id`-partitioned collections using per-document upserts**, unverified on Cosmos RU (document size, binary BSON, index creation, idle timeouts, ignored write concern) and unverified on DocumentDB. P2 must exercise `setup()`, `put`, `putWrites`, and `getTuple` against the selected service after identification. Native MongoDB tests alone do not certify Cosmos.

### 13.7 Published dependency version strategy (viable for P1)

Observed 2026-10-06 from npm registry latest metadata. P1 pins compatible published releases and re-checks at install time; do not treat these as already added to the repo.

| Package | Latest inspected | Role | Pinning rule for P1 |
| --- | --- | --- | --- |
| `@langchain/langgraph` | 1.4.19 | Graph runtime | `^1.4.19`; peer `@langchain/core` `^1.1.48`, `zod` 3.25.32+ or 4.2.0+; `engines.node` `>=18`; ESM dual package |
| `@langchain/langgraph-checkpoint` | 1.1.5 | Saver contract | Comes in as langgraph dependency; keep aligned with saver peer `^1.1.4` |
| `@langchain/langgraph-checkpoint-mongodb` | 1.4.1 | Standard MongoDB saver | `^1.4.1`; **do not** jump to `mongodb` 7 |
| `@langchain/core` | 1.2.16 | Shared LangChain core | `^1.2.16` (satisfies langgraph `^1.1.48` and openrouter `^1.0.0`); `engines.node` `>=20` |
| `@langchain/openrouter` | 0.4.17 | ChatOpenRouter | `^0.4.17`; `engines.node` `>=20`; ESM; talks to OpenRouter via `fetch` (no `@openrouter/sdk` required for chat) |
| `mongodb` | 7.7.0 latest line; saver requires **6.x** | Driver | **`mongodb@^6.21.0`** (6.x). Driver 7 is a breaking line (`bson` 7, `engines.node` `>=20.19.0`) and is **not** in the saver's `^6.21.0` range |
| `zod` | peer of langgraph | Schema | Add a version matching langgraph's peer |
| `@openrouter/sdk` | 1.4.22 | Optional generation lookup | Not required for ChatOpenRouter; P4 may use REST/`fetch` or this SDK only for accounting lookup. Evaluate behind the application adapter |
| Existing NestJS 12 / React 19 / Vite 8 / TypeScript 6 / Vitest 4 / oxlint | already in manifests | Host stack | Keep; LangGraph/OpenRouter are additive backend dependencies |

Integration notes for P1:

- Backend is ESM (`"type": "module"`, `module`/`moduleResolution` `nodenext`). LangGraph and OpenRouter packages ship ESM+CJS exports — compatible.
- `skipLibCheck: true` is already on. LangChain packages are built with TypeScript 4.9/5.x; consumer TypeScript 6 is acceptable if `npm run build` passes after pinning. That compile check is P1's, not R1's.
- ChatOpenRouter documents streaming, `usage_metadata`, `provider` (including `data_collection`), `transforms`, and a **`user` property**. P4 must contract-test that the backend-resolved identity is present on the **outgoing OpenRouter body**, not only that the class has a field. [ChatOpenRouter docs](https://docs.langchain.com/oss/javascript/integrations/chat/openrouter), [OpenRouter user tracking](https://openrouter.ai/docs/cookbook/administration/user-tracking).
- README Node 20+ should be tightened to the Nest 12 toolchain floor (Node 22.22.3+, 24.15+, or 26+). Local `v24.18.0` is fine.
- Do not add frontend LangGraph/Mongo packages.

### 13.8 Testing environment selection

| Environment | Purpose | Owner | Certifies Azure? |
| --- | --- | --- | --- |
| Deterministic provider/graph fixtures (no DB, no paid model) | Lifecycle, stream errors, identity, UI | P4/P5/P6/P7/P10 | No |
| Native MongoDB replica set (local/CI, driver 6.x) | Fast repositories, indexes, pagination, conditional ownership, saver `setup`/`put`/`getTuple` | P2 | **No** |
| Selected-service staging (`npm run test:azure`, isolated credentials) | Document size, unique-index rules, ignored write concern, idle timeouts, saver on real API, partition keys | P2 implements; P10 records AC16 | **Only this** (after §13.3) |
| Bounded live OpenRouter smoke | Identity `user` field, usage frames, one configured model | P4/P10 | N/A (model, not DB) |

P8/P10 still need staging proxy, backup/restore, and drain evidence after the service is known. A local native MongoDB success is not production or Cosmos evidence.

### 13.9 Execution ownership feasibility

- A process-local mutex is insufficient for multiple backend replicas (goal AC09).
- Cosmos RU cannot fence ownership with a cross-collection transaction. Use **single-document conditional updates** on `sessions` (version/lease/owner). Lease expiry without fencing is insufficient; until multi-replica fencing is demonstrated, **enforce single-executor topology**.
- DocumentDB and native MongoDB can run short cross-collection transactions, but graph saver writes and OpenRouter inference **must not** join that transaction. Prefer the same idempotent ownership primitive on all services.
- Saver `put` / `putWrites` are separate upserts; crash between them is a P5 reconciliation concern, not a DB transaction.

### 13.10 Handoff assumptions

**P1 may proceed now:**

- Pin the §13.7 matrix; add `zod`; keep ESM/nodenext; document Node engine floor.
- Versioned contracts for session/message/memory/metadata/attempt/stream plus a **persistence profile enum** (`unknown` \| `native-mongodb` \| `cosmos-mongodb-ru` \| `azure-documentdb`) with document-headroom default **< 2 MB** until the selected service proves 16 MB.
- Server identity resolver; OpenRouter `user` is backend-owned.
- `.env.example` placeholders for Mongo URI / db name / OpenRouter key **without values**.
- Scripts: keep existing build/lint/test; add planned `test:azure` name only as a stub contract if needed — do not report it passing.

**P2 remains gated on §13.3 for selected-service work, but can plan against these rules:**

- Six collections; bounded records; no transcript arrays on `sessions`.
- No cross-collection transaction design.
- Ownership via conditional single-document updates on `sessions`.
- Idempotent writes + reconciliation across archive, metadata, and checkpoints.
- Unique indexes only after partition keys are known; compounds include the partition key on Cosmos RU.
- Standard saver with explicit `setup()`; collection names `checkpoints` / `checkpoint_writes`; **no saver TTL**.
- Validate payload size against the conservative 2 MB ceiling (or confirmed limit).
- Native MongoDB tests first; selected-service tests after identification.
- Cosmos RU: driver idle timeout 2–3 minutes; do not trust client write concern; confirm 16 MB flag before storing documents > 2 MB.

**P4:** ChatOpenRouter behind Aurvin's adapter; contract-test outgoing `user`, model, `transforms`/compression, abort, generation id, usage/cost. Do not assume every documented field survives the pinned version without a fixture.

**Unresolved compatibility gate (keep explicit):** selected Azure product/API/tier/partitioning/capabilities unknown; AC16 not closed; P2 must not certify Cosmos or DocumentDB behavior from documentation or native MongoDB tests alone.

### 13.11 R1 exit-gate status

**Partially blocked.**

- Passed: candidate matrix, saver setup behavior, published dependency strategy, testing-environment selection, P1/P2 handoff assumptions, conservative no-cross-collection / sub-2 MB / no-saver-TTL rules.
- Blocker: §13.3 missing input. Service not identified from authorized local configuration. Compatibility **not certified**.
- P1: ready.
- P2 implementation of selected-service adapters/indexes/transactions: **not ready** until the offering is identified; planning may use the conservative intersection above.
