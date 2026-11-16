/**
 * ============================================================================
 * FILE: local-guard.ts
 * LOCATION: backend/src/operations/local-guard.ts
 * PURPOSE: Acquire Windows OS lifetime exclusion before any database admission.
 * ROLE IN PROJECT: Parent-linked mutex holder; loss is fatal by default so a
 *    process never continues database work after losing its local guard.
 * KEY COMPONENTS: acquireLocalGuard; explicit close after database cleanup.
 * ============================================================================
 */
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { z } from 'zod';
import { AppError } from '../platform/errors/app-error.js';

export async function inspectLocalProcess(previous:{ machineHash:string; pid:number; creation:string },machineHash:string) {
  const fail=() => new AppError('NOT_READY','Exact local process lifetime could not be verified.');
  if (process.platform !== 'win32' || previous.machineHash !== machineHash ||
      !Number.isSafeInteger(previous.pid) || previous.pid < 1 || !/^[0-9]{1,20}$/.test(previous.creation)) throw fail();
  try {
    const { stdout }=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-File',
      resolve(process.cwd(),'src/operations/local-guard.ps1'),'-ParentPid',String(previous.pid),
      '-ExpectedCreation',previous.creation],{ timeout:5000,maxBuffer:1024,windowsHide:true });
    const state=stdout.trim();
    if (state === 'dead' || state === 'live' || state === 'reused') return state;
    throw fail();
  } catch { throw fail(); }
}

export async function acquireLocalGuard(guardHash:string, onLost:() => void = () => process.exit(1)) {
  if (process.platform !== 'win32' || !/^[a-zA-Z0-9-]{1,64}$/.test(guardHash))
    throw new AppError('UNSUPPORTED_TOPOLOGY','Windows local lifetime exclusion is unavailable.');
  const installationHash=createHash('sha256').update(await realpath(process.cwd())).digest('hex');
  // Like fixed Markdown assets, this script is retained in the full checkout.
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',
    resolve(process.cwd(),'src/operations/local-guard.ps1'),'-ParentPid',String(process.pid),'-GuardHash',guardHash],
    { stdio:['pipe','pipe','ignore'],windowsHide:true });
  let closing=false; let ready=false; let ended=false;
  const exit=new Promise<void>(resolveExit => child.once('exit',() => { ended=true; resolveExit(); if (ready && !closing) onLost(); }));
  const fail=() => new AppError('UNSUPPORTED_TOPOLOGY','Local lifetime exclusion could not be acquired.');
  const identity=await new Promise<{ machineHash:string; pid:number; creation:string }>((resolveReady,reject) => {
    let text='';
    const timer=setTimeout(() => { closing=true; child.kill(); reject(fail()); },5000);
    const rejectReady=() => { clearTimeout(timer); reject(fail()); };
    child.once('error',rejectReady); child.once('exit',rejectReady);
    child.stdout.on('data',chunk => {
      text+=String(chunk);
      if (text.length > 1024) { closing=true; child.kill(); rejectReady(); return; }
      if (!text.includes('\n')) return;
      try {
        const parsed=z.object({ machine:z.string().uuid(),pid:z.literal(process.pid),
          creation:z.string().regex(/^[0-9]{1,20}$/) }).strict().parse(JSON.parse(text.trim().replace(/^READY /,'')));
        ready=true; clearTimeout(timer);
        resolveReady({ machineHash:createHash('sha256').update(parsed.machine.toLowerCase()).digest('hex'),
          pid:parsed.pid,creation:parsed.creation });
      } catch { closing=true; child.kill(); rejectReady(); }
    });
  });
  return {
    ...identity,guardHash,installationHash,
    assertHeld() { if (ended || closing) throw fail(); },
    async close() { if (closing) { await exit; return; } closing=true; if (!ended) child.stdin.end('x'); await exit; },
  };
}
