/**
 * ============================================================================
 * FILE: calendar-protocol.ts
 * LOCATION: frontend/src/api/calendar-protocol.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define wire contracts, validation guards, and parsing for Google Calendar plugin.
 *
 * ROLE IN PROJECT:
 *    Shared frontend protocol layer enforcing versioned status, discovery pages,
 *    settings mutations, SSE stream envelopes, and turn operation state boundaries.
 *
 * KEY COMPONENTS:
 *    - CALENDAR_API_ROUTES: Endpoint URLs including status, settings, calendars, and refresh.
 *    - isCalendarPublicStatus: Validates legacy v1 and multi-calendar v2 status payloads.
 *    - isCalendarSettingsRequest: Validates legacy enablement and CAS default mutations.
 *    - isCalendarCalendarsResponse: Validates bounded discovery page responses.
 *    - parseCalendarCompatibleFrame: Validates and parses v1, v2, and v3 SSE frames.
 * ============================================================================
 */

import {
  isStreamEnvelope,
  isStreamEvent,
  type StreamEnvelope,
  type StreamEvent,
} from './protocol.ts';

export const CALENDAR_PROTOCOL_VERSION = 1 as const;
export const CALENDAR_STATUS_PROTOCOL_V2 = 2 as const;
export const CALENDAR_STREAM_PROTOCOL_VERSION = 2 as const;
export const CALENDAR_STREAM_PROTOCOL_V2 = 3 as const;
export const CALENDAR_CSRF_HEADER = 'X-Aurvin-Calendar-CSRF';
export const CALENDAR_CSRF_VALUE = '1';

export const CALENDAR_API_ROUTES = {
  status: '/plugins/google-calendar/status',
  settings: '/plugins/google-calendar/settings',
  oauthStart: '/plugins/google-calendar/oauth/start',
  oauthCallback: '/plugins/google-calendar/oauth/callback',
  disconnect: '/plugins/google-calendar/disconnect',
  calendars: '/plugins/google-calendar/calendars',
  calendarsRefresh: '/plugins/google-calendar/calendars/refresh',
} as const;

export const CALENDAR_CONNECTION_STATES = [
  'disabled',
  'setup-required',
  'connected',
  'reconnect-required',
  'degraded',
] as const;
export type CalendarConnectionState = (typeof CALENDAR_CONNECTION_STATES)[number];

export const CALENDAR_ROLES = [
  'owner',
  'writer',
  'writerWithoutPrivateAccess',
  'reader',
  'freeBusyReader',
] as const;
export type CalendarRole = (typeof CALENDAR_ROLES)[number];

export type CalendarCapabilities = {
  readEvents: boolean;
  createEvents: boolean;
  availability: boolean;
};

export const CALENDAR_DISCOVERY_LIMITATIONS = [
  'page-limit',
  'calendar-limit',
  'byte-limit',
  'provider-error',
  'unsupported-entry',
  'primary-missing',
  'stale',
] as const;
export type CalendarDiscoveryLimitation = (typeof CALENDAR_DISCOVERY_LIMITATIONS)[number];

export type CalendarDiscoveryEntry = {
  calendarId: string;
  label: string;
  primary: boolean;
  accessRole: CalendarRole;
  privateAccess: boolean;
  timeZone: string | null;
  selected: boolean;
  hidden: boolean;
  deleted: boolean;
  capabilities: CalendarCapabilities;
};

export type CalendarCalendarPage = {
  schemaVersion: 2;
  tool: 'calendar_list_calendars';
  calendars: CalendarDiscoveryEntry[];
  discoveryRevision: number;
  fetchedAt: string;
  expiresAt: string;
  complete: boolean;
  truncated: boolean;
  nextPageToken: string | null;
  limitations: CalendarDiscoveryLimitation[];
};

export type CalendarCalendarsResponse = {
  protocolVersion: 2;
  page: CalendarCalendarPage;
};

export const CALENDAR_OPERATION_STATES = [
  'planned',
  'dispatching',
  'succeeded',
  'definitely-failed',
  'unknown',
  'evidence-expired',
] as const;

export const CALENDAR_OPERATION_STATES_V2 = [
  'planned',
  'dispatching',
  'succeeded',
  'definitely-failed',
  'unknown',
  'evidence-expired',
  'failed',
  'cancelled',
] as const;
export type CalendarOperationState = (typeof CALENDAR_OPERATION_STATES_V2)[number];

export const CALENDAR_NARRATION_STATUSES = [
  'pending',
  'completed',
  'failed',
  'interrupted',
] as const;
export type CalendarNarrationStatus = (typeof CALENDAR_NARRATION_STATUSES)[number];

export const CALENDAR_RETRY_ACTIONS = [
  'none',
  'resume-reconciliation',
  'reconnect',
  'clarify',
  'blocked-expired',
] as const;
export type CalendarRetryAction = (typeof CALENDAR_RETRY_ACTIONS)[number];

export const CALENDAR_PROGRESS_PHASES = [
  'validating',
  'repairing',
  'executing',
  'reconciling',
] as const;
export type CalendarProgressPhase = (typeof CALENDAR_PROGRESS_PHASES)[number];

export const CALENDAR_REMOTE_REVOCATION_OUTCOMES = [
  'not-requested',
  'confirmed',
  'failed',
  'unknown',
] as const;
export type CalendarRemoteRevocationOutcome = (typeof CALENDAR_REMOTE_REVOCATION_OUTCOMES)[number];

export const CALENDAR_OAUTH_CALLBACK_OUTCOMES = [
  'connected',
  'fixture',
  'cancelled',
  'failed',
] as const;
export type CalendarOAuthCallbackOutcome = (typeof CALENDAR_OAUTH_CALLBACK_OUTCOMES)[number];

export type CalendarProcessingDisclosure = {
  policyId: string;
  processors: 'Google, OpenRouter and the configured model provider';
  dataCollection: 'deny';
};

export type CalendarLegacyPublicStatus = {
  protocolVersion: 1;
  state: CalendarConnectionState;
  enabled: boolean;
  accountEmail: string | null;
  targetCalendarId: string | null;
  processingDisclosure: CalendarProcessingDisclosure | null;
};

export type CalendarPublicStatusV2 = {
  protocolVersion: 2;
  state: CalendarConnectionState;
  enabled: boolean;
  accountEmail: string | null;
  processingDisclosure: CalendarProcessingDisclosure | null;
  connectionRevision: number | null;
  defaultSetting: {
    defaultCalendarId: string | null;
    defaultSettingRevision: number;
  } | null;
  primaryCalendarId: string | null;
  discovery: {
    discoveryRevision: number;
    fetchedAt: string;
    expiresAt: string;
    complete: boolean;
    truncated: boolean;
    stale: boolean;
  } | null;
  missingScopes: string[];
};

export type CalendarPublicStatus = CalendarLegacyPublicStatus | CalendarPublicStatusV2;

export type CalendarSettingsRequest = {
  enabled?: boolean;
  defaultSetting?: {
    calendarId: string | null;
    expectedRevision: number;
    expectedConnectionRevision: number;
  };
};

export type CalendarRefreshRequest = {
  expectedConnectionRevision: number;
};

export type CalendarOAuthStartRequest = Record<string, never>;

export type CalendarOAuthStartResponse = {
  authorizationUrl: string;
};

export type CalendarDisconnectRequest =
  | { mode: 'local' }
  | { mode: 'revoke-google-grant'; acknowledgeProjectWideRevocation: true };

export type CalendarDisconnectResponse = {
  disconnected: true;
  remoteRevocation: CalendarRemoteRevocationOutcome;
};

export type CalendarLegacyDurableReceipt = {
  durable: true;
  eventId: string;
  htmlLink: string | null;
  expiresAt: string | null;
};

export type CalendarDurableReceiptV2 = CalendarLegacyDurableReceipt & {
  calendarLabel: string | null;
};

export type CalendarDurableReceipt = CalendarLegacyDurableReceipt | CalendarDurableReceiptV2;

export type CalendarLegacyTurnState = {
  operationId: string;
  state: (typeof CALENDAR_OPERATION_STATES)[number];
  narration: CalendarNarrationStatus;
  retryAction: CalendarRetryAction;
  receipt: CalendarLegacyDurableReceipt | null;
};

export type CalendarTurnStateV2 = {
  schemaVersion: 2;
  operationId: string;
  proposalId?: string | null;
  intentId?: string;
  state: CalendarOperationState;
  narration: CalendarNarrationStatus;
  retryAction: CalendarRetryAction;
  receipt: CalendarDurableReceiptV2 | null;
};

export type CalendarTurnState = CalendarLegacyTurnState | CalendarTurnStateV2;

export type CalendarClarificationReason = 'target' | 'details' | 'conflict' | 'coverage';

export type CalendarClarificationCandidate = {
  calendarId: string;
  label: string;
  role: CalendarRole;
};

export type CalendarClarificationEvent = {
  type: 'calendar-clarification';
  proposalId: string;
  proposalRevision?: number;
  expiresAt: string;
  reason: CalendarClarificationReason;
  message: string;
  candidates: CalendarClarificationCandidate[];
  view?: Extract<CalendarView, { kind: 'proposal' }>;
};

export type CalendarViewTarget = {
  calendarId: string;
  calendarLabel: string | null;
  labelExpiresAt: string | null;
};
export type CalendarCreateInput = {
  summary: string;
  start: string;
  end: string;
  timeZone: string;
  description?: string;
  location?: string;
  calendarId?: string;
};
export type CalendarViewEntry = {
  eventId: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone: string | null;
  status: 'confirmed' | 'tentative' | 'cancelled';
  location?: string;
  description?: string;
  htmlLink: string | null;
};
export type CalendarView =
  | {
      viewVersion: 1;
      kind: 'agenda';
      target: CalendarViewTarget;
      requested: { timeMin: string; timeMax: string; displayTimeZone: string } | null;
      entries: CalendarViewEntry[];
      nextPageToken: string | null;
      truncated: boolean;
      detailsTrimmed: boolean;
      entriesOmitted: number;
      expiresAt: string;
    }
  | {
      viewVersion: 1;
      kind: 'proposal';
      proposalId: string;
      intentId: string;
      revision: number;
      expiresAt: string;
      reason: CalendarClarificationReason;
      target: CalendarViewTarget | null;
      action: CalendarCreateInput | null;
      candidates: CalendarClarificationCandidate[];
    }
  | {
      viewVersion: 1;
      kind: 'outcome';
      operationId: string;
      proposalId: string | null;
      intentId: string;
      state: CalendarOperationState;
      retryAction: CalendarRetryAction;
      receipt: CalendarDurableReceiptV2 | null;
    }
  | {
      viewVersion: 1;
      kind: 'notice';
      state: 'failed' | 'unavailable' | 'clarification' | 'cancelled' | 'expired' | 'read-completed';
      message: string;
      proposalId: string | null;
      intentId: string | null;
      tool:
        | 'calendar_list_events'
        | 'calendar_get_event'
        | 'calendar_list_calendars'
        | 'calendar_check_availability'
        | null;
      coverage: 'complete' | 'incomplete' | null;
      conflict: 'clear' | 'conflict' | 'unknown' | null;
      limitations: string[];
    };
export type CalendarViewEvent = { type: 'calendar-view'; view: CalendarView };
export type CalendarPresentationEvent =
  | CalendarProgressEvent
  | CalendarOperationWireEventV2
  | CalendarClarificationEvent
  | CalendarViewEvent;

export type CalendarProgressEvent = {
  type: 'calendar-progress';
  phase: CalendarProgressPhase;
};

export type CalendarOperationWireEvent = {
  type: 'calendar-operation';
  operation: CalendarLegacyTurnState;
};

export type CalendarOperationWireEventV2 = {
  type: 'calendar-operation';
  operation: CalendarTurnStateV2;
};

export type CalendarStreamEvent =
  | StreamEvent
  | CalendarProgressEvent
  | CalendarOperationWireEvent
  | CalendarOperationWireEventV2
  | CalendarClarificationEvent;

export type CalendarStreamEventV3 =
  | StreamEvent
  | CalendarProgressEvent
  | CalendarOperationWireEventV2
  | CalendarClarificationEvent
  | CalendarViewEvent;

export type CalendarStreamEnvelope = {
  protocolVersion: 2;
  sessionId: string;
  turnId: string;
  attemptId: string;
  sequence: number;
  event: CalendarStreamEvent;
};

export type CalendarStreamEnvelopeV3 = {
  protocolVersion: 3;
  sessionId: string;
  turnId: string;
  attemptId: string;
  sequence: number;
  event: CalendarStreamEventV3;
};

export type CalendarCompatibleEnvelope =
  | StreamEnvelope
  | CalendarStreamEnvelope
  | CalendarStreamEnvelopeV3;

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_CALENDAR_HOSTS = new Set(['www.google.com', 'calendar.google.com', 'google.com']);
const SCRUBBED_QUERY_KEYS = new Set([
  'plugin',
  'oauth',
  'code',
  'state',
  'scope',
  'error',
  'error_description',
  'error_uri',
  'iss',
  'authuser',
  'prompt',
  'hd',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'token',
  'userId',
  'calendarId',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    !CONTROL_CHARS.test(value)
  );
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 64 &&
    !Number.isNaN(Date.parse(value))
  );
}

export function isSafeGoogleOAuthUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.origin === 'https://accounts.google.com' &&
      parsed.pathname === '/o/oauth2/v2/auth' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export function isSafeCalendarEventLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      SAFE_CALENDAR_HOSTS.has(parsed.hostname) &&
      parsed.pathname === '/calendar/event'
    );
  } catch {
    return false;
  }
}

function isProcessingDisclosure(value: unknown): value is CalendarProcessingDisclosure {
  if (!isRecord(value) || !hasExactKeys(value, ['policyId', 'processors', 'dataCollection'])) {
    return false;
  }
  return (
    isBoundedId(value.policyId) &&
    value.processors === 'Google, OpenRouter and the configured model provider' &&
    value.dataCollection === 'deny'
  );
}

function isPositiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isCalendarId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    value !== 'primary' &&
    !CONTROL_CHARS.test(value)
  );
}

function withinBytes(value: unknown, cap: number): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= cap;
  } catch {
    return false;
  }
}

export function isCalendarDiscoveryEntry(value: unknown): value is CalendarDiscoveryEntry {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'calendarId',
      'label',
      'primary',
      'accessRole',
      'privateAccess',
      'timeZone',
      'selected',
      'hidden',
      'deleted',
      'capabilities',
    ])
  ) {
    return false;
  }
  if (!isCalendarId(value.calendarId)) return false;
  if (
    typeof value.label !== 'string' ||
    value.label.length < 1 ||
    value.label.length > 200 ||
    CONTROL_CHARS.test(value.label)
  ) {
    return false;
  }
  if (typeof value.primary !== 'boolean') return false;
  if (
    typeof value.accessRole !== 'string' ||
    !(CALENDAR_ROLES as readonly string[]).includes(value.accessRole)
  ) {
    return false;
  }
  if (typeof value.privateAccess !== 'boolean') return false;
  if (
    value.timeZone !== null &&
    (typeof value.timeZone !== 'string' ||
      value.timeZone.length < 1 ||
      value.timeZone.length > 100 ||
      CONTROL_CHARS.test(value.timeZone))
  ) {
    return false;
  }
  if (
    typeof value.selected !== 'boolean' ||
    typeof value.hidden !== 'boolean' ||
    typeof value.deleted !== 'boolean'
  ) {
    return false;
  }
  if (
    !isRecord(value.capabilities) ||
    !hasExactKeys(value.capabilities, ['readEvents', 'createEvents', 'availability']) ||
    typeof value.capabilities.readEvents !== 'boolean' ||
    typeof value.capabilities.createEvents !== 'boolean' ||
    typeof value.capabilities.availability !== 'boolean'
  ) {
    return false;
  }

  if (
    ['reader', 'freeBusyReader', 'writerWithoutPrivateAccess'].includes(value.accessRole) &&
    value.privateAccess
  ) {
    return false;
  }
  if (
    value.capabilities.createEvents &&
    !['owner', 'writer', 'writerWithoutPrivateAccess'].includes(value.accessRole)
  ) {
    return false;
  }
  if (value.capabilities.readEvents && value.accessRole === 'freeBusyReader') {
    return false;
  }
  if (
    (value.hidden || value.deleted) &&
    (value.capabilities.readEvents ||
      value.capabilities.createEvents ||
      value.capabilities.availability)
  ) {
    return false;
  }

  return true;
}

export function isCalendarCalendarsResponse(value: unknown): value is CalendarCalendarsResponse {
  if (!isRecord(value) || !hasExactKeys(value, ['protocolVersion', 'page'])) {
    return false;
  }
  if (value.protocolVersion !== CALENDAR_STATUS_PROTOCOL_V2) {
    return false;
  }
  const page = value.page;
  if (
    !isRecord(page) ||
    !hasExactKeys(page, [
      'schemaVersion',
      'tool',
      'calendars',
      'discoveryRevision',
      'fetchedAt',
      'expiresAt',
      'complete',
      'truncated',
      'nextPageToken',
      'limitations',
    ])
  ) {
    return false;
  }
  if (page.schemaVersion !== 2 || page.tool !== 'calendar_list_calendars') {
    return false;
  }
  if (!isPositiveRevision(page.discoveryRevision)) {
    return false;
  }
  if (!isIsoDate(page.fetchedAt) || !isIsoDate(page.expiresAt)) {
    return false;
  }
  const lifetime = Date.parse(page.expiresAt) - Date.parse(page.fetchedAt);
  if (lifetime < 0 || lifetime > 300000) {
    return false;
  }
  if (typeof page.complete !== 'boolean' || typeof page.truncated !== 'boolean') {
    return false;
  }
  if (
    page.nextPageToken !== null &&
    (typeof page.nextPageToken !== 'string' ||
      page.nextPageToken.length < 1 ||
      page.nextPageToken.length > 2048 ||
      CONTROL_CHARS.test(page.nextPageToken))
  ) {
    return false;
  }
  if (
    !Array.isArray(page.limitations) ||
    page.limitations.length > 7 ||
    !page.limitations.every((lim) => (CALENDAR_DISCOVERY_LIMITATIONS as readonly string[]).includes(lim))
  ) {
    return false;
  }
  if (page.complete && (page.truncated || page.limitations.length > 0)) {
    return false;
  }
  if (!Array.isArray(page.calendars) || page.calendars.length > 20) {
    return false;
  }
  for (const entry of page.calendars) {
    if (!isCalendarDiscoveryEntry(entry)) {
      return false;
    }
  }
  const ids = new Set(page.calendars.map((c) => c.calendarId));
  if (ids.size !== page.calendars.length) {
    return false;
  }
  if (page.calendars.filter((c) => c.primary).length > 1) {
    return false;
  }
  if (!withinBytes(page, 15360) || !withinBytes(value, 16384)) {
    return false;
  }
  return true;
}

export function isCalendarPublicStatus(value: unknown): value is CalendarPublicStatus {
  if (!isRecord(value)) {
    return false;
  }
  if (value.protocolVersion === CALENDAR_PROTOCOL_VERSION) {
    if (
      !hasExactKeys(value, [
        'protocolVersion',
        'state',
        'enabled',
        'accountEmail',
        'targetCalendarId',
        'processingDisclosure',
      ])
    ) {
      return false;
    }
    const stateOk =
      typeof value.state === 'string' &&
      (CALENDAR_CONNECTION_STATES as readonly string[]).includes(value.state);
    const emailOk =
      value.accountEmail === null ||
      (typeof value.accountEmail === 'string' &&
        value.accountEmail.length >= 3 &&
        value.accountEmail.length <= 320 &&
        !CONTROL_CHARS.test(value.accountEmail) &&
        EMAIL_PATTERN.test(value.accountEmail));
    const targetOk =
      value.targetCalendarId === null ||
      (typeof value.targetCalendarId === 'string' &&
        value.targetCalendarId.length >= 1 &&
        value.targetCalendarId.length <= 1024 &&
        !CONTROL_CHARS.test(value.targetCalendarId));
    const disclosureOk =
      value.processingDisclosure === null || isProcessingDisclosure(value.processingDisclosure);

    return stateOk && typeof value.enabled === 'boolean' && emailOk && targetOk && disclosureOk;
  }

  if (value.protocolVersion === CALENDAR_STATUS_PROTOCOL_V2) {
    if (
      !hasExactKeys(value, [
        'protocolVersion',
        'state',
        'enabled',
        'accountEmail',
        'processingDisclosure',
        'connectionRevision',
        'defaultSetting',
        'primaryCalendarId',
        'discovery',
        'missingScopes',
      ])
    ) {
      return false;
    }
    const stateOk =
      typeof value.state === 'string' &&
      (CALENDAR_CONNECTION_STATES as readonly string[]).includes(value.state);
    const emailOk =
      value.accountEmail === null ||
      (typeof value.accountEmail === 'string' &&
        value.accountEmail.length >= 3 &&
        value.accountEmail.length <= 320 &&
        !CONTROL_CHARS.test(value.accountEmail) &&
        EMAIL_PATTERN.test(value.accountEmail));
    const disclosureOk =
      value.processingDisclosure === null || isProcessingDisclosure(value.processingDisclosure);
    const connectionRevisionOk =
      value.connectionRevision === null || isPositiveRevision(value.connectionRevision);
    const primaryOk =
      value.primaryCalendarId === null || isCalendarId(value.primaryCalendarId);

    let defaultSettingOk = false;
    if (value.defaultSetting === null) {
      defaultSettingOk = true;
    } else if (
      isRecord(value.defaultSetting) &&
      hasExactKeys(value.defaultSetting, ['defaultCalendarId', 'defaultSettingRevision'])
    ) {
      const defIdOk =
        value.defaultSetting.defaultCalendarId === null ||
        isCalendarId(value.defaultSetting.defaultCalendarId);
      const defRevOk = isPositiveRevision(value.defaultSetting.defaultSettingRevision);
      defaultSettingOk = defIdOk && defRevOk;
    }

    let discoveryOk = false;
    if (value.discovery === null) {
      discoveryOk = true;
    } else if (
      isRecord(value.discovery) &&
      hasExactKeys(value.discovery, [
        'discoveryRevision',
        'fetchedAt',
        'expiresAt',
        'complete',
        'truncated',
        'stale',
      ])
    ) {
      discoveryOk =
        isPositiveRevision(value.discovery.discoveryRevision) &&
        isIsoDate(value.discovery.fetchedAt) &&
        isIsoDate(value.discovery.expiresAt) &&
        typeof value.discovery.complete === 'boolean' &&
        typeof value.discovery.truncated === 'boolean' &&
        typeof value.discovery.stale === 'boolean';
    }

    const missingScopesOk =
      Array.isArray(value.missingScopes) &&
      value.missingScopes.length <= 5 &&
      value.missingScopes.every(
        (s) => typeof s === 'string' && s.length >= 1 && s.length <= 200 && !CONTROL_CHARS.test(s),
      );

    const connectedNoMissingScopes = !(
      value.state === 'connected' &&
      Array.isArray(value.missingScopes) &&
      value.missingScopes.length > 0
    );

    return (
      stateOk &&
      typeof value.enabled === 'boolean' &&
      emailOk &&
      disclosureOk &&
      connectionRevisionOk &&
      primaryOk &&
      defaultSettingOk &&
      discoveryOk &&
      missingScopesOk &&
      connectedNoMissingScopes
    );
  }

  return false;
}

export function isCalendarSettingsRequest(value: unknown): value is CalendarSettingsRequest {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.length > 2) {
    return false;
  }
  if (!keys.every((key) => key === 'enabled' || key === 'defaultSetting')) {
    return false;
  }
  if (value.enabled === undefined && value.defaultSetting === undefined) {
    return false;
  }
  if (Object.hasOwn(value, 'enabled') && typeof value.enabled !== 'boolean') {
    return false;
  }
  if (Object.hasOwn(value, 'defaultSetting')) {
    const ds = value.defaultSetting;
    if (
      !isRecord(ds) ||
      !hasExactKeys(ds, ['calendarId', 'expectedRevision', 'expectedConnectionRevision'])
    ) {
      return false;
    }
    const calIdOk = ds.calendarId === null || isCalendarId(ds.calendarId);
    const revOk = isPositiveRevision(ds.expectedRevision);
    const connRevOk = isPositiveRevision(ds.expectedConnectionRevision);
    if (!calIdOk || !revOk || !connRevOk) {
      return false;
    }
  }
  return true;
}

export function isCalendarRefreshRequest(value: unknown): value is CalendarRefreshRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['expectedConnectionRevision']) &&
    isPositiveRevision(value.expectedConnectionRevision)
  );
}

export function isCalendarOAuthStartRequest(value: unknown): value is CalendarOAuthStartRequest {
  return isRecord(value) && Object.keys(value).length === 0;
}

export function isCalendarOAuthStartResponse(value: unknown): value is CalendarOAuthStartResponse {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['authorizationUrl']) &&
    isSafeGoogleOAuthUrl(value.authorizationUrl)
  );
}

export function isCalendarDisconnectRequest(value: unknown): value is CalendarDisconnectRequest {
  if (!isRecord(value) || typeof value.mode !== 'string') {
    return false;
  }
  if (value.mode === 'local') {
    return hasExactKeys(value, ['mode']);
  }
  if (value.mode === 'revoke-google-grant') {
    return (
      hasExactKeys(value, ['mode', 'acknowledgeProjectWideRevocation']) &&
      value.acknowledgeProjectWideRevocation === true
    );
  }
  return false;
}

export function isCalendarDisconnectResponse(value: unknown): value is CalendarDisconnectResponse {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['disconnected', 'remoteRevocation']) &&
    value.disconnected === true &&
    typeof value.remoteRevocation === 'string' &&
    (CALENDAR_REMOTE_REVOCATION_OUTCOMES as readonly string[]).includes(value.remoteRevocation)
  );
}

function isCalendarLegacyDurableReceipt(value: unknown): value is CalendarLegacyDurableReceipt {
  if (!isRecord(value) || !hasExactKeys(value, ['durable', 'eventId', 'htmlLink', 'expiresAt'])) {
    return false;
  }
  const eventIdOk =
    typeof value.eventId === 'string' &&
    value.eventId.length >= 5 &&
    value.eventId.length <= 1024 &&
    !CONTROL_CHARS.test(value.eventId);
  const linkOk = value.htmlLink === null || isSafeCalendarEventLink(value.htmlLink);
  const expiresOk = value.expiresAt === null || isIsoDate(value.expiresAt);
  if (!value.durable || value.durable !== true || !eventIdOk || !linkOk || !expiresOk) {
    return false;
  }
  return value.htmlLink === null || value.expiresAt !== null;
}

function isCalendarDurableReceiptV2(value: unknown): value is CalendarDurableReceiptV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['durable', 'eventId', 'htmlLink', 'expiresAt', 'calendarLabel'])
  ) {
    return false;
  }
  const eventIdOk =
    typeof value.eventId === 'string' &&
    value.eventId.length >= 5 &&
    value.eventId.length <= 1024 &&
    !CONTROL_CHARS.test(value.eventId);
  const linkOk = value.htmlLink === null || isSafeCalendarEventLink(value.htmlLink);
  const expiresOk = value.expiresAt === null || isIsoDate(value.expiresAt);
  const labelOk =
    value.calendarLabel === null ||
    (typeof value.calendarLabel === 'string' &&
      value.calendarLabel.length >= 1 &&
      value.calendarLabel.length <= 200 &&
      !CONTROL_CHARS.test(value.calendarLabel));

  if (!value.durable || value.durable !== true || !eventIdOk || !linkOk || !expiresOk || !labelOk) {
    return false;
  }
  if (value.htmlLink !== null || value.calendarLabel !== null) {
    if (value.expiresAt === null) return false;
  }
  return true;
}

export function isCalendarDurableReceipt(value: unknown): value is CalendarDurableReceipt {
  return isCalendarLegacyDurableReceipt(value) || isCalendarDurableReceiptV2(value);
}

export function isCalendarLegacyTurnState(value: unknown): value is CalendarLegacyTurnState {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['operationId', 'state', 'narration', 'retryAction', 'receipt'])
  ) {
    return false;
  }
  const stateOk =
    typeof value.state === 'string' &&
    (CALENDAR_OPERATION_STATES as readonly string[]).includes(value.state);
  const narrationOk =
    typeof value.narration === 'string' &&
    (CALENDAR_NARRATION_STATUSES as readonly string[]).includes(value.narration);
  const retryOk =
    typeof value.retryAction === 'string' &&
    (CALENDAR_RETRY_ACTIONS as readonly string[]).includes(value.retryAction);
  const receiptOk = value.receipt === null || isCalendarLegacyDurableReceipt(value.receipt);
  if (!isBoundedId(value.operationId) || !stateOk || !narrationOk || !retryOk || !receiptOk) {
    return false;
  }
  return (value.state === 'succeeded') === (value.receipt !== null);
}

export function isCalendarTurnStateV2(value: unknown): value is CalendarTurnStateV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'operationId',
      ...('proposalId' in value ? ['proposalId'] : []),
      ...('intentId' in value ? ['intentId'] : []),
      'state',
      'narration',
      'retryAction',
      'receipt',
    ])
  ) {
    return false;
  }
  if (value.schemaVersion !== 2) return false;
  if ('proposalId' in value && value.proposalId !== null && !isBoundedId(value.proposalId)) {
    return false;
  }
  if ('intentId' in value && !isBoundedId(value.intentId)) return false;
  const stateOk =
    typeof value.state === 'string' &&
    (CALENDAR_OPERATION_STATES_V2 as readonly string[]).includes(value.state);
  const narrationOk =
    typeof value.narration === 'string' &&
    (CALENDAR_NARRATION_STATUSES as readonly string[]).includes(value.narration);
  const retryOk =
    typeof value.retryAction === 'string' &&
    (CALENDAR_RETRY_ACTIONS as readonly string[]).includes(value.retryAction);
  const receiptOk = value.receipt === null || isCalendarDurableReceiptV2(value.receipt);
  if (!isBoundedId(value.operationId) || !stateOk || !narrationOk || !retryOk || !receiptOk) {
    return false;
  }
  return (value.state === 'succeeded') === (value.receipt !== null);
}

export function isCalendarTurnState(value: unknown): value is CalendarTurnState {
  return isCalendarLegacyTurnState(value) || isCalendarTurnStateV2(value);
}

export function isCalendarClarificationCandidate(
  value: unknown,
): value is CalendarClarificationCandidate {
  if (!isRecord(value) || !hasExactKeys(value, ['calendarId', 'label', 'role'])) {
    return false;
  }
  return (
    isCalendarId(value.calendarId) &&
    typeof value.label === 'string' &&
    value.label.length >= 1 &&
    value.label.length <= 200 &&
    !CONTROL_CHARS.test(value.label) &&
    typeof value.role === 'string' &&
    (CALENDAR_ROLES as readonly string[]).includes(value.role)
  );
}

export function isCalendarClarificationEvent(value: unknown): value is CalendarClarificationEvent {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['type', 'proposalId', 'expiresAt', 'reason', 'message', 'candidates',
      ...('proposalRevision' in value ? ['proposalRevision'] : []),
      ...('view' in value ? ['view'] : [])])
  ) {
    return false;
  }
  if (value.type !== 'calendar-clarification') return false;
  if (!isBoundedId(value.proposalId)) return false;
  if ('proposalRevision' in value && (!Number.isSafeInteger(value.proposalRevision)
    || (value.proposalRevision as number) < 1)) return false;
  if ('view' in value && (!isCalendarView(value.view) || value.view.kind !== 'proposal')) return false;
  if (!isIsoDate(value.expiresAt)) return false;
  if (
    typeof value.reason !== 'string' ||
    !['target', 'details', 'conflict', 'coverage'].includes(value.reason)
  ) {
    return false;
  }
  if (
    typeof value.message !== 'string' ||
    value.message.length < 1 ||
    value.message.length > 1000 ||
    CONTROL_CHARS.test(value.message)
  ) {
    return false;
  }
  if (!Array.isArray(value.candidates) || value.candidates.length > 20) {
    return false;
  }
  return value.candidates.every(isCalendarClarificationCandidate);
}

export function isCalendarProgressEvent(value: unknown): value is CalendarProgressEvent {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['type', 'phase']) &&
    value.type === 'calendar-progress' &&
    typeof value.phase === 'string' &&
    (CALENDAR_PROGRESS_PHASES as readonly string[]).includes(value.phase)
  );
}

export function isCalendarOperationWireEvent(value: unknown): value is CalendarOperationWireEvent {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['type', 'operation']) &&
    value.type === 'calendar-operation' &&
    isCalendarLegacyTurnState(value.operation)
  );
}

export function isCalendarOperationWireEventV2(
  value: unknown,
): value is CalendarOperationWireEventV2 {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['type', 'operation']) &&
    value.type === 'calendar-operation' &&
    isCalendarTurnStateV2(value.operation)
  );
}

const boundedText = (v: unknown, max: number, min = 0): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const validZone = (v: unknown): v is string => {
  if (!boundedText(v, 100, 1)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; }
};
const dateOnly = (v: unknown): v is string => boundedText(v, 10, 10) && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const instant = (v: unknown): v is string => boundedText(v, 96, 1) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
function viewTarget(v: unknown): v is CalendarViewTarget {
  return isRecord(v) && hasExactKeys(v, ['calendarId', 'calendarLabel', 'labelExpiresAt']) && isCalendarId(v.calendarId) &&
    (v.calendarLabel === null || boundedText(v.calendarLabel, 200, 1)) && (v.labelExpiresAt === null || isIsoDate(v.labelExpiresAt));
}
function createInput(v: unknown): v is CalendarCreateInput {
  return isRecord(v) && hasExactKeys(v, ['summary', 'start', 'end', 'timeZone',
    ...('description' in v ? ['description'] : []), ...('location' in v ? ['location'] : []), ...('calendarId' in v ? ['calendarId'] : [])]) &&
    boundedText(v.summary, 200, 1) && boundedText(v.start, 96, 1) && boundedText(v.end, 96, 1) && boundedText(v.timeZone, 100, 1) &&
    (!('description' in v) || boundedText(v.description, 2000)) && (!('location' in v) || boundedText(v.location, 500)) &&
    (!('calendarId' in v) || v.calendarId === 'primary' || isCalendarId(v.calendarId));
}
function viewEntry(v: unknown): v is CalendarViewEntry {
  if (!isRecord(v) || !hasExactKeys(v, ['eventId', 'summary', 'start', 'end', 'allDay', 'timeZone', 'status', 'htmlLink',
    ...('location' in v ? ['location'] : []), ...('description' in v ? ['description'] : [])])) return false;
  return boundedText(v.eventId, 1024, 1) && boundedText(v.summary, 200) && typeof v.allDay === 'boolean' &&
    (v.timeZone === null || validZone(v.timeZone)) && ['confirmed', 'tentative', 'cancelled'].includes(v.status as string) &&
    (v.htmlLink === null || isSafeCalendarEventLink(v.htmlLink)) &&
    (!('location' in v) || boundedText(v.location, 500)) && (!('description' in v) || boundedText(v.description, 2000)) &&
    (v.allDay ? dateOnly(v.start) && dateOnly(v.end) && v.end > v.start
      : instant(v.start) && instant(v.end) && Date.parse(v.end) > Date.parse(v.start));
}
export function isCalendarView(v: unknown): v is CalendarView {
  if (!isRecord(v) || v.viewVersion !== 1 || !withinBytes(v, 14336)) return false;
  if (v.kind === 'agenda') {
    if (!hasExactKeys(v, ['viewVersion', 'kind', 'target', 'requested', 'entries', 'nextPageToken', 'truncated', 'detailsTrimmed', 'entriesOmitted', 'expiresAt'])) return false;
    const r = v.requested;
    return viewTarget(v.target) && isIsoDate(v.expiresAt) && (r === null || (isRecord(r) &&
      hasExactKeys(r, ['timeMin', 'timeMax', 'displayTimeZone']) && isIsoDate(r.timeMin) && isIsoDate(r.timeMax) &&
      Date.parse(r.timeMax) > Date.parse(r.timeMin) && validZone(r.displayTimeZone))) &&
      Array.isArray(v.entries) && v.entries.length <= 20 && v.entries.every(viewEntry) &&
      (v.nextPageToken === null || boundedText(v.nextPageToken, 2048, 1)) && typeof v.truncated === 'boolean' &&
      typeof v.detailsTrimmed === 'boolean' && typeof v.entriesOmitted === 'number' && Number.isInteger(v.entriesOmitted) &&
      v.entriesOmitted >= 0 && v.entriesOmitted <= 20 && ((v.entriesOmitted === 0 && v.nextPageToken === null) || v.truncated) &&
      (v.target.calendarLabel === null || (v.target.labelExpiresAt !== null && Date.parse(v.target.labelExpiresAt) <= Date.parse(v.expiresAt)));
  }
  if (v.kind === 'proposal') return hasExactKeys(v, ['viewVersion', 'kind', 'proposalId', 'intentId', 'revision', 'expiresAt', 'reason', 'target', 'action', 'candidates']) &&
    isBoundedId(v.proposalId) && isBoundedId(v.intentId) && isPositiveRevision(v.revision) && isIsoDate(v.expiresAt) &&
    ['target', 'details', 'conflict', 'coverage'].includes(v.reason as string) && (v.target === null || viewTarget(v.target)) &&
    (v.action === null || createInput(v.action)) && Array.isArray(v.candidates) && v.candidates.length <= 20 && v.candidates.every(isCalendarClarificationCandidate);
  if (v.kind === 'outcome') return hasExactKeys(v, ['viewVersion', 'kind', 'operationId', 'proposalId', 'intentId', 'state', 'retryAction', 'receipt']) &&
    isBoundedId(v.operationId) && (v.proposalId === null || isBoundedId(v.proposalId)) && isBoundedId(v.intentId) &&
    CALENDAR_OPERATION_STATES_V2.includes(v.state as CalendarOperationState) && CALENDAR_RETRY_ACTIONS.includes(v.retryAction as CalendarRetryAction) &&
    (v.receipt === null || isCalendarDurableReceiptV2(v.receipt)) && ((v.state === 'succeeded') === (v.receipt !== null));
  if (v.kind === 'notice') return hasExactKeys(v, ['viewVersion', 'kind', 'state', 'message', 'proposalId', 'intentId', 'tool', 'coverage', 'conflict', 'limitations']) &&
    ['failed', 'unavailable', 'clarification', 'cancelled', 'expired', 'read-completed'].includes(v.state as string) && boundedText(v.message, 1000, 1) &&
    (v.proposalId === null || isBoundedId(v.proposalId)) && (v.intentId === null || isBoundedId(v.intentId)) &&
    [null, 'calendar_list_events', 'calendar_get_event', 'calendar_list_calendars', 'calendar_check_availability'].includes(v.tool as string | null) &&
    [null, 'complete', 'incomplete'].includes(v.coverage as string | null) && [null, 'clear', 'conflict', 'unknown'].includes(v.conflict as string | null) &&
    Array.isArray(v.limitations) && v.limitations.length <= 8 && v.limitations.every(x => boundedText(x, 100, 1));
  return false;
}
export function isCalendarPresentationEvent(v: unknown): v is CalendarPresentationEvent {
  return isCalendarProgressEvent(v) || isCalendarOperationWireEventV2(v) || isCalendarClarificationEvent(v) ||
    (isRecord(v) && hasExactKeys(v, ['type', 'view']) && v.type === 'calendar-view' && isCalendarView(v.view));
}

export function isCalendarStreamEvent(value: unknown): value is CalendarStreamEvent {
  return (
    isStreamEvent(value) ||
    isCalendarProgressEvent(value) ||
    isCalendarOperationWireEvent(value)
  );
}

export function isCalendarStreamEventV3(value: unknown): value is CalendarStreamEventV3 {
  return isStreamEvent(value) || isCalendarPresentationEvent(value);
}

export function isCalendarStreamEnvelope(
  value: unknown,
): value is CalendarStreamEnvelope | CalendarStreamEnvelopeV3 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'protocolVersion',
      'sessionId',
      'turnId',
      'attemptId',
      'sequence',
      'event',
    ])
  ) {
    return false;
  }
  if (
    !isBoundedId(value.sessionId) ||
    !isBoundedId(value.turnId) ||
    !isBoundedId(value.attemptId) ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0
  ) {
    return false;
  }
  if (value.protocolVersion === CALENDAR_STREAM_PROTOCOL_VERSION) {
    return isCalendarStreamEvent(value.event);
  }
  if (value.protocolVersion === CALENDAR_STREAM_PROTOCOL_V2) {
    if (!withinBytes(value, 16384)) {
      return false;
    }
    return isCalendarStreamEventV3(value.event);
  }
  return false;
}

export function isCalendarCompatibleEnvelope(value: unknown): value is CalendarCompatibleEnvelope {
  return isStreamEnvelope(value) || isCalendarStreamEnvelope(value);
}

export function parseCalendarCompatibleFrame(line: string): CalendarCompatibleEnvelope {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) {
    throw new Error('invalid_sse_line');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice('data:'.length).trim());
  } catch {
    throw new Error('invalid_stream_envelope');
  }
  if (!isCalendarCompatibleEnvelope(parsed)) {
    throw new Error('invalid_stream_envelope');
  }
  return parsed;
}

export function extractAndScrubCalendarOAuthCallback(currentHref: string): {
  outcome: CalendarOAuthCallbackOutcome | null;
  scrubbedPathAndSearch: string;
  hadSensitiveParams: boolean;
} {
  let url: URL;
  try {
    url = new URL(currentHref, 'http://127.0.0.1:5173');
  } catch {
    return { outcome: null, scrubbedPathAndSearch: '/', hadSensitiveParams: false };
  }

  const plugin = url.searchParams.get('plugin');
  const rawOAuth = url.searchParams.get('oauth');
  const outcome: CalendarOAuthCallbackOutcome | null =
    plugin === 'google-calendar' &&
    rawOAuth !== null &&
    (CALENDAR_OAUTH_CALLBACK_OUTCOMES as readonly string[]).includes(rawOAuth)
      ? (rawOAuth as CalendarOAuthCallbackOutcome)
      : null;

  let hadSensitiveParams = false;
  for (const key of Array.from(url.searchParams.keys())) {
    if (SCRUBBED_QUERY_KEYS.has(key)) {
      url.searchParams.delete(key);
      hadSensitiveParams = true;
    }
  }

  if (url.hash) {
    const lowerHash = url.hash.toLowerCase();
    if (
      lowerHash.includes('token') ||
      lowerHash.includes('code') ||
      lowerHash.includes('state') ||
      lowerHash.includes('error') ||
      outcome !== null
    ) {
      url.hash = '';
      hadSensitiveParams = true;
    }
  }

  const search = url.searchParams.toString();
  const scrubbedPathAndSearch = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
  return { outcome, scrubbedPathAndSearch, hadSensitiveParams };
}
