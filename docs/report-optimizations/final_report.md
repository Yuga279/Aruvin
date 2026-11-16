# Final report: validated diagnostic-report optimizations

## Outcome

The diagnostic report identified four real optimization areas, but its savings figures and some root-cause claims were overstated. All four were implemented with focused regression tests: three backend changes in this session, and the frontend delta batching supplied by the user's parallel session and verified and committed here.

## Validity assessment

| Opportunity | Verdict | What was actually done | Claim boundary |
| --- | --- | --- | --- |
| O1 stable response-mode prefix | Valid core | Selector moved directly after fixed assets; system instructions and selector assertions updated; multi-turn and mode-switch tests added | Adjacent turns already shared prefixes, so "zero history can ever be cached" was false. No provider cache-hit or TTFT measurement was made. |
| O2 Anthropic prompt caching | Valid, conditional | Top-level `cache_control: { type: 'ephemeral' }` added to shared provider parameters for configured `anthropic/*` models, covering text and calendar dispatch | OpenRouter's automatic caching advances its breakpoint; savings depend on write premiums, thresholds, expiry, routing, and actual reuse. No live request was made. |
| O3 batch transcript acceptance checks | Valid, narrower | Sequential per-record metadata lookup replaced with one bounded batch query for internal user candidates; exact user/session/message/turn matching retained | Only transcript pages containing internal user records performed the N lookups. No index was added and remote latency was not measured. |
| O4 batched UI deltas | Valid core | `StreamDeltaCoalescer` buffers deltas and flushes once per animation frame with a bounded timer fallback; flushes before non-delta/terminal events; discards stale text on new chat/session/cancel. Submit and retry share the path. | Report's "incremental Markdown parsing" proposal was not adopted because no correctness strategy or measurement justified it. No browser FPS measurement was made. |

## Commits

| Commit | Scope |
| --- | --- |
| `ef21b4d` | O1 context order, system instructions, affected assertions, new prefix tests |
| `0731af7` | O2 Anthropic cache serialization and dedicated text/calendar tests |
| `1331226` | O3 batched acceptance verification and dedicated persistence tests |
| `4a3f2ac` | Reconcile dirty adapter and native isolation assertions with the leading selector |
| `dfa7cc2` | O4 presentation-boundary delta coalescing and 18 dedicated tests |

## Verification

- O1 focused suites: 6 files, 54 tests passed.
- O2 and O3 dedicated suites: 2 files, 31 tests passed.
- Reconciled adapter suite: 45 tests passed.
- Backend build: passed.
- Backend lint: exit 0; existing warnings only.
- Backend e2e: 22 passed, 135 skipped (native prerequisites absent), 0 failed.
- Frontend build: passed, with the existing >500 kB chunk warning.
- Frontend lint: exit 0; existing warnings only.
- O4 dedicated tests: 18 passed.
- Frontend tests: 513 passed across 70 files.
- Full backend unit suite: 2331 passed, 10 skipped, 16 failed. The failures are outside O1-O3: 15 acceptance-target assertions in the pre-existing dirty `backend/test/performance/durable-latency.spec.ts`, and the tracked `backend/test/assembly/calendar-simplification.built.spec.ts`, which also failed when run alone. Neither failure touches the model policy, context ordering, or transcript paging changes.

## Limitations

- No paid provider calls, live cache-hit inspection, TTFT benchmark, remote MongoDB measurement, browser FPS profile, Azure verification, or deployment was performed.
- Request-shape tests prove what Aurvin sends, not that a provider served a prefix from cache.
- O4's Node tests cover coalescer and hook cancellation semantics; the React unmount effect is type-checked but not DOM-tested because the frontend test environment has no DOM.
- Existing user changes in calendar/runtime/performance files, plus `backend/src/model/openrouter-adapter.ts` and the remaining working-tree portion of `backend/test/model/adapter.spec.ts`, were preserved and not committed as this task's work.
- Unified review was skipped under the repository instruction and is not claimed as passed.
