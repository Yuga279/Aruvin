/**
 * ============================================================================
 * FILE: assembled-harness.ts
 * LOCATION: backend/test/integration/assembled-harness.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Boot an isolated native assembled app with fixture fetch for P10 evidence.
 *
 * ROLE IN PROJECT:
 *    Shared P10 integration harness: native replica-set database, deterministic
 *    OpenRouter frames, SSE parse helpers, and secret-free close/redaction.
 *
 * KEY COMPONENTS:
 *    - openAssembled: Isolated AppModule with fixture fetch and optional faults.
 *    - uniqueFixtureFrames: First completions POST keeps gen_fixture; later POSTs suffix.
 *    - submit/streamText/listen: Public HTTP helpers for turn and stream checks.
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { FRAMES, chunk, done, usage } from '../fixtures/openrouter/frames.js';
import { nativeDatabase } from '../persistence/native.js';
import { AppModule } from '../../src/app.module.js';
import { AppService } from '../../src/app.service.js';
import { configureApplication } from '../../src/main.js';
import { loadBootstrapConfig, type BootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { parseLegacyConfigImport } from '../../src/platform/config/legacy-config-import.js';
import { composeRuntimeBudgets, defaultManageableSettings } from '../../src/platform/config/manageable-config.js';
import { CredentialService } from '../../src/admin-config/credential-service.js';
import { CredentialValidator } from '../../src/admin-config/credential-validation.js';
import { APP_CONFIG_ID, type StoredConfigDocument } from '../../src/contracts/admin-config.js';
import type { ManageableSettings } from '../../src/contracts/admin-config-wire.js';
import { AURVIN_CONFIG } from '../../src/platform/tokens.js';
import { createPersistenceBundle } from '../../src/persistence/index.js';
import { parseSseDataLine, type StreamEnvelope } from '../../src/contracts/stream.js';
import { submitTurnResponseSchema, type SubmitTurnResponse } from '../../src/contracts/api.js';
import { COLLECTIONS } from '../../src/contracts/collections.js';
import { admittedAccount, providerFixture, SESSION_COOKIE } from '../auth/fixtures.js';

export const USER = 'aurvin-dev-user';
export const MODEL = 'fixture/model';
export type CapturedCall = { url: string; method: string; body: unknown };
export type NativeHandle = Awaited<ReturnType<typeof nativeDatabase>>;

const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
const API_KEY = 'fixture-key';
const STORED_AT = '2026-10-21T00:00:00.000Z';
const FIXTURE_GENERATION_RUN = randomUUID().replaceAll('-', '');
const fixtureGenerationCount = new WeakMap<object, number>();

export function uniqueFixtureFrames(owner: object, frames: string): string {
  const next = (fixtureGenerationCount.get(owner) ?? 0) + 1;
  fixtureGenerationCount.set(owner, next);
  if (next === 1) return frames;
  return frames.replaceAll('gen_fixture', `gen_fixture_${FIXTURE_GENERATION_RUN}_${next}`);
}

async function stampFixtureGeneration(owner: object, response: Response): Promise<Response> {
  const next = (fixtureGenerationCount.get(owner) ?? 0) + 1;
  if (next === 1) {
    fixtureGenerationCount.set(owner, next);
    return response;
  }
  const frames = await response.text();
  return new Response(uniqueFixtureFrames(owner, frames), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function catalogueResponse(): Response {
  return Response.json({ data: [{ id: MODEL, context_length: 32768,
    top_provider: { max_completion_tokens: 4096 }, supported_parameters: ['max_tokens'] }] });
}

export function findValues(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item) => findValues(item, key));
  const record = value as Record<string, unknown>;
  return [...(key in record ? [record[key]] : []),
    ...Object.values(record).flatMap((item) => findValues(item, key))];
}

export function parseEvents(text: string): StreamEnvelope[] {
  return text.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => parseSseDataLine(line));
}

export function percentile(samples: number[], p: number): number {
  if (!samples.length || p < 0 || p > 100) throw new Error('invalid percentile');
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function assertNoSecrets(value: unknown, sentinels: string[]): void {
  const text = JSON.stringify(value);
  for (const secret of ['fixture-key', 'AURVIN_TEST_MONGODB_URI', ...sentinels]) {
    if (secret && text.includes(secret)) throw new Error('evidence contains a forbidden sentinel');
  }
}

// A privacy-unsafe provider setting can never be imported into the stored
// configuration. The harness keeps the raw value so the stored document is what
// an operator could have written and the production read path has to refuse it.
function privacyUnsafe(env: Record<string, string | undefined>): boolean {
  const collection = env.OPENROUTER_DATA_COLLECTION;
  const transforms = env.OPENROUTER_DISABLE_TRANSFORMS;
  return (collection !== undefined && collection !== 'deny')
    || (transforms !== undefined && transforms !== 'true');
}

// The app now takes its provider configuration from the stored configuration
// document, not from the bootstrap environment. The fixture seeds that document
// into the isolated database so the app loads it exactly as it would in
// production: legacy manageable environment names are projected onto the stored
// settings by the production import and the fixture provider key is sealed
// with the harness master key.
function storedConfig(
  bootstrap: BootstrapConfig,
  env: Record<string, string | undefined>,
  credentials: CredentialService,
): { document: Record<string, unknown>; settings: ManageableSettings } {
  const base = defaultManageableSettings();
  base.openRouter.modelId = MODEL;
  const sealed = {
    openrouter: { envelope: credentials.seal('openrouter', API_KEY), validatedAt: STORED_AT },
    deepgram: null,
  };
  if (privacyUnsafe(env)) {
    const document = {
      _id: APP_CONFIG_ID, schemaVersion: 1, revision: 1,
      settings: { ...base, openRouter: { ...base.openRouter,
        dataCollection: env.OPENROUTER_DATA_COLLECTION ?? 'deny',
        disableTransforms: env.OPENROUTER_DISABLE_TRANSFORMS !== 'false' } },
      credentials: sealed, updatedAt: STORED_AT, updatedBy: USER,
    };
    return { document, settings: base };
  }
  const imported = parseLegacyConfigImport(env, bootstrap);
  const settings: ManageableSettings = {
    ...base,
    openRouter: { ...base.openRouter, modelId: MODEL },
    chat: imported.settings.chat,
    voice: imported.settings.voice,
    deepgram: imported.settings.deepgram,
  };
  const document: StoredConfigDocument = {
    _id: APP_CONFIG_ID, schemaVersion: 1, revision: 1, settings,
    credentials: sealed, updatedAt: STORED_AT, updatedBy: USER,
  };
  return { document, settings };
}

async function seedStoredConfig(db: NativeHandle, document: Record<string, unknown>): Promise<void> {
  const collection = db.db.collection(COLLECTIONS.config);
  if (await collection.findOne({ _id: APP_CONFIG_ID })) return;
  await collection.insertOne(document);
}

export async function openAssembled(options: {
  env?: Record<string, string | undefined>;
  frames?: string;
  fetcher?: typeof fetch;
  faultAssistantAppend?: boolean;
  db?: NativeHandle;
  executorId?: string;
} = {}) {
  const db = options.db ?? await nativeDatabase();
  const calls: CapturedCall[] = [];
  const logs: string[] = [];
  const innerFetcher = options.fetcher ?? (async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null;
    calls.push({ url: String(url), method: init?.method ?? 'GET', body });
    if (String(url).endsWith('/models')) return catalogueResponse();
    if (!String(url).endsWith('/chat/completions')) throw new Error('Unexpected fixture request');
    return new Response(uniqueFixtureFrames(db, options.frames ?? FRAMES.normal), {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  const fetcher: typeof fetch = options.fetcher
    ? async (url, init) => {
        const response = await innerFetcher(url, init);
        if (!String(url).endsWith('/chat/completions')) return response;
        return stampFixtureGeneration(db, response);
      }
    : innerFetcher;
  const bootstrap = loadBootstrapConfig({
    PERSISTENCE_PROFILE: 'native-mongodb', MONGODB_URI: 'fixture-injected-only',
    MONGODB_DB_NAME: db.name, AURVIN_CONFIG_ENCRYPTION_KEY: MASTER_KEY,
  });
  const credentials = new CredentialService(bootstrap.encryption, new CredentialValidator(fetcher));
  const { document, settings } = storedConfig(bootstrap, options.env ?? {}, credentials);
  await seedStoredConfig(db, document);
  let assistantFaultArmed = options.faultAssistantAppend === true;
  let bundle: Awaited<ReturnType<typeof createPersistenceBundle>> | undefined;
  const authProvider = providerFixture();
  const service = await AppService.create(bootstrap, {
    fetcher, writeLog: (line) => { logs.push(line); },
    authProvider: () => authProvider,
    open: async (openedConfig) => {
      const opened = await createPersistenceBundle(db.client, db.name, openedConfig.budgets, options.executorId);
      await opened.users.insert(admittedAccount({ userId: USER }));
      bundle = opened;
      const original = opened.messages.append.bind(opened.messages);
      opened.messages.append = async (record) => {
        if (assistantFaultArmed && record.role === 'assistant') {
          assistantFaultArmed = false;
          throw new Error('fixture crash before assistant archive write');
        }
        return original(record);
      };
      return { ...opened, close: async () => { await opened.owner.drain(); await opened.owner.releaseExecutor(); } };
    },
  });
  if (!bundle) throw new Error('native persistence did not open');
  const openedBundle = bundle;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AURVIN_CONFIG).useValue(bootstrap)
    .overrideProvider(AppService).useValue(service).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApplication(app);
  await app.init();
  await app.listen(0, '127.0.0.1');
  const active = service.currentConfig.current();
  const config = {
    identity: bootstrap.identity,
    budgets: active?.budgets ?? composeRuntimeBudgets(settings, bootstrap.safety),
    openRouter: active?.openRouter ?? { apiKey: '', modelId: MODEL, dataCollection: 'deny' as const, disableTransforms: true },
  };
  const origin = bootstrap.frontendOrigin;
  const agent = request.agent(app.getHttpServer());
  agent.set('Cookie', SESSION_COOKIE);
  agent.set('Origin', origin);
  return { app, service, db, calls, logs, config, bundle: openedBundle, agent,
    async close(drop = !options.db) {
      await app.close().catch(() => undefined);
      await service.operations.shutdown().catch(() => undefined);
      if (drop) await db.close();
    } };
}

export async function submit(agent: ReturnType<typeof request>, content: string, idempotencyKey: string, sessionId: string | null = null): Promise<SubmitTurnResponse> {
  const path = sessionId ? `/api/sessions/${sessionId}/turns` : '/api/sessions';
  const response = await agent.post(path).send({ sessionId, content, idempotencyKey });
  expect(response.status).toBe(202);
  return submitTurnResponseSchema.parse(response.body);
}

export async function streamText(agent: ReturnType<typeof request>, accepted: SubmitTurnResponse): Promise<string> {
  const response = await agent.get(`/api${accepted.streamPath}`);
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/event-stream');
  return response.text;
}

export async function listen(app: NestExpressApplication): Promise<{ port: number; close: () => Promise<void> }> {
  const existing = app.getHttpServer().address();
  if (!existing) await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') throw new Error('loopback port missing');
  return { port: address.port, close: () => app.close() };
}

export function readFirstChunk(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method: 'GET',
      headers: { Cookie: SESSION_COOKIE, Origin: 'http://localhost:5173' } }, (res) => {
      res.once('data', (chunk: Buffer) => { req.destroy(); resolve(chunk.toString('utf8')); });
      res.once('error', reject);
    });
    req.once('error', reject);
    req.end();
  });
}

export function delayedFrames(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(chunk('Hello')));
      await new Promise((resolve) => setTimeout(resolve, 300));
      controller.enqueue(encoder.encode(`${chunk('', 'stop')}${usage}${done}`));
      controller.close();
    },
  });
}

export { chunk, done, usage, FRAMES, COLLECTIONS };
