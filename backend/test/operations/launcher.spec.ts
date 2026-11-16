/**
 * ============================================================================
 * FILE: launcher.spec.ts
 * LOCATION: backend/test/operations/launcher.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Ensure the local launcher waits for backend liveness before starting Vite.
 *
 * ROLE IN PROJECT:
 *    Guards the developer launch sequence against proxying API requests before
 *    the backend has bound its configured port.
 *
 * KEY COMPONENTS:
 *    - Backend readiness gate: Appears between backend and frontend startup.
 *    - Failure handling: Stops launch if backend liveness does not arrive.
 *    - Watch launch: Checked build then nest start --watch.
 * ============================================================================
 */

import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';

const root = new URL('../../../', import.meta.url);

it('waits for backend liveness before starting the frontend', async () => {
  const launcher = await readFile(new URL('run.bat', root), 'utf8');
  const backendStart = launcher.indexOf('start "Aurvin backend"');
  const backendReadyCheck = launcher.indexOf('/api/operations/live');
  const frontendStart = launcher.indexOf('start "Aurvin frontend"');

  expect(backendStart).toBeGreaterThanOrEqual(0);
  expect(backendReadyCheck).toBeGreaterThan(backendStart);
  expect(frontendStart).toBeGreaterThan(backendReadyCheck);

  const readinessGate = launcher.slice(backendReadyCheck, frontendStart);
  expect(readinessGate).toContain('Backend did not respond to liveness');
  expect(readinessGate).toContain('exit /b 1');
});

it('builds once then starts the backend with nest watch', async () => {
  const launcher = await readFile(new URL('run.bat', root), 'utf8');
  const build = launcher.indexOf('call npm run build');
  const backend = launcher.indexOf('start "Aurvin backend"');
  expect(build).toBeGreaterThanOrEqual(0);
  expect(backend).toBeGreaterThan(build);
  expect(launcher.slice(build, backend)).toContain('Backend build failed.');
  expect(launcher.slice(build, backend)).toContain('exit /b 1');
  expect(launcher.split('call npm run build')).toHaveLength(2);
  expect(launcher).toContain('npm run start:dev');
  expect(launcher).not.toContain('node --enable-source-maps dist/main.js');
});

// Replace desktop START with records; stub npm/PowerShell cannot install or connect.
// ponytail: sandbox checks batch decisions, not console Ctrl-C delivery;
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
      }).replace(/^powershell /gmu, 'call powershell ');
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
