/**
 * ============================================================================
 * FILE: local-guard.spec.ts
 * LOCATION: backend/test/operations/local-guard.spec.ts
 * PURPOSE: Prove OS exclusion and crash release without network/service access.
 * ROLE IN PROJECT: Only kills child processes created by this test.
 * KEY COMPONENTS: Windows named mutex lifecycle; foreign/live/PID-reuse refusal.
 * ============================================================================
 */
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { acquireLocalGuard, inspectLocalProcess } from '../../src/operations/local-guard.js';

it.skipIf(process.platform !== 'win32')('excludes duplicate live owners and releases after an owned parent is killed', async () => {
  const key=randomUUID();
  const script=fileURLToPath(new URL('../../src/operations/local-guard.ps1',import.meta.url));
  // Owned Node fixture parent holds a separate parent-linked mutex child.
  const parent=spawn(process.execPath,['-e',
    `const {spawn}=require('node:child_process');
     const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',process.env.AURVIN_FIXTURE_SCRIPT,
       '-ParentPid',String(process.pid),'-GuardHash',process.env.AURVIN_FIXTURE_KEY],{stdio:['pipe','pipe','pipe']});
     child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
     child.on('exit',code=>process.exit(code ?? 1)); setInterval(()=>{},1000);`],
    { env:{ ...process.env,AURVIN_FIXTURE_SCRIPT:script,AURVIN_FIXTURE_KEY:key },stdio:['pipe','pipe','pipe'] });
  try {
    await new Promise<void>((resolve,reject) => {
      parent.stdout.on('data',b => { if (String(b).includes('READY ')) resolve(); });
      parent.on('exit',() => reject(new Error('Fixture guard failed.')));
      parent.on('error',reject);
    });
    await expect(acquireLocalGuard(key)).rejects.toMatchObject({ code:'UNSUPPORTED_TOPOLOGY' });
    const exited=once(parent,'exit'); parent.kill(); await exited;
    const guard=await acquireLocalGuard(key);
    guard.assertHeld(); await guard.close();
    const next=await acquireLocalGuard(key); await next.close();
  } finally { if (parent.exitCode === null) parent.kill(); }
},20000);

it.skipIf(process.platform !== 'win32')('unexpected helper death fails closed without leaving this process admitted', async () => {
  const key=randomUUID(); let lost=false;
  const guard=await acquireLocalGuard(key,() => { lost=true; });
  try {
    const { stdout }=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      `Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' AND CommandLine LIKE '%${key}%'" | Select-Object -ExpandProperty ProcessId`],
      { timeout:5000,windowsHide:true,maxBuffer:4096 });
    const helperPid=Number(String(stdout).trim().split(/\s+/).find(value => /^\d+$/.test(value)));
    expect(Number.isSafeInteger(helperPid) && helperPid > 0).toBe(true);
    await promisify(execFile)('taskkill.exe',['/PID',String(helperPid),'/F'],{ timeout:5000,windowsHide:true });
    await vi.waitFor(() => { expect(lost).toBe(true); });
    expect(() => guard.assertHeld()).toThrow();
  } finally { await guard.close(); }
},20000);

it.skipIf(process.platform !== 'win32')('checks exact creation lifetime and refuses PID reuse/foreign machine', async () => {
  const guard=await acquireLocalGuard(randomUUID());
  try {
    expect(await inspectLocalProcess(guard,guard.machineHash)).toBe('live');
    expect(await inspectLocalProcess({ ...guard,creation:'1' },guard.machineHash)).toBe('reused');
    await expect(inspectLocalProcess(guard,'f'.repeat(64))).rejects.toMatchObject({ code:'NOT_READY' });
  } finally { await guard.close(); }
},15000);
