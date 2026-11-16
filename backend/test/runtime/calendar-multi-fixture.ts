/**
 * ============================================================================
 * FILE: calendar-multi-fixture.ts
 * LOCATION: backend/test/runtime/calendar-multi-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide reusable v2 calendar fixture factories and test controls.
 *
 * ROLE IN PROJECT:
 *    Supplies parsed event, target, availability, and accepted message records
 *    for unit and runtime tests across Phase 2, and the Calendar fixture
 *    composition over the real native MongoDB bundle.
 *
 * KEY COMPONENTS:
 *    - event / target / availability / busy: Validated v2 data builders.
 *    - accepted: Validated accepted MessageRecord and AttemptRecord pair.
 *    - nativeCalendarFixture: The v2 Calendar runtime over the native bundle.
 * ============================================================================
 */

import type { SubmitTurnResponse } from '../../src/contracts/api.js';
import type { ResolvedIdentity } from '../../src/contracts/identity.js';
import { calendarInputSchemas, type CalendarCreateInput } from '../../src/contracts/calendar-tools.js';
import {
  calendarAccountBindingSchema,
  calendarConnectionV2Schema,
  calendarResolvedTargetSchema,
  effectiveCalendarCapabilities,
  type CalendarAccountBinding,
  type CalendarConnectionRecordV2,
  type CalendarDiscoveryEntry,
  type CalendarResolvedTarget,
} from '../../src/contracts/calendar-discovery.js';
import {
  type CalendarAccountCredentialPort,
  type CalendarConnectionBinding,
} from '../../src/contracts/calendar-connections.js';
import {
  calendarAvailabilityResultSchema,
  type CalendarAvailabilityResult,
} from '../../src/contracts/calendar-availability.js';
import {
  CALENDAR_LIMITS,
  CALENDAR_PROOF_REVISION,
  CALENDAR_SCOPES,
} from '../../src/contracts/calendar-policy.js';
import {
  type CalendarCapabilityGate,
  type CalendarProposalAuthorityLookup,
  type CalendarProposalRecord,
} from '../../src/contracts/calendar-authority.js';
import {
  type CalendarBudgetDebitOutcome,
  type CalendarBudgetDebitRequest,
  type CalendarTurnBudget,
} from '../../src/contracts/calendar-accounting.js';
import {
  type CalendarExecutionPortV2,
  type CalendarOperationV2,
} from '../../src/contracts/calendar-operations.js';
import type { CalendarCompatibleEnvelope } from '../../src/chat-runtime/ports.js';
import { messageRecordSchema, type MessageRecord } from '../../src/contracts/message.js';
import type { AttemptRecord } from '../../src/contracts/attempt.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import type { RuntimeDependencies } from '../../src/chat-runtime/ports.js';
import { createCalendarModelPortV2 } from '../../src/model/calendar-adapter.js';
import { CalendarApi } from '../../src/plugins/google-calendar/calendar-api.js';
import { CalendarAvailabilityApi } from '../../src/plugins/google-calendar/calendar-availability-api.js';
import { CalendarApiTools } from '../../src/plugins/google-calendar/tools.js';
import { toolFault } from '../../src/plugins/google-calendar/tools-validation.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { fixturePricing } from '../model/calendar-fixtures.js';
import { googleJson } from '../plugins/google-calendar/tools-fixtures.js';
import { createWire, skillWire } from './calendar-runtime.fixture.js';
import { nativeHarness } from './native-harness.js';

/**
 * The controls a disclosure needs. The in-memory runtime fixture and the native
 * database fixture both satisfy it, so one disclosure helper serves both.
 */
export type CalendarDisclosureFixture = {
  submit(content?: string, sessionId?: string | null): Promise<SubmitTurnResponse>;
  modelWires: string[];
  execute(ids: SubmitTurnResponse, signal?: AbortSignal): Promise<void>;
  currentProposal(sessionId: string): Promise<CalendarProposalRecord | null>;
};

let disclosureSequence = 0;

export async function disclose(h: CalendarDisclosureFixture, content: string, action: CalendarCreateInput) {
  const ids = await h.submit(content);
  disclosureSequence += 1;
  h.modelWires.push(
    skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_create_event'] },
      `load-create-${disclosureSequence}`),
    createWire(action, 'create-one'));
  await h.execute(ids);
  const proposal = await h.currentProposal(ids.sessionId);
  if (!proposal) throw new Error('Expected non-null proposal after disclosure');
  return { ids, proposal };
}

export function event(overrides: Partial<CalendarCreateInput> = {}): CalendarCreateInput {

  return calendarInputSchemas.calendar_create_event.parse({
    summary: 'Planning',
    start: '2026-11-03T10:00:00+00:00',
    end: '2026-11-03T11:00:00+00:00',
    timeZone: 'Etc/UTC',
    ...overrides,
  });
}

export function target(
  role: 'owner' | 'writer' | 'writerWithoutPrivateAccess' | 'reader' | 'freeBusyReader' = 'writer',
  calendarId = 'team@example.test',
  label = 'Work',
  now = '2026-10-24T10:00:00.000Z',
): CalendarResolvedTarget {
  return calendarResolvedTargetSchema.parse({
    userId: 'aurvin-dev-user',
    connectionId: 'conn-aurvin-dev',
    connectionRevision: 1,
    googleSubjectId: 'google-sub-aurvin',
    calendarId,
    calendarLabel: label,
    targetRevision: 1,
    discoveryRevision: 1,
    selectedBy: 'explicit',
    accessRole: role,
    privateAccess: role === 'owner' || role === 'writer',
    capabilities: effectiveCalendarCapabilities(role, CALENDAR_SCOPES, true),
    verifiedAt: now,
    proofRevision: 'google-calendar.multi.v2',
  });
}

export function accepted(content: string, overrides: Partial<MessageRecord> = {}) {
  const userId = overrides.userId ?? 'aurvin-dev-user';
  const sessionId = overrides.sessionId ?? 'session-1';
  const turnId = overrides.turnId ?? 'turn-1';
  const messageId = overrides.messageId ?? 'msg-user-1';
  const attemptId = 'att-1';
  const now = '2026-10-24T10:00:00.000Z';
  const message: MessageRecord = messageRecordSchema.parse({
    schemaVersion: 1,
    userId,
    sessionId,
    turnId,
    messageId,
    eventId: 'event-1',
    sequence: 1,
    role: 'user',
    content,
    createdAt: now,
    completionStatus: 'accepted',
    attemptId: null,
    truncated: false,
    visibility: 'visible',
    ...overrides,
  });
  const attempt: AttemptRecord = {
    schemaVersion: 1,
    kind: 'attempt',
    userId,
    sessionId,
    turnId,
    attemptId,
    idempotencyKey: 'idemp-key-1',
    payloadHash: 'a'.repeat(64),
    sequence: 1,
    status: 'accepted',
    createdAt: now,
    updatedAt: now,
    instructionVersion: 'inst-1',
    knowledgeContentHash: 'know-1',
    graphSchemaVersion: 'graph-1',
    contextVersion: 1,
    modelId: 'fixture/model',
    openRouterUser: userId,
    generationId: null,
    truncated: false,
    errorCode: null,
    causal: {
      userMessageId: messageId,
      previousAttemptId: null,
    },
  };
  return { message, attempt };
}

export function busy(start: string, end: string) {
  return { start, end };
}

export function availability(overrides: Partial<CalendarAvailabilityResult> = {}): CalendarAvailabilityResult {
  const at = '2026-10-24T10:00:00.000Z';
  const until = '2026-10-24T10:05:00.000Z';
  const busy = overrides.busy ?? [];
  // The free partition and the conflict state follow the busy intervals, so a
  // caller only states the busy time it cares about.
  const low = Date.parse('2026-11-03T10:00:00Z');
  const high = Date.parse('2026-11-03T11:00:00Z');
  const free: { start: string; end: string }[] = [];
  let cursor = low;
  for (const interval of [...busy].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const start = Math.max(cursor, Date.parse(interval.start));
    if (start > cursor) free.push({ start: new Date(cursor).toISOString(), end: new Date(start).toISOString() });
    cursor = Math.max(cursor, Date.parse(interval.end));
  }
  if (cursor < high) free.push({ start: new Date(cursor).toISOString(), end: new Date(high).toISOString() });
  return calendarAvailabilityResultSchema.parse({
    schemaVersion: 2,
    tool: 'calendar_check_availability',
    connectionId: 'conn-aurvin-dev',
    connectionRevision: 1,
    discoveryRevision: 1,
    availabilityRevision: 1,
    calendarSetHash: 'a'.repeat(64),
    timeMin: '2026-11-03T10:00:00Z',
    timeMax: '2026-11-03T11:00:00Z',
    timeZone: 'Etc/UTC',
    checkedAt: at,
    expiresAt: until,
    semantics: 'google-opaque-busy-only',
    calendars: [
      { calendarId: 'personal@example.test', calendarLabel: 'Personal', status: 'ok', reason: null },
      { calendarId: 'team@example.test', calendarLabel: 'Work', status: 'ok', reason: null },
      { calendarId: 'read@example.test', calendarLabel: 'Reading', status: 'ok', reason: null },
    ],
    busy,
    free,
    coverage: 'complete',
    conflict: busy.length > 0 ? 'conflict' : 'clear',
    truncated: false,
    limitations: [],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Native (real MongoDB) Calendar fixture
// ---------------------------------------------------------------------------

/**
 * The persistence points the native fixture can fail on demand.
 */
export type NativeFailPoint =
  | 'operation-reserve' | 'operation-dispatch' | 'receipt-save'
  | 'create-debit' | 'logical-debit';

export type NativeCalendarEffect = {
  kind: 'create' | 'readback' | 'get' | 'list';
  eventId: string | null;
  calendarId?: string;
};

/**
 * The Calendar controls a native recovery test needs. Every provider call is
 * deterministic and local; the database is the real one the harness generated.
 */
export type NativeCalendarFixture = {
  readonly runtime: DurableChatRuntime;
  readonly identity: ResolvedIdentity;
  readonly effects: NativeCalendarEffect[];
  readonly modelWires: string[];
  readonly frames: CalendarCompatibleEnvelope[];
  /** Every durable debit the runtime requested, in order. */
  readonly debits: readonly CalendarBudgetDebitRequest[];
  submit(content?: string, sessionId?: string | null): Promise<SubmitTurnResponse>;
  execute(ids: SubmitTurnResponse, signal?: AbortSignal): Promise<void>;
  reply(proposal: CalendarProposalRecord, text: string, sessionId?: string | null): Promise<SubmitTurnResponse>;
  currentProposal(sessionId: string): Promise<CalendarProposalRecord | null>;
  proposalAuthority(proposal: CalendarProposalRecord): Promise<CalendarProposalAuthorityLookup>;
  operationFor(ids: SubmitTurnResponse): Promise<CalendarOperationV2 | null>;
  budgetFor(ids: SubmitTurnResponse): Promise<CalendarTurnBudget | null>;
  setAvailability(options: { busy?: { start: string; end: string }[]; calendarErrors?: Record<string, string> }): void;
  setDefault(calendarId: string | null): Promise<void>;
  failOnce(point: NativeFailPoint, afterCommit?: boolean): void;
  /** Replay one durable debit identity against the native store, bypassing the fault injector. */
  replayDebit(request: CalendarBudgetDebitRequest): Promise<CalendarBudgetDebitOutcome>;
  restartStoppedExecutor(): Promise<void>;
  dispose(): Promise<void>;
};

const nativeDefaultEntries: CalendarDiscoveryEntry[] = [
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

/**
 * One-shot persistence failures for the native fixture.
 */
class NativeFailureInjector {
  private pending = new Map<NativeFailPoint, { afterCommit: boolean }>();
  failOnce(point: NativeFailPoint, afterCommit = false) {
    this.pending.set(point, { afterCommit });
  }
  async intercept<T>(point: NativeFailPoint, action: () => Promise<T>): Promise<T> {
    const spec = this.pending.get(point);
    if (!spec) return action();
    this.pending.delete(point);
    if (!spec.afterCommit) {
      throw new AppError('PERSISTENCE_ERROR', 'Injected persistence failure.', false);
    }
    await action();
    throw new AppError('PERSISTENCE_ERROR', 'Injected persistence failure.', false);
  }
}

/**
 * Compose the v2 Calendar runtime over the real native persistence bundle.
 *
 * The dependency composition is the same as the in-memory runtime fixture, but
 * every record is written to and read from the generated native database, and
 * the provider is a deterministic local double instead of the live Google API.
 */
export async function nativeCalendarFixture(): Promise<NativeCalendarFixture> {
  const harness = await nativeHarness();
  const persistence = harness.persistence;
  const connections = persistence.calendarConnectionsV2;
  const operations = persistence.calendarOperationsV2;
  const identity = harness.identity;
  const userId = identity.userId;

  const modelWires: string[] = [];
  const effects: NativeCalendarEffect[] = [];
  const frames: CalendarCompatibleEnvelope[] = [];
  const debits: CalendarBudgetDebitRequest[] = [];
  const savedEvents = new Map<string, Record<string, unknown>>();
  const injector = new NativeFailureInjector();
  let modelIndex = 0;
  let availabilityConfig: {
    busy?: { start: string; end: string }[];
    calendarErrors?: Record<string, string>;
  } = { busy: [] };

  const permission = {
    content: 'retained' as const, minimalEvidenceAllowed: true, policyId: 'fixture-policy',
  };

  const secretEnvelope = { version: 1 as const, iv: 'fixture-iv', tag: 'fixture-tag', ciphertext: 'fixture-cipher' };
  const nowIso = () => new Date(Date.now()).toISOString();
  await connections.create(calendarConnectionV2Schema.parse({
    schemaVersion: 2,
    userId,
    provider: 'google-calendar',
    connectionId: 'conn-aurvin-dev',
    revision: 1,
    connectionRevision: 1,
    credentialVersion: 1,
    googleSubjectId: 'google-sub-aurvin',
    accountEmail: 'personal@example.test',
    enabled: true,
    status: 'connected',
    credentials: { access: secretEnvelope, refresh: secretEnvelope },
    tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    grantedScopes: [...CALENDAR_SCOPES],
    updatedAt: nowIso(),
    defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 1 },
    discovery: {
      schemaVersion: 2,
      connectionId: 'conn-aurvin-dev',
      connectionRevision: 1,
      discoveryRevision: 1,
      entries: nativeDefaultEntries,
      fetchedAt: nowIso(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      retentionExpiresAt: new Date(Date.now() + 300000).toISOString(),
      complete: true,
      truncated: false,
      nextPageToken: null,
      limitations: [],
      retentionPolicyId: 'fixture-policy',
    },
  }));

  const requireAccountCurrent = async (
    account: CalendarAccountBinding,
    signal: AbortSignal,
  ): Promise<CalendarConnectionRecordV2> => {
    if (signal.aborted) throw toolFault('cancelled', 'CALENDAR_CANCELLED');
    const raw = await connections.get(account.userId);
    if (!raw) throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
    const conn = calendarConnectionV2Schema.parse(raw);
    if (conn.userId !== account.userId || conn.connectionId !== account.connectionId
      || conn.connectionRevision !== account.connectionRevision
      || conn.googleSubjectId !== account.googleSubjectId) {
      throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    }
    return conn;
  };

  const gate: CalendarCapabilityGate & {
    currentAccount(): Promise<CalendarAccountBinding>;
    requireAccountCurrent(account: CalendarAccountBinding, signal: AbortSignal): Promise<CalendarConnectionRecordV2>;
    currentBinding(): Promise<CalendarConnectionBinding>;
    credentials: CalendarAccountCredentialPort;
  } = {
    async currentAccount() {
      const raw = await connections.get(userId);
      if (!raw) throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
      const conn = calendarConnectionV2Schema.parse(raw);
      if (conn.status === 'disconnected') throw toolFault('credential', 'CALENDAR_RECONNECT_REQUIRED');
      if (!conn.enabled) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      return calendarAccountBindingSchema.parse({
        userId: conn.userId,
        connectionId: conn.connectionId,
        connectionRevision: conn.connectionRevision,
        googleSubjectId: conn.googleSubjectId,
      });
    },
    requireAccountCurrent,
    async currentBinding() {
      const acct = await this.currentAccount();
      return { ...acct, calendarId: 'primary', targetRevision: 1 };
    },
    credentials: {
      async withAccessToken(input, action) {
        await requireAccountCurrent(input.account, input.signal);
        return action('fixture-access-token');
      },
    },
    resolve: async input => {
      const conn = await requireAccountCurrent(input.account, input.signal);
      const fresh = conn.discovery;
      if (!fresh) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
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
      const conn = await requireAccountCurrent(target, sig);
      const discovery = conn.discovery;
      if (!discovery) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      const entry = discovery.entries.find((e: CalendarDiscoveryEntry) => e.calendarId === target.calendarId);
      if (!entry) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      const caps = effectiveCalendarCapabilities(entry.accessRole, conn.grantedScopes, !entry.hidden && !entry.deleted);
      const opKey = input.operation === 'read' ? 'readEvents' : input.operation === 'create' ? 'createEvents' : 'availability';
      if (!caps[opKey]) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
    },
  };

  const baseSnapshot = harness.currentConfig.current();
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

  harness.fetcher.mockImplementation(async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes('/chat/completions')) {
      const wire = modelWires.shift();
      if (wire === undefined) throw new Error('Unexpected model request');
      modelIndex += 1;
      const specialized = wire
        .replaceAll('gen_fixture', `gen_cal_${modelIndex}`)
        .replaceAll('call_1', `call_cal_${modelIndex}`);
      return new Response(specialized, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    const parsed = new URL(urlStr);
    if (parsed.origin !== 'https://www.googleapis.com' || !parsed.pathname.startsWith('/calendar/v3/')) {
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    }
    const method = String(init?.method ?? 'GET').toUpperCase();
    const parts = parsed.pathname.slice('/calendar/v3/'.length).split('/');
    if (method === 'POST' && parts[0] === 'freeBusy') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { items?: { id: string }[] };
      const calendars: Record<string, { busy: { start: string; end: string }[];
        errors?: { domain: string; reason: string }[] }> = {};
      for (const item of body.items ?? []) {
        const err = availabilityConfig.calendarErrors?.[item.id];
        calendars[item.id] = err
          ? { busy: [], errors: [{ domain: 'global', reason: err }] }
          : { busy: availabilityConfig.busy ?? [] };
      }
      return googleJson({ kind: 'calendar#freeBusy', calendars });
    }
    if (parts[0] === 'calendars' && parts.length >= 3 && parts[2] === 'events') {
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
        };
        savedEvents.set(eventId, saved);
        return googleJson(saved);
      }
      if (method === 'GET' && parts.length === 4) {
        const eventId = decodeURIComponent(parts[3]);
        const saved = savedEvents.get(eventId);
        if (!saved) throw new Error(`Unknown calendar event ${eventId}`);
        return googleJson({ ...saved, id: eventId });
      }
      if (method === 'GET' && parts.length === 3) {
        return googleJson({ timeZone: 'Etc/UTC', items: [...savedEvents.values()] });
      }
    }
    throw new Error(`Unexpected Calendar request ${method} ${parsed.pathname}`);
  });

  const api = new CalendarApi({ fetcher: harness.fetcher });
  const availabilityApi = new CalendarAvailabilityApi({ fetcher: harness.fetcher });
  const tools = new CalendarApiTools({
    api,
    gate,
    credentials: gate.credentials,
    connections,
    readDiscovery: async input => {
      const raw = await connections.get(input.account.userId);
      if (!raw) throw new AppError('NOT_READY', 'Calendar is not connected.');
      const conn = calendarConnectionV2Schema.parse(raw);
      if (!conn.discovery) throw new AppError('NOT_READY', 'Calendar discovery is unavailable.');
      return { snapshot: conn.discovery, grantedScopes: conn.grantedScopes };
    },
    availability: availabilityApi,
    limits: CALENDAR_LIMITS,
    permission,
    policyDeadlines: [Date.parse('2099-01-01T00:00:00.000Z')],
    now: Date.now,
  });
  const execution: CalendarExecutionPortV2 = {
    async invoke(input: any) {
      const result = await tools.invoke(input);
      if (input.call.name === 'calendar_create_event') {
        effects.push({ kind: 'create', eventId: input.binding.operation?.googleEventId ?? null,
          calendarId: input.binding.target?.calendarId });
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

  const reserveByIntent = operations.reserveByIntent.bind(operations);
  operations.reserveByIntent = input =>
    injector.intercept('operation-reserve', () => reserveByIntent(input));
  const casV2 = operations.compareAndSwap.bind(operations);
  operations.compareAndSwap = async input => {
    const next = input.next;
    const point = next.receipt ? 'receipt-save' : next.state === 'dispatching' ? 'operation-dispatch' : null;
    return point ? injector.intercept(point, () => casV2(input)) : casV2(input);
  };
  // The durable debit is the one charge that must survive a lost
  // acknowledgement, so the native fixture can drop the acknowledgement after
  // the debit itself is committed.
  const accounting = persistence.calendarAccountingV2;
  const debit = accounting.debit.bind(accounting);
  accounting.debit = request => {
    debits.push(request);
    return injector.intercept(
      request.kindOfDebit === 'create' ? 'create-debit' : 'logical-debit',
      () => debit(request));
  };

  const deps: RuntimeDependencies = {
    ...harness.deps,
    limits: snapshot.modelLimits,
    currentConfig: { current: () => snapshot },
    calendar: {
      connection: gate,
      capabilities: gate,
      execution,
      createModelPort: createCalendarModelPortV2,
      trustedTimeZone: 'Etc/UTC',
      permission,
    },
  };
  let runtime = new DurableChatRuntime(deps);
  let requestCounter = 1;

  const fixture: NativeCalendarFixture = {
    get runtime() { return runtime; },
    identity,
    effects,
    modelWires,
    frames,
    debits,
    async submit(content?: string, sessionId?: string | null) {
      const id = String(requestCounter++).padStart(4, '0');
      return runtime.submitTurn({
        identity,
        sessionId: sessionId ?? null,
        content: content ?? 'Hello',
        idempotencyKey: `request-${id}`,
      });
    },
    async execute(ids, signal) {
      await runtime.executeTurn({
        userId: identity.userId,
        sessionId: ids.sessionId,
        turnId: ids.turnId,
        attemptId: ids.attemptId,
        signal: signal ?? new AbortController().signal,
        emit: async () => {},
        emitCalendar: async event => { frames.push(event); },
      });
    },
    async reply(proposal, text, sessionId) {
      return fixture.submit(text, sessionId ?? proposal.sessionId);
    },
    async currentProposal(sessionId) {
      return persistence.calendarProposals.getCurrent(userId, sessionId);
    },
    async proposalAuthority(proposal) {
      return persistence.calendarProposals.getAuthority(userId, proposal.sessionId, proposal.proposalId);
    },
    async operationFor(ids) {
      const op = await operations.getByTurn(userId, ids.sessionId, ids.turnId);
      return (op?.schemaVersion === 2 ? op : null) as CalendarOperationV2 | null;
    },
    async budgetFor(ids) {
      return persistence.calendarAccountingV2.getBudget(userId, ids.sessionId, ids.turnId);
    },
    setAvailability(options) {
      availabilityConfig = options;
    },
    async setDefault(calendarId) {
      const raw = await connections.get(userId);
      if (!raw) throw new Error('missing connection');
      const current = calendarConnectionV2Schema.parse(raw);
      const res = await connections.compareAndSwap({
        userId,
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
    failOnce(point, afterCommit = false) { injector.failOnce(point, afterCommit); },
    async replayDebit(request) {
      // The replay bypasses the fault injector: it proves the durable debit
      // identity itself is what makes the repeat a duplicate.
      return debit(request);
    },
    async restartStoppedExecutor() {
      runtime.stopAccepting();
      await runtime.drain(5000);
      await persistence.owner.drain();
      // The fixture releases its own executor through the ownership API. The
      // sentinel is never deleted by hand and an expired lease never grants a
      // takeover.
      await persistence.owner.releaseExecutor();
      await assertNotExecutor(persistence.owner);
      await persistence.owner.claimExecutor();
      await persistence.owner.assertExecutor();
      runtime = new DurableChatRuntime(deps);
    },
    async dispose() {
      runtime.stopAccepting();
      await runtime.drain(5000);
      await persistence.owner.drain();
      try {
        await persistence.owner.releaseExecutor();
      } catch {
        // The generated database is dropped below; the sentinel does not outlive it.
      }
      await harness.close();
    },
  };

  return fixture;
}

/**
 * Prove that this process no longer owns the database.
 */
async function assertNotExecutor(owner: { assertExecutor(): Promise<void> }): Promise<void> {
  try {
    await owner.assertExecutor();
  } catch {
    return;
  }
  throw new Error('The previous executor still owns the database.');
}
