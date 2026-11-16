/**
 * ============================================================================
 * FILE: cli.ts
 * LOCATION: backend/src/benchmark/cli.ts
 * PURPOSE: Run bounded text/voice scenarios and export redacted latency reports.
 * ROLE IN PROJECT: Explicit operator CLI; dry-run by default, never loads secrets.
 * KEY COMPONENTS: main: configuration, execution, log correlation and reporting.
 * ============================================================================
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { benchmarkConfigSchema, blockedReason, runText, correlate, safeEvidence, hashId,
  isVoiceDeliveryConfirmed } from './runner.js';
import { scenarios, analyzeTurn, summarize, type Evidence } from './report.js';
import { runVoice } from './voice-runner.js';
import { summarizeVoiceMetric, projectVoiceProvenance,
  type VoiceProvenance } from './voice-measurements.js';
import { claimVoiceRunOutput, environmentVerified, voiceEnvironmentHash } from './voice-comparison.js';

type CaseRecord = { scenario: string; mode: 'text' | 'voice'; outcome: string;
  blocked?: string; warmup?: boolean; analysis?: ReturnType<typeof analyzeTurn> } & Record<string, unknown>;

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const path = args.find(a => !a.startsWith('--'));
  if (!path || args.some(a => a.startsWith('--') && a !== '--live')) throw new Error('usage');
  if ((await stat(path)).size > 65536) throw new Error('config-size');
  const config = benchmarkConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const provenance: VoiceProvenance | undefined = config.provenance
    ? projectVoiceProvenance(config.provenance) : undefined;
  if (live && config.transport === 'webrtc' && !provenance) throw new Error('BENCHMARK_PROVENANCE_REQUIRED');
  let verifiedPcm: Buffer | undefined;
  if (live && provenance) {
    if (!config.voicePcm || !config.speechEndMs) throw new Error('BENCHMARK_INPUT_MISMATCH');
    verifiedPcm = await readFile(config.voicePcm);
    const digest = createHash('sha256').update(verifiedPcm).digest('hex');
    if (verifiedPcm.byteLength !== provenance.inputBytes || digest !== provenance.inputSha256 ||
      config.speechEndMs !== provenance.speechEndMs) throw new Error('BENCHMARK_INPUT_MISMATCH');
  }
  const cases = scenarios(config).filter(s => !config.voiceOnly || s.mode === 'voice'), records: CaseRecord[] = [];
  const samples: { scenario: string; warmup: boolean; durationMs: number; outcome: string }[] = [];
  const authorization = process.env.AURVIN_BENCHMARK_AUTHORIZATION;
  let revision = 'unknown';
  let workingTreeDirty: boolean | null = null;
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* External checkout. */ }
  try { workingTreeDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0; } catch { /* External checkout. */ }
  const readEvidence = async (): Promise<Evidence[]> => {
    if (!config.serverLog) return [];
    const size = (await stat(config.serverLog)).size;
    if (size > 64 * 1024 * 1024) throw new Error('Rotate the diagnostic log before benchmarking (64 MiB maximum).');
    return (await readFile(config.serverLog, 'utf8')).split(/\r?\n/).flatMap(line => {
      try { const event = safeEvidence(JSON.parse(line)); return event ? [event] : []; } catch { return []; }
    });
  };
  // Fail before paid work when the required diagnostic source is absent/unreadable.
  if (live && config.allowPaid && config.budgetCeilingUsd) await readEvidence();
  const runId = randomUUID();
  const directory = config.transport === 'webrtc'
    ? await claimVoiceRunOutput(config.outputDirectory, runId)
    : resolve(config.outputDirectory, runId);
  if (config.transport !== 'webrtc') await mkdir(directory, { recursive: true });
  const finiteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const expected = new Map<string, { warmups: number; repetitions: number }>();
  for (const scenario of cases) {
    if (!blockedReason(scenario, config, live))
      expected.set(scenario.id, { warmups: scenario.mutation ? 0 : config.warmups,
        repetitions: scenario.mutation ? 1 : config.repetitions });
  }
  const voiceMetrics = () => {
    const rows = records.filter(record => record.mode === 'voice' &&
      typeof record.repetition === 'number');
    return rows.length ? ['setupMs', 'firstAudioMs', 'speechEndToFirstAudioMs',
      'speechEndToPlaybackEndMs', 'durableCompletionMs']
      .map(metric => summarizeVoiceMetric(rows, metric)) : [];
  };
  const runComplete = () => {
    if (!live || expected.size === 0 || records.some(record => record.outcome === 'skipped')) return false;
    for (const [id, counts] of expected) {
      const rows = records.filter(record => record.scenario === id);
      const total = counts.warmups + counts.repetitions;
      if (rows.length !== total) return false;
      for (let index = 0; index < total; index++) {
        const row = rows.find(record => record.repetition === index);
        if (!row || row.warmup !== (index < counts.warmups) || row.outcome !== 'success' || row.blocked)
          return false;
      }
    }
    const voice = records.filter(record => record.mode === 'voice');
    return voice.every(row => finiteNumber(row.setupMs) &&
      finiteNumber(row.firstAudioMs) && finiteNumber(row.speechEndToFirstAudioMs) &&
      row.completed === true && finiteNumber(row.durableCompletionMs));
  };
  const writeComparisonInput = async (complete: boolean) => {
    if (!provenance) return;
    const rows = records.filter(record => record.mode === 'voice' &&
      typeof record.repetition === 'number')
      .sort((a, b) => (a.repetition as number) - (b.repetition as number)).slice(0, 12);
    const expectedRows = config.warmups + config.repetitions;
    const completeShape = rows.length === expectedRows && rows.every((row, index) =>
      row.repetition === index && row.warmup === (index < config.warmups));
    await writeFile(join(directory, 'comparison-input.json'), JSON.stringify({
      runId, mode: live ? 'live' : 'dry-run',
      complete: complete && completeShape && environmentVerified(provenance),
      repetitions: config.repetitions, warmups: config.warmups,
      sourceHash: provenance.sourceHash, configurationHash: provenance.configurationHash,
      inputSha256: provenance.inputSha256, speechEndMs: provenance.speechEndMs,
      environmentHash: voiceEnvironmentHash(provenance),
      firstAudioBoundary: config.transport === 'webrtc'
        ? 'webrtc-decoded-nonzero-after-start-v1' : 'ws-pcm-receipt-v1',
      playbackBoundary: provenance.playbackBoundary,
      records: rows.map(row => ({ repetition: row.repetition as number, warmup: row.warmup === true,
        outcome: typeof row.outcome === 'string' ? row.outcome : 'failed',
        setupMs: finiteNumber(row.setupMs) ? row.setupMs : null,
        speechEndToFirstAudioMs: finiteNumber(row.speechEndToFirstAudioMs) ? row.speechEndToFirstAudioMs : null,
        speechEndToPlaybackEndMs: finiteNumber(row.speechEndToPlaybackEndMs) ? row.speechEndToPlaybackEndMs : null,
        durableCompletionMs: finiteNumber(row.durableCompletionMs) ? row.durableCompletionMs : null })),
    }, null, 2));
  };
  const persist = async () => {
    const complete = runComplete(), metrics = voiceMetrics();
    const document = { schemaVersion: 2, runId, mode: live ? 'live' : 'dry-run',
      createdAt: new Date().toISOString(), runnerRevision: revision, serverRevision: config.serverRevision ?? 'unverified',
      runnerWorkingTreeDirty: workingTreeDirty,
      runnerNode: process.version, platform: process.platform, modelLabel: config.modelLabel ?? 'unverified',
      repetitions: config.repetitions, warmups: config.warmups, concurrency: 1,
      transport: config.transport,
      firstAudioBoundary: config.transport === 'webrtc'
        ? 'webrtc-decoded-nonzero-after-start-v1' : 'ws-pcm-receipt-v1',
      complete, voiceMetrics: metrics, provenance: provenance ?? null,
      declaredBudgetCeilingUsd: config.budgetCeilingUsd ?? null,
      limitations: [
        'No live Calendar tools are exposed to voice; those combinations are unsupported, not passed.',
        'Provider-internal queueing, prefill and network delay cannot be separated by client-observed TTFT.',
        'Throughput uses provider completion_tokens (may include reasoning), never SSE chunk counts.',
        'Observed stream speed includes consumer backpressure and local persistence; it is not isolated provider decode speed.',
        'outputTokensPerSecond divides tokens by stream-end minus first meaningful output; requestTokensPerSecond uses full dispatch duration.',
        'Headless voice playback is simulated in real time; firstAudioMs measures receipt, not audible browser/device output.',
        'Voice summary duration is speech-end to simulated playback end; text summary duration is submission through durable status verification.',
        'WebRTC first audio is decoded nonzero after audio.start; it excludes initial silence and includes jitter/decode, so it is not a like-for-like delta against WebSocket PCM receipt.',
        'Headless WebRTC leaves scheduled/audible/interruption metrics null; playback remains unproven without a supported server proof contract.',
        'Voice pipeline completion does not independently validate transcript accuracy or answer semantics.',
        'Durations overlap; coveredStageMs is their union. Unattributed time is not proof of CPU/sequential execution.',
        'Small-sample p95 is descriptive only. Failed and warmup samples are excluded from success latency percentiles.',
        'The declared dollar ceiling is authorization metadata, not a hard invoice cap; configure provider-side spending limits before live runs.',
        'Creation is never blindly confirmed or retried. Clarifications require user action and are not successful creation samples.',
        'Mutations get one measured sample and no warmup to avoid duplicate test events and self-induced conflicts.',
        'Generated chat sessions and authorized test events persist; no automatic deletion or account/settings changes.',
      ], unsupported: cases.filter(c => c.expectedTool).map(c => ({ scenario: c.id, mode: 'voice', reason: 'tools-not-exposed-in-live-voice' })),
      summary: summarize(samples), records };
    await writeFile(join(directory, 'results.json'), JSON.stringify(document, null, 2));
    const rows = document.summary.map(s => `| ${s.scenario} | ${s.samples} | ${s.succeeded} | ${s.failed} | ${s.p50Ms?.toFixed(1) ?? 'N/A'} | ${s.p95Ms?.toFixed(1) ?? 'N/A'} |`);
    const stageGroups = new Map<string, number[]>();
    for (const record of records) {
      if (record.warmup || record.outcome !== 'success' || !record.analysis) continue;
      const analysis = record.analysis as ReturnType<typeof analyzeTurn>;
      for (const stage of analysis.stages) {
        const label = `${record.scenario} / ${stage.stage}${stage.tool ? ` / ${stage.tool}` : ''}`;
        const values = stageGroups.get(label) ?? [];
        values.push(stage.durationMs as number); stageGroups.set(label, values);
      }
    }
    const stageRows = [...stageGroups].map(([label, values]) => {
      values.sort((a, b) => a - b);
      return { label, count: values.length, median: values[Math.max(0, Math.ceil(values.length / 2) - 1)] };
    }).sort((a, b) => b.median - a.median).map(s => `| ${s.label} | ${s.count} | ${s.median.toFixed(1)} |`);
    const metricRows = metrics.map(m => `| ${m.scenario} | ${m.samples} | ${m.succeeded} | ${m.failed} | ${m.p50Ms?.toFixed(1) ?? 'N/A'} | ${m.p95Ms?.toFixed(1) ?? 'N/A'} |`);
    const transportRows = metrics.length ? [
      '## Transport voice metrics', '',
      '| Metric | Samples | Successful | Failed/unverified | Median ms | p95 ms |',
      '| --- | ---: | ---: | ---: | ---: | ---: |', ...metricRows, '',
      `First-audio boundary: \`${document.firstAudioBoundary}\`. WebSocket receipt includes initial silence and excludes jitter/decode; WebRTC decoded onset excludes silence and includes jitter/decode. Values are not a like-for-like delta.`, '',
      'Decoded headless receipt is not audible browser/device playback. Scheduled/audible/interruption metrics are unavailable and playback remains unproven without a supported proof contract.', '',
    ] : [];
    const provenanceRows = provenance ? [
      '## Provenance', '',
      `- Authorization reference: ${provenance.authorizationReference}`,
      `- Source / build / configuration: ${provenance.sourceHash} / ${provenance.buildHash} / ${provenance.configurationHash}`,
      `- Input: ${provenance.inputSha256} (${provenance.inputBytes} bytes, marker ${provenance.speechEndMs} ms)`,
      `- Placements: client ${provenance.clientPlacement}; backend ${provenance.backendPlacement}; SFU ${provenance.sfuPlacement}; database ${provenance.databasePlacement}; provider ${provenance.providerRegion}`,
      `- Codec ${provenance.codec}; decoded ${provenance.decodedSampleRateHz} Hz / ${provenance.decodedChannels} channel; observed packet ${provenance.observedPacketMs === null ? 'unmeasured' : `${provenance.observedPacketMs} ms`}`,
      `- Playback boundary: ${provenance.playbackBoundary}`, '',
    ] : [];
    await writeFile(join(directory, 'report.md'), [
      '# Conversation latency benchmark', '', `Mode: **${document.mode}**. Complete: **${String(complete)}**. Runner base revision: ${revision}. Working tree dirty: ${String(workingTreeDirty)}. Server revision: ${document.serverRevision}.`, '',
      '| Workflow | Measured | Successful | Failed/unverified | Median ms | p95 ms |',
      '| --- | ---: | ---: | ---: | ---: | ---: |', ...rows, '',
      '## Case evidence', ...records.map(r => `- ${r.scenario}: ${r.outcome}${r.blocked ? ` (${r.blocked})` : ''}`), '',
      '## Slowest observed stages (successful measured cases only)', '',
      '| Workflow / stage | Spans | Median ms |', '| --- | ---: | ---: |', ...stageRows, '',
      'These stages overlap; do not add them. Empty results mean no successful live measurements, not zero latency.', '',
      'Full stage timelines, model-round TTFT/throughput, and per-case evidence: `results.json`.', '',
      ...transportRows, ...provenanceRows,
      '## Limitations', ...document.limitations.map(l => `- ${l}`), '',
    ].join('\n'));
    await writeComparisonInput(complete);
  };
  for (const scenario of cases) {
    const blocked = blockedReason(scenario, config, live);
    if (blocked) { records.push({ scenario: scenario.id, mode: scenario.mode, outcome: 'skipped', blocked }); await persist(); continue; }
    let pcm: Buffer | undefined;
    if (scenario.mode === 'voice') {
      pcm = verifiedPcm ?? await readFile(config.voicePcm!);
      if (pcm.byteLength > 65_000 * 32) throw new Error('pcm-size');
    }
    const warmups = scenario.mutation ? 0 : config.warmups;
    const repetitions = scenario.mutation ? 1 : config.repetitions;
    for (let n = 0; n < warmups + repetitions; n++) {
      const warmup = n < warmups;
      const wire = scenario.mode === 'text' ? await runText(scenario, config, fetch, authorization)
        : await runVoice(config, pcm!, authorization, async (pending, signal) => {
          const deadline = performance.now() + Math.min(config.timeoutMs, 30000);
          while (!signal.aborted && performance.now() < deadline) {
            const events = correlate(await readEvidence(), pending);
            if (events.some(e => e.stage === 'delivery-settled'))
              return isVoiceDeliveryConfirmed(events, pending);
            await sleep(100);
          }
          return false;
        });
      // Terminal delivery and server log flushing may trail the final wire event.
      let evidence: Evidence[] = [];
      for (let poll = 0; poll < 20; poll++) {
        evidence = correlate(await readEvidence(), wire);
        if (!wire.completed || evidence.some(e => scenario.mode === 'voice' ? e.stage === 'delivery-settled' : e.stage === 'terminal')) break;
        await sleep(100);
      }
      const analysis = analyzeTurn(scenario.expectedTool, evidence, wire.durationMs);
      let outcome = wire.outcome === 'completed' ? analysis.outcome : wire.outcome;
      if (scenario.mode === 'voice' && outcome === 'success' && !evidence.some(e => e.stage === 'delivery-settled' && !e.code)) outcome = 'unverified';
      const { sessionId, turnId, attemptId, voiceSessionId, speechEndClockMs, ...measurements } = wire;
      const ids = Object.fromEntries(Object.entries({ sessionId, turnId, attemptId, voiceSessionId })
        .flatMap(([key, value]) => value ? [[key, hashId(value)]] : []));
      // Cross-process speech-end comparison requires clock alignment and is deliberately unavailable.
      void speechEndClockMs;
      records.push({ scenario: scenario.id, mode: scenario.mode, repetition: n, warmup,
        ...ids, ...measurements, analysis, timeline: evidence, outcome });
      samples.push({ scenario: scenario.id, warmup, durationMs: scenario.mode === 'voice'
        ? config.transport === 'webrtc' ? 0 : wire.speechEndToPlaybackEndMs ?? wire.durationMs
        : wire.durationMs,
      outcome: scenario.mode === 'voice' && config.transport === 'webrtc' ? 'unverified' : outcome });
      await persist();
      process.stdout.write(`${scenario.id}: ${outcome} (${Math.round(wire.durationMs)} ms)\n`);
      if (!['success', 'needs-user-confirmation'].includes(outcome)) break; // No repeated paid failures/uncertain operations.
      if (scenario.mutation && outcome !== 'success') break;
    }
  }
  await persist();
  process.stdout.write(`Benchmark report: ${join(directory, 'report.md')}\n`);
  if (live && (!runComplete() || records.some(r => r.outcome === 'skipped'))) process.exitCode = 2;
}

main().catch(() => {
  // Never echo config, URLs, provider bodies, credentials, prompts or filesystem errors.
  process.stderr.write('Benchmark could not run. Check the documented config, live approvals, local server/log and synthetic audio prerequisites.\n');
  process.exitCode = 1;
});
