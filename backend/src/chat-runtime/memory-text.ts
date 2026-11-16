/**
 * ============================================================================
 * FILE: memory-text.ts
 * LOCATION: backend/src/chat-runtime/memory-text.ts
 * ============================================================================
 * PURPOSE: Connect ordinary text and live voice to one bounded memory foundation.
 * ROLE IN PROJECT: Owner-bound memory compartment inside one DurableChatRuntime.
 * KEY COMPONENTS: Explicit ownerId, shared epoch/capacity, cold hydration, save-only archive.
 * ============================================================================
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { MemoryFirstFoundation, type MemoryCapacity, type MemoryFirstPolicy, type MemoryTurn, type MemoryTerminal, type MemoryAcceptance } from './memory-first-foundation.js';
import type { ResolvedIdentity } from '../contracts/identity.js';
import type { RuntimeDependencies, ExecuteTurn, SubmitLiveTurn, CalendarCompatibleEnvelope } from './ports.js';
import { voiceDeliveryRecordSchema, type VoiceDeliveryRecord } from '../contracts/voice.js';
import { SpeechProse } from '../voice/agent/speech-prose.js';
import type { CanvasArtifactProjection } from '../contracts/voice-wire.js';
import type { DurableChatRuntime } from './durable-chat-runtime.js';
import type { SubmitTurnCommand, RetryTurnCommand, CancelTurnCommand } from '../contracts/runtime.js';
import type { RuntimeConfigSnapshot } from '../contracts/config-runtime.js';
import type { AttemptRecord } from '../contracts/attempt.js';
import type { AccountingRecord } from '../contracts/metadata.js';
import type { SessionRecord } from '../contracts/session.js';
import type { MessageRecord } from '../contracts/message.js';
import type { PageQuery, ExecutionLease } from '../contracts/repositories.js';
import type { ConfirmedRecord } from '../persistence/confirmed-record.js';
import type { AcceptanceRecord } from '../persistence/ownership.js';
import type { CalendarAccountBinding } from '../contracts/calendar-discovery.js';
import type { CalendarProposalRecord } from '../contracts/calendar-authority.js';
import type { CompatibleCalendarToolGroup } from '../context/calendar-context.js';
import { calendarHistory } from './calendar-history.js';
import { CalendarTurnLedger } from './calendar-budget.js';
import { publishCalendarTurn } from './calendar-publication.js';
import { unavailableMoney } from '../contracts/usage-evidence.js';
import type { CalendarTurnBudget } from '../contracts/calendar-accounting.js';
import type { CalendarCursor, CalendarRefs, CalendarSeal } from '../agent/state.js';
import type { TurnGraph, CalendarGraphPatch } from '../agent/turn-graph.js';
import type { Work } from './work.js';
import { turnStatusResponseSchema, visibleMessageSchema } from '../contracts/api.js';
import { streamEnvelopeSchema, type StreamEvent } from '../contracts/stream.js';
import { ReferencedContextAssembler } from '../context/referenced-context-assembler.js';
import { buildReferenceManifest, validateManifest } from '../context/reference-selection.js';
import { defaultEnvironmentContext, validateInput } from '../context/context-budget.js';
import { createModelServices } from '../model/index.js';
import { buildTurnGraph } from '../agent/turn-graph.js';
import { boundaryFor } from '../agent/state.js';
import { graphConfig, terminal, transitionConfirmed } from './finalization.js';
import { sessionIdFor, responseFor, titleFor } from './identity.js';
import { graphThreadId, bounded, counterSchema, key } from '../persistence/records.js';
import { messageRecordSchema } from '../contracts/message.js';
import { AppError } from '../platform/errors/app-error.js';
import { hashPayload } from '../platform/crypto/hash-payload.js';
import { page, cursor } from '../persistence/pagination.js';
import { MemoryTextArchive } from '../persistence/memory-text-archive.js';
import { readMemoryCalendarStates } from '../persistence/memory-calendar-reader.js';
import { CalendarLoop } from './calendar-loop.js';
import { isCalendarV2, asCalendarAccountingPort } from './calendar-ports.js';
import { MemoryCalendarLedger } from './memory-calendar-ledger.js';
import { MemoryCalendarStage, memoryCalendarStateSchema, type MemoryCalendarState } from './memory-calendar-state.js';
import { CALENDAR_LIMITS } from '../contracts/calendar-policy.js';
import { CALENDAR_TOMBSTONE } from '../contracts/calendar-sources.js';

/** Proposed encoded-data ceilings, not an operator-approved V8 heap/RSS budget. */
export const PROPOSED_MEMORY_TEXT_POLICY: Readonly<MemoryFirstPolicy> = Object.freeze({
  maxSessions: 16, maxSessionBytes: 8_388_608, maxMemoryBytes: 134_217_728,
  maxRequestsPerSession: 128, maxTurnsPerSession: 128,
  maxEnvelopes: 32, maxEnvelopeBytes: 524_288, maxBacklogBytes: 16_777_216,
  maxInputBytes: 65_536, maxOutputBytes: 131_072, maxEvidenceBytes: 131_072,
  maxOperationsPerSave: 32, maxConcurrentSaves: 2, maxAttempts: 3,
  retryBackoffMs: 1_000, writeTimeoutMs: 15_000, maxDirtyAgeMs: 60_000,
  requestRetentionMs: 300_000, shutdownDrainMs: 20_000,
});

type Entry = { identity: Readonly<ResolvedIdentity>; turn: MemoryTurn; snapshot: RuntimeConfigSnapshot | null; budgets: RuntimeConfigSnapshot['budgets']; status: AttemptRecord['status'];
  error: AppError | null; accounting?: AccountingRecord; delivery?: VoiceDeliveryRecord;
  calendar?: MemoryCalendarState; calendarView?: MessageRecord['calendarView']; initialBudget?: CalendarTurnBudget; native?: NativeExecution; running: boolean };
type Promotion = { lease: ExecutionLease; binding?: CalendarAccountBinding; attempt?: AttemptRecord;
  receipt?: ConfirmedRecord<AttemptRecord>; acceptance?: AcceptanceRecord; graph?: TurnGraph; ledger?: CalendarTurnLedger;
  ready: boolean };
type NativeExecution = { ledger: MemoryCalendarLedger; stage: MemoryCalendarStage; loop: CalendarLoop;
  job: Work; promotion?: Promotion; invalidation: number; pending: boolean };
type Cold = { session: SessionRecord; attempts: AttemptRecord[]; stale: boolean;
  groups?: Map<string, readonly CompatibleCalendarToolGroup[]>; pendingProposal?: CalendarProposalRecord | null;
  accountBinding?: CalendarAccountBinding | null };
export class DurableHistoryRequired extends AppError {
  constructor() { super('NOT_READY', 'This chat requires its durable Calendar path.'); }
}

export class MemoryText {
  readonly foundation: MemoryFirstFoundation;
  // ponytail: O(maxSessions) coordinated clean sweep after requestRetentionMs;
  // dirty, active, loading, or reserved sessions stay pinned in both maps.
  private readonly entries = new Map<string, Entry>();
  private readonly sessions = new Map<string, Cold>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly archive: MemoryTextArchive | null;
  private readonly policy: Readonly<MemoryFirstPolicy>;
  private invalidation = 0;
  private readonly invalidatedAccounts = new Set<string>();
  constructor(private readonly runtime: DurableChatRuntime, private readonly d: RuntimeDependencies,
    readonly ownerId: string, epoch: string,
    shared: { otherCapacity: () => MemoryCapacity; onSaveSettled: () => void }) {
    const options = d.memoryFirst!;
    this.policy = Object.freeze({ ...options.policy });
    this.archive = options.save ? null : new MemoryTextArchive(d.persistence, d.assets);
    this.foundation = new MemoryFirstFoundation({ userId: ownerId, epoch,
      policy: this.policy, save: options.save ?? this.archive!.save, now: d.now,
      saveVoiceObservation: options.saveVoiceObservation ?? this.archive?.saveVoiceObservation, ...shared });
  }
  eligibleVoice(): boolean { return Boolean(this.d.memoryFirst?.voice && this.eligible()); }
  eligible(): boolean { return !this.d.currentConfig?.current()?.calendar?.enabled || Boolean(this.d.calendar && isCalendarV2(this.d.calendar)); }
  owns(sessionId: string): boolean { return this.foundation.has(sessionId); }
  get loadingCount(): number { return this.loading.size; }
  hasRequest(sessionId: string, requestKey: string): boolean { return this.foundation.find(sessionId, requestKey) !== null; }
  attemptBudgets(userId: string, sessionId: string, attemptId: string) {
    this.user(userId); const e = this.entries.get(attemptId);
    return e?.turn.sessionId === sessionId ? { idleStreamTimeoutMs: e.budgets.idleStreamTimeoutMs,
      maxMessageBytes: e.budgets.maxMessageBytes } : null;
  }
  find(sessionId: string, turnId: string): Entry | null {
    if (this.sessions.get(sessionId)?.stale) return null;
    const turn = this.foundation.byTurn(sessionId, turnId);
    if (turn && this.sessions.get(sessionId)?.attempts.some(a => a.turnId === turnId && a.sequence > turn.sequence + 2)) return null;
    return turn ? this.entries.get(turn.attemptId) ?? null : null;
  }
  busy(sessionId: string): boolean { return this.owns(sessionId) && this.foundation.session(sessionId).dirty; }
  /** Called before entering the old durable path, including live reservations. */
  handoff(sessionId: string): void {
    if (!this.owns(sessionId)) return;
    if (this.busy(sessionId)) throw new AppError('NOT_READY', 'This chat is still saving. Try again shortly.');
    const state = this.sessions.get(sessionId);
    if (state) state.stale = true;
  }
  assertMutation(userId: string, sessionId: string): void {
    this.user(userId);
    // ponytail: reject mutation during dirty authority; add queued mutation/tombstone
    // projection only when pending rename/delete UX is explicitly implemented.
    if (this.busy(sessionId)) throw new AppError('NOT_READY', 'This chat is still saving. Try again shortly.');
    this.handoff(sessionId);
  }
  private user(userId: string): void {
    if (userId !== this.ownerId) throw new AppError('NOT_FOUND', 'Chat not found.');
  }
  private snapshot(): RuntimeConfigSnapshot {
    const s = this.d.currentConfig?.current();
    if (!s?.openRouter.apiKey || !s.modelLimits || s.modelLimits.modelId !== s.openRouter.modelId)
      throw new AppError('NOT_READY', 'Chat configuration is unavailable.');
    return s;
  }
  private evictCleanSessions(excludeSessionId?: string): void {
    const u = this.ownerId;
    this.foundation.evictCleanObservations();
    for (const id of this.foundation.sessionIds()) {
      if (id === excludeSessionId || this.loading.has(id) || this.runtime.work.get(u, id) ||
          this.runtime.reservations.hasSession(u, id)) continue;
      if (!this.foundation.evictClean(id)) continue;
      for (const [attemptId, entry] of this.entries) if (entry.turn.sessionId === id) this.entries.delete(attemptId);
      this.sessions.delete(id);
    }
  }
  private async hydrate(sessionId: string, snapshot: RuntimeConfigSnapshot): Promise<void> {
    this.evictCleanSessions(sessionId);
    if (this.owns(sessionId) && !this.sessions.get(sessionId)?.stale) return;
    const loading = this.loading.get(sessionId); if (loading) return loading;
    if (this.loading.size >= snapshot.budgets.maxConcurrentGenerationsPerProcess)
      throw new AppError('CONCURRENCY_LIMIT', 'Too many chat requests are active.');
    const load = (async () => {
      const p = this.d.persistence, u = this.ownerId;
      const session = await p.sessions.get(u, sessionId);
      if (!session || session.lifecycle !== 'active') throw new AppError('NOT_FOUND', 'Chat not found.');
      if (session.execution.ownerId || session.execution.activeAttemptId) throw new AppError('NOT_READY', 'Chat needs recovery.');
      const source = await p.memory.get(u, sessionId);
      if (!source) throw new AppError('NOT_READY', 'Chat context needs recovery.');
      validateManifest(source, { userId: u, sessionId }, this.d.assets, snapshot.budgets);
      if (session.memoryPublication && session.memoryPublication.version !== source.contextVersion)
        throw new AppError('NOT_READY', 'Chat save needs recovery.');
      const records = await p.messages.getReferences(u, sessionId, source.messageRefs);
      const pendingProposal = snapshot.calendar?.enabled
        ? await p.calendarProposals.getCurrentSlot(u, sessionId) : null;
      const connection = snapshot.calendar?.enabled ? await p.calendarConnectionsV2.get(u) : null;
      const accountBinding = connection?.schemaVersion === 2 && connection.enabled && connection.status === 'connected'
        ? { userId: u, connectionId: connection.connectionId, connectionRevision: connection.connectionRevision,
            googleSubjectId: connection.googleSubjectId } : null;
      const groups = snapshot.calendar?.enabled ? await calendarHistory(p, u, sessionId, records) : new Map();
      const attempts: AttemptRecord[] = [];
      let next: string | null = null;
      do {
        const found = await p.metadata.listAttempts(u, sessionId, { cursor: next,
          limit: Math.min(50, p.metadata.budgets.maxPageSize) });
        attempts.push(...found.items); next = found.nextCursor;
        if (attempts.length > this.policy.maxRequestsPerSession || (next && attempts.length >= this.policy.maxRequestsPerSession))
          throw new AppError('STORAGE_BUDGET_EXCEEDED', 'This chat has reached its record limit. Start a new chat.');
      } while (next);
      if (attempts.some(a => !terminal(a.status) || (session.memoryPublication && a.sequence > session.memoryPublication.sequence)))
        throw new AppError('NOT_READY', 'Chat save needs recovery.');
      const lease = { userId: u, sessionId, ownerId: p.owner.executorId,
        generation: session.execution.generation, leaseExpiresAt: this.runtime.now() };
      const graph = await this.runtime.graph(lease);
      const state = await graph.getState(graphConfig(u, sessionId));
      if (state.next.length || !isDeepStrictEqual(state.values.boundary, boundaryFor(source)))
        throw new AppError('NOT_READY', 'Chat graph needs recovery.');
      const ids = records.filter(r => r.mode === 'live' && r.role === 'assistant' && r.attemptId).map(r => r.attemptId!);
      const deliveries = ids.length ? await p.metadata.getVoiceDeliveries(u, sessionId, ids) : [];
      const archive: MessageRecord[] = [];
      next = null;
      do {
        const found = await p.messages.listForContext(u, sessionId, { cursor: next, limit: Math.min(50, p.messages.budgets.maxPageSize) });
        archive.push(...found.items); next = found.nextCursor;
        if (archive.length > this.policy.maxTurnsPerSession * 2 || (next && archive.length >= this.policy.maxTurnsPerSession * 2))
          throw new AppError('STORAGE_BUDGET_EXCEEDED', 'This chat has reached its record limit. Start a new chat.');
      } while (next);
      if (session.memoryPublication && archive.some(r => r.sequence > session.memoryPublication!.sequence))
        throw new AppError('NOT_READY', 'Chat save needs recovery.');
      const counter = p.owner.store ? await p.owner.store.read('metadata', counterSchema,
        { _id: key('sequence-counter', u, sessionId), userId: u, sessionId }) : null;
      const nextSequence = Math.max(Math.max(-1, ...archive.map(r => r.sequence), ...attempts.map(a => a.sequence)) + 1, counter?.next ?? 0);
      const native = await readMemoryCalendarStates(p, session, records, this.policy.maxRequestsPerSession, attempts);
      this.foundation.hydrate({ manifest: source, records }, deliveries, nextSequence, archive, native);
      this.sessions.set(sessionId, { session, attempts, stale: false, groups, accountBinding,
        pendingProposal: pendingProposal?.state === 'pending' ? pendingProposal : null });
    })();
    this.loading.set(sessionId, load);
    try { await load; } finally { this.loading.delete(sessionId); }
  }
  async submit(c: SubmitTurnCommand, retry?: { previous: Entry | AttemptRecord; input: MessageRecord }, live?: SubmitLiveTurn): Promise<ReturnType<typeof responseFor>> {
    const identity = this.runtime.identity(c.identity); this.runtime.ready();
    if (identity.userId !== this.ownerId) throw new AppError('NOT_FOUND', 'Chat not found.');
    const sessionId = sessionIdFor(c.identity.userId, c.sessionId, c.idempotencyKey);
    this.evictCleanSessions(sessionId);
    const existing = this.foundation.find(sessionId, c.idempotencyKey);
    const accept = (config: MemoryAcceptance['config']) => {
      try { return this.foundation.accept({ sessionId, requestKey: c.idempotencyKey, content: c.content,
        ...(c.expectedEpoch ? { expectedEpoch: c.expectedEpoch } : {}),
        mode: live ? 'live' : 'text', voice: live?.voice ?? null, calendarReplyTo: c.calendarReplyTo ?? null, config,
        ...(retry ? { retryOf: { turnId: retry.input.turnId, userMessageId: retry.input.messageId,
          inputEventId: retry.input.eventId, sequence: retry.input.sequence, createdAt: retry.input.createdAt,
          previousAttemptId: 'turn' in retry.previous ? retry.previous.turn.attemptId : retry.previous.attemptId } } : {}),
      }); } catch (error) { throw this.admissionError(error); }
    };
    if (existing) {
      const entry = this.entries.get(existing.attemptId)!;
      validateInput(c.content, entry.budgets);
      if (this.sessions.get(sessionId)?.stale) {
        const record = await this.d.persistence.sessions.get(c.identity.userId, sessionId);
        if (!record || record.lifecycle !== 'active') throw new AppError('NOT_FOUND', 'Chat not found.');
      }
      accept(existing.config);
      return { ...responseFor(this.attempt(entry)), processEpoch: existing.epoch };
    }
    const snapshot = live?.configSnapshot ?? this.snapshot();
    if (live && (!live.voice || this.policy.maxEvidenceBytes < 8192))
      throw new AppError('NOT_READY', 'Voice memory capacity is unavailable.');
    validateInput(c.content, snapshot.budgets);
    const assertMode = () => live ? this.runtime.reservations.assertLive(live.reservation, c.identity, sessionId)
      : this.runtime.reservations.assertText(c.identity.userId, sessionId);
    assertMode();
    if (live?.freshConversation && sessionId !== sessionIdFor(c.identity.userId, null, c.idempotencyKey))
      throw new AppError('INVALID_REQUEST', 'New conversation identity is invalid.');
    if (c.sessionId !== null && !live?.freshConversation) await this.hydrate(sessionId, snapshot);
    const legacy = this.sessions.get(sessionId)?.attempts.find(a => a.idempotencyKey === c.idempotencyKey);
    if (legacy) {
      const original = this.foundation.history(sessionId).find(r => r.messageId === legacy.causal.userMessageId);
      if (!original || (live ? original.mode !== 'live' || original.voiceSessionId !== live.voice?.voiceSessionId
          : original.visibility === 'internal' || original.mode === 'live') ||
          (!retry && legacy.causal.previousAttemptId !== null) || original.content !== c.content ||
          !isDeepStrictEqual(legacy.calendarReplyTo ?? null, c.calendarReplyTo ?? null))
        throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'This request identity has different input.');
      return responseFor(legacy);
    }
    this.runtime.ready();
    assertMode();
    if (!existing && this.runtime.work.get(c.identity.userId, sessionId)) throw new AppError('CONFLICT_ACTIVE_TURN', 'Another turn is active.');
    const turn = accept({ revision: String(snapshot.revision), modelId: snapshot.openRouter.modelId,
          instructionVersion: this.d.assets.instructionVersion, knowledgeContentHash: this.d.assets.knowledgeContentHash,
          graphSchemaVersion: this.d.assets.graphSchemaVersion });
    if (!this.entries.has(turn.attemptId)) this.entries.set(turn.attemptId, { identity, turn, snapshot, budgets: snapshot.budgets, status: 'accepted', error: null, running: false,
      ...(retry && 'turn' in retry.previous ? { initialBudget: this.foundation.result(retry.previous.turn)?.calendar?.budget } : {}) });
    if (!this.sessions.has(sessionId)) {
      const at = turn.createdAt;
      this.sessions.set(sessionId, { attempts: [], stale: false, session: { schemaVersion: 1,
        userId: turn.userId, sessionId, title: titleFor(c.content, snapshot.budgets.titleMaxChars),
        createdAt: at, updatedAt: at, lastActivityAt: at, lifecycle: 'active', graphThreadId: graphThreadId(turn.userId, sessionId),
        latestTurnId: turn.turnId, execution: { ownerId: null, leaseExpiresAt: null, activeAttemptId: null, generation: 0 } } });
    }
    return { ...responseFor(this.attempt(this.entries.get(turn.attemptId)!)), processEpoch: turn.epoch };
  }
  private admissionError(error: unknown): AppError {
    const message = error instanceof Error ? error.message : '';
    if (/payload/i.test(message)) return new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'This request identity has different input.');
    if (/active/i.test(message)) return new AppError('CONFLICT_ACTIVE_TURN', 'Another turn is active.');
    return new AppError('NOT_READY', 'Chat memory or saving capacity is unavailable. Try again shortly.');
  }
  private attempt(e: Entry): AttemptRecord {
    const t = e.turn;
    return { schemaVersion: 1, kind: 'attempt', userId: t.userId, sessionId: t.sessionId,
      turnId: t.turnId, attemptId: t.attemptId, idempotencyKey: t.requestKey,
      payloadHash: hashPayload(t.content), status: e.status, sequence: t.sequence + 2,
      createdAt: t.createdAt, updatedAt: t.createdAt,
      instructionVersion: t.config.instructionVersion, knowledgeContentHash: t.config.knowledgeContentHash,
      graphSchemaVersion: t.config.graphSchemaVersion, modelId: t.config.modelId,
      contextVersion: t.contextVersion, openRouterUser: t.userId,
      generationId: e.accounting?.generationId ?? this.foundation.result(t)?.accounting?.generationId ?? null,
      truncated: e.status === 'truncated', errorCode: e.error?.code ?? null,
      causal: { userMessageId: t.userMessageId, previousAttemptId: t.retryOf?.previousAttemptId ?? null }, calendarReplyTo: t.calendarReplyTo };
  }
  status(userId: string, sessionId: string, turnId: string) {
    this.user(userId); const e = this.find(sessionId, turnId); if (!e) return null;
    const s = this.foundation.session(sessionId);
    return turnStatusResponseSchema.parse({ sessionId, turnId, attemptId: e.turn.attemptId,
      status: e.status, truncated: e.status === 'truncated', error: e.error?.toClientBody() ?? null,
      save: { state: this.foundation.saveState(e.turn), epoch: e.turn.epoch,
        version: this.foundation.result(e.turn)?.version ?? s.version, durableVersion: s.durableVersion } });
  }
  session(userId: string, sessionId: string): SessionRecord | null {
    this.user(userId); const s = this.sessions.get(sessionId);
    if (!s || s.stale || this.foundation.session(sessionId).fenced) return null;
    const latest = this.foundation.records(sessionId).at(-1);
    return { ...s.session, latestTurnId: latest?.turnId ?? s.session.latestTurnId,
      lastActivityAt: latest?.createdAt ?? s.session.lastActivityAt };
  }
  activeTurn(userId: string, sessionId: string) {
    this.user(userId);
    if (!this.session(userId, sessionId)) return null;
    const active = [...this.entries.values()].find(e => e.turn.sessionId === sessionId && !this.foundation.result(e.turn));
    if (!active || (active.status !== 'accepted' && active.status !== 'generating' && active.status !== 'finalizing')) return null;
    return { turnId: active.turn.turnId, attemptId: active.turn.attemptId, status: active.status, mode: active.turn.mode };
  }
  messages(userId: string, sessionId: string, query: PageQuery) {
    this.user(userId); if (!this.session(userId, sessionId)) return null;
    const { limit, after } = page(query, 'messages', userId, sessionId, this.d.config.budgets.maxPageSize);
    const records = this.foundation.history(sessionId);
    const active = [...this.entries.values()].find(e => e.turn.sessionId === sessionId && !this.foundation.result(e.turn));
    if (active && !records.some(r => r.messageId === active.turn.userMessageId)) records.push({ schemaVersion: 1, userId, sessionId, turnId: active.turn.turnId,
      attemptId: null, messageId: active.turn.userMessageId, eventId: active.turn.inputEventId,
      sequence: active.turn.sequence, role: 'user', content: active.turn.content, createdAt: active.turn.createdAt,
      completionStatus: 'accepted', truncated: false, mode: active.turn.mode,
      ...(active.turn.voice ? { visibility: 'internal', voiceSessionId: active.turn.voice.voiceSessionId } : {}) });
    const selected = records.filter(r => !after || r.sequence < Number(after.value))
      .sort((a, b) => b.sequence - a.sequence);
    const items = selected.slice(0, limit).reverse().map(r => visibleMessageSchema.parse({
      messageId: r.messageId, turnId: r.turnId, eventId: r.eventId, sequence: r.sequence,
      role: r.role, content: r.visibility === 'internal' ? '' : r.content, createdAt: r.createdAt, completionStatus: r.completionStatus,
      truncated: r.truncated, ...(r.mode ? { mode: r.mode } : {}),
      ...(r.voiceSessionId ? { voiceSessionId: r.voiceSessionId } : {}),
      ...(r.visibility === 'internal' ? { voiceTranscripts: [{ role: r.role, content: r.content, createdAt: r.createdAt }] } : {}),
      ...(r.canvasArtifacts ? { canvasArtifacts: r.canvasArtifacts } : {}),
      ...(r.calendarView ? { calendarView: r.calendarView } : {}) }));
    const oldest = items[0];
    const latest = [...this.entries.values()].filter(e => e.turn.sessionId === sessionId).at(-1);
    const activeTurn = this.activeTurn(userId, sessionId);
    return { items, olderAvailable: selected.length > limit, nextCursor: selected.length > limit && oldest
      ? cursor({ kind: 'messages', userId, sessionId, value: oldest.sequence, id: oldest.messageId }) : null,
      ...(latest ? { save: this.status(userId, sessionId, latest.turn.turnId)!.save, saveTurnId: latest.turn.turnId } : {}),
      ...(activeTurn ? { activeTurn } : {}) };
  }
  overlaySessions(userId: string, query: PageQuery, durable: { items: import('../contracts/api.js').SessionSummary[]; nextCursor: string | null }) {
    this.user(userId);
    const { limit, after } = page(query, 'sessions', userId, '', this.d.config.budgets.maxPageSize);
    const live = [...this.sessions.keys()].flatMap(s => {
      const record = this.session(userId, s);
      return record ? [{ sessionId: s, title: record.title, createdAt: record.createdAt,
        lastActivityAt: record.lastActivityAt, pinned: record.pinned ?? false }] : [];
    });
    const compare = (a: typeof live[number], b: typeof live[number]) => Number(b.pinned) - Number(a.pinned)
      || Buffer.compare(Buffer.from(b.lastActivityAt), Buffer.from(a.lastActivityAt))
      || Buffer.compare(Buffer.from(b.sessionId), Buffer.from(a.sessionId));
    const liveIds = new Set(live.map(s => s.sessionId));
    const items = [...durable.items.filter(s => !liveIds.has(s.sessionId)).map(s => ({ ...s, pinned: s.pinned ?? false })),
      ...live.filter(s => !after || compare(s, { ...s, sessionId: after.id,
        lastActivityAt: String(after.value), pinned: after.pinned ?? false }) > 0)].sort(compare);
    const selected = items.slice(0, limit), last = selected.at(-1);
    return { items: selected, nextCursor: last && (items.length > limit || durable.nextCursor)
      ? cursor({ kind: 'sessions', userId, sessionId: '', value: last.lastActivityAt, id: last.sessionId, pinned: last.pinned }) : null };
  }
  async cancel(c: CancelTurnCommand, live = false): Promise<boolean> {
    const identity = this.runtime.identity(c.identity);
    if (identity.userId !== this.ownerId) throw new AppError('NOT_FOUND', 'Chat not found.');
    const e = this.find(c.sessionId, c.turnId); if (!e) return false;
    if ((e.turn.mode === 'live') !== live) throw new AppError('NOT_FOUND', 'Turn not found.');
    if (e.turn.attemptId !== c.attemptId) throw new AppError('CONFLICT_ACTIVE_TURN', 'This attempt is no longer current.');
    if (this.foundation.result(e.turn)) return true;
    const work = this.runtime.work.get(c.identity.userId, c.sessionId);
    if (work) work.abort('CANCELLED');
    if (!e.running) this.finish(e, '', 'cancelled', new AppError('CANCELLED', 'Generation was cancelled.', false));
    return true;
  }
  async retry(c: RetryTurnCommand) {
    const identity = this.runtime.identity(c.identity);
    if (identity.userId !== this.ownerId) throw new AppError('NOT_FOUND', 'Chat not found.');
    if (c.expectedEpoch !== undefined && c.expectedEpoch !== this.foundation.epoch)
      throw new AppError('INTERRUPTED', 'This request belongs to an earlier server session; its outcome is unknown.', false);
    this.evictCleanSessions(c.sessionId);
    if (!this.owns(c.sessionId) || this.sessions.get(c.sessionId)?.stale) await this.hydrate(c.sessionId, this.snapshot());
    const duplicate = this.foundation.find(c.sessionId, c.idempotencyKey);
    if (duplicate) {
      if (duplicate.turnId !== c.turnId || !duplicate.retryOf)
        throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'This retry identity has different input.');
      return { ...responseFor(this.attempt(this.entries.get(duplicate.attemptId)!)), processEpoch: duplicate.epoch };
    }
    const e = this.find(c.sessionId, c.turnId);
    if (e?.native?.pending && !e.running && !this.foundation.result(e.turn)) {
      e.status = 'accepted'; e.error = null;
      return { ...responseFor(this.attempt(e)), processEpoch: e.turn.epoch };
    }
    const native = e && this.foundation.result(e.turn)?.calendar;
    if (native?.decisions.some(record => record.decision?.kind === 'call_tool' &&
        !native.results.some(result => result.decisionId === record.decisionId)))
      throw new AppError('NOT_READY', 'The pending Calendar decision needs saving; generation cannot be repeated.', false);
    const legacy = this.sessions.get(c.sessionId)?.attempts ?? [];
    const duplicateLegacy = legacy.find(a => a.idempotencyKey === c.idempotencyKey);
    if (duplicateLegacy) {
      if (duplicateLegacy.turnId !== c.turnId || duplicateLegacy.causal.previousAttemptId === null)
        throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'This retry identity has different input.');
      return responseFor(duplicateLegacy);
    }
    const prior = e ?? legacy.filter(a => a.turnId === c.turnId).sort((a, b) => a.sequence - b.sequence).at(-1);
    const attempts = new Set([...this.entries.values()].filter(e => e.turn.sessionId === c.sessionId && e.turn.turnId === c.turnId)
      .map(e => e.turn.attemptId).concat(legacy.filter(a => a.turnId === c.turnId).map(a => a.attemptId))).size;
    const input = e ? this.foundation.result(e.turn)?.input : prior && 'causal' in prior
      ? this.foundation.history(c.sessionId).find(r => r.messageId === prior.causal.userMessageId) : null;
    if (!prior || !input || input.mode === 'live' || !['failed', 'cancelled', 'interrupted'].includes(prior.status) || attempts >= 3 ||
        this.foundation.history(c.sessionId).some(r => r.turnId !== c.turnId && r.sequence > input.sequence))
      throw new AppError('INVALID_REQUEST', 'This response cannot be retried.');
    return this.submit({ identity: c.identity, sessionId: c.sessionId, idempotencyKey: c.idempotencyKey,
      ...(c.expectedEpoch ? { expectedEpoch: c.expectedEpoch } : {}), content: input.content }, { previous: prior, input });
  }
  private finish(e: Entry, content: string, status: MemoryTerminal['status'], error: AppError | null = null): void {
    const accounting = e.accounting ? { ...e.accounting, outcome: status } : undefined;
    this.foundation.complete(e.turn, { content, status, accounting,
      ...(e.calendar ? { calendar: e.calendar } : {}),
      ...(e.calendarView ? { calendarView: e.calendarView } : {}),
      ...(e.turn.mode === 'live' ? { delivery: e.delivery ?? this.unknownDelivery(e.turn, content) } : {}) }); e.status = status; e.error = error;
    // Terminal ledger/envelope retain public config revision and accounting only.
    // Release credential-bearing settings and the extra observation copy.
    e.snapshot = null; e.accounting = undefined; e.delivery = undefined; e.calendar = undefined;
    e.calendarView = undefined;
    e.native?.ledger.freeze(); e.native = undefined;
  }
  private unknownDelivery(t: MemoryTurn, textGenerated: string): VoiceDeliveryRecord {
    // No hearing is asserted when execution never started or settlement failed.
    return voiceDeliveryRecordSchema.parse({ schemaVersion: 1, kind: 'voice-delivery', userId: t.userId,
      sessionId: t.sessionId, voiceSessionId: t.voice!.voiceSessionId, turnId: t.turnId, attemptId: t.attemptId,
      responseId: key('voice-response', t.userId, t.sessionId, t.attemptId), eventId: randomUUID(), sequence: 1,
      speechId: null, providerSocketId: 'not-confirmed', status: 'unknown', audioDurationMs: null,
      audioPlayedMs: null, playedSamples: null, textGenerated, textSpoken: null, textRemaining: null,
      createdAt: t.createdAt, updatedAt: this.runtime.now() });
  }
  async interruptPending(): Promise<void> {
    for (const e of this.entries.values()) if (!e.running && !this.foundation.result(e.turn))
      this.finish(e, '', 'interrupted', new AppError('INTERRUPTED', 'Generation was interrupted.', false));
  }
  async stopPending(): Promise<void> {
    this.foundation.stopAdmission();
    await this.interruptPending();
  }
  invalidateCalendarAccount(account: CalendarAccountBinding, _reason?: string): void {
    this.invalidation++;
    this.invalidatedAccounts.add(JSON.stringify(account));
    // ponytail: one server user, bounded revision tombstones; fresh account gates
    // remain authoritative after older revisions leave this process-local cache.
    if (this.invalidatedAccounts.size > this.policy.maxRequestsPerSession)
      this.invalidatedAccounts.delete(this.invalidatedAccounts.values().next().value!);
    this.foundation.invalidateCalendarAccount(account);
    for (const state of this.sessions.values()) {
      if (state.accountBinding?.connectionId === account.connectionId &&
          state.accountBinding.connectionRevision === account.connectionRevision ||
          state.pendingProposal?.connectionId === account.connectionId && state.pendingProposal.connectionRevision === account.connectionRevision) {
        state.accountBinding = null; state.pendingProposal = null;
      }
      for (const [turnId, groups] of state.groups ?? []) state.groups!.set(turnId, groups.map(group =>
        group.sources.some(source => source.connectionId === account.connectionId && source.connectionRevision === account.connectionRevision)
          ? { ...group, result: { ...group.result, content: JSON.stringify({ kind: 'calendar-history-unavailable', message: CALENDAR_TOMBSTONE }) }, sources: [] }
          : group));
    }
  }
  private nativeInput(e: Entry): MessageRecord {
    const t = e.turn;
    return messageRecordSchema.parse({ schemaVersion: 1, userId: t.userId, sessionId: t.sessionId,
      turnId: t.turnId, attemptId: null, messageId: t.userMessageId, eventId: t.inputEventId,
      sequence: t.retryOf?.sequence ?? t.sequence, role: 'user', content: t.content,
      createdAt: t.retryOf?.createdAt ?? t.createdAt, completionStatus: 'accepted', truncated: false, mode: t.mode,
      ...(t.voice ? { visibility: 'internal', voiceSessionId: t.voice.voiceSessionId } : {}) });
  }
  private assertCalendar(native: NativeExecution, account?: CalendarAccountBinding): void {
    native.job.check();
    if (!this.d.currentConfig?.current()?.calendar?.enabled || native.invalidation !== this.invalidation ||
        account && this.invalidatedAccounts.has(JSON.stringify(account)))
      throw new AppError('NOT_READY', 'Calendar access is unavailable.', false);
  }
  private async promoteTurn(e: Entry, native: NativeExecution, cursor: CalendarCursor, refs: CalendarRefs) {
    const p = this.d.persistence, cal = this.d.calendar, t = e.turn, snapshot = e.snapshot!;
    if (!cal || !isCalendarV2(cal)) throw new AppError('NOT_READY', 'Calendar access is unavailable.');
    this.assertCalendar(native);
    await this.foundation.flushSession(t.sessionId);
    const state = this.foundation.session(t.sessionId);
    if (state.fenced || state.durableVersion !== t.contextVersion)
      throw new AppError('PERSISTENCE_ERROR', 'Chat progress must be saved before Calendar access.', false);
    this.assertCalendar(native);
    const job = native.job, timeout = snapshot.budgets.persistenceTimeoutMs;
    if (!native.promotion) {
      if (t.contextVersion === 0) await job.wait(p.sessions.createIfAbsent({ ...this.sessions.get(t.sessionId)!.session,
        memoryPublication: { version: 0, sequence: 0, epoch: t.epoch, fence: t.fence } }), timeout);
      this.assertCalendar(native);
      const owned = await job.wait(p.owner.acquire({ userId: t.userId, sessionId: t.sessionId,
        ownerId: p.owner.executorId, leaseMs: 180000 }), timeout);
      if (!owned.ok) throw new AppError('CONFLICT_ACTIVE_TURN', 'Another turn is active.');
      native.promotion = { lease: owned.lease, ready: false };
    }
    const promotion = native.promotion, lease = promotion.lease;
    this.assertCalendar(native);
    const write = <T>(action: () => Promise<T>) => job.wait(p.owner.run(lease, action), timeout);
    if (!p.messages.appendConfirmed || !p.metadata.putAttemptConfirmed || !p.metadata.compareAttemptConfirmed ||
        !p.calendarAccountingV2.getBudgetConfirmed || !p.calendarAccountingV2.createBudgetConfirmed ||
        !p.calendarAccountingV2.reserveDispatchConfirmed || !p.calendarAccountingV2.updateDispatchConfirmed)
      throw new AppError('PERSISTENCE_ERROR', 'Chat progress could not be confirmed.', false);
    await job.wait(p.owner.reserveAttempt(lease, t.attemptId), timeout);
    const input = this.nativeInput(e);
    const inputReceipt = await write(() => p.messages.appendConfirmed!(input));
    if (!promotion.receipt) promotion.receipt = await write(() => p.metadata.putAttemptConfirmed!({ ...this.attempt(e), status: 'accepted' }));
    promotion.attempt = promotion.receipt.record;
    if (!promotion.acceptance) promotion.acceptance = await job.wait(p.owner.confirmAcceptance(lease, t.attemptId,
      { input: inputReceipt, attempt: promotion.receipt }), timeout);
    if (promotion.receipt.record.status === 'accepted')
      promotion.receipt = await transitionConfirmed(p, lease, job, promotion.receipt, 'generating');
    promotion.attempt = promotion.receipt.record;
    const store = p.owner.store;
    if (!store) throw new AppError('PERSISTENCE_ERROR', 'Chat progress could not be confirmed.');
    await write(async () => {
      await store.collection('metadata').updateOne({ _id: key('sequence-counter', t.userId, t.sessionId),
        userId: t.userId, sessionId: t.sessionId }, { $setOnInsert: { schemaVersion: 1, kind: 'sequence-counter',
        userId: t.userId, sessionId: t.sessionId, _revision: 0 }, $max: { next: t.sequence + 3 } },
      { upsert: true, ...store.options() });
    });
    await write(() => p.memory.put(this.foundation.context(t).manifest));
    if (t.calendarReplyTo) await write(() => p.calendarProposals.bindReplyReference({ userId: t.userId,
      sessionId: t.sessionId, turnId: t.turnId, attemptId: t.attemptId, replyTo: t.calendarReplyTo! }));
    const account = await job.wait(cal.connection.currentAccount(), timeout);
    this.assertCalendar(native, account);
    if (promotion.binding && !isDeepStrictEqual(promotion.binding, account)) throw new AppError('NOT_READY', 'Calendar access has changed.', false);
    promotion.binding = account;
    const states = [...this.entries.values()].filter(prior => prior.turn.sessionId === t.sessionId && prior.turn.turnId === t.turnId && prior !== e)
      .map(prior => this.foundation.result(prior.turn)?.calendar).filter((value): value is MemoryCalendarState => Boolean(value));
    const active = memoryCalendarStateSchema.parse({ ...native.ledger.snapshot(), ...native.stage.records() });
    states.push(active);
    const accounting = p.calendarAccountingV2;
    let budget = await write(() => accounting.getBudgetConfirmed!(t.userId, t.sessionId, t.turnId));
    if (!budget) budget = await write(() => accounting.createBudgetConfirmed!({ ...active.budget,
      revision: 1, modelDispatches: 0, repairs: 0, logicalTools: 0, creates: 0, calendarRequests: 0,
      refreshRequests: 0, reservedUsd: '0', settledUsd: '0', debits: [] }));
    for (const dispatch of states.flatMap(value => value.dispatches).sort((a, b) => a.dispatchIndex - b.dispatchIndex)) {
      const next = { ...dispatch, connectionId: account.connectionId, connectionRevision: account.connectionRevision };
      let saved = await write(() => accounting.getDispatchConfirmed!(t.userId, dispatch.dispatchId));
      if (!saved) {
        const reservation = { ...next, status: 'reserved' as const, reportedModel: null, reportedProvider: null,
          generationId: null, providerRequestId: null, endedAt: null, firstOutputAt: null, promptTokens: null,
          completionTokens: null, cachedPromptTokens: null, cacheWriteTokens: null, reasoningOutputTokens: null,
          money: unavailableMoney(true), reservationStatus: 'held' as const, failure: null };
        const reserved = await write(() => accounting.reserveDispatchConfirmed!(reservation, budget!));
        saved = reserved.dispatch; budget = reserved.budget;
      }
      if (saved.record.status === 'reserved' && next.status === 'terminal') {
        const dispatched = await write(() => accounting.updateDispatchConfirmed!(saved!, { ...saved!.record, status: 'dispatched' }, budget!));
        saved = dispatched.dispatch; budget = dispatched.budget;
      }
      if (!isDeepStrictEqual(saved.record, next)) {
        const updated = await write(() => accounting.updateDispatchConfirmed!(saved!, next, budget!));
        budget = updated.budget;
      }
    }
    for (const value of states) {
      for (const decision of value.decisions) await write(() => p.skillDecisions.put({ ...decision,
        connectionId: account.connectionId, connectionRevision: account.connectionRevision }));
      for (const rejected of value.rejected) await write(() => p.calendarDecisionsV2.putRejected(rejected));
      for (const result of value.results) await write(() => p.skillResults.put(result));
    }
    if (!budget || budget.record.modelDispatches !== active.budget.modelDispatches ||
        budget.record.reservedUsd !== active.budget.reservedUsd || budget.record.settledUsd !== active.budget.settledUsd)
      throw new AppError('PERSISTENCE_ERROR', 'Calendar accounting could not be confirmed.', false);
    this.assertCalendar(native, account);
    await job.wait(cal.connection.requireAccountCurrent(account, job.signal), timeout);
    this.assertCalendar(native, account);
    const ledger = promotion.ledger ?? new CalendarTurnLedger({ accounting: asCalendarAccountingPort(p),
      identity: { userId: t.userId, sessionId: t.sessionId, turnId: t.turnId, attemptId: t.attemptId,
        openRouterUser: t.userId, createdAt: active.budget.createdAt, deadlineAt: active.budget.deadlineAt },
      limits: snapshot.calendar!.limits ?? CALENDAR_LIMITS, write,
      clock: () => Date.parse(this.runtime.now()), modelId: snapshot.openRouter.modelId,
      pricing: snapshot.modelLimits!.calendar!.pricing, configRevision: snapshot.revision, connection: account,
      maxOutputTokens: snapshot.budgets.maxOutputTokens, processingPolicyId: snapshot.calendar!.processingPolicyId!,
      job, fence: () => p.owner.fence(lease), requireCurrent: async () => {
        this.assertCalendar(native, account); await cal.connection.requireAccountCurrent(account, job.signal);
        this.assertCalendar(native, account);
      } });
    await ledger.ensureBudget();
    promotion.graph ??= await this.runtime.graph(lease);
    const boundCursor = { ...cursor, connectionId: account.connectionId,
      connectionRevision: account.connectionRevision, ...(cursor.version === 2 ? { accountSubjectId: account.googleSubjectId } : {}) };
    await job.wait(promotion.graph.updateState(graphConfig(t.userId, t.sessionId), {
      input: { attempt: promotion.attempt, assistantSequence: t.sequence + 1 }, boundary: boundaryFor(this.foundation.context(t).manifest),
      result: null, sealed: false, rebase: null, calendarCursor: boundCursor, calendarSeal: null, calendarRefs: refs,
    }, 'prepare'), timeout);
    this.assertCalendar(native, account);
    promotion.ledger = ledger; promotion.ready = true; native.pending = false;
    return { lease, binding: { ...account, calendarId: 'primary', targetRevision: 1 }, ledger };
  }
  private async publishPromoted(e: Entry, seal: CalendarSeal, content: string, artifacts: readonly CanvasArtifactProjection[]): Promise<void> {
    const native = e.native!, promoted = native.promotion!, p = this.d.persistence, t = e.turn;
    const job = native.job, timeout = e.budgets.persistenceTimeoutMs, graph = promoted.graph!;
    const source = this.foundation.context(t), input = this.nativeInput(e);
    const assistantFields = { mode: t.mode, ...(t.voice ? { visibility: 'internal' as const, voiceSessionId: t.voice.voiceSessionId } : {}),
      ...(artifacts.length ? { canvasArtifacts: [...artifacts] } : {}) };
    if (e.delivery) await job.wait(p.owner.run(promoted.lease, async () => {
      const store = p.owner.store;
      if (!store) throw new AppError('PERSISTENCE_ERROR', 'Voice delivery could not be saved.');
      const id = key('voice-delivery', t.userId, t.sessionId, t.attemptId);
      const existing = await store.read('metadata', voiceDeliveryRecordSchema,
        { _id: id, userId: t.userId, sessionId: t.sessionId });
      if (existing) {
        if (!isDeepStrictEqual(existing, e.delivery)) {
          throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Saved voice delivery differs.');
        }
        return;
      }
      await store.insert('metadata', voiceDeliveryRecordSchema, e.delivery!, id, p.metadata.budgets.maxDocumentBytes);
    }), timeout);
    const complete = await graph.getState(graphConfig(t.userId, t.sessionId));
    if (complete.next.length || !complete.values.sealed || !complete.values.calendarSeal)
      throw new AppError('PERSISTENCE_ERROR', 'The response save could not be confirmed.', false);
    await publishCalendarTurn({ persistence: p, work: job, lease: promoted.lease,
      attempt: promoted.attempt!, seal, narration: content, sources: native.loop.provenance(),
      assistantFields, now: () => Date.parse(this.runtime.now()), assistantSequence: t.sequence + 1,
      persistenceTimeoutMs: timeout, liveEvidence: { attemptReceipt: promoted.receipt!, confirmedSnapshot: complete,
        baseManifest: source.manifest, acceptedInput: input, acceptance: promoted.acceptance! },
      commitBoundary: async () => {
        await job.wait(graph.updateState(graphConfig(t.userId, t.sessionId), { boundary: boundaryFor(seal.target) }, 'seal'), timeout);
        const store = p.owner.store;
        if (!store) throw new AppError('PERSISTENCE_ERROR', 'Chat progress could not be confirmed.');
        await job.wait(p.owner.run(promoted.lease, async () => {
          const counter = { schemaVersion: 1, kind: 'sequence-counter', userId: t.userId, sessionId: t.sessionId };
          await store.collection('metadata').updateOne({ _id: key('sequence-counter', t.userId, t.sessionId),
            userId: t.userId, sessionId: t.sessionId }, { $setOnInsert: { ...counter, _revision: 0 },
            $max: { next: t.sequence + 3 } }, { upsert: true, ...store.options() });
          const marker = await store.collection('sessions').updateOne({ _id: key('session', t.userId, t.sessionId),
            userId: t.userId, sessionId: t.sessionId, lifecycle: 'active',
            'execution.ownerId': promoted.lease.ownerId, 'execution.generation': promoted.lease.generation },
          { $set: { memoryPublication: { version: seal.target.contextVersion, sequence: t.sequence + 2,
            epoch: t.epoch, fence: t.fence } }, $inc: { _revision: 1 } }, store.options());
          if (!marker.acknowledged || marker.matchedCount !== 1) throw new AppError('PERSISTENCE_ERROR', 'Chat progress could not be confirmed.');
        }), timeout);
      }, beforeTerminal: async completion => {
        if (!completion.receipt || !p.owner.finishAttempt) throw new AppError('PERSISTENCE_ERROR', 'The response save could not be confirmed.');
        await job.wait(p.owner.finishAttempt(promoted.lease, completion.receipt, completion.activityAt ?? t.createdAt), timeout);
        promoted.receipt = completion.receipt; promoted.attempt = completion.attempt;
      } });
    const output = messageRecordSchema.parse({ schemaVersion: 1, userId: t.userId, sessionId: t.sessionId,
      turnId: t.turnId, attemptId: t.attemptId, messageId: t.outputMessageId, eventId: t.outputEventId,
      sequence: t.sequence + 1, role: 'assistant', content, createdAt: seal.assistantCreatedAt,
      completionStatus: seal.outcome, truncated: seal.outcome === 'truncated', ...assistantFields,
      ...(seal.version === 2 && seal.view ? { calendarView: seal.view } : {}),
      ...(native.loop.provenance().length ? { sourceProvenance: native.loop.provenance() } : {}) });
    this.foundation.commitPromoted(t, { input, output, manifest: seal.target, ...(e.delivery ? { delivery: e.delivery } : {}) });
    const cold = this.sessions.get(t.sessionId)!;
    cold.groups ??= new Map(); cold.groups.set(t.turnId, native.loop.toolGroups()); cold.accountBinding = promoted.binding;
    const pending = await p.calendarProposals.getCurrentSlot(t.userId, t.sessionId);
    cold.pendingProposal = pending?.state === 'pending' ? pending : null;
    cold.attempts.push(promoted.attempt!); e.status = seal.outcome; e.error = null;
    e.snapshot = null; e.accounting = undefined; e.delivery = undefined; e.calendar = undefined; e.native = undefined;
  }
  async reconcilePromoted(sessionId: string): Promise<void> {
    const e = [...this.entries.values()].find(entry => entry.turn.sessionId === sessionId &&
      entry.native?.promotion?.attempt && !this.foundation.result(entry.turn));
    if (!e) return;
    const p = this.d.persistence, t = e.turn;
    const session = await p.sessions.get(t.userId, sessionId);
    const attempt = await p.metadata.getAttempt(t.userId, sessionId, t.attemptId);
    const manifest = await p.memory.get(t.userId, sessionId);
    if (!session || session.execution.ownerId || session.execution.activeAttemptId || !attempt || !terminal(attempt.status) ||
        !manifest || manifest.contextVersion !== t.contextVersion + 1)
      throw new AppError('NOT_READY', 'Chat recovery is incomplete.');
    const input = await p.messages.get(t.userId, sessionId, t.userMessageId);
    if (!input) throw new AppError('NOT_READY', 'Chat recovery is incomplete.');
    const output = await p.messages.get(t.userId, sessionId, t.outputMessageId) ?? messageRecordSchema.parse({
      schemaVersion: 1, userId: t.userId, sessionId, turnId: t.turnId, attemptId: t.attemptId,
      messageId: t.outputMessageId, eventId: t.outputEventId, sequence: t.sequence + 1, role: 'assistant', content: '',
      completionStatus: attempt.status, truncated: attempt.truncated, createdAt: attempt.updatedAt, mode: t.mode,
      ...(t.voice ? { visibility: 'internal', voiceSessionId: t.voice.voiceSessionId } : {}) });
    const acquired = await p.owner.acquire({ userId: t.userId, sessionId, ownerId: p.owner.executorId, leaseMs: 180000 });
    if (!acquired.ok) throw new AppError('CONFLICT_ACTIVE_TURN', 'Chat work is still active.');
    try {
      const store = p.owner.store;
      if (!store) throw new AppError('PERSISTENCE_ERROR', 'Chat recovery could not be confirmed.');
      await p.owner.run(acquired.lease, async () => {
        const result = await store.collection('sessions').updateOne({ _id: key('session', t.userId, sessionId),
          userId: t.userId, sessionId, lifecycle: 'active', 'execution.ownerId': acquired.lease.ownerId,
          'execution.generation': acquired.lease.generation }, { $set: { memoryPublication: {
          version: manifest.contextVersion, sequence: t.sequence + 2, epoch: t.epoch, fence: t.fence } },
          $inc: { _revision: 1 } }, store.options());
        if (!result.acknowledged || result.matchedCount !== 1) throw new AppError('PERSISTENCE_ERROR', 'Chat recovery could not be confirmed.');
      });
    } finally { await p.owner.release(acquired.lease); }
    const delivery = t.mode === 'live' ? await p.metadata.getVoiceDelivery(t.userId, sessionId, t.attemptId) : null;
    this.foundation.commitPromoted(t, { input, output, manifest, ...(delivery ? { delivery } : {}) });
    const cold = this.sessions.get(sessionId)!;
    cold.stale = false; cold.session = session; cold.attempts.push(attempt);
    cold.groups = await calendarHistory(p, t.userId, sessionId, this.foundation.records(sessionId));
    const pending = await p.calendarProposals.getCurrentSlot(t.userId, sessionId);
    cold.pendingProposal = pending?.state === 'pending' ? pending : null;
    cold.accountBinding = e.native!.promotion!.binding;
    e.status = attempt.status; e.error = attempt.errorCode ? new AppError(attempt.errorCode, 'This response is incomplete.', false) : null;
    e.snapshot = null; e.native = undefined; e.calendar = undefined;
  }
  async execute(c: ExecuteTurn): Promise<boolean> {
    const e = this.find(c.sessionId, c.turnId); if (!e) return false;
    this.user(c.userId);
    if (Boolean(c.live) !== (e.turn.mode === 'live') || e.turn.attemptId !== c.attemptId) throw new AppError('CONFLICT_ACTIVE_TURN', 'This attempt is no longer current.');
    if (c.live) this.runtime.reservations.assertLive(c.live.reservation, e.identity, c.sessionId);
    else this.runtime.reservations.assertText(c.userId, c.sessionId);
    if (e.running) throw new AppError('CONFLICT_ACTIVE_TURN', 'Another turn is active.');
    let sequence = 0;
    const send = (event: StreamEvent) => c.emit(streamEnvelopeSchema.parse({ protocolVersion: 1,
      sessionId: c.sessionId, turnId: c.turnId, attemptId: c.attemptId, sequence: sequence++, event }));
    const previous = this.foundation.result(e.turn);
    if (previous) {
      if (c.live) return true; // Replay never speaks again.
      await send({ type: 'status', status: e.status, truncated: e.status === 'truncated', save: this.status(c.userId, c.sessionId, c.turnId)!.save });
      for (let i = 0; i < previous.output.content.length; i += 1000)
        await send({ type: 'delta', text: previous.output.content.slice(i, i + 1000), ...(i === 0 ? { reset: true } : {}) });
      if (previous.status === 'completed' || previous.status === 'truncated')
        await send({ type: 'completed', outcome: previous.status, assistantMessageId: e.turn.outputMessageId,
          save: this.status(c.userId, c.sessionId, c.turnId)!.save,
          ...(previous.output.calendarView ? { calendarView: previous.output.calendarView } : {}) });
      else if (e.error) await send({ type: 'error', ...e.error.toClientBody() });
      return true;
    }
    const snapshot = e.snapshot;
    if (!snapshot) throw new AppError('NOT_READY', 'Accepted settings are unavailable.');
    this.runtime.ready();
    const job = this.runtime.work.attach(c.userId, c.sessionId, c.signal, snapshot.budgets.totalRunTimeoutMs);
    e.running = true; let partial = ''; let ended = false; let length = false;
    let started = false, liveFinished = false, settlementError: unknown;
    let promotedSeal: CalendarSeal | null = null;
    let reconcilePrefix = false;
    let narrated = false;
    const artifacts: CanvasArtifactProjection[] = [];
    const admittedArtifacts: CanvasArtifactProjection[] = [];
    const prose = c.live ? new SpeechProse(Math.min(32000, snapshot.budgets.maxInputChars), source => {
      artifacts.push({ ...source, responseId: key('voice-response', c.userId, c.sessionId, c.attemptId) });
    }) : null;
    const messageProseBudget = this.runtime.outputBudget(
      this.attempt(e), e.turn.sequence + 1, Boolean(c.live), snapshot.budgets.maxMessageBytes,
    );
    // ponytail: 2048B accounting + 1536B fixed delivery header + 8B surrogate-split reserve
    // cover all non-prose evidence fields; revisit only if VoiceDeliveryRecord adds fields.
    const liveEvidenceMaxBytes = this.policy.maxEvidenceBytes - 2048;
    const encodedStringBytes = (value: string) => Buffer.byteLength(JSON.stringify(value), 'utf8') - 2;
    const checkOutputCapacities = (nextProse: string, nextArtifacts: readonly CanvasArtifactProjection[]) => {
      const proseEncoded = encodedStringBytes(nextProse);
      const artifactsEncoded = nextArtifacts.length
        ? Buffer.byteLength(JSON.stringify({ canvasArtifacts: nextArtifacts }), 'utf8') - 1
        : 0;
      const viewEncoded = e.calendarView
        ? Buffer.byteLength(JSON.stringify({ calendarView: e.calendarView }), 'utf8') - 1 : 0;
      if (proseEncoded > messageProseBudget || proseEncoded + artifactsEncoded + viewEncoded > this.policy.maxOutputBytes ||
          (c.live && 1536 + 2 * proseEncoded + 8 + artifactsEncoded > liveEvidenceMaxBytes)) {
        throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The response exceeded its storage limit.', false);
      }
    };
    const publish = async (text: string) => {
      e.calendarView = e.native?.loop.viewSnapshot() ?? e.calendarView;
      if (text) {
        const nextPartial = partial + text;
        checkOutputCapacities(nextPartial, admittedArtifacts);
        partial = nextPartial;
        await c.live?.delta(text);
        await job.wait(send({ type: 'delta', text }), snapshot.budgets.idleStreamTimeoutMs);
      }
      if (c.live && prose?.visualSuffixStarted && !liveFinished) {
        liveFinished = true;
        await c.live.finish();
      }
      while (artifacts.length) {
        const artifact = artifacts.shift()!;
        const candidate = admittedArtifacts.some(existing => existing.ordinal === artifact.ordinal)
          ? admittedArtifacts : [...admittedArtifacts, artifact];
        checkOutputCapacities(partial, candidate);
        if (!c.live?.artifact || !await c.live.artifact(artifact)) throw new AppError('NOT_READY', 'Visual delivery is unavailable.');
        if (candidate !== admittedArtifacts) admittedArtifacts.push(artifact);
      }
    };
    const calendarFrame = async (frame: CalendarCompatibleEnvelope): Promise<void> => {
      if (frame.event.type === 'delta') {
        narrated = true;
        c.live?.modelOutput?.();
        await publish(prose ? prose.push(frame.event.text) : frame.event.text);
        return;
      }
      if (frame.event.type === 'calendar-view') e.calendarView = frame.event.view;
      if (!c.live) { await c.emitCalendar?.(frame); return; }
      try { void c.emitCalendar?.(frame).catch(() => undefined); }
      catch { /* Presentation cannot fail generation or authority. */ }
    };
    try {
      job.check(); e.status = 'generating';
      await job.wait(send({ type: 'status', status: 'generating', truncated: false }), snapshot.budgets.idleStreamTimeoutMs);
      const source = this.foundation.context(e.turn);
      const assembler = new ReferencedContextAssembler({ memory: this.d.persistence.memory, messages: this.d.persistence.messages,
        metadata: { getVoiceDelivery: async (_u, s, a) => this.foundation.deliveries(s).find(d => d.attemptId === a) ?? null,
          getVoiceDeliveries: async (_u, s, ids) => this.foundation.deliveries(s).filter(d => ids.includes(d.attemptId)) },
        assets: this.d.assets, budgets: snapshot.budgets });
      const assembled = await assembler.assemble({ userId: c.userId, sessionId: c.sessionId,
        turnId: c.turnId, newUserInput: e.turn.content, responseMode: c.live ? 'voice' : 'text',
        environment: defaultEnvironmentContext(new Date(this.runtime.now()), 'Etc/UTC') }, source);
      if (!assembled.ok) throw new AppError('CONTEXT_BUDGET_EXCEEDED', assembled.overflow.message, false);
      const adapterMaxBytes = c.live
        ? snapshot.budgets.maxMessageBytes
        : Math.min(messageProseBudget, this.policy.maxOutputBytes);
      if (c.live) {
        await c.live.start(this.attempt(e), async (value, expectedSequence) => {
          const record = voiceDeliveryRecordSchema.parse(value), prior = e.delivery;
          if (record.userId !== c.userId || record.sessionId !== c.sessionId || record.turnId !== c.turnId ||
            record.attemptId !== c.attemptId || record.voiceSessionId !== e.turn.voice!.voiceSessionId ||
            record.responseId !== key('voice-response', c.userId, c.sessionId, c.attemptId) ||
            (!prior && (record.status !== 'pending' || record.sequence !== 1 || record.canvasArtifacts !== undefined)) ||
            (prior && (prior.status !== 'pending' || prior.providerSocketId !== record.providerSocketId ||
              (prior.canvasArtifacts ?? []).some((artifact, i) => !isDeepStrictEqual(artifact, record.canvasArtifacts?.[i])))) ||
            (expectedSequence === undefined ? prior !== undefined : prior?.sequence !== expectedSequence || record.sequence !== expectedSequence + 1) ||
            Buffer.byteLength(JSON.stringify(record), 'utf8') > liveEvidenceMaxBytes)
            throw new AppError('INVALID_REQUEST', 'Voice evidence is invalid.');
          e.delivery = record;
        });
        started = true;
      }
      if (snapshot.calendar?.enabled && this.d.calendar && isCalendarV2(this.d.calendar)) {
        const t = e.turn, attempt = this.attempt(e), limits = snapshot.calendar.limits ?? CALENDAR_LIMITS;
        if (!e.native) {
        const ledger = new MemoryCalendarLedger({ identity: { userId: c.userId, sessionId: c.sessionId,
          turnId: c.turnId, attemptId: c.attemptId, openRouterUser: attempt.openRouterUser,
          createdAt: e.initialBudget?.createdAt ?? t.createdAt,
          deadlineAt: e.initialBudget?.deadlineAt ?? new Date(Date.parse(t.createdAt) + snapshot.budgets.totalRunTimeoutMs).toISOString() },
          limits, clock: () => Date.parse(this.runtime.now()), modelId: attempt.modelId,
          pricing: snapshot.modelLimits!.calendar!.pricing, configRevision: snapshot.revision,
          maxOutputTokens: snapshot.budgets.maxOutputTokens, processingPolicyId: snapshot.calendar.processingPolicyId!, job,
          initialBudget: e.initialBudget });
        const stage = new MemoryCalendarStage(this.policy.maxEvidenceBytes, limits.modelDispatches);
        const cold = this.sessions.get(t.sessionId)!;
        const historicalGroups = new Map(cold.groups ?? []);
        for (const [turnId, groups] of this.foundation.nativeGroups(t.sessionId)) if (!historicalGroups.has(turnId)) historicalGroups.set(turnId, groups);
        const initialGroups = historicalGroups.get(t.turnId) ?? [];
        historicalGroups.delete(t.turnId);
        let native: NativeExecution;
        const loop = new CalendarLoop({ persistence: this.d.persistence, calendar: this.d.calendar, ledger,
          attempt, input: this.nativeInput(e),
          snapshot, limits, binding: { ...(cold.accountBinding ?? { userId: t.userId, connectionId: 'memory-unbound', connectionRevision: 1,
            googleSubjectId: 'memory-unbound' }), calendarId: 'primary', targetRevision: 1 },
          context: assembled.context, job, lease: null, sequence: { value: 0 },
          emitCalendar: calendarFrame, assets: this.d.assets, manifest: source.manifest, assistantSequence: t.sequence + 1,
          fetcher: this.d.fetcher ?? fetch, now: () => this.runtime.now(), diagnostics: this.d.diagnostics,
          historicalGroups, initialGroups, responseMode: c.live ? 'voice' : 'text',
          onView: view => { e.calendarView = view; },
          memory: { stage, records: source.records, pendingProposal: Boolean(cold.pendingProposal),
            promote: async (cursor, refs) => {
              try { return await this.promoteTurn(e, native, cursor, refs); }
              catch (error) { throw error instanceof AppError ? error : new AppError('PERSISTENCE_ERROR', 'Chat progress could not be confirmed.', false); }
            } },
        });
        native = { ledger, stage, loop, job, invalidation: this.invalidation, pending: false };
        e.native = native;
        }
        const native = e.native, loop = native.loop;
        native.job = job; native.ledger.rebindJob(job); loop.resume(job, calendarFrame);
        const input = { attempt, assistantSequence: t.sequence + 1 };
        const node = async (name: 'calendar_decide' | 'calendar_execute', action: () => Promise<CalendarGraphPatch>) => {
          const patch = await action();
          if (native.promotion?.ready) await job.wait(native.promotion.graph!.updateState(graphConfig(t.userId, t.sessionId), patch, name), snapshot.budgets.persistenceTimeoutMs);
          return patch;
        };
        const graph = buildTurnGraph(undefined, { prepare: async () => ({ calendarCursor: loop.initialCursor() }),
          generate: async () => { throw new AppError('NOT_READY', 'Native decision is required.'); },
          decide: current => job.track(node('calendar_decide', () => loop.decide(current))),
          execute: current => job.track(node('calendar_execute', () => loop.execute(current))) });
        try {
          const result = await graph.invoke({ input, boundary: boundaryFor(source.manifest), result: null,
            sealed: false, calendarCursor: loop.initialCursor(), calendarSeal: null, calendarRefs: null },
          { signal: job.signal, recursionLimit: 48 });
          if (!result.sealed || !result.calendarSeal) throw new AppError('INTERRUPTED', 'The response ended early.', false);
          e.calendarView = result.calendarSeal.version === 2 ? result.calendarSeal.view : undefined;
          const text = loop.narration();
          if ((!c.live && partial !== text) || (c.live && !narrated)) {
            // Local validation/repair fallback is produced by the same loop and
            // can seal without model deltas. It still uses the bounded output path.
            if (partial) throw new AppError('PROVIDER_ERROR', 'The response could not be confirmed.', false);
            await publish(prose ? prose.push(text) : text);
          }
          if (prose) await publish(prose.finish());
          if (c.live && !liveFinished) { liveFinished = true; await c.live.finish(); }
          length = result.calendarSeal.outcome === 'truncated';
          if (native.promotion?.ready) {
            await job.wait(native.promotion.graph!.updateState(graphConfig(t.userId, t.sessionId), {
              ...result, sealed: true }, 'seal'), snapshot.budgets.persistenceTimeoutMs);
            promotedSeal = result.calendarSeal;
          }
        } finally {
          // LangGraph may return on abort while a node is unwinding its adapter.
          // Keep ownership/accounting mutable until every actual node settles.
          await job.settled();
          if (!native.promotion?.ready) e.calendar = memoryCalendarStateSchema.parse({ ...native.ledger.snapshot(), ...native.stage.records() });
        }
      } else {
        const services = createModelServices({ identity: { userId: e.turn.userId }, openRouter: snapshot.openRouter,
          budgets: { ...snapshot.budgets, maxMessageBytes: adapterMaxBytes } }, snapshot.modelLimits!,
        { putAccounting: async record => { e.accounting = record; } }, this.d.fetcher, Math.random, this.d.diagnostics?.emit);
        const adapter = services.createAttemptAdapter({ schemaVersion: 1, kind: 'accounting', userId: c.userId,
          sessionId: c.sessionId, turnId: c.turnId, attemptId: c.attemptId, generationId: null,
          requestedModel: snapshot.openRouter.modelId, reportedModel: null, reportedProvider: null,
          promptTokens: null, completionTokens: null, cost: null, accountingStatus: 'unknown',
          outcome: 'generating', startedAt: e.turn.createdAt, endedAt: null }, async () => {});
        const input = { attempt: this.attempt(e), assistantSequence: e.turn.sequence + 1 };
        // No checkpointer: each invocation owns only this turn. History is the trusted
        // foundation snapshot; no restored graph messages can duplicate it.
        const graph = buildTurnGraph(undefined, { prepare: async () => { job.check(); }, generate: async () => {
          c.live?.modelStarted?.();
          for await (const chunk of adapter.stream({ modelId: snapshot.openRouter.modelId, user: c.userId,
            messages: assembled.context.messages, maxOutputTokens: snapshot.budgets.maxOutputTokens,
            abortSignal: job.signal, transforms: [], dataCollection: snapshot.openRouter.dataCollection })) {
            job.check();
            if (chunk.type === 'delta') { c.live?.modelOutput?.(); await publish(prose ? prose.push(chunk.text) : chunk.text); }
            if (chunk.type === 'usage') await job.wait(send(chunk), snapshot.budgets.idleStreamTimeoutMs);
            if (chunk.type === 'length') length = true;
            if (chunk.type === 'end') ended = true;
            if (chunk.type === 'error') throw new AppError('PROVIDER_ERROR', 'The model service could not answer.', false);
          }
          if (!ended || !e.accounting?.generationId) throw new AppError('INTERRUPTED', 'The response stream ended early.', false);
          if (prose) await publish(prose.finish());
          if (c.live && !liveFinished) { liveFinished = true; await c.live.finish(); }
          const assistant = messageRecordSchema.parse({ schemaVersion: 1, userId: c.userId,
            sessionId: c.sessionId, turnId: c.turnId, attemptId: c.attemptId, messageId: e.turn.outputMessageId,
            eventId: e.turn.outputEventId, sequence: input.assistantSequence, role: 'assistant', content: partial,
            createdAt: e.turn.createdAt, completionStatus: length ? 'truncated' : 'completed', truncated: length, mode: e.turn.mode,
            ...(e.turn.voice ? { visibility: 'internal' as const, voiceSessionId: e.turn.voice.voiceSessionId } : {}),
            ...(admittedArtifacts.length ? { canvasArtifacts: admittedArtifacts } : {}) });
          bounded(messageRecordSchema, assistant, key('message', c.userId, c.sessionId, assistant.messageId), snapshot.budgets.maxMessageBytes);
          return { input, assistant, accounting: e.accounting, base: boundaryFor(source.manifest),
            target: buildReferenceManifest(c.userId, c.sessionId, source.manifest.contextVersion + 1,
              [...source.records, assistant], this.d.assets, snapshot.budgets), outcome: length ? 'truncated' : 'completed' };
        } });
        await graph.invoke({ input, sealed: false, result: null }, { signal: job.signal });
      }
      job.check(); e.status = 'finalizing';
      e.status = length ? 'truncated' : 'completed';
      if (!c.live) {
        if (promotedSeal) await this.publishPromoted(e, promotedSeal, partial, admittedArtifacts);
        else this.finish(e, partial, e.status);
      }
    } catch (error) {
      const failure = job.signal.aborted ? job.failure() : error instanceof AppError ? error
        : new AppError('PROVIDER_ERROR', 'The model service could not answer.', false);
      if (e.native?.promotion?.attempt && (e.native.promotion.ready || failure.code !== 'PERSISTENCE_ERROR')) {
        try {
          if (!promotedSeal) await this.runtime.interruptOwned(e.native.promotion.lease, job, e.native.promotion.attempt!, partial, failure, admittedArtifacts, e.turn.sequence + 1, e.calendarView);
          await this.d.persistence.owner.release(e.native.promotion.lease);
          reconcilePrefix = !e.native.promotion.ready;
        }
        catch { this.runtime.work.degraded = true; }
        this.sessions.get(e.turn.sessionId)!.stale = true;
        e.status = 'interrupted'; e.error = failure;
      } else if (!this.foundation.result(e.turn)) {
        e.status = failure.code === 'CANCELLED' ? 'cancelled' : ['INTERRUPTED', 'TIMEOUT'].includes(failure.code) ? 'interrupted' : 'failed';
        e.error = failure;
        if (failure.code === 'PERSISTENCE_ERROR' && e.native) e.native.pending = true;
        else if (!c.live) this.finish(e, partial, e.status, failure);
      }
    } finally {
      try {
        if (c.live) {
          try { if (started) await c.live.settle(partial, job.signal); }
          catch (error) { settlementError = error; }
          if (!e.delivery || e.delivery.status === 'pending' || e.delivery.textGenerated !== partial)
            e.delivery = this.unknownDelivery(e.turn, partial);
          if (promotedSeal && !e.error) {
            try { await this.publishPromoted(e, promotedSeal, partial, admittedArtifacts); }
            catch (error) { settlementError = error; this.sessions.get(e.turn.sessionId)!.stale = true; }
          } else if (!e.native?.pending && !this.sessions.get(e.turn.sessionId)?.stale)
            this.finish(e, partial, e.status as MemoryTerminal['status'], e.error);
        }
      } finally { await job.settled(); job.close(); e.running = false; }
    }
    if (reconcilePrefix) await this.reconcilePromoted(c.sessionId);
    if (settlementError) throw settlementError;
    // Release the generation slot before terminal publication; save promises belong
    // solely to the app-owned foundation and cannot delay this boundary.
    try {
      await send({ type: 'status', status: e.status, truncated: e.status === 'truncated', save: this.status(c.userId, c.sessionId, c.turnId)?.save });
      if (e.status === 'completed' || e.status === 'truncated')
        await send({ type: 'completed', outcome: e.status, assistantMessageId: e.turn.outputMessageId,
          save: this.status(c.userId, c.sessionId, c.turnId)!.save,
          ...(this.foundation.result(e.turn)?.output.calendarView
            ? { calendarView: this.foundation.result(e.turn)!.output.calendarView } : {}) });
      else if (e.error) await send({ type: 'error', ...e.error.toClientBody() });
    } catch { /* Same-process status/replay retains the honest terminal outcome. */ }
    return true;
  }
}
