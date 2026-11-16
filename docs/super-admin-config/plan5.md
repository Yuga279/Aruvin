Build the approved bottom-sidebar entry and a separate Aurvin configuration dashboard. Chat remains the landing page; navigation must not stop text generation, dictation, or live voice. Analytics is an empty panel, not an analytics implementation.

Keep one ChatProvider, the existing VoiceChatShell/useLiveVoice owner, and the existing mounted ChatView/Composer subtree. Use local page state and a hidden/inert chat surface, not a router, a second provider, conditional chat mounting, or React Activity. Activity cleans up hidden effects and would disconnect voice. Admin editing lives in its own feature; provider candidates live only inside their masked editor. Consume the committed public admin protocol and P4's capability-refresh function unchanged.

Use React 19, TypeScript, fetch/AbortController, native disclosure/form controls, existing Node Vitest and React static-render tests, and a small native-browser fixture page. No new dependency, theme, font, storage mechanism, or paid/live provider check. Research and unified review are **skipped**; tests and actual browser checks are not.

## Boundaries and starting contracts

- Read [goal.md](goal.md), [state.md](state.md), repository instructions, and current changes before implementation. This plan is not implementation evidence. Actual new source files still require repository code headers; this plan and its examples intentionally have no header boilerplate.
- Start the UI contract at `frontend/src/api/admin-config-protocol.ts`. Import its settings/request/response/error/provider types, version constants, route helpers, body/candidate bounds, field-path allowlist and guards. Do not copy backend runtime/default/secret types into the browser or edit the protocol.
- P2's committed controller confirms the HTTP verbs: GET `/api/admin/config`, PUT `/api/admin/config`, POST `/api/admin/config/credentials/openrouter` or `/deepgram`. Both replace and remove use POST with the protocol's discriminated request. All three return PublicAdminConfig on success; errors have the nested AdminConfigError envelope. No DELETE credential endpoint, validate-only endpoint, or second credential-save request.
- Public state includes `revision`, `activeRevision`, `state`, `activation`, redacted `credentials`, and `roleAssumption`. Never infer activation from HTTP 200 alone. Display “Saved and active for new work” only when activation is active and activeRevision equals revision. Otherwise display saved/unconfigured or saved/blocked with safe guidance.
- P4 exports `refreshVoiceCapabilities(): Promise<boolean>` from `frontend/src/features/voice/index.ts`. Its implementation is `state/voice-capabilities.ts`; read it only as a consumer. It refreshes a shared safe store, returns false on failure, and does not renegotiate active-session snapshots. Do not write voice files or construct another capability store/controller.
- Do not edit `frontend/src/features/chat/state/**` or `backend/test/model/config-snapshot.ts`. Commit `543e53c` is an explicit ownership exception, not a reusable grant. Leave the existing App voice-binding forwarding unchanged. If a navigation regression requires changing these paths, stop and ask the orchestrator/user to assign its owner; P7 must separately reconcile/test that commit.
- Do not change P1/P2/P3/P4/P6/P7-owned code, manifests, lockfiles, backend composition, `.env`, `.openchamber/`, or existing voice investigation work. P7 owns `frontend/src/features/admin-config/integration-tests/**`; the focused P5 checks below deliberately use `testing/**` and ordinary `.test.ts` files instead.
- P1 implementation and the committed protocol are the worker prerequisites. The P4 refresh implementation already exists. Recheck signatures before starting; route a changed protocol to P1 or a broken hook to P4 instead of inventing an adapter contract.

## File map

Create only these production files:

| Path | Responsibility |
| --- | --- |
| `frontend/src/api/admin-config-client.ts` | Bounded, no-store HTTP client and closed safe error presentation. |
| `frontend/src/features/admin-config/config-edit-state.ts` | Field catalog, raw field conversion, redacted baseline/draft reducer, dirty/CAS rules and navigation decisions. No credential candidates. |
| `frontend/src/features/admin-config/AdminDashboard.tsx` | Load/save orchestration, Config/Analytics tabs, sections, statuses, unsaved-exit guard and post-save refresh. |
| `frontend/src/features/admin-config/ConfigFields.tsx` | One section's labeled nonsecret controls, fixed policy rows and inline errors. |
| `frontend/src/features/admin-config/CredentialRow.tsx` | Fixed configured mask, local candidate editor, scoped validate/save/remove operations and confirmation. |
| `frontend/src/features/admin-config/ProfileMenu.tsx` | Native bottom-profile disclosure with Escape/focus/outside-click behavior. |
| `frontend/src/features/admin-config/admin-config.css` | Token-based dashboard/profile styles, small sidebar sizing override and responsive/reduced-motion rules. |

Modify `frontend/src/components/Sidebar.tsx` for the footer callback/row; `frontend/src/App.tsx` for persistent navigation surfaces and dependency injection; `frontend/src/App.css` for full-height/hidden surface rules; `frontend/src/features/chat/ChatView.tsx` for passing the entry callback and guarding its own navigation-related focus restoration only. Do not move Composer or rewrite its voice behavior. Existing icons are optional; use the existing logo/text profile mark unless a missing icon is genuinely needed.

Create focused checks/fixtures at:

- `frontend/src/features/admin-config/testing/fixtures.ts`
- `frontend/src/features/admin-config/admin-config-client.test.ts`
- `frontend/src/features/admin-config/config-edit-state.test.ts`
- `frontend/src/features/admin-config/admin-dashboard.test.ts`
- `frontend/src/features/admin-config/credential-row.test.ts`
- `frontend/src/features/admin-config/navigation.test.ts`
- `frontend/src/features/admin-config/testing/dashboard-browser.html`
- `frontend/src/features/admin-config/testing/dashboard-browser.tsx`
- `frontend/src/features/admin-config/testing/browser-checks.ts`

These are not separate frameworks. Keep test utilities local and small; production modules must not import them. Reuse existing Vitest/SSR conventions. Node discovery is `src/**/*.test.ts`, not `.test.tsx`, and provides no DOM. Do not claim SSR/source checks prove event handling, focus, browser storage, or lifecycle continuity.

## Visual direction

Reuse `frontend/src/index.css` without editing its tokens. The existing palette is background `#000000`/`#ffffff`, sidebar `#000000`/`#f9f9f9`, surface `#2f2f2f`/`#f4f4f4`, text `#ececec`/`#0d0d0d`, muted `#afafaf`/`#8f8f8f`, and accent `#ffffff`/`#0d0d0d`; use the corresponding CSS variables, not these literals. Use `--aurvin-font` for headings/body and `--aurvin-mono` only for masks/model identifiers/units. Muted labels must remain readable; important instructions can use normal text rather than lowering opacity.

The characteristic element is the honest credential-state row: a fixed eight-dot mask, Configured, and two explicit actions. Everything else is quiet: a 28px semibold dashboard heading, 18px section headings, 14px field labels, readable 14px help, restrained existing borders/radii, and generous vertical spacing. No metric cards, decorative counters, external fonts, new colors, gradients or chart placeholders.

Desktop:

```text
Back to chat                            Manage Aurvin
                    Config | Analytics
OpenRouter          OpenRouter
Chat limits         API key       ••••••••  Configured   Replace key  Remove key
Voice               Model         [provider/model                     ]
Deepgram            Privacy       Data collection denied; transforms disabled
                    ...one section of fields...
                    Unsaved changes                     Save changes
```

Mobile: full-height independently scrolling dashboard; Back to chat and heading wrap; tabs remain compact; a labeled native Section select replaces the section rail; field rows/actions stack and wrap. Honor 320px-wide layouts and 200% zoom. Keep the profile footer outside independently scrolling history. Use `min-width: 0`, `min-height: 0`, overflow wrapping and full-width small-screen inputs, not page-wide overflow suppression that hides broken controls.

## Interfaces for P6 and checks

Use these interfaces; do not create alternative wire types:

```ts
export type AdminConfigClient = {
  read(signal?: AbortSignal): Promise<PublicAdminConfig>;
  saveSettings(request: SaveSettingsRequest, signal?: AbortSignal): Promise<PublicAdminConfig>;
  updateCredential(provider: CredentialProvider, request: CredentialUpdateRequest,
    signal?: AbortSignal): Promise<PublicAdminConfig>;
};

export function createAdminConfigClient(options?: {
  baseUrl?: string; fetch?: typeof fetch;
}): AdminConfigClient;

export type AdminDashboardProps = {
  client: AdminConfigClient;
  onBackToChat: () => void;
  refreshCapabilities: () => Promise<boolean>;
};

export type CredentialRowProps = {
  provider: CredentialProvider;
  credential: CredentialState;
  expectedRevision: number;
  disabled: boolean;
  client: AdminConfigClient;
  onBusy: (busy: boolean) => void;
  onSaved: (config: PublicAdminConfig) => void;
  onFailure: (error: AdminConfigClientError) => void;
};
```

`ProfileMenu` takes `onManageAurvin: () => void`; Sidebar accepts optional `onManageAurvin`, provided by the real App. `ChatView` extends its existing liveVoice props with `visible?: boolean` (default true) and `onManageAurvin?: () => void`. App keeps its existing optional chat `client` and adds optional `adminClient` and `refreshCapabilities`, defaulting to the client factory and P4 export. Allocate the default admin client once with `useState`, not on every render. P6 needs no frontend runtime reconstruction or new central provider: it exposes the already committed HTTP routes independently of chat readiness and supplies the shared activation/config owner on the backend.

Define `AdminSection = 'openrouter' | 'chat' | 'voice' | 'deepgram'` and `AdminTab = 'config' | 'analytics'` in `config-edit-state.ts`. Define `editableFields` as the explicit catalog below, excluding fixed policies and request/candidate paths. A field has its allowlisted settings path, section, human label, unit/help, kind (`text`, `integer`, `decimal`, `nullable-integer`, `nullable-decimal`, `boolean`, `select`, `keyterms`), and any select choices/bounds. Do not make a general form framework.

Define `FieldValues` as a partial record of AdminConfigFieldPath to string/boolean. Functions are `fieldsFromSettings(settings)`, `settingsFromFields(baseline, fields)` returning `{settings, fieldErrors}` with settings nullable on failure, `createEditState(config)`, `editReducer(state, action)`, `isDirty(state)`, and `navigationDecision({dirty, pending}, confirmDiscard)` returning `'stay' | 'leave'`. Reducer actions are `edit {path,value}`, `begin {scope}`, `settingsSaved {config}`, `credentialSaved {config}`, `failed {error}`, `loaded {config}`, and `capabilities {ok}`. Scope is `'settings' | CredentialProvider`; state holds baseline PublicAdminConfig, raw fields, pending scope/null, safe error/null, capability warning, and a stale/uncertain lock. No action or state field may contain a candidate.

## Task 1 — Redacted fixtures and bounded client

Files: `testing/fixtures.ts`, `admin-config-client.test.ts`, `frontend/src/api/admin-config-client.ts` at the exact paths above. All npm commands in this plan run from `frontend/`; Git commands run from the checkout root.

- [ ] Add `publicConfig(revision = 1): PublicAdminConfig` to fixtures. Return a fresh structured clone with protocol/schema 1, stored/active, activeRevision equal to revision, server-configured-development role assumption, OpenRouter configured with ISO validatedAt, Deepgram unconfigured/null, and these valid settings:

```ts
const settings: ManageableSettings = {
  openRouter: { modelId: 'openai/gpt-4.1-mini', dataCollection: 'deny', disableTransforms: true },
  chat: { maxInputChars: 32000, maxInputTokens: 8000, maxMessagesInContext: 100,
    maxContextTokens: 32000, maxOutputTokens: 2000, modelMarginTokens: 512,
    titleMaxChars: 80, maxConcurrentGenerationsPerProcess: 2,
    maxRequestsPerMinutePerUser: 30, retryMaxAttempts: 3,
    retryBaseDelayMs: 250, retryMaxDelayMs: 1000, firstOutputTimeoutMs: 10000,
    idleStreamTimeoutMs: 10000, totalRunTimeoutMs: 30000 },
  voice: { enabledModes: { dictation: false, live: false },
    limits: { ...DEFAULT_VOICE_LIMITS }, dictationWarningMs: null,
    quotas: { identityConcurrent: 1, globalConcurrent: 2,
      identityDailyMinutes: 30, globalDailyMinutes: 60, dailySpendUsd: null } },
  deepgram: { region: 'us', dictationModel: 'nova-3', liveModel: 'flux-general-en',
    ttsModel: 'flux-haley-en', endpointingMs: 300, spokenPunctuation: false,
    keyterms: [], eotThreshold: 0.7, eotTimeoutMs: 1000,
    rates: { novaPerMinuteUsd: null, fluxSttPerMinuteUsd: null,
      fluxTtsPerThousandCharsUsd: null } },
};
```

Import DEFAULT_VOICE_LIMITS from the existing voice protocol; the fixture is not a product default. Also export `adminFailure(code, currentRevision = null)` returning the exact error envelope with retryable false and empty fieldErrors. Before using the fixture in other tests, assert `isPublicAdminConfig(publicConfig())` is true.

- [ ] Write the first failing transport test, using Vitest `it`, `expect`, `vi` and the fixture:

```ts
it('posts a credential once without saving unrelated settings', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(publicConfig(2)));
  const client = createAdminConfigClient({ baseUrl: '/api/', fetch: fetcher });
  await client.updateCredential('openrouter', {
    protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: 'fixture-only-key',
  });
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe('/api/admin/config/credentials/openrouter');
  expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' } });
  expect(JSON.parse(String(init?.body))).toEqual({ protocolVersion: 1,
    expectedRevision: 1, action: 'replace', candidate: 'fixture-only-key' });
});
```

- [ ] Run `npm test -- src/features/admin-config/admin-config-client.test.ts -t "posts a credential once"`; expect a missing client export/module failure before implementation, not an unrelated setup failure.
- [ ] Implement the factory with the existing `/api`/`VITE_API_BASE` convention and injectable fetch. Use only ADMIN_CONFIG_ROUTES, explicit GET/PUT/POST, JSON bodies for mutations, `cache: 'no-store'`, `redirect: 'error'`, `credentials: 'same-origin'`, and no query parameters. Do not reuse ApiClient's raw exception/message forwarding. Build exact request objects from typed fields, reject unexpected request keys/invalid provider/revision/action before fetch, validate settings with isManageableSettings, and check UTF-8 candidate/body bytes using TextEncoder and protocol constants. Preserve the candidate verbatim; do not mutate it or infer its format. Use a 30-second overall request deadline combined with an optional signal; remove timers in finally. No automatic mutation retries.
- [ ] Validate unknown JSON with isPublicAdminConfig/isAdminConfigError. Bound response text to 64 KiB while reading bytes; reject malformed/oversized/extra-field responses rather than casting. Return only validated public objects. Define AdminConfigClientError with safe code/status/retryable/currentRevision/fieldErrors and constant safe message; do not retain raw body, raw exception, candidate, URL credentials, or cause. Browser-only failure codes are `NETWORK_ERROR`, `ABORTED`, `ADMIN_REQUEST_TIMEOUT`, `INVALID_ADMIN_RESPONSE`, `INVALID_ADMIN_REQUEST`. For a mutation interrupted after dispatch, mark the outcome uncertain in the UI; abort is not proof that the backend did not save.
- [ ] Add table tests for GET and PUT routes, revision zero (missing document), exact remove `{action:'remove',confirm:true}`, 409 nested conflict, every protocol error category, raw-body/exception redaction, malformed JSON, secret-bearing extra response fields, invalid/oversized requests and responses, network/timeout/abort, no mutation retry, no cache/storage writes. Stub fetch only; no real provider requests. Spy timers/abort deterministically with fake timers, restoring them after each test.
- [ ] Run `npm test -- src/features/admin-config/admin-config-client.test.ts`; expect every newly discovered test to pass.
- [ ] After an orchestrator-granted commit turn: `git add frontend/src/api/admin-config-client.ts frontend/src/features/admin-config/admin-config-client.test.ts frontend/src/features/admin-config/testing/fixtures.ts`, then `git commit -m "feat(admin-config): add redacted bounded admin client"`.

## Task 2 — Field catalog, lossless drafts and revision transitions

Files: `config-edit-state.ts`, `config-edit-state.test.ts`.

- [ ] Write the following failing reducer check; `publicConfig` comes from Task 1:

```ts
it('advances credential revision without saving or discarding dirty fields', () => {
  let state = createEditState(publicConfig());
  state = editReducer(state, { type: 'edit', path: 'openRouter.modelId', value: 'new/model' });
  state = editReducer(state, { type: 'credentialSaved', config: publicConfig(2) });
  expect(state.baseline.revision).toBe(2);
  expect(state.fields['openRouter.modelId']).toBe('new/model');
  expect(state.baseline.settings.openRouter.modelId).toBe('openai/gpt-4.1-mini');
  expect(isDirty(state)).toBe(true);
  expect(JSON.stringify(state)).not.toContain('candidate');
});
```

- [ ] Run `npm test -- src/features/admin-config/config-edit-state.test.ts -t "advances credential revision"`; expect the missing reducer module/export to fail.
- [ ] Implement the explicit field catalog and raw values. Keep empty/temporarily invalid numeric input as a string until Save; never turn blank required inputs into zero, null, NaN or an earlier accepted value. Nullable warning/cap/rate fields use blank = null with distinct help (“No warning”, “No spend cap”, “Unknown rate”). Zero rates remain valid known rates. Integer parsing rejects fractional/nonfinite/unsafe values; decimal parsing rejects nonfinite values; boolean values remain booleans. Timer controls display milliseconds to avoid rounding during round trips. Keyterms are one per line, trimmed, no empty entries, at most 50, each at most 64 characters. Do not silently drop/deduplicate/truncate entries to get past validation.
- [ ] Round-trip every manageable leaf. Start from a clone of baseline.settings, replace only catalog fields, and run isManageableSettings before producing a SaveSettingsRequest. Fixed policies stay unchanged. Map conversion failures to their allowlisted path. For combined constraints, annotate both related controls and the form summary; server cross-field/catalogue/storage admission remains authoritative. Never invent runtime ceilings/defaults from frontend fixtures.
- [ ] Implement immutable state transitions. `loaded` replaces baseline/fields only on initial read or explicit confirmed discard/reload. `settingsSaved` replaces baseline/fields and clears dirty/error/pending. `credentialSaved` replaces the public baseline/revision/credential flags and overlays only previously edited raw fields onto fieldsFromSettings(new settings), leaving dirty nonsecret edits intact. `failed` preserves baseline and drafts; conflicts set stale=true, uncertain writes set uncertain=true, both lock further mutations until explicit refresh. `begin` serializes all mutation scopes. Never replace expectedRevision with an error's currentRevision and resend an old full document.
- [ ] Add failures-first tests for edit/revert dirty calculation; blank required vs nullable/known-zero rates; every field round trip; all select allowlists; integer/byte/keyterm constraints; fixed policy preservation; context budget, warning/duration, retry/deadline, quota, and spend/rates cross-field failures; successful settings save; failed credential preserving fields/revision; conflict locking; late load/save replies not replacing newer snapshots. Dashboard request epochs will fence late responses; reducer must reject a lower revision public snapshot.
- [ ] Run `npm test -- src/features/admin-config/config-edit-state.test.ts`; expect all tests pass. Commit only the two named files with `git commit -m "feat(admin-config): preserve config drafts and revision fences"` after the granted staging turn.

Catalog to implement, with human labels rather than environment names:

| Section/group | Exact settings paths and UI |
| --- | --- |
| OpenRouter | `openRouter.modelId`: Model ID text, max 200, help says server verifies model limits; `dataCollection='deny'` and `disableTransforms=true`: fixed policy text, not editable switches. Credential row is a separate scope. |
| Chat/input and context | `chat.maxInputChars`: Input characters (1–32000); `maxInputTokens`: Input tokens; `maxMessagesInContext`: Messages in context (1–500); `maxContextTokens`: Context tokens; `maxOutputTokens`: Output tokens; `modelMarginTokens`: Model safety margin, tokens; `titleMaxChars`: Chat title characters (1–80). |
| Chat/admission and retries | `chat.maxConcurrentGenerationsPerProcess`: Concurrent responses; `maxRequestsPerMinutePerUser`: Requests per minute per user; `retryMaxAttempts`: Maximum attempts (1–3, includes first); `retryBaseDelayMs`: Initial retry delay; `retryMaxDelayMs`: Maximum retry delay. Explain one active attempt per chat is fixed; no control to change it. |
| Chat/deadlines | `chat.firstOutputTimeoutMs`: First output timeout; `idleStreamTimeoutMs`: Stream idle timeout; `totalRunTimeoutMs`: Total response timeout. All in ms. Do not add the environment's shared CONNECT_TIMEOUT_MS as another chat control. |
| Voice/modes and duration | `voice.enabledModes.dictation`: Dictation enabled; `.live`: Live voice enabled. `voice.limits.dictationMaxMs`: Dictation duration; `voice.dictationWarningMs`: Optional dictation warning; `voice.limits.liveMaxMs`: Live voice duration; `.liveWarningMs`: Live warning. New-session flags only; disabling must not cancel active sessions. |
| Voice/advanced timing and queues | `voice.limits.idleWarningMs`: Idle warning; `.idleExitAfterWarningMs`: Exit after idle warning; `.finalizationMs`: Finalization timeout; `.reconnectMs`: Reconnect timeout; `.connectMs`: Voice connection timeout; `.inputQueueMs`: Input audio queue; `.outputQueueMs`: Output audio queue. All in ms. Distinguish voice connect from the fixed shared infrastructure connection ceiling. |
| Voice/quotas | `voice.quotas.identityConcurrent`: Concurrent sessions per user; `.globalConcurrent`: Concurrent sessions overall; `.identityDailyMinutes`: Daily minutes per user; `.globalDailyMinutes`: Daily minutes overall; `.dailySpendUsd`: Optional daily spend cap, USD. Explain edits do not reset usage and lowering caps does not terminate already admitted work. |
| Deepgram/models | `deepgram.region`: US/EU select; `.dictationModel`: Nova 3, fixed supported choice; `.liveModel`: Flux general English, fixed supported choice; `.ttsModel`: select only flux-haley-en, flux-alexis-en, flux-priya-en. Fixed supported models still round-trip. Credential row is separate. |
| Deepgram/speech | `deepgram.endpointingMs`: Endpointing, 300–500 ms; `.spokenPunctuation`: Spoken punctuation; `.keyterms`: Keyterms, one per line; `.eotThreshold`: End-of-turn threshold, 0.5–1; `.eotTimeoutMs`: End-of-turn timeout, ms. |
| Deepgram/rates | `deepgram.rates.novaPerMinuteUsd`: Dictation USD/minute; `.fluxSttPerMinuteUsd`: Live transcription USD/minute; `.fluxTtsPerThousandCharsUsd`: Speech USD/1000 characters. Empty = unknown, not free; all three required for a non-null spend cap. |

Positive integer controls default to min 1; timers max 2147483647; non-timer counts/tokens max Number.MAX_SAFE_INTEGER unless the protocol gives a smaller bound. Use supported protocol bounds; backend rejection still wins over HTML constraints. Add a test comparing the union of editable catalog paths plus the two fixed policy paths to ADMIN_CONFIG_FIELD_PATHS excluding `candidate`/`expectedRevision`; it must fail if a manageable field is omitted.

## Task 3 — Config dashboard, sections and safe statuses

Files: `AdminDashboard.tsx`, `ConfigFields.tsx`, `admin-dashboard.test.ts`, `admin-config.css`.

- [ ] Bootstrap Task 8's closed browser fixture before writing this UI. Author its missing-navigation check now and observe a real failure because Manage Aurvin/dashboard do not exist. For Tasks 3–7, add that task's relevant DOM interaction checks to the same fixture and run them red before implementing the event behavior, then green afterward. Static rendering is supplementary, not the sole TDD evidence for interactions. Task 8 consolidates and extends this already-running fixture.
- [ ] Add a failing static-render check, importing `createElement`, `renderToStaticMarkup` and mocked read/edit hook state with the existing Vitest style. Prefer a pure presentational export `ConfigFields` for section checks; use the same production component, not a duplicate fixture UI:

```ts
it('renders only the selected section with labeled units and fixed privacy', () => {
  const html = renderToStaticMarkup(createElement(ConfigFields, {
    section: 'openrouter', fields: fieldsFromSettings(publicConfig().settings),
    errors: [], disabled: false, onChange: () => undefined,
  }));
  expect(html).toContain('Model ID');
  expect(html).toContain('Data collection denied');
  expect(html).toContain('Transforms disabled');
  expect(html).not.toContain('Daily minutes');
  expect(html).not.toContain('OPENROUTER_API_KEY');
});
```

Define ConfigFields props as `{section, fields: FieldValues, errors: AdminConfigError['error']['fieldErrors'], disabled: boolean, onChange: (path: AdminConfigFieldPath, value: string | boolean) => void}`. Catalog conversion errors use the same safe field-error shape. No candidate prop.

- [ ] Run `npm test -- src/features/admin-config/admin-dashboard.test.ts -t "renders only the selected section"`; expect missing component/export failure.
- [ ] Implement ConfigFields using the catalog. Each control has a stable id, label, help id and linked `aria-describedby`; invalid controls also have aria-invalid and a linked field error. Use fieldset/legend for subgroups, labeled inputs/selects/checks, native number inputs with appropriate step/min/max, and an explicit nullable blank policy. Fixed policies/model allowlists have no arbitrary-value input. Server fieldErrors appear beside known fields and in the summary, including hidden sections with a section link; never show raw server paths as primary user labels.
- [ ] Implement AdminDashboard: focusable h1, Back to chat, tabs Config/Analytics, initial tab Config and section OpenRouter on every fresh entry. Initial read can succeed when chat is not ready. Pending read shows a status; failed read shows storage/configuration unavailable with Retry; do not fabricate defaults or write local substitutes. Fence read callbacks with a request sequence and AbortController, clearing them on dashboard unmount.
- [ ] Implement true Config/Analytics tab semantics with associated tabpanel ids, aria-selected, one tab in the Tab order, Left/Right/Home/End roving focus, and Enter/Space activation. Config holds a desktop section nav of buttons with current state and a mobile labeled native select; both share one section value. Analytics renders only an empty tabpanel, with no sample data, charts, empty-state marketing or analytics request.
- [ ] Keep nonsecret field values in the dashboard reducer across section/tab changes. Show global Unsaved changes and identify dirty sections; explicitly say Save changes saves nonsecret edits across sections and not provider keys. Leaving a section never silently discards fields. Unmount its credential editor on section/tab change so the candidate clears; moving within the same editor does not clear it.
- [ ] Add Save changes with form validation and exact `{protocolVersion:1,expectedRevision:baseline.revision,settings}` from settingsFromFields. Disable all concurrent mutation actions and nonsecret editing during a mutation; use a synchronous in-flight ref as well as rendered disabled state to block double clicks before React rerenders. Keep page/tab/section navigation disabled during a dispatched mutation, explaining “Wait for the save to finish”; do not suggest canceling a request proves it did not commit. Do not call updateCredential from this handler.
- [ ] Show accessible dirty/saving/saved status, with role=status/aria-live=polite; failures use a concise role=alert summary, focus summary/first invalid field after explicit submit (not each keystroke), and preserve edits. Map errors exactly as Task 6 below. Saved status follows public activation, not assumptions. Wire pending/success/error reducer actions and read epochs, not duplicated revision state in each section.
- [ ] Add tests for Config default, empty Analytics markup/no analytics client method, section catalog coverage, fixed policies, field errors described by id, save disabled while clean/pending/stale, unconfigured/blocked not labeled active, and unavailable read no substitute settings. Actual tab/field/save event checks run in Task 8's browser fixture, not SSR.
- [ ] Run `npm test -- src/features/admin-config/admin-dashboard.test.ts src/features/admin-config/config-edit-state.test.ts`; expect passing tests. Stage the four named files only, then `git commit -m "feat(admin-config): build section-based configuration dashboard"` during the granted turn.

## Task 4 — Write-only credentials, replace and confirmed removal

Files: `CredentialRow.tsx`, `credential-row.test.ts`; extend `AdminDashboard.tsx`/`admin-config.css` only for composition/styles.

- [ ] Add the failing configured-row check:

```ts
it('renders a fixed mask without a reveal control or credential value', () => {
  const html = renderToStaticMarkup(createElement(CredentialRow, {
    provider: 'openrouter', credential: publicConfig().credentials.openrouter,
    expectedRevision: 1, disabled: false, client: createAdminConfigClient({ fetch: vi.fn() }),
    onBusy: () => undefined, onSaved: () => undefined, onFailure: () => undefined,
  }));
  expect(html).toContain('••••••••');
  expect(html).toContain('Configured');
  expect(html).toContain('Replace key');
  expect(html).toContain('Remove key');
  expect(html).not.toMatch(/Reveal|Show key|fingerprint|suffix|prefix/);
});
```

- [ ] Run `npm test -- src/features/admin-config/credential-row.test.ts -t "renders a fixed mask"`; expect a missing CredentialRow failure.
- [ ] Implement unconfigured row as “Not configured” with Add key; configured row uses the literal `••••••••` (aria-hidden) plus Configured accessible text. validatedAt may be labeled as last validation, never as a fingerprint. There is no key value/prefix/suffix response, eye/reveal control, length-dependent placeholder or hidden DOM copy.
- [ ] Add the local replacement editor: `useState('')` candidate only in CredentialRow; labeled `type="password"` input with autocomplete="off", autoCapitalize="none", spellCheck=false, no value from server, no URL/form navigation, UTF-8 bound check and maxLength as an additional convenience. Browser/password-manager controls are best effort, not a guarantee. Focus input when editor opens; Cancel clears it and returns focus to Add/Replace. Do not send while typing, blur, section navigation or Enter outside the editor's form. A single submit issues updateCredential replace and automatically saves/activates on the backend; label it Validate and save, with Validating and saving while pending.
- [ ] Before dispatch, block double submission synchronously and call onBusy(true). Await one request using the current expectedRevision. On success clear candidate before leaving the editor, call onSaved(public config), and close the editor. On actionable credential-validation failure retain candidate only inside that editor so the user can correct/retry explicitly. Clear on Cancel, unmount, section/tab switch, dashboard departure and nonactionable uncertain/transport response failures. Do not pass candidate into the reducer, onFailure, logs, toast, window state, storage or capability refresh. Avoid retaining request bodies in custom debug objects.
- [ ] Add Remove key as a separate local confirmation state with “Remove the OpenRouter key?” / “Remove the Deepgram key?” and “New work may be unavailable. Active work is not canceled by this change.” Use a focusable inline confirmation group, explicit Confirm removal/Cancel, and polite status; no on-click removal before confirmation. Confirm POSTs `{protocolVersion:1,expectedRevision,action:'remove',confirm:true}` exactly once. A failure leaves the old configured indicator; success consumes only the public config. Do not set configured=false optimistically.
- [ ] Display beneath each editor: “Checks whether the provider recognizes this key. Does not verify account credit, model access, or end-to-end voice/chat availability.” No paid model/speech check or temporary client credential creation. Explain saved settings apply to new work without guaranteeing a removed/revoked key still works for active requests.
- [ ] Add SSR assertions for unconfigured/add vs configured/replace/remove, provider-specific accessible labels, password-only input when editor renders, fixed mask constant independent of validation time, removal-confirmation copy, and limitation copy. Browser Task 8 must prove candidate clearing, no reveal/no storage, no second Save, exactly one POST, previous state on failure, no dirty settings in credential requests and updated revision used by later settings saves.
- [ ] Run `npm test -- src/features/admin-config/credential-row.test.ts src/features/admin-config/admin-dashboard.test.ts`. Commit the four named changed files only with `git commit -m "feat(admin-config): add write-only credential replacement and removal"` after the granted turn.

## Task 5 — Profile disclosure and persistent chat navigation

Files: `ProfileMenu.tsx`, `Sidebar.tsx`, `App.tsx`, `App.css`, `ChatView.tsx`, `navigation.test.ts`, `admin-config.css`.

- [ ] Add a failing native-profile static-render test:

```ts
it('offers Manage Aurvin and explains the disabled Sign out', () => {
  const html = renderToStaticMarkup(createElement(ProfileMenu, { onManageAurvin: vi.fn() }));
  expect(html).toContain('Super admin');
  expect(html).toContain('Manage Aurvin');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Sign out<\/button>/);
  expect(html).toContain('Authentication not enabled.');
});
```

- [ ] Run `npm test -- src/features/admin-config/navigation.test.ts -t "offers Manage Aurvin"`; expect missing ProfileMenu failure.
- [ ] Reuse Sidebar's native details/summary disclosure pattern rather than inventing an ARIA menu widget. Add a footer outside `.aurvin-session-nav`; min-height:0 allows history to shrink/scroll and footer stays pinned. Native summary is the Super admin trigger with a decorative profile mark; label the disclosure, keep Manage Aurvin a native button, and Sign out actually disabled with visible “Authentication not enabled.” linked by aria-describedby. Do not use fake identity/account details/logout behavior. Do not declare role=menu and then omit menu keyboard rules; native Tab/Enter/Space semantics are sufficient for this disclosure.
- [ ] Profile popup positions above the footer, not within history overflow. On opening, focus Manage Aurvin after native toggle; Escape prevents default, closes and focuses summary. Blur closes only when relatedTarget leaves the entire disclosure; pointerdown outside closes. Do not steal focus back after outside click/focus; return it only for Escape/cancel. Manage closes and invokes the provided navigation callback; focus then moves to dashboard h1. Attach outside listener only while open and clean it up. Test duplicate toggles and immediate click after open.
- [ ] Wire navigation in the existing VoiceChatShell, keeping `useLiveVoice`, bindings and registerVoiceStart unchanged. Maintain local `page: 'chat' | 'admin'`, initially chat; set admin on Manage and conditionally mount ONLY the dashboard. Keep chat unconditionally mounted with a stable position and no page/revision key:

```tsx
<>
  <div className="aurvin-chat-surface" hidden={page !== 'chat'} inert={page !== 'chat'}>
    <ChatView liveVoice={voice} visible={page === 'chat'}
      onManageAurvin={() => { dispatch({ type: 'CLOSE_SIDEBAR' }); setPage('admin'); }} />
  </div>
  {page === 'admin' ? <AdminDashboard client={adminClient}
    refreshCapabilities={refreshCapabilities} onBackToChat={() => setPage('chat')} /> : null}
</>
```

Add dispatch to the current useChat destructure. App still mounts exactly one ChatProvider and VoiceChatShell. Do not dispatch NEW_CHAT/SELECT_SESSION/RELEASE_VOICE_INPUT or invoke cancel/exit/disconnect on Manage/Back. The same Composer stays mounted while dictation is active; hiding this wrapper does not change document.hidden and must not invoke pagehide behavior.
- [ ] Pass onManageAurvin from ChatView to Sidebar only. Guard ChatView's own restoreLiveDraftFocus layout effect while visible=false so background completion cannot focus a hidden composer. When returning, focus the profile trigger if visible, otherwise the Open sidebar button, falling back to the composer if appropriate; perform this after unhiding, not while inert. Remember the entry target with a ref; do not focus every chat state update. Restore draft selection/scroll by retained DOM where possible, without editing voice internals or chat-state files. Do not replace the entire ChatView with the dashboard inside the same keyed node.
- [ ] App.css gives `.aurvin-chat-surface {height:100%; min-height:0}` and an explicit `.aurvin-chat-surface[hidden] {display:none}` so author display rules cannot override hidden. Inert removes hidden controls from keyboard access; hidden removes them from the accessibility tree. Admin content takes full height and scrolls internally because body already has overflow:hidden.
- [ ] On the dashboard, show a noninteractive “Chat/voice continues in the background” status when existing chat state indicates active work, with Back to chat always available when no admin mutation is pending. Do not copy messages, credentials or negotiated voice limits into admin state. This is a navigation status, not a second voice lifecycle owner.
- [ ] Add static assembly checks for the footer order, callback props, one ChatProvider, persistent chat wrapper, no page-based key and hidden/inert semantics. Keep existing App forwarding/start tests unchanged; new navigation tests live in the owned feature. Browser interaction/lifecycle proof is required in Task 8; source count alone is not sufficient.
- [ ] Run `npm test -- src/features/admin-config/navigation.test.ts src/App.assembly.test.ts src/components/Sidebar.test.ts src/features/chat/ChatView.test.ts src/features/chat/ChatView.voice.test.ts src/components/Composer.test.ts`. Expect the existing tests plus new tests to pass without editing their unrelated assertions. Commit exactly the seven named changed files with `git commit -m "feat(admin-config): add profile entry without unmounting chat"` after a granted turn.

## Task 6 — Conflicts, uncertain writes, unsaved exits and refresh

Files: `AdminDashboard.tsx`, `CredentialRow.tsx`, `config-edit-state.ts`, `config-edit-state.test.ts`, `admin-dashboard.test.ts`, `navigation.test.ts`.

- [ ] Add a failing navigation decision test:

```ts
it('keeps unsaved edits when leaving is declined and never leaves during a save', () => {
  const decline = vi.fn(() => false);
  expect(navigationDecision({ dirty: true, pending: false }, decline)).toBe('stay');
  expect(decline).toHaveBeenCalledOnce();
  const accept = vi.fn(() => true);
  expect(navigationDecision({ dirty: true, pending: true }, accept)).toBe('stay');
  expect(accept).not.toHaveBeenCalled();
});
```

- [ ] Run `npm test -- src/features/admin-config/navigation.test.ts -t "keeps unsaved edits"`; expect missing navigationDecision or incorrect behavior to fail.
- [ ] Implement navigationDecision with pending => stay, dirty && !confirmDiscard() => stay, otherwise leave. Dashboard's Back calls it with native `window.confirm('Discard unsaved configuration changes and return to chat?')`; accepted departure unmounts the admin editor, not chat. Section/tab changes retain all nonsecret fields in memory and show dirty indicators without prompting to discard them; that is the protection for those transitions. Clear transient credential editor on each transition. Add beforeunload only while dirty or pending; remove the listener when clean/unmounted. Never store a draft/candidate to avoid the unload prompt. A browser unload/abort cannot promise cancelation of an already sent mutation.
- [ ] Make Refresh/Reload explicit when dirty: confirm “Discard unsaved configuration changes and reload saved settings?” before replacing fields. If declined, leave baseline/draft untouched. Conflict is “Settings changed elsewhere. Your edits are still here. Reload saved settings before trying again.” CurrentRevision is informational only. Do not automatically overwrite newer settings, increment the revision locally, or silently rebase a failed full-settings save. Refresh discards only after consent; user can manually reapply intended edits to the fresh baseline. Credential success at the same expected revision is the separate, tested safe dirty-overlay case from Task 2.
- [ ] For CONFIG_WRITE_UNCERTAIN or a dispatched mutation's timeout/network/invalid-response failure: “The save outcome is unknown. Reload saved settings before making another change.” Lock mutations and allow explicit read-back; do not label saved/failed-not-saved, auto retry, infer candidate identity from Configured, or treat frontend abort as cancellation. Read-back can show the current revision/configuration, but cannot prove a replacement key is the exact rejected/unknown candidate. Clear uncertain candidate; keep nonsecret edits until the operator confirms discard/reload.
- [ ] Map CONFIG_STORAGE_UNAVAILABLE to storage unavailable, CONFIG_STORED_INVALID to invalid stored configuration, CONFIG_ENCRYPTION_UNAVAILABLE to backend key setup unavailable, CONFIG_ACTIVATION_UNAVAILABLE to activation unavailable; offer safe operator guidance, not env secrets/internal details. INVALID_ADMIN_ORIGIN/ADMIN_TRANSPORT_REQUIRED explain trusted origin/HTTPS or explicit localhost-development requirement and block retry until setup is corrected. ADMIN_RATE_LIMITED and CREDENTIAL_PROVIDER_RATE_LIMITED show “Try again later”; rejected key permits correction; timeout/provider unavailable/invalid response offer explicit retry without exposing raw provider output. CONFIG_VALIDATION_FAILED/INVALID_CONFIG_REQUEST show linked safe field messages. Client unknown-response/network messages are constant and never interpolate exception.message. Exhaustively cover ADMIN_CONFIG_ERROR_CODES in a typed message record, with a test rejecting missing entries.
- [ ] Invoke refreshCapabilities exactly once after each confirmed settings or credential mutation, not on typing, navigation, failed validation, conflict, uncertain write, or canceled removal. Apply the saved PublicAdminConfig first, then refresh separately. A false/rejected refresh yields “Saved. Voice availability could not be refreshed. Retry voice refresh before starting a new session.” A Retry voice refresh button calls ONLY that hook, not a save endpoint. Do not undo a successful saved revision, recalculate active voice limits or restart controllers. Fence refresh completion against a newer operation/unmounted dashboard to prevent stale warnings. Unconfigured/blocked remains distinct from active even if capabilities refreshed successfully.
- [ ] Add reducer/orchestration tests for canceled discard, confirmed discard, conflict preserving drafts and preventing blind retry, currentRevision not used as expectedRevision, uncertain outcome locking, explicit fresh reload, stale callbacks ignored, capability failure not undoing saved revision, and refresh-only retry. Use injected clients/hooks and deferred promises rather than timers or real calls. In browser checks, spy `refreshCapabilities` to assert one invocation per confirmed save and zero per failure.
- [ ] Run `npm test -- src/features/admin-config/config-edit-state.test.ts src/features/admin-config/admin-dashboard.test.ts src/features/admin-config/navigation.test.ts`. Commit only the six named changed files with `git commit -m "feat(admin-config): handle conflicts and safe capability refresh"` after the granted turn.

## Task 7 — Responsive and accessible finish

Files: `admin-config.css`, `AdminDashboard.tsx`, `ConfigFields.tsx`, `CredentialRow.tsx`, `ProfileMenu.tsx`, `admin-dashboard.test.ts`, `credential-row.test.ts`.

- [ ] Add failing assertions for tab/panel id associations, selected-tab-only tabIndex=0, all label/description/error id connections, configured mask's aria-hidden vs Configured text, removal confirmation name, and nonsecret/credential statuses. Include a server field error in another section and require a usable section-navigation control in the error summary.
- [ ] Run `npm test -- src/features/admin-config/admin-dashboard.test.ts src/features/admin-config/credential-row.test.ts`; expect the newly missing semantics to fail, then fix the smallest component markup.
- [ ] Implement scoped CSS: full-height flex dashboard, fixed header/tabs, content scroller, 180–220px desktop section rail and bounded roughly 760px field content, 24–32px desktop/16px mobile padding. At max-width:768px hide the rail and show the Section select, stack labels/inputs/actions, wrap long labels and button groups, keep touch targets at least 44px. Field rows use minmax(0,1fr), input min-width:0/width:100%, and select font/color explicitly inherited. Profile footer is flex-shrink:0/position:relative with popup bottom:calc(100% + 8px); history has min-height:0. Keep each visible view's scroll region usable at short viewport height.
- [ ] Reuse global focus-visible accent outline. Do not communicate invalid/dirty/active state by color alone. Use semantic field groups, clear units/help, status/error text and aria attributes. Error summary receives focus only after explicit failure; changing fields does not steal focus. Escape cancels an idle credential editor/removal prompt and returns focus to its source control; while a request is pending, explain the wait instead of discarding an indeterminate mutation. Closing a disclosure on outside focus never returns focus to its trigger.
- [ ] Add scoped reduced-motion rules disabling dashboard/profile transitions and smooth scrolling. Prefer no entrance animation. Do not modify existing voice-orb animation. Verify native controls in dark/light color-scheme inherit Aurvin surfaces/text and that select options remain readable.
- [ ] Run `npm test -- src/features/admin-config/admin-dashboard.test.ts src/features/admin-config/credential-row.test.ts`, then `npm run build` and `npm run lint`. Expect discovered passing tests, a successful TypeScript/Vite build and no new lint errors. Browser measurements, zoom/light/dark/focus/reduced-motion checks happen next; CSS text tests alone are insufficient. Commit the seven named changed files with `git commit -m "style(admin-config): finish responsive accessible dashboard"` during the granted turn.

## Task 8 — Real DOM interaction fixture and navigation proof

Files: `testing/dashboard-browser.html`, `testing/dashboard-browser.tsx`, `testing/browser-checks.ts`; extend `testing/fixtures.ts` only for safe deterministic responses. No P7 integration-test ownership changes.

- [ ] Create the Vite-served fixture HTML with a root, a result/status region and module entry `/src/features/admin-config/testing/dashboard-browser.tsx`. This is a development-only fixture, not a production route or query toggle. The entry refuses non-DEV execution. It imports the same index/App styles and mounts the actual App through createRoot with injected admin/chat clients and refresh callback. Install deny-by-default mocked fetch/media globals before dynamically importing App because the shared voice HTTP client captures fetch during module evaluation. Every unexpected network destination/mutation fails the fixture; no request escapes to a real backend/provider, and no real microphone is requested.
- [ ] Use real browser DOM and React's existing `act` export for checks; no DOM library/package change. Set the test act-environment flag locally and restore global replacements after the run. Fixtures supply only safe placeholder candidates such as fixture-only-key. Fake chat fetch supports sessions/messages/submission/status/SSE and throws on any unexpected request. Keep a controllable ReadableStream for text generation; record its AbortSignal/cancel request count, not credential bodies in rendered diagnostic output.
- [ ] During the pre-UI bootstrap required by Task 3, add the first red browser check: set Message input to “keep this draft”, open Super admin, activate Manage Aurvin, then Back to chat; assert the same textarea node/value and selected chat remain, no text cancellation and no repeated voice capability load caused by remount. At that point it must fail because Manage Aurvin/dashboard do not exist. Record the failed assertion before implementation; rerun it green after Task 5. Do not manufacture a red result by breaking completed code at Task 8.
- [ ] Reuse these native event/assertion primitives in `browser-checks.ts`, not a new test runner:

```ts
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function typeInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function press(target: HTMLElement, key: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
```

Use act around typing/clicking/keypress/deferred completion, and resolve fixture promises explicitly. Stub window.confirm with queued accept/decline fixture responses for automated discard/removal checks, restoring it afterward; separately inspect the real confirmation flow manually. Query by accessible labels/text and assert checked/selected/focused/hidden states in the real DOM. Do not call production handlers/reducers directly and label that an interaction test.

- [ ] Implement ordered browser checks, each with a visible name/pass/fail count: profile footer stays below long scrolling history; Enter/Space disclosure activation; Escape return focus; outside click/focus close without theft; disabled Sign out/no logout; Config default; Analytics empty/no request; keyboard tabs; section select and fields; dirty section/tab preservation; native discard decline/accept; valid settings save revision/status; client-safe field errors; delayed save double-click blocking; replace single validate-and-save POST, no unrelated fields; fixed mask/no reveal; candidate clear after success/cancel/section/tab/departure; actionable failure retained only in current editor; removal decline/confirm/failure; conflict no blind retry; uncertain write locking; refresh success/failure/retry only.
- [ ] Spy application storage writes in the fixture: Storage.prototype.setItem, document.cookie setter where configurable, indexedDB.open and CacheStorage.open/put where available. Snapshot local/session storage before/after; assert no admin-owned writes and no fixture candidate in URLs, rendered text, storage, safe error objects or console output. The masked input necessarily has its transient value property; do not incorrectly claim plaintext never exists in browser memory/DOM input state. Restore spies in finally.
- [ ] Add text-continuity check using actual App and fixture SSE: start one response, navigate away, enqueue delta/status/completed envelopes while admin is visible, then return and assert the same turn/session/transcript completed, no duplicate submit/cancel and the original stream signal not aborted. Use STREAM_PROTOCOL_VERSION and StreamEnvelope from existing protocol; successful terminal fixture references the same accepted attempt and durable-completion metadata. Do not alter chat state to make this pass.
- [ ] Add actual navigation smoke with existing dictation/live hooks while voice is disabled: repeated Manage/Back must not request media, create sessions, replace capability-store ownership, or invoke teardown solely due to navigation. This proves passive ownership behavior, not active microphone/socket continuity. Active dictation/live/reconnect proof requires P4-backed deterministic browser audio/socket fixtures; ask P7/P4 for that fixture handoff if unavailable. Do not run live services, request real microphone permission or invent a second voice lifecycle owner. A missing active-voice fixture keeps that acceptance gate blocked, not passed by SSR/passive smoke.
- [ ] Start `npm run dev -- --host 127.0.0.1` in frontend (background server allowed; no backend needed for this closed fixture). Open `http://127.0.0.1:5173/src/features/admin-config/testing/dashboard-browser.html` using the browser panel; use its actual reported port if 5173 is occupied. Snapshot, run fixture checks, then inspect/capture desktop and mobile views. Require all check names/counts and zero page errors; a blank/zero-check page is failure. Use browser resize desktop/mobile; inspect 320px width in the fixture's measurement check and test 200% zoom. Verify no horizontal overflow via document.documentElement.scrollWidth <= innerWidth, footer/menu bounds and reachable last field/Save at short height. Capture a configured-row desktop and mobile view with fixture-only values.
- [ ] Manually check real Tab traversal, Enter/Space, Escape, native select/tab arrows and focus after errors/navigation in addition to dispatched events. Verify light/dark and reduced-motion using browser/system emulation when available; if the client cannot drive/emulate those settings, report the specific check blocked for P7 rather than claiming the CSS proves it. Leave a concise count/result summary for the orchestrator; P7 records permanent acceptance evidence in its owned verification artifact.
- [ ] Run `npm test -- src/features/admin-config` (all discovered focused tests), `npm run build`, `npm run lint`, then `npm test` (entire frontend). Run existing voice capability, dictation/live composition and chat lifecycle regression suites as part of that full run. Expect nonzero passing checks and no regressions; report actual counts/failures/skips, not planned outcomes.
- [ ] Commit only the four named fixture files changed in this task with `git commit -m "test(admin-config): verify real dashboard interactions and chat continuity"` after the granted turn. When the fixture bootstrap was created in Task 3, include those exact new fixture paths in Task 3's staging turn or make an earlier focused `test(admin-config): add closed browser fixture` commit; do not leave them untracked until the end or stage unrelated paths. Do not claim P5's exit complete until required real interaction checks and the active-work gate below have evidence; return incomplete/blocked checks to P7 with ownership routed to P4 for voice internals.

## Exit gates and handoff

| Goal gate | P5 evidence | Related owner / unresolved gate |
| --- | --- | --- |
| AC1 sidebar/dashboard/empty Analytics | Tasks 3/5/7/8: real menu/tab/section/focus/desktop/mobile checks, draft/selection preservation and no analytics requests. | P7 repeats assembled-browser evidence. |
| AC3 write-only credentials | Tasks 1/4/8: guarded redacted responses, eight-dot mask, no reveal, input clearing, no browser-storage/cache writes. | P2 proves encryption/log/server redaction; frontend cannot certify ciphertext at rest. |
| AC4 validate-and-save | Tasks 1/4/8: one scoped POST, no keystroke check/no second save, old state preserved on fixture failure and useful limitations copy. | P2 provider validation fixtures; no agent-run live calls. |
| AC5 immediate activation/continuity | Tasks 2/5/6/8: confirmed revision consumed, refresh hook exactly once, saved vs active distinction, mounted chat/voice owners and active SSE survival. | P4/P7 must prove active dictation/live/reconnect session snapshots in real browser fixtures. Disabling/removing does not promise continued provider validity. |
| AC6 safe saves/removal | Tasks 2/3/4/6/8: field bounds/cross-field errors, dirty isolation, expected revision, conflict/uncertain locks, explicit discard/reload and confirmed removal. | P1/P2 remain authoritative for backend validation/CAS/admission; no automatic UI conflict overwrite. |
| AC8 checks/security | Tasks 7/8: package checks plus real DOM interactions, accessible responsive inspection and explicit blocked checks. | P7 full backend/native/TLS/origin/voice accounting/integrated evidence; P6 central composition. |

Return component/client interfaces above, exact modified paths/commit hashes, actual test counts/commands, browser fixture URL/capture paths, required unrun checks and ownership questions. P6 must preserve independent admin availability during unconfigured chat, return PublicAdminConfig exactly, publish confirmed activation only, and keep the P4 shared refresh endpoint/store usable. There is no frontend export/import, config cache, second runtime, analytics endpoint or new authentication contract.

Known decision gates: (1) `543e53c` chat-state/backend-test reconciliation belongs to an explicitly assigned owner, not P5. (2) If keeping the existing mounted Composer is insufficient for an observed dictation/live-navigation issue, route the failing fixture to P4/orchestrator before editing voice/chat-state code. (3) Existing Node-only Vitest cannot establish active browser media continuity; P4/P7 fixture availability and an interactive browser are prerequisites. P5 may finish its owned implementation while those integrated gates remain blocked, but must not report full acceptance. (4) No migration execution, paid/live calls, provisioning, deployment or unified review is authorized; record review as **skipped**, never passed.
