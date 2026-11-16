/**
 * ============================================================================
 * FILE: app.controller.spec.ts
 * LOCATION: backend/src/app.controller.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify P9 application assembly, bootstrap, UI mount, and lifecycle gates.
 *
 * ROLE IN PROJECT:
 *    Owns the only P9 test file: scaffold greeting/health, shared operations
 *    wiring, HTTP admission, source-mount, fixture lifecycle, and native smoke.
 *
 * KEY COMPONENTS:
 *    - AppController: Greeting and legacy liveness against diagnostic mode.
 *    - P9 assembly: Composition, bootstrap, mount, lifecycle, native smoke.
 * ============================================================================
 */

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadBootstrapConfig } from './platform/config/bootstrap-config.js';
import { AURVIN_CONFIG } from './platform/tokens.js';
import { AppController } from './app.controller.js';
import { AppService, type AssemblyPorts } from './app.service.js';
import { AppModule } from './app.module.js';
import { OperationsService } from './operations/index.js';
import { ChatHttpService } from './http/index.js';
import { fixtureOptions } from '../test/http/fixtures.js';
import { loadFixedAssets } from './instructions/fixed-assets.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { configureApplication } from './main.js';
import { nativeDatabase } from '../test/persistence/native.js';
import { createPersistenceBundle, MongoConfigRepository, type PersistenceBundle } from './persistence/index.js';
import { FRAMES } from '../test/fixtures/openrouter/frames.js';
import { submitTurnResponseSchema } from './contracts/api.js';
import { AppError } from './platform/errors/app-error.js';
import type { ChatRuntime, RuntimeDependencies } from './chat-runtime/index.js';
import { MAX_CONFIG_DOCUMENT_BYTES, type StoredConfigDocument } from './contracts/admin-config.js';
import { defaultManageableSettings } from './platform/config/manageable-config.js';
import { CredentialService } from './admin-config/credential-service.js';
import { CredentialValidator } from './admin-config/credential-validation.js';
import { bootstrap as configBootstrap } from '../test/admin-config/fixtures.js';
import type { ConfigCasResult, ConfigRepository } from './contracts/config-runtime.js';

const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

function configuredDocument(): StoredConfigDocument {
  const credentials = new CredentialService(configBootstrap.encryption,
    new CredentialValidator(async () => { throw new Error('fixture must not validate'); }));
  const settings = defaultManageableSettings();
  settings.openRouter.modelId = 'fixture/model';
  return {
    _id: 'aurvin', schemaVersion: 1, revision: 1, settings,
    credentials: {
      openrouter: {
        envelope: credentials.seal('openrouter', 'fixture-key'),
        validatedAt: '2026-10-13T12:00:00.000Z',
      },
      deepgram: null,
    },
    updatedAt: '2026-10-13T12:00:00.000Z', updatedBy: 'aurvin-dev-user',
  };
}

function memoryConfigRepository(initial: StoredConfigDocument | null = null) {
  let stored = initial === null ? null : structuredClone(initial);
  const repository: ConfigRepository = {
    read: async () => (stored === null ? null : structuredClone(stored)),
    createIfAbsent: async document => {
      if (stored) return { outcome: 'conflict', currentRevision: stored.revision } as ConfigCasResult;
      stored = structuredClone(document);
      return { outcome: 'confirmed', document: structuredClone(document) };
    },
    compareAndSwap: async (expected, document) => {
      if (stored?.revision !== expected) {
        return { outcome: 'conflict', currentRevision: stored?.revision ?? 0 } as ConfigCasResult;
      }
      stored = structuredClone(document);
      return { outcome: 'confirmed', document: structuredClone(document) };
    },
  };
  return repository;
}

const paths = {
  instructions: resolve('src/instructions/system.md'),
  knowledge: resolve('../product_knowledge.md'),
};
async function diagnostic() {
  return AppService.create(loadBootstrapConfig({}), { writeLog: () => undefined });
}

describe('AppController', () => {
  it('preserves the root greeting', async () => {
    const controller = new AppController(await diagnostic());
    expect(controller.getHello()).toBe('Hello from Aurvin');
  });
  it('keeps legacy health liveness-only', async () => {
    const service = await diagnostic();
    expect(new AppController(service).getHealth()).toEqual({ status: 'ok' });
    expect((await service.operations.readiness.read()).acceptReady).toBe(false);
    await service.operations.shutdown();
  });
});

describe('P9 assembly', () => {
  it('exports one operations instance and routes through its observed runtime', async () => {
    const service = await diagnostic();
    const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppService).useValue(service).compile();
    try {
      expect(module.get(OperationsService)).toBe(service.operations);
      expect(module.get(ChatHttpService).o.runtime).toBe(service.operations.runtime);
      expect(module.get(ChatHttpService).o.sessions).toBe(service.sessions);
    } finally {
      if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.NODE_ENV;
      if (previous.FRONTEND_ORIGIN === undefined) delete process.env.FRONTEND_ORIGIN;
      else process.env.FRONTEND_ORIGIN = previous.FRONTEND_ORIGIN;
      await module.close();
    }
  });
  it('does not open unverified persistence or probe the model', async () => {
    const open = vi.fn<AssemblyPorts['open']>();
    const limits = vi.fn<AssemblyPorts['limits']>();
    const service = await AppService.create(loadBootstrapConfig({
      PERSISTENCE_PROFILE: 'cosmos-mongodb-ru',
    }), { open, limits, writeLog: () => undefined });
    expect(open).not.toHaveBeenCalled();
    expect(limits).not.toHaveBeenCalled();
    const ready = await service.operations.readiness.read();
    expect(ready.issues).toContain('unverified_persistence');
    await expect(Promise.resolve().then(() => service.sessions.list('user', { cursor: null, limit: 20 })))
      .rejects.toMatchObject({ code: 'NOT_READY' });
    await service.operations.shutdown();
  });
  it('refuses an unverified profile with a URI without opening a config store', async () => {
    const open = vi.fn<AssemblyPorts['open']>(async () => {
      throw new AppError('NOT_READY', 'fixture storage unavailable');
    });
    const limits = vi.fn<AssemblyPorts['limits']>();
    const service = await AppService.create(loadBootstrapConfig({
      PERSISTENCE_PROFILE: 'cosmos-mongodb-ru', MONGODB_URI: 'fixture-only',
    }), { open, limits, writeLog: () => undefined });
    expect(open).not.toHaveBeenCalled();
    expect(limits).not.toHaveBeenCalled();
    const ready = await service.operations.readiness.read();
    expect(ready.issues).toContain('database');
    await expect(Promise.resolve().then(() => service.sessions.list('user', { cursor: null, limit: 20 })))
      .rejects.toMatchObject({ code: 'NOT_READY' });
    await service.operations.shutdown();
  });
  it('fails before opening storage when required assets cannot load', async () => {
    const open = vi.fn<AssemblyPorts['open']>();
    await expect(AppService.create(loadBootstrapConfig({}), {
      assets: async () => loadFixedAssets({ instructions: 'absent-p9-asset', knowledge: paths.knowledge }),
      open, writeLog: () => undefined,
    })).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(open).not.toHaveBeenCalled();
  });
  it('configures production admission before parsing and exposes diagnostic live/ready honestly', async () => {
    const service = await diagnostic();
    const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppService).useValue(service).compile();
    const app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApplication(app);
    await app.init();
    try {
      const agent = request(app.getHttpServer());
      await agent.get('/api').expect(503);
      await agent.get('/api/health').expect(503);
      await agent.get('/api/operations/live').expect(200);
      await agent.get('/api/operations/ready').expect(503);
      const blocked = await agent.post('/api/sessions').set('Content-Type', 'application/json')
        .send('{malformed').expect(403);
      expect(blocked.body.error?.code ?? blocked.body.code).toBe('FORBIDDEN');
      expect(blocked.headers['cache-control']).toContain('no-store');
      const allowed = await agent.options('/api/sessions')
        .set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST').expect(204);
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      const other = await agent.get('/api/health').set('Origin', 'https://other.invalid').expect(403);
      expect(other.headers['access-control-allow-origin']).not.toBe('https://other.invalid');
    } finally {
      if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.NODE_ENV;
      if (previous.FRONTEND_ORIGIN === undefined) delete process.env.FRONTEND_ORIGIN;
      else process.env.FRONTEND_ORIGIN = previous.FRONTEND_ORIGIN;
      await app.close();
    }
  });
  it('rejects unsupported topology and path-valued CORS configuration', async () => {
    expect(() => loadBootstrapConfig({ AURVIN_EXECUTOR_TOPOLOGY: 'multi-replica' }))
      .toThrow('Invalid application configuration.');
    expect(() => loadBootstrapConfig({ FRONTEND_ORIGIN: 'https://stage.invalid/path' }))
      .toThrow('Invalid application configuration.');
  });
  it('mounts the public chat boundary rather than the scaffold health screen', () => {
    const app = readFileSync(resolve('../frontend/src/App.tsx'), 'utf8');
    const css = readFileSync(resolve('../frontend/src/App.css'), 'utf8');
    const main = readFileSync(resolve('../frontend/src/main.tsx'), 'utf8');
    expect(app).toContain("from './features/chat/index.ts'");
    expect(app).toMatch(/<ChatProvider\b[^>]*\bclient=\{client\}/);
    expect(app).toMatch(/<ChatView\b/);
    expect(app).not.toMatch(/checkHealth|HealthResponse|React \+ NestJS|\/health/);
    expect(css).not.toMatch(/(?:^|\n)\s*(?:h1|code|\.page|\.status)\b/);
    expect(main).toContain('<StrictMode>');
    expect(main).toContain("if (!root) throw new Error('Aurvin root element is missing.')");
  });
  it('documents actual setup and does not promise credential-free chat or Azure certification', () => {
    const readme = readFileSync(resolve('../README.md'), 'utf8');
    expect(readme).toContain('npm ci');
    expect(readme).toContain('Node 22.22.3+');
    expect(readme).toContain('diagnostic mode');
    expect(readme).toContain('/api/operations/ready');
    expect(readme).toContain('single-process');
    expect(readme).toContain('not certified');
    expect(readme).toContain('src/instructions/system.md');
    expect(readme).not.toContain('Defaults work without');
  });
});

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI &&
  process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

nativeIt('P9 native assembled fixture chat completes and reopens its durable transcript', async () => {
  const db = await nativeDatabase();
  let app: NestExpressApplication | undefined;
  let service: AppService | undefined;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/models')) {
      return Response.json({ data: [{ id: 'fixture/model', context_length: 32768,
        top_provider: { max_completion_tokens: 4096 }, supported_parameters: ['max_tokens'] }] });
    }
    if (!String(url).endsWith('/chat/completions')) throw new Error('Unexpected fixture request');
    return new Response(FRAMES.normal, { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const config = loadBootstrapConfig({ PERSISTENCE_PROFILE: 'native-mongodb',
      MONGODB_URI: 'fixture-injected-only', MONGODB_DB_NAME: db.name,
      AURVIN_CONFIG_ENCRYPTION_KEY: MASTER_KEY });
    const credentials = new CredentialService(
      config.encryption, new CredentialValidator(fetcher));
    const settings = defaultManageableSettings();
    settings.openRouter.modelId = 'fixture/model';
    const stored: StoredConfigDocument = {
      _id: 'aurvin', schemaVersion: 1, revision: 1, settings,
      credentials: {
        openrouter: {
          envelope: credentials.seal('openrouter', 'fixture-key'),
          validatedAt: new Date().toISOString(),
        },
        deepgram: null,
      },
      updatedAt: new Date().toISOString(), updatedBy: 'aurvin-dev-user',
    };
    service = await AppService.create(config, {
      fetcher, writeLog: () => undefined,
      open: async c => {
        const bundle = await createPersistenceBundle(db.client, db.name, c.budgets);
        const repository = new MongoConfigRepository(bundle.owner.store, bundle.owner,
          MAX_CONFIG_DOCUMENT_BYTES);
        const seeded = await repository.createIfAbsent(stored);
        if (seeded.outcome !== 'confirmed') throw new Error('native fixture seed failed');
        return { ...bundle, close: async () => {
          await bundle.owner.drain(); await bundle.owner.releaseExecutor();
        } };
      },
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(config)
      .overrideProvider(AppService).useValue(service).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApplication(app); await app.init();
    const agent = request(app.getHttpServer());
    await agent.get('/api/operations/ready').expect(200);
    // Admission succeeds here: malformed JSON must reach the bounded safe parser.
    await agent.post('/api/sessions').set('Content-Type', 'application/json')
      .send('{malformed').expect(400);
    await agent.post('/api/sessions').send({ sessionId: null,
      content: 'x'.repeat(262145), idempotencyKey: 'p9-oversize-request' }).expect(413);
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
    const accepted = submitTurnResponseSchema.parse((await agent.post('/api/sessions')
      .send({ sessionId: null, content: 'Synthetic P9 hello', idempotencyKey: 'p9-smoke-request-1' })
      .expect(202)).body);
    const streamed = await agent.get(`/api${accepted.streamPath}`).expect(200);
    expect(streamed.headers['content-type']).toContain('text/event-stream');
    expect(streamed.text).toContain('Hello 🌍');
    expect(streamed.text).toContain('"type":"completed"');
    const status = await agent.get(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}`).expect(200);
    expect(status.body.status).toBe('completed');
    const archive = await agent.get(`/api/sessions/${accepted.sessionId}/messages`).expect(200);
    expect(archive.body.items.map((m: { content: string }) => m.content))
      .toEqual(['Synthetic P9 hello', 'Hello 🌍']);
    const generations = calls.filter(c => c.method === 'POST');
    expect(generations).toHaveLength(1);
    expect(generations[0].body).toMatchObject({ user: 'aurvin-dev-user', model: 'fixture/model' });
    await agent.get('/api/operations/ready').expect(200);
    expect(calls.filter(c => c.url.endsWith('/models'))).toHaveLength(1);
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    await app.close(); app = undefined;
    expect(await service.operations.shutdown()).toEqual({ safe: true });
    // Client still connected in this test's close port; archive is durable after app close.
    const persisted = await db.db.collection('messages').find({
      userId: 'aurvin-dev-user', sessionId: accepted.sessionId,
    }).sort({ sequence: 1 }).toArray();
    expect(persisted.map(m => m.content)).toEqual(['Synthetic P9 hello', 'Hello 🌍']);
  } finally {
    if (app) await app.close();
    else if (service) await service.operations.shutdown();
    await db.close(); // Existing helper drops only the generated isolated test database.
  }
}, 60000);

async function assembledFixture(failCatalogue = false, seed: StoredConfigDocument | null = null) {
  const config = loadBootstrapConfig({ PERSISTENCE_PROFILE: 'native-mongodb', MONGODB_URI: 'fixture-only',
    AURVIN_CONFIG_ENCRYPTION_KEY: MASTER_KEY });
  const http = fixtureOptions();
  const close = vi.fn(async () => undefined);
  const drain = http.runtime.drain;
  const unused = () => { throw new Error('Unused fixture port'); };
  // P9 tests need only bundle shape, readiness and P6 repository forwarding.
  const persistence = {
    sessions: http.sessions, messages: http.messages,
    memory: { get: unused, put: unused },
    metadata: { putAttempt: unused, getAttempt: unused, getAttemptByIdempotency: unused, putAccounting: unused },
    owner: { assertExecutor: vi.fn(async () => undefined) },
    checkpoints: { create: unused }, ping: vi.fn(async () => true), close,
  } as unknown as PersistenceBundle & { close: () => Promise<void> };
  // Deliberately scoped test-double cast: no production or real-runtime use.
  const limits = vi.fn(async () => {
    if (failCatalogue) throw new AppError('CONFIGURATION_ERROR', 'fixture catalogue unavailable');
    return { modelId: 'fixture/model', contextTokens: 32768, outputTokens: 4096,
      supportsMaxTokens: true, source: 'fixture' as const };
  });
  const runtime = vi.fn<(dependencies: RuntimeDependencies) => ChatRuntime>(() => http.runtime);
  const service = await AppService.create(config, {
    open: async () => persistence, limits, runtime, writeLog: () => undefined,
    configRepository: () => memoryConfigRepository(seed),
  });
  return { service, limits, runtime, close, drain, http };
}

describe('P9 lifecycle', () => {
  it('keeps database reads and diagnostic liveness when catalogue verification fails', async () => {
    const f = await assembledFixture(true, configuredDocument());
    expect(f.limits).toHaveBeenCalledTimes(1);
    // Healthy storage still opens one runtime; the null pointer rejects inference.
    expect(f.runtime).toHaveBeenCalledTimes(1);
    const ready = await f.service.operations.readiness.read();
    expect(ready).toMatchObject({ live: true, readReady: false, acceptReady: false });
    expect(ready.issues).toContain('authentication');
    expect(ready.issues).toContain('model_limits');
    expect(await f.service.sessions.list('server-user', { cursor: null, limit: 20 }))
      .toEqual({ items: [], nextCursor: null });
    await f.service.operations.shutdown();
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('stops and drains the single runtime before closing persistence exactly once', async () => {
    const f = await assembledFixture();
    const order: string[] = [];
    vi.spyOn(f.http.runtime, 'stopAccepting').mockImplementation(() => { order.push('stop'); });
    vi.spyOn(f.http.runtime, 'drain').mockImplementation(async () => {
      order.push('drain'); return { drained: true, active: 0, unresolvedWrites: 0 };
    });
    f.close.mockImplementation(async () => { order.push('close'); });
    expect(f.runtime).toHaveBeenCalledTimes(1);
    expect(f.runtime.mock.calls[0][0].persistence.messages).not.toBe(f.http.messages);
    expect(f.service.operations.telemetry).toBe(f.service.telemetry);
    await Promise.all([f.service.operations.shutdown(), f.service.operations.shutdown()]);
    expect(order).toEqual(['stop', 'drain', 'close']);
  });
  it('retains persistence ownership when drain is unsafe', async () => {
    const f = await assembledFixture();
    vi.spyOn(f.http.runtime, 'drain').mockResolvedValue({ drained: false, active: 1, unresolvedWrites: 0 });
    expect(await f.service.operations.shutdown()).toEqual({ safe: false });
    expect(f.close).not.toHaveBeenCalled();
  });
  it('refuses a competing executor rather than silently booting a chat service', async () => {
    await expect(AppService.create(loadBootstrapConfig({ PERSISTENCE_PROFILE: 'native-mongodb',
      MONGODB_URI: 'fixture-only' }), { open: async () => {
      throw new AppError('UNSUPPORTED_TOPOLOGY', 'fixture competing executor');
    }, writeLog: () => undefined })).rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
  });
});

