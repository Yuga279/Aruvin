/**
 * ============================================================================
 * FILE: telemetry.spec.ts
 * LOCATION: backend/test/operations/telemetry.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove telemetry redacts secrets, hashes identifiers, and stays finite.
 *
 * ROLE IN PROJECT:
 *    Prevents operational logs from carrying transcripts, credentials, stacks,
 *    or per-session metric labels before P9 wires a rotated sink.
 *
 * KEY COMPONENTS:
 *    - Allowlist projection: Discards arbitrary fields and throwing getters.
 *    - Request context: Retains only server-created UUID request identity.
 * ============================================================================
 */

import { vi } from 'vitest';
import { Telemetry, shouldWriteStdoutLog, writeStdoutLog } from '../../src/operations/telemetry.js';

it('retains bounded turn and model timing milestones at normal log level', () => {
  for (const stage of ['acceptance-durable', 'admission-returned', 'model-dispatch',
    'model-response', 'model-first-event', 'model-first-output', 'model-first-text',
    'model-stream-end', 'model-complete', 'finalization', 'attempt-terminal-durable']) {
    expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'process', stage, state: 'ok' })), stage).toBe(true);
  }
  for (const stage of ['stt-end-of-turn', 'response-prepared', 'tts-first-submit', 'tts-first-audio', 'delivery-settled'])
    expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'voice-pipeline', stage })), stage).toBe(true);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'process', stage: 'token' }))).toBe(false);
});
import { observeMethods } from '../../src/operations/observe-persistence.js';
it('hashes correlation identifiers, discards arbitrary fields and bounds metric cardinality', () => {
  const lines: string[] = []; const t = new Telemetry(s => { lines.push(s); });
  t.event('accounting', { sessionId:'private prompt', attemptId:'Bearer secret', generationId:'sk-real',
    content:'private prompt', authorization:'Bearer secret', error:new Error('secret') });
  const text = lines.join('\n');
  for (const value of ['private prompt','Bearer secret','sk-real','authorization','content','stack'])
    expect(text).not.toContain(value);
  expect(JSON.parse(lines[0]).sessionId).toMatch(/^h:[a-f0-9]{24}$/);
  for (let i=0; i<10000; i++) t.event('accounting', { sessionId:String(i) });
  expect(Object.keys(t.snapshot())).toEqual(Object.keys(new Telemetry(() => undefined).snapshot()));
  expect(() => t.event('accounting', { get sessionId() { throw new Error('secret'); } })).not.toThrow();
});
it('retains only server-created request identity in async scope, not arbitrary headers', async () => {
  const lines: string[] = []; const t = new Telemetry(s => { lines.push(s); });
  await t.inRequest('00000000-0000-4000-8000-000000000001', async () => {
    await Promise.resolve(); t.event('request');
  });
  expect(JSON.parse(lines[0]).requestId).toBe('00000000-0000-4000-8000-000000000001');
});
it('keeps exact safe process facts and never enables payload detail', async () => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); }, () => 0);
  await t.inRequest('00000000-0000-4000-8000-000000000001', () =>
    t.inTurn({ sessionId: 'private-session', turnId: 'private-turn', attemptId: 'private-attempt' }, async () => {
      await Promise.resolve();
      t.event('process', {
        stage: 'cursor', state: 'rejected', tool: 'calendar_list_calendars',
        schemaRevision: 'google-calendar.v2', reason: 'cursor-signature',
        code: 'CALENDAR_INPUT_REJECTED', field: 'pageToken', expected: 'valid-cursor',
        constraint: 'signed-cursor', suppliedType: 'string', presence: 'present',
        origin: 'local', delivery: 'not-sent', correctionAttempt: 1, correctionLimit: 2,
        durationMs: 7, dispatchId: 'private-dispatch', providerRequestId: 'private-provider',
        detail: true, arguments: 'secret-cursor', content: 'secret-prompt',
        authorization: 'Bearer secret', error: new Error('secret-stack'),
      });
    }));
  const record = JSON.parse(lines[0]!) as Record<string, unknown>;
  expect(record).toMatchObject({ diagnosticVersion: 1, stage: 'cursor', state: 'rejected',
    reason: 'cursor-signature', code: 'CALENDAR_INPUT_REJECTED', field: 'pageToken',
    origin: 'local', delivery: 'not-sent', correctionAttempt: 1, correctionLimit: 2 });
  expect(record.dispatchId).toMatch(/^h:[a-f0-9]{24}$/);
  expect(record.providerRequestId).toMatch(/^h:[a-f0-9]{24}$/);
  expect(record.summary).toEqual(expect.stringContaining('cursor-signature'));
  expect(Buffer.byteLength(lines[0]!, 'utf8')).toBeLessThanOrEqual(4096);
  for (const value of ['private-session', 'private-turn', 'private-attempt', 'private-dispatch',
    'private-provider', 'secret-cursor', 'secret-prompt', 'Bearer secret', 'secret-stack']) {
    expect(lines.join('\n')).not.toContain(value);
  }
  expect(record).not.toHaveProperty('detail');
});
it('isolates throwing sinks and refuses arbitrary code, field and tool labels', () => {
  const t = new Telemetry(() => { throw new Error('secret'); });
  expect(() => t.event('process', { stage: 'terminal' })).not.toThrow();
  expect(t.snapshot().log_failure.count).toBe(1);
  const lines: string[] = [];
  new Telemetry(line => { lines.push(line); }).event('process', {
    stage: 'validation', tool: 'private-tool', code: 'PRIVATE_SECRET', reason: 'private-reason',
    field: 'private-field', durationMs: Infinity, correctionAttempt: NaN,
  });
  const r = JSON.parse(lines[0]!);
  for (const key of ['tool', 'code', 'reason', 'durationMs', 'correctionAttempt']) expect(r).not.toHaveProperty(key);
  expect(r.field).toBe('$');
  expect(lines[0]).not.toContain('private-');
});
it('retains bounded runtime failure kinds without accepting arbitrary exception names', () => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); });
  t.event('process', { stage: 'runtime-error', failureKind: 'validation', message: 'private payload' });
  t.event('process', { stage: 'runtime-error', failureKind: 'private exception' });
  expect(JSON.parse(lines[0]).failureKind).toBe('validation');
  expect(JSON.parse(lines[1])).not.toHaveProperty('failureKind');
  expect(lines.join('\n')).not.toContain('private');
});
it('drops throwing getters, proxies and custom toString without leaking', () => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); });
  expect(() => t.event('process', {
    get stage() { throw new Error('secret-getter'); },
    toString() { return 'secret-tostring'; },
  })).not.toThrow();
  expect(t.snapshot().log_failure.count).toBe(1);
  expect(lines).toHaveLength(0);
  const proxy = new Proxy({ stage: 'terminal' }, {
    get(_target, prop) {
      if (prop === 'reason') throw new Error('secret-proxy');
      return Reflect.get(_target, prop);
    },
  });
  expect(() => t.event('process', proxy)).not.toThrow();
  expect(t.snapshot().log_failure.count).toBe(2);
  t.event('process', {
    stage: 'terminal',
    accountingStatus: { toString() { return 'secret-accounting'; } },
  });
  expect(lines.join('\n')).not.toContain('secret-');
  expect(JSON.parse(lines[0]!)).not.toHaveProperty('accountingStatus');
});
it('omits unknown and giant values before serialization', () => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); });
  t.event('process', {
    stage: 'validation', nested: { secret: 'payload' }, detail: { prompt: 'x'.repeat(9000) },
    arguments: { eventId: 'PRIVATE' }, content: 'x'.repeat(9000), extra: 1,
  });
  expect(lines).toHaveLength(1);
  const record = JSON.parse(lines[0]!) as Record<string, unknown>;
  expect(record.stage).toBe('validation');
  expect(record.diagnosticVersion).toBe(1);
  for (const key of ['nested', 'detail', 'arguments', 'content', 'extra']) {
    expect(record).not.toHaveProperty(key);
  }
  expect(lines[0]).not.toContain('payload');
  expect(lines[0]).not.toContain('PRIVATE');
  expect(Buffer.byteLength(lines[0]!, 'utf8')).toBeLessThanOrEqual(4096);
});
it('clamps finite numeric bounds and omits empty oversized NaN and Infinity identifiers', () => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); });
  t.event('process', {
    stage: 'validation', field: 'unknown-name', durationMs: -3, limit: 2_000_000,
    correctionAttempt: 1001, correctionLimit: 1.5, dispatchId: '', attemptId: 'x'.repeat(201),
    schemaFingerprint: 'not-hex',
  });
  const first = JSON.parse(lines[0]!) as Record<string, unknown>;
  expect(first.field).toBe('$');
  expect(first.durationMs).toBe(0);
  expect(first.limit).toBe(1048576);
  expect(first.correctionAttempt).toBe(1000);
  expect(first).not.toHaveProperty('correctionLimit');
  expect(first).not.toHaveProperty('dispatchId');
  expect(first).not.toHaveProperty('attemptId');
  expect(first).not.toHaveProperty('schemaFingerprint');
  t.event('process', {
    stage: 'terminal', durationMs: Number.NaN, limit: Number.POSITIVE_INFINITY,
    correctionAttempt: Number.NEGATIVE_INFINITY, schemaFingerprint: 'a'.repeat(64),
  });
  const second = JSON.parse(lines[1]!) as Record<string, unknown>;
  expect(second).not.toHaveProperty('durationMs');
  expect(second).not.toHaveProperty('limit');
  expect(second).not.toHaveProperty('correctionAttempt');
  expect(second.schemaFingerprint).toBe('a'.repeat(64));
  t.event('process', { stage: 'not-a-stage', reason: 'missing' });
  expect(lines).toHaveLength(2);
});
it('keeps metric keys stable across ten thousand distinct identifiers', () => {
  const t = new Telemetry(() => undefined);
  const keys = Object.keys(t.snapshot());
  for (let i = 0; i < 10_000; i++) t.event('process', { stage: 'terminal', attemptId: String(i) });
  expect(Object.keys(t.snapshot())).toEqual(keys);
});
it('isolates concurrent diagnostic scopes and restores the outer store', async () => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); });
  await t.inRequest('00000000-0000-4000-8000-000000000001', async () => {
    await t.inTurn({ sessionId: 'outer-session', turnId: 'outer-turn', attemptId: 'outer-attempt' }, async () => {
      const inner = t.inDiagnosticScope({ attemptId: 'inner-attempt', dispatchId: 'inner-dispatch' }, async () => {
        await Promise.resolve();
        t.event('process', { stage: 'model-dispatch' });
        return 'inner';
      });
      expect(await inner).toBe('inner');
      t.event('process', { stage: 'terminal' });
    });
  });
  const records = lines.map(line => JSON.parse(line) as Record<string, unknown>);
  expect(records[0]!.attemptId).toMatch(/^h:[a-f0-9]{24}$/);
  expect(records[0]!.dispatchId).toMatch(/^h:[a-f0-9]{24}$/);
  expect(records[0]!.attemptId).not.toEqual(records[1]!.attemptId);
  expect(records[1]!).not.toHaveProperty('dispatchId');
  expect(records[0]!.sessionId).toEqual(records[1]!.sessionId);
});

it('tracks bounded per-turn driver commands, latency distributions, and event-loop delay', () => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); });
  t.inTurn({ sessionId: 's1', turnId: 't1', attemptId: 'a1' }, () => {
    t.recordDriverCommand('read', 4);
    t.recordDriverCommand('read', 25);
    t.recordDriverCommand('write', 120);
    const counts = t.turnDriverCounts();
    expect(counts).toEqual({ driverReads: 2, driverWrites: 1 });
    const delayMs = t.sampleEventLoopDelay();
    expect(delayMs).toBeGreaterThanOrEqual(0);
    t.event('process', { stage: 'terminal', chat: 'completed', durationMs: 149, ...counts, eventLoopDelayMs: delayMs });
  });
  expect(t.turnDriverCounts()).toEqual({ driverReads: 0, driverWrites: 0 });
  const snap = t.snapshot();
  expect(snap.driver_read.count).toBe(2);
  expect(snap.driver_write.count).toBe(1);
  expect(snap.event_loop_delay.count).toBe(1);
  const dist = t.distribution();
  expect(dist.driver_read).toEqual({ le10Ms: 1, le50Ms: 1, le250Ms: 0, le1000Ms: 0, gt1000Ms: 0 });
  expect(dist.driver_write).toEqual({ le10Ms: 0, le50Ms: 0, le250Ms: 1, le1000Ms: 0, gt1000Ms: 0 });
  const terminal = JSON.parse(lines[0]!) as Record<string, unknown>;
  expect(terminal).toMatchObject({ stage: 'terminal', chat: 'completed', driverReads: 2, driverWrites: 1 });
});

it('preserves request phase while attributing checkpoint operations to their origin', async () => {
  const t = new Telemetry(() => undefined);
  const saver = observeMethods({ async getTuple() { t.recordMongoCommand('read', 1, false); } },
    t, 'checkpoint_read', ['getTuple']);
  await t.inDatabaseRequest(() => t.inDatabasePhase('context','other', async () => {
    await saver.getTuple();
    const counts = t.databaseCounts();
    expect(counts.phases.context).toBe(1);
    expect(counts.origins.checkpoint).toBe(1);
  }));
});

it('keeps default stdout to outcomes and faults', () => {
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'process', stage: 'admission', state: 'start' }))).toBe(false);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'process', stage: 'persistence', state: 'ok' }))).toBe(false);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'request', ok: true }))).toBe(false);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'accounting', accountingStatus: 'known' }))).toBe(false);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'calendar', phase: 'executing' }))).toBe(false);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'voice-pipeline', stage: 'stt' }))).toBe(false);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'process', stage: 'terminal', chat: 'completed' }))).toBe(true);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'process', stage: 'task-outcome', task: 'success' }))).toBe(true);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'process', stage: 'validation', state: 'rejected' }))).toBe(true);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'request', ok: false, code: 'NOT_READY' }))).toBe(true);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'readiness', ok: false }))).toBe(true);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'voice-usage', action: 'warn' }))).toBe(true);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'voice-pipeline', code: 'VOICE_IDLE_TIMEOUT' }))).toBe(true);
  expect(shouldWriteStdoutLog(JSON.stringify({ kind: 'process', stage: 'admission' }), 'debug')).toBe(true);
  expect(shouldWriteStdoutLog('not-json')).toBe(false);
});

it('writes default stdout only when the line is noteworthy and the stream is writable', () => {
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const pressure = vi.spyOn(process.stdout, 'writableNeedDrain', 'get').mockReturnValue(false);
  try {
    writeStdoutLog(JSON.stringify({ kind: 'process', stage: 'admission', state: 'start' }));
    writeStdoutLog(JSON.stringify({ kind: 'process', stage: 'terminal', chat: 'completed' }));
    expect(write).toHaveBeenCalledTimes(1);
    write.mockClear();
    writeStdoutLog(JSON.stringify({ kind: 'process', stage: 'admission', state: 'start' }),
      { AURVIN_LOG_LEVEL: 'debug' });
    expect(write).toHaveBeenCalledTimes(1);
    write.mockClear();
    pressure.mockReturnValue(true);
    writeStdoutLog(JSON.stringify({ kind: 'process', stage: 'terminal', chat: 'completed' }));
    expect(write).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
    pressure.mockRestore();
  }
});
