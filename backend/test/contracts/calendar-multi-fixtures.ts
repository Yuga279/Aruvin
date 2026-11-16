/**
 * ============================================================================
 * FILE: calendar-multi-fixtures.ts
 * LOCATION: backend/test/contracts/calendar-multi-fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Shared inert fixtures for Google Calendar Phase 2 contract tests.
 *
 * ROLE IN PROJECT:
 *    Supplies deterministic account, entry, snapshot, target, and permission data
 *    used across contract specifications without mocking or network access.
 *
 * KEY COMPONENTS:
 *    - account: Bounded account binding fixture.
 *    - entry: Bounded calendar discovery entry fixture.
 *    - snapshot: Bounded discovery snapshot fixture.
 *    - target: Resolved target fixture.
 *    - action / event / permission: Sample action, event, and source permission data.
 * ============================================================================
 */

export const at = '2026-10-22T10:00:00.000Z';
export const until = '2026-10-22T10:05:00.000Z';
export const hash = 'a'.repeat(64);
export const account = { userId: 'u', connectionId: 'c', connectionRevision: 1,
  googleSubjectId: 'sub' } as const;
export const entry = { calendarId: 'canonical@group.calendar.google.com', label: 'Team',
  primary: true, accessRole: 'writer', privateAccess: true, timeZone: 'Europe/London',
  selected: true, hidden: false, deleted: false,
  capabilities: { readEvents: true, createEvents: true, availability: true } } as const;
export const snapshot = { schemaVersion: 2, discoveryRevision: 1,
  connectionId: 'c', connectionRevision: 1, entries: [entry], fetchedAt: at,
  expiresAt: until, complete: true, truncated: false, nextPageToken: null,
  limitations: [], retentionPolicyId: 'approved-fixture', retentionExpiresAt: until } as const;
export const target = { ...account, calendarId: entry.calendarId, calendarLabel: entry.label,
  targetRevision: 1, discoveryRevision: 1, selectedBy: 'primary',
  accessRole: entry.accessRole, privateAccess: true, capabilities: entry.capabilities,
  verifiedAt: at, proofRevision: 'google-calendar.multi.v2' } as const;
export const action = { calendarId: entry.calendarId, summary: 'Visit',
  start: '2026-10-22T11:00:00+01:00', end: '2026-10-22T12:00:00+01:00',
  timeZone: 'Europe/London' } as const;
export const event = { eventId: 'abcde01234', summary: 'Visit', start: action.start,
  end: action.end, timeZone: action.timeZone, status: 'confirmed', htmlLink: null } as const;
export const permission = { content: 'retained', minimalEvidenceAllowed: true,
  policyId: 'approved-fixture' } as const;

export const proposal = { schemaVersion: 2, kind: 'calendar-proposal', userId: 'u', sessionId: 's',
  proposalId: 'p', revision: 1, originatingTurnId: 'origin-turn', originatingAcceptedMessageId: 'origin-message',
  originatingAttemptId: 'origin-attempt', intentId: 'intent', connectionId: 'c', connectionRevision: 1,
  googleSubjectId: 'sub', target, action, canonicalActionHash: hash, discoveryRevision: 1,
  availabilityRevision: 1, conditionFingerprint: hash, disclosedLimitations: ['calendar-error'],
  candidates: [], purpose: 'conflict', createdAt: at, expiresAt: '2026-10-22T10:10:00.000Z',
  retentionPolicyId: 'approved-fixture', contentExpiresAt: '2026-10-22T10:10:00.000Z',
  state: 'pending', consumedBy: null } as const;

export const sourceV1 = { schemaVersion: 1, sourceId: 'src', plugin: 'google-calendar',
  connectionId: 'c', connectionRevision: 1, operationIds: ['op'], fetchedAt: at,
  expiresAt: until, redactedAt: null, permission } as const;
export const sourceV2 = { ...sourceV1, schemaVersion: 2, toolCallIds: ['call'],
  discoveryRevision: 1, availabilityRevision: null, calendarSetHash: null,
  targets: [{ calendarId: entry.calendarId, calendarLabel: entry.label }] } as const;
export const operationV1 = { schemaVersion: 1, kind: 'calendar-operation', userId: 'u',
  sessionId: 's', turnId: 't', operationId: 'op', originatingAttemptId: 'a', revision: 1,
  sequence: 0, connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub',
  calendarId: entry.calendarId, targetRevision: 1, requestHash: hash,
  googleEventId: 'abcde01234', schemaRevision: 'google-calendar.v1',
  action: { summary: action.summary, start: action.start, end: action.end, timeZone: action.timeZone },
  actionSources: [], authorization: { acceptedUserMessageId: 'm', canonicalActionHash: hash,
    approvedAt: at, basis: 'explicit-request' }, deliveryRetries: 0, createdAt: at,
  updatedAt: at, auditExpiresAt: '2026-11-21T10:00:00.000Z', state: 'planned',
  receipt: null, failure: null } as const;
export const operationV2 = { ...operationV1, schemaVersion: 2, schemaRevision: 'google-calendar.v2',
  intentId: 'intent', originatingTurnId: 'origin-turn', originatingAcceptedMessageId: 'origin-message',
  calendarLabel: entry.label, labelExpiresAt: until, discoveryRevision: 1,
  proofRevision: 'google-calendar.multi.v2', action,
  actionSources: [sourceV2],
  authorization: { ...operationV1.authorization, acceptedTurnId: 't', proposalId: null,
    conditionFingerprint: null, basis: 'explicit-request' } } as const;
export const receiptV1 = { operationId: 'op', googleEventId: 'abcde01234', connectionId: 'c',
  connectionRevision: 1, targetRevision: 1, calendarIdHash: hash, requestHash: hash,
  verifiedAt: at, source: sourceV1, htmlLink: null } as const;

export const availability = { schemaVersion: 2, tool: 'calendar_check_availability',
  connectionId: 'c', connectionRevision: 1, discoveryRevision: 1, availabilityRevision: 1,
  calendarSetHash: hash, timeMin: at, timeMax: until, timeZone: 'Europe/London', checkedAt: at,
  expiresAt: until, semantics: 'google-opaque-busy-only', calendars: [{ calendarId: entry.calendarId,
    calendarLabel: entry.label, status: 'ok', reason: null }], busy: [],
  free: [{ start: at, end: until }], coverage: 'complete', conflict: 'clear', truncated: false,
  limitations: [] } as const;
export const calendarPage = { schemaVersion: 2, tool: 'calendar_list_calendars', calendars: [entry],
  discoveryRevision: 1, fetchedAt: at, expiresAt: until, complete: true, truncated: false,
  limitations: [], nextPageToken: null } as const;
