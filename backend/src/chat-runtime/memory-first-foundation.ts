/**
 * ============================================================================
 * FILE: memory-first-foundation.ts
 * LOCATION: backend/src/chat-runtime/memory-first-foundation.ts
 * ============================================================================
 * PURPOSE:
 *    Own bounded volatile conversation state and ordered save-only background work.
 * ROLE IN PROJECT:
 *    Shared text/voice authority and bounded terminal-only observation writer.
 *    Calendar execution retains its separate durable effect barriers.
 * KEY COMPONENTS:
 *    - MemoryFirstFoundation: Synchronous admission, retained identity and context.
 *    - TerminalEnvelope / SaveOutcome: Immutable data and qualified publication.
 *    - MemoryFirstPolicy: Required operator-supplied bounds; no production defaults.
 * ============================================================================
 */
import { z } from 'zod';
import { agentMemoryManifestSchema } from '../contracts/agent-memory.js';
import { calendarReplyReferenceSchema } from '../contracts/calendar-authority.js';
import type { ContextSourceSnapshot } from '../contracts/context.js';
import { idSchema } from '../contracts/identifiers.js';
import { messageRecordSchema, type MessageRecord } from '../contracts/message.js';
import { accountingRecordSchema, type AccountingRecord } from '../contracts/metadata.js';
import { voiceDeliveryRecordSchema, type VoiceDeliveryRecord } from '../contracts/voice.js';
import { voiceAccountingRecordSchema, type VoiceAccountingRecord } from '../contracts/voice-accounting.js';
import { isDeepStrictEqual } from 'node:util';
import { key, safeSequence } from '../persistence/records.js';
import { attemptIdFor, eventIdFor, inputId, sessionIdFor, turnIdFor } from './identity.js';
import { memoryCalendarStateSchema, type MemoryCalendarState } from './memory-calendar-state.js';
import { skillGroup } from './calendar-skills.js';
import type { AgentMemoryManifest } from '../contracts/agent-memory.js';
import type { CalendarAccountBinding } from '../contracts/calendar-discovery.js';
import { redactCalendarMessage, redactCalendarMessageForAccount } from '../persistence/calendar-records.js';
import { eligible } from '../context/reference-selection.js';
import { AppError } from '../platform/errors/app-error.js';

export type MemoryCapacity = { sessions: number; reservedMemoryBytes: number;
  pending: number; reservedBacklogBytes: number; unresolvedWrites: number };
const ZERO_CAPACITY: MemoryCapacity = { sessions: 0, reservedMemoryBytes: 0,
  pending: 0, reservedBacklogBytes: 0, unresolvedWrites: 0 };

export type MemoryFirstPolicy = {
  maxSessions: number; maxSessionBytes: number; maxMemoryBytes: number;
  maxRequestsPerSession: number; maxTurnsPerSession: number;
  maxEnvelopes: number; maxEnvelopeBytes: number; maxBacklogBytes: number;
  maxInputBytes: number; maxOutputBytes: number; maxEvidenceBytes: number;
  maxOperationsPerSave: number;
  maxConcurrentSaves: number; maxAttempts: number; retryBackoffMs: number;
  writeTimeoutMs: number; maxDirtyAgeMs: number; requestRetentionMs: number;
  shutdownDrainMs: number;
};
const configSchema = z.object({ revision: idSchema, modelId: z.string().min(1).max(200),
  instructionVersion: z.string().min(1).max(64), knowledgeContentHash: z.string().min(1).max(128),
  graphSchemaVersion: z.string().min(1).max(64) }).strict();
const acceptanceSchema = z.object({ sessionId: idSchema.nullable(), requestKey: z.string().min(8).max(128),
  expectedEpoch: idSchema.optional(),
  content: z.string().min(1), mode: z.enum(['text', 'live']), config: configSchema,
  calendarReplyTo: calendarReplyReferenceSchema.nullable(),
  voice: z.object({ voiceSessionId: idSchema, socketEpoch: z.number().int().nonnegative().safe(),
    providerTurnId: idSchema }).strict().nullable(),
  retryOf: z.object({ turnId: idSchema, userMessageId: idSchema, inputEventId: idSchema,
    sequence: z.number().int().nonnegative().safe(), createdAt: z.string().datetime(), previousAttemptId: idSchema }).strict().optional(),
}).strict();
export type MemoryAcceptance = z.infer<typeof acceptanceSchema>;
export type MemoryTurn = Readonly<MemoryAcceptance & {
  userId: string; sessionId: string; epoch: string; payloadHash: string;
  turnId: string; attemptId: string; userMessageId: string; outputMessageId: string;
  inputEventId: string; outputEventId: string; sequence: number;
  contextVersion: number; fence: number; createdAt: string;
}>;
const terminalStatus = z.enum(['completed', 'truncated', 'failed', 'cancelled', 'interrupted']);
export type MemoryTerminal = {
  content: string; status: z.infer<typeof terminalStatus>;
  accounting?: AccountingRecord; delivery?: VoiceDeliveryRecord;
  calendar?: MemoryCalendarState;
  calendarView?: MessageRecord['calendarView'];
};
/** All fields are frozen at runtime. Data only: no leases, receipts, callbacks or effects. */
export type TerminalEnvelope = Readonly<{
  schemaVersion: 1; epoch: string; userId: string; sessionId: string;
  version: number; previousVersion: number; fence: number;
  request: MemoryTurn; status: MemoryTerminal['status'];
  input: MessageRecord; output: MessageRecord;
  accounting: AccountingRecord | null; delivery: VoiceDeliveryRecord | null;
  calendar?: MemoryCalendarState;
}>;
export type SaveState = 'pending' | 'saving' | 'saved' | 'failed' | 'unknown' | 'fenced';
export type SaveOutcome =
  | { kind: 'saved'; epoch: string; sessionId: string; version: number; fence: number }
  | { kind: 'failed' | 'partial' | 'unknown'; retryable: boolean };
/**
 * Save-only adapter obligation (NOT implemented by existing repositories):
 * verify deterministic IDs/payloads, reconcile unknown outcomes, publish dependencies
 * before the visibility marker, and CAS durable versions/fences (including tombstones).
 * Return saved only for complete publication; retries must never infer or synthesize.
 * A local timeout does not cancel this call. No second call starts until it settles.
 */
export type SaveTerminal = (envelope: TerminalEnvelope,
  limits: Readonly<{ maxOperations: number; maxBytes: number }>) => Promise<SaveOutcome>;
export type SaveVoiceObservation = (record: VoiceAccountingRecord,
  limits: Readonly<{ maxOperations: number; maxBytes: number }>) => Promise<'saved' | 'unknown' | 'failed'>;
type Observation = { record: VoiceAccountingRecord; state: SaveState; attempts: number;
  inFlight: boolean; retryAt: number; retryable: boolean; dirtySince: number | null;
  retainUntil: number; savedOrder: number };
type Job = { envelope: TerminalEnvelope; state: SaveState; attempts: number;
  retryAt: number; retryable: boolean; inFlight: boolean; write?: Promise<void> };
type Session = {
  requests: Map<string, MemoryTurn>; results: Map<string, TerminalEnvelope>; jobs: Job[];
  active: MemoryTurn | null; version: number; durableVersion: number; fence: number;
  fenced: boolean; retainedBytes: number; dirtySince: number | null; retainUntil: number;
  base: ContextSourceSnapshot | null; baseDeliveries: readonly VoiceDeliveryRecord[]; nextSequence: number;
  archive: readonly MessageRecord[];
  baseCalendar?: readonly MemoryCalendarState[];
};

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
// Internal schemas admit only plain JSON data. Freeze shared references rather than
// cloning terminal text into a queue, a cache and a separate context owner.
function freeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v;
}
function capacity(): never { throw new Error('Memory-first capacity exceeded; save backlog must drain.'); }

function terminalEnvelope(turn: MemoryTurn, status: MemoryTerminal['status'], content: string,
  accounting: AccountingRecord | null, delivery: VoiceDeliveryRecord | null,
  calendarView?: MessageRecord['calendarView']): TerminalEnvelope {
  const scope = { userId: turn.userId, sessionId: turn.sessionId, turnId: turn.turnId, attemptId: turn.attemptId };
  const base = { schemaVersion: 1, ...scope, createdAt: turn.createdAt, truncated: status === 'truncated',
    mode: turn.mode, ...(turn.voice ? { visibility: 'internal', voiceSessionId: turn.voice.voiceSessionId } : {}) };
  const input = messageRecordSchema.parse({ ...base, role: 'user', content: turn.content,
    attemptId: null,
    messageId: turn.userMessageId, eventId: turn.inputEventId, sequence: turn.retryOf?.sequence ?? turn.sequence,
    createdAt: turn.retryOf?.createdAt ?? turn.createdAt,
    completionStatus: 'accepted', truncated: false });
  const output = messageRecordSchema.parse({ ...base, role: 'assistant', content,
    ...(delivery?.canvasArtifacts?.length ? { canvasArtifacts: delivery.canvasArtifacts } : {}),
    ...(calendarView ? { calendarView } : {}),
    messageId: turn.outputMessageId, eventId: turn.outputEventId, sequence: turn.sequence + 1,
    completionStatus: status });
  return { schemaVersion: 1, epoch: turn.epoch, userId: turn.userId, sessionId: turn.sessionId,
    version: safeSequence(turn.contextVersion + 1), previousVersion: turn.contextVersion,
    fence: turn.fence, request: turn, status, input, output, accounting, delivery };
}

export class MemoryFirstFoundation {
  get epoch(): string { return this.options.epoch; }
  private readonly sessions = new Map<string, Session>();
  private readonly rawWrites = new Set<Promise<unknown>>();
  private readonly observations = new Map<string, Observation>();
  private readonly policy: Readonly<MemoryFirstPolicy>;
  private readonly now: () => number;
  private accepting = true;
  private reservedEnvelopes = 0;
  private savedObservationSeq = 0;
  private wake: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: {
    userId: string; epoch: string; policy: MemoryFirstPolicy; save: SaveTerminal; now?: () => number;
    saveVoiceObservation?: SaveVoiceObservation;
    otherCapacity?: () => MemoryCapacity; onSaveSettled?: () => void;
  }) {
    idSchema.parse(options.userId); idSchema.parse(options.epoch);
    const p = options.policy;
    const names: (keyof MemoryFirstPolicy)[] = ['maxSessions', 'maxSessionBytes', 'maxMemoryBytes',
      'maxRequestsPerSession', 'maxTurnsPerSession', 'maxEnvelopes', 'maxEnvelopeBytes',
      'maxBacklogBytes', 'maxConcurrentSaves', 'maxAttempts', 'retryBackoffMs',
      'maxInputBytes', 'maxOutputBytes', 'maxEvidenceBytes', 'maxOperationsPerSave',
      'writeTimeoutMs', 'maxDirtyAgeMs', 'requestRetentionMs', 'shutdownDrainMs'];
    if (names.some(n => !Number.isSafeInteger(p[n]) || p[n] <= 0 ||
        (n.endsWith('Ms') && p[n] > 2_147_483_647)) ||
        p.maxEnvelopeBytes > p.maxBacklogBytes || p.maxSessionBytes > p.maxMemoryBytes ||
        p.maxEnvelopeBytes > p.maxSessionBytes || p.maxTurnsPerSession > 250)
      throw new Error('Invalid memory-first policy. Explicit finite policy is required.');
    this.policy = Object.freeze({ ...p }); this.now = options.now ?? Date.now;
    this.options = Object.freeze({ ...options, policy: this.policy });
  }

  private observationBytes(): number { return Math.min(4_096, this.policy.maxEvidenceBytes); }
  private isCleanObservation(o: Observation): boolean {
    return o.record.status !== 'pending' && o.state === 'saved' && !o.inFlight && o.dirtySince === null;
  }
  evictCleanObservations(): number {
    let evicted = 0;
    for (const [id, o] of this.observations) {
      if (this.isCleanObservation(o) && this.now() >= o.retainUntil) {
        this.observations.delete(id);
        evicted++;
      }
    }
    return evicted;
  }
  private reclaimCleanObservations(neededObservations: number, neededSessions = 0): void {
    this.evictCleanObservations();
    // ponytail: O(maxRequestsPerSession) oldest-clean scan bounded at <=128 entries;
    // upgrade to an indexed queue only if observation retention caps grow >>1024.
    while (this.observations.size + neededObservations > this.policy.maxRequestsPerSession ||
      (this.sessions.size + neededSessions) * this.policy.maxSessionBytes +
        (this.observations.size + neededObservations) * this.observationBytes() > this.policy.maxMemoryBytes) {
      let oldestId: string | null = null, oldestOrder = Infinity;
      for (const [id, o] of this.observations) {
        if (this.isCleanObservation(o) && o.savedOrder < oldestOrder) {
          oldestOrder = o.savedOrder;
          oldestId = id;
        }
      }
      if (oldestId === null) break;
      this.observations.delete(oldestId);
    }
  }

  /** Reserve ordinary socket/speech accounting before dispatch; persist only its terminal snapshot. */
  observeVoice(value: VoiceAccountingRecord): void {
    if (!this.options.saveVoiceObservation) throw new Error('Voice observation saving is unavailable.');
    const record = voiceAccountingRecordSchema.parse(value);
    if (record.userId !== this.options.userId || bytes(record) > this.observationBytes()) capacity();
    const id = key('voice-accounting', record.userId, record.sessionId, record.usageId), old = this.observations.get(id);
    if (old) {
      const fields = ['userId', 'sessionId', 'voiceSessionId', 'conversationId', 'usageId', 'providerSocketId',
        'userTag', 'provider', 'model', 'turnId', 'responseId', 'startedAt'] as const;
      if (fields.some(field => old.record[field] !== record[field])) throw new Error('Voice observation identity changed.');
      if (isDeepStrictEqual(old.record, record)) return;
      if (old.record.status !== 'pending' || record.status === 'pending') throw new Error('Terminal voice observation cannot be replaced.');
      old.record = freeze(record); old.dirtySince = this.now(); this.pump(); return;
    }
    if (!this.accepting || record.status !== 'pending') throw new Error('Voice observation was not admitted.');
    this.reclaimCleanObservations(1, 0);
    if (this.observations.size >= this.policy.maxRequestsPerSession ||
      [...this.observations.values()].some(o => o.dirtySince !== null && o.state !== 'saved' && this.now() - o.dirtySince >= this.policy.maxDirtyAgeMs) ||
      [...this.sessions.values()].some(s => s.dirtySince !== null && this.now() - s.dirtySince >= this.policy.maxDirtyAgeMs)) capacity();
    this.assertSharedCapacity(0, this.observationBytes(), 1, this.policy.maxEnvelopeBytes);
    this.observations.set(id, { record: freeze(record), state: 'pending', attempts: 0, inFlight: false,
      retryAt: 0, retryable: true, dirtySince: null, retainUntil: 0, savedOrder: 0 });
    this.reservedEnvelopes++;
  }

  /** Called with server-validated input/config, never browser-supplied user identity. */
  accept(value: MemoryAcceptance): MemoryTurn {
    const c = acceptanceSchema.parse(value);
    if (c.expectedEpoch !== undefined && c.expectedEpoch !== this.options.epoch)
      throw new Error('Unknown request outcome after restart; explicit new attempt required.');
    if ((c.mode === 'live') !== (c.voice !== null)) throw new Error('Invalid voice identity.');
    const sessionId = sessionIdFor(this.options.userId, c.sessionId, c.requestKey);
    const s = this.sessions.get(sessionId);
    // Configuration is pinned on initial acceptance, not changed by a transport retry.
    const payloadHash = key('memory-request', c.mode, c.content, JSON.stringify(c.calendarReplyTo), JSON.stringify(c.voice), JSON.stringify(c.retryOf ?? null));
    const previous = s?.requests.get(c.requestKey);
    if (previous) {
      if (previous.payloadHash !== payloadHash) throw new Error('Request payload mismatch.');
      return previous;
    }
    if (!this.accepting) throw new Error('Memory-first admission stopped.');
    if (s?.fenced) throw new Error('Session is fenced.');
    if (s?.active) throw new Error('Another turn is active.');
    if (s && this.records(sessionId).length + (c.retryOf ? 1 : 2) > Math.min(500, this.policy.maxTurnsPerSession * 2)) capacity();
    if (bytes(c.content) - 2 > this.policy.maxInputBytes) capacity();
    if ([...this.sessions.values()].some(entry => entry.dirtySince !== null &&
      this.now() - entry.dirtySince >= this.policy.maxDirtyAgeMs) ||
      [...this.observations.values()].some(o => o.dirtySince !== null && o.state !== 'saved' && this.now() - o.dirtySince >= this.policy.maxDirtyAgeMs))
      throw new Error('Save backlog age exceeded.');
    if (s && (s.requests.size >= this.policy.maxRequestsPerSession || s.results.size >= this.policy.maxTurnsPerSession)) capacity();
    if (!s) this.reclaimCleanObservations(0, 1);
    this.assertSharedCapacity(s ? 0 : 1, s ? 0 : this.policy.maxSessionBytes, 1, this.policy.maxEnvelopeBytes);
    const turnId = c.retryOf?.turnId ?? turnIdFor(this.options.userId, sessionId, c.requestKey);
    const attemptId = attemptIdFor(this.options.userId, sessionId, c.requestKey);
    const userMessageId = c.retryOf?.userMessageId ?? inputId(this.options.userId, sessionId, attemptId);
    const outputMessageId = key('output', this.options.userId, sessionId, attemptId);
    const turn = freeze({ ...c, userId: this.options.userId, sessionId, epoch: this.options.epoch,
      payloadHash, turnId, attemptId, userMessageId, outputMessageId,
      inputEventId: c.retryOf?.inputEventId ?? eventIdFor(this.options.userId, sessionId, userMessageId),
      outputEventId: eventIdFor(this.options.userId, sessionId, outputMessageId),
      sequence: safeSequence(s?.nextSequence ?? 0), contextVersion: s?.version ?? 0,
      fence: s?.fence ?? 0, createdAt: new Date(this.now()).toISOString() });
    const nextSequence = safeSequence(turn.sequence + 3);
    // Empty output/null evidence establish exact fixed encoded overhead. The longest
    // terminal status reserves space for any terminal outcome. Bounds count JSON
    // escaping, not just character count. Evidence includes generated voice text.
    const minimal = terminalEnvelope(turn, 'interrupted', '', null, null);
    if (bytes(minimal) + this.policy.maxOutputBytes + this.policy.maxEvidenceBytes > this.policy.maxEnvelopeBytes) capacity();
    // Reserve the maximum terminal size before dispatch, not after an answer exists.
    if (bytes(turn) + (s?.retainedBytes ?? 0) + this.policy.maxEnvelopeBytes > this.policy.maxSessionBytes) capacity();
    const session = s ?? { requests: new Map(), results: new Map(), jobs: [], active: null,
      version: 0, durableVersion: 0, fence: 0, fenced: false, retainedBytes: 0,
      base: null, baseDeliveries: [], nextSequence: 0, archive: [],
      dirtySince: null, retainUntil: 0 };
    session.requests.set(c.requestKey, turn); session.active = turn;
    session.nextSequence = nextSequence;
    session.retainUntil = this.now() + this.policy.requestRetentionMs; session.retainedBytes += bytes(turn);
    session.dirtySince ??= this.now(); this.reservedEnvelopes++;
    this.sessions.set(sessionId, session);
    return turn;
  }

  private owned(turn: MemoryTurn): Session {
    const s = this.sessions.get(turn.sessionId);
    if (!s || s.requests.get(turn.requestKey) !== turn) throw new Error('Invalid memory turn handle.');
    return s;
  }

  /** Final generation AND terminal heard evidence are committed before releasing the slot. */
  complete(turn: MemoryTurn, value: MemoryTerminal): TerminalEnvelope {
    const s = this.owned(turn);
    if (s.active !== turn || s.fenced || turn.fence !== s.fence) throw new Error('Stale or fenced completion.');
    const status = terminalStatus.parse(value.status);
    const scope = { userId: turn.userId, sessionId: turn.sessionId, turnId: turn.turnId, attemptId: turn.attemptId };
    const delivery = value.delivery ? voiceDeliveryRecordSchema.parse(value.delivery) : null;
    const accounting = value.accounting ? accountingRecordSchema.parse(value.accounting) : null;
    const calendar = value.calendar ? memoryCalendarStateSchema.parse(value.calendar) : undefined;
    if (calendar && (calendar.budget.userId !== turn.userId || calendar.budget.sessionId !== turn.sessionId ||
        calendar.budget.turnId !== turn.turnId || calendar.dispatches.some(d => d.attemptId !== turn.attemptId)))
      throw new Error('Native evidence identity mismatch.');
    if (bytes({ accounting, delivery, calendar }) - bytes({ accounting: null, delivery: null }) > this.policy.maxEvidenceBytes) capacity();
    for (const record of [delivery, accounting]) if (record &&
      Object.entries(scope).some(([k, v]) => record[k as keyof typeof scope] !== v)) throw new Error('Evidence identity mismatch.');
    if (turn.mode === 'live' && (!delivery || delivery.status === 'pending' ||
        delivery.textGenerated !== value.content || delivery.voiceSessionId !== turn.voice?.voiceSessionId))
      throw new Error('Terminal voice delivery is required before eligibility.');
    if (turn.mode === 'text' && delivery) throw new Error('Unexpected voice delivery.');
    if (accounting && accounting.outcome !== status) throw new Error('Accounting outcome mismatch.');
    const minimal = terminalEnvelope(turn, status, '', null, null);
    const envelope = freeze({ ...terminalEnvelope(turn, status, value.content, accounting, delivery, value.calendarView),
      ...(calendar ? { calendar } : {}) });
    if (bytes(envelope.output) - bytes(minimal.output) > this.policy.maxOutputBytes) capacity();
    if (bytes(envelope) > this.policy.maxEnvelopeBytes) capacity();
    // Envelope and ledger share the immutable request. Charge its serialized size
    // again conservatively; writer retains this same object, not another text copy.
    s.retainedBytes += bytes(envelope); s.version = envelope.version;
    s.retainUntil = this.now() + this.policy.requestRetentionMs;
    s.results.set(turn.requestKey, envelope); s.active = null;
    s.jobs.push({ envelope, state: 'pending', attempts: 0, retryAt: 0, retryable: true, inFlight: false });
    this.pump();
    return envelope;
  }

  result(turn: MemoryTurn): TerminalEnvelope | null {
    const envelope = this.owned(turn).results.get(turn.requestKey);
    if (!envelope) return null;
    const output = redactCalendarMessage(envelope.output, this.now());
    return isDeepStrictEqual(output, envelope.output) ? envelope : freeze({ ...envelope, output });
  }
  /** Import an already published Calendar seal; never queue a duplicate archive job. */
  commitPromoted(turn: MemoryTurn, value: { input: MessageRecord; output: MessageRecord;
    manifest: AgentMemoryManifest; delivery?: VoiceDeliveryRecord }): TerminalEnvelope {
    const s = this.owned(turn), manifest = agentMemoryManifestSchema.parse(value.manifest);
    const input = messageRecordSchema.parse(value.input), output = messageRecordSchema.parse(value.output);
    const status = terminalStatus.parse(output.completionStatus);
    if (s.active !== turn || s.fenced || s.fence !== turn.fence || s.jobs.length ||
        s.durableVersion !== turn.contextVersion || s.version !== turn.contextVersion ||
        manifest.userId !== turn.userId || manifest.sessionId !== turn.sessionId ||
        manifest.contextVersion !== turn.contextVersion + 1 ||
        input.messageId !== turn.userMessageId || input.eventId !== turn.inputEventId || input.content !== turn.content ||
        input.role !== 'user' || input.sequence !== (turn.retryOf?.sequence ?? turn.sequence) ||
        output.messageId !== turn.outputMessageId || output.eventId !== turn.outputEventId || output.role !== 'assistant' ||
        output.attemptId !== turn.attemptId || output.sequence !== turn.sequence + 1 ||
        [input, output].some(r => r.userId !== turn.userId || r.sessionId !== turn.sessionId || r.turnId !== turn.turnId))
      throw new Error('Invalid promoted memory commit.');
    const delivery = value.delivery ? voiceDeliveryRecordSchema.parse(value.delivery) : null;
    if (turn.mode === 'live' && (!delivery || delivery.status === 'pending' || delivery.userId !== turn.userId ||
        delivery.sessionId !== turn.sessionId || delivery.turnId !== turn.turnId || delivery.attemptId !== turn.attemptId ||
        delivery.voiceSessionId !== turn.voice?.voiceSessionId || delivery.textGenerated !== output.content) ||
        turn.mode === 'text' && delivery) throw new Error('Invalid promoted voice delivery.');
    const all = new Map(this.records(turn.sessionId).map(r => [r.messageId, r]));
    all.set(input.messageId, input); all.set(output.messageId, output);
    const records = manifest.messageRefs.map(ref => {
      const record = all.get(ref.messageId);
      if (!record || record.eventId !== ref.eventId || record.sequence !== ref.sequence)
        throw new Error('Invalid promoted manifest references.');
      return record;
    });
    if (!records.some(r => r.messageId === input.messageId) ||
        !records.some(r => r.messageId === output.messageId) &&
        (eligible(output) || !['failed', 'cancelled', 'interrupted'].includes(status)))
      throw new Error('Incomplete promoted manifest.');
    const envelope = freeze({ ...terminalEnvelope(turn, status, output.content, null, delivery), input, output });
    if (bytes(envelope) > this.policy.maxEnvelopeBytes || bytes(output.content) - 2 > this.policy.maxOutputBytes ||
        bytes(delivery) > this.policy.maxEvidenceBytes || s.retainedBytes + bytes(envelope) > this.policy.maxSessionBytes) capacity();
    const calendar = [...(s.baseCalendar ?? []), ...[...s.results.values()]
      .filter(e => e.version > (s.base?.manifest.contextVersion ?? -1)).flatMap(e => e.calendar ? [e.calendar] : [])];
    const deliveries = this.deliveries(turn.sessionId);
    const archive = new Map(this.history(turn.sessionId).map(record => [record.messageId, record]));
    archive.set(input.messageId, input); archive.set(output.messageId, output);
    s.base = freeze({ manifest, records });
    s.archive = freeze([...archive.values()].sort((a, b) => a.sequence - b.sequence));
    s.baseCalendar = freeze(calendar); s.baseDeliveries = freeze([...deliveries, ...(delivery ? [delivery] : [])]);
    s.results.set(turn.requestKey, envelope); s.active = null;
    s.version = manifest.contextVersion; s.durableVersion = manifest.contextVersion;
    s.retainedBytes += bytes(envelope); s.dirtySince = null;
    s.retainUntil = this.now() + this.policy.requestRetentionMs; this.reservedEnvelopes--;
    return envelope;
  }
  /** Await only this session's actual ordered writes, including ownership release. */
  async flushSession(sessionId: string): Promise<void> {
    const s = this.required(sessionId);
    const failure = () => new AppError('PERSISTENCE_ERROR', 'Earlier chat progress could not be saved.', false);
    while (s.jobs.length) {
      if (s.fenced) throw failure();
      const job = s.jobs[0];
      if (!['pending', 'saving'].includes(job.state)) throw failure();
      this.pump();
      if (!job.write) throw failure();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([job.write, new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(failure()), this.policy.writeTimeoutMs);
        })]);
      } finally { clearTimeout(timer); }
      if (job.state !== 'saved') throw failure();
    }
    if (s.fenced || s.version !== s.durableVersion) throw failure();
  }

  invalidateCalendarAccount(account: CalendarAccountBinding): void {
    if (account.userId !== this.options.userId) return;
    const redact = (record: MessageRecord) => redactCalendarMessageForAccount(record, account, this.now());
    for (const s of this.sessions.values()) {
      if (s.base) s.base = freeze({ ...s.base, records: s.base.records.map(redact) });
      s.archive = freeze(s.archive.map(redact));
      for (const [requestKey, envelope] of s.results)
        s.results.set(requestKey, freeze({ ...envelope, input: redact(envelope.input), output: redact(envelope.output) }));
    }
  }
  saveState(turn: MemoryTurn): SaveState {
    const s = this.owned(turn);
    return s.jobs.find(j => j.envelope.request === turn)?.state ??
      (s.results.has(turn.requestKey) ? 'saved' : 'pending');
  }
  /** Feed this source to the existing assembler; supply deliveries via its metadata port. */
  context(turn: MemoryTurn): ContextSourceSnapshot {
    const s = this.owned(turn);
    if (s.active !== turn || s.fenced || turn.contextVersion !== s.version) throw new Error('Stale context.');
    const records = this.records(turn.sessionId).filter(eligible);
    const manifest = agentMemoryManifestSchema.parse({ schemaVersion: 1,
      userId: turn.userId, sessionId: turn.sessionId, contextVersion: s.version,
      messageRefs: records.map(({ messageId, eventId, sequence }) => ({ messageId, eventId, sequence })),
      sourceRanges: records.length ? [{ fromSequence: records[0].sequence, toSequence: records.at(-1)!.sequence,
        fromEventId: records[0].eventId, toEventId: records.at(-1)!.eventId }] : [],
      activeSummaryRef: null, instructionVersion: turn.config.instructionVersion,
      knowledgeContentHash: turn.config.knowledgeContentHash, graphSchemaVersion: turn.config.graphSchemaVersion });
    return freeze({ manifest, records });
  }
  deliveries(sessionId: string): readonly VoiceDeliveryRecord[] {
    const s = this.required(sessionId);
    return Object.freeze([...s.baseDeliveries, ...[...s.results.values()]
      .filter(e => e.version > (s.base?.manifest.contextVersion ?? -1)).flatMap(e => e.delivery ? [e.delivery] : [])]);
  }
  /** Complete original pairs only; no inferred or client-supplied schema disclosure. */
  nativeGroups(sessionId: string) {
    const session = this.required(sessionId);
    const states = [...(session.baseCalendar ?? []), ...[...session.results.values()]
      .filter(e => e.version > (session.base?.manifest.contextVersion ?? -1)).flatMap(e => e.calendar ? [e.calendar] : [])];
    const groups = new Map<string, ReturnType<typeof skillGroup>[]>();
    for (const state of states) {
      const entries = [...state.results].sort((a, b) => a.sequence - b.sequence).map(result => {
        const decision = state.decisions.find(d => d.decisionId === result.decisionId)!.decision!;
        if (decision.kind === 'text') throw new Error('Invalid native memory pair.');
        return skillGroup(decision, result.resultRef.content);
      });
      if (entries.length) groups.set(state.budget.turnId, [...(groups.get(state.budget.turnId) ?? []), ...entries]);
    }
    return groups;
  }
  has(sessionId: string): boolean { return this.sessions.has(sessionId); }
  sessionIds(): string[] { return [...this.sessions.keys()]; }
  find(sessionId: string, requestKey: string): MemoryTurn | null {
    return this.sessions.get(sessionId)?.requests.get(requestKey) ?? null;
  }
  byTurn(sessionId: string, turnId: string): MemoryTurn | null {
    return [...(this.sessions.get(sessionId)?.requests.values() ?? [])].filter(t => t.turnId === turnId).at(-1) ?? null;
  }
  records(sessionId: string): MessageRecord[] {
    const s = this.required(sessionId);
    const records = new Map((s.base?.records ?? []).map(r => [r.messageId, r]));
    for (const e of s.results.values()) if (e.version > (s.base?.manifest.contextVersion ?? -1)) {
      if (!records.has(e.input.messageId)) records.set(e.input.messageId, e.input);
      records.set(e.output.messageId, e.output);
    }
    return [...records.values()].sort((a, b) => a.sequence - b.sequence).map(record => redactCalendarMessage(record, this.now()));
  }
  history(sessionId: string): MessageRecord[] {
    const records = new Map(this.required(sessionId).archive.map(r => [r.messageId, r]));
    for (const r of this.records(sessionId)) records.set(r.messageId, r);
    return [...records.values()].sort((a, b) => a.sequence - b.sequence).map(record => redactCalendarMessage(record, this.now()));
  }
  /** Trusted bounded hydration only; never replace dirty authority with a storage read. */
  hydrate(source: ContextSourceSnapshot, deliveries: readonly VoiceDeliveryRecord[], nextSequence: number,
    archiveRecords: readonly MessageRecord[] = source.records, native: readonly MemoryCalendarState[] = []): void {
    const manifest = agentMemoryManifestSchema.parse(source.manifest);
    if (manifest.userId !== this.options.userId) throw new Error('Hydration identity mismatch.');
    const records = source.records.map(r => messageRecordSchema.parse(r));
    if (records.length !== manifest.messageRefs.length || records.length > this.policy.maxTurnsPerSession * 2 ||
        records.some((r, i) => r.userId !== manifest.userId || r.sessionId !== manifest.sessionId ||
          r.messageId !== manifest.messageRefs[i].messageId || r.eventId !== manifest.messageRefs[i].eventId ||
          r.sequence !== manifest.messageRefs[i].sequence) ||
        !Number.isSafeInteger(nextSequence) || nextSequence < 0 || records.some(r => r.sequence >= nextSequence))
      throw new Error('Invalid hydration source.');
    const evidence = deliveries.map(d => voiceDeliveryRecordSchema.parse(d));
    const calendar = native.map(value => memoryCalendarStateSchema.parse(value));
    if (calendar.length > this.policy.maxTurnsPerSession ||
        new Set(calendar.map(state => state.dispatches[0]?.attemptId)).size !== calendar.length ||
        calendar.some(state => state.budget.userId !== manifest.userId || state.budget.sessionId !== manifest.sessionId ||
          !records.some(record => record.turnId === state.budget.turnId && record.role === 'user')))
      throw new Error('Invalid native hydration evidence.');
    const archive = archiveRecords.map(r => messageRecordSchema.parse(r));
    if (archive.length > this.policy.maxTurnsPerSession * 2 || new Set(archive.map(r => r.messageId)).size !== archive.length ||
        archive.some(r => r.userId !== manifest.userId || r.sessionId !== manifest.sessionId || r.sequence >= nextSequence))
      throw new Error('Invalid hydration archive.');
    if (evidence.length > records.length || evidence.some(d => d.userId !== manifest.userId || d.sessionId !== manifest.sessionId))
      throw new Error('Invalid hydration evidence.');
    const s = this.sessions.get(manifest.sessionId);
    if (s && this.session(manifest.sessionId).dirty) throw new Error('Cannot hydrate dirty memory.');
    if (s && (manifest.contextVersion < s.version || nextSequence < s.nextSequence)) throw new Error('Stale hydration source.');
    const previousBaseBytes = s?.base ? bytes({ manifest: s.base.manifest, records: s.base.records,
      evidence: s.baseDeliveries, archive: s.archive, calendar: s.baseCalendar ?? [] }) : 0;
    const retainedBytes = bytes({ manifest, records, evidence, archive, calendar }) + (s?.retainedBytes ?? 0) - previousBaseBytes;
    if (!s) this.reclaimCleanObservations(0, 1);
    if (retainedBytes + this.policy.maxEnvelopeBytes > this.policy.maxSessionBytes) capacity();
    if (!s) this.assertSharedCapacity(1, this.policy.maxSessionBytes, 0, 0);
    const entry: Session = s ?? { requests: new Map(), results: new Map(), jobs: [], active: null,
      version: 0, durableVersion: 0, fence: 0, fenced: false, retainedBytes: 0,
      dirtySince: null, retainUntil: 0, base: null, baseDeliveries: [], nextSequence: 0, archive: [] };
    entry.base = freeze({ manifest, records }); entry.baseDeliveries = freeze(evidence);
    entry.nextSequence = nextSequence; entry.version = manifest.contextVersion;
    entry.archive = freeze(archive);
    entry.baseCalendar = freeze(calendar);
    entry.durableVersion = manifest.contextVersion; entry.retainedBytes = retainedBytes;
    this.sessions.set(manifest.sessionId, entry);
  }
  session(sessionId: string) {
    const s = this.required(sessionId);
    return { version: s.version, durableVersion: s.durableVersion, dirty: s.active !== null || s.version !== s.durableVersion || s.fenced,
      activeAttemptId: s.active?.attemptId ?? null, fence: s.fence, fenced: s.fenced };
  }
  private required(sessionId: string): Session {
    const s = this.sessions.get(sessionId); if (!s) throw new Error('Session not in memory.'); return s;
  }
  /** Local fence only. Adapter MUST enforce durable CAS/tombstones for dispatched writes. */
  fence(sessionId: string, expectedVersion: number, reason: 'archived' | 'revoked' | 'redacted'): void {
    const s = this.required(sessionId);
    if (s.version !== expectedVersion || !['archived', 'revoked', 'redacted'].includes(reason)) throw new Error('Stale fence.');
    s.fence = safeSequence(s.fence + 1); s.fenced = true;
    for (const j of s.jobs) if (!j.inFlight) j.state = 'fenced';
  }
  /** No TTL or pressure eviction; even clean dedup evidence has a retention floor. */
  evictClean(sessionId: string): boolean {
    const s = this.required(sessionId);
    if (s.active || s.jobs.length || s.fenced || s.version !== s.durableVersion ||
        this.now() < s.retainUntil) return false;
    this.sessions.delete(sessionId); return true;
  }
  retrySave(sessionId: string): boolean {
    const s = this.required(sessionId), j = s.jobs[0];
    if (!j || s.fenced || j.inFlight || !j.retryable || j.attempts >= this.policy.maxAttempts) return false;
    // Explicit retry respects the same finite backoff/total-attempt budget.
    this.pump(); return true;
  }
  stopAdmission(): void { this.accepting = false; }
  pumpSaves(): void { this.pump(); }
  private assertSharedCapacity(addSessions = 0, addMemoryBytes = 0, addEnvelopes = 0, addBacklogBytes = 0): void {
    const total = this.totalCapacity();
    if (total.sessions + addSessions > this.policy.maxSessions ||
        total.reservedMemoryBytes + addMemoryBytes > this.policy.maxMemoryBytes ||
        total.pending + addEnvelopes > this.policy.maxEnvelopes ||
        total.reservedBacklogBytes + addBacklogBytes > this.policy.maxBacklogBytes)
      capacity();
  }
  totalCapacity(): MemoryCapacity {
    const own = this.snapshot();
    const other = this.options.otherCapacity?.() ?? ZERO_CAPACITY;
    return {
      sessions: own.sessions + other.sessions,
      reservedMemoryBytes: own.reservedMemoryBytes + other.reservedMemoryBytes,
      pending: own.pending + other.pending,
      reservedBacklogBytes: own.reservedBacklogBytes + other.reservedBacklogBytes,
      unresolvedWrites: own.unresolvedWrites + other.unresolvedWrites,
    };
  }
  snapshot() {
    return { accepting: this.accepting, sessions: this.sessions.size,
      reservedMemoryBytes: this.sessions.size * this.policy.maxSessionBytes + this.observations.size * this.observationBytes(),
      pending: this.reservedEnvelopes, reservedBacklogBytes: this.reservedEnvelopes * this.policy.maxEnvelopeBytes,
      unresolvedWrites: this.rawWrites.size,
      active: [...this.sessions.values()].filter(s => s.active !== null).length };
  }
  async drain(timeoutMs = this.policy.shutdownDrainMs) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > this.policy.shutdownDrainMs)
      throw new Error('Invalid memory drain budget.');
    this.stopAdmission();
    let expired = false;
    const deadline = setTimeout(() => { expired = true; }, timeoutMs);
    try {
      while ((this.reservedEnvelopes || this.rawWrites.size) && !expired) {
        this.pump();
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(5, this.policy.shutdownDrainMs)));
      }
    } finally { clearTimeout(deadline); }
    const state = this.snapshot();
    return { ...state, drained: state.pending === 0 && state.unresolvedWrites === 0 && state.active === 0 };
  }
  private pump(): void {
    if (this.wake) { clearTimeout(this.wake); this.wake = undefined; }
    let nextWake = Infinity;
    // ponytail: bounded O(maxSessions) scheduling scan; use a ready queue only
    // if an admitted session budget and profiling justify a larger scheduler.
    for (const s of this.sessions.values()) {
      const j = s.jobs[0];
      if (!j || s.fenced || j.inFlight || !j.retryable || j.attempts >= this.policy.maxAttempts) continue;
      if (j.retryAt > this.now()) { nextWake = Math.min(nextWake, j.retryAt); continue; }
      if (this.totalCapacity().unresolvedWrites >= this.policy.maxConcurrentSaves) continue;
      this.dispatch(s, j);
    }
    for (const observation of this.observations.values()) {
      if (observation.record.status === 'pending' || observation.state === 'saved' || observation.inFlight ||
        !observation.retryable || observation.attempts >= this.policy.maxAttempts) continue;
      if (observation.retryAt > this.now()) { nextWake = Math.min(nextWake, observation.retryAt); continue; }
      if (this.totalCapacity().unresolvedWrites >= this.policy.maxConcurrentSaves) continue;
      this.dispatchObservation(observation);
    }
    if (Number.isFinite(nextWake)) this.wake = setTimeout(() => { this.wake = undefined; this.pump(); }, Math.max(1, nextWake - this.now()));
  }
  private dispatchObservation(observation: Observation): void {
    observation.inFlight = true; observation.state = 'saving'; observation.attempts++;
    const raw = Promise.resolve().then(() => this.options.saveVoiceObservation!(observation.record,
      { maxOperations: this.policy.maxOperationsPerSave, maxBytes: this.observationBytes() }));
    this.rawWrites.add(raw);
    const timer = setTimeout(() => { observation.state = 'unknown'; }, this.policy.writeTimeoutMs);
    const settle = (result: 'saved' | 'unknown' | 'failed') => {
      if (result !== 'saved' && result !== 'failed') result = 'unknown';
      observation.state = result;
      if (result === 'saved') {
        this.reservedEnvelopes--;
        observation.dirtySince = null;
        observation.retainUntil = this.now() + this.policy.requestRetentionMs;
        observation.savedOrder = ++this.savedObservationSeq;
      }
      else { observation.retryable = result === 'unknown'; observation.retryAt = this.now() + this.policy.retryBackoffMs; }
    };
    void raw.then(settle, () => settle('unknown')).finally(() => {
      clearTimeout(timer); this.rawWrites.delete(raw); observation.inFlight = false; this.pump();
      this.options.onSaveSettled?.();
    });
  }
  private dispatch(s: Session, j: Job): void {
    j.inFlight = true; j.state = 'saving'; j.attempts++;
    // Track the actual promise, including synchronous adapter exceptions. A visible
    // timeout changes status only; it never releases concurrency or session order.
    const raw: Promise<SaveOutcome> = Promise.resolve().then(() => s.fenced || s.fence !== j.envelope.fence
      ? { kind: 'failed', retryable: false }
      : this.options.save(j.envelope,
        { maxOperations: this.policy.maxOperationsPerSave, maxBytes: this.policy.maxEnvelopeBytes }));
    this.rawWrites.add(raw);
    const timer = setTimeout(() => { j.state = 'unknown'; }, this.policy.writeTimeoutMs);
    j.write = raw.then(outcome => this.settle(s, j, outcome), () => this.settle(s, j, { kind: 'unknown', retryable: false }))
      .finally(() => {
        clearTimeout(timer); this.rawWrites.delete(raw); j.inFlight = false; this.pump();
        this.options.onSaveSettled?.();
      });
  }
  private settle(s: Session, j: Job, outcome: SaveOutcome): void {
    const e = j.envelope;
    if (s.fenced || s.fence !== e.fence) { j.state = 'fenced'; j.retryable = false; return; }
    if (!outcome || !['saved', 'failed', 'partial', 'unknown'].includes(outcome.kind)) {
      j.state = 'unknown'; j.retryable = false; return;
    }
    if (outcome.kind === 'saved') {
      if (outcome.epoch !== e.epoch || outcome.sessionId !== e.sessionId || outcome.version !== e.version ||
          outcome.fence !== e.fence || s.durableVersion !== e.previousVersion || s.jobs[0] !== j) {
        j.state = 'unknown'; j.retryable = false; return;
      }
      s.durableVersion = e.version; j.state = 'saved'; s.jobs.shift(); this.reservedEnvelopes--;
      if (!s.active && s.durableVersion === s.version) s.dirtySince = null;
      return;
    }
    j.state = outcome.kind === 'unknown' ? 'unknown' : 'failed';
    j.retryable = outcome.retryable;
    j.retryAt = this.now() + this.policy.retryBackoffMs;
  }
}
