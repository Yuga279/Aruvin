# Safe backend launcher and startup diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Windows watch-reload ownership leaks and explain startup refusal safely while preserving fail-closed ownership and the existing launcher liveness gate.

**Architecture:** Build in the foreground once, then launch the compiled backend directly without a watch supervisor. Preserve typed application errors across bootstrap cleanup and print only allowlisted codes plus static instructions. Existing Nest/operations shutdown remains the only persistence-close owner; deterministic child processes and sandboxed batch execution test the boundaries without external services.

**Tech Stack:** Windows cmd, Node 24/ESM, NestJS 12, TypeScript NodeNext, existing Vitest 4 and HTTP fetch.

---

## Assignment and inspected evidence

- P1 implementation planning only; no recursive MAW, brainstorming, reviewer, implementation, staging, or commit. User approved goal through **“Fix, test, and recover.”** Unified review remains **skipped**.
- Read `goal.md` and `research.md` directly. P1 does not own compatibility suites, persistence admission/profile changes, service writes, recovery, environment edits, or sentinel maintenance.
- Parent work exists: modified `run.bat` and untracked `backend/test/operations/launcher.spec.ts`. Extend both in place; do not recreate, discard, or replace their liveness gate/test.
- `backend/package.json`: `build` is `nest build`; `start:dev` is `nest start --watch`; `start:prod` is `node dist/main`. `backend/tsconfig.build.json` roots compilation at `src`; actual output is `backend/dist/main.js`, not `dist/src/main.js`.
- Both source and current compiled `main` accept an exact `.js` entry and the extensionless `dist/main` entry. A safe `node --import <data preload> dist/main` probe disabled env loading and replaced `NestFactory.create` before entry execution: printed `SAFE_FACTORY_PROBE`, then the existing generic startup diagnostic, exit 1. No real factory, database, provider, or application was started. Preserve this extensionless production-entry support.
- Bootstrap env loading and factory creation occur before its cleanup `try`; configure/listen errors currently close the app and lose their `AppError` code. A factory rejection has no returned application to close. Do not invent a second persistence close path.
- Nest lifecycle docs confirm explicit `app.close()` invokes shutdown hooks and `enableShutdownHooks` handles supported signals: https://docs.nestjs.com/fundamentals/lifecycle-events. Installed Windows watch supervisor force-kill evidence is in `research.md`; no new watcher is needed.
- README's existing `app.controller.spec.ts` documentation assertion requires literal `npm ci`, which README currently lacks. `setup.bat` actually uses `npm install`, while `run.bat` conditionally uses `npm ci` when a package's dependency directory is absent. Document these facts without changing either installer.

## File map and ownership

| File | Change/responsibility |
| --- | --- |
| `run.bat` | Keep installations, environment creation, ports, and liveness gate; foreground checked build, then compiled direct Node command. |
| `backend/src/main.ts` | Preserve safe typed failure through cleanup; static allowlisted CLI diagnosis. Keep existing signal/IPC hooks and entry detection. |
| `backend/test/operations/launcher.spec.ts` | Retain parent's gate assertion, add launch-path assertions and sandboxed actual cmd control-flow checks. |
| `backend/test/operations/bootstrap.spec.ts` | One new focused behavioral regression file: actual compiled entry, deterministic assembly ports, cleanup/code preservation, unknown-error secrecy, diagnostic HTTP and awaited IPC shutdown. |
| `README.md` | Accurate install text, launcher/manual stop-build-restart instructions, no Windows persistent watch recommendation. |

Do not edit package scripts, config, persistence, operations, setup.bat, or other tests. All code files need the mandated FILE/LOCATION/PURPOSE/ROLE/KEY COMPONENTS header; existing `run.bat`/`main.ts` headers already exist and must stay accurate. The new spec's complete header is included below.

## Task 1: Regression checks for launch control flow

**Files:** Modify `backend/test/operations/launcher.spec.ts`; later modify `run.bat`.

- [ ] **Step 1: Extend the parent's existing spec (leave its first test unchanged).** Add imports `mkdtemp, mkdir, writeFile, rm` from `node:fs/promises`, `join` from `node:path`, `tmpdir` from `node:os`, and `execFile` from `node:child_process`. Keep its existing `readFile` import. Update header KEY COMPONENTS to mention direct build/run and sandboxed batch failure control flow. Append:

```typescript
it('builds once before starting the compiled backend without a watch supervisor', async () => {
  const launcher = await readFile(new URL('run.bat', root), 'utf8');
  const build = launcher.indexOf('call npm run build');
  const backend = launcher.indexOf('start "Aurvin backend"');
  expect(build).toBeGreaterThanOrEqual(0);
  expect(backend).toBeGreaterThan(build);
  expect(launcher.slice(build, backend)).toContain('Backend build failed.');
  expect(launcher.slice(build, backend)).toContain('exit /b 1');
  expect(launcher.split('call npm run build')).toHaveLength(2);
  expect(launcher).toContain('node --enable-source-maps dist/main.js');
  expect(launcher).not.toMatch(/npm run start:dev|nest start|--watch/u);
});

// Execute the real batch decisions, replacing only detached desktop START
// actions with harmless records. Fake npm/PowerShell cannot install or connect.
// ponytail: this fixture checks batch control flow, not desktop Ctrl-C delivery;
// a supervised Windows console drill is the upgrade path for that evidence.
describe.skipIf(process.platform !== 'win32')('launcher batch behavior', () => {
  async function launch(buildExit: number) {
    const parent = process.platform === 'win32' ? join(tmpdir(), 'opencode') : tmpdir();
    await mkdir(parent, { recursive: true });
    const dir = await mkdtemp(join(parent, 'aurvin-launcher-'));
    try {
      for (const name of ['backend', 'frontend', 'bin',
        'backend/node_modules', 'frontend/node_modules']) {
        await mkdir(join(dir, name), { recursive: true });
      }
      for (const name of ['backend/package.json', 'frontend/package.json']) {
        await writeFile(join(dir, name), '{}');
      }
      for (const name of ['backend/.env', 'frontend/.env']) {
        await writeFile(join(dir, name), '');
      }
      const log = join(dir, 'actions.log');
      const original = await readFile(new URL('run.bat', root), 'utf8');
      const sandbox = original.replace(/^start .+$/gmu, line => {
        const action = line.includes('Aurvin backend') ? 'backend' :
          line.includes('Aurvin frontend') ? 'frontend' : 'browser';
        return `echo ${action}>>"${log}"`;
      });
      await writeFile(join(dir, 'run.bat'), sandbox);
      await writeFile(join(dir, 'bin/npm.cmd'),
        `@echo off\r\necho build>>"${log}"\r\nexit /b ${buildExit}\r\n`);
      await writeFile(join(dir, 'bin/powershell.cmd'),
        `@echo off\r\necho liveness>>"${log}"\r\nexit /b 1\r\n`);
      const result = await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
        execFile(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'run.bat'], {
          cwd: dir, timeout: 10_000, windowsHide: true,
          env: { ...process.env, PATH: `${join(dir, 'bin')};${process.env.PATH ?? ''}` },
        }, (error, stdout) => {
          if (error && (!('code' in error) || typeof error.code !== 'number')) {
            reject(error);
            return;
          }
          resolve({ code: error ? Number(error.code) : 0, stdout });
        });
      });
      const actions = (await readFile(log, 'utf8').catch(() => ''))
        .trim().split(/\r?\n/u).filter(Boolean);
      return { ...result, actions };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('stops before backend or Vite launch when the foreground build fails', async () => {
    const result = await launch(7);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('Backend build failed.');
    expect(result.actions).toEqual(['build']);
  });

  it('stops before Vite and browser launch when backend liveness fails', async () => {
    const result = await launch(0);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('Backend did not respond to liveness');
    expect(result.actions).toEqual(['build', 'backend', 'liveness']);
  });
});
```

The recursive cleanup above is only the exact newly created fixture directory returned by `mkdtemp`, never checkout/application paths. Its Windows parent is the approved user's local temp `opencode` directory, derived portably rather than hardcoding a user path. Do not remove that shared parent.

- [ ] **Step 2: Record RED, working directory `backend/`:**

```powershell
npm test -- test/operations/launcher.spec.ts
```

Expected: existing gate test passes; new direct-build assertion and actual build-failure test fail against the watch launcher. The sandbox disables every desktop START and external npm/PowerShell action, so even RED does not launch configured services. If cmd resolves actual tools rather than stubs, stop and correct fixture PATH before continuing.

- [ ] **Step 3: Apply the smallest launcher change.** Immediately before `echo Starting backend ...`, insert:

```batch
echo Building backend...
pushd backend
call npm run build
if errorlevel 1 (
  popd
  echo Backend build failed.
  exit /b 1
)
popd
```

Replace only the backend START command with:

```batch
start "Aurvin backend" /D "%~dp0backend" cmd /k "set PORT=%BACKEND_PORT%&& set FRONTEND_ORIGIN=%FRONTEND_ORIGIN%&& node --enable-source-maps dist/main.js"
```

Update the header line `Backend window: npm run start:dev with PORT=8001` to `Backend window: compiled Node process with PORT=8001`. Keep the parent's complete liveness wait, bounded timeout/failure exit, frontend sequence, ports/origin, setup and browser behavior intact. Foreground compilation is outside the existing liveness timeout, rather than consuming that timeout before Node starts.

- [ ] **Step 4: Record GREEN:** rerun `npm test -- test/operations/launcher.spec.ts` from `backend/`. On Windows all four tests execute/pass. On other platforms report the two cmd tests skipped, never passed. Do not execute the actual checkout launcher against configured services as a routine regression.

## Task 2: Behavioral bootstrap regression before changing diagnostics

**Files:** Create `backend/test/operations/bootstrap.spec.ts`; later modify `backend/src/main.ts`.

- [ ] **Step 1: Create this complete focused spec.** It intentionally tests built modules; build first whenever production code changes. Preloading replaces env loading before entry, overrides actual `AppService.create` with explicit validated fixture config and forbidden network ports, and never opens a database. Source module unit mocking is unnecessary.

```typescript
/**
 * ============================================================================
 * FILE: bootstrap.spec.ts
 * LOCATION: backend/test/operations/bootstrap.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify secret-safe compiled startup diagnostics and graceful IPC shutdown.
 *
 * ROLE IN PROJECT:
 *    Runs the real entry and Nest assembly in owned disposable child processes.
 *    Explicit fixture config and disabled environment/network ports prevent
 *    configured database access or paid inference during routine regressions.
 *
 * KEY COMPONENTS:
 *    - Preload fixture: Inject deterministic assembly and cleanup failures.
 *    - Entry assertions: Known-code preservation and unknown-error secrecy.
 *    - Diagnostic HTTP: Live/not-ready separation and awaited IPC shutdown.
 * ============================================================================
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backend = new URL('../../', import.meta.url);
const secret = 'mongodb://credential-marker:password@private.invalid sk-or-v1-secret-marker';
type Counts = { open: number; provider: number; close: number; shutdown: number };
type Result = { code: number | null; signal: NodeJS.Signals | null;
  stdout: string; stderr: string; counts: Counts };

function launch(mode: string, entry = 'dist/main.js') {
  const url = (path: string) => JSON.stringify(new URL(path, backend).href);
  const preload = `
    process.loadEnvFile = () => undefined;
    const { NestFactory } = await import(${url('node_modules/@nestjs/core/index.js')});
    const { AppService } = await import(${url('dist/app.service.js')});
    const { AppError } = await import(${url('dist/platform/errors/app-error.js')});
    const { loadConfig } = await import(${url('dist/platform/config/load-config.js')});
    const mode = ${JSON.stringify(mode)};
    const secret = ${JSON.stringify(secret)};
    const counts = { open: 0, provider: 0, close: 0, shutdown: 0 };
    process.once('exit', () => process.stdout.write('FIXTURE ' + JSON.stringify(counts) + '\\n'));
    const forbidden = async () => { counts.provider++; throw new Error(secret); };
    globalThis.fetch = forbidden;
    const failure = () => mode === 'unknown' ? new Error(secret) :
      mode === 'forged' ? Object.assign(new Error(secret), { code: 'UNSUPPORTED_TOPOLOGY' }) :
      new AppError(mode === 'owner' ? 'UNSUPPORTED_TOPOLOGY' : 'CONFIGURATION_ERROR', secret);
    const createService = AppService.create.bind(AppService);
    AppService.create = async () => {
      if (mode === 'unknown' || mode === 'forged') throw failure();
      const config = loadConfig(mode === 'owner' || mode === 'not-ready' ?
        { MONGODB_URI: 'mongodb://fixture.invalid' } : {});
      config.port = 0;
      const service = await createService(config, {
        open: async () => { counts.open++;
          throw mode === 'owner' ? failure() : new AppError('NOT_READY', secret); },
        fetcher: forbidden, limits: forbidden, writeLog: () => undefined,
      });
      const shutdown = service.operations.shutdown.bind(service.operations);
      service.operations.shutdown = async () => { counts.shutdown++; return shutdown(); };
      return service;
    };
    const create = NestFactory.create.bind(NestFactory);
    NestFactory.create = async (...args) => {
      const app = await create(...args);
      const close = app.close.bind(app);
      app.close = async () => { counts.close++; const result = await close();
        if (mode === 'cleanup') throw new Error(secret); return result; };
      if (mode === 'configure') app.setGlobalPrefix = () => { throw failure(); };
      if (mode === 'listen' || mode === 'cleanup') app.listen = async () => { throw failure(); };
      if (mode === 'diagnostic' || mode === 'not-ready') {
        const listen = app.listen.bind(app);
        app.listen = async (...values) => { const result = await listen(...values);
          setImmediate(() => process.send({ ready: true, port: app.getHttpServer().address().port }));
          return result; };
      }
      return app;
    };
  `;
  const child = spawn(process.execPath, ['--enable-source-maps', '--import',
    `data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`, entry], {
    cwd: fileURLToPath(backend),
    // No application/test environment or NODE_OPTIONS reaches the child.
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP, TMP: process.env.TMP },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  let resolveReady: (port: number) => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<number>((resolve, reject) => {
    resolveReady = resolve; rejectReady = reject;
  });
  void ready.catch(() => undefined);
  child.on('message', message => {
    const value = message as { ready?: boolean; port?: number } | null;
    if (value?.ready && typeof value.port === 'number') resolveReady(value.port);
  });
  const done = new Promise<Result>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Only this fixture's owned, network-disabled child can be terminated.
      child.kill();
      const error = new Error('Bootstrap fixture exceeded its 10-second bound.');
      rejectReady(error); reject(error);
    }, 10_000);
    child.once('error', error => { clearTimeout(timer); rejectReady(error); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      rejectReady(new Error('Bootstrap fixture exited before diagnostic liveness.'));
      const record = stdout.split(/\r?\n/u).find(line => line.startsWith('FIXTURE '));
      if (!record) { reject(new Error('Bootstrap fixture counters missing.')); return; }
      resolve({ code, signal, stdout, stderr, counts: JSON.parse(record.slice(8)) as Counts });
    });
  });
  void done.catch(() => undefined);
  return { child, ready, done };
}

it('explains existing-owner refusal without leaking exception data', async () => {
  const result = await launch('owner').done;
  expect(result.code).toBe(1);
  expect(result.signal).toBeNull();
  expect(result.stderr).toContain('[UNSUPPORTED_TOPOLOGY]');
  expect(result.stderr).toContain('Verify the previous executor and its work are stopped');
  expect(result.stderr).toContain('docs/aurvin-phase-1/operations.md');
  expect(result.stderr).toContain('do not delete the sentinel');
  expect(result.stdout + result.stderr).not.toMatch(/credential-marker|password@|secret-marker/u);
  expect(result.counts).toEqual({ open: 1, provider: 0, close: 0, shutdown: 0 });
}, 15_000);

it.each(['configure', 'listen', 'cleanup'])(
  'preserves known code through %s failure and existing app cleanup', async mode => {
    const result = await launch(mode).done;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('[CONFIGURATION_ERROR]');
    expect(result.stdout + result.stderr).not.toMatch(/credential-marker|password@|secret-marker/u);
    expect(result.counts).toEqual({ open: 0, provider: 0, close: 1, shutdown: 1 });
  }, 15_000);

it.each(['unknown', 'forged'])('keeps %s errors generic and secret-safe', async mode => {
  const result = await launch(mode).done;
  expect(result.code).toBe(1);
  expect(result.stderr).toBe('Aurvin startup failed; check configuration and dependencies.\n');
  expect(result.stdout + result.stderr).not.toMatch(/credential-marker|password@|secret-marker/u);
  expect(result.counts).toEqual({ open: 0, provider: 0, close: 0, shutdown: 0 });
}, 15_000);

it.each([['diagnostic', 'dist/main.js'], ['not-ready', 'dist/main']])(
  'serves %s liveness through %s and awaits one operations IPC shutdown', async (mode, entry) => {
    const fixture = launch(mode, entry);
    try {
      const port = await fixture.ready;
      const live = await fetch(`http://127.0.0.1:${port}/api/operations/live`,
        { signal: AbortSignal.timeout(2_000) });
      expect(live.status).toBe(200);
      await live.text();
      const ready = await fetch(`http://127.0.0.1:${port}/api/operations/ready`,
        { signal: AbortSignal.timeout(2_000) });
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({ acceptReady: false });
    } finally {
      if (fixture.child.connected) fixture.child.send('shutdown');
      const result = await fixture.done;
      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe('');
      expect(result.counts).toEqual({ open: mode === 'not-ready' ? 1 : 0,
        provider: 0, close: 1, shutdown: 1 });
    }
  }, 15_000);
```

The process-fixture tests use `15_000` so the fixture's own 10-second timeout, not Vitest's default 5-second timeout, owns cleanup. The fixture uses the real asset loader and real Nest operations hook; it does not emulate durable ownership release or prove an unsafe drain can be overridden.

- [ ] **Step 2: Record RED, each command separately from `backend/`:**

```powershell
npm run build
npm test -- test/operations/bootstrap.spec.ts
```

Expected: build succeeds; owner and configure/listen/cleanup code assertions fail against the generic CLI diagnostic. Generic/forged and diagnostic/NOT_READY/IPC cases should already pass. If preload resolution, fixture counters, or HTTP setup fail first, repair the fixture before treating that as regression evidence. No compile/import error qualifies as the intended RED.

## Task 3: Minimal safe bootstrap diagnostic fix

**Files:** Modify `backend/src/main.ts`; test `backend/test/operations/bootstrap.spec.ts`.

- [ ] **Step 1: Add these imports beside existing local imports:**

```typescript
import { APP_ERROR_CODES } from './contracts/errors.js';
import { AppError } from './platform/errors/app-error.js';
```

- [ ] **Step 2: Replace only the inner bootstrap catch.** Preserve existing close and exit-code behavior; cleanup failure must not overwrite the originating known code:

```typescript
  } catch (error) {
    await app.close().catch(() => { process.exitCode = 1; });
    if (error instanceof AppError) throw error;
    throw new Error('Aurvin startup failed.');
  }
```

No application returned from factory creation means no application-close attempt in that path. Existing lower-layer assembly cleanup continues to own its resources. Do not call persistence close or ownership release from `main.ts`.

- [ ] **Step 3: Replace only the entry catch with an allowlisted/static diagnostic:**

```typescript
  catch (error) {
    process.exitCode = 1;
    const code = error instanceof AppError && APP_ERROR_CODES.includes(error.code)
      ? error.code : null;
    const guidance = code === 'UNSUPPORTED_TOPOLOGY'
      ? 'Executor ownership/topology refused. Verify the previous executor and its work are stopped, then follow docs/aurvin-phase-1/operations.md; do not delete the sentinel or retry takeover.'
      : 'check configuration and dependencies.';
    process.stderr.write(`Aurvin startup failed${code ? ` [${code}]` : ''}; ${guidance}\n`);
  }
```

Known codes come only from the shared allowlist and an `AppError`, not arbitrary objects or raw strings. Never print `error.message`, stack, cause, `toClientBody()`, config, env, credentials, or captured private data. `UNSUPPORTED_TOPOLOGY` also represents other topology constraints, so the message says ownership/topology and does not assert every instance is a stale owner. Other known codes get the existing static generic instruction plus safe code. Unknown and forged errors retain the exact old generic fallback.

Keep `enableShutdownHooks`, existing IPC listener, `logger: false`, `abortOnError: false`, `.env` handling, loopback binding and both entry checks untouched. Update the header KEY COMPONENTS with `Startup diagnostic: allowlisted failure code and static operator guidance`; no new abstraction, formatter export, watcher, or close owner.

- [ ] **Step 4: Record GREEN, from `backend/`:**

```powershell
npm run build
npm test -- test/operations/bootstrap.spec.ts test/operations/launcher.spec.ts
npm run test:e2e -- test/app.e2e-spec.ts
```

Expected: eight focused bootstrap cases, four launcher cases on Windows, and the existing three diagnostic e2e cases pass. The two admitted entry paths are exercised; provider-call counters remain zero; only the fake owner/NOT_READY paths increment the overridden open counter. IPC waits for actual operations shutdown, not a timer or forced exit.

Windows `child.kill('SIGINT')` is not a trustworthy graceful console-signal test and must not be described as such. This plan uses the supported awaited IPC path. Ctrl-C delivery and durable release against a real database are separate operational evidence owned by recovery/integrated verification, not certified here. Preserve existing signal handling unchanged.

## Task 4: Minimal README corrections and broader deterministic checks

**Files:** Modify `README.md`; reuse `backend/src/app.controller.spec.ts` without editing it.

- [ ] **Step 1: Record the existing documentation RED from `backend/`:**

```powershell
npm test -- src/app.controller.spec.ts -t "documents actual setup"
```

Expected: fails because README does not contain `npm ci`. Do not weaken the assertion or rewrite unrelated installation scripts to make it pass.

- [ ] **Step 2: After the existing Install paragraph append:**

```markdown
`setup.bat` uses `npm install` in each package. For a clean lockfile installation, run `npm ci` separately in `backend/` and `frontend/`; this replaces that package's dependency directory. `run.bat` uses `npm ci` only when a package's `node_modules` directory is absent.
```

- [ ] **Step 3: At the start of Run locally add launcher guidance, and replace only the backend terminal code block:**

```markdown
On Windows, run [`run.bat`](run.bat) from the checkout root. It builds the backend once, starts compiled Node directly on `127.0.0.1:8001`, waits for `/api/operations/live`, then starts Vite and opens `http://127.0.0.1:5179`. Failed compilation or backend liveness stops frontend launch; liveness is not generation readiness.

For backend edits, stop the existing backend with Ctrl-C and wait for graceful shutdown, then build and restart. Do not run overlapping executors. The persistent Windows backend launcher deliberately avoids Nest watch mode: watch reload force-kills the child and can leave its durable executor sentinel. Closing/killing the console is not a confirmed graceful stop; after an unsafe exit, use the operations recovery procedure below, not sentinel deletion.
```

Backend terminal block, still working directory `backend`:

```powershell
npm run build
node --enable-source-maps dist/main.js
```

Keep the manual frontend block and default `3000`/`5173` explanation distinct from launcher `8001`/`5179`. Do not imply the launcher changes `.env`, automatically fixes ownership, verifies Azure, or admits chat. Keep the release `npm run start:prod` block: its extensionless entry remains supported and now has a focused process regression. Keep the full-checkout Markdown asset requirement. Compatibility/admitted-service wording elsewhere is another owner's work; do not refactor it here.

- [ ] **Step 4: Record GREEN and broad deterministic verification from `backend/`:**

```powershell
$keys = @('AURVIN_TEST_MONGODB_URI', 'AURVIN_TEST_DB_PREFIX',
  'AURVIN_AZURE_TEST_URI', 'AURVIN_AZURE_TEST_DB_NAME',
  'AURVIN_AZURE_TEST_FACTS_JSON', 'AURVIN_AZURE_TEST_AUTHORIZED',
  'AURVIN_LIVE_SMOKE', 'AURVIN_P10_LOAD')
$saved = @{}
foreach ($key in $keys) {
  $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
  [Environment]::SetEnvironmentVariable($key, $null, 'Process')
}
try {
  npm test -- src/app.controller.spec.ts -t "documents actual setup"
  if ($LASTEXITCODE -ne 0) { throw 'README regression failed.' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
  npm run lint
  if ($LASTEXITCODE -ne 0) { throw 'Backend lint failed.' }
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'Backend routine tests failed.' }
  npm run test:e2e
  if ($LASTEXITCODE -ne 0) { throw 'Backend e2e tests failed.' }
} finally {
  foreach ($key in $keys) {
    [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process')
  }
}
```

Native fixture suites skip when their env is absent; report that honestly. The script temporarily disables the exact inspected native/Azure/live/load gates in the command process and restores them without displaying values; it does not alter `.env`. These keys were found in `test/persistence/native.ts`, `test/compatibility/persistence.azure.spec.ts`, `test/evaluations/live.behavior.spec.ts`, the integration specs and `src/app.controller.spec.ts`. P1 must not invoke `test:azure`, live provider tests, or any configured application/bootstrap outside these disabled-port children. If a broad test unexpectedly requires external service admission, report that check blocked/skipped rather than supply application credentials.

Frontend code is unchanged; frontend build/lint/test are not required for this ownership slice. Integrated verification can run them separately. Report exact commands, executed/skipped counts, Node/platform, intended RED then GREEN assertions, and remaining limits; do not claim database recovery or full startup restoration from these tests.

## Serialized commit handoff (orchestrator only)

- [ ] Return the plan to the orchestrator without staging or committing it. Suggested plan commit path is only `docs/backend-startup-fix/plan1.md`.
- [ ] Implementation owner reports completion and proposes these exact implementation paths for the orchestrator's serialized staging/commit:

```powershell
git add -- run.bat README.md backend/src/main.ts backend/test/operations/launcher.spec.ts backend/test/operations/bootstrap.spec.ts
git commit -m "fix: launch backend without watch kills and explain startup refusal"
```

The worker must not run this shared-index commit unless the orchestrator explicitly grants its commit slot. Parent's original launcher changes are part of these jointly owned launcher paths; confirm with the orchestrator before staging them. Never `git add .`; preserve unrelated work and local config. A green diagnostic correction is distinct from the separate compatibility/recovery gate.

## Plan self-check / acceptance mapping

- Goal design 1 / acceptance launcher gate: Task 1 foreground build, explicit compiled entry, preserved liveness gate and actual cmd failure decisions; README explicit stop/build/restart.
- Goal design 2 / acceptance safe diagnosis: Tasks 2–3 owner refusal, known codes through configure/listen and failing cleanup, generic unknown/forged errors, no payload/secret serialization; normal shutdown single owner.
- Preserve normal diagnostic startup: real Nest assembly, NOT_READY open failure, HTTP live=200/ready=503, no paid/provider activity; exact `.js` and extensionless production entry regressions.
- Goal design 3–5, history preservation, compatibility, reconciliation and restoring serving: **not P1 ownership**. No sentinel/database/profile/env mutation, inference or service test in this plan; hand off to owning plans before any real restart.
- README literal `npm ci` restored factually without installer changes; full-checkout asset packaging remains accurate.
- Headers, expected RED/GREEN, exact owned paths and serialized commit handoff included. Review remains **skipped**. Limitations: sandbox records desktop START actions rather than opening windows; IPC verifies a real diagnostic process but not Ctrl-C console delivery or durable DB release; no live/service evidence.
