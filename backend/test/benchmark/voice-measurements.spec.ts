/**
 * ============================================================================
 * FILE: voice-measurements.spec.ts
 * LOCATION: backend/test/benchmark/voice-measurements.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify monotonic decoded onset gating, summaries and provenance fences.
 *
 * ROLE IN PROJECT:
 *    Deterministic offline checks; no SDK, clock or network dependency.
 *
 * KEY COMPONENTS:
 *    - DecodedReceipt boundary and rejection cases.
 *    - summarizeVoiceMetric warmup/missing semantics.
 *    - voiceProvenanceSchema secret and shape rejection.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { DecodedReceipt, projectVoiceProvenance,
  summarizeVoiceMetric } from '../../src/benchmark/voice-measurements.js';

it('gates onset on audio.start and the next decoded nonzero 24 kHz frame', () => {
  let now = 100;
  const receipt = new DecodedReceipt(100, () => now);
  receipt.inputStarted(200, 10);
  now = 205; receipt.frame(new Int16Array([4]), 24000, 1);
  now = 220; receipt.start('turn', 'response');
  now = 230; receipt.frame(new Int16Array([0, 0]), 24000, 1);
  expect(receipt.snapshot().firstAudioMs).toBeNull();
  now = 240; receipt.frame(new Int16Array([0, -1]), 24000, 1);
  now = 250; receipt.frame(new Int16Array([1]), 24000, 1);
  expect(receipt.snapshot()).toMatchObject({ firstAudioMs: 140,
    speechEndToFirstAudioMs: 30, preStartFrames: 1, decodedSamples: 5 });
});

it('rejects backwards clocks, wrong audio formats and invalid response reuse', () => {
  let now = 100;
  const receipt = new DecodedReceipt(100, () => now);
  receipt.inputStarted(100, 10);
  now = 120; receipt.start('t', 'r');
  expect(() => receipt.frame(new Int16Array([1]), 16000, 1)).toThrow('BENCHMARK_MEDIA_FAILED');
  expect(() => receipt.start('other', 'other')).toThrow('BENCHMARK_MEDIA_FAILED');
  now = 119;
  expect(() => receipt.frame(new Int16Array([1]), 24000, 1)).toThrow('BENCHMARK_MEDIA_FAILED');
});

it('does not use wall time or accept onset before the declared speech end', () => {
  const wall = vi.spyOn(Date, 'now').mockReturnValue(-999999);
  try {
    const receipt = new DecodedReceipt(0, () => 10);
    receipt.inputStarted(10, 100);
    receipt.start('t', 'r');
    expect(() => receipt.frame(new Int16Array([1]), 24000, 1)).toThrow('BENCHMARK_MEDIA_FAILED');
  } finally { wall.mockRestore(); }
});

it.each([
  ['non-finite rate', () => new DecodedReceipt(0, () => 10), (r: DecodedReceipt) => r.frame(new Int16Array([1]), NaN, 1)],
  ['infinite time', () => new DecodedReceipt(0, () => Infinity), (r: DecodedReceipt) => r.frame(new Int16Array([1]), 24000, 1)],
  ['two channels', () => new DecodedReceipt(0, () => 10), (r: DecodedReceipt) => r.frame(new Int16Array([1, 2]), 24000, 2)],
  ['empty frame', () => new DecodedReceipt(0, () => 10), (r: DecodedReceipt) => r.frame(new Int16Array([]), 24000, 1)],
  ['oversized frame', () => new DecodedReceipt(0, () => 10), (r: DecodedReceipt) => r.frame(new Int16Array(4801), 24000, 1)],
])('rejects %s', (_name, create, act) => {
  const receipt = create();
  receipt.inputStarted(0, 1);
  expect(() => { receipt.start('t', 'r'); act(receipt); }).toThrow('BENCHMARK_MEDIA_FAILED');
});

it('counts pre-start silence separately and refuses repeated input start', () => {
  const receipt = new DecodedReceipt(0, () => 0);
  receipt.frame(new Int16Array([1]), 24000, 1);
  receipt.inputStarted(0, 1);
  expect(() => receipt.inputStarted(1, 1)).toThrow('BENCHMARK_MEDIA_FAILED');
  expect(receipt.snapshot()).toMatchObject({ firstAudioMs: null, speechEndToFirstAudioMs: null,
    preStartFrames: 1, decodedSamples: 0 });
});

it('reuses nearest-rank summaries without dropping missing/failed measured rows', () => {
  const rows = [
    { warmup: true, outcome: 'success', setupMs: 999 },
    { warmup: false, outcome: 'success', setupMs: 10 },
    { warmup: false, outcome: 'success', setupMs: 20 },
    { warmup: false, outcome: 'success', setupMs: null },
    { warmup: false, outcome: 'timeout', setupMs: 1 },
  ];
  expect(summarizeVoiceMetric(rows, 'setupMs')).toEqual({ scenario: 'setupMs',
    samples: 4, succeeded: 2, failed: 2, p50Ms: 10, p95Ms: 20 });
});

it('uses nearest-rank p95 equal to the maximum of seven successful values', () => {
  const rows = [10, 20, 30, 40, 50, 60, 70].map(setupMs => ({ warmup: false,
    outcome: 'success', setupMs }));
  expect(summarizeVoiceMetric(rows, 'setupMs')).toMatchObject({ samples: 7, succeeded: 7,
    failed: 0, p50Ms: 40, p95Ms: 70 });
  expect(summarizeVoiceMetric([], 'setupMs')).toEqual({ scenario: 'setupMs',
    samples: 0, succeeded: 0, failed: 0, p50Ms: null, p95Ms: null });
});

it('rejects secret-shaped or unbounded metadata rather than exporting it', () => {
  for (const raw of [
    { participantToken: 'eyJhbGciOiJIUzI1NiJ9.private.signature' },
    { authorization: 'Bearer private' },
    { sourceHash: 'not-a-hash' },
    { backendPlacement: 'https://user:password@host/?token=private' },
  ]) expect(() => projectVoiceProvenance(raw)).toThrow('BENCHMARK_PROVENANCE_INVALID');
});

const safeProvenance = () => ({
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

it('accepts a full safe projection but rejects every extra secret field and token-shaped label', () => {
  expect(projectVoiceProvenance(safeProvenance()).inputBytes).toBe(183518);
  for (const key of ['participantToken', 'apiKey', 'apiSecret', 'authorization', 'uri',
    'transcript', 'audio', 'message', 'stack']) {
    expect(() => projectVoiceProvenance({ ...safeProvenance(), [key]: 'PRIVATE_FIXTURE' })).toThrow();
  }
  for (const backendPlacement of ['eyJhbGciOiJIUzI1NiJ9.eyJmb28iOiJiYXIifQ.c2lnbmF0dXJlMTIz',
    'https://user:password@host/?token=private']) {
    expect(() => projectVoiceProvenance({ ...safeProvenance(), backendPlacement })).toThrow();
  }
  expect(JSON.stringify(projectVoiceProvenance(safeProvenance()))).not.toMatch(/PRIVATE_FIXTURE|password|participantToken/);
});
