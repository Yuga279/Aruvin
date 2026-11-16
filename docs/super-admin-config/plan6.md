P6 assembles database-backed configuration, confirmed live activation, the explicit environment import command, and operator guidance. The database is the sole source of manageable values; infrastructure and the encryption master key remain environment-only.

Keep AppService as the composition owner. Open persistence once, reuse its admitted RecordStore and owner, and share one frozen current-config pointer among admin, text, HTTP, voice and operations. Prepare candidates without changing live state; P2 performs the atomic write and calls synchronous publication only after confirmation. Reuse the installed NestJS, MongoDB, Zod, Vitest and provider fixtures plus Node crypto; add no dependency.

Planning and later implementation are authorized. Research and unified review are **skipped**. Do not execute the import against an operator database, send live/provider requests, provision infrastructure or deploy. Commands marked operator-only below are documentation, not worker instructions.

## Boundaries and interface decisions

- Read `AGENTS.md`, `goal.md` and `state.md` before implementation. Preserve private environment files, unrelated commits and `.openchamber/` screenshots. Request a serialized commit turn before each implementation commit; stage named files only.
- P1's `parseLegacyConfigImport` only projects/validates a candidate. It does not open storage, validate credentials remotely, encrypt, persist or execute migration. The executable belongs to this plan.
- `openPersistence` currently returns no config repository. **No P2 edit is necessary:** instantiate the existing `MongoConfigRepository` in assembly/import with `opened.owner.store`, `opened.owner`, and `Math.min(MAX_CONFIG_DOCUMENT_BYTES, bootstrap.safety.maxDocumentBytes)`. `owner.store` is backed by the admitted client, including `guardedClient` in local recovery. Never use `owner.controlStore` for config data, expose a raw client, open a new MongoClient, or bypass the mutation journal. Assert this wiring in a central assembly test.
- Keep `AURVIN_CONFIG` as the existing injection token but change its value/type to `BootstrapConfig`. `ServerIdentityResolver` already takes the compatible `IdentityConfigSlice`; it needs no modification or second identity source. `AppService.create(bootstrap, ports)` becomes the production entry. `AppService.config` remains an infrastructure-plus-unconfigured-default `AurvinConfig` adapter for existing persistence/runtime ports, **not** a mutable manageable source.
- Expose `readonly currentConfig: CurrentConfigPort`, `readonly activation: ConfigActivationPort`, `readonly adminConfig: AdminConfigService`, and `adminActor(): AdminConfigActor` from AppService. Keep the actual snapshot pointer private. All consumers receive the same `currentConfig` object, even while `current()` is null.
- Export `configurationAdapter(bootstrap, snapshot): AurvinConfig` and `prepareConfigurationSnapshot(bootstrap, candidate, assets, limitsLoader, fetcher, signal): Promise<RuntimeConfigSnapshot>` from `backend/src/app.service.ts`. These are assembly projections/preparation functions reused by import; importing that module must not construct an application or start Nest. `limitsLoader` has the existing `typeof loadModelLimits` signature. These functions are not another lifecycle owner.
- Construct one admitted runtime independently of whether text credentials are configured. The P3 runtime already rejects new inference when its injected current-config port is null/unconfigured. Pass `limits` only when actually verified; never invent a catalogue capability. This supplies one reservation authority for dictation as well as text/live work without requiring an OpenRouter key to open the admin page.
- Local recovery retains the existing **sequential** stopped maintenance runtime followed by a fresh runtime on the same bundle (`finishLocalMaintenance`). They never overlap as accepting executors. A configuration edit does not run this path, recreate any runtime, or clear recovery evidence. Catalogue/schema/encryption failure remains diagnostic with pending local recovery retained; a later save must not publish while local recovery is pending. Operator restart/reconciliation is then required, not a hidden recovery on Save.
- P3 handoff needed before the provider-gate subtask: expose an optional `ChatRuntime.attemptConfigRevision(userId, sessionId, attemptId): number | null`, reading the existing in-memory attempt snapshot binding only. P3 owns `backend/src/chat-runtime/ports.ts` and `durable-chat-runtime.ts`; P6 must not edit them. This distinguishes a late auth/credit failure from an old accepted attempt from failures of the newly activated credential. If the owner cannot supply this port, record AC5/provider-gate verification blocked and ask the orchestrator for that specific owner follow-up; do not guess from current revision or read private runtime maps.
- Package-script convenience is optional: ask P1 to add `"config:import": "node --enable-source-maps dist/scripts/import-config.js"` if desired. The working command already uses built Node directly, so P6 need not edit manifests/lockfiles.

## File map

| Action | Exact path | Responsibility |
| --- | --- | --- |
| Modify | `backend/src/platform/platform.module.ts` | Infrastructure bootstrap token and one value-free legacy notice per Nest composition. |
| Modify | `backend/src/app.service.ts` | Shared config repository/credentials/admin owner; pure preparation; pointer publication; current-config injection; config mutation drain. |
| Modify | `backend/src/app.module.ts` | Register existing admin module against that same AppService and server actor. |
| Modify | `backend/src/main.ts` | Admin middleware before generic JSON parser; PUT CORS and guarded HTTPS ingress; unchanged loopback/IPC shutdown. |
| Modify | `backend/src/operations/options.ts`, `operations.service.ts`, `readiness.ts`, `admission.ts`, `observed-runtime.ts` | Dynamic gates without resetting rate counters; revision-scoped passive provider failures; config stop/drain integrated into the one shutdown path. |
| Create | `backend/src/scripts/import-config.ts` | Explicit, directly guarded, empty-store-only import and sanitized CLI. |
| Create | `backend/test/assembly/admin-config-fixture.ts`, `admin-config.spec.ts`, `admin-http.spec.ts`, `config-drain.spec.ts` | Central offline fixture and assembled behavior/security/lifecycle checks. |
| Create | `backend/src/platform/platform.module.spec.ts`, `backend/src/scripts/import-config.spec.ts`, `backend/test/assembly/config-docs.spec.ts` | Bootstrap DI, import function/CLI, source-map/docs checks. |
| Update as needed | `backend/src/app.controller.spec.ts`, `backend/test/app.e2e-spec.ts`, `backend/test/assembly/voice-bootstrap.e2e-spec.ts`, `backend/test/operations/local-startup.spec.ts`, `backend/test/operations/bootstrap.spec.ts` | Existing central assembly callers switch to bootstrap input and explicit stored fixtures, never env-driven production fallback. |
| Modify | `backend/.env.example`, `README.md`, `setup.bat`, `run.bat` | Infrastructure-only example and setup/run messaging; no automatic import/key generation. |
| Create | `docs/super-admin-config/operations.md` | Import, transport, diagnostics, backup/restore/manual cleanup/rollback runbook; P7 later owns evidence entries. |

There is no root `.env.example`; the actual setup input is `backend/.env.example`. Do not create a competing example. Do not modify P1–P5/P7-owned source/tests. Existing `backend/test/integration/**` AppService callers are for P7 to reconcile with the new bootstrap/stored-fixture contract. Report those exact callers rather than preserving a production env-key fallback to make old tests green. Actual implementation code still follows repository source-header rules; this plan and its samples intentionally omit header boilerplate.

## 1. Cut over platform bootstrap, without manageable env reads

Files: `backend/src/platform/platform.module.ts`, new `backend/src/platform/platform.module.spec.ts`.

- [ ] Add the failing test below. Give the test an isolated explicit environment, restore all modified variables after it, and spy on stderr so no private process environment is printed. Compile the real PlatformModule with `@nestjs/testing`.

```ts
it('loads infrastructure only and emits obsolete names once', async () => {
  for (const name of [...BOOTSTRAP_ENV_NAMES, ...LEGACY_MANAGEABLE_ENV_NAMES])
    vi.stubEnv(name, undefined);
  vi.stubEnv('OPENROUTER_API_KEY', 'fixture-obsolete-key');
  vi.stubEnv('MAX_INPUT_CHARS', 'not-a-number');
  vi.stubEnv('MONGODB_URI', '');
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('FRONTEND_ORIGIN', 'http://localhost:5173');
  const warning = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const module = await Test.createTestingModule({ imports: [PlatformModule] }).compile();
  const first = module.get<BootstrapConfig>(AURVIN_CONFIG);
  expect(module.get(AURVIN_CONFIG)).toBe(first);
  expect(first).toHaveProperty('safety');
  expect(first).not.toHaveProperty('openRouter');
  expect(module.get(ServerIdentityResolver).resolve().source).toBe('server-configured');
  expect(warning).toHaveBeenCalledTimes(1);
  const line = String(warning.mock.calls[0]![0]);
  expect(line).toContain('OPENROUTER_API_KEY');
  expect(line).toContain('MAX_INPUT_CHARS');
  expect(line).not.toContain('fixture-obsolete-key');
  expect(line).not.toContain('not-a-number');
  await module.close();
});
```

- [ ] Run from `backend`: `npm test -- src/platform/platform.module.spec.ts -t "loads infrastructure only"`. Expect red: legacy parser rejects the obsolete numeric value or token lacks `safety`.
- [ ] Replace only the provider factory/import in PlatformModule. The singleton factory emits once; do not emit in health reads, AppService preparation, identity resolution or every request.

```ts
useFactory: () => {
  const bootstrap = loadBootstrapConfig(process.env);
  const warning = legacyConfigWarning(process.env);
  if (warning) process.stderr.write(`${warning}\n`);
  return bootstrap;
},
```

- [ ] Add a second test with no obsolete names and no notice, and one where invalid infrastructure still rejects startup with static `CONFIGURATION_ERROR`. Use `vi.unstubAllEnvs()` and `vi.restoreAllMocks()` in cleanup.
- [ ] Rerun the focused suite; all assertions must pass without providers/storage being called.
- [ ] Commit only these two files: `refactor(config): load infrastructure-only Nest bootstrap`.

## 2. Add pure preparation and a bounded central fixture

Files: `backend/src/app.service.ts`, new `backend/test/assembly/admin-config-fixture.ts`, `admin-config.spec.ts`.

- [ ] Build an offline fixture using the existing `fixtureOptions()` from `backend/test/http/fixtures.ts` for sessions/messages/runtime, `assets` from `backend/test/context/fixtures.ts`, and `CredentialService` for real fixture encryption. Use an explicit native-profile bootstrap with URI `fixture-injected-only`, master key `Buffer.alloc(32, 7).toString('base64')`, and development loopback origin. Never load `.env` in tests.
- [ ] Define fixture API in that file: `assemblyFixture(initial: StoredConfigDocument | null = null)` returns `{ bootstrap, ports, repository, credentials, stored, seed, open, limits, runtime, close, raw, logs }`. `stored()` clones its current document; `seed(document)` replaces that clone only in fixture memory. `ports.open` returns the fake bundle once. `ports.assets` returns existing `assets`. `ports.fetcher` rejects every unhandled request with a static fixture error. `ports.runtime` returns `raw = fixtureOptions().runtime`; attach a typed reservation/voice bridge stub only to tests needing voice. `ports.limits` returns `{ modelId: c.openRouter.modelId, contextTokens: 32768, outputTokens: 4096, supportsMaxTokens: true, source: 'fixture' }`. Every method is a `vi.fn` so call counts/order are assertable.
- [ ] In the assembly specs reuse `document`, `secret`, and `at` from `backend/test/admin-config/fixtures.ts`; import the real bootstrap/settings/credential/repository contracts with `.js` specifiers. Keep an internal `let stored = initial === null ? null : structuredClone(initial)` in the fixture, distinct from its returned `stored()` function. Define deferred promises directly in the assembly fixture for later tests:

```ts
export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
```
- [ ] Give the fake bundle one owner with `store`, `assertExecutor`, `observedExecutor`, and `drain`, the existing fixture repositories, metadata/checkpoint stubs, `ping: async () => true`, and `close` spy. Add optional `configRepository?: (opened: OpenedPersistence) => ConfigRepository` to AssemblyPorts so this fixture can supply a strongly typed in-memory repository; production default always constructs MongoConfigRepository from `owner.store`. Do not cast production code to an invented bundle shape. The in-memory repository implements confirmed/conflict results as follows:

```ts
const repository: ConfigRepository = {
  read: vi.fn(async () => stored === null ? null : structuredClone(stored)),
  createIfAbsent: vi.fn(async document => {
    if (stored) return { outcome: 'conflict', currentRevision: stored.revision };
    stored = structuredClone(document);
    return { outcome: 'confirmed', document: structuredClone(document) };
  }),
  compareAndSwap: vi.fn(async (expected, document) => {
    if (stored?.revision !== expected)
      return { outcome: 'conflict', currentRevision: stored?.revision ?? 0 };
    stored = structuredClone(document);
    return { outcome: 'confirmed', document: structuredClone(document) };
  }),
};
```

- [ ] Add failing pure preparation tests: unconfigured snapshot requires no catalogue; configured snapshot requires matching catalogue limits; fixed assets must fit even with absent credentials; failed catalogue never mutates a current pointer. Example:

```ts
it('prepares unconfigured settings without a catalogue or runtime', async () => {
  const f = assemblyFixture();
  const candidate = { revision: 0, settings: defaultManageableSettings(),
    credentials: { openrouter: null, deepgram: null } };
  const snapshot = await prepareConfigurationSnapshot(f.bootstrap, candidate, assets,
    f.limits, f.ports.fetcher!, new AbortController().signal);
  expect(snapshot.revision).toBe(0);
  expect(snapshot.modelLimits).toBeNull();
  expect(snapshot.openRouter.apiKey).toBe('');
  expect(snapshot.voice.enabledModes).toEqual({ dictation: false, live: false });
  expect(Object.isFrozen(snapshot.voice)).toBe(true);
  expect(f.limits).not.toHaveBeenCalled();
  expect(f.runtime).not.toHaveBeenCalled();
});
```

- [ ] Run `npm test -- test/assembly/admin-config.spec.ts -t "prepares"`. Expect red: missing preparation export, not an accidental provider request.
- [ ] Implement the two named assembly projections. Import existing `composeRuntimeBudgets`, `validateManageableSettings`, `buildRuntimeSnapshot`, `defaultManageableSettings`, `assertFixedContextFits` and `loadModelLimits`; do not duplicate parsers or model rules.

```ts
export function configurationAdapter(
  bootstrap: BootstrapConfig, snapshot: RuntimeConfigSnapshot,
): AurvinConfig {
  return {
    port: bootstrap.port, frontendOrigin: bootstrap.frontendOrigin,
    nodeEnv: bootstrap.nodeEnv, identity: bootstrap.identity,
    persistence: bootstrap.persistence, topology: bootstrap.topology,
    budgets: { ...snapshot.budgets }, openRouter: { ...snapshot.openRouter },
    voice: snapshot.voice,
  };
}

export async function prepareConfigurationSnapshot(
  bootstrap: BootstrapConfig, candidate: SnapshotCandidate, assets: FixedAssets,
  limitsLoader: typeof loadModelLimits, fetcher: typeof fetch, signal: AbortSignal,
): Promise<RuntimeConfigSnapshot> {
  const settings = validateManageableSettings(candidate.settings, bootstrap);
  const budgets = composeRuntimeBudgets(settings, bootstrap.safety);
  assertFixedContextFits(assets, budgets);
  const configured = Boolean(candidate.credentials.openrouter) && settings.openRouter.modelId !== '';
  const modelConfig = { identity: bootstrap.identity, budgets, openRouter: {
    ...settings.openRouter, apiKey: candidate.credentials.openrouter ?? '',
  } };
  const limits = configured ? await limitsLoader(modelConfig, signal, fetcher) : null;
  if (signal.aborted) throw new AdminConfigFault('CONFIG_ACTIVATION_UNAVAILABLE');
  return buildRuntimeSnapshot(bootstrap, { ...candidate, settings }, limits);
}
```

- [ ] Use a revision-0 no-credential `buildRuntimeSnapshot` solely to produce the infrastructure/default adapter before opening storage. This adapter must never carry environment keys or the master key. Its manageable defaults are not an active revision and do not override stored settings.
- [ ] Rerun focused tests; add invalid cross-field/input/storage cap cases and configured model/output mismatch cases. Expect no runtime/open calls in these pure tests.
- [ ] Commit the three named files: `feat(config): prepare detached assembly snapshots without side effects`.

## 3. Open once, read/decrypt before admission, and keep admin independent

Files: `backend/src/app.service.ts`, `backend/test/assembly/admin-config.spec.ts`, `backend/src/app.controller.spec.ts`.

- [ ] Add the blank-store failing test before changing initialization:

```ts
it('opens one bundle and keeps blank-key admin usable with chat not ready', async () => {
  const f = assemblyFixture();
  const service = await AppService.create(f.bootstrap, f.ports);
  expect(f.open).toHaveBeenCalledTimes(1);
  expect(f.repository.read).toHaveBeenCalledTimes(1);
  expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
  expect(f.runtime).toHaveBeenCalledTimes(1);
  expect(f.runtime.mock.calls[0]![0].currentConfig).toBe(service.currentConfig);
  expect(await service.adminConfig.read()).toMatchObject({
    revision: 0, state: 'missing', activation: 'unconfigured',
  });
  expect((await service.operations.readiness.read()).acceptReady).toBe(false);
  expect(f.limits).not.toHaveBeenCalled();
  await service.operations.shutdown();
  expect(f.close).toHaveBeenCalledTimes(1);
});
```

- [ ] Run `npm test -- test/assembly/admin-config.spec.ts -t "opens one bundle"`; expect missing bootstrap/admin/current-config wiring.
- [ ] Change AppService constructor/create input to BootstrapConfig. Create identity, telemetry, admin, voice usage/session, operations and lazy repositories exactly once. Create `CredentialService(bootstrap.encryption, new CredentialValidator(ports.fetcher))` once. A missing-storage ConfigRepository delegate throws `new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE')` for every operation rather than supplying local persisted defaults.
- [ ] Production repository assembly is exactly this, performed after the one successful open:

```ts
this.configRepository = this.ports.configRepository
  ? this.ports.configRepository(this.opened)
  : new MongoConfigRepository(this.opened.owner.store, this.opened.owner,
      Math.min(MAX_CONFIG_DOCUMENT_BYTES, this.bootstrap.safety.maxDocumentBytes));
```

- [ ] Initialization order: load immutable assets; open guarded bundle once; install observed persistence plus the shared config repository; read singleton; validate stored settings against infrastructure caps; decrypt exclusively through CredentialService; prepare the snapshot; perform required existing local maintenance; construct/expose the admitted runtime; set initial pointer. Do not write defaults on boot. A missing document is an unconfigured revision-0 default snapshot, not revision 1 persisted behind the operator's back.
- [ ] For no URI/open unavailable, leave the pointer null and runtime absent, but return diagnostic service with independently available admin routes. If URI is supplied with a non-native/unknown profile, do not open/write an unverified config store; expose diagnostic storage-unavailable status. Update the old central P9 test that expected an attempted non-native open accordingly. DB reconnect is an operator restart, not a retry loop creating overlapping owners. Competing/stale executor or unsupported local recovery remains a hard, value-free startup refusal. Do not catch it as ordinary storage outage.
- [ ] For stored-schema/byte-bound/cross-field failure, preserve the document and keep the pointer null; admin reads report `CONFIG_STORED_INVALID` or redacted blocked state as applicable, no mutation silently overwrites invalid data. For missing/invalid/wrong master key or tampered envelope, keep admin GET redacted and blocked/unconfigured, no credential activation/save and no env fallback. For catalogue failure, preserve archive reads/admin and fail generation readiness; no guessed model limits or paid probes. Record only closed diagnostic codes in telemetry, never thrown text, keys, envelopes, URI or serialized bootstrap.
- [ ] Build one runtime with currentConfig on nonlocal healthy storage even if the pointer is null/unconfigured; dynamic P3 admission still rejects inference. On local pending recovery, do not construct an accepting runtime until preparation and `finishLocalMaintenance` succeed. Guard `assertWritable` against pending recovery so admin cannot claim activation through an unreconciled executor. Do not call `finishLocalRecovery` from admin Save.
- [ ] Add table-driven tests for no URI, unadmitted profile, open rejection, ownership refusal, malformed stored schema, wrong/missing/invalid encryption key, tampered ciphertext, invalid stored limits, and catalogue outage. Assert no write, no fallback to obsolete env, no paid/provider socket request, liveness true, chat not ready, static errors and stored data unchanged; ownership refusal is the deliberate hard-startup exception. For configured startup, assert repository read/decrypt/preparation precede runtime admission and the runtime sees only verified frozen config. Spy the real MongoConfigRepository constructor in an isolated wiring test to assert the supplied store is `opened.owner.store`, not its separate controlStore.
- [ ] Update central P9 fixture tests to explicit stored documents/encrypted fixture keys and BootstrapConfig. Never call `parseLegacyConfigImport` during normal boot just to retain a legacy test.
- [ ] Run `npm test -- test/assembly/admin-config.spec.ts src/app.controller.spec.ts`. Native-gated skips must be reported separately.
- [ ] Commit named changed files: `feat(config): bootstrap admin and chat from one guarded config owner`.

## 4. Publish only confirmed candidates; inject text and voice snapshots

Files: `backend/src/app.service.ts`, `backend/test/assembly/admin-config.spec.ts`, `backend/test/assembly/voice-bootstrap.e2e-spec.ts`.

- [ ] Add a deferred CAS test. Define `deferred<T>()` locally as `{ promise, resolve, reject }` using the Promise constructor, and a `writeStarted` deferred resolved by the CAS spy; use it instead of sleeps. Seed an encrypted configured document at revision 1 and keep references to the runtime/reservations/usage/session owners.

```ts
it('publishes only after a confirmed write without replacing owners', async () => {
  const f = assemblyFixture();
  const stored = document(1);
  stored.settings.openRouter.modelId = 'fixture/model';
  stored.credentials.openrouter = {
    envelope: f.credentials.seal('openrouter', secret), validatedAt: at,
  };
  f.seed(stored);
  const service = await AppService.create(f.bootstrap, f.ports);
  const old = service.currentConfig.current();
  const usage = service.voiceUsage;
  const sessions = service.voiceSessions;
  const write = deferred<ConfigCasResult>();
  const started = deferred<void>();
  vi.mocked(f.repository.compareAndSwap).mockImplementationOnce(async () => {
    started.resolve();
    return write.promise;
  });
  const settings = structuredClone(stored.settings);
  settings.chat.titleMaxChars = 70;
  const saving = service.adminConfig.saveSettings({
    protocolVersion: 1, expectedRevision: 1, settings,
  }, service.adminActor());
  await started.promise;
  expect(service.currentConfig.current()).toBe(old);
  write.resolve({ outcome: 'confirmed', document: {
    ...stored, revision: 2, settings,
  } });
  expect(await saving).toMatchObject({ revision: 2, activeRevision: 2 });
  expect(service.currentConfig.current()?.budgets.titleMaxChars).toBe(70);
  expect(service.voiceUsage).toBe(usage);
  expect(service.voiceSessions).toBe(sessions);
  expect(f.open).toHaveBeenCalledTimes(1);
  expect(f.runtime).toHaveBeenCalledTimes(1);
  await service.operations.shutdown();
});
```

- [ ] Run `npm test -- test/assembly/admin-config.spec.ts -t "publishes only"`; expect red until activation is wired.
- [ ] Instantiate AdminConfigService with the shared repository, credentials, bootstrap, activation/current ports and `assertWritable`. Preparation calls only `prepareConfigurationSnapshot` with the immutable loaded assets, injected limits/fetch and a bounded AbortController. No constructor/recovery/owner reset happens in prepare/publish.
- [ ] Publication is synchronous and nonthrowing on its normal prepared path: reject closing/quarantined/pending-recovery/stale publication first; then replace the pointer in one assignment. No asynchronous work after publication and no successful response before it. P2 already sequences validate/decrypt/prepare/CAS/read-back and rejects delayed-validation revision conflicts; reuse it instead of a second mutation service. Publication compares monotonic revision and only accepts snapshots from this assembly's preparation, not browser-provided objects.
- [ ] Pass the **same** `currentConfig` to runtime dependencies, `httpOptions`, VoiceSessionService and VoiceUsageService. Update `openVoice` to use `context.voiceConfig` for Nova/Flux/TTS and VoiceAccounting, not `this.config.voice`. The session's snapshot must reach every related provider/accounting operation, including reconnect/live turns. Never re-read current settings inside `openVoice` for an already admitted session.

```ts
const voiceConfig = context.voiceConfig;
const accounting = new VoiceAccounting({
  userId: context.identity.userId,
  voiceSessionId: context.response.sessionId,
  conversationId: () => context.reservation?.conversationId ?? context.response.conversationId,
  config: voiceConfig,
  write: async record => {
    try {
      const store = this.store();
      await store.owner.assertExecutor();
      await store.metadata.putVoiceAccounting(record);
    } catch (error) {
      this.voiceAccountingFailed = true;
      throw error;
    }
  },
});
```

- [ ] Add confirmed revision 1→2 tests for changed key/model/budgets and voice flags/rates, credential removal, absent Deepgram key, and enabling dictation without a configured text model. Assert new work receives revision 2 while already captured snapshot/config remains revision 1. Assert reservation object identity and usage totals survive edits. Use existing recording socket fixture in the central voice-bootstrap e2e suite to inspect auth headers privately in memory and accounting rates; never print them.
- [ ] Add conflict, rejected candidate, encryption failure, write rejection, `outcome: 'uncertain'`, publication refusal and delayed-validation CAS tests. Check old active pointer/credentials unchanged, no success response, no extra runtime/open/usage owner. For uncertain write, mutation boundary remains quarantined; do not publish even if a later unrelated read happens to succeed.
- [ ] Add restart durability test with two **sequential** AppService instances sharing the fixture's encrypted stored document, closing the first before creating the second. Seed obsolete env values and prove they have no effect on reloaded revision/key/model/settings. Fixture reopening is not certification of native restart/Windows process handoff; P7 supplies that evidence.
- [ ] Run `npm test -- test/assembly/admin-config.spec.ts` and `npm run test:e2e -- test/assembly/voice-bootstrap.e2e-spec.ts`.
- [ ] Commit named changed files: `feat(config): publish confirmed snapshots through shared text and voice ports`.

## 5. Update readiness, limits and provider gates without quota reset

Files: `backend/src/operations/options.ts`, `operations.service.ts`, `readiness.ts`, `admission.ts`, `observed-runtime.ts`; `backend/test/assembly/admin-config.spec.ts` and central operations tests.

- [ ] Add a failing dynamic-admission regression to the assembly suite: take two generation rate slots under limit 10, save limit 2, verify next admission is `RATE_LIMITED`, raise limit to 3 and verify exactly one further slot. Keep one Admission instance. Lower process concurrency below already active work, verify no cancel/drain, and reject new work until active count falls below the new ceiling.

```ts
it('keeps admission history when its live ceiling changes', () => {
  let cap = 10;
  const admission = new Admission(() => cap);
  admission.take('generation', 1000);
  admission.take('generation', 1001);
  cap = 2;
  expect(() => admission.take('generation', 1002)).toThrowError(
    expect.objectContaining({ code: 'RATE_LIMITED' }));
  cap = 3;
  expect(() => admission.take('generation', 1003)).not.toThrow();
  expect(() => admission.take('generation', 1004)).toThrowError(
    expect.objectContaining({ code: 'RATE_LIMITED' }));
  expect(() => admission.take('control', 1004)).not.toThrow();
});
```
- [ ] Run `npm test -- test/assembly/admin-config.spec.ts -t "admission"`; expect stale fixed operations budgets or reset counters to fail.
- [ ] Add `currentConfig?: CurrentConfigPort` to OperationsOptions and pass the shared port from AppService. Retain legacy operations fixture support **only when no port is supplied**. When supplied and null/unconfigured, no fallback may admit generation. Derive readiness manageable/privacy/model/voice checks from that snapshot and infrastructure checks/deadlines from config. Missing OpenRouter credentials must not make admin reads fail; voice readiness is independent.
- [ ] Change Admission's existing constructor to accept `number | (() => number)` and resolve its cap inside `take`; do not reconstruct Admission or clear its arrays on publish. OperationsService creates it with the current snapshot cap callback. Use current ceiling in `accept`/`acceptForRetry`. Fixed shutdown/storage safety never becomes editable.

```ts
constructor(private maximum: number | (() => number)) {}
// In take, before the existing retained-window check:
const generationCap = typeof this.maximum === 'function' ? this.maximum() : this.maximum;
const cap = kind === 'generation' ? generationCap : 120;
```

- [ ] After P3 supplies `attemptConfigRevision`, scope passive provider auth/credit/cooldown to that originating revision. `observedRuntime` obtains the bound revision before executing the attempt and passes it to readiness failure/success. If the current revision differs, old results may update telemetry but must not block/unblock the new credential's gate. `read()` treats provider state from another revision as unknown; no paid validation or quota reset on revision change. Do not treat a credential-recognition check as model-credit success.
- [ ] Preserve P3's optional `attemptStreamBudgets` through the existing observed runtime wrapper as well as the new revision getter; the wrapper currently omits it. Use receiver-bound optional getters rather than supplying new-current budgets for an old attempt. Add a failing assertion on `service.operations.runtime.attemptStreamBudgets` returning the raw runtime's attempt-bound idle limit, then forward it and rerun. No P3 source edit is needed for that existing port.

```ts
get attemptStreamBudgets() {
  const runtime = get();
  return runtime?.attemptStreamBudgets?.bind(runtime);
},
get attemptConfigRevision() {
  const runtime = get();
  return runtime?.attemptConfigRevision?.bind(runtime);
},
```
- [ ] Add regression: start revision-1 attempt, publish revision 2, deliver revision-1 `PROVIDER_AUTH`, and assert revision 2 stays available/unknown; deliver revision-2 auth and assert blocked. Then save revision 3 and verify it is not pinned by the revision-2 latch. Also test an accepted attempt beginning execution after publication to prove provenance comes from its binding, not execution-time current pointer. Do not mark this test passed if P3's port is absent.
- [ ] Preserve control/cancel/status/archive routes during disabled generation. Test existing active streamed response continues while a key is replaced/removed, with no new inference triggered by readiness. Report any P3/HTTP active-retry gate defect to its owner rather than weakening admission globally.
- [ ] Rerun `npm test -- test/assembly/admin-config.spec.ts test/operations` and the focused P3/P4 regression suites read-only.
- [ ] Commit named changed files: `feat(config): apply current admission limits without resetting accounting`.

## 6. Register the admin module and guarded HTTP path

Files: `backend/src/app.module.ts`, `backend/src/main.ts`, new `backend/test/assembly/admin-http.spec.ts`; existing central app e2e test.

- [ ] Add failing Nest integration test: override AppService with a blank-key assembled fixture and AURVIN_CONFIG with its bootstrap; compile the real AppModule; configure with `bodyParser: false`; listen on `127.0.0.1` port 0. Test `GET /api/admin/config` returns missing/redacted state with no-store while `/api/operations/ready` is 503. A `PUT /api/admin/config` with correct development Origin/JSON can save nonsecret settings; malformed input has a closed admin error, not a chat readiness 503. Ensure module.get(AdminConfigService) is exactly service.adminConfig.

```ts
it('serves admin while chat is unconfigured', async () => {
  const f = assemblyFixture();
  const service = await AppService.create(f.bootstrap, f.ports);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AURVIN_CONFIG).useValue(f.bootstrap)
    .overrideProvider(AppService).useValue(service).compile();
  const app = module.createNestApplication<NestExpressApplication>({
    bodyParser: false, logger: false,
  });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  try {
    expect(module.get(AdminConfigService)).toBe(service.adminConfig);
    const agent = request(app.getHttpServer());
    await agent.get('/api/operations/ready').expect(503);
    const result = await agent.get('/api/admin/config').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toMatchObject({ revision: 0, activation: 'unconfigured' });
    const saved = await agent.put('/api/admin/config')
      .set('Origin', f.bootstrap.frontendOrigin)
      .send({ protocolVersion: 1, expectedRevision: 0, settings: defaultManageableSettings() })
      .expect(200);
    expect(saved.body.revision).toBe(1);
  } finally { await app.close(); }
});
```
- [ ] Run `npm test -- test/assembly/admin-http.spec.ts`; expect admin route 404 before registration.
- [ ] Register only P2's existing module factory:

```ts
AdminConfigModule.registerAsync({
  imports: [AssemblyModule], inject: [AppService],
  useFactory: (service: AppService) => ({
    service: service.adminConfig, actor: () => service.adminActor(),
  }),
}),
```

- [ ] Set actor assumption to exactly `{ role: 'super-admin', authentication: 'disabled', source: 'server-configured-development' }` with server-resolved identity. Do not accept identity/role from headers or body or imply login.
- [ ] In configureApplication, add PUT to the CORS method allowlist and set `preflightContinue: true` so CORS cannot terminate admin OPTIONS before admin origin/TLS/no-store checks. Order: request IDs/operations (which do not require chat readiness for admin) → `configureAdminHttp` → nonadmin OPTIONS 204 fallback → generic `configureChatHttp`. The CORS middleware must set response headers before guarded preflight completes. Keep allowedHeaders limited to Content-Type and current exposed headers.
- [ ] Supply `configureAdminHttp` with bootstrap and actor closure plus an explicit trusted ingress function. No global `trust proxy = true`, no acceptance of arbitrary client X-Forwarded-Proto. For the documented same-host gateway contract, require exact scalar `X-Forwarded-Proto: https` and a loopback socket peer, plus P2's HTTPS configured frontend-origin requirement. The gateway must overwrite that header after TLS termination. Development HTTP remains only P2's development+loopback frontend+loopback backend host+loopback peer exception.

```ts
export function trustedAdminHttpsIngress(req: Request): boolean {
  const peer = req.socket.remoteAddress;
  return (peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1')
    && req.headers['x-forwarded-proto'] === 'https';
}
```

- [ ] Test exact-origin PUT preflight returns allow-methods containing PUT and no-store; other/null/missing mutation origins fail; form/oversized/compressed/query/unknown-field input fails; wrong Host/remote peer HTTP fails. Test remote peer spoofing forwarded HTTPS fails; loopback with missing/multiple/`http` forwarded proto fails for production; valid documented loopback HTTPS ingress succeeds. A local process can forge headers: document this same-host trust limitation and do not call origin/TLS checks authentication.
- [ ] Test parser ordering with a JSON candidate: admin bounded collector consumes it once and generic chat JSON parser does not replace/consume it again. Test genuine no-store on success, errors and OPTIONS; no ETag, ciphertext, candidate or raw exception in replies/logs.
- [ ] Rerun `npm test -- test/assembly/admin-http.spec.ts src/app.controller.spec.ts` and `npm run test:e2e -- test/app.e2e-spec.ts`.
- [ ] Commit named changed files: `feat(admin): mount guarded config HTTP independently of chat readiness`.

## 7. Stop/drain configuration alongside existing work and recovery

Files: `backend/src/app.service.ts`, `backend/src/operations/options.ts`, `operations.service.ts`; new `backend/test/assembly/config-drain.spec.ts`; `backend/test/operations/local-startup.spec.ts`, `bootstrap.spec.ts`.

- [ ] Add failing test with deferred in-flight config repository write: shutdown sets closing before any new config mutation, stops chat/voice admission, and does not call persistence.close while that write remains unresolved. Resolve confirmed write after shutdown starts; no late publication/success is allowed. Verify close happens once only after every admitted mutation and text/voice/transport drain is safe.

```ts
it('does not close or publish across an in-flight config write', async () => {
  const f = assemblyFixture(document(1));
  const service = await AppService.create(f.bootstrap, f.ports);
  const before = service.currentConfig.current();
  const pending = deferred<ConfigCasResult>();
  const started = deferred<void>();
  vi.mocked(f.repository.compareAndSwap).mockImplementationOnce(async () => {
    started.resolve();
    return pending.promise;
  });
  const saved = service.adminConfig.saveSettings({ protocolVersion: 1,
    expectedRevision: 1, settings: defaultManageableSettings() }, service.adminActor());
  const rejected = expect(saved).rejects.toMatchObject({ code: 'CONFIG_ACTIVATION_UNAVAILABLE' });
  await started.promise;
  const closing = service.operations.shutdown();
  expect(f.close).not.toHaveBeenCalled();
  pending.resolve({ outcome: 'confirmed', document: document(2) });
  await rejected;
  expect(service.currentConfig.current()).toBe(before);
  expect(await closing).toEqual({ safe: true });
  expect(f.close).toHaveBeenCalledTimes(1);
});
```

P2 normalizes this post-write writable refusal to `CONFIG_ACTIVATION_UNAVAILABLE`; preserve that existing category. A repository `uncertain` result is a separate test that requires `{ safe: false }` and zero close calls.
- [ ] Run `npm test -- test/assembly/config-drain.spec.ts`; expect missing config lifecycle tracking.
- [ ] In AppService track pending admin mutation calls **and underlying config repository/preparation promises**, not just HTTP handlers/P2's timeout-facing promises. Wrap the two existing admin entry methods by binding their originals; don't subclass or create another admin owner. Track repository create/CAS jobs through a local forwarding delegate and retain a flag for `uncertain`/unresolved dispatched writes. A timed-out P2 response does not mean its driver operation stopped.

```ts
private readonly configJobs = new Set<Promise<unknown>>();
private configClosing = false;
private configUncertain = false;

private trackConfigJob<T>(run: () => Promise<T>): Promise<T> {
  const job = Promise.resolve().then(run);
  this.configJobs.add(job);
  void job.then(() => this.configJobs.delete(job), () => this.configJobs.delete(job));
  return job;
}
// Keep original method receivers and service instance:
const save = this.adminConfig.saveSettings.bind(this.adminConfig);
this.adminConfig.saveSettings = (raw, actor) => this.trackConfigJob(() => save(raw, actor));
const update = this.adminConfig.updateCredential.bind(this.adminConfig);
this.adminConfig.updateCredential = (provider, raw, actor) =>
  this.trackConfigJob(() => update(provider, raw, actor));
```

- [ ] `assertWritable` checks `configClosing`, config uncertainty, runtime quarantine where present, local pending recovery, and the original owner.assertExecutor. Mark uncertainty at repository result/dispatch boundary, not by parsing exception messages. Preserve raw outstanding jobs until settlement. Prepared candidates must fail if their signal is aborted/closing even when a late catalogue promise resolves. Never use timeout races as permission to release a sentinel.
- [ ] Add optional `stopConfig?: () => void` and `drainConfig?: (ms: number) => Promise<{ drained: boolean; unresolvedWrites: number }>` to OperationsOptions. Shutdown calls stopConfig synchronously with stopAccepting, then uses existing `boundedResult` to await tracked jobs within fixed shutdownDrainMs. Safe close additionally requires drained=true and unresolvedWrites=0. Guard journal health through owner.assertExecutor before close; any unknown write remains unsafe. Do not close from admin/controller/import-like runtime code, and never erase a sentinel to make shutdown succeed.
- [ ] Add tests for queued mutation, validation in flight, hung prepare, uncertain CAS, runtime drain failure, voice accounting failure, repeated concurrent shutdown and IPC shutdown. No new writes/publication after closing, no double close, no losing usage counters, unsafe cases retain ownership evidence and nonzero exit status.
- [ ] Adapt existing local-startup fixture to BootstrapConfig plus stored encrypted fixture document and owner.store/configRepository port. Keep order assertion `maintenance → drain → durable → fresh`, same persistence owner and no executeTurn/submitTurn during recovery. Keep catalogue-unavailable/pending evidence and partial-recovery refusal tests. Add config edit after successful recovery that never constructs another runtime. Recovery finalizes saved graph results using P3 behavior, never repeats inference to apply a revision.
- [ ] Rerun `npm test -- test/assembly/config-drain.spec.ts test/operations/local-startup.spec.ts test/operations/bootstrap.spec.ts`.
- [ ] Commit named changed files: `fix(config): drain mutations before releasing executor ownership`.

## 8. Implement the explicit empty-store import function

Files: new `backend/src/scripts/import-config.ts`, `import-config.spec.ts`; reuse only exports of existing P1/P2 modules and assembly preparation.

- [ ] Export `importLegacyConfiguration(env, ports): Promise<ImportResult>` from the script, with `env: Record<string, string | undefined>` and `ImportResult = { outcome: 'imported' | 'already-configured'; importedNames: string[] }`. Define `ImportPorts` as existing `AssemblyPorts` selections (`open`, `assets`, `limits`, `fetcher`, optional `configRepository`) plus `signal?: AbortSignal`. Do not import/construct AppModule/AppService.create. Default ports use existing openPersistence, fixed asset loader, loadModelLimits and fetch; no second runtime/reservation/usage owner.
- [ ] Add failing test using assemblyFixture and purely injected env. Import twice, with repository and live-call spies; no real provider/DB request is possible:

```ts
it('imports one encrypted document and refuses a populated store', async () => {
  const f = assemblyFixture();
  const fetcher = vi.fn<typeof fetch>(async url => {
    if (String(url) === 'https://openrouter.ai/api/v1/key')
      return Response.json({ data: { label: 'discard', limit: null, usage: 0, is_free_tier: false } });
    throw new Error('Unhandled fixture URL');
  });
  const env = { PERSISTENCE_PROFILE: 'native-mongodb', MONGODB_URI: 'fixture-injected-only',
    NODE_ENV: 'development', FRONTEND_ORIGIN: 'http://localhost:5173',
    AURVIN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    OPENROUTER_API_KEY: secret, OPENROUTER_MODEL: 'fixture/model',
    ENABLE_DICTATION_MODE: 'false', ENABLE_LIVE_VOICE_MODE: 'false' };
  expect(await importLegacyConfiguration(env, { ...f.ports, fetcher })).toMatchObject({ outcome: 'imported' });
  const saved = f.stored()!;
  expect(saved.revision).toBe(1);
  expect(saved.credentials.openrouter?.envelope.algorithm).toBe('aes-256-gcm');
  expect(JSON.stringify(saved)).not.toContain(secret);
  expect(f.credentials.decrypt(saved).openrouter).toBe(secret);
  expect(saved.settings.voice.enabledModes).toEqual({ dictation: false, live: false });
  expect(saved.settings.deepgram.rates.novaPerMinuteUsd).toBeNull();
  expect(await importLegacyConfiguration(env, { ...f.ports, fetcher })).toMatchObject({ outcome: 'already-configured' });
  expect(f.repository.createIfAbsent).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(f.runtime).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledTimes(2);
});
```

- [ ] Run `npm test -- src/scripts/import-config.spec.ts -t "imports one encrypted"`; expect missing command export.
- [ ] Implement in this order: load infrastructure bootstrap; reject absent URI or `bootstrap.persistence.profile !== 'native-mongodb'`; open **one** admitted bundle using unconfigured adapter; construct config repository from admitted owner.store; assert executor; read singleton; return already-configured without validation/sealing/write if present. Invalid stored document is diagnostic refusal, never treated as empty. No Azure/unknown-profile import is admitted.
- [ ] For local recovery, inspect observed owner and refuse if pending ancestry/recovery is present. Import is not a recovery runtime. Existing open helper may perform its guarded stopped-process handoff, but the command must not finish pending recovery, delete a stale sentinel, authorize inference or bypass a busy journal. Preserve evidence on refusal and use original guarded close semantics only when safe.
- [ ] Only after empty-store check, call `parseLegacyConfigImport(env, bootstrap)`. For nonempty credentials require encryption ready; call CredentialService.validate once per supplied credential using the candidate's selected region, with the existing 10-second/64-KiB/no-retry validator. Do not call text/speech inference, temporary token or project-admin APIs. Both credentials are validated **before** writing anything. Load fixed assets, run shared prepareConfigurationSnapshot including model catalogue/cross-field/fixed-asset caps, seal both credentials, and assemble one revision-1 document with actor from ServerIdentityResolver and current timestamp.
- [ ] Reassert admitted ownership and no cancellation just before createIfAbsent. Call it exactly once. Confirmed means imported; conflict means already-configured safe refusal; uncertain means `CONFIG_WRITE_UNCERTAIN`, no success and no retry/overwrite/cleanup of config. Never call compareAndSwap from import. Use existing repository ambiguity resolution/journal rather than a second hand-written read-back algorithm.
- [ ] Add table-driven tests for invalid settings/master key/key recognition; second credential fails after first validates; catalogue malformed/unavailable; schema/byte cap; ownership conflict/lost owner; absent storage; local pending/busy journal; concurrent store creation; ambiguous write; abort before dispatch and abort after dispatch. Before-dispatch failures leave no document. After-dispatch uncertain failures preserve any document/evidence and do not claim absence or auto-delete anything.
- [ ] Test all opened successful/refusal paths call guarded close at most once and await it. On dispatched uncertainty or unresolved I/O, report unsafe close and leave ownership evidence, not forced release. Assert importer never constructs runtime, requests generation, invokes recovery completion, edits env or prints anything.
- [ ] Rerun `npm test -- src/scripts/import-config.spec.ts`.
- [ ] Commit the two files: `feat(config): add atomic empty-store legacy import`.

## 9. Add the sanitized direct-entry CLI and graceful command shutdown

Files: `backend/src/scripts/import-config.ts`, `import-config.spec.ts`.

- [ ] Add failing CLI tests using exported `runImportCommand(options): Promise<number>`, where options inject `{ env, loadEnvFile, importConfig, stdout, stderr, signal }`. `importConfig` defaults to importLegacyConfiguration; env defaults to process.env only in the real entry. Use an isolated allowlisted child environment and a stub loader, not the application's private `.env`.
- [ ] Verify: loader called once only on command entry, import called once, success text contains setting names/count and static category only, already-configured is safe refusal/no-op, unknown error containing fixture key/URI/ciphertext/master key emits none of those values. Importing the script as a module must produce zero loads/writes/network/output.

```ts
it('CLI never prints thrown secret text', async () => {
  const lines: string[] = [];
  const marker = 'fixture-key-uri-envelope-master-key';
  const code = await runImportCommand({
    env: {}, loadEnvFile: () => undefined,
    importConfig: async () => { throw new Error(marker); },
    stdout: line => { lines.push(line); }, stderr: line => { lines.push(line); },
  });
  expect(code).toBe(1);
  expect(lines.join('\n')).not.toContain(marker);
  expect(lines.join('\n')).toContain('IMPORT_FAILED');
});
```
- [ ] Run `npm test -- src/scripts/import-config.spec.ts -t "CLI"`; expect missing CLI function/unsafe output to fail.
- [ ] Implement direct-entry detection using existing main.ts pattern with `fileURLToPath(import.meta.url)` and `resolve(process.argv[1])`. Load `backend/.env` via existsSync/process.loadEnvFile only on explicit CLI entry and preserve inherited environment precedence. Do not rewrite/copy env. Reject unexpected command arguments so no credential/URI input path is introduced on the command line.
- [ ] Map exit statuses: 0 confirmed import with confirmed safe close; 2 already-configured no-op/refusal; 1 invalid/unavailable/uncertain/cancelled/unsafe-close. Output fixed categories plus `obsoleteManageableNames(env)` only. Catch loader errors as well as bootstrap/provider/driver errors without printing thrown message, stack, Zod data, response bodies or serialized env/bootstrap. Whitelist AdminConfigFault/AppError codes; forged `error.code` is not trusted.
- [ ] Install SIGINT and non-Windows SIGTERM/IPC shutdown abort handlers on direct entry. Check signal between preflight steps and before dispatch; provider validation retains its own bounded deadline and no retries. Once write dispatch starts, cancellation is not a rollback: await confirmed outcome and the original bounded guarded cleanup; timeout/unknown result retains evidence, nonzero status and static guidance. Remove handlers after settlement. Never call process.exit before awaited cleanup.
- [ ] Reuse backend's fixed persistence/shutdown budgets and boundedResult; no infinite wait. Tests must verify close failure changes even a confirmed import to nonzero `IMPORT_CLOSE_UNCONFIRMED` category, with no secret output and no sentinel deletion. A confirmed document may exist after nonzero close status; docs must tell the operator to inspect/reconcile rather than rerun as a reset.
- [ ] Build (`npm run build`) and check the generated entry path exists at `backend/dist/scripts/import-config.js`. Do **not** run that entry against local/operator `.env`. CLI child tests must preload fixtures/stub env loader and provider/DB ports, as existing operations bootstrap tests do.
- [ ] Rerun `npm test -- src/scripts/import-config.spec.ts`; commit only the two files: `feat(config): sanitize explicit import CLI and await shutdown`.

## 10. Replace env-editor guidance with configuration operations

Files: `backend/.env.example`, `README.md`, `setup.bat`, `run.bat`, new `docs/super-admin-config/operations.md`, `backend/test/assembly/config-docs.spec.ts`.

- [ ] Write failing docs consistency tests that parse assignment names from backend/.env.example, assert they are a subset of BOOTSTRAP_ENV_NAMES, include AURVIN_CONFIG_ENCRYPTION_KEY, exclude all LEGACY_MANAGEABLE_ENV_NAMES, and retain frontend API/proxy-only guidance. Example:

```ts
it('ships only infrastructure settings in the backend example', () => {
  const text = readFileSync(resolve('.env.example'), 'utf8');
  const names = [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]!);
  expect(names).toContain('AURVIN_CONFIG_ENCRYPTION_KEY');
  expect(names.every(name => (BOOTSTRAP_ENV_NAMES as readonly string[]).includes(name))).toBe(true);
  expect(names.some(name => (LEGACY_MANAGEABLE_ENV_NAMES as readonly string[]).includes(name))).toBe(false);
});
```

- [ ] Run `npm test -- test/assembly/config-docs.spec.ts`; expect red for obsolete example/provider docs.
- [ ] Remove manageable assignments from backend/.env.example, add blank `AURVIN_CONFIG_ENCRYPTION_KEY=`, retain infrastructure/topology/shared connection/storage/shutdown settings. Document the example does not configure text/voice. No generated master key, nonempty example credential, root example, private `.env` edit or env overwrite.
- [ ] Update README backend-config and voice sections to Manage Aurvin labels/config collection, write-only keys, Config versus empty Analytics, defaults/off behavior, Save versus Validate and save scopes, immediate new-work activation and active snapshot limitations. Distinguish server-assumed super admin from authentication and recognition from paid model/speech/credit usability. Preserve existing unresolved voice defect/device-release warnings unless their owning evidence actually closes them; changing settings storage does not fix them.
- [ ] Update setup.bat completion message only: infrastructure lives in backend/.env; start Aurvin and use Manage Aurvin. Add a run.bat guidance echo: launch waits for liveness, not configured chat, and Manage Aurvin remains usable. Keep existing ports, env-file preservation, build and shutdown/recovery behavior. Do not add import/key-generation commands to either launcher.
- [ ] Write the operations doc with exact ordered procedures:
  1. New setup: copy example only if absent; privately configure native replica-set infrastructure/exact origin; explicitly generate one 32-byte master key; store it privately; start; open Super admin → Manage Aurvin; save model/settings to create revision 1 before Replace key (P2 replacement requires an existing document); validate/save credential; inspect readiness.
  2. Existing setup import: back up app database and env/master key privately; gracefully stop backend and prove no in-flight executor/work; build; **operator-only** `node --enable-source-maps dist/scripts/import-config.js` from backend; record only exit/category/count; restart; verify stored revision/configured state and readiness; remove obsolete names manually from private env after success. No automatic execution in this workflow.
  3. Fixed non-billable validation destinations, bounded deadlines/response cap/no retries; catalogue GET is metadata, not inference. Recognition does not prove model access, account credit, correct billing rates or voice/device quality.
  4. Name-only ignored-env warning; missing store, blank keys, storage outage, corrupt schema, wrong/missing master key and catalogue failure diagnostic behavior; no local substitute/default overwrite/plaintext fallback. Unknown write might have committed; freeze conflicting changes and follow journal/reconciliation, never sentinel deletion or blind retry.
  5. HTTPS boundary: explicit localhost HTTP development exception is plaintext. Outside it, trusted browser→same-host authenticated TLS gateway; private loopback backend; gateway overwrites `proxy_set_header X-Forwarded-Proto https;` in its TLS `/api/` location and must not pass client-supplied forwarding values. Existing deployment/staging/nginx.conf does not yet set that header: give the operator the exact one-line change in the doc, do not edit/deploy unowned gateway files or claim staging validated. Test simulated ingress locally only. Same-host processes remain trusted; CORS/Origin are not authentication.
  6. Backup config ciphertext with MongoDB, master key separately under restricted access. Restore both to an isolated verified compatible release, no overlapping writer; match schema/master key; verify safe configured metadata/decryption and readiness using bounded operator actions. Never print/export credentials or use a restore as a silent config reset.
  7. Lost key/tamper/schema incident: preserve encrypted data, restore correct separate key/known backup under controlled stopped-work maintenance; do not generate a replacement master key over existing ciphertext. Key rotation and secret-manager integration are out of scope. Replacement/removal through the UI applies to new work; revoked keys can still break old requests and cancellation cannot guarantee charge prevention.
  8. Rollback: compatible config-aware release can read supported schema; an env-only older release ignores encrypted config and cannot decrypt it into `.env`. Returning is an explicit stopped-work operator migration with original privately retained credentials/settings and compatible DB backup; no plaintext export endpoint and no promise of reversible later revisions. Keep local recovery binding/ownership restrictions intact.
  9. Graceful stop/import interrupt, fixed drain/supervisor budget, uncertain-close evidence, exit codes, native-test prerequisites and an evidence section initially marked **unrun / assigned to P7**. No proof from doc/source presence; review explicitly skipped.
- [ ] Include this **operator-only** generation command, never execute it during planning/worker fixture checks or paste its output into evidence. Explain it must be performed locally in a private terminal and stored as AURVIN_CONFIG_ENCRYPTION_KEY without sharing logs/screenshots/history; do not silently replace an existing key:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64') + '\n')"
```

- [ ] Test doc links exist, bootstrap names/source mapping match P1, both launchers contain no automatic import or encryption-key generation, and the runbook has no live/paid/deployment claim. Do not assert fragile prose snapshots; assert required links/commands/source categories.
- [ ] Run `npm test -- test/assembly/config-docs.spec.ts` plus `git diff --check`. Commit named changed files: `docs(config): document database authority import and key recovery`.

## 11. Verification and P7 handoff

- [ ] Grep production source for `loadConfig(process.env)`, `loadVoiceConfig(process.env)`, manageable env reads, new MongoClient creation and duplicate AppService/runtime/voice/usage constructors. Expected: no normal-start manageable env reads; import projection remains explicit; existing sequential local maintenance exception and fixed single owners are documented. Tests may still use legacy fixture parsers outside this plan; route any new-bootstrap incompatibility to owners, never weaken production source separation.
- [ ] Run from backend, serially (bootstrap fixture suites build dist internally): `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`. Run frontend `npm run build`, `npm run lint`, `npm test` as read-only integration checks if feasible. Record actual exit/counts/failures/skips; no empty-discovery pass claim. Route unrelated/P1–P5-owned defects to the orchestrator/owner rather than edit outside ownership.
- [ ] Do not run import, Azure/live/paid/gateway checks. P7 owns native import/restart/security integration with operator-provided `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; generated isolated DBs only. Agent subprocess native checks must stub private env loading and use synthetic credential/provider fixtures.
- [ ] Give P7 the commit list, actual commands/results and source interfaces: BootstrapConfig token; AppService.create; configRepository injection; currentConfig/activation/adminConfig/adminActor; pure preparation; optional operations currentConfig/stopConfig/drainConfig; importLegacyConfiguration/ImportPorts/ImportResult/runImportCommand; no `.env` writes; CLI path/exit categories; ingress header contract. Explain any P3 provenance-port or old central/integration fixture reconciliation blocker explicitly.
- [ ] For P7 test matrix, require stored-versus-active revision after save, new versus active text/voice key/budget/rate snapshots, no paid requests, single bundle/runtime/reservation/usage/close, process restart reads ciphertext, native empty/populated import and ownership/journal refusal, uncertain writes/late shutdown, exact-origin/TLS/body defenses, and unchanged terminal-state/saved-result recovery. Frontend safe capability refresh uses P4/P5's existing hook; P6 adds no browser state owner.
- [ ] Report implementation/check status without editing state.md or verification.md. Orchestrator owns graph/final report; P7 owns evidence. Do not mark workflow complete or review passed.

## Exit-gate mapping

| P6 gate / acceptance | Tasks and required evidence |
| --- | --- |
| Blank-key admin bootstrap; AC2, AC8 | 1–3, 6: real Nest admin route works while chat not ready; no env overlay/provider boot dependency/default write. |
| DB/encryption/schema failures; AC2, AC3, AC6 | 3–4: closed diagnostics, preserved ciphertext, no plaintext fallback or invalid-store overwrite. |
| Immediate confirmed activation; AC5, AC6 | 4–5: pointer unchanged until confirmed CAS, new work uses current revision, active snapshots survive edits and late provider failures cannot poison another revision. |
| Reload durability; AC7 | 4, 8–9: sequential fixture reload plus P7's separately gated native/process evidence; no restart requirement for ordinary confirmed saves. |
| Single connection/runtime/reservation/usage/close owners; AC5, AC8 | 3–4, 7: reference identity/call-count checks and stopped sequential recovery exception; counters never reset on edit. |
| Safe drain/recovery/uncertain writes; AC6, AC8 | 7–9: underlying jobs awaited, no late publication, unknown writes retain quarantine/ownership, saved results finalize without provider repetition. |
| Import atomicity/refusal/ownership/no secrets; AC7 | 8–9: one createIfAbsent, existing-store no-op, both validations before write, real guarded store, sanitized CLI, no env rewrite or inference. |
| Operator transport/backup/manual cleanup/rollback; AC2, AC7, AC8 | 6, 10: exact gateway-header/loopback contract, private stable master key, only manual legacy cleanup and controlled rollback. |

Plan is not execution evidence. No application checks, native migration, live validation, provisioning or deployment have been performed by writing this artifact. Outstanding coordination: P3 attempt-revision provenance for passive provider gates; P7 integration fixtures consuming old AppService input; operator gateway header change and native prerequisites remain explicit release/verification gates.
