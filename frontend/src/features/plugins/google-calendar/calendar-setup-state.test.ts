import { describe, expect, it, vi } from 'vitest';
import {
  calendarSetupReducer,
  createInitialCalendarSetupState,
  describeConnectionState,
  describeOAuthOutcome,
  describeRemoteRevocation,
  navigateToGoogleOAuth,
} from './calendar-setup-state.ts';
import {
  calendarPage,
  multiStatus,
} from './testing/multi-calendar-fixtures.ts';

describe('calendar-setup-state', () => {
  it('distinguishes disabled, setup-required, connected, reconnect-required, and degraded states', () => {
    expect(describeConnectionState('disabled').badge).toBe('Disabled (default off)');
    expect(describeConnectionState('setup-required').badge).toBe('Setup required');
    expect(describeConnectionState('connected').badge).toBe('Connected');
    expect(describeConnectionState('reconnect-required').badge).toBe('Reconnect required');
    expect(describeConnectionState('degraded').badge).toBe('Degraded (fixture or limited readiness)');
  });

  it('distinguishes fixture OAuth callback outcomes from real connected Google grants', () => {
    expect(describeOAuthOutcome('connected')).toContain('Google Calendar connected');
    expect(describeOAuthOutcome('fixture')).toContain('local fixture mode');
    expect(describeOAuthOutcome('fixture')).toContain('not a live Google grant');
    expect(describeOAuthOutcome('cancelled')).toContain('cancelled');
    expect(describeOAuthOutcome('failed')).toContain('could not be completed');
  });

  it('requires explicit project-wide revocation acknowledgment before revoke-google-grant', () => {
    let state = createInitialCalendarSetupState();
    state = calendarSetupReducer(state, { type: 'openDisconnect', mode: 'revoke-google-grant' });
    expect(state.disconnectPrompt).toEqual({
      mode: 'revoke-google-grant',
      acknowledgedProjectWide: false,
    });

    state = calendarSetupReducer(state, { type: 'setRevokeAcknowledged', acknowledged: true });
    expect(state.disconnectPrompt?.acknowledgedProjectWide).toBe(true);
  });

  it('navigates only to verified Google OAuth URLs and refuses unsafe targets', () => {
    const navigate = vi.fn();
    const safeUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=c1&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fplugins%2Fgoogle-calendar%2Foauth%2Fcallback&response_type=code&state=s1';
    expect(navigateToGoogleOAuth(safeUrl, navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(safeUrl);

    const unsafeNavigate = vi.fn();
    expect(navigateToGoogleOAuth('javascript:alert(1)', unsafeNavigate)).toBe(false);
    expect(navigateToGoogleOAuth('https://evil.example.com/o/oauth2/v2/auth', unsafeNavigate)).toBe(
      false,
    );
    expect(unsafeNavigate).not.toHaveBeenCalled();
  });

  it('describes remote revocation outcomes without promising automatic background retry', () => {
    expect(describeRemoteRevocation('not-requested')).toContain('Disconnected locally');
    expect(describeRemoteRevocation('confirmed')).toContain('confirmed Google grant revocation');
    expect(describeRemoteRevocation('failed')).toContain('Google Account permissions');
    expect(describeRemoteRevocation('unknown')).toContain('could not be confirmed');
  });

  it('keeps confirmed settings until save and rolls back only the failed draft', () => {
    let state = createInitialCalendarSetupState(multiStatus());
    state = calendarSetupReducer(state, { type: 'selectDefault', calendarId: 'team@example.com' });
    expect(state.status).toEqual(multiStatus());
    state = calendarSetupReducer(state, {
      type: 'requestStarted',
      requestId: 1,
      pending: 'save-default',
    });
    state = calendarSetupReducer(state, {
      type: 'requestFailed',
      requestId: 1,
      message: 'Default save could not be confirmed. Reload before saving again.',
      resetDraft: true,
      unconfirmed: true,
    });
    expect(state.draftCalendarId).toBeNull();
    expect(state.status?.enabled).toBe(true);
    expect(state.error).toContain('could not be confirmed');
    expect(state.settingsUnconfirmed).toBe(true);
  });

  it('ignores stale pages and never resurrects a replaced connection', () => {
    let state = createInitialCalendarSetupState(multiStatus());
    state = calendarSetupReducer(state, { type: 'requestStarted', requestId: 1, pending: null });
    state = calendarSetupReducer(state, { type: 'requestStarted', requestId: 2, pending: null });
    state = calendarSetupReducer(state, {
      type: 'statusReceived',
      requestId: 2,
      status: multiStatus({ connectionRevision: 4, discovery: null }),
    });
    const current = state;
    expect(
      calendarSetupReducer(state, {
        type: 'pageReceived',
        requestId: 1,
        connectionRevision: 3,
        requestedToken: null,
        response: calendarPage(),
      }),
    ).toBe(current);
    expect(state.entries).toEqual([]);
  });

  it('handles race conditions, revision changes during continuation, cache expiry, and authority resets', () => {
    let state = createInitialCalendarSetupState(multiStatus());
    // Initial page load
    state = calendarSetupReducer(state, {
      type: 'requestStarted',
      requestId: 1,
      pending: null,
      listLoading: true,
    });
    state = calendarSetupReducer(state, {
      type: 'pageReceived',
      requestId: 1,
      connectionRevision: 3,
      requestedToken: null,
      response: calendarPage({ discoveryRevision: 11, nextPageToken: 'tok-2' }),
    });
    expect(state.entries).toHaveLength(1);
    expect(state.seenPageTokens).toEqual([]);

    // Continuation with changed discovery revision -> error
    state = calendarSetupReducer(state, {
      type: 'requestStarted',
      requestId: 2,
      pending: null,
      listLoading: true,
    });
    state = calendarSetupReducer(state, {
      type: 'pageReceived',
      requestId: 2,
      connectionRevision: 3,
      requestedToken: 'tok-2',
      response: calendarPage({ discoveryRevision: 12 }),
    });
    expect(state.listPhase).toBe('error');
    expect(state.listError).toContain('Calendar list changed');

    // Duplicate token -> limit error
    state = createInitialCalendarSetupState(multiStatus());
    state = calendarSetupReducer(state, {
      type: 'requestStarted',
      requestId: 1,
      pending: null,
    });
    state = calendarSetupReducer(state, {
      type: 'pageReceived',
      requestId: 1,
      connectionRevision: 3,
      requestedToken: null,
      response: calendarPage({ nextPageToken: 'tok-seen' }),
    });
    state = calendarSetupReducer(state, {
      type: 'requestStarted',
      requestId: 2,
      pending: null,
    });
    state = calendarSetupReducer(state, {
      type: 'pageReceived',
      requestId: 2,
      connectionRevision: 3,
      requestedToken: 'tok-seen',
      response: calendarPage(),
    });
    expect(state.listError).toBeNull();
    // Repeating the same token again
    state = calendarSetupReducer(state, {
      type: 'requestStarted',
      requestId: 3,
      pending: null,
    });
    state = calendarSetupReducer(state, {
      type: 'pageReceived',
      requestId: 3,
      connectionRevision: 3,
      requestedToken: 'tok-seen',
      response: calendarPage(),
    });
    expect(state.listPhase).toBe('error');
    expect(state.listError).toContain('limit was reached');

    // Dirty draft retained on status read of same authority
    state = createInitialCalendarSetupState(multiStatus());
    state = calendarSetupReducer(state, {
      type: 'selectDefault',
      calendarId: 'team@example.com',
    });
    state = calendarSetupReducer(state, {
      type: 'requestStarted',
      requestId: 1,
      pending: null,
    });
    state = calendarSetupReducer(state, {
      type: 'statusReceived',
      requestId: 1,
      status: multiStatus(),
    });
    expect(state.draftCalendarId).toBe('team@example.com');

    // Discovery expired
    state = calendarSetupReducer(state, {
      type: 'requestStarted',
      requestId: 20,
      pending: null,
      listLoading: true,
    });
    state = calendarSetupReducer(state, {
      type: 'pageReceived',
      requestId: 20,
      connectionRevision: 3,
      requestedToken: null,
      response: calendarPage(),
    });
    expect(state.listPhase).toBe('ready');

    state = calendarSetupReducer(state, {
      type: 'discoveryExpired',
      discoveryRevision: 999, // mismatch
    });
    expect(state.listPhase).toBe('ready');
    state = calendarSetupReducer(state, {
      type: 'discoveryExpired',
      discoveryRevision: 11, // match
    });
    expect(state.page).toBeNull();
    expect(state.entries).toEqual([]);
    expect(state.listPhase).toBe('idle');
    expect(state.listError).toContain('expired');

    // Disconnect clears metadata and draft
    state = calendarSetupReducer(state, {
      type: 'disconnected',
      status: multiStatus({ state: 'disabled', enabled: false }),
      remoteRevocation: 'confirmed',
    });
    expect(state.draftCalendarId).toBeNull();
    expect(state.entries).toEqual([]);

    // Late failure (requestId 1) does not overwrite newer success (requestId 5)
    state = calendarSetupReducer(state, {
      type: 'requestStarted',
      requestId: 5,
      pending: null,
    });
    state = calendarSetupReducer(state, {
      type: 'statusReceived',
      requestId: 5,
      status: multiStatus(),
    });
    const afterSuccess = state;
    state = calendarSetupReducer(state, {
      type: 'requestFailed',
      requestId: 1,
      message: 'old error',
      resetDraft: false,
    });
    expect(state).toBe(afterSuccess);
  });
});
