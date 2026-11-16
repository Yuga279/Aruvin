/**
 * ============================================================================
 * FILE: voice-comparison.spec.ts
 * LOCATION: backend/test/benchmark/voice-comparison.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify conservative comparison repair rules and WebRTC output fencing.
 *
 * ROLE IN PROJECT:
 *    Offline checks; no application, provider, database or historical artifact.
 *
 * KEY COMPONENTS:
 *    - Boundary/incomplete-run rejection matrix and signed deltas.
 *    - output fence and environment-hash identity tests.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compareVoiceRuns, claimVoiceRunOutput, voiceEnvironmentHash,
  type VoiceComparisonInput } from '../../src/benchmark/voice-comparison.js';
import type { VoiceProvenance } from '../../src/benchmark/voice-measurements.js';

function run(boundary = 'webrtc-decoded-nonzero-after-start-v1'): VoiceComparisonInput {
  return { runId: 'offline', mode: 'live', complete: true, repetitions: 3, warmups: 1,
    sourceHash: '1'.repeat(64), configurationHash: '2'.repeat(64),
    environmentHash: '3'.repeat(64), inputSha256: '4'.repeat(64), speechEndMs: 10,
    firstAudioBoundary: boundary, playbackBoundary: 'unproven',
    records: [999, 10, 20, 30].map((n, i) => ({ repetition: i, warmup: i === 0,
      outcome: 'success', setupMs: n, speechEndToFirstAudioMs: n,
      speechEndToPlaybackEndMs: null, durableCompletionMs: n })) };
}

it('does not manufacture a first-audio improvement across unlike transport boundaries', () => {
  const comparison = compareVoiceRuns(run('ws-pcm-receipt-v1'), run());
  expect(comparison.firstAudio).toMatchObject({ comparable: false,
    reason: 'incompatible-first-audio-boundary', deltaMs: null, deltaPercent: null });
  expect(comparison.setup).toMatchObject({ comparable: true, deltaMs: 0, deltaPercent: 0 });
  expect(comparison.durable).toMatchObject({ comparable: false,
    reason: 'durable-timing-includes-playback-boundary', deltaMs: null });
});

it('computes signed deltas for matched boundaries and leaves a zero baseline percentage null', () => {
  const before = run(), after = run();
  after.records = after.records.map((row, index) => ({ ...row,
    setupMs: index === 0 ? 999 : (row.setupMs ?? 0) + 5,
    speechEndToFirstAudioMs: index === 0 ? 999 : (row.speechEndToFirstAudioMs ?? 0) + 5,
    durableCompletionMs: index === 0 ? 999 : (row.durableCompletionMs ?? 0) + 5 }));
  const comparison = compareVoiceRuns(before, after);
  expect(comparison.firstAudio).toMatchObject({ deltaMs: 5, deltaPercent: 25, p95DeltaMs: 5 });
  expect(comparison.setup).toMatchObject({ deltaMs: 5, deltaPercent: 25 });
  const zeroBefore = run();
  zeroBefore.records = zeroBefore.records.map(row => ({ ...row, setupMs: 0 }));
  expect(compareVoiceRuns(zeroBefore, run()).setup).toMatchObject({ deltaMs: 20, deltaPercent: null });
});

it('allows a different source hash but records identity, and rejects different input/settings', () => {
  const before = run(), after = run();
  after.sourceHash = '5'.repeat(64);
  expect(() => compareVoiceRuns(before, after)).not.toThrow();
  after.inputSha256 = '5'.repeat(64);
  expect(() => compareVoiceRuns(before, after)).toThrow('BENCHMARK_RUNS_NOT_MATCHED');
  const sameSource = run();
  sameSource.configurationHash = '5'.repeat(64);
  expect(() => compareVoiceRuns(run(), sameSource)).toThrow('BENCHMARK_RUNS_NOT_MATCHED');
});

it.each(['input', 'marker', 'configuration', 'environment', 'incomplete', 'missing-row',
  'duplicate-row', 'warmup', 'failed', 'missing-onset', 'nonfinite', 'dry-run'])
('rejects an unmatched or incomplete %s run', defect => {
  const baseline = run(), current = run();
  if (defect === 'input') current.inputSha256 = '5'.repeat(64);
  if (defect === 'marker') current.speechEndMs = 11;
  if (defect === 'configuration') current.configurationHash = '5'.repeat(64);
  if (defect === 'environment') current.environmentHash = '5'.repeat(64);
  if (defect === 'incomplete') current.complete = false;
  if (defect === 'missing-row') current.records.pop();
  if (defect === 'duplicate-row') current.records[2].repetition = 1;
  if (defect === 'warmup') current.records[0].warmup = false;
  if (defect === 'failed') current.records[2].outcome = 'timeout';
  if (defect === 'missing-onset') current.records[2].speechEndToFirstAudioMs = null;
  if (defect === 'nonfinite') current.records[2].setupMs = NaN;
  if (defect === 'dry-run') current.mode = 'dry-run';
  expect(() => compareVoiceRuns(baseline, current)).toThrow('BENCHMARK_RUNS_NOT_MATCHED');
});

it('fences WebRTC output to fresh named leaves outside historical evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aurvin-p6-fence-'));
  const previous = process.cwd();
  try {
    const uuid = '00000000-0000-4000-8000-000000000000';
    await mkdir(join(root, 'benchmark-results', 'ws-live-2026-11-05'), { recursive: true });
    process.chdir(root);
    await expect(claimVoiceRunOutput('benchmark-results/ws-live-2026-11-05', uuid))
      .rejects.toThrow('BENCHMARK_OUTPUT_FENCED');
    await expect(claimVoiceRunOutput('benchmark-results/../ws-live-2026-11-05/runs', uuid))
      .rejects.toThrow('BENCHMARK_OUTPUT_FENCED');
    await expect(claimVoiceRunOutput(
      'benchmark-results/ws-live-2026-11-05/webrtc-live-nested/runs', uuid))
      .rejects.toThrow('BENCHMARK_OUTPUT_FENCED');
    const historical = join(root, 'benchmark-results', 'ws-live-2026-11-05');
    const link = join(root, 'benchmark-results', 'webrtc-live-link');
    await symlink(historical, link, 'junction');
    await expect(claimVoiceRunOutput(join(link, 'runs'), uuid))
      .rejects.toThrow('BENCHMARK_OUTPUT_FENCED');
    const claimed = await claimVoiceRunOutput('benchmark-results/webrtc-live-offline/runs', uuid);
    expect(claimed).toContain(uuid);
    expect((await readdir(claimed)).length).toBe(0);
    await expect(claimVoiceRunOutput('benchmark-results/webrtc-live-offline/runs', uuid)).rejects.toThrow();
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true });
  }
});

const provenance = (): VoiceProvenance => ({
  authorizationReference: 'offline-fixture', sourceHash: '1'.repeat(64), buildHash: '2'.repeat(64),
  configurationHash: '3'.repeat(64), instructionHash: '4'.repeat(64), productKnowledgeHash: '5'.repeat(64),
  inputSha256: '6'.repeat(64), inputBytes: 183518, speechEndMs: 3734.9375,
  scenario: 'voice-baseline', freshConversation: true, inputSampleRateHz: 16000, inputChannels: 1,
  inputFrameMs: 80, decodedSampleRateHz: 24000, decodedChannels: 1,
  codec: 'opus', rtpClockHz: 48000, requestedPacketMs: null, observedPacketMs: null,
  resampling: 'rtc-native-16k-to-opus-and-opus-to-24k', clientPlacement: 'loopback-host',
  backendPlacement: 'loopback-host', sfuPlacement: 'loopback-host', databasePlacement: 'fixture-region',
  providerRegion: 'us', rtcNodeVersion: '1.2.1', ffiVersion: '0.13.1',
  modelLabel: 'anthropic/claude-haiku-5.5', routingLabel: 'default', sttModel: 'flux-general-en',
  ttsModel: 'flux-haley-en', endpointingHash: '7'.repeat(64), limitsHash: '8'.repeat(64),
  impairment: 'none', playbackBoundary: 'unproven',
});

it('hashes explicit matching environment identity while excluding transport/SFU-only fields', () => {
  const base = provenance();
  expect(voiceEnvironmentHash(base)).toMatch(/^[a-f0-9]{64}$/);
  expect(voiceEnvironmentHash(base)).toBe(voiceEnvironmentHash({ ...base }));
  expect(voiceEnvironmentHash({ ...base, sfuPlacement: 'another-sfu' }))
    .toBe(voiceEnvironmentHash(base));
  expect(voiceEnvironmentHash({ ...base, backendPlacement: 'another-host' }))
    .not.toBe(voiceEnvironmentHash(base));
});
