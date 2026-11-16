# P3 — Local Google Calendar OAuth and Connection Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use `executing-plans` and `test-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work only on P3; do not dispatch a reviewer. Unified review is **skipped**, not passed.

**Goal:** Provide browser-bound local OAuth, safe connection control routes, and revision-fenced credentials for the one server-configured Aurvin identity.

**Architecture:** Consume the frozen P1 connection/wire contracts and P2 connection store/cipher; never construct a database client or another persistence owner. Use Google's authorization-code flow with S256 PKCE, signed OIDC identity validation, and the existing P5 `CalendarTargetPort` implementation. Keep setup HTTP independently composable for module fixtures; P8 installs it in the real application, while P6 consumes the credential/gate ports and P7 consumes the frozen setup API.

**Tech Stack:** TypeScript ESM/NodeNext (`.js` local imports), Node `^22.22.3 || ^24.15.0 || >=26.0.0`, built-in `fetch`/`node:crypto`, NestJS, Zod 3, Vitest, Supertest. No package or lockfile changes are planned.

## Steps

- [ ] Establish options, fixtures, and the default-off/status boundary.
- [ ] Implement bounded OAuth HTTP and signed Google identity validation.
- [ ] Implement browser-bound single-use OAuth initiation/callback.
- [ ] Activate grants with owned-target verification and stale-flow fencing.
- [ ] Implement current-binding checks and bounded refresh/rotation.
- [ ] Implement enable/disable, reconnect, local disconnect, and explicit revoke.
- [ ] Expose guarded setup routes and prove the module composition.
- [ ] Run regression/secret checks and publish the P6/P7/P8 handoff.

## Authority, inputs, and non-goals

Read [goal.md](goal.md), [research.md](research.md) sections 2, 6, 7.3, 8, and 9, and [state.md](state.md#p3--local-oauth-and-connectionsetup-api). The dated approval in state governs the goal's stale preparation-era approval paragraph. P1/P2 workers are complete; P4/P5 also exist in the checkout. These documents and deterministic tests do not authorize a real grant, credentials provisioning, Google requests, Calendar mutations, paid inference, application-data migration, or deployment.

Read these source contracts before writing tests:

- `backend/src/contracts/calendar-connections.ts`: exact `CalendarConnectionStore`, `CalendarOAuthState`, `CalendarConnectionRecord`, `GoogleIdentityPort`, `CalendarTargetPort`, `CalendarCredentialPort`, `CalendarConnectionGate`, and `CalendarConnectionBinding` shapes.
- `backend/src/contracts/calendar-wire.ts`: exact routes, request/response schemas, and existing Calendar stream events.
- `backend/src/contracts/calendar-policy.ts`: `CALENDAR_SCOPES`, default-off options, 600,000 ms OAuth state, 20,000 ms maximum tool timeout, and separate two-request refresh budget.
- `backend/src/persistence/calendar-connections.ts`: confirmed/conflict/uncertain writes, atomic consume-and-tombstone behavior, and transition checks.
- `backend/src/platform/crypto/calendar-secret-cipher.ts`: `sealToken/openToken`, `sealVerifier/openVerifier`, and their distinct AAD.
- `backend/src/persistence/calendar-retention.ts` and `calendar-records.ts`: source-linked removal and tombstones remain the persistence owner's job.
- `backend/src/plugins/google-calendar/calendar-api.ts:387-411`: existing target verifier. Do not replace it or edit any `calendar-api*`/`tools*` file.
- `backend/src/plugins/google-calendar/tools.ts`: the credential and current-gate invocation seams. Reuse `CalendarToolFault`/`toolFault` from `tools-validation.js` so P5 does not collapse credential failures into an unrelated policy error.
- `backend/src/admin-config/configure-admin-http.ts`, `admin-config.module.ts`, `admin-config.controller.ts`: reuse composition/security patterns, not the broader HTTPS admission or the admin collector that rejects an empty `{}` body.
- `backend/src/main.ts`, `backend/src/http/configure-chat-http.ts`, `frontend/vite.config.ts`: read-only integration context. Vite currently rewrites Host with `changeOrigin: true`.

Do not own sign-in, RBAC, member accounts, shared chat transport, central wiring, Calendar tools, MCP, graph execution, retention sweeps, shared schemas, or manifests. Do not change the approved transport, limits, three actions, repair wording, retention, or local-only scope. If implementation needs such a change, stop and report it to the orchestrator and owning worker. Missing native/live prerequisites are named gates, not permission to substitute a broader scope or a fake success.

## File map and responsibility

All paths below are new P3-owned files; existing upstream files are read-only.

| File | Responsibility |
| --- | --- |
| `backend/src/plugins/google-calendar/options.ts` | Parse already-supplied server options; fixed endpoint constants; local boundary/config coherence; no environment loading. |
| `backend/src/plugins/google-calendar/oauth-http.ts` | Bounded form POSTs and JSON GETs to fixed Google endpoints; safe failure classification; no automatic retries. |
| `backend/src/plugins/google-calendar/oauth-identity.ts` | `GoogleIdentityPort`: pinned Google RS256/JWKS and claim/nonce validation. |
| `backend/src/plugins/google-calendar/oauth-client.ts` | Authorization URL, code exchange, refresh, and explicit revoke atop the bounded HTTP helper. |
| `backend/src/plugins/google-calendar/oauth.ts` | Durable state plus browser cookie/PKCE; one active local setup snapshot; callback replay/expiry/staleness protection. |
| `backend/src/plugins/google-calendar/connection.ts` | One identity-owned connection: status, grant installation, lifecycle, binding gate, refresh single-flight, invalidation notification. |
| `backend/src/plugins/google-calendar/controller-http.ts` | Plugin-only loopback Host/Origin/custom-header checks, bounded JSON collection, safe headers/rate limits, callback exception. |
| `backend/src/plugins/google-calendar/controller.ts` | Thin exact-route controller and closed error filter. |
| `backend/src/plugins/google-calendar/module.ts` | Register already-created connection/OAuth instances; never create runtime/persistence. |
| `backend/test/plugins/google-calendar/connection-fixtures.ts` | In-memory P1 store fixture, real P2 cipher with a fake key, deferred promises, virtual clock, service factory. |
| `backend/test/plugins/google-calendar/oauth-fixtures.ts` | Fixed-origin scripted fetch and locally generated RSA ID-token fixtures. |
| `backend/test/plugins/google-calendar/connection.spec.ts` | Status, grant install, binding, revisions, settings, disconnect/revoke, failure containment. |
| `backend/test/plugins/google-calendar/connection-refresh.spec.ts` | Refresh concurrency, rotation, budget/deadline/abort, stale completion, missing/revoked grants. |
| `backend/test/plugins/google-calendar/oauth-http.spec.ts` | Endpoint, body/redirect/size/deadline/error boundaries. |
| `backend/test/plugins/google-calendar/oauth-identity.spec.ts` | Signed-token validation and hostile identity fixtures. |
| `backend/test/plugins/google-calendar/oauth.spec.ts` | State/browser/PKCE, callback parsing, replay, cancellation, stale setup. |
| `backend/test/plugins/google-calendar/setup.spec.ts` | Real Nest module/Supertest route fixtures, local HTTP protections, safe public output. |

Prefer these focused files over a new generic OAuth framework. Keep fixture records bounded; no transcript/event payload arrays in connection records. Use actual P1 types rather than local shadow contracts.

### Concrete service construction seam

Use these P3 composition records, not new shared contracts. Import all referenced store/binding/account types from P1, cipher from P2, and client/identity classes from the P3 files named here. Define `CalendarOAuthOptions = z.infer<typeof calendarOAuthOptionsSchema>` and `CalendarDisconnectResponse = z.infer<typeof calendarDisconnectResponseSchema>` as local aliases; neither alias already exists as a P1 export.

```typescript
export type ConnectionDependencies = {
  store: CalendarConnectionStore; cipher: CalendarSecretCipher;
  options: CalendarSetupOptions; identity: IdentityResolver;
  client: GoogleCalendarOAuthClient; target: CalendarTargetPort;
  now?: () => number;
  onInvalidated: (binding: CalendarConnectionBinding,
    reason: 'disconnect' | 'replacement' | 'disabled' | 'reconnect-required') => Promise<void>;
};
export type OAuthDependencies = {
  connections: GoogleCalendarConnections; store: CalendarConnectionStore;
  cipher: CalendarSecretCipher; options: CalendarSetupOptions;
  client: GoogleCalendarOAuthClient; googleIdentity: GoogleIdentityPort;
  now?: () => number;
};
export type InstallGrantInput = {
  snapshot: SetupSnapshot; grant: OAuthGrant;
  account: { subject: string; email: string | null };
  signal: AbortSignal; deadlineAt: string; isCurrentFlow: () => boolean;
};
```

`new GoogleCalendarConnections(dependencies)` owns the fixed resolved user, exposed read-only to the OAuth service as `userId`. `new GoogleCalendarOAuthService(dependencies)` consumes that identity, never another resolver/browser user. Its `start(signal)` returns an internal `{ authorizationUrl: string; browserCookie: string }`; the controller returns only the schema-validated URL and writes the cookie as a header. Its `callback({ rawQuery, cookieHeader }, signal)` returns only `'connected' | 'fixture' | 'cancelled' | 'failed'` on a validated/consumed flow and throws safe errors for invalid bindings. `connections.installGrant(input: InstallGrantInput): Promise<void>` owns target verification and publication; the OAuth service owns state/code/identity verification. Both share the supplied objects rather than constructing replacement clients/stores/ciphers. Fixture convenience wrappers may accept separate state/code/cookie arguments only to construct those exact raw callback inputs.

## Frozen handoff: API, identity, and status

The global prefix is `/api`; `CALENDAR_API_ROUTES` deliberately omits that prefix. Publish this seam to P7 when the plan is committed, before P8 central wiring:

| Method/path | Request | Success |
| --- | --- | --- |
| `GET /api/plugins/google-calendar/status` | No body/query/identity | `calendarStatusResponseSchema`, HTTP 200; no network health call. |
| `PATCH /api/plugins/google-calendar/settings` | Exactly `{ "enabled": boolean }` | Updated `calendarStatusResponseSchema`, HTTP 200. |
| `POST /api/plugins/google-calendar/oauth/start` | Exactly `{}` | `calendarOAuthStartResponseSchema`, HTTP 200, plus HttpOnly correlation cookie. |
| `GET /api/plugins/google-calendar/oauth/callback` | Google code/error and state navigation | HTTP 302 to the fixed frontend root with `plugin=google-calendar` and allowlisted `oauth` outcome. |
| `POST /api/plugins/google-calendar/disconnect` | `{ "mode": "local" }`, or `{ "mode": "revoke-google-grant", "acknowledgeProjectWideRevocation": true }` | `calendarDisconnectResponseSchema`, HTTP 200 only after local disconnection is confirmed. |

All mutations use `Content-Type: application/json`, exact configured frontend `Origin`, and `X-Aurvin-Calendar-CSRF: 1`. This non-simple custom header plus exact Origin is the setup anti-CSRF mechanism; the value is a marker, not a credential. No new CSRF endpoint or browser-storage token is needed. P7 uses the existing same-origin `/api` proxy and must not add an identity, calendar ID, token, client secret, arbitrary URL, or model field. The target is server configuration, not a settings request field. P8 separately applies this local boundary to tool-enabled chat; P3 does not edit shared chat routes.

The callback accepts the expected top-level cross-site GET with **no Origin** and `SameSite=Lax` correlation cookie. It does not demand Aurvin-page Origin. A supplied non-frontend Origin, a hostile Host/peer, malformed callback, or missing browser/state binding fails closed. Never follow a callback-supplied return URL.

Status precedence is deterministic:

1. Effective operator enablement false: `disabled`.
2. Enabled but incomplete backend configuration or no grant: `setup-required`.
3. Missing/revoked/expired unusable grant: `reconnect-required`.
4. Uncertain storage, temporarily unusable service, closing/fenced service, or **fixture provenance**: `degraded`.
5. Only an enabled, usable, verified production Google grant/target: `connected`.

`enabled` is operator intent; it does not assert credential or real-service readiness. With no connection record, enablement defaults to `calendarOptionsSchema.parse({}).enabled === false`. A pre-connection enable action lives in this one process until a grant is installed; restarting before connection returns to the configured initial default. Once a record exists, settings persist `record.enabled`; a stored opt-in may survive restart. The supplied initial option is not an undocumented second hard-disable switch. Every dispatch still consults the live service gate. Disabling retains encrypted credentials; disconnect destroys them.

Return only protocol version, state, enabled, optional verified display email, exact configured target, and the frozen processing disclosure. `googleSubjectId`, connection/credential revisions, encrypted envelopes, provider responses, and token expiry diagnostics are not public status fields. A fixture-backed service must return `degraded` rather than `connected`; its callback outcome is `fixture`, never `connected`. Do not add a fake/real field to P1's wire schema.

## Supported OAuth mechanism and remaining admission gates

Pin the implementation behavior, not a new dependency: Google web-server authorization-code + S256 PKCE, Google OIDC RS256 verification using Node's `createPublicKey({ key, format: 'jwk' })` and `verify('RSA-SHA256', ...)`, and the P1 scope set exactly. This uses the standard-library rung and retains the frozen manifests. Do not accept decoded-but-unverified JWTs, use `tokeninfo` as a production validator, or accept browser-supplied tokens.

Primary documentation consulted for this plan (documentation, not executed service evidence):

- [Google OIDC discovery and ID-token validation](https://developers.google.com/identity/openid-connect/openid-connect): issuer, audience, expiry, Google keys, nonce, immutable subject; Google recommends public-key validation, not a debugging `tokeninfo` dependency.
- [Google discovery document](https://accounts.google.com/.well-known/openid-configuration): fixed endpoints, RS256, S256. Any future endpoint/algorithm drift must block setup, not become an arbitrary URL fetch.
- [Google web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server): offline credentials, grants and project-wide revocation implications.
- [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth): `calendar.events.owned`, not calendar-list/ACL or general identity permission.
- [Node 24 crypto API](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptocreatepublickeykey): JWK import and RSA signature verification; supported also by the repository's admitted engine families.

Request only `openid email https://www.googleapis.com/auth/calendar.events.owned`, `include_granted_scopes=false`, `access_type=offline`, and `prompt=consent`. Normalize Google's granted email alias `https://www.googleapis.com/auth/userinfo.email` to the frozen canonical `email`; this is scope-name normalization, not a new permission. Require the verified full P1 set before activation. A missing refresh token is setup/reconnect-required, not offline readiness; a failed connection must **not** automatically revoke the wider Google project grant.

An `events.list` preflight with `accessRole=owner` is only a candidate ownership proof when combined with the actual narrow grant and exact subject/target binding. It does not independently certify Calendar data ownership. P3 must call the existing `CalendarTargetPort`, check its exact echo and recognized proof revision, reject missing/`primary`/control-character targets rather than fall back, and keep actual narrow-scope/disposable-target compatibility **G3 unrun** until separately authorized live evidence exists. If the narrow scope cannot support the required target validation, stop and report P1/P5; do not request calendar-list/full Calendar access or silently switch targets.

G9 real-data processing/retention approval remains external to these fixtures. Production setup requires a non-null processing policy ID and an explicitly supplied server-side policy-admission decision from P8; a fake policy ID alone is not approval. No fetched event bodies are needed for setup: P5 requests only preflight access role/timezone. The disclosure says data may be processed by Google, OpenRouter, and the configured model provider and keeps `dataCollection: 'deny'`; it does not claim zero retention or fully local processing.

## Task 1: Options, deterministic fixture, and safe default-off projection

**Files:** Create `backend/src/plugins/google-calendar/options.ts`, `connection.ts`, `backend/test/plugins/google-calendar/connection-fixtures.ts`, and `connection.spec.ts`.

- [ ] **1. Write the failing options/status test.** Use a fake resolver returning `{ userId: 'u1', source: 'server-configured', openRouterUser: 'u1' }`. Use a `CalendarConnectionStore` fixture whose `get/create/compareAndSwap/putState/consumeState` follow the real P1 signatures and clone returned records. The CAS fixture must enforce revision, return explicit conflict/uncertain outcomes, and consume state only once for matching user/hash/browser and `createdAt <= now < expiresAt`; it is not native-Mongo evidence. Use a real `CalendarSecretCipher({ status: 'ready', key: Buffer.alloc(32, 7) })`; never load `.env`.

```typescript
it('default off does not call Google or expose secrets', async () => {
  const f = connectionFixture();
  expect(await f.service.status()).toEqual({
    protocolVersion: 1, state: 'disabled', enabled: false,
    accountEmail: null, targetCalendarId: null, processingDisclosure: null,
  });
  expect(f.network).not.toHaveBeenCalled();
  expect(f.identity.resolve).toHaveBeenCalledTimes(1);
  expect(f.storeCalls.every(call => call.userId === 'u1')).toBe(true);
});
```

Define the shared `connectionFixture()` return shape now: `{ service, store, cipher, identity, network, clock, storeCalls, readRecord, seedRecord, failNextCas, invalidations }`. `clock` supplies `now(): number` and `advance(ms): void`; `seedRecord` parses the P1 schema; `readRecord` clones the fixture record. `failNextCas('conflict' | 'uncertain')` injects exactly one CAS outcome. `invalidations` stores only trusted old bindings/reasons, never tokens. The fixture's network function throws for every unscripted request.

- [ ] **2. Run red from `backend/`.** `npm test -- test/plugins/google-calendar/connection.spec.ts -t "default off does not call Google or expose secrets"` — expect missing fixture/service exports, not a skip.
- [ ] **3. Add the minimum options/service shell and projection.** Export these concrete P3-only option types; do not edit P1 schemas:

```typescript
export type CalendarSetupOptions = {
  initial: CalendarOptions;
  oauth: (CalendarOAuthOptions & { clientSecret: string }) | null;
  frontendOrigin: string;
  backendOrigin: string;
  evidence: 'google' | 'fixture';
  realDataPolicyApproved: boolean;
};

export function publicStatus(input: {
  enabled: boolean; configured: boolean; degraded: boolean;
  record: CalendarConnectionRecord | null;
  options: CalendarSetupOptions;
}): CalendarPublicStatus {
  const { enabled, configured, degraded, record, options } = input;
  const state = !enabled ? 'disabled' : !configured ? 'setup-required'
    : degraded ? 'degraded' : !record ? 'setup-required'
    : record.status === 'disconnected' ? 'setup-required'
    : record.status === 'reconnect-required' ? 'reconnect-required'
    : record.status === 'degraded' || options.evidence === 'fixture' ? 'degraded'
    : 'connected';
  return calendarStatusResponseSchema.parse({
    protocolVersion: 1, state, enabled,
    accountEmail: record?.accountEmail ?? null,
    targetCalendarId: options.oauth?.targetCalendarId ?? null,
    processingDisclosure: options.initial.processingPolicyId === null ? null : {
      policyId: options.initial.processingPolicyId,
      processors: 'Google, OpenRouter and the configured model provider',
      dataCollection: 'deny',
    },
  });
}
```

`CalendarOAuthOptions` is `z.infer<typeof calendarOAuthOptionsSchema>` locally; `CalendarOptions` and other record/status types are existing imports. `parseCalendarSetupOptions` uses the P1 option/OAuth schemas, parses the client secret separately as a bounded nonempty server secret, and validates exact HTTP loopback origins, no credentials/path/query/hash, correct callback path, and target constraints. Missing OAuth/encryption/policy input means not configured; do not call Google. Nonblank malformed configuration throws a static configuration error without interpolating supplied values.

For callback cookie coherence require `redirectUri.origin` to equal **either** configured frontend or backend origin, and its hostname to equal the frontend hostname. Cookies are host-bound, not port-bound: `localhost` and `127.0.0.1` are not interchangeable. Support same-origin Vite callback/proxy or same-host direct backend callback; never guess aliases. Check raw incoming Host against the single configured backend authority, including port; Vite's rewritten Host must match that value. Ignore `Forwarded`/`X-Forwarded-*`. P8 owns resolving any actual config/proxy mismatch.

`GoogleCalendarConnections` resolves the supplied `IdentityResolver` once in its constructor and freezes the user ID. It takes the exact `ConnectionDependencies` record above. Constructor/`status()` perform no network calls and own no database lifecycle. Treat an expired stored access token as refresh-needed rather than an automatic revoked grant; status does not refresh or probe.

- [ ] **4. Run green and add table-driven options cases.** Repeat the focused command; then run `npm test -- test/plugins/google-calendar/connection.spec.ts`. Cover empty options, missing key/client secret/policy, remote/credential-bearing origins, wrong callback path, hostname mismatch, omitted target, `primary`, control characters, dot segments, and a literal known owned ID. Confirm no fallback target and no public secret fields.
- [ ] **5. Commit only the four named task files.** Message: `feat(google-calendar): add default-off local connection options`.

## Task 2: Bounded fixed-endpoint OAuth transport and client

**Files:** Create `backend/src/plugins/google-calendar/oauth-http.ts`, `oauth-client.ts`, `backend/test/plugins/google-calendar/oauth-fixtures.ts`, and `oauth-http.spec.ts`.

- [ ] **1. Write the failing transport test.** `scriptedOAuthFetch` in `oauth-fixtures.ts` must match the fixed origin/path/method and throw on unlisted requests; request bodies stay in test memory only. Export `jsonResponse(body, status = 200)` and `deferred<T>()` for subsequent tests.

```typescript
it('exchange uses form body PKCE and never retries a code', async () => {
  const f = oauthHttpFixture([{ status: 200, body: {
    token_type: 'Bearer', access_token: 'fixture-access', refresh_token: 'fixture-refresh',
    expires_in: 3600, id_token: 'fixture-id-token',
    scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events.owned',
  } }]);
  const grant = await f.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: f.deadlineAt });
  expect(f.requests).toHaveLength(1);
  const request = f.requests[0]!;
  expect(request.url).toBe('https://oauth2.googleapis.com/token');
  const body = new URLSearchParams(await request.text());
  expect(body.get('code_verifier')).toBe('v'.repeat(43));
  expect(body.get('redirect_uri')).toBe(f.options.oauth!.redirectUri);
  expect(body.get('client_secret')).toBe('fixture-client-secret');
  expect(grant.scopes).toEqual(expect.arrayContaining([...CALENDAR_SCOPES]));
});
```

`oauthHttpFixture(steps)` constructs the real client with virtual time, parsed fixture options and scripted fetch and exposes `{ client, requests, options, deadlineAt }`. `deadlineAt` is ten seconds after its virtual clock; the callback/start fixtures share the same clock.

- [ ] **2. Run red.** `npm test -- test/plugins/google-calendar/oauth-http.spec.ts -t "exchange uses form body PKCE and never retries a code"` — expect missing OAuth client/helper.
- [ ] **3. Implement fixed-endpoint transport and client.** Pin constants in `options.ts`: authorization `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`, revoke `https://oauth2.googleapis.com/revoke`, discovery `https://accounts.google.com/.well-known/openid-configuration`, and JWKS `https://www.googleapis.com/oauth2/v3/certs`. The helper receives an internal endpoint enum, not a caller URL. Use `redirect: 'error'`, `cache: 'no-store'`, shared abort/deadline signal and a streaming UTF-8 collector that checks bytes **before** concatenation/JSON parse; cancel the reader on overflow/abort. Cap token responses at 32 KiB, discovery/JWKS at 64 KiB, and error/revoke responses at 4 KiB. These are setup/security bounds, not replacements for approved tool budgets. Never invoke `.json()` on an unbounded body or log request/response content.

The client exports these exact internal shapes for the remaining tasks:

```typescript
export type OAuthGrant = {
  accessToken: string; refreshToken: string; idToken: string;
  expiresAt: string; scopes: string[];
};
export type RefreshedGrant = {
  accessToken: string; refreshToken: string | null;
  expiresAt: string; scopes: string[] | null;
};
export type OAuthDeadline = { signal: AbortSignal; deadlineAt: string };

export function authorizationUrl(options: CalendarSetupOptions, input: {
  state: string; nonce: string; challenge: string;
}): string {
  if (options.oauth === null) throw new AppError('NOT_READY', 'Calendar setup is required.', false);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: options.oauth.clientId, redirect_uri: options.oauth.redirectUri,
    response_type: 'code', scope: CALENDAR_SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false',
    state: input.state, nonce: input.nonce,
    code_challenge: input.challenge, code_challenge_method: 'S256',
  }).toString();
  return calendarOAuthStartResponseSchema.parse({ authorizationUrl: url.href }).authorizationUrl;
}
```

`GoogleCalendarOAuthClient.exchange({ code, verifier, signal, deadlineAt }): Promise<OAuthGrant>` POSTs client ID/secret, exact redirect, code, `grant_type=authorization_code`, verifier. Validate Bearer token type, bounded non-control token strings consistent with cipher limits (1..8192 UTF-8 bytes), finite positive integral `expires_in` and representable future expiry, required signed ID token and offline refresh token, and scope list at most ten entries of at most 200 characters. Canonicalize the email alias before testing `CALENDAR_SCOPES.every(...)`. Missing/invalid scope or refresh token fails without activation or automatic revoke.

`refresh({ refreshToken, signal, deadlineAt }): Promise<RefreshedGrant>` uses `grant_type=refresh_token`; absent replacement refresh token means preserve the old one, absent returned scopes means retain the already-verified scope set. Explicitly returned scopes must still contain the required canonical set. Ignore an unsolicited refresh `id_token` as identity input; do not replace the bound subject from it. `revoke({ token, signal, deadlineAt }): Promise<'confirmed' | 'failed' | 'unknown'>` sends `token` in a form **body**, not a URL. A 200 is confirmed; explicit rejection is failed; timeout, redirect, malformed response, or lost response is unknown. No automatic token/revocation retries.

Classify fixed provider error codes internally (e.g. `invalid_grant` => reconnect-required); never propagate `error_description`, body, token, URL query, or exception text. Use a local closed failure code mapping compatible with `CalendarFailure`/`AppError`; unknown failures become static safe errors.

- [ ] **4. Run green and adversarial transport cases.** Repeat the focused command, then `npm test -- test/plugins/google-calendar/oauth-http.spec.ts`. Assert zero retries on lost code/refresh response; abort/deadline before dispatch; aborted body reader; exact byte cap and cap+1, chunked response overflow, malformed UTF-8/JSON, redirect to an attacker, wrong media type, negative/NaN/overflow expiry, missing scope/refresh, normalized email alias, invalid-grant, and zero client-secret/token/code strings in thrown messages. No real fetch fallback is permitted in fixtures.
- [ ] **5. Commit the named files and `options.ts` constant addition.** Message: `feat(google-calendar): add bounded OAuth code refresh and revoke client`.

## Task 3: Signed OIDC identity and nonce validation

**Files:** Create `backend/src/plugins/google-calendar/oauth-identity.ts`, `backend/test/plugins/google-calendar/oauth-identity.spec.ts`; modify `oauth-fixtures.ts`.

- [ ] **1. Write a signed-token failure test, not a decoded-JWT test.** Generate RSA-2048 keys locally in the fixture with `generateKeyPairSync('rsa', { modulusLength: 2048 })`; sign `base64url(header).base64url(claims)` with `sign('RSA-SHA256', ...)`. Export `identityFixture()` with real `GoogleCalendarIdentity`, fixed discovery/JWKS responses, `nonce`, `now`, `input`, and `signToken(claimOverrides, headerOverrides)`.

```typescript
it('identity requires signature audience issuer expiry and browser nonce', async () => {
  const f = identityFixture();
  expect(await f.identity.verify(f.input)).toEqual({ subject: 'fixture-sub', email: 'fixture@example.invalid' });
  await expect(f.identity.verify({ ...f.input,
    idToken: f.signToken({ aud: 'another-client' }),
  })).rejects.toMatchObject({ failure: { category: 'credential' } });
  await expect(f.identity.verify({ ...f.input,
    expectedNonceHash: 'a'.repeat(64),
  })).rejects.toMatchObject({ failure: { category: 'credential' } });
});
```

- [ ] **2. Run red.** `npm test -- test/plugins/google-calendar/oauth-identity.spec.ts -t "identity requires signature audience issuer expiry and browser nonce"` — expect missing identity verifier.
- [ ] **3. Implement `GoogleCalendarIdentity implements GoogleIdentityPort`.** Implement signature verification locally using fixed trusted Google keys, not any JWT header URL:

```typescript
export function verifyRs256(input: {
  signingInput: string; signature: Buffer; jwk: JsonWebKey;
}): boolean {
  const key = createPublicKey({ key: input.jwk, format: 'jwk' });
  return key.asymmetricKeyType === 'rsa'
    && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048
    && verify('RSA-SHA256', Buffer.from(input.signingInput, 'ascii'),
      { key, padding: constants.RSA_PKCS1_PADDING }, input.signature);
}
```

Use Node crypto's `JsonWebKey` type. `verify()` receives exactly P1's `{ idToken, clientId, expectedNonceHash, now, signal }`; internally bound the whole operation to at most 20 seconds. Parse exactly three canonical nonempty base64url JWT segments with at most 16 KiB total. Header requires `alg=RS256`, bounded nonempty `kid`, no `crit`, no token-supplied `jku`/`x5u`/embedded key. JSON objects must not contain duplicate keys: reuse existing `scanJsonObject` from `backend/src/model/strict-json.ts` read-only, checking `code` (its model-policy `forbidden` flag is irrelevant for OIDC JSON). Do not write a second JSON scanner.

Fetch the fixed discovery URL once per verification, check `issuer`, `authorization_endpoint`, `token_endpoint`, and `jwks_uri` equal the pinned constants and advertised S256/RS256 support, then fetch only the pinned JWKS URL. Bound keys to at most 16; select exactly one matching `kid`, RSA signing key, `use` absent or `sig`, `alg` absent or RS256, `key_ops` absent or containing `verify`; reject private key material and duplicate matching keys. No shared key cache is necessary for this low-frequency setup proof; therefore no cache-refresh retry loop or arbitrary discovery chain is introduced. Unavailable/unknown keys fail setup, not identity verification by decoding.

After signature success require: Google issuer (`https://accounts.google.com` or documented `accounts.google.com`), client ID in audience; if audience has multiple entries require `azp === clientId`, and if `azp` exists at all require it match; numeric finite integral `exp > nowSeconds`, `iat <= nowSeconds + 60`, `iat < exp`, optional `nbf <= nowSeconds + 60`; bounded nonempty immutable `sub`; and `sha256(nonce) === expectedNonceHash` using constant-time equal-length hash comparison. Nonce is required because this flow always requested one. For email display return a bounded valid email only with `email_verified === true`, else null. Do not bind identity by email, event organizer, or `hd`; no domain/member admission is being implemented. Discard ID token/claims after verification; persist only subject and optional display email.

- [ ] **4. Run green and claim/key matrix.** Repeat focused command, then `npm test -- test/plugins/google-calendar/oauth-identity.spec.ts`. Test tampered payload/signature, `none`/HS256, attacker key URL, wrong/missing/duplicate kid, key algorithm/use mismatch, expired at exact boundary, future iat/nbf, wrong issuer/audience/azp, absent/oversized sub/nonce, nonce mismatch, unverified email, malformed/base64 padding/duplicate JSON, oversized discovery/JWKS/token, hostile discovery URL, and abort. Every failure must be bounded and secret-safe. This certifies local signed fixtures only.
- [ ] **5. Commit the three named files.** Message: `feat(google-calendar): verify signed Google subject and OAuth nonce`.

## Task 4: Browser-bound OAuth initiation and callback consumption

**Files:** Create `backend/src/plugins/google-calendar/oauth.ts`, `backend/test/plugins/google-calendar/oauth.spec.ts`; modify `connection.ts`, `connection-fixtures.ts`, and `oauth-fixtures.ts` for setup snapshots.

- [ ] **1. Write the failing replay/cross-browser test.** Export `oauthFixture()` with `{ oauth, service, store, clock, exchange, identityVerify, targetVerify, start, callback, readState, replaceService }`. `start()` calls the real OAuth service and returns `{ authorizationUrl, cookie }`; callback supplies raw query/cookie strings directly without HTTP. Spies return only deterministic grants/identity/target proof. `replaceService()` creates a fresh service against the same fixture store, deliberately losing the pending setup snapshot.

```typescript
it('callback is single use browser bound and expires at the deadline', async () => {
  const f = oauthFixture();
  const first = await f.start();
  const state = new URL(first.authorizationUrl).searchParams.get('state')!;
  await expect(f.callback({ state, code: 'fixture-code', cookie: 'wrong-browser' }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.exchange).not.toHaveBeenCalled();
  await f.callback({ state, code: 'fixture-code', cookie: first.cookie });
  expect(f.exchange).toHaveBeenCalledTimes(1);
  await expect(f.callback({ state, code: 'fixture-code', cookie: first.cookie }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.exchange).toHaveBeenCalledTimes(1);
  const second = await f.start();
  f.clock.advance(CALENDAR_LIMITS.oauthStateMs);
  await expect(f.callback({ state: new URL(second.authorizationUrl).searchParams.get('state')!,
    code: 'fixture-code', cookie: second.cookie })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.exchange).toHaveBeenCalledTimes(1);
});
```

- [ ] **2. Run red.** `npm test -- test/plugins/google-calendar/oauth.spec.ts -t "callback is single use browser bound and expires at the deadline"` — expect missing OAuth service.
- [ ] **3. Implement state/PKCE creation and callback pre-exchange validation.** The class is `GoogleCalendarOAuthService`, takes the same P1 store/P2 cipher/current connection service/parsed options/clock, and exports `start(signal)` and `callback({ rawQuery, cookieHeader }, signal)`.

```typescript
const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const randomOpaque = (): string => randomBytes(32).toString('base64url');

export function createOAuthState(input: {
  userId: string; redirectUri: string; now: number; cipher: CalendarSecretCipher;
}): { record: CalendarOAuthState; state: string; browser: string; nonce: string; challenge: string } {
  const state = randomOpaque(), browser = randomOpaque(), nonce = randomOpaque();
  const verifier = randomOpaque();
  const binding = { userId: input.userId, stateHash: hash(state), browserHash: hash(browser),
    oidcNonceHash: hash(nonce), redirectUri: input.redirectUri };
  return {
    record: oauthStateSchema.parse({ ...binding, schemaVersion: 1, kind: 'calendar-oauth-state',
      encryptedVerifier: input.cipher.sealVerifier(binding, verifier),
      createdAt: new Date(input.now).toISOString(),
      expiresAt: new Date(input.now + CALENDAR_LIMITS.oauthStateMs).toISOString(), consumedAt: null }),
    state, browser, nonce,
    challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'),
  };
}
```

Persist `putState(record)` **before** returning an authorization URL or setting a cookie. Raw state/browser nonce/OIDC nonce/verifier never enter logs, checkpoints, status, or browser storage. The authorization URL necessarily contains transient state/nonce/challenge, never the verifier. Set exactly `aurvin_gcal_oauth=<browser>; Path=/api/plugins/google-calendar/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=600`, no Domain; local HTTP does not set Secure. Clear that same cookie on every callback that passed the local boundary, including denied consent/errors, with Max-Age=0.

The frozen OAuth-state record intentionally has no connection revision/target snapshot field. Do not change it or smuggle JSON into the verifier. Keep **one** bounded volatile pending setup entry `{ stateHash, expiresAt, snapshot }`; a new start supersedes the prior entry. Add a `ponytail:` code comment identifying this single-flow/single-process ceiling and future durable versioned setup-snapshot upgrade. A restart loses the entry and requires a new Connect action even if a durable state record still exists; fail closed before exchange. The entry contains no raw verifier or tokens.

Define `SetupSnapshot = Readonly<{ userId: string; recordRevision: number | null; lifecycleEpoch: number; targetCalendarId: string; redirectUri: string }>` in `connection.ts`. `captureSetupSnapshot()` reads the trusted current record, verifies configured/allowed setup, and captures the service lifecycle epoch. All state replacement, disconnect, disable, close, and target/config changes invalidate pending flows. `installGrant` in Task 5 rechecks the snapshot; no automatic rebasing to a later record.

Parse the **raw** callback query with `URLSearchParams`, max 8 KiB and one occurrence per key. Allow only `state`, `code`, `error`, `error_description`, `error_uri`, `scope`, `authuser`, `prompt`, `hd`, `iss`; ignore informational fields rather than trusting them as grant/identity evidence. Require canonical 43-character base64url state and browser cookie, exactly one code **or** error, no duplicate cookie name, no code+error, no query/body identity. If `iss` is present it must equal Google's configured issuer. Never reflect provider error text/URIs. A denied-consent callback still validates/consumes state and clears the browser cookie; it exchanges zero codes.

Validate the local pending snapshot and hash, then call `store.consumeState({ userId, stateHash, browserHash, now })`; null/throw/uncertain stops before token exchange. Require the returned record's redirect URI to equal the configured URI, matching state/browser hashes and future expiry. Decrypt only via `cipher.openVerifier(record, record.encryptedVerifier)` after confirmed consumption. Consume once even when code exchange/identity/preflight later fails; never retry the code or restore consumed state. Do not clear a newer pending setup entry when an older callback finishes.

- [ ] **4. Run green and state matrix.** Repeat focused command, then `npm test -- test/plugins/google-calendar/oauth.spec.ts`. Cover missing/duplicate/malformed state/code/cookie, consent denied, mismatch, cross-browser, exact expiry/future-created state, two concurrent callbacks (one exchange), lost consume ACK (zero exchanges), verifier AAD swap, superseded start, disabled while start persists, persistence failure before cookie issuance, restart with durable state, and missing configured redirect. Assert PKCE hash matches the decrypted verifier; nonce hash matches the authorization nonce; raw values are absent from the stored record and safe output. A callback failure does not disconnect a previously healthy connection.
- [ ] **5. Commit the named files.** Message: `feat(google-calendar): bind expiring OAuth state to the initiating browser`.

## Task 5: Grant activation, owned-target validation, and stale callback fencing

**Files:** Modify `backend/src/plugins/google-calendar/connection.ts`, `oauth.ts`, `backend/test/plugins/google-calendar/connection.spec.ts`, `connection-fixtures.ts`, and `oauth.spec.ts`.

- [ ] **1. Write the failing grant/target test.** Extend the fixture with `installFixtureGrant({ subject, targetCalendarId, accessToken, refreshToken })`, which calls the real `installGrant` with a captured snapshot and deterministic verified inputs; this helper does not bypass identity/target verification in the OAuth callback test.

```typescript
it('grant activation verifies the exact owned target and fences old bindings', async () => {
  const f = connectionFixture({ configured: true, enabled: true });
  await f.installFixtureGrant({ subject: 'fixture-sub-a', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access-a', refreshToken: 'fixture-refresh-a' });
  const first = await f.service.currentBinding();
  expect(first).toMatchObject({ userId: 'u1', googleSubjectId: 'fixture-sub-a', calendarId: 'owned-a' });
  const oldVersion = f.readRecord()!.credentialVersion;
  await f.installFixtureGrant({ subject: 'fixture-sub-b', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access-b', refreshToken: 'fixture-refresh-b' });
  const next = f.readRecord()!;
  expect(next.connectionRevision).toBe(first.connectionRevision + 1);
  expect(next.credentialVersion).toBe(oldVersion + 1);
  await expect(f.service.requireCurrent(first, new AbortController().signal))
    .rejects.toMatchObject({ failure: { category: 'policy' } });
  expect((await f.service.status()).state).toBe('degraded'); // fixture is not a real grant
});
```

Add `installFixtureGrant` to the explicit fixture return shape from Task 1. It may select only the fixture's already-configured target; for a target-change case construct a replacement service with changed server configuration, never a browser request target.

- [ ] **2. Run red.** `npm test -- test/plugins/google-calendar/connection.spec.ts -t "grant activation verifies the exact owned target and fences old bindings"` — expect missing install/current-binding behavior.
- [ ] **3. Implement the callback chain and installation.** Callback shares one at-most-20-second setup deadline across code exchange, identity verification, and target preflight. Use `AbortSignal.any` to combine request, service-closing, and deadline signals. Verify the actual grant with `GoogleIdentityPort.verify({ idToken, clientId, expectedNonceHash: consumed.oidcNonceHash, now, signal })`, then pass `InstallGrantInput` to `connections.installGrant`. That method calls its supplied `CalendarTargetPort.verifyOwnedTarget` with the verified subject, snapshot's exact target and access token, same signal/deadline, and a setup-local request counter allowing one preflight (no automatic retries). This is setup work, not a hidden reset of a turn's counters.

Check returned proof `{ calendarId, googleSubjectId, verifiedAt, proofRevision }` matches the requested target/subject and `google-calendar.events-owned.v1`; reject another target, unknown proof revision, invalid/future timestamp, inaccessible/non-owner target, insufficient scope or malformed result. P3 does not implement an alternate Calendar fetch. No activation on any preceding failure; discard volatile unusable credentials without a revoke request.

Install using an exact old-record CAS snapshot after rechecking: same fixed user, same configured target/redirect, same lifecycle epoch, same pending flow, same record revision. New connection uses new server-generated `connectionId`, all four revisions 1, verified subject/email, configured calendar, `enabled` intent, encrypted access+refresh, expiry and canonical scopes. Reconnect/account replacement always generates a new connection ID, advances `revision`, `connectionRevision`, and `credentialVersion` by one; `targetRevision` advances by one **only** when the calendar ID changes. A refresh alone must not advance `connectionRevision`/`targetRevision`.

Use the exact token AAD below, sealing **both** tokens whenever the credential version changes:

```typescript
export function tokenAad(record: Pick<CalendarConnectionRecord,
  'userId' | 'connectionId' | 'credentialVersion' | 'googleSubjectId'>,
  tokenKind: 'access' | 'refresh') {
  return { version: 1 as const, provider: 'google-calendar' as const,
    userId: record.userId, connectionId: record.connectionId,
    credentialVersion: record.credentialVersion, googleSubjectId: record.googleSubjectId, tokenKind };
}
```

P2 requires changed credentials to use exactly prior `credentialVersion + 1`, a connected record to have access+refresh, and disconnected records to have null credentials/disabled. Re-encrypt the preserved refresh token too; copying its old envelope under new AAD fails. Accept only `outcome: 'confirmed'`; conflict/uncertain never enables use or returns connected. Do not replay code exchange or rebase an account switch after conflict. If an in-flight installation races a disconnect/close, mark the process gate blocked immediately and do not return success even if a late write was acknowledged; local cleanup/reconciliation remains required.

`currentBinding(): Promise<CalendarConnectionBinding>` returns a frozen copy of only trusted current binding fields after the gate succeeds. It never returns credentials. `requireCurrent(binding, signal)` checks all six binding fields plus the fixed user, enabled intent, connected status, required scopes, credentials, unchanged configured target, closing/fenced state, and signal before and after the store read. Another subject/target/connection, disabled-then-reenabled revision, or stale snapshot fails policy admission without refresh. Token decryption/AAD failure is credential/reconnect-required, not a model structural repair.

- [ ] **4. Run green and stale-install/swap matrix.** Repeat the focused command. Run `npm test -- test/plugins/google-calendar/connection.spec.ts test/plugins/google-calendar/oauth.spec.ts`. Include account replacement, same-account reconnect, server target change, target-proof echo mismatch, old callbacks after target/config change, disconnect/disable/new start/restart during exchange/identity/preflight, grant install conflict/uncertain, swapped access/refresh envelopes, other user/subject/version envelopes, missing scope and refresh, target denied, and no automatic revoke. Assert old bindings invoke zero actions and no target silently becomes `primary`.
- [ ] **5. Commit the named files.** Message: `feat(google-calendar): activate verified grants with connection revision fencing`.

## Task 6: Current credentials, bounded refresh single-flight, and rotation

**Files:** Modify `backend/src/plugins/google-calendar/connection.ts`, `backend/test/plugins/google-calendar/connection-fixtures.ts`; create `connection-refresh.spec.ts`.

- [ ] **1. Write the failing concurrent refresh test.** The fixture supplies `seedExpiredGrant()`, `binding`, `refresh` spy, `releaseRefresh(grant)`, `useToken()` and `refreshBudget` spy. `useToken()` calls the production `withAccessToken` port; it must never directly read/decrypt tokens in the test helper.

```typescript
it('concurrent refresh is single flight and rotation is durable before use', async () => {
  const f = refreshFixture();
  await f.seedExpiredGrant();
  const a = f.useToken(), b = f.useToken();
  await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
  f.releaseRefresh({ accessToken: 'fixture-access-new', refreshToken: 'fixture-refresh-new',
    expiresAt: new Date(f.clock.now() + 3600000).toISOString(), scopes: [...CALENDAR_SCOPES] });
  expect(await Promise.all([a, b])).toEqual(['fixture-access-new', 'fixture-access-new']);
  expect(f.refreshBudget).toHaveBeenCalledTimes(1);
  expect(f.actionBeforeConfirmedCas).toBe(false);
  expect(f.readRecord()!.credentialVersion).toBe(2);
});
```

`refreshFixture()` extends `connectionFixture`, uses a deferred real OAuth-client response rather than network, and initializes a valid encrypted record at credential version 1. Add it to `connection-fixtures.ts` with the return members named above.

- [ ] **2. Run red.** `npm test -- test/plugins/google-calendar/connection-refresh.spec.ts -t "concurrent refresh is single flight and rotation is durable before use"` — expect absent refresh/port implementation.
- [ ] **3. Implement `CalendarCredentialPort` on the same connection service.** Preserve P1's exact `withAccessToken<T>({ binding, signal, deadlineAt, consumeRefreshRequest }, action): Promise<T>` signature. No other token access method is exported. Before and after every await recheck abort/deadline and the current binding. A valid cached access token may be used only after successful AAD decryption and the final current gate; keep no long-lived plaintext token cache. Use a 30-second expiry safety margin, bounded by actual expiry, without changing turn deadlines.

Use one in-flight refresh promise keyed to the one current connection ID/revision/credential version. Publish the promise synchronously **before** awaiting work and remove it in `finally` only if still the same promise. At most one refresh HTTP request exists at a time. Other callers wait with their own abort/deadline listener removed in `finally`; no unbounded waiter list and no new retry budget. A leader abort may fail all joined waiters safely; it must not silently spawn a replacement refresh. Each caller must reread the current durable record after joining, not use a leader's plaintext result or binding.

The refresh leader performs, in order:

1. Require current binding and snapshot credential/store revisions; decrypt the refresh token with current AAD.
2. Await the P6-supplied `consumeRefreshRequest()` **before** network; on denial make zero refresh requests. This callback owns the persisted per-turn cap of two; do not invent a resetting P3 counter or retry loop.
3. Recheck binding/abort/deadline immediately after budget admission. POST once with a signal bounded to the smaller of 20 seconds and remaining deadline.
4. Validate the returned grant. Preserve original plaintext refresh token if no replacement was supplied; retain verified scopes if omitted, reject insufficient explicitly returned scopes.
5. Recheck lifecycle epoch, subject, target and original revisions. Seal access and refresh using `credentialVersion + 1`, advance store `revision + 1`, preserve binding/target revisions, and CAS once.
6. On confirmed CAS reread/recheck the current gate; only then may any caller execute `action(token)`. No action on conflict/uncertain ACK, stale replacement, budget denial, invalid grant, abort, or timeout. Do not replay `action` after it starts.

`invalid_grant`, absent refresh material, AAD failure, or a definitely unusable grant fences further use and records reconnect-required with connection-revision invalidation. For this transition retain the existing encrypted envelopes, advance store/connection revision, preserve credential version, and set `status: 'reconnect-required'`; this is valid under the frozen P2 rules and cannot pass the gate. Never keep a plaintext failed token. Credential destruction occurs through the valid disconnected transition in Task 7; do not attempt a schema-invalid connected/reconnect record with changed null credentials. A lost refresh response/rotation ACK is degraded/reconnect-required and never authorizes using an unpersisted rotated token. Transient Google failures degrade Calendar, not text chat/liveness. P6 receives `CalendarFailure` categories credential/budget/cancelled/persistence as appropriate; no schema repair applies.

- [ ] **4. Run green and refresh matrix.** Repeat the focused command; run `npm test -- test/plugins/google-calendar/connection-refresh.spec.ts`. Test fresh token (zero refresh), expiry at margin, two callers/one request, ten concurrent callers/one request, missing replacement retains refresh under new AAD, insufficient scope, missing/revoked grant, budget cap at two across separate expirations and third denial, already-aborted caller, waiter cancellation/listener cleanup, hanging body/deadline, failed/uncertain CAS (zero actions), disable/disconnect/reconnect/target/account swap while refresh awaits, and no replay of a failed action. Assert stale refresh completion cannot restore credentials after disconnect.
- [ ] **5. Commit the three named files.** Message: `feat(google-calendar): serialize bounded token refresh and safe rotation`.

## Task 7: Settings, disconnect, explicit revoke, and invalidation notification

**Files:** Modify `backend/src/plugins/google-calendar/connection.ts`, `oauth.ts`, `backend/test/plugins/google-calendar/connection.spec.ts`, `connection-refresh.spec.ts`, and fixtures as needed.

- [ ] **1. Write the failing disconnect/revoke test.**

```typescript
it('local disconnect fences first and never revokes the Google project grant', async () => {
  const f = connectionFixture({ configured: true, enabled: true });
  await f.installFixtureGrant({ subject: 'fixture-sub', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access', refreshToken: 'fixture-refresh' });
  const binding = await f.service.currentBinding();
  const result = await f.service.disconnect({ mode: 'local' }, new AbortController().signal);
  expect(result).toEqual({ disconnected: true, remoteRevocation: 'not-requested' });
  expect(f.readRecord()).toMatchObject({ enabled: false, status: 'disconnected', credentials: null });
  expect(f.revoke).not.toHaveBeenCalled();
  await expect(f.service.requireCurrent(binding, new AbortController().signal)).rejects.toBeDefined();
  expect(f.invalidations).toContainEqual({ binding, reason: 'disconnect' });
});
```

`disconnect` accepts the P1 discriminated-union request, never a raw token. Extend the fixture with a `revoke` spy for this test.

- [ ] **2. Run red.** `npm test -- test/plugins/google-calendar/connection.spec.ts -t "local disconnect fences first and never revokes the Google project grant"` — expect absent disconnect behavior.
- [ ] **3. Implement lifecycle methods with fail-closed ordering.** Export `settings(request, signal): Promise<CalendarPublicStatus>`, `disconnect(request, signal): Promise<CalendarDisconnectResponse>`, and idempotent `close(): Promise<void>`. Parse with the frozen schemas. Use a bounded single-mutator admission flag (reject a competing setup mutation with a safe conflict), not an unbounded lock queue. Disconnect/disable/close advance a local lifecycle epoch and fence dispatch/refresh/pending OAuth **synchronously before the first await**, even if storage later fails. A successful re-enable must not un-fence an unresolved uncertain transition.

Settings persist the record's enabled flag and advance store revision and connection revision for an actual enablement change; preserve token ciphertext/version because no credential changed. Same-value settings are idempotent. If there is no grant, enabling returns setup-required without fabricating a connection; disabling clears pending setup and returns disabled. Missing policy/config cannot become connected merely by enabling. After disable/re-enable an old binding remains invalid. If server target config differs from the stored record, require reconnect; do not rewrite that record's target around existing credentials/work.

For disconnect, snapshot only the minimum volatile token needed for **explicit** revoke, then CAS one valid disconnected record: disabled, connection revision advanced, credential version advanced if credentials changed, null credentials/expiry. Keep existing subject/target metadata only as permitted connection metadata, never a usable grant. Accept exact confirmed result only. On CAS conflict reread and attempt local clearing at most once more; on uncertain or a second conflict leave the in-process fence and return safe 503, not `disconnected: true`. Never call remote revoke until local disconnection is confirmed.

After confirmed local disconnect, clear all service-held references, invalidate pending OAuth/refresh publications, and call `onInvalidated(oldBinding, 'disconnect')`. For replacement use `reason: 'replacement'`; disable uses `'disabled'`, unusable grant uses `'reconnect-required'`. This callback is the explicit P6/P8 handoff to stop paused work and schedule owner-fenced source-linked removal. It carries no secrets and does not delete events or invent a retention policy. Cleanup failure leaves the local fence/degraded state and is reported safely; credentials are not restored. P8 must supply this callback in production, not silently omit removal behavior. P3 itself does not enumerate/delete messages or own sweeps.

For `{ mode: 'revoke-google-grant', acknowledgeProjectWideRevocation: true }`, the UI's separate action must explain the broader Google project-grant implications. Preserve a necessary token in this request's volatile closure only, send one form-body revoke after local fencing/clearing, and destroy the reference in `finally` regardless of remote outcome. No ordinary credential survives for a future retry. If no token exists, return `remoteRevocation: 'unknown'`; if Google explicitly rejects return failed; a lost response/deadline returns unknown; a confirmed response returns confirmed. Local mode always returns not-requested. A second revoke with already-destroyed tokens must not promise retry. Direct the operator to Google's grant controls when remote revocation is unconfirmed. Disconnect never deletes/rolls back an event or guarantees cancellation of a dispatched write.

`close` fences immediately, invalidates pending setup and refresh publication, aborts P3-owned network work, removes volatile references, and performs no persistence-close or revoke. Expose completion for P8 drain; do not hook a second process shutdown owner.

- [ ] **4. Run green and lifecycle race matrix.** Repeat focused command; run `npm test -- test/plugins/google-calendar/connection.spec.ts test/plugins/google-calendar/connection-refresh.spec.ts test/plugins/google-calendar/oauth.spec.ts`. Cover enable/disable/re-enable, restart defaults, reconnect same/different subject/target, local idempotent disconnect, explicit revoke without acknowledgment rejected before any mutation, revoke confirmed/failed/lost/hanging/no-token, local clear conflict/uncertain, removal-notification failure, concurrent refresh/install/disconnect, pending OAuth after disconnect, aborted setup, and close. Assert zero automatic revocations on failed scope/target/identity/setup/local disconnect and zero event deletion requests.
- [ ] **5. Commit named changed P3 files.** Message: `feat(google-calendar): fence disconnect and separate explicit Google grant revocation`.

## Task 8: Guarded setup HTTP and independent module fixture

**Files:** Create `backend/src/plugins/google-calendar/controller-http.ts`, `controller.ts`, `module.ts`, and `backend/test/plugins/google-calendar/setup.spec.ts`.

- [ ] **1. Write the failing module/hostile-Origin test.** Use `Test.createTestingModule({ imports: [GoogleCalendarModule.register({ connections, oauth })] })`, `createNestApplication({ bodyParser: false, logger: false })`, global prefix `api`, and the real `configureGoogleCalendarHttp(app, boundary)` **before** any generic parser. Use Supertest and explicit Host/Origin/header fixtures. Close only the Nest app/P3 services, never any application persistence.

```typescript
it('setup module rejects hostile origins before OAuth state or provider work', async () => {
  const f = await setupFixture();
  try {
    await request(f.app.getHttpServer())
      .post('/api/plugins/google-calendar/oauth/start')
      .set('Host', '127.0.0.1:3000').set('Origin', 'https://evil.example')
      .set('X-Aurvin-Calendar-CSRF', '1').send({}).expect(403);
    expect(f.putState).not.toHaveBeenCalled();
    expect(f.network).not.toHaveBeenCalled();
    const status = await request(f.app.getHttpServer())
      .get('/api/plugins/google-calendar/status').set('Host', '127.0.0.1:3000').expect(200);
    expect(calendarStatusResponseSchema.parse(status.body).state).toBe('disabled');
    expect(status.headers['cache-control']).toBe('no-store');
  } finally { await f.app.close(); }
});
```

`setupFixture()` lives in this test file and composes the real P3 module with the existing deterministic fixture services; expose spies from the store/client, not a mocked controller.

- [ ] **2. Run red.** `npm test -- test/plugins/google-calendar/setup.spec.ts -t "setup module rejects hostile origins before OAuth state or provider work"` — expect missing module/HTTP installer.
- [ ] **3. Implement the plugin-local boundary, thin controller, and registration.** Export:

```typescript
export type CalendarHttpBoundary = Readonly<{
  frontendOrigin: string; backendOrigin: string; redirectUri: string; now?: () => number;
}>;
export type GoogleCalendarModuleOptions = {
  connections: GoogleCalendarConnections; oauth: GoogleCalendarOAuthService;
};
```

`configureGoogleCalendarHttp(app, boundary)` applies **only** under `/api/plugins/google-calendar` including malformed subpaths so they cannot fall into weaker generic handlers. Reject remote socket peers (allow exactly `127.0.0.1`, `::1`, IPv4-mapped `::ffff:127.0.0.1`), missing/duplicate/malformed Host, authority/port mismatch, remote frontend config and URL credentials. Use `req.rawHeaders` to detect duplicates that Node might otherwise combine. Never trust `req.hostname` or forwarded headers for admission. Read-only status permits absent Origin only when `Sec-Fetch-Site` is not cross-site; any present Origin must equal the configured frontend origin.

Every mutation requires a single exact Origin and the exact custom CSRF marker, JSON media type (optional UTF-8 charset only), identity content encoding, and no query. Reject absent/null/list/foreign Origin, missing/duplicate/wrong marker, wrong methods, form bodies, compressed bodies, nonobject/array/null, unknown fields and identity/token/target override fields. Use P1 request schemas in the controller. An empty **object** is required for OAuth start; do not reuse the admin collector's nonempty-object restriction.

Collect plugin JSON before shared parsers with a 16 KiB encoded-body cap and 5-second body deadline. Reject oversize at content-length admission and during chunked reads, malformed length/UTF-8/JSON, duplicate keys (reuse `scanJsonObject` read-only), and clean listeners/timer on success, abort, and error. A request whose `body` was already parsed is a configuration-order failure, not permission to skip collection/limits. Treat callback as bodyless GET with raw query parsing by OAuth service; exact configured ingress Host/peer checks still apply, but absent Origin and cross-site navigation are allowed **only here**. Supplied foreign Origin still fails. No mutation-by-GET route is added.

Bound setup traffic with one process-local 60-request/60-second window, and at most one code-exchange callback in flight. Do not reset tool/turn budgets or build per-client/member buckets. OPTIONS may answer only a valid local frontend preflight for one of these routes/methods/header names; echo only the exact configured origin, never wildcard, and include `Vary: Origin`. Callback CORS is not needed. P8 must align global CORS to permit PATCH and this custom header without broadening origins; until that wiring, module fixtures are the evidence, not assembled availability.

Set `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` on every plugin response, remove/suppress ETag, and never echo callback query/cookie. Safe errors use the existing `clientErrorBodySchema`: `INVALID_REQUEST`/400 (or 403 for boundary/CSRF), `INPUT_TOO_LARGE`/413, `RATE_LIMITED`/429, `NOT_READY`/503, `PERSISTENCE_ERROR`/503, `TIMEOUT`/504. Do not extend P1 error enums. Known lifecycle faults map to static messages; unknown exceptions map to static 503 without stack/backend/provider details. Denied boundary callbacks return a safe 400/403, not a redirect that hides the failure.

Controller decorators: `@Controller('plugins/google-calendar')`, `@Get('status')`, `@Patch('settings')`, `@Post('oauth/start')`, `@Get('oauth/callback')`, `@Post('disconnect')`; POST success codes explicitly 200. Parse every response with the frozen schema. Callback builds the frontend URL from configuration, deletes any preexisting query/hash, and appends only `{ plugin: 'google-calendar', oauth: 'connected' | 'fixture' | 'cancelled' | 'failed' }`; successful fixture flow uses `fixture`. Clear the exact correlation cookie for accepted-boundary callback outcomes. No code/state/nonce/account/error-description enters Location or an HTML response.

Register the two existing service instances through a small Nest dynamic/configurable module following `AdminConfigModule`; never instantiate them again in provider factories. Keep the HTTP installer explicit so P8 can put it before chat parsing. Module/controller tests must exercise the actual decorators and schemas, not call controller methods alone.

- [ ] **4. Run green and HTTP matrix.** Repeat focused command, then `npm test -- test/plugins/google-calendar/setup.spec.ts`. Include all five routes, status/settings/start/disconnect success, callback absent-Origin + Lax-cookie acceptance, callback hostile-Origin/Host rejection, rejected cross-site noncallback GET, CSRF absent/duplicate, hostile/missing/null Origin, wrong port, IPv6 exact authority, forwarded-host spoof, duplicate Host, remote peer helper tests, wrong content type/encoding, empty `{}` accepted for start, body cap/cap+1/chunked overflow, duplicate JSON/query/cookie, method/path mismatch, preflight, rate boundary, pre-parsed-body ordering failure, and provider/storage exception secrecy. Test both frontend-proxy callback and same-host direct-backend callback configs; reject hostname mismatch.
- [ ] **5. Commit the four named files.** Message: `feat(google-calendar): expose loopback guarded Calendar setup module`.

## Task 9: Secret assertions, regression checks, and owner handoff

**Files:** Modify only the existing P3 tests above if a missing assertion is found. Do not write central wiring, other plans, or final evidence documents.

- [ ] **1. Add one red comprehensive secret/provenance assertion.** Run a real P3 module fixture through enable/start/callback/status/refresh/local disconnect and a separate explicit revoke fixture, using the scripted Google HTTP/identity/target ports. Trap console methods and inspect emitted public bodies, redirect locations, captured safe errors, invalidation payloads, and any fixture telemetry sink. Authorization URL and HttpOnly cookie are explicit protocol exceptions **only** for state/nonce/challenge/browser correlation; neither may contain the verifier, token, client secret, or grant response.

```typescript
it('fixture flow never claims a real connection or leaks backend secrets', async () => {
  const f = await setupFixture();
  try {
    const output = await f.completeFixtureFlow();
    expect(output.status.state).toBe('degraded');
    expect(new URL(output.location).searchParams.get('oauth')).toBe('fixture');
    const publicText = JSON.stringify({ status: output.status,
      location: output.location, errors: f.publicErrors, logs: f.logs,
      invalidations: f.invalidations });
    for (const secret of ['fixture-client-secret', 'fixture-code', 'fixture-access',
      'fixture-refresh', output.verifier, output.rawState, output.browserCookie]) {
      expect(publicText).not.toContain(secret);
    }
    expect(publicText).not.toContain('encryptedVerifier');
    expect(publicText).not.toContain('credentials');
  } finally { await f.app.close(); }
});
```

`completeFixtureFlow()` in `setup.spec.ts` uses Supertest requests to the real routes with the required Origin/CSRF marker, passes its observed HttpOnly cookie to the simulated callback, and returns `{ status, location, verifier, rawState, browserCookie }` only in test memory. `publicErrors/logs/invalidations` are initialized in the same local fixture. It does not create a real credential or set production evidence provenance. Restore all spies in `afterEach`.

- [ ] **2. Run red, complete the test harness, and run green.** `npm test -- test/plugins/google-calendar/setup.spec.ts -t "fixture flow never claims a real connection or leaks backend secrets"`. Initially expect the missing `completeFixtureFlow` harness to fail, then add the helper using the exact route/body/header protocol from Task 8 and repeat the command. Prove the secret assertion itself with a test-local unsafe string projection and `expect(() => expect(unsafePublicText).not.toContain('fixture-refresh')).toThrow()`; do not inject leakage into production source or retain a deliberately failing test.
- [ ] **3. Run meaningful package verification from `backend/`.** Commands, each reported separately:

```powershell
npm test -- test/plugins/google-calendar/oauth-http.spec.ts test/plugins/google-calendar/oauth-identity.spec.ts test/plugins/google-calendar/oauth.spec.ts test/plugins/google-calendar/connection.spec.ts test/plugins/google-calendar/connection-refresh.spec.ts test/plugins/google-calendar/setup.spec.ts
npm test -- test/persistence/calendar-connections.spec.ts test/persistence/calendar-secret-cipher.spec.ts test/plugins/google-calendar test/plugins/mcp
npm run build
npm run lint
npm test
```

Expected: every new test discovered and passed, existing deterministic suites still pass, build/lint succeed. The named P2 cipher test exists in this checkout; P2 ownership remains unchanged. A failure returns to its owner; do not amend upstream contracts/P5 to make P3 green. Record actual counts, Node version, commands, and any unrelated existing failures in the worker's final report. Do not mistake a no-tests match for evidence.

No live/natively connected OAuth test belongs here. P2's existing isolated-native connection-state/CAS/cipher tests may be run only if operator-supplied `AURVIN_TEST_MONGODB_URI` and exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_` already exist and the fixture creates/drops only generated isolated databases. Do not inspect/print a URI, use app data, invent credentials, or label a skip as a pass. Native absence is **G2/G3 native unrun**. Real browser cross-site cookie behavior remains P7/P9 browser evidence, and real Google S256/scope/owned-target behavior remains **G3 live unrun**; deterministic signed-token/cookie fixtures do not certify them.

- [ ] **4. Verify scope and commit any final P3-only assertion changes.** Use `git diff --check`, `git status --short`, and a named-path diff. Stage exact files, never `git add .`. Message: `test(google-calendar): verify setup secrecy and connection race boundaries`. Omit this commit if no files changed; do not create an empty commit.
- [ ] **5. Publish the final worker handoff without asking the orchestrator to ingest the plan.** Report full hashes/stat summaries and exact checks. Include the handoff below and mark review **skipped**. No source presence or fixture result closes G8/G9.

## P6/P7/P8 implementation handoff

**P6:** Consume one `GoogleCalendarConnections` instance as both `CalendarConnectionGate` and `CalendarCredentialPort`; `currentBinding()` supplies the frozen server snapshot. Every access/refresh rechecks fixed user, subject, connection/target revisions, configured target, enablement, credentials, shutdown and deadline. Pass the durable `consumeRefreshRequest` callback; P3 never owns/replenishes the turn's two-request budget. Credential/revoked/policy/persistence failures are not schema repair. Disconnect/replacement notification does not assert that an already-dispatched write was cancelled or rolled back. Old/unknown operations cannot be retargeted to a new binding.

**P7:** Use the five exact API routes/methods above with schema-strict bodies, same-origin proxy, JSON, `X-Aurvin-Calendar-CSRF: 1` on mutations; no identity/token/calendar inputs. Navigate only to a schema-validated Google authorization URL. Reread status after the fixed callback hint; query-string `oauth=connected` alone is not readiness evidence. `oauth=fixture`/status degraded is explicitly not a real Google connection. Distinguish enable/disable, reconnect, local disconnect, and separately acknowledged project-wide revoke. Preserve local drafts; no browser credential/state persistence or automatic event deletion/replay. Calendar progress/operation events remain the frozen P1 `calendar-progress` and `calendar-operation` schemas, emitted later by P6/P8, **not** invented setup SSE events.

**P8:** Construct P3 services once with P2's existing store/cipher, trusted identity, P5 target verifier, server-only client/target configuration, approved policy admission and `onInvalidated` removal/drain integration. Register the existing instances with `GoogleCalendarModule.register({ connections, oauth })`; install `configureGoogleCalendarHttp` before generic JSON/OPTIONS handling. Align exact loopback Host/ports, frontend/callback cookie hostname, Vite's rewritten Host, and global CORS PATCH/custom-header handling without trusting forwarded host or broadening network scope. Apply the same local anti-CSRF boundary to tool-enabled chat. Compose status/readiness without Google probes; Calendar outages must not take text chat/liveness down. Drain/close P3 without closing persistence twice. Document that raw callback query strings/cookies must not be access-logged; errors/logs use allowlisted static codes only. Supply owner-fenced removal on disconnect/replacement, not an unfenced TTL/deletion or a no-op production callback.

## Exit-gate checklist and evidence classification

- [ ] Replay, missing/mismatched/expired state, wrong browser, duplicate callback inputs, unsafe Origin/Host/CSRF, lost consume ACK, and stale/restarted setup cause zero token exchanges or zero activation as appropriate.
- [ ] PKCE challenge/verifier and OIDC nonce/signature/issuer/audience/subject checks are deterministic and runnable; decoded tokens are never identity proof.
- [ ] Required narrow scopes and exact server-selected target are enforced; no broader scope/calendar picker/default primary is substituted. Actual Google narrow-scope ownership compatibility remains explicitly unrun.
- [ ] One trusted local identity owns the grant; account/target/token/version swaps cannot leak credentials, restore stale grants, or retarget paused work.
- [ ] Concurrent refresh is single-flight, durable rotation precedes use, omitted replacement preserves the refresh token under new AAD, and the shared two-request cap/deadline/cancellation cannot reset.
- [ ] Missing/revoked grants require reconnect; disconnect fences first, clears credentials on confirmed storage, never automatically revokes, and explicit revoke has a separate acknowledgment and safe unknown outcome.
- [ ] Module fixture routes exercise actual Nest HTTP, schemas, headers, JSON collection, callback-cookie exception, and closed errors; no shared bootstrap edits or second owner exist.
- [ ] Fixture status/callback never claim a real Google connection; public responses/logs/errors/invalidation messages contain no tokens, secrets, verifier, raw state, or provider dumps.
- [ ] Actual tests/commits/counts and skips are reported. Native/browser/live/policy gates stay named and open unless separately evidenced. Unified review remains **skipped**.

## Planner-only verification

This plan is a documentation deliverable, not implementation/test evidence. Before the planner commit: resolve the Markdown links, confirm every named existing upstream symbol/path, inspect the ownership map against state, scan for unresolved template markers and the prohibited documentation banner, and run `git diff --check -- docs/google-calendar-plugin/plan3.md`. Do not run application/service checks to certify this document. Commit **only** this file with `docs(google-calendar-plugin): plan P3 - local OAuth and connection lifecycle`; report its full hash and `git log -1 --stat`.
