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
 *    - Fresh build: Compile source once; serialize external builds with this suite.
 *    - Preload fixture: Inject deterministic assembly and cleanup failures.
 *    - Entry assertions: Known-code preservation and unknown-error secrecy.
 *    - Diagnostic HTTP: Live/not-ready separation and awaited IPC shutdown.
 * ============================================================================
 */

import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const backend = new URL('../../', import.meta.url);
const secret = 'mongodb://credential-marker:password@private.invalid sk-or-v1-secret-marker';
type Counts = { open: number; provider: number; close: number; shutdown: number };
type Result = { code: number | null; signal: NodeJS.Signals | null;
  stdout: string; stderr: string; counts: Counts };

// The compiled entry loads the whole backend module graph (Nest, MCP,
// LangGraph, Mongo driver): about 2.5s of CPU on an idle 16-core host, and
// proportionally more when the rest of the suite runs in parallel. These
// bounds therefore guard against a child that never finishes instead of
// against CPU contention: the child is still killed, the case still fails,
// and the same counters and diagnostics are still reported.
const CHILD_BOUND_MS = 60_000;
// Vitest must not abort a case before the fixture's own bound reports it.
const CASE_TIMEOUT_MS = 120_000;
// The beforeAll build competes with the same parallel load and amplifies
// super-linearly on this host: ~6s idle, ~44s at 1x CPU oversubscription and
// ~200s at 2x. The old 60s build bound therefore failed before any child was
// even started. This bound covers a contended build; a build that genuinely
// hangs still fails the file.
const BUILD_BOUND_MS = 600_000;
const BUILD_TIMEOUT_MS = 660_000;
// Loopback liveness must answer promptly; this still bounds a stalled server.
const LIVENESS_ABORT_MS = 10_000;

function parseCounts(stdout: string): Counts | null {
  const record = stdout.split(/\r?\n/u).find(line => line.startsWith('FIXTURE '));
  if (!record) return null;
  try { return JSON.parse(record.slice(8)) as Counts; }
  catch { return null; }
}

beforeAll(async () => {
  await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL('node_modules/@nestjs/cli/bin/nest.js', backend)), 'build',
  ], {
    cwd: fileURLToPath(backend), timeout: BUILD_BOUND_MS, windowsHide: true,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP, TMP: process.env.TMP },
  });
}, BUILD_TIMEOUT_MS);

function launch(mode: string, entry = 'dist/main.js') {
  const url = (path: string) => JSON.stringify(new URL(path, backend).href);
  const preload = `
    process.loadEnvFile = () => undefined;
    const { NestFactory } = await import(${url('node_modules/@nestjs/core/index.js')});
    const { AppService } = await import(${url('dist/app.service.js')});
    const { AppError } = await import(${url('dist/platform/errors/app-error.js')});
    const { loadBootstrapConfig } = await import(${url('dist/platform/config/bootstrap-config.js')});
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
      const config = loadBootstrapConfig(mode === 'owner' || mode === 'not-ready' ?
        { PERSISTENCE_PROFILE: 'native-mongodb', MONGODB_URI: 'mongodb://fixture.invalid' } : {});
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
      // Nest proxy methods resolve their targets at call time: do not overwrite
      // those targets then call a captured proxy method (that would recurse).
      const overrides = { close: async () => { counts.close++; const result = await app.close();
        if (mode === 'cleanup') throw new Error(secret); return result; } };
      if (mode === 'configure') overrides.setGlobalPrefix = () => { throw failure(); };
      if (mode === 'listen' || mode === 'cleanup') overrides.listen = async () => { throw failure(); };
      if (mode === 'diagnostic' || mode === 'not-ready') {
        overrides.listen = async (...values) => { const result = await app.listen(...values);
          setImmediate(() => process.send({ ready: true, port: app.getHttpServer().address().port }));
          return result; };
      }
      return new Proxy(app, { get: (target, key) => overrides[key] ?? target[key] });
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
  const started = Date.now();
  let readySeen = false;
  // Diagnostics describe process/transport state only, never exception text or fixture secrets.
  const diagnostics = (code: number | null, signal: NodeJS.Signals | null) => ({
    code, signal, elapsedMs: Date.now() - started, ready: readySeen,
    counts: parseCounts(stdout),
    stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr),
    moduleLoadFailure: /ERR_MODULE_NOT_FOUND|Cannot find module/u.test(stderr),
    startupDiagnostic: stderr.includes('Aurvin startup failed'),
    fatalRuntime: /FATAL ERROR|out of memory/u.test(stderr),
  });
  let resolveReady: (port: number) => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<number>((resolve, reject) => {
    resolveReady = resolve; rejectReady = reject;
  });
  void ready.catch(() => undefined);
  child.on('message', message => {
    const value = message as { ready?: boolean; port?: number } | null;
    if (value?.ready && typeof value.port === 'number') { readySeen = true; resolveReady(value.port); }
  });
  const done = new Promise<Result>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Only this fixture's owned, network-disabled child can be terminated.
      child.kill();
      const error = new Error(`Bootstrap fixture exceeded its ${CHILD_BOUND_MS / 1000}-second bound: ${JSON.stringify(diagnostics(null, null))}`);
      rejectReady(error); reject(error);
    }, CHILD_BOUND_MS);
    child.once('error', error => { clearTimeout(timer); rejectReady(error); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      rejectReady(new Error('Bootstrap fixture exited before diagnostic liveness.'));
      const counts = parseCounts(stdout);
      if (!counts) {
        reject(new Error(`Bootstrap fixture counters missing: ${JSON.stringify(diagnostics(code, signal))}`));
        return;
      }
      resolve({ code, signal, stdout, stderr, counts });
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
}, CASE_TIMEOUT_MS);

it.each(['configure', 'listen', 'cleanup'])(
  'preserves known code through %s failure and existing app cleanup', async mode => {
    const result = await launch(mode).done;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('[CONFIGURATION_ERROR]');
    expect(result.stdout + result.stderr).not.toMatch(/credential-marker|password@|secret-marker/u);
    expect(result.counts).toEqual({ open: 0, provider: 0, close: 1, shutdown: 1 });
  }, CASE_TIMEOUT_MS);

it.each(['unknown', 'forged'])('keeps %s errors generic and secret-safe', async mode => {
  const result = await launch(mode).done;
  expect(result.code).toBe(1);
  expect(result.stderr).toBe('Aurvin startup failed; check configuration and dependencies.\n');
  expect(result.stdout + result.stderr).not.toMatch(/credential-marker|password@|secret-marker/u);
  expect(result.counts).toEqual({ open: 0, provider: 0, close: 0, shutdown: 0 });
}, CASE_TIMEOUT_MS);

it.each([['diagnostic', 'dist/main.js'], ['not-ready', 'dist/main']])(
  'serves %s liveness through %s and awaits one operations IPC shutdown', async (mode, entry) => {
    const fixture = launch(mode, entry);
    try {
      const port = await fixture.ready;
      const live = await fetch(`http://127.0.0.1:${port}/api/operations/live`,
        { signal: AbortSignal.timeout(LIVENESS_ABORT_MS) });
      expect(live.status).toBe(200);
      await live.text();
      const ready = await fetch(`http://127.0.0.1:${port}/api/operations/ready`,
        { signal: AbortSignal.timeout(LIVENESS_ABORT_MS) });
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({ error: { code: 'NOT_READY' } });
    } finally {
      if (fixture.child.connected) fixture.child.send('shutdown');
      const result = await fixture.done;
      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe('');
      expect(result.counts).toEqual({ open: mode === 'not-ready' ? 1 : 0,
        provider: 0, close: 1, shutdown: 1 });
    }
  }, CASE_TIMEOUT_MS);
