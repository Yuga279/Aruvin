/**
 * ============================================================================
 * FILE: native-safety.ts
 * LOCATION: backend/test/performance/native-safety.ts
 * PURPOSE: Fail closed before native preparation can create a client.
 * ROLE IN PROJECT: Isolated performance authorization and payload-free timing.
 * KEY COMPONENTS: authorizeNative, nativePreflight, NativeCommandMeasurement.
 * ============================================================================
 */
export const NATIVE_LATENCY_SCENARIOS = [
  { name: 'new-text', path: 'text', prior: 0 },
  { name: 'follow-up-1', path: 'text', prior: 1 },
  { name: 'follow-up-20', path: 'text', prior: 20 },
  { name: 'calendar-text', path: 'calendar', prior: 0 },
  { name: 'calendar-read', path: 'calendar', prior: 0 },
  { name: 'calendar-create', path: 'calendar', prior: 0 },
] as const;

export function authorizeNative(env: NodeJS.ProcessEnv) {
  // Ordering matters: disabled discovery must not even access a possible URI.
  if (env.AURVIN_NATIVE_PERF_ENABLE !== 'authorized') throw new Error('Native performance execution disabled.');
  if (env.AURVIN_NATIVE_PERF_DEDICATED_REPLICA_SET !== 'attested'
    || env.AURVIN_NATIVE_PERF_CREATE_DROP !== 'approved'
    || env.AURVIN_NATIVE_PERF_SAMPLE_LOAD !== 'approved-max-18-databases-81-turns'
    || env.AURVIN_TEST_DB_PREFIX !== 'aurvin_p2_test_') {
    throw new Error('Native performance operator attestations are incomplete.');
  }
  const replicaSet = env.AURVIN_NATIVE_PERF_REPLICA_SET;
  const revision = env.AURVIN_NATIVE_PERF_REVISION;
  const label = env.AURVIN_NATIVE_PERF_LABEL;
  const samples = env.AURVIN_NATIVE_PERF_SAMPLES;
  if (!replicaSet || !/^[a-zA-Z0-9_-]{1,80}$/.test(replicaSet)
    || !revision || !/^[a-f0-9]{40}$/.test(revision)
    || (label !== 'baseline' && label !== 'current') || !samples || !/^[1-3]$/.test(samples)) {
    throw new Error('Native performance bounds or source provenance are invalid.');
  }
  const uri = env.AURVIN_TEST_MONGODB_URI;
  if (!uri?.trim()) throw new Error('Existing operator test URI is required.');
  return { uri, replicaSet, samples: Number(samples), revision, label };
}

export function nativePreflight(env: NodeJS.ProcessEnv) {
  // Only a policy probe: this placeholder is never a connection string or client input.
  // Validation delegates to authorizeNative; no second set of regex/token rules.
  const reference: NodeJS.ProcessEnv = {
    AURVIN_NATIVE_PERF_ENABLE: 'authorized',
    AURVIN_NATIVE_PERF_DEDICATED_REPLICA_SET: 'attested',
    AURVIN_NATIVE_PERF_CREATE_DROP: 'approved',
    AURVIN_NATIVE_PERF_SAMPLE_LOAD: 'approved-max-18-databases-81-turns',
    AURVIN_NATIVE_PERF_REPLICA_SET: 'offline-probe',
    AURVIN_NATIVE_PERF_REVISION: '0'.repeat(40),
    AURVIN_NATIVE_PERF_LABEL: 'current',
    AURVIN_NATIVE_PERF_SAMPLES: '1',
    AURVIN_TEST_DB_PREFIX: 'aurvin_p2_test_',
    AURVIN_TEST_MONGODB_URI: 'offline-placeholder-never-used-for-connections',
  };
  authorizeNative(reference); // Policy changes must invalidate a stale probe, not silently pass it.
  const publicConfig = { ...reference };
  const fields = Object.keys(reference).filter(name => name !== 'AURVIN_TEST_MONGODB_URI').map(name => {
    const value = env[name]; // Allowlist: never enumerate/read arbitrary secret settings.
    publicConfig[name] = value;
    let status: 'unset' | 'valid' | 'invalid' = value === undefined || value === '' ? 'unset' : 'invalid';
    if (status !== 'unset') {
      try { authorizeNative({ ...reference, [name]: value }); status = 'valid'; } catch { /* Safe status only. */ }
    }
    return { name, status };
  });
  let publicFieldsValid = false;
  try { authorizeNative(publicConfig); publicFieldsValid = true; } catch { /* Do not echo values or errors. */ }
  return { mode: 'offline-no-connect', executionReady: false, publicFieldsValid,
    proposalMatches: publicFieldsValid && publicConfig.AURVIN_NATIVE_PERF_SAMPLES === '1',
    uri: Object.hasOwn(env, 'AURVIN_TEST_MONGODB_URI') ? 'present-uninspected' : 'unset', fields,
    proposedPair: { samplesPerSource: 1, databases: NATIVE_LATENCY_SCENARIOS.length * 2,
      turns: NATIVE_LATENCY_SCENARIOS.reduce((sum, scenario) => sum + scenario.prior + 1, 0) * 2 } };
}

type CommandStart = { requestId: number; commandName: string; databaseName: string; command?: Record<string, unknown> };
type Interval = { requestId: number; name: string; target: boolean; startMs: number; endMs: number | null; failed: boolean };

export class NativeCommandMeasurement {
  private readonly epoch: number;
  private readonly intervals: Interval[] = [];
  private readonly pending = new Map<number, Interval>();
  private readonly milestones: Record<string, number> = {};
  private unmatched = 0;
  private nonMajorityWrites = 0;

  constructor(private readonly db: string, private readonly clock: () => number) { this.epoch = clock(); }
  private now() { return this.clock() - this.epoch; }

  start(event: CommandStart) {
    const row: Interval = { requestId: event.requestId, name: event.commandName,
      target: event.databaseName === this.db, startMs: this.now(), endMs: null, failed: false };
    if (this.pending.has(event.requestId)) this.unmatched++;
    this.intervals.push(row);
    this.pending.set(event.requestId, row);
    if (['insert', 'update', 'delete', 'findAndModify', 'bulkWrite'].includes(event.commandName)
      && (event.command?.writeConcern as { w?: unknown } | undefined)?.w !== 'majority') this.nonMajorityWrites++;
  }
  finish(event: { requestId: number }, failed = false) {
    const row = this.pending.get(event.requestId);
    if (!row) { this.unmatched++; return; }
    row.endMs = this.now();
    row.failed = failed;
    this.pending.delete(event.requestId);
  }
  mark(name: string) { this.milestones[name] ??= this.now(); }

  summary() {
    const elapsedMs = this.milestones.settled ?? this.now();
    const commands: Record<string, number> = {};
    const targetCommands: Record<string, number> = {};
    for (const row of this.intervals) {
      commands[row.name] = (commands[row.name] ?? 0) + 1;
      if (row.target) targetCommands[row.name] = (targetCommands[row.name] ?? 0) + 1;
    }
    // This is interval-union busy time, NOT causal/dependency waves or server CPU.
    const busy = (from: number, to: number) => {
      const spans = this.intervals.filter(row => row.endMs !== null)
        .map(row => [Math.max(from, row.startMs), Math.min(to, row.endMs!)] as const)
        .filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
      let end = from;
      let total = 0;
      for (const [start, stop] of spans) { total += Math.max(0, stop - Math.max(end, start)); end = Math.max(end, stop); }
      return total;
    };
    const boundary = (name: string, post = false) => {
      const point = this.milestones[name];
      if (point === undefined) return null;
      return { busyMs: busy(post ? point : 0, post ? elapsedMs : point),
        startedCommands: this.intervals.filter(row => post ? row.startMs >= point : row.startMs < point).length };
    };
    return { total: this.intervals.length, failed: this.intervals.filter(row => row.failed).length,
      pending: this.pending.size, unmatched: this.unmatched, commands, targetCommands,
      otherDatabaseCommands: this.intervals.filter(row => !row.target).length,
      milestones: { ...this.milestones }, elapsedMs, storageBusyMs: busy(0, elapsedMs),
      commandDurationSumMs: this.intervals.reduce((n, row) => n + (row.endMs === null ? 0 : row.endMs - row.startMs), 0),
      preDispatch: boundary('dispatch'), firstAnswer: boundary('firstAnswer'), postSeal: boundary('seal', true),
      postSealBusyMs: boundary('seal', true)?.busyMs ?? null,
      postSealTailMs: this.milestones.seal === undefined ? null : elapsedMs - this.milestones.seal,
      nonMajorityWrites: this.nonMajorityWrites, intervals: this.intervals.map(row => ({ ...row })) };
  }
}
