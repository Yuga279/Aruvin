Goal: New voice sessions use the current saved configuration; admitted sessions retain their speech, text-turn, timing, and accounting snapshot without resetting quotas.

Architecture: Keep the existing VoiceSessionService, VoiceUsageService, reservation authority, flows, and provider adapters. Capture P1's frozen RuntimeConfigSnapshot once per new session, carry it in server-only SessionContext, and project only existing safe wire fields. Refresh shared browser capabilities independently of session controllers.

Stack: Existing Nest/TypeScript NodeNext, React 19, native WebSocket/Web Audio, and Vitest. No new dependencies, provider API changes, paid calls, migration execution, or voice-orb changes. Research and unified review are skipped, not passed.

## Boundaries and interface handoff

- P1 is implemented through `48126e2`. Import `CurrentConfigPort`, `RuntimeConfigSnapshot`, and `VoiceConfig` from `backend/src/contracts/config-runtime.ts`; use `buildRuntimeSnapshot` and `defaultManageableSettings` for dynamic fixtures. Do not edit P1 contracts/config/protocol files.
- P1's `voice.dictationWarningMs` is separate from `voice.limits`; nullable means no dictation-duration warning. `publicVoiceConfig` and existing voice wire validators intentionally omit it. Warnings remain server events; no protocol revision or new public warning field is necessary.
- Add `currentConfig?: CurrentConfigPort` to VoiceSessionOptions and VoiceUsagePorts. Existing `config` remains a temporary static-fixture/assembly adapter, not a fallback when an installed port returns null. P6 supplies the port to both services, removes legacy runtime environment loading from its assembly, and always constructs providers/accounting from `context.voiceConfig`.
- Add required, server-only fields to SessionContext: `voiceConfig: RuntimeConfigSnapshot['voice']` and `configSnapshot: RuntimeConfigSnapshot | null`. Dynamic contexts hold exactly the frozen P1 pointer; static compatibility contexts hold a detached speech copy and null runtime snapshot. Never serialize either field into responses, logs, accounting documents, checkpoints, or mutation records.
- Capture before the first asynchronous session lookup/admission. Registry registration is the admission boundary: recheck current flags/concurrency after provisional usage admission and release provisional admission on refusal. Do not recapture provider/budget settings midway through creation. Idempotent existing bindings bypass current mode checks, including reconnect, while shutdown continues to refuse all new ticket claims.
- P3 coordination request: server-only `configSnapshot?: RuntimeConfigSnapshot` on `SubmitLiveTurn`, consumed during attempt acceptance and retained through execution/retries. P4 passes `context.configSnapshot` there. No browser override and no persisted keys. P3 owns the runtime implementation; pause the live-bridge step until this interface is confirmed. Earlier P4 work can proceed from P1 independently. If P3 chooses a different signature, reconcile the plan through the orchestrator, not edits to P3/P1 files.
- P5 imports `refreshVoiceCapabilities(): Promise<boolean>` from `frontend/src/features/voice/index.ts`. Call after confirmed nonsecret save, validate-and-save, or removal; false means the save succeeded but capabilities could not be refreshed. Never call on keystrokes, failed/conflicting saves, or pending writes. Do not replace controllers/providers, close sessions, or pass admin settings/credentials into this function.
- P6 preserves one instance of each existing service and uses the same current-config pointer; publication does not reconstruct them, clear counters, or rerun inference. Missing current config/Deepgram key gives safe off capabilities and rejects new speech. Live speech also needs P6's existing text-runtime readiness fence.

## File map

| Exact path | Responsibility |
| --- | --- |
| `backend/src/voice/session/voice-session.options.ts` | Server-only snapshot fields and current-config option |
| `backend/src/voice/session/voice-session.service.ts` | Capture, safe capabilities, admission, ticket/reconnect retention |
| `backend/src/voice/transport/voice-connection.ts` | Remove mutable active-mode checks; retain negotiated transport limits |
| `backend/src/voice/usage/voice-usage.service.ts` | Current admission, frozen timers/rates, non-reset daily ledger |
| `backend/src/voice/usage/voice-accounting.ts` | Immutable per-ledger rates; existing terminal-write semantics |
| `backend/src/voice/agent/agent-voice-adapter.ts` | Pass live session snapshot into P3 acceptance |
| `backend/test/voice/session/fixtures.ts` | Reusable revision fixture without network |
| `backend/test/voice/session/config-snapshots.spec.ts` | New/active/disabled/idempotent/racing admission cases |
| `backend/test/voice/usage/fixtures.ts` | New context fields and deterministic pointer publication |
| `backend/test/voice/usage/config-snapshots.spec.ts` | Frozen warnings/idle/rates and quotas across publication |
| `backend/test/voice/usage/operations.spec.ts` | Current speech status without degradation reset |
| `backend/test/voice/providers/accounting.spec.ts` | Stable costs, unknown costs, no secret persistence |
| `backend/test/voice/agent/submission.spec.ts` | Original snapshot for related live turns |
| `backend/test/voice/transport/gateway.spec.ts` | Existing connection survives disable |
| `frontend/src/features/voice/state/voice-capabilities.ts` | Shared safe-data store and explicit refresh |
| `frontend/src/features/voice/state/voice-capabilities.test.ts` | Refresh ordering/failure/subscription tests in Node |
| `frontend/src/features/voice/state/useVoiceCapabilities.ts` | React subscription; initial fetch only |
| `frontend/src/features/voice/state/useLiveVoice.ts` | Read shared capabilities without changing lifecycle ownership |
| `frontend/src/features/voice/dictation/useDictation.ts` | Same subscription for dictation |
| `frontend/src/features/voice/index.ts` | Public refresh export for P5 |
| `frontend/src/features/voice/state/live-voice-controller.ts` | Adopt initial server session queue ceiling, retain it later |
| `frontend/src/features/voice/dictation/dictation-controller.ts` | Adopt initial input ceiling, preserve admitted limits |
| `frontend/src/features/voice/audio/audio-capture-service.ts` | Optional negotiated ceiling on existing reset/unmute |
| `frontend/src/features/voice/audio/audio-capture-processor.ts` | Apply validated ceiling on reset, not a new control protocol |
| `frontend/src/features/voice/audio/audio-playback-service.ts` | Configure initial queue while no response is playing |
| `frontend/src/features/voice/audio/audio-capture-service.test.ts` | Negotiated reset ceiling |
| `frontend/src/features/voice/audio/audio-capture-processor.test.ts` | Worklet ceiling/revision regression |
| `frontend/src/features/voice/audio/audio-playback-service.test.ts` | Pre-response queue configuration fence |
| `frontend/src/features/voice/state/live-voice-controller.test.ts` | Refresh/reconnect/resume keeps session limits |
| `frontend/src/features/voice/state/testing/live-voice-fixture.ts` | Expose capture/playback configuration spies |
| `frontend/src/features/voice/dictation/dictation-controller.test.ts` | Refresh does not change active duration/finalization |
| `frontend/src/features/voice/dictation/testing/dictation-fixture.ts` | Optional negotiated capture argument spy |

Only adjust matching tests under `backend/test/voice/**` and `frontend/src/features/voice/**` when their fixtures need the new context fields or audio method. Do not edit `app.service.ts`, chat-runtime, admin-config, API wire files, App/Sidebar, package manifests, unrelated investigation documents, or CSS.

## Task 1 — Capture one server-only speech snapshot

- [ ] Add this helper to `backend/test/voice/session/fixtures.ts`; import the P1 types/builders and bootstrap loader. Existing `options()` stays usable for static regression fixtures.

```ts
export function revisionFixture() {
  function make(revision: number, edit: (s: ManageableSettings) => void = () => {}) {
    const settings = defaultManageableSettings();
    settings.voice.enabledModes = { dictation: true, live: true };
    edit(settings);
    return buildRuntimeSnapshot(loadBootstrapConfig({}), {
      revision, settings, credentials: { openrouter: null, deepgram: `fixture-speech-${revision}` },
    }, null);
  }
  let value: RuntimeConfigSnapshot | null = make(1);
  const port: CurrentConfigPort = { current: () => value };
  return { port, make, publish: (next: RuntimeConfigSnapshot | null) => { value = next; } };
}
```

- [ ] Create `backend/test/voice/session/config-snapshots.spec.ts`, importing `afterEach`, `expect`, `it`, `vi`, VoiceSessionService, and the fixture exports. Track created services and drain them in afterEach; restore real timers. Add the failing test:

```ts
it('uses current revision for new work but keeps the admitted dictation snapshot', async () => {
  const revisions = revisionFixture();
  const first = revisions.port.current()!;
  const o = { ...options(), currentConfig: revisions.port };
  const service = new VoiceSessionService(o); services.push(service);
  const a = await service.create(request, origin);
  const second = revisions.make(2, s => { s.voice.limits.inputQueueMs = 800; });
  revisions.publish(second);
  const binding = service.claim(a.cookie.split(';')[0], origin);
  expect(binding.configSnapshot).toBe(first);
  expect(binding.voiceConfig).toBe(first.voice);
  expect(a.response.limits.inputQueueMs).toBe(first.voice.limits.inputQueueMs);
  await service.end(a.response.sessionId);
  const b = await service.create({ ...request, idempotencyKey: 'request-0002' }, origin);
  const next = service.claim(b.cookie.split(';')[0], origin);
  expect(next.configSnapshot).toBe(second);
  expect(next.response.limits.inputQueueMs).toBe(800);
  expect(JSON.stringify(service.config())).not.toContain('fixture-speech');
  expect(JSON.stringify(b.response)).not.toContain('configSnapshot');
});
```

- [ ] From `backend`, run `npm test -- test/voice/session/config-snapshots.spec.ts -t "uses current revision"`. Expect a behavioral failure: the context has no captured revision. The P1 interfaces must compile; missing imports/test setup are not the intended red result.
- [ ] In `voice-session.options.ts`, add the imports/fields from the handoff. In `voice-session.service.ts`, add the following private capture method. Dynamic use returns P1's already detached/deep-frozen object; there is no second config builder or secret store.

```ts
private capture(): Pick<SessionContext, 'voiceConfig' | 'configSnapshot'> {
  if (this.options.currentConfig) {
    const snapshot = this.options.currentConfig.current();
    if (!snapshot) fault('VOICE_DISABLED');
    return { configSnapshot: snapshot, voiceConfig: snapshot.voice };
  }
  const voice = structuredClone(this.options.config);
  return { configSnapshot: null,
    voiceConfig: { ...voice, dictationWarningMs: Math.max(0, voice.limits.dictationMaxMs - 30_000) || null } };
}
```

- [ ] Capture only for a genuinely new binding in `createOnce`, before its first await. Build `response.limits` from captured `voiceConfig.limits`, and `context` as `{ identity, response, reservation: null, ...captured }`. Use `entry.response.limits.connectMs` in `issue` and `entry.response.limits.reconnectMs` in both reconnect deadline/timer sites. In `backend/test/voice/usage/fixtures.ts`, add `voiceConfig: { ...structuredClone(config), dictationWarningMs: Math.max(0, config.limits.dictationMaxMs - 30_000) || null }, configSnapshot: null` to the context factory return. No provider or central assembly changes here.
- [ ] Run the focused test, then `npm test -- test/voice/session test/voice/transport test/voice/usage`. Expect passing discovered tests; fix only owned fixture shape drift.
- [ ] Commit exact changed paths with `feat(voice): capture frozen configuration per session` after the orchestrator's commit turn. Never stage a whole directory.

## Task 2 — Current capabilities and new-only admission

- [ ] Extend `config-snapshots.spec.ts` with `it.each(['dictation', 'live'] as const)` covering: create and claim revision 1; publish revision 2 with that mode off; a duplicate POST returns the original ID; a fresh idempotency key rejects VOICE_DISABLED; live disconnect/reconnect still succeeds with original limits/key and incremented epoch; dictation continues until its existing end. Also add port-null and blank-Deepgram cases; neither can fall back to `o.config` even if it contains enabled flags/key.
- [ ] Add a deferred-admission test: hold `o.admission`, publish disabled/lower-concurrency settings while held, release it, expect fresh creation refusal and provisional `release()` exactly once. A second test holds session lookup, publishes new provider settings, and proves the candidate uses one original snapshot rather than mixed fields.
- [ ] Run `npm test -- test/voice/session/config-snapshots.spec.ts`. Expect failures for the current pre-idempotency mode check, reconnect rejection, and stale capability projection.
- [ ] Add this current-speech helper in VoiceSessionService. Reuse the existing redactor and wire limits; project mode availability independently of configuration intent when a key is absent.

```ts
private currentVoice(): VoiceConfig | null {
  return this.options.currentConfig ? this.options.currentConfig.current()?.voice ?? null : this.options.config;
}
config() {
  const voice = this.currentVoice();
  const result = voice ? publicVoiceConfig(voice) : {
    protocolVersion: 1 as const, enabledModes: { dictation: false, live: false },
    supportedLocales: ['en-US'] as ['en-US'], limits: { ...DEFAULT_VOICE_LIMITS },
    inputAudio: { ...INPUT_AUDIO }, outputAudio: { ...OUTPUT_AUDIO },
  };
  if (!voice?.deepgram.apiKey) result.enabledModes = { dictation: false, live: false };
  return result;
}
```

- [ ] Import `VoiceConfig` from P1 and `DEFAULT_VOICE_LIMITS` from voice-wire. In `create`, retain `!accepting` but remove the current mode check before pending/idempotent lookup. In `createOnce`, after the old-binding branch and before capture, require current mode and nonempty Deepgram key. After provisional `admission(context)`, synchronously read current voice again and enforce `!accepting`, mode/key, and current global/identity concurrency before registry insertion. Do not use current settings after registry admission for active transport. Existing error categories remain VOICE_DISABLED/VOICE_QUOTA_EXHAUSTED.
- [ ] Remove the `options.config.enabledModes` check in `claim`; admission already established the mode, and `!accepting` still protects shutdown. Remove `sessions.options.config.enabledModes` from `VoiceConnection.receive`; all existing ticket/origin/epoch/control/queue validation remains. This is the shared root fix, not special handling only in the REST endpoint.
- [ ] In `backend/test/voice/transport/gateway.spec.ts`, add a real VoiceConnection/FakeSocket test: start revision-1 session, publish off, send a valid next input/control, observe flow input/control without session.error or premature release. Reuse its existing framing helpers; close/drain at test end. Do not treat a mocked successful claim as evidence of active transport continuation.
- [ ] Run `npm test -- test/voice/session/config-snapshots.spec.ts test/voice/transport/gateway.spec.ts`, then existing session/transport suites. Expect all assertions passing, including failed allocation releasing owners once.
- [ ] Commit `feat(voice): apply capability edits only to new admission` with only the service, connection, and named tests.

## Task 3 — Frozen clocks/rates with continuous quotas

- [ ] Extend the usage harness to accept `ports.currentConfig`; dynamic contexts are made with `context(snapshot.voice, mode, id)` and then assigned `configSnapshot: snapshot, voiceConfig: snapshot.voice`. Do not mutate P1 snapshots. Add these cases to `backend/test/voice/usage/config-snapshots.spec.ts`:

```ts
it('keeps the admitted dictation warning and duration after publication', async () => {
  const r = revisionFixture();
  const old = r.make(1, s => {
    s.voice.limits.dictationMaxMs = 60_000; s.voice.dictationWarningMs = 40_000;
  });
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  const c = context(old.voice, 'dictation');
  c.configSnapshot = old; c.voiceConfig = old.voice;
  await h.service.admission(c);
  r.publish(r.make(2, s => {
    s.voice.limits.dictationMaxMs = 30_000; s.voice.dictationWarningMs = null;
  }));
  h.time.advance(30_000); expect(h.stops).toEqual([]);
  h.time.advance(10_000); expect(h.warns.map(w => w.code)).toEqual(['VOICE_DURATION_LIMIT']);
  h.time.advance(20_000); expect(h.stops.map(s => s.reason)).toEqual(['duration']);
});
```

- [ ] Add separate small tests: null dictation warning emits none; live activity after publication rearms original idle warning/exit; reconnect does not renew duration or admission; new duration/rate uses revision 2; lowered concurrency refuses fresh work while two admitted leases remain; consumed daily minutes and admission timestamps survive several revisions; lower daily cap refuses new work without stopping admitted work; increasing caps uses consumed allowance, not zero; known old costs are not repriced; unknown old costs remain unknown after adding rates.
- [ ] Run `npm test -- test/voice/usage/config-snapshots.spec.ts`. Expect the warning test to fail at 40 seconds (existing code derives cap minus 30 seconds), and mixed-rate/idle/current-admission tests to fail.
- [ ] In VoiceUsagePorts add optional currentConfig. In `admission`, read current snapshot once for current mode/key, concurrency, daily limits, and request rate (`snapshot.budgets.maxRequestsPerMinutePerUser`, otherwise existing `admissionPerMinute`). Installed-null port fails closed. Keep admissions, active, closed, attempts, and latency collections in the same service instance. `assertBudget` takes the chosen quotas argument instead of reading startup config. No publish/reset/update-config method.
- [ ] Update `speechStatus` to observe current settings without replacing the degradation flag. Add an operations fixture assertion that off-to-enabled publication changes status, missing key is unconfigured, and an existing degradation flag survives publication. Keep this logic local to VoiceUsageService:

```ts
speechStatus() {
  const voice = this.ports.currentConfig
    ? this.ports.currentConfig.current()?.voice ?? null : this.ports.config;
  const enabled = Boolean(voice && (voice.enabledModes.dictation || voice.enabledModes.live));
  return { enabled, configured: !enabled || Boolean(voice?.deepgram.apiKey), degraded: this.degraded };
}
```
- [ ] Extend Recorded with nonsecret detached `rates`, `limits`, `quotas`, and `dictationWarningMs` from `context.voiceConfig` in `blank`. Do not retain full RuntimeConfigSnapshot/Deepgram/OpenRouter keys in usage rows. In `armDuration` use lease limits/quotas and `lease.dictationWarningMs`; null skips the warning. In `armIdle` use lease limits. Existing daily remaining-budget calculation applies when the lease is first armed; edits do not reschedule or cancel its clocks.
- [ ] Extract this local cost helper, reusing current STT keys and the existing complete/unknown semantics; call it for each row in `snapshot` instead of startup rates. Remove the global startup `ratesKnown` test; with no rows preserve the current safe unconfigured/unknown behavior from current rates. Use the admitted row's spend cap in `usage`, not the new cap, and use current cap only for new admission.

```ts
private cost(row: Recorded): { usd: number; known: boolean } {
  const rates = row.rates;
  let usd = 0;
  let known = rates.novaPerMinuteUsd !== null && rates.fluxSttPerMinuteUsd !== null
    && rates.fluxTtsPerThousandCharsUsd !== null;
  for (const [key, audioMs] of row.stt) {
    const rate = key.endsWith('|nova-3') ? rates.novaPerMinuteUsd : rates.fluxSttPerMinuteUsd;
    if (audioMs === null || rate === null) known = false;
    else usd += audioMs / 60_000 * rate;
  }
  if (!row.charactersComplete || rates.fluxTtsPerThousandCharsUsd === null) known = false;
  else usd += row.ttsCharacters / 1000 * rates.fluxTtsPerThousandCharsUsd;
  return { usd, known };
}
```

- [ ] Add a failing ring-eviction test before changing the ledger: admit/release 257 dictations lasting 1 second each, allowing the fixed admission rate to be 1000; publish several revisions; a new 4-minute daily quota must refuse the 258th session. Existing closed-row ring discards quota evidence at 256. Also verify old-day spend does not consume the next day's daily cap. This is necessary quota-continuity work, not an analytics feature.
- [ ] Keep the bounded diagnostic closed ring. Before evicting a row, roll its elapsed time and `cost(row)` into a compact current-UTC-day, server-user aggregate. No transcript/key arrays, histories, or per-revision ledgers. Add these fields/method and include the aggregate in `consumed` and in a new `dailySpend` helper; spend checks use `dailySpend`, not the all-time diagnostic snapshot.

```ts
private archivedDay = '';
private archived = new Map<string, { ms: number; usd: number; known: boolean }>();
private day() {
  const day = new Date(this.ports.now()).toISOString().slice(0, 10);
  if (day !== this.archivedDay) { this.archivedDay = day; this.archived.clear(); }
  return day;
}
private archive(row: Recorded) {
  if (new Date(row.startedAt).toISOString().slice(0, 10) !== this.day()) return;
  const previous = this.archived.get(row.userId) ?? { ms: 0, usd: 0, known: true };
  const cost = this.cost(row);
  this.archived.set(row.userId, {
    ms: previous.ms + this.elapsed(row), usd: previous.usd + cost.usd,
    known: previous.known && cost.known,
  });
}
private dailySpend(): { usd: number; known: boolean } {
  const day = this.day();
  let usd = 0; let known = true;
  for (const aggregate of this.archived.values()) { usd += aggregate.usd; known &&= aggregate.known; }
  for (const row of [...this.closed, ...this.active.values()]) {
    if (new Date(row.startedAt).toISOString().slice(0, 10) !== day) continue;
    const cost = this.cost(row); usd += cost.usd; known &&= cost.known;
  }
  return { usd, known };
}
```

- [ ] In `release`, replace `closed.shift()` with `const evicted = this.closed.shift(); if (evicted) this.archive(evicted)`. In `consumed`, call `day()` before reading aggregates, sum their `ms` for the relevant user/all users, then add the existing current-day rows. In `assertBudget`, reject known `dailySpend.usd >= quotas.dailySpendUsd`; unknown spend stays unknown, never a fabricated zero/charge-prevention claim. In `usage`, same comparison against row quotas. Do not reset this aggregate on edits. Add a `ponytail:` comment: one server-resolved development identity bounds this daily map; multi-identity admission needs bounded/durable quota storage, not arbitrary client IDs. Preserve existing start-day attribution across midnight; a full cross-day/restart accounting redesign is not authorized here.
- [ ] Run `npm test -- test/voice/usage`. Expect all discovered cases passing, including attribution, deduplication, shutdown, unknown rates, day rollover, and old diagnostic-ring limits. Explicitly note quota history remains process-local and is not newly certified durable across restart.
- [ ] Commit `feat(voice): retain session clocks and accounting across config edits` with service and named fixture/tests only.

## Task 4 — Accounting and related live text turns

- [ ] In `backend/test/voice/providers/accounting.spec.ts`, add a test that starts a ledger at TTS rate 0.015, mutates the static fixture's rate to 0.030, and finishes 1000 characters; expect 0.015, no API key/configSnapshot in any row, `actualCostUsd: null`, and duplicate finish still one terminal write. A null-rate ledger stays null even if the source fixture later gains rates. Dynamic ledger fixture passes the deeply frozen `context.voiceConfig` and never mutates it.
- [ ] Run `npm test -- test/voice/providers/accounting.spec.ts`. Expect repricing failure for the mutated static source. In VoiceAccounting, capture just rates once in the constructor and use the captured TTS rate in finish:

```ts
private readonly rates: VoiceConfig['rates'];
// Add to the existing constructor body, before any provider work:
this.rates = Object.freeze({ ...ports.config.rates });
// Replace the finish callback's rate read:
const rate = this.rates.fluxTtsPerThousandCharsUsd;
```

- [ ] Preserve start-before-socket, per-socket/per-response identifiers, pending/terminal write drain, failure propagation, STT observed-versus-billed distinction, and no text/provider replay. P6 changes its own `openVoice` to pass `context.voiceConfig` to each ledger and adapter on every reconnect; do not edit assembly or add another accounting authority.
- [ ] Confirm P3's server-only SubmitLiveTurn snapshot interface through the orchestrator before the bridge change. Extend `backend/test/voice/agent/submission.spec.ts` with a dynamic live session: submit one finalized input, publish revision 2, submit a distinct related turn, and assert both mocked `submitLiveTurn` calls have `configSnapshot` identical to revision 1. A new live session receives revision 2. Reuse existing bind callback and reservation assertions; drain both services. This tests forwarding, not P3 execution.
- [ ] Run `npm test -- test/voice/agent/submission.spec.ts`. Expect absence of the snapshot in the mock calls. Amend only `AgentVoiceAdapter.submit`'s server command:

```ts
return this.runtime.submitLiveTurn({ identity: c.identity, sessionId, content: input.text,
  idempotencyKey, reservation: c.reservation,
  ...(c.configSnapshot ? { configSnapshot: c.configSnapshot } : {}) });
```

- [ ] Run `npm test -- test/voice/providers test/voice/agent test/voice/session/live.spec.ts`. P3/P6/P7 must additionally prove actual live inference/model retry uses that original snapshot, including reconnect; forwarding alone does not satisfy that integrated exit gate.
- [ ] Commit `feat(voice): preserve accounting and live-turn snapshot provenance` with ledger/adapter/named tests only. If P3 has not supplied the interface, report this step blocked; never cast away the mismatch or silently omit the snapshot to get green compilation.

## Task 5 — Shared safe capabilities refresh

- [ ] Create `frontend/src/features/voice/state/voice-capabilities.test.ts`. Use PublicVoiceConfig from existing protocol and `config` from `liveVoiceFixture` for data only. Add these failing tests with `createVoiceCapabilitiesStore` imported from the new file:

```ts
it('publishes refreshed capabilities without mutating an earlier safe snapshot', async () => {
  const a = liveVoiceFixture().config;
  const b = { ...a, enabledModes: { dictation: false, live: true },
    limits: { ...a.limits, inputQueueMs: 800 } };
  const load = vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b);
  const store = createVoiceCapabilitiesStore(load);
  const changed = vi.fn(); const unsubscribe = store.subscribe(changed);
  expect(store.getSnapshot()).toBeNull(); expect(load).not.toHaveBeenCalled();
  await store.ensureLoaded(); const admitted = store.getSnapshot()!;
  await store.refresh();
  expect(store.getSnapshot()).toEqual(b);
  expect(store.getSnapshot()).toBe(store.getSnapshot());
  expect(admitted.enabledModes.dictation).toBe(true);
  expect(admitted.limits.inputQueueMs).toBe(a.limits.inputQueueMs);
  unsubscribe(); await store.refresh(); expect(changed).toHaveBeenCalledTimes(2);
});
```

- [ ] Add tests for two initial subscribers coalescing one load, slow old success arriving after newer success, abort signal passed to superseded request, refreshed failure giving null/false without unhandled rejection, and late old failure not clearing newer success. Node environment only; no new DOM framework or storage APIs.
- [ ] Run from `frontend`: `npm test -- src/features/voice/state/voice-capabilities.test.ts`. Expect missing implementation first, then verify each behavioral assertion red before adding its branch.
- [ ] Create `state/voice-capabilities.ts` with this small safe-data store; no controller/resource references and no network call on import/render. It clones/freeze-projects only the existing public payload.

```ts
import { VoiceHttpClient } from '../../../api/voice-client.ts';
import type { PublicVoiceConfig } from '../../../api/voice-protocol.ts';

export function createVoiceCapabilitiesStore(load: (signal: AbortSignal) => Promise<PublicVoiceConfig>) {
  let value: PublicVoiceConfig | null = null;
  let requested = false;
  let epoch = 0;
  let abort: AbortController | undefined;
  let pending: Promise<boolean> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: PublicVoiceConfig | null) => {
    value = next; listeners.forEach(listener => listener());
  };
  const refresh = () => {
    requested = true; abort?.abort(); abort = new AbortController();
    const sequence = ++epoch; const signal = abort.signal;
    pending = (async () => {
      try {
        const next = await load(signal);
        if (sequence !== epoch || signal.aborted) return false;
        const copy = structuredClone(next);
        Object.freeze(copy.enabledModes); Object.freeze(copy.limits);
        Object.freeze(copy.supportedLocales); Object.freeze(copy.inputAudio); Object.freeze(copy.outputAudio);
        publish(Object.freeze(copy)); return true;
      } catch {
        if (sequence === epoch && !signal.aborted) publish(null);
        return false;
      }
    })();
    return pending;
  };
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    ensureLoaded: () => requested ? pending ?? Promise.resolve(value !== null) : refresh(),
  };
}
const http = new VoiceHttpClient();
export const voiceCapabilities = createVoiceCapabilitiesStore(signal => http.config(signal));
export function refreshVoiceCapabilities(): Promise<boolean> { return voiceCapabilities.refresh(); }
```

- [ ] Create `state/useVoiceCapabilities.ts` with this hook; stable snapshot/subscription follows the existing React external-store pattern. Mounted lifecycle owners do not depend on capability value and are never remounted after publication.

```ts
import { useEffect, useSyncExternalStore } from 'react';
import { voiceCapabilities } from './voice-capabilities.ts';
const serverSnapshot = () => null;
export function useVoiceCapabilities() {
  const config = useSyncExternalStore(voiceCapabilities.subscribe, voiceCapabilities.getSnapshot, serverSnapshot);
  useEffect(() => { void voiceCapabilities.ensureLoaded(); }, []);
  return config;
}
```

- [ ] In both useLiveVoice/useDictation replace config useState plus one-time HTTP-config effects with `const config = useVoiceCapabilities()`. Remove only unused PublicVoiceConfig imports; keep their existing `http` for session commands, useState controller identity, microphone gesture start, lifecycle effects, leases, and draft handling. Export `refreshVoiceCapabilities` in `index.ts`. Hook effect cleanup removes subscriptions; it must not abort a shared fetch merely because one consumer unmounts. HTTP load already has a finite timeout.
- [ ] Run `npm test -- src/features/voice/state/voice-capabilities.test.ts src/features/voice/live/live-voice-composition.test.ts src/features/voice/dictation/dictation-composition.test.ts`, then `npm run build`. Expect passing tests and compilation; adjust owned composition expectations only for the new import, not weakened lifecycle assertions.
- [ ] Commit `feat(voice): expose safe capability refresh for admin saves` with six named source/test files plus the two hooks. Hand the export/signature to P5 immediately.

## Task 6 — Initial negotiated queues, not active renegotiation

Public capabilities can become stale while microphone permission is pending. Initial POST/ready limits are authoritative; capability refresh must never reconfigure an already negotiated session. Keep gesture-driven audio acquisition before the first await.

- [ ] Add a capture-service test using existing FakeContext/FakeNode: start muted at 1000 ms, call `setMuted(false, 800)`, assert the existing reset message contains `maxPendingMs: 800`; muting/resuming without another limit retains it. Add worklet tests with the existing global AudioWorklet fake showing reset updates maxFrames only for a valid bounded limit, clears pending frames, acknowledges matching revision, and rejects malformed limits by keeping the previous ceiling.
- [ ] Add a playback-service test: configure 400 ms while idle after unlock, begin/enqueue over that ceiling and expect AUDIO_BUFFER_OVERFLOW; configure while accepting/queued throws VOICE_INVALID_STATE. Bounds use `isVoiceLimits({ ...DEFAULT_VOICE_LIMITS, outputQueueMs: ms })`; no looser hand-written range.
- [ ] Run `npm test -- src/features/voice/audio/audio-capture-service.test.ts src/features/voice/audio/audio-capture-processor.test.ts src/features/voice/audio/audio-playback-service.test.ts`. Expect missing configuration method/message failures.
- [ ] In AudioCaptureService extend `setMuted(muted: boolean, maxPendingMs?: number)`. Before reset validate optional `maxPendingMs` with existing `isVoiceLimits({ ...DEFAULT_VOICE_LIMITS, inputQueueMs: maxPendingMs })`, require muted/currently non-accepting capture when changing it, and retain it in a private optional field. Include its retained value in reset. Existing no-argument mute callers stay compatible. In the processor remove readonly on maxFrames, validate reset `maxPendingMs` the same way, and update before clearing pending/resampler. No mic restart or second permission request.

```ts
// Additional capture-service field:
private sessionPendingMs?: number;
// Before the existing reset logic in setMuted:
if (maxPendingMs !== undefined) {
  if (this.accepting || !isVoiceLimits({ ...DEFAULT_VOICE_LIMITS, inputQueueMs: maxPendingMs }))
    throw new Error('VOICE_INVALID_STATE');
  this.sessionPendingMs = maxPendingMs;
}
// Replace its reset postMessage:
node.port.postMessage({ type: 'reset', revision, muted,
  ...(this.sessionPendingMs === undefined ? {} : { maxPendingMs: this.sessionPendingMs }) });
// Add inside processor's existing reset branch, before resampler.reset:
if (data.maxPendingMs !== undefined &&
    isVoiceLimits({ ...DEFAULT_VOICE_LIMITS, inputQueueMs: data.maxPendingMs })) {
  this.maxFrames = Math.max(1, Math.floor(data.maxPendingMs / 80));
}
```

- [ ] In AudioPlaybackService remove readonly from queueMs and add the following; no reset/dispose/unlock or playing-node interruption as a side effect. Add `'configureSessionQueue'` to the live controller's existing playback Pick. In `state/testing/live-voice-fixture.ts`, immediately after creating playback add `const configureSessionQueue = vi.spyOn(playback, 'configureSessionQueue')` and return that spy; the actual method still runs in controller tests. Extend both capture fixture spies to `(muted: boolean, maxPendingMs?: number)` so recorded calls have the negotiated argument.

```ts
configureSessionQueue(ms: number) {
  if (this.accepting || this.entries.length ||
      !isVoiceLimits({ ...DEFAULT_VOICE_LIMITS, outputQueueMs: ms })) throw new Error('VOICE_INVALID_STATE');
  this.queueMs = ms;
}
```

- [ ] In DictationController.ready, use `await run.capture!.setMuted(false, run.session!.limits.inputQueueMs)`; its duration/finalization timers already read run.session. In LiveVoiceController.start, after create/current fencing and before client.connect, call `run.playback.configureSessionQueue(run.session.limits.outputQueueMs)`. In its initial ready use `setMuted(false, run.session!.limits.inputQueueMs)`. On resume newly acquired capture uses existing `run.session.limits.inputQueueMs`; its first setMuted can receive the same retained ceiling. Never call either configuration method from the capability hook, refresh handler, mute toggle, or recovered callback. Reconnect returns the server's same admitted limits; no revision-based renegotiation.
- [ ] Add these controller failing-test examples before those changes, using existing fixtures/spies and their ready-event helpers:

```ts
it('adopts initial POST limits and ignores newer capabilities while active', async () => {
  const f = liveVoiceFixture();
  f.response.limits = { ...f.response.limits, inputQueueMs: 800, outputQueueMs: 400 };
  await f.begin();
  expect(f.capture.setMuted).toHaveBeenCalledWith(false, 800);
  expect(f.configureSessionQueue).toHaveBeenCalledWith(400);
  const calls = f.configureSessionQueue.mock.calls.length;
  const newer = { ...f.config, enabledModes: { dictation: false, live: false },
    limits: { ...f.config.limits, inputQueueMs: 1600, outputQueueMs: 1600 } };
  await f.controller.start({ text: 'must not replace', start: 0, end: 0, direction: 'none' }, null, newer);
  expect(f.http.create).toHaveBeenCalledTimes(1);
  expect(f.configureSessionQueue).toHaveBeenCalledTimes(calls);
  expect(f.client.dispose).not.toHaveBeenCalled();
  f.controller.exit(); await settle();
});
```

- [ ] Add a store-plus-controller test, not only the guarded second-start test: load capabilities A, start controller from A, refresh store to disabled B, assert no end/dispose/new microphone work; trigger lost/recovered/ready/resume with existing fixture callbacks and original response limits, assert original capture ceiling and no playback reconfigure. A fresh session attempt uses B/off and does not claim input. Dictation similarly refreshes while recording then advances fake time to original duration/finalization and keeps accepted draft segments. Keep the real negotiated values in responses; do not replace them with the refreshed public limits in test setup.
- [ ] Run focused controller/audio tests, then `npm test -- src/features/voice`. Expect passing discovered tests; maintain original disposal/mute/playback/draft assertions when mocks adopt the optional capture argument. Actual dashboard navigation/gesture/browser inspection is P5/P7 evidence, not established by these Node tests.
- [ ] Commit `feat(voice): retain negotiated browser session limits across refresh` with only the listed audio/controller/fixture/test files. No visual surface/style changes.

## Task 7 — Verification and exit handoff

- [ ] Scan every caller of modified methods (`currentConfig`, `SessionContext`, `setMuted`, provider constructors, `submitLiveTurn`) with grep. Confirm dynamic providers only take session speech config in P6 assembly; legacy static adapters remain fixture/import compatibility only. Report external-owned call sites to their owners; do not patch them.
- [ ] From `backend`, run individually: `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`. From `frontend`, run individually: `npm run build`, `npm run lint`, `npm test`. Record actual counts/failures/skips; unrelated failures are blockers routed to owners, not silently fixed. Native/service suites needing operator prerequisites are skipped explicitly; no zero-test run counts as a pass.
- [ ] Use `git diff --check` and confirm named-file ownership. Obtain commit turns, stage exact named task files, and commit only those files. Example for task 2:

```powershell
git add -- backend/src/voice/session/voice-session.service.ts backend/src/voice/transport/voice-connection.ts backend/test/voice/session/config-snapshots.spec.ts backend/test/voice/transport/gateway.spec.ts
git commit --only -m "feat(voice): apply capability edits only to new admission" -- backend/src/voice/session/voice-session.service.ts backend/src/voice/transport/voice-connection.ts backend/test/voice/session/config-snapshots.spec.ts backend/test/voice/transport/gateway.spec.ts
```

- [ ] Return commits, changed paths, actual fixture results, P5 refresh API, P3 live snapshot handoff, and P6 assembly requirements. Do not write state/final-report/P7 evidence. All required live execution gates that await P3/P6/P7 remain pending rather than being inferred from forwarding tests.

| P4 exit / goal acceptance | Evidence and owning integration |
| --- | --- |
| New versus active keys/limits, AC5 | Session snapshot tests; P6/P7 real adapter factory fixture verifies headers/URLs for original versus new revisions |
| Reconnect and related live turns, AC5/AC8 | Session/transport/live submission tests; P3/P6/P7 execute fixture turns/retries across publication, retain revision, no repeated inference |
| Capabilities refresh without active renegotiation, AC5 | Safe store ordering tests + controllers/audio tests; P5/P7 actual navigation/browser gesture inspection |
| Disabled modes and lower admission ceilings, AC6 | Idempotent existing session/reconnect succeeds; fresh/racing admission refused; provisional owners released once |
| Daily/rate quotas and no reset, AC5/AC8 | Same service across revisions, old-rate/unknown-rate accounting, fixed warning/idle timers, lower caps, day rollover, 257-session eviction test |
| No secrets in safe responses/usage records, AC3/AC8 | Explicit redacted projection/ledger tests; P2/P6/P7 combined persistence/log exposure checks |

## Risks and release gates

- Current source has no P3 live snapshot argument. Its server-only acceptance implementation is an interface coordination dependency, not permission for P4 to edit runtime/contracts. If unavailable, task 4 and actual live-turn exit evidence stay blocked.
- P6 owns the current-config source and adapter/accounting construction. Without its cutover, P4 unit fixtures do not establish database-only runtime consumption or actual reconnect provider-key retention. Null current port must never consult legacy key values.
- Existing dictation finalization/delivery adapters intentionally cap at `min(2000, configured finalizationMs)`; retain that immutable ceiling and do not claim values above it extend provider drain. P1 admits the setting; P5 help/P6 docs must describe the effective ceiling. Report any desired ceiling change to P1/orchestrator, not an unrelated provider redesign.
- Quota counters remain process-local, start-day-attributed, with the existing single development identity; edits are not resets, but restart durability and precise cross-midnight apportionment are not newly implemented/certified. Durable billing evidence stays in the existing metadata ledger. Never claim actual spend/billing certainty from configured rates or STT observed audio.
- Retaining a snapshot cannot guarantee that revoked/removed keys remain usable at the provider; errors/cancellation/finalization retain existing handling. It must not replay inference/speech merely to adopt a new key.
- Safe capability refresh failure disables only new browser entry controls and reports false to P5; already active controllers keep their admitted state. Latest-response fencing prevents an old request from re-enabling stale modes.
- P1 top-level readonly types are backed by deep-frozen runtime objects; do not cast away readonly and mutate keyterms/limits. Source drift is reported, never repaired in P1-owned files.

Planning verification: check all listed existing paths and new-path parents; scan this document for unresolved placeholders, source-owner conflicts, type/field drift, AC5/AC6/AC8 coverage, and whitespace. Application checks above are implementation requirements, not checks executed while writing this plan.
