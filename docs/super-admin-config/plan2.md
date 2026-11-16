Build P2's encrypted configuration repository and independently composable admin API. MongoDB remains the only manageable-setting authority; provider keys are write-only. Validate a replacement with one non-billable, bounded provider request, persist a whole-document revision CAS, and publish only a confirmed, admissible revision. Removal and ordinary settings saves are separate operations.

Reuse P1's strict schemas, bootstrap validation, defaults, public projection, repository/activation ports, the existing MongoDB connection and executor, and Node cryptography/fetch. Stack: existing NestJS 12/Express adapter, MongoDB driver 6, Zod 3, Vitest/Supertest, Node 22/24-compatible standard-library APIs. No dependency or manifest changes. Research and unified review are **skipped**; targeted documentation checks, TDD, defect correction, and final verification remain required. This document is a plan, not implementation/test evidence. Actual source files retain AGENTS.md headers; examples here deliberately omit boilerplate.

## Preconditions and decisions needing orchestration

- Read [goal.md](goal.md), [state.md](state.md), and current P1 source before execution. P1 implementation range is `5dc8df0..48126e2`. Do not edit contracts, platform configuration, chat/model/context, voice, frontend, central assembly, scripts, operations, or P7 integration fixtures.
- **Blocking ownership gap:** `backend/src/persistence/mutation-journal.ts:73` hardcodes six admitted collections, excluding `config`, although P1 `COLLECTIONS.config` exists. `guardedClient(...).db(...).collection('config')` currently throws. This file is outside P2 ownership. Orchestrator must explicitly assign a small separate prerequisite patch (prefer the existing allowlist consuming `Object.values(COLLECTIONS)`) and its journal regression to an authorized owner, or expand P2 ownership before its worker touches it. This plan does not authorize that edit. P2 can build/test its owned code with deterministic stores, but its local guarded-bundle gate cannot pass before the prerequisite lands. Do not obtain a raw client, move config into metadata, disable local recovery, or label the unsupported path complete.
- **P1 drift policy:** stop affected work and report changed signatures/schema fields to the orchestrator/P1; never silently fork the contracts. P1 `storedConfigDocumentSchema` includes `_id`, whereas `RecordStore.read/decode` removes `_id`; P2 therefore uses the existing admitted `store.db.collection<StoredConfigDocument>('config')`, `store.options()`, and `assertBytes`, not that incompatible generic codec. This is an adapter difference, not permission to change P1/store codecs.
- **P6 integration obligations:** register exactly one P2 service using the admitted bundle, install its early HTTP guard/parser before existing global chat parsing/control middleware, resolve the actor on the server, provide a trusted-HTTPS-ingress predicate, and implement P1 `prepare/publish/current` without rebuilding owners. P2's standalone API tests compose these dependencies with fixtures; they do not prove central wiring.
- Deepgram's primary documentation publishes the `/v1/auth/token` test and regional base replacement, but not a field-by-field token-check response schema; regional feature lists also do not explicitly list the auth endpoint. Do not invent `api_key_id`/`project_id` requirements from project-management APIs. The planned strict success predicate below checks documented HTTP/JSON semantics without making identifier claims; regional auth availability remains an operator/service compatibility limitation, with no cross-region fallback. If the worker finds contradictory primary documentation, report the decision needed instead of substituting a paid/project-admin endpoint.
- A CAS document is bounded by `min(MAX_CONFIG_DOCUMENT_BYTES, bootstrap.safety.maxDocumentBytes)` including BSON headroom; no additional embedded history or duplicate keys. Native replica-set/single-process admission remains unchanged. Never execute import/migration, provision, deploy, or make agent-run live/paid checks.

## Exact files and handoff interfaces

Create:

| Path | Responsibility |
| --- | --- |
| `backend/src/persistence/config.ts` | `MongoConfigRepository`: one document, ownership fencing, bounds, atomic CAS and uncertainty classification. |
| `backend/src/persistence/config.spec.ts` | Offline driver/ownership/result fault tests; no native fixture changes. |
| `backend/src/admin-config/credential-service.ts` | Only backend credential-decryption owner; AES-GCM sealing/opening and injected validation. |
| `backend/src/admin-config/credential-service.spec.ts` | Round-trip, fresh nonce, AAD/tamper/key/bounds and redaction tests. |
| `backend/src/admin-config/credential-validation.ts` | Fixed HTTPS destinations, streaming byte/time bounds, safe success/error predicates. |
| `backend/src/admin-config/credential-validation.spec.ts` | All provider checks use injected fake fetch and streams. |
| `backend/src/admin-config/admin-config.service.ts` | Redacted reads, nonsecret save, replace/remove, bounded serialization and prepare/CAS/publish sequencing. |
| `backend/src/admin-config/admin-config.service.spec.ts` | Independent-scope mutations, preservation, conflicts, uncertain/blocked activation. |
| `backend/src/admin-config/errors.ts` | Closed admin error type, allowlisted field errors/status mapping; never raw exception serialization. |
| `backend/src/admin-config/configure-admin-http.ts` | Route-scoped early cache/origin/TLS/body/rate guard and bounded JSON collection. |
| `backend/src/admin-config/admin-config.controller.ts` | GET/PUT config and POST credential operation, thin strict routing, safe filter. |
| `backend/src/admin-config/admin-config.module.ts` | Configurable module receiving the already-created service; never creates persistence/runtime. |
| `backend/src/admin-config/index.ts` | P6 public exports only. |
| `backend/test/admin-config/fixtures.ts` | Small dedicated offline service/driver/API test factories. |
| `backend/test/admin-config/admin-config-api.spec.ts` | Real local Nest/Supertest API security tests; no P7 integration ownership. |

Modify only `backend/src/persistence/persistence.ts` (add bundle `config`), `backend/src/persistence/index.ts` (export adapter). `backend/src/persistence/indexes.ts` is owned if needed, but the built-in unique `_id` index covers the stable singleton and CAS; add no redundant index, DDL, collection validator, or new journal API. Existing indexes remain unchanged.

Keep P1 shapes exactly:

```ts
interface ConfigRepository {
  read(): Promise<StoredConfigDocument | null>;
  createIfAbsent(document: StoredConfigDocument): Promise<ConfigCasResult>;
  compareAndSwap(expectedRevision: number, document: StoredConfigDocument): Promise<ConfigCasResult>;
}
// ConfigCasResult: confirmed/document | conflict/currentRevision | uncertain
// Stored: _id:'aurvin', schemaVersion:1, revision>=1, settings,
// credentials:{openrouter: StoredCredential|null, deepgram: StoredCredential|null},
// updatedAt, updatedBy. StoredCredential = {envelope, validatedAt}.
// Envelope = {algorithm:'aes-256-gcm', nonce, tag, ciphertext}, canonical base64.
// ConfigActivationPort.prepare(SnapshotCandidate): Promise<RuntimeConfigSnapshot>
// ConfigActivationPort.publish(RuntimeConfigSnapshot): void
// CurrentConfigPort.current(): RuntimeConfigSnapshot|null
```

P2 adds these backend-only exports, with P1 types imported via `.js` specifiers:

```ts
type AdminHttpOptions = {
  bootstrap: BootstrapConfig;
  actor: () => AdminConfigActor;
  trustedHttpsIngress: (request: Request) => boolean;
  now?: () => number;
};
type AdminConfigOptions = {
  bootstrap: BootstrapConfig;
  repository: ConfigRepository;
  credentials: CredentialService;
  activation: ConfigActivationPort;
  current: CurrentConfigPort;
  assertWritable: () => Promise<void>;
  now?: () => number;
};
// Constructor: new MongoConfigRepository(store, owner, documentByteLimit)
// owner: Pick<MongoOwnership,'assertExecutor'>; no ownership claim inside adapter.
// Constructor: new CredentialValidator(fetchImpl = globalThis.fetch)
// validate(provider,candidate,region): Promise<void>; never returns provider JSON.
// Constructor: new CredentialService(bootstrap.encryption, validator)
// seal(provider,candidate): EncryptedCredentialEnvelope
// decrypt(document): DecryptedCredentials; only this service opens envelopes.
// validate(provider,candidate,region): Promise<void> delegates to validator.
// Constructor: new AdminConfigService(options)
// read(): Promise<PublicAdminConfig>
// saveSettings(raw:unknown,actor:AdminConfigActor): Promise<PublicAdminConfig>
// updateCredential(provider:CredentialProvider,raw:unknown,actor:AdminConfigActor): Promise<PublicAdminConfig>
// configureAdminHttp(app:NestExpressApplication,options:AdminHttpOptions): void
// AdminConfigModule.register({service:AdminConfigService,actor:()=>AdminConfigActor})
```

`assertWritable` is P6's existing executor/journal/drain fence, not a new owner. A single service-wide nonsecret `blocked` flag prevents further publication/mutation after uncertain durability or unexpected publication failure; it never clears journal quarantine. P6 preparation is side-effect-free (no quota reset/admission change), and publication is a synchronous, monotonic, nonthrowing pointer/admission update of a prepared snapshot. Defensive handling still tests an unexpected publication throw.

External API under existing global `/api` prefix:

| Request | Body | Success |
| --- | --- | --- |
| `GET /api/admin/config` | None; no query | 200 `PublicAdminConfig`. Missing store returns defaults, revision 0, no keys, unconfigured. |
| `PUT /api/admin/config` | P1 `SaveSettingsRequest` | 200 same safe projection, committed revision/activation. |
| `POST /api/admin/config/credentials/openrouter` | P1 `CredentialUpdateRequest` | 200 safe projection, no candidate/envelope. |
| `POST /api/admin/config/credentials/deepgram` | Same | Same. Validation uses the persisted settings' region, never unrelated dirty browser edits. |

Removal is `{protocolVersion:1,expectedRevision,action:'remove',confirm:true}`; no DELETE query/key transport. The replacement is `{protocolVersion:1,expectedRevision,action:'replace',candidate}`. No validate-only/reveal/export endpoint. Actor fields never come from body/query/headers. These method choices are a P5/P6 handoff because P1 freezes paths but does not prescribe verbs.

## Documentation compatibility checked during planning

Primary sources checked 13 October 2026 through Context7 and public documentation only; no provider-authenticated calls:

- [OpenRouter key limits](https://openrouter.ai/docs/api/reference/limits): GET `https://openrouter.ai/api/v1/key`, `Authorization: Bearer ...`, 200 object with `data.label`, `data.limit`, `data.usage`, `data.is_free_tier`; labels can contain key fragments and must be discarded. Zero/negative credits do not invalidate recognition.
- [Deepgram authentication](https://developers.deepgram.com/guides/fundamentals/authenticating): GET `https://api.deepgram.com/v1/auth/token`, `Authorization: Token ...`; invalid credentials error versus JSON key details.
- [Deepgram regional endpoints](https://developers.deepgram.com/reference/regional-endpoints): `api.eu.deepgram.com` replaces the default host; existing credentials work; no EU-to-US fallback. No AU/India/custom-host expansion.
- [Node crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html): random IVs, `createCipheriv/createDecipheriv`, `setAAD`, `getAuthTag/setAuthTag`, and verification at `final()`; use 12-byte nonce/16-byte tag explicitly.
- [Nest middleware](https://docs.nestjs.com/middleware), [raw body](https://docs.nestjs.com/faq/raw-body): existing `bodyParser:false` allows early custom parsing; do not turn default parsers on or claim `rawBody:true` works with that setting.
- [MongoDB replace](https://www.mongodb.com/docs/drivers/node/current/crud/update/replace/): single-document filtered replacement and result counters. Use installed driver 6 types, not newer driver-only APIs surfaced by current docs.

## Execution conventions and shared test vocabulary

All `npm` commands below run with working directory `backend/`; Git commands run at repository root. Load TDD/executing-plans for execution, not another planner/researcher/reviewer. Each numbered checkbox is one small action; split parameter matrices into individual failing/pass cycles if needed. Expected RED must be the new behavior/import missing, not unrelated environment/build failure. After GREEN, request an orchestrator commit turn; stage only each task's named files, inspect staged paths, commit with the listed message. Never include another worker's index entries; use `git commit --only -- <named paths>` if sharing an index, after checking those paths. Lock errors get bounded 250/500/1000/2000 ms backoff; never delete locks or reset the index.

In `backend/test/admin-config/fixtures.ts` provide the following deterministic foundations, then extend only for repeated assertions:

```ts
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { defaultManageableSettings, buildRuntimeSnapshot } from '../../src/platform/config/manageable-config.js';
import type { StoredConfigDocument } from '../../src/contracts/admin-config.js';
import type { AdminConfigActor, ConfigCasResult, ConfigRepository, RuntimeConfigSnapshot } from '../../src/contracts/config-runtime.js';
import { CredentialService } from '../../src/admin-config/credential-service.js';
import { CredentialValidator } from '../../src/admin-config/credential-validation.js';
import { AdminConfigService } from '../../src/admin-config/admin-config.service.js';
import { vi } from 'vitest';

export const at = '2026-10-13T12:00:00.000Z';
export const secret = 'fixture-key-never-send-live';
export const bootstrap = loadBootstrapConfig({
  NODE_ENV:'development', FRONTEND_ORIGIN:'http://localhost:5173',
  AURVIN_CONFIG_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),
});
export const actor: AdminConfigActor = {
  identity:{userId:'aurvin-dev-user',openRouterUser:'aurvin-dev-user',source:'server-configured'},
  assumption:{role:'super-admin',authentication:'disabled',source:'server-configured-development'},
};
export function document(revision=1): StoredConfigDocument {
  return {_id:'aurvin',schemaVersion:1,revision,settings:defaultManageableSettings(),
    credentials:{openrouter:null,deepgram:null},updatedAt:at,updatedBy:actor.identity.userId};
}
export function serviceFixture(initial:StoredConfigDocument|null=document()) {
  let stored=initial === null ? null : structuredClone(initial);
  let active:RuntimeConfigSnapshot|null=null;
  const repository:ConfigRepository={
    read:vi.fn(async () => stored === null ? null : structuredClone(stored)),
    createIfAbsent:vi.fn(async next => {
      if (stored) return {outcome:'conflict',currentRevision:stored.revision} as ConfigCasResult;
      stored=structuredClone(next); return {outcome:'confirmed',document:structuredClone(next)};
    }),
    compareAndSwap:vi.fn(async (expected,next) => {
      if (stored?.revision !== expected) return {outcome:'conflict',currentRevision:stored?.revision ?? 0} as ConfigCasResult;
      stored=structuredClone(next); return {outcome:'confirmed',document:structuredClone(next)};
    }),
  };
  const fetchImpl=vi.fn<typeof fetch>(async () => Response.json({data:{label:'discard-me',limit:null,usage:0,is_free_tier:true}}));
  const credentials=new CredentialService(bootstrap.encryption,new CredentialValidator(fetchImpl));
  const activation={
    prepare:vi.fn(async candidate => buildRuntimeSnapshot(bootstrap,candidate,null)),
    publish:vi.fn((snapshot:RuntimeConfigSnapshot) => {active=snapshot;}),
  };
  const assertWritable=vi.fn(async () => undefined);
  const service=new AdminConfigService({bootstrap,repository,credentials,activation,
    current:{current:() => active},assertWritable,now:() => Date.parse(at)});
  return {service,repository,credentials,activation,assertWritable,fetchImpl,
    stored:() => stored,active:() => active};
}
```

Create that shared helper in Task 6 only, once its imports exist. Earlier specs use local document literals/defaults and injected structural doubles, not imports from an unfinished service fixture. For configured text-model tests, set `settings.openRouter.modelId='fixture/model'` and return `buildRuntimeSnapshot(bootstrap,candidate,{modelId:'fixture/model',contextTokens:32768,outputTokens:8192,supportsMaxTokens:true,source:'fixture'})` from `prepare`; all limits remain within defaults. No fixture makes a network request; injected fetch ignores only synthetic credentials. For deferred validation tests use `Promise.withResolvers<Response>()`; attach rejection expectations before rejecting streams or advancing fake timers. Never load private `.env`.

## Task 1 — Safe admin errors and redacted projection boundary

Files: create `backend/src/admin-config/errors.ts`, start `backend/src/admin-config/admin-config.service.spec.ts`. Reuse P1 `projectPublicAdminConfig`, schemas, closed error/field catalogs.

- [ ] Add a failing test asserting `new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE').body()` equals `{protocolVersion:1,error:{code:'CONFIG_STORAGE_UNAVAILABLE',retryable:true,currentRevision:null,fieldErrors:[]}}` and contains no arbitrary message/cause/stack.
- [ ] Run `npm test -- src/admin-config/admin-config.service.spec.ts -t "safe fault"`; expect missing safe-fault implementation (RED).
- [ ] Implement `AdminConfigFault extends Error` with safe code as the message, constructor `(code:AdminConfigErrorCode,currentRevision:number|null=null,fieldErrors:AdminConfigError['error']['fieldErrors']=[])`, `body()` constructing only P1 fields, and `status` from this exact table. Keep at most 20 field errors, only `ADMIN_CONFIG_FIELD_PATHS` and allowed field codes; never use Zod issue messages/input or provider error strings.

```ts
const STATUS: Record<AdminConfigErrorCode,number> = {
  INVALID_CONFIG_REQUEST:400, CONFIG_VALIDATION_FAILED:422, CONFIG_CONFLICT:409,
  CONFIG_STORAGE_UNAVAILABLE:503, CONFIG_WRITE_UNCERTAIN:503, CONFIG_STORED_INVALID:503,
  CONFIG_ENCRYPTION_UNAVAILABLE:503, CONFIG_ACTIVATION_UNAVAILABLE:503,
  CREDENTIAL_REJECTED:422, CREDENTIAL_VALIDATION_TIMEOUT:504,
  CREDENTIAL_PROVIDER_RATE_LIMITED:429, CREDENTIAL_PROVIDER_UNAVAILABLE:502,
  CREDENTIAL_PROVIDER_RESPONSE_INVALID:502, ADMIN_RATE_LIMITED:429,
  INVALID_ADMIN_ORIGIN:403, ADMIN_TRANSPORT_REQUIRED:403,
};
```

`retryable` is true only for storage unavailable, provider timeout/rate/unavailable, admin rate; uncertainty/stored-invalid/encryption/activation/conflict require diagnosis/refresh, not blind automatic retry. Malformed request/body uses 400 (oversize middleware overrides HTTP status to 413 but same closed code). Catch unknown faults into a static category; never preserve `cause`.
- [ ] Rerun focused test; add allowlist/truncation/secret-throw cases and verify GREEN.
- [ ] Commit only those two paths: `feat(admin-config): add closed redacted error boundary`.

## Task 2 — AES-256-GCM credential envelopes

Files: create `backend/src/admin-config/credential-service.ts`, `backend/src/admin-config/credential-service.spec.ts`; use synthetic local constants before the shared fixture can import all modules.

- [ ] Write failing round-trip/AAD/fresh-nonce tests:

```ts
const at='2026-10-13T12:00:00.000Z';
const document=():StoredConfigDocument => ({_id:'aurvin',schemaVersion:1,revision:1,
  settings:defaultManageableSettings(),credentials:{openrouter:null,deepgram:null},
  updatedAt:at,updatedBy:'aurvin-dev-user'});
it('binds credentials and uses a fresh nonce', () => {
  const validator={validate:vi.fn(async () => undefined)};
  const service=new CredentialService({status:'ready',key:Buffer.alloc(32,7)},validator);
  const a=service.seal('openrouter','fixture-secret');
  const b=service.seal('openrouter','fixture-secret');
  expect(a.nonce).not.toBe(b.nonce);
  const stored={...document(),credentials:{openrouter:{envelope:a,validatedAt:at},deepgram:null}};
  expect(service.decrypt(stored)).toEqual({openrouter:'fixture-secret',deepgram:null});
  expect(() => service.decrypt({...stored,credentials:{openrouter:null,deepgram:stored.credentials.openrouter}}))
    .toThrowError(expect.objectContaining({code:'CONFIG_ENCRYPTION_UNAVAILABLE'}));
  expect(JSON.stringify(a)).not.toContain('fixture-secret');
});
```

Import `StoredConfigDocument`, `defaultManageableSettings`, `CredentialService` and Vitest explicitly. Keep these local values until Task 6, then reuse the shared fixture if useful; do not create circular imports.
- [ ] Run `npm test -- src/admin-config/credential-service.spec.ts -t "fresh nonce"`; expect RED.
- [ ] Implement `CredentialService` with `seal`, `decrypt`, and injected `validate`. Accept the structural constructor parameter `{validate(provider:CredentialProvider,candidate:string,region:ManageableSettings['deepgram']['region']):Promise<void>}` so both the offline double and Task 3 validator work without importing a not-yet-created file. Store a copied `KeyObject` made with `createSecretKey` when bootstrap is ready; otherwise secret operations fail with `CONFIG_ENCRYPTION_UNAVAILABLE`. Decrypt a document with both credentials null without requiring a key. Never auto-generate/change a master key or read provider environment variables.

Core sealing logic, inside a catch that replaces exceptions with the static fault:

```ts
const nonce=randomBytes(12);
const aad=Buffer.from(JSON.stringify(['aurvin','config',1,provider]),'utf8');
const cipher=createCipheriv('aes-256-gcm',key,nonce,{authTagLength:16});
cipher.setAAD(aad);
const ciphertext=Buffer.concat([cipher.update(candidate,'utf8'),cipher.final()]);
return {algorithm:'aes-256-gcm',nonce:nonce.toString('base64'),
  tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
```

For opening, strict-parse the complete stored document first, recreate identical AAD, construct `createDecipheriv` with 16-byte `authTagLength`, set AAD and tag before update, concatenate `update` and `final`, and only then UTF-8-decode. No unauthenticated partial plaintext is returned. Check the decrypted candidate with the P1 replacement-request schema so corrupted/invalid candidate forms fail closed. Do not bind AAD to revision: unchanged envelopes survive unrelated settings saves. Credential name/schema/document identity binding is mandatory. Never return the KeyObject/nonce/tag from public methods other than internal `seal`.
- [ ] Run the round-trip test (GREEN).
- [ ] Add separate RED/GREEN cycles for ciphertext/tag/nonce bit flips, wrong master key, provider swap, unsupported stored schema, invalid base64/tag size, missing/invalid master key, 4097 UTF-8-byte/control/whitespace candidate, and random-source failure. Use one byte-flip helper local to the spec, not production crypto helpers. Error JSON/text contains no candidate, envelope, or cryptographic exception. No claims of zeroizing JS strings.
- [ ] Commit exact credential service/spec paths: `feat(admin-config): encrypt write-only credentials with AES-GCM`.

## Task 3 — Non-billable fixed-host credential recognition

Files: create `backend/src/admin-config/credential-validation.ts`, `backend/src/admin-config/credential-validation.spec.ts`; extend credential-service delegation only if required.

- [ ] Add a failing allowlisted-call test with injected `vi.fn<typeof fetch>`:

```ts
it('checks only the OpenRouter key endpoint', async () => {
  const fetchImpl=vi.fn<typeof fetch>(async () => Response.json({
    data:{label:'must-not-leak',limit:null,usage:0,is_free_tier:true},
  }));
  await new CredentialValidator(fetchImpl).validate('openrouter','fixture-key','us');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key',expect.objectContaining({
    method:'GET',redirect:'manual',headers:expect.objectContaining({Authorization:'Bearer fixture-key'}),
  }));
});
```

- [ ] Run `npm test -- src/admin-config/credential-validation.spec.ts -t "only the OpenRouter"`; expect RED.
- [ ] Implement `CredentialValidator` using native fetch, an abort controller with a single 10-second timer covering headers **and all response reading**, `redirect:'manual'`, `cache:'no-store'`, `Accept:application/json`, authorization only in a header. Select destinations solely from provider and enum region:

```ts
const DESTINATIONS={
  openrouter:'https://openrouter.ai/api/v1/key',
  deepgram:{us:'https://api.deepgram.com/v1/auth/token',eu:'https://api.eu.deepgram.com/v1/auth/token'},
} as const;
```

Reject unrecognized provider/region even for backend callers; no user URLs, redirects, query parameters, cross-region fallback, SDK, GET body, retries, text/speech generation, projects list/key-management check, or `/auth/grant`. Validate candidate bounds before header construction using P1 request schema. Also reject non-ASCII header characters safely before fetch rather than exposing fetch header-conversion errors.
- [ ] Run endpoint test (GREEN), then add RED/GREEN Deepgram US and EU tests using `Response.json({details:{recognized:true}})` as an explicitly synthetic key-details fixture, not a claim about actual fields. Assert Token authorization, fixed host/path, one call, discarded return value.
- [ ] Implement the bounded reader: reject `Content-Length` greater than 65536, reject missing/non-JSON Content-Type, non-200 including 204/206, absent body, invalid UTF-8 via `TextDecoder('utf-8',{fatal:true})`, invalid JSON, JSON scalars/arrays/null/empty object. Read with `response.body.getReader()`, sum actual decoded-stream byte lengths before allocating/copying, stop/cancel/abort at byte 65537 even without a trustworthy length header. Always clear the timer and release/cancel the reader safely. Timer expiry aborts fetch/body; no Promise-race that leaves an unbounded body/background task. Bound applies to decompressed response bytes.
- [ ] For OpenRouter require a non-array `data` object with string `label`, finite nonnegative `usage`, `limit` null or finite number, boolean `is_free_tier`; reject top-level `error`. Additional provider fields may exist but are discarded. Do not use label/credits/permissions as persisted metadata or return them. For Deepgram require 200, nonempty JSON object containing key details, with no known top-level error markers `error`, `err_code`, `err_msg`, `category`, `message`; a response containing only `request_id` is not key details. Do not infer project-admin privileges or require an invented identifier shape. Synthetic fixtures test this structural predicate only.
- [ ] Add this failing matrix, run `npm test -- src/admin-config/credential-validation.spec.ts`, implement static mapping, rerun GREEN:

| Fixture | Fault; assertions |
| --- | --- |
| 401/403 | `CREDENTIAL_REJECTED`; body discarded/cancelled, no retry. |
| 429 | `CREDENTIAL_PROVIDER_RATE_LIMITED`; do not echo arbitrary Retry-After/provider text. |
| 500/502/503, 402, unexpected 4xx | `CREDENTIAL_PROVIDER_UNAVAILABLE`; no billing/credit claims. |
| 3xx with malicious Location | `CREDENTIAL_PROVIDER_RESPONSE_INVALID`; no second fetch/authorization forwarding. |
| 200 with `{}`, null, array, error object, missing/wrong OpenRouter fields | `CREDENTIAL_PROVIDER_RESPONSE_INVALID`; no save. |
| invalid JSON/UTF-8, HTML, absent body, over-limit header/chunked body | `CREDENTIAL_PROVIDER_RESPONSE_INVALID`; reader cancelled, old credential unaffected downstream. |
| hanging headers or body until 10000 ms | `CREDENTIAL_VALIDATION_TIMEOUT`; exactly one abort, timer cleared. |
| network/TLS/stream throws containing the candidate | `CREDENTIAL_PROVIDER_UNAVAILABLE`; no cause/message/response logging. |

Timeout test core:

```ts
vi.useFakeTimers();
const fetchImpl=vi.fn<typeof fetch>((_url,init) => new Promise((_resolve,reject) => {
  init?.signal?.addEventListener('abort',() => reject(new DOMException('fixture','AbortError')),{once:true});
}));
const promise=new CredentialValidator(fetchImpl).validate('openrouter','fixture-key','us');
const rejected=expect(promise).rejects.toMatchObject({code:'CREDENTIAL_VALIDATION_TIMEOUT'});
await vi.advanceTimersByTimeAsync(10_000);
await rejected;
expect(fetchImpl).toHaveBeenCalledTimes(1);
vi.useRealTimers();
```

- [ ] Commit only validator/service files actually changed plus specs: `feat(admin-config): bound non-billable provider credential checks`.

## Task 4 — Bounded config repository with ownership and CAS

Files: create `backend/src/persistence/config.ts`, `backend/src/persistence/config.spec.ts`. Do not edit shared store/records/ownership/journal files.

- [ ] Add a fake admitted `Db` collection implementing `findOne`, `updateOne`, `replaceOne` with `vi.fn`; keep stored document in one variable, inspect filter/options, model acknowledged outcomes. Provide `RecordStore(fakeDb,1000)` and `owner={assertExecutor:vi.fn(async()=>undefined)}`. No `MongoClient` is constructed. Write RED tests that missing read is null, a valid document keeps `_id:'aurvin'`, and create/CAS preserve schema/revision.
- [ ] Run `npm test -- src/persistence/config.spec.ts -t "singleton"`; expect missing repository RED.
- [ ] Implement adapter `implements ConfigRepository`; hold `store.db.collection<StoredConfigDocument>(COLLECTIONS.config)` and bounded timeout/majority write options. Read exactly `{_id:APP_CONFIG_ID}` with no list/unbounded cursor, strict-parse and run `assertBytes` (read as well as write), returning detached data. Reject invalid stored schema/oversize with `CONFIG_STORED_INVALID`; driver failures become `CONFIG_STORAGE_UNAVAILABLE` without raw errors.
- [ ] Implement create revision 1 only; CAS requires positive safe expected revision below the exhaustion ceiling and candidate revision `expected+1`, stable `_id/schema`. Validate with `storedConfigDocumentSchema` and `assertBytes` before write. `await owner.assertExecutor()` before dispatch, and again before declaring confirmation/publication; journal failures remain quarantined.

```ts
// createIfAbsent: no insertOne escape; updateOne is already guarded.
const result=await collection.updateOne({_id:APP_CONFIG_ID},{$setOnInsert:document},
  {...store.options(),timeoutMS:store.timeoutMs,upsert:true,writeConcern:{w:'majority',j:true}});
// CAS: whole replacement, not individual mutable credential/settings updates.
const result=await collection.replaceOne({_id:APP_CONFIG_ID,revision:expectedRevision},document,
  {...store.options(),timeoutMS:store.timeoutMs,upsert:false,writeConcern:{w:'majority',j:true}});
```

Do not use `_revision`, `RecordStore.decode`, transactions, `retryWrites`, or read-modify-write without an atomic revision predicate. `_id` already supplies singleton uniqueness. On acknowledged create/upsert or CAS matchedCount=1, confirm the exact candidate and admissible owner; acknowledged no-op/existing create is conflict after bounded read of the current revision. Maximum revision must fail before arithmetic/write.
- [ ] Rerun singleton test (GREEN).
- [ ] Add RED/GREEN races: two create calls get one confirmed/one conflict; same-revision replacement gets one winner; stale request never mutates; existing equal document on repeat create is **conflict**, not an import reset. Wrong `_id`, revision jump, unknown fields, malformed ciphertext and BSON byte overflow never call mutation. Assert size enforcement with two maximum-size envelopes and long keyterms, and just-over-cap fixture; preserve old data.
- [ ] Commit config adapter/spec only: `feat(persistence): add bounded singleton config revision CAS`.

## Task 5 — Unknown-write resolution must respect quarantine

Files: modify `backend/src/persistence/config.ts`, `backend/src/persistence/config.spec.ts`.

- [ ] Add failing tests for write-then-throw and read-back failure with/without an unhealthy owner:

```ts
it('does not confirm a matching reread through journal quarantine', async () => {
  const next=document(2);
  collection.replaceOne.mockRejectedValueOnce(new Error('unknown fixture write'));
  collection.findOne.mockResolvedValueOnce(next);
  owner.assertExecutor.mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('journal quarantined'));
  expect(await repository.compareAndSwap(1,next)).toEqual({outcome:'uncertain'});
  expect(collection.replaceOne).toHaveBeenCalledTimes(1);
});
```

`collection`, `owner`, `repository` come from Task 4's local fake collection fixture. Test a matching reread plus healthy executor separately; it can confirm only when the existing persistence rules permit read-back and journal/ownership remain healthy.
- [ ] Run `npm test -- src/persistence/config.spec.ts -t "journal quarantine"`; RED must demonstrate incorrect confirmation or missing uncertainty handling.
- [ ] Implement one bounded reread after an ambiguous result, compare the **entire parsed candidate** with `isDeepStrictEqual`, and check `owner.assertExecutor()` before any confirmed resolution. No resubmission or encryption retry. Matching document alone never clears mutation intent or authorizes publish. If ownership/intent is unhealthy, result is `uncertain` regardless of matching bytes. An unacknowledged result is ambiguous, not success; exact read-back plus healthy ownership is required.
- [ ] Treat acknowledged zero-match as conflict/currentRevision, but unknown result with missing/same-old/unreadable/invalid/different data conservatively as uncertain; do not report a definitive lost write from absence or an old revision. A safely observed newer revision under healthy ownership can be conflict, never confirmed for this candidate. Database read/ownership failures *before* dispatch throw static unavailable; failures *after* possible dispatch return uncertain. Track that distinction explicitly, not by parsing exception text.
- [ ] Rerun all repository tests (GREEN); add unhealthy-before-write (no dispatch), missing read-back, invalid stored read-back, unacknowledged reply, unknown create, idle-clear-ACK loss, and repeated mutation after uncertainty tests. Spy that no journal reset/stop/sentinel deletion method is called.
- [ ] Commit adapter/spec only: `fix(persistence): preserve config mutation uncertainty and quarantine`.

## Task 6 — Redacted admin reads and ordinary settings save

Files: create `backend/src/admin-config/admin-config.service.ts`, `backend/test/admin-config/fixtures.ts`; extend `backend/src/admin-config/admin-config.service.spec.ts`.

- [ ] Add shared fixtures above. Write this failing test:

```ts
it('saves only settings then publishes confirmed persistence', async () => {
  const f=serviceFixture();
  const settings=defaultManageableSettings(); settings.chat.titleMaxChars=70;
  const result=await f.service.saveSettings({protocolVersion:1,expectedRevision:1,settings},actor);
  expect(result.revision).toBe(2);
  expect(f.stored()?.credentials).toEqual({openrouter:null,deepgram:null});
  expect(f.activation.publish).toHaveBeenCalledTimes(1);
  expect(result).not.toHaveProperty('updatedBy');
  expect(result).not.toHaveProperty('envelope');
});
```

- [ ] Run `npm test -- src/admin-config/admin-config.service.spec.ts -t "saves only settings"`; expect RED.
- [ ] Implement `read` using `repository.read()` and `projectPublicAdminConfig`; no decrypt/provider/candidate lookup is needed for reads. Use current revision only if positive; missing store projects active null and unconfigured. Stored active revision mismatch or service blocked projects `activation:'blocked'`; configured-state derives only from stored credential metadata. A successful published snapshot lacking OpenRouter key/model remains `unconfigured` rather than chat-ready; optional Deepgram absence does not imply chat failure. Invalid stored docs/storage failures return static faults, not fabricated defaults/local substitute.
- [ ] Implement settings request schema parsing with bounded allowlisted field errors; use `validateManageableSettings(raw.settings,bootstrap)` for immutable storage/queue/cross-field ceilings, never duplicate validators. Resolve trusted actor from caller, check development role assumption and actor identifier, stamp `updatedBy=actor.identity.userId`, `updatedAt=new Date(now()).toISOString()`; reject user-supplied actor keys via strict schema.
- [ ] Introduce a service-wide bounded mutation queue of 8 (one in-flight plus seven waiting); reject ninth with `ADMIN_RATE_LIMITED` rather than allocate indefinite closures. Serialize the final reread/prepare/CAS/publish boundary; decrement count and release tail when the actual action settles, not when its response timer expires. Credential network validation runs outside this queue in Task 7. Reuse `backend/src/operations/bounded.ts`'s `boundedResult` to cap the caller's wait at 30 seconds, with an operation-local expired flag checked before prepare, write, and publication. Queue timeout before possible dispatch returns safe unavailable and its queued closure performs no work when reached. Timeout after possible dispatch latches `CONFIG_WRITE_UNCERTAIN`; the eventual result must not publish or release quarantine. Do not claim the underlying work was cancelled. Bound preparation separately to 10 seconds using the same helper; P6 must ensure its side-effect-free catalogue lookup itself aborts within that ceiling. Guarded driver writes keep their existing persistence deadlines and journal behavior, not an invented cancellation guarantee.
- [ ] Implement the whole-document save sequence: assert writable; read and match expected revision (0 means missing); build candidate with only supplied settings and unchanged stored encrypted credentials; decrypt once through credential service; prepare the snapshot before persistence; check deadline/ownership again; create if missing or CAS if stored; only confirmed exact candidate under writable ownership may publish. If preparation fails (catalogue limits, key decryption, settings), never write or publish. Model lookup lives in P6's activation adapter/P3 existing catalogue path, not P2 provider-check code.
- [ ] Rerun focused test (GREEN); write/run separate RED/GREEN tests for missing-store settings save (revision1), safe missing read, existing credential state/redaction, stored schema failure, storage unavailable, bootstrap/master-key invalid reads still safe, rejected unknown fields, storage caps, actor stamp, stale expected revision, failed prepare/no write, queue overflow/deadline, and call-order `prepare -> CAS -> publish`. An unchanged model cannot bypass cross-field validation; changed model must go through prepare before write.
- [ ] Commit service/spec/fixtures exact paths: `feat(admin-config): save redacted settings through prepare CAS publish`.

## Task 7 — Validate and save credentials without unrelated settings edits

Files: modify `backend/src/admin-config/admin-config.service.ts`, its spec, shared fixture only if necessary.

- [ ] Write failing tests for success and rejected candidate preserving old envelope:

```ts
it('validates and saves a key in one scoped operation', async () => {
  const f=serviceFixture();
  const result=await f.service.updateCredential('openrouter',{
    protocolVersion:1,expectedRevision:1,action:'replace',candidate:secret,
  },actor);
  expect(result.revision).toBe(2);
  expect(result.credentials.openrouter).toEqual({configured:true,validatedAt:at});
  expect(f.stored()?.settings).toEqual(document().settings);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(f.credentials.decrypt(f.stored()!).openrouter).toBe(secret);
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});
```

- [ ] Run `npm test -- src/admin-config/admin-config.service.spec.ts -t "one scoped operation"`; expect RED.
- [ ] Implement: strict-parse action/candidate; obtain bounded validation slot (maximum 2 process-wide, no waiting queue) and identity validation window (6 starts per rolling 60 seconds, failed checks count; identity is the single server development identity, not client IP/header). Acquire/check revision and `assertWritable` before sending a candidate, require ready encryption before network call, remember persisted region and base document, invoke `credentials.validate` exactly once, release slot in finally. Request body/candidate stays operation-local; do not place it on service caches/logs/telemetry.
- [ ] On validation success, enter the Task 6 bounded commit queue, reread and compare original expected revision. Any concurrent edit—even unrelated settings/region change—returns conflict and does not encrypt/write/publish the candidate. Encrypt only after that check; replace only the selected credential envelope/validatedAt, preserve other provider envelope and persisted settings, prepare with the candidate decrypted credentials, CAS, publish using the same confirmed-write gate. Validation does not save dirty browser fields, enable voice, select a model, or change rates. `validatedAt` is a recognition timestamp, not proof of credit/model access.
- [ ] Rerun focused test (GREEN).
- [ ] Add RED/GREEN delayed-validation conflict:

```ts
it('rejects a key validated against an older revision', async () => {
  const f=serviceFixture(); const gate=Promise.withResolvers<Response>();
  f.fetchImpl.mockImplementationOnce(() => gate.promise);
  const replacing=f.service.updateCredential('openrouter',{
    protocolVersion:1,expectedRevision:1,action:'replace',candidate:secret,
  },actor);
  await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(1));
  const settings=defaultManageableSettings(); settings.chat.titleMaxChars=65;
  await f.service.saveSettings({protocolVersion:1,expectedRevision:1,settings},actor);
  gate.resolve(Response.json({data:{label:'discard',limit:null,usage:0,is_free_tier:true}}));
  await expect(replacing).rejects.toMatchObject({code:'CONFIG_CONFLICT',currentRevision:2});
  expect(f.stored()?.settings.chat.titleMaxChars).toBe(65);
  expect(f.stored()?.credentials.openrouter).toBeNull();
  expect(f.activation.publish).toHaveBeenCalledTimes(1);
});
```

- [ ] Add individual RED/GREEN old-key preservation cases: invalid/revoked candidate, timeout/429/outage/malformed/oversized reply, encryption failure, prepare failure, CAS conflict, known pre-dispatch storage failure. Initialize previous credential with `seal`, capture stored envelope/current snapshot, then compare exact equality after failure. Every provider fixture from Task 3 exercises the public service at least once through parameterized cases.
- [ ] Add RED/GREEN Deepgram US/EU persisted-region selection, replacing one provider leaves the other unchanged, 2-validation concurrency/third refusal, seventh validation within a minute refused/no fetch, window expiry without quota reset on config edit, stale input refused before network, invalid master key refused before fetch, and finite request lifecycle cleanup. No automatic provider retries, no plaintext/candidate persistence in config's update metadata.
- [ ] Commit service/spec/shared fixture paths actually changed: `feat(admin-config): validate and save credential replacements atomically`.

## Task 8 — Confirmed credential removal and failure-safe publication

Files: modify `backend/src/admin-config/admin-config.service.ts` and spec.

- [ ] Add failing removal test with stored encrypted Deepgram/OpenRouter credentials, `action:'remove',confirm:true`. Expect the selected envelope null, other provider/settings unchanged, no provider fetch, updated revision, and publication of a snapshot with the selected key absent. Missing `confirm`, false confirmation, candidate plus removal, or unknown provider is 400/no write.
- [ ] Run `npm test -- src/admin-config/admin-config.service.spec.ts -t "confirmed removal"`; expect RED.
- [ ] Implement removal through the same prepare/CAS/publish queue, with no candidate validation. Missing-master-key removal of the **last** credential can proceed without decrypting that deleted envelope; remaining undecryptable credentials prevent preparing/activating and return safe encryption unavailable. Do not silently drop the other provider. Removing an already absent key is a confirmed explicit revisioned operation if stored; removal against missing store at expected0 returns the unchanged missing safe projection without creating empty config. No key revocation/billing/cancellation claims. Existing sessions/attempts retain their snapshot; P3/P4 verify their continuation.
- [ ] Rerun removal test (GREEN).
- [ ] Add uncertain/publication sequence test:

```ts
it('never publishes an uncertain write', async () => {
  const f=serviceFixture();
  vi.mocked(f.repository.compareAndSwap).mockResolvedValueOnce({outcome:'uncertain'});
  await expect(f.service.saveSettings({protocolVersion:1,expectedRevision:1,
    settings:defaultManageableSettings()},actor)).rejects.toMatchObject({code:'CONFIG_WRITE_UNCERTAIN'});
  expect(f.activation.publish).not.toHaveBeenCalled();
  await expect(f.service.saveSettings({protocolVersion:1,expectedRevision:1,
    settings:defaultManageableSettings()},actor)).rejects.toMatchObject({code:'CONFIG_WRITE_UNCERTAIN'});
  expect(f.repository.compareAndSwap).toHaveBeenCalledTimes(1);
  expect((await f.service.read()).activation).toBe('blocked');
});
```

- [ ] Implement uncertainty latch, refusal of new mutations/publication, and redacted `blocked` reads. Do not resolve an uncertain repository result with a service-layer bypass/reread, re-encrypt/rewrite, clear journal state, or silently use env keys. If confirmed persistence is followed by a failed writable fence or unexpected publish throw, do not roll back the durable document: latch blocked and return `CONFIG_ACTIVATION_UNAVAILABLE` with confirmed revision. Old active pointer remains but P6's admission fence prevents new work until diagnosis. A failed write never reports a saved/active success; a publication fault distinguishes saved revision from active revision on refresh.
- [ ] Add RED/GREEN tests for owner failure after confirmed CAS, wrong confirmed document returned by repository, unexpected publish throw, active/stored revision mismatch, removal CAS conflict, missing key with remaining undecryptable credential, and read-only diagnostics after storage recovers without unblocking writes. No catch may convert uncertain into success/unconfigured defaults.
- [ ] Commit exact service/spec paths: `feat(admin-config): remove credentials and fail closed on uncertain activation`.

## Task 9 — Early origin, transport, cache, body and rate boundaries

Files: create `backend/src/admin-config/configure-admin-http.ts`, start `backend/test/admin-config/admin-config-api.spec.ts`; extend errors if required. Do not edit `main.ts`, chat parser, platform or operations.

- [ ] Start a local Nest test app with `bodyParser:false,logger:false`, fixture actor/service and stub controller from Task 10. Before controller implementation, use a minimal local test-only controller returning a static safe result so middleware can be independently RED/GREEN. Install only P2 middleware at first. Test no-store on success/error/unknown provider and wrong-origin rejection **before** parsing/validation.
- [ ] Run `npm test -- test/admin-config/admin-config-api.spec.ts -t "rejects origin before body"`; expect missing middleware RED.
- [ ] Implement path matching with normalized trailing slash/case consistent with Express, covering `/api/admin/config` and the full descendants without matching `/api/admin/configuration`. Set `Cache-Control:no-store`, `X-Content-Type-Options:nosniff` before any error. Reject query strings on all admin routes; never log originalUrl/query. Verify supplied Origin equals exact `bootstrap.frontendOrigin`; reject `null`, commas, duplicate origins, alternate ports/suffix attacks. Mutations require exactly one Origin even on localhost; GET without Origin is permitted for same-origin navigation/operator reads, but an explicit mismatching Origin or `Sec-Fetch-Site:cross-site` is rejected. An operator import bypasses HTTP via its service/repository, not missing mutation Origin.
- [ ] Enforce browser transport: permit plain HTTP only when `nodeEnv==='development'`, configured browser Origin host is exactly localhost/127.0.0.1/::1, and request socket peer plus backend Host are loopback. Handle `::ffff:127.0.0.1` as the IPv4-mapped loopback peer, not as a remote address; use exact parsed hostnames, never string-suffix checks. Otherwise require configured HTTPS browser origin and `trustedHttpsIngress(req)===true`; predicate defaults fail-closed. Do not infer trust from arbitrary `X-Forwarded-Proto`, `Host`, or `req.secure` alone. P6 must supply/verify its same-host trusted gateway policy; this does not add authentication or grant external deployment. Tests supply explicit fake trusted-ingress decisions, including rejected forged headers and remote HTTP.
- [ ] Implement per-server-identity HTTP fixed rolling window of 60 requests/60 seconds, bounded by the one current identity; do not create unbounded IP maps or trust client identity. Refuse with `ADMIN_RATE_LIMITED`, `Retry-After:60`, no-store. Credential recognition has the independent stricter 6/minute and 2-concurrency service budgets from Task 7; edits do not reset any counters. Reject unsupported methods except valid CORS OPTIONS; OPTIONS validates origin without requiring JSON/fetch. Do not add throttler/dependency.
- [ ] Implement route-local bounded JSON collection before global parser: require exactly `application/json` with optional UTF-8 charset, reject form/text/multipart and non-identity `Content-Encoding`, bound trustworthy length and **actual streamed bytes** to `MAX_ADMIN_CONFIG_BODY_BYTES=16384`, reject duplicate/malformed length and empty/scalar/array JSON. Use the Node request stream and a 5-second body deadline; remove listeners/timer on completion/abort, never accumulate more than the cap. Do not log malformed parser input/errors. Assign parsed `req.body` and call next only after strict UTF-8 decode and JSON parse. Do not install global `useBodyParser` from this helper or introduce direct Express dependency. For oversized/slow/rejected body respond safely, stop collecting and close the request connection after flushing the response instead of buffering/draining unlimited attacker bytes. GET/OPTIONS do not parse credential bodies.
- [ ] Rerun origin test (GREEN); add RED/GREEN tests for chunked 16385 bytes, oversized escaped/multibyte input, header bound and dishonest length via direct middleware request doubles, malformed JSON/UTF8, compressed/form/text bodies, duplicate/unexpected fields, slow/aborted request, no candidate echo in body errors, rate expiry, no GET provider check, loopback development exception vs remote/test/production HTTP, exact HTTPS predicate, and no ETag/304 cache shortcut.
- [ ] Include a composition regression with existing global JSON parser installed **after** P2 middleware: credential body remains bounded and is not overwritten/reparsed. Hand any required central ordering/operations exclusion changes to P6 rather than editing them. P6 must keep operations control errors from replacing admin error schema and admin availability from depending on chat readiness.
- [ ] Commit exact middleware/API test/errors paths actually changed: `feat(admin-config): guard admin origin transport bodies and request rates`.

## Task 10 — Independent Nest module/controller, strict routes and safe errors

Files: create `backend/src/admin-config/admin-config.controller.ts`, `backend/src/admin-config/admin-config.module.ts`, `backend/src/admin-config/index.ts`; extend API spec.

- [ ] Write failing real HTTP assertions for the four routes and unknown provider, and strict body/no-query behavior:

```ts
const f=serviceFixture();
const moduleRef=await Test.createTestingModule({imports:[
  AdminConfigModule.register({service:f.service,actor:()=>actor}),
]}).compile();
const app=moduleRef.createNestApplication<NestExpressApplication>({bodyParser:false,logger:false});
app.setGlobalPrefix('api');
configureAdminHttp(app,{bootstrap,actor:()=>actor,trustedHttpsIngress:()=>false});
await app.init();
try {
  await request(app.getHttpServer()).post('/api/admin/config/credentials/openrouter')
    .set('Origin',bootstrap.frontendOrigin).set('Host','localhost:3000')
    .send({protocolVersion:1,expectedRevision:1,action:'replace',candidate:secret})
    .expect(200).expect('Cache-Control','no-store')
    .expect(res => {
      expect(isPublicAdminConfig(res.body)).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(secret);
    });
} finally {await app.close();}
```

Import `Test`, `NestExpressApplication`, default Supertest `request`, and P1 guard `isPublicAdminConfig` explicitly. Close app in all tests; no default AppModule/private env/provider bootstrapping.
- [ ] Run `npm test -- test/admin-config/admin-config-api.spec.ts -t "credential API"`; expect RED.
- [ ] Implement thin controller `@Controller('admin/config')`, `@Get`, `@Put`, `@Post('credentials/:provider')` with `@HttpCode(200)` on POST. Before service invocation reject query/provider/request unknown fields using P1 schemas; actor closure is injected from module options. Never call chat's `assertNoClientOverrides` (it rejects legitimate settings model/key editing); strict admin schema is the correct trust boundary.
- [ ] Use existing `ConfigurableModuleBuilder<{service:AdminConfigService,actor:()=>AdminConfigActor}>` pattern from `chat-http.module.ts`, provide the **same** service instance with `useValue/useFactory`, expose only that service, and use a module-local/controller-local exception filter defined beside controller. Filter maps `AdminConfigFault` to its safe body/status and every unknown exception to a static `CONFIG_STORAGE_UNAVAILABLE`; it never logs fault objects/request data. Middleware errors use the same body builder. No global filter/second runtime or new client. Index exports service/module/credential-service/validator/HTTP helper/options/safe fault, not test fixtures or a decrypt endpoint.
- [ ] Rerun API cases (GREEN), then add RED/GREEN GET missing/store/degraded, PUT valid/nonsecret, POST replace/remove, unknown provider, stale revision409, validation422/timeout504/provider429/502, storage503/uncertain503, actor spoof, unknown nested fields, empty/extra queries and raw exception containing candidate tests. Assert all replies satisfy `isPublicAdminConfig` or `isAdminConfigError` and no envelope/nonce/tag/ciphertext/key-prefix/raw-body details ever appear.
- [ ] Add leak-sentinel assertions across JSON responses, captured console stdout/stderr and injected logger spies for success, provider failure, schema failure, storage failure and unexpected exception. Spy on `console.log/error/warn` in tests and restore; production must not call them with secret objects. Store original envelope string separately to prove no envelope accidentally leaks. No persisted audit record carries a candidate/key/provider response; safe operational events, if any, contain only closed code/provider/revision/operation category and server correlation id.
- [ ] Commit exact controller/module/index/API-test paths: `feat(admin-config): expose independent write-only admin configuration API`.

## Task 11 — Add config to the existing admitted bundle

Files: modify `backend/src/persistence/persistence.ts`, `backend/src/persistence/index.ts`; extend `backend/src/persistence/config.spec.ts` and dedicated P2 tests only.

- [ ] Confirm the ownership prerequisite described under Preconditions has an authorized committed patch. Add a failing guarded-bundle test using the same fake-driver approach as existing `backend/test/persistence/mutation-journal.spec.ts` **without editing that file**. Assert guarded collection access succeeds, intent ACK precedes `config` create/CAS data dispatch, idle ACK follows, unknown/idle-ACK loss quarantines, and all old uncovered APIs remain blocked. Before the prerequisite, expect the specific unsupported-collection RED and report it rather than working around it.
- [ ] Run `npm test -- src/persistence/config.spec.ts -t "guarded bundle"`; record prerequisite failure separately if not resolved.
- [ ] Add `config:new MongoConfigRepository(store,owner,Math.min(MAX_CONFIG_DOCUMENT_BYTES,budgets.maxDocumentBytes))` to the existing bundle return and export `MongoConfigRepository` from persistence index. No new `MongoClient`, claim, `close`, `ping`, runtime, reservation authority, or usage accounting owner. Config may be unconfigured independently of checkpointer/chat readiness; P6 owns diagnostic assembly if persistence cannot open.
- [ ] Rerun guarded-bundle suite and existing `npm test -- test/persistence/mutation-journal.spec.ts test/persistence/local-open.spec.ts` (GREEN, actual test discovery required). Confirm old collection/checkpointer setup tests still pass; no gratuitous indexes or collection DDL added. If the separately assigned prerequisite owns its test, consume its result but keep P2's config-specific regression.
- [ ] Commit named bundle/export/config-spec paths only: `feat(persistence): expose config through the admitted shared bundle`.

## Task 12 — P2 exit checks and integration handoff

- [ ] Run focused suite: `npm test -- src/persistence/config.spec.ts src/admin-config/credential-service.spec.ts src/admin-config/credential-validation.spec.ts src/admin-config/admin-config.service.spec.ts test/admin-config/admin-config-api.spec.ts`. Expect nonzero discovered tests and zero failures; record count/result, not just exit code.
- [ ] Run `npm run build`; expect installed package TypeScript/Nest build GREEN. Fix P2-owned type/API drift via new regression; report upstream drift to its owner.
- [ ] Run `npm run lint`; expect zero errors. Do not change manifests, unrelated files, or rewrite siblings to clear unrelated failures; report them with exact commands.
- [ ] Run `npm test` and `npm run test:e2e`; expect routine regression passes, e2e/native skips enumerated explicitly. No DB fixture provisioning or native execution unless isolated operator prerequisites and authorization exist. P7 owns native config/import/restart evidence; a skip/empty suite cannot satisfy it. Do not run `test:azure`, paid/live checks, or import.
- [ ] Run `git diff --check`, inspect only P2 diffs and tracked path list for secrets/unrelated changes. Any test-originated source correction leaves an exact runnable regression. Request final commit turn for remaining **named** P2 files, with message `test(admin-config): lock encrypted configuration security and failure gates` only if there are actual remaining test/source changes.
- [ ] Return the implementation commit list, interface summary above, executed checks/counts, explicit skips, ownership prerequisite status, and P6/P7 integration requirements. Do not update `state.md`, claim AC1–AC8 all complete, create review evidence, or run central import. Research/review stay skipped.

## Exit-gate mapping

| P2 gate / goal acceptance | Required P2 tasks and concrete evidence | Downstream evidence still needed |
| --- | --- | --- |
| One bounded singleton; admitted durable write | 4/5/11: `_id`/revision/BSON ceilings, create/no-overwrite, whole-document CAS, owner/journal fencing and uncertainty. | P7 isolated native config/restart/import; actual service compatibility. |
| AC3 encrypted/write-only/no leakage | 1/2/6/10: fresh nonce, round-trip, wrong AAD/key/tamper failures, strict secret-free projection/error/log assertions. | P5 fixed dots/no reveal/browser storage; P7 native at-rest evidence. |
| AC4 validate then automatic save | 3/7: fixed non-billable endpoints, once-only fetch, bounded headers/body/deadline, malformed/429/outage rejection, success encrypted save and preparation/publication. | P5 one-click scope/clearing; P7 integrated UI/provider fixtures, authorized operator recognition checks if separately requested. |
| AC6 conflict/removal/preservation | 4/6/7/8: delayed validation conflicts, other credential/settings unchanged, confirmed removal, uncertain/no publish, master-key/storage/prepare failures. | P3/P4 active snapshot behavior; P6 shared activation fences. |
| AC5 available for new work only after save | 6/8/10: prepare before write, exact confirmed CAS before publish, positive current revision and blocked diagnostics. | P6 immediate text/voice activation/single owners; P3/P4 original active retry/reconnect snapshots and usage preservation. |
| AC7 import reuse | 2/3/4/11: reusable credential validator/sealer/repository create-if-absent via same bundle, no secret output or implicit env source. | P6 explicit script/ownership/shutdown/operator docs; no migration execution in this approval. |
| AC8 HTTP/security/regressions | 9/10/12: real local API tests for origins/JSON/bounds/HTTPS predicate/cache/rates, build/lint/routine/e2e with discovery and skips. | P6 ingress/CORS/order/readiness wiring, P7 admitted native/browser/integration; no public/Azure/live-provider certification. |

P2 completion is blocked if the authorized `config` journal-allowlist prerequisite is absent or any owned gate fails. Fixture-only Deepgram token-detail validation does not certify a detailed undocumented schema, EU auth availability, paid model/speech access, account credits, gateway TLS, or production readiness. No scope is silently narrowed to make a green report.
