/**
 * ============================================================================
 * FILE: native-runtime.ts
 * LOCATION: backend/test/performance/native-runtime.ts
 * PURPOSE: Measure real native storage with scripted model/Calendar transports.
 * ROLE IN PROJECT: Reuses production repositories, ownership and default saver;
 *    measurement excludes bootstrap/seeding/status checks and final DB deletion.
 * KEY COMPONENTS: nativeLatencyFixture; command listeners and acknowledged seal.
 * ============================================================================
 */
import { performance } from 'node:perf_hooks';
import type { CommandStartedEvent, CommandSucceededEvent, CommandFailedEvent } from 'mongodb';
import type { SubmitTurnResponse } from '../../src/contracts/api.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { observePersistence } from '../../src/operations/observe-persistence.js';
import { Telemetry } from '../../src/operations/telemetry.js';
import { Readiness } from '../../src/operations/readiness.js';
import { loadConfig } from '../../src/platform/config/load-config.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { textConfigFixture } from '../runtime/text-config-fixture.js';
import { calendarFixture } from '../runtime/calendar-runtime.fixture.js';
import { openNativePerformanceDatabase } from './native-database.js';
import { NativeCommandMeasurement } from './native-safety.js';

export async function nativeLatencyFixture(path: 'text' | 'calendar') {
  const database = await openNativePerformanceDatabase();
  let bundle: Awaited<ReturnType<typeof createPersistenceBundle>> | undefined;
  try {
    bundle = await createPersistenceBundle(database.client, database.name, { ...DEFAULT_BUDGETS }, 'native-latency-executor');
    const raw = bundle;
    let measurement: NativeCommandMeasurement | null = null;
    let executingAttempt: string | null = null;
    const create = raw.checkpoints.create.bind(raw.checkpoints);
    raw.checkpoints.create = async (...args) => {
      const setup = await create(...args);
      const bind = setup.bind.bind(setup);
      setup.bind = (...args) => {
        const saver = bind(...args);
        const put = saver.put.bind(saver);
        saver.put = async (...args) => {
          const result = await put(...args);
          const values = args[1].channel_values;
          const input = values.input as { attempt?: { attemptId?: string } } | undefined;
          if (executingAttempt !== null && values.sealed === true && input?.attempt?.attemptId === executingAttempt) measurement?.mark('seal');
          return result;
        };
        return saver;
      };
      return setup;
    };
    const telemetry = new Telemetry(() => {});
    const persistence = observePersistence(raw, telemetry);
    const diagnostics = {
      emit: (fields: Record<string, unknown>) => {
        if (fields.stage === 'slot-released') measurement?.mark('release');
        if (fields.stage === 'finalization' && fields.state === 'start') measurement?.mark('finalizationStart');
        telemetry.event('process', fields);
      },
      run: <T>(scope: Record<string, unknown>, work: () => T) => telemetry.inDiagnosticScope(scope, work),
    };
    const calendar = path === 'calendar' ? calendarFixture(diagnostics, persistence) : null;
    if (calendar) await calendar.ready;
    const fixture = calendar ?? textConfigFixture(textSnapshot(1), deps => ({ ...deps, diagnostics }), persistence);
    const textBodies: Record<string, unknown>[] = [];
    const fetch = fixture.fetcher.getMockImplementation()!;
    fixture.fetcher.mockImplementation(async (url, init) => {
      const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (address.includes('/chat/completions')) {
        measurement?.mark('dispatch');
        if (!calendar && typeof init?.body === 'string') textBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return fetch(url, init); // Existing fixture only: never global/network fetch.
    });
    const started = (event: CommandStartedEvent) => measurement?.start(event);
    const succeeded = (event: CommandSucceededEvent) => measurement?.finish(event);
    const failed = (event: CommandFailedEvent) => measurement?.finish(event, true);
    database.client.on('commandStarted', started);
    database.client.on('commandSucceeded', succeeded);
    database.client.on('commandFailed', failed);
    const frames: Array<{ event: { type: string; status?: string } }> = [];
    const execute = (ids: SubmitTurnResponse) => {
      executingAttempt = ids.attemptId;
      const emit = async (frame: { event: { type: string; status?: string } }) => {
        frames.push(frame);
        if (frame.event.type === 'delta') measurement?.mark('firstAnswer');
        if (frame.event.type === 'completed') measurement?.mark('terminal');
      };
      return fixture.runtime.executeTurn({ userId: fixture.identity.userId, ...ids,
        signal: new AbortController().signal, emit, emitCalendar: emit });
    };
    const config = loadConfig({ AURVIN_USER_ID: fixture.identity.userId });
    const readiness = new Readiness({
      config: { ...config,
        persistence: { ...config.persistence, profile: 'native-mongodb', mongoUri: 'operator-test-uri-present', mongoDbName: database.name } },
      currentConfig: fixture.currentConfig, runtime: () => fixture.runtime,
      assetsReady: () => true, modelLimitsReady: () => true, ping: () => raw.ping(),
      assertExecutor: () => raw.owner.assertExecutor(), closePersistence: async () => {},
      transportSnapshot: () => ({}) as never, writeLog: () => {},
    });
    return { database, persistence, fixture, calendar, execute, frames,
      modelBodies: calendar?.modelBodies ?? textBodies,
      readyAfterCleanup: () => readiness.read(),
      async measure<T>(work: () => Promise<T>) {
        if (measurement) throw new Error('Overlapping native measurement forbidden.');
        frames.length = 0; textBodies.length = 0;
        if (calendar) calendar.modelBodies.length = 0;
        executingAttempt = null;
        const current = new NativeCommandMeasurement(database.name, () => performance.now());
        measurement = current;
        try {
          const result = await work();
          current.mark('settled');
          return { result, metrics: current.summary() };
        } finally { measurement = null; }
      },
      async close() {
        fixture.runtime.stopAccepting();
        try {
          const drained = await fixture.runtime.drain(15_000);
          if (!drained.drained) throw new Error('Native fixture did not drain.');
          await raw.owner.drain();
          await raw.owner.releaseExecutor();
        } finally {
          database.client.off('commandStarted', started);
          database.client.off('commandSucceeded', succeeded);
          database.client.off('commandFailed', failed);
          raw.disposeDatabaseObservation();
          await database.close();
        }
      },
    };
  } catch {
    try { await bundle?.owner.drain(); await bundle?.owner.releaseExecutor(); }
    finally { await database.close(); }
    throw new Error('Native runtime preparation failed; connection details suppressed.');
  }
}
