# Live voice WebRTC operations

This is an operating procedure, not service, browser, or network certification and not deployment authorization. The P5 cutover uses one Aurvin process/runtime and an in-process LiveKit media bridge; admit one executor per database with no overlapping backend. Dictation and text remain on their existing paths. A live session POST opens the backend bridge before returning the browser descriptor; paid speech work waits for a valid LiveKit Room `session.start`. The recorded P5 warning/end handoffs are complete, but that does not authorize enabling a mode or rollout; browser, network, and operator evidence remains UNRUN. This runbook supersedes historical **live transport, readiness, drain, and pre-cutover P5 warning** directions in [voice-mode operations](../voice-modes/operations.md); its unchanged dictation and accounting policy remains in force. Hosting and service targets remain unselected. See the approved [goal](goal.md), current [workflow state](state.md), [root setup](../../README.md), and [Phase 1 operations](../aurvin-phase-1/operations.md).

## Access and credentials

`LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` are bootstrap-only server environment settings. Provide the complete tuple through a private backend `.env` or the private environment inherited by the existing launcher; the secret-storage mechanism beyond that is operator-selected, not chosen here. Changing this bootstrap tuple requires a controlled application restart and drain. It is not stored in MongoDB or managed through the Manage Aurvin credential UI. Manage Aurvin continues to own the live/dictation mode switches and Deepgram configuration.

All three values blank means LiveKit is absent and live capability is unavailable; dictation and text are unaffected when their own configuration is present. Any partial or malformed tuple fails startup even if live mode is off. Production requires trusted `wss://` signaling; `ws://` is accepted only for parser-recognized loopback in non-production. The parser accepts only a root signaling URL, with no embedded credentials, path, query, or fragment. Do not copy a guessed endpoint into configuration. `LIVEKIT_URL` is sent to an admitted browser and must be reachable from both that browser and the backend bridge.

The current app auth is deferred. **No unauthenticated public voice.** The shared server development identity, CORS, a scoped LiveKit token, and the staging basic-auth example are not application authentication. Keep the UI, configuration/admin pages, and session/token REST routes inside the approved loopback or access-controlled boundary. Do not expose the backend or token API publicly.

The backend issues the browser a short-lived, room-, participant-, and connection-epoch-bound token with microphone-only publish, subscribe, and data permissions; it grants no room administration, listing, creation, or recording. The server API key/secret and agent token stay server-side. Never place credentials in `VITE_*`, source, command arguments, screenshots, logs, browser storage, URLs, or exported HAR/SDP dumps. Keep the browser token in memory only; treat it as a bearer secret. Do not copy real tokens into examples or diagnostics.

Aurvin caps the join token at 30 seconds and further limits it to the connect window; this is not a fixed 30-second session duration. The token expiry limits initial admission; it does not evict an already connected participant or establish a maximum session length. Ending, expiry, or drain stops local work and attempts bounded remote room teardown. For self-hosted LiveKit, removing a participant or updating permissions does not invalidate an already-issued token. Cloud has separate revocation behavior and configuration requirements; do not claim this integration implements every Cloud revocation option. Room deletion/removal is best-effort here, not guaranteed remote revocation or prevention of rejoin/billing. Stop further Aurvin token issuance for the ended session; do not treat TTL alone as access control. LiveKit records room names and participant identities in its logs/traces: keep them non-personal and treat them as correlatable metadata.

For a suspected token or credential exposure, stop new live admissions, explicitly end sessions and drain the existing process, restrict the approved access boundary, and privately coordinate affected-room cleanup and any credential rotation with the service owner. Do not print tokens, trigger automatic management calls, or change Cloud projects/keys without separate authorization. See official [token and grant guidance (S5)](https://docs.livekit.io/frontends/reference/tokens-grants/) and [RoomService API (S6)](https://docs.livekit.io/reference/other/roomservice-api/).

## Network and placement

The live media path is **browser ⇄ LiveKit SFU ⇄ Aurvin bridge ⇄ Deepgram/OpenRouter**. Both the browser and Aurvin's backend bridge are LiveKit participants; both need signaling and media reachability. Live audio and reliable control data use that Room, not a parallel `/api/voice` live socket. The backend also needs its normal provider and database access. `/api` carries session HTTP and text SSE; `/api/voice` carries dictation-only WebSocket traffic. Neither the HTTP reverse proxy nor an HTTPS session POST carries WebRTC media. A working `/api` route, HTTP proxy check, or NGINX syntax check proves neither ICE/TURN connectivity nor protected access.

For a self-hosted service, LiveKit documents these **conditional defaults**, not firewall instructions for an unselected target:

| Function | Default/reference port | Exposure and qualification |
| --- | --- | --- |
| Signaling and server API | 7880 internally | Keep the LiveKit port private behind trusted TLS termination; the client-facing WSS endpoint is typically TCP 443. Backend management API reachability must use the approved service route. |
| ICE media over UDP | UDP 50000–60000, **or** configured UDP mux 7882 | These are alternatives; a configured mux replaces the range. Advertised candidates must route back to the SFU through NAT/firewall rules. |
| ICE media over TCP | TCP 7881 | A fallback path when direct UDP is blocked; expose only if selected and approved. |
| TURN over UDP | UDP 3478 | Optional; configure and expose only if the selected deployment uses it. |
| TURN over TLS | TCP 5349 by default | Optional. LiveKit terminates TLS; use the appropriate L4 mapping and a separate TURN name/certificate. Without a load balancer, configure the advertised listener as 443. Ordinary NGINX HTTP `location` proxying is not an L4 TURN relay. |

The 7880 listener is not a public media port. Separate internal server listeners from approved external SFU listeners, participant outbound paths, and backend-to-service management traffic. Do not open every listed port by default or assume an advertised address is routable. Self-hosting also requires a trusted signaling certificate/domain, separate TURN DNS/certificate when used, and externally reachable advertised ICE candidates. See official [self-hosted ports and firewall (S1)](https://docs.livekit.io/transport/self-hosting/ports-firewall/) and [deployment/TURN requirements (S2)](https://docs.livekit.io/transport/self-hosting/deployment/).

For LiveKit Cloud, Cloud supplies managed TURN, but actual egress rules still depend on the selected account and network. Follow the current [Cloud firewall guide (S4)](https://docs.livekit.io/deploy/admin/firewall/) rather than copying a frozen host allowlist into this runbook. Its hostname and region lists can change. LiveKit documents UDP, TURN/UDP, ICE/TCP, and TURN/TLS connection paths; availability does not guarantee success through a particular VPN or firewall. See [connection reliability (S3)](https://docs.livekit.io/intro/basics/connect/).

Remote browser use requires a trusted HTTPS app origin, secure context, trusted `wss://` signaling, microphone permission and an available device. The app's Permissions Policy must allow microphone use where applicable. Permission can be denied or left unanswered, a device may be missing or unavailable, and audio playback may require a user gesture that calls LiveKit `startAudio`. Handle these as finite user-visible failures; do not bypass browser security or use remote plaintext HTTP. A loopback development exception applies only on the same machine: `127.0.0.1` on a phone names the phone, not the backend. An HTTPS staging page does not make a remote plaintext SFU safe. See [LiveKit JS audio playback (S8)](https://docs.livekit.io/reference/client-sdk-js/) and [MDN microphone security (S9)](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security). These browser and network drills remain **UNRUN**.

Hosting target/provider, SFU and backend region, provider/data route, TURN ownership, DNS/certificates, and cost plan are **not selected**. No local server, Cloud project, endpoint, firewall rule, or deployment is chosen or authorized here. Before deciding, measure the user-to-SFU and backend-bridge-to-SFU/provider paths and consider bridge/SFU co-location; the browser and backend can attach at different network edges. Do not carry forward a research example region, estimated RTT multiplier, or estimated cost as an operating fact. Region pinning controls routing, while project data residency controls stored/processed project data; both depend on actual project configuration and feature availability and neither follows from a URL or Deepgram region. P8 may record actual routes and selected candidate/relay type only after authorization. See [LiveKit region pinning](https://docs.livekit.io/deploy/admin/regions/region-pinning/) and [observability data residency](https://docs.livekit.io/testing/observability/data-residency/) (S7).

## Passive readiness and drain

`/api/operations/live` is process liveness, not voice readiness. `/api/operations/ready` reports speech separately from text admission. `speech: off` means neither voice mode was requested; `unconfigured` means a requested mode lacks Deepgram or a requested live mode lacks LiveKit; `degraded` means an observed speech-provider or LiveKit fault; `ready` means required configuration is present with no observed fault. `ready` is not proof of signaling, ICE, TURN, media, microphone, or audible playback. Missing LiveKit can make aggregate speech unconfigured while configured dictation remains available.

Text `acceptReady` and the HTTP status for `/api/operations/ready` remain governed by text prerequisites. Speech status does not add text readiness issues, stop text admission, or trigger a restart. Readiness does not call a speech provider or LiveKit, sign a token, join a room, or probe ICE/TURN. Observed LiveKit degradation clears only after a later successful bridge connection; provider speech faults remain separate. Do not supervise readiness as a restart probe.

The following is a **future, authorized inspection of an already-running loopback process only**. Supply its actual port; do not assume 3000 or 8001. It does not create a session or POST a token. This inspection is **UNRUN** and requires an approved existing instance:

```powershell
if (-not $env:AURVIN_OPS_PORT -or $env:AURVIN_OPS_PORT -notmatch '^\d{1,5}$') { throw 'Supply the existing loopback backend port.' }
$port = [int]$env:AURVIN_OPS_PORT
if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid port.' }
$base = "http://127.0.0.1:$port/api"
Invoke-RestMethod "$base/operations/live"
Invoke-RestMethod "$base/operations/ready" | Select-Object live, acceptReady, speech
Invoke-RestMethod "$base/voice/config" | Select-Object protocolVersion, enabledModes, limits
```

A 503 from `ready` means check existing text prerequisites; it is not a reason to enable speech or restart automatically.

For planned maintenance, use this order:

1. In Manage Aurvin Config/Voice, turn **Live voice mode off** and save. This blocks new live admission; it does not alter the configuration snapshot of **existing sessions**.
2. Explicitly end existing live sessions through the current UI. Disabling the flag alone does not end them.
3. Use the established graceful application close and supervisor handoff. Shutdown synchronously stops voice admission and starts voice/runtime drains **concurrently** under their shared deadline. The drains include pending bridge joins and durable accounting; local media/provider resources are closed and bounded remote room deletion is attempted.
4. The default `shutdownDrainMs` is 20,000 ms; the external supervisor bound is 45 seconds. These are configured limits, not measured drill results. On Windows use validated Ctrl-C or awaited supervisor IPC as described by [Phase 1 shutdown/recovery](../aurvin-phase-1/operations.md#graceful-shutdown-and-crash-recovery-ops-05-ops-06); do not assume SIGTERM, add a maintenance HTTP route, or kill the process as a substitute for drain.
5. `LIVEKIT_TEARDOWN_TIMEOUT_MS` is a 2,000 ms best-effort source constant, not an environment setting. A completed request, timeout, or swallowed remote deletion error does **not** prove the participant/room disappeared. Distinguish remote cleanup uncertainty from durable-cleanup uncertainty.
6. If required durable cleanup fails or hangs, shutdown is **unsafe**: persistence must not close, keep the executor sentinel and evidence, confirm the exact process is stopped, and follow the existing operator recovery procedure. A timeout does not mean the underlying work was cancelled. Never manually delete the sentinel, start an overlapping executor, or replay inference.

No service shutdown, drain, timeout, or remote-room cleanup drill was run for P7.

## Retention and cost

The P5 bridge enables no new audio recording, storage, LiveKit egress, or LiveKit Agents observability. Audio passes transiently through browser, SFU, Aurvin bridge, and provider paths; Aurvin does not add raw-audio recording. Accepted transcripts/history/checkpoints and bounded `voice-accounting`/`voice-delivery` evidence follow the existing retention and backup policy in [voice-mode operations](../voice-modes/operations.md) and [Phase 1 operations](../aurvin-phase-1/operations.md). Do not invent a voice TTL or purge application data from this runbook.

Transport encryption (TLS signaling and DTLS-protected WebRTC media) is not end-to-end secrecy: the SFU, Aurvin bridge, and speech provider are trusted processing points. No E2EE configuration is added. An application that does not record audio does not prove that every service retains nothing. Operators must verify the selected project’s analytics/log/recording policy and provider processing/retention terms. Region routing and project data residency are distinct and must be confirmed against the actual selected services (S7).

Room names and participant/session identifiers may be correlated across services. Export only sanitized aggregate or hashed evidence. Do not export tokens, credentials, payloads, raw audio, SDP, ICE candidate addresses, provider transcripts, or private model reasoning. Keep any raw diagnostic artifacts private and access-restricted.

Where billing is participant-minute based, a normal two-participant call (browser plus Aurvin bridge) can consume about two participant-minutes per connected call minute. This is a usage-planning model, not a price or availability promise. Reconnect overlap, TURN bandwidth, SFU compute/egress, Deepgram, and OpenRouter are separate costs. Aurvin speech-accounting estimates do not include or prove LiveKit invoice spend. Current LiveKit rates, included quantities, project limits, and total run cost remain **unknown**; record actual account rates and external account caps privately, never assume a free tier or `$0`.

Keep finite connection, reconnect, session, queue, concurrency, and quota ceilings. Current source defaults include 10-second connect/reconnect limits, a 20-minute live maximum, 1-second input and 2-second output queues, identity/global concurrency of 1/4, and daily minutes of 60/120; effective Manage Aurvin settings may be tighter. These in-memory quotas reset on restart. Do not change manageable voice settings through startup-ignored legacy `VOICE_*` environment entries. The backend’s five-second silence gate can reduce uploaded STT input; it does not reduce browser-to-SFU media traffic or all connected-session costs. Cancellation does not guarantee charge prevention. Any operator run needs explicit wall-clock, call, participant-minute, provider-use, and infrastructure-cost ceilings plus a named stop owner. The benchmark guard is **not an invoice cap**.

## Rollback

1. Record approved source/config identity. Retain a compatible **full release** and private configuration backup under the existing release process. This document authorizes no provisioning, data copy, or restore.
2. For same-release rollback, turn **Live voice mode off** in Manage Aurvin Config/Voice and save; leave dictation and text settings unchanged. When authorized, check the public capability reports `enabledModes.live: false`; do not create a billable session merely to prove the disabled flag.
3. Explicitly end **existing sessions** and gracefully drain the one executor. Disabling live does not change their captured configuration. A local cleanup timeout is not proof of remote teardown; privately escalate uncertainty and preserve pending accounting/delivery evidence.
4. Same-release stop keeps dictation/text on their existing gates. There is **no automatic live-WebSocket fallback**. `/api/voice` is dictation-only; do not route live audio there or label WebSocket PCM as WebRTC success.
5. Only with separate deployment/restore approval, confirm the current process has stopped and no executor overlaps before switching to a retained **compatible full release**, not just `dist/`. Check its compatibility with stored configuration, checkpoints, internal voice messages, and accounting before using existing data. Never put an arbitrary older schema build on current data. If compatibility is unknown, keep live off; an isolated pre-change restore and any accepted-data-loss decision require operator approval and the existing backup procedure. Do not down-migrate automatically, delete collections, replay prompts, or reset the checkout to a baseline.
6. Roll back LiveKit bootstrap configuration only as a complete tuple or with all three values blank, at a controlled restart. Removing only one setting fails startup. Changing Aurvin configuration does not shut down or delete independent LiveKit infrastructure.

## Authorization and evidence

All actual LiveKit, browser/media, TURN, impairment, cost, shutdown, and rollback drills below are **UNRUN** for P7. They are not fixture results. P8 may replace a row only with authorized, observed evidence in its own `verification.md`/`comparison.md`; absent approval or hardware is blocked/unrun, never passed.

| Drill | Status | Required P8 observation and gate |
| --- | --- | --- |
| D1 | UNRUN | Approved target/hosting; real browser and backend signaling plus bidirectional media; selected ICE pair/transport and TURN use. Do not export tokens or candidate IP dumps. Service activation/network access requires authorization. |
| D2 | UNRUN | UDP-blocked fallback to ICE/TCP or TURN/TLS on an approved isolated network; join timeout/failure recovery; text and dictation unaffected. No shared-host firewall mutation without specific approval. |
| D3 | UNRUN | Secure-context microphone permission denial/ignore/device failure and autoplay gesture on named desktop/mobile browser and hardware; one mic capture; no paid work after a failed/abandoned join. Mic/device and provider use need approval. |
| D4 | UNRUN | Matched baseline/WebRTC speech-end-to-audible-onset and interruption-to-actual-playback-stop; p50/p95, sample count, failures; distinguish decoded receipt/timer ACK from hearing and prove no stale response after reconnect. Fresh bounded browser/provider approval required. |
| D5 | UNRUN | Both transports under fixed declared jitter/loss profiles; record actual impairment tool, direction, delay, jitter, loss, startup/disconnect/rejoin behavior, and stop latency. Approve the method on isolated participants; invent no measurements. |
| D6 | UNRUN | Active/pending join plus provider/durable write during graceful shutdown; immediate admission stop, deadline, terminal/delivery/accounting outcome, remote room disappearance or uncertainty, and no overlapping executor. Maintenance/data/service approval required. |
| D7 | UNRUN | Live-off rollback with existing sessions, explicit end/drain, new admission disabled, and dictation/text still working. Separately approved compatible retained-release swap/restore only if needed; no unauthorized restore or database changes. |
| D8 | UNRUN | Unauthorized UI/admin/session/token denial through the actual protected gateway and direct-backend isolation; room/epoch scope, expired-token, and rejoin behavior on the selected hosting. Application auth remains deferred; test approval does not authorize public exposure. |
| D9 | UNRUN | Actual provider/LiveKit usage reconciliation, data routing/retention settings, sanitized artifacts, and no residual tracks/providers/rooms after stop. Record unknown remote state/spend, never zero by default. Account access/data review needs approval. |

### P8 handoff

Record source commits and the orchestrator-provided dirty/source hash; Node, OS, LiveKit SDK, browser, and device versions; microphone/output path; approved target and placement; settings snapshot without secrets; codec, resampling, and buffer boundaries; absolute sample coordinates and proof limitations; source hash and fixture marker; exact commands, outcomes, and skips; selected candidate protocol/relay only as sanitized aggregate; times, sample counts, failures, and cleanup; private raw-artifact paths and a sanitized comparison. Do not put tokens, candidate addresses, raw audio, transcripts, or provider payloads in shared artifacts.

Match baseline transport/source/config independently. Do not edit or revert the current checkout to manufacture a baseline and do not start another executor against the same database. Follow P6's existing methodology for audio timing and network impairment rather than creating another benchmark. P4's elapsed-time/SDK progress is not acoustic proof; decoded receipt or an ACK is not audible-onset or interruption-stop evidence. Missing comparable/browser evidence is **blocked**, not full goal verification. P8 routes defects back to their owning workers; review remains skipped.

### Fresh authorization envelope

Before any future service activation or live browser/network/provider run, obtain separate bounded approval for the hosting target and activation, protected access boundary, microphone/synthetic data and routing, timeframe/timezone, maximum wall-clock, maximum provider submissions/session creations/audio frames/characters, dollar ceiling including infrastructure exposure, external account caps, named stop owner and stop criteria, and cleanup permission. Record the grant reference and observed usage only after approval exists. The previous eight-submission approval is exhausted; continuing this workflow does not authorize more submissions. No target, local server, Cloud project, provisioning, public rollout, or paid run is approved here.

## Offline consistency check

Run from the repository root. This temporary PowerShell/Node check reads public docs, the env example, and the bootstrap declaration; it does not read `.env`, use the network, start a service, or certify deployment behavior. Run it after documentation edits:

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
Test-P7Docs all
```

The checker verifies document anchors as required headings only by string presence and checks local link targets, not every heading fragment. The worker must still manually trace all new local links and fragments, read the security/rollback narrative, and confirm the NGINX directive-only comparison. A pass is documentation consistency only, not deployment or security certification.

## Sources

Official pages below were retrieved 6 November 2026. Their contents are **official requirements/reference**, not a selected Aurvin deployment. P5 behavior described above was checked against the current committed implementation/state; operator DNS, firewall, hosting, project policy, provider routing, and device behavior remain **unverified environment facts**.

- **S1 — Self-hosted ports/firewall:** [LiveKit ports and firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/).
- **S2 — Self-hosted deployment, signaling TLS, candidate reachability, and TURN/L4:** [LiveKit deployment](https://docs.livekit.io/transport/self-hosting/deployment/).
- **S3 — ICE/TURN connection paths and Cloud-managed TURN:** [LiveKit connection reliability](https://docs.livekit.io/intro/basics/connect/).
- **S4 — Changing LiveKit Cloud firewall domains/ports:** [Cloud firewall guidance](https://docs.livekit.io/deploy/admin/firewall/).
- **S5 — Grants, expiry, refresh, and Cloud/self-hosted token revocation differences:** [LiveKit tokens and grants](https://docs.livekit.io/frontends/reference/tokens-grants/).
- **S6 — Room/participant management:** [LiveKit RoomService API](https://docs.livekit.io/reference/other/roomservice-api/).
- **S7 — Routing versus stored project data:** [Region pinning](https://docs.livekit.io/deploy/admin/regions/region-pinning/) and [observability data residency](https://docs.livekit.io/testing/observability/data-residency/).
- **S8 — Browser autoplay and user-gesture `startAudio`:** [LiveKit JavaScript SDK audio playback](https://docs.livekit.io/reference/client-sdk-js/).
- **S9 — Microphone permission and secure-context requirement:** [MDN `getUserMedia()` privacy and security](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security).
