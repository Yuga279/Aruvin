/**
 * ============================================================================
 * FILE: latency-runtime-fixture.ts
 * LOCATION: backend/test/performance/latency-runtime-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compose real persistence, ownership, stock saver, telemetry, and runtime
 *    adapters over the deterministic BSON fake driver and DependencyProbe.
 *
 * ROLE IN PROJECT:
 *    Provides the offline whole-runtime latency baseline and regression harness
 *    for text and Calendar turns without replacing ownership or checkpointer
 *    with in-memory no-ops.
 *
 * KEY COMPONENTS:
 *    - createLatencyFixture: Assembles createPersistenceBundle, observePersistence,
 *      observedRuntime, and text/Calendar runtime fixtures over DependencyProbe.
 * ============================================================================
 */

import type { MongoClient } from 'mongodb';
import type { SubmitTurnResponse } from '../../src/contracts/api.js';
import type { CalendarReplyReference } from '../../src/contracts/calendar-authority.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { createPersistenceBundle, type PersistenceBundle } from '../../src/persistence/persistence.js';
import { observePersistence } from '../../src/operations/observe-persistence.js';
import { observedRuntime } from '../../src/operations/observed-runtime.js';
import { Readiness } from '../../src/operations/readiness.js';
import { Telemetry } from '../../src/operations/telemetry.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { PROPOSED_MEMORY_TEXT_POLICY } from '../../src/chat-runtime/memory-text.js';
import { textConfigFixture } from '../runtime/text-config-fixture.js';
import { calendarFixture, type CalendarRuntimeFixture } from '../runtime/calendar-runtime.fixture.js';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import type { DependencyProbe } from './dependency-probe.js';

export type TurnMilestones = {
  firstDispatchMs: number | null;
  firstDeltaMs: number | null;
  modelEndMs: number | null;
  sealMs: number | null;
  terminalMs: number | null;
  releaseMs: number | null;
};

export type TurnMeasurement = {
  logicalReads: number;
  logicalWrites: number;
  wireReads: number;
  wireWrites: number;
  wireFailed: number;
  wireCommands: Record<string, number>;
  observerReads: number;
  observerWrites: number;
  observerFailed: number;
  ownershipGuardReads: number;
  saverReads: number;
  saverWrites: number;
  waves: number;
  elapsedMs: number;
  busyMs: number;
  overlapMs: number;
  phases: Record<string, number>;
  phaseMs: Record<string, number>;
  origins: Record<string, number>;
  collections: Record<string, number>;
  milestones: TurnMilestones;
  storageWaves: { preDispatch: number | null; firstAnswer: number | null; postSeal: number | null };
  sealedCheckpointMs: number | null;
  postSealTailMs: number | null;
};

export async function createLatencyFixture(input: {
  path: 'text' | 'calendar';
  probe: DependencyProbe;
  readMs: number;
  writeMs: number;
  memoryFirst?: boolean;
}) {
  const { path, probe, readMs, writeMs } = input;
  const dbName = 'synthetic-latency';
  const memory = calendarMemory(probe, { databaseName: dbName });
  const fakeClient = Object.assign(memory.commandSource, {
    appendMetadata: () => undefined,
    db: () => memory.store.db,
    close: async () => undefined,
  }) as unknown as MongoClient;

  const budgets = { ...DEFAULT_BUDGETS };
  // Run bootstrap and index setup outside measured turns at 0 ms.
  const rawBundle = await probe.drive(
    () => createPersistenceBundle(fakeClient, dbName, budgets, 'latency-executor'),
    0,
    0,
  );

  const telemetryLines: string[] = [];
  let milestones: TurnMilestones = {
    firstDispatchMs: null,
    firstDeltaMs: null,
    modelEndMs: null,
    sealMs: null,
    terminalMs: null,
    releaseMs: null,
  };

  const telemetry = new Telemetry(line => {
    telemetryLines.push(line);
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.kind === 'process') {
        if (parsed.stage === 'finalization' && parsed.state === 'start' && milestones.sealMs === null) {
          milestones.sealMs = probe.elapsedMs;
        }
        if (parsed.stage === 'slot-released' && milestones.releaseMs === null) {
          milestones.releaseMs = probe.elapsedMs;
        }
        if (parsed.stage === 'terminal-delivered' && milestones.terminalMs === null) {
          milestones.terminalMs = probe.elapsedMs;
        }
      }
    } catch {
      // Ignore malformed lines in test listener.
    }
  }, () => probe.elapsedMs);
  telemetry.monotonic = () => probe.elapsedMs;

  const capturedCounters: Array<ReturnType<Telemetry['databaseCounts']>> = [];
  let dispatchWave: number | null = null;
  let firstAnswerWave: number | null = null;
  let sealedWave: number | null = null;
  let sealedCheckpointMs: number | null = null;
  let executingAttempt: string | null = null;
  // Observe the existing acknowledged saver call, never issue extra storage work.
  const createCheckpoints = rawBundle.checkpoints.create.bind(rawBundle.checkpoints);
  rawBundle.checkpoints.create = async (...args) => {
    const setup = await createCheckpoints(...args);
    const bind = setup.bind.bind(setup);
    setup.bind = (...bindArgs) => {
      const saver = bind(...bindArgs);
      const put = saver.put.bind(saver);
      saver.put = async (...putArgs) => {
        const result = await put(...putArgs);
        const values = putArgs[1].channel_values;
        const input = values.input as { attempt?: { attemptId?: string } } | undefined;
        if (sealedWave === null && executingAttempt !== null && values.sealed === true
          && input?.attempt?.attemptId === executingAttempt) {
          sealedWave = probe.waves;
          sealedCheckpointMs = probe.elapsedMs;
        }
        return result;
      };
      return saver;
    };
    return setup;
  };
  const origInDbReq = telemetry.inDatabaseRequest.bind(telemetry);
  telemetry.inDatabaseRequest = <T>(job: () => T): T =>
    origInDbReq(() => {
      const res = job();
      if (res && typeof (res as unknown as Promise<unknown>).finally === 'function') {
        return (res as unknown as Promise<unknown>).finally(() => {
          capturedCounters.push(telemetry.databaseCounts());
        }) as unknown as T;
      }
      capturedCounters.push(telemetry.databaseCounts());
      return res;
    });
  const origInTurn = telemetry.inTurn.bind(telemetry);
  telemetry.inTurn = <T>(scope: { sessionId: string; turnId: string; attemptId: string }, job: () => T): T =>
    origInTurn(scope, () => {
      const res = job();
      if (res && typeof (res as unknown as Promise<unknown>).finally === 'function') {
        return (res as unknown as Promise<unknown>).finally(() => {
          capturedCounters.push(telemetry.databaseCounts());
        }) as unknown as T;
      }
      capturedCounters.push(telemetry.databaseCounts());
      return res;
    });

  const diagnostics = {
    emit: (fields: Record<string, unknown>) => telemetry.event('process', fields),
    run: <T>(scope: Record<string, unknown>, work: () => T) => telemetry.inDiagnosticScope(scope, work),
  };

  const persistence: PersistenceBundle = observePersistence(rawBundle, telemetry);
  const modelCalls: Record<string, unknown>[] = [];
  const frames: unknown[] = [];

  let calFixture: CalendarRuntimeFixture | null = null;
  let textFixture: ReturnType<typeof textConfigFixture>;

  if (path === 'calendar') {
    calFixture = await probe.drive(async () => {
      const created = calendarFixture(diagnostics, persistence);
      await created.ready;
      return created;
    }, 0, 0);
    textFixture = calFixture;
  } else {
    textFixture = textConfigFixture(
      textSnapshot(1),
      dependencies => ({
        ...dependencies,
        now: () => Date.parse('2026-10-28T00:00:00.000Z') + probe.elapsedMs,
        diagnostics,
        ...(input.memoryFirst ? { memoryFirst: { policy: { ...PROPOSED_MEMORY_TEXT_POLICY } } } : {}),
      }),
      persistence,
    );
  }

  // Wrap fetcher to record modelCalls and firstDispatchMs / modelEndMs on both paths.
  const baseImpl = textFixture.fetcher.getMockImplementation()!;
  textFixture.fetcher.mockImplementation(async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes('/chat/completions')) {
      if (milestones.firstDispatchMs === null) {
        milestones.firstDispatchMs = probe.elapsedMs;
        dispatchWave = probe.waves;
      }
      if (path === 'text' && init?.body) {
        modelCalls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      }
      const res = await baseImpl(url, init);
      if (milestones.modelEndMs === null) milestones.modelEndMs = probe.elapsedMs;
      return res;
    }
    return baseImpl(url, init);
  });

  // Clear bootstrap and connection-seeding events before measured turns begin.
  probe.reset();
  memory.calls.length = 0;
  memory.wireCalls.length = 0;
  telemetryLines.length = 0;

  const readiness = new Readiness({
    config: {
      ...DEFAULT_BUDGETS,
      persistence: { mongoUri: 'mongodb://127.0.0.1:27017/synthetic', mongoDbName: dbName, profile: 'native-mongodb' },
      openRouter: { apiKey: 'sk-test', baseUrl: 'https://openrouter.ai/api/v1', modelId: 'openai/gpt-4o-mini', dataCollection: 'deny' },
      identity: { userId: textFixture.identity.userId, source: 'authenticated-session' },
      topology: { executor: 'single-process', localCrashRecovery: false },
      budgets,
    } as never,
    persistence: () => persistence,
    runtime: () => textFixture.runtime,
    assets: () => true,
    limits: () => true,
  });

  const runtime = observedRuntime(() => textFixture.runtime, telemetry, readiness);
  let requestSeq = 1;

  const run = <T>(operation: () => Promise<T>): Promise<T> => probe.drive(operation, readMs, writeMs);

  const submit = (
    content = 'Hello',
    sessionId: string | null = null,
    options?: { idempotencyKey?: string; calendarReplyTo?: CalendarReplyReference },
  ): Promise<SubmitTurnResponse> => {
    const key = options?.idempotencyKey ?? `request-${String(requestSeq++).padStart(4, '0')}`;
    return runtime.submitTurn({
      identity: textFixture.identity,
      sessionId,
      content,
      idempotencyKey: key,
      ...(options?.calendarReplyTo ? { calendarReplyTo: options.calendarReplyTo } : {}),
    });
  };

  const retry = (
    sessionId: string,
    turnId: string,
    idempotencyKey?: string,
  ): Promise<SubmitTurnResponse> => {
    const key = idempotencyKey ?? `request-${String(requestSeq++).padStart(4, '0')}`;
    return runtime.retryTurn({
      identity: textFixture.identity,
      sessionId,
      turnId,
      idempotencyKey: key,
    });
  };

  const execute = (ids: SubmitTurnResponse, signal?: AbortSignal): Promise<void> => {
    executingAttempt = ids.attemptId;
    return runtime.executeTurn({
      userId: textFixture.identity.userId,
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      attemptId: ids.attemptId,
      signal: signal ?? new AbortController().signal,
      emit: async envelope => {
        frames.push(envelope);
        if (envelope.event.type === 'delta' && milestones.firstDeltaMs === null) {
          milestones.firstDeltaMs = probe.elapsedMs;
          firstAnswerWave = probe.waves;
        }
      },
      emitCalendar: async envelope => {
        frames.push(envelope);
        if (calFixture) calFixture.frames.push(envelope as never);
        if (envelope.event.type === 'delta' && milestones.firstDeltaMs === null) {
          milestones.firstDeltaMs = probe.elapsedMs;
          firstAnswerWave = probe.waves;
        }
      },
    });
  };

  const resetMetrics = () => {
    probe.reset();
    memory.calls.length = 0;
    memory.wireCalls.length = 0;
    telemetryLines.length = 0;
    capturedCounters.length = 0;
    dispatchWave = firstAnswerWave = sealedWave = sealedCheckpointMs = null;
    executingAttempt = null;
    milestones = {
      firstDispatchMs: null,
      firstDeltaMs: null,
      modelEndMs: null,
      sealMs: null,
      terminalMs: null,
      releaseMs: null,
    };
  };

  const measure = async <T>(operation: () => Promise<T>): Promise<{ result: T; metrics: TurnMeasurement }> => {
    resetMetrics();
    const snapBefore = telemetry.snapshot();
    const result = await run(operation);
    const snapAfter = telemetry.snapshot();
    const phases: Record<string, number> = {};
    const phaseMs: Record<string, number> = {};
    const origins: Record<string, number> = {};
    const collections: Record<string, number> = {};
    let busyMs = 0;
    let overlapMs = 0;
    let ownershipGuardReads = 0;
    for (const c of capturedCounters) {
      busyMs += c.busyMs;
      overlapMs += c.overlapMs;
      for (const [k, v] of Object.entries(c.phases)) phases[k] = (phases[k] ?? 0) + v;
      for (const [k, v] of Object.entries(c.phaseMs)) phaseMs[k] = (phaseMs[k] ?? 0) + v;
      for (const [k, v] of Object.entries(c.origins)) origins[k] = (origins[k] ?? 0) + v;
      for (const [k, v] of Object.entries(c.collections)) collections[k] = (collections[k] ?? 0) + v;
      ownershipGuardReads += c.details.filter(d => d.origin === 'ownership' && d.kind === 'read').length;
    }
    const wireReads = memory.wireCalls.filter(c => c.kind === 'read').length;
    const wireWrites = memory.wireCalls.filter(c => c.kind === 'write').length;
    const wireFailed = memory.wireCalls.filter(c => c.failed).length;
    const saverReads = memory.wireCalls.filter(
      c => c.kind === 'read' && (c.collection === 'checkpoints' || c.collection === 'checkpoint_writes'),
    ).length;
    const saverWrites = memory.wireCalls.filter(
      c => c.kind === 'write' && (c.collection === 'checkpoints' || c.collection === 'checkpoint_writes'),
    ).length;
    const wireCommands: Record<string, number> = {};
    for (const call of memory.wireCalls) {
      wireCommands[call.commandName] = (wireCommands[call.commandName] ?? 0) + 1;
    }
    return {
      result,
      metrics: {
        logicalReads: snapAfter.read.count - snapBefore.read.count + (snapAfter.checkpoint_read.count - snapBefore.checkpoint_read.count),
        logicalWrites: snapAfter.write.count - snapBefore.write.count + (snapAfter.checkpoint.count - snapBefore.checkpoint.count),
        wireReads,
        wireWrites,
        wireFailed,
        wireCommands,
        observerReads: snapAfter.mongo_read.count - snapBefore.mongo_read.count,
        observerWrites: snapAfter.mongo_write.count - snapBefore.mongo_write.count,
        observerFailed: snapAfter.mongo_failed.count - snapBefore.mongo_failed.count,
        ownershipGuardReads,
        saverReads,
        saverWrites,
        waves: probe.waves,
        elapsedMs: probe.elapsedMs,
        busyMs,
        overlapMs,
        phases,
        phaseMs,
        origins,
        collections,
        milestones: { ...milestones },
        storageWaves: { preDispatch: dispatchWave, firstAnswer: firstAnswerWave,
          postSeal: sealedWave === null ? null : probe.waves - sealedWave },
        sealedCheckpointMs,
        postSealTailMs: sealedCheckpointMs === null ? null : probe.elapsedMs - sealedCheckpointMs,
      },
    };
  };

  const close = async () => {
    runtime.stopAccepting();
    await run(async () => {
      await runtime.drain(5000);
      await persistence.owner.releaseExecutor();
      persistence.disposeDatabaseObservation();
      await fakeClient.close();
    });
  };

  return {
    runtime,
    rawRuntime: textFixture.runtime,
    persistence,
    identity: textFixture.identity,
    get modelCalls() {
      return path === 'calendar' ? calFixture!.modelBodies : modelCalls;
    },
    get googleEffects() {
      return calFixture?.effects ?? [];
    },
    frames,
    submit,
    retry,
    execute,
    run,
    close,
    telemetry,
    telemetryLines,
    telemetryRecords: () => telemetryLines.map(l => JSON.parse(l) as Record<string, unknown>),
    memory,
    calendar: calFixture,
    fetcher: textFixture.fetcher,
    publishConfig: (snap: Parameters<typeof textFixture.publish>[0]) => textFixture.publish(snap),
    setTestMaxMessagesInContext: (maxMessagesInContext: number) => {
      (rawBundle.messages.budgets as { maxMessagesInContext: number }).maxMessagesInContext = maxMessagesInContext;
      (rawBundle.memory.budgets as { maxMessagesInContext: number }).maxMessagesInContext = maxMessagesInContext;
      const current = textFixture.currentConfig.current();
      if (current) {
        textFixture.publish({
          ...current,
          budgets: { ...current.budgets, maxMessagesInContext },
        });
      }
    },
    resetMetrics,
    measure,
  };
}
