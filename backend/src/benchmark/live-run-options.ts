/**
 * ============================================================================
 * FILE: live-run-options.ts
 * LOCATION: backend/src/benchmark/live-run-options.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Parse the fresh guarded WebRTC run identity and claim its output leaf.
 *
 * ROLE IN PROJECT:
 *    Pure argument/output safety for the one-shot driver. The approval
 *    reference is provenance, not proof of authorization.
 *
 * KEY COMPONENTS:
 *    - parseLiveRunOptions: rejects exhausted/default approval and extras.
 *    - claimLiveOutput: exclusive non-recursive new directory.
 * ============================================================================
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export function parseLiveRunOptions(args: string[]) {
  const transport = args.find(a => a.startsWith('--transport='))?.slice(12);
  const approvalReference = args.find(a => a.startsWith('--approval-reference='))?.slice(21);
  const outputName = args.find(a => a.startsWith('--output-name='))?.slice(14);
  if (!args.includes('--live') || !approvalReference ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(approvalReference) ||
    approvalReference === 'user-followup-2026-11-05') throw new Error('FRESH_APPROVAL_REQUIRED');
  if (transport !== 'webrtc' || !outputName || !/^webrtc-live-[A-Za-z0-9_-]{1,96}$/.test(outputName) ||
    args.length !== 4 || new Set(args).size !== 4 || args.some(a => a !== '--live' &&
      !a.startsWith('--transport=') && !a.startsWith('--approval-reference=') && !a.startsWith('--output-name=')))
    throw new Error('INVALID_LIVE_RUN_OPTIONS');
  return { transport, approvalReference, outputName } as const;
}

export async function claimLiveOutput(root: string, name: string) {
  if (!/^webrtc-live-[A-Za-z0-9_-]{1,96}$/.test(name)) throw new Error('INVALID_LIVE_RUN_OPTIONS');
  const directory = join(root, name);
  await mkdir(directory); // deliberately not recursive: exclusive leaf; EEXIST is fatal
  return directory;
}
