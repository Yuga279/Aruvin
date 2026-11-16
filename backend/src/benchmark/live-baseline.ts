/**
 * ============================================================================
 * FILE: live-baseline.ts
 * LOCATION: backend/src/benchmark/live-baseline.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Boot one isolated, budget-guarded headless WebRTC benchmark run.
 *
 * ROLE IN PROJECT: Operator-only driver for the existing benchmark CLI and app;
 *    never loads secrets into reports or changes the user's stored settings.
 * KEY COMPONENTS: Fresh approval/output claim, nonsecret provenance, egress
 *    guard, child deadline, graceful shutdown.
 * ============================================================================
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MongoClient } from 'mongodb';
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { relative, resolve } from 'node:path';
import { AppModule } from '../app.module.js';
import { AppService } from '../app.service.js';
import { configureApplication } from '../main.js';
import { AURVIN_CONFIG } from '../platform/tokens.js';
import { loadBootstrapConfig } from '../platform/config/bootstrap-config.js';
import { storedConfigDocumentSchema } from '../contracts/admin-config.js';
import { isCompactJwt } from '../contracts/voice-wire.js';
import { safeEvidence } from './runner.js';
import { socketFactory } from '../voice/providers/provider-link.js';
import { LiveBudget } from './live-budget.js';
import { setupIndexes } from '../persistence/indexes.js';
import { claimLiveOutput, parseLiveRunOptions } from './live-run-options.js';
import { projectVoiceProvenance, type VoiceProvenance } from './voice-measurements.js';

const INPUT = { bytes: 183518,
  sha256: '933c59e38179c0a16df1b26aa1567a8a76ee823c0c0ceaf820feef382412c3a1',
  speechEndMs: 3734.9375 } as const;
const LABEL = /^[A-Za-z0-9/_.:-]{1,128}$/;
const isToken = (value: string): boolean => isCompactJwt(value);
const PLACEMENT_KEYS = ['clientPlacement', 'backendPlacement', 'sfuPlacement',
  'databasePlacement', 'providerRegion', 'routingLabel'] as const;
type Placements = Record<typeof PLACEMENT_KEYS[number], string>;

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

function sourceHash(root: string) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--',
    'backend/src', 'backend/test/benchmark', 'backend/package.json', 'backend/package-lock.json',
    'frontend/src', 'frontend/package.json', 'frontend/package-lock.json', 'product_knowledge.md'],
  { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update('\0').update(readFileSync(resolve(root, file))).update('\0');
  return { hash: hash.digest('hex'), files };
}

function buildHash(root: string) {
  const base = resolve(root, 'backend/dist');
  const files = readdirSync(base, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => relative(base, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(`backend/dist/${file}`).update('\0')
    .update(readFileSync(resolve(base, file))).update('\0');
  return hash.digest('hex');
}

function placements(root: string): Placements {
  const unverified = Object.fromEntries(PLACEMENT_KEYS.map(key => [key, 'unverified'])) as Placements;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolve(root, 'backend/benchmark-results/webrtc-context.local.json'), 'utf8'));
  } catch { return unverified; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('PLACEMENT_METADATA_INVALID');
  const object = raw as Record<string, unknown>;
  if (Object.keys(object).length !== PLACEMENT_KEYS.length ||
    Object.keys(object).some(key => !PLACEMENT_KEYS.includes(key as never)))
    throw new Error('PLACEMENT_METADATA_INVALID');
  for (const key of PLACEMENT_KEYS) {
    const value = object[key];
    if (typeof value !== 'string' || !LABEL.test(value) || isToken(value) ||
      value.startsWith('sk-') || value.startsWith('Bearer')) throw new Error('PLACEMENT_METADATA_INVALID');
  }
  return object as Placements;
}

async function main() {
  const options = parseLiveRunOptions(process.argv.slice(2));
  const root = resolve('..');
  let directory: string;
  try { directory = await claimLiveOutput(resolve('benchmark-results'), options.outputName); }
  catch { throw new Error('OUTPUT_ALREADY_EXISTS'); }
  process.loadEnvFile('.env');
  const source = loadBootstrapConfig(process.env);
  const budget = new LiveBudget();
  let app: NestExpressApplication | undefined, service: AppService | undefined;
  const client = new MongoClient(source.persistence.mongoUri, {
    serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, timeoutMS: 60000,
  });
  const json = (name: string, data: unknown) => {
    writeFileSync(resolve(directory, name), JSON.stringify(data, null, 2), 'utf8');
  };
  try {
    // Validate the immutable input before any database, catalogue or admission work.
    const pcmPath = resolve('benchmark-results/ws-baseline-2026-11-05/audio/baseline.pcm');
    let pcm: Buffer, marker: number;
    try {
      pcm = readFileSync(pcmPath);
      marker = (JSON.parse(readFileSync(
        resolve('benchmark-results/ws-baseline-2026-11-05/audio/baseline.json'), 'utf8')) as {
          speechEndMs: number }).speechEndMs;
    } catch { throw new Error('INPUT_ARTIFACT_MISMATCH'); }
    const inputSha256 = sha256(pcm);
    if (pcm.byteLength !== INPUT.bytes || inputSha256 !== INPUT.sha256 || marker !== INPUT.speechEndMs)
      throw new Error('INPUT_ARTIFACT_MISMATCH');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const preSource = sourceHash(root), preBuildHash = buildHash(root);
    json('context.json', { startedAt: new Date().toISOString(), authorization: options.approvalReference,
      outputName: options.outputName, transport: 'webrtc', head, preSourceHash: preSource.hash,
      preBuildHash, inputSha256, inputBytes: pcm.byteLength, speechEndMs: marker, status: 'preflight' });
    await client.connect();
    const stored = storedConfigDocumentSchema.parse(await client.db(source.persistence.mongoDbName)
      .collection<{ _id: string }>('config').findOne({ _id: 'aurvin' }));
    const s = stored.settings;
    if (s.openRouter.modelId !== 'anthropic/claude-haiku-5.5' || !s.voice.enabledModes.live
      || s.chat.maxContextTokens > 60000 || s.chat.maxOutputTokens > 6000 || s.chat.retryMaxAttempts > 2
      || s.deepgram.liveModel !== 'flux-general-en' || s.deepgram.ttsModel !== 'flux-haley-en'
      || s.deepgram.region !== 'us' || s.deepgram.keyterms.length) throw new Error('SETTINGS_OUTSIDE_APPROVED_ENVELOPE');
    const catalogue = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) });
    if (!catalogue.ok) throw new Error('CATALOGUE_UNAVAILABLE');
    const models = await catalogue.json() as { data: { id: string; pricing: Record<string, unknown> }[] };
    const model = models.data.find(m => m.id === s.openRouter.modelId);
    if (!model || !['prompt', 'input_cache_read', 'input_cache_write', 'input_cache_write_1h']
      .every(k => model.pricing[k] === undefined || Number(model.pricing[k]) <= 0.0000005)
      || !(Number(model.pricing.completion) <= 0.0000025) || Number(model.pricing.request ?? 0) !== 0)
      throw new Error('MODEL_RATES_OUTSIDE_APPROVED_ENVELOPE');
    const labels = placements(root);
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages?: Record<string, { version?: string }> };
    const rtcNodeVersion = lock.packages?.['node_modules/@livekit/rtc-node']?.version ?? null;
    const ffiVersion = lock.packages?.['node_modules/@livekit/rtc-ffi-bindings']?.version ?? null;
    const { keyterms, ...speech } = s.deepgram;
    const configurationHash = sha256(stable({ transport: 'webrtc', voiceOnly: true,
      start: '2026-11-06T10:00:00Z', end: '2026-11-06T11:00:00Z', timeZone: 'Etc/UTC',
      repetitions: 7, warmups: 1, timeoutMs: 90000, allowPaid: true, budgetCeilingUsd: 1,
      allowCalendarData: false, allowMutations: false, disposableCalendar: false,
      origin: source.frontendOrigin, modelLabel: s.openRouter.modelId, serverRevision: head,
      openRouter: s.openRouter, chat: s.chat, voice: s.voice,
      speech: { ...speech, keytermCount: keyterms.length } }));
    const provenance: VoiceProvenance = projectVoiceProvenance({
      authorizationReference: options.approvalReference,
      sourceHash: preSource.hash, buildHash: preBuildHash, configurationHash,
      instructionHash: sha256(readFileSync(resolve(root, 'backend/src/instructions/system.md'))),
      productKnowledgeHash: sha256(readFileSync(resolve(root, 'product_knowledge.md'))),
      inputSha256, inputBytes: pcm.byteLength, speechEndMs: marker,
      scenario: 'voice-baseline', freshConversation: true,
      inputSampleRateHz: 16000, inputChannels: 1, inputFrameMs: 80,
      decodedSampleRateHz: 24000, decodedChannels: 1,
      codec: 'opus', rtpClockHz: 48000, requestedPacketMs: null, observedPacketMs: null,
      resampling: 'rtc-native-16k-to-opus-and-opus-to-24k',
      clientPlacement: labels.clientPlacement, backendPlacement: labels.backendPlacement,
      sfuPlacement: labels.sfuPlacement, databasePlacement: labels.databasePlacement,
      providerRegion: labels.providerRegion, rtcNodeVersion, ffiVersion,
      modelLabel: s.openRouter.modelId, routingLabel: labels.routingLabel,
      sttModel: s.deepgram.liveModel, ttsModel: s.deepgram.ttsModel,
      endpointingHash: sha256(stable({ endpointingMs: s.deepgram.endpointingMs,
        spokenPunctuation: s.deepgram.spokenPunctuation })),
      limitsHash: sha256(stable(s.voice.limits)),
      impairment: 'none', playbackBoundary: 'unproven',
    });
    const dbName = `aurvin_voice_bench_webrtc_${randomUUID().replaceAll('-', '')}`;
    const context = { startedAt: new Date().toISOString(), authorization: options.approvalReference,
      outputName: options.outputName, transport: 'webrtc', head,
      sourceHash: preSource.hash, buildHash: preBuildHash,
      preSourceHash: preSource.hash, preBuildHash, hashedPaths: preSource.files,
      sourceHashAlgorithm: 'SHA256(sorted path + NUL + bytes + NUL)', isolatedDatabase: dbName,
      sourceDatabaseReadOnly: true, node: process.version, platform: process.platform,
      configurationRevision: stored.revision, configurationHash,
      instructionHash: provenance.instructionHash, productKnowledgeHash: provenance.productKnowledgeHash,
      endpointingHash: provenance.endpointingHash, limitsHash: provenance.limitsHash,
      sdk: { rtcNodeVersion, ffiVersion }, placements: labels,
      settings: { openRouter: s.openRouter, chat: s.chat, voice: s.voice,
        deepgram: { ...speech, keytermCount: keyterms.length } },
      modelCatalogue: model, speechPricing: { source: 'https://deepgram.com/pricing', observedDate: '2026-11-05',
        fluxSttPerMinuteUsd: 0.0077, fluxTtsPerThousandCharsUsd: 0.045 },
      bounds: budget.snapshot(), submissions: 8, warmups: 1, repetitions: 7, concurrency: 1,
      perSubmissionTimeoutMs: 90000, activeDeadlineMs: 900000,
      note: 'Fresh voice session per submission; decoded headless receipt only, not audible or durable playback proof.' };
    json('context.json', context);
    writeFileSync(resolve(directory, 'server.jsonl'), '', 'utf8');
    // Cold index creation can exceed normal request timeouts. Prepare only this new
    // isolated database, then retain the unchanged configured runtime timeouts.
    await setupIndexes(client.db(dbName));
    await client.close(); // No executor is opened on the application database.
    const bootstrap = { ...source, calendar: null, port: 8001,
      persistence: { ...source.persistence, mongoDbName: dbName } };
    service = await AppService.create(bootstrap, {
      fetcher: budget.fetch(fetch), speechSockets: budget.sockets(socketFactory),
      configRepository: () => ({ read: async () => stored,
        createIfAbsent: async () => { throw new Error('READ_ONLY_CONFIG'); },
        compareAndSwap: async () => { throw new Error('READ_ONLY_CONFIG'); } }),
      writeLog: line => {
        try { const raw = JSON.parse(line);
          if (raw.kind === 'readiness') appendFileSync(resolve(directory, 'readiness.jsonl'), `${JSON.stringify({
            kind: 'readiness', ok: raw.ok, code: raw.code })}\n`, 'utf8');
          const event = safeEvidence(raw);
          if (event) appendFileSync(resolve(directory, 'server.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
        } catch { /* No raw logs or payloads are exported. */ }
      },
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(bootstrap)
      .overrideProvider(AppService).useValue(service).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApplication(app);
    await app.listen(8001, '127.0.0.1');
    const ready = await fetch('http://127.0.0.1:8001/api/operations/ready');
    const readiness = await ready.json() as { readReady: boolean; acceptReady: boolean; provider: string; speech: string; issues: string[] };
    json('readiness.json', { status: ready.status, readReady: readiness.readReady, acceptReady: readiness.acceptReady,
      provider: readiness.provider, speech: readiness.speech, issues: readiness.issues });
    if (!ready.ok) throw new Error('ISOLATED_BACKEND_NOT_READY');
    const configPath = resolve(directory, 'benchmark.json');
    writeFileSync(configPath, JSON.stringify({ baseUrl: 'http://127.0.0.1:8001/api', origin: source.frontendOrigin,
      voiceOnly: true, start: '2026-11-06T10:00:00Z', end: '2026-11-06T11:00:00Z', timeZone: 'Etc/UTC',
      repetitions: 7, warmups: 1, timeoutMs: 90000, allowPaid: true, budgetCeilingUsd: 1,
      allowCalendarData: false, allowMutations: false, disposableCalendar: false,
      serverLog: resolve(directory, 'server.jsonl'), serverRevision: head, modelLabel: s.openRouter.modelId,
      transport: 'webrtc', provenance,
      voicePcm: pcmPath, speechEndMs: marker,
      outputDirectory: resolve(directory, 'runs') }, null, 2), 'utf8');
    process.stdout.write(`Isolated guarded WebRTC baseline ready. Reports: ${directory}\n`);
    const child = spawn(process.execPath, ['dist/benchmark/cli.js', configPath, '--live'], {
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AURVIN_BENCHMARK_AUTHORIZATION: '' },
    });
    let deadlineExpired = false;
    const deadline = setTimeout(() => {
      deadlineExpired = true;
      child.kill(); // Windows terminates this direct Node child; no broad process-name kill.
    }, 900000);
    deadline.unref?.();
    child.stdout.on('data', (data: Buffer) => { appendFileSync(resolve(directory, 'client.log'), data); process.stdout.write(data); });
    child.stderr.on('data', (data: Buffer) => { appendFileSync(resolve(directory, 'client.log'), data); });
    const [code] = await once(child, 'close');
    clearTimeout(deadline);
    const postSourceHash = sourceHash(root).hash, postBuildHash = buildHash(root);
    const endedAt = new Date().toISOString();
    const identityDrift = postSourceHash !== preSource.hash || postBuildHash !== preBuildHash;
    Object.assign(context, { endedAt, postSourceHash, postBuildHash, identityDrift });
    json('context.json', context);
    json('client-status.json', { exitCode: code, endedAt,
      deadlineExpired, activeDeadlineMs: 900000 });
    if (code !== 0 || deadlineExpired || identityDrift) process.exitCode = 2;
  } finally {
    try { await app?.close(); await service?.operations.shutdown(); }
    finally { budget.stop(); await client.close(); json('budget.json', budget.snapshot()); }
  }
}

main().catch(error => {
  // No driver errors, URIs, provider payloads, credentials or stack traces escape.
  const allowed = new Set(['FRESH_APPROVAL_REQUIRED', 'INVALID_LIVE_RUN_OPTIONS', 'OUTPUT_ALREADY_EXISTS',
    'INPUT_ARTIFACT_MISMATCH', 'PLACEMENT_METADATA_INVALID', 'BENCHMARK_PROVENANCE_INVALID',
    'SETTINGS_OUTSIDE_APPROVED_ENVELOPE', 'CATALOGUE_UNAVAILABLE',
    'MODEL_RATES_OUTSIDE_APPROVED_ENVELOPE', 'ISOLATED_BACKEND_NOT_READY']);
  process.stderr.write(`Live baseline stopped: ${error instanceof Error && allowed.has(error.message) ? error.message : 'PREREQUISITE_OR_EXECUTION_FAILED'}.\n`);
  process.exitCode = 1;
});
