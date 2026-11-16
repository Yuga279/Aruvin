# P1 Shared Contracts, Configuration, and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship versioned, compile-checked Aurvin contracts, a server-side identity resolver, validated environment configuration, finite default budgets, pinned compatible dependencies, and placeholder verification scripts so P2/P3/P4/P7 can implement against stable types without Azure certification.

**Architecture:** Keep persistence, context, model, runtime, HTTP, and UI behind TypeScript/Zod contracts in `backend/src/contracts`. Implement only platform primitives in `backend/src/platform` (config, identity, errors, redaction, payload hashing, Nest `PlatformModule`). Mirror the client-safe HTTP/stream protocol in `frontend/src/api/protocol.ts`. Do not wire `main.ts`, `app.module.ts`, `App.tsx`, or `main.tsx`. Stay service-agnostic: persistence profile enum plus conservative sub-2 MB headroom until P2 certifies a service.

**Tech Stack:** NestJS 12 ESM (`nodenext`, `.js` import specifiers), React/Vite TypeScript, Vitest 4, Zod `^3.25.32`, pinned `@langchain/langgraph@^1.4.19`, `@langchain/langgraph-checkpoint-mongodb@^1.4.1`, `@langchain/core@^1.2.16`, `@langchain/openrouter@^0.4.17`, `mongodb@^6.21.0` (not 7.x).

---

## Worker constraints

- Owned paths only: `backend/src/contracts/**`, `backend/src/platform/**`, `frontend/src/api/protocol.ts`, `frontend/src/api/protocol.test.ts`, backend/frontend `package.json` + lockfiles, compiler/test/lint config, `.env.example` templates, root `.gitignore`.
- **Do not edit:** `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/src/app.controller.ts`, `backend/src/app.service.ts`, `frontend/src/App.tsx`, `frontend/src/App.css`, `frontend/src/main.tsx`, `README.md`, `docs/aurvin-phase-1/state.md`, P2–P10 source trees (`backend/src/persistence/**`, `backend/test/compatibility/**`, `backend/src/context/**`, `backend/src/model/**`, `backend/src/http/**`, `frontend/src/features/**`, `frontend/src/api/client.ts`).
- When creating `.ts`/`.tsx` files, add the root `AGENTS.md` file header. This plan omits those headers from code samples by instruction.
- Backend relative imports use `.js` specifiers. Frontend tests import `./protocol.ts`.
- Unified review is skipped; do not claim review passed. Do not report `test:azure` or `test:behavior` as certifying Azure or model behavior.
- Stage named files only. Never `git add .`.
- TDD: failing test → run → minimal implementation → run → commit.

## File structure

| Path | Responsibility |
| --- | --- |
| `backend/src/contracts/versions.ts` | Schema/protocol/graph version constants |
| `backend/src/contracts/collections.ts` | Six collection names |
| `backend/src/contracts/persistence-profile.ts` | Profile enum + conservative document headroom |
| `backend/src/contracts/identifiers.ts` | ID Zod schemas |
| `backend/src/contracts/errors.ts` | Error taxonomy, HTTP map, retry classification |
| `backend/src/contracts/budgets.ts` | Finite default budgets + `usableHistoryTokens` |
| `backend/src/contracts/session.ts` | Bounded session metadata schema |
| `backend/src/contracts/message.ts` | Visible message schema |
| `backend/src/contracts/agent-memory.ts` | Reference-only context manifest schema |
| `backend/src/contracts/attempt.ts` | Attempt lifecycle schema |
| `backend/src/contracts/metadata.ts` | Accounting + future tool-shaped event schemas |
| `backend/src/contracts/context.ts` | Context assembly result types |
| `backend/src/contracts/stream.ts` | Application SSE stream contract |
| `backend/src/contracts/api.ts` | Client-safe HTTP request/response schemas |
| `backend/src/contracts/identity.ts` | `ResolvedIdentity` / resolver interface |
| `backend/src/contracts/repositories.ts` | Persistence/ownership/checkpointer interfaces |
| `backend/src/contracts/runtime.ts` | Model adapter + agent runtime interfaces |
| `backend/src/contracts/index.ts` | Public contract barrel |
| `backend/src/platform/tokens.ts` | Nest injection token |
| `backend/src/platform/errors/app-error.ts` | `AppError` |
| `backend/src/platform/security/redact.ts` | Secret/payload redaction |
| `backend/src/platform/crypto/hash-payload.ts` | SHA-256 payload identity |
| `backend/src/platform/identity/server-identity-resolver.ts` | Hardcoded/server-configured identity |
| `backend/src/platform/config/load-config.ts` | Env parse, budget overlay, readiness issues |
| `backend/src/platform/platform.module.ts` | Exportable Nest module (not wired by P1) |
| `backend/src/platform/index.ts` | Platform barrel |
| `frontend/src/api/protocol.ts` | Client-safe protocol types + SSE parse |
| `backend/vitest.config.ts` | Exclude azure/behavior specs from `npm test` |
| `backend/vitest.config.azure.ts` | `test:azure` placeholder config |
| `backend/vitest.config.behavior.ts` | `test:behavior` placeholder config |
| `frontend/vitest.config.ts` | Frontend unit tests |
| `backend/.env.example` / `frontend/.env.example` | Placeholders, no secrets |
| `backend/package.json` / `frontend/package.json` | Pins, engines, scripts |

## Downstream contracts (locked by this plan)

Use these names exactly.

| Name | Value / shape |
| --- | --- |
| Protocol version | `STREAM_PROTOCOL_VERSION = 1`, `API_PROTOCOL_VERSION = 1` |
| Persistence profiles | `'unknown' \| 'native-mongodb' \| 'cosmos-mongodb-ru' \| 'azure-documentdb'` |
| Document headroom | `1_800_000` bytes for every profile until P2 certifies otherwise |
| Collections | `sessions`, `messages`, `agent-memory`, `metadata`, `checkpoints`, `checkpoint_writes` |
| Identity API | `ServerIdentityResolver.resolve(): ResolvedIdentity` with `userId`, `source: 'server-configured'`, `openRouterUser` (same string). Default user `aurvin-dev-user`. `assertNoClientOverrides(body)` rejects `userId`/`user`/`openRouterUser`/`model`/`modelId`/`apiKey` |
| Budget defaults | See `DEFAULT_BUDGETS` in Task 4; `maxConcurrentAttemptsPerSession = 1`; topology `single-process` only |
| Scripts | backend `test:azure`, backend `test:behavior`, frontend `npm test` |
| P7 fixtures | `SubmitTurnRequest`, `StreamEnvelope`, `AttemptStatus`, `ClientErrorBody`, `API_ROUTES`, `parseSseDataLine` |

---

### Task 1: Pin compatible dependencies and Node engines

**Files:**
- Create: `backend/src/platform/dependency-pins.spec.ts`
- Modify: `backend/package.json`
- Modify: `frontend/package.json`
- Modify: `backend/package-lock.json` (via npm)
- Modify: `frontend/package-lock.json` (via npm)
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing test**

Create `backend/src/platform/dependency-pins.spec.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = join(backendDir, '..');

const backendPkg = JSON.parse(
  readFileSync(join(backendDir, 'package.json'), 'utf8'),
) as {
  dependencies: Record<string, string>;
  engines?: { node?: string };
  scripts: Record<string, string>;
};

const frontendPkg = JSON.parse(
  readFileSync(join(repoRoot, 'frontend/package.json'), 'utf8'),
) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines?: { node?: string };
};

describe('P1 dependency pins', () => {
  it('pins LangGraph, OpenRouter, MongoDB 6.x, and zod on the backend', () => {
    expect(backendPkg.dependencies['@langchain/langgraph']).toBe('^1.4.19');
    expect(backendPkg.dependencies['@langchain/langgraph-checkpoint-mongodb']).toBe(
      '^1.4.1',
    );
    expect(backendPkg.dependencies['@langchain/core']).toBe('^1.2.16');
    expect(backendPkg.dependencies['@langchain/openrouter']).toBe('^0.4.17');
    expect(backendPkg.dependencies['mongodb']).toBe('^6.21.0');
    expect(backendPkg.dependencies['zod']).toBe('^3.25.32');
  });

  it('does not use mongodb 7.x', () => {
    expect(backendPkg.dependencies['mongodb']).toMatch(/^\^6\./);
    expect(backendPkg.dependencies['mongodb']).not.toMatch(/^\^7/);
  });

  it('declares the Nest 12 Node engine floor on both apps', () => {
    expect(backendPkg.engines?.node).toBe(
      '^22.22.3 || ^24.15.0 || >=26.0.0',
    );
    expect(frontendPkg.engines?.node).toBe(
      '^22.22.3 || ^24.15.0 || >=26.0.0',
    );
  });

  it('does not add LangGraph or MongoDB to the frontend', () => {
    const frontendAll = {
      ...frontendPkg.dependencies,
      ...frontendPkg.devDependencies,
    };
    expect(frontendAll['@langchain/langgraph']).toBeUndefined();
    expect(frontendAll['@langchain/openrouter']).toBeUndefined();
    expect(frontendAll['mongodb']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/platform/dependency-pins.spec.ts
```

Working directory: `backend`

Expected: FAIL because `dependencies['@langchain/langgraph']` is undefined and `engines` is missing.

- [ ] **Step 3: Write minimal implementation**

In `backend/package.json`, add `"engines"` next to `"license"` and add the new dependencies (keep existing Nest packages):

```json
  "engines": {
    "node": "^22.22.3 || ^24.15.0 || >=26.0.0"
  },
```

```json
  "dependencies": {
    "@langchain/core": "^1.2.16",
    "@langchain/langgraph": "^1.4.19",
    "@langchain/langgraph-checkpoint-mongodb": "^1.4.1",
    "@langchain/openrouter": "^0.4.17",
    "@nestjs/common": "^12.0.1",
    "@nestjs/core": "^12.0.1",
    "@nestjs/platform-express": "^12.0.1",
    "mongodb": "^6.21.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.25.32"
  },
```

In `frontend/package.json`, add the same `engines` object after `"type": "module"`.

Replace `.gitignore` with:

```
# Dependencies
node_modules/

# Build output
dist/
dist-ssr/
build/
*.tsbuildinfo

# Environment
.env
.env.*
!.env.example
!**/.env.example

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Test / coverage
coverage/
test-results/

# Vite
.vite/

# Editor
.idea/
.vscode/*
!.vscode/extensions.json
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# OS
.DS_Store
Thumbs.db
Desktop.ini
```

Then install from `backend`:

```bash
npm install
```

From `frontend`:

```bash
npm install
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/platform/dependency-pins.spec.ts
```

Working directory: `backend`

Expected: PASS (4 tests).

Also run `npm run build` in `backend`. Expected: existing scaffold still compiles with `skipLibCheck`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/platform/dependency-pins.spec.ts backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json .gitignore
git commit -m "chore(p1): pin langchain, mongodb 6.x, zod, and node engines"
```

---

### Task 2: Versions, collections, and persistence profile

**Files:**
- Create: `backend/src/contracts/versions.ts`
- Create: `backend/src/contracts/collections.ts`
- Create: `backend/src/contracts/persistence-profile.ts`
- Create: `backend/src/contracts/persistence-profile.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/contracts/persistence-profile.spec.ts`:

```typescript
import { COLLECTIONS } from './collections.js';
import {
  CONSERVATIVE_DOCUMENT_HEADROOM_BYTES,
  CONSERVATIVE_DOCUMENT_LIMIT_BYTES,
  documentHeadroomBytes,
  persistenceProfileSchema,
} from './persistence-profile.js';
import { CONTRACT_VERSIONS } from './versions.js';

describe('persistence profile and versions', () => {
  it('accepts the four service-agnostic profiles', () => {
    expect(persistenceProfileSchema.parse('unknown')).toBe('unknown');
    expect(persistenceProfileSchema.parse('native-mongodb')).toBe(
      'native-mongodb',
    );
    expect(persistenceProfileSchema.parse('cosmos-mongodb-ru')).toBe(
      'cosmos-mongodb-ru',
    );
    expect(persistenceProfileSchema.parse('azure-documentdb')).toBe(
      'azure-documentdb',
    );
  });

  it('rejects unknown profile names', () => {
    expect(() => persistenceProfileSchema.parse('cosmos')).toThrow();
  });

  it('keeps document headroom under 2 MB for every profile until a service is certified', () => {
    expect(CONSERVATIVE_DOCUMENT_LIMIT_BYTES).toBe(2_000_000);
    expect(CONSERVATIVE_DOCUMENT_HEADROOM_BYTES).toBe(1_800_000);
    for (const profile of [
      'unknown',
      'native-mongodb',
      'cosmos-mongodb-ru',
      'azure-documentdb',
    ] as const) {
      expect(documentHeadroomBytes(profile)).toBe(1_800_000);
      expect(documentHeadroomBytes(profile)).toBeLessThan(
        CONSERVATIVE_DOCUMENT_LIMIT_BYTES,
      );
    }
  });

  it('names the six collections including hyphenated agent-memory', () => {
    expect(COLLECTIONS).toEqual({
      sessions: 'sessions',
      messages: 'messages',
      agentMemory: 'agent-memory',
      metadata: 'metadata',
      checkpoints: 'checkpoints',
      checkpointWrites: 'checkpoint_writes',
    });
  });

  it('starts all app schemas at version 1', () => {
    expect(CONTRACT_VERSIONS).toEqual({
      api: 1,
      stream: 1,
      session: 1,
      message: 1,
      agentMemory: 1,
      attempt: 1,
      metadata: 1,
      graphSchema: 'phase1.v1',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/contracts/persistence-profile.spec.ts
```

Working directory: `backend`

Expected: FAIL with cannot find module `./persistence-profile.js` (or `./collections.js` / `./versions.js`).

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/contracts/versions.ts`:

```typescript
import { z } from 'zod';

export const CONTRACT_VERSIONS = {
  api: 1,
  stream: 1,
  session: 1,
  message: 1,
  agentMemory: 1,
  attempt: 1,
  metadata: 1,
  graphSchema: 'phase1.v1',
} as const;

export const schemaVersionSchema = z.literal(1);
```

Create `backend/src/contracts/collections.ts`:

```typescript
export const COLLECTIONS = {
  sessions: 'sessions',
  messages: 'messages',
  agentMemory: 'agent-memory',
  metadata: 'metadata',
  checkpoints: 'checkpoints',
  checkpointWrites: 'checkpoint_writes',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
```

Create `backend/src/contracts/persistence-profile.ts`:

```typescript
import { z } from 'zod';

export const PERSISTENCE_PROFILES = [
  'unknown',
  'native-mongodb',
  'cosmos-mongodb-ru',
  'azure-documentdb',
] as const;

export const persistenceProfileSchema = z.enum(PERSISTENCE_PROFILES);
export type PersistenceProfile = z.infer<typeof persistenceProfileSchema>;

export const CONSERVATIVE_DOCUMENT_LIMIT_BYTES = 2_000_000;
export const CONSERVATIVE_DOCUMENT_HEADROOM_BYTES = 1_800_000;

export function documentHeadroomBytes(
  _profile: PersistenceProfile,
): number {
  return CONSERVATIVE_DOCUMENT_HEADROOM_BYTES;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/contracts/persistence-profile.spec.ts
```

Working directory: `backend`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/contracts/versions.ts backend/src/contracts/collections.ts backend/src/contracts/persistence-profile.ts backend/src/contracts/persistence-profile.spec.ts
git commit -m "feat(p1): add persistence profile, collections, and contract versions"
```

---

### Task 3: Identifiers and error taxonomy

**Files:**
- Create: `backend/src/contracts/identifiers.ts`
- Create: `backend/src/contracts/errors.ts`
- Create: `backend/src/contracts/errors.spec.ts`
- Create: `backend/src/platform/errors/app-error.ts`
- Create: `backend/src/platform/errors/app-error.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/contracts/errors.spec.ts`:

```typescript
import {
  APP_ERROR_CODES,
  ERROR_HTTP_STATUS,
  NEVER_RETRY_CODES,
  RETRYABLE_CODES,
  appErrorCodeSchema,
  isNeverRetry,
  isRetryable,
} from './errors.js';
import { idSchema } from './identifiers.js';

describe('identifiers', () => {
  it('accepts bounded non-empty ids', () => {
    expect(idSchema.parse('aurvin-dev-user')).toBe('aurvin-dev-user');
    expect(idSchema.parse('sess_01')).toBe('sess_01');
  });

  it('rejects empty or oversized ids', () => {
    expect(() => idSchema.parse('')).toThrow();
    expect(() => idSchema.parse('x'.repeat(129))).toThrow();
  });
});

describe('error taxonomy', () => {
  it('classifies identity and model overrides as non-retryable 400s', () => {
    expect(ERROR_HTTP_STATUS.IDENTITY_OVERRIDE_REJECTED).toBe(400);
    expect(ERROR_HTTP_STATUS.MODEL_OVERRIDE_REJECTED).toBe(400);
    expect(isNeverRetry('IDENTITY_OVERRIDE_REJECTED')).toBe(true);
    expect(isRetryable('IDENTITY_OVERRIDE_REJECTED')).toBe(false);
  });

  it('does not blindly retry invalid input, credits, or configuration', () => {
    for (const code of [
      'INVALID_REQUEST',
      'UNKNOWN_FIELD',
      'INPUT_TOO_LARGE',
      'CONTEXT_BUDGET_EXCEEDED',
      'PROVIDER_AUTH',
      'PROVIDER_CREDITS',
      'CONFIGURATION_ERROR',
    ] as const) {
      expect(NEVER_RETRY_CODES.has(code)).toBe(true);
      expect(isRetryable(code)).toBe(false);
    }
  });

  it('marks provider timeouts as retryable and conflict as not', () => {
    expect(RETRYABLE_CODES.has('TIMEOUT')).toBe(true);
    expect(isRetryable('CONFLICT_ACTIVE_TURN')).toBe(false);
    expect(ERROR_HTTP_STATUS.CONFLICT_ACTIVE_TURN).toBe(409);
    expect(ERROR_HTTP_STATUS.IDEMPOTENCY_PAYLOAD_MISMATCH).toBe(409);
  });

  it('lists every code in the HTTP map', () => {
    for (const code of APP_ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code]).toEqual(expect.any(Number));
      expect(appErrorCodeSchema.parse(code)).toBe(code);
    }
  });
});
```

Create `backend/src/platform/errors/app-error.spec.ts`:

```typescript
import { AppError } from './app-error.js';

describe('AppError', () => {
  it('exposes a client body without implementation details', () => {
    const error = new AppError(
      'PERSISTENCE_ERROR',
      'The chat could not be saved. Try again.',
    );
    expect(error.httpStatus).toBe(503);
    expect(error.retryable).toBe(true);
    expect(error.toClientBody()).toEqual({
      code: 'PERSISTENCE_ERROR',
      message: 'The chat could not be saved. Try again.',
      retryable: true,
    });
    expect(JSON.stringify(error.toClientBody())).not.toMatch(/Mongo|Cosmos|stack/i);
  });

  it('keeps identity overrides non-retryable', () => {
    const error = new AppError(
      'IDENTITY_OVERRIDE_REJECTED',
      'Identity cannot be supplied by the client.',
    );
    expect(error.httpStatus).toBe(400);
    expect(error.retryable).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/contracts/errors.spec.ts src/platform/errors/app-error.spec.ts
```

Working directory: `backend`

Expected: FAIL with cannot find module.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/contracts/identifiers.ts`:

```typescript
import { z } from 'zod';

export const ID_MAX_LENGTH = 128;

export const idSchema = z.string().min(1).max(ID_MAX_LENGTH);

export const isoDateSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'expected ISO-8601 datetime',
  });

export const sequenceSchema = z.number().int().nonnegative();
```

Create `backend/src/contracts/errors.ts`:

```typescript
import { z } from 'zod';

export const APP_ERROR_CODES = [
  'INVALID_REQUEST',
  'UNKNOWN_FIELD',
  'IDENTITY_OVERRIDE_REJECTED',
  'MODEL_OVERRIDE_REJECTED',
  'NOT_FOUND',
  'CONFLICT_ACTIVE_TURN',
  'IDEMPOTENCY_PAYLOAD_MISMATCH',
  'CONTEXT_BUDGET_EXCEEDED',
  'INPUT_TOO_LARGE',
  'STORAGE_BUDGET_EXCEEDED',
  'RATE_LIMITED',
  'CONCURRENCY_LIMIT',
  'TIMEOUT',
  'PROVIDER_ERROR',
  'PROVIDER_AUTH',
  'PROVIDER_CREDITS',
  'CANCELLED',
  'INTERRUPTED',
  'PERSISTENCE_ERROR',
  'CONFIGURATION_ERROR',
  'NOT_READY',
  'UNSUPPORTED_TOPOLOGY',
] as const;

export const appErrorCodeSchema = z.enum(APP_ERROR_CODES);
export type AppErrorCode = z.infer<typeof appErrorCodeSchema>;

export const ERROR_HTTP_STATUS: Record<AppErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNKNOWN_FIELD: 400,
  IDENTITY_OVERRIDE_REJECTED: 400,
  MODEL_OVERRIDE_REJECTED: 400,
  NOT_FOUND: 404,
  CONFLICT_ACTIVE_TURN: 409,
  IDEMPOTENCY_PAYLOAD_MISMATCH: 409,
  CONTEXT_BUDGET_EXCEEDED: 413,
  INPUT_TOO_LARGE: 413,
  STORAGE_BUDGET_EXCEEDED: 413,
  RATE_LIMITED: 429,
  CONCURRENCY_LIMIT: 429,
  TIMEOUT: 504,
  PROVIDER_ERROR: 502,
  PROVIDER_AUTH: 502,
  PROVIDER_CREDITS: 402,
  CANCELLED: 409,
  INTERRUPTED: 409,
  PERSISTENCE_ERROR: 503,
  CONFIGURATION_ERROR: 500,
  NOT_READY: 503,
  UNSUPPORTED_TOPOLOGY: 500,
};

export const RETRYABLE_CODES: ReadonlySet<AppErrorCode> = new Set([
  'TIMEOUT',
  'PROVIDER_ERROR',
  'PERSISTENCE_ERROR',
  'RATE_LIMITED',
  'NOT_READY',
]);

export const NEVER_RETRY_CODES: ReadonlySet<AppErrorCode> = new Set([
  'INVALID_REQUEST',
  'UNKNOWN_FIELD',
  'IDENTITY_OVERRIDE_REJECTED',
  'MODEL_OVERRIDE_REJECTED',
  'INPUT_TOO_LARGE',
  'CONTEXT_BUDGET_EXCEEDED',
  'STORAGE_BUDGET_EXCEEDED',
  'PROVIDER_AUTH',
  'PROVIDER_CREDITS',
  'CONFIGURATION_ERROR',
  'UNSUPPORTED_TOPOLOGY',
  'IDEMPOTENCY_PAYLOAD_MISMATCH',
]);

export function isRetryable(code: AppErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}

export function isNeverRetry(code: AppErrorCode): boolean {
  return NEVER_RETRY_CODES.has(code);
}

export const clientErrorBodySchema = z
  .object({
    code: appErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
  })
  .strict();

export type ClientErrorBody = z.infer<typeof clientErrorBodySchema>;
```

Create `backend/src/platform/errors/app-error.ts`:

```typescript
import {
  type AppErrorCode,
  type ClientErrorBody,
  ERROR_HTTP_STATUS,
  isRetryable,
} from '../../contracts/errors.js';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number;

  constructor(code: AppErrorCode, message: string, retryable = isRetryable(code)) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = ERROR_HTTP_STATUS[code];
  }

  toClientBody(): ClientErrorBody {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run src/contracts/errors.spec.ts src/platform/errors/app-error.spec.ts
```

Working directory: `backend`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/contracts/identifiers.ts backend/src/contracts/errors.ts backend/src/contracts/errors.spec.ts backend/src/platform/errors/app-error.ts backend/src/platform/errors/app-error.spec.ts
git commit -m "feat(p1): add identifier schemas and error taxonomy"
```

---

### Task 4: Finite default budgets

**Files:**
- Create: `backend/src/contracts/budgets.ts`
- Create: `backend/src/contracts/budgets.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/contracts/budgets.spec.ts`:

```typescript
import {
  DEFAULT_BUDGETS,
  budgetConfigSchema,
  usableHistoryTokens,
} from './budgets.js';

describe('DEFAULT_BUDGETS', () => {
  it('uses finite positive limits', () => {
    const parsed = budgetConfigSchema.parse(DEFAULT_BUDGETS);
    for (const [key, value] of Object.entries(parsed)) {
      expect(value, key).toBeGreaterThan(0);
      expect(Number.isFinite(value), key).toBe(true);
    }
  });

  it('enforces one active attempt per session', () => {
    expect(DEFAULT_BUDGETS.maxConcurrentAttemptsPerSession).toBe(1);
  });

  it('reserves output tokens plus a model margin so history is not silently dropped', () => {
    const usable = usableHistoryTokens(DEFAULT_BUDGETS);
    expect(usable).toBe(
      DEFAULT_BUDGETS.maxContextTokens -
        DEFAULT_BUDGETS.maxOutputTokens -
        DEFAULT_BUDGETS.modelMarginTokens,
    );
    expect(usable).toBeGreaterThan(0);
  });

  it('keeps storage bounds under conservative document headroom', () => {
    expect(DEFAULT_BUDGETS.maxDocumentBytes).toBe(1_800_000);
    expect(DEFAULT_BUDGETS.maxMessageBytes).toBeLessThan(
      DEFAULT_BUDGETS.maxDocumentBytes,
    );
    expect(DEFAULT_BUDGETS.maxManifestBytes).toBeLessThan(
      DEFAULT_BUDGETS.maxDocumentBytes,
    );
    expect(DEFAULT_BUDGETS.maxPageSize).toBeLessThanOrEqual(50);
  });

  it('rejects a budget that would leave no history capacity', () => {
    expect(() =>
      budgetConfigSchema.parse({
        ...DEFAULT_BUDGETS,
        maxContextTokens: 100,
        maxOutputTokens: 80,
        modelMarginTokens: 40,
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/contracts/budgets.spec.ts
```

Working directory: `backend`

Expected: FAIL with cannot find module `./budgets.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/contracts/budgets.ts`:

```typescript
import { z } from 'zod';
import { CONSERVATIVE_DOCUMENT_HEADROOM_BYTES } from './persistence-profile.js';

export const budgetConfigSchema = z
  .object({
    maxInputChars: z.number().int().positive(),
    maxInputTokens: z.number().int().positive(),
    maxMessagesInContext: z.number().int().positive(),
    maxContextTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    modelMarginTokens: z.number().int().positive(),
    maxMessageBytes: z.number().int().positive(),
    maxDocumentBytes: z.number().int().positive(),
    maxManifestBytes: z.number().int().positive(),
    maxPageSize: z.number().int().positive().max(50),
    defaultPageSize: z.number().int().positive(),
    titleMaxChars: z.number().int().positive(),
    maxConcurrentAttemptsPerSession: z.literal(1),
    maxConcurrentGenerationsPerProcess: z.number().int().positive(),
    maxRequestsPerMinutePerUser: z.number().int().positive(),
    retryMaxAttempts: z.number().int().positive().max(3),
    retryBaseDelayMs: z.number().int().positive(),
    retryMaxDelayMs: z.number().int().positive(),
    connectTimeoutMs: z.number().int().positive(),
    firstOutputTimeoutMs: z.number().int().positive(),
    idleStreamTimeoutMs: z.number().int().positive(),
    totalRunTimeoutMs: z.number().int().positive(),
    persistenceTimeoutMs: z.number().int().positive(),
    shutdownDrainMs: z.number().int().positive(),
  })
  .strict()
  .superRefine((budgets, ctx) => {
    if (budgets.defaultPageSize > budgets.maxPageSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'defaultPageSize cannot exceed maxPageSize',
        path: ['defaultPageSize'],
      });
    }
    if (usableHistoryTokens(budgets) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'maxContextTokens must leave room for maxOutputTokens and modelMarginTokens',
        path: ['maxContextTokens'],
      });
    }
    if (budgets.retryMaxDelayMs < budgets.retryBaseDelayMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'retryMaxDelayMs must be >= retryBaseDelayMs',
        path: ['retryMaxDelayMs'],
      });
    }
  });

export type BudgetConfig = z.infer<typeof budgetConfigSchema>;

export const DEFAULT_BUDGETS: BudgetConfig = {
  maxInputChars: 32_000,
  maxInputTokens: 8_192,
  maxMessagesInContext: 80,
  maxContextTokens: 16_384,
  maxOutputTokens: 2_048,
  modelMarginTokens: 1_024,
  maxMessageBytes: 65_536,
  maxDocumentBytes: CONSERVATIVE_DOCUMENT_HEADROOM_BYTES,
  maxManifestBytes: 131_072,
  maxPageSize: 50,
  defaultPageSize: 20,
  titleMaxChars: 80,
  maxConcurrentAttemptsPerSession: 1,
  maxConcurrentGenerationsPerProcess: 8,
  maxRequestsPerMinutePerUser: 20,
  retryMaxAttempts: 2,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 5_000,
  connectTimeoutMs: 10_000,
  firstOutputTimeoutMs: 30_000,
  idleStreamTimeoutMs: 20_000,
  totalRunTimeoutMs: 180_000,
  persistenceTimeoutMs: 15_000,
  shutdownDrainMs: 20_000,
};

export function usableHistoryTokens(budgets: BudgetConfig): number {
  return (
    budgets.maxContextTokens -
    budgets.maxOutputTokens -
    budgets.modelMarginTokens
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/contracts/budgets.spec.ts
```

Working directory: `backend`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/contracts/budgets.ts backend/src/contracts/budgets.spec.ts
git commit -m "feat(p1): add finite default resource budgets"
```

---

### Task 5: Session, message, and agent-memory schemas

**Files:**
- Create: `backend/src/contracts/session.ts`
- Create: `backend/src/contracts/message.ts`
- Create: `backend/src/contracts/agent-memory.ts`
- Create: `backend/src/contracts/archive.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/contracts/archive.spec.ts`:

```typescript
import { agentMemoryManifestSchema } from './agent-memory.js';
import { messageRecordSchema } from './message.js';
import { sessionRecordSchema } from './session.js';

const session = {
  schemaVersion: 1,
  userId: 'aurvin-dev-user',
  sessionId: 'sess_1',
  title: 'Hello',
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
  lastActivityAt: '2026-10-06T00:00:00.000Z',
  lifecycle: 'active',
  graphThreadId: 'sess_1',
  execution: {
    ownerId: null,
    leaseExpiresAt: null,
    activeAttemptId: null,
    generation: 0,
  },
  latestTurnId: null,
};

describe('sessionRecordSchema', () => {
  it('accepts bounded metadata without transcript arrays', () => {
    expect(sessionRecordSchema.parse(session).sessionId).toBe('sess_1');
  });

  it('rejects unbounded transcript or id lists on the session document', () => {
    expect(
      sessionRecordSchema.safeParse({ ...session, messages: [] }).success,
    ).toBe(false);
    expect(
      sessionRecordSchema.safeParse({ ...session, messageIds: ['m1'] }).success,
    ).toBe(false);
    expect(
      sessionRecordSchema.safeParse({ ...session, attemptIds: ['a1'] }).success,
    ).toBe(false);
    expect(
      sessionRecordSchema.safeParse({ ...session, transcript: 'hello' }).success,
    ).toBe(false);
  });
});

describe('messageRecordSchema', () => {
  it('requires session/turn/event identity and sequence', () => {
    const message = messageRecordSchema.parse({
      schemaVersion: 1,
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      messageId: 'msg_1',
      eventId: 'evt_1',
      sequence: 0,
      role: 'user',
      content: 'Hello',
      createdAt: '2026-10-06T00:00:00.000Z',
      completionStatus: 'accepted',
      attemptId: null,
      truncated: false,
    });
    expect(message.sequence).toBe(0);
    expect(message.role).toBe('user');
  });

  it('rejects private reasoning fields', () => {
    expect(
      messageRecordSchema.safeParse({
        schemaVersion: 1,
        userId: 'aurvin-dev-user',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        messageId: 'msg_1',
        eventId: 'evt_1',
        sequence: 1,
        role: 'assistant',
        content: 'Hi',
        createdAt: '2026-10-06T00:00:00.000Z',
        completionStatus: 'completed',
        attemptId: 'att_1',
        truncated: false,
        reasoning: 'secret chain of thought',
      }).success,
    ).toBe(false);
  });
});

describe('agentMemoryManifestSchema', () => {
  it('stores references and ranges rather than copied transcript content', () => {
    const manifest = agentMemoryManifestSchema.parse({
      schemaVersion: 1,
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      contextVersion: 1,
      sourceRanges: [
        {
          fromSequence: 0,
          toSequence: 1,
          fromEventId: 'evt_1',
          toEventId: 'evt_2',
        },
      ],
      messageRefs: [
        { messageId: 'msg_1', eventId: 'evt_1', sequence: 0 },
        { messageId: 'msg_2', eventId: 'evt_2', sequence: 1 },
      ],
      activeSummaryRef: null,
      instructionVersion: 'phase1.v1',
      knowledgeContentHash: 'abc',
      graphSchemaVersion: 'phase1.v1',
    });
    expect(manifest.activeSummaryRef).toBeNull();
    expect(manifest.messageRefs[0]).not.toHaveProperty('content');
  });

  it('rejects copied transcript fields', () => {
    expect(
      agentMemoryManifestSchema.safeParse({
        schemaVersion: 1,
        userId: 'aurvin-dev-user',
        sessionId: 'sess_1',
        contextVersion: 1,
        sourceRanges: [],
        messageRefs: [],
        activeSummaryRef: null,
        instructionVersion: 'phase1.v1',
        knowledgeContentHash: 'abc',
        graphSchemaVersion: 'phase1.v1',
        transcript: [{ role: 'user', content: 'copied' }],
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/contracts/archive.spec.ts
```

Working directory: `backend`

Expected: FAIL with cannot find module.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/contracts/session.ts`:

```typescript
import { z } from 'zod';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { schemaVersionSchema } from './versions.js';

export const executionLeaseSchema = z
  .object({
    ownerId: idSchema.nullable(),
    leaseExpiresAt: isoDateSchema.nullable(),
    activeAttemptId: idSchema.nullable(),
    generation: sequenceSchema,
  })
  .strict();

export const sessionRecordSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    userId: idSchema,
    sessionId: idSchema,
    title: z.string().min(1).max(80),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    lastActivityAt: isoDateSchema,
    lifecycle: z.enum(['active', 'archived']),
    graphThreadId: idSchema,
    execution: executionLeaseSchema,
    latestTurnId: idSchema.nullable(),
  })
  .strict();

export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type ExecutionLeaseFields = z.infer<typeof executionLeaseSchema>;
```

Create `backend/src/contracts/message.ts`:

```typescript
import { z } from 'zod';
import { DEFAULT_BUDGETS } from './budgets.js';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { schemaVersionSchema } from './versions.js';

export const MESSAGE_ROLES = ['user', 'assistant'] as const;
export const messageRoleSchema = z.enum(MESSAGE_ROLES);

export const MESSAGE_COMPLETION_STATUSES = [
  'accepted',
  'streaming',
  'completed',
  'truncated',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export const messageCompletionStatusSchema = z.enum(
  MESSAGE_COMPLETION_STATUSES,
);

export const messageRecordSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    userId: idSchema,
    sessionId: idSchema,
    turnId: idSchema,
    messageId: idSchema,
    eventId: idSchema,
    sequence: sequenceSchema,
    role: messageRoleSchema,
    content: z.string().max(DEFAULT_BUDGETS.maxInputChars),
    createdAt: isoDateSchema,
    completionStatus: messageCompletionStatusSchema,
    attemptId: idSchema.nullable(),
    truncated: z.boolean(),
  })
  .strict();

export type MessageRecord = z.infer<typeof messageRecordSchema>;
export type MessageRole = z.infer<typeof messageRoleSchema>;
export type MessageCompletionStatus = z.infer<
  typeof messageCompletionStatusSchema
>;
```

Create `backend/src/contracts/agent-memory.ts`:

```typescript
import { z } from 'zod';
import { idSchema, sequenceSchema } from './identifiers.js';
import { schemaVersionSchema } from './versions.js';

export const sourceRangeSchema = z
  .object({
    fromSequence: sequenceSchema,
    toSequence: sequenceSchema,
    fromEventId: idSchema,
    toEventId: idSchema,
  })
  .strict();

export const messageRefSchema = z
  .object({
    messageId: idSchema,
    eventId: idSchema,
    sequence: sequenceSchema,
  })
  .strict();

export const summaryRefSchema = z
  .object({
    summaryId: idSchema,
    sourceRange: sourceRangeSchema,
  })
  .strict();

export const agentMemoryManifestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    userId: idSchema,
    sessionId: idSchema,
    contextVersion: sequenceSchema,
    sourceRanges: z.array(sourceRangeSchema).max(64),
    messageRefs: z.array(messageRefSchema).max(500),
    activeSummaryRef: summaryRefSchema.nullable(),
    instructionVersion: z.string().min(1).max(64),
    knowledgeContentHash: z.string().min(1).max(128),
    graphSchemaVersion: z.string().min(1).max(64),
  })
  .strict();

export type AgentMemoryManifest = z.infer<typeof agentMemoryManifestSchema>;
export type SourceRange = z.infer<typeof sourceRangeSchema>;
export type MessageRef = z.infer<typeof messageRefSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/contracts/archive.spec.ts
```

Working directory: `backend`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/contracts/session.ts backend/src/contracts/message.ts backend/src/contracts/agent-memory.ts backend/src/contracts/archive.spec.ts
git commit -m "feat(p1): add bounded session, message, and agent-memory schemas"
```

---

### Task 6: Attempt, accounting, and future tool-shaped metadata

**Files:**
- Create: `backend/src/contracts/attempt.ts`
- Create: `backend/src/contracts/metadata.ts`
- Create: `backend/src/contracts/metadata.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/contracts/metadata.spec.ts`:

```typescript
import { attemptRecordSchema } from './attempt.js';
import {
  accountingRecordSchema,
  reconstructToolGroups,
  toolRequestRecordSchema,
  toolResultRecordSchema,
} from './metadata.js';

const attempt = {
  schemaVersion: 1,
  kind: 'attempt',
  userId: 'aurvin-dev-user',
  sessionId: 'sess_1',
  turnId: 'turn_1',
  attemptId: 'att_1',
  idempotencyKey: 'idem_1',
  payloadHash: 'a'.repeat(64),
  status: 'accepted',
  sequence: 0,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
  instructionVersion: 'phase1.v1',
  knowledgeContentHash: 'abc',
  graphSchemaVersion: 'phase1.v1',
  contextVersion: 1,
  modelId: 'openrouter/test',
  openRouterUser: 'aurvin-dev-user',
  generationId: null,
  truncated: false,
  errorCode: null,
  causal: {
    userMessageId: 'msg_1',
    previousAttemptId: null,
  },
};

describe('attemptRecordSchema', () => {
  it('records lifecycle, idempotency, versions, and OpenRouter user', () => {
    const parsed = attemptRecordSchema.parse(attempt);
    expect(parsed.openRouterUser).toBe('aurvin-dev-user');
    expect(parsed.causal.previousAttemptId).toBeNull();
  });

  it('accepts truncated as a distinct terminal status', () => {
    expect(
      attemptRecordSchema.parse({ ...attempt, status: 'truncated', truncated: true })
        .status,
    ).toBe('truncated');
  });
});

describe('accountingRecordSchema', () => {
  it('keeps missing cost unknown rather than zero', () => {
    const parsed = accountingRecordSchema.parse({
      schemaVersion: 1,
      kind: 'accounting',
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      generationId: 'gen_1',
      requestedModel: 'openrouter/test',
      reportedModel: null,
      reportedProvider: null,
      promptTokens: null,
      completionTokens: null,
      cost: null,
      accountingStatus: 'unknown',
      outcome: 'interrupted',
      startedAt: '2026-10-06T00:00:00.000Z',
      endedAt: null,
    });
    expect(parsed.cost).toBeNull();
    expect(parsed.accountingStatus).toBe('unknown');
  });
});

describe('tool-shaped fixtures', () => {
  it('reconstructs parallel tool groups by toolCallId without enabling live tools', () => {
    const requestA = toolRequestRecordSchema.parse({
      schemaVersion: 1,
      kind: 'tool-request',
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      eventId: 'evt_tool_a',
      sequence: 2,
      originatingAssistantEventId: 'evt_asst_1',
      toolCallId: 'call_a',
      toolName: 'lookup',
      argumentsJson: '{"q":"a"}',
      createdAt: '2026-10-06T00:00:01.000Z',
    });
    const requestB = toolRequestRecordSchema.parse({
      ...requestA,
      eventId: 'evt_tool_b',
      sequence: 3,
      toolCallId: 'call_b',
      argumentsJson: '{"q":"b"}',
    });
    const resultB = toolResultRecordSchema.parse({
      schemaVersion: 1,
      kind: 'tool-result',
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      eventId: 'evt_res_b',
      sequence: 4,
      originatingToolRequestEventId: 'evt_tool_b',
      toolCallId: 'call_b',
      outcome: 'ok',
      resultRef: { storage: 'inline', json: '{"ok":true}' },
      createdAt: '2026-10-06T00:00:02.000Z',
    });
    const resultA = toolResultRecordSchema.parse({
      ...resultB,
      eventId: 'evt_res_a',
      sequence: 5,
      originatingToolRequestEventId: 'evt_tool_a',
      toolCallId: 'call_a',
    });

    const groups = reconstructToolGroups(
      [requestA, requestB],
      [resultB, resultA],
    );
    expect(groups.get('call_a')?.request.eventId).toBe('evt_tool_a');
    expect(groups.get('call_a')?.result?.eventId).toBe('evt_res_a');
    expect(groups.get('call_b')?.result?.eventId).toBe('evt_res_b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/contracts/metadata.spec.ts
```

Working directory: `backend`

Expected: FAIL with cannot find module.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/contracts/attempt.ts`:

```typescript
import { z } from 'zod';
import { appErrorCodeSchema } from './errors.js';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { schemaVersionSchema } from './versions.js';

export const ATTEMPT_STATUSES = [
  'accepted',
  'generating',
  'finalizing',
  'completed',
  'truncated',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export const attemptStatusSchema = z.enum(ATTEMPT_STATUSES);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

export const attemptRecordSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    kind: z.literal('attempt'),
    userId: idSchema,
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    idempotencyKey: z.string().min(8).max(128),
    payloadHash: z.string().length(64),
    status: attemptStatusSchema,
    sequence: sequenceSchema,
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    instructionVersion: z.string().min(1).max(64),
    knowledgeContentHash: z.string().min(1).max(128),
    graphSchemaVersion: z.string().min(1).max(64),
    contextVersion: sequenceSchema,
    modelId: z.string().min(1).max(200),
    openRouterUser: idSchema,
    generationId: z.string().min(1).max(200).nullable(),
    truncated: z.boolean(),
    errorCode: appErrorCodeSchema.nullable(),
    causal: z
      .object({
        userMessageId: idSchema,
        previousAttemptId: idSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export type AttemptRecord = z.infer<typeof attemptRecordSchema>;
```

Create `backend/src/contracts/metadata.ts`:

```typescript
import { z } from 'zod';
import { attemptStatusSchema } from './attempt.js';
import { DEFAULT_BUDGETS } from './budgets.js';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { schemaVersionSchema } from './versions.js';

export const ACCOUNTING_STATUSES = ['known', 'pending', 'unknown'] as const;
export const accountingStatusSchema = z.enum(ACCOUNTING_STATUSES);
export type AccountingStatus = z.infer<typeof accountingStatusSchema>;

export const accountingRecordSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    kind: z.literal('accounting'),
    userId: idSchema,
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    generationId: z.string().min(1).max(200).nullable(),
    requestedModel: z.string().min(1).max(200),
    reportedModel: z.string().min(1).max(200).nullable(),
    reportedProvider: z.string().min(1).max(200).nullable(),
    promptTokens: z.number().int().nonnegative().nullable(),
    completionTokens: z.number().int().nonnegative().nullable(),
    cost: z.number().nonnegative().nullable(),
    accountingStatus: accountingStatusSchema,
    outcome: attemptStatusSchema,
    startedAt: isoDateSchema,
    endedAt: isoDateSchema.nullable(),
  })
  .strict();

export type AccountingRecord = z.infer<typeof accountingRecordSchema>;

const boundedJson = z.string().max(DEFAULT_BUDGETS.maxManifestBytes);

export const toolRequestRecordSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    kind: z.literal('tool-request'),
    userId: idSchema,
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    eventId: idSchema,
    sequence: sequenceSchema,
    originatingAssistantEventId: idSchema,
    toolCallId: z.string().min(1).max(128),
    toolName: z.string().min(1).max(64),
    argumentsJson: boundedJson,
    createdAt: isoDateSchema,
  })
  .strict();

export const toolResultRefSchema = z.discriminatedUnion('storage', [
  z.object({ storage: z.literal('inline'), json: boundedJson }).strict(),
  z.object({ storage: z.literal('external'), uri: z.string().min(1).max(500) }).strict(),
]);

export const toolResultRecordSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    kind: z.literal('tool-result'),
    userId: idSchema,
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    eventId: idSchema,
    sequence: sequenceSchema,
    originatingToolRequestEventId: idSchema,
    toolCallId: z.string().min(1).max(128),
    outcome: z.enum(['ok', 'error']),
    resultRef: toolResultRefSchema,
    createdAt: isoDateSchema,
  })
  .strict();

export type ToolRequestRecord = z.infer<typeof toolRequestRecordSchema>;
export type ToolResultRecord = z.infer<typeof toolResultRecordSchema>;

export type ToolGroup = {
  toolCallId: string;
  request: ToolRequestRecord;
  result: ToolResultRecord | null;
};

export function reconstructToolGroups(
  requests: readonly ToolRequestRecord[],
  results: readonly ToolResultRecord[],
): Map<string, ToolGroup> {
  const groups = new Map<string, ToolGroup>();
  for (const request of requests) {
    groups.set(request.toolCallId, {
      toolCallId: request.toolCallId,
      request,
      result: null,
    });
  }
  for (const result of results) {
    const group = groups.get(result.toolCallId);
    if (group) {
      group.result = result;
    }
  }
  return groups;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/contracts/metadata.spec.ts
```

Working directory: `backend`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/contracts/attempt.ts backend/src/contracts/metadata.ts backend/src/contracts/metadata.spec.ts
git commit -m "feat(p1): add attempt, accounting, and tool-shaped metadata contracts"
```

---

### Task 7: Application stream protocol

**Files:**
- Create: `backend/src/contracts/stream.ts`
- Create: `backend/src/contracts/stream.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/contracts/stream.spec.ts`:

```typescript
import {
  STREAM_PROTOCOL_VERSION,
  encodeSseFrame,
  parseSseDataLine,
  streamEnvelopeSchema,
} from './stream.js';

const accepted = {
  protocolVersion: 1,
  sessionId: 'sess_1',
  turnId: 'turn_1',
  attemptId: 'att_1',
  sequence: 0,
  event: {
    type: 'turn-accepted',
    userMessageId: 'msg_1',
  },
};

describe('stream protocol', () => {
  it('uses protocol version 1 envelopes with turn/attempt ids', () => {
    expect(STREAM_PROTOCOL_VERSION).toBe(1);
    expect(streamEnvelopeSchema.parse(accepted).event.type).toBe(
      'turn-accepted',
    );
  });

  it('round-trips SSE frames for deltas and terminal completed events', () => {
    const delta = streamEnvelopeSchema.parse({
      ...accepted,
      sequence: 1,
      event: { type: 'delta', text: 'Hello' },
    });
    const completed = streamEnvelopeSchema.parse({
      ...accepted,
      sequence: 2,
      event: {
        type: 'completed',
        assistantMessageId: 'msg_2',
        outcome: 'completed',
      },
    });
    expect(parseSseDataLine(encodeSseFrame(delta))).toEqual(delta);
    expect(parseSseDataLine(encodeSseFrame(completed)).event.type).toBe(
      'completed',
    );
  });

  it('distinguishes truncated, cancelled, and error outcomes from completed', () => {
    expect(
      streamEnvelopeSchema.parse({
        ...accepted,
        event: {
          type: 'status',
          status: 'truncated',
          truncated: true,
        },
      }).event,
    ).toMatchObject({ status: 'truncated', truncated: true });
    expect(
      streamEnvelopeSchema.parse({
        ...accepted,
        event: {
          type: 'error',
          code: 'CANCELLED',
          message: 'Generation was cancelled.',
          retryable: false,
        },
      }).event,
    ).toMatchObject({ code: 'CANCELLED' });
    expect(
      streamEnvelopeSchema.safeParse({
        ...accepted,
        event: { type: 'completed', secretPrompt: 'nope' },
      }).success,
    ).toBe(false);
  });

  it('rejects checkpoint or credential fields on the envelope', () => {
    expect(
      streamEnvelopeSchema.safeParse({
        ...accepted,
        checkpoint: { id: 'cp_1' },
      }).success,
    ).toBe(false);
    expect(
      streamEnvelopeSchema.safeParse({
        ...accepted,
        apiKey: 'sk-secret',
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/contracts/stream.spec.ts
```

Working directory: `backend`

Expected: FAIL with cannot find module `./stream.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/contracts/stream.ts`:

```typescript
import { z } from 'zod';
import { attemptStatusSchema } from './attempt.js';
import { appErrorCodeSchema } from './errors.js';
import { idSchema, sequenceSchema } from './identifiers.js';
import { accountingStatusSchema } from './metadata.js';
import { CONTRACT_VERSIONS } from './versions.js';

export const STREAM_PROTOCOL_VERSION = CONTRACT_VERSIONS.stream;

export const turnAcceptedEventSchema = z
  .object({
    type: z.literal('turn-accepted'),
    userMessageId: idSchema,
  })
  .strict();

export const deltaEventSchema = z
  .object({
    type: z.literal('delta'),
    text: z.string().min(1),
  })
  .strict();

export const statusEventSchema = z
  .object({
    type: z.literal('status'),
    status: attemptStatusSchema,
    truncated: z.boolean(),
  })
  .strict();

export const usageEventSchema = z
  .object({
    type: z.literal('usage'),
    accountingStatus: accountingStatusSchema,
    promptTokens: z.number().int().nonnegative().nullable(),
    completionTokens: z.number().int().nonnegative().nullable(),
    cost: z.number().nonnegative().nullable(),
  })
  .strict();

export const errorEventSchema = z
  .object({
    type: z.literal('error'),
    code: appErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
  })
  .strict();

export const completedEventSchema = z
  .object({
    type: z.literal('completed'),
    assistantMessageId: idSchema,
    outcome: z.enum(['completed', 'truncated']),
  })
  .strict();

export const streamEventSchema = z.discriminatedUnion('type', [
  turnAcceptedEventSchema,
  deltaEventSchema,
  statusEventSchema,
  usageEventSchema,
  errorEventSchema,
  completedEventSchema,
]);

export const streamEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(STREAM_PROTOCOL_VERSION),
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    sequence: sequenceSchema,
    event: streamEventSchema,
  })
  .strict();

export type StreamEvent = z.infer<typeof streamEventSchema>;
export type StreamEnvelope = z.infer<typeof streamEnvelopeSchema>;

export function encodeSseFrame(envelope: StreamEnvelope): string {
  return `data: ${JSON.stringify(envelope)}\n\n`;
}

export function parseSseDataLine(line: string): StreamEnvelope {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) {
    throw new Error('invalid_sse_line');
  }
  const json = trimmed.slice('data:'.length).trim();
  return streamEnvelopeSchema.parse(JSON.parse(json));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/contracts/stream.spec.ts
```

Working directory: `backend`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/contracts/stream.ts backend/src/contracts/stream.spec.ts
git commit -m "feat(p1): add versioned application stream contract"
```

---

### Task 8: HTTP API contracts that reject identity/model overrides

**Files:**
- Create: `backend/src/contracts/api.ts`
- Create: `backend/src/contracts/api.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/contracts/api.spec.ts`:

```typescript
import {
  API_PROTOCOL_VERSION,
  API_ROUTES,
  listMessagesResponseSchema,
  listSessionsResponseSchema,
  retryTurnRequestSchema,
  submitTurnRequestSchema,
  turnStatusResponseSchema,
} from './api.js';

describe('submitTurnRequestSchema', () => {
  it('accepts sessionId, content, and idempotencyKey only', () => {
    expect(
      submitTurnRequestSchema.parse({
        sessionId: null,
        content: 'Hello',
        idempotencyKey: 'idempotency-key-1',
      }).sessionId,
    ).toBeNull();
  });

  it('rejects client identity, model, and unknown fields', () => {
    const base = {
      sessionId: 'sess_1',
      content: 'Hello',
      idempotencyKey: 'idempotency-key-1',
    };
    expect(submitTurnRequestSchema.safeParse({ ...base, userId: 'hacker' }).success).toBe(
      false,
    );
    expect(submitTurnRequestSchema.safeParse({ ...base, user: 'hacker' }).success).toBe(
      false,
    );
    expect(submitTurnRequestSchema.safeParse({ ...base, model: 'other' }).success).toBe(
      false,
    );
    expect(submitTurnRequestSchema.safeParse({ ...base, modelId: 'other' }).success).toBe(
      false,
    );
    expect(submitTurnRequestSchema.safeParse({ ...base, apiKey: 'sk-x' }).success).toBe(
      false,
    );
  });

  it('rejects oversized input', () => {
    expect(
      submitTurnRequestSchema.safeParse({
        sessionId: null,
        content: 'x'.repeat(32_001),
        idempotencyKey: 'idempotency-key-1',
      }).success,
    ).toBe(false);
  });
});

describe('API routes and list/status payloads', () => {
  it('exports resource paths without leaking /api prefix ownership', () => {
    expect(API_PROTOCOL_VERSION).toBe(1);
    expect(API_ROUTES.sessions).toBe('/sessions');
    expect(API_ROUTES.turnStream('sess_1', 'turn_1')).toBe(
      '/sessions/sess_1/turns/turn_1/stream',
    );
  });

  it('parses list and status payloads', () => {
    expect(
      listSessionsResponseSchema.parse({
        items: [
          {
            sessionId: 'sess_1',
            title: 'Hello',
            createdAt: '2026-10-06T00:00:00.000Z',
            lastActivityAt: '2026-10-06T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      }).items,
    ).toHaveLength(1);
    expect(
      listMessagesResponseSchema.parse({
        items: [],
        nextCursor: null,
        olderAvailable: false,
      }).olderAvailable,
    ).toBe(false);
    expect(
      turnStatusResponseSchema.parse({
        sessionId: 'sess_1',
        turnId: 'turn_1',
        attemptId: 'att_1',
        status: 'generating',
        truncated: false,
        error: null,
      }).status,
    ).toBe('generating');
    expect(
      retryTurnRequestSchema.parse({
        idempotencyKey: 'idempotency-key-2',
      }).idempotencyKey,
    ).toBe('idempotency-key-2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/contracts/api.spec.ts
```

Working directory: `backend`

Expected: FAIL with cannot find module `./api.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/contracts/api.ts`:

```typescript
import { z } from 'zod';
import { attemptStatusSchema } from './attempt.js';
import { DEFAULT_BUDGETS } from './budgets.js';
import { clientErrorBodySchema } from './errors.js';
import { idSchema, isoDateSchema } from './identifiers.js';
import { messageRecordSchema } from './message.js';
import { CONTRACT_VERSIONS } from './versions.js';

export const API_PROTOCOL_VERSION = CONTRACT_VERSIONS.api;

export const API_ROUTES = {
  sessions: '/sessions',
  session: (sessionId: string) => `/sessions/${sessionId}`,
  messages: (sessionId: string) => `/sessions/${sessionId}/messages`,
  turns: (sessionId: string) => `/sessions/${sessionId}/turns`,
  turnStatus: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}`,
  turnStream: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/stream`,
  cancelTurn: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/cancel`,
  retryTurn: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/retry`,
} as const;

export const submitTurnRequestSchema = z
  .object({
    sessionId: idSchema.nullable(),
    content: z.string().min(1).max(DEFAULT_BUDGETS.maxInputChars),
    idempotencyKey: z.string().min(8).max(128),
  })
  .strict();

export const retryTurnRequestSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(128),
  })
  .strict();

export const cancelTurnRequestSchema = z
  .object({
    attemptId: idSchema,
  })
  .strict();

export const submitTurnResponseSchema = z
  .object({
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    userMessageId: idSchema,
    streamPath: z.string().min(1),
  })
  .strict();

export const sessionSummarySchema = z
  .object({
    sessionId: idSchema,
    title: z.string().min(1).max(DEFAULT_BUDGETS.titleMaxChars),
    createdAt: isoDateSchema,
    lastActivityAt: isoDateSchema,
  })
  .strict();

export const listSessionsResponseSchema = z
  .object({
    items: z.array(sessionSummarySchema).max(DEFAULT_BUDGETS.maxPageSize),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();

export const visibleMessageSchema = messageRecordSchema.pick({
  messageId: true,
  turnId: true,
  eventId: true,
  sequence: true,
  role: true,
  content: true,
  createdAt: true,
  completionStatus: true,
  truncated: true,
});

export const listMessagesResponseSchema = z
  .object({
    items: z.array(visibleMessageSchema).max(DEFAULT_BUDGETS.maxPageSize),
    nextCursor: z.string().min(1).nullable(),
    olderAvailable: z.boolean(),
  })
  .strict();

export const turnStatusResponseSchema = z
  .object({
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    status: attemptStatusSchema,
    truncated: z.boolean(),
    error: clientErrorBodySchema.nullable(),
  })
  .strict();

export const pageRequestSchema = z
  .object({
    cursor: z.string().min(1).nullable(),
    limit: z
      .number()
      .int()
      .positive()
      .max(DEFAULT_BUDGETS.maxPageSize)
      .default(DEFAULT_BUDGETS.defaultPageSize),
  })
  .strict();

export type SubmitTurnRequest = z.infer<typeof submitTurnRequestSchema>;
export type RetryTurnRequest = z.infer<typeof retryTurnRequestSchema>;
export type CancelTurnRequest = z.infer<typeof cancelTurnRequestSchema>;
export type SubmitTurnResponse = z.infer<typeof submitTurnResponseSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;
export type VisibleMessage = z.infer<typeof visibleMessageSchema>;
export type ListMessagesResponse = z.infer<typeof listMessagesResponseSchema>;
export type TurnStatusResponse = z.infer<typeof turnStatusResponseSchema>;
export type PageRequest = z.infer<typeof pageRequestSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/contracts/api.spec.ts
```

Working directory: `backend`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/contracts/api.ts backend/src/contracts/api.spec.ts
git commit -m "feat(p1): add strict HTTP API contracts without client identity"
```

---

### Task 9: Identity, repository, context, and runtime interfaces

**Files:**
- Create: `backend/src/contracts/identity.ts`
- Create: `backend/src/contracts/context.ts`
- Create: `backend/src/contracts/repositories.ts`
- Create: `backend/src/contracts/runtime.ts`
- Create: `backend/src/contracts/interfaces.spec.ts`
- Create: `backend/src/contracts/index.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/contracts/interfaces.spec.ts`:

```typescript
import { DEFAULT_BUDGETS } from './budgets.js';
import type { ContextAssembler } from './context.js';
import type { IdentityResolver, ResolvedIdentity } from './identity.js';
import type {
  AgentMemoryRepository,
  CheckpointStoreFactory,
  ExecutionOwnership,
  MessageRepository,
  MetadataRepository,
  SessionRepository,
} from './repositories.js';
import type { AgentRuntime, ModelAdapter, ModelInvokeRequest } from './runtime.js';

describe('downstream interfaces', () => {
  it('keeps identity server-resolved and OpenRouter user required on model requests', async () => {
    const identity: ResolvedIdentity = {
      userId: 'aurvin-dev-user',
      source: 'server-configured',
      openRouterUser: 'aurvin-dev-user',
    };
    const resolver: IdentityResolver = {
      resolve: () => identity,
    };
    expect(resolver.resolve().source).toBe('server-configured');

    const adapter: ModelAdapter = {
      async *stream(request: ModelInvokeRequest) {
        if (!request.user) {
          throw new Error('missing user');
        }
        yield { type: 'end' as const };
      },
    };
    const chunks = [];
    for await (const chunk of adapter.stream({
      modelId: 'openrouter/test',
      user: identity.openRouterUser,
      messages: [{ role: 'user', content: 'Hi' }],
      maxOutputTokens: DEFAULT_BUDGETS.maxOutputTokens,
      abortSignal: new AbortController().signal,
      transforms: [],
      dataCollection: 'deny',
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ type: 'end' }]);
  });

  it('is implementable by fakes without cross-collection transactions', async () => {
    const sessions: SessionRepository = {
      get: async () => null,
      list: async () => ({ items: [], nextCursor: null }),
      createIfAbsent: async (record) => record,
      touchActivity: async () => undefined,
    };
    const messages: MessageRepository = {
      append: async () => undefined,
      list: async () => ({ items: [], nextCursor: null, olderAvailable: false }),
      get: async () => null,
      updateCompletion: async () => undefined,
    };
    const memory: AgentMemoryRepository = {
      get: async () => null,
      put: async () => undefined,
    };
    const metadata: MetadataRepository = {
      putAttempt: async () => undefined,
      getAttempt: async () => null,
      getAttemptByIdempotency: async () => null,
      putAccounting: async () => undefined,
    };
    const ownership: ExecutionOwnership = {
      acquire: async () => ({
        ok: false,
        code: 'CONFLICT_ACTIVE_TURN',
      }),
      fence: async () => false,
      release: async () => undefined,
    };
    const checkpoints: CheckpointStoreFactory = {
      create: async () => ({ setup: async () => undefined }),
    };
    const context: ContextAssembler = {
      assemble: async () => ({
        ok: false,
        overflow: {
          code: 'CONTEXT_BUDGET_EXCEEDED',
          message: 'This chat is too long. Start a new chat.',
          maxContextTokens: DEFAULT_BUDGETS.maxContextTokens,
          requiredTokens: DEFAULT_BUDGETS.maxContextTokens + 1,
        },
      }),
    };
    const runtime: AgentRuntime = {
      submitTurn: async () => ({
        sessionId: 'sess_1',
        turnId: 'turn_1',
        attemptId: 'att_1',
        userMessageId: 'msg_1',
        streamPath: '/sessions/sess_1/turns/turn_1/stream',
      }),
      cancelTurn: async () => undefined,
      retryTurn: async () => ({
        sessionId: 'sess_1',
        turnId: 'turn_1',
        attemptId: 'att_2',
        userMessageId: 'msg_1',
        streamPath: '/sessions/sess_1/turns/turn_1/stream',
      }),
      getTurnStatus: async () => ({
        sessionId: 'sess_1',
        turnId: 'turn_1',
        attemptId: 'att_1',
        status: 'interrupted',
        truncated: false,
        error: {
          code: 'INTERRUPTED',
          message: 'Generation was interrupted. Retry to continue.',
          retryable: false,
        },
      }),
      reconcileSession: async () => undefined,
    };

    expect(await sessions.get('aurvin-dev-user', 'sess_1')).toBeNull();
    expect((await ownership.acquire({
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      ownerId: 'worker-1',
      leaseMs: 30_000,
    })).ok).toBe(false);
    expect((await context.assemble({
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      newUserInput: 'Hi',
    })).ok).toBe(false);
    expect(await runtime.getTurnStatus('aurvin-dev-user', 'sess_1', 'turn_1')).toMatchObject({
      status: 'interrupted',
    });
    expect(messages).toBeDefined();
    expect(memory).toBeDefined();
    expect(metadata).toBeDefined();
    expect(checkpoints).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/contracts/interfaces.spec.ts
```

Working directory: `backend`

Expected: FAIL with cannot find module.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/contracts/identity.ts`:

```typescript
import { z } from 'zod';
import { idSchema } from './identifiers.js';

export const resolvedIdentitySchema = z
  .object({
    userId: idSchema,
    source: z.literal('server-configured'),
    openRouterUser: idSchema,
  })
  .strict();

export type ResolvedIdentity = z.infer<typeof resolvedIdentitySchema>;

export interface IdentityResolver {
  resolve(): ResolvedIdentity;
}
```

Create `backend/src/contracts/context.ts`:

```typescript
export type ContextChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ContextOverflow = {
  code: 'CONTEXT_BUDGET_EXCEEDED';
  message: string;
  maxContextTokens: number;
  requiredTokens: number;
};

export type AssembledContext = {
  contextVersion: number;
  instructionVersion: string;
  knowledgeContentHash: string;
  graphSchemaVersion: string;
  messages: readonly ContextChatMessage[];
};

export type ContextAssemblyResult =
  | { ok: true; context: AssembledContext }
  | { ok: false; overflow: ContextOverflow };

export type ContextAssemblyRequest = {
  userId: string;
  sessionId: string;
  turnId: string;
  newUserInput: string;
};

export interface ContextAssembler {
  assemble(request: ContextAssemblyRequest): Promise<ContextAssemblyResult>;
}
```

Create `backend/src/contracts/repositories.ts`:

```typescript
import type { AgentMemoryManifest } from './agent-memory.js';
import type { AttemptRecord } from './attempt.js';
import type { AccountingRecord } from './metadata.js';
import type { ListMessagesResponse, SessionSummary } from './api.js';
import type { MessageCompletionStatus, MessageRecord } from './message.js';
import type { SessionRecord } from './session.js';

export type PageQuery = {
  cursor: string | null;
  limit: number;
};

export interface SessionRepository {
  get(userId: string, sessionId: string): Promise<SessionRecord | null>;
  list(
    userId: string,
    page: PageQuery,
  ): Promise<{ items: SessionSummary[]; nextCursor: string | null }>;
  createIfAbsent(record: SessionRecord): Promise<SessionRecord>;
  touchActivity(userId: string, sessionId: string, at: string): Promise<void>;
}

export interface MessageRepository {
  append(record: MessageRecord): Promise<void>;
  list(
    userId: string,
    sessionId: string,
    page: PageQuery,
  ): Promise<ListMessagesResponse>;
  get(
    userId: string,
    sessionId: string,
    messageId: string,
  ): Promise<MessageRecord | null>;
  updateCompletion(
    userId: string,
    sessionId: string,
    messageId: string,
    completionStatus: MessageCompletionStatus,
    truncated: boolean,
  ): Promise<void>;
}

export interface AgentMemoryRepository {
  get(userId: string, sessionId: string): Promise<AgentMemoryManifest | null>;
  put(manifest: AgentMemoryManifest): Promise<void>;
}

export interface MetadataRepository {
  putAttempt(record: AttemptRecord): Promise<void>;
  getAttempt(
    userId: string,
    sessionId: string,
    attemptId: string,
  ): Promise<AttemptRecord | null>;
  getAttemptByIdempotency(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
  ): Promise<AttemptRecord | null>;
  putAccounting(record: AccountingRecord): Promise<void>;
}

export type ExecutionLease = {
  ownerId: string;
  sessionId: string;
  userId: string;
  leaseExpiresAt: string;
  generation: number;
};

export type AcquireExecutionResult =
  | { ok: true; lease: ExecutionLease }
  | { ok: false; code: 'CONFLICT_ACTIVE_TURN' };

export interface ExecutionOwnership {
  acquire(input: {
    userId: string;
    sessionId: string;
    ownerId: string;
    leaseMs: number;
    expectedGeneration?: number;
  }): Promise<AcquireExecutionResult>;
  fence(lease: ExecutionLease): Promise<boolean>;
  release(lease: ExecutionLease): Promise<void>;
}

export interface CheckpointerSetup {
  setup(): Promise<void>;
}

export interface CheckpointStoreFactory {
  create(): Promise<CheckpointerSetup>;
}
```

Create `backend/src/contracts/runtime.ts`:

```typescript
import type { SubmitTurnResponse, TurnStatusResponse } from './api.js';
import type { ContextChatMessage } from './context.js';
import type { ResolvedIdentity } from './identity.js';
import type { AccountingStatus } from './metadata.js';

export type ChatMessage = ContextChatMessage;

export type ModelInvokeRequest = {
  modelId: string;
  user: string;
  messages: readonly ChatMessage[];
  maxOutputTokens: number;
  abortSignal: AbortSignal;
  transforms: readonly string[];
  dataCollection: 'allow' | 'deny';
};

export type ModelChunk =
  | { type: 'delta'; text: string }
  | { type: 'comment'; text: string }
  | { type: 'generation-id'; generationId: string }
  | {
      type: 'usage';
      promptTokens: number | null;
      completionTokens: number | null;
      cost: number | null;
      accountingStatus: AccountingStatus;
    }
  | { type: 'length' }
  | { type: 'error'; message: string; retryable: boolean }
  | { type: 'end' };

export interface ModelAdapter {
  stream(request: ModelInvokeRequest): AsyncIterable<ModelChunk>;
}

export type SubmitTurnCommand = {
  identity: ResolvedIdentity;
  sessionId: string | null;
  content: string;
  idempotencyKey: string;
};

export type RetryTurnCommand = {
  identity: ResolvedIdentity;
  sessionId: string;
  turnId: string;
  idempotencyKey: string;
};

export type CancelTurnCommand = {
  identity: ResolvedIdentity;
  sessionId: string;
  turnId: string;
  attemptId: string;
};

export interface AgentRuntime {
  submitTurn(command: SubmitTurnCommand): Promise<SubmitTurnResponse>;
  cancelTurn(command: CancelTurnCommand): Promise<void>;
  retryTurn(command: RetryTurnCommand): Promise<SubmitTurnResponse>;
  getTurnStatus(
    userId: string,
    sessionId: string,
    turnId: string,
  ): Promise<TurnStatusResponse>;
  reconcileSession(userId: string, sessionId: string): Promise<void>;
}
```

Create `backend/src/contracts/index.ts`:

```typescript
export * from './agent-memory.js';
export * from './api.js';
export * from './attempt.js';
export * from './budgets.js';
export * from './collections.js';
export * from './context.js';
export * from './errors.js';
export * from './identifiers.js';
export * from './identity.js';
export * from './message.js';
export * from './metadata.js';
export * from './persistence-profile.js';
export * from './repositories.js';
export * from './runtime.js';
export * from './session.js';
export * from './stream.js';
export * from './versions.js';
```

`runtime.ts` may import `ContextChatMessage` from `context.ts`. Do not import `runtime.ts` from `context.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/contracts/interfaces.spec.ts
```

Working directory: `backend`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/contracts/identity.ts backend/src/contracts/context.ts backend/src/contracts/repositories.ts backend/src/contracts/runtime.ts backend/src/contracts/interfaces.spec.ts backend/src/contracts/index.ts
git commit -m "feat(p1): add identity, repository, context, and runtime interfaces"
```

---

### Task 10: Frontend protocol.ts and frontend `npm test`

**Files:**
- Create: `frontend/src/api/protocol.ts`
- Create: `frontend/src/api/protocol.test.ts`
- Create: `frontend/vitest.config.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json` (via npm)
- Modify: `frontend/tsconfig.app.json`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/protocol.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  API_ROUTES,
  STREAM_PROTOCOL_VERSION,
  assertNoClientOverrides,
  isSubmitTurnRequest,
  parseSseDataLine,
} from './protocol.ts'

describe('frontend protocol', () => {
  it('matches backend stream protocol version 1', () => {
    expect(STREAM_PROTOCOL_VERSION).toBe(1)
    const frame =
      'data: {"protocolVersion":1,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":1,"event":{"type":"delta","text":"Hello"}}\n\n'
    expect(parseSseDataLine(frame)).toEqual({
      protocolVersion: 1,
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      sequence: 1,
      event: { type: 'delta', text: 'Hello' },
    })
  })

  it('rejects client identity and model fields on submit requests', () => {
    expect(
      isSubmitTurnRequest({
        sessionId: null,
        content: 'Hello',
        idempotencyKey: 'idempotency-key-1',
      }),
    ).toBe(true)
    expect(
      isSubmitTurnRequest({
        sessionId: null,
        content: 'Hello',
        idempotencyKey: 'idempotency-key-1',
        userId: 'hacker',
      }),
    ).toBe(false)
    expect(() =>
      assertNoClientOverrides({ userId: 'hacker', content: 'Hello' }),
    ).toThrowError(/identity/i)
    expect(() => assertNoClientOverrides({ model: 'other' })).toThrowError(
      /model/i,
    )
  })

  it('exposes the same resource paths P6 will serve', () => {
    expect(API_ROUTES.sessions).toBe('/sessions')
    expect(API_ROUTES.turnStream('sess_1', 'turn_1')).toBe(
      '/sessions/sess_1/turns/turn_1/stream',
    )
    expect(API_ROUTES.retryTurn('sess_1', 'turn_1')).toBe(
      '/sessions/sess_1/turns/turn_1/retry',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

From `frontend`, if vitest is not installed yet, install it first so the runner exists, then run the missing-module failure:

```bash
npm install -D vitest@^4.1.2
npx vitest run src/api/protocol.test.ts
```

Expected: FAIL because `./protocol.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/api/protocol.ts`:

```typescript
export const STREAM_PROTOCOL_VERSION = 1
export const API_PROTOCOL_VERSION = 1

export const API_ROUTES = {
  sessions: '/sessions',
  session: (sessionId: string) => `/sessions/${sessionId}`,
  messages: (sessionId: string) => `/sessions/${sessionId}/messages`,
  turns: (sessionId: string) => `/sessions/${sessionId}/turns`,
  turnStatus: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}`,
  turnStream: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/stream`,
  cancelTurn: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/cancel`,
  retryTurn: (sessionId: string, turnId: string) =>
    `/sessions/${sessionId}/turns/${turnId}/retry`,
} as const

export const ATTEMPT_STATUSES = [
  'accepted',
  'generating',
  'finalizing',
  'completed',
  'truncated',
  'failed',
  'cancelled',
  'interrupted',
] as const

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number]

export type ClientErrorBody = {
  code: string
  message: string
  retryable: boolean
}

export type SubmitTurnRequest = {
  sessionId: string | null
  content: string
  idempotencyKey: string
}

export type SubmitTurnResponse = {
  sessionId: string
  turnId: string
  attemptId: string
  userMessageId: string
  streamPath: string
}

export type RetryTurnRequest = {
  idempotencyKey: string
}

export type SessionSummary = {
  sessionId: string
  title: string
  createdAt: string
  lastActivityAt: string
}

export type ListSessionsResponse = {
  items: SessionSummary[]
  nextCursor: string | null
}

export type VisibleMessage = {
  messageId: string
  turnId: string
  eventId: string
  sequence: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  completionStatus:
    | 'accepted'
    | 'streaming'
    | 'completed'
    | 'truncated'
    | 'failed'
    | 'cancelled'
    | 'interrupted'
  truncated: boolean
}

export type ListMessagesResponse = {
  items: VisibleMessage[]
  nextCursor: string | null
  olderAvailable: boolean
}

export type TurnStatusResponse = {
  sessionId: string
  turnId: string
  attemptId: string
  status: AttemptStatus
  truncated: boolean
  error: ClientErrorBody | null
}

export type StreamEvent =
  | { type: 'turn-accepted'; userMessageId: string }
  | { type: 'delta'; text: string }
  | { type: 'status'; status: AttemptStatus; truncated: boolean }
  | {
      type: 'usage'
      accountingStatus: 'known' | 'pending' | 'unknown'
      promptTokens: number | null
      completionTokens: number | null
      cost: number | null
    }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | {
      type: 'completed'
      assistantMessageId: string
      outcome: 'completed' | 'truncated'
    }

export type StreamEnvelope = {
  protocolVersion: 1
  sessionId: string
  turnId: string
  attemptId: string
  sequence: number
  event: StreamEvent
}

const OVERRIDE_KEYS = [
  'userId',
  'user',
  'openRouterUser',
  'model',
  'modelId',
  'apiKey',
] as const

export function assertNoClientOverrides(body: unknown): void {
  if (!body || typeof body !== 'object') {
    return
  }
  const record = body as Record<string, unknown>
  for (const key of OVERRIDE_KEYS) {
    if (key in record) {
      if (key === 'model' || key === 'modelId' || key === 'apiKey') {
        throw new Error('Model and API keys cannot be supplied by the client.')
      }
      throw new Error('Identity cannot be supplied by the client.')
    }
  }
}

export function isSubmitTurnRequest(body: unknown): body is SubmitTurnRequest {
  if (!body || typeof body !== 'object') {
    return false
  }
  const record = body as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.some((key) => !['sessionId', 'content', 'idempotencyKey'].includes(key))) {
    return false
  }
  const sessionOk = record.sessionId === null || typeof record.sessionId === 'string'
  return (
    sessionOk &&
    typeof record.content === 'string' &&
    record.content.length > 0 &&
    typeof record.idempotencyKey === 'string' &&
    record.idempotencyKey.length >= 8
  )
}

export function isStreamEnvelope(value: unknown): value is StreamEnvelope {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  if (record.protocolVersion !== 1) {
    return false
  }
  if (
    typeof record.sessionId !== 'string' ||
    typeof record.turnId !== 'string' ||
    typeof record.attemptId !== 'string' ||
    typeof record.sequence !== 'number'
  ) {
    return false
  }
  const event = record.event
  if (!event || typeof event !== 'object' || !('type' in event)) {
    return false
  }
  return true
}

export function parseSseDataLine(line: string): StreamEnvelope {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) {
    throw new Error('invalid_sse_line')
  }
  const parsed: unknown = JSON.parse(trimmed.slice('data:'.length).trim())
  if (!isStreamEnvelope(parsed)) {
    throw new Error('invalid_stream_envelope')
  }
  return parsed
}
```

Create `frontend/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

In `frontend/package.json` `scripts`, add:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

In `frontend/tsconfig.app.json`, keep `"include": ["src"]` and add `"vitest/globals"` only if the compiler requires it. Prefer explicit `vitest` imports as in the test file so `types` can stay `["vite/client"]`.

- [ ] **Step 4: Run tests to verify they pass**

From `frontend`:

```bash
npm test
npm run build
npm run lint
```

Expected: protocol tests PASS; existing frontend build/lint still PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/protocol.ts frontend/src/api/protocol.test.ts frontend/vitest.config.ts frontend/package.json frontend/package-lock.json frontend/tsconfig.app.json
git commit -m "feat(p1): add frontend stream/API protocol and npm test"
```

If `tsconfig.app.json` was not modified, omit it from `git add`.

---

### Task 11: Server identity resolver

**Files:**
- Create: `backend/src/platform/identity/server-identity-resolver.ts`
- Create: `backend/src/platform/identity/server-identity-resolver.spec.ts`
- Create: `backend/src/platform/tokens.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/platform/identity/server-identity-resolver.spec.ts`:

```typescript
import { AppError } from '../errors/app-error.js';
import { ServerIdentityResolver } from './server-identity-resolver.js';

const config = {
  identity: { userId: 'aurvin-dev-user' },
};

describe('ServerIdentityResolver', () => {
  it('returns the server-configured identity for OpenRouter user attribution', () => {
    const resolver = new ServerIdentityResolver(config);
    expect(resolver.resolve()).toEqual({
      userId: 'aurvin-dev-user',
      source: 'server-configured',
      openRouterUser: 'aurvin-dev-user',
    });
  });

  it('does not read identity from a request body', () => {
    const resolver = new ServerIdentityResolver(config);
    const body = { userId: 'attacker', content: 'Hello' };
    expect(() => resolver.assertNoClientOverrides(body)).toThrow(AppError);
    expect(resolver.resolve()).toMatchObject({ userId: 'aurvin-dev-user' });
  });

  it('rejects model and apiKey overrides', () => {
    const resolver = new ServerIdentityResolver(config);
    expect(() => resolver.assertNoClientOverrides({ model: 'other' })).toThrow(
      AppError,
    );
    try {
      resolver.assertNoClientOverrides({ apiKey: 'sk-test' });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('MODEL_OVERRIDE_REJECTED');
    }
  });

  it('allows a test identity only when injected through server config', () => {
    const resolver = new ServerIdentityResolver({
      identity: { userId: 'test-user-a' },
    });
    expect(resolver.resolve().userId).toBe('test-user-a');
    expect(resolver.resolve().openRouterUser).toBe('test-user-a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/platform/identity/server-identity-resolver.spec.ts
```

Working directory: `backend`

Expected: FAIL with cannot find module.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/platform/tokens.ts`:

```typescript
export const AURVIN_CONFIG = Symbol.for('aurvin.config');
```

Create `backend/src/platform/identity/server-identity-resolver.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import type { IdentityResolver, ResolvedIdentity } from '../../contracts/identity.js';
import { AppError } from '../errors/app-error.js';
import { AURVIN_CONFIG } from '../tokens.js';

export type IdentityConfigSlice = {
  identity: { userId: string };
};

const IDENTITY_KEYS = ['userId', 'user', 'openRouterUser'] as const;
const MODEL_KEYS = ['model', 'modelId', 'apiKey'] as const;

@Injectable()
export class ServerIdentityResolver implements IdentityResolver {
  constructor(
    @Inject(AURVIN_CONFIG) private readonly config: IdentityConfigSlice,
  ) {}

  resolve(): ResolvedIdentity {
    const userId = this.config.identity.userId;
    return {
      userId,
      source: 'server-configured',
      openRouterUser: userId,
    };
  }

  assertNoClientOverrides(body: unknown): void {
    if (!body || typeof body !== 'object') {
      return;
    }
    const record = body as Record<string, unknown>;
    for (const key of IDENTITY_KEYS) {
      if (key in record) {
        throw new AppError(
          'IDENTITY_OVERRIDE_REJECTED',
          'Identity cannot be supplied by the client.',
        );
      }
    }
    for (const key of MODEL_KEYS) {
      if (key in record) {
        throw new AppError(
          'MODEL_OVERRIDE_REJECTED',
          'Model and API keys cannot be supplied by the client.',
        );
      }
    }
  }
}
```

The unit test constructs `new ServerIdentityResolver(config)` without Nest. That requires the constructor to accept the slice as its first argument. Nest `@Inject` still works when the testing module provides `AURVIN_CONFIG`. Direct `new ServerIdentityResolver(config)` also works because it is just a constructor argument.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/platform/identity/server-identity-resolver.spec.ts
```

Working directory: `backend`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/platform/tokens.ts backend/src/platform/identity/server-identity-resolver.ts backend/src/platform/identity/server-identity-resolver.spec.ts
git commit -m "feat(p1): add server identity resolver without client override"
```

---

### Task 12: Validated environment configuration and secret redaction

**Files:**
- Create: `backend/src/platform/security/redact.ts`
- Create: `backend/src/platform/security/redact.spec.ts`
- Create: `backend/src/platform/crypto/hash-payload.ts`
- Create: `backend/src/platform/crypto/hash-payload.spec.ts`
- Create: `backend/src/platform/config/load-config.ts`
- Create: `backend/src/platform/config/load-config.spec.ts`
- Modify: `backend/.env.example`
- Modify: `frontend/.env.example`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/platform/security/redact.spec.ts`:

```typescript
import { redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it('redacts API keys, bearer tokens, and Mongo URIs', () => {
    const redacted = redactSecrets({
      OPENROUTER_API_KEY: 'sk-or-v1-secret',
      authorization: 'Bearer abc',
      MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/aurvin',
      message: 'hello',
    }) as Record<string, unknown>;
    expect(redacted.OPENROUTER_API_KEY).toBe('[redacted]');
    expect(redacted.authorization).toBe('[redacted]');
    expect(redacted.MONGODB_URI).toBe('[redacted]');
    expect(redacted.message).toBe('hello');
  });

  it('redacts secrets embedded in strings', () => {
    expect(String(redactSecrets('mongodb://u:p@localhost:27017'))).toContain(
      '[redacted]',
    );
    expect(String(redactSecrets('sk-or-v1-abcdef'))).toBe('[redacted]');
  });
});
```

Create `backend/src/platform/crypto/hash-payload.spec.ts`:

```typescript
import { hashPayload } from './hash-payload.js';

describe('hashPayload', () => {
  it('returns a stable SHA-256 hex digest', () => {
    expect(hashPayload('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(hashPayload('hello')).toBe(hashPayload('hello'));
    expect(hashPayload('hello')).not.toBe(hashPayload('Hello'));
  });
});
```

Create `backend/src/platform/config/load-config.spec.ts`:

```typescript
import { DEFAULT_BUDGETS } from '../../contracts/budgets.js';
import { loadConfig, readinessIssues } from './load-config.js';

const valid = {
  PORT: '3000',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  AURVIN_USER_ID: 'aurvin-dev-user',
  PERSISTENCE_PROFILE: 'unknown',
  MONGODB_URI: '',
  MONGODB_DB_NAME: 'aurvin',
  OPENROUTER_API_KEY: '',
  OPENROUTER_MODEL: '',
};

describe('loadConfig', () => {
  it('applies finite defaults including conservative document headroom', () => {
    const config = loadConfig(valid);
    expect(config.port).toBe(3000);
    expect(config.identity.userId).toBe('aurvin-dev-user');
    expect(config.persistence.profile).toBe('unknown');
    expect(config.persistence.documentHeadroomBytes).toBe(1_800_000);
    expect(config.budgets).toEqual(DEFAULT_BUDGETS);
    expect(config.topology.executor).toBe('single-process');
    expect(config.openRouter.disableTransforms).toBe(true);
    expect(config.openRouter.dataCollection).toBe('deny');
  });

  it('fails on invalid profile, empty user id, or multi-replica topology', () => {
    expect(() => loadConfig({ ...valid, PERSISTENCE_PROFILE: 'cosmos' })).toThrow();
    expect(() => loadConfig({ ...valid, AURVIN_USER_ID: '' })).toThrow();
    expect(() =>
      loadConfig({ ...valid, AURVIN_EXECUTOR_TOPOLOGY: 'multi-replica' }),
    ).toThrow();
  });

  it('fails on non-finite or history-starving budget overrides', () => {
    expect(() => loadConfig({ ...valid, MAX_OUTPUT_TOKENS: '-1' })).toThrow();
    expect(() =>
      loadConfig({
        ...valid,
        MAX_CONTEXT_TOKENS: '100',
        MAX_OUTPUT_TOKENS: '80',
        MODEL_MARGIN_TOKENS: '40',
      }),
    ).toThrow();
  });

  it('reports readiness issues when secrets are missing without treating that as a parse success for production work', () => {
    const config = loadConfig(valid);
    expect(readinessIssues(config)).toEqual([
      'OPENROUTER_API_KEY is missing',
      'OPENROUTER_MODEL is missing',
      'MONGODB_URI is missing',
    ]);
    const ready = loadConfig({
      ...valid,
      OPENROUTER_API_KEY: 'sk-test',
      OPENROUTER_MODEL: 'openrouter/test',
      MONGODB_URI: 'mongodb://localhost:27017',
    });
    expect(readinessIssues(ready)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/platform/security/redact.spec.ts src/platform/crypto/hash-payload.spec.ts src/platform/config/load-config.spec.ts
```

Working directory: `backend`

Expected: FAIL with cannot find module.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/platform/security/redact.ts`:

```typescript
const SECRET_KEY =
  /api[_-]?key|authorization|password|secret|mongo(?:db)?_?uri|connectionstring/i;
const SECRET_VALUE =
  /(?:sk-[a-zA-Z0-9-]+)|(?:Bearer\s+[A-Za-z0-9._-]+)|(?:mongodb(?:\+srv)?:\/\/[^\s]+)/gi;

function redactString(value: string): string {
  if (SECRET_VALUE.test(value)) {
    SECRET_VALUE.lastIndex = 0;
    return value.replace(SECRET_VALUE, '[redacted]');
  }
  SECRET_VALUE.lastIndex = 0;
  return value;
}

export function redactSecrets(input: unknown): unknown {
  if (typeof input === 'string') {
    return redactString(input);
  }
  if (Array.isArray(input)) {
    return input.map(redactSecrets);
  }
  if (input && typeof input === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      output[key] = SECRET_KEY.test(key) ? '[redacted]' : redactSecrets(value);
    }
    return output;
  }
  return input;
}
```

Create `backend/src/platform/crypto/hash-payload.ts`:

```typescript
import { createHash } from 'node:crypto';

export function hashPayload(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
```

Create `backend/src/platform/config/load-config.ts`:

```typescript
import { z } from 'zod';
import {
  DEFAULT_BUDGETS,
  budgetConfigSchema,
  type BudgetConfig,
} from '../../contracts/budgets.js';
import { AppError } from '../errors/app-error.js';
import {
  documentHeadroomBytes,
  persistenceProfileSchema,
  type PersistenceProfile,
} from '../../contracts/persistence-profile.js';

const optionalPositiveInt = z.coerce.number().int().positive().optional();

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    AURVIN_USER_ID: z.string().min(1).max(128).default('aurvin-dev-user'),
    PERSISTENCE_PROFILE: persistenceProfileSchema.default('unknown'),
    MONGODB_URI: z.string().default(''),
    MONGODB_DB_NAME: z.string().min(1).default('aurvin'),
    OPENROUTER_API_KEY: z.string().default(''),
    OPENROUTER_MODEL: z.string().default(''),
    OPENROUTER_DATA_COLLECTION: z.enum(['allow', 'deny']).default('deny'),
    OPENROUTER_DISABLE_TRANSFORMS: z
      .enum(['true', 'false'])
      .default('true'),
    AURVIN_EXECUTOR_TOPOLOGY: z.literal('single-process').default('single-process'),
    MAX_INPUT_CHARS: optionalPositiveInt,
    MAX_INPUT_TOKENS: optionalPositiveInt,
    MAX_MESSAGES_IN_CONTEXT: optionalPositiveInt,
    MAX_CONTEXT_TOKENS: optionalPositiveInt,
    MAX_OUTPUT_TOKENS: optionalPositiveInt,
    MODEL_MARGIN_TOKENS: optionalPositiveInt,
    MAX_MESSAGE_BYTES: optionalPositiveInt,
    MAX_DOCUMENT_BYTES: optionalPositiveInt,
    MAX_MANIFEST_BYTES: optionalPositiveInt,
    MAX_PAGE_SIZE: optionalPositiveInt,
    DEFAULT_PAGE_SIZE: optionalPositiveInt,
    TITLE_MAX_CHARS: optionalPositiveInt,
    MAX_CONCURRENT_GENERATIONS_PER_PROCESS: optionalPositiveInt,
    MAX_REQUESTS_PER_MINUTE_PER_USER: optionalPositiveInt,
    RETRY_MAX_ATTEMPTS: optionalPositiveInt,
    RETRY_BASE_DELAY_MS: optionalPositiveInt,
    RETRY_MAX_DELAY_MS: optionalPositiveInt,
    CONNECT_TIMEOUT_MS: optionalPositiveInt,
    FIRST_OUTPUT_TIMEOUT_MS: optionalPositiveInt,
    IDLE_STREAM_TIMEOUT_MS: optionalPositiveInt,
    TOTAL_RUN_TIMEOUT_MS: optionalPositiveInt,
    PERSISTENCE_TIMEOUT_MS: optionalPositiveInt,
    SHUTDOWN_DRAIN_MS: optionalPositiveInt,
  })
  .passthrough();

export type AurvinConfig = {
  port: number;
  frontendOrigin: string;
  nodeEnv: 'development' | 'test' | 'production';
  identity: { userId: string };
  persistence: {
    profile: PersistenceProfile;
    mongoUri: string;
    mongoDbName: string;
    documentHeadroomBytes: number;
  };
  openRouter: {
    apiKey: string;
    modelId: string;
    dataCollection: 'allow' | 'deny';
    disableTransforms: boolean;
  };
  topology: { executor: 'single-process' };
  budgets: BudgetConfig;
};

function overlayBudgets(env: z.infer<typeof envSchema>): BudgetConfig {
  return budgetConfigSchema.parse({
    ...DEFAULT_BUDGETS,
    maxInputChars: env.MAX_INPUT_CHARS ?? DEFAULT_BUDGETS.maxInputChars,
    maxInputTokens: env.MAX_INPUT_TOKENS ?? DEFAULT_BUDGETS.maxInputTokens,
    maxMessagesInContext:
      env.MAX_MESSAGES_IN_CONTEXT ?? DEFAULT_BUDGETS.maxMessagesInContext,
    maxContextTokens: env.MAX_CONTEXT_TOKENS ?? DEFAULT_BUDGETS.maxContextTokens,
    maxOutputTokens: env.MAX_OUTPUT_TOKENS ?? DEFAULT_BUDGETS.maxOutputTokens,
    modelMarginTokens: env.MODEL_MARGIN_TOKENS ?? DEFAULT_BUDGETS.modelMarginTokens,
    maxMessageBytes: env.MAX_MESSAGE_BYTES ?? DEFAULT_BUDGETS.maxMessageBytes,
    maxDocumentBytes: env.MAX_DOCUMENT_BYTES ?? DEFAULT_BUDGETS.maxDocumentBytes,
    maxManifestBytes: env.MAX_MANIFEST_BYTES ?? DEFAULT_BUDGETS.maxManifestBytes,
    maxPageSize: env.MAX_PAGE_SIZE ?? DEFAULT_BUDGETS.maxPageSize,
    defaultPageSize: env.DEFAULT_PAGE_SIZE ?? DEFAULT_BUDGETS.defaultPageSize,
    titleMaxChars: env.TITLE_MAX_CHARS ?? DEFAULT_BUDGETS.titleMaxChars,
    maxConcurrentAttemptsPerSession: 1,
    maxConcurrentGenerationsPerProcess:
      env.MAX_CONCURRENT_GENERATIONS_PER_PROCESS ??
      DEFAULT_BUDGETS.maxConcurrentGenerationsPerProcess,
    maxRequestsPerMinutePerUser:
      env.MAX_REQUESTS_PER_MINUTE_PER_USER ??
      DEFAULT_BUDGETS.maxRequestsPerMinutePerUser,
    retryMaxAttempts: env.RETRY_MAX_ATTEMPTS ?? DEFAULT_BUDGETS.retryMaxAttempts,
    retryBaseDelayMs: env.RETRY_BASE_DELAY_MS ?? DEFAULT_BUDGETS.retryBaseDelayMs,
    retryMaxDelayMs: env.RETRY_MAX_DELAY_MS ?? DEFAULT_BUDGETS.retryMaxDelayMs,
    connectTimeoutMs: env.CONNECT_TIMEOUT_MS ?? DEFAULT_BUDGETS.connectTimeoutMs,
    firstOutputTimeoutMs:
      env.FIRST_OUTPUT_TIMEOUT_MS ?? DEFAULT_BUDGETS.firstOutputTimeoutMs,
    idleStreamTimeoutMs:
      env.IDLE_STREAM_TIMEOUT_MS ?? DEFAULT_BUDGETS.idleStreamTimeoutMs,
    totalRunTimeoutMs: env.TOTAL_RUN_TIMEOUT_MS ?? DEFAULT_BUDGETS.totalRunTimeoutMs,
    persistenceTimeoutMs:
      env.PERSISTENCE_TIMEOUT_MS ?? DEFAULT_BUDGETS.persistenceTimeoutMs,
    shutdownDrainMs: env.SHUTDOWN_DRAIN_MS ?? DEFAULT_BUDGETS.shutdownDrainMs,
  });
}

export function loadConfig(
  env: NodeJS.Dict<string> | Record<string, string | undefined>,
): AurvinConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'Invalid application configuration.',
    );
  }
  try {
    const budgets = overlayBudgets(parsed.data);
    return {
      port: parsed.data.PORT,
      frontendOrigin: parsed.data.FRONTEND_ORIGIN,
      nodeEnv: parsed.data.NODE_ENV,
      identity: { userId: parsed.data.AURVIN_USER_ID },
      persistence: {
        profile: parsed.data.PERSISTENCE_PROFILE,
        mongoUri: parsed.data.MONGODB_URI,
        mongoDbName: parsed.data.MONGODB_DB_NAME,
        documentHeadroomBytes: documentHeadroomBytes(
          parsed.data.PERSISTENCE_PROFILE,
        ),
      },
      openRouter: {
        apiKey: parsed.data.OPENROUTER_API_KEY,
        modelId: parsed.data.OPENROUTER_MODEL,
        dataCollection: parsed.data.OPENROUTER_DATA_COLLECTION,
        disableTransforms: parsed.data.OPENROUTER_DISABLE_TRANSFORMS === 'true',
      },
      topology: { executor: parsed.data.AURVIN_EXECUTOR_TOPOLOGY },
      budgets,
    };
  } catch {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'Invalid application configuration.',
    );
  }
}

export function readinessIssues(config: AurvinConfig): string[] {
  const issues: string[] = [];
  if (!config.openRouter.apiKey) {
    issues.push('OPENROUTER_API_KEY is missing');
  }
  if (!config.openRouter.modelId) {
    issues.push('OPENROUTER_MODEL is missing');
  }
  if (!config.persistence.mongoUri) {
    issues.push('MONGODB_URI is missing');
  }
  return issues;
}
```

Replace `backend/.env.example` with:

```
PORT=3000
FRONTEND_ORIGIN=http://localhost:5173
NODE_ENV=development

# Server-resolved development identity. Never send this from the browser.
AURVIN_USER_ID=aurvin-dev-user

# unknown | native-mongodb | cosmos-mongodb-ru | azure-documentdb
PERSISTENCE_PROFILE=unknown
MONGODB_URI=
MONGODB_DB_NAME=aurvin

# Server-side only. Do not expose as VITE_* variables.
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
OPENROUTER_DATA_COLLECTION=deny
OPENROUTER_DISABLE_TRANSFORMS=true

# Phase 1 allows only single-process execution.
AURVIN_EXECUTOR_TOPOLOGY=single-process

# Optional budget overrides; unset values use DEFAULT_BUDGETS.
# MAX_INPUT_CHARS=32000
# MAX_CONTEXT_TOKENS=16384
# MAX_OUTPUT_TOKENS=2048
```

Replace `frontend/.env.example` with:

```
VITE_API_BASE=/api

# Do not add VITE_OPENROUTER_API_KEY, VITE_USER_ID, or VITE_MODEL.
# Identity, model, and keys are resolved on the server.
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run src/platform/security/redact.spec.ts src/platform/crypto/hash-payload.spec.ts src/platform/config/load-config.spec.ts
```

Working directory: `backend`

Expected: PASS.

If `redactSecrets('mongodb://u:p@localhost:27017')` does not match because of regex details, adjust `SECRET_VALUE` until the test assertions pass. Do not log or print real secrets.

- [ ] **Step 5: Commit**

```bash
git add backend/src/platform/security/redact.ts backend/src/platform/security/redact.spec.ts backend/src/platform/crypto/hash-payload.ts backend/src/platform/crypto/hash-payload.spec.ts backend/src/platform/config/load-config.ts backend/src/platform/config/load-config.spec.ts backend/.env.example frontend/.env.example
git commit -m "feat(p1): add validated env config, redaction, and payload hashing"
```

---

### Task 13: Platform module and verification script placeholders

**Files:**
- Create: `backend/src/platform/platform.module.ts`
- Create: `backend/src/platform/platform.module.spec.ts`
- Create: `backend/src/platform/index.ts`
- Create: `backend/vitest.config.azure.ts`
- Create: `backend/vitest.config.behavior.ts`
- Modify: `backend/vitest.config.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write the failing test**

Create `backend/src/platform/platform.module.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { AURVIN_CONFIG } from './tokens.js';
import { loadConfig } from './config/load-config.js';
import { ServerIdentityResolver } from './identity/server-identity-resolver.js';
import { PlatformModule } from './platform.module.js';

describe('PlatformModule', () => {
  it('exports the identity resolver using server config', async () => {
    const previous = { ...process.env };
    process.env.AURVIN_USER_ID = 'aurvin-dev-user';
    process.env.PERSISTENCE_PROFILE = 'unknown';
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
    process.env.PORT = '3000';

    const moduleRef = await Test.createTestingModule({
      imports: [PlatformModule],
    }).compile();

    const resolver = moduleRef.get(ServerIdentityResolver);
    const config = moduleRef.get(AURVIN_CONFIG);
    expect(resolver.resolve().userId).toBe('aurvin-dev-user');
    expect(config.identity.userId).toBe(loadConfig(process.env).identity.userId);

    Object.assign(process.env, previous);
    await moduleRef.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/platform/platform.module.spec.ts
```

Working directory: `backend`

Expected: FAIL with cannot find module `./platform.module.js`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/platform/platform.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { loadConfig } from './config/load-config.js';
import { ServerIdentityResolver } from './identity/server-identity-resolver.js';
import { AURVIN_CONFIG } from './tokens.js';

@Module({
  providers: [
    {
      provide: AURVIN_CONFIG,
      useFactory: () => loadConfig(process.env),
    },
    ServerIdentityResolver,
  ],
  exports: [AURVIN_CONFIG, ServerIdentityResolver],
})
export class PlatformModule {}
```

Create `backend/src/platform/index.ts`:

```typescript
export { AppError } from './errors/app-error.js';
export { hashPayload } from './crypto/hash-payload.js';
export { loadConfig, readinessIssues, type AurvinConfig } from './config/load-config.js';
export { PlatformModule } from './platform.module.js';
export { redactSecrets } from './security/redact.js';
export { ServerIdentityResolver } from './identity/server-identity-resolver.js';
export { AURVIN_CONFIG } from './tokens.js';
```

Replace `backend/vitest.config.ts` with:

```typescript
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      '**/*.azure.spec.ts',
      '**/*.behavior.spec.ts',
      '**/*.e2e-spec.ts',
    ],
  },
});
```

Create `backend/vitest.config.azure.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/compatibility/**/*.azure.spec.ts'],
    passWithNoTests: true,
  },
});
```

Create `backend/vitest.config.behavior.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/evaluations/**/*.behavior.spec.ts'],
    passWithNoTests: true,
  },
});
```

In `backend/package.json` `scripts`, add:

```json
    "test:azure": "vitest run --config ./vitest.config.azure.ts",
    "test:behavior": "vitest run --config ./vitest.config.behavior.ts"
```

Do not add files under `backend/test/compatibility/**` or `backend/test/evaluations/**` (P2/P10 ownership). `passWithNoTests: true` is the P1 placeholder.

- [ ] **Step 4: Run tests to verify they pass**

Working directory: `backend`

```bash
npx vitest run src/platform/platform.module.spec.ts
npm run test:azure
npm run test:behavior
```

Expected:
- platform module spec PASS
- `test:azure` exits 0 with no selected-service tests (placeholder; not Azure certification)
- `test:behavior` exits 0 with no evaluation tests (placeholder; not behavior evidence)

- [ ] **Step 5: Commit**

```bash
git add backend/src/platform/platform.module.ts backend/src/platform/platform.module.spec.ts backend/src/platform/index.ts backend/vitest.config.ts backend/vitest.config.azure.ts backend/vitest.config.behavior.ts backend/package.json
git commit -m "feat(p1): export PlatformModule and add verification script placeholders"
```

---

### Task 14: P1 exit-gate verification

**Files:** none new. Run the existing and newly added checks.

- [ ] **Step 1: Run backend unit tests, lint, and build**

Working directory: `backend`

```bash
npm test
npm run lint
npm run build
```

Expected: PASS. Existing health controller spec still passes. New contract/platform specs pass. `npm test` does not execute azure/behavior/e2e files.

- [ ] **Step 2: Run frontend checks**

Working directory: `frontend`

```bash
npm test
npm run lint
npm run build
```

Expected: PASS. Protocol tests pass. `App.tsx` scaffold still builds because P1 does not wire it.

- [ ] **Step 3: Confirm placeholder scripts are honest**

Working directory: `backend`

```bash
npm run test:azure
npm run test:behavior
```

Expected: exit 0 with no tests, or an explicit skip. Do not record these as AC16/AC19 evidence.

- [ ] **Step 4: Confirm ownership and no entry-point edits**

Run from repo root:

```bash
git diff --name-only
```

Expected: no modifications to `backend/src/main.ts`, `backend/src/app.module.ts`, `frontend/src/App.tsx`, `frontend/src/main.tsx`, or `README.md`.

- [ ] **Step 5: Commit only if Step 1–4 required a tiny fix already made in owned files**

If verification required a fix, commit that fix with a focused message such as:

```bash
git commit -m "fix(p1): correct contract export or lint issue found in exit-gate checks"
```

If nothing failed, do not create an empty commit.

---

## Spec coverage (planner self-review)

| Requirement | Task |
| --- | --- |
| AC05 bounded six-collection schemas, no session transcript arrays | 2, 5 |
| AC07 event identity/order and tool-shaped reconstruction | 5, 6 |
| AC13 server identity, OpenRouter `user`, no browser identity/model/key | 8, 10, 11, 12 |
| AC15 finite input/output/storage/concurrency/timeout/retry budgets | 4, 12 |
| AC16 persistence profile + conservative headroom; no fake Azure cert | 2, 13, 14 |
| AC17 validation, redaction, readiness issues, startup config rules | 3, 12, 13 |
| Goal §6 context versions, overflow instead of silent truncation | 5, 9 |
| Goal §7 collections, no cross-collection transactions in contracts | 2, 9 |
| Goal §8 IDs, sequence, causal links, future tool groups | 3, 5, 6 |
| Goal §9 attempt lifecycle, stream events, one active attempt, leases | 4, 6, 7, 9 |
| Goal §10 model `user` required, accounting unknown≠0, retry class | 6, 9, 12 |
| P7 fixtures: protocol.ts, SSE parse, API routes, statuses | 7, 8, 10 |
| Scripts `test:azure`, `test:behavior`, frontend `npm test` | 10, 13 |
| Pins from R1 `dfe4e08` | 1 |
| No P9 entry-point wiring | 14 |

## Out of scope (do not implement in P1)

- Mongo repositories, indexes, saver `setup()`, Azure certification (P2)
- Product knowledge file and context builder (P3)
- ChatOpenRouter adapter and live/fixture provider calls (P4)
- LangGraph graph, leases in Mongo, reconciliation (P5)
- HTTP controllers and real SSE transport (P6)
- Chat UI (P7)
- Readiness HTTP probes, drain, staging (P8)
- Wiring `AppModule` / `App.tsx` (P9)
- Integrated/live evaluation evidence (P10)
