/**
 * ============================================================================
 * FILE: tools-multi-fixtures.ts
 * LOCATION: backend/test/plugins/google-calendar/tools-multi-fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide multi-calendar test fixtures, resolved targets, operations, and bindings.
 *
 * ROLE IN PROJECT:
 *    Shared test helpers for v2 multi-calendar tool validation, executor, and MCP tests.
 *
 * KEY COMPONENTS:
 *    - multiTarget: Construct validated CalendarResolvedTarget fixture
 *    - multiOperation: Construct validated CalendarOperationV2 fixture
 *    - multiBinding: Construct validated CalendarExecutionBindingV2 fixture
 *    - multiToolsFixture: Complete v2 test harness with mock gates and services
 * ============================================================================
 */

import { z } from 'zod';
import type { CalendarCapabilityGate } from '../../../src/contracts/calendar-authority.js';
import type { CalendarAccountCredentialPort } from '../../../src/contracts/calendar-connections.js';
import {
  calendarConnectionV2Schema, calendarDiscoverySnapshotSchema,
  calendarResolvedTargetSchema, effectiveCalendarCapabilities,
  type CalendarAccountBinding,
} from '../../../src/contracts/calendar-discovery.js';
import type { CalendarAvailabilityPort } from '../../../src/contracts/calendar-availability.js';
import {
  calendarExecutionBindingV2Schema, operationRecordV2Schema,
  type CalendarOperationV2, type CalendarRequestKindV2,
} from '../../../src/contracts/calendar-operations.js';
import { CALENDAR_LIMITS, CALENDAR_SCOPES, type CalendarLimits } from '../../../src/contracts/calendar-policy.js';
import { sourcePermissionSchema } from '../../../src/contracts/calendar-sources.js';
import type { CalendarCall } from '../../../src/contracts/calendar-tools.js';
import { CalendarApi } from '../../../src/plugins/google-calendar/calendar-api.js';
import { CalendarAvailabilityApi } from '../../../src/plugins/google-calendar/calendar-availability-api.js';
import { CalendarApiTools } from '../../../src/plugins/google-calendar/tools.js';
import { calendarActionHash, calendarEventId, toolFault }
  from '../../../src/plugins/google-calendar/tools-validation.js';
import { fakeFetch, googleJson, googleEvent, type FakeStep, CREATE_ACTION } from './tools-fixtures.js';

export function multiTarget(role: 'owner' | 'writer' | 'writerWithoutPrivateAccess' | 'reader'
  | 'freeBusyReader' = 'writer', calendarId = 'shared', now = new Date().toISOString()) {
  return calendarResolvedTargetSchema.parse({ userId: 'u', connectionId: 'c', connectionRevision: 1,
    googleSubjectId: 'sub', calendarId, calendarLabel: `Calendar ${calendarId}`,
    targetRevision: 1, discoveryRevision: 1, selectedBy: 'explicit', accessRole: role,
    privateAccess: role === 'owner' || role === 'writer',
    capabilities: effectiveCalendarCapabilities(role, CALENDAR_SCOPES, true),
    verifiedAt: now, proofRevision: 'google-calendar.multi.v2' });
}

export function multiOperation(target = multiTarget(), overrides: Record<string, unknown> = {}) {
  const action = { ...CREATE_ACTION, calendarId: target.calendarId };
  const hash = calendarActionHash(action);
  return operationRecordV2Schema.parse({ schemaVersion: 2, kind: 'calendar-operation',
    userId: 'u', sessionId: 's', turnId: 't', operationId: 'op_1', originatingAttemptId: 'a_1',
    revision: 1, sequence: 1, intentId: 'intent_1', originatingTurnId: 't',
    originatingAcceptedMessageId: 'm_1', connectionId: 'c', connectionRevision: 1,
    googleSubjectId: 'sub', calendarId: target.calendarId, targetRevision: target.targetRevision,
    calendarLabel: null, labelExpiresAt: null, discoveryRevision: target.discoveryRevision,
    proofRevision: 'google-calendar.multi.v2', schemaRevision: 'google-calendar.v2',
    requestHash: hash, googleEventId: calendarEventId('op_1'), action, actionSources: [],
    authorization: { acceptedUserMessageId: 'm_1', acceptedTurnId: 't', canonicalActionHash: hash,
      approvedAt: target.verifiedAt, basis: 'explicit-request', proposalId: null, conditionFingerprint: null },
    deliveryRetries: 0, createdAt: target.verifiedAt, updatedAt: target.verifiedAt,
    auditExpiresAt: new Date(Date.parse(target.verifiedAt) + 86400000).toISOString(),
    state: 'dispatching', receipt: null, failure: null, ...overrides });
}

export function multiBinding(target = multiTarget(), operation: ReturnType<typeof multiOperation> | null = null) {
  return calendarExecutionBindingV2Schema.parse({ userId: 'u', connectionId: 'c', connectionRevision: 1,
    googleSubjectId: 'sub', target, sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd',
    toolCallId: 'tc', schemaRevision: 'google-calendar.v2', operation,
    trustedNow: target.verifiedAt, trustedTimeZone: 'Etc/UTC',
    deadlineAt: new Date(Date.now() + 10000).toISOString() });
}

export function multiContext(target = multiTarget()) {
  return { binding: multiBinding(target), target, accessToken: 'fixture-access-token',
    signal: new AbortController().signal, deadlineAt: new Date(Date.now() + 10000).toISOString(),
    consumeRequest: async (_kind: import('../../../src/contracts/calendar-operations.js').CalendarRequestKindV2) => {} };
}

type MultiOptions = {
  diagnostic?: import('../../../src/chat-runtime/ports.js').DiagnosticSink;
  target?: ReturnType<typeof multiTarget>; operation?: CalendarOperationV2 | null;
  calendarCount?: number; steps?: FakeStep[]; call?: CalendarCall;
  availability?: CalendarAvailabilityPort; limits?: CalendarLimits;
  permission?: z.infer<typeof sourcePermissionSchema>; policyDeadlines?: readonly number[];
  headers?: Record<string, string>;
};

export function multiToolsFixture(options: MultiOptions = {}) {
  const target = options.target ?? multiTarget();
  const at = target.verifiedAt;
  const until = new Date(Date.parse(at) + 300000).toISOString();
  const snapshot = calendarDiscoverySnapshotSchema.parse({ schemaVersion: 2,
    connectionId: 'c', connectionRevision: 1, discoveryRevision: 1,
    entries: Array.from({ length: options.calendarCount ?? 1 }, (_, i) => ({
      calendarId: i === 0 ? target.calendarId : `cal-${i}`,
      label: i === 0 ? target.calendarLabel : `Calendar ${i}`, primary: i === 0,
      accessRole: target.accessRole, privateAccess: target.privateAccess,
      timeZone: 'Etc/UTC', selected: true, hidden: false, deleted: false,
      capabilities: target.capabilities })), fetchedAt: at, expiresAt: until,
    complete: true, truncated: false, nextPageToken: null, limitations: [],
    retentionPolicyId: 'fixture-policy', retentionExpiresAt: until });
  const secret = { version: 1, iv: 'fixture-iv', tag: 'fixture-tag', ciphertext: 'fixture-cipher' };
  const record = calendarConnectionV2Schema.parse({ schemaVersion: 2, userId: 'u',
    provider: 'google-calendar', connectionId: 'c', revision: 1, connectionRevision: 1,
    credentialVersion: 1, googleSubjectId: 'sub', accountEmail: null,
    enabled: true, status: 'connected', credentials: { access: secret, refresh: secret },
    tokenExpiresAt: until, grantedScopes: [...CALENDAR_SCOPES], updatedAt: at,
    defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 1 }, discovery: snapshot });
  const operation = options.operation === undefined ? multiOperation(target) : options.operation;
  const fake = fakeFetch(options.steps ?? [{ method: 'POST',
    path: `/calendar/v3/calendars/${encodeURIComponent(target.calendarId)}/events`,
    response: () => googleJson({ ...googleEvent(), id: operation?.googleEventId,
      extendedProperties: { private: { aurvinOperationId: operation?.operationId,
        aurvinRequestHash: operation?.requestHash } } }, { headers: options.headers }) }]);
  const counts = { calendar: 0, refresh: 0, credential: 0, capability: 0,
    kinds: [] as CalendarRequestKindV2[] };
  const requireAccount = async (account: CalendarAccountBinding, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!record.enabled || record.status !== 'connected' || account.userId !== record.userId
      || account.connectionId !== record.connectionId || account.connectionRevision !== record.connectionRevision
      || account.googleSubjectId !== record.googleSubjectId) throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
  };
  const denied = (op: 'read' | 'create' | 'availability', entry: (typeof snapshot.entries)[number]) =>
    !entry.capabilities[op === 'read' ? 'readEvents' : op === 'create' ? 'createEvents' : 'availability'];
  const gate: CalendarCapabilityGate & {
    requireAccount: typeof requireAccount; disable(): void; revision(value: number): void;
  } = {
    requireAccount,
    disable() { record.enabled = false; },
    revision(value) { record.connectionRevision = value; },
    resolve: async input => {
      await requireAccount(input.account, input.signal);
      const id = input.selector === null || input.selector === 'primary'
        ? snapshot.entries.find(e => e.primary)?.calendarId : input.selector;
      const entry = snapshot.entries.find(e => e.calendarId === id);
      if (!entry) return { outcome: 'clarify', code: 'CALENDAR_TARGET_UNKNOWN', candidates: [] };
      if (denied(input.operation, entry)) return { outcome: 'denied', code: 'CALENDAR_TARGET_READ_ONLY' };
      return { outcome: 'resolved', target: calendarResolvedTargetSchema.parse({ ...target,
        calendarId: entry.calendarId, calendarLabel: entry.label, accessRole: entry.accessRole,
        privateAccess: entry.privateAccess, capabilities: entry.capabilities }) };
    },
    requireCurrent: async input => {
      counts.capability++;
      await requireAccount(input.target, input.signal);
      const entry = snapshot.entries.find(e => e.calendarId === input.target.calendarId);
      if (!entry || denied(input.operation, entry)) throw toolFault('policy', 'CALENDAR_TARGET_READ_ONLY');
      if (entry.accessRole !== input.target.accessRole || entry.privateAccess !== input.target.privateAccess) {
        throw toolFault('policy', 'CALENDAR_EXECUTION_DENIED');
      }
    },
  };
  const credentials: CalendarAccountCredentialPort = { withAccessToken: async (input, action) => {
    await requireAccount(input.account, input.signal); counts.credential++;
    return action('fixture-access-token');
  } };
  const api = new CalendarApi({ fetcher: fake.fetcher, cursorKey: new Uint8Array(32).fill(1), diagnostic: options.diagnostic });
  const tools = new CalendarApiTools({ api, gate, credentials,
    connections: { get: async () => structuredClone(record) },
    readDiscovery: async input => {
      await requireAccount(input.account, input.signal);
      return { snapshot: structuredClone(snapshot), grantedScopes: [...record.grantedScopes] };
    }, availability: options.availability ?? new CalendarAvailabilityApi({ fetcher: fake.fetcher, diagnostic: options.diagnostic }),
    diagnostic: options.diagnostic,
    limits: options.limits ?? CALENDAR_LIMITS,
    permission: options.permission ?? { content: 'volatile', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
    policyDeadlines: options.policyDeadlines ?? [Date.now() + 10800000], cursorKey: new Uint8Array(32).fill(1) });
  const input = { binding: multiBinding(target, operation),
    call: options.call ?? { name: 'calendar_create_event' as const,
      arguments: { ...CREATE_ACTION, calendarId: target.calendarId } },
    signal: new AbortController().signal,
    consumeRequest: async (kind: CalendarRequestKindV2) => { counts.calendar++; counts.kinds.push(kind); },
    consumeRefreshRequest: async () => { counts.refresh++; } };
  return { tools, api, input, fake, requests: fake.requests, counts, gate, credentials, record, snapshot };
}
