/**
 * ============================================================================
 * FILE: calendar-setup-state.ts
 * LOCATION: frontend/src/features/plugins/google-calendar/calendar-setup-state.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Manage race-safe, bounded, non-optimistic reducer state for Calendar setup and picker.
 *
 * ROLE IN PROJECT:
 *    Coordinates setup lifecycle, OAuth redirects, cached calendar pagination,
 *    fenced status/discovery revisions, and CAS preference rollback.
 *
 * KEY COMPONENTS:
 *    - CalendarSetupState / CalendarSetupAction: State and action definitions.
 *    - createInitialCalendarSetupState: Initializer seeding confirmed default.
 *    - calendarSetupReducer: Pure state transitions with request/revision fencing.
 *    - describeConnectionState / describeOAuthOutcome: Accessible text helpers.
 * ============================================================================
 */

import {
  isSafeGoogleOAuthUrl,
  type CalendarCalendarPage,
  type CalendarCalendarsResponse,
  type CalendarConnectionState,
  type CalendarDiscoveryEntry,
  type CalendarOAuthCallbackOutcome,
  type CalendarPublicStatus,
  type CalendarRemoteRevocationOutcome,
} from '../../../api/calendar-protocol.ts';

export type DisconnectMode = 'local' | 'revoke-google-grant';

export type CalendarSetupState = {
  phase: 'loading' | 'ready' | 'unavailable';
  status: CalendarPublicStatus | null;
  pending:
    | 'enable'
    | 'disable'
    | 'oauth-start'
    | 'disconnect'
    | 'save-default'
    | 'refresh'
    | null;
  error: string | null;
  notice: string | null;
  disconnectPrompt: {
    mode: DisconnectMode;
    acknowledgedProjectWide: boolean;
  } | null;
  requestId: number;
  listPhase: 'idle' | 'loading' | 'ready' | 'error';
  page: CalendarCalendarPage | null;
  entries: CalendarDiscoveryEntry[];
  seenPageTokens: string[];
  listError: string | null;
  draftCalendarId: string | null;
  settingsUnconfirmed: boolean;
};

export type CalendarSetupAction =
  | { type: 'loading' }
  | { type: 'loaded'; status: CalendarPublicStatus }
  | { type: 'unavailable'; message: string }
  | { type: 'begin'; pending: NonNullable<CalendarSetupState['pending']> }
  | { type: 'statusUpdated'; status: CalendarPublicStatus; notice?: string | null }
  | { type: 'failed'; message: string }
  | { type: 'openDisconnect'; mode: DisconnectMode }
  | { type: 'setRevokeAcknowledged'; acknowledged: boolean }
  | { type: 'closeDisconnect' }
  | {
      type: 'disconnected';
      status: CalendarPublicStatus;
      remoteRevocation: CalendarRemoteRevocationOutcome;
    }
  | {
      type: 'requestStarted';
      requestId: number;
      pending: CalendarSetupState['pending'];
      listLoading?: boolean;
    }
  | { type: 'statusReceived'; requestId: number; status: CalendarPublicStatus }
  | {
      type: 'pageReceived';
      requestId: number;
      response: CalendarCalendarsResponse;
      requestedToken: string | null;
      connectionRevision: number;
    }
  | { type: 'selectDefault'; calendarId: string | null }
  | { type: 'defaultSaved'; requestId: number; status: CalendarPublicStatus }
  | {
      type: 'requestFailed';
      requestId: number;
      message: string;
      resetDraft: boolean;
      listOnly?: boolean;
      unconfirmed?: boolean;
    }
  | { type: 'discoveryExpired'; discoveryRevision: number };

export function createInitialCalendarSetupState(
  initialStatus: CalendarPublicStatus | null = null,
  initialDisconnectMode: DisconnectMode | null = null,
): CalendarSetupState {
  const confirmedDefault =
    initialStatus && initialStatus.protocolVersion === 2
      ? initialStatus.defaultSetting?.defaultCalendarId ?? null
      : null;
  return {
    phase: initialStatus ? 'ready' : 'loading',
    status: initialStatus,
    pending: null,
    error: null,
    notice: null,
    disconnectPrompt: initialDisconnectMode
      ? { mode: initialDisconnectMode, acknowledgedProjectWide: false }
      : null,
    requestId: 0,
    listPhase: 'idle',
    page: null,
    entries: [],
    seenPageTokens: [],
    listError: null,
    draftCalendarId: confirmedDefault,
    settingsUnconfirmed: false,
  };
}

export function describeConnectionState(state: CalendarConnectionState): {
  badge: string;
  summary: string;
} {
  switch (state) {
    case 'disabled':
      return {
        badge: 'Disabled (default off)',
        summary:
          'Google Calendar tools are disabled. Enable the plugin to allow read and scheduling requests on accessible calendars.',
      };
    case 'setup-required':
      return {
        badge: 'Setup required',
        summary:
          'Connect the local operator Google account before using Calendar tools.',
      };
    case 'connected':
      return {
        badge: 'Connected',
        summary:
          'Google Calendar is connected and bound to the local server identity.',
      };
    case 'reconnect-required':
      return {
        badge: 'Reconnect required',
        summary:
          'The Google Calendar grant is missing, expired, or revoked. Reconnect to restore Calendar tools.',
      };
    case 'degraded':
      return {
        badge: 'Degraded (fixture or limited readiness)',
        summary:
          'Google Calendar is running in local fixture or degraded mode rather than a certified live Google connection. Ordinary text chat remains available.',
      };
  }
}

export function describeOAuthOutcome(outcome: CalendarOAuthCallbackOutcome): string {
  switch (outcome) {
    case 'connected':
      return 'Google Calendar connected.';
    case 'fixture':
      return 'Google Calendar connected in local fixture mode (not a live Google grant).';
    case 'cancelled':
      return 'Google Calendar authorization was cancelled. No credentials were saved.';
    case 'failed':
      return 'Google Calendar authorization could not be completed. Verify setup and try again.';
  }
}

export function describeRemoteRevocation(outcome: CalendarRemoteRevocationOutcome): string {
  switch (outcome) {
    case 'not-requested':
      return 'Disconnected locally. Stored Aurvin credentials were cleared; your Google project grant was not remotely revoked.';
    case 'confirmed':
      return 'Disconnected locally and confirmed Google grant revocation.';
    case 'failed':
      return 'Disconnected locally and cleared Aurvin credentials, but Google grant revocation failed. Manage or revoke access directly in your Google Account permissions.';
    case 'unknown':
      return 'Disconnected locally and cleared Aurvin credentials, but remote Google grant revocation could not be confirmed. Check your Google Account permissions to verify revocation.';
  }
}

export const KNOWN_SCOPE_LABELS: Record<string, string> = {
  'https://www.googleapis.com/auth/calendar.events': 'Manage calendar events',
  'https://www.googleapis.com/auth/calendar.readonly': 'View calendars and events',
  'https://www.googleapis.com/auth/calendar.freebusy': 'View availability (free/busy)',
};

export function describeMissingScope(scope: string): string {
  return KNOWN_SCOPE_LABELS[scope] ?? 'Additional Google Calendar permission';
}

export function navigateToGoogleOAuth(
  authorizationUrl: string,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): boolean {
  if (!isSafeGoogleOAuthUrl(authorizationUrl)) {
    return false;
  }
  navigate(authorizationUrl);
  return true;
}

export function calendarSetupReducer(
  state: CalendarSetupState,
  action: CalendarSetupAction,
): CalendarSetupState {
  switch (action.type) {
    case 'loading':
      return { ...state, phase: 'loading', error: null };
    case 'loaded': {
      const confirmed =
        action.status.protocolVersion === 2
          ? action.status.defaultSetting?.defaultCalendarId ?? null
          : null;
      return {
        ...state,
        phase: 'ready',
        status: action.status,
        pending: null,
        error: null,
        draftCalendarId: confirmed,
      };
    }
    case 'unavailable':
      return {
        ...state,
        phase: 'unavailable',
        pending: null,
        error: action.message,
      };
    case 'begin':
      return {
        ...state,
        pending: action.pending,
        error: null,
        notice: null,
      };
    case 'statusUpdated':
      return {
        ...state,
        phase: 'ready',
        status: action.status,
        pending: null,
        error: null,
        notice: action.notice ?? null,
      };
    case 'failed':
      return {
        ...state,
        pending: null,
        error: action.message,
      };
    case 'openDisconnect':
      return {
        ...state,
        error: null,
        disconnectPrompt: {
          mode: action.mode,
          acknowledgedProjectWide: false,
        },
      };
    case 'setRevokeAcknowledged':
      if (!state.disconnectPrompt) return state;
      return {
        ...state,
        disconnectPrompt: {
          ...state.disconnectPrompt,
          acknowledgedProjectWide: action.acknowledged,
        },
      };
    case 'closeDisconnect':
      return {
        ...state,
        disconnectPrompt: null,
      };
    case 'disconnected':
      return {
        ...state,
        phase: 'ready',
        status: action.status,
        pending: null,
        error: null,
        disconnectPrompt: null,
        entries: [],
        page: null,
        seenPageTokens: [],
        listPhase: 'idle',
        listError: null,
        draftCalendarId: null,
        notice: describeRemoteRevocation(action.remoteRevocation),
      };
    case 'requestStarted': {
      if (action.requestId <= state.requestId) return state;
      return {
        ...state,
        requestId: action.requestId,
        pending: action.pending,
        listPhase: action.listLoading ? 'loading' : state.listPhase,
        error: null,
        notice: null,
        listError: action.listLoading ? null : state.listError,
      };
    }
    case 'selectDefault':
      return {
        ...state,
        draftCalendarId: action.calendarId,
      };
    case 'statusReceived': {
      if (action.requestId !== state.requestId) return state;
      const newStatus = action.status;
      const oldStatus = state.status;
      const authorityChanged =
        !oldStatus ||
        oldStatus.protocolVersion !== newStatus.protocolVersion ||
        (newStatus.protocolVersion === 2 &&
          oldStatus.protocolVersion === 2 &&
          (oldStatus.connectionRevision !== newStatus.connectionRevision ||
            oldStatus.accountEmail !== newStatus.accountEmail)) ||
        newStatus.state !== 'connected' ||
        !newStatus.enabled;

      const nextEntries = authorityChanged ? [] : state.entries;
      const nextPage = authorityChanged ? null : state.page;
      const nextTokens = authorityChanged ? [] : state.seenPageTokens;
      const nextListPhase = authorityChanged ? 'idle' : state.listPhase;
      const nextListError = authorityChanged ? null : state.listError;

      const confirmedDefault =
        newStatus.protocolVersion === 2
          ? newStatus.defaultSetting?.defaultCalendarId ?? null
          : null;
      const nextDraft = authorityChanged ? confirmedDefault : state.draftCalendarId;

      return {
        ...state,
        phase: 'ready',
        status: newStatus,
        pending: null,
        error: null,
        settingsUnconfirmed: false,
        entries: nextEntries,
        page: nextPage,
        seenPageTokens: nextTokens,
        listPhase: nextListPhase,
        listError: nextListError,
        draftCalendarId: nextDraft,
      };
    }
    case 'pageReceived': {
      if (
        action.requestId !== state.requestId ||
        state.status?.protocolVersion !== 2 ||
        action.connectionRevision !== state.status.connectionRevision
      ) {
        return state;
      }
      const oldRevision = state.page?.discoveryRevision;
      if (oldRevision !== undefined && action.response.page.discoveryRevision < oldRevision) {
        return state;
      }
      if (
        action.requestedToken !== null &&
        oldRevision !== undefined &&
        oldRevision !== action.response.page.discoveryRevision
      ) {
        return {
          ...state,
          pending: null,
          listPhase: 'error',
          listError: 'Calendar list changed. Refresh or reload the first page.',
        };
      }

      const incomingPage = action.response.page;
      let nextEntries = [...state.entries];
      let nextTokens = [...state.seenPageTokens];

      if (action.requestedToken === null) {
        nextEntries = [...incomingPage.calendars];
        nextTokens = [];
      } else {
        if (state.seenPageTokens.includes(action.requestedToken)) {
          return {
            ...state,
            pending: null,
            listPhase: 'error',
            listError:
              'The local calendar list limit was reached; refresh or use a narrower available selection.',
          };
        }
        if (state.seenPageTokens.length >= 100) {
          return {
            ...state,
            pending: null,
            listPhase: 'error',
            listError:
              'The local calendar list limit was reached; refresh or use a narrower available selection.',
          };
        }
        nextTokens.push(action.requestedToken);

        for (const entry of incomingPage.calendars) {
          const existing = nextEntries.find((e) => e.calendarId === entry.calendarId);
          if (existing) {
            if (
              existing.accessRole !== entry.accessRole ||
              existing.primary !== entry.primary ||
              existing.capabilities.createEvents !== entry.capabilities.createEvents
            ) {
              return {
                ...state,
                pending: null,
                listPhase: 'error',
                listError: 'Calendar list changed. Refresh or reload the first page.',
              };
            }
          } else {
            nextEntries.push(entry);
          }
        }
        if (nextEntries.length > 100) {
          return {
            ...state,
            pending: null,
            listPhase: 'error',
            listError:
              'The local calendar list limit was reached; refresh or use a narrower available selection.',
          };
        }
      }

      const byteCheck = {
        entries: nextEntries,
        page: incomingPage,
        seenPageTokens: nextTokens,
      };
      if (new TextEncoder().encode(JSON.stringify(byteCheck)).byteLength > 262144) {
        return {
          ...state,
          pending: null,
          listPhase: 'error',
          listError:
            'The local calendar list limit was reached; refresh or use a narrower available selection.',
        };
      }

      return {
        ...state,
        pending: null,
        listPhase: 'ready',
        page: incomingPage,
        entries: nextEntries,
        seenPageTokens: nextTokens,
        listError: null,
      };
    }
    case 'defaultSaved': {
      if (action.requestId !== state.requestId) return state;
      const confirmedDefault =
        action.status.protocolVersion === 2
          ? action.status.defaultSetting?.defaultCalendarId ?? null
          : null;
      const isReset = confirmedDefault === null;
      return {
        ...state,
        status: action.status,
        pending: null,
        error: null,
        settingsUnconfirmed: false,
        draftCalendarId: confirmedDefault,
        notice: isReset
          ? 'Default calendar reset to automatic primary.'
          : 'Default calendar saved.',
      };
    }
    case 'requestFailed': {
      if (action.requestId !== state.requestId) return state;
      const confirmedDefault =
        state.status?.protocolVersion === 2
          ? state.status.defaultSetting?.defaultCalendarId ?? null
          : null;
      const draftCalendarId = action.resetDraft ? confirmedDefault : state.draftCalendarId;
      if (action.listOnly) {
        return {
          ...state,
          pending: null,
          listPhase: 'error',
          listError: action.message,
        };
      }
      return {
        ...state,
        pending: null,
        error: action.message,
        draftCalendarId,
        settingsUnconfirmed: action.unconfirmed ? true : state.settingsUnconfirmed,
      };
    }
    case 'discoveryExpired': {
      if (
        state.status?.protocolVersion !== 2 ||
        state.status.discovery?.discoveryRevision !== action.discoveryRevision
      ) {
        return state;
      }
      return {
        ...state,
        page: null,
        entries: [],
        seenPageTokens: [],
        listPhase: 'idle',
        listError: 'Cached calendar list expired. Refresh to view calendars.',
      };
    }
    default:
      return state;
  }
}
