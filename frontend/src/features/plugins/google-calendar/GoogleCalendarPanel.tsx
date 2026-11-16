/**
 * ============================================================================
 * FILE: GoogleCalendarPanel.tsx
 * LOCATION: frontend/src/features/plugins/google-calendar/GoogleCalendarPanel.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Provide the settings panel component for Google Calendar plugin configuration.
 *
 * ROLE IN PROJECT:
 *    Orchestrates OAuth start, enable/disable toggle, disconnect confirmation,
 *    cached calendar paging, and integrates the CalendarDefaults picker.
 *
 * KEY COMPONENTS:
 *    - GoogleCalendarPanel: Main panel component.
 *    - readCachedPage: Cached paging and status re-reading helper.
 *    - handleSaveDefault / handleRefresh: Async mutation handlers with abort fencing.
 * ============================================================================
 */

import React, { useEffect, useId, useReducer, useRef } from 'react';
import {
  CalendarClientError,
  type CalendarClient,
  type CalendarMultiClient,
} from '../../../api/calendar-client.ts';
import type {
  CalendarOAuthCallbackOutcome,
  CalendarPublicStatus,
  CalendarSettingsRequest,
} from '../../../api/calendar-protocol.ts';
import {
  calendarSetupReducer,
  createInitialCalendarSetupState,
  describeConnectionState,
  describeOAuthOutcome,
  navigateToGoogleOAuth,
  type DisconnectMode,
} from './calendar-setup-state.ts';
import { CalendarDefaults } from './CalendarDefaults.tsx';
import './calendar-plugin.css';

export type GoogleCalendarPanelProps = {
  client: CalendarClient | CalendarMultiClient;
  initialStatus?: CalendarPublicStatus | null;
  initialDisconnectMode?: DisconnectMode | null;
  oauthOutcome?: CalendarOAuthCallbackOutcome | null;
  onDismissOAuthOutcome?: () => void;
  navigate?: (url: string) => void;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
};

export function GoogleCalendarPanel({
  client,
  initialStatus = null,
  initialDisconnectMode = null,
  oauthOutcome = null,
  onDismissOAuthOutcome,
  navigate,
  disabled = false,
  onBusy,
}: GoogleCalendarPanelProps): React.JSX.Element {
  const [state, dispatch] = useReducer(
    calendarSetupReducer,
    undefined,
    () => createInitialCalendarSetupState(initialStatus, initialDisconnectMode),
  );

  const inflightRef = useRef(false);
  const requestCounterRef = useRef(0);
  const activeIdRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);

  const localDisconnectBtnRef = useRef<HTMLButtonElement | null>(null);
  const revokeDisconnectBtnRef = useRef<HTMLButtonElement | null>(null);
  const ids = useId();

  const setBusy = (busy: boolean) => {
    inflightRef.current = busy;
    onBusy?.(busy);
  };

  const startRequest = (
    pending: typeof state.pending,
    listLoading = false,
  ): { requestId: number; signal: AbortSignal } | null => {
    if (inflightRef.current || disabled) return null;
    setBusy(true);
    const requestId = ++requestCounterRef.current;
    activeIdRef.current = requestId;
    if (activeRequestRef.current) {
      activeRequestRef.current.abort();
    }
    const controller = new AbortController();
    activeRequestRef.current = controller;
    dispatch({ type: 'requestStarted', requestId, pending, listLoading });
    return { requestId, signal: controller.signal };
  };

  const readCachedPage = async (requestedToken: string | null = null) => {
    const req = startRequest(null, true);
    if (!req) return;
    const { requestId, signal } = req;
    try {
      const status = await client.getStatus(signal);
      if (activeIdRef.current !== requestId) return;
      dispatch({ type: 'statusReceived', requestId, status });

      if (
        status.protocolVersion === 2 &&
        status.state === 'connected' &&
        status.enabled &&
        status.connectionRevision !== null &&
        client.listCalendars
      ) {
        const pageQuery = requestedToken ? { pageToken: requestedToken } : {};
        const pageResponse = await client.listCalendars(pageQuery, signal);
        if (activeIdRef.current !== requestId) return;
        dispatch({
          type: 'pageReceived',
          requestId,
          response: pageResponse,
          requestedToken,
          connectionRevision: status.connectionRevision,
        });
      }
    } catch (err: unknown) {
      if (activeIdRef.current !== requestId) return;
      if (signal.aborted) return;
      const message =
        err instanceof CalendarClientError ? err.message : 'Calendar status could not be loaded.';
      dispatch({ type: 'requestFailed', requestId, message, resetDraft: false, listOnly: true });
    } finally {
      if (activeIdRef.current === requestId) {
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    if (initialStatus) {
      if (
        initialStatus.protocolVersion === 2 &&
        initialStatus.state === 'connected' &&
        initialStatus.enabled &&
        client.listCalendars &&
        !state.page
      ) {
        void readCachedPage(null);
      }
      return undefined;
    }
    void readCachedPage(null);
    return () => {
      activeIdRef.current = ++requestCounterRef.current;
      if (activeRequestRef.current) {
        activeRequestRef.current.abort();
      }
      setBusy(false);
    };
  }, [client, initialStatus]);

  const toggleEnabled = async (nextEnabled: boolean) => {
    const req = startRequest(nextEnabled ? 'enable' : 'disable');
    if (!req) return;
    const { requestId, signal } = req;
    try {
      const status = await client.updateSettings({ enabled: nextEnabled }, signal);
      if (activeIdRef.current !== requestId) return;
      dispatch({
        type: 'statusReceived',
        requestId,
        status,
      });
      if (nextEnabled && status.protocolVersion === 2 && status.state === 'connected') {
        setBusy(false);
        await readCachedPage(null);
      }
    } catch (err: unknown) {
      if (activeIdRef.current !== requestId) return;
      const message =
        err instanceof CalendarClientError
          ? err.message
          : 'Could not update Google Calendar setting.';
      dispatch({ type: 'requestFailed', requestId, message, resetDraft: false });
    } finally {
      if (activeIdRef.current === requestId) {
        setBusy(false);
      }
    }
  };

  const startConnect = async () => {
    const req = startRequest('oauth-start');
    if (!req) return;
    const { requestId, signal } = req;
    try {
      const response = await client.startOAuth(signal);
      if (activeIdRef.current !== requestId) return;
      const ok = navigateToGoogleOAuth(response.authorizationUrl, navigate);
      if (!ok) {
        dispatch({
          type: 'requestFailed',
          requestId,
          message: 'Refused navigation to an untrusted OAuth authorization URL.',
          resetDraft: false,
        });
      }
    } catch (err: unknown) {
      if (activeIdRef.current !== requestId) return;
      const message =
        err instanceof CalendarClientError
          ? err.message
          : 'Could not start Google Calendar authorization.';
      dispatch({ type: 'requestFailed', requestId, message, resetDraft: false });
    } finally {
      if (activeIdRef.current === requestId) {
        setBusy(false);
      }
    }
  };

  const confirmDisconnect = async () => {
    const prompt = state.disconnectPrompt;
    if (!prompt || inflightRef.current || disabled) return;
    if (prompt.mode === 'revoke-google-grant' && !prompt.acknowledgedProjectWide) {
      return;
    }
    const req = startRequest('disconnect');
    if (!req) return;
    const { requestId, signal } = req;
    try {
      const result = await client.disconnect(
        prompt.mode === 'local'
          ? { mode: 'local' }
          : { mode: 'revoke-google-grant', acknowledgeProjectWideRevocation: true },
        signal,
      );
      if (activeIdRef.current !== requestId) return;
      const latestStatus = await client.getStatus(signal);
      if (activeIdRef.current !== requestId) return;
      dispatch({
        type: 'disconnected',
        status: latestStatus,
        remoteRevocation: result.remoteRevocation,
      });
    } catch (err: unknown) {
      if (activeIdRef.current !== requestId) return;
      const message =
        err instanceof CalendarClientError
          ? err.message
          : 'Could not complete Google Calendar disconnect.';
      dispatch({ type: 'requestFailed', requestId, message, resetDraft: false });
    } finally {
      if (activeIdRef.current === requestId) {
        setBusy(false);
      }
    }
  };

  const closeDisconnect = () => {
    const mode = state.disconnectPrompt?.mode;
    dispatch({ type: 'closeDisconnect' });
    queueMicrotask(() => {
      if (mode === 'local') localDisconnectBtnRef.current?.focus();
      if (mode === 'revoke-google-grant') revokeDisconnectBtnRef.current?.focus();
    });
  };

  const handleSaveDefault = async (reset = false) => {
    const currentStatus = state.status;
    if (
      currentStatus?.protocolVersion !== 2 ||
      currentStatus.connectionRevision === null ||
      currentStatus.defaultSetting === null ||
      inflightRef.current ||
      disabled
    ) {
      return;
    }
    const req = startRequest('save-default');
    if (!req) return;
    const { requestId, signal } = req;
    const request: CalendarSettingsRequest = {
      defaultSetting: {
        calendarId: reset ? null : state.draftCalendarId,
        expectedRevision: currentStatus.defaultSetting.defaultSettingRevision,
        expectedConnectionRevision: currentStatus.connectionRevision,
      },
    };
    try {
      const updatedStatus = await client.updateSettings(request, signal);
      if (activeIdRef.current === requestId) {
        dispatch({ type: 'defaultSaved', requestId, status: updatedStatus });
      }
    } catch (err: unknown) {
      if (activeIdRef.current !== requestId) return;
      const isConflict =
        err instanceof CalendarClientError &&
        (err.status === 409 || err.code === 'CONFLICT_ACTIVE_TURN');
      const isInvalid =
        err instanceof CalendarClientError &&
        (err.status === 400 || err.code === 'INVALID_REQUEST');
      const isUncertain = err instanceof CalendarClientError && err.uncertain;

      if (isConflict) {
        dispatch({
          type: 'requestFailed',
          requestId,
          message: 'Settings changed elsewhere. Review the current default and save again.',
          resetDraft: true,
        });
        void readCachedPage(null);
      } else if (isInvalid) {
        dispatch({
          type: 'requestFailed',
          requestId,
          message: err.message,
          resetDraft: true,
        });
      } else {
        dispatch({
          type: 'requestFailed',
          requestId,
          message: 'Default save could not be confirmed. Reload before saving again.',
          resetDraft: true,
          unconfirmed: isUncertain,
        });
        void readCachedPage(null);
      }
    } finally {
      if (activeIdRef.current === requestId) {
        setBusy(false);
      }
    }
  };

  const handleRefresh = async () => {
    const currentStatus = state.status;
    if (
      currentStatus?.protocolVersion !== 2 ||
      currentStatus.connectionRevision === null ||
      !currentStatus.enabled ||
      currentStatus.state !== 'connected' ||
      !client.refreshCalendars ||
      inflightRef.current ||
      disabled
    ) {
      return;
    }
    const capturedRevision = currentStatus.connectionRevision;
    const req = startRequest('refresh', true);
    if (!req) return;
    const { requestId, signal } = req;
    try {
      await client.refreshCalendars({ expectedConnectionRevision: capturedRevision }, signal);
      if (activeIdRef.current !== requestId) return;
      setBusy(false);
      await readCachedPage(null);
    } catch (err: unknown) {
      if (activeIdRef.current !== requestId) return;
      if (signal.aborted) return;
      const message =
        err instanceof CalendarClientError ? err.message : 'Calendar refresh failed.';
      dispatch({ type: 'requestFailed', requestId, message, resetDraft: false, listOnly: true });
      setBusy(false);
      await readCachedPage(null);
    } finally {
      if (activeIdRef.current === requestId) {
        setBusy(false);
      }
    }
  };

  const handleNextPage = () => {
    if (state.page?.nextPageToken) {
      void readCachedPage(state.page.nextPageToken);
    }
  };

  const status = state.status;
  const isV2 = status?.protocolVersion === 2;
  const busy = state.pending !== null || disabled;
  const connectionCopy = status ? describeConnectionState(status.state) : null;
  const canStartOAuth =
    status !== null &&
    (isV2 || status.targetCalendarId !== null) &&
    status.processingDisclosure !== null &&
    !busy;

  const hasStoredConnection =
    status !== null &&
    (status.state === 'connected' ||
      status.state === 'reconnect-required' ||
      status.state === 'degraded' ||
      status.accountEmail !== null);

  return (
    <section
      className="aurvin-calendar-panel"
      aria-label="Google Calendar connection and settings"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && state.disconnectPrompt && !state.pending) {
          event.preventDefault();
          closeDisconnect();
        }
      }}
    >
      {oauthOutcome ? (
        <div
          className="aurvin-calendar-oauth-banner"
          role="status"
          aria-live="polite"
          data-oauth-outcome={oauthOutcome}
        >
          <p>{describeOAuthOutcome(oauthOutcome)}</p>
          {onDismissOAuthOutcome ? (
            <button type="button" onClick={onDismissOAuthOutcome}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}

      {state.phase === 'loading' ? (
        <p role="status">Loading Google Calendar status…</p>
      ) : null}

      {state.phase === 'unavailable' ? (
        <div className="aurvin-calendar-alert" role="alert">
          <p>{state.error ?? 'Google Calendar setup status is unavailable.'}</p>
          <button type="button" onClick={() => void readCachedPage(null)}>
            Retry status check
          </button>
        </div>
      ) : null}

      {status && connectionCopy ? (
        <div className="aurvin-calendar-card">
          <div className="aurvin-calendar-header-row">
            <div>
              <h3 className="aurvin-calendar-heading">Google Calendar (embedded MCP)</h3>
              <p className="aurvin-admin-help">
                Single-user local proof bound to the server-configured Aurvin user. Member accounts and RBAC are not enabled.
              </p>
            </div>
            <span
              className="aurvin-calendar-state-badge"
              data-calendar-connection-state={status.state}
            >
              {connectionCopy.badge}
            </span>
          </div>

          <p className="aurvin-calendar-summary">{connectionCopy.summary}</p>

          <dl className="aurvin-calendar-meta">
            {isV2 ? (
              <div>
                <dt>Default calendar</dt>
                <dd>
                  {status.defaultSetting?.defaultCalendarId
                    ? status.defaultSetting.defaultCalendarId
                    : 'Use primary automatically'}
                </dd>
              </div>
            ) : (
              <div>
                <dt>Legacy configured target (requires upgrade)</dt>
                <dd>{status.targetCalendarId ?? 'Not configured on server'}</dd>
              </div>
            )}
            <div>
              <dt>Connected Google account</dt>
              <dd>{status.accountEmail ?? 'Not connected'}</dd>
            </div>
            <div>
              <dt>External processing &amp; privacy</dt>
              <dd>
                {status.processingDisclosure
                  ? `${status.processingDisclosure.processors} · Data collection: ${status.processingDisclosure.dataCollection} (policy ${status.processingDisclosure.policyId})`
                  : 'External processing policy not configured on server'}
              </dd>
            </div>
          </dl>

          {isV2 ? (
            status.processingDisclosure === null ? (
              <p className="aurvin-admin-help" role="note">
                Server OAuth credentials, exact callback/origin and an approved processing policy are required before connecting.
              </p>
            ) : (
              <p className="aurvin-admin-help" role="note">
                Server OAuth credentials, exact callback/origin and an approved processing policy are server setup; they do not enter IDs/keys in the browser.
              </p>
            )
          ) : status.targetCalendarId === null || status.processingDisclosure === null ? (
            <p className="aurvin-admin-help" role="note">
              Server OAuth credentials, a disposable owned target calendar ID, and an approved processing policy ID are required before connecting.
            </p>
          ) : null}

          <div className="aurvin-calendar-actions">
            {status.enabled ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void toggleEnabled(false)}
              >
                {state.pending === 'disable' ? 'Disabling…' : 'Disable Google Calendar'}
              </button>
            ) : (
              <button
                type="button"
                className="aurvin-calendar-primary-btn"
                disabled={busy}
                onClick={() => void toggleEnabled(true)}
              >
                {state.pending === 'enable' ? 'Enabling…' : 'Enable Google Calendar'}
              </button>
            )}

            {status.state === 'reconnect-required' || status.state === 'degraded' ? (
              <button
                type="button"
                className="aurvin-calendar-primary-btn"
                disabled={!canStartOAuth}
                onClick={() => void startConnect()}
              >
                {state.pending === 'oauth-start'
                  ? 'Starting OAuth…'
                  : 'Reconnect Google Calendar'}
              </button>
            ) : status.state !== 'connected' ? (
              <button
                type="button"
                className="aurvin-calendar-primary-btn"
                disabled={!canStartOAuth}
                onClick={() => void startConnect()}
              >
                {state.pending === 'oauth-start'
                  ? 'Starting OAuth…'
                  : 'Connect Google Calendar'}
              </button>
            ) : null}

            {hasStoredConnection ? (
              <>
                <button
                  ref={localDisconnectBtnRef}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    dispatch({ type: 'openDisconnect', mode: 'local' })
                  }
                >
                  Disconnect locally
                </button>
                <button
                  ref={revokeDisconnectBtnRef}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    dispatch({ type: 'openDisconnect', mode: 'revoke-google-grant' })
                  }
                >
                  Disconnect &amp; revoke Google grant
                </button>
              </>
            ) : null}
          </div>

          {state.disconnectPrompt ? (
            <div
              className="aurvin-admin-confirm aurvin-calendar-disconnect-confirm"
              role="group"
              aria-label={
                state.disconnectPrompt.mode === 'local'
                  ? 'Confirm local Google Calendar disconnect'
                  : 'Confirm project-wide Google grant revocation and disconnect'
              }
            >
              {state.disconnectPrompt.mode === 'local' ? (
                <>
                  <p>Disconnect Google Calendar locally?</p>
                  <p>
                    Clears stored Aurvin tokens and disables Calendar dispatch immediately without revoking your wider Google project grant or deleting existing Calendar events.
                  </p>
                </>
              ) : (
                <>
                  <p>Revoke Google grant and disconnect?</p>
                  <p>
                    Project-wide implication: revoking the Google grant at Google&apos;s revocation endpoint can invalidate all tokens issued to this OAuth project for your Google account. Existing Calendar events are not deleted.
                  </p>
                  <label className="aurvin-admin-check" htmlFor={`${ids}-ack-revoke`}>
                    <input
                      id={`${ids}-ack-revoke`}
                      type="checkbox"
                      checked={state.disconnectPrompt.acknowledgedProjectWide}
                      disabled={busy}
                      onChange={(event) =>
                        dispatch({
                          type: 'setRevokeAcknowledged',
                          acknowledged: event.target.checked,
                        })
                      }
                    />
                    <span>
                      I understand this revokes the Google grant across this OAuth project
                    </span>
                  </label>
                </>
              )}
              <div className="aurvin-calendar-confirm-actions">
                <button
                  type="button"
                  disabled={
                    busy ||
                    (state.disconnectPrompt.mode === 'revoke-google-grant' &&
                      !state.disconnectPrompt.acknowledgedProjectWide)
                  }
                  onClick={() => void confirmDisconnect()}
                >
                  {state.pending === 'disconnect'
                    ? 'Disconnecting…'
                    : state.disconnectPrompt.mode === 'local'
                      ? 'Confirm local disconnect'
                      : 'Revoke Google grant and disconnect'}
                </button>
                <button type="button" disabled={busy} onClick={closeDisconnect}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {isV2 && (hasStoredConnection || status.state === 'connected' || state.page !== null) ? (
            <CalendarDefaults
              state={state}
              disabled={busy}
              nowMs={Date.now()}
              onSelect={(calendarId) => dispatch({ type: 'selectDefault', calendarId })}
              onSave={() => void handleSaveDefault(false)}
              onReset={() => void handleSaveDefault(true)}
              onRefresh={() => void handleRefresh()}
              onNextPage={() => void handleNextPage()}
            />
          ) : null}

          {state.notice ? (
            <p className="aurvin-calendar-notice" role="status" aria-live="polite">
              {state.notice}
            </p>
          ) : null}

          {state.error ? (
            <p className="aurvin-admin-field-error" role="alert">
              {state.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
