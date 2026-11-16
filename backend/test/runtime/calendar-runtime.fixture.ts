/**
 * ============================================================================
 * FILE: calendar-runtime.fixture.ts
 * LOCATION: backend/test/runtime/calendar-runtime.fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Assembles deterministic end-to-end multi-calendar runtime test fixtures.
 *
 * ROLE IN PROJECT:
 *    Integrates in-memory MongoDB stores from calendarMemory, real Embedded MCP,
 *    CalendarApiTools v2, capability gates, and scripted model/provider fetches.
 *
 * KEY COMPONENTS:
 *    - calendarFixture: Complete runtime test harness with injected clock and stores.
 *    - CalendarFixtureControls: State manipulation, failures, and inspection hooks.
 *    - textWire / createWire / brokenTextWire / nativeWire: SSE wire stream helpers.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import type { SubmitTurnResponse } from '../../src/contracts/api.js';
import {
  type CalendarTurnBudget,
} from '../../src/contracts/calendar-accounting.js';
import {
  type CalendarConnectionBinding,
  type CalendarAccountCredentialPort,
} from '../../src/contracts/calendar-connections.js';
import {
  calendarAccountBindingSchema,
  calendarConnectionV2Schema,
  calendarResolvedTargetSchema,
  effectiveCalendarCapabilities,
  type CalendarAccountBinding,
  type CalendarAccessRole,
  type CalendarConnectionRecordV2,
  type CalendarDiscoveryEntry,
  type CalendarResolvedTarget,
} from '../../src/contracts/calendar-discovery.js';
import {
  type CalendarCapabilityGate,
  type CalendarProposalRecord,
} from '../../src/contracts/calendar-authority.js';
import {
  type CalendarExecutionPort,
  type CalendarExecutionPortV2,
  type CalendarOperation,
  type CalendarOperationV2,
  type CalendarRequestKindV2,
} from '../../src/contracts/calendar-operations.js';
import {
  CALENDAR_LIMITS,
  CALENDAR_PROOF_REVISION,
  CALENDAR_SCOPES,
} from '../../src/contracts/calendar-policy.js';
import { sourcePermissionSchema } from '../../src/contracts/calendar-sources.js';
import type { CalendarCreateInput } from '../../src/contracts/calendar-tools.js';
import { createCalendarModelPortV2 } from '../../src/model/calendar-adapter.js';
import { CalendarApi } from '../../src/plugins/google-calendar/calendar-api.js';
import { CalendarAvailabilityApi } from '../../src/plugins/google-calendar/calendar-availability-api.js';
import { CalendarApiTools } from '../../src/plugins/google-calendar/tools.js';
import { toolFault } from '../../src/plugins/google-calendar/tools-validation.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { nativeFrame, skillNativeWire, fixturePricing } from '../model/calendar-fixtures.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { googleJson } from '../plugins/google-calendar/tools-fixtures.js';
import { textConfigFixture, type TextConfigFixture } from './text-config-fixture.js';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoCalendarConnections } from '../../src/persistence/calendar-connections.js';
import { MongoCalendarOperations } from '../../src/persistence/calendar-operations.js';
import { MongoCalendarDecisions, MongoCalendarResults } from '../../src/persistence/calendar-evidence.js';
import { MongoCalendarAccounting } from '../../src/persistence/calendar-accounting.js';
import { MongoCalendarRetention } from '../../src/persistence/calendar-retention.js';
import { MongoCalendarProposals } from '../../src/persistence/calendar-proposals.js';
import { graphThreadId, type PersistenceBundle } from '../../src/persistence/index.js';
import { CalendarTurnLedger } from '../../src/chat-runtime/calendar-budget.js';
import type { CalendarCompatibleEnvelope, ProcessDiagnostics, RuntimeDependencies } from '../../src/chat-runtime/ports.js';
import { Telemetry } from '../../src/operations/telemetry.js';

const chargeCalendarRequest = CalendarTurnLedger.prototype.chargeCalendarRequest;

export type CalendarFailPoint =
  | 'acceptance' | 'dispatch-claim' | 'before-provider' | 'decision-save'
  | 'operation-reserve' | 'operation-dispatch' | 'operation-event' | 'receipt-save'
  | 'result-save' | 'result-save-v2' | 'checkpoint-seal' | 'aggregate-save' | 'archive-save'
  | 'manifest-save' | 'terminal-cas' | 'proposal-save' | 'proposal-consume'
  | 'preflight-save' | 'logical-debit' | 'create-debit';

export type CalendarFixtureControls = {
  calendarMemory: ReturnType<typeof calendarMemory> | null;
  modelWires: string[];
  modelBodies: Record<string, unknown>[];
  effects: { kind: 'create' | 'readback' | 'get' | 'list'; eventId: string | null; calendarId?: string }[];
  order: string[];
  frames: CalendarCompatibleEnvelope[];
  setBinding(binding: CalendarConnectionBinding | null): void;
  setPolicyAvailable(available: boolean): void;
  failOnce(point: CalendarFailPoint, afterCommit?: boolean, skip?: number): void;
  failOperationEvent(state: string): void;
  execute(ids: SubmitTurnResponse, signal?: AbortSignal): Promise<void>;
  onPhase?: (phase: 'validating' | 'repairing' | 'executing' | 'reconciling') => void;

  clock: () => number;
  advance(ms: number): void;
  setDiscovery(options?: { duplicateWorkNames?: boolean; entries?: CalendarDiscoveryEntry[] }): Promise<void>;
  setDefault(calendarId: string | null): Promise<void>;
  setAvailability(options: { busy?: { start: string; end: string }[]; calendarErrors?: Record<string, string> }): void;
  clearAvailability(): void;
  setRole(calendarId: string, role: CalendarAccessRole): Promise<void>;
  replaceAccount(accountEmail?: string): Promise<void>;
  currentProposal(sessionId: string): Promise<CalendarProposalRecord | null>;
  operationFor(ids: SubmitTurnResponse): Promise<CalendarOperationV2 | null>;
  requestKinds: CalendarRequestKindV2[];
  reply(proposal: CalendarProposalRecord, text: string, sessionId?: string | null): Promise<SubmitTurnResponse>;
  calendarGraphState(sessionId: string): Promise<any>;
  proposalAuthority(proposal: CalendarProposalRecord): Promise<any>;
  restartStoppedExecutor(): Promise<void>;
  ready: Promise<void>;
};

export type CalendarRuntimeFixture = TextConfigFixture & CalendarFixtureControls;

export function processDiagnosticCapture() {
  const lines: string[] = [];
  const telemetry = new Telemetry(line => { lines.push(line); });
  const diagnostics: ProcessDiagnostics = {
    emit: fields => telemetry.event('process', fields),
    run: (scope, work) => telemetry.inDiagnosticScope(scope, work),
  };
  return {
    diagnostics,
    lines,
    records: () => lines.map(line => JSON.parse(line) as Record<string, unknown>),
    hash: (value: string) => `h:${createHash('sha256').update(value).digest('hex').slice(0, 24)}`,
  };
}

class FailureInjector {
  private pending = new Map<CalendarFailPoint, { afterCommit: boolean; skip: number }>();
  failOnce(point: CalendarFailPoint, afterCommit = false, skip = 0) {
    this.pending.set(point, { afterCommit, skip });
  }
  async intercept<T>(point: CalendarFailPoint, action: () => Promise<T>): Promise<T> {
    const spec = this.pending.get(point);
    if (!spec) return action();
    if (spec.skip > 0) {
      spec.skip -= 1;
      return action();
    }
    this.pending.delete(point);
    if (!spec.afterCommit) {
      throw new AppError('PERSISTENCE_ERROR', 'Injected persistence failure.', false);
    }
    await action();
    throw new AppError('PERSISTENCE_ERROR', 'Injected persistence failure.', false);
  }
  /** The first armed point of the list wins; the injection stays one-shot. */
  async interceptAny<T>(points: CalendarFailPoint[], action: () => Promise<T>): Promise<T> {
    const armed = points.find(point => this.pending.has(point));
    if (!armed) return action();
    return this.intercept(armed, action);
  }
  take(point: CalendarFailPoint): { afterCommit: boolean } | undefined {
    const spec = this.pending.get(point);
    if (spec) this.pending.delete(point);
    return spec;
  }
}

export function textWire(content: string): string {
  return nativeFrame({ role: 'assistant', content }) + nativeFrame({}, 'stop') + 'data: [DONE]\n\n';
}

export function skillWire(name: 'activate_skill' | 'call_tool', envelope: unknown,
  callId = 'skill-call', assistantContent: string | null = null): string {
  return nativeFrame({ role: 'assistant', content: assistantContent, tool_calls: [{
    index: 0, id: callId, type: 'function', function: { name,
      arguments: typeof envelope === 'string' ? envelope : JSON.stringify(envelope) },
  }] }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
}

export function createWire(action: CalendarCreateInput, callId = 'create-one'): string {
  return skillWire('call_tool', {
    plugin: 'google-calendar', tool: 'calendar_create_event', arguments: action,
  }, callId);
}

export function brokenTextWire(): string {
  return nativeFrame({ role: 'assistant', content: 'The event is created.' });
}

export function malformedCreateWire(): string {
  return nativeFrame({
    role: 'assistant',
    tool_calls: [{
      index: 0, id: 'malformed-1', type: 'function',
      function: { name: 'calendar_create_event', arguments: '{invalid-json' },
    }],
  }) + nativeFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
}

export function loadWire(tool: string, callId = 'call_1'): string {
  return skillWire('activate_skill', { plugin: 'google-calendar', tools: [tool] }, callId);
}

export { skillNativeWire as nativeWire };

export function calendarFixture(
  diagnostics?: ProcessDiagnostics,
  persistenceOverride?: PersistenceBundle,
  memoryFirst?: RuntimeDependencies['memoryFirst'],
): CalendarRuntimeFixture {
  let currentClockMs = Date.now();
  const clock = () => currentClockMs;
  const advance = (ms: number) => { currentClockMs += ms; };

  const mem = persistenceOverride ? null : calendarMemory();
  const storageBudgets = { ...DEFAULT_BUDGETS };
  const calendarConnections = persistenceOverride?.calendarConnections ?? new MongoCalendarConnections(mem!.store, storageBudgets);
  const calendarOperations = persistenceOverride?.calendarOperations ?? new MongoCalendarOperations(mem!.store, storageBudgets);
  const calendarDecisions = persistenceOverride?.calendarDecisions ?? new MongoCalendarDecisions(mem!.store, storageBudgets);
  const calendarResults = persistenceOverride?.calendarResults ?? new MongoCalendarResults(mem!.store, storageBudgets);
  const calendarAccounting = persistenceOverride?.calendarAccounting ?? new MongoCalendarAccounting(mem!.store, storageBudgets, CALENDAR_LIMITS, clock);
  const calendarRetention = persistenceOverride?.calendarRetention ?? new MongoCalendarRetention(mem!.store, storageBudgets);
  const calendarProposals = persistenceOverride?.calendarProposals ?? new MongoCalendarProposals(mem!.store, storageBudgets, clock);
  const calendarConnectionsV2 = persistenceOverride?.calendarConnectionsV2 ?? calendarConnections.v2;
  const calendarOperationsV2 = persistenceOverride?.calendarOperationsV2 ?? calendarOperations.v2;
  const calendarDecisionsV2 = persistenceOverride?.calendarDecisionsV2 ?? calendarDecisions.v2;
  const calendarResultsV2 = persistenceOverride?.calendarResultsV2 ?? calendarResults.v2;
  const calendarAccountingV2 = persistenceOverride?.calendarAccountingV2 ?? calendarAccounting.v2;
  const skillDecisions = persistenceOverride?.skillDecisions ?? calendarDecisions.skills;
  const skillResults = persistenceOverride?.skillResults ?? calendarResults.skills;

  const defaultEntries: CalendarDiscoveryEntry[] = [
    {
      calendarId: 'personal@example.test', label: 'Personal', primary: true,
      accessRole: 'owner', privateAccess: true, timeZone: 'Etc/UTC',
      selected: true, hidden: false, deleted: false,
      capabilities: { readEvents: true, createEvents: true, availability: true },
    },
    {
      calendarId: 'team@example.test', label: 'Work', primary: false,
      accessRole: 'writer', privateAccess: true, timeZone: 'Etc/UTC',
      selected: true, hidden: false, deleted: false,
      capabilities: { readEvents: true, createEvents: true, availability: true },
    },
    {
      calendarId: 'read@example.test', label: 'Reading', primary: false,
      accessRole: 'reader', privateAccess: false, timeZone: 'Etc/UTC',
      selected: true, hidden: false, deleted: false,
      capabilities: { readEvents: true, createEvents: false, availability: true },
    },
  ];

  const secretEnvelope = { version: 1 as const, iv: 'fixture-iv', tag: 'fixture-tag', ciphertext: 'fixture-cipher' };
  const makeConnectionRecord = (userId: string, entries: CalendarDiscoveryEntry[], email = 'personal@example.test') =>
    calendarConnectionV2Schema.parse({
      schemaVersion: 2,
      userId,
      provider: 'google-calendar',
      connectionId: 'conn-aurvin-dev',
      revision: 1,
      connectionRevision: 1,
      credentialVersion: 1,
      googleSubjectId: 'google-sub-aurvin',
      accountEmail: email,
      enabled: true,
      status: 'connected',
      credentials: { access: secretEnvelope, refresh: secretEnvelope },
      tokenExpiresAt: new Date(clock() + 3600000).toISOString(),
      grantedScopes: [...CALENDAR_SCOPES],
      updatedAt: new Date(clock()).toISOString(),
      defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 1 },
      discovery: {
        schemaVersion: 2,
        connectionId: 'conn-aurvin-dev',
        connectionRevision: 1,
        discoveryRevision: 1,
        entries,
        fetchedAt: new Date(clock()).toISOString(),
        expiresAt: new Date(clock() + 300000).toISOString(),
        retentionExpiresAt: new Date(clock() + 300000).toISOString(),
        complete: true,
        truncated: false,
        nextPageToken: null,
        limitations: [],
        retentionPolicyId: 'fixture-policy',
      },
    });

  // Seed the connection into the configured store and expose ready:
  const ready = calendarConnectionsV2.create(makeConnectionRecord('aurvin-dev-user', defaultEntries)).then(() => undefined);

  const modelWires: string[] = [];
  const modelBodies: Record<string, unknown>[] = [];
  const effects: CalendarFixtureControls['effects'] = [];
  const order: string[] = [];
  const frames: CalendarCompatibleEnvelope[] = [];
  const injector = new FailureInjector();
  const savedEvents = new Map<string, Record<string, unknown>>();
  let policyAvailable = true;
  let modelIndex = 0;
  let onPhase: CalendarFixtureControls['onPhase'];
  let failEventState: string | null = null;
  const requestKinds: CalendarRequestKindV2[] = [];

  let availabilityConfig: {
    busy?: { start: string; end: string }[];
    calendarErrors?: Record<string, string>;
  } = { busy: [] };

  const permission = {
    content: 'retained' as const, minimalEvidenceAllowed: true, policyId: 'fixture-policy',
  };

  const gate: CalendarCapabilityGate & {
    currentAccount(): Promise<CalendarAccountBinding>;
    requireAccountCurrent(account: CalendarAccountBinding, signal: AbortSignal): Promise<CalendarConnectionRecordV2>;
    currentBinding(): Promise<CalendarConnectionBinding>;
    requireCurrent(expected: CalendarConnectionBinding, signal: AbortSignal): Promise<void>;
    credentials: CalendarAccountCredentialPort;
  } = {
    async currentAccount() {
      if (!policyAvailable) throw new AppError('NOT_READY', 'Calendar policy is unavailable.');
      const conn = await calendarConnectionsV2.get('aurvin-dev-user');
      if (!conn || conn.status === 'disconnected') throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
      if (!conn.enabled) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      return calendarAccountBindingSchema.parse({
        userId: conn.userId,
        connectionId: conn.connectionId,
        connectionRevision: conn.connectionRevision,
        googleSubjectId: conn.googleSubjectId,
      });
    },
    async requireAccountCurrent(account, signal) {
      if (signal.aborted) throw toolFault('cancelled', 'CALENDAR_CANCELLED');
      if (!policyAvailable) throw new AppError('NOT_READY', 'Calendar policy is unavailable.');
      const conn = await calendarConnectionsV2.get(account.userId);
      if (!conn) throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
      if (conn.userId !== account.userId || conn.connectionId !== account.connectionId
        || conn.connectionRevision !== account.connectionRevision
        || conn.googleSubjectId !== account.googleSubjectId) {
        throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      }
      return conn;
    },
    async currentBinding() {
      const acct = await this.currentAccount();
      return { ...acct, calendarId: 'primary', targetRevision: 1 };
    },
    async requireCurrent(expected, signal) {
      await this.requireAccountCurrent(expected, signal);
    },
    credentials: {
      async withAccessToken(input, action) {
        await gate.requireAccountCurrent(input.account, input.signal);
        return action('fixture-access-token');
      },
    },
    resolve: async input => {
      const conn = await gate.requireAccountCurrent(input.account, input.signal);
      const fresh = conn.discovery;
      let entry: CalendarDiscoveryEntry | undefined;
      let selectedBy: 'explicit' | 'saved-default' | 'primary';
      if (input.selector !== null) {
        if (input.selector === 'primary') {
          selectedBy = 'primary';
          entry = fresh.entries.find(e => e.primary);
          if (!entry) return { outcome: 'clarify', code: 'CALENDAR_PRIMARY_MISSING', candidates: [] };
        } else {
          selectedBy = 'explicit';
          const exactId = fresh.entries.find(e => e.calendarId === input.selector);
          if (exactId) {
            entry = exactId;
          } else {
            const norm = (s: string) => s.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
            const targetNorm = norm(input.selector);
            const labelMatches = fresh.entries.filter(e => norm(e.label) === targetNorm);
            if (labelMatches.length === 1) {
              entry = labelMatches[0];
            } else if (labelMatches.length > 1) {
              const candidates = labelMatches.slice(0, 20).map(cand => {
                const candCaps = effectiveCalendarCapabilities(cand.accessRole, conn.grantedScopes, !cand.hidden && !cand.deleted);
                return calendarResolvedTargetSchema.parse({
                  ...input.account,
                  calendarId: cand.calendarId,
                  calendarLabel: cand.label,
                  targetRevision: input.account.connectionRevision,
                  discoveryRevision: fresh.discoveryRevision,
                  selectedBy: 'explicit',
                  accessRole: cand.accessRole,
                  privateAccess: cand.privateAccess,
                  capabilities: candCaps,
                  verifiedAt: fresh.fetchedAt,
                  proofRevision: CALENDAR_PROOF_REVISION,
                });
              });
              return { outcome: 'clarify', code: 'CALENDAR_TARGET_AMBIGUOUS', candidates };
            } else {
              return { outcome: 'clarify', code: 'CALENDAR_TARGET_UNKNOWN', candidates: [] };
            }
          }
        }
      } else {
        const defaultId = conn.defaultSetting?.defaultCalendarId ?? null;
        if (defaultId !== null) {
          selectedBy = 'saved-default';
          entry = fresh.entries.find(e => e.calendarId === defaultId);
          if (!entry) return { outcome: 'clarify', code: 'CALENDAR_DEFAULT_UNAVAILABLE', candidates: [] };
        } else {
          selectedBy = 'primary';
          entry = fresh.entries.find(e => e.primary);
          if (!entry) return { outcome: 'clarify', code: 'CALENDAR_PRIMARY_MISSING', candidates: [] };
        }
      }
      const caps = effectiveCalendarCapabilities(entry.accessRole, conn.grantedScopes, !entry.hidden && !entry.deleted);
      const opKey = input.operation === 'read' ? 'readEvents' : input.operation === 'create' ? 'createEvents' : 'availability';
      if (!caps[opKey]) {
        return { outcome: 'denied', code: 'CALENDAR_TARGET_READ_ONLY' };
      }
      const resolved = calendarResolvedTargetSchema.parse({
        ...input.account,
        calendarId: entry.calendarId,
        calendarLabel: entry.label,
        targetRevision: input.account.connectionRevision,
        discoveryRevision: fresh.discoveryRevision,
        selectedBy,
        accessRole: entry.accessRole,
        privateAccess: entry.privateAccess,
        capabilities: caps,
        verifiedAt: fresh.fetchedAt,
        proofRevision: CALENDAR_PROOF_REVISION,
      });
      return { outcome: 'resolved', target: resolved };
    },
    requireCurrent: async (input: any, signal?: AbortSignal) => {
      const target = input.target ?? input;
      const sig = input.signal ?? signal ?? new AbortController().signal;
      const conn = await gate.requireAccountCurrent(target, sig);
      const entry = conn.discovery.entries.find((e: any) => e.calendarId === target.calendarId);
      if (!entry) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      const caps = effectiveCalendarCapabilities(entry.accessRole, conn.grantedScopes, !entry.hidden && !entry.deleted);
      const opKey = (input.operation === 'read' ? 'readEvents' : input.operation === 'create' ? 'createEvents' : 'availability') ?? 'createEvents';
      if (!caps[opKey]) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    },
  };

  const baseSnapshot = textSnapshot(1);
  const snapshot = {
    ...baseSnapshot,
    calendar: { enabled: true, limits: { ...CALENDAR_LIMITS }, processingPolicyId: 'fixture-policy' },
    modelLimits: {
      ...baseSnapshot.modelLimits!,
      calendar: {
        tools: true as const,
        nativeStrict: false,
        parallelToolCallsParameter: false,
        pricing: fixturePricing,
      },
    },
  };

  const h = textConfigFixture(snapshot, dependencies => {
    dependencies.now = clock;
    if (diagnostics) dependencies.diagnostics = diagnostics;
    const p = dependencies.persistence as typeof dependencies.persistence & {
      calendarAccounting: typeof calendarAccounting;
      calendarOperations: typeof calendarOperations;
      calendarDecisions: typeof calendarDecisions;
      calendarResults: typeof calendarResults;
      calendarRetention: typeof calendarRetention;
      calendarProposals: typeof calendarProposals;
      calendarConnectionsV2: typeof calendarConnections.v2;
      calendarOperationsV2: typeof calendarOperations.v2;
      calendarDecisionsV2: typeof calendarDecisions.v2;
      calendarResultsV2: typeof calendarResults.v2;
      calendarAccountingV2: typeof calendarAccounting.v2;
      skillDecisions: typeof skillDecisions;
      skillResults: typeof skillResults;
    };
    if (!persistenceOverride) {
      Object.assign(p, {
        messages: new MongoMessages(mem!.store, storageBudgets, clock),
        calendarConnections,
        calendarOperations,
        calendarDecisions,
        calendarResults,
        calendarAccounting,
        calendarRetention,
        calendarProposals,
        calendarConnectionsV2,
        calendarOperationsV2,
        calendarDecisionsV2,
        calendarResultsV2,
        calendarAccountingV2,
        skillDecisions,
        skillResults,
      });
    }

    const confirm = p.owner.confirmAcceptance.bind(p.owner);
    p.owner.confirmAcceptance = async (lease, attemptId) => {
      order.push('acceptance');
      await injector.intercept('acceptance', () => confirm(lease, attemptId));
      const att = await p.metadata.getAttempt(lease.userId, lease.sessionId, attemptId);
      return {
        schemaVersion: 1,
        kind: 'acceptance',
        userId: lease.userId,
        sessionId: lease.sessionId,
        turnId: att?.turnId ?? '',
        attemptId,
        userMessageId: att?.causal.userMessageId ?? '',
        payloadHash: att?.payloadHash ?? '',
      };
    };

    if (!persistenceOverride) {
      (p.owner as any).detachAccepted = async (lease: ExecutionLease, _attemptId: string) => {
        const session = await p.sessions.get(lease.userId, lease.sessionId);
        if (!session) throw new AppError('NOT_FOUND', 'Session not found.');
        session.execution.ownerId = null;
        session.execution.leaseExpiresAt = null;
        session.execution.generation += 1;
        await (p.sessions as any).createForInternalTurn(session);
        return { releasedGeneration: session.execution.generation };
      };
      (p.owner as any).attachAccepted = async (input: {
        userId: string;
        sessionId: string;
        attemptId: string;
        expectedGeneration?: number;
        leaseMs: number;
      }) => {
        const session = await p.sessions.get(input.userId, input.sessionId);
        if (!session) throw new AppError('NOT_FOUND', 'Session not found.');
        session.execution.ownerId = 'current';
        session.execution.generation += 1;
        const leaseExpiresAt = new Date(clock() + input.leaseMs).toISOString();
        session.execution.leaseExpiresAt = leaseExpiresAt;
        await (p.sessions as any).createForInternalTurn(session);
        return {
          lease: {
            userId: input.userId,
            sessionId: input.sessionId,
            ownerId: 'current',
            generation: session.execution.generation,
            leaseExpiresAt,
          },
          session,
        };
      };
    }

    const putDispatchV2 = calendarAccountingV2.putDispatch.bind(calendarAccountingV2);
    calendarAccountingV2.putDispatch = record => injector.intercept('dispatch-claim', () => putDispatchV2(record));
    if (calendarAccountingV2.reserveDispatchConfirmed) {
      const reserveConfirmed = calendarAccountingV2.reserveDispatchConfirmed.bind(calendarAccountingV2);
      calendarAccountingV2.reserveDispatchConfirmed = (record, budget) =>
        injector.intercept('dispatch-claim', () => reserveConfirmed(record, budget));
    }

    const putDecisionV2 = calendarDecisionsV2.put.bind(calendarDecisionsV2);
    calendarDecisionsV2.put = record => injector.intercept('decision-save', () => putDecisionV2(record));

    const putSkillDecision = skillDecisions.put.bind(skillDecisions);
    skillDecisions.put = record => injector.intercept('decision-save', () => putSkillDecision(record));

    const reserveByIntent = calendarOperationsV2.reserveByIntent.bind(calendarOperationsV2);
    calendarOperationsV2.reserveByIntent = input =>
      injector.intercept('operation-reserve', () => reserveByIntent(input));

    const casV2 = calendarOperationsV2.compareAndSwap.bind(calendarOperationsV2);
    calendarOperationsV2.compareAndSwap = async input => {
      const next = input.next;
      const point = next.receipt ? 'receipt-save' : next.state === 'dispatching' ? 'operation-dispatch' : null;
      return point ? injector.intercept(point, () => casV2(input)) : casV2(input);
    };

    const appendEvent = calendarOperations.appendEvent.bind(calendarOperations);
    calendarOperations.appendEvent = async event => {
      if (event.state === 'dispatching') order.push('operation-dispatch-event');
      if (failEventState === event.state) {
        failEventState = null;
        throw new AppError('PERSISTENCE_ERROR', 'Injected operation event failure.', false);
      }
      return injector.intercept('operation-event', () => appendEvent(event));
    };

    // The v2 runtime appends the durable v2 event. The unconfirmed-event crash
    // window must be injectable there too.
    const appendEventV2 = calendarOperationsV2.appendEventV2.bind(calendarOperationsV2);
    calendarOperationsV2.appendEventV2 = async event => {
      if (event.state === 'dispatching') order.push('operation-dispatch-event');
      if (failEventState === event.state) {
        failEventState = null;
        throw new AppError('PERSISTENCE_ERROR', 'Injected operation event failure.', false);
      }
      return injector.intercept('operation-event', () => appendEventV2(event));
    };

    const putResultV2 = calendarResultsV2.put.bind(calendarResultsV2);
    calendarResultsV2.put = record => injector.intercept('result-save-v2', () => putResultV2(record));

    const putSkillResult = skillResults.put.bind(skillResults);
    skillResults.put = record => injector.intercept('result-save', () => putSkillResult(record));

    const putProposal = calendarProposals.putCurrent.bind(calendarProposals);
    // A conflict proposal is the durable save of the preflight condition, so the
    // preflight window and the proposal window share one interception point.
    calendarProposals.putCurrent = input => injector.interceptAny(
      ['proposal-save', 'preflight-save'], () => putProposal(input));

    const consumeProposal = calendarProposals.consume.bind(calendarProposals);
    calendarProposals.consume = input => injector.intercept('proposal-consume', () => consumeProposal(input));

    const debit = calendarAccountingV2.debit.bind(calendarAccountingV2);
    calendarAccountingV2.debit = request => injector.intercept(
      request.kindOfDebit === 'create' ? 'create-debit' : 'logical-debit', () => debit(request));

    const putAggregate = calendarAccounting.putAggregate.bind(calendarAccounting);
    calendarAccounting.putAggregate = record => injector.intercept('aggregate-save', () => putAggregate(record));

    const append = p.messages.append.bind(p.messages);
    p.messages.append = async record => {
      if (record.role === 'assistant') {
        return injector.intercept('archive-save', () => append(record));
      }
      return append(record);
    };

    const putManifest = p.memory.put.bind(p.memory);
    p.memory.put = record => injector.intercept('manifest-save', () => putManifest(record));

    const compareAttempt = p.metadata.compareAttempt.bind(p.metadata);
    p.metadata.compareAttempt = (attempt, expected) =>
      injector.intercept('terminal-cas', () => compareAttempt(attempt, expected));

    const fetcher = dependencies.fetcher as ReturnType<typeof vi.fn<typeof fetch>>;
    fetcher.mockImplementation(async (url, init) => {
      const urlStr = String(url);
      const openRouter = new URL(urlStr);
      if (openRouter.origin === 'https://openrouter.ai' && openRouter.pathname === '/api/v1/chat/completions') {
        const fail = injector.take('before-provider');
        if (fail && !fail.afterCommit) {
          throw new AppError('PERSISTENCE_ERROR', 'Injected persistence failure.', false);
        }
        const wire = modelWires.shift();
        if (wire === undefined) throw new Error('Unexpected model request');
        modelIndex += 1;
        const specialized = wire
          .replaceAll('gen_fixture', `gen_cal_${modelIndex}`)
          .replaceAll('call_1', `call_cal_${modelIndex}`);
        modelBodies.push(JSON.parse(String(init?.body ?? '{}')));
        order.push('provider');
        if (fail?.afterCommit) {
          throw new AppError('PERSISTENCE_ERROR', 'Injected persistence failure.', false);
        }
        return new Response(specialized, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }

      const parsed = new URL(urlStr);
      if (parsed.origin !== 'https://www.googleapis.com' || !parsed.pathname.startsWith('/calendar/v3/')) {
        throw new Error(`Unexpected fetch URL: ${urlStr}`);
      }
      const method = String(init?.method ?? 'GET').toUpperCase();
      const parts = parsed.pathname.slice('/calendar/v3/'.length).split('/');

      // /users/me/calendarList
      if (method === 'GET' && parts[0] === 'users' && parts[1] === 'me' && parts[2] === 'calendarList') {
        const conn = await calendarConnectionsV2.get('aurvin-dev-user');
        const entries = conn?.discovery?.entries ?? defaultEntries;
        if (parts[3]) {
          const calendarId = decodeURIComponent(parts[3]);
          const entry = entries.find(item => item.calendarId === calendarId);
          order.push('google-calendar-capability');
          return entry ? googleJson({
            id: entry.calendarId,
            summary: entry.label,
            primary: entry.primary,
            accessRole: entry.accessRole,
            timeZone: entry.timeZone,
            hidden: entry.hidden,
            deleted: entry.deleted,
            selected: entry.selected,
          }) : new Response(JSON.stringify({ error: { errors: [{ reason: 'notFound' }] } }), {
            status: 404, headers: { 'content-type': 'application/json' },
          });
        }
        order.push('google-calendar-list');
        const items = entries.map(e => ({
          id: e.calendarId,
          summary: e.label,
          primary: e.primary,
          accessRole: e.accessRole,
          timeZone: e.timeZone,
          hidden: e.hidden,
          deleted: e.deleted,
          selected: e.selected,
        }));
        return googleJson({ kind: 'calendar#calendarList', items });
      }

      // /freeBusy
      if (method === 'POST' && parts[0] === 'freeBusy') {
        order.push('google-freebusy');
        const body = JSON.parse(String(init?.body ?? '{}')) as { timeMin: string; timeMax: string; items?: { id: string }[] };
        const calendars: Record<string, { busy: { start: string; end: string }[]; errors?: { domain: string; reason: string }[] }> = {};
        for (const item of body.items ?? []) {
          const err = availabilityConfig.calendarErrors?.[item.id];
          if (err) {
            calendars[item.id] = { busy: [], errors: [{ domain: 'global', reason: err }] };
          } else {
            const busyList = availabilityConfig.busy ?? [];
            calendars[item.id] = { busy: busyList };
          }
        }
        return googleJson({ kind: 'calendar#freeBusy', timeMin: body.timeMin, timeMax: body.timeMax, calendars });
      }

      // /calendars/{calendarId}/events...
      if (parts[0] === 'calendars' && parts.length >= 3 && parts[2] === 'events') {
        const calId = decodeURIComponent(parts[1]);
        if (method === 'POST' && parts.length === 3) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          const eventId = typeof body.id === 'string' ? body.id : null;
          if (!eventId) throw new Error('Calendar POST missing event id');
          const saved = {
            id: eventId,
            summary: body.summary,
            status: 'confirmed',
            start: body.start,
            end: body.end,
            htmlLink: `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(eventId)}`,
            ...(body.description === undefined ? {} : { description: body.description }),
            ...(body.location === undefined ? {} : { location: body.location }),
            extendedProperties: body.extendedProperties,
          };
          savedEvents.set(eventId, saved);
          order.push('google-create');
          return googleJson(saved);
        }
        if (method === 'GET' && parts.length === 4) {
          const eventId = decodeURIComponent(parts[3]);
          const saved = savedEvents.get(eventId) ?? {
            id: eventId, summary: 'Planning', status: 'confirmed',
            start: { dateTime: '2026-10-22T10:00:00Z', timeZone: 'Etc/UTC' },
            end: { dateTime: '2026-10-22T11:00:00Z', timeZone: 'Etc/UTC' },
            htmlLink: `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(eventId)}`,
          };
          return googleJson({ ...saved, id: eventId });
        }
        if (method === 'GET' && parts.length === 3) {
          return googleJson({ timeZone: 'Etc/UTC', items: [...savedEvents.values()] });
        }
      }

      throw new Error(`Unexpected Calendar request ${method} ${parsed.pathname}`);
    });

    const api = new CalendarApi({ fetcher, diagnostic: diagnostics?.emit });
    const availability = new CalendarAvailabilityApi({ fetcher, diagnostic: diagnostics?.emit });
    const tools = new CalendarApiTools({
      api,
      gate,
      credentials: gate.credentials,
      connections: calendarConnectionsV2,
      readDiscovery: async input => {
        const conn = await calendarConnectionsV2.get(input.account.userId);
        if (!conn) throw new AppError('NOT_READY', 'Calendar is not connected.');
        return { snapshot: conn.discovery, grantedScopes: conn.grantedScopes };
      },
      availability,
      limits: CALENDAR_LIMITS,
      permission,
      policyDeadlines: [Date.parse('2099-01-01T00:00:00.000Z')],
      now: clock,
      diagnostic: diagnostics?.emit,
    });
    const execution: CalendarExecutionPort & CalendarExecutionPortV2 = {
      async invoke(input: any) {
        const result = await tools.invoke(input);
        if (input.call.name === 'calendar_create_event') {
          effects.push({ kind: 'create', eventId: input.binding.operation?.googleEventId ?? null, calendarId: input.binding.target?.calendarId });
        } else if (input.call.name === 'calendar_get_event') {
          effects.push({ kind: 'get', eventId: input.call.arguments.eventId, calendarId: input.binding.target?.calendarId });
        } else if (input.call.name === 'calendar_list_events') {
          effects.push({ kind: 'list', eventId: null, calendarId: input.binding.target?.calendarId });
        }
        return result as any;
      },
      async readback(input: any) {
        effects.push({ kind: 'readback', eventId: input.operation.googleEventId, calendarId: input.operation.calendarId });
        return tools.readback(input);
      },
      close: () => tools.close(),
    };

    return {
      ...dependencies,
      ...(memoryFirst ? { memoryFirst } : {}),
      calendar: {
        connection: gate,
        capabilities: gate,
        execution,
        createModelPort: createCalendarModelPortV2,
        trustedTimeZone: 'Etc/UTC',
        permission,
      },
    };
  }, persistenceOverride);

  // Spy on CalendarTurnLedger.prototype.chargeCalendarRequest to record requestKinds
  vi.spyOn(CalendarTurnLedger.prototype, 'chargeCalendarRequest').mockImplementation(async function(this: CalendarTurnLedger, kind: CalendarRequestKindV2) {
    requestKinds.push(kind);
    return chargeCalendarRequest.call(this, kind);
  });

  const fixture: CalendarRuntimeFixture = {
    calendarMemory: mem,
    get runtime() { return h.runtime; },
    currentConfig: h.currentConfig,
    publish: snapshot => h.publish(snapshot),
    identity: h.identity,
    p: h.p,
    saver: h.saver,
    fetcher: h.fetcher,
    submit: (content, sessionId) => h.submit(content, sessionId),
    restart: () => h.restart(),
    dispose: () => h.dispose(),
    modelWires,
    modelBodies,
    effects,
    order,
    frames,
    setBinding(next) {
      if (!next) policyAvailable = false;
    },
    setPolicyAvailable(available) { policyAvailable = available; },
    failOnce(point, afterCommit = false, skip = 0) { injector.failOnce(point, afterCommit, skip); },
    failOperationEvent(state: string) { failEventState = state; },
    async execute(ids, signal) {
      const execute = () => h.runtime.executeTurn({
        userId: h.identity.userId,
        sessionId: ids.sessionId,
        turnId: ids.turnId,
        attemptId: ids.attemptId,
        signal: signal ?? new AbortController().signal,
        emit: async () => {},
        emitCalendar: async event => {
          frames.push(event);
          if (event.event.type === 'calendar-progress') onPhase?.(event.event.phase);
        },
      });
      if (diagnostics) await diagnostics.run({ sessionId: ids.sessionId, turnId: ids.turnId,
        attemptId: ids.attemptId }, execute);
      else await execute();
    },

    clock,
    advance,
    async setDiscovery(options) {
      let entries = defaultEntries;
      if (options?.entries) {
        entries = options.entries;
      } else if (options?.duplicateWorkNames) {
        entries = [
          defaultEntries[0],
          defaultEntries[1],
          {
            calendarId: 'work-secondary@example.test', label: 'Work', primary: false,
            accessRole: 'writer', privateAccess: true, timeZone: 'Etc/UTC',
            selected: true, hidden: false, deleted: false,
            capabilities: { readEvents: true, createEvents: true, availability: true },
          },
          defaultEntries[2],
        ];
      }
      const current = await h.p.calendarConnectionsV2.get('aurvin-dev-user');
      if (!current) throw new Error('missing connection');
      const res = await h.p.calendarConnectionsV2.compareAndSwap({
        userId: 'aurvin-dev-user',
        expectedRevision: current.revision,
        expectedConnectionRevision: current.connectionRevision,
        expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
        next: {
          ...current,
          revision: current.revision + 1,
          discovery: {
            ...current.discovery,
            discoveryRevision: current.discovery.discoveryRevision + 1,
            entries,
          },
        },
      });
      if (res.outcome !== 'confirmed') throw new Error(`setDiscovery failed: ${res.outcome}`);
    },
    async setDefault(calendarId: string | null) {
      const current = await h.p.calendarConnectionsV2.get('aurvin-dev-user');
      if (!current) throw new Error('missing connection');
      const res = await h.p.calendarConnectionsV2.compareAndSwap({
        userId: 'aurvin-dev-user',
        expectedRevision: current.revision,
        expectedConnectionRevision: current.connectionRevision,
        expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
        next: {
          ...current,
          revision: current.revision + 1,
          defaultSetting: {
            defaultCalendarId: calendarId,
            defaultSettingRevision: current.defaultSetting.defaultSettingRevision + 1,
          },
        },
      });
      if (res.outcome !== 'confirmed') throw new Error(`setDefault failed: ${res.outcome}`);
    },
    setAvailability(options) {
      availabilityConfig = options;
    },
    clearAvailability() {
      availabilityConfig = { busy: [] };
    },
    async setRole(calendarId: string, role: CalendarAccessRole) {
      const current = await h.p.calendarConnectionsV2.get('aurvin-dev-user');
      if (!current) throw new Error('missing connection');
      const entries = current.discovery.entries.map(e => {
        if (e.calendarId !== calendarId) return e;
        const capabilities = effectiveCalendarCapabilities(role, CALENDAR_SCOPES, true);
        return { ...e, accessRole: role, privateAccess: role === 'owner' || role === 'writer', capabilities };
      });
      const res = await h.p.calendarConnectionsV2.compareAndSwap({
        userId: 'aurvin-dev-user',
        expectedRevision: current.revision,
        expectedConnectionRevision: current.connectionRevision,
        expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
        next: {
          ...current,
          revision: current.revision + 1,
          discovery: {
            ...current.discovery,
            discoveryRevision: current.discovery.discoveryRevision + 1,
            entries,
          },
        },
      });
      if (res.outcome !== 'confirmed') throw new Error(`setDiscovery failed: ${res.outcome}`);
    },
    async replaceAccount(accountEmail = 'new-account@example.test') {
      const current = await h.p.calendarConnectionsV2.get('aurvin-dev-user');
      if (!current) throw new Error('missing connection');
      const next = makeConnectionRecord('aurvin-dev-user', defaultEntries, accountEmail);
      // A replaced connection is a different subject with different
      // credentials, no default calendar and no discovery.
      const replacementSecret = { version: 1 as const, iv: 'fixture-iv-2', tag: 'fixture-tag-2', ciphertext: 'fixture-cipher-2' };
      const result = await h.p.calendarConnectionsV2.compareAndSwap({
        userId: 'aurvin-dev-user',
        expectedRevision: current.revision,
        expectedConnectionRevision: current.connectionRevision,
        expectedDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
        next: {
          ...next,
          revision: current.revision + 1,
          connectionId: 'conn-replacement',
          connectionRevision: current.connectionRevision + 1,
          credentialVersion: current.credentialVersion + 1,
          credentials: { access: replacementSecret, refresh: replacementSecret },
          defaultSetting: {
            defaultCalendarId: null,
            defaultSettingRevision: current.defaultSetting.defaultSettingRevision + 1,
          },
          discovery: null,
          status: 'reconnect-required',
        },
      });
      if (result.outcome !== 'confirmed') throw new Error(`replaceAccount failed: ${result.outcome}`);
    },
    async currentProposal(sessionId: string) {
      return h.p.calendarProposals.getCurrent('aurvin-dev-user', sessionId);
    },
    async operationFor(ids: SubmitTurnResponse) {
      const op = await h.p.calendarOperationsV2.getByTurn('aurvin-dev-user', ids.sessionId, ids.turnId);
      return (op?.schemaVersion === 2 ? op : null) as CalendarOperationV2 | null;
    },
    requestKinds,
    async reply(proposal: CalendarProposalRecord, text: string, sessionId?: string | null) {
      return h.submit(text, sessionId ?? proposal.sessionId);
    },
    async calendarGraphState(sessionId: string) {
      // The graph thread identity is derived, and this LangGraph version keeps
      // the channel values in `channel_values`.
      const saver = persistenceOverride
        ? (await h.p.checkpoints.create()).bind({
            userId: 'aurvin-dev-user',
            sessionId,
            ownerId: h.p.owner.executorId,
            generation: 0,
            leaseExpiresAt: new Date(clock() + 60000).toISOString(),
          })
        : h.saver;
      const tuple = await saver.getTuple({
        configurable: { thread_id: graphThreadId('aurvin-dev-user', sessionId), checkpoint_ns: '' },
      });
      const checkpoint = tuple?.checkpoint;
      const values = (checkpoint as { channel_values?: Record<string, unknown> } | undefined)?.channel_values
        ?? (checkpoint as { values?: Record<string, unknown> } | undefined)?.values
        ?? {};
      return { ...checkpoint, values };
    },
    async proposalAuthority(proposal: CalendarProposalRecord) {
      const current = await h.p.calendarProposals.getCurrent(proposal.userId, proposal.sessionId);
      if (current) return { state: 'pending', proposal: current };
      const rawStore = mem?.store ?? h.p.owner.store;
      const raw = await rawStore?.raw('metadata', {
        userId: proposal.userId, sessionId: proposal.sessionId, proposalId: proposal.proposalId,
      });
      if (raw?.kind === 'calendar-proposal-tombstone') {
        return { state: 'tombstone', tombstone: raw };
      }
      if (raw?.kind === 'calendar-proposal') {
        if (raw.state === 'consumed') return { state: 'consumed', proposal: raw };
        if (raw.state === 'expired' || Date.parse(raw.expiresAt) <= clock()) return { state: 'tombstone' };
      }
      return { state: 'absent' };
    },
    async restartStoppedExecutor() {
      await h.restart();
    },
    ready,
  };

  Object.defineProperty(fixture, 'onPhase', {
    get: () => onPhase,
    set: value => { onPhase = value; },
    enumerable: true,
  });

  return fixture;
}
