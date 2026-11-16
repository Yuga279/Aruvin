# P9 — Application Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing Aurvin subsystems into one safe local/protected-staging application with a mounted chat UI, diagnostic health, bounded startup/shutdown, and accurate setup instructions.

**Architecture:** P9 composes existing factories in one `AppService`, shared through a small assembly module in `app.module.ts`; it does not recreate repositories, context selection, inference, transport, or chat UI. `OperationsModule` receives that service's one operations instance, and `ChatHttpModule` receives its observed runtime and lazy archive delegates. Bootstrap installs operations before bounded parsing, binds loopback, and delegates persistence closure exclusively to operations.

**Tech Stack:** Existing NestJS 12/Express, TypeScript ESM/NodeNext, LangGraph/P2 MongoDB saver, P4 OpenRouter adapter, React 19/Vite 8, Vitest 4, Supertest, PowerShell on Node 24.18.0.

---

## Authority, inputs, and boundaries

- Read `AGENTS.md`, `goal.md` §§5 and 11, `research.md` §13, and `state.md` P9 before execution. Approval is recorded in state milestone 58; the earlier approval wording in the root instructions is historical, not a new stop gate.
- Planner prerequisites are committed: P6 `b6cb724`, P7 `d0e64a0`, P8 `02e3d4f`. Worker prerequisites are complete: P6 `8c1ef67..efac6e9`, P7 `5c2568b..2180151`, P8 `ae73635..9e3c022`. Reconfirm their interfaces and a clean/understood working tree; preserve intervening work.
- Review is **skipped**. Self-checking this plan and testing implementation are not a unified review phase.
- No external provisioning, deployment, live paid inference, index changes on an unidentified Azure target, or silent multi-executor startup is authorized by P9. Azure service/API/tier/partitioning and AC16 remain unresolved.
- `openPersistence` admits **native-mongodb only**. Do not label a Cosmos/DocumentDB URI native to bypass its gate. One Node executor per database; no rolling overlap or automatic stale-sentinel deletion/takeover.
- P1-P8 and P10 files are read-only. Route discovered upstream defects to the orchestrator and their owner. Changes to manifests, contracts, native fixtures, knowledge/instructions, gateway, feature CSS, or integration test directories need the owning worker, not an opportunistic P9 edit.
- Add the mandatory project file headers when implementing substantially changed `.ts`/`.tsx` files. This plan intentionally contains no TypeScript file-header block.
- Each checkbox is a small action. Serialize named-file commits with the orchestrator; do not stage all files.

## File map

| Owned path | Responsibility / intended change |
| --- | --- |
| `backend/src/app.service.ts` | Single composition owner; initialization, diagnostic mode, dependency injection seams, transport getter. Preserve greeting/legacy liveness. |
| `backend/src/app.module.ts` | Assembly module plus the existing exported AppModule; register exported P6/P8 dynamic modules against the same service. |
| `backend/src/main.ts` | Env loading, reusable HTTP configuration, safe bootstrap errors, loopback listener, supported shutdown hooks/IPC. |
| `backend/src/app.controller.ts` | Preserve `/api` and `/api/health`; explicit injection, no competing readiness route. |
| `backend/src/app.controller.spec.ts` | Existing scaffold assertions plus P9 composition, HTTP bootstrap, source-mount, and isolated native fixture smoke tests. This is the only P9-owned test file. |
| `frontend/src/App.tsx` | Mount existing ChatProvider/ChatView with optional injected ApiClient for future P10 tests. |
| `frontend/src/App.css` | Remove scaffold global selectors; retain only application shell sizing. |
| `frontend/src/main.tsx` | Preserve StrictMode and global CSS; explicitly reject a missing root element. |
| `README.md` | Exact local/staging startup, config/readiness/diagnostic distinctions, existing commands, remaining evidence gates. |

No additional source/test file is needed. Group related assembly tests in the owned existing spec rather than creating an unowned bootstrap spec or frontend App test.

## Inspected interface ledger

- `PlatformModule` exports `AURVIN_CONFIG` and `ServerIdentityResolver`; `loadConfig` owns all configuration/budgets. No frontend user/model/config secret props.
- P2 exports `openPersistence(config)` -> repositories, owner, checkpoints, ping, close. `owner.assertExecutor()` is readiness ownership proof. The factory claims its durable sentinel and sets up indexes/checkpointer once.
- P3 exports `loadFixedAssets(paths)` and `ReferencedContextAssembler`. Its immutable assets must be loaded before admitting work. This checkout's `nest-cli.json` does **not** copy markdown to `dist`; run from `backend/` with the source instruction file and root knowledge file deployed alongside the release.
- P4 exports `loadModelLimits(config, signal, fetcher)`; its bounded catalogue GET is not inference. No invented limits and no fallback model on failure.
- P5 exports `DurableChatRuntime` and `RuntimeDependencies`; supply observed P2 persistence, P3 assets/assembler, verified limits, and optional fixture fetcher.
- P6 exports `ChatHttpModule.registerAsync`, `configureChatHttp`, `ChatHttpService`, `ChatStreamTransport`, and `ChatHttpOptions`. Configure with `bodyParser:false` so default parsing cannot run before admission/size enforcement.
- P8 exports `OperationsService`, `OperationsModule.registerAsync`, `configureOperations`, `Telemetry`, `observePersistence`. `OperationsService.beforeApplicationShutdown()` already drains/stops/closes; **do not add a second database-closing lifecycle hook**.
- P7 public barrel exports ChatProvider/ChatView/ApiClient and imports existing chat CSS; the provider already constructs the client with `VITE_API_BASE` or `/api`.
- Nest bootstrap documentation checked through Context7 `/nestjs/docs.nestjs.com`: default Express parsing must be disabled for custom ordering; `app.close()` triggers awaited shutdown hooks. Validate Windows Ctrl-C/IPC behavior on the actual process; do not infer SIGTERM support.

## Task 1: Single dependency composition and coherent scaffold routes

**Files:** modify `backend/src/app.service.ts`, `backend/src/app.module.ts`, `backend/src/app.controller.ts`, `backend/src/app.controller.spec.ts`.

- [ ] **Step 1 — Retain the two existing greeting/health assertions; replace their setup with a diagnostic AppService and add these failing composition tests.** At the top of `app.controller.spec.ts`, keep Vitest globals and add the imports/helper below. Tests may import the proposed exports before they exist: the first run is expected to fail on that missing interface, not a network call.

```typescript
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { loadConfig } from './platform/config/load-config.js';
import { AURVIN_CONFIG } from './platform/tokens.js';
import { AppController } from './app.controller.js';
import { AppService, type AssemblyPorts } from './app.service.js';
import { AppModule } from './app.module.js';
import { OperationsService } from './operations/index.js';
import { ChatHttpService } from './http/index.js';
import { fixtureOptions } from '../test/http/fixtures.js';
import { loadFixedAssets } from './instructions/fixed-assets.js';
import { resolve } from 'node:path';

const paths = {
  instructions: resolve('src/instructions/system.md'),
  knowledge: resolve('../product_knowledge.md'),
};
async function diagnostic() {
  return AppService.create(loadConfig({}), { writeLog: () => undefined });
}

describe('AppController', () => {
  it('preserves the root greeting', async () => {
    const controller = new AppController(await diagnostic());
    expect(controller.getHello()).toBe('Hello from Aurvin');
  });
  it('keeps legacy health liveness-only', async () => {
    const service = await diagnostic();
    expect(new AppController(service).getHealth()).toEqual({ status: 'ok' });
    expect((await service.operations.readiness.read()).acceptReady).toBe(false);
    await service.operations.shutdown();
  });
});

describe('P9 assembly', () => {
  it('exports one operations instance and routes through its observed runtime', async () => {
    const service = await diagnostic();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppService).useValue(service).compile();
    expect(module.get(OperationsService)).toBe(service.operations);
    expect(module.get(ChatHttpService).o.runtime).toBe(service.operations.runtime);
    expect(module.get(ChatHttpService).o.sessions).toBe(service.sessions);
    await module.close();
  });
  it('does not open unverified persistence or probe the model', async () => {
    const open = vi.fn<AssemblyPorts['open']>();
    const limits = vi.fn<AssemblyPorts['limits']>();
    const service = await AppService.create(loadConfig({
      PERSISTENCE_PROFILE: 'cosmos-mongodb-ru', MONGODB_URI: 'fixture-only',
      OPENROUTER_API_KEY: 'fixture-key', OPENROUTER_MODEL: 'fixture/model',
    }), { open, limits, writeLog: () => undefined });
    expect(open).not.toHaveBeenCalled();
    expect(limits).not.toHaveBeenCalled();
    const ready = await service.operations.readiness.read();
    expect(ready.issues).toContain('unverified_persistence');
    await expect(Promise.resolve().then(() => service.sessions.list('user', { cursor: null, limit: 20 })))
      .rejects.toMatchObject({ code: 'NOT_READY' });
    await service.operations.shutdown();
  });
  it('fails before opening storage when required assets cannot load', async () => {
    const open = vi.fn<AssemblyPorts['open']>();
    await expect(AppService.create(loadConfig({}), {
      assets: async () => loadFixedAssets({ instructions: 'absent-p9-asset', knowledge: paths.knowledge }),
      open, writeLog: () => undefined,
    })).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(open).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 — Run the red test.** Working directory `backend`: `npx vitest run src/app.controller.spec.ts`. Expected FAIL: AppService.create/AssemblyPorts unavailable or composition assertions fail. Do not run with real `.env` secrets; these tests supply explicit configuration.
- [ ] **Step 3 — Replace `app.service.ts` implementation with this composition.** Default factory functions are production adapters; fixture ports are supplied only by tests/DI, never by an HTTP field or environment bypass.

```typescript
import { resolve } from 'node:path';
import type { SessionRepository, MessageRepository } from './contracts/repositories.js';
import { AppError } from './platform/errors/app-error.js';
import type { AurvinConfig } from './platform/config/load-config.js';
import type { ServerIdentityResolver } from './platform/identity/server-identity-resolver.js';
import { openPersistence } from './persistence/index.js';
import { loadFixedAssets, type FixedAssets } from './instructions/fixed-assets.js';
import { ReferencedContextAssembler } from './context/index.js';
import { loadModelLimits } from './model/index.js';
import { DurableChatRuntime, type ChatRuntime, type RuntimeDependencies } from './chat-runtime/index.js';
import { OperationsService, Telemetry, observePersistence } from './operations/index.js';
import type { ChatHttpOptions, ChatStreamTransport } from './http/index.js';

type OpenedPersistence = Awaited<ReturnType<typeof openPersistence>>;
export type AssemblyPorts = {
  open: typeof openPersistence;
  assets: () => Promise<FixedAssets>;
  limits: typeof loadModelLimits;
  runtime: (dependencies: RuntimeDependencies) => ChatRuntime;
  fetcher: typeof fetch;
  writeLog: (line: string) => void;
};

export class AppService {
  private opened: OpenedPersistence | null = null;
  private persistence: OpenedPersistence | null = null;
  private rawRuntime: ChatRuntime | null = null;
  private assetsOk = false;
  private limitsOk = false;
  private transport: ChatStreamTransport | null = null;
  readonly operations: OperationsService;
  readonly telemetry: Telemetry;
  private readonly ports: AssemblyPorts;

  readonly sessions: SessionRepository = {
    get: (u, s) => this.store().sessions.get(u, s),
    list: (u, p) => this.store().sessions.list(u, p),
    createIfAbsent: r => this.store().sessions.createIfAbsent(r),
    touchActivity: (u, s, at) => this.store().sessions.touchActivity(u, s, at),
  };
  readonly messages: MessageRepository = {
    append: r => this.store().messages.append(r),
    list: (u, s, p) => this.store().messages.list(u, s, p),
    get: (u, s, m) => this.store().messages.get(u, s, m),
    updateCompletion: (u, s, m, status, truncated) =>
      this.store().messages.updateCompletion(u, s, m, status, truncated),
  };

  private constructor(readonly config: AurvinConfig, overrides: Partial<AssemblyPorts>) {
    if (config.topology.executor !== 'single-process') {
      throw new AppError('UNSUPPORTED_TOPOLOGY', 'Only one executor is supported.');
    }
    if (new URL(config.frontendOrigin).origin !== config.frontendOrigin) {
      throw new AppError('CONFIGURATION_ERROR', 'Configure one exact frontend origin.');
    }
    this.ports = {
      open: openPersistence,
      assets: () => loadFixedAssets({
        instructions: resolve(process.cwd(), 'src/instructions/system.md'),
        knowledge: resolve(process.cwd(), '../product_knowledge.md'),
      }),
      limits: loadModelLimits,
      runtime: d => new DurableChatRuntime(d),
      fetcher: fetch,
      writeLog: line => { process.stdout.write(`${line}\n`); },
      ...overrides,
    };
    this.telemetry = new Telemetry(this.ports.writeLog);
    this.operations = new OperationsService({
      config, runtime: () => this.rawRuntime,
      assetsReady: () => this.assetsOk, modelLimitsReady: () => this.limitsOk,
      ping: () => this.opened?.ping() ?? Promise.resolve(false),
      assertExecutor: async () => { await this.store().owner.assertExecutor(); },
      closePersistence: async () => { await this.opened?.close(); },
      transportSnapshot: () => this.transport?.snapshot() ?? { active: 0, backpressured: 0 },
      writeLog: this.ports.writeLog,
    }, this.telemetry);
  }

  static async create(config: AurvinConfig, ports: Partial<AssemblyPorts> = {}) {
    const service = new AppService(config, ports);
    await service.initialize();
    return service;
  }
  private store(): OpenedPersistence {
    if (!this.persistence) throw new AppError('NOT_READY', 'Chat storage is unavailable.');
    return this.persistence;
  }
  private async initialize() {
    const assets = await this.ports.assets();
    this.assetsOk = true;
    if (this.config.persistence.profile !== 'native-mongodb' || !this.config.persistence.mongoUri) return;
    try {
      this.opened = await this.ports.open(this.config);
    } catch (error) {
      // A second/stale executor is a hard startup failure, not an unnoticed fallback.
      if (error instanceof AppError && error.code === 'UNSUPPORTED_TOPOLOGY') throw error;
      this.telemetry.event('readiness', { ok: false, code: 'NOT_READY' });
      return;
    }
    this.persistence = { ...observePersistence(this.opened, this.telemetry), close: this.opened.close };
    if (!this.config.openRouter.apiKey || !this.config.openRouter.modelId ||
        this.config.openRouter.dataCollection !== 'deny' || !this.config.openRouter.disableTransforms) return;
    let limits: Awaited<ReturnType<typeof loadModelLimits>>;
    try {
      limits = await this.ports.limits(this.config, new AbortController().signal, this.ports.fetcher);
    } catch {
      // Retain liveness and archive reads; no guessed limits or catalogue retry loop.
      this.telemetry.event('readiness', { ok: false, code: 'CONFIGURATION_ERROR' });
      return;
    }
    const assembler = new ReferencedContextAssembler({
      memory: this.persistence.memory, messages: this.persistence.messages,
      budgets: this.config.budgets, assets,
    });
    try {
      this.rawRuntime = this.ports.runtime({ config: this.config, persistence: this.persistence,
        assembler, assets, limits, fetcher: this.ports.fetcher });
      this.limitsOk = true;
    } catch {
      await this.operations.shutdown();
      throw new AppError('NOT_READY', 'Chat initialization failed.');
    }
  }
  attachTransport(transport: ChatStreamTransport) { this.transport = transport; }
  httpOptions(identity: ServerIdentityResolver): ChatHttpOptions {
    return { runtime: this.operations.runtime, sessions: this.sessions,
      messages: this.messages, identity, budgets: this.config.budgets };
  }
  getHello(): string { return 'Hello from Aurvin'; }
  getHealth(): { status: string } { return { status: 'ok' }; }
}
```

Lazy repository delegates only forward existing interfaces and fail closed when storage is absent; they are not an in-memory fallback. The unverified-storage assertion wraps its call in a Promise because a missing store fails synchronously before returning the repository Promise.

- [ ] **Step 4 — Replace `app.module.ts` with the complete shared composition.** No imaginary PersistenceModule/RuntimeModule and no circular operations/transport injection. The transport snapshot is attached during bootstrap after Nest constructs the HTTP providers.

```typescript
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PlatformModule } from './platform/platform.module.js';
import { AURVIN_CONFIG } from './platform/tokens.js';
import type { AurvinConfig } from './platform/config/load-config.js';
import { ServerIdentityResolver } from './platform/identity/server-identity-resolver.js';
import { ChatHttpModule } from './http/index.js';
import { OperationsModule } from './operations/index.js';

@Module({
  imports: [PlatformModule],
  providers: [{ provide: AppService, inject: [AURVIN_CONFIG],
    useFactory: (config: AurvinConfig) => AppService.create(config) }],
  exports: [AppService, PlatformModule],
})
class AssemblyModule {}

@Module({
  imports: [AssemblyModule,
    OperationsModule.registerAsync({ imports: [AssemblyModule], inject: [AppService],
      useFactory: (service: AppService) => ({ service: service.operations }) }),
    ChatHttpModule.registerAsync({ imports: [AssemblyModule], inject: [AppService, ServerIdentityResolver],
      useFactory: (service: AppService, identity: ServerIdentityResolver) => service.httpOptions(identity) }),
  ],
  controllers: [AppController],
})
export class AppModule {}
```

- [ ] **Step 5 — Keep both route bodies in `app.controller.ts`, changing injection explicitly.** This avoids relying on emitted constructor metadata in Vitest.

```typescript
import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(@Inject(AppService) private readonly appService: AppService) {}
  @Get()
  getHello(): string { return this.appService.getHello(); }
  @Get('health')
  getHealth(): { status: string } { return this.appService.getHealth(); }
}
```

- [ ] **Step 6 — Run green tests and type/build checks.** In `backend`: `npx vitest run src/app.controller.spec.ts`, then `npm run build`. Expected PASS; original `test/app.e2e-spec.ts` remains compatible in diagnostic configuration without editing that P10-owned file. If context/runtime export names differ, stop and reconcile with their owner rather than casting around the difference.
- [ ] **Step 7 — Commit this assembly slice.** From repository root:

```powershell
git add backend/src/app.service.ts backend/src/app.module.ts backend/src/app.controller.ts backend/src/app.controller.spec.ts
git commit -m "feat(p9): compose shared chat dependencies and diagnostic startup"
```

## Task 2: Bootstrap, bounded parser ordering, CORS and shutdown

**Files:** modify `backend/src/main.ts`, `backend/src/app.controller.spec.ts`.

- [ ] **Step 1 — Add the failing production-bootstrap HTTP test below to the existing spec, plus imports.** This deliberately calls the same configure function used by the listener, not a test-only copy.

```typescript
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApplication } from './main.js';

it('configures production admission before parsing and exposes diagnostic live/ready honestly', async () => {
  const service = await diagnostic();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppService).useValue(service).compile();
  const app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApplication(app);
  await app.init();
  try {
    const agent = request(app.getHttpServer());
    await agent.get('/api').expect(200).expect('Hello from Aurvin');
    await agent.get('/api/health').expect(200).expect({ status: 'ok' });
    await agent.get('/api/operations/live').expect(200);
    await agent.get('/api/operations/ready').expect(503);
    const blocked = await agent.post('/api/sessions').set('Content-Type', 'application/json')
      .send('{malformed').expect(503);
    expect(blocked.body.code).toBe('NOT_READY');
    expect(blocked.headers['cache-control']).toContain('no-store');
    expect(blocked.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    const allowed = await agent.options('/api/sessions')
      .set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST').expect(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    const other = await agent.get('/api/health').set('Origin', 'https://other.invalid').expect(200);
    expect(other.headers['access-control-allow-origin']).not.toBe('https://other.invalid');
  } finally { await app.close(); }
});
```

- [ ] **Step 2 — Run red.** `backend`: `npx vitest run src/app.controller.spec.ts`. Expected FAIL: configureApplication missing. Importing main must not start a listener/load `.env`; if it does, that is a bootstrap isolation defect to fix in Step 3.
- [ ] **Step 3 — Replace main's implementation with the following.** All environments bind loopback; protected staging uses the approved same-host gateway. No secret-bearing Nest exception logger, wildcard CORS, body-parser defaults, global raw provider errors, or URL-derived identity.

```typescript
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AppService } from './app.service.js';
import { ChatStreamTransport, configureChatHttp } from './http/index.js';
import { configureOperations } from './operations/index.js';

export function configureApplication(app: NestExpressApplication): void {
  const service = app.get(AppService);
  service.attachTransport(app.get(ChatStreamTransport));
  app.setGlobalPrefix('api');
  app.enableCors({ origin: service.config.frontendOrigin, credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'],
    exposedHeaders: ['X-Request-ID', 'Retry-After'] });
  configureOperations(app, service.operations);
  configureChatHttp(app, service.config.budgets);
}

export async function bootstrap(): Promise<NestExpressApplication> {
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false, logger: false, abortOnError: false,
  });
  try {
    configureApplication(app);
    app.enableShutdownHooks(process.platform === 'win32' ? ['SIGINT'] : ['SIGINT', 'SIGTERM']);
    await app.listen(app.get(AppService).config.port, '127.0.0.1');
    process.on('message', message => {
      if (message !== 'shutdown') return;
      void app.close().then(() => { if (process.connected) process.disconnect(); }, () => {
        process.exitCode = 1;
        process.stderr.write('Aurvin shutdown could not be confirmed.\n');
        if (process.connected) process.disconnect();
      });
    });
    return app;
  } catch {
    await app.close().catch(() => { process.exitCode = 1; });
    throw new Error('Aurvin startup failed.');
  }
}

// Nest's current start:prod uses extensionless dist/main; accept that entry too.
const entry = process.argv[1] ? resolve(process.argv[1]) : null;
if (entry && (fileURLToPath(import.meta.url) === entry || fileURLToPath(import.meta.url) === `${entry}.js`)) {
  try { await bootstrap(); }
  catch {
    process.exitCode = 1;
    process.stderr.write('Aurvin startup failed; check configuration and dependencies.\n');
  }
}
```

`logger:false` avoids default exception/stack output. Startup telemetry is through P8's allowlist only; the final stderr error is a constant. The external supervisor still owns the 45-second hard-stop and log rotation. `app.close()`/IPC and SIGINT must trigger P8's existing hook; do not call persistence.close directly from main.

- [ ] **Step 4 — Add negative configuration/shutdown assertions to the same spec.** The complete additional test code is:

```typescript
it('rejects unsupported topology and path-valued CORS configuration', async () => {
  expect(() => loadConfig({ AURVIN_EXECUTOR_TOPOLOGY: 'multi-replica' }))
    .toThrow('Invalid application configuration.');
  await expect(AppService.create(loadConfig({ FRONTEND_ORIGIN: 'https://stage.invalid/path' })))
    .rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
});
```

- [ ] **Step 5 — Run green and regressions.** `backend`: `npx vitest run src/app.controller.spec.ts`, `npm run test:e2e -- test/app.e2e-spec.ts test/operations/http.e2e-spec.ts test/http/routes.e2e-spec.ts`, `npm run build`, `npm run lint`. These named specs exist in the inspected checkout. Record actual results. No upstream edits to make a red regression disappear.
- [ ] **Step 6 — Commit.**

```powershell
git add backend/src/main.ts backend/src/app.controller.spec.ts
git commit -m "feat(p9): bootstrap bounded loopback HTTP and graceful shutdown"
```

## Task 3: Mount the existing chat feature without scaffold styling

**Files:** modify `frontend/src/App.tsx`, `frontend/src/App.css`, `frontend/src/main.tsx`; test in `backend/src/app.controller.spec.ts` (owned source-mount assertions only).

- [ ] **Step 1 — Add these failing assembly-boundary assertions to the owned backend spec.** These prove mounting and removal of the competing scaffold, not browser behavior; P7 tests and the browser check below supply separate evidence.

```typescript
import { readFileSync } from 'node:fs';
it('mounts the public chat boundary rather than the scaffold health screen', () => {
  const app = readFileSync(resolve('../frontend/src/App.tsx'), 'utf8');
  const css = readFileSync(resolve('../frontend/src/App.css'), 'utf8');
  const main = readFileSync(resolve('../frontend/src/main.tsx'), 'utf8');
  expect(app).toContain("from './features/chat/index.ts'");
  expect(app).toMatch(/<ChatProvider\s+client=\{client\}>/);
  expect(app).toContain('<ChatView />');
  expect(app).not.toMatch(/checkHealth|HealthResponse|React \+ NestJS|\/health/);
  expect(css).not.toMatch(/(?:^|\n)\s*(?:h1|code|\.page|\.status)\b/);
  expect(main).toContain('<StrictMode>');
  expect(main).toContain("if (!root) throw new Error('Aurvin root element is missing.')");
});
```

- [ ] **Step 2 — Run red.** `backend`: `npx vitest run src/app.controller.spec.ts`. Expected FAIL on the scaffold source-mount assertion.
- [ ] **Step 3 — Replace App.tsx body with this thin mount.** No new session/composer/stream logic, model selector, or client identity configuration.

```tsx
import { ChatProvider, ChatView, type ApiClient } from './features/chat/index.ts'
import './App.css'

function App({ client }: { client?: ApiClient } = {}) {
  return (
    <ChatProvider client={client}>
      <ChatView />
    </ChatProvider>
  )
}

export default App
```

- [ ] **Step 4 — Replace App.css with only application-level sizing.** The existing public feature barrel owns chat layout CSS; eliminate global `h1`/`code` styles that would restyle Markdown.

```css
#root {
  width: 100%;
  min-height: 100svh;
}
```

- [ ] **Step 5 — Keep the existing main.tsx imports/rendering and replace the non-null assertion with an explicit root check.** Complete body:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const root = document.getElementById('root')
if (!root) throw new Error('Aurvin root element is missing.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 6 — Run green and P7 regression checks.** `backend`: `npx vitest run src/app.controller.spec.ts`. `frontend`: `npm test`, `npm run build`, `npm run lint`. Expected all PASS with no server secrets. Because StrictMode can re-run effects in development, inspect that navigation bootstrap uses GET only; no session is created on initial mount or New Chat alone. If an existing P7 behavior defect appears, send it to P7 rather than removing StrictMode.
- [ ] **Step 7 — Browser-check the actual mounted app.** Run `npm run dev -- --host 127.0.0.1` in `frontend` as a managed/background dev server. Use the OpenChamber browser to open `http://localhost:5173`, snapshot desktop and mobile, and verify New Chat/sidebar/welcome/composer render rather than the health scaffold. With diagnostic backend, submit a synthetic prompt: useful unavailable state, draft retained, no duplicate POST on refresh. Inspect request/body/UI; do not paste credentials or real messages. This is a local UI check, not the native durable-chat smoke in Task 4 or P10's staging evidence.
- [ ] **Step 8 — Commit.**

```powershell
git add frontend/src/App.tsx frontend/src/App.css frontend/src/main.tsx backend/src/app.controller.spec.ts
git commit -m "feat(p9): mount existing chat experience at the application root"
```

## Task 4: Real assembled native fixture chat and lifecycle fault checks

**Files:** modify `backend/src/app.controller.spec.ts` only. Existing native/HTTP/model fixtures are read-only imports, not new fixture implementations.

- [ ] **Step 1 — Add this failing isolated native assembled smoke.** Do not put it in P10's test directories. Normal unit runs may skip it; **P9 completion may not**. Gate the smoke command before running it when isolated native configuration is absent. This test connects P2/P3/P4/P5/P6/P8 through AppModule and the production HTTP configuration, with only model HTTP replaced.

```typescript
import { nativeDatabase } from '../test/persistence/native.js';
import { createPersistenceBundle } from './persistence/index.js';
import { FRAMES } from '../test/fixtures/openrouter/frames.js';
import { submitTurnResponseSchema } from './contracts/api.js';

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI &&
  process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

nativeIt('P9 native assembled fixture chat completes and reopens its durable transcript', async () => {
  const db = await nativeDatabase();
  let app: NestExpressApplication | undefined;
  let service: AppService | undefined;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/models')) {
      return Response.json({ data: [{ id: 'fixture/model', context_length: 32768,
        top_provider: { max_completion_tokens: 4096 }, supported_parameters: ['max_tokens'] }] });
    }
    if (!String(url).endsWith('/chat/completions')) throw new Error('Unexpected fixture request');
    return new Response(FRAMES.normal, { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const config = loadConfig({ PERSISTENCE_PROFILE: 'native-mongodb',
      MONGODB_URI: 'fixture-injected-only', MONGODB_DB_NAME: db.name,
      OPENROUTER_API_KEY: 'fixture-key', OPENROUTER_MODEL: 'fixture/model' });
    service = await AppService.create(config, {
      fetcher, writeLog: () => undefined,
      open: async c => {
        const bundle = await createPersistenceBundle(db.client, db.name, c.budgets);
        return { ...bundle, close: async () => {
          await bundle.owner.drain(); await bundle.owner.releaseExecutor();
        } };
      },
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(config)
      .overrideProvider(AppService).useValue(service).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApplication(app); await app.init();
    const agent = request(app.getHttpServer());
    await agent.get('/api/operations/ready').expect(200);
    // Admission succeeds here: malformed JSON must reach the bounded safe parser.
    await agent.post('/api/sessions').set('Content-Type', 'application/json')
      .send('{malformed').expect(400);
    const accepted = submitTurnResponseSchema.parse((await agent.post('/api/sessions')
      .send({ sessionId: null, content: 'Synthetic P9 hello', idempotencyKey: 'p9-smoke-request-1' })
      .expect(202)).body);
    const streamed = await agent.get(`/api${accepted.streamPath}`).expect(200);
    expect(streamed.headers['content-type']).toContain('text/event-stream');
    expect(streamed.text).toContain('Hello 🌍');
    expect(streamed.text).toContain('"type":"completed"');
    const status = await agent.get(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}`).expect(200);
    expect(status.body.status).toBe('completed');
    const archive = await agent.get(`/api/sessions/${accepted.sessionId}/messages`).expect(200);
    expect(archive.body.items.map((m: { content: string }) => m.content))
      .toEqual(['Synthetic P9 hello', 'Hello 🌍']);
    const generations = calls.filter(c => c.method === 'POST');
    expect(generations).toHaveLength(1);
    expect(generations[0].body).toMatchObject({ user: 'aurvin-dev-user', model: 'fixture/model' });
    await agent.get('/api/operations/ready').expect(200);
    expect(calls.filter(c => c.url.endsWith('/models'))).toHaveLength(1);
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    await app.close(); app = undefined;
    expect(await service.operations.shutdown()).toEqual({ safe: true });
    // Client still connected in this test's close port; archive is durable after app close.
    const persisted = await db.db.collection('messages').find({
      userId: 'aurvin-dev-user', sessionId: accepted.sessionId,
    }).sort({ sequence: 1 }).toArray();
    expect(persisted.map(m => m.content)).toEqual(['Synthetic P9 hello', 'Hello 🌍']);
  } finally {
    if (app) await app.close();
    else if (service) await service.operations.shutdown();
    await db.close(); // Existing helper drops only the generated isolated test database.
  }
}, 60000);
```

The helper requires operator-supplied native replica-set URI and the exact prefix `aurvin_p2_test_`; never set it to application/production data. This smoke uses real checkpoints/finalization, not fake completed events. It checks durable reopen within the app and storage after clean close; crash/restart/context continuity certification stays P10-owned.

- [ ] **Step 2 — Run the native smoke command with its guard.** In `backend`, operator injects `AURVIN_TEST_MONGODB_URI` privately; do not echo it or put it in command-line arguments. Then:

```powershell
if (-not $env:AURVIN_TEST_MONGODB_URI -or $env:AURVIN_TEST_DB_PREFIX -ne 'aurvin_p2_test_') { throw 'P9 native smoke requires isolated native test configuration.' }
npx vitest run src/app.controller.spec.ts -t "P9 native assembled fixture chat"
```

Expected PASS with exactly **one executed native smoke**, real durable completion and no paid inference. During TDD, add the test before the final wiring correction and record its real red result if an assembly defect exists. Do not deliberately break already-correct assembly merely to fabricate a red test. If it passes immediately, document it as an integration regression addition; Tasks 1–3 provide the red/green cycles. If the environment is unavailable, record **blocked/not run** and hand off the precise missing isolated native target. Never count a skipped test as satisfying the exit gate.

- [ ] **Step 3 — Add deterministic failure/lifecycle tests with this typed composition helper.** Reuse the existing P6 runtime fixtures, but no fake claim of native durability. Add imports `type PersistenceBundle` and `AppError` only if the spec does not already import them. The non-runtime repository members below are structurally mocked solely for construction; the test runtime consumes none of them.

```typescript
import type { PersistenceBundle } from './persistence/index.js';
import { AppError } from './platform/errors/app-error.js';
import type { ChatRuntime, RuntimeDependencies } from './chat-runtime/index.js';

async function assembledFixture(failCatalogue = false) {
  const config = loadConfig({ PERSISTENCE_PROFILE: 'native-mongodb', MONGODB_URI: 'fixture-only',
    OPENROUTER_API_KEY: 'fixture-key', OPENROUTER_MODEL: 'fixture/model' });
  const http = fixtureOptions();
  const close = vi.fn(async () => undefined);
  const drain = http.runtime.drain;
  const unused = () => { throw new Error('Unused fixture port'); };
  // P9 tests need only bundle shape, readiness and P6 repository forwarding.
  const persistence = {
    sessions: http.sessions, messages: http.messages,
    memory: { get: unused, put: unused },
    metadata: { putAttempt: unused, getAttempt: unused, getAttemptByIdempotency: unused, putAccounting: unused },
    owner: { assertExecutor: vi.fn(async () => undefined) },
    checkpoints: { create: unused }, ping: vi.fn(async () => true), close,
  } as unknown as PersistenceBundle & { close: () => Promise<void> };
  // Deliberately scoped test-double cast: no production or real-runtime use.
  const limits = vi.fn(async () => {
    if (failCatalogue) throw new AppError('CONFIGURATION_ERROR', 'fixture catalogue unavailable');
    return { modelId: 'fixture/model', contextTokens: 32768, outputTokens: 4096,
      supportsMaxTokens: true, source: 'fixture' as const };
  });
  const runtime = vi.fn<(dependencies: RuntimeDependencies) => ChatRuntime>(() => http.runtime);
  const service = await AppService.create(config, {
    open: async () => persistence, limits, runtime, writeLog: () => undefined,
  });
  return { service, limits, runtime, close, drain, http };
}

it('keeps database reads and diagnostic liveness when catalogue verification fails', async () => {
  const f = await assembledFixture(true);
  expect(f.limits).toHaveBeenCalledTimes(1);
  expect(f.runtime).not.toHaveBeenCalled();
  const ready = await f.service.operations.readiness.read();
  expect(ready).toMatchObject({ live: true, readReady: true, acceptReady: false });
  expect(ready.issues).toContain('model_limits');
  expect(await f.service.sessions.list('server-user', { cursor: null, limit: 20 }))
    .toEqual({ items: [], nextCursor: null });
  await f.service.operations.shutdown();
  expect(f.close).toHaveBeenCalledTimes(1);
});
it('stops and drains the single runtime before closing persistence exactly once', async () => {
  const f = await assembledFixture();
  const order: string[] = [];
  vi.spyOn(f.http.runtime, 'stopAccepting').mockImplementation(() => { order.push('stop'); });
  vi.spyOn(f.http.runtime, 'drain').mockImplementation(async () => {
    order.push('drain'); return { drained: true, active: 0, unresolvedWrites: 0 };
  });
  f.close.mockImplementation(async () => { order.push('close'); });
  expect(f.runtime).toHaveBeenCalledTimes(1);
  expect(f.runtime.mock.calls[0][0].persistence.messages).not.toBe(f.http.messages);
  expect(f.service.operations.telemetry).toBe(f.service.telemetry);
  await Promise.all([f.service.operations.shutdown(), f.service.operations.shutdown()]);
  expect(order).toEqual(['stop', 'drain', 'close']);
});
it('retains persistence ownership when drain is unsafe', async () => {
  const f = await assembledFixture();
  vi.spyOn(f.http.runtime, 'drain').mockResolvedValue({ drained: false, active: 1, unresolvedWrites: 0 });
  expect(await f.service.operations.shutdown()).toEqual({ safe: false });
  expect(f.close).not.toHaveBeenCalled();
});
it('refuses a competing executor rather than silently booting a chat service', async () => {
  await expect(AppService.create(loadConfig({ PERSISTENCE_PROFILE: 'native-mongodb',
    MONGODB_URI: 'fixture-only' }), { open: async () => {
      throw new AppError('UNSUPPORTED_TOPOLOGY', 'fixture competing executor');
    }, writeLog: () => undefined })).rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
});
```

The helper's runtime spy declares its dependency argument so `mock.calls[0][0]` remains typed; no production interfaces are relaxed.

- [ ] **Step 4 — Add one ready-state parser ceiling assertion to the native smoke.** Immediately after the malformed JSON assertion, use:

```typescript
await agent.post('/api/sessions').send({ sessionId: null,
  content: 'x'.repeat(262145), idempotencyKey: 'p9-oversize-request' }).expect(413);
expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
```

- [ ] **Step 5 — Run all required local checks.** `backend`: `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`; `frontend`: `npm test`, `npm run build`, `npm run lint`. Native suites may require supplied environment; record executed/skipped counts separately. Do not run Azure or live behavior scripts as if they were unconditional checks. Re-run the guarded explicit native smoke and require one executed PASS.
- [ ] **Step 6 — Confirm listener and supported shutdown manually without inference.** From `backend`, temporarily use private local diagnostic configuration with no provider/storage credentials and `npm run start:prod`. `Invoke-RestMethod http://127.0.0.1:3000/api/operations/live` succeeds, ready returns 503, socket is loopback only (`Get-NetTCPConnection -LocalPort 3000 -State Listen`). Stop via Ctrl-C and record actual exit/elapsed time; test supervisor IPC `shutdown` only in an authorized local harness. These are actual process observations, not a claim that a Node/NGINX supervisor is provisioned. For invalid config start, stderr contains only the fixed startup message, not the invalid value/URI/key. Keep test changes in environment, not committed `.env`.
- [ ] **Step 7 — Fix only P9 assembly defects revealed by checks, repeating affected red/green tests; report upstream defects to owners. Then commit.**

```powershell
git add backend/src/app.controller.spec.ts backend/src/app.service.ts backend/src/app.module.ts backend/src/main.ts
git commit -m "test(p9): verify assembled fixture chat and lifecycle gates"
```

## Task 5: Accurate local and protected-staging startup guide

**Files:** modify root `README.md`; documentation guard in `backend/src/app.controller.spec.ts`.

- [ ] **Step 1 — Add a failing README consistency check to the owned spec.**

```typescript
it('documents actual setup and does not promise credential-free chat or Azure certification', () => {
  const readme = readFileSync(resolve('../README.md'), 'utf8');
  expect(readme).toContain('npm ci');
  expect(readme).toContain('Node 22.22.3+');
  expect(readme).toContain('diagnostic mode');
  expect(readme).toContain('/api/operations/ready');
  expect(readme).toContain('single-process');
  expect(readme).toContain('not certified');
  expect(readme).toContain('src/instructions/system.md');
  expect(readme).not.toContain('Defaults work without');
});
```

- [ ] **Step 2 — Run red.** `backend`: `npx vitest run src/app.controller.spec.ts`. Expected FAIL against the current Node-20/health-scaffold README.
- [ ] **Step 3 — Replace README content with the following guide, retaining only additional existing user material that is still accurate.** Commands below are PowerShell and each application's commands run in its named directory.

````markdown
# Aurvin

Persistent text chat with a React/Vite frontend and a NestJS/LangGraph backend using one server-configured OpenRouter model. Phase 1 provides sessions, durable history, streamed replies and explicit failed/cancelled/interrupted/truncated outcomes. No model picker, live MCP tools, compaction, retrieval or application authentication is enabled.

## Prerequisites

- Node 22.22.3+ in the Node 22 line, Node 24.15+ in the Node 24 line, or Node 26+; npm. The development PC used Node 24.18.0.
- For local durable chat: an operator-provided native MongoDB replica set, a private OpenRouter key and one model with verified context/output/max_tokens limits. Azure compatibility is not certified; do not relabel an unidentified Cosmos/DocumentDB service as native MongoDB.
- Exactly one `single-process` backend executor per database. No rolling overlap or automatic stale-sentinel takeover.

## Install

From the checkout root, using separate terminals or running the directory changes in order:

```powershell
Set-Location backend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

In a second terminal from the checkout root:

```powershell
Set-Location frontend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit the private backend `.env` locally; never commit it, print it in diagnostics, or put its secrets in command arguments. The frontend needs only `VITE_API_BASE=/api`. Never add MongoDB credentials, an OpenRouter key, user identity, or a model override as `VITE_*` settings.

## Backend configuration

| Setting | Meaning |
| --- | --- |
| `PORT=3000` | Backend port; listener binds `127.0.0.1`. |
| `FRONTEND_ORIGIN=http://localhost:5173` | One exact CORS origin, no path/trailing slash. CORS is not authentication. |
| `AURVIN_USER_ID=aurvin-dev-user` | Server-only development identity; all browser users share it. |
| `PERSISTENCE_PROFILE=native-mongodb` | Only currently admitted persistence profile for chat; `unknown`/Azure profiles remain diagnostic. |
| `MONGODB_URI`, `MONGODB_DB_NAME` | Private native replica-set URI and isolated application database name. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Server-only key and one exact operator-selected model ID. |
| `OPENROUTER_DATA_COLLECTION=deny` | Required admitted privacy policy. |
| `OPENROUTER_DISABLE_TRANSFORMS=true` | No automatic provider context compression. |
| `AURVIN_EXECUTOR_TOPOLOGY=single-process` | Required topology; other values fail validation. |

See [backend/.env.example](backend/.env.example) and [operations defaults](docs/aurvin-phase-1/operations.md) for finite budgets. Do not silently discard history at a context limit; start a new chat. Set upstream spending limits privately before any live model use.

## Run locally

Backend terminal, working directory `backend`:

```powershell
npm run start:dev
```

Frontend terminal, working directory `frontend`:

```powershell
npm run dev -- --host 127.0.0.1
```

Open http://localhost:5173. The Vite development proxy forwards `/api` to port 3000; changing the backend port also requires a P1-owned proxy configuration change. A New Chat does not save an empty session: the first accepted message creates it.

With blank external settings, the backend starts in **diagnostic mode** only: liveness works, readiness is 503, and chat is unavailable. Valid assets/configuration are still required. Database failure or unverified model limits cannot silently enable generation; catalogue verification failure retains diagnostic liveness/archive reads where storage is available. Configuration/assets errors and competing executor ownership fail startup. Inspect readiness, not a scaffold badge, to determine admission.

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/operations/live
Invoke-RestMethod http://127.0.0.1:3000/api/operations/ready
```

`/api` preserves the greeting and `/api/health` is legacy liveness only. `/api/operations/ready` is generation readiness, not a restart probe. Health does not generate a paid model request. Streamed tokens are provisional until durable terminal status; EOF alone is not completion. Retry is explicit and does not add another copy of the accepted user input. Cancellation is best effort and does not guarantee charge prevention.

## Build and start the backend release

Run from `backend/` in the full release checkout:

```powershell
npm run build
npm run start:prod
```

Keep `backend/src/instructions/system.md` and root `product_knowledge.md` beside the release in those exact checkout locations. The current Nest build does not package markdown into `dist`; copying only `dist/` is not a supported deployment. Frontend `npm run build` produces its static bundle; `npm run preview` is a local preview, not a protected staging server.

## Checks

| Directory | Commands |
| --- | --- |
| `backend` | `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e` |
| `frontend` | `npm run build`, `npm run lint`, `npm test` |

Native integration checks require operator-supplied `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; existing fixtures create and drop generated isolated databases. Never use application/production data. Provider responses are deterministic fixtures, not paid inference.

P9's explicit assembled native smoke, working directory `backend`:

```powershell
if (-not $env:AURVIN_TEST_MONGODB_URI -or $env:AURVIN_TEST_DB_PREFIX -ne 'aurvin_p2_test_') { throw 'Isolated native test configuration is required.' }
npx vitest run src/app.controller.spec.ts -t "P9 native assembled fixture chat"
```

`npm run test:azure` and `npm run test:behavior` exist but are separately gated service/behavior suites, not unconditional proof of Azure compatibility or authorization to spend. Report skips separately from executed passes.

## Protected staging and shutdown

Use the existing same-host authenticated gateway profile in [deployment/staging/nginx.conf](deployment/staging/nginx.conf) with separate staging credentials/database, a trusted certificate/private access boundary, and operator-controlled log rotation/supervision. Protect both static UI and API; do not expose the backend or Vite development server. No infrastructure has been provisioned by these files.

Follow [operations.md](docs/aurvin-phase-1/operations.md) for gateway configuration/streaming, privacy, bounded drain, stale-owner recovery, retention, backups and rollback; [staging-evidence.md](docs/aurvin-phase-1/staging-evidence.md) distinguishes actual results from unrun drills. Stop acceptance, drain, then close persistence via the operations service. Windows uses validated Ctrl-C or awaited supervisor IPC `shutdown`; do not assume SIGTERM. The external supervisor must bound process exit to 45 seconds. Do not restart from provider-driven readiness failure.

After an unsafe exit, do not delete the durable executor sentinel or retry ownership on lease expiry. Prove the old executor and its work are stopped and use the operator-only handoff/reconciliation procedure. No rolling overlap, automatic maintenance HTTP endpoint or exactly-once provider billing claim.

## Evidence and remaining gates

Local fixture/build results do not establish public-production readiness, selected Azure compatibility, authenticated gateway deployment, live-model privacy/cost behavior, proxy delivery, supervisor/log rotation, backup restore or rollback certification. These require the owning operations/integrated verification evidence. Public identity/access and production capacity/RPO/RTO remain unresolved. Unified review is explicitly **skipped**, not passed.

Approved requirements and ownership: [goal.md](docs/aurvin-phase-1/goal.md), [state.md](docs/aurvin-phase-1/state.md).
````

- [ ] **Step 4 — Run green documentation/assembly checks.** `backend`: `npx vitest run src/app.controller.spec.ts`. From root: `git diff --check`; verify all README relative links exist, commands match actual manifests, and no examples contain real secrets. Compare run-directory/asset claims with Task 1 and inspect `npm run start:prod` from `backend` rather than assuming a standalone dist works.
- [ ] **Step 5 — Commit only owned documentation/test files.**

```powershell
git add README.md backend/src/app.controller.spec.ts
git commit -m "docs(p9): document safe local and protected staging startup"
```

## Final P9 gate and orchestrator handoff

- [ ] Re-run backend/frontend build and lint, backend/frontend unit suites, backend e2e, and the guarded native assembled fixture smoke against the final commit set. Record command, working directory, environment, executed/skipped counts, warnings and failures. Azure/live checks not run remain explicitly unrun/blocked.
- [ ] Confirm one config/identity, one opened P2 bundle/owner, one immutable assets snapshot, one observed persistence layer, one raw P5 runtime, one P8 telemetry/operations instance, and P6 using the observed runtime. No duplicate close hook or default parser before admission.
- [ ] Verify liveness/readiness diagnostic behavior, actual loopback bootstrap and supported graceful close, exact CORS configuration, and mounted UI/browser checks. No credential/config/exception dumps.
- [ ] Verify a fixture-backed full P2–P8 chat terminal completion and durable transcript in the assembled native test. Without an isolated native target this gate is **blocked**, even if deterministic composition tests pass.
- [ ] Verify changed files are inside the nine owned paths and the plan; inspect `git diff --check`, `git status --short`, and `git log --oneline` for the actual commit range. Preserve unrelated changes and do not edit state/evidence files owned by the orchestrator/P10.
- [ ] Return the actual P9 commit set, paths, test results/limitations, browser/process evidence and readiness for P10. Review remains **skipped**. Do not mark the overall workflow complete: AC16, P10 and V remain separate required gates.

### Specification coverage self-check

| P9 obligation | Planned evidence |
| --- | --- |
| Goal §5 chat navigation/empty state/stream experience | Task 3 mounts unchanged P7 feature; P7 regressions + real UI mount check; Task 4 assembled streamed chat. |
| Goal §11 config/assets/privacy/input/redaction | Task 1 immutable assets/diagnostic config; Task 2 ordering/CORS/static bootstrap errors; Task 4 parser/privacy/attribution smoke. |
| Goal §11 readiness/degradation and shutdown | Task 2 production configuration + process observation; Task 4 catalogue/lifecycle failure tests; existing P8 operational guards retained. |
| Exported services connected once | Shared AssemblyModule provider + identity/config, observed persistence/runtime, one P8 instance and real native fixture. |
| Old scaffold routes/tests coherent | Greeting/legacy liveness preserved; original e2e spec remains read-only and is rerun. |
| Local/staging commands accurate, no topology/credential bypass | Task 5 full-checkout release guide, native-only profile, protected gateway and unresolved evidence boundaries. |
| Both builds/lints + fixture e2e exit gate | Task 4 explicit guard forbids counting a skip; final gate repeats actual checks. |

Plan verification is documentation/interface consistency checking only; none of the implementation/test snippets above are claimed executed by the planner.
