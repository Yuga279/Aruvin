/**
 * ============================================================================
 * FILE: readme.spec.ts
 * LOCATION: backend/test/assembly/readme.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify root README documentation contracts for voice modes and proxy setup.
 *
 * ROLE IN PROJECT:
 *    Ensures README accurately documents default-off voice flags, server keys,
 *    Vite WebSocket proxying, operations runbook references, unrun device spikes,
 *    and forbids client-side VITE_ voice secrets.
 *
 * KEY COMPONENTS:
 *    - README assertion tests: validates required configuration and gate guidance.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const readme = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../README.md'), 'utf8');

it('documents default-off voice flags, the server key, and the same-origin socket proxy', () => {
  expect(readme).toContain('ENABLE_DICTATION_MODE');
  expect(readme).toContain('ENABLE_LIVE_VOICE_MODE');
  expect(readme).toContain('DEEPGRAM_API_KEY');
  expect(readme).toContain('ws: true');
  expect(readme).toContain('docs/voice-modes/operations.md');
  expect(readme).toContain('Browser, network, and authorization gates remain unrun');
  expect(readme).toContain('Do not enable either voice flag from this README.');
  expect(readme).toContain('no public rollout is approved');
  expect(readme).toContain('primary desktop and mobile capture/playback spike is unrun');
  expect(readme).not.toMatch(/VITE_DEEPGRAM|VITE_ENABLE_LIVE|VITE_ENABLE_DICTATION/);
});
