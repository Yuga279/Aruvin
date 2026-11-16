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

## P4 worker evidence (2026-10-06)

Installed runtime and packages from `backend`:

| Item | Value |
| --- | --- |
| Node | v24.18.0 |
| `@langchain/openrouter` | 0.4.17 |
| `@langchain/core` | 1.2.16 |
| `mongodb` | 6.21.0 (not used by P4) |

Deterministic checks, also from `backend`:

| Command | Date | Outcome |
| --- | --- | --- |
| `npx vitest run test/model` | 2026-10-06 | Pass: 7 files, 109 tests |
| `npm run build` | 2026-10-06 | Pass (`nest build`) |
| `npm run lint` | 2026-10-06 | Pass with warnings: `no-useless-spread` in `deadlines.ts`; `no-base-to-string` on `finish_reason` and `String(fetch mock args)` in adapter/accounting tests. No lint errors. |
| `npm test` | 2026-10-06 | Pass: 33 files, 238 tests (P4 plus existing baseline). No live OpenRouter, database, or `.env` access in `test/model`. |
| `git diff --check` | 2026-10-06 | Clean |

Limitations (not certified by this worker):

- No model is selected or live-certified. Catalogue fixtures prove the readiness gate, not provider privacy/compression enforcement or exact tokenization.
- Conservative UTF-8 context admission is not native model token accounting; P10 must validate the selected tokenizer/templates before rollout.
- Live smoke, Azure compatibility, proxy streaming, and production readiness were **not executed by P4**.
- Automatic provider retry is only definitive pre-stream HTTP 429/503 without generation ID or visible text. Cancellation does not prove charges stop.
- Unified review is **skipped**, not passed.

Worker commits: `15e4461`, `efa30a4`, `e634d87`, `410a0c6`, `f5ea4bf`, `e2a5513`, `7852dcf`, plus this documentation commit. Ownership stayed in `backend/src/model/**`, `backend/test/fixtures/openrouter/**`, and `backend/test/model/**`.

