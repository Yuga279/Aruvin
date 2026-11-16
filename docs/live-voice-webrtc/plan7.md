# Operations, Security Procedures, and Rollback (P7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a small, executable operations runbook and correct existing setup/deployment guidance for P5's live-only LiveKit cutover, without enabling services or claiming unobserved readiness.

**Architecture:** Documentation describes the existing single-process Aurvin runtime and its in-process media bridge; LiveKit is separate signaling/media infrastructure, not another conversation engine. Reuse existing settings, operations shutdown, retention, and staging procedures; add no auth system, deployment automation, health probe, or fallback transport. Separate official transport requirements, source-backed Aurvin behavior, operator decisions, and actual P8 evidence.

**Tech Stack:** Markdown, backend env/bootstrap configuration, existing NGINX examples, PowerShell and Node built-ins for offline document/config checks. No new dependencies or infrastructure.

---

## Boundaries and prerequisites

- This is **P7 only**. Worker starts only after this plan is committed and P5 implementation/tests/commits are complete, not merely because `plan5.md` exists. Load `executing-plans`; use documentation red/green checks below, not application changes. No nested agents needed. Unified review remains **skipped**, never passed.
- Planner read fully: root `AGENTS.md`, `goal.md`, `research.md`, `state.md`, `plan5.md`, root `README.md`, backend/frontend env examples, all four existing deployment files, and the benchmark README (read-only). There is **no root `.env.example`**; do not create one. No more-specific `AGENTS.md` was found.
- Planner inspected current bootstrap/voice parsing, scoped admission implementation, wire constants and old voice runbook read-only. P5 is still pending in the supplied state; all assembly behavior below is **intended**, not newly verified. Worker must compare P5's committed result and handoff before describing it as implemented. If it differs, stop the affected task and return the exact discrepancy to the orchestrator/P5 owner; do not repair source or silently rewrite constraints.
- Planner ran **no Git commands, application tests, SFU/provider connections, provisioning, browser/device tests, or paid checks**. Only this plan is written, uncommitted. Future commands below are not planner results.
- Worker must preserve `.openchamber/`, private `.env`, unrelated work and retained baseline evidence. Never read/print credentials or stage whole directories. Serialize named-file staging/commits through the orchestrator. This plan does not authorize enabling flags, installing/starting a LiveKit server, contacting a Cloud project, probing networks, restarting an application, or activating a gateway.
- Never modify `backend/src/benchmark/**`, `backend/test/benchmark/**`, `docs/voice-latency-benchmark/**`, baseline/raw results, application source/tests, manifests, workflow state/plans or P8 evidence. Existing old voice operations remain read-only: explicitly scope the new runbook as superseding their **live transport/readiness/drain** paragraphs, not their unchanged dictation/accounting policy.

## File map (before tasks)

Create only:

- `docs/live-voice-webrtc/operations.md`: current live transport/security/setup requirements, passive status, drain, privacy/cost limitations, rollback, unrun drill inventory, P8 handoff, sources and one copy-pastable offline consistency check.

Modify minimally:

- `README.md`: configuration table/exception, voice routing, live prerequisites, staging warning, evidence limitations and link to new runbook; retain unrelated setup/Calendar/text instructions.
- `backend/.env.example`: three **blank** LiveKit bootstrap settings plus private-handling/restart/config-validation comments; no manageable voice flags or copied credentials.
- `deployment/staging/README.md`: dictation-only socket and separate authorized LiveKit reachability/access warning; link to runbook.
- `deployment/staging/nginx.conf`: comment immediately above `location = /api/voice` explaining dictation-only scope and link/path to runbook; **no directive change**.
- `deployment/render/nginx.conf.template`: correct header/socket comments and warn that this example has no app access boundary and does not carry LiveKit media; **no directive change**.

Read-only deployment file: `deployment/render/entrypoint.sh`. Do not edit launch/signal behavior, add an SFU sidecar, expose a port, insert auth directives, or introduce a new Render guide. Header updates are comments only; the existing staging config need not gain a large header for this tiny edit.

## P5 interface contract consumed by P7

1. Existing `AppService` owns the one `VoiceSessionService`, runtime and lazy bridge; OperationsService remains the only persistence-close owner. Live POST admission connects the backend bridge before returning the scoped browser descriptor; paid speech opening waits for valid Room `session.start`. No second runtime or automatic inference retry.
2. Browser live audio and reliable controls use one LiveKit Room (`aurvin.voice.control`); `/api/voice` is **dictation-only**. A transitional `websocketUrl` field in a live response is not fallback permission. Dictation retains its cookie/PCM WebSocket and text remains HTTP/SSE.
3. `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` are **bootstrap-only** server environment, not MongoDB manageable settings, an import-only legacy value, or a Manage Aurvin credential card. They require a controlled restart to change. Manage Aurvin still controls live/dictation flags, Deepgram credential/region and quotas. Existing sessions keep their snapshot; a settings save does not terminate them.
4. All three LiveKit values blank is valid absent config: live unavailable/POST 503 `VOICE_DISABLED`, configured dictation/text remain admitted. Partial/malformed values fail startup even if live is off. Non-production `ws://` is accepted only for parser-recognized loopback; production requires `wss://`. URL must satisfy the current root-only signaling URL parser (no embedded credentials, query, fragment or path); do not invent an endpoint.
5. Browser receives `livekit: { url, roomName, participantIdentity, participantToken }` after normal origin/identity/quota/reservation admission. Room `aurvin-live-${sessionId}`, browser identity `${userId}:${sessionId}:${connectionEpoch}`, agent `aurvin-agent:${sessionId}`. Browser grant joins one room, publishes microphone only, subscribes and sends data, with no admin/list/create/record grant. Agent token/key/secret never leave backend. TTL is `ceil(clamp(connectMs, 1000, 30000) / 1000)` seconds, not a fixed 30-second session duration.
6. Passive `speech`: `off` neither requested; `unconfigured` any requested mode lacks Deepgram or requested live lacks LiveKit; otherwise `degraded` on observed speech/LiveKit failure, else `ready`. Missing LiveKit may aggregate to unconfigured while dictation still works. `/api/operations/ready` HTTP status/`acceptReady` remain text-controlled; liveness is not readiness. No SFU/provider calls, token signing, ICE or TURN probe on health. LiveKit degradation clears on a subsequent successful bridge connection, not on a polling timer; speech faults remain independent.
7. Shutdown synchronously stops voice admission and starts voice/runtime drains concurrently under the existing shared deadline; close persistence once only after all required drains succeed. Intended default `shutdownDrainMs` is 20000 ms, external supervisor bound 45 seconds; copy actual committed values if changed. Windows uses validated Ctrl-C/awaited supervisor IPC, not assumed SIGTERM. Failed/hung durable cleanup is unsafe, retains ownership/sentinel, and cannot be called cancelled merely because a timeout returned.
8. Session end/expiry/drain actively dispose local bridge/providers and attempt bounded remote room deletion; stale epoch eviction is separate. `LIVEKIT_TEARDOWN_TIMEOUT_MS=2000` is a best-effort bound, **not evidence that remote removal succeeded**. No RTC process-global teardown; no manual sentinel deletion, overlapping executors or prompt replay.
9. No automatic live-WebSocket fallback/flag exists. Same-release rollback is Manage Aurvin live-mode off, end/drain existing sessions, keep dictation/text. Older-build rollback requires a separately retained compatible full release and explicit stopped-work/data-compatibility procedure.
10. P5 H1–H4 owner handoffs must have actual outcomes. H5/P4 browser progress/stale-jitter-buffer limitations remain evidence-sensitive: published/queued audio, SDK state or elapsed-time ACK is not acoustic proof. Do not claim that fixture completion proves hearing or interruption-stop latency.

Source-backed constants at planning: `DEFAULT_VOICE_LIMITS.connectMs=10000`, `reconnectMs=10000` (not research's illustrative 15000), `liveMaxMs=1200000`, input/output queue 1000/2000 ms; token maximum 30000 ms; teardown 2000 ms. Effective snapshots may be tighter. Never instruct the operator to edit legacy `VOICE_*` env values to change manageable settings.

## Official-source ledger (read-only lookup, 6 November 2026)

Use these direct links in `operations.md`, with retrieval date and the distinction **official requirement / Aurvin implementation / unverified operator environment**. Context7 library `/websites/livekit_io` supplied current LiveKit pages; deployment and MDN were also fetched directly. Documentation retrieval is not an SFU connection or service validation.

- **S1:** [Self-hosted ports/firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/): 7880 signaling/API behind TLS termination; ICE/UDP 50000–60000 or configured mux 7882, ICE/TCP 7881; optional TURN/UDP 3478; TURN/TLS default 5349 behind suitable L4 mapping, otherwise advertised listener 443.
- **S2:** [Self-hosted deployment](https://docs.livekit.io/transport/self-hosting/deployment/): trusted signaling certificate/domain; separate TURN domain/certificate; UDP/public candidate reachability; TURN/TLS and L4 balancing, not an HTTP location that magically relays UDP. Do not copy production YAML or create infrastructure in P7.
- **S3:** [Connection reliability](https://docs.livekit.io/intro/basics/connect/): UDP, TURN/UDP, ICE/TCP and TURN/TLS options; Cloud supplies managed TURN, self-hosted TURN needs configuration/certificate. Support does not guarantee success on a particular VPN/firewall.
- **S4:** [Cloud firewall guidance](https://docs.livekit.io/deploy/admin/firewall/): current outbound Cloud signaling/TURN domains and ports. Link instead of freezing a large changing host allowlist; these are provider requirements, not selected project endpoints or authorization to allow traffic.
- **S5:** [Tokens and grants](https://docs.livekit.io/frontends/reference/tokens-grants/): expiry affects initial connection, not an existing connection or all subsequent reconnects; SDK/server token refresh exists. Self-hosted removal/permission change does not invalidate an existing token. Cloud has different revocation rules/cutoffs; do not claim P2 implements every current Cloud revocation option.
- **S6:** [RoomService API](https://docs.livekit.io/reference/other/roomservice-api/): remove participant/delete room management. Local bounded best-effort deletion is not guaranteed remote revocation or guaranteed prevention of rejoin/billing.
- **S7:** [Region pinning](https://docs.livekit.io/deploy/admin/regions/region-pinning/) and [observability data residency](https://docs.livekit.io/testing/observability/data-residency/): routing and stored project-data region are distinct, and require actual project configuration/feature availability confirmation. Do not infer residency from a URL or Deepgram region, or promise zero retention by every service.
- **S8:** [JS SDK audio playback](https://docs.livekit.io/reference/client-sdk-js/): autoplay may require a user click/tap invoking `startAudio`; connected/subscribed is not audible.
- **S9:** [MDN getUserMedia security](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security): microphone permission and secure context; localhost development exception is not permission to use remote plaintext HTTP. No bypass-certificate/browser-security flags.

Research §8's US-East choice, fixed RTT multiplier, dollar prices, free-tier quantities, unlimited/free transport and estimated run cost are **not selected/verified operating facts**. Do not propagate them. Recommend measuring co-location of bridge/SFU near approved users/providers, record actual regions only after operator selection, and leave hosting choice and costs unknown until approved account-specific evidence exists.

## Offline red/green check used by every task

Use one temporary PowerShell function in the worker terminal, from repository root. It reads only public task docs/examples/source, never `.env`, never starts services and never uses the network. Preserve the same function verbatim in `operations.md` under `## Offline consistency check` during Task 5 so a runnable check remains. These checks enforce documented invariants/links; they do **not** execute or certify deployment behavior.

```powershell
$P7Check = @'
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(p, 'utf8');
const opsPath = 'docs/live-voice-webrtc/operations.md';
const ops = fs.existsSync(opsPath) ? read(opsPath) : '';
const stage = process.argv[1];
const need = (text, values) => values.forEach(v => assert.ok(text.includes(v), `Missing: ${v}`));
const checks = {
  security() {
    need(ops, ['## Access and credentials', 'bootstrap-only', 'LIVEKIT_URL',
      'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'microphone-only',
      'not application authentication', 'self-hosted', 'token expiry',
      'No unauthenticated public voice', 'https://docs.livekit.io/frontends/reference/tokens-grants/']);
  },
  network() {
    need(ops, ['## Network and placement', '50000', '60000', '7882', '7881',
      '3478', '5349', '443', 'TURN/TLS', 'L4', 'secure context', 'startAudio',
      'not selected', 'https://docs.livekit.io/transport/self-hosting/ports-firewall/',
      'https://docs.livekit.io/deploy/admin/firewall/']);
  },
  lifecycle() {
    need(ops, ['## Passive readiness and drain', 'acceptReady', 'unconfigured',
      'degraded', 'concurrently', 'unsafe', 'best-effort',
      '## Retention and cost', 'unknown', '## Rollback',
      'no automatic live-WebSocket fallback', 'existing sessions', 'compatible full release']);
  },
  setup() {
    const env = read('backend/.env.example');
    const source = read('backend/src/platform/config/bootstrap-config.ts');
    const declaration = source.match(/LIVEKIT_BOOTSTRAP_ENV_NAMES\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(declaration, 'LiveKit bootstrap declaration missing');
    const names = [...declaration[1].matchAll(/'(LIVEKIT_[A-Z_]+)'/g)].map(m => m[1]).sort();
    assert.deepEqual(names, ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_URL']);
    for (const name of names) {
      const lines = env.split(/\r?\n/).filter(l => l.startsWith(name + '='));
      assert.deepEqual(lines, [name + '='], `Example must have one blank ${name}`);
    }
    const root = read('README.md');
    const staging = read('deployment/staging/README.md');
    need(root, ['docs/live-voice-webrtc/operations.md', 'bootstrap-only', 'dictation-only']);
    need(staging, ['../../docs/live-voice-webrtc/operations.md', 'dictation-only']);
    for (const p of ['deployment/staging/nginx.conf', 'deployment/render/nginx.conf.template']) {
      const text = read(p);
      need(text, ['dictation-only', 'LiveKit', 'location = /api/voice']);
      assert.ok(!/^\s*[^#\r\n]*\b(?:listen|proxy_pass)\s+[^;]*(?:7880|7881|7882|3478|5349)/m.test(text),
        'Do not add SFU listeners/upstreams to app HTTP examples');
    }
    assert.ok(!/Deepgram Live Voice and Dictation/.test(read('deployment/render/nginx.conf.template')));
    assert.ok(!/Do not enable the live flag until the P5 warning follow-up lands/.test(root),
      'Reconcile historical warning with actual P5 handoff');
  },
  evidence() {
    need(ops, ['## Authorization and evidence', 'UNRUN', 'P8', 'authorization',
      'audible', 'interruption', 'jitter', 'loss', 'TURN', 'rollback',
      'participant-minutes', 'not an invoice cap', '## Offline consistency check']);
    for (const line of ops.split(/\r?\n/).filter(l => /^\| D[0-9]+ \|/.test(l))) {
      assert.ok(/\| UNRUN \|/.test(line), 'Only P8 may replace unrun drills with evidence');
    }
    assert.ok(ops.split(/\r?\n/).filter(l => /^\| D[0-9]+ \|/.test(l)).length >= 8,
      'Missing finite operational drill inventory');
    for (const file of [opsPath, 'README.md', 'deployment/staging/README.md']) {
      const text = read(file).replace(/```[\s\S]*?```/g, '');
      const links = [...text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)].map(m => m[1]);
      for (const link of links.filter(l => !/^(?:https?:|mailto:|#)/.test(l))) {
        const target = path.resolve(path.dirname(file), decodeURIComponent(link.split('#')[0]));
        assert.ok(fs.existsSync(target), `${file}: missing link ${link}`);
      }
    }
  },
};
assert.ok(stage === 'all' || Object.hasOwn(checks, stage), 'Unknown check stage');
for (const key of stage === 'all' ? Object.keys(checks) : [stage]) checks[key]();
console.log(`P7 ${stage}: PASS (offline documentation consistency only)`);
'@
function Test-P7Docs([string]$Stage) {
  node -e $P7Check $Stage
  if ($LASTEXITCODE -ne 0) { throw "P7 $Stage failed" }
}
```

At worker start also capture normalized NGINX directives before comment edits (no file written):

```powershell
$P7NginxBefore = @{}
foreach ($p in @('deployment/staging/nginx.conf', 'deployment/render/nginx.conf.template')) {
  $P7NginxBefore[$p] = ((Get-Content -LiteralPath $p | Where-Object { $_ -notmatch '^\s*(#|$)' }) -join "`n")
}
```

## Task 1: Establish scoped access and private bootstrap setup

**Files:** create `docs/live-voice-webrtc/operations.md` only.

- [ ] **1. Red:** initialize the function above and run `Test-P7Docs security`. Expected failure: missing access section/runbook. If prior user work already supplies it, preserve it and report an already-green guard; never delete content to manufacture red.
- [ ] **2. Create the title and scope paragraph:** `# Live voice WebRTC operations`. State this is procedure, not service/browser certification; one executor/runtime; dictation/text unchanged; current live transport sections supersede historical live-WS directions in `../voice-modes/operations.md`. Add working links to `goal.md`, `state.md`, root `../../README.md`, `../voice-modes/operations.md` and `../aurvin-phase-1/operations.md`.
- [ ] **3. Add `## Access and credentials`** with the P5 contract's exact three bootstrap names, all-blank/partial/production rules and controlled-restart distinction. Explain private backend environment inherited by the existing launcher or private local `.env`; storage mechanism beyond this remains operator-selected, not a new secret manager. Never overwrite a private file, read values into diagnostics, put credentials in arguments, UI, `VITE_*`, source, screenshots or benchmark config. `LIVEKIT_URL` is delivered to an admitted browser and must be reachable there; keys/secret and agent token are server-only.
- [ ] **4. Add this required security prose**, retaining its substance and key check phrases:

  > No unauthenticated public voice. The shared server development identity, CORS, scoped LiveKit token and staging basic-auth example are not application authentication. Keep UI, config/admin and session/token REST routes inside the approved loopback/access-controlled boundary. LiveKit media access uses a backend-issued room/participant/epoch-bound token with microphone-only publish, subscribe and data permissions, not the app gateway password. Never send the server API key/secret or agent token to the browser. Treat the browser token as a bearer secret: in-memory only in this integration, no copying to local storage, URLs, logs or exported HAR/SDP dumps. A short token expiry bounds initial admission; it does not evict connected participants or establish a maximum session length. Active end/expiry/drain must stop local paid work and attempt room teardown. On self-hosted LiveKit, removal does not invalidate cached tokens; refreshed credentials/rejoins and best-effort cleanup mean no guaranteed revocation claim. Stop further Aurvin issuance for an ended session; do not treat token TTL alone as access control.

  Cite S5/S6. Include incident procedure: stop new live admissions, end/drain, restrict approved access boundary, privately coordinate affected room cleanup/credential rotation with service owner; no printed token examples, automatic management calls, or unapproved Cloud/key changes.
- [ ] **5. Green:** `Test-P7Docs security`. Inspect wording against actual P2/P5 handoff; test only validates document consistency.
- [ ] **6. Serialized commit request:** `docs(voice): document scoped LiveKit access and private setup`; stage only `docs/live-voice-webrtc/operations.md`.

## Task 2: Document reachable signaling/media and unselected placement

**Files:** extend `docs/live-voice-webrtc/operations.md` only.

- [ ] **1. Red:** `Test-P7Docs network`; expected missing network section/source/port requirements.
- [ ] **2. Add `## Network and placement`** with the explicit path `browser ⇄ LiveKit SFU ⇄ Aurvin bridge ⇄ Deepgram/OpenRouter`. Both browser and backend bridge are participants and need signaling **and** media reachability; backend also needs its normal provider/database access. `/api` reverse proxy carries session HTTP, text SSE and dictation socket, **not WebRTC media**. A working HTTPS page/session POST or NGINX syntax check proves neither ICE/TURN nor protected access.
- [ ] **3. Add two clearly scoped port lists**, citing S1–S4: self-hosted defaults/API backend 7880 behind trusted TLS signaling typically 443; direct ICE UDP 50000–60000 **or configured** mux 7882, not both as mandatory; ICE/TCP 7881; optional TURN/UDP 3478; TURN/TLS 5349 with correct L4 mapping/termination, or 443 when no LB. Distinguish external listeners from internal ports and browser/backend outbound from SFU inbound. Explain trusted signaling and separate TURN certificate/domain, routable advertised ICE candidates/NAT, and that ordinary NGINX HTTP proxying cannot relay TURN/TLS or UDP by adding `/api` locations. Do not prescribe opening all ports or a particular address. Cloud has managed TURN; link its changing outbound allowlist instead of pretending these self-hosted defaults configure Cloud.
- [ ] **4. Document browser prerequisites:** trusted HTTPS remote app origin/`wss://` signaling and secure context, browser mic permission/device availability, allowed microphone permissions policy, user gesture/autoplay `startAudio`, finite failure rather than insecure bypass. Loopback dev exception is same-machine only: a phone's `127.0.0.1` is the phone, not the backend. An HTTPS staging page does not make a remote plaintext SFU safe. Cite S8/S9. No browser launch or mic permission request here.
- [ ] **5. Add placement/decision record:** target, hosting provider, SFU region, backend region, provider region/data route, TURN ownership, cert/DNS and cost plan are **not selected** by P7. Prefer measuring bridge/SFU co-location and user/provider paths; Cloud client/bridge may attach at different edges. No invented US-East selection, RTT multiplier, endpoint, data-residency/SLA claim or local server startup instruction. Optional local dev server vs operator-supplied Cloud remains a separate hosting/activation gate. Cite S7; P8 records actual routing/RTT and selected candidate type, not assumptions from URL geography.
- [ ] **6. Green:** `Test-P7Docs network`; manually trace both participants' signaling/media directions and confirm all ports are conditional reference values, not commands or activated firewall rules.
- [ ] **7. Serialized commit request:** `docs(voice): explain WebRTC reachability TURN and placement gates`; stage operations only.

## Task 3: Describe passive status, finite drain, data/cost limits and real rollback

**Files:** extend `docs/live-voice-webrtc/operations.md` only.

- [ ] **1. Red:** `Test-P7Docs lifecycle`; expected missing status/drain/privacy/rollback sections.
- [ ] **2. Add `## Passive readiness and drain`** with all four P5 status meanings, aggregate dictation/live distinction, text `acceptReady`/HTTP-status isolation, no paid or SFU probe and no readiness-driven restart. Include this **future authorized existing-loopback-process** inspection, never a token POST; port comes from the operator's running process, not an assumed 3000/8001:

  ```powershell
  if (-not $env:AURVIN_OPS_PORT -or $env:AURVIN_OPS_PORT -notmatch '^\d{1,5}$') { throw 'Supply the existing loopback backend port.' }
  $port = [int]$env:AURVIN_OPS_PORT
  if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid port.' }
  $base = "http://127.0.0.1:$port/api"
  Invoke-RestMethod "$base/operations/live"
  Invoke-RestMethod "$base/operations/ready" | Select-Object live, acceptReady, speech
  Invoke-RestMethod "$base/voice/config" | Select-Object protocolVersion, enabledModes, limits
  ```

  Mark this drill `UNRUN`; it needs an approved already-running instance. A 503 ready response requires checking existing text prerequisites, not enabling speech or restarting automatically.
- [ ] **3. State shutdown sequence exactly:** operator stops new live sessions by saving live off, explicitly ends existing sessions using current UI (disable alone does not stop them), then uses the established graceful application close/supervisor handoff for process maintenance. Shutdown synchronously stops all admissions and drains voice/runtime **concurrently**, including pending bridge joins and durable accounting. Local providers/media stop and bounded **best-effort** room deletion is attempted. Distinguish remote revocation uncertainty from durable-cleanup uncertainty. Shared 20000 ms default application deadline and 45-second outer supervisor bound are settings/requirements, not measured results. Unsafe outcome means preserve sentinel and evidence, confirm exact process stopped, follow existing recovery runbook; never delete metadata, assume timeout cancelled work, run an overlapping backend or replay inference. Link existing Windows handoff/recovery; do not add a maintenance HTTP route or raw kill instruction.
- [ ] **4. Add `## Retention and cost`:** no new audio recording/storage/egress/Agents observability is enabled by this bridge. Audio exists transiently in browser/SFU/bridge/provider pipelines; accepted transcript/history/checkpoints and voice-delivery/accounting follow existing retention and bounded evidence policy. Link old voice accounting and Phase 1 backup/retention; don't invent a TTL or purge database. Distinguish LiveKit transport encryption from end-to-end secrecy: SFU/bridge/provider trust is required; no E2EE configuration is added. Project analytics/log/media recording policies and provider data processing must be verified by operator; application not recording audio does not prove vendors retain nothing. IDs/room names are potentially correlatable; export only sanitized aggregate/hashed evidence, no tokens, payloads, raw audio, SDP, candidate IPs, provider transcripts or private reasoning.
- [ ] **5. Cost guidance:** two normal participants (browser/bridge) can consume about two participant-minutes per connected call minute where that billing unit applies; this is a usage planning model, not a price/availability promise. Reconnect overlap, TURN bandwidth, SFU compute/egress, Deepgram and OpenRouter are separate costs. Backend speech-accounting estimates do not include/prove LiveKit invoice spend. Copy actual account rates/limits privately, keep unknown unknown, no free-tier/`$0` claim. Retain finite connection/reconnect/session/queue/concurrency/quota settings, operator wall-clock and call ceilings, external account spending limits and explicit manual stop responsibility. Five-second backend silence gate reduces uploaded STT input, not browser→SFU traffic or all connected-session costs. Existing in-memory quotas reset on restart and cancellation does not guarantee charge prevention. Benchmark guard is **not an invoice cap** and must not be reused as new authorization.
- [ ] **6. Add `## Rollback`**, ordered executable procedure without an invented fallback switch:
  1. Record approved source/config identity and retain compatible full release/assets/private config backup by existing release process; no provisioning or data copy is authorized by writing this guide.
  2. In the current Manage Aurvin Config/Voice section turn **Live voice mode off** and Save changes; leave dictation/text settings unchanged. Confirm no new live admission via public capability when authorized; do not submit billable test sessions just to prove a disabled flag.
  3. End **existing sessions** and gracefully drain the one executor; disabling live does not change their snapshots. A returned local cleanup timeout is not remote teardown proof. Escalate uncertain SFU cleanup privately and preserve accounting/delivery pending evidence.
  4. Same-release safe stop leaves dictation/text available on their existing gates. There is **no automatic live-WebSocket fallback**; do not route live to `/api/voice` or call WebSocket PCM WebRTC success.
  5. Only with separate deployment/restore approval, swap to a retained **compatible full release**, not just `dist/`, after confirmed stop/no overlapping executor. Verify compatibility with current stored config, checkpoints, internal voice messages and accounting before pointing it at data. Do not roll an arbitrary older schema build onto current data. If compatibility isn't established, stay live-off; isolated pre-change restore/data-loss acceptance requires operator approval and existing backup procedure. No automatic down migration, collection deletion, prompt replay or baseline checkout reset.
  6. Roll back LiveKit bootstrap configuration only as a complete tuple or all blank at a controlled restart. Removing one field fails startup; changing only app config does not shut down or destroy independent LiveKit infrastructure. No service deletion/provisioning in P7.
- [ ] **7. Green:** `Test-P7Docs lifecycle`; compare every setup/shutdown/rollback assertion with P5 committed handoff and actual defaults. Record unknowns instead of replacing uncertainty with a success claim.
- [ ] **8. Serialized commit request:** `docs(voice): define passive health finite drain and live rollback`; stage operations only.

## Task 4: Make minimal existing setup and deployment corrections

**Files:** `README.md`, `backend/.env.example`, `deployment/staging/README.md`, `deployment/staging/nginx.conf`, `deployment/render/nginx.conf.template`.

- [ ] **1. Red:** `Test-P7Docs setup`; expected missing blank LiveKit examples/new links and obsolete live-WS comment. Inspect current files first; preserve intervening changes. Keep the pre-edit normalized directives captured above.
- [ ] **2. Add this exact block after the master-key infrastructure section** in `backend/.env.example` (retain all existing values/defaults):

  ```dotenv
  # Optional LiveKit bootstrap-only infrastructure for live WebRTC; all blank is absent.
  # Private server environment only; never VITE_* or a Manage Aurvin credential card.
  # Configure all three together after hosting/access approval; partial values fail startup.
  # Production requires trusted wss:// signaling; ws:// is non-production loopback only.
  # Changes require controlled restart/drain; these entries do not enable a voice mode.
  LIVEKIT_URL=
  LIVEKIT_API_KEY=
  LIVEKIT_API_SECRET=
  ```

  Avoid an example real endpoint/key or any server startup command. Clarify existing "manageable values" comment does not include these infrastructure settings.
- [ ] **3. Correct README configuration/voice paragraphs**, not unrelated sections. Add three LiveKit names together as bootstrap-only private settings, restart requirement, blank/partial rules and new runbook link. Keep startup-ignored/import-only status for legacy voice flags/Deepgram env entries. Replace "Local voice traffic uses the same Vite proxy" with the precise split: dictation socket and session REST use `/api`, live media/control connect directly to admitted LiveKit URL; no parallel socket/fallback. Label `/api/voice` **dictation-only**. Keep Manage Aurvin live flag default-off and separate Deepgram key/region. Remove the historical P5-warning prohibition only after P5 confirms its warning/end handoffs passed, replacing it with actual remaining browser/network/authorization gates; if P5 cannot confirm, block this step, do not falsely remove the gate. Add trusted context/endpoint/access warning; frontend remains only `VITE_API_BASE=/api`, explicitly prohibit `VITE_LIVEKIT_*` secrets/settings. In protected staging, replace "do not publish a separate voice port" with "do not expose the backend or token API publicly; separately approved LiveKit signaling/media reachability is required and not supplied by this HTTP gateway." Retain unrun hardware/mobile/latency limits, no public rollout claim, and existing Calendar/auth caveats.
- [ ] **4. Correct staging README socket paragraph** and link `../../docs/live-voice-webrtc/operations.md`: inherited app auth protects REST/token issuance and dictation upgrade only; LiveKit uses scoped tokens/separate endpoints/media. Protected HTTP staging is not WebRTC/access certification, and approval is needed before DNS/cert/firewall/server activation. No unauthenticated public voice; no credentials or external listener changes.
- [ ] **5. Edit NGINX comments only.** Above staging socket block add `# Dictation-only WebSocket; live WebRTC media/control use separate approved LiveKit endpoints.` and `# Requirements: docs/live-voice-webrtc/operations.md (no SFU listener is configured here).` Correct Render header/socket description to `dictation-only`; add `# LiveKit signaling/media are separate; this template provides no application authentication.` and `# Do not expose unauthenticated public voice; see docs/live-voice-webrtc/operations.md.` Preserve every directive, timeout, listener, header, access rule and environment substitution. Do not edit entrypoint or add TURN locations.
- [ ] **6. Green:** `Test-P7Docs setup`; then prove directive bodies unchanged:

  ```powershell
  foreach ($p in $P7NginxBefore.Keys) {
    $after = ((Get-Content -LiteralPath $p | Where-Object { $_ -notmatch '^\s*(#|$)' }) -join "`n")
    if ($after -cne $P7NginxBefore[$p]) { throw "Unexpected NGINX directive change: $p" }
  }
  ```

  Expected no output/errors. No `nginx -t`, gateway start, `envsubst`, deployment or live network test is run: comments-only syntax invariance is the local check. If a directive change becomes necessary, return to the owner/orchestrator for scope approval rather than silently expanding P7.
- [ ] **7. Because backend env/config examples changed**, run separately with working directory `backend/`: `npm run build`, then `npm run lint`; record exit codes and warnings. No frontend code/config changes are planned, so unrelated frontend build/lint and application suites are unnecessary for P7; P8 retains full regression responsibility. If only docs/comments changed and no config example changed on actual execution, record build/lint not required with reason rather than inventing a run.
- [ ] **8. Serialized commit request:** `docs(voice): align setup and proxy examples with live WebRTC`; stage exactly the five named Task 4 files.

## Task 5: Hand off explicitly unrun operational drills and verify consistency

**Files:** finish `docs/live-voice-webrtc/operations.md` only. P8 owns actual `verification.md`/`comparison.md`; orchestrator owns state/final report.

- [ ] **1. Red:** `Test-P7Docs evidence`; expected missing evidence inventory/reusable check. If link checking finds a pre-existing missing target in README, report it separately; fix only a task-owned introduced link or obtain ownership approval, never fabricate another workflow artifact.
- [ ] **2. Add `## Authorization and evidence`** with this initial inventory, preserving `UNRUN` for every row. Evidence lives in P8 artifacts when they exist; reference those filenames as code text, not broken links created before files exist. Distinguish no-network fixtures from actual service/hardware observation.

  | Drill | Status | Required P8 observation and gate |
  | --- | --- | --- |
  | D1 | UNRUN | Approved target/hosting, real browser and backend signaling plus bidirectional media, selected ICE pair/transport and TURN use; no tokens or candidate IP dumps. New service activation/network access needs authorization. |
  | D2 | UNRUN | UDP-blocked restricted-network fallback to ICE/TCP or TURN/TLS using approved isolated network; join timeout/failure recovery and text/dictation unaffected. No shared-host firewall mutation without specific approval. |
  | D3 | UNRUN | Secure-context mic permission denial/ignore/device failure/autoplay gesture on named desktop/mobile browser/hardware, one mic capture, no paid work after failed/abandoned join. Mic/data/provider use needs approval. |
  | D4 | UNRUN | Matched baseline/WebRTC speech-end-to-audible onset and interruption-to-actual-stop, p50/p95/sample count/failures; distinguish decoded receipt and timer ACK from hearing, prove no stale response after reconnect. Fresh bounded provider/browser approval. |
  | D5 | UNRUN | Both transports under fixed declared jitter/loss profiles, actual applied tool/direction/delay/jitter/loss values, startup/disconnect/rejoin behavior and stop latency. Approve impairment method on isolated participants; do not invent measurements. |
  | D6 | UNRUN | Active/pending join plus provider/durable write during graceful shutdown; immediate admission stop, deadline, terminal/delivery/accounting outcome, remote room disappearance or uncertainty and no overlapping executor. Maintenance/data/service approval. |
  | D7 | UNRUN | Live-off rollback while existing sessions exist, explicit end/drain and new admission disabled; dictation/text still work; separately approved compatible retained-release swap/restore only if needed. No unauthorized restore or database changes. |
  | D8 | UNRUN | Unauthorized UI/admin/session/token denial through actual protected gateway and direct backend isolation; room/epoch scope/expired-token/rejoin behavior on selected hosting. Existing auth deferral remains; test approval does not authorize public exposure. |
  | D9 | UNRUN | Actual provider/LiveKit usage reconciliation, data routing/retention settings, sanitization of artifacts and no residual tracks/providers/rooms after stop. Record unknown remote state/spend, never zero by default. Account access/data review needs approval. |

- [ ] **3. Add P8 handoff requirements:** source commits plus dirty/source hash from orchestrator, Node/OS/SDK/browser/device versions, microphone/output path, approved target and placement, settings snapshot without secrets, codec/resampling/buffer boundaries, absolute sample coordinates/proof limitations, source hash/fixture marker, exact test commands/outcomes/skips, selected candidate protocol/relay as aggregate, times/sample counts/failures, cleanup, private raw artifact paths and sanitized comparison. Match baseline transport/source/config independently without editing/reverting current checkout or starting another executor against same DB. Network/audio timing must follow P6 methodology rather than inventing another benchmark. Missing comparable/browser evidence is **blocked**, not full goal verification. P8 sends defects back to owning workers; no reviewer dispatch.
- [ ] **4. Add fresh authorization envelope:** hosting/target/activation, protected access, mic/synthetic data and routing approval, timeframe/timezone/max wall-clock, max provider submissions/session creations/audio frames/characters and dollar ceiling including infrastructure exposure, external account caps, stop owner/criteria and cleanup permission. Prior eight-submission approval is exhausted. No new run is authorized by continuing MAW; live browser/network and paid providers need appropriate explicit approval. Do not copy research's estimated price or assume benchmark guard covers SFU costs. No hosting choice/provisioning/public rollout is approved. Record grant reference and actual observed usage only after it exists.
- [ ] **5. Add `## Offline consistency check`** and copy the complete PowerShell function/check above with `Test-P7Docs all` invocation, root working-directory instruction and explicit no-network/document-only limitation. Add `## Sources` with S1–S9 URLs/date and separate source-backed P5 contracts from unverified deployment assumptions. Check required heading anchors manually; do not link P8/final artifacts before they exist.
- [ ] **6. Green, root working directory:** `Test-P7Docs all`. Expected `P7 all: PASS (offline documentation consistency only)` and no errors. Manually read the actual security/rollback narrative (the literal checker cannot detect incorrect surrounding prose); trace every new local link including fragments and confirm official port qualifications and P5 interface values. Repeat the normalized NGINX comparison; ensure the only expected drift is task documentation/blank examples/comments.
- [ ] **7. Future worker whitespace check**, after orchestrator authorizes Git access, from repository root:

  ```powershell
  git diff --check -- docs/live-voice-webrtc/operations.md README.md backend/.env.example deployment/staging/README.md deployment/staging/nginx.conf deployment/render/nginx.conf.template
  ```

  Expected exit 0/no output. Untracked operations file requires the document check/read above as well; after explicit named-file staging, repeat with `git diff --cached --check --` and the same six paths before commit. No broad staging, no benchmark files, no passing review artifact. Planner did not run either Git command.
- [ ] **8. Serialized commit request:** `docs(voice): record unrun operational drills and verification handoff`; stage operations only unless the orchestrator assigns a specific task-owned consistency correction. No empty commit.
- [ ] **9. Report** exact commits, six modified/created paths, document checker result, directive invariance, build/lint actual outcomes/warnings (or justified not-required), whitespace/link/anchor findings, P5 handoff confirmations and any mismatch, P8 evidence/gates, and every unrun drill. Do not update state/plans/evidence/final report yourself. P7 documentation completion is not P8 completion, connectivity certification, Azure admission, latency improvement, auth rollout or production readiness.

## Exit/self-check (requirements, not results)

- [ ] P5 implementation/handoffs verified before publication; no invented endpoint, region, price, hosting, credential store, auth system or fallback flag.
- [ ] Private bootstrap tuple and restart semantics agree with parser; manageable flags remain stored settings; examples are blank and no secrets/JWTs enter docs/artifacts.
- [ ] Both participants' signaling/media/NAT/TURN and secure-context/autoplay requirements cite official sources and remain unverified for the operator environment.
- [ ] Passive readiness, text isolation, concurrent finite drain, unsafe ownership, best-effort remote removal and compatibility-aware rollback match assembled behavior.
- [ ] Retention/data routing, transport encryption versus E2EE, two-participant costs, unknown billing, finite budgets and authorization limitations are explicit.
- [ ] Exactly the six owned output files are changed; no benchmark/source/entrypoint/workflow-artifact changes; NGINX directives preserved.
- [ ] Offline document/config/link checks and whitespace pass; relevant backend build/lint have actual outcomes if env/config example changes land; no unrelated application suites implied.
- [ ] All actual service/browser/network/rollback drills stay `UNRUN` in this runbook; P8 must collect authorized evidence or mark blocked. Review remains skipped.

**Planner self-check:** P7 scope/exit gate and AC5/AC8/AC9 map to Tasks 1–5; exact worker paths, red/green commands, minimum edits and per-task commit requests are specified. Current official docs qualify earlier research's revocation/ports/region/cost assumptions. No runtime implementation or new validation framework is planned, and no live authorization is inferred.
