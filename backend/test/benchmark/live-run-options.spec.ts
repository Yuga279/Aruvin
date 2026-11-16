/**
 * ============================================================================
 * FILE: live-run-options.spec.ts
 * LOCATION: backend/test/benchmark/live-run-options.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify fresh-approval parsing and non-overwriting output claims.
 *
 * ROLE IN PROJECT:
 *    Offline checks; only private temporary directories are created.
 *
 * KEY COMPONENTS:
 *    - parseLiveRunOptions rejection/acceptance cases.
 *    - claimLiveOutput exclusive leaf behavior.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseLiveRunOptions, claimLiveOutput } from '../../src/benchmark/live-run-options.js';

it('refuses exhausted/default approval and protects the historical directory', () => {
  expect(() => parseLiveRunOptions(['--live'])).toThrow('FRESH_APPROVAL_REQUIRED');
  expect(() => parseLiveRunOptions(['--live', '--transport=webrtc',
    '--approval-reference=user-followup-2026-11-05',
    '--output-name=webrtc-live-offline'])).toThrow('FRESH_APPROVAL_REQUIRED');
  for (const path of ['ws-live-2026-11-05', '../ws-live-2026-11-05', 'webrtc-live-x/../ws-live-2026-11-05']) {
    expect(() => parseLiveRunOptions(['--live', '--transport=webrtc',
      '--approval-reference=offline-fixture', `--output-name=${path}`])).toThrow();
  }
  expect(() => parseLiveRunOptions(['--live', '--transport=webrtc',
    '--approval-reference=offline-fixture', '--output-name=webrtc-live-offline', '--force'])).toThrow();
  expect(parseLiveRunOptions(['--live', '--transport=webrtc',
    '--approval-reference=offline-fixture', '--output-name=webrtc-live-2026-11-05-offline']))
    .toEqual({ transport: 'webrtc', approvalReference: 'offline-fixture',
      outputName: 'webrtc-live-2026-11-05-offline' });
});

it('claims only a new leaf and never overwrites existing evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aurvin-p6-output-'));
  try {
    const directory = await claimLiveOutput(root, 'webrtc-live-2026-11-05-offline');
    await writeFile(join(directory, 'sentinel.txt'), 'retain');
    await expect(claimLiveOutput(root, 'webrtc-live-2026-11-05-offline')).rejects.toThrow();
    expect(await readFile(join(directory, 'sentinel.txt'), 'utf8')).toBe('retain');
  } finally { await rm(root, { recursive: true }); } // only this test-created temp root
});
