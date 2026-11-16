/**
 * ============================================================================
 * FILE: voice-comparison.ts
 * LOCATION: backend/src/benchmark/voice-comparison.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compare normalized transport-labelled runs and fence new WebRTC output.
 *
 * ROLE IN PROJECT:
 *    Offline artifact validation only; launches no application, provider or
 *    database. Incomplete or boundary-incompatible runs are refused.
 *
 * KEY COMPONENTS:
 *    - voiceComparisonInputSchema / compareVoiceRuns.
 *    - voiceEnvironmentHash: explicit matching identity, SFU excluded.
 *    - claimVoiceRunOutput: new leaf only, canonical historical fence.
 *    - Guarded CLI entry point for comparison.json/comparison.md.
 * ============================================================================
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { summarizeVoiceMetric, type VoiceProvenance } from './voice-measurements.js';

export type VoiceComparisonInput = {
  runId: string;
  mode: 'live' | 'dry-run';
  complete: boolean;
  repetitions: number;
  warmups: number;
  sourceHash: string;
  configurationHash: string;
  inputSha256: string;
  speechEndMs: number;
  environmentHash: string;
  firstAudioBoundary: string;
  playbackBoundary: string;
  records: Array<{ repetition: number; warmup: boolean; outcome: string;
    setupMs: number | null; speechEndToFirstAudioMs: number | null;
    speechEndToPlaybackEndMs: number | null; durableCompletionMs: number | null }>;
};

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const elapsed = z.number().finite().nonnegative().max(900000).nullable();
export const voiceComparisonInputSchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), mode: z.enum(['live', 'dry-run']),
  complete: z.boolean(), repetitions: z.number().int().min(1).max(10),
  warmups: z.number().int().min(0).max(2), sourceHash: hash, configurationHash: hash,
  inputSha256: hash, speechEndMs: z.number().finite().positive().max(60000), environmentHash: hash,
  firstAudioBoundary: z.enum(['ws-pcm-receipt-v1', 'webrtc-decoded-nonzero-after-start-v1']),
  playbackBoundary: z.enum(['ws-simulated-24k-v1', 'unproven']),
  records: z.array(z.object({ repetition: z.number().int().min(0).max(11), warmup: z.boolean(),
    outcome: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), setupMs: elapsed,
    speechEndToFirstAudioMs: elapsed, speechEndToPlaybackEndMs: elapsed,
    durableCompletionMs: elapsed }).strict()).max(12),
}).strict();

const validNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
function completeRun(run: VoiceComparisonInput) {
  const expected = run.repetitions + run.warmups;
  return run.mode === 'live' && run.complete && run.repetitions >= 1 && expected <= 12 &&
    run.records.length === expected && run.records.every((row, index) =>
      row.repetition === index && row.warmup === (index < run.warmups) && row.outcome === 'success' &&
      validNumber(row.setupMs) && validNumber(row.speechEndToFirstAudioMs) && validNumber(row.durableCompletionMs));
}
export function compareVoiceRuns(before: VoiceComparisonInput, after: VoiceComparisonInput) {
  if (!voiceComparisonInputSchema.safeParse(before).success ||
    !voiceComparisonInputSchema.safeParse(after).success || !completeRun(before) || !completeRun(after) ||
    ['configurationHash', 'environmentHash', 'inputSha256', 'speechEndMs', 'repetitions', 'warmups']
      .some(key => before[key as keyof VoiceComparisonInput] !== after[key as keyof VoiceComparisonInput]))
    throw new Error('BENCHMARK_RUNS_NOT_MATCHED');
  const metric = (name: string, comparable: boolean, reason: string | null) => {
    const a = summarizeVoiceMetric(before.records, name), b = summarizeVoiceMetric(after.records, name);
    const deltaMs = comparable && a.p50Ms !== null && b.p50Ms !== null ? b.p50Ms - a.p50Ms : null;
    const p95DeltaMs = comparable && a.p95Ms !== null && b.p95Ms !== null ? b.p95Ms - a.p95Ms : null;
    return { comparable, reason, before: a, after: b, deltaMs,
      deltaPercent: deltaMs !== null && a.p50Ms !== 0 ? deltaMs * 100 / a.p50Ms! : null,
      p95DeltaMs, p95DeltaPercent: p95DeltaMs !== null && a.p95Ms !== 0 ? p95DeltaMs * 100 / a.p95Ms! : null };
  };
  const same = before.firstAudioBoundary === after.firstAudioBoundary;
  const samePlayback = before.playbackBoundary === after.playbackBoundary && before.playbackBoundary !== 'unproven';
  return { firstAudio: metric('speechEndToFirstAudioMs', same, same ? null : 'incompatible-first-audio-boundary'),
    setup: metric('setupMs', true, null),
    durable: metric('durableCompletionMs', samePlayback, samePlayback ? null : 'durable-timing-includes-playback-boundary'),
    limitations: ['Nearest-rank p95 is exploratory for this small sample; it is not a stable tail estimate.',
      'Matching input does not eliminate provider routing/cache variability or prove a transport-caused gain.',
      'No headless field measures browser/device audibility.'] };
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
export function voiceEnvironmentHash(provenance: VoiceProvenance): string {
  const matching = {
    clientPlacement: provenance.clientPlacement,
    backendPlacement: provenance.backendPlacement,
    databasePlacement: provenance.databasePlacement,
    providerRegion: provenance.providerRegion,
    instructionHash: provenance.instructionHash,
    productKnowledgeHash: provenance.productKnowledgeHash,
    scenario: provenance.scenario,
    freshConversation: provenance.freshConversation,
    locale: 'en-US',
    modelLabel: provenance.modelLabel,
    routingLabel: provenance.routingLabel,
    sttModel: provenance.sttModel,
    ttsModel: provenance.ttsModel,
    endpointingHash: provenance.endpointingHash,
    limitsHash: provenance.limitsHash,
    inputSampleRateHz: provenance.inputSampleRateHz,
    inputChannels: provenance.inputChannels,
    inputFrameMs: provenance.inputFrameMs,
    decodedSampleRateHz: provenance.decodedSampleRateHz,
    decodedChannels: provenance.decodedChannels,
    impairment: provenance.impairment,
  };
  return createHash('sha256').update(stable(matching)).digest('hex');
}

export function environmentVerified(provenance: VoiceProvenance): boolean {
  return [provenance.clientPlacement, provenance.backendPlacement,
    provenance.databasePlacement, provenance.providerRegion].every(value => value !== 'unverified');
}

const WEBRTC_OUTPUT = /^webrtc-live-[A-Za-z0-9_-]{1,96}$/;
const HISTORICAL = ['ws-live-2026-11-05', 'ws-baseline-2026-11-05'];
const fold = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
const inside = (parent: string, child: string) => {
  const relation = relative(fold(parent), fold(child));
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
};
async function canonical(path: string) {
  let existing = path;
  const suffix: string[] = [];
  for (;;) {
    try { await access(existing); break; } catch {
      const parent = dirname(existing);
      if (parent === existing) throw new Error('BENCHMARK_OUTPUT_FENCED');
      suffix.unshift(basename(existing));
      existing = parent;
    }
  }
  return join(await realpath(existing), ...suffix);
}

/** Claims a fresh run leaf under a canonically fenced WebRTC output root. */
export async function claimVoiceRunOutput(outputDirectory: string, runId: string): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId))
    throw new Error('BENCHMARK_OUTPUT_FENCED');
  const root = resolve(outputDirectory);
  if (!(basename(root) === 'runs' && WEBRTC_OUTPUT.test(basename(dirname(root))))
    && !WEBRTC_OUTPUT.test(basename(root))) throw new Error('BENCHMARK_OUTPUT_FENCED');
  const target = await canonical(root);
  if (!(basename(target) === 'runs' && WEBRTC_OUTPUT.test(basename(dirname(target))))
    && !WEBRTC_OUTPUT.test(basename(target))) throw new Error('BENCHMARK_OUTPUT_FENCED');
  const baselineRoot = resolve('benchmark-results');
  for (const name of HISTORICAL) {
    if (inside(await canonical(resolve(baselineRoot, name)), target))
      throw new Error('BENCHMARK_OUTPUT_FENCED');
  }
  await mkdir(target, { recursive: true });
  const directory = join(target, runId);
  await mkdir(directory);
  return directory;
}

function renderComparison(comparison: ReturnType<typeof compareVoiceRuns>): string {
  const row = (label: string, metric: typeof comparison.setup) => `| ${label} | ${metric.comparable} | ` +
    `${metric.before.p50Ms?.toFixed(1) ?? 'N/A'} | ${metric.after.p50Ms?.toFixed(1) ?? 'N/A'} | ` +
    `${metric.deltaMs?.toFixed(1) ?? 'N/A'} | ${metric.deltaPercent?.toFixed(1) ?? 'N/A'} | ` +
    `${metric.p95DeltaMs?.toFixed(1) ?? 'N/A'} |`;
  return ['# Voice benchmark comparison', '',
    '| Metric | Comparable | Before p50 ms | After p50 ms | Delta ms | Delta % | p95 delta ms |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    row('Speech end to first audio', comparison.firstAudio),
    row('Setup', comparison.setup),
    row('Durable completion', comparison.durable), '',
    ...(comparison.firstAudio.reason ? [`First-audio classification: ${comparison.firstAudio.reason}.`, ''] : []),
    ...(comparison.durable.reason ? [`Durable classification: ${comparison.durable.reason}.`, ''] : []),
    '## Limitations', ...comparison.limitations.map(line => `- ${line}`), ''].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) throw new Error('BENCHMARK_COMPARISON_USAGE');
  const read = async (path: string) => {
    const bytes = await readFile(path);
    if (bytes.byteLength > 1024 * 1024) throw new Error('BENCHMARK_COMPARISON_INPUT');
    const parsed = voiceComparisonInputSchema.safeParse(JSON.parse(bytes.toString('utf8')));
    if (!parsed.success) throw new Error('BENCHMARK_COMPARISON_INPUT');
    return parsed.data;
  };
  const comparison = compareVoiceRuns(await read(args[0]), await read(args[1]));
  const directory = resolve(args[2]);
  await mkdir(directory); // never overwrite an existing evidence directory
  await writeFile(join(directory, 'comparison.json'), JSON.stringify(comparison, null, 2));
  await writeFile(join(directory, 'comparison.md'), renderComparison(comparison));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(() => {
    // No artifact contents, paths or raw parser errors escape.
    process.stderr.write('Benchmark comparison refused or failed.\n');
    process.exitCode = 1;
  });
}
