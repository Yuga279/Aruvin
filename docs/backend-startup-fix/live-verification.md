# Final live diagnostic startup verification

**Passed — diagnostic startup, durable archive reads, Vite proxy and graceful release only.** Recorded 7 October 2026, 11:25:16–11:25:40 UTC, against P1 `2ac57e7` and P2 `2f3a221`. Windows, Node `v24.18.0`; existing compiled P1 build used. Unified review: **skipped**, not passed.

## Startup modes and safety boundary

Foreground command from `backend/`:

```powershell
node "C:/Users/Peter/AppData/Local/Temp/opencode/aurvin-final-live-verification.mjs"
```

The temporary verifier spawned the actual processes directly with `child_process.spawn(process.execPath, args, options)`, without a shell or watch supervisor:

| Process | Working directory | Arguments / environment |
| --- | --- | --- |
| Empty-environment proof child | `backend/` | Node `--input-type=module --eval` assertions before and after `process.loadEnvFile('.env')`. |
| Backend | `backend/` | `node dist/main.js`; `PORT=8001`, `FRONTEND_ORIGIN=http://127.0.0.1:5179`; IPC channel via `stdio: ['ignore','pipe','pipe','ipc']`. |
| Vite | `frontend/` | `node node_modules/vite/bin/vite.js --host 127.0.0.1 --strictPort`; `BACKEND_PROXY_TARGET=http://127.0.0.1:8001`, `FRONTEND_PORT=5179`. |

Both `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` were explicitly present as empty **strings** in the backend child environment. Actual child assertions verified that Node preserved those empty values before and after loading the real backend `.env`. No `cmd set KEY=` was used. The backend's normal compiled entry loaded `.env` from its backend working directory. Existing `PERSISTENCE_PROFILE=unknown` was verified and preserved; no admission/profile override was supplied.

The normal application persistence composition and owner claim/release ran; generation initialization remained disabled by the empty provider values. No chat submission, model catalogue lookup or inference was requested. No `.env`, source, application transcript/execution data, reference/S1 data or provisioning changes were made. Private configuration, URIs, credentials, owner identifiers and raw child/driver logs were not emitted. The temporary verifier is outside the checkout and is not a commit artifact.

## Actual assertions

| UTC time | Assertion and result |
| --- | --- |
| 11:25:16 | **Passed:** no listeners on 8001 or 5179 before startup; spawned Node environment proof passed. |
| 11:25:19 | **Passed:** private, read-only application-scoped counts showed all five data collections empty, metadata count zero and no executor sentinel. |
| 11:25:35 | **Passed:** direct `GET http://127.0.0.1:8001/api/operations/live` returned 200 with `{ live: true }`. |
| 11:25:35 | **Passed:** direct `GET /api/operations/ready` returned the expected **503**, `readReady=true`, `acceptReady=false`; issues included `configuration`, `model_limits` and `runtime`. This is diagnostic/archive availability, not generation readiness. |
| 11:25:35 | **Passed:** direct `GET /api/sessions` returned 200 with `{ items: [], nextCursor: null }`; private read-only checks confirmed exactly one schema-valid normally claimed executor and still-empty data. |
| 11:25:37 | **Passed:** Vite `GET /` returned 200 and the frontend entry; proxy `GET /api/operations/live` and `GET /api/sessions` returned 200 with bodies equal to the direct backend responses. Listener ownership matched the two spawned children. |
| 11:25:37 | **Passed:** stopped only the verifier's Vite process and awaited its exit. |
| 11:25:38 | **Passed:** backend received IPC string `shutdown`, performed normal application close and exited **code 0**, no signal or force termination. |
| 11:25:39 | **Passed:** private scoped read-back confirmed executor count zero and metadata count zero after normal release. All five data collections remained empty; index metadata matched the pre-start snapshot. No manual sentinel deletion/recovery was performed by this verification. |
| 11:25:40 | **Passed:** both owned children had exited, ports 8001/5179 had no listeners, verification client closed and `.env` bytes matched the pre-run hash. Verifier exited 0. |

HTTP calls had finite deadlines, each listener startup had a 60-second ceiling, owned Vite exit had a 15-second ceiling, backend graceful exit had a 45-second ceiling, and database read operations had finite driver/server limits. No deadline-triggered backend kill occurred. Total observed successful lifecycle was approximately 24 seconds.

## Limitations and handoff

- This proves real compiled entry startup and real Vite HTTP proxy/archive behavior after the separately evidenced P2 ownership restoration. It does not prove browser rendering, streamed generation or chat acceptance; none was exercised.
- Unknown actual Azure tier, physical shards/partition rules and remaining service facts still block full certification/admission. Successful archive access and owner release do not establish native MongoDB equivalence, HA, backup/PITR, production readiness or Azure certification. The unchanged full-facts gate remains fail-closed.
- Builds and regression suites were already reported by the owning workers; they were not repeated or reclassified by this live probe. Readiness 503 is **expected**, not a failed startup or a passed chat readiness check.
- Evidence is uncommitted for orchestrator serialization. No implementation files were changed and no files were staged or committed by this worker.
